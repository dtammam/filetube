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
//   only; the actual visual result is Dean's on-device call.
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
    assert.strictEqual(navBtn.className, 'bottom-nav-item');
    const navIcon = navBtn.children.find((c) => c.className === 'icon-download');
    assert.ok(navIcon, 'expected the same download icon used by the header button');
    const navLabel = navBtn.children.find((c) => c.className === 'bottom-nav-label');
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

const mobileBlockRe = /@media \(max-width: 768px\) \{([\s\S]*?)\n\}\n\n\/\* In landscape/;

function mobileBlock() {
  const block = mobileBlockRe.exec(css);
  assert.ok(block, 'expected the main mobile (max-width:768px) media query block');
  return block[1];
}

test('FIX 5: the base .oneoff-modal caps its own height and scrolls internally, with a roomier max-width than before', () => {
  const rule = /\.oneoff-modal\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected the base .oneoff-modal rule');
  assert.match(rule[1], /max-width:\s*460px/);
  assert.match(rule[1], /max-height:\s*85vh/);
  assert.match(rule[1], /overflow-y:\s*auto/);
});

test('FIX 5: .oneoff-modal-row select has enough min-width to fit the longest option label (was 100px, clipped "MP4 (recommended)")', () => {
  const rule = /\.oneoff-modal-row select\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected the base .oneoff-modal-row select rule');
  const minWidthMatch = /min-width:\s*(\d+)px/.exec(rule[1]);
  assert.ok(minWidthMatch, 'expected an explicit min-width');
  assert.ok(Number(minWidthMatch[1]) >= 150, 'min-width must be roomy enough for the longest option label');
});

test('FIX 5: the Download button is a full-width, centered primary CTA in the modal', () => {
  const rule = /\.oneoff-modal \.btn-primary\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a .oneoff-modal .btn-primary rule');
  assert.match(rule[1], /width:\s*100%/);
});

test('FIX 5 (mobile): the three selects stack one-per-row on a phone instead of crowding', () => {
  const body = mobileBlock();
  assert.match(body, /\.oneoff-modal-row\s*\{[^}]*flex-direction:\s*column/);
  assert.match(body, /\.oneoff-modal-row select\s*\{[^}]*width:\s*100%/);
});

test('v1.19.0 FR-1 (mobile): .oneoff-modal-row select resets flex to 0 0 auto -- the base rule\'s 150px flex-basis/flex-grow:1 (a width hint under the desktop row layout) must not be reinterpreted as a min-height/growth-target under the mobile column layout', () => {
  const body = mobileBlock();
  // The base (non-mobile) `.oneoff-modal-row select` rule (~1910) also
  // appears in `body` (mobileBlock()'s captured range spans well beyond the
  // literal @media block -- see the other tests in this file), so this must
  // assert the FIX is present somewhere in the mobile CSS, not merely that
  // *a* `.oneoff-modal-row select {}` rule exists (the base rule alone would
  // satisfy a naive first-match check without actually closing the bug).
  assert.match(
    body,
    /\.oneoff-modal-row select\s*\{[^}]*flex:\s*0 0 auto[^}]*width:\s*100%/,
    'expected a mobile .oneoff-modal-row select rule with flex reset to 0 0 auto (so the inherited 150px basis is no longer reinterpreted as a minimum height under flex-direction: column) alongside the existing width: 100%'
  );
});

test('FIX 5 (mobile): the modal itself is near-full-width with tighter padding, and every tappable control has a comfortable minimum tap-target height', () => {
  const body = mobileBlock();
  const modalRule = /\.oneoff-modal\s*\{([^}]*)\}/.exec(body);
  assert.ok(modalRule, 'expected a mobile .oneoff-modal override');
  assert.match(modalRule[1], /width:\s*9[0-9]%/);

  const minHeightRule = /\.oneoff-modal-field,\s*\n?\s*\.oneoff-modal-row select,\s*\n?\s*\.oneoff-modal \.btn-primary\s*\{([^}]*)\}/.exec(body);
  assert.ok(minHeightRule, 'expected a grouped mobile min-height rule covering the URL field, the selects, and the Download button');
  const minHeightMatch = /min-height:\s*(\d+)px/.exec(minHeightRule[1]);
  assert.ok(minHeightMatch, 'expected an explicit min-height');
  assert.ok(Number(minHeightMatch[1]) >= 44, 'tap targets should be at least 44px, matching the existing Setup/Subscriptions mobile polish');
});

// ---- FIX 6: on 'done' auto-close + rescan; on 'error' stay open ------------

test('decideOneOffTerminalAction: "done" closes (after a brief pause) and triggers a rescan', () => {
  const action = decideOneOffTerminalAction({ state: 'done' });
  assert.strictEqual(action.close, true);
  assert.ok(action.closeDelayMs > 0, 'the user should see the "Done" status before the modal disappears');
  assert.strictEqual(action.rescan, true);
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
