'use strict';

// [INTEGRATION] v1.80 RBAC T6 - PODCAST enforcement. A member restricted on a
// show (subId) is 404'd on /episode + /podcastart + that show's episode list,
// and its episodes are omitted from the cross-show list; an unrestricted show
// and the admin are unaffected. Podcasts live in lib/podcasts/index.js and route
// through the injected episodeVisibleTo dep. Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-podcast-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, userStore, __mintTestSession } = require('../../server');
const podcastStore = require('../../lib/podcasts/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member;
const blkSub = 'a'.repeat(32);
const okSub = 'b'.repeat(32);
let blkEp, okEp;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });

  const mk = (subId, name, guid) => {
    const dir = path.join(DATA_DIR, 'podcasts', name);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'ep.mp3');
    fs.writeFileSync(file, 'AUDIO');
    return { file, epId: podcastStore.episodeIdFor(subId, guid) };
  };
  const blk = mk(blkSub, 'Explicit Show', 'g1');
  const ok = mk(okSub, 'Kids Show', 'g2');
  blkEp = blk.epId; okEp = ok.epId;

  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    ns.subscriptions = []; ns.episodes = {};
    podcastStore.reduceAddSubscription(ns, { id: blkSub, name: 'Explicit Show', feedUrl: 'https://e.com/a.xml' });
    podcastStore.reduceAddSubscription(ns, { id: okSub, name: 'Kids Show', feedUrl: 'https://e.com/b.xml' });
    podcastStore.reduceUpsertEpisodes(ns, blkSub, [{ guid: 'g1', title: 'Bad Ep', pubDateMs: 2, durationSec: 100 }], 'pending', 5000);
    podcastStore.reduceUpsertEpisodes(ns, okSub, [{ guid: 'g2', title: 'Good Ep', pubDateMs: 1, durationSec: 100 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(ns, blkEp, { fileName: 'ep.mp3', filePath: blk.file, bytes: 5, nowMs: 6000 });
    podcastStore.reduceEpisodeDownloaded(ns, okEp, { fileName: 'ep.mp3', filePath: ok.file, bytes: 5, nowMs: 6000 });
    return true;
  });

  member = __mintTestSession({ username: 'kidpod', role: 'member' });
  userStore.setPodcastProgress(member.user.id, blkEp, { position: 3, duration: 100, updatedAt: '2026-08-05T02:00:00Z' });
  userStore.setPodcastProgress(member.user.id, okEp, { position: 3, duration: 100, updatedAt: '2026-08-05T01:00:00Z' });
  userStore.setRestrictions(member.user.id, [{ kind: 'show', value: blkSub }]); // restrict the Explicit show
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
const asMember = (p) => fetch(`${base}${p}`, { headers: { Cookie: member.cookie } });
const asAdmin = (p) => fetch(`${base}${p}`);

test('PODCAST: restricted member 404 on serve + show; omitted from lists; admin ok', async () => {
  assert.strictEqual((await asMember(`/episode/${blkEp}`)).status, 404, 'restricted episode serve');
  assert.strictEqual((await asMember(`/episode/${okEp}`)).status, 200, 'allowed episode serve');
  assert.strictEqual((await asMember(`/podcastart/${blkSub}`)).status, 404, 'restricted show art');
  assert.strictEqual((await asMember(`/api/podcasts/episodes/${blkEp}`)).status, 404);
  assert.strictEqual((await asMember(`/api/podcasts/shows/${blkSub}/episodes`)).status, 404, 'restricted show hidden');
  assert.strictEqual((await asMember(`/api/podcasts/shows/${okSub}/episodes`)).status, 200);

  const eps = (await (await asMember('/api/podcasts/episodes?filter=recent-listening&limit=50')).json()).episodes.map((e) => e.id);
  assert.deepStrictEqual(eps, [okEp], 'cross-show list omits the restricted episode');
  const shows = (await (await asMember('/api/podcasts/shows')).json()).shows.map((s) => s.id);
  assert.ok(shows.includes(okSub) && !shows.includes(blkSub), 'shows list omits the restricted show');

  // admin unaffected
  assert.strictEqual((await asAdmin(`/episode/${blkEp}`)).status, 200);
  const adminShows = (await (await asAdmin('/api/podcasts/shows')).json()).shows.map((s) => s.id);
  assert.ok(adminShows.includes(blkSub) && adminShows.includes(okSub));
});
