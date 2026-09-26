'use strict';

// [INTEGRATION] v1.338 (Dean: "Is there a reason we can't just like share from the bottom right corner?"
// / "anything that can and is grabbed should be kind of treated and formed the same way"; plan
// docs/exec-plans/active/2026-09-26-first-class-any-site.md D5): every surface a card reads carries a
// download from another site's SAVED page link as `sourceShareUrl` (re-checked at serve), never as
// `watchUrl`; the Liked list gains the YouTube `watchUrl` it never derived. Driven through the real app.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-share-lists-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, __resetDatabaseForTests, updateDatabase } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

const PAGE = 'https://www.reddit.com/r/videos/comments/abc123/a_clip/';
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
let server;
let base;

before(async () => {
  await __resetDatabaseForTests();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
  const item = (id, over) => ({
    id, title: `zephyr ${id}`, filePath: `/media/Chan/${id}.mp4`, folderName: 'Chan', channelName: 'Chan',
    type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: 5000, ...over,
  });
  seedState({
    folders: [], folderSettings: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    metadata: {
      r: item('r', { sourceExtractor: 'Reddit', sourceId: 'abc123', sourceUrl: PAGE }),
      h: item('h', { sourceExtractor: 'Reddit', sourceId: 'bad001', sourceUrl: 'javascript:alert(1)' }), // planted
      n: item('n', { sourceExtractor: 'Facebook', sourceId: '99', sourceUrl: null }), // attempted, none
      y: item('y', { youtubeId: 'dQw4w9WgXcQ' }),
      p: item('p', { sourceUrl: PAGE }), // a plain file carrying a stray key: not a download from another site
    },
  });
  for (const id of ['r', 'h', 'n', 'y', 'p']) {
    assert.strictEqual((await fetch(`${base}/api/liked/${id}`, { method: 'POST' })).status, 200);
  }
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

async function json(p) {
  const res = await fetch(base + p);
  assert.strictEqual(res.status, 200, p);
  return res.json();
}

function check(items, where) {
  const by = (id) => items.find((i) => i.id === id);
  assert.ok(by('r') && by('h') && by('n') && by('y') && by('p'), `${where}: all five items listed`);
  assert.strictEqual(by('r').sourceShareUrl, PAGE, `${where}: the saved link is served`);
  assert.ok(!('watchUrl' in by('r')), `${where}: never as watchUrl (that one feeds the chapter share)`);
  assert.ok(!('sourceShareUrl' in by('h')), `${where}: a planted hostile link is re-checked away`);
  assert.ok(!('sourceShareUrl' in by('n')), `${where}: an attempted-none link serves nothing`);
  assert.strictEqual(by('y').watchUrl, YT, `${where}: YouTube keeps its watchUrl`);
  assert.ok(!('sourceShareUrl' in by('y')), `${where}: and gets no sourceShareUrl`);
  assert.ok(!('sourceShareUrl' in by('p')), `${where}: a plain file is not a download from another site`);
  // gate r1 qa 7: the RAW saved link never rides a list (only the re-checked sourceShareUrl does).
  for (const id of ['r', 'h', 'p']) assert.ok(!('sourceUrl' in by(id)), `${where}: no raw sourceUrl on ${id}`);
}

test('GET /api/videos carries the saved link for a download from another site', async () => {
  check((await json('/api/videos?limit=50')).items, '/api/videos');
});

test('GET /api/liked carries it too, AND the YouTube watchUrl it never derived before', async () => {
  const body = await json('/api/liked?limit=50');
  check((body.items || body).filter((i) => i.kind === 'media' || !i.kind), '/api/liked');
});

test('gate r1 qa 7: GET /api/history never carries the raw saved link either', async () => {
  const res = await fetch(`${base}/api/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'r', timestamp: 5, duration: 60 }) });
  assert.strictEqual(res.status, 200);
  const r = (await json('/api/history?limit=50')).items.find((i) => i.id === 'r');
  assert.ok(r, 'the watched item is in history');
  assert.ok(!('sourceUrl' in r), 'no raw sourceUrl on /api/history');
});

test('the modern grid (field-complete projection) carries it', async () => {
  check((await json('/api/home?view=grid&filter=all&limit=50')).items, '/api/home?view=grid');
});

test('search results carry it', async () => {
  check((await json('/api/search?q=zephyr&limit=50')).items, '/api/search');
});

test('the watch route answers from the SAVED link at once (no probe needed)', async () => {
  const r = await json('/api/videos/r');
  assert.strictEqual(r.sourceShareUrl, PAGE);
  assert.ok(!('watchUrl' in r));
  const h = await json('/api/videos/h');
  assert.ok(!('sourceShareUrl' in h), 'a planted link is never served (and its file does not exist to probe)');
  assert.ok(!('sourceUrl' in r) && !('sourceUrl' in h), 'the raw saved link never rides the watch route');
});

// ---- v1.338 D7: the site badge as the uploader avatar ----------------------------------

test('D7: a download from another site shows its site badge as the avatar on the lists; YouTube / plain unchanged', async () => {
  for (const [p, key] of [['/api/videos?limit=50', 'items'], ['/api/home?view=grid&filter=all&limit=50', 'items']]) {
    const items = (await json(p))[key];
    const by = (id) => items.find((i) => i.id === id);
    assert.strictEqual(by('r').channelAvatarUrl, '/assets/sites/reddit.svg', `${p}: Reddit badge`);
    assert.strictEqual(by('n').channelAvatarUrl, '/assets/sites/facebook.svg', `${p}: Facebook badge`);
    assert.strictEqual(by('p').channelAvatarUrl, '', `${p}: a plain file keeps the letter avatar`);
    assert.strictEqual(by('y').channelAvatarUrl, '', `${p}: a YouTube item with no known channel keeps the letter avatar`);
  }
});

test('D7: the watch route shows the badge (the yt-dlp module on), and the badge file is served to a signed-in user', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  try {
    assert.strictEqual((await json('/api/videos/r')).channelAvatarUrl, '/assets/sites/reddit.svg');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
  }
  const res = await fetch(`${base}/assets/sites/reddit.svg`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /image\/svg\+xml/);
  assert.match(await res.text(), /aria-label="Reddit"/);
});

test('D7 (gate adversary r1 W2): GET /api/channels keeps a YouTube channel\'s REAL photo when a download from another site shares its folder; a site-only folder gets the badge', async () => {
  const photo = 'https://yt3.ggpht.com/real-photo=s88';
  await updateDatabase((db) => {
    // The Reddit clip comes FIRST (rowid order), so a first-wins pick would take its badge.
    db.metadata.mx1 = { id: 'mx1', title: 'clip', filePath: '/media/Mixed/mx1.mp4', folderName: 'Mixed', type: 'video', ext: '.mp4', addedAt: 1, sourceExtractor: 'Reddit', sourceId: 'mx1' };
    db.metadata.mx2 = { id: 'mx2', title: 'v', filePath: '/media/Mixed/mx2.mp4', folderName: 'Mixed', type: 'video', ext: '.mp4', addedAt: 2, youtubeId: 'dQw4w9WgXcQ', channelName: 'Mixed', channelAvatarUrl: photo };
    return true;
  });
  try {
    const channels = (await json('/api/channels')).channels;
    assert.strictEqual(channels.find((c) => c.folder === 'Mixed').avatarUrl, photo, 'the real photo wins over the badge');
    assert.strictEqual(channels.find((c) => c.folder === 'Chan').avatarUrl, '/assets/sites/reddit.svg', 'no real photo anywhere in the folder: the badge');
  } finally {
    await updateDatabase((db) => { delete db.metadata.mx1; delete db.metadata.mx2; return true; });
  }
});
