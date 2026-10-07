'use strict';

// [INTEGRATION] v1.373.0 (plan docs/exec-plans/completed/2026-10-07-v1373-hide-from-feed.md, R2, R3, R5): a playlist job's
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
async function downloaded(videoId, title, ext = '.mp3', bracket) {
  const filePath = path.join(downloadDir, `${title} [${bracket || videoId}]${ext}`);
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
  arrivals.addArrival(process.env.DATA_DIR, { youtubeId: 'aaaaaaaaaa2', type: 'audio', userId: null, hide: false, sinceMs: Date.now() - 60000 });
  const id = await downloaded('aaaaaaaaaa2', 'Track Two');
  await scanDirectories();
  assert.ok(!notified(id), 'Dean: "notifications don\'t pop for these. for playlists"');
  assert.ok(!hidden(id));
}));

test('a playlist video with Hide from feed joins ITS DOWNLOADER\'s hidden list, quietly', () => withYtdlpEnv(async () => {
  arrivals.addArrival(process.env.DATA_DIR, { youtubeId: 'aaaaaaaaaa3', type: 'audio', userId: admin.id, hide: true, sinceMs: Date.now() - 60000 });
  const id = await downloaded('aaaaaaaaaa3', 'Track Three');
  await scanDirectories();
  assert.ok(hidden(id), 'in the downloader\'s Hide from feed list');
  assert.ok(!notified(id));
}));

test('an item added BEFORE the job started is never hidden (a copy someone already had), and stays quiet', () => withYtdlpEnv(async () => {
  arrivals.addArrival(process.env.DATA_DIR, { youtubeId: 'aaaaaaaaaa4', type: 'audio', userId: admin.id, hide: true, sinceMs: Date.now() + 60 * 60 * 1000 });
  const id = await downloaded('aaaaaaaaaa4', 'Older Copy');
  await scanDirectories();
  assert.ok(!hidden(id), 'its addedAt predates the arrival\'s sinceMs');
  assert.ok(!notified(id));
}));

// ---- gate r1 (adversary W1 / qa W1 / security LOW): an arrival is ONE download's, used once ----
const live = () => arrivals.listArrivals(process.env.DATA_DIR);
test('gate r1: the SAME video downloaded later in the OTHER format notifies and stays visible (the adversary\'s repro)', () => withYtdlpEnv(async () => {
  arrivals.addArrival(process.env.DATA_DIR, { youtubeId: 'bbbbbbbbbb1', type: 'audio', userId: admin.id, hide: true, sinceMs: Date.now() - 60000 });
  const song = await downloaded('bbbbbbbbbb1', 'Song');
  await scanDirectories();
  assert.ok(hidden(song) && !notified(song), 'the playlist\'s audio: hidden and quiet');
  const mv = await downloaded('bbbbbbbbbb1', 'Song MV', '.mp4');
  await scanDirectories();
  assert.ok(notified(mv), 'a one-off video of the same id notifies');
  assert.ok(!hidden(mv), 'and is not hidden');
}));

test('gate r1: an arrival is USED UP by the scan that matched it - a re-download of the same file type notifies', () => withYtdlpEnv(async () => {
  arrivals.addArrival(process.env.DATA_DIR, { youtubeId: 'bbbbbbbbbb3', type: 'audio', userId: null, hide: false, sinceMs: Date.now() - 60000 });
  const first = await downloaded('bbbbbbbbbb3', 'Once');
  await scanDirectories();
  assert.ok(!notified(first));
  assert.strictEqual(arrivals.findArrival(live(), 'bbbbbbbbbb3', 'audio'), null, 'spent after the commit');
  const again = await downloaded('bbbbbbbbbb3', 'Once Again');
  await scanDirectories();
  assert.ok(notified(again), 'a later download of the same id notifies as usual');
}));

test('gate r1 (adversary S1): the D1a site - a file named with the [Youtube=id] bracket - honours its arrival too', () => withYtdlpEnv(async () => {
  arrivals.addArrival(process.env.DATA_DIR, { youtubeId: 'bbbbbbbbbb2', type: 'audio', userId: admin.id, hide: true, sinceMs: Date.now() - 60000 });
  const id = await downloaded('bbbbbbbbbb2', 'Proxy Song', '.mp3', 'Youtube=bbbbbbbbbb2');
  await scanDirectories();
  assert.ok(!notified(id), 'quiet');
  assert.ok(hidden(id), 'hidden');
}));

test('gate r1: a VIDEO playlist download matches by its type too (an .mp4 with a video arrival is quiet; an .mp3 of the same id is not)', () => withYtdlpEnv(async () => {
  arrivals.addArrival(process.env.DATA_DIR, { youtubeId: 'bbbbbbbbbb4', type: 'video', userId: null, hide: false, sinceMs: Date.now() - 60000 });
  const mp3 = await downloaded('bbbbbbbbbb4', 'Audio Copy');
  await scanDirectories();
  assert.ok(notified(mp3), 'an audio file of the id is not the video download');
  const mp4 = await downloaded('bbbbbbbbbb4', 'Video', '.mp4');
  await scanDirectories();
  assert.ok(!notified(mp4), 'the video download itself is quiet');
}));
