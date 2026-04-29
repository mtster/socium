self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate');
  event.waitUntil(clients.claim());
});

// Simple helper to log to IndexedDB
function persistLog(message) {
  const time = new Date().toISOString();
  console.log(message);
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SWLogsDB', 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('logs', { autoIncrement: true });
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('logs', 'readwrite');
      const store = tx.objectStore('logs');
      store.add({ time, message });
      tx.oncomplete = () => resolve();
      tx.onerror = (err) => reject(err);
    };
    request.onerror = (err) => reject(err);
  }).catch(e => console.error('IDB log failed', e));
}

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
    .then(() => persistLog(`[SW] showNotification completed successfully. Push Received: title=${title}, body=${body}`))
    .catch(err => persistLog(`[SW] showNotification ERROR: ${err.message}`));

  event.waitUntil(notificationPromise);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  const clickPromise = persistLog(`[SW] Notification clicked`)
    .then(() => clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .then((clientList) => {
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
    });

  event.waitUntil(clickPromise);
});

