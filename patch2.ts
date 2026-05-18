import fs from 'fs';

let content = fs.readFileSync('SCHEMA.sql', 'utf8');

content = content.replace(
  /user_id UUID REFERENCES public.profiles\(id\) ON DELETE CASCADE,[\r\n\s]+last_read_at TIMESTAMPTZ/,
  `user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,\n  is_muted BOOLEAN DEFAULT false,\n  last_read_at TIMESTAMPTZ`
);
fs.writeFileSync('SCHEMA.sql', content);
