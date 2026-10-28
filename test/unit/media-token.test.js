'use strict';

// [UNIT] v1.397.0 native audio (plan D7): the media token's pure parts - sign / parse round trip, every hostile shape
// refused without throwing, the clock, and the log redaction that keeps a token out of every URL line.

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const mt = require('../../lib/auth/media-token');
const authCrypto = require('../../lib/auth/crypto');

const SECRET = 's'.repeat(48);
const CLAIMS = { uid: 7, did: 3, de: 2 };

test('sign -> parse round trip: ftm_ prefix, the claims, iat and exp (about 6 h by default)', () => {
  const { token, exp } = mt.signMediaToken(CLAIMS, SECRET, { nowSeconds: 1_000_000 });
  assert.ok(token.startsWith('ftm_'));
  assert.strictEqual(exp, 1_000_000 + mt.MEDIA_TOKEN_SECONDS);
  assert.strictEqual(mt.MEDIA_TOKEN_SECONDS, 6 * 60 * 60);
  assert.deepStrictEqual(mt.parseMediaToken(token, SECRET), { uid: 7, did: 3, de: 2, iat: 1_000_000, exp });
  assert.strictEqual(mt.isMediaToken(token), true);
  assert.strictEqual(mt.isMediaToken('ftd_' + 'x'.repeat(43)), false, 'a device token is not a media token');
  assert.strictEqual(mt.parseMediaToken(token, 'another-secret-another-secret-another'), null, 'another secret: refused');
});

test('sign refuses bad claims, a short secret and a non-positive ttl', () => {
  for (const c of [{ uid: 0, did: 1, de: 0 }, { uid: 1, did: 0, de: 0 }, { uid: 1, did: 1, de: -1 }, { uid: '1', did: 1, de: 0 }, { uid: 1.5, did: 1, de: 0 }]) assert.throws(() => mt.signMediaToken(c, SECRET), /signMediaToken/);
  assert.throws(() => mt.signMediaToken(CLAIMS, 'short'), /secret unusable/);
  assert.throws(() => mt.signMediaToken(CLAIMS, SECRET, { ttlSeconds: 0 }), /ttlSeconds/);
});

test('parse NEVER throws on hostile input and refuses every malformed shape', () => {
  const { token } = mt.signMediaToken(CLAIMS, SECRET);
  const [payload, mac] = token.slice(4).split('.');
  const bad = [
    null, undefined, 42, {}, '', 'ftm_', 'ftm_.', 'ftm_' + payload, 'ftm_' + payload + '.', 'ftm_.' + mac,
    'ftm_' + payload + '.' + mac.slice(0, 42), 'ftm_' + payload + '.' + mac + '=', 'ftm_' + payload + '.' + mac + 'A',
    'ftm_' + payload + '.' + mac.replace(/[A-Za-z]/, (c) => (c === 'A' ? 'B' : 'A')),
    'ftm_' + payload + '.' + 'é'.repeat(43), 'ftm_' + payload + '!' + '.' + mac,
    token.replace('ftm_', 'ftd_'), token + 'x',
  ];
  for (const b of bad) assert.strictEqual(mt.parseMediaToken(b, SECRET), null, JSON.stringify(b));
  assert.strictEqual(mt.parseMediaToken(token, ''), null, 'no secret: refused');
  // a correctly signed payload with wrong claim types is still refused
  const forge = (obj) => { const p = Buffer.from(JSON.stringify(obj)).toString('base64url'); const m = crypto.createHmac('sha256', mt.mediaKey(SECRET)).update(p).digest('base64url'); return 'ftm_' + p + '.' + m; };
  for (const o of [{ uid: '7', did: 3, de: 2, iat: 1, exp: 2 }, { uid: 7, did: 3, de: 2, iat: 1 }, { uid: 7, did: -3, de: 2, iat: 1, exp: 2 }, { uid: 7, did: 3, de: 2.5, iat: 1, exp: 2 }, [1, 2], 'str', null]) {
    assert.strictEqual(mt.parseMediaToken(forge(o), SECRET), null, JSON.stringify(o));
  }
  assert.strictEqual(mt.parseMediaToken(forge({ uid: 7, did: 3, de: 2, iat: 1, exp: 2 }), SECRET) !== null, true, 'the control: a well-formed forge with the right secret parses (expiry is the gate\'s call)');
});

test('D18 domain separation: a media token never verifies as a SESSION (its prefix stripped, a tv forged in) and a session never parses as a media token; the key is HMAC(secret, "filetube media token v1"), not the raw secret', () => {
  const now = 1_000_000;
  // a media-shaped payload carrying everything verifySession wants (uid, tv, iat, exp) and mac'd with the MEDIA key: not a session
  const payload = Buffer.from(JSON.stringify({ uid: 7, did: 3, de: 2, tv: 0, iat: now, exp: now + 3600 })).toString('base64url');
  const mediaMac = crypto.createHmac('sha256', mt.mediaKey(SECRET)).update(payload).digest('base64url');
  assert.strictEqual(authCrypto.verifySession(payload + '.' + mediaMac, SECRET, { nowSeconds: now }), null, 'a media mac is not a session mac');
  // the control that pins the mutant: the SAME payload mac'd with the raw secret WOULD be a session (what D18 forbids)
  const rawMac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  assert.ok(authCrypto.verifySession(payload + '.' + rawMac, SECRET, { nowSeconds: now }), 'the control: with the raw secret the forgery verifies, so the derived key is what keeps it out');
  assert.notStrictEqual(mediaMac, rawMac);
  // a real media token with its prefix stripped is not a session (no tv AND the wrong key)
  const { token } = mt.signMediaToken(CLAIMS, SECRET, { nowSeconds: now });
  assert.strictEqual(authCrypto.verifySession(token.slice(4), SECRET, { nowSeconds: now }), null);
  // the reverse: a session token with the media prefix is not a media token (session-shaped claims, the wrong key)
  const session = authCrypto.signSession({ uid: 7, tv: 0 }, SECRET, { nowSeconds: now });
  assert.strictEqual(mt.parseMediaToken('ftm_' + session, SECRET), null);
  // and a session-shaped payload mac'd with the raw secret but carrying did/de does not parse as a media token either
  const sPayload = Buffer.from(JSON.stringify({ uid: 7, did: 3, de: 2, iat: now, exp: now + 3600 })).toString('base64url');
  assert.strictEqual(mt.parseMediaToken('ftm_' + sPayload + '.' + crypto.createHmac('sha256', SECRET).update(sPayload).digest('base64url'), SECRET), null);
  // the derivation is the documented one and is stable per secret
  assert.deepStrictEqual(mt.mediaKey(SECRET), crypto.createHmac('sha256', SECRET).update('filetube media token v1').digest());
  assert.strictEqual(mt.KEY_DOMAIN, 'filetube media token v1');
  assert.strictEqual(mt.mediaKey(''), null);
});

test('redactMediaToken: every mt= value goes, wherever it sits; other params and token-free URLs are untouched', () => {
  assert.strictEqual(mt.redactMediaToken('/api/offline/file/track/abc?mt=ftm_pay.mac'), '/api/offline/file/track/abc?mt=[redacted]');
  assert.strictEqual(mt.redactMediaToken('/albumart/abc?s=160&mt=ftm_pay.mac&v=3'), '/albumart/abc?s=160&mt=[redacted]&v=3');
  assert.strictEqual(mt.redactMediaToken('/x?mt=a&mt=b#frag'), '/x?mt=[redacted]&mt=[redacted]#frag');
  assert.strictEqual(mt.redactMediaToken('/x?mt='), '/x?mt=[redacted]');
  assert.strictEqual(mt.redactMediaToken('/x?fmt=ftm_pay.mac&amt=1'), '/x?fmt=ftm_pay.mac&amt=1', 'only the mt parameter, not a suffix of another name');
  assert.strictEqual(mt.redactMediaToken('/track/abc'), '/track/abc');
  assert.strictEqual(mt.redactMediaToken(undefined), undefined);
});
