'use strict';

// [UNIT] v1.354 (W4, gate r1): the search level reaches the library THROUGH the real music.js view. The view and the
// skin engine run in jsdom; every network read is a fake that logs its url, so what the menu asks for is what is asserted.

const { test } = require('node:test');
const assert = require('node:assert');
const { createPocketHarness } = require('../helpers/pocket-menu-harness');

const H = createPocketHarness(() => ({ base: 'http://localhost', authedFetch: async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) }) }));
const { menu, tapRow, settleNet, click, labels, rows } = H;

const song = (id, title) => ({ id, type: 'audio', title, artist: 'Band', album: 'Alb', albumKey: 'band|alb', genre: 'G', duration: 200, source: 'library', streamSrc: '/media/' + id, channelName: 'Band' });
const json = (body) => ({ ok: true, status: 200, json: async () => body });

function fake(log) {
  return (u) => {
    log.push(u);
    if (/^\/api\/music\?search=/.test(u)) return json({ items: [song('a1', 'Probe One'), song('a2', 'Probe Two')], total: 2 });
    if (/^\/api\/music\/albums\?search=/.test(u)) return json({ items: [{ album: 'Probe Album', albumKey: 'band|probe album', artist: 'Band', artId: 'a1' }], total: 1 });
    if (/^\/api\/music\/artists\?search=/.test(u)) return json({ items: [{ artist: 'Probe Band', artIds: ['a1'], avatarUrl: '' }], total: 1 });
    if (/^\/api\/music\/s1$/.test(u)) return json(song('s1', 'Seed'));
    if (/^\/api\/music\?sort=newest&limit=1000$/.test(u)) return json({ items: [song('s1', 'Seed')], total: 1 });
    return json({ items: [], total: 0 });
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE = 320;
const typeVisible = (h, ch) => {
  const el = [...h.panel.querySelectorAll('.ipm-sc')].find((e) => e.getAttribute('aria-label') === ch);
  if (!el) throw new Error('cell ' + ch + ' not in the window');
  click(h.dom, el);
};

async function openSearch(h) {
  menu(h); tapRow(h, 'Music'); tapRow(h, 'Search');
  assert.strictEqual(h.panel.querySelector('.ip-np').textContent, 'Search');
  for (const ch of ['A', 'B', 'C']) typeVisible(h, ch);
  await wait(DEBOUNCE * 2);
  await settleNet(20);
}

test('X17: Music > Search in the REAL view reads the three routes with the typed query (the view wires cfg.menu.search)', async () => {
  const log = [];
  await H.boot({ skin: 'ipod', play: 's1', intercept: fake(log), run: async (h) => {
    await openSearch(h);
    const reads = log.filter((u) => /search=/.test(u));
    assert.deepStrictEqual(reads.sort(), [
      '/api/music/albums?search=ABC&sort=title-asc&limit=12',
      '/api/music/artists?search=ABC&sort=title-asc&limit=12',
      '/api/music?search=ABC&sort=title-asc&limit=30',
    ].sort(), 'one read per group, the whole word, once');
    assert.deepStrictEqual(labels(h), ['Songs', 'Probe One', 'Probe Two', 'Albums', 'Probe Album', 'Artists', 'Probe Band'], 'the real rows reach the screen');
    assert.strictEqual(rows(h).find((r) => /Probe Album/.test(r.textContent)).querySelector('.ipm-detail').textContent, 'Band', 'v1.374.0: a search album hit shows its artist (the Albums row)');
  } });
});

test('X18: a song picked from the results plays IN the result list under the search ctx', async () => {
  const log = [];
  await H.boot({ skin: 'ipod', play: 's1', intercept: fake(log), setup: (dom) => { dom.window.encodeListContext = (c) => JSON.stringify(c); }, run: async (h) => {
    await openSearch(h);
    const before = h.spy.loads.length;
    tapRow(h, 'Probe Two');
    await settleNet(20);
    assert.strictEqual(h.spy.loads.length, before + 1, 'the pick loaded a track');
    const last = h.spy.loads[h.spy.loads.length - 1];
    assert.strictEqual(last.id, 'a2', 'the picked row, not its neighbour');
    const ctx = typeof last.data.browseCtx === 'string' ? JSON.parse(last.data.browseCtx) : last.data.browseCtx;
    assert.strictEqual(ctx.search, 'ABC', 'the play context carries the query');
    assert.strictEqual(ctx.src, 'music');
    assert.strictEqual(ctx.sort, 'title-asc');
  } });
});
