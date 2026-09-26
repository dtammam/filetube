'use strict';

require('../helpers/isolate-data-dir'); // tech-debt #202: MUST precede any server.js require (it opens a db)

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

// v1.338 D8c (Dean: "non-YouTube things supported by YT DLP should have generally
// first-class experiences"): a download from another site matches by its (site, id)
// pair. The collision fixture is load-bearing: a Reddit id spelled exactly like a
// YouTube id must never group with it, and the same id on two sites is two videos.
test('v1.338 D8c: downloads from another site group by (sourceExtractor, sourceId), never with a YouTube id spelled the same', () => {
  const report = computeDuplicateReport(meta([
    { id: 'r1', filePath: '/dl/alice/First Title [Reddit=AAAAAAAAAAA].mp4', size: 500, sourceExtractor: 'Reddit', sourceId: 'AAAAAAAAAAA' },
    { id: 'r2', filePath: '/dl/other/Retitled [Reddit=AAAAAAAAAAA].mp4', size: 300, sourceExtractor: 'Reddit', sourceId: 'AAAAAAAAAAA' },
    { id: 'f1', filePath: '/dl/alice/Same id other site [Facebook=AAAAAAAAAAA].mp4', size: 200, sourceExtractor: 'Facebook', sourceId: 'AAAAAAAAAAA' },
    { id: 'y1', filePath: '/dl/chan/A YouTube one [AAAAAAAAAAA].mp4', size: 100 },
    { id: 'y2', filePath: '/dl/imports/An import.mp4', size: 90, youtubeId: 'AAAAAAAAAAA' },
  ]), OPTS);
  const byKey = Object.fromEntries(report.idGroups.map((g) => [g.key, g.items.map((i) => i.id).sort()]));
  assert.deepEqual(byKey, {
    'Reddit:AAAAAAAAAAA': ['r1', 'r2'],
    AAAAAAAAAAA: ['y1', 'y2'],
  }, 'the two Reddit copies pair up; the YouTube pair stays its own; the lone Facebook item forms nothing');
  assert.equal(report.totals.idGroupCount, 2);
  assert.equal(report.idGroups.find((g) => g.key === 'Reddit:AAAAAAAAAAA').wastedBytes, 300);
});

test('v1.338 D8c: a YouTube id still wins for a proxy-host download (sourceExtractor Youtube + youtubeId), and a half-identity forms no key', () => {
  const report = computeDuplicateReport(meta([
    { id: 'p1', filePath: '/dl/chan/Via proxy [Youtube=BBBBBBBBBBB].mp4', size: 400, youtubeId: 'BBBBBBBBBBB', sourceExtractor: 'Youtube', sourceId: 'BBBBBBBBBBB' },
    { id: 'p2', filePath: '/dl/chan/Direct [BBBBBBBBBBB].mp4', size: 100 },
    // each half-identity comes in a PAIR, so a dropped half-check would form a group
    { id: 'h1', filePath: '/dl/x/No id one.mp4', size: 10, sourceExtractor: 'Reddit' },
    { id: 'h2', filePath: '/dl/y/No id two.mp4', size: 10, sourceExtractor: 'Reddit' },
    { id: 'h3', filePath: '/dl/x/Blank id one.mp4', size: 10, sourceExtractor: 'Reddit', sourceId: '  ' },
    { id: 'h4', filePath: '/dl/y/Blank id two.mp4', size: 10, sourceExtractor: 'Reddit', sourceId: '  ' },
    { id: 'h5', filePath: '/dl/z/No site.mp4', size: 10, sourceId: 'zzz' },
    { id: 'h6', filePath: '/dl/w/No site two.mp4', size: 10, sourceId: 'zzz' },
    { id: 'h7', filePath: '/dl/z/Blank site.mp4', size: 10, sourceExtractor: ' ', sourceId: 'yyy' },
    { id: 'h8', filePath: '/dl/w/Blank site two.mp4', size: 10, sourceExtractor: ' ', sourceId: 'yyy' },
  ]), OPTS);
  assert.deepEqual(report.idGroups.map((g) => [g.key, g.items.map((i) => i.id).sort()]), [['BBBBBBBBBBB', ['p1', 'p2']]]);
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

test('CSV: header + one section-tagged row per file, CRLF, all fields quoted, internal quotes doubled, wasted on the FIRST group row only', () => {
  const report = computeDuplicateReport(meta([
    { id: 'a', filePath: '/x/Weird, "quoted" 😳.mp4', size: 9 },
    { id: 'b', filePath: '/y/Weird, "quoted" 😳.mp4', size: 7 },
  ]), OPTS);
  const csv = duplicateReportToCsv(report);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '"section","group_key","file_path","size_bytes","group_file_count","group_wasted_bytes"');
  assert.equal(lines.length, 4, 'header + 2 rows + trailing CRLF');
  assert.ok(lines[1].startsWith('"same-filename","Weird, ""quoted"" 😳.mp4","/x/Weird, ""quoted"" 😳.mp4","9"'), `row escaping: ${lines[1]}`);
  // Adversarial-gate fix: group_wasted_bytes appears once per group (first
  // row), so a naive spreadsheet column SUM equals the real reclaim total
  // instead of multiplying it by group size.
  assert.ok(lines[1].endsWith(',"7"'), `first group row carries the wasted bytes: ${lines[1]}`);
  assert.ok(lines[2].endsWith(',""'), `subsequent group rows leave it empty: ${lines[2]}`);
  assert.equal(duplicateReportToCsv({ nameGroups: [], idGroups: [] }).split('\r\n').length, 2, 'empty report = header only');
});

test('CSV: a field starting with = + - or @ is defused with a leading apostrophe (formula-injection hardening, OWASP class)', () => {
  // NB: a POSIX filename cannot contain '/', so the hostile title uses a
  // slash-free formula shape (yt-dlp writes titles like this verbatim).
  const report = computeDuplicateReport(meta([
    { id: 'a', filePath: '/x/=SUM(A1:A9)+cmd [zzzzzzzzzzz].mp4', size: 5 },
    { id: 'b', filePath: '/y/=SUM(A1:A9)+cmd [zzzzzzzzzzz].mp4', size: 5 },
  ]), OPTS);
  const csv = duplicateReportToCsv(report);
  assert.ok(csv.includes('"\'=SUM(A1:A9)+cmd [zzzzzzzzzzz].mp4"'),
    'the group key cell is defused with a leading apostrophe');
  assert.ok(!/,"=SUM/.test(csv), 'no cell begins with a live formula character');
  assert.ok(csv.includes('"/x/=SUM'), 'a path starting with / is untouched (defusal only fires on the dangerous leading chars)');
});

test('name lens groups NFC/NFD normalization variants of the same filename (the v1.41.9 class, read-only lens)', () => {
  // \u escapes, never typed accents (the v1.37.5 fixture lesson): editors
  // and toolchains silently re-normalize typed accents, making the fixture
  // inert while staying green.
  const nfc = 'Beyonc\u00E9 - Halo.mp3';   // precomposed e-acute
  const nfd = 'Beyonce\u0301 - Halo.mp3';  // e + combining acute
  const report = computeDuplicateReport(meta([
    { id: 'a', filePath: `/lib/a/${nfc}`, size: 10 },
    { id: 'b', filePath: `/lib/b/${nfd}`, size: 8 },
  ]), OPTS);
  assert.equal(report.nameGroups.length, 1, 'the two spellings are one filename to a human');
  assert.equal(report.nameGroups[0].items.length, 2);
  assert.ok(report.nameGroups[0].items.some((i) => i.filePath.includes(nfd)), 'items keep their REAL on-disk paths');
});
