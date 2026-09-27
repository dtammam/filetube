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

// v1.339 F4: a job that started a moment before the files were seeded (so
// they count as created during it), folder not known before the spawn.
function sinceJust() {
  return { jobStartMs: Date.now() - 5000, outputDir: null };
}
// ...and a job that started AFTER every seeded file (they pre-date it by far
// more than the clock-skew allowance) -- a birth/change time cannot be
// back-dated, so the job start moves forward instead.
function startedLater() {
  return { jobStartMs: Date.now() + ytdlp.ONE_OFF_SOURCE_CLOCK_SKEW_MS + 60000, outputDir: null };
}

test('removeFreshOneOffSources: removes a planned regular file under the download root, keeps the final', () => {
  const root = tmp();
  try {
    const mp4 = path.join(root, 'F', 'clip [x].mp4');
    const mp3 = path.join(root, 'F', 'clip [x].mp3');
    fs.mkdirSync(path.dirname(mp4));
    fs.writeFileSync(mp4, 'v');
    fs.writeFileSync(mp3, 'a');
    const out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, mp4)], finalFiles: [mp3] }, { downloadDir: root }, sinceJust());
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
    const out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, link)], finalFiles: [mp3] }, { downloadDir: root }, sinceJust());
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
    const out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, mp4)], finalFiles: [mp3] }, { downloadDir: root }, sinceJust());
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
    const out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(false, mp4)], finalFiles: [mp3] }, { downloadDir: root }, sinceJust());
    assert.deepStrictEqual(out, { removed: 0, madeFromExisting: true });
    assert.strictEqual(fs.readFileSync(mp4, 'utf8'), 'library');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- v1.339 F4: the creation-time + folder fence ------------------------------

function seedPair(dir, stem = 'clip [x]') {
  fs.mkdirSync(dir, { recursive: true });
  const mp4 = path.join(dir, `${stem}.mp4`);
  const mp3 = path.join(dir, `${stem}.mp3`);
  fs.writeFileSync(mp4, 'library video');
  fs.writeFileSync(mp3, 'a');
  return { mp4, mp3 };
}

test('F4 fileCreatedAtMs: birthtime when reported, ctime when birthtime is 0 / missing / not finite, NaN when neither', () => {
  assert.strictEqual(ytdlp.fileCreatedAtMs({ birthtimeMs: 1000, ctimeMs: 5000, mtimeMs: 9000 }), 1000);
  assert.strictEqual(ytdlp.fileCreatedAtMs({ birthtimeMs: 0, ctimeMs: 5000, mtimeMs: 9000 }), 5000, 'libuv reports 0 where the fs has no birth time');
  assert.strictEqual(ytdlp.fileCreatedAtMs({ ctimeMs: 5000, mtimeMs: 9000 }), 5000);
  assert.strictEqual(ytdlp.fileCreatedAtMs({ birthtimeMs: NaN, ctimeMs: 5000 }), 5000);
  assert.strictEqual(ytdlp.fileCreatedAtMs({ birthtimeMs: -1, ctimeMs: 5000 }), 5000);
  assert.ok(Number.isNaN(ytdlp.fileCreatedAtMs({ birthtimeMs: 0, ctimeMs: 0, mtimeMs: 9000 })), 'mtime is never used');
  assert.ok(Number.isNaN(ytdlp.fileCreatedAtMs(null)));
});

test('F4 fileCreatedAtMs: a real fs.Stats on this box yields a creation time no later than now', () => {
  const root = tmp();
  try {
    const f = path.join(root, 'f');
    fs.writeFileSync(f, 'x');
    const t = ytdlp.fileCreatedAtMs(fs.lstatSync(f));
    assert.ok(Number.isFinite(t) && t <= Date.now() + 5 && t > Date.now() - 60000, String(t));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F4: a SOURCE created before the job is never removed, even when a fresh final with its stem exists (forged FTCHSRC true)', () => {
  const root = tmp();
  try {
    const { mp4, mp3 } = seedPair(path.join(root, 'Other'));
    const job = startedLater();
    // Make the FINAL fresh (so only the source's own time can refuse): the
    // source's stat is read for real; the final is re-created and the job
    // start sits between the two by patching fs.lstatSync for the final only.
    const realLstat = fs.lstatSync;
    fs.lstatSync = (p, ...rest) => {
      const st = realLstat(p, ...rest);
      if (p === mp3) return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { birthtimeMs: job.jobStartMs + 1, ctimeMs: job.jobStartMs + 1 });
      return st;
    };
    let out;
    try {
      out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, mp4)], finalFiles: [mp3] }, { downloadDir: root }, job);
    } finally {
      fs.lstatSync = realLstat;
    }
    assert.strictEqual(out.removed, 0);
    assert.strictEqual(fs.readFileSync(mp4, 'utf8'), 'library video');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F4: a fresh source whose paired FINAL pre-dates the job is never removed', () => {
  const root = tmp();
  try {
    const { mp4, mp3 } = seedPair(path.join(root, 'Other'));
    const job = startedLater();
    const realLstat = fs.lstatSync;
    fs.lstatSync = (p, ...rest) => {
      const st = realLstat(p, ...rest);
      if (p === mp4) return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { birthtimeMs: job.jobStartMs + 1, ctimeMs: job.jobStartMs + 1 });
      return st;
    };
    let out;
    try {
      out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, mp4)], finalFiles: [mp3] }, { downloadDir: root }, job);
    } finally {
      fs.lstatSync = realLstat;
    }
    assert.strictEqual(out.removed, 0);
    assert.ok(fs.existsSync(mp4));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F4: a fresh source whose paired final does NOT EXIST is never removed', () => {
  const root = tmp();
  try {
    const { mp4, mp3 } = seedPair(path.join(root, 'F'));
    fs.unlinkSync(mp3);
    const out = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, mp4)], finalFiles: [mp3] }, { downloadDir: root }, sinceJust());
    assert.strictEqual(out.removed, 0);
    assert.ok(fs.existsSync(mp4));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F4: a fresh pair OUTSIDE the job\'s known output folder is never removed (the folder fence); inside it, it is', () => {
  const root = tmp();
  try {
    const other = seedPair(path.join(root, 'Other'));
    const mine = seedPair(path.join(root, 'Mine'));
    const outputDir = path.join(root, 'Mine');
    const job = { ...sinceJust(), outputDir };
    const outOther = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, other.mp4)], finalFiles: [other.mp3] }, { downloadDir: root }, job);
    assert.strictEqual(outOther.removed, 0);
    assert.ok(fs.existsSync(other.mp4), 'another folder\'s fresh file is kept');
    const outMine = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(true, mine.mp4)], finalFiles: [mine.mp3] }, { downloadDir: root }, job);
    assert.strictEqual(outMine.removed, 1, 'anti-vacuity: the same shape inside the folder is removed');
    assert.ok(!fs.existsSync(mine.mp4));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F4: no job start, a non-finite one, or an unresolved output folder removes nothing (fail closed); madeFromExisting still reported', () => {
  const root = tmp();
  try {
    const { mp4, mp3 } = seedPair(path.join(root, 'F'));
    const result = { sourceFiles: [src(true, mp4)], finalFiles: [mp3] };
    for (const opts of [undefined, {}, { outputDir: null }, { jobStartMs: NaN, outputDir: null }, { jobStartMs: '1', outputDir: null }, { jobStartMs: Date.now() - 5000 }, { jobStartMs: Date.now() - 5000, outputDir: '' }]) {
      const out = ytdlp.removeFreshOneOffSources(result, { downloadDir: root }, opts);
      assert.strictEqual(out.removed, 0, JSON.stringify(opts));
    }
    assert.ok(fs.existsSync(mp4));
    const existing = ytdlp.removeFreshOneOffSources({ sourceFiles: [src(false, mp4)], finalFiles: [mp3] }, { downloadDir: root }, undefined);
    assert.deepStrictEqual(existing, { removed: 0, madeFromExisting: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F4: the clock-skew allowance is a named, small constant (a second)', () => {
  assert.strictEqual(ytdlp.ONE_OFF_SOURCE_CLOCK_SKEW_MS, 1000);
});

test('F4: the allowance boundary, behaviourally -- a pair created 1.5s before the job start is kept, 0.5s before is still the job\'s own', () => {
  const root = tmp();
  try {
    const { mp4, mp3 } = seedPair(path.join(root, 'F'));
    const created = [mp4, mp3].map((p) => ytdlp.fileCreatedAtMs(fs.lstatSync(p)));
    const result = { sourceFiles: [src(true, mp4)], finalFiles: [mp3] };
    const kept = ytdlp.removeFreshOneOffSources(result, { downloadDir: root }, { jobStartMs: Math.max(...created) + 1500, outputDir: null });
    assert.strictEqual(kept.removed, 0);
    assert.ok(fs.existsSync(mp4));
    const removed = ytdlp.removeFreshOneOffSources(result, { downloadDir: root }, { jobStartMs: Math.min(...created) + 500, outputDir: null });
    assert.strictEqual(removed.removed, 1);
    assert.ok(!fs.existsSync(mp4));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- v1.339 F4: the bounded line splitter drops an over-long line whole ------

test('F4 makeLineSplitter: a line whose carry outgrows the cap is discarded WHOLE -- its tail is never parsed, even when it looks like a sentinel line', () => {
  const lines = [];
  const s = run.makeLineSplitter((l) => lines.push(l));
  const forged = `FTCHSRC true "${MP4}"`;
  s.push('ok before\n');
  s.push('x'.repeat(5000)); // no newline yet: over the cap
  s.push(forged); // the tail a keep-the-tail splitter would parse
  s.push('\nok after\n');
  assert.deepStrictEqual(lines, ['ok before', 'ok after']);
});

// A VALID sentinel line exactly `run.STDERR_TAIL_LIMIT` chars long: the path is
// padded with `/.` segments (path.resolve folds them away) and, for parity,
// one JSON `\/` escape -- so a keep-the-tail splitter's 4096-char tail of
// `<junk><this line>` would be exactly this parseable line.
function exactCapLine(prefix, p) {
  const cap = run.STDERR_TAIL_LIMIT;
  const need = cap - (prefix + JSON.stringify(p)).length;
  let lit = JSON.stringify(path.dirname(p) + '/.'.repeat(Math.floor(need / 2)) + '/' + path.basename(p));
  if (need % 2 === 1) lit = lit.replace('/', '\\/');
  const line = prefix + lit;
  assert.strictEqual(line.length, cap);
  return line;
}

test('F4 makeLineSplitter: an over-long line whose last cap-sized chunk is a VALID FTCHSRC line is still discarded (the keep-the-tail boundary)', () => {
  const lines = [];
  const s = run.makeLineSplitter((l) => lines.push(l));
  const tail = exactCapLine('FTCHSRC true ', MP4);
  const parsed = run.parseAudioSourceLine(tail);
  assert.ok(parsed && parsed.real === true && path.resolve(parsed.path) === MP4, 'anti-vacuity: the tail alone parses and names MP4');
  s.push('x'.repeat(1000) + tail);
  s.push('\n');
  assert.deepStrictEqual(lines, []);
});

test('F4 makeLineSplitter: an over-long unterminated line at close is not flushed; normal lines and a short unterminated last line still are', () => {
  const lines = [];
  const s = run.makeLineSplitter((l) => lines.push(l));
  s.push('a\nb');
  s.push('c\n');
  s.push('z'.repeat(5000));
  s.push('FTCHDST "/x.mp3"');
  s.flush();
  assert.deepStrictEqual(lines, ['a', 'bc']);
  const lines2 = [];
  const s2 = run.makeLineSplitter((l) => lines2.push(l));
  s2.push('p\nlast without newline');
  s2.flush();
  assert.deepStrictEqual(lines2, ['p', 'last without newline']);
  const lines3 = [];
  const s3 = run.makeLineSplitter((l) => lines3.push(l));
  s3.push('q'.repeat(4096)); // exactly at the cap: kept
  s3.push('\n');
  assert.deepStrictEqual(lines3, ['q'.repeat(4096)]);
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
