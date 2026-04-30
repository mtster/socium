import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// TODO: Replace with your Firebase project configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);

export const messaging = typeof window !== "undefined" && 'serviceWorker' in navigator 
  ? getMessaging(app) 
  : null;

export const setupForegroundMessageListener = (callback: (payload: any) => void) => {
  if (!messaging) return null;
  return onMessage(messaging, callback);
};

export const requestFirebaseNotificationPermission = async () => {
  if (!messaging) return null;
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY // FCM Web Push certificate key pair
      });
      return token;
    }
  } catch (error) {
    console.error("Firebase FCM Token Error:", error);
  }
  return null;
};
