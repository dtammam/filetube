'use strict';

// [UNIT] v1.319 Chapter Snap - the routes module's POST-AWAIT re-checks
// (lib/media/chapterSnapRoutes.js), driven with injected deps so the one window an
// HTTP test cannot time is pinned exactly: the request PASSES the pre-await gate
// (restrictedVideoMutation, the cached item visible), and by the time its write tick
// runs the fresh record has become invisible to the caller (a restriction landed) or
// has changed (another writer). The write tick must refuse on the FRESH record -
// a pre-await guard is not a post-await guard (the v1.104 TOCTOU class).

const { test } = require('node:test');
const assert = require('node:assert');
const { registerChapterSnapRoutes } = require('../../lib/media/chapterSnapRoutes');
const snap = require('../../lib/media/chapterSnap');

function resolveItemChapters(item) {
  if (Array.isArray(item.chaptersManual) && item.chaptersManual.length) return { chapters: item.chaptersManual, chaptersSource: 'manual' };
  if (Array.isArray(item.chapters) && item.chapters.length) return { chapters: item.chapters, chaptersSource: 'embedded' };
  return { chapters: [], chaptersSource: null };
}

// A fake Express app capturing handlers, a fake req/res, and a write chain whose
// FRESH db the test controls (what the tick sees vs what the gate saw).
function harness({ freshItem, visibleInTick }) {
  const routes = {};
  const app = {
    get: (p, h) => { routes['GET ' + p] = h; },
    post: (p, h) => { routes['POST ' + p] = h; },
  };
  const cachedItem = { id: 'm1', type: 'audio', duration: 300, filePath: '/x.mp3', chapters: [{ startTime: 0, title: 'A' }, { startTime: 60, title: 'B' }, { startTime: 120, title: 'C' }] };
  const writes = [];
  registerChapterSnapRoutes(app, {
    requireModifyLibrary: () => true,
    restrictedVideoMutation: () => false, // the PRE-await gate passes
    mediaVisibleTo: (req, item) => (item === cachedItem ? true : visibleInTick),
    getCachedDatabase: () => ({ metadata: { m1: cachedItem } }),
    updateDatabase: async (fn) => {
      await Promise.resolve(); // the await window
      const db = { metadata: { m1: freshItem } };
      const r = fn(db);
      if (r !== false) writes.push(JSON.parse(JSON.stringify(db.metadata.m1)));
      return r;
    },
    resolveItemChapters,
    settingsStore: { getKey: () => 0.25 },
    silenceService: { stateFor: () => ({ state: 'none' }), start: () => 'running' },
  });
  const call = async (key, body) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await routes[key]({ params: { id: 'm1' }, body, user: { role: 'admin' } }, res);
    return res;
  };
  const version = snap.chaptersVersion(cachedItem, resolveItemChapters(cachedItem));
  return { call, writes, version, cachedItem };
}

test('a restriction that lands between the gate and the write tick: save AND revert refuse on the FRESH record (404), nothing written', async () => {
  const fresh = { id: 'm1', type: 'audio', duration: 300, chapters: [{ startTime: 0, title: 'A' }, { startTime: 60, title: 'B' }, { startTime: 120, title: 'C' }] };
  const h = harness({ freshItem: fresh, visibleInTick: false });
  const r = await h.call('POST /api/videos/:id/chapter-snap', { version: h.version, starts: [0, 61, 121] });
  assert.strictEqual(r.statusCode, 404);
  const rv = await h.call('POST /api/videos/:id/chapter-snap/revert', { version: h.version });
  assert.strictEqual(rv.statusCode, 404);
  assert.deepStrictEqual(h.writes, [], 'nothing written');
  assert.strictEqual(fresh.chaptersManual, undefined);
});

test('the record changed between the gate and the write tick: the version is compared on the FRESH record (409), nothing written; an unchanged record saves', async () => {
  const changed = { id: 'm1', type: 'audio', duration: 300, chapters: [{ startTime: 0, title: 'A' }, { startTime: 65, title: 'B' }, { startTime: 120, title: 'C' }] };
  const h = harness({ freshItem: changed, visibleInTick: true });
  const r = await h.call('POST /api/videos/:id/chapter-snap', { version: h.version, starts: [0, 61, 121] });
  assert.strictEqual(r.statusCode, 409);
  assert.strictEqual(r.body.stale, true);
  assert.deepStrictEqual(h.writes, []);
  // Discrimination: the same request against an unchanged fresh record lands.
  const same = { id: 'm1', type: 'audio', duration: 300, chapters: [{ startTime: 0, title: 'A' }, { startTime: 60, title: 'B' }, { startTime: 120, title: 'C' }] };
  const h2 = harness({ freshItem: same, visibleInTick: true });
  const ok = await h2.call('POST /api/videos/:id/chapter-snap', { version: h2.version, starts: [0, 61, 121] });
  assert.strictEqual(ok.statusCode, 200);
  assert.deepStrictEqual(h2.writes[0].chaptersManual.map((c) => c.startTime), [0, 61, 121]);
});
