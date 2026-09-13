'use strict';

// [UNIT] Wave 0 of the relational-migration arc (2026-09-13) - the honest-zero
// comment-debt census (docs/exec-plans/active/2026-09-13-sqlite-relational-migration.md,
// Section 1: "Genuine TODO/FIXME/HACK markers: 0, lint-enforced").
//
// Two nets, both derived from the tracked file list each run (never a typed list):
//
//   TIER 1 - MARKER FORM = genuine debt, ZERO everywhere (shipped code AND
//     tests). A marker word that OPENS a comment (`// W`, `/* W`, a `* W`
//     block continuation, `# W`, `<!-- W`, BrightScript `' W`) or that wears a
//     tag anywhere (`W:` / `W(owner)`). This is the shape every debt-grep tool
//     and eslint's no-warning-comments (location: start, eslint.config.js)
//     recognise - eslint is the first net for JS; this test is the net for the
//     css/html/sh/yml/brs/json surfaces eslint never sees, and for the
//     mid-comment tag forms eslint's start-only check skips.
//
//   TIER 2 - LOOSE = the bare word anywhere, case-sensitive, ZERO in SHIPPED
//     code. Prose that merely mentions a marker word is not debt, but in
//     shipped code it is indistinguishable from debt to every grep a future
//     reader runs - so shipped code carries none (Wave 0 reworded the two
//     that existed: lib/media-capabilities.js and public/js/glyph-pool.js).
//     Test files are exempt from this tier only: the capability registry's
//     `todo` state is a domain term the census tests must name.
//
// The marker words below are assembled from halves so this file's own fixture
// lines never trip the census it runs (a self-exemption by path would be a
// hole; a fixture that spells the word would be a false positive).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');

const WORDS = ['TO' + 'DO', 'FIX' + 'ME', 'HA' + 'CK', 'XX' + 'X'];
const WORD_ALT = WORDS.join('|');
const OPENERS = String.raw`(?://|/\*+|^\s*\*|#|<!--)`;
const MARKER_RE = new RegExp(String.raw`(?:${OPENERS}\s*(?:${WORD_ALT})\b|\b(?:${WORD_ALT})\s*[:(])`);
// BrightScript (roku/) comments open with a single quote.
const BRS_MARKER_RE = new RegExp(String.raw`(?:^|\s)'\s*(?:${WORD_ALT})\b`);
const LOOSE_RE = new RegExp(String.raw`\b(?:${WORD_ALT})\b`);

// Code surfaces. Markdown is prose (ROADMAP, exec plans, the tracker all discuss
// debt by name) and is deliberately NOT a code surface.
const CODE_EXT = new Set(['js', 'cjs', 'mjs', 'css', 'html', 'sh', 'yml', 'yaml', 'json', 'brs', 'xml', 'toml', 'webmanifest']);
const EXCLUDED = [/^public\/vendor\//, /^node_modules\//, /^package-lock\.json$/];

function trackedCodeFiles() {
  let names;
  try {
    names = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0').filter(Boolean);
  } catch (_) {
    // No git (an exported tree): walk the filesystem so the census still runs
    // instead of passing vacuously on an empty list.
    names = [];
    const walk = (rel) => {
      for (const ent of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
        const p = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'data' || ent.name === '.claude') continue;
          walk(p);
        } else names.push(p);
      }
    };
    walk('');
  }
  return names
    .filter((p) => CODE_EXT.has(p.slice(p.lastIndexOf('.') + 1)))
    .filter((p) => !EXCLUDED.some((re) => re.test(p)))
    .filter((p) => fs.existsSync(path.join(ROOT, p)));
}

const isShipped = (p) => !p.startsWith('test/');

function scan(files, pick) {
  const hits = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    const re = pick(rel);
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

const markerRe = (rel) => (rel.endsWith('.brs') ? BRS_MARKER_RE : MARKER_RE);

// ---- the classifier is bound BEFORE it is trusted (no vacuous floor) -------

test('census: the marker-form classifier catches every conventional debt shape and ignores prose', () => {
  for (const W of WORDS) {
    const caught = [
      `// ${W}: wire this up`,
      `//${W} later`,
      `/* ${W} */`,
      ` * ${W} the block-comment continuation form`,
      `# ${W} shell / yaml`,
      `<!-- ${W} html -->`,
      `doThing(); // ${W}`,
      `  // note: ${W}(dean): tagged form mid-comment`,
      `x = 1; ${W}: bare tag`,
    ];
    for (const line of caught) assert.ok(MARKER_RE.test(line), `should catch: ${line}`);
    assert.ok(BRS_MARKER_RE.test(`  ' ${W} brightscript`), 'brs opener caught');
    assert.ok(LOOSE_RE.test(`a ${W} gap that silently appears`), 'loose tier sees prose');
  }
  const prose = [
    `// media type left undeclared, or a ${WORDS[0]} gap that silently appears`,
    `// "Temporarily disabled, see ${WORDS[0]}" is exactly how a real rule reads`,
    `// chrome emoji live in CSS as \\${'XX' + 'XX'} escapes, never as literals`,
    `const state = 'todo'; // lowercase domain term, not a marker`,
    `"integrity": "sha512-YZo3K82SD7Riyi0E1EQPojLz7kpepnSQI9IyPbHHg1${'XX' + 'X'}evb5dJI7tpyN2ADxGcQbHG7vcyRHk0cbwqcQriUtg=="`,
  ];
  for (const line of prose) assert.ok(!MARKER_RE.test(line), `should NOT catch prose: ${line}`);
  assert.ok(!LOOSE_RE.test(prose[2]), 'a 4-hex-digit escape placeholder is not the 3-letter word');
  assert.ok(!LOOSE_RE.test(prose[3]), 'the lowercase domain term is not the marker');
  assert.ok(!LOOSE_RE.test(prose[4]), 'a base64 run is not the marker');
});

test('census: the file enumeration is live (git-derived, hundreds of code files, both Wave 0 files present)', () => {
  const files = trackedCodeFiles();
  assert.ok(files.length >= 300, `expected hundreds of tracked code files, got ${files.length}`);
  for (const must of ['server.js', 'lib/db/sqlite.js', 'lib/media-capabilities.js', 'public/js/glyph-pool.js', 'public/css/style.css']) {
    assert.ok(files.includes(must), `${must} must be in the census`);
  }
  assert.ok(!files.some((p) => p.startsWith('public/vendor/')), 'vendored dists are not ours to police');
  assert.ok(!files.includes('package-lock.json'), 'the lockfile is generated');
});

// ---- the two floors ------------------------------------------------------

test('TIER 1: ZERO marker-form debt anywhere in tracked code (shipped + tests)', () => {
  const hits = scan(trackedCodeFiles(), markerRe);
  assert.deepStrictEqual(hits, [],
    `genuine ${WORDS.join('/')} markers found - this repo carries zero; fix the debt or file it in docs/exec-plans/tech-debt-tracker.md and reword:\n${hits.join('\n')}`);
});

test('TIER 2: ZERO loose marker words in SHIPPED code (prose mentions included)', () => {
  const hits = scan(trackedCodeFiles().filter(isShipped), () => LOOSE_RE);
  assert.deepStrictEqual(hits, [],
    `shipped code mentions a debt-marker word - reword it (a future grep cannot tell prose from debt):\n${hits.join('\n')}`);
});
