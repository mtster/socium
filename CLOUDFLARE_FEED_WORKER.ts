// CLOUDFLARE FEED WORKER (socium-feed-notifications)
// Designed for serverless trigger on inserts in public.feed_activity

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FIREBASE_DATABASE_URL: string;
  FIREBASE_ACCESS_TOKEN: string; // Firebase token or Google Auth service account
  FCM_PROJECT_ID: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Only POST allowed', { status: 405 });
    }

    try {
      const activity = await request.json() as any;
      const { activity_type, initiator_id, post_id, comment_id, connection_request_id, target_user_id } = activity;

      // 1. Fetch initiator's full profile info
      const initiatorProfile = await fetchSupabase(env, `/rest/v1/profiles?id=eq.${initiator_id}&select=*`);
      const initiator = initiatorProfile[0] || { full_name: 'Someone', username: 'someone' };
      const initiatorName = initiator.full_name || initiator.username || 'Someone';

      // 2. Identify target recipients, check muting, and notify
      let recipients: string[] = [];

      if (activity_type === 'post') {
        // Find all connections that have initiator added and HAVE NOT muted activities
        const connections = await fetchSupabase(
          env, 
          `/rest/v1/connections?connection_id=eq.${initiator_id}&is_activity_muted=eq.false&select=user_id`
        );
        recipients = connections.map((c: any) => c.user_id);
      } else if (target_user_id) {
        // For individual activities, check if recipient of the activity has muted initiator
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
        // Query Firebase RTDB presence and location
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
          // The client-side onValue listener handles the visual ring/vibe overlays and sound triggers.
        } else {
          // Case A: User is offline -> Update feed node, increment atomic unseen_chat_count, send FCM!
          await transactionIncrementFirebase(env, `/unseen_chat_count/${userId}.json`);

          // Fetch recipient push subscriptions
          const subscriptions = await fetchSupabase(
            env, 
            `/rest/v1/push_subscriptions?user_id=eq.${userId}&select=endpoint,auth_key,p256dh_key`
          );

          if (subscriptions && subscriptions.length > 0) {
            // Retrieve current unseen badge number
            const currentUnseenBadge = await fetchFirebase(env, `/unseen_chat_count/${userId}.json`) || 1;

            // Compile localized messaging content
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

            // Fire off FCM pushes
            const tokens = subscriptions.map((s: any) => s.endpoint);
            await sendFCMMessages(env, tokens, title, body, clickActionUrl, currentUnseenBadge);
          }
        }
      }

      return new Response(JSON.stringify({ status: 'ok', processed: recipients.length }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }
};

// --- Firebase Helper Functions ---

async function fetchFirebase(env: Env, path: string): Promise<any> {
  const url = `${env.FIREBASE_DATABASE_URL}${path}?access_token=${env.FIREBASE_ACCESS_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function updateFirebase(env: Env, path: string, bodyJson: string): Promise<void> {
  const url = `${env.FIREBASE_DATABASE_URL}${path}?access_token=${env.FIREBASE_ACCESS_TOKEN}`;
  await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: bodyJson
  });
}

async function transactionIncrementFirebase(env: Env, path: string): Promise<void> {
  const readUrl = `${env.FIREBASE_DATABASE_URL}${path}?access_token=${env.FIREBASE_ACCESS_TOKEN}`;
  const res = await fetch(readUrl);
  const current = res.ok ? (await res.json() || 0) : 0;
  
  await fetch(readUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(current + 1)
  });
}

// --- Supabase REST Helper Functions ---

async function fetchSupabase(env: Env, path: string): Promise<any> {
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
  env: Env, 
  tokens: string[], 
  title: string, 
  body: string, 
  url: string,
  badge: number
): Promise<void> {
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;
  
  for (const token of tokens) {
    const payload = {
      message: {
        token,
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
        'Authorization': `Bearer ${env.FIREBASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).catch(e => console.error('FCM Transmission error:', e));
  }
}
