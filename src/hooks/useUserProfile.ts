import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { rtdb } from '../lib/firebase';
import { ref, set } from 'firebase/database';
import { useStore } from '../store/useStore';

export function useUserProfile(session: any, registerPush: (uid: string) => void) {
  const { 
    setProfile, 
    fetchProfile, 
    fetchUserPosts,
  } = useStore();

  const [isProfileError, setIsProfileError] = useState(false);

  const createInitialProfile = async (userId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const username = user?.email?.split('@')[0] || `user_${userId.slice(0, 5)}`;
      
      const { data: newProfile, error } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          username,
          full_name: user?.user_metadata?.full_name || username,
          avatar_url: user?.user_metadata?.avatar_url || null,
          email: user?.email || null,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (!error && newProfile) {
        setProfile(newProfile);
      }
      
      // Also init RTDB values
      if (rtdb) {
        try {
          await set(ref(rtdb, `unseen_chat_count/${userId}`), 0);
          await set(ref(rtdb, `location/${userId}`), 'none');
          await set(ref(rtdb, `global_presence/${userId}`), true);
        } catch (e) {
           console.error('Failed to init RTDB for new user', e);
        }
      }
    } catch (err) {
      console.error('Failed to create initial profile:', err);
    }
  };

  const fetchProfileData = async (userId: string) => {
    try {
      setIsProfileError(false);
      await fetchProfile(userId);
      const currentProfile = useStore.getState().profile;
      if (!currentProfile || currentProfile.id !== userId) {
        await createInitialProfile(userId);
      }
      
      // Auto-connect to Socium (ADMIN_ID)
      const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
      if (userId !== ADMIN_ID) {
        try {
          const { data: existingCheck } = await supabase
            .from('connection_requests')
            .select('id')
            .or(`and(requester_id.eq.${ADMIN_ID},receiver_id.eq.${userId}),and(requester_id.eq.${userId},receiver_id.eq.${ADMIN_ID})`)
            .maybeSingle();

          if (!existingCheck) {
            await supabase.from('connection_requests').insert({
              requester_id: ADMIN_ID,
              receiver_id: userId,
              status: 'accepted'
            });

            // Insert bidirectional records in actual connections
            await supabase.from('connections').insert([
              { user_id: ADMIN_ID, connection_id: userId },
              { user_id: userId, connection_id: ADMIN_ID }
            ]);
          }
        } catch (connErr) {
          console.error('Error establishing default Socium connection:', connErr);
        }
      }

      fetchUserPosts(userId, userId);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setIsProfileError(true);
    }
  };

  useEffect(() => {
    if (session?.user?.id) {
      fetchProfileData(session.user.id);
      registerPush(session.user.id);
    }
  }, [session?.user?.id]);

  return {
    isProfileError,
    fetchProfileData,
    createInitialProfile,
  };
}
