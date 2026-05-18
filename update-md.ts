import fs from 'fs';
let content = fs.readFileSync('CLOUDFLARE_SETUP.md', 'utf8');
content = content.replace('senderId: group_chat_id || "",', 'groupChatId: group_chat_id || "",\n                      senderId: (payload.record ? payload.record.sender_id : payload.sender_id) || "",');
fs.writeFileSync('CLOUDFLARE_SETUP.md', content);
