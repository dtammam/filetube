'use strict';

// [INTEGRATION] v1.67.1 - the RUNTIME binding for the push-enable feedback
// fix (adversarial slim-gate suggestion: shell-smoke IS a jsdom harness, so
// the reveal path was bindable by execution, not just a presence lock).
//
// The bug: .field-error is display:none by default, and the v1.66 enable
// flow's setError set textContent ONLY, so a denied/dismissed permission (or
// any failure) wrote its message to a HIDDEN element - "nothing happens" on
// device. This test loads the REAL setup.html + common.js + setup.js in
// jsdom, resolves /api/push/key so initPushControls un-hides the group and
// wires the enable button, forces Notification.requestPermission -> 'denied',
// CLICKS the button, and asserts #push-error is actually VISIBLE with the
// blocked-copy message.
//
// Everything is served from disk (no network); only /api/push/key and
// /api/auth/me resolve - every other fetch never settles, mirroring
// shell-smoke, so init()'s other lanes cannot cascade.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

// Load the real setup shell. `permission` is what Notification.requestPermission
// resolves to; `capturePermissionCalls` records the calls. Resolves once the
// push group is wired (or a short deadline).
function loadSetupWithPush({ permission }) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'setup.html'), 'utf8');
  return new Promise((resolve, reject) => {
    let dom;
    try {
      dom = new JSDOM(html, {
        url: 'https://filetube.example/setup.html', // https so it is a secure context
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        resources: {
          interceptors: [
            requestInterceptor((request) => {
              const p = new URL(request.url).pathname;
              const filePath = path.join(PUBLIC_DIR, p);
              if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                return new Response(fs.readFileSync(filePath, 'utf8'), {
                  status: 200, headers: { 'Content-Type': contentTypeFor(filePath) },
                });
              }
              return new Response('', { status: 404 });
            }),
          ],
        },
        beforeParse(window) {
          window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
          // fetch router: only the two the push controls need resolve; the
          // rest hang (shell-smoke's posture) so no other init lane cascades.
          window.fetch = (input) => {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (url.indexOf('/api/push/key') !== -1) {
              // A real 65-byte uncompressed P-256 point, base64url.
              return Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'BEXGYxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4' }) });
            }
            if (url.indexOf('/api/auth/me') !== -1) {
              return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { username: 'dean' }, settings: {} }) });
            }
            return new Promise(() => {}); // never settles
          };
          // A ServiceWorkerContainer stub good enough for the DENIED path
          // (which returns before touching it) and harmless otherwise.
          window.navigator.serviceWorker = {
            register: () => Promise.resolve({}),
            ready: Promise.resolve({ pushManager: { subscribe: () => Promise.reject(new Error('not reached on denied')) } }),
            getRegistration: () => Promise.resolve(null),
            addEventListener() {},
          };
          window.Notification = { permission: 'default', requestPermission: () => Promise.resolve(permission) };
          // pushSupportProblem() requires all three to exist, or it hides the
          // buttons as "unsupported" - so the secure-context PWA is simulated.
          window.PushManager = function PushManager() {};
        },
      });
    } catch (err) { reject(err); return; }

    dom.window.addEventListener('load', () => {
      // Give initPushControls' /api/push/key .then() a few turns to un-hide
      // the group and attach the enable listener.
      const t0 = Date.now();
      const poll = () => {
        const btn = dom.window.document.getElementById('push-device-enable-btn');
        const group = dom.window.document.getElementById('push-controls');
        if (group && !group.hidden && btn) { resolve(dom); return; }
        if (Date.now() - t0 > 3000) { resolve(dom); return; }
        dom.window.setTimeout(poll, 15);
      };
      poll();
    });
    setTimeout(() => resolve(dom), 5000);
  });
}

async function settle(dom, ms = 250) {
  await new Promise((r) => dom.window.setTimeout(r, ms));
}

test('denied permission: the enable click makes #push-error VISIBLE with the blocked-copy message (the display:none bug)', async () => {
  const dom = await loadSetupWithPush({ permission: 'denied' });
  const doc = dom.window.document;
  const group = doc.getElementById('push-controls');
  const btn = doc.getElementById('push-device-enable-btn');
  const err = doc.getElementById('push-error');
  assert.ok(group && !group.hidden, 'precondition: /api/push/key resolved so the push group is shown');
  assert.ok(btn && !btn.hidden, 'precondition: the enable button is present and shown');

  // Before the click the error box is hidden and empty.
  assert.equal(dom.window.getComputedStyle(err).display, 'none', 'error box starts hidden');

  btn.dispatchEvent(new dom.window.Event('click'));
  await settle(dom);

  // THE BINDING: the message is both PRESENT and VISIBLE. The pre-fix code
  // set textContent but left display:none - this would have caught it.
  assert.match(err.textContent, /blocked/i, 'the denied message is written');
  assert.match(err.textContent, /Settings > Notifications/i, 'and points at the iOS toggle');
  assert.notEqual(err.style.display, 'none', 'the error element is REVEALED, not muted');
  assert.equal(err.style.display, 'block', 'shown via setFieldError display:block');

  // And the status still reads not-enabled (nothing falsely claims success).
  const status = doc.getElementById('push-device-status');
  assert.match(status.textContent, /not enabled/i);
  dom.window.close();
});

test('dismissed prompt (default): the click reveals the distinct retry message, not the blocked copy', async () => {
  const dom = await loadSetupWithPush({ permission: 'default' });
  const doc = dom.window.document;
  const btn = doc.getElementById('push-device-enable-btn');
  const err = doc.getElementById('push-error');
  assert.ok(btn && !btn.hidden, 'precondition: enable button shown');

  btn.dispatchEvent(new dom.window.Event('click'));
  await settle(dom);

  assert.equal(err.style.display, 'block', 'the message is revealed');
  assert.match(err.textContent, /again/i, 'a dismissed prompt tells the user to retry');
  assert.doesNotMatch(err.textContent, /blocked/i, 'and does NOT show the blocked copy (distinct cause)');
  dom.window.close();
});
