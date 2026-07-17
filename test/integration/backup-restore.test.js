'use strict';

// [INTEGRATION] v1.42 T5 — instance backup/restore (AC6 + design review
// F5/F6). GET /api/admin/backup exports a schema-versioned JSON bundle of
// every persisted namespace + the custom logo bytes; POST /api/admin/restore
// wipe-and-replaces inside one transaction with full coherency (coalescers
// cleared, cache invalidated) and strict refuse-don't-drop validation.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backup-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, saveDatabase, loadDatabase, pendingProgress, pendingProgressKey,
  flushPendingProgress,
  scanDirectories,
  __resetDatabaseForTests,
  __getPersistedStateEpoch,
  userStore,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;
let auth;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
  // A restore-with-users in a prior test bumps testadmin's token_version (the
  // CRITICAL-1 floor), which kills the global patched-fetch cookie (minted at
  // the old tv). In a real browser the reissued Set-Cookie is adopted; the
  // test harness must re-sync manually. Re-authenticate cleanly (unpatch then
  // re-patch, re-signing at the current tv) so each case starts with a live
  // operator cookie.
  auth.restore();
  auth = authenticateFetch(server, base);
  for (const f of ['custom-logo.bin', 'custom-logo-dark.bin']) {
    try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch { /* fine */ }
  }
});

// A 1x1 PNG — real magic bytes so the logo upload route's sniffer accepts it.
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex'
);

function fullState() {
  return {
    folders: ['/media/videos'],
    folderSettings: { '/media/videos': { name: 'Videos', hidden: false } },
    progress: { vid1: { timestamp: 42, duration: 100 } },
    metadata: { vid1: { id: 'vid1', name: 'clip.mp4', title: 'Clip', type: 'video', ext: '.mp4', filePath: '/media/videos/clip.mp4', duration: 100, folderName: 'Videos' } },
    liked: ['vid1'],
    deleteTombstones: { gone1: { filePath: '/media/videos/gone.mp4', deletedAt: 1752600000000 } },
    viewCounts: { vid1: 9 },
    settings: { defaultView: 'grid' },
    books: {
      folders: ['/media/books'],
      items: { bk1: { id: 'bk1', title: 'A Book', filePath: '/media/books/a.epub', format: 'epub' } },
      progress: { bk1: { locator: { kind: 'epub', cfi: 'x' }, percent: 40, updatedAt: 't' } },
      pins: [], settings: {}, audio: {},
    },
    ytdlp: {
      allowMembersOnly: false,
      subscriptions: [{ id: 'sub1', channelUrl: 'https://youtube.com/@x', name: 'X', paused: false }],
      downloadMeta: {}, pins: [], channelAvatars: {},
    },
  };
}

async function getBackup() {
  const res = await fetch(`${base}/api/admin/backup`);
  assert.equal(res.status, 200);
  return res.json();
}

async function postRestore(bundle) {
  return fetch(`${base}/api/admin/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
}

test('AC6: backup -> wipe -> restore -> deep-equal (every namespace round-trips; v1.43: users ride the bundle)', async () => {
  saveDatabase(fullState());
  const beforeState = loadDatabase();

  const bundle = await getBackup();
  assert.equal(bundle.schema, 'filetube-backup-v1');
  assert.ok(bundle.exportedAt && bundle.appVersion);
  // v1.43: the bundle carries the full account set (the suite's admin at
  // minimum), hashes included.
  assert.ok(Array.isArray(bundle.users) && bundle.users.length >= 1);
  const bundledAdmin = bundle.users.find((u) => u.username === auth.user.username);
  assert.ok(bundledAdmin, 'the acting admin rides the bundle');
  assert.equal(typeof bundledAdmin.passwordHash, 'string', 'account restore needs the hash');
  assert.deepEqual(bundle.viewCounts, { vid1: 9 }, 'viewCounts is a first-class bundle namespace');

  await __resetDatabaseForTests(); // the wipe
  assert.deepEqual(readPersistedDatabase(DATA_DIR), {}, 'precondition: store empty');

  const res = await postRestore(bundle);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).restoredNamespaces.sort(), Object.keys(fullState()).sort());

  assert.deepEqual(loadDatabase(), beforeState, 'restored state deep-equals the pre-wipe load');
});

test('logo bytes round-trip: upload -> backup -> delete -> restore brings back bytes AND mime; absent variant unlinks stale bin (F6)', async () => {
  saveDatabase(fullState());
  // Upload a light logo through the real route (magic-byte sniffer included).
  const up = await fetch(`${base}/api/settings/logo`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG_BYTES,
  });
  assert.equal(up.status, 200);
  // Plant a STALE dark variant directly (simulates an old dark logo the
  // bundle being restored does not carry).
  fs.writeFileSync(path.join(DATA_DIR, 'custom-logo-dark.bin'), Buffer.from('stale-dark'));

  const bundle = await getBackup();
  assert.equal(bundle.customLogo.light.mime, 'image/png');
  assert.equal(Buffer.from(bundle.customLogo.light.b64, 'base64').compare(PNG_BYTES), 0, 'exact bytes exported');
  assert.equal(bundle.customLogo.dark, undefined, 'no dark mime key -> no dark export');

  // Delete the logo, then restore the bundle.
  await fetch(`${base}/api/settings/logo`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}/logo`)).status, 404, 'precondition: logo gone');

  const res = await postRestore(bundle);
  assert.equal(res.status, 200);

  const served = await fetch(`${base}/logo`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type').split(';')[0], 'image/png');
  assert.equal(Buffer.from(await served.arrayBuffer()).compare(PNG_BYTES), 0, 'restored bytes serve byte-identical');
  assert.ok(!fs.existsSync(path.join(DATA_DIR, 'custom-logo-dark.bin')), 'stale dark bin unlinked by the restore');
});

test('F5 coherency: a progress ping staged BEFORE the restore never lands after it, and a zero-write read serves restored data', async () => {
  saveDatabase(fullState());
  // A COMMITTED per-user position rides the bundle (v1.43 chunk 4d)...
  const committed = await fetch(`${base}/api/progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'vid1', timestamp: 42, duration: 100 }),
  });
  assert.equal(committed.status, 200);
  await flushPendingProgress();
  const bundle = await getBackup();
  assert.equal(bundle.users.find((u) => u.username === auth.user.username).progress.vid1.timestamp, 42,
    'precondition: the committed position rides the bundle');

  // ...then a NEWER ping is staged (never flushed) before the restore fires.
  const ping = await fetch(`${base}/api/progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'vid1', timestamp: 77, duration: 100 }),
  });
  assert.equal(ping.status, 200);
  const pendingKey = pendingProgressKey(auth.user.id, 'vid1');
  assert.ok(pendingProgress.has(pendingKey), 'precondition: ping staged');

  const res = await postRestore(bundle);
  assert.equal(res.status, 200);
  assert.ok(!pendingProgress.has(pendingKey), 'the restore cleared the staged ping');

  // The restore bumped the operator's tv (CRITICAL-1 floor) and reissued the
  // cookie in the response; re-sync the patched-fetch cookie so the
  // continuation reads authenticate (a browser would have adopted Set-Cookie).
  auth.restore();
  auth = authenticateFetch(server, base);

  // Zero intervening writes: the very next read serves the RESTORED per-user
  // position (the original v1.42 F5 contract, now at the per-user layer).
  const read = await fetch(`${base}/api/progress/vid1`);
  assert.equal((await read.json()).timestamp, 42, 'restored position, not the stale ping');

  // Even an explicit flush now must not land the pre-restore ping.
  await flushPendingProgress();
  assert.equal(userStore.getOneProgress(auth.user.id, 'vid1').timestamp, 42, 'the pre-restore ping never lands over the restored position');
  assert.equal(loadDatabase().progress.vid1.timestamp, 42, 'the frozen doc-table record is exactly what the bundle restored -- untouched by any flush');
});

test('validation refuses: wrong schema, unknown bundle key, non-empty users, oversized/invalid logo', async () => {
  saveDatabase(fullState());
  const good = await getBackup();

  assert.equal((await postRestore({ ...good, schema: 'filetube-backup-v99' })).status, 400);
  assert.equal((await postRestore({ ...good, mysteryKey: 1 })).status, 400);
  // v1.43: users restore for real now -- but a malformed entry still refuses
  // the WHOLE bundle up front (no lossy/partial account restore).
  const withUsers = { ...good, users: [{ username: 'admin' }] };
  const resUsers = await postRestore(withUsers);
  assert.equal(resUsers.status, 400);
  assert.match((await resUsers.json()).error, /id must be a positive integer/, 'a malformed users entry is refused loudly, never lossily');
  assert.equal((await postRestore({ ...good, customLogo: { light: { mime: 'image/svg+xml', b64: 'AA==' } } })).status, 400, 'mime outside the allowlist refused');
  assert.equal((await postRestore({ ...good, customLogo: { blue: { mime: 'image/png', b64: 'AA==' } } })).status, 400, 'unknown variant refused');
  const spoofed = await postRestore({ ...good, customLogo: { light: { mime: 'image/png', b64: Buffer.from('<svg>not a png</svg>').toString('base64') } } });
  assert.equal(spoofed.status, 400, 'a false mime claim over non-matching bytes is refused (magic-byte sniff, same bar as the upload route)');
  assert.match((await spoofed.json()).error, /magic-byte/);

  // Nothing above may have modified state.
  assert.deepEqual(readPersistedDatabase(DATA_DIR).folders, ['/media/videos'], 'state untouched by refused restores');
  assert.deepEqual(readPersistedDatabase(DATA_DIR).metadata.vid1.title, 'Clip', 'metadata untouched by refused restores');
});

test('W4: a wipe/restore landing MID-SCAN aborts the scan\'s stale merge — the replaced state survives', async () => {
  // The race the design-delta gate flagged: the scan's Phase-1 walk runs
  // OUTSIDE the write lock; if a restore wipes-and-replaces between the walk
  // and the final merge, mergeScannedMetadata (authoritative for membership)
  // would overwrite the restored library with the scan's pre-restore view.
  // The epoch guard makes the merge refuse instead. Ordering here is
  // DETERMINISTIC, not timing-based: the wipe is enqueued on the write chain
  // in the same tick scanDirectories starts its (await-laden) walk, so it
  // always commits before the scan's final mutator reaches the chain.
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-w4-lib-'));
  fs.writeFileSync(path.join(libDir, 'walker.mp4'), 'bytes-the-scan-would-index');
  saveDatabase({ ...fullState(), folders: [libDir] });

  const epochBefore = __getPersistedStateEpoch();
  const scanPromise = scanDirectories();     // Phase-1 walk starts (async)
  await __resetDatabaseForTests();           // the wipe — enqueued FIRST on the chain
  await scanPromise;                         // scan's final merge must self-discard

  assert.equal(__getPersistedStateEpoch(), epochBefore + 1, 'the wipe bumped the epoch');
  assert.deepEqual(readPersistedDatabase(DATA_DIR), {},
    'the scan\'s stale merge was DISCARDED — it did not resurrect pre-wipe state or index the walked file over the wipe');
  fs.rmSync(libDir, { recursive: true, force: true });
});

test('a restore that fails mid-populate ROLLS BACK completely — db state AND the logo bytes both intact, 500 surfaces', async () => {
  saveDatabase(fullState());
  // A real logo on disk, so the delta-round residual is exercised: a failed
  // restore must NOT have destroyed the previous logo before the import ran.
  const up = await fetch(`${base}/api/settings/logo`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG_BYTES,
  });
  assert.equal(up.status, 200);
  const beforeSnap = readPersistedDatabase(DATA_DIR);

  const bundle = await getBackup();
  // Passes validateBackupBundle (books IS an object) but fails INSIDE the
  // exclusive section: books.items is not a per-key map, so importParsedJson
  // refuses mid-populate — after the wipe, before the logo file ops.
  bundle.books = { items: 'not-a-map' };
  const res = await postRestore(bundle);
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /rolled back/);

  assert.deepEqual(readPersistedDatabase(DATA_DIR), beforeSnap, 'wipe + partial populate fully rolled back');
  const served = await fetch(`${base}/logo`);
  assert.equal(served.status, 200, 'the previous logo still serves');
  assert.equal(Buffer.from(await served.arrayBuffer()).compare(PNG_BYTES), 0,
    'logo bytes untouched by the failed restore — the rollback message tells the truth about the filesystem too');

  // A malformed container SHAPE is caught even earlier: 400 at validation,
  // before the wipe starts.
  assert.equal((await postRestore({ ...bundle, books: 'not-an-object' })).status, 400);
  assert.equal((await postRestore({ ...bundle, books: [] })).status, 400);
});

// ---- v1.43 chunk 4d: admin-only, users in the bundle, self-lockout guard ----

test('v1.43: backup and restore are ADMIN-ONLY (a member gets 403 on both)', async () => {
  const { __mintTestSession } = require('../../server');
  const member = __mintTestSession({ username: 'backupmember', role: 'member' });
  assert.equal((await fetch(`${base}/api/admin/backup`, { headers: { Cookie: member.cookie } })).status, 403);
  const res = await fetch(`${base}/api/admin/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: member.cookie },
    body: JSON.stringify({ schema: 'filetube-backup-v1' }),
  });
  assert.equal(res.status, 403);
});

test('v1.43: the session secret NEVER rides the bundle (secrets do not ride bundles)', async () => {
  saveDatabase(fullState());
  const bundle = await getBackup();
  const secretBytes = fs.readFileSync(path.join(DATA_DIR, 'session-secret'), 'utf8').trim();
  const serialized = JSON.stringify(bundle);
  assert.ok(secretBytes.length > 0, 'precondition: a session secret exists');
  assert.ok(!serialized.includes(secretBytes), 'the secret value must not appear anywhere in the bundle');
  assert.ok(!Object.keys(bundle).some((k) => /secret/i.test(k)), 'no secret-shaped bundle key');
});

test('v1.43: user accounts + per-user state round-trip through backup -> wipe -> restore, atomically with the doc tables', async () => {
  saveDatabase(fullState());
  const { __mintTestSession } = require('../../server');
  const extra = __mintTestSession({ username: 'roundtripper', role: 'member' });
  userStore.setProgress(extra.user.id, 'vid1', { timestamp: 33, duration: 100, updatedAt: '2026-07-17T00:00:00.000Z' });
  userStore.addLiked(extra.user.id, 'vid1', '2026-07-17T00:00:00.000Z');
  userStore.setBookProgress(extra.user.id, 'bk1', { locator: { kind: 'epub', cfi: 'y' }, percent: 60, updatedAt: '2026-07-17T00:00:00.000Z' });
  userStore.setChannelPin(extra.user.id, { id: 'cp1', channelDir: '/d/chan', label: 'Chan', pinnedAt: 't', order: 0 });

  const bundle = await getBackup();
  const bundledExtra = bundle.users.find((u) => u.username === 'roundtripper');
  assert.ok(bundledExtra, 'the second account rides the bundle');
  assert.equal(bundledExtra.progress.vid1.timestamp, 33);
  assert.deepEqual(bundledExtra.liked.map((l) => l.mediaId), ['vid1']);

  // Wipe EVERYTHING (docs + users) to prove the restore rebuilds both.
  await __resetDatabaseForTests();
  const { __clearUsersForTests, __mintTestSession: remint } = require('../../server');
  __clearUsersForTests();
  // The acting admin must exist to authenticate the restore call -- recreate
  // it (fresh id; the restore matches by USERNAME and replaces it wholesale).
  const fresh = remint();
  assert.equal(userStore.countUsers(), 1, 'precondition: only the freshly-minted admin exists');

  const res = await fetch(`${base}/api/admin/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: fresh.cookie },
    body: JSON.stringify(bundle),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).usersRestored, bundle.users.length);
  assert.ok(res.headers.get('set-cookie'), 'the restoring admin gets a reissued cookie against the RESTORED row');

  const restored = userStore.getByUsername('roundtripper');
  assert.ok(restored, 'the second account came back');
  assert.equal(userStore.getOneProgress(restored.id, 'vid1').timestamp, 33, 'their watch position came back');
  assert.deepEqual(userStore.getLiked(restored.id), ['vid1'], 'their like came back');
  assert.equal(userStore.getOneBookProgress(restored.id, 'bk1').percent, 60, 'their reading position came back');
  assert.equal(userStore.getChannelPins(restored.id)[0].id, 'cp1', 'their channel pin came back');
  assert.equal(loadDatabase().metadata.vid1.title, 'Clip', 'the doc tables restored in the same transaction');
});

test('v1.43 self-lockout guard: a bundle that lacks the restoring admin (as an enabled admin) is refused whole, nothing changes', async () => {
  saveDatabase(fullState());
  const before = await getBackup();
  const usersBefore = userStore.listUsers().map((u) => u.username).sort();

  // A hostile/stale bundle whose only account is someone else.
  const foreign = {
    ...before,
    users: [{
      id: 1, username: 'notyou', displayName: 'Not You', passwordHash: 'scrypt$32768$8$1$aa$bb',
      role: 'admin', canManageSubscriptions: true, settingsJson: '{}', tokenVersion: 0, disabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
  };
  const res = await postRestore(foreign);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /lock you out/);
  assert.deepEqual(userStore.listUsers().map((u) => u.username).sort(), usersBefore, 'the account set is untouched');

  // Same refusal when the restoring admin IS present but disabled or demoted.
  const me = userStore.getByUsername('testadmin');
  const demoted = { ...foreign, users: [{ ...foreign.users[0], id: 2 }, { id: me.id, username: 'testadmin', passwordHash: 'scrypt$32768$8$1$aa$bb', role: 'member', canManageSubscriptions: false, settingsJson: '{}', tokenVersion: 0, disabled: false, createdAt: '2026-01-01T00:00:00.000Z' }] };
  assert.equal((await postRestore(demoted)).status, 409, 'present-but-member is still a lockout');
  const disabledSelf = { ...foreign, users: [{ ...foreign.users[0], id: 2 }, { id: me.id, username: 'testadmin', passwordHash: 'scrypt$32768$8$1$aa$bb', role: 'admin', canManageSubscriptions: true, settingsJson: '{}', tokenVersion: 0, disabled: true, createdAt: '2026-01-01T00:00:00.000Z' }] };
  assert.equal((await postRestore(disabledSelf)).status, 409, 'present-but-disabled is still a lockout');
});

test('v1.43: a v1.42-format bundle (users absent or empty) restores the docs and leaves the CURRENT accounts untouched', async () => {
  saveDatabase(fullState());
  const bundle = await getBackup();
  delete bundle.users; // the v1.42 shape
  const usersBefore = userStore.listUsers().map((u) => u.username).sort();

  const res = await postRestore(bundle);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).usersRestored, 0);
  assert.deepEqual(userStore.listUsers().map((u) => u.username).sort(), usersBefore,
    'a bundle without accounts must never wipe the instance\'s accounts');
  assert.equal(loadDatabase().metadata.vid1.title, 'Clip', 'the doc restore still ran');
});

// ---- gate CRITICAL-1 (adversarial): restore must invalidate OTHER live sessions ----

test('CRITICAL-1: an id-reassigning restore invalidates a THIRD PARTY\'s live cookie -- no cross-user bleed / privilege escalation', async () => {
  const { __mintTestSession } = require('../../server');
  saveDatabase(fullState());

  // "Beta" instance: a friend `sam` (member) signs in and holds a REAL live
  // cookie {uid: sam.id, tv: 0}. No forging -- his genuine session is the
  // attack vehicle.
  const me = userStore.getByUsername('testadmin');
  const sam = __mintTestSession({ username: 'sam', role: 'member' });
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: sam.cookie } })).status, 200, 'precondition: sam is live');

  // A bundle (e.g. exported from a DIFFERENT prod instance) that reassigns
  // sam's exact id to a DIFFERENT identity -- admin `alice`, tv 0. Without the
  // fix, sam's {uid: sam.id, tv: 0} cookie would authenticate as alice and
  // inherit her ADMIN. The operator (testadmin) is present so the self-lockout
  // guard passes.
  const bundle = await getBackup();
  bundle.users = [
    { id: me.id, username: 'testadmin', displayName: 'Admin', passwordHash: 'scrypt$32768$8$1$aa$bb', role: 'admin', canManageSubscriptions: true, settingsJson: '{}', tokenVersion: 0, disabled: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: sam.user.id, username: 'alice', displayName: 'Alice', passwordHash: 'scrypt$32768$8$1$aa$bb', role: 'admin', canManageSubscriptions: true, settingsJson: '{}', tokenVersion: 0, disabled: false, createdAt: '2026-01-01T00:00:00.000Z' },
  ];

  const res = await postRestore(bundle);
  assert.equal(res.status, 200);
  const alice = userStore.getByUsername('alice');
  assert.ok(alice && alice.id === sam.user.id, 'alice landed at sam\'s exact former id');

  // THE ATTACK: sam's still-held cookie must NOT authenticate as the restored
  // alice -- the tv floor bumped alice's tv above sam's cookie tv (0), so the
  // gate's tv check rejects it. No cross-user bleed, no privilege escalation.
  const bleed = await fetch(`${base}/api/auth/me`, { headers: { Cookie: sam.cookie } });
  assert.equal(bleed.status, 401, 'a pre-restore cookie is dead after the id-reassigning restore -- no bleed, no escalation');
  assert.ok(alice.tokenVersion > 0, 'alice\'s restored tv was floored above any live cookie value');

  // The operator, by contrast, got a reissued cookie and stays signed in.
  assert.ok(res.headers.get('set-cookie'), 'the operator is reissued a valid cookie against the restored row');
});

// ---- v1.43.1 A1: the dead route-scoped limit / global-parser 413 -----------
//
// Root cause (Dean's prod restore failing with 413): the GLOBAL
// express.json() (default 100 kb) ran before the restore route, so any
// real-world bundle died there and the route's own larger limit was DEAD
// code. Every fixture above is a few KB, which is exactly why the regression
// stayed invisible: these tests exist so a bundle at REAL prod scale (and
// past it) exercises the actual parser topology, never just the happy-size
// path.

// fullState() plus enough realistic metadata rows to push the serialized
// bundle well past the global parser's 100 kb cap (Dean's prod bundle is
// ~2943 items; this builds a comparable map).
function prodScaleState(itemCount) {
  const state = fullState();
  for (let i = 0; i < itemCount; i++) {
    const id = `bulk${i}`;
    state.metadata[id] = {
      id,
      name: `bulk-${i}.mp4`,
      title: `Bulk clip ${i} — a realistically long yt-dlp style title so each row carries real-world weight`,
      type: 'video',
      ext: '.mp4',
      filePath: `/media/videos/bulk/channel-${i % 40}/bulk-${i}.mp4`,
      duration: 3600,
      folderName: 'Videos',
    };
    state.viewCounts[id] = i % 7;
  }
  return state;
}

test('v1.43.1 A1: a prod-scale bundle (well over the global parser 100 kb cap) round-trips — the 32mb route-scoped limit is ALIVE', async () => {
  const big = prodScaleState(3000);
  saveDatabase(big);
  const bundle = await getBackup();
  const wireBytes = Buffer.byteLength(JSON.stringify(bundle));
  assert.ok(wireBytes > 150 * 1024,
    `precondition: the fixture must dwarf the global 100 kb cap or this test proves nothing (got ${wireBytes} bytes)`);

  saveDatabase(fullState()); // wipe down to the small state, then restore the big one
  const res = await postRestore(bundle);
  assert.equal(res.status, 200,
    `a real-scale restore must not 413 (got ${res.status}: ${await res.text().catch(() => '')})`);
  const db = loadDatabase();
  assert.equal(Object.keys(db.metadata).length, Object.keys(big.metadata).length, 'every metadata row landed');
  assert.equal(db.metadata.bulk2999.title, big.metadata.bulk2999.title, 'deep content survived the round-trip');
});

test('v1.43.1 A1 (QA gate WARNING): a bundle just UNDER the 32mb cap restores — the suite pins the cap value itself', async () => {
  // The first prod-scale test (~1MB) proves the 100kb global cap is bypassed
  // but would stay green if the route limit silently regressed to the old
  // dead '16mb' (a merge-conflict revert is the realistic failure). This
  // bundle is ~28MB on the wire: over every plausible regression value,
  // under the real cap — only the true 32mb limit passes it.
  const big = fullState();
  const pad = 'x'.repeat(9800);
  for (let i = 0; i < 2900; i++) {
    const id = `cap${i}`;
    big.metadata[id] = {
      id, name: `cap-${i}.mp4`, title: `Cap probe ${i} ${pad}`, type: 'video',
      ext: '.mp4', filePath: `/media/videos/cap/cap-${i}.mp4`, duration: 60, folderName: 'Videos',
    };
  }
  saveDatabase(big);
  const bundle = await getBackup();
  const wireBytes = Buffer.byteLength(JSON.stringify(bundle));
  assert.ok(wireBytes > 24 * 1024 * 1024 && wireBytes < 32 * 1024 * 1024,
    `fixture must sit between every plausible regression value and the cap (got ${wireBytes} bytes)`);
  const res = await postRestore(bundle);
  assert.equal(res.status, 200, `a near-cap restore must parse (got ${res.status})`);
  assert.equal(loadDatabase().metadata.cap2899.name, 'cap-2899.mp4');
});

test('v1.43.1 A1 (adversarial WARNING-1): a MEMBER posting an oversized body gets 403 BEFORE the parse — 403, never 413', async () => {
  // The requireAdmin middleware sits AHEAD of the route-scoped 32mb parser:
  // a non-admin must be refused without the server buffering/parsing their
  // multi-MB body. A 413 here would mean the parser ran first — the exact
  // member-reachable CPU/memory amplifier the fix exists to prevent.
  const { __mintTestSession } = require('../../server');
  const member = __mintTestSession({ username: 'bulkmember', role: 'member' });
  const res = await fetch(`${base}/api/admin/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: member.cookie },
    body: `{"metadata":"${'x'.repeat(40 * 1024 * 1024)}"}`, // over the cap: parse-first would 413
  });
  assert.equal(res.status, 403, 'admin check answers before the parser ever runs');
});

test('v1.43.1 A1: a bundle OVER the 32mb cap gets a clean JSON 413 from the ROUTE-scoped error middleware (never an HTML error page)', async () => {
  // Content-Length past the limit makes body-parser refuse up front — no
  // need to build a valid bundle, the parse dies before validation runs.
  const oversized = `{"metadata":"${'x'.repeat(33 * 1024 * 1024)}"}`;
  const res = await fetch(`${base}/api/admin/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: oversized,
  });
  assert.equal(res.status, 413);
  // .json() throwing here would mean Express's default HTML error page — the
  // exact contract violation the route-scoped 4-arg middleware exists to
  // prevent (the global mapping middleware can never see this route's error).
  assert.deepEqual(await res.json(), { error: 'request body too large' });
});

test('v1.43.1 A1: an UNAUTHENTICATED oversized POST is 401d by the gate — the multi-MB parse allowance is never reachable pre-auth', async () => {
  const res = await fetch(`${base}/api/admin/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: '' },
    body: `{"metadata":"${'x'.repeat(200 * 1024)}"}`,
  });
  assert.equal(res.status, 401, 'the gate must answer before any body handling');
  const body = await res.json();
  assert.equal(body.authRequired, true, 'this is the GATE 401 (authRequired flag), not a handler 401');
});
