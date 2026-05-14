import { ref, onValue, set, onDisconnect, increment, get, runTransaction } from "firebase/database";
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
      runTransaction(countRef, (currentVal) => {
        return Math.max(0, (currentVal || 0) - 1);
      });
    }
  });
};

export const checkRecipientPresenceAndNotify = async (
  senderId: string, 
  receiverId: string, 
  chatId: string,
  messageData: any
) => {
  if (!rtdb) return;

  if (receiverId === senderId) return;
  
  try {
    const inboxRef = ref(rtdb, `inboxes/${receiverId}/${chatId}`);
    
    // We get unseen_chat_count to include in payload, but wait until we increment it
    const [locSnapshot, inboxSnapshot, precSnapshot] = await Promise.all([
      get(ref(rtdb, `location/${receiverId}`)),
      get(inboxRef),
      get(ref(rtdb, `global_presence/${receiverId}`))
    ]);
    
    const location = locSnapshot.val();
    
    // Case C: recipient has the chat open - nothing gets updated.
    if (location === chatId) {
      return;
    }
    
    // Case B & Case A: recipient has the chat closed - unseen chat number must be incremented.
    const isSeen = inboxSnapshot.val();
    let updatedUnseenCount = 0;
    
    // We increment in a transaction
    const countRef = ref(rtdb, `unseen_chat_count/${receiverId}`);
    
    if (isSeen !== false) {
      set(inboxRef, false).catch(console.error);
      const transactionResult = await runTransaction(countRef, (currentVal) => (currentVal || 0) + 1);
      updatedUnseenCount = transactionResult.snapshot.val() || 0;
    } else {
      updatedUnseenCount = (await get(countRef)).val() || 0;
    }
    
    const isOnline = precSnapshot.val() === true;
    
    // Case A: if global presence is false, trigger edge function
    if (!isOnline) {
       // Only trigger edge function for offline users
        supabase.functions.invoke('send-push', {
          body: {
             ...messageData,
             badgeCount: updatedUnseenCount,
             chatUrl: 'https://sociumx.vercel.app'
          }
        }).catch(e => console.error("Error invoking edge function:", e));
    }
    // Case B: global presence is true, but location is not chat uuid. 
    // We only update unseen count (done above) and do NOT trigger edge function.

  } catch (dbError) {
    console.error("RTDB error for user", receiverId, dbError);
    // Fallback: assume offline and just send push
    supabase.functions.invoke('send-push', {
       body: { ...messageData, chatUrl: 'https://sociumx.vercel.app' }
    }).catch(console.error);
  }
};
