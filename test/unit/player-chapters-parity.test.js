'use strict';

// [UNIT] v1.34 T3 (Dean, chapters) -- five-shell parity for the chapter
// picker: `#chapters-btn` + `#chapters-menu` must be byte-identical in every
// shell's #player-host-template (same rationale as
// test/unit/player-cc-btn-parity.test.js: the persistent host is cloned once
// from whichever shell booted the session, so a shell missing the markup
// would strand that whole session without a chapters UI). Plus source-lock
// guards on the player wiring and the drag-scrub CSS half.
const { test } = require('node:test');
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
  assert.ok(playerSrc.includes("mediaPlayer.addEventListener('play', closeChaptersMenu)"), 'any playback interaction closes the menu');
  assert.ok(playerSrc.includes("setCssFullscreen(!host.classList.contains('css-fullscreen'))"), 'custom-mode mobile fullscreen toggles the CSS faux-fullscreen (iPhone element-fullscreen is native-only)');
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
  assert.match(css, /#player-wrapper\.css-fullscreen \{[\s\S]*?z-index: 1500;/, 'above header (1000) and .bottom-nav (900), below modals (2000)');
  assert.match(css, /body\.ft-css-fullscreen \{\s*overflow: hidden;/, 'page scroll frozen (the landscape gap)');
  assert.match(css, /body\.ft-css-fullscreen header,\s*body\.ft-css-fullscreen \.bottom-nav \{\s*visibility: hidden;/, 'chrome explicitly hidden');
  assert.match(css, /#player-wrapper\.css-fullscreen:not\(\.audio-expanded\) \{\s*padding-bottom: 0 !important;/, 'the bar OVERLAYS the picture in faux fullscreen (no strip mismatch)');
  assert.match(css, /#player-wrapper\.css-fullscreen \.player-controls \{\s*height: auto;[\s\S]*?env\(safe-area-inset-bottom/, 'the bar grows for the home indicator instead of clipping its buttons row');
  assert.ok(playerSrc.includes('function setCssFullscreen(on)'), 'host + body classes move together');
});

// ---- v1.34.5 (Dean round 5): the iOS rotate-to-native-fullscreen hijack -----
test('v1.34.5: rotating a playing video to landscape in CUSTOM mode bounces out of the native player into faux fullscreen; the fullscreen bar blends into black', () => {
  assert.ok(playerSrc.includes("mediaPlayer.addEventListener('webkitbeginfullscreen'"), 'the hijack listener exists');
  assert.match(playerSrc, /webkitbeginfullscreen', function \(\) \{[\s\S]*?webkitExitFullscreen\(\);[\s\S]*?setCssFullscreen\(true\);/,
    'custom mode bounces the native auto-fullscreen and grants faux fullscreen instead');
  assert.match(playerSrc, /webkitbeginfullscreen', function \(\) \{\s*if \(!isMobileFormFactor\(\) \|\| inNativeControlsMode\(\)\) return;/,
    'native-controls mode keeps the native rotation fullscreen untouched');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /#player-wrapper\.css-fullscreen \.player-controls \{[\s\S]*?background: rgba\(0, 0, 0, 0\.75\);/,
    'the fullscreen bar blends into the black canvas (no themed band at the bottom)');
});

// ---- v1.34.6 (Dean): audio expanded-view bar/art geometry -------------------
test('v1.34.6: the expanded audio bar is flush to the bottom edge (safe-area INSIDE it) and the art canvas ends above the bar in both bar layouts', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /#player-wrapper\.audio-mode\.audio-expanded \.player-controls \{[\s\S]*?bottom: 0;[\s\S]*?padding-bottom: calc\(4px \+ env\(safe-area-inset-bottom, 0px\)\);/,
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
  assert.match(block, /\.chapters-menu-item \{[\s\S]*?min-height: 44px;[\s\S]*?white-space: normal;[\s\S]*?-webkit-line-clamp: 2;/,
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

const { resolveChapterLoopBounds } = require('../../public/js/player.js');

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

test('v1.41.12 source-lock: per-row Loop toggle in the menu + styles present (word label, never a glyph)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  assert.match(src, /loopBtn\.textContent = isLooping \? 'Looping' : 'Loop';/, 'text label (iOS glyph lesson)');
  assert.match(src, /loopBtn\.addEventListener\('click', function \(e\) \{\s*e\.stopPropagation\(\);/, 'loop tap never triggers the row seek');
  assert.match(src, /armChapterLoop\(index, \{ rebuild: true, seekIn: true \}\)/, 'arming from outside the chapter seeks into it');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.chapters-menu-row \{\s*display: flex;/, 'row layout');
  assert.match(css, /#chapters-btn\.chapter-looping \{/, 'bar-level armed indicator');
  assert.match(css, /\.chapters-menu-loop \{[\s\S]*?min-height: 44px;/, 'mobile tap target for the toggle');
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
