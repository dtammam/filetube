'use strict';

// [UNIT] v1.374.0 (d) one cover art for a saved album (plan docs/exec-plans/completed/2026-10-08-v1374-music-pass-cover.md):
// lib/ytdlp/cover.js fetches the cover once (fixed host, maxres then hq, a non-200 / oversize / timeout is a failure),
// builds the exact ffmpeg argv, and rewrites a just-downloaded file ONLY when the ffprobe of the temp proves the audio,
// the duration, the tags, the chapters and one cover survived. Here the network and the two tools are injected: every
// failing branch is its own test and must leave the original file byte-identical with no temp behind. The real
// ffmpeg / ffprobe / yt-dlp run is the plan's end-to-end evidence (CI has no network and no ffmpeg).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const cover = require('../../lib/ytdlp/cover');
const album = require('../../lib/ytdlp/album');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cover-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// ---- the request: albumFrom's coverId ----
const IDS = ['vid00000001', 'vid00000002'];
const good = (extra) => Object.assign({ title: 'Brat', artist: 'Charli xcx', tracks: { vid00000001: 1 } }, extra || {});

test('albumFrom coverId: a valid id is kept - one of the job\'s ids or any other row\'s (the host is fixed)', () => {
  assert.strictEqual(album.albumFrom(good({ coverId: 'vid00000002' }), IDS).album.coverId, 'vid00000002');
  assert.strictEqual(album.albumFrom(good({ coverId: 'c1Paj8je5sM' }), IDS).album.coverId, 'c1Paj8je5sM', 'not ticked: still a valid cover');
});

test('albumFrom coverId: absent or null = no key at all (the album object a job always had)', () => {
  for (const v of [undefined, null]) {
    const r = album.albumFrom(good(v === undefined ? {} : { coverId: v }), IDS);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r.album, 'coverId'), false);
  }
});

test('albumFrom coverId: a malformed id, a URL, a path, NUL, a number are each refused with the album error', () => {
  const nul = String.fromCharCode(0);
  for (const bad of ['', 'https://i.ytimg.com/vi/x/maxresdefault.jpg', '../../etc', 'a/b', 'abc' + nul, 'a b', 'x'.repeat(65), 7, true, {}, ['vid00000001']]) {
    assert.deepStrictEqual(album.albumFrom(good({ coverId: bad }), IDS), { ok: false, error: 'Invalid album cover' }, JSON.stringify(bad));
  }
});

// ---- the image ----
test('coverImageUrls: built here on the fixed host, maxres first; nothing for an invalid id', () => {
  assert.deepStrictEqual(cover.coverImageUrls('c1Paj8je5sM'), ['https://i.ytimg.com/vi/c1Paj8je5sM/maxresdefault.jpg', 'https://i.ytimg.com/vi/c1Paj8je5sM/hqdefault.jpg']);
  assert.strictEqual(cover.coverImageUrls('a/b'), null);
  assert.strictEqual(cover.coverImageUrls('evil.com'), null);
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const resp = (status, bytes, headers) => ({
  status,
  headers: { get: (k) => (headers && headers[k.toLowerCase()]) || null },
  body: (() => { let sent = false; return { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(bytes || []) })), cancel: async () => {} }), cancel: async () => {} }; })(),
});

test('fetchCoverImage: maxres 404 (a placeholder body) -> hqdefault 200 is used', async () => {
  const asked = [];
  const r = await cover.fetchCoverImage('c1Paj8je5sM', { fetch: async (u, init) => { asked.push([u, init.redirect]); return u.endsWith('maxresdefault.jpg') ? resp(404, Buffer.alloc(1097, 1)) : resp(200, JPEG); } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.bytes, JPEG);
  assert.strictEqual(r.url, 'https://i.ytimg.com/vi/c1Paj8je5sM/hqdefault.jpg');
  assert.deepStrictEqual(asked.map((a) => a[1]), ['manual', 'manual'], 'a redirect is never followed');
});

test('fetchCoverImage: maxres 200 is used and hq never asked', async () => {
  const asked = [];
  const r = await cover.fetchCoverImage('c1Paj8je5sM', { fetch: async (u) => { asked.push(u); return resp(200, JPEG); } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(asked.length, 1);
});

test('fetchCoverImage: both 404 -> failure (the job skips the cover)', async () => {
  const r = await cover.fetchCoverImage('c1Paj8je5sM', { fetch: async () => resp(404, Buffer.alloc(1097, 1)) });
  assert.deepStrictEqual(r, { ok: false, reason: 'maxresdefault.jpg: HTTP 404; hqdefault.jpg: HTTP 404' });
});

test('fetchCoverImage: a redirect (302) is a failure, never followed', async () => {
  const r = await cover.fetchCoverImage('c1Paj8je5sM', { fetch: async () => resp(302, JPEG, { location: 'http://169.254.169.254/' }) });
  assert.deepStrictEqual(r, { ok: false, reason: 'maxresdefault.jpg: HTTP 302; hqdefault.jpg: HTTP 302' });
});

test('fetchCoverImage: oversize - by Content-Length, and by the bytes read when the length lies', async () => {
  const declared = await cover.fetchCoverImage('c1Paj8je5sM', { maxBytes: 10, fetch: async () => resp(200, JPEG, { 'content-length': '11' }) });
  assert.strictEqual(declared.ok, false);
  assert.match(declared.reason, /larger than 10 bytes/);
  const streamed = await cover.fetchCoverImage('c1Paj8je5sM', { maxBytes: 4, fetch: async () => resp(200, JPEG, { 'content-length': '3' }) });
  assert.strictEqual(streamed.ok, false);
  assert.match(streamed.reason, /larger than 4 bytes/);
});

test('fetchCoverImage: a timeout aborts the request and fails that size', async () => {
  const fetchImpl = (u, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const r = await cover.fetchCoverImage('c1Paj8je5sM', { timeoutMs: 20, fetch: fetchImpl });
  assert.deepStrictEqual(r, { ok: false, reason: 'maxresdefault.jpg: timed out; hqdefault.jpg: timed out' });
});

test('fetchCoverImage: an invalid id fetches nothing', async () => {
  let asked = 0;
  const r = await cover.fetchCoverImage('../x', { fetch: async () => { asked += 1; return resp(200, JPEG); } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(asked, 0);
});

// ---- the argv ----
test('embedCoverArgs: the exact mp3 argv (-copyts, stream copy, ID3v2.3 + v1, one attached picture, no overwrite)', () => {
  assert.deepStrictEqual(cover.embedCoverArgs('/m/a.mp3', '/c/cover.jpg', '/m/.t.tmp', 'mp3'), [
    '-nostdin', '-v', 'error', '-n', '-copyts', '-i', '/m/a.mp3', '-i', '/c/cover.jpg',
    '-map', '0:a', '-map', '1:0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy',
    '-id3v2_version', '3', '-write_id3v1', '1',
    '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', '-disposition:v:0', 'attached_pic',
    '-f', 'mp3', '/m/.t.tmp',
  ]);
});

test('embedCoverArgs: m4a has no ID3 flags and the ipod muxer; any other kind is refused', () => {
  assert.deepStrictEqual(cover.embedCoverArgs('/m/a.m4a', '/c/cover.jpg', '/m/.t.tmp', 'm4a'), [
    '-nostdin', '-v', 'error', '-n', '-copyts', '-i', '/m/a.m4a', '-i', '/c/cover.jpg',
    '-map', '0:a', '-map', '1:0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy',
    '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', '-disposition:v:0', 'attached_pic',
    '-f', 'ipod', '/m/.t.tmp',
  ]);
  assert.strictEqual(cover.embedCoverArgs('/m/a.opus', '/c/c.jpg', '/m/t', 'opus'), null);
});

test('cropSquareArgs: the input decoded only as a JPEG (-f jpeg_pipe), the centred square for maxresdefault', () => {
  assert.deepStrictEqual(cover.cropSquareArgs('/t/raw.jpg', '/t/cover.jpg', 'https://i.ytimg.com/vi/c1Paj8je5sM/maxresdefault.jpg'),
    ['-nostdin', '-v', 'error', '-n', '-f', 'jpeg_pipe', '-i', '/t/raw.jpg', '-vf', "crop='min(iw,ih)':'min(iw,ih)'", '-frames:v', '1', '-q:v', '2', '-f', 'image2', '-c:v', 'mjpeg', '/t/cover.jpg']);
});

test('cropSquareArgs: hqdefault (16:9 letterboxed in 4:3) takes its centred 16:9 band first, then the square', () => {
  assert.deepStrictEqual(cover.cropSquareArgs('/t/raw.jpg', '/t/cover.jpg', 'https://i.ytimg.com/vi/c1Paj8je5sM/hqdefault.jpg'),
    ['-nostdin', '-v', 'error', '-n', '-f', 'jpeg_pipe', '-i', '/t/raw.jpg', '-vf', "crop=iw:'trunc(iw*9/16)-4',crop='min(iw,ih)':'min(iw,ih)'", '-frames:v', '1', '-q:v', '2', '-f', 'image2', '-c:v', 'mjpeg', '/t/cover.jpg']);
  assert.strictEqual(cover.coverCropFilter(undefined), "crop='min(iw,ih)':'min(iw,ih)'", 'no source: the square only');
});

test('prepareAlbumCover crops by the source it actually got: maxres 404 -> the hqdefault filter', async () => {
  const runs = [];
  const run = async (cmd, argv) => { runs.push(argv); fs.writeFileSync(argv[argv.length - 1], JPEG); return { ok: true, code: 0, stdout: '', stderr: '' }; };
  const hq = await cover.prepareAlbumCover('c1Paj8je5sM', { tmpRoot: dir, run, fetch: async (u) => (u.endsWith('maxresdefault.jpg') ? resp(404, []) : resp(200, JPEG)) });
  assert.strictEqual(runs[0][runs[0].indexOf('-vf') + 1], cover.coverCropFilter('https://i.ytimg.com/vi/c1Paj8je5sM/hqdefault.jpg'));
  cover.releaseAlbumCover(hq);
  const mx = await cover.prepareAlbumCover('c1Paj8je5sM', { tmpRoot: dir, run, fetch: async () => resp(200, JPEG) });
  assert.strictEqual(runs[1][runs[1].indexOf('-vf') + 1], "crop='min(iw,ih)':'min(iw,ih)'");
  cover.releaseAlbumCover(mx);
});

test('the default tool runner reports a KILLED child by its signal (never "null"), an exit by its code', async () => {
  const killed = await cover.seams.run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], 100);
  assert.deepStrictEqual([killed.ok, killed.code], [false, 'SIGKILL']);
  const exited = await cover.seams.run(process.execPath, ['-e', 'process.exit(3)'], 5000);
  assert.deepStrictEqual([exited.ok, exited.code], [false, 3]);
  const fine = await cover.seams.run(process.execPath, ['-e', ''], 5000);
  assert.deepStrictEqual([fine.ok, fine.code], [true, 0]);
});

// ---- the verify (the rename decision) ----
const probeJson = (o = {}) => JSON.stringify({
  format: { duration: String(o.duration !== undefined ? o.duration : 118.728), tags: o.tags || { album: 'Brat', album_artist: 'Charli xcx', track: '2', title: 'Club classics', artist: 'Charli xcx' } },
  streams: o.streams || [{ codec_type: 'audio', codec_name: 'mp3', disposition: { attached_pic: 0 } }, { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }],
  chapters: (o.chapters || [0, 40, 90.5]).map((s) => ({ start_time: String(s) })),
});
const P = (o) => cover.parseProbe(probeJson(o));

test('verifyReembed: the same audio, duration, tags, chapters and one cover -> rename', () => {
  assert.deepStrictEqual(cover.verifyReembed(P(), P()), { ok: true });
  assert.deepStrictEqual(cover.verifyReembed(P({ duration: 118.728 }), P({ duration: 118.8 })), { ok: true }, 'within 0.1 s');
  assert.deepStrictEqual(cover.verifyReembed(P(), P({ chapters: [0, 40.0009, 90.5] })), { ok: true }, 'within 0.001 s');
  assert.deepStrictEqual(cover.verifyReembed(P({ tags: { album: 'Brat' } }), P({ tags: { ALBUM: 'Brat', encoder: 'x' } })), { ok: true }, 'keys compared case-blind; only what the original had');
  assert.deepStrictEqual(cover.verifyReembed(P({ tags: { title: 'T', encoder: 'Lavf60', synopsis: 'a' } }), P({ tags: { title: 'T', encoder: 'Lavf61' } })), { ok: true }, 'tags the scan never reads (encoder, synopsis) are not compared');
  assert.deepStrictEqual(cover.verifyReembed(P({ tags: { title: 'T', album_artist: 'A' } }), P({ tags: { title: 'T', 'album artist': 'A' } })), { ok: true }, 'an alias read as the same key is the same tag');
});

const ONE_AUDIO_NO_PIC = [{ codec_type: 'audio', codec_name: 'mp3', disposition: { attached_pic: 0 } }];
const branches = [
  ['no audio stream in the temp', P(), P({ streams: [{ codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }] }), 'no audio stream'],
  ['the original has no single audio stream', P({ streams: [] }), P(), 'the original has no single audio stream'],
  ['the audio codec changed', P(), P({ streams: [{ codec_type: 'audio', codec_name: 'aac', disposition: {} }, { codec_type: 'video', disposition: { attached_pic: 1 } }] }), 'the audio codec changed'],
  ['the duration moved by more than 0.1 s', P({ duration: 118.728 }), P({ duration: 118.829 }), 'the duration changed'],
  ['the duration shrank (a truncated write)', P({ duration: 118.728 }), P({ duration: 60 }), 'the duration changed'],
  ['no duration in the temp', P(), P({ duration: 'N/A' }), 'the duration changed'],
  ['a tag lost (album)', P(), P({ tags: { album_artist: 'Charli xcx', track: '2', title: 'Club classics', artist: 'Charli xcx' } }), 'the album tag changed'],
  ['a tag changed (track)', P(), P({ tags: { album: 'Brat', album_artist: 'Charli xcx', track: '3', title: 'Club classics', artist: 'Charli xcx' } }), 'the track tag changed'],
  ['a tag lost (album_artist, read as albumartist)', P(), P({ tags: { album: 'Brat', track: '2', title: 'Club classics', artist: 'Charli xcx' } }), 'the albumartist tag changed'],
  ['the date changed (an ID3v2.4 "20240101" written back as v2.3 "2024" - adversary, measured)', P({ tags: { title: 'T', date: '20240101' } }), P({ tags: { title: 'T', date: '2024' } }), 'the date tag changed'],
  ['the date lost (read from the year alias)', P({ tags: { title: 'T', year: '2024' } }), P({ tags: { title: 'T' } }), 'the date tag changed'],
  ['the disc changed', P({ tags: { title: 'T', disc: '1/2' } }), P({ tags: { title: 'T', disc: '1' } }), 'the disc tag changed'],
  ['the disc lost (read from the discnumber alias)', P({ tags: { title: 'T', discnumber: '2' } }), P({ tags: { title: 'T' } }), 'the disc tag changed'],
  ['the track lost (read from the tracknumber alias)', P({ tags: { title: 'T', tracknumber: '4' } }), P({ tags: { title: 'T' } }), 'the track tag changed'],
  ['the genre changed', P({ tags: { title: 'T', genre: 'Music' } }), P({ tags: { title: 'T', genre: 'Pop' } }), 'the genre tag changed'],
  ['the composer lost', P({ tags: { title: 'T', composer: 'X' } }), P({ tags: { title: 'T' } }), 'the composer tag changed'],
  ['the description lost', P({ tags: { title: 'T', description: 'D' } }), P({ tags: { title: 'T' } }), 'the description tag changed'],
  ['the comment lost (the source link)', P({ tags: { title: 'T', comment: 'https://www.youtube.com/watch?v=x' } }), P({ tags: { title: 'T' } }), 'the comment tag changed'],
  ['the show lost', P({ tags: { title: 'T', show: 'S' } }), P({ tags: { title: 'T' } }), 'the show tag changed'],
  ['the copyright lost', P({ tags: { title: 'T', copyright: 'C' } }), P({ tags: { title: 'T' } }), 'the copyright tag changed'],
  ['the purl lost (the scan reads the YouTube id from it)', P({ tags: { title: 'T', purl: 'https://www.youtube.com/watch?v=x' } }), P({ tags: { title: 'T' } }), 'the purl tag changed'],
  ['a tag lost (title)', P(), P({ tags: { album: 'Brat', album_artist: 'Charli xcx', track: '2', artist: 'Charli xcx' } }), 'the title tag changed'],
  ['a tag lost (artist)', P(), P({ tags: { album: 'Brat', album_artist: 'Charli xcx', track: '2', title: 'Club classics' } }), 'the artist tag changed'],
  ['a chapter lost', P(), P({ chapters: [0, 40] }), 'the chapter count changed'],
  ['a chapter moved 0.023 s (the no -copyts drift)', P(), P({ chapters: [0, 39.977, 90.477] }), 'a chapter moved'],
  ['no cover in the temp', P(), P({ streams: ONE_AUDIO_NO_PIC }), 'not exactly one cover'],
  ['two covers in the temp', P(), P({ streams: ONE_AUDIO_NO_PIC.concat([{ codec_type: 'video', disposition: { attached_pic: 1 } }, { codec_type: 'video', disposition: { attached_pic: 1 } }]) }), 'not exactly one cover'],
  ['an unreadable temp probe', P(), null, 'unreadable probe'],
];
for (const [name, before, after, reason] of branches) {
  test(`verifyReembed refuses: ${name}`, () => {
    assert.deepStrictEqual(cover.verifyReembed(before, after), { ok: false, reason });
  });
}

test('parseProbe: not a probe -> null', () => {
  assert.strictEqual(cover.parseProbe('not json'), null);
  assert.strictEqual(cover.parseProbe('{"streams":[]}'), null);
});

// ---- the rewrite: reembedCover with the tools injected ----
const ORIGINAL = Buffer.from('ID3 original bytes with the song\'s own art');
const REWRITTEN = Buffer.from('ID3 rewritten bytes with the album cover');
function seed(name = 'Song [vid00000001].mp3') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, ORIGINAL, { mode: 0o640 });
  const past = new Date('2026-01-02T03:04:05.678Z');
  fs.utimesSync(file, past, past);
  const coverPath = path.join(dir, 'cover.jpg');
  fs.writeFileSync(coverPath, JPEG);
  return { file, coverPath };
}
// a fake ffmpeg / ffprobe: ffmpeg writes REWRITTEN to its last arg; ffprobe answers per path
function tools(over = {}) {
  const seen = [];
  const run = async (cmd, argv) => {
    seen.push([cmd, argv]);
    const target = argv[argv.length - 1];
    if (cmd === 'ffmpeg') {
      if (over.ffmpeg) return over.ffmpeg(target, argv);
      fs.writeFileSync(target, REWRITTEN);
      return { ok: true, code: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'ffprobe') {
      const isTemp = cover.TEMP_NAME_RE.test(path.basename(target));
      if (over.probe) return over.probe(target, isTemp);
      return { ok: true, code: 0, stdout: probeJson(), stderr: '' };
    }
    throw new Error('unexpected ' + cmd);
  };
  return { run, seen };
}
const leftovers = () => fs.readdirSync(dir).filter((n) => cover.TEMP_NAME_RE.test(n));
function assertUntouched(file) {
  assert.deepStrictEqual(fs.readFileSync(file), ORIGINAL, 'the original is byte-identical');
  assert.deepStrictEqual(leftovers(), [], 'no temp left behind');
}

test('reembedCover: verified -> the temp replaces the file (same path), keeping its mode and mtime; no temp left', async () => {
  const { file, coverPath } = seed();
  const before = fs.statSync(file);
  const t = tools();
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: true });
  assert.deepStrictEqual(fs.readFileSync(file), REWRITTEN);
  const after = fs.statSync(file);
  assert.strictEqual(after.mode, before.mode);
  assert.strictEqual(Math.floor(after.mtimeMs), Math.floor(before.mtimeMs));
  assert.deepStrictEqual(leftovers(), []);
  const ff = t.seen.find(([c]) => c === 'ffmpeg')[1];
  const temp = ff[ff.length - 1];
  assert.strictEqual(path.dirname(temp), dir, 'the temp is in the SAME folder (an atomic rename)');
  assert.match(path.basename(temp), cover.TEMP_NAME_RE, 'a name the scan never indexes');
  assert.deepStrictEqual(ff, cover.embedCoverArgs(file, coverPath, temp, 'mp3'));
  assert.deepStrictEqual(t.seen.map(([c, a]) => [c, a[a.length - 1] === file ? 'file' : 'temp']), [['ffprobe', 'file'], ['ffmpeg', 'temp'], ['ffprobe', 'temp']]);
});

test('reembedCover: an m4a gets the m4a argv', async () => {
  const { file, coverPath } = seed('Song [vid00000001].M4A');
  const t = tools();
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: true });
  const ff = t.seen.find(([c]) => c === 'ffmpeg')[1];
  assert.ok(ff.includes('ipod') && !ff.includes('-id3v2_version'));
});

test('reembedCover keeps the file: ffmpeg fails (exit 1) after writing part of the temp (ENOSPC mid-write)', async () => {
  const { file, coverPath } = seed();
  const t = tools({ ffmpeg: (target) => { fs.writeFileSync(target, REWRITTEN.subarray(0, 5)); return { ok: false, code: 1, stdout: '', stderr: 'No space left on device' }; } });
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: false, reason: 'ffmpeg failed (1)' });
  assertUntouched(file);
});

test('reembedCover keeps the file: ffmpeg exits 0 but wrote nothing', async () => {
  const { file, coverPath } = seed();
  const t = tools({ ffmpeg: () => ({ ok: true, code: 0, stdout: '', stderr: '' }) });
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: false, reason: 'ENOENT' });
  assertUntouched(file);
});

test('reembedCover keeps the file: ffmpeg wrote an EMPTY temp', async () => {
  const { file, coverPath } = seed();
  const t = tools({ ffmpeg: (target) => { fs.writeFileSync(target, ''); return { ok: true, code: 0, stdout: '', stderr: '' }; } });
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: false, reason: 'ffmpeg wrote no file' });
  assertUntouched(file);
});

test('reembedCover keeps the file: the temp fails the verify (a chapter moved)', async () => {
  const { file, coverPath } = seed();
  const t = tools({ probe: (target, isTemp) => ({ ok: true, code: 0, stdout: isTemp ? probeJson({ chapters: [0, 39.977, 90.477] }) : probeJson(), stderr: '' }) });
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: false, reason: 'a chapter moved' });
  assertUntouched(file);
});

test('reembedCover keeps the file: the temp cannot be probed', async () => {
  const { file, coverPath } = seed();
  const t = tools({ probe: (target, isTemp) => (isTemp ? { ok: false, code: 1, stdout: '', stderr: 'Invalid data' } : { ok: true, code: 0, stdout: probeJson(), stderr: '' }) });
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: false, reason: 'unreadable probe' });
  assertUntouched(file);
});

test('reembedCover keeps the file: the ORIGINAL cannot be probed (nothing is written at all)', async () => {
  const { file, coverPath } = seed();
  const t = tools({ probe: () => ({ ok: false, code: 1, stdout: '', stderr: '' }) });
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: false, reason: 'the original could not be probed' });
  assert.strictEqual(t.seen.filter(([c]) => c === 'ffmpeg').length, 0);
  assertUntouched(file);
});

test('reembedCover keeps the file: a tool THROWS after the temp was written', async () => {
  const { file, coverPath } = seed();
  const t = tools({ probe: (target, isTemp) => { if (isTemp) throw Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' }); return { ok: true, code: 0, stdout: probeJson(), stderr: '' }; } });
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: false, reason: 'EAGAIN' });
  assertUntouched(file);
});

test('reembedCover keeps the file: it CHANGED while the cover was written (another writer) - the newer bytes stay', async () => {
  const { file, coverPath } = seed();
  const NEWER = Buffer.from('a newer file someone else wrote here');
  const t = tools({ ffmpeg: (target) => { fs.writeFileSync(target, REWRITTEN); fs.writeFileSync(file, NEWER); return { ok: true, code: 0, stdout: '', stderr: '' }; } });
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: false, reason: 'the file changed while the cover was written' });
  assert.deepStrictEqual(fs.readFileSync(file), NEWER);
  assert.deepStrictEqual(leftovers(), []);
});

test('reembedCover keeps the file: it was REMOVED while the cover was written - never resurrected', async () => {
  const { file, coverPath } = seed();
  const t = tools({ ffmpeg: (target) => { fs.writeFileSync(target, REWRITTEN); fs.unlinkSync(file); return { ok: true, code: 0, stdout: '', stderr: '' }; } });
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: t.run }), { ok: false, reason: 'the file changed while the cover was written' });
  assert.strictEqual(fs.existsSync(file), false);
  assert.deepStrictEqual(leftovers(), []);
});

test('reembedCover refuses a symlink, an opus file, a relative path, and a file already being re-embedded', async () => {
  const { file, coverPath } = seed();
  const link = path.join(dir, 'link.mp3');
  fs.symlinkSync(file, link);
  const t = tools();
  assert.deepStrictEqual(await cover.reembedCover(link, coverPath, { run: t.run }), { ok: false, reason: 'not a regular file' });
  const opus = path.join(dir, 'a.opus'); fs.writeFileSync(opus, ORIGINAL);
  assert.deepStrictEqual(await cover.reembedCover(opus, coverPath, { run: t.run }), { ok: false, reason: 'not an mp3 or m4a file' });
  assert.deepStrictEqual(await cover.reembedCover('rel.mp3', coverPath, { run: t.run }), { ok: false, reason: 'bad path' });
  assert.strictEqual(t.seen.length, 0, 'no tool ran for any of them');
  // the in-process claim: a second call for the same file while the first is in flight
  let release;
  const held = tools({ ffmpeg: (target) => { fs.writeFileSync(target, REWRITTEN); return new Promise((r) => { release = () => r({ ok: true, code: 0, stdout: '', stderr: '' }); }); } });
  const first = cover.reembedCover(file, coverPath, { run: held.run });
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(await cover.reembedCover(file, coverPath, { run: tools().run }), { ok: false, reason: 'already being re-embedded' });
  assert.strictEqual(leftovers().length, 1, 'the temp is on disk now');
  assert.strictEqual(cover.removeOrphanTemps(dir), 0, 'the orphan sweep never takes a temp in flight');
  assert.strictEqual(leftovers().length, 1);
  release();
  assert.deepStrictEqual(await first, { ok: true });
});

test('removeOrphanTemps: removes only our exact temp name (regular files), keeps everything else', () => {
  const orphan = path.join(dir, '.ftcover-1234-0123456789ab.tmp');
  fs.writeFileSync(orphan, 'x');
  const keep = ['Song.mp3', '.ftcover-1234-0123456789ab.tmp.mp3', 'ftcover-1234-0123456789ab.tmp', '.ftcover-x-0123456789ab.tmp', 'a.part'];
  keep.forEach((n) => fs.writeFileSync(path.join(dir, n), 'k'));
  fs.mkdirSync(path.join(dir, '.ftcover-1-aaaaaaaaaaaa.tmp'));
  const target = path.join(dir, 'Song.mp3');
  fs.symlinkSync(target, path.join(dir, '.ftcover-2-bbbbbbbbbbbb.tmp'));
  assert.strictEqual(cover.removeOrphanTemps(dir), 1);
  assert.strictEqual(fs.existsSync(orphan), false);
  keep.forEach((n) => assert.ok(fs.existsSync(path.join(dir, n)), n));
  assert.ok(fs.lstatSync(path.join(dir, '.ftcover-2-bbbbbbbbbbbb.tmp')).isSymbolicLink(), 'a symlink is not ours');
  assert.strictEqual(cover.removeOrphanTemps(path.join(dir, 'missing')), 0, 'a missing folder is nothing');
});

test('the temp name is not a media extension the scan indexes (server.js AUDIO_EXTENSIONS / VIDEO_EXTENSIONS)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  const list = (name) => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`).exec(src)[1].replace(/'/g, '"'));
  const exts = list('AUDIO_EXTENSIONS').concat(list('VIDEO_EXTENSIONS'));
  assert.ok(exts.includes('.mp3') && exts.includes('.mp4'), 'the lists were read (non-vacuous)');
  assert.ok(!exts.includes(path.extname('.ftcover-1-0123456789ab.tmp')), 'a temp is never indexed');
  assert.ok(cover.TEMP_NAME_RE.test('.ftcover-1-0123456789ab.tmp'));
});

// ---- the image prepare (fetch + crop) ----
test('prepareAlbumCover: fetched once, cropped by ffmpeg into a private folder; a crop that is not a JPEG fails and cleans up', async () => {
  const runs = [];
  const okRun = async (cmd, argv) => { runs.push(argv); fs.writeFileSync(argv[argv.length - 1], JPEG); return { ok: true, code: 0, stdout: '', stderr: '' }; };
  const r = await cover.prepareAlbumCover('c1Paj8je5sM', { tmpRoot: dir, run: okRun, fetch: async () => resp(200, JPEG) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(path.dirname(r.path), r.dir);
  assert.deepStrictEqual(runs[0], cover.cropSquareArgs(path.join(r.dir, 'raw.jpg'), r.path, 'https://i.ytimg.com/vi/c1Paj8je5sM/maxresdefault.jpg'));
  cover.releaseAlbumCover(r);
  assert.strictEqual(fs.existsSync(r.dir), false, 'released at the job end');
  const bad = await cover.prepareAlbumCover('c1Paj8je5sM', { tmpRoot: dir, run: async (c, argv) => { fs.writeFileSync(argv[argv.length - 1], 'not a jpeg'); return { ok: true, code: 0 }; }, fetch: async () => resp(200, JPEG) });
  assert.strictEqual(bad.ok, false);
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'nothing left in the temp root');
  const failed = await cover.prepareAlbumCover('c1Paj8je5sM', { tmpRoot: dir, run: okRun, fetch: async () => resp(404, []) });
  assert.strictEqual(failed.ok, false);
});

test('releaseAlbumCover never removes a folder that is not its own', () => {
  const other = path.join(dir, 'keep-me');
  fs.mkdirSync(other);
  cover.releaseAlbumCover({ dir: other });
  cover.releaseAlbumCover({ dir: '/' });
  cover.releaseAlbumCover(null);
  assert.ok(fs.existsSync(other));
});
