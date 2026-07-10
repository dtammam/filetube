'use strict';

// FileTube minimal offline-shell service worker (v1.26.3, Item 4).
//
// STRATEGY: NETWORK-FIRST, everywhere it applies -- the explicit design goal
// is that this SW must NEVER make the app staler than having no SW at all.
// A stale-shell wedge (an old cached index.html/JS surviving past a deploy)
// is the #1 failure mode for a naive service worker; guarding against it
// drives every decision below:
//   - `self.skipWaiting()` in `install` + `self.clients.claim()` in
//     `activate`: a newly installed SW takes over EVERY open tab/client
//     immediately, rather than waiting for all tabs to close first (the
//     browser default) -- a deploy takes over right away instead of a stale
//     prior SW instance quietly outliving it in an already-open tab.
//   - Every cacheable response is fetched from the NETWORK FIRST; the cache
//     is only a same-tick FALLBACK for when the network request itself
//     fails (offline / DNS / connection reset) -- a client is NEVER served
//     a cached response while the network is reachable, so a normal
//     (online) reload always sees the latest deploy exactly as if this SW
//     did not exist.
//   - `CACHE_NAME` is versioned and must be bumped on every release that
//     changes a cacheable shell asset; `activate` deletes every OTHER
//     `filetube-shell-*` cache, so a stale prior version's entries can
//     never leak into a new deploy's fallback responses.
//
// SCOPE: registered at '/' with the default scope (see
// public/js/common.js's registerServiceWorker) -- a script served from the
// site root already defaults to scope '/', so no `Service-Worker-Allowed`
// response header is needed (only required when registering with a scope
// WIDER than the script's own directory, which does not apply here).
// Because the scope is '/', this file intercepts every same-origin GET
// fetch/navigation, and must therefore explicitly NEVER intercept the app's
// live data surfaces below.
//
// iOS NOTE: iOS/iPadOS Safari's service-worker support is solid for this
// narrow "offline shell fallback" use case, but has historically been
// flakier under background/backgrounded-tab execution than desktop
// browsers -- the fetch handler below is kept deliberately tiny and
// synchronous-fast (no heavy work, no long-lived promise chains beyond the
// fetch/cache calls themselves) so it never becomes the thing that makes a
// foregrounded reload feel slow.

const CACHE_NAME = 'filetube-shell-v1'; // bump this string on every release that changes a cached shell asset
const OFFLINE_URL = '/offline.html';

// Path prefixes that carry FileTube's live, potentially large or
// per-request data -- NEVER intercepted. Not calling `event.respondWith()`
// for a matching request lets the browser handle it exactly as if this SW
// were not installed: a plain default network fetch, full HTTP Range-request
// support intact for `/video/:id` and `/audio/:id` streaming, zero caching-
// related staleness or interference possible for `/api/*` responses.
const NEVER_INTERCEPT_PREFIXES = ['/api/', '/video/', '/audio/', '/thumbnail/'];

function isNeverIntercepted(pathname) {
  return NEVER_INTERCEPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Static shell asset prefixes/paths this SW caches network-first (CSS/JS/
// fonts/icons/the manifest). Everything else that is neither a navigation
// nor one of these (e.g. a bare `/favicon.ico`) is left completely alone --
// only navigations and this explicit allowlist are ever cached.
const CACHEABLE_STATIC_PREFIXES = ['/css/', '/js/', '/fonts/', '/icons/'];
const CACHEABLE_STATIC_PATHS = ['/manifest.webmanifest'];

function isCacheableStatic(pathname) {
  return CACHEABLE_STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    CACHEABLE_STATIC_PATHS.includes(pathname);
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch(() => {
        // A first-install failure to precache the offline page must never
        // block installation -- the SW still activates; the offline
        // fallback simply has nothing to serve until a later successful
        // navigation populates its own cache entry (see networkFirst below).
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // never intercept non-GET (POST/DELETE/etc.) -- always default network, untouched

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return; // malformed URL -- let the browser handle it
  }
  if (url.origin !== self.location.origin) return; // cross-origin -- never intercept

  if (isNeverIntercepted(url.pathname)) return; // live data surfaces -- always default network, untouched

  const isNavigation = request.mode === 'navigate';
  if (!isNavigation && !isCacheableStatic(url.pathname)) return; // anything else -- default network behavior, untouched

  event.respondWith(networkFirst(request, isNavigation));
});

// NETWORK-FIRST: try the network; on a genuinely successful, same-origin
// response, clone+cache it (keyed by this exact request) and return it
// as-is. On failure (offline/DNS/connection reset), fall back to whatever
// THIS exact request already has cached -- and, for a navigation with no
// cache match at all, the precached offline shell.
function networkFirst(request, isNavigation) {
  return fetch(request)
    .then((response) => {
      // Only cache a genuinely successful, `basic` (same-origin, non-opaque)
      // response -- never an error/opaque response, which could otherwise
      // permanently poison the offline fallback with a cached 404/500.
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    })
    .catch(() => caches.open(CACHE_NAME)
      .then((cache) => cache.match(request))
      .then((cached) => {
        if (cached) return cached;
        if (isNavigation) return caches.match(OFFLINE_URL);
        // Not a navigation and nothing cached for it: return a network-error
        // response, exactly what the browser would have surfaced to this
        // resource load anyway with no SW installed at all.
        return Response.error();
      }));
}
