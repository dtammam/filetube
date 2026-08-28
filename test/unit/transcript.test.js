'use strict';

// [UNIT] Transcript export: lib/transcript.js. The load-bearing claim is the
// ROLLING-CAPTION de-duplication (see the module header): a yt-dlp
// auto-sub document repeats every spoken line across 2-3 contiguous cues
// (tagged first, then plain as the top line of the next cue). The fixture
// below is the EXACT shape of a real `--write-auto-subs` file (the leading
// whitespace-only payload line, the per-word `<00:00:00.640><c>` tags, the
// 10ms "hold" cues, `align:start position:0%` settings) so the parser is
// bound to the real upstream shape, not a tidy one (the v1.185 lesson).
const { test } = require('node:test');
const assert = require('node:assert');
const {
  cleanCueLine, parseVttCues, buildTranscriptLines, renderTranscriptBody,
  formatTranscriptTime, formatTranscriptDate, buildTranscriptDocument, vttToTranscriptDocument,
} = require('../../lib/transcript');

const ROLLING_VTT = [
  'WEBVTT',
  'Kind: captions',
  'Language: en',
  '',
  '00:00:00.240 --> 00:00:02.149 align:start position:0%',
  ' ',
  'Ladies<00:00:00.640><c> and</c><00:00:00.880><c> gentlemen,</c><00:00:01.360><c> welcome</c>',
  '',
  '00:00:02.149 --> 00:00:02.159 align:start position:0%',
  'Ladies and gentlemen, welcome',
  ' ',
  '',
  '00:00:02.159 --> 00:00:04.710 align:start position:0%',
  'Ladies and gentlemen, welcome',
  'Dylan<00:00:02.560><c> show.</c><00:00:02.800><c> It</c><00:00:02.960><c> is</c>',
  '',
  '00:00:04.710 --> 00:00:04.720 align:start position:0%',
  'Dylan show. It is',
  ' ',
  '',
  '00:00:04.720 --> 00:00:09.030 align:start position:0%',
  'Dylan show. It is',
  'the<00:00:05.000><c> summer</c>',
  '',
].join('\n');

test('transcript: rolling auto-captions collapse to each spoken line ONCE, timestamped at its FIRST cue', () => {
  const lines = buildTranscriptLines(parseVttCues(ROLLING_VTT));
  assert.deepEqual(lines, [
    { startMs: 240, text: 'Ladies and gentlemen, welcome' },
    { startMs: 2159, text: 'Dylan show. It is' },
    { startMs: 4720, text: 'the summer' },
  ]);
});

test('transcript: a whitespace-only payload line does NOT terminate a cue (spec: only an EMPTY line does)', () => {
  // Binds the first-cue shape specifically: " " then the tagged text. Were the
  // space a terminator, the tagged line would be orphaned and the first
  // transcript line would inherit the SECOND cue's 2149ms start.
  const cues = parseVttCues(ROLLING_VTT);
  assert.equal(cues[0].startMs, 240);
  assert.deepEqual(cues[0].lines, ['Ladies and gentlemen, welcome']);
});

test('transcript: hand-authored captions (gapped cues) are NOT de-duplicated - a genuinely repeated line survives', () => {
  const vtt = [
    'WEBVTT', '',
    '00:00:01.000 --> 00:00:02.000', 'Yeah.', '',
    '00:00:05.000 --> 00:00:06.000', 'Yeah.', '',
    '00:00:06.000 --> 00:00:07.000', 'Okay.', '',
  ].join('\n');
  const lines = buildTranscriptLines(parseVttCues(vtt));
  assert.deepEqual(lines.map((l) => l.text), ['Yeah.', 'Yeah.', 'Okay.']);
});

test('transcript: a CONTIGUOUS repeated line is dropped, a gapped one (beyond the slack) is kept', () => {
  const mk = (gapMs) => [
    'WEBVTT', '',
    '00:00:01.000 --> 00:00:02.000', 'Same line', '',
    `00:00:0${2 + Math.floor(gapMs / 1000)}.${String(gapMs % 1000).padStart(3, '0')} --> 00:00:09.000`, 'Same line', 'Next line', '',
  ].join('\n');
  assert.deepEqual(buildTranscriptLines(parseVttCues(mk(0))).map((l) => l.text), ['Same line', 'Next line']);
  assert.deepEqual(buildTranscriptLines(parseVttCues(mk(499))).map((l) => l.text), ['Same line', 'Next line']);
  assert.deepEqual(buildTranscriptLines(parseVttCues(mk(1000))).map((l) => l.text), ['Same line', 'Same line', 'Next line']);
});

// GATE (adversarial W1, the content-loss class): the rolled repeat is a
// SUFFIX/PREFIX overlap, never set membership. On Dean's real file a second
// speaker answering with the SAME words ("&gt;&gt; I'm in." back) was dropped
// because the membership rule saw it in the previous cue. Each of these was
// red under the membership implementation.
test('transcript: a NEW utterance equal to the rolled line (second speaker) is KEPT - overlap, not membership', () => {
  const vtt = [
    'WEBVTT', '',
    '00:22:05.000 --> 00:22:07.280', ">> I'm<00:22:05.100><c> in.</c>", '',
    "00:22:07.280 --> 00:22:08.549", ">> I'm in.", ">> I'm<00:22:07.440><c> in.</c>", '',
    "00:22:08.549 --> 00:22:10.000", ">> I'm in.", 'Not like we do.', '',
  ].join('\n');
  assert.deepEqual(buildTranscriptLines(parseVttCues(vtt)).map((l) => l.text), [">> I'm in.", ">> I'm in.", 'Not like we do.']);
});

test('transcript: [A,B] -> [C,B]: B is a NEW line (no suffix/prefix overlap), both emitted', () => {
  const vtt = [
    'WEBVTT', '',
    '00:00:01.000 --> 00:00:02.000', 'A', 'B', '',
    '00:00:02.000 --> 00:00:03.000', 'C', 'B', '',
  ].join('\n');
  assert.deepEqual(buildTranscriptLines(parseVttCues(vtt)).map((l) => l.text), ['A', 'B', 'C', 'B']);
});

test('transcript: a text-less hold cue between rolling cues does not reset the overlap ([A,B] -> [] -> [B,C] emits C only)', () => {
  const vtt = [
    'WEBVTT', '',
    '00:00:01.000 --> 00:00:02.000', 'A', 'B', '',
    '00:00:02.000 --> 00:00:02.010', ' ', '',
    '00:00:02.010 --> 00:00:03.000', 'B', 'C', '',
  ].join('\n');
  assert.deepEqual(buildTranscriptLines(parseVttCues(vtt)).map((l) => l.text), ['A', 'B', 'C']);
});

test('transcript: the contiguity slack is INCLUSIVE at exactly 500ms; CRLF documents parse identically to LF', () => {
  const lf = ['WEBVTT', '', '00:00:01.000 --> 00:00:02.000', 'Same', '', '00:00:02.500 --> 00:00:03.000', 'Same', 'Next', ''].join('\n');
  assert.deepEqual(buildTranscriptLines(parseVttCues(lf)).map((l) => l.text), ['Same', 'Next']);
  assert.deepEqual(parseVttCues(lf.replace(/\n/g, '\r\n')), parseVttCues(lf));
});

test('transcript: a STYLE block containing an arrow is skipped, never parsed as a cue', () => {
  const vtt = ['WEBVTT', '', 'STYLE', '::cue { content: "-->" }', '00:00:09.000 --> 00:00:10.000', '', '00:00:01.000 --> 00:00:02.000', 'Real', ''].join('\n');
  const cues = parseVttCues(vtt);
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0].lines, ['Real']);
});

test('transcript: a two-line cue repeated verbatim by the next cue emits neither line twice', () => {
  const vtt = [
    'WEBVTT', '',
    '00:00:01.000 --> 00:00:02.000', 'Line A', 'Line B', '',
    '00:00:02.000 --> 00:00:03.000', 'Line A', 'Line B', '',
    '00:00:03.000 --> 00:00:04.000', 'Line B', 'Line C', '',
  ].join('\n');
  assert.deepEqual(buildTranscriptLines(parseVttCues(vtt)).map((l) => l.text), ['Line A', 'Line B', 'Line C']);
});

test('transcript: cleanCueLine strips timing/<c>/voice tags, decodes entities, collapses whitespace', () => {
  assert.equal(cleanCueLine('Ladies<00:00:00.640><c> and</c>  <b>gentlemen</b>'), 'Ladies and gentlemen');
  assert.equal(cleanCueLine('<v Dean>Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;yo&#39;&nbsp;now&lrm;</v>'), "Tom & Jerry <3 \"hi\" 'yo' now");
  assert.equal(cleanCueLine(undefined), '');
});

test('transcript: parser is cue-block aware - a timing-shaped PAYLOAD line stays payload; NOTE/STYLE blocks are skipped', () => {
  const vtt = [
    'WEBVTT', '',
    'NOTE this is a comment', 'spanning two lines', '',
    'STYLE', '::cue { color: red }', '',
    'cue-id-1',
    '00:00:01.000 --> 00:00:02.000', 'The clock read', '00:00:05.000 --> 00:00:06.000', '',
    '00:00:03.000 --> 00:00:04.000', 'Done', '',
  ].join('\n');
  const cues = parseVttCues(vtt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0].lines, ['The clock read', '00:00:05.000 --> 00:00:06.000']);
  assert.deepEqual(cues[1].lines, ['Done']);
});

test('transcript: garbage / empty / non-string input yields an empty transcript, never a throw', () => {
  for (const bad of ['', 'not vtt at all\n\n\n', null, undefined, 42, '00:00:xx.000 --> 00:00:02.000\nhi\n']) {
    assert.deepEqual(parseVttCues(bad), []);
    assert.equal(renderTranscriptBody(buildTranscriptLines(parseVttCues(bad))), '');
  }
});

test('transcript: renderTranscriptBody prefixes [m:ss] / [h:mm:ss] only when timestamps are requested', () => {
  const lines = [{ startMs: 5000, text: 'a' }, { startMs: 65000, text: 'b' }, { startMs: 3600000 + 61000, text: 'c' }];
  assert.equal(renderTranscriptBody(lines), 'a\nb\nc');
  assert.equal(renderTranscriptBody(lines, { timestamps: true }), '[0:05] a\n[1:05] b\n[1:01:01] c');
  assert.equal(renderTranscriptBody(lines, { timestamps: false }), 'a\nb\nc');
  assert.equal(formatTranscriptTime(-5), '0:00');
});

test('transcript: the document header is title / Published <date> / channel, then a blank line, then the body', () => {
  const doc = buildTranscriptDocument({ title: '  My Video ', releaseDate: Date.UTC(2024, 0, 5), addedAt: 1, channelName: 'Tim Dylan' }, 'hello\nworld');
  assert.equal(doc, 'My Video\nPublished January 5, 2024\nTim Dylan\n\nhello\nworld\n');
});

test('transcript: header falls back to "Added <date>" without a releaseDate, omits channel when unknown, "Untitled" when no title', () => {
  const doc = buildTranscriptDocument({ addedAt: Date.UTC(2026, 7, 28, 23, 59) }, 'x');
  assert.equal(doc, 'Untitled\nAdded August 28, 2026\n\nx\n');
  // No date at all: header is the title alone.
  assert.equal(buildTranscriptDocument({ title: 'T', channelName: ' ' }, ''), 'T\n\n\n');
});

test('transcript: dates format in UTC (a UTC-midnight releaseDate never rolls to the previous day)', () => {
  assert.equal(formatTranscriptDate(Date.UTC(2023, 11, 31)), 'December 31, 2023');
  assert.equal(formatTranscriptDate(NaN), '');
});

test('transcript: vttToTranscriptDocument composes the whole pipeline on the rolling fixture', () => {
  const doc = vttToTranscriptDocument(ROLLING_VTT, { title: 'Hold', releaseDate: Date.UTC(2024, 0, 5), channelName: 'Tim' }, { timestamps: true });
  assert.equal(doc, 'Hold\nPublished January 5, 2024\nTim\n\n[0:00] Ladies and gentlemen, welcome\n[0:02] Dylan show. It is\n[0:04] the summer\n');
});
