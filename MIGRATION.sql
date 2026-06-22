-- Feed Inbox Feature Database Migration
-- Execute this SQL script in your Supabase SQL Editor.

-- 1. Rename existing 'connections' table to 'connection_requests'
-- If 'connections' has constraints/indices, they will remain but be table-scoped.
ALTER TABLE IF EXISTS public.connections RENAME TO connection_requests;

-- Safely rename constraints on connection_requests to free up original index names
DO $$
BEGIN
  -- Rename Primary Key index if still named connections_pkey
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'connections_pkey' 
    AND conrelid = 'public.connection_requests'::regclass
  ) THEN
    ALTER TABLE public.connection_requests RENAME CONSTRAINT connections_pkey TO connection_requests_pkey;
  END IF;

  -- Rename unique key if still named connections_requester_id_receiver_id_key
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'connections_requester_id_receiver_id_key' 
    AND conrelid = 'public.connection_requests'::regclass
  ) THEN
    ALTER TABLE public.connection_requests RENAME CONSTRAINT connections_requester_id_receiver_id_key TO connection_requests_requester_id_receiver_id_key;
  END IF;
END $$;

-- Enable RLS for connection_requests
ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;

-- Recreate policies for connection_requests to match new naming
DROP POLICY IF EXISTS "Connection requests viewable by parties" ON public.connection_requests;
CREATE POLICY "Connection requests viewable by parties" ON public.connection_requests FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can request connection" ON public.connection_requests;
CREATE POLICY "Users can request connection" ON public.connection_requests FOR INSERT WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "Users can update connection status" ON public.connection_requests;
CREATE POLICY "Users can update connection status" ON public.connection_requests FOR UPDATE USING (auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Users can delete their connection requests" ON public.connection_requests;
CREATE POLICY "Users can delete their connection requests" ON public.connection_requests FOR DELETE USING (auth.uid() = requester_id OR auth.uid() = receiver_id);

-- 2. Create the new high-performance 'connections' table (bidirectional entries)
CREATE TABLE IF NOT EXISTS public.connections (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_activity_muted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT connections_pkey PRIMARY KEY (user_id, connection_id),
  CONSTRAINT connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT connections_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Migrate existing accepted connections bidirectionally
INSERT INTO public.connections (user_id, connection_id, created_at)
SELECT requester_id, receiver_id, created_at
FROM public.connection_requests
WHERE status = 'accepted'
ON CONFLICT (user_id, connection_id) DO NOTHING;

INSERT INTO public.connections (user_id, connection_id, created_at)
SELECT receiver_id, requester_id, created_at
FROM public.connection_requests
WHERE status = 'accepted'
ON CONFLICT (user_id, connection_id) DO NOTHING;

-- 3. Create 'feed_activity' table to track notifications
CREATE TABLE IF NOT EXISTS public.feed_activity (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_type TEXT CHECK (activity_type IN ('post', 'like', 'comment', 'connection_request')) NOT NULL,
  initiator_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  connection_request_id UUID REFERENCES public.connection_requests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Create 'seen_activities' table for transient tracking
CREATE TABLE IF NOT EXISTS public.seen_activities (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  activity_id UUID REFERENCES public.feed_activity(id) ON DELETE CASCADE NOT NULL,
  CONSTRAINT seen_activities_pkey PRIMARY KEY (user_id, activity_id)
);

-- 5. Add 'base_timestamp' to 'profiles' acting as high watermarked value
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS base_timestamp TIMESTAMPTZ DEFAULT NOW();

-- Enable RLS for new tables
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seen_activities ENABLE ROW LEVEL SECURITY;

-- 6. Setup Row-Level Security (RLS) Policies

-- Connections policies
DROP POLICY IF EXISTS "Connections viewable by everyone" ON public.connections;
CREATE POLICY "Connections viewable by everyone" ON public.connections FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own connections" ON public.connections;
CREATE POLICY "Users can insert own connections" ON public.connections FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own connections" ON public.connections;
CREATE POLICY "Users can update own connections" ON public.connections FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own connections" ON public.connections;
CREATE POLICY "Users can delete own connections" ON public.connections FOR DELETE USING (auth.uid() = user_id OR auth.uid() = connection_id);

-- Feed Activity policies
DROP POLICY IF EXISTS "Feed activities are viewable by authenticated users" ON public.feed_activity;
CREATE POLICY "Feed activities are viewable by authenticated users" ON public.feed_activity FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can insert feed activities" ON public.feed_activity;
CREATE POLICY "Anyone can insert feed activities" ON public.feed_activity FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can delete feed activities" ON public.feed_activity;
CREATE POLICY "Anyone can delete feed activities" ON public.feed_activity FOR DELETE USING (true);

-- Seen Activities policies
DROP POLICY IF EXISTS "Users can view own seen_activities" ON public.seen_activities;
CREATE POLICY "Users can view own seen_activities" ON public.seen_activities FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own seen_activities" ON public.seen_activities;
CREATE POLICY "Users can insert own seen_activities" ON public.seen_activities FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own seen_activities" ON public.seen_activities;
CREATE POLICY "Users can delete own seen_activities" ON public.seen_activities FOR DELETE USING (auth.uid() = user_id);

-- 7. Create database trigger function to alert the Cloudflare Worker about all activities
CREATE OR REPLACE FUNCTION public.notify_feed_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cf_worker_url TEXT := 'https://socium-feed-notifications.brare-black.workers.dev/';
  payload JSONB;
  target_user_id UUID;
  post_info RECORD;
BEGIN
  -- Determine target receiver uid if it's single recipient (like, comment, connection request)
  IF NEW.activity_type = 'connection_request' THEN
    SELECT receiver_id INTO target_user_id FROM public.connection_requests WHERE id = NEW.connection_request_id;
  ELSIF NEW.activity_type = 'like' THEN
    SELECT user_id INTO target_user_id FROM public.posts WHERE id = NEW.post_id;
  ELSIF NEW.activity_type = 'comment' THEN
    SELECT user_id INTO target_user_id FROM public.posts WHERE id = NEW.post_id;
  END IF;

  payload := jsonb_build_object(
    'id', NEW.id,
    'activity_type', NEW.activity_type,
    'initiator_id', NEW.initiator_id,
    'post_id', NEW.post_id,
    'comment_id', NEW.comment_id,
    'connection_request_id', NEW.connection_request_id,
    'created_at', NEW.created_at,
    'target_user_id', target_user_id
  );

  -- Invoke the outward HTTP pipeline to Cloudflare in real-time
  PERFORM net.http_post(
      url := cf_worker_url,
      body := payload
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_feed_worker ON public.feed_activity;
CREATE TRIGGER trigger_notify_feed_worker
AFTER INSERT ON public.feed_activity
FOR EACH ROW
EXECUTE FUNCTION public.notify_feed_worker();
