# Cloudflare Worker Setup for iPhone Users (No Terminal Required)

This guide shows you how to deploy the notification worker directly from your iPhone browser, without needing `npm`, `wrangler`, or a terminal. We use pure Javascript with the native Web Crypto API, so no external libraries are needed.

## Postgres Setup
Your Supabase `messages` table already has a trigger set up. Please copy the latest `CREATE OR REPLACE FUNCTION public.notify_cloudflare_worker()` from `SCHEMA.sql` and run it in the Supabase SQL editor to ensure your profile/group names get sent to Cloudflare! Also ensure `pg_net` is enabled if not already (`CREATE EXTENSION IF NOT EXISTS pg_net;`).

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
      
      if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY || !env.FIREBASE_DATABASE_URL) {
        throw new Error('Firebase environment variables are missing (Make sure FIREBASE_DATABASE_URL is set!)');
      }

      // 2. Generate JWT for Firebase REST API Authentication
      const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const jwtPayload = b64u(JSON.stringify({
        iss: env.FIREBASE_CLIENT_EMAIL,
        sub: env.FIREBASE_CLIENT_EMAIL,
        aud: 'https://oauth2.googleapis.com/token',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging'
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

      // 4. Group Payload Data
      const { message_id, sender_id, group_chat_id, content, recipient_tokens, sender_name, group_name } = payload;
      
      if (!recipient_tokens || recipient_tokens.length === 0) {
        return new Response('No recipients or tokens', { status: 200 });
      }

      let bodyText = content;
      if (!bodyText) {
         if (payload.media_type === 'image') bodyText = 'Sent an image';
         else if (payload.media_type === 'audio') bodyText = 'Sent a voice message';
         else if (payload.media_type === 'location') bodyText = 'Sent a location';
         else bodyText = 'Sent a media message';
      }

      // Firebase RTDB URL (must be provided via ENV and NO trailing slash)
      let dbUrl = env.FIREBASE_DATABASE_URL;
      if (dbUrl.endsWith('/')) {
         dbUrl = dbUrl.slice(0, -1);
      }

      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;
      let successCount = 0;

      // 5. Query Unread Counts & Send Pushes concurrently per user
      const pushOperations = recipient_tokens.map(async (recipient) => {
         const userId = recipient.userId;
         
         const [locResp, inboxResp, unseenResp, precResp] = await Promise.all([
            fetch(`${dbUrl}/location/${userId}.json?access_token=${access_token}`),
            fetch(`${dbUrl}/inboxes/${userId}/${group_chat_id}.json?access_token=${access_token}`),
            fetch(`${dbUrl}/unseen_chat_count/${userId}.json?access_token=${access_token}`),
            fetch(`${dbUrl}/global_presence/${userId}.json?access_token=${access_token}`)
         ]);

         const location = locResp.ok ? await locResp.json() : null;
         const inboxSeen = inboxResp.ok ? await inboxResp.json() : null;
         let badgeCount = (unseenResp.ok ? await unseenResp.json() : 0) || 0;
         const isOnline = precResp.ok ? await precResp.json() : false;

         let shouldSendNotification = false;

         // if the global presence of recipient is false
         if (!isOnline) {
             // 1. update the inbox node for that users uuid
             await fetch(`${dbUrl}/inboxes/${userId}/${group_chat_id}.json?access_token=${access_token}`, {
               method: 'PUT',
               body: 'false'
             });
             
             // 2. increment unseen chat count node for the recipient by +1 (only if inbox was not already false)
             if (inboxSeen !== false) {
                 badgeCount += 1;
                 await fetch(`${dbUrl}/unseen_chat_count/${userId}.json?access_token=${access_token}`, {
                   method: 'PUT',
                   body: String(badgeCount)
                 });
             }
             
             // 3. send notification payload
             shouldSendNotification = true;
         } 
         else if (isOnline && location !== group_chat_id) {
             // If global presence of recipient is true but location of the recipient is not the group chat uuid
             // it means they are browsing through the app.
             
             // 1. update the inbox node for that users uuid
             await fetch(`${dbUrl}/inboxes/${userId}/${group_chat_id}.json?access_token=${access_token}`, {
               method: 'PUT',
               body: 'false'
             });
             
             // 2. increment unseen chat count node for the recipient by +1 (if needed)
             if (inboxSeen !== false) {
                 badgeCount += 1;
                 await fetch(`${dbUrl}/unseen_chat_count/${userId}.json?access_token=${access_token}`, {
                   method: 'PUT',
                   body: String(badgeCount)
                 });
             }
             
             // No notification needed for users online looking at other parts of the app
             shouldSendNotification = false;
         }
         else if (isOnline && location === group_chat_id) {
             // If global presence of recipient is true and the location of that recipient is the same as the new messages chat uuid
             // nothing needs to be updated and no notification must be sent.
             shouldSendNotification = false;
         }

         if (shouldSendNotification) {
             // Determine title: "SenderName in GroupName"
             const title = `${sender_name || 'Someone'} in ${group_name || 'Group'}`;

             // Loop over each token for this user
             const tokenOperations = recipient.tokens.map(async (token) => {
               const messageBody = {
                 message: {
                   token: token,
                   notification: {
                     title: title,
                     body: bodyText
                   },
                   apns: {
                     payload: {
                       aps: {
                         badge: badgeCount
                       }
                     }
                   },
                   data: {
                     title: title,
                     body: bodyText,
                     url: `/?chatId=${group_chat_id}`,
                     senderId: group_chat_id || "",
                     badge: String(badgeCount)
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
             });
             
             await Promise.all(tokenOperations);
         }
      });

      await Promise.all(pushOperations);

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Data-only webhook processed',
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

7. Click **Save and deploy** in the corner.

## 2. Add Secrets/Variables in Cloudflare

1. Go back to your Worker's settings page (click its name in the breadcrumbs).
2. Go to **Settings** -> **Variables and Secrets**.
3. Add the Environmental Variables (**Secret** text type):
   * `FIREBASE_PROJECT_ID`
   * `FIREBASE_CLIENT_EMAIL` 
   * `FIREBASE_PRIVATE_KEY`
   * `FIREBASE_DATABASE_URL` (Get this from Firebase Console > Realtime Database)
4. Click Save.

## 3. Verify Supabase Extension
Go to your Supabase Dashboard -> Database -> Extensions and make sure `pg_net` is enabled. You no longer need to use Database Webhooks in the UI because the SQL trigger handles everything efficiently!
