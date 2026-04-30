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

  try {
    if (event.data) {
      const parsedData = event.data.json();
      if (parsedData.title) title = parsedData.title;
      if (parsedData.body) body = parsedData.body;
      if (parsedData.data && parsedData.data.url) url = parsedData.data.url;
    }
  } catch (e) {
    try {
      body = event.data ? event.data.text() : 'No payload';
    } catch (e2) {
      body = 'Error reading push data';
    }
  }

  const options = {
    body: body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: url }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  const urlToOpen = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

