'use strict';

// [INTEGRATION] v1.370.0 W2 (plan docs/exec-plans/completed/2026-10-06-v1370-playlist-picker.md, R4, R5, R10, R11, R14):
// GET /api/ytdlp/playlist lists ONE PAGE of a playlist for the picker, through the REAL spawn boundary:
// the route -> run.listPlaylistPage -> spawnYtdlp -> a FAKE `yt-dlp` on PATH that prints the VERBATIM T0
// output (test/fixtures/ytdlp-playlist/, README there). Nothing between the route and the child is stubbed.
// The fake honours --playlist-start/--playlist-end over the fixture's entries, and models
// --download-archive the way yt-dlp does in a flat listing (an archived id is skipped), so a builder who
// adds the archive to the listing argv sees an in-library entry vanish here.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const FIX = path.join(__dirname, '..', 'fixtures', 'ytdlp-playlist');
const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-playlist-bin-'));
const FAKE = String.raw`
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('2026.08.19\n'); process.exit(0); }
if (process.env.FAKE_PL_LOG) fs.appendFileSync(process.env.FAKE_PL_LOG, JSON.stringify(argv) + '\n');
const FIX = process.env.FAKE_PL_FIX;
const mode = process.env.FAKE_PL_MODE || 'example';
const valueOf = (flag) => { const i = argv.lastIndexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const wait = Number(process.env.FAKE_PL_WAIT_MS || 0);
if (wait) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
if (mode === 'missing') { process.stderr.write(fs.readFileSync(path.join(FIX, 'missing-list.stderr.txt'))); process.stdout.write('null\n'); process.exit(1); }
if (mode === 'mix') { process.stdout.write(fs.readFileSync(path.join(FIX, 'mix-as-video-subset.json'))); process.exit(0); }
if (mode === 'garbage') { process.stdout.write('{"_type": "playlist", "entries": [\n'); process.exit(0); }
const file = mode === 'uploads' ? 'uploads-page2-trimmed.json' : 'example-list-PLUtyNbQXMTLg.json';
const doc = JSON.parse(fs.readFileSync(path.join(FIX, file), 'utf8'));
if (mode === 'exact200') { const e0 = doc.entries[0]; doc.entries = Array.from({ length: 200 }, (_, i) => Object.assign({}, e0, { id: ('x' + String(i).padStart(10, '0')).slice(0, 11) })); doc.playlist_count = 200; fs.writeSync(1, JSON.stringify(doc) + '\n'); process.exit(0); } // writeSync: a ~280 KB pipe write would be cut by process.exit
if (mode === 'example' || mode === 'private') {
  const start = Number(valueOf('--playlist-start') || 1);
  const end = Number(valueOf('--playlist-end') || doc.entries.length);
  doc.entries = doc.entries.slice(start - 1, end);
}
if (mode === 'private') {
  // the shape yt-dlp's _tab.py _extract_video gives a private / a deleted / a members-only row
  doc.entries[0] = Object.assign({}, doc.entries[0], { title: '[Private video]', duration: null, channel: null, channel_id: null, availability: null });
  doc.entries[1] = Object.assign({}, doc.entries[1], { title: '[Deleted video]', duration: null, channel: null, availability: null });
  doc.entries[2] = Object.assign({}, doc.entries[2], { availability: 'subscriber_only' });
  doc.entries[3] = Object.assign({}, doc.entries[3], { id: 'bad id;rm', title: 'hostile' });
}
const archive = valueOf('--download-archive');
if (archive && fs.existsSync(archive)) {
  const done = new Set(fs.readFileSync(archive, 'utf8').split('\n').map((l) => l.trim().split(' ')[1]).filter(Boolean));
  doc.entries = doc.entries.filter((e) => !done.has(e.id));
}
process.stdout.write(JSON.stringify(doc) + '\n');
process.exit(0);
`;
fs.writeFileSync(path.join(binDir, 'yt-dlp'), `#!${process.execPath}\n${FAKE}`, { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const args = require('../../lib/ytdlp/args');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');

const EXAMPLE = JSON.parse(fs.readFileSync(path.join(FIX, 'example-list-PLUtyNbQXMTLg.json'), 'utf8'));
const LIST = 'PLUtyNbQXMTLg';
const DEAN = `https://www.youtube.com/watch?v=U3P8pUboZ5g&list=${LIST}`;

let tmpDir; let dataDir; let logPath;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-playlist-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-playlist-data-'));
  logPath = path.join(dataDir, 'spawns.log');
  process.env.FAKE_PL_LOG = logPath;
  process.env.FAKE_PL_FIX = FIX;
  delete process.env.FAKE_PL_MODE; delete process.env.FAKE_PL_WAIT_MS;
});
afterEach(() => {
  ytdlp.resetPollRerunStateForTests();
  for (const k of ['FAKE_PL_LOG', 'FAKE_PL_FIX', 'FAKE_PL_MODE', 'FAKE_PL_WAIT_MS']) delete process.env[k];
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});
after(() => { fs.rmSync(binDir, { recursive: true, force: true }); });

// metadata: { mediaId: item } - the scan's youtubeId; `hidden: true` = in a folder this member cannot see
function makeDeps(metadata, o = {}) {
  const db = { metadata: metadata || {} };
  return {
    dataDir,
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (fn) => Promise.resolve(fn(db)),
    scanDirectories: async () => {},
    getMediaId: (s) => s,
    mediaVisiblePredicate: o.noVisibility ? undefined : () => (item) => item.hidden !== true,
    requireManageSubscriptions: (req, res) => {
      if (req.get('x-test-role') === 'member') { res.status(403).json({ error: 'Forbidden' }); return false; }
      return true;
    },
  };
}
function config() {
  return ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir });
}
async function startApp(deps, cfg) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, cfg || config());
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); },
  };
}
const get = (base, q, headers) => fetch(`${base}/api/ytdlp/playlist?${new URLSearchParams(q)}`, { headers: headers || {} });
const spawns = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('W2: Dean\'s example link lists its 24 entries (the verbatim T0 output), page 1, no more pages', async () => {
  const app = await startApp(makeDeps());
  try {
    const res = await get(app.base, { url: DEAN });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.listId, LIST);
    assert.strictEqual(body.title, 'Kyle Gordon Is Everywhere');
    assert.strictEqual(body.total, 24);
    assert.strictEqual(body.page, 1);
    assert.strictEqual(body.nextPage, null);
    assert.strictEqual(body.entries.length, 24);
    assert.deepStrictEqual(body.entries.map((e) => e.id), EXAMPLE.entries.map((e) => e.id), 'every entry, in the list\'s order');
    const first = body.entries[0];
    assert.deepStrictEqual(Object.keys(first).sort(), ['channel', 'durationSec', 'id', 'inLibrary', 'thumb', 'title', 'unavailable']);
    assert.strictEqual(first.channel, 'kylegordonisgreat', 'v1.371.0: the verbatim row\'s channel, for the album-artist default');
    assert.strictEqual(first.title, EXAMPLE.entries[0].title);
    assert.strictEqual(first.durationSec, Math.round(EXAMPLE.entries[0].duration));
    assert.strictEqual(first.thumb, `https://i.ytimg.com/vi/${first.id}/mqdefault.jpg`, 'the thumb is rebuilt from the checked id, never a URL off stdout');
    assert.ok(body.entries.every((e) => e.unavailable === false && e.inLibrary === false));
    // the argv: one page, flat, no archive, the canonical list URL after --
    const [argv] = spawns();
    assert.deepStrictEqual(argv.slice(0, 7), ['--flat-playlist', '-J', '--playlist-start', '1', '--playlist-end', '200', '--no-warnings']);
    assert.deepStrictEqual(argv.slice(-2), ['--', `https://www.youtube.com/playlist?list=${LIST}`]);
    assert.ok(!argv.includes('--download-archive'), 'the listing shows what is in the list, archived or not');
  } finally { await app.close(); }
});

test('W2: page 2 asks for entries 201-400 and reads the total off playlist_count (T0: 476); an entry with no duration lists with null', async () => {
  process.env.FAKE_PL_MODE = 'uploads';
  const app = await startApp(makeDeps());
  try {
    const res = await get(app.base, { url: 'https://www.youtube.com/playlist?list=UUokXg7-kW6cA_WDe6JPuM9g', page: '2' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.total, 476);
    assert.strictEqual(body.page, 2);
    assert.strictEqual(body.nextPage, 3, '400 < 476: one more page');
    const live = body.entries.find((e) => e.id === 'M6_Jbb5IhQA');
    assert.ok(live && live.durationSec === null && live.unavailable === false, 'a past live stream: no duration, still downloadable');
    const [argv] = spawns();
    assert.deepStrictEqual(argv.slice(2, 6), ['--playlist-start', '201', '--playlist-end', '400']);
  } finally { await app.close(); }
});

test('W2 (R11): inLibrary marks only what THIS member can see; a hidden folder\'s copy reads as not in the library; a trashed one too', async () => {
  const ids = EXAMPLE.entries.map((e) => e.id);
  const app = await startApp(makeDeps({
    a: { youtubeId: ids[0] },
    b: { youtubeId: ids[1], hidden: true },
    c: { youtubeId: ids[2], deletedAt: 1 },
    d: { youtubeId: 'zzzzzzzzzzz' },
  }));
  try {
    const body = await (await get(app.base, { url: DEAN })).json();
    const mark = Object.fromEntries(body.entries.map((e) => [e.id, e.inLibrary]));
    assert.strictEqual(mark[ids[0]], true, 'a visible copy');
    assert.strictEqual(mark[ids[1]], false, 'a copy in a folder this member cannot see is never revealed');
    assert.strictEqual(mark[ids[2]], false, 'a trashed copy');
    assert.strictEqual(body.entries.filter((e) => e.inLibrary).length, 1);
  } finally { await app.close(); }
});

test('W2: an archived video (already downloaded) still lists, marked in the library (the listing never reads the archive)', async () => {
  const ids = EXAMPLE.entries.map((e) => e.id);
  const cfg = config();
  const archive = args.resolveArchivePath(cfg);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(archive, `youtube ${ids[5]}\n`);
  const app = await startApp(makeDeps({ x: { youtubeId: ids[5] } }), cfg);
  try {
    const body = await (await get(app.base, { url: DEAN })).json();
    const e = body.entries.find((r) => r.id === ids[5]);
    assert.ok(e, 'the archived entry is listed');
    assert.strictEqual(e.inLibrary, true);
  } finally { await app.close(); }
});

test('W2: private / deleted / members-only rows are listed as unavailable; a row whose id fails the check is dropped', async () => {
  process.env.FAKE_PL_MODE = 'private';
  const app = await startApp(makeDeps());
  try {
    const body = await (await get(app.base, { url: DEAN })).json();
    assert.strictEqual(body.entries.length, 23, 'the hostile id row is dropped (24 - 1)');
    assert.ok(!body.entries.some((e) => /;/.test(e.id)));
    assert.deepStrictEqual(body.entries.slice(0, 3).map((e) => [e.title, e.unavailable]), [['[Private video]', true], ['[Deleted video]', true], [EXAMPLE.entries[2].title, true]]);
    assert.strictEqual(body.entries[3].unavailable, false);
  } finally { await app.close(); }
});

test('W2 (R14): a list that does not exist is a 404 with a readable reason (verbatim yt-dlp stderr); broken JSON is a 502; a Mix answer is a 400', async () => {
  const app = await startApp(makeDeps());
  try {
    process.env.FAKE_PL_MODE = 'missing';
    let res = await get(app.base, { url: 'https://www.youtube.com/playlist?list=PLzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' });
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(await res.json(), { error: 'This playlist does not exist or is private.', reason: 'not-found' });
    process.env.FAKE_PL_MODE = 'garbage';
    res = await get(app.base, { url: DEAN });
    assert.strictEqual(res.status, 502);
    assert.strictEqual((await res.json()).reason, 'failed');
    process.env.FAKE_PL_MODE = 'mix'; // a list id the classifier accepts, but yt-dlp answers with ONE video
    res = await get(app.base, { url: DEAN });
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).reason, 'not-a-playlist');
  } finally { await app.close(); }
});

test('W2 (R5): a Mix link, Watch Later / Liked, a plain video and junk are refused BEFORE any spawn', async () => {
  const app = await startApp(makeDeps());
  try {
    const cases = [
      ['https://www.youtube.com/watch?v=U3P8pUboZ5g&list=RDU3P8pUboZ5g', 'mix'],
      ['https://www.youtube.com/playlist?list=WL', 'personal'],
      ['https://www.youtube.com/watch?v=U3P8pUboZ5g', 'not-a-playlist'],
      ['https://example.com/playlist?list=' + LIST, 'not-a-playlist'],
      ['', 'not-a-playlist'],
    ];
    for (const [u, reason] of cases) {
      const res = await get(app.base, { url: u });
      assert.strictEqual(res.status, 400, u);
      assert.strictEqual((await res.json()).reason, reason, u);
    }
    for (const page of ['0', '-1', '1.5', 'abc', String(args.PLAYLIST_MAX_PAGE + 1)]) {
      assert.strictEqual((await get(app.base, { url: DEAN, page })).status, 400, 'page ' + page);
    }
    assert.strictEqual(spawns().length, 0, 'no yt-dlp run for a refused link or page');
  } finally { await app.close(); }
});

test('W2 (R10): a member without Manage subscriptions gets 403 and no spawn', async () => {
  const app = await startApp(makeDeps());
  try {
    const res = await get(app.base, { url: DEAN }, { 'x-test-role': 'member' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(spawns().length, 0);
  } finally { await app.close(); }
});

test('W2: a double tap on the same page shares ONE yt-dlp run; the next request after it settles runs again', async () => {
  process.env.FAKE_PL_WAIT_MS = '400';
  const app = await startApp(makeDeps());
  try {
    const [a, b] = await Promise.all([get(app.base, { url: DEAN }), get(app.base, { url: `https://www.youtube.com/playlist?list=${LIST}` })]);
    assert.strictEqual(a.status, 200); assert.strictEqual(b.status, 200);
    assert.deepStrictEqual((await a.json()).entries.length, (await b.json()).entries.length);
    assert.strictEqual(spawns().length, 1, 'one run for two requests of the same list page');
    await get(app.base, { url: DEAN });
    assert.strictEqual(spawns().length, 2, 'the in-flight entry is cleared once it settles');
  } finally { await app.close(); }
});

test('W2 unit: buildYtdlpPlaylistPreviewArgs refuses a bad id or page; the cookies (when usable) ride before --', () => {
  assert.throws(() => args.buildYtdlpPlaylistPreviewArgs('PL;rm', 1, {}), /Invalid playlist id/);
  assert.throws(() => args.buildYtdlpPlaylistPreviewArgs(LIST, 0, {}), /Invalid playlist page/);
  assert.throws(() => args.buildYtdlpPlaylistPreviewArgs(LIST, args.PLAYLIST_MAX_PAGE + 1, {}), /Invalid playlist page/);
  const a = args.buildYtdlpPlaylistPreviewArgs(LIST, 3, {});
  assert.deepStrictEqual(a, ['--flat-playlist', '-J', '--playlist-start', '401', '--playlist-end', '600', '--no-warnings', '--', `https://www.youtube.com/playlist?list=${LIST}`]);
  const cookies = path.join(tmpDir, 'cookies.txt');
  fs.writeFileSync(cookies, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n');
  const withC = args.buildYtdlpPlaylistPreviewArgs(LIST, 1, { cookiesFile: cookies });
  const dd = withC.indexOf('--');
  assert.ok(withC.indexOf('--cookies') !== -1 && withC.indexOf('--cookies') < dd, 'the cookies before --: ' + withC.join(' '));
  assert.strictEqual(withC[dd + 1], `https://www.youtube.com/playlist?list=${LIST}`);
  assert.strictEqual(withC.length, dd + 2, 'the list URL is the last argument');
});


test('gate r1: a list of EXACTLY 200 (one full page) has no next page; members-only / premium / needs-auth rows are unavailable', () => {
  const { playlistEntryFrom } = require('../../lib/ytdlp/run');
  for (const a of ['subscriber_only', 'premium_only', 'needs_auth', 'private']) {
    assert.strictEqual(playlistEntryFrom({ id: 'abcdefghijk', title: 'x', availability: a }).unavailable, true, a);
  }
  assert.strictEqual(playlistEntryFrom({ id: 'abcdefghijk', title: 'x', availability: 'unlisted' }).unavailable, false, 'unlisted downloads');
});

test('gate r1: exactly 200 entries with playlist_count 200 -> nextPage null (no Load more that loads nothing)', async () => {
  process.env.FAKE_PL_MODE = 'exact200';
  const app = await startApp(makeDeps());
  try {
    const body = await (await get(app.base, { url: DEAN })).json();
    assert.strictEqual(body.total, 200, JSON.stringify(body).slice(0, 300));
    assert.strictEqual(body.nextPage, null);
  } finally { await app.close(); }
});
