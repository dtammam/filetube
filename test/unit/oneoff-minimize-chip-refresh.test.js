'use strict';

// [UNIT] v1.29.0 T8 (v1.29 Downloads Reliability Wave, T2 design item) --
// "non-blocking one-shot": a one-off download no longer holds the modal (and
// the UI) hostage. Covers:
//
//   - `submitOneOffDownload`'s success branch (public/js/common.js) now
//     minimizes the modal into the existing corner chip (`closeModal()` +
//     an idempotent `injectDownloadStatusChip()` call) instead of keeping
//     the modal open/polling (R2.1/AC4.1, R2.2/AC4.2). The `!r.ok`/
//     network-error branches are UNCHANGED (T6 non-regression, R1.4): the
//     modal stays open with the error visible.
//   - `detectNewlyDoneOneShots` -- the PURE, edge-triggered done-detector
//     that drives the in-place library refresh (R2.3/R2.4, AC4.3/AC4.4),
//     node:test-covered directly with no DOM/timers, mirroring
//     `reduceDownloadChipState`'s own pure-reducer posture (see
//     test/unit/ytdlp-download-chip.test.js).
//   - `refreshLibraryInPlace` -- invokes `window.__filetubeRefreshLibrary`
//     (the hook `public/js/main.js` exposes as `loadLibrary`) iff it is a
//     function; a safe no-op otherwise.
//   - The BUG 2 / no-reload regression guard: a spy proves
//     `window.location.reload()` is NEVER called on the one-shot done path
//     while the refresh hook DID fire, and `decideOneOffTerminalAction`'s
//     `rescan: false` lock still holds.
//
// The integration-level submit tests drive the REAL
// `injectOneOffDownloadButtonIfEnabled` in jsdom with the real ui.js (sweep S9:
// the dialog is a ui.sheet, the oneoff-modal-teardown.test.js harness); the
// pure-helper tests need no DOM at all.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const {
  detectNewlyDoneOneShots,
  refreshLibraryInPlace,
  decideOneOffTerminalAction,
} = require('../../public/js/common.js');

// ---- jsdom harness (sweep S9: the dialog is a ui.sheet) ---------------------

const COMMON = require.resolve('../../public/js/common.js');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Boots a FRESH common.js against a jsdom page (no document at require -> boot skipped),
// runs `run(ctx)` with the globals in place, drains closing sheets, then restores.
async function withPage(fetchImpl, run) {
  const saved = { window: global.window, document: global.document, fetch: global.fetch };
  delete global.window; delete global.document;
  delete require.cache[COMMON];
  const common = require(COMMON);
  const dom = new JSDOM('<!doctype html><html><body><header><div class="header-right"></div></header></body></html>', {
    url: 'http://localhost/',
    // A VISIBLE page (document.hidden false): the chip a successful submit injects parks its
    // poll on a hidden tab by re-arming a timer, which would keep this process alive.
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.fetch = fetchImpl;
  try {
    await run({ common, dom, doc: dom.window.document });
  } finally {
    for (let i = 0; i < 60 && dom.window.document.querySelector('.ui-sheet'); i++) await new Promise((r) => setTimeout(r, 20));
    dom.window.close();
    delete require.cache[COMMON];
    Object.assign(global, saved);
  }
}

// Opens the dialog from the header button, fills the URL field, returns its parts.
async function bootOpenAndFillUrl({ common, doc }, url) {
  common.injectOneOffDownloadButtonIfEnabled();
  await flush(); await flush();
  const headerBtn = doc.getElementById('ytdlp-oneoff-btn');
  assert.ok(headerBtn, 'expected the header button to be injected');
  headerBtn.click();
  const sheet = doc.querySelector('.ui-sheet');
  assert.ok(sheet, 'expected the dialog (a ui.sheet) open on document.body');
  const modal = sheet.querySelector('.oneoff-form');
  assert.ok(modal, 'expected the one-off form as its content');
  const urlInput = modal.querySelector('input.ui-field__input');
  urlInput.value = url;
  // v1.55 Track B: Retry+Download share one .action-bar row.
  const actionsRow = modal.querySelector('.action-bar.oneoff-modal-actions');
  assert.ok(actionsRow, 'expected the shared Retry+Download action row');
  const downloadBtn = actionsRow.querySelector('.ui-btn--primary');
  assert.ok(downloadBtn, 'expected the Download button');
  const statusEl = modal.querySelector('.oneoff-modal-status');
  assert.ok(statusEl, 'expected the status line element');
  return { sheet, modal, downloadBtn, statusEl };
}

// ---- submitOneOffDownload: minimize-on-success / stay-open-on-error --------

test('submitOneOffDownload: a SUCCESSFUL submit closes the modal and injects the corner chip (R2.1/AC4.1)', async () => {
  const fetchImpl = (url) => {
    if (url === '/api/subscriptions/health') return Promise.resolve({ ok: true, status: 200 });
    if (url === '/api/ytdlp/download') return Promise.resolve({ ok: true, json: async () => ({ jobId: 'job-123' }) });
    if (url === '/api/subscriptions/status') return new Promise(() => {}); // chip's own poll -- out of scope here
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };

  await withPage(fetchImpl, async (ctx) => {
    const { sheet, downloadBtn } = await bootOpenAndFillUrl(ctx, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    downloadBtn.click();
    await flush();
    await flush(); // let the chained injectDownloadStatusChip() health fetch resolve too

    assert.ok(sheet.classList.contains('is-closing'), 'the dialog is closing (minimized), not merely hidden');
    for (let i = 0; i < 60 && sheet.isConnected; i++) await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(sheet.isConnected, false, 'the dialog must no longer be in the document');
    assert.strictEqual(ctx.doc.querySelector('.ui-scrim'), null, 'nor its scrim');
    assert.ok(ctx.doc.getElementById('dl-status-chip'), 'expected the corner chip to have been injected as the new progress surface');
  });
});

test('submitOneOffDownload: an !r.ok submit leaves the modal OPEN with the server error rendered (T6 non-regression)', async () => {
  const fetchImpl = (url) => {
    if (url === '/api/subscriptions/health') return Promise.resolve({ ok: true, status: 200 });
    if (url === '/api/ytdlp/download') return Promise.resolve({ ok: false, json: async () => ({ error: 'Invalid URL' }) });
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };

  await withPage(fetchImpl, async (ctx) => {
    const { sheet, downloadBtn, statusEl } = await bootOpenAndFillUrl(ctx, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    downloadBtn.click();
    await flush();

    assert.ok(sheet.isConnected && !sheet.classList.contains('is-closing'), 'the modal must stay open on a non-OK submit response');
    assert.strictEqual(statusEl.textContent, 'Invalid URL');
    assert.strictEqual(ctx.doc.getElementById('dl-status-chip'), null, 'the chip must NOT be injected on a failed submit');
    sheet.querySelector('.ui-sheet__close').click();
  });
});

test('submitOneOffDownload: a network-error submit leaves the modal OPEN with a network-error message (T6 non-regression)', async () => {
  const fetchImpl = (url) => {
    if (url === '/api/subscriptions/health') return Promise.resolve({ ok: true, status: 200 });
    if (url === '/api/ytdlp/download') return Promise.reject(new Error('network down'));
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };

  await withPage(fetchImpl, async (ctx) => {
    const { sheet, downloadBtn, statusEl } = await bootOpenAndFillUrl(ctx, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    downloadBtn.click();
    await flush();

    assert.ok(sheet.isConnected && !sheet.classList.contains('is-closing'), 'the modal must stay open on a network-error submit');
    assert.strictEqual(statusEl.textContent, 'Could not start download (network error).');
    assert.strictEqual(ctx.doc.getElementById('dl-status-chip'), null, 'the chip must NOT be injected on a network-error submit');
    sheet.querySelector('.ui-sheet__close').click();
  });
});

// ---- detectNewlyDoneOneShots: pure done-edge detector -----------------------

test('detectNewlyDoneOneShots: a one-shot newly at "done" is returned exactly once as it transitions in', () => {
  const seen = new Set();
  const snapshotTick1 = { oneShots: { jobA: { state: 'downloading' } } };
  assert.deepStrictEqual(detectNewlyDoneOneShots(snapshotTick1, seen), []);

  const snapshotTick2 = { oneShots: { jobA: { state: 'done' } } };
  const newlyDone = detectNewlyDoneOneShots(snapshotTick2, seen);
  assert.deepStrictEqual(newlyDone, ['jobA']);

  // Caller adds the returned id(s) to its own seen-set before the next poll.
  newlyDone.forEach((id) => seen.add(id));
  const snapshotTick3 = { oneShots: { jobA: { state: 'done' } } }; // still 'done' on the NEXT tick
  assert.deepStrictEqual(detectNewlyDoneOneShots(snapshotTick3, seen), [], 'a job already-seen-done must not fire again on a later tick');
});

test('detectNewlyDoneOneShots: only "done" entries are ever returned, never "error"/"cancelled"/non-terminal states', () => {
  const seen = new Set();
  const snapshot = {
    oneShots: {
      jobDone: { state: 'done' },
      jobError: { state: 'error' },
      jobCancelled: { state: 'cancelled' },
      jobQueued: { state: 'queued' },
      jobDownloading: { state: 'downloading' },
    },
  };
  assert.deepStrictEqual(detectNewlyDoneOneShots(snapshot, seen), ['jobDone']);
});

test('detectNewlyDoneOneShots: multiple simultaneously-new "done" jobs are all returned on the same tick', () => {
  const seen = new Set();
  const snapshot = { oneShots: { jobA: { state: 'done' }, jobB: { state: 'done' } } };
  const result = detectNewlyDoneOneShots(snapshot, seen);
  assert.deepStrictEqual(result.sort(), ['jobA', 'jobB']);
});

test('detectNewlyDoneOneShots: accepts a plain array as seenDoneJobIds (not just a Set)', () => {
  const snapshot = { oneShots: { jobA: { state: 'done' }, jobB: { state: 'done' } } };
  assert.deepStrictEqual(detectNewlyDoneOneShots(snapshot, ['jobA']), ['jobB']);
});

test('detectNewlyDoneOneShots: never mutates its inputs (pure)', () => {
  const seen = new Set(['jobA']);
  const snapshot = { oneShots: { jobA: { state: 'done' }, jobB: { state: 'done' } } };
  detectNewlyDoneOneShots(snapshot, seen);
  assert.deepStrictEqual([...seen], ['jobA'], 'seenDoneJobIds must not be mutated by the detector itself');
  assert.deepStrictEqual(Object.keys(snapshot.oneShots), ['jobA', 'jobB'], 'the snapshot must not be mutated');
});

test('detectNewlyDoneOneShots: defensive against a missing/malformed snapshot or oneShots -- never throws, returns []', () => {
  assert.deepStrictEqual(detectNewlyDoneOneShots(null, new Set()), []);
  assert.deepStrictEqual(detectNewlyDoneOneShots(undefined, new Set()), []);
  assert.deepStrictEqual(detectNewlyDoneOneShots({}, new Set()), []);
  assert.deepStrictEqual(detectNewlyDoneOneShots({ oneShots: 'not-an-object' }, new Set()), []);
  assert.deepStrictEqual(detectNewlyDoneOneShots({ oneShots: { jobA: null, jobB: 'not-an-object' } }, new Set()), []);
  assert.deepStrictEqual(detectNewlyDoneOneShots({ oneShots: {} }, undefined), []);
});

// ---- refreshLibraryInPlace: invoke-iff-function / safe no-op ---------------

test('refreshLibraryInPlace: invokes window.__filetubeRefreshLibrary when it is a function, and returns true (v1.30.0 T8, AC5.1/AC5.2)', () => {
  const original = global.window;
  let calls = 0;
  global.window = { __filetubeRefreshLibrary: () => { calls += 1; } };
  try {
    const result = refreshLibraryInPlace();
    assert.strictEqual(calls, 1);
    assert.strictEqual(result, true, 'expected refreshLibraryInPlace() to return true when a live target was refreshed');
  } finally {
    global.window = original;
  }
});

test('refreshLibraryInPlace: is a safe no-op when the hook is absent, not a function, or window itself is undefined, and returns false in every case (v1.30.0 T8, AC5.2)', () => {
  const original = global.window;
  try {
    global.window = {};
    assert.doesNotThrow(() => refreshLibraryInPlace());
    assert.strictEqual(refreshLibraryInPlace(), false);

    global.window = { __filetubeRefreshLibrary: 'not-a-function' };
    assert.doesNotThrow(() => refreshLibraryInPlace());
    assert.strictEqual(refreshLibraryInPlace(), false);

    global.window = { __filetubeRefreshLibrary: null };
    assert.doesNotThrow(() => refreshLibraryInPlace());
    assert.strictEqual(refreshLibraryInPlace(), false);

    delete global.window;
    assert.doesNotThrow(() => refreshLibraryInPlace());
    assert.strictEqual(refreshLibraryInPlace(), false);
  } finally {
    global.window = original;
  }
});

// ---- BUG 2 / no-reload regression guard (R2.3, AC4.3) ----------------------
// The crux of T8: on the one-shot 'done' path, the in-place refresh hook
// fires but `window.location.reload()` is NEVER called, and
// `decideOneOffTerminalAction`'s `rescan: false` lock (the original BUG 2
// fix) still holds after T8's changes.

test('BUG 2 regression guard: window.location.reload is NOT called on the done-edge path while the refresh hook DID fire', () => {
  const original = global.window;
  let reloadCalls = 0;
  let refreshCalls = 0;
  global.window = {
    location: { reload: () => { reloadCalls += 1; } },
    __filetubeRefreshLibrary: () => { refreshCalls += 1; },
  };
  try {
    const seen = new Set();
    const snapshot = { oneShots: { jobA: { state: 'done' } } };

    // Mirrors injectDownloadStatusChip's pollOnce() wiring exactly: detect
    // the edge, mark it seen, then refresh iff newly-done.
    const newlyDone = detectNewlyDoneOneShots(snapshot, seen);
    newlyDone.forEach((id) => seen.add(id));
    if (newlyDone.length > 0) refreshLibraryInPlace();

    assert.strictEqual(refreshCalls, 1, 'the refresh hook must have fired exactly once for the newly-done job');
    assert.strictEqual(reloadCalls, 0, 'window.location.reload must NEVER be called on this path (BUG 2)');

    // The original BUG 2 fix's own lock: 'done' still never requests a
    // rescan (decideOneOffTerminalAction is the modal's terminal-action
    // reducer, independent of the chip's own done-edge trigger above -- both
    // must independently never reach for a reload).
    const action = decideOneOffTerminalAction({ state: 'done' });
    assert.strictEqual(action.rescan, false);
  } finally {
    global.window = original;
  }
});

// ---- main.js: exposes window.__filetubeRefreshLibrary === loadLibrary -----
// main.js's render pipeline (`init`/`loadLibrary`) lives entirely inside a
// private view-module IIFE with no jsdom/browser harness in this codebase --
// mirrors test/unit/library-toolbar-wiring.test.js's/test/unit/card-download-
// btn.test.js's established pattern for this exact situation: a structural,
// source-text regression lock read straight off the file's own source,
// rather than a full DOM simulation.

const MAIN_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'main.js');
const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');

test('main.js: init() exposes window.__filetubeRefreshLibrary as its own loadLibrary, the in-place refresh hook the chip calls on a one-shot\'s done edge', () => {
  const initMatch = /function init\(root\) \{([\s\S]*?)\n {2}function destroy/.exec(mainJs);
  assert.ok(initMatch, 'expected to find init(root) in main.js');
  const initBody = initMatch[1];

  assert.match(
    initBody,
    /window\.__filetubeRefreshLibrary = loadLibrary;/,
    'expected init() to expose loadLibrary as window.__filetubeRefreshLibrary'
  );

  // Must be set up before/alongside the initial mount call, not left
  // dangling after some later branch that might not always run.
  const hookIdx = initBody.indexOf('window.__filetubeRefreshLibrary = loadLibrary;');
  const initialCallIdx = initBody.lastIndexOf('loadLibrary();');
  assert.ok(hookIdx !== -1 && initialCallIdx !== -1 && hookIdx < initialCallIdx,
    'expected the hook to be exposed before init()\'s own initial loadLibrary() call');
});

test('main.js: async function loadLibrary() is declared inside init() (the hook always refers to a real, in-scope closure)', () => {
  const initMatch = /function init\(root\) \{([\s\S]*?)\n {2}function destroy/.exec(mainJs);
  const initBody = initMatch[1];
  assert.match(initBody, /async function loadLibrary\(\) \{/, 'expected loadLibrary to be declared inside init()');
});

// GF1 (post-gate QA suggestion, folded in as trivial): destroy() now clears
// window.__filetubeRefreshLibrary, which init() sets but nothing previously
// cleared on teardown.
test('main.js: destroy() clears window.__filetubeRefreshLibrary (GF1 QA suggestion -- init() sets it but nothing previously cleared it)', () => {
  const destroyMatch = /function destroy\(\) \{([\s\S]*?)\n {2}\}/.exec(mainJs);
  assert.ok(destroyMatch, 'expected to find destroy() in main.js');
  const destroyBody = destroyMatch[1];
  assert.match(
    destroyBody,
    /window\.__filetubeRefreshLibrary\s*=\s*null;/,
    'expected destroy() to clear window.__filetubeRefreshLibrary',
  );
});

// ---- v1.31 gate fix (FR5): repull-ack formatter ----------------------------
const { test: t31r } = require('node:test');
const a31r = require('node:assert');
const commonForRepull = require('../../public/js/common.js');

t31r('v1.31 FR5: formatRepullAckText surfaces busy/not-found and stays silent for started/unknown bodies', () => {
  a31r.equal(commonForRepull.formatRepullAckText({ accepted: true, started: false, reason: 'busy' }), 'Queued behind current run');
  a31r.equal(commonForRepull.formatRepullAckText({ started: false, reason: 'not-found' }), 'Channel not found');
  a31r.equal(commonForRepull.formatRepullAckText({ accepted: true, started: true }), '');
  a31r.equal(commonForRepull.formatRepullAckText(null), '');
  a31r.equal(commonForRepull.formatRepullAckText(undefined), '');
  a31r.equal(commonForRepull.formatRepullAckText('busy'), '');
});
