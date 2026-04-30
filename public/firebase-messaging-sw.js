importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging-compat.js');

// We use self.FIREBASE_CONFIG which can be set dynamically or statically.
// The user will replace this block using the actual config, but we'll try to get it from URL params if we were clever, OR just leave placeholder.
// Note: Service Workers don't have access to import.meta.env, so config must be hardcoded here or injected during build.
// For now, we will add an explicit REPLACE_ME block.

firebase.initializeApp({
  apiKey: "REPLACE_ME_VITE_FIREBASE_API_KEY",
  authDomain: "REPLACE_ME_VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "REPLACE_ME_VITE_FIREBASE_PROJECT_ID",
  storageBucket: "REPLACE_ME_VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_ME_VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "REPLACE_ME_VITE_FIREBASE_APP_ID"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification?.title || payload.data?.title || 'New Message';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {
      url: payload.data?.url || '/'
    }
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification click Received.', event);
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.indexOf(urlToOpen) !== -1 && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
