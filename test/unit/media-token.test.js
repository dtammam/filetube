'use strict';

// [UNIT] v1.397.0 native audio (plan D7): the media token's pure parts - sign / parse round trip, every hostile shape
// refused without throwing, the clock, and the log redaction that keeps a token out of every URL line.

const { test } = require('node:test');
const assert = require('node:assert');
const mt = require('../../lib/auth/media-token');

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
  const forge = (obj) => { const p = Buffer.from(JSON.stringify(obj)).toString('base64url'); const m = require('node:crypto').createHmac('sha256', SECRET).update(p).digest('base64url'); return 'ftm_' + p + '.' + m; };
  for (const o of [{ uid: '7', did: 3, de: 2, iat: 1, exp: 2 }, { uid: 7, did: 3, de: 2, iat: 1 }, { uid: 7, did: -3, de: 2, iat: 1, exp: 2 }, { uid: 7, did: 3, de: 2.5, iat: 1, exp: 2 }, [1, 2], 'str', null]) {
    assert.strictEqual(mt.parseMediaToken(forge(o), SECRET), null, JSON.stringify(o));
  }
  assert.strictEqual(mt.parseMediaToken(forge({ uid: 7, did: 3, de: 2, iat: 1, exp: 2 }), SECRET) !== null, true, 'the control: a well-formed forge with the right secret parses (expiry is the gate\'s call)');
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
