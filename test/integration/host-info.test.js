'use strict';

// [INTEGRATION] v1.384.0 (plan D4): GET /api/host-info, the native host's pre-load check. Public (the iOS app
// calls it before it can sign in), exactly three keys, never cached, and the only /api GET on the gate's allowlist.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-host-info-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, __mintTestSession } = require('../../server');
const gate = require('../../lib/auth/gate');
const pkg = require('../../package.json');

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'references', 'native-bridge.v1.schema.json'), 'utf8'));
let server;
let base;

before(async () => {
  __mintTestSession(); // users exist: the gate is in its normal require-a-session mode
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('reachable logged out, with exactly the contract shape and nothing else', async () => {
  const res = await fetch(`${base}/api/host-info`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(body, { app: 'filetube', version: pkg.version, bridge: { min: 1, max: 1 } });
  // Validated against the schema's hostInfo by hand (no JSON-schema dependency): same keys, same constants.
  const def = SCHEMA.$defs.hostInfo;
  assert.deepEqual(Object.keys(body).sort(), Object.keys(def.properties).sort(), 'no extra keys');
  assert.deepEqual(def.required.slice().sort(), Object.keys(body).sort());
  assert.equal(body.app, def.properties.app.const);
  assert.equal(typeof body.version, 'string');
  assert.deepEqual(Object.keys(body.bridge).sort(), ['max', 'min']);
  assert.ok(Number.isInteger(body.bridge.min) && body.bridge.min >= 1 && Number.isInteger(body.bridge.max) && body.bridge.max >= 1);
});

test('the allowlist admits GET /api/host-info only: not other methods, not a sibling, not a traversal', async () => {
  assert.equal(gate.isAllowlisted('GET', '/api/host-info'), true);
  assert.equal(gate.isAllowlisted('HEAD', '/api/host-info'), true);
  assert.equal(gate.isAllowlisted('POST', '/api/host-info'), false);
  assert.equal(gate.isAllowlisted('PUT', '/api/host-info'), false);
  assert.equal(gate.isAllowlisted('DELETE', '/api/host-info'), false);
  assert.equal(gate.isAllowlisted('GET', '/api/host-info/x'), false);
  assert.equal(gate.isAllowlisted('GET', '/api/host-info2'), false);
  assert.equal(gate.isAllowlisted('GET', '/api/auth/me'), false);
  for (const m of ['POST', 'PUT', 'DELETE']) {
    const res = await fetch(`${base}/api/host-info`, { method: m });
    assert.notEqual(res.status, 200, `${m} must not be served by the public route`);
  }
  const sibling = await fetch(`${base}/api/host-info/extra`);
  assert.equal(sibling.status, 401, 'a sibling path stays gated');
});

test('the adapter script is served logged out (login.html and welcome.html load it)', async () => {
  const res = await fetch(`${base}/js/host-adapter.js`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /window\.FileTubeHost|FileTubeHost/);
  for (const shell of ['login.html', 'welcome.html']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'public', shell), 'utf8'), /src="\/js\/host-adapter\.js"/, `${shell} loads the adapter`);
  }
});
