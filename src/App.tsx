import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import BottomNav from './components/BottomNav';
import AuthView from './components/Auth';
import CreatePost from './components/CreatePost';
import Feed from './components/Feed';
import ProfileView from './components/Profile';
import Chat from './components/Chat';
import { Profile, Post } from './types';
import { motion, AnimatePresence } from 'motion/react';
import AddToHomeScreenModal from './components/AddToHomeScreenModal';
import CompleteProfileModal from './components/CompleteProfileModal';
import { Bell } from 'lucide-react';
import { Toaster } from 'react-hot-toast';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('feed');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  const [viewingProfileData, setViewingProfileData] = useState<{ profile: Profile, posts: Post[] } | null>(null);
  const [initialActiveChat, setInitialActiveChat] = useState<Profile | null>(null);
  const [totalUnread, setTotalUnread] = useState(0);
  const [floatingAvatar, setFloatingAvatar] = useState<Profile | null>(null);
  const [showNotifPromoPopup, setShowNotifPromoPopup] = useState(false);
  const [hasSeenPromo, setHasSeenPromo] = useState(() => localStorage.getItem('first_time_chat_notif') !== null);

  useEffect(() => {
    const handleOpenChat = (e: any) => {
      setFloatingAvatar(null);
      setInitialActiveChat(e.detail.profile);
      setViewingProfileId(null);
      setActiveTab('chat');
    };
    window.addEventListener('openChat', handleOpenChat);

    // If returning from OAuth provider, clean up the URL to prevent showing the callback path
    if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
      window.history.replaceState({}, document.title, '/');
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        registerPush(session.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        registerPush(session.user.id);
      }
    });

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('openChat', handleOpenChat);
    };
  }, []);

  useEffect(() => {
    let globalUnreadChannel: any = null;

    let forceGetUnreadHandler: any = null;

    if (session?.user?.id) {
      const getUnread = async () => {
        const { data } = await supabase
          .from('messages')
          .select('sender_id')
          .eq('receiver_id', session.user.id)
          .is('read_at', null);
          
        if (data) {
          const unreadCount = new Set(data.map(d => d.sender_id)).size;
          setTotalUnread(unreadCount);
          if (unreadCount === 0 && 'clearAppBadge' in navigator) {
             (navigator as any).clearAppBadge().catch(console.error);
          } else if ('setAppBadge' in navigator) {
             (navigator as any).setAppBadge(unreadCount).catch(console.error);
          }
        }
      };

      forceGetUnreadHandler = () => getUnread();
      window.addEventListener('forceGetUnread', forceGetUnreadHandler);

      getUnread();

      // Check url param
      if (typeof window !== 'undefined') {
         const urlParams = new URLSearchParams(window.location.search);
         const chatWith = urlParams.get('chat_with');
         if (chatWith) {
           setTimeout(async () => {
             const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', chatWith).single();
             if (senderProfile) {
               window.history.replaceState({}, document.title, window.location.pathname);
               setFloatingAvatar(null);
               setInitialActiveChat(senderProfile);
               setViewingProfileId(null);
               setActiveTab('chat');
             }
           }, 500);
         }
      }

      globalUnreadChannel = supabase.channel('global_unread')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${session.user.id}` }, async (payload) => {
           getUnread();
           const senderId = payload.new.sender_id;
           if ((window as any).currentChatUserId !== senderId) {
             const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', senderId).single();
             if (senderProfile) {
               // Only show the floating avatar if the user is NOT already looking at the chat list or chat view
               const currentPathOpen = (window as any).currentActiveTab;
               if (currentPathOpen !== 'chat') {
                 setFloatingAvatar(senderProfile);
                 setTimeout(() => setFloatingAvatar(null), 4000);
               }
             }
           }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `receiver_id=eq.${session.user.id}` }, () => {
           getUnread();
        })
        .subscribe();
    }

    return () => {
      if (forceGetUnreadHandler) window.removeEventListener('forceGetUnread', forceGetUnreadHandler);
      if (globalUnreadChannel) supabase.removeChannel(globalUnreadChannel);
    };
  }, [session?.user?.id]);

  useEffect(() => {
    const initForegroundMessaging = async () => {
      const { setupForegroundMessageListener } = await import('./lib/firebase');
      setupForegroundMessageListener(() => {
        // We use Supabase Realtime to update the UI securely and reliably.
        // Doing nothing here prevents the system push notification from appearing while the app is actively open, satisfying the requirement.
      });
    };
    
    initForegroundMessaging();
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/firebase-messaging-sw.js').catch((err) => {
        console.error('SW registration failed:', err);
      });

      navigator.serviceWorker.addEventListener('message', async (event) => {
        if (event.data === 'PING_VISIBILITY' && event.ports[0]) {
          if (document.visibilityState === 'visible') {
            event.ports[0].postMessage('VISIBLE');
          }
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
      });
    }
  }, []);

  const [notifPermission, setNotifPermission] = useState(typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default');

  const registerPush = async (userId: string, isUserAction = false) => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn("Push unsupported");
      return;
    }
    
    try {
      const permission = typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default';
      console.log(`registerPush called (userAction: ${isUserAction}), current permission:`, permission);
      
      const { requestFirebaseNotificationPermission } = await import('./lib/firebase');
      const token = await requestFirebaseNotificationPermission();
      
      setNotifPermission(Notification.permission);
      
      if (!token) {
        console.warn("Could not get Firebase FCM token.");
        if (isUserAction) alert('Could not enable notifications.');
        return;
      }

      console.log("Firebase FCM token obtained:", token.substring(0, 20) + "...");

      console.log("Upserting subscription to database for user:", userId);
      const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: userId,
        endpoint: token, // We store the FCM token in the 'endpoint' column for simplicity
        p256dh_key: 'FCM',
        auth_key: 'FCM'
      }, { onConflict: 'user_id, endpoint' });
      
      if (error) {
        console.error('Error upserting DB:', error);
      } else {
        console.log('Successfully saved FCM token to database');
      }
      
    } catch (e: any) {
      console.error('Push registration failed:', e.name, e.message);
      if (isUserAction) alert(`Push registration failed: ${e.message}`);
    }
  };

  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const handleUserClick = async (userId: string) => {
    if (!session) return;
    if (userId === session.user.id) {
      setViewingProfileId(null);
      setActiveTab('profile');
      return;
    }

    setViewingProfileId(userId);
    setActiveTab('other_profile');
    
    // Fetch other user's profile
    const { data: pData } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const { data: postsData } = await supabase.from('posts').select('*, profiles(*)').eq('user_id', userId).order('created_at', { ascending: false });
    
    if (pData) {
      setViewingProfileData({ profile: pData, posts: postsData as any || [] });
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    
    try {
      const { error } = await supabase.from('posts').delete().eq('id', postId);
      if (error) throw error;
      setUserPosts(userPosts.filter(p => p.id !== postId));
    } catch (error: any) {
      alert(`Failed to delete: ${error.message}`);
    }
  };

  async function fetchProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Profile not found or error fetching:', error.message);
        if (error.code === '42P01') {
           // PostgreSQL relation does not exist
           alert('DATABASE ERROR: The "profiles" table does not exist in your Supabase database!\n\nPlease go to Supabase -> SQL Editor and paste the contents of SCHEMA.sql to create the tables.');
        } else {
           await createInitialProfile(userId);
        }
      } else {
        setProfile(data);
        fetchUserPosts(userId);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  }

  async function createInitialProfile(userId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    const username = user?.email?.split('@')[0] || `user_${userId.slice(0, 5)}`;
    
    const { data: newProfile, error } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        username,
        full_name: user?.user_metadata?.full_name || username,
        avatar_url: user?.user_metadata?.avatar_url || null,
        email: user?.email || null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (!error) {
      setProfile(newProfile);
    }
  }

  const postsCache = React.useRef<Record<string, { time: number, data: Post[] }>>({});

  // Reload posts when switching back to profile tab
  useEffect(() => {
    (window as any).currentActiveTab = activeTab;
    if (session?.user?.id && activeTab === 'profile') {
      const cached = postsCache.current[session.user.id];
      if (!cached || Date.now() - cached.time > 60000) {
        fetchUserPosts(session.user.id);
      } else if (cached) {
        setUserPosts(cached.data);
      }
    }
    if (activeTab === 'chat' && !hasSeenPromo && session?.user) {
      setHasSeenPromo(true);
      setShowNotifPromoPopup(true);
      localStorage.setItem('first_time_chat_notif', 'true');
    }
  }, [activeTab, session?.user, hasSeenPromo]);

  async function fetchUserPosts(userId: string) {
    const { data } = await supabase
      .from('posts')
      .select('*, profiles(*), likes(user_id), comments(id)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (data) {
      const viewerId = session?.user?.id;
      const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
      let isViewingSelf = viewerId === userId;
      let processed = data.map((p: any) => ({
        ...p,
        likes_count: p.likes?.length || 0,
        has_liked: p.likes?.some((l: any) => l.user_id === viewerId),
        comments_count: p.comments?.length || 0
      }));

      // Filter by visibility if not viewing self
      if (!isViewingSelf && viewerId !== ADMIN_ID) {
        processed = processed.filter(post => {
           if (post.visible_to && Array.isArray(post.visible_to) && post.visible_to.length > 0) {
              return post.visible_to.includes(viewerId);
           }
           return true;
        });
      }

      postsCache.current[userId] = { time: Date.now(), data: processed as any };
      setUserPosts(processed as any);
    }
  }

  const handleLikeProfilePost = async (postId: string, isLiked: boolean) => {
    // Optimistic Update
    setUserPosts(prev => prev.map(p => {
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
      } else {
        await supabase.from('likes').insert({ post_id: postId, user_id: session.user.id });
      }
    } catch (e) {
      console.error(e);
      // Revert if error
      fetchUserPosts(viewingProfileId || session.user.id);
    }
  };

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
      <header className="shrink-0 h-14 flex items-center justify-between px-4 glass border-b border-white/10 relative z-40 bg-black/90">
        <h1 className="text-xl font-bold tracking-tighter uppercase italic">Socium</h1>
        <div className="flex space-x-4">
          {activeTab === 'chat' && !initialActiveChat && (
            <button 
              onClick={() => {
                setShowNotifPromoPopup(false);
                if ('Notification' in window && notifPermission !== 'granted') {
                  registerPush(session.user.id, true);
                }
              }}
              className="text-white hover:text-white/80 transition-colors relative"
            >
              <Bell size={24} />
              {notifPermission === 'granted' && (
                <div className="absolute flex top-0 right-[-2px] w-2.5 h-2.5 bg-green-500 rounded-full border border-black shadow" />
              )}
            </button>
          )}
        </div>
      </header>

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
        onComplete={() => { if (session?.user?.id) fetchProfile(session.user.id); }} 
      />
      <AddToHomeScreenModal />

      {/* Main View Area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative">
        <AnimatePresence mode="wait">
           {activeTab === 'feed' && (
             <motion.div 
               key="feed" 
               initial={{ opacity: 0, x: -20 }} 
               animate={{ opacity: 1, x: 0 }} 
               exit={{ opacity: 0, x: 20 }}
               className="page-transition"
             >
               <Feed currentUserId={session.user.id} onUserClick={handleUserClick} />
             </motion.div>
           )}
           
           {activeTab === 'profile' && (
             <motion.div 
               key="profile" 
               initial={{ opacity: 0, scale: 0.95 }} 
               animate={{ opacity: 1, scale: 1 }} 
               exit={{ opacity: 0, scale: 1.05 }}
               className="page-transition min-h-screen"
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
                   onRefetch={() => { fetchUserPosts(session.user.id); }}
                 />
               ) : (
                 <div className="flex flex-col items-center justify-center pt-40 px-4 text-center">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
                    <p className="text-white/50 text-sm">Building profile...</p>
                 </div>
               )}
             </motion.div>
           )}

           {activeTab === 'other_profile' && (
             <motion.div 
               key="other_profile" 
               initial={{ opacity: 0, x: 20 }} 
               animate={{ opacity: 1, x: 0 }} 
               exit={{ opacity: 0, x: -20 }}
               className="page-transition min-h-screen"
             >
               {viewingProfileData ? (
                 <ProfileView 
                   profile={viewingProfileData.profile} 
                   posts={viewingProfileData.posts} 
                   isOwnProfile={false}
                   currentUserId={session.user.id}
                   onUserClick={handleUserClick}
                   onDeletePost={handleDeletePost}
                   onLikePost={async (id, isLiked) => {
                     // Optimistic Update inside viewingProfileData
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
                 <div className="flex flex-col items-center justify-center pt-40 px-4 text-center">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
                    <p className="text-white/50 text-sm">Loading profile...</p>
                 </div>
               )}
             </motion.div>
           )}

           {activeTab === 'create' && (
             <CreatePost 
                userId={session.user.id}
                onSuccess={() => {
                  setActiveTab('feed');
                  fetchUserPosts(session.user.id);
                }}
                onCancel={() => setActiveTab('feed')}
             />
           )}

           {activeTab === 'chat' && (
             <motion.div 
               key="chat" 
               initial={{ opacity: 0, x: 20 }} 
               animate={{ opacity: 1, x: 0 }} 
               exit={{ opacity: 0, x: -20 }}
               className="page-transition min-h-screen"
             >
               <Chat 
                 currentUserId={session.user.id} 
                 initialActiveChat={initialActiveChat}
                 onCloseChat={() => setInitialActiveChat(null)}
               />
             </motion.div>
           )}
        </AnimatePresence>
      </main>

      {/* Navigation */}
      <BottomNav 
         activeTab={activeTab} 
         setActiveTab={setActiveTab} 
         unreadCount={totalUnread} 
         floatingAvatar={floatingAvatar}
         setFloatingAvatar={setFloatingAvatar}
         showFirstTimeChatDot={!hasSeenPromo && !!session?.user}
      />
      
    </div>
  );
}
