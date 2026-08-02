'use strict';

// FileTube service worker (v1.66) - PUSH ONLY, by ruling and by lock.
//
// THE CONTRACT (enforced by test/unit/v1264-service-worker.test.js): this
// file must NEVER add a 'fetch' event listener and must NEVER touch the
// cache storage API. The v1.26.4 offline-shell worker was removed in v1.27.2
// because a registered fetch handler receives EVERY same-origin request -
// including <video>/<audio> byte-range requests - even when it never calls
// respondWith (WebKit bug 184447), and iOS suspends SW processes on
// backgrounded pages, which broke background media playback. Push events do
// not ride the fetch path, so this worker is safe by construction - and
// only stays that way while the contract above holds.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function payloadFrom(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch {
    return null;
  }
}

function b64urlToUint8(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = self.atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

self.addEventListener('push', (event) => {
  const payload = payloadFrom(event) || { title: 'FileTube', body: '', url: '/' };
  event.waitUntil((async () => {
    // Ruling P4: a device whose app window is visible gets NO OS banner -
    // the in-page bell is the surface there. The postMessage nudges the
    // bell's poller so the badge updates instantly instead of on the next
    // 60s tick.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.filter((c) => c.visibilityState === 'visible');
    for (const c of visible) {
      try { c.postMessage({ type: 'ft-push' }); } catch { /* client gone */ }
    }
    if (visible.length > 0) return;
    await self.registration.showNotification(payload.title || 'FileTube', {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      data: { url: payload.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      try {
        await c.focus();
        await c.navigate(url);
        return;
      } catch { /* fall through to the next window / openWindow */ }
    }
    await self.clients.openWindow(url);
  })());
});

// The push service rotated this device's subscription: re-subscribe against
// the server's current key and re-register the new endpoint. Best-effort -
// the session cookie rides the same-origin fetches; a logged-out device
// simply stops receiving until it re-enables in Settings.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const keyRes = await fetch('/api/push/key');
      if (!keyRes.ok) return;
      const { key } = await keyRes.json();
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToUint8(key),
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
    } catch { /* best effort */ }
  })());
});
