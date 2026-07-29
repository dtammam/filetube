'use strict';

// [INTEGRATION] v1.51 notification bell -- generation + seeding + prune,
// against the REAL server.js scan path (the scan-view-count-bridge harness
// pattern: the only thing seeded is what a real download would have written,
// everything after that is the production path -- no hand-authored
// intermediate values, per the divergent-fixture lesson and the v1.47.4
// "wiring severed, suite stayed green" class).
//
// Order-dependent by design (one DATA_DIR, one process): seeding must run
// against an empty feed, then the bridge tests generate real events on top,
// then the prune test destroys one.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-notifbridge-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  scanDirectories, loadDatabase, updateDatabase, getMediaId,
  seedNotificationHistoryOnce, userStore,
} = require('../../server');
const store = require('../../lib/ytdlp/store');

let downloadDir;
let admin;

before(() => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-notifbridge-dl-'));
  admin = userStore.createFirstAdmin(
    { username: 'dean', displayName: 'Dean', passwordHash: 'h' },
    null,
    '2026-01-01T00:00:00.000Z'
  );
});

after(() => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

function withYtdlpEnv(fn) {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  return fn().finally(() => {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  });
}

// Write a real file and hand-index it the way a long-indexed library item
// looks (path+size match disk, so later scans take the reuse fast path).
function indexedFixture(db, name, extraFields) {
  const filePath = path.join(downloadDir, name);
  fs.writeFileSync(filePath, `bytes of ${name}`);
  const stats = fs.statSync(filePath);
  const id = getMediaId(filePath);
  db.metadata[id] = {
    id,
    name,
    title: name.replace(/\.mp4$/, ''),
    filePath,
    size: stats.size,
    ext: '.mp4',
    type: 'video',
    addedAt: stats.birthtimeMs || stats.mtimeMs,
    folderName: path.basename(downloadDir),
    ...extraFields,
  };
  return id;
}

const CAPTURED_AT = Date.UTC(2026, 5, 1, 12, 0, 0);

test('one-shot seeding: newest 30 yt-dlp-provenance items land as read+seen history; the stamp blocks a second run', async () => {
  let provenanceIds = [];
  let mockOnlyId;
  await updateDatabase((db) => {
    if (!db.metadata) db.metadata = {};
    provenanceIds.push(indexedFixture(db, 'Prövenance YT.mp4', { youtubeId: 'aaaaaaaaaaa' }));
    provenanceIds.push(indexedFixture(db, 'Prövenance Universal.mp4', { sourceExtractor: 'Vimeo', sourceId: '1' }));
    provenanceIds.push(indexedFixture(db, 'Prövenance MeTube.mp4', { channelUrl: 'https://www.youtube.com/@someone' }));
    for (let i = 0; i < 30; i++) {
      provenanceIds.push(indexedFixture(db, `Bulk Sëed ${i}.mp4`, { youtubeId: 'aaaaaaaaaaa' }));
    }
    mockOnlyId = indexedFixture(db, 'Hand Dropped.mp4', {});
    // Provenance but a rotten addedAt: excluded from seeding, never crashes it.
    const badId = indexedFixture(db, 'Bad AddedAt.mp4', { youtubeId: 'aaaaaaaaaaa' });
    db.metadata[badId].addedAt = 'not-a-number';
  });

  const seedNow = Date.now();
  const seeded = await seedNotificationHistoryOnce(seedNow);
  assert.equal(seeded, 30, 'capped at the 30 newest provenance items');
  assert.equal(userStore.countNotifications(), 30);
  assert.equal(loadDatabase().settings.notificationsSeededAt, seedNow, 'stamp persisted');

  const { items } = userStore.listNotifications(admin.id);
  assert.equal(items.length, 30);
  assert.ok(items.every((i) => i.unread === false), 'seeded history carries no dots');
  assert.ok(!items.some((i) => i.mediaId === mockOnlyId), 'a non-provenance file never seeds');
  assert.ok(items.every((i) => provenanceIds.includes(i.mediaId)), 'only provenance items seeded');
  assert.equal(userStore.countUnseenNotifications(admin.id), 0, 'badge 0 after seeding');

  assert.equal(await seedNotificationHistoryOnce(Date.now()), 0, 'the stamp makes seeding once-ever');
  assert.equal(userStore.countNotifications(), 30, 'no duplicates from the second call');
});

test('bridge (YouTube lane): a consumed download notifies, dated by the CONSUME moment, and badges the user', () => withYtdlpEnv(async () => {
  const filePath = path.join(downloadDir, 'Fresh Download [nnnnnnnnnnn].mp4');
  fs.writeFileSync(filePath, 'not a real video');
  // Gate fix (adversarial W1): backdate the file's timestamps hard -- the
  // .part-rename birthtime failure shape. The notification must be dated by
  // the consume moment, NOT this stale birthtime, or it is born pre-seen.
  const staleMs = Date.now() - 45 * 60 * 1000;
  fs.utimesSync(filePath, staleMs / 1000, staleMs / 1000);
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.nnnnnnnnnnn = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelName: 'Nötif Channel',
      capturedAt: CAPTURED_AT,
    };
  });

  const beforeScan = Date.now();
  await scanDirectories();
  const afterScan = Date.now();

  const id = getMediaId(filePath);
  const { items } = userStore.listNotifications(admin.id);
  const row = items.find((i) => i.mediaId === id);
  assert.ok(row, 'the consumed download produced a notification through the real scan');
  assert.ok(row.createdAt >= beforeScan && row.createdAt <= afterScan,
    `dated by the consume moment (got ${row.createdAt}, scan window ${beforeScan}..${afterScan}) -- never the file birthtime, which lies on the .part-rename path`);
  assert.equal(row.unread, true, 'a real download arrives as a dotted row');
  assert.equal(userStore.countUnseenNotifications(admin.id), 1, 'and it badges even though the file birthtime predates every watermark');
}));

test('bridge (universal lane): a composite-keyed consume notifies too', () => withYtdlpEnv(async () => {
  const base = 'A Vimeo Film [Vimeo=76979871].mp4';
  const filePath = path.join(downloadDir, base);
  fs.writeFileSync(filePath, 'not a real video');
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta[base] = {
      universal: true,
      sourceExtractor: 'Vimeo',
      sourceId: '76979871',
      channelName: 'Söme Studio',
      capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();

  const id = getMediaId(filePath);
  assert.ok(userStore.listNotifications(admin.id).items.some((i) => i.mediaId === id),
    'the universal consume path notifies');
  assert.equal(userStore.countUnseenNotifications(admin.id), 2, 'both fresh downloads badge');
}));

test('negative space: bridgeless files never notify, and an unchanged rescan re-notifies nothing', () => withYtdlpEnv(async () => {
  // A bracketed file with NO downloadMeta entry (older download, or a rename)
  // and a plain hand-dropped file: neither may notify.
  const orphanBracket = path.join(downloadDir, 'Orphan [ooooooooooo].mp4');
  const handDrop = path.join(downloadDir, 'Just A File.mp4');
  fs.writeFileSync(orphanBracket, 'x');
  fs.writeFileSync(handDrop, 'y');

  const beforeCount = userStore.countNotifications();
  const beforeIds = new Set(userStore.listNotifications(admin.id).items.map((i) => i.id));
  await scanDirectories();
  assert.equal(userStore.countNotifications(), beforeCount, 'no consume, no notification');

  await scanDirectories(); // unchanged rescan of EVERYTHING
  assert.equal(userStore.countNotifications(), beforeCount, 'a rescan never re-notifies');
  const afterIds = new Set(userStore.listNotifications(admin.id).items.map((i) => i.id));
  assert.deepEqual([...afterIds].sort(), [...beforeIds].sort(), 'row ids stable across rescans (nothing re-topped)');
}));

test('prune: a deleted file takes its notification (and the badge) with it on the next scan', () => withYtdlpEnv(async () => {
  const filePath = path.join(downloadDir, 'Fresh Download [nnnnnnnnnnn].mp4');
  const id = getMediaId(filePath);
  assert.ok(userStore.listNotifications(admin.id).items.some((i) => i.mediaId === id), 'precondition: row exists');
  fs.unlinkSync(filePath);

  await scanDirectories();

  assert.ok(!userStore.listNotifications(admin.id).items.some((i) => i.mediaId === id),
    'the notification pruned with its media (no tap-to-404)');
  assert.equal(userStore.countUnseenNotifications(admin.id), 1, 'badge dropped to the surviving unseen row');
}));
