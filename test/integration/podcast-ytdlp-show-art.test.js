'use strict';

// [INTEGRATION] UI pass S6 (F42) - a yt-dlp "file under Podcasts" show's cover is the SHOW's
// artwork (its channel avatar), never a cropped frame of its newest video. The old projection
// set `artUrl: /thumbnail/<first item>`. The chain (server.js ytdlpPodcastShowArtUrl): the
// subscription's own avatar, the channelId registry, the newest episode's baked avatar or its
// channelId in the registry; nothing = null (the client draws the monogram). Every candidate
// passes the store's sanitizer (https only). A serve-time projection: no stored data changes.
// ytdlp module ENABLED (env set before require). Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podart-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
const DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podart-dl-'));
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { app, updateDatabase, getCachedDatabase, ytdlpDb } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;
const SUB = (n) => 'eeeeeeeeeeeeeeeeeeeeeeeeeeee' + String(2000 + n);
const CH_REG = 'UCregistryregistryregist'; // 22 chars after UC
const CH_ITEM = 'UCitemitemitemitemitemit';
const items = {};

function seedItem(chan, fileName, extra) {
  const dir = path.join(DOWNLOAD_DIR, chan);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, 'AUDIO');
  const id = crypto.createHash('md5').update(filePath).digest('hex');
  return Object.assign({ id, filePath, title: fileName.replace(/\.mp3$/, ''), name: fileName, type: 'audio', duration: 100, addedAt: 1000 }, extra || {});
}

// name -> { sub fields, item extra }
const SHOWS = {
  'Own Avatar Pod': { sub: { channelAvatarUrl: 'https://yt3.example.com/own.jpg', channelId: CH_REG } },
  'Registry Pod': { sub: { channelId: CH_REG } },
  'Baked Item Pod': { item: { channelAvatarUrl: 'https://yt3.example.com/baked.jpg' } },
  'Item Registry Pod': { item: { channelId: CH_ITEM } },
  'No Art Pod': {},
  'Unsafe Avatar Pod': { sub: { channelAvatarUrl: 'http://yt3.example.com/plain-http.jpg' }, item: { channelAvatarUrl: 'javascript:alert(1)' } },
};

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin
  const subs = [];
  Object.keys(SHOWS).forEach((name, i) => {
    const it = seedItem(name, `Episode ${i} [abcdefghi${String(i).padStart(2, '0')}].mp3`, SHOWS[name].item);
    items[name] = it;
    subs.push(Object.assign({ id: SUB(i), channelUrl: `https://youtube.com/@pod${i}`, name, format: 'audio', quality: 'best', paused: false, order: i, libraryPlace: 'podcasts', lastStatus: 'ok' }, SHOWS[name].sub || {}));
  });
  await updateDatabase((db) => {
    ytdlpDb.mutate((h) => {
      h.ytdlp.subscriptions = subs;
      h.ytdlp.channelAvatars = {
        [CH_REG]: { avatarUrl: 'https://yt3.example.com/registry.jpg', channelUrl: '', fetchedAt: 1 },
        [CH_ITEM]: { avatarUrl: 'https://yt3.example.com/item-registry.jpg', channelUrl: '', fetchedAt: 2 },
      };
      return true;
    });
    db.metadata = db.metadata || {};
    for (const it of Object.values(items)) db.metadata[it.id] = it;
    return true;
  });
});
after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const shows = async () => {
  const res = await fetch(`${base}/api/podcasts/shows`);
  assert.strictEqual(res.status, 200);
  const byName = {};
  for (const s of (await res.json()).shows) byName[s.name] = s;
  return byName;
};

test('F42: a yt-dlp show never uses a video frame as its cover', async () => {
  const byName = await shows();
  for (const name of Object.keys(SHOWS)) {
    assert.ok(byName[name], `${name} is listed`);
    assert.strictEqual(byName[name].source, 'ytdlp');
    assert.ok(!String(byName[name].artUrl || '').startsWith('/thumbnail/'), `${name}: no /thumbnail/ frame (got ${byName[name].artUrl})`);
  }
});

test('F42: the art chain - own avatar, then the channelId registry, then the newest episode', async () => {
  const byName = await shows();
  assert.strictEqual(byName['Own Avatar Pod'].artUrl, 'https://yt3.example.com/own.jpg', 'the subscription\'s own avatar wins over its registry entry');
  assert.strictEqual(byName['Registry Pod'].artUrl, 'https://yt3.example.com/registry.jpg', 'no own avatar: the channelId registry');
  assert.strictEqual(byName['Baked Item Pod'].artUrl, 'https://yt3.example.com/baked.jpg', 'nothing on the sub: the newest episode\'s baked avatar');
  assert.strictEqual(byName['Item Registry Pod'].artUrl, 'https://yt3.example.com/item-registry.jpg', 'the newest episode\'s channelId in the registry');
});

test('F42: no artwork anywhere = null (the client draws the monogram); unsafe URLs never pass', async () => {
  const byName = await shows();
  assert.strictEqual(byName['No Art Pod'].artUrl, null, 'no source: null, not a guessed route');
  assert.strictEqual(byName['Unsafe Avatar Pod'].artUrl, null, 'http: and javascript: avatars are refused by the sanitizer');
});

test('F42: the projection writes nothing - subscriptions, the registry and the items are byte-identical after the read', async () => {
  const before = JSON.stringify({ subs: ytdlpDb.readPart('subscriptions'), reg: ytdlpDb.readPart('channelAvatars') });
  const meta = getCachedDatabase().metadata;
  const itemsBefore = JSON.stringify(Object.values(items).map((it) => meta[it.id]));
  await shows();
  await shows();
  assert.strictEqual(JSON.stringify({ subs: ytdlpDb.readPart('subscriptions'), reg: ytdlpDb.readPart('channelAvatars') }), before, 'the ytdlp store is unchanged');
  assert.strictEqual(JSON.stringify(Object.values(items).map((it) => getCachedDatabase().metadata[it.id])), itemsBefore, 'the media items are unchanged');
  for (const it of Object.values(items)) assert.ok(!('artUrl' in getCachedDatabase().metadata[it.id]), 'no artUrl was written onto an item');
});
