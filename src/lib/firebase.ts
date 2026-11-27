import { initializeApp } from "firebase/app";
import { getMessaging, getToken, deleteToken, onMessage } from "firebase/messaging";
import { getDatabase } from "firebase/database";

// TODO: Replace with your Firebase project configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL
};

const app = initializeApp(firebaseConfig);

export const messaging = typeof window !== "undefined" && 'serviceWorker' in navigator 
  ? getMessaging(app) 
  : null;

export const rtdb = getDatabase(app);

export const setupForegroundMessageListener = (callback: (payload: any) => void) => {
  if (!messaging) return null;
  return onMessage(messaging, callback);
};

const getReadyMessagingRegistration = async (): Promise<ServiceWorkerRegistration | undefined> => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return undefined;
  try {
    let reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (!reg) {
      reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    }
    if (reg.active) return reg;

    const readyReg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000))
    ]);
    return readyReg || reg;
  } catch (err) {
    console.warn("Service worker registration lookup failed:", err);
    return undefined;
  }
};

export interface PushTokenOptions {
  requestPermission?: boolean;
  forceRefresh?: boolean;
}

export const requestFirebaseNotificationPermission = async (options: PushTokenOptions = {}) => {
  const { requestPermission = true, forceRefresh = false } = options;
  if (!messaging || typeof window === 'undefined' || !('Notification' in window)) return null;

  try {
    let permission = Notification.permission;
    if (permission !== 'granted') {
      if (!requestPermission) {
        return null;
      }
      permission = await Notification.requestPermission();
    }

    if (permission === 'granted') {
      if (navigator.storage?.persist) {
        navigator.storage.persist().catch(() => {});
      }

      const serviceWorkerRegistration = await getReadyMessagingRegistration();

      if (forceRefresh) {
        await deleteToken(messaging).catch(() => {});
      }

      const token = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, // FCM Web Push certificate key pair
        ...(serviceWorkerRegistration ? { serviceWorkerRegistration } : {})
      });
      return token || null;
    }
  } catch (error) {
    console.error("Firebase FCM Token Error:", error);
  }
  return null;
};
