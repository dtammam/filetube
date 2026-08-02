'use strict';

// v1.66 web push - VAPID (RFC 8292) request authentication in raw
// node:crypto. An ES256 JWT whose `aud` is the PUSH SERVICE's origin
// (derived from the subscription endpoint - never FileTube's own origin,
// which is why no base-URL config exists or is needed), `exp` bounded well
// under the RFC's 24h ceiling, `sub` a contact URI.

const crypto = require('node:crypto');

// 12h: long enough to reuse a token across a delivery round, half the RFC
// ceiling so clock skew can never push a token over it.
const VAPID_EXP_SECONDS = 12 * 60 * 60;

function b64uJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

// The JOSE trap this module exists to get right: ES256 signatures are the
// RAW 64-byte r||s concatenation (ieee-p1363), NOT the DER ECDSA_SIG
// encoding node produces by default. A DER signature is variable-length and
// every push service rejects it with an opaque 403.
function signEs256(data, privateJwk) {
  const key = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  return crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
}

function buildVapidJwt({ audience, subject, expEpochSeconds, privateJwk }) {
  const head = b64uJson({ typ: 'JWT', alg: 'ES256' });
  const body = b64uJson({ aud: audience, exp: expEpochSeconds, sub: subject });
  const data = `${head}.${body}`;
  return `${data}.${signEs256(data, privateJwk).toString('base64url')}`;
}

// The Authorization header value for one POST to `endpoint`.
function vapidAuthorizationFor(endpoint, { privateJwk, publicKeyB64url, subject, nowMs }) {
  const audience = new URL(endpoint).origin;
  const expEpochSeconds = Math.floor(nowMs / 1000) + VAPID_EXP_SECONDS;
  const jwt = buildVapidJwt({ audience, subject, expEpochSeconds, privateJwk });
  return `vapid t=${jwt}, k=${publicKeyB64url}`;
}

module.exports = { vapidAuthorizationFor, buildVapidJwt, VAPID_EXP_SECONDS };
