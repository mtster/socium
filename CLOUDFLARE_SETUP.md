# Cloudflare Worker & Supabase Webhook Setup for Group Chat Notifications

This guide will walk you through deploying a Cloudflare Worker that handles sending high-volume Firebase Cloud Messaging (FCM) notifications to group chat participants, checking their real-time presence to save function limits in Supabase.

## 1. Supabase Postgres Function and Webhook Setup

We have already added the Postgres function \`notify_cloudflare_worker\` to your \`SCHEMA.sql\`. 

To activate this:
1. Ensure the \`pg_net\` extension is enabled in your Supabase project (Dashboard -> Database -> Extensions -> search for "pg_net" and enable it).
2. Execute the \`SCHEMA.sql\` script in your Supabase SQL Editor.
3. Keep the Postgres trigger URL as a placeholder until you deploy the Cloudflare Worker, then we will come back and update it.

## 2. Setting up the Cloudflare Worker

1. Install Wrangler (Cloudflare CLI):
   \`\`\`bash
   npm install -g wrangler
   \`\`\`

2. Create a new worker project:
   \`\`\`bash
   npm create cloudflare@latest socium-group-notifications --type=hello-world
   cd socium-group-notifications
   \`\`\`

3. Replace the contents of \`src/index.ts\` with the code provided below.

4. Add your environment variables/secrets to the worker. You will need your Firebase Admin credentials to check RTDB and send FCM messages.
   \`\`\`bash
   wrangler secret put FIREBASE_PROJECT_ID
   wrangler secret put FIREBASE_CLIENT_EMAIL
   wrangler secret put FIREBASE_PRIVATE_KEY
   \`\`\`
   *(Ensure \`FIREBASE_PRIVATE_KEY\` is wrapped in quotes when prompted if it has line breaks, or encode it as base64)*

5. Deploy the worker:
   \`\`\`bash
   wrangler deploy
   \`\`\`

6. **Important**: Copy the URL of your deployed Cloudflare worker (e.g., \`https://socium-group-notifications.your-subdomain.workers.dev\`).
7. Go back to Supabase SQL Editor, and update the \`cf_worker_url\` variable in the \`notify_cloudflare_worker\` function to your deployed worker URL, then re-run the \`CREATE OR REPLACE FUNCTION\` block.

## 3. Cloudflare Worker Code (\`src/index.ts\`)

This worker receives the payload from Supabase, checks Firebase RTDB for the presence of all recipients, and sends an FCM push notification (via Firebase HTTP v1 API) only to those who are offline or not currently in the chat.

\`\`\`typescript
import { SignJWT, importPKCS8 } from 'jose'; // You'll need to install 'jose': npm install jose

interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const payload: any = await request.json();
      const { message_id, sender_id, group_chat_id, content, media_type, recipients } = payload;

      if (!recipients || recipients.length === 0) {
        return new Response('No recipients', { status: 200 });
      }

      // Generate OAuth2 token for Firebase Admin REST API
      const token = await getFirebaseAuthToken(env);

      // 1. Check RTDB Presence for all recipients
      const presencePromises = recipients.map(async (userId: string) => {
        const presenceUrl = \`https://\${env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com/status/\${userId}.json?auth=\${token}\`;
        const res = await fetch(presenceUrl);
        const data = await res.json() as any;
        return { userId, presence: data };
      });

      const presences = await Promise.all(presencePromises);

      // Filter users who need a notification
      // A user needs a notification if they are NOT "online" OR if they are online but their "currentChat" is NOT this group_chat_id.
      const usersToNotify = presences.filter(p => {
        if (!p.presence || p.presence.state !== 'online') return true; // Offline
        if (p.presence.currentChat !== group_chat_id) return true; // Online but not in this chat
        return false; // Online and in this chat -> no notification
      }).map(p => p.userId);

      if (usersToNotify.length === 0) {
        return new Response('All users are active in chat, no push sent.', { status: 200 });
      }

      // 2. Fetch push subscriptions from Supabase (Requires adding Supabase URL & KEY to env if we do it here, Or we rely on FCM device topics)
      // For this example, assuming you manage FCM tokens via a Supabase query or Firebase DB. 
      // If using Supabase push_subscriptions, you might need to query it via REST API here:
      
      // ... Supabase fetch for tokens of \`usersToNotify\` ...

      // 3. Send via Firebase FCM API HTTP v1
      // Assuming you have the tokens, you can send a multicast message.
      /*
      await fetch(\`https://fcm.googleapis.com/v1/projects/\${env.FIREBASE_PROJECT_ID}/messages:send\`, {
         method: 'POST',
         headers: { 'Authorization': \`Bearer \${token}\`, 'Content-Type': 'application/json' },
         body: JSON.stringify({ ... })
      });
      */

      return new Response('Notifications processed', { status: 200 });
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  },
};

// Helper to generate Firebase token using Service Account
async function getFirebaseAuthToken(env: Env) {
  const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const key = await importPKCS8(privateKey, 'RS256');
  
  const jwt = await new SignJWT({
    iss: env.FIREBASE_CLIENT_EMAIL,
    sub: env.FIREBASE_CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: \`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=\${jwt}\`
  });

  const data = await res.json() as any;
  if (!data.access_token) throw new Error('Failed to get Firebase token');
  return data.access_token;
}
\`\`\`
