'use strict';

// [UNIT] v1.339 gate r1 C2 (D1 "Keep mine", audio half): the FTCHSRC /
// FTCHDST parsers, the pure cleanup planner, the fs re-checks of
// removeFreshOneOffSources, and the audio one-off argv. The through-the-spawn
// behavior lives in test/integration/ytdlp-oneshot-audio-keep.test.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const run = require('../../lib/ytdlp/run');
const args = require('../../lib/ytdlp/args');
const ytdlp = require('../../lib/ytdlp');

// VERBATIM stdout lines from real yt-dlp 2026.08.19 + ffmpeg-static, the
// fixed argv (-x --audio-format mp3 -f bestaudio/best -k + the two prints)
// against a local HTTP server (f2-design-probe.txt): case 1 = the video was
// already in the folder, case 2 = a fresh download, case 3 = the mp3 already
// there (the converted-name arm never assigns __real_download -> NA).
const D = '/tmp/claude-1000/-home-coder-projects-filetube/339343c6-0bc0-4fe2-a5e0-b0b75002ac23/scratchpad/f2-adv/out';
const REAL = {
  existingSrc: `FTCHSRC false "${D}/clip [Generic=clip].mp4"`,
  freshSrc: `FTCHSRC true "${D}/clip [Generic=clip].mp4"`,
  keptMp3Src: `FTCHSRC NA "${D}/clip [Generic=clip].mp3"`,
  dst: `FTCHDST "${D}/clip [Generic=clip].mp3"`,
};
const MP4 = `${D}/clip [Generic=clip].mp4`;
const MP3 = `${D}/clip [Generic=clip].mp3`;

test('parseAudioSourceLine / parseFinalPathLine: the verbatim real yt-dlp lines', () => {
  assert.deepStrictEqual(run.parseAudioSourceLine(REAL.existingSrc), { real: false, path: MP4 });
  assert.deepStrictEqual(run.parseAudioSourceLine(REAL.freshSrc), { real: true, path: MP4 });
  assert.deepStrictEqual(run.parseAudioSourceLine(REAL.keptMp3Src), { real: null, path: MP3 });
  assert.deepStrictEqual(run.parseAudioSourceLine(`${REAL.freshSrc}\r`), { real: true, path: MP4 }, 'CRLF tolerated');
  assert.strictEqual(run.parseFinalPathLine(REAL.dst), MP3);
  // JSON escapes decode (yt-dlp's j conversion is json.dumps, ensure_ascii on).
  assert.deepStrictEqual(run.parseAudioSourceLine('FTCHSRC true "/d/caf\\u00e9 \\"q\\" [x].mp4"'), { real: true, path: '/d/café "q" [x].mp4' });
});

test('parseAudioSourceLine / parseFinalPathLine: anything else is null (never a path to act on)', () => {
  for (const line of [
    null, undefined, 42, '',
    'FTCHSRC true /abs/unquoted.mp4',
    'FTCHSRC maybe "/abs/a.mp4"',
    'FTCHSRC true "relative/a.mp4"',
    'FTCHSRC true ""',
    'FTCHSRC true "/abs/a.mp4" trailing',
    ' FTCHSRC true "/abs/a.mp4"',
    'FTCHSRCX true "/abs/a.mp4"',
    'FTCHDST "/abs/a.mp3"', // the other sentinel
    'FTCHSRC true "/abs/nul\\u0000.mp4"',
    'FTCHSRC true "/abs/a.mp4',
  ]) {
    assert.strictEqual(run.parseAudioSourceLine(line), null, `source: ${JSON.stringify(line)}`);
  }
  for (const line of [null, '', 'FTCHDST /abs/a.mp3', 'FTCHDST "rel.mp3"', 'FTCHDST "/abs/a.mp3" x', REAL.freshSrc, 'FTCHDSTX "/abs/a.mp3"', 'FTCHREAL true']) {
    assert.strictEqual(run.parseFinalPathLine(line), null, `final: ${JSON.stringify(line)}`);
  }
});

const src = (real, p) => ({ real, path: p });

test('planOneOffSourceCleanup: a FRESH source (real true) beside its final is removed; the final never is', () => {
  assert.deepStrictEqual(run.planOneOffSourceCleanup({ sourceFiles: [src(true, MP4)], finalFiles: [MP3] }), { remove: [MP4], madeFromExisting: false });
});

test('planOneOffSourceCleanup: a source that was ALREADY on disk (real false) is never removed and marks madeFromExisting', () => {
  assert.deepStrictEqual(run.planOneOffSourceCleanup({ sourceFiles: [src(false, MP4)], finalFiles: [MP3] }), { remove: [], madeFromExisting: true });
});

test('planOneOffSourceCleanup: real NA (unknown) is never "ours"', () => {
  assert.deepStrictEqual(run.planOneOffSourceCleanup({ sourceFiles: [src(null, MP4)], finalFiles: [MP3] }), { remove: [], madeFromExisting: true });
});

test('planOneOffSourceCleanup: the source IS the final (the mp3 was already there) -> nothing removed, not made from anything', () => {
  assert.deepStrictEqual(run.planOneOffSourceCleanup({ sourceFiles: [src(null, MP3)], finalFiles: [MP3] }), { remove: [], madeFromExisting: false });
  assert.deepStrictEqual(run.planOneOffSourceCleanup({ sourceFiles: [src(true, MP3)], finalFiles: [MP3] }), { remove: [], madeFromExisting: false }, 'even when real: the final is never a source to remove');
});

test('planOneOffSourceCleanup: no final reported (a failed / cancelled run) -> nothing removed, even a fresh source', () => {
  assert.deepStrictEqual(run.planOneOffSourceCleanup({ sourceFiles: [src(true, MP4)], finalFiles: [] }), { remove: [], madeFromExisting: false });
  assert.deepStrictEqual(run.planOneOffSourceCleanup({ sourceFiles: [src(true, MP4)] }), { remove: [], madeFromExisting: false });
  assert.deepStrictEqual(run.planOneOffSourceCleanup(null), { remove: [], madeFromExisting: false });
});

test('planOneOffSourceCleanup: a fresh source in ANOTHER directory or with ANOTHER stem than the final is never removed', () => {
  assert.deepStrictEqual(run.planOneOffSourceCleanup({ sourceFiles: [src(true, '/other/clip [Generic=clip].mp4')], finalFiles: [MP3] }), { remove: [], madeFromExisting: false });
  assert.deepStrictEqual(run.planOneOffSourceCleanup({ sourceFiles: [src(true, `${D}/Another Title [x].mp4`)], finalFiles: [MP3] }), { remove: [], madeFromExisting: false });
});

// ---- removeFreshOneOffSources: the fs re-checks -----------------------------

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-audiokeep-unit-'));
}

test('removeFreshOneOffSources: removes a planned regular file under the download root, keeps the final', () => {
  const root = tmp();
  try {
    const mp4 = path.join(root, 'F', 'clip [x].mp4');
    const mp3 = path.join(root, 'F', 'clip [x].mp3');
    fs.mkdirSync(path.dirname(mp4));
    fs.writeFileSync(mp4, 'v');
    fs.writeFileSync(mp3, 'a');
    const out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, mp4)], finalFiles: [mp3] }, { downloadDir: root });
    assert.deepStrictEqual(out, { removed: 1, madeFromExisting: false });
    assert.ok(!fs.existsSync(mp4));
    assert.ok(fs.existsSync(mp3));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removeFreshOneOffSources: a planned path that is a SYMLINK is never removed (lstat, not followed)', () => {
  const root = tmp();
  try {
    const target = path.join(root, 'F', 'real library file.mp4');
    const link = path.join(root, 'F', 'clip [x].mp4');
    const mp3 = path.join(root, 'F', 'clip [x].mp3');
    fs.mkdirSync(path.dirname(target));
    fs.writeFileSync(target, 'library bytes');
    fs.symlinkSync(target, link);
    fs.writeFileSync(mp3, 'a');
    const out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, link)], finalFiles: [mp3] }, { downloadDir: root });
    assert.strictEqual(out.removed, 0);
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the link itself is kept');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'library bytes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removeFreshOneOffSources: a planned file whose REAL path is outside the download root is never removed', () => {
  const root = tmp();
  const outside = tmp();
  try {
    fs.symlinkSync(outside, path.join(root, 'F')); // a folder symlinked out of the root
    const mp4 = path.join(root, 'F', 'clip [x].mp4');
    const mp3 = path.join(root, 'F', 'clip [x].mp3');
    fs.writeFileSync(mp4, 'outside bytes');
    fs.writeFileSync(mp3, 'a');
    assert.ok(fs.lstatSync(mp4).isFile(), 'anti-vacuity: the lstat check alone would pass');
    const out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, mp4)], finalFiles: [mp3] }, { downloadDir: root });
    assert.strictEqual(out.removed, 0);
    assert.strictEqual(fs.readFileSync(path.join(outside, 'clip [x].mp4'), 'utf8'), 'outside bytes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('removeFreshOneOffSources: an existing source (real false) is kept and reported as madeFromExisting', () => {
  const root = tmp();
  try {
    const mp4 = path.join(root, 'clip [x].mp4');
    const mp3 = path.join(root, 'clip [x].mp3');
    fs.writeFileSync(mp4, 'library');
    fs.writeFileSync(mp3, 'a');
    const out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(false, mp4)], finalFiles: [mp3] }, { downloadDir: root });
    assert.deepStrictEqual(out, { removed: 0, madeFromExisting: true });
    assert.strictEqual(fs.readFileSync(mp4, 'utf8'), 'library');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- the argv -----------------------------------------------------------------

function cfg() {
  const root = path.join(os.tmpdir(), 'filetube-audiokeep-argv');
  return { downloadDir: root, cookiesFile: null };
}
const audioSub = { id: 's', name: 'Chan', channelUrl: 'https://www.youtube.com/@chan', format: 'audio' };
const videoSub = { ...audioSub, format: 'video' };

test('buildYtdlpDownloadArgs: an AUDIO one-off keeps the file it converts (-k), pins -f bestaudio/best, and prints the source + final paths', () => {
  const argv = args.buildYtdlpDownloadArgs(audioSub, cfg(), ['dQw4w9WgXcQ'], { oneOff: true });
  const x = argv.indexOf('-x');
  assert.deepStrictEqual(argv.slice(x, x + 6), ['-x', '--audio-format', 'mp3', '-f', 'bestaudio/best', '-k']);
  const prints = argv.flatMap((t, i) => (t === '--print' ? [argv[i + 1]] : []));
  assert.ok(prints.includes('post_process:FTCHSRC %(__real_download)j %(filepath)j'), JSON.stringify(prints));
  assert.ok(prints.includes('after_move:FTCHDST %(filepath)j'), JSON.stringify(prints));
  assert.ok(argv.indexOf('-k') < argv.indexOf('--'), 'an option, never a positional');
});

test('buildYtdlpDownloadArgs: an audio SUBSCRIPTION and a VIDEO one-off carry none of it (their argv is unchanged)', () => {
  for (const argv of [
    args.buildYtdlpDownloadArgs(audioSub, cfg(), ['dQw4w9WgXcQ']),
    args.buildYtdlpDownloadArgs(videoSub, cfg(), ['dQw4w9WgXcQ'], { oneOff: true }),
  ]) {
    assert.ok(!argv.includes('-k'), JSON.stringify(argv));
    assert.ok(!argv.includes('bestaudio/best'), JSON.stringify(argv));
    assert.ok(!argv.includes(args.ONE_OFF_AUDIO_SOURCE_PRINT_TEMPLATE));
    assert.ok(!argv.includes(args.ONE_OFF_FINAL_PATH_PRINT_TEMPLATE));
  }
});
