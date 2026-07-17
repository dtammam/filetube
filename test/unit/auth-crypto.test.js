'use strict';

// [UNIT] v1.43 — the pure auth primitives (lib/auth/crypto.js): scrypt
// hashing with self-describing per-hash params + params-upgrade-on-login,
// HMAC session tokens with instant-revocation fields, secret validation,
// and the Shortcut token compare. Pure module — no server boot needed.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  hashPassword, verifyPassword, parseStoredHash,
  signSession, verifySession,
  generateSecret, assertUsableSecret, tokensEqual,
  SCRYPT_N,
} = require('../../lib/auth/crypto');

// ---- passwords --------------------------------------------------------------

test('hashPassword/verifyPassword: async round-trip; wrong password fails; format is self-describing', async () => {
  const stored = await hashPassword('correct horse battery staple');
  assert.ok(stored instanceof Promise === false && typeof stored === 'string', 'awaited to a string (async, off the event loop)');
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/, 'scrypt$N$r$p$salt$hash, base64url');
  assert.deepEqual(await verifyPassword('correct horse battery staple', stored), { ok: true, needsRehash: false });
  assert.deepEqual(await verifyPassword('wrong password', stored), { ok: false, needsRehash: false });
  const parsed = parseStoredHash(stored);
  assert.equal(parsed.N, SCRYPT_N, 'current cost params recorded in the hash');
});

test('CRITICAL-1: hashing does NOT block the event loop (async scrypt on the libuv threadpool)', async () => {
  // The design-delta CRITICAL: scryptSync on the unthrottled login path
  // froze the loop. Prove the fix — a heartbeat interval keeps firing while
  // several hashes run concurrently. (Sync scrypt would let ZERO ticks fire
  // during the burst; the repro that found the bug measured exactly that.)
  let ticks = 0;
  const beat = setInterval(() => { ticks++; }, 5);
  try {
    await Promise.all(Array.from({ length: 8 }, () => hashPassword('load-test-password')));
  } finally {
    clearInterval(beat);
  }
  assert.ok(ticks > 0, `the event loop kept ticking during concurrent hashing (${ticks} beats) — not frozen`);
});

test('verifyPassword: a hash stored with WEAKER params verifies AND reports needsRehash (params-upgrade-on-login)', async () => {
  const legacy = await hashPassword('family-password', { N: 16384 });
  const res = await verifyPassword('family-password', legacy);
  assert.equal(res.ok, true, 'old-cost hash still verifies');
  assert.equal(res.needsRehash, true, 'and asks to be re-hashed at current cost');
});

test('verifyPassword: malformed/tampered stored hashes fail CLOSED, never throw', async () => {
  for (const bad of [null, '', 'scrypt$broken', 'bcrypt$x$y', 'scrypt$0$8$1$aaaa$bbbb', 'scrypt$16384$8$1$!!$??']) {
    assert.deepEqual(await verifyPassword('anything', bad), { ok: false, needsRehash: false }, `fails closed on: ${String(bad).slice(0, 30)}`);
  }
});

test('WARNING-2: the cost ceiling refuses excessive/invalid stored params outright (no compute lever)', () => {
  // Above the tightened ceiling (N>2^17, r>16, p>2) → refused before any
  // scrypt call. Also: a non-power-of-two N is corruption, refused.
  assert.equal(parseStoredHash(`scrypt$${1 << 18}$8$1$${'a'.repeat(24)}$${'b'.repeat(88)}`), null, 'N above ceiling');
  assert.equal(parseStoredHash(`scrypt$32768$17$1$${'a'.repeat(24)}$${'b'.repeat(88)}`), null, 'r above ceiling');
  assert.equal(parseStoredHash(`scrypt$32768$8$3$${'a'.repeat(24)}$${'b'.repeat(88)}`), null, 'p above ceiling');
  assert.equal(parseStoredHash(`scrypt$65537$8$1$${'a'.repeat(24)}$${'b'.repeat(88)}`), null, 'non-power-of-two N');
  // A legitimate one-doubling upgrade target is still ACCEPTED.
  assert.ok(parseStoredHash(`scrypt$65536$8$1$${'a'.repeat(24)}$${'b'.repeat(88)}`), 'N=2^16 (a real upgrade target) accepted');
});

test('hashPassword: unique salt per call — same password, different hashes, both verify', async () => {
  const a = await hashPassword('same');
  const b = await hashPassword('same');
  assert.notEqual(a, b);
  assert.equal((await verifyPassword('same', a)).ok, true);
  assert.equal((await verifyPassword('same', b)).ok, true);
});

// ---- sessions ---------------------------------------------------------------

test('signSession/verifySession: round-trip carries uid/tv/iat/exp; expiry enforced', () => {
  const secret = generateSecret();
  const now = 1_800_000_000;
  const token = signSession({ uid: 1, tv: 0 }, secret, { nowSeconds: now });
  const payload = verifySession(token, secret, { nowSeconds: now + 60 });
  assert.equal(payload.uid, 1);
  assert.equal(payload.tv, 0);
  assert.equal(payload.iat, now);
  assert.equal(payload.exp, now + 30 * 24 * 60 * 60, '~30-day expiry (locked intake)');
  assert.equal(verifySession(token, secret, { nowSeconds: payload.exp }), null, 'expired exactly at exp');
});

test('verifySession: tampered payload, tampered signature, wrong secret, and garbage all fail CLOSED', () => {
  const secret = generateSecret();
  const now = 1_800_000_000;
  const token = signSession({ uid: 7, tv: 3 }, secret, { nowSeconds: now });
  const [payloadB64, mac] = token.split('.');

  // Payload swap with the ORIGINAL mac: signature must catch it.
  const forgedPayload = Buffer.from(JSON.stringify({ uid: 1, tv: 999, iat: now, exp: now + 999999 })).toString('base64url');
  assert.equal(verifySession(`${forgedPayload}.${mac}`, secret, { nowSeconds: now }), null, 'payload swap refused');
  // Mac bitflip.
  const flipped = mac.slice(0, -1) + (mac.slice(-1) === 'A' ? 'B' : 'A');
  assert.equal(verifySession(`${payloadB64}.${flipped}`, secret, { nowSeconds: now }), null, 'signature bitflip refused');
  // Wrong secret (the per-instance cookie-name design assumes prod/beta
  // secrets differ — a beta cookie must be garbage to prod).
  assert.equal(verifySession(token, generateSecret(), { nowSeconds: now }), null, 'foreign secret refused');
  for (const garbage of [null, '', '.', 'a.', '.b', 'not-a-token', `${payloadB64}.${'!'.repeat(43)}`, `${Buffer.from('"json-but-not-object"').toString('base64url')}.${mac}`]) {
    assert.equal(verifySession(garbage, secret, { nowSeconds: now }), null, `garbage refused: ${String(garbage).slice(0, 20)}`);
  }
});

test('SUGGESTION-7: the token is CANONICAL — a padded/re-encoded mac does not verify as a second valid string', () => {
  const secret = generateSecret();
  const now = 1_800_000_000;
  const token = signSession({ uid: 5, tv: 0 }, secret, { nowSeconds: now });
  assert.ok(verifySession(token, secret, { nowSeconds: now }), 'the canonical token verifies');
  // The malleability the review found: base64url-decoding tolerated trailing
  // padding, so `mac=` verified too. String-comparing the canonical digest
  // closes it — only the exact 43-char mac is accepted.
  const [payloadB64, mac] = token.split('.');
  assert.equal(mac.length, 43, 'sha256 base64url mac is exactly 43 chars');
  assert.equal(verifySession(`${payloadB64}.${mac}=`, secret, { nowSeconds: now }), null, 'trailing padding refused');
  assert.equal(verifySession(`${payloadB64}.${mac}==`, secret, { nowSeconds: now }), null, 'double padding refused');
  assert.equal(verifySession(`${payloadB64}.${mac} `, secret, { nowSeconds: now }), null, 'trailing space refused');
  // Delta-regression guard: a mac of 43 UTF-16 CODE UNITS but >43 UTF-8
  // BYTES (multibyte / astral) must return null, NOT throw — cookies are
  // attacker-controlled and verifySession's contract is no-throw. A naive
  // String.length gate would pass these into timingSafeEqual and throw.
  assert.equal(verifySession(`${payloadB64}.${'é' + mac.slice(1)}`, secret, { nowSeconds: now }), null, 'multibyte mac (43 units/44 bytes) refused, not thrown');
  assert.doesNotThrow(() => verifySession(`${payloadB64}.${'𝕏' + mac.slice(2)}`, secret, { nowSeconds: now }), 'astral-plane mac must not throw');
  assert.equal(verifySession(`${payloadB64}.${'𝕏' + mac.slice(2)}`, secret, { nowSeconds: now }), null, 'astral mac refused');
});

test('verifySession: non-integer/hostile uid/tv shapes are refused (the per-request row re-check depends on them)', () => {
  const secret = generateSecret();
  const now = 1_800_000_000;
  for (const payload of [
    { uid: '1', tv: 0, iat: now, exp: now + 100 },
    { uid: 0, tv: 0, iat: now, exp: now + 100 },
    { uid: 1.5, tv: 0, iat: now, exp: now + 100 },
    { uid: 1, tv: -1, iat: now, exp: now + 100 },
    { uid: 1, tv: 0, iat: 'x', exp: now + 100 },
  ]) {
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = require('node:crypto').createHmac('sha256', secret).update(b64).digest('base64url');
    assert.equal(verifySession(`${b64}.${mac}`, secret, { nowSeconds: now }), null, `refused: ${JSON.stringify(payload)}`);
  }
});

// ---- secrets + token compare -----------------------------------------------

test('assertUsableSecret: refuses short and placeholder secrets; accepts generated ones', () => {
  assert.throws(() => assertUsableSecret('short'), /at least 32/);
  assert.throws(() => assertUsableSecret('changeme'), /at least 32|placeholder/);
  assert.throws(() => assertUsableSecret('x'.repeat(31)), /at least 32/);
  assert.doesNotThrow(() => assertUsableSecret(generateSecret()));
});

test('tokensEqual: exact match only; empty/absent never match (the Shortcut header check)', () => {
  assert.equal(tokensEqual('abc123', 'abc123'), true);
  assert.equal(tokensEqual('abc123', 'abc124'), false);
  assert.equal(tokensEqual('abc123', 'abc1230'), false, 'length difference refused without throwing');
  assert.equal(tokensEqual('', ''), false, 'empty never matches — an unset env must not equal an empty header');
  assert.equal(tokensEqual('abc', undefined), false);
});
