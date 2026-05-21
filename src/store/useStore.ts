import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Profile, Post } from '../types';

interface AppState {
  profile: Profile | null;
  userPosts: Post[];
  feedPosts: Post[];
  feedScrollPos: number;
  totalUnread: number;
  pendingRequestsCount: number;
  hasUnseenRequest: boolean;
  floatingAvatar: Profile | null;
  sharePost: Post | null;
  
  setProfile: (profile: Profile | null) => void;
  setUserPosts: (posts: Post[]) => void;
  setFeedPosts: (posts: Post[]) => void;
  setFeedScrollPos: (pos: number) => void;
  setTotalUnread: (count: number) => void;
  setPendingRequestsCount: (count: number) => void;
  setHasUnseenRequest: (val: boolean) => void;
  setFloatingAvatar: (profile: Profile | null) => void;
  setSharePost: (post: Post | null) => void;
  
  fetchProfile: (userId: string) => Promise<void>;
  fetchUserPosts: (userId: string, currentUserId: string) => Promise<void>;
  fetchFeedPosts: (currentUserId: string) => Promise<void>;
  fetchUnreadCount: (userId: string) => Promise<void>;
  fetchPendingRequestsCount: (userId: string) => Promise<void>;
  markPendingRequestsAsSeen: (userId: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  profile: null,
  userPosts: [],
  feedPosts: [],
  feedScrollPos: 0,
  totalUnread: 0,
  pendingRequestsCount: 0,
  hasUnseenRequest: false,
  floatingAvatar: null,
  sharePost: null,

  setProfile: (profile) => set({ profile }),
  setUserPosts: (userPosts) => set({ userPosts }),
  setFeedPosts: (feedPosts) => set({ feedPosts }),
  setFeedScrollPos: (feedScrollPos) => set({ feedScrollPos }),
  setTotalUnread: (totalUnread) => set({ totalUnread }),
  setPendingRequestsCount: (pendingRequestsCount) => set({ pendingRequestsCount }),
  setHasUnseenRequest: (hasUnseenRequest) => set({ hasUnseenRequest }),
  setFloatingAvatar: (floatingAvatar) => set({ floatingAvatar }),
  setSharePost: (sharePost) => set({ sharePost }),

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
    const { data: connectionsData } = await supabase
      .from('connections')
      .select('requester_id, receiver_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`);
      
    // Always include currentUserId, Admin ID and Humor Bot ('00000000-0000-0000-0000-000000000001') in feed connections
    const connectionIds = [
      currentUserId, 
      '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2', 
      '00000000-0000-0000-0000-000000000001'
    ];
    if (connectionsData) {
      connectionsData.forEach(c => {
        if (c.requester_id !== currentUserId) connectionIds.push(c.requester_id);
        if (c.receiver_id !== currentUserId) connectionIds.push(c.receiver_id);
      });
    }

    const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';

    let query = supabase
      .from('posts')
      .select('*, profiles(*), likes(user_id), comments(id)')
      .in('user_id', connectionIds)
      .lte('created_at', new Date().toISOString());

    const { data } = await query
      .order('created_at', { ascending: false })
      .limit(30);

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
    const { data } = await supabase
      .from('messages')
      .select('sender_id')
      .eq('receiver_id', userId)
      .is('read_at', null);
      
    if (data) {
      const unreadCount = new Set(data.map(d => d.sender_id)).size;
      set({ totalUnread: unreadCount });
    }
  },

  fetchPendingRequestsCount: async (userId) => {
    const { data } = await supabase
      .from('connections')
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
      .from('connections')
      .update({ is_seen: true })
      .eq('receiver_id', userId)
      .eq('status', 'pending');
      
    if (!error) {
      set({ hasUnseenRequest: false });
    }
  }
}));
