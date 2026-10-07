'use strict';

// [INTEGRATION] v1.373.0 (plan docs/exec-plans/active/2026-10-07-v1373-hide-from-feed.md, R2, R3, R5): a playlist job's
// video is QUIET (no download notification) and, with "Hide from feed" ticked, joins its downloader's Hide from feed list
// when the scan indexes it - through the REAL server.js scan (the scan-notification-bridge harness: only what a real
// download writes is seeded - the yt-dlp capture and the job's arrival - everything after is the production path).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-arrivals-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { scanDirectories, updateDatabase, getMediaId, userStore, ytdlpDb } = require('../../server');
const store = require('../../lib/ytdlp/store');
const arrivals = require('../../lib/ytdlp/arrivals');

let downloadDir;
let admin;
before(() => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-arrivals-dl-'));
  admin = userStore.createFirstAdmin({ username: 'dean', displayName: 'Dean', passwordHash: 'h' }, null, '2026-01-01T00:00:00.000Z');
});
after(() => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
function withYtdlpEnv(fn) {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  return fn().finally(() => {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  });
}
// What a real YouTube one-off leaves behind: the file and its capture (downloadMeta), keyed by the video id.
async function downloaded(videoId, title) {
  const filePath = path.join(downloadDir, `${title} [${videoId}].mp3`);
  fs.writeFileSync(filePath, `bytes of ${title}`);
  await updateDatabase(() => ytdlpDb.mutate((db) => {
    store.ensureYtdlp(db).downloadMeta[videoId] = { channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw', channelName: 'Kyle Gordon', capturedAt: Date.now() };
  }));
  return getMediaId(filePath);
}
const notified = (id) => userStore.listNotifications(admin.id).items.some((i) => i.mediaId === id);
const hidden = (id) => userStore.getFeedHidden(admin.id).includes(id);

test('control: a download with NO playlist arrival notifies and is not hidden (as before)', () => withYtdlpEnv(async () => {
  const id = await downloaded('aaaaaaaaaa1', 'Single');
  await scanDirectories();
  assert.ok(notified(id), 'the one-off notifies');
  assert.ok(!hidden(id));
}));

test('a playlist video (arrival, no hide) is QUIET: no notification, not hidden', () => withYtdlpEnv(async () => {
  arrivals.addArrival(process.env.DATA_DIR, { youtubeId: 'aaaaaaaaaa2', userId: null, hide: false, sinceMs: Date.now() - 60000 });
  const id = await downloaded('aaaaaaaaaa2', 'Track Two');
  await scanDirectories();
  assert.ok(!notified(id), 'Dean: "notifications don\'t pop for these. for playlists"');
  assert.ok(!hidden(id));
}));

test('a playlist video with Hide from feed joins ITS DOWNLOADER\'s hidden list, quietly', () => withYtdlpEnv(async () => {
  arrivals.addArrival(process.env.DATA_DIR, { youtubeId: 'aaaaaaaaaa3', userId: admin.id, hide: true, sinceMs: Date.now() - 60000 });
  const id = await downloaded('aaaaaaaaaa3', 'Track Three');
  await scanDirectories();
  assert.ok(hidden(id), 'in the downloader\'s Hide from feed list');
  assert.ok(!notified(id));
}));

test('an item added BEFORE the job started is never hidden (a copy someone already had), and stays quiet', () => withYtdlpEnv(async () => {
  arrivals.addArrival(process.env.DATA_DIR, { youtubeId: 'aaaaaaaaaa4', userId: admin.id, hide: true, sinceMs: Date.now() + 60 * 60 * 1000 });
  const id = await downloaded('aaaaaaaaaa4', 'Older Copy');
  await scanDirectories();
  assert.ok(!hidden(id), 'its addedAt predates the arrival\'s sinceMs');
  assert.ok(!notified(id));
}));
