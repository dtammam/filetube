'use strict';

// [UNIT] v1.362.2 W2 (plan 2026-10-04-loupe-black-checks, D6) - the one-button log export. The pure strategy
// per arm; the REAL exportDiagnosticLog (common.js) with stubbed navigator.canShare / share / clipboard and a
// jsdom document for the download; the ONE formatter; and the REAL Settings buttons (setup.js
// wireLifecycleLogControls) on the real setup.html markup: Export calls navigator.share in the SAME click turn
// with one .txt File, and Clear removes the log only on the confirm's OK.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const common = require('../../public/js/common.js');
const setup = require('../../public/js/setup.js');

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');

// ---- pure: chooseLogExportStrategy -----------------------------------------------

test('chooseLogExportStrategy: file sharing first, then the clipboard, then a download', () => {
  const c = common.chooseLogExportStrategy;
  assert.strictEqual(typeof c, 'function', 'exported');
  assert.strictEqual(c({ canShareFiles: true, hasClipboard: true }), 'file');
  assert.strictEqual(c({ canShareFiles: true, hasClipboard: false }), 'file');
  assert.strictEqual(c({ canShareFiles: false, hasClipboard: true }), 'copy');
  assert.strictEqual(c({ canShareFiles: false, hasClipboard: false }), 'download');
  assert.strictEqual(c(), 'download');
});

// ---- the real helper, with the browser stubbed -----------------------------------

// Runs fn with navigator / document / window / URL globals pointing at a jsdom window, restored after.
async function withBrowser(navStub, fn) {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost/settings' });
  const w = dom.window;
  const toasts = [];
  w.ui = { toast: (msg, o) => { toasts.push({ msg, kind: o && o.kind }); return {}; } };
  const clicks = [];
  w.HTMLAnchorElement.prototype.click = function () { clicks.push({ href: this.href, download: this.download }); };
  const saved = {
    nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    doc: globalThis.document, win: globalThis.window,
    cou: URL.createObjectURL, rou: URL.revokeObjectURL,
  };
  Object.defineProperty(globalThis, 'navigator', { value: navStub, configurable: true, writable: true });
  globalThis.document = w.document;
  globalThis.window = w;
  const blobs = [];
  URL.createObjectURL = (b) => { blobs.push(b); return 'blob:x/' + blobs.length; };
  URL.revokeObjectURL = () => {};
  const origErr = console.error; console.error = () => {};
  try { return await fn({ w, toasts, clicks, blobs }); } finally {
    console.error = origErr;
    if (saved.nav) Object.defineProperty(globalThis, 'navigator', saved.nav); else delete globalThis.navigator;
    if (saved.doc === undefined) delete globalThis.document; else globalThis.document = saved.doc;
    if (saved.win === undefined) delete globalThis.window; else globalThis.window = saved.win;
    URL.createObjectURL = saved.cou; URL.revokeObjectURL = saved.rou;
    dom.window.close();
  }
}
function shareNav(o) {
  const calls = [];
  const nav = {
    canShare: (d) => !!(d && d.files && d.files.length === 1 && o.canShare !== false),
    share: (d) => { calls.push(d); return o.reject ? Promise.reject(o.reject) : Promise.resolve(); },
    clipboard: { writeText: (t) => { calls.push({ copied: t }); return Promise.resolve(); } },
  };
  return { nav, calls };
}

test('exportDiagnosticLog: file share - ONE text/plain File with the given name, share called synchronously; resolves shared, no toast', async () => {
  const { nav, calls } = shareNav({});
  await withBrowser(nav, async ({ toasts, clicks }) => {
    const p = common.exportDiagnosticLog({ filename: 'ft-lifecycle-20261004-101112.txt', text: 'line 1\nline 2\n', title: 'T' });
    assert.strictEqual(calls.length, 1, 'share was called before the helper returned (no await before it)');
    const files = calls[0].files;
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].name, 'ft-lifecycle-20261004-101112.txt');
    assert.strictEqual(files[0].type, 'text/plain');
    assert.strictEqual(await files[0].text(), 'line 1\nline 2\n');
    assert.strictEqual(await p, 'shared');
    assert.deepStrictEqual(toasts, []);
    assert.deepStrictEqual(clicks, []);
  });
});

test('exportDiagnosticLog: a dismissed sheet (AbortError) is not an error: shared, no download', async () => {
  const err = new Error('dismissed'); err.name = 'AbortError';
  const { nav } = shareNav({ reject: err });
  await withBrowser(nav, async ({ toasts, clicks }) => {
    assert.strictEqual(await common.exportDiagnosticLog({ filename: 'a.txt', text: 'x' }), 'shared');
    assert.deepStrictEqual(clicks, []);
    assert.deepStrictEqual(toasts, []);
  });
});

test('exportDiagnosticLog: a share that FAILS (not a dismissal) falls back to the download, with a toast', async () => {
  const err = new Error('no activation'); err.name = 'NotAllowedError';
  const { nav } = shareNav({ reject: err });
  await withBrowser(nav, async ({ toasts, clicks }) => {
    assert.strictEqual(await common.exportDiagnosticLog({ filename: 'a.txt', text: 'x' }), 'downloaded');
    assert.strictEqual(clicks.length, 1);
    assert.strictEqual(clicks[0].download, 'a.txt');
    assert.match(toasts[0].msg, /downloaded/);
  });
});

test('exportDiagnosticLog: no file sharing -> the clipboard gets the whole text; toast "copied"', async () => {
  const copied = [];
  const nav = { clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } };
  await withBrowser(nav, async ({ toasts, clicks }) => {
    const p = common.exportDiagnosticLog({ filename: 'a.txt', text: 'all of it' });
    assert.deepStrictEqual(copied, ['all of it'], 'written synchronously inside the call');
    assert.strictEqual(await p, 'copied');
    assert.match(toasts[0].msg, /copied/);
    assert.deepStrictEqual(clicks, []);
  });
});

test('exportDiagnosticLog: canShare refusing the file counts as no file sharing (the clipboard)', async () => {
  const { nav, calls } = shareNav({ canShare: false });
  await withBrowser(nav, async () => {
    assert.strictEqual(await common.exportDiagnosticLog({ filename: 'a.txt', text: 'x' }), 'copied');
    assert.ok(!calls.some((c) => c.files), 'share never called');
  });
});

test('exportDiagnosticLog: neither -> a Blob download named as given; a failed clipboard write downloads too', async () => {
  await withBrowser({}, async ({ toasts, clicks, blobs }) => {
    assert.strictEqual(await common.exportDiagnosticLog({ filename: 'b.txt', text: 'body' }), 'downloaded');
    assert.strictEqual(clicks.length, 1);
    assert.strictEqual(clicks[0].download, 'b.txt');
    assert.strictEqual(blobs[0].type, 'text/plain');
    assert.strictEqual(await blobs[0].text(), 'body');
    assert.match(toasts[0].msg, /downloaded as b\.txt/);
  });
  const nav = { clipboard: { writeText: () => Promise.reject(new Error('denied')) } };
  await withBrowser(nav, async ({ clicks }) => {
    assert.strictEqual(await common.exportDiagnosticLog({ filename: 'c.txt', text: 'x' }), 'downloaded');
    assert.strictEqual(clicks.length, 1);
  });
});

// ---- the formatter ---------------------------------------------------------------

test('formatLifecycleLogForExport: header fields, oldest first, ISO time to the ms, every detail in FULL', () => {
  const f = setup.formatLifecycleLogForExport;
  assert.strictEqual(typeof f, 'function', 'exported');
  const long = 'rs=4 '.repeat(200);
  const text = f([
    { type: 'media:play', detail: 'el=video via=picture-tap g=352', persisted: null, vis: 'visible', playing: true, t: Date.UTC(2026, 9, 4, 10, 0, 2, 7) },
    { type: 'video:frozen', detail: long, persisted: null, vis: 'visible', playing: true, t: Date.UTC(2026, 9, 4, 10, 0, 9, 450) },
    { type: 'pagehide', detail: null, persisted: true, vis: 'hidden', playing: false, t: Date.UTC(2026, 9, 4, 9, 59, 0, 0) },
  ], { exportedAt: Date.UTC(2026, 9, 4, 11, 0, 0, 0), version: '1.362.2', userAgent: 'UA/1', standalone: true });
  const lines = text.split('\n');
  assert.strictEqual(lines[0], 'FileTube lifecycle log');
  assert.strictEqual(lines[1], 'exported: 2026-10-04T11:00:00.000Z');
  assert.strictEqual(lines[2], 'version: 1.362.2');
  assert.strictEqual(lines[3], 'user agent: UA/1');
  assert.strictEqual(lines[4], 'mode: standalone app');
  assert.strictEqual(lines[5], 'entries: 3');
  assert.strictEqual(lines[6], '');
  assert.strictEqual(lines[7], '2026-10-04T09:59:00.000Z pagehide persisted=true vis=hidden playing=false', 'oldest first, no detail when absent');
  assert.strictEqual(lines[8], '2026-10-04T10:00:02.007Z media:play (el=video via=picture-tap g=352) persisted=null vis=visible playing=true');
  assert.strictEqual(lines[9], '2026-10-04T10:00:09.450Z video:frozen (' + long + ') persisted=null vis=visible playing=true', 'never cut');
  assert.match(f([], { standalone: false }), /mode: browser tab\nentries: 0\n/);
  assert.match(f(null, null), /entries: 0/);
});

test('lifecycleExportFilename: ft-lifecycle-<yyyymmdd-hhmmss>.txt in local time', () => {
  assert.strictEqual(setup.lifecycleExportFilename(new Date(2026, 9, 4, 7, 5, 9)), 'ft-lifecycle-20261004-070509.txt');
});

// ---- the real Settings buttons ----------------------------------------------------

async function settingsPage(navStub, o) {
  const opt = o || {};
  const dom = new JSDOM(SETUP_HTML.replace(/<script[\s\S]*?<\/script>/g, ''), { url: 'http://localhost/settings' });
  const w = dom.window;
  const meta = w.document.createElement('meta'); meta.name = 'ft-version'; meta.content = '1.362.2'; w.document.head.appendChild(meta);
  const confirms = [];
  const toasts = [];
  w.ui = {
    confirm: (c) => { confirms.push(c); return Promise.resolve(opt.answer === true); },
    toast: (m, k) => { toasts.push({ m, k }); return {}; },
  };
  w.matchMedia = () => ({ matches: false });
  Object.defineProperty(w.navigator, 'userAgent', { value: 'TestUA/1', configurable: true });
  return { dom, w, confirms, toasts };
}
async function withSettings(navStub, o, fn) {
  const page = await settingsPage(navStub, o);
  const saved = { nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), doc: globalThis.document, win: globalThis.window, e: globalThis.exportDiagnosticLog, v: globalThis.appVersionString };
  Object.defineProperty(globalThis, 'navigator', { value: navStub, configurable: true, writable: true });
  globalThis.document = page.w.document; globalThis.window = page.w;
  globalThis.exportDiagnosticLog = common.exportDiagnosticLog;
  globalThis.appVersionString = common.appVersionString;
  try { return await fn(page); } finally {
    if (saved.nav) Object.defineProperty(globalThis, 'navigator', saved.nav); else delete globalThis.navigator;
    for (const [k, v] of [['document', saved.doc], ['window', saved.win], ['exportDiagnosticLog', saved.e], ['appVersionString', saved.v]]) {
      if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
    }
    page.dom.window.close();
  }
}
const ENTRIES = [{ type: 'media:play', detail: 'el=video via=bar-button g=3', persisted: null, vis: 'visible', playing: true, t: 1759572000000 }, { type: 'media:rate', detail: 'rate=2 def=1', persisted: null, vis: 'visible', playing: true, t: 1759572001000 }];

test('setup.html: Export log and Clear log sit under the lifecycle switches, with the on-screen switch, in plain Settings buttons', () => {
  const doc = new JSDOM(SETUP_HTML).window.document;
  const exp = doc.getElementById('lifecycle-log-export-btn');
  const clr = doc.getElementById('lifecycle-log-clear-btn');
  assert.ok(exp && clr);
  assert.strictEqual(exp.textContent.trim(), 'Export log');
  assert.strictEqual(clr.textContent.trim(), 'Clear log');
  for (const b of [exp, clr]) assert.strictEqual(b.className, 'ui-btn ui-btn--secondary ui-btn--sm');
  const ov = doc.getElementById('debug-lifecycle-overlay-check');
  assert.ok(ov && ov.classList.contains('ui-switch'));
  assert.strictEqual(doc.querySelector('label[for="debug-lifecycle-overlay-check"]').textContent, 'Show the log on screen');
  const life = doc.getElementById('debug-lifecycle-check');
  assert.strictEqual(life.closest('.ui-list'), ov.closest('.ui-list'), 'the two switches share a list');
  assert.strictEqual(ov.closest('.ui-list').nextElementSibling, exp.closest('.action-bar'), 'the buttons follow the switches');
});

test('Export (real setup.js + common.js): one click shares ONE .txt File holding every entry, synchronously in the click', async () => {
  const { nav, calls } = shareNav({});
  await withSettings(nav, {}, async ({ w }) => {
    w.localStorage.setItem('ft-lifecycle-log', JSON.stringify(ENTRIES));
    setup.wireLifecycleLogControls(w);
    w.document.getElementById('lifecycle-log-export-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(calls.length, 1, 'share ran inside the click');
    const file = calls[0].files[0];
    assert.match(file.name, /^ft-lifecycle-\d{8}-\d{6}\.txt$/);
    const text = await file.text();
    assert.match(text, /^FileTube lifecycle log\n/);
    assert.match(text, /\nversion: 1\.362\.2\n/);
    assert.match(text, /\nuser agent: /);
    assert.match(text, /\nentries: 2\n/);
    assert.match(text, /media:play \(el=video via=bar-button g=3\)/);
    assert.match(text, /media:rate \(rate=2 def=1\)/);
  });
});

test('Export works with the log switch OFF (the log survives the switch); an empty log still exports a header', async () => {
  const { nav, calls } = shareNav({});
  await withSettings(nav, {}, async ({ w }) => {
    assert.strictEqual(w.localStorage.getItem('ft-debug-lifecycle'), null, 'precondition: switch off');
    w.localStorage.setItem('ft-lifecycle-log', JSON.stringify(ENTRIES));
    setup.wireLifecycleLogControls(w);
    w.document.getElementById('lifecycle-log-export-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert.match(await calls[0].files[0].text(), /entries: 2/);
    w.localStorage.removeItem('ft-lifecycle-log');
    w.document.getElementById('lifecycle-log-export-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert.match(await calls[1].files[0].text(), /entries: 0/);
  });
});

test('Clear asks first and clears ONLY on OK', async () => {
  for (const answer of [false, true]) {
    await withSettings({}, { answer }, async ({ w, confirms }) => {
      w.localStorage.setItem('ft-lifecycle-log', JSON.stringify(ENTRIES));
      setup.wireLifecycleLogControls(w);
      w.document.getElementById('lifecycle-log-clear-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      assert.strictEqual(confirms.length, 1, 'asked');
      assert.strictEqual(confirms[0].danger, true);
      assert.ok(w.localStorage.getItem('ft-lifecycle-log'), 'nothing cleared before the answer');
      await new Promise((r) => setTimeout(r, 0));
      assert.strictEqual(w.localStorage.getItem('ft-lifecycle-log') === null, answer, answer ? 'OK cleared it' : 'Cancel kept it');
    });
  }
});

test('the on-screen switch reflects and writes its own key (only the literal "1" is on)', async () => {
  await withSettings({}, {}, async ({ w }) => {
    const c = w.document.getElementById('debug-lifecycle-overlay-check');
    for (const raw of [null, '0', 'true']) {
      if (raw === null) w.localStorage.removeItem('ft-debug-lifecycle-overlay'); else w.localStorage.setItem('ft-debug-lifecycle-overlay', raw);
      c.checked = true;
      setup.loadDebugLifecycleOverlayControl(w);
      assert.strictEqual(c.checked, false, String(raw));
    }
    w.localStorage.setItem('ft-debug-lifecycle-overlay', '1');
    setup.loadDebugLifecycleOverlayControl(w);
    assert.strictEqual(c.checked, true);
    setup.wireLifecycleLogControls(w);
    c.checked = false; c.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.strictEqual(w.localStorage.getItem('ft-debug-lifecycle-overlay'), null);
    c.checked = true; c.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.strictEqual(w.localStorage.getItem('ft-debug-lifecycle-overlay'), '1');
  });
});

test('the keys match player.js exactly', () => {
  const P = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
  const S = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
  assert.match(P, /var LIFECYCLE_LOG_STORAGE_KEY = 'ft-lifecycle-log';/);
  assert.match(S, /const LIFECYCLE_LOG_STORAGE_KEY = 'ft-lifecycle-log';/);
  assert.match(P, /var DEBUG_LIFECYCLE_OVERLAY_STORAGE_KEY = 'ft-debug-lifecycle-overlay';/);
  assert.match(S, /const DEBUG_LIFECYCLE_OVERLAY_STORAGE_KEY = 'ft-debug-lifecycle-overlay';/);
});

test('the log never leaves by a network call: no fetch / sendBeacon / XHR in the export path (security)', () => {
  const C = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  const S = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
  const slice = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
  const exp = slice(C, 'function chooseLogExportStrategy(', '// Sweep S9 (F56)');
  const set = slice(S, 'const LIFECYCLE_LOG_STORAGE_KEY', '// Prefills the checkbox from whatever');
  for (const [n, code] of [['common.js export', exp], ['setup.js controls', set]]) {
    assert.ok(code.length > 500, n + ' found');
    assert.ok(!/\bfetch\(|sendBeacon|XMLHttpRequest|WebSocket/.test(code), n + ': no network call');
  }
});

test('gate r1: turning EITHER switch off takes the on-screen panel down at once (it caught taps until a reload)', async () => {
  for (const id of ['debug-lifecycle-check', 'debug-lifecycle-overlay-check']) {
    await withSettings({}, {}, async ({ w }) => {
      const panel = w.document.createElement('div'); panel.id = 'ft-lifecycle-overlay'; w.document.body.appendChild(panel);
      setup.wireLifecycleLogControls(w);
      const c = w.document.getElementById(id);
      c.checked = true; c.dispatchEvent(new w.Event('change', { bubbles: true }));
      assert.ok(w.document.getElementById('ft-lifecycle-overlay'), id + ' ON keeps it');
      c.checked = false; c.dispatchEvent(new w.Event('change', { bubbles: true }));
      assert.strictEqual(w.document.getElementById('ft-lifecycle-overlay'), null, id + ' OFF removes it');
    });
  }
});

test('gate r1 (mutant E13): the export header says standalone app when the page runs as one', async () => {
  const { nav, calls } = shareNav({});
  await withSettings(nav, {}, async ({ w }) => {
    w.matchMedia = (q) => ({ matches: /display-mode: standalone/.test(q) });
    setup.wireLifecycleLogControls(w);
    w.document.getElementById('lifecycle-log-export-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert.match(await calls[0].files[0].text(), /\nmode: standalone app\n/);
  });
});

// ---- v1.362.3 (E3): Settings > Troubleshooting > "No glyph on picture taps" ----------------------------

test('E3: the no-glyph switch sits in Troubleshooting, reflects its key (only the literal "1" is on) and writes it', async () => {
  const doc = new JSDOM(SETUP_HTML).window.document;
  const c0 = doc.getElementById('debug-no-tap-glyph-check');
  assert.ok(c0 && c0.classList.contains('ui-switch'));
  assert.strictEqual(doc.querySelector('label[for="debug-no-tap-glyph-check"]').textContent, 'No glyph on picture taps');
  assert.strictEqual(c0.closest('details').getAttribute('data-collapse-key'), 'troubleshooting');
  await withSettings({}, {}, async ({ w }) => {
    const c = w.document.getElementById('debug-no-tap-glyph-check');
    for (const raw of [null, '0', 'true']) {
      if (raw === null) w.localStorage.removeItem('ft-debug-no-tap-glyph'); else w.localStorage.setItem('ft-debug-no-tap-glyph', raw);
      c.checked = true;
      setup.loadNoTapGlyphControl(w);
      assert.strictEqual(c.checked, false, String(raw));
    }
    w.localStorage.setItem('ft-debug-no-tap-glyph', '1');
    setup.loadNoTapGlyphControl(w);
    assert.strictEqual(c.checked, true);
    setup.wireNoTapGlyphControl(w);
    c.checked = false; c.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.strictEqual(w.localStorage.getItem('ft-debug-no-tap-glyph'), null);
    c.checked = true; c.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.strictEqual(w.localStorage.getItem('ft-debug-no-tap-glyph'), '1');
  });
  const P = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
  const S = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
  assert.match(P, /var NO_TAP_GLYPH_STORAGE_KEY = 'ft-debug-no-tap-glyph';/);
  assert.match(S, /const NO_TAP_GLYPH_STORAGE_KEY = 'ft-debug-no-tap-glyph';/);
});
