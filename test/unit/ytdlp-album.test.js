'use strict';

// [UNIT] v1.371.0 "Save as an album" (plan docs/exec-plans/completed/2026-10-07-v1371-album-tags.md): lib/ytdlp/album.js
// validates the album a playlist job carries and builds the yt-dlp argv that writes the tags; args.js adds that argv
// to a YouTube AUDIO one-off only. The flag forms themselves were measured against the real yt-dlp 2026.08.19 (plan
// section 3 and 7); these tests lock the argv FileTube builds to those measured forms.

const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const assert = require('node:assert');

const album = require('../../lib/ytdlp/album');
const args = require('../../lib/ytdlp/args');

const IDS = ['vid00000001', 'vid00000002', 'vid00000003'];
const good = (extra) => Object.assign({ title: 'Kyle Gordon Is Everywhere', artist: 'Kyle Gordon', cleanTitles: false, tracks: { vid00000001: 1, vid00000003: 3 } }, extra || {});

test('albumFrom: a valid album is trimmed, its tracks keyed by the job ids only, in a null-prototype map', () => {
  const r = album.albumFrom(good({ title: '  Brat  ', tracks: { vid00000001: 1, vid00000003: 7, notInJob000: 2 } }), IDS);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.album.title, 'Brat');
  assert.strictEqual(r.album.artist, 'Kyle Gordon');
  assert.strictEqual(r.album.cleanTitles, false);
  assert.strictEqual(Object.getPrototypeOf(r.album.tracks), null);
  assert.deepStrictEqual({ ...r.album.tracks }, { vid00000001: 1, vid00000003: 7 }, 'an id outside the job is dropped');
});

test('albumFrom: cleanTitles is true only for the boolean true', () => {
  assert.strictEqual(album.albumFrom(good({ cleanTitles: true }), IDS).album.cleanTitles, true);
  assert.strictEqual(album.albumFrom(good({ cleanTitles: 'true' }), IDS).album.cleanTitles, false);
  assert.strictEqual(album.albumFrom(good({ cleanTitles: 1 }), IDS).album.cleanTitles, false);
});

test('albumFrom: each refusal on its own (name, artist, control bytes incl. NUL, length, track numbers, shape)', () => {
  const nul = String.fromCharCode(0);
  const cases = [
    [null, 'Invalid album'],
    [[], 'Invalid album'],
    [good({ title: '' }), 'The album needs a name'],
    [good({ title: '   ' }), 'The album needs a name'],
    [good({ title: 7 }), 'The album needs a name'],
    [good({ title: 'a'.repeat(201) }), 'The album needs a name'],
    [good({ title: 'A' + nul + 'B' }), 'The album needs a name'],
    [good({ title: 'A\nB' }), 'The album needs a name'],
    [good({ artist: '' }), 'The album needs an album artist'],
    [good({ artist: 'X' + String.fromCharCode(0x7f) }), 'The album needs an album artist'],
    [good({ artist: 'b'.repeat(201) }), 'The album needs an album artist'],
    [good({ artist: 'Kyle\u200bGordon' }), 'The album needs an album artist'],
    [good({ artist: 'Kyle\u202eGordon' }), 'The album needs an album artist'],
    [good({ title: 'A\u0085B' }), 'The album needs a name'],
    [good({ title: 'A\u2028B' }), 'The album needs a name'],
    [good({ title: 'A\ufeffB' }), 'The album needs a name'], // (a LEADING BOM is trimmed away, which is fine)
    [good({ tracks: { vid00000001: 0 } }), 'Invalid track number'],
    [good({ tracks: { vid00000001: 10000 } }), 'Invalid track number'],
    [good({ tracks: { vid00000001: 1.5 } }), 'Invalid track number'],
    [good({ tracks: { vid00000001: '1' } }), 'Invalid track number'],
  ];
  for (const [input, msg] of cases) {
    const r = album.albumFrom(input, IDS);
    assert.strictEqual(r.ok, false, JSON.stringify(input));
    assert.ok(r.error.startsWith(msg), `${JSON.stringify(input)} -> ${r.error}`);
  }
  assert.strictEqual(album.albumFrom(good({ title: 'a'.repeat(200), artist: 'b'.repeat(200), tracks: { vid00000001: 9999 } }), IDS).ok, true, 'the bounds themselves pass');
});

test('albumFrom: a __proto__ key in tracks never pollutes, and an inherited key is not a track', () => {
  const tracks = JSON.parse('{"__proto__": {"vid00000002": 5}, "vid00000001": 1}');
  const r = album.albumFrom(good({ tracks }), IDS);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual({ ...r.album.tracks }, { vid00000001: 1 });
  assert.strictEqual(({}).vid00000002, undefined);
});

test('trackTagsFor: the track of one video; null without an album; a video with no number has track null', () => {
  const a = album.albumFrom(good({ cleanTitles: true }), IDS).album;
  assert.deepStrictEqual(album.trackTagsFor(a, 'vid00000003'), { album: 'Kyle Gordon Is Everywhere', albumArtist: 'Kyle Gordon', track: 3, cleanTitles: true, title: null });
  assert.strictEqual(album.trackTagsFor(a, 'vid00000002').track, null);
  assert.strictEqual(album.trackTagsFor(null, 'vid00000001'), null);
});

test('pyReplacementLiteral doubles every backslash and nothing else (the measured \\g<0> trap)', () => {
  assert.strictEqual(album.pyReplacementLiteral('a\\g<0>b'), 'a\\\\g<0>b');
  assert.strictEqual(album.pyReplacementLiteral('100% "x": $1 [y] %(id)s'), '100% "x": $1 [y] %(id)s');
});

test('pyRegexLiteral escapes ASCII punctuation and spaces, never an ASCII letter or digit, leaves non-ASCII', () => {
  assert.strictEqual(album.pyRegexLiteral('Kyle Gordon'), 'Kyle\\ Gordon');
  assert.strictEqual(album.pyRegexLiteral('A.B*C(D)[E]?+|^$\\'), 'A\\.B\\*C\\(D\\)\\[E\\]\\?\\+\\|\\^\\$\\\\');
  assert.strictEqual(album.pyRegexLiteral('Sigur Rós_9'), 'Sigur\\ Rós_9');
  assert.strictEqual(/\\[A-Za-z0-9]/.test(album.pyRegexLiteral('abcXYZ019')), false);
});

test('albumTagArgs: the measured argv, in order, with the values as their own elements', () => {
  const out = album.albumTagArgs({ album: 'Brat', albumArtist: 'Charli xcx', track: 4, cleanTitles: false });
  assert.deepStrictEqual(out, [
    '--parse-metadata', 'pre_process:%(id)s:(?P<meta_album>.+)',
    '--replace-in-metadata', 'pre_process:meta_album', '(?s).+', 'Brat',
    '--parse-metadata', 'pre_process:%(id)s:(?P<meta_album_artist>.+)',
    '--replace-in-metadata', 'pre_process:meta_album_artist', '(?s).+', 'Charli xcx',
    '--parse-metadata', 'pre_process:%(id)s:(?P<meta_track>.+)',
    '--replace-in-metadata', 'pre_process:meta_track', '(?s).+', '4',
    '--parse-metadata', 'pre_process:%(artist,creator|)s:(?P<meta_artist>.*)',
    '--replace-in-metadata', 'pre_process:meta_artist', '^$', 'Charli xcx',
  ]);
});

test('albumTagArgs: a hostile album stays ONE literal argv element (template, replacement, option, WHEN prefix)', () => {
  const hostile = 'video:%(uploader)s \\g<0> --exec rm';
  const out = album.albumTagArgs({ album: hostile, albumArtist: 'X', track: null, cleanTitles: false });
  const i = out.indexOf('pre_process:meta_album');
  assert.strictEqual(out[i + 2], 'video:%(uploader)s \\\\g<0> --exec rm', 'only the backslash is doubled');
  assert.ok(!out.includes('--exec'), 'never a separate option element');
  assert.ok(!out.includes('pre_process:meta_track'), 'no track number, no track tag');
  // every FROM/WHEN element FileTube writes is fixed text, never the value
  out.filter((_, k) => out[k - 1] === '--parse-metadata').forEach((v) => assert.ok(v.startsWith('pre_process:'), v));
});

test('albumTagArgs: Clean up titles adds the title rules with the album artist regex-escaped', () => {
  const out = album.albumTagArgs({ album: 'A', albumArtist: 'AC/DC (Live)', track: 1, cleanTitles: true });
  const k = out.indexOf('pre_process:title:(?P<meta_title>.+)');
  assert.ok(k > 0);
  assert.deepStrictEqual(out.slice(k + 1), [
    '--replace-in-metadata', 'pre_process:meta_title', '(?i)^AC\\/DC\\ \\(Live\\)\\s*[-–—]\\s*', '',
    '--replace-in-metadata', 'pre_process:meta_title', album.TITLE_NOISE_PATTERN, '',
    '--replace-in-metadata', 'pre_process:meta_title', album.TITLE_NOISE_PATTERN, '',
    '--replace-in-metadata', 'pre_process:meta_title', '\\s{2,}', ' ',
    '--replace-in-metadata', 'pre_process:meta_title', '^\\s+|\\s+$', '',
  ]);
  assert.ok(!album.albumTagArgs({ album: 'A', albumArtist: 'B', track: 1, cleanTitles: false }).some((v) => /meta_title/.test(v)), 'off = no title rule');
});

test('albumTagArgs: nothing without both names (a bad value never half-tags)', () => {
  assert.deepStrictEqual(album.albumTagArgs(null), []);
  assert.deepStrictEqual(album.albumTagArgs({ album: '', albumArtist: 'B', track: 1 }), []);
  assert.deepStrictEqual(album.albumTagArgs({ album: 'A', albumArtist: '  ', track: 1 }), []);
  assert.deepStrictEqual(album.albumTagArgs({ album: 'A' + String.fromCharCode(0), albumArtist: 'B', track: 1 }), []);
});

// The title-noise rule run through JS's engine on the real titles (the pattern uses only syntax JS and Python share:
// the leading (?i) is stripped for JS and given as the flag).
test('TITLE_NOISE_PATTERN on real Kyle Gordon titles: noise goes, credits and meaningful tags stay', () => {
  const re = new RegExp(album.TITLE_NOISE_PATTERN.replace(/^\(\?i\)/, ''), 'gi');
  const clean = (t) => t.replace(re, '').replace(re, '').replace(/\s{2,}/g, ' ').trim(); // the rule runs twice, as in the argv
  assert.strictEqual(clean('Planet of the Bass (feat. DJ Crazy Times & Ms. Biljana Electronica) [Official Audio]'), 'Planet of the Bass (feat. DJ Crazy Times & Ms. Biljana Electronica)');
  assert.strictEqual(clean('Mr. Jambo (feat. Barry Bergen) [Official Music Video]'), 'Mr. Jambo (feat. Barry Bergen)');
  assert.strictEqual(clean('My Life (Is the Worst Life Ever) [feat. Our Wounded Courtship] [Official Music Video]'), 'My Life (Is the Worst Life Ever) [feat. Our Wounded Courtship]');
  assert.strictEqual(clean('Mr. Jambo  [Instrumental Version]'), 'Mr. Jambo [Instrumental Version]');
  assert.strictEqual(clean('Planet of the Bass (Original 1997 VHS Version)'), 'Planet of the Bass (Original 1997 VHS Version)');
  assert.strictEqual(clean('Song (Lyrics) (Visualizer) [HD]'), 'Song');
  // gate r1: a group with ANY real word stays (the first rule stripped these)
  assert.strictEqual(clean('Song (Live at Video Games Live)'), 'Song (Live at Video Games Live)');
  assert.strictEqual(clean('Song (Audio Commentary)'), 'Song (Audio Commentary)');
  assert.strictEqual(clean('Song (From the Video Game X)'), 'Song (From the Video Game X)');
  assert.strictEqual(clean('Song (Live at the Official Store)'), 'Song (Live at the Official Store)');
  assert.strictEqual(clean('Song (Official Video [HD])'), 'Song', 'nested noise: two passes, never a stray bracket');
  assert.strictEqual(clean('Song (Official Lyric Video)'), 'Song');
  const fx = require('../fixtures/ytdlp-playlist/example-list-PLUtyNbQXMTLg.json');
  assert.strictEqual(clean(fx.entries[14].title), 'Kyle Gordon - Mr. Jambo [Instrumental Version]', 'Dean\'s list: the meaningful tag stays');
});

// ---- args.js: only a YouTube AUDIO one-off carries the tags ----
const cfg = { downloadDir: path.join(os.tmpdir(), 'filetube-album-args') };
const sub = (format) => ({ name: 'Kyle Gordon', format, quality: 'best', filetype: 'default' });
const TAGS = { album: 'Brat', albumArtist: 'Charli xcx', track: 2, cleanTitles: true };

test('args: an audio one-off with albumTags carries the album argv before -o; without them it is byte-identical', () => {
  const plain = args.buildYtdlpDownloadArgs(sub('audio'), cfg, ['vid00000001'], { oneOff: true });
  const tagged = args.buildYtdlpDownloadArgs(sub('audio'), cfg, ['vid00000001'], { oneOff: true, albumTags: TAGS });
  const extra = album.albumTagArgs(TAGS);
  const o = plain.indexOf('-o');
  assert.deepStrictEqual(tagged, [...plain.slice(0, o), ...extra, ...plain.slice(o)]);
});

test('args: video, a subscription, and the universal lane never carry the album argv', () => {
  const has = (a) => a.includes('pre_process:meta_album');
  assert.strictEqual(has(args.buildYtdlpDownloadArgs(sub('video'), cfg, ['vid00000001'], { oneOff: true, albumTags: TAGS })), false, 'video');
  assert.strictEqual(has(args.buildYtdlpDownloadArgs(sub('audio'), cfg, ['vid00000001'], { albumTags: TAGS })), false, 'subscription (not a one-off)');
  assert.strictEqual(has(args.buildYtdlpDownloadArgs(sub('audio'), cfg, [], { oneOff: true, sourceUrl: 'https://vimeo.com/123456', albumTags: TAGS })), false, 'universal lane');
});

// ---- v1.372.0: the song names (plan docs/exec-plans/active/2026-10-07-v1372-song-names-feed.md) ----
test('v1.372.0 albumFrom: titles are kept per job id (trimmed, null-prototype); an empty or control-byte name is refused', () => {
  const r = album.albumFrom(good({ titles: { vid00000001: '  Planet of the Bass ', notInJob000: 'x' } }), IDS);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(Object.getPrototypeOf(r.album.titles), null);
  assert.deepStrictEqual({ ...r.album.titles }, { vid00000001: 'Planet of the Bass' });
  for (const bad of ['', '   ', 'A' + String.fromCharCode(0) + 'B', 'A​B', 'x'.repeat(201), 7]) {
    const b = album.albumFrom(good({ titles: { vid00000001: bad } }), IDS);
    assert.strictEqual(b.ok, false, JSON.stringify(bad));
    assert.ok(b.error.startsWith('Each song needs a name'), b.error);
  }
  assert.deepStrictEqual({ ...album.albumFrom(good(), IDS).album.titles }, {}, 'a v1.371.0 album (no titles) still parses');
});

test('v1.372.0 trackTagsFor + albumTagArgs: a named track writes its name LITERALLY and runs no cleanup rule', () => {
  const a = album.albumFrom(good({ cleanTitles: true, titles: { vid00000001: 'Song %(id)s \\g<0>' } }), IDS).album;
  const tags = album.trackTagsFor(a, 'vid00000001');
  assert.strictEqual(tags.title, 'Song %(id)s \\g<0>');
  const out = album.albumTagArgs(tags);
  const k = out.indexOf('pre_process:meta_title');
  assert.deepStrictEqual(out.slice(k - 3, k + 2), ['--parse-metadata', 'pre_process:%(id)s:(?P<meta_title>.+)', '--replace-in-metadata', 'pre_process:meta_title', '(?s).+']);
  const k2 = k + 2;
  assert.strictEqual(out[k2], 'Song %(id)s \\\\g<0>', 'the backslash doubled, the rest literal');
  assert.ok(!out.includes(album.TITLE_NOISE_PATTERN), 'no cleanup rule on a named track');
  assert.ok(!out.includes('pre_process:title:(?P<meta_title>.+)'));
  const other = album.albumTagArgs(album.trackTagsFor(a, 'vid00000003'));
  assert.ok(other.includes(album.TITLE_NOISE_PATTERN), 'a track without a name keeps the v1.371.0 cleanup (an old pending entry)');
});

test('v1.372.0 cleanTitleNoise: the noise groups off Dean\'s real titles, by the same pattern the yt-dlp path runs', () => {
  const fx = require('../fixtures/ytdlp-playlist/example-list-PLUtyNbQXMTLg.json');
  assert.strictEqual(album.cleanTitleNoise(fx.entries[0].title), 'Kyle Gordon - Introduction (feat. Daniel Radcliffe)');
  assert.strictEqual(album.cleanTitleNoise(fx.entries[14].title), 'Kyle Gordon - Mr. Jambo [Instrumental Version]');
  assert.strictEqual(album.cleanTitleNoise('Song (Official Video [HD])'), 'Song');
  assert.strictEqual(album.cleanTitleNoise(7), '');
});
