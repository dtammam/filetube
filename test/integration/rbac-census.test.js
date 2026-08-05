'use strict';

// [INTEGRATION] v1.80 RBAC T3 - the COMPLETENESS net. Two forcing-functions so
// a restricted account can never reach content and a FUTURE route cannot
// silently leak:
//   1. Serve-route SWEEP: a member blocked from ALL FOUR libraries must get 404
//      on EVERY content-serving route (proving each one consults the visibility
//      gate), while the admin gets non-404 (proving it is not blanket-denial).
//   2. Route-count LOCK: the live route count is pinned. Adding a route changes
//      it and fails this test - forcing the author to confirm a new
//      content-serving route enforces per-user visibility before bumping it.
// Enables ytdlp + podcasts so the full route set (and their serve routes)
// register. Isolated DATA_DIR.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-census-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-census-dl-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, userStore, __mintTestSession } = require('../../server');
const musicStore = require('../../lib/music/store');
const podcastStore = require('../../lib/podcasts/store');
const booksStore = require('../../lib/books/store');
const { authenticateFetch } = require('../helpers/auth');

// The EXPECTED live route count (ytdlp + podcasts enabled). Bump ONLY together
// with confirming any new content-serving route enforces per-user visibility
// (rbac-*-enforcement.test.js) - that confirmation is the whole point of this
// lock. See docs/exec-plans/active/v1.80-rbac.md.
const EXPECTED_ROUTE_COUNT = 184;

let server, base, auth, member;
const vidFile = path.join(DATA_DIR, 'v.mp4');
const trkFile = path.join(DATA_DIR, 't.mp3');
const bookFile = path.join(DATA_DIR, 'b.epub');
const subId = 'c'.repeat(32);
let epId;

before(async () => {
  fs.writeFileSync(vidFile, 'V'); fs.writeFileSync(trkFile, 'T'); fs.writeFileSync(bookFile, 'B');
  const showDir = path.join(DATA_DIR, 'podcasts', 'Show'); fs.mkdirSync(showDir, { recursive: true });
  const epFile = path.join(showDir, 'ep.mp3'); fs.writeFileSync(epFile, 'E');
  epId = podcastStore.episodeIdFor(subId, 'g1');

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vid: { id: 'vid', title: 'V', filePath: vidFile, folderName: 'F', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 1, size: 1, addedAt: 1 } },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  await updateDatabase((db) => {
    musicStore.ensureMusic(db).tracks = { trk: { id: 'trk', title: 'T', artist: 'A', album: 'Al', filePath: trkFile, rootFolder: DATA_DIR, folderName: 'F', ext: '.mp3', codec: 'mp3', durationSec: 1, albumArtKey: null, addedAt: '2026-01-01T00:00:00Z' } };
    const p = podcastStore.ensurePodcasts(db); p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: subId, name: 'Show', feedUrl: 'https://e.com/f.xml' });
    podcastStore.reduceUpsertEpisodes(p, subId, [{ guid: 'g1', title: 'Ep', pubDateMs: 1, durationSec: 1 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(p, epId, { fileName: 'ep.mp3', filePath: path.join(DATA_DIR, 'podcasts', 'Show', 'ep.mp3'), bytes: 1, nowMs: 6000 });
    booksStore.ensureBooks(db).items = { bk: { id: 'bk', title: 'B', author: 'A', filePath: bookFile, folderName: 'F', format: 'epub', addedAt: 1 } };
    return true;
  });
  member = __mintTestSession({ username: 'lockeddown', role: 'member' });
  // Block ALL FOUR libraries - this member may reach NO content anywhere.
  userStore.setRestrictions(member.user.id, [
    { kind: 'library', value: 'video' }, { kind: 'library', value: 'music' },
    { kind: 'library', value: 'podcasts' }, { kind: 'library', value: 'books' },
  ]);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const asMember = (p) => fetch(`${base}${p}`, { headers: { Cookie: member.cookie } });
const asAdmin = (p) => fetch(`${base}${p}`);

test('SWEEP: a member blocked from all libraries gets 404 on EVERY serve route; admin does not', async () => {
  const routes = [
    '/video/vid', '/video/vid?download=1', '/audio/vid', '/thumbnail/vid', '/api/subtitles/vid', '/api/videos/vid',
    '/track/trk', '/track/trk?download=1', '/albumart/trk', '/api/music/trk',
    `/episode/${epId}`, `/podcastart/${subId}`, `/api/podcasts/episodes/${epId}`, `/api/podcasts/shows/${subId}/episodes`,
    '/book/bk/file', '/book/bk/file?download=1', '/bookcover/bk', '/api/books/bk', '/book/bk/tts/0', '/book/bk/tts/0/blocks',
  ];
  for (const r of routes) {
    assert.strictEqual((await asMember(r)).status, 404, `member blocked from all libraries must 404 on ${r}`);
  }
  // admin reaches them (non-404 proves the gate discriminates, not blanket-denies)
  for (const r of ['/video/vid', '/track/trk', `/episode/${epId}`, '/book/bk/file', '/api/videos/vid', '/api/books/bk']) {
    assert.notStrictEqual((await asAdmin(r)).status, 404, `admin must reach ${r}`);
  }
});

test('LOCK: the live route count is pinned (a new route forces an RBAC review)', () => {
  const stack = (app._router && app._router.stack) || [];
  let count = 0;
  for (const layer of stack) {
    if (!layer.route || typeof layer.route.path !== 'string') continue;
    if (layer.route.path === '*' || layer.route.path === '/*') continue;
    for (const m of Object.keys(layer.route.methods)) { if (m !== '_all') count++; }
  }
  assert.strictEqual(count, EXPECTED_ROUTE_COUNT,
    `route count changed (${count} vs ${EXPECTED_ROUTE_COUNT}). If you ADDED a content-serving route, add a `
    + `visibility check + an rbac-*-enforcement assertion, THEN bump EXPECTED_ROUTE_COUNT.`);
});
