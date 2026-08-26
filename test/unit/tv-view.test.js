'use strict';

// [UNIT] v1.195 TV Shows client view - the PURE card/detail builders (public/js/tv.js).
// jsdom-free: exercises the exported string builders + escaping.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  escapeTvHtml, episodeCode, formatEpDuration,
  buildShowCardHtml, buildEpisodeRowHtml, buildShowDetailHtml,
} = require('../../public/js/tv.js');

test('episodeCode: SxxEyy, zero-padded; Extras (missing numbers) -> empty', () => {
  assert.strictEqual(episodeCode({ seasonNum: 2, episodeNum: 22 }), 'S02E22');
  assert.strictEqual(episodeCode({ seasonNum: 10, episodeNum: 5 }), 'S10E05');
  assert.strictEqual(episodeCode({ seasonNum: 0, episodeNum: 1 }), 'S00E01', 'a Special still codes');
  assert.strictEqual(episodeCode({ seasonNum: null, episodeNum: null }), '');
  assert.strictEqual(episodeCode({ seasonNum: 1, episodeNum: null }), '');
});

test('formatEpDuration: m:ss under an hour, h:mm:ss over', () => {
  assert.strictEqual(formatEpDuration(0), '0:00');
  assert.strictEqual(formatEpDuration(65), '1:05');
  assert.strictEqual(formatEpDuration(3661), '1:01:01');
  assert.strictEqual(formatEpDuration(-5), '0:00');
});

test('buildShowCardHtml: 2:3 poster src, name, "N seasons · M episodes", data id', () => {
  const html = buildShowCardHtml({ id: 'sh1', name: 'House MD', seasonCount: 8, episodeCount: 176 });
  assert.match(html, /data-show-id="sh1"/);
  assert.match(html, /src="\/tvposter\/sh1"/);
  assert.match(html, /House MD/);
  assert.match(html, /8 seasons · 176 episodes/);
  const single = buildShowCardHtml({ id: 's', name: 'X', seasonCount: 1, episodeCount: 1 });
  assert.match(single, /1 season · 1 episode/, 'singular grammar');
});

test('buildEpisodeRowHtml: code + title + duration + data id; Extras hides the code', () => {
  const row = buildEpisodeRowHtml({ id: 'e1', seasonNum: 2, episodeNum: 22, title: 'Forever', durationSec: 2610 });
  assert.match(row, /data-episode-id="e1"/);
  assert.match(row, /S02E22/);
  assert.match(row, /Forever/);
  assert.match(row, /43:30/);
  const extra = buildEpisodeRowHtml({ id: 'x', seasonNum: null, episodeNum: null, title: 'Gag reel', durationSec: 0 });
  assert.doesNotMatch(extra, /tv-episode-code/, 'an Extras episode shows no SxxExx code');
  assert.match(extra, /Gag reel/);
});

test('buildShowDetailHtml: a section per season; O3 hides the header of a single implicit season', () => {
  const detail = {
    name: 'House MD',
    seasons: [
      { seasonNum: 1, label: 'Season 1', episodes: [{ id: 'a', seasonNum: 1, episodeNum: 1, title: 'Pilot' }] },
      { seasonNum: 0, label: 'Specials', episodes: [{ id: 'b', seasonNum: 0, episodeNum: 1, title: 'Making Of' }] },
    ],
  };
  const html = buildShowDetailHtml(detail);
  assert.match(html, /Season 1/);
  assert.match(html, /Specials/);
  assert.match(html, /data-episode-id="a"/);

  const flat = buildShowDetailHtml({ name: 'Flat', seasons: [{ seasonNum: null, label: 'Episodes', episodes: [{ id: 'z', seasonNum: null, episodeNum: 1, title: 'One' }] }] });
  assert.doesNotMatch(flat, /tv-season-label/, 'O3: a single implicit season hides its header');
  assert.match(flat, /data-episode-id="z"/, 'but still lists the episodes');
});

test('escapeTvHtml: a hostile show/episode name never becomes markup (XSS)', () => {
  const evil = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(buildShowCardHtml({ id: 'i', name: evil }), /<img src=x/);
  assert.doesNotMatch(buildEpisodeRowHtml({ id: 'i', title: evil }), /<img src=x/);
  assert.strictEqual(escapeTvHtml(evil), '&lt;img src=x onerror=alert(1)&gt;');
});
