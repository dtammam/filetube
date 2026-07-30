'use strict';

// [UNIT] v1.55 Track D (Dean: "the ability to collapse the other sections...
// most of the things that are super long or could be") - the collapse
// persistence helper (wireCollapsibleSections) plus statement-anchored locks
// proving every management page actually carries the details cards AND wires
// the helper (presence of markup without the wiring call = state silently
// forgotten; the reverse = nothing to wire).

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// localStorage shim BEFORE requiring common.js (its accessors close over the
// require realm's global).
const store = new Map();
if (!global.localStorage) {
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}
const { wireCollapsibleSections } = require('../../public/js/common.js');

function fakeDetails(key, open) {
  const listeners = {};
  return {
    open,
    hidden: false,
    dataset: {},
    attributes: { 'data-collapse-key': key },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fireToggle() { (listeners.toggle || []).forEach((fn) => fn()); },
    toggleListenerCount() { return (listeners.toggle || []).length; },
  };
}
function fakeScope(...els) {
  return { querySelectorAll: () => els };
}

beforeEach(() => store.clear());

test('restores a saved closed state; leaves unsaved sections at their markup default', () => {
  store.set('ft-collapse:setup:appearance', 'closed');
  const saved = fakeDetails('appearance', true);
  const untouched = fakeDetails('account', true);
  wireCollapsibleSections('setup', fakeScope(saved, untouched));
  assert.equal(saved.open, false, 'the remembered collapse is applied');
  assert.equal(untouched.open, true, 'no record -> markup default wins');
});

test('a saved open state re-opens a default-closed disclosure (the add-subscription case)', () => {
  store.set('ft-collapse:subscriptions:add-subscription', 'open');
  const el = fakeDetails('add-subscription', false);
  wireCollapsibleSections('subscriptions', fakeScope(el));
  assert.equal(el.open, true);
});

test('toggling persists per page and per key', () => {
  const el = fakeDetails('download-history', true);
  wireCollapsibleSections('subscriptions', fakeScope(el));
  el.open = false;
  el.fireToggle();
  assert.equal(store.get('ft-collapse:subscriptions:download-history'), 'closed');
  el.open = true;
  el.fireToggle();
  assert.equal(store.get('ft-collapse:subscriptions:download-history'), 'open');
});

test('idempotent per element: re-wiring after a dynamic mount never double-binds', () => {
  const el = fakeDetails('download-failures', true);
  wireCollapsibleSections('subscriptions', fakeScope(el));
  wireCollapsibleSections('subscriptions', fakeScope(el)); // the post-mount re-call
  assert.equal(el.toggleListenerCount(), 1);
});

test('never touches hidden - capability gating stays orthogonal to collapse state', () => {
  store.set('ft-collapse:setup:users', 'open');
  const el = fakeDetails('users', true);
  el.hidden = true; // non-admin: the box is capability-hidden
  wireCollapsibleSections('setup', fakeScope(el));
  assert.equal(el.hidden, true, 'a stored open state must never unhide a capability-hidden box');
});

// ---- statement-anchored wiring locks (comments stripped) -------------------

const stripped = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('LOCK: every management page carries its collapsible cards AND wires persistence', () => {
  const setupHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
  const statsHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'stats.html'), 'utf8');
  const subsHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'), 'utf8');
  assert.ok((setupHtml.match(/data-collapse-key="/g) || []).length >= 8, 'all eight setup boxes are collapsible');
  assert.ok((statsHtml.match(/data-collapse-key="/g) || []).length >= 10, 'the stats section cards are collapsible');
  for (const key of ['subscriptions-list', 'add-subscription', 'one-off-download']) {
    assert.ok(subsHtml.includes(`data-collapse-key="${key}"`), `subscriptions.html lost the ${key} card`);
  }
  assert.match(stripped('public/js/setup.js'), /wireCollapsibleSections\('setup', root \|\| document, controller\.signal\);/,
    'setup persistence wiring deleted');
  assert.match(stripped('public/js/stats.js'), /wireCollapse\('stats'\);/,
    'stats persistence wiring deleted');
  const subs = stripped('lib/ytdlp/client/subscriptions.js');
  assert.match(subs, /wireCollapsibleSections\('subscriptions', root \|\| document, signal\);/,
    'subscriptions persistence wiring deleted');
  assert.equal((subs.match(/wireCollapse\(\);/g) || []).length >= 3, true,
    'a dynamic mount (history/failures) stopped re-wiring persistence');
});
