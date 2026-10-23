'use strict';

// [INTEGRATION] v1.394.0 W2: the comments capture and the retry-without-comments, at the REAL
// spawn boundary (run.runDownload -> spawnYtdlpDownload with cp.spawn stubbed), then across the
// download-meta bridge into the table the scan writes (the REAL record -> scan -> consume path).
// Every stdout line is VERBATIM from a real run of the pinned yt-dlp (test/fixtures/ytdlp-comments).
//
// Measured on the real binary before this file was written (plan Evidence, W2): a comment-API error
// fails the whole video (exit 1, no file) under FileTube's ignoreerrors='only_download', so a
// comments-on download that fails gets ONE retry with the comments stripped (Dean's ruling).

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-comments-capture-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const run = require('../../lib/ytdlp/run');
const ytStore = require('../../lib/ytdlp/store');

const FIX = path.join(__dirname, '..', 'fixtures', 'ytdlp-comments');
const COMMENTS_LINE = fs.readFileSync(path.join(FIX, 'ftcomments-jNQXAC9IVRw.txt'), 'utf8').trim();
const META_LINE = fs.readFileSync(path.join(FIX, 'ftchmeta-jNQXAC9IVRw.txt'), 'utf8').trim();
// The shape yt-dlp's comment-API failure takes on stderr: an ExtractorError for the video.
const API_ERROR = 'ERROR: [youtube] jNQXAC9IVRw: Unable to download API page: HTTP Error 403: Forbidden';

const originalSpawn = cp.spawn;
const originalConsoleError = console.error;
let spawnCalls;
beforeEach(() => { spawnCalls = []; console.error = () => {}; });
afterEach(() => { cp.spawn = originalSpawn; console.error = originalConsoleError; });

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = undefined;
  child.kill = (signal) => setImmediate(() => child.emit('close', null, signal));
  return child;
}
// script[n] = { stdout: [chunks], stderr, code }
function stubSpawnScript(script) {
  cp.spawn = (cmd, argv) => {
    const child = makeFakeChild();
    const step = script[spawnCalls.length] || { code: 0 };
    spawnCalls.push({ cmd, argv });
    setImmediate(() => {
      for (const chunk of step.stdout || []) child.stdout.emit('data', Buffer.from(chunk));
      if (step.stderr) child.stderr.emit('data', Buffer.from(step.stderr + '\n'));
      setImmediate(() => { child.emit('exit', step.code, null); child.emit('close', step.code, null); });
    });
    return child;
  };
}
const config = () => ({ downloadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cc-')), cookiesFile: null });
const sub = { id: 's1', channelUrl: 'https://www.youtube.com/@x', name: 'X', format: 'video', quality: 'best' };

// Split the real comments line across chunk boundaries (the splitter's carry), as a pipe would.
function chunked(line, size) {
  const out = [];
  for (let i = 0; i < line.length; i += size) out.push(line.slice(i, i + size));
  return out;
}

test('capture: the real FTCOMMENTS line, split across pipe chunks, lands on its FTCHMETA entry as a 10-comment snapshot', async () => {
  stubSpawnScript([{ stdout: [...chunked(COMMENTS_LINE + '\n', 1000), META_LINE + '\n'], code: 0 }]);
  const r = await run.runDownload(sub, config(), ['jNQXAC9IVRw'], { saveComments: true });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(spawnCalls.length, 1);
  const meta = r.channelMeta.find((m) => m.videoId === 'jNQXAC9IVRw');
  assert.ok(meta, 'the FTCHMETA entry');
  assert.strictEqual(meta.sourceComments.state, 'ok');
  assert.strictEqual(meta.sourceComments.comments.length, 10);
});

test('capture: FTCHMETA first and FTCOMMENTS second joins the same way (order-independent by video id)', async () => {
  stubSpawnScript([{ stdout: [META_LINE + '\n', COMMENTS_LINE + '\n'], code: 0 }]);
  const r = await run.runDownload(sub, config(), ['jNQXAC9IVRw'], { saveComments: true });
  assert.strictEqual(r.channelMeta[0].sourceComments.comments.length, 10);
});

test('retry: a comments-on download that fails retries ONCE with every comment flag stripped and the youtube element kept', async () => {
  stubSpawnScript([{ stderr: API_ERROR, code: 1 }, { stdout: [META_LINE + '\n'], code: 0 }]);
  const r = await run.runDownload(sub, config(), ['jNQXAC9IVRw'], { saveComments: true });
  assert.strictEqual(spawnCalls.length, 2, 'exactly one retry');
  const [a1, a2] = spawnCalls.map((c) => c.argv);
  assert.ok(a1.includes('--get-comments'), 'precondition: the first attempt asked for comments');
  assert.ok(!a2.includes('--get-comments') && !a2.some((v) => /FTCOMMENTS|max_comments|comment_sort/.test(v)), 'the retry carries none of it');
  assert.ok(a2.some((v) => v.startsWith('youtube:skip=translated_subs')), 'the youtube element itself stays');
  assert.ok(a2.includes('--write-subs'), 'not a subtitle failure: subtitles stay on');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.commentsFallback, true, 'the media landed without its comments');
});

test('retry: a retry that ALSO fails is never labelled commentsFallback', async () => {
  stubSpawnScript([{ stderr: API_ERROR, code: 1 }, { stderr: API_ERROR, code: 1 }]);
  const r = await run.runDownload(sub, config(), ['jNQXAC9IVRw'], { saveComments: true });
  assert.strictEqual(spawnCalls.length, 2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.commentsFallback, undefined);
});

test('no retry: a failure about the video itself, comments off, or our own kill', async () => {
  stubSpawnScript([{ stderr: 'ERROR: [youtube] jNQXAC9IVRw: Private video. Sign in if you\'ve been granted access to this video', code: 1 }]);
  await run.runDownload(sub, config(), ['jNQXAC9IVRw'], { saveComments: true });
  assert.strictEqual(spawnCalls.length, 1, 'a private video fails again without comments');

  spawnCalls = [];
  stubSpawnScript([{ stderr: API_ERROR, code: 1 }]);
  await run.runDownload(sub, config(), ['jNQXAC9IVRw'], { saveComments: false });
  assert.strictEqual(spawnCalls.length, 1, 'comments off: nothing new to strip, the old behaviour holds');

  spawnCalls = [];
  stubSpawnScript([{ stderr: API_ERROR, code: null }]);
  await run.runDownload(sub, config(), ['jNQXAC9IVRw'], { saveComments: true });
  assert.strictEqual(spawnCalls.length, 1, 'a non-numeric code (our kill / cancel) never re-spawns');
});

test('gate r1 (adversary W1 + qa W1): a batch whose retry skips the video that already landed KEEPS that video\'s first-attempt capture and comments', async () => {
  // attempt 1: video A lands (its FTCOMMENTS + FTCHMETA print), video B fails; attempt 2 (the archive skips A): only B's error.
  const B_ERR = 'ERROR: [youtube] BBBBBBBBBBB: Unable to download API page: HTTP Error 403: Forbidden';
  stubSpawnScript([{ stdout: [COMMENTS_LINE + '\n', META_LINE + '\n'], stderr: B_ERR, code: 1 }, { stderr: B_ERR, code: 1 }]);
  const r = await run.runDownload(sub, config(), ['jNQXAC9IVRw', 'BBBBBBBBBBB'], { saveComments: true });
  assert.strictEqual(spawnCalls.length, 2, 'precondition: the comments-stripped retry ran');
  assert.ok(spawnCalls[1].argv.includes('--download-archive'), 'precondition: the subscription lane skips what landed');
  const a = r.channelMeta.find((m) => m.videoId === 'jNQXAC9IVRw');
  assert.ok(a, 'A\'s first-attempt FTCHMETA entry survives the retry');
  assert.strictEqual(a.sourceComments.comments.length, 10, 'and so do its comments');
  // the same merge on the subtitle-retry branch
  spawnCalls = [];
  stubSpawnScript([{ stdout: [COMMENTS_LINE + '\n', META_LINE + '\n'], stderr: "ERROR: Unable to download video subtitles for 'en-en-US': HTTP Error 429: Too Many Requests", code: 1 }, { code: 0 }]);
  const r2 = await run.runDownload(sub, config(), ['jNQXAC9IVRw', 'BBBBBBBBBBB'], { saveComments: true });
  assert.strictEqual(spawnCalls.length, 2);
  assert.strictEqual(r2.subtitleFallback, true);
  assert.strictEqual(r2.channelMeta.find((m) => m.videoId === 'jNQXAC9IVRw').sourceComments.comments.length, 10);
});

test('mergeRetryCapture: union by id, the retry entry wins but keeps the first attempt\'s comments', () => {
  const snap = { state: 'ok', fetchedAt: 'x', comments: [1] };
  const out = run.mergeRetryCapture([{ videoId: 'a', v: 1, sourceComments: snap }, { videoId: 'b', v: 1 }], [{ videoId: 'a', v: 2 }]);
  assert.deepStrictEqual(out.map((m) => [m.videoId, m.v]), [['a', 2], ['b', 1]]);
  assert.strictEqual(out[0].sourceComments, snap);
  assert.deepStrictEqual(run.mergeRetryCapture(undefined, undefined), []);
});

test('shouldRetryWithoutComments: the predicate table', () => {
  const f = (reason) => ({ videoId: 'v', reason });
  assert.strictEqual(run.shouldRetryWithoutComments({ ok: false, code: 1, itemFailures: [] }), true, 'an unattributed exit 1');
  assert.strictEqual(run.shouldRetryWithoutComments({ ok: false, code: 1, itemFailures: [f('Unable to download API page')] }), true);
  assert.strictEqual(run.shouldRetryWithoutComments({ ok: false, code: 1, itemFailures: [f('Video unavailable')] }), false);
  assert.strictEqual(run.shouldRetryWithoutComments({ ok: false, code: 1, itemFailures: [f('Sign in to confirm you’re not a bot')] }), false);
  assert.strictEqual(run.shouldRetryWithoutComments({ ok: false, code: 1, itemFailures: [f('Video unavailable'), f('HTTP Error 500')] }), true, 'mixed: one rescuable is enough');
  assert.strictEqual(run.shouldRetryWithoutComments({ ok: true, code: 0 }), false);
  assert.strictEqual(run.shouldRetryWithoutComments({ ok: false, code: 'ETIMEDOUT', itemFailures: [] }), false);
});

test('bridge -> scan: the captured entry, recorded by the real writer, becomes the item\'s row in media_source_comments', async () => {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cc-scan-'));
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const { scanDirectories, updateDatabase, ytdlpDb, getMediaId, sourceCommentStore } = require('../../server');
    stubSpawnScript([{ stdout: [COMMENTS_LINE + '\n', META_LINE + '\n'], code: 0 }]);
    const r = await run.runDownload(sub, config(), ['jNQXAC9IVRw'], { saveComments: true });
    cp.spawn = originalSpawn;
    assert.strictEqual(await ytStore.recordDownloadChannelMeta({ updateDatabase, ytdlpDb }, r.channelMeta[0]), true, 'the real writer records it');
    const fp = path.join(downloadDir, 'Me at the zoo [jNQXAC9IVRw].mp4');
    fs.writeFileSync(fp, 'not a real video');
    await scanDirectories();
    const row = sourceCommentStore.get(getMediaId(fp));
    assert.ok(row, 'the scan wrote the row under the new item\'s id');
    assert.strictEqual(row.state, 'ok');
    assert.strictEqual(row.comments.length, 10);
    assert.strictEqual(row.comments[0].author, '@SanDiegoZoo');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});
