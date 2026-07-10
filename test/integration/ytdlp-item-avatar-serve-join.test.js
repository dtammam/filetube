'use strict';

// [INTEGRATION] v1.25 QoL bugfix: `GET /api/videos/:id`'s serve-time,
// read-only fallback avatar join (server.js) -- when an item's OWN
// `channelAvatarUrl` is empty, the route looks up the yt-dlp subscription
// whose `channelUrl`/`channelId` matches the item's own captured identity and
// serves THAT subscription's already-validated avatar
// (`ytdlp.resolveItemChannelAvatarUrl`, lib/ytdlp/store.js). Nothing is ever
// persisted by this join -- it is computed fresh on every request. Boots the
// REAL app (server.js) against an isolated DATA_DIR/db.json, exactly like
// test/integration/ytdlp-delete-stays-gone.test.js, and seeds `db.metadata`/
// `db.ytdlp.subscriptions` directly (no scan needed -- this route's join
// logic doesn't care how an item's channelUrl/channelId got there, e.g. a
// MeTube-imported video the scan never routed through the yt-dlp download
// tree at all).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, getMediaId } = require('../../server');
const store = require('../../lib/ytdlp/store');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_POLL_MINUTES;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function ytdlpDeps() {
  return { updateDatabase, getMediaId };
}

test('GET /api/videos/:id: an item with an EMPTY channelAvatarUrl whose channelUrl matches a subscription serves that subscription\'s avatar', async () => {
  await store.addSubscription(ytdlpDeps(), {
    channelUrl: 'https://www.youtube.com/channel/UCjoinbyurl00000000000',
    name: 'Join By URL Channel',
  });
  await store.recordSubscriptionChannelAvatar(ytdlpDeps(), 'https://www.youtube.com/channel/UCjoinbyurl00000000000', 'https://yt3.ggpht.com/joined-by-url.jpg');

  await updateDatabase((db) => {
    db.metadata.joinByUrlItem = {
      id: 'joinByUrlItem',
      filePath: '/fake/join-by-url.mp4',
      title: 'Join By URL Fixture',
      channelUrl: 'https://www.youtube.com/channel/UCjoinbyurl00000000000',
    };
    return true;
  });

  const res = await fetch(`${base}/api/videos/joinByUrlItem`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.channelAvatarUrl, 'https://yt3.ggpht.com/joined-by-url.jpg');
});

test('GET /api/videos/:id: an item matched by channelId (channelUrl differs) still serves the subscription\'s avatar', async () => {
  await store.addSubscription(ytdlpDeps(), {
    channelUrl: 'https://www.youtube.com/@joinbyidhandle',
    name: 'Join By Id Channel',
  });
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    const sub = ns.subscriptions.find((s) => s.channelUrl === 'https://www.youtube.com/@joinbyidhandle');
    sub.channelId = 'UCjoinbyid000000000000';
    sub.channelAvatarUrl = 'https://yt3.ggpht.com/joined-by-id.jpg';
    return true;
  });

  await updateDatabase((db) => {
    db.metadata.joinByIdItem = {
      id: 'joinByIdItem',
      filePath: '/fake/join-by-id.mp4',
      title: 'Join By Id Fixture',
      // Deliberately a DIFFERENT channelUrl than the subscription's own --
      // only channelId matches (e.g. an item captured via a handle URL while
      // the subscription itself uses the canonical /channel/<id> URL).
      channelUrl: 'https://www.youtube.com/channel/UCsomeotherurl000000000',
      channelId: 'UCjoinbyid000000000000',
    };
    return true;
  });

  const res = await fetch(`${base}/api/videos/joinByIdItem`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.channelAvatarUrl, 'https://yt3.ggpht.com/joined-by-id.jpg');
});

test('GET /api/videos/:id: an item whose channelUrl/channelId matches NO subscription leaves channelAvatarUrl absent (client first-letter fallback)', async () => {
  await updateDatabase((db) => {
    db.metadata.noMatchItem = {
      id: 'noMatchItem',
      filePath: '/fake/no-match.mp4',
      title: 'No Match Fixture',
      channelUrl: 'https://www.youtube.com/channel/UCnosuchsubscription0000',
    };
    return true;
  });

  const res = await fetch(`${base}/api/videos/noMatchItem`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.channelAvatarUrl, undefined);
});

test('GET /api/videos/:id: an item that already carries its OWN channelAvatarUrl is served unchanged, even when a DIFFERENT subscription would otherwise match', async () => {
  await store.addSubscription(ytdlpDeps(), {
    channelUrl: 'https://www.youtube.com/channel/UCownavatar000000000000',
    name: 'Own Avatar Channel',
  });
  await store.recordSubscriptionChannelAvatar(ytdlpDeps(), 'https://www.youtube.com/channel/UCownavatar000000000000', 'https://yt3.ggpht.com/subscription-avatar.jpg');

  await updateDatabase((db) => {
    db.metadata.ownAvatarItem = {
      id: 'ownAvatarItem',
      filePath: '/fake/own-avatar.mp4',
      title: 'Own Avatar Fixture',
      channelUrl: 'https://www.youtube.com/channel/UCownavatar000000000000',
      channelAvatarUrl: 'https://yt3.ggpht.com/its-own-avatar.jpg',
    };
    return true;
  });

  const res = await fetch(`${base}/api/videos/ownAvatarItem`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.channelAvatarUrl, 'https://yt3.ggpht.com/its-own-avatar.jpg', 'the item\'s own captured avatar must stay authoritative, never overwritten by the serve-time join');
});

test('GET /api/videos/:id: an item with no channelUrl/channelId at all (e.g. a plain local file) leaves channelAvatarUrl absent, never throws', async () => {
  await updateDatabase((db) => {
    db.metadata.plainLocalItem = {
      id: 'plainLocalItem',
      filePath: '/fake/plain-local.mp4',
      title: 'Plain Local Fixture',
    };
    return true;
  });

  const res = await fetch(`${base}/api/videos/plainLocalItem`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.channelAvatarUrl, undefined);
});

test('GET /api/videos/:id: with the module DISABLED, the join is skipped entirely (no-op) even for an item whose channelUrl would otherwise match a leftover subscription record', async () => {
  await updateDatabase((db) => {
    db.metadata.disabledJoinItem = {
      id: 'disabledJoinItem',
      filePath: '/fake/disabled-join.mp4',
      title: 'Disabled Join Fixture',
      channelUrl: 'https://www.youtube.com/channel/UCjoinbyurl00000000000', // matches the sub from the first test above
    };
    return true;
  });

  const original = process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_ENABLED;
  try {
    const res = await fetch(`${base}/api/videos/disabledJoinItem`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.channelAvatarUrl, undefined, 'a disabled module must never resolve/serve an avatar via the join');
  } finally {
    process.env.FILETUBE_YTDLP_ENABLED = original;
  }
});
