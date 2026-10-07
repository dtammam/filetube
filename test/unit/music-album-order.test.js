'use strict';

// [UNIT] v1.373.0 (Dean: "should an 'album' I download have a track listing and be sorted by 'track' ... in desktop and
// mobile"): the album track label, the client's album-order sort (the iPod's Artists > artist > album level) and the row.

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

test('sortAlbumOrder: disc then track (a missing disc is 1, a missing track 0), stable for ties - the server\'s album-order', () => {
  const t = (id, trackNo, discNo, releaseDate) => ({ id, trackNo, discNo, releaseDate });
  // the artist sort hands them NEWEST UPLOAD first; the album wants track order
  const fromArtistSort = [t('c', 3, null, 300), t('b2', 1, 2, 250), t('a', 1, 1, 200), t('x', null, null, 150), t('b', 2, undefined, 100), t('a2', 1, 1, 50)];
  assert.deepStrictEqual(music.sortAlbumOrder(fromArtistSort).map((x) => x.id), ['x', 'a', 'a2', 'b', 'c', 'b2']);
  assert.deepStrictEqual(music.sortAlbumOrder(null), []);
});

test('buildSongRowHtml: the track overline only when asked (an album page in album order), escaped', () => {
  const item = { id: 'i', title: 'T', trackNo: 2, discNo: 3 };
  assert.ok(!music.buildSongRowHtml(item, 0).includes('music-song-track'), 'not by default (Songs tab, artist pages, search)');
  const html = music.buildSongRowHtml(item, 0, { trackNumbers: true });
  assert.ok(html.includes('<span class="ui-row__overline music-song-track">Disc 3 · Track 2</span>'));
  assert.ok(!music.buildSongRowHtml({ id: 'i', title: 'T' }, 0, { trackNumbers: true }).includes('music-song-track'), 'no number, no empty line');
});

test('the iPod\'s Artists > artist > album level plays in TRACK order (the artist sort was newest upload first)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/music.js'), 'utf8');
  assert.match(src, /if \(n\.type === 'artistAlbum'\) \{[\s\S]{0,700}menuSongLevel\(sortAlbumOrder\(SKINS\.tracksOfAlbum\(t, n\.key\)\), \{ ctx: \{ src: 'music', album: n\.key, sort: 'album-order' \}/);
});
