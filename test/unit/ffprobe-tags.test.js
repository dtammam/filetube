'use strict';

// parseFfprobeTags is exported from server.js. Isolate DATA_DIR so requiring the
// server is side-effect-free (own process per test file).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { parseFfprobeTags } = require('../../server');

test('parseFfprobeTags: extracts whitelisted format tags', () => {
  const j = { format: { tags: { title: 'My Clip', comment: 'a note', bogus: 'x' } } };
  const out = parseFfprobeTags(j);
  assert.equal(out.title, 'My Clip');
  assert.equal(out.comment, 'a note');
  assert.equal(out.bogus, undefined, 'non-whitelisted tags are dropped');
});

test('parseFfprobeTags: accepts a raw JSON string too', () => {
  const s = JSON.stringify({ format: { tags: { artist: 'Someone' } } });
  assert.equal(parseFfprobeTags(s).artist, 'Someone');
});

test('parseFfprobeTags: is case-insensitive and trims', () => {
  const j = { format: { tags: { TITLE: '  Spaced  ', Genre: 'Jazz' } } };
  const out = parseFfprobeTags(j);
  assert.equal(out.title, 'Spaced');
  assert.equal(out.genre, 'Jazz');
});

test('parseFfprobeTags: dedups identical description and comment', () => {
  const j = { format: { tags: { description: 'same', comment: 'same' } } };
  const out = parseFfprobeTags(j);
  assert.equal(out.description, 'same');
  assert.equal(out.comment, undefined, 'duplicate comment removed');
});

test('parseFfprobeTags: keeps description and comment when they differ', () => {
  const j = { format: { tags: { description: 'a', comment: 'b' } } };
  const out = parseFfprobeTags(j);
  assert.equal(out.description, 'a');
  assert.equal(out.comment, 'b');
});

test('parseFfprobeTags: dedups description/comment case-insensitively', () => {
  const j = { format: { tags: { description: 'Same Text', comment: 'same text' } } };
  const out = parseFfprobeTags(j);
  assert.equal(out.description, 'Same Text');
  assert.equal(out.comment, undefined, 'case-insensitive duplicate removed');
});

test('parseFfprobeTags: falls back to the year tag for date', () => {
  assert.equal(parseFfprobeTags({ format: { tags: { year: '1999' } } }).date, '1999');
  // an explicit date wins over year
  assert.equal(parseFfprobeTags({ format: { tags: { date: '2020', year: '1999' } } }).date, '2020');
});

test('parseFfprobeTags: returns {} on malformed / empty / missing tags', () => {
  assert.deepEqual(parseFfprobeTags('{ not json'), {});
  assert.deepEqual(parseFfprobeTags(null), {});
  assert.deepEqual(parseFfprobeTags({}), {});
  assert.deepEqual(parseFfprobeTags({ format: {} }), {});
  assert.deepEqual(parseFfprobeTags({ format: { tags: {} } }), {});
});

test('parseFfprobeTags: skips empty-string tag values', () => {
  const j = { format: { tags: { title: '   ', genre: 'Rock' } } };
  const out = parseFfprobeTags(j);
  assert.equal(out.title, undefined);
  assert.equal(out.genre, 'Rock');
});
