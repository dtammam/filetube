'use strict';

// [UNIT] v1.45.0 T1 -- the home filter/action bar (sort + All/Videos/Audio +
// Shuffle + Rescan) is pinned on scroll so Dean can re-shuffle mid-scroll
// without scrolling back to the top. Visual/iOS-sticky correctness is Dean's
// on-device call (no browser harness -- see CONTRIBUTING.md); this is the
// mechanical guard that the sticky rule exists, is home-scoped, has the solid
// background + z-index that keep grid rows from showing through / overlapping,
// and clears the taller mobile header.
const { test } = require('node:test');

// Tier 2 (DELIBERATE lock updates): spacing literals became --space-* tokens;
// these locks pin VALUES, so extracted rule text is resolved back to px
// before asserting. The token VALUES themselves are pinned byte-exactly by
// test/unit/token-scale-lock.test.js (the single value authority).
const SPACE_TOKENS = { '--space-1': '2px', '--space-2': '4px', '--space-3': '6px', '--space-4': '8px', '--space-5': '10px', '--space-6': '12px', '--space-8': '16px', '--space-10': '20px', '--space-12': '24px', '--space-16': '32px' };
const rs = (s) => String(s).replace(/var\((--space-\d+)\)/g, (_, n) => SPACE_TOKENS[n] || _);
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

// ---- v1.45.2 (#3/#4): filter-bar cleanup -----------------------------------

test('#4: name + count are grouped in .section-heading so the count sits beside the name, not centred', () => {
  // The heading span must be wrapped so `.section-title`'s space-between has TWO
  // flex items (heading-group + actions), not three (which centred the count).
  assert.match(html, /<span class="section-heading"><span id="videos-section-header">/,
    'the folder-name header is wrapped in .section-heading');
  assert.match(css, /\.section-heading\s*\{[^}]*display:\s*inline-flex/, '.section-heading groups name + count on one flex item');
});

test('#4: the item count is parenthesized in CSS (data string stays "N items")', () => {
  assert.match(css, /\.library-item-count::before\s*\{\s*content:\s*"\("/, 'open paren');
  assert.match(css, /\.library-item-count::after\s*\{\s*content:\s*"\)"/, 'close paren');
});

test('#3: on mobile the action row keeps its one-glyph-line contract; wrap exists ONLY for the watch group\'s own second row', () => {
  // v1.45.2 made .section-actions nowrap (one clean line, icon-only). v1.50
  // relaxed nowrap -> wrap SOLELY so the watched-state group can take a
  // full-width second row -- the original line's members are unchanged and
  // the watch group is forced off it (order + width:100%), so the v1.45
  // width budget still holds. These declarations exist only in the mobile
  // block (desktop .section-actions has no flex-wrap and never hides
  // labels), so a bare match is unambiguous.
  assert.match(css, /\.section-actions\s*\{[^}]*flex-wrap:\s*wrap/, '.section-actions wraps on mobile (v1.50: watch-group second row)');
  assert.match(css, /\.section-actions \.watch-toggle\s*\{[^}]*order:\s*10/, 'the watch group is forced OFF the one-glyph line');
  assert.match(css, /\.section-actions \.watch-toggle\s*\{[^}]*flex:\s*1 1 70%/, 'v1.50.4: grows to fill row 2 alone, leaves room for Re-pull beside it');
  assert.match(css, /\.section-actions #sub-repull-channel-btn\s*\{[^}]*order:\s*11/, 'v1.50.4: Re-pull joins row 2, never orphans a middle row');
  assert.match(css, /\.section-actions \.btn \.btn-label\s*\{\s*display:\s*none/, 'Shuffle/Rescan labels are hidden on mobile');
});

// The base (desktop) sticky rule.
function ruleBody(selectorLiteral) {
  const idx = css.indexOf(selectorLiteral + ' {');
  assert.notStrictEqual(idx, -1, 'expected a `' + selectorLiteral + '` rule in style.css');
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

test('the home filter bar is sticky and HOME-SCOPED (not the bare .section-title, so other views are untouched)', () => {
  const body = ruleBody('#library-content .section-title');
  assert.match(body, /position:\s*sticky/, 'must be position: sticky');
  assert.match(body, /top:\s*var\(--sticky-bar-top\)/, 'pins at the --sticky-bar-top offset (the fixed header height)');
  // Solid background so grid rows scroll UNDER it rather than showing through.
  assert.match(body, /background-color:\s*var\(--bg-color\)/, 'needs a solid background');
  // Above grid cards (z-index 2), below the sort-menu (30) and dock/modals.
  assert.match(body, /z-index:\s*20/, 'z-index 20: above cards, below the sort-menu/dock');
});

test('the bar pins FLUSH with zero pre-stick jump: pull-up == give-back == the desktop content padding (v1.45.1)', () => {
  // The margin-top pull-up and the padding-top give-back must be equal and equal
  // to `.main-content`'s desktop top padding (24px), or the bar pins off-position.
  const body = ruleBody('#library-content .section-title');
  assert.match(body, /margin-top:\s*-24px/, 'pull the box up by the 24px desktop content padding');
  assert.match(rs(body), /padding-top:\s*24px/, 'give it back as inner padding so the heading stays put');
  // Sanity-tie to the actual .main-content desktop padding so this stays honest
  // if that padding ever changes.
  const mc = ruleBody('.main-content');
  assert.match(rs(mc), /padding:\s*24px/, '.main-content desktop padding is the 24px this pull-up cancels');
});

test('the mobile flush-pin pull-up matches the 16px mobile content padding (not the desktop 24px)', () => {
  // A separate #library-content .section-title rule inside the mobile block must
  // override margin-top/padding-top to 16px (mobile .main-content padding), else
  // the bar pins 8px off on phones.
  const re = /#library-content \.section-title\s*\{[^}]*margin-top:\s*-16px;[^}]*padding-top:\s*16px/;
  assert.match(rs(css), re, 'mobile pull-up/give-back is 16px');
  // Sanity-tie to the actual mobile `.main-content` padding (16px), matching the
  // desktop half's rigor — if that ever changes, the mobile pull-up must too or
  // the bar pins off. The mobile `.main-content` rule (inside the 768px block)
  // sets `padding: 16px`; the desktop one is `padding: 24px` (won't match here).
  assert.match(rs(css), /\.main-content\s*\{[^}]*padding:\s*16px/, 'mobile .main-content padding is the 16px this pull-up cancels');
});

test('--sticky-bar-top is the desktop header height and is overridden to the taller mobile header', () => {
  // Base :root default = the desktop header height + the top safe-area (v1.106:
  // env is 0 on desktop, non-zero on an iPad PWA after the status bar overlays on
  // fullscreen exit). Still DERIVES var(--header-h) (token-scale-lock is the
  // byte-exact authority that --header-h == 56px), so the sticky offset can never
  // silently diverge from the real header height.
  assert.match(css, /--sticky-bar-top:\s*calc\(var\(--header-h\) \+ env\(safe-area-inset-top\)\)/, 'base derives the desktop header height token + the top safe-area');
  // The mobile :root (inside the max-width:768px block, alongside --mobile-header-h)
  // re-points it at the taller mobile header.
  assert.match(css, /--sticky-bar-top:\s*var\(--mobile-header-h\)/, 'mobile override clears the taller header');
});

test('NEITHER the desktop NOR the mobile bare .section-title rule is made sticky (would leak the pin onto any future reuse)', () => {
  // Only the #library-content-scoped rule may pin. Check EVERY bare
  // `.section-title {` block (desktop base AND the mobile flex-wrap block), not
  // just the first — a regression that stuck the mobile bare rule would leak
  // stickiness onto any future .section-title reuse on phones specifically.
  let from = 0;
  let checked = 0;
  for (;;) {
    const idx = css.indexOf('.section-title {', from);
    if (idx === -1) break;
    // Skip the scoped rule (its match is `#library-content .section-title {`,
    // whose `.section-title {` substring starts mid-selector — detect by the
    // char just before the dot being a space preceded by 'content').
    const open = css.indexOf('{', idx);
    const close = css.indexOf('}', open);
    const preceding = css.slice(Math.max(0, idx - 20), idx);
    if (!/#library-content\s$/.test(preceding)) {
      assert.doesNotMatch(css.slice(open + 1, close), /position:\s*sticky/,
        'a bare .section-title rule near index ' + idx + ' must not be sticky');
      checked += 1;
    }
    from = close + 1;
  }
  assert.ok(checked >= 2, 'expected to check both the desktop and mobile bare .section-title rules (found ' + checked + ')');
});

// ---- v1.50.1 (Dean, first v1.50 on-device probe hit) -----------------------
// A phone held horizontally is wider than 768px -> DESKTOP layout, and with
// the v1.50 watch group the flex-shrink:0 actions row overflowed onto a
// folder-view heading ("yt-dlp" hidden behind the All button). The sticky
// bar now wraps: wide desktop stays one line (wrap engages only when the
// members genuinely cannot share it); squeezed widths drop the actions to
// their own line.

test('v1.50.1: the home sticky bar wraps so the actions row can never overlap the heading in the 769-1100px squeeze zone', () => {
  const body = ruleBody('#library-content .section-title');
  assert.match(body, /flex-wrap:\s*wrap/, 'the home sticky bar must be allowed to wrap');
});
