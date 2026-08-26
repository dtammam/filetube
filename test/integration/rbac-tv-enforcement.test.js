'use strict';

// [INTEGRATION] v1.195 TV Shows serve behaviour + RBAC enforcement. A member
// restricted on a path prefix is 404'd on every episode-serve/detail route and
// omitted from the shows grid + poster; the allowed show and the admin are
// unaffected. Every route routes its decision through the SINGLE
// tvEpisodeVisibleTo/isBlocked point. Also (gate additions): the live browse
// responses flow through the real client builders (v1.184 anti-inert
// reachability), and a codec-incompatible episode in a browser-native container
// transcodes rather than serving raw. Isolated DATA_DIR; own process; cleans up.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-tv-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, userStore, __mintTestSession } = require('../../server');
const tvStore = require('../../lib/tv/store');
const tvView = require('../../public/js/tv.js');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member;
const adultShow = path.join(DATA_DIR, 'adult', 'Adult Show');
const kidsShow = path.join(DATA_DIR, 'kids', 'Kids Show');
const blockedFile = path.join(adultShow, 'Season 1', 'Adult Show S01E01 - Pilot.mp4');
const allowedFile = path.join(kidsShow, 'Season 1', 'Kids Show S01E01 - Hello.mp4');
const hevcFile = path.join(kidsShow, 'Season 1', 'Kids Show S01E02 - Codec.mp4');

before(async () => {
  fs.mkdirSync(path.join(adultShow, 'Season 1'), { recursive: true });
  fs.mkdirSync(path.join(kidsShow, 'Season 1'), { recursive: true });
  fs.writeFileSync(blockedFile, 'BLOCKED');
  fs.writeFileSync(allowedFile, 'ALLOWED');
  fs.writeFileSync(hevcFile, 'HEVCBYTES');
  fs.writeFileSync(path.join(adultShow, 'poster.jpg'), 'ADULTPOSTER');
  fs.writeFileSync(path.join(kidsShow, 'poster.jpg'), 'KIDSPOSTER');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    const ns = tvStore.ensureTv(db);
    ns.folders = [path.join(DATA_DIR, 'adult'), path.join(DATA_DIR, 'kids')];
    ns.episodes = {
      blk: { id: 'blk', filePath: blockedFile, rootFolder: path.join(DATA_DIR, 'adult'), showId: 'sh-blk', showPath: adultShow, showName: 'Adult Show', seasonNum: 1, episodeNum: 1, title: 'Pilot', ext: '.mp4', durationSec: 100, addedAt: 1 },
      ok: { id: 'ok', filePath: allowedFile, rootFolder: path.join(DATA_DIR, 'kids'), showId: 'sh-ok', showPath: kidsShow, showName: 'Kids Show', seasonNum: 1, episodeNum: 1, title: 'Hello', ext: '.mp4', durationSec: 100, addedAt: 2 },
      // An .mp4 (browser-native CONTAINER) that carries an incompatible VIDEO
      // codec - the common TV-rip shape. Under the kids show so it never changes
      // the show-grouping counts the RBAC tests above assert.
      hevc: { id: 'hevc', filePath: hevcFile, rootFolder: path.join(DATA_DIR, 'kids'), showId: 'sh-ok', showPath: kidsShow, showName: 'Kids Show', seasonNum: 1, episodeNum: 2, title: 'Codec', ext: '.mp4', codec: 'hevc', audioCodec: 'aac', durationSec: 100, addedAt: 3 },
    };
    return true;
  });
  member = __mintTestSession({ username: 'kidtv', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: path.join(DATA_DIR, 'adult') }]);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
const asMember = (p, opts) => fetch(`${base}${p}`, { ...opts, headers: { Cookie: member.cookie, ...(opts && opts.headers) } });
const asAdmin = (p, opts) => fetch(`${base}${p}`, opts);

test('TV: restricted member is 404 on the episode serve; admin serves it', async () => {
  assert.strictEqual((await asMember('/tvepisode/blk')).status, 404, 'blocked episode -> 404 (visibility, before file-exists)');
  assert.strictEqual((await asMember('/tvepisode/ok')).status, 200, 'allowed episode streams');
  assert.strictEqual((await asMember('/tvepisode/blk?download=1')).status, 404, 'download is not an escape');
  assert.strictEqual((await asAdmin('/tvepisode/blk')).status, 200, 'admin serves the blocked episode');
});

test('TV: the shows grid + show detail omit the restricted show for a member; admin sees both', async () => {
  const memberShows = ((await (await asMember('/api/tv')).json()).shows || []).map((s) => s.id);
  assert.deepStrictEqual(memberShows, ['sh-ok'], '/api/tv omits the restricted show');
  assert.strictEqual((await asMember('/api/tv/sh-blk')).status, 404, 'show detail 404s (no visible episodes)');
  assert.strictEqual((await asMember('/api/tv/sh-ok')).status, 200);

  const adminShows = ((await (await asAdmin('/api/tv')).json()).shows || []).map((s) => s.id).sort();
  assert.deepStrictEqual(adminShows, ['sh-blk', 'sh-ok'], 'admin sees both shows');
});

test('TV: the poster never leaks the restricted show to a member (placeholder), but serves it to admin', async () => {
  const memberPoster = await asMember('/tvposter/sh-blk');
  assert.match(memberPoster.headers.get('content-type') || '', /image\/svg\+xml/, 'member gets the SVG placeholder, not the real poster');
  const adminPoster = await asAdmin('/tvposter/sh-blk');
  assert.strictEqual(await adminPoster.text(), 'ADULTPOSTER', 'admin gets the real show poster file');
});

test('TV: POST /api/tv/config is admin-only (a member is 403)', async () => {
  const r = await asMember('/api/tv/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folders: [DATA_DIR] }) });
  assert.strictEqual(r.status, 403, 'a member cannot write library config');
});

// v1.184 lesson (anti-inert): drive the REAL /api/tv + /api/tv/:showId responses
// through the REAL client builders, so the browse/episode-list branches are proven
// REACHABLE with the shape the server actually emits - not just that the isolated
// builders work on a hand-authored shape.
test('TV reachability: the live browse responses render through the real client builders', async () => {
  const grid = await (await asAdmin('/api/tv')).json();
  const okShow = (grid.shows || []).find((s) => s.id === 'sh-ok');
  assert.ok(okShow, 'the live grid response carries the show the builder consumes');
  const card = tvView.buildShowCardHtml(okShow);
  assert.match(card, /Kids Show/, 'the grid card renders the show name from the live response');
  assert.match(card, /data-show-id="sh-ok"/, 'the card is clickable back to the live show id');

  const detail = await (await asAdmin('/api/tv/sh-ok')).json();
  const html = tvView.buildShowDetailHtml(detail);
  assert.match(html, /Hello/, 'the show-detail renders an episode title from the live response');
  assert.match(html, /S01E01/, 'the SxxEyy code is reachable from the live episode fields');
  assert.match(html, /data-episode-id="ok"/, 'the episode row is clickable back to the live episode id');
});

// The gate's blocking codec finding, bound BEHAVIOURALLY: a browser-native
// CONTAINER (.mp4) carrying an incompatible codec (hevc) must route to the
// transcode branch (503), not be served raw (200) - reverting the serve route to
// the ext-only needsTranscode() turns this red.
test('TV: a codec-incompatible .mp4 episode transcodes (503), while a compatible one streams (200)', async () => {
  assert.strictEqual((await asAdmin('/tvepisode/hevc')).status, 503, 'hevc-in-mp4 -> transcode branch, never served raw');
  assert.strictEqual((await asAdmin('/tvepisode/ok')).status, 200, 'a codec-clean .mp4 still streams directly');
});

// v1.196 (player integration): the per-episode detail/status endpoint that lets the
// shared player drive an episode. Player-SHAPED + visibility-gated + carries the tv
// source descriptor (so the player never touches /api/videos or /video).
test('TV: GET /api/tv/episode/:id is player-shaped, tv-sourced, and visibility-gated', async () => {
  assert.strictEqual((await asMember('/api/tv/episode/blk')).status, 404, 'restricted episode -> 404 (no detail oracle)');

  const d = await (await asMember('/api/tv/episode/ok')).json();
  assert.strictEqual(d.type, 'video', 'the player treats an episode as a video source');
  assert.strictEqual(d.title, 'Hello');
  assert.strictEqual(d.showId, 'sh-ok');
  assert.strictEqual(d.streamSrc, '/tvepisode/ok', 'streams the tv route, never /video/:id');
  assert.strictEqual(d.statusUrl, '/api/tv/episode/ok', 'polls the tv detail route, never /api/videos/:id');
  assert.strictEqual(d.artUrl, '/tvposter/sh-ok');
  assert.strictEqual(d.needsTranscode, false, 'a codec-clean .mp4 plays direct');
  assert.strictEqual(d.transcodeStatus, 'ready', 'not transcoding -> ready');

  const h = await (await asAdmin('/api/tv/episode/hevc')).json();
  assert.strictEqual(h.needsTranscode, true, 'hevc-in-mp4 -> codec-aware transcode');
  assert.strictEqual(h.transcodeStatus, 'pending', 'no rendition yet -> pending (the player polls until ready)');
});

// v1.196 Phase B: per-user resume + Continue-Watching, visibility-gated. (Runs
// last - it MUTATES the member's progress/watched state for 'ok'.)
const postJson = (auth, p, body) => auth(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('TV Phase B: progress saves + reflects in the detail; continue is visibility-filtered; 90% auto-marks watched', async () => {
  assert.strictEqual((await postJson(asMember, '/api/tv/progress', { id: 'ok', timestamp: 30, duration: 100 })).status, 200);
  const d = await (await asMember('/api/tv/episode/ok')).json();
  assert.strictEqual(d.progress, 30, 'the saved resume position is reflected in the detail');

  let cont = await (await asMember('/api/tv/continue')).json();
  assert.deepStrictEqual((cont.episodes || []).map((e) => e.id), ['ok'], 'the in-progress episode is in Continue');

  // A member cannot write progress for a BLOCKED episode (404, no oracle).
  assert.strictEqual((await postJson(asMember, '/api/tv/progress', { id: 'blk', timestamp: 5, duration: 100 })).status, 404);

  // Crossing 90% auto-marks watched -> the episode leaves Continue.
  await postJson(asMember, '/api/tv/progress', { id: 'ok', timestamp: 95, duration: 100 });
  cont = await (await asMember('/api/tv/continue')).json();
  assert.deepStrictEqual((cont.episodes || []).map((e) => e.id), [], 'a >=90% episode is finished, not "continue"');
  assert.strictEqual((await (await asMember('/api/tv/episode/ok')).json()).watched, true, 'auto-marked watched');

  // Manual un-watch clears the latch.
  assert.strictEqual((await asMember('/api/tv/played', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId: 'ok' }) })).status, 200);
  assert.strictEqual((await (await asMember('/api/tv/episode/ok')).json()).watched, false, 'un-watch cleared the latch');
});
