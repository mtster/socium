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
        // FIXED: Added userinfo.email scope required for valid REST token routing mapping
        scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/userinfo.email'
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
         try {
             const [locResp, inboxResp, precResp] = await Promise.all([
                fetch(`${dbUrl}/location/${userId}.json?access_token=${access_token}`),
                fetch(`${dbUrl}/inboxes/${userId}/${group_chat_id}.json?access_token=${access_token}`),
                fetch(`${dbUrl}/global_presence/${userId}.json?access_token=${access_token}`)
             ]);

             if (!locResp.ok || !inboxResp.ok || !precResp.ok) {
               console.error(`RTDB fetch failed for user ${userId}. loc:${locResp.status} inbox:${inboxResp.status} prec:${precResp.status}`);
               return;
             }

             const location = await locResp.json();
             const inboxSeen = await inboxResp.json();
             const isOnline = (await precResp.json()) === true;

             let shouldSendNotification = false;

             // Scenario C: If recipient is online and in the exact same chat room
             if (isOnline && location === group_chat_id) {
                  // Already looking at the chat room, do nothing
                  shouldSendNotification = false;
             }
             // Scenario B: If recipient is online but looking at a DIFFERENT chat room or dashboard area
             else if (isOnline && location !== group_chat_id) {
                  // 1. update the inbox node for that user's uuid
                  await fetch(`${dbUrl}/inboxes/${userId}/${group_chat_id}.json?access_token=${access_token}`, {
                    method: 'PUT',
                    body: 'false'
                  });
                  
                  // 2. increment unseen chat count node for the recipient by +1 atomically
                  if (inboxSeen !== false) {
                      await fetch(`${dbUrl}/unseen_chat_count/${userId}.json?access_token=${access_token}`, {
                        method: 'POST',
                        headers: { 'X-HTTP-Method-Override': 'PATCH', 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ".sv": { "increment": 1 } })
                      });
                  }
                  shouldSendNotification = false; // Do not send push notification if user is online in app
             }
             // Scenario A: If the global presence of recipient is false (completely offline)
             else {
                  // 1. update the inbox node for that user's uuid
                  await fetch(`${dbUrl}/inboxes/${userId}/${group_chat_id}.json?access_token=${access_token}`, {
                    method: 'PUT',
                    body: 'false'
                  });
                  
                  // 2. increment unseen chat count node for the recipient by +1 atomically (only if inbox was not already false)
                  if (inboxSeen !== false) {
                      await fetch(`${dbUrl}/unseen_chat_count/${userId}.json?access_token=${access_token}`, {
                        method: 'POST',
                        headers: { 'X-HTTP-Method-Override': 'PATCH', 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ".sv": { "increment": 1 } })
                      });
                  }
                  
                  // 3. send notification payload
                  shouldSendNotification = true;
             }

             if (shouldSendNotification) {
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
                              // We omit badge because different recipients have different badges.
                              // The service worker on each client's device will fetch their precise badge.
                              sound: 'default'
                            }
                          }
                        },
                        data: {
                          title: title,
                          body: bodyText,
                          url: `/?chatId=${group_chat_id}`,
                          groupChatId: group_chat_id || "",
                          senderId: (payload.record ? payload.record.sender_id : payload.sender_id) || ""
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
         } catch (userErr) {
             console.error(`Failed to process pushes for user ID ${userId}:`, userErr);
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
