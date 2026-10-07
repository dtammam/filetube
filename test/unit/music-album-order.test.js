'use strict';

// [UNIT] v1.373.0 (Dean: "should an 'album' I download have a track listing and be sorted by 'track' ... in desktop and
// mobile"): the album track label, the row, and the iPod's Artists > artist > album level in the album sort. (The behaviour
// of that level under a sort is bound end to end by test/integration/music-pocket-menus.test.js's v1.331 play-through.)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const music = require('../../public/js/music.js');

test('songTrackLabel: "Track N"; disc 2+ prefixes "Disc D"; disc 1, no number, junk -> none / no disc', () => {
  assert.strictEqual(music.songTrackLabel({ trackNo: 3 }), 'Track 3');
  assert.strictEqual(music.songTrackLabel({ trackNo: 3, discNo: 1 }), 'Track 3');
  assert.strictEqual(music.songTrackLabel({ trackNo: 3, discNo: 2 }), 'Disc 2 · Track 3');
  for (const t of [{}, { trackNo: 0 }, { trackNo: '3' }, { trackNo: 1.5 }, null]) assert.strictEqual(music.songTrackLabel(t), '', JSON.stringify(t));
});

test('buildSongRowHtml: the track overline only when asked (an album page in album order), escaped', () => {
  const item = { id: 'i', title: 'T', trackNo: 2, discNo: 3 };
  assert.ok(!music.buildSongRowHtml(item, 0).includes('music-song-track'), 'not by default (Songs tab, artist pages, search)');
  const html = music.buildSongRowHtml(item, 0, { trackNumbers: true });
  assert.ok(html.includes('<span class="ui-row__overline music-song-track">Disc 3 · Track 2</span>'));
  assert.ok(!music.buildSongRowHtml({ id: 'i', title: 'T' }, 0, { trackNumbers: true }).includes('music-song-track'), 'no number, no empty line');
});

test('sortAlbumOrder mirrors the server\'s albumSortValue exactly: any integer disc (0 too), a missing disc 1, a missing track 0, stable', () => {
  const t = (id, trackNo, discNo) => ({ id, trackNo, discNo });
  // the artist sort hands them in another order; the album wants disc-major, then track
  const list = [t('c', 3, null), t('b2', 1, 2), t('a', 1, 1), t('x', null, null), t('d0', 5, 0), t('b', 2, undefined), t('a2', 1, 1), t('t10', 10, 1)];
  assert.deepStrictEqual(music.sortAlbumOrder(list).map((x) => x.id), ['d0', 'x', 'a', 'a2', 'b', 'c', 't10', 'b2']);
  const query = require('../../lib/music/query.js');
  assert.deepStrictEqual(query.sortTracks(list.map((x) => Object.assign({ album: 'A', artist: 'Z' }, x)), 'album-order').map((x) => x.id),
    music.sortAlbumOrder(list).map((x) => x.id), 'the same order the server gives for one album');
  assert.deepStrictEqual(music.sortAlbumOrder(null), []);
});

test('the iPod\'s Artists > artist > album level: track order off the cached list (no read), any other album sort from the server', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/music.js'), 'utf8');
  const branch = src.slice(src.indexOf("if (n.type === 'artistAlbum') {"), src.indexOf("if (n.type === 'album') {"));
  assert.match(branch, /var aasort = sortForTab\('drill-album'\);/);
  assert.match(branch, /if \(aasort === 'album-order'\) \{\s+return menuArtistTracks\(n\.artist\)\.then\(function \(t\) \{\s+return withRadioRow\(menuSongLevel\(sortAlbumOrder\(SKINS\.tracksOfAlbum\(t, n\.key\)\), \{ ctx: \{ src: 'music', album: n\.key, sort: aasort \}/);
  assert.match(branch, /fetchAllRows\('\/api\/music\?album=' \+ encodeURIComponent\(n\.key \|\| ''\) \+ '&sort=' \+ encodeURIComponent\(aasort\)\)/);
  assert.ok(!/drill-artist/.test(branch), 'never the artist sort');
});
