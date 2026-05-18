import fs from 'fs';

let content = fs.readFileSync('SCHEMA.sql', 'utf8');

// 1. Policy update
content = content.replace(
  /CREATE POLICY "Admin or permitted members can update group chats" ON group_chats FOR UPDATE USING \([\s\S]*?\);/,
  `CREATE POLICY "Admin or permitted members can update group chats" ON group_chats FOR UPDATE USING (\n  auth.uid() = admin_id OR \n  (allow_member_edit = true AND id IN (SELECT chat_id FROM group_chat_participants WHERE user_id = auth.uid()))\n) WITH CHECK (\n  auth.uid() = admin_id OR \n  (allow_member_edit = true AND id IN (SELECT chat_id FROM group_chat_participants WHERE user_id = auth.uid()))\n);`
);

// 2. is_muted column
if (!content.includes('is_muted BOOLEAN DEFAULT false')) {
  // Add it before "created_at" in group_chat_participants
  content = content.replace(
    /user_id UUID REFERENCES public.profiles\(id\) ON DELETE CASCADE,[\r\n\s]+created_at TIMESTAMP/,
    `user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,\n  is_muted BOOLEAN DEFAULT false,\n  created_at TIMESTAMP`
  );
}

// 3. notify_cloudflare_worker
content = content.replace(
  /WHERE chat_id = NEW.group_chat_id AND user_id != NEW.sender_id;/,
  `WHERE chat_id = NEW.group_chat_id AND user_id != NEW.sender_id AND is_muted = false;`
);

fs.writeFileSync('SCHEMA.sql', content);
