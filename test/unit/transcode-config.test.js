'use strict';

// [UNIT] v1.15.0 item 7 -- configurable TRANSCODE_DIR (env override) + opt-in
// higher CRF. Isolated DATA_DIR (and, for some tests, TRANSCODE_DIR) before
// requiring the server (own process per test file), so nothing here touches
// real project data.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
// A non-default TRANSCODE_DIR, deliberately NOT nested under DATA_DIR, so
// AC7.3/7.4 (custom dir keeps eviction/age/writability working) is exercised
// against a genuinely different path rather than the default.
const CUSTOM_TRANSCODE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-transcode-'));
process.env.TRANSCODE_DIR = CUSTOM_TRANSCODE_DIR;

const { test } = require('node:test');
const assert = require('node:assert');
const {
  resolveTranscodeDir,
  parseCrf,
  TRANSCODE_DIR,
  TRANSCODE_CRF,
  evictTranscodeCache,
  sweepAgedTranscodes,
} = require('../../server');

// ---- resolveTranscodeDir (pure) ----

test('resolveTranscodeDir: no TRANSCODE_DIR env -> defaults to <dataDir>/transcoded', () => {
  assert.equal(resolveTranscodeDir({}, '/data'), path.join('/data', 'transcoded'));
  assert.equal(resolveTranscodeDir({ TRANSCODE_DIR: '' }, '/data'), path.join('/data', 'transcoded'));
  assert.equal(resolveTranscodeDir(undefined, '/data'), path.join('/data', 'transcoded'));
});

test('resolveTranscodeDir: TRANSCODE_DIR env set -> resolves that path instead', () => {
  assert.equal(resolveTranscodeDir({ TRANSCODE_DIR: '/custom/dir' }, '/data'), path.resolve('/custom/dir'));
});

test('resolveTranscodeDir: a relative TRANSCODE_DIR is resolved to an absolute path', () => {
  const result = resolveTranscodeDir({ TRANSCODE_DIR: 'relative/cache' }, '/data');
  assert.ok(path.isAbsolute(result), 'expected an absolute path');
  assert.equal(result, path.resolve('relative/cache'));
});

test('server.js wires TRANSCODE_DIR from process.env.TRANSCODE_DIR at boot (this file set it before requiring server)', () => {
  assert.equal(TRANSCODE_DIR, path.resolve(CUSTOM_TRANSCODE_DIR));
  assert.ok(fs.existsSync(TRANSCODE_DIR), 'the custom dir must be created (mkdir -p) on boot');
});

// ---- parseCrf (pure) ----

test('parseCrf: falls back to the default (23) on unset/empty', () => {
  for (const bad of [undefined, null, '']) {
    assert.equal(parseCrf(bad), 23, `${bad} should fall back to default CRF`);
  }
});

test('parseCrf: accepts a valid override within the x264 range', () => {
  assert.equal(parseCrf('30'), 30);
  assert.equal(parseCrf(28), 28);
  assert.equal(parseCrf('1'), 1);
  assert.equal(parseCrf('51'), 51);
});

test('parseCrf: hostile/out-of-range values fall back to the default (23), never crash', () => {
  for (const bad of ['abc', '0', '-5', '52', '100', '1.5', 'NaN', {}, [], 'DROP TABLE']) {
    assert.equal(parseCrf(bad), 23, `${JSON.stringify(bad)} should fall back to default CRF`);
  }
});

test('server.js applies the resolved CRF (this file set TRANSCODE_CRF unset -> default 23)', () => {
  // No TRANSCODE_CRF env var was set for this process -- confirms the
  // "default unchanged" guarantee (AC7.6).
  assert.equal(TRANSCODE_CRF, 23);
});

// ---- AC7.3: eviction / age-sweep still work against a custom TRANSCODE_DIR ----

test('evictTranscodeCache: LRU eviction still works when TRANSCODE_DIR is a custom (non-default) path', () => {
  for (const n of fs.readdirSync(TRANSCODE_DIR)) fs.unlinkSync(path.join(TRANSCODE_DIR, n));
  const write = (name, bytes, atimeSec) => {
    const p = path.join(TRANSCODE_DIR, name);
    fs.writeFileSync(p, Buffer.alloc(bytes));
    fs.utimesSync(p, new Date(atimeSec * 1000), new Date(atimeSec * 1000));
    return p;
  };
  const old = write('old.mp4', 100, 1000);
  const fresh = write('fresh.mp4', 100, 3000);

  assert.equal(evictTranscodeCache(150, fresh), 1);
  assert.ok(!fs.existsSync(old), 'oldest evicted from the custom dir');
  assert.ok(fs.existsSync(fresh), 'just-produced protected in the custom dir');
});

test('sweepAgedTranscodes: age-retention sweep still targets the custom TRANSCODE_DIR', () => {
  for (const n of fs.readdirSync(TRANSCODE_DIR)) fs.unlinkSync(path.join(TRANSCODE_DIR, n));
  const agedPath = path.join(TRANSCODE_DIR, 'aged.mp4');
  fs.writeFileSync(agedPath, Buffer.alloc(10));
  const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
  fs.utimesSync(agedPath, oldTime, oldTime);

  // The default db.settings.cacheMaxAgeDays is 30 -> a 40-day-old file
  // should be swept from the custom dir.
  const removed = sweepAgedTranscodes(Date.now());
  assert.ok(removed >= 1, 'expected the aged file to be swept from the custom TRANSCODE_DIR');
  assert.ok(!fs.existsSync(agedPath), 'aged file removed from the custom dir');
});
