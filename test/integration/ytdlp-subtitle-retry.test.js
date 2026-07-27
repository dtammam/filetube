'use strict';

// [INTEGRATION] v1.47.4 item 1 (L2) -- the subtitle-stripped retry, at the REAL
// spawn boundary.
//
// WHY THIS FILE EXISTS (v1.47.4 two-reviewer gate, both seats):
//
// The original v1.47.4 tests covered only the pure predicate
// `shouldRetryWithoutSubtitles`, using fixtures that HAND-AUTHORED
// `subtitleOnly: true` onto the failure object. That is the divergent-fixture
// class this repo has been burned by before (v1.41.9: "a resurrect/identity
// test MUST build the survivor at a DIVERGENT spelling" -- a test that
// constructs its own input can stay green through a completely broken
// pipeline). It did exactly that here, hiding TWO criticals:
//
//   CRITICAL 1: `run.js`'s stderr handler whitelisted `{videoId, reason}` when
//     building `itemFailures`, silently dropping `subtitleOnly`. The retry
//     predicate could therefore never be true for ANY real input -- the whole
//     containment layer was unreachable dead code. (The same drop had also made
//     v1.36.2's "transcripts must be non-blocking" fix inert since it shipped.)
//   CRITICAL 2: yt-dlp raises a plain DownloadError from `_write_subtitles`,
//     not an ExtractorError, so the real 429 line carries NO `[extractor] <id>:`
//     prefix and was not classified as a subtitle failure at all.
//
// So every fixture below is a VERBATIM yt-dlp stderr line, pushed through the
// real `spawnYtdlpDownload` stderr path, and the assertions are made on what
// the pipeline actually produces. Nothing here hand-builds a parsed failure.
//
// The 429 line is reproduced verbatim from a live yt-dlp 2026.07.04 run against
// Dean's reported video (8Z2tmZy_Vj0).

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const run = require('../../lib/ytdlp/run');

const originalSpawn = cp.spawn;
const originalConsoleError = console.error;

// THE line Dean reported, captured verbatim from a real extraction.
const REAL_429_LINE = "ERROR: Unable to download video subtitles for 'en-en-US': HTTP Error 429: Too Many Requests";

let spawnCalls;

beforeEach(() => {
  spawnCalls = [];
  console.error = () => {};
});

afterEach(() => {
  cp.spawn = originalSpawn;
  console.error = originalConsoleError;
});

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => setImmediate(() => child.emit('close', null, signal));
  return child;
}

/**
 * Stub spawn so each invocation is driven by `script[n]` -- `{stderr, code}`.
 * Every call is recorded with its argv so the retry's ARGV can be asserted,
 * not just its existence.
 */
function stubSpawnScript(script) {
  cp.spawn = (cmd, argv) => {
    const child = makeFakeChild();
    const index = spawnCalls.length;
    spawnCalls.push({ cmd, argv, index });
    const step = script[index] || { stderr: '', code: 0 };
    setImmediate(() => {
      if (step.stderr) child.stderr.emit('data', Buffer.from(step.stderr + '\n'));
      setImmediate(() => child.emit('close', step.code, null));
    });
    return child;
  };
}

function makeConfig() {
  return { downloadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subretry-')), cookiesFile: null };
}

function baseSub() {
  return {
    id: 'sub1',
    channelUrl: 'https://www.youtube.com/@somechannel',
    name: 'Some Channel',
    format: 'video',
    quality: 'best',
  };
}

const SUBTITLE_FLAGS = ['--write-subs', '--write-auto-subs', '--sub-langs', '--sub-format', '--convert-subs'];

// ---- CRITICAL 2 regression: the real line must be recognized ---------------

test("CRITICAL 2 LOCK: yt-dlp's real subtitle-429 line (no [extractor] prefix) reaches itemFailures tagged subtitleOnly", async () => {
  stubSpawnScript([{ stderr: REAL_429_LINE, code: 1 }, { stderr: '', code: 0 }]);
  const result = await run.runDownload(baseSub(), makeConfig(), ['vid1']);
  // Produced BY THE PIPELINE, never hand-authored.
  const originals = result.subtitleFallbackFrom;
  assert.ok(Array.isArray(originals) && originals.length > 0,
    'the real 429 line must produce an attributed failure');
  assert.equal(originals[0].subtitleOnly, true,
    'CRITICAL 1+2: subtitleOnly must survive parsing AND run.js\'s itemFailures push');
  assert.match(originals[0].reason, /Unable to download video subtitles/);
});

// ---- the retry itself ------------------------------------------------------

test('a subtitle failure triggers EXACTLY ONE retry, whose argv has every subtitle flag stripped', async () => {
  stubSpawnScript([{ stderr: REAL_429_LINE, code: 1 }, { stderr: '', code: 0 }]);
  const result = await run.runDownload(baseSub(), makeConfig(), ['vid1']);

  assert.equal(spawnCalls.length, 2, 'exactly one retry -- never zero, never a loop');
  for (const flag of SUBTITLE_FLAGS) {
    assert.ok(spawnCalls[0].argv.includes(flag), `first attempt must still request subtitles (${flag})`);
    assert.ok(!spawnCalls[1].argv.includes(flag), `the retry must drop ${flag}`);
  }
  // The video is what matters: the retry's result is what the caller sees.
  assert.equal(result.ok, true, 'the video lands on the retry');
  assert.equal(result.subtitleFallback, true, 'and the caller can tell captions were sacrificed');
});

test('the retry targets the SAME ids -- it never silently narrows or widens the download', async () => {
  stubSpawnScript([{ stderr: REAL_429_LINE, code: 1 }, { stderr: '', code: 0 }]);
  await run.runDownload(baseSub(), makeConfig(), ['vid1', 'vid2', 'vid3']);
  const positionals = (argv) => argv.slice(argv.indexOf('--') + 1);
  assert.deepEqual(positionals(spawnCalls[1].argv), positionals(spawnCalls[0].argv));
});

test('the retry does not loop: a SECOND subtitle failure is not retried again', async () => {
  // The retry's argv has no subtitle flags, so it cannot produce another
  // subtitle failure in practice -- but the code must be structurally
  // non-recursive regardless of what stderr says.
  stubSpawnScript([
    { stderr: REAL_429_LINE, code: 1 },
    { stderr: REAL_429_LINE, code: 1 },
    { stderr: '', code: 0 },
  ]);
  const result = await run.runDownload(baseSub(), makeConfig(), ['vid1']);
  assert.equal(spawnCalls.length, 2, 'at most two spawns, ever');
  assert.equal(result.ok, false, 'and the second failure is reported honestly, not retried away');
});

// ---- what must NOT retry ---------------------------------------------------

test('a purely structural failure never retries (no captions are sacrificed for nothing)', async () => {
  stubSpawnScript([{ stderr: 'ERROR: [youtube] vid1: Video unavailable', code: 1 }]);
  const result = await run.runDownload(baseSub(), makeConfig(), ['vid1']);
  assert.equal(spawnCalls.length, 1);
  assert.equal(result.subtitleFallback, undefined);
});

test('ANTI-SPOOF: a creator-controlled title containing "Subtitles" cannot trigger a retry', async () => {
  // Before v1.47.4 tightened the reason matcher, the bare noun `subtitl`
  // matched here -- so a MERGE failure on a video titled "How To Add Subtitles
  // To Your Videos" was classified subtitle-only. Consequence:
  // computeDownloadOutcome would DISCOUNT it and report a genuinely broken
  // download as a success. Exactly the failure mode this wave refused
  // `--ignore-errors` for.
  stubSpawnScript([
    { stderr: 'ERROR: [youtube] vid1: Merging failed for video How To Add Subtitles To Your Videos', code: 1 },
  ]);
  const result = await run.runDownload(baseSub(), makeConfig(), ['vid1']);
  assert.equal(spawnCalls.length, 1, 'a merge failure must not masquerade as a subtitle failure');
  assert.equal(result.itemFailures[0].subtitleOnly, undefined,
    'a real failure must stay a real failure -- over-matching silently loses videos');
});

test('a CANCELLED/timed-out first attempt never retries (a kill must not resurrect the job)', async () => {
  // A killed child closes with a null/string code, never a numeric one. The
  // retry guard keys on that, so a user pressing cancel can never cause a
  // second spawn.
  cp.spawn = (cmd, argv) => {
    const child = makeFakeChild();
    spawnCalls.push({ cmd, argv });
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from(REAL_429_LINE + '\n'));
      setImmediate(() => child.emit('close', null, 'SIGKILL'));
    });
    return child;
  };
  const result = await run.runDownload(baseSub(), makeConfig(), ['vid1']);
  assert.equal(spawnCalls.length, 1, 'a killed attempt must never be retried');
  assert.equal(result.ok, false);
});

// ---- the happy path is untouched -------------------------------------------

test('a clean download spawns once and carries no fallback marker', async () => {
  stubSpawnScript([{ stderr: '', code: 0 }]);
  const result = await run.runDownload(baseSub(), makeConfig(), ['vid1']);
  assert.equal(spawnCalls.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.subtitleFallback, undefined,
    'a normal success must not be labelled as caption-less');
});

// ---- gate delta: subtitleFallback must mean THE MEDIA LANDED ---------------

test('a retry that ALSO fails is NOT labelled "saved without captions"', () => {
  // Found while wiring the subscription lane's L3 row. `subtitleFallback` was
  // set unconditionally on the retry, so a retry that also failed claimed the
  // video was safely on disk without captions -- when nothing had downloaded at
  // all. That is the dishonest-success class this wave refused --ignore-errors
  // for, and it would have told Dean a missing video was fine.
  stubSpawnScript([
    { stderr: REAL_429_LINE, code: 1 },
    { stderr: 'ERROR: [youtube] vid1: Video unavailable', code: 1 },
  ]);
  return run.runDownload(baseSub(), makeConfig(), ['vid1']).then((result) => {
    assert.equal(spawnCalls.length, 2, 'the retry still happens');
    assert.equal(result.ok, false);
    assert.equal(result.subtitleFallback, undefined,
      'no media landed, so nothing may claim it was saved without captions');
    // The diagnostic payload survives regardless -- it matters MOST here.
    assert.ok(Array.isArray(result.subtitleFallbackFrom) && result.subtitleFallbackFrom.length > 0,
      'the original subtitle failure must still be reportable');
  });
});
