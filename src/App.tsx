import React, { useEffect } from 'react';
import { supabase } from './lib/supabase';
import { Toaster } from 'react-hot-toast';
import { cn } from './lib/utils';
import { useStore } from './store/useStore';
import { useAppLogic } from './hooks/useAppLogic';

// Components
import BottomNav from './components/BottomNav';
import AuthView from './components/Auth';
import CreatePost from './components/CreatePost';
import Feed from './components/Feed';
import ProfileView from './components/Profile';
import Chat from './components/Chat';
import AddToHomeScreenModal from './components/AddToHomeScreenModal';
import CompleteProfileModal from './components/CompleteProfileModal';
import AppHeader from './components/AppHeader';
import NotificationPromo from './components/NotificationPromo';
import OtherProfileOverlay from './components/OtherProfileOverlay';
import LoadingScreen from './components/LoadingScreen';

export default function App() {
  const logic = useAppLogic();
  const { session, activeTab, setActiveTab, mainRef, profile, userPosts, totalUnread, floatingAvatar, setFloatingAvatar, viewingProfileId, setViewingProfileId, viewingProfileData, setViewingProfileData, initialActiveChat, setInitialActiveChat, isChatRoomOpen, setIsChatRoomOpen, isImageViewerOpen, showNotifPromoPopup, setShowNotifPromoPopup, hasSeenPromo, setHasSeenPromo, notifPermission, handleUserClick, handleDeletePost, handleLikeProfilePost, registerPush, fetchProfileData } = logic;
  const { fetchUserPosts } = useStore();

  // Tab sync for external refs
  useEffect(() => {
    (window as any).currentActiveTab = activeTab;
    if (session?.user?.id && activeTab === 'profile') {
      fetchUserPosts(session.user.id, session.user.id);
    }
    if (activeTab === 'chat' && !hasSeenPromo && session?.user) {
      setHasSeenPromo?.(true);
      setShowNotifPromoPopup(true);
      localStorage.setItem('first_time_chat_notif', 'true');
    }
  }, [activeTab, session?.user, hasSeenPromo, fetchUserPosts, setHasSeenPromo, setShowNotifPromoPopup]);

  // SW and FCM Handling (Keeping in App.tsx for root scope)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/firebase-messaging-sw.js').catch((err) => console.error('SW registration failed:', err));
      const handleMessage = async (event: MessageEvent) => {
        if (event.data === 'PING_VISIBILITY' && event.ports[0]) {
          if (document.visibilityState === 'visible') event.ports[0].postMessage('VISIBLE');
        }
        if (event.data && event.data.type === 'OPEN_CHAT' && event.data.senderId) {
          const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', event.data.senderId).single();
          if (senderProfile) {
              setFloatingAvatar(null);
              setInitialActiveChat(senderProfile);
              setViewingProfileId(null);
              setActiveTab('chat');
          }
        }
        if (event.data && event.data.type === 'OPEN_REQUESTS') {
           setActiveTab('profile');
           setTimeout(() => window.dispatchEvent(new CustomEvent('openRequestsUI')), 100);
        }
      };
      navigator.serviceWorker.addEventListener('message', handleMessage);
      return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
    }
  }, [setActiveTab, setFloatingAvatar, setInitialActiveChat, setViewingProfileId]);

  if (session === undefined) return <LoadingScreen />;
  if (!session) return (
    <>
      <Toaster />
      <AddToHomeScreenModal />
      <AuthView />
    </>
  );

  return (
    <div className="fixed inset-0 h-[100dvh] bg-black text-white font-sans w-full max-w-lg mx-auto border-x border-white/5 flex flex-col overflow-hidden">
      <Toaster />
      <div className="bg-black shrink-0 h-[env(safe-area-inset-top)] w-full relative z-50"></div>
      
      <AppHeader 
        activeTab={activeTab}
        isImageViewerOpen={isImageViewerOpen}
        isChatRoomOpen={isChatRoomOpen}
        initialActiveChat={initialActiveChat}
        notifPermission={notifPermission}
        onBellClick={() => {
          setShowNotifPromoPopup(false);
          if ('Notification' in window && notifPermission !== 'granted') {
            registerPush(session.user.id, true);
          }
        }}
      />

      <NotificationPromo show={showNotifPromoPopup} onClose={() => setShowNotifPromoPopup(false)} />

      <CompleteProfileModal profile={profile} onComplete={() => { if (session?.user?.id) fetchProfileData(session.user.id); }} />
      <AddToHomeScreenModal />

      <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden relative [-webkit-overflow-scrolling:touch]">
        <div className={cn("page-transition", activeTab !== 'feed' && "hidden")}>
          <Feed currentUserId={session.user.id} onUserClick={handleUserClick} />
        </div>
        
        <div className={cn("page-transition min-h-screen", activeTab !== 'profile' && "hidden")}>
          {profile ? (
            <ProfileView 
              profile={profile} 
              posts={userPosts} 
              isOwnProfile={true}
              currentUserId={session.user.id}
              onUserClick={handleUserClick}
              onDeletePost={handleDeletePost}
              onLikePost={handleLikeProfilePost}
              onRefetch={() => fetchUserPosts(session.user.id, session.user.id)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center pt-40 px-4 text-center">
                <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
                <p className="text-white/50 text-sm">Building profile...</p>
            </div>
          )}
        </div>

        <div className={cn("page-transition", activeTab !== 'create' && "hidden")}>
          <CreatePost 
            userId={session.user.id}
            onSuccess={() => { setActiveTab('feed'); fetchUserPosts(session.user.id, session.user.id); }}
            onCancel={() => setActiveTab('feed')}
          />
        </div>

        <div className={cn("absolute inset-0 z-40 flex flex-col bg-black", activeTab !== 'chat' && "hidden")}>
          <Chat 
            currentUserId={session.user.id} 
            initialActiveChat={initialActiveChat}
            onCloseChat={() => setInitialActiveChat(null)}
            onChatStateChange={setIsChatRoomOpen}
          />
        </div>
      </main>

      <OtherProfileOverlay 
        viewingProfileId={viewingProfileId}
        onClose={() => setViewingProfileId(null)}
        viewingProfileData={viewingProfileData}
        currentUserId={session.user.id}
        onUserClick={handleUserClick}
        onDeletePost={handleDeletePost}
        onRefetch={handleUserClick}
        onUpdatePosts={async (id, isLiked) => {
          setViewingProfileData?.(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              posts: prev.posts.map(p => p.id === id ? { ...p, has_liked: !isLiked, likes_count: (p.likes_count || 0) + (isLiked ? -1 : 1)} : p)
            };
          });
          try {
             if (isLiked) await supabase.from('likes').delete().eq('post_id', id).eq('user_id', session.user.id);
             else await supabase.from('likes').insert({ post_id: id, user_id: session.user.id });
          } catch(e) {}
        }}
      />

      <div className={cn("shrink-0 h-[60px] pb-[env(safe-area-inset-bottom)] w-full transition-opacity duration-300", (activeTab === 'create' || isImageViewerOpen || isChatRoomOpen) ? "block opacity-0" : "hidden opacity-100")} />

      <div className={cn("w-full transition-opacity duration-300", (activeTab === 'create' || isImageViewerOpen || isChatRoomOpen) ? "opacity-0 pointer-events-none absolute bottom-0" : "relative z-40 opacity-100")}>
        <BottomNav 
           activeTab={activeTab} 
           setActiveTab={(tab) => { setActiveTab(tab); setViewingProfileId(null); }} 
           unreadCount={totalUnread} 
           floatingAvatar={floatingAvatar}
           setFloatingAvatar={setFloatingAvatar}
           showFirstTimeChatDot={!hasSeenPromo && !!session?.user}
        />
      </div>
    </div>
  );
}
