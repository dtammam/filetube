'use strict';

// [INTEGRATION] v1.195 RBAC - TV Shows enforcement. A member restricted on a path
// prefix is 404'd on every episode-serve/detail route and omitted from the shows
// grid + poster; the allowed show and the admin are unaffected. Every route routes
// its decision through the SINGLE tvEpisodeVisibleTo/isBlocked point. Isolated
// DATA_DIR; own process; cleans up.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-tv-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, userStore, __mintTestSession } = require('../../server');
const tvStore = require('../../lib/tv/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member;
const adultShow = path.join(DATA_DIR, 'adult', 'Adult Show');
const kidsShow = path.join(DATA_DIR, 'kids', 'Kids Show');
const blockedFile = path.join(adultShow, 'Season 1', 'Adult Show S01E01 - Pilot.mp4');
const allowedFile = path.join(kidsShow, 'Season 1', 'Kids Show S01E01 - Hello.mp4');

before(async () => {
  fs.mkdirSync(path.join(adultShow, 'Season 1'), { recursive: true });
  fs.mkdirSync(path.join(kidsShow, 'Season 1'), { recursive: true });
  fs.writeFileSync(blockedFile, 'BLOCKED');
  fs.writeFileSync(allowedFile, 'ALLOWED');
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
