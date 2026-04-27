self.addEventListener('push', function(event) {
  let data = {};
  if (event.data) {
    data = event.data.json();
  }

  const title = data.title || 'New Message on Socium';
  const options = {
    body: data.body || 'You have a new message.',
    icon: '/vite.svg',
    badge: '/vite.svg',
    data: { url: '/' }
  };

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // If any client window is focused, we don't show the system notification!
      // This is because the app itself will indicate new messages (e.g. unread dot or in realtime chat window).
      for (let i = 0; i < clientList.length; i++) {
        if (clientList[i].focused) {
          return;
        }
      }
      return self.registration.showNotification(title, options);
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
