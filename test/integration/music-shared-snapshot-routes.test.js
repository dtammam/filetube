'use strict';

// [INTEGRATION] v1.386.0 speed pass (gate r1 adversary): the hot read routes take the SHARED track snapshot, so a run
// of them parses the music_tracks table at most once while it is unchanged (before: once per request - ~130 ms each
// at 23,000 tracks). Counts every full-table read (the store's getAll) across the routes the Home screen, the Pocket,
// covers, the queue, liked and search make; a route reverted to musicDb.read() counts one per request and goes red.
// A write in between is seen (one more read, fresh rows).

process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'filetube-shared-routes-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { app, updateDatabase, musicDb } = require('../../server');
const musicStore = require('../../lib/music/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;
const trk = (i) => {
  const meta = { artist: 'Band ' + (i % 3), albumArtist: 'Band ' + (i % 3), album: 'Album ' + (i % 4), title: 'Song ' + i, trackNo: i };
  const id = crypto.createHash('md5').update('/m/' + i).digest('hex');
  return Object.assign({ id, filePath: '/m/' + i + '.mp3', rootFolder: '/m', ext: '.mp3', addedAt: new Date(1780000000000 + i).toISOString(), albumArtKey: 'k' + (i % 4) }, meta);
};
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  await updateDatabase(() => musicDb.mutate((h) => { const ns = musicStore.ensureMusic(h); ns.folders = ['/m']; for (let i = 0; i < 40; i++) { const t = trk(i); ns.tracks[t.id] = t; } return true; }));
});
after(() => { auth.restore(); server.close(); });

const ROUTES = ['/api/music?limit=10', '/api/music?sort=title-asc&limit=5', '/api/music/albums?limit=12', '/api/music/artists?limit=12', '/api/music/stations',
  '/api/music/config', '/api/music/liked', '/api/queue', '/api/liked?limit=1', '/api/search?q=Song'];

test('a run of the hot read routes parses the track table at most once; a write is seen with one more read', async () => {
  const parts = musicDb.parts.tracks;
  const real = parts.getAll;
  let reads = 0;
  parts.getAll = function () { reads++; return real.apply(this, arguments); };
  try {
    const one = trk(1);
    for (const r of ROUTES) { const res = await fetch(base + r); assert.strictEqual(res.status, 200, r); await res.arrayBuffer(); }
    for (const r of ['/api/music/' + one.id, '/track/' + one.id, '/albumart/' + one.id]) { const res = await fetch(base + r); await res.arrayBuffer(); }
    assert.ok(reads <= 1, `the routes shared one snapshot (full-table reads: ${reads})`);
    const n0 = reads;
    await updateDatabase(() => musicDb.mutate((h) => { const t = trk(99); musicStore.ensureMusic(h).tracks[t.id] = t; return true; }));
    const afterWrite = reads; // the mutate's own fresh read (a writer never takes the snapshot)
    assert.ok(afterWrite > n0, 'the writer read the table itself');
    const body = await (await fetch(base + '/api/music?search=Song%2099')).json();
    assert.strictEqual(body.total, 1, 'the new track is listed');
    assert.strictEqual(reads, afterWrite + 1, 'one rebuild after the write');
  } finally { parts.getAll = real; }
});
