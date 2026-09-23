'use strict';

// The ONE iOS body scroll lock (v1.311.2, Dean). `overflow:hidden` on <body> does
// NOT stop iOS touch-scrolling, so a full-viewport overlay (faux fullscreen, the
// expanded audio view, a full-screen music skin) let a swipe scroll the page
// behind it - a scrollbar showed. The lock that DOES hold on iOS pins the body:
// `position:fixed; top:-Y` (the page keeps its look), then restores Y on release.
// skin-surface.js proved it on device in v1.256 (the haptic wheel ghost); this
// module is that lock made SHARED, so every overlay uses the same one.
//
// Why shared and not copied: two lockers on one body clobber each other. The
// second copy would read scrollY while the first holds the body fixed (0), and on
// release scroll the page to the top. Here the lock is OWNER-KEYED per document:
// the first owner captures Y and pins the body, later owners just join, and only
// the LAST release unpins and restores. Keyed per document because a skin can
// live in a Document-PiP pop-out with its own body.
//
// While locked, the window cannot scroll: scrollY reads 0 and scrollTo is clamped.
// The router must therefore go through two seams, or a navigation made under a
// lock loses its scroll:
//   scrollYOf(doc, win)     the page's REAL scroll (the pinned Y while locked)
//   scrollTo(doc, win, y)   place the page at y (deferred to the release while
//                           locked - the release then lands on y, not the old Y)
//
// Loaded as a classic script on every shell that loads the player or the skin
// engine (the shell-parity test enumerates them), and require()-able for tests.
(function () {
  var states = typeof WeakMap === 'function' ? new WeakMap() : null;

  function stateOf(doc) {
    return (states && doc) ? states.get(doc) || null : null;
  }
  function currentY(win) {
    var y = win ? (typeof win.pageYOffset === 'number' ? win.pageYOffset : win.scrollY) : 0;
    return (typeof y === 'number' && !isNaN(y)) ? y : 0;
  }
  function pin(doc, y) {
    var s = doc.body.style;
    s.position = 'fixed';
    s.top = (-y) + 'px';
    s.left = '0'; s.right = '0';
  }
  function unpin(doc) {
    var s = doc.body.style;
    s.position = ''; s.top = ''; s.left = ''; s.right = '';
  }

  // Take the lock for `owner` (any string). Idempotent per owner.
  function lock(doc, win, owner) {
    if (!states || !doc || !doc.body || !owner) return false;
    var st = stateOf(doc);
    if (st) {
      if (st.owners.indexOf(owner) === -1) st.owners.push(owner);
      return true;
    }
    st = { owners: [owner], y: currentY(win), deferredY: null };
    try { pin(doc, st.y); } catch (_) { return false; }
    states.set(doc, st);
    return true;
  }

  // Drop `owner`'s hold. Only the LAST owner unpins the body, then scrolls to:
  // a navigation's deferred Y if one was placed while locked, else the captured
  // entry Y - unless `opts.restore === false` (a caller that restores on its own
  // terms, e.g. the faux-fullscreen scroll keeper). Returns true when this call
  // unpinned the body.
  function release(doc, win, owner, opts) {
    var st = stateOf(doc);
    if (!st) return false;
    var i = st.owners.indexOf(owner);
    if (i === -1) return false;
    st.owners.splice(i, 1);
    if (st.owners.length) return false;
    states.delete(doc);
    try { unpin(doc); } catch (_) { /* best-effort */ }
    var target = st.deferredY !== null ? st.deferredY
      : (opts && opts.restore === false ? null : st.y);
    if (target !== null && win && typeof win.scrollTo === 'function') {
      try { win.scrollTo(0, target); } catch (_) { /* jsdom: scrollTo unimplemented */ }
    }
    return true;
  }

  function isLocked(doc) { return !!stateOf(doc); }
  function holds(doc, owner) {
    var st = stateOf(doc);
    return !!(st && st.owners.indexOf(owner) !== -1);
  }

  // The page's real scroll: the pinned (or navigation-placed) Y while locked.
  function scrollYOf(doc, win) {
    var st = stateOf(doc);
    if (!st) return currentY(win);
    return st.deferredY !== null ? st.deferredY : st.y;
  }

  // Place the page at y. While locked this re-pins the body at y (so what shows
  // under a translucent edge is the new place) and defers the real scroll to the
  // release.
  function scrollTo(doc, win, y) {
    var target = (typeof y === 'number' && !isNaN(y)) ? y : 0;
    var st = stateOf(doc);
    if (!st) {
      if (win && typeof win.scrollTo === 'function') win.scrollTo(0, target);
      return;
    }
    st.deferredY = target;
    try { doc.body.style.top = (-target) + 'px'; } catch (_) { /* best-effort */ }
  }

  var api = { lock: lock, release: release, isLocked: isLocked, holds: holds, scrollYOf: scrollYOf, scrollTo: scrollTo };
  if (typeof window !== 'undefined') window.FileTubeBodyLock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
