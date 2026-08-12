'use strict';

// [UNIT] v1.34 T3 (Dean, chapters) -- five-shell parity for the chapter
// picker: `#chapters-btn` + `#chapters-menu` must be byte-identical in every
// shell's #player-host-template (same rationale as
// test/unit/player-cc-btn-parity.test.js: the persistent host is cloned once
// from whichever shell booted the session, so a shell missing the markup
// would strand that whole session without a chapters UI). Plus source-lock
// guards on the player wiring and the drag-scrub CSS half.
const { test } = require('node:test');

// Tier 2 (DELIBERATE lock updates): control sizes became --size-* tokens;
// values resolved back before asserting. Token VALUES are pinned by
// test/unit/token-scale-lock.test.js.
const SIZE_TOKENS = { '--size-touch': '44px', '--size-control': '36px', '--size-control-sm': '32px' };
const rt = (s) => String(s).replace(/var\((--size-[\w-]+)\)/g, (_, n) => SIZE_TOKENS[n] || _);
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SHELLS = [
  path.join(ROOT, 'public', 'index.html'),
  path.join(ROOT, 'public', 'watch.html'),
  path.join(ROOT, 'public', 'setup.html'),
  path.join(ROOT, 'public', 'stats.html'),
  path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'),
];

const CHAPTERS_BTN_MARKUP = '<button type="button" id="chapters-btn" class="pc-btn chapters-btn" aria-label="Chapters" aria-expanded="false" style="display: none;">Ch</button>';
const CHAPTERS_MENU_MARKUP = '<div id="chapters-menu" class="chapters-menu" hidden></div>';

test('chapters parity: #chapters-btn + #chapters-menu are byte-identical in every owned shell, placed after #cc-btn', () => {
  for (const shell of SHELLS) {
    const html = fs.readFileSync(shell, 'utf8');
    assert.ok(html.includes(CHAPTERS_BTN_MARKUP), `expected the exact #chapters-btn markup in ${path.basename(shell)}`);
    assert.ok(html.includes(CHAPTERS_MENU_MARKUP), `expected the exact #chapters-menu markup in ${path.basename(shell)}`);
    const ccIdx = html.indexOf('id="cc-btn"');
    const chIdx = html.indexOf('id="chapters-btn"');
    assert.ok(ccIdx >= 0 && chIdx > ccIdx, `#chapters-btn must come after #cc-btn in ${path.basename(shell)} (cc-btn parity suite pins cc-btn's own position)`);
  }
});

test('chapters parity: exactly one #chapters-btn per shell (no duplicate insertion)', () => {
  for (const shell of SHELLS) {
    const html = fs.readFileSync(shell, 'utf8');
    assert.equal((html.match(/id="chapters-btn"/g) || []).length, 1, path.basename(shell));
  }
});

// ---- player.js wiring source-locks ------------------------------------------

const playerSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');

test('player.js: chapters lifecycle is wired -- refs cached, applied per load, reset on teardown, live seeks via startLiveStream', () => {
  assert.ok(playerSrc.includes("chaptersBtn = host.querySelector('#chapters-btn')"), 'ensureHost must cache the button ref');
  assert.ok(playerSrc.includes('applyChaptersForMedia(data)'), 'setupForMedia must apply the loaded item\'s chapters');
  assert.ok(playerSrc.includes('resetChaptersUi()'), 'teardown must reset the chapters UI');
  // v1.41.12: the seek body moved to seekToChapterTime (the no-menu-close
  // variant armChapterLoop's seek-in uses); seekToChapter = that + close.
  // The lock follows the split -- same live-reload-seek behavior, new home.
  assert.match(playerSrc, /function seekToChapterTime\(t\) \{[\s\S]*?startLiveStream\(t, true\)/, 'a chapter pick in live mode must route through startLiveStream (the reload-seek path)');
  assert.match(playerSrc, /function seekToChapter\(t\) \{\s*seekToChapterTime\(t\);\s*closeChaptersMenu\(\);/, 'the row-tap path keeps close-on-seek');
  assert.ok(playerSrc.includes('window.showChaptersEditor'), 'the menu must hand editing off to common.js\'s editor');
});

test('player.js: v1.34 T2 CC sync -- startLiveStream re-points the caption track at the offset-shifted VTT', () => {
  assert.match(playerSrc, /function startLiveStream\(t, autoplay\) \{[\s\S]*?syncCcTrackToLiveOffset\(\);/, 'every live (re)start must resync the track');
  assert.ok(playerSrc.includes("base + '?offset=' + liveOffset"), 'the shifted-VTT URL must carry the live offset');
});

test('player.js: v1.34 T6 drag scrubbing -- pointer capture drives the input/change pipeline; pure ratio helper exported', () => {
  assert.ok(playerSrc.includes("seekBar.addEventListener('pointerdown'"), 'pointerdown handler');
  assert.ok(playerSrc.includes("seekBar.addEventListener('pointermove'"), 'pointermove handler');
  assert.ok(playerSrc.includes("seekBar.addEventListener('pointerup'"), 'pointerup handler');
  assert.ok(playerSrc.includes("seekBar.addEventListener('pointercancel'"), 'pointercancel handler (isScrubbing must never latch)');
  const player = require('../../public/js/player.js');
  assert.equal(typeof player.scrubRatioFromPointer, 'function');
});

test('style.css: the drag-scrub CSS half -- .pc-range carries touch-action: none (iOS scroll-steal guard)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.pc-range \{\s*\n\s*touch-action: none;/, 'without touch-action:none, iOS cancels the drag mid-gesture (the "tap only" symptom)');
});

// ---- scrubRatioFromPointer behavior ------------------------------------------

test('scrubRatioFromPointer clamps to [0,1] and returns null for a degenerate rect', () => {
  const { scrubRatioFromPointer } = require('../../public/js/player.js');
  assert.equal(scrubRatioFromPointer(50, 0, 100), 0.5);
  assert.equal(scrubRatioFromPointer(-10, 0, 100), 0);
  assert.equal(scrubRatioFromPointer(500, 0, 100), 1);
  assert.equal(scrubRatioFromPointer(50, 0, 0), null, 'zero-width rect -> null (skip the frame)');
  assert.equal(scrubRatioFromPointer(NaN, 0, 100), null);
});

// ---- v1.34.1 (Dean's on-device pass): mobile declutter + dismissable menu ---
test('v1.34.1: the chapters UI is mobile-safe -- has-chapters class toggled per load, pointerdown outside-close wired, chapterless-mobile CSS hide + the TWO-ROW mobile bar present', () => {
  assert.ok(playerSrc.includes("host.classList.toggle('has-chapters', currentChapters.length > 0)"),
    'applyChaptersForMedia must expose the has-chapters hook CSS keys off');
  assert.ok(playerSrc.includes("host.classList.remove('has-chapters')"),
    'teardown must clear it');
  assert.ok(playerSrc.includes("document.addEventListener('pointerdown', closeChaptersMenuOnOutside)"),
    'the outside-close must ALSO bind pointerdown -- iOS never synthesizes click over the gesture-layer video surface');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /#player-wrapper\.ff-mobile:not\(\.has-chapters\) #chapters-btn \{\s*display: none !important;/,
    'a chapterless mobile item must not spend a bar slot on the Ch button');
  // The two-row mobile bar (Dean: seek bar had collapsed to an unusable
  // sliver): full-width scrub row + 80px bar/strip, FULL in-slot player
  // only, with the native-controls strip-removal outranking the 2-ID
  // reservation.
  assert.match(css, /#player-slot \.player-controls \{\s*flex-wrap: wrap;\s*height: 80px;/, 'two-row bar');
  // v1.34.3: the min-width approach was replaced by the structural
  // ::after line break (device-font-independent).
  assert.match(css, /#player-slot \.player-controls::after \{\s*content: '';\s*order: -1;\s*flex-basis: 100%;/, 'the structural line break between scrub row and buttons');
  assert.match(css, /#player-slot #player-wrapper:not\(\.audio-expanded\) \{\s*padding-bottom: 80px;/, 'the reserved strip matches the two-row bar');
  assert.match(css, /#player-slot #player-wrapper:not\(\.audio-expanded\)\.native-controls \{\s*padding-bottom: 0;/, 'native mode still removes the strip (outranks the 2-ID reservation)');
});

// ---- v1.34.2 (Dean round 2): dismissal braces + faux fullscreen -------------
test('v1.34.2: the chapters menu has an explicit close (header ✕), touchstart/play-pause-seek dismissal braces, and custom-mode mobile fullscreen is the CSS faux path', () => {
  assert.ok(playerSrc.includes("closeBtn.className = 'chapters-menu-close'"), 'an explicit ✕ close button in the menu header');
  assert.ok(playerSrc.includes("document.addEventListener('touchstart', closeChaptersMenuOnOutside, { passive: true })"), 'touchstart fallback (iOS click/pointer synthesis quirks)');
  // v1.109 (Dean, follow-along): PLAY now dismisses only the speed picker so the
  // chapters menu survives play and follows along; pause/seeking still close both
  // (see the dedicated v1.109 source-lock below).
  assert.ok(playerSrc.includes("mediaPlayer.addEventListener('play', closeSpeedMenu)"), 'play dismisses the speed picker (not the chapters menu -- follow-along)');
  assert.ok(playerSrc.includes("mediaPlayer.addEventListener('pause', closeChaptersMenu)"), 'pause still dismisses the chapters menu');
  // v1.67.5: the exit button is the ONE restore-eligible caller (gate C1) -
  // the toggle now passes { restoreScroll: true }.
  assert.ok(playerSrc.includes("setCssFullscreen(!host.classList.contains('css-fullscreen'), { restoreScroll: true })"), 'custom-mode mobile fullscreen toggles the CSS faux-fullscreen (iPhone element-fullscreen is native-only)');
  assert.ok(playerSrc.includes('if (state !== STATE_FULL) setCssFullscreen(false)'), 'docking/closing drops the fixed overlay');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /#player-wrapper\.css-fullscreen \{\s*position: fixed;\s*inset: 0;/, 'the faux-fullscreen host treatment');
  assert.match(css, /#player-wrapper\.css-fullscreen:not\(\.audio-expanded\) #media-player \{\s*aspect-ratio: auto;/, 'the aspect pin releases in faux fullscreen');
  // Ordering: the css-fullscreen media rule must come AFTER the portrait
  // 16:9 pin (equal specificity -- later wins).
  const pinIdx = css.indexOf('#player-wrapper.portrait-media:not(.audio-expanded) #media-player');
  const fsIdx = css.indexOf('#player-wrapper.css-fullscreen:not(.audio-expanded) #media-player');
  assert.ok(pinIdx >= 0 && fsIdx > pinIdx, 'css-fullscreen must outrank the portrait pin by order');
  // Row exclusivity (v1.34.3): structural ::after line break -- asserted
  // in the v1.34.1 lock above.
});


// ---- v1.34.3 (Dean round 3): the dismissal ROOT CAUSE + faux hardening ------
test('v1.34.3: [hidden] actually hides the chapters menu (the display:flex override was the entire dismissal saga), and faux fullscreen releases the mobile height clamps + keys off the active surface', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.chapters-menu\[hidden\] \{[\s\S]*?display: none !important;/,
    'without this rule, the menu class display:flex overrides the hidden attribute and NO close path can ever work');
  const hiddenIdx = css.indexOf('.chapters-menu[hidden]');
  const classIdx = css.indexOf('.chapters-menu {');
  assert.ok(hiddenIdx >= 0 && classIdx >= 0, 'both rules present');
  assert.match(css, /#player-wrapper\.css-fullscreen \{[\s\S]*?max-height: none !important;/,
    'faux fullscreen must release the 45vh-78vh mobile clamps or it renders as a band');
  assert.ok(playerSrc.includes("currentData && currentData.type !== 'audio' && state === STATE_FULL"),
    'the faux trigger keys off the ACTIVE surface, not the async cached settings flag');
});


// ---- v1.34.4 (Dean round 4): overlay stacking + safe-area bar ---------------
test('v1.34.4: faux fullscreen outranks header/nav, freezes the page, and the bar grows for the safe area instead of clipping', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  // Tier 4 batch 4d (2026-07-31): 1500 -> var(--z-sheet); token-scale-lock
  // is the byte-exact authority that --z-sheet == 1500. Gate fix round 1
  // (QA S1): the ordering semantics stay BOUND like the audio-expand lock,
  // not just spelled - rung values re-derived from the ladder definitions.
  assert.match(css, /#player-wrapper\.css-fullscreen \{[\s\S]*?z-index: var\(--z-sheet\);/, 'the faux-fullscreen overlay rides the --z-sheet rung');
  const zdef = (name) => {
    const m = new RegExp(name + ':\\s*(\\d+);').exec(css);
    assert.ok(m, `expected a :root definition for ${name}`);
    return Number(m[1]);
  };
  assert.ok(zdef('--z-sheet') > zdef('--z-header'), 'above the site header rung');
  assert.ok(zdef('--z-sheet') > zdef('--z-nav'), 'above the mobile bottom-nav rung');
  assert.ok(zdef('--z-sheet') < zdef('--z-modal'), 'below the modal tier so the chapters editor still opens over it');
  assert.match(css, /body\.ft-css-fullscreen \{\s*overflow: hidden;/, 'page scroll frozen (the landscape gap)');
  assert.match(css, /body\.ft-css-fullscreen header,\s*body\.ft-css-fullscreen \.bottom-nav \{\s*visibility: hidden;/, 'chrome explicitly hidden');
  assert.match(css, /#player-wrapper\.css-fullscreen:not\(\.audio-expanded\) \{\s*padding-bottom: 0 !important;/, 'the bar OVERLAYS the picture in faux fullscreen (no strip mismatch)');
  assert.match(css, /#player-wrapper\.css-fullscreen \.player-controls \{\s*height: auto;[\s\S]*?env\(safe-area-inset-bottom/, 'the bar grows for the home indicator instead of clipping its buttons row');
  assert.ok(playerSrc.includes('function setCssFullscreen(on, opts)'), 'host + body classes move together (v1.67.5: + the scroll keeper opts)');
});

// ---- v1.34.5 (Dean round 5): the iOS rotate-to-native-fullscreen hijack -----
test('v1.34.5: rotating a playing video to landscape in CUSTOM mode bounces out of the native player into faux fullscreen; the fullscreen bar blends into black', () => {
  assert.ok(playerSrc.includes("mediaPlayer.addEventListener('webkitbeginfullscreen'"), 'the hijack listener exists');
  assert.match(playerSrc, /webkitbeginfullscreen', function \(\) \{[\s\S]*?webkitExitFullscreen\(\);[\s\S]*?setCssFullscreen\(true\);/,
    'custom mode bounces the native auto-fullscreen and grants faux fullscreen instead');
  assert.match(playerSrc, /webkitbeginfullscreen', function \(\) \{\s*if \(!isMobileFormFactor\(\) \|\| inNativeControlsMode\(\)\) return;/,
    'native-controls mode keeps the native rotation fullscreen untouched');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  // Step 3 batch 3c (2026-07-31): .75 joined --scrim-heavy (0.8) per the
  // ruled scrim consolidation - token-scale-lock is the value authority.
  assert.match(css, /#player-wrapper\.css-fullscreen \.player-controls \{[\s\S]*?background: var\(--scrim-heavy\);/,
    'the fullscreen bar blends into the black canvas (no themed band at the bottom)');
});

// ---- v1.34.6 (Dean): audio expanded-view bar/art geometry -------------------
test('v1.34.6: the expanded audio bar is flush to the bottom edge (safe-area INSIDE it) and the art canvas ends above the bar in both bar layouts', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  // Step 3 opener (2026-07-31): 4px -> var(--space-2); token-scale-lock
  // is the byte-exact value authority.
  assert.match(css, /#player-wrapper\.audio-mode\.audio-expanded \.player-controls \{[\s\S]*?bottom: 0;[\s\S]*?padding-bottom: calc\(var\(--space-2\) \+ env\(safe-area-inset-bottom, 0px\)\);/,
    'flush bar, safe-area as internal padding (no gap strip under the bar)');
  assert.match(css, /#player-wrapper\.audio-mode\.audio-expanded #audio-bg-art \{[\s\S]*?bottom: calc\(52px \+ env\(safe-area-inset-bottom, 0px\)\);/,
    'single-row-bar art cutoff (desktop/landscape)');
  assert.match(css, /#player-wrapper\.audio-mode\.audio-expanded #audio-bg-art \{\s*bottom: calc\(94px \+ env\(safe-area-inset-bottom, 0px\)\);/,
    'two-row-bar art cutoff (mobile <=768px)');
});

// ---- v1.41.11 (Dean): mobile chapters legibility + docked-miniplayer hide ---
// Dean: the chapter picker was "compressed and small" on the mobile watch
// page (the base .chapters-menu is sized for a wide desktop player) and
// "shows up oddly in the miniplayer" (the popup anchored inside the 160-280px
// dock). Locks the two CSS halves and the dock() ARIA-truth close.
test('v1.41.11: mobile chapters menu spans the player width with 44px tap targets and 2-line wrapped titles', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  const start = css.indexOf('v1.41.11 (Dean: "compressed and small" on mobile)');
  assert.ok(start >= 0, 'the mobile chapters block (with its dated rationale comment) exists in style.css');
  const block = css.slice(start, start + 1600);
  assert.match(block, /@media \(max-width: 768px\) \{[\s\S]*?\.chapters-menu \{[\s\S]*?left: 8px;[\s\S]*?right: 8px;[\s\S]*?max-width: none;/,
    'the popup spans the player width at the mobile breakpoint (no more 220px strip)');
  assert.match(rt(block), /\.chapters-menu-item \{[\s\S]*?min-height: 44px;[\s\S]*?white-space: normal;[\s\S]*?-webkit-line-clamp: 2;/,
    'rows are real tap targets and titles wrap to two lines instead of ellipsizing');
});

test('v1.41.11: chapters are hidden entirely in the docked mini-player, and dock() closes the menu for ARIA truth', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /#player-dock #chapters-btn,\s*#player-dock \.chapters-menu \{\s*display: none !important;/,
    'both the button and the popup are display:none inside #player-dock (skip-controls precedent)');
  const playerSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  const dockStart = playerSrc.indexOf('function dock()');
  const dockEnd = playerSrc.indexOf('function close()', dockStart);
  assert.ok(dockStart >= 0 && dockEnd > dockStart, 'dock() precedes close() (source-lock slice bounds)');
  const dockBody = playerSrc.slice(dockStart, dockEnd);
  assert.ok(dockBody.includes('chaptersMenu.hidden = true'), 'dock() hides the menu');
  assert.ok(dockBody.includes("chaptersBtn.setAttribute('aria-expanded', 'false')"), 'dock() resets the button ARIA state');
});

// ---- v1.41.12 (Dean): chapter loop ------------------------------------------
// "Loop that specific section -- like a music album." Pure bounds resolver +
// source-locks on the four seams that make the loop correct: the timeupdate
// clamp on BOTH media elements, the 'ended' cascade pre-emption (last
// chapter), the per-load/per-edit clears, and the menu's per-row toggle.

const { resolveChapterLoopBounds, currentChapterIndex, markCurrentChapterItem, chapterBoundaryPercents } = require('../../public/js/player.js');
const { JSDOM } = require('jsdom');

test('resolveChapterLoopBounds: interior chapter ends at the NEXT chapter start; last chapter ends at duration', () => {
  const chapters = [
    { startTime: 0, title: 'Intro' },
    { startTime: 60, title: 'Track 1' },
    { startTime: 200, title: 'Track 2' },
  ];
  assert.deepStrictEqual(resolveChapterLoopBounds(chapters, 1, 300), { start: 60, end: 200 });
  assert.deepStrictEqual(resolveChapterLoopBounds(chapters, 2, 300), { start: 200, end: 300 });
  assert.deepStrictEqual(resolveChapterLoopBounds(chapters, 0, 300), { start: 0, end: 60 });
});

test('resolveChapterLoopBounds: REFUSES (null) anything that cannot make a sane loop', () => {
  const chapters = [{ startTime: 0 }, { startTime: 60 }];
  assert.strictEqual(resolveChapterLoopBounds(chapters, 2, 300), null, 'out-of-range index');
  assert.strictEqual(resolveChapterLoopBounds(chapters, -1, 300), null, 'negative index');
  assert.strictEqual(resolveChapterLoopBounds(chapters, 1, NaN), null, 'last chapter with unknowable duration');
  assert.strictEqual(resolveChapterLoopBounds(chapters, 1, 30), null, 'duration BEFORE the chapter start (zero/negative window)');
  assert.strictEqual(resolveChapterLoopBounds([{ startTime: 'x' }], 0, 100), null, 'malformed startTime');
  assert.strictEqual(resolveChapterLoopBounds(null, 0, 100), null, 'no chapters at all');
  assert.strictEqual(resolveChapterLoopBounds(chapters, '1', 300), null, 'non-numeric index');
});

// ---- v1.109 (Dean): chapter follow-along -- currentChapterIndex resolver -----
test('currentChapterIndex: returns the chapter whose [start, nextStart) window holds t; last runs to +inf', () => {
  const chapters = [
    { startTime: 0, title: 'Intro' },
    { startTime: 60, title: 'Track 1' },
    { startTime: 200, title: 'Track 2' },
  ];
  assert.strictEqual(currentChapterIndex(chapters, 0), 0, 'exactly at a boundary belongs to that chapter');
  assert.strictEqual(currentChapterIndex(chapters, 30), 0);
  assert.strictEqual(currentChapterIndex(chapters, 60), 1, 'boundary is inclusive of the chapter it starts');
  assert.strictEqual(currentChapterIndex(chapters, 199.9), 1);
  assert.strictEqual(currentChapterIndex(chapters, 200), 2);
  assert.strictEqual(currentChapterIndex(chapters, 99999), 2, 'the last chapter runs to +inf');
});

test('currentChapterIndex: -1 before the first chapter start, and for empty/malformed input', () => {
  const late = [{ startTime: 10, title: 'A' }, { startTime: 30, title: 'B' }];
  assert.strictEqual(currentChapterIndex(late, 5), -1, 't before the first chapter start');
  assert.strictEqual(currentChapterIndex(late, 10), 0, 'at the first start it becomes current');
  assert.strictEqual(currentChapterIndex([], 5), -1, 'no chapters');
  assert.strictEqual(currentChapterIndex(null, 5), -1, 'non-array');
  assert.strictEqual(currentChapterIndex(late, NaN), -1, 'non-finite t (NaN)');
  assert.strictEqual(currentChapterIndex(late, Infinity), -1, 'non-finite t (Infinity)');
});

test('currentChapterIndex: skips malformed startTimes and tolerates a non-monotonic set (last start <= t wins)', () => {
  // A malformed middle entry must not abort the lookup -- the valid chapters
  // around it still resolve.
  const withBad = [{ startTime: 0, title: 'A' }, { startTime: 'x', title: 'bad' }, { startTime: 120, title: 'C' }];
  assert.strictEqual(currentChapterIndex(withBad, 60), 0, 'malformed entry skipped, prior valid one stands');
  assert.strictEqual(currentChapterIndex(withBad, 130), 2);
  // Non-monotonic: the LAST index whose start <= t wins (never throws, never
  // points ahead of the playhead).
  const jumbled = [{ startTime: 0 }, { startTime: 300 }, { startTime: 100 }];
  assert.strictEqual(currentChapterIndex(jumbled, 150), 2, 'last qualifying start (index 2 @100) wins over index 0');
  assert.strictEqual(currentChapterIndex(jumbled, 50), 0);
  // A negative startTime is skipped like any malformed one (guards the `s < 0`
  // branch, which no other case exercises).
  const neg = [{ startTime: -5, title: 'bad' }, { startTime: 10, title: 'ok' }];
  assert.strictEqual(currentChapterIndex(neg, 3), -1, 'negative start skipped -> before the first valid start');
  assert.strictEqual(currentChapterIndex(neg, 20), 1, 'the valid later chapter still resolves');
});

// ---- v1.109: markCurrentChapterItem -- the Ch-menu highlight (BOTH axes) -----
function makeMenuItems(n) {
  const { document } = new JSDOM('<!doctype html><body></body>').window;
  const items = [];
  for (let i = 0; i < n; i++) {
    const b = document.createElement('button');
    b.className = 'chapters-menu-item';
    b.setAttribute('data-chapter-index', String(i));
    items.push(b);
  }
  return items;
}
const isMarked = (el) => el.classList.contains('chapters-menu-item-current') && el.getAttribute('aria-current') === 'true';

test('markCurrentChapterItem: REVEAL -- only the matching item gets the class + aria-current', () => {
  const items = makeMenuItems(3);
  markCurrentChapterItem(items, 1);
  assert.ok(isMarked(items[1]), 'the current chapter is marked');
  assert.ok(!items[0].classList.contains('chapters-menu-item-current') && !items[0].hasAttribute('aria-current'), 'others unmarked');
  assert.ok(!items[2].classList.contains('chapters-menu-item-current') && !items[2].hasAttribute('aria-current'));
});

test('markCurrentChapterItem: CLEAR -- moving the current chapter un-marks the previous one (not just adds)', () => {
  const items = makeMenuItems(3);
  markCurrentChapterItem(items, 1); // populate FIRST (a clear test on a born-empty set is vacuous)
  assert.ok(isMarked(items[1]));
  markCurrentChapterItem(items, 2); // playhead crosses into the next chapter
  assert.ok(!items[1].classList.contains('chapters-menu-item-current'), 'the OLD current row lost its class');
  assert.ok(!items[1].hasAttribute('aria-current'), 'the OLD current row lost aria-current');
  assert.ok(isMarked(items[2]), 'the new current row is marked');
});

test('markCurrentChapterItem: idx < 0 (no/pre-first chapter) clears ALL rows', () => {
  const items = makeMenuItems(3);
  markCurrentChapterItem(items, 0);
  assert.ok(isMarked(items[0]));
  markCurrentChapterItem(items, -1);
  assert.ok(items.every((el) => !el.classList.contains('chapters-menu-item-current') && !el.hasAttribute('aria-current')), 'every row cleared at idx -1');
});

test('v1.41.12 source-lock: the boundary clamp is wired on BOTH media elements and is live-transcode-aware', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  assert.match(src, /mediaPlayer\.addEventListener\('timeupdate', enforceChapterLoop\)/, 'foreground element clamped');
  assert.match(src, /bgAudioEl\.addEventListener\('timeupdate', enforceChapterLoop\)/, 'background-audio element clamped (lock-screen loops too)');
  const fn = src.slice(src.indexOf('function enforceChapterLoop()'), src.indexOf('function enforceChapterLoop()') + 900);
  assert.match(fn, /if \(liveMode\) \{\s*if \(currentAbsTime\(\) >= chapterLoop\.end\) startLiveStream\(chapterLoop\.start, true\);/,
    'liveMode wraps through startLiveStream against absolute time (the skip()/seekToChapter contract)');
});

test('v1.41.12 source-lock: the ended cascade pre-empts for an armed chapter loop BEFORE the progress-0 reset and loop/advance chain', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  const fnStart = src.indexOf('function runEndedCompletionCascade');
  const body = src.slice(fnStart, fnStart + 2600);
  const loopBranch = body.indexOf('if (chapterLoop) {');
  const progressReset = body.indexOf('saveProgressToServer(0)');
  assert.ok(loopBranch >= 0 && progressReset > loopBranch,
    'chapterLoop branch must run before the reset-to-0 -- a looping album track never zeroes its progress or advances');
  // Gate round 1 (adversarial W1/W2, both MUTATION-PROVEN gaps): the original
  // lazy regex matched forward into the WHOLE-ITEM loop's return, so deleting
  // this branch's own `return;` (or its prePauseCandidateAt kill) passed the
  // suite. Slice the branch body EXACTLY -- everything between the branch
  // open and the progress reset -- and assert its three load-bearing lines.
  const branchBody = body.slice(loopBranch, progressReset);
  // Delta R1 (mutation-proven AGAIN): a bare .includes() was satisfied by
  // the cascade's OUTER v1.27.2 kill sitting between the branch's close and
  // the progress reset. The kill must be the branch's FIRST statement --
  // anchored to the branch opener, no lookalike can satisfy it.
  assert.match(branchBody, /if \(chapterLoop\) \{\s*prePauseCandidateAt = 0;/,
    'W2: the v1.27.2 lock-screen-restart kill is the branch\'s FIRST statement');
  assert.ok(/el\.play\(\)\.catch\(function \(\) \{\}\);/.test(branchBody), 'the branch replays');
  assert.ok(/saveProgressToServer\(chapterLoop\.start\);\s*return;/.test(branchBody),
    'W1: the branch saves the CHAPTER position and returns before the reset -- deleting this return must fail HERE');
});

test('v1.41.12 source-lock: the loop is cleared on every load and on every chapter-set change', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  const teardown = src.slice(src.indexOf('function teardownMediaState()'), src.indexOf('function teardownMediaState()') + 1200);
  assert.match(teardown, /chapterLoop = null;/, 'per-load clear');
  assert.match(teardown, /chaptersBtn\.classList\.remove\('chapter-looping'\)/, 'indicator cleared with it');
  const apply = src.slice(src.indexOf('applyChaptersForMedia = function (data)'), src.indexOf('applyChaptersForMedia = function (data)') + 700);
  assert.match(apply, /chapterLoop = null;/, 'new chapter set clears the loop');
  const editor = src.slice(src.indexOf('window.showChaptersEditor(currentId'), src.indexOf('window.showChaptersEditor(currentId') + 700);
  assert.match(editor, /chapterLoop = null;/, 'edited chapter set clears the loop');
});

// ---- v1.109 (Dean): chapter follow-along wiring source-locks -----------------
test('v1.109 source-lock: the fill loop dispatches the current chapter, and buildChaptersMenu tags + re-applies it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  // The per-frame fill loop resolves the current chapter from the live position
  // and dispatches it (no-ops unless changed) -- this is what makes the menu row
  // + chip follow along without a second clock read.
  const usv = src.slice(src.indexOf('function updateSeekVisual()'), src.indexOf('function updateSeekVisual()') + 1000);
  assert.match(usv, /setCurrentChapter\(currentChapters\.length \? currentChapterIndex\(currentChapters, cur\) : -1\);/,
    'fill loop dispatches the live current chapter');
  // The dispatcher no-ops on an unchanged index (per-frame cheapness) then fans out.
  const disp = src.slice(src.indexOf('function setCurrentChapter(idx)'), src.indexOf('function setCurrentChapter(idx)') + 260);
  assert.match(disp, /if \(idx === currentChapterIdx\) return;/, 'dispatcher no-ops unless the chapter changed');
  assert.match(disp, /applyCurrentChapterToMenu\(\);/, 'dispatcher updates the menu highlight');
  // buildChaptersMenu tags each row with its index and re-applies the highlight
  // after every (re)build so an OPEN menu shows the playing row immediately.
  const build = src.slice(src.indexOf('function buildChaptersMenu()'), src.indexOf('function buildChaptersMenu()') + 6000);
  assert.match(build, /item\.setAttribute\('data-chapter-index', String\(index\)\);/, 'rows tagged with their chapter index');
  assert.match(build, /applyCurrentChapterToMenu\(\);/, 'highlight re-applied on (re)build');
  // The current-chapter idx is reset per load so the next item re-dispatches fresh.
  const reset = src.slice(src.indexOf('function resetSeekVisual()'), src.indexOf('function resetSeekVisual()') + 700);
  assert.match(reset, /currentChapterIdx = -1;/, 'current chapter reset on every load');
});

test('v1.109 source-lock: PLAY no longer closes the chapters menu (follow-along), pause/seeking still do', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  // The play listener dismisses ONLY the speed picker now, so the chapters menu
  // survives play and can follow along. pause/seeking still close both popups.
  assert.match(src, /mediaPlayer\.addEventListener\('play', closeSpeedMenu\);/, 'play closes only the speed picker');
  assert.doesNotMatch(src, /mediaPlayer\.addEventListener\('play', closeChaptersMenu\);/, 'play must NOT close the chapters menu');
  assert.match(src, /mediaPlayer\.addEventListener\('pause', closeChaptersMenu\);/, 'pause still closes');
  assert.match(src, /mediaPlayer\.addEventListener\('seeking', closeChaptersMenu\);/, 'seeking still closes');
});

test('v1.109 source-lock: the current-chapter menu row is styled red (the follow-along colour)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.chapters-menu-item-current \{[^}]*color: var\(--yt-red\);/, 'current row text is --yt-red');
});

// ---- v1.109 T3: seek-bar segmentation math (chapterBoundaryPercents) ---------
test('chapterBoundaryPercents: interior boundaries only, as % of total; first-start(0) and out-of-range excluded', () => {
  const chapters = [{ startTime: 0 }, { startTime: 60 }, { startTime: 200 }];
  const gaps = chapterBoundaryPercents(chapters, 300);
  assert.deepStrictEqual(gaps.map((g) => g.index), [1, 2], 'chapter 0 (start 0) is not an interior gap');
  assert.strictEqual(gaps[0].pct, 20);
  assert.ok(Math.abs(gaps[1].pct - (200 / 300) * 100) < 1e-9);
});

test('chapterBoundaryPercents: excludes a start at/after total, skips malformed, empty for bad total/non-array', () => {
  assert.deepStrictEqual(chapterBoundaryPercents([{ startTime: 0 }, { startTime: 300 }], 300), [], 'a start == total is not interior');
  assert.deepStrictEqual(chapterBoundaryPercents([{ startTime: 0 }, { startTime: 400 }], 300), [], 'a start > total is excluded');
  const skipped = chapterBoundaryPercents([{ startTime: 0 }, { startTime: 'x' }, { startTime: 150 }], 300);
  assert.deepStrictEqual(skipped.map((g) => g.index), [2], 'malformed startTime skipped, valid one kept');
  assert.deepStrictEqual(chapterBoundaryPercents([{ startTime: 60 }], 0), [], 'zero total');
  assert.deepStrictEqual(chapterBoundaryPercents([{ startTime: 60 }], NaN), [], 'non-finite total');
  assert.deepStrictEqual(chapterBoundaryPercents(null, 300), [], 'non-array');
});

test('v1.109 source-lock: the seek-bar segment overlay is JS-built, aligned, rebuilt on duration/chapter change, and hidden when docked', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  // Built in JS + appended into the positioned .player-controls (no shell edits,
  // out of the flex flow -- the two-row order layout stays untouched).
  assert.match(src, /seekChaptersEl\.className = 'seek-chapters';/, 'overlay is JS-built');
  assert.match(src, /playerControls\.appendChild\(seekChaptersEl\);/, 'appended into the positioned control strip');
  // Notches use the pure boundary math; rebuilt when duration becomes known and
  // on chapter-set change; kept aligned by a ResizeObserver.
  const build = src.slice(src.indexOf('function buildSeekChapters()'), src.indexOf('function buildSeekChapters()') + 900);
  assert.match(build, /chapterBoundaryPercents\(currentChapters, seekTotalDuration\(\)\)/, 'notches from the pure boundary math');
  assert.match(src, /addEventListener\('durationchange', function \(\) \{ if \(!isScrubbing\) updateSeekVisual\(\); buildSeekChapters\(\); \}\);/, 'rebuilt on durationchange');
  assert.match(src, /buildSeekChapters\(\);/, 'rebuilt on chapter-set change (applyChaptersForMedia)');
  assert.match(src, /seekChaptersRO = new ResizeObserver\(function \(\) \{ positionSeekChapters\(\); \}\);/, 'kept aligned by a ResizeObserver');
  // Cleared with the rest of the chapters UI on a chapter-less reset (the clear
  // line is unique to resetChaptersUi, so match it against the whole source --
  // slicing from 'resetChaptersUi = function ()' hits the no-op STUB first).
  assert.match(src, /if \(seekChaptersEl\) \{ seekChaptersEl\.replaceChildren\(\); seekChaptersEl\.hidden = true; \}/, 'segments cleared on reset');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /#player-dock \.seek-chapters \{ display: none; \}/, 'segments hidden in the docked mini-player');
  assert.match(css, /\.seek-chapters-gap \{[^}]*background-color: var\(--header-bg\);/, 'gap notch is the bar colour');
});

test('v1.109 source-lock: T4 the scrub preview names the hovered chapter, independent of the thumbnail', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  assert.match(src, /seekPreviewChapterEl\.className = 'seek-preview-chapter';/, 'the chapter-name line is built');
  const fn = src.slice(src.indexOf('function updateSeekPreview(clientX)'), src.indexOf('function updateSeekPreview(clientX)') + 2600);
  // The chapter name comes from the resolver at the HOVERED time t, not the
  // playhead, and is computed regardless of the storyboard (audio-with-chapters
  // still names the section).
  assert.match(fn, /var chIdx = currentChapters\.length \? currentChapterIndex\(currentChapters, t\) : -1;/, 'chapter resolved at the hovered t');
  // The preview shows when EITHER a thumbnail OR a chapter name is available --
  // deleting the chapter half must not resurrect the old storyboard-only bail.
  assert.match(fn, /if \(!showThumb && !chapterName\) \{ hideSeekPreview\(\); return; \}/, 'shows on thumb OR chapter (audio-with-chapters gets the name)');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.seek-preview-chapter \{[^}]*text-overflow: ellipsis;/, 'the chapter name ellipsizes');
  assert.match(css, /\.seek-preview-img\[hidden\],\s*\.seek-preview-chapter\[hidden\] \{ display: none !important; \}/, 'both toggled elements pin display:none (the [hidden]-loses lesson)');
});

test('v1.109 source-lock: T5 the persistent current-chapter title chip', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  assert.match(src, /chapterNowEl\.className = 'chapter-now';/, 'the chip is JS-built');
  // Shown only for a genuinely chaptered item (>1) while in a chapter; text is
  // "> Title" (U+203A punctuation, iOS-safe).
  const fn = src.slice(src.indexOf('function updateChapterNowChip()'), src.indexOf('function updateChapterNowChip()') + 500);
  assert.match(fn, /var show = currentChapters\.length > 1 && !!ch;/, 'chip shows only for a >1-chapter item in a chapter');
  assert.match(fn, /chapterNowEl\.textContent = '› ' \+ \(ch\.title \|\| 'Chapter'\);/, 'chip text is "> Title"');
  // Refreshed on a chapter-set change (load/edit) past the dispatch no-op, and
  // hidden on the per-load reset (no stale "> Old" flash).
  assert.match(src, /currentChapterIdx = -1;\s*\n\s*updateChapterLoopIndicator\(\);\s*\n\s*buildChaptersMenu\(\);/, 'chapter-set change resets idx so refreshCurrentChapter re-renders');
  assert.match(src, /refreshCurrentChapter\(\);/, 'chapter-set change re-dispatches from the live position');
  const reset = src.slice(src.indexOf('function resetSeekVisual()'), src.indexOf('function resetSeekVisual()') + 700);
  assert.match(reset, /currentChapterIdx = -1;\s*\n\s*updateChapterNowChip\(\);/, 'chip hidden on per-load reset');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  // Height-agnostic anchor (bottom:100%) so it clears the 40/80/26px bars without
  // arithmetic; hidden when docked.
  assert.match(css, /\.chapter-now \{[^}]*bottom: 100%;/, 'chip anchored above the bar via bottom:100% (no height math)');
  assert.match(css, /#player-dock \.chapter-now \{ display: none; \}/, 'chip hidden in the docked mini-player');
});

test('v1.41.12/v1.108 source-lock: per-row Loop toggle in the menu + styles present (resting word label, armed ∞, fixed width)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  // v1.108 (Dean): resting label is the WORD "Loop" (the v1.39 iOS-glyph lesson
  // still holds for the pictographic transport glyphs); the ARMED label is
  // U+221E INFINITY -- a Mathematical Operator with no emoji-presentation
  // variant, so iOS renders it as plain text. It rides a fixed-width label span.
  assert.match(src, /loopLabel\.textContent = isLooping \? '∞' : 'Loop';/, 'armed = ∞ (U+221E), resting = "Loop" word');
  assert.match(src, /loopLabel\.className = 'chapters-menu-loop-label';/, 'the fixed-width label span carries the glyph');
  assert.match(src, /loopBtn\.addEventListener\('click', function \(e\) \{\s*e\.stopPropagation\(\);/, 'loop tap never triggers the row seek');
  assert.match(src, /armChapterLoop\(index, \{ rebuild: true, seekIn: true \}\)/, 'arming from outside the chapter seeks into it');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.chapters-menu-row \{\s*display: flex;/, 'row layout');
  assert.match(css, /#chapters-btn\.chapter-looping \{/, 'bar-level armed indicator');
  assert.match(rt(css), /\.chapters-menu-loop \{[\s\S]*?min-height: 44px;/, 'mobile tap target for the toggle');
  // The fixed-width label is what keeps the row's border aligned across loop
  // states; without it the Loop<->∞ swap would reflow the button. Delete the
  // `min-width` and this goes red.
  assert.match(css, /\.chapters-menu-loop-label \{[^}]*min-width: 4\.5ch;[^}]*text-align: center;/, 'fixed-width centered label so Loop<->∞ never reflows the row');
  // v1.108 gate WARNING T2-W1: the reservation is in `ch`, which is the advance
  // of the digit "0" in the CURRENT weight. If the label ever inherits the
  // armed `.active` bold, its `ch` recomputes against the bold digit and the
  // button widens ~1-2px on variable-weight fonts (Geist) -- reintroducing the
  // exact border shift this fix kills. `font-weight: normal` on the label pins
  // that. Drop it (or re-bold `.active`) and the residual returns.
  // Block-anchored (`[^}]*`, not `[\s\S]*?`): `font-weight: normal;` recurs all
  // over style.css, so a lazy cross-block match would find a LATER one and pass
  // even with the label's pin deleted (caught in the fix round). `[^}]*` stops
  // at the block's own `}`, so this only matches the pin INSIDE the label rule.
  assert.match(css, /\.chapters-menu-loop-label \{[^}]*font-weight: normal;/, 'label weight pinned so the armed state cannot widen the ch reservation (T2-W1)');
  assert.doesNotMatch(css, /\.chapters-menu-loop\.active \{[^}]*font-weight/, 'the armed state must NOT bold the width-reserving label (T2-W1 root cause)');
});

// ---- v1.41.12 gate fix round: locks for the round-1 findings ----------------

test('gate C1: armChapterLoop trusts ONLY currentData.duration in liveMode (the thrice-documented segment-duration contract)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  const fnStart = src.indexOf('function armChapterLoop(index, opts)');
  assert.ok(fnStart >= 0);
  const body = src.slice(fnStart, fnStart + 1800);
  assert.match(body, /var dur = liveMode\s*\? \(currentData && currentData\.duration\)\s*:/,
    'liveMode must never consult el.duration (the transcoded-so-far segment) for the last chapter\'s end');
  assert.match(body, /if \(!bounds\) \{[\s\S]*?showToast\(/, 'a refused arm is VISIBLE, never a silent no-op');
});

test('gate W3: every explicit-seek commit point disarms an out-of-bounds chapter loop (scrub, skip live+non-live, digits live+non-live)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  const calls = src.match(/disarmChapterLoopIfSeekOutside\(/g) || [];
  assert.ok(calls.length >= 7, `helper + 6 call sites expected (incl. the MediaSession seekto lock-screen scrubber -- delta R2), found ${calls.length} references`);
  assert.match(src, /setMediaSessionAction\('seekto', function \(details\) \{[\s\S]*?disarmChapterLoopIfSeekOutside\(details\.seekTime\);/,
    'the lock-screen scrubber disarms before it seeks');
  const helper = src.slice(src.indexOf('function disarmChapterLoopIfSeekOutside('), src.indexOf('function disarmChapterLoopIfSeekOutside(') + 900);
  assert.match(helper, /targetAbs < chapterLoop\.start \|\| targetAbs >= chapterLoop\.end/, 'outside = strictly outside [start, end)');
  assert.match(helper, /chaptersBtn\.classList\.remove\('chapter-looping'\)/, 'the bar tint clears with the disarm');
});

test('gate round-1 polish locks: menu rebuilds on every open; loop seek-in never closes the menu; close() clears the loop', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  assert.match(src, /if \(opening\) buildChaptersMenu\(\);/, 'open re-derives Loop labels (a controller-level disarm cannot reach the builder)');
  assert.match(src, /if \(now < bounds\.start \|\| now >= bounds\.end\) seekToChapterTime\(bounds\.start\);/,
    'arming seeks via the no-close variant');
  // Anchor on close()'s unique v1.27.2 sibling-clear comment (a bare
  // 'function close() {' matches an unrelated earlier closure).
  const anchor = src.indexOf('prePauseCandidateAt = 0; // v1.27.2: mirrors teardownMediaState');
  assert.ok(anchor >= 0, 'close()\'s defense-in-depth block exists');
  const closeBody = src.slice(anchor, anchor + 500);
  assert.ok(closeBody.includes('chapterLoop = null;'), 'defense-in-depth clear in close(), matching its sibling flags');
});

test('gate S1: sub-half-second loop windows are refused by the resolver (epsilon-churn guard)', () => {
  assert.strictEqual(resolveChapterLoopBounds([{ startTime: 10 }, { startTime: 10.04 }], 0, 100), null, '0.04s window refused');
  assert.strictEqual(resolveChapterLoopBounds([{ startTime: 10 }, { startTime: 10.5 }], 0, 100), null, 'exactly 0.5s refused (boundary)');
  assert.deepStrictEqual(resolveChapterLoopBounds([{ startTime: 10 }, { startTime: 10.6 }], 0, 100), { start: 10, end: 10.6 }, '0.6s allowed');
});
