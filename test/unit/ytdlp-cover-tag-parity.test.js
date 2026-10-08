'use strict';

// [UNIT] v1.374.0 (d) gate r1 (qa W1): the cover re-embed refuses to replace a file unless every tag the LIBRARY SCAN reads
// came back unchanged. lib/ytdlp/cover.js cannot require server.js, so it mirrors parseFfprobeTags; this test locks the
// mirror to the real one (server.js EMBEDDED_TAG_WHITELIST + its alias folding) on a fixture per key and per alias.
// Requiring server.js needs an isolated DATA_DIR (own process per test file), as test/unit/ffprobe-tags.test.js does.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { parseFfprobeTags } = require('../../server');
const cover = require('../../lib/ytdlp/cover');

// what the scan keeps, from the cover's map: drop purl (the scan reads it through parseEmbeddedSourceUrl, not the tag
// list) and apply the scan's one display-only step, the description / comment dedup
function asScan(map) {
  const out = Object.assign({}, map);
  delete out.purl;
  if (out.description && out.comment && out.description.toLowerCase() === out.comment.toLowerCase()) delete out.comment;
  return out;
}

const FIXTURES = [
  { title: 'T', artist: 'A', album: 'B', date: '20240101', genre: 'G', composer: 'C', description: 'D', comment: 'https://x', show: 'S', copyright: 'R', albumartist: 'AA', track: '3', disc: '1/2', encoder: 'Lavf', synopsis: 'D' },
  { TITLE: ' padded ', ALBUM_ARTIST: 'aa', TRACKNUMBER: '4', DISCNUMBER: '2', YEAR: '1999' },
  { 'album artist': 'x', track_number: '5', disc_number: '3', date: '', year: '2001' },
  { album_artist: 'first', albumartist: 'canonical', tracknumber: '9', track: '1' },
  { description: 'same', comment: 'SAME' },
  { purl: 'https://www.youtube.com/watch?v=c1Paj8je5sM', title: 'T' },
  {},
];

test('the cover\'s compared tags are exactly what parseFfprobeTags reads (plus purl), fixture by fixture', () => {
  for (const raw of FIXTURES) {
    assert.deepStrictEqual(asScan(cover.scanTagsOf(raw)), parseFfprobeTags({ format: { tags: raw } }), JSON.stringify(raw));
  }
});

test('every key of server.js EMBEDDED_TAG_WHITELIST is compared (the list itself, read from the source)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  const block = /const EMBEDDED_TAG_WHITELIST = \[([\s\S]*?)\];/.exec(src)[1].replace(/\/\/[^\n]*/g, '');
  const keys = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]); // any quoted key (gate r2 qa: `release_date` too)
  assert.ok(keys.length >= 13, 'the list was read');
  assert.deepStrictEqual(keys, cover.SCAN_TAG_KEYS);
  assert.ok(cover.COMPARED_TAG_KEYS.includes('purl'));
  assert.ok(!cover.COMPARED_TAG_KEYS.includes('encoder'));
});
