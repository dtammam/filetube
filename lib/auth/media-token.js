'use strict';

// lib/auth/media-token.js - the short-lived MEDIA TOKEN (v1.397.0 native audio, plan D7).
//
// The iOS app's native audio engine (AVPlayer) fetches audio bytes and artwork itself. It cannot
// send the web view's cookies (AVPlayer snapshots them once) and an Authorization header on an
// AVURLAsset is not a documented key (which matters for an App Store build), so native puts a
// token in the QUERY: `?mt=ftm_...`. To keep that cheap to leak-proof, the token is:
//   - short-lived (MEDIA_TOKEN_SECONDS, about 6 h), minted from the DEVICE token at
//     POST /api/devices/media-token (lib/auth/routes.js; device-token auth only - a cookie session
//     or a media token can never mint one);
//   - bound to the user row, the device row and the device epoch: the gate re-reads all three on
//     every request, so a revoke, a password change, "Remove all devices", a disable or a delete
//     kills it at once (and devices.track ends an open stream mid-flight, like the device token);
//   - accepted ONLY on GET / HEAD of the audio byte and art routes (MEDIA_SCOPE in
//     lib/auth/device-scope.js); anywhere else, or on any other method, a request carrying `mt`
//     is refused with a JSON 401 and never falls through to cookie auth, never redirects (a
//     redirect's Location would echo the token), never sets a cookie;
//   - redacted from every URL log line (redactMediaToken; server.js's audit middleware).
// Stateless: an HMAC over a base64url payload with the session secret (the signSession shape),
// prefixed `ftm_` so the secret-scan and a log reader recognise it. Nothing is stored.

const crypto = require('node:crypto');

const TOKEN_PREFIX = 'ftm_';
const MEDIA_TOKEN_SECONDS = 6 * 60 * 60;
const MAC_RE = /^[A-Za-z0-9_-]{43}$/;

function isMediaToken(value) {
  return typeof value === 'string' && value.startsWith(TOKEN_PREFIX);
}

// { uid, did, de } = the user id, the device row id, the user's device_epoch at mint time.
function signMediaToken({ uid, did, de }, secret, { nowSeconds = Math.floor(Date.now() / 1000), ttlSeconds = MEDIA_TOKEN_SECONDS } = {}) {
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('signMediaToken: uid must be a positive integer');
  if (!Number.isInteger(did) || did <= 0) throw new Error('signMediaToken: did must be a positive integer');
  if (!Number.isInteger(de) || de < 0) throw new Error('signMediaToken: de must be a non-negative integer');
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('signMediaToken: secret unusable');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error('signMediaToken: ttlSeconds must be a positive integer');
  const exp = nowSeconds + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ uid, did, de, iat: nowSeconds, exp }), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${TOKEN_PREFIX}${payload}.${mac}`, exp };
}

// -> { uid, did, de, iat, exp } for a well-formed, correctly signed token (expired or not: the
// caller decides what an expired one means), or null. NEVER throws on hostile input.
function parseMediaToken(token, secret) {
  if (!isMediaToken(token) || typeof secret !== 'string' || secret.length === 0) return null;
  const body = token.slice(TOKEN_PREFIX.length);
  const dot = body.indexOf('.');
  if (dot <= 0 || dot === body.length - 1) return null;
  const payloadB64 = body.slice(0, dot);
  const macB64 = body.slice(dot + 1);
  if (!MAC_RE.test(macB64) || !/^[A-Za-z0-9_-]+$/.test(payloadB64)) return null; // canonical charset + length (the verifySession posture)
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(macB64), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  const { uid, did, de, iat, exp } = payload;
  if (!Number.isInteger(uid) || uid <= 0) return null;
  if (!Number.isInteger(did) || did <= 0) return null;
  if (!Number.isInteger(de) || de < 0) return null;
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null;
  return { uid, did, de, iat, exp };
}

// A URL (or any string) with every `mt=<value>` query value replaced, so a log line can never
// carry a usable token. Matches the parameter wherever it sits (`?mt=`, `&mt=`), case-sensitive
// on the name (the route reads `req.query.mt` exactly).
function redactMediaToken(url) {
  if (typeof url !== 'string' || url.indexOf('mt=') === -1) return url;
  return url.replace(/([?&])mt=[^&#\s]*/g, '$1mt=[redacted]');
}

module.exports = { TOKEN_PREFIX, MEDIA_TOKEN_SECONDS, isMediaToken, signMediaToken, parseMediaToken, redactMediaToken };
