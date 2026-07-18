'use strict';

// [UNIT] v1.15.0 item 9 -- additive gap-fill for parseFfprobeTags
// (test/unit/ffprobe-tags.test.js already covers title/artist/genre/comment/
// description/date-year-fallback/malformed-input; this file only adds the
// remaining untested whitelist members and a non-string-value edge case, so
// it never duplicates that file's assertions). Isolate DATA_DIR so requiring
// the server is side-effect-free (own process per test file).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { parseFfprobeTags } = require('../../server');

test('parseFfprobeTags: extracts the remaining whitelisted tags (album, composer, show, copyright)', () => {
  const j = {
    format: {
      tags: {
        album: 'Greatest Hits',
        composer: 'J. Doe',
        show: 'My Series',
        copyright: '(c) 2026',
      },
    },
  };
  const out = parseFfprobeTags(j);
  assert.equal(out.album, 'Greatest Hits');
  assert.equal(out.composer, 'J. Doe');
  assert.equal(out.show, 'My Series');
  assert.equal(out.copyright, '(c) 2026');
});

test('parseFfprobeTags: a non-string tag value is silently dropped, never throws', () => {
  const j = { format: { tags: { title: 42, genre: ['Rock'], artist: { name: 'x' }, album: 'Real Album' } } };
  const out = parseFfprobeTags(j);
  assert.equal(out.title, undefined, 'a numeric tag value must not be surfaced');
  assert.equal(out.genre, undefined, 'an array tag value must not be surfaced');
  assert.equal(out.artist, undefined, 'an object tag value must not be surfaced');
  assert.equal(out.album, 'Real Album', 'a genuine string tag alongside the non-string ones is still extracted');
});

test('parseFfprobeTags: an all-whitelisted-tags-present payload surfaces every one of them simultaneously', () => {
  const j = {
    format: {
      tags: {
        title: 'T', artist: 'A', album: 'Al', date: '2020', genre: 'G',
        composer: 'C', description: 'D', comment: 'Different comment', show: 'S', copyright: 'Cp',
      },
    },
  };
  const out = parseFfprobeTags(j);
  for (const key of ['title', 'artist', 'album', 'date', 'genre', 'composer', 'description', 'comment', 'show', 'copyright']) {
    assert.ok(key in out, `expected ${key} to be present when every whitelisted tag is supplied`);
  }
});

// v1.44 music: the new canonical music tags + their alias spellings.
test('parseFfprobeTags: surfaces the canonical music tags albumartist/track/disc', () => {
  const out = parseFfprobeTags({ format: { tags: { albumartist: 'VA', track: '3/12', disc: '1/2' } } });
  assert.equal(out.albumartist, 'VA');
  assert.equal(out.track, '3/12');
  assert.equal(out.disc, '1/2');
});

test('parseFfprobeTags: folds album_artist/tracknumber/discnumber aliases into the canonical keys', () => {
  const out = parseFfprobeTags({ format: { tags: { album_artist: 'Alias VA', tracknumber: '7', discnumber: '2' } } });
  assert.equal(out.albumartist, 'Alias VA', 'album_artist folds into albumartist');
  assert.equal(out.track, '7', 'tracknumber folds into track');
  assert.equal(out.disc, '2', 'discnumber folds into disc');
});

test('parseFfprobeTags: the canonical tag WINS over its alias when both are present', () => {
  const out = parseFfprobeTags({ format: { tags: { albumartist: 'Canonical', album_artist: 'Alias' } } });
  assert.equal(out.albumartist, 'Canonical');
});

test('parseFfprobeTags: "album artist" (space spelling) also folds into albumartist', () => {
  const out = parseFfprobeTags({ format: { tags: { 'album artist': 'Spaced VA' } } });
  assert.equal(out.albumartist, 'Spaced VA');
});
