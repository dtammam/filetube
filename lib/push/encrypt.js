'use strict';

// v1.66 web push - RFC 8291 message encryption (aes128gcm content coding,
// RFC 8188 framing) in raw node:crypto. One record per message: FileTube
// payloads are a few hundred bytes and the push ceiling is 4096 total, so
// multi-record framing is refused rather than implemented-and-untested.
//
// The derivation chain, verbatim from RFC 8291 s3.3-3.4 (every step below
// is pinned by the Appendix A exact-bytes vector in
// test/unit/push-crypto.test.js - edit this file only with that suite open):
//   IKM   = HKDF(salt=auth_secret, ikm=ECDH(as_priv, ua_pub),
//               info="WebPush: info"||0x00||ua_pub||as_pub, len=32)
//   CEK   = HKDF(salt, IKM, "Content-Encoding: aes128gcm"||0x00, 16)
//   NONCE = HKDF(salt, IKM, "Content-Encoding: nonce"||0x00, 12)
//   body  = salt(16) || rs(4)=4096 || idlen(1)=65 || as_pub(65)
//           || AES-128-GCM(CEK, NONCE, plaintext || 0x02)

const crypto = require('node:crypto');

const RECORD_SIZE = 4096;
// One record must hold plaintext + the 0x02 delimiter + the 16-byte GCM tag.
const MAX_PLAINTEXT = RECORD_SIZE - 17;

function jwkFromUncompressedPoint(point) {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: point.subarray(1, 33).toString('base64url'),
    y: point.subarray(33, 65).toString('base64url'),
  };
}

function uncompressedPointFromPublicKey(publicKeyObj) {
  const jwk = publicKeyObj.export({ format: 'jwk' });
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
}

function hkdf(salt, ikm, info, length) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));
}

// Encrypt one push message for a subscription.
//   p256dhB64url / authB64url: the browser's subscription keys, verbatim.
//   plaintext: Buffer or string.
//   testOverrides: { saltB64url, ephemeralPrivateJwk } - INJECTION SEAM FOR
//   THE RFC VECTOR TEST ONLY; production callers pass nothing and get a
//   fresh random salt + ephemeral keypair per message (the RFC requirement).
function encryptPushPayload(plaintext, p256dhB64url, authB64url, testOverrides = {}) {
  const pt = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  if (pt.length > MAX_PLAINTEXT) throw new Error(`push payload too large (${pt.length} > ${MAX_PLAINTEXT})`);

  const uaPublic = Buffer.from(String(p256dhB64url), 'base64url');
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('p256dh is not an uncompressed P-256 point');
  const authSecret = Buffer.from(String(authB64url), 'base64url');
  if (authSecret.length !== 16) throw new Error('auth secret is not 16 bytes');

  const salt = testOverrides.saltB64url
    ? Buffer.from(testOverrides.saltB64url, 'base64url')
    : crypto.randomBytes(16);
  if (salt.length !== 16) throw new Error('salt is not 16 bytes');

  const asPrivate = testOverrides.ephemeralPrivateJwk
    ? crypto.createPrivateKey({ key: testOverrides.ephemeralPrivateJwk, format: 'jwk' })
    : crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  const asPublicPoint = uncompressedPointFromPublicKey(crypto.createPublicKey(asPrivate));

  const uaPublicKey = crypto.createPublicKey({ key: jwkFromUncompressedPoint(uaPublic), format: 'jwk' });
  const ecdhSecret = crypto.diffieHellman({ privateKey: asPrivate, publicKey: uaPublicKey });

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublicPoint]);
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([pt, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(65, 20);
  return Buffer.concat([header, asPublicPoint, ciphertext]);
}

module.exports = { encryptPushPayload, MAX_PLAINTEXT, RECORD_SIZE };
