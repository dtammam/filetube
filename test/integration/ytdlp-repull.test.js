'use strict';

// [INTEGRATION] lib/ytdlp/run.js -- `repullItemMetaAndSubs`: the re-pull
// metadata+subtitle backfill spawn seam for a SINGLE already-downloaded
// video. `child_process.spawn` is spied by monkey-patching
// `require('child_process').spawn` (run.js references `cp.spawn` at call
// time, not a destructured import -- see the comment at the top of
// lib/ytdlp/run.js and test/integration/ytdlp-spawn-security.test.js, which
// this file mirrors). No real yt-dlp binary is ever invoked; no network is
// touched; no video is ever downloaded.

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

let capturedSpawnCalls;

beforeEach(() => {
  capturedSpawnCalls = [];
  console.error = () => {}; // silence expected failure-path logging
});

afterEach(() => {
  cp.spawn = originalSpawn;
  console.error = originalConsoleError;
});

// Same minimal fake-child harness as ytdlp-spawn-security.test.js.
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    setImmediate(() => child.emit('close', null, signal));
  };
  return child;
}

function stubSpawn() {
  cp.spawn = (cmd, argv, opts) => {
    const child = makeFakeChild();
    capturedSpawnCalls.push({ cmd, argv, opts, child });
    return child;
  };
  return (n) => capturedSpawnCalls[n !== undefined ? n : capturedSpawnCalls.length - 1].child;
}

function makeDownloadRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-root-'));
}

// `repullItemMetaAndSubs` is `async` and spawns Pass A and Pass B
// SEQUENTIALLY, separated by an `await`. Synchronously emitting Pass A's
// terminal event (`close`/`error`) resolves ITS underlying promise, but the
// function's own continuation (parsing Pass A's result, then spawning Pass
// B) only actually runs on a LATER microtask/macrotask tick -- so a test
// must yield back to the event loop before Pass B's spawn call is visible on
// `capturedSpawnCalls`. Same pattern already used throughout
// test/integration/ytdlp-oneshot.test.js and friends for a two-stage spawn.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VALID_META_JSON = {
  id: 'dQw4w9WgXcQ',
  channel_url: 'https://www.youtube.com/@SomeChannel',
  channel_id: 'UC1234567890123456789012',
  uploader_url: 'https://www.youtube.com/@SomeChannelHandle',
  channel: 'Some Channel',
  upload_date: '20230115',
  release_date: '20230120',
  channel_thumbnail: 'https://yt3.googleusercontent.com/avatar.jpg',
};

// ---- Arg construction: Pass A (metadata only) ------------------------------

test('repullItemMetaAndSubs Pass A: builds --dump-json --skip-download --no-warnings --no-playlist -- <url>, arg-array, never shell:true, no download flags', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  const { cmd, argv, opts } = capturedSpawnCalls[0];

  assert.equal(cmd, 'yt-dlp');
  assert.ok(Array.isArray(argv), 'argv must be a flat array, never a shell string');
  assert.notEqual(opts && opts.shell, true, 'shell:true must never be set');
  assert.ok(argv.includes('--dump-json'));
  assert.ok(argv.includes('--skip-download'));
  assert.ok(argv.includes('--no-warnings'));
  assert.ok(argv.includes('--no-playlist'));
  for (const flag of ['-f', '-x', '--merge-output-format', '--download-archive', '--audio-format']) {
    assert.ok(!argv.includes(flag), `Pass A must never carry the video-download flag ${flag}`);
  }
  const sepIdx = argv.indexOf('--');
  assert.ok(sepIdx >= 0, 'a bare "--" separator must be present');
  assert.equal(argv[sepIdx + 1], WATCH_URL);
  assert.equal(argv[argv.length - 1], WATCH_URL, 'the URL must be the LAST argv element');

  passAChild.stdout.emit('data', Buffer.from(JSON.stringify(VALID_META_JSON)));
  passAChild.emit('close', 0, null);
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);
  await resultPromise;
});

// ---- Arg construction: Pass B (subtitles only, pinned -o) ------------------

test('repullItemMetaAndSubs Pass B: builds the fixed subtitle flags + -o pinned to <dir>/<base>.%(ext)s (NOT %(title)s), no download flags, -- before the url', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.emit('close', 1, null); // Pass A fails -- irrelevant to this test
  await flush();
  const passBChild = spawnChild(1);
  const { argv } = capturedSpawnCalls[1];

  assert.ok(argv.includes('--write-subs'));
  assert.ok(argv.includes('--write-auto-subs'));
  const langIdx = argv.indexOf('--sub-langs');
  assert.ok(langIdx >= 0);
  assert.equal(argv[langIdx + 1], 'en.*');
  const fmtIdx = argv.indexOf('--sub-format');
  assert.ok(fmtIdx >= 0);
  assert.equal(argv[fmtIdx + 1], 'vtt');
  const convIdx = argv.indexOf('--convert-subs');
  assert.ok(convIdx >= 0);
  assert.equal(argv[convIdx + 1], 'vtt');
  assert.ok(argv.includes('--skip-download'));
  assert.ok(argv.includes('--no-warnings'));
  assert.ok(argv.includes('--no-playlist'));
  for (const flag of ['-f', '-x', '--merge-output-format', '--download-archive', '--audio-format']) {
    assert.ok(!argv.includes(flag), `Pass B must never carry the video-download flag ${flag}`);
  }

  const outIdx = argv.indexOf('-o');
  assert.ok(outIdx >= 0);
  const expectedTemplate = path.join(root, 'My Video [dQw4w9WgXcQ].%(ext)s');
  assert.equal(argv[outIdx + 1], expectedTemplate, '-o must be pinned to <dir>/<base>.%(ext)s, never a %(title)s template');
  assert.ok(!argv.some((a) => typeof a === 'string' && a.includes('%(title)s')), 'no argv element may contain a %(title)s template');

  const sepIdx = argv.indexOf('--');
  assert.ok(sepIdx >= 0);
  assert.equal(argv[sepIdx + 1], WATCH_URL);
  assert.equal(argv[argv.length - 1], WATCH_URL);

  passBChild.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.wroteSubs, true);
});

// ---- Gate finding: literal `%` in the on-disk basename must be escaped to
// `%%` before being interpolated into Pass B's `-o` template, so yt-dlp never
// re-parses a `%(...)s`-shaped substring in the FILENAME as a real template
// field and re-expands it against the current run's info-dict. -------------

test('repullItemMetaAndSubs Pass B: a basename containing a %(...)s-shaped substring is escaped (%% ) in the -o template, while the trailing .%(ext)s stays a single-percent real token', async () => {
  const root = makeDownloadRoot();
  const rawBase = 'Cool clip (%(title)s) [dQw4w9WgXcQ]';
  const mediaFilePath = path.join(root, `${rawBase}.mp4`);
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.emit('close', 1, null); // Pass A fails -- irrelevant to this test
  await flush();
  const passBChild = spawnChild(1);
  const { argv } = capturedSpawnCalls[1];

  const outIdx = argv.indexOf('-o');
  assert.ok(outIdx >= 0);
  const actualTemplate = argv[outIdx + 1];
  // `rawBase` contains exactly ONE literal `%` (in `%(title)s`) -- only that
  // one occurrence is doubled; `(title)s` around it is untouched.
  const expectedEscapedBase = 'Cool clip (%%(title)s) [dQw4w9WgXcQ]';
  assert.equal(actualTemplate, path.join(root, `${expectedEscapedBase}.%(ext)s`));

  // Reconstruct what yt-dlp itself would do: un-escape `%%` -> `%` ONLY on
  // the base portion (the template minus its trailing, real `.%(ext)s`
  // token), then expand the trailing real token against a stand-in
  // extension -- the result must be exactly `<base>.<ext>`, i.e. the sidecar
  // anchor `findSubtitleSidecar` (lib/subtitles.js) expects.
  const templateWithoutTrailingExtToken = actualTemplate.slice(0, -'.%(ext)s'.length);
  const unescapedBase = templateWithoutTrailingExtToken.replace(/%%/g, '%');
  assert.equal(unescapedBase, path.join(root, rawBase));
  const reconstructed = `${unescapedBase}.vtt`; // stand-in for yt-dlp's own %(ext)s expansion
  assert.equal(reconstructed, path.join(root, `${rawBase}.vtt`), 'the escape must round-trip to exactly <base>.<ext>, never a re-expanded token');

  passBChild.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.wroteSubs, true);
});

test('repullItemMetaAndSubs Pass B: a basename with a bare % is doubled to %% in the -o template', async () => {
  const root = makeDownloadRoot();
  const rawBase = '50% off [dQw4w9WgXcQ]';
  const mediaFilePath = path.join(root, `${rawBase}.mp4`);
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.emit('close', 1, null);
  await flush();
  const passBChild = spawnChild(1);
  const { argv } = capturedSpawnCalls[1];

  const outIdx = argv.indexOf('-o');
  assert.ok(outIdx >= 0);
  const expectedTemplate = path.join(root, '50%% off [dQw4w9WgXcQ].%(ext)s');
  assert.equal(argv[outIdx + 1], expectedTemplate, 'a bare % in the basename must be doubled to %%');

  passBChild.emit('close', 0, null);
  await resultPromise;
});

test('repullItemMetaAndSubs Pass B: a normal basename with no % is left unchanged in the -o template (regression)', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.emit('close', 1, null);
  await flush();
  const passBChild = spawnChild(1);
  const { argv } = capturedSpawnCalls[1];

  const outIdx = argv.indexOf('-o');
  assert.ok(outIdx >= 0);
  const expectedTemplate = path.join(root, 'My Video [dQw4w9WgXcQ].%(ext)s');
  assert.equal(argv[outIdx + 1], expectedTemplate, 'a basename with no % must be unchanged');

  passBChild.emit('close', 0, null);
  await resultPromise;
});

test('repullItemMetaAndSubs threads cookiesArgs into BOTH passes when a cookies file is configured and present on disk', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const cookiesFile = path.join(root, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.emit('close', 1, null);
  await flush();
  const passBChild = spawnChild(1);

  const passAArgv = capturedSpawnCalls[0].argv;
  const passBArgv = capturedSpawnCalls[1].argv;
  for (const argv of [passAArgv, passBArgv]) {
    const idx = argv.indexOf('--cookies');
    assert.ok(idx >= 0, '--cookies must be present in both passes when a usable cookies file is configured');
    assert.equal(argv[idx + 1], cookiesFile);
  }
  passBChild.emit('close', 0, null);
  await resultPromise;
});

// ---- Path confinement (Pass B only) ----------------------------------------

test('repullItemMetaAndSubs: a mediaFilePath OUTSIDE the configured download root skips Pass B entirely (no second spawn, wroteSubs false)', async () => {
  const root = makeDownloadRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-outside-'));
  const mediaFilePath = path.join(outsideDir, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.stdout.emit('data', Buffer.from(JSON.stringify(VALID_META_JSON)));
  passAChild.emit('close', 0, null);
  const result = await resultPromise;

  assert.equal(capturedSpawnCalls.length, 1, 'Pass B must never spawn when mediaFilePath is outside the configured download root');
  assert.equal(result.wroteSubs, false);
  assert.equal(result.releaseDate, Date.UTC(2023, 0, 20));
});

test('repullItemMetaAndSubs: a mediaFilePath INSIDE the configured download root allows Pass B to spawn normally', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.emit('close', 1, null);
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);
  const result = await resultPromise;

  assert.equal(capturedSpawnCalls.length, 2, 'an in-root mediaFilePath must allow Pass B to spawn');
  assert.equal(result.wroteSubs, true);
});

// ---- JSON parse + INDEPENDENT field validators (parseCapturedReleaseDate /
// sanitizeChannelAvatarUrl) wiring -- deliberately NOT the combined
// `sanitizeCapturedChannelMeta` (which drops releaseDate too when no valid
// channel URL survives -- unacceptable for a date-focused backfill). --------

test('repullItemMetaAndSubs: a well-formed Pass A JSON produces releaseDate (epoch ms, release_date preferred over upload_date) and channelAvatarUrl', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.stdout.emit('data', Buffer.from(JSON.stringify(VALID_META_JSON)));
  passAChild.emit('close', 0, null);
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);
  const result = await resultPromise;

  assert.equal(result.releaseDate, Date.UTC(2023, 0, 20), 'release_date must be preferred over upload_date');
  assert.equal(result.channelAvatarUrl, 'https://yt3.googleusercontent.com/avatar.jpg');
  assert.equal(result.wroteSubs, true);
});

test('repullItemMetaAndSubs: a valid release_date is preserved even when the channel URL is MISSING (the sanitizeCapturedChannelMeta regression this independent wiring fixes)', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.stdout.emit('data', Buffer.from(JSON.stringify({
    id: 'dQw4w9WgXcQ',
    release_date: '20230120',
    // channel_url / uploader_url deliberately absent
  })));
  passAChild.emit('close', 0, null);
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);
  const result = await resultPromise;

  assert.equal(result.releaseDate, Date.UTC(2023, 0, 20), 'a valid date must survive a missing channel URL');
  assert.equal(result.channelAvatarUrl, undefined);
});

test('repullItemMetaAndSubs: a valid release_date is preserved even when the channel URL is present but INVALID (fails validateChannelUrl)', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.stdout.emit('data', Buffer.from(JSON.stringify({
    id: 'dQw4w9WgXcQ',
    release_date: '20230120',
    channel_url: 'https://not-a-youtube-host.example.com/@SomeChannel', // fails validateChannelUrl's host allowlist
    uploader_url: 'https://also-not-youtube.example.com/@Handle',
  })));
  passAChild.emit('close', 0, null);
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);
  const result = await resultPromise;

  assert.equal(result.releaseDate, Date.UTC(2023, 0, 20), 'a valid date must survive an invalid channel URL');
  assert.equal(result.channelAvatarUrl, undefined);
});

test('repullItemMetaAndSubs: release_date absent falls back to upload_date', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.stdout.emit('data', Buffer.from(JSON.stringify({
    id: 'dQw4w9WgXcQ',
    upload_date: '20220605',
    // release_date deliberately absent
  })));
  passAChild.emit('close', 0, null);
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);
  const result = await resultPromise;

  assert.equal(result.releaseDate, Date.UTC(2022, 5, 5), 'upload_date must be used when release_date is absent');
});

test('repullItemMetaAndSubs: a valid channel_thumbnail produces channelAvatarUrl independent of the date fields', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.stdout.emit('data', Buffer.from(JSON.stringify({
    id: 'dQw4w9WgXcQ',
    channel_thumbnail: 'https://yt3.googleusercontent.com/avatar.jpg',
    // upload_date / release_date deliberately absent
  })));
  passAChild.emit('close', 0, null);
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);
  const result = await resultPromise;

  assert.equal(result.channelAvatarUrl, 'https://yt3.googleusercontent.com/avatar.jpg');
  assert.equal(result.releaseDate, undefined, 'no date field was present -- releaseDate must be omitted');
});

test('repullItemMetaAndSubs: neither release_date nor upload_date present omits releaseDate (no throw)', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.stdout.emit('data', Buffer.from(JSON.stringify({
    id: 'dQw4w9WgXcQ',
    title: 'Some title with no date fields at all',
  })));
  passAChild.emit('close', 0, null);
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);
  const result = await resultPromise;

  assert.equal(result.releaseDate, undefined);
  assert.equal(result.channelAvatarUrl, undefined);
  assert.equal(result.wroteSubs, true, 'wroteSubs must still be reported even when Pass A yields no fields at all');
});

test('repullItemMetaAndSubs: malformed/empty Pass A stdout is null-safe (never throws), Pass B still attempted', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.stdout.emit('data', Buffer.from('this is not json'));
  passAChild.emit('close', 0, null);
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);

  const result = await resultPromise;
  assert.equal(result.releaseDate, undefined);
  assert.equal(result.channelAvatarUrl, undefined);
  assert.equal(result.wroteSubs, true);
});

test('repullItemMetaAndSubs: empty Pass A stdout is null-safe, and BOTH passes failing resolves null (never throws)', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.emit('close', 0, null); // ok, but empty stdout
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 1, null); // Pass B also fails

  const result = await resultPromise;
  assert.equal(result, null, 'both passes failing/empty must resolve null, never throw');
});

// ---- Never-throws posture ---------------------------------------------------

test('repullItemMetaAndSubs: Pass A binary-missing (ENOENT) + Pass B ok returns a partial result with wroteSubs true', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }));
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);

  const result = await resultPromise;
  assert.deepEqual(result, { wroteSubs: true });
});

test('repullItemMetaAndSubs: Pass A ok + Pass B non-zero exit returns a partial result with wroteSubs false', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  passAChild.stdout.emit('data', Buffer.from(JSON.stringify(VALID_META_JSON)));
  passAChild.emit('close', 0, null);
  await flush();
  const passBChild = spawnChild(1);
  passBChild.emit('close', 1, null);

  const result = await resultPromise;
  assert.equal(result.releaseDate, Date.UTC(2023, 0, 20));
  assert.equal(result.channelAvatarUrl, 'https://yt3.googleusercontent.com/avatar.jpg');
  assert.equal(result.wroteSubs, false);
});

test('repullItemMetaAndSubs: Pass B binary-missing (ENOENT) is caught too -- resolves a partial result, never rejects', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  cp.spawn = (cmd, argv) => {
    if (argv.includes('--dump-json')) {
      const child = makeFakeChild();
      capturedSpawnCalls.push({ cmd, argv, child });
      return child;
    }
    throw new Error('boom'); // Pass B: spawn itself throws synchronously
  };
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = capturedSpawnCalls[0].child;
  passAChild.stdout.emit('data', Buffer.from(JSON.stringify(VALID_META_JSON)));
  passAChild.emit('close', 0, null);

  const result = await resultPromise;
  assert.equal(result.releaseDate, Date.UTC(2023, 0, 20));
  assert.equal(result.wroteSubs, false);
});

test('repullItemMetaAndSubs: a hung Pass A is killed by its OWN dedicated REPULL_TIMEOUT_MS, and Pass B still runs to completion normally afterward', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  const passAChild = spawnChild(0);
  t.mock.timers.tick(run.REPULL_TIMEOUT_MS);
  assert.deepEqual(passAChild.killCalls, ['SIGKILL'], 'Pass A must be killed by its own dedicated timeout');
  // The fake child's kill() schedules its 'close' event via a real
  // (unmocked) setImmediate -- wait for it so Pass B's spawn has actually
  // happened before asserting against it.
  await new Promise((resolve) => setImmediate(resolve));
  const passBChild = spawnChild(1);
  passBChild.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.wroteSubs, true, 'Pass B must still run to completion even though Pass A timed out');
  assert.equal(result.releaseDate, undefined, 'a timed-out Pass A must never contribute a releaseDate');
});

test('repullItemMetaAndSubs both spawns arm the dedicated REPULL_TIMEOUT_MS, never DEFAULT_LIST_TIMEOUT_MS or PROBE_TIMEOUT_MS', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  const originalSetTimeout = global.setTimeout;
  const capturedDelays = [];
  global.setTimeout = (fn, delay, ...rest) => {
    capturedDelays.push(delay);
    return originalSetTimeout(fn, delay, ...rest);
  };
  let result;
  try {
    const resultPromise = run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
    const passAChild = spawnChild(0);
    passAChild.emit('close', 1, null);
    await flush();
    const passBChild = spawnChild(1);
    passBChild.emit('close', 0, null);
    result = await resultPromise;
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.equal(result.wroteSubs, true);
  assert.ok(capturedDelays.length >= 2, 'both passes must arm their own timer');
  assert.equal(capturedDelays[0], run.REPULL_TIMEOUT_MS);
  assert.equal(capturedDelays[1], run.REPULL_TIMEOUT_MS);
  assert.equal(run.REPULL_TIMEOUT_MS, 60 * 1000, 'sanity: the dedicated repull timeout is 60 seconds');
  assert.notEqual(run.REPULL_TIMEOUT_MS, run.DEFAULT_LIST_TIMEOUT_MS, 'must never use the 5-minute whole-channel list timeout');
  assert.notEqual(run.REPULL_TIMEOUT_MS, run.PROBE_TIMEOUT_MS, 'must be its own dedicated constant, not an alias of PROBE_TIMEOUT_MS');
});

test('repullItemMetaAndSubs resolves null immediately, without spawning, when watchUrl or mediaFilePath is missing/not a string', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  const spawnChild = stubSpawn();
  const config = { downloadDir: root, cookiesFile: null };

  assert.equal(await run.repullItemMetaAndSubs(undefined, mediaFilePath, config), null);
  assert.equal(await run.repullItemMetaAndSubs(null, mediaFilePath, config), null);
  assert.equal(await run.repullItemMetaAndSubs('', mediaFilePath, config), null);
  assert.equal(await run.repullItemMetaAndSubs(WATCH_URL, undefined, config), null);
  assert.equal(await run.repullItemMetaAndSubs(WATCH_URL, null, config), null);
  assert.equal(await run.repullItemMetaAndSubs(WATCH_URL, '', config), null);
  assert.equal(capturedSpawnCalls.length, 0, 'an invalid watchUrl/mediaFilePath must never reach the spawn boundary');
  void spawnChild;
});

test('repullItemMetaAndSubs never throws even if spawn itself throws synchronously on Pass A', async () => {
  const root = makeDownloadRoot();
  const mediaFilePath = path.join(root, 'My Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(mediaFilePath, 'not a real video');
  cp.spawn = () => { throw new Error('boom'); };
  const config = { downloadDir: root, cookiesFile: null };
  const result = await run.repullItemMetaAndSubs(WATCH_URL, mediaFilePath, config);
  assert.equal(result, null);
});
