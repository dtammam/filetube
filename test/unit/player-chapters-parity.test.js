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
  assert.match(playerSrc, /function seekToChapter\(t\) \{[\s\S]*?startLiveStream\(t, true\)/, 'a chapter pick in live mode must route through startLiveStream (the reload-seek path)');
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
  assert.match(css, /#player-slot \.player-controls \.pc-seek \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-width: calc\(100% - 170px\);/, 'the seek bar owns its row (v1.34.2: hard min-width)');
  assert.match(css, /#player-slot #player-wrapper:not\(\.audio-expanded\) \{\s*padding-bottom: 80px;/, 'the reserved strip matches the two-row bar');
  assert.match(css, /#player-slot #player-wrapper:not\(\.audio-expanded\)\.native-controls \{\s*padding-bottom: 0;/, 'native mode still removes the strip (outranks the 2-ID reservation)');
});

// ---- v1.34.2 (Dean round 2): dismissal braces + faux fullscreen -------------
test('v1.34.2: the chapters menu has an explicit close (header ✕), touchstart/play-pause-seek dismissal braces, and custom-mode mobile fullscreen is the CSS faux path', () => {
  assert.ok(playerSrc.includes("closeBtn.className = 'chapters-menu-close'"), 'an explicit ✕ close button in the menu header');
  assert.ok(playerSrc.includes("document.addEventListener('touchstart', closeChaptersMenuOnOutside, { passive: true })"), 'touchstart fallback (iOS click/pointer synthesis quirks)');
  assert.ok(playerSrc.includes("mediaPlayer.addEventListener('play', closeChaptersMenu)"), 'any playback interaction closes the menu');
  assert.ok(playerSrc.includes("host.classList.toggle('css-fullscreen')"), 'custom-mode mobile fullscreen toggles the CSS faux-fullscreen (iPhone element-fullscreen is native-only)');
  assert.ok(playerSrc.includes("if (state !== STATE_FULL) host.classList.remove('css-fullscreen')"), 'docking/closing drops the fixed overlay');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /#player-wrapper\.css-fullscreen \{\s*position: fixed;\s*inset: 0;/, 'the faux-fullscreen host treatment');
  assert.match(css, /#player-wrapper\.css-fullscreen:not\(\.audio-expanded\) #media-player \{\s*aspect-ratio: auto;/, 'the aspect pin releases in faux fullscreen');
  // Ordering: the css-fullscreen media rule must come AFTER the portrait
  // 16:9 pin (equal specificity -- later wins).
  const pinIdx = css.indexOf('#player-wrapper.portrait-media:not(.audio-expanded) #media-player');
  const fsIdx = css.indexOf('#player-wrapper.css-fullscreen:not(.audio-expanded) #media-player');
  assert.ok(pinIdx >= 0 && fsIdx > pinIdx, 'css-fullscreen must outrank the portrait pin by order');
  // Row exclusivity (round 2): the seek bar owns its row via hard min-width.
  assert.match(css, /min-width: calc\(100% - 170px\);/, 'the scrub row cannot be shared by buttons');
});
