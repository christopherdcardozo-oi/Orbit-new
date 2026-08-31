// Orbit service worker — handles web push delivery.
//
// Registered from lib/webPush.ts once, on the first client boot that
// has web-push support. Not bundled through Metro (raw JS, served
// straight from /public/sw.js).
//
// Handles two events:
//   push               → parse payload, show the notification
//   notificationclick  → focus an existing tab if we have one, else
//                        open a new one at the deep link
//
// See docs/push-notifications.md for the notification catalog.
//
// Cache versioning is intentionally minimal — this SW does not cache
// any app assets. If we ever add offline caching, bump this to force
// a refresh.
const SW_VERSION = 'orbit-push-v1';

self.addEventListener('install', (event) => {
  // Take over immediately on install so a returning tab doesn't wait
  // for the old SW to unregister.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Orbit', body: event.data.text() };
  }
  const {
    title = 'Orbit',
    body = '',
    url = '/',
    tag,
    icon = '/icon-192.png',
    badge = '/icon-192.png',
  } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag, // dedupe: a second notification with the same tag replaces the first
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Prefer focusing an already-open tab pointing at Orbit; then
      // navigate it to the deep-link URL.
      for (const client of allClients) {
        if ('focus' in client && client.url.includes(self.location.origin)) {
          await client.focus();
          if ('navigate' in client) {
            try { await client.navigate(targetUrl); } catch { /* cross-origin nav blocked, fine */ }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
