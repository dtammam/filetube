'use strict';

// [UNIT] v1.387.0 offline playback, plan D1 - the per-device token store
// (lib/auth/devices.js) against a real SQLite adapter (schema v37), plus the
// user-store halves it leans on: `deviceEpoch` on the row, changePassword (bumps
// the epoch) vs updatePassword (the login re-hash: does NOT), bumpDeviceEpoch,
// the user-delete cascade, the test reset, and the v36 -> v37 migration on an
// existing database.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME, SCHEMA_VERSION } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');
const devicesLib = require('../../lib/auth/devices');
const authCrypto = require('../../lib/auth/crypto');

let dir, adapter, users, devices, clock;
const ISO = '2026-10-11T12:00:00.000Z';
const T0 = Date.parse(ISO);
const DAY = 24 * 60 * 60 * 1000;

function mkStore(secretSeq) {
  let n = 0;
  const generateSecret = secretSeq ? () => secretSeq[n++ % secretSeq.length] : authCrypto.generateSecret;
  return devicesLib.createDeviceStore(adapter, { generateSecret, tokensEqual: authCrypto.tokensEqual }, { nowMs: () => clock });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-devices-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  users = createUserStore(adapter);
  clock = T0;
  devices = mkStore();
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function admin() {
  return users.createFirstAdmin({ username: 'dean', displayName: 'Dean', passwordHash: 'scrypt$32768$8$1$aaaa$bbbb' }, null, ISO);
}
function member(name = 'kid') {
  return users.createUser({ username: name, displayName: name, passwordHash: 'scrypt$32768$8$1$aaaa$bbbb' }, ISO);
}

test('schema v37: device_tokens exists, users.device_epoch defaults to 0, SCHEMA_VERSION is 37', () => {
  assert.strictEqual(SCHEMA_VERSION, 37);
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, 37);
  const cols = adapter.sql.prepare('PRAGMA table_info(device_tokens)').all().map((c) => c.name);
  assert.deepStrictEqual(cols, ['id', 'user_id', 'token_hash', 'name', 'platform', 'epoch', 'created_at', 'last_used_at']);
  const a = admin();
  assert.strictEqual(a.deviceEpoch, 0, 'a fresh user starts at epoch 0');
});

test('migration: a v36 database (no device_epoch column, no table) gains both and stamps 37; a re-run is a no-op', () => {
  // Rewind the fresh db to look like v36 through the adapter's own handle (the source lock keeps
  // node:sqlite to lib/db/sqlite.js): drop the table and the column, stamp 36, reopen.
  adapter.sql.exec('DROP TABLE device_tokens');
  adapter.sql.exec('ALTER TABLE users DROP COLUMN device_epoch');
  adapter.sql.exec('PRAGMA user_version = 36');
  adapter.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, 37);
  assert.ok(adapter.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'device_tokens'").get());
  assert.ok(adapter.sql.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'device_epoch'));
  // Victim shape: the column present but the version not stamped (a crash between the two) heals too.
  adapter.sql.exec('PRAGMA user_version = 36');
  adapter.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, 37, 'the presence-checked ALTER lets the block re-run');
});

test('issue: the token is ftd_ + the secret, only its sha256 is stored, lookup finds the row by the token and never by the hash', () => {
  const a = admin();
  devices = mkStore(['SECRET_ONE']);
  const issued = devices.issue({ userId: a.id, name: "Dean's iPhone", platform: 'ios', epoch: a.deviceEpoch }, ISO);
  assert.strictEqual(issued.token, 'ftd_SECRET_ONE');
  assert.deepStrictEqual(Object.keys(issued).sort(), ['createdAt', 'id', 'name', 'platform', 'token']);
  const raw = adapter.sql.prepare('SELECT * FROM device_tokens').all();
  assert.strictEqual(raw.length, 1);
  assert.strictEqual(raw[0].token_hash, devicesLib.hashToken('ftd_SECRET_ONE'));
  assert.ok(!JSON.stringify(raw).includes('ftd_'), 'the raw token is nowhere in the table');
  const row = devices.lookup('ftd_SECRET_ONE');
  assert.strictEqual(row.id, issued.id);
  assert.strictEqual(row.userId, a.id);
  assert.strictEqual(row.epoch, 0);
  assert.strictEqual(row.lastUsedAt, null);
  assert.strictEqual(devices.lookup(raw[0].token_hash), null, 'presenting the stored hash is not a token');
  assert.strictEqual(devices.lookup('ftd_SECRET_TWO'), null);
  assert.strictEqual(devices.lookup('SECRET_ONE'), null, 'without the prefix it is not a device token');
  assert.strictEqual(devices.lookup(null), null);
});

test('issue: validation - name 1..64 (no NUL), platform ios only, epoch an integer', () => {
  const a = admin();
  assert.throws(() => devices.issue({ userId: a.id, name: '', platform: 'ios', epoch: 0 }, ISO), /invalid name/);
  assert.throws(() => devices.issue({ userId: a.id, name: 'x'.repeat(65), platform: 'ios', epoch: 0 }, ISO), /invalid name/);
  assert.throws(() => devices.issue({ userId: a.id, name: 'a\u0000b', platform: 'ios', epoch: 0 }, ISO), /invalid name/);
  assert.throws(() => devices.issue({ userId: a.id, name: 'ok', platform: 'android', epoch: 0 }, ISO), /invalid platform/);
  assert.throws(() => devices.issue({ userId: a.id, name: 'ok', platform: 'ios', epoch: 1.5 }, ISO), /invalid epoch/);
  assert.ok(devices.validName('x'.repeat(64)) && !devices.validName('x'.repeat(65)));
  assert.ok(devices.validPlatform('ios') && !devices.validPlatform('IOS'));
});

test('cap: at most 20 live tokens per user; out-of-date-epoch and expired rows do not count and are pruned on issue', () => {
  const a = admin();
  for (let i = 0; i < 20; i++) assert.ok(devices.issue({ userId: a.id, name: 'd' + i, platform: 'ios', epoch: 0 }, ISO));
  assert.strictEqual(devices.issue({ userId: a.id, name: 'one more', platform: 'ios', epoch: 0 }, ISO), null, 'the 21st is refused');
  assert.strictEqual(devices.countAll(), 20);
  // A "Remove all" (epoch bump) makes every row stale: the next issue prunes them all.
  users.bumpDeviceEpoch(a.id);
  const fresh = users.getById(a.id);
  assert.strictEqual(fresh.deviceEpoch, 1);
  assert.ok(devices.issue({ userId: a.id, name: 'after', platform: 'ios', epoch: fresh.deviceEpoch }, ISO));
  assert.strictEqual(devices.countAll(), 1, 'the 20 stale rows were pruned');
  // Expired rows (180 days unused) are pruned the same way.
  for (let i = 0; i < 19; i++) assert.ok(devices.issue({ userId: a.id, name: 'd' + i, platform: 'ios', epoch: 1 }, ISO));
  assert.strictEqual(devices.issue({ userId: a.id, name: 'full', platform: 'ios', epoch: 1 }, ISO), null);
  const later = new Date(T0 + 181 * DAY).toISOString();
  assert.ok(devices.issue({ userId: a.id, name: 'much later', platform: 'ios', epoch: 1 }, later), 'every earlier row is 181 days unused');
  assert.strictEqual(devices.countAll(), 1);
});

test('expiry: 180 days from last_used_at (or created_at when never used); touch slides it', () => {
  const a = admin();
  const issued = devices.issue({ userId: a.id, name: 'p', platform: 'ios', epoch: 0 }, ISO);
  const row = () => devices.lookup(issued.token);
  assert.strictEqual(devicesLib.isExpired(row(), T0 + 180 * DAY), false, 'exactly 180 days is still alive');
  assert.strictEqual(devicesLib.isExpired(row(), T0 + 180 * DAY + 1), true);
  devices.touch(issued.id, new Date(T0 + 100 * DAY).toISOString());
  assert.strictEqual(row().lastUsedAt, new Date(T0 + 100 * DAY).toISOString());
  assert.strictEqual(devicesLib.isExpired(row(), T0 + 180 * DAY + 1), false, 'slid by the use');
  assert.strictEqual(devicesLib.isExpired(row(), T0 + 280 * DAY + 1), true);
  assert.strictEqual(devicesLib.isExpired({ createdAt: 'garbage', lastUsedAt: null }, T0), true, 'an unparsable stamp is expired (fail closed)');
});

test('listForUser: live rows only (current epoch, not expired), never the hash; an expired row is pruned as it is listed', () => {
  const a = admin();
  const k = member();
  devices.issue({ userId: a.id, name: 'mine', platform: 'ios', epoch: 0 }, ISO);
  devices.issue({ userId: k.id, name: 'kids', platform: 'ios', epoch: 0 }, ISO);
  const old = devices.issue({ userId: a.id, name: 'old', platform: 'ios', epoch: 0 }, new Date(T0 - 200 * DAY).toISOString());
  const list = devices.listForUser(a.id);
  assert.deepStrictEqual(list.map((d) => d.name), ['mine'], 'the other user\'s and the expired row are absent');
  assert.deepStrictEqual(Object.keys(list[0]).sort(), ['createdAt', 'id', 'lastUsedAt', 'name', 'platform']);
  assert.strictEqual(devices.byId(old.id), null, 'the expired row was pruned');
  users.bumpDeviceEpoch(a.id);
  assert.deepStrictEqual(devices.listForUser(a.id), [], 'after a Remove all nothing is live');
  assert.deepStrictEqual(devices.listForUser(k.id).map((d) => d.name), ['kids'], 'another user is untouched');
  assert.deepStrictEqual(devices.listForUser(999), []);
});

test('remove: only the user\'s own row; removeAllForUser drops every row of that user and no other', () => {
  const a = admin();
  const k = member();
  const mine = devices.issue({ userId: a.id, name: 'mine', platform: 'ios', epoch: 0 }, ISO);
  const kids = devices.issue({ userId: k.id, name: 'kids', platform: 'ios', epoch: 0 }, ISO);
  assert.strictEqual(devices.remove(a.id, kids.id), false, 'not mine');
  assert.strictEqual(devices.remove(a.id, mine.id), true);
  assert.strictEqual(devices.remove(a.id, mine.id), false, 'already gone');
  assert.strictEqual(devices.lookup(mine.token), null);
  assert.ok(devices.lookup(kids.token));
  devices.issue({ userId: k.id, name: 'kids2', platform: 'ios', epoch: 0 }, ISO);
  devices.issue({ userId: a.id, name: 'mine2', platform: 'ios', epoch: 0 }, ISO);
  assert.strictEqual(devices.removeAllForUser(k.id), 2);
  assert.strictEqual(devices.countAll(), 1, 'the admin\'s row stays');
});

test('changePassword bumps device_epoch (and token_version); updatePassword (the login re-hash) bumps ONLY token_version', () => {
  const a = admin();
  users.updatePassword(a.id, 'scrypt$32768$8$1$cccc$dddd');
  let u = users.getById(a.id);
  assert.strictEqual(u.tokenVersion, 1);
  assert.strictEqual(u.deviceEpoch, 0, 'the re-hash never unpairs a phone');
  users.changePassword(a.id, 'scrypt$32768$8$1$eeee$ffff');
  u = users.getById(a.id);
  assert.strictEqual(u.tokenVersion, 2);
  assert.strictEqual(u.deviceEpoch, 1, 'a password change unpairs');
  assert.strictEqual(users.getPasswordHash(a.id), 'scrypt$32768$8$1$eeee$ffff');
  users.bumpDeviceEpoch(a.id);
  assert.strictEqual(users.getById(a.id).deviceEpoch, 2);
  assert.strictEqual(users.getById(a.id).tokenVersion, 2, 'Remove all devices leaves sessions alone');
  // setDisabled does not touch the epoch (re-enabling restores the phones: disclosed).
  users.setDisabled(a.id, true);
  users.setDisabled(a.id, false);
  assert.strictEqual(users.getById(a.id).deviceEpoch, 2);
});

test('cascade: deleting the user drops its rows; the test reset wipes the table and resets every epoch; the backup export carries neither', () => {
  const a = admin();
  const k = member();
  devices.issue({ userId: k.id, name: 'kids', platform: 'ios', epoch: 0 }, ISO);
  devices.issue({ userId: a.id, name: 'mine', platform: 'ios', epoch: 0 }, ISO);
  users.deleteUser(k.id);
  assert.strictEqual(devices.countAll(), 1, 'the kid\'s row went with the account');
  users.bumpDeviceEpoch(a.id);
  const exported = JSON.stringify(users.exportUsersForBackup());
  assert.ok(!/token_hash|tokenHash|deviceEpoch|device_epoch|ftd_|device_tokens/.test(exported), 'no device data in the per-user bundle half');
  users.__clearUserStateForTests();
  assert.strictEqual(devices.countAll(), 0);
  assert.strictEqual(users.getById(a.id).deviceEpoch, 0);
});

test('live registry: track / cutDevice / cutUser destroy the open responses and the close listener untracks', () => {
  const a = admin();
  const k = member();
  const d1 = devices.issue({ userId: a.id, name: 'a1', platform: 'ios', epoch: 0 }, ISO);
  const d2 = devices.issue({ userId: a.id, name: 'a2', platform: 'ios', epoch: 0 }, ISO);
  const d3 = devices.issue({ userId: k.id, name: 'k1', platform: 'ios', epoch: 0 }, ISO);
  const { EventEmitter } = require('node:events');
  const mkRes = () => { const r = new EventEmitter(); r.destroyed = 0; r.destroy = () => { r.destroyed += 1; r.emit('close'); }; return r; };
  const r1 = mkRes(); const r2 = mkRes(); const r3 = mkRes(); const r4 = mkRes();
  devices.track(d1.id, a.id, r1);
  devices.track(d1.id, a.id, r2);
  devices.track(d2.id, a.id, r3);
  devices.track(d3.id, k.id, r4);
  assert.strictEqual(devices.openResponseCount(d1.id), 2);
  r2.emit('close'); // a normal finish untracks
  assert.strictEqual(devices.openResponseCount(d1.id), 1);
  assert.strictEqual(devices.remove(a.id, d1.id), true);
  assert.strictEqual(r1.destroyed, 1, 'a revoke ends the open response');
  assert.strictEqual(r2.destroyed, 0, 'an already-closed one is not touched');
  assert.strictEqual(devices.openResponseCount(d1.id), 0);
  assert.strictEqual(devices.cutUser(a.id), 1, 'd2\'s response');
  assert.strictEqual(r3.destroyed, 1);
  assert.strictEqual(r4.destroyed, 0, 'the kid\'s phone is another user');
  assert.strictEqual(devices.removeAllForUser(k.id), 1);
  assert.strictEqual(r4.destroyed, 1);
  assert.strictEqual(devices.cutDevice(12345), 0);
});

test('revoked memory (gate r1 security-brief W1): a token whose row was deleted by remove, Remove all, expiry (list prune / issue prune) or the gate\'s prune is "recently revoked" for 24 hours, never before, never for a live or never-issued token; the memory is bounded', () => {
  const a = admin();
  devices = mkStore(['A', 'B', 'C', 'D', 'E', 'F']);
  const tA = devices.issue({ userId: a.id, name: 'A', platform: 'ios', epoch: 0 }, ISO);
  assert.strictEqual(devices.wasRevokedRecently(tA.token), false, 'live: not revoked');
  assert.strictEqual(devices.wasRevokedRecently('ftd_NEVER'), false, 'never issued: unknown, not revoked (it counts)');
  assert.strictEqual(devices.wasRevokedRecently(null), false);
  assert.strictEqual(devices.remove(a.id, tA.id), true);
  assert.strictEqual(devices.lookup(tA.token), null, 'the row is gone');
  assert.strictEqual(devices.wasRevokedRecently(tA.token), true, 'remove: remembered');
  // Remove all.
  const tB = devices.issue({ userId: a.id, name: 'B', platform: 'ios', epoch: 0 }, ISO);
  const tC = devices.issue({ userId: a.id, name: 'C', platform: 'ios', epoch: 0 }, ISO);
  assert.strictEqual(devices.removeAllForUser(a.id), 2);
  assert.strictEqual(devices.wasRevokedRecently(tB.token), true); assert.strictEqual(devices.wasRevokedRecently(tC.token), true);
  // The gate's prune (an expired row found at the gate).
  const tD = devices.issue({ userId: a.id, name: 'D', platform: 'ios', epoch: 0 }, ISO);
  devices.prune(tD.id);
  assert.strictEqual(devices.wasRevokedRecently(tD.token), true, 'prune: remembered');
  // Expiry found by the list (181 days unused).
  const tE = devices.issue({ userId: a.id, name: 'E', platform: 'ios', epoch: 0 }, ISO);
  clock = T0 + 181 * DAY;
  assert.deepStrictEqual(devices.listForUser(a.id), [], 'the list pruned it');
  assert.strictEqual(devices.wasRevokedRecently(tE.token), true, 'expired via the list: remembered');
  // 24 hours later the memory lets go (the limiter's default posture returns).
  clock = T0 + 181 * DAY + 24 * 60 * 60 * 1000 + 1;
  assert.strictEqual(devices.wasRevokedRecently(tE.token), false, 'forgotten after 24 h');
  assert.strictEqual(devices.wasRevokedRecently(tA.token), false);
  // Bounded: the constants are exported and the size never passes the cap.
  assert.strictEqual(devicesLib.REVOKED_MEMORY_MS, 24 * 60 * 60 * 1000);
  assert.strictEqual(devicesLib.REVOKED_MEMORY_MAX, 5000);
  assert.ok(devices.revokedMemorySize() <= devicesLib.REVOKED_MEMORY_MAX);
});
