'use strict';

// [UNIT] v1.273 (Dean) - "the ability to rename chapters as if they were the song
// names... It's just a string in a text block effectively."
//
// A chaptered album's "tracks" are the `::c` chapters of ONE backing file, so their
// names live in that file's chapter list - which the watch page's editor already
// writes. This wave puts the same editor where the names are actually read: the
// album header. These tests bind the two things that can go wrong quietly - WHICH
// drills offer it (a mixed or ordinary album must not), and WHAT is handed to the
// editor (time order, and a 0:00 stamp that survives the round trip).

const { test } = require('node:test');
const assert = require('node:assert');

require('../../public/js/common.js'); // window-gated boot is inert here
const M = require('../../public/js/music.js');

const chap = (i, start, title) => ({
  id: 'file9::c' + i, source: 'library-chapter', chapterStartSec: start, title: title,
});

test('v1.273: only a SINGLE-FILE chapter album is renameable - the editor writes one media id, so a mixed drill must not offer it', () => {
  assert.strictEqual(M.chapterAlbumBaseId([chap(0, 0, 'Intro'), chap(1, 90, 'Two')]), 'file9',
    'every track is a ::c chapter of one file -> that file is the edit target');
  assert.strictEqual(M.isChapterAlbum([chap(0, 0, 'Intro'), chap(1, 90, 'Two')]), true);

  // an ordinary album: real files with tag titles, not editable here
  assert.strictEqual(M.isChapterAlbum([
    { id: 't1', source: 'library', title: 'In the Flesh' },
    { id: 't2', source: 'library', title: 'The Thin Ice' },
  ]), false, 'a real album\'s track titles are file tags - no button');

  // TWO files' chapters in one drill: there is no single list to write
  assert.strictEqual(M.isChapterAlbum([chap(0, 0, 'A'), { id: 'other::c0', source: 'library-chapter', chapterStartSec: 0, title: 'B' }]), false,
    'chapters of two different files cannot be one editable list');

  // a MIXED drill (a chapter track sitting beside a real track) is the subtle one
  assert.strictEqual(M.isChapterAlbum([chap(0, 0, 'A'), { id: 't1', source: 'library', title: 'Real' }]), false,
    'one non-chapter track disqualifies the whole drill');

  assert.strictEqual(M.isChapterAlbum([]), false, 'an empty drill offers nothing');
  assert.strictEqual(M.isChapterAlbum(null), false, 'and neither does a missing one');
  // source alone is not enough - the id must actually carry a ::c index
  assert.strictEqual(M.isChapterAlbum([{ id: 'file9', source: 'library-chapter', title: 'A' }]), false,
    'a library-chapter row with no ::c index is not a chapter track');
});

test('v1.273: the button appears ONLY on a chapter album, ONLY with write-RBAC, and the header is otherwise unchanged', () => {
  const chapters = [chap(0, 0, 'Intro'), chap(1, 90, 'Two')];
  const CAN = { canEditChapters: true };
  const withBtn = M.buildDrillHeaderHtml({ type: 'album', label: 'A Long Talk' }, chapters, CAN);
  assert.match(withBtn, /class="music-drill-chapters/, 'a chaptered album offers the editor');
  assert.match(withBtn, />\s*Edit chapters</, 'labelled for what it does');

  // QA WARNING-3: the watch page has gated its chapters entry on write-RBAC since
  // v1.81. A member without it who retypes thirty titles and is then 403'd has lost
  // all of it to an affordance nothing else in the app would have shown them.
  assert.doesNotMatch(M.buildDrillHeaderHtml({ type: 'album', label: 'A Long Talk' }, chapters, { canEditChapters: false }),
    /music-drill-chapters/, 'a member who may not modify the library is not offered it');
  assert.doesNotMatch(M.buildDrillHeaderHtml({ type: 'album', label: 'A Long Talk' }, chapters),
    /music-drill-chapters/, 'and it FAILS CLOSED - no opts at all means no button, not a default-on');
  assert.doesNotMatch(M.buildDrillHeaderHtml({ type: 'album', label: 'A Long Talk' }, chapters, {}),
    /music-drill-chapters/, '...as does an opts object that never resolved the capability');

  const plain = M.buildDrillHeaderHtml({ type: 'album', label: 'The Wall' }, [
    { id: 't1', source: 'library', title: 'In the Flesh' },
  ], CAN);
  assert.doesNotMatch(plain, /music-drill-chapters/, 'an ordinary album does not, even with the capability');
  // the pre-existing controls survive on both (this header is shared with the sticky bar's classes)
  for (const html of [withBtn, plain]) {
    assert.match(html, /music-drill-play/, 'Play still there');
    assert.match(html, /music-drill-shuffle/, 'Shuffle still there');
    assert.match(html, /music-drill-back/, 'Back still there');
  }
});

test('v1.273: a 0:00 chapter keeps its timestamp - the stamp mirrors the watch page, not the track formatter', () => {
  // THE BUG THIS PREVENTS: music.js's own formatTrackDuration returns '' for 0, so a
  // first chapter at 0:00 would be handed over as " Intro". QA S1 corrected my account
  // of what happens next: the line does not match the server's CHAPTER_LINE at all, so
  // it is SKIPPED - you lose the first chapter, not the whole list. The guard is right
  // and load-bearing; only my description of the damage was wrong.
  assert.strictEqual(M.formatTrackDuration(0), '', 'the track formatter really does blank a zero (non-vacuous)');
  assert.strictEqual(M.chapterStamp(0), '0:00', '...and the chapter stamp must not');
  assert.strictEqual(M.chapterStamp(9), '0:09');
  assert.strictEqual(M.chapterStamp(90), '1:30');
  assert.strictEqual(M.chapterStamp(3600), '1:00:00', 'an hour in, minutes are zero-padded behind the hour');
  assert.strictEqual(M.chapterStamp(3671), '1:01:11');
  // PARITY with the editor's own producer. common.js does not export formatDuration,
  // so lift the real function out of the file rather than re-typing it here - a copy
  // would drift the moment common.js changed, which is the whole failure this guards.
  const fs = require('node:fs');
  const path = require('node:path');
  const commonSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  const m = commonSrc.match(/function formatDuration\(seconds\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'found formatDuration in common.js (if this fails the parity check below is vacuous)');
  const watchStamp = new Function(m[0] + '; return formatDuration;')();
  assert.strictEqual(typeof watchStamp, 'function', 'and it evaluates');
  for (const s of [0, 5, 59, 60, 61, 599, 600, 3599, 3600, 7325]) {
    assert.strictEqual(M.chapterStamp(s), watchStamp(s),
      `chapterStamp(${s}) must equal what the watch page writes, or a round trip shifts every timestamp`);
  }
});

// ---------------------------------------------------------------------------
// INTEGRATION - the destructive path itself. QA S3: the three tests above only
// exercise the helpers, so swapping chapterStamp back to formatTrackDuration inside
// the handler kept them all green. This boots the REAL music.js, clicks the REAL
// button, and reads what the editor was actually handed.
const { JSDOM } = require('jsdom');
const musicPath = require.resolve('../../public/js/music.js');

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <div id="player-slot"></div><div id="media-player"></div>
  <div id="music-nowplaying-panel"></div>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

// The file has THREE chapters. `visibleTracks` is what the drill query returns - the
// search case returns a SUBSET, which is exactly the data-loss shape.
const FILE_CHAPTERS = [
  { startTime: 0, title: 'Intro' },
  { startTime: 120, title: 'Middle Part' },
  { startTime: 240, title: 'Outro' },
];
const chapTrack = (i, start, title) => ({
  id: 'film::c' + i, source: 'library-chapter', chapterStartSec: start, title,
  album: 'A Long Talk', albumKey: 'A Long Talk', artist: 'Someone',
});

async function bootMusic({ visibleTracks, canModify = true }, run) {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music?play=film::c0' });
  const saved = {
    window: global.window, document: global.document,
    localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController,
  };
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  const seen = { editor: null, videoFetches: [] };
  let registered = null;
  dom.window.FileTube = {
    registerView: (n, mod) => { registered = mod; },
    encodeListContext: (c) => JSON.stringify(c),
    decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } },
    shimmerArt: () => {},
    player: {
      currentId: null, getState: () => 'docked', expand: () => {},
      getCurrentMeta: () => null, load: () => {}, setTrackNav: () => {},
    },
  };
  dom.window.addToQueue = () => {};
  dom.window.fetchCurrentUser = () => Promise.resolve({ user: { role: canModify ? 'admin' : 'member' } });
  dom.window.showChaptersEditor = (mediaId, lines) => { seen.editor = { mediaId, lines }; };
  global.fetch = (url) => {
    if (String(url).indexOf('/api/videos/') === 0) {
      seen.videoFetches.push(String(url));
      return Promise.resolve({ ok: true, json: async () => ({ id: 'film', chapters: FILE_CHAPTERS }) });
    }
    if (String(url).indexOf('/api/music/albums') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    if (String(url).indexOf('/api/music/artists') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    const m = String(url).match(/\/api\/music\/([^?]+)$/);
    if (m) return Promise.resolve({ ok: true, json: async () => (visibleTracks[0] || {}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: visibleTracks }) });
  };
  try {
    delete require.cache[musicPath];
    require(musicPath);
    assert.ok(registered && typeof registered.init === 'function', 'the music view registered');
    registered.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 10; i++) await settle();
    await run(dom, seen);
    registered.destroy();
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

test('v1.273 QA CRITICAL-1: the editor is seeded from the FILE, so a search inside the album cannot delete the chapters it filtered out', async () => {
  // The measured loss: searching "Outro" leaves the drill holding ONE row - still a
  // ::c of the same file, so the button still renders - and POST /chapters REPLACES
  // the list, deleting the other 39 chapters of a DJ set. The album then drops below
  // the 2-chapter threshold and disappears from Music with no recovery the user sees.
  await bootMusic({ visibleTracks: [chapTrack(2, 240, 'Outro')] }, async (dom, seen) => {
    const btn = dom.window.document.querySelector('.music-drill-chapters');
    assert.ok(btn, 'the button rendered on the (filtered) chapter album - non-vacuous: this is the state that lost data');
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 10; i++) await settle();
    assert.ok(seen.editor, 'the editor opened');
    assert.strictEqual(seen.editor.mediaId, 'film', 'against the backing FILE, not a ::c track id');
    assert.ok(seen.videoFetches.some((u) => u.indexOf('/api/videos/film') === 0),
      'and it ASKED THE SERVER for the file\'s chapters instead of trusting the screen');
    assert.strictEqual(seen.editor.lines, '0:00 Intro\n2:00 Middle Part\n4:00 Outro',
      'all THREE chapters reach the editor, in time order, with 0:00 intact - seeding from the one visible row would have written "4:00 Outro" alone and destroyed the other two');
  });
});

test('v1.273 QA WARNING-3: a member who may not modify the library never sees the button', async () => {
  await bootMusic({ visibleTracks: [chapTrack(0, 0, 'Intro'), chapTrack(1, 120, 'Middle Part')], canModify: false },
    async (dom) => {
      assert.ok(dom.window.document.querySelector('.music-drill'), 'the drill rendered (non-vacuous)');
      assert.strictEqual(dom.window.document.querySelector('.music-drill-chapters'), null,
        'no Edit chapters affordance - the server would 403 the save and the retyping would be lost');
    });
});
