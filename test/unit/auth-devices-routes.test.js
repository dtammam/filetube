'use strict';

// [UNIT] v1.387.0 offline playback, plan D1 - the device routes' OWN cookie-only floor
// (lib/auth/routes.js requireCookieSession), isolated from the gate's scope allowlist
// that normally 403s a device token before any route runs. The W1 mutant round found
// this floor MASKED by the scope (deleting it changed nothing while the scope stood),
// so here the routes are mounted on a bare Express app behind a middleware that
// plays the gate: req.user set, req.authVia = 'device'. Every device route must still
// refuse a token (a token never mints, lists or revokes a token), and the same
// routes answer a cookie session.

require('../helpers/isolate-data-dir'); // the auth routes need no server.js, but the rule is uniform
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const authCrypto = require('../../lib/auth/crypto');
const authRoutes = require('../../lib/auth/routes');

function build({ via }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 5, username: 'kid', role: 'member', deviceEpoch: 0, disabled: false }; if (via) req.authVia = via; next(); });
  const calls = [];
  const deviceStore = {
    NAME_MAX: 64,
    validName: (n) => typeof n === 'string' && n.length > 0, validPlatform: (p) => p === 'ios',
    issue: (o) => { calls.push(['issue', o]); return { id: 1, token: 'ftd_x', name: o.name, platform: o.platform, createdAt: 'now' }; },
    listForUser: (uid) => { calls.push(['list', uid]); return []; },
    remove: (uid, id) => { calls.push(['remove', uid, id]); return true; },
    removeAllForUser: () => 0, cutUser: () => 0,
  };
  const userStore = {
    getPasswordHash: () => 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    getById: () => ({ id: 5, username: 'kid', role: 'member', deviceEpoch: 0, disabled: false }),
    validateUsername: () => true, listUsers: () => [], getByUsername: () => null,
  };
  authRoutes.registerRoutes(app, {
    authCrypto, avatarInfo: () => ({ present: false }), booksDb: {}, clearSessionCookie: () => {}, deviceStore,
    dropPendingProgressForUser: () => {}, glyphPool: { LIBRARY_GLYPH_SLOTS: [] }, issueSessionCookie: () => {}, likedStore: {},
    loginRateLimiter: { take: () => ({ allowed: true, retryAfterSec: 0 }), refund: () => {} }, progressStore: {},
    publicUser: (u) => u, rateKey: () => 'k', requireAdmin: () => false, unlinkAvatar: () => {}, unlinkSticker: () => {}, userStore, ytdlpDb: {},
  });
  return { app, calls };
}
async function withServer(app, fn) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
}

test('a request authenticated by a device token is 403 on POST / GET /api/devices and DELETE /api/devices/:id, and no store call is made', async () => {
  const { app, calls } = build({ via: 'device' });
  await withServer(app, async (base) => {
    for (const [method, p, body] of [['POST', '/api/devices', { name: 'x', platform: 'ios', password: 'p' }], ['GET', '/api/devices'], ['DELETE', '/api/devices/1']]) {
      const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      assert.strictEqual(r.status, 403, `${method} ${p}`);
      assert.deepStrictEqual(await r.json(), { error: 'not available to devices' });
    }
    assert.deepStrictEqual(calls, [], 'the store was never touched');
  });
});

test('the same routes answer a cookie session (discrimination): list and revoke reach the store', async () => {
  const { app, calls } = build({ via: undefined });
  await withServer(app, async (base) => {
    assert.strictEqual((await fetch(base + '/api/devices')).status, 200);
    assert.strictEqual((await fetch(base + '/api/devices/7', { method: 'DELETE' })).status, 200);
    assert.deepStrictEqual(calls, [['list', 5], ['remove', 5, 7]]);
  });
});
