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
    firebase.auth().onAuthStateChanged(function(user) {
      if (user) {
        const uid = user.uid;
        firebase.database().ref('/unseen_chat_count/' + uid).once('value')
          .then((snapshot) => {
            const count = snapshot.val() || 0;
            resolve(count);
          })
          .catch((err) => {
            console.error('Failed to get unseen count:', err);
            resolve(null);
          });
      } else {
        resolve(null);
      }
    });
    
    // Fallback if auth state doesn't resolve quickly
    setTimeout(() => resolve(null), 3000);
  });
}

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
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

  const promiseChain = getBadgeCount().then((badgeCount) => {
    if (badgeCount !== null) {
      notificationOptions.data.badge = badgeCount;
      if ('setAppBadge' in navigator) {
        navigator.setAppBadge(parseInt(badgeCount)).catch(() => {});
      }
    }
    return self.registration.showNotification(notificationTitle, notificationOptions);
  });

  // Use waitUntil if possible in standard SW, but Firebase onBackgroundMessage wraps things.
  // Actually, returning a Promise blocks the SW until it's done, which acts like waitUntil.
  return promiseChain;
});

self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification click Received.', event);
  event.notification.close();

  let urlToOpen = event.notification.data?.url || '/';
  const senderId = event.notification.data?.senderId || '';
  const groupChatId = event.notification.data?.groupChatId || '';
  if (groupChatId && !urlToOpen.includes('chat_with=') && !urlToOpen.includes('chatId=')) {
    urlToOpen += (urlToOpen.includes('?') ? '&' : '?') + `chatId=${groupChatId}`;
  } else if (senderId && !urlToOpen.includes('chat_with=') && !urlToOpen.includes('chatId=')) {
    urlToOpen += (urlToOpen.includes('?') ? '&' : '?') + `chat_with=${senderId}`;
  }

  const baseUrl = 'https://sociumx.vercel.app';
  const absoluteUrl = new URL(urlToOpen, baseUrl).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ('focus' in client) {
          client.focus();
          if (groupChatId) {
            client.postMessage({ type: 'OPEN_CHAT', groupChatId });
          } else if (senderId) {
            client.postMessage({ type: 'OPEN_CHAT', senderId });
          } else {
            client.navigate(absoluteUrl);
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(absoluteUrl);
      }
    })
  );
});
