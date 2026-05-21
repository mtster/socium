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

const seenProcessing = new Set<string>();

export const markChatAsSeen = (userId: string, chatId: string) => {
  if (!rtdb) return;
  if (seenProcessing.has(chatId)) return;
  seenProcessing.add(chatId);

  const inboxRef = ref(rtdb, `inboxes/${userId}/${chatId}`);
  runTransaction(inboxRef, (currentVal) => {
    if (currentVal === false) {
      return true;
    }
    return; // Already true, or doesn't exist, abort transaction
  }).then((result) => {
    seenProcessing.delete(chatId);
    if (result.committed && result.snapshot.val() === true) {
      const countRef = ref(rtdb, `unseen_chat_count/${userId}`);
      runTransaction(countRef, (currentVal) => {
        return Math.max(0, (currentVal || 0) - 1);
      }).then((countResult) => {
        if (countResult.committed) {
          const newCount = countResult.snapshot.val() || 0;
          if (newCount > 0 && 'setAppBadge' in navigator) {
            (navigator as any).setAppBadge(newCount).catch(console.warn);
          } else if (newCount <= 0 && 'clearAppBadge' in navigator) {
            (navigator as any).clearAppBadge().catch(console.warn);
          }
        }
      }).catch(console.warn);
    }
  }).catch((err) => {
    seenProcessing.delete(chatId);
    console.warn("markChatAsSeen transaction failed:", err);
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
    const [locSnapshot, precSnapshot] = await Promise.all([
      get(ref(rtdb, `location/${receiverId}`)),
      get(ref(rtdb, `global_presence/${receiverId}`))
    ]);
    
    const location = locSnapshot.val();
    
    // Case C: recipient has the chat open - nothing gets updated.
    if (location === chatId) {
      return;
    }
    
    // Case B & Case A: recipient has the chat closed - unseen chat number must be incremented atomically.
    let needsIncrement = false;
    await runTransaction(inboxRef, (currentVal) => {
      if (currentVal === false) {
        return; // already false, abort transaction
      }
      needsIncrement = true;
      return false; // set to false
    });

    const countRef = ref(rtdb, `unseen_chat_count/${receiverId}`);
    let updatedUnseenCount = 0;
    
    if (needsIncrement) {
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

export const checkGroupPresenceAndNotify = async (
  senderId: string,
  groupId: string,
  participantIds: string[],
  messageData: any
) => {
  if (!rtdb) return;
  try {
    const promises = participantIds
      .filter(id => id !== senderId)
      .map(async (receiverId) => {
        try {
          const locationRef = ref(rtdb, `location/${receiverId}`);
          const inboxRef = ref(rtdb, `inboxes/${receiverId}/${groupId}`);
          
          const locSnap = await get(locationRef);
          const location = locSnap.val();
          if (location === groupId) {
            // Recipient is active in this group chat room right now, do not notify/set unseen
            return;
          }
          
          let needsIncrement = false;
          await runTransaction(inboxRef, (currentVal) => {
            if (currentVal === false) {
              return; // already false, abort transaction
            }
            needsIncrement = true;
            return false; // set to false
          });

          if (needsIncrement) {
            const countRef = ref(rtdb, `unseen_chat_count/${receiverId}`);
            await runTransaction(countRef, (currentVal) => {
              return (currentVal || 0) + 1;
            });
          }
        } catch (err) {
          console.error(`Group notifier failed for participant ${receiverId} in group ${groupId}:`, err);
        }
      });
      
    await Promise.all(promises);
  } catch (error) {
    console.warn("Error in checkGroupPresenceAndNotify:", error);
  }
};

