-- ==============================================================================
-- POST VISIBILITY RULES ARCHITECTURE MIGRATION
-- Execute this script in your Supabase SQL Editor to migrate posts to the new
-- scalable visibility architecture.
-- ==============================================================================

-- 1. Safely add new columns: visibility_mode and audience
ALTER TABLE public.posts 
  ADD COLUMN IF NOT EXISTS visibility_mode TEXT DEFAULT 'all_connections' 
  CHECK (visibility_mode IN ('all_connections', 'allowed_list', 'except_list'));

ALTER TABLE public.posts 
  ADD COLUMN IF NOT EXISTS audience UUID[];

-- 2. Migrate legacy 'visible_to' data (if present) before dropping
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'posts' AND column_name = 'visible_to'
  ) THEN
    -- Any posts that had a non-empty visible_to are migrated to 'allowed_list'
    UPDATE public.posts 
    SET 
      audience = visible_to,
      visibility_mode = 'allowed_list'
    WHERE visible_to IS NOT NULL AND array_length(visible_to, 1) > 0;

    -- Drop the visible_to column and any associated indexes
    ALTER TABLE public.posts DROP COLUMN visible_to CASCADE;
  END IF;
END $$;

-- 3. Create high-performance indexes for visibility filtering
CREATE INDEX IF NOT EXISTS idx_posts_visibility_mode 
  ON public.posts (visibility_mode);

CREATE INDEX IF NOT EXISTS idx_posts_audience_gin 
  ON public.posts USING GIN (audience);

-- 4. Update Row-Level Security (RLS) Policy on posts
DROP POLICY IF EXISTS "Posts are viewable by everyone" ON public.posts;
DROP POLICY IF EXISTS "Posts are viewable by authorized audience" ON public.posts;

CREATE POLICY "Posts are viewable by authorized audience" ON public.posts 
FOR SELECT USING (
  -- 1. Author can always see their own post
  auth.uid() = user_id OR 
  -- 2. Admin can always see everything
  auth.uid() = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2'::UUID OR
  -- 3. Humor department bot posts bypass all restrictions
  user_id = '00000000-0000-0000-0000-000000000001'::UUID OR
  -- 4. Allowed list mode: user's UUID must be in audience
  (
    visibility_mode = 'allowed_list' AND
    audience IS NOT NULL AND
    auth.uid() = ANY(audience)
  ) OR
  -- 5. Except list mode: user must be connection AND not in audience
  (
    visibility_mode = 'except_list' AND
    (audience IS NULL OR NOT (auth.uid() = ANY(audience))) AND
    EXISTS (
      SELECT 1 FROM public.connections c 
      WHERE c.user_id = posts.user_id AND c.connection_id = auth.uid()
    )
  ) OR
  -- 6. All connections mode (default): user must be a connection of the author
  (
    (visibility_mode IS NULL OR visibility_mode = 'all_connections') AND
    EXISTS (
      SELECT 1 FROM public.connections c 
      WHERE c.user_id = posts.user_id AND c.connection_id = auth.uid()
    )
  )
);

-- 5. Update feed_activity RLS Policy so private posts are never visible to unauthorized users
DROP POLICY IF EXISTS "Feed activities are viewable by authenticated users" ON public.feed_activity;
DROP POLICY IF EXISTS "Feed activities are viewable by authorized users" ON public.feed_activity;
CREATE POLICY "Feed activities are viewable by authorized users" ON public.feed_activity FOR SELECT TO authenticated USING (
  initiator_id = auth.uid() OR
  post_id IS NULL OR
  EXISTS (
    SELECT 1 FROM public.posts p 
    WHERE p.id = feed_activity.post_id
  )
);

-- 6. Update notify_feed_worker function to pass visibility_mode and audience to Cloudflare Worker
CREATE OR REPLACE FUNCTION public.notify_feed_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cf_worker_url TEXT := 'https://socium-feed-notifications.brare-black.workers.dev/';
  webhook_secret TEXT;
  payload JSONB;
  target_user_id UUID;
  initiator_name TEXT;
  v_visibility_mode TEXT := 'all_connections';
  v_audience UUID[] := NULL;
BEGIN
  -- Retrieve secret from Supabase Vault
  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'WEBHOOK_SECRET_TOKEN'
  LIMIT 1;

  IF NEW.activity_type = 'connection_request' THEN
    SELECT receiver_id INTO target_user_id FROM public.connection_requests WHERE id = NEW.connection_request_id;
  ELSIF NEW.activity_type = 'like' THEN
    SELECT user_id INTO target_user_id FROM public.posts WHERE id = NEW.post_id;
  ELSIF NEW.activity_type = 'comment' THEN
    SELECT user_id INTO target_user_id FROM public.posts WHERE id = NEW.post_id;
  END IF;

  -- Fetch post visibility rules if linked to a post
  IF NEW.post_id IS NOT NULL THEN
    SELECT COALESCE(visibility_mode, 'all_connections'), audience 
    INTO v_visibility_mode, v_audience
    FROM public.posts WHERE id = NEW.post_id;
  END IF;

  -- Don't send if it's the user's own action (e.g. liking own post)
  IF target_user_id IS NOT NULL AND target_user_id = NEW.initiator_id THEN
    RETURN NEW;
  END IF;

  -- Fetch initiator name
  SELECT COALESCE(full_name, username, 'Someone') INTO initiator_name 
  FROM public.profiles 
  WHERE id = NEW.initiator_id;

  payload := jsonb_build_object(
    'id', NEW.id,
    'activity_type', NEW.activity_type,
    'initiator_id', NEW.initiator_id,
    'initiator_name', initiator_name,
    'post_id', NEW.post_id,
    'comment_id', NEW.comment_id,
    'connection_request_id', NEW.connection_request_id,
    'created_at', NEW.created_at,
    'target_user_id', target_user_id,
    'tagged_user_ids', NEW.tagged_user_ids,
    'visibility_mode', v_visibility_mode,
    'audience', v_audience
  );

  PERFORM net.http_post(
      url := cf_worker_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || webhook_secret
      ),
      body := payload
  );
  RETURN NEW;
END;
$$;
