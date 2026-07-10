'use strict';

// [UNIT] v1.27.0 "Background audio for video": the transcode-cache lifecycle
// predicates (isCompletedTranscode, isInFlightTranscode, selectEvictions,
// selectAgedOut, cleanupOrphanTmp) widened to also recognize the
// background-audio `.m4a` sidecar alongside the pre-existing video `.mp4`
// transcode -- proving this is ONE coherent cache (mixed .mp4/.m4a
// eviction/age-sweep/orphan-cleanup), not a forked second cache subsystem.
// Isolated DATA_DIR before requiring the server (own process per test file),
// mirrors test/unit/transcode-cache.test.js / test/integration/age-sweep.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-audio-cache-'));
const TRANSCODE_DIR = path.join(process.env.DATA_DIR, 'transcoded');

const { test } = require('node:test');
const assert = require('node:assert');
const {
  isCompletedTranscode,
  isInFlightTranscode,
  selectEvictions,
  selectAgedOut,
  cleanupOrphanTmp,
  evictTranscodeCache,
  sweepAgedTranscodes,
} = require('../../server');

const f = (p, size, atimeMs) => ({ path: p, size, atimeMs });

// ---- isCompletedTranscode / isInFlightTranscode (pure) ------------------

test('isCompletedTranscode: recognizes a finished .m4a sidecar, same as a finished .mp4', () => {
  assert.equal(isCompletedTranscode('abc.mp4'), true);
  assert.equal(isCompletedTranscode('abc.m4a'), true);
});

test('isCompletedTranscode: excludes in-flight writes of BOTH kinds', () => {
  assert.equal(isCompletedTranscode('abc.tmp.mp4'), false);
  assert.equal(isCompletedTranscode('abc.tmp.m4a'), false);
});

test('isCompletedTranscode: rejects an unrelated extension', () => {
  assert.equal(isCompletedTranscode('abc.txt'), false);
  assert.equal(isCompletedTranscode('abc'), false);
});

test('isInFlightTranscode: true for *.tmp.mp4 and *.tmp.m4a, false for finished files', () => {
  assert.equal(isInFlightTranscode('/x/abc.tmp.mp4'), true);
  assert.equal(isInFlightTranscode('/x/abc.tmp.m4a'), true);
  assert.equal(isInFlightTranscode('/x/abc.mp4'), false);
  assert.equal(isInFlightTranscode('/x/abc.m4a'), false);
});

// ---- selectEvictions (pure) -- mixed .mp4/.m4a ---------------------------

test('selectEvictions: evicts least-recently-used first across a MIXED .mp4/.m4a set', () => {
  const files = [
    f('/new.m4a', 40, 300),
    f('/old.mp4', 40, 100),
    f('/mid.m4a', 40, 200),
  ];
  // total 120, cap 100 -> drop the oldest (old.mp4) -> 80 <= 100
  assert.deepEqual(selectEvictions(files, 100), ['/old.mp4']);
});

test('selectEvictions: excludes *.tmp.m4a from totals and never deletes it, alongside *.tmp.mp4', () => {
  const files = [
    f('/x.tmp.mp4', 1000, 1),
    f('/y.tmp.m4a', 1000, 1),
    f('/a.mp4', 40, 100),
    f('/b.m4a', 40, 200),
  ];
  // eligible total = 80 <= 100 (both tmp files excluded) -> nothing evicted
  assert.deepEqual(selectEvictions(files, 100), []);
});

test('selectEvictions: a just-produced .m4a is protected exactly like a just-produced .mp4', () => {
  const files = [f('/keep.m4a', 80, 500), f('/old.mp4', 40, 100)];
  assert.deepEqual(selectEvictions(files, 100, '/keep.m4a'), ['/old.mp4']);
});

// ---- selectAgedOut (pure) -- mixed .mp4/.m4a -----------------------------

test('selectAgedOut: ages out a stale .m4a sidecar exactly like a stale .mp4 transcode', () => {
  const now = 1_000_000_000;
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  const files = [
    f('/stale.m4a', 10, now - 40 * 24 * 60 * 60 * 1000), // 40 days old
    f('/fresh.mp4', 10, now - 1 * 24 * 60 * 60 * 1000),  // 1 day old
  ];
  assert.deepEqual(selectAgedOut(files, maxAgeMs, now), ['/stale.m4a']);
});

test('selectAgedOut: never returns an in-flight *.tmp.m4a even when very stale', () => {
  const now = 1_000_000_000;
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  const files = [f('/x.tmp.m4a', 10, now - 400 * 24 * 60 * 60 * 1000)];
  assert.deepEqual(selectAgedOut(files, maxAgeMs, now), []);
});

// ---- cleanupOrphanTmp (filesystem) -- mixed orphans ----------------------

test('cleanupOrphanTmp: removes BOTH orphan *.tmp.mp4 and *.tmp.m4a, leaves finished files of either kind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-mixed-tmp-'));
  fs.writeFileSync(path.join(dir, 'a.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'b.m4a'), 'x');
  fs.writeFileSync(path.join(dir, 'c.tmp.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'd.tmp.m4a'), 'x');
  assert.equal(cleanupOrphanTmp(dir), 2);
  assert.ok(fs.existsSync(path.join(dir, 'a.mp4')), 'finished video kept');
  assert.ok(fs.existsSync(path.join(dir, 'b.m4a')), 'finished audio sidecar kept');
  assert.ok(!fs.existsSync(path.join(dir, 'c.tmp.mp4')), 'orphan video tmp removed');
  assert.ok(!fs.existsSync(path.join(dir, 'd.tmp.m4a')), 'orphan audio tmp removed');
});

// ---- evictTranscodeCache / sweepAgedTranscodes (filesystem) -- mixed ----

test('evictTranscodeCache: LRU eviction spans BOTH .mp4 and .m4a in the SAME size-cap total', () => {
  for (const n of fs.readdirSync(TRANSCODE_DIR)) fs.unlinkSync(path.join(TRANSCODE_DIR, n));
  const write = (name, bytes, atimeSec) => {
    const p = path.join(TRANSCODE_DIR, name);
    fs.writeFileSync(p, Buffer.alloc(bytes));
    fs.utimesSync(p, new Date(atimeSec * 1000), new Date(atimeSec * 1000));
    return p;
  };
  const oldAudio = write('old.m4a', 100, 1000);
  const midVideo = write('mid.mp4', 100, 2000);
  const freshAudio = write('fresh.m4a', 100, 3000);

  // real total 300 (video + audio together), cap 150, keep=freshAudio ->
  // evict old.m4a + mid.mp4 (oldest-first, regardless of extension)
  assert.equal(evictTranscodeCache(150, freshAudio), 2);
  assert.ok(!fs.existsSync(oldAudio), 'oldest (audio) evicted');
  assert.ok(!fs.existsSync(midVideo), 'next-oldest (video) evicted');
  assert.ok(fs.existsSync(freshAudio), 'just-produced protected');
});

test('sweepAgedTranscodes: age-retention sweep removes a stale .m4a sidecar via its OWN db.metadata[id].lastServedAt', () => {
  for (const n of fs.readdirSync(TRANSCODE_DIR)) fs.unlinkSync(path.join(TRANSCODE_DIR, n));
  const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');
  const id = 'vid-aged-audio';
  const p = path.join(TRANSCODE_DIR, `${id}.m4a`);
  fs.writeFileSync(p, Buffer.alloc(10));
  const staleTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  fs.utimesSync(p, staleTime, staleTime);
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, lastServedAt: Date.now() - 90 * 24 * 60 * 60 * 1000 } },
    settings: { cacheMaxAgeDays: 30 },
  }, null, 2));

  const removed = sweepAgedTranscodes(Date.now());
  assert.equal(removed, 1);
  assert.ok(!fs.existsSync(p), 'stale .m4a sidecar aged out via its own lastServedAt, not a hardcoded .mp4 id derivation');
});

// ---- F1 (two-reviewer gate): eviction/aging clears the stale audioStatus --

test('evictTranscodeCache: clears audioStatus for an EVICTED .m4a sidecar, leaves an evicted .mp4\'s transcodeStatus untouched (matches the existing scan-lazy pattern)', async () => {
  for (const n of fs.readdirSync(TRANSCODE_DIR)) fs.unlinkSync(path.join(TRANSCODE_DIR, n));
  const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');
  const audioId = 'vid-evict-audio-status';
  const videoId = 'vid-evict-transcode-status';
  const write = (name, bytes, atimeSec) => {
    const p = path.join(TRANSCODE_DIR, name);
    fs.writeFileSync(p, Buffer.alloc(bytes));
    fs.utimesSync(p, new Date(atimeSec * 1000), new Date(atimeSec * 1000));
    return p;
  };
  const oldAudio = write(`${audioId}.m4a`, 100, 1000);
  const oldVideo = write(`${videoId}.mp4`, 100, 1100);
  const freshKeep = write('keep.m4a', 100, 9000);
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      [audioId]: { id: audioId, audioStatus: 'ready' },
      [videoId]: { id: videoId, transcodeStatus: 'ready' },
    },
  }, null, 2));

  const removed = evictTranscodeCache(100, freshKeep);
  assert.equal(removed, 2);
  assert.ok(!fs.existsSync(oldAudio) && !fs.existsSync(oldVideo), 'precondition: both evicted');

  // clearAudioStatus is fire-and-forget (updateDatabase's own async-mutex
  // chain) -- give it a tick to land, mirroring the audio-endpoint suite's
  // own recordServed-landing pattern.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(db.metadata[audioId].audioStatus, undefined, 'the evicted .m4a\'s stale audioStatus must be cleared');
  assert.equal(
    db.metadata[videoId].transcodeStatus, 'ready',
    'a deliberate divergence from the .mp4/transcodeStatus scan-lazy pattern (see clearAudioStatus\'s own comment) -- transcodeStatus is left untouched here, matching what evictTranscodeCache already does for it'
  );
});

test('sweepAgedTranscodes: clears audioStatus for an aged-out .m4a sidecar', async () => {
  for (const n of fs.readdirSync(TRANSCODE_DIR)) fs.unlinkSync(path.join(TRANSCODE_DIR, n));
  const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');
  const id = 'vid-aged-audio-status';
  const p = path.join(TRANSCODE_DIR, `${id}.m4a`);
  fs.writeFileSync(p, Buffer.alloc(10));
  const staleTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  fs.utimesSync(p, staleTime, staleTime);
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, audioStatus: 'ready', lastServedAt: Date.now() - 90 * 24 * 60 * 60 * 1000 } },
    settings: { cacheMaxAgeDays: 30 },
  }, null, 2));

  const removed = sweepAgedTranscodes(Date.now());
  assert.equal(removed, 1);

  await new Promise((resolve) => setTimeout(resolve, 50));
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(db.metadata[id].audioStatus, undefined, 'the aged-out .m4a\'s stale audioStatus must be cleared');
});
