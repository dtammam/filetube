'use strict';

// [UNIT] v1.391.0 (W2/W3) - the brand-neutral guard. The App Store build shows this repo's web UI, and 5.2.1 / 4.1(c) forbid
// leaning on another company's brand, so prose (copy, comments, live docs) is neutral:
//   1. "YouTube" (case-sensitive word) may appear only as the external SOURCE the downloader reads (R5): a hit fails unless
//      its {file, text} is listed in docs/brand-references.json (shrink-only, each with a reason), or the file is under a
//      listed glob (lib/ytdlp/**, the downloader module that names its source by design). A stale entry fails too, so the
//      list can only shrink. Identifiers (isYouTube, youtubeId, YOUTUBE_ITEM_RE, youtube.com) never match the word regex.
// The regex is proven to bind by mutation (plan Evidence): put "YouTube-style" back into setup.html and this file goes red.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const ALLOW = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/brand-references.json'), 'utf8'));

const TEXT_EXT = /\.(js|css|html|md|json|brs|xml|webmanifest|txt|yml|yaml|example)$/;
const SKIP_DIR = new Set(['vendor', 'fonts', 'node_modules', '.git']);

function walk(rel, out) {
  const abs = path.join(REPO, rel);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isFile()) { out.push(rel); return; }
  for (const name of fs.readdirSync(abs)) {
    if (SKIP_DIR.has(name)) continue;
    walk(path.posix.join(rel, name), out);
  }
}

// What the brand guard scans (plan W2.3).
const BRAND_ROOTS = ['public', 'lib', 'server.js', 'roku', 'README.md', 'FEATURES.md', '.env.example', 'docker-compose.yml',
  'Dockerfile', 'package.json', 'docs/CONFIGURATION.md', 'docs/ARCHITECTURE.md'];

function scanSet(roots) {
  const out = [];
  for (const r of roots) walk(r, out);
  return out.filter((f) => TEXT_EXT.test(f) || /^(Dockerfile|\.env\.example)$/.test(f));
}

const YT = /\bYouTube\b/;

function globToRe(g) {
  return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '@@ANY@@').replace(/\*/g, '[^/]*').replace(/@@ANY@@/g, '.*') + '$');
}
const GLOBS = (ALLOW.globs || []).map((g) => ({ re: globToRe(g.glob), reason: g.reason }));
const globAllowed = (file) => GLOBS.some((g) => g.re.test(file));

function hits(files, re) {
  const found = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(REPO, f), 'utf8').split('\n');
    lines.forEach((line, i) => { if (re.test(line)) found.push({ file: f, line: i + 1, text: line.trim() }); });
  }
  return found;
}

test('the allowlist is well formed: every glob and line has a reason, and no line sits under a glob', () => {
  assert.ok(Array.isArray(ALLOW.globs) && Array.isArray(ALLOW.lines));
  for (const g of ALLOW.globs) assert.ok(g.glob && g.reason, 'glob entry: ' + JSON.stringify(g));
  const seen = new Set();
  for (const e of ALLOW.lines) {
    assert.ok(e.file && e.text && e.reason && e.reason.length >= 12, 'entry needs file, text and a reason: ' + JSON.stringify(e).slice(0, 120));
    assert.ok(YT.test(e.text), 'an entry must contain the word it excuses: ' + e.text.slice(0, 80));
    assert.ok(!globAllowed(e.file), e.file + ' is already covered by a glob; drop the line entry');
    const k = e.file + '\u0000' + e.text;
    assert.ok(!seen.has(k), 'duplicate entry: ' + e.text.slice(0, 80));
    seen.add(k);
  }
});

test('YouTube appears only as the external source the downloader reads: every hit is allowlisted (docs/brand-references.json)', () => {
  const files = scanSet(BRAND_ROOTS);
  assert.ok(files.length > 100, 'the scan set is real: ' + files.length);
  const allowed = new Set(ALLOW.lines.map((e) => e.file + '\u0000' + e.text));
  const bad = hits(files, YT).filter((h) => !globAllowed(h.file) && !allowed.has(h.file + '\u0000' + h.text));
  assert.deepStrictEqual(bad.map((h) => `${h.file}:${h.line}  ${h.text.slice(0, 110)}`), [],
    'reword these (R5: only the external SOURCE stays), or list a functional line in docs/brand-references.json with a reason');
});

test('the allowlist only shrinks: an entry whose line is gone (or reworded) must be deleted', () => {
  const files = new Set(scanSet(BRAND_ROOTS));
  const present = new Set(hits([...files], YT).map((h) => h.file + '\u0000' + h.text));
  const stale = ALLOW.lines.filter((e) => !present.has(e.file + '\u0000' + e.text));
  assert.deepStrictEqual(stale.map((e) => `${e.file}  ${e.text.slice(0, 100)}`), []);
});

test('the YouTube regex lets identifiers through and catches prose (so the zero above cannot pass by never matching)', () => {
  for (const bad of ['YouTube-style rows', 'the YouTube convention', 'Modern YouTube Mode']) assert.ok(YT.test(bad), bad);
  for (const ok of ['isYouTube', 'youtubeId', 'YOUTUBE_ITEM_RE', 'https://www.youtube.com/watch']) assert.ok(!YT.test(ok), ok);
});
