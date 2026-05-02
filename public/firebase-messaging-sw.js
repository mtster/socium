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
  const notificationOptions = {
    body: payload.data?.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {
      url: payload.data?.url || '/',
      senderId: payload.data?.senderId || ''
    }
  };

  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async function(clientList) {
    let isVisible = false;

    // Check basic properties
    if (clientList.some(c => c.visibilityState === 'visible' || c.focused)) {
      isVisible = true;
    }

    // Try pinging if optimistic check failed (for iOS reliability)
    if (!isVisible && clientList.length > 0) {
      isVisible = await new Promise((resolve) => {
        let answered = false;
        
        for (const client of clientList) {
          try {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
              if (event.data === 'VISIBLE') {
                answered = true;
                resolve(true);
              }
            };
            client.postMessage('PING_VISIBILITY', [channel.port2]);
          } catch(e) { console.error('Ping failed for a client'); }
        }
        
        setTimeout(() => {
          if (!answered) resolve(false);
        }, 1500); // give it 1.5 seconds to reply
      });
    }

    if (!isVisible) {
      if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator && payload.data?.badge) {
        navigator.setAppBadge(parseInt(payload.data.badge)).catch(() => {});
      }
      self.registration.showNotification(notificationTitle, notificationOptions);
    }
  });
});

self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification click Received.', event);
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      // 1. Try to find a client that is already open
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ('focus' in client) {
          return client.focus();
        }
      }
      
      // 2. Fallback: open a new window
      if (clients.openWindow) {
         return clients.openWindow(urlToOpen);
      }
    })
  );
});
