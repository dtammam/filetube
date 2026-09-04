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

test('v1.273: the button appears ONLY on a chapter album, and the header is otherwise unchanged', () => {
  const chapters = [chap(0, 0, 'Intro'), chap(1, 90, 'Two')];
  const withBtn = M.buildDrillHeaderHtml({ type: 'album', label: 'A Long Talk' }, chapters);
  assert.match(withBtn, /class="music-drill-chapters/, 'a chaptered album offers the editor');
  assert.match(withBtn, />\s*Edit chapters</, 'labelled for what it does');

  const plain = M.buildDrillHeaderHtml({ type: 'album', label: 'The Wall' }, [
    { id: 't1', source: 'library', title: 'In the Flesh' },
  ]);
  assert.doesNotMatch(plain, /music-drill-chapters/, 'an ordinary album does not');
  // the pre-existing controls survive on both (this header is shared with the sticky bar's classes)
  for (const html of [withBtn, plain]) {
    assert.match(html, /music-drill-play/, 'Play still there');
    assert.match(html, /music-drill-shuffle/, 'Shuffle still there');
    assert.match(html, /music-drill-back/, 'Back still there');
  }
});

test('v1.273: a 0:00 chapter keeps its timestamp - the stamp mirrors the watch page, not the track formatter', () => {
  // THE BUG THIS PREVENTS: music.js's own formatTrackDuration returns '' for 0, so a
  // first chapter at 0:00 would be written as " Intro" and the editor would re-parse
  // the whole line as a title, silently destroying the chapter list on save.
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
  // eslint-disable-next-line no-new-func
  const watchStamp = new Function(m[0] + '; return formatDuration;')();
  assert.strictEqual(typeof watchStamp, 'function', 'and it evaluates');
  for (const s of [0, 5, 59, 60, 61, 599, 600, 3599, 3600, 7325]) {
    assert.strictEqual(M.chapterStamp(s), watchStamp(s),
      `chapterStamp(${s}) must equal what the watch page writes, or a round trip shifts every timestamp`);
  }
});
