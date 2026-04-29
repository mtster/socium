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
  const pushText = event.data ? event.data.text() : 'no data';
  console.log(`[Service Worker] Push had this data: "${pushText}"`);

  // Report to clients
  clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    clientList.forEach(client => {
      client.postMessage({ type: 'SW_LOG', message: `Push Received: ${pushText}` });
    });
  });

  let data = {};
  if (event.data) {
    try {
      data = JSON.parse(pushText);
    } catch(e) {
      console.error('[Service Worker] Failed to parse push data as JSON', e);
      data = { body: pushText };
    }
  }

  const title = data.title || 'Socium';
  const options = {
    body: data.body || 'New notification',
    data: { url: '/' }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => {
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
          clientList.forEach(client => {
            client.postMessage({ type: 'SW_LOG', message: `showNotification completed successfully.` });
          });
        });
      })
      .catch(err => {
        console.error('[Service Worker] Error showing notification:', err);
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
          clientList.forEach(client => {
            client.postMessage({ type: 'SW_LOG', message: `Error showing notification: ${err.message}` });
          });
        });
      })
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
