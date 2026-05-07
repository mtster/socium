import { ref, onValue, set, onDisconnect, increment, get } from "firebase/database";
import { rtdb } from "./firebase";
import { supabase } from "./supabase";

export const initPresence = (userId: string) => {
  if (!rtdb) return;

  const globalPresenceRef = ref(rtdb, `global_presence/${userId}`);
  const locationRef = ref(rtdb, `location/${userId}`);
  
  // Set presence to true when initialized
  set(globalPresenceRef, true);
  
  // Clean up on disconnect
  onDisconnect(globalPresenceRef).set(false);
  onDisconnect(locationRef).set('none');
  
  // Ensure unseen_chat_count exists and initialized
  const countRef = ref(rtdb, `unseen_chat_count/${userId}`);
  get(countRef).then(snapshot => {
    if (!snapshot.exists()) {
      set(countRef, 0);
    }
  });

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
    set(globalPresenceRef, false);
    set(locationRef, 'none');
    unsubscribeCount();
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

  const recipientLocationRef = ref(rtdb, `location/${receiverId}`);
  const locSnapshot = await get(recipientLocationRef);
  const location = locSnapshot.val();

  // 1. recipient has the chat open - nothing gets updated.
  if (location === senderId) {
    return;
  }

  // 2. recipient has the chat closed - unseen chat number must be incremented.
  const inboxRef = ref(rtdb, `inboxes/${receiverId}/${senderId}`);
  const inboxSnapshot = await get(inboxRef);
  const isSeen = inboxSnapshot.val();
  
  if (isSeen !== false) {
    set(inboxRef, false);
    const countRef = ref(rtdb, `unseen_chat_count/${receiverId}`);
    await set(countRef, increment(1));
  }

  const globalPresenceRef = ref(rtdb, `global_presence/${receiverId}`);
  const precSnapshot = await get(globalPresenceRef);
  const isOnline = precSnapshot.val() === true;

  if (!isOnline) {
    // trigger edge function to send push notification
    try {
      const { data, error } = await supabase.functions.invoke('send-push', {
        body: JSON.stringify(messageData)
      });
      if (error) console.error("Error triggering push:", error);
    } catch (e) {
      console.error("Error invoking edge function:", e);
    }
  }
};
