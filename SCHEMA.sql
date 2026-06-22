-- Socium Database Schema (Safe Version)

-- Profiles table (Creates only if missing)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Safely add columns in case the 'profiles' table already existed but was missing them
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Posts table
CREATE TABLE IF NOT EXISTS posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  image_url TEXT, -- Made optional for text-only posts
  caption TEXT,
  visible_to UUID[], -- Restricted audience
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Safely alter columns if table already exists
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='posts' AND column_name='visible_to') THEN 
    ALTER TABLE posts ADD COLUMN visible_to UUID[];
  END IF;
  ALTER TABLE posts ALTER COLUMN image_url DROP NOT NULL;
END $$;

-- Likes table
CREATE TABLE IF NOT EXISTS likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Connection Requests
CREATE TABLE IF NOT EXISTS connection_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  is_seen BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(requester_id, receiver_id)
);

-- Connections (Bidirectional entries for accepted friendships)
CREATE TABLE IF NOT EXISTS connections (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_activity_muted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT connections_pkey PRIMARY KEY (user_id, connection_id)
);

-- RLS Policies Setup
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT,
  media_url TEXT,
  media_type TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  p256dh_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (
  auth.uid() = id OR 
  (auth.uid() = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2' AND id = '00000000-0000-0000-0000-000000000001')
);

-- Posts Policies
DROP POLICY IF EXISTS "Posts are viewable by everyone" ON posts;
DROP POLICY IF EXISTS "Posts are viewable by authorized audience" ON posts;
CREATE POLICY "Posts are viewable by authorized audience" ON posts FOR SELECT USING (
  auth.uid() = user_id OR 
  visible_to IS NULL OR 
  auth.uid() = ANY(visible_to)
);

DROP POLICY IF EXISTS "Users can insert own posts" ON posts;
CREATE POLICY "Users can insert own posts" ON posts FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own posts" ON posts;
CREATE POLICY "Users can update own posts" ON posts FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own posts" ON posts;
CREATE POLICY "Users can delete own posts" ON posts FOR DELETE USING (auth.uid() = user_id);

-- Likes Policies
DROP POLICY IF EXISTS "Likes are viewable by everyone" ON likes;
CREATE POLICY "Likes are viewable by everyone" ON likes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own likes" ON likes;
CREATE POLICY "Users can insert own likes" ON likes FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own likes" ON likes;
CREATE POLICY "Users can delete own likes" ON likes FOR DELETE USING (auth.uid() = user_id);

-- Comments Policies
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON comments;
CREATE POLICY "Comments are viewable by everyone" ON comments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own comments" ON comments;
CREATE POLICY "Users can insert own comments" ON comments FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own comments" ON comments;
CREATE POLICY "Users can delete own comments" ON comments FOR DELETE USING (auth.uid() = user_id);

-- Connection Requests Policies
DROP POLICY IF EXISTS "Connection requests viewable by parties" ON connection_requests;
CREATE POLICY "Connection requests viewable by parties" ON connection_requests FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can request connection" ON connection_requests;
CREATE POLICY "Users can request connection" ON connection_requests FOR INSERT WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "Users can update connection status" ON connection_requests;
CREATE POLICY "Users can update connection status" ON connection_requests FOR UPDATE USING (auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Users can delete their connection requests" ON connection_requests;
CREATE POLICY "Users can delete their connection requests" ON connection_requests FOR DELETE USING (auth.uid() = requester_id OR auth.uid() = receiver_id);

-- Messages policies
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='media_url') THEN 
    ALTER TABLE messages ADD COLUMN media_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='media_type') THEN 
    ALTER TABLE messages ADD COLUMN media_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='metadata') THEN 
    ALTER TABLE messages ADD COLUMN metadata JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='group_chat_id') THEN 
    ALTER TABLE messages ADD COLUMN group_chat_id UUID;
  END IF;
  ALTER TABLE messages ALTER COLUMN content DROP NOT NULL;
  ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
  ALTER TABLE messages ALTER COLUMN receiver_id DROP NOT NULL;
  ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_media_type_check;
END $$;

DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='connections' AND column_name='is_seen') THEN 
    ALTER TABLE connections ADD COLUMN is_seen BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Group Chats Table
CREATE TABLE IF NOT EXISTS group_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  avatar_url TEXT,
  admin_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  allow_member_edit BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Group Chat Participants
CREATE TABLE IF NOT EXISTS group_chat_participants (
  chat_id UUID REFERENCES group_chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_muted BOOLEAN DEFAULT false,
  last_read_at TIMESTAMPTZ DEFAULT now(),
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(chat_id, user_id)
);

DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='group_chat_participants' AND column_name='is_muted') THEN 
    ALTER TABLE group_chat_participants ADD COLUMN is_muted BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Foreign Key for messages->group_chat_id (delayed to avoid cross-dependency if we re-order, but fine here)
DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name='messages_group_chat_id_fkey'
  ) THEN 
    ALTER TABLE messages ADD CONSTRAINT messages_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES group_chats(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE group_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_chat_participants ENABLE ROW LEVEL SECURITY;

-- Group chats policies
DROP POLICY IF EXISTS "Participants can view group chats" ON group_chats;
CREATE POLICY "Participants can view group chats" ON group_chats FOR SELECT USING (
  -- Using a subquery instead of a direct self-referencing check or simply relying on admin_id
  auth.uid() = admin_id OR 
  id IN (SELECT chat_id FROM group_chat_participants WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can create group chats" ON group_chats;
CREATE POLICY "Users can create group chats" ON group_chats FOR INSERT WITH CHECK (auth.uid() = admin_id);

DROP POLICY IF EXISTS "Admin or permitted members can update group chats" ON group_chats;
CREATE POLICY "Admin or permitted members can update group chats" ON group_chats FOR UPDATE USING (
  auth.uid() = admin_id OR 
  (allow_member_edit = true AND id IN (SELECT chat_id FROM group_chat_participants WHERE user_id = auth.uid()))
) WITH CHECK (
  auth.uid() = admin_id OR 
  (allow_member_edit = true AND id IN (SELECT chat_id FROM group_chat_participants WHERE user_id = auth.uid()))
);

DROP POLICY IF EXISTS "Admin can delete group chats" ON group_chats;
CREATE POLICY "Admin can delete group chats" ON group_chats FOR DELETE USING (auth.uid() = admin_id);

-- Group chat participants policies
-- NOTE: We use true here for simplicity to avoid infinite recursion, since chat_id is unguessable (UUID)
DROP POLICY IF EXISTS "Participants can view other participants" ON group_chat_participants;
CREATE POLICY "Participants can view other participants" ON group_chat_participants FOR SELECT USING (true);

-- Helper to check if group admin (bypasses RLS to avoid infinite recursion)
CREATE OR REPLACE FUNCTION public.is_group_admin(check_chat_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_chats WHERE id = check_chat_id AND admin_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "Users can insert participants" ON group_chat_participants;
CREATE POLICY "Users can insert participants" ON group_chat_participants FOR INSERT WITH CHECK (
  public.is_group_admin(chat_id) OR
  user_id = auth.uid() -- A user can insert themselves (creating chat) or admin can insert
);

DROP POLICY IF EXISTS "Users can update own participant record" ON group_chat_participants;
CREATE POLICY "Users can update own participant record" ON group_chat_participants FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admin or self can delete participant" ON group_chat_participants;
CREATE POLICY "Admin or self can delete participant" ON group_chat_participants FOR DELETE USING (
  user_id = auth.uid() OR
  public.is_group_admin(chat_id)
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their messages" ON messages;
CREATE POLICY "Users can read their messages" ON messages FOR SELECT USING (
  auth.uid() = sender_id OR 
  auth.uid() = receiver_id OR 
  EXISTS (SELECT 1 FROM group_chat_participants WHERE chat_id = messages.group_chat_id AND user_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can send messages" ON messages;
CREATE POLICY "Users can send messages" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Users can update their messages" ON messages;
CREATE POLICY "Users can update their messages" ON messages FOR UPDATE USING (auth.uid() = receiver_id); -- For read receipts (only DMs)

DROP POLICY IF EXISTS "Users can delete their messages" ON messages;
CREATE POLICY "Users can delete their messages" ON messages FOR DELETE USING (auth.uid() = sender_id);

-- Cloudflare Worker Webhook Setup
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
    WHERE chat_id = NEW.group_chat_id AND user_id != NEW.sender_id AND COALESCE(is_muted, false) = false;
    
    IF recipients IS NOT NULL AND array_length(recipients, 1) > 0 THEN
      -- Fetch FCM tokens for all recipients (if subscriber exists, left join, otherwise empty array)
      WITH user_tokens AS (
        SELECT user_id, array_agg(DISTINCT endpoint) FILTER (WHERE endpoint IS NOT NULL) as tokens
        FROM public.push_subscriptions
        WHERE user_id = ANY(recipients)
        GROUP BY user_id
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'userId', r.id,
          'tokens', COALESCE(ut.tokens, ARRAY[]::TEXT[])
        )
      ) INTO fcm_tokens
      FROM unnest(recipients) as r(id)
      LEFT JOIN user_tokens ut ON ut.user_id = r.id;

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
          body := payload
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_cloudflare_worker ON public.messages;
CREATE TRIGGER trigger_notify_cloudflare_worker
AFTER INSERT ON public.messages
FOR EACH ROW
WHEN (NEW.group_chat_id IS NOT NULL)
EXECUTE FUNCTION public.notify_cloudflare_worker();

-- Push subscriptions policies
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their subscriptions" ON push_subscriptions;
CREATE POLICY "Users can manage their subscriptions" ON push_subscriptions FOR ALL USING (auth.uid() = user_id);

-- Realtime Setup
-- ==========================================
-- BEGIN REALTIME CONFIGURATION
-- We need to ensure that the logical replication publication "supabase_realtime" exists and has "messages" in it.
do $$ 
begin 
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then 
    create publication supabase_realtime; 
  end if; 
  
  -- Prevent "already member of publication" error
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
    and schemaname = 'public' 
    and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;

-- ==========================================
-- SUPABASE STORAGE SETUP
-- ==========================================
-- 1. Create the 'avatars' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true) 
ON CONFLICT (id) DO NOTHING;

-- 2. Storage Policies
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects FOR SELECT
USING ( bucket_id = 'avatars' );

DROP POLICY IF EXISTS "Users can upload their own avatars" ON storage.objects;
CREATE POLICY "Users can upload their own avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can update their own avatars" ON storage.objects;
CREATE POLICY "Users can update their own avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars' AND
  (storage.foldername(name))[1] = auth.uid()::text
);


-- ==========================================
-- CHAT VAULT SYSTEM
-- ==========================================
-- Vault Messages Table
CREATE TABLE IF NOT EXISTS public.vault_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  added_by UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  UNIQUE(message_id)
);

ALTER TABLE public.vault_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read vault messages in their chats" ON public.vault_messages;
CREATE POLICY "Users can read vault messages in their chats" ON public.vault_messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.messages m 
    WHERE m.id = vault_messages.message_id 
    AND (
      m.sender_id = auth.uid() 
      OR m.receiver_id = auth.uid() 
      OR m.group_chat_id IN (
        SELECT chat_id FROM public.group_chat_participants WHERE user_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS "Users can add vault messages in their chats" ON public.vault_messages;
CREATE POLICY "Users can add vault messages in their chats" ON public.vault_messages FOR INSERT WITH CHECK (
  auth.uid() = added_by AND
  EXISTS (
    SELECT 1 FROM public.messages m 
    WHERE m.id = message_id 
    AND (
      m.sender_id = auth.uid() 
      OR m.receiver_id = auth.uid() 
      OR m.group_chat_id IN (
        SELECT chat_id FROM public.group_chat_participants WHERE user_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS "Users can delete vault messages in their chats" ON public.vault_messages;
CREATE POLICY "Users can delete vault messages in their chats" ON public.vault_messages FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.messages m 
    WHERE m.id = vault_messages.message_id 
    AND (
      m.sender_id = auth.uid() 
      OR m.receiver_id = auth.uid() 
      OR m.group_chat_id IN (
        SELECT chat_id FROM public.group_chat_participants WHERE user_id = auth.uid()
      )
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_vault_message_id ON public.vault_messages(message_id);

-- ==========================================
-- REALTIME FOR VAULT
-- ==========================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
    and schemaname = 'public' 
    and tablename = 'vault_messages'
  ) then
    alter publication supabase_realtime add table vault_messages;
  end if;
end $$;


-- ==========================================
-- FEED INBOX SYSTEM
-- ==========================================

CREATE TABLE IF NOT EXISTS public.feed_activity (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_type TEXT CHECK (activity_type IN ('post', 'like', 'comment', 'connection_request')) NOT NULL,
  initiator_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  connection_request_id UUID REFERENCES public.connection_requests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.seen_activities (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  activity_id UUID REFERENCES public.feed_activity(id) ON DELETE CASCADE NOT NULL,
  CONSTRAINT seen_activities_pkey PRIMARY KEY (user_id, activity_id)
);

-- Ensure profiles is enhanced
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS base_timestamp TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seen_activities ENABLE ROW LEVEL SECURITY;

-- Setup RLS Policies for Feed Inbox
DROP POLICY IF EXISTS "Connections viewable by everyone" ON public.connections;
CREATE POLICY "Connections viewable by everyone" ON public.connections FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own connections" ON public.connections;
CREATE POLICY "Users can insert own connections" ON public.connections FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own connections" ON public.connections;
CREATE POLICY "Users can update own connections" ON public.connections FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own connections" ON public.connections;
CREATE POLICY "Users can delete own connections" ON public.connections FOR DELETE USING (auth.uid() = user_id OR auth.uid() = connection_id);

DROP POLICY IF EXISTS "Feed activities are viewable by authenticated users" ON public.feed_activity;
CREATE POLICY "Feed activities are viewable by authenticated users" ON public.feed_activity FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone can insert feed activities" ON public.feed_activity;
CREATE POLICY "Anyone can insert feed activities" ON public.feed_activity FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can delete feed activities" ON public.feed_activity;
CREATE POLICY "Anyone can delete feed activities" ON public.feed_activity FOR DELETE USING (true);

DROP POLICY IF EXISTS "Users can view own seen_activities" ON public.seen_activities;
CREATE POLICY "Users can view own seen_activities" ON public.seen_activities FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own seen_activities" ON public.seen_activities;
CREATE POLICY "Users can insert own seen_activities" ON public.seen_activities FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own seen_activities" ON public.seen_activities;
CREATE POLICY "Users can delete own seen_activities" ON public.seen_activities FOR DELETE USING (auth.uid() = user_id);

-- Hook Postgres trigger to Cloudflare Feed Worker
CREATE OR REPLACE FUNCTION public.notify_feed_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cf_worker_url TEXT := 'https://socium-feed-notifications.brare-black.workers.dev/';
  payload JSONB;
  target_user_id UUID;
BEGIN
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




