'use strict';

// [INTEGRATION] v1.338 D9 (Dean: "Reheat is fine" for downloads from any site; plan
// docs/exec-plans/active/2026-09-26-first-class-any-site.md): the re-pull's UNIVERSAL mode re-pulls a
// download from another site from its STORED page link, behind the download lane's own guards. The
// spawn boundary is the real one (`child_process.spawn` monkey-patched, the ytdlp-repull.test.js
// harness); the DNS resolve-then-check takes an injected lookup.

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
let calls;

beforeEach(() => { calls = []; console.error = () => {}; });
afterEach(() => { cp.spawn = originalSpawn; console.error = originalConsoleError; });

function stubSpawn() {
  cp.spawn = (cmd, argv, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', null, 'SIGKILL'));
    calls.push({ cmd, argv, opts, child });
    return child;
  };
}
const flush = () => new Promise((r) => setImmediate(r));
async function waitForCall(n) { for (let i = 0; i < 50 && calls.length <= n; i++) await flush(); return calls[n]; }
const PUBLIC = (host, o, cb) => cb(null, [{ address: '151.101.1.140', family: 4 }]);
const PRIVATE = (host, o, cb) => cb(null, [{ address: '10.0.0.5', family: 4 }]);
const PAGE = 'https://www.reddit.com/r/videos/comments/abc123/a_clip/';

// A refusal must come back null WITHOUT spawning; racing a timer turns a mutant that spawned (and so
// awaits a fake child that never closes) into a clean failure instead of a cancelled test.
async function refused(url, f, root, lookup) {
  return Promise.race([
    run.repullItemMetaAndSubs(url, f, { downloadDir: root }, { universal: true, lookup, expectSourceId: 'abc123' }),
    new Promise((res) => setTimeout(() => res('HUNG: it spawned'), 300)),
  ]);
}

function mediaFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-uni-'));
  const f = path.join(root, 'someone', 'A clip [Reddit=abc123].mp4');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'not a real video');
  return { root, f };
}

test('universal re-pull: BOTH passes carry the named-extractor gate and the one-item bound, the guarded URL last', async () => {
  const { root, f } = mediaFile();
  stubSpawn();
  const p = run.repullItemMetaAndSubs(PAGE, f, { downloadDir: root, cookiesFile: null }, { universal: true, lookup: PUBLIC, expectSourceId: 'abc123' });
  const a = await waitForCall(0);
  for (const argv of [a.argv]) {
    const g = argv.indexOf('--use-extractors');
    assert.ok(g >= 0 && argv[g + 1] === 'default,-generic', 'no generic scrape-any-page fallback');
    assert.ok(argv.includes('--no-playlist') && argv[argv.indexOf('--playlist-items') + 1] === '1', 'one item');
    assert.strictEqual(argv[argv.length - 1], PAGE);
    assert.strictEqual(argv[argv.length - 2], '--');
  }
  // A YouTube-shaped channel identity rides the dump (gate adversary r1 S4) so "the capture is skipped"
  // below can fail: the universal mode must not turn it into a channel.
  a.child.stdout.emit('data', Buffer.from(JSON.stringify({ id: 'abc123', title: 'A clip, refreshed', view_count: 42, upload_date: '20260101',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw', channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw', channel: 'Someone' })));
  a.child.emit('close', 0, null);
  const b = await waitForCall(1);
  const g = b.argv.indexOf('--use-extractors');
  assert.ok(g >= 0 && b.argv[g + 1] === 'default,-generic', 'the subtitle pass is gated too');
  assert.strictEqual(b.argv[b.argv.length - 1], PAGE);
  b.child.emit('close', 0, null);
  const result = await p;
  assert.strictEqual(result.sourceTitle, 'A clip, refreshed');
  assert.strictEqual(result.sourceViewCount, 42);
  assert.strictEqual(result.channel, undefined, 'the YouTube-only channel capture is skipped');
});

test('universal re-pull: a private / local / credentialed / non-http link is refused with NO spawn', async () => {
  const { root, f } = mediaFile();
  stubSpawn();
  // The lane's intake check refuses the link ITSELF: a structural `refused` (gate adversary r1 S3), so
  // the reheat stops retrying it.
  for (const bad of ['http://127.0.0.1/x', 'http://10.1.2.3/v', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/', 'https://user:pw@www.reddit.com/x', 'file:///etc/passwd', 'javascript:alert(1)', '-oProxy=x']) {
    assert.deepStrictEqual(await refused(bad, f, root, PUBLIC), { refused: 'implausible-link', wroteSubs: false }, bad);
  }
  // only the download lane's intake check refuses these (the DNS guard alone would pass them): its
  // forbidden-character set and its length cap
  for (const bad of ['https://www.reddit.com/r/v/$(id)', 'https://www.reddit.com/r/v;x', 'https://www.reddit.com/r/v/' + 'a'.repeat(2100)]) {
    assert.deepStrictEqual(await refused(bad, f, root, PUBLIC), { refused: 'implausible-link', wroteSubs: false }, bad.slice(0, 60));
  }
  assert.strictEqual(calls.length, 0, 'yt-dlp never ran');
});

test('universal re-pull: a public NAME that resolves to a private address is refused (DNS resolve-then-check), no spawn', async () => {
  const { root, f } = mediaFile();
  stubSpawn();
  assert.strictEqual(await refused('https://sneaky.example/v/1', f, root, PRIVATE), null);
  const unresolvable = (h, o, cb) => cb(new Error('ENOTFOUND'));
  assert.strictEqual(await refused('https://nowhere.example/v/1', f, root, unresolvable), null, 'fail closed');
  assert.strictEqual(calls.length, 0);
});

test('gate adversary r1 W1: a saved link that now shows a DIFFERENT video is refused - nothing kept, Pass B never runs', async () => {
  // A Twitch live recording saves the channel url; an Instagram stories download the stories feed. Today
  // that page is another video: its title / date / counts must not overwrite this item's.
  const { root, f } = mediaFile();
  stubSpawn();
  const p = run.repullItemMetaAndSubs(PAGE, f, { downloadDir: root, cookiesFile: null }, { universal: true, lookup: PUBLIC, expectSourceId: 'abc123' });
  const a = await waitForCall(0);
  a.child.stdout.emit('data', Buffer.from(JSON.stringify({ id: 'zzz999', title: 'A DIFFERENT video', view_count: 99, upload_date: '20260901' })));
  a.child.emit('close', 0, null);
  assert.deepStrictEqual(await p, { refused: 'different-video', wroteSubs: false });
  assert.strictEqual(calls.length, 1, 'no subtitle pass: another video\'s captions never become this file\'s sidecar');
});

test('gate adversary r1 W1: an unverified Pass A (a timeout, a 429) keeps nothing and skips Pass B, retryable (null)', async () => {
  const { root, f } = mediaFile();
  stubSpawn();
  const p = run.repullItemMetaAndSubs(PAGE, f, { downloadDir: root, cookiesFile: null }, { universal: true, lookup: PUBLIC, expectSourceId: 'abc123' });
  const a = await waitForCall(0);
  a.child.emit('close', 1, null);
  assert.strictEqual(await p, null);
  assert.strictEqual(calls.length, 1, 'no subtitle pass from an unverified page');
});

test('sameSourceId: exact, or equal as letters and digits (the filename bracket\'s sanitized id); never on empty', () => {
  assert.strictEqual(run.sameSourceId('abc123', 'abc123'), true);
  assert.strictEqual(run.sameSourceId('austrian/page=1', 'austrian\u29f8page=1'), true, 'the bracket rendering of a slash');
  assert.strictEqual(run.sameSourceId('zzz999', 'abc123'), false);
  assert.strictEqual(run.sameSourceId('', ''), false);
  assert.strictEqual(run.sameSourceId('///', '\u29f8\u29f8'), false, 'nothing left to compare');
  assert.strictEqual(run.sameSourceId(undefined, 'abc123'), false);
  assert.strictEqual(run.sameSourceId('abc123', null), false);
});

test('UNCHANGED: a YouTube re-pull carries no extractor gate and no DNS step (spawns at once)', async () => {
  const { root, f } = mediaFile();
  stubSpawn();
  const p = run.repullItemMetaAndSubs('https://www.youtube.com/watch?v=dQw4w9WgXcQ', f, { downloadDir: root, cookiesFile: null });
  assert.strictEqual(calls.length, 1, 'spawned synchronously - no await before the first pass');
  assert.ok(!calls[0].argv.includes('--use-extractors'));
  assert.ok(!calls[0].argv.includes('--playlist-items'));
  calls[0].child.emit('close', 1, null);
  const b = await waitForCall(1);
  b.child.emit('close', 1, null);
  await p;
});
