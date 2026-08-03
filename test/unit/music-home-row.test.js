'use strict';

// [UNIT] v1.44 T11 — the "Continue listening" home-row builders + the toggle
// decision (main.js). Pure/DOM-free (the buildBooksHomeSectionHtml posture).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');
const main = require('../../public/js/main.js');

// v1.73 (Dean ruling 1): the two per-kind section builders retired; the
// MERGED builder interleaves tracks + episodes by recency, capped at
// HOME_ROW_CAP, no See-all (mixed destinations - each card deep-links).
test('v1.73: buildListeningHomeSectionHtml merges tracks + episodes by recency, caps at HOME_ROW_CAP, empty -> empty string', () => {
  assert.equal(main.buildListeningHomeSectionHtml([], [], 'Continue listening'), '', 'nothing in progress = byte-identical home');
  const at = (h) => `2026-08-03T0${h}:00:00Z`;
  const html = main.buildListeningHomeSectionHtml(
    [{ id: 't1', title: 'Mother', artist: 'Pink <Floyd>', progress: { updatedAt: at(1) } }],
    [{ id: 'ep1', subId: 'sub1', title: 'Episode One', showName: 'The Show', progress: { updatedAt: at(2) } }],
    'Continue listening',
  );
  assert.match(html, /Continue listening/);
  assert.match(html, /music-home-row/, 'the shared chassis');
  const epIdx = html.indexOf('/podcastart/sub1');
  const trkIdx = html.indexOf('/albumart/t1');
  assert.ok(epIdx >= 0 && trkIdx >= 0, 'both kinds render');
  assert.ok(epIdx < trkIdx, 'the fresher episode sorts FIRST (recency interleave, not kind grouping)');
  assert.match(html, /Pink &lt;Floyd&gt;/, 'artist escaped');
  assert.ok(!html.includes('books-row-seeall'), 'no See-all on the mixed row');

  // The cap: 6 tracks + 6 episodes in = exactly HOME_ROW_CAP cards out.
  const many = main.buildListeningHomeSectionHtml(
    Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, artist: 'A', progress: { updatedAt: at(3) } })),
    Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, subId: 's', title: `E${i}`, showName: 'S', progress: { updatedAt: at(4) } })),
    'Continue listening',
  );
  assert.equal(main.HOME_ROW_CAP, 8, 'the ruled cap');
  assert.equal((many.match(/book-row-card/g) || []).length, 8, 'capped at 8 cards');
});

test('T11: buildMusicRowCardHtml escapes title + carries the album art', () => {
  const html = main.buildMusicRowCardHtml({ id: 'a"b', title: 'S "1"', artist: 'A' });
  assert.match(html, /S &quot;1&quot;/);
  assert.match(html, /albumart\/a%22b/);
});

test('T11 (gate note): the Continue-listening CARD deep-links /music?play=<id> so the resume pointer is consumed', () => {
  const html = main.buildMusicRowCardHtml({ id: 'trk9', title: 'Song', artist: 'A' });
  assert.match(html, /href="\/music\?play=trk9"/, 'the card resumes the specific track, not the generic /music');
});

// ---- v1.71 T5: the podcasts Continue-listening row ----

test('v1.71/v1.73: the podcast CARD builder survives as the merged row\'s arm (escaping + show art intact)', () => {
  const html = main.buildListeningHomeSectionHtml(
    [],
    [{ id: 'ep1', subId: 'sub1', title: 'Episode <One>', showName: 'The "Show"', progress: { updatedAt: '2026-08-03T01:00:00Z' } }],
    'Continue listening',
  );
  assert.match(html, /\/podcastart\/sub1/, 'show cover art');
  assert.match(html, /Episode &lt;One&gt;/, 'title escaped');
  assert.match(html, /The &quot;Show&quot;/, 'show name escaped');
});

test('v1.71 (the USE bind): the podcast card deep-links /podcasts?play=<episodeId> - the resume path, not the bare place', () => {
  const html = main.buildPodcastRowCardHtml({ id: 'ep"9', subId: 's1', title: 'E', showName: 'S' });
  assert.match(html, /href="\/podcasts\?play=ep%229"/, 'the card resumes the specific episode, encoded');
});

test('T11: homeRowEnabled defaults ON; only an explicit "0" disables', () => {
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    assert.equal(main.homeRowEnabled('ft-home-continue-listening'), true, 'unset -> ON');
    store['ft-home-continue-listening'] = '0';
    assert.equal(main.homeRowEnabled('ft-home-continue-listening'), false, '"0" -> OFF');
    store['ft-home-continue-listening'] = '1';
    assert.equal(main.homeRowEnabled('ft-home-continue-listening'), true, 'anything else -> ON');
  } finally {
    delete global.localStorage;
  }
});

// ---- v1.72 (cap 5): the videos Continue-watching row ----

test('v1.72: buildVideoHomeSectionHtml renders the shared chassis with media thumbs; empty -> empty string; NO see-all (watch filter is a pref, not a URL scope)', () => {
  assert.equal(main.buildVideoHomeSectionHtml([], 'Continue watching', ''), '', 'nothing in progress = byte-identical home');
  const html = main.buildVideoHomeSectionHtml(
    [{ id: 'v1', title: 'Movie <Night>', folderName: 'Films & Stuff', progressPercent: 42 }],
    'Continue watching',
    '',
  );
  assert.match(html, /Continue watching/);
  assert.match(html, /music-home-row/, 'the shared chassis');
  assert.match(html, /\/thumbnail\/v1/, 'the media thumb route');
  assert.match(html, /Movie &lt;Night&gt;/, 'title escaped');
  assert.match(html, /Films &amp; Stuff/, 'folder byline escaped');
  assert.ok(!html.includes('books-row-seeall'), 'no see-all link');
});

test('v1.72 (the USE bind): the video card deep-links /watch.html?v=<id> and shows the real progress bar', () => {
  const html = main.buildVideoRowCardHtml({ id: 'v"9', title: 'T', folderName: 'F', progressPercent: 61.5 });
  assert.match(html, /href="\/watch\.html\?v=v%229"/, 'watch deep link, encoded');
  assert.match(html, /video-row-cover/, 'the 16:9 cover class');
  assert.match(html, /book-row-progress-fill" style="width: 61.5%"/, 'the books-row bar classes carry the real percent');
});

test('v1.72: a sub-half-percent position renders NO progress bar (the buildCardHtml threshold)', () => {
  const html = main.buildVideoRowCardHtml({ id: 'v2', title: 'T', folderName: 'F', progressPercent: 0.2 });
  assert.ok(!html.includes('book-row-progress'), 'noise-level progress stays invisible');
});
