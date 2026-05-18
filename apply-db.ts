import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runSQL() {
  const q1 = `
    ALTER TABLE public.group_chat_participants ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT false;
  `;
  const q2 = `
CREATE OR REPLACE FUNCTION public.notify_cloudflare_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cf_worker_url TEXT := 'https://socium-group-notifications.brare-black.workers.dev/';
  payload JSONB;
  recipients UUID[];
  fcm_tokens JSONB;
  sender_info RECORD;
  group_info RECORD;
BEGIN
  IF NEW.group_chat_id IS NOT NULL THEN
    SELECT array_agg(user_id) INTO recipients 
    FROM public.group_chat_participants 
    WHERE chat_id = NEW.group_chat_id 
      AND user_id != NEW.sender_id
      AND is_muted = false;
    
    IF recipients IS NOT NULL AND array_length(recipients, 1) > 0 THEN
      -- Fetch FCM tokens for the recipients grouped by user_id
      WITH user_tokens AS (
        SELECT user_id, array_agg(DISTINCT endpoint) as tokens
        FROM public.push_subscriptions
        WHERE user_id = ANY(recipients)
        GROUP BY user_id
      )
      SELECT jsonb_agg(
        jsonb_build_object('userId', user_id, 'tokens', tokens)
      ) INTO fcm_tokens
      FROM user_tokens;

      -- Fetch profile info
      SELECT full_name, username INTO sender_info FROM public.profiles WHERE id = NEW.sender_id;
      
      -- Fetch Group info
      SELECT name INTO group_info FROM public.group_chats WHERE id = NEW.group_chat_id;

      payload := jsonb_build_object(
        'message_id', NEW.id,
        'sender_id', NEW.sender_id,
        'sender_name', COALESCE(sender_info.full_name, sender_info.username, 'Someone'),
        'group_chat_id', NEW.group_chat_id,
        'group_name', COALESCE(group_info.name, 'Group Chat'),
        'content', NEW.content,
        'media_type', NEW.media_type,
        'recipient_tokens', fcm_tokens
      );
      
      -- Make the outward HTTP POST
      PERFORM net.http_post(
          url := cf_worker_url,
          body := payload,
          headers := '{"Content-Type": "application/json"}'::jsonb
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
  `;

  // We can't actually run q1 and q2 easily directly through client if rpc 'execute_sql' doesn't exist,
  // but wait... we can try to use a dummy fetch directly if it exists, or just tell the user if it fails.
  // We'll add this to SCHEMA.sql as well.
}
runSQL();
