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

  let urlToOpen = event.notification.data?.url || '/';
  if (event.notification.data?.senderId && !urlToOpen.includes('chat_with=')) {
    if (urlToOpen === '/') {
        urlToOpen = `/?chat_with=${event.notification.data.senderId}`;
    } else {
        urlToOpen += (urlToOpen.includes('?') ? '&' : '?') + `chat_with=${event.notification.data.senderId}`;
    }
  }

  const absoluteUrl = new URL(urlToOpen, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      if (windowClients.length > 0) {
        // Find if any window is already focused
        let clientToFocus = windowClients[0];
        for (let i = 0; i < windowClients.length; i++) {
           if (windowClients[i].focused) {
              clientToFocus = windowClients[i];
              break;
           }
        }
        
        if ('focus' in clientToFocus) {
          return clientToFocus.focus().then((client) => {
             if (client) {
               if (event.notification.data?.senderId) {
                 client.postMessage({ type: 'OPEN_CHAT', senderId: event.notification.data.senderId });
               }
               // Add a fallback navigate in case postMessage isn't caught
               setTimeout(() => {
                 if ('navigate' in client && event.notification.data?.senderId) {
                    client.navigate(absoluteUrl).catch(() => {});
                 }
               }, 500);
             }
             return client;
          }).catch(e => {
             if (self.clients.openWindow) return self.clients.openWindow(absoluteUrl);
          });
        }
      }
      
      if (self.clients.openWindow) {
         return self.clients.openWindow(absoluteUrl);
      }
    })
  );
});
