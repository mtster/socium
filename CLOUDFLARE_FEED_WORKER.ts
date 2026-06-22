// CLOUDFLARE FEED WORKER (socium-feed-notifications)
// Designed for serverless trigger on inserts in public.feed_activity

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Only POST allowed', { status: 405 });
    }

    const authHeader = request.headers.get('Authorization');
    const expectedToken = env.WEBHOOK_SECRET_TOKEN || 'secure-feed-webhook-token-override';
    
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      const activity = await request.json();
      const { activity_type, initiator_id, post_id, comment_id, initiator_name, target_user_id } = activity;

      // 1. Identify target recipients
      let recipients = [];

      if (activity_type === 'post') {
        const connections = await fetchSupabase(
          env, 
          `/rest/v1/connections?connection_id=eq.${initiator_id}&is_activity_muted=eq.false&select=user_id`
        );
        recipients = connections.map((c) => c.user_id);
      } else if (target_user_id) {
        const mutedRecord = await fetchSupabase(
          env,
          `/rest/v1/connections?user_id=eq.${target_user_id}&connection_id=eq.${initiator_id}&is_activity_muted=eq.true&select=user_id`
        );
        if (mutedRecord.length === 0) {
          recipients = [target_user_id];
        }
      }

      if (recipients.length === 0) {
        return new Response(JSON.stringify({ status: 'ignored', reason: 'No recipients or muted' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const initiatorName = initiator_name || 'Someone';
      const firebaseToken = await getFirebaseAccessToken(env);

      // Process each recipient
      for (const userId of recipients) {
        const presence = await fetchFirebase(env, `/global_presence/${userId}.json`, firebaseToken);
        const location = await fetchFirebase(env, `/location/${userId}.json`, firebaseToken);

        const isOnline = presence === true;
        const inFeedOrInbox = location === 'feed' || location === 'feed_inbox';

        // Case C: User is in the active feed/inbox tab -> Do nothing
        if (inFeedOrInbox) {
          continue;
        }

        // Check if user already had pending feed notifications
        const currentFeedValue = await fetchFirebase(env, `/feed/${userId}.json`, firebaseToken);

        // Update the 'feed' node to the initiator's UID
        await updateFirebase(env, `/feed/${userId}.json`, JSON.stringify(initiator_id), firebaseToken);

        if (!isOnline) {
          // Increment unseen_chat_count ONLY IF previously empty/cleared
          if (!currentFeedValue || currentFeedValue === '""' || currentFeedValue === "") {
             await transactionIncrementFirebase(env, userId, firebaseToken);
          }

          const subscriptions = await fetchSupabase(
            env, 
            `/rest/v1/push_subscriptions?user_id=eq.${userId}&select=endpoint`
          );

          if (subscriptions && subscriptions.length > 0) {
            const currentBadgeObj = await fetchFirebase(env, `/unseen_chat_count/${userId}.json`, firebaseToken);
            const currentUnseenBadge = currentBadgeObj || 1;

            let title = initiatorName;
            let body = 'did something new!';
            let clickActionUrl = `/?activity_id=${activity.id}`;

            if (activity_type === 'post') {
              body = `🌏Posted`;
            } else if (activity_type === 'like') {
              body = `❤️🔥Liked your post`;
            } else if (activity_type === 'comment') {
              body = `🗨️Commented on your post`;
            } else if (activity_type === 'connection_request') {
              body = `👥Sent you a connection request`;
            }

            const tokens = subscriptions.map((s) => s.endpoint);
            await sendFCMMessages(env, tokens, title, body, clickActionUrl, currentUnseenBadge, firebaseToken);
          }
        }
      }

      return new Response(JSON.stringify({ status: 'ok', processed: recipients.length }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }
};

// --- Modern Google Service Account JWT Exchange ---
async function getFirebaseAccessToken(env) {
  try {
    const clientEmail = env.FIREBASE_CLIENT_EMAIL;
    const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    
    const now = Math.floor(Date.now() / 1000);
    const jwtHeader = { alg: 'RS256', typ: 'JWT' };
    const jwtClaim = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3000,
      iat: now
    };

    const base64UrlEncode = (str) => {
      const bytes = new TextEncoder().encode(str);
      let binString = '';
      for (const b of bytes) binString += String.fromCharCode(b);
      return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };

    const headerEncoded = base64UrlEncode(JSON.stringify(jwtHeader));
    const claimEncoded = base64UrlEncode(JSON.stringify(jwtClaim));
    const signingInput = `${headerEncoded}.${claimEncoded}`;

    const pemContents = privateKey
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '');
    
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(signingInput)
    );

    let binarySign = '';
    const signBytes = new Uint8Array(signature);
    for (const b of signBytes) binarySign += String.fromCharCode(b);
    const signatureEncoded = btoa(binarySign).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const jwt = `${signingInput}.${signatureEncoded}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!tokenRes.ok) throw new Error(`Failed to exchange token: ${await tokenRes.text()}`);
    const tokenData = await tokenRes.json();
    return tokenData.access_token;
  } catch (err) {
    console.error('RS256 JWT Token exchange failure:', err);
    throw err;
  }
}

// --- Firebase Helper Functions ---
function getFirebaseUrl(env, path, token) {
  const base = env.FIREBASE_DATABASE_URL.endsWith('/') 
    ? env.FIREBASE_DATABASE_URL.slice(0, -1) 
    : env.FIREBASE_DATABASE_URL;
  return `${base}${path}?access_token=${token}`;
}

async function fetchFirebase(env, path, token) {
  const res = await fetch(getFirebaseUrl(env, path, token));
  if (!res.ok) return null;
  return res.json();
}

async function updateFirebase(env, path, bodyJson, token) {
  await fetch(getFirebaseUrl(env, path, token), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: bodyJson
  });
}

async function transactionIncrementFirebase(env, userId, token) {
  await fetch(getFirebaseUrl(env, `/unseen_chat_count.json`, token), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [userId]: { ".sv": { "increment": 1 } } })
  });
}

// --- Supabase REST Helper Functions ---
async function fetchSupabase(env, path) {
  const url = `${env.SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) return [];
  return res.json();
}

// --- FCM Multi-Cast Sender Helper ---
async function sendFCMMessages(env, tokens, title, body, url, badge, accessToken) {
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;
  
  for (const tokenTarget of tokens) {
    const payload = {
      message: {
        token: tokenTarget,
        notification: { title, body },
        data: { url, badge: String(badge) },
        webpush: {
          headers: { Urgency: 'high' },
          notification: {
            badge: '/logo.png',
            icon: '/logo.png',
            click_action: url
          }
        }
      }
    };

    await fetch(fcmUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).catch(e => console.error('FCM Transmission error:', e));
  }
}
