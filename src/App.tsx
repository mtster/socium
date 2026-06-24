import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import BottomNav from './components/BottomNav';
import AuthView from './components/Auth';
import CreatePost from './components/CreatePost';
import Feed from './components/Feed';
import FeedInbox from './components/feed/FeedInbox';
import ProfileView from './components/Profile';
import Chat from './components/Chat';
import { Profile, Post } from './types';
import { motion, AnimatePresence } from 'motion/react';
import AddToHomeScreenModal from './components/AddToHomeScreenModal';
import CompleteProfileModal from './components/CompleteProfileModal';
import SharePostModal from './components/SharePostModal';
import { Bell, ArrowLeft, Inbox } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { useStore } from './store/useStore';
import { CallsManager } from './components/chat/CallsManager';
import ErudaDevTools from './components/ErudaDevTools';

import { usePushNotifications } from './hooks/usePushNotifications';
import { useUserProfile } from './hooks/useUserProfile';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { logFeedActivity } from './lib/feed';

import { rtdb } from './lib/firebase';
import { ref, set } from 'firebase/database';

export default function App() {
  const { 
    profile, setProfile, 
    userPosts, setUserPosts, 
    totalUnread,
    floatingAvatar, setFloatingAvatar,
    fetchProfile, fetchUserPosts, 
  } = useStore();

  const [session, setSession] = useState<any>(undefined);

  // Eruda Tap System
  const [headerTapCount, setHeaderTapCount] = useState(0);
  const [lastTapTime, setLastTapTime] = useState(0);

  const handleHeaderClick = () => {
    const now = Date.now();
    if (now - lastTapTime < 1000) {
      const nextCount = headerTapCount + 1;
      setHeaderTapCount(nextCount);
      if (nextCount >= 5) {
        setHeaderTapCount(0);
        const currentActive = sessionStorage.getItem('eruda_active') === 'true';
        if (currentActive) {
          sessionStorage.removeItem('eruda_active');
          toast.success('Eruda DevTools disabled! Reloading...', { icon: '🛠️' });
        } else {
          sessionStorage.setItem('eruda_active', 'true');
          toast.success('Eruda DevTools enabled! Reloading...', { icon: '🛠️' });
        }
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } else {
      setHeaderTapCount(1);
    }
    setLastTapTime(now);
  };

  // 1. Push Notifications State Manager
  const {
    notifPermission,
    hasPushSubscription,
    registerPush
  } = usePushNotifications(session?.user?.id);

  // 2. Profile and Auto-connections Manager
  const {
    isProfileError,
    fetchProfileData,
  } = useUserProfile(session, (uid) => registerPush(uid));

  // 3. App Navigation State, Listeners & Deep Links
  const {
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
    showNotifPromoPopup,
    setShowNotifPromoPopup,
    hasSeenPromo,
    isHeaderHidden,
    isFeedInboxOpen,
    setIsFeedInboxOpen,
    handleUserClick
  } = useAppNavigation(session, fetchProfileData, (uid) => registerPush(uid));

  // 4. Live Sync Multi-Source DB Managers
  const {
    vibeInitiatorProfile,
    handleClearVibeBubble,
    feedUnseenCount,
  } = useRealtimeSync({
    userId: session?.user?.id,
    activeTab,
    isFeedInboxOpen,
    setActiveTab,
    setIsFeedInboxOpen,
    handleUserClick,
    setInitialActiveChat,
  });

  const tabWeights: Record<string, number> = {
    feed: 0,
    create: 1,
    chat: 2,
    profile: 3,
  };

  const prevWeight = tabWeights[previousTabRef.current] ?? 0;
  const currentWeight = tabWeights[activeTab] ?? 0;
  const isMovingRight = currentWeight > prevWeight;

  // 4. Initial session bootstrap
  useEffect(() => {
    // If returning from OAuth provider, clean up the URL to prevent showing the callback path
    if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
      window.history.replaceState({}, document.title, '/');
    }

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      if (currentSession) {
        fetchProfileData(currentSession.user.id);
        registerPush(currentSession.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      if (currentSession) {
        fetchProfileData(currentSession.user.id);
        registerPush(currentSession.user.id);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleDeletePost = async (postId: string) => {
    try {
      const { error } = await supabase.from('posts').delete().eq('id', postId);
      if (error) throw error;
      setUserPosts(userPosts.filter(p => p.id !== postId));
      if (viewingProfileData) {
        setViewingProfileData({
          ...viewingProfileData,
          posts: viewingProfileData.posts.filter(p => p.id !== postId)
        });
      }
    } catch (error: any) {
      alert(`Failed to delete: ${error.message}`);
    }
  };



  // Reload posts when switching back to profile tab
  useEffect(() => {
    if (session?.user?.id && activeTab === 'profile') {
      fetchUserPosts(session.user.id, session.user.id);
    }
  }, [activeTab, session?.user]);

  const handleLikeProfilePost = async (postId: string, isLiked: boolean) => {
    // Optimistic Update
    setUserPosts(userPosts.map(p => {
      if (p.id === postId) {
        return {
          ...p,
          has_liked: !isLiked,
          likes_count: (p.likes_count || 0) + (isLiked ? -1 : 1)
        };
      }
      return p;
    }));

    try {
      if (isLiked) {
        await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', session.user.id);
        // Also remove from feed_activity table
        await supabase.from('feed_activity').delete().eq('post_id', postId).eq('initiator_id', session.user.id).eq('activity_type', 'like');
      } else {
        await supabase.from('likes').insert({ post_id: postId, user_id: session.user.id });
        await logFeedActivity({
          activityType: 'like',
          initiatorId: session.user.id,
          postId: postId
        });
      }
    } catch (e) {
      console.error(e);
      // Revert if error
      fetchUserPosts(viewingProfileId || session.user.id, session.user.id);
    }
  };

  if (session === undefined) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-8 text-center animate-pulse">
        <div className="w-16 h-16 bg-white text-black rounded-2xl flex items-center justify-center font-black text-3xl mb-6 shadow-[0_0_30px_rgba(255,255,255,0.1)]">S</div>
        <h1 className="text-xl font-bold tracking-tighter uppercase italic text-white/90">Socium</h1>
        <div className="mt-8 flex gap-1">
          <div className="w-1 h-1 bg-white/20 rounded-full animate-bounce [animation-delay:-0.3s]" />
          <div className="w-1 h-1 bg-white/20 rounded-full animate-bounce [animation-delay:-0.15s]" />
          <div className="w-1 h-1 bg-white/20 rounded-full animate-bounce" />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <>
        <Toaster />
        <AddToHomeScreenModal />
        <AuthView />
      </>
    );
  }

  return (
    <div className="fixed inset-0 h-[100dvh] bg-black text-white font-sans w-full max-w-lg mx-auto border-x border-white/5 flex flex-col overflow-hidden">
      <Toaster />
      <div className="bg-black shrink-0 h-[env(safe-area-inset-top)] w-full relative z-50"></div>
      
      {/* Header */}
      {(activeTab !== 'create' && !isImageViewerOpen && !isChatRoomOpen && !isHeaderHidden) && (
        <header 
          onClick={handleHeaderClick}
          className="shrink-0 h-14 flex items-center justify-between px-4 glass border-b border-white/10 relative z-40 bg-black/90 [touch-action:none] cursor-pointer"
        >
          <h1 className="text-xl font-bold tracking-tighter uppercase italic select-none">Socium</h1>
          <div className="flex space-x-4">
            {activeTab === 'feed' && !isFeedInboxOpen && (
              <button 
                id="feed-inbox-header-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (handleClearVibeBubble) handleClearVibeBubble();
                  setIsFeedInboxOpen(true);
                }}
                className="text-white hover:text-white/80 transition-colors relative"
              >
                <Inbox size={24} />
                {feedUnseenCount > 0 && (
                  <div className="absolute top-0 right-[-2px] w-2.5 h-2.5 bg-blue-600 rounded-full border border-black shadow" />
                )}
              </button>
            )}
            {activeTab === 'chat' && !initialActiveChat && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('openCreateGroup'));
                }}
                className="text-white hover:text-white/80 transition-colors relative flex items-center justify-center group"
              >
                <div className="relative">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-users">
                     <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                     <circle cx="9" cy="7" r="4"/>
                     <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                     <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <div className="absolute -bottom-1 -right-1 bg-black rounded-full p-0.5 border border-black shadow-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                  </div>
                </div>
              </button>
            )}
            {activeTab === 'chat' && !initialActiveChat && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setShowNotifPromoPopup(false);
                  if (typeof window !== 'undefined' && 'Notification' in window && (notifPermission !== 'granted' || hasPushSubscription !== true)) {
                    registerPush(session.user.id, true);
                  }
                }}
                className="text-white hover:text-white/80 transition-colors relative"
              >
                <Bell size={24} />
                {notifPermission === 'granted' && hasPushSubscription === true && (
                  <div className="absolute flex top-0 right-[-2px] w-2.5 h-2.5 bg-green-500 rounded-full border border-black shadow" />
                )}
              </button>
            )}
          </div>
        </header>
      )}

      {/* Promo Popup */}
      <AnimatePresence>
        {showNotifPromoPopup && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-[env(safe-area-inset-top,20px)] right-4 z-[200] w-72 bg-[#1c1c1c] border border-white/20 p-4 rounded-3xl shadow-2xl origin-top-right flex flex-col gap-3 mt-14"
          >
            <div className="absolute -top-2 right-4 w-4 h-4 bg-[#1c1c1c] border-t border-l border-white/20 rotate-45 transform" />
            <div className="relative z-10 flex flex-col gap-2">
              <h3 className="font-bold text-white text-base">Stay in the loop</h3>
              <p className="text-white/60 text-sm leading-tight">Turn on notifications to never miss a message. Tap the bell icon anytime.</p>
              <button 
                onClick={() => setShowNotifPromoPopup(false)}
                className="mt-2 text-sm font-bold bg-white text-black py-2 rounded-full w-full active:scale-95 transition-transform"
              >
                Got it
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals and Overlays */}
      <CompleteProfileModal 
        profile={profile} 
        onComplete={() => { if (session?.user?.id) fetchProfileData(session.user.id); }} 
      />
      <AddToHomeScreenModal />
      <SharePostModal />

      {/* Main View Area */}
      <main 
        ref={mainRef} 
        className="flex-1 overflow-hidden relative"
      >
        <AnimatePresence mode="popLayout">
           {activeTab === 'feed' && (
             <motion.div 
               key="feed" 
               initial={{ x: isMovingRight ? '100%' : '-100%' }} 
               animate={{ x: 0 }} 
               exit={{ x: isMovingRight ? '-100%' : '100%' }} 
               transition={{ type: 'spring', damping: 26, stiffness: 220 }} 
               className="absolute inset-0 overflow-y-auto overflow-x-hidden [-webkit-overflow-scrolling:touch] bg-black"
               ref={(node) => {
                 if (node) {
                   node.scrollTop = useStore.getState().feedScrollPos;
                 }
               }}
               onScroll={(e) => {
                 if ((window as any).currentActiveTab === 'feed') {
                   useStore.getState().setFeedScrollPos(e.currentTarget.scrollTop);
                 }
               }}
             >
               <Feed currentUserId={session.user.id} onUserClick={handleUserClick} activeTab={activeTab} />
             </motion.div>
           )}
           
           {activeTab === 'profile' && (
             <motion.div 
               key="profile" 
               initial={{ x: isMovingRight ? '100%' : '-100%' }} 
               animate={{ x: 0 }} 
               exit={{ x: isMovingRight ? '-100%' : '100%' }} 
               transition={{ type: 'spring', damping: 26, stiffness: 220 }} 
               className="absolute inset-0 overflow-y-auto overflow-x-hidden [-webkit-overflow-scrolling:touch] bg-black"
             >
               {profile ? (
                 <ProfileView 
                   profile={profile} 
                   posts={userPosts} 
                   isOwnProfile={true}
                   currentUserId={session.user.id}
                   onUserClick={handleUserClick}
                   onDeletePost={handleDeletePost}
                   onLikePost={handleLikeProfilePost}
                   onRefetch={() => { fetchUserPosts(session.user.id, session.user.id); }}
                 />
               ) : (
                 <div className="flex flex-col items-center justify-center pt-40 px-4 text-center">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
                    <p className="text-white/50 text-sm">Building profile...</p>
                 </div>
               )}
             </motion.div>
           )}

           {activeTab === 'create' && (
             <CreatePost 
                key="create"
                userId={session.user.id}
                onSuccess={() => {
                  setActiveTab('feed');
                  fetchUserPosts(session.user.id, session.user.id);
                  useStore.getState().fetchFeedPosts(session.user.id).then(() => {
                    (window as any).lastFeedFetchTime = Date.now();
                  });
                }}
                onCancel={() => setActiveTab('feed')}
             />
           )}

           {activeTab === 'chat' && (
             <motion.div 
               key="chat" 
               initial={{ x: isMovingRight ? '100%' : '-100%' }} 
               animate={{ x: 0 }} 
               exit={{ x: isMovingRight ? '-100%' : '100%' }} 
               transition={{ type: 'spring', damping: 26, stiffness: 220 }} 
               className="absolute inset-0 z-40 flex flex-col bg-black"
             >
               <Chat 
                 currentUserId={session.user.id} 
                 initialActiveChat={initialActiveChat}
                 onCloseChat={() => setInitialActiveChat(null)}
                 onChatStateChange={setIsChatRoomOpen}
               />
             </motion.div>
           )}
        </AnimatePresence>
        
        </main>

      {/* Overlay for Other Profile */}
        <AnimatePresence>
           {viewingProfileId !== null && (
           <motion.div 
             key="other_profile" 
             initial={{ opacity: 0, x: '100%' }} 
             animate={{ opacity: 1, x: 0 }} 
             exit={{ opacity: 0, x: '100%' }}
             transition={{ type: "tween", duration: 0.3 }}
             className="fixed inset-0 z-[80] bg-black overflow-y-auto"
             >
               <div style={{ display: isImageViewerOpen ? 'none' : 'flex' }} className="sticky top-0 left-0 w-full px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 flex items-center bg-black/90 backdrop-blur-md z-50 border-b border-white/10 gap-4">
                 <button 
                   onClick={() => setViewingProfileId(null)} 
                   className="p-3 -ml-2 text-white/90 active:scale-95 transition-transform"
                 >
                   <ArrowLeft size={24} />
                 </button>
                 <span className="text-xl font-bold tracking-tight">
                   {viewingProfileData?.profile?.full_name || viewingProfileData?.profile?.username || 'Profile'}
                 </span>
               </div>
               
               {viewingProfileData ? (
                 <ProfileView 
                   profile={viewingProfileData.profile} 
                   posts={viewingProfileData.posts} 
                   isOwnProfile={viewingProfileData.profile.id === session.user.id}
                   currentUserId={session.user.id}
                   onUserClick={handleUserClick}
                   onDeletePost={handleDeletePost}
                   onLikePost={async (id, isLiked) => {
                     setViewingProfileData(prev => {
                       if (!prev) return prev;
                       return {
                         ...prev,
                         posts: prev.posts.map(p => {
                           if (p.id === id) {
                             return { ...p, has_liked: !isLiked, likes_count: (p.likes_count || 0) + (isLiked ? -1 : 1)};
                           }
                           return p;
                         })
                       };
                     });
                     try {
                        if (isLiked) await supabase.from('likes').delete().eq('post_id', id).eq('user_id', session.user.id);
                        else await supabase.from('likes').insert({ post_id: id, user_id: session.user.id });
                     } catch(e) {}
                   }}
                   onRefetch={() => handleUserClick(viewingProfileData.profile.id)}
                 />
               ) : (
                 <div className="flex flex-col items-center justify-center pt-40 px-4 text-center relative w-full h-full">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
                    <p className="text-white/50 text-sm">Loading profile...</p>
                 </div>
               )}
             </motion.div>
           )}
        </AnimatePresence>

      {/* Navigation */}
      {(activeTab !== 'create' && !isImageViewerOpen && !isChatRoomOpen) && (
        <BottomNav 
           activeTab={activeTab} 
           setActiveTab={(tab) => {
             setActiveTab(tab);
             setViewingProfileId(null);
           }} 
           unreadCount={totalUnread}
           activeVibeInitiatorProfile={vibeInitiatorProfile}
           onClearVibeBubble={handleClearVibeBubble} 
           floatingAvatar={floatingAvatar}
           setFloatingAvatar={setFloatingAvatar}
           showFirstTimeChatDot={!hasSeenPromo && !!session?.user}
        />
      )}
      <CallsManager />
      <AnimatePresence>
        {isFeedInboxOpen && (
          <motion.div
            key="feed-inbox-overlay"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', ease: 'easeInOut', duration: 0.3 }}
            className="fixed inset-0 z-[95] bg-zinc-950 flex flex-col overflow-hidden"
          >
            <FeedInbox 
              currentUserId={session.user.id} 
              onBack={() => setIsFeedInboxOpen(false)} 
              onUserClick={(uid) => {
                setIsFeedInboxOpen(false);
                handleUserClick(uid);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <ErudaDevTools />
    </div>
  );
}
