'use strict';

// [INTEGRATION] v1.70.0 QA W5 - the restore/retention-sweep race. The
// restore route's checks and its mutation are separated by one await; if the
// sweep's serialized write lands in that window and tombstones the record,
// the route must NOT report a success that did not happen. Bound here with
// registerRoutes on a bare express app and an updateDatabase hook that lets
// the "sweep" win the serialization race deterministically (the same
// interleaving technique as the delta-S1 unit test).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const podcasts = require('../../lib/podcasts');
const store = require('../../lib/podcasts/store');

let server, base, dataDir, db, deps, updateImpl;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-restore-race-'));
  db = { podcasts: { subscriptions: [], episodes: {}, settings: {} } };
  updateImpl = async (m) => { m(db); };
  deps = {
    dataDir,
    now: () => 1754150000000,
    loadDatabase: () => db,
    getCachedDatabase: () => db,
    // registerRoutes spreads deps into its own copy, so the hook must be a
    // STABLE function delegating to a swappable impl - reassigning
    // deps.updateDatabase after registration would never reach the routes.
    updateDatabase: (m) => updateImpl(m),
    runExclusive: (fn) => Promise.resolve(fn()),
    userStore: { removePodcastEpisodeState: () => {} },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1 }; next(); });
  podcasts.registerRoutes(app, deps);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('QA W5: a restore that loses the serialized-write race to the sweep answers 409, never a false "downloaded"', async () => {
  const root = path.join(dataDir, 'podcasts');
  const showDir = path.join(root, 'Show');
  const trashDir = path.join(root, '.filetube-trash');
  fs.mkdirSync(showDir, { recursive: true });
  fs.mkdirSync(trashDir, { recursive: true });
  const filePath = path.join(showDir, 'ep.mp3');
  const trashPath = path.join(trashDir, '1-ep1-ep.mp3');
  fs.writeFileSync(trashPath, 'THEBYTES');
  db.podcasts.episodes.ep1 = {
    id: 'ep1', subId: 's1', guid: 'g1', status: 'trashed',
    filePath, trashPath, trashedAt: 1000,
  };

  // Arm the race: the next updateDatabase call (the restore route's own
  // mutation) is preceded by the sweep's tombstone landing first in the
  // serialized write order.
  const realImpl = updateImpl;
  updateImpl = async (m) => {
    updateImpl = realImpl;
    store.reduceEpisodeStatus(store.ensurePodcasts(db), 'ep1', 'tombstone', { from: 'trashed' });
    await realImpl(m);
  };

  const r = await fetch(`${base}/api/podcasts/episodes/ep1/restore`, { method: 'POST' });
  assert.strictEqual(r.status, 409, 'the race is refused, not swallowed');
  const body = await r.json();
  assert.notStrictEqual(body.ok, true, 'no false success');
  assert.match(body.error, /changed state/, 'names the race');
  assert.strictEqual(db.podcasts.episodes.ep1.status, 'tombstone', 'the sweep\'s outcome stands');
  // The bytes the route had already moved out of trash went BACK - never
  // stranded at a path the tombstoned record no longer points to.
  assert.strictEqual(fs.existsSync(filePath), false, 'nothing left at the original path');
  assert.strictEqual(fs.readFileSync(trashPath, 'utf8'), 'THEBYTES', 'the bytes are back in trash, preserved');
});

test('sanity: with no race the same seed restores to downloaded (the harness is not vacuous)', async () => {
  const root = path.join(dataDir, 'podcasts');
  const filePath = path.join(root, 'Show', 'ep2.mp3');
  const trashPath = path.join(root, '.filetube-trash', '1-ep2-ep2.mp3');
  fs.writeFileSync(trashPath, 'BYTES2');
  db.podcasts.episodes.ep2 = {
    id: 'ep2', subId: 's1', guid: 'g2', status: 'trashed',
    filePath, trashPath, trashedAt: 1000,
  };
  const r = await fetch(`${base}/api/podcasts/episodes/ep2/restore`, { method: 'POST' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).status, 'downloaded');
  assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'BYTES2');
  assert.strictEqual(db.podcasts.episodes.ep2.status, 'downloaded');
});
