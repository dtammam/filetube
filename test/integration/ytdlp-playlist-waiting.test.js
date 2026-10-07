'use strict';

// [INTEGRATION] v1.369.0 W4 (plan docs/exec-plans/active/2026-10-06-v1369-playlist-picker.md, R5, R9, R13):
// the iPhone Shortcut (the API token caller) posting a playlist link to POST /api/ytdlp/download never
// downloads: the playlist WAITS (persisted, listed on the status poll to callers allowed to download,
// dismissible, 7 days, at most 20) and one push goes out. A session caller's one video, a Mix and Watch Later
// are unchanged. Also the listing route's `peek=1` (what a link IS, no spawn).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const run = require('../../lib/ytdlp/run');
const waiting = require('../../lib/ytdlp/waiting');
const pending = require('../../lib/ytdlp/pending');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');

const orig = { runDownload: run.runDownload, probeChannel: run.probeChannel, listPlaylistPage: run.listPlaylistPage };
const V = 'U3P8pUboZ5g';
const L = 'PLUtyNbQXMTLg';

let tmpDir; let dataDir; let downloads; let notified; let spawnedListings;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-plwait-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-plwait-data-'));
  downloads = []; notified = []; spawnedListings = 0;
  run.probeChannel = async () => null;
  run.runDownload = async (sub, cfg, ids) => { downloads.push(ids[0]); return { ok: true, code: 0, stdout: '', stderr: '' }; };
  run.listPlaylistPage = async () => { spawnedListings += 1; return { ok: false, reason: 'failed', error: 'x' }; };
});
afterEach(() => {
  Object.assign(run, orig);
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeDeps() {
  const db = {};
  const role = (req) => req.get('x-test-role') || 'admin';
  return {
    dataDir,
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (fn) => Promise.resolve(fn(db)),
    scanDirectories: async () => {},
    getMediaId: (s) => s,
    requireManageSubscriptions: (req, res) => { if (role(req) === 'member') { res.status(403).json({ error: 'Forbidden' }); return false; } return true; },
    canManageSubscriptions: (req) => role(req) !== 'member',
    notifyWaitingPlaylist: (entry) => notified.push(entry),
  };
}
function config(extra) {
  return ytdlp.parseYtdlpConfig(Object.assign({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir }, extra || {}));
}
async function startApp(deps, cfg) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.get('x-test-token') === '1') req.auditActor = 'api-token'; next(); });
  ytdlp.registerRoutes(app, deps, cfg || config());
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } };
}
const post = (base, p, body, headers) => fetch(base + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
const TOKEN = { 'x-test-token': '1' };
const status = async (base, headers) => (await fetch(base + '/api/subscriptions/status', { headers: headers || {} })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('W4 (R9): the Shortcut posting Dean\'s link (a video in a list) WAITS - no download, the reply says so, one push, listed on the poll', async () => {
  const app = await startApp(makeDeps());
  try {
    const res = await post(app.base, '/api/ytdlp/download', { url: `https://www.youtube.com/watch?v=${V}&list=${L}&si=abc`, format: 'video' }, TOKEN);
    assert.strictEqual(res.status, 202);
    assert.deepStrictEqual(await res.json(), { accepted: false, playlist: true, waiting: true, message: 'Playlist found: open FileTube to choose' });
    await sleep(50);
    assert.deepStrictEqual(downloads, [], 'nothing is downloaded');
    assert.strictEqual(pending.readPending(dataDir).length, 0, 'no job is queued');
    assert.strictEqual(notified.length, 1);
    const s = await status(app.base);
    assert.strictEqual(s.waitingPlaylists.length, 1);
    const w = s.waitingPlaylists[0];
    assert.deepStrictEqual({ kind: w.kind, listId: w.listId, videoId: w.videoId, url: w.url }, { kind: 'watch-in-list', listId: L, videoId: V, url: `https://www.youtube.com/watch?v=${V}&list=${L}` }, 'the URL is REBUILT from the ids (the si= tracker is gone)');
    assert.strictEqual(notified[0].id, w.id);
  } finally { await app.close(); }
});

test('W4 (R9): a list page waits too; the SAME list posted again refreshes its place (one row)', async () => {
  const app = await startApp(makeDeps());
  try {
    for (let i = 0; i < 2; i++) assert.strictEqual((await post(app.base, '/api/ytdlp/download', { url: `https://www.youtube.com/playlist?list=${L}` }, TOKEN)).status, 202);
    const s = await status(app.base);
    assert.strictEqual(s.waitingPlaylists.length, 1);
    assert.strictEqual(s.waitingPlaylists[0].url, `https://www.youtube.com/playlist?list=${L}`);
  } finally { await app.close(); }
});

test('W4 (R5, R9): from the token, a Mix and Watch Later download the ONE video as before; a plain video too', async () => {
  const app = await startApp(makeDeps());
  try {
    for (const u of [`https://www.youtube.com/watch?v=${V}&list=RD${V}&start_radio=1`, `https://www.youtube.com/watch?v=${V}&list=WL`, `https://youtu.be/${V}`]) {
      const res = await post(app.base, '/api/ytdlp/download', { url: u, format: 'video' }, TOKEN);
      assert.strictEqual(res.status, 202, u);
      const body = await res.json();
      assert.strictEqual(body.accepted, true, u);
    }
    assert.strictEqual(waiting.listWaiting(dataDir).length, 0, 'nothing waits');
  } finally { await app.close(); }
});

test('W4 (R9): a SESSION caller posting a video-in-list downloads that one video (the app asked the user first)', async () => {
  const app = await startApp(makeDeps());
  try {
    const res = await post(app.base, '/api/ytdlp/download', { url: `https://www.youtube.com/watch?v=${V}&list=${L}`, format: 'video' });
    assert.strictEqual(res.status, 202);
    assert.strictEqual((await res.json()).accepted, true);
    assert.strictEqual(waiting.listWaiting(dataDir).length, 0);
  } finally { await app.close(); }
});

test('W4 (R13): only a caller allowed to download sees the waiting list; Dismiss removes it (403 for a member and for the token)', async () => {
  const app = await startApp(makeDeps());
  try {
    await post(app.base, '/api/ytdlp/download', { url: `https://www.youtube.com/playlist?list=${L}` }, TOKEN);
    assert.deepStrictEqual((await status(app.base, { 'x-test-role': 'member' })).waitingPlaylists, [], 'a member sees none');
    const [w] = (await status(app.base)).waitingPlaylists;
    assert.strictEqual((await post(app.base, `/api/ytdlp/waiting/${w.id}/dismiss`, {}, { 'x-test-role': 'member' })).status, 403);
    assert.strictEqual((await post(app.base, `/api/ytdlp/waiting/${w.id}/dismiss`, {}, TOKEN)).status, 403);
    assert.strictEqual((await post(app.base, `/api/ytdlp/waiting/${w.id}/dismiss`, {})).status, 200);
    assert.deepStrictEqual((await status(app.base)).waitingPlaylists, []);
    assert.strictEqual((await post(app.base, `/api/ytdlp/waiting/${w.id}/dismiss`, {})).status, 404, 'gone');
    assert.strictEqual((await post(app.base, '/api/ytdlp/waiting/..%2F..%2Fetc/dismiss', {})).status, 404, 'a junk id matches nothing');
  } finally { await app.close(); }
});

test('W4 (R13): persisted (a new server reads it back), expires after 7 days, at most 20 (the oldest dropped)', () => {
  const t0 = Date.parse('2026-10-07T00:00:00Z');
  for (let i = 0; i < 25; i++) waiting.addWaiting(dataDir, { kind: 'playlist', listId: 'PL' + String(i).padStart(11, '0'), url: 'u' + i }, t0 + i);
  const live = waiting.listWaiting(dataDir, t0 + 100);
  assert.strictEqual(live.length, 20);
  assert.strictEqual(live[0].listId, 'PL00000000005', 'the 5 oldest dropped');
  assert.ok(fs.existsSync(path.join(dataDir, waiting.WAITING_FILENAME)));
  assert.strictEqual(waiting.listWaiting(dataDir, t0 + waiting.WAITING_TTL_MS + 30).length, 0, 'all expired a week later');
});

test('W4: peek=1 says what a link is without any yt-dlp run; personal lists are listable only with a cookies file', async () => {
  const app = await startApp(makeDeps());
  try {
    const peek = async (u, base = app.base) => (await fetch(`${base}/api/ytdlp/playlist?peek=1&url=${encodeURIComponent(u)}`)).json();
    assert.deepStrictEqual(await peek(`https://www.youtube.com/watch?v=${V}&list=${L}`), { kind: 'watch-in-list', videoId: V, listId: L, listable: true });
    assert.deepStrictEqual(await peek(`https://www.youtube.com/playlist?list=${L}`), { kind: 'playlist', videoId: null, listId: L, listable: true });
    assert.deepStrictEqual(await peek(`https://www.youtube.com/watch?v=${V}&list=RD${V}`), { kind: 'mix', videoId: V, listId: 'RD' + V, listable: false });
    assert.deepStrictEqual(await peek('https://www.youtube.com/playlist?list=WL'), { kind: 'personal', videoId: null, listId: 'WL', listable: false });
    assert.deepStrictEqual(await peek(`https://youtu.be/${V}`), { kind: 'none', videoId: null, listId: null, listable: false });
    assert.strictEqual((await fetch(`${app.base}/api/ytdlp/playlist?peek=1&url=x`, { headers: { 'x-test-role': 'member' } })).status, 403);
    assert.strictEqual(spawnedListings, 0);
  } finally { await app.close(); }
  const cookies = path.join(dataDir, 'cookies.txt');
  fs.writeFileSync(cookies, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n');
  const app2 = await startApp(makeDeps(), config({ FILETUBE_YTDLP_COOKIES_FILE: cookies }));
  try {
    const r = await (await fetch(`${app2.base}/api/ytdlp/playlist?peek=1&url=${encodeURIComponent('https://www.youtube.com/playlist?list=WL')}`)).json();
    assert.strictEqual(r.listable, true, 'with the operator\'s cookies yt-dlp can read Watch Later');
  } finally { await app2.close(); }
});
