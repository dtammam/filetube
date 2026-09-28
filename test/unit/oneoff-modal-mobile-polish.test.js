'use strict';

// [UNIT] v1.15.1 one-off download modal polish patch, 3 fixes to the header
// button + compact modal added in v1.15.0 item 3 (public/js/common.js /
// public/css/style.css):
//
//   FIX 4 -- the one-off download entry point is reachable on MOBILE. The
//   header button lives in `.header-right`, which is CSS-hidden at the
//   phone breakpoint (same rule that hides Settings/the moon toggle there),
//   so it was previously unreachable on a phone. `injectOneOffDownloadButton
//   IfEnabled` now ALSO injects a bottom-nav "Download" entry (mirroring
//   `injectSubscriptionsNavLinkIfEnabled`'s own bottom-nav injection),
//   gated by the exact same health-probe.
//
//   FIX 5 -- the modal's format/quality/filetype selects no longer clip
//   their content, and stack full-width on a phone. Mechanical/CSS-presence
//   only; the actual visual result is Dean's on-device call. (Step 7: bound on
//   the ui-sheet / ui-select rules that carry it now.)
//
//   FIX 6 -- on a terminal 'done' status the modal auto-closes (after a
//   brief pause) and triggers a library rescan+refresh; on 'error' it stays
//   open. Covered via the pure `decideOneOffTerminalAction` reducer and the
//   injectable `triggerLibraryRescanAndRefresh` helper.

const { test } = require('node:test');

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  decideOneOffTerminalAction,
  triggerLibraryRescanAndRefresh,
  injectOneOffDownloadButtonIfEnabled,
} = require('../../public/js/common.js');

// ---- FIX 4: minimal fake DOM sufficient to exercise the injection's real
// DOM-mutation branches (mirrors the FakeElement pattern in
// test/unit/ytdlp-oneoff-modal.test.js, trimmed to only what this shell
// needs: appendChild/insertBefore/insertAdjacentElement/setAttribute/
// addEventListener/querySelector). Plain-property assignment (`btn.id = ...`,
// `label.textContent = ...`) needs no special getter/setter here since
// FakeElement instances are ordinary objects.

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this._listeners = {};
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(newNode, refNode) {
    const idx = this.children.indexOf(refNode);
    newNode.parentElement = this;
    if (idx === -1) this.children.push(newNode);
    else this.children.splice(idx, 0, newNode);
    return newNode;
  }

  insertAdjacentElement(position, el) {
    if (!this.parentElement) return null;
    el.parentElement = this.parentElement;
    if (position === 'afterend') {
      const idx = this.parentElement.children.indexOf(this);
      this.parentElement.children.splice(idx + 1, 0, el);
    }
    return el;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  addEventListener(type, handler) {
    (this._listeners[type] = this._listeners[type] || []).push(handler);
  }

  // A page's header/nav elements never need real CSS-selector matching in
  // this test -- only `headerRight.querySelector('a[href="/setup.html"]')`
  // is ever called on a built element, and returning `null` (no pre-existing
  // Settings link) is sufficient to exercise the append-branch.
  querySelector() {
    return null;
  }
}

function makeFakeDocument({ withHeader = true, withBottomNavSettings = true } = {}) {
  const headerRight = withHeader ? new FakeElement('div') : null;
  const navParent = new FakeElement('nav');
  const settingsNavItem = withBottomNavSettings ? new FakeElement('a') : null;
  if (settingsNavItem) navParent.appendChild(settingsNavItem);

  const bodyChildren = [];
  const docListeners = {};

  const doc = {
    getElementById: () => null, // never pre-injected in these tests
    querySelector: (sel) => {
      if (sel === '.header-right') return headerRight;
      if (sel === '#bottom-nav [data-nav="settings"]') return settingsNavItem;
      if (sel === '[data-nav="oneoff-download"]') return null;
      return null;
    },
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    addEventListener: (type, handler) => { (docListeners[type] = docListeners[type] || []).push(handler); },
    body: { appendChild: (el) => bodyChildren.push(el) },
  };

  return { doc, headerRight, settingsNavItem, navParent, bodyChildren };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function withGlobals(doc, fetchImpl, run) {
  const originalDocument = global.document;
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  global.document = doc;
  global.fetch = fetchImpl;
  global.window = { location: { reload: () => {} } };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.document = originalDocument;
      global.fetch = originalFetch;
      global.window = originalWindow;
    });
}

test('FIX 4: a 200 (module enabled) health probe injects BOTH the header button and a mobile bottom-nav "Download" entry', async () => {
  const { doc, headerRight, navParent } = makeFakeDocument();
  await withGlobals(doc, () => Promise.resolve({ ok: true, status: 200 }), async () => {
    injectOneOffDownloadButtonIfEnabled();
    await flush();

    const headerBtn = headerRight.children.find((c) => c.id === 'ytdlp-oneoff-btn');
    assert.ok(headerBtn, 'expected the header button to be injected into .header-right');

    const navBtn = navParent.children.find((c) => c.attributes['data-nav'] === 'oneoff-download');
    assert.ok(navBtn, 'expected a bottom-nav entry (data-nav="oneoff-download") to be injected');
    assert.strictEqual(navBtn.tagName, 'BUTTON', 'the mobile entry point must be a button (opens the modal, not a navigation link)');
    // Sweep S1 (DELIBERATE lock update, F49): the tab is a ui-btn stack like every other.
    assert.strictEqual(navBtn.className, 'ui-btn ui-btn--plain ui-btn--md ui-btn--stack bottom-nav-item');
    // v1.339 (L2, DELIBERATE lock update): the glyph is now the inline chrome-icon <svg>
    // (chromeIconEl('download'), the header button's own glyph) - this stub document has no
    // createElementNS, so it builds none; the old `.icon-download` mask must be gone.
    // test/unit/app-look-l2.test.js binds the real <svg> in jsdom.
    assert.ok(!navBtn.children.some((c) => c.className === 'icon-download'), 'no iOS-decode-lag mask glyph');
    const navLabel = navBtn.children.find((c) => c.className === 'ui-btn__label bottom-nav-label');
    assert.ok(navLabel, 'expected a visible label');
    assert.strictEqual(navLabel.textContent, 'Download');
  });
});

test('FIX 4: a 404 (module disabled) health probe injects NOTHING -- neither the header button nor the mobile entry', async () => {
  const { doc, headerRight, navParent } = makeFakeDocument();
  await withGlobals(doc, () => Promise.resolve({ ok: false, status: 404 }), async () => {
    injectOneOffDownloadButtonIfEnabled();
    await flush();

    assert.strictEqual(headerRight.children.length, 0, 'disabled must leave .header-right untouched');
    assert.strictEqual(navParent.children.length, 1, 'disabled must leave the bottom-nav untouched (only the pre-existing Settings item)');
  });
});

test('FIX 4: a network failure (rejected probe) fails closed -- injects nothing', async () => {
  const { doc, headerRight, navParent } = makeFakeDocument();
  await withGlobals(doc, () => Promise.reject(new Error('network down')), async () => {
    injectOneOffDownloadButtonIfEnabled();
    await flush();

    assert.strictEqual(headerRight.children.length, 0);
    assert.strictEqual(navParent.children.length, 1);
  });
});

test('FIX 4: a page with only the bottom nav (no .header-right) still gets the mobile entry when enabled', async () => {
  const { doc, navParent } = makeFakeDocument({ withHeader: false });
  await withGlobals(doc, () => Promise.resolve({ ok: true, status: 200 }), async () => {
    injectOneOffDownloadButtonIfEnabled();
    await flush();

    const navBtn = navParent.children.find((c) => c.attributes['data-nav'] === 'oneoff-download');
    assert.ok(navBtn, 'the mobile entry must not depend on the desktop header existing');
  });
});

test('FIX 4: a page with only the header (no bottom nav) still gets the header button when enabled', async () => {
  const { doc, headerRight } = makeFakeDocument({ withBottomNavSettings: false });
  await withGlobals(doc, () => Promise.resolve({ ok: true, status: 200 }), async () => {
    injectOneOffDownloadButtonIfEnabled();
    await flush();

    const headerBtn = headerRight.children.find((c) => c.id === 'ytdlp-oneoff-btn');
    assert.ok(headerBtn, 'the header button must not depend on a bottom nav existing');
  });
});

// ---- FIX 5: CSS-presence for the responsive/wrap modal rules ---------------
// Visual correctness is Dean's on-device arbiter; these assert the mechanical
// rules exist as described (mirrors test/unit/home-mobile-scale.test.js).

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// Step 7 (UI pass, DELIBERATE conversion): the bespoke .oneoff-modal shell and its
// .oneoff-modal-field / .oneoff-modal-row select / .oneoff-modal .btn-primary rules are
// retired - the one-off dialog (S8/S9) and the Subscribe dialog (step 7) are ui.sheet forms of
// ui-field inputs and ui-select selects. FIX 5's intent is bound on the rules that carry it
// now: a sheet caps its own height and scrolls inside; the selects sit in a grid whose columns
// never go under twice the 2xl avatar (192px: "MP4 (recommended)" fits) and fall to one per
// row on a phone; every field is 44 tall; Download spans its row.
const UI_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'ui.css'), 'utf8');
const TOKENS_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'tokens.css'), 'utf8');

test('FIX 5 (step 7): the dialogs are ui.sheet forms - no bespoke .oneoff-modal shell rules remain', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /\.oneoff-modal(\s*[{,:]|-backdrop|-row|-field|-close|-header|-title)/, 'the shell, its rows and fields are gone');
  assert.match(UI_CSS, /\n\.ui-sheet \{[^}]*max-height:\s*90dvh;[^}]*overflow:\s*hidden;/, 'a sheet caps its own height and clips; its body scrolls inside');
});

test('FIX 5: the selects never clip "MP4 (recommended)" - a grid of columns at least 192px (twice the 2xl avatar), one per row on a phone', () => {
  const rule = /\n\.oneoff-modal-selects\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected the .oneoff-modal-selects rule');
  assert.match(rule[1], /display:\s*grid/);
  assert.match(rule[1], /grid-template-columns:\s*repeat\(auto-fit, minmax\(calc\(var\(--av-2xl\) \* 2\), 1fr\)\)/,
    'auto-fit tracks of at least 2 x --av-2xl: two never fit a 390px phone form, so they stack');
  assert.match(TOKENS_CSS, /--av-2xl:\s*96px;/, '2 x 96 = 192px, roomier than the old 150px floor');
});

test('FIX 5 (mobile): every field is a 44px tap target - the ui-field / ui-select height is --ctl-lg', () => {
  const rule = /\n\.ui-field__input,\s*\n\.ui-select__native \{([^}]*)\}/.exec(UI_CSS);
  assert.ok(rule, 'expected the shared .ui-field__input, .ui-select__native rule');
  assert.match(rule[1], /height:\s*var\(--ctl-lg\)/);
  assert.match(TOKENS_CSS, /--ctl-lg:\s*44px;/);
});

test('FIX 5: the Download button spans its row - the one-off action row is 1fr columns (auto-fit collapses the hidden Retry)', () => {
  const rule = /\n\.oneoff-modal-actions\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected the .oneoff-modal-actions rule');
  assert.match(rule[1], /grid-template-columns:\s*repeat\(auto-fit, minmax\(120px, 1fr\)\)/);
});

// ---- FIX 6: on 'done' auto-close + rescan; on 'error' stay open ------------

// BUG 2 fix (regression, post-v1.24.1): 'done' used to ALSO request a
// rescan, which triggered `triggerLibraryRescanAndRefresh()` --
// `POST /api/scan` followed by `window.location.reload()`. Under load
// (many queued subscription downloads), `POST /api/scan` resolves near-
// instantly with a 409 (a scan is already running), so the reload fired
// immediately -- and a `window.location.reload()` against an already-
// saturated server could hang mid-navigation, freezing the whole page: the
// "Done" modal stayed painted, its own already-scheduled auto-close timer
// never fired, and even the [x] button went inert. The server already
// rescans after `runOneShot` completes, so the client-side rescan+reload
// was always redundant -- 'done' no longer requests one at all.
test('decideOneOffTerminalAction: "done" closes (after a brief pause) and no longer requests a rescan/reload (BUG 2 fix)', () => {
  const action = decideOneOffTerminalAction({ state: 'done' });
  assert.strictEqual(action.close, true);
  assert.ok(action.closeDelayMs > 0, 'the user should see the "Done" status before the modal disappears');
  assert.strictEqual(action.rescan, false, 'a rescan/reload must never be requested on "done" -- see BUG 2 fix');
});

test('decideOneOffTerminalAction: "error" stays open (the message remains visible) and never rescans', () => {
  const action = decideOneOffTerminalAction({ state: 'error', error: 'boom' });
  assert.strictEqual(action.close, false);
  assert.strictEqual(action.rescan, false);
});

test('decideOneOffTerminalAction: a non-terminal state (defensive) takes no action', () => {
  for (const state of ['queued', 'listing', 'downloading', 'idle']) {
    const action = decideOneOffTerminalAction({ state });
    assert.strictEqual(action.close, false);
    assert.strictEqual(action.rescan, false);
  }
});

test('decideOneOffTerminalAction: null/undefined/non-object entries take no action (defensive)', () => {
  for (const entry of [null, undefined, 'done', 42]) {
    const action = decideOneOffTerminalAction(entry);
    assert.strictEqual(action.close, false);
    assert.strictEqual(action.rescan, false);
  }
});

test('triggerLibraryRescanAndRefresh: POSTs to the SAME /api/scan endpoint the "Rescan Files" button uses, then refreshes', async () => {
  const calls = [];
  let reloaded = false;
  const fakeFetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true });
  };
  triggerLibraryRescanAndRefresh(fakeFetch, () => { reloaded = true; });
  await flush();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/scan');
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.strictEqual(reloaded, true);
});

test('triggerLibraryRescanAndRefresh: still refreshes (best-effort) even when the scan request itself fails', async () => {
  let reloaded = false;
  const fakeFetch = () => Promise.reject(new Error('network error'));
  triggerLibraryRescanAndRefresh(fakeFetch, () => { reloaded = true; });
  await flush();

  assert.strictEqual(reloaded, true, 'the server already re-scanned after the one-off, so the refresh should proceed regardless');
});
