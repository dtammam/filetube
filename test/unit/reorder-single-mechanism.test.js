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
// QA gate S3: the .js directories are not "the whole client tree" - inline
// <script> blocks in the HTML shells are client code too, and a relapse there
// would have been invisible. Both are scanned now, and the claim in this
// file's header matches what it actually does.
const SCANNED_DIRS = ['public/js', 'lib/ytdlp/client', 'public', 'lib/ytdlp/views'];

const FILES = SCANNED_DIRS.flatMap((dir) => {
  const abs = path.join(REPO, dir);
  return fs.readdirSync(abs)
    .filter((f) => f.endsWith('.js') || f.endsWith('.html'))
    .map((f) => ({ rel: `${dir}/${f}`, source: fs.readFileSync(path.join(abs, f), 'utf8') }));
});

test('the census scans a plausible number of files (a broken discovery walk proves nothing)', () => {
  // Self-check: an empty or near-empty FILES list would make every assertion
  // below vacuously pass.
  assert.ok(FILES.length >= 20, `expected the client tree to be scanned, got ${FILES.length} files`);
  for (const rel of ['public/js/common.js', 'lib/ytdlp/client/subscriptions.js',
    'public/setup.html', 'lib/ytdlp/views/subscriptions.html']) {
    assert.ok(FILES.some((f) => f.rel === rel), `${rel} must be in the census`);
  }
  assert.ok(FILES.some((f) => f.rel.endsWith('.html')), 'the HTML shells are scanned, not just the .js files');
});

// Comments are stripped: these files describe the retired mechanism at length,
// and prose must never fail a code lock (nor hide one). HTML comments too
// (QA delta S3) - the census scans the HTML shells now, so an
// `<!-- the old rows used draggable="true" -->` would otherwise be a false
// positive that fails the build for a sentence.
function stripComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('stripComments removes all three comment forms (the lock must not be self-defeating)', () => {
  const sample = "/* draggable = true */\nconst a = 1; // draggable = true\nconst b = 'draggable';";
  const out = stripComments(sample);
  assert.ok(!out.includes('/*'));
  assert.ok(!/\/\/ draggable/.test(out));
  assert.ok(out.includes("'draggable'"), 'real code survives');
  // QA delta S3: an HTML comment must not read as a relapse.
  const html = '<!-- the old rows used draggable="true" -->\n<div class="row"></div>';
  const strippedHtml = stripComments(html);
  assert.ok(!/draggable/.test(strippedHtml), 'HTML prose is stripped');
  assert.ok(strippedHtml.includes('class="row"'), 'real markup survives');
});

// The native HTML5 drag mechanism, in every spelling this tree ever used.
const HTML5_DRAG_PATTERNS = [
  { name: "addEventListener('dragstart'|'dragover'|'dragleave'|'dragend')", re: /addEventListener\(\s*['"]drag[a-z]*['"]/ },
  { name: "addEventListener('drop')", re: /addEventListener\(\s*['"]drop['"]/ },
  { name: 'draggable="true" in a template', re: /draggable\s*=\s*\\?["']true\\?["']/ },
  // QA gate C1: this pattern used to reject the `draggable` attribute
  // OUTRIGHT, which would have failed the very fix the gate prescribed -
  // native drag has to be turned OFF explicitly (`'false'`), because an
  // ABSENT attribute means "UA default" and that default is TRUE for <a> and
  // <img>. Only the `'true'` spelling is a relapse.
  { name: "setAttribute('draggable', 'true')", re: /setAttribute\(\s*['"]draggable['"]\s*,\s*['"]true['"]/ },
  { name: '.draggable = true', re: /\.draggable\s*=\s*true(?![\w])/ },
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

  // ...and the opposite direction, which is the trap the gate caught: the
  // REQUIRED fix must not read as a relapse.
  const theFix = "row.setAttribute('draggable', 'false');";
  const falsePositives = HTML5_DRAG_PATTERNS.filter((p) => p.re.test(theFix)).map((p) => p.name);
  assert.deepEqual(falsePositives, [], `turning native drag OFF must not trip: ${falsePositives.join(', ')}`);
});

test('v1.76 (QA gate C1): native drag is turned OFF explicitly, not merely left unset', () => {
  // An absent `draggable` attribute means "UA default", and that default is
  // TRUE for <a href> and <img>. Three of the six wired surfaces render their
  // rows AS <a> elements. Removing the attribute (the original implementation)
  // therefore left exactly those rows starting a native link drag, which takes
  // the pointer and cancels the gesture - a shipped desktop capability traded
  // away, invisibly to jsdom, which implements no native DnD.
  const common = fs.readFileSync(path.join(REPO, 'public/js/common.js'), 'utf8');
  const code = stripComments(common);
  assert.match(code, /setAttribute\('draggable',\s*'false'\)/, 'the row is explicitly not draggable');
  assert.match(code, /querySelectorAll\('a, img'\)/, 'and so are the descendants that default to draggable');
  assert.ok(!/removeAttribute\('draggable'\)/.test(code), 'removing the attribute is NOT the fix');
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

// ---- every wired surface must actually SHOW the drag ------------------------

// The stylesheets a client rule can live in: the shared one, plus the
// subscriptions page's own <style> block (its rows are styled page-locally).
//
// COMMENTS STRIPPED (QA delta N1). Shipped without this, the lock below was
// satisfied by PROSE: style.css:3229 and :7037 each mention
// `.folder-item-row.dragging` / `.sidebar-item.dragging` inside a comment, so
// deleting the actual rules left the lock green. Measured at the delta: of the
// six wired surfaces it claims to cover, only two were really bound. A lock
// that lies is worse than no lock - this repo has paid for that one repeatedly.
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const STYLESHEETS = [
  fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8'),
  fs.readFileSync(path.join(REPO, 'lib/ytdlp/views/subscriptions.html'), 'utf8'),
].map(stripCssComments).join('\n');

// The class family a given surface uses: the defaults, unless the call site
// passes its own `classes` block (the source text right after the selector).
function classFamilyFor(source, selector) {
  const at = source.indexOf(`rowSelector: '${selector}'`);
  const window_ = source.slice(at, at + 600);
  const pick = (key, fallback) => {
    const m = window_.match(new RegExp(`${key}:\\s*'([^']+)'`));
    return m ? m[1] : fallback;
  };
  return {
    dragging: pick('dragging', 'dragging'),
    before: pick('before', 'drag-over-before'),
    after: pick('after', 'drag-over-after'),
  };
}

// `.sub-row[data-sub-id]` -> `.sub-row`; `.folder-item-row` -> itself.
const baseClassOf = (selector) => selector.replace(/\[[^\]]*\]/g, '');

// Does `sheets` carry an UNSCOPED rule for `base` + `cls`?
//
// Parsed into (selector, body) pairs rather than regex-scanned, and each
// selector-list part must be EXACTLY the base class compounded with the state
// class. Both halves are load-bearing (QA delta N1, and the mutation run that
// followed the first fix):
//   - a loose scan let a match stretch from one rule into a later `{`;
//   - a merely-contains test let `#sidebar-pinned-section .sidebar-item.dragging`
//     satisfy the plain `.sidebar-item` surfaces. Those are DIFFERENT surfaces
//     that happen to share a base class, and the scoped rule sets only a
//     cursor - so deleting the unscoped `.sidebar-item.dragging` would strip
//     the home sidebar's dim while the lock stayed green (mutant M4, measured
//     surviving).
function cssRules(sheets) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(sheets)) !== null) out.push({ selector: m[1].trim(), body: m[2].trim() });
  return out;
}

function hasRuleFor(sheets, base, cls) {
  const wanted = [`${base}.${cls}`, `.${cls}${base}`];
  return cssRules(sheets).some((rule) =>
    rule.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).some((part) => wanted.includes(part))
  );
}

test('v1.76 (QA gate W3): every wired surface styles its dragging row AND both drop indicators', () => {
  // The bottom-bar editor - the wave's HEADLINE surface, the one whose arrows
  // Dean asked to be rid of - shipped with no drag CSS at all: on a phone the
  // row simply jumped after the finger lifted, with no dim and no drop line.
  // That reads as "it still doesn't work", which is the report that started
  // this wave. This is the general form of that check.
  //
  // QA delta N1: BOTH indicator classes are checked now, not just `dragging`.
  // W3 was about two things - no dim AND no drop line - and the first version
  // of this lock only ever looked at the dim, so deleting both indicator rules
  // left it green.
  const missing = [];
  for (const { file, selector } of ROW_SELECTORS) {
    const source = FILES.find((f) => f.rel === file).source;
    const base = baseClassOf(selector);
    const family = classFamilyFor(stripComments(source), selector);
    for (const key of ['dragging', 'before', 'after']) {
      if (!hasRuleFor(STYLESHEETS, base, family[key])) missing.push(`${file} ${selector} -> .${family[key]}`);
    }
  }
  assert.deepEqual(missing, [], `wired but unstyled: ${missing.join('; ')}`);
});

test('v1.76: the dragging-style lock can actually fail (mutation self-proof)', () => {
  // QA delta N1: the previous positive control used `.folder-item-row`, whose
  // rule is ALSO named in a nearby comment - so the control passed even with
  // the real rule deleted, and proved nothing it claimed to. Comments are
  // stripped from STYLESHEETS now, and the control below is the deletion
  // itself rather than a same-name lookup.
  const base = '.folder-item-row';
  assert.ok(hasRuleFor(STYLESHEETS, base, 'dragging'), 'positive control: the real rule is found');
  assert.ok(hasRuleFor(STYLESHEETS, base, 'drag-over-before'), 'positive control: and its before-indicator');

  // Delete that rule from a COPY and the lock must fail - the mutant this
  // whole test exists to kill.
  const mutated = STYLESHEETS.replace(/\.folder-item-row\.dragging\s*\{[^}]*\}/, '');
  assert.notEqual(mutated, STYLESHEETS, 'the mutation applied (else the proof is vacuous)');
  assert.equal(hasRuleFor(mutated, base, 'dragging'), false, 'a deleted rule must NOT pass');

  // And a surface styled nowhere never passes.
  assert.equal(hasRuleFor(STYLESHEETS, '.totally-invented-row', 'dragging'), false);
});

test('v1.76 (QA delta N1): prose never satisfies the lock, and never hides a real rule either', () => {
  // The shipped defect: style.css:3229 and :7037 name `.folder-item-row.dragging`
  // and `.sidebar-item.dragging` in prose, and the lock's loose "contains"
  // scan let those sentences stand in for the rules themselves.
  //
  // Two separate mechanisms close it, and it is worth being precise about
  // which does what - I first wrote this test asserting the wrong one, and it
  // failed, which is the only reason the note below is right:
  //
  //   1. EXACT-SELECTOR matching kills the false POSITIVE. A mention inside a
  //      comment can never parse as a rule whose selector is exactly
  //      `.row.state`, because the captured selector still carries the `/*`.
  //   2. COMMENT STRIPPING kills the false NEGATIVE. Every rule in this
  //      stylesheet is introduced by a comment, and without stripping the text
  //      between the previous `}` and the rule's `{` includes that comment -
  //      so a genuinely present rule would be missed and the lock would fail
  //      the build for no reason. It is what makes the baseline pass at all.
  const quoted = '/* mirrors .made-up-row.dragging { opacity: 0.5 } exactly */\n.other { color: red }\n';
  assert.equal(hasRuleFor(quoted, '.made-up-row', 'dragging'), false, '(1) a comment is never a rule');
  assert.equal(hasRuleFor(stripCssComments(quoted), '.made-up-row', 'dragging'), false, '(1) and still not once stripped');

  const commented = '.a { color: red }\n/* the drag state */\n.made-up-row.dragging { opacity: 0.5 }\n';
  assert.equal(hasRuleFor(commented, '.made-up-row', 'dragging'), false,
    '(2) UNSTRIPPED, the leading comment hides a real rule - the false negative');
  assert.equal(hasRuleFor(stripCssComments(commented), '.made-up-row', 'dragging'), true,
    '(2) stripped, the real rule is seen');

  assert.ok(!STYLESHEETS.includes('/*'), 'and the real sheets are stripped before matching');
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
