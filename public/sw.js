self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate');
  event.waitUntil(clients.claim());
});

self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push Received.');
  console.log(`[Service Worker] Push had this data: "${event.data ? event.data.text() : 'no data'}"`);

  let data = {};
  if (event.data) {
    try {
      data = JSON.parse(event.data.text());
    } catch(e) {
      console.error('[Service Worker] Failed to parse push data as JSON', e);
      data = { body: event.data.text() };
    }
  }

  const title = data.title || 'Socium';
  const options = {
    body: data.body || 'New notification',
    icon: '/vite.svg',
    badge: '/vite.svg',
    data: { url: '/' }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
      .catch(err => console.error('[Service Worker] Error showing notification:', err))
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
          }
        }
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
