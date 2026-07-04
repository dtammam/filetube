'use strict';

// Isolated DATA_DIR before requiring the server (own process per test file), so
// TRANSCODE_DIR resolves under a disposable dir and no real data is touched.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
const TRANSCODE_DIR = path.join(process.env.DATA_DIR, 'transcoded');

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseCacheCap,
  selectEvictions,
  cleanupOrphanTmp,
  evictTranscodeCache,
} = require('../../server');

const DEFAULT = 5 * 1024 ** 3;
const f = (p, size, atimeMs) => ({ path: p, size, atimeMs });

// ---- parseCacheCap ----

test('parseCacheCap: falls back to the 5GB default on invalid/unset values', () => {
  for (const bad of [undefined, null, '', 'abc', '0', '-100', '1.5', 'NaN']) {
    assert.equal(parseCacheCap(bad), DEFAULT, `${bad} should fall back to default`);
  }
});

test('parseCacheCap: accepts a valid positive integer', () => {
  assert.equal(parseCacheCap('1048576'), 1048576);
  assert.equal(parseCacheCap(2048), 2048);
});

// ---- selectEvictions (pure) ----

test('selectEvictions: nothing to evict when under the cap', () => {
  assert.deepEqual(selectEvictions([f('/a.mp4', 10, 1), f('/b.mp4', 10, 2)], 100), []);
});

test('selectEvictions: evicts least-recently-used first until under cap', () => {
  const files = [f('/new.mp4', 40, 300), f('/old.mp4', 40, 100), f('/mid.mp4', 40, 200)];
  // total 120, cap 100 -> drop the oldest (old) -> 80 <= 100
  assert.deepEqual(selectEvictions(files, 100), ['/old.mp4']);
});

test('selectEvictions: keeps evicting oldest-first until under cap', () => {
  const files = [f('/a.mp4', 50, 100), f('/b.mp4', 50, 200), f('/c.mp4', 50, 300)];
  // total 150, cap 50 -> evict a (100) then b (50) -> <= 50
  assert.deepEqual(selectEvictions(files, 50), ['/a.mp4', '/b.mp4']);
});

test('selectEvictions: excludes *.tmp.mp4 from totals and never deletes them', () => {
  const files = [f('/x.tmp.mp4', 1000, 1), f('/a.mp4', 40, 100), f('/b.mp4', 40, 200)];
  // eligible total = 80 <= 100 (tmp not counted) -> nothing
  assert.deepEqual(selectEvictions(files, 100), []);
});

test('selectEvictions: keepPath counts toward the total but is never evicted', () => {
  const files = [f('/keep.mp4', 80, 500), f('/old.mp4', 40, 100)];
  // total 120, cap 100, keep=/keep.mp4 -> only /old can go -> 80
  assert.deepEqual(selectEvictions(files, 100, '/keep.mp4'), ['/old.mp4']);
});

test('selectEvictions: ties broken by path when atime is equal', () => {
  const files = [f('/b.mp4', 60, 100), f('/a.mp4', 60, 100)];
  // total 120, cap 60 -> evict the lexicographically-first path
  assert.deepEqual(selectEvictions(files, 60), ['/a.mp4']);
});

test('selectEvictions: empty input returns []', () => {
  assert.deepEqual(selectEvictions([], 100), []);
});

test('selectEvictions: exactly at the cap evicts nothing', () => {
  const files = [f('/a.mp4', 50, 1), f('/b.mp4', 50, 2)]; // total === cap
  assert.deepEqual(selectEvictions(files, 100), []);
});

test('selectEvictions: a single oversized file is evicted without looping forever', () => {
  assert.deepEqual(selectEvictions([f('/big.mp4', 200, 1)], 100), ['/big.mp4']);
});

test('selectEvictions: over cap but only a protected file remains -> [] (cannot evict it)', () => {
  const files = [f('/keep.mp4', 200, 1)];
  assert.deepEqual(selectEvictions(files, 100, '/keep.mp4'), []);
});

test('selectEvictions: protected paths are never evicted even when they are the LRU', () => {
  // /watched is the oldest (would normally be evicted first) but is protected;
  // the newer /idle file is evicted instead.
  const files = [f('/watched.mp4', 100, 100), f('/idle.mp4', 100, 200)];
  const protectedSet = new Set(['/watched.mp4']);
  assert.deepEqual(selectEvictions(files, 100, protectedSet), ['/idle.mp4']);
});

// ---- cleanupOrphanTmp (filesystem) ----

test('cleanupOrphanTmp: removes *.tmp.mp4 and leaves finished files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-tmp-'));
  fs.writeFileSync(path.join(dir, 'a.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'b.tmp.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'c.tmp.mp4'), 'x');
  assert.equal(cleanupOrphanTmp(dir), 2);
  assert.ok(fs.existsSync(path.join(dir, 'a.mp4')), 'finished file kept');
  assert.ok(!fs.existsSync(path.join(dir, 'b.tmp.mp4')), 'orphan removed');
});

test('cleanupOrphanTmp: returns 0 for a missing directory', () => {
  assert.equal(cleanupOrphanTmp('/no/such/dir/here'), 0);
});

// ---- evictTranscodeCache (filesystem, uses TRANSCODE_DIR) ----

test('evictTranscodeCache: deletes LRU MP4s, protects the tmp + just-produced files', () => {
  for (const n of fs.readdirSync(TRANSCODE_DIR)) fs.unlinkSync(path.join(TRANSCODE_DIR, n));
  const write = (name, bytes, atimeSec) => {
    const p = path.join(TRANSCODE_DIR, name);
    fs.writeFileSync(p, Buffer.alloc(bytes));
    fs.utimesSync(p, new Date(atimeSec * 1000), new Date(atimeSec * 1000));
    return p;
  };
  const old = write('old.mp4', 100, 1000);
  const mid = write('mid.mp4', 100, 2000);
  const fresh = write('fresh.mp4', 100, 3000);
  const tmp = write('busy.tmp.mp4', 100, 500); // oldest, but in-flight

  // real total 300, cap 150, keep=fresh -> evict old + mid (oldest eligible)
  assert.equal(evictTranscodeCache(150, fresh), 2);
  assert.ok(!fs.existsSync(old), 'oldest evicted');
  assert.ok(!fs.existsSync(mid), 'next-oldest evicted');
  assert.ok(fs.existsSync(fresh), 'just-produced protected');
  assert.ok(fs.existsSync(tmp), 'in-flight tmp protected');
});
