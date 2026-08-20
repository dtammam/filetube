'use strict';

// [UNIT] v1.158 (Dean): the master-detail nav reserves a SHIMMER slot for an
// admin-only section still hidden behind setup.js's async capability reveal
// (data-md-reserve), gated on the last-known-admin flag (ft-is-admin) - so a
// RETURNING admin's Downloads/Users/Backup rows do not "pop in a second later".
//
// The correctness properties, bound behaviourally:
//   1. WITH the flag: a hidden data-md-reserve section gets a NON-interactive,
//      aria-hidden placeholder in its group - and NO admin label/target is ever
//      rendered (the v1.80 privacy rule: never expose a hidden section's title).
//   2. WITHOUT the flag: no placeholder at all (a non-admin never reserves).
//   3. REVEAL axis: un-hiding the section replaces the placeholder with the real
//      row (the nav's hidden-observer).
//   4. CLEAR axis: with a placeholder ALREADY shown, clearing the flag + a
//      rebuild drops it (a shared-device non-admin must never strand a shimmer).
//      Populated FIRST, then driven to clear - never a vacuous born-empty clear.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { wireMasterDetail } = require('../../public/js/common.js');

function setup() {
  const html = `
  <div class="md-root" data-md-page="setup" data-md-title="Settings">
    <details class="setup-box" data-collapse-key="video" data-md-icon="video" data-md-group="Library"><summary>Video</summary><p>v</p></details>
    <details class="setup-box" data-collapse-key="account" data-md-icon="account" data-md-group="Account"><summary>Account</summary><p>ac</p></details>
    <details class="setup-box" id="users-box" hidden data-collapse-key="users" data-md-icon="users" data-md-group="Account" data-md-badge="Admin" data-md-reserve><summary>Users</summary><p>u</p></details>
  </div>`;
  const dom = new JSDOM('<!DOCTYPE html><html data-theme="2021"><body>' + html + '</body></html>', { url: 'http://localhost/setup.html' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.localStorage = dom.window.localStorage;
  const controller = new dom.window.AbortController();
  return { dom, doc: dom.window.document, signal: controller.signal };
}
function teardown(dom) {
  try { global.localStorage.clear(); } catch (_) { /* ignore */ }
  delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
  dom.window.close();
}
const tick = () => new Promise((r) => setTimeout(r, 0));

const skels = (doc) => doc.querySelectorAll('.md-nav .md-row-skeleton');
const realKeys = (doc) => Array.from(doc.querySelectorAll('.md-nav .md-row[data-md-target]')).map((r) => r.getAttribute('data-md-target'));

test('WITH the last-known-admin flag: a hidden data-md-reserve section gets a placeholder - no label, no target, aria-hidden', () => {
  const { dom, doc, signal } = setup();
  try {
    global.localStorage.setItem('ft-is-admin', '1');
    wireMasterDetail('setup', doc, signal);

    const ph = skels(doc);
    assert.strictEqual(ph.length, 1, 'one shimmer slot for the hidden Users section');
    assert.strictEqual(ph[0].getAttribute('aria-hidden'), 'true', 'non-AT-reachable');
    assert.strictEqual(ph[0].getAttribute('data-md-target'), null, 'not a selectable row');
    assert.ok(ph[0].querySelector('.skeleton-shimmer'), 'it actually shimmers');
    // Privacy: the hidden section's title/key never appears in the nav.
    assert.doesNotMatch(doc.querySelector('.md-nav').textContent, /Users/, 'no admin label leaks');
    assert.ok(!realKeys(doc).includes('users'), 'no real Users row while hidden');
    // Placement: inside the Account group (after the real account row).
    const accountCard = Array.from(doc.querySelectorAll('.md-group')).find((g) => (g.querySelector('.md-group-title') || {}).textContent === 'Account');
    assert.ok(accountCard && accountCard.querySelector('.md-row-skeleton'), 'the slot sits in the Account group');
  } finally { teardown(dom); }
});

test('WITHOUT the flag: no placeholder (a non-admin never reserves an admin slot)', () => {
  const { dom, doc, signal } = setup();
  try {
    // no ft-is-admin set
    wireMasterDetail('setup', doc, signal);
    assert.strictEqual(skels(doc).length, 0, 'no shimmer slot without the flag');
    assert.ok(!realKeys(doc).includes('users'), 'and still no real Users row (hidden)');
  } finally { teardown(dom); }
});

test('REVEAL axis: un-hiding the section replaces the placeholder with the real row', async () => {
  const { dom, doc, signal } = setup();
  try {
    global.localStorage.setItem('ft-is-admin', '1');
    wireMasterDetail('setup', doc, signal);
    assert.strictEqual(skels(doc).length, 1, 'precondition: the slot is shown');

    doc.getElementById('users-box').hidden = false; // setup.js reveals it after the admin fetch
    await tick(); // the nav's hidden-observer fires buildNav

    assert.strictEqual(skels(doc).length, 0, 'the placeholder is gone');
    assert.ok(realKeys(doc).includes('users'), 'the real Users row now renders');
  } finally { teardown(dom); }
});

test('CLEAR axis: a placeholder ALREADY shown is dropped when the flag clears + the nav rebuilds (no stranded shimmer)', () => {
  const { dom, doc, signal } = setup();
  try {
    global.localStorage.setItem('ft-is-admin', '1');
    wireMasterDetail('setup', doc, signal);
    assert.strictEqual(skels(doc).length, 1, 'populated FIRST (the clear is not vacuous)');

    // A shared-device non-admin: setup.js clears the flag and rebuilds.
    global.localStorage.removeItem('ft-is-admin');
    doc.querySelector('.md-root')._mdRebuild();

    assert.strictEqual(skels(doc).length, 0, 'the stranded shimmer is cleared');
  } finally { teardown(dom); }
});
