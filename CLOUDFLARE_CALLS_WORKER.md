# Cloudflare CALLS Push Notification Worker

This Cloudflare Worker manages rhythmic calling notifications for offline PWA recipients. It implements Firebase RTDB polling inside a background loop to automatically adapt targets list dynamically, pruning active participants who have already **Accepted** or **Declined** the call.

It uses the built-in Web Crypto API to sign JWTs for OAuth 2.0 communication with FCM v1 natively, requiring **zero** external NPM packages.

---

## Worker Implementation

Create a file named `index.js` inside your Cloudflare Worker directory, and paste the following complete code:

```javascript
// index.js (Cloudflare Worker)

export default {
  async fetch(request, env, ctx) {
    // Add CORS preflight support
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Handle Cloudflare RealtimeKit Proxy Routes
    if (path.startsWith("/api/calls/")) {
      try {
        if (!env.REALTIMEKIT_APP_ID || !env.REALTIMEKIT_API_TOKEN) {
          return new Response(
            JSON.stringify({ error: "Missing required variables (REALTIMEKIT_APP_ID or REALTIMEKIT_API_TOKEN) inside Worker settings." }),
            { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
          );
        }

        const bodyText = await request.text();
        const attemptedUrls = [];
        let cfResponse = null;
        let resText = "";

        const doFetch = async (targetUrl) => {
          return await fetch(targetUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.REALTIMEKIT_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: bodyText,
          });
        };

        // 1. Try standard App-level WebRTC gateway (rtc.live.cloudflare.com)
        // This is the fastest and most standard Calls route, requiring the token to be the 64-char App Secret.
        let rtcUrl = "";
        if (path === "/api/calls/session") {
          rtcUrl = `https://rtc.live.cloudflare.com/v1/apps/${env.REALTIMEKIT_APP_ID}/sessions`;
        } else {
          const tracksMatch = path.match(/^\/api\/calls\/session\/([^\/]+)\/tracks\/new$/);
          const renegotiateMatch = path.match(/^\/api\/calls\/session\/([^\/]+)\/renegotiate$/);
          
          if (tracksMatch) {
            rtcUrl = `https://rtc.live.cloudflare.com/v1/apps/${env.REALTIMEKIT_APP_ID}/sessions/${tracksMatch[1]}/tracks/new`;
          } else if (renegotiateMatch) {
            rtcUrl = `https://rtc.live.cloudflare.com/v1/apps/${env.REALTIMEKIT_APP_ID}/sessions/${renegotiateMatch[1]}/renegotiate`;
          }
        }

        if (rtcUrl) {
          attemptedUrls.push({ type: "App-level Gateway (rtc.live.cloudflare.com)", url: rtcUrl });
          try {
            cfResponse = await doFetch(rtcUrl);
            resText = await cfResponse.text();
            if (cfResponse.ok) {
              return new Response(resText, {
                status: cfResponse.status,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                  "Access-Control-Allow-Headers": "Content-Type, Authorization",
                },
              });
            }
            console.warn(`rtc.live.cloudflare.com failed with status ${cfResponse.status}. Trying fallback...`);
          } catch (rtcErr) {
            console.warn(`rtc.live.cloudflare.com exception: ${rtcErr.message}. Trying fallback...`);
          }
        }

        // 2. Try Account-level Client v4 API fallback (api.cloudflare.com)
        // This works if REALTIMEKIT_API_TOKEN is a Cloudflare Client API token (and CLOUDFLARE_ACCOUNT_ID is provided).
        if (env.CLOUDFLARE_ACCOUNT_ID) {
          let v4Url = "";
          if (path === "/api/calls/session") {
            v4Url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/calls/apps/${env.REALTIMEKIT_APP_ID}/sessions`;
          } else {
            const tracksMatch = path.match(/^\/api\/calls\/session\/([^\/]+)\/tracks\/new$/);
            const renegotiateMatch = path.match(/^\/api\/calls\/session\/([^\/]+)\/renegotiate$/);
            
            if (tracksMatch) {
              v4Url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/calls/apps/${env.REALTIMEKIT_APP_ID}/sessions/${tracksMatch[1]}/tracks/new`;
            } else if (renegotiateMatch) {
              v4Url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/calls/apps/${env.REALTIMEKIT_APP_ID}/sessions/${renegotiateMatch[1]}/renegotiate`;
            }
          }

          if (v4Url) {
            attemptedUrls.push({ type: "Account-level client v4 API (api.cloudflare.com)", url: v4Url });
            try {
              cfResponse = await doFetch(v4Url);
              resText = await cfResponse.text();
              if (cfResponse.ok) {
                return new Response(resText, {
                  status: cfResponse.status,
                  headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                  },
                });
              }
            } catch (v4Err) {
              console.error(`api.cloudflare.com exception: ${v4Err.message}`);
            }
          }
        }

        // Return diagnostic error response if both pathways failed
        return new Response(
          JSON.stringify({
            success: false,
            error: "All Cloudflare WebRTC connection pathways failed.",
            attempted_endpoints: attemptedUrls,
            last_failed_status_code: cfResponse ? cfResponse.status : 500,
            last_failed_response: resText || "No response received",
          }),
          {
            status: cfResponse ? cfResponse.status : 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Headers": "Content-Type, Authorization",
            }
          }
        );

      } catch (proxyErr) {
        return new Response(JSON.stringify({ error: proxyErr.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

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
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } catch (err) {
      return new Response(err.message, { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*'
        }
      });
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
    const firebaseNodeUrl = `${firebaseDbUrl}/calls/${call_id}.json?access_token=${fcmAccessToken.accessToken}`;
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
      // If recipient is not specified in the database node, or status changed to accepted/declined, drop them
      return dbParticipant && dbParticipant.status === 'ringing';
    });

    // 4. If there are no longer any active ringing recipients left: stop the loop
    if (activeTargets.length === 0) {
      console.log("No remaining ringing targets. Exiting notification loop.");
      break;
    }

    // 5. Build multicast FCM message payload
    const bodyLabel = type === 'video' ? '🎥🎥🎥Video Call🎥🎥🎥' : '📞📞📞Audio Call📞📞📞';
    
    for (const target of activeTargets) {
      // Query global_presence status for this user in real-time
      let isOnline = false;
      try {
        const presenceUrl = `${firebaseDbUrl}/global_presence/${target.userId}.json?access_token=${fcmAccessToken.accessToken}`;
        const presRes = await fetch(presenceUrl);
        if (presRes.ok) {
          const val = await presRes.json();
          isOnline = val === true;
        }
      } catch (presErr) {
        console.warn(`Presence query failed for target user ID ${target.userId}:`, presErr);
      }

      if (isOnline) {
        console.log(`User ${target.userId} is active online in RTDB. Skipping notification chimes.`);
        continue;
      }

      for (const token of target.tokens) {
        try {
          // Send push notifications via FCM V1 endpoint
          await sendFcmPush(fcmAccessToken, token, {
            title: caller_name,
            body: bodyLabel,
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
 * This contains full native cryptographic signature implementation using Web Crypto API.
 */
async function getFcmAccessToken(env) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const clientEmail = sa.client_email;
  const privateKeyPem = sa.private_key;
  const projectId = sa.project_id;

  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const base64UrlEncode = (str) => {
    const base64 = btoa(unescape(encodeURIComponent(str)));
    return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const claimSetB64 = base64UrlEncode(JSON.stringify(claimSet));
  const signatureInput = `${headerB64}.${claimSetB64}`;

  // Process the PEM private key to clear formatting lines
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = privateKeyPem
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\s/g, "");
  
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' }
    },
    false,
    ['sign']
  );

  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    encoder.encode(signatureInput)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const assertion = `${signatureInput}.${signatureB64}`;

  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to exchange JWT for FCM Token: ${errText}`);
  }

  const tokenData = await res.json();
  return {
    accessToken: tokenData.access_token,
    projectId: projectId
  };
}
```

---

## Detailed Cloudflare Dashboard Setup Instructions

To enable pushing call alerts, you must bind two environment variables in your Cloudflare dashboard settings for the `socium-call-notifications` worker:

### 1. Register Environment Secrets

1. Go to the **Cloudflare Dashboard** -> **Workers & Pages** -> Select your Worker (`socium-call-notifications`).
2. Go to the **Settings** tab -> **Variables** (or **Environment Variables** in some profiles) section.
3. Scroll down to **Environment Variables** and click click **Add Variable** (or **Add secret**).
4. Define the following two environment variables:

   * **`FIREBASE_DATABASE_URL`** (type: *Variable*)
     * **Value:** Your Firebase Realtime Database URL.
     * **Example:** `https://socium-app-default-rtdb.firebaseio.com` (Do NOT include a trailing slash).

   * **`FIREBASE_SERVICE_ACCOUNT_JSON`** (type: *Secret*)
     * **Value:** The **entire** JSON string contents of your Google Service Account credential file.
     * *How to get this file:*
       1. Open your **Firebase Console**.
       2. Click the gear icon next to **Project Overview** in the left menu, then select **Project Settings**.
       3. Go to the **Service Accounts** tab.
       4. Click **Generate new private key** (and confirm by clicking **Generate key** in the modal).
       5. A `.json` file will download to your computer containing the credentials.
       6. Open that file in a text editor (Notepad, VS Code, text-edit), copy the **entire contents** (curly braces and everything inside), and paste it directly as the value of `FIREBASE_SERVICE_ACCOUNT_JSON` in Cloudflare's settings.
       7. **Make sure to save it safely as a Secret** so it remains fully encrypted on Cloudflare's edge servers.

5. Click **Save and Deploy** on Cloudflare to save modifications.
