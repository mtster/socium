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

  // Track inboxes in real-time to immediately clear unread state if user is inside that chat room,
  // and maintain strict, correct self-healed unseen_chat_count even with concurrent messages.
  const inboxesRef = ref(rtdb, `inboxes/${userId}`);
  const unsubscribeInboxes = onValue(inboxesRef, (snapshot) => {
    if (!snapshot.exists()) {
      const uCountRef = ref(rtdb, `unseen_chat_count/${userId}`);
      set(uCountRef, 0).catch(console.error);
      return;
    }
    const inboxes = snapshot.val();
    let actualFalseCount = 0;
    
    Object.keys(inboxes).forEach((chatId) => {
      if (inboxes[chatId] === false) {
        const currentOpenChatId = (window as any).currentChatUserId;
        if (currentOpenChatId === chatId) {
          markChatAsSeen(userId, chatId);
        } else {
          actualFalseCount++;
        }
      }
    });

    // Auto-align unseen_chat_count to perfectly match actual false inboxes count inside database
    const uCountRef = ref(rtdb, `unseen_chat_count/${userId}`);
    get(uCountRef).then((countSnap) => {
      const currentCount = countSnap.val() || 0;
      if (currentCount !== actualFalseCount) {
        set(uCountRef, actualFalseCount).catch(console.error);
      }
    }).catch(console.error);
  });

  return () => {
    set(globalPresenceRef, false).catch(console.error);
    set(locationRef, 'none').catch(console.error);
    unsubscribeCount();
    unsubscribeInboxes();
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

  // Fetch true state from server before transaction to populate local cache and prevent early aborts!
  get(inboxRef).then((snapshot) => {
    const val = snapshot.val();
    if (val === false) {
      runTransaction(inboxRef, (currentVal) => {
        // Since we did 'get', local cache is populated.
        if (currentVal === false || currentVal === null) {
          return true;
        }
        return; // Already true, abort
      }).then((result) => {
        seenProcessing.delete(chatId);
        if (result.committed) {
          const countRef = ref(rtdb, `unseen_chat_count/${userId}`);
          runTransaction(countRef, (currentVal) => {
            return Math.max(0, (currentVal || 0) - 1);
          }).then((countResult) => {
            if (countResult.committed) {
              const newCount = countResult.snapshot.val() || 0;
              if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
                if (newCount > 0) {
                  (navigator as any).setAppBadge(newCount).catch(console.warn);
                } else {
                  (navigator as any).clearAppBadge().catch(console.warn);
                }
              }
            }
          }).catch(console.warn);
        }
      }).catch((err) => {
        seenProcessing.delete(chatId);
        console.warn("markChatAsSeen transaction failed:", err);
      });
    } else {
      seenProcessing.delete(chatId);
    }
  }).catch((err) => {
    seenProcessing.delete(chatId);
    console.warn("get inbox failed in markChatAsSeen:", err);
  });
};

const inFlightMails = new Set<string>();

export const checkRecipientPresenceAndNotify = async (
  senderId: string, 
  receiverId: string, 
  chatId: string,
  messageData: any
) => {
  if (!rtdb) return;

  if (receiverId === senderId) return;
  
  const mailKey = `${receiverId}:${chatId}`;
  const isAlreadyInFlight = inFlightMails.has(mailKey);
  inFlightMails.add(mailKey);
  
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
      inFlightMails.delete(mailKey);
      return;
    }
    
    // Case B & Case A: recipient has the chat closed - unseen chat number must be incremented atomically.
    let needsIncrement = false;
    if (!isAlreadyInFlight) {
      await runTransaction(inboxRef, (currentVal) => {
        if (currentVal === false) {
          return; // already false, abort transaction
        }
        needsIncrement = true;
        return false; // set to false
      });
    }

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
  } finally {
    setTimeout(() => {
      inFlightMails.delete(mailKey);
    }, 1500);
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
        const mailKey = `${receiverId}:${groupId}`;
        const isAlreadyInFlight = inFlightMails.has(mailKey);
        inFlightMails.add(mailKey);

        try {
          const locationRef = ref(rtdb, `location/${receiverId}`);
          const inboxRef = ref(rtdb, `inboxes/${receiverId}/${groupId}`);
          
          const locSnap = await get(locationRef);
          const location = locSnap.val();
          if (location === groupId) {
            inFlightMails.delete(mailKey);
            return;
          }
          
          let needsIncrement = false;
          if (!isAlreadyInFlight) {
            await runTransaction(inboxRef, (currentVal) => {
              if (currentVal === false) {
                return; // already false, abort transaction
              }
              needsIncrement = true;
              return false; // set to false
            });
          }

          if (needsIncrement) {
            const countRef = ref(rtdb, `unseen_chat_count/${receiverId}`);
            await runTransaction(countRef, (currentVal) => {
              return (currentVal || 0) + 1;
            });
          }
        } catch (err) {
          console.error(`Group notifier failed for participant ${receiverId} in group ${groupId}:`, err);
        } finally {
          setTimeout(() => {
            inFlightMails.delete(mailKey);
          }, 1500);
        }
      });
      
    await Promise.all(promises);
  } catch (error) {
    console.warn("Error in checkGroupPresenceAndNotify:", error);
  }
};

