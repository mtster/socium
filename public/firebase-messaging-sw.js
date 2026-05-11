importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDZMeRiZVKqvziAjAaZSsn7QpQ4xGG0QKs",
  authDomain: "socium-b881e.firebaseapp.com",
  projectId: "socium-b881e",
  storageBucket: "socium-b881e.firebasestorage.app",
  messagingSenderId: "43198571088",
  appId: "1:43198571088:web:97d0170b52ea90af146755"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.data?.title || 'New Message';
  // FIX: On iOS 17, the 'badge' in notificationOptions is for the icon, 
  // but we must ensure we handle the numeric badge correctly.
  const notificationOptions = {
    body: payload.data?.body || '',
    icon: '/icon-192.png',
    data: {
      url: payload.data?.url || '/',
      senderId: payload.data?.senderId || '',
      badge: payload.data?.badge // keep it here for access in click
    }
  };

  // Set the badge immediately - don't wait for the ping logic
  if ('setAppBadge' in navigator && payload.data?.badge) {
    navigator.setAppBadge(parseInt(payload.data.badge)).catch(() => {});
  }

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification click Received.', event);
  event.notification.close();

  let urlToOpen = event.notification.data?.url || '/';
  if (event.notification.data?.senderId && !urlToOpen.includes('chatId=')) {
    urlToOpen = `/?chatId=${event.notification.data.senderId}`;
  }

  const absoluteUrl = new URL(urlToOpen, 'https://sociumx.vercel.app').href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      // 1. Check if the app is already open
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        
        // FIX: Instead of just focusing and hoping postMessage works, 
        // Force the window to navigate to the chat URL. 
        // This is much more reliable on iOS 17.
        if ('navigate' in client && 'focus' in client) {
          client.focus();
          return client.navigate(absoluteUrl); 
        }
      }
      
      // 2. If no window is found, open a new one
      if (clients.openWindow) {
        return clients.openWindow(absoluteUrl);
      }
    })
  );
});
