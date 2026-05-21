import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Profile } from '@/src/types';
import { ChatListItemType, GroupChat } from '@/src/types/chat';

let chatListCache: ChatListItemType[] | null = null;
let lastChatListFetch = 0;

export function useChatList(currentUserId: string) {
  const [chats, setChats] = useState<ChatListItemType[]>(chatListCache || []);
  const [loading, setLoading] = useState(!chatListCache);

  const fetchChats = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }

      // 1. Fetch 1-on-1 Connections
      const { data: rel1 } = await supabase.from('connections').select('*, profiles!connections_receiver_id_fkey(*)').eq('requester_id', currentUserId).eq('status', 'accepted');
      const { data: rel2 } = await supabase.from('connections').select('*, profiles!connections_requester_id_fkey(*)').eq('receiver_id', currentUserId).eq('status', 'accepted');
      const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
      const { data: adminProf } = await supabase.from('profiles').select('*').eq('id', ADMIN_ID).maybeSingle();
      
      const combinedProfs = [...(rel1?.map(c => c.profiles) || []), ...(rel2?.map(c => c.profiles) || [])].filter(Boolean) as Profile[];
      if (adminProf && !combinedProfs.some(c => c.id === ADMIN_ID) && currentUserId !== ADMIN_ID) combinedProfs.push(adminProf);
      const deduplicatedProfs = Array.from(new Map(combinedProfs.map(item => [item.id, item])).values());

      // 2. Fetch Group Chats
      const { data: groupParticipants } = await supabase.from('group_chat_participants')
        .select('chat_id, last_read_at')
        .eq('user_id', currentUserId);

      const groupChatIds = groupParticipants?.map(p => p.chat_id) || [];
      let groupChatsWithDetails: any[] = [];
      
      if (groupChatIds.length > 0) {
        // We use a custom join or multiple queries. To avoid complex RPC right now:
        const { data: groups } = await supabase.from('group_chats')
          .select('*')
          .in('id', groupChatIds);
          
        const { data: allParticipants } = await supabase.from('group_chat_participants')
          .select('chat_id, user_id')
          .in('chat_id', groupChatIds);

        const participantUids = allParticipants?.map(p => p.user_id) || [];
        const { data: allProfilesData } = await supabase.from('profiles')
          .select('*')
          .in('id', participantUids);

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

      // 3. Transform and fetch messages
      const chatItems: ChatListItemType[] = [];

      // 1-on-1
      await Promise.all(deduplicatedProfs.map(async (prof) => {
        const { data: msgs } = await supabase.from('messages')
          .select('*').is('group_chat_id', null)
          .or(`and(sender_id.eq.${prof.id},receiver_id.eq.${currentUserId}),and(sender_id.eq.${currentUserId},receiver_id.eq.${prof.id})`)
          .order('created_at', { ascending: false }).limit(1);
          
        const { count } = await supabase.from('messages')
          .select('*', { count: 'exact', head: true })
          .is('group_chat_id', null)
          .eq('sender_id', prof.id)
          .eq('receiver_id', currentUserId)
          .is('read_at', null);

        chatItems.push({
          id: prof.id,
          isGroup: false,
          name: prof.full_name || prof.username || 'Unknown',
          avatar_url: prof.avatar_url || null,
          lastMessage: msgs?.[0] || null,
          unreadCount: count || 0,
          profile: prof
        });
      }));

      // Group Chats
      await Promise.all(groupChatsWithDetails.map(async (group) => {
        const { data: msgs } = await supabase.from('messages')
          .select('*').eq('group_chat_id', group.id)
          .order('created_at', { ascending: false }).limit(1);
          
        let count = 0;
        if (group.my_last_read_at) {
          const { count: unread } = await supabase.from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('group_chat_id', group.id)
            .neq('sender_id', currentUserId)
            .gt('created_at', group.my_last_read_at);
          count = unread || 0;
        }

        // Generate default name and avatar logic for group chats
        chatItems.push({
          id: group.id,
          isGroup: true,
          name: group.name || group.participants.slice(0,3).map((p:any) => p.full_name?.split(' ')[0] || p.username).join(', ') + (group.participants.length > 3 ? '...' : ''),
          avatar_url: group.avatar_url,
          lastMessage: msgs?.[0] || null,
          unreadCount: count,
          groupChat: group,
          participants: group.participants
        });
      }));

      chatItems.sort((a, b) => new Date(b.lastMessage?.created_at || 0).getTime() - new Date(a.lastMessage?.created_at || 0).getTime());
      
      chatListCache = chatItems;
      lastChatListFetch = Date.now();
      setChats(chatItems);
      
      // Cleanup and Sync RTDB Inboxes and Unseen chat count
      try {
        const { rtdb } = await import('@/src/lib/firebase');
        if (rtdb) {
           const { ref, get, set } = await import('firebase/database');
           const inboxRef = ref(rtdb, `inboxes/${currentUserId}`);
           const snapshot = await get(inboxRef);
           if (snapshot.exists()) {
              const inboxes = snapshot.val();
              const validIds = new Set(chatItems.map(c => c.id));
              let needsUpdate = false;
              let computedUnseenCount = 0;
              
              const updatedInboxes = { ...inboxes };
              
              // Standardize values with actual Postgres unread states
              for (const chat of chatItems) {
                 const currentVal = updatedInboxes[chat.id];
                 if (chat.unreadCount === 0 && currentVal === false) {
                    updatedInboxes[chat.id] = true;
                    needsUpdate = true;
                  } else if (chat.unreadCount > 0 && currentVal === undefined) {
                     // Only initialize to false if it has not been set yet.
                     // NEVER transition from true (seen) to false (unseen) within the chat list fetch
                     // because the recipient may have just marked it seen, and Postgres has propagation latency.
                     // The sender's checkRecipientPresenceAndNotify or Cloudflare Worker handles setting to false on new messages.
                    updatedInboxes[chat.id] = false;
                    needsUpdate = true;
                 }
              }
              
              // Remove old UUIDs
              for (const key of Object.keys(updatedInboxes)) {
                 if (!validIds.has(key)) {
                    delete updatedInboxes[key];
                    needsUpdate = true;
                 }
              }

              if (needsUpdate) {
                 await set(inboxRef, updatedInboxes);
              }
           }
        }
      } catch (e) {
        console.warn("RTDB Inbox cleanup failed:", e);
      }
      
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    // Always fetch on mount/focus to get latest messages and keep main chat list updated
    fetchChats();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchChats();
      }
    };
    window.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [fetchChats]);

  useEffect(() => {
    // Live Supabase updates for messages, groups, and participants
    const channel = supabase.channel(`chat_list_updates_${currentUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        // Fetch on any message insertion, updates (such as read receipt changes), or deletion
        fetchChats(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_chats' }, () => {
        fetchChats(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_chat_participants' }, (payload) => {
        // Only refresh of general participants insertion/deletion, not read receipt updates
        if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
          fetchChats(true);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, fetchChats]);

  const updateChatList = useCallback((updater: (prev: ChatListItemType[]) => ChatListItemType[]) => {
    setChats(prev => {
      const result = updater(prev);
      chatListCache = result;
      return result;
    });
  }, []);

  return { chats, loading, fetchChats, updateChatList };
}
