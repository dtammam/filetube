'use strict';

// [INTEGRATION] v1.66 web push -- the scan -> delivery bridge against the
// REAL server.js scan path (the scan-notification-bridge harness pattern:
// seed only what a real download would have written, then let production
// code run). The transport is swapped via __setPushTransportForTests; no
// network is ever touched.
//
// The two claims that matter most here:
//   1. a consumed download pushes: encrypted body, VAPID auth, cursor
//      advanced - through the real collect -> flush -> trigger chain;
//   2. a HANGING push endpoint never blocks scanDirectories (the trigger
//      is detached) - the P3 "delivery can never hurt the scan" ruling.
//
// Order-dependent by design (one DATA_DIR, one process).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pushbridge-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  scanDirectories, updateDatabase, getMediaId,
  seedNotificationHistoryOnce, userStore,
  __setPushTransportForTests, __setPushGuardLookupForTests,
} = require('../../server');
const store = require('../../lib/ytdlp/store');
const { publicKeyToUncompressedB64url } = require('../../lib/push/keys');

let downloadDir;
let admin;
const ua = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const UA_P256DH = publicKeyToUncompressedB64url(ua.publicKey.export({ format: 'jwk' }));
const UA_AUTH = crypto.randomBytes(16).toString('base64url');
const ENDPOINT = 'https://push.example/wp/BridgeDevice-1';

const sends = [];
let transportImpl = async () => ({ statusCode: 201, headers: {} });

before(async () => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pushbridge-dl-'));
  admin = userStore.createFirstAdmin(
    { username: 'dean', displayName: 'Dean', passwordHash: 'h' },
    null,
    '2026-01-01T00:00:00.000Z'
  );
  __setPushTransportForTests(async (opts) => {
    sends.push(opts);
    return transportImpl(opts);
  });
  // Fixture endpoints (push.example) have no public DNS; resolve them to a
  // public address so the delivery-time guard exercises its REAL logic and
  // still passes. (Its refusal path is covered in the unit suite.)
  __setPushGuardLookupForTests((host, opts, cb) => cb(null, [{ address: '203.0.113.9', family: 4 }]));
  // The feature gate needs >=1 subscription in db.ytdlp; give it one.
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.subscriptions.push({ id: 'sub1', channelUrl: 'https://www.youtube.com/@bridge', name: 'Bridge', paused: false });
  });
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
});

after(() => {
  __setPushTransportForTests(null);
  __setPushGuardLookupForTests(null);
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

async function waitFor(cond, label, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const CAPTURED_AT = Date.UTC(2026, 6, 1, 12, 0, 0);

function plantDownload(name, youtubeId) {
  const filePath = path.join(downloadDir, `${name} [${youtubeId}].mp4`);
  fs.writeFileSync(filePath, 'not a real video');
  return filePath;
}

test('boot seeding never pushes (the trigger is bound to the flush site, not the store method)', async () => {
  // Plant a provenance item the seeder will consume, and a live subscription
  // that WOULD receive a push if seeding triggered one.
  userStore.upsertPushSubscription(admin.id, { endpoint: ENDPOINT, p256dh: UA_P256DH, auth: UA_AUTH }, 0, Date.now());
  const filePath = path.join(downloadDir, 'Seeded History.mp4');
  fs.writeFileSync(filePath, 'x');
  await updateDatabase((db) => {
    if (!db.metadata) db.metadata = {};
    const stats = fs.statSync(filePath);
    const id = getMediaId(filePath);
    db.metadata[id] = {
      id, name: 'Seeded History.mp4', title: 'Seeded History', filePath,
      size: stats.size, ext: '.mp4', type: 'video',
      addedAt: stats.mtimeMs, folderName: path.basename(downloadDir),
      youtubeId: 'aaaaaaaaaaa',
    };
  });
  const seeded = await seedNotificationHistoryOnce(Date.now());
  assert.equal(seeded, 1, 'precondition: seeding consumed the item');
  // Give any (wrong) detached trigger a chance to fire before asserting.
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sends.length, 0, 'seeding produced ZERO pushes');
  assert.equal(userStore.getPushSubscription(ENDPOINT).lastPushedId, 0, 'cursor untouched by seeding');
  // Simulate the subscribe route's cursor init (MAX(id) at registration -
  // Commit D) so later tests see only genuinely-new rows as missed.
  userStore.advancePushCursor(ENDPOINT, userStore.getMaxNotificationId());
});

test('a consumed download pushes through the real scan: encrypted body, VAPID auth for the endpoint origin, cursor advanced', async () => {
  const filePath = plantDownload('Fresh Push Video', 'nnnnnnnnnnn');
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.nnnnnnnnnnn = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelName: 'Püsh Channel',
      capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();
  await waitFor(() => sends.length >= 1, 'the detached delivery round');

  assert.equal(sends.length, 1, 'one missed row = one individual push (P2)');
  const s = sends[0];
  assert.equal(s.url, ENDPOINT);
  assert.equal(s.headers['Content-Encoding'], 'aes128gcm');
  assert.match(s.headers.Authorization, /^vapid t=/);
  const jwtBody = JSON.parse(Buffer.from(s.headers.Authorization.match(/t=([^,]+),/)[1].split('.')[1], 'base64url'));
  assert.equal(jwtBody.aud, 'https://push.example', 'aud = the push service origin, never FileTube');
  assert.ok(Buffer.isBuffer(s.body));
  assert.ok(!s.body.includes(Buffer.from('Fresh Push Video')), 'title rides encrypted, never plaintext');

  const id = getMediaId(filePath);
  const row = userStore.listNotifications(admin.id).items.find((i) => i.mediaId === id);
  assert.ok(row, 'precondition: the feed row exists');
  await waitFor(() => userStore.getPushSubscription(ENDPOINT).lastPushedId >= row.id, 'cursor advance');
  assert.equal(userStore.getPushSubscription(ENDPOINT).lastPushedId, row.id, 'cursor = the delivered row');
});

test('a HANGING push endpoint never blocks the scan (detached trigger), and delivery completes once the endpoint recovers', async () => {
  let releaseHang;
  const hang = new Promise((r) => { releaseHang = r; });
  transportImpl = async () => { await hang; return { statusCode: 201, headers: {} }; };
  sends.length = 0;

  const filePath = plantDownload('Slow Endpoint Video', 'ssssssssss1');
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.ssssssssss1 = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelName: 'Püsh Channel',
      capturedAt: CAPTURED_AT,
    };
  });

  const t0 = Date.now();
  await scanDirectories();
  const scanMs = Date.now() - t0;
  assert.ok(scanMs < 3000, `scan returned in ${scanMs}ms while the push POST is still hanging`);
  await waitFor(() => sends.length >= 1, 'the hanging send to start');
  const cursorBefore = userStore.getPushSubscription(ENDPOINT).lastPushedId;
  const id = getMediaId(filePath);
  const row = userStore.listNotifications(admin.id).items.find((i) => i.mediaId === id);
  assert.ok(row && cursorBefore < row.id, 'cursor has NOT advanced past the undelivered row');

  releaseHang();
  await waitFor(() => userStore.getPushSubscription(ENDPOINT).lastPushedId >= row.id, 'post-recovery cursor advance');
  transportImpl = async () => ({ statusCode: 201, headers: {} });
});

test('a 410 from the real chain prunes the subscription; the next scan pushes to nobody', async () => {
  transportImpl = async () => ({ statusCode: 410, headers: {} });
  sends.length = 0;

  plantDownload('Gone Device Video', 'ggggggggggg');
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.ggggggggggg = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelName: 'Püsh Channel',
      capturedAt: CAPTURED_AT,
    };
  });
  await scanDirectories();
  await waitFor(() => userStore.getPushSubscription(ENDPOINT) === null, 'the 410 prune');

  sends.length = 0;
  plantDownload('Nobody Listens Video', 'qqqqqqqqqq1');
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.qqqqqqqqqq1 = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelName: 'Püsh Channel',
      capturedAt: CAPTURED_AT,
    };
  });
  await scanDirectories();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sends.length, 0, 'no subscriptions, no POSTs - and the scan itself stayed green');
});
