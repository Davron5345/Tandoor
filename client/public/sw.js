self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || 'Новая заявка' };
  }

  const title = payload.title || 'Новая заявка';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    tag: payload.tag || 'shop-order',
    renotify: true,
    data: {
      url: payload.url || '/warehouse/orders',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/warehouse/orders';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.includes('/warehouse/orders') && 'focus' in client) {
        return client.focus();
      }
    }
    if (clients.openWindow) {
      return clients.openWindow(targetUrl);
    }
    return undefined;
  })());
});

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
