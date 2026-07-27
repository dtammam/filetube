'use strict';

// [UNIT] A6 (v1.24 UX Round, T16, Wave 5): lib/subtitles.js -- `srtToVtt`
// (pure) and `findSubtitleSidecar` (pure w.r.t. an injectable fs). Both are
// dependency-free by design (see the module's own header comment): yt-dlp
// DOWNLOADS already land subtitles as VTT directly, so no library/converter
// dependency was ever needed for THAT path -- this suite only exercises the
// LOCAL `.srt` sidecar case these two helpers cover.
const { test } = require('node:test');
const assert = require('node:assert');
const { srtToVtt, findSubtitleSidecar } = require('../../lib/subtitles');

// ---- srtToVtt --------------------------------------------------------------

test('srtToVtt: converts a real multi-cue .srt to valid WEBVTT with period timestamps and no cue-number lines', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:04,000',
    'Hello world',
    '',
    '2',
    '00:00:05,500 --> 00:00:07,250',
    'Second line',
    'with a wrapped second row',
    '',
  ].join('\n');

  const vtt = srtToVtt(srt);

  assert.match(vtt, /^WEBVTT\n/, 'must start with the literal WEBVTT signature');
  assert.match(vtt, /00:00:01\.000 --> 00:00:04\.000/, 'comma timestamps must become periods');
  assert.match(vtt, /00:00:05\.500 --> 00:00:07\.250/);
  assert.doesNotMatch(vtt, /^1$/m, 'the "1" cue-number line must be stripped');
  assert.doesNotMatch(vtt, /^2$/m, 'the "2" cue-number line must be stripped');
  assert.match(vtt, /Hello world/);
  assert.match(vtt, /Second line/);
  assert.match(vtt, /with a wrapped second row/);
});

test('srtToVtt: a numeric-only CAPTION line (not a cue counter) is preserved, not mistaken for a cue number', () => {
  // "42" here is the actual subtitle text, not a cue counter -- distinguished
  // by NOT being immediately followed by a timestamp line.
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:02,000',
    '42',
    '',
  ].join('\n');
  const vtt = srtToVtt(srt);
  assert.match(vtt, /\n42\n/, 'a genuine numeric caption line must survive conversion');
});

test('srtToVtt: empty input never throws and returns a bare, valid WEBVTT document', () => {
  assert.doesNotThrow(() => srtToVtt(''));
  assert.equal(srtToVtt(''), 'WEBVTT\n');
});

test('srtToVtt: garbage/non-SRT input never throws', () => {
  assert.doesNotThrow(() => srtToVtt('this is not a subtitle file at all\njust some random text'));
  assert.doesNotThrow(() => srtToVtt('\u0000\u0001binary-ish garbage�'));
});

test('srtToVtt: non-string input (null/undefined/number) never throws and degrades to a bare WEBVTT document', () => {
  assert.equal(srtToVtt(null), 'WEBVTT\n');
  assert.equal(srtToVtt(undefined), 'WEBVTT\n');
  assert.equal(srtToVtt(42), 'WEBVTT\n');
});

test('srtToVtt: strips a leading UTF-8 BOM and normalizes CRLF line endings', () => {
  const srtWithBomAndCrlf = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n';
  const vtt = srtToVtt(srtWithBomAndCrlf);
  assert.match(vtt, /^WEBVTT\n/);
  assert.match(vtt, /00:00:01\.000 --> 00:00:02\.000/);
  assert.doesNotMatch(vtt, /\uFEFF/);
});

// ---- findSubtitleSidecar ----------------------------------------------------

function fakeFs(files) {
  // `files` is a Map<dir, string[]> of directory -> entries actually present.
  return {
    readdirSync(dir) {
      if (!files.has(dir)) throw new Error(`ENOENT: ${dir}`);
      return files.get(dir);
    },
    existsSync(p) {
      const dir = require('path').dirname(p);
      const name = require('path').basename(p);
      return (files.get(dir) || []).includes(name);
    },
  };
}

// FIX-2 (two-reviewer gate, post-release): priority was REVERSED for
// determinism -- an exact bare `<base>.vtt`, when present, now wins over any
// lang-tagged sidecar (previously the opposite). In real-world yt-dlp
// downloads a bare `<base>.vtt` never coexists with a lang-tagged one (only
// the lang-tagged form is ever produced), so this only changes behavior for
// the rare case both exist -- exactly the ambiguous case this fix makes
// deterministic rather than dependent on `readdirSync` ordering.
test('findSubtitleSidecar: an exact bare <base>.vtt wins over a <base>.<lang>.vtt sidecar when both exist', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/My Video [abc123].mp4`;
  const impl = fakeFs(new Map([[dir, ['My Video [abc123].mp4', 'My Video [abc123].en.vtt', 'My Video [abc123].vtt', 'My Video [abc123].srt']]]));
  const result = findSubtitleSidecar(filePath, impl);
  assert.deepEqual(result, { path: `${dir}/My Video [abc123].vtt`, format: 'vtt' });
});

test('findSubtitleSidecar: uses the <base>.<lang>.vtt sidecar (the yt-dlp download shape) when no bare .vtt exists', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/My Video [abc123].mp4`;
  const impl = fakeFs(new Map([[dir, ['My Video [abc123].mp4', 'My Video [abc123].en.vtt', 'My Video [abc123].srt']]]));
  const result = findSubtitleSidecar(filePath, impl);
  assert.deepEqual(result, { path: `${dir}/My Video [abc123].en.vtt`, format: 'vtt' });
});

test('findSubtitleSidecar: falls back to a bare <base>.vtt when no lang-tagged vtt exists', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/clip.mp4`;
  const impl = fakeFs(new Map([[dir, ['clip.mp4', 'clip.vtt', 'clip.srt']]]));
  const result = findSubtitleSidecar(filePath, impl);
  assert.deepEqual(result, { path: `${dir}/clip.vtt`, format: 'vtt' });
});

test('findSubtitleSidecar: falls back to a bare <base>.srt when no .vtt of any kind exists', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/clip.mp4`;
  const impl = fakeFs(new Map([[dir, ['clip.mp4', 'clip.srt']]]));
  const result = findSubtitleSidecar(filePath, impl);
  assert.deepEqual(result, { path: `${dir}/clip.srt`, format: 'srt' });
});

test('findSubtitleSidecar: returns null when no sidecar exists', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/clip.mp4`;
  const impl = fakeFs(new Map([[dir, ['clip.mp4']]]));
  assert.equal(findSubtitleSidecar(filePath, impl), null);
});

test('findSubtitleSidecar: never matches an unrelated file that merely shares a prefix (e.g. "clip2.vtt" for "clip.mp4")', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/clip.mp4`;
  const impl = fakeFs(new Map([[dir, ['clip.mp4', 'clip2.vtt', 'clip2.srt']]]));
  assert.equal(findSubtitleSidecar(filePath, impl), null);
});

// FIX-2 (two-reviewer gate, post-release): the sibling-collision regression
// this fix closes. Pre-fix, `video.mp4`'s base ("video") would match
// "video.2.en.vtt" via a bare `startsWith('video.') && endsWith('.vtt')`
// check -- wrongly binding `video.2.mp4`'s OWN sidecar to `video.mp4`. The
// anchored lang-tag regex must reject this: the segment right after
// "video." in "video.2.en.vtt" is "2", not a language tag, so it can never
// match base "video" at all.
test('findSubtitleSidecar: does not bind a sibling\'s sidecar ("video.2.en.vtt") to a same-prefixed base ("video.mp4") that has no sidecar of its own', () => {
  const dir = '/media/lib';
  const entries = ['video.mp4', 'video.2.mp4', 'video.2.en.vtt'];
  const impl = fakeFs(new Map([[dir, entries]]));

  // video.mp4 has no sidecar of its own -- must resolve to null, NOT
  // video.2.mp4's sidecar.
  assert.equal(findSubtitleSidecar(`${dir}/video.mp4`, impl), null);

  // video.2.mp4 must still correctly resolve its OWN sidecar.
  const result = findSubtitleSidecar(`${dir}/video.2.mp4`, impl);
  assert.deepEqual(result, { path: `${dir}/video.2.en.vtt`, format: 'vtt' });
});

// FIX-2 follow-up (v1.24.7, re-confirm): a 3-letter ISO-639-2 local sidecar
// (`.eng`/`.spa`) must be picked up too -- the anchored lang class is
// `[A-Za-z]{2,3}` -- while the letters-only anchoring still rejects a
// numeric/multi-segment sibling (a `.2.eng.vtt` can never bind to base "video").
test('findSubtitleSidecar: matches a 3-letter ISO-639-2 lang sidecar (<base>.eng.vtt) yet still rejects a numeric sibling', () => {
  const dir = '/media/lib';
  const own = fakeFs(new Map([[dir, ['clip.mp4', 'clip.eng.vtt']]]));
  assert.deepEqual(findSubtitleSidecar(`${dir}/clip.mp4`, own), { path: `${dir}/clip.eng.vtt`, format: 'vtt' });

  const sibling = fakeFs(new Map([[dir, ['video.mp4', 'video.2.mp4', 'video.2.eng.vtt']]]));
  assert.equal(findSubtitleSidecar(`${dir}/video.mp4`, sibling), null);
});

// FIX-2: deterministic multi-lang preference -- an `en`-tagged sidecar wins
// over any other single lang-tagged match, regardless of the order
// `readdirSync` happens to return them in.
test('findSubtitleSidecar: prefers a <base>.en.vtt sidecar over other lang-tagged sidecars', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/clip.mp4`;
  const impl = fakeFs(new Map([[dir, ['clip.mp4', 'clip.fr.vtt', 'clip.en.vtt', 'clip.de.vtt']]]));
  const result = findSubtitleSidecar(filePath, impl);
  assert.deepEqual(result, { path: `${dir}/clip.en.vtt`, format: 'vtt' });
});

// FIX-2: with no `en` tag present, the winner must be STABLE (alphabetically
// sorted by filename) rather than dependent on directory-listing order --
// asserted against two directories holding the SAME files in reversed order.
test('findSubtitleSidecar: with no <base>.en.vtt, picks a stable (alphabetically-first) lang-tagged sidecar regardless of directory listing order', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/clip.mp4`;
  const forward = fakeFs(new Map([[dir, ['clip.mp4', 'clip.de.vtt', 'clip.fr.vtt']]]));
  const reversed = fakeFs(new Map([[dir, ['clip.mp4', 'clip.fr.vtt', 'clip.de.vtt']]]));
  assert.deepEqual(findSubtitleSidecar(filePath, forward), { path: `${dir}/clip.de.vtt`, format: 'vtt' });
  assert.deepEqual(findSubtitleSidecar(filePath, reversed), { path: `${dir}/clip.de.vtt`, format: 'vtt' });
});

test('findSubtitleSidecar: an unreadable/vanished directory fails closed (returns null, never throws)', () => {
  const impl = { readdirSync() { throw new Error('EACCES'); }, existsSync() { return false; } };
  assert.doesNotThrow(() => findSubtitleSidecar('/gone/clip.mp4', impl));
  assert.equal(findSubtitleSidecar('/gone/clip.mp4', impl), null);
});

test('findSubtitleSidecar: non-string/empty filePath returns null rather than throwing', () => {
  assert.equal(findSubtitleSidecar('', fakeFs(new Map())), null);
  assert.equal(findSubtitleSidecar(null, fakeFs(new Map())), null);
  assert.equal(findSubtitleSidecar(undefined, fakeFs(new Map())), null);
});

// ---- dirCache (v1.30, A1 / AC1.3) ------------------------------------------
//
// The per-scan directory-listing cache: an optional 3rd `dirCache` param
// (`Map<dir, string[]>`) that memoizes ONE `readdirSync` per directory across
// however many sibling files in it ask for their sidecar, killing the scan's
// O(N^2) `readdirSync`-per-file behavior at Dean's ~1300-item scale.

function countingFakeFs(files) {
  // Same shape as fakeFs, plus a `readdirCalls` counter so a test can assert
  // exactly how many times the underlying directory was actually listed.
  const base = fakeFs(files);
  let readdirCalls = 0;
  return {
    readdirCalls() { return readdirCalls; },
    readdirSync(dir) {
      readdirCalls++;
      return base.readdirSync(dir);
    },
    existsSync(p) { return base.existsSync(p); },
  };
}

test('findSubtitleSidecar: AC1.3 -- with a shared dirCache, N files in the SAME directory trigger exactly ONE readdirSync, not N', () => {
  const dir = '/media/lib';
  // 5 unrelated video files sharing one directory, none of which has its own
  // sidecar (so every call falls all the way through to the lang-tag scan,
  // the worst case for readdir pressure).
  const entries = ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.mp4'];
  const impl = countingFakeFs(new Map([[dir, entries]]));
  const dirCache = new Map();

  for (const name of entries) {
    findSubtitleSidecar(`${dir}/${name}`, impl, dirCache);
  }

  assert.equal(impl.readdirCalls(), 1, 'readdir count for the shared directory must be constant (1), not scale with the number of files (5)');
});

test('findSubtitleSidecar: AC1.3 -- a SECOND, different directory still costs its own readdir (cache is per-directory, not global)', () => {
  const dirA = '/media/lib/a';
  const dirB = '/media/lib/b';
  const impl = countingFakeFs(new Map([[dirA, ['1.mp4']], [dirB, ['2.mp4']]]));
  const dirCache = new Map();

  findSubtitleSidecar(`${dirA}/1.mp4`, impl, dirCache);
  findSubtitleSidecar(`${dirA}/1.mp4`, impl, dirCache);
  findSubtitleSidecar(`${dirB}/2.mp4`, impl, dirCache);
  findSubtitleSidecar(`${dirB}/2.mp4`, impl, dirCache);

  assert.equal(impl.readdirCalls(), 2, 'exactly one readdir per unique directory, regardless of how many times each is revisited');
});

test('findSubtitleSidecar: AC1.3 -- an unreadable directory is only readdir-attempted ONCE even when re-queried by later files (fails closed to null every time)', () => {
  const dir = '/gone';
  let readdirCalls = 0;
  const impl = {
    readdirSync() { readdirCalls++; throw new Error('EACCES'); },
    existsSync() { return false; },
  };
  const dirCache = new Map();

  assert.equal(findSubtitleSidecar(`${dir}/a.mp4`, impl, dirCache), null);
  assert.equal(findSubtitleSidecar(`${dir}/b.mp4`, impl, dirCache), null);
  assert.equal(readdirCalls, 1, 'the failed readdir result ([]) must itself be cached, not retried per file');
});

test('findSubtitleSidecar: with dirCache present, returns byte-identical results to the no-cache path for every priority case', () => {
  const dir = '/media/lib';
  const cases = [
    { filePath: `${dir}/My Video [abc123].mp4`, entries: ['My Video [abc123].mp4', 'My Video [abc123].en.vtt', 'My Video [abc123].vtt', 'My Video [abc123].srt'] }, // bare .vtt wins
    { filePath: `${dir}/My Video [abc123].mp4`, entries: ['My Video [abc123].mp4', 'My Video [abc123].en.vtt', 'My Video [abc123].srt'] }, // lang .vtt
    { filePath: `${dir}/clip.mp4`, entries: ['clip.mp4', 'clip.srt'] }, // bare .srt
    { filePath: `${dir}/clip.mp4`, entries: ['clip.mp4'] }, // none
    { filePath: `${dir}/video.mp4`, entries: ['video.mp4', 'video.2.mp4', 'video.2.en.vtt'] }, // FIX-2 anti-collision
  ];

  for (const { filePath, entries } of cases) {
    const noCacheResult = findSubtitleSidecar(filePath, fakeFs(new Map([[dir, entries]])));
    const cachedResult = findSubtitleSidecar(filePath, fakeFs(new Map([[dir, entries]])), new Map());
    assert.deepEqual(cachedResult, noCacheResult, `cached and no-cache results must match for entries=${JSON.stringify(entries)}`);
  }

  // Unreadable directory: both paths fail closed to null.
  const brokenImpl = { readdirSync() { throw new Error('EACCES'); }, existsSync() { return false; } };
  assert.equal(findSubtitleSidecar('/gone/clip.mp4', brokenImpl), null);
  assert.equal(findSubtitleSidecar('/gone/clip.mp4', brokenImpl, new Map()), null);
});

test('findSubtitleSidecar: with no dirCache argument, behavior is unchanged -- each call still performs its own fresh readdirSync (no accidental persistent memoization)', () => {
  const dir = '/media/lib';
  const impl = countingFakeFs(new Map([[dir, ['clip.mp4']]]));

  findSubtitleSidecar(`${dir}/clip.mp4`, impl);
  findSubtitleSidecar(`${dir}/clip.mp4`, impl);

  assert.equal(impl.readdirCalls(), 2, 'omitting dirCache must preserve the pre-v1.30 byte-identical, non-memoized behavior');
});

// ---- v1.47.4: yt-dlp's `-orig` marker must not beat a real language tag ----
//
// Found while investigating Dean's "unknown language" report. yt-dlp mints
// `<lang>-orig` (extractor/youtube/_video.py:4294) for YouTube's auto-caption
// in the video's ORIGINAL spoken language. A real download of an English video
// lands THREE English sidecars -- verified live against a real extraction:
//
//   ...en.vtt   ...en-US.vtt   ...en-orig.vtt
//
// `langVttRe` accepts `en-orig` as `<2-3 letters>-<subtag>`, and the tie-break
// was plain alphabetical by filename -- where "en-orig" sorts BEFORE "en-US".
// So with no bare `en` present we served YouTube's raw original-language
// variant over the human-authored regional track.

const { pickPreferredLangMatch, isOriginalLangMarker } = require('../../lib/subtitles');

const YTDLP_TRIPLE = ['My Video [abc123].mp4', 'My Video [abc123].en-orig.vtt', 'My Video [abc123].en-US.vtt'];

test('isOriginalLangMarker: recognizes the -orig suffix, case-insensitively, and nothing else', () => {
  for (const lang of ['en-orig', 'es-orig', 'EN-ORIG', 'pt-BR-orig']) {
    assert.equal(isOriginalLangMarker(lang), true, `${lang} is an -orig marker`);
  }
  // Real language tags must never be misread as markers -- especially not
  // anything merely CONTAINING "orig".
  for (const lang of ['en', 'en-US', 'orig', 'en-original', 'ori', undefined, null, 42]) {
    assert.equal(isOriginalLangMarker(lang), false, `${JSON.stringify(lang)} is not an -orig marker`);
  }
});

test('THE FIX: a real regional tag beats -orig even though "en-orig" sorts first alphabetically', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/My Video [abc123].mp4`;
  const impl = fakeFs(new Map([[dir, YTDLP_TRIPLE]]));
  assert.deepEqual(
    findSubtitleSidecar(filePath, impl),
    { path: `${dir}/My Video [abc123].en-US.vtt`, format: 'vtt' },
    'the human-authored en-US track must win over YouTube\'s raw original-language variant',
  );
});

test('an -orig sidecar is DEMOTED, not excluded -- it still wins when it is the only one', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/My Video [abc123].mp4`;
  const impl = fakeFs(new Map([[dir, ['My Video [abc123].mp4', 'My Video [abc123].en-orig.vtt']]]));
  // Serving a real caption file beats serving none; the fix is about
  // PREFERENCE, not about rejecting the track.
  assert.deepEqual(
    findSubtitleSidecar(filePath, impl),
    { path: `${dir}/My Video [abc123].en-orig.vtt`, format: 'vtt' },
  );
});

test('an exact bare `en` still outranks everything, including -orig (pre-existing rule unchanged)', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/My Video [abc123].mp4`;
  const impl = fakeFs(new Map([[dir, [...YTDLP_TRIPLE, 'My Video [abc123].en.vtt']]]));
  assert.deepEqual(
    findSubtitleSidecar(filePath, impl),
    { path: `${dir}/My Video [abc123].en.vtt`, format: 'vtt' },
  );
});

// THE DUPLICATION LOCK. This winner rule used to be copy-pasted into BOTH the
// cached (dirCache) and no-cache paths, so a fix applied to one silently left
// the other wrong -- this repo's recurring "the seat that forgot to CALL the
// shared helper" class (v1.41.4). Both paths must now agree on every input.
test('the cached (dirCache) and no-cache paths resolve the SAME winner', () => {
  const dir = '/media/lib';
  const filePath = `${dir}/My Video [abc123].mp4`;
  for (const entries of [
    YTDLP_TRIPLE,
    [...YTDLP_TRIPLE, 'My Video [abc123].en.vtt'],
    ['My Video [abc123].mp4', 'My Video [abc123].en-orig.vtt'],
    ['My Video [abc123].mp4', 'My Video [abc123].es.vtt', 'My Video [abc123].en-orig.vtt'],
  ]) {
    const noCache = findSubtitleSidecar(filePath, fakeFs(new Map([[dir, entries]])), undefined);
    const cached = findSubtitleSidecar(filePath, fakeFs(new Map([[dir, entries]])), new Map());
    assert.deepEqual(cached, noCache, `paths disagreed for ${JSON.stringify(entries)}`);
  }
});

test('pickPreferredLangMatch: stable alphabetical order is preserved among non-orig tags', () => {
  // The determinism guarantee the original rule existed for must survive: the
  // winner may never depend on readdirSync's unspecified ordering.
  const matches = [
    { name: 'v.fr.vtt', lang: 'fr' },
    { name: 'v.de.vtt', lang: 'de' },
    { name: 'v.es.vtt', lang: 'es' },
  ];
  assert.equal(pickPreferredLangMatch(matches).name, 'v.de.vtt');
  assert.equal(pickPreferredLangMatch(matches.slice().reverse()).name, 'v.de.vtt');
});
