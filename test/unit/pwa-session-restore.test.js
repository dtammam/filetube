'use strict';

// [UNIT] v1.47.4 item 6 -- an iOS PWA eviction costs only the relaunch tap.
//
// Dean asked to "harden and isolate the PWA features from other PWA apps",
// having seen closing a DIFFERENT PWA kill this one while it played in the
// background. Reframed at intake and agreed: iOS exposes NO cross-app isolation
// control, a backgrounded standalone PWA is a WebKit process subject to jetsam,
// and "never killed" is not deliverable. It is NOT claimed anywhere here.
//
// The agreed acceptance is instead: a kill costs nothing but the relaunch tap.
// Position already survived (server-side per user, plus the player's resume
// prompt). WHERE YOU WERE did not -- a relaunch always landed on the manifest's
// start_url, dumping you at the home grid mid-episode.
//
// The restore is deliberately narrow, because a resume convenience that hijacks
// a deliberate fresh open is worse than no resume at all. Each guard below is a
// separate test.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  isRestorableSessionUrl,
  shouldRestoreSession,
  LAST_SESSION_KEY,
  LAST_SESSION_MAX_AGE_MS,
} = require('../../public/js/common.js');

const NOW = 1800000000000;
const FRESH = { url: '/watch.html?id=abc', ts: NOW - 60_000 };

// ---- isRestorableSessionUrl ------------------------------------------------

test('isRestorableSessionUrl: accepts an in-app path, rejects home-root', () => {
  assert.equal(isRestorableSessionUrl('/watch.html?id=abc'), true);
  assert.equal(isRestorableSessionUrl('/music'), true);
  // Restoring Home to Home is a no-op that could only risk a redirect loop.
  assert.equal(isRestorableSessionUrl('/'), false);
  assert.equal(isRestorableSessionUrl('/index.html'), false);
});

test('isRestorableSessionUrl: refuses anything that could leave the origin', () => {
  // The stored value is attacker-influencable in the sense that anything with
  // devtools/localStorage access can set it; an open-redirect out of the app
  // would be a genuine defect, so only same-origin PATHS are ever accepted.
  for (const bad of [
    'https://evil.example.com/',
    '//evil.example.com/',        // protocol-relative -> off-origin
    'javascript:alert(1)',
    'watch.html',                 // relative, not rooted
    '', null, undefined, 42, {}, [],
  ]) {
    assert.equal(isRestorableSessionUrl(bad), false, `${JSON.stringify(bad)} must be refused`);
  }
});

// ---- shouldRestoreSession: the four guards ---------------------------------

test('restores a recent in-app route on a standalone cold start', () => {
  assert.equal(shouldRestoreSession(FRESH, '/', NOW, true), true);
  assert.equal(shouldRestoreSession(FRESH, '/index.html', NOW, true), true);
});

test('GUARD 1: never restores outside an installed PWA', () => {
  // A browser tab has its own history; a redirect there would be unwanted.
  assert.equal(shouldRestoreSession(FRESH, '/', NOW, false), false);
});

test('GUARD 2: never restores except when landing on the bare start_url', () => {
  // A deep link or an in-app navigation is an explicit destination and must
  // never be overridden by a stale resume pointer.
  for (const path of ['/watch.html', '/music', '/books', '/setup.html', '/subscriptions']) {
    assert.equal(shouldRestoreSession(FRESH, path, NOW, true), false, `${path} must not be hijacked`);
  }
});

test('GUARD 3: never restores a stale pointer -- a next-day open is a fresh intent', () => {
  const justInside = { url: '/watch.html?id=abc', ts: NOW - (LAST_SESSION_MAX_AGE_MS - 1000) };
  const justOutside = { url: '/watch.html?id=abc', ts: NOW - (LAST_SESSION_MAX_AGE_MS + 1000) };
  assert.equal(shouldRestoreSession(justInside, '/', NOW, true), true);
  assert.equal(shouldRestoreSession(justOutside, '/', NOW, true), false);
});

test('GUARD 3b: a future-dated pointer is not trusted (clock change / edited storage)', () => {
  assert.equal(shouldRestoreSession({ url: '/music', ts: NOW + 60_000 }, '/', NOW, true), false);
});

test('GUARD 4: never restores a home-root or off-origin pointer', () => {
  assert.equal(shouldRestoreSession({ url: '/', ts: NOW }, '/', NOW, true), false);
  assert.equal(shouldRestoreSession({ url: 'https://evil.example.com/', ts: NOW }, '/', NOW, true), false);
  assert.equal(shouldRestoreSession({ url: '//evil.example.com/', ts: NOW }, '/', NOW, true), false);
});

test('a missing/corrupt/malformed pointer never restores and never throws', () => {
  for (const bad of [
    null, undefined, 'a string', 42, [],
    {},                                     // no url/ts
    { url: '/music' },                      // no ts
    { url: '/music', ts: 'yesterday' },     // non-numeric ts
    { url: '/music', ts: NaN },
    { ts: NOW },                            // no url
  ]) {
    assert.doesNotThrow(() => shouldRestoreSession(bad, '/', NOW, true));
    assert.equal(shouldRestoreSession(bad, '/', NOW, true), false, `${JSON.stringify(bad)} must not restore`);
  }
});

// ---- wiring ----------------------------------------------------------------

test('the storage key and TTL are the real exported values', () => {
  assert.equal(LAST_SESSION_KEY, 'ft-last-session');
  // 6h: long enough to cover "I came back to what I was listening to", short
  // enough that tomorrow's open is a fresh Home.
  assert.equal(LAST_SESSION_MAX_AGE_MS, 6 * 60 * 60 * 1000);
});

test('the restore uses location.replace, never a push, and runs before view-building work', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  const fn = COMMON.slice(COMMON.indexOf('function maybeRestoreLastSession()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  // A pushed entry would leave Back bouncing between Home and the restored page.
  assert.match(body, /window\.location\.replace\(stored\.url\)/);
  assert.doesNotMatch(body, /pushState|location\.href\s*=/);
  // Everything after the boot check would be built only to be thrown away.
  const bootIdx = COMMON.indexOf('if (maybeRestoreLastSession()) return;');
  assert.ok(bootIdx > 0, 'the boot check exists');
  assert.ok(bootIdx < COMMON.indexOf('injectSubscriptionsNavLinkIfEnabled();'),
    'the restore must be attempted before the nav/router/library boot work');
});

test('recording the pointer can never break a navigation (best-effort storage)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  const fn = COMMON.slice(COMMON.indexOf('function recordLastSession()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  // Safari throws on localStorage writes in private mode and when the quota is
  // exhausted. A resume convenience must never take a navigation down with it.
  assert.match(body, /try \{/);
  assert.match(body, /catch \(_\)/);
  assert.match(body, /isRestorableSessionUrl\(url\)/, 'home-root is never recorded as a resume point');
});

// ---- v1.47.4 gate delta (adversarial WARNING 3): real origin check ---------
//
// The original guard was `startsWith('/')` + `!startsWith('//')`, with a comment
// claiming "same-origin, path-only". That is NOT an origin check. Browsers
// normalize backslashes to forward slashes for special schemes, so
// `new URL('/\evil.com', origin).origin === 'https://evil.com'` -- it passes
// both string tests and then navigates OFF-ORIGIN via location.replace.
// Only reachable via hand-edited/injected localStorage, so this is hardening
// rather than a live exploit chain, but an open redirect out of the app is not
// something to leave standing on a technicality.

const ORIGIN = 'https://filetube.local';

test('OPEN-REDIRECT LOCK: a backslash-smuggled host is refused', () => {
  // The exact bypass. `startsWith('//')` does not catch it; only resolving
  // through the real URL parser and comparing ORIGIN does.
  assert.equal(new URL('/\\evil.com', ORIGIN).origin, 'https://evil.com',
    'sanity: the browser really does resolve this off-origin');
  assert.equal(isRestorableSessionUrl('/\\evil.com', ORIGIN), false);
  assert.equal(isRestorableSessionUrl('/\\\\evil.com', ORIGIN), false);
  assert.equal(isRestorableSessionUrl('/\\/evil.com', ORIGIN), false);
});

test('OPEN-REDIRECT LOCK: every other off-origin shape stays refused', () => {
  for (const bad of ['//evil.com', 'https://evil.com/', 'http://evil.com', 'javascript:alert(1)', '\\\\evil.com']) {
    assert.equal(isRestorableSessionUrl(bad, ORIGIN), false, `${bad} must be refused`);
  }
});

test('the origin check does not break legitimate in-app routes', () => {
  for (const good of ['/watch.html?id=abc', '/music', '/books', '/read.html?b=1&p=2']) {
    assert.equal(isRestorableSessionUrl(good, ORIGIN), true, `${good} must still restore`);
  }
  // Home-root is excluded on the NORMALIZED path, so an encoding trick cannot
  // smuggle a home-root restore past a raw string comparison.
  assert.equal(isRestorableSessionUrl('/', ORIGIN), false);
  assert.equal(isRestorableSessionUrl('/index.html', ORIGIN), false);
});

test('shouldRestoreSession threads the origin through to the URL check', () => {
  const stored = { url: '/\\evil.com', ts: NOW - 1000 };
  assert.equal(shouldRestoreSession(stored, '/', NOW, true, ORIGIN), false,
    'the off-origin pointer must be refused at the decision layer too');
});
