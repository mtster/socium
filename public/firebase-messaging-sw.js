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
          
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
          
          Promise.race([fetchPromise, timeoutPromise])
            .then((count) => {
              try { firebase.database().goOffline(); } catch (e) {}
              resolve(count);
            })
            .catch((err) => {
              try { firebase.database().goOffline(); } catch (e) {}
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
  let payloadBadge = null;
  let isIncomingCall = false;
  try {
    const raw = event.data ? event.data.json() : null;
    if (raw?.data?.type === 'incoming_call' || raw?.data?.callId) {
      isIncomingCall = true;
    }
    const badgeStr = raw?.data?.badge ?? raw?.notification?.badge;
    if (badgeStr !== undefined && badgeStr !== null && badgeStr !== '') {
      const parsed = parseInt(String(badgeStr), 10);
      if (!Number.isNaN(parsed)) payloadBadge = parsed;
    }
  } catch (e) {}

  if (isIncomingCall) {
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If there is an active visible foreground window client, do NOT update badge
      // from the background service worker! The active client has real-time sockets.
      const isAnyVisible = windowClients.some(client => client.visibilityState === 'visible');
      if (isAnyVisible) {
        return;
      }

      const badgePromise = payloadBadge !== null ? Promise.resolve(payloadBadge) : getBadgeCount();
      return badgePromise.then((badgeCount) => {
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

function getCachedUid() {
  return caches.open('user-meta')
    .then(cache => cache.match('/uid'))
    .then(response => (response ? response.text() : null))
    .catch(() => null);
}

function closeNotificationsByTag(tag) {
  if (!tag || !self.registration || !self.registration.getNotifications) {
    return Promise.resolve();
  }
  return self.registration.getNotifications({ tag })
    .then(list => {
      list.forEach(n => n.close());
    })
    .catch(() => {});
}

messaging.onBackgroundMessage(function(payload) {
  // ONLY display manual notification if payload.notification is ABSENT (i.e. a data-only message)
  if (!payload.notification) {
    const isCall = payload.data?.type === 'incoming_call' || Boolean(payload.data?.callId);
    const notificationTitle = payload.data?.title || payload.data?.callerName || (isCall ? 'Incoming Call' : 'New Message');
    const notificationOptions = {
      body: payload.data?.body || '',
      icon: '/icon-192.png',
      ...(isCall ? {
        tag: payload.data?.tag || `call_${payload.data?.callId}`,
        renotify: true,
        requireInteraction: true,
        vibrate: [500, 200, 500],
        actions: [
          { action: 'answer', title: 'Answer' },
          { action: 'decline', title: 'Decline' }
        ]
      } : {}),
      data: {
        type: payload.data?.type || '',
        callId: payload.data?.callId || '',
        url: payload.data?.url || '/',
        senderId: payload.data?.senderId || payload.data?.sender_id || '',
        groupChatId: payload.data?.groupChatId || payload.data?.group_chat_id || ''
      }
    };
    return self.registration.showNotification(notificationTitle, notificationOptions);
  }
});

self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification click Received.', event);
  event.notification.close();

  // Robust deep-extraction from potential FCM message containers
  const dataNode = event.notification.data || {};
  const fcmNode = dataNode.FCM_MSG?.data || {};
  const fcmNotification = dataNode.FCM_MSG?.notification || {};

  let urlToOpen = dataNode.url || fcmNode.url || dataNode.FCM_MSG?.webpush?.fcm_options?.link || dataNode.click_action || fcmNotification.click_action || '/';
  let callId = dataNode.callId || fcmNode.callId || '';

  try {
    const parsedInitial = new URL(urlToOpen, self.location.origin);
    if (!callId) {
      callId = parsedInitial.searchParams.get('incoming_call') || '';
    }
  } catch (_) {}

  // Incoming call notification click / Answer / Decline handling
  if (callId) {
    const notifTag = event.notification.tag || `call_${callId}`;

    if (event.action === 'decline') {
      event.waitUntil(
        Promise.all([
          closeNotificationsByTag(notifTag),
          getCachedUid().then(async (uid) => {
            if (!uid) return;
            try {
              await firebase.database().ref(`calls/${callId}/participants/${uid}/status`).set('declined');
              await firebase.database().ref(`user_calls/${uid}/active`).set(null);
              const metaSnap = await firebase.database().ref(`calls/${callId}/meta`).once('value');
              const meta = metaSnap.val();
              if (meta && !meta.is_group) {
                await firebase.database().ref(`calls/${callId}/status`).set('ended');
                if (meta.caller_id) {
                  await firebase.database().ref(`user_calls/${meta.caller_id}/active`).set(null);
                }
              }
            } catch (err) {
              console.warn('[firebase-messaging-sw.js] Decline call RTDB write failed:', err);
            } finally {
              try { firebase.database().goOffline(); } catch (_) {}
            }
          }),
          clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            windowClients.forEach((client) => {
              try {
                client.postMessage({ type: 'DECLINE_CALL', callId });
              } catch (_) {}
            });
          })
        ])
      );
      return;
    }

    const autoAnswer = event.action === 'answer';
    const callUrl = `/?incoming_call=${encodeURIComponent(callId)}${autoAnswer ? '&auto_answer=1' : ''}`;
    const absoluteCallUrl = new URL(callUrl, self.location.origin).href;

    event.waitUntil(
      Promise.all([
        closeNotificationsByTag(notifTag),
        caches.open('notification-route').then(function(cache) {
          return cache.put(
            new Request('/target-route'),
            new Response(JSON.stringify({
              callId,
              autoAnswer,
              url: absoluteCallUrl,
              timestamp: Date.now()
            }), { headers: { 'Content-Type': 'application/json' } })
          );
        })
      ]).then(function() {
        return clients.matchAll({ type: 'window', includeUncontrolled: true });
      }).then(function(windowClients) {
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          if ('focus' in client) {
            try {
              client.postMessage({ type: 'OPEN_CALL', callId, autoAnswer, url: absoluteCallUrl });
            } catch (_) {}
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(absoluteCallUrl);
        }
      })
    );
    return;
  }

  // Extract custom payload fields supporting multiple casing formats (camelCase & snake_case)
  let senderId = dataNode.senderId || dataNode.sender_id || fcmNode.senderId || fcmNode.sender_id || '';
  let groupChatId = dataNode.groupChatId || dataNode.group_chat_id || fcmNode.groupChatId || fcmNode.group_chat_id || '';

  // Fail-safe: extract search parameters directly from the payload's url
  try {
    const parsedUrl = new URL(urlToOpen, self.location.origin);
    if (!groupChatId) {
      groupChatId = parsedUrl.searchParams.get('chatId') || parsedUrl.searchParams.get('groupChatId') || '';
    }
    if (!senderId) {
      senderId = parsedUrl.searchParams.get('chat_with') || parsedUrl.searchParams.get('senderId') || '';
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
    caches.open('notification-route').then(function(cache) {
      const routeData = {
        senderId: senderId,
        groupChatId: groupChatId,
        url: absoluteUrl,
        timestamp: Date.now()
      };
      return cache.put(
        new Request('/target-route'),
        new Response(JSON.stringify(routeData), {
          headers: { 'Content-Type': 'application/json' }
        })
      );
    }).then(function() {
      return clients.matchAll({ type: 'window', includeUncontrolled: true });
    }).then(function(windowClients) {
      let focused = false;
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ('focus' in client) {
          try {
            client.postMessage({ type: 'OPEN_CHAT', senderId: senderId, groupChatId: groupChatId, url: absoluteUrl });
          } catch (e) {
            console.warn('[firebase-messaging-sw.js] postMessage failed:', e);
          }
          
          client.focus();
          
          if ('navigate' in client) {
            client.navigate(absoluteUrl).catch((err) => {
              console.warn('[firebase-messaging-sw.js] client.navigate failed:', err);
            });
          }
          focused = true;
          break;
        }
      }
      if (!focused && clients.openWindow) {
        return clients.openWindow(absoluteUrl);
      }
    })
  );
});
