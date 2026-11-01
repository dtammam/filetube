'use strict';

// [INTEGRATION] v1.127 Wave A (T2) - the LIBRARY-WIDE reheat's visibility axis.
// The per-item repull route gained its visibility check in v1.123 (adversarial
// W3); the batch trigger and the relocation preview did not - both enumerated
// the ENTIRE library, so a manage-subs member restricted from a folder could
// reheat (write sidecars, rewrite identity, RELOCATE files) and read the
// preview's current+destination paths for hidden media. These tests bind the
// fix at the shared enumerator, the preview builder, AND the two live routes
// (the v1.41.4 "seat that forgot to CALL the shared helper" class - a correct
// helper is nothing if the route doesn't thread the predicate). Deleting the
// itemVisible parameter threading in either route turns these red.
// Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-reheat-'));
const DATA_DIR = process.env.DATA_DIR;
// The module's routes register at require time from the STARTUP config - the
// enablement must be in place before ../../server is required (unlike the
// server.js-side relocation config, which is re-parsed per request).
const EARLY_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-reheat-dl-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = EARLY_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, userStore, __mintTestSession,
  enumerateRepullableItems, buildImportRelocationPreview, loadDatabase, updateDatabase,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const ytdlp = require('../../lib/ytdlp');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, restricted;
let mediaDir, publicDir, hiddenDir, downloadDir;
let pubFile, hidFile;

function seedItem(filePath) {
  const stats = fs.statSync(filePath);
  return {
    id: getMediaId(filePath), name: path.basename(filePath),
    title: path.basename(filePath, path.extname(filePath)),
    filePath, folderName: path.basename(path.dirname(filePath)),
    rootFolder: mediaDir, size: stats.size, ext: path.extname(filePath),
    type: 'video', addedAt: stats.mtimeMs, duration: 10, hasThumbnail: false, artist: '',
  };
}

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-reheat-media-'));
  downloadDir = EARLY_DOWNLOAD_DIR;
  publicDir = path.join(mediaDir, 'Family');
  hiddenDir = path.join(mediaDir, 'VaultReheat');
  fs.mkdirSync(publicDir); fs.mkdirSync(hiddenDir);
  pubFile = path.join(publicDir, 'Öpen Video.mp4');
  hidFile = path.join(hiddenDir, 'Sécret Video.mp4');
  fs.writeFileSync(pubFile, 'OPEN');
  fs.writeFileSync(hidFile, 'SECRET');

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin

  const pub = seedItem(pubFile);
  const hid = seedItem(hidFile);
  seedState({
    folders: [mediaDir], folderSettings: {},
    metadata: { [pub.id]: pub, [hid.id]: hid },
    liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  // A minted member has canManageSubscriptions:true by default - exactly the
  // capable-but-restricted attacker shape. PATH-kind restriction (the v1.126
  // lesson: the kind that carries no folderName and slipped past a
  // folder-kind-only guard).
  restricted = __mintTestSession({ username: 'reheatkid', role: 'member' });
  userStore.setRestrictions(restricted.user.id, [{ kind: 'path', value: hiddenDir }]);
});
after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  for (const d of [DATA_DIR, mediaDir, downloadDir]) fs.rmSync(d, { recursive: true, force: true });
});

const post = (p, cookie) => fetch(`${base}${p}`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: JSON.stringify({}),
});

test('enumerateRepullableItems: the predicate excludes hidden items from the worklist AND the counts', () => {
  const db = loadDatabase();
  const config = ytdlp.parseYtdlpConfig();
  const all = enumerateRepullableItems(db, config);
  assert.strictEqual(all.items.length, 2, 'no predicate -> both items enumerated');
  const onlyPublic = (item) => !item.filePath.startsWith(hiddenDir);
  const scoped = enumerateRepullableItems(db, config, onlyPublic);
  assert.strictEqual(scoped.items.length, 1, 'predicate -> hidden item never enters the worklist');
  assert.strictEqual(scoped.eligible, 1, 'eligible count excludes the hidden item');
  assert.ok(scoped.items.every((it) => !it.filePath.startsWith(hiddenDir)), 'no hidden path in any worklist row');
});

test('buildImportRelocationPreview: a hidden item contributes no row and no counts', () => {
  const config = ytdlp.parseYtdlpConfig();
  const deps = { loadDatabase, updateDatabase, getMediaId };
  const all = buildImportRelocationPreview(deps, config);
  assert.strictEqual(all.summary.totalItems, 2, 'no predicate -> both items counted');
  const onlyPublic = (item) => !!item && !item.filePath.startsWith(hiddenDir);
  const scoped = buildImportRelocationPreview(deps, config, onlyPublic);
  assert.strictEqual(scoped.summary.totalItems, 1, 'summary excludes the hidden item');
  const text = JSON.stringify(scoped);
  assert.ok(!text.includes('Sécret'), 'no hidden title anywhere in the preview');
  assert.ok(!text.includes(hiddenDir), 'no hidden path anywhere in the preview');
});

test('POST /api/ytdlp/repull-metadata/preview: the ROUTE threads the requester visibility', async () => {
  const adminPv = await (await post('/api/ytdlp/repull-metadata/preview', undefined)).json();
  assert.strictEqual(adminPv.summary.totalItems, 2, 'admin preview covers the library');
  assert.ok(JSON.stringify(adminPv).includes(hiddenDir), 'admin preview shows the hidden path (machinery alive, no vacuous green)');

  const pv = await (await post('/api/ytdlp/repull-metadata/preview', restricted.cookie)).json();
  assert.strictEqual(pv.summary.totalItems, 1, 'restricted preview covers only visible items');
  const text = JSON.stringify(pv);
  assert.ok(!text.includes('Sécret'), 'no hidden title in the restricted preview');
  assert.ok(!text.includes(hiddenDir), 'no hidden path in the restricted preview');
});

test('POST /api/ytdlp/repull-metadata: the BATCH 202 counts exclude hidden items for a restricted member', async () => {
  // The 202 reports the blast radius up front (eligible/withSourceId) - that
  // report is itself a disclosure surface, and the enumeration it reflects is
  // the exact worklist the background batch will mutate/relocate. Counts
  // proving the hidden item absent here prove it absent from the batch too
  // (same enumerator call, same predicate, same returned items array).
  const run = await (await post('/api/ytdlp/repull-metadata', restricted.cookie)).json();
  assert.strictEqual(run.started, true);
  assert.strictEqual(run.eligible, 1, 'restricted batch enumerates ONLY the visible item');
  // Let the background batch settle before the next test grabs the latch.
  const activity = require('../../lib/ytdlp/activity');
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const snap = activity.getSnapshot().oneShots && activity.getSnapshot().oneShots['repull-metadata'];
    if (snap && (snap.state === 'done' || snap.state === 'error')) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  // The hidden FILE is untouched regardless of what the local pass did to the
  // visible one (ffprobe on a fixture file fails benignly).
  assert.strictEqual(fs.readFileSync(hidFile, 'utf8'), 'SECRET', 'hidden file bytes untouched by the restricted batch');
  assert.strictEqual(loadDatabase().metadata[getMediaId(hidFile)].filePath, hidFile, 'hidden record path untouched');
});

test('POST /api/ytdlp/repull-metadata: an ADMIN batch enumerates both (the guard is visibility, not breakage)', async () => {
  const run = await (await post('/api/ytdlp/repull-metadata', undefined)).json();
  // A second batch may still be settling from the previous test - accept the
  // honest 409 only if the first run is still live; otherwise demand the count.
  if (run.alreadyRunning === true) {
    assert.ok(true, 'previous batch still settling - the restricted count above already proved the axis');
  } else {
    assert.strictEqual(run.eligible, 2, 'admin batch enumerates the full library');
  }
});

// ---- v1.400.0 multi-select (M6): the ids-scoped batch keeps the visibility axis -----------------
//
// The bar's Reheat names ids; a restricted member who names a hidden id must not reheat it,
// and the response must not reveal that the id exists (it is simply not counted).

const activityMod = require('../../lib/ytdlp/activity');
async function waitReheatIdle() {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const snap = activityMod.getSnapshot().oneShots && activityMod.getSnapshot().oneShots['repull-metadata'];
    if (!snap || snap.state === 'done' || snap.state === 'error' || snap.state === 'cancelled') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  ytdlp.resetRepullMetadataStateForTests(); // the latch, once the loop has drained
}
const postIds = (ids, cookie) => fetch(`${base}/api/ytdlp/repull-metadata`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: JSON.stringify({ ids }),
});

test('v1.400.0 enumerateRepullableItems(onlyIds): narrows to the named ids AFTER the visibility predicate', () => {
  const db = loadDatabase();
  const config = ytdlp.parseYtdlpConfig();
  const pubId = getMediaId(pubFile);
  const hidId = getMediaId(hidFile);
  const onlyPublic = (item) => !item.filePath.startsWith(hiddenDir);
  // admin (no predicate): the named ids, nothing else
  const both = enumerateRepullableItems(db, config, undefined, new Set([pubId, hidId, 'unknown-id']));
  assert.deepStrictEqual(both.items.map((it) => it.mediaId).sort(), [pubId, hidId].sort());
  assert.strictEqual(both.eligible, 2);
  const one = enumerateRepullableItems(db, config, undefined, new Set([hidId]));
  assert.deepStrictEqual(one.items.map((it) => it.mediaId), [hidId], 'an admin naming only the hidden id gets exactly it');
  // restricted: a hidden id named explicitly never enters the worklist or the counts
  const scoped = enumerateRepullableItems(db, config, onlyPublic, new Set([pubId, hidId]));
  assert.deepStrictEqual(scoped.items.map((it) => it.mediaId), [pubId]);
  assert.strictEqual(scoped.eligible, 1);
  assert.strictEqual(scoped.withSourceId, 0);
  const hiddenOnly = enumerateRepullableItems(db, config, onlyPublic, new Set([hidId]));
  assert.deepStrictEqual(hiddenOnly.items, [], 'naming only the hidden id yields an EMPTY worklist');
  assert.strictEqual(hiddenOnly.eligible, 0);
  // a non-Set 4th argument is ignored (the unscoped library), never a crash
  assert.strictEqual(enumerateRepullableItems(db, config, undefined, [pubId]).items.length, 2);
  assert.strictEqual(enumerateRepullableItems(db, config, undefined, null).items.length, 2);
});

test('v1.400.0 POST /api/ytdlp/repull-metadata with ids: a restricted member naming the hidden id reheats only the visible one, and the response does not reveal the hidden id', async () => {
  await waitReheatIdle();
  const pubId = getMediaId(pubFile);
  const hidId = getMediaId(hidFile);
  const res = await postIds([pubId, hidId], restricted.cookie);
  assert.strictEqual(res.status, 202);
  const run = await res.json();
  assert.deepStrictEqual(run, { started: true, eligible: 1, ineligible: 0, withSourceId: 0, requested: 2 });
  const text = JSON.stringify(run);
  assert.ok(!text.includes(hidId) && !text.includes('Sécret') && !text.includes(hiddenDir), 'no hidden id, title or path in the response');
  await waitReheatIdle();
  assert.strictEqual(fs.readFileSync(hidFile, 'utf8'), 'SECRET', 'hidden file bytes untouched');
  assert.strictEqual(loadDatabase().metadata[hidId].filePath, hidFile, 'hidden record path untouched');
  assert.strictEqual(loadDatabase().metadata[hidId].metadataRepulledAt, undefined, 'the hidden item was never reheated');
});

test('v1.400.0 POST /api/ytdlp/repull-metadata with ids: naming ONLY a hidden id, or an unknown one, is a 202 with eligible 0 - indistinguishable from each other', async () => {
  await waitReheatIdle();
  const hidId = getMediaId(hidFile);
  const a = await (await postIds([hidId], restricted.cookie)).json();
  await waitReheatIdle();
  const b = await (await postIds(['0000000000000000000000000000dead'], restricted.cookie)).json();
  await waitReheatIdle();
  assert.deepStrictEqual(a, { started: true, eligible: 0, ineligible: 0, withSourceId: 0, requested: 1 });
  assert.deepStrictEqual(b, a, 'a hidden id and an unknown id answer identically (no existence oracle)');
  // the admin naming the hidden id reheats it (the guard is visibility, not breakage)
  const c = await (await postIds([hidId], undefined)).json();
  await waitReheatIdle();
  assert.strictEqual(c.eligible, 1, 'admin: the hidden id is a visible one');
  assert.strictEqual(c.requested, 1);
});

test('v1.400.0 POST /api/ytdlp/repull-metadata with ids: the write-RBAC gate runs first (a malformed body from a member without manage-subscriptions is a 403, not a 400)', async () => {
  await waitReheatIdle();
  const nobody = __mintTestSession({ username: 'reheatnobody', role: 'member' });
  userStore.setCanManageSubscriptions(nobody.user.id, false); // the admin route's own setter (lib/auth/routes.js)
  const r = await postIds('not-an-array', nobody.cookie);
  assert.strictEqual(r.status, 403, 'the capability gate precedes the body rule');
  const bad = await postIds('not-an-array', restricted.cookie);
  assert.strictEqual(bad.status, 400, 'a capable member sends a malformed body: 400');
});
