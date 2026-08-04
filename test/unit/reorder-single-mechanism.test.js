'use strict';

// [UNIT] v1.76 T8 - ONE reorder mechanism, and no way back to two.
//
// Dean's ruling for this wave was "let's triple the blast radius, let's do it
// right": every reorder surface moves onto the shared pointer gesture layer,
// not just the two he reported. The risk that creates is a partial migration -
// a surface left on native HTML5 drag, or a row that carries BOTH mechanisms
// (which is not merely redundant: the browser starting a native drag CANCELS
// the pointer gesture, so the row silently stops reordering).
//
// So this file is a census, not a spot check. It is derived from the files
// themselves - it never hard-codes what "the surfaces" are - and it strips
// comments first, because every one of these files legitimately DISCUSSES the
// mechanism it no longer uses.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '../..');
const SCANNED_DIRS = ['public/js', 'lib/ytdlp/client'];

// Every .js file that could carry a reorder surface, discovered not listed.
const FILES = SCANNED_DIRS.flatMap((dir) => {
  const abs = path.join(REPO, dir);
  return fs.readdirSync(abs)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ rel: `${dir}/${f}`, source: fs.readFileSync(path.join(abs, f), 'utf8') }));
});

test('the census scans a plausible number of files (a broken discovery walk proves nothing)', () => {
  // Self-check: an empty or near-empty FILES list would make every assertion
  // below vacuously pass.
  assert.ok(FILES.length >= 10, `expected the client tree to be scanned, got ${FILES.length} files`);
  assert.ok(FILES.some((f) => f.rel === 'public/js/common.js'));
  assert.ok(FILES.some((f) => f.rel === 'lib/ytdlp/client/subscriptions.js'));
});

// Comments are stripped: these files describe the retired mechanism at length,
// and prose must never fail a code lock (nor hide one).
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('stripComments really removes both comment forms (the lock must not be self-defeating)', () => {
  const sample = "/* draggable = true */\nconst a = 1; // draggable = true\nconst b = 'draggable';";
  const out = stripComments(sample);
  assert.ok(!out.includes('/*'));
  assert.ok(!/\/\/ draggable/.test(out));
  assert.ok(out.includes("'draggable'"), 'real code survives');
});

// The native HTML5 drag mechanism, in every spelling this tree ever used.
const HTML5_DRAG_PATTERNS = [
  { name: "addEventListener('dragstart'|'dragover'|'dragleave'|'dragend')", re: /addEventListener\(\s*['"]drag[a-z]*['"]/ },
  { name: "addEventListener('drop')", re: /addEventListener\(\s*['"]drop['"]/ },
  { name: 'draggable="true" in a template', re: /draggable\s*=\s*\\?["']true\\?["']/ },
  { name: "setAttribute('draggable', ...)", re: /setAttribute\(\s*['"]draggable['"]/ },
  { name: '.draggable = true', re: /\.draggable\s*=\s*true/ },
  { name: 'DataTransfer use', re: /dataTransfer/ },
];

for (const pattern of HTML5_DRAG_PATTERNS) {
  test(`v1.76: no client file uses native HTML5 drag any more - ${pattern.name}`, () => {
    const offenders = FILES
      .map((f) => ({ rel: f.rel, code: stripComments(f.source) }))
      .filter((f) => pattern.re.test(f.code))
      .map((f) => f.rel);
    assert.deepEqual(offenders, [], `native HTML5 drag survives in: ${offenders.join(', ')}`);
  });
}

test('v1.76: the lock would actually catch a relapse (mutation self-proof)', () => {
  // A lock that cannot fail is not a lock. Feed it the exact code the wave
  // deleted and confirm every pattern fires.
  const relapse = `
    row.setAttribute('draggable', 'true');
    row.draggable = true;
    const html = '<a class="sidebar-item" draggable="true"></a>';
    el.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('drop', (e) => e.preventDefault());
  `;
  const unmatched = HTML5_DRAG_PATTERNS.filter((p) => !p.re.test(relapse)).map((p) => p.name);
  assert.deepEqual(unmatched, [], `these patterns would not catch a relapse: ${unmatched.join(', ')}`);
});

// ---- and every surface is on the shared layer -------------------------------

// Derived from the source: which files declare a reorder surface, and which
// rows each one wires.
const ROW_SELECTORS = FILES.flatMap((f) =>
  Array.from(stripComments(f.source).matchAll(/rowSelector:\s*'([^']+)'/g)).map((m) => ({ file: f.rel, selector: m[1] }))
);

test('v1.76: exactly the six known reorder surfaces are wired, each through the shared layer', () => {
  // If a seventh appears, this fails and the author has to say what it is -
  // which is the point. If one DISAPPEARS, a surface silently lost its
  // reordering, which is the failure this wave could most easily have caused.
  assert.deepEqual(ROW_SELECTORS.slice().sort((a, b) => (a.file + a.selector).localeCompare(b.file + b.selector)), [
    { file: 'lib/ytdlp/client/subscriptions.js', selector: '.sub-row[data-sub-id]' },
    { file: 'public/js/common.js', selector: '.sidebar-item[data-pin-id]' },
    { file: 'public/js/main.js', selector: '.sidebar-item[data-index]' },
    { file: 'public/js/setup.js', selector: '.bottombar-editor-row' },
    { file: 'public/js/setup.js', selector: '.folder-item-row' },
    { file: 'public/js/setup.js', selector: '.sidebar-item[data-index]' },
  ]);
});

test('v1.76: every wired surface names a real onReorder, never a bare selector', () => {
  // Guards the shape the helper silently ignores: `wireReorderable` returns
  // early without an `onReorder`, so a surface could look wired and do
  // nothing.
  for (const f of FILES) {
    const code = stripComments(f.source);
    const wired = (code.match(/rowSelector:/g) || []).length;
    if (wired === 0) continue;
    const handlers = (code.match(/onReorder:/g) || []).length;
    assert.equal(handlers, wired, `${f.rel}: ${wired} wired surface(s) but ${handlers} onReorder handler(s)`);
  }
});

test('v1.76: only the two Settings lists opt into keyboard reorder', () => {
  // `handleSelector` is what wires arrow keys. The sidebar surfaces are <a>
  // links where that would hijack focus scrolling, so they must NOT pass one -
  // and the two lists whose up/down buttons were deleted MUST.
  const withHandles = FILES
    .flatMap((f) => Array.from(stripComments(f.source).matchAll(/handleSelector:\s*'([^']+)'/g)).map(() => f.rel))
    .sort();
  assert.deepEqual(withHandles, ['public/js/setup.js', 'public/js/setup.js'],
    'exactly the bottom-bar editor and the configured-directories list');
});
