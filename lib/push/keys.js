'use strict';

// v1.66 web push - VAPID keypair resolution. Structural copy of
// resolveSessionSecret (lib/auth/gate.js): DATA_DIR file, 0600, mint on
// first boot, fail-closed validation. The keypair is the application
// server's signing identity (RFC 8292); browsers PIN the public key at
// subscribe time, so it must be stable for the life of the instance's
// subscriptions - which is exactly why it lives beside the session secret
// and, like it, NEVER rides a backup bundle (exec plan v1.66 D2).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VAPID_KEYS_FILENAME = 'vapid-keys.json';
const B64URL = /^[A-Za-z0-9_-]+$/;

// P-256 coordinate/scalar: 32 bytes -> 43 base64url chars (no padding).
function isJwkField(v) {
  return typeof v === 'string' && v.length === 43 && B64URL.test(v);
}

// Fail-closed shape + consistency check: crv/kty exact, coordinates the
// right size, and the private scalar must actually derive the stored public
// point (a mismatched pair signs JWTs the push service rejects with 403 -
// better a loud boot refusal than silently-dead deliveries).
function assertUsableVapidKeys(parsed) {
  const priv = parsed && parsed.privateKey;
  const pub = parsed && parsed.publicKey;
  const shapeOk = priv && pub
    && priv.kty === 'EC' && priv.crv === 'P-256'
    && pub.kty === 'EC' && pub.crv === 'P-256'
    && isJwkField(priv.d) && isJwkField(priv.x) && isJwkField(priv.y)
    && isJwkField(pub.x) && isJwkField(pub.y)
    && priv.x === pub.x && priv.y === pub.y;
  if (!shapeOk) throw new Error('vapid-keys.json is not a usable P-256 JWK pair (refusing to boot with a corrupt push identity)');
  // Recompute the public point from the scalar with ECDH - a JWK import
  // would keep the CLAIMED x/y (OpenSSL does not re-derive), which made an
  // earlier draft of this check vacuous. createECDH genuinely multiplies
  // the base point by d.
  let derivedPoint;
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(priv.d, 'base64url'));
    derivedPoint = ecdh.getPublicKey();
  } catch {
    throw new Error('vapid-keys.json is not a usable P-256 JWK pair (refusing to boot with a corrupt push identity)');
  }
  if (derivedPoint.subarray(1, 33).toString('base64url') !== pub.x
    || derivedPoint.subarray(33, 65).toString('base64url') !== pub.y) {
    throw new Error('vapid-keys.json private key does not derive its stored public key (refusing a mismatched push identity)');
  }
}

function mintVapidJwkPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ format: 'jwk' }),
    privateKey: privateKey.export({ format: 'jwk' }),
  };
}

// The wire form the client needs for applicationServerKey and the sender
// needs for the `k=` VAPID parameter: the uncompressed point (0x04||x||y,
// 65 bytes), base64url.
function publicKeyToUncompressedB64url(pubJwk) {
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(pubJwk.x, 'base64url'),
    Buffer.from(pubJwk.y, 'base64url'),
  ]).toString('base64url');
}

// Returns { publicJwk, privateJwk, publicKeyB64url, subject }. No env
// override for the key material itself (unlike the session secret): a JWK
// pair does not fit an env var cleanly, and DATA_DIR is the durable home in
// every supported deployment. FILETUBE_VAPID_SUBJECT sets the JWT `sub`
// contact URI (RFC 8292 SHOULD).
function resolveVapidKeys(dataDir, env = process.env, log = console.log) {
  const keysPath = path.join(dataDir, VAPID_KEYS_FILENAME);
  let pair;
  if (fs.existsSync(keysPath)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    } catch {
      throw new Error(`${keysPath} is not valid JSON (refusing to boot with a corrupt push identity)`);
    }
    assertUsableVapidKeys(parsed);
    pair = parsed;
  } else {
    pair = mintVapidJwkPair();
    fs.writeFileSync(keysPath, JSON.stringify(pair, null, 2), { mode: 0o600 });
    try { fs.chmodSync(keysPath, 0o600); } catch { /* best-effort on odd FS */ }
    log(`[push] VAPID keys: minted a new pair at ${keysPath} (0600). Subscriptions bind to this public key - keep the file with DATA_DIR.`);
  }
  const subject = typeof env.FILETUBE_VAPID_SUBJECT === 'string' && env.FILETUBE_VAPID_SUBJECT.length > 0
    ? env.FILETUBE_VAPID_SUBJECT
    : 'mailto:admin@filetube.local';
  return {
    publicJwk: pair.publicKey,
    privateJwk: pair.privateKey,
    publicKeyB64url: publicKeyToUncompressedB64url(pair.publicKey),
    subject,
  };
}

module.exports = { resolveVapidKeys, assertUsableVapidKeys, mintVapidJwkPair, publicKeyToUncompressedB64url, VAPID_KEYS_FILENAME };
