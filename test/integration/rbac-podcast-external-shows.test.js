'use strict';

// [INTEGRATION] v1.128 Wave B (S2d) - census L10/L11. The Podcasts place
// surfaces yt-dlp "file-under-Podcasts" shows whose episodes are channel-dir
// db.metadata MEDIA items. GET /api/podcasts/shows appended external shows
// UNFILTERED, and the external /shows/:id/episodes branch listed ALL items -
// both leaked hidden show names / episode titles to a restricted member. The
// fix threads the requester's media visibility. ytdlp module ENABLED (env set
// before require). Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-podext-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
const DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-podext-dl-'));
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { app, updateDatabase, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, kid;
const OPEN_SUB = 'ffffffffffffffffffffffffffff1001';
const HID_SUB = 'ffffffffffffffffffffffffffff1002';
const OPEN_CHAN = 'Open Pod';
const HID_CHAN = 'Secret Pod';
let hiddenDir;

function seedItem(chan, fileName) {
  const dir = path.join(DOWNLOAD_DIR, chan);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, 'AUDIO');
  const id = crypto.createHash('md5').update(filePath).digest('hex');
  return { id, filePath, title: fileName.replace(/\.mp3$/, ''), name: fileName, type: 'audio', duration: 100 };
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin
  hiddenDir = path.join(DOWNLOAD_DIR, HID_CHAN);

  const openEp = seedItem(OPEN_CHAN, 'Open Episode [abcdefghij1].mp3');
  const hidEp = seedItem(HID_CHAN, 'SECRET Episode [abcdefghij2].mp3');
  await updateDatabase((db) => {
    db.ytdlp = db.ytdlp || {};
    db.ytdlp.subscriptions = [
      { id: OPEN_SUB, channelUrl: 'https://youtube.com/@openpod', name: OPEN_CHAN, format: 'audio', quality: 'best', paused: false, order: 1, libraryPlace: 'podcasts', lastStatus: 'ok' },
      { id: HID_SUB, channelUrl: 'https://youtube.com/@secretpod', name: HID_CHAN, format: 'audio', quality: 'best', paused: false, order: 2, libraryPlace: 'podcasts', lastStatus: 'ok' },
    ];
    db.metadata = db.metadata || {};
    db.metadata[openEp.id] = openEp;
    db.metadata[hidEp.id] = hidEp;
    return true;
  });

  kid = __mintTestSession({ username: 'kidpodext', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'path', value: hiddenDir }]);
});
after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const getJson = (p, cookie) => fetch(`${base}${p}`, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.json());

test('L10 /api/podcasts/shows: restricted member sees no hidden external show', async () => {
  const admin = (await getJson('/api/podcasts/shows', undefined)).shows;
  const adminNames = admin.map((s) => s.name);
  assert.ok(adminNames.includes(OPEN_CHAN) && adminNames.includes(HID_CHAN), 'admin sees both external shows');

  const k = (await getJson('/api/podcasts/shows', kid.cookie)).shows;
  const kidNames = k.map((s) => s.name);
  assert.ok(kidNames.includes(OPEN_CHAN), 'restricted member keeps the visible show');
  assert.ok(!kidNames.includes(HID_CHAN), 'restricted member does NOT see the hidden show');
  assert.ok(!JSON.stringify(k).includes('Secret Pod'), 'no hidden show name anywhere');
});

test('L11 /api/podcasts/shows/:id/episodes: restricted member cannot list the hidden show episodes', async () => {
  // Admin can list the hidden show's episodes (proves the machinery works).
  const adminEps = await getJson(`/api/podcasts/shows/yt:${HID_SUB}/episodes`, undefined);
  assert.ok(adminEps.episodes && adminEps.episodes.some((e) => e.title.includes('SECRET')), 'admin lists the hidden episode');

  // Restricted member: the hidden show has zero visible items -> 404 (the show
  // is filtered out of listExternalShows, so :id resolution fails).
  const kidRes = await fetch(`${base}/api/podcasts/shows/yt:${HID_SUB}/episodes`, { headers: { Cookie: kid.cookie } });
  assert.strictEqual(kidRes.status, 404, 'restricted member 404s on the hidden external show episodes');

  // The visible show still lists for the restricted member.
  const kidOpen = await getJson(`/api/podcasts/shows/yt:${OPEN_SUB}/episodes`, kid.cookie);
  assert.ok(kidOpen.episodes && kidOpen.episodes.length === 1, 'restricted member still lists the visible show');
  assert.ok(!JSON.stringify(kidOpen).includes('SECRET'), 'no hidden episode leaks into the visible show');
});
