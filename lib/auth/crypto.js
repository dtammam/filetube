'use strict';

// ---- v1.43 auth primitives (pure, dependency-free) --------------------------
//
// Everything cryptographic in FileTube's auth lives here: scrypt password
// hashing with per-hash self-describing parameters, and HMAC-signed session
// tokens. Zero new dependencies (node:crypto only — the tasksync posture the
// exec plan locked). No fs, no db, no Express: server.js owns storage and
// transport; this module owns math. Every function is synchronous and
// side-effect-free except the two explicit random generators.
//
// Design source: docs/exec-plans/active/v1.42-multiuser-tranche.md §v1.43
// ("Sessions and middleware" + the password_hash format). Verified against
// the node:crypto docs for the SHIPPING Node versions (scryptSync options
// incl. maxmem; timingSafeEqual's equal-length requirement; base64url
// encoding) — the primary-source rule.

const crypto = require('node:crypto');
const { promisify } = require('node:util');

// ASYNC scrypt (design-delta CRITICAL-1): hashing runs on the libuv
// threadpool, NEVER the main thread. scryptSync on the unauthenticated,
// unthrottled login path froze the whole event loop cold (proven: ~80ms
// each, 20 back-to-back = 1.6s of total stall, every stream and API for
// every family member blocked) — a remote unauth DoS on an
// internet-reachable box. All password hashing is async from here on; the
// login route also gets an in-memory rate limiter (pulled forward from
// v1.44) as defense-in-depth.
const scryptAsync = promisify(crypto.scrypt);

// scrypt cost parameters. N=2^15 with r=8/p=1 targets tens-of-milliseconds
// per hash on Dean's box — expensive enough to matter against offline
// attack, cheap enough that login stays instant for a family instance.
// Recorded PER HASH (self-describing format below) so these can be raised
// later without breaking existing hashes: login verifies with the STORED
// params and reports needsRehash when they lag the current ones.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
// node:crypto enforces maxmem (default 32 MiB) >= 128 * N * r bytes used by
// scrypt itself; 128*32768*8 = 32 MiB exactly, so the default would throw
// borderline. Give explicit headroom.
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

// Stored format: scrypt$N$r$p$salt_b64$hash_b64  (all base64url, no padding
// ambiguity; '$' never appears in base64url output so split is unambiguous).
// ASYNC (CRITICAL-1) — returns a Promise; never blocks the event loop.
async function hashPassword(password, { N = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P } = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('hashPassword: a non-empty password string is required');
  }
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = await scryptAsync(password, salt, KEY_LEN, { N, r, p, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

// Parse a stored hash; null on any malformation (treated as verify-fail by
// the caller — a corrupt hash must never throw a login path into a 500).
function parseStoredHash(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null;
  // Cost ceiling (design-delta WARNING-2, tightened): a hash whose STORED
  // params demand excessive work is refused rather than computed — a
  // tampered users row must not become a compute-time lever (even on the
  // threadpool). The ceiling tracks what a legitimate params-UPGRADE path
  // will ever need: current cost is N=2^15/r=8/p=1, so 2^17/16/2 leaves two
  // doublings of headroom and nothing more. N must also be a power of two
  // (scrypt requires it); a non-power-of-two stored N is corruption.
  if (N > (1 << 17) || r > 16 || p > 2) return null;
  if ((N & (N - 1)) !== 0) return null; // scrypt: N must be a power of 2
  let salt, hash;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    hash = Buffer.from(parts[5], 'base64url');
  } catch {
    return null;
  }
  if (salt.length < 8 || hash.length < 32) return null;
  return { N, r, p, salt, hash };
}

// -> Promise<{ ok: boolean, needsRehash: boolean }>. ASYNC (CRITICAL-1) —
// never blocks the event loop. needsRehash is true when the stored params
// lag the CURRENT cost constants — the login route re-hashes with the fresh
// password it just verified (the plan's params-upgrade-on-login contract).
async function verifyPassword(password, stored) {
  const parsed = parseStoredHash(stored);
  if (!parsed || typeof password !== 'string' || password.length === 0) {
    return { ok: false, needsRehash: false };
  }
  let computed;
  try {
    computed = await scryptAsync(password, parsed.salt, parsed.hash.length, {
      N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    return { ok: false, needsRehash: false };
  }
  // timingSafeEqual THROWS on length mismatch; lengths are equal here by
  // construction (computed uses parsed.hash.length).
  const ok = crypto.timingSafeEqual(computed, parsed.hash);
  const needsRehash = ok && (parsed.N !== SCRYPT_N || parsed.r !== SCRYPT_R || parsed.p !== SCRYPT_P);
  return { ok, needsRehash };
}

// ---- session tokens ---------------------------------------------------------
//
// token = base64url(payloadJson) + '.' + base64url(hmacSha256(secret, payloadB64))
// payload = { uid, tv, iat, exp } (seconds). The HMAC covers the ENCODED
// payload so there is exactly one byte-string being signed — no
// canonicalization games. Verification is constant-time on the signature and
// hard-fails on any structural surprise.

const SESSION_SECONDS_DEFAULT = 30 * 24 * 60 * 60; // ~30 days (locked answer 3)

function signSession({ uid, tv }, secret, { nowSeconds = Math.floor(Date.now() / 1000), ttlSeconds = SESSION_SECONDS_DEFAULT } = {}) {
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('signSession: uid must be a positive integer');
  if (!Number.isInteger(tv) || tv < 0) throw new Error('signSession: tv must be a non-negative integer');
  assertUsableSecret(secret);
  const payload = Buffer.from(JSON.stringify({ uid, tv, iat: nowSeconds, exp: nowSeconds + ttlSeconds }), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

// -> { uid, tv, iat, exp } or null. NEVER throws on hostile input.
function verifySession(token, secret, { nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length === 0) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const macB64 = token.slice(dot + 1);
  // The mac MUST be exactly the canonical base64url sha256 digest: 43 chars
  // from the base64url alphabet, nothing else (design-delta SUGGESTION-7 +
  // its delta regression). This single charset+length gate does three jobs:
  //   (1) closes the padding malleability — `mac=`/`mac==` are rejected, so
  //       no non-canonical variant verifies as a second valid token string;
  //   (2) guarantees 43 ASCII BYTES, so timingSafeEqual below can never hit
  //       a byte-length mismatch and THROW — a crafted multibyte cookie
  //       (43 UTF-16 code units but >43 UTF-8 bytes) would otherwise pass a
  //       naive String.length gate and throw, breaking this function's
  //       no-throw-on-hostile-input contract on every request carrying it;
  //   (3) rejects any non-base64url junk up front.
  if (!/^[A-Za-z0-9_-]{43}$/.test(macB64)) return null;
  const expectedB64 = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(macB64), Buffer.from(expectedB64))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const { uid, tv, iat, exp } = payload;
  if (!Number.isInteger(uid) || uid <= 0) return null;
  if (!Number.isInteger(tv) || tv < 0) return null;
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null;
  if (exp <= nowSeconds) return null;
  return { uid, tv, iat, exp };
}

// ---- secrets ----------------------------------------------------------------

function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// Fail-closed boot validation (tasksync's posture, locked design): a short
// or obviously-placeholder secret must refuse to boot the auth layer rather
// than silently mint forgeable cookies.
const PLACEHOLDER_SECRETS = new Set(['changeme', 'change-me', 'secret', 'password', 'filetube', 'default', 'placeholder', 'xxx', 'test']);
function assertUsableSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('session secret unusable: need at least 32 characters (generate with FILETUBE_SESSION_SECRET or let the server mint DATA_DIR/session-secret)');
  }
  if (PLACEHOLDER_SECRETS.has(secret.trim().toLowerCase())) {
    throw new Error('session secret unusable: placeholder value refused');
  }
}

// Constant-time string compare for the Shortcut API token (intake delta #1).
// Hashes both sides first so timingSafeEqual's equal-length requirement is
// satisfied for ANY input lengths without leaking length via an early
// return.
function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = {
  hashPassword,
  verifyPassword,
  parseStoredHash,
  signSession,
  verifySession,
  generateSecret,
  assertUsableSecret,
  tokensEqual,
  SESSION_SECONDS_DEFAULT,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
};
