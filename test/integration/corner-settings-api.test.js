'use strict';

// [INTEGRATION] v1.67 T2 - the two server lanes the card-corner wave rides,
// against the real app:
//
//  (a) `cornerTL`/`cornerTR`/`cornerBL`/`cornerBR` join MIRRORED_SETTING_KEYS
//      (per-user SERVER-persisted, Dean's ruling C1): accepted + read back
//      via GET /api/auth/me, bounded like their siblings, null clears. v1.204:
//      `cornerBR` became a mirrored key too (the bottom-right corner is now
//      selectable, sharing its space with the duration badge) - the persist
//      lane must accept it or the editor's save silently 400s (the end-to-end
//      persist-gate class). The lane is SHAPE-only by design (the pushEnabled
//      precedent) - a charset-valid garbage value is accepted server-side and
//      the RENDERER defends (plan D1, the starRatings garbage-tolerance
//      precedent), locked here so nobody "hardens" the lane into a divergent
//      second validator without meaning to.
//
//  (b) the `/api/videos` page projection carries the server-derived
//      `watchUrl` (same buildWatchUrl gate as the single-item route) so the
//      card share control never re-approximates a server-resolved field
//      client-side (the v1.52 lesson): present + exact for a safe
//      youtubeId, ABSENT for items without one, and ABSENT for an unsafe
//      youtubeId (buildWatchUrl fail-safe null).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cornerapi-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;

// authenticateFetch patches global.fetch with the minted session cookie for
// URLs under `base` (the established v1.43 helper contract) - plain fetch()
// below rides the real auth gate.
async function json(method, urlPath, body) {
  return fetch(`${base}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// ---- (a) the corner mirror keys --------------------------------------------

test('corner keys ride the /api/me/settings mirror: all four accepted, read back via /api/auth/me', async () => {
  const res = await json('POST', '/api/me/settings', { cornerTL: 'queue', cornerTR: 'delete', cornerBL: 'none', cornerBR: 'transcript' });
  assert.equal(res.status, 200);
  const me = await (await json('GET', '/api/auth/me')).json();
  assert.equal(me.settings.cornerTL, 'queue');
  assert.equal(me.settings.cornerTR, 'delete');
  assert.equal(me.settings.cornerBL, 'none');
  assert.equal(me.settings.cornerBR, 'transcript');
  await json('POST', '/api/me/settings', { cornerBR: null }); // leave no residue for later cases
});

test('corner values are bounded like their siblings; null clears back to default-absent', async () => {
  assert.equal((await json('POST', '/api/me/settings', { cornerTL: 'x'.repeat(40) })).status, 400, 'over-length refused');
  assert.equal((await json('POST', '/api/me/settings', { cornerTL: 'has space' })).status, 400, 'charset-violating refused');
  assert.equal((await json('POST', '/api/me/settings', { cornerTL: null })).status, 200, 'null clears');
  const me = await (await json('GET', '/api/auth/me')).json();
  assert.equal(me.settings.cornerTL, undefined, 'cleared key is absent (C5 default applies client-side)');
});

test('the lane stays SHAPE-only: a charset-valid unknown control value is stored (the renderer defends, plan D1)', async () => {
  assert.equal((await json('POST', '/api/me/settings', { cornerBL: 'not_a_control' })).status, 200);
  const me = await (await json('GET', '/api/auth/me')).json();
  assert.equal(me.settings.cornerBL, 'not_a_control');
  assert.equal((await json('POST', '/api/me/settings', { cornerBL: null })).status, 200); // leave no residue
});

test('v1.204: cornerBR IS a mirrored key now (the bottom-right slot persists) - accepted, bounded, null clears', async () => {
  assert.equal((await json('POST', '/api/me/settings', { cornerBR: 'queue' })).status, 200, 'the new slot persists');
  let me = await (await json('GET', '/api/auth/me')).json();
  assert.equal(me.settings.cornerBR, 'queue', 'read back via /api/auth/me');
  assert.equal((await json('POST', '/api/me/settings', { cornerBR: 'has space' })).status, 400, 'still charset-bounded like its siblings');
  assert.equal((await json('POST', '/api/me/settings', { cornerBR: null })).status, 200, 'null clears');
  me = await (await json('GET', '/api/auth/me')).json();
  assert.equal(me.settings.cornerBR, undefined, 'cleared key is absent (C5 default none applies client-side)');
  // and a truly unknown key is still rejected - the allowlist did not widen.
  assert.equal((await json('POST', '/api/me/settings', { cornerZZ: 'queue' })).status, 400, 'a bogus corner key is still 400');
});

// ---- (b) watchUrl on the list projection -----------------------------------

test('/api/videos items carry the server-derived watchUrl exactly when a SAFE youtubeId exists, never otherwise', async () => {
  saveDatabase({
    folders: ['/media/Movies'],
    folderSettings: {},
    progress: {},
    metadata: {
      withId: {
        id: 'withId', title: 'From YouTube', type: 'video', ext: '.mp4',
        folderName: 'Movies', rootFolder: '/media/Movies',
        size: 1000, addedAt: 1700000000000, youtubeId: 'dQw4w9WgXcQ',
      },
      noId: {
        id: 'noId', title: 'Local file', type: 'video', ext: '.mp4',
        folderName: 'Movies', rootFolder: '/media/Movies',
        size: 1000, addedAt: 1700000000001,
      },
      badId: {
        id: 'badId', title: 'Corrupt id', type: 'video', ext: '.mp4',
        folderName: 'Movies', rootFolder: '/media/Movies',
        size: 1000, addedAt: 1700000000002, youtubeId: 'not safe!',
      },
    },
  });

  const res = await fetch(`${base}/api/videos`);
  assert.equal(res.status, 200);
  const { items } = await res.json();
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));

  assert.equal(byId.withId.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'safe youtubeId -> the exact single-item-route derivation');
  assert.ok(!('watchUrl' in byId.noId), 'no youtubeId -> no watchUrl key at all (C4: the share corner renders nothing)');
  assert.ok(!('watchUrl' in byId.badId), 'unsafe youtubeId -> buildWatchUrl null -> key absent, never a mangled URL');
});
