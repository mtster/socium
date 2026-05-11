import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Profile, Post } from '@/src/types';
import { useStore } from '@/src/store/useStore';
import { initPresence } from '@/src/lib/presence';
import { ref, set } from 'firebase/database';
import { rtdb } from '@/src/lib/firebase';

export function useAppLogic() {
  const { 
    profile, setProfile, 
    userPosts, setUserPosts, 
    totalUnread, setTotalUnread, 
    floatingAvatar, setFloatingAvatar,
    fetchProfile, fetchUserPosts, fetchUnreadCount,
    fetchPendingRequestsCount
  } = useStore();

  const [session, setSession] = useState<any>(undefined);
  const [activeTab, setActiveTabState] = useState('feed');
  const previousTabRef = useRef('feed');
  const activeTabRef = useRef('feed');
  const mainRef = useRef<HTMLElement>(null);
  
  const setActiveTab = useCallback((tab: string) => {
    previousTabRef.current = activeTabRef.current;
    activeTabRef.current = tab;
    setActiveTabState(tab);
  }, []);
  
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  const viewingProfileIdRef = useRef<string | null>(null);
  const [viewingProfileData, setViewingProfileData] = useState<{ profile: Profile, posts: Post[] } | null>(null);
  const [initialActiveChat, setInitialActiveChat] = useState<Profile | null>(null);
  const [isChatRoomOpen, setIsChatRoomOpen] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [showNotifPromoPopup, setShowNotifPromoPopup] = useState(false);
  const [hasSeenPromo, setHasSeenPromo] = useState(() => localStorage.getItem('first_time_chat_notif') !== null);
  const [notifPermission, setNotifPermission] = useState(typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default');

  useEffect(() => {
    viewingProfileIdRef.current = viewingProfileId;
  }, [viewingProfileId]);

  const handleUserClick = useCallback(async (userId: string) => {
    if (!session) return;
    if (userId === session.user.id) {
      setViewingProfileId(null);
      setActiveTab('profile');
      if (mainRef.current) mainRef.current.scrollTo(0, 0);
      return;
    }

    setViewingProfileId(userId);
    setViewingProfileData(null);
    
    const { data: pData, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error || !pData) {
      setViewingProfileData({ 
        profile: { id: userId, username: 'Unknown User', full_name: 'Unknown User', avatar_url: null, updated_at: new Date().toISOString() }, 
        posts: [] 
      });
      return;
    }
    const { data: postsData } = await supabase.from('posts').select('*, profiles(*)').eq('user_id', userId).order('created_at', { ascending: false });
    setViewingProfileData({ profile: pData, posts: postsData as any || [] });
  }, [session, setActiveTab]);

  const fetchProfileData = useCallback(async (userId: string) => {
    try {
      await fetchProfile(userId);
      const currentProfile = useStore.getState().profile;
      if (!currentProfile || currentProfile.id !== userId) {
        // Create initial if needed
        const username = session?.user?.email?.split('@')[0] || `user_${userId.slice(0, 5)}`;
        const { data: newProfile, error } = await supabase.from('profiles').upsert({
            id: userId,
            username,
            full_name: session?.user?.user_metadata?.full_name || username,
            avatar_url: session?.user?.user_metadata?.avatar_url || null,
            email: session?.user?.email || null,
            updated_at: new Date().toISOString(),
        }).select().single();
        if (!error && newProfile) setProfile(newProfile);
        if (rtdb) {
            await set(ref(rtdb, `unseen_chat_count/${userId}`), 0);
            await set(ref(rtdb, `location/${userId}`), 'none');
            await set(ref(rtdb, `global_presence/${userId}`), true);
        }
      }
      fetchUserPosts(userId, userId);
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  }, [fetchProfile, fetchUserPosts, session, setProfile]);

  const registerPush = useCallback(async (userId: string, isUserAction = false) => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const { requestFirebaseNotificationPermission } = await import('@/src/lib/firebase');
      const token = await requestFirebaseNotificationPermission();
      setNotifPermission(Notification.permission);
      if (!token) {
        if (isUserAction) alert('Could not enable notifications.');
        return;
      }
      await supabase.from('push_subscriptions').upsert({ user_id: userId, endpoint: token, p256dh_key: 'FCM', auth_key: 'FCM' }, { onConflict: 'user_id, endpoint' });
    } catch (e: any) {
      if (isUserAction) alert(`Push registration failed: ${e.message}`);
    }
  }, []);

  const handleDeletePost = useCallback(async (postId: string) => {
    try {
      const { error } = await supabase.from('posts').delete().eq('id', postId);
      if (error) throw error;
      setUserPosts(userPosts.filter(p => p.id !== postId));
      if (viewingProfileData) {
        setViewingProfileData({ ...viewingProfileData, posts: viewingProfileData.posts.filter(p => p.id !== postId) });
      }
    } catch (error: any) {
      alert(`Failed to delete: ${error.message}`);
    }
  }, [userPosts, setUserPosts, viewingProfileData]);

  const handleLikeProfilePost = useCallback(async (postId: string, isLiked: boolean) => {
    if (!session) return;
    setUserPosts(userPosts.map(p => {
      if (p.id === postId) return { ...p, has_liked: !isLiked, likes_count: (p.likes_count || 0) + (isLiked ? -1 : 1) };
      return p;
    }));
    try {
      if (isLiked) await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', session.user.id);
      else await supabase.from('likes').insert({ post_id: postId, user_id: session.user.id });
    } catch (e) {
      fetchUserPosts(viewingProfileId || session.user.id, session.user.id);
    }
  }, [session, userPosts, setUserPosts, fetchUserPosts, viewingProfileId]);

  // Auth and Global Listeners
  useEffect(() => {
    let unmountPresence: (() => void) | undefined;
    if (session?.user?.id) { unmountPresence = initPresence(session.user.id); }

    const handleOpenChat = (e: any) => {
      setFloatingAvatar(null);
      setInitialActiveChat(e.detail.profile);
      setViewingProfileId(null);
      setActiveTab('chat');
    };
    const handleOpenProfile = (e: any) => { setInitialActiveChat(null); handleUserClick(e.detail.userId); };
    const handleViewerState = (e: any) => { setIsImageViewerOpen(e.detail.isOpen); };
    const handleResetTab = (e: any) => {
      if (viewingProfileIdRef.current !== null) { setViewingProfileId(null); return; }
      if (e.detail?.tabId === 'chat') {
        if (initialActiveChat) setInitialActiveChat(null);
        else mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } else { mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }
    };

    window.addEventListener('openChat', handleOpenChat);
    window.addEventListener('openProfile', handleOpenProfile);
    window.addEventListener('viewerState', handleViewerState);
    window.addEventListener('resetTab', handleResetTab);

    if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
      window.history.replaceState({}, document.title, '/');
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session) { fetchProfileData(session.user.id); registerPush(session.user.id); }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session) { fetchProfileData(session.user.id); registerPush(session.user.id); }
    });

    return () => {
      if (unmountPresence) unmountPresence();
      subscription.unsubscribe();
      window.removeEventListener('openChat', handleOpenChat);
      window.removeEventListener('openProfile', handleOpenProfile);
      window.removeEventListener('viewerState', handleViewerState);
      window.removeEventListener('resetTab', handleResetTab);
    };
  }, [session?.user?.id, handleUserClick, fetchProfileData, registerPush, initialActiveChat, setActiveTab]);

  // Unread counts and RT listeners
  useEffect(() => {
    if (session?.user?.id) {
      const getUnread = () => fetchUnreadCount(session.user.id);
      const getPending = () => fetchPendingRequestsCount(session.user.id);
      
      const forceGetUnreadHandler = () => getUnread();
      window.addEventListener('forceGetUnread', forceGetUnreadHandler);

      getUnread();
      getPending();

      const globalUnreadChannel = supabase.channel('global_unread')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${session.user.id}` }, async (payload) => {
            getUnread();
            const senderId = payload.new.sender_id;
            if ((window as any).currentChatUserId !== senderId) {
              const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', senderId).single();
              if (senderProfile && (window as any).currentActiveTab !== 'chat') {
                setFloatingAvatar(senderProfile);
                setTimeout(() => setFloatingAvatar(null), 4000);
              }
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `receiver_id=eq.${session.user.id}` }, () => getUnread())
        .subscribe();

      const connectionsChannel = supabase.channel('global_connections')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'connections', filter: `receiver_id=eq.${session.user.id}` }, () => getPending())
        .subscribe();
        
      return () => {
        window.removeEventListener('forceGetUnread', forceGetUnreadHandler);
        supabase.removeChannel(globalUnreadChannel);
        supabase.removeChannel(connectionsChannel);
      };
    }
  }, [session?.user?.id, fetchUnreadCount, fetchPendingRequestsCount, setFloatingAvatar]);

  return {
    session, activeTab, setActiveTab, previousTabRef, activeTabRef, mainRef,
    profile, userPosts, totalUnread, floatingAvatar, setFloatingAvatar,
    viewingProfileId, setViewingProfileId, viewingProfileData, setViewingProfileData,
    initialActiveChat, setInitialActiveChat, isChatRoomOpen, setIsChatRoomOpen, isImageViewerOpen,
    showNotifPromoPopup, setShowNotifPromoPopup, hasSeenPromo, setHasSeenPromo,
    notifPermission, setNotifPermission,
    handleUserClick, handleDeletePost, handleLikeProfilePost, registerPush, fetchProfileData
  };
}
