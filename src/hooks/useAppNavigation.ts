import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Profile, Post } from '../types';
import { useStore } from '../store/useStore';
import { isPostVisibleToUser } from '../lib/visibility';

export function useAppNavigation(session: any, fetchProfileData: (uid: string) => void, registerPush: (uid: string) => void) {
  const { 
    floatingAvatar, setFloatingAvatar,
  } = useStore();

  const [activeTab, setActiveTabState] = useState('feed');
  const previousTabRef = useRef('feed');
  const activeTabRef = useRef('feed');
  const mainRef = useRef<HTMLElement>(null);

  if (typeof window !== 'undefined' && !(window as any).currentActiveTab) {
    (window as any).currentActiveTab = 'feed';
  }
  
  const setActiveTab = (tab: string) => {
    (window as any).currentActiveTab = tab;
    previousTabRef.current = activeTabRef.current;
    activeTabRef.current = tab;
    setActiveTabState(tab);
  };
  
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  const viewingProfileIdRef = useRef<string | null>(null);
  
  // Sync state to ref
  useEffect(() => {
    viewingProfileIdRef.current = viewingProfileId;
  }, [viewingProfileId]);

  const [viewingProfileData, setViewingProfileData] = useState<{
    profile: Profile;
    posts: Post[];
    hasMorePosts: boolean;
    cursorCreatedAt: string | null;
    isConnection: boolean;
    isLoadingMore?: boolean;
  } | null>(null);
  const isFetchingMoreOtherRef = useRef(false);
  const [initialActiveChat, setInitialActiveChat] = useState<Profile | null>(null);
  const [isChatRoomOpen, setIsChatRoomOpen] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [showNotifPromoPopup, setShowNotifPromoPopup] = useState(false);
  const [hasSeenPromo, setHasSeenPromo] = useState(() => localStorage.getItem('first_time_chat_notif') !== null);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const [isFeedInboxOpen, setIsFeedInboxOpen] = useState(false);

  const PROFILE_POSTS_PAGE_SIZE = 5;

  const fetchFilteredProfilePostsPage = async (
    userId: string,
    currentUserId: string | undefined,
    isConnection: boolean,
    initialCursor: string | null = null
  ): Promise<{ posts: Post[]; hasMorePosts: boolean; cursorCreatedAt: string | null }> => {
    const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
    const collected: Post[] = [];
    let cursor = initialCursor;
    let hasMorePosts = false;
    let guard = 0;

    while (guard < 4) {
      guard++;
      let query = supabase
        .from('posts')
        .select('*, profiles(*), likes(user_id), comments(id)')
        .eq('user_id', userId);

      if (currentUserId !== ADMIN_ID) {
        query = query.lte('created_at', new Date().toISOString());
      }
      if (cursor) {
        query = query.lt('created_at', cursor);
      }

      const { data: postsData } = await query
        .order('created_at', { ascending: false })
        .limit(PROFILE_POSTS_PAGE_SIZE);

      const rows = postsData || [];
      cursor = rows.length > 0 ? rows[rows.length - 1].created_at : cursor;
      hasMorePosts = rows.length === PROFILE_POSTS_PAGE_SIZE;

      let mapped = rows.map((p: any) => ({
        ...p,
        likes_count: p.likes?.length || 0,
        has_liked: p.likes?.some((l: any) => l.user_id === currentUserId),
        comments_count: p.comments?.length || 0
      }));

      if (currentUserId && currentUserId !== userId && currentUserId !== ADMIN_ID && userId !== '00000000-0000-0000-0000-000000000001') {
        mapped = mapped.filter((post: any) => isPostVisibleToUser(post, currentUserId, isConnection));
      }

      collected.push(...mapped);
      if (collected.length > 0 || !hasMorePosts) {
        break;
      }
    }

    return { posts: collected, hasMorePosts, cursorCreatedAt: cursor };
  };

  const handleUserClick = async (userId: string, forcePopup = false) => {
    if (!session) return;
    if (userId === session.user.id && !forcePopup) {
      setViewingProfileId(null);
      setActiveTab('profile');
      mainRef.current?.querySelector('.overflow-y-auto')?.scrollTo(0, 0);
      return;
    }

    setViewingProfileId(userId);
    setViewingProfileData(null); // Clear previous data so it goes back to loading state

    const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
    const currentUserId = session?.user?.id;
    const needsConnCheck = !!(
      currentUserId &&
      currentUserId !== userId &&
      currentUserId !== ADMIN_ID &&
      userId !== '00000000-0000-0000-0000-000000000001'
    );

    let initialQuery = supabase
      .from('posts')
      .select('*, profiles(*), likes(user_id), comments(id)')
      .eq('user_id', userId);
    if (currentUserId !== ADMIN_ID) {
      initialQuery = initialQuery.lte('created_at', new Date().toISOString());
    }

    // Fetch profile, first 5 posts, and connection status concurrently (zero waterfall)
    const [profileRes, postsRes, connRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      initialQuery.order('created_at', { ascending: false }).limit(PROFILE_POSTS_PAGE_SIZE),
      needsConnCheck
        ? supabase
            .from('connections')
            .select('connection_id')
            .eq('user_id', userId)
            .eq('connection_id', currentUserId)
            .maybeSingle()
        : Promise.resolve({ data: { connection_id: userId } })
    ]);

    const { data: pData, error } = profileRes;
    if (error || !pData) {
      console.error('Profile not found:', error);
      setViewingProfileData({ 
        profile: { id: userId, username: 'Unknown User', full_name: 'Unknown User', avatar_url: null, updated_at: new Date().toISOString() }, 
        posts: [],
        hasMorePosts: false,
        cursorCreatedAt: null,
        isConnection: false
      });
      return;
    }

    const isConnection = !!connRes?.data;
    const rawRows = postsRes.data || [];
    let cursorCreatedAt: string | null = rawRows.length > 0 ? rawRows[rawRows.length - 1].created_at : null;
    let hasMorePosts = rawRows.length === PROFILE_POSTS_PAGE_SIZE;

    let finalPosts = rawRows.map((p: any) => ({
      ...p,
      likes_count: p.likes?.length || 0,
      has_liked: p.likes?.some((l: any) => l.user_id === currentUserId),
      comments_count: p.comments?.length || 0
    }));

    if (needsConnCheck) {
      finalPosts = finalPosts.filter((post: any) => isPostVisibleToUser(post, currentUserId, isConnection));
    }

    // If all 5 initial posts were filtered out by visibility rules and more exist, pull the next page
    if (finalPosts.length === 0 && hasMorePosts && cursorCreatedAt) {
      const nextPage = await fetchFilteredProfilePostsPage(userId, currentUserId, isConnection, cursorCreatedAt);
      finalPosts = nextPage.posts;
      hasMorePosts = nextPage.hasMorePosts;
      cursorCreatedAt = nextPage.cursorCreatedAt;
    }

    setViewingProfileData({
      profile: pData,
      posts: finalPosts,
      hasMorePosts,
      cursorCreatedAt,
      isConnection,
      isLoadingMore: false
    });
  };

  const loadMoreOtherProfilePosts = async () => {
    if (!viewingProfileData || !viewingProfileData.hasMorePosts || isFetchingMoreOtherRef.current) return;
    if (!viewingProfileData.cursorCreatedAt) return;

    const targetProfileId = viewingProfileData.profile.id;
    isFetchingMoreOtherRef.current = true;
    setViewingProfileData(prev => prev ? { ...prev, isLoadingMore: true } : prev);

    try {
      const nextPage = await fetchFilteredProfilePostsPage(
        targetProfileId,
        session?.user?.id,
        viewingProfileData.isConnection,
        viewingProfileData.cursorCreatedAt
      );

      setViewingProfileData(prev => {
        if (!prev || prev.profile.id !== targetProfileId) return prev;
        const existingIds = new Set(prev.posts.map(p => p.id));
        const uniqueNew = nextPage.posts.filter(p => !existingIds.has(p.id));
        return {
          ...prev,
          posts: [...prev.posts, ...uniqueNew],
          hasMorePosts: nextPage.hasMorePosts,
          cursorCreatedAt: nextPage.cursorCreatedAt,
          isLoadingMore: false
        };
      });
    } catch (e) {
      console.error('Error loading more profile posts:', e);
      setViewingProfileData(prev => prev ? { ...prev, isLoadingMore: false } : prev);
    } finally {
      isFetchingMoreOtherRef.current = false;
    }
  };

  // Custom events and listeners
  useEffect(() => {
    const handleOpenChat = (e: any) => {
      const targetChatId = e.detail.profile.id;
      const alreadyOpen = (window as any).currentChatUserId === targetChatId;
      setFloatingAvatar(null);
      setInitialActiveChat(e.detail.profile);
      setViewingProfileId(null);
      setActiveTab('chat');
      if (alreadyOpen) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('refreshActiveChat', { detail: { chatId: targetChatId } }));
        }, 50);
      }
    };
    
    const handleOpenProfile = (e: any) => {
      const targetUserId = e.detail?.userId;
      const forcePopup = e.detail?.forcePopup || false;
      if (session?.user?.id && targetUserId === session.user.id && !forcePopup) {
        setInitialActiveChat(null);
      }
      handleUserClick(targetUserId, forcePopup);
    };
    
    const handleOpenOwnProfileAndScroll = (e: any) => {
      const postId = e.detail?.postId;
      if (postId) {
        sessionStorage.setItem("scroll_to_post_id", postId);
      }
      setInitialActiveChat(null);
      setViewingProfileId(null);
      setActiveTab('profile');
    };
    
    const handleViewerState = (e: any) => {
      setIsImageViewerOpen(e.detail.isOpen);
    };
    
    const handleResetTab = (e: any) => {
      if (viewingProfileIdRef.current !== null) {
        setViewingProfileId(null);
        return; // Just close the popup, do not scroll
      }
      
      const scrollable = mainRef.current?.querySelector('.overflow-y-auto');
      
      if (e.detail?.tabId === 'chat') {
        if (initialActiveChat) {
          setInitialActiveChat(null);
        } else {
          scrollable?.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else {
        scrollable?.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    
    const handleSetHeaderHidden = (e: any) => {
      setIsHeaderHidden(!!e.detail);
    };

    window.addEventListener('openChat', handleOpenChat);
    window.addEventListener('openProfile', handleOpenProfile);
    window.addEventListener('openOwnProfileAndScroll', handleOpenOwnProfileAndScroll);
    window.addEventListener('viewerState', handleViewerState);
    window.addEventListener('resetTab', handleResetTab);
    window.addEventListener('set-header-hidden', handleSetHeaderHidden);

    return () => {
      window.removeEventListener('openChat', handleOpenChat);
      window.removeEventListener('openProfile', handleOpenProfile);
      window.removeEventListener('openOwnProfileAndScroll', handleOpenOwnProfileAndScroll);
      window.removeEventListener('viewerState', handleViewerState);
      window.removeEventListener('resetTab', handleResetTab);
      window.removeEventListener('set-header-hidden', handleSetHeaderHidden);
    };
  }, [session, initialActiveChat]);

  // Visibility and link parameters
  const checkUrlParamsAndRoute = async () => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const chatWith = urlParams.get('chat_with') || urlParams.get('chatId');
    const activityId = urlParams.get('activity_id');
    
    if (activityId) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setActiveTab('feed');
      setIsFeedInboxOpen(true);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('openActivityId', { detail: { activityId } }));
      }, 500);
      return;
    }
    
    if (!chatWith) return;

    try {
      const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', chatWith).single();
      if (senderProfile) {
        const alreadyOpen = (window as any).currentChatUserId === senderProfile.id;
        window.history.replaceState({}, document.title, window.location.pathname);
        setFloatingAvatar(null);
        setInitialActiveChat(senderProfile);
        setViewingProfileId(null);
        setActiveTab('chat');
        if (alreadyOpen) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('refreshActiveChat', { detail: { chatId: senderProfile.id } }));
          }, 50);
        }
        return;
      }
    } catch (err) {
      console.warn("Not a profiles row, checking group_chats:", err);
    }

    try {
      const { data: groupChat } = await supabase.from('group_chats').select('*').eq('id', chatWith).single();
      if (groupChat) {
        const alreadyOpen = (window as any).currentChatUserId === groupChat.id;
        window.history.replaceState({}, document.title, window.location.pathname);
        setFloatingAvatar(null);
        setInitialActiveChat({
          id: groupChat.id,
          username: groupChat.name || 'Group',
          full_name: groupChat.name || 'Group',
          avatar_url: groupChat.avatar_url || null,
          isGroup: true
        } as any);
        setViewingProfileId(null);
        setActiveTab('chat');
        if (alreadyOpen) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('refreshActiveChat', { detail: { chatId: groupChat.id } }));
          }, 50);
        }
        return;
      }
    } catch (err) {
      console.warn("Not a group chat row either:", err);
    }

    window.history.replaceState({}, document.title, window.location.pathname);
    setInitialActiveChat(null);
    setActiveTab('chat');
  };

  const checkNotificationRouteAndNavigate = async () => {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    try {
      const cache = await caches.open('notification-route');
      const response = await cache.match('/target-route');
      if (response) {
        const data = await response.json();
        await cache.delete('/target-route');
        
        const senderId = data.senderId;
        const groupChatId = data.groupChatId;
        const targetUrl = data.url;

        let activityId = null;
        if (targetUrl) {
          try {
            const parsed = new URL(targetUrl);
            activityId = parsed.searchParams.get('activity_id');
          } catch(e) {}
        }
        
        if (activityId) {
          setActiveTab('feed');
          setIsFeedInboxOpen(true);
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('openActivityId', { detail: { activityId } }));
          }, 500);
          return;
        }
        
        if (groupChatId) {
          const { data: groupChat } = await supabase.from('group_chats').select('*').eq('id', groupChatId).single();
          if (groupChat) {
            const alreadyOpen = (window as any).currentChatUserId === groupChat.id;
            setFloatingAvatar(null);
            setInitialActiveChat({
              id: groupChat.id,
              username: groupChat.name || 'Group',
              full_name: groupChat.name || 'Group',
              avatar_url: groupChat.avatar_url || null,
              isGroup: true
            } as any);
            setViewingProfileId(null);
            setActiveTab('chat');
            if (alreadyOpen) {
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('refreshActiveChat', { detail: { chatId: groupChat.id } }));
              }, 50);
            }
            return;
          }
        } else if (senderId) {
          const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', senderId).single();
          if (senderProfile) {
            const alreadyOpen = (window as any).currentChatUserId === senderProfile.id;
            setFloatingAvatar(null);
            setInitialActiveChat(senderProfile);
            setViewingProfileId(null);
            setActiveTab('chat');
            if (alreadyOpen) {
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('refreshActiveChat', { detail: { chatId: senderProfile.id } }));
              }, 50);
            }
            return;
          }
        }
        
        setInitialActiveChat(null);
        setActiveTab('chat');
      }
    } catch (err) {
      console.warn('Error checking stored notification route:', err);
    }
  };

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkUrlParamsAndRoute();
        checkNotificationRouteAndNavigate();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }
    if (session?.user?.id) {
      checkUrlParamsAndRoute();
      checkNotificationRouteAndNavigate();
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const handleMessage = async (event: MessageEvent) => {
        if (event.data === 'PING_VISIBILITY' && event.ports[0]) {
          if (document.visibilityState === 'visible') {
            event.ports[0].postMessage('VISIBLE');
          }
        }
        if (event.data && event.data.type === 'OPEN_CHAT') {
          const senderId = event.data.senderId || event.data.sender_id;
          const groupChatId = event.data.groupChatId || event.data.group_chat_id;
          const targetUrl = event.data.url;
          
          if (typeof window !== 'undefined' && 'caches' in window) {
            caches.open('notification-route').then(c => c.delete('/target-route')).catch(() => {});
          }
          
          let activityId = null;
          if (targetUrl) {
            try {
              const parsed = new URL(targetUrl);
              activityId = parsed.searchParams.get('activity_id');
            } catch(e) {}
          }
          
          if (activityId) {
            setActiveTab('feed');
            setIsFeedInboxOpen(true);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('openActivityId', { detail: { activityId } }));
            }, 500);
            return;
          }
          
          if (groupChatId) {
             const { data: groupChat } = await supabase.from('group_chats').select('*').eq('id', groupChatId).single();
             if (groupChat) {
               const alreadyOpen = (window as any).currentChatUserId === groupChat.id;
               setFloatingAvatar(null);
               setInitialActiveChat({
                 id: groupChat.id,
                 username: groupChat.name || 'Group',
                 full_name: groupChat.name || 'Group',
                 avatar_url: groupChat.avatar_url || null,
                 isGroup: true
               } as any);
               setViewingProfileId(null);
               setActiveTab('chat');
               if (alreadyOpen) {
                 setTimeout(() => {
                   window.dispatchEvent(new CustomEvent('refreshActiveChat', { detail: { chatId: groupChat.id } }));
                 }, 50);
               }
             }
          } else if (senderId) {
            const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', senderId).single();
            if (senderProfile) {
               const alreadyOpen = (window as any).currentChatUserId === senderProfile.id;
               setFloatingAvatar(null);
               setInitialActiveChat(senderProfile);
               setViewingProfileId(null);
               setActiveTab('chat');
               if (alreadyOpen) {
                 setTimeout(() => {
                   window.dispatchEvent(new CustomEvent('refreshActiveChat', { detail: { chatId: senderProfile.id } }));
                 }, 50);
               }
            } else {
               const { data: groupChat } = await supabase.from('group_chats').select('*').eq('id', senderId).single();
               if (groupChat) {
                 const alreadyOpen = (window as any).currentChatUserId === groupChat.id;
                 setFloatingAvatar(null);
                 setInitialActiveChat({
                   id: groupChat.id,
                   username: groupChat.name || 'Group',
                   full_name: groupChat.name || 'Group',
                   avatar_url: groupChat.avatar_url || null,
                   isGroup: true
                 } as any);
                 setViewingProfileId(null);
                 setActiveTab('chat');
                 if (alreadyOpen) {
                   setTimeout(() => {
                     window.dispatchEvent(new CustomEvent('refreshActiveChat', { detail: { chatId: groupChat.id } }));
                   }, 50);
                 }
               }
            }
          }
        }
        if (event.data && event.data.type === 'OPEN_REQUESTS') {
           setActiveTab('profile');
           setTimeout(() => {
             window.dispatchEvent(new CustomEvent('openRequestsUI'));
           }, 100);
        }
      };
      
      navigator.serviceWorker.addEventListener('message', handleMessage);
      return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'chat' && !hasSeenPromo && session?.user) {
      setHasSeenPromo(true);
      setShowNotifPromoPopup(true);
      localStorage.setItem('first_time_chat_notif', 'true');
    }
  }, [activeTab, session?.user, hasSeenPromo]);

  return {
    activeTab,
    setActiveTab,
    previousTabRef,
    activeTabRef,
    mainRef,
    viewingProfileId,
    setViewingProfileId,
    viewingProfileData,
    setViewingProfileData,
    initialActiveChat,
    setInitialActiveChat,
    isChatRoomOpen,
    setIsChatRoomOpen,
    isImageViewerOpen,
    setIsImageViewerOpen,
    showNotifPromoPopup,
    setShowNotifPromoPopup,
    hasSeenPromo,
    setHasSeenPromo,
    isHeaderHidden,
    setIsHeaderHidden,
    isFeedInboxOpen,
    setIsFeedInboxOpen,
    handleUserClick,
    loadMoreOtherProfilePosts
  };
}
