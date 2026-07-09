'use strict';

// [UNIT] v1.24.0 "UX Round" G1 (Zak Goldin mock commenter), T4,
// `public/js/watch.js`. The pool selection mechanism
// (getMockInitialComments()'s commentBank pick) was a flat, UNWEIGHTED
// deterministic `seed + i*7 % length` before this change -- G1 layers a NEW,
// separate, WEIGHTED (87% polite / 10% unhinged / 3% conspiracy-about-the-
// video) "Zak Goldin" persona comment on top of it, without disturbing the
// existing selection for the rest of commentBank. All helpers under test are
// pure/DOM-free, hoisted to module scope in watch.js specifically so they
// can be exercised here without a browser.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  MOCK_COMMENT_BANK,
  selectDeterministicComments,
  hashZakGoldinSeed,
  pickZakGoldinCategory,
  buildZakGoldinComment,
  buildMockComments,
} = require('../../public/js/watch.js');

// ---- selectDeterministicComments (regression lock for the PRE-EXISTING mechanism) ----

test('selectDeterministicComments: the SAME (mediaId, bank, count) always returns the SAME ordered list (determinism)', () => {
  const a = selectDeterministicComments('media-abc', MOCK_COMMENT_BANK, 8);
  const b = selectDeterministicComments('media-abc', MOCK_COMMENT_BANK, 8);
  assert.deepStrictEqual(a, b);
});

test('selectDeterministicComments: reproduces the EXACT pre-v1.24.0 seed + i*7 % length formula', () => {
  const bank = [
    { author: 'a', text: 'A', timeStr: '1d' },
    { author: 'b', text: 'B', timeStr: '2d' },
    { author: 'c', text: 'C', timeStr: '3d' },
    { author: 'd', text: 'D', timeStr: '4d' },
    { author: 'e', text: 'E', timeStr: '5d' },
  ];
  const mediaId = 'xyz789';
  const count = 3;

  // Hand-rolled reimplementation of the ORIGINAL (pre-hoist) algorithm.
  const seed = mediaId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const expected = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let idx = (seed + i * 7) % bank.length;
    while (used.has(idx)) idx = (idx + 1) % bank.length;
    used.add(idx);
    expected.push(bank[idx]);
  }

  assert.deepStrictEqual(selectDeterministicComments(mediaId, bank, count), expected);
});

test('selectDeterministicComments: never returns duplicate entries for a count within the bank size', () => {
  for (let i = 0; i < 50; i++) {
    const result = selectDeterministicComments('probe-' + i, MOCK_COMMENT_BANK, 14);
    const authorsAndTexts = result.map((c) => c.author + '::' + c.text);
    assert.strictEqual(new Set(authorsAndTexts).size, authorsAndTexts.length, `duplicate entry for probe-${i}`);
  }
});

test('selectDeterministicComments: clamps count to the bank length instead of throwing/looping forever', () => {
  const bank = [{ author: 'only', text: 'One', timeStr: 'now' }];
  const result = selectDeterministicComments('any-id', bank, 999);
  assert.strictEqual(result.length, 1);
});

test('selectDeterministicComments: an empty bank returns an empty list, never throws', () => {
  assert.deepStrictEqual(selectDeterministicComments('any-id', [], 10), []);
});

// ---- hashZakGoldinSeed (the local pure hash powering the weighted picker) ----

test('hashZakGoldinSeed: deterministic -- the same string always hashes to the same value', () => {
  assert.strictEqual(hashZakGoldinSeed('hello world'), hashZakGoldinSeed('hello world'));
});

test('hashZakGoldinSeed: always returns a non-negative integer', () => {
  for (const s of ['', 'a', 'a very long media id string with lots of characters', '🎬video🎬']) {
    const h = hashZakGoldinSeed(s);
    assert.ok(Number.isInteger(h) && h >= 0, `hash of "${s}" was ${h}`);
  }
});

// ---- pickZakGoldinCategory: the 87/10/3 weighted distribution ----

test('pickZakGoldinCategory: only ever returns one of the three defined categories', () => {
  for (let i = 0; i < 500; i++) {
    const cat = pickZakGoldinCategory('media-' + i);
    assert.ok(['polite', 'unhinged', 'conspiracy'].includes(cat), `unexpected category: ${cat}`);
  }
});

test('pickZakGoldinCategory: deterministic -- the same mediaId always lands in the same category', () => {
  assert.strictEqual(pickZakGoldinCategory('some-fixed-id'), pickZakGoldinCategory('some-fixed-id'));
});

test('pickZakGoldinCategory: hits the 87% polite / 10% unhinged / 3% conspiracy distribution over a large deterministic sample', () => {
  const N = 20000;
  const counts = { polite: 0, unhinged: 0, conspiracy: 0 };
  for (let i = 0; i < N; i++) {
    counts[pickZakGoldinCategory('media-id-' + i)]++;
  }
  const pct = {
    polite: (counts.polite / N) * 100,
    unhinged: (counts.unhinged / N) * 100,
    conspiracy: (counts.conspiracy / N) * 100,
  };
  // Generous-but-meaningful tolerance: the hash-mod-100 split isn't
  // perfectly uniform, but should land within a few points of the literal
  // 87/10/3 bucket boundaries over 20k distinct deterministic ids.
  assert.ok(Math.abs(pct.polite - 87) <= 3, `polite ${pct.polite}% not within 3pts of 87%`);
  assert.ok(Math.abs(pct.unhinged - 10) <= 3, `unhinged ${pct.unhinged}% not within 3pts of 10%`);
  assert.ok(Math.abs(pct.conspiracy - 3) <= 2, `conspiracy ${pct.conspiracy}% not within 2pts of 3%`);
});

// ---- buildZakGoldinComment ----

test('buildZakGoldinComment: always authored by "Zak Goldin"', () => {
  for (let i = 0; i < 20; i++) {
    assert.strictEqual(buildZakGoldinComment('vid-' + i, 'Some Title').author, 'Zak Goldin');
  }
});

test('buildZakGoldinComment: deterministic -- the same (mediaId, videoTitle) always returns the same comment', () => {
  const a = buildZakGoldinComment('media-42', 'Retro Gaming Highlights');
  const b = buildZakGoldinComment('media-42', 'Retro Gaming Highlights');
  assert.deepStrictEqual(a, b);
});

test('buildZakGoldinComment: a conspiracy-category comment substitutes the actual video title', () => {
  // Find a mediaId that deterministically lands in the conspiracy bucket.
  let conspiracyId = null;
  for (let i = 0; i < 2000 && !conspiracyId; i++) {
    if (pickZakGoldinCategory('search-' + i) === 'conspiracy') conspiracyId = 'search-' + i;
  }
  assert.ok(conspiracyId, 'expected to find at least one conspiracy-bucket id within 2000 tries');
  const comment = buildZakGoldinComment(conspiracyId, 'Definitely Real Documentary');
  assert.ok(comment.text.includes('Definitely Real Documentary'), `expected title in conspiracy text: ${comment.text}`);
  assert.ok(!comment.text.includes('{title}'), 'the {title} placeholder must never leak into rendered text');
});

test('buildZakGoldinComment: a blank/missing video title falls back to "this video", never renders "undefined"', () => {
  let conspiracyId = null;
  for (let i = 0; i < 2000 && !conspiracyId; i++) {
    if (pickZakGoldinCategory('blank-title-' + i) === 'conspiracy') conspiracyId = 'blank-title-' + i;
  }
  assert.ok(conspiracyId, 'expected to find at least one conspiracy-bucket id within 2000 tries');
  for (const badTitle of [undefined, null, '', '   ']) {
    const comment = buildZakGoldinComment(conspiracyId, badTitle);
    assert.ok(comment.text.includes('this video'), `expected fallback phrase, got: ${comment.text}`);
    assert.ok(!/undefined/.test(comment.text));
  }
});

test('buildZakGoldinComment: text is never empty and never contains real profanity/targeting (tasteful-tone smoke check)', () => {
  const bannedSubstrings = ['fuck', 'shit', 'bitch', 'idiot', 'stupid', 'kill yourself'];
  for (let i = 0; i < 300; i++) {
    const { text } = buildZakGoldinComment('tone-check-' + i, 'A Video Title');
    assert.ok(text && text.trim().length > 0, `empty comment text for tone-check-${i}`);
    const lower = text.toLowerCase();
    for (const bad of bannedSubstrings) {
      assert.ok(!lower.includes(bad), `comment for tone-check-${i} contains "${bad}": ${text}`);
    }
  }
});

// ---- buildMockComments: the full G1 layering ----

test('buildMockComments: inserts exactly one Zak Goldin comment among the base selection', () => {
  const result = buildMockComments('media-99', MOCK_COMMENT_BANK, 8, 'A Great Video');
  const zakEntries = result.filter((c) => c.author === 'Zak Goldin');
  assert.strictEqual(zakEntries.length, 1);
  assert.strictEqual(result.length, 9); // 8 base + 1 Zak Goldin
});

test('buildMockComments: preserves the REST of commentBank\'s selection exactly as selectDeterministicComments would produce it (determinism guarantee, exec-plan G1 AC)', () => {
  for (let i = 0; i < 25; i++) {
    const mediaId = 'preserve-check-' + i;
    const bank = MOCK_COMMENT_BANK;
    const count = 6;
    const base = selectDeterministicComments(mediaId, bank, count);
    const withZak = buildMockComments(mediaId, bank, count, 'Some Title');
    const nonZak = withZak.filter((c) => c.author !== 'Zak Goldin');
    assert.deepStrictEqual(nonZak, base, `non-Zak entries diverged from selectDeterministicComments for ${mediaId}`);
  }
});

test('buildMockComments: deterministic -- the same inputs always produce the same full list, including Zak Goldin\'s position', () => {
  const a = buildMockComments('media-77', MOCK_COMMENT_BANK, 10, 'Title Here');
  const b = buildMockComments('media-77', MOCK_COMMENT_BANK, 10, 'Title Here');
  assert.deepStrictEqual(a, b);
});

test('buildMockComments: still works when the base selection is empty (count 0) -- Zak Goldin is inserted at index 0', () => {
  const result = buildMockComments('media-empty-base', MOCK_COMMENT_BANK, 0, 'Title');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].author, 'Zak Goldin');
});

// ---- MOCK_COMMENT_BANK: sanity check on the hoisted pool itself ----

test('MOCK_COMMENT_BANK: every entry has a non-empty author, text, and timeStr', () => {
  for (const c of MOCK_COMMENT_BANK) {
    assert.ok(typeof c.author === 'string' && c.author.length > 0);
    assert.ok(typeof c.text === 'string' && c.text.length > 0);
    assert.ok(typeof c.timeStr === 'string' && c.timeStr.length > 0);
  }
});

test('MOCK_COMMENT_BANK: contains no entry authored "Zak Goldin" (Zak Goldin is a distinct persona layered on top, not a flat pool entry)', () => {
  assert.ok(!MOCK_COMMENT_BANK.some((c) => c.author === 'Zak Goldin'));
});
