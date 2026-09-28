'use strict';

// Mounts the REAL Subscriptions view (lib/ytdlp/views/subscriptions.html) in jsdom
// and runs the REAL controller (lib/ytdlp/client/subscriptions.js) against it, with
// the real ui.js primitives (UI pass S5). `route(method, url, body)` answers every
// fetch; unanswered calls resolve to a harmless empty shape. Returns the window,
// document, the view's registered handlers, and a recording of every request.
//
// Used by subscriptions-panels-behavior, sub-bell-in-place and
// subs-destructive-confirm. Timers are real: a ui.sheet finishes closing on its
// fallback timer (no transitionend in jsdom), so callers wait with `settle`.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const SUBS_HTML = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'), 'utf8');
const SUBS_PATH = require.resolve('../../lib/ytdlp/client/subscriptions.js');
const UI_PATH = require.resolve('../../public/js/ui.js');

const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

function mountSubsView(route, opts) {
  const o = opts || {};
  const dom = new JSDOM(SUBS_HTML, { url: 'http://localhost/subscriptions' });
  const { window } = dom;
  const { document } = window;
  const calls = [];
  const fetchSpy = (url, init) => {
    const method = (init && init.method) || 'GET';
    let body = null;
    if (init && typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (_) { body = init.body; } }
    calls.push({ method, url: String(url), body });
    const answered = typeof route === 'function' ? route(method, String(url), body) : undefined;
    if (answered !== undefined) return Promise.resolve(answered);
    return Promise.resolve(jsonRes(200, method === 'GET' && String(url) === '/api/subscriptions' ? (o.subs || []) : []));
  };
  global.window = window;
  global.document = document;
  global.localStorage = window.localStorage;
  // Node 21+ defines a getter-only global navigator; replace it for this harness.
  Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true, writable: true });
  global.AbortController = window.AbortController;
  global.fetch = fetchSpy;
  window.fetch = fetchSpy;
  window.open = (...args) => { calls.push({ method: 'OPEN', url: String(args[0]), body: null }); return null; };
  // the primitives, as every shell loads them (window.ui)
  delete require.cache[UI_PATH];
  window.ui = require(UI_PATH);
  const navigations = [];
  let captured = null;
  window.FileTube = {
    registerView: (name, handlers) => { if (name === 'subscriptions') captured = handlers; },
    navigate: (href) => { navigations.push(href); },
  };
  delete require.cache[SUBS_PATH];
  require(SUBS_PATH);
  assert.ok(captured && typeof captured.init === 'function', 'subscriptions.js must self-register an init');
  captured.init(document.getElementById('view-root'));
  return { window, document, handlers: captured, calls, navigations };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(pred, label, ms) {
  const until = Date.now() + (ms || 2000);
  while (Date.now() < until) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for: ${label}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (window, el) => el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
const openSheets = (document) => Array.from(document.querySelectorAll('.ui-sheet')).filter((s) => s.classList.contains('is-open') || s.parentNode);

module.exports = { mountSubsView, jsonRes, tick, settle, wait, click, openSheets, SUBS_HTML };
