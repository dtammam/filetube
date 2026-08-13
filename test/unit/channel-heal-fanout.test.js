'use strict';

// [UNIT] v1.116 (Dean): recordLocalChannelHealFanout -- server.js's local-heal
// channel->items writer (adopts the canonical identity UNIT from a same-folder
// sibling + re-labels the pin), deps FAKE (in-memory db), no server boot.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-heal-fanout-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { recordLocalChannelHealFanout } = require('../../server');

const UC = 'UC-6oT0FOyAqCGfdNLi4fmXA';
const HANDLE = 'https://www.youtube.com/@nestalgiamusic';
const CANON_URL = 'https://www.youtube.com/channel/' + UC;
const FOLDER = '/music/nestalgiamusic';

function makeDeps(metadata, ytdlp) {
  const db = { metadata, ytdlp: ytdlp || { pins: [] } };
  const returns = [];
  let calls = 0;
  return {
    db, returns, get calls() { return calls; },
    deps: { updateDatabase: (fn) => { calls += 1; returns.push(fn(db)); return Promise.resolve(); } },
  };
}
const target = () => ({
  folderKey: FOLDER,
  identity: { channelId: UC, channelName: 'NESTALGIA', channelUrl: CANON_URL, channelHandleUrl: HANDLE, channelAvatarUrl: 'https://yt3.ggpht.com/a.jpg' },
  urls: new Set([HANDLE, CANON_URL]),
});
const frag = (over) => Object.assign({ type: 'audio', filePath: FOLDER + '/bad.mp3', channelName: '@nestalgiamusic', channelId: null, channelUrl: HANDLE }, over);

test('heal fanout: adopts id+name+url+avatar onto bad siblings, persists on change', async () => {
  const h = makeDeps({
    b1: frag(),
    b2: frag({ filePath: FOLDER + '/b2.mp3', channelName: '' }),
    good: { type: 'audio', filePath: FOLDER + '/g.mp3', channelName: 'NESTALGIA', channelId: UC, channelUrl: CANON_URL, channelHandleUrl: HANDLE },
  });
  const n = await recordLocalChannelHealFanout(h.deps, target());
  assert.equal(n, 2, 'both bad siblings healed');
  assert.equal(h.db.metadata.b1.channelId, UC);
  assert.equal(h.db.metadata.b1.channelName, 'NESTALGIA');
  assert.equal(h.db.metadata.b1.channelUrl, CANON_URL);
  assert.equal(h.db.metadata.b2.channelName, 'NESTALGIA');
  assert.deepEqual(h.returns, [true], 'persisted');
});

test('heal fanout: re-labels the channel pin to the real name', async () => {
  const pins = [{ id: 'p1', channelDir: FOLDER, label: '@nestalgiamusic', pinnedAt: 1 }];
  const h = makeDeps({ b: frag() }, { pins });
  await recordLocalChannelHealFanout(h.deps, target());
  assert.equal(pins[0].label, 'NESTALGIA', 'pin snapshot re-labelled');
});

test('heal fanout: a no-op target (no writes) never persists; a bad/absent target is 0', async () => {
  const h = makeDeps({ good: { type: 'audio', filePath: FOLDER + '/g.mp3', channelName: 'NESTALGIA', channelId: UC } });
  assert.equal(await recordLocalChannelHealFanout(h.deps, target()), 0, 'nothing bad to heal');
  assert.deepEqual(h.returns, [false], 'no save');
  assert.equal(await recordLocalChannelHealFanout(h.deps, { folderKey: FOLDER, identity: {} }), 0, 'no channelId -> 0');
  assert.equal(await recordLocalChannelHealFanout(h.deps, null), 0);
});
