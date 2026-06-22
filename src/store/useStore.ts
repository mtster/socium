import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Profile, Post } from '../types';
import { ChatListItemType } from '../types/chat';

interface AppState {
  profile: Profile | null;
  userPosts: Post[];
  feedPosts: Post[];
  feedScrollPos: number;
  totalUnread: number;
  pendingRequestsCount: number;
  hasUnseenRequest: boolean;
  feedUnseenCount: number;
  floatingAvatar: Profile | null;
  sharePost: Post | null;
  chats: ChatListItemType[];
  inboxStates: Record<string, boolean>;
  
  setProfile: (profile: Profile | null) => void;
  setUserPosts: (posts: Post[]) => void;
  setFeedPosts: (posts: Post[]) => void;
  setFeedScrollPos: (pos: number) => void;
  setTotalUnread: (count: number) => void;
  setPendingRequestsCount: (count: number) => void;
  setHasUnseenRequest: (val: boolean) => void;
  setFeedUnseenCount: (count: number) => void;
  setFloatingAvatar: (profile: Profile | null) => void;
  setSharePost: (post: Post | null) => void;
  setChats: (chats: ChatListItemType[]) => void;
  setInboxStates: (states: Record<string, boolean>) => void;
  updateInboxState: (chatId: string, state: boolean) => void;
  handleGlobalNewMessage: (msg: any, currentUserId: string) => void;
  
  fetchProfile: (userId: string) => Promise<void>;
  fetchUserPosts: (userId: string, currentUserId: string) => Promise<void>;
  fetchFeedPosts: (currentUserId: string) => Promise<void>;
  fetchUnreadCount: (userId: string) => Promise<void>;
  fetchPendingRequestsCount: (userId: string) => Promise<void>;
  markPendingRequestsAsSeen: (userId: string) => Promise<void>;
  fetchFeedUnseenCount: (userId: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  profile: null,
  userPosts: [],
  feedPosts: [],
  feedScrollPos: 0,
  totalUnread: 0,
  pendingRequestsCount: 0,
  hasUnseenRequest: false,
  feedUnseenCount: 0,
  floatingAvatar: null,
  sharePost: null,
  chats: [],
  inboxStates: {},

  setProfile: (profile) => set({ profile }),
  setUserPosts: (userPosts) => set({ userPosts }),
  setFeedPosts: (feedPosts) => set({ feedPosts }),
  setFeedScrollPos: (feedScrollPos) => set({ feedScrollPos }),
  setTotalUnread: (totalUnread) => set({ totalUnread }),
  setPendingRequestsCount: (pendingRequestsCount) => set({ pendingRequestsCount }),
  setHasUnseenRequest: (hasUnseenRequest) => set({ hasUnseenRequest }),
  setFeedUnseenCount: (feedUnseenCount) => set({ feedUnseenCount }),
  setFloatingAvatar: (floatingAvatar) => set({ floatingAvatar }),
  setSharePost: (sharePost) => set({ sharePost }),
  setChats: (chats) => set({ chats }),
  setInboxStates: (inboxStates) => set({ inboxStates }),
  updateInboxState: (chatId, state) => set(stateObj => ({
    inboxStates: {
      ...stateObj.inboxStates,
      [chatId]: state
    }
  })),
  handleGlobalNewMessage: (msg, currentUserId) => {
    const chats = get().chats;
    const isGroup = msg.group_chat_id !== null;
    const chatId = isGroup ? msg.group_chat_id : (msg.sender_id === currentUserId ? msg.receiver_id : msg.sender_id);
    
    if (!chatId) return;

    const idx = chats.findIndex(c => c.id === chatId);
    if (idx !== -1) {
      const existingChat = chats[idx];
      const currentLastMsgTime = existingChat.lastMessage ? new Date(existingChat.lastMessage.created_at).getTime() : 0;
      const newMsgTime = new Date(msg.created_at).getTime();
      
      if (newMsgTime >= currentLastMsgTime) {
        const isMeantForUs = msg.sender_id !== currentUserId;
        const isCurrentlyLooking = (window as any).currentChatUserId === chatId;
        const shouldBeUnread = isMeantForUs && !isCurrentlyLooking;

        const updatedChat = {
          ...existingChat,
          lastMessage: msg,
          unreadCount: shouldBeUnread
            ? (existingChat.unreadCount || 0) + 1
            : 0
        };
        
        const updatedList = [...chats];
        updatedList.splice(idx, 1);
        const newList = [updatedChat, ...updatedList];
        
        set({ 
          chats: newList,
          inboxStates: {
            ...get().inboxStates,
            [chatId]: !shouldBeUnread
          }
        });
      }
    } else {
       // Dispatches refresh event to load entire list for a brand new user chat
       window.dispatchEvent(new CustomEvent('refreshChatList'));
    }
  },
  fetchProfile: async (userId) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (data) set({ profile: data });
  },

  fetchUserPosts: async (userId, currentUserId) => {
    const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
    
    let query = supabase
      .from('posts')
      .select('*, profiles(*), likes(user_id), comments(id)')
      .eq('user_id', userId);

    if (currentUserId !== ADMIN_ID) {
      query = query.lte('created_at', new Date().toISOString());
    }

    const { data } = await query.order('created_at', { ascending: false });

    if (data) {
      const viewerId = currentUserId;
      let processed = data.map((p: any) => ({
        ...p,
        likes_count: p.likes?.length || 0,
        has_liked: p.likes?.some((l: any) => l.user_id === viewerId),
        comments_count: p.comments?.length || 0
      }));

      if (viewerId !== userId && viewerId !== ADMIN_ID) {
        processed = processed.filter(post => {
          if (post.visible_to && Array.isArray(post.visible_to) && post.visible_to.length > 0) {
            return post.visible_to.includes(viewerId);
          }
          return true;
        });
      }
      set({ userPosts: processed as any });
    }
  },

  fetchFeedPosts: async (currentUserId) => {
    const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';

    const { data: connectionsData } = await supabase
      .from('connections')
      .select('connection_id')
      .eq('user_id', currentUserId);
      
    // Always include currentUserId, Admin ID and Humor Bot ('00000000-0000-0000-0000-000000000001') in feed connections
    const connectionIds = [
      currentUserId, 
      '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2', 
      '00000000-0000-0000-0000-000000000001'
    ];
    if (connectionsData) {
      connectionsData.forEach(c => {
        if (c.connection_id) connectionIds.push(c.connection_id);
      });
    }

    let query = supabase
      .from('posts')
      .select('*, profiles(*), likes(user_id), comments(id)')
      .lte('created_at', new Date().toISOString());

    if (currentUserId !== ADMIN_ID) {
      query = query.in('user_id', connectionIds);
    }

    const { data } = await query
      .order('created_at', { ascending: false });

    if (data) {
      let processed = data.map((p: any) => ({
        ...p,
        likes_count: p.likes?.length || 0,
        has_liked: p.likes?.some((l: any) => l.user_id === currentUserId),
        comments_count: p.comments?.length || 0
      }));

      processed = processed.filter((post: any) => {
        if (currentUserId === ADMIN_ID || post.user_id === currentUserId) return true;
        if (post.visible_to && Array.isArray(post.visible_to) && post.visible_to.length > 0) {
          return post.visible_to.includes(currentUserId);
        }
        return true;
      });

      set({ feedPosts: processed as any });
    }
  },

  fetchUnreadCount: async (userId) => {
    try {
      // 1. Unread 1-on-1 direct messages (number of distinct sender_ids)
      const { data: dms } = await supabase
        .from('messages')
        .select('sender_id')
        .eq('receiver_id', userId)
        .is('read_at', null);

      const unreadDMs = new Set(dms?.map(d => d.sender_id) || []).size;

      // 2. Unread Group chats
      const { data: participants } = await supabase
        .from('group_chat_participants')
        .select('chat_id, last_read_at')
        .eq('user_id', userId);

      let unreadGroups = 0;
      if (participants && participants.length > 0) {
        const promises = participants.map(async (part) => {
          if (!part.last_read_at) return 0;
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('group_chat_id', part.chat_id)
            .neq('sender_id', userId)
            .gt('created_at', part.last_read_at);
          return (count && count > 0) ? 1 : 0;
        });
        const results = await Promise.all(promises);
        unreadGroups = results.reduce((acc, val) => acc + val, 0);
      }

      set({ totalUnread: unreadDMs + unreadGroups });
    } catch (e) {
      console.warn("Error fetching unread count from Supabase:", e);
    }
  },

  fetchPendingRequestsCount: async (userId) => {
    const { data } = await supabase
      .from('connection_requests')
      .select('id, is_seen')
      .eq('receiver_id', userId)
      .eq('status', 'pending');
    
    if (data) {
      const hasUnseen = data.some((r: any) => r.is_seen === false);
      set({ 
          pendingRequestsCount: data.length, 
          hasUnseenRequest: hasUnseen 
      });
    }
  },

  markPendingRequestsAsSeen: async (userId) => {
    const { error } = await supabase
      .from('connection_requests')
      .update({ is_seen: true })
      .eq('receiver_id', userId)
      .eq('status', 'pending');
      
    if (!error) {
      set({ hasUnseenRequest: false });
    }
  },

  fetchFeedUnseenCount: async (userId) => {
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('base_timestamp')
        .eq('id', userId)
        .maybeSingle();

      const baseTimestamp = profileData?.base_timestamp || new Date(0).toISOString();

      const { data: seenData } = await supabase
        .from('seen_activities')
        .select('activity_id')
        .eq('user_id', userId);

      const seenIds = new Set((seenData || []).map((s: any) => s.activity_id));

      const { data: conns } = await supabase
        .from('connections')
        .select('connection_id')
        .eq('user_id', userId);

      const connectionIds = [
        userId,
        '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2', // Admin
        '00000000-0000-0000-0000-000000000001'  // Bot
      ];
      if (conns) {
        conns.forEach(c => {
          if (c.connection_id) connectionIds.push(c.connection_id);
        });
      }

      // Query latest 15 activities
      const { data: feats } = await supabase
        .from('feed_activity')
        .select('*')
        .or(`initiator_id.in.(${connectionIds.join(',')}),target_user_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(15);

      if (feats) {
        const unseen = feats.filter((act: any) => {
          if (act.initiator_id === userId) return false;
          const isOlderThanBase = act.created_at <= baseTimestamp;
          const isSeen = seenIds.has(act.id);
          return !isOlderThanBase && !isSeen;
        });
        set({ feedUnseenCount: unseen.length });
      }
    } catch (err) {
      console.warn("Error fetching feed unseen count:", err);
    }
  }
}));
