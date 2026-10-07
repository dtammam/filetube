'use strict';

// [UNIT] v1.370.0 W4 (plan docs/exec-plans/active/2026-10-06-v1370-playlist-picker.md, R1, R2, R5, R6, R7, R9,
// R12, R14): the client half of the playlist picker, through the REAL common.js and ui.js in jsdom with a
// fake fetch that answers like the server (the routes are bound by the integration suites):
//   - routeOneOffDownload: what the server's peek says decides - ask (a video in a list), the picker (a
//     list), one video with a note (a Mix), today's path (no list);
//   - openPlaylistPicker: only the linked video ticked; in-library / unavailable rows not tickable; Select
//     all over what is loaded; Load more; Download posts ONE job with the ticked ids and the box's format;
//     a double tap at 60 ms posts once; a list that cannot be read offers "Just this video";
//   - the chip: one row per playlist job, its children hidden, its status line, Retry = the failed ids;
//     a waiting playlist's row.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
const UI = require.resolve('../../public/js/ui.js');
let dom; let savedFetch; let calls;
const V = 'U3P8pUboZ5g';
const L = 'PLUtyNbQXMTLg';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GUARD_MS = 470; // ui.js ACTIVATION_GUARD_MS (450) + a margin: a sheet's controls ignore taps before it

function entry(i, extra) {
  return Object.assign({ id: ('vid' + String(i).padStart(8, '0')).slice(0, 11), title: 'Song ' + i, durationSec: 200 + i, thumb: 'https://i.ytimg.com/vi/x/mqdefault.jpg', inLibrary: false, unavailable: false }, extra || {});
}

// `routes` = { peek, pages: { 1: body, 2: body }, pageStatus, post: (body) => [status, json] }
function fresh(routes) {
  delete global.document; delete global.window; delete global.sessionStorage;
  delete require.cache[COMMON];
  const common = require(COMMON);
  dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.sessionStorage = dom.window.sessionStorage;
  delete require.cache[UI];
  dom.window.ui = require(UI);
  savedFetch = global.fetch;
  calls = [];
  global.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push({ url: String(url), method, body: init && init.body ? JSON.parse(init.body) : null });
    const u = new URL(String(url), 'http://localhost');
    if (u.pathname === '/api/ytdlp/playlist' && u.searchParams.get('peek') === '1') return { ok: true, status: 200, json: async () => routes.peek };
    if (u.pathname === '/api/ytdlp/playlist') {
      const page = Number(u.searchParams.get('page'));
      const st = routes.pageStatus || 200;
      return { ok: st === 200, status: st, json: async () => (st === 200 ? routes.pages[page] : { error: 'This playlist does not exist or is private.', reason: 'not-found' }) };
    }
    if (u.pathname === '/api/ytdlp/download-playlist') {
      const [st, json] = routes.post ? routes.post() : [202, { accepted: true, jobId: 'j1', total: 1 }];
      return { ok: st < 300, status: st, json: async () => json };
    }
    if (u.pathname === '/api/subscriptions/health') return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return common;
}
afterEach(async () => {
  if (global.document && global.document.querySelector('.ui-sheet')) await sleep(400);
  global.fetch = savedFetch;
  if (dom) { dom.window.close(); dom = null; }
  delete global.window; delete global.document; delete global.sessionStorage;
  delete require.cache[COMMON];
});
const picker = () => global.document.querySelector('.playlist-picker');
const switches = () => [...picker().querySelectorAll('input[type="checkbox"]')];
const btn = (label) => [...picker().querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label));
const click = (el) => el.dispatchEvent(new global.window.MouseEvent('click', { bubbles: true }));

const PAGE1 = { listId: L, title: 'Kyle Gordon Is Everywhere', total: 203, page: 1, nextPage: 2, entries: [entry(1), entry(2, { id: V }), entry(3, { inLibrary: true }), entry(4, { unavailable: true, title: '[Private video]' }), entry(5)] };
const PAGE2 = { listId: L, title: 'Kyle Gordon Is Everywhere', total: 203, page: 2, nextPage: null, entries: [entry(6), entry(7)] };

test('router: no list in the link -> today\'s one-video path, no server question', async () => {
  const c = fresh({});
  const sent = [];
  assert.strictEqual(await c.routeOneOffDownload({ url: `https://youtu.be/${V}`, format: 'video' }, (b) => sent.push(b)), 'single');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(calls.length, 0);
});

test('router (R1): a video in a list asks "Just this video" / "Choose videos"; Just sends the one video', async () => {
  const c = fresh({ peek: { kind: 'watch-in-list', videoId: V, listId: L, listable: true } });
  const sent = [];
  const body = { url: `https://www.youtube.com/watch?v=${V}&list=${L}`, format: 'audio', quality: 'best', filetype: 'mp3' };
  assert.strictEqual(await c.routeOneOffDownload(body, (b) => sent.push(b)), 'asked');
  await sleep(GUARD_MS);
  const rows = [...global.document.querySelectorAll('.ui-sheet .ui-row')];
  assert.deepStrictEqual(rows.map((r) => r.textContent.trim()), ['Just this video', 'Choose videos']);
  click(rows[0].querySelector('button') || rows[0]);
  assert.deepStrictEqual(sent, [body], 'the one video, exactly as the box built it');
});

test('router (R5): a Mix downloads just the video with a note; a list page opens the picker directly', async () => {
  let c = fresh({ peek: { kind: 'mix', videoId: V, listId: 'RD' + V, listable: false } });
  const sent = []; const said = [];
  assert.strictEqual(await c.routeOneOffDownload({ url: `https://www.youtube.com/watch?v=${V}&list=RD${V}` }, (b) => sent.push(b), { status: (t) => said.push(t) }), 'single-note');
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(said, ['This is a YouTube Mix; downloading just this video.']);
  c = fresh({ peek: { kind: 'playlist', videoId: null, listId: L, listable: true }, pages: { 1: PAGE1 } });
  assert.strictEqual(await c.routeOneOffDownload({ url: `https://www.youtube.com/playlist?list=${L}` }, () => assert.fail('no single')), 'picker');
  assert.ok(picker(), 'the picker is up');
});

test('picker (R2, R6): only the linked video starts ticked; in-library and unavailable rows have no switch; Select all = what is loaded; Load more appends', async () => {
  const c = fresh({ pages: { 1: PAGE1, 2: PAGE2 } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/watch?v=${V}&list=${L}`, linkedVideoId: V, format: 'video' });
  await sleep(20);
  assert.strictEqual(switches().length, 3, '5 rows, 2 not tickable');
  assert.deepStrictEqual(switches().map((s) => s.checked), [false, true, false], 'only the linked video');
  const rowsText = [...picker().querySelectorAll('.ui-row')].map((r) => r.textContent);
  assert.ok(rowsText[2].includes('Already in library') && rowsText[3].includes('Unavailable'));
  assert.strictEqual(btn('Download').textContent, 'Download (1)');
  assert.match(picker().querySelector('.oneoff-status').textContent, /Kyle Gordon Is Everywhere: 5 of 203 shown/);
  await sleep(GUARD_MS);
  assert.strictEqual(btn('Select all').textContent, 'Select all 3 loaded', 'says how many (R6)');
  click(btn('Select all'));
  assert.strictEqual(btn('Download').textContent, 'Download (3)');
  click(btn('Load more'));
  await sleep(20);
  assert.strictEqual(switches().length, 5);
  assert.ok(btn('Load more').hidden, 'no more pages');
  assert.strictEqual(btn('Download').textContent, 'Download (3)', 'the new page arrives unticked');
  click(btn('Select none'));
  assert.ok(btn('Download').disabled);
});

test('picker (R7, R12): Download posts ONE job with the ticked ids and the box\'s format; a double tap at 60 ms posts once', async () => {
  const c = fresh({ pages: { 1: PAGE1 } });
  let started = 0;
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, linkedVideoId: null, format: 'audio', quality: '720p', filetype: 'm4a', onStarted: () => { started += 1; } });
  await sleep(20);
  switches()[0].checked = true; switches()[2].checked = true;
  switches()[0].dispatchEvent(new global.window.Event('change'));
  await sleep(GUARD_MS);
  const go = btn('Download');
  click(go); await sleep(60); click(go);
  await sleep(30);
  const posts = calls.filter((x) => x.url === '/api/ytdlp/download-playlist');
  assert.strictEqual(posts.length, 1, 'one job');
  assert.deepStrictEqual(posts[0].body, { listId: L, title: 'Kyle Gordon Is Everywhere', ids: [PAGE1.entries[0].id, PAGE1.entries[4].id], format: 'audio', quality: '720p', filetype: 'm4a' });
  assert.strictEqual(started, 1);
});

test('picker (R12): opened from a waiting playlist it shows the box\'s three controls at the defaults and posts them', async () => {
  const c = fresh({ pages: { 1: PAGE1 } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, withFormatControls: true });
  await sleep(20);
  const selects = [...picker().querySelectorAll('select')];
  assert.deepStrictEqual(selects.map((s) => s.getAttribute('aria-label')), ['Format', 'Quality', 'File type']);
  selects[0].value = 'audio'; selects[0].dispatchEvent(new global.window.Event('change'));
  switches()[0].checked = true; switches()[0].dispatchEvent(new global.window.Event('change'));
  await sleep(GUARD_MS);
  click(btn('Download'));
  await sleep(20);
  const body = calls.find((x) => x.url === '/api/ytdlp/download-playlist').body;
  assert.strictEqual(body.format, 'audio');
  assert.strictEqual(body.filetype, selects[2].value);
});

test('picker (R14): a list that cannot be read says so and still offers the linked video', async () => {
  const c = fresh({ pageStatus: 404 });
  let one = 0;
  c.openPlaylistPicker({ link: `https://www.youtube.com/watch?v=${V}&list=PLzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz`, linkedVideoId: V, onJustThisVideo: () => { one += 1; } });
  await sleep(20);
  assert.match(picker().querySelector('.oneoff-status').textContent, /^Couldn't read this playlist\. This playlist does not exist or is private\.$/);
  await sleep(GUARD_MS);
  click(btn('Just this video'));
  assert.strictEqual(one, 1);
});

test('chip (R7): one row per playlist job (children hidden), its line, and Retry = only the failed ids; a waiting playlist row', () => {
  const c = fresh({});
  const job = { kind: 'playlist', state: 'error', title: 'Kyle Gordon Is Everywhere', total: 5, done: 3, failedIds: ['a', 'b'], listId: L, format: 'video', quality: 'best', filetype: 'mp4', percent: 100 };
  const snap = {
    subscriptions: {},
    oneShots: { j1: job, 'j1.a': { parent: 'j1', state: 'error' }, 'j1.c': { parent: 'j1', state: 'done' } },
    waitingPlaylists: [{ id: '0b1f7c39-2e5c-4e3a-9a77-111111111111', url: `https://www.youtube.com/playlist?list=${L}` }],
  };
  const st = c.reduceDownloadChipState(snap, new Set(), Date.now());
  assert.deepStrictEqual(st.items.map((i) => i.key), ['oneshot:j1', 'waiting:0b1f7c39-2e5c-4e3a-9a77-111111111111']);
  assert.strictEqual(st.items[0].name, 'Kyle Gordon Is Everywhere');
  assert.strictEqual(st.items[0].statusText, '3 of 5 downloaded, 2 failed');
  assert.strictEqual(st.items[0].retryable, true);
  assert.strictEqual(st.items[1].name, 'Playlist waiting: choose videos');
  assert.deepStrictEqual(c.buildPlaylistRetryRequest(job), { path: '/api/ytdlp/download-playlist', body: { listId: L, title: 'Kyle Gordon Is Everywhere', ids: ['a', 'b'], format: 'video', quality: 'best', filetype: 'mp4' } });
  assert.strictEqual(c.buildPlaylistRetryRequest(Object.assign({}, job, { failedIds: [] })), null);
  for (const [s, want] of [['queued', 'Waiting to start: 5 videos'], ['downloading', '5 of 5 (2 failed)'], ['cancelled', 'Cancelled after 3 of 5'], ['done', 'All 5 downloaded']]) {
    assert.strictEqual(c.formatPlaylistChipStatus(Object.assign({}, job, { state: s })), want, s);
  }
});
