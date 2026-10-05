'use strict';

// [UNIT] v1.364.0 W1 (plan 2026-10-05-small-phones-pocket-downloads-vr) - the boot error recorder. A phone that
// cannot run the app's scripts shows the static frame and nothing else (Dean's iPhone SE on iOS 15.8.5, ROADMAP
// "Small phones"), and it may never reach Settings to switch a log on. So EVERY app shell carries the same tiny
// ES5 recorder as its FIRST head script, always on; Settings > Troubleshooting > Export error log and the
// standalone /errors.html take the log off the phone (docs/references/log-collection-pattern.md).
//
// Bound here: the shell census (the shell-parity discovery: every public/*.html that loads common.js, plus the
// module-served /subscriptions shell, with a floor so a rename cannot empty it); first-head-script placement;
// byte-identical copies; ES5 only (acorn at ecmaVersion 5 - acorn ships with eslint's espree); the recorder RUN in
// a vm with a throwing localStorage (nothing escapes) and with 60 errors (exactly 50 kept, newest last, under
// 64 KB); the Settings buttons on the real setup.html with the real common.js helper; and /errors.html (no app
// script, ES5, the same key).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');
const common = require('../../public/js/common.js');
const setup = require('../../public/js/setup.js');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const COMMON = '<script src="/js/common.js"></script>';
const MARKER = '/* ft-boot-errors v1 ';
const KEY = 'ft-boot-errors';

const SHELLS = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html')
  && fs.readFileSync(path.join(PUBLIC, f), 'utf8').includes(COMMON)).map((f) => path.join('public', f))
  .concat([path.join('lib', 'ytdlp', 'views', 'subscriptions.html')]);

function headOf(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const end = html.search(/<\/head>/i);
  assert.ok(end > 0, rel + ' has a </head>');
  return html.slice(0, end);
}
// The first <script> element in the head, whole (tags included), and its body.
function firstHeadScript(rel) {
  const m = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(headOf(rel));
  assert.ok(m, rel + ' has a head script');
  return { tag: m[0], body: m[1] };
}

test('the shell census finds every app shell (a rename cannot empty the guard)', () => {
  assert.ok(SHELLS.length >= 13, 'found ' + SHELLS.length);
  for (const f of ['index.html', 'watch.html', 'music.html', 'setup.html', 'login.html', 'books.html', 'podcasts.html', 'tv.html', 'history.html', 'read.html', 'stats.html', 'welcome.html']) {
    assert.ok(SHELLS.includes(path.join('public', f)), f);
  }
  assert.ok(SHELLS.includes(path.join('lib', 'ytdlp', 'views', 'subscriptions.html')));
});

for (const rel of SHELLS) {
  test(rel + ': the boot error recorder is the FIRST head script, exactly once', () => {
    const first = firstHeadScript(rel);
    assert.ok(first.body.startsWith(MARKER), rel + ': the first head script is the recorder, got ' + first.tag.slice(0, 60));
    assert.strictEqual(first.tag.indexOf('<script>'), 0, 'a plain inline script (no src, no type)');
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.strictEqual(html.split(MARKER).length - 1, 1, 'exactly once');
  });
}

test('every shell carries a byte-identical recorder', () => {
  const ref = firstHeadScript(SHELLS[0]).tag;
  for (const rel of SHELLS) assert.strictEqual(firstHeadScript(rel).tag, ref, rel + ' differs from ' + SHELLS[0]);
});

test('the recorder is ES5 (iOS 15 and older engines must parse it): acorn ecmaVersion 5 accepts it, and refuses ES2015', () => {
  const body = firstHeadScript(SHELLS[0]).body;
  assert.doesNotThrow(() => acorn.parse(body, { ecmaVersion: 5 }));
  // Non-vacuity: the same parser refuses the shapes an ES2015 edit would bring.
  for (const bad of ['let a = 1;', 'var f = () => 1;', 'var s = `x`;', 'const c = 1;']) {
    assert.throws(() => acorn.parse(body + bad, { ecmaVersion: 5 }), bad);
  }
});

// ---- the recorder RUN in a vm ------------------------------------------------------

function makeWindow(o) {
  const opt = o || {};
  const store = new Map();
  const handlers = {};
  const w = {
    location: { pathname: '/music' },
    document: { querySelector: (sel) => (sel === 'meta[name=ft-version]' && opt.version ? { getAttribute: () => opt.version } : null) },
    addEventListener: (type, fn, capture) => { (handlers[type] = handlers[type] || []).push({ fn, capture }); },
    localStorage: opt.throwingStorage ? {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('QuotaExceededError'); },
    } : {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
    },
  };
  return { w, store, handlers };
}
function runRecorder(w) {
  const body = firstHeadScript(SHELLS[0]).body;
  vm.runInNewContext(body, { window: w, JSON, Date, String, Array });
}
function fire(handlers, type, ev) { for (const h of handlers[type] || []) h.fn(ev); }
function logOf(store) { return JSON.parse(store.get(KEY)); }

test('recorder: listens for error (CAPTURE, so a failed script load is seen) and unhandledrejection', () => {
  const { w, handlers } = makeWindow();
  runRecorder(w);
  assert.strictEqual((handlers.error || []).length, 1);
  assert.strictEqual(handlers.error[0].capture, true);
  assert.strictEqual((handlers.unhandledrejection || []).length, 1);
});

test('recorder: an error records message, file, line, column, the stack cut to 600, path, version and ISO time', () => {
  const { w, store, handlers } = makeWindow({ version: '1.364.0' });
  runRecorder(w);
  const stack = 'TypeError: x\n' + 'at f '.repeat(300);
  fire(handlers, 'error', { target: w, message: 'TypeError: undefined is not a function', filename: 'https://h/js/main.js', lineno: 12, colno: 34, error: { stack } });
  const log = logOf(store);
  assert.strictEqual(log.length, 1);
  const e = log[0];
  assert.strictEqual(e.kind, 'error');
  assert.strictEqual(e.msg, 'TypeError: undefined is not a function');
  assert.strictEqual(e.src, 'https://h/js/main.js');
  assert.strictEqual(e.line, 12);
  assert.strictEqual(e.col, 34);
  assert.strictEqual(e.stack.length, 600);
  assert.strictEqual(e.path, '/music');
  assert.strictEqual(e.v, '1.364.0');
  assert.match(e.t, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test('recorder: a script or stylesheet that fails to load is recorded; a broken image is not (thumbnails would flood it)', () => {
  const { w, store, handlers } = makeWindow();
  runRecorder(w);
  fire(handlers, 'error', { target: { nodeName: 'IMG', src: '/thumb/1.jpg' } });
  assert.strictEqual(store.has(KEY), false, 'an image error writes nothing');
  fire(handlers, 'error', { target: { nodeName: 'SCRIPT', src: '/js/main.js' } });
  fire(handlers, 'error', { target: { nodeName: 'LINK', href: '/css/style.css' } });
  const log = logOf(store);
  assert.deepStrictEqual(log.map((e) => [e.kind, e.msg, e.src]), [
    ['resource', 'failed to load script', '/js/main.js'],
    ['resource', 'failed to load link', '/css/style.css'],
  ]);
});

test('recorder: an unhandled rejection records its reason (an Error or a bare value)', () => {
  const { w, store, handlers } = makeWindow();
  runRecorder(w);
  fire(handlers, 'unhandledrejection', { reason: { message: 'boom', stack: 'Error: boom\n at x' } });
  fire(handlers, 'unhandledrejection', { reason: 'plain' });
  const log = logOf(store);
  assert.deepStrictEqual(log.map((e) => [e.kind, e.msg]), [['rejection', 'boom'], ['rejection', 'plain']]);
  assert.strictEqual(log[0].stack, 'Error: boom\n at x');
});

test('recorder: 60 errors keep EXACTLY the last 50, oldest first, newest last', () => {
  const { w, store, handlers } = makeWindow();
  runRecorder(w);
  for (let i = 0; i < 60; i++) fire(handlers, 'error', { target: w, message: 'e' + i, filename: 'f.js', lineno: i, colno: 0 });
  const log = logOf(store);
  assert.strictEqual(log.length, 50);
  assert.strictEqual(log[0].msg, 'e10');
  assert.strictEqual(log[49].msg, 'e59');
});

test('recorder: the stored JSON stays under 64 KB even with the largest entries', () => {
  const { w, store, handlers } = makeWindow();
  runRecorder(w);
  const big = 'x'.repeat(5000);
  for (let i = 0; i < 60; i++) fire(handlers, 'error', { target: w, message: big, filename: big, lineno: 1, colno: 1, error: { stack: big } });
  const raw = store.get(KEY);
  assert.ok(raw.length <= 64000, 'stored ' + raw.length);
  const log = JSON.parse(raw);
  assert.ok(log.length >= 10 && log.length < 50, 'the size cap trimmed it: ' + log.length);
  assert.strictEqual(log[0].msg.length, 300, 'message cut to 300');
});

test('recorder: a throwing localStorage (private mode, locked-down storage) never lets an error escape', () => {
  const { w, handlers } = makeWindow({ throwingStorage: true });
  assert.doesNotThrow(() => runRecorder(w));
  assert.doesNotThrow(() => fire(handlers, 'error', { target: w, message: 'm', filename: 'f', lineno: 1, colno: 1 }));
  assert.doesNotThrow(() => fire(handlers, 'unhandledrejection', { reason: null }));
  assert.doesNotThrow(() => fire(handlers, 'error', null));
});

test('recorder: a corrupt stored log is replaced, not thrown on', () => {
  const { w, store, handlers } = makeWindow();
  store.set(KEY, '{not json');
  runRecorder(w);
  fire(handlers, 'error', { target: w, message: 'after', filename: 'f', lineno: 1, colno: 1 });
  assert.deepStrictEqual(logOf(store).map((e) => e.msg), ['after']);
  store.set(KEY, '{"a":1}');
  fire(handlers, 'error', { target: w, message: 'again', filename: 'f', lineno: 1, colno: 1 });
  assert.deepStrictEqual(logOf(store).map((e) => e.msg), ['again']);
});

test('recorder: a window without addEventListener does not throw (the IIFE guards its own wiring)', () => {
  const body = firstHeadScript(SHELLS[0]).body;
  assert.doesNotThrow(() => vm.runInNewContext(body, { window: {}, JSON, Date, String, Array }));
});

// ---- Settings > Troubleshooting: Export error log / Clear error log -----------------

const SETUP_HTML = fs.readFileSync(path.join(PUBLIC, 'setup.html'), 'utf8');

async function withSettings(navStub, o, fn) {
  const opt = o || {};
  const dom = new JSDOM(SETUP_HTML.replace(/<script[\s\S]*?<\/script>/g, ''), { url: 'http://localhost/settings' });
  const w = dom.window;
  const meta = w.document.createElement('meta'); meta.name = 'ft-version'; meta.content = '1.364.0'; w.document.head.appendChild(meta);
  const confirms = [];
  w.ui = {
    confirm: (c) => { confirms.push(c); return Promise.resolve(opt.answer === true); },
    toast: () => ({}),
  };
  w.matchMedia = () => ({ matches: false });
  Object.defineProperty(w.navigator, 'userAgent', { value: 'TestUA/15', configurable: true });
  const saved = { nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), doc: globalThis.document, win: globalThis.window, e: globalThis.exportDiagnosticLog, v: globalThis.appVersionString };
  Object.defineProperty(globalThis, 'navigator', { value: navStub, configurable: true, writable: true });
  globalThis.document = w.document; globalThis.window = w;
  globalThis.exportDiagnosticLog = common.exportDiagnosticLog;
  globalThis.appVersionString = common.appVersionString;
  try { return await fn({ w, confirms }); } finally {
    if (saved.nav) Object.defineProperty(globalThis, 'navigator', saved.nav); else delete globalThis.navigator;
    for (const [k, v] of [['document', saved.doc], ['window', saved.win], ['exportDiagnosticLog', saved.e], ['appVersionString', saved.v]]) {
      if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
    }
    dom.window.close();
  }
}
function shareNav() {
  const calls = [];
  return {
    calls,
    nav: {
      canShare: (d) => !!(d && d.files && d.files.length === 1),
      share: (d) => { calls.push(d); return Promise.resolve(); },
      clipboard: { writeText: (t) => { calls.push({ copied: t }); return Promise.resolve(); } },
    },
  };
}
const ENTRIES = [
  { kind: 'error', msg: 'TypeError: a is not a function', src: 'https://h/js/main.js', line: 3, col: 9, stack: 'TypeError: a\n    at init (main.js:3:9)', path: '/', v: '1.364.0', t: '2026-10-05T10:00:00.000Z' },
  { kind: 'resource', msg: 'failed to load script', src: '/js/music.js', path: '/music', v: '1.364.0', t: '2026-10-05T10:00:01.000Z' },
];

test('setup.html: Export error log and Clear error log are plain Settings buttons in Troubleshooting', () => {
  const doc = new JSDOM(SETUP_HTML).window.document;
  const exp = doc.getElementById('boot-error-log-export-btn');
  const clr = doc.getElementById('boot-error-log-clear-btn');
  assert.ok(exp && clr);
  assert.strictEqual(exp.textContent.trim(), 'Export error log');
  assert.strictEqual(clr.textContent.trim(), 'Clear error log');
  for (const b of [exp, clr]) assert.strictEqual(b.className, 'ui-btn ui-btn--secondary ui-btn--sm');
  assert.strictEqual(exp.closest('details').getAttribute('data-collapse-key'), 'troubleshooting');
});

test('the error log copy is honest about storage (qa gate r1): /errors.html reads THIS browser only; a Home Screen app keeps its own log', () => {
  const note = new JSDOM(SETUP_HTML).window.document.getElementById('boot-error-log-note');
  assert.ok(note, 'the Settings note exists');
  const t = note.textContent;
  assert.match(t, /open \/errors\.html in a Safari tab/, 'the fallback names a Safari tab');
  assert.match(t, /Home Screen keeps its own log/, 'and says the Home Screen app keeps its own');
  assert.match(t, /only its own Settings > Export error log can reach it/);
  assert.doesNotMatch(t, /address bar/, 'the Home Screen app has no address bar');
  const edoc = new JSDOM(ERRORS_HTML).window.document;
  assert.match(edoc.getElementById('errors-scope').textContent, /this browser only[\s\S]*Home Screen keeps its own log/);
  assert.doesNotMatch(ERRORS_HTML, /on this device/, 'errors.html never claims the whole device');
});

test('formatBootErrorLogForExport: the pattern header, then one line per entry oldest first with every field', () => {
  const text = setup.formatBootErrorLogForExport(ENTRIES, { exportedAt: Date.UTC(2026, 9, 5, 11), version: '1.364.0', userAgent: 'UA/15', standalone: true });
  const lines = text.split('\n');
  assert.deepStrictEqual(lines.slice(0, 7), ['FileTube error log', 'exported: 2026-10-05T11:00:00.000Z', 'version: 1.364.0', 'user agent: UA/15', 'mode: standalone app', 'entries: 2', '']);
  assert.strictEqual(lines[7], '2026-10-05T10:00:00.000Z error v1.364.0 on /: TypeError: a is not a function at https://h/js/main.js:3:9');
  assert.strictEqual(lines[8], '    TypeError: a');
  assert.strictEqual(lines[9], '        at init (main.js:3:9)');
  assert.strictEqual(lines[10], '2026-10-05T10:00:01.000Z resource v1.364.0 on /music: failed to load script at /js/music.js');
  assert.match(setup.formatBootErrorLogForExport(null, null), /\nexported: -\n[\s\S]*\nentries: 0\n\n$/);
  assert.strictEqual(setup.bootErrorExportFilename(new Date(2026, 9, 5, 7, 5, 9)), 'ft-errors-20261005-070509.txt');
});

test('Export error log (real setup.js + common.js): one click shares ONE .txt File holding every entry, in the click', async () => {
  const { nav, calls } = shareNav();
  await withSettings(nav, {}, async ({ w }) => {
    w.localStorage.setItem(KEY, JSON.stringify(ENTRIES));
    setup.wireBootErrorLogControls(w);
    w.document.getElementById('boot-error-log-export-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(calls.length, 1, 'share ran inside the click');
    const file = calls[0].files[0];
    assert.match(file.name, /^ft-errors-\d{8}-\d{6}\.txt$/);
    const text = await file.text();
    assert.match(text, /^FileTube error log\n/);
    assert.match(text, /\nversion: 1\.364\.0\n/);
    assert.match(text, /\nentries: 2\n/);
    assert.match(text, /TypeError: a is not a function at https:\/\/h\/js\/main\.js:3:9/);
  });
});

test('Clear error log asks first and clears ONLY on OK', async () => {
  for (const answer of [false, true]) {
    await withSettings({}, { answer }, async ({ w, confirms }) => {
      w.localStorage.setItem(KEY, JSON.stringify(ENTRIES));
      setup.wireBootErrorLogControls(w);
      w.document.getElementById('boot-error-log-clear-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      assert.strictEqual(confirms.length, 1, 'asked');
      assert.strictEqual(confirms[0].danger, true);
      assert.ok(w.localStorage.getItem(KEY), 'nothing cleared before the answer');
      await new Promise((r) => setTimeout(r, 0));
      assert.strictEqual(w.localStorage.getItem(KEY) === null, answer, answer ? 'OK cleared it' : 'Cancel kept it');
    });
  }
});

test('setup.js wires the error log buttons in its init (the enabling wire)', () => {
  const S = fs.readFileSync(path.join(PUBLIC, 'js', 'setup.js'), 'utf8');
  assert.match(S, /\n {2}wireBootErrorLogControls\(window, signal\);/);
  assert.match(S, /const BOOT_ERROR_LOG_STORAGE_KEY = 'ft-boot-errors';/);
});

// ---- /errors.html: the standalone exporter ------------------------------------------

const ERRORS_HTML = fs.readFileSync(path.join(PUBLIC, 'errors.html'), 'utf8');

test('/errors.html loads NO app script (common.js may be what fails) and its one inline script is ES5', () => {
  assert.doesNotMatch(ERRORS_HTML, /<script\b[^>]*\bsrc=/i, 'no external script');
  const scripts = [...ERRORS_HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.strictEqual(scripts.length, 1);
  assert.doesNotThrow(() => acorn.parse(scripts[0][1], { ecmaVersion: 5 }));
  assert.match(scripts[0][1], /var KEY = 'ft-boot-errors';/);
});

function errorsPage(navStub, entries) {
  const dom = new JSDOM(ERRORS_HTML, { url: 'http://localhost/errors.html', runScripts: 'outside-only' });
  const w = dom.window;
  if (entries) w.localStorage.setItem(KEY, JSON.stringify(entries));
  Object.defineProperty(w, 'navigator', { value: Object.assign({ userAgent: 'UA/15' }, navStub), configurable: true });
  const clicks = [];
  w.HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
  w.URL.createObjectURL = () => 'blob:x';
  w.URL.revokeObjectURL = () => {};
  const body = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(ERRORS_HTML)[1];
  w.eval(body);
  return { dom, w, clicks };
}

test('/errors.html: shows the count and the log, and Export shares a .txt File inside the click', async () => {
  const { nav, calls } = shareNav();
  const { w, dom } = errorsPage(nav, ENTRIES);
  assert.match(w.document.getElementById('errors-count').textContent, /^2 errors recorded in this browser /);
  assert.match(w.document.getElementById('errors-text').textContent, /failed to load script at \/js\/music\.js/);
  w.document.getElementById('errors-export-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(calls.length, 1, 'share ran inside the click');
  assert.match(calls[0].files[0].name, /^ft-errors-\d{8}-\d{6}\.txt$/);
  assert.match(await calls[0].files[0].text(), /^FileTube error log\n[\s\S]*\nentries: 2\n/);
  await new Promise((r) => setTimeout(r, 0));
  dom.window.close();
});

test('/errors.html: no file sharing -> the clipboard; neither -> a download', async () => {
  const copied = [];
  const a = errorsPage({ clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } }, ENTRIES);
  a.w.document.getElementById('errors-export-btn').dispatchEvent(new a.w.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(copied.length, 1);
  assert.match(copied[0], /entries: 2/);
  await new Promise((r) => setTimeout(r, 0));
  assert.match(a.w.document.getElementById('errors-status').textContent, /^Copied/);
  a.dom.window.close();
  const b = errorsPage({}, []);
  assert.match(b.w.document.getElementById('errors-count').textContent, /^No errors recorded in this browser\.$/);
  b.w.document.getElementById('errors-export-btn').dispatchEvent(new b.w.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(b.clicks.length, 1);
  assert.match(b.clicks[0], /^ft-errors-\d{8}-\d{6}\.txt$/);
  b.dom.window.close();
});
