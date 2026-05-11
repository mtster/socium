import fs from 'fs';
let content = fs.readFileSync('src/components/Chat.tsx', 'utf-8');
content = content.replace(/select-none \[user-select:none\] \[-webkit-user-select:none\]/, 'select-none [-webkit-touch-callout:none] [user-select:none] [-webkit-user-select:none] [-webkit-user-drag:none]');
fs.writeFileSync('src/components/Chat.tsx', content);
