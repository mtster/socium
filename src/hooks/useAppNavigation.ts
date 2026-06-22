import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Profile, Post } from '../types';
import { useStore } from '../store/useStore';

export function useAppNavigation(session: any, fetchProfileData: (uid: string) => void, registerPush: (uid: string) => void) {
  const { 
    floatingAvatar, setFloatingAvatar,
  } = useStore();

  const [activeTab, setActiveTabState] = useState('feed');
  const previousTabRef = useRef('feed');
  const activeTabRef = useRef('feed');
  const mainRef = useRef<HTMLElement>(null);
  
  const setActiveTab = (tab: string) => {
    if (activeTabRef.current === 'feed' && mainRef.current) {
      useStore.getState().setFeedScrollPos(mainRef.current.scrollTop);
    }
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

  const [viewingProfileData, setViewingProfileData] = useState<{ profile: Profile, posts: Post[] } | null>(null);
  const [initialActiveChat, setInitialActiveChat] = useState<Profile | null>(null);
  const [isChatRoomOpen, setIsChatRoomOpen] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [showNotifPromoPopup, setShowNotifPromoPopup] = useState(false);
  const [hasSeenPromo, setHasSeenPromo] = useState(() => localStorage.getItem('first_time_chat_notif') !== null);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const [isFeedInboxOpen, setIsFeedInboxOpen] = useState(false);

  const handleUserClick = async (userId: string, forcePopup = false) => {
    if (!session) return;
    if (userId === session.user.id && !forcePopup) {
      setViewingProfileId(null);
      setActiveTab('profile');
      mainRef.current?.scrollTo(0, 0);
      return;
    }

    setViewingProfileId(userId);
    setViewingProfileData(null); // Clear previous data so it goes back to loading state
    
    // Fetch other user's profile
    const { data: pData, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    
    if (error || !pData) {
      console.error('Profile not found:', error);
      setViewingProfileData({ 
        profile: { id: userId, username: 'Unknown User', full_name: 'Unknown User', avatar_url: null, updated_at: new Date().toISOString() }, 
        posts: [] 
      });
      return;
    }
    
    const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
    let query = supabase.from('posts').select('*, profiles(*)').eq('user_id', userId);
    if (session?.user?.id !== ADMIN_ID) {
      query = query.lte('created_at', new Date().toISOString());
    }
    const { data: postsData } = await query.order('created_at', { ascending: false });
    
    setViewingProfileData({ profile: pData, posts: postsData as any || [] });
  };

  // Custom events and listeners
  useEffect(() => {
    const handleOpenChat = (e: any) => {
      setFloatingAvatar(null);
      setInitialActiveChat(e.detail.profile);
      setViewingProfileId(null);
      setActiveTab('chat');
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
      if (e.detail?.tabId === 'chat') {
        if (initialActiveChat) {
          setInitialActiveChat(null);
        } else {
          mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else {
        mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
        window.history.replaceState({}, document.title, window.location.pathname);
        setFloatingAvatar(null);
        setInitialActiveChat(senderProfile);
        setViewingProfileId(null);
        setActiveTab('chat');
        return;
      }
    } catch (err) {
      console.warn("Not a profiles row, checking group_chats:", err);
    }

    try {
      const { data: groupChat } = await supabase.from('group_chats').select('*').eq('id', chatWith).single();
      if (groupChat) {
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
            return;
          }
        } else if (senderId) {
          const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', senderId).single();
          if (senderProfile) {
            setFloatingAvatar(null);
            setInitialActiveChat(senderProfile);
            setViewingProfileId(null);
            setActiveTab('chat');
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
    if (session) {
      checkUrlParamsAndRoute();
      checkNotificationRouteAndNavigate();
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [session]);

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
             }
          } else if (senderId) {
            const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', senderId).single();
            if (senderProfile) {
               setFloatingAvatar(null);
               setInitialActiveChat(senderProfile);
               setViewingProfileId(null);
               setActiveTab('chat');
            } else {
               const { data: groupChat } = await supabase.from('group_chats').select('*').eq('id', senderId).single();
               if (groupChat) {
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

  useEffect(() => {
    if (activeTab !== 'feed' && !sessionStorage.getItem('scroll_to_post_id')) {
      if (mainRef.current) {
        mainRef.current.scrollTop = 0;
      }
    }
  }, [activeTab]);

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
    handleUserClick
  };
}
