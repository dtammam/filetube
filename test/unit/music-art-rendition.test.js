'use strict';

// v1.339 (L1, M2): lib/music/artRendition.js (the sized /albumart rendition cache)
// and lib/music/query.js artRepresentatives/artIdFor (one art URL per cover). The
// route half runs against the real app in test/integration/albumart-rendition.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../../lib/music/artRendition');
const q = require('../../lib/music/query');

test('parseArtSize: exactly the allowlist, as the query-string shape', () => {
  assert.deepEqual(R.ART_RENDITION_SIZES, [128, 256, 512]);
  for (const s of ['128', '256', '512']) assert.equal(R.parseArtSize(s), Number(s));
  for (const bad of ['300', '0128', '256abc', '-128', '', '1e3', ' 128', undefined, null, 256, ['128']]) {
    assert.equal(R.parseArtSize(bad), null, `refuses ${JSON.stringify(bad)}`);
  }
});

test('buildRenditionArgs: scales the short side, never upscales, even dims, escaped commas', () => {
  const args = R.buildRenditionArgs('/a/src.jpg', '/a/out.tmp.jpg', 256);
  assert.equal(args[args.length - 1], '/a/out.tmp.jpg', 'the output is the LAST argument');
  assert.ok(args.includes('/a/src.jpg'));
  const vf = args[args.indexOf('-vf') + 1];
  assert.equal(vf, 'scale=w=min(iw\\,max(256\\,256*iw/ih)):h=-2');
});

function fakeFs(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return fs;
}

function harness(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-artrend-'));
  const src = path.join(dir, 'src.jpg');
  fs.writeFileSync(src, 'ORIGINAL');
  const calls = [];
  const pending = [];
  const execFile = (bin, args, options, cb) => {
    calls.push({ bin, args, options });
    const finish = () => {
      if (opts.fail) { cb(new Error('boom')); return; }
      fs.writeFileSync(args[args.length - 1], opts.empty ? '' : 'SCALED');
      cb(null);
    };
    if (opts.manual) pending.push(finish); else setImmediate(finish);
  };
  const svc = R.createArtRenditions({
    dir: path.join(dir, 'sized'), fs: fakeFs(dir), path, execFile,
    ffmpegIsAvailable: () => opts.ffmpeg !== false,
  });
  return { dir, src, calls, pending, svc };
}

test('resolve: generates once, caches, and spawns with a hard timeout + SIGKILL', async () => {
  const h = harness();
  const out = await h.svc.resolve(h.src, 'abc123', 256);
  assert.equal(out, path.join(h.dir, 'sized', 'abc123-256.jpg'));
  assert.equal(fs.readFileSync(out, 'utf8'), 'SCALED');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].bin, 'ffmpeg');
  assert.equal(h.calls[0].options.killSignal, 'SIGKILL', 'a wedged ffmpeg is SIGKILLed');
  assert.equal(h.calls[0].options.timeout, R.RENDITION_TIMEOUT_MS);
  assert.ok(R.RENDITION_TIMEOUT_MS > 0);
  const again = await h.svc.resolve(h.src, 'abc123', 256);
  assert.equal(again, out);
  assert.equal(h.calls.length, 1, 'a cache hit spawns nothing');
});

test('resolve: single-flight - concurrent callers join ONE job (event-loop order, not timing)', async () => {
  const h = harness({ manual: true });
  const a = h.svc.resolve(h.src, 'k1', 128);
  const b = h.svc.resolve(h.src, 'k1', 128);
  const c = h.svc.resolve(h.src, 'k1', 512); // a different size is its own job
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.length, 2, 'k1-128 once + k1-512 once');
  assert.equal(h.svc.inFlightCount(), 2);
  h.pending.forEach((f) => f());
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(ra, rb);
  assert.ok(ra.endsWith('k1-128.jpg') && rc.endsWith('k1-512.jpg'));
  assert.equal(h.svc.inFlightCount(), 0, 'the in-flight entry is released');
});

test('resolve: every failure falls back to the SOURCE; a failure is remembered (no respawn)', async () => {
  const off = harness({ ffmpeg: false });
  assert.equal(await off.svc.resolve(off.src, 'k', 128), off.src, 'ffmpeg unavailable -> the original');
  assert.equal(off.calls.length, 0, 'and nothing is spawned');

  const bad = harness({ fail: true });
  assert.equal(await bad.svc.resolve(bad.src, 'k', 128), bad.src, 'a failing ffmpeg -> the original');
  assert.equal(await bad.svc.resolve(bad.src, 'k', 128), bad.src);
  assert.equal(bad.calls.length, 1, 'the failure is memoized for FAILURE_RETRY_MS');
  assert.deepEqual(fs.readdirSync(path.join(bad.dir, 'sized')), [], 'no tmp or rendition left behind');

  const empty = harness({ empty: true });
  assert.equal(await empty.svc.resolve(empty.src, 'k', 128), empty.src, 'an empty output is a failure');
  assert.deepEqual(fs.readdirSync(path.join(empty.dir, 'sized')), [], 'the empty tmp is removed');

  const missingSrc = harness();
  const gone = path.join(missingSrc.dir, 'nope.jpg');
  assert.equal(await missingSrc.svc.resolve(gone, 'k', 128), gone, 'a missing source is returned as-is (the route already checked it)');
  assert.equal(missingSrc.calls.length, 0);
});

test('resolve: refuses a non-allowlisted size or an unsafe cache key without spawning', async () => {
  const h = harness();
  assert.equal(await h.svc.resolve(h.src, 'k', 300), h.src);
  for (const key of ['../evil', 'a/b', '', 'x'.repeat(129), null]) {
    assert.equal(await h.svc.resolve(h.src, key, 128), h.src, `key ${JSON.stringify(key)}`);
  }
  assert.equal(h.calls.length, 0);
});

test('renditionPathsFor: every size of a key (the scan orphan prune unlinks these)', () => {
  const dir = R.renditionDirFor('/data/.albumart', path);
  assert.equal(dir, path.join('/data/.albumart', 'sized'));
  assert.deepEqual(R.renditionPathsFor(dir, 'kk', path), [128, 256, 512].map((s) => path.join(dir, `kk-${s}.jpg`)));
});

// ---- one art URL per cover (query.js) ---------------------------------------

test('artRepresentatives: tracks of one album share ONE art id, order-invariant', () => {
  const tracks = [
    { id: 'b2', albumArtKey: 'K1' }, { id: 'a9', albumArtKey: 'K1' }, { id: 'c1', albumArtKey: 'K1' },
    { id: 'z1', albumArtKey: 'K2' },
    { id: 'lib1', albumArtKey: null, source: 'library' },
  ];
  const reps = q.artRepresentatives(tracks);
  assert.equal(reps.get('K1'), 'a9', 'the lexicographically-lowest id of the album');
  assert.equal(reps.get('K2'), 'z1');
  assert.equal(reps.size, 2, 'an art-key-less (library) track has no representative');
  assert.deepEqual(q.artRepresentatives(tracks.slice().reverse()), reps, 'input order never flips the pick');
  const ids = tracks.slice(0, 3).map((t) => q.artIdFor(t, reps));
  assert.deepEqual(ids, ['a9', 'a9', 'a9'], 'every track of the album carries the same artId');
  assert.equal(q.artIdFor(tracks[3], reps), 'z1');
  assert.equal(q.artIdFor(tracks[4], reps), 'lib1', 'a library single keeps its own id');
  assert.equal(q.artIdFor({ id: 'med7::c3', albumArtKey: null, source: 'library-chapter' }, reps), 'med7', 'a chapter keys on its base file');
  assert.equal(q.artIdFor({ id: 'n1', albumArtKey: 'K9' }, reps), 'n1', 'a key with no representative falls back to the own id');
});

test('artRepresentatives: a track the caller filtered out (hidden) is NEVER the representative', () => {
  const all = [{ id: 'aaa-hidden', albumArtKey: 'K', hidden: true }, { id: 'bbb', albumArtKey: 'K' }, { id: 'ccc', albumArtKey: 'K' }];
  const visible = all.filter((t) => !t.hidden);
  const reps = q.artRepresentatives(visible);
  assert.equal(reps.get('K'), 'bbb');
  assert.equal(q.artIdFor(all[2], reps), 'bbb');
  // Divergent control: over the UNfiltered set the hidden id would win - the filter is what binds it.
  assert.equal(q.artRepresentatives(all).get('K'), 'aaa-hidden');
});

test('groupAlbums / groupArtists with reps: the card art id IS the song rows\' art id', () => {
  const tracks = [
    { id: 't2', album: 'A', artist: 'X', albumArtKey: 'KA', hasEmbeddedArt: true, trackNo: 2 },
    { id: 't1', album: 'A', artist: 'X', albumArtKey: 'KA', trackNo: 1 },
    { id: 'u5', album: 'B', artist: 'X', albumArtKey: 'KB', trackNo: 1 },
  ];
  const reps = q.artRepresentatives(tracks);
  const albums = q.groupAlbums(tracks, '', reps);
  assert.equal(albums.find((a) => a.album === 'A').artId, 't1', 'the album representative, not the embedded-art track');
  assert.equal(albums.find((a) => a.album === 'B').artId, 'u5');
  const artists = q.groupArtists(tracks, '', reps);
  assert.deepEqual(artists[0].artIds.slice().sort(), ['t1', 'u5']);
  // Without reps the historical representative stands (the unit contract others rely on).
  assert.equal(q.groupAlbums(tracks, '').find((a) => a.album === 'A').artId, 't2');
  assert.ok(!('_repTrack' in albums[0]) && !('track' in albums[0]), 'no internal field leaks into the payload');
});
