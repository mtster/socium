import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { rtdb } from '../lib/firebase';
import { ref, set, onValue } from 'firebase/database';
import { useStore } from '../store/useStore';
import { initPresence } from '../lib/presence';
import { playVibeSound, playMessageSound } from '../lib/audio';
import { Profile } from '../types';

interface RealtimeSyncProps {
  userId: string | undefined;
  activeTab: string;
  isFeedInboxOpen: boolean;
  setActiveTab: (tab: string) => void;
  setIsFeedInboxOpen: (open: boolean) => void;
  handleUserClick: (userId: string) => void;
  setInitialActiveChat: (chat: Profile | null) => void;
}

export function useRealtimeSync({
  userId,
  activeTab,
  isFeedInboxOpen,
  setActiveTab,
  setIsFeedInboxOpen,
  handleUserClick,
  setInitialActiveChat,
}: RealtimeSyncProps) {
  const { 
    setFloatingAvatar, 
    feedUnseenCount, 
    fetchFeedUnseenCount,
    fetchUnreadCount,
    fetchPendingRequestsCount
  } = useStore();

  const [activeVibeInitiatorId, setActiveVibeInitiatorId] = useState<string | null>(null);
  const [vibeInitiatorProfile, setVibeInitiatorProfile] = useState<Profile | null>(null);

  const handleClearVibeBubble = async () => {
    if (!userId || !rtdb) return;
    try {
      await set(ref(rtdb, `feed/${userId}`), null);
    } catch (e) {
      console.warn('Failed to clear active vibe RTDB node:', e);
    }
    setActiveVibeInitiatorId(null);
    setVibeInitiatorProfile(null);
    setActiveTab('feed');
    setIsFeedInboxOpen(true);
  };

  // 1. Firebase RTDB Live notifications (vibes)
  useEffect(() => {
    if (!userId || !rtdb) return;
    const feedRef = ref(rtdb, `feed/${userId}`);

    const unsubscribe = onValue(feedRef, async (snapshot) => {
      const initiatorId = snapshot.val();
      if (initiatorId && typeof initiatorId === 'string') {
        setActiveVibeInitiatorId(initiatorId);

        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', initiatorId)
          .maybeSingle();

        if (data) {
          setVibeInitiatorProfile(data);
          playVibeSound();
          // Auto-clear after 4s to match chat bubble behavior
          setTimeout(() => {
            if (rtdb && userId) {
              set(ref(rtdb, `feed/${userId}`), null).catch(() => {});
            }
          }, 4000);
        }

        fetchFeedUnseenCount(userId);
      } else {
        setActiveVibeInitiatorId(null);
        setVibeInitiatorProfile(null);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [userId]);

  // 2. Location synchronizer
  useEffect(() => {
    if (!userId || !rtdb) return;
    let loc = 'none';
    if (activeTab === 'feed') {
      loc = isFeedInboxOpen ? 'feed_inbox' : 'feed';
    }
    set(ref(rtdb, `location/${userId}`), loc).catch(err => {
      console.warn('Failed to update RTDB location node:', err);
    });
  }, [userId, activeTab, isFeedInboxOpen]);

  // 3. Sync count and fetch unseen count on tab select
  useEffect(() => {
    if (userId) {
      fetchFeedUnseenCount(userId);
    }
  }, [userId, activeTab]);

  // 4. Online Presence configuration
  useEffect(() => {
    let unmountPresence: (() => void) | undefined;
    if (userId) {
      unmountPresence = initPresence(userId);
      if (typeof window !== 'undefined' && 'caches' in window) {
        caches.open('user-meta').then(cache => {
          cache.put('/uid', new Response(userId));
        }).catch(err => console.error('Failed to cache UID:', err));
      }
    } else {
      if (typeof window !== 'undefined' && 'caches' in window) {
        caches.open('user-meta').then(cache => {
          cache.delete('/uid');
        }).catch(err => console.error('Failed to clear cached UID:', err));
      }
    }
    return () => {
      if (unmountPresence) unmountPresence();
    };
  }, [userId]);

  // 5. Supabase Realtime Messaging & Connections subscription
  useEffect(() => {
    let globalUnreadChannel: any = null;
    let forceGetUnreadHandler: any = null;

    if (userId) {
      const getUnread = async () => {
        await fetchUnreadCount(userId);
      };
      
      const getPending = async () => {
        await fetchPendingRequestsCount(userId);
      };

      forceGetUnreadHandler = () => getUnread();
      window.addEventListener('forceGetUnread', forceGetUnreadHandler);

      getUnread();
      getPending();

      globalUnreadChannel = supabase.channel('global_unread')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
           const msg = payload.new;
           const isRelevant = msg.sender_id === userId || msg.receiver_id === userId || msg.group_chat_id !== null;
           if (isRelevant) {
              useStore.getState().handleGlobalNewMessage(msg, userId);
           }
           const isForUs = msg.receiver_id === userId || msg.group_chat_id !== null;
           if (msg.sender_id === userId || !isForUs || (window as any).currentChatUserId === (msg.group_chat_id || msg.sender_id)) return;
           
           playMessageSound();
           getUnread();
           
           const senderId = msg.sender_id;
           const groupChatId = msg.group_chat_id;
           const chatId = groupChatId || senderId;
           
           if ((window as any).currentChatUserId !== chatId) {
             let chatRefProfile: any = null;
             if (groupChatId) {
               const { data: gc } = await supabase.from('group_chats').select('*, group_chat_participants(profiles(*))').eq('id', groupChatId).single();
               if (gc) {
                 const participants = (gc.group_chat_participants as any[])?.map(p => p.profiles) || [];
                 chatRefProfile = {
                   id: gc.id,
                   username: gc.name || 'Group Chat',
                   full_name: gc.name || 'Group Chat',
                   avatar_url: gc.avatar_url || null,
                   isGroup: true,
                   participants
                 };
               }
             } else {
               const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', senderId).single();
               chatRefProfile = senderProfile;
             }
             
             if (chatRefProfile) {
               const currentPathOpen = (window as any).currentActiveTab;
               if (currentPathOpen !== 'chat') {
                 setFloatingAvatar(chatRefProfile);
                 setTimeout(() => setFloatingAvatar(null), 4000);
               }
             }
           }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
           if (payload.new.receiver_id === userId || payload.new.group_chat_id !== null || payload.new.sender_id === userId) {
              getUnread();
              window.dispatchEvent(new CustomEvent('refreshChatList'));
           }
        })
        .subscribe();

      const connectionsChannel = supabase.channel('global_connections')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'connection_requests' }, (payload) => {
          const req: any = payload.new || payload.old;
          if (req && (req.requester_id === userId || req.receiver_id === userId)) {
            getPending();
            window.dispatchEvent(new CustomEvent('connectionsChanged'));
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'connections' }, (payload) => {
          const conn: any = payload.new || payload.old;
          if (conn && (conn.user_id === userId || conn.connection_id === userId)) {
            window.dispatchEvent(new CustomEvent('connectionsChanged'));
            getUnread();
            window.dispatchEvent(new CustomEvent('refreshChatList'));
          }
        })
        .subscribe();
        
      return () => {
        if (forceGetUnreadHandler) window.removeEventListener('forceGetUnread', forceGetUnreadHandler);
        if (globalUnreadChannel) supabase.removeChannel(globalUnreadChannel);
        supabase.removeChannel(connectionsChannel);
      };
    }

    return () => {
      if (forceGetUnreadHandler) window.removeEventListener('forceGetUnread', forceGetUnreadHandler);
    };
  }, [userId]);

  return {
    activeVibeInitiatorId,
    vibeInitiatorProfile,
    handleClearVibeBubble,
    feedUnseenCount,
  };
}
