import { ref, onValue, set, onDisconnect, increment, get } from "firebase/database";
import { rtdb } from "./firebase";
import { supabase } from "./supabase";

export const initPresence = (userId: string) => {
  if (!rtdb) return;

  const globalPresenceRef = ref(rtdb, `global_presence/${userId}`);
  const locationRef = ref(rtdb, `location/${userId}`);
  
  // Set presence to true when initialized
  set(globalPresenceRef, true).catch(e => console.error("Global presence set failed", e));
  
  // Clean up on disconnect via RTDB native feature
  try {
    onDisconnect(globalPresenceRef).set(false);
    onDisconnect(locationRef).set('none');
  } catch (e) { console.error("onDisconnect failed", e); }
  
  // Handle Instant presence updates on visibility change for iOS / mobile browsers
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
       set(globalPresenceRef, true).catch(console.error);
       // Re-establish chat location if needed (this would normally be handled by the route or component, but default to 'none' if unsure)
    } else {
       // Instantly update to offline when app goes to background
       set(globalPresenceRef, false).catch(console.error);
       set(locationRef, 'none').catch(console.error);
    }
  };

  const handlePageHide = () => {
       set(globalPresenceRef, false).catch(console.error);
       set(locationRef, 'none').catch(console.error);
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
  }

  // Ensure unseen_chat_count exists and initialized
  const countRef = ref(rtdb, `unseen_chat_count/${userId}`);
  get(countRef).then(snapshot => {
    if (!snapshot.exists()) {
      set(countRef, 0).catch(console.error);
    }
  }).catch(e => console.error("unseen_chat_count get failed", e));

  const unsubscribeCount = onValue(countRef, (snapshot) => {
    const count = snapshot.val() || 0;
    if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
      if (count > 0) {
        (navigator as any).setAppBadge(count).catch(console.error);
      } else {
        (navigator as any).clearAppBadge().catch(console.error);
      }
    }
  });

  return () => {
    set(globalPresenceRef, false).catch(console.error);
    set(locationRef, 'none').catch(console.error);
    unsubscribeCount();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    }
  };
};

export const setChatLocation = (userId: string, chatId: string | null) => {
  if (!rtdb) return;
  const locationRef = ref(rtdb, `location/${userId}`);
  if (chatId) {
    set(locationRef, chatId);
    // When they enter a chat, ensure it's marked as seen and decrement unread if needed
    markChatAsSeen(userId, chatId);
  } else {
    set(locationRef, 'none');
  }
};

export const markChatAsSeen = (userId: string, chatId: string) => {
  if (!rtdb) return;
  const inboxRef = ref(rtdb, `inboxes/${userId}/${chatId}`);
  get(inboxRef).then((snapshot) => {
    const isSeen = snapshot.val();
    if (isSeen === false) {
      // Mark as seen and decrease unseen count
      set(inboxRef, true);
      const countRef = ref(rtdb, `unseen_chat_count/${userId}`);
      set(countRef, increment(-1));
    }
  });
};

export const checkRecipientPresenceAndNotify = async (
  senderId: string, 
  receiverId: string, 
  messageData: any
) => {
  if (!rtdb) return;

  let isOnline = false;

  try {
    const inboxRef = ref(rtdb, `inboxes/${receiverId}/${senderId}`);
    
    const [locSnapshot, inboxSnapshot, precSnapshot] = await Promise.all([
      get(ref(rtdb, `location/${receiverId}`)),
      get(inboxRef),
      get(ref(rtdb, `global_presence/${receiverId}`))
    ]);
    
    const location = locSnapshot.val();
  
    // 1. recipient has the chat open - nothing gets updated.
    if (location === senderId) {
      return;
    }
  
    // 2. recipient has the chat closed - unseen chat number must be incremented.
    const isSeen = inboxSnapshot.val();
    
    if (isSeen !== false) {
      set(inboxRef, false).catch(console.error);
      const countRef = ref(rtdb, `unseen_chat_count/${receiverId}`);
      set(countRef, increment(1)).catch(console.error);
    }
  
    isOnline = precSnapshot.val() === true;
  } catch (dbError) {
    console.error("RTDB error in checkRecipientPresenceAndNotify, assuming offline.", dbError);
    // Continue below to send the push notification even if RTDB failed
  }

  // trigger edge function asynchronously to not block client
  if (!isOnline) {
    supabase.functions.invoke('send-push', {
      body: messageData
    }).catch(e => console.error("Error invoking edge function:", e));
  }
};
