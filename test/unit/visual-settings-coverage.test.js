'use strict';

// [UNIT] The visual rule (v1.349): every Settings section is a surface the screenshot job can only
// check if a scene opens it. A section with no scene is never compared, so a look change there
// would ship unseen. This test reads the sections from public/setup.html and the scenes from
// test/visual/capture.js and fails on a section no scene opens. A NEW section must get a scene in
// the same change - never an UNCOVERED entry. UNCOVERED is the measured backlog and may only shrink.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SETUP_HTML = fs.readFileSync(path.join(ROOT, 'public', 'setup.html'), 'utf8');
const CAPTURE_JS = fs.readFileSync(path.join(ROOT, 'test', 'visual', 'capture.js'), 'utf8');

// Sections that have no scene today (measured against capture.js at v1.348.0). Each needs a scene
// someday; none may be added here.
const UNCOVERED = [
  ['music', 'folder-list section with no scene of its own yet'],
  ['shows', 'folder-list section with no scene of its own yet'],
  ['podcasts', 'folder-list section with no scene of its own yet'],
  ['troubleshooting', 'admin diagnostics section with no scene of its own yet'],
];

function sectionKeys(html) {
  return [...html.matchAll(/data-collapse-key="([^"]+)"/g)].map((m) => m[1]);
}

// Keys a scene opens: the SETTINGS_SECTIONS rows (3rd column), plus every scene whose path is the
// Settings page and which opens a section through section(p, 'key') / openSettingsSection(p, 'key').
function coveredKeys(src) {
  const keys = new Set();
  const table = /const SETTINGS_SECTIONS = \[([\s\S]*?)\n\];/.exec(src);
  if (table) for (const m of table[1].matchAll(/\[\s*'[^']*',\s*'[^']*',\s*'([^']+)'/g)) keys.add(m[1]);
  for (const chunk of src.split(/\{ id: '/).slice(1)) {
    if (!/path: [`']\/setup\.html/.test(chunk.split(/\n\s*\{ id: '/)[0])) continue;
    const scene = chunk.split(/\n\s*\{ id: '/)[0];
    for (const m of scene.matchAll(/(?:section|openSettingsSection)\(p, '([^']+)'\)/g)) keys.add(m[1]);
  }
  return keys;
}

function uncoveredIn(html, src) {
  const covered = coveredKeys(src);
  return sectionKeys(html).filter((k) => !covered.has(k));
}

test('every Settings section has a screenshot scene, or is a listed UNCOVERED entry', () => {
  const allowed = new Set(UNCOVERED.map(([k]) => k));
  const missing = uncoveredIn(SETUP_HTML, CAPTURE_JS).filter((k) => !allowed.has(k));
  assert.deepStrictEqual(missing, [], 'a Settings section with no scene in test/visual/capture.js (add the scene in the same change): ' + missing.join(', '));
});

test('UNCOVERED only shrinks: it lists only real sections that still have no scene', () => {
  const real = new Set(sectionKeys(SETUP_HTML));
  const still = new Set(uncoveredIn(SETUP_HTML, CAPTURE_JS));
  for (const [key, reason] of UNCOVERED) {
    assert.ok(real.has(key), `UNCOVERED lists "${key}" but setup.html has no such section`);
    assert.ok(still.has(key), `UNCOVERED lists "${key}" but a scene covers it now: delete the entry`);
    assert.ok(reason && reason.length > 8, `UNCOVERED "${key}" needs a one-line reason`);
  }
  assert.strictEqual(new Set(UNCOVERED.map(([k]) => k)).size, UNCOVERED.length, 'no duplicate entries');
});

test('the coverage reader can fail: a section no scene opens is reported', () => {
  const html = SETUP_HTML + '\n<details data-collapse-key="zz-fake-section"></details>';
  assert.ok(uncoveredIn(html, CAPTURE_JS).includes('zz-fake-section'), 'a fake section must be reported');
  const noRow = CAPTURE_JS.replace("['0', 'appearance', 'appearance'], ", '');
  assert.ok(uncoveredIn(SETUP_HTML, noRow).includes('appearance'), 'dropping a SETTINGS_SECTIONS row must be reported');
  const noScene = CAPTURE_JS.replace("await section(p, 'account')", "await section(p, 'nothing')");
  assert.ok(uncoveredIn(SETUP_HTML, noScene).includes('account'), 'a section() scene that stops opening a key must be reported');
});

test('UNCOVERED never grows: it is exactly the four sections that had no scene at v1.348.0', () => {
  assert.deepStrictEqual(UNCOVERED.map((u) => u[0]).sort(), ['music', 'podcasts', 'shows', 'troubleshooting']);
});
