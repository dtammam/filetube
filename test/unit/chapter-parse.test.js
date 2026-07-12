'use strict';

// [UNIT] v1.34 T3 (Dean, chapters) -- the pure chapter parsers + the
// serve-time precedence resolver (server.js): ffprobe -show_chapters output,
// "0:00 Intro" description/editor lines, and manual > embedded > description.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseFfprobeChapters, parseChapterLines, deriveDescriptionChapters,
  resolveItemChapters, normalizeChapter, finalizeChapters, MAX_CHAPTERS,
} = require('../../server');

// ---- parseFfprobeChapters ---------------------------------------------------

test('parseFfprobeChapters maps ffprobe chapter objects to {startTime, title} off start_time (never time_base ticks)', () => {
  const probe = {
    chapters: [
      { id: 0, time_base: '1/1000', start: 0, start_time: '0.000000', end: 90000, end_time: '90.000000', tags: { title: 'Intro' } },
      { id: 1, time_base: '1/1000', start: 90000, start_time: '90.000000', end: 200000, end_time: '200.000000', tags: { title: 'Main 🎵' } },
    ],
  };
  assert.deepEqual(parseFfprobeChapters(probe), [
    { startTime: 0, title: 'Intro' },
    { startTime: 90, title: 'Main 🎵' },
  ]);
});

test('parseFfprobeChapters accepts raw stdout, tolerates missing tags/titles, drops garbage entries, sorts + dedups', () => {
  const probe = JSON.stringify({
    chapters: [
      { start_time: '30.5', tags: {} },
      { start_time: '10.0', tags: { title: 'Second on disk, first in time' } },
      { start_time: 'garbage' },
      { start_time: '-5' },
      null,
      { start_time: '10.0', tags: { title: 'duplicate start -- dropped' } },
    ],
  });
  assert.deepEqual(parseFfprobeChapters(probe), [
    { startTime: 10, title: 'Second on disk, first in time' },
    { startTime: 30.5, title: '' },
  ]);
});

test('parseFfprobeChapters degrades to [] on malformed/chapterless input, never throws', () => {
  assert.deepEqual(parseFfprobeChapters('{not json'), []);
  assert.deepEqual(parseFfprobeChapters({}), []);
  assert.deepEqual(parseFfprobeChapters({ chapters: 'nope' }), []);
  assert.deepEqual(parseFfprobeChapters(null), []);
});

// ---- parseChapterLines ------------------------------------------------------

test('parseChapterLines parses the classic YouTube description list (all three timestamp shapes, separators optional)', () => {
  const text = [
    'Check out my video!',
    '0:00 Intro',
    '1:30 - The Setup',
    '(12:05) The Twist',
    '[1:02:03] — Finale',
    'not a chapter line',
    '',
  ].join('\n');
  assert.deepEqual(parseChapterLines(text), [
    { startTime: 0, title: 'Intro' },
    { startTime: 90, title: 'The Setup' },
    { startTime: 725, title: 'The Twist' },
    { startTime: 3723, title: 'Finale' },
  ]);
});

test('parseChapterLines strips control chars from titles (emoji survive), caps count at MAX_CHAPTERS', () => {
  const parsed = parseChapterLines('0:00 Hi\x00 there 🎵');
  assert.deepEqual(parsed, [{ startTime: 0, title: 'Hi there 🎵' }]);
  // H:MM:SS form so every generated line stays within the timestamp grammar
  // (bare minutes only go to two digits).
  const many = Array.from({ length: MAX_CHAPTERS + 50 }, (_, i) => `${Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}:00 Ch${i}`).join('\n');
  assert.equal(parseChapterLines(many).length, MAX_CHAPTERS);
});

test('parseChapterLines: empty/non-string input yields []', () => {
  assert.deepEqual(parseChapterLines(''), []);
  assert.deepEqual(parseChapterLines(undefined), []);
  assert.deepEqual(parseChapterLines(42), []);
});

// ---- deriveDescriptionChapters (the acceptance gate) ------------------------

test('deriveDescriptionChapters requires >=2 chapters AND the first at 0:00 (a stray timestamp in prose never counts)', () => {
  assert.equal(deriveDescriptionChapters('watch 2:30 for the good part').length, 0, 'one non-zero timestamp is prose, not a chapter list');
  assert.equal(deriveDescriptionChapters('0:00 Intro').length, 0, 'a single chapter is not a list');
  assert.equal(deriveDescriptionChapters('1:00 A\n2:00 B').length, 0, 'a list not starting at 0:00 is rejected');
  assert.deepEqual(deriveDescriptionChapters('0:00 Intro\n2:00 Main'), [
    { startTime: 0, title: 'Intro' },
    { startTime: 120, title: 'Main' },
  ]);
});

// ---- resolveItemChapters (manual > embedded > description) ------------------

test('resolveItemChapters: manual wins over embedded wins over description; [] + null source when nothing yields', () => {
  const manual = [{ startTime: 5, title: 'Manual' }];
  const embedded = [{ startTime: 0, title: 'Embedded' }];
  const desc = '0:00 DescIntro\n1:00 DescMain';

  assert.deepEqual(
    resolveItemChapters({ chaptersManual: manual, chapters: embedded, tags: { description: desc } }),
    { chapters: manual, chaptersSource: 'manual' });
  assert.deepEqual(
    resolveItemChapters({ chapters: embedded, tags: { description: desc } }),
    { chapters: embedded, chaptersSource: 'embedded' });
  const fromDesc = resolveItemChapters({ chapters: [], tags: { description: desc } });
  assert.equal(fromDesc.chaptersSource, 'description');
  assert.equal(fromDesc.chapters.length, 2);
  assert.deepEqual(
    resolveItemChapters({ chapters: [], tags: {} }),
    { chapters: [], chaptersSource: null });
});

// ---- normalize/finalize helpers ---------------------------------------------

test('normalizeChapter bounds inputs; finalizeChapters sorts ascending and first-wins on duplicate startTimes', () => {
  assert.equal(normalizeChapter(-1, 'x'), null);
  assert.equal(normalizeChapter('nope', 'x'), null);
  assert.deepEqual(normalizeChapter(3.5, '  T  '), { startTime: 3.5, title: 'T' });
  assert.deepEqual(
    finalizeChapters([{ startTime: 9, title: 'b' }, { startTime: 1, title: 'a' }, { startTime: 9, title: 'dup' }]),
    [{ startTime: 1, title: 'a' }, { startTime: 9, title: 'b' }]);
});
