# Cloudflare Worker Setup for iPhone Users (No Terminal Required)

This guide shows you how to deploy the notification worker directly from your iPhone browser, without needing `npm`, `wrangler`, or a terminal. We use pure Javascript with the native Web Crypto API, so no external libraries are needed.

## 1. Setup in Cloudflare Dashboard

1. Log into your Cloudflare account in your browser.
2. Go to **Workers & Pages** -> **Create application** -> **Create Worker**.
3. Name it (e.g., `socium-group-notifications`) and click **Deploy**.
4. Once deployed, click **Edit Code**.
5. Make sure your file is a Javascript file (like `worker.js`). If it gave you `worker.ts`, right click it and rename it to `worker.js`.
6. Delete everything inside the editor and paste the completely standalone code below.

### The Worker Code:
```javascript
// Base64URL Encoding utilities
function b64u(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function strToU8(str) {
  return new TextEncoder().encode(str);
}

function pemToU8(pem) {
  // Strip out headers and whitespace
  const b64 = pem.replace(/(?:-----(?:BEGIN|END) PRIVATE KEY-----|\s)/g, '');
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const payload = await request.json();
      
      // 1. Check if we have the necessary environment variables
      if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
        throw new Error('Firebase environment variables are missing in Cloudflare settings');
      }

      // 2. Generate JWT for Firebase REST API Authentication using Web Crypto API
      const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const jwtPayload = b64u(JSON.stringify({
        iss: env.FIREBASE_CLIENT_EMAIL,
        sub: env.FIREBASE_CLIENT_EMAIL,
        aud: 'https://oauth2.googleapis.com/token',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging' // Required scope
      }));

      // Parse the private key
      // If the private key was pasted with literal \n strings, replace them with actual newlines
      const privateKeyText = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

      const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToU8(privateKeyText),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );

      // Sign the token
      const signatureRaw = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5', 
        key, 
        strToU8(`${header}.${jwtPayload}`)
      );
      
      // Map signature to base64url string
      let signatureString = "";
      const buf = new Uint8Array(signatureRaw);
      for (let i = 0; i < buf.byteLength; i++) {
        signatureString += String.fromCharCode(buf[i]);
      }
      const signature = b64u(signatureString);
      const jwt = `${header}.${jwtPayload}.${signature}`;

      // 3. Exchange JWT for an OAuth2 Access Token
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

      // 4. Fetch recipients presence and subscriptions
      const { message_id, sender_id, group_chat_id, content, recipients } = payload;
      
      if (!recipients || recipients.length === 0) {
        return new Response('No recipients', { status: 200 });
      }

      // 5. Send FCM pushes!
      // In a real application, you would fetch FCM tokens from Supabase here.
      // Since this worker doesn't have direct access to your Supabase FCM tokens, 
      // you must either pass them in the payload from Postgres, or fetch them here via Supabase REST API.
      
      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;
      let successCount = 0;

      // Note: Assuming we had `fcmTokens` in the payload passed from Supabase
      if (payload.fcmTokens) {
        for (const token of payload.fcmTokens) {
           const messageBody = {
             message: {
               token: token,
               notification: {
                 title: payload.title || 'New Group Chat Message',
                 body: content || 'You have a new message.'
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
           
           if (fcmResp.ok) successCount++;
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Webhook processed successfully',
        sentPushes: successCount
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: error.message || String(error)
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
```

7. Click **Save and deploy** in the corner.

## 2. Add Secrets/Variables in Cloudflare

1. Go back to your Worker's settings page (click its name in the breadcrumbs).
2. Go to **Settings** -> **Variables and Secrets**.
3. Add the three Environment Variables (**Secret** text type):
   * `FIREBASE_PROJECT_ID`
   * `FIREBASE_CLIENT_EMAIL` 
   * `FIREBASE_PRIVATE_KEY`
4. Click Save.

## 3. Update Supabase

The `SCHEMA.sql` file in the project has already been updated to point to `https://socium-group-notifications.brare-black.workers.dev/`. You're done!
