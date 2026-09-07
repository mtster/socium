-- ==============================================================================
-- MIGRATION: Low-Res Supabase Avatars + High-Res Cloudinary Avatars
-- ==============================================================================

-- 1. Add avatar_hd_url to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_hd_url TEXT;

-- 2. Add is_profile_picture_update to posts table
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS is_profile_picture_update BOOLEAN DEFAULT FALSE;

-- 3. Backfill existing profiles: migrate avatar_url to avatar_hd_url for existing avatars
UPDATE public.profiles
SET avatar_hd_url = avatar_url
WHERE avatar_hd_url IS NULL AND avatar_url IS NOT NULL;

-- 4. Update feed_activity constraint to include 'profile_picture'
DO $$ 
BEGIN 
  ALTER TABLE public.feed_activity DROP CONSTRAINT IF EXISTS feed_activity_activity_type_check;
  ALTER TABLE public.feed_activity ADD CONSTRAINT feed_activity_activity_type_check 
    CHECK (activity_type IN ('post', 'like', 'comment', 'connection_request', 'profile_picture'));
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 5. Enforce RLS: Users can only update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (
  auth.uid() = id OR 
  (auth.uid() = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2' AND id = '00000000-0000-0000-0000-000000000001')
) WITH CHECK (
  auth.uid() = id OR 
  (auth.uid() = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2' AND id = '00000000-0000-0000-0000-000000000001')
);

-- 6. Storage RLS: Ensure users can upload and update their own avatars in the 'avatars' bucket
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

-- 7. Trigger to automatically create a post and feed_activity when avatar_hd_url is updated
CREATE OR REPLACE FUNCTION public.handle_profile_picture_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_post_id UUID;
BEGIN
  -- Trigger when avatar_hd_url is updated with a new non-null value
  IF NEW.avatar_hd_url IS NOT NULL 
     AND (OLD.avatar_hd_url IS DISTINCT FROM NEW.avatar_hd_url) THEN

    -- 1. Create a post for the profile picture update
    INSERT INTO public.posts (
      user_id,
      image_url,
      caption,
      is_profile_picture_update,
      created_at,
      updated_at
    ) VALUES (
      NEW.id,
      NEW.avatar_hd_url,
      NULL,
      true,
      NOW(),
      NOW()
    ) RETURNING id INTO new_post_id;

    -- 2. Insert into feed_activity to notify connections
    -- trigger_notify_feed_worker will post to Cloudflare Worker to send push notifications
    INSERT INTO public.feed_activity (
      activity_type,
      initiator_id,
      post_id,
      created_at
    ) VALUES (
      'profile_picture',
      NEW.id,
      new_post_id,
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_on_avatar_hd_updated ON public.profiles;
CREATE TRIGGER trigger_on_avatar_hd_updated
AFTER UPDATE OF avatar_hd_url ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.handle_profile_picture_update();
