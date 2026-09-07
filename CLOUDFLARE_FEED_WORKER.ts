// CLOUDFLARE FEED WORKER (socium-feed-notifications)
// Designed for serverless trigger on inserts in public.feed_activity

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Only POST allowed', { status: 405 });
    }

    const authHeader = (request.headers.get('Authorization') || '').trim();
    const expectedToken = (env.WEBHOOK_SECRET_TOKEN || 'secure-feed-webhook-token-override').trim();
    
    // Accept either "Bearer <token>", raw "<token>", or token matching case-insensitively
    const isAuthorized = 
      authHeader === `Bearer ${expectedToken}` || 
      authHeader === expectedToken ||
      authHeader.replace(/^Bearer\s+/i, '') === expectedToken;

    if (!isAuthorized) {
      console.warn(`[AUTH] Unauthorized webhook call. Received: "${authHeader}". Expected token length: ${expectedToken.length}`);
      return new Response(JSON.stringify({ error: 'Unauthorized', message: 'Webhook token mismatch' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      const rawPayload = await request.json();
      console.log('[PAYLOAD] Received webhook body:', JSON.stringify(rawPayload));

      // Support BOTH:
      // 1. Native Supabase Dashboard Webhook: { type: "INSERT", table: "feed_activity", record: { ... } }
      // 2. Custom SQL pg_net trigger: { id, activity_type, initiator_id, ... }
      const record = (rawPayload && rawPayload.record) ? rawPayload.record : (rawPayload || {});

      const activity_type = record.activity_type;
      const initiator_id = record.initiator_id;
      const post_id = record.post_id;
      const comment_id = record.comment_id;
      const connection_request_id = record.connection_request_id;
      const tagged_user_ids = record.tagged_user_ids;
      let initiator_name = record.initiator_name;
      let target_user_id = record.target_user_id;

      if (!activity_type || !initiator_id) {
        console.warn('[PAYLOAD] Missing activity_type or initiator_id:', record);
        return new Response(JSON.stringify({ error: 'Invalid payload', record }), { status: 400 });
      }

      // If initiator_name was not included (e.g. Supabase Dashboard Webhook sends raw table row), fetch it
      if (!initiator_name) {
        const profs = await fetchSupabase(env, `/rest/v1/profiles?id=eq.${initiator_id}&select=full_name,username`);
        if (Array.isArray(profs) && profs.length > 0) {
          initiator_name = profs[0].full_name || profs[0].username || 'Someone';
        } else {
          initiator_name = 'Someone';
        }
      }

      // If target_user_id was not included (e.g. Supabase Dashboard Webhook), resolve it from related tables
      if (!target_user_id) {
        if (activity_type === 'connection_request' && connection_request_id) {
          const crs = await fetchSupabase(env, `/rest/v1/connection_requests?id=eq.${connection_request_id}&select=receiver_id`);
          if (Array.isArray(crs) && crs.length > 0) target_user_id = crs[0].receiver_id;
        } else if ((activity_type === 'like' || activity_type === 'comment') && post_id) {
          const posts = await fetchSupabase(env, `/rest/v1/posts?id=eq.${post_id}&select=user_id`);
          if (Array.isArray(posts) && posts.length > 0) target_user_id = posts[0].user_id;
        }
      }

      // 1. Identify target recipients and their notification bodies
      let recipientGroups = []; // array of { userId: string, body: string }

      const taggedIds = (Array.isArray(tagged_user_ids) ? tagged_user_ids : []).filter(id => id && id !== initiator_id);

      if (activity_type === 'post') {
        const connections = await fetchSupabase(
          env, 
          `/rest/v1/connections?connection_id=eq.${initiator_id}&select=user_id,is_activity_muted`
        );
        const connectionIds = (Array.isArray(connections) ? connections : [])
          .filter((c) => c && c.is_activity_muted !== true)
          .map((c) => c.user_id)
          .filter(Boolean);

        if (taggedIds.length === 0) {
          // Standard post logic
          for (const uid of connectionIds) {
            recipientGroups.push({ userId: uid, body: `🌏Posted` });
          }
        } else {
          // Send tagged notifications to tagged users
          for (const uid of taggedIds) {
            recipientGroups.push({ userId: uid, body: `@Mentioned you in a post🌏` });
          }
          // Send regular notifications to untagged connections
          for (const uid of connectionIds) {
            if (!taggedIds.includes(uid)) {
              recipientGroups.push({ userId: uid, body: `🌏Posted` });
            }
          }
        }
      } else if (activity_type === 'profile_picture') {
        const connections = await fetchSupabase(
          env, 
          `/rest/v1/connections?connection_id=eq.${initiator_id}&select=user_id,is_activity_muted`
        );
        const connectionIds = (Array.isArray(connections) ? connections : [])
          .filter((c) => c && c.is_activity_muted !== true)
          .map((c) => c.user_id)
          .filter(Boolean);

        for (const uid of connectionIds) {
          recipientGroups.push({ userId: uid, body: `👤Updated profile picture` });
        }
      } else if (activity_type === 'comment') {
        if (taggedIds.length === 0) {
          // Standard comment logic
          if (target_user_id && target_user_id !== initiator_id) {
            const mutedRecord = await fetchSupabase(
              env,
              `/rest/v1/connections?user_id=eq.${target_user_id}&connection_id=eq.${initiator_id}&is_activity_muted=eq.true&select=user_id`
            );
            if (Array.isArray(mutedRecord) && mutedRecord.length === 0) {
              recipientGroups.push({ userId: target_user_id, body: `🗨️Commented on your post` });
            }
          }
        } else {
          // Tagged comments logic
          for (const uid of taggedIds) {
            recipientGroups.push({ userId: uid, body: `@Mentioned you in a comment🗨️` });
          }
          if (target_user_id && target_user_id !== initiator_id && !taggedIds.includes(target_user_id)) {
            const mutedRecord = await fetchSupabase(
              env,
              `/rest/v1/connections?user_id=eq.${target_user_id}&connection_id=eq.${initiator_id}&is_activity_muted=eq.true&select=user_id`
            );
            if (Array.isArray(mutedRecord) && mutedRecord.length === 0) {
              recipientGroups.push({ userId: target_user_id, body: `🗨️Commented on your post` });
            }
          }
        }
      } else {
        // Other activity types (like, connection_request)
        if (target_user_id && target_user_id !== initiator_id) {
          const mutedRecord = await fetchSupabase(
            env,
            `/rest/v1/connections?user_id=eq.${target_user_id}&connection_id=eq.${initiator_id}&is_activity_muted=eq.true&select=user_id`
          );
          if (Array.isArray(mutedRecord) && mutedRecord.length === 0) {
            let bodyText = 'did something new!';
            if (activity_type === 'like') {
              bodyText = `❤️‍🔥Liked your post`;
            } else if (activity_type === 'connection_request') {
              bodyText = `👥Sent you a connection request`;
            }
            recipientGroups.push({ userId: target_user_id, body: bodyText });
          }
        }
      }

      console.log(`[PROCESS] ${activity_type} from ${initiator_name} (${initiator_id}). Recipient count: ${recipientGroups.length}`);

      if (recipientGroups.length === 0) {
        return new Response(JSON.stringify({ status: 'ignored', reason: 'No recipients or muted' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const initiatorName = initiator_name || 'Someone';
      const firebaseToken = await getFirebaseAccessToken(env);

      // Process each recipient
      for (const group of recipientGroups) {
        const { userId, body } = group;
        const presence = await fetchFirebase(env, `/global_presence/${userId}.json`, firebaseToken);
        const location = await fetchFirebase(env, `/location/${userId}.json`, firebaseToken);

        const isOnline = presence === true;
        const inFeedOrInbox = location === 'feed' || location === 'feed_inbox';

        console.log(`[USER ${userId}] presence: ${presence}, location: ${location}, isOnline: ${isOnline}, inFeedOrInbox: ${inFeedOrInbox}`);

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
            let clickActionUrl = `/?activity_id=${record.id || ''}`;

            const tokens = subscriptions.map((s) => s.endpoint);
            console.log(`[PUSH] Dispatching FCM push to ${tokens.length} token(s) for user ${userId}`);
            await sendFCMMessages(env, tokens, title, body, clickActionUrl, currentUnseenBadge, firebaseToken);
          } else {
            console.log(`[PUSH] User ${userId} has 0 push_subscriptions in Supabase.`);
          }
        }
      }

      return new Response(JSON.stringify({ status: 'ok', processed: recipientGroups.length }), {
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
      scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/cloud-platform',
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
      .replace(/(?:-----(?:BEGIN|END)(?: RSA)? PRIVATE KEY-----|\s)/g, '');
    
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
  const base = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    console.error(`Supabase REST error: HTTP ${res.status} for ${path}`);
    return [];
  }
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

    try {
      const res = await fetch(fcmUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`FCM send error HTTP ${res.status}:`, errorText);
      }
    } catch (e) {
      console.error('FCM Transmission network error:', e);
    }
  }
}
