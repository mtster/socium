importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-auth-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-database-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDZMeRiZVKqvziAjAaZSsn7QpQ4xGG0QKs",
  authDomain: "socium-b881e.firebaseapp.com",
  projectId: "socium-b881e",
  databaseURL: "https://socium-b881e-default-rtdb.europe-west1.firebasedatabase.app",
  storageBucket: "socium-b881e.firebasestorage.app",
  messagingSenderId: "43198571088",
  appId: "1:43198571088:web:97d0170b52ea90af146755"
});

const messaging = firebase.messaging();

function getBadgeCount() {
  return new Promise((resolve) => {
    // Try Cache Storage first (instant and reliable in background)
    caches.open('user-meta')
      .then(cache => cache.match('/uid'))
      .then(response => {
        if (response) {
          return response.text();
        }
        return null;
      })
      .then((cacheUid) => {
        if (cacheUid) {
          return cacheUid;
        }
        // Fallback to Auth
        return new Promise((innerResolve) => {
          const unsubscribe = firebase.auth().onAuthStateChanged(function(user) {
            if (user) {
              innerResolve(user.uid);
            } else {
              innerResolve(null);
            }
            unsubscribe();
          });
          setTimeout(() => innerResolve(null), 1000);
        });
      })
      .then((uid) => {
        if (uid) {
          const fetchPromise = firebase.database().ref('/unseen_chat_count/' + uid).once('value')
            .then((snapshot) => snapshot.val() || 0);
          
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000));
          
          Promise.race([fetchPromise, timeoutPromise])
            .then((count) => resolve(count))
            .catch((err) => {
              console.error('[firebase-messaging-sw.js] Failed to fetch unseen count in time:', err);
              resolve(null);
            });
        } else {
          resolve(null);
        }
      })
      .catch((err) => {
        console.error('Cache or direct read failed:', err);
        resolve(null);
      });
  });
}

// Intercept all raw push events (including FCM group chat multicasts) to ensure
// the application badge count is always updated dynamically in the background.
self.addEventListener('push', function(event) {
  console.log('[firebase-messaging-sw.js] Custom push event intercepted:', event);
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If there is an active visible foreground window client, do NOT update badge
      // from the background service worker! The active client has real-time sockets
      // and will maintain a pristine badge, eliminating foreground/background racing.
      const isAnyVisible = windowClients.some(client => client.visibilityState === 'visible');
      if (isAnyVisible) {
        console.log('[firebase-messaging-sw.js] Visible window found. Foreground client handles badge updates.');
        return;
      }

      return getBadgeCount().then((badgeCount) => {
        console.log('[firebase-messaging-sw.js] Custom push calculated badgeCount:', badgeCount);
        if (badgeCount !== null) {
          const nav = typeof navigator !== 'undefined' ? navigator : (self.navigator || null);
          if (nav && 'setAppBadge' in nav) {
            return nav.setAppBadge(parseInt(badgeCount)).catch((err) => {
              console.warn('[firebase-messaging-sw.js] Failed to setAppBadge:', err);
            });
          }
        }
      });
    })
  );
});

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const promiseChain = clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
    const isAnyVisible = windowClients.some(client => client.visibilityState === 'visible');
    
    return getBadgeCount().then((badgeCount) => {
      if (badgeCount !== null && !isAnyVisible) {
        const nav = typeof navigator !== 'undefined' ? navigator : (self.navigator || null);
        if (nav && 'setAppBadge' in nav) {
          nav.setAppBadge(parseInt(badgeCount)).catch(() => {});
        }
      }

      // ONLY display manual notification if payload.notification is ABSENT (i.e. a data-only message)
      if (!payload.notification) {
        const notificationTitle = payload.data?.title || 'New Message';
        const notificationOptions = {
          body: payload.data?.body || '',
          icon: '/icon-192.png',
          data: {
            url: payload.data?.url || '/',
            senderId: payload.data?.senderId || payload.data?.sender_id || '',
            groupChatId: payload.data?.groupChatId || payload.data?.group_chat_id || ''
          }
        };
        return self.registration.showNotification(notificationTitle, notificationOptions);
      }
    });
  });

  return promiseChain;
});

self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification click Received.', event);
  event.notification.close();

  let urlToOpen = event.notification.data?.url || '/';
  
  // Extract custom payload fields supporting multiple casing formats (camelCase & snake_case)
  let senderId = event.notification.data?.senderId || event.notification.data?.sender_id || '';
  let groupChatId = event.notification.data?.groupChatId || event.notification.data?.group_chat_id || '';

  // Fail-safe: extract search parameters directly from the payload's url
  try {
    const parsedUrl = new URL(urlToOpen, self.location.origin);
    if (!groupChatId) {
      groupChatId = parsedUrl.searchParams.get('chatId') || '';
    }
    if (!senderId) {
      senderId = parsedUrl.searchParams.get('chat_with') || parsedUrl.searchParams.get('chatId') || '';
    }
  } catch (e) {
    console.warn('[firebase-messaging-sw.js] URL parsing exception in notificationclick:', e);
  }

  // Inject proper query parameters to ensure SPA initial load knows which route to mount
  if (groupChatId && !urlToOpen.includes('chat_with=') && !urlToOpen.includes('chatId=')) {
    urlToOpen += (urlToOpen.includes('?') ? '&' : '?') + `chatId=${groupChatId}`;
  } else if (senderId && !urlToOpen.includes('chat_with=') && !urlToOpen.includes('chatId=')) {
    urlToOpen += (urlToOpen.includes('?') ? '&' : '?') + `chat_with=${senderId}`;
  }

  // Use dynamic self.location.origin instead of a hardcoded string!
  // This enables perfect routing across all preview URLs, development containers, and custom domains.
  const baseUrl = self.location.origin;
  const absoluteUrl = new URL(urlToOpen, baseUrl).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ('focus' in client) {
          // If the page is already open, focus it and trigger an instant routing transition.
          // By utilizing postMessage, we completely bypass sluggish full page reloads in SPA!
          client.postMessage({ type: 'OPEN_CHAT', senderId, groupChatId });
          client.focus();
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(absoluteUrl);
      }
    })
  );
});
