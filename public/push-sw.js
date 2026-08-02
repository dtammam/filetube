'use strict';

// FileTube service worker (v1.66) - PUSH ONLY, by ruling and by lock.
//
// WHY THIS FILE IS NOT /sw.js: the removed v1.26.4 offline worker registered
// at exactly `/sw.js` (see d96a7f8). A push worker sharing that path would
// make the boot shedder unable to tell the two apart - the v1.66 gate's QA
// seat MEASURED the first draft doing precisely that, sparing the very
// offline worker the shedder exists to kill. Distinct path, unambiguous
// identity: `/sw.js` is still shed on sight, forever.
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

function payloadFrom(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch {
    return null;
  }
}

// Worker-only (the pushsubscriptionchange re-subscribe). node:test requires
// this file for decidePushDisplay but never CALLS this, so `self.atob` being
// absent under Node is fine - a Buffer fallback would just be dead code the
// linter correctly rejects for a service-worker scope.
function b64urlToUint8(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = self.atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Ruling P4 as a PURE decision so it can be table-tested rather than
// grepped for (the v1.66 QA seat proved the previous presence-only lock
// survived an INVERTED P4 - a locked phone would have gone silent while
// visible windows double-notified, full suite green). Exported below for
// node:test; the handler is the only caller.
//   visibilityStates: what clients.matchAll reported for each window.
// A device whose app window is visible gets NO OS banner - the in-page
// bell is the surface there; it gets a postMessage instead so the badge
// updates now rather than on the next 60s poll.
function decidePushDisplay(visibilityStates) {
  const list = Array.isArray(visibilityStates) ? visibilityStates : [];
  const anyVisible = list.some((s) => s === 'visible');
  return { notify: !anyVisible, nudge: anyVisible };
}

// Everything below registers against the service-worker globals, guarded
// exactly like common.js guards `document`: requiring this file in
// node:test (for the decidePushDisplay table) must not touch `self`. In a
// real worker `self` is always defined, so every listener registers.
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const payload = payloadFrom(event) || { title: 'FileTube', body: '', url: '/' };
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const decision = decidePushDisplay(wins.map((c) => c.visibilityState));
    if (decision.nudge) {
      for (const c of wins) {
        if (c.visibilityState !== 'visible') continue;
        try { c.postMessage({ type: 'ft-push' }); } catch { /* client gone */ }
      }
    }
    if (!decision.notify) return;
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
}

// node:test reaches decidePushDisplay through this (the common.js idiom);
// a real service-worker runtime has no `module`, so this is inert there.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decidePushDisplay };
}
