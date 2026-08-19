'use strict';

// [INTEGRATION] v1.15.0 item 9 -- additive smoke coverage for GET /api/videos's
// actual filtering BEHAVIOR (?root=, ?folder=, ?search=, and the default-view
// hidden-folder filter). Existing tests (test/integration/api.test.js,
// test/integration/hidden-from-sidebar-api.test.js) already cover the basic
// 200/array shape and that hiddenFromSidebar/root-reachability doesn't 404 --
// this file fills the gap of asserting the actual returned CONTENT for each
// filter, which was previously untested. Isolated DATA_DIR before requiring
// the app, own process per file (node --test).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-videos-filters-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, __resetDatabaseForTests } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  // v1.42: SQLite replaced db.json; the sanctioned between-test reset.
  await __resetDatabaseForTests();
});

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent.
function writeDb(db) {
  saveDatabase(db);
}

// v1.30 A5 (T6): `/api/videos` returns `{ items, total, offset, limit }`, not
// a bare array. Returns the parsed `items` array under `body` so every
// pre-existing `body.map(...)`/`body.find(...)` call site below stays
// unchanged -- only this helper needed to know about the new envelope.
async function getVideos(qs) {
  const res = await fetch(`${base}/api/videos${qs ? `?${qs}` : ''}`);
  const json = await res.json();
  return { status: res.status, body: json.items, total: json.total };
}

function seedItem(id, overrides) {
  return {
    id,
    title: id,
    type: 'video',
    ext: '.mp4',
    folderName: 'Movies',
    rootFolder: '/media/Movies',
    filePath: `/media/Movies/${id}.mp4`,
    artist: '',
    size: 1000,
    addedAt: 1700000000000,
    ...overrides,
  };
}

test('?root= only returns items whose filePath is under that root, excluding sibling folders', async () => {
  writeDb({
    folders: ['/media/Movies', '/media/TV'],
    folderSettings: {},
    progress: {},
    metadata: {
      m1: seedItem('m1', { rootFolder: '/media/Movies', filePath: '/media/Movies/m1.mp4' }),
      t1: seedItem('t1', { rootFolder: '/media/TV', filePath: '/media/TV/t1.mp4', folderName: 'TV' }),
    },
  });

  const { status, body } = await getVideos(`root=${encodeURIComponent('/media/Movies')}`);
  assert.equal(status, 200);
  assert.deepEqual(body.map((i) => i.id), ['m1'], 'only the item under the requested root is returned');
});

test('?root= is recursive -- it also returns items nested in subfolders under that root', async () => {
  writeDb({
    folders: ['/media/Movies'],
    folderSettings: {},
    progress: {},
    metadata: {
      nested: seedItem('nested', { rootFolder: '/media/Movies', filePath: '/media/Movies/Sub/nested.mp4', folderName: 'Sub' }),
    },
  });

  const { body } = await getVideos(`root=${encodeURIComponent('/media/Movies')}`);
  assert.deepEqual(body.map((i) => i.id), ['nested']);
});

test('?folder= (channel filter) matches only items whose immediate folderName equals the requested value', async () => {
  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      a: seedItem('a', { folderName: 'ChannelA' }),
      b: seedItem('b', { folderName: 'ChannelB' }),
    },
  });

  const { body } = await getVideos(`folder=${encodeURIComponent('ChannelA')}`);
  assert.deepEqual(body.map((i) => i.id), ['a']);
});

test('?search= matches on title OR folderName, case-insensitively', async () => {
  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      a: seedItem('a', { title: 'A Great Vacation', folderName: 'Home Movies' }),
      b: seedItem('b', { title: 'Unrelated Clip', folderName: 'Vacation Photos' }),
      c: seedItem('c', { title: 'Nothing Matches', folderName: 'Other' }),
    },
  });

  const { body } = await getVideos('search=VACATION');
  assert.deepEqual(body.map((i) => i.id).sort(), ['a', 'b'], 'matches by title OR folderName, case-insensitively');
});

test('default view (no filters) hides items under a folder marked hidden, but an explicit ?root= still reveals them', async () => {
  writeDb({
    folders: ['/media/Hidden', '/media/Visible'],
    folderSettings: { '/media/Hidden': { name: 'Hidden', hidden: true } },
    progress: {},
    metadata: {
      h1: seedItem('h1', { rootFolder: '/media/Hidden', filePath: '/media/Hidden/h1.mp4', folderName: 'Hidden' }),
      v1: seedItem('v1', { rootFolder: '/media/Visible', filePath: '/media/Visible/v1.mp4', folderName: 'Visible' }),
    },
  });

  const defaultView = await getVideos();
  assert.deepEqual(defaultView.body.map((i) => i.id), ['v1'], 'the default (unfiltered) view must exclude items under a hidden folder');

  const explicitRoot = await getVideos(`root=${encodeURIComponent('/media/Hidden')}`);
  assert.deepEqual(explicitRoot.body.map((i) => i.id), ['h1'], 'opening a hidden folder directly (?root=) still shows its contents');
});

test('a folder marked hidden is still reachable via ?search= (only the no-filter default view applies the hidden-folder rule)', async () => {
  writeDb({
    folders: ['/media/Hidden'],
    folderSettings: { '/media/Hidden': { name: 'Hidden', hidden: true } },
    progress: {},
    metadata: {
      h1: seedItem('h1', { title: 'Findable Clip', rootFolder: '/media/Hidden', filePath: '/media/Hidden/h1.mp4', folderName: 'Hidden' }),
    },
  });

  const { body } = await getVideos('search=findable');
  assert.deepEqual(body.map((i) => i.id), ['h1'], 'the hidden-folder rule is scoped to the no-filter default view only');
});

test('no folder is marked hidden -> the default view returns everything unfiltered', async () => {
  writeDb({
    folders: ['/media/A', '/media/B'],
    folderSettings: {},
    progress: {},
    metadata: {
      a: seedItem('a', { rootFolder: '/media/A', filePath: '/media/A/a.mp4' }),
      b: seedItem('b', { rootFolder: '/media/B', filePath: '/media/B/b.mp4' }),
    },
  });

  const { body } = await getVideos();
  assert.deepEqual(body.map((i) => i.id).sort(), ['a', 'b']);
});

// ---- v1.149: search scopes (?searchIn=all|title|channel) --------------------

test('v1.149: searching a CHANNEL NAME finds its items even when the folder differs (the original gap), and display names match too', async () => {
  writeDb({
    folders: ['/media/Downloads'],
    folderSettings: {},
    folderDisplayNames: { rohordner: 'Omas Küche' },
    progress: {},
    metadata: {
      byChannel: seedItem('byChannel', { title: 'Ein Rezept', folderName: 'ytdlp-downloads', filePath: '/media/Downloads/a.mp4', channelName: 'Kochen mit Maria' }),
      byDisplay: seedItem('byDisplay', { title: 'Anderes Video', folderName: 'rohordner', filePath: '/media/Downloads/b.mp4' }),
      unrelated: seedItem('unrelated', { title: 'Nix Davon', folderName: 'sonstiges', filePath: '/media/Downloads/c.mp4', channelName: 'Anderer Kanal' }),
    },
  });
  // channelName match - pre-v1.149 this returned NOTHING (folder differs).
  let r = await getVideos('search=kochen%20mit%20maria');
  assert.deepEqual(r.body.map((i) => i.id), ['byChannel']);
  // v1.126 display-name match - also previously invisible to search.
  r = await getVideos('search=omas');
  assert.deepEqual(r.body.map((i) => i.id), ['byDisplay']);
});

test('v1.149: searchIn=title and searchIn=channel narrow with NO leaks; junk searchIn falls back to all', async () => {
  writeDb({
    folders: ['/media/Downloads'],
    folderSettings: {},
    progress: {},
    metadata: {
      titleHit: seedItem('titleHit', { title: 'Brotkanal Spezial', folderName: 'irgendwo', filePath: '/media/Downloads/t.mp4' }),
      channelHit: seedItem('channelHit', { title: 'Sauerteig Folge 3', folderName: 'anderswo', filePath: '/media/Downloads/c.mp4', channelName: 'Brotkanal' }),
    },
  });
  // all (default): both match "brotkanal".
  let r = await getVideos('search=brotkanal');
  assert.deepEqual(r.body.map((i) => i.id).sort(), ['channelHit', 'titleHit']);
  // title: only the title hit - the channel-identity match must not leak.
  r = await getVideos('search=brotkanal&searchIn=title');
  assert.deepEqual(r.body.map((i) => i.id), ['titleHit']);
  // channel: only the channel hit - the title match must not leak.
  r = await getVideos('search=brotkanal&searchIn=channel');
  assert.deepEqual(r.body.map((i) => i.id), ['channelHit']);
  // junk scope: the permissive fallback to all, never a 400/empty.
  r = await getVideos('search=brotkanal&searchIn=kanäle');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((i) => i.id).sort(), ['channelHit', 'titleHit']);
});
