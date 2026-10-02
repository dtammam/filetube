'use strict';

// [INTEGRATION] v1.354 W1 (gate r1 adversary W2): every OTHER caller of fetchAllRows is bound - the
// Artists / Albums levels, the album and artist drills (and the untagged bucket), the Liked playlist,
// the music-link play / shuffle paths - plus the loop's own rules (an empty page ends it, the
// offset/total stop, a failed read retries on the next open). The REAL music.js + skin engine run in
// jsdom; the list routes are a fake honouring limit/offset over 12,500 rows (3 pages of 5000).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-paging2-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { createPocketHarness } = require('../helpers/pocket-menu-harness');

let server, base, auth, authedFetch;
const ROOT = path.join(DATA_DIR, 'ytdlp');
const H = createPocketHarness(() => ({ base, authedFetch }));
const { menu, select, labels, tapRow, settleNet, click, cursorLabel } = H;

const N = 12500;
const PAGES = [0, 5000, 10000];

function track(i, extra) {
  const id = 'q' + String(i).padStart(5, '0');
  return Object.assign({ id, type: 'audio', title: 'Song ' + String(i).padStart(5, '0'), artist: 'Zed Band', album: 'Zed Album', albumKey: 'zed band|zed album',
    genre: 'Music', duration: 200, source: 'library', streamSrc: '/media/' + id, track: (i % 20) + 1 }, extra || {});
}

// routes: fn(pathname, params) -> the FULL list (array) or null (not served here). Serves limit/offset
// exactly like the real route (limit clamped to 10,000); records every paged request.
function fake(log, routes, opts) {
  const o = opts || {};
  return (u) => {
    const url = new URL(u, 'http://x');
    if (!url.pathname.startsWith('/api/music')) return null;
    const list = routes(url.pathname, url.searchParams);
    if (!list) return null;
    const limit = Number(url.searchParams.get('limit')); const offset = Number(url.searchParams.get('offset'));
    log.push({ url: u, path: url.pathname, offset, limit });
    if (o.fail && o.fail(log.length, offset)) return { ok: false, status: 500, json: async () => ({}) };
    const slice = o.pageOf ? o.pageOf(list, offset) : list.slice(offset, offset + Math.min(limit, 10000));
    return { ok: true, status: 200, json: async () => ({ items: slice, total: o.total != null ? o.total : list.length, offset, limit: Math.min(limit, 10000) }) };
  };
}
const offsetsOf = (log, re) => log.filter((r) => re.test(r.url)).map((r) => r.offset);
const pagedReads = (log) => log.filter((r) => r.path === '/api/music' && r.limit === 5000);
// the rows are windowed: prove the TAIL by the quick-scroll's last letter (the tail titles start with Z)
async function jumpLast(h) {
  click(h.dom, h.panel.querySelector('[data-skin-letters]')); await settleNet(5);
  const letters = [...h.panel.querySelectorAll('[data-skin-letter]')];
  click(h.dom, letters[letters.length - 1]); await settleNet(5);
  return cursorLabel(h);
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  authedFetch = global.fetch;
  seedState({ folders: [ROOT], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    db.metadata = { s1: { id: 's1', type: 'audio', title: 'Seed', name: 's1.mp3', filePath: path.join(ROOT, 'a', 's1.mp3'), rootFolder: ROOT, folderName: 'a', channelName: 'Seed Artist', duration: 200, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000, tags: { artist: 'Seed Artist' } } };
    return true;
  });
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const pad = (i) => String(i).padStart(5, '0');
const ARTISTS = Array.from({ length: N }, (_, i) => ({ artist: (i >= 12000 ? 'Z' : 'A') + ' Artist ' + pad(i), artIds: [] }));
const ALBUMS = Array.from({ length: N }, (_, i) => ({ album: (i >= 12000 ? 'Z' : 'A') + ' Album ' + pad(i), artist: 'Zed Band', albumKey: 'zed band|album ' + i }));
const TRACKS = Array.from({ length: N }, (_, i) => track(i, i >= 12000 ? { title: 'Z Song ' + pad(i), album: 'Late Album', albumKey: 'zed band|late album' } : { title: 'A Song ' + pad(i) }));
const LINK_TRACKS = TRACKS.slice(0, 5200); // two pages: enough to bind paging without rendering 12,500 rows

test('W1 paths: Artists reads every page once, in order, and lists every artist', async () => {
  const log = [];
  await H.boot({ skin: 'ipod', play: 's1', intercept: fake(log, (p) => (p === '/api/music/artists' ? ARTISTS : null)), run: async (h) => {
    menu(h); select(h); tapRow(h, 'Artists'); await settleNet(60);
    assert.deepStrictEqual(offsetsOf(log, /\/api\/music\/artists\?/), PAGES);
    assert.ok(log.every((r) => r.limit === 5000), 'one page = 5000 rows');
    assert.match(await jumpLast(h), /^Z Artist 12\d{3}$/, 'the Z jump lands in the artists past row 10,000');
  } });
});

test('W1 paths: Albums reads every page once, in order, and lists every album', async () => {
  const log = [];
  await H.boot({ skin: 'ipod', play: 's1', intercept: fake(log, (p) => (p === '/api/music/albums' ? ALBUMS : null)), run: async (h) => {
    menu(h); select(h); tapRow(h, 'Albums'); await settleNet(60);
    assert.deepStrictEqual(offsetsOf(log, /\/api\/music\/albums\?/), PAGES);
    assert.match(await jumpLast(h), /^Z Album 12\d{3}$/, 'the Z jump lands in the albums past row 10,000');
  } });
});

test('W1 paths: an album drill pages the album route (album + sort kept) and lists the tail rows', async () => {
  const log = [];
  const routes = (p, q) => (p === '/api/music/albums' ? ALBUMS.slice(0, 3) : (p === '/api/music' && q.get('album') ? TRACKS : null));
  await H.boot({ skin: 'ipod', play: 's1', intercept: fake(log, routes), run: async (h) => {
    menu(h); select(h); tapRow(h, 'Albums'); await settleNet(20);
    tapRow(h, 'A Album 00001'); await settleNet(60);
    const reads = pagedReads(log);
    assert.deepStrictEqual(reads.map((r) => r.offset), PAGES);
    assert.ok(reads.every((r) => /[?&]album=zed%20band%7Calbum%201&sort=/.test(r.url)), 'the album key and a sort ride every page: ' + reads[0].url);
  } });
});

test('W1 paths: an artist drill pages the artist route; its albums come from the whole list', async () => {
  const log = [];
  const routes = (p, q) => (p === '/api/music/artists' ? [{ artist: 'Zed Band', artIds: [] }] : (p === '/api/music' && q.get('artist') ? TRACKS : null));
  await H.boot({ skin: 'ipod', play: 's1', intercept: fake(log, routes), run: async (h) => {
    menu(h); select(h); tapRow(h, 'Artists'); await settleNet(20);
    tapRow(h, 'Zed Band'); await settleNet(60);
    const reads = pagedReads(log);
    assert.deepStrictEqual(reads.map((r) => r.offset), PAGES);
    assert.ok(reads.every((r) => /artist=Zed%20Band&sort=/.test(r.url)), 'the artist rides every page');
    assert.ok(labels(h).includes('Late Album'), 'an album only the last rows carry is listed: ' + labels(h).join('|'));
    // All Songs / an album off the SAME cached list: no further read
    const before = log.length;
    tapRow(h, 'Late Album'); await settleNet(20);
    assert.strictEqual(log.length, before, 'the cached whole list serves the album level');
    assert.strictEqual(labels(h)[0], 'Z Song 12000', 'Late Album = the tail rows, from the first of them');
  } });
});

test('W1 paths: the untagged artist bucket is gathered from the WHOLE library (rows past 10,000)', async () => {
  const log = [];
  const lib = Array.from({ length: N }, (_, i) => track(i, i >= 12400 ? { artist: '', albumArtist: '', album: 'Late Untagged', albumKey: '|late untagged' } : {}));
  const routes = (p, q) => (p === '/api/music/artists' ? [{ artist: '', artIds: [] }] : (p === '/api/music' && q.get('sort') === 'title-asc' && !q.get('artist') ? lib : null));
  await H.boot({ skin: 'ipod', play: 's1', intercept: fake(log, routes), run: async (h) => {
    menu(h); select(h); tapRow(h, 'Artists'); await settleNet(20);
    tapRow(h, 'Unknown Artist'); await settleNet(60);
    assert.deepStrictEqual(offsetsOf(log, /^\/api\/music\?sort=title-asc/), PAGES, 'the bucket reads the paged whole-library list, not the empty-artist route');
    assert.ok(!log.some((r) => /artist=/.test(r.url)), 'never the artist= route for ""');
    assert.deepStrictEqual(labels(h), ['Late Untagged']);
  } });
});

test('W1 paths: Playlists > Liked Songs pages the liked route and lists the tail', async () => {
  const log = [];
  const routes = (p, q) => (p === '/api/music' && q.get('filter') === 'liked' ? TRACKS : null);
  await H.boot({ skin: 'ipod', play: 's1', intercept: fake(log, routes), run: async (h) => {
    menu(h); select(h); tapRow(h, 'Playlists'); await settleNet(10);
    tapRow(h, 'Liked Songs'); await settleNet(60);
    assert.deepStrictEqual(offsetsOf(log, /filter=liked&sort=title-asc/), PAGES);
    assert.match(await jumpLast(h), /^Z Song 12\d{3}$/, 'the Z jump lands in the liked songs past row 10,000');
  } });
});

// ---- music links (the play / shuffle modes ride fetchAllRows too) ----
function linkBoot(search, intercept, run) {
  return H.boot({ skin: 'ipod', setup: (dom) => dom.reconfigure({ url: 'http://localhost/music' + search }), intercept, run });
}
const linkRoutes = () => (p, q) => (p === '/api/music' && (q.get('artist') || q.get('album') || q.get('filter') === 'liked') ? LINK_TRACKS : null);

test('W1 paths: a link PLAY of an artist pages the whole list (all pages, artist + sort kept)', async () => {
  const log = [];
  await linkBoot('?artist=Zed%20Band&mode=play', fake(log, linkRoutes()), async (h) => {
    await settleNet(80);
    assert.deepStrictEqual(offsetsOf(log, /artist=Zed%20Band&sort=(?!random)/), [0, 5000]);
    assert.ok(h.spy.loads.length >= 1, 'it started playing');
  });
});

test('W1 paths: a link SHUFFLE of an artist pages the seeded random list', async () => {
  const log = [];
  await linkBoot('?artist=Zed%20Band&mode=shuffle', fake(log, linkRoutes()), async (h) => {
    await settleNet(80);
    assert.deepStrictEqual(offsetsOf(log, /artist=Zed%20Band&sort=random&seed=\d+/), [0, 5000]);
    assert.ok(h.spy.loads.length >= 1);
  });
});

test('W1 paths: a link PLAY / SHUFFLE of an album pages the album list', async () => {
  for (const mode of ['play', 'shuffle']) {
    const log = [];
    await linkBoot('?artist=Zed%20Band&album=Zed%20Album&mode=' + mode, fake(log, linkRoutes()), async (h) => {
      await settleNet(80);
      assert.deepStrictEqual(offsetsOf(log, /\?album=/), [0, 5000], 'album ' + mode);
      assert.ok(h.spy.loads.length >= 1, 'album ' + mode + ' started playing');
    });
  }
});

test('W1 paths: a link to Liked pages it plain (play) and shuffled (the server seeded random)', async () => {
  const plain = [];
  await linkBoot('?playlist=liked&mode=play', fake(plain, linkRoutes()), async (h) => {
    await settleNet(80);
    assert.deepStrictEqual(offsetsOf(plain, /filter=liked&sort=title-asc/), [0, 5000]);
    assert.ok(h.spy.loads.length >= 1);
  });
  const shuf = [];
  await linkBoot('?playlist=liked&mode=shuffle', fake(shuf, linkRoutes()), async (h) => {
    await settleNet(80);
    assert.deepStrictEqual(offsetsOf(shuf, /filter=liked&sort=random&seed=\d+/), [0, 5000]);
    assert.ok(h.spy.loads.length >= 1);
  });
});

// ---- the loop's own rules ----
const SONGS = (p, q) => (p === '/api/music' && q.get('sort') === 'title-asc' && !q.get('artist') && !q.get('filter') ? TRACKS : null);

test('W1 paths: 12,500 rows = exactly 3 requests at offsets 0 / 5000 / 10000, 12,500 rows, none twice', async () => {
  const log = [];
  await H.boot({ skin: 'ipod', play: 's1', intercept: fake(log, SONGS), run: async (h) => {
    menu(h); select(h); tapRow(h, 'Songs'); await settleNet(60);
    const reads = pagedReads(log);
    assert.deepStrictEqual(reads.map((r) => r.offset), PAGES);
    assert.deepStrictEqual(reads.map((r) => r.limit), [5000, 5000, 5000]);
    const l = labels(h);
    assert.ok(l.length > 0 && new Set(l).size === l.length, 'no duplicated row among the rendered window');
    assert.match(await jumpLast(h), /^Z Song 12\d{3}$/, 'the tail (past 10,000) is reached');
  } });
});

test('W1 paths: a total that lands exactly on a page boundary stops there (no extra empty read)', async () => {
  const log = [];
  const ten = TRACKS.slice(0, 10000);
  await H.boot({ skin: 'ipod', play: 's1', intercept: fake(log, (p, q) => (SONGS(p, q) ? ten : null)), run: async (h) => {
    menu(h); select(h); tapRow(h, 'Songs'); await settleNet(60);
    assert.deepStrictEqual(offsetsOf(log, /^\/api\/music\?sort=title-asc/), [0, 5000]);
  } });
});

test('W1 paths: a reply with no total stops after its page (nothing to page on)', async () => {
  const log = [];
  const noTotal = (u) => {
    const f = fake(log, SONGS)(u);
    if (!f) return null;
    return { ok: true, status: 200, json: async () => { const d = await f.json(); return { items: d.items }; } };
  };
  await H.boot({ skin: 'ipod', play: 's1', intercept: noTotal, run: async (h) => {
    menu(h); select(h); tapRow(h, 'Songs'); await settleNet(40);
    assert.deepStrictEqual(offsetsOf(log, /^\/api\/music\?sort=title-asc/), [0]);
  } });
});

test('W1 paths: an EMPTY page ends the loop even when the total still promises more (a shrunk library)', async () => {
  const log = [];
  let served = 0;
  const intercept = (u) => {
    const url = new URL(u, 'http://x');
    if (!SONGS(url.pathname, url.searchParams)) return null;
    const offset = Number(url.searchParams.get('offset'));
    log.push({ url: u, path: url.pathname, offset });
    served += 1;
    if (served > 12) return { ok: false, status: 500, json: async () => ({}) }; // a runaway loop is bounded, and visible in the log
    const items = offset === 0 ? TRACKS.slice(0, 5000) : [];
    return { ok: true, status: 200, json: async () => ({ items, total: 99999, offset }) };
  };
  await H.boot({ skin: 'ipod', play: 's1', intercept, run: async (h) => {
    menu(h); select(h); tapRow(h, 'Songs'); await settleNet(60);
    assert.deepStrictEqual(offsetsOf(log, /^\/api\/music\?sort=title-asc/), [0, 5000], 'page 2 came back empty: the loop ended');
  } });
});

test('W1 paths: a failed page is not cached - re-opening Songs reads again from the start', async () => {
  const log = [];
  const intercept = fake(log, SONGS, { fail: (n, offset) => offset === 5000 && !log.slice(0, -1).some((r) => r.offset === 5000) });
  await H.boot({ skin: 'ipod', play: 's1', intercept, run: async (h) => {
    menu(h); select(h); tapRow(h, 'Songs'); await settleNet(40);
    assert.deepStrictEqual(log.map((r) => r.offset), [0, 5000], 'the first open died on page 2');
    menu(h); await settleNet(5);
    tapRow(h, 'Songs'); await settleNet(60);
    assert.deepStrictEqual(log.map((r) => r.offset), [0, 5000, 0, 5000, 10000], 'the retry re-read every page');
    assert.match(await jumpLast(h), /^Z Song 12\d{3}$/, 'the retry reached the tail');
  } });
});

test('W1 paths: a failed artist read is not cached either - re-opening the artist retries', async () => {
  const log = [];
  const routes = (p, q) => (p === '/api/music/artists' ? [{ artist: 'Zed Band', artIds: [] }] : (p === '/api/music' && q.get('artist') ? TRACKS : null));
  let failed = false;
  const intercept = fake(log, routes, { fail: (n, offset) => { if (offset === 5000 && !failed) { failed = true; return true; } return false; } });
  await H.boot({ skin: 'ipod', play: 's1', intercept, run: async (h) => {
    menu(h); select(h); tapRow(h, 'Artists'); await settleNet(20);
    tapRow(h, 'Zed Band'); await settleNet(40);
    menu(h); await settleNet(5);
    tapRow(h, 'Zed Band'); await settleNet(60);
    const reads = pagedReads(log).map((r) => r.offset);
    assert.deepStrictEqual(reads, [0, 5000, 0, 5000, 10000], 'the retry re-read every page');
    assert.ok(labels(h).includes('Late Album'));
  } });
});
