'use strict';

// v1.48 item 4 (Dean): "I have some files that had some old commenters that are
// outdated I'd like all to show the proper modern ones".
// (The specific names he reported are deliberately NOT reproduced here -- see the
// STALE_AUTHORS note below.)
//
// The stale names are not in the source; they are frozen in localStorage under
// `comments_<mediaId>`, written on a video's first view before v1.44.3 and
// never re-read. `reconcileStoredComments` is the migration.
//
// THE CRITICAL PROPERTY, AND THE REASON THIS IS NOT A KEY RESET: Dean's own
// posted comments live in the SAME array (author 'You'). Losing them is data
// loss. Several tests below exist purely to pin that.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  reconcileStoredComments,
  isCurrentCommentAuthor,
  USER_COMMENT_AUTHOR,
  PERSONA_AUTHOR,
  MOCK_COMMENT_BANK,
} = require('../../public/js/watch.js');

const FRESH = [
  { author: MOCK_COMMENT_BANK[0].author, text: 'fresh one', timeStr: '1 day ago' },
  { author: MOCK_COMMENT_BANK[1].author, text: 'fresh two', timeStr: '2 days ago' },
];
const makeFresh = () => FRESH.map((c) => ({ ...c }));

// GATE FIX (adversarial WARNING W4) -- WITH A DELIBERATE DEVIATION FROM THE
// PRESCRIBED FIX, because that fix would have undone v1.44.3's whole point.
//
// The finding is correct and important: the original fixture hardcoded three
// names copied from Dean's bug report, when the retired set is actually NINE
// (v1.44.3 + v1.44.4 replaced his wife's, father's and daughter's names among
// others). So the fixture proved far less than it appeared to -- the
// fixture-from-a-report pattern this repo keeps getting bitten by.
//
// The prescription was "seed STALE_NAMES from the full v1.44.3/v1.44.4 set".
// Doing that would re-commit all nine real names into the repository, which is
// exactly what those two releases removed. It would also STILL be a hardcoded
// list, so it would still not prove the property that actually matters.
//
// What matters is that the migration is NAME-AGNOSTIC: it purges by "is this
// author absent from the current bank", never by matching known strings. That
// is a stronger claim than any name list, it is what makes all nine (and any
// name nobody remembers) get purged, and it is provable without naming anyone.
// So: synthetic authors of several shapes, plus a generated sweep below.
const STALE_AUTHORS = [
  'Firstname Lastname',      // the shape the retired names had: a real person's name
  'Another Person',
  'lowercase handle',
  'OldSchoolHandle99',       // a retired handle rather than a person
  'Ünïcödé Nâme',
  '',                        // degenerate but well-formed
];

// ---- author classification -------------------------------------------------

test('isCurrentCommentAuthor: every author in the current bank is current', () => {
  for (const c of MOCK_COMMENT_BANK) {
    assert.equal(isCurrentCommentAuthor(c.author), true, `bank author: ${c.author}`);
  }
});

test('isCurrentCommentAuthor: the persona author counts as current', () => {
  // It is generated rather than listed in the bank; omitting it would make every
  // persona comment look stale and force a regeneration on every single load.
  assert.equal(isCurrentCommentAuthor(PERSONA_AUTHOR), true);
});

test('isCurrentCommentAuthor: the retired real names are NOT current', () => {
  for (const name of STALE_AUTHORS) {
    assert.equal(isCurrentCommentAuthor(name), false, JSON.stringify(name));
  }
});

test('isCurrentCommentAuthor: non-strings are never current', () => {
  for (const bad of [null, undefined, 42, {}, [], true]) {
    assert.equal(isCurrentCommentAuthor(bad), false);
  }
});

// ---- the data-loss guards --------------------------------------------------

test("reconcileStoredComments: PRESERVES Dean's own comments when purging stale ones", () => {
  const stored = [
    { author: 'You', text: 'my genuine comment', timeStr: 'just now' },
    { author: 'Firstname Lastname', text: 'stale', timeStr: '2 days ago' },
    { author: 'You', text: 'a second real one', timeStr: '1 day ago' },
  ];
  const { comments, changed } = reconcileStoredComments(stored, makeFresh);
  assert.equal(changed, true);
  const mine = comments.filter((c) => c.author === USER_COMMENT_AUTHOR);
  assert.equal(mine.length, 2, 'BOTH user comments survive');
  assert.deepEqual(mine.map((c) => c.text), ['my genuine comment', 'a second real one'],
    'and in their original relative order');
});

test("reconcileStoredComments: Dean's comments stay at the FRONT, where the Comment button puts them", () => {
  const stored = [
    { author: 'You', text: 'mine', timeStr: 'just now' },
    { author: 'Another Person', text: 'stale', timeStr: '2 days ago' },
  ];
  const { comments } = reconcileStoredComments(stored, makeFresh);
  assert.equal(comments[0].author, USER_COMMENT_AUTHOR);
  assert.equal(comments[0].text, 'mine');
});

test('reconcileStoredComments: a user comment is never dropped even if its text looks like a stale name', () => {
  const stored = [
    { author: 'You', text: 'Firstname Lastname was here', timeStr: 'just now' },
    { author: 'Firstname Lastname', text: 'stale', timeStr: '1 day ago' },
  ];
  const { comments } = reconcileStoredComments(stored, makeFresh);
  assert.ok(comments.some((c) => c.author === 'You' && c.text === 'Firstname Lastname was here'));
  assert.ok(!comments.some((c) => c.author === 'Firstname Lastname'));
});

// DELTA GATE FIX (adversarial W-D3): the trimmed/case-insensitive user-author
// compare had NO test -- reverting it to a strict `===` left the suite green, so
// a tidy-up could silently re-narrow a data-PRESERVATION guard. The Comment
// button only ever writes the exact literal, so these variants are defensive;
// but this is a data-destroying path and the widening only ever keeps MORE.
test('reconcileStoredComments: preserves a user comment whose author varies in case or whitespace', () => {
  const stored = [
    { author: 'You', text: 'exact', timeStr: 'just now' },
    { author: 'you', text: 'lowercase', timeStr: 'just now' },
    { author: ' YOU ', text: 'padded upper', timeStr: 'just now' },
    { author: 'yOu', text: 'mixed', timeStr: 'just now' },
    { author: 'Firstname Lastname', text: 'stale', timeStr: '1 day ago' },
  ];
  const { comments, changed } = reconcileStoredComments(stored, makeFresh);
  assert.equal(changed, true, 'the stale entry still forces a rebuild');
  assert.deepEqual(
    comments.filter((c) => /^\s*you\s*$/i.test(String(c.author))).map((c) => c.text),
    ['exact', 'lowercase', 'padded upper', 'mixed'],
    'every case/whitespace variant of the user author is kept, in order'
  );
});

test('reconcileStoredComments: a homoglyph author is NOT treated as the user (correctly purged)', () => {
  // Cyrillic 'У' + "ou" -- never written by the Comment button, so it is not a
  // real user comment and must not be granted preservation.
  const stored = [{ author: 'Уou', text: 'homoglyph', timeStr: '1 day ago' }];
  const { comments } = reconcileStoredComments(stored, makeFresh);
  assert.ok(!comments.some((c) => c.text === 'homoglyph'), 'purged, not preserved');
});

// ---- the purge itself ------------------------------------------------------

test('reconcileStoredComments: removes every retired real name', () => {
  const stored = STALE_AUTHORS.map((author) => ({ author, text: 'x', timeStr: '1 day ago' }));
  const { comments, changed } = reconcileStoredComments(stored, makeFresh);
  assert.equal(changed, true);
  for (const name of STALE_AUTHORS) {
    assert.ok(!comments.some((c) => c.author === name), `${name} must be gone`);
  }
  assert.ok(comments.length > 0, 'and the video is not left with an empty comment section');
});

test('reconcileStoredComments: every surviving author is one the current bank can produce', () => {
  const stored = [
    { author: 'Firstname Lastname', text: 'stale', timeStr: '1 day ago' },
    { author: 'You', text: 'mine', timeStr: 'just now' },
  ];
  const { comments } = reconcileStoredComments(stored, makeFresh);
  for (const c of comments) {
    assert.ok(
      c.author === USER_COMMENT_AUTHOR || isCurrentCommentAuthor(c.author),
      `unexpected surviving author: ${c.author}`
    );
  }
});

// The claim that a name list cannot make: the purge is decided SOLELY by
// absence from the current bank, so it removes any retired author whether or not
// anyone remembers it. This is what actually guarantees all nine v1.44.3/v1.44.4
// names are gone from Dean's localStorage, and it would still hold if there had
// been ninety.
test('reconcileStoredComments: purges by ABSENCE FROM THE BANK, not by matching known names', () => {
  const generated = [];
  for (let i = 0; i < 200; i++) {
    // Deterministic, obviously-synthetic authors that cannot collide with the
    // bank (verified by the assertion below rather than assumed).
    generated.push(`zz-not-in-bank-${i}-${'x'.repeat(i % 7)}`);
  }
  for (const author of generated) {
    assert.equal(isCurrentCommentAuthor(author), false, `fixture must not collide with the bank: ${author}`);
  }

  const stored = [
    { author: 'You', text: 'mine', timeStr: 'just now' },
    ...generated.map((author) => ({ author, text: 'stale', timeStr: '1 day ago' })),
  ];
  const { comments, changed } = reconcileStoredComments(stored, makeFresh);
  assert.equal(changed, true);
  assert.equal(comments.filter((c) => generated.includes(c.author)).length, 0,
    'every author absent from the bank is purged, regardless of what it spelled');
  assert.equal(comments.filter((c) => c.author === USER_COMMENT_AUTHOR).length, 1,
    'and the real comment still survives the sweep');
});

// ---- the no-op path (churn avoidance) --------------------------------------

test('reconcileStoredComments: an already-current list is returned UNTOUCHED and unchanged', () => {
  const stored = [
    { author: MOCK_COMMENT_BANK[3].author, text: 'a', timeStr: '1 day ago' },
    { author: PERSONA_AUTHOR, text: 'b', timeStr: '2 days ago' },
    { author: 'You', text: 'c', timeStr: 'just now' },
  ];
  const { comments, changed } = reconcileStoredComments(stored, makeFresh);
  assert.equal(changed, false, 'no rewrite -> no localStorage write on every page load');
  assert.strictEqual(comments, stored, 'the very same array instance is handed back');
});

test('reconcileStoredComments: does not generate fresh comments when nothing is stale', () => {
  let generated = 0;
  const counting = () => { generated += 1; return makeFresh(); };
  const stored = [{ author: MOCK_COMMENT_BANK[0].author, text: 'a', timeStr: '1 day ago' }];
  reconcileStoredComments(stored, counting);
  assert.equal(generated, 0, 'the factory must stay unevaluated on the happy path');
});

// ---- malformed input -------------------------------------------------------

test('reconcileStoredComments: rebuilds from non-array storage rather than throwing', () => {
  for (const bad of [null, undefined, 'a string', 42, { a: 1 }]) {
    const { comments, changed } = reconcileStoredComments(bad, makeFresh);
    assert.equal(changed, true);
    assert.deepEqual(comments, FRESH, `bad input: ${JSON.stringify(bad)}`);
  }
});

test('reconcileStoredComments: drops malformed entries inside an otherwise valid array', () => {
  const stored = [
    { author: 'You', text: 'mine', timeStr: 'just now' },
    null,
    'not an object',
    { text: 'no author at all' },
  ];
  const { comments, changed } = reconcileStoredComments(stored, makeFresh);
  assert.equal(changed, true);
  assert.ok(comments.every((c) => c && typeof c === 'object' && typeof c.author === 'string'));
  assert.ok(comments.some((c) => c.author === 'You' && c.text === 'mine'), 'the real comment still survives');
});

test('reconcileStoredComments: an empty stored array is left alone (nothing stale in it)', () => {
  const { comments, changed } = reconcileStoredComments([], makeFresh);
  assert.equal(changed, false);
  assert.deepEqual(comments, []);
});

test('reconcileStoredComments: survives a factory that returns junk', () => {
  const { comments } = reconcileStoredComments(
    [{ author: 'Firstname Lastname', text: 'x', timeStr: '1 day ago' }],
    () => null
  );
  assert.deepEqual(comments, [], 'never propagates a non-array into the render path');
});

test('reconcileStoredComments: is idempotent -- a second pass changes nothing', () => {
  const stored = [
    { author: 'You', text: 'mine', timeStr: 'just now' },
    { author: 'Another Person', text: 'stale', timeStr: '1 day ago' },
  ];
  const first = reconcileStoredComments(stored, makeFresh);
  assert.equal(first.changed, true);
  const second = reconcileStoredComments(first.comments, makeFresh);
  assert.equal(second.changed, false, 'the migration must converge, not rewrite forever');
  assert.strictEqual(second.comments, first.comments);
});
