'use strict';

// v1.339 S1 (T-S1, Dean's D1 "Keep mine"): the pure halves of the keep-mine
// one-off. The behavioural proof through the real spawn boundary (a fake
// yt-dlp on PATH) lives in test/integration/ytdlp-oneshot-keep-mine.test.js;
// this file binds the pieces that proof composes:
//   - run.parseRealDownloadLine: the ONLY reachable "already in your library"
//     signal (`--print` implies `--quiet`, so yt-dlp's own
//     `[download] <file> has already been downloaded` screen line never
//     reaches FileTube in production -- measured against yt-dlp 2026.08.19);
//   - index.oneShotTargetKey: the single-flight key (what counts as "the same
//     target");
//   - both status renderers (the one-off modal/chip's formatOneOffStatusText
//     and the Subscriptions page's formatLiveStatusText) say "Already in your
//     library" for a done entry carrying `alreadyInLibrary: true`, and only
//     then.

const { test } = require('node:test');
const assert = require('node:assert');

const run = require('../../lib/ytdlp/run');
const ytdlp = require('../../lib/ytdlp');
const { formatOneOffStatusText, resolveAvatarSource } = require('../../public/js/common.js');
// subscriptions.js consumes resolveAvatarSource as a bare global (browser
// script order) -- same install as ytdlp-subscriptions-client.test.js.
global.resolveAvatarSource = resolveAvatarSource;
const { formatLiveStatusText } = require('../../lib/ytdlp/client/subscriptions.js');

// ---- parseRealDownloadLine -------------------------------------------------

test('parseRealDownloadLine: the two verbatim lines yt-dlp prints for the one-off FTCHREAL template', () => {
  // Verbatim from a real yt-dlp 2026.08.19 run of the one-off print template
  // (fresh download, then the same target again without --force-overwrites).
  assert.strictEqual(run.parseRealDownloadLine('FTCHREAL true'), true);
  assert.strictEqual(run.parseRealDownloadLine('FTCHREAL false'), false);
  assert.strictEqual(run.parseRealDownloadLine('FTCHREAL false\r'), false, 'a CRLF line ending is tolerated');
});

test('parseRealDownloadLine: anything else is null (never read as "already present") -- NA, junk, a near-miss sentinel, the screen line', () => {
  for (const line of [
    'FTCHREAL NA', // a yt-dlp without the private __real_download field
    'FTCHREAL',
    'FTCHREAL  false',
    'FTCHREAL false trailing',
    'FTCHREALX false',
    'ftchreal false',
    ' FTCHREAL false',
    'FTCHMETA {"id":"x"}',
    '[download] /lib/Some Video [dQw4w9WgXcQ].mp4 has already been downloaded',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.strictEqual(run.parseRealDownloadLine(line), null, `must be null: ${JSON.stringify(line)}`);
  }
});

// ---- oneShotTargetKey ------------------------------------------------------

test('oneShotTargetKey: the same YouTube id (or the same universal URL) with the same format/filetype/folder is ONE target', () => {
  const a = ytdlp.oneShotTargetKey({ videoId: 'dQw4w9WgXcQ', format: 'video', filetype: 'mp4', explicitFolder: null });
  const b = ytdlp.oneShotTargetKey({ videoId: 'dQw4w9WgXcQ', format: 'video', filetype: 'mp4', explicitFolder: null });
  assert.strictEqual(typeof a, 'string');
  assert.strictEqual(a, b);
  const u1 = ytdlp.oneShotTargetKey({ sourceUrl: 'https://vimeo.com/1', format: 'video', filetype: null });
  const u2 = ytdlp.oneShotTargetKey({ sourceUrl: 'https://vimeo.com/1', format: 'video', filetype: null });
  assert.strictEqual(u1, u2);
});

test('oneShotTargetKey: a different id, URL, format, filetype or explicit folder is a DIFFERENT target (a different output file is never joined)', () => {
  const base = { videoId: 'dQw4w9WgXcQ', format: 'video', filetype: 'mp4', explicitFolder: null };
  const k = ytdlp.oneShotTargetKey(base);
  const variants = [
    { ...base, videoId: 'aaaaaaaaaaa' },
    { ...base, format: 'audio' },
    { ...base, filetype: 'mkv' },
    { ...base, explicitFolder: 'Elsewhere' },
    { sourceUrl: 'https://vimeo.com/dQw4w9WgXcQ', format: 'video', filetype: 'mp4' },
  ];
  const keys = variants.map((v) => ytdlp.oneShotTargetKey(v));
  for (const key of keys) assert.notStrictEqual(key, k);
  assert.strictEqual(new Set(keys).size, keys.length, 'every variant is its own target');
  assert.notStrictEqual(
    ytdlp.oneShotTargetKey({ sourceUrl: 'https://vimeo.com/1', format: 'video' }),
    ytdlp.oneShotTargetKey({ sourceUrl: 'https://vimeo.com/2', format: 'video' }),
  );
});

test('oneShotTargetKey: no identity -> null (never joins anything)', () => {
  assert.strictEqual(ytdlp.oneShotTargetKey({ videoId: null, sourceUrl: undefined, format: 'video' }), null);
  assert.strictEqual(ytdlp.oneShotTargetKey({ videoId: '', sourceUrl: '', format: 'video' }), null);
});

// ---- the two status renderers ----------------------------------------------

const RENDERERS = [
  ['formatOneOffStatusText (one-off modal + download chip)', formatOneOffStatusText],
  ['formatLiveStatusText (Subscriptions page one-off rows)', formatLiveStatusText],
];

for (const [name, render] of RENDERERS) {
  test(`${name}: a done entry with alreadyInLibrary reads "Already in your library"; a plain done entry still reads "Done"`, () => {
    assert.strictEqual(render({ state: 'done', percent: 100, alreadyInLibrary: true }), 'Already in your library');
    assert.strictEqual(render({ state: 'done', percent: 100 }), 'Done');
    assert.strictEqual(render({ state: 'done', percent: 100, alreadyInLibrary: 'yes' }), 'Done', 'strict true only');
  });

  test(`${name}: alreadyInLibrary is state-gated -- never paints over a live, failed or cancelled entry`, () => {
    // A stale flag left by activity.js's shallow merge must never leak.
    assert.notStrictEqual(render({ state: 'queued', alreadyInLibrary: true }), 'Already in your library');
    assert.notStrictEqual(render({ state: 'downloading', percent: 40, alreadyInLibrary: true }), 'Already in your library');
    assert.strictEqual(render({ state: 'error', error: 'HTTP Error 403', alreadyInLibrary: true }), 'HTTP Error 403');
  });
}
