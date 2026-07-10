'use strict';

// [INTEGRATION] v1.24.0 C5-ytdlp (T11 completion, Wave 3 gap-fix): proves
// the FULL, REAL chain -- yt-dlp `--print` line -> `run.parseChannelMetaLine`
// -> `store.sanitizeCapturedChannelMeta`/`recordDownloadChannelMeta` ->
// (scan) `store.consumeDownloadChannelMeta` -> server.js's REAL Phase-2 scan
// mutator -> `db.metadata[id].releaseDate` -- actually produces a populated
// field. UNLIKE the earlier T11 integration test
// (test/integration/ytdlp-channel-avatar-release-capture.test.js), NOTHING
// here is mocked: `run.parseChannelMetaLine` is called against a real
// FTCHMETA JSON payload (the exact shape `args.CHANNEL_META_PRINT_TEMPLATE`
// produces), and `scanDirectories()` is the real server.js scan, not a
// re-implementation.
//
// v1.25 QoL bugfix: the original C6 half of this file's name/history --
// `channel_thumbnail` per-video capture -- was REMOVED. Verified against a
// live yt-dlp (2026.07.04) `--dump-json` for an actual video: that field
// simply does not exist on a per-video info dict, so it was always a dead
// no-op (rendered JSON `null` every time) and `channelAvatarUrl` was NEVER
// actually captured through this per-video print line, for any video, ever.
// The tests below now regression-lock that this path stays dead (even a
// rogue/legacy `channel_thumbnail` key on the raw line is ignored) and prove
// releaseDate alone still flows end-to-end. A REAL channel avatar now comes
// from `run.probeChannelAvatar` (the channel endpoint) -- see
// test/integration/ytdlp-spawn-security.test.js for its own tests, and
// Path 2 below for how a subscription's own captured avatar (however it got
// there) still heals onto an identity-less item at scan time.
//
// Also covers Path 2 (the retroactive, folder-based backfill) picking up a
// matched subscription's OWN `channelAvatarUrl` onto an identity-less item.
//
// Isolated DATA_DIR before requiring the app, per the established pattern
// (test/integration/ytdlp-channel-meta-bridge.test.js).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, loadDatabase, updateDatabase, getMediaId } = require('../../server');
const store = require('../../lib/ytdlp/store');
const run = require('../../lib/ytdlp/run');
const args = require('../../lib/ytdlp/args');

let server;
let downloadDir;

before(async () => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-release-avatar-e2e-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

function ytdlpDeps() {
  return { updateDatabase, getMediaId };
}

test('a REAL FTCHMETA line, parsed by the REAL parseChannelMetaLine, flows all the way to db.metadata[id].releaseDate via the real scan bridge (Path 1) -- no channel_thumbnail key at all, matching a real yt-dlp payload', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    // The exact FTCHMETA line shape args.CHANNEL_META_PRINT_TEMPLATE's
    // `--print` selector produces, straight off yt-dlp's own stdout -- no
    // `channel_thumbnail` key, since that field was verified to never exist
    // on a real per-video info dict and the template no longer selects it.
    const line = `FTCHMETA ${JSON.stringify({
      id: 'e2eVideoId1',
      channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
      uploader_url: 'https://www.youtube.com/@RealChannel',
      channel: 'Real Channel',
      upload_date: '20230101',
      release_date: '20230615',
    })}`;

    // Step 1: the REAL parser (not a hand-built object).
    const rawMeta = run.parseChannelMetaLine(line);
    assert.ok(rawMeta, 'sanity: the FTCHMETA line must parse');
    assert.equal(rawMeta.releaseDate, '20230615');
    assert.equal(Object.prototype.hasOwnProperty.call(rawMeta, 'channelThumbnail'), false, 'channelThumbnail must not exist on the parsed object at all -- the dead field is fully removed');

    // Step 2: the REAL sanitize+persist path (what index.js's
    // persistCapturedChannelMeta calls per captured entry).
    const recorded = await store.recordDownloadChannelMeta(ytdlpDeps(), rawMeta);
    assert.equal(recorded, true, 'sanity: a well-formed capture must be recorded');

    // Step 3: an actual file on disk, under the module's own download root,
    // whose filename embeds the SAME video id (the scan's own join key).
    const filePath = path.join(downloadDir, 'Real Upload [e2eVideoId1].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    // Step 4: the REAL server.js scan (consumeDownloadChannelMeta + the
    // Path-1 bridge this task added).
    await scanDirectories();

    const id = getMediaId(filePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.ok(item, 'sanity: the file must be indexed');
    assert.equal(item.releaseDate, Date.UTC(2023, 5, 15), 'C5-ytdlp: the captured release_date must land on db.metadata[id].releaseDate as epoch ms');
    assert.equal(item.channelAvatarUrl, undefined, 'v1.25 QoL bugfix: the per-video path never populates channelAvatarUrl -- a real avatar comes from probeChannelAvatar/the subscription-level bridge instead');

    // Consumed -- the map entry must no longer exist after the scan indexed it.
    const ns = store.ensureYtdlp(loadDatabase());
    assert.equal(ns.downloadMeta.e2eVideoId1, undefined, 'a consumed downloadMeta entry must be deleted (bounded growth)');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('regression lock: even a ROGUE channel_thumbnail key on a raw FTCHMETA line (a legacy/forged payload the real template no longer produces) is ignored by parseChannelMetaLine and never reaches db.metadata[id].channelAvatarUrl, though releaseDate still lands', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const line = `FTCHMETA ${JSON.stringify({
      id: 'e2eVideoId2',
      channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
      uploader_url: 'https://www.youtube.com/@RealChannel',
      channel: 'Real Channel',
      release_date: '20230615',
      channel_thumbnail: 'javascript:alert(document.cookie)',
    })}`;

    const rawMeta = run.parseChannelMetaLine(line);
    assert.equal(Object.prototype.hasOwnProperty.call(rawMeta, 'channelThumbnail'), false, 'a rogue channel_thumbnail key must never be surfaced, hostile or not');
    const recorded = await store.recordDownloadChannelMeta(ytdlpDeps(), rawMeta);
    assert.equal(recorded, true);

    const filePath = path.join(downloadDir, 'Real Upload [e2eVideoId2].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await scanDirectories();

    const id = getMediaId(filePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.ok(item, 'sanity: the file must be indexed');
    assert.equal(item.releaseDate, Date.UTC(2023, 5, 15), 'releaseDate must still land, independent of the dropped avatar field');
    assert.equal(item.channelAvatarUrl, undefined, 'a rogue channel_thumbnail must never reach db.metadata, even through the full real-parser chain');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('C6 Path 2: a matched subscription\'s OWN channelAvatarUrl heals an identity-less OLD item\'s db.metadata[id].channelAvatarUrl on a later scan', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const channelDir = args.resolveChannelDir({ downloadDir }, { name: 'Avatar Healing Channel' });
    fs.mkdirSync(channelDir, { recursive: true });
    const filePath = path.join(channelDir, 'Old Upload [avatarHeal1].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    // First scan: NO subscription configured yet -- indexed with no identity.
    await scanDirectories();
    const id = getMediaId(filePath);
    let db = loadDatabase();
    assert.equal(db.metadata[id].channelUrl, undefined, 'sanity: no subscription exists yet');

    // Now the matching subscription is added AND its avatar is captured
    // (as a later download's print-line capture would do via
    // recordSubscriptionChannelAvatar).
    await store.addSubscription(ytdlpDeps(), {
      channelUrl: 'https://www.youtube.com/@avatarhealingchannel',
      name: 'Avatar Healing Channel',
    });
    await store.recordSubscriptionChannelAvatar(
      ytdlpDeps(),
      'https://www.youtube.com/@avatarhealingchannel',
      'https://yt3.ggpht.com/healed-avatar.jpg',
    );

    // Second scan: the file is unchanged on disk (reusable fast path, not
    // freshlyScannedIds) -- proves the folder-based backfill pass (Path 2)
    // revisits an already-indexed item and heals BOTH identity and avatar.
    await scanDirectories();
    db = loadDatabase();
    const item = db.metadata[id];
    assert.equal(item.channelUrl, 'https://www.youtube.com/@avatarhealingchannel');
    assert.equal(item.channelAvatarUrl, 'https://yt3.ggpht.com/healed-avatar.jpg', 'C6: a matched subscription\'s already-captured avatar must heal onto an identity-less old item too');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    await updateDatabase((db) => { const ns = store.ensureYtdlp(db); ns.subscriptions = []; return true; });
  }
});

test('C6 Path 2: a hand-edited/corrupted subscription channelAvatarUrl that fails re-validation is never backfilled onto db.metadata', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    // Bypass recordSubscriptionChannelAvatar's own sanitizer entirely to
    // simulate a corrupted persisted record (same posture as the sibling
    // AC18 hostile-channelUrl test in ytdlp-folder-backfill.test.js).
    await updateDatabase((db) => {
      const ns = store.ensureYtdlp(db);
      ns.subscriptions.push({
        id: 'hostile-avatar-sub',
        channelUrl: 'https://www.youtube.com/@hostileavatarchannel',
        name: 'Hostile Avatar Channel',
        channelAvatarUrl: 'javascript:alert(1)',
      });
    });

    const channelDir = args.resolveChannelDir({ downloadDir }, { name: 'Hostile Avatar Channel' });
    fs.mkdirSync(channelDir, { recursive: true });
    const filePath = path.join(channelDir, 'Video [hostileAvatar1].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await scanDirectories();

    const id = getMediaId(filePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.ok(item, 'sanity: the file must still be indexed');
    assert.equal(item.channelUrl, 'https://www.youtube.com/@hostileavatarchannel', 'sanity: identity itself is still healed -- only the hostile avatar field must be dropped');
    assert.equal(item.channelAvatarUrl, undefined, 'a channelAvatarUrl failing re-validation must never be attached to db.metadata');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    await updateDatabase((db) => { const ns = store.ensureYtdlp(db); ns.subscriptions = []; return true; });
  }
});
