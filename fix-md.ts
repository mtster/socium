import fs from 'fs';

let content = fs.readFileSync('CLOUDFLARE_SETUP.md', 'utf8');

const target = `         const [locResp, inboxResp, unseenResp, precResp, muteResp] = await Promise.all([
            fetch(\`\${dbUrl}/location/\${userId}.json?access_token=\${access_token}\`),
            fetch(\`\${dbUrl}/inboxes/\${userId}/\${group_chat_id}.json?access_token=\${access_token}\`),
            fetch(\`\${dbUrl}/unseen_chat_count/\${userId}.json?access_token=\${access_token}\`),
            fetch(\`\${dbUrl}/global_presence/\${userId}.json?access_token=\${access_token}\`),
            fetch(\`\${dbUrl}/muted_chats/\${userId}/\${group_chat_id}.json?access_token=\${access_token}\`)
         ]);

         if (!locResp.ok || !inboxResp.ok || !unseenResp.ok || !precResp.ok || !muteResp.ok) {
           throw new Error(\`RTDB fetch failed for user \${userId}\`);
         }

         const isMuted = await muteResp.json();
         if (isMuted) {
           // Skip everything if the chat is muted by this user
           return null;
         }`;

const replacement = `         const [locResp, inboxResp, unseenResp, precResp] = await Promise.all([
            fetch(\`\${dbUrl}/location/\${userId}.json?access_token=\${access_token}\`),
            fetch(\`\${dbUrl}/inboxes/\${userId}/\${group_chat_id}.json?access_token=\${access_token}\`),
            fetch(\`\${dbUrl}/unseen_chat_count/\${userId}.json?access_token=\${access_token}\`),
            fetch(\`\${dbUrl}/global_presence/\${userId}.json?access_token=\${access_token}\`)
         ]);

         if (!locResp.ok || !inboxResp.ok || !unseenResp.ok || !precResp.ok) {
           throw new Error(\`RTDB fetch failed for user \${userId}. loc:\${locResp.status} inbox:\${inboxResp.status} unseen:\${unseenResp.status} prec:\${precResp.status}\`);
         }`;

content = content.replace(target, replacement);

fs.writeFileSync('CLOUDFLARE_SETUP.md', content);
