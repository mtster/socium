// CLOUDFLARE FEED WORKER (socium-feed-notifications)
// Designed for serverless trigger on inserts in public.feed_activity
// This file is compiled to standard JavaScript (ES6 modules) for direct Cloudflare UI compatibility.

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Only POST allowed', { status: 405 });
    }

    try {
      const activity = await request.json();
      const { activity_type, initiator_id, post_id, comment_id, connection_request_id, target_user_id } = activity;

      // 1. Fetch initiator's full profile info
      const initiatorProfile = await fetchSupabase(env, `/rest/v1/profiles?id=eq.${initiator_id}&select=*`);
      const initiator = initiatorProfile[0] || { full_name: 'Someone', username: 'someone' };
      const initiatorName = initiator.full_name || initiator.username || 'Someone';

      // 2. Identify target recipients, check muting, and notify
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

      // Process each recipient
      for (const userId of recipients) {
        const presence = await fetchFirebase(env, `/global_presence/${userId}.json`);
        const location = await fetchFirebase(env, `/location/${userId}.json`);

        const isOnline = presence === true;
        const inFeedOrInbox = location === 'feed' || location === 'feed_inbox';

        // Case C: User is in the active feed/inbox tab -> Do nothing
        if (inFeedOrInbox) {
          continue;
        }

        // Under all other circumstances, update the 'feed' node to the initiator's UID
        await updateFirebase(env, `/feed/${userId}.json`, JSON.stringify(initiator_id));

        if (isOnline) {
          // Case B: User is online but on another page -> Update node but don't increment.
        } else {
          // Case A: User is offline -> Update feed node, increment atomic unseen_chat_count, send FCM!
          await transactionIncrementFirebase(env, userId);

          const subscriptions = await fetchSupabase(
            env, 
            `/rest/v1/push_subscriptions?user_id=eq.${userId}&select=endpoint,auth_key,p256dh_key`
          );

          if (subscriptions && subscriptions.length > 0) {
            const currentUnseenBadge = await fetchFirebase(env, `/unseen_chat_count/${userId}.json`) || 1;

            let title = 'New Action in Feed';
            let body = `${initiatorName} did something new!`;
            let clickActionUrl = 'https://sociumx.vercel.app/feed';

            if (activity_type === 'post') {
              const postDetails = await fetchSupabase(env, `/rest/v1/posts?id=eq.${post_id}&select=caption`);
              const caption = postDetails[0]?.caption || '';
              const truncatedCaption = caption.length > 50 ? caption.substring(0, 47) + '...' : caption;
              title = 'New Post';
              body = `${initiatorName} posted: ${truncatedCaption || 'image'}`;
              clickActionUrl = `https://sociumx.vercel.app/feed/post/${post_id}`;
            } else if (activity_type === 'like') {
              title = 'New Like';
              body = `${initiatorName} liked your post!`;
            } else if (activity_type === 'comment') {
              const commentDetails = await fetchSupabase(env, `/rest/v1/comments?id=eq.${comment_id}&select=content`);
              const commentContent = commentDetails[0]?.content || '';
              const truncatedComment = commentContent.length > 50 ? commentContent.substring(0, 47) + '...' : commentContent;
              title = 'New Comment';
              body = `${initiatorName} commented: "${truncatedComment}"`;
              clickActionUrl = `https://sociumx.vercel.app/feed/post/${post_id}`;
            } else if (activity_type === 'connection_request') {
              title = 'Connection Request';
              body = `${initiatorName} sent you a connection request!`;
              clickActionUrl = 'https://sociumx.vercel.app/profile';
            }

            const tokens = subscriptions.map((s) => s.endpoint);
            await sendFCMMessages(env, tokens, title, body, clickActionUrl, currentUnseenBadge);
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

// --- Dynamic OAuth2 JWT Exchange Manager for Google Service Account Json ---

async function getAccessToken(env) {
  const token = env.FIREBASE_ACCESS_TOKEN?.trim();
  if (!token) return '';
  if (!token.startsWith('{')) {
    // Already acts as a direct authentication token
    return token;
  }
  
  try {
    const sa = JSON.parse(token);
    const now = Math.floor(Date.now() / 1000);
    const jwtHeader = { alg: 'RS256', typ: 'JWT' };
    const jwtClaim = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/cloud-platform',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
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

    const pem = sa.private_key;
    const pemContents = pem
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '');
    
    // Decode base64 PEM back to array buffer
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey.buffer,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: { name: 'SHA-256' }
      },
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

    // Exchanging signed JWT assert for modern OAuth2 token
    const tokenRes = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!tokenRes.ok) {
      throw new Error(`Failed to exchange token: ${await tokenRes.text()}`);
    }

    const tokenData = await tokenRes.json();
    return tokenData.access_token;
  } catch (err) {
    console.error('RS256 JWT Token exchange failure:', err);
    throw err;
  }
}

async function getFirebaseUrl(env, path) {
  const token = await getAccessToken(env);
  const base = env.FIREBASE_DATABASE_URL.endsWith('/') 
    ? env.FIREBASE_DATABASE_URL.slice(0, -1) 
    : env.FIREBASE_DATABASE_URL;
  return `${base}${path}?access_token=${token}`;
}

// --- Firebase Helper Functions ---

async function fetchFirebase(env, path) {
  const url = await getFirebaseUrl(env, path);
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function updateFirebase(env, path, bodyJson) {
  const url = await getFirebaseUrl(env, path);
  await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: bodyJson
  });
}

async function transactionIncrementFirebase(env, userId) {
  const url = await getFirebaseUrl(env, `/unseen_chat_count.json`);
  await fetch(url, {
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

async function sendFCMMessages(
  env, 
  tokens, 
  title, 
  body, 
  url,
  badge
) {
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;
  const token = await getAccessToken(env);
  
  for (const tokenTarget of tokens) {
    const payload = {
      message: {
        token: tokenTarget,
        notification: {
          title,
          body
        },
        data: {
          url,
          badge: String(badge)
        },
        webpush: {
          headers: {
            Urgency: 'high'
          },
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
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).catch(e => console.error('FCM Transmission error:', e));
  }
}
