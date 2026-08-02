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
// v1.66 AMENDMENT (Dean's approved ruling, exec plan v1.66): public/sw.js
// returns as a PUSH-ONLY worker. Push events do not ride the fetch path, so
// the failure mechanism above is excluded BY CONSTRUCTION -- and stays
// excluded only while the locks below hold:
//   - sw.js must NEVER add a 'fetch' event listener,
//   - sw.js must NEVER touch the CacheStorage API,
//   - exactly ONE serviceWorker.register() call site exists (common.js's
//     registerPushWorker -- setup.js and the boot reconcile route through
//     it),
//   - the shedder still unregisters every OTHER registration; /sw.js is
//     its one exemption.
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
const SW_JS = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
const ESLINT_CONFIG = fs.readFileSync(path.join(ROOT, 'eslint.config.js'), 'utf8');

test('amended lock: public/sw.js exists (push-only, v1.66); public/offline.html stays deleted', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'sw.js')), 'public/sw.js is the v1.66 push worker');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'offline.html')), 'public/offline.html must stay deleted');
});

test('push-only lock: sw.js has NO fetch listener and NO CacheStorage use -- the v1.27.2 failure mechanism stays excluded', () => {
  assert.ok(
    !/addEventListener\(\s*['"`]fetch['"`]/.test(SW_JS),
    'sw.js must never listen for fetch events (WebKit 184447: even pass-through fetch handlers break media playback)'
  );
  assert.ok(!/\bonfetch\b/.test(SW_JS), 'no onfetch assignment either');
  assert.ok(
    !/\bcaches\s*[.[]/.test(SW_JS) && !/\bCacheStorage\b/.test(SW_JS) && !/caches\b\s*=>/.test(SW_JS),
    'sw.js must never touch the CacheStorage API (no offline shell by another name)'
  );
  assert.match(SW_JS, /184447/, 'the WebKit rationale must survive at the contract site');
});

test('push-only lock: sw.js actually handles push + notificationclick (the reason it exists)', () => {
  assert.match(SW_JS, /addEventListener\(\s*'push'/);
  assert.match(SW_JS, /addEventListener\(\s*'notificationclick'/);
  assert.match(SW_JS, /addEventListener\(\s*'pushsubscriptionchange'/);
  assert.match(SW_JS, /visibilityState === 'visible'/, 'the P4 visible-client suppression lives in the push handler');
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
  assert.match(COMMON_JS, /function registerPushWorker\(\) \{\s*\n\s*return navigator\.serviceWorker\.register\('\/sw\.js'\);/,
    'and it registers exactly /sw.js at root scope');
  assert.ok(!/serviceWorker\.register\(/.test(SW_JS), 'sw.js never registers workers');
});

test('cleanup lock: unregisterStaleServiceWorkers() survives -- feature-detects, exempts ONLY /sw.js, unregisters everything else, swallows all failures', () => {
  const match = /function unregisterStaleServiceWorkers\(\) \{([\s\S]*?)\n\}/.exec(COMMON_JS);
  assert.ok(match, 'expected unregisterStaleServiceWorkers() in common.js -- old installs may still carry the v1.26.4 offline SW');
  const body = match[1];
  assert.match(body, /if \(typeof navigator === 'undefined' \|\| !\('serviceWorker' in navigator\)\) return;/);
  assert.match(body, /getRegistrations\(\)/);
  assert.match(body, /scriptURL\.endsWith\('\/sw\.js'\)\) return;/, 'the v1.66 exemption is EXACTLY the /sw.js script URL -- nothing broader');
  assert.match(body, /r\.unregister\(\)\.catch\(\(\) => \{\}\)/, 'each individual unregister failure must be swallowed');
  assert.match(body, /\.catch\(\(\) => \{ \/\* best-effort cleanup only \*\/ \}\)/, 'the getRegistrations failure must be swallowed');
  assert.match(body, /try \{/, 'the synchronous call path must be try/catch-wrapped so cleanup can never abort page boot');
});

test('cleanup lock: the boot handler schedules the cleanup on load (or immediately when already complete)', () => {
  assert.match(COMMON_JS, /window\.addEventListener\('load', unregisterStaleServiceWorkers, \{ once: true \}\);/);
  assert.match(COMMON_JS, /if \(document\.readyState === 'complete'\) \{\s*\n\s*unregisterStaleServiceWorkers\(\);/);
});

test('cleanup lock: the WebKit rationale is documented at the cleanup site (bug 184447 + iOS SW suspension)', () => {
  assert.match(COMMON_JS, /184447/, 'the WebKit bug reference must survive -- it is the documented reason a "pass-through" SW is NOT harmless to media');
  assert.match(COMMON_JS, /suspends SW processes/i);
});

test('eslint lock: serviceworker globals exist and are scoped to EXACTLY public/sw.js', () => {
  assert.match(ESLINT_CONFIG, /globals\.serviceworker/, 'sw.js needs its lint scope back (v1.66)');
  const block = /\{\s*\n\s*files: \['public\/sw\.js'\],[\s\S]*?globals\.serviceworker[\s\S]*?\}/.exec(ESLINT_CONFIG);
  assert.ok(block, 'the serviceworker globals block is scoped to public/sw.js only');
});
