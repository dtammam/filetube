'use strict';

// ---- v1.77 (intake ruling 3): Liked gets its own glyph ---------------------
//
// Dean: "Out of all of the glyphs right now it looks like Liked is a full star
// and needs more in its set." Liked rendered `.icon-star`, a plain ::before ★
// that is deliberately absent from every icon-set block - so unlike the rest of
// the chrome it looked identical in all four sets. It now wears `.icon-liked`,
// which carries a full four-set treatment (locked by glyph-pool.test.js).
//
// `.icon-star` was NOT simply given variants, because it had a second user: the
// Stats sidebar link. Liked and Stats are different intents and should be able
// to diverge. This file binds BOTH halves of that split - the repoint AND the
// deliberate non-repoint - because a sweep that over-reaches into Stats is just
// as wrong as one that misses a Liked surface.
//
// (For the record: style.css claimed in THREE places that `.icon-star` was kept
// out of the icon-set blocks to protect "the gold rating". All three were
// false - rating stars are literal ★/☆ textContent in `.card-rating` and
// `#star-rating-control` and never used this class. All three were corrected in
// v1.77, the third only after the QA gate found that the wave had rewritten two
// of them while writing new prose asserting the job was finished.)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');

// Roster is DERIVED, never hand-listed: a new shell added later is covered the
// day it lands. Hand-enumerated guard lists rot (the v1.64 lesson).
const LIKED_SHELLS = fs.readdirSync(PUB)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => fs.readFileSync(path.join(PUB, f), 'utf8').includes('data-nav="liked"'));

test('roster sanity: the Liked bottom item exists in every app shell', () => {
  // Guards the assertions below against going vacuous if the attribute is
  // renamed and the filter silently matches nothing.
  assert.ok(LIKED_SHELLS.length >= 9,
    `expected >=9 shells carrying a Liked bottom item, found ${LIKED_SHELLS.length}: ${LIKED_SHELLS.join(', ')}`);
});

test('every static Liked nav item wears the inline "liked" chrome-icon (not the Stats star)', () => {
  // v1.87.1 (Dean): the bottom-nav glyphs are inline <svg> (chrome-icon) now,
  // not `.icon-*` masks (a mask decode-lags -> pop-in on a mobile cold start).
  // The invariant this test holds is unchanged: the Liked item wears the LIKED
  // glyph (star.svg via chromeIconMarkup('liked')), distinct from the Stats link
  // which still uses `.icon-star`. Now bound to the exact inline-svg markup.
  const common = require('../../public/js/common.js');
  const likedSvg = common.chromeIconMarkup('liked');
  const wrong = [];
  for (const f of LIKED_SHELLS) {
    const html = fs.readFileSync(path.join(PUB, f), 'utf8');
    // The glyph inside the Liked anchor specifically - not just "somewhere in
    // the file" (the Stats link's icon-star would otherwise satisfy it).
    const m = /data-nav="liked"[^>]*>\s*(<svg class="chrome-icon"[^>]*>.*?<\/svg>|<i class="[a-z-]+")/.exec(html);
    if (!m) { wrong.push(`${f}: no glyph found inside the Liked anchor`); continue; }
    if (m[1] !== likedSvg) wrong.push(`${f}: Liked glyph is not the inline "liked" chrome-icon`);
  }
  assert.deepEqual(wrong, [], `Liked nav glyph is wrong in:\n${wrong.join('\n')}`);
});

test('the RUNTIME-injected sidebar Liked entry wears .icon-liked too', () => {
  // The tenth site, and the only one not in static markup. A repoint that swept
  // the nine shells and missed this would leave every sidebar Liked entry on
  // the old glyph - and it only appears once you have liked something, so it
  // would very plausibly reach a device unnoticed.
  const src = fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8');
  const fn = src.slice(src.indexOf('function applyLikedSidebarEntry'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(body.includes("icon.className = 'icon-liked'"),
    'applyLikedSidebarEntry must build the entry with icon-liked');
  assert.ok(!body.includes("'icon-star'"),
    'no stale icon-star assignment may survive in applyLikedSidebarEntry');
});

test('the split is REAL: .icon-star survives for the Stats links only', () => {
  // The other half of the ruling. If a future sweep repoints these too, the
  // split has silently collapsed back into one glyph and Liked/Stats can no
  // longer diverge - so this asserts the non-repoint on purpose.
  const stats = [];
  for (const f of fs.readdirSync(PUB).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUB, f), 'utf8');
    for (const line of html.split('\n')) {
      if (line.includes('icon-star')) stats.push(`${f}: ${line.trim()}`);
    }
  }
  assert.equal(stats.length, 2, `expected exactly 2 surviving .icon-star sites (the Stats links), found:\n${stats.join('\n')}`);
  for (const s of stats) {
    assert.match(s, /Stats/, `a surviving .icon-star site is not the Stats link: ${s}`);
  }
});
