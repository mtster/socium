-- ==============================================================================
-- PROFILES CREATED_AT & FEED ACTIVITY NOTIFICATION MIGRATION
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

-- 1. Add created_at column to profiles table if not exists
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2. Migrate existing created_at dates from auth.users into profiles
UPDATE public.profiles p
SET created_at = u.created_at
FROM auth.users u
WHERE p.id = u.id AND (p.created_at IS NULL OR p.created_at = p.updated_at);

-- 3. Automatic signup trigger: Ensures newly signed-up users get their exact joining date
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, avatar_url, email, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email,
    NEW.created_at,
    NEW.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    created_at = COALESCE(profiles.created_at, EXCLUDED.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Update feed_activity RLS to prevent unauthorized post activities from being selected
DROP POLICY IF EXISTS "Feed activities are viewable by authenticated users" ON public.feed_activity;
DROP POLICY IF EXISTS "Feed activities are viewable by authorized users" ON public.feed_activity;

CREATE POLICY "Feed activities are viewable by authorized users" ON public.feed_activity 
FOR SELECT TO authenticated USING (
  initiator_id = auth.uid() OR
  post_id IS NULL OR
  EXISTS (
    SELECT 1 FROM public.posts p 
    WHERE p.id = feed_activity.post_id
  )
);
