#!/usr/bin/env node
'use strict';

// scripts/reset-admin.js — operator-run admin password recovery (v1.43.1 A2).
//
// FileTube deliberately ships NO in-app password recovery (no email, no
// security questions): recovery authority is "whoever can run a process with
// access to DATA_DIR", i.e. the operator of the box/container. This script is
// that authority's tool — and it is the ONLY recovery lever (Dean's intake
// call: no env lever; a permanently-set FILETUBE_RESET_ADMIN would be a
// standing backdoor, the exact anti-pattern recovery must not become).
//
// Contract (exec plan v1.43.1 §A2):
//   - Reuses the REAL auth stack end-to-end: lib/auth/crypto.js for the
//     scrypt hash, lib/db/sqlite.js openAdapter for the connection,
//     lib/auth/store.js for the SQL. No parallel implementation to drift.
//   - Existing user  -> updatePassword, which bumps token_version in the
//     same UPDATE — every live session for that user dies on the server's
//     next per-request tv re-check. WAL journaling makes the cross-process
//     write visible to a RUNNING server immediately; no restart needed.
//   - Zero users     -> creates <username> as an enabled admin via the same
//     count-guarded insert /welcome uses, so it can never race a concurrent
//     /welcome setup into two "first" admins. (Repair path — e.g. an empty
//     users table after a bad restore. NOTE: unlike /welcome, this does NOT
//     adopt the pre-auth global progress/likes/pins into the new account —
//     recovery is not first-boot; the frozen pre-auth record stays frozen.)
//   - Existing NON-admin -> password reset only, role untouched. A recovery
//     tool must never double as a privilege-escalation lever; promoting a
//     member is admin UI work, done while signed in as an admin.
//   - Disabled user  -> refused unless --enable is passed explicitly.
//     Recovery must not silently un-ban an account someone disabled on
//     purpose.
//
// Password input (never on argv — argv leaks via shell history and `ps`):
//   1. FILETUBE_NEW_PASSWORD env var, for non-interactive use
//      (docker exec -e FILETUBE_NEW_PASSWORD=... — transient, not composed
//      into any file), else
//   2. hidden interactive prompt (typed twice), else
//   3. a single line read from piped stdin.
//
// Usage:
//   node scripts/reset-admin.js <username> [--enable]

const fs = require('node:fs');
const path = require('node:path');

const authCrypto = require('../lib/auth/crypto');
const createUserStore = require('../lib/auth/store');
const sqliteDb = require('../lib/db/sqlite');

// The API's own floor, shared from the auth-crypto module (QA gate
// suggestion) — the recovery tool can never drift weaker or stricter than
// the live password routes.
const { MIN_PASSWORD_LENGTH } = authCrypto;

function usageExit(msg) {
  if (msg) console.error(`reset-admin: ${msg}\n`);
  console.error('Usage: node scripts/reset-admin.js <username> [--enable]');
  console.error('  Resets <username>\'s password (creating them as the first admin if NO users exist).');
  console.error('  --enable   also re-enable the account if it was disabled');
  console.error('  Password is read from $FILETUBE_NEW_PASSWORD, an interactive prompt, or piped stdin.');
  process.exit(2);
}

// DATA_DIR resolution, byte-for-byte the server's rule (server.js): explicit
// env wins; the Docker volume path if it exists; else the REPO ROOT (this
// file lives in scripts/, so the fallback is '..' — server.js's __dirname).
function resolveDataDir(env) {
  if (env.DATA_DIR) return path.resolve(env.DATA_DIR);
  if (fs.existsSync('/app/data')) return '/app/data';
  return path.resolve(__dirname, '..');
}

// Hidden-input prompt (raw mode, echoes nothing). Falls back to plain
// line-read when stdin is not a TTY (piped input).
function promptHidden(label) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stderr.write(label);
    if (!stdin.isTTY) {
      // Piped: consume one line. (No echo problem — nothing is a terminal.)
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { data += c; });
      stdin.on('end', () => {
        process.stderr.write('\n');
        resolve(data.split(/\r?\n/)[0]);
      });
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    let buf = '';
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '\u0003') { // Ctrl-C in raw mode reaches us as a byte
          stdin.setRawMode(false);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch; // drop other control chars
      }
    };
    stdin.on('data', onData);
  });
}

async function resolveNewPassword() {
  if (typeof process.env.FILETUBE_NEW_PASSWORD === 'string' && process.env.FILETUBE_NEW_PASSWORD.length > 0) {
    return process.env.FILETUBE_NEW_PASSWORD;
  }
  const first = await promptHidden('New password: ');
  if (process.stdin.isTTY) {
    const second = await promptHidden('Repeat new password: ');
    if (first !== second) {
      console.error('reset-admin: passwords did not match; nothing changed.');
      process.exit(1);
    }
  }
  return first;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));
  for (const f of flags) {
    if (f !== '--enable') usageExit(`unknown flag '${f}'`);
  }
  if (positional.length !== 1) usageExit(positional.length ? 'exactly one <username> expected' : undefined);
  const username = positional[0];

  const dataDir = resolveDataDir(process.env);
  // Data-safety guard: a wrong DATA_DIR must fail loudly, not mint a fresh
  // empty database and "successfully" create an admin nobody's instance will
  // ever see. openAdapter() creates-or-imports on open, so probe FIRST.
  const dbPath = path.join(dataDir, 'filetube.db');
  const jsonPath = path.join(dataDir, 'db.json');
  if (!fs.existsSync(dbPath) && !fs.existsSync(jsonPath)) {
    console.error(`reset-admin: no FileTube database found in '${dataDir}' (no filetube.db, no db.json).`);
    console.error('Set DATA_DIR to the directory your server actually uses and re-run.');
    process.exit(1);
  }

  const { adapter } = sqliteDb.openAdapter(dataDir, { log: (line) => console.error(line) });
  try {
    const store = createUserStore(adapter);
    if (!store.validateUsername(username)) {
      console.error(`reset-admin: invalid username '${username}' (1-64 chars: letters, digits, . _ -).`);
      process.exit(1);
    }

    const existing = store.getByUsername(username);
    const userCount = store.countUsers();
    if (!existing && userCount > 0) {
      console.error(`reset-admin: no user named '${username}' exists on this instance; nothing changed.`);
      console.error('(Creating a NEW account on a populated instance is admin-UI work, not recovery.)');
      process.exit(1);
    }
    if (existing && existing.disabled && !flags.has('--enable')) {
      console.error(`reset-admin: '${existing.username}' is DISABLED. Re-run with --enable if you also mean to re-enable the account; nothing changed.`);
      process.exit(1);
    }

    const password = await resolveNewPassword();
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      console.error(`reset-admin: use a password of at least ${MIN_PASSWORD_LENGTH} characters; nothing changed.`);
      process.exit(1);
    }

    const passwordHash = await authCrypto.hashPassword(password);
    const nowIso = new Date().toISOString();

    if (!existing) {
      // Zero users: bootstrap/repair. The count-guarded insert is the same
      // statement class /welcome uses — if a /welcome setup lands first (the
      // server can be running), the guard fires and we report it honestly.
      const created = store.createFirstAdmin({ username, displayName: username, passwordHash }, null, nowIso);
      if (!created) {
        console.error('reset-admin: a user was created concurrently (someone completed /welcome?); nothing changed. Re-run to reset that account instead.');
        process.exit(1);
      }
      console.log(`Created '${created.username}' as an enabled ADMIN (id ${created.id}) — the instance was user-less.`);
      console.log('Note: unlike first-boot /welcome, recovery does NOT adopt pre-auth watch history into the new account.');
      // No session-invalidation line here (adversarial-seat nit): a fresh row
      // starts at tv=0 — nothing was bumped and no sessions existed to kill.
    } else {
      store.updatePassword(existing.id, passwordHash);
      if (existing.disabled && flags.has('--enable')) {
        store.setDisabled(existing.id, false);
        console.log(`Re-enabled '${existing.username}'.`);
      }
      console.log(`Password reset for '${existing.username}' (id ${existing.id}, role: ${existing.role}).`);
      if (existing.role !== 'admin') {
        console.log('Role left untouched — this tool never promotes. Promote via the admin Users UI if needed.');
      }
      console.log('Every existing session for this user is now INVALID (token_version bumped). A running server picks this up on its next request — no restart needed.');
    }
  } catch (err) {
    if (err && /SQLITE_BUSY|database is locked/i.test(String(err.message))) {
      console.error('reset-admin: the database is locked (non-WAL journal + a busy server?). Stop the FileTube server and re-run.');
      process.exit(1);
    }
    throw err;
  } finally {
    try { adapter.close(); } catch { /* already closed / close failure is non-fatal here */ }
  }
}

main().catch((err) => {
  console.error(`reset-admin: ${err.message}`);
  process.exit(1);
});
