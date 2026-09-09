import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Profile } from '@/src/types';
import { ChatListItemType } from '@/src/types/chat';
import { useStore } from '../../store/useStore';

const INITIAL_LIMIT = 12;
const PAGE_SIZE = 5;

// 1. Single atomic PostgreSQL RPC using LEFT JOIN LATERAL
async function fetchChatsViaRpc(userId: string, limit: number, offset: number): Promise<ChatListItemType[] | null> {
  try {
    const { data, error } = await supabase.rpc('get_user_chats', {
      p_user_id: userId,
      p_limit: limit,
      p_offset: offset
    });

    if (!error && Array.isArray(data)) {
      return data as ChatListItemType[];
    }
    if (error) {
      console.warn('[useChatList] RPC get_user_chats notice:', error.message);
    }
  } catch (err) {
    console.warn('[useChatList] RPC call failed, falling back:', err);
  }
  return null;
}

// 2. High-performance fallback if RPC is not yet registered in database
async function fetchChatsFallback(userId: string, limit: number, offset: number): Promise<ChatListItemType[]> {
  try {
    const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';

    const [{ data: userConns }, { data: groupParticipants }, { data: adminProf }] = await Promise.all([
      supabase.from('connections').select('*, profiles!connection_id(*)').eq('user_id', userId),
      supabase.from('group_chat_participants').select('chat_id, last_read_at').eq('user_id', userId),
      supabase.from('profiles').select('*').eq('id', ADMIN_ID).maybeSingle()
    ]);

    const combinedProfs = (userConns?.map(c => c.profiles) || []).filter(Boolean) as Profile[];
    if (adminProf && !combinedProfs.some(c => c.id === ADMIN_ID) && userId !== ADMIN_ID) {
      combinedProfs.push(adminProf);
    }
    const deduplicatedProfs = Array.from(new Map(combinedProfs.map(item => [item.id, item])).values());
    const groupChatIds = groupParticipants?.map(p => p.chat_id) || [];

    // Group metadata if needed
    let groupChatsWithDetails: any[] = [];
    if (groupChatIds.length > 0) {
      const [{ data: groups }, { data: allParticipants }] = await Promise.all([
        supabase.from('group_chats').select('*').in('id', groupChatIds),
        supabase.from('group_chat_participants').select('chat_id, user_id').in('chat_id', groupChatIds)
      ]);

      const participantUids = allParticipants?.map(p => p.user_id) || [];
      const { data: allProfilesData } = await supabase.from('profiles').select('*').in('id', participantUids);

      groupChatsWithDetails = (groups || []).map(group => {
        const joinedInfo = groupParticipants?.find(p => p.chat_id === group.id);
        const members = allParticipants
          ?.filter(p => p.chat_id === group.id)
          .map(p => allProfilesData?.find(prof => prof.id === p.user_id))
          .filter(Boolean) as Profile[] || [];
        return {
          ...group,
          my_last_read_at: joinedInfo?.last_read_at,
          participants: members
        };
      });
    }

    // Combine targets and paginate before querying messages
    const targets: Array<{ isGroup: boolean; data: any }> = [
      ...deduplicatedProfs.map(p => ({ isGroup: false, data: p })),
      ...groupChatsWithDetails.map(g => ({ isGroup: true, data: g }))
    ];

    const pageTargets = targets.slice(offset, offset + limit);
    if (pageTargets.length === 0) return [];

    const items: ChatListItemType[] = await Promise.all(
      pageTargets.map(async (target) => {
        if (!target.isGroup) {
          const prof = target.data as Profile;
          const [{ data: msgs }, { count }] = await Promise.all([
            supabase
              .from('messages')
              .select('*')
              .is('group_chat_id', null)
              .or(`and(sender_id.eq.${prof.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${prof.id})`)
              .order('created_at', { ascending: false })
              .limit(1),
            supabase
              .from('messages')
              .select('*', { count: 'exact', head: true })
              .is('group_chat_id', null)
              .eq('sender_id', prof.id)
              .eq('receiver_id', userId)
              .is('read_at', null)
          ]);

          return {
            id: prof.id,
            isGroup: false,
            name: prof.full_name || prof.username || 'Unknown',
            avatar_url: prof.avatar_url || null,
            lastMessage: msgs?.[0] || null,
            unreadCount: count || 0,
            profile: prof
          };
        } else {
          const group = target.data;
          const [{ data: msgs }, unreadCountPromise] = await Promise.all([
            supabase.from('messages').select('*').eq('group_chat_id', group.id).order('created_at', { ascending: false }).limit(1),
            group.my_last_read_at
              ? supabase
                  .from('messages')
                  .select('*', { count: 'exact', head: true })
                  .eq('group_chat_id', group.id)
                  .neq('sender_id', userId)
                  .gt('created_at', group.my_last_read_at)
              : Promise.resolve({ count: 0 })
          ]);

          const countRes = await unreadCountPromise;

          return {
            id: group.id,
            isGroup: true,
            name: group.name || group.participants.slice(0, 3).map((p: any) => p.full_name?.split(' ')[0] || p.username).join(', ') + (group.participants.length > 3 ? '...' : ''),
            avatar_url: group.avatar_url,
            lastMessage: msgs?.[0] || null,
            unreadCount: (countRes as any)?.count || 0,
            groupChat: group,
            participants: group.participants
          };
        }
      })
    );

    return items;
  } catch (err) {
    console.error('[useChatList] fallback error:', err);
    return [];
  }
}

// 3. RTDB unread sync helper (non-destructive)
async function syncRtdbInboxes(userId: string, chatItems: ChatListItemType[]) {
  try {
    const { rtdb } = await import('@/src/lib/firebase');
    if (!rtdb) return;
    const { ref, get, update } = await import('firebase/database');
    const inboxRef = ref(rtdb, `inboxes/${userId}`);
    const snapshot = await get(inboxRef);
    const inboxes = snapshot.exists() ? snapshot.val() : {};

    const updates: Record<string, boolean> = {};
    let needsUpdate = false;

    for (const chat of chatItems) {
      const currentVal = inboxes[chat.id];
      if (chat.unreadCount === 0 && currentVal === false) {
        updates[chat.id] = true;
        needsUpdate = true;
      } else if (chat.unreadCount > 0 && currentVal === undefined) {
        updates[chat.id] = false;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await update(inboxRef, updates);
    }
  } catch (e) {
    console.warn('RTDB Inbox update failed:', e);
  }
}

export function useChatList(currentUserId: string) {
  const chats = useStore(state => state.chats);
  const inboxStates = useStore(state => state.inboxStates);
  const setChats = useStore(state => state.setChats);
  const setInboxStates = useStore(state => state.setInboxStates);
  const updateInboxState = useStore(state => state.updateInboxState);
  
  const [loading, setLoading] = useState(chats.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const chatsRef = useRef<ChatListItemType[]>(chats);
  chatsRef.current = chats;

  const fetchChats = useCallback(async (silent = false) => {
    if (!currentUserId) return;
    try {
      if (!silent && chatsRef.current.length === 0) {
        setLoading(true);
      }

      // Single database request via RPC get_user_chats with LEFT JOIN LATERAL
      let chatItems = await fetchChatsViaRpc(currentUserId, INITIAL_LIMIT, 0);
      if (!chatItems) {
        chatItems = await fetchChatsFallback(currentUserId, INITIAL_LIMIT, 0);
      }

      setChats(chatItems);
      setHasMore(chatItems.length >= INITIAL_LIMIT);

      // Synchronize RTDB inboxes
      syncRtdbInboxes(currentUserId, chatItems);
    } catch (e) {
      console.error('[useChatList] Error loading chats:', e);
    } finally {
      setLoading(false);
    }
  }, [currentUserId, setChats]);

  const fetchMoreChats = useCallback(async () => {
    if (loadingMore || !hasMore || !currentUserId) return;

    try {
      setLoadingMore(true);
      const currentOffset = chatsRef.current.length;

      let newItems = await fetchChatsViaRpc(currentUserId, PAGE_SIZE, currentOffset);
      if (!newItems) {
        newItems = await fetchChatsFallback(currentUserId, PAGE_SIZE, currentOffset);
      }

      const existingIds = new Set(chatsRef.current.map(c => c.id));
      const deduplicatedNew = newItems.filter(item => !existingIds.has(item.id));

      if (deduplicatedNew.length > 0) {
        const updated = [...chatsRef.current, ...deduplicatedNew];
        setChats(updated);
        setHasMore(newItems.length >= PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.error('[useChatList] Error fetching more chats:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [currentUserId, hasMore, loadingMore, setChats]);

  // Real-time listener for RTDB inboxes
  useEffect(() => {
    if (!currentUserId) return;
    let unsubscribe: (() => void) | undefined;
    let isMounted = true;
    
    import('@/src/lib/firebase').then(({ rtdb }) => {
      if (!rtdb) return;
      import('firebase/database').then(({ ref, onValue }) => {
        if (!isMounted) return;
        const inboxRef = ref(rtdb, `inboxes/${currentUserId}`);
        unsubscribe = onValue(inboxRef, (snapshot) => {
          if (snapshot.exists()) {
            setInboxStates(snapshot.val() || {});
          } else {
            setInboxStates({});
          }
        });
      });
    });
    
    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [currentUserId, setInboxStates]);

  // Optimistic main page updates and clearing sticky unreads
  const markChatAsSeenOptimistically = useCallback((chatId: string) => {
    updateInboxState(chatId, true);
    setChats(chatsRef.current.map(c => c.id === chatId ? { ...c, unreadCount: 0 } : c));

    import('@/src/lib/firebase').then(({ rtdb }) => {
      if (!rtdb) return;
      import('firebase/database').then(({ ref, set }) => {
        set(ref(rtdb, `inboxes/${currentUserId}/${chatId}`), true).catch(console.warn);
      });
    });
  }, [currentUserId, setChats, updateInboxState]);

  useEffect(() => {
    if (chats.length === 0) {
      fetchChats();
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchChats(true);
      }
    };
    
    const handleRefresh = () => {
      fetchChats(true);
    };

    window.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    window.addEventListener('refreshChatList', handleRefresh);
    
    return () => {
      window.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('refreshChatList', handleRefresh);
    };
  }, [fetchChats, chats.length]);

  const updateChatList = useCallback((updater: (prev: ChatListItemType[]) => ChatListItemType[] = (prev) => prev) => {
    const result = updater(chatsRef.current);
    setChats(result);
  }, [setChats]);

  return { 
    chats, 
    loading, 
    loadingMore, 
    hasMore, 
    fetchChats, 
    fetchMoreChats, 
    updateChatList, 
    inboxStates, 
    markChatAsSeenOptimistically 
  };
}
