'use strict';

// [UNIT] v1.69.0 (podcasts): the 0600 feed-URL secret store
// (lib/podcasts/secrets.js). Binds: mode 0600 from birth, atomic write,
// corrupt-file preservation, idempotent delete, and the structural backup
// exclusion (the file is not a db namespace).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const secrets = require('../../lib/podcasts/secrets');

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ft-podcast-secrets-'));
}

test('set/load/delete round-trip; missing file reads as empty', () => {
  const dir = tmpDataDir();
  assert.deepStrictEqual({ ...secrets.loadFeedSecrets(dir) }, {}, 'no file yet');
  assert.strictEqual(secrets.setFeedSecret(dir, 'sub1', 'https://x.example/f?auth=tok1'), true);
  assert.strictEqual(secrets.setFeedSecret(dir, 'sub2', 'https://y.example/f?auth=tok2'), true);
  const map = secrets.loadFeedSecrets(dir);
  assert.strictEqual(map.sub1, 'https://x.example/f?auth=tok1');
  assert.strictEqual(map.sub2, 'https://y.example/f?auth=tok2');
  assert.strictEqual(secrets.deleteFeedSecret(dir, 'sub1'), true);
  assert.strictEqual(secrets.loadFeedSecrets(dir).sub1, undefined);
  assert.strictEqual(secrets.deleteFeedSecret(dir, 'sub1'), true, 'idempotent');
});

test('the file is born 0600 and stays 0600 across rewrites', { skip: process.platform === 'win32' }, () => {
  const dir = tmpDataDir();
  secrets.setFeedSecret(dir, 's', 'https://x.example/f?auth=t');
  const p = secrets.resolveSecretsPath(dir);
  assert.strictEqual(fs.statSync(p).mode & 0o777, 0o600, 'born 0600');
  secrets.setFeedSecret(dir, 's2', 'https://y.example/f');
  assert.strictEqual(fs.statSync(p).mode & 0o777, 0o600, 'still 0600 after rewrite');
});

test('a corrupt file is preserved aside as .corrupt and reads as empty', () => {
  const dir = tmpDataDir();
  const p = secrets.resolveSecretsPath(dir);
  fs.writeFileSync(p, '{not json');
  const map = secrets.loadFeedSecrets(dir);
  assert.deepStrictEqual({ ...map }, {});
  assert.ok(fs.existsSync(`${p}.corrupt`), 'evidence preserved');
  assert.ok(!fs.existsSync(p), 'the corrupt original no longer occupies the live path');
});

test('non-string / empty values are dropped, __proto__ keys are inert', () => {
  const dir = tmpDataDir();
  secrets.saveFeedSecrets(dir, { good: 'https://x.example', bad: 42, empty: '', ['__proto__']: 'https://evil.example' });
  const map = secrets.loadFeedSecrets(dir);
  assert.strictEqual(map.good, 'https://x.example');
  assert.strictEqual(map.bad, undefined);
  assert.strictEqual(map.empty, undefined);
  assert.strictEqual(Object.prototype.polluted, undefined);
  // The loaded map is null-prototype: a __proto__ row cannot shadow Object.
  assert.strictEqual(Object.getPrototypeOf(map), null);
});

test('no temp file survives a completed write; degrade (not throw) on unwritable dir', () => {
  const dir = tmpDataDir();
  secrets.setFeedSecret(dir, 's', 'https://x.example/f');
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
  assert.deepStrictEqual(leftovers, [], 'no temp litter');
  assert.strictEqual(secrets.saveFeedSecrets(path.join(dir, 'does-not-exist'), { a: 'https://x.example' }), false, 'returns false, never throws');
});
