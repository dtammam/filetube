'use strict';

// [UNIT] v1.319 Chapter Snap - the pure core (lib/media/chapterSnap.js) and the
// silence scan + cache (lib/media/chapterSilence.js). The route-level behaviour
// (RBAC, version refusal, likes staying put, revert from storage, a REAL ffmpeg
// run) is bound in test/integration/chapter-snap.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const snap = require('../../lib/media/chapterSnap');
const silence = require('../../lib/media/chapterSilence');

// VERBATIM stderr of `ffmpeg 7.0.2-static -hide_banner -nostats -nostdin -i
// probe.mp3 -vn -sn -dn -af silencedetect=noise=-45dB:d=0.5 -f null -` over a
// file generated as tone 4s, silence 1.5s, tone 2s, silence 0.3s, tone 2s,
// silence 1.2s (captured 2026-09-24 while building this feature; the 0.3s dip
// is BELOW the half-second floor and correctly reports nothing).
const REAL_CAPTURE = [
  "Input #0, mp3, from 'chapter-snap-probe2.mp3':",
  '  Metadata:',
  '    encoder         : Lavf61.1.100',
  '  Duration: 00:00:11.05, start: 0.025057, bitrate: 64 kb/s',
  '  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 64 kb/s',
  'Stream mapping:',
  '  Stream #0:0 -> #0:0 (mp3 (mp3float) -> pcm_s16le (native))',
  "Output #0, null, to 'pipe:':",
  '  Metadata:',
  '    encoder         : Lavf61.1.100',
  '  Stream #0:0: Audio: pcm_s16le, 44100 Hz, mono, s16, 705 kb/s',
  '      Metadata:',
  '        encoder         : Lavc61.3.100 pcm_s16le',
  '[silencedetect @ 0x7ab794002540] silence_start: 4',
  '[silencedetect @ 0x7ab794002540] silence_end: 5.500023 | silence_duration: 1.500023',
  '[silencedetect @ 0x7ab794002540] silence_start: 9.8',
  '[silencedetect @ 0x7ab794002540] silence_end: 11 | silence_duration: 1.2',
  '[out#0/null @ 0x323e3b00] video:0KiB audio:947KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown',
  'size=N/A time=00:00:11.00 bitrate=N/A speed=1.32e+03x',
].join('\n');

test('parseSilenceDetectOutput reads the REAL ffmpeg capture into silences (integer and fractional stamps, EOF-terminated trailing gap)', () => {
  assert.deepStrictEqual(silence.parseSilenceDetectOutput(REAL_CAPTURE, 11.05), [
    { start: 4, end: 5.5 },
    { start: 9.8, end: 11 },
  ]);
});

test('parser edges: a negative pre-roll start clamps to 0, an unterminated trailing start closes at the duration (older ffmpeg), non-detector lines naming the words are ignored', () => {
  const text = [
    "Input #0, mp3, from 'silence_start: 99 trap.mp3':",
    '[silencedetect @ 0x1] silence_start: -0.0123',
    '[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1.51',
    '[silencedetect @ 0x1] silence_end: 3 | silence_duration: 1', // an end without a start: dropped
    '[silencedetect @ 0x1] silence_start: 7.25',
  ].join('\r\n');
  assert.deepStrictEqual(silence.parseSilenceDetectOutput(text, 9), [{ start: 0, end: 1.5 }, { start: 7.25, end: 9 }]);
  assert.deepStrictEqual(silence.parseSilenceDetectOutput(text, null), [{ start: 0, end: 1.5 }], 'no duration: the open gap is dropped, never invented');
  // A NON-detector line mid-stream (a decoder warning quoting the words) after the last
  // real gap closed must not open a phantom gap to the end of the file.
  const midStream = [
    '[silencedetect @ 0x1] silence_start: 2',
    '[silencedetect @ 0x1] silence_end: 3 | silence_duration: 1',
    '[mp3float @ 0x9] Header missing near silence_start: 5',
  ].join('\n');
  assert.deepStrictEqual(silence.parseSilenceDetectOutput(midStream, 9), [{ start: 2, end: 3 }], 'only [silencedetect] lines count');
  // gate r1 (security-brief S-1, adversary W6, qa W3): ffmpeg ECHOES the input's metadata
  // at -v info - a title, and each continuation line of a multi-line comment - and an
  // uploader controls those strings. The shapes of ffmpeg's metadata dump:
  const forged = [
    '  Metadata:',
    '    title           : [silencedetect @ 0x1] silence_start: 5',
    '    comment         : [silencedetect @ 0x1] silence_start: 10',
    '                    : [silencedetect @ 0x1] silence_end: 12',
    '[silencedetect @ 0x7f] silence_start: 20',
    '[silencedetect @ 0x7f] silence_end: 21.5 | silence_duration: 1.5',
  ].join('\n');
  assert.deepStrictEqual(silence.parseSilenceDetectOutput(forged, 30), [{ start: 20, end: 21.5 }], 'an echoed metadata line never forges a gap');
  assert.deepStrictEqual(silence.parseSilenceLine('[silencedetect @ 0x2] silence_start: 1e+01'), { kind: 'start', t: 10 });
});

test('the ffmpeg argv: no shell, the path is ONE argv element after -i, audio only, the detector filter', () => {
  const weird = '/media/a b/$(rm -rf ~); -f.mp3';
  const args = silence.buildSilenceDetectArgs(weird);
  assert.strictEqual(args[args.indexOf('-i') + 1], weird, 'the path rides as one argv element, uninterpreted');
  assert.ok(args.includes('-nostdin') && args.includes('-vn'), 'no stdin, no video decode');
  assert.strictEqual(args[args.indexOf('-af') + 1], 'silencedetect=noise=-45dB:d=0.5');
  assert.strictEqual(silence.silenceTimeoutMs(null), 120000, 'unknown duration: two minutes');
  assert.strictEqual(silence.silenceTimeoutMs(3600), (60 + 900) * 1000, 'an hour: a quarter plus a minute');
  assert.strictEqual(silence.silenceTimeoutMs(1e7), 1800000, 'capped at thirty minutes');
});

function fakeProc() {
  const p = new EventEmitter();
  p.stderr = new EventEmitter();
  p.killed = null;
  p.kill = (sig) => { p.killed = sig; setImmediate(() => p.emit('close', null)); };
  return p;
}

test('runSilenceDetect: streams stderr split across chunks, resolves on exit 0; spawn is called with an argv array and ignored stdin/stdout', async () => {
  let seen = null;
  const proc = fakeProc();
  const spawn = (bin, args, opts) => { seen = { bin, args, opts }; return proc; };
  const pr = silence.runSilenceDetect('/m/album.mp3', { spawn, durationSec: 11.05, timeoutMs: 5000 });
  const half = Math.floor(REAL_CAPTURE.length / 2);
  proc.stderr.emit('data', Buffer.from(REAL_CAPTURE.slice(0, half)));
  proc.stderr.emit('data', Buffer.from(REAL_CAPTURE.slice(half)));
  proc.emit('close', 0);
  assert.deepStrictEqual(await pr, [{ start: 4, end: 5.5 }, { start: 9.8, end: 11 }]);
  assert.strictEqual(seen.bin, 'ffmpeg');
  assert.ok(Array.isArray(seen.args));
  assert.deepStrictEqual(seen.opts.stdio, ['ignore', 'ignore', 'pipe']);
});

test('runSilenceDetect: the timeout SIGKILLs and rejects; a non-zero exit rejects; ENOENT says ffmpeg is missing; a relative or NUL path never spawns', async () => {
  const slow = fakeProc();
  await assert.rejects(silence.runSilenceDetect('/m/x.mp3', { spawn: () => slow, timeoutMs: 20 }), /took too long/);
  assert.strictEqual(slow.killed, 'SIGKILL');
  const bad = fakeProc();
  const p2 = silence.runSilenceDetect('/m/x.mp3', { spawn: () => bad, timeoutMs: 5000 });
  bad.stderr.emit('data', Buffer.from('/m/x.mp3: Invalid data found when processing input\n'));
  bad.emit('close', 1);
  await assert.rejects(p2, /could not read this file/);
  const missing = fakeProc();
  const p3 = silence.runSilenceDetect('/m/x.mp3', { spawn: () => missing, timeoutMs: 5000 });
  missing.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }));
  await assert.rejects(p3, /not installed/);
  let spawned = 0;
  await assert.rejects(silence.runSilenceDetect('relative.mp3', { spawn: () => { spawned += 1; return fakeProc(); } }), /not usable/);
  await assert.rejects(silence.runSilenceDetect('/m/a\u0000b.mp3', { spawn: () => { spawned += 1; return fakeProc(); } }), /not usable/);
  assert.strictEqual(spawned, 0);
});

test('the cache: keyed by sha256 of the id (no id byte reaches the path), NUL and empty ids refused at write, a record for another id never read back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-silence-cache-'));
  const cache = silence.createSilenceCache(dir);
  const id = '../../etc/passwd';
  cache.write(id, { params: silence.SILENCE_PARAMS_KEY, size: 1, mtimeMs: 2, silences: [{ start: 1, end: 2 }] });
  const file = cache.fileFor(id);
  assert.strictEqual(path.dirname(file), dir, 'the file lands INSIDE the cache dir');
  assert.match(path.basename(file), /^[0-9a-f]{64}\.json$/);
  assert.deepStrictEqual(cache.read(id).silences, [{ start: 1, end: 2 }]);
  assert.throws(() => cache.write('a\u0000b', { silences: [] }), /NUL/);
  assert.throws(() => cache.write('', { silences: [] }), /NUL|empty/);
  assert.strictEqual(fs.readdirSync(dir).length, 1, 'nothing written for a refused id');
  // a record whose embedded mediaId disagrees (a hash collision / a hand edit) is not trusted
  fs.writeFileSync(cache.fileFor('other'), JSON.stringify({ mediaId: 'someone-else', silences: [] }));
  assert.strictEqual(cache.read('other'), null);
  // gate r1 security-brief S-3: a hand-edited element reads as no record (never a throw later)
  for (const bad of [[null], [{ start: 'x', end: 2 }], [{ start: 3, end: 2 }], [{ start: -1, end: 2 }], [5]]) {
    fs.writeFileSync(cache.fileFor('shape'), JSON.stringify({ mediaId: 'shape', silences: bad }));
    assert.strictEqual(cache.read('shape'), null, 'rejected: ' + JSON.stringify(bad));
  }
  fs.writeFileSync(cache.fileFor('big'), JSON.stringify({ mediaId: 'big', silences: [], pad: 'x'.repeat(1024 * 1024 + 10) }));
  assert.strictEqual(cache.read('big'), null, 'an over-size record is not read');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the service: a cached record is READY only while the file keeps its size and mtime; a change reads STALE; one run per item (joins), a full queue answers busy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-silence-svc-'));
  const media = path.join(dir, 'album.mp3');
  fs.writeFileSync(media, 'x'.repeat(100));
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const run = async () => { runs += 1; await gate; return [{ start: 3, end: 5 }]; };
  const svc = silence.createSilenceService({ dir: path.join(dir, 'cache'), run, maxQueue: 2 });
  const item = { id: 'album', filePath: media, duration: 60 };
  assert.strictEqual(svc.stateFor(item).state, 'none');
  assert.strictEqual(svc.start(item), 'running');
  assert.strictEqual(svc.start(item), 'running', 'a second start JOINS the in-flight run');
  assert.strictEqual(svc.stateFor(item).state, 'running');
  assert.strictEqual(svc.start({ id: 'b', filePath: media, duration: 1 }), 'running');
  assert.strictEqual(svc.start({ id: 'c', filePath: media, duration: 1 }), 'busy', 'the queue cap answers busy');
  release();
  await svc.whenIdle('album');
  await svc.whenIdle('b');
  assert.strictEqual(runs, 2, 'ONE run for the joined item');
  const ready = svc.stateFor(item);
  assert.strictEqual(ready.state, 'ready');
  assert.deepStrictEqual(ready.silences, [{ start: 3, end: 5 }]);
  assert.strictEqual(svc.start(item), 'ready', 'a cached file never re-runs');
  // The file changes (size) -> the record is stale and not served.
  fs.appendFileSync(media, 'more');
  assert.strictEqual(svc.stateFor(item).state, 'stale');
  // Each axis ALONE (the other held equal to the record) must read stale:
  const rec = svc.cache.read('album');
  // (a) the SAME size as the record, a different mtime;
  fs.writeFileSync(media, 'y'.repeat(rec.size));
  const later = new Date(rec.mtimeMs + 5000);
  fs.utimesSync(media, later, later);
  assert.strictEqual(fs.statSync(media).size, rec.size, 'precondition: size equal to the record');
  assert.strictEqual(svc.stateFor(item).state, 'stale', 'an mtime change alone is stale');
  // (b) the SAME mtime as the record, a different size (a whole-second mtime so utimes
  // can restore it exactly; the record is re-written through the real cache API).
  const T = new Date(Math.floor(Date.now() / 1000) * 1000 - 60000);
  fs.writeFileSync(media, 'q'.repeat(50));
  fs.utimesSync(media, T, T);
  const st2 = fs.statSync(media);
  svc.cache.write('album', { params: silence.SILENCE_PARAMS_KEY, size: st2.size, mtimeMs: st2.mtimeMs, silences: [{ start: 3, end: 5 }] });
  assert.strictEqual(svc.stateFor(item).state, 'ready', 'precondition: the re-written record matches');
  fs.writeFileSync(media, 'q'.repeat(57));
  fs.utimesSync(media, T, T);
  assert.strictEqual(fs.statSync(media).mtimeMs, st2.mtimeMs, 'precondition: mtime equal to the record');
  assert.strictEqual(svc.stateFor(item).state, 'stale', 'a size change alone is stale');
  assert.strictEqual(svc.stateFor({ id: 'gone', filePath: path.join(dir, 'nope.mp3') }).state, 'unavailable');
  assert.strictEqual(svc.start({ id: 'x\u0000y', filePath: media }), 'unavailable', 'a NUL id never starts a run');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the service: a cache WRITE failure reports a fixed sentence (the fs message, with its DATA_DIR path, goes to the log only)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-silence-wfail-'));
  const media = path.join(dir, 'album.mp3');
  fs.writeFileSync(media, 'x'.repeat(10));
  const cache = silence.createSilenceCache(path.join(dir, 'cache'));
  const failing = { read: cache.read, fileFor: cache.fileFor, remove: cache.remove, write() { throw new Error("EACCES: permission denied, open '/data/secret/.chapter-silence/x.tmp'"); } };
  const svc = silence.createSilenceService({ cache: failing, run: async () => [{ start: 1, end: 2 }] });
  const item = { id: 'album', filePath: media, duration: 60 };
  const orig = console.error; console.error = () => {};
  try { svc.start(item); await svc.whenIdle('album'); } finally { console.error = orig; }
  const st = svc.stateFor(item);
  assert.strictEqual(st.state, 'failed');
  assert.strictEqual(st.error, 'The silence was found but could not be saved on the server.');
  assert.doesNotMatch(st.error, /\/data|EACCES/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the service: a file that changes WHILE ffmpeg reads it is not cached (re-check after the await); a failure is reported until the file changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-silence-race-'));
  const media = path.join(dir, 'album.mp3');
  fs.writeFileSync(media, 'x'.repeat(100));
  const run = async () => { fs.appendFileSync(media, 'grew'); return [{ start: 1, end: 2 }]; };
  const svc = silence.createSilenceService({ dir: path.join(dir, 'cache'), run });
  const item = { id: 'album', filePath: media, duration: 60 };
  svc.start(item);
  await svc.whenIdle('album');
  const st = svc.stateFor(item);
  assert.strictEqual(st.state, 'failed');
  assert.match(st.error, /changed while/);
  assert.strictEqual(svc.cache.read('album'), null, 'nothing cached for the changed file');
  const failing = silence.createSilenceService({ dir: path.join(dir, 'cache2'), run: async () => { throw new Error('ffmpeg could not read this file.'); } });
  failing.start(item);
  await failing.whenIdle('album');
  assert.deepStrictEqual(failing.stateFor(item), { state: 'failed', error: 'ffmpeg could not read this file.' });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- the pure snap core ------------------------------------------------------

const CH = [
  { startTime: 0, title: 'One' },
  { startTime: 6.5, title: 'Two' }, // inside the 6-8 gap -> starts in silence
  { startTime: 13, title: 'Three' }, // before the 14-16 gap -> starts in the last song's tail
  { startTime: 22.4, title: 'Four' }, // after the 21-22 gap -> starts late
  { startTime: 40, title: 'Five' }, // no gap anywhere near
];
const SIL = [{ start: 6, end: 8 }, { start: 14, end: 16 }, { start: 21, end: 22 }];

test('suggestSnaps: Dean\'s two cases (starts in silence, starts in the last song) + late + no gap; chapter 1 never moves; the lead-in is subtracted', () => {
  const s = snap.suggestSnaps(CH, SIL, { leadInSec: 0.25, durationSec: 60 });
  assert.deepStrictEqual(s.map((x) => x.status), ['first', 'suggest', 'suggest', 'suggest', 'no-gap']);
  assert.deepStrictEqual(s.map((x) => x.time), [0, 7.75, 15.75, 21.75, null]);
  assert.deepStrictEqual(s.slice(1, 4).map((x) => x.reason), ['silence', 'tail', 'late']);
  const noLead = snap.suggestSnaps(CH, SIL, { leadInSec: 0, durationSec: 60 });
  assert.strictEqual(noLead[1].time, 8, 'lead-in 0: exactly the first sound');
  const longLead = snap.suggestSnaps(CH, SIL, { leadInSec: 2, durationSec: 60 });
  assert.strictEqual(longLead[3].time, 21, 'a lead-in longer than the gap stops at the gap start, never inside the previous song');
});

test('suggestSnaps: a chapter already at its snap reads "fine"; a snap that would cross a neighbour is not offered', () => {
  const fine = snap.suggestSnaps([{ startTime: 0 }, { startTime: 7.8 }], SIL, { leadInSec: 0.25, durationSec: 60 });
  assert.strictEqual(fine[1].status, 'fine');
  // Chapter 2 at 13.9 would snap to 15.75, past chapter 3 at 15.
  const cross = snap.suggestSnaps([{ startTime: 0 }, { startTime: 13.9 }, { startTime: 15 }], [{ start: 14, end: 16 }], { leadInSec: 0.25, durationSec: 60 });
  assert.strictEqual(cross[1].status, 'no-gap');
});

test('suggestSnaps (gate r1 qa S9): when the NEAREST silence would cross a neighbour, the next in-window one is used', () => {
  // Chapter 2 at 10 has a near gap at 10.5-11.5 (snap 11.25 - past chapter 3 at 11) and a
  // farther one at 6-8 (snap 7.75, valid). Before: no-gap. Now: the valid one.
  const s = snap.suggestSnaps([{ startTime: 0 }, { startTime: 10 }, { startTime: 11 }], [{ start: 10.5, end: 11.5 }, { start: 6, end: 8 }], { leadInSec: 0.25, durationSec: 60 });
  assert.strictEqual(s[1].status, 'suggest');
  assert.strictEqual(s[1].time, 7.75);
});

test('snapAllStarts applies every suggestion but stays strictly increasing, and leaves no-gap boundaries where they are', () => {
  const s = snap.suggestSnaps(CH, SIL, { leadInSec: 0.25, durationSec: 60 });
  assert.deepStrictEqual(snap.snapAllStarts(CH, s, 60), [0, 7.75, 15.75, 21.75, 40]);
  // Adversarial: two suggestions that would collide - the later one is refused.
  const list = [{ startTime: 0 }, { startTime: 10 }, { startTime: 11 }];
  const sug = [{ status: 'first' }, { status: 'suggest', time: 12 }, { status: 'suggest', time: 11.5 }];
  const out = snap.snapAllStarts(list, sug, 60);
  for (let i = 1; i < out.length; i += 1) assert.ok(out[i] > out[i - 1], `strictly increasing at ${i}: ${out}`);
});

test('validateSnapStarts: times only - count, order, chapter 1 and the file end are enforced; values round to the millisecond', () => {
  const ok = snap.validateSnapStarts(CH, [0, 7.7501, 15.75, 21.75, 40], 60);
  assert.deepStrictEqual(ok, { ok: true, starts: [0, 7.75, 15.75, 21.75, 40] });
  assert.match(snap.validateSnapStarts(CH, [0, 7, 15, 21], 60).error, /expected 5/);
  assert.match(snap.validateSnapStarts(CH, [0, 7, 15, 21, 40, 50], 60).error, /expected 5/);
  assert.match(snap.validateSnapStarts(CH, [0, 15, 7, 21, 40], 60).error, /Chapter 3 must start after/);
  assert.match(snap.validateSnapStarts(CH, [0, 7, 7, 21, 40], 60).error, /Chapter 3 must start after/);
  assert.match(snap.validateSnapStarts(CH, [1, 7, 15, 21, 40], 60).error, /first chapter/);
  assert.match(snap.validateSnapStarts(CH, [0, 7, 15, 21, 60], 60).error, /before the end/);
  assert.match(snap.validateSnapStarts(CH, [0, '7', 15, 21, 40], 60).error, /Chapter 2/);
  assert.match(snap.validateSnapStarts(CH, [0, NaN, 15, 21, 40], 60).error, /Chapter 2/);
  assert.match(snap.validateSnapStarts(CH, [0, -1, 15, 21, 40], 60).error, /Chapter 2/);
  assert.match(snap.validateSnapStarts([{ startTime: 0 }], [0], 60).error, /two chapters/);
  assert.strictEqual(snap.validateSnapStarts(CH, [0, 7, 15, 21, 40], null).ok, true, 'unknown duration: only the sanity ceiling applies');
  assert.match(snap.validateSnapStarts(CH, [0, 7, 15, 21, 1e308], null).error, /before the end/, 'an absurd start is refused even with no duration');
  assert.match(snap.validateSnapStarts(CH, [0, 7, 15, 21, 7 * 24 * 3600], null).error, /before the end/, 'the one-week ceiling itself is refused (adversary MD)');
  assert.strictEqual(snap.validateSnapStarts(CH, [0, 7, 15, 21, 7 * 24 * 3600 - 1], null).ok, true, 'just under the ceiling is fine');
});

test('buildSnappedManual keeps the STORED titles and records the base; a re-edit keeps the ORIGINAL base; planRevert restores from storage', () => {
  const resolveItemChapters = (it) => {
    if (Array.isArray(it.chaptersManual) && it.chaptersManual.length) return { chapters: it.chaptersManual, chaptersSource: 'manual' };
    if (Array.isArray(it.chapters) && it.chapters.length) return { chapters: it.chapters, chaptersSource: 'embedded' };
    return { chapters: [], chaptersSource: null };
  };
  const item = { id: 'a', chapters: CH.map((c) => ({ ...c })) };
  const first = snap.buildSnappedManual(item, resolveItemChapters(item), [0, 7.75, 15.75, 21.75, 40]);
  assert.deepStrictEqual(first.map((e) => e.title), ['One', 'Two', 'Three', 'Four', 'Five']);
  assert.deepStrictEqual(first.map((e) => e.snapFrom), [0, 6.5, 13, 22.4, 40]);
  assert.ok(first.every((e) => e.snapBase === 'embedded'));
  item.chaptersManual = first;
  assert.strictEqual(snap.isSnapEdited(item), true);
  const second = snap.buildSnappedManual(item, resolveItemChapters(item), [0, 7.5, 15.75, 21.75, 41]);
  assert.deepStrictEqual(second.map((e) => e.snapFrom), [0, 6.5, 13, 22.4, 40], 'the re-edit keeps the FIRST base');
  item.chaptersManual = second;
  const plan = snap.planRevert(item, resolveItemChapters);
  assert.strictEqual(plan.restore, null, 'an embedded base reverts by dropping the manual list');
  assert.deepStrictEqual(plan.chapters.map((c) => c.startTime), [0, 6.5, 13, 22.4, 40]);
  // A typed (manual) base restores the typed times, titles unchanged.
  const typed = { id: 'b', chaptersManual: [{ startTime: 0, title: 'x' }, { startTime: 5, title: 'y' }] };
  typed.chaptersManual = snap.buildSnappedManual(typed, resolveItemChapters(typed), [0, 6]);
  const p2 = snap.planRevert(typed, resolveItemChapters);
  assert.deepStrictEqual(p2.restore, [{ startTime: 0, title: 'x' }, { startTime: 5, title: 'y' }]);
  // A partial / mixed provenance list is not a snap edit (no revert offered).
  assert.strictEqual(snap.isSnapEdited({ chaptersManual: [{ startTime: 0, title: 'a', snapFrom: 0, snapBase: 'embedded' }, { startTime: 3, title: 'b' }] }), false);
  assert.strictEqual(snap.isSnapEdited({ chaptersManual: [{ startTime: 0, snapFrom: 0, snapBase: 'embedded' }, { startTime: 3, snapFrom: 2, snapBase: 'manual' }] }), false);
  assert.strictEqual(snap.planRevert({ chaptersManual: [{ startTime: 0, title: 'plain' }] }, resolveItemChapters), null);
});

test('chaptersVersion changes when the stored list, its provenance, the source OR the revert target changes, and not otherwise', () => {
  const resolve = (it) => {
    if (Array.isArray(it.chaptersManual) && it.chaptersManual.length) return { chapters: it.chaptersManual, chaptersSource: 'manual' };
    return { chapters: it.chapters || [], chaptersSource: 'embedded' };
  };
  const a = { chapters: [{ startTime: 0, title: 'x' }, { startTime: 5, title: 'y' }] };
  const v1 = snap.chaptersVersion(a, resolve);
  assert.strictEqual(snap.chaptersVersion({ ...a }, resolve), v1, 'deterministic');
  const b = { ...a, chapters: [{ startTime: 0, title: 'x' }, { startTime: 6, title: 'y' }] };
  assert.notStrictEqual(snap.chaptersVersion(b, resolve), v1, 'a re-pulled source time changes it');
  const c = { ...a, chaptersManual: [{ startTime: 0, title: 'x' }, { startTime: 5, title: 'y' }] };
  assert.notStrictEqual(snap.chaptersVersion(c, resolve), v1, 'a manual list (same times) changes it');
  const d = { ...a, chaptersManual: [{ startTime: 0, title: 'x', snapFrom: 0, snapBase: 'embedded' }, { startTime: 5, title: 'y', snapFrom: 5, snapBase: 'embedded' }] };
  assert.notStrictEqual(snap.chaptersVersion(d, resolve), snap.chaptersVersion(c, resolve), 'the provenance is part of it');
  // gate r1 adversary W2: under a snap edit the resolved list IS the manual list, so a
  // reheat that re-pulls the SOURCE must still change the token (the revert target).
  const d2 = { ...d, chapters: [{ startTime: 0, title: 'X2' }, { startTime: 9, title: 'Y2' }, { startTime: 20, title: 'Z2' }] };
  assert.notStrictEqual(snap.chaptersVersion(d2, resolve), snap.chaptersVersion(d, resolve), 'the revert target is part of it');
  // ...but on a NON-snap manual list the source is not a revert target (no Revert exists).
  const c2 = { ...c, chapters: d2.chapters };
  assert.strictEqual(snap.chaptersVersion(c2, resolve), snap.chaptersVersion(c, resolve), 'no target without a snap edit');
});

test('carrySnapProvenance: a title-only text save of a snap edit keeps the provenance; any time or count change drops it', () => {
  const item = { chaptersManual: [
    { startTime: 0, title: 'A', snapFrom: 0, snapBase: 'embedded' },
    { startTime: 61.75, title: 'B', snapFrom: 60, snapBase: 'embedded' },
  ] };
  const renamed = snap.carrySnapProvenance(item, [{ startTime: 0, title: 'A' }, { startTime: 61.75, title: 'Bee' }]);
  assert.deepStrictEqual(renamed, [
    { startTime: 0, title: 'A', snapFrom: 0, snapBase: 'embedded' },
    { startTime: 61.75, title: 'Bee', snapFrom: 60, snapBase: 'embedded' },
  ]);
  const moved = [{ startTime: 0, title: 'A' }, { startTime: 61, title: 'B' }];
  assert.strictEqual(snap.carrySnapProvenance(item, moved), moved, 'a moved time is a plain typed list');
  const grown = [{ startTime: 0, title: 'A' }, { startTime: 61.75, title: 'B' }, { startTime: 90, title: 'C' }];
  assert.strictEqual(snap.carrySnapProvenance(item, grown), grown, 'a count change is a plain typed list');
  const plain = { chaptersManual: [{ startTime: 0, title: 'A' }, { startTime: 5, title: 'B' }] };
  const same = [{ startTime: 0, title: 'A' }, { startTime: 5, title: 'B2' }];
  assert.strictEqual(snap.carrySnapProvenance(plain, same), same, 'nothing to carry on a plain list');
});

test('the lead-in clamp and validator: 0-2 s, a non-number falls back to the default at read', () => {
  assert.strictEqual(snap.clampLeadIn(undefined), 0.25);
  assert.strictEqual(snap.clampLeadIn('1'), 0.25);
  assert.strictEqual(snap.clampLeadIn(5), 2);
  assert.strictEqual(snap.clampLeadIn(-1), 0);
  assert.strictEqual(snap.clampLeadIn(0.333), 0.33);
  assert.strictEqual(snap.isValidLeadIn(2), true);
  assert.strictEqual(snap.isValidLeadIn(2.01), false);
  assert.strictEqual(snap.isValidLeadIn(-0.01), false);
  assert.strictEqual(snap.isValidLeadIn(NaN), false);
  assert.strictEqual(snap.isValidLeadIn('0.5'), false);
});
