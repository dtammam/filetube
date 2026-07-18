'use strict';

// [UNIT] v1.44 T4 — the PURE helpers of lib/music/scan.js (no ffmpeg, no db):
// walkMusicRoot, findSidecarArt, the album-art job selector, and the orphaned-
// art selector. The full scan/prune wiring is covered end-to-end in
// test/integration/music-scan.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const scan = require('../../lib/music/scan');

test('T4: walkMusicRoot finds only music-extension files, recursively, skipping non-audio', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-walk-'));
  try {
    fs.mkdirSync(path.join(root, 'A/Album'), { recursive: true });
    fs.writeFileSync(path.join(root, 'A/Album/01 Song.flac'), 'x');
    fs.writeFileSync(path.join(root, 'A/Album/02 Song.mp3'), 'x');
    fs.writeFileSync(path.join(root, 'A/Album/cover.jpg'), 'x'); // not audio
    fs.writeFileSync(path.join(root, 'A/Album/notes.txt'), 'x'); // not audio
    const found = scan.walkMusicRoot(root).map((p) => path.basename(p)).sort();
    assert.deepEqual(found, ['01 Song.flac', '02 Song.mp3']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('T4: walkMusicRoot on an unreadable/nonexistent dir returns [] and never throws', () => {
  assert.doesNotThrow(() => scan.walkMusicRoot('/no/such/dir/ever'));
  assert.deepEqual(scan.walkMusicRoot('/no/such/dir/ever'), []);
});

test('T4: findSidecarArt returns the first preference-ordered cover, case-insensitively; null when none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-art-'));
  try {
    assert.equal(scan.findSidecarArt(dir), null, 'no sidecar -> null');
    fs.writeFileSync(path.join(dir, 'Folder.JPG'), 'x'); // case-insensitive match
    assert.equal(path.basename(scan.findSidecarArt(dir)), 'Folder.JPG');
    fs.writeFileSync(path.join(dir, 'cover.png'), 'x'); // cover.* precedes folder.*
    assert.equal(path.basename(scan.findSidecarArt(dir)), 'cover.png');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T4: selectAlbumArtJobs — one job per album lacking art; prefers an embedded-art representative', () => {
  const tracks = {
    a1: { filePath: '/m/A/01.flac', albumArtKey: 'k1', hasEmbeddedArt: false },
    a2: { filePath: '/m/A/02.flac', albumArtKey: 'k1', hasEmbeddedArt: true }, // preferred rep
    b1: { filePath: '/m/B/01.flac', albumArtKey: 'k2', hasEmbeddedArt: false },
  };
  const jobs = scan.selectAlbumArtJobs(tracks, () => false).sort((x, y) => x.albumArtKey.localeCompare(y.albumArtKey));
  assert.equal(jobs.length, 2, 'one job per album key');
  assert.equal(jobs[0].albumArtKey, 'k1');
  assert.equal(jobs[0].sourceFilePath, '/m/A/02.flac', 'embedded-art track chosen as representative');
  assert.equal(jobs[0].hasEmbeddedArt, true);
  // Albums that already have art are skipped.
  assert.equal(scan.selectAlbumArtJobs(tracks, (k) => k === 'k1').length, 1);
  assert.equal(scan.selectAlbumArtJobs(tracks, () => true).length, 0);
});

test('T4: selectOrphanedArtKeys — a key is orphaned ONLY when no surviving track references it', () => {
  const pruned = [
    { albumArtKey: 'gone' },
    { albumArtKey: 'shared' }, // still referenced by a survivor -> NOT orphaned
  ];
  const surviving = { s1: { albumArtKey: 'shared' } };
  assert.deepEqual(scan.selectOrphanedArtKeys(pruned, surviving), ['gone']);
  // Nothing pruned -> nothing orphaned.
  assert.deepEqual(scan.selectOrphanedArtKeys([], surviving), []);
});

test('GATE ADV-1: walkMusicRoot records an unreadable dir; selectPrunableTrackIds protects tracks UNDER it', () => {
  const store = require('../../lib/music/store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-eacces-'));
  try {
    fs.mkdirSync(path.join(root, 'Readable'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Readable/ok.flac'), 'x');
    const locked = path.join(root, 'Locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.writeFileSync(path.join(locked, 'hidden.flac'), 'x');
    fs.chmodSync(locked, 0o000);

    const erroredDirs = [];
    const found = scan.walkMusicRoot(root, erroredDirs).map((p) => path.basename(p));
    // The locked dir errored and is recorded; only the readable file surfaced.
    assert.ok(erroredDirs.includes(locked), 'the unreadable dir is recorded');
    assert.deepEqual(found, ['ok.flac']);

    // A previously-indexed track UNDER the locked dir is NOT prunable this pass
    // (its file is still on disk; the dir was merely unreadable).
    const tracks = {
      alive: { id: 'alive', rootFolder: root, filePath: path.join(root, 'Readable/ok.flac') },
      hidden: { id: 'hidden', rootFolder: root, filePath: path.join(locked, 'hidden.flac') },
      gone: { id: 'gone', rootFolder: root, filePath: path.join(root, 'Readable/deleted.flac') },
    };
    const prunable = store.selectPrunableTrackIds(tracks, new Set(['alive']), { missingRoots: new Set(), pruneMissing: true, erroredDirs });
    assert.deepEqual(prunable, ['gone'], 'the errored-subtree track is protected; a genuinely-deleted track still prunes');
  } finally {
    try { fs.chmodSync(path.join(root, 'Locked'), 0o755); } catch (_) { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('T4: albumArtKeyFor is a stable md5 of the album grouping key (same album -> same key)', () => {
  const t1 = { artist: 'A', album: 'X' };
  const t2 = { artist: 'A', album: 'X' };
  const t3 = { artist: 'A', album: 'Y' };
  assert.equal(scan.albumArtKeyFor(t1), scan.albumArtKeyFor(t2));
  assert.notEqual(scan.albumArtKeyFor(t1), scan.albumArtKeyFor(t3));
  assert.match(scan.albumArtKeyFor(t1), /^[0-9a-f]{32}$/);
});
