'use strict';

// [INTEGRATION] v1.79.1 - GET /api/videos?subs=1, the subscription-scoped
// browse behind the "New from your subscriptions" feed row's See-all. Filters
// to items under a subscription folder via the same name-based join
// (folderName OR channelName in db.ytdlp.subscriptions[].name) that GET
// /api/home uses. Isolated DATA_DIR; own process; cleans up (residual #110).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-filter-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, __resetDatabaseForTests } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
beforeEach(async () => { await __resetDatabaseForTests(); });

function item(id, over = {}) {
  return {
    id, title: `Title ${id}`, filePath: `/media/${id}.mp4`, folderName: 'Loose',
    channelName: 'Loose', type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: 5000, ...over,
  };
}
const getVideos = async (qs) => {
  const res = await fetch(`${base}/api/videos${qs ? `?${qs}` : ''}`);
  return { status: res.status, body: await res.json() };
};

test('subs=1: only items under a subscription folder (folderName join)', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      inSub: item('inSub', { folderName: 'ChanX', channelName: 'ChanX' }),
      loose: item('loose', { folderName: 'Loose', channelName: 'Loose' }),
    },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  await updateDatabase((db) => {
    if (!db.ytdlp || typeof db.ytdlp !== 'object') db.ytdlp = { allowMembersOnly: false, subscriptions: [] };
    db.ytdlp.subscriptions = [{ name: 'ChanX', order: 0 }];
    return true;
  });

  const scoped = await getVideos('subs=1');
  assert.strictEqual(scoped.status, 200);
  assert.deepStrictEqual(scoped.body.items.map((i) => i.id), ['inSub'], 'only the subscription-folder item');

  const all = await getVideos('');
  assert.strictEqual(all.body.items.length, 2, 'without subs=1 the whole library shows');
});

test('subs=1: matches on channelName too, and is empty with no subscriptions', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    // folderName sanitized differently from the channel; the channelName still matches.
    metadata: { byChannel: item('byChannel', { folderName: 'chanx_dir', channelName: 'Chan X' }) },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  // No subscriptions yet -> the scoped browse is empty.
  assert.deepStrictEqual((await getVideos('subs=1')).body.items, []);

  await updateDatabase((db) => {
    if (!db.ytdlp || typeof db.ytdlp !== 'object') db.ytdlp = { allowMembersOnly: false, subscriptions: [] };
    db.ytdlp.subscriptions = [{ name: 'Chan X', order: 0 }];
    return true;
  });
  assert.deepStrictEqual((await getVideos('subs=1')).body.items.map((i) => i.id), ['byChannel'], 'channelName join');
});
