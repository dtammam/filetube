'use strict';

// [UNIT] v1.44 T3 — lib/music/tags.js: pure music-metadata resolution
// (embedded-tag precedence + path-convention fallback). No ffmpeg/ffprobe:
// `tags` is the already-parsed output of parseFfprobeTags, passed as a plain
// object. Path handling uses POSIX-style absolute paths (the scan resolves to
// absolute before calling).

const { test } = require('node:test');
const assert = require('node:assert');
const tags = require('../../lib/music/tags');

// ---- parseTrackNumber -------------------------------------------------------

test('T3: parseTrackNumber takes the leading integer of "3", "03", "3/12"; null otherwise', () => {
  assert.equal(tags.parseTrackNumber('3'), 3);
  assert.equal(tags.parseTrackNumber('03'), 3);
  assert.equal(tags.parseTrackNumber('3/12'), 3);
  assert.equal(tags.parseTrackNumber(5), 5);
  assert.equal(tags.parseTrackNumber('A-side'), null);
  assert.equal(tags.parseTrackNumber(''), null);
  assert.equal(tags.parseTrackNumber(undefined), null);
});

// ---- parseYear --------------------------------------------------------------

test('T3: parseYear extracts a plausible 4-digit year, else null', () => {
  assert.equal(tags.parseYear('2019'), 2019);
  assert.equal(tags.parseYear('2019-04-01'), 2019);
  assert.equal(tags.parseYear('01/04/2019'), 2019);
  assert.equal(tags.parseYear(1998), 1998);
  assert.equal(tags.parseYear('no year here'), null);
  assert.equal(tags.parseYear('12345'), null, 'a 5-digit run is not a year');
});

// ---- splitTrackAndTitle -----------------------------------------------------

test('T3: splitTrackAndTitle handles plain track, disc-track, and separators', () => {
  assert.deepEqual(tags.splitTrackAndTitle('01 Song Name'), { discNo: null, trackNo: 1, title: 'Song Name' });
  assert.deepEqual(tags.splitTrackAndTitle('07. Another'), { discNo: null, trackNo: 7, title: 'Another' });
  assert.deepEqual(tags.splitTrackAndTitle('03 - Dash Sep'), { discNo: null, trackNo: 3, title: 'Dash Sep' });
  assert.deepEqual(tags.splitTrackAndTitle('12_Underscore'), { discNo: null, trackNo: 12, title: 'Underscore' });
  assert.deepEqual(tags.splitTrackAndTitle('1-05 Disc Two Track Five'), { discNo: 1, trackNo: 5, title: 'Disc Two Track Five' });
});

test('T3: splitTrackAndTitle does NOT treat a 4-digit year as a track number', () => {
  assert.deepEqual(tags.splitTrackAndTitle('1979 The Song'), { discNo: null, trackNo: null, title: '1979 The Song' });
});

test('T3: splitTrackAndTitle returns the whole stem as title when there is no number', () => {
  assert.deepEqual(tags.splitTrackAndTitle('Just A Title'), { discNo: null, trackNo: null, title: 'Just A Title' });
});

// ---- parsePathConvention ----------------------------------------------------

test('T3: parsePathConvention reads Artist/Album/NN Title from a 3-deep path', () => {
  const r = tags.parsePathConvention('/music/Pink Floyd/The Wall/05 Mother.flac', '/music');
  assert.equal(r.artist, 'Pink Floyd');
  assert.equal(r.album, 'The Wall');
  assert.equal(r.trackNo, 5);
  assert.equal(r.title, 'Mother');
});

test('T3: parsePathConvention with a bare album folder (2-deep) yields album only', () => {
  const r = tags.parsePathConvention('/music/Mixtape/02 Track.mp3', '/music');
  assert.equal(r.artist, '', 'no artist derivable from a single folder level');
  assert.equal(r.album, 'Mixtape');
  assert.equal(r.trackNo, 2);
  assert.equal(r.title, 'Track');
});

test('T3: parsePathConvention with a loose file at the root yields title only', () => {
  const r = tags.parsePathConvention('/music/09 Loose.mp3', '/music');
  assert.equal(r.artist, '');
  assert.equal(r.album, '');
  assert.equal(r.trackNo, 9);
  assert.equal(r.title, 'Loose');
});

// ---- buildTrackMetadata (the precedence resolver) ---------------------------

test('T3: buildTrackMetadata — embedded tags WIN over the path convention, per field', () => {
  const r = tags.buildTrackMetadata({
    tags: { title: 'Real Title', artist: 'Real Artist', album: 'Real Album', track: '4/10', date: '2001-05', genre: 'Rock' },
    filePath: '/music/Wrong Artist/Wrong Album/99 Wrong Title.flac',
    rootFolder: '/music',
  });
  assert.equal(r.title, 'Real Title');
  assert.equal(r.artist, 'Real Artist');
  assert.equal(r.album, 'Real Album');
  assert.equal(r.trackNo, 4);
  assert.equal(r.year, 2001);
  assert.equal(r.genre, 'Rock');
  assert.equal(r.albumArtist, 'Real Artist', 'albumArtist defaults to artist when no albumartist tag');
});

test('T3: buildTrackMetadata — the path convention FILLS the fields the tags lack (per field)', () => {
  const r = tags.buildTrackMetadata({
    tags: { title: 'Tagged Title' }, // artist/album/track absent → path fills them
    filePath: '/music/The Band/The Record/06 Tagged Title.m4a',
    rootFolder: '/music',
  });
  assert.equal(r.title, 'Tagged Title', 'embedded title kept');
  assert.equal(r.artist, 'The Band', 'artist from path');
  assert.equal(r.album, 'The Record', 'album from path');
  assert.equal(r.trackNo, 6, 'track from path');
});

test('T3: buildTrackMetadata — albumartist tag drives albumArtist (compilation grouping)', () => {
  const r = tags.buildTrackMetadata({
    tags: { title: 'S', artist: 'Track Artist', album: 'Comp', albumartist: 'Various Artists' },
    filePath: '/music/Various Artists/Comp/01 S.mp3',
    rootFolder: '/music',
  });
  assert.equal(r.albumArtist, 'Various Artists');
  assert.equal(r.artist, 'Track Artist');
});

test('T3: buildTrackMetadata — title never empty: falls back to the bare filename', () => {
  const r = tags.buildTrackMetadata({ tags: {}, filePath: '/music/weird file.wav', rootFolder: '/music' });
  assert.equal(r.title, 'weird file');
  const r2 = tags.buildTrackMetadata({ tags: {}, filePath: '', rootFolder: '/music' });
  assert.equal(r2.title, 'Unknown');
});

test('T3: buildTrackMetadata tolerates junk input without throwing', () => {
  assert.doesNotThrow(() => tags.buildTrackMetadata());
  assert.doesNotThrow(() => tags.buildTrackMetadata({ tags: null, filePath: null, rootFolder: null }));
});

// ---- SIDECAR_ART_NAMES ------------------------------------------------------

test('T3: SIDECAR_ART_NAMES lists cover/folder/front in jpg/jpeg/png', () => {
  assert.ok(tags.SIDECAR_ART_NAMES.includes('cover.jpg'));
  assert.ok(tags.SIDECAR_ART_NAMES.includes('folder.jpg'));
  assert.ok(tags.SIDECAR_ART_NAMES.includes('front.png'));
});
