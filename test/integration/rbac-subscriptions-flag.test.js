'use strict';

// [INTEGRATION] v1.80 RBAC T9 - canManageSubscriptions enforcement. The channel
// registry mutation routes were settable-but-UNENFORCED (census finding): a
// plain member (or a kid) could add/delete/edit subscriptions and even wipe the
// failure log (#54). Now admin OR the per-user flag is required. Enables the
// ytdlp module (routes only register when enabled). Isolated DATA_DIR.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-subsflag-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subsflag-dl-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, plain, mgr;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin
  plain = __mintTestSession({ username: 'plainmember', role: 'member' });
  // __mintTestSession seeds members with canManageSubscriptions:true (a harness
  // quirk; production members default to false). CLEAR it so `plain` is a true
  // flag-less member - the gate re-reads the row per request.
  userStore.setCanManageSubscriptions(plain.user.id, false);
  mgr = __mintTestSession({ username: 'submgr', role: 'member' });
  userStore.setCanManageSubscriptions(mgr.user.id, true);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const req = (method, p, cookie, body) => fetch(`${base}${p}`, {
  method,
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('T9: a plain member is 403 on every subscription-mutation route', async () => {
  assert.strictEqual((await req('POST', '/api/subscriptions', plain.cookie, { channelUrl: 'https://youtube.com/@x' })).status, 403, 'add');
  assert.strictEqual((await req('DELETE', '/api/subscriptions/abc', plain.cookie)).status, 403, 'remove');
  assert.strictEqual((await req('PATCH', '/api/subscriptions/abc', plain.cookie, { paused: true })).status, 403, 'edit');
  assert.strictEqual((await req('POST', '/api/subscriptions/reorder', plain.cookie, { order: [] })).status, 403, 'reorder');
  assert.strictEqual((await req('POST', '/api/subscriptions/settings', plain.cookie, { allowMembersOnly: true })).status, 403, 'settings');
  assert.strictEqual((await req('POST', '/api/subscriptions/repull', plain.cookie)).status, 403, 'check-all');
  assert.strictEqual((await req('DELETE', '/api/subscriptions/failures/all', plain.cookie)).status, 403, 'wipe failure log (#54)');
  // v1.80 security gate (QA finding 6): the PARALLEL podcast registry is gated too.
  assert.strictEqual((await req('POST', '/api/podcasts/subscriptions', plain.cookie, { feedUrl: 'https://e.com/f.xml' })).status, 403, 'podcast add');
  assert.strictEqual((await req('DELETE', '/api/podcasts/subscriptions/abc', plain.cookie)).status, 403, 'podcast remove');
  assert.strictEqual((await req('POST', '/api/podcasts/check', plain.cookie)).status, 403, 'podcast check-all');
  assert.strictEqual((await req('DELETE', '/api/podcasts/episodes/abc', plain.cookie)).status, 403, 'podcast episode delete');
});

test('T9: admin and a flagged member are NOT blocked by the capability gate', async () => {
  // A non-403 status (400 on an invalid body / 200) proves the gate let them
  // THROUGH; only the capability gate returns 403 here.
  for (const who of [{ n: 'admin', c: undefined }, { n: 'flagged member', c: mgr.cookie }]) {
    const s = (await req('POST', '/api/subscriptions', who.c, { channelUrl: 'not a url' })).status;
    assert.notStrictEqual(s, 403, `${who.n} passes the capability gate (got ${s})`);
    const f = (await req('DELETE', '/api/subscriptions/failures/all', who.c)).status;
    assert.notStrictEqual(f, 403, `${who.n} may clear the failure log (got ${f})`);
  }
});
