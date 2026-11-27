import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Profile, Post } from '../types';
import { ChatListItemType } from '../types/chat';
import { isPostVisibleToUser } from '../lib/visibility';

const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
const HUMOR_BOT_ID = '00000000-0000-0000-0000-000000000001';

let cachedConnections: { userId: string; ids: string[]; fetchedAt: number } | null = null;
const inFlightConnections = new Map<string, Promise<string[]>>();
const inFlightProfile = new Map<string, Promise<void>>();
const inFlightUserPosts = new Map<string, Promise<void>>();
let lastUserPostsFetch: { key: string; fetchedAt: number } | null = null;

type UnreadScope = 'all' | 'dm' | 'group';

const inFlightUnread = new Map<string, Promise<void>>();
const pendingUnreadRerun = new Map<string, UnreadScope>();
const cachedUnreadDms = new Map<string, number>();
const cachedUnreadGroups = new Map<string, number>();

const inFlightFeedUnseen = new Map<string, Promise<void>>();
const pendingFeedUnseenRerun = new Set<string>();

if (typeof window !== 'undefined') {
  window.addEventListener('connectionsChanged', () => {
    cachedConnections = null;
  });
}

interface AppState {
  profile: Profile | null;
  userPosts: Post[];
  hasMoreUserPosts: boolean;
  isFetchingMoreUserPosts: boolean;
  userPostsCursor: string | null;
  feedPosts: Post[];
  feedScrollPos: number;
  hasMoreFeedPosts: boolean;
  isFetchingFeedPosts: boolean;
  isFetchingMoreFeedPosts: boolean;
  totalUnread: number;
  pendingRequestsCount: number;
  hasUnseenRequest: boolean;
  feedUnseenCount: number;
  floatingAvatar: Profile | null;
  sharePost: Post | null;
  chats: ChatListItemType[];
  hasMoreChats: boolean;
  inboxStates: Record<string, boolean>;
  minimizedAudioCall: {
    displayName: string;
    avatarUrl: string | null;
    isGroup: boolean;
    duration: number;
  } | null;
  
  setProfile: (profile: Profile | null) => void;
  setUserPosts: (posts: Post[]) => void;
  setFeedPosts: (posts: Post[]) => void;
  setFeedScrollPos: (pos: number) => void;
  setHasMoreFeedPosts: (val: boolean) => void;
  setTotalUnread: (count: number) => void;
  setPendingRequestsCount: (count: number) => void;
  setHasUnseenRequest: (val: boolean) => void;
  setFeedUnseenCount: (count: number) => void;
  setFloatingAvatar: (profile: Profile | null) => void;
  setSharePost: (post: Post | null) => void;
  setChats: (chats: ChatListItemType[]) => void;
  setHasMoreChats: (val: boolean) => void;
  setInboxStates: (states: Record<string, boolean>) => void;
  setMinimizedAudioCall: (banner: AppState['minimizedAudioCall']) => void;
  updateInboxState: (chatId: string, state: boolean) => void;
  handleGlobalNewMessage: (msg: any, currentUserId: string) => void;
  
  fetchConnectionIds: (userId: string, force?: boolean) => Promise<string[]>;
  fetchProfile: (userId: string, force?: boolean) => Promise<void>;
  fetchUserPosts: (userId: string, currentUserId: string, force?: boolean) => Promise<void>;
  fetchMoreUserPosts: (userId: string, currentUserId: string) => Promise<void>;
  fetchFeedPosts: (currentUserId: string, refresh?: boolean) => Promise<void>;
  fetchMoreFeedPosts: (currentUserId: string) => Promise<void>;
  fetchUnreadCount: (userId: string, scope?: UnreadScope) => Promise<void>;
  fetchPendingRequestsCount: (userId: string) => Promise<void>;
  markPendingRequestsAsSeen: (userId: string) => Promise<void>;
  fetchFeedUnseenCount: (userId: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  profile: null,
  userPosts: [],
  hasMoreUserPosts: true,
  isFetchingMoreUserPosts: false,
  userPostsCursor: null,
  feedPosts: [],
  feedScrollPos: 0,
  hasMoreFeedPosts: true,
  isFetchingFeedPosts: false,
  isFetchingMoreFeedPosts: false,
  totalUnread: 0,
  pendingRequestsCount: 0,
  hasUnseenRequest: false,
  feedUnseenCount: 0,
  floatingAvatar: null,
  sharePost: null,
  chats: [],
  hasMoreChats: true,
  inboxStates: {},
  minimizedAudioCall: null,

  setProfile: (profile) => set({ profile }),
  setUserPosts: (userPosts) => set({ userPosts }),
  setFeedPosts: (feedPosts) => set({ feedPosts }),
  setFeedScrollPos: (feedScrollPos) => set({ feedScrollPos }),
  setHasMoreFeedPosts: (hasMoreFeedPosts) => set({ hasMoreFeedPosts }),
  setTotalUnread: (totalUnread) => set({ totalUnread }),
  setPendingRequestsCount: (pendingRequestsCount) => set({ pendingRequestsCount }),
  setHasUnseenRequest: (hasUnseenRequest) => set({ hasUnseenRequest }),
  setFeedUnseenCount: (feedUnseenCount) => set({ feedUnseenCount }),
  setFloatingAvatar: (floatingAvatar) => set({ floatingAvatar }),
  setSharePost: (sharePost) => set({ sharePost }),
  setChats: (chats) => set({ chats }),
  setHasMoreChats: (hasMoreChats) => set({ hasMoreChats }),
  setInboxStates: (inboxStates) => set({ inboxStates }),
  setMinimizedAudioCall: (minimizedAudioCall) => set({ minimizedAudioCall }),
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

  fetchConnectionIds: async (userId, force = false) => {
    if (
      !force &&
      cachedConnections &&
      cachedConnections.userId === userId &&
      Date.now() - cachedConnections.fetchedAt < 60_000
    ) {
      return cachedConnections.ids;
    }

    if (!force) {
      const existing = inFlightConnections.get(userId);
      if (existing) return existing;
    }

    const task = (async () => {
      try {
        const { data } = await supabase
          .from('connections')
          .select('connection_id')
          .eq('user_id', userId);

        const ids = (data || [])
          .map((c: any) => c.connection_id)
          .filter(Boolean) as string[];

        cachedConnections = { userId, ids, fetchedAt: Date.now() };
        return ids;
      } finally {
        inFlightConnections.delete(userId);
      }
    })();

    inFlightConnections.set(userId, task);
    return task;
  },

  fetchProfile: async (userId, force = false) => {
    if (!force) {
      const existing = inFlightProfile.get(userId);
      if (existing) return existing;
    }

    const task = (async () => {
      try {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if (data) set({ profile: data });
      } finally {
        inFlightProfile.delete(userId);
      }
    })();

    inFlightProfile.set(userId, task);
    return task;
  },

  fetchUserPosts: async (userId, currentUserId, force = false) => {
    const key = `${userId}:${currentUserId}`;
    if (
      !force &&
      lastUserPostsFetch &&
      lastUserPostsFetch.key === key &&
      Date.now() - lastUserPostsFetch.fetchedAt < 15_000 &&
      get().userPosts.length > 0
    ) {
      return;
    }

    if (!force) {
      const existing = inFlightUserPosts.get(key);
      if (existing) return existing;
    }

    const task = (async () => {
      try {
        const PAGE_SIZE = 5;
        let query = supabase
          .from('posts')
          .select('*, profiles(*), likes(user_id), comments(id)')
          .eq('user_id', userId);

        if (currentUserId !== ADMIN_ID) {
          query = query.lte('created_at', new Date().toISOString());
        }

        const { data } = await query
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE);

        if (data) {
          const viewerId = currentUserId;
          let processed = data.map((p: any) => ({
            ...p,
            likes_count: p.likes?.length || 0,
            has_liked: p.likes?.some((l: any) => l.user_id === viewerId),
            comments_count: p.comments?.length || 0
          }));

          if (viewerId !== userId && viewerId !== ADMIN_ID && userId !== HUMOR_BOT_ID) {
            const { data: conn } = await supabase
              .from('connections')
              .select('connection_id')
              .eq('user_id', userId)
              .eq('connection_id', viewerId)
              .maybeSingle();

            const isConnection = !!conn;
            processed = processed.filter(post => isPostVisibleToUser(post, viewerId, isConnection));
          }
          set({
            userPosts: processed as any,
            hasMoreUserPosts: data.length === PAGE_SIZE,
            userPostsCursor: data.length > 0 ? data[data.length - 1].created_at : null
          });
          lastUserPostsFetch = { key, fetchedAt: Date.now() };
        }
      } finally {
        inFlightUserPosts.delete(key);
      }
    })();

    inFlightUserPosts.set(key, task);
    return task;
  },

  fetchMoreUserPosts: async (userId, currentUserId) => {
    const { hasMoreUserPosts, isFetchingMoreUserPosts, userPostsCursor, userPosts } = get();
    if (!hasMoreUserPosts || isFetchingMoreUserPosts || !userPostsCursor || userPosts.length === 0) return;

    set({ isFetchingMoreUserPosts: true });
    try {
      const PAGE_SIZE = 5;
      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles(*), likes(user_id), comments(id)')
        .eq('user_id', userId)
        .lt('created_at', userPostsCursor)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) {
        console.error('Error fetching more user posts:', error);
        set({ isFetchingMoreUserPosts: false });
        return;
      }

      if (data && data.length > 0) {
        const viewerId = currentUserId;
        let processed = data.map((p: any) => ({
          ...p,
          likes_count: p.likes?.length || 0,
          has_liked: p.likes?.some((l: any) => l.user_id === viewerId),
          comments_count: p.comments?.length || 0
        }));

        if (viewerId !== userId && viewerId !== ADMIN_ID && userId !== HUMOR_BOT_ID) {
          const { data: conn } = await supabase
            .from('connections')
            .select('connection_id')
            .eq('user_id', userId)
            .eq('connection_id', viewerId)
            .maybeSingle();

          const isConnection = !!conn;
          processed = processed.filter(post => isPostVisibleToUser(post, viewerId, isConnection));
        }

        const existingIds = new Set(get().userPosts.map(p => p.id));
        const uniqueNew = processed.filter(p => !existingIds.has(p.id));

        set({
          userPosts: [...get().userPosts, ...uniqueNew] as any,
          hasMoreUserPosts: data.length === PAGE_SIZE,
          userPostsCursor: data[data.length - 1].created_at,
          isFetchingMoreUserPosts: false
        });
      } else {
        set({ hasMoreUserPosts: false, isFetchingMoreUserPosts: false });
      }
    } catch (e) {
      console.error('Error in fetchMoreUserPosts:', e);
      set({ isFetchingMoreUserPosts: false });
    }
  },

  fetchFeedPosts: async (currentUserId, refresh = false) => {
    const { isFetchingFeedPosts, feedPosts } = get();
    // If not a forced refresh and posts are already in memory, retain them (preserves cache and scroll height)
    if (!refresh && feedPosts.length > 0) return;
    if (isFetchingFeedPosts) return;

    set({ isFetchingFeedPosts: true });
    try {
      const connIds = await get().fetchConnectionIds(currentUserId, refresh);

      // Always include currentUserId, Admin ID and Humor Bot in feed connections
      const connectionIds = Array.from(new Set([
        currentUserId,
        ADMIN_ID,
        HUMOR_BOT_ID,
        ...connIds
      ]));

      const PAGE_SIZE = 7;
      let query = supabase
        .from('posts')
        .select('*, profiles(*), likes(user_id), comments(id)')
        .lte('created_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (currentUserId !== ADMIN_ID) {
        query = query.in('user_id', connectionIds);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching initial feed posts:', error);
        set({ isFetchingFeedPosts: false });
        return;
      }

      if (data) {
        let processed = data.map((p: any) => ({
          ...p,
          likes_count: p.likes?.length || 0,
          has_liked: p.likes?.some((l: any) => l.user_id === currentUserId),
          comments_count: p.comments?.length || 0
        }));

        processed = processed.filter((post: any) => {
          return isPostVisibleToUser(post, currentUserId, true);
        });

        set({ 
          feedPosts: processed as any,
          hasMoreFeedPosts: data.length === PAGE_SIZE,
          isFetchingFeedPosts: false
        });
      } else {
        set({ feedPosts: [], hasMoreFeedPosts: false, isFetchingFeedPosts: false });
      }
    } catch (e) {
      console.error('Error in fetchFeedPosts:', e);
      set({ isFetchingFeedPosts: false });
    }
  },

  fetchMoreFeedPosts: async (currentUserId) => {
    const { feedPosts, hasMoreFeedPosts, isFetchingMoreFeedPosts } = get();
    if (!hasMoreFeedPosts || isFetchingMoreFeedPosts || feedPosts.length === 0) return;

    set({ isFetchingMoreFeedPosts: true });
    try {
      const oldestPost = feedPosts[feedPosts.length - 1];
      if (!oldestPost || !oldestPost.created_at) {
        set({ isFetchingMoreFeedPosts: false, hasMoreFeedPosts: false });
        return;
      }

      const connIds = await get().fetchConnectionIds(currentUserId);
      const connectionIds = Array.from(new Set([
        currentUserId,
        ADMIN_ID,
        HUMOR_BOT_ID,
        ...connIds
      ]));

      const PAGE_SIZE = 7;
      let query = supabase
        .from('posts')
        .select('*, profiles(*), likes(user_id), comments(id)')
        .lt('created_at', oldestPost.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (currentUserId !== ADMIN_ID) {
        query = query.in('user_id', connectionIds);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching more feed posts:', error);
        set({ isFetchingMoreFeedPosts: false });
        return;
      }

      if (data && data.length > 0) {
        let processed = data.map((p: any) => ({
          ...p,
          likes_count: p.likes?.length || 0,
          has_liked: p.likes?.some((l: any) => l.user_id === currentUserId),
          comments_count: p.comments?.length || 0
        }));

        processed = processed.filter((post: any) => {
          return isPostVisibleToUser(post, currentUserId, true);
        });

        // Deduplicate against loaded posts
        const currentIds = new Set(get().feedPosts.map(p => p.id));
        const newUnique = processed.filter(p => !currentIds.has(p.id));

        set({ 
          feedPosts: [...get().feedPosts, ...newUnique],
          hasMoreFeedPosts: data.length === PAGE_SIZE,
          isFetchingMoreFeedPosts: false
        });
      } else {
        set({ hasMoreFeedPosts: false, isFetchingMoreFeedPosts: false });
      }
    } catch (e) {
      console.error('Error in fetchMoreFeedPosts:', e);
      set({ isFetchingMoreFeedPosts: false });
    }
  },

  fetchUnreadCount: async (userId, scope: UnreadScope = 'all') => {
    const existing = inFlightUnread.get(userId);
    if (existing) {
      const prevPending = pendingUnreadRerun.get(userId);
      const merged: UnreadScope = !prevPending
        ? scope
        : prevPending === scope
          ? scope
          : 'all';
      pendingUnreadRerun.set(userId, merged);
      return existing;
    }

    const effectiveScope: UnreadScope =
      (scope === 'dm' && !cachedUnreadGroups.has(userId)) ||
      (scope === 'group' && !cachedUnreadDms.has(userId))
        ? 'all'
        : scope;

    const fetchDm = effectiveScope === 'all' || effectiveScope === 'dm';
    const fetchGroup = effectiveScope === 'all' || effectiveScope === 'group';

    const task = (async () => {
      try {
        const [dmRes, partRes] = await Promise.all([
          fetchDm
            ? supabase
                .from('messages')
                .select('sender_id')
                .eq('receiver_id', userId)
                .is('read_at', null)
            : Promise.resolve(null),
          fetchGroup
            ? supabase
                .from('group_chat_participants')
                .select('chat_id, last_read_at')
                .eq('user_id', userId)
            : Promise.resolve(null)
        ]);

        if (dmRes && !dmRes.error) {
          const unreadDMs = new Set((dmRes.data || []).map((d: any) => d.sender_id)).size;
          cachedUnreadDms.set(userId, unreadDMs);
        }

        if (partRes && !partRes.error) {
          const validParts = (partRes.data || []).filter((p: any) => !!p.last_read_at);
          let unreadGroups = 0;

          if (validParts.length > 0 && validParts.length <= 15) {
            const orFilter = validParts
              .map((p: any) => {
                const iso = new Date(p.last_read_at).toISOString();
                return `and(group_chat_id.eq.${p.chat_id},created_at.gt.${iso})`;
              })
              .join(',');

            const { data: unreadGroupMsgs, error: groupMsgErr } = await supabase
              .from('messages')
              .select('group_chat_id')
              .neq('sender_id', userId)
              .or(orFilter);

            if (!groupMsgErr && unreadGroupMsgs && unreadGroupMsgs.length < 1000) {
              unreadGroups = new Set(unreadGroupMsgs.map((m: any) => m.group_chat_id)).size;
            } else {
              const results = await Promise.all(
                validParts.map(async (part: any) => {
                  const { count } = await supabase
                    .from('messages')
                    .select('*', { count: 'exact', head: true })
                    .eq('group_chat_id', part.chat_id)
                    .neq('sender_id', userId)
                    .gt('created_at', part.last_read_at);
                  return count && count > 0 ? 1 : 0;
                })
              );
              unreadGroups = results.reduce((acc, val) => acc + val, 0);
            }
          } else if (validParts.length > 15) {
            const results = await Promise.all(
              validParts.map(async (part: any) => {
                const { count } = await supabase
                  .from('messages')
                  .select('*', { count: 'exact', head: true })
                  .eq('group_chat_id', part.chat_id)
                  .neq('sender_id', userId)
                  .gt('created_at', part.last_read_at);
                return count && count > 0 ? 1 : 0;
              })
            );
            unreadGroups = results.reduce((acc, val) => acc + val, 0);
          }

          cachedUnreadGroups.set(userId, unreadGroups);
        }

        const totalDms = cachedUnreadDms.get(userId) ?? 0;
        const totalGroups = cachedUnreadGroups.get(userId) ?? 0;
        set({ totalUnread: totalDms + totalGroups });
      } catch (e) {
        console.warn("Error fetching unread count from Supabase:", e);
      } finally {
        inFlightUnread.delete(userId);
        const nextScope = pendingUnreadRerun.get(userId);
        pendingUnreadRerun.delete(userId);
        if (nextScope) {
          get().fetchUnreadCount(userId, nextScope);
        }
      }
    })();

    inFlightUnread.set(userId, task);
    return task;
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
    const existing = inFlightFeedUnseen.get(userId);
    if (existing) {
      pendingFeedUnseenRerun.add(userId);
      return existing;
    }

    const task = (async () => {
      try {
        // Reuse cached/in-flight profile fetch so startup shares one profiles?select=* query
        const cachedProfile = get().profile;
        const needsProfile = cachedProfile?.id !== userId;

        const [, seenRes, connIds, myPostsRes, myRequestsRes] = await Promise.all([
          needsProfile ? get().fetchProfile(userId) : Promise.resolve(),
          supabase.from('seen_activities').select('activity_id').eq('user_id', userId),
          get().fetchConnectionIds(userId),
          supabase.from('posts').select('id').eq('user_id', userId),
          supabase.from('connection_requests').select('id').eq('receiver_id', userId)
        ]);

        const baseTimestamp = get().profile?.base_timestamp || new Date(0).toISOString();
        const seenIds = new Set((seenRes.data || []).map((s: any) => s.activity_id));

        const connectionIds = Array.from(new Set([
          userId,
          ADMIN_ID,
          HUMOR_BOT_ID,
          ...connIds
        ]));

        const myPostIds = (myPostsRes.data || []).map(p => p.id);
        const myRequestIds = (myRequestsRes.data || []).map(r => r.id);

        const queries = [];

        // 1. Likes/comments on my posts
        if (myPostIds.length > 0) {
          queries.push(
            supabase
              .from('feed_activity')
              .select('id, activity_type, initiator_id, created_at, post_id')
              .in('activity_type', ['like', 'comment'])
              .in('post_id', myPostIds)
              .order('created_at', { ascending: false })
              .limit(15)
          );
        }

        // 2. Tagged/mentioned activities for user
        queries.push(
          supabase
            .from('feed_activity')
            .select('id, activity_type, initiator_id, created_at, post_id, tagged_user_ids, post:posts(user_id, visibility_mode, audience)')
            .contains('tagged_user_ids', [userId])
            .order('created_at', { ascending: false })
            .limit(15)
        );

        // 3. Connection requests meant for user
        if (myRequestIds.length > 0) {
          queries.push(
            supabase
              .from('feed_activity')
              .select('id, activity_type, initiator_id, created_at, connection_request_id')
              .eq('activity_type', 'connection_request')
              .in('connection_request_id', myRequestIds)
              .order('created_at', { ascending: false })
              .limit(15)
          );
        }

        // 4. Posts created by connections (without legacy visible_to column)
        if (connectionIds.length > 0) {
          queries.push(
            supabase
              .from('feed_activity')
              .select('id, activity_type, initiator_id, created_at, post_id, post:posts(user_id, visibility_mode, audience)')
              .in('activity_type', ['post', 'profile_picture'])
              .in('initiator_id', connectionIds)
              .order('created_at', { ascending: false })
              .limit(15)
          );
        }

        const results = await Promise.all(queries);

        const allActivities: any[] = [];
        const seenActivityIds = new Set<string>();

        results.forEach(res => {
          if (res.data) {
            res.data.forEach((act: any) => {
              if (act.activity_type === 'profile_picture' && !act.post_id) {
                return;
              }
              if (act.activity_type === 'post' || act.activity_type === 'profile_picture') {
                const postObj = Array.isArray(act.post) ? act.post[0] : (act.post || (Array.isArray(act.posts) ? act.posts[0] : act.posts));
                if (!postObj || !isPostVisibleToUser(postObj, userId, true)) {
                  return;
                }
              }
              if (!seenActivityIds.has(act.id)) {
                seenActivityIds.add(act.id);
                allActivities.push(act);
              }
            });
          }
        });

        const unseen = allActivities.filter((act: any) => {
          if (act.initiator_id === userId) return false;
          const isOlderThanBase = act.created_at <= baseTimestamp!;
          const isSeen = seenIds.has(act.id);
          return !isOlderThanBase && !isSeen;
        });

        set({ feedUnseenCount: unseen.length });
      } catch (err) {
        console.warn("Error fetching feed unseen count:", err);
      } finally {
        inFlightFeedUnseen.delete(userId);
        if (pendingFeedUnseenRerun.delete(userId)) {
          get().fetchFeedUnseenCount(userId);
        }
      }
    })();

    inFlightFeedUnseen.set(userId, task);
    return task;
  }
}));
