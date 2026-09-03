'use strict';

// [UNIT] Mobile music player skins - the PURE framework (public/js/music-skins.js):
// registry, the mobile+music gate, the per-device setting, and that each skin's
// renderFull emits the STABLE data-skin-* proxy hooks (the view wires those to the
// player's existing controls). Presentation only - no engine here to test.

const { test } = require('node:test');
const assert = require('node:assert');
const skins = require('../../public/js/music-skins.js');

const CTX = {
  track: { title: 'Track A', artist: 'NESTALGIA', album: 'Retro Mix', artUrl: '/albumart/djmix1::c1' },
  upNext: [
    { index: 0, title: 'Intro', durLabel: '0:42', state: 'played' },
    { index: 1, title: 'Track A', durLabel: '5:37', state: 'current' },
    { index: 2, title: 'Track B', durLabel: '4:51', state: 'next' },
  ],
  playing: true, posSec: 96, durSec: 337, posLabel: '1:36', remLabel: '-4:01',
};

test('registry exposes the five skins with render funcs (incl. the v1.232 black iPod and the v1.259 Seattle/zune)', () => {
  assert.deepStrictEqual(skins.IDS, ['apple', 'spotify', 'ipod', 'ipod-black', 'zune']);
  assert.strictEqual(skins.DEFAULT_ID, 'apple');
  for (const id of skins.IDS) {
    const s = skins.skinById(id);
    assert.ok(s && typeof s.renderFull === 'function', id + ' has renderFull');
    assert.ok(typeof s.label === 'string' && s.label, id + ' has a label');
  }
  // the black iPod shares the silver iPod's render + declares a `base` so the panel
  // also carries the shared .mms-ipod CSS class (music.js reads it).
  assert.strictEqual(skins.skinById('ipod-black').base, 'ipod', 'black iPod bases on the silver iPod CSS');
  assert.strictEqual(skins.skinById('ipod-black').renderFull, skins.skinById('ipod').renderFull, 'same render, different palette');
  // v1.232.1 (Dean): the labels are CHEEKY riffs, deliberately NOT the real product /
  // company names (the IDS stay literal for CSS/storage).
  const labels = skins.IDS.map((id) => skins.skinById(id).label);
  assert.deepStrictEqual(labels, ['Cider', 'Nordic', 'Pocket Classic', 'Pocket Classic (Black)', 'Seattle']);
  for (const l of labels) {
    assert.ok(!/apple|spotify|ipod|zune|microsoft/i.test(l), 'label "' + l + '" avoids the real product/company names');
  }
});

test('v1.232.1: the iPod LCD is height-capped so a long song list scrolls INSIDE it (not out of bounds)', () => {
  // Device bug (Dean): pressing Select opened the list and the LCD grew past its 4:3
  // box. A flex item's default min-height:auto lets tall content force growth; the cap
  // is min-height:0 + overflow:hidden on .ip-lcd (the list scrolls in .ip-listview).
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  const m = /\.mms-ipod \.ip-lcd\{([^}]*)\}/.exec(css);
  assert.ok(m, 'the .ip-lcd rule exists');
  assert.match(m[1], /min-height:\s*0/, 'min-height:0 caps the flex item at its 4:3 aspect');
  assert.match(m[1], /overflow:\s*hidden/, 'overflow:hidden clips at the LCD box');
  assert.match(m[1], /contain:\s*size/, 'contain:size -> content can NEVER resize the LCD (Dean: never resize)');
});

test('v1.232.3: the full-screen skin LOCKS page scroll (touch-action) - only the list/queue pan', () => {
  // Device bug (Dean): dragging the skin body scrolled the page behind it - body
  // overflow:hidden does not stop iOS touch-scroll. touch-action:none on the fixed
  // panel does; the scrollable regions re-enable vertical panning with pan-y.
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  const full = /\.mms-full\{([^}]*)\}/.exec(css);
  assert.ok(full && /touch-action:\s*none/.test(full[1]), '.mms-full has touch-action:none (page cannot scroll behind the overlay)');
  const list = /\.mms-ipod \.ip-listview\{([^}]*)\}/.exec(css);
  assert.ok(list && /touch-action:\s*pan-y/.test(list[1]), 'the iPod song list re-enables vertical pan');
  const q = /\.mms-spotify \.mms-qlist\{([^}]*)\}/.exec(css);
  assert.ok(q && /touch-action:\s*pan-y/.test(q[1]), 'the Spotify queue re-enables vertical pan');
});

test('the per-device setting round-trips and normalizes junk to the default', () => {
  const bag = {}; const store = { getItem: (k) => (k in bag ? bag[k] : null), setItem: (k, v) => { bag[k] = v; } };
  assert.strictEqual(skins.activeSkinId(store), 'apple', 'unset -> default');
  skins.setActiveSkin('spotify', store);
  assert.strictEqual(bag[skins.SKIN_KEY], 'spotify');
  assert.strictEqual(skins.activeSkinId(store), 'spotify');
  skins.setActiveSkin('bogus', store);
  assert.strictEqual(skins.activeSkinId(store), 'apple', 'junk id normalizes to default');
});

test('the GATE is true for mobile + a music item (desktop / non-audio are default chrome)', () => {
  assert.strictEqual(skins.skinActiveFor({ isMusic: true }, true), true, 'mobile + music -> skin');
  assert.strictEqual(skins.skinActiveFor({ isMusic: true }, false), false, 'desktop + music -> default');
  assert.strictEqual(skins.skinActiveFor({ isMusic: false }, true), false, 'mobile + NON-audio (video/book) -> default');
  assert.strictEqual(skins.skinActiveFor(null, true), false, 'nothing playing -> default');
});

test('v1.245: the GATE also engages for a PODCAST episode (resumeMode==="podcast"), mobile only', () => {
  assert.strictEqual(skins.skinActiveFor({ isMusic: false, resumeMode: 'podcast' }, true), true, 'mobile + podcast -> skin');
  assert.strictEqual(skins.skinActiveFor({ isMusic: false, resumeMode: 'podcast' }, false), false, 'desktop + podcast -> default');
  assert.strictEqual(skins.skinActiveFor({ isMusic: false, resumeMode: 'tv' }, true), false, 'mobile + tv (a non-audio resumeMode) -> default');
  assert.strictEqual(skins.skinActiveFor({ isMusic: false, resumeMode: '' }, true), false, 'mobile + a plain non-audio item -> default');
});

test('v1.244: the art SLOT carries --art (blurred self-bleed) when there is art, none without', () => {
  assert.match(skins.renderFull('apple', CTX), /class="mms-art" style="--art:url\(/, 'apple art slot carries --art');
  assert.match(skins.renderFull('spotify', CTX), /class="mms-art" style="--art:url\(/, 'spotify art slot carries --art');
  assert.match(skins.renderFull('ipod', CTX), /class="ip-cover" style="--art:url\(/, 'ipod ip-cover carries --art');
  assert.doesNotMatch(skins.renderFull('apple', { track: { title: 'X' } }), /--art:/, 'no --art when there is no artUrl');
});

test('v1.244 source-lock (CSS): the skin art is object-fit:contain with a blurred ::before self-bleed from --art', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.mms-full \.mms-art img\{[^}]*object-fit:contain/, 'shared art img shows the WHOLE art (contain)');
  assert.match(css, /\.mms-full \.mms-art::before\{[^}]*background-image:var\(--art, none\)[^}]*filter:blur/, 'a blurred self-bleed backdrop from --art');
  assert.match(css, /\.mms-ipod \.ip-cover img\{[^}]*object-fit:contain/, 'ipod cover is contain too');
  assert.match(css, /\.mms-ipod \.ip-cover::before\{[^}]*background-image:var\(--art, none\)/, 'ipod cover has the backdrop');
});

test('every skin renderFull emits the core transport hooks + shared reflect targets (not vacuous)', () => {
  for (const id of skins.IDS) {
    const html = skins.renderFull(id, CTX);
    assert.match(html, /data-skin-play/, id + ': play hook (proxies to #pp-btn)');
    assert.match(html, /data-skin-prev/, id + ': prev hook');
    assert.match(html, /data-skin-next/, id + ': next hook');
    assert.ok(html.includes('Track A'), id + ': shows the current title');
    assert.match(html, /width:\s*[\d.]+%/, id + ': scrubber fill reflects position');
    // reflect targets music.js queries every timeupdate, shared by all skins.
    assert.match(html, /class="mms-fill"/, id + ': .mms-fill reflect target');
    assert.match(html, /class="mms-pos"/, id + ': .mms-pos reflect target');
    assert.match(html, /class="mms-rem"/, id + ': .mms-rem reflect target');
  }
});

test('per-skin controls: Apple/Spotify have a swap-glyph play + collapse + tap-seek; iPod is the click wheel plus a tap-seek LCD bar (v1.258.1)', () => {
  const apple = skins.renderFull('apple', CTX);
  const spotify = skins.renderFull('spotify', CTX);
  const ipod = skins.renderFull('ipod', CTX);
  for (const [id, html] of [['apple', apple], ['spotify', spotify]]) {
    assert.match(html, /class="mms-play"/, id + ': the big play (reflectSkin swaps its glyph)');
    assert.match(html, /data-skin-collapse/, id + ': grab/chevron dismiss');
    assert.match(html, /data-skin-seek/, id + ': tap-to-seek bar');
  }
  assert.match(spotify, /data-skin-shuffle/, 'spotify wires the REAL shuffle (-> #music-shuffle-btn)');
  // iPod click wheel: MENU (back/exit) + Select (list), a status-bar play indicator,
  // NO collapse chevron, NO swap-glyph .mms-play. v1.258.1 (Dean, via the tray): the LCD
  // bar gained tap-to-seek like the other skins - the wheel stays the PRIMARY scrub, the
  // bar is the direct one (and the wheel-less tray's only one).
  assert.match(ipod, /data-skin-menu/, 'iPod: MENU zone (back / exit)');
  assert.match(ipod, /data-skin-select/, 'iPod: Select zone (list toggle)');
  assert.match(ipod, /class="mms-playind"/, 'iPod: status-bar play indicator (reflect target)');
  assert.match(ipod, /data-skin-seek/, 'iPod: the LCD bar is tap-to-seek since v1.258.1 (was display-only)');
  // v1.259 (slim W4): the Seattle/zune controls - the collapse button is the skin's
  // ONLY exit (no MENU zone), so its absence would trap the user full-screen.
  const zune = skins.renderFull('zune', CTX);
  assert.match(zune, /class="mms-play"/, 'zune: the swap-glyph play');
  assert.match(zune, /data-skin-collapse/, 'zune: the collapse exit (the ONLY way out)');
  assert.match(zune, /data-skin-seek/, 'zune: tap-to-seek bar');
  assert.ok(!/data-skin-collapse/.test(ipod), 'iPod exits via MENU, not the collapse chevron');
  assert.ok(!/class="mms-play"/.test(ipod), 'iPod has no swap-glyph play (the wheel bottom keeps its ▶❚❚)');
});

test('the skins with a list (spotify queue, ipod song list) render jump-by-index rows; apple is art-only', () => {
  for (const id of ['spotify', 'ipod']) {
    const html = skins.renderFull(id, CTX);
    assert.match(html, /data-skin-go="2"/, id + ': list rows jump by queue index');
    assert.match(html, /is-current/, id + ': the current row is marked');
  }
  const apple = skins.renderFull('apple', CTX);
  assert.ok(!/data-skin-go=/.test(apple), 'apple renders no list');
});

test('v1.232.5/v1.233: opening the iPod list seeds the cursor on the CURRENT song and scrolls it into view (source lock)', () => {
  // jsdom has no layout, so lock the scroll GLUE in source (mirrors the default panel's
  // scroll-to-current lock). v1.233 refactor: setIpodListMode SEEDS the cursor on the
  // current row (and clears it on close), delegating the actual scroll to setWheelCursor,
  // which holds the rAF-deferred, container-offsetTop-normalized scrollTop write (never
  // scrollIntoView -> that would scroll the page behind the fixed skin).
  const fs = require('node:fs'); const path = require('node:path');
  // v1.250 (F-UNIFY): list-mode/cursor moved to the shared engine (same discipline, new home).
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  const lm = /function setListMode\(on\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(lm, 'setListMode exists');
  const lmBody = lm[1];
  assert.match(lmBody, /\.ip-listview/, 'reads the list container');
  assert.match(lmBody, /is-current/, 'seeds the cursor from the CURRENT row');
  assert.match(lmBody, /setWheelCursor\([^,]+,\s*true\)/, 'centers the seeded cursor on open (setWheelCursor(..., true))');
  assert.match(lmBody, /is-cursor[\s\S]*remove|remove[\s\S]*is-cursor/, 'clears the cursor highlight on close');

  const wc = /function setWheelCursor\(pos, center\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(wc, 'setWheelCursor exists');
  const wcBody = wc[1];
  assert.match(wcBody, /\.ip-listview/, 'scrolls the list container');
  assert.match(wcBody, /classList\.toggle\('is-cursor'/, 'paints .is-cursor on exactly the cursor row');
  // the scroll write must be INSIDE the rAF callback (deferred past the display:none->block
  // layout) - not merely that a raf helper is declared (that would be vacuous).
  assert.match(wcBody, /raf\(function[\s\S]*?\.scrollTop\s*=/, 'the scrollTop write runs inside the rAF callback (deferred)');
  assert.match(wcBody, /el\.offsetTop\s*-\s*lv\.offsetTop/, 'normalizes by the container offsetTop (static list)');
  assert.ok(!/scrollIntoView/.test(wcBody), 'NOT scrollIntoView (that would scroll the page behind)');
});

test('v1.232.5: the iPod list renders ctx.fullList (whole album, reach earlier songs); Spotify uses upNext', () => {
  const ctx = Object.assign({}, CTX, {
    upNext: [{ index: 5, title: 'Up A', durLabel: '1:00', state: 'current' }, { index: 6, title: 'Up B', durLabel: '2:00', state: 'next' }],
    fullList: [{ index: 0, title: 'Album First', durLabel: '0:30', state: 'played' }, { index: 5, title: 'Up A', durLabel: '1:00', state: 'current' }],
  });
  const ipod = skins.renderFull('ipod', ctx);
  assert.match(ipod, /Album First/, 'iPod list includes the album-start song (from fullList)');
  assert.match(ipod, /data-skin-go="0"/, 'iPod list has song index 0 - scroll-up can reach the start');
  const spotify = skins.renderFull('spotify', ctx);
  assert.ok(!/Album First/.test(spotify), 'Spotify "Next in queue" uses upNext (upcoming), not the whole album');
  assert.match(spotify, /Up A/, 'Spotify shows the upNext rows');
});

test('the iPod skin renders the Classic Now Playing (artist/album/N-of-M + wheel), no chrome knob', () => {
  const html = skins.renderFull('ipod', Object.assign({}, CTX, { curNum: 2, total: 3 }));
  assert.match(html, /NESTALGIA/, 'artist shown (Now Playing meta)');
  assert.match(html, /Retro Mix/, 'album shown');
  assert.match(html, /2 of 3/, 'the "N of M" position');
  assert.match(html, /ip-wheel/, 'the click wheel');
  assert.ok(!/mms-knob/.test(html), 'the old chrome knob is gone (display-only scrubber)');
  // v1.231.1 (Dean): the wheel prev/next/play use SVG line-glyphs, NOT the unicode
  // skip chars (which iOS renders as blue emoji). Guard against a regression to emoji.
  const zones = html.slice(html.indexOf('ip-wheel'));
  assert.match(zones, /data-skin-prev[^>]*><svg/, 'rewind is an SVG glyph');
  assert.match(zones, /data-skin-next[^>]*><svg/, 'fast-forward is an SVG glyph');
  assert.match(zones, /data-skin-play[^>]*><svg/, 'play/pause is an SVG glyph (not the emoji-prone ▶❚❚)');
  assert.ok(!/[⏮⏭]/.test(zones), 'no unicode skip chars (⏮/⏭) that iOS emoji-fies');
});

test('v1.229: NO in-player skin switcher - picking lives in the account menu now', () => {
  // The in-player chips were unreliable on-device (they vanished against some skins),
  // so skin picking moved to the account-menu segmented control. No render may emit
  // the old data-skin-set hook (else the dead in-panel handler would be reachable).
  for (const id of skins.IDS) {
    const html = skins.renderFull(id, CTX);
    assert.ok(!/data-skin-set/.test(html), id + ': no in-player switcher hook');
    assert.ok(!/mms-skinsw|mms-sw\b/.test(html), id + ': no switcher markup');
  }
  // The registry the Settings picker reads is still exported.
  assert.deepStrictEqual(skins.IDS, ['apple', 'spotify', 'ipod', 'ipod-black', 'zune']);
  assert.strictEqual(typeof skins.setActiveSkin, 'function');
  assert.strictEqual(skins.skinById('ipod').label, 'Pocket Classic', 'cheeky label (not the real product name) for the picker');
});

test('the pause glyph shows only when playing; play glyph when paused', () => {
  const playing = skins.renderFull('apple', Object.assign({}, CTX, { playing: true }));
  const paused = skins.renderFull('apple', Object.assign({}, CTX, { playing: false }));
  assert.match(playing, /aria-label="Pause"/, 'playing -> Pause affordance');
  assert.match(paused, /aria-label="Play"/, 'paused -> Play affordance');
});

test('EVERY skin render ESCAPES track/queue text (no HTML injection from a crafted tag/title)', () => {
  // v1.259 (slim W4): iterate ALL skins - the zune path LOWERCASES before escaping
  // (lc-then-esc), and a divergent single-skin fixture left that axis unbound.
  const evil = { track: { title: '<IMG SRC=x onerror=alert(1)>', artist: '"><b>', album: 'A&B', artUrl: '/x' },
    upNext: [{ index: 0, title: '<script>', durLabel: '', state: 'current' }],
    fullList: [{ index: 0, title: '<script>', durLabel: '', state: 'current' }], playing: false, posSec: 0, durSec: 100 };
  for (const id of skins.IDS) {
    const html = skins.renderFull(id, evil);
    assert.ok(!/<img src=x/i.test(html), id + ': the raw img tag never lands in the DOM');
    assert.ok(!/<script>/.test(html), id + ': the raw script never lands');
    assert.match(html, /&lt;img src=x/i, id + ': it is escaped (case per the skin\'s own text transform)');
  }
});

test('pct clamps position into 0..100 and guards a zero/absent duration', () => {
  assert.strictEqual(skins._pct(0, 0), 0);
  assert.strictEqual(skins._pct(50, 100), 50);
  assert.strictEqual(skins._pct(999, 100), 100, 'over-run clamps to 100');
  assert.strictEqual(skins._pct(10, 0), 0, 'zero duration -> 0, no NaN');
});

// ---- v1.233: the click-wheel ROTARY SCROLL gesture (safety source-locks) -------------
// The gesture is the v1.160/v1.163 scar class (non-passive touch listeners, latched
// direction, leaked capture). These lock the safe SHAPE in source (jsdom can't measure
// pointer-capture / passivity); the behavioral cursor moves are in music-skin-integration.
function wheelHandlerSrc() {
  // v1.250 (F-UNIFY): the gesture lives in the SHARED engine now (skin-surface.js - the one
  // implementation music AND podcasts run); these locks follow the code.
  const fs = require('node:fs'); const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  const m = /function onDown\(e\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'the wheel pointerdown handler (onDown) exists');
  return { js, body: m[1] };
}

test('v1.233: the wheel gesture uses POINTER events, never a global non-passive touch listener (v1.160.1 scar)', () => {
  const { js, body } = wheelHandlerSrc();
  assert.match(body, /pointermove/, 'tracks with pointermove');
  // no touchmove listener anywhere near the wheel gesture (the scroll-perf regression).
  assert.ok(!/addEventListener\('touchmove'/.test(js), 'no touchmove listener at all (pointer events carry no passivity penalty)');
  // move/up/cancel are bound on the WHEEL element (not document/window) - no global listener.
  assert.match(body, /wheel\.addEventListener\('pointermove'/, 'pointermove is bound to the wheel element, not document/window');
});

test('v1.233: pointer capture is taken LAZILY (only once confirmed a spin) so a plain tap keeps its click', () => {
  const { body } = wheelHandlerSrc();
  // the moved-flag flip and setPointerCapture live together inside the travel-threshold
  // guard - NOT unconditionally at pointerdown (which some browsers turn into a lost click).
  assert.match(body, /Math\.hypot\(ev\.clientX[\s\S]*?setPointerCapture/, 'capture is inside the "it moved" branch, not on bare pointerdown');
  // and the moved-flag flips in the same guard, so a tap (never crossing 8px) stays uncaptured.
  assert.match(body, /Math\.hypot\(ev\.clientX[^)]*\)[^>]*> 8[\s\S]*?st\.moved = true/, 'the moved flag flips only past the 8px travel threshold');
});

test('v1.233: every gesture end arm REMOVES the move/up/cancel listeners + releases capture (v1.163 teardown)', () => {
  const { js } = wheelHandlerSrc();
  const m = /function endWheel\(st, suppress\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'endWheel exists');
  const end = m[1];
  assert.match(end, /removeEventListener\('pointermove'/, 'removes pointermove');
  assert.match(end, /removeEventListener\('pointerup'/, 'removes pointerup');
  assert.match(end, /removeEventListener\('pointercancel'/, 'removes pointercancel');
  assert.match(end, /releasePointerCapture/, 'releases the pointer capture');
  // endWheel acts on the passed `st` and nulls wheelSpin ONLY if it still IS that st, so a
  // stale end-arm (a detached wheel's late pointerup after a re-render) can't tear down a
  // newer gesture (QA + the re-render guard below).
  assert.match(end, /if \(wheelSpin === st\) wheelSpin = null/, 'wheelSpin is nulled only when the ending gesture is still the live one');
  // pointerup AND pointercancel both route to the same end arm (a cancelled gesture leaks nothing).
  const { body } = wheelHandlerSrc();
  assert.match(body, /addEventListener\('pointercancel', st\.onUp\)/, 'pointercancel also ends the gesture (no leak on an interrupted spin)');
});

test('v1.233/v1.234: a re-render (track auto-advance) drops any mid-gesture wheelSpin (QA leak guard)', () => {
  // If the panel re-renders while a finger is down but before capture, the detached wheel's
  // pointerup never reaches endWheel; without this reset wheelSpin sticks and every later
  // spin bails on "one gesture at a time". The shared engine's paint() (v1.250: the ONE
  // render both surfaces and podcasts run) nulls it on every render.
  const fs = require('node:fs'); const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  const m = /function paint\(\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'the engine paint() exists');
  assert.match(m[1], /wheelSpin = null/, 'a render clears any stale mid-gesture state');
});

test('v1.233: onMove ignores a SECOND finger (pointerId filter - adversarial S1 device jitter)', () => {
  const { body } = wheelHandlerSrc();
  assert.match(body, /st\.onMove = function \(ev\) \{\s*if \(ev\.pointerId !== st\.id\) return;/, 'onMove bails on a pointerId that is not this gesture\'s');
});

test('v1.233: direction is re-evaluated every move (accum + sign per move), never latched (v1.160.3 scar)', () => {
  const { body } = wheelHandlerSrc();
  // the sign is computed from the LIVE accumulator each step, inside the while loop.
  assert.match(body, /var sign = st\.accum > 0 \? 1 : -1/, 'sign derives from the current accumulator, not a stored initial direction');
  assert.match(body, /st\.accum -= sign \* WHEEL_STEP_DEG/, 'the accumulator is drained per step (re-evaluated, not latched)');
});

test('v1.233: a fast flick ACCELERATES (songs-per-step scales with angular speed)', () => {
  const { body } = wheelHandlerSrc();
  assert.match(body, /var speed = Math\.abs\(d\) \/ dt/, 'computes angular speed (deg/ms)');
  assert.match(body, /var mult = speed > [\d.]+ \? \d/, 'a speed-scaled multiplier (fast flick jumps several songs)');
  assert.match(body, /setWheelCursor\(wheelCursorRow \+ sign \* mult/, 'the multiplier drives how many songs the cursor jumps');
});

test('v1.250 (Dean): ONE Now-Playing wheel behavior - SCRUB - on every surface; dead-center Select still passes through', () => {
  // Dean 2026-09-02 retired v1.235's pop-out wheel-volume ("make the classic wheel scrub
  // like it does on mobile - consistent UI and useful"): the mode line has exactly two
  // arms, cursor (list) and scrub (Now Playing) - no volume, nowhere.
  const { body } = wheelHandlerSrc();
  assert.match(body, /mode: listMode \? 'cursor' : 'scrub'/, 'list -> cursor, Now Playing -> scrub; no third mode');
  assert.match(body, /r\.width \* 0\.2[\s\S]*?return/, 'a press on the dead center (Select) is ignored so its tap passes through');
});

test('v1.233: center-select in the list PLAYS the cursor row (not the current), then returns to Now Playing', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  const m = /data-skin-select\]'\)\) \{([\s\S]*?)\n {6}\}/.exec(js);
  assert.ok(m, 'the data-skin-select handler exists');
  const b = m[1];
  assert.match(b, /mms-listmode/, 'branches on list vs Now Playing');
  assert.match(b, /is-cursor[\s\S]*data-skin-go/, 'in the list it reads the CURSOR row (is-cursor) and its queue index');
  assert.match(b, /setListMode\(false\)[\s\S]*onSelectIndex/, 'closes the list then plays that song (via the view onSelectIndex hook)');
  assert.match(b, /setListMode\(true\)/, 'from Now Playing it opens the list');
});

test('v1.233: the wheel CURSOR bar is a distinct highlight - is-cursor gets the blue bar, is-current keeps only its ▶ marker', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  const cursor = /\.mms-ipod \.mms-row\.is-cursor\{([^}]*)\}/.exec(css);
  assert.ok(cursor, 'the is-cursor rule exists');
  assert.match(cursor[1], /background:\s*linear-gradient\(var\(--mms-ipod-blue1\)/, 'the cursor wears the blue selection bar');
  // is-current no longer paints the full blue bar (that follows the cursor now) - it keeps
  // just the marker so you still see what is playing while the cursor roams.
  const cur = /\.mms-ipod \.mms-row\.is-current\{([^}]*)\}/.exec(css);
  assert.ok(!cur || !/linear-gradient/.test(cur[1]), 'is-current does NOT paint the blue bar anymore (the cursor owns it)');
  // source order: is-cursor after is-current so a coincident row resolves white text.
  assert.ok(css.indexOf('.mms-row.is-cursor{') > css.indexOf('.mms-row.is-current .mms-rn'), 'is-cursor is declared AFTER is-current (wins at equal specificity)');
});

// ---- v1.235: wheel-VOLUME in Now Playing (desktop pop-out) - source locks ---------------
test('v1.250 (Dean): wheel-volume is RETIRED - no volume mode, no adjustVolume, in either file', () => {
  // Dean 2026-09-02: "make the classic wheel scrub like it does on mobile instead of
  // volume, consistent UI and useful." The v1.235 pop-out wheel-volume is gone; the shared
  // engine carries the ONE gesture implementation and it has no volume arm. (The dormant
  // .ip-vol-fill markup/CSS stay in music-skins.js/style.css - unused, zero-risk.)
  const fs = require('node:fs'); const path = require('node:path');
  const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  const music = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  assert.ok(!/'volume'/.test(engine), 'no volume gesture mode in the engine');
  assert.ok(!/function adjustVolume/.test(engine) && !/function adjustVolume/.test(music), 'adjustVolume is gone from both files');
  assert.ok(!/allowVolume/.test(engine) && !/allowVolume/.test(music), 'no allowVolume flag survives anywhere');
});

test('v1.235 CSS is DORMANT since v1.250 (wheel-volume retired; .mms-voladj has no writer) - rules kept unchurned this wave', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.mms-ipod \.ip-vol\{[^}]*display:\s*none/, 'the volume bar is hidden by default');
  assert.match(css, /\.mms-ipod\.mms-voladj \.ip-scrub\{[^}]*display:\s*none/, 'adjusting hides the scrubber');
  assert.match(css, /\.mms-ipod\.mms-voladj \.ip-vol\{[^}]*display:\s*flex/, 'adjusting shows the volume bar');
});

test('v1.235.x: the pop-out runs its OWN reflect clock (fixes the true-PiP freeze) and clears it on teardown', () => {
  const fs = require('node:fs'); const path = require('node:path');
  // v1.251 (R3): the shell lives in the shared engine now - the lock follows the code.
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  // the clock is started on the POP-OUT window (win.setInterval), reflecting the pop-out panel,
  // NOT the main tab (whose timeupdate throttles when the tab is backgrounded under a PiP window).
  assert.match(js, /pipClock = win\.setInterval\(function \(\) \{ if \(pipEngine\) pipEngine\.reflect\(\); \}, \d+\)/, 'the pop-out clock is an interval on the pop-out window that reflects its engine surface');
  // teardown clears it on the window that created it.
  assert.match(js, /clearInterval\(pipClock\)/, 'teardown clears the pop-out clock');
});

test('v1.259 source-lock: the zune queue CAN scroll - the flex chain and row layout exist (jsdom cannot measure layout)', () => {
  // Adversarial W1/W2's functional findings: without the .mms-zn-queue flex chain the
  // qlist auto-heights and .mms-full's overflow:hidden crops rows unreachably; without
  // the row layout the four spans mash into UA-default buttons. Lock the load-bearers.
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.mms-zune \.mms-zn-queue\{ flex:1; min-height:0; display:flex; flex-direction:column; \}/, 'the queue flex chain (the spotify idiom) - the scroll rides it');
  assert.match(css, /\.mms-zune \.mms-qlist\{ overflow-y:auto; flex:1; min-height:0;/, 'the list scrolls within the chain');
  assert.match(css, /\.mms-zune \.mms-row\{ display:flex; align-items:center; width:100%;/, 'rows have real layout, not UA-default buttons');
  assert.match(css, /\.mms-zune \.mms-row\{[^}]*text-transform:lowercase/, 'the lowercase rows claim is CSS-true');
});
