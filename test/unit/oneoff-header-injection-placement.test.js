'use strict';

// [UNIT] v1.85.2 (Dean, on-device root cause) -- the one-off Download button
// silently failed to inject on EVERY page, both form factors. It was NOT a CSS
// or health-endpoint problem (both proved fine via live console diagnostics on
// Dean's instance): the header-button placement did
//   headerRight.insertBefore(btn, headerRight.querySelector('a[href="/setup.html"]'))
// and querySelector matches ANY descendant. v1.82 folded the Settings link INTO
// the account-menu dropdown - an <a href="/setup.html"> nested inside
// #account-menu-root, itself inside .header-right - so the selector matched that
// GRANDCHILD. insertBefore requires a DIRECT child, so it threw NotFoundError,
// rejecting the injector's whole .then into its silent `.catch(() => {})` and
// building NEITHER the header button NOR the bottom-nav entry (that build runs
// later in the same .then). It was invisible in local repros because there the
// one-off probe won the async race and ran BEFORE the account menu injected its
// link; it was DETERMINISTIC on Dean's server where the account menu injects
// first. The live falsifier was the exact browser error:
//   "NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before
//    which the new node is to be inserted is not a child of this node."
//
// The fix scopes the anchor lookup to `:scope > a[href="/setup.html"]` (a DIRECT
// child only). This test reproduces Dean's DOM and binds both the regression and
// the preserved direct-child placement semantics. Pre-fix, the first test goes
// RED (button absent); post-fix it is GREEN.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

// document is undefined at require time, so requiring common.js does NOT run its
// DOMContentLoaded boot (same posture as shell-singleton-invariant.test.js).
const common = require('../../public/js/common.js');

function makeShell() {
  return new JSDOM(`<!DOCTYPE html><html><body>
    <header><div class="header-right"></div></header>
    <nav id="bottom-nav">
      <a class="bottom-nav-item" data-nav="home" href="/">Home</a>
      <a class="bottom-nav-item" data-nav="settings" href="/setup.html">Settings</a>
    </nav>
  </body></html>`, { url: 'http://localhost/' });
}

// Mimic the v1.82 account menu: an <a href="/setup.html"> nested TWO levels deep
// inside .header-right (dropdown row inside #account-menu-root), never a direct
// child - exactly the shape that made querySelector match a non-child node.
function injectAccountMenuLike(doc) {
  const hr = doc.querySelector('.header-right');
  const root = doc.createElement('div');
  root.id = 'account-menu-root';
  const menu = doc.createElement('div');
  menu.className = 'account-menu';
  const link = doc.createElement('a');
  link.setAttribute('href', '/setup.html');
  link.textContent = 'Settings';
  menu.appendChild(link);
  root.appendChild(menu);
  hr.appendChild(root);
  return root;
}

async function runInjector(doc) {
  global.document = doc;
  global.fetch = () => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({ enabled: true, defaultMaxVideos: 20 }),
  });
  try {
    common.injectOneOffDownloadButtonIfEnabled();
    // let the health .then microtask + build run
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    delete global.document;
    delete global.fetch;
  }
}

test('REGRESSION: the one-off button injects even when a NESTED /setup.html link (the v1.82 account menu) sits in .header-right', async () => {
  const dom = makeShell();
  const doc = dom.window.document;
  injectAccountMenuLike(doc); // account menu injected FIRST (Dean's server order)

  await runInjector(doc);

  assert.ok(doc.getElementById('ytdlp-oneoff-btn'),
    'the header Download button must inject despite the nested account-menu Settings link (pre-fix insertBefore threw NotFoundError)');
  assert.ok(doc.querySelector('[data-nav="oneoff-download"]'),
    'the bottom-nav Download entry must also inject - it builds after the header button in the SAME .then, so the header throw killed it too');
});

test('a DIRECT-CHILD /setup.html Settings link still anchors placement (button inserted immediately before it)', async () => {
  const dom = makeShell();
  const doc = dom.window.document;
  const hr = doc.querySelector('.header-right');
  const direct = doc.createElement('a');
  direct.setAttribute('href', '/setup.html');
  direct.textContent = 'Settings';
  hr.appendChild(direct); // a legacy direct-child Settings link

  await runInjector(doc);

  const btn = doc.getElementById('ytdlp-oneoff-btn');
  assert.ok(btn, 'button injects');
  assert.strictEqual(btn.nextElementSibling, direct,
    'a DIRECT-CHILD Settings link still anchors the button immediately before it (original v1.15 semantics preserved)');
});

test('no Settings link at all (the real v1.82+ index header) -> button is appended to .header-right', async () => {
  const dom = makeShell();
  const doc = dom.window.document;

  await runInjector(doc);

  const hr = doc.querySelector('.header-right');
  const btn = doc.getElementById('ytdlp-oneoff-btn');
  assert.ok(btn, 'button injects');
  assert.strictEqual(btn.parentElement, hr, 'with no anchor, the button is appended into .header-right');
});

test('(v1.86.0) the injected button carries "Download" in a .btn-label span (so mobile CSS can go glyph-only)', async () => {
  const dom = makeShell();
  const doc = dom.window.document;

  await runInjector(doc);

  const btn = doc.getElementById('ytdlp-oneoff-btn');
  assert.ok(btn, 'button injects');
  const label = btn.querySelector('.btn-label');
  assert.ok(label, 'the "Download" text is in a .btn-label span (not a raw text node) so the mobile glyph-only CSS has a target');
  assert.strictEqual(label.textContent, 'Download');
  assert.ok(btn.querySelector('i.icon-download'), 'the download glyph remains alongside the label');
});
