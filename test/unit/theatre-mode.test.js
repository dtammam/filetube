'use strict';

// [UNIT] The pure helpers behind the watch-page theatre-mode toggle
// (public/js/watch.js, FR-9, T8, v1.21.0): `nextTheaterState` (the toggle's
// reducer) and the `isTheaterModeActive`/`theaterModeStorageValue`
// persisted-preference read/write pair (AC63, `localStorage['ft-theater']`).
// The DOM-mutating half (creating/appending the button, flipping the
// `.theater-mode` class, the actual widened/desktop-only layout feel) is
// intentionally NOT covered here (no jsdom/browser harness in this codebase
// -- see CONTRIBUTING.md); Dean's on-device pass is the documented arbiter
// for that feel, per the exec plan's LIGHT-gate note for this FR.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  nextTheaterState,
  isTheaterModeActive,
  theaterModeStorageValue,
} = require('../../public/js/watch.js');

const STYLE_CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

// ---- nextTheaterState ---------------------------------------------------------

test('nextTheaterState: flips off to on', () => {
  assert.strictEqual(nextTheaterState(false), true);
});

test('nextTheaterState: flips on to off', () => {
  assert.strictEqual(nextTheaterState(true), false);
});

// ---- isTheaterModeActive -------------------------------------------------------

test('isTheaterModeActive: the persisted "on" sentinel reads as active', () => {
  assert.strictEqual(isTheaterModeActive('1'), true);
});

test('isTheaterModeActive: an unset/never-persisted preference (localStorage returns null) reads as inactive', () => {
  assert.strictEqual(isTheaterModeActive(null), false);
});

test('isTheaterModeActive: the persisted "off" sentinel reads as inactive', () => {
  assert.strictEqual(isTheaterModeActive('0'), false);
});

test('isTheaterModeActive: fails safe on garbage/foreign stored values -- never active by accident', () => {
  assert.strictEqual(isTheaterModeActive('true'), false);
  assert.strictEqual(isTheaterModeActive('yes'), false);
  assert.strictEqual(isTheaterModeActive(''), false);
  assert.strictEqual(isTheaterModeActive(undefined), false);
  assert.strictEqual(isTheaterModeActive('[object Object]'), false);
});

// ---- theaterModeStorageValue ---------------------------------------------------

test('theaterModeStorageValue: serializes active/inactive to the exact sentinel isTheaterModeActive expects back', () => {
  assert.strictEqual(theaterModeStorageValue(true), '1');
  assert.strictEqual(theaterModeStorageValue(false), '0');
  // Round-trips through the parser above.
  assert.strictEqual(isTheaterModeActive(theaterModeStorageValue(true)), true);
  assert.strictEqual(isTheaterModeActive(theaterModeStorageValue(false)), false);
});

// ---- v1.190 (Dean): theatre must not clip the page bottom (the FEEL is Dean's
// device arbiter; this source-locks the height-cap mechanism) -----------------

test('v1.190 theatre caps the player HEIGHT to the viewport (width bound by 16:9 of the available height), centred, excluding fullscreen/audio-expanded', () => {
  const rule = /\.watch-container\.theater-mode #player-slot #player-wrapper:not\(\.audio-expanded\):not\(\.css-fullscreen\):not\(:fullscreen\) \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(rule, 'the theatre height-cap rule exists, scoped away from the two fullscreen paths + audio-expanded');
  const body = rule[1];
  // Width is bounded by the height the viewport can show, so 16:9 height never
  // exceeds it -> no bottom clip. `min(100%, ...)` keeps normal cases full-width.
  assert.match(body, /width:\s*min\(100%,\s*calc\(\(100vh - var\(--header-h\)[^;]*\*\s*16\s*\/\s*9\)\);/, 'vh: width = min(100%, availableHeight*16/9)');
  assert.match(body, /width:\s*min\(100%,\s*calc\(\(100dvh - var\(--header-h\)[^;]*\*\s*16\s*\/\s*9\)\);/, 'dvh twin present (the repo viewport-height convention)');
  assert.match(body, /margin-inline:\s*auto/, 'centred when height-bound (page bg to the sides, YouTube-style)');
  // gate WARNING (confirmed): the wrapper is aspect-ratio:auto here (rule 6369),
  // so the 40px control-bar reserve + 2px border are ADDITIVE and MUST be
  // subtracted from the video budget, else the bar tucks ~18px under the fold.
  // Bound PER-LINE (vh AND dvh) - a whole-body match survives a dvh-only mutant,
  // and dvh is the EFFECTIVE declaration on modern desktop (the vh/dvh divergent-
  // twin class this repo keeps paying for).
  assert.match(body, /100vh[^;]*- 40px - 2px\) \* 16 \/ 9/, 'vh budget subtracts the bar+border reserve');
  assert.match(body, /100dvh[^;]*- 40px - 2px\) \* 16 \/ 9/, 'dvh budget (the live desktop one) subtracts the bar+border reserve');
});

// ---- widescreen (Dean): ALL views' players overflow a wide monitor, not just
// watch. One MEASURED cap (--player-cap-h, set by player.js) applied shell-agnostic
// on desktop, minus the reader's compact audio bar. Source-lock the mechanism; the
// FEEL on a wide monitor is Dean's device arbiter. ----------------------------

test('the desktop player cap is shell-agnostic (all views) but EXCLUDES the reader compact bar, and reads the MEASURED --player-cap-h (fixed budget only the fallback)', () => {
  assert.match(STYLE_CSS, /@media \(min-width: 1025px\) \{/, 'a desktop (>1024px) media query exists');
  // shell-agnostic `#player-slot` (covers watch/music/podcasts/shows), NOT
  // theatre-scoped, and `:not(.reader-player-slot)` so the reader bar stays out.
  const rule = /\n {2}#player-slot:not\(\.reader-player-slot\) #player-wrapper:not\(\.audio-expanded\):not\(\.css-fullscreen\):not\(:fullscreen\) \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(rule, 'the all-views cap rule exists: #player-slot:not(.reader-player-slot) #player-wrapper (fullscreen/audio excluded)');
  const body = rule[1];
  // width bound by the MEASURED cap height * 16/9; the fixed watch budget is only
  // the var() FALLBACK (pre-measure frame / no-JS). Per-line (vh AND dvh).
  assert.match(body, /width:\s*min\(100%,\s*calc\(var\(--player-cap-h,\s*calc\(100vh - var\(--header-h\)[^;]*\*\s*16\s*\/\s*9\)\);/, 'vh: width = min(100%, var(--player-cap-h, <budget>)*16/9)');
  assert.match(body, /width:\s*min\(100%,\s*calc\(var\(--player-cap-h,\s*calc\(100dvh - var\(--header-h\)[^;]*\*\s*16\s*\/\s*9\)\);/, 'dvh twin present, reading the measured var');
  assert.match(body, /- 40px - 2px\)\) \* 16 \/ 9/, 'the fallback budget subtracts the bar+border reserve');
  assert.match(body, /margin-inline:\s*auto/, 'centred when height-bound');
});

// ---- v1.319 (Dean: "YouTube's theatre view sizes the video so the title + channel +
// action row still show at the bottom of the first screen"). Plan
// 2026-09-24-desktop-theatre carries the side-by-side measurements; these bind the
// mechanism: the pure reserve, and the desktop stage rule that spends it. -----------

const { theatreReservePx } = require('../../public/js/watch.js');

test('v1.319 theatreReservePx: the room below the stage = the action bar bottom minus the stage bottom, rounded UP', () => {
  // the measured 1280x720 theatre shape: stage 80..564, three-line bar ending at 736.4
  assert.strictEqual(theatreReservePx({ bottom: 564, height: 484 }, { bottom: 736.4 }), 173);
  assert.strictEqual(theatreReservePx({ bottom: 959, height: 879 }, { bottom: 1057 }), 98);
  assert.strictEqual(theatreReservePx({ bottom: 100, height: 20 }, { bottom: 100 }), 0, 'zero room is a real reading');
});

test('v1.319 theatreReservePx: no reading (null) for a missing rect, an EMPTY stage, a non-finite edge or a bar above the stage', () => {
  assert.strictEqual(theatreReservePx(null, { bottom: 700 }), null);
  assert.strictEqual(theatreReservePx({ bottom: 500, height: 400 }, null), null);
  // the player not mounted in the stage (docked / not yet loaded): the wrapper's own
  // bottom margin is missing too, so the reading would be short - keep the last value
  assert.strictEqual(theatreReservePx({ bottom: 80, height: 0 }, { bottom: 200 }), null);
  assert.strictEqual(theatreReservePx({ bottom: NaN, height: 400 }, { bottom: 700 }), null);
  assert.strictEqual(theatreReservePx({ bottom: 500, height: 400 }, { bottom: Infinity }), null);
  assert.strictEqual(theatreReservePx({ bottom: 500, height: 400 }, { bottom: 480 }), null, 'a bar above the stage is not a layout this rule knows');
});

// ---- v1.319 D2 (Architect ruling on "match YouTube's theatre geometry": YouTube hides
// its guide in theatre). The pure collapse / restore / release over a REAL DOM (jsdom),
// populated both ways: the sidebar open (theatre collapses and owns it) and the sidebar
// already collapsed by the user (theatre owns nothing and restores nothing). ----------
const { theatreGuideCollapse, theatreGuideRestore, theatreGuideRelease, THEATRE_GUIDE_ATTR } = require('../../public/js/watch.js');
function shellDoc({ collapsed = false } = {}) {
  const { JSDOM } = require('jsdom');
  const d = new JSDOM('<body><aside class="sidebar" id="sidebar"></aside><main class="main-content" id="main-content"></main></body>').window.document;
  if (collapsed) { // exactly what common.js's #menu-toggle click does
    d.getElementById('sidebar').classList.toggle('hidden');
    d.getElementById('sidebar').classList.toggle('mobile-open');
    d.getElementById('main-content').classList.toggle('expanded');
  }
  const state = () => ({
    hidden: d.getElementById('sidebar').classList.contains('hidden'),
    mobileOpen: d.getElementById('sidebar').classList.contains('mobile-open'),
    expanded: d.getElementById('main-content').classList.contains('expanded'),
    owner: d.body.getAttribute(THEATRE_GUIDE_ATTR),
  });
  return { d, state };
}
const OPEN = { hidden: false, mobileOpen: false, expanded: false, owner: null };

test('v1.319 D2 theatreGuide: an OPEN sidebar collapses through the menu toggle\'s own class trio and theatre owns it; the owner\'s restore brings it back', () => {
  const { d, state } = shellDoc();
  assert.deepStrictEqual(state(), OPEN, 'precondition: populated, open');
  assert.strictEqual(theatreGuideCollapse(d, 'w1'), true);
  assert.deepStrictEqual(state(), { hidden: true, mobileOpen: true, expanded: true, owner: 'w1' });
  assert.strictEqual(theatreGuideRestore(d, 'w2'), false, 'a view that does not own it restores nothing');
  assert.deepStrictEqual(state(), { hidden: true, mobileOpen: true, expanded: true, owner: 'w1' });
  assert.strictEqual(theatreGuideRestore(d, 'w1'), true);
  assert.deepStrictEqual(state(), OPEN, 'the owner\'s restore reopens it and drops the marker');
  assert.strictEqual(theatreGuideRestore(d, 'w1'), false, 'idempotent');
});

test('v1.319 D2 theatreGuide: a sidebar the USER collapsed is left alone - no ownership, so theatre off never opens it', () => {
  const { d, state } = shellDoc({ collapsed: true });
  const before = state();
  assert.strictEqual(theatreGuideCollapse(d, 'w1'), false);
  assert.deepStrictEqual(state(), before, 'untouched, no marker');
  assert.strictEqual(theatreGuideRestore(d, 'w1'), false);
  assert.deepStrictEqual(state(), before, 'still collapsed');
});

test('v1.319 D2 theatreGuide: a second watch view RE-CLAIMS an owned collapse (a watch -> watch hop), and a hand toggle RELEASES it', () => {
  const { d, state } = shellDoc();
  theatreGuideCollapse(d, 'w1');
  assert.strictEqual(theatreGuideCollapse(d, 'w2'), true);
  assert.strictEqual(state().owner, 'w2', 're-claimed');
  assert.strictEqual(theatreGuideRestore(d, 'w1'), false, 'the old view\'s deferred restore is a no-op');
  assert.strictEqual(state().hidden, true);
  // the user reopens by hand (the toggle flips the trio), then closes it again by hand
  for (const el of [['sidebar', 'hidden'], ['sidebar', 'mobile-open'], ['main-content', 'expanded']]) d.getElementById(el[0]).classList.toggle(el[1]);
  theatreGuideRelease(d);
  assert.deepStrictEqual(state(), OPEN, 'open by hand, released');
  for (const el of [['sidebar', 'hidden'], ['sidebar', 'mobile-open'], ['main-content', 'expanded']]) d.getElementById(el[0]).classList.toggle(el[1]);
  assert.strictEqual(theatreGuideRestore(d, 'w2'), false, 'released: theatre off leaves the user\'s choice');
  assert.strictEqual(state().hidden, true, 'the hand-closed bar stays closed');
});

// Comment-stripped once (comment-porous locks are a repo scar), then every
// `@media (min-width: 1025px)` block, brace-balanced.
const CSS_NC = STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
function desktopBlocks() {
  const out = [];
  const re = /@media \(min-width:\s*1025px\)\s*\{/g;
  let m;
  while ((m = re.exec(CSS_NC))) {
    let depth = 1; let i = m.index + m[0].length;
    for (; i < CSS_NC.length && depth > 0; i++) { if (CSS_NC[i] === '{') depth++; else if (CSS_NC[i] === '}') depth--; }
    out.push(CSS_NC.slice(m.index + m[0].length, i - 1));
  }
  return out;
}
const STAGE_SEL = '.watch-container.theater-mode .watch-player-stage';
const WRAP_SEL = '.watch-container.theater-mode #player-slot #player-wrapper:not(.audio-expanded):not(.css-fullscreen):not(:fullscreen)';
function ruleBodies(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp('(?:^|[}\\s])' + esc + '\\s*\\{([^}]*)\\}', 'g'))].map((m) => m[1]);
}

test('v1.319 desktop theatre: the STAGE carries the YouTube-matched width (vh AND dvh), centred, and ONLY inside the 1025px+ block', () => {
  const blocks = desktopBlocks().filter((b) => ruleBodies(b, STAGE_SEL).length);
  assert.strictEqual(blocks.length, 1, 'exactly one desktop block carries the theatre stage rule');
  const bodies = ruleBodies(blocks[0], STAGE_SEL);
  assert.strictEqual(bodies.length, 1, 'one stage rule in it');
  const body = bodies[0];
  // Mobile / tablet untouched: the rule exists NOWHERE outside a 1025px+ block.
  let outside = CSS_NC;
  for (const b of desktopBlocks()) outside = outside.split(b).join('');
  assert.strictEqual(ruleBodies(outside, STAGE_SEL).length, 0, 'no theatre stage rule outside the desktop block (phones/tablets keep the old rule)');
  // One declaration per viewport unit, each carrying EVERY term of the budget, PER LINE
  // (a whole-body match survives a one-line mutant - the vh/dvh divergent-twin class).
  const decls = body.split(';').map((d) => d.trim()).filter((d) => /^width\s*:/i.test(d));
  assert.strictEqual(decls.length, 2, 'two width declarations (vh fallback, then dvh): ' + JSON.stringify(decls));
  const TERM = (unit) => new RegExp('^width:\\s*min\\(100%,\\s*max\\(480px,\\s*calc\\(\\(100' + unit + ' - var\\(--header-h\\) - var\\(--space-12\\) - 40px - 2px - var\\(--watch-theatre-reserve,\\s*98px\\) - 23px\\) \\* 16 \\/ 9 \\+ 2px\\)\\)\\)$');
  assert.match(decls[0], TERM('vh'), 'vh: 16:9 of (viewport - header - top padding - bar/border - measured reserve - 23px fold margin), + the 2px border');
  assert.match(decls[1], TERM('dvh'), 'dvh twin, LAST (the effective declaration on a modern desktop)');
  assert.match(body, /margin-inline:\s*auto/, 'centred in the column');
});

test('v1.319 desktop theatre: the wrapper FILLS the stage there (so the stage box IS the player box the glow is sized from), fullscreen/audio-expanded excluded', () => {
  const blocks = desktopBlocks().filter((b) => ruleBodies(b, STAGE_SEL).length);
  const wrap = ruleBodies(blocks[0], WRAP_SEL);
  assert.strictEqual(wrap.length, 1, 'the wrapper rule sits in the SAME desktop block, keeping the fullscreen + audio-expanded exclusions');
  assert.match(wrap[0], /^\s*width:\s*100%;\s*$/, 'width 100% and nothing else');
  // Cascade: equal specificity with the v1.190 rule, so the desktop override must come AFTER it.
  const old = CSS_NC.indexOf(WRAP_SEL + ' {');
  const blockAt = CSS_NC.indexOf(blocks[0]);
  assert.ok(old !== -1 && blockAt > old, 'the desktop block follows the v1.190 rule (source order decides between them)');
});

test('v1.319 desktop theatre: the PICTURE is capped at the SAME budgeted height (a 4:3 item letterboxes instead of pushing the row under the fold)', () => {
  const blocks = desktopBlocks().filter((b) => ruleBodies(b, STAGE_SEL).length);
  const media = ruleBodies(blocks[0], WRAP_SEL + ' #media-player');
  assert.strictEqual(media.length, 1, 'the picture cap sits in the same desktop block, with the fullscreen + audio-expanded exclusions');
  const caps = media[0].split(';').map((d) => d.trim()).filter((d) => /^max-height\s*:/i.test(d));
  assert.strictEqual(caps.length, 2, 'vh then dvh: ' + JSON.stringify(caps));
  assert.match(caps[0], /^max-height:\s*max\(270px,\s*calc\(100vh - /, 'vh cap, floored at the 480px floor\'s 16:9 height');
  assert.match(caps[1], /^max-height:\s*max\(270px,\s*calc\(100dvh - /, 'dvh cap LAST');
  // ONE budget: the height the stage's width is derived from and the picture's cap are the
  // same expression, term for term, per unit (a hand-copy that drifts re-opens the fold).
  const stageDecls = ruleBodies(blocks[0], STAGE_SEL)[0].split(';').map((d) => d.trim()).filter((d) => /^width\s*:/i.test(d));
  const budgetOf = (decl, unit) => { const m = new RegExp('calc\\(\\(?(100' + unit + ' - [^()]*\\([^)]*\\)[^()]*\\([^)]*\\)[^()]*\\([^)]*\\)[^()]*)').exec(decl); return m && m[1].replace(/\)\s*$/, '').trim(); };
  for (const [i, unit] of [[0, 'vh'], [1, 'dvh']]) {
    const w = budgetOf(stageDecls[i], unit);
    const h = budgetOf(caps[i], unit);
    assert.ok(w && h, unit + ': both budgets parsed (' + w + ' | ' + h + ')');
    assert.strictEqual(h, w, unit + ': the picture cap spends exactly the budget the width is derived from');
  }
});
