'use strict';

// [UNIT] v1.27.2 removal locks, AMENDED v1.66 (web push).
//
// History: the v1.26.4 offline-shell service worker was REMOVED in v1.27.2.
// Its fetch handler was network-first and never called respondWith() for
// /api|/video|/audio|/thumbnail, which the v1.26.4 design believed made it
// harmless to media playback. Documented WebKit behavior says otherwise:
// <video>/<audio> byte-range requests DISPATCH through a registered SW's
// fetch handler even when the handler passes them through untouched (WebKit
// bug 184447 -- a pure pass-through SW broke mp4 playback), and iOS
// suspends SW processes when the page is backgrounded/locked -- so a locked
// page's next media chunk must first wake a suspended worker. That made the
// SW the prime suspect for background playback dying on the owner's iPhone,
// and the owner chose removal: the offline fallback card was a nice-to-have;
// reliable background media is the product.
//
// v1.66 AMENDMENT (Dean's approved ruling, exec plan v1.66): a PUSH-ONLY
// worker returns -- at public/PUSH-SW.js, deliberately NOT public/sw.js.
// The removed v1.26.4 worker registered at exactly `/sw.js` (d96a7f8), so a
// push worker on that path would make the boot shedder unable to tell the
// two apart; the first draft of this wave did exactly that and the QA seat
// MEASURED the old offline worker surviving the shed. Distinct paths make
// the exemption a discriminator. Push events do not ride the fetch path, so
// the v1.27.2 failure mechanism is excluded BY CONSTRUCTION -- and stays
// excluded only while the locks below hold:
//   - public/sw.js must STILL not exist (the original lock, unchanged),
//   - push-sw.js must NEVER add a 'fetch' listener or touch cache storage,
//   - exactly ONE serviceWorker.register() call site exists (common.js's
//     registerPushWorker -- setup.js and the boot reconcile route through
//     it), and it registers /push-sw.js,
//   - the shedder unregisters every registration EXCEPT /push-sw.js --
//     including /sw.js, forever.
// public/offline.html stays deleted forever.
//
// (File keeps its v1264- name so the release-numbered history of what it
// guards stays greppable next to the other v1264-* locks.)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const COMMON_JS = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
const SW_JS = fs.readFileSync(path.join(ROOT, 'public', 'push-sw.js'), 'utf8');
const ESLINT_CONFIG = fs.readFileSync(path.join(ROOT, 'eslint.config.js'), 'utf8');

test('amended lock: public/push-sw.js exists; public/sw.js and public/offline.html stay deleted', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'push-sw.js')), 'public/push-sw.js is the v1.66 push worker');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'sw.js')),
    'public/sw.js must STAY deleted -- it is the v1.26.4 offline worker\'s path, and the shedder must be free to kill anything found there');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'offline.html')), 'public/offline.html must stay deleted');
});

test('push-only lock: push-sw.js has NO fetch listener and NO cache-storage use -- the v1.27.2 failure mechanism stays excluded', () => {
  assert.ok(
    !/addEventListener\(\s*['"`]fetch['"`]/.test(SW_JS),
    'push-sw.js must never listen for fetch events (WebKit 184447: even pass-through fetch handlers break media playback)'
  );
  assert.ok(!/\bonfetch\b/.test(SW_JS), 'no onfetch assignment either');
  assert.ok(
    !/\bcaches\s*[.[]/.test(SW_JS) && !/\bCacheStorage\b/.test(SW_JS) && !/caches\b\s*=>/.test(SW_JS),
    'push-sw.js must never touch the cache storage API (no offline shell by another name)'
  );
  assert.match(SW_JS, /184447/, 'the WebKit rationale must survive at the contract site');
});

test('push-only lock: push-sw.js actually handles push + notificationclick (the reason it exists)', () => {
  assert.match(SW_JS, /addEventListener\(\s*'push'/);
  assert.match(SW_JS, /addEventListener\(\s*'notificationclick'/);
  assert.match(SW_JS, /addEventListener\(\s*'pushsubscriptionchange'/);
  // NOTE: ruling P4's actual BEHAVIOR is bound in two places, neither of
  // them this grep: the decidePushDisplay TABLE below (the pure decision)
  // and test/integration/push-sw-handler.test.js (the handler's EXECUTION -
  // it fires the real push listener against a stubbed `self`). This source
  // lock only proves the handler ROUTES through the pure function; the
  // adversarial gate showed twice that a grep alone lets an inverted P4
  // ship (locked phone silent, visible window double-notified), which is
  // why the execution test exists.
  assert.match(SW_JS, /decidePushDisplay\(wins\.map\(\(c\) => c\.visibilityState\)\)/,
    'the push handler must route its decision through the tested pure function, not an inline condition');
});

// Ruling P4, bound by BEHAVIOR against the real exported decision.
const { decidePushDisplay } = require('../../public/push-sw.js');

test('P4: any visible window suppresses the OS banner and nudges instead; no visible window notifies', () => {
  // [visibilityStates, expected] -- the whole truth table, including the
  // mixed case (a visible window alongside hidden ones still suppresses).
  const table = [
    [[], { notify: true, nudge: false }],                                  // no windows: locked phone MUST get the banner
    [['hidden'], { notify: true, nudge: false }],
    [['hidden', 'hidden'], { notify: true, nudge: false }],
    [['visible'], { notify: false, nudge: true }],
    [['hidden', 'visible'], { notify: false, nudge: true }],
    [['visible', 'visible'], { notify: false, nudge: true }],
    [['prerender', 'hidden'], { notify: true, nudge: false }],
  ];
  for (const [states, expected] of table) {
    assert.deepEqual(decidePushDisplay(states), expected, `states=${JSON.stringify(states)}`);
  }
  // Degenerate inputs must fail toward NOTIFYING - a missed banner on a
  // locked phone is the failure this whole wave exists to prevent.
  assert.deepEqual(decidePushDisplay(undefined), { notify: true, nudge: false });
  assert.deepEqual(decidePushDisplay(null), { notify: true, nudge: false });
});

test('single-register lock: exactly ONE serviceWorker.register call site, in common.js', () => {
  const clientDirs = [
    path.join(ROOT, 'public', 'js'),
    path.join(ROOT, 'lib', 'ytdlp', 'client'),
  ];
  const sites = [];
  for (const dir of clientDirs) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      const count = (src.match(/serviceWorker\.register\(/g) || []).length;
      if (count > 0) sites.push([file, count]);
    }
  }
  assert.deepEqual(sites, [['common.js', 1]],
    'the ONE register site is common.js registerPushWorker -- every other flow must route through it');
  assert.match(COMMON_JS, /function registerPushWorker\(\) \{\s*\n\s*return navigator\.serviceWorker\.register\('\/push-sw\.js'\);/,
    'and it registers exactly /push-sw.js at root scope -- never /sw.js');
  assert.ok(!/serviceWorker\.register\(/.test(SW_JS), 'push-sw.js never registers workers');
});

test('cleanup lock: unregisterStaleServiceWorkers() survives -- feature-detects, exempts ONLY /push-sw.js, unregisters everything else (INCLUDING /sw.js), swallows all failures', () => {
  const match = /function unregisterStaleServiceWorkers\(\) \{([\s\S]*?)\n\}/.exec(COMMON_JS);
  assert.ok(match, 'expected unregisterStaleServiceWorkers() in common.js -- old installs may still carry the v1.26.4 offline SW');
  const body = match[1];
  // Strip comments before the never-match assertions below: this file's own
  // explanatory comment NAMES the rejected `endsWith` form, and a lock that
  // a comment can satisfy (or violate) proves nothing about the code. The
  // v1.50.3 lesson, re-learned here in-wave. Applied SYMMETRICALLY: the
  // must-match assertions run against stripped code too, because a future
  // comment quoting the exemption line would satisfy them with the code
  // deleted (QA round-3 suggestion 1).
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(code, /if \(typeof navigator === 'undefined' \|\| !\('serviceWorker' in navigator\)\) return;/);
  assert.match(code, /getRegistrations\(\)/);
  assert.match(code, /pathname === '\/push-sw\.js'\) return;/,
    'the v1.66 exemption is the EXACT pathname /push-sw.js -- an exemption matching /sw.js would spare the v1.26.4 offline worker itself (measured, QA W2), and a suffix match would spare any nested lookalike');
  assert.ok(!/endsWith\('\/sw\.js'\)/.test(code), 'and it must never be widened back to /sw.js');
  assert.ok(!/endsWith\('\/push-sw\.js'\)/.test(code), 'nor loosened back to a suffix match');
  assert.match(code, /r\.unregister\(\)\.catch\(\(\) => \{\}\)/, 'each individual unregister failure must be swallowed');
  // This one MUST read the raw body: the swallow it locks is spelled with an
  // inline comment inside the catch block, which stripping would remove.
  assert.match(body, /\.catch\(\(\) => \{ \/\* best-effort cleanup only \*\/ \}\)/, 'the getRegistrations failure must be swallowed');
  assert.match(code, /try \{/, 'the synchronous call path must be try/catch-wrapped so cleanup can never abort page boot');
});

test('cleanup lock: the boot handler schedules the cleanup on load (or immediately when already complete)', () => {
  assert.match(COMMON_JS, /window\.addEventListener\('load', unregisterStaleServiceWorkers, \{ once: true \}\);/);
  assert.match(COMMON_JS, /if \(document\.readyState === 'complete'\) \{\s*\n\s*unregisterStaleServiceWorkers\(\);/);
});

test('cleanup lock: the WebKit rationale is documented at the cleanup site (bug 184447 + iOS SW suspension)', () => {
  assert.match(COMMON_JS, /184447/, 'the WebKit bug reference must survive -- it is the documented reason a "pass-through" SW is NOT harmless to media');
  assert.match(COMMON_JS, /suspends SW processes/i);
});

test('eslint lock: serviceworker globals exist and are scoped to EXACTLY public/push-sw.js', () => {
  assert.match(ESLINT_CONFIG, /globals\.serviceworker/, 'push-sw.js needs its lint scope (v1.66)');
  const block = /\{\s*\n\s*files: \['public\/push-sw\.js'\],[\s\S]*?globals\.serviceworker[\s\S]*?\}/.exec(ESLINT_CONFIG);
  assert.ok(block, 'the serviceworker globals block is scoped to public/push-sw.js only');
});
