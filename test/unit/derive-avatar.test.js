'use strict';

// [UNIT] v1.24.0 "UX Round" F1 (avatar fallback), T3, `public/js/common.js`.
// GD-1 (v1.30.0 gate resolution): C3/T12 briefly changed the glyph to a
// hash-generated identicon letter, but both two-reviewer-gate reviewers
// independently recommended reverting to the name's own first letter (the
// recognizable mnemonic), keeping the hash-based deterministic COLOR from
// that same change -- see `deriveAvatar`'s own doc comment in common.js.
//
// `deriveAvatar(name)` -> deterministic `{glyph, color}` (same input -> same
// output, always; the glyph is `name`'s first letter uppercased, the color is
// hash-derived from `name` so distinct names are still visually
// distinguishable even when they share a first letter).
// `resolveAvatarSource(name, channelAvatarUrl)` is the precedence seam: a
// real captured `channelAvatarUrl` (C6) wins when present, else falls back to
// `deriveAvatar`. Both are pure/DOM-free.
const { test } = require('node:test');
const assert = require('node:assert');
const { deriveAvatar, resolveAvatarSource, AVATAR_PALETTE } = require('../../public/js/common.js');

// ---- deriveAvatar ------------------------------------------------------------

test('deriveAvatar: the SAME name always produces the SAME {glyph, color} (determinism)', () => {
  const a = deriveAvatar('My Favorite Channel');
  const b = deriveAvatar('My Favorite Channel');
  assert.deepStrictEqual(a, b);
  // Calling it a third time (a fresh, independent invocation) still matches --
  // no memoization/shared mutable state is doing the work.
  const c = deriveAvatar('My Favorite Channel');
  assert.deepStrictEqual(a, c);
});

test('deriveAvatar: the glyph is the uppercased first character of the name', () => {
  assert.strictEqual(deriveAvatar('alice').glyph, 'A');
  assert.strictEqual(deriveAvatar('Zebra Channel').glyph, 'Z');
  assert.strictEqual(deriveAvatar('123 Numbers').glyph, '1');
});

test('deriveAvatar: two different names independently derive their own glyph -- not forced to share a value just because they were computed back-to-back', () => {
  const names = ['Alpha Channel', 'Beta Creator', 'Gamma Studio', 'Delta Media', 'Epsilon TV'];
  const glyphs = names.map((n) => deriveAvatar(n).glyph);
  // Every result is independently the name's own first letter, uppercased --
  // not e.g. all collapsing to the same value from some shared counter/
  // mutable state.
  glyphs.forEach((g, i) => assert.strictEqual(g, names[i].charAt(0).toUpperCase()));
  // Re-deriving each name individually (out of the batch, in reverse order)
  // reproduces the exact same glyph -- proves there is no cross-call state
  // leaking between derivations.
  for (let i = names.length - 1; i >= 0; i--) {
    assert.strictEqual(deriveAvatar(names[i]).glyph, glyphs[i]);
  }
});

test('deriveAvatar: the color is always one of AVATAR_PALETTE\'s literal hex values', () => {
  for (const name of ['Alice', 'Bob', 'Some Channel', 'Another One', 'xyz']) {
    assert.ok(AVATAR_PALETTE.includes(deriveAvatar(name).color), `${name} -> unexpected color`);
  }
});

test('deriveAvatar: different names are DISTINGUISHABLE by color, not just by letter -- two names sharing a first letter get different colors when their hashes differ', () => {
  const a = deriveAvatar('Alpha Channel');
  const b = deriveAvatar('Another Creator');
  // Both start with 'A' -- a first-letter-only avatar would render these
  // identically. The generated avatar must differ on at least one of
  // glyph/color (here, both share glyph 'A', so the color MUST differ to be
  // a real improvement over "just the first letter").
  assert.strictEqual(a.glyph, 'A');
  assert.strictEqual(b.glyph, 'A');
  assert.notStrictEqual(a.color, b.color, 'two distinct channel names sharing a first letter must still be visually distinguishable by color');
});

test('deriveAvatar: a blank/missing name falls back to a literal deterministic "?" glyph, never throws/blank', () => {
  assert.strictEqual(deriveAvatar('').glyph, '?');
  assert.strictEqual(deriveAvatar('   ').glyph, '?');
  assert.strictEqual(deriveAvatar(undefined).glyph, '?');
  assert.strictEqual(deriveAvatar(null).glyph, '?');
  // Still deterministic for the fallback case itself.
  assert.deepStrictEqual(deriveAvatar(''), deriveAvatar(undefined));
});

test('deriveAvatar: trims surrounding whitespace before hashing/glyphing (same name, same avatar, regardless of incidental whitespace)', () => {
  assert.deepStrictEqual(deriveAvatar('  Padded Name  '), deriveAvatar('Padded Name'));
});

test('deriveAvatar: is case-sensitive on the seed (documented, not a bug) -- "Alice" and "alice" may differ', () => {
  // Not asserting a specific relationship, just that both calls are
  // themselves internally deterministic and produce valid palette colors.
  const upper = deriveAvatar('Alice');
  const lower = deriveAvatar('alice');
  assert.ok(AVATAR_PALETTE.includes(upper.color));
  assert.ok(AVATAR_PALETTE.includes(lower.color));
});

// ---- resolveAvatarSource (the channelAvatarUrl precedence seam) ------------

test('resolveAvatarSource: a present, non-blank channelAvatarUrl wins (type "url")', () => {
  const source = resolveAvatarSource('Some Channel', 'https://example.com/avatar.jpg');
  assert.deepStrictEqual(source, { type: 'url', url: 'https://example.com/avatar.jpg' });
});

test('resolveAvatarSource: trims a channelAvatarUrl with surrounding whitespace', () => {
  const source = resolveAvatarSource('Some Channel', '  https://example.com/avatar.jpg  ');
  assert.strictEqual(source.url, 'https://example.com/avatar.jpg');
});

test('resolveAvatarSource: an absent/null/blank/non-string channelAvatarUrl falls back to the generated deriveAvatar (type "generated")', () => {
  const expected = deriveAvatar('Some Channel');
  for (const badUrl of [undefined, null, '', '   ', 42, {}]) {
    const source = resolveAvatarSource('Some Channel', badUrl);
    assert.deepStrictEqual(source, { type: 'generated', glyph: expected.glyph, color: expected.color });
  }
});

test('resolveAvatarSource: matches the F1 acceptance criterion -- the SAME channel name always resolves to the SAME avatar everywhere (no channelAvatarUrl yet, W1)', () => {
  const sidebar = resolveAvatarSource('Real Creator', null);
  const watchPage = resolveAvatarSource('Real Creator', undefined);
  assert.deepStrictEqual(sidebar, watchPage);
});
