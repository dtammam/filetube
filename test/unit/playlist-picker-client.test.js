'use strict';

// [UNIT] v1.370.0 W4 (plan docs/exec-plans/completed/2026-10-06-v1370-playlist-picker.md, R1, R2, R5, R6, R7, R9,
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
    if (u.pathname.startsWith('/api/music/') && routes.music) { const j = await routes.music(u); return { ok: true, status: 200, json: async () => j }; }
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
// the VIDEO rows' switches (v1.371.0: the album section's two switches live in their own list)
const switches = () => [...picker().querySelectorAll('.ui-list:not(.playlist-picker-album):not(.playlist-picker-feed) input[type="checkbox"]')];
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
  const rowsText = [...picker().querySelectorAll('.ui-list:not(.playlist-picker-album):not(.playlist-picker-feed) .ui-row')].map((r) => r.textContent);
  assert.ok(rowsText[2].includes('Already in library') && rowsText[3].includes('Unavailable'));
  assert.strictEqual(btn('Download').textContent, 'Download (1)');
  assert.match(picker().querySelector('.oneoff-status').textContent, /Kyle Gordon Is Everywhere: 5 of 203 shown/);
  await sleep(GUARD_MS);
  assert.strictEqual(btn('Select all').textContent, 'Select all (3)', 'says how many (R6)');
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


// ---- gate r1 -------------------------------------------------------------------------------------------
const pointerClick = (el) => el.dispatchEvent(new global.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); // a real tap's click (cancelable, as every real one is)

test('gate r1 (security): a LINK that opened the page (noAutoSubmit) never downloads without a tap - a plain video, a Mix and a failed peek fill the form instead', async () => {
  for (const [peek, url, note] of [
    [null, `https://www.youtube.com/watch?v=${V}`, ''],
    [{ kind: 'mix', videoId: V, listId: 'RD' + V, listable: false }, `https://www.youtube.com/watch?v=${V}&list=RD${V}`, 'This is a YouTube Mix; downloading just this video.'],
    [{ kind: 'none', videoId: null, listId: null, listable: false }, `https://example.com/v?list=1`, ''],
  ]) {
    const c = fresh({ peek });
    const sent = []; const filled = [];
    const r = await c.routeOneOffDownload({ url, format: 'video' }, (b) => sent.push(b), { noAutoSubmit: true, fill: (b, n) => filled.push([b.url, n]) });
    assert.strictEqual(r, 'filled', url);
    assert.deepStrictEqual(sent, [], 'nothing posted: ' + url);
    assert.deepStrictEqual(filled, [[url, note]]);
  }
});

test('gate r1: the picker\'s controls honour the activation guard - a TAP inside the window answers nothing; after it, it does', async () => {
  const c = fresh({ pages: { 1: PAGE1 } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/watch?v=${V}&list=${L}`, linkedVideoId: V, format: 'video' });
  await sleep(20);
  pointerClick(btn('Download'));
  await sleep(20);
  assert.strictEqual(calls.filter((x) => x.url === '/api/ytdlp/download-playlist').length, 0, 'a tap inside the 450 ms window posts nothing');
  pointerClick(btn('Select all'));
  assert.strictEqual(btn('Download').textContent, 'Download (1)', 'Select all inside the window did nothing');
  await sleep(GUARD_MS);
  pointerClick(btn('Download'));
  await sleep(20);
  assert.strictEqual(calls.filter((x) => x.url === '/api/ytdlp/download-playlist').length, 1, 'after the window the tap answers');
});

test('gate r1: the picker takes the view\'s signal - leaving the page closes it', async () => {
  const c = fresh({ pages: { 1: PAGE1 } });
  const ac = new global.window.AbortController();
  global.window.FileTube = { viewSignal: () => ac.signal };
  const sheet = c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}` });
  await sleep(20);
  assert.ok(sheet.isOpen());
  ac.abort();
  await sleep(10);
  assert.strictEqual(sheet.isOpen(), false, 'closed with the view');
});

test('gate r1 (R4): Subscribe to playlist goes to Subscriptions > Add with the CANONICAL list URL, never the posted link', async () => {
  const c = fresh({ pages: { 1: PAGE1 } });
  const went = [];
  c.openPlaylistPicker({ link: `https://www.youtube.com/watch?v=${V}&list=${L}&si=tracker`, linkedVideoId: V, navigate: (u) => went.push(u) });
  await sleep(GUARD_MS);
  click(btn('Subscribe to playlist'));
  assert.deepStrictEqual(went, ['/subscriptions?add=' + encodeURIComponent('https://www.youtube.com/playlist?list=' + L)]);
});

test('gate r1: the collapsed chip names a waiting playlist (it was blank)', () => {
  const c = fresh({});
  const one = c.reduceDownloadChipState({ subscriptions: {}, oneShots: {}, waitingPlaylists: [{ id: '0b1f7c39-2e5c-4e3a-9a77-111111111111', url: 'u' }] }, new Set(), Date.now());
  assert.strictEqual(c.formatDownloadChipSummary(one), 'Playlist waiting: choose videos');
  const two = c.reduceDownloadChipState({ subscriptions: {}, oneShots: {}, waitingPlaylists: [{ id: 'a'.repeat(36), url: 'u' }, { id: 'b'.repeat(36), url: 'v' }] }, new Set(), Date.now());
  assert.strictEqual(c.formatDownloadChipSummary(two), '2 playlists waiting');
});

test('gate r1 (QA W3): the Subscriptions one-off list shows ONE row per playlist job (its videos hidden), worded like the chip', () => {
  const S = require('../../lib/ytdlp/client/subscriptions.js');
  const shown = S.visibleOneShotEntries({ j1: { kind: 'playlist', state: 'downloading' }, 'j1.a': { parent: 'j1' }, 'j1.b': { parent: 'j1' }, o1: { state: 'done' }, gone: { state: 'done' } }, new Set(['gone']));
  assert.deepStrictEqual(Object.keys(shown), ['j1', 'o1']);
  const src = require('node:fs').readFileSync(require.resolve('../../lib/ytdlp/client/subscriptions.js'), 'utf8');
  assert.match(src, /Object\.entries\(visibleOneShotEntries\(latestSnapshot\.oneShots, dismissedOneShotIds\)\)/, 'renderOneShots draws through it');
  assert.match(src, /entry\.kind === 'playlist' && typeof formatPlaylistChipStatus === 'function' \? formatPlaylistChipStatus\(entry\)/);
});

// ---- v1.371.0: Save as an album (plan docs/exec-plans/completed/2026-10-07-v1371-album-tags.md) ----
const albumSection = () => picker().querySelector('.playlist-picker-album');
const albumFields = () => picker().querySelector('.playlist-picker-album-fields');
const albumSwitch = (label) => albumSection().querySelector(`input[aria-label="${label}"]`);
const albumInput = (label) => [...albumFields().querySelectorAll('.ui-field')].find((f) => f.querySelector('label').textContent === label).querySelector('input');
const KG = { listId: L, title: 'Kyle Gordon Is Everywhere', total: 4, page: 1, nextPage: null, entries: [
  entry(1, { title: 'Kyle Gordon - Introduction (feat. Daniel Radcliffe) [Official Audio]', titleClean: 'Kyle Gordon - Introduction (feat. Daniel Radcliffe)', channel: 'kylegordonisgreat' }),
  entry(2, { title: 'Kyle Gordon - Mr. Jambo (feat. Barry Bergen) [Official Music Video]', channel: 'kylegordonisgreat', inLibrary: true }),
  entry(3, { title: 'Kyle Gordon – My Life (Is the Worst Life Ever) [Official Music Video]', titleClean: 'Kyle Gordon – My Life (Is the Worst Life Ever)', channel: 'kylegordonisgreat' }),
  entry(4, { title: 'I’m a Horse', titleClean: 'I’m a Horse', channel: 'kylegordonisgreat' }),
] };

test('v1.371.0 defaultAlbumArtist: the name most rows credit first (any dash), else the channel without " - Topic"; a tie goes to the first to reach it', () => {
  const c = fresh({});
  const fx = require('../fixtures/ytdlp-playlist/example-list-PLUtyNbQXMTLg.json');
  assert.strictEqual(c.defaultAlbumArtist(fx.entries), 'Kyle Gordon', 'Dean\'s real list (verbatim yt-dlp rows)');
  assert.strictEqual(c.defaultAlbumArtist([{ title: 'Introduction', channel: 'Kyle Gordon - Topic' }, { title: 'Freak Out', channel: 'Kyle Gordon - Topic' }]), 'Kyle Gordon', 'Provided to YouTube');
  assert.strictEqual(c.defaultAlbumArtist([{ title: 'A — x' }, { title: 'B - y' }, { title: 'B – z' }]), 'B', 'em / en dash too');
  assert.strictEqual(c.defaultAlbumArtist([{ title: 'A - x' }, { title: 'B - y' }]), 'A', 'tie: first');
  assert.strictEqual(c.defaultAlbumArtist([{ title: 'Song' }, null, {}]), '');
});

test('v1.371.0: the album section shows only for Audio, with the playlist title and the credited artist as defaults', async () => {
  let c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'video' });
  await sleep(20);
  assert.strictEqual(albumSection().hidden, true, 'video: no album');
  assert.strictEqual(albumFields().hidden, true);
  await sleep(400);
  c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  assert.strictEqual(albumSection().hidden, true, 'hidden until the list is read');
  await sleep(20);
  assert.strictEqual(albumSection().hidden, false, 'audio: the switch shows');
  assert.strictEqual(albumSwitch('Save as an album').checked, false, 'off by default');
  assert.strictEqual(albumFields().hidden, true, 'the fields wait for the switch');
  assert.strictEqual(albumInput('Album').value, 'Kyle Gordon Is Everywhere');
  assert.strictEqual(albumInput('Album artist').value, 'Kyle Gordon');
});

test('v1.371.0: with the format controls, switching to Audio reveals the album, and back to Video hides it', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, withFormatControls: true });
  await sleep(20);
  const format = picker().querySelector('select[aria-label="Format"]');
  assert.strictEqual(albumSection().hidden, true);
  format.value = 'audio'; format.dispatchEvent(new global.window.Event('change'));
  assert.strictEqual(albumSection().hidden, false);
  albumSwitch('Save as an album').checked = true; albumSwitch('Save as an album').dispatchEvent(new global.window.Event('change'));
  assert.strictEqual(albumFields().hidden, false);
  format.value = 'video'; format.dispatchEvent(new global.window.Event('change'));
  assert.strictEqual(albumSection().hidden, true);
  assert.strictEqual(albumFields().hidden, true, 'the fields go with it');
  switches()[0].checked = true; switches()[0].dispatchEvent(new global.window.Event('change'));
  await sleep(GUARD_MS);
  click(btn('Download'));
  await sleep(20);
  assert.strictEqual(calls.find((x) => x.url === '/api/ytdlp/download-playlist').body.album, undefined, 'video never posts an album, even with the switch left on');
});

test('v1.371.0: Download posts the album - typed names, Clean up titles, and each track\'s PLAYLIST position (blocked rows counted)', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio', quality: 'best', filetype: 'mp3' });
  await sleep(GUARD_MS + 20);
  pointerClick(albumSwitch('Save as an album'));
  assert.strictEqual(albumSwitch('Save as an album').checked, true);
  assert.strictEqual(albumFields().hidden, false);
  pointerClick(albumSwitch('Clean up titles'));
  albumInput('Album').value = '  Kyle Gordon Is Wonderful '; albumInput('Album').dispatchEvent(new global.window.Event('input'));
  switches().forEach((s) => { s.checked = true; });
  switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  const body = calls.find((x) => x.url === '/api/ytdlp/download-playlist').body;
  const [a, , c3, d4] = KG.entries.map((e) => e.id);
  assert.deepStrictEqual(body.ids, [a, c3, d4]);
  // v1.372.0: the shown names go along when they differ from YouTube's (cleaned here: noise off on the server, prefix off
  // in the picker); "I'm a Horse" is unchanged, so it is not sent; the server runs no cleanup of its own (cleanTitles false)
  assert.deepStrictEqual(body.album, { title: 'Kyle Gordon Is Wonderful', artist: 'Kyle Gordon', cleanTitles: false, tracks: { [a]: 1, [c3]: 3, [d4]: 4 },
    titles: { [a]: 'Introduction (feat. Daniel Radcliffe)', [c3]: 'My Life (Is the Worst Life Ever)' } });
});

test('v1.371.0: an empty album artist says so and posts nothing', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(GUARD_MS + 20);
  pointerClick(albumSwitch('Save as an album'));
  albumInput('Album artist').value = '   ';
  switches()[0].checked = true; switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  assert.strictEqual(calls.filter((x) => x.url === '/api/ytdlp/download-playlist').length, 0);
  assert.strictEqual(picker().querySelector('.oneoff-status').textContent, 'Name the album and its artist, or turn off Save as an album.');
});

test('v1.371.0: the album switches honour the activation guard - a tap inside the window leaves them as they were', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(20);
  pointerClick(albumSwitch('Save as an album'));
  assert.strictEqual(albumSwitch('Save as an album').checked, false, 'inside the window: refused');
  assert.strictEqual(albumFields().hidden, true);
  await sleep(GUARD_MS);
  pointerClick(albumSwitch('Save as an album'));
  assert.strictEqual(albumSwitch('Save as an album').checked, true, 'after it: toggles');
});

test('v1.371.0: Retry of an album job posts the album back, so the retried tracks join it', () => {
  const c = fresh({});
  const albumObj = { title: 'Brat', artist: 'Charli xcx', cleanTitles: false, tracks: { a: 1, b: 2 } };
  const req = c.buildPlaylistRetryRequest({ kind: 'playlist', failedIds: ['b'], listId: L, title: 'T', format: 'audio', album: albumObj });
  assert.deepStrictEqual(req.body.album, albumObj);
  assert.strictEqual(c.buildPlaylistRetryRequest({ kind: 'playlist', failedIds: ['b'], listId: L, title: 'T', format: 'audio', album: null }).body.album, undefined);
});

// Dean 2026-10-07: "Do we show to see if there's an existing artist ... (like Existing)"
const LIB = { artists: [{ artist: 'Kyle Gordon' }, { artist: 'Weird Al' }], albums: [{ album: 'Kyle Gordon Is Everywhere', artist: 'Kyle Gordon' }] };
const music = (lib) => (u) => {
  const q = (u.searchParams.get('search') || '').toLowerCase();
  const kind = u.pathname.split('/').pop();
  const items = lib[kind].filter((x) => (x.album || x.artist).toLowerCase().includes(q) || (x.artist || '').toLowerCase().includes(q));
  return { items, total: items.length };
};
const note = (label) => { const p = albumInput(label).closest('.ui-field').querySelector('.ui-field__help'); return p.hidden ? '' : p.textContent; };
const DEBOUNCE = 360;
// past the activation window, Save as an album switched on by a real tap, then the existing-check's debounce
const albumOnNow = async () => { await sleep(GUARD_MS + 20); pointerClick(albumSwitch('Save as an album')); await sleep(DEBOUNCE); };

test('v1.371.0 existing: the defaults already in Music say so (artist and album), read from Music\'s own lists', async () => {
  const c = fresh({ pages: { 1: KG }, music: music(LIB) });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await albumOnNow();
  assert.strictEqual(note('Album artist'), 'Already in Music');
  assert.strictEqual(note('Album'), 'Already in Music: these tracks join it');
  const asked = calls.filter((x) => x.url.startsWith('/api/music/')).map((x) => x.url);
  assert.ok(asked.includes('/api/music/artists?search=Kyle+Gordon&limit=1000'), asked.join(' '));
});

test('v1.371.0 existing: nothing in Music = no note; a different album by a known artist notes the artist only', async () => {
  let c = fresh({ pages: { 1: KG }, music: music({ artists: [], albums: [] }) });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await albumOnNow();
  assert.strictEqual(note('Album artist'), '');
  assert.strictEqual(note('Album'), '');
  await sleep(400);
  c = fresh({ pages: { 1: KG }, music: music(LIB) });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await albumOnNow();
  albumInput('Album').value = 'Kyle Gordon Is Wonderful'; albumInput('Album').dispatchEvent(new global.window.Event('input'));
  await sleep(DEBOUNCE);
  assert.strictEqual(note('Album artist'), 'Already in Music');
  assert.strictEqual(note('Album'), '', 'a new album');
});

test('v1.371.0 existing: an untouched default takes the library\'s spelling; a TYPED name is kept and told the library\'s', async () => {
  const lower = { artists: [{ artist: 'kyle gordon' }], albums: [] };
  const c = fresh({ pages: { 1: KG }, music: music(lower) });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await albumOnNow();
  assert.strictEqual(albumInput('Album artist').value, 'kyle gordon', 'Music groups by the exact name: the default joins the existing artist');
  assert.strictEqual(note('Album artist'), 'Already in Music');
  albumInput('Album artist').value = 'KYLE GORDON'; albumInput('Album artist').dispatchEvent(new global.window.Event('input'));
  await sleep(DEBOUNCE);
  assert.strictEqual(albumInput('Album artist').value, 'KYLE GORDON', 'what the user typed is never rewritten');
  assert.strictEqual(note('Album artist'), 'In Music as "kyle gordon"');
});

test('v1.371.0 existing: a slow answer for an OLD name never overwrites the note for the current one', async () => {
  let slow = true;
  const c = fresh({ pages: { 1: KG }, music: async (u) => { if (slow && u.searchParams.get('search') === 'Kyle Gordon') { await sleep(500); } return music(LIB)(u); } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await albumOnNow(); // the default's question is in flight (slow)
  albumInput('Album artist').value = 'Nobody'; albumInput('Album artist').dispatchEvent(new global.window.Event('input'));
  await sleep(DEBOUNCE + 600);
  assert.strictEqual(note('Album artist'), '', 'the late "Kyle Gordon" answer was dropped');
  slow = false;
});

// ---- gate r1 (adversary + qa) ----
test('gate r1: an album that differs only in case - an untouched default takes the library\'s spelling; a typed one is told it, never "join it"', async () => {
  const lib = { artists: [{ artist: 'Kyle Gordon' }], albums: [{ album: 'KYLE GORDON IS EVERYWHERE', artist: 'Kyle Gordon' }] };
  const c = fresh({ pages: { 1: KG }, music: music(lib) });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await albumOnNow();
  assert.strictEqual(albumInput('Album').value, 'KYLE GORDON IS EVERYWHERE', 'Music keys the album by its exact name: the default joins it');
  assert.strictEqual(note('Album'), 'Already in Music: these tracks join it');
  albumInput('Album').value = 'kyle gordon is everywhere'; albumInput('Album').dispatchEvent(new global.window.Event('input'));
  await sleep(DEBOUNCE);
  assert.strictEqual(albumInput('Album').value, 'kyle gordon is everywhere', 'typed: kept');
  assert.strictEqual(note('Album'), 'In Music as "KYLE GORDON IS EVERYWHERE"', 'and never told it joins');
  albumInput('Album artist').value = 'KYLE GORDON'; albumInput('Album artist').dispatchEvent(new global.window.Event('input'));
  albumInput('Album').value = 'KYLE GORDON IS EVERYWHERE'; albumInput('Album').dispatchEvent(new global.window.Event('input'));
  await sleep(DEBOUNCE);
  assert.strictEqual(note('Album'), '', 'a different-case ARTIST is another album key: no join claim');
});

test('gate r1: Music is asked nothing while Save as an album is off (and the answer lands nowhere once the sheet closed)', async () => {
  const c = fresh({ pages: { 1: KG }, music: music(LIB) });
  const sheet = c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(20 + DEBOUNCE);
  assert.strictEqual(calls.filter((x) => x.url.startsWith('/api/music/')).length, 0, 'switch off: no lookup');
  await sleep(GUARD_MS);
  pointerClick(albumSwitch('Save as an album'));
  sheet.close();
  await sleep(DEBOUNCE);
  assert.strictEqual(calls.filter((x) => x.url.startsWith('/api/music/')).length, 0, 'closed inside the debounce: no lookup');
});

test('gate r1: Opus never offers the album (its tags are per stream; the scan reads the container\'s)', async () => {
  let c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio', filetype: 'opus' });
  await sleep(20);
  assert.strictEqual(albumSection().hidden, true);
  await sleep(400);
  c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, withFormatControls: true });
  await sleep(20);
  const [format, , filetype] = [...picker().querySelectorAll('select')];
  format.value = 'audio'; format.dispatchEvent(new global.window.Event('change'));
  assert.strictEqual(albumSection().hidden, false);
  filetype.value = 'opus'; filetype.dispatchEvent(new global.window.Event('change'));
  assert.strictEqual(albumSection().hidden, true, 'switching the file type to Opus hides it');
  filetype.value = 'm4a'; filetype.dispatchEvent(new global.window.Event('change'));
  assert.strictEqual(albumSection().hidden, false);
});

test('gate r1: track numbers are the SERVER\'s list position (a dropped row shifts nothing); a video listed twice posts the ticked row', async () => {
  const page = { listId: L, title: 'T', total: 9, page: 1, nextPage: null, entries: [
    entry(1, { position: 1 }), entry(2, { position: 3 }), entry(1, { position: 4 }), entry(5, { position: 5 }),
  ] };
  const c = fresh({ pages: { 1: page } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await albumOnNow();
  albumInput('Album artist').value = 'Someone'; // these rows credit nobody, so there is no default
  const sw = switches();
  sw[0].checked = true; sw[1].checked = true; sw[3].checked = true; // video 1's FIRST listing (place 1), not its second (place 4)
  sw[1].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  const body = calls.find((x) => x.url === '/api/ytdlp/download-playlist').body;
  assert.deepStrictEqual(body.album.tracks, { [entry(1).id]: 1, [entry(2).id]: 3, [entry(5).id]: 5 });
});

test('gate r1 (adversary ADVC1): Load more keeps a TYPED album and artist; an untouched one follows the rows', async () => {
  const p1 = Object.assign({}, KG, { nextPage: 2, total: 6 });
  const p2 = { listId: L, title: 'Kyle Gordon Is Everywhere', total: 6, page: 2, nextPage: null, entries: [entry(8, { title: 'Weird Al - A' }), entry(9, { title: 'Weird Al - B' }), entry(10, { title: 'Weird Al - C' }), entry(11, { title: 'Weird Al - D' })] };
  const c = fresh({ pages: { 1: p1, 2: p2 } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(GUARD_MS + 20);
  albumInput('Album').value = 'Mine'; albumInput('Album').dispatchEvent(new global.window.Event('input'));
  click(btn('Load more'));
  await sleep(20);
  assert.strictEqual(albumInput('Album').value, 'Mine', 'typed: kept');
  assert.strictEqual(albumInput('Album artist').value, 'Weird Al', 'untouched: follows the rows (4 Weird Al vs 3 Kyle Gordon)');
  await sleep(400);
  const c2 = fresh({ pages: { 1: p1, 2: p2 } });
  c2.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(GUARD_MS + 20);
  albumInput('Album artist').value = 'Kyle Gordon & Friends'; albumInput('Album artist').dispatchEvent(new global.window.Event('input'));
  click(btn('Load more'));
  await sleep(20);
  assert.strictEqual(albumInput('Album artist').value, 'Kyle Gordon & Friends', 'a typed artist: kept');
});

test('gate r1 (adversary ADVC2): a press INSIDE the window whose click lands after it still toggles nothing (the held-press rule)', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(20);
  const box = albumSwitch('Save as an album');
  const pd = new global.window.Event('pointerdown', { bubbles: true }); pd.pointerId = 1;
  box.dispatchEvent(pd);
  await sleep(GUARD_MS);
  pointerClick(box);
  assert.strictEqual(box.checked, false, 'the press began inside the window');
  pointerClick(box);
  assert.strictEqual(box.checked, true, 'a fresh tap after it toggles');
});

// ---- v1.372.0: the song names (Dean: "it wasn't clear what the new saved name would have been") ----
const rowOf = (i) => [...picker().querySelectorAll('.ui-list:not(.playlist-picker-album):not(.playlist-picker-feed) .ui-row')][i];
const nameOf = (i) => rowOf(i).querySelector('.ui-row__title').textContent;
const metaOf = (i) => { const m = rowOf(i).querySelector('.ui-row__meta'); return m && !m.hidden ? m.textContent : ''; };
const dialog = () => [...global.document.querySelectorAll('.ui-sheet')].find((s) => s.querySelector('.ui-field__input') && !s.querySelector('.playlist-picker'));
const dialogBtn = (label) => [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === label);

test('v1.372.0: with the album on, each row shows the name the song WILL get and its track; off, YouTube\'s name', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(20);
  assert.strictEqual(nameOf(0), KG.entries[0].title, 'album off: YouTube\'s name');
  assert.strictEqual(metaOf(0), '');
  assert.strictEqual(rowOf(0).querySelector('.ui-row__meta').hidden, true, 'no empty meta line taking space');
  await sleep(GUARD_MS);
  pointerClick(albumSwitch('Save as an album'));
  assert.strictEqual(nameOf(0), KG.entries[0].title, 'album on, Clean up titles off: the name is unchanged');
  assert.strictEqual(metaOf(0), 'Track 1');
  assert.strictEqual(albumSection().querySelector('.ui-row__meta').textContent, 'Tap a song\'s name to rename it', 'the hint, on the switch row while on');
  pointerClick(albumSwitch('Clean up titles'));
  assert.strictEqual(nameOf(0), 'Introduction (feat. Daniel Radcliffe)', 'cleaned: the noise (server) and "Kyle Gordon - " (picker) off');
  assert.strictEqual(nameOf(2), 'My Life (Is the Worst Life Ever)', 'an en dash prefix too');
  assert.strictEqual(metaOf(2), 'Track 3');
  assert.strictEqual(rowOf(1).querySelector('.ui-row__meta').textContent, 'Already in library', 'a blocked row keeps its note and no tap target');
  assert.strictEqual(rowOf(1).querySelector('.ui-row__link'), null);
  albumInput('Album artist').value = 'Somebody'; albumInput('Album artist').dispatchEvent(new global.window.Event('input'));
  assert.strictEqual(nameOf(0), 'Kyle Gordon - Introduction (feat. Daniel Radcliffe)', 'the prefix follows the Album artist field');
  pointerClick(albumSwitch('Save as an album'));
  assert.strictEqual(nameOf(0), KG.entries[0].title, 'album off again: YouTube\'s name');
  assert.strictEqual(albumSection().querySelector('.ui-row__meta').textContent, 'Album, artist and track numbers', 'off: the description again');
});

test('v1.372.0: tapping a name opens the standard dialog, prefilled; Save renames (and is posted), Cancel and an empty name keep it', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(GUARD_MS + 20);
  pointerClick(albumSwitch('Save as an album'));
  pointerClick(albumSwitch('Clean up titles'));
  pointerClick(rowOf(0).querySelector('.ui-row__link'));
  assert.ok(dialog(), 'the dialog is up');
  const input = dialog().querySelector('.ui-field__input');
  assert.strictEqual(input.value, 'Introduction (feat. Daniel Radcliffe)', 'prefilled with the name shown');
  await sleep(GUARD_MS);
  input.value = '  Introduction  ';
  pointerClick(dialogBtn('Save'));
  await sleep(20);
  assert.strictEqual(nameOf(0), 'Introduction');
  await sleep(400);
  pointerClick(rowOf(2).querySelector('.ui-row__link'));
  await sleep(GUARD_MS);
  dialog().querySelector('.ui-field__input').value = 'Changed';
  pointerClick(dialogBtn('Cancel'));
  await sleep(20);
  assert.strictEqual(nameOf(2), 'My Life (Is the Worst Life Ever)', 'Cancel keeps it');
  await sleep(400);
  pointerClick(rowOf(2).querySelector('.ui-row__link'));
  await sleep(GUARD_MS);
  dialog().querySelector('.ui-field__input').value = '   ';
  pointerClick(dialogBtn('Save'));
  await sleep(20);
  assert.strictEqual(nameOf(2), 'My Life (Is the Worst Life Ever)', 'an empty name keeps it');
  await sleep(400);
  switches().forEach((s) => { s.checked = true; });
  switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  const body = calls.find((x) => x.url === '/api/ytdlp/download-playlist').body;
  assert.deepStrictEqual(body.album.titles, { [KG.entries[0].id]: 'Introduction', [KG.entries[2].id]: 'My Life (Is the Worst Life Ever)' });
});

test('v1.372.0: with the album off a tap on a row ticks it (never a dead tap); inside the activation window it does nothing', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'video' });
  await sleep(20);
  pointerClick(rowOf(0).querySelector('.ui-row__link'));
  assert.strictEqual(switches()[0].checked, false, 'inside the window: refused');
  await sleep(GUARD_MS);
  pointerClick(rowOf(0).querySelector('.ui-row__link'));
  assert.strictEqual(switches()[0].checked, true);
  assert.strictEqual(btn('Download').textContent, 'Download (1)', 'the count follows');
  assert.strictEqual(dialog(), undefined, 'no rename dialog with the album off');
});

test('v1.372.0 stripArtistPrefix: any case, any dash; a title that is only the prefix is kept; no artist = unchanged', () => {
  const c = fresh({});
  assert.strictEqual(c.stripArtistPrefix('KYLE GORDON - Song', 'Kyle Gordon'), 'Song');
  assert.strictEqual(c.stripArtistPrefix('Kyle Gordon — Song', 'Kyle Gordon'), 'Song');
  assert.strictEqual(c.stripArtistPrefix('AC/DC (Live) - Song', 'AC/DC (Live)'), 'Song', 'regex characters in the artist are literal');
  assert.strictEqual(c.stripArtistPrefix('Kyle Gordon - ', 'Kyle Gordon'), 'Kyle Gordon - ');
  assert.strictEqual(c.stripArtistPrefix('Someone - Song', 'Kyle Gordon'), 'Someone - Song');
  assert.strictEqual(c.stripArtistPrefix('Kyle Gordon - Song', ''), 'Kyle Gordon - Song');
});

test('v1.372.0: a press on a song name INSIDE the window whose click lands after it opens nothing (the held-press rule)', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'video' });
  await sleep(20);
  const link = rowOf(0).querySelector('.ui-row__link');
  const pd = new global.window.Event('pointerdown', { bubbles: true }); pd.pointerId = 1;
  link.dispatchEvent(pd);
  await sleep(GUARD_MS);
  pointerClick(link);
  assert.strictEqual(switches()[0].checked, false, 'the press began inside the window');
  pointerClick(link);
  assert.strictEqual(switches()[0].checked, true, 'a fresh tap after it answers');
});

// ---- v1.372.0 gate r1 ----
test('gate r1: a rename belongs to the VIDEO (both rows of a twice-listed video show and send it); a name over 200 is refused with a note', async () => {
  const page1 = { listId: L, title: 'T', total: 3, page: 1, nextPage: null, entries: [entry(1, { position: 1, title: 'A - One' }), entry(2, { position: 2, title: 'A - Two' }), entry(1, { position: 3, title: 'A - One' })] };
  const c = fresh({ pages: { 1: page1 } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await albumOnNow();
  pointerClick(rowOf(2).querySelector('.ui-row__link')); // the SECOND listing of video 1
  await sleep(GUARD_MS);
  dialog().querySelector('.ui-field__input').value = 'Renamed';
  pointerClick(dialogBtn('Save'));
  await sleep(20);
  assert.strictEqual(nameOf(0), 'Renamed', 'the first row of that video shows it too');
  assert.strictEqual(nameOf(2), 'Renamed');
  await sleep(400);
  pointerClick(rowOf(1).querySelector('.ui-row__link'));
  await sleep(GUARD_MS);
  dialog().querySelector('.ui-field__input').value = 'x'.repeat(201);
  pointerClick(dialogBtn('Save'));
  await sleep(20);
  assert.strictEqual(nameOf(1), 'A - Two', 'kept');
  assert.strictEqual(picker().querySelector('.oneoff-status').textContent, 'A song name can be up to 200 characters.');
  await sleep(400);
  switches()[0].checked = true; switches()[1].checked = true;
  switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  assert.deepStrictEqual(calls.find((x) => x.url === '/api/ytdlp/download-playlist').body.album.titles, { [entry(1).id]: 'Renamed' });
});

test('gate r1: a row with no title shows its id but never sends it as a name; the name link says what a tap does', async () => {
  const page1 = { listId: L, title: 'T', total: 2, page: 1, nextPage: null, entries: [entry(1, { position: 1, title: '' }), entry(2, { position: 2, title: 'A - Two' })] };
  const c = fresh({ pages: { 1: page1 } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(20);
  assert.strictEqual(rowOf(1).querySelector('.ui-row__link').getAttribute('aria-label'), 'Select A - Two', 'album off: the tap ticks');
  await sleep(GUARD_MS);
  pointerClick(albumSwitch('Save as an album'));
  assert.strictEqual(rowOf(1).querySelector('.ui-row__link').getAttribute('aria-label'), 'Rename A - Two', 'album on: the tap renames');
  albumInput('Album artist').value = 'Someone';
  switches()[0].checked = true; switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  assert.deepStrictEqual(calls.find((x) => x.url === '/api/ytdlp/download-playlist').body.album.titles, {});
});

test('gate r1 (adversary W4): leaving the page while the rename dialog is up closes the dialog too', async () => {
  const c = fresh({ pages: { 1: KG } });
  const ac = new global.window.AbortController();
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio', signal: ac.signal });
  await albumOnNow();
  pointerClick(rowOf(0).querySelector('.ui-row__link'));
  assert.ok(dialog(), 'the rename dialog is up');
  ac.abort();
  await sleep(20);
  assert.strictEqual([...global.document.querySelectorAll('.ui-sheet:not(.is-closing)')].length, 0, 'neither the picker nor the dialog stays');
});

test('gate r2: a row with no listing title but a TYPED name sends that name; the default artist drops an edge mark', async () => {
  const page1 = { listId: L, title: 'T', total: 2, page: 1, nextPage: null, entries: [entry(1, { position: 1, title: '' }), entry(2, { position: 2, title: 'Kyle Gordon\u200e - Two' })] };
  const c = fresh({ pages: { 1: page1 } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await albumOnNow();
  assert.strictEqual(albumInput('Album artist').value, 'Kyle Gordon', 'the trailing U+200E is not part of the default');
  pointerClick(rowOf(0).querySelector('.ui-row__link'));
  await sleep(GUARD_MS);
  dialog().querySelector('.ui-field__input').value = 'Typed';
  pointerClick(dialogBtn('Save'));
  await sleep(400);
  switches()[0].checked = true; switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  assert.deepStrictEqual(calls.find((x) => x.url === '/api/ytdlp/download-playlist').body.album.titles, { [entry(1).id]: 'Typed' });
});

// ---- v1.373.0: Hide from feed (Dean) ----
test('v1.373.0: the picker has a "Hide from feed" row for ANY format once the list is read; ticked, the job posts hideFromFeed; Retry carries it', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'video' });
  const feedRow = () => picker().querySelector('.playlist-picker-feed');
  assert.strictEqual(feedRow().hidden, true, 'hidden until the list is read');
  await sleep(20);
  assert.strictEqual(feedRow().hidden, false, 'video too');
  const box = feedRow().querySelector('input[aria-label="Hide from feed"]');
  assert.strictEqual(box.checked, false, 'off by default');
  pointerClick(box);
  assert.strictEqual(box.checked, false, 'the activation guard holds it inside the window');
  await sleep(GUARD_MS);
  pointerClick(box);
  assert.strictEqual(box.checked, true);
  switches()[0].checked = true; switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  const body = calls.find((x) => x.url === '/api/ytdlp/download-playlist').body;
  assert.strictEqual(body.hideFromFeed, true);
  assert.strictEqual(body.userId, undefined, 'the client never names a user');
  assert.strictEqual(c.buildPlaylistRetryRequest({ kind: 'playlist', failedIds: ['a'], listId: L, title: 'T', hideFromFeed: true }).body.hideFromFeed, true);
  assert.strictEqual(c.buildPlaylistRetryRequest({ kind: 'playlist', failedIds: ['a'], listId: L, title: 'T' }).body.hideFromFeed, undefined);
});

test('v1.373.0: left off, the body carries no hideFromFeed', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(GUARD_MS + 20);
  switches()[0].checked = true; switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  assert.strictEqual(calls.find((x) => x.url === '/api/ytdlp/download-playlist').body.hideFromFeed, undefined);
});

test('v1.373.0: a press on Hide from feed INSIDE the window whose click lands after it toggles nothing (the held-press rule)', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(20);
  const box = picker().querySelector('.playlist-picker-feed input[aria-label="Hide from feed"]');
  const pd = new global.window.Event('pointerdown', { bubbles: true }); pd.pointerId = 1;
  box.dispatchEvent(pd);
  await sleep(GUARD_MS);
  pointerClick(box);
  assert.strictEqual(box.checked, false, 'the press began inside the window');
  pointerClick(box);
  assert.strictEqual(box.checked, true);
});

test('gate r1 (adversary S3): the Hide from feed row stays hidden until the list is read, even when the format changes first', async () => {
  const c = fresh({ pages: { 1: KG }, pageStatus: 404 });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, withFormatControls: true });
  const format = picker().querySelector('select[aria-label="Format"]');
  format.value = 'audio'; format.dispatchEvent(new global.window.Event('change'));
  assert.strictEqual(picker().querySelector('.playlist-picker-feed').hidden, true);
  await sleep(20);
  assert.strictEqual(picker().querySelector('.playlist-picker-feed').hidden, true, 'a list that could not be read offers no row');
  assert.strictEqual(picker().querySelector('.playlist-picker-feed .ui-row__meta').textContent, 'Out of your feed in Modern mode', 'says where (v1.97 applies to the Modern feed)');
});

// ---- v1.374.0 (d): one cover art for a saved album (plan docs/exec-plans/active/2026-10-08-v1374-music-pass-cover.md R2) ----
const coverRow = () => albumSection().querySelector('.playlist-picker-cover');
const coverMeta = () => coverRow().querySelector('.ui-row__meta').textContent;
const coverMenu = () => [...global.document.querySelectorAll('.ui-sheet')].find((s) => !s.querySelector('.playlist-picker') && s.querySelector('.ui-list') && !s.querySelector('.ui-field__input'));
const coverItems = () => [...coverMenu().querySelectorAll('.ui-row')];
const KGU = Object.assign({}, KG, { entries: KG.entries.concat([entry(5, { unavailable: true, title: '[Private video]' }), entry(6, { id: KG.entries[0].id, title: KG.entries[0].title })]) });
const postedAlbum = () => calls.find((x) => x.url === '/api/ytdlp/download-playlist').body.album;

test('v1.374.0 (d): the Cover row shows only while Save as an album is on (and goes with the album for Video)', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, withFormatControls: true });
  await sleep(20);
  const format = picker().querySelector('select[aria-label="Format"]');
  format.value = 'audio'; format.dispatchEvent(new global.window.Event('change'));
  assert.ok(coverRow(), 'the row exists in the album group');
  assert.strictEqual(coverRow().hidden, true, 'album off: no Cover row');
  await sleep(GUARD_MS);
  pointerClick(albumSwitch('Save as an album'));
  assert.strictEqual(coverRow().hidden, false, 'album on: the Cover row');
  assert.strictEqual(coverRow().querySelector('.ui-row__title').textContent, 'Cover');
  assert.strictEqual(coverMeta(), 'Each song\'s own art', 'the default');
  pointerClick(albumSwitch('Save as an album'));
  assert.strictEqual(coverRow().hidden, true, 'album off again: hidden');
  pointerClick(albumSwitch('Save as an album'));
  format.value = 'video'; format.dispatchEvent(new global.window.Event('change'));
  assert.strictEqual(albumSection().hidden, true, 'video hides the whole group, Cover with it');
});

test('v1.374.0 (d): tapping Cover opens the standard menu - own art first, then every loaded song in order (once, none unavailable); a pick names the song and is posted', async () => {
  const c = fresh({ pages: { 1: KGU } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio', quality: 'best', filetype: 'mp3' });
  await sleep(GUARD_MS + 20);
  pointerClick(albumSwitch('Save as an album'));
  pointerClick(albumSwitch('Clean up titles'));
  pointerClick(coverRow());
  assert.ok(coverMenu(), 'the menu is up');
  assert.deepStrictEqual(coverItems().map((r) => r.textContent.trim()), [
    'Each song\'s own art',
    'Introduction (feat. Daniel Radcliffe)',
    'Mr. Jambo (feat. Barry Bergen) [Official Music Video]',
    'My Life (Is the Worst Life Ever)',
    'I’m a Horse',
  ], 'the names the rows show; the in-library row too; the unavailable row and the repeat are not offered');
  assert.strictEqual(coverItems()[0].getAttribute('aria-current'), 'true', 'own art is the current choice');
  await sleep(GUARD_MS);
  pointerClick(coverItems()[4]);
  await sleep(20);
  assert.strictEqual(coverMeta(), 'I’m a Horse', 'the row names the picked song');
  // the cover can be a song that is not downloaded: tick only the first
  switches()[0].checked = true; switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  assert.deepStrictEqual(postedAlbum().tracks, { [KG.entries[0].id]: 1 });
  assert.strictEqual(postedAlbum().coverId, KG.entries[3].id, 'the picked song\'s id, never a URL');
});

test('v1.374.0 (d): "Each song\'s own art" sends no cover (after a song was picked), and the menu marks the current pick', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(GUARD_MS + 20);
  pointerClick(albumSwitch('Save as an album'));
  pointerClick(coverRow());
  await sleep(GUARD_MS);
  pointerClick(coverItems()[1]);
  await sleep(400);
  assert.strictEqual(coverMeta(), KG.entries[0].title);
  pointerClick(coverRow());
  assert.strictEqual(coverItems()[1].getAttribute('aria-current'), 'true', 'the pick is marked');
  assert.strictEqual(coverItems()[0].getAttribute('aria-current'), null);
  await sleep(GUARD_MS);
  pointerClick(coverItems()[0]);
  await sleep(20);
  assert.strictEqual(coverMeta(), 'Each song\'s own art');
  switches()[0].checked = true; switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(postedAlbum(), 'coverId'), false, 'no cover key at all');
});

test('v1.374.0 (d): a tap on Cover inside the sheet\'s activation window opens nothing; after it, the menu opens', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(20);
  albumSwitch('Save as an album').checked = true; albumSwitch('Save as an album').dispatchEvent(new global.window.Event('change'));
  assert.strictEqual(coverRow().hidden, false);
  pointerClick(coverRow());
  assert.strictEqual(coverMenu(), undefined, 'inside the window: refused');
  await sleep(GUARD_MS);
  pointerClick(coverRow());
  assert.ok(coverMenu(), 'after it: the menu');
});

test('v1.374.0 (d): with the album off nothing is sent even if a cover was picked; a rename shows on the Cover row', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(GUARD_MS + 20);
  pointerClick(albumSwitch('Save as an album'));
  pointerClick(coverRow());
  await sleep(GUARD_MS);
  pointerClick(coverItems()[3]);
  await sleep(400);
  pointerClick(rowOf(2).querySelector('.ui-row__link'));
  await sleep(GUARD_MS);
  dialog().querySelector('.ui-field__input').value = 'My Life';
  pointerClick(dialogBtn('Save'));
  await sleep(20);
  assert.strictEqual(coverMeta(), 'My Life', 'the row follows the song\'s new name');
  await sleep(400);
  pointerClick(albumSwitch('Save as an album'));
  switches()[0].checked = true; switches()[0].dispatchEvent(new global.window.Event('change'));
  click(btn('Download'));
  await sleep(20);
  assert.strictEqual(calls.find((x) => x.url === '/api/ytdlp/download-playlist').body.album, undefined);
});

test('v1.374.0 (d): a press on Cover INSIDE the window whose click lands after it opens nothing (the held-press rule)', async () => {
  const c = fresh({ pages: { 1: KG } });
  c.openPlaylistPicker({ link: `https://www.youtube.com/playlist?list=${L}`, format: 'audio' });
  await sleep(20);
  albumSwitch('Save as an album').checked = true; albumSwitch('Save as an album').dispatchEvent(new global.window.Event('change'));
  const pd = new global.window.Event('pointerdown', { bubbles: true }); pd.pointerId = 1;
  coverRow().dispatchEvent(pd);
  await sleep(GUARD_MS);
  pointerClick(coverRow());
  assert.strictEqual(coverMenu(), undefined, 'the press began inside the window');
  pointerClick(coverRow());
  assert.ok(coverMenu());
});
