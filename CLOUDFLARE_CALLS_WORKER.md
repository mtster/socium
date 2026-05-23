# Cloudflare CALLS Push Notification Worker

This Cloudflare Worker manages rhythmic calling notifications for offline PWA recipients. It implements Firebase RTDB polling inside a background loop to automatically adapt targets list dynamically, pruning active participants who have already **Accepted** or **Declined** the call.

## Worker Implementation

```javascript
// index.js (Cloudflare Worker)

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const payload = await request.json();
      const {
        call_id,
        caller_id,
        caller_name,
        caller_avatar,
        chat_room_id,
        type, // "audio" | "video"
        is_group,
        recipient_tokens
      } = payload;

      if (!call_id || !recipient_tokens || recipient_tokens.length === 0) {
        return new Response('Missing parameters', { status: 400 });
      }

      // Initialize access token or client configs for Firebase Cloud Messaging (FCM) v1
      const fcmAccessToken = await getFcmAccessToken(env);
      const firebaseDbUrl = env.FIREBASE_DATABASE_URL;

      // Launch the background execution context loop to make it non-blocking
      ctx.waitUntil(
        handleCallingNotificationLoop({
          call_id,
          caller_name,
          type,
          recipient_tokens,
          firebaseDbUrl,
          fcmAccessToken
        })
      );

      return new Response(JSON.stringify({ status: 'initiated', call_id }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }
};

/**
 * Executes a rhythmic ringing notification loop for offline devices
 */
async function handleCallingNotificationLoop({
  call_id,
  caller_name,
  type,
  recipient_tokens,
  firebaseDbUrl,
  fcmAccessToken
}) {
  const maxRings = 10; // Play ringtone pattern up to 10 strikes (approx 30s)
  const ringIntervalMs = 3000; // Strike every 3 seconds
  
  // Track remaining targets locally in the worker context
  let activeTargets = [...recipient_tokens];

  for (let ring = 0; ring < maxRings; ring++) {
    // 1. Poll the Firebase RTDB node to get participant real-time statuses
    const firebaseNodeUrl = `${firebaseDbUrl}/calls/${call_id}.json`;
    let callNode = null;
    
    try {
      const fResponse = await fetch(firebaseNodeUrl);
      if (fResponse.ok) {
        callNode = await fResponse.json();
      }
    } catch (e) {
      console.warn("RTDB poll connection failed:", e);
    }

    // 2. If call node is deleted or empty: stop notifications immediately
    if (!callNode) {
      console.log(`Call ${call_id} ended. Terminating worker notifications.`);
      break;
    }

    // 3. Keep target tokens only if their participant status is still "ringing"
    activeTargets = activeTargets.filter(target => {
      const dbParticipant = callNode.participants?.[target.userId];
      // If of recipient is not specified in the database node, or status changed to accepted/declined, drop them
      return dbParticipant && dbParticipant.status === 'ringing';
    });

    // 4. If there are no longer any active ringing recipients left: stop the loop
    if (activeTargets.length === 0) {
      console.log("No remaining ringing targets. Exiting notification loop.");
      break;
    }

    // 5. Build multicast FCM message payload
    const label = type === 'video' ? '🎥VIDEO CALL🎥' : '📞AUDIO CALL';
    
    for (const target of activeTargets) {
      for (const token of target.tokens) {
        try {
          // Send push notifications via FCM V1 endpoint
          await sendFcmPush(fcmAccessToken, token, {
            title: caller_name,
            body: label,
            tag: `call_${call_id}`,
            icon: '/icon-192.png',
            callId: call_id
          });
        } catch (pushError) {
          console.error(`FCM notification delivery error to target user:`, pushError);
        }
      }
    }

    // Synchronize pause before the next rhythmic chime strike
    await new Promise(resolve => setTimeout(resolve, ringIntervalMs));
  }
}

/**
 * Fires API request to FCM V1 gateway
 */
async function sendFcmPush(token, deviceToken, notification) {
  const url = `https://fcm.googleapis.com/v1/projects/${token.projectId}/messages:send`;
  
  const body = {
    message: {
      token: deviceToken,
      notification: {
        title: notification.title,
        body: notification.body
      },
      data: {
        click_action: '/',
        callId: notification.callId,
        tag: notification.tag
      },
      webpush: {
        headers: {
          Urgency: 'high'
        },
        notification: {
          tag: notification.tag,
          renotify: true,
          vibrate: [500, 200, 500],
          actions: [
            { action: 'answer', title: 'Answer' },
            { action: 'decline', title: 'Decline' }
          ]
        }
      }
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return res;
}

/**
 * Generates OAuth token for Firebase project using Service Account credential strings saved in environment secrets
 */
async function getFcmAccessToken(env) {
  // Leverages standard JSON web tokens (JWT) extraction matching Firebase credentials specs
  // identical to standard CF implementations.
  // ...
}
```

## Setup & Deployment instructions
1. Create a brand new Cloudflare Worker or update your existing request notifications worker.
2. Bind your Firebase configuration variables as Secrets (`FIREBASE_DATABASE_URL`).
3. Deploy the worker and declare the worker's URL in your application.
