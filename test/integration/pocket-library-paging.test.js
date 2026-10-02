'use strict';

// [INTEGRATION] v1.354 W1: a library past the server's 10,000-row request ceiling reaches every
// iPod menu. The REAL music.js view + skin engine run in jsdom against a real server (its own
// DATA_DIR) for the player and the small routes; the three list routes the menus page are served
// by a fake that honours offset/limit over a 23,000-song library whose LAST 300 titles ("Z ...")
// carry a genre only they have ("Zydeco"). Anything that cuts the list short never sees them.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-paging-'));
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
const { menu, select, labels, cursorLabel, tapRow, settleNet, click } = H;

const TOTAL = 23000;
const ZFROM = TOTAL - 300;
function song(i) {
  const z = i >= ZFROM;
  const letter = z ? 'Z' : String.fromCharCode(65 + Math.floor((i * 25) / ZFROM));
  const id = 'p' + String(i).padStart(5, '0');
  return { id, type: 'audio', title: letter + ' Song ' + String(i).padStart(5, '0'), artist: z ? 'Zed Band' : 'Bulk Band', album: z ? 'Zed Album' : 'Bulk Album',
    albumKey: z ? 'zed|zed album' : 'bulk|bulk album', genre: z ? 'Zydeco' : 'Music', duration: 200, source: 'library', streamSrc: '/media/' + id, track: (i % 20) + 1 };
}
const ALL = Array.from({ length: TOTAL }, (_, i) => song(i));

function pagedFake(log, opts) {
  const o = opts || {};
  return (u) => {
    const m = /^\/api\/music\?(?:sort=(title-asc|random)(?:&seed=\d+)?|filter=liked&sort=title-asc)&limit=(\d+)&offset=(\d+)$/.exec(u);
    if (!m) return null;
    const limit = Number(m[2]); const offset = Number(m[3]);
    log.push({ url: u, offset, limit });
    const list = /random/.test(u) ? ALL.slice().reverse() : ALL; // a stable order across pages
    const body = { items: list.slice(offset, offset + Math.min(limit, 10000)), total: list.length, offset, limit: Math.min(limit, 10000) };
    return { ok: true, status: 200, json: async () => { if (o.onPage) await o.onPage(offset); return body; } };
  };
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

test('W1: Songs reads every page in order, once each, and its last letter reaches the last titles', async () => {
  const log = [];
  await H.boot({ skin: 'ipod', play: 's1', intercept: pagedFake(log), run: async (h) => {
    menu(h); select(h); tapRow(h, 'Songs'); await settleNet(60);
    const pages = log.filter((r) => /sort=title-asc/.test(r.url)).map((r) => r.offset);
    assert.deepStrictEqual(pages, [0, 5000, 10000, 15000, 20000], 'every page, in order, none twice');
    click(h.dom, h.panel.querySelector('[data-skin-letters]')); await settleNet(5);
    const letters = [...h.panel.querySelectorAll('[data-skin-letter]')];
    assert.ok(letters.length > 0, 'the picker lists the letters');
    click(h.dom, letters[letters.length - 1]); await settleNet(5);
    assert.match(cursorLabel(h), /^Z Song 2\d{4}$/, 'the Z jump lands in the titles past row 10,000: ' + cursorLabel(h));
  } });
});

test('W1: Genres is built from the WHOLE library (a genre only the last rows carry is listed)', async () => {
  const log = [];
  await H.boot({ skin: 'ipod', play: 's1', intercept: pagedFake(log), run: async (h) => {
    menu(h); select(h); tapRow(h, 'Genres'); await settleNet(60);
    assert.ok(labels(h).includes('Zydeco'), 'Zydeco listed: ' + labels(h).join('|'));
  } });
});

test('W1: Shuffle Songs plays from the whole library (its queue holds ids past the first 10,000)', async () => {
  const log = [];
  await H.boot({ skin: 'ipod', play: 's1', intercept: pagedFake(log), run: async (h) => {
    menu(h); tapRow(h, 'Shuffle Songs'); await settleNet(60);
    const pages = log.filter((r) => /sort=random/.test(r.url)).map((r) => r.offset);
    assert.deepStrictEqual(pages, [0, 5000, 10000, 15000, 20000], 'every shuffle page, in order, none twice');
    assert.ok(h.spy.loads.length >= 1, 'the shuffle started playing');
    assert.strictEqual(h.spy.loads[h.spy.loads.length - 1].id, ALL[TOTAL - 1].id, 'the first track is the first of the (stable) random order');
  } });
});

test('W1: tearing the view down while page 2 is in flight stops the paging (page 3 is never requested)', async () => {
  const log = [];
  const hold = { h: null, fired: false };
  await H.boot({ skin: 'ipod', play: 's1', intercept: pagedFake(log, { onPage: async (offset) => { if (offset === 5000 && !hold.fired) { hold.fired = true; hold.h.mod.destroy(); } } }), run: async (h) => {
    hold.h = h;
    menu(h); select(h); tapRow(h, 'Songs');
    await settleNet(80);
    assert.ok(hold.fired, 'precondition: page 2 was reached and the view torn down under it');
    const pages = log.filter((r) => /sort=title-asc/.test(r.url)).map((r) => r.offset);
    assert.deepStrictEqual(pages, [0, 5000], 'the loop stopped after the page in flight');
    h.mod.init(h.D.getElementById('view-root')); await settleNet(); // the harness destroys once more at the end
  } });
});
