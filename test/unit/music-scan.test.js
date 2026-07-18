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

test('T4: albumArtKeyFor is a stable md5 of the album grouping key (same album -> same key)', () => {
  const t1 = { artist: 'A', album: 'X' };
  const t2 = { artist: 'A', album: 'X' };
  const t3 = { artist: 'A', album: 'Y' };
  assert.equal(scan.albumArtKeyFor(t1), scan.albumArtKeyFor(t2));
  assert.notEqual(scan.albumArtKeyFor(t1), scan.albumArtKeyFor(t3));
  assert.match(scan.albumArtKeyFor(t1), /^[0-9a-f]{32}$/);
});
