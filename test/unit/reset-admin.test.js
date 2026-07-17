'use strict';

// [UNIT] v1.43.1 A2 — scripts/reset-admin.js, the operator password-recovery
// tool. Each case runs the REAL script as a child process against its own
// temp DATA_DIR (the script's whole contract is cross-process behavior), then
// re-opens the adapter to verify what actually landed. Assertions verify
// against the real crypto (verifyPassword) — never string-compare hashes.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert');

const authCrypto = require('../../lib/auth/crypto');
const createUserStore = require('../../lib/auth/store');
const sqliteDb = require('../../lib/db/sqlite');

const SCRIPT = path.resolve(__dirname, '../../scripts/reset-admin.js');

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-reset-admin-'));
}

// Seed a DATA_DIR with a schema-initialized db (and optionally users), then
// CLOSE the adapter — the script must work against a cold file.
async function seed(dataDir, users = []) {
  const { adapter } = sqliteDb.openAdapter(dataDir, { log: () => {} });
  const store = createUserStore(adapter);
  const out = {};
  for (const u of users) {
    const passwordHash = await authCrypto.hashPassword(u.password);
    let created;
    if (store.countUsers() === 0 && u.role === 'admin') {
      created = store.createFirstAdmin({ username: u.username, displayName: u.username, passwordHash }, null, new Date().toISOString());
    } else {
      created = store.createUser({ username: u.username, displayName: u.username, passwordHash, role: u.role }, new Date().toISOString());
    }
    if (u.disabled) store.setDisabled(created.id, true);
    out[u.username] = store.getByUsername(u.username);
  }
  adapter.close();
  return out;
}

function inspect(dataDir, username) {
  const { adapter } = sqliteDb.openAdapter(dataDir, { log: () => {} });
  const store = createUserStore(adapter);
  const user = store.getByUsername(username);
  const hash = user ? store.getPasswordHash(user.id) : null;
  const count = store.countUsers();
  adapter.close();
  return { user, hash, count };
}

// Run the script; password via env unless stdinInput is given (piped-stdin
// path). Resolves { code, stdout, stderr } — never rejects on non-zero exit.
function runScript(dataDir, args, { password, stdinInput } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, DATA_DIR: dataDir };
    delete env.FILETUBE_NEW_PASSWORD;
    if (password !== undefined) env.FILETUBE_NEW_PASSWORD = password;
    const child = execFile(process.execPath, [SCRIPT, ...args], { env }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
    if (stdinInput !== undefined) child.stdin.end(stdinInput);
    else child.stdin.end();
  });
}

test('zero users: creates <username> as an enabled admin (repair path), password verifies via the real crypto', async () => {
  const dir = tmpDataDir();
  await seed(dir, []); // schema exists, users table empty
  const res = await runScript(dir, ['dean'], { password: 'brand-new-pass' });
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
  const { user, hash, count } = inspect(dir, 'dean');
  assert.equal(count, 1);
  assert.equal(user.role, 'admin');
  assert.equal(user.disabled, false);
  assert.ok((await authCrypto.verifyPassword('brand-new-pass', hash)).ok);
  assert.match(res.stdout, /does NOT adopt pre-auth/i, 'the no-adoption caveat is stated to the operator');
  // QA delta nit: the create path mints a fresh tv=0 row — nothing was
  // bumped, no sessions existed, so the invalidation line must NOT print
  // (a tool that lies about what it revoked is worse than one that says
  // nothing).
  assert.doesNotMatch(res.stdout, /session.*INVALID/i, 'no session-invalidation claim on a fresh create');
});

test('existing user: resets the password AND bumps token_version (instant revocation contract)', async () => {
  const dir = tmpDataDir();
  const seeded = await seed(dir, [{ username: 'dean', role: 'admin', password: 'old-password' }]);
  const before = seeded.dean.tokenVersion;
  const res = await runScript(dir, ['dean'], { password: 'new-password-1' });
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
  const { user, hash } = inspect(dir, 'dean');
  assert.ok((await authCrypto.verifyPassword('new-password-1', hash)).ok, 'new password verifies');
  assert.equal((await authCrypto.verifyPassword('old-password', hash)).ok, false, 'old password is dead');
  assert.equal(user.tokenVersion, before + 1, 'token_version bumped -> every live session invalidated');
  assert.match(res.stdout, /session.*INVALID/i);
});

test('piped-stdin password path works (no env var, no argv)', async () => {
  const dir = tmpDataDir();
  await seed(dir, [{ username: 'dean', role: 'admin', password: 'old-password' }]);
  const res = await runScript(dir, ['dean'], { stdinInput: 'piped-password-9\n' });
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
  const { hash } = inspect(dir, 'dean');
  assert.ok((await authCrypto.verifyPassword('piped-password-9', hash)).ok);
});

test('a member reset keeps role=member — recovery never promotes', async () => {
  const dir = tmpDataDir();
  await seed(dir, [
    { username: 'dean', role: 'admin', password: 'admin-pass-1' },
    { username: 'kid', role: 'member', password: 'kid-pass-1' },
  ]);
  const res = await runScript(dir, ['kid'], { password: 'kid-pass-2' });
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
  const { user, hash } = inspect(dir, 'kid');
  assert.equal(user.role, 'member', 'role untouched');
  assert.ok((await authCrypto.verifyPassword('kid-pass-2', hash)).ok);
  assert.match(res.stdout, /never promotes/i);
});

test('disabled user: refused without --enable (nothing changes), reset + re-enabled WITH it', async () => {
  const dir = tmpDataDir();
  await seed(dir, [
    { username: 'dean', role: 'admin', password: 'admin-pass-1' },
    { username: 'banned', role: 'member', password: 'banned-pass-1', disabled: true },
  ]);
  const refused = await runScript(dir, ['banned'], { password: 'banned-pass-2' });
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /--enable/);
  let state = inspect(dir, 'banned');
  assert.equal(state.user.disabled, true, 'still disabled');
  assert.ok((await authCrypto.verifyPassword('banned-pass-1', state.hash)).ok, 'password untouched on refusal');

  const enabled = await runScript(dir, ['banned', '--enable'], { password: 'banned-pass-2' });
  assert.equal(enabled.code, 0, `stderr: ${enabled.stderr}`);
  state = inspect(dir, 'banned');
  assert.equal(state.user.disabled, false);
  assert.ok((await authCrypto.verifyPassword('banned-pass-2', state.hash)).ok);
});

test('unknown username on a POPULATED instance is refused — creating extra accounts is not recovery', async () => {
  const dir = tmpDataDir();
  await seed(dir, [{ username: 'dean', role: 'admin', password: 'admin-pass-1' }]);
  const res = await runScript(dir, ['stranger'], { password: 'whatever-pass' });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /no user named 'stranger'/);
  assert.equal(inspect(dir, 'stranger').user, null);
  assert.equal(inspect(dir, 'dean').count, 1);
});

test('wrong DATA_DIR (no database files) is refused LOUDLY and creates nothing', async () => {
  const dir = tmpDataDir(); // empty: no filetube.db, no db.json
  const res = await runScript(dir, ['dean'], { password: 'whatever-pass' });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /no FileTube database found/);
  assert.equal(fs.existsSync(path.join(dir, 'filetube.db')), false, 'must not mint a fresh empty db in the wrong place');
});

test('short password is refused, nothing changes', async () => {
  const dir = tmpDataDir();
  const seeded = await seed(dir, [{ username: 'dean', role: 'admin', password: 'old-password' }]);
  const res = await runScript(dir, ['dean'], { password: 'short' });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /at least 8 characters/);
  const { user, hash } = inspect(dir, 'dean');
  assert.ok((await authCrypto.verifyPassword('old-password', hash)).ok, 'old password still works');
  assert.equal(user.tokenVersion, seeded.dean.tokenVersion, 'no tv bump on refusal');
});

test('invalid flag / missing username exit 2 with usage', async () => {
  const dir = tmpDataDir();
  await seed(dir, []);
  assert.equal((await runScript(dir, [], { password: 'whatever-pass' })).code, 2);
  assert.equal((await runScript(dir, ['dean', '--force'], { password: 'whatever-pass' })).code, 2);
});
