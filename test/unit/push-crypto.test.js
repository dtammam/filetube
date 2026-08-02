'use strict';

// [UNIT] v1.66 - the push crypto stack (lib/push/{keys,vapid,encrypt}.js).
//
// The encryption suite replays RFC 8291 Appendix A END-TO-END and asserts
// the EXACT final body bytes - the vector strings below are transcribed from
// the RFC text (rfc-editor.org, fetched 2026-08-02), never from memory. The
// ephemeral-key/salt injection seam exists only for this replay; a separate
// round-trip test (fresh random keys, independent test-side decrypt) guards
// the paths a fixed vector cannot, and proves salt/ephemeral are actually
// random per message in production mode.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { resolveVapidKeys, mintVapidJwkPair, publicKeyToUncompressedB64url, VAPID_KEYS_FILENAME } = require('../../lib/push/keys');
const { vapidAuthorizationFor, buildVapidJwt, VAPID_EXP_SECONDS } = require('../../lib/push/vapid');
const { encryptPushPayload, MAX_PLAINTEXT } = require('../../lib/push/encrypt');

// ---- RFC 8291 Appendix A vector --------------------------------------------

const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  // RFC 8291 s5 example = the complete body this encoder must reproduce.
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

// Build the sender's ephemeral private JWK from the vector strings (x/y are
// derived from the public point programmatically - no hand-copied halves).
function vectorEphemeralJwk() {
  const point = Buffer.from(V.asPublic, 'base64url');
  return {
    kty: 'EC',
    crv: 'P-256',
    d: V.asPrivate,
    x: point.subarray(1, 33).toString('base64url'),
    y: point.subarray(33, 65).toString('base64url'),
  };
}

test('RFC 8291 Appendix A: exact final body bytes (the front-door-lock binding)', () => {
  const body = encryptPushPayload(V.plaintext, V.uaPublic, V.authSecret, {
    saltB64url: V.salt,
    ephemeralPrivateJwk: vectorEphemeralJwk(),
  });
  assert.equal(body.toString('base64url'), V.body);
  // Structure re-asserted independently of the blob compare, so a failure
  // names the broken segment instead of "strings differ".
  assert.equal(body.length, 21 + 65 + Buffer.byteLength(V.plaintext) + 1 + 16, 'header + keyid + ct(pt+delimiter+tag)');
  assert.equal(body.subarray(0, 16).toString('base64url'), V.salt, 'salt rides first');
  assert.equal(body.readUInt32BE(16), 4096, 'rs = 4096');
  assert.equal(body.readUInt8(20), 65, 'idlen = 65');
  assert.equal(body.subarray(21, 86).toString('base64url'), V.asPublic, 'keyid = sender public point');
});

// Independent test-side decrypt: the reverse derivation written from the RFC
// text, sharing no code with lib/push/encrypt.js.
function decryptPushBody(body, uaPrivateJwk, authB64url) {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublicPoint = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const uaPrivate = crypto.createPrivateKey({ key: uaPrivateJwk, format: 'jwk' });
  const uaPublicPoint = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(uaPrivateJwk.x, 'base64url'),
    Buffer.from(uaPrivateJwk.y, 'base64url'),
  ]);
  const asPublic = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: asPublicPoint.subarray(1, 33).toString('base64url'), y: asPublicPoint.subarray(33, 65).toString('base64url') },
    format: 'jwk',
  });
  const ecdh = crypto.diffieHellman({ privateKey: uaPrivate, publicKey: asPublic });
  const hk = (s, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, len));
  const ikm = hk(Buffer.from(authB64url, 'base64url'), ecdh,
    Buffer.concat([Buffer.from('WebPush: info\0'), uaPublicPoint, asPublicPoint]), 32);
  const cek = hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const de = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  de.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([de.update(ciphertext.subarray(0, ciphertext.length - 16)), de.final()]);
  assert.equal(padded[padded.length - 1], 0x02, 'last-record delimiter present');
  return padded.subarray(0, padded.length - 1);
}

test('round-trip with FRESH keys: production mode is random per message and decrypts cleanly', () => {
  const ua = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const uaJwkPriv = ua.privateKey.export({ format: 'jwk' });
  const uaPubB64u = publicKeyToUncompressedB64url(ua.publicKey.export({ format: 'jwk' }));
  const auth = crypto.randomBytes(16).toString('base64url');

  const one = encryptPushPayload('{"title":"Nüevo vidéo"}', uaPubB64u, auth);
  const two = encryptPushPayload('{"title":"Nüevo vidéo"}', uaPubB64u, auth);
  assert.notEqual(one.toString('base64url'), two.toString('base64url'), 'salt/ephemeral are fresh per message');
  assert.equal(decryptPushBody(one, uaJwkPriv, auth).toString('utf8'), '{"title":"Nüevo vidéo"}');
  assert.equal(decryptPushBody(two, uaJwkPriv, auth).toString('utf8'), '{"title":"Nüevo vidéo"}');
});

test('encrypt refuses malformed inputs and oversize payloads (fail-closed)', () => {
  const ua = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const uaPubB64u = publicKeyToUncompressedB64url(ua.publicKey.export({ format: 'jwk' }));
  const auth = crypto.randomBytes(16).toString('base64url');
  assert.throws(() => encryptPushPayload('x', 'AAAA', auth), /uncompressed P-256 point/);
  assert.throws(() => encryptPushPayload('x', uaPubB64u, 'AAAA'), /auth secret is not 16 bytes/);
  assert.throws(() => encryptPushPayload('y'.repeat(MAX_PLAINTEXT + 1), uaPubB64u, auth), /too large/);
  assert.equal(encryptPushPayload('y'.repeat(MAX_PLAINTEXT), uaPubB64u, auth).length, 21 + 65 + MAX_PLAINTEXT + 17);
});

// ---- VAPID (RFC 8292) ------------------------------------------------------

test('VAPID JWT: ES256 p1363 signature verifies, claims are aud=push-service-origin / bounded exp / sub', () => {
  const pair = mintVapidJwkPair();
  const nowMs = Date.parse('2026-03-01T12:00:00.000Z');
  const header = vapidAuthorizationFor(
    'https://fcm.googleapis.com/wp/dEs-token?x=1',
    { privateJwk: pair.privateKey, publicKeyB64url: publicKeyToUncompressedB64url(pair.publicKey), subject: 'mailto:dean@tamm.am', nowMs }
  );
  const m = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(header);
  assert.ok(m, 'header shape: vapid t=<jwt>, k=<key>');
  const [head, body, sig] = m[1].split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(body, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com', 'aud is the ENDPOINT origin - path/query stripped, never our origin');
  assert.equal(claims.sub, 'mailto:dean@tamm.am');
  assert.equal(claims.exp, Math.floor(nowMs / 1000) + VAPID_EXP_SECONDS);
  assert.ok(VAPID_EXP_SECONDS <= 24 * 60 * 60, 'RFC 8292 ceiling');
  const sigBuf = Buffer.from(sig, 'base64url');
  assert.equal(sigBuf.length, 64, 'p1363 raw r||s, never DER');
  const pubKey = crypto.createPublicKey({ key: pair.publicKey, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${body}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, sigBuf), 'signature verifies');
  const k = Buffer.from(m[2], 'base64url');
  assert.equal(k.length, 65, 'k= is the uncompressed public point');
  assert.equal(k[0], 0x04);
});

test('VAPID JWT: a tampered payload fails verification (the signature actually binds)', () => {
  const pair = mintVapidJwkPair();
  const jwt = buildVapidJwt({ audience: 'https://p.example', subject: 'mailto:a@b.c', expEpochSeconds: 1770000000, privateJwk: pair.privateKey });
  const [head, _body, sig] = jwt.split('.');
  const forged = Buffer.from(JSON.stringify({ aud: 'https://evil.example', exp: 1770000000, sub: 'mailto:a@b.c' })).toString('base64url');
  const pubKey = crypto.createPublicKey({ key: pair.publicKey, format: 'jwk' });
  assert.equal(
    crypto.verify('sha256', Buffer.from(`${head}.${forged}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')),
    false
  );
});

// ---- key resolution --------------------------------------------------------

test('resolveVapidKeys: mints 0600 on first boot, is stable across resolves, honors FILETUBE_VAPID_SUBJECT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-vapid-'));
  try {
    const first = resolveVapidKeys(dir, {}, () => {});
    const keysPath = path.join(dir, VAPID_KEYS_FILENAME);
    assert.ok(fs.existsSync(keysPath));
    assert.equal(fs.statSync(keysPath).mode & 0o777, 0o600, 'credential perms');
    const point = Buffer.from(first.publicKeyB64url, 'base64url');
    assert.equal(point.length, 65);
    assert.equal(point[0], 0x04);
    assert.equal(first.subject, 'mailto:admin@filetube.local', 'default sub');

    const second = resolveVapidKeys(dir, { FILETUBE_VAPID_SUBJECT: 'mailto:dean@tamm.am' }, () => {});
    assert.equal(second.publicKeyB64url, first.publicKeyB64url, 'same identity across boots - subscriptions stay bound');
    assert.equal(second.subject, 'mailto:dean@tamm.am');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the VAPID key file is gitignored at the repo-root dev landing spot (it holds a PRIVATE key)', () => {
  // Adversarial gate WARNING 1: in local dev DATA_DIR resolves to the repo
  // root, so vapid-keys.json lands beside db.json/filetube.db - both of
  // which .gitignore names for exactly this reason. The file was found
  // untracked-but-committable in a dev tree. This lock keeps the entry.
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf8');
  const lines = gitignore.split('\n').map((l) => l.trim());
  assert.ok(lines.includes(`/${VAPID_KEYS_FILENAME}`),
    `.gitignore must contain /${VAPID_KEYS_FILENAME} - it holds the EC private key that IS this instance's push identity`);
});

test('resolveVapidKeys: corrupt JSON and mismatched pairs REFUSE boot (fail closed, never silently re-mint)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-vapid-'));
  try {
    const keysPath = path.join(dir, VAPID_KEYS_FILENAME);
    fs.writeFileSync(keysPath, '{nope');
    assert.throws(() => resolveVapidKeys(dir, {}, () => {}), /not valid JSON/);

    // Shape-valid but the private scalar belongs to a DIFFERENT pair: the
    // derive check must catch it (this identity would 403 at every push
    // service while looking healthy locally).
    const a = mintVapidJwkPair();
    const b = mintVapidJwkPair();
    fs.writeFileSync(keysPath, JSON.stringify({
      publicKey: a.publicKey,
      privateKey: { ...a.privateKey, d: b.privateKey.d },
    }));
    assert.throws(() => resolveVapidKeys(dir, {}, () => {}), /does not derive/);

    fs.writeFileSync(keysPath, JSON.stringify({ publicKey: a.publicKey, privateKey: { ...a.privateKey, crv: 'P-384' } }));
    assert.throws(() => resolveVapidKeys(dir, {}, () => {}), /not a usable P-256 JWK pair/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
