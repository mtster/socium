# Cloudflare Worker for Connection (Friend) Requests Notifications

You can deploy this separate Cloudflare Worker specifically to handle push notifications for incoming connection requests.

## How to Set Up

1. Create a **new** Cloudflare Worker in your Cloudflare dashboard (e.g., named `socium-request-notifications`).
2. Paste the JavaScript code below into the Worker's editor.
3. Set the following **Environment Variables** in your Cloudflare Worker Settings (under **Settings** -> **Variables**):
   - `FIREBASE_PROJECT_ID`: Your Firebase project ID.
   - `FIREBASE_CLIENT_EMAIL`: Your Firebase Service Account client email.
   - `FIREBASE_PRIVATE_KEY`: Your Firebase Service Account private key (replace literal `\\n` with real line breaks if needed).
4. Run the SQL trigger definition below in your Supabase SQL Editor to link Connection inserts to your Worker!

---

## SQL Database Trigger Setup

Run this in your **Supabase Web SQL Editor**:

```sql
-- Cloudflare Worker Request Webhook Setup
CREATE OR REPLACE FUNCTION public.notify_connection_request_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cf_worker_url TEXT := 'https://your-request-worker.yourdomain.workers.dev/'; -- REPLACE WITH YOUR DEPLOYED CLOUDFLARE WORKER URL
  payload JSONB;
  fcm_tokens JSONB;
  sender_info RECORD;
BEGIN
  -- We only notify when a connection is 'pending' (a new request sent)
  IF NEW.status = 'pending' THEN
    -- Fetch recipient tokens from public.push_subscriptions
    WITH user_tokens AS (
      SELECT user_id, array_agg(DISTINCT endpoint) as tokens
      FROM public.push_subscriptions
      WHERE user_id = NEW.receiver_id
      GROUP BY user_id
    )
    SELECT jsonb_agg(
      jsonb_build_object('userId', user_id, 'tokens', tokens)
    ) INTO fcm_tokens
    FROM user_tokens;

    -- Fetch the requester's profile info (for the push notification body)
    SELECT full_name, username INTO sender_info FROM public.profiles WHERE id = NEW.requester_id;

    IF fcm_tokens IS NOT NULL AND jsonb_array_length(fcm_tokens) > 0 THEN
      payload := jsonb_build_object(
        'connection_id', NEW.id,
        'requester_id', NEW.requester_id,
        'receiver_id', NEW.receiver_id,
        'sender_name', COALESCE(sender_info.full_name, sender_info.username, 'Someone'),
        'recipient_tokens', fcm_tokens
      );

      -- Fire and forget HTTP POST
      PERFORM net.http_post(
          url := cf_worker_url,
          body := payload
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_connection_request ON public.connections;
CREATE TRIGGER trigger_notify_connection_request
AFTER INSERT ON public.connections
FOR EACH ROW
EXECUTE FUNCTION public.notify_connection_request_worker();
```

---

## Cloudflare Worker Code

```javascript
// Base64URL Encoding utilities
function b64u(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function strToU8(str) {
  return new TextEncoder().encode(str);
}

function pemToU8(pem) {
  const b64 = pem.replace(/(?:-----(?:BEGIN|END) PRIVATE KEY-----|\s)/g, '');
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export default {
  async fetch(request, env, ctx) {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const payload = await request.json();
      
      if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
        throw new Error('Firebase environment variables are missing (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)');
      }

      // 1. Generate JWT for GCP / Firebase OAuth API Authentication
      const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const jwtPayload = b64u(JSON.stringify({
        iss: env.FIREBASE_CLIENT_EMAIL,
        sub: env.FIREBASE_CLIENT_EMAIL,
        aud: 'https://oauth2.googleapis.com/token',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        scope: 'https://www.googleapis.com/auth/firebase.messaging'
      }));

      const privateKeyText = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

      const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToU8(privateKeyText),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const signatureRaw = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5', 
        key, 
        strToU8(`${header}.${jwtPayload}`)
      );
      
      let signatureString = "";
      const buf = new Uint8Array(signatureRaw);
      for (let i = 0; i < buf.byteLength; i++) {
        signatureString += String.fromCharCode(buf[i]);
      }
      const signature = b64u(signatureString);
      const jwt = `${header}.${jwtPayload}.${signature}`;

      // 2. Exchange JWT for an OAuth2 Access Token
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt
        })
      });

      if (!tokenResp.ok) {
        const errorText = await tokenResp.text();
        throw new Error(`Failed to get OAuth token: ${errorText}`);
      }

      const { access_token } = await tokenResp.json();

      // 3. Extract payload connection elements
      const { connection_id, requester_id, receiver_id, sender_name, recipient_tokens } = payload;
      
      if (!recipient_tokens || recipient_tokens.length === 0) {
        return new Response('No recipients or tokens present to notify', { status: 200 });
      }

      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;
      let successCount = 0;

      // 4. Concurrently send push requests for tokens
      const pushOperations = recipient_tokens.map(async (recipient) => {
        const tokenOperations = recipient.tokens.map(async (token) => {
          const messageBody = {
            message: {
              token: token,
              notification: {
                title: 'Connection Request',
                body: `${sender_name || 'Someone'} wants to connect with you`
              },
              data: {
                title: 'Connection Request',
                body: `${sender_name || 'Someone'} wants to connect with you`,
                url: '/?tab=profile',
                requesterId: requester_id || ""
              }
            }
          };

          const fcmResp = await fetch(fcmUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(messageBody)
          });
          
          if (fcmResp.ok) {
            successCount++;
          } else {
            console.error(`FCM direct send failed for connection request: ${await fcmResp.text()}`);
          }
        });
        
        await Promise.all(tokenOperations);
      });

      await Promise.all(pushOperations);

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Connection request notifications delivered',
        sentPushes: successCount
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: error.message || String(error) }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
```
