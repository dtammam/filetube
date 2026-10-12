'use strict';

// [UNIT] v1.387.0 offline playback, plan D6 - the web half: public/js/offline.js through the REAL adapter with a FAKE
// host, and the surfaces' builders with and without the module's entry. Binds: ONE downloads subscription per page
// (sent once at load), the snapshot REPLACING the map and download events as deltas, the album / season roll-up from
// members with parentKind + parentId, the words (Make available offline / Remove offline copy / Saving for offline...
// N% / the error copy), localSrcFor as the ONLY reader of localSrc, pagehide releasing and a persisted pageshow
// re-subscribing, the badges drawn on cards and rows found by their EXISTING attributes, the no-host path (enabled
// false, every call inert, decorate a no-op) and, for each builder, byte-identical output without the entry.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');

const REPO = path.join(__dirname, '..', '..');
const OFFLINE_SRC = fs.readFileSync(path.join(REPO, 'public', 'js', 'offline.js'), 'utf8');
const offlineModule = require('../../public/js/offline.js');

function realm(hostOpts, html) {
  const dom = new JSDOM('<!doctype html><html><head><meta name="ft-version" content="1.387.0"></head><body>' + (html || '') + '</body></html>', { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window;
  const fake = hostOpts ? installFakeHost(win, hostOpts) : null;
  loadAdapter(win);
  win.eval(OFFLINE_SRC); // the shell's order: host-adapter.js then offline.js
  return { win, fake, offline: win.FileTube.offline };
}
const DL = { capabilities: ['downloads', 'network'] };
const item = (kind, id, state, extra) => ({ v: 1, type: 'download', kind, id, state, ...(extra || {}) });
const snapshot = (items) => ({ v: 1, type: 'downloadsSnapshot', items });

test('no host (every browser): enabled false, state none, add / remove / show false, decorate a no-op, nothing posted', () => {
  const { win, offline } = realm(null, '<div class="video-card" data-id="v1"><a class="card-media" href="/watch.html?v=v1"></a><div class="card-text"><a class="video-title">T</a></div></div>');
  assert.strictEqual(offline.enabled, false);
  assert.deepEqual(offline.state('video', 'v1'), { state: 'none' });
  assert.strictEqual(offline.add('video', 'v1'), false);
  assert.strictEqual(offline.remove('video', 'v1'), false);
  assert.strictEqual(offline.show(), false);
  assert.strictEqual(offline.localSrcFor(['video'], 'v1'), null);
  const before = win.document.body.innerHTML;
  assert.strictEqual(offline.decorate(), 0);
  assert.strictEqual(win.document.body.innerHTML, before, 'the DOM is byte-identical');
  assert.deepEqual(offline.menuEntry('video', 'v1'), { id: 'offline-add', label: 'Make available offline' });
  // v1.387.1: no host = the new event reaches nothing (no listener, no state, same DOM).
  win.dispatchEvent(new win.CustomEvent('filetube-host', { detail: { v: 1, type: 'downloadsAddFailed', kind: 'album', id: 'a1', error: 'network' } }));
  assert.deepEqual(offline.state('album', 'a1'), { state: 'none' });
  assert.deepEqual(offline.menuEntry('album', 'a1'), { id: 'offline-add', label: 'Make available offline' });
  assert.strictEqual(win.document.body.innerHTML, before, 'the DOM is still byte-identical');
  win.close();
});

test('a host without downloads is the same as no host (the capability, not the platform, decides)', () => {
  const { win, fake, offline } = realm({ capabilities: ['battery', 'network'] });
  assert.strictEqual(offline.enabled, false);
  assert.deepEqual(fake.of('downloads.subscribe'), [], 'never subscribed');
  win.close();
});

test('with downloads: ONE downloads.subscribe at load; the snapshot REPLACES the map; download events are deltas; state none deletes', () => {
  const { win, fake, offline } = realm(DL);
  assert.strictEqual(offline.enabled, true);
  assert.deepEqual(fake.of('downloads.subscribe').length, 1, 'subscribed once');
  assert.strictEqual(offline.subscribed(), true);
  const changes = [];
  offline.onChange((k, id) => changes.push([k, id]));
  fake.emit(snapshot([item('video', 'v1', 'done', { localSrc: 'filetube-local://v1' }), item('track', 't1', 'downloading', { progress: 0.4 })]));
  assert.deepEqual(offline.state('video', 'v1'), { state: 'done', localSrc: 'filetube-local://v1' });
  assert.deepEqual(offline.state('track', 't1'), { state: 'downloading', progress: 0.4 });
  assert.deepEqual(changes, [[null, null]], 'a snapshot is one "everything changed" notice');
  fake.emit(item('track', 't1', 'done', { localSrc: 'filetube-local://t1' }));
  assert.deepEqual(offline.state('track', 't1'), { state: 'done', localSrc: 'filetube-local://t1' });
  assert.deepEqual(changes[1], ['track', 't1']);
  fake.emit(item('video', 'v1', 'none'));
  assert.deepEqual(offline.state('video', 'v1'), { state: 'none' }, 'none = not on the phone');
  // A second snapshot replaces everything: t1 is gone from it.
  fake.emit(snapshot([item('podcastEpisode', 'p1', 'failed', { error: 'storageFull' })]));
  assert.deepEqual(offline.state('track', 't1'), { state: 'none' });
  assert.deepEqual(offline.state('podcastEpisode', 'p1'), { state: 'failed', error: 'storageFull' });
  // Lenient per the adapter: an unknown state arrives as none.
  fake.emit(item('tvEpisode', 'e1', 'teleporting'));
  assert.deepEqual(offline.state('tvEpisode', 'e1'), { state: 'none' });
  // Unknown kinds never enter.
  assert.deepEqual(offline.state('book', 'b1'), { state: 'none' });
  win.close();
});

test('add / remove / show post the contract messages with the kind and id; localSrcFor reads only a DONE item\'s localSrc, trying the kinds in order', () => {
  const { win, fake, offline } = realm(DL);
  fake.clear();
  assert.strictEqual(offline.add('album', 'Floyd\u001fWall'), true);
  assert.strictEqual(offline.remove('tvSeason', 'show:1'), true);
  assert.strictEqual(offline.show(), true);
  assert.strictEqual(offline.add('book', 'x'), false, 'not a download kind');
  assert.deepEqual(fake.posts, [
    { v: 1, type: 'downloads.add', kind: 'album', id: 'Floyd\u001fWall' },
    { v: 1, type: 'downloads.remove', kind: 'tvSeason', id: 'show:1' },
    { v: 1, type: 'downloads.show' },
  ]);
  fake.emit(snapshot([item('track', 'm1', 'done', { localSrc: 'filetube-local://m1' }), item('video', 'v2', 'downloading', { progress: 0.9, localSrc: 'filetube-local://v2' })]));
  assert.strictEqual(offline.localSrcFor(['video', 'track'], 'm1'), 'filetube-local://m1', 'a media id held as a track');
  assert.strictEqual(offline.localSrcFor('track', 'm1'), 'filetube-local://m1');
  assert.strictEqual(offline.localSrcFor(['video'], 'v2'), null, 'not done: never the local copy');
  assert.strictEqual(offline.localSrcFor(['video'], 'nope'), null);
  win.close();
});

test('an album or season rolls up from its members (parentKind + parentId): none without members, downloading with the mean progress, done when every member is done, failed when one failed and none is active', () => {
  const { win, fake, offline } = realm(DL);
  const P = { parentKind: 'album', parentId: 'Floyd\u001fWall' };
  assert.deepEqual(offline.state('album', 'Floyd\u001fWall'), { state: 'none' });
  fake.emit(snapshot([item('track', 't1', 'done', { ...P, localSrc: 'l1' }), item('track', 't2', 'downloading', { ...P, progress: 0.5 }), item('track', 't3', 'queued', P)]));
  assert.deepEqual(offline.state('album', 'Floyd\u001fWall'), { state: 'downloading', progress: 0.5 }, '(1 + 0.5 + 0) / 3');
  fake.emit(item('track', 't2', 'done', { ...P, localSrc: 'l2' }));
  fake.emit(item('track', 't3', 'done', { ...P, localSrc: 'l3' }));
  assert.deepEqual(offline.state('album', 'Floyd\u001fWall'), { state: 'done' });
  fake.emit(item('track', 't3', 'failed', { ...P, error: 'network' }));
  assert.deepEqual(offline.state('album', 'Floyd\u001fWall'), { state: 'failed', error: 'network' });
  fake.emit(item('track', 't3', 'none'));
  assert.deepEqual(offline.state('album', 'Floyd\u001fWall'), { state: 'done' }, 'a member that left the phone (none) leaves the roll-up: the two that remain are done');
  const S = { parentKind: 'tvSeason', parentId: 'sh:1' };
  fake.emit(item('tvEpisode', 'e1', 'done', { ...S, localSrc: 'e' }));
  assert.deepEqual(offline.state('tvSeason', 'sh:1'), { state: 'done' });
  assert.deepEqual(offline.state('tvSeason', 'sh:2'), { state: 'none' });
  assert.deepEqual(offlineModule.rollUp([]), { state: 'none' });
  win.close();
});

test('the words: menuEntry per state, the error copy, and the menu dispatcher (add / remove / cancel)', () => {
  const { win, fake, offline } = realm(DL);
  fake.emit(snapshot([
    item('video', 'done1', 'done', { localSrc: 'l' }), item('video', 'dl1', 'downloading', { progress: 0.42 }), item('video', 'q1', 'queued'),
    item('video', 'f1', 'failed', { error: 'storageFull' }), item('video', 'f2', 'failed', { error: 'revoked' }), item('video', 'f3', 'failed', { error: 'notOnServer' }),
    item('video', 'f4', 'failed', { error: 'notReady' }), item('video', 'f5', 'failed', { error: 'other' }), item('video', 'w1', 'waitingForWifi', { progress: 0.1 }),
  ]));
  assert.deepEqual(offline.menuEntry('video', 'none1'), { id: 'offline-add', label: 'Make available offline' });
  assert.deepEqual(offline.menuEntry('video', 'done1'), { id: 'offline-remove', label: 'Remove offline copy' });
  assert.deepEqual(offline.menuEntry('video', 'dl1'), { id: 'offline-remove', label: 'Saving for offline... 42%' });
  assert.deepEqual(offline.menuEntry('video', 'q1'), { id: 'offline-remove', label: 'Saving for offline...' });
  assert.deepEqual(offline.menuEntry('video', 'w1'), { id: 'offline-remove', label: 'Saving for offline... 10%' });
  assert.deepEqual(offline.menuEntry('video', 'f1'), { id: 'offline-add', label: 'Make available offline', errorText: 'Not enough space on this phone' });
  assert.strictEqual(offline.menuEntry('video', 'f2').errorText, 'This device was removed in Settings');
  assert.strictEqual(offline.menuEntry('video', 'f3').errorText, 'Not on the server yet');
  assert.strictEqual(offline.menuEntry('video', 'f4').errorText, 'Preparing a playable copy, try again shortly');
  assert.strictEqual(offline.menuEntry('video', 'f5').errorText, offline.ERROR_COPY.other);
  fake.clear();
  assert.strictEqual(offline.runMenuAction('offline-add', 'video', 'none1'), true);
  assert.strictEqual(offline.runMenuAction('offline-remove', 'video', 'dl1'), true, 'a download in progress is cancelled by the same remove');
  assert.strictEqual(offline.runMenuAction('download', 'video', 'x'), false, 'not ours');
  assert.deepEqual(fake.posts, [{ v: 1, type: 'downloads.add', kind: 'video', id: 'none1' }, { v: 1, type: 'downloads.remove', kind: 'video', id: 'dl1' }]);
  // Never "Download" or "Save to device" for this feature.
  for (const s of [offline.LABEL_ADD, offline.LABEL_REMOVE, offline.BADGE, ...Object.values(offline.ERROR_COPY)]) assert.ok(!/download|save to device/i.test(s), s);
  win.close();
});

test('release on navigation: pagehide unsubscribes (once); a persisted pageshow re-subscribes and the fresh snapshot replaces the map; a non-persisted pageshow does nothing', () => {
  const { win, fake, offline } = realm(DL);
  fake.emit(snapshot([item('video', 'v1', 'done', { localSrc: 'l' })]));
  fake.clear();
  win.dispatchEvent(new win.Event('pagehide'));
  assert.deepEqual(fake.types(), ['downloads.unsubscribe']);
  assert.strictEqual(offline.subscribed(), false);
  fake.emit(item('video', 'v9', 'done', { localSrc: 'l9' }));
  assert.deepEqual(offline.state('video', 'v9'), { state: 'none' }, 'unsubscribed: events are no longer read');
  win.dispatchEvent(new win.Event('pagehide'));
  assert.deepEqual(fake.types(), ['downloads.unsubscribe'], 'idempotent');
  fake.clear();
  win.dispatchEvent(new win.Event('pageshow')); // not persisted
  assert.deepEqual(fake.types(), []);
  const persisted = new win.Event('pageshow');
  Object.defineProperty(persisted, 'persisted', { value: true });
  win.dispatchEvent(persisted);
  assert.deepEqual(fake.types(), ['downloads.subscribe']);
  assert.strictEqual(offline.subscribed(), true);
  fake.emit(snapshot([item('video', 'v2', 'done', { localSrc: 'l2' })]));
  assert.deepEqual(offline.state('video', 'v1'), { state: 'none' }, 'the fresh snapshot replaced the map');
  assert.deepEqual(offline.state('video', 'v2'), { state: 'done', localSrc: 'l2' });
  win.close();
});

const SURFACES_HTML = `
<div class="video-grid">
  <div class="video-card" data-id="v1"><a class="card-media" href="/watch.html?v=v1"></a><div class="video-info"><div class="card-text"><a class="video-title">Video</a></div></div></div>
  <div class="video-card" data-id="p1"><a class="card-media" href="/podcasts?play=p1"></a><div class="video-info"><div class="card-text"><a class="video-title">Episode</a></div></div></div>
  <div class="video-card" data-id="m1"><a class="card-media" href="/music?play=m1"></a><div class="video-info"><div class="card-text"><a class="video-title">Song</a></div></div></div>
  <div class="video-card" data-id="e1"><a class="card-media" href="/watch.html?tv=e1"></a><div class="video-info"><div class="card-text"><a class="video-title">Ep</a></div></div></div>
  <div class="video-card" data-id="b1"><a class="card-media" href="/read.html?b=b1"></a><div class="video-info"><div class="card-text"><a class="video-title">Book</a></div></div></div>
</div>
<div class="music-song-row ui-row ui-row--media" data-id="t1"><span class="ui-row__body"><span class="ui-row__title">Mother</span></span></div>
<div class="ui-list podcast-episodes"><div class="ui-row" data-episode-id="p1"><span class="ui-row__body"><span class="ui-row__title">Episode</span></span></div></div>
<a class="ui-row ui-row--default tv-episode" data-episode-id="e1" href="/watch.html?tv=e1"><span class="ui-row__body"><span class="ui-row__title">Hello</span></span></a>`;

test('badges: decorate draws "Offline" (a ui-chip meta) on done cards and rows found by their existing attributes, the saving text while downloading, nothing for none; it re-points on change and never doubles; a book card gets nothing', () => {
  const { win, fake, offline } = realm(DL, SURFACES_HTML);
  win.ui = { chip: (o) => { const c = win.document.createElement('span'); c.className = 'ui-chip ui-chip--' + (o.kind || 'meta'); c.textContent = o.label; return c; } };
  const doc = win.document;
  const badgeOf = (sel) => { const el = doc.querySelector(sel); const b = el && el.querySelector('.offline-badge'); return b ? b.textContent : null; };
  assert.strictEqual(offline.decorate(), 7, 'the four offline-kind cards and the three rows were looked at (the book card is not an offline item)');
  assert.strictEqual(doc.querySelectorAll('.offline-badge').length, 0, 'nothing is on the phone yet');
  fake.emit(snapshot([
    item('video', 'v1', 'done', { localSrc: 'l' }), item('podcastEpisode', 'p1', 'downloading', { progress: 0.25 }), item('track', 'm1', 'done', { localSrc: 'm' }),
    item('tvEpisode', 'e1', 'queued'), item('track', 't1', 'done', { localSrc: 't' }),
  ]));
  // onChange ran decorate: the badges are there.
  assert.strictEqual(badgeOf('.video-card[data-id="v1"]'), 'Offline');
  assert.strictEqual(badgeOf('.video-card[data-id="p1"]'), 'Saving 25%', 'the compact badge (the full phrase overflowed a 320 px card, measured)');
  assert.strictEqual(badgeOf('.video-card[data-id="m1"]'), 'Offline', 'a music card is a track to the phone');
  assert.strictEqual(badgeOf('.video-card[data-id="e1"]'), 'Saving...');
  assert.strictEqual(badgeOf('.video-card[data-id="b1"]'), null, 'a book is not an offline item');
  assert.strictEqual(badgeOf('.music-song-row[data-id="t1"]'), 'Offline');
  assert.strictEqual(badgeOf('.podcast-episodes [data-episode-id="p1"]'), 'Saving 25%');
  assert.strictEqual(badgeOf('.tv-episode[data-episode-id="e1"]'), 'Saving...');
  const chip = doc.querySelector('.video-card[data-id="v1"] .offline-badge');
  assert.ok(chip.classList.contains('ui-chip') && chip.classList.contains('ui-chip--meta'), 'the .card-type precedent');
  assert.strictEqual(chip.parentNode.className, 'card-text');
  assert.strictEqual(chip.nextSibling.className, 'video-title', 'before the title');
  // Progress moves the text in place; done flips to Offline; none removes the chip; never a second chip.
  fake.emit(item('podcastEpisode', 'p1', 'downloading', { progress: 0.8 }));
  assert.strictEqual(badgeOf('.video-card[data-id="p1"]'), 'Saving 80%');
  fake.emit(item('podcastEpisode', 'p1', 'done', { localSrc: 'p' }));
  assert.strictEqual(badgeOf('.video-card[data-id="p1"]'), 'Offline');
  fake.emit(item('video', 'v1', 'none'));
  assert.strictEqual(badgeOf('.video-card[data-id="v1"]'), null);
  offline.decorate(); offline.decorate();
  assert.strictEqual(doc.querySelectorAll('.video-card[data-id="p1"] .offline-badge').length, 1, 'never doubled');
  win.close();
});

// ---- the surfaces' builders: with the entry, the extra item / pill; without it, BYTE-IDENTICAL output ----
const watch = require('../../public/js/watch.js');
const main = require('../../public/js/main.js');
const music = require('../../public/js/music.js');
const tv = require('../../public/js/tv.js');

test('buildWatchMoreItems: the offline entry rides beside Save to device (never replacing it), a failed copy adds its disabled reason; no entry = the v1.385 list', () => {
  const base = { downloadHref: '/video/v1?download=1', watched: false, watchLater: false };
  const without = watch.buildWatchMoreItems(base);
  assert.deepEqual(watch.buildWatchMoreItems({ ...base, offline: null }), without);
  const withAdd = watch.buildWatchMoreItems({ ...base, offline: { id: 'offline-add', label: 'Make available offline' } });
  assert.strictEqual(withAdd.length, without.length + 1);
  const i = withAdd.findIndex((x) => x.id === 'offline-add');
  assert.strictEqual(withAdd[i - 1].id, 'download', 'right after Save to device');
  assert.deepEqual(withAdd[i], { id: 'offline-add', icon: 'download', label: 'Make available offline' });
  const failed = watch.buildWatchMoreItems({ ...base, offline: { id: 'offline-add', label: 'Make available offline', errorText: 'Not enough space on this phone' } });
  assert.deepEqual(failed[i + 1], { id: 'offline-error', icon: 'error', label: 'Not enough space on this phone', disabled: true });
  const rm = watch.buildWatchMoreItems({ ...base, offline: { id: 'offline-remove', label: 'Remove offline copy' } });
  assert.deepEqual(rm[i], { id: 'offline-remove', icon: 'delete', label: 'Remove offline copy' });
});

test('buildCardMenuItems: the same for a card, for every kind that is an offline item; no entry = unchanged', () => {
  for (const it of [{ id: 'v1', kind: 'media', title: 'V' }, { id: 'p1', kind: 'podcast', title: 'P', subId: 's' }, { id: 't1', kind: 'track', title: 'T' }]) {
    const without = main.buildCardMenuItems(it, {}, {});
    assert.deepEqual(main.buildCardMenuItems(it, {}, { offline: null }), without, it.kind);
    const withIt = main.buildCardMenuItems(it, {}, { offline: { id: 'offline-add', label: 'Make available offline' } });
    assert.strictEqual(withIt.length, without.length + 1, it.kind);
    const i = withIt.findIndex((x) => x.id === 'offline-add');
    assert.ok(i > 0 && withIt[i - 1].id === 'download', it.kind + ': beside Save to device');
  }
});

test('tv builders: no opts = byte-identical rows and show page; with the entry function, a pill per episode row and per season (the season id is <showId>:<key>, Extras = x)', () => {
  const eps = [{ id: 'e1', title: 'Hello', seasonNum: 1, episodeNum: 1, durationSec: 100 }, { id: 'e2', title: 'Codec', seasonNum: 1, episodeNum: 2, durationSec: 100 }];
  const detail = { id: 'sh', name: 'Kids Show', seasons: [{ seasonNum: 1, label: 'Season 1', episodes: eps }, { seasonNum: null, label: 'Extras', episodes: [{ id: 'ex', title: 'Making of', seasonNum: null, episodeNum: null }] }] };
  assert.strictEqual(tv.buildEpisodeRowHtml(eps[0], undefined), tv.buildEpisodeRowHtml(eps[0]));
  assert.strictEqual(tv.buildShowDetailHtml(detail, null), tv.buildShowDetailHtml(detail));
  assert.ok(!tv.buildShowDetailHtml(detail).includes('tv-offline'), 'a browser renders no pill');
  const seen = [];
  const entry = (kind, id) => { seen.push([kind, id]); return kind === 'tvSeason' && id === 'sh:1' ? { id: 'offline-remove', label: 'Remove offline copy' } : { id: 'offline-add', label: 'Make available offline', errorText: id === 'e2' ? 'Not on the server yet' : undefined }; };
  const html = tv.buildShowDetailHtml(detail, { offline: entry });
  assert.deepEqual(seen, [['tvSeason', 'sh:1'], ['tvEpisode', 'e1'], ['tvEpisode', 'e2'], ['tvSeason', 'sh:x'], ['tvEpisode', 'ex']]);
  const dom = new JSDOM(html);
  const pills = [...dom.window.document.querySelectorAll('.tv-offline')];
  assert.strictEqual(pills.length, 5);
  assert.deepEqual(pills.map((p) => [p.getAttribute('data-offline-kind'), p.getAttribute('data-offline-id'), p.getAttribute('data-offline-action'), p.textContent]), [
    ['tvSeason', 'sh:1', 'offline-remove', 'Remove offline copy'], ['tvEpisode', 'e1', 'offline-add', 'Make available offline'], ['tvEpisode', 'e2', 'offline-add', 'Make available offline'],
    ['tvSeason', 'sh:x', 'offline-add', 'Make available offline'], ['tvEpisode', 'ex', 'offline-add', 'Make available offline'],
  ]);
  assert.strictEqual(pills[2].getAttribute('title'), 'Not on the server yet', 'a failed copy says why');
  assert.ok(dom.window.document.querySelector('.tv-episode[data-episode-id="e1"] .ui-row__actions .tv-offline'), 'the row pill sits in the actions slot');
  assert.ok(dom.window.document.querySelector('.tv-season-label .tv-offline'), 'the season pill sits in the season header');
  // A hostile label never becomes markup.
  const evil = tv.tvOfflinePillHtml({ id: 'offline-add', label: '<img src=x onerror=alert(1)>' }, 'tvEpisode', '"><b>');
  assert.ok(!evil.includes('<img') && evil.includes('&lt;img'));
});

test('buildDrillHeaderHtml: the album pill only with the entry and only for an album drill; without it, byte-identical', () => {
  const tracks = [{ id: 't1', title: 'Mother', album: 'The Wall', albumArtist: 'Pink Floyd', artist: 'Pink Floyd', trackNo: 1 }];
  const drill = { type: 'album', key: 'Pink Floyd\u001fThe Wall', label: 'The Wall' };
  const without = music.buildDrillHeaderHtml(drill, tracks, { canEditChapters: false });
  assert.strictEqual(music.buildDrillHeaderHtml(drill, tracks, { canEditChapters: false, offline: null }), without);
  assert.ok(!without.includes('music-drill-offline'));
  const withIt = music.buildDrillHeaderHtml(drill, tracks, { canEditChapters: false, offline: { id: 'offline-add', label: 'Make available offline' } });
  const dom = new JSDOM(withIt);
  const pill = dom.window.document.querySelector('.music-drill-offline');
  assert.ok(pill, 'the pill');
  assert.strictEqual(pill.getAttribute('data-offline-action'), 'offline-add');
  assert.strictEqual(pill.textContent.trim(), 'Make available offline');
  assert.ok(pill.parentNode.classList.contains('music-drill-actions'), 'in the pill row');
  const artist = music.buildDrillHeaderHtml({ type: 'artist', key: 'Pink Floyd', label: 'Pink Floyd' }, tracks, { canEditChapters: false, offline: { id: 'offline-add', label: 'x' } });
  assert.ok(!artist.includes('music-drill-offline'), 'an artist is not an offline item');
});

// ---- the iOS Root's contract review (2026-10-12) ----
test('chapter rows: the web reads and sends the PARENT id for a <mediaId>::c<n> track (native never sees a chapter id); notPlayable has its copy', () => {
  const { win, fake, offline } = realm(DL);
  fake.emit(snapshot([item('track', 'm1', 'done', { localSrc: 'filetube-local://m1' }), item('track', 'f1', 'failed', { error: 'notPlayable' })]));
  assert.deepEqual(offline.state('track', 'm1::c2'), { state: 'done', localSrc: 'filetube-local://m1' }, 'a chapter row reads its parent');
  assert.strictEqual(offline.localSrcFor(['track'], 'm1::c0'), 'filetube-local://m1');
  assert.deepEqual(offline.menuEntry('track', 'm1::c7'), { id: 'offline-remove', label: 'Remove offline copy' });
  fake.clear();
  offline.add('track', 'm2::c3');
  offline.remove('track', 'm1::c2');
  offline.add('video', 'v::c1'); // only a TRACK id carries chapter rows
  assert.deepEqual(fake.posts, [
    { v: 1, type: 'downloads.add', kind: 'track', id: 'm2' },
    { v: 1, type: 'downloads.remove', kind: 'track', id: 'm1' },
    { v: 1, type: 'downloads.add', kind: 'video', id: 'v::c1' },
  ]);
  assert.strictEqual(offline.normalizeId('track', 'abc::c12'), 'abc');
  assert.strictEqual(offline.normalizeId('track', 'abc'), 'abc');
  assert.strictEqual(offline.normalizeId('podcastEpisode', 'abc::c1'), 'abc::c1');
  assert.deepEqual(offline.menuEntry('track', 'f1'), { id: 'offline-add', label: 'Make available offline', errorText: 'This file cannot play on this phone' });
  assert.strictEqual(offline.errorCopy('notPlayable'), 'This file cannot play on this phone');
  win.close();
});

test('reachability (gate r1 qa W1, LESSONS 11): cards and rows rendered AFTER the snapshot get their badges with no further host event and no explicit decorate call - a whole grid set by innerHTML and a single card appended; a browser without a host sees no observer', async () => {
  const { win, fake } = realm(DL, '');
  const doc = win.document;
  fake.emit(snapshot([item('video', 'v1', 'done', { localSrc: 'l' }), item('track', 't1', 'done', { localSrc: 't' }), item('podcastEpisode', 'p1', 'downloading', { progress: 0.5 })]));
  assert.strictEqual(doc.querySelectorAll('.offline-badge').length, 0, 'nothing rendered yet');
  doc.body.innerHTML = SURFACES_HTML; // Home / Music / Podcasts render their rows like this, after the snapshot
  await new Promise((r) => setTimeout(r, 60)); // one frame
  const badgeOf = (sel) => { const el = doc.querySelector(sel); const b = el && el.querySelector('.offline-badge'); return b ? b.textContent : null; };
  assert.strictEqual(badgeOf('.video-card[data-id="v1"]'), 'Offline');
  assert.strictEqual(badgeOf('.music-song-row[data-id="t1"]'), 'Offline');
  assert.strictEqual(badgeOf('.podcast-episodes [data-episode-id="p1"]'), 'Saving 50%');
  assert.strictEqual(badgeOf('.video-card[data-id="b1"]'), null, 'a book card still gets nothing');
  // A single card appended as the added node itself (the observer hands decorate the card, not a container).
  const card = doc.createElement('div'); card.className = 'video-card'; card.setAttribute('data-id', 'v1');
  card.innerHTML = '<a class="card-media" href="/watch.html?v=v1"></a><div class="video-info"><div class="card-text"><a class="video-title">Again</a></div></div>';
  doc.querySelector('.video-grid, body').appendChild(card);
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(card.querySelector('.offline-badge').textContent, 'Offline');
  assert.strictEqual(card.querySelectorAll('.offline-badge').length, 1, 'the chip the pass inserted did not re-trigger a second chip');
  const total = doc.querySelectorAll('.offline-badge').length;
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(doc.querySelectorAll('.offline-badge').length, total, 'the pass settles: no self-triggering');
  win.close();
  // No host: no observer, so a render after load leaves the DOM byte-identical.
  const bare = realm(null, '');
  bare.win.document.body.innerHTML = SURFACES_HTML;
  const before = bare.win.document.body.innerHTML;
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(bare.win.document.body.innerHTML, before);
  assert.strictEqual(bare.win.document.querySelectorAll('.offline-badge').length, 0);
  bare.win.close();
});

test('one offline identity per library audio file (gate r1 qa W3): the card menu\'s kind (main.js cardOfflineKind) equals the badge\'s kind (offline.js reads the card\'s href, which common.js audioOpenHref makes /music?play=) - track for audio, video otherwise', () => {
  const common = require('../../public/js/common.js');
  const main = require('../../public/js/main.js');
  const audio = { id: 'aud1', kind: 'media', type: 'audio', title: 'Talk', ext: '.m4a' };
  const chaptered = { id: 'aud2', type: 'audio', title: 'Book', ext: '.m4a', chapterCount: 5 };
  const video = { id: 'vid1', type: 'video', title: 'Clip', ext: '.mp4' };
  assert.strictEqual(main.cardOfflineKind(audio), 'track');
  assert.strictEqual(main.cardOfflineKind(chaptered), 'track', 'a chaptered file too (the card id is the parent)');
  assert.strictEqual(main.cardOfflineKind(video), 'video');
  assert.strictEqual(main.cardOfflineKind({ id: 'x', kind: 'podcast' }), 'podcastEpisode');
  assert.strictEqual(main.cardOfflineKind({ id: 'x', kind: 'track' }), 'track');
  assert.strictEqual(main.cardOfflineKind({ id: 'x', kind: 'tv-episode' }), 'tvEpisode');
  assert.strictEqual(main.cardOfflineKind({ id: 'x', kind: 'book' }), null);
  assert.ok(common.audioOpenHref(audio).startsWith('/music?play='), 'the href rule the badge reads');
  assert.ok(common.audioOpenHref(chaptered).startsWith('/music?play=aud2'), 'a chaptered file opens at its first chapter, still under /music?play=');
  const html = [audio, chaptered].map((it) => '<div class="video-card" data-id="' + it.id + '"><a class="card-media" href="' + common.audioOpenHref(it) + '"></a><div class="card-text"><a class="video-title">T</a></div></div>').join('');
  const { win, fake, offline } = realm(DL, html);
  fake.emit(snapshot([item('track', 'aud1', 'done', { localSrc: 'a' }), item('track', 'aud2', 'done', { localSrc: 'b' }), item('video', 'aud1', 'done', { localSrc: 'wrong' })]));
  const badge = (id) => { const b = win.document.querySelector('.video-card[data-id="' + id + '"] .offline-badge'); return b ? b.textContent : null; };
  assert.strictEqual(badge('aud1'), 'Offline', 'the badge reads the TRACK state, the same key the menu writes');
  assert.strictEqual(badge('aud2'), 'Offline');
  assert.deepEqual(offline.menuEntry(main.cardOfflineKind(audio), audio.id), { id: 'offline-remove', label: 'Remove offline copy' }, 'the menu agrees with the badge');
  win.close();
});

test('localSrc is read ONLY from a done item (gate r1 adversary S4): a host sending localSrc with downloading / queued / failed is never played from (state() hides it, localSrcFor is null); done exposes it', () => {
  const { win, fake, offline } = realm(DL, '');
  for (const st of ['downloading', 'queued', 'failed', 'paused']) {
    fake.emit(item('video', 'v9', st, { localSrc: 'filetube-local://v9', progress: 0.5 }));
    assert.strictEqual(offline.state('video', 'v9').localSrc, undefined, st + ': state() hides a partial copy');
    assert.strictEqual(offline.localSrcFor(['video', 'track'], 'v9'), null, st + ': never the local copy');
  }
  fake.emit(item('video', 'v9', 'done', { localSrc: 'filetube-local://v9' }));
  assert.strictEqual(offline.state('video', 'v9').localSrc, 'filetube-local://v9');
  assert.strictEqual(offline.localSrcFor(['video'], 'v9'), 'filetube-local://v9');
  win.close();
});

// ---- v1.387.1: an add that fails as a whole (downloadsAddFailed) ------------------------------------------------
const addFailed = (kind, id, error) => ({ v: 1, type: 'downloadsAddFailed', kind, id, error });
const ALBUM = 'Pink Floyd\u001fThe Wall'; // an album id carries the 0x1f separator

test('v1.387.1: a failed album / season add shows each error\'s copy on its menu entry; the button stays "Make available offline"', () => {
  const { win, fake, offline } = realm(DL);
  const changes = [];
  offline.onChange((k, id) => changes.push([k, id]));
  for (const [error, copy] of [['network', offline.ERROR_COPY.network], ['storageFull', 'Not enough space on this phone'], ['revoked', 'This device was removed in Settings'], ['notOnServer', 'Not on the server yet'], ['notReady', 'Preparing a playable copy, try again shortly'], ['notPlayable', offline.ERROR_COPY.notPlayable], ['other', offline.ERROR_COPY.other]]) {
    fake.emit(addFailed('album', ALBUM, error));
    assert.deepEqual(offline.state('album', ALBUM), { state: 'failed', error });
    assert.deepEqual(offline.menuEntry('album', ALBUM), { id: 'offline-add', label: 'Make available offline', errorText: copy }, error);
    fake.emit(addFailed('tvSeason', 'show:1', error));
    assert.deepEqual(offline.menuEntry('tvSeason', 'show:1'), { id: 'offline-add', label: 'Make available offline', errorText: copy }, 'season ' + error);
  }
  assert.ok(changes.some(([k, id]) => k === 'album' && id === ALBUM), 'the surfaces are told');
  assert.deepEqual(offline.state('album', 'other'), { state: 'none' }, 'only that album');
  win.close();
});

test('v1.387.1: an unknown error shows the "other" copy; an unknown kind or a missing field drops the event; a single item fails the same way', () => {
  const { win, fake, offline } = realm(DL);
  fake.emit(addFailed('album', 'a1', 'cosmic'));
  assert.deepEqual(offline.state('album', 'a1'), { state: 'failed', error: 'other' });
  assert.strictEqual(offline.menuEntry('album', 'a1').errorText, offline.ERROR_COPY.other);
  fake.emit(addFailed('book', 'b1', 'network'));
  fake.emit({ v: 1, type: 'downloadsAddFailed', kind: 'album', error: 'network' });
  fake.emit({ v: 1, type: 'downloadsAddFailed', kind: 'album', id: 'a2' });
  assert.deepEqual(offline.state('book', 'b1'), { state: 'none' });
  assert.deepEqual(offline.state('album', 'a2'), { state: 'none' });
  fake.emit(addFailed('video', 'v1', 'network'));
  assert.deepEqual(offline.menuEntry('video', 'v1'), { id: 'offline-add', label: 'Make available offline', errorText: offline.ERROR_COPY.network });
  fake.emit(addFailed('track', 't1', 'notReady'));
  assert.deepEqual(offline.state('track', 't1'), { state: 'failed', error: 'notReady' });
  win.close();
});

test('v1.387.1: clearing path 1 - the next add() of that key (a chapter row id is normalized the way the event\'s id was sent) clears it and tells the surfaces', () => {
  const { win, fake, offline } = realm(DL);
  fake.emit(addFailed('album', ALBUM, 'network'));
  const changes = [];
  offline.onChange((k, id) => changes.push([k, id]));
  fake.clear();
  offline.add('album', ALBUM);
  assert.deepEqual(fake.posts, [{ v: 1, type: 'downloads.add', kind: 'album', id: ALBUM }]);
  assert.deepEqual(offline.state('album', ALBUM), { state: 'none' }, 'a retry shows the plain label (no pending state)');
  assert.deepEqual(changes, [['album', ALBUM]]);
  // A chapter row: add() sends the PARENT id, native answers with that id, the next add clears it.
  fake.emit(addFailed('track', 'm1', 'network'));
  assert.deepEqual(offline.state('track', 'm1::c3'), { state: 'failed', error: 'network' }, 'read through the chapter id');
  offline.add('track', 'm1::c3');
  assert.deepEqual(offline.state('track', 'm1'), { state: 'none' });
  // A different key is untouched by the retry.
  fake.emit(addFailed('album', 'a1', 'network'));
  fake.emit(addFailed('album', 'a2', 'network'));
  offline.add('album', 'a1');
  assert.deepEqual(offline.state('album', 'a1'), { state: 'none' });
  assert.deepEqual(offline.state('album', 'a2'), { state: 'failed', error: 'network' });
  win.close();
});

test('v1.387.1: clearing path 2 - any download event for the item, or for a member of the album / season (parentKind + parentId), clears it', () => {
  const { win, fake, offline } = realm(DL);
  fake.emit(addFailed('album', ALBUM, 'network'));
  fake.emit(addFailed('video', 'v1', 'network'));
  fake.emit(addFailed('tvSeason', 'show:1', 'network'));
  fake.emit(item('video', 'v1', 'queued'));
  assert.deepEqual(offline.state('video', 'v1'), { state: 'queued' }, 'the real item wins and the failure is gone');
  fake.emit(item('video', 'v1', 'none'));
  assert.deepEqual(offline.state('video', 'v1'), { state: 'none' }, 'cleared for good, not just hidden');
  fake.emit(item('track', 't1', 'queued', { parentKind: 'album', parentId: ALBUM }));
  assert.deepEqual(offline.state('album', ALBUM), { state: 'downloading', progress: 0 });
  fake.emit(item('track', 't1', 'none', { parentKind: 'album', parentId: ALBUM }));
  assert.deepEqual(offline.state('album', ALBUM), { state: 'none' }, 'the member left: no stale failure comes back');
  assert.deepEqual(offline.state('tvSeason', 'show:1'), { state: 'failed', error: 'network' }, 'an unrelated season keeps its failure');
  fake.emit(item('tvEpisode', 'e1', 'done', { localSrc: 'l', parentKind: 'tvSeason', parentId: 'show:1' }));
  assert.deepEqual(offline.state('tvSeason', 'show:1'), { state: 'done' });
  win.close();
});

test('v1.387.1: a stale failure never hides real member progress (members present = the roll-up decides, whatever order they arrived in)', () => {
  const { win, fake, offline } = realm(DL);
  // Members already known from a snapshot, then a failure for the container arrives late.
  fake.emit(snapshot([item('track', 't1', 'downloading', { progress: 0.5, parentKind: 'album', parentId: 'a1' })]));
  fake.emit(addFailed('album', 'a1', 'network'));
  assert.deepEqual(offline.state('album', 'a1'), { state: 'downloading', progress: 0.5 });
  assert.deepEqual(offline.menuEntry('album', 'a1'), { id: 'offline-remove', label: 'Saving for offline... 50%' });
  // The member is removed: the (kept) failure may show again only because nothing replaced it.
  fake.emit(item('track', 't1', 'none', { parentKind: 'album', parentId: 'a1' }));
  assert.deepEqual(offline.state('album', 'a1'), { state: 'none' }, 'the member event cleared the failure too');
  win.close();
});

test('v1.387.1: clearing path 3 - a downloadsSnapshot replaces the world, failures included', () => {
  const { win, fake, offline } = realm(DL);
  fake.emit(addFailed('album', ALBUM, 'network'));
  fake.emit(addFailed('video', 'v1', 'revoked'));
  fake.emit(snapshot([item('video', 'v2', 'done', { localSrc: 'l' })]));
  assert.deepEqual(offline.state('album', ALBUM), { state: 'none' });
  assert.deepEqual(offline.state('video', 'v1'), { state: 'none' });
  assert.deepEqual(offline.state('video', 'v2'), { state: 'done', localSrc: 'l' });
  win.close();
});

test('v1.387.1: clearing path 4 - pagehide drops the failures and the listener; a persisted pageshow subscribes afresh and a new failure is heard again', () => {
  const { win, fake, offline } = realm(DL);
  fake.emit(addFailed('album', ALBUM, 'network'));
  win.dispatchEvent(new win.Event('pagehide'));
  assert.deepEqual(offline.state('album', ALBUM), { state: 'none' });
  fake.emit(addFailed('album', 'a9', 'network'));
  assert.deepEqual(offline.state('album', 'a9'), { state: 'none' }, 'unsubscribed: the event is no longer read');
  const persisted = new win.Event('pageshow');
  Object.defineProperty(persisted, 'persisted', { value: true });
  win.dispatchEvent(persisted);
  fake.emit(addFailed('album', 'a9', 'network'));
  assert.deepEqual(offline.state('album', 'a9'), { state: 'failed', error: 'network' });
  assert.strictEqual(fake.of('downloads.subscribe').length, 2);
  win.close();
});

test('v1.387.1: the failure rides state() only - never localSrc, never a badge, and a failed container decorates nothing', () => {
  const { win, fake, offline } = realm(DL, SURFACES_HTML);
  fake.emit(addFailed('video', 'v1', 'network'));
  assert.strictEqual(offline.localSrcFor(['video'], 'v1'), null);
  assert.strictEqual(win.document.querySelectorAll('.offline-badge').length, 0, 'a failed add draws no chip');
  win.close();
});
