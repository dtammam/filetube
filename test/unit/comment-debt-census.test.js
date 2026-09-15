'use strict';

// [UNIT] Wave 0 of the relational-migration arc (2026-09-13) - the honest-zero
// comment-debt census (docs/exec-plans/completed/2026-09-13-sqlite-relational-migration.md,
// Section 1: "Genuine TODO/FIXME/HACK markers: 0, lint-enforced").
//
// Two floors, scanned over the tracked file list derived each run (never a
// typed list):
//
//   TIER 1 - MARKER FORM = genuine debt, ZERO everywhere (shipped code AND
//     tests). A marker word that OPENS a comment (`// W`, `/* W`, `/** @W`
//     the JSDoc tag, a `* W` block continuation, `# W`, `<!-- W`, BrightScript
//     `' W`) in ANY letter case, or that wears an UPPER-CASE tag anywhere
//     (`W:` / `W(owner)`). The opener arm is case-insensitive because a
//     lowercase or title-case opener is debt too; the tag arm stays case-sensitive because
//     the capability registry's `todo(...)` helper and `todo: 0` counters are
//     domain code, not debt. eslint's no-warning-comments (location: start,
//     eslint.config.js) is the first net for JS files; this test is the net
//     for the css/html/sh/yml/brs/json/Dockerfile/hook surfaces eslint never
//     sees, for the `@todo` JSDoc form its start-anchor rejects, and for the
//     mid-comment tag forms its start-only check skips.
//
//   TIER 2 - LOOSE = the bare UPPER-CASE word anywhere, ZERO in SHIPPED code.
//     Prose that merely mentions a marker word is not debt, but in shipped
//     code it is indistinguishable from debt to every grep a future reader
//     runs - so shipped code carries none (Wave 0 reworded the two that
//     existed: lib/media-capabilities.js and public/js/glyph-pool.js). Test
//     files are exempt from this tier only: the census tests must name the
//     `todo` state.
//
// The classifier AND the scan are bound before they are trusted (the v1.272
// "does the driver ever REACH the state the assert is about" rule): regex
// controls, an end-to-end scan of a temp fixture, and a per-extension-class
// must-include list for the enumeration - so an empty file list, a dropped
// extension, or a scan that inspects nothing all go RED instead of green.
//
// The marker words below are assembled from halves so this file's own fixture
// lines never trip the census it runs (a self-exemption by path would be a
// hole; a fixture that spells the word would be a false positive).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');

const WORDS = ['TO' + 'DO', 'FIX' + 'ME', 'HA' + 'CK', 'XX' + 'X'];
const WORD_ALT = WORDS.join('|');
const OPENERS = String.raw`(?://|/\*+|^\s*\*|#|<!--)`;
// Opener arm: any case, optional JSDoc `@`.
const OPENER_RE = new RegExp(String.raw`${OPENERS}\s*@?(?:${WORD_ALT})\b`, 'i');
// Tag arm: upper-case only (see the header).
const TAG_RE = new RegExp(String.raw`\b(?:${WORD_ALT})\s*[:(]`);
// BrightScript (roku/) comments open with a single quote.
const BRS_OPENER_RE = new RegExp(String.raw`(?:^|\s)'\s*@?(?:${WORD_ALT})\b`, 'i');
const LOOSE_RE = new RegExp(String.raw`\b(?:${WORD_ALT})\b`);

const isMarker = (line, rel) =>
  (rel.endsWith('.brs') ? BRS_OPENER_RE : OPENER_RE).test(line) || TAG_RE.test(line);

// Code surfaces: by extension, plus every EXTENSION-LESS tracked file (git
// hooks, Dockerfile, roku/manifest) except the licence text. Markdown is prose
// (ROADMAP, exec plans, the tracker all discuss debt by name) and is
// deliberately NOT a code surface.
const CODE_EXT = new Set(['js', 'cjs', 'mjs', 'css', 'html', 'sh', 'yml', 'yaml', 'json', 'brs', 'xml', 'toml', 'webmanifest']);
const EXCLUDED = [/^public\/vendor\//, /^node_modules\//, /^package-lock\.json$/, /(^|\/)LICENSE$/];

function isCodeFile(p) {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return true; // extension-less: Dockerfile, hooks/pre-commit, roku/manifest
  return CODE_EXT.has(base.slice(dot + 1));
}

function trackedCodeFiles() {
  let names;
  try {
    names = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0').filter(Boolean);
  } catch (_) {
    // No git (an exported tree): walk the filesystem so the census still runs
    // instead of passing vacuously on an empty list. Skips only what git
    // would never track here (node_modules, .git, runtime data, reviewer
    // worktrees) - .claude/hooks stays in, as it is in the git list.
    names = [];
    const walk = (rel) => {
      for (const ent of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
        const p = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'data' || p === '.claude/worktrees') continue;
          walk(p);
        } else names.push(p);
      }
    };
    walk('');
  }
  return names
    .filter(isCodeFile)
    .filter((p) => !EXCLUDED.some((re) => re.test(p)))
    .filter((p) => fs.existsSync(path.join(ROOT, p)));
}

const isShipped = (p) => !p.startsWith('test/');

// `root` is a parameter so the end-to-end control can scan a temp fixture
// through the SAME code path the floors use.
function scan(files, classify, root = ROOT) {
  const hits = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (classify(line, rel)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

const isLoose = (line) => LOOSE_RE.test(line);

// ---- the classifier is bound BEFORE it is trusted (no vacuous floor) -------

test('census: the marker-form classifier catches every conventional debt shape (any case, JSDoc @tag) and ignores prose', () => {
  const lower = (w) => w.toLowerCase();
  const title = (w) => w[0] + w.slice(1).toLowerCase();
  for (const W of WORDS) {
    const caught = [
      `// ${W}: wire this up`,
      `//${W} later`,
      `/* ${W} */`,
      `/** @${lower(W)} the JSDoc tag form */`,
      `/* @${W} block tag */`,
      ` * ${W} the block-comment continuation form`,
      ` * @${lower(W)} continuation JSDoc tag`,
      `# ${W} shell / yaml / Dockerfile / hook`,
      `# ${lower(W)}: lowercase shell marker`,
      `<!-- ${title(W)}: html -->`,
      `/* ${lower(W)}: fix the flash */`,
      `/* ${title(W)}: css title-case */`,
      `doThing(); // ${W}`,
      `  // note: ${W}(dean): tagged form mid-comment`,
      `x = 1; ${W}: bare upper-case tag`,
    ];
    for (const line of caught) assert.ok(isMarker(line, 'x.js'), `should catch: ${line}`);
    assert.ok(isMarker(`  ' ${W} brightscript`, 'roku/x.brs'), 'brs opener caught');
    assert.ok(isMarker(`  ' ${lower(W)} brightscript lowercase`, 'roku/x.brs'), 'brs lowercase opener caught');
    assert.ok(isLoose(`a ${W} gap that silently appears`), 'loose tier sees prose');
  }
  const prose = [
    `// media type left undeclared, or a ${WORDS[0]} gap that silently appears`,
    `// "Temporarily disabled, see ${WORDS[0]}" is exactly how a real rule reads`,
    `// chrome emoji live in CSS as \\${'XX' + 'XX'} escapes, never as literals`,
    `const state = '${WORDS[0].toLowerCase()}'; // lowercase domain term, not a marker`,
    `const ${WORDS[0].toLowerCase()} = (when, note) => ({ state: '${WORDS[0].toLowerCase()}', when, note });`,
    `  assert.strictEqual(counts.${WORDS[0].toLowerCase()}, 0); // a lowercase KEY is domain code`,
    `"integrity": "sha512-YZo3K82SD7Riyi0E1EQPojLz7kpepnSQI9IyPbHHg1${'XX' + 'X'}evb5dJI7tpyN2ADxGcQbHG7vcyRHk0cbwqcQriUtg=="`,
  ];
  for (const line of prose) assert.ok(!isMarker(line, 'x.js'), `should NOT catch prose: ${line}`);
  // The lowercase tag form `todo: 0` is domain code (capability census counters)
  // and must NOT be a marker - the tag arm is deliberately case-sensitive.
  assert.ok(!isMarker(`    ${'to' + 'do'}: 0,`, 'x.js'), 'lowercase key: is not a tag marker');
  assert.ok(!isLoose(prose[2]), 'a 4-hex-digit escape placeholder is not the 3-letter word');
  assert.ok(!isLoose(prose[3]), 'the lowercase domain term is not the marker');
  assert.ok(!isLoose(prose[6]), 'a base64 run is not the marker');
});

test('census: the SCAN inspects file content end to end (a temp fixture with one planted marker yields exactly that hit)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-census-'));
  try {
    fs.writeFileSync(path.join(tmp, 'planted.js'), [
      'const a = 1;',
      `// ${WORDS[1]}: planted marker on line 2`,
      `const b = 'a ${WORDS[1]} in prose is not a marker';`,
    ].join('\n'));
    fs.writeFileSync(path.join(tmp, 'clean.css'), '.x { color: red; }\n');
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), `FROM node\n# ${WORDS[2].toLowerCase()}: planted lowercase hook/Dockerfile shape\n`);
    fs.writeFileSync(path.join(tmp, 'scene.brs'), `sub init()\n  ' ${WORDS[0]} planted brs\nend sub\n`);
    const marker = scan(['planted.js', 'clean.css', 'Dockerfile', 'scene.brs'], isMarker, tmp);
    assert.deepStrictEqual(marker.map((h) => h.split(':').slice(0, 2).join(':')),
      ['planted.js:2', 'Dockerfile:2', 'scene.brs:2'], `marker scan: ${marker.join(' | ')}`);
    const loose = scan(['planted.js', 'clean.css'], isLoose, tmp);
    assert.deepStrictEqual(loose.map((h) => h.split(':').slice(0, 2).join(':')), ['planted.js:2', 'planted.js:3'], 'loose scan sees the prose line too');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('census: the file enumeration is live (git-derived; one witness per extension class; hooks/Dockerfile/manifest included; the shipped split is right)', () => {
  const files = trackedCodeFiles();
  assert.ok(files.length >= 300, `expected hundreds of tracked code files, got ${files.length}`);
  const witnesses = [
    'server.js', 'lib/db/sqlite.js', 'lib/media-capabilities.js', 'public/js/glyph-pool.js', // js
    'public/css/style.css', // css
    'public/index.html', // html
    'setup.sh', '.claude/hooks/session-start.sh', // sh (incl. the tracked .claude hooks)
    '.github/workflows/ci.yml', // yml
    'package.json', 'docs/releases.json', // json
    'roku/components/AppScene.brs', // brs
    'hooks/pre-commit', 'hooks/pre-push', 'Dockerfile', 'roku/manifest', // extension-less
    'test/unit/comment-debt-census.test.js', // this file (TIER 1 covers tests)
  ];
  for (const must of witnesses) {
    assert.ok(fs.existsSync(path.join(ROOT, must)), `witness ${must} vanished - pick a new witness for its class`);
    assert.ok(files.includes(must), `${must} must be in the census`);
  }
  assert.ok(!files.some((p) => p.startsWith('public/vendor/')), 'vendored dists are not ours to police');
  assert.ok(!files.includes('package-lock.json'), 'the lockfile is generated');
  assert.ok(!files.includes('LICENSE'), 'the licence text is prose');
  const shipped = files.filter(isShipped);
  assert.ok(shipped.includes('server.js') && shipped.includes('hooks/pre-commit'), 'shipped set holds the app and the hooks');
  assert.ok(!shipped.includes('test/unit/comment-debt-census.test.js'), 'tests are not shipped code');
  assert.ok(shipped.length >= 100 && files.length - shipped.length >= 100, `both halves populated (shipped ${shipped.length}, tests ${files.length - shipped.length})`);
});

// ---- the two floors ------------------------------------------------------

test('TIER 1: ZERO marker-form debt anywhere in tracked code (shipped + tests)', () => {
  const hits = scan(trackedCodeFiles(), isMarker);
  assert.deepStrictEqual(hits, [],
    `genuine ${WORDS.join('/')} markers found - this repo carries zero; fix the debt or file it in docs/exec-plans/tech-debt-tracker.md and reword:\n${hits.join('\n')}`);
});

test('TIER 2: ZERO loose marker words in SHIPPED code (prose mentions included)', () => {
  const hits = scan(trackedCodeFiles().filter(isShipped), isLoose);
  assert.deepStrictEqual(hits, [],
    `shipped code mentions a debt-marker word - reword it (a future grep cannot tell prose from debt):\n${hits.join('\n')}`);
});
