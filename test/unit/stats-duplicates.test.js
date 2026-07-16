'use strict';

// [UNIT] v1.41.11 (Dean: "see files that are truly duplicates so I can clean
// them up") -- the pure duplicates report over db.metadata + its RFC 4180
// CSV serializer (lib/stats.js). Uses the REAL extractYtdlpVideoId exported
// by server.js -- the same function the /api/duplicates route injects -- so
// the bracket-parsing behavior under test is the production one, never a
// re-typed copy that could drift.

const { test } = require('node:test');
const assert = require('node:assert');

const { computeDuplicateReport, duplicateReportToCsv } = require('../../lib/stats');
const { extractYtdlpVideoId } = require('../../server');

const OPTS = { extractVideoId: extractYtdlpVideoId };

function meta(items) {
  const out = {};
  items.forEach((item, i) => { out[item.id || `id${i}`] = { id: item.id || `id${i}`, ...item }; });
  return out;
}

test('same-basename files in different folders form ONE name group; singletons form none', () => {
  const report = computeDuplicateReport(meta([
    { id: 'a', filePath: '/lib/music/track.mp3', size: 100 },
    { id: 'b', filePath: '/lib/backup/track.mp3', size: 100 },
    { id: 'c', filePath: '/lib/music/unique.mp3', size: 50 },
  ]), OPTS);
  assert.equal(report.nameGroups.length, 1);
  assert.equal(report.nameGroups[0].key, 'track.mp3');
  assert.equal(report.nameGroups[0].items.length, 2);
  assert.equal(report.totals.nameGroupCount, 1);
  assert.equal(report.totals.nameFileCount, 2);
});

test('wastedBytes = total minus the largest copy (what deleting all-but-the-biggest frees)', () => {
  const report = computeDuplicateReport(meta([
    { id: 'a', filePath: '/x/v.mp4', size: 100 },
    { id: 'b', filePath: '/y/v.mp4', size: 80 },
    { id: 'c', filePath: '/z/v.mp4', size: 60 },
  ]), OPTS);
  const g = report.nameGroups[0];
  assert.equal(g.totalBytes, 240);
  assert.equal(g.wastedBytes, 140);
  assert.equal(g.items[0].size, 100, 'items sorted largest first');
  assert.equal(report.totals.nameWastedBytes, 140);
});

test('groups sort by wastedBytes descending with a deterministic key tiebreak', () => {
  const report = computeDuplicateReport(meta([
    { id: 'a1', filePath: '/p/small.mp4', size: 10 },
    { id: 'a2', filePath: '/q/small.mp4', size: 10 },
    { id: 'b1', filePath: '/p/big.mp4', size: 1000 },
    { id: 'b2', filePath: '/q/big.mp4', size: 1000 },
  ]), OPTS);
  assert.deepEqual(report.nameGroups.map((g) => g.key), ['big.mp4', 'small.mp4']);
});

test('same [videoid] under DIFFERENT basenames forms an id group; identical basenames stay name-group-only', () => {
  const report = computeDuplicateReport(meta([
    // different spellings of one video -- the v1.41.9 divergent class
    { id: 'a', filePath: '/dl/chan1/Title One [AAAAAAAAAAA].mp4', size: 500 },
    { id: 'b', filePath: '/dl/chan2/Retitled Later [AAAAAAAAAAA].mp4', size: 400 },
    // same id, same basename, two folders -> a NAME group, not an id group
    { id: 'c', filePath: '/dl/chan1/Same Name [BBBBBBBBBBB].mp4', size: 100 },
    { id: 'd', filePath: '/dl/chan3/Same Name [BBBBBBBBBBB].mp4', size: 100 },
  ]), OPTS);
  assert.equal(report.idGroups.length, 1, 'only the distinct-names id pair forms an id group');
  assert.equal(report.idGroups[0].key, 'AAAAAAAAAAA');
  assert.equal(report.idGroups[0].wastedBytes, 400);
  assert.deepEqual(report.nameGroups.map((g) => g.key), ['Same Name [BBBBBBBBBBB].mp4']);
});

test('persisted youtubeId is the fallback when the filename has no bracket (MeTube-era imports)', () => {
  const report = computeDuplicateReport(meta([
    { id: 'a', filePath: '/dl/imports/An Import.mp4', size: 300, youtubeId: 'CCCCCCCCCCC' },
    { id: 'b', filePath: '/dl/chan/Proper Name [CCCCCCCCCCC].mp4', size: 200 },
    { id: 'c', filePath: '/dl/imports/Bad Field.mp4', size: 100, youtubeId: 'not-a-valid-id-shape' },
  ]), OPTS);
  assert.equal(report.idGroups.length, 1);
  assert.equal(report.idGroups[0].items.length, 2, 'bracket + youtubeId-field copies matched');
});

test('no injected extractor -> idGroups is empty (name groups unaffected); malformed items are tolerated', () => {
  const report = computeDuplicateReport({
    a: { id: 'a', filePath: '/x/v [DDDDDDDDDDD].mp4', size: 10 },
    b: { id: 'b', filePath: '/y/v [DDDDDDDDDDD].mp4', size: 'NaN-ish' },
    c: null,
    d: { id: 'd' }, // no filePath
  });
  assert.equal(report.idGroups.length, 0);
  assert.equal(report.nameGroups.length, 1);
  assert.equal(report.nameGroups[0].totalBytes, 10, 'non-numeric size reads as 0');
  assert.equal(computeDuplicateReport(undefined, OPTS).nameGroups.length, 0, 'missing metadata is an empty report');
});

test('CSV: header + one section-tagged row per file, CRLF, all fields quoted, internal quotes doubled', () => {
  const report = computeDuplicateReport(meta([
    { id: 'a', filePath: '/x/Weird, "quoted" 😳.mp4', size: 9 },
    { id: 'b', filePath: '/y/Weird, "quoted" 😳.mp4', size: 7 },
  ]), OPTS);
  const csv = duplicateReportToCsv(report);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '"section","group_key","file_path","size_bytes","group_file_count","group_wasted_bytes"');
  assert.equal(lines.length, 4, 'header + 2 rows + trailing CRLF');
  assert.ok(lines[1].startsWith('"same-filename","Weird, ""quoted"" 😳.mp4","/x/Weird, ""quoted"" 😳.mp4","9"'), `row escaping: ${lines[1]}`);
  assert.equal(duplicateReportToCsv({ nameGroups: [], idGroups: [] }).split('\r\n').length, 2, 'empty report = header only');
});
