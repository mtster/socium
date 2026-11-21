import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { rtdb } from '../lib/firebase';
import { ref, set } from 'firebase/database';
import { useStore } from '../store/useStore';

const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
const inFlightProfileData = new Map<string, Promise<void>>();
const healedConnectionUsers = new Set<string>();

export function useUserProfile(session: any, registerPush: (uid: string) => void) {
  const { 
    setProfile, 
    fetchProfile,
    fetchConnectionIds,
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
          created_at: user?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'id',
          ignoreDuplicates: false
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

  const fetchProfileData = async (userId: string, force = false) => {
    if (!force) {
      const existing = inFlightProfileData.get(userId);
      if (existing) return existing;
    }

    const task = (async () => {
      try {
        setIsProfileError(false);

        const shouldHealConnections = !healedConnectionUsers.has(userId);

        const [, connIds, acceptedReqsRes] = await Promise.all([
          fetchProfile(userId, force),
          shouldHealConnections ? fetchConnectionIds(userId) : Promise.resolve([] as string[]),
          shouldHealConnections
            ? supabase
                .from('connection_requests')
                .select('requester_id, receiver_id')
                .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
                .eq('status', 'accepted')
            : Promise.resolve({ data: null })
        ]);

        const currentProfile = useStore.getState().profile;
        if (!currentProfile || currentProfile.id !== userId) {
          await createInitialProfile(userId);
        }

        if (shouldHealConnections) {
          const existingSet = new Set(connIds);

          // Auto-connect to Socium (ADMIN_ID) only if not already present in connections
          if (userId !== ADMIN_ID && !existingSet.has(ADMIN_ID)) {
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

                await supabase.from('connections').upsert([
                  { user_id: userId, connection_id: ADMIN_ID }
                ], { onConflict: 'user_id,connection_id' });
                existingSet.add(ADMIN_ID);
              }
            } catch (connErr) {
              console.error('Error establishing default Socium connection:', connErr);
            }
          }

          // Self-heal any accepted connections for this user missing in public.connections
          try {
            const acceptedReqs = acceptedReqsRes?.data;
            if (acceptedReqs && acceptedReqs.length > 0) {
              const toInsert: any[] = [];
              for (const req of acceptedReqs) {
                const peerId = req.requester_id === userId ? req.receiver_id : req.requester_id;
                if (peerId && !existingSet.has(peerId)) {
                  toInsert.push({ user_id: userId, connection_id: peerId });
                  existingSet.add(peerId);
                }
              }

              if (toInsert.length > 0) {
                await supabase.from('connections').upsert(toInsert, { onConflict: 'user_id,connection_id' });
                window.dispatchEvent(new CustomEvent('connectionsChanged'));
                window.dispatchEvent(new CustomEvent('refreshChatList'));
              }
            }
            healedConnectionUsers.add(userId);
          } catch (healErr) {
            console.warn('Self-heal connections sync notice:', healErr);
          }
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
        setIsProfileError(true);
      } finally {
        inFlightProfileData.delete(userId);
      }
    })();

    inFlightProfileData.set(userId, task);
    return task;
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
