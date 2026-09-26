'use strict';

// [INTEGRATION] v1.338 D8a-D8d (Dean: "non-YouTube things supported by YT DLP should
// have generally first-class experiences"): downloads from another site reach the Stats
// "By channel" table and the duplicate report through the REAL routes (GET /api/stats,
// GET /api/duplicates) - persisted through the real media store, not a hand-built
// array handed to lib/stats.js. The RBAC axis rides along (LESSONS 10: an aggregation
// surface leaks names and counts): a member restricted on one uploader's folder never
// sees that uploader's row or duplicate group; the admin sees both. The last test binds
// the detail route's shape the watch page's Pin (D8a) and delete confirm (D8d) read.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-stats-any-site-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member;

// The universal capture's persisted shape: sourceExtractor + sourceId + channelName, no
// channelUrl / channelId / youtubeId (lib/ytdlp/store.js consumeUniversalDownloadMeta).
function mediaItem(id, filePath, folderName, extra) {
  return {
    id, title: id, name: path.basename(filePath), filePath, folderName, rootFolder: '/dl',
    type: 'video', ext: '.mp4', duration: 10, size: 100, addedAt: 1, ...extra,
  };
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin
  seedState({
    folders: ['/dl'], folderSettings: {},
    metadata: {
      r1: mediaItem('r1', '/dl/alice/First [Reddit=abc123].mp4', 'alice', { sourceExtractor: 'Reddit', sourceId: 'abc123', channelName: 'alice' }),
      r2: mediaItem('r2', '/dl/alice/Retitled [Reddit=abc123].mp4', 'alice', { sourceExtractor: 'Reddit', sourceId: 'abc123', channelName: 'alice', size: 40 }),
      s1: mediaItem('s1', '/dl/secret/Hidden one [Reddit=zzz].mp4', 'secret', { sourceExtractor: 'Reddit', sourceId: 'zzz', channelName: 'secretuser' }),
      s2: mediaItem('s2', '/dl/secret/Hidden two [Reddit=zzz].mp4', 'secret', { sourceExtractor: 'Reddit', sourceId: 'zzz', channelName: 'secretuser' }),
      y1: mediaItem('y1', '/dl/chan/A YouTube one [AAAAAAAAAAA].mp4', 'chan', { channelUrl: 'https://www.youtube.com/@chan', youtubeId: 'AAAAAAAAAAA' }),
    },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  member = __mintTestSession({ username: 'restricted', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'folder', value: 'secret' }]);
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const asMember = (p) => fetch(`${base}${p}`, { headers: { Cookie: member.cookie } });

test('GET /api/stats: By channel carries a row per site + uploader beside the unchanged YouTube row', async () => {
  const res = await fetch(`${base}/api/stats`);
  assert.equal(res.status, 200);
  const { byChannel } = await res.json();
  assert.deepEqual(byChannel, [
    { sourceExtractor: 'Reddit', channelName: 'alice', count: 2, totalDurationSeconds: 20, totalSizeBytes: 140 },
    { sourceExtractor: 'Reddit', channelName: 'secretuser', count: 2, totalDurationSeconds: 20, totalSizeBytes: 200 },
    { channelUrl: 'https://www.youtube.com/@chan', count: 1, totalDurationSeconds: 10, totalSizeBytes: 100 },
  ]);
});

test('GET /api/duplicates: two copies of one Reddit post group by (site, id)', async () => {
  const report = await (await fetch(`${base}/api/duplicates`)).json();
  const byKey = Object.fromEntries(report.idGroups.map((g) => [g.key, g.items.map((i) => i.id).sort()]));
  assert.deepEqual(byKey, { 'Reddit:abc123': ['r1', 'r2'], 'Reddit:zzz': ['s1', 's2'] });
});

test('RBAC: a member restricted on the uploader\'s folder sees neither its By channel row nor its duplicate group', async () => {
  const stats = await (await asMember('/api/stats')).json();
  assert.ok(stats.byChannel.some((r) => r.channelName === 'alice'), 'precondition: the visible uploader is listed for the member');
  assert.ok(!stats.byChannel.some((r) => r.channelName === 'secretuser'), 'the restricted uploader never reaches the member');
  const report = await (await asMember('/api/duplicates')).json();
  assert.deepEqual(report.idGroups.map((g) => g.key), ['Reddit:abc123'], 'the restricted pair never reaches the member');
});

// D8a (the watch page's Pin) and D8d (the delete confirm) read `sourceExtractor` off the
// item the watch page loads: bind that the real detail route serves it, with no YouTube
// channel identity beside it (the exact shape the watch-init-behavioral tests drive).
test('REACHABILITY (D8a/D8d): GET /api/videos/:id serves sourceExtractor with no YouTube channel identity', async () => {
  const body = await (await fetch(`${base}/api/videos/r1`)).json();
  assert.strictEqual(body.sourceExtractor, 'Reddit');
  assert.strictEqual(body.channelName, 'alice');
  assert.strictEqual(body.filePath, '/dl/alice/First [Reddit=abc123].mp4', 'the Pin folder derives from this');
  for (const k of ['channelUrl', 'channelId', 'youtubeId']) assert.ok(!body[k], `no ${k}`);
});
