'use strict';

// [UNIT] v1.27.2: the v1.26.4 offline-shell service worker is REMOVED --
// these are the removal locks. History: the SW was network-first and never
// called respondWith() for /api|/video|/audio|/thumbnail, which the v1.26.4
// design believed made it harmless to media playback. Documented WebKit
// behavior says otherwise: <video>/<audio> byte-range requests DISPATCH
// through a registered SW's fetch handler even when the handler passes them
// through untouched (WebKit bug 184447 -- a pure pass-through SW broke mp4
// playback), and iOS suspends SW processes when the page is backgrounded/
// locked -- so a locked page's next media chunk must first wake a suspended
// worker. That made the SW the prime suspect for an on-device "fullscreen
// background playback died" regression on the owner's iPhone (FileTube's
// primary device), and the owner chose removal over an opt-in: the offline
// fallback card was a nice-to-have; reliable background media is the
// product. If offline support ever returns it must be designed against
// this file's locks (no fetch handler touching media) and re-reviewed.
//
// (File keeps its v1264- name so the release-numbered history of what it
// guards stays greppable next to the other v1264-* locks.)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const COMMON_JS = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
const ESLINT_CONFIG = fs.readFileSync(path.join(ROOT, 'eslint.config.js'), 'utf8');

test('removal lock: public/sw.js and public/offline.html no longer exist', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'sw.js')), 'public/sw.js must stay deleted');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'offline.html')), 'public/offline.html must stay deleted');
});

test('removal lock: no client script registers a service worker anywhere', () => {
  const clientDirs = [
    path.join(ROOT, 'public', 'js'),
    path.join(ROOT, 'lib', 'ytdlp', 'client'),
  ];
  for (const dir of clientDirs) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      assert.ok(
        !/serviceWorker\.register\(/.test(src),
        `${file} must not register a service worker (removed v1.27.2 -- see unregisterStaleServiceWorkers)`
      );
    }
  }
});

test('cleanup lock: unregisterStaleServiceWorkers() exists, feature-detects, unregisters every registration, and swallows all failures', () => {
  const match = /function unregisterStaleServiceWorkers\(\) \{([\s\S]*?)\n\}/.exec(COMMON_JS);
  assert.ok(match, 'expected unregisterStaleServiceWorkers() in common.js -- existing HTTPS installs carry a live SW that must be actively shed');
  const body = match[1];
  assert.match(body, /if \(typeof navigator === 'undefined' \|\| !\('serviceWorker' in navigator\)\) return;/);
  assert.match(body, /getRegistrations\(\)/);
  assert.match(body, /r\.unregister\(\)\.catch\(\(\) => \{\}\)/, 'each individual unregister failure must be swallowed');
  assert.match(body, /\.catch\(\(\) => \{ \/\* best-effort cleanup only \*\/ \}\)/, 'the getRegistrations failure must be swallowed');
  assert.match(body, /try \{/, 'the synchronous call path must be try/catch-wrapped so cleanup can never abort page boot');
});

test('cleanup lock: the boot handler schedules the cleanup on load (or immediately when already complete) -- same scheduling the old registration used', () => {
  assert.match(COMMON_JS, /window\.addEventListener\('load', unregisterStaleServiceWorkers, \{ once: true \}\);/);
  assert.match(COMMON_JS, /if \(document\.readyState === 'complete'\) \{\s*\n\s*unregisterStaleServiceWorkers\(\);/);
});

test('cleanup lock: the WebKit rationale is documented at the cleanup site (bug 184447 + iOS SW suspension)', () => {
  assert.match(COMMON_JS, /184447/, 'the WebKit bug reference must survive -- it is the documented reason a "pass-through" SW is NOT harmless to media');
  assert.match(COMMON_JS, /suspends SW processes/i);
});

test('removal lock: the eslint service-worker config block is gone', () => {
  assert.ok(!/globals\.serviceworker/.test(ESLINT_CONFIG), 'the dedicated sw.js eslint block must stay removed');
});
