'use strict';

// [INTEGRATION] v1.387.0 offline playback, plan D2 + D3 - the download manifest, the
// offline file route and the status check, against the REAL server with REAL files
// on disk and a stub ffmpeg / ffprobe on PATH (the transcode queues and the HEVC
// tag probe spawn them). Every kind (all three `track` forms), the playability
// rule's three outcomes per route (original / transcode 503-and-queued / 409 not
// playable), visibility through restriction kinds that DIVERGE (LESSONS 10), the
// album and season collections omitting hidden members, Range + If-Range + suffix
// range + HEAD + ETag on the file route, a dot-named file, markServed on serve, a
// transcode eviction leaving the fingerprint unchanged, status ok / changed / gone,
// and the same answers through a device token. Also the plan's builder-confirm
// item: queueing a transcode for an MKV the BROWSER plays directly leaves the web's
// own playback untouched.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The stub ffmpeg writes 4096 zero bytes to its last argument (the queues' `<out>.tmp.mp4`);
// the stub ffprobe answers the HEVC tag probe from the file NAME (hvc1 / hev1 / nothing).
const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-offline-ffmpeg-'));
fs.writeFileSync(path.join(binDir, 'ffmpeg'), `#!/bin/bash
if [[ "$1" == "-version" ]]; then echo "ffmpeg version 0.0-filetube-test-stub"; exit 0; fi
last="\${@: -1}"
echo "frame=5 time=00:00:00.50 bitrate=ok" >&2
head -c 4096 /dev/zero > "$last"
exit 0
`, { mode: 0o755 });
fs.writeFileSync(path.join(binDir, 'ffprobe'), `#!/bin/bash
last="\${@: -1}"
if [[ "$last" == *hvc1* ]]; then echo '{"streams":[{"codec_name":"hevc","codec_tag_string":"hvc1"}]}'; exit 0; fi
if [[ "$last" == *hev1* ]]; then echo '{"streams":[{"codec_name":"hevc","codec_tag_string":"hev1"}]}'; exit 0; fi
echo '{"streams":[]}'
exit 0
`, { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-offline-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, updateDatabase, userStore, musicDb, tvDb, podcastsDb, __mintTestSession,
  transcodedPath, TRANSCODE_DIR, recentlyServed, flushPendingProgress,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const authCrypto = require('../../lib/auth/crypto');
const musicStore = require('../../lib/music/store');
const tvStore = require('../../lib/tv/store');
const podcastStore = require('../../lib/podcasts/store');

let server, base, auth, kid, kidToken;
const lib = path.join(DATA_DIR, 'lib');
const f = (rel, bytes) => { const full = path.join(lib, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, bytes); return full; };
const BYTES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; // 36 bytes: ranges are checked against these
let files = {};
let tracks = {};
const SUB = 'a'.repeat(32), HIDDEN_SUB = 'b'.repeat(32);
let epDownloaded, epPending, epHidden;
const SHOW_OK = 'show-kids', SHOW_BLK = 'show-adult';

function mkTrack(rel, meta) {
  const full = f(rel, BYTES);
  const id = crypto.createHash('md5').update(full).digest('hex');
  return Object.assign({ id, filePath: full, rootFolder: lib, ext: path.extname(full), addedAt: '2026-01-01T00:00:00.000Z', albumArtKey: null, durationSec: 200 }, meta);
}

before(async () => {
  files = {
    v1: f('Kids/cartoon.mp4', BYTES),
    mkv1: f('Kids/show.mkv', BYTES),
    hvc1: f('Kids/clip-hvc1.mp4', BYTES),
    hev1: f('Kids/clip-hev1.mp4', BYTES),
    failed1: f('Kids/broken.mkv', BYTES),
    hid: f('Adult/secret.mp4', BYTES),
    dot: f('Kids/.dot.mp4', BYTES),
    aud: f('Talks/long talk.m4a', BYTES),
    audHidden: f('AdultTalks/hush.m4a', BYTES),
  };
  fs.writeFileSync(path.join(lib, 'Kids', 'cartoon.en.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  const meta = (id, filePath, extra) => ({ id, title: id, filePath, folderName: path.basename(path.dirname(filePath)), rootFolder: lib, type: 'video', ext: path.extname(filePath), duration: 100, size: 36, addedAt: 1, hasThumbnail: false, ...extra });
  seedState({
    folders: [lib], folderSettings: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    metadata: {
      v1: meta('v1', files.v1, { codec: 'h264', audioCodec: 'aac', channelName: 'Kids Channel', chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 40, title: 'Middle' }], hasThumbnail: true }),
      mkv1: meta('mkv1', files.mkv1, { codec: 'h264', audioCodec: 'aac' }), // the browser plays this directly (needsTranscode false)
      hvc1: meta('hvc1', files.hvc1, { codec: 'hevc', audioCodec: 'aac' }),
      hev1: meta('hev1', files.hev1, { codec: 'hevc', audioCodec: 'aac' }),
      failed1: meta('failed1', files.failed1, { codec: 'h264', audioCodec: 'aac', needsTranscode: true, transcodeStatus: 'failed' }),
      hid: meta('hid', files.hid, { codec: 'h264', audioCodec: 'aac' }),
      dot: meta('dot', files.dot, { codec: 'h264', audioCodec: 'aac' }),
      aud: meta('aud', files.aud, { type: 'audio', codec: 'aac', duration: 90, tags: { artist: 'Speaker', album: 'Talks' }, chapters: [{ startTime: 0, title: 'One' }, { startTime: 30, title: 'Two' }, { startTime: 60, title: 'Three' }] }),
      audHidden: meta('audHidden', files.audHidden, { type: 'audio', codec: 'aac', duration: 90, tags: { artist: 'Nobody', album: 'Hush' } }),
    },
  });
  // Native music: an album of two tracks (one under a blocked path), a lone ogg.
  tracks = {
    a1: mkTrack('Music/Floyd/Wall/01 Mother.flac', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', title: 'Mother', trackNo: 1, codec: 'flac' }),
    a2: mkTrack('Music/Floyd/Wall/02 Hey.flac', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', title: 'Hey You', trackNo: 2, codec: 'flac' }),
    a3: mkTrack('Music/Blocked/Wall/03 Bricks.flac', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', title: 'Bricks', trackNo: 3, codec: 'flac' }),
    ogg: mkTrack('Music/Odd/song.ogg', { artist: 'Odd', albumArtist: 'Odd', album: 'Odd', title: 'Vorbis', trackNo: 1, codec: 'vorbis' }),
  };
  await updateDatabase(() => musicDb.mutate((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = {}; ns.folders = [path.join(lib, 'Music')];
    for (const t of Object.values(tracks)) ns.tracks[t.id] = t;
    return true;
  }));
  // Podcasts: a downloaded episode (confined under DATA_DIR/podcasts), a pending one, one on a hidden show.
  const showDir = path.join(DATA_DIR, 'podcasts', 'Show'); fs.mkdirSync(showDir, { recursive: true });
  fs.writeFileSync(path.join(showDir, 'ep1.mp3'), BYTES);
  const hiddenDir = path.join(DATA_DIR, 'podcasts', 'Hidden'); fs.mkdirSync(hiddenDir, { recursive: true });
  fs.writeFileSync(path.join(hiddenDir, 'h1.mp3'), BYTES);
  epDownloaded = podcastStore.episodeIdFor(SUB, 'g1');
  epPending = podcastStore.episodeIdFor(SUB, 'g2');
  epHidden = podcastStore.episodeIdFor(HIDDEN_SUB, 'h1');
  await updateDatabase(() => podcastsDb.mutate((h) => {
    const p = podcastStore.ensurePodcasts(h); p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: SUB, name: 'The Show', feedUrl: 'https://e.com/f.xml' });
    podcastStore.reduceAddSubscription(p, { id: HIDDEN_SUB, name: 'Hidden Show', feedUrl: 'https://e.com/h.xml' });
    podcastStore.reduceUpsertEpisodes(p, SUB, [{ guid: 'g1', title: 'Episode One', pubDateMs: 1, durationSec: 1800 }, { guid: 'g2', title: 'Episode Two', pubDateMs: 2, durationSec: 1700 }], 'pending', 5000);
    podcastStore.reduceUpsertEpisodes(p, HIDDEN_SUB, [{ guid: 'h1', title: 'Hush', pubDateMs: 1, durationSec: 100 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(p, epDownloaded, { fileName: 'ep1.mp3', filePath: path.join(showDir, 'ep1.mp3'), bytes: 36, nowMs: 6000 });
    podcastStore.reduceEpisodeDownloaded(p, epHidden, { fileName: 'h1.mp3', filePath: path.join(hiddenDir, 'h1.mp3'), bytes: 36, nowMs: 6000 });
    return true;
  }));
  // TV: a kids show (S1E1 mp4, S1E2 mkv, an Extra) and an adult show under a blocked root.
  const tvRoot = path.join(DATA_DIR, 'tv');
  const kids = path.join(tvRoot, 'Kids Show'); const adult = path.join(tvRoot, 'Adult Show');
  const e1 = f('../tv/Kids Show/Season 1/Kids Show S01E01 - Hello.mp4', BYTES);
  const e2 = f('../tv/Kids Show/Season 1/Kids Show S01E02 - Codec.mkv', BYTES);
  const ex = f('../tv/Kids Show/Extras/Making of.mp4', BYTES);
  const blk = f('../tv/Adult Show/Season 1/Adult Show S01E01 - Pilot.mp4', BYTES);
  await updateDatabase(() => tvDb.mutate((db) => {
    const ns = tvStore.ensureTv(db);
    ns.folders = [tvRoot];
    ns.episodes = {
      e1: { id: 'e1', filePath: e1, rootFolder: tvRoot, showId: SHOW_OK, showPath: kids, showName: 'Kids Show', seasonNum: 1, episodeNum: 1, title: 'Hello', ext: '.mp4', codec: 'h264', audioCodec: 'aac', durationSec: 100, addedAt: 1 },
      e2: { id: 'e2', filePath: e2, rootFolder: tvRoot, showId: SHOW_OK, showPath: kids, showName: 'Kids Show', seasonNum: 1, episodeNum: 2, title: 'Codec', ext: '.mkv', codec: 'h264', audioCodec: 'aac', durationSec: 100, addedAt: 2 },
      ex: { id: 'ex', filePath: ex, rootFolder: tvRoot, showId: SHOW_OK, showPath: kids, showName: 'Kids Show', seasonNum: null, episodeNum: null, title: 'Making of', ext: '.mp4', codec: 'h264', audioCodec: 'aac', durationSec: 50, addedAt: 3 },
      blk: { id: 'blk', filePath: blk, rootFolder: tvRoot, showId: SHOW_BLK, showPath: adult, showName: 'Adult Show', seasonNum: 1, episodeNum: 1, title: 'Pilot', ext: '.mp4', codec: 'h264', audioCodec: 'aac', durationSec: 100, addedAt: 4 },
    };
    return true;
  }));
  // The kid: a video FOLDER restriction (media-only kind), the podcast SHOW kind, a music PATH, a tv PATH.
  const k0 = __mintTestSession({ username: 'kid', role: 'member' });
  userStore.updatePassword(k0.user.id, await authCrypto.hashPassword('kid-password-1'));
  kid = __mintTestSession({ username: 'kid', role: 'member' });
  userStore.setRestrictions(kid.user.id, [
    { kind: 'folder', value: 'Adult' }, { kind: 'folder', value: 'AdultTalks' },
    { kind: 'show', value: HIDDEN_SUB },
    { kind: 'path', value: path.join(lib, 'Music', 'Blocked') },
    { kind: 'path', value: adult },
  ]);
  const paired = await fetch(`${base}/api/devices`, { method: 'POST', headers: { Cookie: kid.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Kid phone', platform: 'ios', password: 'kid-password-1' }) });
  assert.strictEqual(paired.status, 201);
  kidToken = (await paired.json()).token;
  // Wait for the async ffmpeg probe (the stub answers -version): the mkv's manifest flips to playable.
  for (let i = 0; i < 100; i++) {
    const m = await (await fetch(`${base}/api/offline/manifest?kind=video&id=mkv1`)).json();
    if (m.items && m.items[0].file.playable) break;
    await new Promise((r) => setTimeout(r, 50));
  }
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

const asAdmin = (p, opts) => fetch(`${base}${p}`, opts);
const asKid = (p, opts = {}) => fetch(`${base}${p}`, { ...opts, headers: { Cookie: kid.cookie, ...(opts.headers || {}) } });
const asKidToken = (p, opts = {}) => fetch(`${base}${p}`, { ...opts, headers: { Cookie: '', Authorization: `Bearer ${kidToken}`, ...(opts.headers || {}) } });
const manifest = async (kind, id, who = asAdmin) => { const r = await who(`/api/offline/manifest?kind=${kind}&id=${encodeURIComponent(id)}`); return { status: r.status, body: await r.json() }; };
const fileOf = (kind, id, opts, who = asAdmin) => who(`/api/offline/file/${kind}/${encodeURIComponent(id)}`, opts);
const fp = (p) => { const s = fs.statSync(p); return `${s.size}-${Math.round(s.mtimeMs)}`; };
async function waitFor(pred, ms = 5000) { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); return pred(); }

test('manifest (video): an mp4 h264/aac item is the original - every field, the SOURCE fingerprint, chapters, the subtitle sidecar, progress and the watched latch', async () => {
  userStore.setProgress(1, 'v1', { timestamp: 0, duration: 0, updatedAt: null }); // (cleared below if present)
  const uid = auth.user.id;
  userStore.setProgress(uid, 'v1', { timestamp: 42.5, duration: 100, updatedAt: '2026-10-01T00:00:00.000Z' });
  userStore.markWatched(uid, 'v1', '2026-10-01T00:00:00.000Z');
  const { status, body } = await manifest('video', 'v1');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.kind, 'video'); assert.strictEqual(body.id, 'v1'); assert.strictEqual(body.title, 'v1');
  assert.strictEqual(body.items.length, 1);
  const it = body.items[0];
  assert.deepStrictEqual(Object.keys(it).sort(), ['album', 'artwork', 'chapters', 'durationSec', 'episode', 'file', 'finished', 'id', 'kind', 'progress', 'season', 'subtitle', 'subtitles', 'title', 'trackNumber']);
  assert.strictEqual(it.subtitle, 'Kids Channel');
  assert.strictEqual(it.durationSec, 100);
  assert.deepStrictEqual(it.file, { url: '/api/offline/file/video/v1', bytes: 36, mime: 'video/mp4', fingerprint: fp(files.v1), ready: true, playable: true });
  assert.deepStrictEqual(it.artwork, { url: '/thumbnail/v1' });
  assert.deepStrictEqual(it.chapters, [{ startSec: 0, title: 'Intro' }, { startSec: 40, title: 'Middle' }]);
  assert.deepStrictEqual(it.subtitles, [{ lang: 'und', label: 'Subtitles', url: '/api/subtitles/v1' }]);
  assert.deepStrictEqual(it.progress, { positionSec: 42.5, durationSec: 100, updatedAt: '2026-10-01T00:00:00.000Z' });
  assert.strictEqual(it.finished, true);
  // An item never played: progress null, finished false, no artwork when there is no thumbnail.
  const dot = (await manifest('video', 'dot')).body.items[0];
  assert.strictEqual(dot.progress, null); assert.strictEqual(dot.finished, false); assert.strictEqual(dot.artwork, null);
  // Validation: a bad kind or id is a 400.
  assert.strictEqual((await manifest('book', 'x')).status, 400);
  assert.strictEqual((await asAdmin('/api/offline/manifest?kind=video')).status, 400);
  assert.strictEqual((await asAdmin('/api/offline/manifest?kind=video&id=' + 'x'.repeat(513))).status, 400);
});

test('file route (original): 200 with ETag, Last-Modified, Accept-Ranges, private no-store, the kind mime; Range, suffix range, If-Range and HEAD all work; a dot-named file serves', async () => {
  const full = await fileOf('video', 'v1');
  assert.strictEqual(full.status, 200);
  assert.strictEqual(await full.text(), BYTES);
  assert.strictEqual(full.headers.get('content-type'), 'video/mp4');
  assert.strictEqual(full.headers.get('cache-control'), 'private, no-store');
  assert.strictEqual(full.headers.get('accept-ranges'), 'bytes');
  assert.ok(full.headers.get('etag'), 'an ETag (the resume validator)');
  assert.ok(full.headers.get('last-modified'));
  assert.strictEqual(full.headers.get('x-content-type-options'), 'nosniff');
  const etag = full.headers.get('etag');
  const part = await fileOf('video', 'v1', { headers: { Range: 'bytes=2-5' } });
  assert.strictEqual(part.status, 206);
  assert.strictEqual(part.headers.get('content-range'), 'bytes 2-5/36');
  assert.strictEqual(await part.text(), 'CDEF');
  const suffix = await fileOf('video', 'v1', { headers: { Range: 'bytes=-4' } });
  assert.strictEqual(suffix.status, 206, 'a suffix range (sendRangeable has none; sendFile does)');
  assert.strictEqual(suffix.headers.get('content-range'), 'bytes 32-35/36');
  assert.strictEqual(await suffix.text(), '6789');
  const resume = await fileOf('video', 'v1', { headers: { Range: 'bytes=30-', 'If-Range': etag } });
  assert.strictEqual(resume.status, 206, 'If-Range with the current ETag resumes');
  assert.strictEqual(await resume.text(), 'UVWXYZ0123456789'.slice(-6));
  const stale = await fileOf('video', 'v1', { headers: { Range: 'bytes=30-', 'If-Range': '"not-the-etag"' } });
  assert.strictEqual(stale.status, 200, 'If-Range with a stale validator sends the whole file (the app restarts that file)');
  assert.strictEqual(await stale.text(), BYTES);
  const bad = await fileOf('video', 'v1', { headers: { Range: 'bytes=100-200' } });
  assert.strictEqual(bad.status, 416);
  const head = await fileOf('video', 'v1', { method: 'HEAD' });
  assert.strictEqual(head.status, 200);
  assert.strictEqual(head.headers.get('content-length'), '36');
  assert.strictEqual(await head.text(), '');
  // markServed: the served source is live in the LRU map.
  assert.ok(recentlyServed.has(files.v1), 'markServed on the served file');
  // A dot-named file (send 404s dot segments by default).
  const dot = await fileOf('video', 'dot');
  assert.strictEqual(dot.status, 200);
  assert.strictEqual(await dot.text(), BYTES);
  // Unknown kind / id: a neutral 404.
  assert.strictEqual((await fileOf('album', 'x')).status, 404);
  assert.strictEqual((await fileOf('video', 'nope')).status, 404);
});

test('file route (transcode): an mkv the browser plays directly is 503 + Retry-After 60 and QUEUED; once the stub finishes, the cached <id>.mp4 serves (marked served) while the SOURCE fingerprint stands; the web plays the original unchanged', async () => {
  const before = await manifest('video', 'mkv1');
  assert.deepStrictEqual(before.body.items[0].file, { url: '/api/offline/file/video/mkv1', bytes: null, mime: 'video/mp4', fingerprint: fp(files.mkv1), ready: false, playable: true }, 'playable but not ready: the transcode is not cached yet');
  const r = await fileOf('video', 'mkv1');
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.headers.get('retry-after'), '60');
  assert.deepStrictEqual(await r.json(), { error: 'transcoding' });
  const out = transcodedPath('mkv1');
  assert.ok(await waitFor(() => fs.existsSync(out)), 'the existing video queue produced TRANSCODE_DIR/<id>.mp4');
  assert.ok(out.startsWith(TRANSCODE_DIR));
  const served = await fileOf('video', 'mkv1');
  assert.strictEqual(served.status, 200);
  assert.strictEqual(served.headers.get('content-type'), 'video/mp4');
  assert.strictEqual((await served.arrayBuffer()).byteLength, 4096, 'the cached transcode, not the source');
  assert.ok(recentlyServed.has(out) && recentlyServed.has(files.mkv1), 'markServed on the rendition AND the source');
  const after = (await manifest('video', 'mkv1')).body.items[0].file;
  assert.deepStrictEqual(after, { url: '/api/offline/file/video/mkv1', bytes: 4096, mime: 'video/mp4', fingerprint: fp(files.mkv1), ready: true, playable: true }, 'bytes = the served file; fingerprint = the SOURCE (gate r1 W2)');
  // The web: the browser rule still plays the original (needsTranscode false), /video serves the source bytes.
  const detail = await (await asAdmin('/api/videos/mkv1')).json();
  assert.strictEqual(detail.needsTranscode, undefined === detail.needsTranscode ? undefined : false, 'needsTranscode is not set for an mkv h264/aac');
  assert.ok(!detail.needsTranscode, 'the web keeps playing the original');
  const web = await asAdmin('/video/mkv1');
  assert.strictEqual(web.status, 200);
  assert.strictEqual(await web.text(), BYTES, 'the web byte route serves the ORIGINAL, never the iOS transcode');
  // Eviction between two resumes: the cache file goes, the fingerprint is UNCHANGED (no re-download), ready flips.
  fs.unlinkSync(out);
  const evicted = (await manifest('video', 'mkv1')).body.items[0].file;
  assert.strictEqual(evicted.fingerprint, fp(files.mkv1));
  assert.strictEqual(evicted.ready, false);
  assert.strictEqual((await fileOf('video', 'mkv1')).status, 503, 'queued again');
  assert.ok(await waitFor(() => fs.existsSync(out)));
});

test('the HEVC tag: hvc1 serves the original (one lazy ffprobe, cached); hev1 takes the transcode side; a failed transcode is 409 not playable, terminal, and never queued', async () => {
  const hvc1 = (await manifest('video', 'hvc1')).body.items[0].file;
  assert.deepStrictEqual(hvc1, { url: '/api/offline/file/video/hvc1', bytes: 36, mime: 'video/mp4', fingerprint: fp(files.hvc1), ready: true, playable: true });
  assert.strictEqual((await fileOf('video', 'hvc1')).status, 200);
  const hev1 = (await manifest('video', 'hev1')).body.items[0].file;
  assert.strictEqual(hev1.ready, false); assert.strictEqual(hev1.playable, true);
  assert.strictEqual((await fileOf('video', 'hev1')).status, 503);
  const failed = (await manifest('video', 'failed1')).body.items[0].file;
  assert.deepStrictEqual(failed, { url: '/api/offline/file/video/failed1', bytes: null, mime: null, fingerprint: fp(files.failed1), ready: false, playable: false, reason: 'transcodeFailed' });
  const r = await fileOf('video', 'failed1');
  assert.strictEqual(r.status, 409);
  assert.deepStrictEqual(await r.json(), { error: 'not playable on this device', reason: 'transcodeFailed' });
  assert.ok(!fs.existsSync(transcodedPath('failed1')), 'nothing was queued for a failed item');
});

test('track, all three forms: a native flac is the original; an ogg is 409 not playable; a library audio item is the parent file with its chapters; a chapter row resolves to the SAME parent', async () => {
  const t = (await manifest('track', tracks.a1.id)).body.items[0];
  assert.strictEqual(t.kind, 'track'); assert.strictEqual(t.title, 'Mother'); assert.strictEqual(t.subtitle, 'Pink Floyd'); assert.strictEqual(t.album, 'The Wall'); assert.strictEqual(t.trackNumber, 1);
  assert.deepStrictEqual(t.file, { url: `/api/offline/file/track/${tracks.a1.id}`, bytes: 36, mime: 'audio/flac', fingerprint: fp(tracks.a1.filePath), ready: true, playable: true });
  assert.deepStrictEqual(t.artwork, { url: `/albumart/${tracks.a1.id}` });
  assert.strictEqual(t.finished, false, 'music has no latch');
  const r = await fileOf('track', tracks.a1.id);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('content-type'), 'audio/flac');
  userStore.setMusicProgress(auth.user.id, tracks.a1.id, { position: 12, duration: 200, updatedAt: '2026-10-02T00:00:00.000Z' });
  assert.deepStrictEqual((await manifest('track', tracks.a1.id)).body.items[0].progress, { positionSec: 12, durationSec: 200, updatedAt: '2026-10-02T00:00:00.000Z' });
  const ogg = (await manifest('track', tracks.ogg.id)).body.items[0].file;
  assert.strictEqual(ogg.playable, false); assert.strictEqual(ogg.reason, 'container');
  assert.strictEqual((await fileOf('track', tracks.ogg.id)).status, 409);
  // Library audio (correction 5): bytes are the media file, chapters are the file's, progress is the MEDIA store.
  userStore.setProgress(auth.user.id, 'aud', { timestamp: 35, duration: 90, updatedAt: '2026-10-03T00:00:00.000Z' });
  const aud = (await manifest('track', 'aud')).body.items[0];
  assert.strictEqual(aud.kind, 'track'); assert.strictEqual(aud.id, 'aud');
  assert.strictEqual(aud.subtitle, 'Speaker'); assert.strictEqual(typeof aud.album, 'string');
  assert.deepStrictEqual(aud.file, { url: '/api/offline/file/track/aud', bytes: 36, mime: 'audio/mp4', fingerprint: fp(files.aud), ready: true, playable: true });
  assert.deepStrictEqual(aud.chapters, [{ startSec: 0, title: 'One' }, { startSec: 30, title: 'Two' }, { startSec: 60, title: 'Three' }]);
  assert.deepStrictEqual(aud.progress, { positionSec: 35, durationSec: 90, updatedAt: '2026-10-03T00:00:00.000Z' });
  const ch = (await manifest('track', 'aud::c1')).body;
  assert.strictEqual(ch.id, 'aud::c1', 'the requested id is echoed');
  assert.strictEqual(ch.items.length, 1); assert.strictEqual(ch.items[0].id, 'aud', 'the PARENT file, once');
  assert.deepStrictEqual(ch.items[0].chapters, aud.chapters);
  const chFile = await fileOf('track', 'aud::c1');
  assert.strictEqual(chFile.status, 200, 'the file route resolves a chapter row to its parent too');
  assert.strictEqual(await chFile.text(), BYTES);
  assert.strictEqual((await manifest('track', 'aud::c9')).status, 404, 'a chapter that does not exist');
});

test('album: the albumKeyFor id, visible tracks in album order; a hidden member (path restriction) is omitted; a chaptered file is one item; all-hidden is a 404', async () => {
  const key = musicStore.albumKeyFor(tracks.a1);
  const adminAlbum = (await manifest('album', key)).body;
  assert.strictEqual(adminAlbum.title, 'The Wall');
  assert.deepStrictEqual(adminAlbum.items.map((i) => i.title), ['Mother', 'Hey You', 'Bricks']);
  const kidAlbum = (await manifest('album', key, asKid)).body;
  assert.deepStrictEqual(kidAlbum.items.map((i) => i.title), ['Mother', 'Hey You'], 'the blocked-path track is omitted silently');
  assert.deepStrictEqual((await manifest('album', key, asKidToken)).body.items.map((i) => i.title), ['Mother', 'Hey You'], 'the same through the device token');
  // The chaptered file: Music lists it as an album named by the FILE title (the real /api/music row says so).
  const row = await (await asAdmin('/api/music/aud::c0')).json();
  const audItem = (await manifest('track', 'aud')).body.items[0];
  assert.strictEqual(audItem.album, row.album, 'the manifest names the album the Music list shows');
  const talks = (await manifest('album', musicStore.albumKeyFor({ albumArtist: audItem.subtitle, album: audItem.album }))).body;
  assert.strictEqual(talks.items.length, 1, 'three chapter rows, one parent file');
  assert.strictEqual(talks.items[0].id, 'aud');
  assert.strictEqual((await manifest('album', musicStore.albumKeyFor({ albumArtist: 'Speaker', album: 'Talks' }))).status, 404, 'the TAG album is not an album Music shows for a chaptered file');
  assert.strictEqual((await manifest('album', 'Nobody\u0000Nope')).status, 400, 'a NUL id');
  assert.strictEqual((await manifest('album', 'Nobody - Nothing')).status, 404);
  const hush = (await manifest('album', musicStore.albumKeyFor({ albumArtist: 'Nobody', album: 'Hush' }))).status;
  assert.strictEqual(hush, 200, 'the admin sees the AdultTalks album');
  assert.strictEqual((await manifest('album', musicStore.albumKeyFor({ albumArtist: 'Nobody', album: 'Hush' }), asKid)).status, 404, 'every member hidden (folder restriction on library audio) = 404');
});

test('visibility with DIVERGING restriction kinds (LESSONS 10): the kid is 404 on a hidden video (folder), a library-audio track under a hidden folder, a hidden podcast show and a blocked tv path - manifest, file AND status; through the cookie and the token alike', async () => {
  for (const who of [asKid, asKidToken]) {
    assert.strictEqual((await manifest('video', 'hid', who)).status, 404);
    assert.strictEqual((await fileOf('video', 'hid', {}, who)).status, 404);
    assert.strictEqual((await manifest('track', 'audHidden', who)).status, 404, 'a {kind:folder} restriction binds a LIBRARY-audio track through the MEDIA gate');
    assert.strictEqual((await fileOf('track', 'audHidden', {}, who)).status, 404);
    assert.strictEqual((await manifest('podcastEpisode', epHidden, who)).status, 404);
    assert.strictEqual((await fileOf('podcastEpisode', epHidden, {}, who)).status, 404);
    assert.strictEqual((await manifest('tvEpisode', 'blk', who)).status, 404);
    assert.strictEqual((await fileOf('tvEpisode', 'blk', {}, who)).status, 404);
    assert.strictEqual((await manifest('tvSeason', `${SHOW_BLK}:1`, who)).status, 404);
    assert.strictEqual((await manifest('video', 'v1', who)).status, 200, 'discrimination: the visible one answers');
    const st = await who('/api/offline/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [
      { kind: 'video', id: 'hid', fingerprint: fp(files.hid) }, { kind: 'track', id: 'audHidden', fingerprint: fp(files.audHidden) },
      { kind: 'podcastEpisode', id: epHidden, fingerprint: 'x' }, { kind: 'tvEpisode', id: 'blk', fingerprint: 'x' },
      { kind: 'video', id: 'v1', fingerprint: fp(files.v1) },
    ] }) });
    assert.strictEqual(st.status, 200);
    assert.deepStrictEqual((await st.json()).items.map((i) => i.state), ['gone', 'gone', 'gone', 'gone', 'ok'], 'hidden = gone (the restriction wins on the phone too)');
  }
  // The admin sees them all.
  assert.strictEqual((await manifest('video', 'hid')).status, 200);
  assert.strictEqual((await manifest('track', 'audHidden')).status, 200);
  assert.strictEqual((await manifest('podcastEpisode', epHidden)).status, 200);
  assert.strictEqual((await manifest('tvEpisode', 'blk')).status, 200);
});

test('podcastEpisode: a downloaded episode is the original with the show as subtitle, the show art, podcast progress and the played latch; a pending episode is 409 not on server yet', async () => {
  userStore.setPodcastProgress(auth.user.id, epDownloaded, { position: 600, duration: 1800, updatedAt: '2026-10-04T00:00:00.000Z' });
  userStore.setPodcastPlayed(auth.user.id, epDownloaded, '2026-10-04T00:00:00.000Z');
  const m = (await manifest('podcastEpisode', epDownloaded)).body;
  const it = m.items[0];
  assert.strictEqual(it.title, 'Episode One'); assert.strictEqual(it.subtitle, 'The Show'); assert.strictEqual(it.durationSec, 1800);
  assert.deepStrictEqual(it.file, { url: `/api/offline/file/podcastEpisode/${epDownloaded}`, bytes: 36, mime: 'audio/mpeg', fingerprint: fp(path.join(DATA_DIR, 'podcasts', 'Show', 'ep1.mp3')), ready: true, playable: true });
  assert.deepStrictEqual(it.artwork, { url: `/podcastart/${SUB}` });
  assert.deepStrictEqual(it.progress, { positionSec: 600, durationSec: 1800, updatedAt: '2026-10-04T00:00:00.000Z' });
  assert.strictEqual(it.finished, true);
  const r = await fileOf('podcastEpisode', epDownloaded);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('content-type'), 'audio/mpeg'); assert.strictEqual(await r.text(), BYTES);
  const pending = await manifest('podcastEpisode', epPending);
  assert.strictEqual(pending.status, 409);
  assert.deepStrictEqual(pending.body, { error: 'not on server yet' });
  assert.strictEqual((await fileOf('podcastEpisode', epPending)).status, 409);
  assert.strictEqual((await manifest('podcastEpisode', 'f'.repeat(32))).status, 404);
});

test('tvEpisode and tvSeason: season and episode numbers, the tv thumb, tv progress and the played latch; an mkv episode takes the TV-owned rendition (tv-<id>.mp4); the season id <showId>:<key> lists visible episodes in order, Extras under :x', async () => {
  userStore.setTvProgress(auth.user.id, 'e1', { position: 30, duration: 100, updatedAt: '2026-10-05T00:00:00.000Z' });
  userStore.setTvPlayed(auth.user.id, 'e1', '2026-10-05T00:00:00.000Z');
  const e1 = (await manifest('tvEpisode', 'e1')).body.items[0];
  assert.strictEqual(e1.title, 'Hello'); assert.strictEqual(e1.subtitle, 'Kids Show'); assert.strictEqual(e1.season, 1); assert.strictEqual(e1.episode, 1);
  assert.deepStrictEqual(e1.file, { url: '/api/offline/file/tvEpisode/e1', bytes: 36, mime: 'video/mp4', fingerprint: fp(path.join(DATA_DIR, 'tv', 'Kids Show', 'Season 1', 'Kids Show S01E01 - Hello.mp4')), ready: true, playable: true });
  assert.deepStrictEqual(e1.artwork, { url: '/tvthumb/e1' });
  assert.deepStrictEqual(e1.progress, { positionSec: 30, durationSec: 100, updatedAt: '2026-10-05T00:00:00.000Z' });
  assert.strictEqual(e1.finished, true);
  assert.deepStrictEqual(e1.subtitles, [], 'TV has no sidecar route (disclosed)');
  assert.strictEqual((await fileOf('tvEpisode', 'e1')).status, 200);
  // The mkv episode: 503 and queued through the tv queue, then the tv rendition serves.
  const e2 = (await manifest('tvEpisode', 'e2')).body.items[0];
  assert.strictEqual(e2.file.ready, false); assert.strictEqual(e2.file.playable, true);
  assert.strictEqual((await fileOf('tvEpisode', 'e2')).status, 503);
  const rendition = path.join(TRANSCODE_DIR, 'tv-e2.mp4');
  assert.ok(await waitFor(() => fs.existsSync(rendition)), 'the tv-owned queue produced tv-<id>.mp4');
  assert.ok(!fs.existsSync(transcodedPath('e2')), 'never the video queue for a tv id');
  const served = await fileOf('tvEpisode', 'e2');
  assert.strictEqual(served.status, 200);
  assert.strictEqual((await served.arrayBuffer()).byteLength, 4096);
  assert.ok(recentlyServed.has(rendition));
  // The season.
  const season = (await manifest('tvSeason', `${SHOW_OK}:1`)).body;
  assert.strictEqual(season.title, 'Kids Show - Season 1');
  assert.deepStrictEqual(season.items.map((i) => [i.id, i.season, i.episode]), [['e1', 1, 1], ['e2', 1, 2]]);
  const extras = (await manifest('tvSeason', `${SHOW_OK}:x`)).body;
  assert.deepStrictEqual(extras.items.map((i) => [i.id, i.season, i.episode]), [['ex', null, null]]);
  assert.strictEqual((await manifest('tvSeason', `${SHOW_OK}:2`)).status, 404);
  assert.strictEqual((await manifest('tvSeason', SHOW_OK)).status, 404, 'no season key');
  assert.strictEqual((await manifest('tvSeason', `${SHOW_OK}:`)).status, 404);
  assert.strictEqual((await manifest('tvSeason', `${SHOW_BLK}:1`)).status, 200, 'the admin sees the adult season');
});

test('status: ok / changed / gone per item in order (moved = a new id = gone; a changed file = changed), the 500 cap and the shape rules', async () => {
  const body = { items: [
    { kind: 'video', id: 'v1', fingerprint: fp(files.v1) },
    { kind: 'video', id: 'v1', fingerprint: '1-1' },
    { kind: 'video', id: 'gone-id', fingerprint: '1-1' },
    { kind: 'track', id: tracks.a1.id, fingerprint: fp(tracks.a1.filePath) },
    { kind: 'track', id: 'aud::c2', fingerprint: fp(files.aud) },
    { kind: 'podcastEpisode', id: epPending, fingerprint: 'x' },
    { kind: 'podcastEpisode', id: epDownloaded, fingerprint: fp(path.join(DATA_DIR, 'podcasts', 'Show', 'ep1.mp3')) },
    { kind: 'tvEpisode', id: 'e1', fingerprint: 'stale' },
  ] };
  const r = await asAdmin('/api/offline/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.strictEqual(r.status, 200);
  const out = (await r.json()).items;
  assert.deepStrictEqual(out.map((i) => i.state), ['ok', 'changed', 'gone', 'ok', 'ok', 'gone', 'ok', 'changed']);
  assert.deepStrictEqual(out[4], { kind: 'track', id: 'aud::c2', state: 'ok' }, 'a chapter row re-checks its parent file');
  // A deleted file is gone even while the db still lists it.
  const tmp = f('Kids/temp.mp4', BYTES);
  seedState({ metadata: { ...require('../../server').getCachedDatabase().metadata, tmp: { id: 'tmp', title: 'tmp', filePath: tmp, folderName: 'Kids', rootFolder: lib, type: 'video', ext: '.mp4', duration: 1, size: 36, addedAt: 9 } } });
  const okFirst = await (await asAdmin('/api/offline/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ kind: 'video', id: 'tmp', fingerprint: fp(tmp) }] }) })).json();
  assert.strictEqual(okFirst.items[0].state, 'ok');
  fs.unlinkSync(tmp);
  const goneNow = await (await asAdmin('/api/offline/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ kind: 'video', id: 'tmp', fingerprint: '36-1' }] }) })).json();
  assert.strictEqual(goneNow.items[0].state, 'gone');
  // Shapes.
  const post = (b) => asAdmin('/api/offline/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  assert.strictEqual((await post({})).status, 400);
  assert.strictEqual((await post({ items: [{ kind: 'album', id: 'x', fingerprint: 'y' }] })).status, 400, 'collections are not status items');
  assert.strictEqual((await post({ items: [{ kind: 'video', id: 'x' }] })).status, 400, 'fingerprint required');
  assert.strictEqual((await post({ items: Array.from({ length: 501 }, () => ({ kind: 'video', id: 'v1', fingerprint: 'x' })) })).status, 400);
  assert.strictEqual((await post({ items: Array.from({ length: 500 }, () => ({ kind: 'video', id: 'v1', fingerprint: 'x' })) })).status, 200);
  assert.strictEqual((await post({ items: [] })).status, 200);
});

test('a hidden single item is a NEUTRAL 404 indistinguishable from a missing one; the manifest never names a path', async () => {
  const hidden = await asKid('/api/offline/manifest?kind=video&id=hid');
  const missing = await asKid('/api/offline/manifest?kind=video&id=does-not-exist');
  assert.strictEqual(hidden.status, 404); assert.strictEqual(missing.status, 404);
  assert.deepStrictEqual(await hidden.json(), await missing.json());
  const text = JSON.stringify((await manifest('video', 'v1')).body);
  assert.ok(!text.includes(DATA_DIR), 'no absolute path rides the manifest');
  await flushPendingProgress();
});
