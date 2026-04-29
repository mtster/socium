self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate');
  event.waitUntil(clients.claim());
});

self.addEventListener('push', function(event) {
  let title = 'Socium';
  let body = 'New notification';
  let url = '/';

  if (event.data) {
    try {
      const data = event.data.json();
      if (data.title) title = data.title;
      if (data.body) body = data.body;
      if (data.data && data.data.url) url = data.data.url;
    } catch(e) {
      body = event.data.text();
    }
  }

  const options = {
    body: body,
    data: { url: url }
  };

  const notificationPromise = self.registration.showNotification(title, options)
    .then(() => {
      // broadcast success securely
      return clients.matchAll({ type: 'window', includeUncontrolled: true });
    })
    .then(clientList => {
      clientList.forEach(client => {
        client.postMessage({ type: 'SW_LOG', message: `Delivery Success: push notification displayed` });
      });
    })
    .catch(err => {
      console.error(err);
      return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        list.forEach(client => {
          client.postMessage({ type: 'SW_LOG', message: `Delivery Failed: error showing notification` });
        });
      });
    });

  event.waitUntil(notificationPromise);
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
