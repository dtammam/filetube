'use strict';

// [UNIT] v1.395.0 Pages (plan D-VENDOR, acceptance 10): the vendored Readability
// files are byte-for-byte what lib/pages/vendor/README.md records. No silent edits:
// a local change lives in our wrappers (lib/pages/tidy.js, lib/pages/extract.js).
// And no new npm dependency: package.json's runtime dependencies are exactly the
// three the project had before Pages.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', '..', 'lib', 'pages', 'vendor');
const README = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');

function recorded() {
  const out = {};
  for (const m of README.matchAll(/^\| `([^`]+\.js)` \|[^|]*\|[^|]*\| `([0-9a-f]{64})` \|$/gm)) out[m[1]] = m[2];
  return out;
}

test('every vendored file matches the sha256 its README records', () => {
  const rec = recorded();
  assert.deepStrictEqual(Object.keys(rec).sort(), ['JSDOMParser.js', 'Readability-readerable.js', 'Readability.js'], 'the README table lists the three files');
  for (const [name, sha] of Object.entries(rec)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, name))).digest('hex');
    assert.strictEqual(actual, sha, `${name} drifted from its recorded hash - vendored files are never edited (README "Updating")`);
  }
});

test('the folder holds only the recorded files, their license and the README', () => {
  const rec = recorded();
  const allowed = new Set([...Object.keys(rec), 'README.md', 'LICENSE-readability.md']);
  const present = fs.readdirSync(DIR);
  assert.deepStrictEqual(present.filter((f) => !allowed.has(f)), [], 'an unrecorded file in lib/pages/vendor');
  for (const f of allowed) assert.ok(present.includes(f), `${f} is missing`);
});

test('the vendored files have no dependencies of their own', () => {
  for (const name of Object.keys(recorded())) {
    const src = fs.readFileSync(path.join(DIR, name), 'utf8');
    assert.ok(!/\brequire\s*\(/.test(src), `${name} calls require()`);
    assert.ok(!/^\s*import\s/m.test(src), `${name} imports`);
  }
});

test('the vendored modules load as CommonJS and expose what the wrappers use', () => {
  const Readability = require('../../lib/pages/vendor/Readability');
  const JSDOMParser = require('../../lib/pages/vendor/JSDOMParser');
  const readerable = require('../../lib/pages/vendor/Readability-readerable');
  assert.strictEqual(typeof Readability, 'function');
  assert.strictEqual(typeof JSDOMParser, 'function');
  assert.strictEqual(typeof readerable, 'function');
  const doc = new JSDOMParser().parse('<html><head><title>T</title></head><body><article><p>' + 'word '.repeat(200) + '</p></article></body></html>', 'https://example.org/a');
  const r = new Readability(doc).parse();
  assert.ok(r && r.textContent.includes('word'));
});

test('no new npm dependency (P14): runtime dependencies are unchanged', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(pkg.dependencies).sort(), ['dotenv', 'express', 'mime-types']);
  assert.ok(!Object.keys(pkg.devDependencies || {}).some((d) => /readability|dompurify|sanitize|jsdom-?global|cheerio|parse5|htmlparser/i.test(d) && d !== 'jsdom'), 'no HTML/sanitizer package crept in');
});
