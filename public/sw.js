'use strict';

// FileTube minimal offline-shell service worker (v1.26.4, wave-2 review fixes).
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
//   - `CACHE_NAME` is versioned; `activate` deletes every OTHER
//     `filetube-shell-*` cache (and ONLY caches with that prefix -- see the
//     activate handler below), so a stale prior version's entries can never
//     leak into a new deploy's fallback responses. Because the strategy is
//     network-first, a version bump is needed only for STRUCTURAL changes --
//     a changed set/shape of cache keys, a changed caching policy (like this
//     release's), or to force an orphan-cache cleanup sweep -- NOT for
//     routine same-URL content updates: a plain deploy that doesn't touch
//     sw.js already serves new content network-first on the very next
//     online request, so bumping the name for content churn alone would be
//     cargo-culting the version string for zero user-visible benefit.
//
// CACHING SCOPE (v1.26.4 wave-2 fix): navigations (`/`, `/watch.html?...`,
// etc.) are network-first but are NEVER written to the cache. Previously,
// every distinct navigation URL was cached forever, keyed by its full
// querystring -- e.g. a separate cache entry per `/watch.html?v=<id>` for
// every video ever opened -- with no eviction (measured: ~11MB of cache
// growth after 500 watch-page navigations in one session) and no real
// offline value: a cached watch page's own media routes (`/video/:id`,
// `/audio/:id`, etc., see NEVER_INTERCEPT_PREFIXES below) are never
// intercepted by this SW, so a "cached" watch page could never actually
// play anything offline anyway. Now: on a navigation whose network fetch
// fails, the precached OFFLINE_URL shell is served directly -- that page IS
// the entire offline-navigation story for this SW, by design.
// Static shell assets (CSS/JS/fonts/icons/the manifest -- see
// CACHEABLE_STATIC_PREFIXES/PATHS below) are NOT subject to this: their key
// set is small and bounded (unlike per-video navigation URLs), so they keep
// the original network-first + cache.put fallback behavior, which is
// genuinely useful for an offline reload of an already-visited shell.
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
// foregrounded reload feel slow. A static-asset cache write is threaded
// through `event.waitUntil()` (v1.26.4 wave-2 fix) specifically because a
// browser -- iOS in particular -- may terminate a SW shortly after
// `respondWith()`'s promise settles; an unawaited `cache.put()` kicked off
// from inside that same `.then()` is not guaranteed to run to completion
// unless the SW is explicitly kept alive via `waitUntil()` for it too.

const CACHE_NAME = 'filetube-shell-v2'; // bump on structural cache-policy/key changes (see header comment) -- NOT for routine content updates
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
// only navigations and this explicit allowlist are ever handled by
// networkFirst below, and (per the CACHING SCOPE note above) only THIS
// allowlist -- never navigations -- is ever actually written to the cache.
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
        // block installation -- the SW still activates; activate below
        // retries this same precache (v1.26.4 wave-2 fix) so a transient
        // failure here doesn't permanently leave the offline fallback empty.
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Only delete OTHER filetube-shell-* caches -- never a cache from some
      // other, unrelated origin/purpose (e.g. a future page-context cache
      // this SW doesn't own) that happens not to equal CACHE_NAME
      // (v1.26.4 wave-2 fix; the prior `name !== CACHE_NAME` filter deleted
      // literally every cache that wasn't this exact one).
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('filetube-shell-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      // Idempotent retry of the offline-page precache (v1.26.4 wave-2 fix):
      // install's own cache.add(OFFLINE_URL) swallows failure so a bad
      // network blip at first install can never wedge activation, but that
      // also meant a failed precache was never retried until the SW's own
      // bytes next changed (a new deploy). Retrying here, on every activate,
      // closes that gap -- match-then-add so an already-present entry is
      // left untouched, and the retry's own failure is swallowed exactly
      // like install's, for the identical reason.
      .then(() => caches.open(CACHE_NAME))
      .then((cache) => cache.match(OFFLINE_URL).then((cached) => {
        if (cached) return undefined;
        return cache.add(OFFLINE_URL).catch(() => {
          // Still unreachable -- leave it for the NEXT activate to retry.
        });
      }))
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

  event.respondWith(networkFirst(event, isNavigation));
});

// NETWORK-FIRST: try the network first, always. For a genuinely successful,
// same-origin STATIC-ASSET response, clone+cache it (keyed by this exact
// request, write threaded through event.waitUntil -- see the iOS NOTE
// above) and return the live response as-is; a NAVIGATION response is
// returned as-is too, but is never written to the cache at all (see the
// CACHING SCOPE header comment). On failure (offline/DNS/connection reset):
// a navigation falls back straight to the precached offline shell; a static
// asset falls back to whatever it already has cached, or a network-error
// response if it has never been cached.
function networkFirst(event, isNavigation) {
  const request = event.request;
  return fetch(request)
    .then((response) => {
      // Only cache a genuinely successful (200, not e.g. a 206 partial),
      // `basic` (same-origin, non-opaque) response -- never an error/opaque/
      // partial response, which could otherwise permanently poison a static
      // asset's own cache entry. Navigations are excluded entirely (v1.26.4
      // wave-2 fix) -- see the CACHING SCOPE header comment.
      if (!isNavigation && response && response.status === 200 && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {})
        );
      }
      return response;
    })
    .catch(() => {
      if (isNavigation) return caches.match(OFFLINE_URL);
      return caches.open(CACHE_NAME)
        .then((cache) => cache.match(request))
        .then((cached) => {
          if (cached) return cached;
          // Not a navigation and nothing cached for it: return a network-
          // error response, exactly what the browser would have surfaced to
          // this resource load anyway with no SW installed at all.
          return Response.error();
        });
    });
}
