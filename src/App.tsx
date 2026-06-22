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
import { cn } from './lib/utils';
import { Toaster } from 'react-hot-toast';
import { useStore } from './store/useStore';
import { CallsManager } from './components/chat/CallsManager';
import ErudaDevTools from './components/ErudaDevTools';

import { initPresence } from '@/src/lib/presence';
import { logFeedActivity } from '@/src/lib/feed';

import { ref, set, onValue } from 'firebase/database';
import { rtdb } from '@/src/lib/firebase';

let audioUnlocked = false;
let messageSound: HTMLAudioElement | null = null;

if (typeof window !== 'undefined') {
  (window as any).currentActiveTab = 'feed';
  messageSound = new Audio('/message-sound.mp3');
  messageSound.volume = 0.8;
  messageSound.load();
}

const unlockAudio = () => {
  if (audioUnlocked || !messageSound) return;
  // Play and pause silently to register the device playback unlock
  messageSound.play().then(() => {
    if (messageSound) {
      messageSound.pause();
      messageSound.currentTime = 0;
    }
    audioUnlocked = true;
  }).catch(() => {});
  
  if (audioUnlocked) {
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('click', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
}

export default function App() {
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
  const previousTabRef = React.useRef('feed');
  const activeTabRef = React.useRef('feed');
  
  const setActiveTab = (tab: string) => {
    if (activeTabRef.current === 'feed' && mainRef.current) {
      useStore.getState().setFeedScrollPos(mainRef.current.scrollTop);
    }
    (window as any).currentActiveTab = tab;
    previousTabRef.current = activeTabRef.current;
    activeTabRef.current = tab;
    setActiveTabState(tab);
  };
  
  const [isProfileError, setIsProfileError] = useState(false);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  const viewingProfileIdRef = React.useRef<string | null>(null);
  
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
  const mainRef = React.useRef<HTMLElement>(null);

  // Feed Inbox and live active activity vibe state parameters
  const [isFeedInboxOpen, setIsFeedInboxOpen] = useState(false);
  const [activeVibeInitiatorId, setActiveVibeInitiatorId] = useState<string | null>(null);
  const [vibeInitiatorProfile, setVibeInitiatorProfile] = useState<Profile | null>(null);

  const { feedUnseenCount, setFeedUnseenCount, fetchFeedUnseenCount } = useStore();

  const playVibeSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      osc1.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.15); // E6

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(audioCtx.currentTime + 0.35);
      osc2.stop(audioCtx.currentTime + 0.35);
    } catch (err) {
      console.warn('Audio Context chime play failed:', err);
    }
  };

  const handleClearVibeBubble = async () => {
    if (!session?.user?.id || !rtdb) return;
    try {
      await set(ref(rtdb, `feed/${session.user.id}`), null);
    } catch (e) {
      console.warn('Failed to clear active vibe RTDB node:', e);
    }
    setActiveVibeInitiatorId(null);
    setVibeInitiatorProfile(null);
    setActiveTab('feed');
    setIsFeedInboxOpen(true);
  };

  // Listen to live Feed notifications in Firebase RTDB
  useEffect(() => {
    if (!session?.user?.id || !rtdb) return;
    const userId = session.user.id;
    const feedRef = ref(rtdb, `feed/${userId}`);

    const unsubscribe = onValue(feedRef, async (snapshot) => {
      const initiatorId = snapshot.val();
      if (initiatorId && typeof initiatorId === 'string') {
        setActiveVibeInitiatorId(initiatorId);

        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', initiatorId)
          .maybeSingle();

        if (data) {
          setVibeInitiatorProfile(data);
          playVibeSound();
        }

        fetchFeedUnseenCount(userId);
      } else {
        setActiveVibeInitiatorId(null);
        setVibeInitiatorProfile(null);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [session?.user?.id]);

  // Synchronize location tracking dynamically for active notification muting
  useEffect(() => {
    if (!session?.user?.id || !rtdb) return;
    const userId = session.user.id;
    let loc = 'none';
    if (activeTab === 'feed') {
      loc = isFeedInboxOpen ? 'feed_inbox' : 'feed';
    }
    set(ref(rtdb, `location/${userId}`), loc).catch(err => {
      console.warn('Failed to update RTDB location node:', err);
    });
  }, [session?.user?.id, activeTab, isFeedInboxOpen]);

  // Manage initial count loading and tab changes
  useEffect(() => {
    if (session?.user?.id) {
      fetchFeedUnseenCount(session.user.id);
    }
  }, [session?.user?.id, activeTab]);

  // Inside useEffect where auth state is handled, or a new useEffect
  useEffect(() => {
    let unmountPresence: (() => void) | undefined;
    if (session?.user?.id) {
      unmountPresence = initPresence(session.user.id);
      if (typeof window !== 'undefined' && 'caches' in window) {
        caches.open('user-meta').then(cache => {
          cache.put('/uid', new Response(session.user.id));
        }).catch(err => console.error('Failed to cache UID:', err));
      }
    } else {
      if (typeof window !== 'undefined' && 'caches' in window) {
        caches.open('user-meta').then(cache => {
          cache.delete('/uid');
        }).catch(err => console.error('Failed to clear cached UID:', err));
      }
    }
    return () => {
      if (unmountPresence) unmountPresence();
    };
  }, [session?.user?.id]);
  
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

    // If returning from OAuth provider, clean up the URL to prevent showing the callback path
    if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
      window.history.replaceState({}, document.title, '/');
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfileData(session.user.id);
        registerPush(session.user.id);

        const params = new URLSearchParams(window.location.search);
        const chatId = params.get('chatId') || params.get('chat_with');
        if (chatId) {
           const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', chatId).single();
           if (senderProfile) {
              setInitialActiveChat(senderProfile);
              setActiveTab('chat');
              window.history.replaceState({}, document.title, window.location.pathname);
           } else {
              // check if it's a group chat
              const { data: groupChat } = await supabase.from('group_chats').select('*').eq('id', chatId).single();
              if (groupChat) {
                setInitialActiveChat({
                  id: groupChat.id,
                  username: groupChat.name || 'Group',
                  full_name: groupChat.name || 'Group',
                  avatar_url: groupChat.avatar_url || null,
                  isGroup: true
                } as any);
                setActiveTab('chat');
                window.history.replaceState({}, document.title, window.location.pathname);
              }
           }
        }
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session) {
        fetchProfileData(session.user.id);
        registerPush(session.user.id);

        const params = new URLSearchParams(window.location.search);
        const chatId = params.get('chatId') || params.get('chat_with');
        if (chatId) {
           const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', chatId).single();
           if (senderProfile) {
              setInitialActiveChat(senderProfile);
              setActiveTab('chat');
              window.history.replaceState({}, document.title, window.location.pathname);
           } else {
              const { data: groupChat } = await supabase.from('group_chats').select('*').eq('id', chatId).single();
              if (groupChat) {
                setInitialActiveChat({
                  id: groupChat.id,
                  username: groupChat.name || 'Group',
                  full_name: groupChat.name || 'Group',
                  avatar_url: groupChat.avatar_url || null,
                  isGroup: true
                } as any);
                setActiveTab('chat');
                window.history.replaceState({}, document.title, window.location.pathname);
              }
           }
        }
      }
    });

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('openChat', handleOpenChat);
      window.removeEventListener('openProfile', handleOpenProfile);
      window.removeEventListener('openOwnProfileAndScroll', handleOpenOwnProfileAndScroll);
      window.removeEventListener('viewerState', handleViewerState);
      window.removeEventListener('resetTab', handleResetTab);
      window.removeEventListener('set-header-hidden', handleSetHeaderHidden);
    };
  }, []);

  useEffect(() => {
    let globalUnreadChannel: any = null;

    let forceGetUnreadHandler: any = null;

    if (session?.user?.id) {
      const getUnread = async () => {
        await fetchUnreadCount(session.user.id);
      };
      
      const getPending = async () => {
        await fetchPendingRequestsCount(session.user.id);
      };

      forceGetUnreadHandler = () => getUnread();
      window.addEventListener('forceGetUnread', forceGetUnreadHandler);

      getUnread();
      getPending();

      // Check url param
      if (typeof window !== 'undefined') {
         const urlParams = new URLSearchParams(window.location.search);
         const chatWith = urlParams.get('chat_with') || urlParams.get('chatId');
         if (chatWith) {
           setTimeout(async () => {
             const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', chatWith).single();
             if (senderProfile) {
               window.history.replaceState({}, document.title, window.location.pathname);
               setFloatingAvatar(null);
               setInitialActiveChat(senderProfile);
               setViewingProfileId(null);
               setActiveTab('chat');
             } else {
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
               }
             }
           }, 500);
         }
      }

      // Global unread realtime listener
      globalUnreadChannel = supabase.channel('global_unread')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
           const msg = payload.new;
           const isRelevant = msg.sender_id === session.user.id || msg.receiver_id === session.user.id || msg.group_chat_id !== null;
           if (isRelevant) {
              useStore.getState().handleGlobalNewMessage(msg, session.user.id);
           }
           // Filter for messages meant for us
           const isForUs = msg.receiver_id === session.user.id || msg.group_chat_id !== null;
           // We don't trigger if we sent it
           if (msg.sender_id === session.user.id || !isForUs || (window as any).currentChatUserId === (msg.group_chat_id || msg.sender_id)) return;
           try {
             const audioObj = messageSound; if (!audioObj) return;
             audioObj.currentTime = 0;
             audioObj.volume = 0.8;
             audioObj.play().catch(pErr => console.log('Audio play blocked:', pErr));
           } catch (aErr) {
             console.error('Audio load error:', aErr);
           }
           
           getUnread();
           const senderId = msg.sender_id;
           const groupChatId = msg.group_chat_id;
           
           const chatId = groupChatId || senderId;
           if ((window as any).currentChatUserId !== chatId) {
             let chatRefProfile: any = null;
             if (groupChatId) {
               // Load group chat details to construct a mock profile for the floating avatar
               const { data: gc } = await supabase.from('group_chats').select('*, group_chat_participants(profiles(*))').eq('id', groupChatId).single();
               if (gc) {
                 const participants = (gc.group_chat_participants as any[])?.map(p => p.profiles) || [];
                 chatRefProfile = {
                   id: gc.id,
                   username: gc.name || 'Group Chat',
                   full_name: gc.name || 'Group Chat',
                   avatar_url: gc.avatar_url || null,
                   isGroup: true,
                   participants
                 };
               }
             } else {
               const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', senderId).single();
               chatRefProfile = senderProfile;
             }
             
             if (chatRefProfile) {
               // Only show the floating avatar if the user is NOT already looking at the chat list or chat view
               const currentPathOpen = (window as any).currentActiveTab;
               if (currentPathOpen !== 'chat') {
                 setFloatingAvatar(chatRefProfile);
                 setTimeout(() => setFloatingAvatar(null), 4000);
               }
             }
           }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
           if (payload.new.receiver_id === session.user.id || payload.new.group_chat_id !== null || payload.new.sender_id === session.user.id) {
              getUnread();
              window.dispatchEvent(new CustomEvent('refreshChatList'));
           }
        })
        .subscribe();

      const connectionsChannel = supabase.channel('global_connections')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'connections', filter: `receiver_id=eq.${session.user.id}` }, () => {
           getPending();
        })
        .subscribe();
        
      return () => {
        if (forceGetUnreadHandler) window.removeEventListener('forceGetUnread', forceGetUnreadHandler);
        if (globalUnreadChannel) supabase.removeChannel(globalUnreadChannel);
        supabase.removeChannel(connectionsChannel);
      };
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

        const handleMessage = async (event: MessageEvent) => {
          if (event.data === 'PING_VISIBILITY' && event.ports[0]) {
            if (document.visibilityState === 'visible') {
              event.ports[0].postMessage('VISIBLE');
            }
          }
          if (event.data && event.data.type === 'OPEN_CHAT') {
            const senderId = event.data.senderId || event.data.sender_id;
            const groupChatId = event.data.groupChatId || event.data.group_chat_id;
            
            if (typeof window !== 'undefined' && 'caches' in window) {
              caches.open('notification-route').then(c => c.delete('/target-route')).catch(() => {});
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

  const checkUrlParamsAndRoute = async () => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const chatWith = urlParams.get('chat_with') || urlParams.get('chatId');
    if (!chatWith) return;

    try {
      // 1. Check if it's a private chat recipient profile
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
      // 2. Check if it is a group chat
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

    // 3. Fallback: If both fail, navigate to the main chat list tab
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
        // Clear the cache immediately so it doesn't trigger again
        await cache.delete('/target-route');
        
        const senderId = data.senderId;
        const groupChatId = data.groupChatId;
        
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
        
        // Fallback: If no specific routing details or fetching failed, navigate to the main chat page as requested
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

  const [notifPermission, setNotifPermission] = useState(typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default');
  const [hasPushSubscription, setHasPushSubscription] = useState<boolean | null>(null);

  useEffect(() => {
    if (session?.user?.id) {
       supabase.from('push_subscriptions').select('id', { count: 'exact' }).eq('user_id', session.user.id).then(({ count, error }) => {
          setHasPushSubscription(!error && count !== null && count > 0);
       });
    }
  }, [session]);

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
        setHasPushSubscription(true);
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
      // fallback to generic profile so it doesn't stay loading
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

  // Ensure scroll is reset when tab changes (unless we are scrolling to a specific post)
  useEffect(() => {
    if (activeTab !== 'feed' && !sessionStorage.getItem('scroll_to_post_id')) {
      if (mainRef.current) {
        mainRef.current.scrollTop = 0;
      }
    }
  }, [activeTab]);

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

  async function fetchProfileData(userId: string) {
    try {
      setIsProfileError(false);
      await fetchProfile(userId);
      const currentProfile = useStore.getState().profile;
      if (!currentProfile || currentProfile.id !== userId) {
        await createInitialProfile(userId);
      }
      
      // Auto-connect to Socium (ADMIN_ID)
      const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
      if (userId !== ADMIN_ID) {
        try {
          const { data: existingCheck } = await supabase
            .from('connection_requests')
            .select('id')
            .or(`and(requester_id.eq.${ADMIN_ID},receiver_id.eq.${userId}),and(requester_id.eq.${userId},receiver_id.eq.${ADMIN_ID})`)
            .maybeSingle();

          if (!existingCheck) {
            await supabase.from('connection_requests').insert({
              requester_id: ADMIN_ID,
              receiver_id: userId,
              status: 'accepted'
            });

            // Insert bidirectional records in actual connections
            await supabase.from('connections').insert([
              { user_id: ADMIN_ID, connection_id: userId },
              { user_id: userId, connection_id: ADMIN_ID }
            ]);
          }
        } catch (connErr) {
          console.error('Error establishing default Socium connection:', connErr);
        }
      }

      fetchUserPosts(userId, userId);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setIsProfileError(true);
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
    
    // Also init RTDB values
    if (rtdb) {
      try {
        await set(ref(rtdb, `unseen_chat_count/${userId}`), 0);
        await set(ref(rtdb, `location/${userId}`), 'none');
        await set(ref(rtdb, `global_presence/${userId}`), true);
      } catch (e) {
         console.error('Failed to init RTDB for new user', e);
      }
    }
  }

  // Reload posts when switching back to profile tab
  useEffect(() => {
    (window as any).currentActiveTab = activeTab;
    if (session?.user?.id && activeTab === 'profile') {
      fetchUserPosts(session.user.id, session.user.id);
    }
    if (activeTab === 'chat' && !hasSeenPromo && session?.user) {
      setHasSeenPromo(true);
      setShowNotifPromoPopup(true);
      localStorage.setItem('first_time_chat_notif', 'true');
    }
  }, [activeTab, session?.user, hasSeenPromo]);

  // Removed local fetchUserPosts as it's in the store now

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
        <header className="shrink-0 h-14 flex items-center justify-between px-4 glass border-b border-white/10 relative z-40 bg-black/90 [touch-action:none]">
          <h1 className="text-xl font-bold tracking-tighter uppercase italic">Socium</h1>
          <div className="flex space-x-4">
            {activeTab === 'feed' && !isFeedInboxOpen && (
              <button 
                id="feed-inbox-header-btn"
                onClick={() => setIsFeedInboxOpen(true)}
                className="text-white hover:text-white/80 transition-colors relative"
              >
                <Inbox size={24} />
                {feedUnseenCount > 0 && (
                  <div className="absolute top-0 right-[-2px] w-2.5 h-2.5 bg-sky-500 rounded-full border border-black shadow" />
                )}
              </button>
            )}
            {activeTab === 'chat' && !initialActiveChat && (
              <button 
                onClick={() => window.dispatchEvent(new CustomEvent('openCreateGroup'))}
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
                onClick={() => {
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
        className="flex-1 overflow-y-auto overflow-x-hidden relative [-webkit-overflow-scrolling:touch]"
      >
        <AnimatePresence mode="wait">
           {activeTab === 'feed' && (
             <motion.div 
               key="feed" 
               initial={{ opacity: 0, x: -20 }} 
               animate={{ opacity: 1, x: 0 }} 
               exit={{ opacity: 0, x: 20 }}
               onAnimationComplete={() => {
                 if (mainRef.current) {
                   mainRef.current.scrollTop = useStore.getState().feedScrollPos;
                 }
               }}
               className="page-transition"
             >
               <Feed currentUserId={session.user.id} onUserClick={handleUserClick} activeTab={activeTab} />
             </motion.div>
           )}
           
           {activeTab === 'profile' && (
             <motion.div 
               key="profile" 
               initial={{ opacity: 0, scale: 0.95 }} 
               animate={{ opacity: 1, scale: 1 }} 
               exit={{ opacity: 0, scale: 1.05 }}
               onAnimationStart={() => {
                 if (mainRef.current) mainRef.current.scrollTop = 0;
               }}
               onAnimationComplete={() => {
                 if (mainRef.current) mainRef.current.scrollTop = 0;
               }}
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
                userId={session.user.id}
                onSuccess={() => {
                  setActiveTab('feed');
                  fetchUserPosts(session.user.id, session.user.id);
                }}
                onCancel={() => setActiveTab('feed')}
             />
           )}

           {activeTab === 'chat' && (
             <motion.div 
               key="chat" 
               initial={{ x: previousTabRef.current === 'profile' ? '-100%' : '100%', opacity: 1 }} 
               animate={{ x: 0, opacity: 1 }} 
               exit={{ x: activeTabRef.current === 'profile' ? '-100%' : '100%', opacity: 1 }}
               transition={{ type: 'tween', duration: 0.3 }}
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
