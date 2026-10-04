// Shared Utility Functions for FileTube

// ---- Era theme system ----------------------------------------------------
// Two orthogonal axes applied to <html>: data-theme (era) and data-mode
// (light|dark). See docs/exec-plans/completed/2026-07-04-era-themes.md for the full design.

const THEME_MODES = ['light', 'dark'];
const DEFAULT_ERA = '2021';
const DEFAULT_MODE = 'light';

// ---- Chrome icons: the icon registry's sprite ------------------------------
// v1.87.1 (Dean): the bottom-nav + header glyphs moved off `-webkit-mask-image`
// (iOS paints NOTHING until a mask image decodes, so glyphs popped in after their
// labels on a cold start) to inline <svg>, which rides the text layer.
// UI professionalism pass step 2 (plan D4.2): they are still inline <svg>, but draw a
// <symbol> from the icon registry's sprite (public/js/icons.js, generated from
// Material Symbols by tools/icons/build.js). Each shell injects the sprite from the
// first script in <body>, so the glyphs still paint with the text; and the sprite
// follows the icon-set picker again (outlined/rounded/filled), which the fixed-path
// inline glyphs could not.
//
// CHROME_ICON maps the chrome's historical glyph names to registry names; new code
// names registry icons directly (ui.icon, step 3).
const CHROME_ICON = {
  home: 'home', liked: 'favorite', folder: 'folder', history: 'history', podcast: 'podcasts',
  music: 'music_note', books: 'menu_book', downloads: 'smart_display', moon: 'dark_mode',
  sun: 'light_mode', cog: 'settings', search: 'search', download: 'download', caret: 'expand_more',
  queue: 'playlist_play', heart: 'favorite', delete: 'delete', menu: 'menu', star: 'star',
  refresh: 'subscriptions', bell: 'notifications', bellOff: 'notifications_off', starFilled: 'star.fill',
};

// The sprite reference for a registry name ('keep.fill' -> '#i-keep-fill').
const iconHref = (registryName) => '#i-' + registryName.replace(/\./g, '-');

// The inline-SVG markup for a chrome glyph. Deterministic (chrome-icons.test.js
// reconstructs it to source-lock the shells' static header/nav markup). Colour
// comes from CSS (`.chrome-icon { fill: currentColor }`), inherited into the symbol.
function chromeIconMarkup(name, extraClass) {
  const reg = CHROME_ICON[name];
  if (!reg) return '';
  const cls = 'chrome-icon' + (extraClass ? ' ' + extraClass : '');
  return '<svg class="' + cls + '" aria-hidden="true"><use href="' + iconHref(reg) + '"/></svg>';
}

// A live SVG element for the same glyph, built in the SVG namespace so it is
// robust under both browsers and jsdom (the bell/queue use the same approach).
// `doc` (optional, v1.340) = the document to build in - a caller holding an element from
// another document (a test's JSDOM) passes its ownerDocument; default the page's.
function chromeIconEl(name, extraClass, doc) {
  const reg = CHROME_ICON[name];
  return reg ? spriteIconEl(reg, 'chrome-icon' + (extraClass ? ' ' + extraClass : ''), doc) : null;
}

// A live <svg><use href="#i-NAME"/></svg> for a REGISTRY name (the header bell and
// queue, which size themselves with width/height attributes rather than .chrome-icon).
// fill="currentColor" is inherited into the symbol, so the glyph tints with its button.
function spriteIconEl(registryName, cls, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  // Real browsers always have createElementNS (mandatory: an SVG built via the
  // plain createElement lands in the HTML namespace and never renders). Some
  // lightweight unit-test document stubs model only createElement, so degrade to
  // null there and let callers skip the (incidental) glyph.
  if (!registryName || !d || typeof d.createElementNS !== 'function') return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = d.createElementNS(NS, 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const use = d.createElementNS(NS, 'use');
  use.setAttribute('href', iconHref(registryName));
  svg.appendChild(use);
  return svg;
}

// ---- sweep S1 (UI pass, plan D4.1/D4.2): the chrome's primitive builders ----------------
// The header icon buttons, the bottom-bar tabs, the account menu and the playlists sheet
// are ui-* primitives (public/css/ui.css). These two builders emit EXACTLY the DOM
// public/js/ui.js's ui.icon / ui.button build (test/unit/chrome-primitives.test.js compares
// the two outerHTML-for-outerHTML), so the chrome and the primitives cannot drift; they
// exist because common.js runs in jsdom harnesses that never load ui.js, and because the
// bottom-bar tabs are <a> links, which ui.button does not build.
// The markup twin of ui.icon, for the shells' static bottom bar (chrome-icons.test.js binds
// every shell's glyph to it).
function uiIconMarkup(registryName, size) {
  return '<svg class="ui-icon ui-icon--' + (size || 'md') + '" aria-hidden="true" focusable="false"><use href="'
    + iconHref(registryName) + '"/></svg>';
}
function uiIconEl(registryName, size, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!registryName || !d || typeof d.createElementNS !== 'function') return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = d.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ui-icon ui-icon--' + (size || 'md'));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = d.createElementNS(NS, 'use');
  use.setAttribute('href', iconHref(registryName));
  svg.appendChild(use);
  return svg;
}
// A plain ui-btn: `shape` 'icon' (a header glyph button: 36px desktop / 44px phone, a 44px
// hit area either way) or 'stack' (a bottom-bar tab: the icon over its label). `media` (an
// element) takes the icon's place for the account avatar. `cls` adds the element's own hook
// class (queue-btn, bottom-nav-item ...): a JS/test hook, never a styled control family.
function chromeButtonEl(o) {
  const d = o.doc || document;
  const shape = o.shape === 'stack' ? 'stack' : 'icon';
  const b = d.createElement(o.tag || 'button');
  b.className = 'ui-btn ui-btn--plain ui-btn--md ui-btn--' + shape + (o.cls ? ' ' + o.cls : '');
  if (!o.tag || o.tag === 'button') b.setAttribute('type', 'button');
  if (o.ariaLabel) b.setAttribute('aria-label', o.ariaLabel);
  if (o.media) {
    b.appendChild(o.media);
  } else if (o.icon || o.slotEl) {
    const slot = d.createElement('span');
    slot.className = 'ui-btn__icon';
    const svg = o.slotEl || uiIconEl(o.icon, shape === 'stack' ? 'lg' : 'md', d);
    if (svg) slot.appendChild(svg);
    b.appendChild(slot);
  }
  if (shape === 'stack' && o.label != null) {
    const l = d.createElement('span');
    l.className = 'ui-btn__label' + (o.labelCls ? ' ' + o.labelCls : '');
    l.textContent = o.label;
    b.appendChild(l);
  }
  return b;
}
// A bottom-bar tab (F49): a ui-btn stack - a fixed --icon-lg icon slot over its label, so
// every label sits on one line whatever the slot holds (the You tab's avatar included).
// The shells' static tabs are the same markup (chrome-icons.test.js binds both).
function bottomNavItemEl(o) {
  const el = chromeButtonEl({ tag: o.tag || 'a', shape: 'stack', cls: 'bottom-nav-item', icon: o.icon, slotEl: o.slotEl,
    label: o.label, labelCls: 'bottom-nav-label', ariaLabel: o.ariaLabel, doc: o.doc });
  if (o.href) el.setAttribute('href', o.href);
  if (o.nav) el.setAttribute('data-nav', o.nav);
  return el;
}
// The selected tab shows its FILLED glyph (F49: one active style - the filled glyph in ink,
// the sidebar's rows use a neutral fill). Swaps the tab's sprite reference between NAME and
// NAME.fill; a name without a registered twin keeps its outline (never a blank glyph).
function setBottomNavItemFilled(item, on) {
  const use = item && item.querySelector('.ui-btn__icon use');
  if (!use) return;
  const href = use.getAttribute('href') || '';
  const base = href.replace(/-fill$/, '');
  if (!on) { if (href !== base) use.setAttribute('href', base); return; }
  const reg = typeof window !== 'undefined' ? window.FTIcons : null;
  const name = base.replace(/^#i-/, '') + '.fill';
  if (reg && typeof reg.has === 'function' && reg.has(name)) use.setAttribute('href', iconHref(name));
}
// The avatar (ui.avatar's DOM, ui.css .ui-avatar): the photo when there is one, else the
// initials monogram on a name-hashed tone; a failed photo becomes the monogram - never a
// broken image or an empty disc. Delegates to window.ui.avatar when ui.js is loaded (every
// shell), else builds the same DOM (jsdom harnesses).
function chromeAvatarEl(name, url, size, doc) {
  const d = doc || document;
  const w = d.defaultView;
  if (w && w.ui && typeof w.ui.avatar === 'function') return w.ui.avatar({ name, url, kind: 'person', size, doc: d });
  const a = d.createElement('span');
  a.className = 'ui-avatar ui-avatar--' + size;
  const mono = () => {
    const words = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
    const m = d.createElement('span');
    m.className = 'ui-avatar__mono';
    m.textContent = words.length ? words.slice(0, 2).map((x) => Array.from(x)[0]).join('').toUpperCase() : '?';
    let h = 5381;
    const s = String(name == null ? '' : name);
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    m.setAttribute('data-tone', String((h % 8) + 1));
    return m;
  };
  if (url) {
    const img = d.createElement('img');
    img.className = 'ui-avatar__img';
    img.setAttribute('alt', '');
    img.setAttribute('decoding', 'async');
    img.setAttribute('loading', 'lazy');
    img.addEventListener('error', () => {
      if (img.parentNode) img.parentNode.removeChild(img);
      if (!a.querySelector('.ui-avatar__mono')) a.appendChild(mono());
    });
    img.setAttribute('src', url);
    a.appendChild(img);
  } else {
    a.appendChild(mono());
  }
  return a;
}


// v1.102 (tranche 4 shimmer): the ART-DECODE reveal. Every card image (album/
// podcast/book/history art, mobile avatar) ships with the `art-shimmer` class so
// its reserved box shimmers (a token-only gradient swept on the img's OWN
// background - a replaced <img> can't host a ::after sweep) instead of flashing a
// flat tint then popping to the decoded picture. This wires each such image to
// drop the class the instant it decodes (`load`) or fails (`error`), and clears
// it immediately for an image that is ALREADY complete from cache - the named
// cached-image edge, without which a warm image would shimmer FOREVER under a
// fully-visible picture. `root` scopes the query to a just-rendered subtree
// (default: document). Listener-`once` + idempotent, so re-running over a
// partially-revealed set is safe. Exposed on window.FileTube for the view files.
function shimmerArt(root) {
  if (typeof document === 'undefined') return;
  const scope = (root && typeof root.querySelectorAll === 'function') ? root : document;
  scope.querySelectorAll('img.art-shimmer').forEach((img) => {
    const clear = () => img.classList.remove('art-shimmer');
    // `complete` is true for a decoded image AND a cached-broken one; either way
    // no load event is coming, so stop shimmering now (a broken image then shows
    // its own broken-image affordance, never a perpetual shimmer).
    if (img.complete) { clear(); return; }
    img.addEventListener('load', clear, { once: true });
    img.addEventListener('error', clear, { once: true });
  });
}

// v1.339 (L1, plan D4): REVEAL-TOGETHER. shimmerArt reveals each image the moment it
// decodes, so a screen of tiles pops in one by one. This reveals the `art-shimmer` images
// currently INTERSECTING the viewport as ONE batch: each gets `art-together` (CSS holds its
// decoded pixels out of view, `object-position`, so only the shimmer shows) and all clear
// in the same task once EVERY one has settled - loaded AND decoded (`img.decode()` after
// `load`, so iOS never paints a half-decoded frame), or errored (a broken image counts as
// settled; its broken-image affordance then shows, never a perpetual shimmer) - or when
// REVEAL_TOGETHER_CAP_MS elapses, whichever is first. At the cap the settled ones reveal
// together and the rest fall back to their own per-image reveal. An image already
// `complete` counts as settled immediately, so a warm screen reveals in the same tick.
// Off-screen images keep the per-image reveal (their decode is not what the eye waits
// on). Every exit is bound: all-settled, the cap, `opts.signal` abort and handle.abort()
// (view teardown) - an abort stops the batch and hands each image back to its own reveal
// (settled ones now, pending ones on their own load/error), so nothing can stay held.
// An image a pending batch already holds is skipped, so a re-run over the same host never
// re-owns (or early-reveals) it. `opts.capMs` overrides the cap. Returns `{ abort }`.
// Exposed on window.FileTube (general: any view's `art-shimmer` images).
// The cap: 600ms is long enough to absorb the per-image network/decode stagger of a
// screen of right-sized covers (the probe measured 0.12-0.25s at 20Mbps for 240px art)
// and short enough that one stalled cover never holds a whole screen of loaded art.
const REVEAL_TOGETHER_CAP_MS = 600;
function revealArtTogether(root, opts) {
  const o = opts || {};
  const handle = { abort() {} };
  if (typeof document === 'undefined') return handle;
  const scope = (root && typeof root.querySelectorAll === 'function') ? root : document;
  const win = typeof window !== 'undefined' ? window : null;
  const vw = (win && win.innerWidth) || document.documentElement.clientWidth || 0;
  const vh = (win && win.innerHeight) || document.documentElement.clientHeight || 0;
  const capMs = (typeof o.capMs === 'number' && o.capMs >= 0) ? o.capMs : REVEAL_TOGETHER_CAP_MS;
  const clear = (img) => { img.classList.remove('art-shimmer'); img.classList.remove('art-together'); };
  const perImage = (img) => {
    if (img.complete) { clear(img); return; }
    img.addEventListener('load', () => clear(img), { once: true });
    img.addEventListener('error', () => clear(img), { once: true });
  };
  const dead = !!(o.signal && o.signal.aborted); // a torn-down view batches nothing
  const inView = [];
  scope.querySelectorAll('img.art-shimmer').forEach((img) => {
    if (img.classList.contains('art-together')) return; // owned by a still-pending batch (a re-run over the same host)
    const r = (!dead && typeof img.getBoundingClientRect === 'function') ? img.getBoundingClientRect() : null;
    const visible = !!r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    if (visible) inView.push(img); else perImage(img);
  });
  if (inView.length === 0) return handle;
  const settled = new Set(inView.filter((img) => img.complete));
  if (settled.size === inView.length) { inView.forEach(clear); return handle; }
  let done = false;
  let timer = null;
  const unbinders = [];
  const stop = () => {
    done = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    unbinders.forEach((fn) => fn());
    unbinders.length = 0;
    if (o.signal && typeof o.signal.removeEventListener === 'function') o.signal.removeEventListener('abort', onAbort);
  };
  // All settled, or the cap: the settled ones reveal TOGETHER, the rest per image.
  const finish = () => {
    if (done) return;
    stop();
    inView.forEach((img) => { if (settled.has(img)) clear(img); else perImage(img); });
  };
  function onAbort() { finish(); }
  const settle = (img) => {
    if (done || settled.has(img)) return;
    settled.add(img);
    if (settled.size === inView.length) finish();
  };
  inView.forEach((img) => {
    img.classList.add('art-together');
    if (settled.has(img)) return;
    const onLoad = () => {
      if (typeof img.decode === 'function') img.decode().then(() => settle(img), () => settle(img));
      else settle(img);
    };
    const onError = () => settle(img);
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
    unbinders.push(() => { img.removeEventListener('load', onLoad); img.removeEventListener('error', onError); });
  });
  timer = setTimeout(finish, capMs);
  if (o.signal && typeof o.signal.addEventListener === 'function') o.signal.addEventListener('abort', onAbort, { once: true });
  handle.abort = onAbort;
  return handle;
}

// Single source of truth for both the setup-page Appearance picker and the
// switching logic. Adding a 5th era = one entry here + one CSS block pair.
const THEME_REGISTRY = [
  { id: '2005', name: 'Original', year: 2005,
    blurb: 'Plain HTML, sharp corners, blue underlined links.',
    swatch: ['#ffffff', '#0000cc'] },
  { id: '2009', name: 'Classic', year: 2009,
    blurb: 'Warm grays and glossy red chrome.',
    swatch: ['#f0f0f0', '#cc0000'] },
  { id: '2014', name: 'Flat', year: 2014,
    blurb: 'Clean flat white with a brighter red.',
    swatch: ['#ffffff', '#e62117'] },
  { id: '2021', name: 'Modern', year: 2021,
    blurb: 'Rounded cards and Geist - today\'s look.',
    swatch: ['#ffffff', '#cc0000'] }
];

// Valid era ids derived from the registry — adding an entry above makes it valid
// automatically. (The inline FOUC scripts in <head> keep their own copy of this
// list, since they must run before common.js loads.)
const THEME_ERAS = THEME_REGISTRY.map((t) => t.id);

// Pure: resolves the stored era/mode (with legacy-key migration) into a safe
// { era, mode } pair. Never throws; never returns an unset axis. Exported for
// node:test — see test/unit/resolve-theme.test.js. Kept in sync with the
// inline FOUC bootstrap in <head> on index.html/setup.html/watch.html.
function resolveTheme(storedEra, storedMode, legacyTheme) {
  const era = THEME_ERAS.includes(storedEra) ? storedEra : DEFAULT_ERA;
  let mode;
  if (THEME_MODES.includes(storedMode)) {
    mode = storedMode;                       // valid new key wins
  } else if (storedEra == null && storedMode == null &&
             (legacyTheme === 'dark' || legacyTheme === 'light')) {
    mode = legacyTheme;                      // one-time migration of legacy `theme`
  } else {
    mode = DEFAULT_MODE;                     // missing/corrupt -> fail safe
  }
  return { era, mode };
}

// ---- UI pass D8.1: the era flourish (fabricated stats) ----------------------
// The deterministic MOCKS (getStarRating's stars, getMockViews' view counts,
// getMockSubCount's subscriber counts, the mock comment roster) are the retro
// house style: shown in the 2005/2009/2014 eras, hidden in Modern (2021) - Dean's
// audit decision 1. ONE mechanism, not per-feature ifs: a writer that renders a
// FABRICATED value wraps it in `.ft-fabricated`, and one style.css rule hides every
// such node unless <html data-era-flourish="on">. The attribute is derived from the
// era here and nowhere else, set at common.js load (before any view renders) and on
// every era change (applyTheme). Real values (a yt-dlp view count captured at
// download, a captured subscriber count) are never wrapped, so they show in every
// era. The v1.63.1 ft-hide-stars preference composes on top: stars show only when
// the era allows them AND the preference does not hide them.
const ERA_FLOURISH_ERAS = ['2005', '2009', '2014'];

// Pure: does this era show fabricated stats? Unknown/garbage = the Modern default (no).
function eraShowsFabricated(era) {
  return ERA_FLOURISH_ERAS.includes(String(era));
}

// Reflects the era onto <html data-era-flourish="on|off">. `doc` for jsdom tests.
function applyEraFlourish(era, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.documentElement) return;
  const e = era != null ? era : d.documentElement.getAttribute('data-theme');
  d.documentElement.setAttribute('data-era-flourish', eraShowsFabricated(e) ? 'on' : 'off');
}

// UI pass D7 (AC9 stillness): a rotate or a window resize re-lays the page out in one step.
// An `orientationchange`, or a `resize` that CHANGES THE WIDTH, puts `html.no-motion` on for
// STILLNESS_MS (restarted by each such event) and style.css zeroes every transition under it,
// so nothing that transitions for a user's action (the sidebar drawer, the content margin beside
// it) animates for a viewport change. A height-only resize (the iOS / Android URL bar
// collapsing on a scroll) is NOT a relayout of the width-keyed layout and holds nothing: it
// fires during every scroll, and a hold there would zero a sheet's or a toast's transition and
// restyle the whole tree twice per event. `lastWidth` is advanced only by a resize, never by an
// orientationchange, so iOS's resize that follows the orientationchange still restarts the hold.
// The ONE writer of the class: registered once per document at common.js load (before
// DOMContentLoaded, so a rotate during boot is covered too); the resize event is dispatched in
// the frame's resize steps, BEFORE that frame's style recalc, so the class is on when the new
// layout's styles resolve. `win` for jsdom tests. Returns false when there is nothing to watch.
const STILLNESS_MS = 300;
function installResizeStillness(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const html = w && w.document && w.document.documentElement;
  if (!html || typeof w.addEventListener !== 'function') return false;
  let timer = null;
  let lastWidth = w.innerWidth;
  const hold = () => {
    html.classList.add('no-motion');
    if (timer) w.clearTimeout(timer);
    timer = w.setTimeout(() => { timer = null; html.classList.remove('no-motion'); }, STILLNESS_MS);
  };
  w.addEventListener('resize', () => {
    if (w.innerWidth === lastWidth) return;
    lastWidth = w.innerWidth;
    hold();
  });
  w.addEventListener('orientationchange', hold);
  return true;
}

// v1.350 (W6): the ?debugRotate=1 ring buffer for the Pocket turn back to portrait. iOS shows a
// frame or two of a wrong layout (a giant LCD, then everything ~20 px low) that headless Chromium
// never paints, so Dean's phone has to say which value was stale. From each orientationchange,
// resize, screen.orientation change and visualViewport resize it samples EVERY animation frame for
// 1 s (a RING of ROTATE_LOG_CAP rows): t, the layout and visual viewport, the orientation media
// query, the screen angle, the Pocket's --pkl-h, the top safe-area inset and the LCD's rect. A sample
// changes no layout (one read pass, a hidden probe element). `?debugRotate=1` turns it on and keeps
// it on (localStorage ft-debug-rotate), `=0` turns it off; while on, a small panel shows the rows
// (tap it to copy them). Off by default: nothing is installed and nothing is read.
// v1.355: Settings > Troubleshooting > "Show rotate debug log" switches it too (the home-screen app has
// no URL bar), at once both ways: ON installs it in this window (a second install is a no-op), OFF
// uninstallRotateDebug() removes every listener, the free-running pre-frame ring, the panel and the
// probe. Each row also carries the page scroll (sy), the visual viewport's offset (vvo) and scale (vs)
// and the focused element (ae), so a keyboard coming up (the Pocket's keyboard search) shows whether
// anything moved: the iPhone keyboard shrinks the visual viewport, which fires its resize.
// v1.357 adds sh (the screen size), cvw/cvh (what CSS 100vw / 100dvh resolve to, read off a second hidden probe) and pti
// (the in-turn top inset the Pocket applied, pocket-lighting.js installTurnInset; '' = none).
const ROTATE_LOG_KEY = 'ft-debug-rotate';
const ROTATE_LOG_CAP = 240;
const ROTATE_LOG_MS = 1000;
const ROTATE_PRE_FRAMES = 12;
function rotateSample(win, t) {
  const w = win || window;
  const d = w.document;
  const q = (sel) => d.querySelector(sel);
  const vv = w.visualViewport;
  const pnl = q('#music-nowplaying-panel');
  const lcd = q('.mms-full .ip-lcd');
  const r = lcd ? lcd.getBoundingClientRect() : null;
  let sat = '';
  let cvw = null; let cvh = null;
  const probe = d.getElementById('ft-rotate-probe');
  if (probe) sat = w.getComputedStyle(probe).paddingTop;
  // v1.357: what CSS `100vw` / `100dvh` resolve to right now (the giant LCD of the 2026-10-02 capture was ~2.3x too wide
  // while innerWidth already said 393: this says whether the viewport UNITS were stale or only the fixed box)
  const vprobe = d.getElementById('ft-rotate-vprobe');
  if (vprobe) {
    const cs = w.getComputedStyle(vprobe);
    const pw = parseFloat(cs.width); const ph = parseFloat(cs.height);
    cvw = Number.isFinite(pw) ? Math.round(pw) : null; cvh = Number.isFinite(ph) ? Math.round(ph) : null;
  }
  const act = d.activeElement;
  const ae = (act && act !== d.body && act !== d.documentElement && act.tagName)
    ? String(act.tagName).toLowerCase() + (act.id ? '#' + act.id : '') : '';
  return {
    t: Math.round(t),
    iw: Math.round(w.innerWidth), ih: Math.round(w.innerHeight),
    sh: w.screen ? [Math.round(w.screen.width), Math.round(w.screen.height)] : null, // v1.357: the screen the safe-area arithmetic subtracts from
    cvw, cvh,
    vv: vv ? [Math.round(vv.width), Math.round(vv.height)] : null,
    vvo: vv ? [Math.round(vv.offsetLeft || 0), Math.round(vv.offsetTop || 0)] : null, // v1.355: did the visual viewport pan?
    vs: vv && typeof vv.scale === 'number' ? Math.round(vv.scale * 1000) / 1000 : null, // v1.355: ...or zoom?
    sy: Math.round(w.scrollY || w.pageYOffset || 0), // v1.355: ...or the page scroll?
    ae, // v1.355: what has focus ('' = nothing, e.g. 'input#ipm-kb' while the keyboard search is up)
    land: !!(w.matchMedia && w.matchMedia('(orientation: landscape)').matches),
    ang: w.screen && w.screen.orientation ? w.screen.orientation.angle : null,
    pklh: pnl ? w.getComputedStyle(pnl).getPropertyValue('--pkl-h').trim() : '',
    sat,
    pti: d.documentElement.style.getPropertyValue('--pk-top-inset'), // v1.357: the in-turn inset the Pocket applied ('' = none)
    rot: d.documentElement.getAttribute('data-ft-rot'), // v1.354: the stamp the board's turn keys on
    lcd: r ? [r.x, r.y, r.width, r.height].map(Math.round) : null,
  };
}
// The live install, per window (null = off): everything uninstallRotateDebug must take back.
const ROTATE_DEBUG_HANDLE = '__ftRotateDebug';
function installRotateDebug(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w || !w.document || typeof w.addEventListener !== 'function') return false;
  let on = false;
  try {
    const ls = w.localStorage;
    const q = new URLSearchParams(w.location.search).get('debugRotate');
    if (q === '1') ls.setItem(ROTATE_LOG_KEY, '1'); else if (q === '0') ls.removeItem(ROTATE_LOG_KEY);
    on = ls.getItem(ROTATE_LOG_KEY) === '1';
  } catch (_) { on = false; }
  if (!on) return false;
  if (w[ROTATE_DEBUG_HANDLE]) return true; // v1.355: already live in this window - install nothing twice
  const log = [];
  w.__ftRotateLog = log;
  const h = { stopped: false, preRaf: null, runRaf: null, off: [] };
  w[ROTATE_DEBUG_HANDLE] = h;
  let seq = 0; let panel = null; let pre = null;
  const render = () => {
    if (!pre) return;
    pre.textContent = '[tap to copy]\n' + log.map((e) => JSON.stringify(e)).join('\n');
  };
  const ensurePanel = () => {
    const d = w.document;
    if (!d.body) return;
    if (!d.getElementById('ft-rotate-probe')) {
      const p = d.createElement('div');
      p.id = 'ft-rotate-probe';
      p.setAttribute('aria-hidden', 'true');
      p.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)';
      d.body.appendChild(p);
    }
    if (!d.getElementById('ft-rotate-vprobe')) {
      const v = d.createElement('div');
      v.id = 'ft-rotate-vprobe';
      v.setAttribute('aria-hidden', 'true');
      v.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100dvh;visibility:hidden;pointer-events:none';
      d.body.appendChild(v);
    }
    if (panel) return;
    panel = d.createElement('div');
    panel.id = 'ft-rotate-panel';
    panel.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:999999',
      'max-height:35vh', 'overflow-y:auto', 'background:rgba(0,0,0,0.75)',
      'color:#0f0', 'font:10px/1.3 monospace', 'padding:4px 6px',
      'pointer-events:auto', 'white-space:pre-wrap',
    ].join(';');
    panel.title = 'Tap to copy';
    pre = panel;
    panel.addEventListener('click', () => { try { w.navigator.clipboard.writeText(log.map((e) => JSON.stringify(e)).join('\n')); } catch (_) { /* no clipboard */ } });
    d.body.appendChild(panel);
  };
  // v1.354: a free-running ring of the last ROTATE_PRE_FRAMES frames, so the rows BEFORE the first event are
  // in the log too (the 2026-10-02 capture started at the event, after the wrong frame had been painted).
  const preRing = [];
  const preTick = () => {
    h.preRaf = null;
    if (h.stopped) return; // v1.355: switched off - the ring stops here
    const t = w.performance.now();
    preRing.push(rotateSample(w, t));
    while (preRing.length > ROTATE_PRE_FRAMES) preRing.shift();
    h.preRaf = w.requestAnimationFrame(preTick);
  };
  h.preRaf = w.requestAnimationFrame(preTick);
  const run = (why) => {
    if (h.stopped) return;
    ensurePanel();
    const id = ++seq;
    const t0 = w.performance.now();
    log.push({ why, at: Math.round(t0) });
    preRing.forEach((row) => log.push(Object.assign({ pre: true }, row, { t: Math.round(row.t - t0) })));
    const tick = () => {
      h.runRaf = null;
      if (h.stopped || id !== seq) return;
      const t = w.performance.now() - t0;
      log.push(rotateSample(w, t));
      while (log.length > ROTATE_LOG_CAP) log.shift();
      if (t < ROTATE_LOG_MS) h.runRaf = w.requestAnimationFrame(tick); else render();
    };
    h.runRaf = w.requestAnimationFrame(tick);
  };
  // every listener is recorded with its target so the uninstall takes back exactly these
  const listen = (target, type, fn) => {
    try { target.addEventListener(type, fn); h.off.push(() => target.removeEventListener(type, fn)); } catch (_) { /* this target has no events */ }
  };
  listen(w, 'orientationchange', () => run('orientationchange'));
  listen(w, 'resize', () => run('resize'));
  try { if (w.screen && w.screen.orientation && w.screen.orientation.addEventListener) listen(w.screen.orientation, 'change', () => run('so-change')); } catch (_) { /* no screen.orientation */ }
  try { if (w.matchMedia) { const mq = w.matchMedia('(orientation: landscape)'); if (mq && mq.addEventListener) listen(mq, 'change', () => run('mq-change')); } } catch (_) { /* no matchMedia events */ }
  try { if (w.visualViewport) listen(w.visualViewport, 'resize', () => run('vv-resize')); } catch (_) { /* no visualViewport */ }
  h.dispose = () => {
    h.stopped = true;
    h.off.splice(0).forEach((f) => { try { f(); } catch (_) { /* already gone */ } });
    const cancel = typeof w.cancelAnimationFrame === 'function' ? w.cancelAnimationFrame.bind(w) : null;
    [h.preRaf, h.runRaf].forEach((id) => { if (id != null && cancel) { try { cancel(id); } catch (_) { /* ignore */ } } });
    h.preRaf = null; h.runRaf = null;
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null; pre = null;
    ['ft-rotate-probe', 'ft-rotate-vprobe'].forEach((pid) => {
      const pe = w.document.getElementById(pid);
      if (pe && pe.parentNode) pe.parentNode.removeChild(pe);
    });
  };
  return true;
}
// v1.355: the Settings switch's OFF - the log stops in this window at once (no reload). True when a live
// install was taken down. The stored key is the caller's (Settings removes it first).
function uninstallRotateDebug(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return false;
  const h = w[ROTATE_DEBUG_HANDLE];
  if (!h) return false;
  w[ROTATE_DEBUG_HANDLE] = null;
  h.dispose();
  try { delete w.__ftRotateLog; } catch (_) { w.__ftRotateLog = undefined; }
  return true;
}

// Applies both attributes + persists both keys. Also flips the header
// moon/sun icon to reflect the current mode.
function applyTheme(era, mode) {
  const d = document.documentElement;
  d.setAttribute('data-theme', era);
  d.setAttribute('data-mode', mode);
  applyEraFlourish(era);
  try {
    localStorage.setItem('ft-era', era);
    localStorage.setItem('ft-mode', mode);
  } catch (_) { /* storage disabled (private mode/sandbox) — attributes still applied */ }
  // v1.82: light/dark now lives in the account menu (the header #theme-toggle-btn
  // was removed) and the bottom-nav theme item - keep both glyphs in sync.
  if (typeof updateAccountMenuThemeItem === 'function') updateAccountMenuThemeItem();
  if (typeof updateNavThemeItem === 'function') updateNavThemeItem();
  syncThemeColorMeta(); // F66 (sweep S1): the browser / PWA chrome follows the era + mode
}

// F66 (sweep S1): the browser's theme colour (Android / desktop PWA title bar, Safari's
// tab tint) follows the app's header ground for the CURRENT era and mode, not a static
// brand red. The shells ship a light/dark pair (media = the OS scheme) for the pre-paint
// guess; once the app's mode is known this collapses both to the header's resolved
// `--header-bg` (a custom property's computed value is its resolved colour). Returns the
// colour it applied, or '' when it could not resolve one (the shell pair then stands).
function syncThemeColorMeta(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const w = d && d.defaultView;
  if (!d || !w || typeof w.getComputedStyle !== 'function') return '';
  const metas = d.querySelectorAll('meta[name="theme-color"]');
  if (!metas.length) return '';
  let colour = '';
  try { colour = w.getComputedStyle(d.documentElement).getPropertyValue('--header-bg').trim(); } catch (_) { colour = ''; }
  if (!/^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i.test(colour)) return '';
  metas.forEach((m) => { m.setAttribute('content', colour); m.removeAttribute('media'); });
  return colour;
}

// Runs on DOMContentLoaded: resolves stored/legacy state and (re-)applies it,
// completing the legacy `theme` -> ft-era/ft-mode migration on first load.
function initTheme() {
  let e = null, m = null, legacy = null;
  try {
    e = localStorage.getItem('ft-era');
    m = localStorage.getItem('ft-mode');
    legacy = localStorage.getItem('theme');
  } catch (_) { /* storage unavailable — fall through to safe defaults */ }
  const { era, mode } = resolveTheme(e, m, legacy);
  applyTheme(era, mode);
}

// Header moon/sun button: flips data-mode only, never touches data-theme (era
// selection lives solely in the setup-page picker).
function toggleTheme() {
  const d = document.documentElement;
  const mode = d.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
  const era = d.getAttribute('data-theme') || DEFAULT_ERA;
  applyTheme(era, mode);
  // v1.33.1: the custom header logo is mode-variant (light/dark uploads) --
  // re-resolve it live so the header tracks the toggle without a reload.
  // Function declaration below in this same file (hoisted); no-ops cleanly
  // when no custom logo is configured.
  applyCustomLogoIfSet();
  mirrorUserSetting({ theme: mode }); // v1.43: cross-device seed
}

// Setup-page Appearance picker: changes era only, keeps the current mode.
// Also re-runs icon-set resolution (below): an `auto` ft-icons preference
// must recompute against the NEW era immediately, since resolveIconSet() maps
// era -> concrete set. toggleTheme() never changes era, so it never needs
// this call.
function setTheme(era) {
  const mode = document.documentElement.getAttribute('data-mode') || DEFAULT_MODE;
  applyTheme(era, mode);
  let pref = null;
  try { pref = localStorage.getItem('ft-icons'); } catch (_) { /* fall through to default */ }
  applyIconSet(pref);
  mirrorUserSetting({ era });
}

// ---- v1.43: per-user display-pref mirror ----------------------------------
// localStorage stays the device-local, pre-paint source of truth (the inline
// FOUC <head> script depends on it); the server-side user record is only the
// CROSS-DEVICE seed. Writes are fire-and-forget from the explicit
// user-change sites (era picker, mode toggle, icon picker) -- never from
// boot re-applies -- and a failure (offline, signed-out shell) is silently
// fine: the device still has its local pref.
function mirrorUserSetting(patch) {
  try {
    fetch('/api/me/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => { /* mirror is best-effort */ });
  } catch (_) { /* fetch unavailable (tests/old browser) -- local pref stands */ }
}

// Boot-time pull: ONLY keys this device has never chosen locally are seeded
// from the user record (a fresh phone inherits the desktop's era/theme/icons
// on first sign-in; a device with local prefs is never overridden).
// v1.77: ONE `/api/auth/me` shared between this file's TWO boot consumers -
// pullMirroredDisplayPrefs and initLibraryGlyphs. Deliberately NOT a
// page-wide single fetch: main.js's fetchCardCornerState and four call sites
// in setup.js (including v1.77's own renderLibraryGlyphEditor) each issue
// their own, so a real page load makes two on index.html and up to five on
// setup.html. Consolidating those is a separate job, not claimed here.
//
// Before this, pullMirroredDisplayPrefs was the only boot fetch in this file
// and it short-circuited entirely on a fully-chosen device. v1.77 adds
// per-user Library glyphs, which are SERVER-TRUTH by ruling and therefore have
// no device cache to short-circuit against - so something has to ask the
// server on every load. Memoizing here means that is still one request when
// both of this file's consumers want it, rather than two.
//
// Deliberately NOT cached across page loads: it is the authority for
// server-truth prefs, and a stale answer would paint a glyph the user already
// changed on another device.
let currentUserPromise = null;
function fetchCurrentUser() {
  if (currentUserPromise) return currentUserPromise;
  currentUserPromise = (async () => {
    try {
      const r = await fetch('/api/auth/me');
      if (!r.ok) return null; // signed-out shell (login/welcome) or auth failure
      const me = await r.json();
      // v1.158 (Dean): remember admin-ness per-device (single writer) so the
      // master-detail nav can reserve a shimmer slot for the admin-only
      // sections BEFORE setup.js's async reveal - killing the "rows pop in a
      // second later" insert. Gates a shimmer ONLY; the server enforces every
      // admin route and no admin label is ever rendered for a hidden section.
      try {
        if (me && me.user && me.user.role === 'admin') localStorage.setItem('ft-is-admin', '1');
        else localStorage.removeItem('ft-is-admin');
      } catch (_) { /* storage off - the nav just won't pre-reserve */ }
      return me;
    } catch (_) { return null; }
  })();
  return currentUserPromise;
}

async function pullMirroredDisplayPrefs() {
  let hasEra = null, hasMode = null, hasIcons = null, hasStars = null;
  try {
    hasEra = localStorage.getItem('ft-era');
    hasMode = localStorage.getItem('ft-mode');
    hasIcons = localStorage.getItem('ft-icons');
    hasStars = localStorage.getItem('ft-star-ratings');
  } catch (_) { return; /* no storage -> nothing to seed into */ }
  // Fully chosen locally = ALL seedable prefs (slim gate CRITICAL: the
  // stars seed sat BELOW this return without joining it, so any
  // theme-customized device - i.e. Dean's actual devices - never seeded
  // the stars pref at all; proven by the gate's jsdom repro).
  if (hasEra && hasMode && hasIcons && hasStars) return;
  const me = await fetchCurrentUser(); // v1.77: shared, memoized (see above)
  if (!me) return;
  const s = me.settings || {};
  const era = !hasEra && THEME_ERAS.includes(s.era) ? s.era : null;
  const mode = !hasMode && THEME_MODES.includes(s.theme) ? s.theme : null;
  if (era || mode) {
    const d = document.documentElement;
    applyTheme(era || d.getAttribute('data-theme') || DEFAULT_ERA,
      mode || d.getAttribute('data-mode') || DEFAULT_MODE);
    applyCustomLogoIfSet();
  }
  // A mirrored retired set (icons: 'emoji') seeds its replacement (D2.6).
  const seedIcons = migrateIconPref(s.icons);
  if (!hasIcons && (seedIcons === 'auto' || ICON_SETS.includes(seedIcons))) {
    applyIconSet(seedIcons); // persists the pref + re-resolves against the era
  }
  // v1.63.1: the stars pref seeds the same way (locally-unchosen only).
  if (!hasStars && STAR_RATINGS_VALUES.includes(s.starRatings)) {
    applyStarRatingsPref(s.starRatings); // no mirror - this IS the seed read-back
  }
}

// ---- v1.77: per-user Library glyphs ---------------------------------------
//
// Intake ruling 5+7: every Library entry's glyph is assignable, and the choice
// is PER-USER and SERVER-TRUTH - the v1.67 card-corner posture, not the
// theme/era/icons device-seed posture. It deliberately touches no localStorage.
//
// That distinction is why this does NOT ride pullMirroredDisplayPrefs above.
// That function returns EARLY when all four device prefs are already chosen
// locally - i.e. on every customized device, including Dean's - and the comment
// recording that return exists because v1.63.1's stars seed was placed below it
// and consequently never ran on exactly those devices. A slim gate caught it as
// a CRITICAL. Hanging library glyphs off the same function would re-open that
// bug for a second pref, so this fetches on its own.
//
// ONE writer repaints every surface: the sidebar entry AND the bottom-bar item
// for each slot. Both are found through the slot's `nav` value, so there is no
// second mapping to fall out of sync (the v1.41.4 every-writer scar).

// Last-known per-user glyph settings. Read by injectLibraryNavEntry so an entry
// injected AFTER the fetch resolves still gets the chosen glyph - the injectors
// are async capability probes and routinely land later than this does.
let libraryGlyphPrefs = null;

function applyLibraryGlyphs(settings) {
  if (typeof document === 'undefined') return;
  libraryGlyphPrefs = settings && typeof settings === 'object' ? settings : null;
  for (const slot of LIBRARY_GLYPH_SLOTS) {
    const cls = resolveLibraryGlyphClass(libraryGlyphPrefs, slot.key);
    // Both surfaces for this entry. querySelectorAll (not querySelector): a
    // shell can carry the sidebar entry and the bottom item at once, and a
    // missed one is a visibly inconsistent glyph for the same destination.
    const nodes = document.querySelectorAll(
      '[data-nav-sidebar="' + slot.nav + '"] i, [data-nav="' + slot.nav + '"] i');
    nodes.forEach((i) => { i.className = cls; });
  }
}

// The glyph an injector should stamp on a freshly-built Library entry.
function libraryGlyphClassFor(navKey, fallback) {
  const slot = LIBRARY_GLYPH_SLOTS.find((s) => s.nav === navKey);
  if (!slot) return fallback;
  return resolveLibraryGlyphClass(libraryGlyphPrefs, slot.key);
}

// Boot: one fetch, graceful about everything. A signed-out shell, an offline
// device or a failed request all leave every entry on its shipped glyph, which
// is exactly today's look - never a blank.
async function initLibraryGlyphs() {
  if (typeof document === 'undefined' || typeof fetch !== 'function') return;
  const me = await fetchCurrentUser(); // shared with the display-pref pull
  if (!me) return;                      // signed-out/offline: shipped glyphs stand
  applyLibraryGlyphs(me.settings);
}

// ---- v1.63.1: the hide-the-fake-stars display pref (Dean) -------------------
// The star ratings are the DETERMINISTIC MOCK (getStarRating) - real-looking,
// deliberately fake, and now optional. ONE root class (.ft-hide-stars) + one
// CSS rule hides EVERY star writer at once (watch's #star-rating-control,
// the cards' .card-rating rows, and any future writer - the gate lives in
// CSS, so a new writer cannot forget it). Same mirror pattern as
// theme/era/icons: localStorage is the device truth, the user record is the
// cross-device seed.

const STAR_RATINGS_VALUES = ['shown', 'hidden'];

// Pure: default and garbage both mean SHOWN (today's look).
function shouldShowStarRatings(stored) {
  return stored !== 'hidden';
}

function applyStarRatingsPref(value, opts) {
  const v = STAR_RATINGS_VALUES.includes(value) ? value : 'shown';
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('ft-hide-stars', !shouldShowStarRatings(v));
  }
  try { localStorage.setItem('ft-star-ratings', v); } catch (_) { /* storage off - session-only */ }
  // Slim gate S4: the settings checkbox re-reflects when the async seed
  // lands after the page wired it (fresh-device race).
  if (typeof document !== 'undefined') {
    const check = document.getElementById('hide-stars-check');
    if (check) check.checked = !shouldShowStarRatings(v);
  }
  if (opts && opts.mirror) mirrorUserSetting({ starRatings: v });
}

// Boot re-apply (never mirrors - the mirror fires only from the explicit
// user-change site, the settings-page toggle).
function bootStarRatingsPref() {
  let stored = null;
  try { stored = localStorage.getItem('ft-star-ratings'); } catch (_) { /* storage off */ }
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('ft-hide-stars', !shouldShowStarRatings(stored));
  }
}

// ---- v1.79: the home feed vs classic-grid toggle ---------------------------
//
// Same mirror posture as the stars pref: localStorage is the DEVICE truth, the
// user record is the CROSS-DEVICE seed. Default OFF (absent -> classic) so
// existing installs are byte-unchanged; net-new accounts are seeded 'on'
// server-side (NEW_USER_DEFAULT_SETTINGS in server.js) so new setups get the
// feed out of the box. homeFeedEnabled() is read SYNCHRONOUSLY by main.js at
// home-view init - on a brand-new device the async seed below may not have
// landed yet, so the very first bare-home paint is classic and self-corrects on
// the next navigation (the identical one-time race the stars seed accepts).
const HOME_FEED_VALUES = ['on', 'off'];

function homeFeedEnabled() {
  try { return localStorage.getItem('ft-home-feed') === 'on'; } catch (_) { return false; }
}

function applyHomeFeedPref(value, opts) {
  const v = value === 'on' ? 'on' : 'off';
  try { localStorage.setItem('ft-home-feed', v); } catch (_) { /* storage off - session only */ }
  if (typeof document !== 'undefined') {
    const check = document.getElementById('home-feed-check');
    if (check) check.checked = v === 'on'; // re-reflect when the async seed lands after wiring
  }
  if (opts && opts.mirror) mirrorUserSetting({ homeFeed: v });
}

// Boot seed - its OWN fetch-sharing path, deliberately NOT folded under
// pullMirroredDisplayPrefs' all-four-chosen early return (the v1.63.1 scar
// where a seed placed below that return never ran on customized devices).
async function bootHomeFeedPref() {
  let stored = null;
  try { stored = localStorage.getItem('ft-home-feed'); } catch (_) { return; /* no storage */ }
  if (stored !== null) return; // the device has already chosen -> homeFeedEnabled reads it
  if (typeof fetch !== 'function') return;
  const me = await fetchCurrentUser(); // shared, memoized
  if (!me) return;                      // signed-out/offline: classic stands
  const s = me.settings || {};
  if (HOME_FEED_VALUES.includes(s.homeFeed)) applyHomeFeedPref(s.homeFeed); // seed, no mirror
}

// ---- v1.84: Modern YouTube Mode toggle -------------------------------------
//
// A THIRD home-layout option (a flat big-tile grid with a filter-chip row and,
// on mobile, a recent-uploader avatar bar), orthogonal to the era themes. Same
// mirror posture as homeFeed: localStorage is the DEVICE truth, the user record
// the CROSS-DEVICE seed. Default OFF (absent -> not modern) so existing installs
// are byte-unchanged and NEW_USER_DEFAULT_SETTINGS is NOT touched. Unlike
// homeFeed, this also reflects a `data-modern` attribute on <html> so the CSS
// can restyle the grid without a paint of the classic look first.
// modernModeEnabled() is read SYNCHRONOUSLY by main.js at home-view init;
// precedence is modern > feed > classic.
const MODERN_MODE_VALUES = ['on', 'off'];

function modernModeEnabled() {
  try { return localStorage.getItem('ft-modern-mode') === 'on'; } catch (_) { return false; }
}

function applyModernModePref(value, opts) {
  const v = value === 'on' ? 'on' : 'off';
  try { localStorage.setItem('ft-modern-mode', v); } catch (_) { /* storage off - session only */ }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-modern', v);
    const check = document.getElementById('modern-mode-check');
    if (check) check.checked = v === 'on'; // re-reflect when the async seed lands after wiring
  }
  if (opts && opts.mirror) mirrorUserSetting({ modernMode: v });
}

// v1.84 Modern Mode: the filter-chip param allowlist (the CLIENT half of the
// server's MODERN_GRID_FILTERS in lib/home/feed.js - a source-lock test binds
// the two equal so they cannot drift). resolveModernChip bounds a stored/clicked
// chip exactly as the server bounds ?filter=.
const MODERN_CHIP_FILTERS = ['all', 'videos', 'audio', 'podcasts', 'continue', 'unwatched'];

function resolveModernChip(raw) {
  return MODERN_CHIP_FILTERS.includes(raw) ? raw : 'all';
}

// v1.86.0 (Dean): the modern-home header sort options as [value, label]. The
// values are the CLIENT half of the server's MODERN_GRID_SORTS (lib/home/feed.js)
// - a source-lock test binds the two equal so they cannot drift. Labels mirror
// the classic index.html #sort-menu. main.js's modern header ▾ builds its menu
// from this list; resolveModernSort bounds a stored/clicked value exactly as the
// server bounds ?sort=. (Top-level const in this classic script -> visible to
// main.js via the shared global scope, like MODERN_CHIP_FILTERS.)
const MODERN_SORT_OPTIONS = [
  ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['release-date', 'Release date'],
  ['title-asc', 'Title (A–Z)'], ['title-desc', 'Title (Z–A)'],
  ['size-desc', 'Largest first'], ['size-asc', 'Smallest first'], ['random', 'Feeling lucky'],
];
const MODERN_SORT_DEFAULT = 'newest';
function resolveModernSort(raw) {
  return MODERN_SORT_OPTIONS.some(([v]) => v === raw) ? raw : MODERN_SORT_DEFAULT;
}

// v1.84: the BARE-HOME layout decision - precedence modern > feed > classic.
// Pure + exported so the precedence is unit-bound (not merely asserted by
// reading main.js's gate). Only a bare home (no search/folder/root/liked/subs)
// that is not force-gridded (?browse=1) can be modern or feed.
function resolveHomeLayout(opts) {
  const o = opts || {};
  if (!o.bareHome || o.forceGrid) return 'classic';
  if (o.modern) return 'modern';
  if (o.feed) return 'feed';
  return 'classic';
}

// v1.84 T5: the per-card channel avatar DECISION (Modern mode, media cards).
// Pure + exported (the render + escaping stays in main.js's buildVideoCardEl, where
// escapeHtml lives). Returns a descriptor: {kind:'none'} in classic (so the
// classic card is byte-unchanged); {kind:'img',url} when the channel has a photo
// (the SAME channelAvatarUrl the subscription avatars use); else {kind:'mono',
// glyph,color} - the deterministic monogram, its colour carried on the
// descriptor so the caller can put it in an inline custom property (ungoverned
// by the token census; the CSS consumes it via var()).
function modernCardAvatar(channelName, channelAvatarUrl, modernOn) {
  if (!modernOn) return { kind: 'none' };
  const av = resolveAvatarSource(channelName || '', channelAvatarUrl);
  if (av.type === 'url') return { kind: 'img', url: av.url };
  return { kind: 'mono', glyph: av.glyph, color: av.color };
}

// v1.84 T4: the mobile channel-avatar bar's selection - the SUBSCRIBED channels
// that most recently uploaded. Pure over /api/channels' rows
// ({folder,name,avatarUrl,latestAddedAt,isSub}): keep subs with a real recency,
// newest-first, capped. Never mutates the input; a non-array is empty.
function selectRecentUploaderChannels(channels, cap) {
  const n = typeof cap === 'number' && cap > 0 ? cap : 12;
  return (Array.isArray(channels) ? channels : [])
    .filter((c) => c && c.isSub === true && typeof c.latestAddedAt === 'number' && c.latestAddedAt > 0)
    .slice()
    .sort((a, b) => b.latestAddedAt - a.latestAddedAt)
    .slice(0, n);
}

// Boot: reflect the device's known value onto <html> IMMEDIATELY (no fetch, no
// flash), then - only if the device has never chosen - seed from the user
// record on its OWN fetch-sharing path (the same v1.63.1 scar the home-feed
// seed sidesteps: a seed under pullMirroredDisplayPrefs' early return never ran
// on customized devices).
async function bootModernModePref() {
  let stored = null;
  try { stored = localStorage.getItem('ft-modern-mode'); } catch (_) { stored = null; }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-modern', stored === 'on' ? 'on' : 'off');
  }
  if (stored !== null) return; // the device has chosen -> modernModeEnabled reads it
  if (typeof fetch !== 'function') return;
  const me = await fetchCurrentUser(); // shared, memoized
  if (!me) return;                      // signed-out/offline: not-modern stands
  const s = me.settings || {};
  if (MODERN_MODE_VALUES.includes(s.modernMode)) applyModernModePref(s.modernMode); // seed, no mirror
}

// ---- F1: deterministic avatar fallback (v1.24.0, T3; identicon glyph C3/T12) -
//
// Replaces the old "first letter on a fixed color" uploader/channel avatar
// (e.g. watch.html's `.uploader-avatar` today always renders `var(--yt-red)`
// -- the LETTER was the only thing that ever varied) with a genuinely
// deterministic per-name avatar: same input name -> same {glyph, color}
// EVERY time, and different names are visually distinguishable by BOTH color
// and glyph, not just by letter. `AVATAR_PALETTE` is deliberately literal hex
// values lifted from this file's own THEME_REGISTRY swatch tokens (+ their
// CSS "-dark" companions from style.css's :root blocks) rather than a
// brand-new, unrelated color set, so a generated avatar always harmonizes
// with the retro era-theme system already on screen. Pure/DOM-free --
// unit-tested directly, no browser needed.
const AVATAR_PALETTE = [
  '#0000cc', // 2005 era accent (link blue)
  '#cc0000', // 2009/2021 era accent (--yt-red)
  '#990000', // 2009/2021 era accent-dark (--yt-red-dark)
  '#e62117', // 2014 era accent
  '#c1160f', // 2014 era accent-dark
  '#4a154b', // existing video-placeholder purple (server.js thumbnail fallback)
  '#2b3e50', // existing audio-placeholder navy (server.js thumbnail fallback)
];

// Pure, deterministic string hash (djb2 variant) -- same string always
// produces the same non-negative integer, on any platform/Node version
// (no reliance on object iteration order, Math.random, or locale). Used only
// to pick a stable index into AVATAR_PALETTE; never used for anything
// security-sensitive.
function hashAvatarSeed(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0; // hash*33 + c
  }
  return Math.abs(hash);
}

// Pure: `name` -> a deterministic `{ glyph, color }` pair. The glyph is the
// channel/uploader name's own first letter, uppercased -- a recognizable
// mnemonic ("Alice" -> "A") -- paired with a hash-generated, deterministic
// palette color so two names sharing a first letter still look visually
// distinguishable by color even though the glyph matches. A blank/missing
// name falls back to a literal '?' glyph (still deterministic -- always maps
// to the same palette color) rather than throwing or rendering empty; note
// `'?'.charAt(0).toUpperCase() === '?'`, so no special-case branch is needed
// for it. Exported for node:test; this is the FROZEN contract `watch.js`
// (T4, same wave) imports as a global (see eslint.config.js's
// consumer-globals block).
//
// GD-1 (v1.30.0, gate resolution): C3/T12 briefly changed the glyph to a
// hash-selected letter from a fixed alphabet (independent of the name's own
// first letter), flagged at the time as a conservative-but-debatable call.
// Both two-reviewer-gate reviewers (QA + adversarial) independently judged
// that this lost the recognizable first-letter mnemonic without serving
// Dean's "recognizable/deterministic avatar" intent as well as first-letter
// + deterministic color, so it was reverted here per unanimous reviewer
// consensus (recorded on the Dean-on-device ledger; Dean may re-open on his
// on-device pass). The deterministic hash-based COLOR from that same change
// is kept.
function deriveAvatar(name) {
  const label = typeof name === 'string' ? name.trim() : '';
  const safeLabel = label !== '' ? label : '?';
  const seed = hashAvatarSeed(safeLabel);
  const glyph = safeLabel.charAt(0).toUpperCase();
  const color = AVATAR_PALETTE[seed % AVATAR_PALETTE.length];
  return { glyph, color };
}

// Pure: the avatar PRECEDENCE every uploader/channel avatar render site
// should apply -- a real captured `channelAvatarUrl` (C6, populated by T11 in
// Wave 3; always absent/null today) wins when present and non-blank, else
// falls back to the deterministic `deriveAvatar(name)`. Building this seam
// now (rather than in T11) means T11 never has to re-touch a client render
// site -- it only ever needs to start POPULATING the field server-side.
// Returns either `{ type: 'url', url }` or `{ type: 'generated', glyph, color }`.
function resolveAvatarSource(name, channelAvatarUrl) {
  if (typeof channelAvatarUrl === 'string' && channelAvatarUrl.trim() !== '') {
    return { type: 'url', url: channelAvatarUrl.trim() };
  }
  const generated = deriveAvatar(name);
  return { type: 'generated', glyph: generated.glyph, color: generated.color };
}

// ---- Icon-set system ------------------------------------------------------
// A third, orthogonal appearance axis (theme x mode x icon-set) layered on
// top of the era/mode system above, with no change to resolveTheme/
// applyTheme/toggleTheme. See docs/exec-plans/completed/2026-07-05-icon-sets.md for the
// full design. Two axes: a persisted `ft-icons` preference (one of the 3
// concrete sets, or the meta-value 'auto') and a `data-icons` attribute on
// <html> that always holds one of the 3 CONCRETE values - 'auto' is never
// written to data-icons.
//
// UI pass D2.6: the fourth set, 'emoji', is retired. A RETIRED value still
// arrives from older storage: this device's ft-icons, the prefs-sync row, or
// the v1.43 user-settings mirror. It resolves through LEGACY_ICON_SET_MAP
// (emoji -> filled) and is never rewritten on boot: a boot write would
// re-stamp the pref and beat a newer choice from another device (the
// prefs-sync last-BOOT-wins class). The inline FOUC bootstraps in every
// shell <head> carry the same mapping.

const ICON_SETS = ['outlined', 'rounded', 'filled'];
const DEFAULT_ICON_SET = 'outlined';
const AUTO_ERA_ICON_MAP = { '2005': 'filled', '2009': 'filled', '2014': 'filled', '2021': 'rounded' };
const LEGACY_ICON_SET_MAP = { emoji: 'filled' };

// Pure: a stored pref with a retired set id becomes its replacement; any
// other value passes through unchanged (validation is resolveIconSet's job).
function migrateIconPref(storedSet) {
  return (typeof storedSet === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_ICON_SET_MAP, storedSet))
    ? LEGACY_ICON_SET_MAP[storedSet] : storedSet;
}

// Single source of truth for the setup-page Icons picker. Auto listed first.
const ICON_SET_REGISTRY = [
  { id: 'auto', name: 'Auto', blurb: 'Matches the icon style to whichever era you\'ve picked.' },
  { id: 'outlined', name: 'Outlined', blurb: 'Material Symbols Outlined — today\'s default look.' },
  { id: 'rounded', name: 'Rounded', blurb: 'Material Symbols Rounded — a softer, modern style.' },
  { id: 'filled', name: 'Filled', blurb: '2014-flavored solid Material icons — the original flat era.' }
];

// Pure: resolves a stored icon-set preference (+ the current era, needed only
// for 'auto') into one of the three CONCRETE set ids. Never throws; never
// returns 'auto'. Exported for node:test - see test/unit/resolve-icon-set.test.js,
// which also runs every shell's inline FOUC bootstrap against this function.
function resolveIconSet(storedSet, era) {
  storedSet = migrateIconPref(storedSet);                     // retired set -> its replacement
  if (ICON_SETS.includes(storedSet)) return storedSet;      // valid explicit set
  if (storedSet === 'auto') {                                // meta -> era map
    const e = THEME_ERAS.includes(era) ? era : DEFAULT_ERA;  // invalid era -> DEFAULT_ERA mapping
    return AUTO_ERA_ICON_MAP[e];
  }
  return DEFAULT_ICON_SET;                                    // null/garbage -> outlined
}

// Resolves the pref against the CURRENT era (read from data-theme), sets
// data-icons to the concrete result, and persists the PREF (never the
// resolved value, so 'auto' survives to recompute on future era changes).
function applyIconSet(storedSetPref) {
  const d = document.documentElement;
  const era = d.getAttribute('data-theme') || DEFAULT_ERA;
  const set = resolveIconSet(storedSetPref, era);
  d.setAttribute('data-icons', set);
  // UI pass step 2: the chrome glyphs draw from the sprite; swap it to the new set.
  if (typeof FTIcons !== 'undefined') FTIcons.inject(set);
  if (storedSetPref === 'auto' || ICON_SETS.includes(storedSetPref)) {
    try { localStorage.setItem('ft-icons', storedSetPref); }
    catch (_) { /* storage disabled — attribute still applied */ }
  }
  // else: unset/garbage pref -> resolves to 'outlined' but DON'T persist, so a
  // fresh/never-chosen user's ft-icons stays UNSET (avoids writing "null").
  if (typeof renderIconPicker === 'function') renderIconPicker(); // re-highlight if present
}

// Setup-page Icons picker entry (no Save step), mirrors setTheme().
function setIconSet(storedSetPref) {
  applyIconSet(storedSetPref);
  if (storedSetPref === 'auto' || ICON_SETS.includes(storedSetPref)) {
    mirrorUserSetting({ icons: storedSetPref }); // v1.43: cross-device seed
  }
}

// DOMContentLoaded: read the stored pref and apply against the loaded era.
function initIconSet() {
  let pref = null;
  try { pref = localStorage.getItem('ft-icons'); } catch (_) { /* fall through to default */ }
  applyIconSet(pref);
}

// Format duration from seconds to MM:SS or HH:MM:SS
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  let result = '';
  if (hrs > 0) {
    result += hrs + ':' + (mins < 10 ? '0' : '');
  }
  result += mins + ':' + (secs < 10 ? '0' : '') + secs;
  return result;
}

// Format file size in bytes to human readable format
function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format date relative time (e.g. "3 days ago")
function formatRelativeTime(epochMs) {
  if (!epochMs) return 'unknown date';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const diffMs = epochMs - Date.now();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  
  if (Math.abs(diffDays) < 1) {
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    if (Math.abs(diffHours) < 1) {
      const diffMins = Math.round(diffMs / (1000 * 60));
      return rtf.format(diffMins, 'minute');
    }
    return rtf.format(diffHours, 'hour');
  }
  
  if (Math.abs(diffDays) > 30) {
    const diffMonths = Math.round(diffDays / 30);
    return rtf.format(diffMonths, 'month');
  }
  
  return rtf.format(diffDays, 'day');
}

// GB <-> bytes conversion for the Settings-page "Transcode cache" size-cap
// input: users think in GB, but the API persists/consumes raw bytes
// (`cacheMaxBytes`). Both pure/side-effect-free so they're reusable from the
// setup.html inline script and independently unit-testable.

// '' / null / undefined / non-finite / <=0 -> null, meaning "no override, use
// the default" (mirrors the API's own null = defer-to-env-var contract).
// Otherwise rounds to the nearest whole byte -- EXCEPT a tiny positive input
// that rounds to < 1 byte, which is also clamped to null rather than 0: the
// API rejects cacheMaxBytes:0 with a 400, so posting 0 for "I typed something
// tiny" would surface a misleading validation error instead of just using the
// default.
function gbToBytes(gb) {
  if (gb === '' || gb === null || gb === undefined) return null;
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0) return null;
  const bytes = Math.round(n * 1024 * 1024 * 1024);
  if (bytes < 1) return null; // sub-1-byte positive -> "no override", not an invalid 0
  return bytes;
}

// null/undefined/non-finite -> null (no value to display). Otherwise bytes
// converted to GB, rounded to 2 decimal places for a clean input/placeholder value.
function bytesToGb(bytes) {
  if (bytes === null || bytes === undefined) return null;
  const n = Number(bytes);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / (1024 * 1024 * 1024)) * 100) / 100;
}

// Resolve the "channel"/author name for a media item, the same way everywhere:
// FR-2 (v1.20.0)'s captured `item.channelName` (a yt-dlp download's real
// channel/uploader name) ranks FIRST when present -- see
// docs/exec-plans/completed/2026-07-08-v1.20-subscribe.md ("Creator display
// precedence"). It ranks first ONLY when present, so a non-yt-dlp file (or a
// pre-feature download with no captured identity) falls through to the
// UNCHANGED existing chain: the mapped folder's friendly display name (if
// set), else the file's artist tag, else the immediate folder name. Keeps the
// list cards and the watch page in agreement (both call this).
// v1.114 (Dean, "A2"): a channelName that captured the "@handle" ("@Apple")
// shows the handle instead of the name. Strip a SINGLE leading "@" for DISPLAY
// only (read-layer, no data mutation) -- a YouTube channel DISPLAY name never
// starts with "@" (that is the handle syntax), so this only ever cleans a
// handle-stored-as-the-name. Pure; a non-string / non-handle passes through
// unchanged; "@@x" -> "@x" (single strip, intentional).
// Applied at every channel-name DISPLAY surface: this common.js file
// (resolveChannelName + the bell/queue row models + the pinned-sidebar render),
// and -- because the server does not require client code -- the same one-liner
// is INLINED at server.js /api/channels, public/js/history.js and public/js/
// setup.js's Feed-Hidden row (their own renderers, not buildVideoCardEl). Change
// the rule -> update all four sites (a small, accepted duplication).
function displayChannelName(name) {
  return typeof name === 'string' && name.charAt(0) === '@' ? name.slice(1) : name;
}

// v1.126: the per-channel-folder display map ({ [folderName]: displayName }),
// served on GET /api/config beside folderSettings and cached ONCE at shell
// level so every resolveChannelName caller (cards, the related rail, bell/
// queue rows, headers) gets the fallback without a signature change. The
// setter is called by whichever controller fetches /api/config (main.js,
// watch.js); the cache survives SPA navigation because common.js is
// shell-owned. Written by the "Refresh channel names" reconcile and the
// manual rename route - the ONLY name source for permanently-unhealable
// folders (no channelId, no URL anywhere in their items).
let folderDisplayNamesCache = {};
function setFolderDisplayNames(map) {
  folderDisplayNamesCache = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
}
function folderDisplayName(folderName) {
  const mapped = folderDisplayNamesCache[folderName];
  return (typeof mapped === 'string' && mapped.trim() !== '') ? mapped.trim() : null;
}

function resolveChannelName(item, folderSettings) {
  if (item && typeof item.channelName === 'string' && item.channelName.trim() !== '') {
    return displayChannelName(item.channelName.trim());
  }
  // v1.126: the folder display map beats the raw folderName - this is what
  // heals the related rail (and every other item surface) for items whose
  // channelName can never self-heal.
  const dirMapped = item && typeof item.folderName === 'string' ? folderDisplayName(item.folderName) : null;
  if (dirMapped) return displayChannelName(dirMapped);
  const settings = folderSettings || {};
  const mapped = settings[item.rootFolder] && settings[item.rootFolder].name;
  return mapped || item.artist || item.folderName || 'Library';
}

// v1.122 (Dean): the `?root=` folder-view HEADER prefers the CHANNEL the
// folder's items resolve to -- but only when they ALL agree on exactly one
// non-empty name (a healed channel folder). A mixed folder (e.g. a junk-drawer
// holding many channels) or an empty page keeps the caller's existing folder
// label -- never a guess. Pure; reuses resolveChannelName so this can never
// diverge from what the cards themselves display.
function resolveRootHeaderLabel(items, folderSettings, fallbackLabel) {
  const list = Array.isArray(items) ? items : [];
  let only = null;
  for (const item of list) {
    if (!item) continue;
    const name = resolveChannelName(item, folderSettings);
    if (only === null) only = name;
    else if (name !== only) return fallbackLabel; // mixed folder -- keep the folder label
  }
  return (typeof only === 'string' && only.trim() !== '') ? only : fallbackLabel;
}

// ---- FR-2 channel-identity matcher (T2, v1.20.0) ---------------------------
// See docs/exec-plans/completed/2026-07-08-v1.20-subscribe.md ("Matcher") for the
// full design/rationale. Pure, client-side, node:test-covered -- the server
// never needs to match a file to a subscription, so this lives entirely in
// common.js. Conservative by construction: two URL shapes that cannot be
// PROVEN to name the same channel never produce the same canonical key -- when
// in doubt, no match (never a false positive). Never naive string `===` on two
// channel URLs of differing shape.

// Self-contained allowlist -- deliberately duplicated from (not imported from)
// lib/ytdlp/url.js's server-side ALLOWED_HOSTS, since this file is a vanilla
// browser script with no module dependency on the Node-only yt-dlp lib.
const CHANNEL_URL_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

// Canonicalize a YouTube channel URL to a stable key, or `null` when the URL
// is not a recognizable CHANNEL identity: an unparseable/non-string input, an
// unrecognized host, or a single-VIDEO URL (`youtu.be/<id>` or `/watch?v=`,
// neither of which is a channel identity). Recognized shapes: `/channel/<id>`
// -> `channel:<id>` (case PRESERVED -- channel ids are case-sensitive);
// `/@handle` -> `handle:<lowercased>`; `/user/<name>` -> `user:<lowercased>`;
// `/c/<name>` -> `c:<lowercased>` (host case-folded; path case only folded for
// the handle/user/c shapes, where casing is not meaningfully distinct on
// YouTube). Anything else unrecognized -> `null` (conservative -- never
// guesses). Exported for node:test.
function canonicalizeChannelUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!CHANNEL_URL_HOSTS.has(host)) return null;

  // youtu.be's entire path IS a video id -- never a channel identity.
  if (host === 'youtu.be') return null;
  // /watch?v=... is a single-video URL on every other allowed host.
  if (parsed.pathname === '/watch') return null;

  const path = parsed.pathname.replace(/\/+$/, ''); // ignore trailing slash(es)

  let m = path.match(/^\/channel\/([A-Za-z0-9_-]+)$/);
  if (m) return `channel:${m[1]}`;
  m = path.match(/^\/@([A-Za-z0-9._-]+)$/);
  if (m) return `handle:${m[1].toLowerCase()}`;
  m = path.match(/^\/user\/([A-Za-z0-9._-]+)$/);
  if (m) return `user:${m[1].toLowerCase()}`;
  m = path.match(/^\/c\/([A-Za-z0-9._-]+)$/);
  if (m) return `c:${m[1].toLowerCase()}`;
  return null; // unrecognized shape -- conservative, no false match
}

// Does a subscription's `channelUrl` identify the SAME channel as a file's
// captured identity? Builds the FILE's canonical key-SET from every field
// that can independently prove a channel identity -- `channelUrl`,
// `'channel:' + channelId` (when present), `channelHandleUrl` -- dropping any
// that don't canonicalize, then checks whether the subscription's OWN
// canonical key is a MEMBER of that set. This is set-membership on canonical
// keys, never naive string equality, so a file whose `channelUrl` is
// `/channel/UC...` correctly matches a subscription added as `/@handle` (via
// the shared handle key sourced from `channelHandleUrl`) or as `/channel/UC...`
// (via the channel-id key) -- and never false-matches two forms that can't be
// proven equal. Never throws on a missing/partial identity; a `null`/absent
// `fileIdentity` or an unparseable `subUrl` safely resolves to `false`.
// Exported for node:test.
function channelIdentityMatches(fileIdentity, subUrl) {
  const subKey = canonicalizeChannelUrl(subUrl);
  if (!subKey || !fileIdentity) return false;

  const keys = new Set();
  const urlKey = canonicalizeChannelUrl(fileIdentity.channelUrl);
  if (urlKey) keys.add(urlKey);
  if (typeof fileIdentity.channelId === 'string' && fileIdentity.channelId) {
    keys.add(`channel:${fileIdentity.channelId}`);
  }
  const handleKey = canonicalizeChannelUrl(fileIdentity.channelHandleUrl);
  if (handleKey) keys.add(handleKey);

  return keys.has(subKey);
}

// Single-sources a media item's captured channel identity for FR-1/FR-3 (T3)
// to consume (Subscribe button state derivation via channelIdentityMatches,
// and the show/hide predicate). Returns `null` when the item has no captured
// `channelUrl` -- non-yt-dlp files and pre-feature downloads (AC12) both fall
// here. Never throws on a missing/malformed item.
function resolveFileChannelIdentity(item) {
  if (!item || typeof item.channelUrl !== 'string' || item.channelUrl === '') return null;
  const identity = { channelUrl: item.channelUrl };
  if (typeof item.channelId === 'string' && item.channelId) {
    identity.channelId = item.channelId;
  }
  if (typeof item.channelHandleUrl === 'string' && item.channelHandleUrl) {
    identity.channelHandleUrl = item.channelHandleUrl;
  }
  return identity;
}

// ---- FR-1/FR-3 subscribe toggle + compact modal (T3, v1.20.0) -------------
// See docs/exec-plans/completed/2026-07-08-v1.20-subscribe.md ("FR-1 -- subscribe
// toggle + compact options modal" / "FR-3 -- hide when no channel / module
// disabled") for the full design/rationale. Pure decision helpers first
// (node:test-covered directly); `buildSubscribeModal` is a DOM builder in the
// exact style of `buildOneOffModal` below - a ui.sheet since step 7 - reusing its
// building blocks (`buildOneOffSelect` + `oneOffSelectBox`/`ONEOFF_*`/
// `reduceOneOffFiletypeOptions`), and takes on NO dependency on the gated,
// lazy-loaded `/js/subscriptions.js`.

// v1.25 QoL (T5): pure converters between a subscription's `cutoffDate`
// (the API/yt-dlp `YYYYMMDD` convention -- retires the old "download last N
// videos" `maxVideos` count field, see `lib/ytdlp/store.js`'s
// `validateCutoffDate`) and the value a native `<input type="date">` expects
// (`YYYY-MM-DD`). Duplicated (not shared) in
// `lib/ytdlp/client/subscriptions.js` as `cutoffDateToInputValue`/
// `inputValueToCutoffDate` -- that file is only ever served via the
// enabled-gated route, while this one loads on every page (same posture as
// `reduceOneOffFiletypeOptions`'s duplication of `reduceFiletypeOptions`);
// giving the two copies distinct names also avoids a global-scope function
// redeclaration on the one page (`/subscriptions`) that loads both files as
// plain (non-module) scripts. Both directions are defensive/never throw.
function cutoffDateToDateInput(raw) {
  if (typeof raw !== 'string' || !/^\d{8}$/.test(raw)) return '';
  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  if (month < '01' || month > '12' || day < '01' || day > '31') return '';
  return `${year}-${month}-${day}`;
}

// The inverse of `cutoffDateToDateInput` above. Returns `undefined` (never a
// malformed string) for anything that is not a well-formed `YYYY-MM-DD`
// value, so callers can treat `undefined` as "nothing entered, omit the
// field" and let the server apply its own default -- a brand-new
// subscription resolves to yesterday (`store.addSubscription`), the same
// blank-means-omit posture the retired `maxVideos` field used to have.
function dateInputToCutoffDate(raw) {
  if (typeof raw !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  if (month < '01' || month > '12' || day < '01' || day > '31') return undefined;
  return `${year}${month}${day}`;
}

// Pure (AC15): the Subscribe button is shown iff the yt-dlp module is
// enabled (the existing `/api/subscriptions/health` capability probe) AND the
// current file has a resolvable channel identity (FR-2's
// `resolveFileChannelIdentity`, non-null). Otherwise it must be REMOVED from
// the DOM entirely (`.remove()` -- absent, never merely disabled/greyed) --
// see `decideSubscribeButtonState` below, which callers actually use.
// Exported for node:test.
function shouldShowSubscribeButton({ moduleEnabled, channelIdentity }) {
  return moduleEnabled === true && channelIdentity != null;
}

// Pure reducer combining FR-2's identity derivation + matcher with FR-3's
// show/hide predicate into the single state `public/js/watch.js` needs to
// render the button and wire its click handler: whether it's visible at all,
// whether the CURRENT file already has a matching subscription
// ("Subscribed" vs. "Subscribe"), and -- when subscribed -- which
// subscription id the unsubscribe path should DELETE. `item` is the raw
// `db.metadata`-shaped media object (as returned by `GET /api/videos/:id`);
// `subs` is the raw array from `GET /api/subscriptions`; `moduleEnabled`
// comes from the health probe. Never throws on malformed/missing input --
// mirrors every other pure helper in this file's defensive posture. A
// disabled module (moduleEnabled !== true) always resolves to fully hidden,
// regardless of the file's metadata, preserving the disabled-module
// byte-identical contract (AC17). Exported for node:test.
function decideSubscribeButtonState(item, subs, moduleEnabled) {
  const identity = resolveFileChannelIdentity(item);
  const visible = shouldShowSubscribeButton({ moduleEnabled, channelIdentity: identity });
  if (!visible) {
    return { visible: false, subscribed: false, subId: null, identity: null };
  }
  const list = Array.isArray(subs) ? subs : [];
  const match = list.find((sub) => channelIdentityMatches(identity, sub && sub.channelUrl));
  return {
    visible: true,
    subscribed: Boolean(match),
    subId: match ? match.id : null,
    identity,
  };
}

/**
 * Pure: builds the exact JSON body `POST /api/subscriptions` expects
 * (matching `store.validateSubscriptionInput`'s field names EXACTLY --
 * `channelUrl`/`format`/`quality`/`name`/`cutoffDate`/`skipShorts`/
 * `filetype`, see lib/ytdlp/store.js) from the compact modal's
 * read-only-derived identity plus its editable controls. The
 * `channelUrl`/`name` are the FR-2-derived, already-validated-once values
 * (never a free-text field the user can edit, AC3) -- this function does not
 * (and cannot) weaken or bypass the server's OWN re-validation
 * (`validateSubscriptionInput` -> `validateChannelUrl`), it only shapes the
 * request the same way the existing `/subscriptions` add form already does
 * (mirrors its own body-building, AC7). `rawCutoffDate` is the native
 * `<input type="date">`'s raw string value (`YYYY-MM-DD`, or `''` when
 * empty) -- converted via `dateInputToCutoffDate` the SAME way the add form
 * converts its own cutoff-date field (v1.25 QoL, T5), omitted entirely when
 * blank/invalid so the server falls back to its own default (yesterday)
 * rather than receiving a bogus value.
 */
function buildSubscribeRequestBody(channelUrl, name, format, quality, rawCutoffDate, skipShorts, filetype) {
  const body = { channelUrl, format, quality, skipShorts: Boolean(skipShorts) };
  if (typeof name === 'string' && name.trim() !== '') body.name = name.trim();
  if (filetype !== undefined) body.filetype = filetype;
  const cutoffDate = dateInputToCutoffDate(rawCutoffDate);
  if (cutoffDate !== undefined) body.cutoffDate = cutoffDate;
  return body;
}

/**
 * Builds the Subscribe dialog (the watch page's channel row, sweep S3) -- step 7 (UI pass)
 * moved its SHELL onto ui.sheet, the way sweep S9 moved the one-off download dialog: a bottom
 * sheet on a phone, a dialog on desktop, titled "Subscribe", with the sheet's one Close. It was
 * the last bespoke `.oneoff-modal` shell (a backdrop the caller appended itself). The form
 * reuses `buildOneOffModal`'s building blocks (`buildOneOffSelect` + `oneOffSelectBox`,
 * `ONEOFF_*`, `repopulateOneOffFiletypeSelect`), so it never drifts from the one-off dialog's
 * format<->filetype coupling (AC7).
 *
 * `opts` = `{ channelName, channelUrl, format, signal }` --
 * `channelName`/`channelUrl` are the FR-2-derived, READ-ONLY channel identity
 * (rendered via `textContent` ONLY, AC3/AC30 -- never an editable field);
 * `format` pre-fills the type select from the file's own media type
 * (`'audio'`/`'video'`); `signal` (the view's AbortSignal) closes the sheet when
 * the view goes, so an SPA nav never strands it over the next page. The cutoff-date
 * field (v1.25 QoL, T5 -- retires the old "download last N videos" `defaultMaxVideos`/AC26
 * pre-fill) is always left BLANK on open, never pre-filled with a computed "yesterday" -- an
 * empty field omits `cutoffDate` from the request entirely, letting the
 * server apply its own default at submit time (`store.addSubscription`),
 * which stays correct even if the user takes a while filling out the rest
 * of the form.
 *
 * `handlers` = `{ onConfirm(body), onClose() }` -- decouples DOM construction
 * from the network call, mirroring `buildOneOffModal`'s own
 * `{ onDownload, onClose }` split, so this function stays DOM-only and
 * directly unit-testable in jsdom (no real fetch). `onConfirm` receives the EXACT
 * body `buildSubscribeRequestBody` produces -- the caller (`watch.js`) is the only
 * place that ever calls `fetch('/api/subscriptions')`. Every way out but Subscribe
 * (Cancel, Close, Esc, the scrim, a drag down, the signal) closes the sheet and calls
 * `onClose` once (through `onClosing`); none of them calls `onConfirm`. v1.289's
 * drag-safe dismiss holds by construction: the scrim is a SIBLING of the sheet, so a
 * text-selection drag from a field onto it clicks their common ancestor, never the scrim.
 * The caller opens it (`sheet.open()`).
 *
 * SECURITY: the ONLY dynamic strings ever rendered into this dialog are the
 * read-only `channelName`/`channelUrl` identity block and the status line, all via
 * `textContent` (never `innerHTML`) -- there is no free-text field for either, so there
 * is no way for a user (or a hostile captured value) to inject markup through it.
 */
function buildSubscribeModal(doc, opts, handlers) {
  const d = doc || document;
  const o = opts || {};
  const h = handlers || {};
  const U = overlayUiLib();

  const modal = d.createElement('div');
  modal.className = 'oneoff-form subscribe-form';

  // READ-ONLY channel identity -- textContent only, AC3/AC30. Never an
  // editable input: the channelUrl that reaches POST /api/subscriptions is
  // ALWAYS the FR-2-derived value the caller passes in, not anything typed
  // here.
  const identity = d.createElement('div');
  identity.className = 'subscribe-form__identity';
  const identityName = d.createElement('div');
  identityName.className = 'subscribe-form__name';
  identityName.textContent = typeof o.channelName === 'string' && o.channelName ? o.channelName : 'This channel';
  identity.appendChild(identityName);
  const identityUrl = d.createElement('div');
  identityUrl.className = 'subscribe-form__url';
  identityUrl.textContent = typeof o.channelUrl === 'string' ? o.channelUrl : '';
  identity.appendChild(identityUrl);
  modal.appendChild(identity);

  const row = d.createElement('div');
  row.className = 'oneoff-modal-selects';

  const initialFormat = o.format === 'audio' ? 'audio' : 'video';
  const formatSelect = buildOneOffSelect(d, ONEOFF_FORMAT_OPTIONS, initialFormat);
  formatSelect.setAttribute('aria-label', 'Format');
  row.appendChild(oneOffSelectBox(d, formatSelect));

  const qualitySelect = buildOneOffSelect(
    d,
    ONEOFF_QUALITY_OPTIONS.map((q) => ({ value: q, label: q })),
    ONEOFF_DEFAULT_QUALITY
  );
  qualitySelect.setAttribute('aria-label', 'Quality');
  row.appendChild(oneOffSelectBox(d, qualitySelect));

  const filetypeSelect = buildOneOffSelect(d, ONEOFF_FILETYPE_OPTIONS[initialFormat], ONEOFF_DEFAULT_FILETYPE[initialFormat]);
  filetypeSelect.setAttribute('aria-label', 'File type');
  row.appendChild(oneOffSelectBox(d, filetypeSelect));

  formatSelect.addEventListener('change', () => {
    repopulateOneOffFiletypeSelect(d, formatSelect.value, filetypeSelect);
  });

  modal.appendChild(row);

  // v1.25 QoL (T5): cutoff-DATE input, replacing the old "download last N
  // videos" count field -- everything published on/after this date
  // downloads, no count cap (matches the add-subscription form's own field,
  // T1's `cutoffDate` schema). Left BLANK by default (see this function's
  // doc comment above) -- `aria-label` gives it an accessible name since
  // this compact form has no visible `<label>` for it (placeholder text alone
  // is not a substitute for assistive tech, and a date input has no
  // meaningful placeholder anyway). A ui-field input (16px, the focus ring).
  const cutoffDateInput = d.createElement('input');
  cutoffDateInput.type = 'date';
  cutoffDateInput.className = 'ui-field__input';
  cutoffDateInput.setAttribute('aria-label', 'Download videos published on or after');
  const dateField = d.createElement('div');
  dateField.className = 'ui-field';
  dateField.appendChild(cutoffDateInput);
  const cutoffDateHint = d.createElement('p');
  cutoffDateHint.className = 'ui-field__help';
  cutoffDateHint.textContent = 'Default: yesterday — only new videos going forward. Set an earlier date to pull history.';
  dateField.appendChild(cutoffDateHint);
  modal.appendChild(dateField);

  // Skip-Shorts toggle, default OFF (mirrors the existing add-subscription
  // form's own default -- download everything unless the user opts out). The
  // ui-switch on a native checkbox (sweep S8), labelled by its row.
  const skipShortsLabel = d.createElement('label');
  skipShortsLabel.className = 'subscribe-form__toggle';
  const skipShortsText = d.createElement('span');
  skipShortsText.textContent = 'Skip Shorts';
  const skipShortsCheck = d.createElement('input');
  skipShortsCheck.type = 'checkbox';
  skipShortsCheck.className = 'ui-switch';
  skipShortsCheck.setAttribute('role', 'switch');
  skipShortsCheck.checked = false;
  skipShortsLabel.appendChild(skipShortsText);
  skipShortsLabel.appendChild(skipShortsCheck);
  modal.appendChild(skipShortsLabel);

  const statusEl = d.createElement('div');
  statusEl.className = 'oneoff-modal-status';
  statusEl.setAttribute('aria-live', 'polite');
  modal.appendChild(statusEl);

  // Cancel / Subscribe: the dialog's action row (the one primary action is Subscribe).
  const actionsRow = d.createElement('div');
  actionsRow.className = 'ui-confirm__actions subscribe-form__actions';
  const cancelBtn = U.button({ variant: 'secondary', label: 'Cancel', doc: d });
  const confirmBtn = U.button({ variant: 'primary', label: 'Subscribe', doc: d });
  actionsRow.appendChild(cancelBtn);
  actionsRow.appendChild(confirmBtn);
  modal.appendChild(actionsRow);

  const sheet = U.sheet({
    variant: 'auto', title: 'Subscribe', content: modal,
    onClosing: () => { if (typeof h.onClose === 'function') h.onClose(); },
    signal: o.signal, doc: d, win: d.defaultView,
  });
  const closeBtn = sheet.el.querySelector('.ui-sheet__close');

  // Cancel closes the sheet; onClose runs once, through onClosing (the same path as
  // Close, Esc, the scrim and a drag).
  cancelBtn.addEventListener('click', () => { sheet.close(); });
  confirmBtn.addEventListener('click', () => {
    if (!sheet.isOpen()) return; // a tap on a dialog on its way out answers nothing
    const body = buildSubscribeRequestBody(
      o.channelUrl,
      o.channelName,
      formatSelect.value,
      qualitySelect.value,
      cutoffDateInput.value,
      skipShortsCheck.checked,
      filetypeSelect.value
    );
    if (typeof h.onConfirm === 'function') h.onConfirm(body);
  });

  // Renders an error string (or clears it) -- textContent only, never
  // innerHTML, no matter what the server's validation error contains.
  function setError(message) {
    statusEl.textContent = message || '';
  }

  return {
    sheet, backdrop: sheet.scrim, modal, closeBtn, identityName, identityUrl,
    formatSelect, qualitySelect, filetypeSelect, cutoffDateInput, skipShortsCheck,
    confirmBtn, cancelBtn, statusEl, setError,
  };
}

// ---- Audio thumbnail-as-background art (resolveAudioArtUrl) ---------------
// See docs/exec-plans/completed/2026-07-05-audio-art-and-related.md ("Feature 1")
// for the full feasibility finding/design. Resolve the background-art image
// URL for an audio item, or null when the item would only resolve to the SVG
// placeholder (no real extracted thumbnail). GET /thumbnail/:id (server.js)
// never 404s, but a stretched 160x90 placeholder makes a poor full-bleed
// background, so callers use null to SKIP the art layer (leave it hidden and
// fall back to today's plain poster/black) rather than stretch the
// placeholder. Pure and deterministic; never throws on a missing/null item.
function resolveAudioArtUrl(item) {
  if (!item || !item.id || !item.hasThumbnail) return null;
  return `/thumbnail/${item.id}`;
}

// ---- Related-items similarity ranking (rankRelated) -----------------------
// See docs/exec-plans/completed/2026-07-05-audio-art-and-related.md ("Feature 2")
// for the full design/rationale. Pure and deterministic; replaces the
// most-recent/same-folder sort previously inline in watch.js's
// loadRelatedFiles(). Named constants below are the score weights + the
// fallback/result-size guarantees.

// v1.48 item 3 (Dean): raised 10 -> 20 so the related list runs to roughly the
// length of the comment list beside it. NOTE the honest trade-off: rankRelated
// concatenates similar + recent and slices (see the SIMILAR_FLOOR note below),
// so on a small library the extra 10 slots are filled from the most-recent tail
// rather than from genuinely-similar items. That padding already happened at
// 10; this doubles how much of it is visible, which is the accepted cost of
// matching the comment-column length.
const RESULT_COUNT = 20;
// "Genuinely similar" guarantee point: whenever fewer than 6 candidates clear
// score > 0, the shortfall is filled from the most-recent tail (today's exact
// fallback behavior). NOTE: there is no literal `if (similar.length <
// SIMILAR_FLOOR)` branch below — rankRelated always concatenates
// similar + recent and slices to RESULT_COUNT, a safe superset that satisfies
// this guarantee unconditionally (recent already contains every candidate, so
// the guarantee holds whether similar has 0, 5, or 50 entries). SIMILAR_FLOOR
// exists to document/name that guarantee point, not to gate a code path.
const SIMILAR_FLOOR = 6;
const W_TOKEN = 3;   // per shared title/filename/tag token (primary signal)
const W_FOLDER = 2;  // same non-empty folderName (secondary signal)
const W_CHANNEL = 1; // same resolved channel/artist, cross-folder only (tertiary)

// Small, fixed stopword set: articles/conjunctions/prepositions plus common
// media-noise tokens that would otherwise inflate "similarity" on every item.
const RANK_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'feat', 'ft', 'official', 'video', 'audio', 'hd', 'mp3', 'mp4', 'avi',
  'mkv', 'mov', 'webm'
]);

// Lowercase, split on non-alphanumeric runs, drop <2-char tokens and the
// stopword set above, dedupe. Never throws; non-string/empty input yields an
// empty Set. Exported for node:test — see test/unit/rank-related.test.js.
function tokenize(str) {
  const tokens = new Set();
  if (typeof str !== 'string' || !str) return tokens;
  const parts = str.toLowerCase().split(/[^a-z0-9]+/);
  for (const part of parts) {
    if (part.length < 2) continue;
    if (RANK_STOPWORDS.has(part)) continue;
    tokens.add(part);
  }
  return tokens;
}

// An item's token set = tokenize(title) UNION tokenize(basename of filePath)
// UNION tokenize(the tags field). tags is optional; missing/null contributes
// nothing. tags may be:
//  - an OBJECT (the real /api/videos shape, e.g. { artist, album, title,
//    comment, date, ... } from server.js's parseFfprobeTags) -> tokenize the
//    joined string VALUES (Object.values filtered to strings), so embedded
//    artist/album/title metadata contributes to similarity;
//  - an ARRAY (kept for safety/forward-compat) -> tokenize each entry;
//  - a plain STRING -> tokenize it directly.
// Missing title/filePath contribute nothing. Never throws.
function relatedItemTokens(item) {
  const tokens = new Set();
  if (!item) return tokens;
  for (const t of tokenize(item.title)) tokens.add(t);
  if (typeof item.filePath === 'string' && item.filePath) {
    const base = item.filePath.split(/[\\/]/).pop() || '';
    for (const t of tokenize(base)) tokens.add(t);
  }
  const tags = item.tags;
  if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
    const values = Object.values(tags).filter((v) => typeof v === 'string');
    for (const t of tokenize(values.join(' '))) tokens.add(t);
  } else if (Array.isArray(tags)) {
    for (const tag of tags) {
      for (const t of tokenize(tag)) tokens.add(t);
    }
  } else if (typeof tags === 'string') {
    for (const t of tokenize(tags)) tokens.add(t);
  }
  return tokens;
}

function sharedTokenCount(setA, setB) {
  let count = 0;
  for (const t of setA) if (setB.has(t)) count++;
  return count;
}

// Explicit total-order tie-break: addedAt DESC (missing sorts as oldest), then
// id ASC. Used both as the similar-set secondary sort and as the whole-list
// "recent" fallback order — never relies on Array.sort's stability alone.
function byRecencyThenId(a, b) {
  const aAdded = Number.isFinite(a.addedAt) ? a.addedAt : -Infinity;
  const bAdded = Number.isFinite(b.addedAt) ? b.addedAt : -Infinity;
  if (bAdded !== aAdded) return bAdded - aAdded;
  const aId = String(a.id || '');
  const bId = String(b.id || '');
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

// Pure. Returns an ordered array of related items (never the current item),
// best-match first, padded with most-recent so the result is never empty and
// never worse than today's most-recent/same-folder list. Length capped at
// RESULT_COUNT. Deterministic for identical input: score DESC, then addedAt
// DESC, then id ASC (see byRecencyThenId) — an explicit total order, not
// left to sort stability.
function rankRelated(currentItem, allItems) {
  const current = currentItem || {};
  const items = Array.isArray(allItems) ? allItems : [];
  const candidates = items.filter((item) => item && item !== current && item.id !== current.id);
  if (candidates.length === 0) return [];

  const currentTokens = relatedItemTokens(current);
  const currentChannel = resolveChannelName(current);
  const currentFolder = current.folderName || '';
  // W_CHANNEL requires an ACTUAL channel signal on both sides, not just a
  // resolveChannelName() match — resolveChannelName falls back to the literal
  // string 'Library' when an item has neither artist nor folderName, so two
  // otherwise-unrelated items that are both missing artist+folderName would
  // both resolve to 'Library' and spuriously "match". Guarding on the raw
  // inputs (rather than coupling to resolveChannelName's internal default)
  // keeps that degenerate case out of the similar bucket.
  const currentHasChannelSignal = !!(current.artist || current.folderName);

  const scored = candidates.map((item) => {
    const shared = sharedTokenCount(currentTokens, relatedItemTokens(item));
    const itemFolder = item.folderName || '';
    const sameFolder = !!currentFolder && !!itemFolder && currentFolder === itemFolder;
    let score = W_TOKEN * shared;
    if (sameFolder) score += W_FOLDER;
    const itemHasChannelSignal = !!(item.artist || item.folderName);
    if (!sameFolder && currentHasChannelSignal && itemHasChannelSignal &&
        resolveChannelName(item) === currentChannel) {
      score += W_CHANNEL;
    }
    return { item, score };
  });

  const byScoreThenRecency = (a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return byRecencyThenId(a.item, b.item);
  };

  const similar = scored.filter((s) => s.score > 0).sort(byScoreThenRecency).map((s) => s.item);
  const recent = candidates.slice().sort(byRecencyThenId); // today's ordering — the fallback pool

  const result = [];
  const seen = new Set();
  for (const item of [...similar, ...recent]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
    if (result.length >= RESULT_COUNT) break;
  }
  return result;
}

// Deterministic "rating" for a media item: a stable 3–5 stars derived from its
// id. Pure and side-effect free, so the SAME item shows the SAME star count on
// the home card and on its own watch page (a fun cosmetic touch, not a real
// user rating).
function getStarRating(id) {
  const s = String(id || '');
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return (sum % 3) + 3; // 3, 4, or 5
}

// Deterministic per-item comment count (4–14): a given video always shows the
// same number of mock comments, but different videos vary. Clamped to the pool
// size so we never ask for more comments than exist.
function getCommentCount(id, poolSize) {
  const s = String(id || '');
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  const count = 4 + (sum % 11); // 4..14
  return poolSize ? Math.min(count, poolSize) : count;
}

// Validate/clamp inputs for MediaSession.setPositionState, which THROWS on bad
// values (non-finite or <= 0 duration, position > duration, etc.). Returns a safe
// { duration, position, playbackRate } — or null when it can't be represented
// (e.g. a live/streaming source with unknown duration) so callers skip the call
// entirely rather than throw. Pure.
function clampPositionState(duration, position, playbackRate) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  let pos = Number(position);
  if (!Number.isFinite(pos) || pos < 0) pos = 0;
  if (pos > duration) pos = duration;
  let rate = Number(playbackRate);
  if (!Number.isFinite(rate) || rate <= 0) rate = 1;
  return { duration, position: pos, playbackRate: rate };
}

// ---- Random ("feeling lucky") sort (v1.14.0 item 1) -----------------------

// Pure Fisher-Yates shuffle: returns a NEW array containing every element of
// `items` exactly once, in a uniformly random order -- never mutates the
// input. `rng` defaults to Math.random but accepts an injected deterministic
// generator (a zero-arg function returning a number in [0, 1)) so this is
// unit-testable without relying on real randomness: the SAME rng call
// sequence always produces the SAME output order. Exported for node:test.
function fisherYatesShuffle(items, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;
  const arr = Array.isArray(items) ? items.slice() : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Pure helper for the `release-date` case only (below) -- an item's captured
// `releaseDate` (epoch ms; populated by T5/T11's scan-time capture, absent
// today) when present, else the existing `addedAt` epoch ms every item
// already has, else 0 (never NaN/undefined, so the comparator below is
// always well-defined). Kept as a small named helper rather than inlined so
// the fallback rule is unit-testable/readable in isolation.
function resolveReleaseDateSortValue(item) {
  if (item && typeof item.releaseDate === 'number' && !Number.isNaN(item.releaseDate)) return item.releaseDate;
  return (item && item.addedAt) || 0;
}

// Pure: the same sort switch previously inlined in renderSorted()
// (public/js/main.js), extracted here so every case -- including the new
// `random` option -- is unit-testable without a browser/DOM harness. Returns
// a NEW array; never mutates `items`. `rng` is only consulted for the
// `random` case (see fisherYatesShuffle above). Unrecognized/missing
// `sortKey` falls back to `newest`, matching the pre-existing switch's
// default branch byte-for-byte (AC: existing 5 sorts unchanged).
//
// C5 (v1.24.0, T3): `release-date` is a NEW, AVAILABLE-ONLY case (never the
// default -- Dean's decision 8) sorting newest-release-first via
// `resolveReleaseDateSortValue` above. Every pre-existing case below is
// untouched byte-for-byte (REGRESSION-locked by test/unit/quickwins-sort.test.js).
function sortItems(items, sortKey, rng) {
  const list = Array.isArray(items) ? items.slice() : [];
  switch (sortKey) {
    case 'oldest': list.sort((a, b) => a.addedAt - b.addedAt); return list;
    case 'title-asc': list.sort((a, b) => (a.title || '').localeCompare(b.title || '')); return list;
    case 'title-desc': list.sort((a, b) => (b.title || '').localeCompare(a.title || '')); return list;
    case 'size-desc': list.sort((a, b) => (b.size || 0) - (a.size || 0)); return list;
    case 'size-asc': list.sort((a, b) => (a.size || 0) - (b.size || 0)); return list;
    case 'random': return fisherYatesShuffle(list, rng);
    case 'release-date': list.sort((a, b) => resolveReleaseDateSortValue(b) - resolveReleaseDateSortValue(a)); return list;
    case 'newest':
    default: list.sort((a, b) => b.addedAt - a.addedAt); return list;
  }
}

// Pure: whether the "shuffle again" re-roll button should be visible for the
// current sort selection -- visible only when `random` is selected. The
// `random` PREFERENCE persists in localStorage exactly like the other sorts;
// the shuffle order itself is ephemeral (re-randomizes on every fresh load
// and on every re-roll click, since sortItems() re-shuffles each call).
// Exported for node:test.
function shouldShowShuffleButton(sortKey) {
  return sortKey === 'random';
}

// ---- Item 2/3 (v1.26.3): shared empty-state / error-state cards -----------
//
// Both replace old per-surface bare inline-styled text (home/library "No
// video or audio files found." + "Error loading library data from server.")
// with ONE consistent, era-token-only `.empty-state`/`.error-state` card
// (see style.css). Pure string builders (mirrors `buildSkeletonGrid` in
// main.js / `buildSkeletonRows` in subscriptions.js) -- `icon`/`message`/
// `hint`/`actionHtml` are always STATIC, developer-authored copy (never
// user- or creator-controlled text), the same posture the rest of this
// file's other static-copy templates already take (e.g.
// `renderPlaylistsSheet`'s "No folders configured." string above); a caller
// that ever needs to interpolate untrusted data into one of these fields
// must escape it itself first. Exported for node:test.

// Pure: the ui-state block (D9, F65) as a markup string - byte-for-byte the DOM ui.state()
// builds (icon disc, title, body, then an action), for the views that render their lists as
// HTML strings. `icon` is a registry name; the legacy `icon-*` names still resolve (the
// glyph sprite, never a mask class). `title` / `body` are developer-authored static copy, as
// every other static template in this file (a caller interpolating untrusted data escapes
// it first). `actionHtml`, when given, is appended as-is (a caller-built, already-safe
// fragment - a ui-btn link). `tone: 'error'` marks a failure state.
const UI_STATE_LEGACY_ICONS = { 'icon-search': 'search', 'icon-folder': 'folder', 'icon-play': 'play_arrow', 'icon-refresh': 'refresh' };
function uiStateHtml(opts) {
  const o = opts || {};
  const raw = typeof o.icon === 'string' && o.icon ? o.icon : '';
  const icon = UI_STATE_LEGACY_ICONS[raw] || raw.replace(/^icon-/, '');
  const iconHtml = icon
    ? `<span class="ui-state__icon"><svg class="ui-icon ui-icon--lg" aria-hidden="true" focusable="false"><use href="#i-${icon.replace(/\./g, '-')}"/></svg></span>`
    : '';
  const body = typeof o.body === 'string' && o.body ? `<p class="ui-state__body">${o.body}</p>` : '';
  const actionHtml = typeof o.actionHtml === 'string' ? o.actionHtml : '';
  return `<div class="ui-state${o.tone === 'error' ? ' ui-state--error' : ''}">` + iconHtml +
    `<h3 class="ui-state__title">${typeof o.title === 'string' ? o.title : ''}</h3>` + body + actionHtml + '</div>';
}

// Pure: home/library empty-result state (no items match the current filter / search /
// folder). Sweep S9 (F65): the ONE ui-state block - `message` is its title, `hint` its body,
// `icon` a registry glyph (default `search`, "nothing found"). Kept as the v1.26.3 entry point
// its callers already use. Exported for node:test.
function buildEmptyStateHtml(opts) {
  const o = opts || {};
  return uiStateHtml({
    icon: typeof o.icon === 'string' && o.icon ? o.icon : 'search',
    title: typeof o.message === 'string' && o.message ? o.message : 'Nothing here yet.',
    body: typeof o.hint === 'string' ? o.hint : '',
    actionHtml: o.actionHtml,
  });
}

// Pure: a failed-load state with a Retry. The Retry is a secondary ui-btn carrying a stable
// `data-error-retry` hook (no id, so several can coexist) - the caller wires its click AFTER
// inserting the markup (bound to its view signal); this builder binds nothing. The failure
// reads as a failure by its `error` glyph and its words, not by red text (F65, D8.8).
function buildErrorStateHtml(opts) {
  const o = opts || {};
  return uiStateHtml({
    icon: 'error',
    tone: 'error',
    title: typeof o.message === 'string' && o.message ? o.message : 'Something went wrong.',
    actionHtml: '<button type="button" class="ui-btn ui-btn--secondary ui-btn--md" data-error-retry><span class="ui-btn__label">Retry</span></button>',
  });
}

// ---- C2/C3: item count + format-toggle library controls (v1.24.0, T3) -----
//
// Client-side only (no server change), injected via createElement/textContent.
// A CALLER (whichever view is rendering the current item list -- home/folder/
// playlist/channel all funnel through the same grid) owns invoking
// `renderItemCountBadge` once per render; the format filter is a dimension of
// the one library chip row (buildFilterChipRow, UI pass sweep S2).

// Pure: item count for a rendered list. Never throws on a non-array input.
function countItems(list) {
  return Array.isArray(list) ? list.length : 0;
}

// Pure: "N items" / "1 item" display text for a count -- kept separate from
// countItems so the exact label text is unit-testable without a DOM.
function formatItemCountLabel(count) {
  const n = Number.isFinite(count) ? count : 0;
  return n === 1 ? '1 item' : `${n} items`;
}

// Idempotently renders/updates a small item-count badge as a SIBLING of
// `headerEl` (e.g. `#videos-section-header`) -- never a child of it, since a
// view's own header text is frequently reassigned via `.textContent` on
// every render (main.js's `videosHeader.textContent = ...`), which would
// silently wipe a child node. Mirrors `renderPinnedSidebar`'s
// sibling-insertion reasoning (below). The de-dupe lookup MUST be scoped to
// `headerEl`'s own parent, never `document.getElementById`: the home view can
// be re-rendered while DETACHED (homeViewCache keeps the node alive with no
// destroy(), and a background `__filetubeRefreshLibrary` re-renders it there).
// A document-wide lookup can't see the detached tree (-> double-append on
// reattach) and, worse, could find-and-remove the LIVE page's badge instead.
// No-ops safely when `headerEl` has no parent yet (defensive; never throws).
function renderItemCountBadge(headerEl, list) {
  if (!headerEl || !headerEl.parentNode) return;
  let badge = headerEl.parentNode.querySelector('#library-item-count');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'library-item-count';
    badge.className = 'library-item-count';
    headerEl.parentNode.insertBefore(badge, headerEl.nextSibling);
  }
  badge.textContent = formatItemCountLabel(countItems(list));
}

// Format-toggle preference persistence -- mirrors the existing sort
// preference pattern exactly (`filetube_sort` in main.js/watch.js/player.js):
// a single localStorage key, validated on read, best-effort (try/catch) on
// write so a private-mode/sandboxed browser never throws.
const FORMAT_FILTER_STORAGE_KEY = 'filetube_format';
const FORMAT_FILTER_MODES = ['both', 'video', 'audio'];

function getStoredFormatFilter() {
  let stored = null;
  try { stored = localStorage.getItem(FORMAT_FILTER_STORAGE_KEY); } catch (_) { /* storage disabled -- fall back to default */ }
  return FORMAT_FILTER_MODES.includes(stored) ? stored : 'both';
}

function setStoredFormatFilter(mode) {
  const normalized = FORMAT_FILTER_MODES.includes(mode) ? mode : 'both';
  try { localStorage.setItem(FORMAT_FILTER_STORAGE_KEY, normalized); } catch (_) { /* storage disabled -- best effort */ }
  return normalized;
}

// v1.45.6 (Dean): library card/list VIEW-MODE preference — per-device, mirrors
// the format-toggle persistence exactly. Default 'card' (today's grid).
const VIEW_MODE_STORAGE_KEY = 'ft-view-mode';
const VIEW_MODES = ['card', 'list'];
function getStoredViewMode() {
  let v = null;
  try { v = localStorage.getItem(VIEW_MODE_STORAGE_KEY); } catch (_) { /* storage disabled */ }
  return VIEW_MODES.includes(v) ? v : 'card';
}
function setStoredViewMode(mode) {
  const normalized = VIEW_MODES.includes(mode) ? mode : 'card';
  try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, normalized); } catch (_) { /* storage disabled */ }
  return normalized;
}

// v1.45.8 (Dean): pull-to-refresh phase from the current pull distance (px) and
// the arm threshold. 'idle' (no downward pull), 'pulling' (below threshold),
// 'ready' (>= threshold → releasing triggers the rescan). Pure — exported for
// node:test; a non-number / non-positive threshold fails safe (idle / 70px).
function pullRefreshState(pullPx, thresholdPx) {
  const px = typeof pullPx === 'number' ? pullPx : 0;
  const t = (typeof thresholdPx === 'number' && thresholdPx > 0) ? thresholdPx : 70;
  if (px <= 0) return 'idle';
  return px >= t ? 'ready' : 'pulling';
}

// v1.86.1 (Dean): a pull is ONLY a vertical gesture. When the drag is
// HORIZONTAL-dominant - swiping a horizontal scroller pinned at the top, i.e. the
// modern avatar bar or the chip row - it must NOT arm pull-to-refresh (Dean: the
// rescan spinner fired constantly while swiping the subscriber circles). Returns
// true for such a drag, but only once the horizontal travel is meaningful (past
// `slopPx`, default 12) AND exceeds the vertical - so the first few noisy px of a
// genuine vertical pull never axis-lock it out. Pure - exported for node:test.
function pullIsHorizontalDrag(dx, dy, slopPx) {
  const ax = Math.abs(typeof dx === 'number' ? dx : 0);
  const ay = Math.abs(typeof dy === 'number' ? dy : 0);
  const slop = (typeof slopPx === 'number' && slopPx > 0) ? slopPx : 12;
  return ax > slop && ax > ay;
}

// v1.45.6 (Dean): PER-PAGE SORT. A CLIENT toggle (like ft-debug-lifecycle) that,
// when on, remembers a separate sort per library page instead of one global
// `filetube_sort`. Default OFF — the global path is byte-unchanged when off.
const PER_PAGE_SORT_FLAG_KEY = 'ft-per-page-sort';
const PER_PAGE_SORT_MAP_KEY = 'ft-sort-by-page';
function isPerPageSortEnabled() {
  try { return localStorage.getItem(PER_PAGE_SORT_FLAG_KEY) === '1'; } catch (_) { return false; }
}
function setPerPageSortEnabled(on) {
  try { localStorage.setItem(PER_PAGE_SORT_FLAG_KEY, on ? '1' : '0'); } catch (_) { /* storage disabled */ }
  return !!on;
}
// Pure: the stable per-page memory key from the library scope params. Folder
// (root) wins, then the Liked playlist, else a fixed 'home' for the base
// library. Search is transient — it inherits the scope it was launched under
// (root/liked/home), never its own per-query key. The 'root:' prefix means a
// folder literally named "__proto__"/"liked"/"home" can never collide with the
// reserved keys. Exported for node:test.
function pageSortKey(params) {
  const p = params || {};
  if (p.root) return 'root:' + String(p.root);
  if (p.liked) return 'liked';
  if (p.watchLater) return 'watchlater';
  return 'home';
}
function getPerPageSort(key) {
  let raw = null;
  try { raw = localStorage.getItem(PER_PAGE_SORT_MAP_KEY); } catch (_) { return null; }
  if (!raw) return null;
  try {
    const map = JSON.parse(raw);
    if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, key) && typeof map[key] === 'string') {
      return map[key];
    }
  } catch (_) { /* corrupt map -- ignore, fall back to the global sort */ }
  return null;
}
function setPerPageSort(key, sort) {
  let map = {};
  try {
    const raw = localStorage.getItem(PER_PAGE_SORT_MAP_KEY);
    if (raw) { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') map = parsed; }
  } catch (_) { map = {}; }
  if (key === '__proto__') return; // never write the one key that could pollute the prototype
  map[key] = String(sort);
  try { localStorage.setItem(PER_PAGE_SORT_MAP_KEY, JSON.stringify(map)); } catch (_) { /* storage disabled */ }
}

// Pure: partitions `list` down to just the video items, just the audio
// items, or the whole list unchanged ('both', or any unrecognized/missing
// mode -- fails safe to showing everything rather than silently hiding
// items on a bad/garbage mode string). An item whose own `type` is missing
// or isn't exactly 'video'/'audio' (a malformed/future item shape) FAILS
// SAFE the other way too -- it is never excluded by either filter, since we
// cannot confidently say it doesn't match. Never mutates `list`; never throws.
function filterByMediaType(list, mode) {
  const items = Array.isArray(list) ? list : [];
  if (mode !== 'video' && mode !== 'audio') return items.slice();
  return items.filter((item) => {
    const t = item && item.type;
    if (t !== 'video' && t !== 'audio') return true; // ambiguous/missing -- never hidden
    return t === mode;
  });
}

// The format dimension's chips (the 'both' mode is the chip row's shared All).
const FORMAT_TOGGLE_OPTIONS = [
  { mode: 'video', label: 'Videos' },
  { mode: 'audio', label: 'Audio' },
];

// ---- UI pass sweep S2 (F19, D4.5): the library's ONE filter chip row -------
//
// Home, channel/folder and search views used to stack up to three segmented
// .btn groups (format All/Videos/Audio, watch All/New/Watching/Watched, the
// search scope All/Titles/Channels), each with its own "All", wrapping to two
// or three rows on a phone. They are now ONE horizontally scrolling row of
// ui-chip filter chips: a leading "All", then each dimension's values. A
// dimension is single-select-or-none: tapping a chip selects it (and deselects
// its siblings in that dimension); tapping the selected chip again returns that
// dimension to its all-value. "All" is pressed exactly when every dimension is
// at its all-value, and tapping it resets them all.
//
//   groups: [{ key, value, all, options: [{ value, label }] }]
//   onChange(changes): ONCE per tap, with { key: newValue } for every dimension
//     the tap changed (All can change several; a no-op tap never calls it)
//
// Built with ui.chip (createElement + textContent only). The caller owns the
// state (persistence, URL): this function only reports changes. `opts.doc` for tests.
function buildFilterChipRow(groups, onChange, opts) {
  const o = opts || {};
  const doc = o.doc || document;
  const u = (typeof window !== 'undefined' && window.ui) || (typeof module !== 'undefined' && module.require ? module.require('./ui.js') : null);
  const state = {};
  (groups || []).forEach((g) => { state[g.key] = g.value; });
  const row = doc.createElement('div');
  row.className = 'library-chips';
  if (o.id) row.id = o.id;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', o.label || 'Filter');
  const allChip = u.chip({ kind: 'filter', label: 'All', doc });
  allChip.setAttribute('data-chip', 'all');
  row.appendChild(allChip);
  const chips = [];
  (groups || []).forEach((g) => {
    g.options.forEach((opt) => {
      const c = u.chip({ kind: 'filter', label: opt.label, doc });
      c.setAttribute('data-group', g.key);
      c.setAttribute('data-chip', String(opt.value));
      chips.push({ el: c, group: g, value: opt.value });
      row.appendChild(c);
    });
  });
  function paint() {
    const allOn = (groups || []).every((g) => state[g.key] === g.all);
    allChip.setAttribute('aria-pressed', allOn ? 'true' : 'false');
    chips.forEach((c) => c.el.setAttribute('aria-pressed', state[c.group.key] === c.value ? 'true' : 'false'));
  }
  function apply(next) {
    const changes = {};
    Object.keys(next).forEach((k) => {
      if (state[k] !== next[k]) { state[k] = next[k]; changes[k] = next[k]; }
    });
    paint();
    if (Object.keys(changes).length && typeof onChange === 'function') onChange(changes);
  }
  allChip.addEventListener('click', () => {
    const next = {};
    (groups || []).forEach((g) => { next[g.key] = g.all; });
    apply(next);
  });
  chips.forEach((c) => {
    c.el.addEventListener('click', () => {
      apply({ [c.group.key]: state[c.group.key] === c.value ? c.group.all : c.value });
    });
  });
  paint();
  return row;
}

// ---- v1.50: watched-state filter ---------------------------------------------
//
// The library's watch dimension (New | Watching | Watched; 'all' = none), a
// dimension of the one chip row above (buildFilterChipRow), persisted per
// device like the format. The value rides `GET /api/videos?watch=`; the SERVER derives watched
// state (progress thresholds + the sticky completion latch) -- the client
// never re-implements the thresholds.

const WATCH_FILTER_STORAGE_KEY = 'filetube_watch';
const WATCH_TOGGLE_MODES = ['all', 'new', 'watching', 'watched'];

function getStoredWatchFilter() {
  let stored = null;
  try { stored = localStorage.getItem(WATCH_FILTER_STORAGE_KEY); } catch (_) { /* storage disabled -- fall back to default */ }
  return WATCH_TOGGLE_MODES.includes(stored) ? stored : 'all';
}

function setStoredWatchFilter(mode) {
  const normalized = WATCH_TOGGLE_MODES.includes(mode) ? mode : 'all';
  try { localStorage.setItem(WATCH_FILTER_STORAGE_KEY, normalized); } catch (_) { /* storage disabled -- best effort */ }
  return normalized;
}

// The watch dimension's chips ('all' is the chip row's shared All).
const WATCH_TOGGLE_OPTIONS = [
  { mode: 'new', label: 'New' },
  { mode: 'watching', label: 'Watching' },
  { mode: 'watched', label: 'Watched' },
];

// ---- v1.149 (Dean): search-scope toggle (All | Titles | Channels) ----------
//
// A dimension of the library chip row, present ONLY on a folder/root-scoped
// search (main.js). Unlike format/watch it is NOT persisted: each new search
// starts on 'all' (the YouTube posture) - the value lives in the search view's
// closure and deep links carry it via ?searchIn=. Labels are Titles/Channels
// (not YouTube's Videos/Channels) because the format dimension in the same row
// already owns a "Videos" chip.
const SEARCH_SCOPE_MODES = ['all', 'title', 'channel'];

function normalizeSearchScopeMode(raw) {
  return SEARCH_SCOPE_MODES.includes(raw) ? raw : 'all';
}

// The search-scope dimension's chips ('all' is the chip row's shared All).
const SEARCH_SCOPE_OPTIONS = [
  { mode: 'title', label: 'Titles' },
  { mode: 'channel', label: 'Channels' },
];

// v1.205 Wave B: the unified-search content TYPE (Videos | Audio | Music |
// Podcasts | Shows | Books; 'all' = none). The header's GLOBAL search shows it
// as the ONLY dimension of the library chip row (sort/format/watch do not apply
// to the server-ranked cross-type stream); a folder/root search keeps the
// Titles/Channels scope instead. State lives in the view closure; main.js's
// chip mount and buildVideosApiUrl read/write it.
const SEARCH_TYPE_CHIPS = ['all', 'videos', 'audio', 'music', 'podcasts', 'shows', 'books'];

function normalizeSearchTypeChip(raw) {
  return SEARCH_TYPE_CHIPS.includes(raw) ? raw : 'all';
}

// The unified search's type chips ('all' is the chip row's shared All).
const SEARCH_TYPE_OPTIONS = [
  { chip: 'videos', label: 'Videos' },
  { chip: 'audio', label: 'Audio' },
  { chip: 'music', label: 'Music' },
  { chip: 'podcasts', label: 'Podcasts' },
  { chip: 'shows', label: 'Shows' },
  { chip: 'books', label: 'Books' },
];

// ---- Prev/next derived-order helpers (FR-2, T3) ----------------------------
//
// The watch page's Prev/Next controls (public/js/watch.js) and the persistent
// player controller's autoplay-next 'ended' handler (public/js/player.js,
// FR-3) both need the SAME ordered "playlist" + position -- the current home
// sort order (the same order the home grid shows, `sortItems` above, driven
// by the persisted `filetube_sort`). These two pure helpers are the single
// source of truth both call, so the two features can never diverge on what
// counts as "next". Exported for node:test.

// Wraps `sortItems` (above) and projects the result down to just the ordered
// list of ids -- the shape `computeNeighbors` (below) consumes. Re-derived
// fresh from the FULL library (`GET /api/videos`) + the persisted sort on
// every call, so it's durable across a refresh/deep-link (no reliance on
// transient navigation state). `rng` is forwarded to `sortItems` only for the
// `random` sort key (unit-test determinism -- see `fisherYatesShuffle`).
function deriveOrderedIds(items, sortKey, rng) {
  return sortItems(items, sortKey, rng).map((item) => item && item.id);
}

// Given the ordered id list and the CURRENT media's id, returns
// `{ prevId, nextId }` -- each `null` at the respective end of the order (no
// wrap-around), and both `null` when `currentId` isn't found in the list at
// all (e.g. it was removed from the library mid-session, or a stale/garbage
// id). Never throws on a non-array `orderedIds`.
function computeNeighbors(orderedIds, currentId) {
  const ids = Array.isArray(orderedIds) ? orderedIds : [];
  const index = ids.indexOf(currentId);
  if (index === -1) return { prevId: null, nextId: null };
  return {
    prevId: index > 0 ? ids[index - 1] : null,
    nextId: index < ids.length - 1 ? ids[index + 1] : null,
  };
}

// Pure: the parent folder of a file path -- strips the trailing `/file` or
// `\file` segment (handles both separators). Returns '' when there is no
// separator (a bare filename) or the input isn't a usable string. Shared by
// prev/next (watch.js) AND autoplay-next (player.js) so both scope "previous"
// and "next" to the SAME folder the current item lives in (Dean: prev/next
// should walk the item's folder/channel, not the whole library). A `?root=`
// query for this folder always includes the current item -- which also fixes
// prev/next being greyed out for items in "Hide from home" folders (the
// unscoped /api/videos list excludes those).
function parentFolder(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  var folder = filePath.replace(/[\\/][^\\/]*$/, '');
  return folder === filePath ? '' : folder;
}

// ---- v1.40.0: browse-context for context-aware prev/next -------------------
// When a video is opened from a browsing view (a folder / search / liked list,
// in any sort INCLUDING a server-seeded shuffle), prev/next should walk THAT
// list's exact on-screen order -- not the item's own channel folder (the
// pre-v1.40.0 behavior, kept as the fallback when no context travels with the
// link, e.g. a related-card hop or an old bookmark). The order is
// SERVER-authoritative (sort + seed are applied server-side), so the watch page
// can't re-derive it -- a client-side re-shuffle would not match what was on
// screen. Instead we carry a compact descriptor of the view's list-API query
// and RE-FETCH the same list; the response order IS the browsed order (used
// verbatim, never re-sorted). These three helpers are the single source of
// truth for that descriptor, shared by main.js (emit on card links), watch.js
// (the on-page prev/next buttons) and player.js (autoplay-at-end).

// Serialize a browse context to the `ctx` param's VALUE (a JSON string, NOT
// percent-encoded). Fields mirror buildVideosApiUrl (main.js); `src` picks the
// endpoint (the liked list vs the main library). Empty fields are dropped;
// returns '' when nothing meaningful remains (caller omits the param -> the
// folder-scoped fallback). The URL layer is the CALLER's job: writing this into
// a URL requires encodeURIComponent(...), and reading it back via
// URLSearchParams.get(...) already percent-decodes it before decodeListContext.
// (Doing the percent step here too would double-encode/decode and corrupt any
// value containing % / & / # / + -- e.g. a search like "R&B" or "50% off".)
function encodeListContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  var out = {};
  if (ctx.src === 'liked') out.src = 'liked';
  if (ctx.src === 'watchlater') out.src = 'watchlater';
  // v1.44 music: a music queue carries src:'music' plus the music-only scope
  // keys (album/artist/filter) so next/prev/autoplay re-fetch the same list.
  if (ctx.src === 'music') {
    out.src = 'music';
    if (ctx.album) out.album = String(ctx.album);
    if (ctx.artist) out.artist = String(ctx.artist);
    if (ctx.filter) out.filter = String(ctx.filter);
  }
  // v1.88 (Dean): a Modern-mode home card carries src:'home-grid' plus the
  // active pill (`filter`) so next/prev/autoplay re-fetch /api/home?view=grid
  // in the SAME pill+sort+seed order the grid was showing -- the pill is the
  // grid's only filter dimension and was previously invisible to the ctx
  // (prev/next fell through to the whole /api/videos library, so an Audio-pill
  // track's Next could land on a video). `sort`/`seed` ride the generic lines
  // below (the grid's Modern sort key + this scroll session's shuffle seed).
  if (ctx.src === 'home-grid') {
    out.src = 'home-grid';
    if (ctx.filter) out.filter = String(ctx.filter);
  }
  if (ctx.sort) out.sort = String(ctx.sort);
  if (ctx.seed !== undefined && ctx.seed !== null && ctx.seed !== '') out.seed = String(ctx.seed);
  if (ctx.search) out.search = String(ctx.search);
  // v1.149 (gate W1, the v1.88 format-threading class): a Channels/Titles-
  // scoped search grid must hand Prev/Next/autoplay the SAME scope, or Next
  // can land on an item the user's grid never showed. 'all' never rides
  // (byte-identity with pre-v1.149 contexts).
  if (ctx.search && ctx.searchIn && ctx.searchIn !== 'all') out.searchIn = String(ctx.searchIn);
  if (ctx.folder) out.folder = String(ctx.folder);
  if (ctx.root) out.root = String(ctx.root);
  if (ctx.format) out.format = String(ctx.format);
  if (Object.keys(out).length === 0) return '';
  try { return JSON.stringify(out); } catch (_) { return ''; }
}

// Parse a `ctx` param VALUE (the already-percent-decoded JSON string, as
// URLSearchParams.get hands it back) into its object, or null if absent/garbage
// (caller falls back to folder scope -- never throws). No decodeURIComponent
// here: the caller/URLSearchParams already did the percent layer.
function decodeListContext(param) {
  if (!param || typeof param !== 'string') return null;
  try {
    var obj = JSON.parse(param);
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : null;
  } catch (_) { return null; }
}

// Build the full-list API URL that reproduces a browse context's exact order.
// `fullLimit` is the caller's "give me everything" cap. The response MUST be
// used in its returned order (server already applied sort+seed) -- callers do
// NOT pass it through deriveOrderedIds.
function buildContextListUrl(ctx, fullLimit) {
  var c = ctx || {};
  var params = [];
  if (c.search) params.push('search=' + encodeURIComponent(c.search));
  // v1.149 (gate W1): the scope reproduces the browsed list exactly.
  if (c.search && c.searchIn && c.searchIn !== 'all') params.push('searchIn=' + encodeURIComponent(c.searchIn));
  if (c.folder) params.push('folder=' + encodeURIComponent(c.folder));
  if (c.root) params.push('root=' + encodeURIComponent(c.root));
  if (c.sort) params.push('sort=' + encodeURIComponent(c.sort));
  if (c.format) params.push('format=' + encodeURIComponent(c.format));
  if (c.seed !== undefined && c.seed !== null && c.seed !== '') params.push('seed=' + encodeURIComponent(c.seed));
  params.push('limit=' + fullLimit);
  // v1.44 music: a music queue re-fetches /api/music in the SAME browsed order
  // (album/artist/liked/search + sort/seed). The response order IS the queue
  // (used verbatim, never re-sorted) -- the v1.40 ctx contract. `album`/
  // `artist`/`filter` are music-only ctx keys.
  if (c.src === 'music') {
    if (c.album) params.push('album=' + encodeURIComponent(c.album));
    if (c.artist) params.push('artist=' + encodeURIComponent(c.artist));
    if (c.filter) params.push('filter=' + encodeURIComponent(c.filter));
    return '/api/music?' + params.join('&');
  }
  // v1.88 (Dean): a Modern-mode home context re-fetches the flat grid via
  // /api/home?view=grid (server MODERN_GRID path) with the pill as `filter`,
  // reusing the sort+seed+limit already accumulated above. The response order
  // IS the grid order (server applies sort+seed) -- used verbatim, never
  // re-sorted, exactly like the /api/videos and /api/music ctx paths. `filter`
  // defaults to 'all' defensively (the server also clamps unknown filters).
  if (c.src === 'home-grid') {
    return '/api/home?view=grid&filter=' + encodeURIComponent(c.filter || 'all') + '&' + params.join('&');
  }
  var endpoint = c.src === 'liked' ? '/api/liked' : (c.src === 'watchlater' ? '/api/watch-later' : '/api/videos');
  return endpoint + '?' + params.join('&');
}

// ---- Hide-from-sidebar (v1.14.0 item 3) ------------------------------------

// Pure: filters `folders` down to the ones that should appear in a
// left-sidebar-style folder list (the desktop sidebar in main.js/setup.html,
// and the mobile Playlists sheet below), omitting any folder whose
// `folderSettings[path].hiddenFromSidebar` is true. Distinct from (and
// independent of) the existing `hidden` ("Hide from home") flag, which never
// affects either list. A filtered-out folder is NOT removed from `folders`
// itself -- it remains fully reachable via a direct /?root=<path> link; this
// only controls whether a LINK to it is rendered. Exported for node:test.
// v1.73.1 (Dean's device find): the synthetic Downloads folder row retired
// from the sidebar FOLDER list - the v1.73 hard "Downloads" Library entry
// owns that surface now, and both rendering was a visible dupe. The folder
// itself stays fully alive (Setup's management box, the default-view
// picker, /?root= browsing); only the sidebar LINK moves house. Callers
// that cannot know the synthetic list pass nothing and keep the old
// behavior (fail toward showing).
function visibleSidebarFolders(folders, settings, syntheticFolders) {
  const list = Array.isArray(folders) ? folders : [];
  const s = settings || {};
  const synth = new Set(Array.isArray(syntheticFolders) ? syntheticFolders : []);
  return list.filter((f) => !(s[f] && s[f].hiddenFromSidebar) && !synth.has(f));
}

// ---- Folder drag-and-drop reordering (v1.15.0 item 1) ----------------------
//
// These three pure helpers are the SHARED reorder MODEL: every reorder in
// this app, on every surface and by every input device, produces its new
// array through them. v1.76 replaced the gesture layer above them (native
// HTML5 DnD and the up/down `.reorder-btn` buttons -> one pointer-event
// helper, `wireReorderable` below) without touching these -- so a pointer
// drag and a keyboard arrow-key move still converge on the identical
// persisted order, exactly as DnD and the buttons used to.
//
// No server change, then or now: the existing `POST /api/config` handler
// already derives the synthetic Downloads folder's `order` from its POSITION
// in the submitted `folders` array (never writing it into `db.folders` --
// see server.js), so these helpers only need to produce a correctly
// reordered `folders` array.

// Pure: returns a NEW array with the item at `fromIndex` moved to land at
// `toIndex` (splice-out + splice-in), leaving every other item's relative
// order intact and never mutating the input array. Out-of-range indexes are
// clamped rather than throwing; a no-op (`fromIndex` out of bounds) returns
// an unchanged copy. This is the core "move item from i to j" primitive
// shared by the Setup list's row DnD and the sidebar's visible-subset DnD.
// Exported for node:test.
function moveArrayItem(arr, fromIndex, toIndex) {
  const list = Array.isArray(arr) ? arr.slice() : [];
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= list.length) return list;
  const clampedTo = Math.max(0, Math.min(Number.isInteger(toIndex) ? toIndex : fromIndex, list.length - 1));
  const [item] = list.splice(fromIndex, 1);
  list.splice(clampedTo, 0, item);
  return list;
}

// Pure: converts a drop gesture (source index, the row/item index the user
// dropped ON, and whether the drop targeted the top/before half of that
// row vs the bottom/after half -- the visual drop-indicator's own state)
// into the final index `moveArrayItem` should move the dragged entry to.
// Accounts for the index shift caused by removing the source item before
// re-inserting it. Dropping an item onto itself (`fromIndex === targetIndex`)
// is a no-op (returns `fromIndex`). Exported for node:test.
function computeDropIndex(fromIndex, targetIndex, insertBefore) {
  if (fromIndex === targetIndex) return fromIndex;
  const targetIndexAfterRemoval = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  return insertBefore ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1;
}

// Pure: rebuilds the FULL folders order after a sidebar drag-and-drop
// reordered only the VISIBLE subset (`visibleSidebarFolders` above) -- a
// folder flagged `hiddenFromSidebar` never appears in the sidebar, so it
// keeps its absolute position in the full array; each slot that held a
// visible folder is filled, in order, from `newVisibleOrder` (the reordered
// visible list, e.g. the output of `moveArrayItem` applied to
// `visibleSidebarFolders(fullFolders, settings)`). `newVisibleOrder` must be
// a permutation of that same visible list (same length/membership, new
// order) -- callers derive it that way, never from an unrelated array. This
// lets the sidebar's immediate-save DnD (no Save button there, unlike the
// Setup list) submit the SAME full-array shape `POST /api/config` expects,
// so the synthetic Downloads folder's position -> `folderSettings.order`
// exactly as the Setup page's up/down buttons already produce. Exported for
// node:test.
function rebuildFullFolderOrder(fullFolders, settings, newVisibleOrder, syntheticFolders) {
  const full = Array.isArray(fullFolders) ? fullFolders : [];
  // v1.73.1: the synthetic exclusion rides here too - a folder absent from
  // the sidebar (hidden OR synthetic) keeps its absolute position, exactly
  // the hiddenFromSidebar contract.
  const visibleSet = new Set(visibleSidebarFolders(full, settings, syntheticFolders));
  const queue = Array.isArray(newVisibleOrder) ? newVisibleOrder.slice() : [];
  let i = 0;
  return full.map((f) => (visibleSet.has(f) ? queue[i++] : f));
}

// ---- v1.339 S2: sidebar drops persist BY PATH onto the FRESH config ---------
//
// T-C1 (plan docs/exec-plans/completed/2026-09-26-fouc-toctou-audit.md, D2): the
// two sidebar drags used to POST the folder list the page loaded at init back
// to POST /api/config, which replaces both folder tables wholesale - so a
// folder another device added after this page loaded was DROPPED by a drag
// here (and its items pruned by the scan the save fires). A drop now records
// only WHAT the user did - "this path moved to before/after that path" - and
// replays it onto the config as the server holds it at drop time, sending the
// fresh folderSettings and the fresh `configVersion` as `baseVersion`, so the
// server refuses (409) a write whose base moved in the meantime.

// Pure: turns a visible-subset move (the dragged index and where it landed in
// the reordered visible list) into a path-anchored move: the dragged path goes
// AFTER the path now above it, or BEFORE the path now below it when it landed
// first. Returns null for a no-op (nothing moved, or no neighbour to anchor to).
// Exported for node:test.
function sidebarMoveAnchor(visibleFolders, fromIndex, toIndex) {
  const list = Array.isArray(visibleFolders) ? visibleFolders : [];
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= list.length) return null;
  const moved = moveArrayItem(list, fromIndex, toIndex);
  const draggedPath = list[fromIndex];
  const at = moved.indexOf(draggedPath);
  if (at === fromIndex || moved.length < 2) return null;
  if (at > 0) return { draggedPath, anchorPath: moved[at - 1], insertBefore: false };
  return { draggedPath, anchorPath: moved[1], insertBefore: true };
}

// Pure: applies a path-anchored move onto a (fresh) full folder config. The
// visible subset is re-derived from the FRESH folders/settings/synthetic list,
// the dragged path is placed before/after its anchor there, and
// rebuildFullFolderOrder writes it back into the full array (hidden and
// synthetic folders keep their absolute positions). Returns null when either
// path is no longer a visible sidebar row in the fresh config (removed, hidden,
// or renamed away on another device) - the caller then re-renders and writes
// nothing, rather than guessing. Never adds or removes a folder: the result is
// always a permutation of `folders`. Exported for node:test.
function applySidebarMoveByPath(folders, settings, syntheticFolders, draggedPath, anchorPath, insertBefore) {
  const full = Array.isArray(folders) ? folders : [];
  const visible = visibleSidebarFolders(full, settings, syntheticFolders);
  if (draggedPath === anchorPath || !visible.includes(draggedPath) || !visible.includes(anchorPath)) return null;
  const without = visible.filter((f) => f !== draggedPath);
  const anchorAt = without.indexOf(anchorPath);
  without.splice(insertBefore ? anchorAt : anchorAt + 1, 0, draggedPath);
  return rebuildFullFolderOrder(full, settings, without, syntheticFolders);
}

// Persists one path-anchored sidebar move against the server's CURRENT config:
// GET /api/config, apply the move by path onto that fresh list, POST it with the
// fresh folderSettings and `baseVersion`; a 409 (the config moved between the
// GET and the POST) retries ONCE from a new GET. Never POSTs a caller's stale
// arrays - the caller hands in only the move - and never POSTs without a base
// (a failed GET, or one with no `configVersion`, is 'error'). Resolves
//   { status: 'saved' | 'conflict' | 'gone' | 'error', config }
// where `config` is the freshest GET /api/config body it could read (null if
// none), for the caller to re-render from on EVERY outcome. `fetchImpl`
// defaults to the global fetch (a test seam).
async function persistSidebarMoveByPath(move, fetchImpl) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const readConfig = async () => {
    const r = await doFetch('/api/config');
    if (!r || !r.ok) throw new Error('GET /api/config failed' + (r ? ' (' + r.status + ')' : ''));
    return r.json();
  };
  // A re-read for the re-render after a failure; never throws.
  const freshest = async (fallback) => { try { return await readConfig(); } catch (_) { return fallback; } };
  let cfg = null;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      cfg = await readConfig();
      const folders = Array.isArray(cfg.folders) ? cfg.folders : [];
      const settings = cfg.folderSettings || {};
      const synthetic = Array.isArray(cfg.syntheticFolders) ? cfg.syntheticFolders : [];
      // v1.339 r1 (W): a drag only ever POSTs WITH a base. A failed GET
      // already throws in readConfig (to the catch: 'error', nothing sent); an
      // answer without a configVersion (not an admin's - the POST is admin-only
      // and admins always get one) never takes the server's unchecked legacy
      // path either.
      if (typeof cfg.configVersion !== 'string') {
        console.error('Failed to persist sidebar folder reorder: the folder config has no version');
        return { status: 'error', config: cfg };
      }
      const next = applySidebarMoveByPath(folders, settings, synthetic, move.draggedPath, move.anchorPath, move.insertBefore);
      if (!next) return { status: 'gone', config: cfg };
      const body = { folders: next, folderSettings: settings, baseVersion: cfg.configVersion };
      const res = await doFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res && res.status === 409) continue; // the base moved: once more from a fresh GET
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (!res || !res.ok || !data || !data.success) {
        console.error('Failed to persist sidebar folder reorder:', data && data.error);
        return { status: 'error', config: await freshest(cfg) };
      }
      // Re-read so the synthetic Downloads folder's GET-time splice shows.
      return { status: 'saved', config: await freshest(cfg) };
    }
    return { status: 'conflict', config: await freshest(cfg) };
  } catch (err) {
    console.error('Failed to persist sidebar folder reorder:', err);
    return { status: 'error', config: await freshest(cfg) };
  }
}

// ---- v1.76: the ONE drag-to-reorder gesture layer --------------------------
//
// Replaces five hand-copied native-HTML5-DnD wirings (main.js's sidebar
// folders, setup.js's wizard rows AND sidebar preview, this file's pinned
// section, subscriptions.js's rows) with a single POINTER-EVENT helper.
//
// Why pointer events and not `draggable="true"`: native HTML5 drag does not
// fire on iOS touch AT ALL, so all five of those surfaces were desktop-only
// and their drag handles were, on Dean's phone, decoration. `pointerdown`/
// `pointermove`/`pointerup` is one code path for mouse, touch and pen.
//
// The two doors onto a touch drag (plan D2): a 300ms LONG-PRESS anywhere on
// the row, or an immediate press on a `handleSelector` handle (which wears
// `touch-action: none`). The long press is what lets the WHOLE row be a drag
// surface without stealing vertical scroll from a list that scrolls -- move
// more than REORDER_TOUCH_SLOP_PX before the timer fires and the press is
// abandoned to the browser as a normal scroll. Once armed, a non-passive
// `touchmove` handler calls preventDefault() for the rest of the gesture,
// which is what actually pins the page while a finger drags.
//
// Reuses `moveArrayItem`/`computeDropIndex` above VERBATIM -- this wave
// swapped the gesture layer, never the ordering semantics.

const REORDER_DEFAULT_CLASSES = { dragging: 'dragging', before: 'drag-over-before', after: 'drag-over-after' };
// Step 7 (UI pass): every wired row wears the ui-reorder primitive (ui.css: the grab cursor, the
// dragged row's dim, the drop line) - the Settings lists put it in their markup, the sidebars
// get it here. It was the bespoke `.reorder-row` hook.
const REORDER_ROW_CLASS = 'ui-reorder';
const REORDER_BODY_CLASS = 'reorder-dragging';
// Mouse/pen: a few px of travel separates a drag from a click, so a click on
// a sidebar link still navigates. Touch: a long press arms instead, and more
// than the slop before it fires means the user meant to scroll.
const REORDER_MOUSE_THRESHOLD_PX = 4;
const REORDER_TOUCH_SLOP_PX = 10;
const REORDER_LONG_PRESS_MS = 300;
// Auto-scroll while dragging inside a scrolling box (plan D7 made those
// boxes taller, which is precisely when this starts to matter).
const REORDER_AUTOSCROLL_EDGE_PX = 36;
const REORDER_AUTOSCROLL_STEP_PX = 12;
const REORDER_AUTOSCROLL_TICK_MS = 16;

// Keyboard reorder re-renders the list, which DESTROYS the handle that had
// focus -- so the move records where focus should land and the next
// `wireReorderable` call (every caller re-wires after every render) restores
// it. Keyed by an opaque caller string rather than by element because some
// callers rebuild the container element itself (the pinned sidebar does).
// Without this, one arrow press strands focus on <body> and the second press
// does nothing -- the v1.67 card-corner-editor lesson, verbatim.
let pendingReorderFocus = null;

// Pure: given the measured rects of every row (index-aligned with the list)
// and the pointer's clientY, resolve WHICH row the pointer is over and which
// half of it -- `{ index, before }`, the exact pair `computeDropIndex`
// consumes. Above the first row resolves to the first row's before-half,
// below the last to the last row's after-half, and a pointer in the GAP
// between two rows resolves to the nearer of the two edges. Returns null for
// an empty list. Only `top`/`bottom` are read, so a test can inject plain
// object rects (jsdom does no layout -- every real rect there is all-zero).
// Exported for node:test.
function resolveReorderTarget(rects, clientY) {
  const list = Array.isArray(rects) ? rects : [];
  if (list.length === 0) return null;
  if (clientY < list[0].top) return { index: 0, before: true };
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (clientY > r.bottom) continue;
    if (clientY >= r.top) return { index: i, before: clientY < (r.top + r.bottom) / 2 };
    // In the gap above row i. i > 0 here: the `clientY < list[0].top` guard
    // above already claimed everything above the first row.
    const prev = list[i - 1];
    return (clientY - prev.bottom) <= (r.top - clientY)
      ? { index: i - 1, before: false }
      : { index: i, before: true };
  }
  return { index: list.length - 1, before: false };
}

// Pure: how far (px, negative = up) a scrolling container should scroll this
// tick, given its rect and the pointer's clientY. Zero outside the edge
// bands; ramps to the full step at the edge and STAYS at the full step past
// it (a pointer dragged clean outside the box keeps scrolling rather than
// stalling). Exported for node:test.
function computeAutoScrollDelta(rect, clientY, edge, maxStep) {
  if (!rect) return 0;
  // Adversarial gate W3: a container with no measurable height cannot scroll,
  // but without this it read as "hard against BOTH edges" and returned a
  // non-zero delta for every pointer position - so the auto-scroll interval
  // started on every armed drag and, because its own `!armed` tick-guard can
  // never fire while a gesture is stuck armed, never stopped. In jsdom every
  // rect is all-zero, which made an assertion that threw mid-drag HANG the
  // test process instead of failing it: the pre-commit hook refuses red, and
  // it cannot refuse a hang.
  if (!(rect.bottom > rect.top)) return 0;
  const band = edge > 0 ? edge : 0;
  const step = maxStep > 0 ? maxStep : 0;
  if (band === 0 || step === 0) return 0;
  const fromTop = clientY - rect.top;
  const fromBottom = rect.bottom - clientY;
  if (fromTop < band) return -Math.ceil(step * Math.min(1, (band - fromTop) / band));
  if (fromBottom < band) return Math.ceil(step * Math.min(1, (band - fromBottom) / band));
  return 0;
}

// Wires drag-to-reorder onto `container`'s rows. Call it after EVERY render
// (fresh rows need fresh listeners), exactly like the DnD wirings it
// replaces. Options:
//   rowSelector     (required) selects the reorderable rows, in list order
//   onReorder       (required) (fromIndex, toIndex, info) -- the caller does
//                   the array move + persist; the helper decides nothing
//                   about ordering semantics or persistence
//   handleSelector  a dedicated handle inside each row. When given, the
//                   handle also becomes the KEYBOARD affordance (tabindex/
//                   role/aria-label + arrow keys). When absent the whole row
//                   drags and no keyboard reorder is wired -- deliberately:
//                   the sidebar surfaces are <a> links, where hijacking
//                   ArrowUp/ArrowDown would break normal focus scrolling,
//                   and they never had a keyboard reorder to preserve
//   ignoreSelector  interactive descendants that must never start a drag
//                   (defaults below); a match ON the row itself never counts
//                   -- the sidebar rows ARE anchors
//   groupOf         (index) -> group key; a drop across groups is refused
//                   (the pinned sidebar's channel/books/podcasts partition)
//   classes         { dragging, before, after } -- each surface keeps its OWN
//                   shipped class family, so no existing CSS changes meaning
//   labelOf         (index) -> accessible name for that row's handle
//   focusKey        opaque string enabling keyboard focus restore (above)
//   scrollContainer element to auto-scroll near the edges of
//   measure         (rowEl) -> rect; injectable so a jsdom test can drive the
//                   REAL handler chain with real geometry
//   signal          AbortSignal tearing every listener down
const REORDER_DEFAULT_IGNORE = 'input, textarea, select, button, label, [contenteditable="true"]';

// The interaction policy's JS half (interaction.js): the page's window.FTInteraction, else
// (node:test) the sibling module.
function interactionLib() {
  return (typeof window !== 'undefined' && window.FTInteraction)
    || (typeof module !== 'undefined' && module.require ? module.require('./interaction.js') : null);
}

function wireReorderable(container, opts) {
  const o = opts || {};
  if (!container || typeof container.querySelectorAll !== 'function') return;
  if (typeof o.onReorder !== 'function' || !o.rowSelector) return;
  const rows = Array.prototype.slice.call(container.querySelectorAll(o.rowSelector));
  const classes = Object.assign({}, REORDER_DEFAULT_CLASSES, o.classes || {});
  const ignoreSelector = typeof o.ignoreSelector === 'string' ? o.ignoreSelector : REORDER_DEFAULT_IGNORE;
  const measure = typeof o.measure === 'function' ? o.measure : (el) => el.getBoundingClientRect();
  const groupOf = typeof o.groupOf === 'function' ? o.groupOf : null;
  const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (rows.length === 0 || !doc) return;
  // The DOCUMENT's own AbortController, not the ambient global. An
  // `addEventListener` signal is brand-checked against the realm's own
  // AbortSignal class: in a jsdom test the ambient global is Node's, and
  // passing it throws "member 'signal' is not of type 'AbortSignal'"
  // (measured). In a browser the two are the same object anyway.
  const AbortCtl = (doc.defaultView && doc.defaultView.AbortController) || AbortController;

  // --- per-gesture state ----------------------------------------------------
  let pressIndex = null;     // row under the pointer since pointerdown
  let armed = false;         // the drag proper has begun
  let pressX = 0;
  let pressY = 0;
  let activePointerId = null;
  let longPressTimer = null;
  let autoScrollTimer = null;
  let autoScrollDelta = 0;
  // The pointer's last known position, so the auto-scroll tick can re-resolve
  // the drop target after it moves the list (QA gate W2).
  let lastClientY = 0;
  let lastTarget = null;     // { index, before } | null
  let pressController = null;
  let capturedEl = null;

  function clearIndicators() {
    rows.forEach((r) => r.classList.remove(classes.before, classes.after));
  }

  function stopAutoScroll() {
    if (autoScrollTimer !== null) { clearInterval(autoScrollTimer); autoScrollTimer = null; }
    autoScrollDelta = 0;
  }

  function applyAutoScroll(clientY) {
    const sc = o.scrollContainer;
    if (!sc || typeof sc.getBoundingClientRect !== 'function') return;
    const delta = computeAutoScrollDelta(
      sc.getBoundingClientRect(), clientY, REORDER_AUTOSCROLL_EDGE_PX, REORDER_AUTOSCROLL_STEP_PX
    );
    autoScrollDelta = delta;
    if (delta === 0) { stopAutoScroll(); return; }
    // A timer (not a per-move nudge): the pointer can sit still at the edge
    // and must keep scrolling, which a move-driven scroll cannot do.
    if (autoScrollTimer === null) {
      autoScrollTimer = setInterval(() => {
        if (!armed || autoScrollDelta === 0) { stopAutoScroll(); return; }
        sc.scrollTop += autoScrollDelta;
        // QA gate W2: re-resolve the drop target against the rows' NEW
        // positions. The pointer is typically stationary while a list
        // auto-scrolls (on touch the finger is parked at the edge by
        // definition), so without this the indicator freezes and the drop
        // commits against whatever row happened to be under the pointer at
        // the last move - ten rows ago by the time the user releases.
        trackPointer(lastClientY);
      }, REORDER_AUTOSCROLL_TICK_MS);
    }
  }

  // Ends the gesture. `commit` decides whether the resolved target is
  // actually applied -- pointercancel/abort end a drag WITHOUT reordering.
  function endGesture(commit) {
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
    stopAutoScroll();
    const from = pressIndex;
    const target = lastTarget;
    const wasArmed = armed;
    pressIndex = null;
    armed = false;
    lastTarget = null;
    activePointerId = null;
    if (capturedEl && typeof capturedEl.releasePointerCapture === 'function') {
      try { capturedEl.releasePointerCapture(capturedEl.__reorderPointerId); } catch (_) { /* already released */ }
    }
    capturedEl = null;
    clearIndicators();
    rows.forEach((r) => r.classList.remove(classes.dragging));
    if (doc.body) doc.body.classList.remove(REORDER_BODY_CLASS);
    if (pressController) { pressController.abort(); pressController = null; }
    if (!wasArmed || !commit || from === null || !target) return;
    // Adversarial gate round 2: refuse a drop whose own rows were REBUILT
    // mid-gesture.
    //
    // Native HTML5 drag got this free, and for a reason worth naming
    // precisely: in all five wirings this replaced, the `drop` listener was
    // bound to the ROW itself (see `git show 7645d9d` - main.js:1289,
    // common.js:6706, setup.js:171/:285, subscriptions.js:3766), so a row
    // detached by a mid-drag re-render could never receive a drop and no
    // reorder could commit. The pointer layer listens on the DOCUMENT for the
    // life of the gesture, so it has no such structural protection - a
    // gesture can outlive the list it started in and commit against a
    // detached DOM. (Round 3 of the gate corrected an earlier version of this
    // comment which claimed instead that the UA "ends the drag" when the
    // source node is removed. That may well be true, but it is a spec claim
    // neither seat could check without a browser, and this wave's first
    // CRITICAL was a wrong root-cause narrative - so the justification rests
    // on something a reader can `git show`.)
    //
    // Reachable wherever a render can land during a drag: on the
    // subscriptions list, two rapid drags (the first drop's response arriving
    // during the second); elsewhere, any poll or fetch that re-renders.
    //
    // Both answers to "which array should the handler read" are wrong once
    // that happens - a live read moves whatever now sits at the dragged INDEX
    // (measured: the user grabs row "a" and "c" moves), a snapshot moves a
    // record that may no longer exist. Refusing here makes the question moot,
    // at one site, for all six surfaces.
    //
    // `=== false` on purpose: a fake DOM without `isConnected` yields
    // undefined and must not be read as detached.
    if (rows[from] && rows[from].isConnected === false) return;
    // NOTE (adversarial gate S1): there is deliberately NO second group check
    // here. `lastTarget` is assigned in exactly one place - `trackPointer` -
    // and only AFTER the identical check, so a re-assert at this point would
    // be a guard whose precondition is always true when it runs. This repo has
    // been bitten twice by exactly that shape, so the cross-group contract is
    // enforced at ONE site and the tests bind it there.
    const toIndex = computeDropIndex(from, target.index, target.before);
    if (toIndex === from) return;
    o.onReorder(from, toIndex, { source: 'pointer' });
  }

  function beginDrag() {
    if (armed || pressIndex === null) return;
    armed = true;
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
    rows[pressIndex].classList.add(classes.dragging);
    if (doc.body) doc.body.classList.add(REORDER_BODY_CLASS);
  }

  function trackPointer(clientY) {
    if (!armed || pressIndex === null) return;
    // Re-measured EVERY move, never snapshotted at drag start: the container
    // may be auto-scrolling under the pointer, which moves every row.
    const target = resolveReorderTarget(rows.map(measure), clientY);
    clearIndicators();
    lastTarget = null;
    if (!target) return;
    if (groupOf && groupOf(pressIndex) !== groupOf(target.index)) return;
    lastTarget = target;
    rows[target.index].classList.add(target.before ? classes.before : classes.after);
  }

  rows.forEach((row, index) => {
    row.classList.add(REORDER_ROW_CLASS);
    // Native HTML5 drag must be turned OFF, not merely un-asked-for. A UA
    // starting its own drag takes the pointer and fires `pointercancel`,
    // which ends our gesture with nothing reordered.
    //
    // QA gate C1: an earlier version of this line did `removeAttribute`, which
    // is NOT enough - per the HTML spec an absent `draggable` means "UA
    // default", and the UA default is TRUE for <a href> and <img> (verified:
    // `a.draggable === true` with no attribute set; an <a> WITHOUT href is
    // false). Removing the attribute therefore left rows starting a native
    // link/image drag on desktop - trading a shipped desktop capability for
    // the new touch one, invisibly to a jsdom suite (jsdom implements no
    // native DnD). Hence an explicit "false" here, on the row AND on the
    // descendants that default to draggable on their own.
    //
    // Exactly which surfaces (QA delta S2 corrected an earlier, wrong count
    // here - a bad number inside a comment justifying a gate fix is a defect
    // in its own right): THREE of the six wired surfaces render their rows AS
    // <a> elements - both folder sidebars and the pinned sidebar. Of those
    // three, ONE (the pinned sidebar) can contain an <img> avatar; the two
    // folder sidebars render an <i class="icon-folder"> glyph and never an
    // <img>. The subscriptions list is the fourth surface with <img>/<a>
    // DESCENDANTS while its own row is a <div>. `a, img` is the complete
    // UA-default-draggable set (the delta enumerated it).
    if (typeof row.setAttribute === 'function') row.setAttribute('draggable', 'false');
    if (typeof row.querySelectorAll === 'function') {
      Array.prototype.forEach.call(row.querySelectorAll('a, img'), (el) => el.setAttribute('draggable', 'false'));
    }

    const handle = o.handleSelector ? row.querySelector(o.handleSelector) : null;
    if (handle) {
      handle.setAttribute('tabindex', '0');
      handle.setAttribute('role', 'button');
      const label = typeof o.labelOf === 'function' ? o.labelOf(index) : '';
      handle.setAttribute('aria-label', label ? `Reorder ${label}` : 'Reorder item');
      // QA gate S4: `role="button"` promises an activation, and there is none
      // to give - this control reorders by ARROW KEY, not by Enter/Space (a
      // grab/drop mode would be a second, undiscoverable state machine). Say
      // so, rather than leaving a screen-reader user to press Enter into
      // silence. Announced by the row's own text too, via setup.html's help
      // copy on both lists that carry a handle.
      handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End');
      handle.addEventListener('keydown', (e) => {
        let to = null;
        if (e.key === 'ArrowUp') to = index - 1;
        else if (e.key === 'ArrowDown') to = index + 1;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = rows.length - 1;
        if (to === null) return;
        e.preventDefault();
        if (to < 0 || to >= rows.length || to === index) return;
        if (groupOf && groupOf(index) !== groupOf(to)) return;
        if (o.focusKey) pendingReorderFocus = { key: o.focusKey, index: to };
        o.onReorder(index, to, { source: 'keyboard' });
      }, { signal: o.signal });
    }

    row.addEventListener('pointerdown', (e) => {
      // QA gate W1: clear any click-suppression flag left over from an earlier
      // gesture. The flag is consumed by a `click` on the SOURCE row, but a
      // click is dispatched on the common ancestor of press and release - so a
      // drag released off its own row (including a no-op drop, which does not
      // even re-render) left the flag set on a live node, and the user's NEXT
      // click on that row - a checkbox, a remove button, a link - was eaten.
      // A real click always follows its own pointerdown, so clearing here
      // cannot cancel a suppression that is still owed.
      //
      // FIRST, before any guard can return early: a press on an interactive
      // child takes the early return below, and clearing after it would leave
      // exactly that child's click still armed to be eaten.
      rows.forEach((r) => { r.__reorderSuppressClick = false; });
      if (pressIndex !== null) return;                 // a second pointer never joins an active gesture
      if (e.button !== undefined && e.button !== 0) return;
      const blocked = e.target && typeof e.target.closest === 'function' ? e.target.closest(ignoreSelector) : null;
      // A match on the ROW itself never blocks: the sidebar rows ARE <a>
      // elements, and `closest` would otherwise veto every drag on them.
      if (blocked && blocked !== row && row.contains(blocked)) return;
      pressIndex = index;
      pressX = e.clientX;
      pressY = e.clientY;
      lastClientY = e.clientY;
      activePointerId = e.pointerId;
      pressController = new AbortCtl();
      const pressSignal = pressController.signal;
      if (o.signal) {
        // Tear the gesture down if the CALLER's signal aborts mid-drag; the
        // listener itself is removed with the gesture (nested signal), so it
        // cannot accumulate one entry per press.
        o.signal.addEventListener('abort', () => endGesture(false), { once: true, signal: pressSignal });
      }
      // Document-level for the rest of the gesture, so a pointer that leaves
      // the row (or the container) still tracks and still ends cleanly. Bound
      // to THIS press, never to the wire call, so re-renders cannot pile them
      // up. jsdom has no setPointerCapture (measured), and neither do some
      // engines -- feature-detected, never assumed.
      doc.addEventListener('pointermove', onDocPointerMove, { signal: pressSignal });
      doc.addEventListener('pointerup', onDocPointerUp, { signal: pressSignal });
      doc.addEventListener('pointercancel', onDocPointerCancel, { signal: pressSignal });
      doc.addEventListener('keydown', onDocKeyDown, { signal: pressSignal });
      // Non-passive: this is the half that actually stops the page scrolling
      // once a touch drag is armed.
      doc.addEventListener('touchmove', onDocTouchMove, { signal: pressSignal, passive: false });
      // The long press that arms a touch drag is also the gesture iOS/Android use for the
      // context menu / selection callout: refused while armed (interaction.js owns every
      // contextmenu listener, D6).
      const FI = interactionLib();
      if (FI) FI.suppressContextMenuWhile(doc, () => armed, { signal: pressSignal });
      if (typeof row.setPointerCapture === 'function' && e.pointerId !== undefined) {
        try { row.setPointerCapture(e.pointerId); capturedEl = row; capturedEl.__reorderPointerId = e.pointerId; } catch (_) { capturedEl = null; }
      }
      const isTouch = e.pointerType === 'touch';
      const onHandle = !!(handle && e.target && typeof e.target.closest === 'function' && e.target.closest(o.handleSelector));
      if (isTouch && !onHandle) {
        longPressTimer = setTimeout(() => { longPressTimer = null; beginDrag(); trackPointer(pressY); }, REORDER_LONG_PRESS_MS);
      } else if (!isTouch) {
        // Mouse/pen arm on travel (below), so a plain click still clicks.
      } else {
        beginDrag();
        trackPointer(pressY);
      }
    }, { signal: o.signal });

    // A completed drag must not ALSO fire the row's click -- these rows are
    // links, and a drop would navigate away from the page you just reordered.
    row.addEventListener('click', (e) => {
      if (!row.__reorderSuppressClick) return;
      row.__reorderSuppressClick = false;
      // QA delta S1: a KEYBOARD (or programmatic) click reports `detail === 0`;
      // a real pointer click never does. Such a click cannot be a drag's own
      // echo, so it is never suppressed. This covers the case the child-
      // exemption below structurally cannot: the three sidebar surfaces' rows
      // ARE the interactive element, so Enter on a focused pinned link was
      // being eaten once after a stranded gesture.
      if (e.detail === 0) return;
      // QA gate W1, second half: never suppress a click on an interactive
      // CHILD either. Those clicks are not the drag's echo, and a real mouse
      // click on a checkbox inside the row does carry `detail === 1`, so the
      // rule above does not subsume this one.
      const onChild = e.target && typeof e.target.closest === 'function' ? e.target.closest(ignoreSelector) : null;
      if (onChild && onChild !== row && row.contains(onChild)) return;
      e.preventDefault();
      e.stopPropagation();
    }, { signal: o.signal, capture: true });
  });

  function onDocPointerMove(e) {
    if (pressIndex === null) return;
    if (activePointerId !== undefined && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
    if (!armed) {
      const dx = Math.abs(e.clientX - pressX);
      const dy = Math.abs(e.clientY - pressY);
      if (e.pointerType === 'touch') {
        // Pre-arm travel on touch means "I am scrolling" -- hand the gesture
        // back to the browser rather than fighting it.
        if (Math.max(dx, dy) > REORDER_TOUCH_SLOP_PX) { endGesture(false); return; }
        return;
      }
      if (Math.max(dx, dy) < REORDER_MOUSE_THRESHOLD_PX) return;
      beginDrag();
    }
    lastClientY = e.clientY;
    trackPointer(e.clientY);
    applyAutoScroll(e.clientY);
  }

  function onDocPointerUp(e) {
    if (pressIndex === null) return;
    if (activePointerId !== undefined && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
    if (armed) rows[pressIndex].__reorderSuppressClick = true;
    endGesture(true);
  }

  function onDocPointerCancel() { endGesture(false); }

  function onDocKeyDown(e) {
    // Escape abandons a drag in progress without reordering.
    if (e.key === 'Escape' && pressIndex !== null) endGesture(false);
  }

  function onDocTouchMove(e) {
    if (armed && e.cancelable) e.preventDefault();
  }


  // --- keyboard focus restore (see pendingReorderFocus above) ---------------
  // AFTER the wiring loop, never before it: the loop is what puts `tabindex`
  // on the freshly rendered handle, and `focus()` silently no-ops on an
  // element that is not yet focusable (proven by this file's own test -- the
  // restore landed on <body> when this block ran first).
  if (o.focusKey && pendingReorderFocus && pendingReorderFocus.key === o.focusKey) {
    const target = rows[pendingReorderFocus.index];
    pendingReorderFocus = null;
    if (target) {
      const handle = o.handleSelector ? target.querySelector(o.handleSelector) : target;
      if (handle && typeof handle.focus === 'function') handle.focus();
    }
  }
}

// FR-4 (v1.19.0): pure decision helper -- is `dir` the yt-dlp module's
// synthetic download folder? Fed by `GET /api/config`'s additive, read-only
// `syntheticFolders` array (see server.js) so Setup's `renderFolders()` can
// disable that one row's remove button without re-deriving/guessing a path
// match itself. Never mutates anything; a non-array `syntheticFolders`
// (e.g. an older cached response shape) safely resolves to "not synthetic"
// rather than throwing. Exported for node:test.
function isSyntheticFolder(dir, syntheticFolders) {
  return Array.isArray(syntheticFolders) && syntheticFolders.includes(dir);
}

// ---- Default landing view (v1.14.0 item 4) ---------------------------------

// Pure: resolves the EFFECTIVE ?root= folder filter for a home-page load,
// applying the configured `defaultView` (db.settings.defaultView) ONLY on a
// bare load -- no ?search=/?folder=/?root= already present -- and only when
// the stored folder still exists among the currently configured `folders`.
// A deep link (any of searchQuery/folderFilter/rootFilter already set)
// always wins and returns `rootFilter` unchanged; a stored default that no
// longer exists falls back to `rootFilter` (i.e. Most recent) rather than
// throwing or partially applying. Exported for node:test.
function resolveDefaultView(rootFilter, searchQuery, folderFilter, defaultView, folders) {
  const isBareLoad = !searchQuery && !folderFilter && !rootFilter;
  if (isBareLoad && defaultView && Array.isArray(folders) && folders.includes(defaultView)) {
    return defaultView;
  }
  return rootFilter || '';
}

// Mock uploader subscriptions counts (based on uploader name length to make it deterministic but diverse)
function getMockSubCount(uploaderName) {
  const code = uploaderName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const count = (code * 17) % 85000 + 150;
  if (count > 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count;
}

// Mock views counts (based on size/addedAt, deterministic)
function getMockViews(mediaId, sizeBytes) {
  const code = parseInt(mediaId.substring(0, 6), 16) || 0;
  const count = (code + (sizeBytes % 10000)) % 120000 + 12;
  return count.toLocaleString() + ' views';
}

// ---- v1.48 item 2: real, day-of view counts --------------------------------
//
// Dean: "Can we have the view counts taken from the content the day of. And
// have it re-heatable if pulled later. We can still have fake stars."
//
// Reads `item.sourceViewCount` -- the count yt-dlp captured from the SOURCE at
// download (or at the last reheat). NOT `item.viewCount`, which is the legacy
// local watch counter and an entirely different number (see server.js's
// `applyCapturedViewCount` for the collision this name avoids).
//
// Falls back to `getMockViews` when an item has no captured count, which is
// every item downloaded before v1.48 and every file that never came from
// yt-dlp at all. That fallback is deliberate: a library that suddenly showed
// "0 views" on everything old would look broken, and Dean explicitly kept the
// fake stars, so a fabricated number remains the house style where no real one
// exists.
//
// `detailed` is the watch page, which has room to say WHEN the number is from.
// A captured count is a snapshot that drifts from reality the moment it is
// taken, so the qualifier is what keeps it honest instead of quietly implying a
// live figure. Cards pass `detailed: false` -- there is no room for the
// qualifier there, and a real-but-dated number is still strictly more truthful
// than the hash of a media id.
//
// GATE FIX (adversarial CRITICAL C2): the qualifier is DERIVED from
// `sourceViewCountCapturedAt`, not hardcoded. It previously always read "when
// downloaded" while nothing ever read the stored date -- so the moment a reheat
// re-snapshotted a count (the half of the feature Dean actually asked for), the
// page asserted a provenance that was false. A count refreshed months later now
// says "as of <date>" instead. That also stops the capture date being write-only
// state, which was the other half of the finding.
//
// The download-vs-reheat test is a time window, because a download capture and
// the scan that indexes the file are the same event seconds apart, while a
// reheat is days or months later. 24h is deliberately generous: being wrong here
// only ever picks the vaguer-but-still-true wording.
//
// Pure and side-effect free so the same item renders identically everywhere.
const DOWNLOAD_CAPTURE_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatViewCountCaptureDate(ms) {
  // v1.54 (Dean, approved with the subscriber-count spec): ISO YYYY-MM-DD --
  // "I like that date format" -- replacing the locale short form.
  // Gate round 1 (adversarial S1): LOCAL date fields, not toISOString (UTC)
  // -- an evening capture must not be labeled with tomorrow's date.
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// v1.54: YouTube-style compact count -- 999 -> "999", 1234 -> "1.2K",
// 24000 -> "24K", 1200000 -> "1.2M". One decimal only under 10 of a unit,
// trailing ".0" stripped. Gate round 1 (adversarial S2): FLOORS like YouTube
// (24,600 -> "24K", never "25K") -- which also makes the unit boundary
// impossible to overshoot (999,500 floors to "999K", never "1000K"). The
// epsilon absorbs binary-float dust (4.3e6/1e6*10 can land a hair under 43)
// so a decimal is never floored one tenth low. Pure; exported for node:test.
function formatCompactCount(n) {
  if (!Number.isInteger(n) || n < 0) return '0';
  if (n < 1000) return String(n);
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [div, suffix] of units) {
    if (n >= div) {
      const v = n / div;
      const text = v < 10
        ? (Math.floor(v * 10 + 1e-9) / 10).toFixed(1).replace(/\.0$/, '')
        : String(Math.floor(v + 1e-9));
      return text + suffix;
    }
  }
  return String(n);
}

// v1.54 (Dean's real subscriber counts): the ONE subscriber-label resolver --
// a captured count renders compact + "as of YYYY-MM-DD" (a snapshot label,
// honest about its date, the resolveViewCountLabel posture); no capture ->
// the deterministic mock, unchanged (Dean kept the fake-numbers house style
// where no real one exists). Pure; consumed by deriveWatchPaintPlan so the
// seed pre-paint and hydration cannot disagree.
function resolveSubscriberLabel(item, channelName) {
  const n = item ? item.sourceFollowerCount : undefined;
  if (Number.isInteger(n) && n >= 0) {
    const capturedAt = item.sourceFollowerCountCapturedAt;
    const MAX_TIME_VALUE = 8.64e15;
    const dated = typeof capturedAt === 'number' && Number.isFinite(capturedAt) && capturedAt > 0 && capturedAt <= MAX_TIME_VALUE;
    return `${formatCompactCount(n)} subscribers` + (dated ? ` as of ${formatViewCountCaptureDate(capturedAt)}` : '');
  }
  return `${getMockSubCount(channelName)} subscribers`;
}

// UI pass D8.1: true when resolveViewCountLabel would print the MOCK (no captured
// count), so a writer can wrap that label in `.ft-fabricated` (the era flourish).
// The same test resolveViewCountLabel branches on - one definition of "real".
function isFabricatedViewCount(item) {
  const raw = item ? item.sourceViewCount : undefined;
  return !Number.isInteger(raw) || raw < 0;
}

function resolveViewCountLabel(item, opts) {
  const detailed = !!(opts && opts.detailed);
  const raw = item ? item.sourceViewCount : undefined;
  // `Number.isInteger` rather than a truthiness test: 0 is a real view count
  // (a brand-new upload), and `count && ...` would fall it back to a fabricated
  // number that is guaranteed to be wrong.
  if (isFabricatedViewCount(item)) {
    return getMockViews((item && item.id) || '', (item && item.size) || 0);
  }
  const base = `${raw.toLocaleString()} view${raw === 1 ? '' : 's'}`;
  if (!detailed) return base;

  const capturedAt = item.sourceViewCountCapturedAt;
  // `MAX_TIME_VALUE` (adversarial SUGGESTION S-D1): beyond ECMAScript's
  // +-8.64e15 ms range `new Date(ms)` is an Invalid Date, and this rendered
  // "1,672,000,000 views as of Invalid Date". Only reachable from a restored or
  // hand-edited database, but the guard already validated finite-and-positive
  // and stopped one comparison short of correct.
  const MAX_TIME_VALUE = 8.64e15;
  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt) || capturedAt <= 0 ||
      capturedAt > MAX_TIME_VALUE) {
    // A count with no capture date cannot be dated, so it makes NO provenance
    // claim at all rather than guessing one. `applyCapturedViewCount` writes the
    // pair as a unit, so this is defensive only.
    return base;
  }
  const addedAt = item.addedAt;
  const capturedAtDownload = typeof addedAt === 'number' && Number.isFinite(addedAt) &&
    Math.abs(capturedAt - addedAt) <= DOWNLOAD_CAPTURE_WINDOW_MS;
  return capturedAtDownload
    ? `${base} when downloaded`
    : `${base} as of ${formatViewCountCaptureDate(capturedAt)}`;
}

// ---- Mobile app shell: bottom nav / Playlists sheet -----------------------

// Pure: which bottom-nav item should be marked active for the current route.
// Home covers "/" and "/index.html" incl. any query (?search=, ?root=,
// ?folder= are all still the home grid). Settings covers "/setup.html".
// "/subscriptions" (the optional yt-dlp module's page, D4) covers
// 'subscriptions' -- this route only ever exists server-side when the module
// is enabled, but the pure mapping itself is unconditional (harmless when the
// route/page never gets served, since nothing then ever navigates there).
// watch.html (and anything else) has no active item. Exported for node:test.
function activeNavItem(pathname, search) {
  if (pathname === '/setup.html') return 'settings';
  // v1.151: Stats is a route now; light its sidebar entry (id=sidebar-stats-link,
  // href=/stats.html). Without this, bootRouter's highlight pass strips the
  // server-rendered active class and Stats shows no lit rail item.
  if (pathname === '/stats.html') return 'stats';
  if (pathname === '/subscriptions') return 'subscriptions';
  // v1.37.0 books: same unconditional-mapping posture as /subscriptions
  // (the link only exists when >=1 book folder is configured). The reader
  // (/read.html) deliberately maps to 'books' -- reading a book keeps the
  // Books nav item lit, like watch keeps no item lit but books is a
  // browsable section.
  if (pathname === '/books' || pathname === '/books.html' || pathname === '/read.html') return 'books';
  // v1.44 music: same posture (link injected only when >=1 music folder set).
  if (pathname === '/music' || pathname === '/music.html') return 'music';
  if (pathname === '/tv' || pathname === '/tv.html') return 'tv';
  // v1.69 podcasts: same posture (link injected only when >=1 subscription).
  if (pathname === '/podcasts' || pathname === '/podcasts.html') return 'podcasts';
  // v1.64 history (count-gated entry, the Liked rule).
  if (pathname === '/history' || pathname === '/history.html') return 'history';
  // v1.75: `home` and `liked` SHARE the `/` path - the central Liked playlist
  // is the home grid scoped by `?liked=1` (main.js: `urlParams.get('liked') ===
  // '1'`) - so the highlight discriminates on the QUERY, mirroring that exact
  // read. Every other home-page scope param (?search=, ?root=, ?folder=) stays
  // Home. `liked` only ever lights an item that exists: the bottom-bar entry
  // is opt-in (default-hidden), and a shell without it simply lights nothing.
  if (pathname === '/' || pathname === '/index.html') {
    return likedScopeQuery(search) ? 'liked' : 'home';
  }
  return null;
}

// Which SIDEBAR entry a resolved nav key lights, keyed by the entry's href.
// v1.75: `liked` joins - its entry is the count-gated one applyLikedSidebarEntry
// builds, whose href is this exact string, so the liked view lights IT rather
// than Home (which is what the shared `/` path used to light). Every key
// activeNavItem can return needs a row here or its sidebar entry silently
// stops lighting; the unit suite binds that coverage against activeNavItem.
const SIDEBAR_HREF_BY_NAV_KEY = {
  home: '/',
  liked: '/?liked=1',
  settings: '/setup.html',
  stats: '/stats.html', // v1.151: the Stats rail entry (id=sidebar-stats-link)
  subscriptions: '/subscriptions',
  books: '/books',
  music: '/music',
  tv: '/tv',
  podcasts: '/podcasts',
  history: '/history',
};

// Paints the shell's nav highlight (bottom bar + sidebar) for a location.
//
// v1.75 (adversarial gate round 2, W2): hoisted OUT of the router closure. The
// two decisions below (bottomNavKeyForHighlight, SIDEBAR_HREF_BY_NAV_KEY) were
// well covered as values while their only USE was unreachable from Node - and
// three mutants on that use survived all 5955 tests: deleting the
// bottomNavKeyForHighlight call (which re-opens the unlit-bar regression the
// fallback exists to fix), passing it a hardcoded `true` (which lights the
// HIDDEN Liked item), and nulling the sidebar href (which stops every sidebar
// entry highlighting, app-wide). Testing a DECISION is not testing its USE -
// the strike this repo keeps taking. Top-level and exported, exactly as
// applyBottomNavCustomization already is, so the DOM pass is bound in jsdom.
//
// Must run AFTER applyBottomNavCustomization for a given paint: it reads
// `hidden` off the Liked item, which that function is what sets.
function applyNavHighlight(pathname, search) {
  if (typeof document === 'undefined') return;
  const key = activeNavItem(pathname, search);
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    bottomNav.querySelectorAll('.bottom-nav-item.active').forEach((el) => { el.classList.remove('active'); setBottomNavItemFilled(el, false); });
    const likedItem = bottomNav.querySelector('[data-nav="liked"]');
    const barKey = bottomNavKeyForHighlight(key, !!likedItem && !likedItem.hidden);
    const item = barKey && bottomNav.querySelector('[data-nav="' + barKey + '"]');
    // Never light an item the layout has hidden (adversarial gate round 2, S4):
    // a floored/opt-in change between paints could otherwise strand `.active`
    // on a display:none node, which reads to the user as an unlit bar.
    if (item && !item.hidden) { item.classList.add('active'); setBottomNavItemFilled(item, true); }
  }
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.querySelectorAll('.sidebar-item.active').forEach((el) => el.classList.remove('active'));
    const href = key ? SIDEBAR_HREF_BY_NAV_KEY[key] : null;
    const match = href && sidebar.querySelector('a.sidebar-item[href="' + href + '"]');
    if (match) match.classList.add('active');
  }
}

// Which BOTTOM-BAR item a resolved nav key lights. Pure, because the DOM shell
// around it is one querySelector and this is the whole decision.
// v1.75 (QA gate S3): the bottom-bar Liked entry is OPT-IN (default-hidden), so
// on a default device /?liked=1 has no item to light and the bar would go
// completely unlit - a visible regression from v1.74, which lit Home there.
// Fall back to Home when the Liked item is absent or hidden: the liked view IS
// the home grid scoped by a query, so Home is the honest answer when Liked's
// own entry is not on the bar. The SIDEBAR key is deliberately NOT folded in -
// its Liked entry is count-gated, not opt-in, and lights on its own terms.
function bottomNavKeyForHighlight(key, likedItemVisible) {
  if (key === 'liked' && !likedItemVisible) return 'home';
  return key;
}

// Does this location query select the central Liked playlist scope? Split out
// so activeNavItem stays one expression per route and this parse is testable
// on its own. A malformed query degrades to "not the liked scope".
function likedScopeQuery(search) {
  try {
    return new URLSearchParams(search || '').get('liked') === '1';
  } catch (_) {
    return false;
  }
}

// ---- Optional yt-dlp subscriptions nav-link injection (D4, T5) ------------
//
// The /subscriptions page + its nav link only exist when the OPTIONAL yt-dlp
// module is enabled (docs/exec-plans/completed/2026-07-05-yt-dlp-integration-
// module.md, locked decision D4). Rather than a CSS-hidden link that always
// exists in the DOM, the link is injected ONLY on a genuine 2xx from the
// capability probe below -- when the module is disabled the probe's route
// doesn't exist server-side at all (see lib/ytdlp/index.js's registerRoutes,
// gated on isEnabled) so it 404s and `shouldInjectSubscriptionsNav` (below)
// returns false, meaning this function does nothing: the link is
// structurally ABSENT from the DOM, not merely hidden (AC3).
//
// Pure decision extracted to its own function so it is node:test-covered
// without a browser/DOM -- the actual DOM mutation below is a thin,
// untested-by-necessity shell around it (this codebase has no browser/DOM
// test harness for any per-page script; see public/js/main.js, watch.js).
function shouldInjectSubscriptionsNav(response) {
  return Boolean(response && response.ok === true);
}

/**
 * v1.47.4 item 4: has the Subscriptions nav ALREADY been injected, on EITHER
 * of its two surfaces?
 *
 * The pre-fix guard tested only `[data-nav="subscriptions"]`, which exists
 * solely on the BOTTOM-NAV entry. On a shell with no `#bottom-nav` that entry
 * is never created, so the guard was permanently false and every call appended
 * another SIDEBAR link. Checking both markers is what makes the injector
 * genuinely idempotent rather than idempotent-only-on-pages-with-a-bottom-nav.
 *
 * Both markers are checked (not just the sidebar one) so a page that has only
 * a bottom nav is equally covered.
 */
function subscriptionsNavAlreadyInjected() {
  return Boolean(
    document.querySelector('[data-nav="subscriptions"]')
    || document.querySelector('[data-nav-sidebar="subscriptions"]'),
  );
}

// Idempotent (checks for an existing injected link first) and defensive --
// missing sidebar/bottom-nav elements (a page that doesn't have them) are
// simply skipped, never thrown on.
function injectSubscriptionsNavLinkIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (subscriptionsNavAlreadyInjected()) return; // already injected

  // v1.53 gate QA-W1: optimistic inject from the capability cache (the
  // idempotency guard makes the later real-path inject a no-op); the real
  // probe below reconciles -- a revoked module REMOVES the optimistic links.
  // v1.339 (L2): the per-device remembered flag (ft-ytdlp-module) counts too - the
  // capability cache is sessionStorage with a 5-minute TTL, so a cold PWA launch never
  // had it and the Subs tab always popped in; an undecided cache defers to the flag.
  const cachedCap = readCapabilityCache();
  let rememberedOn = false;
  try { rememberedOn = localStorage.getItem(CHROME_FLAG_KEYS.ytdlpModule) === '1'; } catch (_) { /* private mode */ }
  const optimisticOn = (cachedCap && typeof cachedCap.moduleEnabled === 'boolean') ? cachedCap.moduleEnabled === true : rememberedOn;
  if (optimisticOn && !subscriptionsNavAlreadyInjected()) {
    injectSubscriptionsNavNodes();
  }
  const dropNavReserve = () => {
    const r = chromeReserveEl(document.getElementById('bottom-nav'), 'subscriptions');
    if (r) { r.remove(); applyBottomNavCustomization(); }
  };

  fetch('/api/subscriptions/health')
    .then((res) => {
      writeCapabilityCache({ moduleEnabled: res.ok === true });
      if (!shouldInjectSubscriptionsNav(res)) {
        // Reconcile an optimistic inject against a revoked module.
        dropNavReserve();
        const sidebarLink = document.querySelector('[data-nav-sidebar="subscriptions"]');
        if (sidebarLink) sidebarLink.remove();
        const navLink = document.querySelector('#bottom-nav [data-nav="subscriptions"]');
        if (navLink) { navLink.remove(); applyBottomNavCustomization(); }
        // v1.153.1: the You-menu row too, or the optimistic inject leaves it
        // orphaned pointing at a now-disabled /subscriptions (slim-gate note).
        const acctRow = document.querySelector('a.account-menu-item[href="/subscriptions"]');
        if (acctRow) acctRow.remove();
        return; // disabled (404) -- inject nothing
      }
      // v1.47.4 item 4: RE-CHECK after the await. The guard at the top runs
      // BEFORE this fetch, so two overlapping calls both passed it and both
      // injected -- the classic async double-inject window (and v1.53's
      // optimistic cache inject makes this re-check newly load-bearing).
      if (subscriptionsNavAlreadyInjected()) return;
      injectSubscriptionsNavNodes();
    })
    .catch(() => { if (!subscriptionsNavAlreadyInjected()) dropNavReserve(); /* network/parse failure -- fail closed, inject nothing (v1.339 L2: and clear the reserve) */ });
}

// The actual DOM builders, shared by the optimistic (cache) and confirmed
// (probe) paths -- v1.53 extraction, byte-identical markup to pre-v1.53.
function injectSubscriptionsNavNodes() {
  // Sidebar entry, inserted right after the existing "Settings"
  // link so it reads as a sibling settings-adjacent surface.
      const settingsSidebarLink = document.querySelector('a.sidebar-item[href="/setup.html"]');
      if (settingsSidebarLink && settingsSidebarLink.parentElement) {
        const sidebarLink = document.createElement('a');
        sidebarLink.href = '/subscriptions';
        sidebarLink.className = 'sidebar-item';
        // v1.47.4 item 4 (tech-debt #33a, the real defect): this element used
        // to carry NO marker at all. The guard only ever matched the
        // BOTTOM-NAV entry's `data-nav`, so on any shell WITHOUT a #bottom-nav
        // the bottom-nav entry was never created, the guard could therefore
        // never become true, and every single call appended another sidebar
        // link. Marking the sidebar entry is what actually closes that loop.
        sidebarLink.setAttribute('data-nav-sidebar', 'subscriptions');
        const sidebarIcon = document.createElement('i');
        sidebarIcon.className = 'icon-refresh';
        sidebarLink.appendChild(sidebarIcon);
        sidebarLink.appendChild(document.createTextNode(' Subscriptions'));
        settingsSidebarLink.insertAdjacentElement('afterend', sidebarLink);
      }

      // Bottom-nav entry (mobile app shell), inserted right after the
      // existing Settings item.
      const settingsNavItem = document.querySelector('#bottom-nav [data-nav="settings"]');
      if (settingsNavItem && settingsNavItem.parentElement) {
        // v1.339 (L2): a sprite <svg>, not the `.icon-refresh` mask (iOS decode lag - the
        // v1.87.1 first-paint glyph rule), matching the reserve's glyph; the tab takes its
        // pre-paint reserve's place when the shell painted one. Sweep S1: a ui-btn stack tab.
        const navLink = bottomNavItemEl({ href: '/subscriptions', nav: 'subscriptions', icon: CHROME_ICON.refresh, label: 'Subs' });
        const navReserve = chromeReserveEl(document.getElementById('bottom-nav'), 'subscriptions');
        if (navReserve) navReserve.replaceWith(navLink);
        else settingsNavItem.insertAdjacentElement('afterend', navLink);

        // Match the existing active-state highlight logic (DOMContentLoaded,
        // below) in case injection resolves after that already ran.
        if (activeNavItem(window.location.pathname, window.location.search) === 'subscriptions') {
          navLink.classList.add('active');
          setBottomNavItemFilled(navLink, true);
        }
        // v1.44 T12: re-apply the user's bar layout now that this item exists.
        applyBottomNavCustomization();
      }
      // v1.153.1 (Dean device): also add the "You" account-menu Subscriptions
      // row. The build-time gate in injectAccountMenu only sees the marker on a
      // WARM capability cache; on a session's first load this injection (the
      // /health resolve) can land AFTER the menu is built, so patch it here too.
      // Idempotent.
      ensureAccountMenuSubscriptionsRow();
}

// v1.153.1: add the Subscriptions quick link to an already-built account menu
// (the cold-first-load path -- see injectSubscriptionsNavNodes). No-op if the
// menu isn't built yet (the build-time gate covers the warm-cache case) or the
// row already exists. Inserted after Stats, before Settings, matching the
// build-time order; the menu's delegated click handler gives it the same
// in-app SPA navigation as the other quick links.
let accountMenuLinksEl = null; // the built menu's link list (injectAccountMenu buildPanel)
function ensureAccountMenuSubscriptionsRow() {
  if (typeof document === 'undefined') return;
  // Sweep S1: the menu's link list lives in the ui.sheet panel, built on the first open and
  // detached from the document while the sheet is closed - so it is held by reference
  // (accountMenuLinksEl), never looked up in the document.
  const U = typeof window !== 'undefined' ? window.ui : null;
  const menu = accountMenuLinksEl;
  if (!menu || !U) return;
  if (menu.querySelector('a.account-menu-item[href="/subscriptions"]')) return;
  const subs = accountMenuRow(U, { href: '/subscriptions', icon: 'subscriptions', label: 'Subscriptions' });
  const stats = menu.querySelector('a.account-menu-item[href="/stats.html"]');
  const settings = menu.querySelector('a.account-menu-item[href="/setup.html"]');
  if (stats) stats.insertAdjacentElement('afterend', subs);
  else if (settings) settings.insertAdjacentElement('beforebegin', subs);
  else menu.appendChild(subs);
}

// ---- v1.52 instant watch: the seed-from-card stash --------------------------
//
// The tapped card already holds everything the watch page's above-the-fold
// metadata renders (recon-verified field-by-field: the list endpoint returns
// the FULL metadata record). A click surface stashes its in-memory item here
// immediately before navigating; watch's init() consumes it and paints
// SYNCHRONOUSLY during the SPA swap -- zero placeholder frames on the common
// path. Single-entry and in-memory only (the homeViewCache posture): a real
// page load starts null, so deep links take the skeleton path. Consumed on
// read; rejected on id mismatch (a stash that raced a different navigation
// must never paint the wrong video's data) and after 10s (a stash whose
// navigation never happened). Top-level (not router-closure) so the bell
// rows below and node:test can both reach it; exposed on window.FileTube for
// main.js/watch.js/player.js writers.
//
// PARTIAL seeds are legal (the notification bell rows carry only
// title/channel/thumbnail): the painter paints what is present and leaves
// skeletons for the rest -- `item.id` is the only required field.
const WATCH_SEED_MAX_AGE_MS = 10 * 1000;
let watchSeedEntry = null;

function stashWatchSeed(item, extras) {
  if (!item || typeof item.id !== 'string' || item.id === '') return false;
  watchSeedEntry = {
    item,
    folderSettings: (extras && extras.folderSettings) || null,
    ts: Date.now(),
  };
  return true;
}

function consumeWatchSeed(mediaId) {
  const s = watchSeedEntry;
  watchSeedEntry = null; // single-shot regardless of outcome
  if (!s || !mediaId || s.item.id !== mediaId) return null;
  if (Date.now() - s.ts > WATCH_SEED_MAX_AGE_MS) return null;
  return s;
}

// v1.52 instant watch: the PURE half of the watch metadata painter -- which
// fields can render from this item, and as what strings. The DOM applier in
// watch.js consumes this plan verbatim, so the seed pre-paint and the
// hydration repaint literally cannot disagree on a rendered value. Every
// field is GUARDED on its inputs being present: a partial seed (bell rows)
// yields a partial plan and the markup skeletons cover the rest. The views
// label needs a captured count OR the size the mock hashes -- a defaulted
// size would render a DIFFERENT mock number than hydration recomputes (a
// visible rewrite, the class this wave exists to kill). `isFullItem` (list/
// detail records always carry size + filePath, partial seeds never do)
// gates description rendering, where "tags absent" means "has none" only on
// a full record. Exported for node:test at divergent fixture spellings.
function deriveWatchPaintPlan(item, channelName) {
  if (!item || typeof item.id !== 'string' || item.id === '') return null;
  const plan = { id: item.id };
  plan.isFullItem = typeof item.size === 'number' && typeof item.filePath === 'string';
  if (typeof item.title === 'string' && item.title !== '') plan.title = item.title;
  if (Number.isInteger(item.sourceViewCount) || typeof item.size === 'number') {
    plan.viewsLabel = resolveViewCountLabel({ ...item, id: item.id }, { detailed: true });
    // UI pass D8.1: the mock is a fabricated stat (the era flourish); the painter marks it.
    plan.viewsFabricated = isFabricatedViewCount(item);
  }
  if (typeof channelName === 'string' && channelName !== '') {
    plan.channelName = channelName;
    plan.channelAvatarUrl = typeof item.channelAvatarUrl === 'string' ? item.channelAvatarUrl : '';
    // v1.54: real captured count when present, mock fallback otherwise.
    plan.subsLabel = resolveSubscriberLabel(item, channelName);
    // UI pass D8.1: true when that label is the mock (no captured count) - resolveSubscriberLabel's own test.
    plan.subsFabricated = !(Number.isInteger(item.sourceFollowerCount) && item.sourceFollowerCount >= 0);
  }
  if (typeof item.addedAt === 'number') plan.dateLabel = formatRelativeTime(item.addedAt);
  if (typeof item.size === 'number') plan.sizeLabel = formatFileSize(item.size);
  if (typeof item.ext === 'string') {
    plan.typeLabel = (item.ext || '').replace('.', '').toUpperCase() || 'Unknown';
  }
  if (typeof item.filePath === 'string') plan.filePath = item.filePath;
  return plan;
}

// v1.52 T2: can this seed item drive a full player PRE-LOAD (start the real
// media before hydration)? Needs the stream-decision fields a list record
// always carries and a partial (bell-row) seed never does: `type` picks the
// element/branch, and size+filePath mark a full record (the same marker the
// paint plan uses). Pure; exported for node:test.
function isFullWatchSeedItem(item) {
  return Boolean(item)
    && typeof item.id === 'string' && item.id !== ''
    && typeof item.type === 'string'
    && typeof item.size === 'number'
    && typeof item.filePath === 'string';
}

// ---- v1.53: the capability cache (sessionStorage) ---------------------------
//
// Dean's refresh-beat fix: the Reheat/Subscribe/pinned controls depend on
// capability answers (module health, subscription list, pins) that three
// independent per-tab latches used to re-fetch on every refresh. The cache
// makes the LAST KNOWN answers survive a refresh for an OPTIMISTIC first
// render; every existing probe still runs and reconciles (both button flows
// already remove/rebuild wholesale on resolution), so a revoked capability
// corrects after ~1 RTT -- the stale window Dean explicitly accepted.
// sessionStorage, NOT localStorage (tab-scoped, dies with the tab) and NO
// service worker (unregisterStaleServiceWorkers actively sheds them by
// policy). Every read crosses `sanitizeCapabilityCache` -- an untrusted
// string with an allowlisting scrub (own-key, primitive-only), a TTL, and a
// future-ts rejection. Every access is try/catch (private mode).
const CAP_CACHE_KEY = 'ft-cap-cache-v1';
const CAP_CACHE_TTL_MS = 5 * 60 * 1000;

// Pure + exported for node:test. Flat own-key primitive scrub per entry so a
// crafted payload can never smuggle objects/prototype keys into renderers.
function sanitizeCapabilityCache(parsed, nowMs) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (typeof parsed.ts !== 'number' || !Number.isFinite(parsed.ts)) return null;
  if (nowMs - parsed.ts > CAP_CACHE_TTL_MS) return null;
  if (parsed.ts > nowMs + 60 * 1000) return null; // a future clock is a lie
  const scrubFlat = (o) => {
    const r = {};
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') r[k] = v;
    }
    return r;
  };
  const out = { ts: parsed.ts };
  if (typeof parsed.moduleEnabled === 'boolean') out.moduleEnabled = parsed.moduleEnabled;
  if (Array.isArray(parsed.subs)) {
    out.subs = parsed.subs
      .filter((s) => s && typeof s === 'object' && !Array.isArray(s) && typeof s.channelUrl === 'string' && s.channelUrl !== '')
      .map(scrubFlat);
  }
  if (Array.isArray(parsed.pins)) {
    out.pins = parsed.pins
      .filter((p) => p && typeof p === 'object' && !Array.isArray(p))
      .map(scrubFlat);
  }
  return out;
}

function readCapabilityCache(nowMs) {
  let raw = null;
  try { raw = sessionStorage.getItem(CAP_CACHE_KEY); } catch (_) { return null; /* storage disabled */ }
  if (!raw) return null;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) { return null; }
  return sanitizeCapabilityCache(parsed, typeof nowMs === 'number' ? nowMs : Date.now());
}

function writeCapabilityCache(patch) {
  try {
    const now = Date.now();
    const existing = readCapabilityCache(now) || {};
    const merged = { ...existing, ...patch, ts: now };
    sessionStorage.setItem(CAP_CACHE_KEY, JSON.stringify(merged));
  } catch (_) { /* storage disabled -- the probes still work uncached */ }
  // v1.339 (L2): every confirmed module answer also lands in the per-device flag the
  // pre-paint chrome reserve reads (the capability cache above is sessionStorage with a
  // 5-minute TTL, so a cold PWA launch never has it).
  if (patch && typeof patch.moduleEnabled === 'boolean') rememberModuleEnabled(patch.moduleEnabled);
}

// ---- v1.339 (L2, plan D5): remembered chrome flags -------------------------
// The header Queue / Download buttons and the bottom-nav Subs / Download / You tabs are
// injected AFTER a fetch, so each used to pop in and re-space its row a beat after first
// paint. Each injector now records its last outcome in localStorage (the v1.99 / v1.101
// persist-last-known pattern: the avatar bar, the bell) and the shells' inline pre-paint
// reserve (the `ft-chrome-reserve` blocks, byte-identical in every header shell) paints a
// same-box placeholder from that flag BEFORE first paint; the injector then REPLACES the
// placeholder in place (or removes it when the feature is gone - a one-time collapse,
// disclosed). A first-ever launch has no flags, so it still pops in once (disclosed).
// Every read/write is try/catch'd (private mode / blocked storage -> no reserve, the
// pre-L2 behaviour). Keys: see CHROME_FLAG_KEYS; dropped on sign-out with the bell flag.
const CHROME_FLAG_KEYS = {
  ytdlpModule: 'ft-ytdlp-module', // '1' | '0' - the optional yt-dlp module answered enabled
  queueShown: 'ft-queue-shown', // '1' | '0' - the header queue button was visible (non-empty queue)
  bottomNavLast: 'ft-bottomnav-last', // JSON array - the bottom bar's last resolved visible ids, in order
};
function rememberModuleEnabled(enabled) {
  try { localStorage.setItem(CHROME_FLAG_KEYS.ytdlpModule, enabled ? '1' : '0'); } catch (_) { /* private mode */ }
}
function rememberQueueShown(shown) {
  try { localStorage.setItem(CHROME_FLAG_KEYS.queueShown, shown ? '1' : '0'); } catch (_) { /* private mode */ }
}
function rememberBottomNavLayout(visibleIds) {
  try { localStorage.setItem(CHROME_FLAG_KEYS.bottomNavLast, JSON.stringify(Array.isArray(visibleIds) ? visibleIds : [])); } catch (_) { /* private mode */ }
}
// The pre-paint placeholder a reserve block left for `kind` in `scope`, or null.
function chromeReserveEl(scope, kind) {
  if (!scope || typeof scope.querySelector !== 'function') return null;
  return scope.querySelector('[data-ft-reserve="' + kind + '"]');
}

// v1.339 (L2, plan D5): the watch page's frame-one Subscribe render reads the capability
// cache, but the cache is written by SEVERAL probes - the nav injectors write only
// `{ moduleEnabled }` - so a cache holding moduleEnabled:true with NO `subs` rendered a
// subscribed channel as "Subscribe" (no bell), then flipped to "Subscribed" when the
// confirmed fetch landed (the v1.54 fix's hole, `cachedCap.subs || []`). Pure: returns
// `{ moduleEnabled, subs }` only when the cache can decide the state - module off, or on
// WITH a subs array - else null (render nothing from cache; the confirmed pass paints).
function cachedSubscribeState(cap) {
  if (!cap || typeof cap.moduleEnabled !== 'boolean') return null;
  if (cap.moduleEnabled === false) return { moduleEnabled: false, subs: [] };
  if (!Array.isArray(cap.subs)) return null;
  return { moduleEnabled: true, subs: cap.subs };
}

// The write-side sub scrub: exactly what the Subscribe/pin decisions need.
function scrubSubsForCache(subs) {
  return (Array.isArray(subs) ? subs : [])
    .filter((s) => s && typeof s.channelUrl === 'string' && s.channelUrl !== '')
    .map((s) => ({
      id: typeof s.id === 'string' ? s.id : '',
      channelUrl: s.channelUrl,
      ...(typeof s.channelId === 'string' ? { channelId: s.channelId } : {}),
      ...(typeof s.channelHandleUrl === 'string' ? { channelHandleUrl: s.channelHandleUrl } : {}),
      ...(typeof s.channelDir === 'string' ? { channelDir: s.channelDir } : {}),
      ...(typeof s.name === 'string' ? { name: s.name } : {}),
      // v1.314: the push bell rides the cache so the watch page's frame-one
      // render (from this cache) shows the same bell the confirmed fetch will.
      ...(typeof s.pushBell === 'boolean' ? { pushBell: s.pushBell } : {}),
    }));
}

// Optimistic pinned-sidebar paint from the cache -- the real fetchAllPins()
// pass replaces it wholesale (renderPinnedSidebar rebuilds from scratch).
function primePinnedSidebarFromCache() {
  const cached = readCapabilityCache();
  if (cached && Array.isArray(cached.pins) && cached.pins.length > 0) {
    renderPinnedSidebar(cached.pins);
  }
}

// ---- v1.53: the attribution picker ------------------------------------------
//
// One dialog, two callers (watch page single-item, folder-view bulk) -- the v1.41.7
// one-shared-decision-function posture. Sweep S9: a ui.sheet of ui-rows (the channel's
// ui.avatar, its name, where it comes from), the optional "also move" switch above them, and
// the ui.state empty state; the sheet's Close / Esc / scrim cancel. createElement /
// textContent ONLY (target names are server-sanitized but the discipline is absolute).
// One pick: the first row tap closes the dialog and calls onPick once; a second tap (on any
// row) while it closes picks nothing. Gate W6: body-mounted, so the caller wires the returned
// dismiss to its view teardown.
function showAttributionPicker(targets, opts, onPick) {
  if (typeof document === 'undefined') return null;
  const U = dialogUi();
  if (!U) return null;
  const o = opts || {};
  const body = document.createDocumentFragment();

  let relocateCheck = null;
  if (o.showRelocate) {
    const label = document.createElement('label');
    label.className = 'attr-picker-relocate';
    const text = document.createElement('span');
    text.textContent = "Also move the files into the channel's folder";
    relocateCheck = document.createElement('input');
    relocateCheck.type = 'checkbox';
    relocateCheck.className = 'ui-switch';
    relocateCheck.setAttribute('role', 'switch');
    relocateCheck.checked = true;
    label.appendChild(text);
    label.appendChild(relocateCheck);
    body.appendChild(label);
  }

  let ctrl = null;
  let picked = false;
  const list = U.list({ size: 'default', media: 'avatar', label: 'Channels' });
  for (const t of (Array.isArray(targets) ? targets : [])) {
    if (!t || typeof t.channelUrl !== 'string' || typeof t.channelName !== 'string') continue;
    const source = resolveAvatarSource(t.channelName, t.channelAvatarUrl || '');
    const row = U.row({
      media: U.avatar({ name: t.channelName, url: source.type === 'url' ? source.url : null, kind: 'channel', size: 'md' }),
      title: t.channelName,
      meta: t.source === 'subscription' ? 'Subscribed' : 'In library',
      onClick: () => {
        if (picked || !ctrl || !ctrl.isOpen()) return;
        picked = true;
        const relocate = relocateCheck ? relocateCheck.checked === true : false;
        ctrl.close();
        if (typeof onPick === 'function') onPick(t, { relocate });
      },
    });
    row.classList.add('attr-picker-row');
    list.appendChild(row);
  }
  if (list.firstChild) body.appendChild(list);
  else body.appendChild(U.state({ icon: 'subscriptions', title: 'No channels to attribute to yet', body: 'Subscribe to a channel first.' }));

  ctrl = U.sheet({ variant: 'dialog', title: o.title || 'Attribute to channel', content: body });
  ctrl.open();
  // After open(): ui.sheet sets the sheet's variant classes on open, replacing any set before.
  ctrl.el.classList.add('attr-picker-dialog');
  return { dismiss: () => ctrl.close() };
}

// ---- v1.51: the notification bell ------------------------------------------
//
// YouTube-style bell in the header's top-right, on every shell that has the
// shared header (login/welcome have none and are pre-auth anyway). Injected
// here (not in per-shell markup) so all 8 shells get it from ONE code path.
// Capability probe = the first GET /api/notifications/badge: the server 404s
// unless yt-dlp is enabled AND >=1 subscription exists AND the instance
// toggle is on, so a disabled install renders byte-identical chrome (the
// same fail-closed posture as the subscriptions nav link above).
//
// Two-tier semantics (Dean, exec-plan decision 3): opening the panel zeroes
// the NUMBER badge (server-persisted mark-seen); each row keeps its dot
// until tapped (mark-read); Clear all empties the panel server-side for
// THIS user only (after a ui.confirm, sweep S4).
//
// Pure decisions extracted for node:test (no DOM), same division as every
// injector in this file.

function shouldInjectNotificationBell(response) {
  return Boolean(response && response.ok === true);
}

// The badge label: '' means "render no bubble at all" (never a literal '0').
// Capped at 20+ like the real thing -- past that the number is noise.
function formatNotificationBadge(count) {
  if (!Number.isInteger(count) || count <= 0) return '';
  return count > 20 ? '20+' : String(count);
}

// Server panel row -> everything the DOM renderer needs. The channel label
// falls back to folderName (the resolveChannelName posture: a captured
// channelName wins, a bare folder-derived name is better than blank). Media
// ids are md5 hex, so the href is built raw exactly like main.js's card
// builder (percent-encode at ONE URL layer -- and that layer is not here).
// v1.288 (Dean's "nothing iconless" rule): the two fallback marks every
// notification row can lean on. NOTIF_ENGINE_ICON is the vendored yt-dlp mark
// for downloader-engine rows (they have no per-item thumbnail); NOTIF_FALLBACK_ICON
// is the FileTube logo - the guaranteed floor for a media row that never got a
// thumbnail AND the onerror target for a thumbnail whose URL 404s, so a
// stale/deleted image degrades to the logo instead of the browser's broken glyph.
// (Sweep S4, D4.4: a broken AVATAR degrades to ui.avatar's monogram, never the logo.)
const NOTIF_ENGINE_ICON = '/icons/ytdlp.svg';
const NOTIF_FALLBACK_ICON = '/icons/icon-192.png';

function buildNotificationRowModel(row) {
  if (!row || typeof row.mediaId !== 'string' || row.mediaId === '') return null;
  // v1.146 (downloader-engine): engine event rows - server-composed title,
  // the generated-glyph avatar tile, and a tap that lands on the Setup page's
  // Downloads box (admin-only rows; the server already filtered). Kept ABOVE
  // the media/podcast paths so an engine row can never fall through to a
  // /watch.html href built from its synthetic id. v1.288: they now wear the
  // yt-dlp mark (an icon-fit thumb) instead of a blank right side.
  if (row.kind === 'engine') {
    return {
      id: row.id,
      mediaId: row.mediaId,
      kind: 'engine',
      href: '/setup.html',
      title: typeof row.title === 'string' ? row.title : '',
      channelLabel: 'Downloader engine',
      channelAvatarUrl: '',
      thumbnailUrl: NOTIF_ENGINE_ICON,
      thumbnailIsIcon: true,
      timeLabel: formatRelativeTime(row.createdAt),
      unread: row.unread === true,
      channelHref: null, // sweep S4: an engine row has no channel to open
    };
  }
  const channelName = displayChannelName(typeof row.channelName === 'string' ? row.channelName.trim() : ''); // v1.114 A2: "@handle" -> name
  const folderName = typeof row.folderName === 'string' ? row.folderName.trim() : '';
  // v1.73: podcast rows deep-link the podcasts place (?play= resumes the
  // episode) and wear the SHOW cover; media rows are byte-identical.
  // (The bell row TAP's watch-seed stash is guarded media-positive at the
  // click site - adversarial W5, the fourth strike of the seed class.)
  // v1.251: an audio media row's href is /music now - the click-site stash stays
  // safe via consumeWatchSeed's id-guard/TTL (see the stash-site notes).
  const isPodcast = row.kind === 'podcast';
  // v1.251 (Dean's consistency rule): an AUDIO media bell row opens Music - the
  // /api/notifications row carries `type` (+ chapterCount for albums), so the ONE
  // rule (audioOpenHref) decides; a video row keeps /watch, a podcast its place.
  const mediaHref = (!isPodcast && audioOpenHref({ id: row.mediaId, type: row.type, chapterCount: row.chapterCount }))
    || `/watch.html?v=${row.mediaId}`;
  return {
    id: row.id,
    mediaId: row.mediaId,
    kind: isPodcast ? 'podcast' : 'media',
    href: isPodcast ? `/podcasts?play=${encodeURIComponent(row.mediaId)}` : mediaHref,
    title: typeof row.title === 'string' ? row.title : '',
    channelLabel: channelName || folderName || 'Library',
    // v1.302 (Dean, on device): a podcast row's AVATAR (the left circle) is the SHOW
    // COVER (its artUrl), not a monogram - the show art IS its identity (the Apple/Spotify
    // Podcasts posture), and the server sends no channelAvatarUrl for shows so the row
    // otherwise fell to the deterministic C/H/T monogram. Media/YT rows keep the captured
    // channel avatar unchanged; an art-less podcast still falls back to the monogram (''),
    // and a 404 on the cover self-heals to the monogram via the avatar img's onerror.
    channelAvatarUrl: isPodcast
      ? (typeof row.artUrl === 'string' && row.artUrl !== '' ? row.artUrl : '')
      : (typeof row.channelAvatarUrl === 'string' ? row.channelAvatarUrl : ''),
    // v1.288: every row carries a picture. A podcast uses its show art (which
    // itself falls back to a 🎧 placeholder server-side); a media row with a real
    // thumbnail uses it; a thumbnail-less media row (or the defensive empty-artUrl
    // podcast) falls back to the FileTube logo (icon-fit) so it is never blank.
    ...(function () {
      const real = isPodcast
        ? (typeof row.artUrl === 'string' && row.artUrl !== '' ? row.artUrl : null)
        : (row.hasThumbnail === true ? `/thumbnail/${row.mediaId}` : null);
      // An icon-fit thumb is a LOGO (contain + quiet fill), never a photo to
      // cover-crop or hang a duration badge on. A resolved real thumbnail/show-art
      // is a photo; only the fallback logo is an icon.
      return { thumbnailUrl: real || NOTIF_FALLBACK_ICON, thumbnailIsIcon: real === null };
    })(),
    // v1.208 (Dean): the watch length -> a small duration badge on the thumb.
    durationSec: Number(row.durationSec) > 0 ? Number(row.durationSec) : 0,
    timeLabel: formatRelativeTime(row.createdAt),
    unread: row.unread === true,
    // Sweep S4 (D8.3): the row menu's "Open channel" - a media row opens its folder's
    // channel page (the card byline's own `/?folder=` href, main.js), a podcast row its
    // show (podcasts.js reads ?show=). The API row is unchanged: the show id is read back
    // from the server's `/podcastart/<subId>` art URL. null = no channel to open.
    channelHref: isPodcast ? notifShowHref(row.artUrl) : (folderName ? `/?folder=${encodeURIComponent(folderName)}` : null),
  };
}

// Sweep S4: `/podcastart/<encoded subId>` (lib/notifications/routes.js) -> the show page.
function notifShowHref(artUrl) {
  const m = typeof artUrl === 'string' ? /^\/podcastart\/([^/?#]+)$/.exec(artUrl) : null;
  if (!m) return null;
  let id;
  try { id = decodeURIComponent(m[1]); } catch (_) { return null; }
  return id ? `/podcasts?show=${encodeURIComponent(id)}` : null;
}

// Sweep S4 (D8.3, Dean: "Notification delete leaves the row"): the row menu - reached by
// the trailing kebab, a long-press and a desktop right-click - in this order: Open channel
// (when the row has one), Dismiss (every row), Delete file (MEDIA rows only: a podcast
// episode or an engine event is not a /api/videos item). Pure, exported for tests.
function buildNotificationMenuItems(m) {
  if (!m) return [];
  const items = [];
  if (m.channelHref) items.push({ value: 'channel', icon: 'open_in_new', label: m.kind === 'podcast' ? 'Open show' : 'Open channel' });
  items.push({ value: 'dismiss', icon: 'close', label: 'Dismiss' });
  if (m.kind === 'media') items.push({ value: 'delete', icon: 'delete', label: 'Delete file', danger: true });
  return items;
}

// The delete confirm's copy says what the ONE delete path does: DELETE /api/videos/:id
// moves the file to Trash (lib/media/routes.js, the v1.65 trash move; the card menu's
// wording, main.js cardDeleteConfirmCopy) - never "permanently". Pure, exported.
function notifDeleteConfirmCopy(m) {
  const title = m && typeof m.title === 'string' && m.title !== '' ? m.title : 'This file';
  return {
    title: 'Move to Trash?',
    body: '"' + title + '" leaves your library now. It stays in Trash, where you can restore it from Settings, until the Trash retention window empties it.',
    confirmLabel: 'Move to Trash',
    cancelLabel: 'Cancel',
    danger: true,
  };
}

function notificationBellAlreadyInjected() {
  return Boolean(document.getElementById('notif-bell-btn'));
}

// v1.68: set by the injector below; called only by the jsdom test harness
// (see the comment at its assignment).
let __notifBellPollStopForTests = null;

function injectNotificationBellIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (notificationBellAlreadyInjected()) return;
  const headerRight = document.querySelector('.header-right');
  if (!headerRight) return; // shell without a header (login/welcome)

  // v1.101 shimmer sweep: RESERVE the bell slot with a shimmer placeholder if the
  // bell was enabled on the last load (persist-last-known, the v1.99 avatar-bar
  // pattern) - the badge probe below reconciles it. So on a warm instance the
  // bell reveals in place instead of popping into the header a beat late. The
  // enabled flag is per-DEVICE, so it is dropped on sign-out (see accountSignOut).
  // First-ever load: no flag -> the bell still pops in once (disclosed). If the
  // feature was turned OFF since, the placeholder is removed on the probe (a
  // one-time collapse, disclosed).
  const NOTIF_BELL_ENABLED_KEY = 'ft-notif-bell-enabled';
  const removeBellPlaceholder = () => {
    const ph = document.getElementById('notif-bell-placeholder');
    if (ph) ph.remove();
  };
  let bellWasEnabled = false;
  try { bellWasEnabled = localStorage.getItem(NOTIF_BELL_ENABLED_KEY) === '1'; } catch (_) { /* private mode */ }
  // v1.339 (L2): the shells' inline pre-paint block paints this same placeholder before
  // first paint (so this DCL-time copy only runs on a shell without it); both sit AFTER
  // the queue button / its reserve so the queue stays left of the bell (#140).
  const queueEl = () => document.getElementById('queue-btn') || chromeReserveEl(headerRight, 'queue');
  const afterQueue = () => { const q = queueEl(); return q && q.parentNode === headerRight ? q.nextSibling : headerRight.firstChild; };
  if (bellWasEnabled && !document.getElementById('notif-bell-placeholder')) {
    // Sweep S1: the real bell's ui-btn box, a shimmer disc in its icon slot.
    const ph = document.createElement('span');
    ph.id = 'notif-bell-placeholder';
    ph.className = 'ui-btn ui-btn--plain ui-btn--md ui-btn--icon notif-bell-btn';
    ph.setAttribute('aria-hidden', 'true');
    const slot = document.createElement('span');
    slot.className = 'ui-btn__icon';
    const disc = document.createElement('span');
    disc.className = 'notif-bell-skel skeleton-shimmer';
    slot.appendChild(disc);
    ph.appendChild(slot);
    headerRight.insertBefore(ph, afterQueue());
  }

  fetch('/api/notifications/badge')
    .then((res) => {
      if (!shouldInjectNotificationBell(res)) {
        try { localStorage.setItem(NOTIF_BELL_ENABLED_KEY, '0'); } catch (_) { /* private mode */ }
        return null;
      }
      return res.json().then((body) => ({ count: body && Number.isInteger(body.count) ? body.count : 0 }));
    })
    .then((probe) => {
      // reveal-once: the reserve goes on every exit - disabled -> just gone; enabled -> the
      // real bell takes its exact place below (v1.339 L2: replaceWith, not a re-insert at
      // firstChild, so the row never re-orders or re-spaces).
      if (!probe || notificationBellAlreadyInjected()) { removeBellPlaceholder(); return; } // (the second arm: the async double-inject window)
      // Sweep S4: the panel is a ui.sheet; ui.js loads before common.js on every shell (step 4).
      const U = typeof window !== 'undefined' ? window.ui : null;
      if (!U || typeof U.sheet !== 'function') { removeBellPlaceholder(); return; }
      try { localStorage.setItem(NOTIF_BELL_ENABLED_KEY, '1'); } catch (_) { /* private mode */ }

      // ---- bell button + badge bubble (createElement/textContent only) ----
      // Sweep S1 (F31): a plain ui-btn icon button, the shared bell (v1.340) from the sprite.
      const bellBtn = chromeButtonEl({ cls: 'notif-bell-btn', icon: CHROME_ICON.bell, ariaLabel: 'Notifications' });
      bellBtn.id = 'notif-bell-btn';
      bellBtn.setAttribute('aria-haspopup', 'true');
      bellBtn.setAttribute('aria-expanded', 'false');
      const badge = document.createElement('span');
      badge.id = 'notif-bell-badge';
      badge.className = 'ui-chip ui-chip--count notif-bell-badge';
      badge.hidden = true;
      bellBtn.appendChild(badge);
      const bellPlaceholder = document.getElementById('notif-bell-placeholder');
      if (bellPlaceholder && bellPlaceholder.parentNode === headerRight) bellPlaceholder.replaceWith(bellBtn);
      else { removeBellPlaceholder(); headerRight.insertBefore(bellBtn, afterQueue()); }

      // ---- the panel: ONE ui.sheet (sweep S4, D4.6 / D8.3) ------------------------
      // A popover under the bell on desktop, a bottom sheet on the phone (variant 'auto').
      // The sheet owns the scrim (a tap outside closes), Esc (the topmost overlay only),
      // the body lock and focus return, and applies its open class under Reduce Motion too
      // (F48). Rows are ui-rows in ONE ui-list whose columns are reserved on every row
      // (AC5, F28): the unread dot (lead), the avatar (media), the text (body), the
      // thumbnail (aside) and ONE trailing kebab (actions). The v1.68 X and the v1.161
      // in-row two-tap delete are gone: Dismiss and Delete file live in the row menu (the
      // kebab, a long-press, a desktop right-click) and behind a swipe left.
      const content = document.createElement('div');
      content.className = 'notif-sheet';
      const tools = document.createElement('div');
      tools.className = 'notif-sheet__tools';
      const clearBtn = U.button({ variant: 'plain', size: 'sm', label: 'Clear all', doc: document });
      clearBtn.id = 'notif-clear-btn';
      tools.appendChild(clearBtn);
      const list = U.list({ size: 'media', lead: true, media: 'avatar', aside: 'thumb', actions: 1, divider: 'inset', label: 'Notifications', doc: document });
      list.id = 'notif-panel-list';
      const stateHost = document.createElement('div');
      stateHost.className = 'notif-sheet__state';
      content.appendChild(tools);
      content.appendChild(list);
      content.appendChild(stateHost);

      // Per-open lifetime: every menu and confirm the panel opens takes this signal, so the
      // panel closing (Esc, the scrim, a row tap, a back navigation, the feature switching
      // off) closes them too - a confirm can never outlive the panel and answer later.
      let openCtl = null;
      // Every row's gesture handles (its swipe controller, its action-menu trigger), torn
      // down on every re-render and on close so nothing outlives its row.
      let rowHandles = [];
      const dropHandle = (h) => {
        try { if (h.swipe) h.swipe.destroy(); } catch (_) { /* already gone */ }
        try { if (h.offMenu) h.offMenu(); } catch (_) { /* already gone */ }
      };
      const teardownRows = () => {
        const hs = rowHandles;
        rowHandles = [];
        hs.forEach(dropHandle);
      };
      const sheet = U.sheet({
        variant: 'auto', anchor: bellBtn, title: 'Notifications', content, doc: document,
        onClosing: () => {
          bellBtn.setAttribute('aria-expanded', 'false');
          if (openCtl) { openCtl.abort(); openCtl = null; }
        },
      });
      sheet.el.id = 'notif-panel'; // an id: ui.sheet rewrites className on every open
      const panelOpen = () => sheet.isOpen();

      const setBadge = (count) => {
        const label = formatNotificationBadge(count);
        badge.textContent = label;
        badge.hidden = label === '';
      };
      setBadge(probe.count);

      // One state at a time: the rows, a skeleton, or a ui.state (empty / error).
      const showState = (node) => {
        teardownRows();
        list.textContent = '';
        stateHost.textContent = '';
        list.hidden = !!node;
        tools.hidden = true;
        if (node) stateHost.appendChild(node);
      };
      const renderEmpty = () => showState(U.state({ icon: 'notifications', title: 'No notifications yet', body: 'New downloads land here.', doc: document }));
      const renderError = () => showState(U.state({ icon: 'error', title: 'Could not load notifications', action: { label: 'Try again', onClick: () => loadRows() }, doc: document }));
      // D9: the loading skeleton is the REAL row grid (same list, same slots), so the rows
      // replace it without moving a column.
      const renderSkeleton = () => {
        showState(null);
        for (let i = 0; i < 3; i++) {
          const media = document.createElement('span');
          media.className = 'ui-avatar ui-avatar--md skeleton-shimmer';
          const title = document.createElement('span');
          title.className = 'skeleton-text skeleton-text-long skeleton-shimmer';
          title.textContent = ' ';
          const meta = document.createElement('span');
          meta.className = 'skeleton-text skeleton-text-mid skeleton-shimmer';
          meta.textContent = ' ';
          const thumb = U.thumb({ context: 'row', doc: document });
          thumb.classList.add('skeleton-shimmer');
          const row = U.row({ size: 'media', media, title, meta, aside: thumb, actions: [null], doc: document });
          row.setAttribute('aria-hidden', 'true');
          list.appendChild(row);
        }
      };

      // v1.161 (Dean): shared row teardown - drop the row, keep keyboard focus in the list
      // (the next row's kebab, else the bell), show the empty state when the last row
      // goes, and reconcile the badge from the SERVER truth (never arithmetic on a stale
      // count; same panel-open suppression the poll uses). Dismiss and delete both use it.
      const removeNotifRowReconcile = (row) => {
        const rows = Array.from(list.querySelectorAll('.ui-row[data-notif-id]'));
        const idx = rows.indexOf(row);
        const next = rows[idx + 1] || rows[idx - 1] || null;
        const h = rowHandles.find((x) => x.row === row);
        if (h) { rowHandles = rowHandles.filter((x) => x !== h); dropHandle(h); }
        row.remove();
        const nextFocus = (next && next.querySelector('.notif-more')) || bellBtn;
        if (nextFocus && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) nextFocus.focus();
        if (!list.querySelector('.ui-row[data-notif-id]')) renderEmpty();
        return fetch('/api/notifications/badge')
          .then((r) => (r.ok ? r.json() : null))
          .then((b) => { if (b && !panelOpen()) setBadge(b.count); })
          .catch(() => { /* cosmetic - next open reconciles */ });
      };

      // window.showToast, not the bare binding (the watch.js share pattern): present in the
      // browser, absent under the jsdom harness so a failure-path toast's auto-dismiss timer
      // never outlives a test's document.
      const showToastSafe = (msg) => {
        if (typeof window !== 'undefined' && typeof window.showToast === 'function') window.showToast(msg);
      };

      // Rows with a request in flight (a dismiss or a delete): every other path on that row
      // is a no-op until it settles.
      const busyRows = new WeakSet();

      // DISMISS - not destructive (D4.8): no confirm. NON-OPTIMISTIC (v1.54 law): the row
      // leaves only on a confirmed 2xx; a failure keeps it and allows a retry.
      const dismissRow = (m, row) => {
        if (busyRows.has(row) || !row.isConnected) return;
        busyRows.add(row);
        fetch('/api/notifications/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: m.id }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`dismiss failed: ${res.status}`);
            return removeNotifRowReconcile(row);
          })
          .catch(() => {
            busyRows.delete(row);
            showToastSafe('Could not dismiss the notification.');
          });
      };

      // DELETE FILE - DESTRUCTIVE (D8.3, full gate). Every path (the menu item, the swipe's
      // Delete button) lands here, and NOTHING reaches the delete request unless ui.confirm
      // resolved exactly `true`: Cancel, Esc, the scrim, Close, the panel closing (the
      // signal) and a late tap on a closing dialog all resolve false. One confirm at a time
      // for the whole panel; a row with a request in flight asks nothing. The request is
      // the SAME one the v1.161 button sent: DELETE /api/videos/:id (-> Trash, recoverable),
      // then a best-effort dismiss of the row's notification.
      let confirmOpen = false;
      const requestDelete = (m, row) => {
        if (m.kind !== 'media') return; // a podcast/engine id is not a /api/videos item
        if (confirmOpen || busyRows.has(row) || !row.isConnected || !openCtl) return;
        const signal = openCtl.signal;
        confirmOpen = true;
        U.confirm(Object.assign(notifDeleteConfirmCopy(m), { signal, doc: document }))
          .then((ok) => {
            confirmOpen = false;
            if (ok !== true) return;
            if (signal.aborted || !row.isConnected || busyRows.has(row)) return;
            busyRows.add(row);
            fetch('/api/videos/' + encodeURIComponent(m.mediaId), { method: 'DELETE' })
              .then((res) => (res.ok ? res.json().catch(() => ({})) : Promise.reject(new Error(`delete failed: ${res.status}`))))
              .then((data) => {
                // The video is gone -> best-effort dismiss its notification server-side so
                // it does not reappear pointing at a trashed video (a failed dismiss
                // self-heals on the next manual one - the video is safely in Trash either
                // way), then drop the row + reconcile the badge.
                fetch('/api/notifications/dismiss', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: m.id }),
                }).catch(() => { /* cosmetic - the row is already gone client-side */ });
                if (typeof deleteResultToast === 'function') showToastSafe(deleteResultToast(data));
                return removeNotifRowReconcile(row);
              })
              .catch(() => {
                busyRows.delete(row); // non-optimistic: a failure keeps the row for a retry
                showToastSafe('Could not delete the video.');
              });
          });
      };

      const openChannel = (m) => {
        if (!m.channelHref) return;
        closePanel();
        const nav = window.FileTube && typeof window.FileTube.navigate === 'function' ? window.FileTube.navigate : null;
        if (nav) nav(m.channelHref);
        else window.location.href = m.channelHref;
      };

      // The row menu (kebab / long-press / right-click): one ui.menu, anchored at the kebab.
      const openRowMenu = (m, row, anchor) => {
        if (!openCtl || !row.isConnected) return;
        U.menu({
          title: m.title || 'Notification', anchor, signal: openCtl.signal, doc: document,
          items: buildNotificationMenuItems(m),
          onSelect: (v) => {
            if (v === 'channel') openChannel(m);
            else if (v === 'dismiss') dismissRow(m, row);
            else if (v === 'delete') requestDelete(m, row);
          },
        });
      };

      // One row: returns the node to place in the list (the swipe wrapper, or the row).
      const buildRow = (m) => {
        // Media column (D4.4): the channel's photo, a podcast's ARTWORK (a rounded ui-art),
        // else the monogram - never the logo, never a broken image.
        const avatar = U.avatar({ name: m.channelLabel, url: m.channelAvatarUrl || null, kind: m.kind === 'podcast' ? 'podcast' : 'channel', size: 'md', doc: document });
        // Aside column: the thumbnail, reserved on every row. A logo thumb (the yt-dlp mark,
        // the FileTube floor) is contained, never cropped, and hangs no duration badge.
        const thumb = U.thumb({ src: m.thumbnailUrl, context: 'row', duration: (!m.thumbnailIsIcon && m.durationSec > 0) ? m.durationSec : 0, doc: document });
        const img = thumb.querySelector('.ui-thumb__img');
        if (img && m.thumbnailIsIcon) img.classList.add('notif-thumb-icon');
        // v1.288 net (Dean's "nothing iconless" rule): a 404 thumbnail becomes the FileTube
        // logo, contained, and drops its duration badge. ui.thumb has already removed the
        // broken image; the logo is a fresh image with no handler, so it can never loop.
        if (img && !m.thumbnailIsIcon) {
          img.addEventListener('error', () => {
            const b = thumb.querySelector('.ui-thumb__duration');
            if (b) b.remove();
            if (thumb.querySelector('.notif-thumb-icon')) return;
            const logo = document.createElement('img');
            logo.className = 'ui-thumb__img notif-thumb-icon';
            logo.alt = '';
            logo.src = NOTIF_FALLBACK_ICON;
            thumb.appendChild(logo);
          });
        }
        const kebab = U.button({ variant: 'plain', shape: 'icon', icon: 'more_vert', ariaLabel: 'More actions', doc: document });
        kebab.classList.add('notif-more');
        const time = document.createElement('span');
        time.className = 'notif-row-time';
        time.textContent = m.timeLabel;
        const row = U.row({
          size: 'media', lead: m.unread ? 'dot' : null, media: avatar, overline: m.channelLabel,
          title: m.title || 'Notification', meta: time, aside: thumb, actions: [kebab], href: m.href, doc: document,
          onClick: () => {
            // v1.52: partial seed -- the row model has title/channel/avatar/
            // thumbnail in hand; the watch painter fills these in frame one
            // and skeletons the rest until hydration.
            // v1.73 (adversarial W5, the FOURTH strike of the seed class):
            // media-positive - a podcast row navigates to /podcasts and
            // must never prime a watch page it will not visit.
            // v1.251 (QA gate S3): "media" no longer implies watch-bound - an AUDIO
            // media row navigates to /music now. The stash stays SAFE anyway:
            // consumeWatchSeed is id-guarded, single-shot and TTL'd, so an audio
            // row's seed either dies unmatched or legitimately paints the ao=1
            // miss-bounce's watch page. Annotated, not tightened (a fifth-strike
            // href-is-watch guard is an option if this class ever bites again).
            if ((m.kind || 'media') === 'media') {
              stashWatchSeed({
                id: m.mediaId,
                title: m.title,
                channelName: m.channelLabel === 'Library' ? '' : m.channelLabel,
                channelAvatarUrl: m.channelAvatarUrl,
                hasThumbnail: Boolean(m.thumbnailUrl),
              });
            }
            // Fire-and-forget mark-read; keepalive survives a full-load nav
            // (stats et al). The SPA router handles the actual navigation.
            fetch('/api/notifications/read', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: m.id }),
              keepalive: true,
            }).catch(() => { /* cosmetic -- the dot returns next open */ });
            const dot = row.querySelector('.ui-row__dot');
            if (dot) dot.remove();
            closePanel();
          },
        });
        row.setAttribute('data-notif-id', String(m.id));
        row.setAttribute('data-kind', m.kind);
        kebab.addEventListener('click', () => openRowMenu(m, row, kebab));
        const h = { row, swipe: null, offMenu: null };
        rowHandles.push(h);
        const FI = typeof window !== 'undefined' ? window.FTInteraction : null;
        if (!FI) return row;
        h.offMenu = FI.onActionMenu(row, () => openRowMenu(m, row, kebab));
        // Swipe left: Dismiss (neutral) and, on a media row, Delete (danger). A full swipe
        // past 60% DISMISSES - swipeRow refuses a danger full-swipe at setup - and the
        // Delete button only ever opens the confirm (requestDelete).
        const actions = [{ id: 'dismiss', label: 'Dismiss', kind: 'neutral', onSelect: () => dismissRow(m, row) }];
        if (m.kind === 'media') actions.push({ id: 'delete', label: 'Delete', kind: 'danger', onSelect: () => requestDelete(m, row) });
        h.swipe = FI.swipeRow(row, { fullSwipe: 'dismiss', actions });
        return row.parentNode; // the parentless row now sits in its .ui-swipe wrapper
      };

      const renderRows = (rows) => {
        const models = rows.map(buildNotificationRowModel).filter(Boolean);
        if (models.length === 0) { renderEmpty(); return; }
        showState(null);
        tools.hidden = false;
        for (const m of models) list.appendChild(buildRow(m));
      };

      let loadSeq = 0;
      function loadRows() {
        const seq = ++loadSeq;
        renderSkeleton();
        fetch('/api/notifications')
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error('unavailable'))))
          .then((body) => {
            if (seq !== loadSeq || !panelOpen()) return;
            renderRows(Array.isArray(body.items) ? body.items : []);
            // Opening the panel = seen (two-tier decision 3): number badge
            // zeroes now; the per-row dots just rendered stay until tapped.
            setBadge(0);
            return fetch('/api/notifications/seen', { method: 'POST' });
          })
          .catch(() => { if (seq === loadSeq && panelOpen()) renderError(); });
      }

      const openPanel = () => {
        if (panelOpen()) return;
        openCtl = new AbortController();
        confirmOpen = false;
        bellBtn.setAttribute('aria-expanded', 'true');
        sheet.open();
        loadRows();
      };
      function closePanel() {
        if (!panelOpen()) return;
        sheet.close(); // onClosing aborts openCtl: its menus and confirms close with it
      }

      bellBtn.addEventListener('click', () => {
        if (panelOpen()) closePanel();
        else openPanel();
      });
      // Clear all hides every row for THIS user (a bulk dismiss, server-side): it asks
      // first (D4.8), then POSTs the same /api/notifications/clear as before, and empties
      // the list only on a confirmed 2xx.
      let clearing = false;
      clearBtn.addEventListener('click', () => {
        if (clearing || confirmOpen || !openCtl) return;
        const signal = openCtl.signal;
        clearing = true;
        confirmOpen = true;
        U.confirm({ title: 'Clear all notifications?', body: 'Every notification leaves this list. Your videos and episodes stay in your library.', confirmLabel: 'Clear all', danger: true, signal, doc: document })
          .then((ok) => {
            confirmOpen = false;
            if (ok !== true || signal.aborted) { clearing = false; return null; }
            return fetch('/api/notifications/clear', { method: 'POST' })
              .then((res) => {
                if (!res.ok) throw new Error(`clear failed: ${res.status}`);
                renderEmpty();
                setBadge(0);
              })
              .catch(() => showToastSafe('Could not clear the notifications.'))
              .then(() => { clearing = false; });
          });
      });
      // A back/forward navigation leaves the page the panel was opened over: close it
      // (and, through its signal, any menu or confirm it holds).
      window.addEventListener('popstate', closePanel);

      // ---- badge poll: 60s cadence, hidden-tab skip, resume on return -----
      // (the download-chip poller's shape, simplified: the badge has no
      // active-download fast path worth a variable cadence).
      const NOTIF_BADGE_POLL_MS = 60 * 1000;
      let pollTimer = null;
      let stopped = false;
      const pollOnce = () => {
        if (stopped) return;
        if (document.hidden) { schedule(); return; }
        fetch('/api/notifications/badge')
          .then((res) => {
            if (res.status === 404) {
              // Feature disabled mid-session (toggle off / last sub removed):
              // stand the bell down entirely; a reload re-probes.
              stopped = true;
              closePanel();
              bellBtn.hidden = true;
              return null;
            }
            return res.ok ? res.json() : null;
          })
          .then((body) => {
            if (body && Number.isInteger(body.count) && !panelOpen()) setBadge(body.count);
            schedule();
          })
          .catch(() => schedule());
      };
      const schedule = () => {
        if (stopped) return;
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = setTimeout(pollOnce, NOTIF_BADGE_POLL_MS);
      };
      schedule();
      // v1.68 test hook: the badge poll's pending setTimeout is a NODE
      // timer under the jsdom harness - it survives dom.window.close(),
      // fires after a test deletes the globals, and holds the runner's
      // event loop. Tests stand the poll down explicitly (the server.js
      // __-prefix convention); browsers never call this.
      __notifBellPollStopForTests = () => {
        stopped = true;
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      };
      const resume = () => {
        if (stopped || document.hidden) return;
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = setTimeout(pollOnce, 1000);
      };
      document.addEventListener('visibilitychange', resume);
      window.addEventListener('pageshow', resume);
      // v1.66: a push arriving while this window is visible shows no OS
      // banner (ruling P4) - the service worker postMessages instead, and
      // the badge refreshes on the resume fast path rather than the next
      // 60s tick.
      if ('serviceWorker' in navigator) {
        try {
          navigator.serviceWorker.addEventListener('message', (e) => {
            if (e && e.data && e.data.type === 'ft-push') resume();
          });
        } catch (_) { /* older engines: the 60s poll still covers it */ }
      }
    })
    .catch(() => { removeBellPlaceholder(); /* network failure -- fail closed, inject nothing (but clear the reserve) */ });
}

// ---- v1.63: the playback queue (header icon + panel) ------------------------
//
// YouTube-style queue ("think YouTube" - Dean): a header icon that EXISTS
// only while the user's queue does (ruling 4), left of the notification
// bell, opening a ui.sheet like the bell's (sweep S4): now-playing highlighted,
// per-row remove, up/down reorder (icon buttons on every input device; drag
// is tech-debt #111), Clear behind a ui.confirm (sweep S4, D4.8; it was a
// two-tap arm in the button). Server-persisted per user (ruling 6) via
// /api/queue; ALL semantics live server-side in lib/queue/store.js's
// reducers - this chrome renders state and fires verbs, deciding nothing.
//
// Panel exclusivity with the bell comes free: an open ui.sheet's scrim
// covers the other button, so a tap there closes this panel first.
// dock() pair check (the v1.50.3 lesson): NOT applicable - that pair is
// the PLAYER BAR's popups (reparented with the player); this panel is
// body-mounted like the bell's and survives docking untouched.
//
// Pure decisions extracted for node:test (no DOM), the injector-file
// division of labor.

function shouldShowQueueButton(queue) {
  return Boolean(queue && Array.isArray(queue.entries) && queue.entries.length > 0);
}

// Badge = TOTAL entries ("a queue of 8"), '' when empty (no bubble, and the
// button itself hides), 20+ cap like the bell's.
function formatQueueBadge(count) {
  if (!Number.isInteger(count) || count <= 0) return '';
  return count > 20 ? '20+' : String(count);
}

// Server entry ({uid, mediaId, item}) -> row model. Same fallback ladder as
// the bell rows; `playing` drives the now-playing highlight; `played` dims
// entries STRICTLY BEFORE the pointer - the pointer row itself is playing,
// never played (ruling 6: played items stay, jump-back allowed).
// v1.71: ONE place derives a queue entry's destination from its kind. Its
// consumers (the row model here, player.js's autoplay advance +
// manualTrackStep, watch.js's up-next box AND its manual Prev/Next
// goQueueEntry - v1.73) must never hand-build this per site - the
// hardcoded /watch.html lesson. A podcast entry deep-links the podcasts place, which
// resumes the episode in the dock.
function queueEntryHref(entry) {
  if (!entry || typeof entry.mediaId !== 'string' || entry.mediaId === '') return null;
  // v1.72: 'track' joins (music in the one queue) - the music place's
  // ?play= deep link resumes the specific track, the podcasts pattern.
  if (entry.kind === 'podcast') return `/podcasts?play=${encodeURIComponent(entry.mediaId)}`;
  if (entry.kind === 'track') return `/music?play=${encodeURIComponent(entry.mediaId)}`;
  // v1.251 (Dean's consistency rule): an AUDIO media entry opens Music like every other tap
  // surface - the shaped queue's media entries carry the raw item, so the ONE rule decides.
  const audioHref = entry.item ? audioOpenHref({ id: entry.mediaId, kind: entry.kind, type: entry.item.type, chapters: entry.item.chapters, chapterCount: entry.item.chapterCount }) : null;
  if (audioHref) return audioHref;
  return `/watch.html?v=${encodeURIComponent(entry.mediaId)}`;
}

// v1.251 (Dean): THE audio-destination rule, ONE authority for every tap surface (grid/rows/
// feed via main.js's delegate, the bell rows, the queue chrome, history, the watch page's
// related rail). Moved VERBATIM from main.js's v1.246 musicHrefForItem: an AUDIO media item
// (type 'audio', kind absent-or-'media') opens Music - chaptered (>= 2, via the `chapters`
// array OR the folded `chapterCount`) at its album's first `::c0` track - else null and the
// caller keeps its own destination (video -> /watch; podcast/track/book/tv their own places).
// `&ao=1` marks the reroute origin so music.js's miss path can bounce a non-projected id back
// to /watch. Exported for node:test; a browser global for every classic-script surface.
function audioOpenHref(item) {
  if (!item || item.type !== 'audio') return null;
  if (item.kind && item.kind !== 'media') return null;
  const id = item.id != null ? String(item.id) : '';
  if (!id) return null;
  const chaptered = (Array.isArray(item.chapters) && item.chapters.length >= 2) || (Number(item.chapterCount) >= 2);
  const playId = chaptered ? (id + '::c0') : id;
  return '/music?play=' + encodeURIComponent(playId) + '&ao=1';
}

function buildQueueRowModel(entry, pointerUid) {
  if (!entry || typeof entry.uid !== 'string' || entry.uid === '' || !entry.item) return null;
  const item = entry.item;
  const channelName = displayChannelName(typeof item.channelName === 'string' ? item.channelName.trim() : ''); // v1.114 A2: "@handle" -> name
  const folderName = typeof item.folderName === 'string' ? item.folderName.trim() : '';
  return {
    uid: entry.uid,
    mediaId: entry.mediaId,
    kind: (entry.kind === 'podcast' || entry.kind === 'track') ? entry.kind : 'media',
    href: queueEntryHref(entry),
    title: typeof item.title === 'string' ? item.title : (typeof item.name === 'string' ? item.name : ''),
    channelLabel: channelName || folderName || 'Library',
    channelAvatarUrl: typeof item.channelAvatarUrl === 'string' ? item.channelAvatarUrl : '',
    // A podcast/track entry's art is the server-named artUrl (show cover /
    // album art); media entries keep the thumbnail contract.
    thumbnailUrl: (entry.kind === 'podcast' || entry.kind === 'track')
      ? (typeof item.artUrl === 'string' ? item.artUrl : null)
      : (item.hasThumbnail === true ? `/thumbnail/${entry.mediaId}` : null),
    playing: Boolean(pointerUid) && entry.uid === pointerUid,
    played: false, // position-relative; buildQueueRowModels owns it
  };
}

// Annotate rows with played/playing in ONE ordered pass: rows strictly
// BEFORE the pointer are `played` (dimmed, jump-back allowed - ruling 6);
// the pointer row is `playing`; rows after are neither. No pointer = a
// not-started queue: nothing played, nothing playing.
function buildQueueRowModels(queue) {
  const entries = (queue && Array.isArray(queue.entries)) ? queue.entries : [];
  const pointerUid = (queue && typeof queue.pointerUid === 'string') ? queue.pointerUid : null;
  const models = [];
  // Gate S4: a DANGLING pointer (entry vanished) means not-started - dim
  // nothing (mirrors normalize; unreachable via shapedQueue, closed anyway).
  const pointerPresent = Boolean(pointerUid) && entries.some((e) => e && e.uid === pointerUid);
  let beforePointer = pointerPresent;
  for (const e of entries) {
    const m = buildQueueRowModel(e, pointerUid);
    if (m) {
      if (m.playing) beforePointer = false;
      m.played = beforePointer && !m.playing;
      models.push(m);
    } else if (e && e.uid === pointerUid) {
      beforePointer = false; // a dropped (item-less) pointer row still ends the played span
    }
  }
  return models;
}

// Ordinal for the add-toast ("Queued - 4th"). Pure, exported.
function formatQueuePosition(n) {
  if (!Number.isInteger(n) || n <= 0) return '';
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  return `${n}${mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th'}`;
}

// THE one add-to-queue verb every affordance calls (cards, watch page,
// music rows - the every-writer discipline: one helper, no copies).
// position: 'end' (default) | 'next'. Toasts the outcome and refreshes the
// header chrome; resolves with the server's shaped queue (or null on error
// - callers needing more than the toast can inspect it).
function addToQueue(mediaId, position, kind) {
  return fetch('/api/queue/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaId, position: position === 'next' ? 'next' : 'end', kind: (kind === 'podcast' || kind === 'track') ? kind : 'media' }),
  })
    .then((res) => (res.ok ? res.json() : res.json().catch(() => ({})).then((b) => Promise.reject(new Error(b.error || 'Could not add to queue')))))
    .then((body) => {
      const entries = body && body.queue && Array.isArray(body.queue.entries) ? body.queue.entries : [];
      // Ruling 3's Undo: one tap deletes the just-added entry (uid-exact -
      // safe against duplicates and later edits) and refreshes the chrome.
      const undo = body && body.added ? {
        label: 'Undo',
        onAction: () => {
          fetch(`/api/queue/items/${body.added.uid}`, { method: 'DELETE' })
            .then(() => refreshQueueChrome())
            .catch(() => { /* already gone / offline - the next read syncs */ });
        },
      } : undefined;
      if (position === 'next') {
        showToast('Playing next', undo);
      } else {
        const idx = body && body.added ? entries.findIndex((e) => e.uid === body.added.uid) : -1;
        showToast(idx >= 0 ? `Queued - ${formatQueuePosition(idx + 1)}` : 'Added to queue', undo);
      }
      refreshQueueChrome();
      return body ? body.queue : null;
    })
    .catch((err) => { showToast(err.message || 'Could not add to queue'); return null; });
}

function queueButtonAlreadyInjected() {
  return Boolean(document.getElementById('queue-btn'));
}

// Module-scope refresh hook: card/watch add-to-queue actions call this after
// a successful POST so the icon appears/updates without a reload. Bound to a
// real implementation inside the injector.
let refreshQueueChrome = () => {};

function injectQueueChrome() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (queueButtonAlreadyInjected()) return;
  const headerRight = document.querySelector('.header-right');
  if (!headerRight) return; // shell without a header (login/welcome)

  // v1.339 (L2): the pre-paint reserve (a `[data-ft-reserve="queue"]` placeholder the
  // shell's inline block painted from ft-queue-shown) is dropped on every no-button exit.
  const dropReserve = () => { const r = chromeReserveEl(headerRight, 'queue'); if (r) r.remove(); };
  fetch('/api/queue')
    .then((res) => (res.ok ? res.json() : null))
    .then((queue) => {
      if (!queue) { dropReserve(); return; } // pre-auth / error: fail closed, inject nothing
      if (queueButtonAlreadyInjected()) { dropReserve(); return; } // async double-inject window
      // Sweep S4: the panel is a ui.sheet; ui.js loads before common.js on every shell (step 4).
      const U = typeof window !== 'undefined' ? window.ui : null;
      if (!U || typeof U.sheet !== 'function') { dropReserve(); return; }

      // ---- button + badge (createElement/textContent only) ---------------
      // Sweep S1 (F31): a plain ui-btn icon button (44px hit area), the queue glyph (list
      // lines + a play triangle, YouTube's queue vocabulary) from the icon sprite.
      const btn = chromeButtonEl({ cls: 'queue-btn', icon: CHROME_ICON.queue, ariaLabel: 'Playback queue' });
      btn.id = 'queue-btn';
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');
      const badge = document.createElement('span');
      badge.id = 'queue-btn-badge';
      badge.className = 'ui-chip ui-chip--count queue-btn-badge';
      badge.hidden = true;
      btn.appendChild(badge);
      // Beside the bell (ruling 4), LEFT of it. v1.339 (L2, tracker #140): the queue now
      // takes its pre-paint reserve's place when one is painted (same box, zero shift);
      // else it anchors on the bell OR the bell's placeholder (the reserve the bell
      // injector swaps in place), else firstChild - and the bell injector anchors AFTER
      // the queue - so the pair's order no longer depends on which fetch lands first.
      const queueReserve = chromeReserveEl(headerRight, 'queue');
      if (queueReserve) queueReserve.replaceWith(btn);
      else headerRight.insertBefore(btn, document.getElementById('notif-bell-btn') || document.getElementById('notif-bell-placeholder') || headerRight.firstChild);

      // ---- the panel: ONE ui.sheet (sweep S4, D4.6) ------------------------------
      // A popover under the queue button on desktop, a bottom sheet on the phone. F48 is
      // fixed by construction: the old panel's open class was added only by openOverlay,
      // which skips it under Reduce Motion, so the panel opened at opacity 0; ui.sheet
      // ALWAYS applies its open class (Reduce Motion makes that an opacity-only change).
      // Rows are ui-rows with reserved columns on every row: the art (media) and three
      // action slots - Move up, Move down, Remove from queue (a queue edit, never a file
      // delete). The ▴▾ and × text glyphs are gone (AC4).
      const content = document.createElement('div');
      content.className = 'queue-sheet';
      const tools = document.createElement('div');
      tools.className = 'queue-sheet__tools';
      const clearBtn = U.button({ variant: 'plain', size: 'sm', label: 'Clear queue', doc: document });
      clearBtn.id = 'queue-clear-btn';
      tools.appendChild(clearBtn);
      const list = U.list({ size: 'media', media: 'art', actions: 3, divider: 'inset', label: 'Queue', doc: document });
      list.id = 'queue-panel-list';
      const stateHost = document.createElement('div');
      stateHost.className = 'queue-sheet__state';
      content.appendChild(tools);
      content.appendChild(list);
      content.appendChild(stateHost);

      // Per-open lifetime for the Clear confirm (closing the panel closes it).
      let openCtl = null;
      const sheet = U.sheet({
        variant: 'auto', anchor: btn, title: 'Queue', content, doc: document,
        onClosing: () => {
          btn.setAttribute('aria-expanded', 'false');
          if (openCtl) { openCtl.abort(); openCtl = null; }
        },
      });
      sheet.el.id = 'queue-panel'; // an id: ui.sheet rewrites className on every open
      const heading = sheet.el.querySelector('.ui-sheet__title');
      heading.id = 'queue-panel-heading';
      const panelOpen = () => sheet.isOpen();

      const setChrome = (q) => {
        const count = Array.isArray(q.entries) ? q.entries.length : 0;
        const label = formatQueueBadge(count);
        badge.textContent = label;
        badge.hidden = label === '';
        btn.hidden = !shouldShowQueueButton(q);
        rememberQueueShown(!btn.hidden); // v1.339 (L2): the next launch's pre-paint reserve
        heading.textContent = count > 0 ? `Queue - ${count} item${count === 1 ? '' : 's'}` : 'Queue';
        // v1.68.3 (Dean): an OPEN panel stays open on empty - renderRows'
        // empty state gets to show (the bell's posture: dismissing the last
        // row shows the empty message, never slams the panel shut). The old
        // auto-close here raced ahead of renderRows on every open-with-
        // stale-button tap: open -> "Loading..." -> fetch resolves empty ->
        // panel closed = "it tries to load for a second and stops". The
        // button itself still hides (ruling 4); the open panel closes via
        // the scrim or Esc as always.
      };
      setChrome(queue);

      const verb = (url, opts) => fetch(url, opts)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('queue-verb-failed'))))
        .then((body) => {
          if (body && body.queue) { setChrome(body.queue); if (panelOpen()) renderRows(body.queue); }
          return body;
        });

      // One state at a time: the rows, a skeleton, or a ui.state (empty / error).
      const showState = (node) => {
        list.textContent = '';
        stateHost.textContent = '';
        list.hidden = !!node;
        tools.hidden = true;
        if (node) stateHost.appendChild(node);
      };
      const renderEmpty = () => showState(U.state({ icon: 'queue_music', title: 'No queued items yet', body: 'Items you queue up to play show here.', doc: document }));
      const renderError = () => showState(U.state({ icon: 'error', title: 'Could not load the queue', action: { label: 'Try again', onClick: () => loadQueue() }, doc: document }));
      // D9: the loading skeleton is the REAL row grid (same list, same slots).
      const renderSkeleton = () => {
        showState(null);
        for (let i = 0; i < 3; i++) {
          const art = document.createElement('span');
          art.className = 'ui-art ui-avatar--lg skeleton-shimmer';
          const title = document.createElement('span');
          title.className = 'skeleton-text skeleton-text-long skeleton-shimmer';
          title.textContent = ' ';
          const meta = document.createElement('span');
          meta.className = 'skeleton-text skeleton-text-mid skeleton-shimmer';
          meta.textContent = ' ';
          const row = U.row({ size: 'media', media: art, title, meta, actions: [null, null, null], doc: document });
          row.setAttribute('aria-hidden', 'true');
          list.appendChild(row);
        }
      };

      const renderRows = (q) => {
        const models = buildQueueRowModels(q);
        if (models.length === 0) { renderEmpty(); return; }
        showState(null);
        tools.hidden = false;
        const uids = models.map((m) => m.uid);
        models.forEach((m, idx) => {
          // Reorder: up/down buttons (every input device; tech-debt #111 tracks drag).
          const mkMove = (dir, icon, label) => {
            const target = idx + dir;
            const b = U.button({ variant: 'plain', shape: 'icon', icon, ariaLabel: label, disabled: target < 0 || target >= uids.length, doc: document });
            b.classList.add('queue-move');
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              const order = uids.slice();
              const tmp = order[idx]; order[idx] = order[target]; order[target] = tmp;
              verb('/api/queue/reorder', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderedUids: order }),
              }).catch(() => refreshQueueChrome()); // 409 stale -> resync
            });
            return b;
          };
          const remove = U.button({ variant: 'plain', shape: 'icon', icon: 'close', ariaLabel: 'Remove from queue', doc: document });
          remove.classList.add('queue-remove');
          remove.addEventListener('click', (e) => {
            e.stopPropagation();
            verb(`/api/queue/items/${m.uid}`, { method: 'DELETE' }).catch(() => refreshQueueChrome());
          });
          // D4.4: the entry's art as a rounded ui-art square (the album / show / video frame), the
          // monogram if it has none or it fails - never a broken image.
          const art = U.avatar({ name: m.title || m.channelLabel, url: m.thumbnailUrl || null, kind: m.kind === 'podcast' ? 'podcast' : 'album', size: 'lg', doc: document });
          const row = U.row({
            size: 'media', media: art, title: m.title || 'Untitled',
            meta: m.playing ? `Now playing - ${m.channelLabel}` : m.channelLabel,
            actions: [mkMove(-1, 'arrow_upward', 'Move up'), mkMove(1, 'arrow_downward', 'Move down'), remove],
            href: m.href, doc: document,
            onClick: () => {
              // Tapping a row makes it now-playing (server pointer) and rides
              // the normal watch nav with a paint seed (the bell-row posture).
              // v1.71 (gate S2): media rows only - a podcast row navigates to
              // /podcasts and must never prime a watch page it will not visit.
              // v1.72: 'track' joined the kinds, so the guard names media
              // POSITIVELY (the advance seam's exact fix, same class).
              // v1.251 (QA gate S3): "media" no longer implies watch-bound - an AUDIO
              // media row navigates to /music now. The stash stays SAFE anyway:
              // consumeWatchSeed is id-guarded, single-shot and TTL'd, so an audio
              // row's seed either dies unmatched or legitimately paints the ao=1
              // miss-bounce's watch page. Annotated, not tightened (a fifth-strike
              // href-is-watch guard is an option if this class ever bites again).
              if ((m.kind || 'media') === 'media') {
                stashWatchSeed({
                  id: m.mediaId, title: m.title,
                  channelName: m.channelLabel === 'Library' ? '' : m.channelLabel,
                  channelAvatarUrl: m.channelAvatarUrl,
                  hasThumbnail: Boolean(m.thumbnailUrl),
                });
              }
              fetch('/api/queue/pointer', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: m.uid }), keepalive: true,
              }).catch(() => { /* pointer re-syncs on next open */ });
              closePanel();
            },
          });
          row.setAttribute('data-uid', m.uid);
          // Now playing = a neutral selected fill (D8.8: never red); played rows dim their text.
          if (m.playing) row.classList.add('queue-item--playing');
          if (m.played) row.classList.add('queue-item--played');
          list.appendChild(row);
        });
      };

      let loadSeq = 0;
      function loadQueue() {
        const seq = ++loadSeq;
        renderSkeleton();
        fetch('/api/queue')
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error('unavailable'))))
          .then((q) => { if (seq !== loadSeq) return; setChrome(q); if (panelOpen()) renderRows(q); })
          .catch(() => { if (seq === loadSeq && panelOpen()) renderError(); });
      }

      const openPanel = () => {
        if (panelOpen()) return;
        openCtl = new AbortController();
        btn.setAttribute('aria-expanded', 'true');
        sheet.open();
        loadQueue();
      };
      function closePanel() {
        if (!panelOpen()) return;
        sheet.close();
      }

      btn.addEventListener('click', () => {
        if (panelOpen()) closePanel();
        else openPanel();
      });

      // Clear: the in-button two-tap arm ("Really clear?") becomes a ui.confirm (D4.8: a
      // confirmation never grows in place). The SAME DELETE /api/queue runs only on OK; it
      // empties the queue, never a file.
      let clearing = false;
      clearBtn.addEventListener('click', () => {
        if (clearing || !openCtl) return;
        const signal = openCtl.signal;
        clearing = true;
        U.confirm({ title: 'Clear the queue?', body: 'Every item leaves the queue. Nothing is removed from your library.', confirmLabel: 'Clear queue', danger: true, signal, doc: document })
          .then((ok) => {
            if (ok !== true || signal.aborted) { clearing = false; return null; }
            return verb('/api/queue', { method: 'DELETE' })
              .then(() => { showToast('Queue cleared'); closePanel(); })
              .catch(() => showToast('Could not clear the queue'))
              .then(() => { clearing = false; });
          });
      });
      // A back/forward navigation leaves the page the panel was opened over: close it.
      window.addEventListener('popstate', closePanel);

      // The refresh hook: add-to-queue actions + tab-return resync (no
      // standing poller - queue edits are user-initiated; cross-device drift
      // heals on the next action or tab return, disclosed in the plan).
      refreshQueueChrome = () => {
        fetch('/api/queue')
          .then((res) => (res.ok ? res.json() : null))
          .then((q) => { if (q) { setChrome(q); if (panelOpen()) renderRows(q); } })
          .catch(() => { /* next action re-syncs */ });
      };
      const resync = () => { if (!document.hidden) refreshQueueChrome(); };
      document.addEventListener('visibilitychange', resync);
      window.addEventListener('pageshow', resync);
    })
    .catch(() => { dropReserve(); /* network failure - fail closed, inject nothing */ });
}

// ---- v1.37.0 books nav-link injection (the D4 posture, books-gated) --------
//
// The Books link exists only when the operator has configured >=1 book
// folder -- a books-less install renders byte-identical chrome (the
// disabled-module guarantee). Unlike the subscriptions probe (a
// route-existence 404 check), /api/books/config always exists; the gate is
// its CONTENT (folders.length). Pure decision extracted for node:test.
function shouldInjectBooksNav(payload) {
  return Boolean(payload && Array.isArray(payload.folders) && payload.folders.length > 0);
}

// v1.44 music gate (mirrors shouldInjectBooksNav exactly -- gate on CONTENT,
// folders.length, since /api/music/config always exists).
function shouldInjectMusicNav(payload) {
  return Boolean(payload && Array.isArray(payload.folders) && payload.folders.length > 0);
}

// v1.69 podcasts gate (the same CONTENT posture: /api/podcasts/health always
// exists; the gate is shows > 0 - zero subscriptions renders byte-identical
// chrome, the disabled-module guarantee).
function shouldInjectPodcastsNav(payload) {
  return Boolean(payload && Number(payload.shows) > 0);
}

// v1.44 IA rework: Books + Music are LIBRARY-section entries, NOT bottom-nav
// items (Dean: the bottom-nav loses Books; Books+Music live in the Library
// section alongside the folder-playlists, and in the mobile Playlists sheet).
// This shared helper injects ONE sidebar entry into the Library section, just
// above #sidebar-folders-list. Deterministic order regardless of which config
// probe resolves first: Music anchors before an existing Books entry, so the
// visual order is always Music, Books, then folders.
function injectLibraryNavEntry(key, href, label, iconClass) {
  if (document.querySelector('[data-nav-sidebar="' + key + '"]')) return; // idempotent
  const foldersList = document.getElementById('sidebar-folders-list');
  if (!foldersList) return;
  const link = document.createElement('a');
  link.href = href;
  link.className = 'sidebar-item sidebar-library-entry';
  link.setAttribute('data-nav-sidebar', key);
  const icon = document.createElement('i');
  // v1.77: the user's chosen glyph for this Library entry, falling back to the
  // caller's shipped default. Resolved HERE rather than only by the boot
  // repainter because these injectors are async capability probes - an entry
  // that lands after the settings fetch would otherwise keep the default
  // glyph until the next navigation.
  icon.className = libraryGlyphClassFor(key, iconClass);
  link.appendChild(icon);
  link.appendChild(document.createTextNode(' ' + label));
  // Deterministic visual order Music, Books, Podcasts, History regardless of
  // which async probe resolves first (QA gate S2, v1.64): each key anchors
  // before every entry that must sit BELOW it, falling back to the folders
  // list. v1.69: Podcasts slots between Books and History.
  // v1.73 (Dean ruling 5): Downloads sits FIRST - it anchors before every
  // other Library entry; the existing keys keep their relative ladder.
  const anchor = (key === 'downloads')
    ? (document.querySelector('[data-nav-sidebar="music"]') || document.querySelector('[data-nav-sidebar="books"]') || document.querySelector('[data-nav-sidebar="tv"]') || document.querySelector('[data-nav-sidebar="podcasts"]') || document.querySelector('[data-nav-sidebar="history"]') || foldersList)
    : (key === 'music')
      ? (document.querySelector('[data-nav-sidebar="books"]') || document.querySelector('[data-nav-sidebar="tv"]') || document.querySelector('[data-nav-sidebar="podcasts"]') || document.querySelector('[data-nav-sidebar="history"]') || foldersList)
      : (key === 'books')
        ? (document.querySelector('[data-nav-sidebar="tv"]') || document.querySelector('[data-nav-sidebar="podcasts"]') || document.querySelector('[data-nav-sidebar="history"]') || foldersList)
        : (key === 'tv')
          ? (document.querySelector('[data-nav-sidebar="podcasts"]') || document.querySelector('[data-nav-sidebar="history"]') || foldersList)
          : (key === 'podcasts')
            ? (document.querySelector('[data-nav-sidebar="history"]') || foldersList)
            : foldersList;
  anchor.insertAdjacentElement('beforebegin', link);
  if (activeNavItem(window.location.pathname, window.location.search) === key) {
    link.classList.add('active');
  }
}

// Idempotent + defensive, mirroring injectSubscriptionsNavLinkIfEnabled. Books
// now injects ONLY a Library-section sidebar entry (no bottom-nav item -- the
// v1.44 IA change); the Playlists sheet gets its Books/Music entries from
// renderPlaylistsSheet.
function injectBooksNavLinkIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (document.querySelector('[data-nav-sidebar="books"]')) return;
  fetch('/api/books/config')
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      if (!shouldInjectBooksNav(payload)) return; // books-less -- inject nothing
      // v1.47.4 item 4: `injectLibraryNavEntry` re-checks its own marker before
      // writing, which closes this injector's async double-inject window at the
      // DOM-write site (see that function).
      injectLibraryNavEntry('books', '/books', 'Books', 'icon-books'); // v1.73.2: Books' own glyph
    })
    .catch(() => { /* network/parse failure -- fail closed, inject nothing */ });
}

function injectMusicNavLinkIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (document.querySelector('[data-nav-sidebar="music"]')) return;
  fetch('/api/music/config')
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      if (!shouldInjectMusicNav(payload)) return; // music-less -- inject nothing
      injectLibraryNavEntry('music', '/music', 'Music', 'icon-play');
    })
    .catch(() => { /* network/parse failure -- fail closed, inject nothing */ });
}

// v1.195 TV Shows: same content-gated posture as Music (folders > 0 => inject a
// Library-section entry; a Shows-less install renders byte-identical chrome).
function shouldInjectTvNav(payload) {
  return Boolean(payload && Array.isArray(payload.folders) && payload.folders.length > 0);
}
function injectTvNavLinkIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (document.querySelector('[data-nav-sidebar="tv"]')) return;
  fetch('/api/tv/config')
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      if (!shouldInjectTvNav(payload)) return; // Shows-less -- inject nothing
      injectLibraryNavEntry('tv', '/tv', 'Shows', 'icon-tv');
    })
    .catch(() => { /* network/parse failure -- fail closed, inject nothing */ });
}

// v1.73 (Dean ruling 5): the ytdlp library is a HARD Library entry -
// "Downloads", FIRST in the section. Gated on the module actually
// contributing a synthetic root (GET /api/config's read-only
// syntheticFolders - the same source Setup's renderFolders matches), it
// deep-links the existing folder-scoped grid: zero new surface. The SAME
// probe powers the bottom-bar item: the static shell element carries a
// placeholder href until this resolves, and is REMOVED outright when the
// module contributes nothing (the module gate always wins over the user's
// bar opt-in - the v1.44 rule).
function injectDownloadsNavLinkIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  fetch('/api/config')
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      const roots = payload && Array.isArray(payload.syntheticFolders)
        ? payload.syntheticFolders.filter((p) => typeof p === 'string' && p !== '')
        : [];
      const navItem = document.querySelector('.bottom-nav-item[data-nav="downloads"]');
      if (roots.length === 0) {
        if (navItem && navItem.parentNode) {
          navItem.parentNode.removeChild(navItem);
          // v1.75 (adversarial gate round 2, W1): this is the only injector
          // that REMOVES a bar item, and until now it did so without
          // re-resolving. That was harmless while home/settings were
          // un-hideable anchors; since v1.75 every entry is hidable, so a user
          // whose bar is legally Downloads-only (the >=1 floor accepted it
          // while the item was mounted) was left with a fixed, EMPTY,
          // un-navigable bar the moment this probe said the module was gone -
          // and it reproduced on every reload, because nothing re-ran the
          // floor. Re-apply here so ruling R2's floor gets its say.
          applyBottomNavCustomization();
        }
        return; // module off / no download root -- inject nothing
      }
      const href = '/?root=' + encodeURIComponent(roots[0]);
      if (navItem) navItem.setAttribute('href', href);
      injectLibraryNavEntry('downloads', href, 'Downloads', 'icon-downloads');
    })
    .catch(() => {
      // Fail CLOSED all the way (adversarial S2): an opted-in bottom item
      // left standing would carry its placeholder href="/" - a silent
      // misdirect. Remove it like the no-root arm; the next successful
      // boot probe re-upgrades a fresh shell's copy.
      const navItem = document.querySelector('.bottom-nav-item[data-nav="downloads"]');
      if (navItem && navItem.parentNode) {
        navItem.parentNode.removeChild(navItem);
        // Same re-apply as the no-root arm above, and this one matters more:
        // a TRANSIENT /api/config failure on a Downloads-only bar would
        // otherwise empty it (adversarial gate round 2, W1).
        applyBottomNavCustomization();
      }
    });
}

// v1.69 podcasts: same probe-gated Library-section injection.
function injectPodcastsNavLinkIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (document.querySelector('[data-nav-sidebar="podcasts"]')) return;
  fetch('/api/podcasts/health')
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      if (!shouldInjectPodcastsNav(payload)) return; // podcast-less -- inject nothing
      injectLibraryNavEntry('podcasts', '/podcasts', 'Podcasts', 'icon-podcast');
    })
    .catch(() => { /* network/parse failure -- fail closed, inject nothing */ });
}

// v1.64: the History sidebar entry, count-gated like Liked (visible iff the
// user has >=1 history item) but injected as a Library-section entry (the
// books/music pattern -- a SIBLING above #sidebar-folders-list, so folder
// re-renders never wipe it; one boot call per page, no per-render re-apply).
// Boot-gated only: the first-ever watch makes the entry appear on the next
// page load, not live -- the Liked-entry trade-off, accepted at design.
function injectHistoryNavLinkIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (document.querySelector('[data-nav-sidebar="history"]')) return;
  fetch('/api/history?limit=1')
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      if (!payload || !(Number(payload.total) > 0)) return; // empty history -- inject nothing
      injectLibraryNavEntry('history', '/history', 'History', 'icon-history');
    })
    .catch(() => { /* network/parse failure -- fail closed, inject nothing */ });
}

// ---- v1.44 T12: customizable bottom-bar -------------------------------------
//
// The user reorders/hides the bottom-nav items. Config is device-local
// (localStorage 'ft-bottomnav' = {hidden:[ids], order:[ids], shown:[ids]}),
// consistent with intake #6 (localStorage is the immediate source of truth); a
// cross-device server mirror is a disclosed fast-follow (tech-debt #42). A
// hidden item is only hidden if it EXISTS (an item toggled on but whose module
// is disabled simply never appears -- the module gate always wins).
//
// v1.75 (Dean's rulings R2/R3/R4): the two hard-bound anchors RETIRE. `home`
// and `settings` used to sit OUTSIDE this roster -- pinned first/last and
// un-hideable -- and are now ordinary entries, joined by the new `liked` entry
// (the central /?liked=1 playlist). Roster order mirrors the order the shells
// mount these items in the DOM (`oneoff-download`/`subscriptions` are injected
// AFTER Settings, hence last here), so the Settings editor's row order and the
// bar's own default order are one list read one way.
const BOTTOM_NAV_OPTIONAL = ['home', 'liked', 'playlists', 'history', 'podcasts', 'music', 'books', 'downloads', 'theme', 'oneoff-download', 'subscriptions', 'settings'];
// v1.71: items that are OFF unless the user explicitly turns them on (the
// config's `shown` list). A default-hidden item ships in every shell's DOM
// but never appears until Settings enables it - Dean's ruling for podcasts,
// v1.72 gave music/books/downloads the same opt-in posture, and v1.75 gives it
// to `liked` (ruling R3): nobody's bar changes under them on upgrade.
// v1.82: `settings` + `theme` join the default-hidden set - they now live in the
// account menu (avatar, top-right, on every shell incl. mobile), so the DEFAULT
// bar no longer carries them. They STAY in BOTTOM_NAV_OPTIONAL, so a user can
// still opt them back in from the Settings customizer (Dean: "opt in in the
// sense that one can optionally add it to the bottom bar"). An existing untouched
// default bar loses them here (Dean-approved); a user who explicitly opted one in
// (`shown`) keeps it. The COMPAT_TAIL pin below still tails `settings` IF
// re-shown, so its position is unchanged when opted in.
const BOTTOM_NAV_DEFAULT_HIDDEN = ['podcasts', 'music', 'books', 'downloads', 'liked', 'settings', 'theme'];

// v1.75 COMPAT (the load-bearing subtlety of this wave). Every config written
// before this release predates `home`/`settings` being sortable, so no such
// `order` array can ever name either id. An order that does NOT name them
// keeps them exactly where they have always been -- home at the head, settings
// at the tail -- which is what makes an untouched device render the IDENTICAL
// bar after the upgrade. The instant the user reorders anything, the Settings
// editor writes the FULL roster (both ids included) and these fallbacks
// release, which is what lets Home stop being left-most bound.
const BOTTOM_NAV_COMPAT_HEAD = 'home';
const BOTTOM_NAV_COMPAT_TAIL = 'settings';

// The order+hide decision, pre-floor. `present` is already normalized.
// Visibility (v1.71): an id is hidden when the config hides it, OR when it is
// default-hidden and the config's `shown` list has not opted it in - so
// pre-v1.71 configs (no `shown` key) keep every existing item exactly as
// before and hide the newer default-hidden ones.
function resolveBottomNavLayoutCore(present, cfg) {
  const hidden = new Set(Array.isArray(cfg.hidden) ? cfg.hidden : []);
  const shown = new Set(Array.isArray(cfg.shown) ? cfg.shown : []);
  const order = Array.isArray(cfg.order) ? cfg.order : [];
  const named = new Set(order);
  const isHidden = (id) => hidden.has(id) || (BOTTOM_NAV_DEFAULT_HIDDEN.indexOf(id) >= 0 && !shown.has(id));
  const pinHead = present.indexOf(BOTTOM_NAV_COMPAT_HEAD) >= 0 && !named.has(BOTTOM_NAV_COMPAT_HEAD);
  const pinTail = present.indexOf(BOTTOM_NAV_COMPAT_TAIL) >= 0 && !named.has(BOTTOM_NAV_COMPAT_TAIL);
  const sortable = present.filter((id) => !(pinHead && id === BOTTOM_NAV_COMPAT_HEAD) && !(pinTail && id === BOTTOM_NAV_COMPAT_TAIL));
  const seen = new Set();
  const ordered = [];
  order.forEach((id) => { if (sortable.indexOf(id) >= 0 && !seen.has(id)) { ordered.push(id); seen.add(id); } });
  // v1.75 adversarial gate W1: ids the config does NOT name are ordered by
  // their ROSTER index, never by their position in `present`. `presentIds`
  // comes out of the live #bottom-nav, and that order is neither stable nor
  // clean: both async nav injectors insert with
  // insertAdjacentElement('afterend') on the Settings item, so whichever
  // capability probe resolves LAST lands FIRST (Download and Subs swapped
  // between page loads); and applyBottomNavCustomization re-appends the
  // visible items, so a second apply reads back its own output and a
  // just-opted-in item lands somewhere a reload will not reproduce. Ranking by
  // the roster makes the resolved sequence a pure function of the CONFIG -
  // identical across injector races, across repeat applies, and identical to
  // the list the Settings panel renders. An id absent from the roster keeps
  // its relative DOM position, after every known id.
  const rosterRank = (id) => {
    const i = BOTTOM_NAV_OPTIONAL.indexOf(id);
    return i >= 0 ? i : BOTTOM_NAV_OPTIONAL.length + present.indexOf(id);
  };
  sortable.slice()
    .sort((a, b) => rosterRank(a) - rosterRank(b))
    .forEach((id) => { if (!seen.has(id)) { ordered.push(id); seen.add(id); } });
  const sequence = (pinHead ? [BOTTOM_NAV_COMPAT_HEAD] : []).concat(ordered, pinTail ? [BOTTOM_NAV_COMPAT_TAIL] : []);
  return { visible: sequence.filter((id) => !isHidden(id)), hiddenPresent: sequence.filter(isHidden), sequence };
}

// Pure: given the bottom-nav item ids ACTUALLY present in the DOM and the
// user's config, return the final visible order, the present-but-hidden ids,
// and the full resolved `sequence` (visible + hidden interleaved, i.e. the row
// order the Settings editor must render so that what it lists and what the bar
// shows can never disagree). Unit-tested without a DOM.
//
// v1.75 FLOOR (ruling R2): now that EVERY entry is hidable, a hand-edited
// localStorage config can hide the whole bar, leaving a fixed, empty,
// un-navigable strip on mobile. When a config resolves to nothing visible
// while items ARE present, the config is ignored wholesale and the DEFAULT
// layout renders instead (`flooredToDefault` records that this fired - the
// Settings editor reads it to REFUSE the last un-check up front, so the UI
// can never author such a config in the first place). A default layout that
// is itself empty (every present id default-hidden and nothing opted in) is
// returned honestly rather than fabricated into something.
function resolveBottomNavLayout(presentIds, config) {
  const present = Array.isArray(presentIds) ? presentIds.slice() : [];
  const cfg = (config && typeof config === 'object') ? config : {};
  const out = resolveBottomNavLayoutCore(present, cfg);
  if (out.visible.length === 0 && present.length > 0) {
    const fallback = resolveBottomNavLayoutCore(present, {});
    if (fallback.visible.length > 0) {
      fallback.flooredToDefault = true;
      return fallback;
    }
  }
  out.flooredToDefault = false;
  return out;
}

function readBottomNavConfig() {
  try {
    const raw = localStorage.getItem('ft-bottomnav');
    if (!raw) return { hidden: [], order: [], shown: [] };
    const parsed = JSON.parse(raw);
    return {
      hidden: Array.isArray(parsed && parsed.hidden) ? parsed.hidden : [],
      order: Array.isArray(parsed && parsed.order) ? parsed.order : [],
      shown: Array.isArray(parsed && parsed.shown) ? parsed.shown : [],
    };
  } catch (_) {
    return { hidden: [], order: [], shown: [] };
  }
}

function writeBottomNavConfig(config) {
  try { localStorage.setItem('ft-bottomnav', JSON.stringify(config || { hidden: [], order: [] })); } catch (_) { /* storage disabled */ }
}

// Reorder + hide the live #bottom-nav per the config. Idempotent; safe to call
// repeatedly (each async nav injector calls it after inserting its item).
function applyBottomNavCustomization() {
  if (typeof document === 'undefined') return;
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const items = Array.prototype.slice.call(nav.querySelectorAll('.bottom-nav-item'));
  const byId = {};
  const presentIds = [];
  items.forEach((el) => {
    const id = el.getAttribute('data-nav');
    if (!id) return;
    byId[id] = el;
    presentIds.push(id);
  });
  // v1.339 (L2): a pre-paint RESERVE (`data-ft-reserve`, painted by the shell's inline
  // block from the remembered layout) counts as its item until the real one replaces it,
  // so the bar resolves - and stays spaced - exactly as it will once every tab lands. A
  // reserve whose real item already exists is stale and dropped.
  items.forEach((el) => {
    const id = el.getAttribute('data-ft-reserve');
    if (!id || el.getAttribute('data-nav')) return;
    if (byId[id]) { el.remove(); return; }
    byId[id] = el;
    presentIds.push(id);
  });
  const layout = resolveBottomNavLayout(presentIds, readBottomNavConfig());
  const visibleSet = new Set(layout.visible);
  presentIds.forEach((id) => { if (byId[id]) byId[id].hidden = !visibleSet.has(id); });
  // Reorder: appendChild moves each element to the end, so appending in the
  // resolved order re-sorts the bar without recreating any node.
  layout.visible.forEach((id) => { if (byId[id]) nav.appendChild(byId[id]); });
  rememberBottomNavLayout(layout.visible); // v1.339 (L2): the next launch's pre-paint layout
}

// ---- v1.15.0 item 3: one-off download header button + compact modal -------
//
// A small header download button + compact modal for one-off yt-dlp
// downloads, gated EXACTLY like the /subscriptions nav-link injection above
// (probe `/api/subscriptions/health`, inject only on a genuine 2xx, fail
// closed on 404/network error) -- when the optional module is disabled,
// nothing is ever created (no button, no modal markup), keeping the header
// byte-identical (docs/exec-plans/completed/2026-07-06-v1.15-bigswing.md, item
// 3). Reuses the existing `POST /api/ytdlp/download` one-off endpoint and
// `GET /api/subscriptions/status` live-poll endpoint the /subscriptions
// page's own one-off form already calls -- no server change.
//
// The dropdown option lists below are a deliberate, hardcoded MIRROR of
// `lib/ytdlp/client/subscriptions.js`'s FORMAT_OPTIONS/QUALITY_OPTIONS/
// FILETYPE_OPTIONS (which itself mirrors args.js's server-side allowlists) --
// this file (public/js/common.js) is served unconditionally to every page,
// so it cannot `require()` the gated `lib/ytdlp/client/subscriptions.js`
// module (that file is only ever served via the enabled-gated route). The
// server independently RE-VALIDATES format/quality/filetype on every
// request, so any drift here can only ever be neutralized, never trusted
// as-is. Keep these three lists in sync with subscriptions.js's copies if
// the allowlists ever change.

const ONEOFF_FORMAT_OPTIONS = [
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio only' },
];
const ONEOFF_QUALITY_OPTIONS = ['best', '2160p', '1440p', '1080p', '720p', '480p', '360p'];
const ONEOFF_DEFAULT_QUALITY = 'best';
const ONEOFF_FILETYPE_OPTIONS = {
  video: [
    { value: 'mp4', label: 'MP4 (recommended)' },
    { value: 'mkv', label: 'MKV' },
    { value: 'webm', label: 'WebM' },
    { value: 'default', label: 'Default (yt-dlp)' },
  ],
  audio: [
    { value: 'mp3', label: 'MP3 (recommended)' },
    { value: 'm4a', label: 'M4A' },
    { value: 'opus', label: 'Opus' },
    { value: 'default', label: 'Default (yt-dlp)' },
  ],
};
const ONEOFF_DEFAULT_FILETYPE = { video: 'mp4', audio: 'mp3' };

// ~2.5s poll cadence for the modal's live status, matching subscriptions.js's
// STATUS_POLL_BASE_MS -- consistent cadence across both one-off surfaces.
const ONEOFF_STATUS_POLL_MS = 2500;

// v1.26 code-review fix (F5): failure backoff cap, mirroring
// `DL_CHIP_POLL_MAX_MS`/`STATUS_POLL_MAX_MS` (subscriptions.js) exactly --
// see `nextOneOffPollDelayMs` below.
const ONEOFF_STATUS_POLL_MAX_MS = 30000;

// v1.26 "real progress": the base ~2.5s cadence badly under-samples a short
// video's actual byte-transfer window (often well under 2.5s), so the
// percent ramp that genuinely exists server-side is never observed --
// motion the user should see reads as "frozen" purely because of how
// infrequently it's polled. While a job is ACTIVELY downloading, poll much
// faster instead; every OTHER state (queued/listing/terminal/no job) keeps
// the base cadence -- this is not a blanket faster poll, only a
// short-lived burst while there's real motion worth showing.
const ONEOFF_STATUS_POLL_FAST_MS = 700;

// v1.26 code-review fix (F4): a wedged/stuck yt-dlp child can hold an
// activity entry at `state: 'downloading'` for the ENTIRE
// `downloadTimeoutMinutes` window (180 minutes by default) with no further
// progress output at all -- polling every ~700ms for that whole time serves
// no purpose (there is nothing new to show) and needlessly hammers the
// server. An entry only counts as "genuinely active" (worth the fast
// cadence) when it is BOTH `state: 'downloading'` AND its `updatedAt`
// timestamp is recent; a missing/unparseable `updatedAt` is treated as NOT
// fresh (falls back to the base cadence) rather than crashing or defaulting
// to "active." Shared by `computeOneOffPollDelayMs` below and (duplicated,
// same value, see that function's own comment) `snapshotHasActiveDownload`
// further down this file.
const ACTIVE_ENTRY_STALE_MS = 10000;

/**
 * Pure: is `entry` a genuinely, RECENTLY active `'downloading'` entry --
 * never throws on a malformed/absent entry or `updatedAt`. `nowMs` is
 * injectable (a raw ms number) for deterministic tests; omitted/non-finite
 * falls back to the real clock, same posture as `activity.js`'s
 * `resolveNowMs`. See `ACTIVE_ENTRY_STALE_MS`'s comment for the full
 * staleness rationale (F4).
 */
function isFreshlyActiveEntry(entry, nowMs) {
  if (!entry || typeof entry !== 'object' || entry.state !== 'downloading') return false;
  if (typeof entry.updatedAt !== 'string') return false;
  const updatedMs = Date.parse(entry.updatedAt);
  if (!Number.isFinite(updatedMs)) return false;
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  return (now - updatedMs) < ACTIVE_ENTRY_STALE_MS;
}

/**
 * Pure poll-delay reducer for the one-off modal's live-status poll:
 * `~700ms` while `entry` is FRESHLY `'downloading'` (see
 * `isFreshlyActiveEntry`/F4 above -- a real job in flight, where visible
 * motion actually matters AND is still actually happening), the base
 * `ONEOFF_STATUS_POLL_MS` cadence otherwise (no entry yet, merely
 * `queued`/`listing`, a terminal state, or a `'downloading'` entry that has
 * gone stale/wedged). No DOM/fetch involved -- directly unit-testable, same
 * posture as `nextDownloadChipPollDelay`/`nextPollDelay` (subscriptions.js)
 * elsewhere in this codebase, which this deliberately mirrors in spirit.
 * `nowMs` is optional/injectable, forwarded straight to
 * `isFreshlyActiveEntry`.
 */
function computeOneOffPollDelayMs(entry, nowMs) {
  return isFreshlyActiveEntry(entry, nowMs) ? ONEOFF_STATUS_POLL_FAST_MS : ONEOFF_STATUS_POLL_MS;
}

/**
 * v1.26 code-review fix (F5): the modal poller's full success/failure
 * reducer -- `success` delegates to `computeOneOffPollDelayMs` (fast/base,
 * staleness-aware); failure DOUBLES the delay (capped at
 * `ONEOFF_STATUS_POLL_MAX_MS`), computed from at least the BASE cadence, not
 * `prevDelayMs` verbatim -- otherwise a failure landing right after a fast
 * (~700ms) success tick would retry at ~1400ms, faster than this backoff's
 * own pre-v1.26 first retry ever was (`ONEOFF_STATUS_POLL_MS * 2`). Mirrors
 * `nextDownloadChipPollDelay`/`nextPollDelay` (subscriptions.js) exactly,
 * closing the gap the doc comment above `computeOneOffPollDelayMs` used to
 * describe as "no failure-backoff of its own to preserve" -- the modal poller
 * now backs off on repeated failures exactly like the other two pollers.
 */
function nextOneOffPollDelayMs(prevDelayMs, success, entry, nowMs) {
  if (success) return computeOneOffPollDelayMs(entry, nowMs);
  const prev = typeof prevDelayMs === 'number' && prevDelayMs > 0 ? prevDelayMs : ONEOFF_STATUS_POLL_MS;
  const base = Math.max(prev, ONEOFF_STATUS_POLL_MS);
  return Math.min(base * 2, ONEOFF_STATUS_POLL_MAX_MS);
}

// Pure decision, mirroring `shouldInjectSubscriptionsNav` exactly: inject iff
// the health probe resolved with a genuine 2xx. `node:test`-covered directly
// (see test/unit/ytdlp-oneoff-modal.test.js) -- the DOM-mutation half below
// it is a thin, untested-by-necessity shell around it, same posture as the
// subscriptions nav-link injection.
function shouldInjectOneOffButton(response) {
  return Boolean(response && response.ok === true);
}

/**
 * Pure reducer (no DOM): given the CURRENT `format` and the filetype value
 * selected before the format changed, decides the filetype `<select>`'s new
 * option list + selected value. Mirrors
 * `lib/ytdlp/client/subscriptions.js`'s `reduceFiletypeOptions` exactly (see
 * that file's comment for the full rationale) -- duplicated here rather than
 * shared, since this file is served to every page while that one is only
 * ever served by the enabled-gated route.
 */
function reduceOneOffFiletypeOptions(format, prevFiletype) {
  const fmt = format === 'audio' ? 'audio' : 'video';
  const options = ONEOFF_FILETYPE_OPTIONS[fmt];
  const stillValid = options.some((opt) => opt.value === prevFiletype);
  const selected = stillValid ? prevFiletype : ONEOFF_DEFAULT_FILETYPE[fmt];
  return { format: fmt, options, selected };
}

/**
 * Pure: builds the exact JSON body the modal's Download button POSTs to
 * `POST /api/ytdlp/download` -- `{ url, format, quality }` plus `filetype`
 * when it is defined, plus `folder` (v1.25 QoL, T3/T5) when the user typed a
 * non-blank override. No DOM/fetch involved, so it is directly
 * unit-testable against the field values a real click would read off the
 * form. `folder` is OPTIONAL -- the server now auto-routes a one-off
 * download into a per-channel folder by default (T3), so this only ever
 * needs to be sent when the caller wants to override that default; a blank
 * (or whitespace-only) value is omitted entirely rather than sent as `''`,
 * the same posture `oneshot-folder`'s existing add-form wiring already has
 * (`lib/ytdlp/client/subscriptions.js`).
 */
function buildOneOffDownloadBody(url, format, quality, filetype, folder) {
  const body = { url, format, quality };
  if (filetype !== undefined) body.filetype = filetype;
  const trimmedFolder = typeof folder === 'string' ? folder.trim() : '';
  if (trimmedFolder !== '') body.folder = trimmedFolder;
  return body;
}

/**
 * FR-E-style live-status formatter for the modal's status line -- mirrors
 * `lib/ytdlp/client/subscriptions.js`'s `formatLiveStatusText` exactly
 * (same `LiveEntry` shape from `GET /api/subscriptions/status`'s `oneShots`
 * namespace: `{state, title, index, total, percent, phase, error}` -- `phase`
 * is v1.26's addition, see lib/ytdlp/progress.js's MERGER_RE/
 * EXTRACT_AUDIO_RE/VIDEO_CONVERT_RE/FIXUP_RE). Pure string
 * formatting only -- no DOM -- so it cannot itself introduce an XSS path;
 * callers still render the returned string via `textContent` only, never
 * `innerHTML` (see `buildOneOffModal` below). `entry.error`/`entry.title`
 * are already redacted/confined server-side (activity.js never stores a raw
 * error/stderr), but this function makes no assumption about that -- it
 * treats them as arbitrary strings either way.
 */
// ---- v1.55 Track C: ONE busy/status feedback system ------------------------
//
// Dean: "when I click it and it starts doing stuff, the text is already
// plain underneath it... a more unified system for that type of thing
// across the settings pages." Before this, the management pages had SIX
// divergent status treatments (bare spans, bold inline-styled spans, a
// success message rendered in .field-error red, ad-hoc <small>s). These two
// helpers + the .action-status/.btn-busy CSS are now the single system:
// every management-page action renders its feedback through them.

/**
 * Pure DOM (no fetch): set a status element's text and tone in one call.
 * `kind`: 'busy' (secondary tone + inline spinner), 'error' (error tone),
 * anything else/omitted = idle (plain secondary tone). Passing `text: null`
 * updates ONLY the tone classes and leaves the existing text alone -- the
 * applyReheatStateToControls family deliberately preserves a summary line
 * when there is no fresh progress text, and this keeps that behavior while
 * still clearing a stale spinner. Never innerHTML.
 */
function setActionStatus(el, text, kind) {
  if (!el) return;
  if (text !== null && text !== undefined) el.textContent = text;
  el.classList.toggle('action-status-busy', kind === 'busy');
  el.classList.toggle('action-status-error', kind === 'error');
}

/**
 * Pure DOM: one busy treatment for action buttons -- disabled + the
 * .btn-busy class (in-button spinner via CSS, label preserved). Idempotent
 * both ways; callers that used to write `btn.disabled = running` directly
 * call this instead so the visual state can never desync from the
 * disabled state.
 */
function setButtonBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = busy === true;
  btn.classList.toggle('btn-busy', busy === true);
}

// ===========================================================================
// v1.152: master-detail menu (iOS-Settings feel) for the management pages.
// Design + rationale: docs/exec-plans/completed/2026-08-19-menus-master-detail-and-stats-route.md
//
// Progressive enhancement over the SAME `<details data-collapse-key>` sections
// wireCollapsibleSections used to persist: a `.md-root[data-md-page]` wrapper
// holds them, and wireMasterDetail turns them into a grouped menu (icon tile +
// label) that opens ONE section at a time - a phone menu->detail slide, a
// desktop rail + pane. Per-section additive attrs only: data-md-icon,
// data-md-group, optional data-md-label / data-md-badge. Colours all come from
// CSS tokens (JS only sets data-attrs/classes) so the token census stays 0.
// ===========================================================================

// Inline-SVG glyphs for the tiles (the approved-prototype set). Inline SVG, not
// the .icon-* masks: full control + no iOS mask decode-lag (v1.91) + no
// per-icon-set asset duplication. stroke=currentColor; the tile paints white.
const MD_ICON_PATHS = {
  appearance: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  video: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M10.5 9.2v5.6l4.5-2.8z"/>',
  book: '<path d="M12 6c-2-1.4-5-1.4-7.2 0v11.4c2.2-1.4 5.2-1.4 7.2 0m0-11.4c2-1.4 5-1.4 7.2 0v11.4c-2.2-1.4-5.2-1.4-7.2 0m0-11.4v11.4"/>',
  music: '<path d="M9 17.5V6l10-2v9.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="13.5" r="2.5"/>',
  podcast: '<rect x="9" y="3" width="6" height="10" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  sliders: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="17" r="2"/>',
  download: '<path d="M12 3v11m-4.5-4.5L12 14l4.5-4.5M5 20h14"/>',
  trash: '<path d="M4 7h16M6.5 7l1 12.5h9L17.5 7M9.5 7V4h5v3M10 11v5.5M14 11v5.5"/>',
  hidden: '<path d="M3 3l18 18M10.6 6.2A9 9 0 0 1 21 12a10 10 0 0 1-2.4 3.1M6.5 6.6A10 10 0 0 0 3 12a9 9 0 0 0 12.2 5"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.7-4 3.9-6 7.5-6s6.8 2 7.5 6"/>',
  users: '<circle cx="9" cy="8" r="3.3"/><path d="M2.5 20c.4-3.3 3.1-5 6.5-5s6.1 1.7 6.5 5"/><path d="M16 5.2a3.3 3.3 0 0 1 0 6.6M17.5 15.2c2.6.5 4.2 2 4.5 4.8"/>',
  backup: '<rect x="3" y="6" width="18" height="4" rx="1"/><path d="M5 10v9.5h14V10M9.5 14h5"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  keyboard: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17.5 10h.01M6.5 13.5h.01M17.5 13.5h.01M9 13.5h6"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>',
  paw: '<circle cx="7" cy="9.5" r="1.4"/><circle cx="10.5" cy="6.8" r="1.4"/><circle cx="14.7" cy="7.3" r="1.4"/><circle cx="17.6" cy="10.5" r="1.4"/><path d="M12.4 11.5c2.6 0 4.8 1.9 4.8 4.2 0 1.7-1.4 3-3.1 3-.9 0-1.3-.4-1.7-.4s-.8.4-1.7.4c-1.7 0-3.1-1.3-3.1-3 0-2.3 2.2-4.2 4.8-4.2z"/>',
  flask: '<path d="M10 3h4M10.8 3v5.2L5.6 17.8A2 2 0 0 0 7.4 21h9.2a2 2 0 0 0 1.8-3.2L13.2 8.2V3M8 14.5h8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  channel: '<rect x="3.5" y="8" width="17" height="11.5" rx="2"/><path d="M8.5 3.5L12 8l3.5-4.5"/>',
  // UI pass step 2 (F39): the Shows folders tile named `tv`, which was never here, so it
  // drew the `info` fallback. A screen on a stand (distinct from `channel`'s antenna).
  tv: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20.5h6M12 16.5v4"/>',
  trophy: '<path d="M8 4h8v3.5a4 4 0 0 1-8 0zM8 5.5H5.5v1a3 3 0 0 0 3 3M16 5.5h2.5v1a3 3 0 0 1-3 3M10.5 12h3l.7 4h-4.4zM8 20h8"/>',
  eye: '<path d="M2.5 12s3.6-6.8 9.5-6.8S21.5 12 21.5 12s-3.6 6.8-9.5 6.8S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.1l-5.4 5.4 2.2 2.2 5.4-5.4a4 4 0 0 0 5.1-5.3l-2.4 2.4-2.1-.5-.5-2.1z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 5.5h3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
  bell: '<path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4.5 2 5.5 2 5.5H4.5s2-1 2-5.5zM10 19a2 2 0 0 0 4 0"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  warning: '<path d="M12 4l9 16H3zM12 10v4.5M12 17.5h.01"/>',
  clock: '<path d="M3.5 12a8.5 8.5 0 1 0 8.5-8.5A8.5 8.5 0 0 0 4 8"/><path d="M3.5 3.5v4.5H8M12 8v4.2l3 1.8"/>',
};
// Group tint cycle (colour encodes the group). The values live in CSS tokens
// keyed by these names; JS only sets data-md-tone.
const MD_TONE_CYCLE = ['red', 'graphite', 'steel'];
// The era-reactive Appearance tile tracks <html data-theme> (the era skin).
const MD_ERAS = ['2021', '2014', '2009', '2005'];
const MD_ERA_RX = { '2021': 6, '2014': 4, '2009': 2.5, '2005': 1.5 };

function mdEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function mdSvg(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (MD_ICON_PATHS[name] || MD_ICON_PATHS.info) + '</svg>';
}
function mdCurrentEra() {
  let era = null;
  try { if (typeof document !== 'undefined') era = document.documentElement.getAttribute('data-theme'); } catch (_) { /* SSR/node */ }
  return MD_ERAS.indexOf(era) !== -1 ? era : '2021';
}
function mdEraGlyph(era) {
  const rx = MD_ERA_RX[era] || 6; // the play-badge corner shifts with the era
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="3" y="6" width="18" height="12" rx="' + rx + '"/><path d="M10.5 9.2v5.6l4.5-2.8z"/></svg>';
}
// Group ordering: the ungrouped/era group ('') is always first; the rest follow
// the .md-root[data-md-groups] declared order (so tone assignment is
// deterministic regardless of the sections' document order); any group not
// listed keeps its first-appearance position after the declared ones.
function mdGroupRank(title, order) {
  if (title === '') return -1;
  const i = order.indexOf(title);
  return i === -1 ? 1000 : i;
}
function mdTileHtml(section, groupTone) {
  const icon = section.getAttribute('data-md-icon') || 'info';
  if (icon === 'era') {
    const era = mdCurrentEra();
    return '<span class="md-tile md-tile--era" data-md-era="' + mdEsc(era) + '" data-md-era-tile>' + mdEraGlyph(era) + '</span>';
  }
  return '<span class="md-tile" data-md-tone="' + mdEsc(groupTone || 'graphite') + '">' + mdSvg(icon) + '</span>';
}

// Wire the `.md-root[data-md-page=pageKey]` inside `root` into a master-detail
// menu. Idempotent: a re-call just refreshes the nav (dynamic sections). All
// listeners bind to `signal` so a view destroy() unwires cleanly.
function wireMasterDetail(pageKey, root, signal) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelector !== 'function') return;
  const mdRoot = scope.querySelector('.md-root[data-md-page="' + pageKey + '"]') || scope.querySelector('.md-root');
  if (!mdRoot) return;
  if (mdRoot.dataset.mdWired === '1') { if (typeof mdRoot._mdRefresh === 'function') mdRoot._mdRefresh(); return; }
  mdRoot.dataset.mdWired = '1';

  const doc = mdRoot.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  const sections = Array.prototype.slice.call(mdRoot.querySelectorAll('details[data-collapse-key]'))
    .filter((s) => s.parentNode === mdRoot);

  const track = doc.createElement('div'); track.className = 'md-track';
  const nav = doc.createElement('nav'); nav.className = 'md-nav'; nav.setAttribute('aria-label', 'Sections');
  const panes = doc.createElement('div'); panes.className = 'md-panes';
  const head = doc.createElement('div'); head.className = 'md-detail-head';
  const backBtn = doc.createElement('button');
  backBtn.type = 'button'; backBtn.className = 'md-back';
  backBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>'
    + '<span class="md-back-label"></span>';
  const headTitle = doc.createElement('h2'); headTitle.className = 'md-detail-title';
  head.appendChild(backBtn); head.appendChild(headTitle);
  panes.appendChild(head);
  sections.forEach((s) => { s.open = true; panes.appendChild(s); });

  // v1.153: the iOS-Settings-style page header box. REUSABLE - any .md-root page
  // gets one by declaring data-md-title / data-md-desc / data-md-hero-icon (no
  // code change). Sits ABOVE the track: a full-width page header on desktop; on
  // phone it shows on the menu screen and hides on the detail (CSS keys the hide
  // on [data-md-open="true"]). Uniform height via CSS min-height + a 2-line
  // clamp on the description.
  const heroDesc = mdRoot.getAttribute('data-md-desc') || '';
  const heroIcon = mdRoot.getAttribute('data-md-hero-icon') || '';
  const heroTitle = mdRoot.getAttribute('data-md-title') || '';
  if (heroTitle || heroDesc) {
    const hero = doc.createElement('div');
    hero.className = 'md-hero';
    hero.innerHTML = '<span class="md-tile md-tile--hero" data-md-tone="graphite">' + mdSvg(heroIcon) + '</span>'
      + '<div class="md-hero-text"><h2>' + mdEsc(heroTitle) + '</h2>'
      + (heroDesc ? '<p>' + mdEsc(heroDesc) + '</p>' : '') + '</div>';
    mdRoot.appendChild(hero);
  }

  track.appendChild(nav); track.appendChild(panes);
  mdRoot.appendChild(track);

  const pageTitle = mdRoot.getAttribute('data-md-title') || '';
  const backLabel = backBtn.querySelector('.md-back-label');
  if (backLabel) backLabel.textContent = pageTitle;
  // v1.154: the visible back label is CSS-hidden on phone (iOS bare chevron) and
  // the svg is aria-hidden, so give the button an accessible name (slim-gate a11y).
  backBtn.setAttribute('aria-label', pageTitle ? ('Back to ' + pageTitle) : 'Back');

  const declaredGroupOrder = (mdRoot.getAttribute('data-md-groups') || '').split(',').map((s) => s.trim()).filter(Boolean);

  let selectedKey = null;
  try { const saved = localStorage.getItem('ft-md:' + pageKey); if (saved) selectedKey = saved; } catch (_) { /* private mode */ }
  mdRoot.dataset.mdOpen = 'false';

  const chevron = '<span class="md-row-chev" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>';

  function labelOf(s) {
    const override = s.getAttribute('data-md-label');
    if (override) return override;
    const sum = s.querySelector('summary');
    return sum ? sum.textContent.trim() : (s.getAttribute('data-collapse-key') || '');
  }
  function visibleSections() { return sections.filter((s) => !s.hidden); }
  // v1.158 (Dean): sections still HIDDEN behind setup.js's async capability
  // reveal that want a shimmer slot held for them (data-md-reserve), gated on
  // the last-known-admin flag - so a RETURNING admin's Downloads/Users/Backup
  // rows do not "pop in a second later". Never reserves for a non-admin (no
  // flag), and the placeholder carries NO label/icon, so a hidden section's
  // identity is never rendered (the v1.80 privacy rule).
  function mdReserveAdmin() {
    try { return localStorage.getItem('ft-is-admin') === '1'; } catch (_) { return false; }
  }
  function reservedSections() {
    if (!mdReserveAdmin()) return [];
    return sections.filter((s) => s.hidden && s.getAttribute('data-md-reserve') !== null);
  }

  function applySelection() {
    sections.forEach((s) => {
      const on = s.getAttribute('data-collapse-key') === selectedKey;
      if (s.classList) s.classList.toggle('md-active', on);
    });
    const rows = nav.querySelectorAll('.md-row');
    for (let i = 0; i < rows.length; i += 1) {
      rows[i].classList.toggle('md-row--active', rows[i].getAttribute('data-md-target') === selectedKey);
    }
    const sel = sections.filter((s) => s.getAttribute('data-collapse-key') === selectedKey)[0];
    headTitle.textContent = sel ? labelOf(sel) : '';
  }

  function buildNav() {
    const groups = []; const byTitle = {}; let toneIdx = 0;
    const ensureGroup = (g) => {
      if (!Object.prototype.hasOwnProperty.call(byTitle, g)) {
        byTitle[g] = { title: g, items: [], reserved: 0, hasEra: false }; groups.push(byTitle[g]);
      }
      return byTitle[g];
    };
    visibleSections().forEach((s) => {
      const grp = ensureGroup(s.getAttribute('data-md-group') || '');
      grp.items.push(s);
      if ((s.getAttribute('data-md-icon') || '') === 'era') grp.hasEra = true;
    });
    // Count a reserved shimmer slot into each admin section's group (creating
    // the group if it has no visible sections yet). Placeholders come AFTER the
    // real rows - the admin sections sit last in System/Account.
    reservedSections().forEach((s) => { ensureGroup(s.getAttribute('data-md-group') || '').reserved += 1; });
    groups.sort((a, b) => mdGroupRank(a.title, declaredGroupOrder) - mdGroupRank(b.title, declaredGroupOrder));
    groups.forEach((grp) => { grp.tone = grp.hasEra ? null : MD_TONE_CYCLE[(toneIdx++) % MD_TONE_CYCLE.length]; });

    let html = '';
    groups.forEach((grp) => {
      html += '<div class="md-group">';
      if (grp.title) html += '<div class="md-group-title">' + mdEsc(grp.title) + '</div>';
      html += '<div class="md-group-card">';
      grp.items.forEach((s) => {
        const key = s.getAttribute('data-collapse-key');
        const badge = s.getAttribute('data-md-badge');
        // v1.152 (gate): a section marked data-md-hide-mobile (e.g. Stats'
        // keyboard shortcuts - Dean: "not on mobile viewport") propagates the
        // hide to its generated row; CSS drops the row AND its active pane <=768px.
        const hideMobile = s.getAttribute('data-md-hide-mobile') !== null ? ' md-hide-mobile' : '';
        html += '<button type="button" class="md-row' + hideMobile + '" data-md-target="' + mdEsc(key) + '">'
          + mdTileHtml(s, grp.tone)
          + '<span class="md-row-label">' + mdEsc(labelOf(s)) + '</span>'
          + (badge ? '<span class="md-row-badge">' + mdEsc(badge) + '</span>' : '')
          + chevron + '</button>';
      });
      // v1.158: the reserved shimmer rows (non-interactive, aria-hidden, no
      // label/icon). A .md-row with a 30px tile block matches a real row's
      // height so the real row replaces it with ZERO shift on reveal.
      for (let i = 0; i < grp.reserved; i += 1) {
        html += '<div class="md-row md-row-skeleton" aria-hidden="true">'
          + '<span class="md-row-skeleton-tile skeleton-shimmer"></span>'
          + '<span class="md-row-skeleton-label skeleton-shimmer"></span></div>';
      }
      html += '</div></div>';
    });
    nav.innerHTML = html;

    const vis = visibleSections().map((s) => s.getAttribute('data-collapse-key'));
    if (!selectedKey || vis.indexOf(selectedKey) === -1) selectedKey = vis[0] || null;
    applySelection();
    observeSections();
  }

  // v1.164 (Dean): SCROLL OWNERSHIP. On phone the push-in swaps what fills the
  // viewport, but the WINDOW is the scroller there - the panes container does
  // not overflow, so its scrollTop reset below is a no-op on mobile. The nav
  // list's window offset used to survive into the just-opened section, landing
  // the pane title + back arrow off-screen under the app header ("Under the
  // hood" needed a scroll just to see its own heading). Opening a section now
  // lands at the TOP (window AND panes - whichever actually scrolls); Back
  // restores the saved list offset so you return to your place in the list
  // (iOS-Settings style). Desktop section clicks snap to top too (Dean's call).
  let navScrollY = 0;

  function selectKey(key, openDetail) {
    const s = sections.filter((x) => x.getAttribute('data-collapse-key') === key && !x.hidden)[0];
    if (!s) return;
    selectedKey = key;
    applySelection();
    try { localStorage.setItem('ft-md:' + pageKey, key); } catch (_) { /* private mode */ }
    if (openDetail) {
      if (typeof window !== 'undefined') {
        try { navScrollY = window.scrollY || 0; window.scrollTo(0, 0); } catch (_) { /* jsdom: scrollTo unimplemented */ }
      }
      mdRoot.dataset.mdOpen = 'true'; panes.scrollTop = 0;
    }
    // v1.172 (Dean's Settings screenshots: the SAME critters floated over
    // BOTH the menu and the open section, anchored to the other pane's
    // furniture): a master-detail pane swap changes what fills the screen but
    // the router never sees it - so each subpage earns its own scatter.
    // Hidden panes measure zero-size and are skipped by the collector, so the
    // re-plan sees only the visible pane. Covers mobile drill-in AND desktop
    // section switches (both route through selectKey); the shared 200ms
    // debounce, retry ladder, and stale-timer cancel all apply as on a
    // router navigation.
    scheduleCritterScatter();
  }

  nav.addEventListener('click', (e) => {
    const row = e.target && e.target.closest ? e.target.closest('.md-row') : null;
    if (!row || !nav.contains(row)) return;
    selectKey(row.getAttribute('data-md-target'), true);
  }, signal ? { signal } : undefined);
  backBtn.addEventListener('click', () => {
    mdRoot.dataset.mdOpen = 'false';
    // Return to the SAME spot in the list the user tapped from (not the top).
    // ORDER MATTERS (gate S1): restore AFTER the mdOpen swap above - while the
    // (often short) detail pane is still displayed, the browser would CLAMP
    // scrollTo(0, navScrollY) to the detail's max scroll and the list would
    // re-appear at a truncated offset. jsdom cannot bind this (no layout).
    if (typeof window !== 'undefined') {
      try { window.scrollTo(0, navScrollY); } catch (_) { /* jsdom: scrollTo unimplemented */ }
    }
    scheduleCritterScatter(); // v1.172: Back = the menu pane returns - its own scatter (see selectKey)
  }, signal ? { signal } : undefined);

  // Keep the menu in sync with ASYNC admin-box reveals (setup.js sets
  // box.hidden=false after a capability fetch): observe each section's `hidden`.
  // Because the nav is built from non-hidden sections only, an admin row never
  // renders for a restricted user (the v1.80 leak class). Observing the section
  // NODES (not the mdRoot subtree) avoids a rebuild loop when buildNav rewrites
  // nav.innerHTML.
  let hiddenObs = null;
  function observeSections() {
    if (typeof MutationObserver === 'undefined') return;
    if (!hiddenObs) hiddenObs = new MutationObserver(() => buildNav());
    sections.forEach((s) => { try { hiddenObs.observe(s, { attributes: true, attributeFilter: ['hidden'] }); } catch (_) { /* detached */ } });
  }

  // A re-call (dynamic sections appended after init, e.g. the subs history /
  // failures cards) adopts any new details into the panes and rebuilds.
  mdRoot._mdRefresh = function mdRefresh() {
    const fresh = Array.prototype.slice.call(mdRoot.querySelectorAll('details[data-collapse-key]'));
    let added = false;
    fresh.forEach((s) => {
      if (sections.indexOf(s) === -1) { s.open = true; if (s.parentNode !== panes) panes.appendChild(s); sections.push(s); added = true; }
    });
    if (added) buildNav();
  };

  // v1.158 (Dean): rebuild the nav on demand. setup.js calls this after its
  // admin check resolves NON-admin, to drop any reserved shimmer slot a stale
  // last-known-admin flag put up (the reveal-once CLEAR axis - a shared-device
  // non-admin must never strand an admin placeholder).
  mdRoot._mdRebuild = buildNav;

  // Era-reactive Appearance tile: repaint when <html data-theme> changes. Only
  // wired when the page actually HAS an era tile (Settings) - Stats/Subscriptions
  // have none, so skip the observer entirely (an admin reveal never adds one).
  const hasEraTile = sections.some((s) => (s.getAttribute('data-md-icon') || '') === 'era');
  if (hasEraTile && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const eraObs = new MutationObserver(() => {
      const era = mdCurrentEra();
      const tiles = nav.querySelectorAll('[data-md-era-tile]');
      for (let i = 0; i < tiles.length; i += 1) { tiles[i].setAttribute('data-md-era', era); tiles[i].innerHTML = mdEraGlyph(era); }
    });
    try { eraObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (_) { /* detached */ }
    if (signal) signal.addEventListener('abort', () => eraObs.disconnect(), { once: true });
  }
  if (signal) signal.addEventListener('abort', () => { if (hiddenObs) hiddenObs.disconnect(); }, { once: true });

  buildNav();

  // v1.305 (Dean): deep-link a section by URL hash (#<collapse-key>), so the
  // account menu's "N items in trash" (-> /setup.html#trash) opens the Trash
  // section directly instead of dumping you at the top of Settings. Generic - any
  // md section is now reachable by its key; a full page load runs this via init()
  // (bootRouter), and an in-app SPA nav runs it via swapToView's init() with the
  // hash already on window.location (navigate() pushes the href before swapping).
  // No-ops for an empty, unknown, or still-hidden (admin-gated) key.
  function selectFromHash() {
    if (typeof window === 'undefined' || !window.location) return;
    const key = String(window.location.hash || '').replace(/^#/, '');
    if (!key) return;
    const target = sections.filter((s) => s.getAttribute('data-collapse-key') === key && !s.hidden)[0];
    if (target) selectKey(key, true);
  }
  selectFromHash();
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('hashchange', selectFromHash, signal ? { signal } : undefined);
  }
}

function formatOneOffStatusText(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const state = entry.state;
  // v1.31 P5: the status snapshot carries `queuedAhead` (how many gate jobs
  // -- channels or earlier one-shots -- sit ahead on the serial queue) for
  // every still-queued one-shot, so an accepted job is never an
  // indistinguishable, possibly-long 'Queued…'. Additive: an older/absent
  // field falls back to the plain literal unchanged.
  if (state === 'queued') {
    const ahead = typeof entry.queuedAhead === 'number' && entry.queuedAhead > 0 ? entry.queuedAhead : null;
    return ahead ? `Queued — ${ahead} ahead` : 'Queued…';
  }
  if (state === 'listing') return 'Checking for new videos…';
  if (state === 'downloading') {
    const title = typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title.trim() : null;
    const videoId = typeof entry.videoId === 'string' && entry.videoId.trim() !== '' ? entry.videoId.trim() : null;
    const index = typeof entry.index === 'number' && entry.index > 0 ? entry.index : null;
    const total = typeof entry.total === 'number' && entry.total > 0 ? entry.total : null;
    const position = index !== null && total !== null ? (index + ' of ' + total) : '';
    const hasRealPercent = typeof entry.percent === 'number' && Number.isFinite(entry.percent) && entry.percent > 0;

    // v1.26 "real progress": once yt-dlp's ffmpeg-backed postprocessors take
    // over (muxing/extracting/converting -- see lib/ytdlp/progress.js's
    // MERGER_RE/EXTRACT_AUDIO_RE/VIDEO_CONVERT_RE/FIXUP_RE), `entry.phase` is
    // set and is AUTHORITATIVE over `percent` -- percent is necessarily
    // stale/sticky during this window (there is no percent to report while
    // ffmpeg runs), so rendering it here ("— 100%") would read as "done"
    // when real work is still happening. Checked before the percent branch
    // below so a phase always wins over a stale number.
    if (entry.phase === 'merging' || entry.phase === 'converting') {
      const label = entry.phase === 'merging' ? 'Merging…' : 'Converting…';
      return [label, position].filter((part) => part !== '').join(' — ');
    }

    // BUG 1 fix: yt-dlp's extraction/nsig/format-negotiation and its
    // ffmpeg-merge/postprocess phases emit NO percent line at all (see
    // lib/ytdlp/progress.js's PERCENT_RE -- only the short byte-transfer
    // phase ever matches it), so `entry.percent` sits at its initial `0` for
    // almost the entire job. Rendering "— 0%" that whole time reads as
    // "stalled", not "working". Once a REAL transfer percent (> 0) has
    // arrived, render the numeric form exactly as before; until then, render
    // an honest, phase-aware indeterminate label: "Preparing…" before yt-dlp
    // has identified/started working on an item at all (a bare
    // `{state:'downloading'}` patch, straight off the orchestrator's initial
    // transition -- no title/videoId yet), or "Downloading…" once it has (a
    // `videoId` and/or `title` has arrived -- see progress.js's
    // YOUTUBE_ITEM_RE/DESTINATION_RE). `index`/`total` (N of M) are kept in
    // either branch when present.
    if (!hasRealPercent) {
      const label = (title !== null || videoId !== null) ? 'Downloading…' : 'Preparing…';
      return [label, position].filter((part) => part !== '').join(' — ');
    }

    const percent = Math.max(0, Math.min(100, Math.round(entry.percent)));
    return [title !== null ? title : 'Downloading', position, percent + '%'].filter((part) => part !== '').join(' — ');
  }
  // v1.339 S1 (D1 "Keep mine"): the file was already in the library, so
  // yt-dlp kept it and downloaded nothing -- a success, never an error.
  // `alreadyInLibrary` is read only while `state === 'done'` (state-gated).
  if (state === 'done') return entry.alreadyInLibrary === true ? 'Already in your library' : 'Done';
  if (state === 'error') return typeof entry.error === 'string' && entry.error.trim() !== '' ? entry.error : 'error';
  // v1.24.0 A3: a NEW terminal state distinct from 'error' -- see
  // `lib/ytdlp/index.js`'s cancel route.
  if (state === 'cancelled') return 'Cancelled';
  return null; // 'idle' (or an unrecognized future state) -- no live override
}

/**
 * v1.26 "real progress" -- pure reducer (no DOM) deciding the one-off modal's
 * progress bar shape from a `LiveEntry`: `visible` (any in-flight job --
 * `queued`/`listing`/`downloading` -- gets a bar; a terminal/idle/absent
 * entry hides it), `indeterminate` (no genuine percent to show right now --
 * either no real transfer percent has arrived yet, or a postprocess `phase`
 * is set and therefore authoritative over a stale percent -- see
 * `formatOneOffStatusText`'s own phase-first check above), and `percent`
 * (the same 0-100 rounded/clamped value `formatOneOffStatusText` computes,
 * `0` when indeterminate). Mirrors `downloadChipItemShowsPercent`'s "only a
 * genuine in-flight state gets a bar" posture. Exported/`node:test`-covered
 * directly, same posture as every other pure formatter in this file.
 */
function computeOneOffProgressBar(entry) {
  if (!entry || typeof entry !== 'object') return { visible: false, indeterminate: false, percent: 0 };
  const state = entry.state;
  if (state !== 'queued' && state !== 'listing' && state !== 'downloading') {
    return { visible: false, indeterminate: false, percent: 0 };
  }
  const hasPhase = entry.phase === 'merging' || entry.phase === 'converting';
  const hasRealPercent = typeof entry.percent === 'number' && Number.isFinite(entry.percent) && entry.percent > 0;
  if (hasPhase || !hasRealPercent) return { visible: true, indeterminate: true, percent: 0 };
  return { visible: true, indeterminate: false, percent: Math.max(0, Math.min(100, Math.round(entry.percent))) };
}

// Builds a `<select>` populated from `options` (an array of `{value, label}`
// objects) via `createElement`/`textContent` ONLY -- mirrors
// `lib/ytdlp/client/subscriptions.js`'s `buildSelect`.
function buildOneOffSelect(doc, options, selectedValue) {
  const d = doc || document;
  const select = d.createElement('select');
  let matchedValue = null;
  options.forEach((opt) => {
    const option = d.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === selectedValue) {
      option.selected = true;
      matchedValue = opt.value;
    }
    select.appendChild(option);
  });
  select.value = matchedValue !== null ? matchedValue : (options.length > 0 ? options[0].value : undefined);
  return select;
}

// Removes all children of `el` without ever touching innerHTML.
function clearOneOffChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// Rebuilds `filetypeSelect`'s `<option>` list in place from `format`'s
// current value, via `reduceOneOffFiletypeOptions` -- wired to the format
// select's `change` listener, mirroring subscriptions.js's
// `repopulateFiletypeSelect`. `createElement`/`textContent` only.
function repopulateOneOffFiletypeSelect(doc, format, filetypeSelect) {
  if (!filetypeSelect) return;
  const d = doc || document;
  const { options, selected } = reduceOneOffFiletypeOptions(format, filetypeSelect.value);
  clearOneOffChildren(filetypeSelect);
  let matchedValue = null;
  options.forEach((opt) => {
    const option = d.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === selected) {
      option.selected = true;
      matchedValue = opt.value;
    }
    filetypeSelect.appendChild(option);
  });
  filetypeSelect.value = matchedValue !== null ? matchedValue : (options.length > 0 ? options[0].value : undefined);
}

// Wraps a native <select> in the ui-select box (the field styling + a chevron).
function oneOffSelectBox(d, select) {
  const box = d.createElement('span');
  box.className = 'ui-select';
  select.className = 'ui-select__native';
  box.appendChild(select);
  if (typeof d.createElementNS === 'function') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = d.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'ui-icon ui-icon--md ui-select__chevron');
    svg.setAttribute('aria-hidden', 'true');
    const use = d.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-expand_more');
    svg.appendChild(use);
    box.appendChild(svg);
  }
  return box;
}

/**
 * Builds the compact one-off download modal as real DOM nodes -- backdrop +
 * dialog, appended to `document.body` by the caller. `createElement`/
 * `textContent` ONLY (never `innerHTML`, matching this file's discipline for
 * every dynamic string). `handlers` = `{ onDownload(body), onClose() }`
 * decouples DOM construction from network calls, mirroring
 * `createSubscriptionRow`'s pattern, so this function stays pure/DOM-only
 * and directly unit-testable with a fake `document` (no real fetch).
 *
 * SECURITY: the only strings ever rendered into this modal after the initial
 * build are the status line (via `setOneOffModalStatus`, `textContent` only)
 * and whatever the user themselves typed into the URL field (never echoed
 * back as markup) -- there is no server/user-derived string rendered any
 * other way.
 */
function buildOneOffModal(doc, handlers) {
  const d = doc || document;
  const h = handlers || {};
  const U = overlayUiLib();

  // Sweep S8 put every control on the primitives (ui-field inputs, ui-select selects, ui-btn
  // buttons); sweep S9 moves the SHELL onto ui.sheet: a bottom sheet on a phone, a dialog on
  // desktop, titled "One-off download", with the sheet's one Close. `modal` is the form (its
  // content). Esc, the scrim, Close and a drag down each close the sheet and call onClose
  // (through onClosing), so the caller's teardown runs on every way out. v1.289's drag-safe
  // dismiss holds by construction: the scrim is a SIBLING of the sheet, so a text-selection
  // drag from a field onto it clicks their common ancestor, never the scrim.
  const modal = d.createElement('div');
  modal.className = 'oneoff-form';

  const urlInput = d.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'ui-field__input';
  // v1.41.13: any yt-dlp-supported site, not just YouTube (universal one-offs).
  urlInput.setAttribute('placeholder', 'Media URL — any yt-dlp-supported site');
  urlInput.setAttribute('aria-label', 'Media URL');
  modal.appendChild(urlInput);

  const row = d.createElement('div');
  row.className = 'oneoff-modal-selects';

  const formatSelect = buildOneOffSelect(d, ONEOFF_FORMAT_OPTIONS, 'video');
  formatSelect.setAttribute('aria-label', 'Format');
  row.appendChild(oneOffSelectBox(d, formatSelect));

  const qualitySelect = buildOneOffSelect(
    d,
    ONEOFF_QUALITY_OPTIONS.map((q) => ({ value: q, label: q })),
    ONEOFF_DEFAULT_QUALITY
  );
  qualitySelect.setAttribute('aria-label', 'Quality');
  row.appendChild(oneOffSelectBox(d, qualitySelect));

  const filetypeSelect = buildOneOffSelect(d, ONEOFF_FILETYPE_OPTIONS.video, ONEOFF_DEFAULT_FILETYPE.video);
  filetypeSelect.setAttribute('aria-label', 'File type');
  row.appendChild(oneOffSelectBox(d, filetypeSelect));

  formatSelect.addEventListener('change', () => {
    repopulateOneOffFiletypeSelect(d, formatSelect.value, filetypeSelect);
  });

  modal.appendChild(row);

  // v1.25 QoL (T3/T5): the manual folder is an OPTIONAL override -- the
  // server now auto-routes a one-off download into a per-channel folder by
  // default, so this field is left BLANK by default and only ever read when
  // the user actually types something (see `buildOneOffDownloadBody`'s own
  // blank-means-omit posture below). `aria-label` gives it an accessible
  // name (this compact modal has no visible `<label>` elements for any of
  // its controls, matching `urlInput`'s own placeholder-only precedent).
  const folderInput = d.createElement('input');
  folderInput.type = 'text';
  folderInput.className = 'ui-field__input';
  folderInput.setAttribute('placeholder', 'Folder (optional — defaults to the channel)');
  folderInput.setAttribute('aria-label', 'Folder (optional — defaults to the channel)');
  modal.appendChild(folderInput);

  const statusEl = d.createElement('div');
  statusEl.className = 'oneoff-modal-status';
  statusEl.setAttribute('aria-live', 'polite');
  modal.appendChild(statusEl);

  // v1.26 "real progress": a real, moving progress bar under the status
  // text -- reuses the corner chip's own track/fill classes
  // (`dl-status-chip-progress`/`-fill`, see style.css) rather than
  // duplicating that styling, plus an `oneoff-modal-progress` class of its
  // own for modal-specific spacing. Hidden by default (no job yet); driven
  // by `setStatus` below via `computeOneOffProgressBar`.
  const progressTrack = d.createElement('div');
  progressTrack.className = 'dl-status-chip-progress oneoff-modal-progress';
  progressTrack.hidden = true;
  const progressFill = d.createElement('div');
  progressFill.className = 'dl-status-chip-progress-fill';
  progressTrack.appendChild(progressFill);
  modal.appendChild(progressTrack);

  // v1.29.0 T6 (R1.4/AC3.4): the modal's error-state Retry -- unlike the
  // corner chip's one-shot row (already reachable via `retryOneShot`, see
  // `injectDownloadStatusChip` below), the one-off modal's own error
  // rendering (`decideOneOffTerminalAction` returns `{close:false}` for a
  // non-'done' entry, leaving the modal open with the error visible) had NO
  // Retry control at all -- this closes that gap. Hidden by default; toggled
  // by `setStatus` below (visible only while `entry.state === 'error'`).
  // Reuses `h.onRetry(currentEntry)` -- an INJECTED handler, mirroring
  // `downloadBtn`'s own `h.onDownload(body)` pattern, so this builder stays
  // pure/DOM-only and directly `node:test`-covered with a fake `document`
  // (no real fetch). `currentEntry` is the LAST `LiveEntry` this modal was
  // handed via `setStatus` -- the SAME `rawEntry` shape the chip's
  // `retryOneShot(rawEntry, key)` already consumes (both read `url`/`format`/
  // `quality`/`filetype`/`label` off it via the SHARED `buildOneShotRetryBody`
  // -- the live wiring below builds the SAME request the chip does, never a
  // duplicated request shape).
  let currentEntry = null;
  const retryBtn = d.createElement('button');
  retryBtn.type = 'button';
  // v1.55 Track B (Dean: "this weird little retry button on the left, and
  // then boom... big download button. The retry just looks off"): Retry and
  // Download now share ONE .action-bar row (equal-width cells) instead of a
  // small stray button floating above a big primary. Same lifecycle: Retry
  // exists only while the entry is in its error state (setStatus below).
  retryBtn.className = 'ui-btn ui-btn--secondary ui-btn--md oneoff-modal-retry';
  retryBtn.textContent = 'Retry';
  retryBtn.hidden = true;
  retryBtn.addEventListener('click', () => {
    if (typeof h.onRetry === 'function') h.onRetry(currentEntry);
  });

  const downloadBtn = d.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'ui-btn ui-btn--primary ui-btn--md';
  downloadBtn.textContent = 'Download';
  downloadBtn.addEventListener('click', () => {
    const url = typeof urlInput.value === 'string' ? urlInput.value.trim() : '';
    if (!url) {
      statusEl.textContent = 'Enter a media URL.';
      return;
    }
    const body = buildOneOffDownloadBody(url, formatSelect.value, qualitySelect.value, filetypeSelect.value, folderInput.value);
    if (typeof h.onDownload === 'function') h.onDownload(body);
  });
  const actionsRow = d.createElement('div');
  actionsRow.className = 'action-bar oneoff-modal-actions';
  actionsRow.appendChild(retryBtn);
  actionsRow.appendChild(downloadBtn);
  modal.appendChild(actionsRow);

  // Renders a live-status entry (or clears the line when `null`/no entry) --
  // `textContent` only, never `innerHTML`, no matter what `entry.title`/
  // `entry.error` contain. The progress bar is driven by the SAME entry,
  // via the pure `computeOneOffProgressBar` reducer above -- never visible
  // for an idle/terminal/absent entry, and marked `.indeterminate` (barber-
  // pole motion, see style.css) whenever there is no genuine percent to show
  // right now rather than rendering a bar that visually never moves.
  function setStatus(entry) {
    currentEntry = (entry && typeof entry === 'object') ? entry : null;
    statusEl.textContent = formatOneOffStatusText(entry) || '';
    const bar = computeOneOffProgressBar(entry);
    progressTrack.hidden = !bar.visible;
    if (bar.visible) {
      progressFill.style.setProperty('--p', String((bar.indeterminate ? 100 : bar.percent) / 100));
      progressFill.className = 'dl-status-chip-progress-fill' + (bar.indeterminate ? ' indeterminate' : '');
    }
    // v1.29.0 T6 (R1.4/AC3.4): visible ONLY while the entry is genuinely in
    // its error terminal state -- mirrors `chipItemLifecycle`'s/the chip
    // row's own `state === 'error'` gate (see `updateDownloadChipItemRow`),
    // so a fresh 'queued'/'downloading' entry (this SAME modal instance is
    // reused for a brand-new job after Retry/Download -- see
    // `injectOneOffDownloadButtonIfEnabled`'s wiring) always hides it again.
    retryBtn.hidden = !(entry && entry.state === 'error');
  }

  const sheet = U.sheet({
    variant: 'auto', title: 'One-off download', content: modal, initialFocus: urlInput,
    onClosing: () => { if (typeof h.onClose === 'function') h.onClose(); },
    doc: d, win: d.defaultView,
  });
  const closeBtn = sheet.el.querySelector('.ui-sheet__close');

  return { sheet, backdrop: sheet.scrim, modal, urlInput, formatSelect, qualitySelect, filetypeSelect, folderInput, downloadBtn, retryBtn, closeBtn, statusEl, progressTrack, progressFill, setStatus };
}

/**
 * v1.15.1 FIX 6 -- pure reducer for a TERMINAL live-status `entry`: decides
 * whether the modal should auto-close (and after how long) and whether a
 * library rescan+refresh should fire (see the BUG 2 fix note below -- as of
 * this fix, never). `'done'` closes the modal after a brief pause (so the
 * user sees the "Done" status line); `'error'` leaves the modal open (the
 * error stays visible). Any other input (including a non-terminal state,
 * reached defensively) takes no action. Exported/`node:test`-covered
 * directly, same posture as `shouldInjectOneOffButton`/
 * `formatOneOffStatusText` above.
 *
 * v1.29.0 T8: the modal itself no longer polls status at all -- a
 * SUCCESSFUL submit now minimizes it into the corner chip immediately (see
 * `submitOneOffDownload` below), and the chip owns all progress/terminal
 * handling for that job from then on. This reducer (and
 * `applyOneOffTerminalAction` below) are kept for their own regression
 * coverage and as a utility for any FUTURE caller that still needs this
 * exact close/rescan decision outside the minimized flow -- same posture as
 * `triggerLibraryRescanAndRefresh` below, which was already in this
 * "exported, not internally wired" state before T8.
 *
 * BUG 2 fix (regression): `'done'` no longer requests a `rescan` at all --
 * this used to trigger `triggerLibraryRescanAndRefresh()` (`POST /api/scan`
 * -> `window.location.reload()`), but the SERVER already rescans after
 * `runOneShot` completes (see the comment on `triggerLibraryRescanAndRefresh`
 * below), so that client-side rescan+reload was always redundant -- and,
 * under load, actively harmful: with many queued subscription downloads,
 * `POST /api/scan` returns a 409 (a scan is already running) near-instantly,
 * so `.then(reload)` fired immediately, and `window.location.reload()`
 * against an already-saturated server could hang mid-navigation. That froze
 * the whole page -- the "Done" modal stayed painted, its already-scheduled
 * auto-close timer never fired, and even the [x] button went inert -- with
 * no way out but a force-quit. `rescan` is always `false` now; `'error'`
 * never rescanned either. `close`/`closeDelayMs` are unchanged.
 */
function decideOneOffTerminalAction(entry) {
  if (entry && typeof entry === 'object' && entry.state === 'done') {
    return { close: true, closeDelayMs: 1200, rescan: false };
  }
  return { close: false, closeDelayMs: 0, rescan: false };
}

/**
 * BUG 2 fix -- applies a decided terminal `action` (see
 * `decideOneOffTerminalAction` above): closes the modal (via `closeFn`,
 * scheduled through `scheduleFn` after `action.closeDelayMs`) and, only if
 * `action.rescan` is true, runs a best-effort refresh (via `refreshFn`).
 * Its own small, injectable function (mirrors `buildOneOffModal`'s
 * `handlers` / `triggerLibraryRescanAndRefresh`'s `fetchImpl`/`reloadFn`
 * injection), so this ordering guarantee is directly `node:test`-covered
 * without a real DOM/timers: `closeFn` is invoked independently of
 * `refreshFn` -- never chained behind it -- so a
 * slow or hanging refresh can never again starve the modal's close (the
 * exact mechanism behind BUG 2, see `decideOneOffTerminalAction`'s comment).
 * `scheduleFn` defaults to `setTimeout`; `closeFn`/`refreshFn` default to
 * no-ops when omitted.
 */
function applyOneOffTerminalAction(action, closeFn, refreshFn, scheduleFn) {
  const doClose = typeof closeFn === 'function' ? closeFn : () => {};
  const doRefresh = typeof refreshFn === 'function' ? refreshFn : () => {};
  const schedule = typeof scheduleFn === 'function'
    ? scheduleFn
    : (typeof setTimeout !== 'undefined' ? setTimeout : (fn) => fn());
  if (!action) return;
  if (action.close) schedule(doClose, action.closeDelayMs || 0);
  if (action.rescan) doRefresh();
}

/**
 * v1.15.1 FIX 6 -- reuses the SAME `POST /api/scan` endpoint the home page's
 * "Rescan Files" button (`public/js/main.js`) calls, then refreshes via
 * `reloadFn` (a real `window.location.reload()` by default). Best-effort:
 * the SERVER already rescans after a one-off download completes
 * (`runOneShot` -> `scanDirectories`), so even if this client-triggered
 * request never resolves (a transient network hiccup), the library data is
 * already fresh server-side for the user's next visit. `fetchImpl`/
 * `reloadFn` are injectable (mirrors `buildOneOffModal`'s `doc`/`handlers`
 * injection) so this is directly `node:test`-covered without a real network
 * call or a real page reload.
 *
 * BUG 2 fix (regression): this is NO LONGER called from the modal's `'done'`
 * terminal path (`decideOneOffTerminalAction` now always returns
 * `rescan: false`) -- see that function's comment for the full root-cause
 * writeup of why a client-triggered `window.location.reload()` here could
 * freeze the whole page under load. The server-side rescan alone is
 * sufficient (the redundant client-side rescan added nothing), so this
 * function is kept only for its own regression coverage and as a utility
 * available to any FUTURE caller that genuinely needs a full-page refresh
 * outside the one-off modal's terminal flow -- it is not wired to anything
 * today.
 */
function triggerLibraryRescanAndRefresh(fetchImpl, reloadFn) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const doReload = reloadFn || (() => { if (typeof window !== 'undefined') window.location.reload(); });
  if (!doFetch) return;
  doFetch('/api/scan', { method: 'POST' })
    .catch(() => { /* best-effort -- the server already scanned after the one-off */ })
    .then(doReload);
}

// Idempotent (checks for the button/nav-entry's existence first) and
// defensive -- a page missing `.header-right` and/or the bottom-nav Settings
// item simply skips whichever entry point it doesn't have, never throwing.
// Mirrors `injectSubscriptionsNavLinkIfEnabled`'s gating exactly: every entry
// point is ONLY ever created after a genuine 2xx from
// `/api/subscriptions/health`; a 404 (module disabled) or a network failure
// means this function creates nothing at all -- the header/bottom-nav stay
// byte-identical to a disabled install (AC3.3/ACX.1).
// ---- v1.82: the account menu ------------------------------------------------
//
// An avatar (the user's uploaded photo, else a deterministic initials monogram
// via deriveAvatar) in `.header-right` on every shared-header shell, opening a
// dropdown: account (name + role), Change photo, Liked, History, Settings, a
// light/dark Theme toggle, and Sign out. It consolidates the old header Settings
// link + theme toggle (removed in T3). Injected once per shell (a re-run no-ops
// on the id guard); reads the memoized /api/auth/me, and a signed-out shell
// (login/welcome, where /api/auth/me is 401) injects nothing.

// Shared sign-out (also used by the Settings page's button): drop the per-user
// capability cache so the next login in this tab can't paint the previous user's
// pinned channels for a frame (the v1.53 W4 scar), then land on /login.
function accountSignOut() {
  const done = () => {
    try { sessionStorage.removeItem('ft-cap-cache-v1'); } catch (_) { /* storage disabled */ }
    // v1.99: the modern avatar-bar last-known count is per-DEVICE (localStorage,
    // shared across users on one browser). Drop it on sign-out so the NEXT user
    // to log in on this browser doesn't reserve THIS user's avatar-strip and see
    // it collapse when their own /api/channels returns fewer/none (the reverse-
    // shift the gate flagged). Mirrors main.js's MODERN_AVATARBAR_COUNT_KEY.
    try { localStorage.removeItem('ft-modern-avatarbar-count'); } catch (_) { /* storage disabled */ }
    // v1.101: the notification-bell reserve flag is per-device too - drop it so
    // the next user doesn't reserve a bell slot this instance/user had enabled.
    try { localStorage.removeItem('ft-notif-bell-enabled'); } catch (_) { /* storage disabled */ }
    // v1.158: the admin-reserve flag is per-device too - drop it so the next
    // user (e.g. a non-admin on a shared device) never reserves an admin
    // shimmer slot the master-detail nav would strand.
    try { localStorage.removeItem('ft-is-admin'); } catch (_) { /* storage disabled */ }
    // v1.339 (L2): the per-user pre-paint reserves (the queue button, the bottom bar's
    // last layout - it carries the You tab - and the books Continue shelf size) go too.
    try { localStorage.removeItem('ft-queue-shown'); } catch (_) { /* storage disabled */ }
    try { localStorage.removeItem('ft-bottomnav-last'); } catch (_) { /* storage disabled */ }
    try { localStorage.removeItem('ft-books-continue-count'); } catch (_) { /* storage disabled */ }
    // v1.356 (R7): the phone's remembered speaker (remote.js RESUME_KEY) and the per-tab pick (CONTROL_KEY) are
    // this user's; the next one starts local.
    try { localStorage.removeItem('ft-remote-resume'); } catch (_) { /* storage disabled */ }
    try { sessionStorage.removeItem('ft-remote-controlling'); } catch (_) { /* storage disabled */ }
    window.location.href = '/login';
  };
  // v1.356 gate r1 (S1 = Q1 = A1, A2): let go of a speaker before the logout request and every removal in
  // done(), so the unload's hide / pagehide have nothing to remember (while attached they re-stamp the phone's
  // remembered speaker) and the per-tab pick goes too (the next user in this tab once saw "Lost <this user's
  // speaker>"). leave() sends nothing.
  try {
    const rc = window.FileTube && window.FileTube.remoteControl;
    if (rc && typeof rc.leave === 'function') rc.leave();
  } catch (_) { /* no remote control on this shell */ }
  fetch('/api/auth/logout', { method: 'POST' }).then(done, done);
}

// The avatar visual: the uploaded photo (cache-busted by its mtime version) when
// present, else the initials monogram + deterministic palette colour. `big` is
// the larger variant shown in the dropdown header.
// Sweep S1 (D4.4): a ui-avatar (chromeAvatarEl -> ui.avatar), sized by the surface: `size`
// is a D2.3 avatar size ('xs' the You tab's 24px icon slot, 'sm' the header trigger, 'lg'
// the account menu's head); a legacy `true` means the menu head. The monogram is the
// primitive's initials on a name-hashed tone, and a failed photo becomes that monogram.
function buildAccountAvatarEl(user, size) {
  const sz = size === true ? 'lg' : (typeof size === 'string' ? size : 'sm');
  const avatar = user && user.avatar;
  const url = avatar && avatar.present ? `/api/users/${user.id}/avatar?v=${avatar.version || 0}` : null;
  const el = chromeAvatarEl((user && (user.displayName || user.username)) || '', url, sz);
  el.classList.add('account-avatar');
  const img = el.querySelector('img');
  if (img) {
    // v1.157.1 (Dean device report): the "You" avatar painted an EMPTY disc until the
    // photo loaded+decoded ("empty then fills"). The disc shimmers as a placeholder and
    // the <img> reveals only once it has loaded (style.css keeps it opacity:0 until
    // .is-loaded); on a load error the primitive swaps in the monogram, and the shimmer
    // clears either way, so the disc is never left blank.
    el.classList.add('skeleton-shimmer');
    img.addEventListener('load', () => {
      el.classList.remove('skeleton-shimmer');
      img.classList.add('is-loaded');
    }, { once: true });
    img.addEventListener('error', () => { el.classList.remove('skeleton-shimmer'); }, { once: true });
  }
  return el;
}

// v1.90: the running app version, read from the server-stamped
// <meta name="ft-version"> (injectVersionMeta, server.js). Returns '' when
// absent (a non-templated shell / jsdom without the meta) so callers can skip
// the footer rather than render "vundefined". Exported for node:test.
function appVersionString() {
  if (typeof document === 'undefined') return '';
  const m = document.querySelector('meta[name="ft-version"]');
  const v = m && m.getAttribute('content');
  return (typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v)) ? v : '';
}

// v1.144 (Dean): the release-notes link for a running version - the GitHub
// release page for that build's tag, published from docs/releases.json by
// scripts/sync-github-releases.js (see docs/RELEASING.md). Pure + bounded
// (a malformed version yields null, never a garbage URL); exported for
// node:test.
function releaseNotesUrl(version) {
  return /^\d+\.\d+\.\d+$/.test(String(version || ''))
    ? `https://github.com/dtammam/filetube/releases/tag/v${version}`
    : null;
}

// v1.158 (Dean): format the account-menu "total on disk" figure. A byte-exact
// copy of stats.js's formatByteSize (common.js loads on every shell; stats.js
// does not) so the You-menu string matches the Stats "Total size on disk" tile
// character-for-character. account-menu.test.js locks the two outputs equal.
function formatDiskBytes(bytes) {
  const value = (typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0) ? bytes : 0;
  if (value === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(k)), units.length - 1);
  return `${parseFloat((value / Math.pow(k, exponent)).toFixed(1))} ${units[exponent]}`;
}

// v1.305 (Dean): the account-menu "N items in trash" footer label. Dean's
// spelling: only ONE is singular ("1 item in trash"); everything else - INCLUDING
// zero - is "items" ("0 items in trash", "2 items in trash"). Pure + bounded (a
// non-finite/negative count floors to 0), exported for node:test.
// v1.306 (Dean): append the reclaimable size as a parenthetical - "(X GB)" - so
// the row shows BOTH how many items can be emptied AND how much disk that frees,
// matching the Settings > Trash toolbar. Uses formatDiskBytes (defined above, the
// same formatter the adjacent "on disk" footer row uses, so the two read alike).
// The size arg is optional: absent/zero/junk bytes -> no parenthetical (never a
// bare "(0 B)"), so a single-arg call is byte-identical to the v1.305 label.
function formatTrashCountLabel(count, totalSizeBytes) {
  const n = (typeof count === 'number' && Number.isFinite(count) && count >= 0) ? Math.floor(count) : 0;
  const noun = n === 1 ? '1 item in trash' : n + ' items in trash';
  const bytes = (typeof totalSizeBytes === 'number' && Number.isFinite(totalSizeBytes) && totalSizeBytes > 0) ? totalSizeBytes : 0;
  return bytes > 0 ? noun + ' (' + formatDiskBytes(bytes) + ')' : noun;
}

// Sweep S1 (D4.6): one account-menu row - a compact ui-row with the glyph in its media
// slot; a link row when `href`, a button row when `onClick`. `account-menu-item` is the
// row's hook (tests, the Subscriptions late-insert), never a styled family.
function accountMenuRow(U, o) {
  const row = U.row({ size: 'compact', media: U.icon(o.icon, { doc: document }), title: o.label,
    href: o.href, onClick: o.onClick, doc: document });
  row.classList.add('account-menu-item');
  row.setAttribute('role', 'menuitem');
  return row;
}

// v1.230 (Dean): the "Music skin" picker was briefly here (v1.229), but the account
// menu builds ONCE at boot and only some shells loaded the skins module, so the row
// often never appeared. It moved to the Settings page (setup.js renderMusicSkinPicker,
// where the app's Settings pickers live and the skins module is loaded on
// every shell). Nothing account-menu remains for it.

// ---- v1.83: avatar crop geometry (pure, DOM-free, unit-tested) --------------
//
// The crop viewport is W x H display px with a centred circle of diameter D. The
// source image (natural imgW x imgH) is drawn at scale `s` with its top-left at
// display offset (ox, oy). These three pure functions are the whole contract the
// gesture layer and the canvas export depend on; everything that can be WRONG
// (a gap inside the circle, an out-of-bounds source read) lives here where
// node:test can hold it without a browser.

// The COVER minimum: the smallest scale at which the image still fills the
// circle's DxD bounding box (no gap can ever show). Cover needs imgW*s >= D AND
// imgH*s >= D, i.e. s >= D / min(imgW, imgH).
function avatarMinScale(imgW, imgH, D) {
  const m = Math.min(imgW, imgH);
  return m > 0 ? D / m : 1;
}

// Clamp (ox, oy) so the scaled image always covers the circle's bounding box
// [(W-D)/2 .. (W+D)/2] x [(H-D)/2 .. (H+D)/2]. Assumes s >= avatarMinScale so the
// range is non-empty. Returns the clamped { ox, oy }.
function clampAvatarOffset(ox, oy, s, imgW, imgH, W, H, D) {
  const oxMax = (W - D) / 2;              // left edge no further right than circle-left
  const oxMin = (W + D) / 2 - imgW * s;   // right edge no further left than circle-right
  const oyMax = (H - D) / 2;
  const oyMin = (H + D) / 2 - imgH * s;
  return {
    ox: Math.min(oxMax, Math.max(oxMin, ox)),
    oy: Math.min(oyMax, Math.max(oyMin, oy)),
  };
}

// The source-image rectangle currently under the circle's bounding box - exactly
// what drawImage copies into the square output canvas. Square by construction
// (the circle's bounding box is DxD). Never reads outside the image when the
// offset is clamped (the caller's contract).
function avatarSourceRect(s, ox, oy, W, H, D) {
  const boxLeft = (W - D) / 2;
  const boxTop = (H - D) / 2;
  return {
    sx: (boxLeft - ox) / s,
    sy: (boxTop - oy) / s,
    sSize: D / s,
  };
}

// v1.83: the crop modal. Resolves a cropped 400x400 JPEG Blob on Save, the
// ORIGINAL file as a graceful fallback when canvas export is unavailable (AC6),
// or null on Cancel. Both avatar entry points (the menu + Settings) call this
// before uploading, so a raw file is never uploaded on the happy path. The
// canvas is a fixed 280x280 (1:1 with its CSS box) so pointer deltas map
// straight to canvas px - the pan/zoom math stays the pure T1 geometry.
// Sweep S9: one cropper at a time - claimed when a crop starts, released on every way out.
// (It was a DOM query for the old backdrop, which a second call made before the first
// image loaded could not see.)
let avatarCropOpen = false;

function cropAvatarFile(file) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !file) { resolve(file || null); return; }
    const probe = document.createElement('canvas');
    const probeCtx = probe.getContext && probe.getContext('2d');
    if (!probeCtx || typeof probe.toBlob !== 'function' || typeof URL === 'undefined' || !URL.createObjectURL || typeof Image === 'undefined') {
      resolve(file); return; // no real canvas 2d export -> upload raw, the server cap applies
    }
    // Single-instance: never stack two croppers (a second Escape would settle
    // both). If one is already open (or loading its image), decline this one as a cancel.
    if (avatarCropOpen) { resolve(null); return; }
    const U = overlayUiLib();
    if (!U) { resolve(file); return; }
    avatarCropOpen = true;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { avatarCropOpen = false; try { URL.revokeObjectURL(url); } catch (_) {} resolve(file); }; // not an image -> let the server reject
    img.onload = () => {
      const imgW = img.naturalWidth, imgH = img.naturalHeight;
      if (!imgW || !imgH) { avatarCropOpen = false; try { URL.revokeObjectURL(url); } catch (_) {} resolve(file); return; }

      const W = 280, H = 280, D = 232, OUTPUT = 400; // viewport, circle, export size
      const minScale = avatarMinScale(imgW, imgH, D);
      const maxScale = minScale * 5;
      let s = minScale;
      let ox = (W - imgW * s) / 2, oy = (H - imgH * s) / 2;
      const clamp = () => { const c = clampAvatarOffset(ox, oy, s, imgW, imgH, W, H, D); ox = c.ox; oy = c.oy; };
      clamp();

      // Sweep S9: the dialog is a ui.sheet titled "Crop photo"; `modal` is its content.
      const modal = document.createElement('div');
      modal.className = 'avatar-crop';
      const hint = document.createElement('div');
      hint.className = 'avatar-crop-hint';
      hint.textContent = 'Drag to move, pinch or scroll to zoom.';
      const stage = document.createElement('div');
      stage.className = 'avatar-crop-stage';
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      canvas.className = 'avatar-crop-canvas';
      const ring = document.createElement('div');
      ring.className = 'avatar-crop-ring'; // circular frame; box-shadow dims outside
      stage.appendChild(canvas);
      stage.appendChild(ring);
      const ctx = canvas.getContext('2d');
      const redraw = () => { ctx.clearRect(0, 0, W, H); ctx.drawImage(img, ox, oy, imgW * s, imgH * s); };
      redraw();

      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.value = '0';
      slider.className = 'avatar-crop-zoom';
      slider.setAttribute('aria-label', 'Zoom');
      const syncSlider = () => {
        slider.value = maxScale > minScale ? String(Math.round(((s - minScale) / (maxScale - minScale)) * 1000)) : '0';
      };
      // Zoom to a target scale, keeping display point (px,py) fixed under the cursor/pinch.
      const zoomTo = (ns, px, py) => {
        const clamped = Math.min(maxScale, Math.max(minScale, ns));
        const srcX = (px - ox) / s, srcY = (py - oy) / s;
        s = clamped;
        ox = px - srcX * s; oy = py - srcY * s;
        clamp(); redraw(); syncSlider();
      };
      slider.addEventListener('input', () => {
        const frac = Number(slider.value) / 1000;
        zoomTo(minScale + frac * (maxScale - minScale), W / 2, H / 2);
      });

      // Pointer pan (1 pointer) + pinch zoom (2 pointers). Fixed-size canvas, so
      // client deltas are canvas px.
      const pointers = new Map();
      let pinchDist = 0;
      const canvasPt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      canvas.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        const prev = pointers.get(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size >= 2) {
          const [a, b] = [...pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinchDist > 0 && dist > 0) {
            const r = canvas.getBoundingClientRect();
            zoomTo(s * (dist / pinchDist), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
          }
          pinchDist = dist;
        } else {
          ox += (e.clientX - prev.x); oy += (e.clientY - prev.y);
          clamp(); redraw();
        }
      });
      const endPointer = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchDist = 0; };
      canvas.addEventListener('pointerup', endPointer);
      canvas.addEventListener('pointercancel', endPointer);
      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = canvasPt(e);
        zoomTo(s * (e.deltaY < 0 ? 1.1 : 0.9), p.x, p.y);
      }, { passive: false });

      const actions = document.createElement('div');
      actions.className = 'ui-confirm__actions avatar-crop-actions';
      const cancelBtn = U.button({ variant: 'secondary', label: 'Cancel', doc: document });
      const saveBtn = U.button({ variant: 'primary', label: 'Save', doc: document });
      actions.appendChild(cancelBtn); actions.appendChild(saveBtn);

      let settled = false;
      let sheet = null;
      // The sheet restores focus to the opener (the "Change photo" / "Upload" control) itself.
      const cleanup = () => {
        avatarCropOpen = false;
        try { URL.revokeObjectURL(url); } catch (_) {}
        document.removeEventListener('keydown', onKey);
        if (sheet) sheet.close();
      };
      const finish = (value) => { if (settled) return; settled = true; cleanup(); resolve(value); };
      const doSave = () => {
        try {
          const out = document.createElement('canvas');
          out.width = OUTPUT; out.height = OUTPUT;
          const octx = out.getContext('2d');
          const rect = avatarSourceRect(s, ox, oy, W, H, D);
          octx.drawImage(img, rect.sx, rect.sy, rect.sSize, rect.sSize, 0, 0, OUTPUT, OUTPUT);
          out.toBlob((blob) => finish(blob || file), 'image/jpeg', 0.9);
        } catch (_) {
          finish(file); // export failed -> fall back to the raw upload
        }
      };
      // Escape, the scrim and Close cancel (the sheet's own dismissals, answered through
      // onClosing below); Tab is trapped within the dialog's controls (Close -> slider ->
      // Cancel -> Save -> Close) so focus never escapes to the page behind the scrim.
      const onKey = (e) => {
        if (e.key !== 'Tab') return;
        const sheetClose = sheet && sheet.el.querySelector('.ui-sheet__close');
        const focusables = [sheetClose, slider, cancelBtn, saveBtn].filter(Boolean);
        const idx = focusables.indexOf(document.activeElement);
        if (idx === -1) { e.preventDefault(); slider.focus(); }
        else if (e.shiftKey && idx === 0) { e.preventDefault(); saveBtn.focus(); }
        else if (!e.shiftKey && idx === focusables.length - 1) { e.preventDefault(); slider.focus(); }
      };
      cancelBtn.addEventListener('click', () => finish(null));
      saveBtn.addEventListener('click', doSave);
      document.addEventListener('keydown', onKey);

      modal.appendChild(stage);
      modal.appendChild(slider);
      modal.appendChild(hint);
      modal.appendChild(actions);
      sheet = U.sheet({
        variant: 'dialog', title: 'Crop photo', content: modal, initialFocus: saveBtn,
        onClosing: () => finish(null), // Esc / scrim / Close: a cancel, settled once
        doc: document,
      });
      sheet.open();
      syncSlider();
    };
    img.src = url;
  });
}

// ---- v1.85 #1: mobile search + deletable, per-user recent-search history ----
//
// The magnifier (mobile top-right, injected into .header-right beside the bell +
// avatar) opens search: it reveals the field (hidden by default on mobile - the
// YouTube-app pattern) and shows the user's recent searches, each individually
// deletable, plus a clear-all. Terms are recorded on every search and synced
// per-user (GET/POST/DELETE /api/search-history), so history follows the
// account. Desktop keeps its always-on search bar; the magnifier + panel are
// mobile-only via CSS.

// Best-effort record - never blocks the search navigation.
function recordSearchTerm(term) {
  if (typeof fetch !== 'function') return;
  const t = typeof term === 'string' ? term.trim() : '';
  if (!t) return;
  try {
    fetch('/api/search-history', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term: t }),
    }).catch(() => { /* best-effort - the local search already happened */ });
  } catch (_) { /* fetch unavailable (old browser/tests) */ }
}

// Render the recent-search rows into `panel` as DOM (textContent, so a user's
// own '<script>'-shaped search term can never self-XSS on replay). Each row: the
// term (click -> onSearch), an x (delete one), and a clear-all footer. Exported
// so the DOM + the delete/clear wiring are jsdom-bound, not source-asserted.
function renderSearchHistoryPanel(panel, terms, onSearch) {
  if (!panel) return;
  panel.textContent = '';
  const list = Array.isArray(terms) ? terms : [];
  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'search-history-empty';
    empty.textContent = 'No recent searches';
    panel.appendChild(empty);
    return;
  }
  // Sweep S1: a compact ui-list - the history glyph in the media column, the term as the
  // row's (stretched) button, one reserved action column for its remove X (a plain ui-btn
  // icon button, never a text glyph) - and a plain "Clear all" button under it.
  const span = (cls) => { const n = document.createElement('span'); n.className = cls; return n; };
  const rows = document.createElement('div');
  rows.className = 'ui-list ui-list--compact ui-list--media-avatar ui-list--aside-none ui-list--actions-1 ui-list--divider-none search-history-list';
  rows.setAttribute('role', 'list');
  rows.setAttribute('aria-label', 'Recent searches');
  for (const term of list) {
    const row = document.createElement('div');
    row.className = 'ui-row ui-row--compact search-history-row';
    row.setAttribute('role', 'listitem');
    row.appendChild(span('ui-row__lead'));
    const media = span('ui-row__media');
    const glyph = uiIconEl('history', 'md');
    if (glyph) media.appendChild(glyph);
    row.appendChild(media);
    const body = span('ui-row__body');
    const title = span('ui-row__title');
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'ui-row__link search-history-term';
    const label = document.createElement('span');
    label.textContent = term;
    pick.appendChild(label);
    pick.addEventListener('click', () => { if (typeof onSearch === 'function') onSearch(term); });
    title.appendChild(pick);
    body.appendChild(title);
    row.appendChild(body);
    row.appendChild(span('ui-row__aside'));
    const acts = span('ui-row__actions');
    const del = chromeButtonEl({ cls: 'search-history-del', icon: 'close', ariaLabel: 'Remove ' + term + ' from recent searches' });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof fetch === 'function') fetch('/api/search-history/' + encodeURIComponent(term), { method: 'DELETE' }).catch(() => {});
      row.remove();
      if (!rows.querySelector('.search-history-row')) renderSearchHistoryPanel(panel, [], onSearch);
    });
    acts.appendChild(del);
    row.appendChild(acts);
    rows.appendChild(row);
  }
  panel.appendChild(rows);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'ui-btn ui-btn--plain ui-btn--sm search-history-clear';
  const clearLabel = document.createElement('span');
  clearLabel.className = 'ui-btn__label';
  clearLabel.textContent = 'Clear all';
  clear.appendChild(clearLabel);
  clear.addEventListener('click', () => {
    if (typeof fetch === 'function') fetch('/api/search-history', { method: 'DELETE' }).catch(() => {});
    renderSearchHistoryPanel(panel, [], onSearch);
  });
  panel.appendChild(clear);
}

// Inject the magnifier + wire the open/close + the history panel. Idempotent;
// no-op on a signed-out shell (no .header-right) or a shell without search.
function wireSearchAffordances() {
  if (typeof document === 'undefined') return;
  const headerRight = document.querySelector('.header-right');
  const searchInput = document.getElementById('search-input');
  if (!headerRight || !searchInput || document.getElementById('search-toggle-btn')) return;

  // v1.87.1 (Dean): an inline <svg>, not an `.icon-search` mask - a mask shows nothing
  // until it decodes, so it "popped in" after the label on a mobile cold start. Sweep S1
  // (F31): a plain ui-btn icon button (44px on the phone, where it shows).
  const btn = chromeButtonEl({ cls: 'search-toggle-btn', icon: CHROME_ICON.search, ariaLabel: 'Search' });
  btn.id = 'search-toggle-btn';
  // v1.339 (L2): take the pre-paint reserve's place (same box) when the shell painted one.
  const searchReserve = chromeReserveEl(headerRight, 'search');
  if (searchReserve) searchReserve.replaceWith(btn);
  else headerRight.appendChild(btn);

  let panel = document.getElementById('search-history-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'search-history-panel';
    panel.className = 'search-history-panel';
    const host = document.querySelector('.header-search') || searchInput.parentElement;
    if (host) host.appendChild(panel);
  }

  function closeSearch() { document.documentElement.classList.remove('search-open'); }
  function loadHistory() {
    if (typeof fetch !== 'function') return;
    fetch('/api/search-history')
      .then((r) => (r.ok ? r.json() : { terms: [] }))
      .then((d) => renderSearchHistoryPanel(panel, d && d.terms, onSearch))
      .catch(() => { /* offline: no panel, the field still works */ });
  }
  function onSearch(term) {
    searchInput.value = term;
    closeSearch();
    const url = `/?search=${encodeURIComponent(term)}`;
    if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(url);
    else window.location.href = url;
    recordSearchTerm(term);
  }

  btn.addEventListener('click', () => {
    if (document.documentElement.classList.contains('search-open')) { closeSearch(); return; }
    document.documentElement.classList.add('search-open');
    searchInput.focus();
    loadHistory();
  });
  searchInput.addEventListener('focus', loadHistory);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
  // v1.209 (Dean): tapping OUTSIDE the open search - and having typed nothing -
  // dismisses it, so changing your mind (e.g. tapping the home logo top-left)
  // no longer needs a second press of the search button. pointerdown (not
  // click), the iOS tap-outside rule (a click can be swallowed/delayed), and it
  // fires BEFORE the target's own click, so the outside control (the home logo)
  // still activates. A NON-empty box is left open - a typed query is never
  // discarded by an accidental tap-away. Bound once (the idempotency guard above
  // returns before here on a re-call), like the Escape handler; a bubble-phase
  // pointerdown taxes no scroll (unlike a non-passive touchmove, v1.160.1).
  document.addEventListener('pointerdown', (e) => {
    if (!document.documentElement.classList.contains('search-open')) return;
    if (searchInput.value.trim() !== '') return; // typed -> keep it open
    const t = e.target;
    // duck-type on closest() (robust without the Element global); a tap inside
    // the input / toggle / history panel / search host is NOT "outside".
    if (t && typeof t.closest === 'function' && t.closest('#search-input, #search-toggle-btn, #search-history-panel, .header-search')) return;
    closeSearch();
  });
}

// ---- v1.85 #2: the mobile "You" bottom-nav tab -----------------------------
//
// A bottom-nav item carrying the user's avatar + "You" label that opens the
// SAME v1.82 account menu (by dispatching a click on its header trigger - which
// works even when that trigger is display:none on mobile). Injected with
// data-nav="you" but DELIBERATELY NOT added to BOTTOM_NAV_OPTIONAL: the layout
// resolver ranks a roster-absent id after every ROSTER item (so it sits at the
// right end - the YouTube-app slot; the one exception is if the user opts the
// COMPAT_TAIL 'settings' into the bar, which pins after it, putting You just
// before Settings). The real hide/reorder protection is the SETTINGS CUSTOMIZER,
// which lists only the roster - so its UI can never hide or move You. (A
// hand-edited localStorage ft-bottomnav COULD still hide it - the same tolerated
// class as the v1.75 R2 hand-edited-config residual - recoverable on desktop or
// by clearing storage.) Mobile-only (the bottom nav itself is); desktop keeps
// the header avatar (which this hides only on mobile, via CSS).
function injectYouNavItem() {
  if (typeof document === 'undefined' || typeof fetch !== 'function') return;
  const nav = document.getElementById('bottom-nav');
  if (!nav || nav.querySelector('[data-nav="you"]')) return;
  // v1.339 (L2): the shells' pre-paint block reserves the tab (from the bar's remembered
  // layout, ft-bottomnav-last) so the bar never re-spaces when it lands; the real tab
  // takes the reserve's place, and every no-tab exit drops it.
  const dropReserve = () => { const r = chromeReserveEl(nav, 'you'); if (r) { r.remove(); applyBottomNavCustomization(); } };
  fetchCurrentUser().then((me) => {
    if (!me || !me.user) { dropReserve(); return; } // signed-out shell: no You tab
    if (nav.querySelector('[data-nav="you"]')) { dropReserve(); return; } // race guard
    // Sweep S1 (F49): the avatar sits in the SAME fixed 24px icon slot as every other
    // tab's glyph, so "You" no longer sits lower than the other labels.
    const avatar = buildAccountAvatarEl(me.user, 'xs');
    avatar.classList.add('bottom-nav-you-avatar');
    const btn = bottomNavItemEl({ tag: 'button', nav: 'you', slotEl: avatar, label: 'You', ariaLabel: 'You (account menu)' });
    btn.addEventListener('click', (e) => {
      // v1.85.1: STOP this click bubbling to document. The account menu closes on
      // any document click (outside-click-to-dismiss); without this, our own
      // click reaches document right AFTER trigger.click() opens the menu and
      // closes it again - the tab appeared dead (v1.85 device-pass failure).
      e.stopPropagation();
      // Look the trigger up at CLICK time (injectAccountMenu is async).
      const trigger = document.querySelector('.account-menu-trigger');
      if (trigger) trigger.click();
    });
    const youReserve = chromeReserveEl(nav, 'you');
    if (youReserve) youReserve.replaceWith(btn);
    else nav.appendChild(btn);
    applyBottomNavCustomization(); // ranks the roster-absent 'you' right-most
  }).catch(() => { dropReserve(); /* signed-out / offline: no You tab, nothing broken */ });
}

function injectAccountMenu() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  const headerRight = document.querySelector('.header-right');
  if (!headerRight || document.getElementById('account-menu-root')) return;

  // v1.101 shimmer sweep: RESERVE the avatar slot with a shimmer placeholder BEFORE the
  // /api/auth/me fetch, so the account avatar reveals in place instead of popping into an
  // empty header. It is the real trigger's box (sweep S1: a plain ui-btn icon button
  // holding a 28px ui-avatar), so it is zero-shift AND inherits the same mobile
  // `.account-menu-trigger { display:none }` hide the real trigger has (mobile reaches the
  // account via the You tab). Removed on resolve (signed-in -> real menu; signed-out /
  // error -> just gone, never a stranded shimmer).
  if (!document.getElementById('account-menu-placeholder')) {
    // v1.339 (L2): an `.account-menu` wrapper around the trigger-shaped disc, like the real
    // root - so on mobile (trigger display:none) it still takes the row's slot. The shells'
    // inline pre-paint block paints this same shape, so this copy only runs without it.
    const ph = document.createElement('span');
    ph.id = 'account-menu-placeholder';
    ph.className = 'account-menu';
    ph.setAttribute('aria-hidden', 'true');
    const phTrigger = document.createElement('span');
    phTrigger.className = 'ui-btn ui-btn--plain ui-btn--md ui-btn--icon account-menu-trigger';
    const avatarSkel = document.createElement('span');
    avatarSkel.className = 'ui-avatar ui-avatar--sm account-avatar skeleton-shimmer';
    phTrigger.appendChild(avatarSkel);
    ph.appendChild(phTrigger);
    headerRight.appendChild(ph);
  }

  fetchCurrentUser().then((me) => {
    const ph = document.getElementById('account-menu-placeholder');
    // reveal-once: the reserve goes on every exit - signed-out / overlap -> just gone;
    // signed-in -> the real menu takes its exact place below (v1.339 L2: replaceWith, so
    // a Download button that landed after the placeholder stays left of the avatar).
    if (!me || !me.user || document.getElementById('account-menu-root')) { if (ph) ph.remove(); return; } // signed-out shell / the overlap guard
    const user = me.user;

    const root = document.createElement('div');
    root.className = 'account-menu';
    root.id = 'account-menu-root';

    // Sweep S1 (F31, D4.4): the trigger is a plain ui-btn icon button (36px desktop, a
    // 44px hit area) holding the 28px ui-avatar.
    let triggerAvatar = buildAccountAvatarEl(user, 'sm');
    const trigger = chromeButtonEl({ cls: 'account-menu-trigger', media: triggerAvatar, ariaLabel: 'Account menu' });
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.title = user.displayName || user.username || 'Account';
    root.appendChild(trigger);

    // Change photo: a hidden file input driven by the pencil badge on the menu's avatar.
    // On pick, crop, upload to /api/me/avatar and re-render BOTH avatars on success. It
    // lives on the root (not in the sheet), so it survives the sheet's close.
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp';
    fileInput.hidden = true;
    root.appendChild(fileInput);
    let headAvatar = null;
    let avatarWrap = null;
    const refreshAvatars = (avatarInfo) => {
      user.avatar = avatarInfo;
      const t2 = buildAccountAvatarEl(user, 'sm');
      trigger.replaceChild(t2, triggerAvatar);
      triggerAvatar = t2;
      if (avatarWrap && headAvatar) {
        const h2 = buildAccountAvatarEl(user, 'xl');
        avatarWrap.replaceChild(h2, headAvatar); // swap the disc only; the pencil badge stays
        headAvatar = h2;
      }
    };
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = ''; // allow re-picking the same file later
      if (!file) return;
      // v1.83: crop + downscale first (so any source size works); a null result
      // means the user cancelled.
      const cropped = await cropAvatarFile(file);
      if (!cropped) return;
      try {
        const res = await fetch('/api/me/avatar', { method: 'POST', headers: { 'Content-Type': cropped.type || 'image/jpeg' }, body: cropped });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(body.error || 'Could not update your photo.'); return; }
        refreshAvatars(body.avatar);
        showToast('Photo updated.');
      } catch (_) {
        showToast('Could not update your photo (network error).');
      }
    });

    // ---- the menu (sweep S1, D4.6): a ui.sheet - a popover anchored under the trigger on
    // desktop, a bottom sheet on the phone - of ui-rows: selected/current never red, the
    // theme row's glyph shows the mode a tap switches TO. Built on the FIRST open (ui.js
    // is loaded by then on every shell; the build-time Subscriptions gate therefore sees
    // the module's nav marker whenever the /health probe has resolved).
    let sheet = null;
    let panel = null;
    let diskLoaded = false;
    let trashLoaded = false;
    let diskRow = null; let diskLabel = null;
    let trashRow = null; let trashLabel = null;

    const buildPanel = (U) => {
      const p = document.createElement('div');
      p.className = 'account-menu-panel';
      p.setAttribute('role', 'menu');

      // Header: the large avatar (with the v1.305 pencil BADGE on the disc - the old
      // "Change photo" ROW felt derpy, Dean) + name + role. The wrapper holds the disc and
      // the badge so refreshAvatars swaps ONLY the disc.
      const head = document.createElement('div');
      head.className = 'account-menu-head';
      avatarWrap = document.createElement('div');
      avatarWrap.className = 'account-menu-avatar-wrap';
      headAvatar = buildAccountAvatarEl(user, 'xl');
      avatarWrap.appendChild(headAvatar);
      const editAvatar = U.button({ variant: 'tonal', size: 'sm', shape: 'icon', icon: 'edit', ariaLabel: 'Change photo', doc: document });
      editAvatar.classList.add('account-menu-avatar-edit');
      editAvatar.title = 'Change photo';
      editAvatar.addEventListener('click', () => fileInput.click());
      avatarWrap.appendChild(editAvatar);
      head.appendChild(avatarWrap);
      const who = document.createElement('div');
      who.className = 'account-menu-who';
      const nameEl = document.createElement('div');
      nameEl.className = 'account-menu-name';
      nameEl.textContent = user.displayName || user.username || 'Account';
      const roleEl = document.createElement('div');
      roleEl.className = 'account-menu-role';
      roleEl.textContent = user.role === 'admin' ? 'Admin' : 'Member';
      who.appendChild(nameEl);
      who.appendChild(roleEl);
      head.appendChild(who);
      p.appendChild(head);

      // Quick links to the library pages (v1.153: this "You" menu is mobile's main way
      // into these pages - the sidebar is a drawer there - so Stats + Subscriptions join
      // it). Subscriptions only when the optional yt-dlp module is enabled - gated by the
      // presence of its nav entry (the signal the sidebar/bottom-nav links use); a late
      // /health answer adds it through ensureAccountMenuSubscriptionsRow.
      const links = U.list({ size: 'compact', media: 'avatar', label: 'Account', doc: document });
      links.classList.add('account-menu-links');
      accountMenuLinksEl = links;
      links.appendChild(accountMenuRow(U, { href: '/?liked=1', icon: 'favorite', label: 'Liked' }));
      links.appendChild(accountMenuRow(U, { href: '/?watchlater=1', icon: 'schedule', label: 'Watch later' }));
      links.appendChild(accountMenuRow(U, { href: '/history', icon: 'history', label: 'History' }));
      links.appendChild(accountMenuRow(U, { href: '/stats.html', icon: 'bar_chart', label: 'Stats' }));
      // v1.342: Clean up moves things to Trash, so it is offered only to accounts that can edit the library.
      if (user.role === 'admin' || user.canModifyLibrary) {
        links.appendChild(accountMenuRow(U, { href: '/cleanup', icon: 'delete', label: 'Clean up' }));
      }
      if (document.querySelector('[data-nav="subscriptions"], [data-nav-sidebar="subscriptions"]')) {
        links.appendChild(accountMenuRow(U, { href: '/subscriptions', icon: 'subscriptions', label: 'Subscriptions' }));
      }
      // v1.97.1 (Dean): the feed-hidden RESTORE surface lives on the settings page.
      links.appendChild(accountMenuRow(U, { href: '/setup.html', icon: 'settings', label: 'Settings' }));
      // Theme: light/dark. The glyph reflects the mode a tap switches TO and updates on
      // toggle (updateAccountMenuThemeItem, called from applyTheme) - tagged by id. The
      // menu stays open on a toggle (the old dropdown's behaviour).
      const theme = accountMenuRow(U, { icon: 'dark_mode', label: 'Theme', onClick: () => toggleTheme() });
      const themeIcon = theme.querySelector('.ui-row__media .ui-icon');
      if (themeIcon) themeIcon.id = 'account-menu-theme-icon';
      links.appendChild(theme);
      const signOut = accountMenuRow(U, { icon: 'logout', label: 'Sign out', onClick: () => accountSignOut() });
      signOut.classList.add('account-menu-signout');
      links.appendChild(signOut);
      p.appendChild(links);

      // The quiet footer (v1.90 version, v1.158 total on disk, v1.305 items in trash): one
      // compact ui-list of info-links. The disk and trash rows are lazily counted on the
      // first open (shimmer until then); a failed fetch hides ITS row only (never a broken
      // or wrong value); the version row links to the build's release notes in a new tab.
      const foot = U.list({ size: 'compact', divider: 'none', label: 'About', doc: document });
      foot.classList.add('account-menu-footer');
      diskLabel = document.createElement('span');
      diskLabel.className = 'account-menu-disk-shimmer skeleton-shimmer';
      diskRow = U.row({ size: 'compact', href: '/stats.html', title: diskLabel, doc: document });
      diskRow.classList.add('account-menu-disk');
      diskRow.setAttribute('role', 'menuitem');
      diskRow.setAttribute('aria-label', 'Total size on disk - open Stats');
      foot.appendChild(diskRow);
      trashLabel = document.createElement('span');
      trashLabel.className = 'account-menu-disk-shimmer skeleton-shimmer'; // the disk row's loading-bar sizing
      trashRow = U.row({ size: 'compact', href: '/setup.html#trash', title: trashLabel, doc: document });
      trashRow.classList.add('account-menu-trash');
      trashRow.setAttribute('role', 'menuitem');
      trashRow.setAttribute('aria-label', 'Review trash');
      foot.appendChild(trashRow);
      const version = appVersionString();
      const notesUrl = releaseNotesUrl(version);
      if (version && notesUrl) {
        const ver = U.row({ size: 'compact', href: notesUrl, title: 'Version ' + version, doc: document });
        ver.classList.add('account-menu-version');
        ver.setAttribute('target', '_blank');
        ver.setAttribute('rel', 'noopener');
        ver.setAttribute('aria-label', `Version ${version} - open release notes`);
        foot.appendChild(ver);
      }
      p.appendChild(foot);

      // In-app links SPA-navigate (the docked mini-player survives; v1.153: a full reload
      // tore it down) and close the menu. The click stops at the panel so the document
      // router never handles it a second time.
      p.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = e.target && typeof e.target.closest === 'function' ? e.target.closest('a[href]') : null;
        if (!a || !p.contains(a)) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.getAttribute('target') === '_blank') return;
        let u;
        try { u = new URL(a.getAttribute('href'), window.location.href); } catch (_) { return; }
        if (u.origin !== window.location.origin) return;
        if (typeof deriveRouteView === 'function' && deriveRouteView(u.pathname)
          && window.FileTube && typeof window.FileTube.navigate === 'function') {
          e.preventDefault();
          closeMenu();
          // v1.305 (gate): when we are ALREADY on the target path+search and only the hash
          // differs (e.g. "N items in trash" -> /setup.html#trash while already on
          // Settings), navigate() no-ops - its same-location check ignores the hash - so
          // set the hash directly; the master-detail hashchange listener opens the section.
          const samePathSearch = (u.pathname + u.search) === (window.location.pathname + window.location.search);
          if (samePathSearch && u.hash && u.hash !== window.location.hash) {
            window.location.hash = u.hash;
          } else {
            window.FileTube.navigate(u.href);
          }
        }
      });
      return p;
    };

    const loadDiskUsage = () => {
      if (diskLoaded) return; // fetch once per menu instance, on first open
      diskLoaded = true;
      fetch('/api/storage-summary')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('storage-summary ' + r.status))))
        .then((body) => {
          const bytes = body && Number(body.totalSizeBytes);
          if (!Number.isFinite(bytes)) throw new Error('bad total');
          diskLabel.className = ''; // drop the shimmer, reveal the value
          diskLabel.textContent = formatDiskBytes(bytes) + ' on disk';
        })
        .catch(() => { diskRow.hidden = true; });
    };
    const loadTrashCount = () => {
      if (trashLoaded) return; // fetch once per menu instance, on first open
      trashLoaded = true;
      fetch('/api/trash')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('trash ' + r.status))))
        .then((body) => {
          const count = body && Number(Number.isFinite(Number(body.total)) ? body.total : (body.items || []).length);
          if (!Number.isFinite(count)) throw new Error('bad count');
          trashLabel.className = ''; // drop the shimmer, reveal the value
          // v1.306: /api/trash returns totalSizeBytes (summed server-side).
          trashLabel.textContent = formatTrashCountLabel(count, Number(body.totalSizeBytes));
        })
        .catch(() => { trashRow.hidden = true; });
    };

    function closeMenu() { if (sheet) sheet.close(); }
    function openMenu() {
      const U = typeof window !== 'undefined' ? window.ui : null;
      if (!U || typeof U.sheet !== 'function') return; // ui.js ships on every shell
      if (!panel) panel = buildPanel(U);
      if (!sheet) {
        sheet = U.sheet({
          // A title, so the header reads 'Account' with the one Close at its trailing edge.
          variant: 'auto', anchor: trigger, title: 'Account', content: panel, doc: document,
          onClosing: () => trigger.setAttribute('aria-expanded', 'false'),
        });
        sheet.el.id = 'account-menu-sheet'; // an id: ui.sheet rewrites className on every open
      }
      sheet.open();
      trigger.setAttribute('aria-expanded', 'true');
      updateAccountMenuThemeItem();
      loadDiskUsage(); loadTrashCount(); // v1.158 / v1.305: lazily, on the first open
    }
    trigger.addEventListener('click', (e) => {
      // v1.85.1: the You tab forwards its tap here; stop it reaching the document.
      e.stopPropagation();
      if (sheet && sheet.isOpen()) closeMenu(); else openMenu();
    });

    const phNow = document.getElementById('account-menu-placeholder');
    if (phNow && phNow.parentNode === headerRight) phNow.replaceWith(root);
    else { if (phNow) phNow.remove(); headerRight.appendChild(root); }
  }).catch(() => { /* signed-out / network -- no menu */ });
}

function injectOneOffDownloadButtonIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (document.getElementById('ytdlp-oneoff-btn') || document.querySelector('[data-nav="oneoff-download"]')) return; // already injected

  // v1.339 (L2): the shells' pre-paint reserves (header `[data-ft-reserve="download"]`,
  // bottom-nav `[data-ft-reserve="oneoff-download"]`, painted from ft-ytdlp-module) are
  // replaced in place below, or dropped on every exit that builds nothing.
  const dropReserves = () => {
    const h = chromeReserveEl(document.querySelector('.header-right'), 'download');
    if (h) h.remove();
    const n = chromeReserveEl(document.getElementById('bottom-nav'), 'oneoff-download');
    if (n) { n.remove(); applyBottomNavCustomization(); }
  };
  fetch('/api/subscriptions/health')
    .then((res) => {
      rememberModuleEnabled(res.ok === true); // v1.339 (L2): the next launch's reserve flag
      if (!shouldInjectOneOffButton(res)) { dropReserves(); return; } // disabled (404) -- inject nothing
      // v1.47.4 item 4: RE-CHECK after the await, using the SAME predicate as
      // the pre-fetch guard above. Without it, two overlapping calls both pass
      // the pre-fetch check and both build a header button + modal.
      if (document.getElementById('ytdlp-oneoff-btn') || document.querySelector('[data-nav="oneoff-download"]')) { dropReserves(); return; }

      const headerRight = document.querySelector('.header-right');
      // v1.15.1: the desktop header button lives inside `.header-right`. It was
      // hidden on phones by the `.header-right .btn { display:none }` rule, so
      // this bottom-nav entry (mirroring `injectSubscriptionsNavLinkIfEnabled`)
      // gave mobile a discoverable entry into the SAME modal.
      // v1.85.1 (#D, Dean): the header button is now SHOWN on mobile too - the
      // id rule `.header-right #ytdlp-oneoff-btn { display: inline-flex }`
      // out-specifies that `.btn` hide (see style.css). So mobile has two entry
      // points (this bottom-nav one + the top-right button); disclosed, Dean's
      // call whether to keep both.
      const settingsNavItem = document.querySelector('#bottom-nav [data-nav="settings"]');
      if (!headerRight && !settingsNavItem) return; // page has neither surface -- nothing to attach to

      let modalState = null;

      // v1.17.0 FR-6, T5 fix: hardened into a FULL teardown, shared by every
      // dismiss path (backdrop tap, [x], Esc, and -- v1.29.0 T8 -- a
      // SUCCESSFUL submit's minimize-into-the-chip, see
      // `submitOneOffDownload` below); none of them have their own divergent
      // close logic, they all call this one function.
      // Root cause (style.css, then): `.oneoff-modal-backdrop` set `display: flex`
      // with no `[hidden]` override, so the old `backdrop.hidden = true`
      // alone never actually hid the full-viewport overlay -- it stayed
      // painted and ate every touch. Now the backdrop node is fully removed
      // from the DOM (`backdrop.remove()`, belt to the CSS fix's suspenders)
      // and `modalState` is nulled so `openModal` rebuilds a fresh modal
      // next time (the once-bound `keydown` Esc handler below already
      // guards on `modalState &&`, so nulling it makes that handler an
      // inert no-op once closed).
      //
      // v1.29.0 T8: this modal no longer polls its own status at all (the
      // old `pollStatusOnce` loop -- and the `currentJobId`/adaptive-delay
      // state it alone needed -- is gone): a SUCCESSFUL submit now
      // minimizes into the corner chip immediately, and the chip owns
      // every job's progress/terminal handling from then on (it already
      // polls `/api/subscriptions/status` on its own cadence). This
      // function is therefore now ONLY ever reached synchronously, right
      // after the last status line was rendered -- there is no longer any
      // pending timer to cancel.
      // Sweep S9: the dialog is a ui.sheet; its close removes the scrim and the sheet from
      // the DOM once the exit ends (and is a no-op when the sheet itself began the close -
      // Esc, the scrim, Close - which calls back here through onClose).
      function closeModal() {
        if (!modalState) return;
        const state = modalState;
        modalState = null;
        state.sheet.close();
      }

      // v1.29.0 T6 (R1.4/AC3.4): the ONE place that ever POSTs
      // `/api/ytdlp/download` for this modal -- extracted out of the
      // `onDownload` handler below so the new error-state Retry control
      // (`onRetry`, below) can start a fresh job through the EXACT SAME
      // request/response handling, never a duplicated request shape (a retry
      // is a brand-new one-shot job, same as the chip's own `retryOneShot`).
      function submitOneOffDownload(body) {
        modalState.setStatus({ state: 'queued' });
        modalState.statusEl.textContent = 'Starting…';
        fetch('/api/ytdlp/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then(async (r) => {
            const data = await r.json().catch(() => ({}));
            // v1.17.0 FR-6, T5 fix: closeModal now nulls `modalState` as
            // part of its full teardown (see above) -- if the user
            // dismisses the modal after submitting but before this
            // response arrives, `modalState` is already null here. Guarded
            // the same way the chip's own poll tick guards itself against a
            // torn-down surface: the download itself still proceeds
            // server-side either way, only the (now-gone) status line is
            // skipped.
            if (!modalState) return;
            if (!r.ok) {
              // SECURITY: the server's validation error string, rendered
              // via the modal's own textContent-only setStatus/statusEl
              // path -- never innerHTML.
              modalState.statusEl.textContent = data.error || 'Could not start download.';
              return;
            }
            // v1.29.0 T8 (R2.1/AC4.1, R2.2/AC4.2): a SUCCESSFUL submit no
            // longer keeps the modal open/polling -- it minimizes into the
            // existing corner chip instead, so the user can keep browsing
            // immediately. `injectDownloadStatusChip()` is idempotent
            // (guarded by `#dl-status-chip`/`dlStatusChipInjectStarted`), so
            // this is safe to call unconditionally on every success, even
            // when the chip already exists; the chip picks up this job on
            // its own next poll tick (it already polls
            // `/api/subscriptions/status` and renders `oneShots` -- no
            // second poller). `closeModal()` runs AFTER, mirroring
            // `applyOneOffTerminalAction`'s close-independent-of-refresh
            // ordering guarantee (BUG 2) -- a slow/hanging chip injection can
            // never starve the modal's teardown. The `!r.ok`/network-error
            // branches above/below are UNCHANGED: the modal stays open with
            // T6's error + Retry UI intact.
            injectDownloadStatusChip();
            closeModal();
          })
          .catch(() => {
            if (!modalState) return;
            modalState.statusEl.textContent = 'Could not start download (network error).';
          });
      }

      function openModal() {
        if (!modalState) {
          modalState = buildOneOffModal(document, {
            onClose: closeModal,
            onDownload: (body) => submitOneOffDownload(body),
            // v1.29.0 T6 (R1.4/AC3.4): the modal's error-state Retry --
            // `entry` is the LAST LiveEntry `setStatus` rendered (only
            // reachable while `entry.state === 'error'`, see
            // `buildOneOffModal`'s own `retryBtn.hidden` gate), so this is
            // the SAME failed job's original request params.
            // `buildOneShotRetryBody` is the SHARED body-builder the chip's
            // own `retryOneShot` already uses -- no duplicated request shape.
            onRetry: (entry) => {
              const body = buildOneShotRetryBody(entry);
              if (!body) return; // no reconstructable url -- nothing to retry
              submitOneOffDownload(body);
            },
          });
        }
        modalState.sheet.open();
      }

      // Desktop: header button, Dean-locked placement (immediately before
      // the Settings link when one exists in this header; pages whose
      // header has no Settings link get the button appended to
      // `.header-right`).
      if (headerRight) {
        // Sweep S1 (F31): the header Download is a plain ui-btn icon button at every width
        // (it was a bevelled text .btn on desktop beside flat round glyphs, and glyph-only
        // on the phone). The sprite glyph paints with the text (v1.87.1's first-paint rule).
        const btn = chromeButtonEl({ cls: 'oneoff-download-btn', icon: CHROME_ICON.download, ariaLabel: 'Download a video' });
        btn.id = 'ytdlp-oneoff-btn';
        btn.title = 'Download a video';

        // v1.85.2 (Dean, on-device ROOT CAUSE): scope to a DIRECT CHILD. The
        // original intent was "insert before the Settings link when THIS header
        // has one, else append" - back when Settings was a direct child of
        // .header-right. v1.82 folded Settings INTO the account-menu dropdown as
        // an <a href="/setup.html"> nested inside #account-menu-root (itself
        // inside .header-right), so the UNSCOPED querySelector now matches that
        // GRANDCHILD. insertBefore requires a direct child, so it threw
        // NotFoundError, rejecting the whole .then into the silent .catch below -
        // building NEITHER the header button NOR the bottom-nav entry. It was
        // invisible in local repros (the one-off probe won the race and ran
        // BEFORE the account menu injected its link) but DETERMINISTIC on a
        // server where the account menu injects first (Dean's). `:scope >` restores
        // the original semantics exactly: anchor only to a Settings link that is a
        // direct child of this header (none since v1.82 -> appendChild), never a
        // descendant. Regression-bound in test/unit/oneoff-header-injection-placement.test.js.
        const settingsLink = headerRight.querySelector(':scope > a[href="/setup.html"]');
        // v1.339 (L2): the pre-paint reserve's place first (same box, zero shift); else
        // left of the account avatar or its placeholder (the account injector swaps its
        // placeholder in place), so the order no longer depends on which fetch lands
        // first (a first-ever launch put Download right of the avatar when the account
        // resolved first); else the pre-v1.82 Settings anchor / append.
        const dlReserve = chromeReserveEl(headerRight, 'download');
        const acct = headerRight.querySelector(':scope > #account-menu-root, :scope > #account-menu-placeholder');
        if (dlReserve) {
          dlReserve.replaceWith(btn);
        } else if (settingsLink) {
          headerRight.insertBefore(btn, settingsLink);
        } else if (acct) {
          headerRight.insertBefore(btn, acct);
        } else {
          headerRight.appendChild(btn);
        }

        btn.addEventListener('click', openModal);
      }

      // v1.15.1 FIX 4: mobile bottom-nav entry, inserted right after the
      // existing Settings item (mirroring `injectSubscriptionsNavLinkIfEnabled`'s
      // own bottom-nav injection) -- a `<button>` (not a link) since it opens
      // the modal in place rather than navigating.
      if (settingsNavItem && settingsNavItem.parentElement) {
        // v1.339 (L2): a sprite <svg>, not the `.icon-download` mask (iOS decode lag - the
        // v1.87.1 first-paint glyph rule), matching the reserve's glyph. Sweep S1 (F49): a
        // ui-btn stack tab like every other.
        const navBtn = bottomNavItemEl({ tag: 'button', nav: 'oneoff-download', icon: CHROME_ICON.download, label: 'Download', ariaLabel: 'Download a video' });
        const navReserve = chromeReserveEl(document.getElementById('bottom-nav'), 'oneoff-download');
        if (navReserve) navReserve.replaceWith(navBtn);
        else settingsNavItem.insertAdjacentElement('afterend', navBtn);

        navBtn.addEventListener('click', openModal);
        // v1.44 T12: re-apply the user's bar layout now that Download exists.
        applyBottomNavCustomization();
      }

      // Esc, the scrim and the Close are the ui.sheet's own (Esc only closes the TOP
      // sheet, so it never also closes a dialog stacked over this one); each reaches
      // closeModal through buildOneOffModal's onClose.
    })
    .catch(() => { dropReserves(); /* network/parse failure -- fail closed, inject nothing (v1.339 L2: and clear the reserves) */ });
}

// Small local HTML-escape mirroring the per-page escapeHtml helpers, used only
// by renderPlaylistsSheet so common.js has no dependency on a given page's copy.
function escapeAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---- SPA-lite router + view registry (FR-1, T1) ---------------------------
//
// FileTube is a persistent app shell: the header/sidebar/bottom-nav (and, once
// T2 lands, the player) stay mounted across in-app navigation -- only each
// page's `#view-root` fragment is swapped. Every routable view URL (the full
// set lives in `deriveRouteView` below -- home/watch/setup/stats/subscriptions/
// books/read/music/podcasts/history) still resolves to a COMPLETE, correct
// server-rendered document on its own -- this router is
// strictly a progressive-enhancement layer on top of that (see `bootRouter`
// near the bottom of this section, which runs the exact same `init()` a swap
// runs). No framework/router library/bundler (CONTRIBUTING.md) -- vanilla DOM
// + the `history` API only.
//
// Pure helpers first (route derivation, click-interception decision,
// history.state (de)serialization) -- these are node:test-covered directly
// (see test/unit/router-helpers.test.js). The DOM-heavy swap/fetch machinery
// below them is a thin, untested-by-necessity shell around them, the same
// posture the rest of this file already uses for its nav-link injection.

// The SPA routes this app knows about. Anything else (external links,
// `/thumbnail/*`, downloads, a future route) falls through to a normal
// browser navigation -- this router never tries to "handle" a path it doesn't
// recognize, and adding a route here alone does not make it reachable (the
// shell only ever links to it when the corresponding feature is present --
// see the disabled-module note on `ensureSubscriptionsScriptLoaded` below).
function deriveRouteView(pathname) {
  if (pathname === '/' || pathname === '/index.html') return 'home';
  if (pathname === '/watch.html') return 'watch';
  if (pathname === '/setup.html') return 'setup';
  // v1.151: Stats is an SPA route, so navigating to it keeps the docked
  // mini-player playing. Before this, /stats.html was the ONE shell nav
  // destination deriveRouteView returned null for -- so a click fell through
  // to a full browser page load, unloading the whole document (including the
  // persistent #player-host that lives outside #view-root) and stopping
  // playback. activeNavItem + SIDEBAR_HREF_BY_NAV_KEY gain a matching 'stats'
  // entry so the rail lights Stats: once this returns non-null, bootRouter
  // stops no-op'ing and runs the highlight pass, which would otherwise STRIP
  // stats.html's server-rendered `active` class and light nothing.
  if (pathname === '/stats.html') return 'stats';
  // The /subscriptions route + nav link only ever exist server-side (and are
  // only ever linked to from the shell) when the optional yt-dlp module is
  // enabled -- this pure mapping is unconditional (harmless when nothing ever
  // links here; mirrors activeNavItem's own unconditional mapping above).
  if (pathname === '/subscriptions') return 'subscriptions';
  // v1.37.0 books: same unconditional-mapping posture -- the Books nav link
  // is only injected when >=1 book folder is configured (see
  // injectBooksNavLinkIfEnabled), and /read.html is only ever linked from
  // book cards, so a books-less install never navigates here.
  if (pathname === '/books' || pathname === '/books.html') return 'books';
  if (pathname === '/read.html') return 'read';
  // v1.44 music: same unconditional-mapping posture -- the Music nav link is
  // only injected when >=1 music folder is configured.
  if (pathname === '/music' || pathname === '/music.html') return 'music';
  if (pathname === '/tv' || pathname === '/tv.html') return 'tv';
  // v1.69 podcasts: same posture (nav gated on >=1 subscription).
  if (pathname === '/podcasts' || pathname === '/podcasts.html') return 'podcasts';
  // v1.64 history: same posture (the entry is count-gated like Liked).
  if (pathname === '/history' || pathname === '/history.html') return 'history';
  // v1.342 clean up: reached from the account menu + Stats, so no nav item of its own.
  if (pathname === '/cleanup') return 'cleanup';
  return null;
}

// ---- v1.47.4 item 2 (Dean): kill accidental pinch/double-tap zoom ----------
//
// Dean: "I want to fully disable pinch-to-zoom on iOS/Mobile viewport. It's easy
// to zoom in accidentally and is just a janky experience." Carve-out, his words:
// the reader ("explicitly and exclusively") keeps zoom, because zooming a PDF or
// a book page is a genuine feature there, not an accident.
//
// WHY THIS IS ROUTE-DRIVEN AND NOT A PER-SHELL <meta>/<body> FLAG: /read.html is
// an SPA route (see deriveRouteView above), so a book opened from the Books grid
// is an in-app #view-root swap -- the document, its <meta viewport>, and any
// boot-time body attribute all belong to whichever shell loaded FIRST. A static
// per-shell carve-out would therefore hand the reader whatever policy the
// previous page happened to have. The policy has to be re-evaluated on every
// view change, from the live URL.
//
// THREE LEVERS, because no single one covers both zoom gestures on iOS:
//   1. `user-scalable=no, maximum-scale=1` -- honored by Android/Chrome. iOS
//      Safari has deliberately IGNORED it since iOS 10, so it is necessary but
//      nowhere near sufficient, which is why levers 2 and 3 exist.
//   2. `touch-action: manipulation` (CSS, keyed off the same body attribute) --
//      this is what actually kills DOUBLE-TAP zoom, the most common accidental
//      trigger while tapping controls.
//   3. `gesturestart`/`gesturechange` preventDefault -- the WebKit-specific
//      pinch lever, and the only thing that reliably stops pinch in an iOS PWA.
//
// Text scaling is untouched by all three: this suppresses GESTURE zoom only, so
// a user who has set a larger OS/browser text size keeps it. That is deliberate
// -- taking that away would be an accessibility regression, not a polish fix.
const ZOOM_ALLOWED_VIEW = 'read';
const VIEWPORT_ZOOM_LOCKED = 'width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no';
const VIEWPORT_ZOOM_FREE = 'width=device-width, initial-scale=1.0, viewport-fit=cover';

/**
 * Pure: may this route pinch/double-tap zoom? Only the reader. An unknown route
 * (null) is treated as a normal app surface, i.e. suppressed -- fail-safe in the
 * direction of Dean's actual complaint rather than leaving stray surfaces zoomy.
 */
function pinchZoomAllowedForView(view) {
  return view === ZOOM_ALLOWED_VIEW;
}

/**
 * Re-evaluate the zoom policy for the CURRENT url and reflect it onto the
 * document (viewport meta + a `data-view` body attribute the CSS keys off).
 * Idempotent and defensive: safe to call on every view change, and a document
 * missing <body>/<meta name="viewport"> is simply skipped, never thrown on.
 *
 * Called from `updateActiveNavHighlight`, which is ALREADY invoked immediately
 * after every one of the three `currentViewName = ...` assignments AND is itself
 * driven by `window.location` rather than by passed-in state. Piggybacking there
 * is deliberate: this repo has a recurring "the bug is the seat that forgot to
 * CALL the shared helper" class (v1.41.4), so a policy that rides an existing,
 * already-universal call site cannot drift out of sync with the router.
 */
function applyZoomPolicy() {
  if (typeof document === 'undefined' || !document.body) return;
  const view = deriveRouteView(window.location.pathname || '');
  const allowed = pinchZoomAllowedForView(view);
  // The CSS hook (lever 2). Stamped as the raw view name rather than a boolean
  // so other route-scoped styling can reuse it without a second attribute.
  document.body.setAttribute('data-view', view || '');
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', allowed ? VIEWPORT_ZOOM_FREE : VIEWPORT_ZOOM_LOCKED);
}

/**
 * Bind the WebKit pinch lever (3) ONCE, at boot. Deliberately NOT an
 * enable/disable pair: the handler re-reads the live route at EVENT time, so
 * there is no listener lifecycle to keep in sync with navigation and no way for
 * a missed teardown to leave the reader un-zoomable (or the app zoomy). Bound on
 * `document` with `passive: false` because a passive listener cannot
 * preventDefault, which is the entire point.
 *
 * `gestureend` is deliberately NOT bound: preventing start+change already
 * suppresses the zoom, and leaving end alone keeps WebKit's own gesture
 * bookkeeping intact.
 */
function wirePinchZoomSuppression() {
  if (typeof document === 'undefined') return;
  const suppress = (e) => {
    if (pinchZoomAllowedForView(deriveRouteView(window.location.pathname || ''))) return;
    e.preventDefault();
  };
  document.addEventListener('gesturestart', suppress, { passive: false });
  document.addEventListener('gesturechange', suppress, { passive: false });
}

// ---- v1.47.4 item 6: make an iOS PWA eviction cost only the relaunch tap ---
//
// Dean asked to "harden and isolate the PWA features from other PWA apps",
// having noticed that closing a DIFFERENT PWA can kill this one while it plays
// in the background. Reframed at intake, and he agreed: iOS exposes NO
// cross-app isolation control. A backgrounded standalone PWA is a WebKit
// process subject to jetsam, and closing another PWA can trigger the sweep that
// reaps ours. "Never killed" is not deliverable and is not claimed here.
//
// The agreed acceptance instead: A KILL COSTS NOTHING BUT THE RELAUNCH TAP.
// Playback POSITION already survives (it is persisted server-side per user, and
// the player already offers its resume prompt). What did not survive was WHERE
// YOU WERE: a relaunch always landed on the manifest's `start_url` (`/`), so a
// kill mid-episode dumped you back at the home grid to find your place again.
//
// This records the current route and restores it on a COLD START, under four
// deliberately narrow conditions (see maybeRestoreLastSession) so it can never
// hijack a deliberate fresh open.

const LAST_SESSION_KEY = 'ft-last-session';

// How stale a pointer may be and still be worth restoring. An eviction is
// followed by a relaunch in minutes-to-hours (you come back to what you were
// listening to), whereas opening the app the NEXT DAY is a fresh intent that
// should land on Home. 6h separates those two cases without needing to guess.
const LAST_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Pure: is this a route worth restoring to? Home-root is deliberately excluded
 * -- restoring Home to Home is a no-op that would only risk a redirect loop.
 */
function isRestorableSessionUrl(url, origin) {
  if (typeof url !== 'string' || url === '') return false;
  if (!url.startsWith('/')) return false;
  // v1.47.4 gate WARNING (adversarial seat): a `startsWith('/')` +
  // `!startsWith('//')` pair is NOT an origin check, and the comment that
  // claimed it was is now gone. Browsers normalize backslashes to forward
  // slashes for special schemes, so:
  //
  //   new URL('/\\evil.com', 'https://filetube.local').origin === 'https://evil.com'
  //
  // passes both of those string tests and then navigates OFF-ORIGIN via
  // `location.replace`. Only reachable by hand-editing/injecting localStorage,
  // so this is hardening rather than a live exploit chain -- but an open
  // redirect out of the app is not something to leave standing on a technicality.
  //
  // Resolved through the SAME parser the browser uses, and compared by ORIGIN.
  const base = origin || (typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost');
  let resolved;
  try {
    resolved = new URL(url, base);
  } catch (_) {
    return false; // unparseable -- never restore
  }
  if (resolved.origin !== base) return false;
  // Home-root is excluded on the NORMALIZED path, so no encoding trick can
  // smuggle a home-root restore past the string comparison either.
  const pathAndSearch = resolved.pathname + resolved.search;
  return pathAndSearch !== '/' && pathAndSearch !== '/index.html';
}

/**
 * Pure: should a cold start restore `stored`? Split out from all storage/DOM
 * access so every branch is directly testable.
 */
function shouldRestoreSession(stored, currentPath, nowMs, isStandalone, origin) {
  // 1. Only inside an installed PWA. A browser tab has its own history and
  //    restoring under it would be an unwanted redirect.
  if (!isStandalone) return false;
  // 2. Only when landing on the bare start_url -- i.e. genuinely a cold launch,
  //    never a deep link or an in-app navigation.
  if (currentPath !== '/' && currentPath !== '/index.html') return false;
  if (!stored || typeof stored !== 'object') return false;
  if (!isRestorableSessionUrl(stored.url, origin)) return false;
  // 3. Recent enough to be a resumption rather than a fresh intent.
  const ts = typeof stored.ts === 'number' ? stored.ts : NaN;
  if (!Number.isFinite(ts)) return false;
  const age = nowMs - ts;
  // A future-dated pointer (clock change, edited storage) is not trusted.
  if (age < 0 || age > LAST_SESSION_MAX_AGE_MS) return false;
  return true;
}

/**
 * Record the current route as the resume point. Called from
 * `updateActiveNavHighlight`, which already runs after every view change and is
 * already location-driven -- the same reasoning as the zoom policy above, and
 * the same reason it cannot drift out of sync with the router.
 *
 * localStorage is best-effort: Safari can throw on write in private mode or
 * when the quota is exhausted, and a resume convenience must never break a
 * navigation.
 */
/**
 * Is this an INSTALLED app surface (not a browser tab)? Extracted in v1.47.5 so
 * `recordLastSession`'s clear and `maybeRestoreLastSession` share one
 * definition rather than each hand-rolling the check.
 */
function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true,
    );
  } catch (_) {
    return false;
  }
}

function recordLastSession() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const url = window.location.pathname + window.location.search;
    if (!isRestorableSessionUrl(url)) {
      // v1.47.5 (Dean, on-device): CLEAR, don't skip. This used to `return`
      // here, so navigating Home left the LAST VIDEO as the stored pointer --
      // and a force-quit from Home then reopened that video. Dean: "it's almost
      // a little too sticky ... If it's to work it should actually represent
      // the position."
      //
      // Skipping made the pointer mean "the last restorable page you ever
      // visited", which is not a position. Clearing makes it mean "where you
      // actually are", so deliberately leaving a video (going Home) is
      // remembered as leaving it. Home is the one place that is both a real
      // position AND has nothing to restore, so it is expressed as an absent
      // pointer rather than a stored one.
      //
      // GATED ON STANDALONE (v1.47.5 gate suggestion): only the installed PWA
      // may express its own position. Where storage is SHARED between a browser
      // tab and an installed app (Android/desktop Chrome -- not iOS, where a
      // home-screen app gets its own container), an ordinary tab landing on `/`
      // would otherwise wipe a resume the PWA had legitimately stored, and the
      // next PWA launch would come up blank. Recording (below) stays ungated:
      // storing where you are is harmless from either surface; DESTROYING the
      // other surface's pointer is not.
      if (isStandaloneDisplay()) window.localStorage.removeItem(LAST_SESSION_KEY);
      return;
    }
    window.localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ url, ts: Date.now() }));
  } catch (_) { /* private mode / quota / disabled storage -- never fatal */ }
}

/**
 * On a cold PWA start, jump back to where the user was. Uses
 * `location.replace`, NOT a push: the synthetic entry must not sit in history
 * where Back would bounce the user between Home and the restored page.
 *
 * @returns {boolean} whether a restore was performed (for tests/callers)
 */
function maybeRestoreLastSession() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    // v1.47.5: shared with recordLastSession's clear -- one definition of "this
    // is the installed app", so the restore and the clear can never disagree
    // about which surface owns the pointer.
    const isStandalone = isStandaloneDisplay();
    let stored = null;
    try {
      stored = JSON.parse(window.localStorage.getItem(LAST_SESSION_KEY) || 'null');
    } catch (_) {
      return false; // corrupt/hand-edited value -- ignore, never throw
    }
    if (!shouldRestoreSession(stored, window.location.pathname, Date.now(), isStandalone, window.location.origin)) return false;
    // 4. Never restore onto the page we are already on (belt to
    //    isRestorableSessionUrl's suspenders -- no redirect loop is possible).
    if (stored.url === window.location.pathname + window.location.search) return false;
    window.location.replace(stored.url);
    return true;
  } catch (_) {
    return false;
  }
}

// ---- v1.47.4 item 4: shell singleton invariant (?debugUI=1) ----------------
//
// Dean: "on mobile at times if I go back and forth between pages ... certain
// icons do not properly show or glitch out and duplicate (think the top bar).
// It's odd and annoying and only resolved by switching pages entirely."
//
// HONEST SCOPE. The idempotency defects fixed above are real and provable, but
// they do NOT yet explain a TOP-BAR symptom during in-app navigation: those
// injectors run once at DOMContentLoaded, not per view swap, and the header
// markup is static. Dean's report is intermittent and he cannot capture it. So
// rather than guess at a fix, this makes the next occurrence REPORT ITSELF.
//
// Opt-in via `?debugUI=1` and completely inert otherwise -- no timers, no
// listeners, no cost on a normal load. It checks the shell elements that must
// be unique and logs any that are not, with a MutationObserver so a duplicate
// appearing later (the actual reported behavior: mid-session, after several
// navigations) is caught at the moment it appears rather than only at boot.
//
// "Only resolved by switching pages entirely" is consistent with a duplicated
// or orphaned SHELL node, since a hard load rebuilds the document from
// scratch -- which is exactly what this instrument is aimed at.

// Selectors for elements the shell must contain AT MOST ONE of. Deliberately
// limited to persistent shell chrome (never #view-root contents, which are
// legitimately rebuilt on every swap).
const SHELL_SINGLETON_SELECTORS = [
  'header',
  '#bottom-nav',
  '#menu-toggle',
  '#account-menu-root', // v1.82: the account menu is shell chrome (injected once)
  '#search-input',
  '#ytdlp-oneoff-btn',
  '#playlists-sheet',
  '[data-nav="subscriptions"]',
  '[data-nav-sidebar="subscriptions"]',
  '[data-nav-sidebar="books"]',
  '[data-nav-sidebar="music"]',
  '.header-right',
  '.ptr-indicator',
];

/**
 * Pure: given a counting function, return the selectors that are duplicated.
 * Split out from the DOM/observer wiring so it is directly unit-testable.
 */
function findDuplicateShellSingletons(countFn, selectors) {
  const list = Array.isArray(selectors) ? selectors : SHELL_SINGLETON_SELECTORS;
  const dupes = [];
  for (const selector of list) {
    let count = 0;
    try {
      count = countFn(selector);
    } catch (_) {
      continue; // a selector this document can't evaluate is not a finding
    }
    if (typeof count === 'number' && count > 1) dupes.push({ selector, count });
  }
  return dupes;
}

/**
 * Wire the invariant when `?debugUI=1` is present. Returns false (and does
 * nothing at all) otherwise -- this must never cost anything on a normal load.
 */
function wireShellSingletonDebug() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  let enabled = false;
  try {
    enabled = new URLSearchParams(window.location.search || '').get('debugUI') === '1';
  } catch (_) {
    return false;
  }
  if (!enabled) return false;

  const report = (when) => {
    const dupes = findDuplicateShellSingletons((sel) => document.querySelectorAll(sel).length);
    if (dupes.length === 0) return;
    // console.warn (not error) so it never trips an error-reporting path; the
    // point is a breadcrumb Dean can screenshot, not an exception.
    console.warn('[debugUI] duplicated shell singleton(s) ' + when + ':',
      dupes.map((d) => `${d.selector} x${d.count}`).join(', '));
  };

  report('at boot');
  try {
    const observer = new MutationObserver(() => report('after a DOM change'));
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (_) {
    // No MutationObserver (or no body yet) -- the boot-time check above still
    // ran, so degrade rather than throw.
  }
  return true;
}

// ---- v1.47.4 item 5: touch-eating overlay instrument (?debugTouch=1) -------
//
// Dean: "Sometimes, video input disappears on mobile and requires a force close
// of the PWA for it to return/behave normally." (Clarified: touch input on the
// player stops responding.)
//
// The leading hypothesis has direct precedent IN THIS REPO. The v1.17.0 T5 fix
// records it exactly: `.oneoff-modal-backdrop` set `display: flex` with no
// `[hidden]` override, so `backdrop.hidden = true` left a full-viewport
// `z-index: 2100` overlay PAINTED AND EATING EVERY TOUCH. The page looked
// normal and was completely dead to input -- precisely Dean's description.
//
// Since the recurrence is intermittent and uncapturable, this reports the
// answer instead of guessing at it: on each touch it names the element that
// ACTUALLY received the point. If an invisible overlay is swallowing input,
// that element will be the overlay rather than the control the user aimed at,
// and the culprit identifies itself by class in one tap.
//
// Opt-in via `?debugTouch=1`; a completely inert no-op otherwise. The listener
// is PASSIVE, so it cannot itself alter touch behavior while diagnosing it.

/**
 * Pure: describe an element compactly enough to identify it in a log line.
 * Never throws on a null/foreign node.
 */
function describeTouchTarget(el) {
  if (!el || typeof el !== 'object') return '(none)';
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '?';
  const id = typeof el.id === 'string' && el.id !== '' ? '#' + el.id : '';
  const cls = (typeof el.className === 'string' && el.className.trim() !== '')
    ? '.' + el.className.trim().split(/\s+/).join('.')
    : '';
  return tag + id + cls;
}

/**
 * Wire the touch-target logger when `?debugTouch=1` is present. Returns false
 * and does nothing otherwise.
 */
function wireTouchTargetDebug() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  let enabled = false;
  try {
    enabled = new URLSearchParams(window.location.search || '').get('debugTouch') === '1';
  } catch (_) {
    return false;
  }
  if (!enabled) return false;

  document.addEventListener('touchstart', (e) => {
    try {
      const t = e.touches && e.touches[0];
      if (!t) return;
      // `elementFromPoint` is the whole point: it reports what the BROWSER
      // would hand the touch to, which is not necessarily `e.target` and is
      // exactly where a transparent overlay reveals itself.
      const atPoint = document.elementFromPoint(t.clientX, t.clientY);
      const line = `[debugTouch] point=${describeTouchTarget(atPoint)} target=${describeTouchTarget(e.target)}`;
      // Flag the specific smoking gun: the touch landed on something that is
      // NOT what the user aimed at, which is the overlay-eating-input shape.
      console.warn(atPoint !== e.target ? line + '  <-- MISMATCH (possible overlay)' : line);
    } catch (_) {
      // Never let the diagnostic interfere with real input handling.
    }
  }, { passive: true, capture: true });
  return true;
}

// ---- v1.47.8: keyboard shortcuts reference (Dean) --------------------------
//
// Dean: "Can we make a keyboard shortcuts page/modal? ... We can mirror
// YouTube's or other modern apps'. Ignore/not display on mobile viewport. Keep
// it simple."
//
// THE ONE RULE THIS FEATURE LIVES OR DIES BY: every row below documents a
// shortcut that ACTUALLY EXISTS in this codebase. A reference that lists keys
// which do nothing is worse than no reference at all -- it converts "I don't
// know the shortcut" into "the app is broken". So this list was written by
// reading the real handlers (player.js's keydown switch and read.js's), not by
// copying YouTube's published set, and `keyboard-shortcuts.test.js` asserts
// every listed key against those handlers so the two cannot drift.
//
// Deliberately NOT listed: Esc. It is a modal affordance rather than an app
// shortcut: the dialogs that handle it (the one-off download modal, the
// subscribe modal, the expanded cover art, the sort menu, and this one) close
// on it, while several others (the move modal, the hard-delete confirm, the
// playlists sheet) do not -- so documenting it in a PLAYBACK reference would
// invite the question of what it closes and when.
//
// Esc is NOT "universal" in this app, and an earlier version of this comment
// said it was (gate S12(c) -- and I wrongly reported that corrected once
// already, which is how it survived to a second review). Since v1.47.8 this
// dialog's own Esc is PRIVILEGED: `wireKeyboardShortcutsHelp` binds in the
// CAPTURE phase and calls stopImmediatePropagation while the dialog is open,
// specifically so one Esc cannot also close the subscribe modal, the one-off
// download modal, and the expanded cover art underneath it. With no dialog
// open, Esc behaves exactly as it always has.
const KEYBOARD_SHORTCUT_GROUPS = [
  {
    title: 'Playback',
    items: [
      { keys: ['K', 'Space'], desc: 'Play / pause' },
      { keys: ['J'], desc: 'Back 10 seconds' },
      { keys: ['L'], desc: 'Forward 10 seconds' },
      { keys: ['ArrowLeft'], desc: 'Back 5 seconds' },
      { keys: ['ArrowRight'], desc: 'Forward 5 seconds' },
      { keys: ['0', '…', '9'], desc: 'Jump to 0% - 90% of the item' },
      { keys: ['<'], desc: 'Slow down' },
      { keys: ['>'], desc: 'Speed up' },
      // v1.50 (UI pass S3, D8.2): only live while the "Resumed at" toast is
      // showing (R went with the modal: the load has already resumed) -- the desc says so, keeping the reference's one rule ("every listed
      // key ACTUALLY works") honest about the scoping.
      { keys: ['S'], desc: 'Start over (while "Resumed at" shows)' },
    ],
  },
  {
    title: 'Sound & display',
    items: [
      { keys: ['ArrowUp'], desc: 'Volume up' },
      { keys: ['ArrowDown'], desc: 'Volume down' },
      // v1.47.8 gate W4: M exists (player.js `case 'm'`) and was missing here.
      // YouTube documents it, and omitting it from the group that lists the
      // volume keys is the most conspicuous possible place to omit it.
      { keys: ['M'], desc: 'Mute / unmute' },
      { keys: ['F'], desc: 'Fullscreen (audio: expand the cover art)' },
      { keys: ['C'], desc: 'Toggle captions (when the item has them)' },
      // v1.50.3: same job as the header moon/sun button, any page, desktop.
      { keys: ['D'], desc: 'Toggle dark / light mode' },
    ],
  },
  {
    title: 'Moving around',
    items: [
      // v1.47.8 gate W8: these drive whatever prev/next the current view
      // registered -- the next ITEM on a watch page, the next CHAPTER in the
      // reader -- and a watch page with no prev/next context registers nothing
      // at all. "Next item" alone was wrong in two of those three cases.
      { keys: ['Shift', 'N'], desc: 'Next item (next chapter while reading)' },
      { keys: ['Shift', 'P'], desc: 'Previous item (previous chapter while reading)' },
      { keys: ['?'], desc: 'Show this list' },
    ],
  },
  {
    title: 'Reading (books)',
    items: [
      { keys: ['ArrowLeft'], desc: 'Previous page' },
      { keys: ['ArrowRight'], desc: 'Next page' },
    ],
  },
];

// Step 7 (UI pass, D1-AC4): an arrow key's cap draws the registry arrow (the DDR row's
// glyphs), never a text arrow; the key is listed by its KeyboardEvent.key name, which is
// also what the drift lock matches against the handlers' `case 'ArrowLeft':`.
const SHORTCUT_KEY_ICONS = {
  ArrowLeft: { icon: 'arrow_back', label: 'Left arrow' },
  ArrowRight: { icon: 'arrow_forward', label: 'Right arrow' },
  ArrowUp: { icon: 'arrow_upward', label: 'Up arrow' },
  ArrowDown: { icon: 'arrow_downward', label: 'Down arrow' },
};

// The width at which this app considers itself "mobile" -- the SAME 768px the
// stylesheet's phone breakpoint uses. Dean asked for the reference to be absent
// on mobile, where there is no keyboard to speak of.
const SHORTCUTS_DESKTOP_QUERY = '(min-width: 769px)';

/**
 * Pure: is this a desktop-sized viewport? A browser without matchMedia (or one
 * that throws on it) is treated as desktop -- the reference is informational,
 * so failing toward "show it" costs a stray dialog at worst, while failing the
 * other way would silently remove the feature on machines that do have a
 * keyboard.
 */
function isDesktopViewport() {
  if (typeof window === 'undefined') return false;
  try {
    if (typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(SHORTCUTS_DESKTOP_QUERY).matches;
  } catch (_) {
    return true;
  }
}

/**
 * Pure: should this keydown open the shortcuts reference? `?` (Shift+/ on most
 * layouts) mirrors YouTube. Never while typing, never with a modifier that
 * would make it a browser/OS command.
 */
function shouldOpenShortcuts(e, activeTag, isEditable) {
  if (!e || e.key !== '?') return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (isEditable) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(String(activeTag || '').toUpperCase()) === -1;
}

/**
 * Build the reference dialog (sweep S9: a ui.sheet dialog - see the comment inside).
 * What keeps it from becoming the v1.17.0 full-viewport touch-eater is the sheet's own
 * teardown: a closed ui.sheet removes its scrim and box from the document.
 */
// v1.163 (Dean): the DDR "Keyboard Combos" easter egg - a hidden mini-synth in the
// shortcuts window (the Discord homage). Four arrows sit in the header top-right;
// pressing the matching arrow key (or clicking one) lights it up and plays a note,
// so you can noodle out a melody - "be the best FileTube FileTube Revolution
// player". The notes are a consonant C-D-E-G run (no dissonant clash). Pure map so
// it is testable; the synth is Web Audio, fully guarded (silent + never throws
// where AudioContext is absent, e.g. node:test).
// `axis` drives the press COLOUR (Dean's DDR scheme): 'h' = left/right = BLUE,
// 'v' = up/down = RED. Rendered as a `.shortcuts-ddr-arrow--h/--v` class the CSS
// colours on the press state (.ddr-hit).
// Sweep S9 (AC4): each arrow is a registry ICON (`icon`), never a text glyph - which
// also retires the U+FE0E text-presentation workaround (v1.163.1: iOS painted the
// text arrows as colour emoji; a drawn glyph has no emoji presentation at all).
var DDR_ARROWS = [
  { key: 'ArrowLeft', icon: 'arrow_back', label: 'Left', freq: 523.25, axis: 'h' },      // C5, blue
  { key: 'ArrowDown', icon: 'arrow_downward', label: 'Down', freq: 587.33, axis: 'v' },  // D5, red
  { key: 'ArrowUp', icon: 'arrow_upward', label: 'Up', freq: 659.25, axis: 'v' },        // E5, red
  { key: 'ArrowRight', icon: 'arrow_forward', label: 'Right', freq: 783.99, axis: 'h' }, // G5, blue
];
function ddrNoteForArrow(key) {
  for (var i = 0; i < DDR_ARROWS.length; i++) if (DDR_ARROWS[i].key === key) return DDR_ARROWS[i].freq;
  return 0;
}
var ddrAudioCtx = null;
function playDdrNote(freq) {
  if (typeof window === 'undefined' || !(Number(freq) > 0)) return;
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!ddrAudioCtx) ddrAudioCtx = new Ctx();
    if (ddrAudioCtx.state === 'suspended' && typeof ddrAudioCtx.resume === 'function') ddrAudioCtx.resume();
    var now = ddrAudioCtx.currentTime;
    var osc = ddrAudioCtx.createOscillator();
    var gain = ddrAudioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = Number(freq);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(gain);
    gain.connect(ddrAudioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.34);
  } catch (_) { /* audio unavailable -> the easter egg is silent, never throws */ }
}

// ---- v1.166 (Dean): Sneaky critter mode -------------------------------------
// A completely optional fun mode: little critters PEEK OUT FROM BEHIND page
// furniture (cards, boxes, menus) at jaunty angles - never over the playback
// surfaces. The whole subsystem is inert until the per-device setting is on.
// Architecture (exec plan: docs/exec-plans/completed/2026-08-22-critter-mode-skeleton.md):
//   - `#critter-layer` sits at z-index 2 (above z-auto furniture, below every
//     --z-* ladder rung); the "hidden behind the anchor" half is CLIPPED away
//     per-critter (buildCritterClip, the v1.168 sandwich) rather than hidden by
//     stacking, so a critter peeks from behind its ONE anchor and above all
//     other furniture. (The original skeleton used a z:-1 plane; superseded.)
//   - The pure core (config/plan/hit) takes rects in and gives placements out,
//     so it is node:test-able without layout; only the thin measure/render
//     shims touch the live DOM.
//   - The manifest is THE FOLDER: /api/critters lists public/critters/ (name-
//     agnostic; Dean drops files in). Empty folder -> 3 built-in SVG figurines.
//   - Tap (on the EXPOSED sliver only) -> the critter's own sound file if one
//     exists, else a synth chirp. The listener never preventDefaults and stands
//     down when the click landed on real interactive UI.
var CRITTER_DENSITY_COUNTS = { sparse: 1, normal: 6, obscene: 16 };
var CRITTER_STORAGE_ON = 'ft-critters:on';
var CRITTER_STORAGE_DENSITY = 'ft-critters:density';
// v1.185 (Dean): opt-in "random sound each tap" for critters WITHOUT their own
// same-named file. Default OFF preserves v1.179's stable borrowed voice
// (identity, not a soundboard); ON draws a fresh random sound from the whole
// pool per tap. A same-named owned sound always plays regardless.
var CRITTER_STORAGE_RANDOMSOUND = 'ft-critters:randomsound';
// v1.187 (Dean): critter SIZE choice. The scale multiplies the planner's computed
// size AND the cross-axis proportion allowance (so "large" actually reads large
// instead of being shrunk straight back to its anchor's extent) - every SAFETY
// invariant (exclusions, document bounds, the screen-edge rule, the peek rule) is
// unscaled and still hard-skips a placement. scale 1 == byte-identical to v1.186.
var CRITTER_SIZE_SCALES = { tiny: 0.5, normal: 1, large: 2, xlarge: 3 };
var CRITTER_STORAGE_SIZE = 'ft-critters:size';
// v1.193 (Dean): EXPERIMENTAL opt-in "let critters overlap a little" (the "light
// kiss"). Default OFF = the v1.192 STRICT no-overlap rule (a placement is dropped
// if its box touches any accepted critter's box at all). ON relaxes that to an
// AREA budget: a placement is dropped only if it would cover MORE than this
// fraction of the smaller box's area, so a light graze survives but a real stack
// (Dean's tower) still does not. 0.25 = "~1/4 of a box", the amount Dean signed
// off on; tune here. OFF passes overlapAllow 0, which is byte-identical to strict
// (any positive-area overlap is rejected, tangent boxes still allowed).
var CRITTER_STORAGE_KISS = 'ft-critters:kiss';
var CRITTER_KISS_FRACTION = 0.25;
// v1.188 (Dean): an UPSCALED bottom-family critter only hangs upside-down when
// its anchor covers at least "most" (>= half) of its box - below this, the body
// is too visible for the flip to read as a peek and it just looks flipped over.
// See the flip gate in planCritterScatter. Only consulted for sizeScale > 1.
var CRITTER_FLIP_MIN_COVERAGE = 0.5;
// Anchors: page furniture worth peeking from behind. Curated, generic across
// views; each candidate must also SURVIVE the exclusion filters below. Every
// entry must PAINT A BACKGROUND (the per-critter sandwich CLIP hides the covered
// half only where the anchor actually paints) - `.action-bar` was dropped for
// exactly that reason (grid + gap only, no background: the "hidden" half showed
// through the gutters).
// v1.166.2 (Dean's device pass: the WATCH page had none - it uses none of the
// original four): + `.description-container` (paints --bg-sidebar) and
// `.related-thumb` (paints letterbox black - the CARD itself is a transparent flex row, caught by the ground-contract lock). The comments section is
// deliberately NOT an anchor: it paints no background, so a critter "behind"
// it would show through. Peeks that would reach the adjacent #player-wrapper
// are already skipped by the placement-rect exclusion check.
// v1.167 (Dean: "everywhere... popping up behind the button in a cute
// cartoonish way"): the MACHINE-DERIVED per-view sweep (exec plan carries the
// full accept/reject table) - `.btn` (buttons, PRIORITY-weighted),
// `.history-thumb` (now the `.ui-thumb` anchor, sweep S2), `.book-row-cover`, `.music-artist-mosaic`,
// `.podcast-card-art`, `.comment-input-box`. Rejected as TRANSPARENT (the
// tightened ground contract): the music/podcast CARDS (their art tiles paint
// instead), history/song/stable rows, comment-item.
// UI pass S6: the podcast art is the shared `.ui-art` rounded square now (ui.css paints
// its --thumb-ground), so the pool names the primitive instead of the retired
// `.podcast-card-art`; every surface that adopts ui-art (albums, books) anchors too.
// UI pass S5: the Subscriptions row became a ui-row, which paints NO background (the
// ground contract), so the retired `.sub-row` left the pool like the other transparent rows.
var CRITTER_ANCHOR_SELECTORS = [
  '.video-card', '.setup-box', '.md-group-card', '.md-hero', '.description-container',
  '.btn', '.book-row-cover', '.music-artist-mosaic', '.ui-art', '.comment-input-box',
  // v1.169 (Dean: the mobile feed needs critters ON the cards): the thumbnail
  // (paints its ground - critters rise from behind the artwork onto the title
  // zone) and the small channel-avatar circle (a micro-ambush; the anchor
  // minimum drops for it, pool stays curated). UI pass sweep S2: every
  // thumbnail the sweep migrated - the cards', the watch page's related rail
  // (was `.related-thumb`) and History's rows (was `.history-thumb`) - is the
  // ui-thumb primitive, which paints --thumb-ground; the card avatar is a
  // ui-avatar (the same ground).
  '.ui-thumb', '.video-card .ui-avatar',
];
// Buttons get sampling PRIORITY (Dean's ambush-over-wallpaper ruling): anchors
// matching these selectors carry weight 3 in the without-replacement sample.
var CRITTER_PRIORITY_SELECTORS = ['.btn'];
var CRITTER_PRIORITY_WEIGHT = 3;
// Playback surfaces + modals: never an anchor, never overlapped, and the tap
// handler stands down over them (Dean's hard constraint - critters must not
// disrupt the video/audio experience). `[class*="-backdrop"]` covers the WHOLE
// modal/sheet backdrop family (11 classes today) and any future sibling - the
// gate's QA seat caught the previous single-class spelling as the recurring
// one-of-N enumeration hole.
// v1.215 (Dean's v1.214 device pass): `.music-toolbar` joins the no-critter
// zones. Its Shuffle/Scan buttons are `.btn`s (a PRIORITY anchor), so a critter
// anchored to Shuffle sat right ON the control - and because the toolbar is
// z-auto while the critter plane is z:2, a critter peeking up from the artwork
// below could also paint over the whole dense control strip (Dean's fox-over-
// Shuffle screenshot). As an exclusion, its buttons are no longer anchors AND
// no placement rect may overlap it (the planner clears every exclusion for both
// the anchor and the critter's own box), so the control strip stays clean.
// NOTE: `.music-toolbar` is shared markup - the Podcasts page uses the same
// class (podcasts.html), so this keeps critters off that control strip too
// (harmless/beneficial - the same "don't obscure controls" intent).
// v1.216 (Dean's v1.215 device pass): the now-playing METADATA + UP-NEXT panel
// joins the list. The big-art player itself was ALREADY a no-go zone - the
// expanded audio view is `#audio-bg-art` inside `.player-container#player-wrapper`
// (index.html), already excluded above. What was NOT covered is the panel BELOW
// it, `.music-nowplaying-panel` (the title/artist + the Up-next queue). Its
// up-next rows (`.mnp-queue-*`) are not critter anchors, so the critter Dean saw
// draped over the title was anchored to NEARBY BROWSE furniture (an artist
// circle / card / button) with its placement BOX overhanging the panel - and
// nothing dropped a box that overlapped the panel, because the panel was not an
// exclusion (Dean's squirrel-over-now-playing screenshot). As an exclusion rect,
// the planner now drops any placement box that overlaps it. Uses the CLASS, not
// the `#music-nowplaying-panel` id: the Podcasts now-playing panel
// (`#podcast-nowplaying-panel`) carries the SAME class, so this covers both
// consistently (the `.music-toolbar` shared-class precedent one block up).
var CRITTER_EXCLUSION_SELECTORS = ['#player-wrapper', '.player-container', '#player-dock', '#fs-stage', '.music-nowplaying-panel', '.music-toolbar', '[class*="-backdrop"]'];
// Tap reactions (Dean): tiny, transform-only, contained to the critter's own
// box; one is picked at random per tap. All die under prefers-reduced-motion.
// v1.176 (Dean: "what other small cute animations can we add? I like that to
// be varied"): three joiners - a full twirl, a shy duck-down, and a classic
// squash-and-stretch. All transform-only, all riding the pose's angle+flip.
// v1.191 (Dean: "add a few more sets" then "even more... a GREAT variety"): the
// original six + nod, wobble (jelly), boing (spring), swing (pendulum), pop,
// headshake, tada, rubberband, backflip, doublehop, peek, float = 18. All
// transform-only, all ride the pose's angle+flip, all die under
// prefers-reduced-motion (see the CSS list). One is picked at random per tap.
// v1.311.2 (Dean ruling 2026-09-22): "critters must never block button
// functionality". A critter tap whose target sits inside one of these still
// reacts, but never swallows the click. Covers native controls, ARIA widgets,
// the app's .btn class and inline-onclick furniture.
var CRITTER_INTERACTIVE_SELECTORS = ['a[href]', 'button', 'summary', 'label', 'select', 'input', 'textarea',
  '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]', '[role="switch"]', '[role="checkbox"]',
  '[role="option"]', '[onclick]', '.btn'];
function critterOverInteractive(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.closest(CRITTER_INTERACTIVE_SELECTORS.join(','))) return true;
  // v1.311.2 gate W4 (adversary, measured): the NET for clickable furniture that is
  // not a button - a div row with a delegated click (the music song row) is styled
  // `cursor: pointer`, the app's own "this is clickable" signal. Walked only after
  // a geometric critter hit, so an ordinary click never pays for it.
  const win = target.ownerDocument && target.ownerDocument.defaultView;
  if (!win || typeof win.getComputedStyle !== 'function') return false;
  const body = target.ownerDocument.body;
  for (let node = target; node && node.nodeType === 1 && node !== body; node = node.parentElement) {
    const cs = win.getComputedStyle(node);
    if (cs && cs.cursor === 'pointer') return true;
  }
  return false;
}
var CRITTER_REACTIONS = ['critter-wiggle', 'critter-shiver', 'critter-hop', 'critter-twirl', 'critter-duck', 'critter-squish', 'critter-nod', 'critter-wobble', 'critter-boing', 'critter-swing', 'critter-pop', 'critter-headshake', 'critter-tada', 'critter-rubberband', 'critter-backflip', 'critter-doublehop', 'critter-peek', 'critter-float'];

function resolveCritterConfig(read) {
  var get = typeof read === 'function' ? read : function (k) {
    try { return localStorage.getItem(k); } catch (_) { return null; }
  };
  var enabled = get(CRITTER_STORAGE_ON) === '1';
  var raw = get(CRITTER_STORAGE_DENSITY);
  var density = Object.prototype.hasOwnProperty.call(CRITTER_DENSITY_COUNTS, raw) ? raw : 'normal';
  var randomSound = get(CRITTER_STORAGE_RANDOMSOUND) === '1'; // default OFF (v1.179 stable voice)
  // v1.187: size choice - unset/garbage falls back to 'normal' (the fail-safe
  // shape every critter pref uses, so a corrupt value can never surprise Dean).
  var rawSize = get(CRITTER_STORAGE_SIZE);
  var size = Object.prototype.hasOwnProperty.call(CRITTER_SIZE_SCALES, rawSize) ? rawSize : 'normal';
  // v1.193 (Dean): the "light kiss" experimental pref. Default OFF -> overlapAllow
  // 0 -> byte-identical to the v1.192 strict rule. ON -> a small area budget.
  var allowOverlap = get(CRITTER_STORAGE_KISS) === '1';
  return {
    enabled: enabled,
    density: density,
    count: CRITTER_DENSITY_COUNTS[density],
    randomSound: randomSound,
    size: size,
    sizeScale: CRITTER_SIZE_SCALES[size],
    allowOverlap: allowOverlap, // the UI checkbox state
    overlapAllow: allowOverlap ? CRITTER_KISS_FRACTION : 0, // the engine's area budget
  };
}

// The three ORIGINAL built-in figurines (bunny / cat / bear silhouettes), used
// only while public/critters/ holds no images. fill/stroke ride currentColor so
// the era tokens + per-critter hue-rotate colour them; no raw colour literals.
var CRITTER_BUILTINS = [
  { id: 'builtin-bun', svg: '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="24" cy="14" rx="5" ry="12" fill="currentColor" opacity="0.85"/><ellipse cx="40" cy="14" rx="5" ry="12" fill="currentColor" opacity="0.85"/><circle cx="32" cy="30" r="14" fill="currentColor"/><ellipse cx="32" cy="50" rx="16" ry="12" fill="currentColor" opacity="0.9"/><circle cx="27" cy="28" r="2" fill="currentColor" opacity="0.35"/><circle cx="37" cy="28" r="2" fill="currentColor" opacity="0.35"/></svg>' },
  { id: 'builtin-cat', svg: '<svg viewBox="0 0 64 64" aria-hidden="true"><polygon points="18,20 24,6 30,18" fill="currentColor" opacity="0.85"/><polygon points="34,18 40,6 46,20" fill="currentColor" opacity="0.85"/><circle cx="32" cy="30" r="14" fill="currentColor"/><ellipse cx="32" cy="51" rx="15" ry="11" fill="currentColor" opacity="0.9"/><circle cx="27" cy="28" r="2" fill="currentColor" opacity="0.35"/><circle cx="37" cy="28" r="2" fill="currentColor" opacity="0.35"/><path d="M54 46 q6 -6 2 -14" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.85"/></svg>' },
  { id: 'builtin-bear', svg: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="20" cy="14" r="7" fill="currentColor" opacity="0.85"/><circle cx="44" cy="14" r="7" fill="currentColor" opacity="0.85"/><circle cx="32" cy="31" r="15" fill="currentColor"/><ellipse cx="32" cy="52" rx="17" ry="11" fill="currentColor" opacity="0.9"/><circle cx="26" cy="29" r="2" fill="currentColor" opacity="0.35"/><circle cx="38" cy="29" r="2" fill="currentColor" opacity="0.35"/><ellipse cx="32" cy="36" rx="4" ry="3" fill="currentColor" opacity="0.35"/></svg>' },
  { id: 'builtin-fox', svg: '<svg viewBox="0 0 64 64" aria-hidden="true"><polygon points="16,22 20,4 30,16" fill="currentColor" opacity="0.85"/><polygon points="34,16 44,4 48,22" fill="currentColor" opacity="0.85"/><circle cx="32" cy="30" r="14" fill="currentColor"/><polygon points="26,34 32,44 38,34" fill="currentColor" opacity="0.7"/><ellipse cx="32" cy="51" rx="15" ry="11" fill="currentColor" opacity="0.9"/><circle cx="26" cy="27" r="2" fill="currentColor" opacity="0.35"/><circle cx="38" cy="27" r="2" fill="currentColor" opacity="0.35"/><path d="M50 52 q10 -2 8 -14" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.8"/></svg>' },
  { id: 'builtin-chick', svg: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="26" r="13" fill="currentColor"/><ellipse cx="32" cy="48" rx="14" ry="12" fill="currentColor" opacity="0.9"/><polygon points="28,26 20,29 28,32" fill="currentColor" opacity="0.7"/><circle cx="35" cy="24" r="2" fill="currentColor" opacity="0.35"/><ellipse cx="44" cy="47" rx="5" ry="8" fill="currentColor" opacity="0.75"/><ellipse cx="20" cy="47" rx="5" ry="8" fill="currentColor" opacity="0.75"/><path d="M28 8 q4 -6 8 0" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.8"/></svg>' },
];

function critterRectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// v1.193 (Dean's "light kiss" experimental pref): the inter-critter drop test,
// parameterised by an AREA budget. `allow` is the fraction of the SMALLER box's
// area two critters may share; returns true when they exceed it (-> drop the
// later one). allow 0 (the default / strict setting) rejects ANY positive-area
// overlap - byte-identical to the old `critterRectsIntersect` gate, since a
// tangent (zero-area) touch is not an overlap here either. Used ONLY for
// critter-vs-critter; exclusions/anchor checks still use critterRectsIntersect.
function critterOverlapExceeds(a, b, allow) {
  var ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  var iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ix <= 0 || iy <= 0) return false; // apart or merely tangent
  return ix * iy > (allow || 0) * Math.min(a.w * a.h, b.w * b.h);
}

// PURE: rects in -> placements out. `rng` is injectable for deterministic tests.
// Samples anchors AND critters WITHOUT replacement (the no-duplicate rule is
// absolute: the count caps at the manifest length - 3 while only the built-ins
// exist, growing as Dean fills the folder). Each critter straddles one edge of
// its anchor: ~55% hidden behind it (the sandwich CLIP does the hiding), ~45% peeking.
function planCritterScatter(opts) {
  var anchors = (opts && opts.anchors) || [];
  var exclusions = (opts && opts.exclusions) || [];
  var manifest = (opts && opts.manifest) || [];
  var count = (opts && opts.count) | 0;
  var rng = (opts && typeof opts.rng === 'function') ? opts.rng : Math.random;

  var usable = anchors.filter(function (a) {
    // v1.169: minimum lowered 48x32 -> 24x24 so the channel-avatar circle can
    // host a micro-ambush; the pool is curated, so nothing unintended qualifies.
    if (!a || a.w < 24 || a.h < 24) return false; // too small to hide behind
    return !exclusions.some(function (e) { return critterRectsIntersect(a, e); });
  });
  var shuffle = function (arr) {
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  };
  // v1.167: WEIGHTED without-replacement anchor sampling (Efraimidis-Spirakis:
  // key = rng^(1/weight), take the largest keys) - buttons carry weight 3, so
  // the ambush spots win more of the draw without ever starving other anchors.
  var anchorPool = usable
    .map(function (a) { return { a: a, k: Math.pow(rng(), 1 / (a.weight > 0 ? a.weight : 1)) }; })
    .sort(function (p, q) { return q.k - p.k; })
    .map(function (p) { return p.a; });
  var critterPool = shuffle(manifest);
  var n = Math.min(count, anchorPool.length, critterPool.length);
  var bounds = (opts && opts.bounds) || null; // {w,h} document size - placements never grow the page
  var viewportW = (opts && opts.viewportW) || 0; // v1.180: the SCREEN edge; 0 = not enforced (pure tests)
  // v1.187 (Dean's size choice): multiplies the computed size, its floor/cap, AND
  // the cross-axis proportion allowance below. Default 1 = byte-identical to
  // v1.186 (every existing direct-call test passes no sizeScale).
  var sizeScale = (opts && opts.sizeScale) || 1;
  // v1.193 (Dean): the inter-critter overlap AREA budget - 0 (default/strict) drops
  // any positive-area overlap; the "light kiss" pref passes CRITTER_KISS_FRACTION.
  var overlapAllow = (opts && opts.overlapAllow) || 0;
  // The v1.170 26px floor, scaled. The 8px clamp never binds for the four shipped
  // rungs (tiny's floor is 13); it only guards a hypothetical future scale < 0.31.
  var sizeFloor = Math.max(8, Math.round(26 * sizeScale));
  var placements = [];
  // v1.168 (Dean: "not really going as hard as we could"): four edges PLUS the
  // four corners (diagonal ambushes), and the peek DEPTH is randomized per
  // placement - anywhere from a shy sliver to a bold half-body lean.
  var EDGES = ['top', 'left', 'right', 'bottom', 'tl', 'tr', 'bl', 'br'];
  for (var k = 0; k < n; k += 1) {
    var a = anchorPool[k];
    var c = critterPool[k];
    // v1.167 SCALE-TO-ANCHOR (Dean's ruling): behind a SMALL element (a button)
    // the critter shrinks to ~1.1-1.5x the anchor's height so it reads as
    // hiding behind it; bigger furniture keeps the original 44-88px band.
    // v1.187: the whole band scales with Dean's size choice (floor/cap included).
    var size = a.h <= 64
      ? Math.min(Math.round(88 * sizeScale), Math.max(sizeFloor, Math.round(a.h * (1.1 + rng() * 0.4) * sizeScale)))
      : Math.round((44 + Math.floor(rng() * 44)) * sizeScale); // CODE owns display size either way
    // v1.169 FULL-BLEED RULE (Dean's mobile-feed screenshots: side peeks off a
    // full-width card land ON THE SCREEN EDGE and look amputated): an anchor
    // spanning ~the whole document width only peeks TOP or BOTTOM - emerging
    // between the artwork and the title, never off the side of the phone.
    // v1.180: full-bleed is judged against the SMALLER of document and
    // viewport width - an overflowing page inflates scrollWidth and used to
    // let a visually-full-bleed card keep its side peeks (Dean's amputated
    // pink-dress screenshot).
    var effW = bounds ? (viewportW ? Math.min(bounds.w, viewportW) : bounds.w) : 0;
    var fullBleed = bounds && a.w >= effW * 0.85;
    var pool = fullBleed ? ['top', 'bottom'] : EDGES;
    var edge = pool[Math.floor(rng() * pool.length)];
    // v1.170 CROSS-AXIS FIT (Dean's screenshots: a critter TALLER than its
    // button reads as a notched floating cut-out - the sandwich clip hides
    // only where the anchor actually covers, so the bands past the anchor's
    // far edges stay visible). The critter's ROTATED extent perpendicular to
    // the peek direction may not exceed the anchor's extent there (15% grace):
    // shrink the critter first; at the 26px floor flatten the TILT instead -
    // a micro-anchor hosts a near-upright critter its own size. The tilt is
    // drawn here (not at push) because the fit depends on it: a square of
    // side s rotated by t has an axis-aligned extent of s*(sin|t|+cos|t|).
    var tilt = Math.round(rng() * 76) - 38; // v1.168: wilder lean (was +-24)
    var rad = Math.abs(tilt) * Math.PI / 180;
    var spread = Math.sin(rad) + Math.cos(rad);
    var vertical = edge === 'top' || edge === 'bottom';
    // v1.187: the PROPORTION allowance scales with Dean's size choice too -
    // otherwise this rule would shrink every large critter straight back to its
    // anchor's extent and "large"/"extra large" would look identical to normal.
    // The rule keeps its SHAPE (a critter still may not sprawl past its anchor
    // beyond the grace), just in proportion to the chosen size. scale 1 is
    // byte-identical to v1.186. The SAFETY invariants below are NOT scaled.
    var crossAllow = (edge.length === 2 ? Math.min(a.w, a.h) : (vertical ? a.w : a.h)) * 1.15 * sizeScale;
    if (size * spread > crossAllow) {
      size = Math.max(sizeFloor, Math.floor(crossAllow / spread));
      if (size * spread > crossAllow) {
        // Floored and still too wide: solve sin t + cos t <= allow/floor
        // (= sqrt(2)*sin(t+45deg)) for the largest tilt that fits. Anchors are
        // >=24px, so allow >= 27.6 and a fit always exists at some tilt >= 0.
        var kFit = Math.min(Math.SQRT2, crossAllow / sizeFloor);
        var maxTilt = Math.max(0, Math.floor(Math.asin(kFit / Math.SQRT2) * 180 / Math.PI - 45));
        tilt = Math.sign(tilt) * Math.min(Math.abs(tilt), maxTilt);
      }
    }
    // Exposed fraction: 30%..65% of the critter sticks out (was a fixed 45%).
    var ex = 0.30 + rng() * 0.35;
    // v1.168 SANDWICH (Dean: "behind its ONE starting thing, above everything
    // else"): `cover` records, in critter-LOCAL px, which side(s) of the box
    // the anchor conceals - the renderer CLIPS that region away and the whole
    // layer now paints ABOVE the furniture, so only the anchor "hides" the
    // critter and no neighbouring hairline/box ever swallows the peek.
    var cover = { t: 0, r: 0, b: 0, l: 0 };
    var hid = Math.round(size * (1 - ex));
    var x; var y;
    if (edge === 'top') { x = a.x + rng() * Math.max(0, a.w - size); y = a.y - size * ex; cover.b = hid; }
    else if (edge === 'bottom') { x = a.x + rng() * Math.max(0, a.w - size); y = a.y + a.h - size * (1 - ex); cover.t = hid; }
    else if (edge === 'left') { x = a.x - size * ex; y = a.y + rng() * Math.max(0, a.h - size); cover.r = hid; }
    else if (edge === 'right') { x = a.x + a.w - size * (1 - ex); y = a.y + rng() * Math.max(0, a.h - size); cover.l = hid; }
    else {
      // Corners: poke out diagonally - each axis exposes 25-50% independently.
      var cx = 0.25 + rng() * 0.25;
      var cy = 0.25 + rng() * 0.25;
      x = (edge === 'tl' || edge === 'bl') ? a.x - size * cx : a.x + a.w - size * (1 - cx);
      y = (edge === 'tl' || edge === 'tr') ? a.y - size * cy : a.y + a.h - size * (1 - cy);
      if (edge === 'tl' || edge === 'bl') cover.r = Math.round(size * (1 - cx)); else cover.l = Math.round(size * (1 - cx));
      if (edge === 'tl' || edge === 'tr') cover.b = Math.round(size * (1 - cy)); else cover.t = Math.round(size * (1 - cy));
    }
    // NO zero-clamp (gate W2): an origin-flush anchor's left/top peek goes
    // NEGATIVE and simply clips off-page - still a peek. Clamping snapped the
    // whole critter INSIDE the anchor: fully hidden, untappable, refuting the
    // peek invariant ~1/3 of the time on full-bleed mobile cards.
    x = Math.round(x); y = Math.round(y);
    var rect = { x: x, y: y, w: size, h: size };
    // v1.187 gate (BOTH seats) THE ENGULF INVARIANT: a critter that wholly
    // CONTAINS its anchor is not a peek - it is the anchor wearing a costume.
    // The sandwich clip has no answer for that topology either
    // (buildCritterClip's `touches === 0` island branch returns '' -> the
    // renderer sets NO clip-path -> the critter paints fully OVER its own
    // furniture, the "floating cut-out" three waves were spent eliminating).
    // Unreachable before v1.187 because the cross-fit capped size at 1.15x the
    // anchor; reachable once that cap scales, so it is now an EXPLICIT skip
    // (never a nudge) - and it is what keeps the island branch genuinely dead.
    // STRICT containment (gate D1): a TANGENT anchor edge still produces a
    // touched side and therefore a real clip, so `>=` wrongly discarded valid
    // T-notches - 4 per ~23k at scale 1 (breaking byte-parity with v1.186) and
    // 31-66% of the large/xlarge placements this guard drops, concentrated on
    // exactly the v1.169 micro-ambush anchors (avatars). Strict is island-exact.
    if (a.x > x && a.y > y && a.x + a.w < x + size && a.y + a.h < y + size) continue;
    // The placement's OWN rect must also clear every exclusion (gate W1: the
    // anchor check alone let a peek REACH INTO an adjacent player/dock - the
    // "never overlapped" half of Dean's constraint). Skip, never nudge.
    if (exclusions.some(function (e) { return critterRectsIntersect(rect, e); })) continue;
    // And it must never GROW the document (gate W4): a right/bottom-edge peek
    // past the page bounds would widen the scrollable area = layout shift.
    if (bounds && (x + size > bounds.w || y + size > bounds.h)) continue;
    // v1.180 THE SCREEN-EDGE INVARIANT (supersedes the v1.169 W2 trade that
    // let negative-x peeks "clip off-page"): a critter may never CROSS the
    // viewport's left or right edge - horizontal off-screen always reads as
    // an amputation. Vertical crossing stays legal (pages scroll that way).
    // v1.192 (Dean's mobile horizontal-scroll screenshot): the guard must clear
    // the RENDER PAD too. renderCritterPlacements inflates the wrapper by
    // pad = round(w*0.3) on EVERY side (rotation headroom); that pad is
    // transparent but still counts for scrollWidth, so an edge-flush critter's
    // padded box poked past the viewport - and because html{overflow-x:clip} is
    // the app's ONLY horizontal clamp and iOS Safari honours root-propagated
    // clip weakly, that surfaced as a horizontal scrollbar on Dean's phone.
    // Clamp the PADDED extent [x-pad, x+size+pad] inside [0, viewportW]. The pad
    // MUST match the renderer's exactly (round(size*0.3)). Horizontal only: a
    // vertical pad overflow just extends the page's legal scroll axis.
    var edgePad = Math.round(size * 0.3);
    if (viewportW && (x - edgePad < 0 || x + size + edgePad > viewportW)) continue;
    // v1.192 (Dean: "some way to make sure they don't LITERALLY overlap - a
    // little abrupt when they do"): critters may never overlap EACH OTHER. The
    // without-replacement anchor draw already stops two critters SHARING an
    // anchor, but neighbouring anchors (a vertical thumbnail column) fling their
    // peeks into one band and pile a stack on a single spot - Dean's screenshot.
    // Reject any placement whose box intersects an ALREADY-ACCEPTED critter's
    // box (skip, never nudge - the house doctrine, same as every guard above).
    // Buttons are drawn first (weight 3), so the ambush spots win the overlap.
    // Checked on the UNROTATED bare boxes (the `size x size` footprint), not the
    // padded wrappers - the ~30% pad is rotation headroom and mostly transparent.
    // `critterOverlapExceeds` at allow 0 is strict (its tangent guard mirrors
    // `critterRectsIntersect`'s `<,>`), so merely-tangent boxes are allowed -
    // only real bare-box overlap is dropped. SCOPE (gate, adversarial
    // seat): this is bare-box-exact, not rendered-POSE-exact - a pose tilted up
    // to +-38deg has an axis-aligned extent ~1.4x its box, so two near-tangent
    // critters can still graze at the rotated corners (~13% of scatters, corner
    // art usually transparent). That kills Dean's fully-overlapping tower (the
    // reported bug) but not every last corner kiss - tracked as tech-debt #175.
    // Density self-limits on dense/narrow feeds (Dean's chosen strict trade).
    // v1.193: `overlapAllow` relaxes this from strict to an AREA budget when the
    // "light kiss" pref is on (0 = strict = byte-identical to v1.192).
    if (placements.some(function (q) {
      return critterOverlapExceeds(rect, { x: q.x, y: q.y, w: q.w, h: q.h }, overlapAllow);
    })) continue;
    // v1.170 (Dean: "looks like critter feet behind an element" - his own
    // suggested fix): a BOTTOM-family peek (edge or corner) rotates the pose
    // 180deg so the HEAD pops out below the ledge - hanging upside-down reads
    // sneaky; dangling feet read severed. Tilt still applies around the flip.
    var bottomFamily = edge === 'bottom' || edge === 'bl' || edge === 'br';
    // v1.188 (Dean): the 180deg bottom-flip reads as a sneaky upside-down PEEK
    // only when the anchor actually HIDES most of the critter (a head poking
    // down from behind a ledge). When the anchor covers little of it - the
    // common case at `large`/`xlarge`, where the whole body is plainly visible -
    // an upside-down critter just looks flipped-over and derpy ("if the element
    // doesn't cover most of the thing, being upside down just looks off"). Gate
    // the flip on measured COVERAGE: the fraction of the critter's box the
    // anchor's rect overlaps. SCALED sizes only (sizeScale > 1) - at tiny/normal
    // scale the cross-fit keeps the critter small relative to its anchor, so
    // this branch never fires and scale-1 output stays BYTE-IDENTICAL to v1.187
    // (no parity-test churn; the derp is strictly an upscaled-critter artifact).
    var ovX = Math.max(0, Math.min(a.x + a.w, x + size) - Math.max(a.x, x));
    var ovY = Math.max(0, Math.min(a.y + a.h, y + size) - Math.max(a.y, y));
    var anchorCoverage = (ovX * ovY) / (size * size);
    var hangUpsideDown = bottomFamily && !(sizeScale > 1 && anchorCoverage < CRITTER_FLIP_MIN_COVERAGE);
    placements.push({
      // v1.185: carry the OWNED pairing (`sound`, same-named file, null if none)
      // and the stable borrowed `voice` SEPARATELY - the tap path needs the
      // distinction: an owned sound always plays; a voiceless critter either
      // plays a random pool sound (the pref) or its stable borrow (v1.179).
      // Builtins carry neither and keep the chirp.
      id: c.id, img: c.img || null, sound: c.sound || null, voice: c.voice || null, svg: c.svg || null,
      x: x, y: y, w: size, h: size,
      angle: hangUpsideDown ? tilt + 180 : tilt,
      flip: rng() < 0.5 ? -1 : 1, // v1.168: mirrored half the time - twice the poses per PNG
      // v1.168 claim; the CLIP has derived from measured rects since v1.174, but
      // `cover` is NOT vestigial: renderCritterPlacements steers the v1.187 sneak
      // DIRECTION off cover.t, and the tests classify peek direction by it.
      cover: cover,
      // v1.170 (Dean's Bernard screenshot): a TRUE-CIRCLE anchor's hidden
      // region is the DISC, not the bounding square - the renderer swaps the
      // rect clip for a circular mask so the cut follows the avatar's curve.
      roundCover: a.round
        ? { cx: Math.round(a.x + a.w / 2) - x, cy: Math.round(a.y + a.h / 2) - y, r: Math.round(Math.min(a.w, a.h) / 2) }
        : null,
      hue: Math.round(rng() * 360),
      anchor: { x: a.x, y: a.y, w: a.w, h: a.h },
      anchorEl: a.el || null, // v1.176: the live element, for the re-glue pass (null in pure tests)
      anchorSel: a.sel || null, // v1.178: the matched pool selector - lets re-glue ADOPT a rebuilt twin
      radii: a.radii || null, // v1.177: the anchor's painted corner radii - the shave mask follows them
    });
  }
  return placements;
}

// PURE tap hit-test. v1.191 (Dean): only the VISIBLE region of the critter wins a tap. The part of
// the box behind the critter's OWN anchor is CLIPPED away by the sandwich (the
// anchor - e.g. a button the critter peeks from behind - shows through there), so
// a tap over the anchor must go to the ANCHOR, not the critter. v1.188 made the
// WHOLE box win, which stole taps meant for the button behind it (Dean's report).
// The exposed peek + any body overhanging PAST the anchor (genuinely-visible png)
// still wins; the clipped-behind-the-anchor region stands down. Scan last-to-
// first so the visually-topmost critter wins an overlap.
function critterTapHit(placements, x, y) {
  var list = placements || [];
  for (var i = list.length - 1; i >= 0; i -= 1) {
    var p = list[i];
    var inBox = x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
    if (!inBox) continue;
    // Inside this critter's box but OVER its own anchor -> clipped/not visible ->
    // let the anchor keep the tap (fall through to any lower critter).
    var an = p.anchor;
    var inAnchor = an && x >= an.x && x <= an.x + an.w && y >= an.y && y <= an.y + an.h;
    if (!inAnchor) return p;
  }
  return null;
}

// v1.189.1 (Dean): even where the critter IS visible, a click that lands on an
// overlay PAINTED ABOVE the critter - the notification dropdown, a menu, a
// sheet, all on the --z-* ladder (900+), far above the critter layer's own
// z-index:2 - was wrongly treated as a critter tap: it chirped AND the
// capture-phase stopPropagation/preventDefault ATE the overlay's own click.
// This reports whether the click target is stacked at/above the critter plane,
// i.e. the critter is visually BEHIND it and must not win. It walks from the
// target up to <body>; the FIRST positioned ancestor carrying a numeric z-index
// strictly greater than the critter layer's own z-index means "painted above."
// Anchors the critters peek from are z-auto / below the layer by construction
// (the sandwich needs the critter to paint OVER its furniture), so a genuine
// peek tap never trips this. Reads the layer's LIVE z-index (default 2) so it
// tracks the CSS. Defensive: no window/getComputedStyle (a non-DOM/test context)
// -> reports NOT occluded, i.e. fail OPEN to the tap (unchanged behavior there).
function critterOccludedAt(target) {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return false;
  if (!target || target.nodeType !== 1 || typeof document === 'undefined') return false;
  var layerZ = 2; // matches .critter-layer's z-index in style.css; read live below
  var layer = document.getElementById('critter-layer');
  if (layer) {
    try {
      var lz = parseInt(window.getComputedStyle(layer).zIndex, 10);
      if (isFinite(lz)) layerZ = lz;
    } catch (_) { /* keep the default 2 - gate SUGGESTION: guard the layer read too */ }
  }
  var el = target;
  var body = document.body;
  while (el && el.nodeType === 1 && el !== body) {
    var cs;
    try { cs = window.getComputedStyle(el); } catch (_) { return false; }
    if (cs && cs.position !== 'static') {
      var z = parseInt(cs.zIndex, 10);
      if (isFinite(z) && z > layerZ) return true; // this ancestor paints ABOVE the critter plane
    }
    el = el.parentElement;
  }
  return false;
}

// The synth fallback chirp (two quick rising notes; the ddr synth's posture:
// guarded, a silent no-op wherever Web Audio is unavailable, never throws).
function playCritterChirp() {
  if (typeof window === 'undefined') return;
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!ddrAudioCtx) ddrAudioCtx = new Ctx();
    if (ddrAudioCtx.state === 'suspended' && typeof ddrAudioCtx.resume === 'function') ddrAudioCtx.resume();
    var now = ddrAudioCtx.currentTime;
    [987.77, 1318.51].forEach(function (freq, i) { // B5 -> E6, a happy little blip
      var osc = ddrAudioCtx.createOscillator();
      var gain = ddrAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      var t0 = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(gain);
      gain.connect(ddrAudioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.14);
    });
  } catch (_) { /* silent, never throws */ }
}

// v1.184: play one specific sound file, recording WHY (for the Voice check
// instrument) and falling back to the synth chirp on any failure. Shared by the
// owned-voice tap and the random/stable pool paths so all behave identically.
function playCritterSound(url) {
  try {
    new Audio(url).play().catch(function (err) {
      critterLastChirpReason = 'play rejected: ' + ((err && err.name) || 'unknown') + ' for ' + url;
      playCritterChirp();
    });
  } catch (err) {
    critterLastChirpReason = 'Audio constructor threw: ' + ((err && err.name) || 'unknown');
    playCritterChirp();
  }
}

// v1.184/v1.185: the deduped, SORTED set of every sound file the manifest
// carries - the manifest-derived FALLBACK pool for when a server omits its own
// voicePool. Sorted for a stable, deterministic pool (the determinism lesson);
// deduped so one file paired to two critters is not over-weighted in the random
// draw.
function buildCritterSoundPool(manifest) {
  var seen = {};
  var pool = [];
  (manifest || []).forEach(function (c) {
    var s = c && (c.voice || c.sound);
    if (s && !Object.prototype.hasOwnProperty.call(seen, s)) { seen[s] = true; pool.push(s); }
  });
  pool.sort();
  return pool;
}

// v1.185 (Dean chose random): a RANDOM sound from the full pool, or null when no
// sound files exist at all (-> the caller falls back to the chirp). `rng` is
// injectable for deterministic tests; production uses Math.random. Back-to-back
// repeats are accepted (Dean's ruling: "random each tap").
function pickCritterRandomSound(rng) {
  if (!critterSoundPool.length) return null;
  var r = typeof rng === 'function' ? rng : Math.random;
  var i = Math.floor(r() * critterSoundPool.length);
  if (i < 0) i = 0;
  if (i >= critterSoundPool.length) i = critterSoundPool.length - 1; // guard r()===1 / fp edge
  return critterSoundPool[i];
}

// DOM half. Renderer is jsdom-testable (placements injected); the measuring
// collectors are layout-dependent (device pass + source locks - disclosed).
var critterPlacements = [];
var critterManifestPromise = null;
// v1.185 (Dean): with the "random sound each tap" pref ON, a critter WITHOUT its
// own same-named sound plays a random pick from the whole pool per tap (variety);
// OFF (default) it keeps v1.179's stable borrowed voice. critterSoundPool is the
// FULL folder pool - the server's voicePool when present (complete), else a
// manifest-derived fallback (lossy but harmless for an older server).
var critterSoundPool = [];
var critterServerVoicePool = null; // transient: the server's voicePool captured mid-fetch
var critterWired = false;
var critterSettleChecks = 0; // v1.166.4/v1.173: the post-scatter settle ladder's count (re-armed per schedule)
var critterPlacedDocH = 0; // v1.173: document height at placement time - the settle checks judge DRIFT against it
var critterRetryTimer = null; // stashed so a NEW navigation can cancel a stale pending retry (the v1.163 stash-and-unbind class)
// v1.182 SETTLE-BEFORE-REVEAL: the wait phase's handles (all cancelled per
// navigation - the unstashed-handle class). The engine no longer places at a
// fixed +200ms against loading skeletons and corrects in view (the visible
// flash Dean reported); the FIRST placement now waits for the view's content
// to settle, so it is the ONLY placement, at the final layout.
var CRITTER_QUIET_MS = 300; // reveal this long after the last content mutation (a settled beat)
var CRITTER_REVEAL_CAP_MS = 2500; // Dean's cap: reveal no later than this even if the page never quiets
// v1.186.1 (Dean, device): + `.skeleton-shimmer` - the UNIVERSAL loading marker.
// `.skeleton-card` is the FEED's only; the WATCH page's related sidebar loads via
// `.related-thumb.skeleton-shimmer` / `.skeleton-line.skeleton-shimmer` (stripped
// when content lands, watch.js). Gating only on `.skeleton-card` let critters
// reveal EARLY on the watch page, then re-scatter when the related list rendered
// (Dean: "spawn then re-shuffle to all-new spots"). `.skeleton-shimmer` covers
// every shimmering surface; a page that shimmers forever still reveals at the cap.
var CRITTER_LOADING_SELECTORS = ['.skeleton-card', '.skeleton-shimmer']; // present => content still loading; a reveal now would re-drift when it lands
var critterQuietTimer = null; // the quiet debounce (re-armed by every content mutation, and once leading)
var critterCapTimer = null; // the hard-cap deadline from wait start
var critterWaitObs = null; // the wait-phase observer - SEPARATE from the post-reveal nudge observer (they never coexist)
var critterWaitObsDoc = null; // the document it observes - a swapped/torn-down document (jsdom) stands the callback down

function ensureCritterLayer() {
  var layer = document.getElementById('critter-layer');
  if (layer) return layer;
  layer = document.createElement('div');
  layer.id = 'critter-layer';
  layer.className = 'critter-layer';
  layer.setAttribute('aria-hidden', 'true'); // decorative; never in the a11y tree
  // v1.166.1 (Dean's device pass: NOTHING was visible): the critters' z-index 2
  // (see .critter-layer in style.css) resolves in the ROOT stacking context, so
  // they paint ABOVE the in-flow furniture (the v1.168 sandwich CLIP, not
  // stacking, hides the half behind the anchor) - which works ONLY because no
  // wrapper between them establishes a stacking context. That is the GROUND
  // CONTRACT: .main-content stays unpositioned and paints no background (its old
  // redundant background hid the ORIGINAL z:-1 plane; the no-background rule is
  // still locked by the critter-mode test - see the .main-content CSS comment
  // for the two-CRITICAL isolation detour this replaced). The layer parents
  // inside .main-content (sibling of #view-root:
  // survives view swaps, keeps document coordinates - no wrapper is
  // positioned); shells without one (login/welcome) fall back to body.
  var host = document.querySelector('.main-content') || document.body;
  host.appendChild(layer);
  return layer;
}

// v1.168 SANDWICH clip -> v1.174 GEOMETRIC TRUTH (Dean's Subscribed-button
// screenshot: a fragment with a hard cut floating OFF the button). The old
// clip hid whatever band the planner CLAIMED the anchor covers - claims were
// derived from the critter's own size and never clamped to the anchor's real
// extent, so a critter overlapping past the anchor's far edge (which the
// v1.170 cross-axis fit deliberately allows by 15%) got sliced where nothing
// hides it. Now the hidden region IS the measured intersection of the critter
// box and its anchor: pure geometry, no claims. The wrapper is the placement
// box inflated by `pad` (so the rotated pose never crops); the hidden rect
// extends to the wrapper edge exactly on the sides where the ANCHOR continues
// past the critter box (the pad strip there is genuinely covered too). The
// complement polygon follows from which wrapper edges the hidden rect touches:
// three -> a plain inset; two adjacent -> the corner L; ONE -> a C-notch (the
// bug case: anchor smaller than the critter's cross extent); two opposite ->
// a band with both free strips traced as one path. Every cut line now lies ON
// an anchor edge - a floating cut is geometrically impossible.
// v1.177 shared geometry: the HIDDEN rect (the measured critter/anchor
// intersection, extended to the wrapper edge wherever the anchor continues
// past the critter box), in wrapper-local coordinates. Consumed by BOTH the
// rectangular clip and the rounded shave mask - one truth, two emitters.
function critterHiddenRect(p, pad) {
  var a = p && p.anchor;
  if (!a) return null;
  var W = p.w + 2 * pad;
  var ix1 = Math.max(p.x, a.x); var iy1 = Math.max(p.y, a.y);
  var ix2 = Math.min(p.x + p.w, a.x + a.w); var iy2 = Math.min(p.y + p.h, a.y + a.h);
  if (ix2 <= ix1 || iy2 <= iy1) return null; // no overlap: nothing to hide
  return {
    W: W,
    x1: a.x <= p.x ? 0 : Math.round(pad + (ix1 - p.x)),
    y1: a.y <= p.y ? 0 : Math.round(pad + (iy1 - p.y)),
    x2: a.x + a.w >= p.x + p.w ? W : Math.round(pad + (ix2 - p.x)),
    y2: a.y + a.h >= p.y + p.h ? W : Math.round(pad + (iy2 - p.y)),
  };
}

function buildCritterClip(p, pad) {
  var h = critterHiddenRect(p, pad);
  if (!h) return '';
  var W = h.W;
  var x1 = h.x1; var y1 = h.y1; var x2 = h.x2; var y2 = h.y2;
  var T = y1 === 0; var R = x2 === W; var B = y2 === W; var L = x1 === 0;
  var touches = (T ? 1 : 0) + (R ? 1 : 0) + (B ? 1 : 0) + (L ? 1 : 0);
  var px = function (n) { return n + 'px'; };
  var pts = function (list) {
    var out = [];
    for (var i = 0; i < list.length; i += 2) out.push(px(list[i]) + ' ' + px(list[i + 1]));
    return 'polygon(' + out.join(', ') + ')';
  };
  if (touches === 4) return 'inset(' + px(Math.ceil(W / 2)) + ')'; // fully covered (planner peeks make this unreachable; guarded)
  if (touches === 3) {
    // One free side: the visible region is a single rect - a plain inset
    // (inset() offsets describe the VISIBLE box, so each cut comes from the
    // hidden side: free top keeps [0..y1], cutting W-y1 from the bottom).
    if (!T) return 'inset(0px 0px ' + px(W - y1) + ' 0px)';
    if (!R) return 'inset(0px 0px 0px ' + px(x2) + ')';
    if (!B) return 'inset(' + px(y2) + ' 0px 0px 0px)';
    return 'inset(0px ' + px(W - x1) + ' 0px 0px)'; // free left
  }
  if (touches === 2 && !((T && B) || (L && R))) {
    // Two ADJACENT sides: hide only the shared-quadrant L (v1.168 geometry).
    if (R && B) return pts([0, 0, W, 0, W, y1, x1, y1, x1, W, 0, W]);
    if (L && B) return pts([0, 0, W, 0, W, W, x2, W, x2, y1, 0, y1]);
    if (T && R) return pts([0, 0, x1, 0, x1, y2, W, y2, W, W, 0, W]);
    return pts([x2, 0, W, 0, W, W, 0, W, 0, y2, x2, y2]); // T && L
  }
  if (touches === 2) {
    // Two OPPOSITE sides: a band across; both free strips traced as one path.
    if (T && B) return pts([0, 0, x1, 0, x1, W, x2, W, x2, 0, W, 0, W, W, 0, W]);
    return pts([0, 0, W, 0, W, y1, 0, y1, 0, y2, W, y2, W, W, 0, W]); // L && R
  }
  if (touches === 1) {
    // ONE side: the anchor is cross-smaller than the critter - a C-notch.
    // HISTORY: at scale 1 the v1.170 cross-fit caps size at 1.15x the anchor's
    // cross extent, so this was unreachable and kept as defense-in-depth (the
    // reachable half of Dean's Subscribed-button fix was the corner/band
    // branches' measured cut positions - 1306 floating cuts to 0 over a 120x44
    // button). v1.187 CORRECTION (both gate seats measured it): the size choice
    // scales that cap, so at large/xlarge this becomes a COMMON topology - a
    // minority on a phone feed, ~15-21% on a desktop page at 2x, and roughly
    // half of watch-page placements at 3x. These figures move with the ENGULF
    // guard, so re-derive at the current commit before quoting them. A
    // deliberate, disclosed consequence of Dean asking for 2x/3x critters. Still exact-string
    // bound in all four orientations so it cannot rot silently (the v1.168 lesson).
    if (T) return pts([0, 0, x1, 0, x1, y2, x2, y2, x2, 0, W, 0, W, W, 0, W]);
    if (R) return pts([0, 0, W, 0, W, y1, x1, y1, x1, y2, W, y2, W, W, 0, W]);
    if (B) return pts([0, 0, W, 0, W, W, x2, W, x2, y1, x1, y1, x1, W, 0, W]);
    return pts([0, 0, W, 0, W, W, 0, W, 0, y2, x2, y2, x2, y1, 0, y1]); // L
  }
  // Island (anchor strictly inside the box). v1.187: the planner now SKIPS this
  // geometry outright (the ENGULF invariant in planCritterScatter) precisely
  // because there is no honest cut for it - an empty string means the renderer
  // sets no clip-path at all, i.e. a critter painting fully over its furniture.
  // So this stays unreachable BY CONSTRUCTION, not by arithmetic luck; if it
  // ever fires again the planner guard has regressed.
  return '';
}

// v1.170 SANDWICH mask for ROUND anchors (pure): the rect clip cuts straight
// hard edges through a critter wherever a circular avatar's square corners
// cover nothing (Dean's Bernard screenshot). For a true circle the concealed
// region IS the disc: a radial-gradient mask - transparent inside the circle,
// opaque outside (+0.5px feather for a crisp anti-aliased rim) - makes the cut
// follow the curve. Coordinates are wrapper-local: the placement box origin
// sits at (pad, pad) inside the inflated wrapper, so the anchor's centre
// (rc.cx, rc.cy in critter-local px) shifts by pad on both axes.
function buildCritterRoundMask(rc, pad) {
  return 'radial-gradient(circle at ' + (pad + rc.cx) + 'px ' + (pad + rc.cy) + 'px, transparent ' + rc.r + 'px, #000 ' + (rc.r + 0.5) + 'px)';
}

// v1.177 (Dean's Modern-2021 screenshots: square critter shoulders poking
// past ROUNDED button/tile corners - "edge being shaved to the actual
// button"): when the anchor paints rounded corners, the hidden region must
// be the same ROUNDED rect, not its bounding box. clip-path cannot express
// the complement of a rounded rect, but a mask can: an inline SVG data URI -
// an opaque full-wrapper square with the rounded hole punched out via
// fill-rule evenodd - rides the SAME --critter-mask/.critter-round plumbing
// the v1.170 circle fix proved out. A hole corner is rounded ONLY when it is
// a TRUE anchor corner (both of its sides are interior cuts); a side at the
// wrapper edge means the anchor continues past it, so its real corner lies
// outside the wrapper and the cut stays straight there. Radii clamp to the
// hole's half-extents.
function buildCritterShaveMask(p, pad) {
  var h = critterHiddenRect(p, pad);
  if (!h) return '';
  var rd = p.radii || { tl: 0, tr: 0, br: 0, bl: 0 };
  var W = h.W;
  var leftIn = h.x1 > 0; var topIn = h.y1 > 0; var rightIn = h.x2 < W; var botIn = h.y2 < W;
  var maxR = Math.floor(Math.min((h.x2 - h.x1) / 2, (h.y2 - h.y1) / 2));
  var cr = function (r, isAnchorCorner) {
    return isAnchorCorner ? Math.max(0, Math.min(Math.round(r || 0), maxR)) : 0;
  };
  var tl = cr(rd.tl, leftIn && topIn);
  var tr = cr(rd.tr, rightIn && topIn);
  var br = cr(rd.br, rightIn && botIn);
  var bl = cr(rd.bl, leftIn && botIn);
  var d = 'M0 0H' + W + 'V' + W + 'H0Z'
    + 'M' + (h.x1 + tl) + ' ' + h.y1
    + 'H' + (h.x2 - tr) + (tr ? 'A' + tr + ' ' + tr + ' 0 0 1 ' + h.x2 + ' ' + (h.y1 + tr) : '')
    + 'V' + (h.y2 - br) + (br ? 'A' + br + ' ' + br + ' 0 0 1 ' + (h.x2 - br) + ' ' + h.y2 : '')
    + 'H' + (h.x1 + bl) + (bl ? 'A' + bl + ' ' + bl + ' 0 0 1 ' + h.x1 + ' ' + (h.y2 - bl) : '')
    + 'V' + (h.y1 + tl) + (tl ? 'A' + tl + ' ' + tl + ' 0 0 1 ' + (h.x1 + tl) + ' ' + h.y1 : '')
    + 'Z';
  var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + W + ' ' + W + "'><path fill-rule='evenodd' d='" + d + "' fill='#fff'/></svg>";
  return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
}

function renderCritterPlacements(layer, placements, still) {
  layer.textContent = ''; // full rebuild every scatter - no accumulation
  (placements || []).forEach(function (p) {
    // v1.168 two-layer sandwich: the WRAPPER is axis-aligned and clipped (so
    // the cut hugs the anchor edge exactly), the POSE inside carries the
    // rotation/flip/hue - a tilted critter still gets a straight cut. The
    // wrapper is inflated by pad so the rotated pose never crops its corners.
    var pad = Math.round(p.w * 0.3);
    var el = document.createElement('div');
    // still=true (a v1.176 RE-GLUE rebuild): no arrival fade - an unmoved
    // critter must be visually inert through a correction.
    el.className = still ? 'critter critter-still' : 'critter';
    el.setAttribute('data-critter-id', p.id);
    el.style.left = (p.x - pad) + 'px';
    el.style.top = (p.y - pad) + 'px';
    el.style.width = (p.w + 2 * pad) + 'px';
    el.style.height = (p.h + 2 * pad) + 'px';
    if (p.roundCover) {
      // The mask value rides a CUSTOM PROPERTY; .critter-round in style.css
      // applies it under BOTH the -webkit- and standard mask-image spellings
      // (the v1.77 prefixed-vs-standard lesson, and jsdom-bindable besides).
      el.classList.add('critter-round');
      el.style.setProperty('--critter-mask', buildCritterRoundMask(p.roundCover, pad));
    } else if (p.radii && (p.radii.tl > 2 || p.radii.tr > 2 || p.radii.br > 2 || p.radii.bl > 2)) {
      // v1.177: a rounded (non-circle) anchor shaves the cut to its painted
      // corners via the SVG mask; radii of <=2px stay on the cheaper clip
      // (imperceptible at critter scale).
      var shave = buildCritterShaveMask(p, pad);
      if (shave) {
        el.classList.add('critter-round');
        el.style.setProperty('--critter-mask', shave);
      }
    } else {
      // v1.174: the clip derives from the MEASURED placement/anchor rects,
      // never from the planner's cover claims (see buildCritterClip).
      var clip = buildCritterClip(p, pad);
      if (clip) el.style.clipPath = clip;
    }
    var pose = document.createElement('div');
    pose.className = 'critter-pose';
    pose.style.left = pad + 'px';
    pose.style.top = pad + 'px';
    pose.style.width = p.w + 'px';
    pose.style.height = p.h + 'px';
    pose.style.setProperty('--critter-angle', p.angle + 'deg');
    pose.style.setProperty('--critter-flip', String(p.flip === -1 ? -1 : 1)); // v1.168: mirror pose
    // v1.187 gate (adversarial W4/S6) the SNEAK offset, per placement:
    //  - SCALED, never a fixed 7px: pad is round(w*0.3), so a `tiny` 13px critter
    //    has a 4px pad and a 7px start would be CLIPPED mid-arrival (52% of tiny
    //    placements) - a jump, not a sneak. Clamp it to the pad.
    //  - DIRECTIONAL: every VERTICALLY-emerging critter drifts AWAY from its
    //    anchor (out of hiding) - one hanging BELOW its ledge (anchor covers its
    //    top, cover.t > 0) starts above and sinks; the rest start below and rise.
    //    One fixed sign moved the whole bottom family TOWARD concealment - the
    //    inverse of the stated mechanism. For pure left/right peeks (~27%) the
    //    rise is perpendicular to the emergence axis: neither toward nor away.
    var rise = Math.max(2, Math.min(7, pad));
    pose.style.setProperty('--critter-rise', ((p.cover && p.cover.t > 0) ? -rise : rise) + 'px');
    // v1.179.2 (Dean's ruling): the hue spin exists so the five BUILT-IN
    // line-art figurines look varied - real uploaded art renders
    // COLOR-FAITHFUL, exactly as the file is. Unset, the filter's
    // var(--critter-hue, 0deg) fallback is a no-op rotation.
    if (!p.img) pose.style.setProperty('--critter-hue', p.hue + 'deg');
    if (p.img) {
      var img = document.createElement('img');
      img.src = p.img;
      img.alt = '';
      img.draggable = false;
      pose.appendChild(img);
    } else if (p.svg) {
      pose.innerHTML = p.svg; // static built-in figurine markup, never user input
    }
    el.appendChild(pose);
    layer.appendChild(el);
  });
}

// v1.175 (Dean: "prevent FOUC/load-in after other elements"): pre-warm the
// pool's images once per manifest generation - download AND decode ahead of
// the first paint so a critter's arrival never flashes an empty box while a
// big PNG streams in. Best-effort everywhere: no Image constructor (node), a
// failed decode, or a 404 all degrade to the old decode-at-paint behavior.
function warmCritterAssets(manifest) {
  if (typeof window === 'undefined' || typeof window.Image !== 'function') return;
  (manifest || []).forEach(function (c) {
    if (!c || !c.img) return; // built-ins are inline svg - nothing to fetch
    try {
      var im = new window.Image();
      im.decoding = 'async';
      im.src = c.img;
      if (typeof im.decode === 'function') im.decode().catch(function () { /* decode at paint instead */ });
    } catch (_) { /* warming is an accelerator only */ }
  });
}

function fetchCritterManifest() {
  if (critterManifestPromise) return critterManifestPromise;
  critterManifestPromise = fetch('/api/critters')
    .then(function (res) { return res.ok ? res.json() : { critters: [] }; })
    .then(function (data) {
      var list = (data && Array.isArray(data.critters)) ? data.critters : [];
      // SANITIZE to the exact fields a folder critter may carry (gate: the
      // `innerHTML = p.svg` branch is for the BUILT-INS only, and that
      // invariant is enforced here, not by convention - a fetched entry can
      // never smuggle an svg field into the renderer).
      var clean = list.map(function (c) {
        return { id: String(c && c.id || ''), img: (c && c.img) || null, sound: (c && c.sound) || null, voice: (c && c.voice) || null };
      }).filter(function (c) { return c.id && c.img; });
      // v1.185: the server exposes the FULL sound pool (every file, not just the
      // hash-assigned ones). Captured here; the fallback derives it from the
      // per-critter voices if an older server omitted it.
      critterServerVoicePool = (data && Array.isArray(data.voicePool)) ? data.voicePool.slice() : null;
      return clean.length ? clean : CRITTER_BUILTINS;
    })
    .catch(function () { critterServerVoicePool = null; return CRITTER_BUILTINS; })
    .then(function (manifest) {
      // Warming rides the CACHED promise's construction, so it runs exactly
      // once per manifest generation by structure (applyCritterMode nulls the
      // promise -> the next fetch warms the fresh pool).
      warmCritterAssets(manifest);
      // v1.185: (re)build the full sound pool on the same once-per-generation
      // seam - server voicePool when present, else the manifest-derived fallback.
      critterSoundPool = critterServerVoicePool || buildCritterSoundPool(manifest);
      critterServerVoicePool = null;
      return manifest;
    });
  return critterManifestPromise;
}

// v1.167: a FIXED-position ancestor makes an element's rect viewport-anchored
// while critters live in DOCUMENT coordinates - they separate on scroll (header
// buttons, the bottom nav). Such subtrees are never anchors.
function critterInsideFixed(el) {
  for (var p = el; p && p !== document.body && p.nodeType === 1; p = p.parentElement) {
    // Fail CLOSED (gate S2): if computed style is unreadable, do NOT anchor -
    // wrongly skipping one candidate is invisible; wrongly anchoring a fixed
    // one detaches its critter on scroll.
    try { if (window.getComputedStyle(p).position === 'fixed') return true; } catch (_) { return true; }
  }
  return false;
}

// v1.220 (Dean, device): an anchor inside a genuinely SCROLLABLE container (the
// Music shelves' horizontal strips, the books row) is never an anchor. Its tile
// moves when the CONTAINER scrolls while the document-pinned critter stays, so it
// detaches and looks glitchy - Dean's ruling: just don't place them there.
// (v1.219 tried to make them RIDE the scroll; he tested it, still glitchy, so we
// exclude instead.) "Scrollable" = an overflow scroll/auto ancestor that actually
// overflows its client box on that axis. Fail CLOSED (unreadable style -> skip),
// matching critterInsideFixed.
function critterInsideScroller(el) {
  for (var p = el; p && p !== document.body && p.nodeType === 1; p = p.parentElement) {
    var cs;
    try { cs = window.getComputedStyle(p); } catch (_) { return true; }
    if (!cs) return true;
    var ox = cs.overflowX;
    var oy = cs.overflowY;
    if ((ox === 'scroll' || ox === 'auto') && p.scrollWidth - p.clientWidth > 1) return true;
    if ((oy === 'scroll' || oy === 'auto') && p.scrollHeight - p.clientHeight > 1) return true;
  }
  return false;
}

function collectCritterRects(selectors, requireSize) {
  var rects = [];
  var nodes = document.querySelectorAll(selectors.join(','));
  for (var i = 0; i < nodes.length; i += 1) {
    var el = nodes[i];
    if (requireSize && el.closest && el.closest(CRITTER_EXCLUSION_SELECTORS.join(','))) continue;
    if (requireSize && critterInsideFixed(el)) continue; // anchors only - exclusions may BE fixed (the dock)
    if (requireSize && critterInsideScroller(el)) continue; // v1.220: never inside a scrollable strip
    var r = el.getBoundingClientRect();
    if (requireSize && (r.width < 1 || r.height < 1)) continue; // hidden
    var weight = 1;
    var sel = null;
    if (requireSize && el.matches) {
      for (var s = 0; s < CRITTER_PRIORITY_SELECTORS.length; s += 1) {
        if (el.matches(CRITTER_PRIORITY_SELECTORS[s])) { weight = CRITTER_PRIORITY_WEIGHT; break; }
      }
      // v1.178: record WHICH pool selector matched - when a view rebuilds its
      // content (innerHTML), the re-glue pass re-finds the anchor's TWIN by
      // this selector instead of dropping the critter.
      for (var q = 0; q < selectors.length; q += 1) {
        try { if (el.matches(selectors[q])) { sel = selectors[q]; break; } } catch (_) { /* bad selector: no adoption */ }
      }
    }
    // v1.170: TRUE-CIRCLE detection (the channel-avatar disc). Only a square
    // box whose corner radius reaches half its size counts - a pill button
    // (radius 50% but wide) is NOT a circle. Fails OPEN to the rect clip: a
    // wrongly-square avatar just gets the old sharper cut, never a bad hide.
    var round = false;
    var radii = null;
    if (requireSize) {
      try {
        var cs = window.getComputedStyle(el);
        var half = Math.min(r.width, r.height) / 2;
        // v1.177 (Dean's Modern-2021 screenshots): harvest ALL FOUR corner
        // radii so the shave mask can follow the PAINTED shape. Percentages
        // resolve against the box's min dimension (approximation - CSS
        // resolves each axis separately, but for decorative shaving the min
        // is the honest conservative read); everything clamps to half.
        var corner = function (v) {
          var s = String(v || '');
          var n = s.indexOf('%') !== -1 ? (parseFloat(s) / 100) * Math.min(r.width, r.height) : (parseFloat(s) || 0);
          if (!isFinite(n)) n = 0;
          return Math.max(0, Math.min(n, half));
        };
        radii = {
          tl: corner(cs.borderTopLeftRadius),
          tr: corner(cs.borderTopRightRadius),
          br: corner(cs.borderBottomRightRadius),
          bl: corner(cs.borderBottomLeftRadius),
        };
        round = Math.abs(r.width - r.height) <= 2 && radii.tl >= half - 1;
      } catch (_) { round = false; radii = null; }
    }
    // v1.176: the ELEMENT rides along so a settle correction can RE-GLUE a
    // placed critter to its own moved furniture instead of re-rolling.
    rects.push({ x: r.left + window.scrollX, y: r.top + critterPageScrollY(), w: r.width, h: r.height, weight: weight, round: round, radii: radii, el: el, sel: sel });
  }
  return rects;
}

// v1.248 (Dean): true while the full-screen mobile skin player is mounted (music.js /
// skin-surface.js add body.mms-on when the skin cover paints). Critters must not scatter over it.
// v1.311.2 gate r1 (adversary S2): critters are placed in DOCUMENT coordinates
// (rect top + page scroll). Under the shared body lock the body is pinned at
// top:-Y and window.scrollY reads 0, so a re-scatter there (a rotate INTO faux
// fullscreen is a width change) would land every critter Y too high after the
// exit. The lock's saved Y is the page's real scroll: rect top (already shifted
// by -Y) + Y = the document position. No lock / no module: plain window scroll.
function critterPageScrollY() {
  var BL = typeof window !== 'undefined' && window.FileTubeBodyLock;
  return BL ? BL.scrollYOf(document, window) : window.scrollY;
}
function critterSuppressedByPlayer() {
  return typeof document !== 'undefined' && !!document.body && document.body.classList.contains('mms-on');
}
function clearCritterLayer() {
  if (typeof document === 'undefined' || !document.getElementById) return;
  var lyr = document.getElementById('critter-layer');
  if (lyr) lyr.remove();
  critterPlacements = [];
}

function scatterCritters() {
  if (typeof document === 'undefined' || !document.body) return;
  // v1.182: a direct scatter (the reveal, the settle ladder, the Settings
  // toggle, tests) supersedes any wait phase still pending - tear it down so
  // its observer + timers never fire a second placement behind this one.
  disconnectCritterWait();
  // v1.248 (Dean): never scatter while the full-screen mobile skin player is up (body.mms-on).
  // The `.mms-full` cover fills the viewport (and is a critter exclusion zone), so the planner
  // would measure a viewport-sized exclusion and drop/overlay placements - the music-page
  // "weird spots / don't save" bug. Clear + skip; the dock-return re-render re-scatters onto the
  // browse grid once the cover is down.
  if (critterSuppressedByPlayer()) { clearCritterLayer(); return; }
  var cfg = resolveCritterConfig();
  if (!cfg.enabled) {
    var existing = document.getElementById('critter-layer');
    if (existing) existing.remove();
    critterPlacements = [];
    unwireCritterContentNudge(); // v1.175: no observer cost while the mode is off (the v1.160 global-listener lesson)
    // Mode off leaves NOTHING pending: a settle timer armed before the toggle
    // would fire into a no-op scatter (harmless) but is still a live handle -
    // the v1.166.4 discipline says cancel it, not let it dangle.
    if (critterRetryTimer) { clearTimeout(critterRetryTimer); critterRetryTimer = null; }
    return;
  }
  wireCritterListeners();
  wireCritterContentNudge();
  fetchCritterManifest().then(function (manifest) {
    // RE-CHECK after the await (the TOCTOU lesson): the user may have toggled
    // the mode off while the manifest fetch was in flight.
    // v1.187 gate (S4): read the LIVE config ONCE - count and sizeScale must come
    // from the SAME snapshot (two reads could disagree if a pref changed between).
    var cfgNow = resolveCritterConfig();
    if (!cfgNow.enabled) return;
    var docEl = document.documentElement;
    var placements = planCritterScatter({
      anchors: collectCritterRects(CRITTER_ANCHOR_SELECTORS, true),
      exclusions: collectCritterRects(CRITTER_EXCLUSION_SELECTORS, false),
      manifest: manifest,
      count: cfgNow.count,
      sizeScale: cfgNow.sizeScale, // v1.187 (Dean): tiny/normal/large/xlarge
      overlapAllow: cfgNow.overlapAllow, // v1.193 (Dean): 0 strict, or the "light kiss" budget
      bounds: { w: docEl.scrollWidth, h: docEl.scrollHeight }, // never grow the page (gate W4)
      // v1.180 (Dean's right-edge amputation screenshot): the SCREEN edge is
      // its own boundary - scrollWidth can exceed it when anything overflows,
      // which let side peeks poke past the viewport and get guillotined.
      viewportW: window.innerWidth || 0,
    });
    critterPlacements = placements;
    renderCritterPlacements(ensureCritterLayer(), placements);
    // Measured AFTER render (gate S1): the pad-inflated wrappers can overflow
    // the W4-checked placement rects by up to ~26px at the page bottom, and
    // measuring with that overflow PRESENT on both sides of the comparison
    // means only real content reflow can trip the drift branch.
    critterPlacedDocH = docEl.scrollHeight;
    // v1.166.4 -> v1.173: the post-scatter SETTLE ladder - once at +1.5s, once
    // more at +4s, then STOP. Two things earn a re-scatter at fire time (the
    // pure critterSettleAction decides):
    //  - EMPTY (v1.166.4): watch-style views measure ZERO anchors on the first
    //    pass because everything is fetch-then-render (slower than the 200ms
    //    debounce on a VPN'd phone).
    //  - LAYOUT DRIFT (v1.173, Dean's "Dreams of a Life" screenshot): a page
    //    that placed against its loading SKELETONS reflows when real content
    //    lands (a one-line title vs the fixed-height title skeleton, the
    //    uploader panel filling in) - the placed critters keep their document
    //    coords and end up floating over TEXT, unmoored from their anchors.
    //    A document-height change beyond the threshold is the reflow tell.
    // "Never move mid-view" still holds: the ladder is BOUNDED (two checks per
    // navigation), the timer is STASHED so scheduleCritterScatter cancels it on
    // every navigation (the demonstrated stale-retry race), and the fire-time
    // decision reads the LIVE placements + LIVE height - a settled page stands
    // down, and since v1.176 a DRIFT correction RE-GLUES rather than re-rolls.
    armCritterSettleCheck();
  });
}

// v1.176: the settle check's arm + fire, shared by the full scatter and the
// re-glue pass (a drift correction must keep the remaining checks alive).
// The DECISION mapping is the wave's point (Dean: critters visibly re-rolled
// to brand-new spots when a settling watch page corrected itself - v1.175's
// instant arrival made the v1.173 drift RE-SCATTER visible): EMPTY still
// earns a full scatter (there is nothing to preserve), but DRIFT re-GLUES -
// every placed critter rides its own anchor element, no re-roll, ever,
// while a view is up.
function armCritterSettleCheck() {
  if (critterSettleChecks >= 2) return;
  // v1.180: NEVER overwrite a stashed handle without cancelling it (the
  // v1.166.4 class, found hiding inside the arm itself): the timer and nudge
  // paths clear the stash before re-arming, but a DIRECT reglue call (tests,
  // any future caller) would orphan a live, uncancellable timer here.
  if (critterRetryTimer) { clearTimeout(critterRetryTimer); critterRetryTimer = null; }
  var delay = critterSettleChecks === 0 ? 1500 : 4000;
  critterSettleChecks += 1;
  critterRetryTimer = setTimeout(function () {
    critterRetryTimer = null;
    var action = critterSettleAction(critterPlacements.length, critterPlacedDocH, document.documentElement.scrollHeight);
    if (action === 'rescatter-empty') scatterCritters();
    else if (action === 'rescatter-drift') reglueCritterPlacements();
  }, delay);
}

// v1.176 RE-GLUE: re-measure each placed critter's OWN anchor element and
// translate the critter by the anchor's movement - same critter, same edge,
// same pose, same exposure; the clip re-derives from the moved rects (the
// v1.174 geometric truth needs no claims). A critter whose anchor left the
// page, hid, stopped overlapping, became fully covering, or whose new spot
// violates an exclusion/bounds is DROPPED, never re-rolled elsewhere. The
// rebuild renders with still=true so a re-glue never replays the arrival
// fade (an unmoved critter must be visually inert).
// v1.178 (Dean: critters still "flash and find a second position"): views
// rebuild their content wholesale (relatedContainer.innerHTML = ..., the
// feed grid, comments) - the anchor ELEMENT a critter chose gets replaced by
// an identical TWIN, isConnected goes false, the critter was dropped, and
// the empty settle check re-scattered to fresh random spots. ADOPTION closes
// it: re-find the replacement by the anchor's own pool selector - same size
// class (0.5x-2x), geometrically nearest to the old rect, within 240px (past
// half a phone screen it is different furniture), never an element another
// placement already sits on, never fixed chrome. Found -> the critter
// re-attaches at its same edge/pose; not found -> the old drop stands.
function refindCritterAnchor(p, claimed) {
  if (!p.anchorSel) return null;
  var cands;
  try { cands = document.querySelectorAll(p.anchorSel); } catch (_) { return null; }
  var best = null;
  var bestDist = 240;
  var cx = p.anchor.x + p.anchor.w / 2;
  var cy = p.anchor.y + p.anchor.h / 2;
  for (var i = 0; i < cands.length; i += 1) {
    var el = cands[i];
    if (claimed.indexOf(el) !== -1) continue; // one critter per anchor, still
    if (critterInsideFixed(el)) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    var rw = r.width / p.anchor.w;
    var rh = r.height / p.anchor.h;
    if (rw < 0.5 || rw > 2 || rh < 0.5 || rh > 2) continue; // a different-sized cousin is not the twin
    var dx = (r.left + window.scrollX + r.width / 2) - cx;
    var dy = (r.top + critterPageScrollY() + r.height / 2) - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) { bestDist = dist; best = el; }
  }
  return best;
}

function reglueCritterPlacements() {
  if (typeof document === 'undefined' || !document.body) return;
  // v1.248 (Dean): same full-screen-skin guard as scatterCritters - a re-glue while the
  // mms-full cover is up would drop placements against the viewport-sized exclusion.
  if (critterSuppressedByPlayer()) { clearCritterLayer(); return; }
  // v1.193 (Dean): honour the "light kiss" pref on the drift path too, so a
  // re-glue respects the SAME overlap budget the last scatter used (0 = strict).
  var overlapAllow = resolveCritterConfig().overlapAllow;
  var exclusions = collectCritterRects(CRITTER_EXCLUSION_SELECTORS, false);
  var docEl = document.documentElement;
  var bounds = { w: docEl.scrollWidth, h: docEl.scrollHeight };
  var survivors = [];
  // Elements already owned by a still-connected placement may not be adopted
  // by an orphan (the no-duplicates rule survives adoption).
  var claimed = [];
  for (var c = 0; c < critterPlacements.length; c += 1) {
    var owned = critterPlacements[c].anchorEl;
    if (owned && owned.isConnected) claimed.push(owned);
  }
  for (var i = 0; i < critterPlacements.length; i += 1) {
    var p = critterPlacements[i];
    var el = p.anchorEl;
    if (!el || !el.isConnected) {
      el = refindCritterAnchor(p, claimed); // v1.178: the rebuilt TWIN, if any
      if (!el) continue; // the furniture truly left the page
      p.anchorEl = el;
      claimed.push(el);
    }
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue; // hidden now
    var a2 = { x: r.left + window.scrollX, y: r.top + critterPageScrollY(), w: r.width, h: r.height };
    p.x += Math.round(a2.x - p.anchor.x);
    p.y += Math.round(a2.y - p.anchor.y);
    p.anchor = a2;
    if (p.roundCover) {
      p.roundCover = { cx: Math.round(a2.x + a2.w / 2) - p.x, cy: Math.round(a2.y + a2.h / 2) - p.y, r: Math.round(Math.min(a2.w, a2.h) / 2) };
    }
    // The peek invariant, re-validated against the moved/resized anchor.
    var overlaps = p.x < a2.x + a2.w && p.x + p.w > a2.x && p.y < a2.y + a2.h && p.y + p.h > a2.y;
    var fullyInside = p.x >= a2.x && p.x + p.w <= a2.x + a2.w && p.y >= a2.y && p.y + p.h <= a2.y + a2.h;
    if (!overlaps || fullyInside) continue;
    var rect = { x: p.x, y: p.y, w: p.w, h: p.h };
    var hitsExclusion = false;
    for (var e = 0; e < exclusions.length; e += 1) {
      if (critterRectsIntersect(rect, exclusions[e])) { hitsExclusion = true; break; }
    }
    if (hitsExclusion) continue; // slid into the player/dock: drop, never nudge
    if (bounds.w && (p.x + p.w > bounds.w || p.y + p.h > bounds.h)) continue; // gate W4 still holds
    // v1.180: a drift/adoption slide may never carry a critter across the
    // screen edge either - same invariant as placement time.
    // v1.192: pad-aware, exactly like the planner - the rendered wrapper is
    // inflated by round(w*0.3) each side, so an edge-flush re-glued critter's
    // transparent pad would poke past the viewport and scroll the page sideways.
    var vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
    var rpad = Math.round(p.w * 0.3);
    if (vw && (p.x - rpad < 0 || p.x + p.w + rpad > vw)) continue;
    // v1.192: the no-overlap invariant survives a drift too - two critters whose
    // anchors moved independently can converge into a stack. Drop the later one
    // (skip, never nudge), same as the planner. Checked against SURVIVORS so an
    // already-dropped critter never blocks a slot.
    var stacks = false;
    for (var s = 0; s < survivors.length; s += 1) {
      var q = survivors[s];
      if (critterOverlapExceeds(rect, { x: q.x, y: q.y, w: q.w, h: q.h }, overlapAllow)) { stacks = true; break; }
    }
    if (stacks) continue;
    survivors.push(p);
  }
  critterPlacements = survivors;
  renderCritterPlacements(ensureCritterLayer(), survivors, true);
  critterPlacedDocH = docEl.scrollHeight;
  armCritterSettleCheck();
}

// v1.175 (Dean: "prevent FOUC/load-in after other elements"): the CONTENT
// NUDGE. The settle ladder's +1.5s/+4s timers are the FALLBACK clock; this
// MutationObserver fast-forwards the SAME bounded decision the moment new
// page content actually lands, so critters arrive in the same beat as the
// cards instead of a visible 1.5s later. Discipline:
//  - It spends the ladder's OWN budget (critterSettleChecks caps everything
//    at two re-scatters per navigation - the nudge accelerates, never adds).
//  - The pending fallback timer is CANCELLED before a nudged scatter (the
//    v1.166.4 unstashed-handle lesson: never leave a stale timer live).
//  - The critter layer's own render churn is filtered out, and the observer
//    exists ONLY while the mode is on (wired in scatterCritters' enabled
//    path, disconnected on the disabled path - the v1.160 lesson: a global
//    observer/listener must not tax users who never opted in).
// v1.179.1 instrument: why the last tap fell back to the chirp, and a
// one-tap end-to-end voice probe (Settings -> Critters -> Voice check).
// Diagnosis discipline: Dean's device boops while the API provably carries
// voices - the probe runs the REAL manifest path and a REAL playback attempt
// and reports exactly which link breaks, with the error's name.
var critterLastChirpReason = null;
function getCritterLastChirpReason() { return critterLastChirpReason; }
function probeCritterVoices() {
  // Gate S1: captured BEFORE the fetch - a COLD manifest means a real network
  // await sat between the tap and the play, so a NotAllowedError may be an
  // iOS activation artifact rather than the finding; the report says so.
  var manifestWasCold = !critterManifestPromise;
  return fetchCritterManifest().then(function (manifest) {
    var withVoice = manifest.filter(function (c) { return !!(c.voice || c.sound); });
    var report = {
      total: manifest.length,
      withVoice: withVoice.length,
      sample: withVoice.length ? (withVoice[0].voice || withVoice[0].sound) : null,
      builtins: manifest.length > 0 && !manifest[0].img ? true : false,
      coldManifest: manifestWasCold,
      lastChirpReason: critterLastChirpReason,
    };
    if (!report.sample) { report.play = 'skipped: no voice in the running client\'s manifest'; return report; }
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (msg) { if (!done) { done = true; report.play = msg; resolve(report); } };
      try {
        var a = new Audio(report.sample);
        a.addEventListener('error', function () {
          var mediaErr = a.error ? ('mediaError code ' + a.error.code) : 'element error';
          finish('LOAD FAILED: ' + mediaErr + ' (' + report.sample + ')');
        });
        a.play().then(function () {
          finish('OK: playback started (' + report.sample + ')');
          try { a.pause(); } catch (_) { /* probe only */ }
        }).catch(function (err) {
          finish('PLAY REJECTED: ' + ((err && err.name) || 'unknown') + ' - ' + ((err && err.message) || ''));
        });
        setTimeout(function () { finish('TIMEOUT: play neither started nor rejected in 8s (stalled load)'); }, 8000);
      } catch (err) {
        finish('CONSTRUCTOR THREW: ' + ((err && err.name) || 'unknown'));
      }
    });
  });
}

var critterContentObs = null;
var critterContentObsDoc = null; // the document the observer was wired against - a swapped document (tests) re-wires
var critterNudgeDebounce = null;
function wireCritterContentNudge() {
  if (typeof MutationObserver === 'undefined') return;
  if (critterContentObs && critterContentObsDoc === document) return;
  unwireCritterContentNudge(); // a different document (jsdom test contexts) gets a fresh observer
  critterContentObsDoc = document;
  critterContentObs = new MutationObserver(function (muts) {
    // A torn-down or swapped context (a closed jsdom window can still flush
    // observer queues) must stand down COMPLETELY - never touch globals.
    if (typeof document === 'undefined' || document !== critterContentObsDoc) return;
    var layer = document.getElementById('critter-layer');
    var foreign = false;
    for (var i = 0; i < muts.length; i += 1) {
      var t = muts[i].target;
      if (!layer || !(t === layer || (layer.contains && layer.contains(t)))) { foreign = true; break; }
    }
    if (!foreign) return; // only OUR layer churned - never self-trigger
    if (critterSettleChecks >= 2) return; // the settle window is spent; placed critters never re-roll
    if (critterNudgeDebounce) clearTimeout(critterNudgeDebounce);
    critterNudgeDebounce = setTimeout(function () {
      critterNudgeDebounce = null;
      if (typeof document === 'undefined' || document !== critterContentObsDoc) return; // context torn down mid-debounce
      if (!resolveCritterConfig().enabled) return;
      var action = critterSettleAction(critterPlacements.length, critterPlacedDocH, document.documentElement.scrollHeight);
      if (action === 'stand-down') return;
      if (critterRetryTimer) { clearTimeout(critterRetryTimer); critterRetryTimer = null; }
      // v1.176: the nudge maps like the timer - EMPTY scatters, DRIFT re-glues.
      if (action === 'rescatter-empty') scatterCritters();
      else reglueCritterPlacements();
    }, 150);
  });
  try {
    critterContentObs.observe(document.body, { childList: true, subtree: true });
  } catch (_) {
    critterContentObs = null; // observing is an accelerator only; the fallback timers stand
  }
}
function unwireCritterContentNudge() {
  if (critterContentObs) { try { critterContentObs.disconnect(); } catch (_) { /* already dead */ } critterContentObs = null; }
  critterContentObsDoc = null;
  if (critterNudgeDebounce) { clearTimeout(critterNudgeDebounce); critterNudgeDebounce = null; }
}

// v1.173 PURE fire-time decision for the settle ladder. Empty placements
// always earn a retry (the v1.166.4 case); placed critters re-scatter ONLY
// when the document height moved past the threshold since placement (the
// skeleton-reflow case) - 24px is under any real reflow (a title line is
// ~31px) but over subpixel/scrollbar jitter. Otherwise: stand down, placed
// critters never re-roll.
function critterSettleAction(placedCount, placedDocH, nowDocH) {
  if (!placedCount) return 'rescatter-empty';
  if (Math.abs((nowDocH | 0) - (placedDocH | 0)) > 24) return 'rescatter-drift';
  return 'stand-down';
}

// v1.182 SETTLE-BEFORE-REVEAL -----------------------------------------------
// The page is still loading if a feed skeleton is on it: placing critters now
// would re-drift when the real (often shorter-titled) cards replace the
// skeletons and shift the column. Kept to a NAMED selector list so the coupling
// to the skeleton class is explicit and greppable.
function critterPageLoading() {
  if (typeof document === 'undefined') return false;
  for (var i = 0; i < CRITTER_LOADING_SELECTORS.length; i += 1) {
    if (document.querySelector(CRITTER_LOADING_SELECTORS[i])) return true;
  }
  return false;
}

// Tears the wait phase down ATOMICALLY - the observer AND both timers - so no
// pending handle from the wait ever fires a placement after the view moved on
// (the unstashed-handle class). Idempotent.
function disconnectCritterWait() {
  if (critterWaitObs) { try { critterWaitObs.disconnect(); } catch (_) { /* already dead */ } critterWaitObs = null; }
  critterWaitObsDoc = null;
  if (critterQuietTimer) { clearTimeout(critterQuietTimer); critterQuietTimer = null; }
  if (critterCapTimer) { clearTimeout(critterCapTimer); critterCapTimer = null; }
}

// The single placement that ends the wait: cancel the wait, then the unchanged
// scatterCritters() paints the ONE arrival fade at the settled layout (and
// wires its own post-reveal nudge + settle ladder for a late reflow).
function revealCritterScatter() {
  disconnectCritterWait();
  scatterCritters();
}

// (Re)arm the quiet debounce. Fires CRITTER_QUIET_MS after the last content
// mutation - but reveals only once the feed skeletons are gone; while the page
// still shows skeletons it self-defers (the next mutation re-arms it, and the
// cap is the backstop). Armed once leading at wait start so a static, NON-
// loading view (Settings) reveals promptly instead of waiting the full cap.
function armCritterQuietTimer() {
  if (critterQuietTimer) clearTimeout(critterQuietTimer);
  critterQuietTimer = setTimeout(function () {
    critterQuietTimer = null;
    if (critterPageLoading()) return; // still loading: wait for the next mutation or the cap
    revealCritterScatter();
  }, CRITTER_QUIET_MS);
}

// Arm the wait phase (mode ON): pre-warm the pool, watch for the view's content
// to land, and reveal once it settles (or at the cap). Exactly one critter
// observer is ever live: scheduleCritterScatter unwires the PREVIOUS view's
// nudge observer before this wait observer is created, and revealCritterScatter
// disconnects this one before scatterCritters wires the next nudge observer -
// so the wait and nudge observers never coexist (the gate-CRITICAL fix).
function armCritterQuietWait() {
  if (typeof window === 'undefined' || !document || !document.body) return;
  // Download + decode the pool DURING the wait so the reveal never flashes a
  // half-decoded PNG (the v1.175 warm, now overlapped with content loading).
  fetchCritterManifest();
  if (typeof MutationObserver !== 'undefined') {
    critterWaitObsDoc = document;
    critterWaitObs = new MutationObserver(function () {
      // A torn-down/swapped context (a closed jsdom window can still flush the
      // queue) stands down completely - never touch globals (the v1.175 class).
      if (typeof document === 'undefined' || document !== critterWaitObsDoc) return;
      armCritterQuietTimer(); // content landed/changed -> push the quiet window out
    });
    try {
      critterWaitObs.observe(document.body, { childList: true, subtree: true });
    } catch (_) {
      critterWaitObs = null; critterWaitObsDoc = null; // observing is an accelerator; the cap/leading timer still stand
    }
  }
  // The hard cap: reveal even if the page never quiets (a periodic mutator) or
  // never mutates at all (a fully static, server-rendered view).
  critterCapTimer = setTimeout(revealCritterScatter, CRITTER_REVEAL_CAP_MS);
  armCritterQuietTimer(); // the leading arm (fast reveal for a static, non-loading view)
}

// v1.182 test seam (gate SUGGESTION): the reveal cap is the wave's headline
// safety invariant ("reveal no matter what"), but 2.5s is impractical to drive
// in-suite. This lets a test shorten the quiet/cap so the cap path is exercised
// FUNCTIONALLY, not just source-locked. Production never calls it; tests restore
// the defaults (the module's require cache persists state across tests).
function setCritterTimingForTest(quietMs, capMs) {
  if (typeof quietMs === 'number') CRITTER_QUIET_MS = quietMs;
  if (typeof capMs === 'number') CRITTER_REVEAL_CAP_MS = capMs;
}

// v1.185 test seam: inject the sound pool so the random pick can be driven
// without stubbing the whole manifest fetch. Test-only. (No rotation state - the
// picker is stateless/random since v1.185.)
function setCritterSoundPoolForTest(pool) {
  critterSoundPool = Array.isArray(pool) ? pool.slice() : [];
}
// v1.311.2 test seam: install placements directly so the REAL capture click
// listener (wireCritterListeners) can be driven over a real button. Test-only.
function setCritterPlacementsForTest(placements) {
  critterPlacements = Array.isArray(placements) ? placements.slice() : [];
}

// The entry point - the ONLY way anything asks for a scatter (router hooks,
// resize, the Settings apply path). Per navigation it RESETS + CANCELS every
// pending handle (incl. the previous view's nudge observer), clears the outgoing
// view's critters, then (mode ON) WAITS for the view to settle before the first
// and only placement (v1.182); mode OFF clears immediately. Never re-scatters
// mid-view otherwise (Dean: fresh per navigation, still while you read).
function scheduleCritterScatter() {
  if (typeof window === 'undefined') return;
  critterSettleChecks = 0; // a fresh navigation re-arms the settle ladder
  // ...and CANCELS any stale pending retry from the previous view - an unstashed
  // handle is uncancellable by construction (gate WARNING; the v1.163 class).
  if (critterRetryTimer) { clearTimeout(critterRetryTimer); critterRetryTimer = null; }
  // v1.175 gate S1: the content nudge's debounce is a pending handle too - a
  // navigation cancels EVERY handle from the previous view, same discipline.
  if (critterNudgeDebounce) { clearTimeout(critterNudgeDebounce); critterNudgeDebounce = null; }
  // v1.182: the wait phase's own handles (observer + quiet + cap) are cancelled
  // on every navigation too - same unstashed-handle discipline.
  disconnectCritterWait();
  // v1.182 gate CRITICAL (QA): the PREVIOUS view's post-reveal nudge observer
  // (critterContentObs, wired in scatterCritters, persistent per-document) is a
  // SEPARATE observer that survives navigation. Left connected, it fires on the
  // new view's skeleton grid landing and re-scatters/re-glues onto the loading
  // skeletons DURING the new wait - the exact flash the wave removes. Disconnect
  // it now; the reveal re-wires a fresh one (unwireCritterContentNudge is
  // idempotent). This is what makes "only one critter observer is ever live"
  // literally true (the wait observer below, then the nudge observer at reveal).
  unwireCritterContentNudge();
  // v1.182 gate WARNING (QA): a navigation ends the previous view's critters
  // NOW - they must not linger at stale document coords over the new (loading)
  // view for up to the cap. The reveal rebuilds a fresh layer against the
  // settled new layout; here they simply clear with the outgoing view.
  if (typeof document !== 'undefined' && document.getElementById) {
    var staleLayer = document.getElementById('critter-layer');
    if (staleLayer) staleLayer.remove();
    critterPlacements = [];
  }
  if (!resolveCritterConfig().enabled) {
    // Mode OFF: nothing more to do - the layer is already cleared above.
    return;
  }
  // Mode ON: wait for the view's content to settle, THEN place once.
  armCritterQuietWait();
}

function wireCritterListeners() {
  if (critterWired || typeof document === 'undefined') return;
  critterWired = true;
  // v1.311.2 (Dean ruling): a critter never blocks a link or button - over an
  // interactive target (critterOverInteractive) the critter still reacts, but the
  // click is NOT swallowed; the swallow described below applies everywhere else.
  // Tap: a tap on the VISIBLE part of the critter (its exposed peek, and any body
  // overhanging OTHER furniture) chirps AND is SWALLOWED so it never clicks
  // through to the thing it OBSCURES. But a tap over the critter's OWN anchor
  // (where the sandwich clips it away - a button it peeks from behind) is NOT a
  // hit (critterTapHit excludes it), so that tap goes to the button - v1.191
  // (Dean: buttons behind critters must work), walking back v1.188's whole-box
  // swallow. This reversed the older "the link always wins" posture (v1.188) - the
  // handler now runs in the CAPTURE phase (document is the first node in the
  // dispatch path), so stopPropagation() keeps the event from ever descending
  // to the target's own handlers and preventDefault() cancels the default (a
  // link's navigation). It still stands down over caret-bearing fields (never
  // fight a text cursor) and over every playback surface + modal backdrop
  // (Dean's hard constraint - a chirp/steal over the playing dock or under a
  // dismissing modal is the forbidden disruption; critters are never PLACED
  // there anyway, so this is defense-in-depth). SCOPE BOUNDARY: only `click` is
  // swallowed - a pointerdown-/mousedown-driven handler on an obscured element
  // (a drag handle) is not, but a clean tap never triggers those and its click
  // is caught here.
  document.addEventListener('click', function (e) {
    if (!critterPlacements.length) return;
    // v1.188 (gate QA-W1): stand down for KEYBOARD and PROGRAMMATIC clicks. A
    // keyboard Enter/Space on a focused control - and any element.click() - fires
    // a synthetic click with detail===0 whose coordinates default to (scrollX,
    // scrollY), so a critter at the viewport origin would hit-test-match and
    // SWALLOW that activation (an a11y regression, since the capture swallow
    // replaced the old interactive-element stand-down). A genuine pointer/touch
    // TAP always reports detail>=1, so this preserves the critter's visible-region
    // win for real taps while never eating a synthesized activation. (Device
    // probe: confirm touch taps report detail>=1 - the UI Events spec sets the
    // click count to 1 for a tap, as does iOS Safari.)
    if (!e.detail) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.target && e.target.closest && e.target.closest(CRITTER_EXCLUSION_SELECTORS.join(','))) return;
    var hit = critterTapHit(critterPlacements, e.pageX, e.pageY);
    if (!hit) return;
    // v1.189.1 (Dean): only win when the critter is actually the TOP thing at
    // this point - stand down if the click landed inside an overlay painted above
    // the critter plane (a menu, the notification dropdown, a sheet). Cheap DOM
    // walk, run only AFTER the geometric hit so it never taxes an ordinary click.
    if (critterOccludedAt(e.target)) return;
    // v1.311.2 (Dean ruling): a critter NEVER blocks a link or button. Over an
    // interactive element the critter still plays its reaction + sound below, but
    // the click goes through to the element untouched. Anywhere else the critter
    // owns the tap: stop it reaching the furniture behind it, and cancel any
    // default. Capture phase makes that stop total.
    if (!critterOverInteractive(e.target)) {
      e.stopPropagation();
      e.preventDefault();
    }
    // By INDEX, never a selector built from the id (gate W3: an id is a raw
    // FILENAME - "names never matter" - and a legal double-quote name made a
    // built selector THROW; render order == placement order, so index is exact
    // even when two files share a basename).
    var layer = document.getElementById('critter-layer');
    var wrap = layer ? layer.children[critterPlacements.indexOf(hit)] : null;
    // v1.168: reactions animate the POSE (the transform carrier inside the
    // clipped wrapper) - animating the wrapper would move the clip cut.
    var el = wrap ? wrap.firstElementChild : null;
    if (el) {
      // Dean: "a variety of very very small visual things" - one random tiny
      // reaction per tap, all transform-only (transforms never affect layout,
      // so nothing else on the page moves - no graphical garbage elsewhere;
      // the hop's -7px translate paints outside the box but shifts nothing).
      var reaction = CRITTER_REACTIONS[Math.floor(Math.random() * CRITTER_REACTIONS.length)];
      CRITTER_REACTIONS.forEach(function (cls) { el.classList.remove(cls); });
      void el.offsetWidth; // restart the animation on rapid re-taps
      el.classList.add(reaction);
    }
    // v1.185 (Dean): an OWNED same-named sound ALWAYS plays (identity for
    // explicitly-paired critters). Otherwise the "random sound each tap" pref
    // decides: ON -> a fresh random pick from the whole pool (variety per tap);
    // OFF -> the stable borrowed voice the server assigned (v1.179 identity).
    // The synth chirp is the last resort only when no sound files exist at all.
    // (The v1.179.1 instrument still records WHY inside playCritterSound.)
    var sound = hit.sound
      || (resolveCritterConfig().randomSound ? pickCritterRandomSound() : hit.voice);
    if (sound) {
      playCritterSound(sound);
    } else {
      critterLastChirpReason = 'no critter voice and the sound pool is empty';
      playCritterChirp();
    }
  }, true); // CAPTURE: run before the target's own handlers so the swallow is total
  // v1.183 (Dean, desktop): spam-clicking a critter was selecting the text
  // beneath it (the browser's double/triple-click gesture) - the layer is
  // pointer-events:none, so the mousedown lands on the content under the peek.
  // Suppress the SELECTION default when the down is a REAL critter hit (the
  // visible region - box minus its own anchor, v1.191). mousedown-only, so touch scroll + long-press are
  // untouched; preventDefault on mousedown stops the selection (and
  // mousedown-focus). The click itself is separately swallowed by the
  // capture-phase tap listener above, so no underlying link/button ever fires.
  // Caret-bearing fields are exempt (never fight a text cursor); same stand-down
  // over the exclusions as the tap.
  document.addEventListener('mousedown', function (e) {
    if (!critterPlacements.length) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.target && e.target.closest && e.target.closest(CRITTER_EXCLUSION_SELECTORS.join(','))) return;
    if (!critterTapHit(critterPlacements, e.pageX, e.pageY)) return;
    if (critterOccludedAt(e.target)) return; // v1.189.1: not the top thing here - don't fight an overlay's mousedown
    if (critterOverInteractive(e.target)) return; // v1.311.2: a button/link keeps its own mousedown (focus, press state)
    e.preventDefault(); // stop the text-selection gesture; the click is swallowed above
  });
  // Reflow moves the furniture; re-scatter (debounced) so critters follow -
  // but ONLY on a WIDTH change (gate W5): iOS Safari fires resize on URL-bar
  // collapse/expand during scroll, and a height-only re-scatter would move
  // critters mid-view, which Dean's ruling forbids.
  var lastCritterViewportW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastCritterViewportW) return;
    lastCritterViewportW = window.innerWidth;
    scheduleCritterScatter();
  });
}

// The Settings page calls this after toggling the checkbox / density select.
function applyCritterMode() {
  critterManifestPromise = null; // fresh folder listing on next scatter
  scheduleCritterScatter();
  // An immediate OFF must clear NOW, not after the debounce.
  if (!resolveCritterConfig().enabled) scatterCritters();
}

function buildShortcutsModal(doc, handlers) {
  const d = doc || document;
  const U = overlayUiLib();
  const onClose = handlers && typeof handlers.onClose === 'function' ? handlers.onClose : null;

  // Sweep S9: a ui.sheet dialog titled "Keyboard shortcuts" (Esc, the scrim and its one
  // Close dismiss it; wide on desktop via style.css `:has(.shortcuts-modal)`). The sheet is
  // built here and opened by openShortcutsModal; `modal` is its content.
  const modal = d.createElement('div');
  modal.className = 'shortcuts-modal';

  // v1.163 (Dean): the DDR arrow row (top-right, before the close) + the mini-synth.
  // Each arrow lights + plays a note on its key press or a click; `ddrByKey` lets
  // the key handler (openShortcutsModal) reach the same play+pulse.
  const ddrByKey = {};
  const ddrRow = d.createElement('div');
  ddrRow.className = 'shortcuts-ddr';
  ddrRow.setAttribute('aria-hidden', 'true'); // decorative easter egg (keys/taps both play; arrows are tabIndex -1, never in the a11y tree)
  const pulse = (el) => { el.classList.remove('ddr-hit'); void el.offsetWidth; el.classList.add('ddr-hit'); };
  DDR_ARROWS.forEach((a) => {
    const arrow = U.button({ variant: 'tonal', size: 'sm', shape: 'icon', icon: a.icon, ariaLabel: a.label, doc: d });
    arrow.classList.add('shortcuts-ddr-arrow');
    // Press colour by axis: left/right -> blue, up/down -> red (Dean's scheme).
    if (a.axis === 'h' || a.axis === 'v') arrow.classList.add('shortcuts-ddr-arrow--' + a.axis);
    arrow.tabIndex = -1;
    arrow.addEventListener('click', () => { playDdrNote(a.freq); pulse(arrow); });
    ddrRow.appendChild(arrow);
    ddrByKey[a.key] = { el: arrow, freq: a.freq, pulse: () => pulse(arrow) };
  });

  // The DDR pun subtitle (the Discord homage).
  const subtitle = d.createElement('div');
  subtitle.className = 'shortcuts-subtitle';
  subtitle.textContent = 'Master these to be the best FileTube FileTube Revolution player';
  modal.appendChild(subtitle);

  // v1.163: the groups live in a BODY wrapper so it can flow into two columns on
  // desktop (no scroll) while the header/subtitle/note stay full width.
  const body = d.createElement('div');
  body.className = 'shortcuts-body';
  modal.appendChild(body);

  KEYBOARD_SHORTCUT_GROUPS.forEach((group) => {
    const section = d.createElement('div');
    section.className = 'shortcuts-group';
    const heading = d.createElement('div');
    heading.className = 'shortcuts-group-title';
    heading.textContent = group.title;
    section.appendChild(heading);

    group.items.forEach((item) => {
      const row = d.createElement('div');
      row.className = 'shortcuts-row';
      const keysEl = d.createElement('div');
      keysEl.className = 'shortcuts-keys';
      item.keys.forEach((key) => {
        // A separator (the "…" between 0 and 9) is plain text, not a key cap --
        // rendering it as one would imply a key that does not exist.
        if (key === '…') {
          keysEl.appendChild(d.createTextNode(' … '));
          return;
        }
        const kbd = d.createElement('kbd');
        const glyph = SHORTCUT_KEY_ICONS[key];
        if (glyph && U && typeof U.icon === 'function') {
          kbd.className = 'shortcuts-kbd--icon';
          kbd.setAttribute('aria-label', glyph.label);
          kbd.setAttribute('title', glyph.label);
          kbd.appendChild(U.icon(glyph.icon, { size: 'sm', doc: d }));
        } else {
          kbd.textContent = glyph ? glyph.label : key;
        }
        keysEl.appendChild(kbd);
      });
      row.appendChild(keysEl);
      const descEl = d.createElement('div');
      descEl.className = 'shortcuts-desc';
      descEl.textContent = item.desc;
      row.appendChild(descEl);
      section.appendChild(row);
    });
    body.appendChild(section);
  });

  // v1.47.8 gate CRITICAL 1 + WARNING 3: the original one-liner ("while a video
  // or track is open and you are not typing in a field") was FALSE in two
  // common situations, which is the precise failure this feature exists to
  // avoid -- it would have taught the user the app was broken:
  //
  //   1. player.js's handler returns immediately unless `state === STATE_FULL`.
  //      A track playing in the MINI-PLAYER is docked, so on /music -- a
  //      first-class library since v1.44 -- every playback key listed above is
  //      inert while a track is very much "open" and nothing is being typed.
  //      Same after starting a video and navigating away from /watch.
  //   2. the handler also bails when a BUTTON, A, INPUT, TEXTAREA or SELECT has
  //      focus. Clicking any control outside the player (Delete, a sidebar
  //      link) leaves it focused, so the keys go quiet -- and Space re-fires
  //      that button instead.
  //
  // Both are pre-existing player behavior, not something this dialog
  // introduced. The dialog's job is to describe them honestly.
  const note = d.createElement('div');
  note.className = 'shortcuts-note';
  note.textContent = 'Playback keys apply to the full player on a watch or reading page - '
    + 'the mini-player at the bottom does not take keyboard input. They also pause while you '
    + 'are typing, or while a button or link has focus (click the video to hand focus back).';
  modal.appendChild(note);

  const sheet = U.sheet({
    variant: 'dialog', title: 'Keyboard shortcuts', content: modal,
    onClosing: () => { if (onClose) onClose(); },
    doc: d, win: d.defaultView,
  });
  // The DDR arrows sit in the sheet header, top-right, just before its one Close.
  const closeBtn = sheet.el.querySelector('.ui-sheet__close');
  sheet.el.querySelector('.ui-sheet__header').insertBefore(ddrRow, closeBtn);
  return { sheet, backdrop: sheet.scrim, modal, closeBtn, ddrByKey };
}

// The live dialog, or null. Module-level so `?` cannot stack two of them.
let shortcutsModalState = null;

/**
 * Is the reference currently on screen? Exposed so OTHER document-level key
 * handlers can stand down while it is open -- read.js's page-flip arrows in
 * particular, which deliberately allow BUTTON focus through and would otherwise
 * turn pages behind the dialog (gate W7). Checks `isConnected` rather than the
 * bare state so a stranded reference can never wedge those handlers off.
 */
function isShortcutsModalOpen() {
  return Boolean(shortcutsModalState && shortcutsModalState.sheet.el.isConnected);
}

function closeShortcutsModal() {
  if (!shortcutsModalState) return;
  // v1.163: unbind the DDR arrow-key handler so the arrows go back to the player
  // (seek/volume) the moment the window closes -- it is a capture-phase document
  // listener, so leaving it bound would silently eat every arrow key session-wide.
  if (shortcutsModalState.ddrKeyHandler && typeof document !== 'undefined') {
    try { document.removeEventListener('keydown', shortcutsModalState.ddrKeyHandler, true); } catch (_) { /* ignore */ }
  }
  // REMOVED from the DOM, not hidden -- the v1.17.0 lesson: a modal backdrop
  // left in the tree with an author `display` is a full-viewport, invisible
  // touch/click eater. Sweep S9: the ui.sheet's close removes the scrim and the
  // sheet once its exit ends (a no-op when the sheet itself started the close).
  const state = shortcutsModalState;
  shortcutsModalState = null;
  state.sheet.close();
}

function openShortcutsModal() {
  if (typeof document === 'undefined' || !document.body) return;
  // v1.47.8 gate S9: re-check that the tracked backdrop is still IN the
  // document. If anything ever removed it without going through
  // closeShortcutsModal, the stale non-null state would make `?` a permanent
  // no-op for the rest of the session. Nothing does that today -- this is the
  // v1.45.8 isConnected lesson applied as one line of insurance rather than a
  // fix for a live bug.
  if (shortcutsModalState) {
    if (shortcutsModalState.sheet.el.isConnected) return; // genuinely open -- never stack
    // Stranded (backdrop removed without routing through closeShortcutsModal):
    // recover -- but FIRST unbind the leaked capture-phase DDR handler, or it
    // would keep eating every arrow key session-wide while the fresh window's
    // own handler is bound on top (gate: QA WARNING / adversarial S3). The next
    // closeShortcutsModal only knows about the NEW handler, so this branch is
    // the sole place the stranded one can be released.
    if (shortcutsModalState.ddrKeyHandler && typeof document !== 'undefined') {
      try { document.removeEventListener('keydown', shortcutsModalState.ddrKeyHandler, true); } catch (_) { /* ignore */ }
    }
    shortcutsModalState = null; // stranded -- recover instead of dying quietly
  }
  shortcutsModalState = buildShortcutsModal(document, { onClose: closeShortcutsModal });
  // v1.47.8 gate S10: while a video is in NATIVE fullscreen, only the
  // fullscreen element's subtree renders -- a dialog on body would be invisible
  // and then swallow `?` (state set, nothing on screen). The fullscreen element
  // is the correct host in that case: the sheet opens on body, then its scrim and
  // sheet move into it (the sheet removes them from wherever they are on close).
  const sheet = shortcutsModalState.sheet;
  sheet.open();
  if (document.fullscreenElement) {
    document.fullscreenElement.appendChild(sheet.scrim);
    document.fullscreenElement.appendChild(sheet.el);
  }
  // Focus the close control so Tab/Esc land somewhere sensible and the dialog
  // is reachable without a mouse -- it is a keyboard feature, after all.
  if (shortcutsModalState.closeBtn && typeof shortcutsModalState.closeBtn.focus === 'function') {
    shortcutsModalState.closeBtn.focus();
  }
  // v1.163 (Dean): the DDR mini-synth - while the window is open, the arrow keys
  // PLAY a note (they never seek/volume/scroll behind the dialog). Capture-phase
  // so it consumes the arrows before player.js's seek/volume handlers see them;
  // only the four arrows are intercepted, so Esc/Tab/? are untouched. Removed on
  // close (closeShortcutsModal).
  const ddrByKey = shortcutsModalState.ddrByKey || {};
  const ddrKeyHandler = (e) => {
    if (!e || !ddrByKey[e.key]) return;
    // Only a BARE arrow press plays -- let OS/browser modifier combos
    // (Cmd/Ctrl/Alt+Arrow) pass through untouched, mirroring player.js's own
    // modifier bail (gate: QA SUGGESTION).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const a = ddrByKey[e.key];
    playDdrNote(a.freq);
    a.pulse();
  };
  document.addEventListener('keydown', ddrKeyHandler, true);
  shortcutsModalState.ddrKeyHandler = ddrKeyHandler;
}

/**
 * Wire the `?` trigger + Esc, once per document. Desktop only, re-checked at
 * EVENT time rather than at boot: a laptop can be resized (or rotated into a
 * narrow window) long after load, and a boot-time check would strand whichever
 * answer it happened to see. Same reasoning as the pinch-zoom suppression.
 */
function wireKeyboardShortcutsHelp() {
  if (typeof document === 'undefined') return;
  // v1.47.8 gate CRITICAL 2: bound with `capture: true`, and the Escape branch
  // calls stopImmediatePropagation.
  //
  // THE BUG: this app has four independent document-level Escape listeners --
  // this dialog, the one-off download modal, watch.js's subscribe modal, and
  // player.js's audio-expand exit. None of them stop propagation, so ONE Escape
  // fired all of them. Proven: with the shortcuts dialog open, a single Escape
  // closed the dialog AND the subscribe modal AND the one-off modal AND
  // collapsed the expanded cover art.
  //
  // The worst case is data loss: open the one-off download modal, paste a long
  // URL, click the modal body (focus leaves the input, so `?` is allowed),
  // press `?` then Escape -- the download modal closes too and the pasted URL
  // is gone.
  //
  // CAPTURE, not bubble, and the distinction is load-bearing:
  // stopImmediatePropagation only suppresses listeners that have not run yet,
  // and listener order on `document` is not ours to control (the one-off
  // modal's handler is registered inside a fetch().then(), i.e. after boot).
  // A real key event targets the focused element, so a document CAPTURE
  // listener provably runs before every bubble listener on document and can
  // suppress the remainder of the dispatch.
  //
  // Scoped tightly: propagation is stopped ONLY when this dialog is actually
  // open. Escape with no dialog behaves exactly as it always has.
  // v1.47.8 gate S10 follow-up: appending to `document.fullscreenElement`
  // parents the backdrop inside `#player-wrapper`, which the player REPARENTS
  // on every mount/dock. If the dialog outlived fullscreen, a later dock would
  // drag it into `#player-dock` -- `position: fixed; z-index: var(--z-dock);
  // overflow: hidden`, i.e. a stacking context, so the backdrop's modal-band
  // rung would be re-resolved inside the dock's and paint under toasts.
  // Closing on fullscreen exit
  // removes the whole scenario rather than reasoning about who wins.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) closeShortcutsModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shortcutsModalState) {
      e.stopImmediatePropagation();
      e.preventDefault();
      closeShortcutsModal();
      return;
    }
    if (!isDesktopViewport()) return;
    const el = document.activeElement;
    const tag = (el && el.tagName) || '';
    const editable = Boolean(el && el.isContentEditable);
    // v1.50.3 (Dean, item B): D toggles dark/light -- mode only, exactly the
    // header moon/sun button's job, through the SAME toggleTheme() so the
    // two affordances can never diverge on persistence/mirroring. Allowed
    // while the shortcuts dialog is open (watching the theme flip behind the
    // reference is harmless and kind of the point). Same typing/modifier
    // guards as `?`, same desktop gating (the check above covers both).
    if (shouldToggleThemeKey(e, tag, editable)) {
      e.preventDefault();
      toggleTheme();
      return;
    }
    if (!shouldOpenShortcuts(e, tag, editable)) return;
    e.preventDefault();
    openShortcutsModal();
  }, true);
}

/**
 * Pure: should this keydown flip dark/light mode? `d`/`D`, no modifiers
 * (Cmd+D stays the browser bookmark), never while typing -- mirrors
 * shouldOpenShortcuts' contract exactly. Exported for node:test.
 */
function shouldToggleThemeKey(e, activeTag, isEditable) {
  if (!e || (e.key !== 'd' && e.key !== 'D')) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (isEditable) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(String(activeTag || '').toUpperCase()) === -1;
}

// Pure decision: should a plain `<a>` click be intercepted for an in-app swap
// instead of a normal browser navigation? Exported for node:test so every
// branch (modifier keys, target=_blank, cross-origin, unknown route) is
// covered without a real DOM/click event.
function shouldInterceptLinkClick({ button, metaKey, ctrlKey, shiftKey, altKey, targetAttr, sameOrigin, view }) {
  if (button !== 0) return false; // only a plain left-click
  if (metaKey || ctrlKey || shiftKey || altKey) return false; // let the browser open-in-new-tab/window etc.
  if (targetAttr === '_blank') return false;
  if (!sameOrigin) return false;
  if (!view) return false; // not a known SPA route (deriveRouteView returned null)
  return true;
}

// The `history.pushState`/`history.state` shape, in one place so the router
// and its `popstate` handler always agree on the fields. `scrollY` defaults
// to 0 (a fresh in-app navigation starts at the top, like a real page load).
function buildHistoryState(view, url, scrollY, depth, viewState, browseDepth) {
  const d = (typeof depth === 'number' && depth >= 0) ? Math.floor(depth) : 0;
  return {
    view,
    url: String(url),
    scrollY: (typeof scrollY === 'number' && scrollY >= 0) ? scrollY : 0,
    // v1.45.0 (T2): how many in-app history entries sit BEHIND this one. Seeded
    // 0 at bootRouter; each pushState sets current+1, each replaceState keeps
    // current (see nextHistoryDepth). It is the Home control's proof that there
    // is an in-app level to pop to via history.back(): depth>0 can NEVER walk
    // back past the session's first stamped entry to an external referrer,
    // because depth only ever rises on this router's OWN pushState calls.
    depth: d,
    // v1.217 (in-view back-stack): an OPAQUE per-view sub-state payload the
    // owning view stamps via pushViewState/replaceViewState (a drill descriptor,
    // a now-playing marker) and reads back in its onPopState hook. null for every
    // entry a view has not opted in on - i.e. every caller that passes no
    // viewState (navigate's two builds + bootRouter's seed).
    // Four callers pass a viewState: the two that CARRY an existing entry's payload
    // forward (parseHistoryState + the scroll-rewrite) and the two that STAMP a
    // new one (pushViewState/replaceViewState). Must be structured-cloneable
    // (plain data only) since the browser structured-clones history state.
    viewState: (viewState === undefined || viewState === null) ? null : viewState,
    // v1.362 (M7): the depth of the nearest BROWSE entry (any view but watch) at or
    // behind this one - where minimizing the player lands. A browse entry is its
    // own; a watch entry carries the one it was pushed from (browseDepthBehind),
    // kept only while it is really BEHIND (< depth), else null (a deep link).
    browseDepth: view !== 'watch'
      ? d
      : ((Number.isInteger(browseDepth) && browseDepth >= 0 && browseDepth < d) ? browseDepth : null),
  };
}

// v1.362 (M7): the browse depth a NEW entry pushed from `state` inherits. A browse
// entry (including one written before v1.362, which has no field) is its own
// level; a watch entry passes on what it carries. Pure - exported for node:test.
function browseDepthBehind(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.view !== 'watch') {
    return (typeof state.depth === 'number' && state.depth >= 0) ? Math.floor(state.depth) : null;
  }
  return (Number.isInteger(state.browseDepth) && state.browseDepth >= 0) ? state.browseDepth : null;
}

// v1.362 (M7, Dean 2026-10-03): where minimizing the player goes - back to the
// nearest browse entry behind (the feed / channel / search, past any watch
// entries, so a video opened from another video never reloads the earlier one),
// or a fresh Home when there is none (a deep link). Steps never exceed depth, so
// it can never walk out of the app. historyLength (gate r1, QA W2): the browser
// caps session history (Chromium keeps 50 entries), and a history.go() past the
// oldest kept entry is a silent no-op that fires no popstate - so a jump the
// session can no longer reach goes Home instead. reachableBack (v1.362.1, D5):
// the Navigation API's navigation.currentEntry.index, the count of same-origin
// entries the browser still keeps BEHIND this one (the HTML spec builds that
// list from the navigable's session history, contiguous same origin), so a jump
// of more steps cannot land; it decides when it is an integer, because
// history.length also counts FORWARD entries (a capped session after some Back
// presses). Without it (Safari before the Navigation API) the length rule stands.
// Pure - exported for node:test.
function resolveMinimizeLanding(depth, browseDepth, historyLength, reachableBack) {
  const d = (Number.isInteger(depth) && depth >= 0) ? depth : null;
  if (d !== null && Number.isInteger(browseDepth) && browseDepth >= 0 && browseDepth < d) {
    const steps = d - browseDepth;
    if (Number.isInteger(reachableBack)) return steps > reachableBack ? { action: 'home' } : { action: 'back', steps };
    if (typeof historyLength === 'number' && isFinite(historyLength) && steps >= historyLength) return { action: 'home' };
    return { action: 'back', steps };
  }
  return { action: 'home' };
}

// Defensive parse of `event.state` (a `popstate` can fire with a `null` state
// -- e.g. the very first entry, before this router ever called
// `pushState`/`replaceState`). Falls back to deriving fresh state from the
// CURRENT location so `popstate` never throws on a state-less entry.
function parseHistoryState(state, fallbackLocation) {
  if (state && typeof state === 'object' && typeof state.view === 'string') {
    // v1.45.0 (T2): carry `depth` through so a popstate back to this entry
    // (and any later replaceState that rebuilds it — recordScrollForCurrentState)
    // preserves the in-app depth the Home control reads.
    return buildHistoryState(state.view, state.url, state.scrollY, state.depth, state.viewState, state.browseDepth);
  }
  const loc = (fallbackLocation && typeof fallbackLocation === 'object') ? fallbackLocation : {};
  const view = deriveRouteView(loc.pathname || '');
  return buildHistoryState(view, (loc.pathname || '') + (loc.search || ''), 0, 0);
}

// FR-4 (T4): normalizes an absolute OR relative URL/href string down to its
// "pathname+search" form, resolved against `baseHref`. A given history
// entry's stored `url` may be an absolute href (`navigate()`'s `pushState`
// calls) or a bare relative path (`bootRouter`'s initial `replaceState`,
// `parseHistoryState`'s own fallback) -- this lets home-URL-cache
// comparisons treat both forms identically instead of ever spuriously
// mismatching on origin/absoluteness alone. Never throws; an unparseable
// href is returned unchanged. Exported for node:test.
function toPathAndQuery(href, baseHref) {
  try {
    const u = new URL(String(href), baseHref);
    return u.pathname + u.search;
  } catch (_) {
    return String(href);
  }
}

// Pure (W2, v1.16.0): whether a navigation attempt tagged `gen` is now STALE
// -- i.e. a NEWER navigation has since bumped `currentGeneration` past it.
// Mirrors player.js's `loadGeneration` staleness check exactly (same
// "monotonic counter, compare-at-resolution" pattern). Exported for
// node:test; see the `navGeneration` module comment (below, in the router
// runtime section) for the full rationale and its two callers
// (`navigate()`/`handlePopState()`).
function isStaleNavGeneration(gen, currentGeneration) {
  return gen !== currentGeneration;
}

// Pure decision backing `applyPlayerTransition` (below, FR-1, T2): should
// leaving `fromView` for `toView` dock the persistent player? Exported for
// node:test coverage -- the actual DOM side effect (calling
// `window.FileTube.player.dock()`) is a thin, untested-by-necessity runtime
// wrapper around this, the same pure/runtime split every other helper in
// this file uses. Only ever true when actually leaving the watch view for a
// DIFFERENT known view -- watch -> watch (a related-card/prev-next click
// into another video) must NOT dock (see the caller's comment for why).
// Whether there's actually anything loaded to dock is a STATEFUL guard that
// intentionally lives in `player.dock()` itself, not here.
function shouldDockOnTransition(fromView, toView) {
  // v1.39.0: 'read' joins 'watch' as a view that hosts the FULL player (book
  // narration mounts FULL into the reader's #player-slot). v1.44: 'music' joins
  // them (a track mounts FULL into /music's #player-slot). Leaving ANY of these
  // for a different view docks the persistent host into the shell #player-dock
  // so playback survives the #view-root swap (Dean: tapping Home while a track
  // plays keeps the mini-player going); staying (music->music etc.) adopts
  // instead of docking. v1.71: 'podcasts' joins them (the expanded
  // now-playing view mounts FULL into /podcasts' #player-slot). Mirrored
  // in player.js.
  return (fromView === 'watch' || fromView === 'read' || fromView === 'music' || fromView === 'podcasts') && typeof toView === 'string' && toView !== fromView;
}

// tech-debt #46: is this navigation a no-op — a request to go EXACTLY where we
// already are (same path + query)? Tapping the already-active nav item, or the
// docked mini-player's return while already on /music, would otherwise tear
// down and rebuild #view-root — stranding a FULL-mounted player that the
// incoming init() doesn't re-adopt (music/read), and needlessly re-fetching +
// re-initing every other view. Standard SPA behavior is to no-op the active
// link. Pure so the router test can exercise it without a live location.
// NOTE: compares pathname+search only — the hash is intentionally ignored (no
// caller does hash-anchored navigate() today; the router doesn't route on hash).
// If a future in-page anchor nav is added, revisit so it isn't silently no-op'd.
function isSameLocationNav(currentPathAndSearch, targetPathAndSearch) {
  return typeof targetPathAndSearch === 'string' && currentPathAndSearch === targetPathAndSearch;
}

// v1.45.0 (T2): the depth the NEXT history entry should carry. A pushState adds
// one in-app level behind the new entry (current + 1); a replaceState keeps the
// current entry's own depth (it replaces in place, adding no level). `current`
// is the state being pushed/replaced FROM (window.history.state at call time);
// a missing/garbage depth reads as 0. Pure — exported for node:test.
function nextHistoryDepth(currentState, isReplace) {
  const cur = (currentState && typeof currentState.depth === 'number' && currentState.depth >= 0)
    ? Math.floor(currentState.depth) : 0;
  return isReplace ? cur : cur + 1;
}

// v1.217 (in-view back-stack): the PURE decision for handlePopState - given the
// popped history state, the currently-mounted view name, and that view's
// registered module, return the module's onPopState function to delegate to, or
// null to fall through to the router's normal fetch+swap. Delegation happens
// ONLY when the popped entry belongs to the SAME view that is already mounted
// (a within-view step, e.g. music-drill -> music-browse) AND that view opted in
// with an onPopState hook. A cross-view pop (leaving the section) has a different
// `view` and never delegates - it swaps as it always has. Exported for node:test.
function popStateDelegate(poppedState, currentViewName, viewMod) {
  if (!poppedState || poppedState.view == null) return null;
  if (!currentViewName || poppedState.view !== currentViewName) return null;
  if (!viewMod || typeof viewMod.onPopState !== 'function') return null;
  return viewMod.onPopState;
}

// v1.45.0 (T2): what the Home control should do, given the CURRENT entry's
// in-app `depth` and where we are now. Dean's model: Home walks UP one in-app
// level per tap, restoring the scroll/view left at each level; "home" is simply
// the top of that walk.
//   - depth > 0            -> 'back'   (pop one level via history.back(), which
//                                        reuses the router's popstate restore)
//   - depth 0, not at home -> 'go-home' (a deep-link entry with no in-app history
//                                        behind it — navigate('/') to reach home)
//   - depth 0, at home     -> 'noop'   (already at the session-root home)
// Pure — exported for node:test so every branch is covered without a live
// history/location.
// v1.160 / v1.160.3 (Dean): the swipe-back decision (PURE, top-level so it's
// exportable/testable; the touch wiring lives in the router closure). v1.160.3
// dropped the left-EDGE start requirement (Dean: "left swipe from the middle") -
// a drag from ANYWHERE that travels RIGHT past the threshold and is
// horizontal-dominant goes back. A vertical scroll, a tap, or a leftward drag
// never triggers it; a drag that BEGINS inside a horizontal scroller is excluded
// by the wiring (isHorizontalScrollerBox) so the two never fight.
const SWIPE_BACK_THRESHOLD_PX = 90; // a deliberate rightward travel (more than the
                                    // old 64 edge value - a mid-screen start needs
                                    // to be unambiguous vs an ordinary drag).
// v1.160.1 (Dean device report): once a drag has committed to horizontal +
// rightward (past a claim distance), the handler preventDefaults the REST of it
// so the browser does NOT also pan/rubber-band the page - the "whole app shakes
// with it" abruptness. Pure so it's testable. A non-passive touchmove is what
// lets us preventDefault; v1.160.3 attaches that listener LAZILY - only once a
// drag is CONFIRMED horizontal (swipeBackShouldClaim), never on a vertical
// scroll - so normal scrolling keeps the compositor fast-path (a globally- or
// eagerly-registered non-passive document touchmove would force the whole page
// off it - gate WARNING v1.160.1).
const SWIPE_BACK_CLAIM_PX = 16;
// v1.160.3 gate (Surface D): a swipe-back from ANYWHERE demands CLEAR horizontal
// dominance, not a bare |dx|>|dy| - else a big diagonal drag (100 right, 95 down)
// both fires a back and (while claimed) eats the scroll. dx must beat dy by this
// factor. Used by BOTH the claim and the fire decision so they never disagree (a
// gesture that is claimed-and-prevented but not fired would eat a scroll for
// nothing - keeping one predicate closes that band).
const SWIPE_BACK_DOMINANCE = 1.5;
function swipeBackShouldClaim(deltaX, deltaY) {
  const dx = Number(deltaX) || 0;
  const dy = Number(deltaY) || 0;
  return dx > SWIPE_BACK_CLAIM_PX && Math.abs(dx) > Math.abs(dy) * SWIPE_BACK_DOMINANCE;
}
function decideSwipeBack(g) {
  if (!g) return false;
  const dx = Number(g.deltaX) || 0;
  const dy = Number(g.deltaY) || 0;
  if (dx < SWIPE_BACK_THRESHOLD_PX) return false;                    // enough rightward travel
  if (Math.abs(dx) <= Math.abs(dy) * SWIPE_BACK_DOMINANCE) return false; // clearly horizontal, not a scroll
  return true;
}
// A drag that BEGINS inside a horizontally-scrollable box (a wide table, a pill
// strip) must scroll THAT box, never fire a back - or the gesture and the scroll
// fight. Pure predicate over one box's computed overflow + measured extent; the
// wiring walks the ancestor chain with it.
function isHorizontalScrollerBox(overflowX, scrollWidth, clientWidth) {
  const ox = String(overflowX || '');
  return (ox === 'auto' || ox === 'scroll') && Number(scrollWidth) > Number(clientWidth);
}
// v1.311.2 (Dean, device-CONFIRMED): a rightward SCRUB of the seek bar travelled
// past the threshold and fired history.back() on release - leaving the player and
// dropping fullscreen. A drag that begins on a SCRUBBER is that scrubber's, never a
// back. v1.311.3 (Dean's scope ruling, "scrubbers only"): v1.311.2 also stood the
// back down on the WHOLE player, the WHOLE full-screen skin and any view holding the
// body lock - which took away the one escape from a skin stuck behind a pinned body.
// Now only the things you actually drag sideways own the gesture: the pc-range
// seek/volume on every shell, the skin seeks, the click wheel, the Brick paddle, the wheel-calibration stage, any other
// range/slider. Everywhere else - the video, a skin's art - a clear rightward
// swipe goes back again. (v1.337, Dean: NOT in fullscreen video - see
// swipeBackStandDownReason.)
const SWIPE_BACK_OWNER_SELECTORS = [
  '[data-skin-seek]', '.ip-wheel', '.ipod-brick',
  '.whcal-stage', // the wheel-calibration tool's spin area (Settings > Experimental) - v1.311.2 gate W2
  'input[type="range"]', '[role="slider"]',
];
// ...plus the NET for scrubbers nobody listed yet: an element that took the
// browser's horizontal panning away (`touch-action: none`, or `pan-y` without
// `pan-x`) has declared its sideways drag is its own (drag handles, the avatar
// crop stage, the pc-range seek). Pure over one computed touch-action value.
function touchActionOwnsHorizontal(touchAction) {
  const ta = String(touchAction || '').trim().toLowerCase();
  if (!ta || ta === 'auto') return false;
  if (/\bnone\b/.test(ta)) return true;
  return /\bpan-y\b/.test(ta) && !/\bpan-x\b/.test(ta);
}
// v1.311.3: inside the full-screen skin, touch-action is a PAGE LOCK, not a gesture
// claim - `.mms-full` is touch-action:none so the page behind cannot scroll, and its
// lists are pan-y so they scroll vertically. Read as the NET, it made the whole skin
// an owner again. Every skin scrubber is enumerated above, so the NET stands aside there.
const SWIPE_BACK_NET_EXEMPT_ROOT = '.mms-full';
// Why a drag starting at `startEl` must NOT be a back ('fullscreen' | 'owner' | 'touch-action' |
// 'scroller'), or null when it may be one. Walks startEl up to <body> once, reading
// each box's computed style (the v1.160.3 scroller guard folded into the same walk).
function swipeBackStandDownReason(startEl, doc, win) {
  // v1.337 (Dean: "In full screen video view if I swipe right anywhere that isn't the scrub bar it
  // exits full screen on mobile"; his ruling: a right swipe does NOTHING in fullscreen video). The
  // back left the watch page (or popped to a previous watch page), which drops fullscreen. Fullscreen
  // has its own ways out (the fullscreen button, a rotate), so while the faux overlay
  // (body.ft-css-fullscreen, player.js setCssFullscreen) or a Fullscreen API element is up, the swipe
  // is not a back. The expanded audio view and the full-screen skins keep their swipe-back (v1.311.3)
  // - except where the audio view itself is in real Fullscreen API fullscreen (a desktop-class touch
  // device, player.js enterFullscreen): a fullscreen is a fullscreen.
  if (doc && doc.body && doc.body.classList && doc.body.classList.contains('ft-css-fullscreen')) return 'fullscreen';
  if (doc && (doc.fullscreenElement || doc.webkitFullscreenElement)) return 'fullscreen';
  const ownerSel = SWIPE_BACK_OWNER_SELECTORS.join(',');
  const gcs = win && typeof win.getComputedStyle === 'function' ? win.getComputedStyle.bind(win) : null;
  const netOff = !!(startEl && typeof startEl.closest === 'function' && startEl.closest(SWIPE_BACK_NET_EXEMPT_ROOT));
  for (let node = startEl; node && node.nodeType === 1 && node !== doc.body; node = node.parentElement) {
    if (typeof node.matches === 'function' && node.matches(ownerSel)) return 'owner';
    const cs = gcs ? gcs(node) : null;
    if (!cs) continue;
    if (!netOff && touchActionOwnsHorizontal(cs.touchAction)) return 'touch-action';
    if (isHorizontalScrollerBox(cs.overflowX, node.scrollWidth, node.clientWidth)) return 'scroller';
  }
  return null;
}
// v1.160/.3 swipe-back WIRING, lifted out of the router closure (v1.311.2) so the
// real listeners can be driven in a test. `onBack` is the router's
// swipeBackIfPossible (the depth>0 / homeBackPending guard stays there).
function wireSwipeBackGesture(doc, win, onBack) {
  let track = null; // { startX, startY, x, y, claimed } for a single-touch drag
  // v1.160.1/.3: once a drag is CONFIRMED horizontal we preventDefault the rest
  // of it, so the browser can't also pan/rubber-band the page ("the whole app
  // shakes with it"). This non-passive listener is attached LAZILY - only after
  // swipeBackShouldClaim fires (in the passive move below) - and removed when the
  // gesture ends. A vertical scroll never claims, so it never attaches this and
  // never leaves the compositor fast-path (the v1.160.1 gate lesson: an eager or
  // global non-passive document touchmove taxes every scroll).
  // v1.160.3 gate WARNING 1: RE-EVALUATE direction every move - do NOT latch.
  // A gesture that claimed early (a slight rightward arc) but then curves
  // vertical must STOP being prevented, or it eats an intended scroll and fires
  // no back. Re-checking swipeBackShouldClaim on the live cumulative delta
  // restores the per-move semantics the v1.160.1 edge handler had.
  function onClaimedMove(e) {
    if (e.cancelable && track && swipeBackShouldClaim(track.x - track.startX, track.y - track.startY)) e.preventDefault();
  }
  function stopTracking() {
    if (!track) return;
    if (track.claimed) doc.removeEventListener('touchmove', onClaimedMove);
    track = null;
  }
  doc.addEventListener('touchstart', (e) => {
    stopTracking(); // drop any stale drag (missed end / second finger)
    if (!e.touches || e.touches.length !== 1) return;
    // v1.311.2/.3: a drag that starts on a scrubber (or a horizontal scroller) is
    // never tracked.
    if (e.target && swipeBackStandDownReason(e.target, doc, win)) return;
    const t = e.touches[0];
    track = { startX: t.clientX, startY: t.clientY, x: t.clientX, y: t.clientY, claimed: false };
  }, { passive: true });
  doc.addEventListener('touchmove', (e) => {
    if (!track || !e.touches || e.touches.length !== 1) return;
    const t = e.touches[0]; track.x = t.clientX; track.y = t.clientY;
    // Confirmed horizontal + rightward: claim the REST of the drag (attach the
    // non-passive preventDefault). Done once per drag; vertical scrolls never
    // reach here so they stay passive/fast.
    if (!track.claimed && swipeBackShouldClaim(track.x - track.startX, track.y - track.startY)) {
      track.claimed = true;
      doc.addEventListener('touchmove', onClaimedMove, { passive: false });
    }
  }, { passive: true });
  const finish = () => {
    if (!track) return;
    const g = { deltaX: track.x - track.startX, deltaY: track.y - track.startY };
    stopTracking();
    if (decideSwipeBack(g)) onBack();
  };
  doc.addEventListener('touchend', finish, { passive: true });
  doc.addEventListener('touchcancel', stopTracking, { passive: true });
}

function resolveHomeButtonAction(depth, currentPathAndSearch) {
  const d = (typeof depth === 'number' && depth >= 0) ? Math.floor(depth) : 0;
  // v1.45.0 gate-fix (C1): the home ROOT is the TOP of the walk — being there
  // means there is nothing above to pop to, so Home is always a no-op there,
  // checked BEFORE depth. This makes it impossible for a home entry that was
  // (for any reason — e.g. a go-home push) stamped at depth>0 to resolve to
  // 'back' and ping-pong into the page it was reached from. A filtered/folder
  // home ('/?root=', '/?search=') is NOT the root — it's a real level and still
  // pops.
  const atHome = currentPathAndSearch === '/' || currentPathAndSearch === '/index.html';
  if (atHome) return 'noop';
  if (d > 0) return 'back';
  return 'go-home';
}

// v1.45.0 (T2): is a click target the home ROOT (`/` or `/index.html` with no
// query) — i.e. a Home affordance (header logo / sidebar Home / bottom-nav
// Home), which routes through the incremental-pop goHomeControl — versus a
// `/?root=<folder>` drill, which is an ordinary forward navigation? Pure —
// exported for node:test.
function isHomeRootTarget(pathname, search) {
  const isRootPath = pathname === '/' || pathname === '/index.html';
  return isRootPath && (!search || search === '');
}

// ---- v1.78 device handoff: THIS device's identity -------------------------
//
// Two values ride every progress ping so the server can answer "what is
// playing on your OTHER device": a stable per-device id and a human label.
// Both are minted entirely client-side - the server never assigns identity,
// which is why this needs no schema, no registration step and no migration.

const DEVICE_ID_KEY = 'ft-device-id';

// The label roster (the device TYPE; v1.349 adds the per-browser word and the typed name below). ORDER IS
// LOAD-BEARING and every entry below is here because a naive check gets it
// wrong:
//   - iPod must precede iPhone: an iPod touch reports "iPod touch; CPU iPhone
//     OS 15_7", so an /iPhone/ test matches it first and every iPod reads as
//     an iPhone. (Caught by the unit test, not by inspection.)
//   - iPad must precede Macintosh: iPadOS 13+ reports a DESKTOP Safari UA
//     containing "Macintosh", so an iPad reads as a Mac unless we use the
//     touch-points tell (a real Mac reports maxTouchPoints 0).
//   - Android must precede Linux: every Android UA also says "Linux".
//   - CrOS must precede Linux for the same reason.
// Pure and exported - the UA table is exactly the kind of thing that rots
// silently, so node:test pins each arm.
function resolveDeviceLabel(userAgent, opts) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const touchPoints = opts && typeof opts.maxTouchPoints === 'number' ? opts.maxTouchPoints : 0;

  if (/iPod/i.test(ua)) return 'iPod';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  // The iPadOS-masquerading-as-desktop case.
  if (/Macintosh/i.test(ua) && touchPoints > 1) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Windows/i.test(ua)) return 'PC';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Another device';
}

// A UUID in the charset the server accepts ([A-Za-z0-9_-]). crypto.randomUUID
// needs a secure context, which a self-hosted FileTube on a plain-HTTP LAN
// address is NOT - so the fallback is not theoretical here, it is the common
// case for Dean's own server.
function mintDeviceId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      let out = '';
      for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
      return out;
    }
  } catch (_) { /* fall through to the last-resort id below */ }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// In-memory fallback for the session, used when localStorage is unavailable
// (private mode, disabled storage). Presence still works - the device just
// forgets who it was on reload, which costs a duplicate map entry and nothing
// else. That is why the device cap exists.
let volatileDeviceId = null;

function getDeviceId() {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const minted = mintDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, minted);
    return minted;
  } catch (_) {
    if (!volatileDeviceId) volatileDeviceId = mintDeviceId();
    return volatileDeviceId;
  }
}

// v1.349: a short friendly word per browser, derived from its device id, so three Macs read as
// "Mac · Otter", "Mac · Pebble"... A browser cannot read its hostname (no API; WebRTC local
// addresses are mDNS-obfuscated), so the word stands in for it. 3-7 ASCII letters, capitalized, no
// two sharing their first 4 letters (test/unit/device-name.test.js pins all of it).
const DEVICE_WORDS = Object.freeze([
    'Otter', 'Maple', 'Pebble', 'Willow', 'Badger', 'Cedar', 'Comet', 'Meadow', 'Falcon', 'Ginger', 'Harbor',
    'Juniper', 'Kettle', 'Lantern', 'Marble', 'Nutmeg', 'Orchid', 'Pepper', 'Quill', 'Raven', 'Sorrel',
    'Thistle', 'Umber', 'Velvet', 'Walnut', 'Yarrow', 'Zephyr', 'Acorn', 'Birch', 'Cobalt', 'Daisy', 'Ember',
    'Fennel', 'Garnet', 'Heron', 'Indigo', 'Jasper', 'Kiwi', 'Lemon', 'Mango', 'Nectar', 'Olive', 'Peach',
    'Quartz', 'Robin', 'Saffron', 'Tulip', 'Violet', 'Wombat', 'Almond', 'Beacon', 'Cactus', 'Dune', 'Elm',
    'Fjord', 'Gecko', 'Hazel', 'Iris', 'Jelly', 'Koala', 'Lotus', 'Mint', 'Nutria', 'Oasis', 'Panda',
    'Quince', 'Reed', 'Spruce', 'Tiger', 'Urchin', 'Vine', 'Wren', 'Yucca', 'Zinnia', 'Apricot', 'Biscuit',
    'Clover', 'Dolphin', 'Eagle', 'Finch', 'Glacier', 'Honey', 'Ivy', 'Jackal', 'Kelp', 'Lilac', 'Moss',
    'Newt', 'Oak', 'Plum', 'Quokka', 'Rowan', 'Sparrow', 'Toffee', 'Umbra', 'Waffle', 'Aspen', 'Bramble',
    'Coral', 'Dahlia', 'Fig', 'Gull', 'Hickory', 'Ibis', 'Lark', 'Mole', 'Nettle', 'Ocelot', 'Poppy',
    'Radish', 'Sage', 'Teal', 'Basil', 'Cinder', 'Pine', 'Rye', 'Tern', 'Yam',
]);

// FNV-1a 32-bit over the id, mod the list: stable for an id, spread across ids.
function deviceWord(id) {
  const s = String(id == null ? '' : id);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return DEVICE_WORDS[h % DEVICE_WORDS.length];
}

// The typed name (Settings > Account > "This device's name"): per browser, replaces the whole
// label. Stripped like lib/presence/store.js normalizeLabel (control + bidi chars; the isolates
// U+2066-2069 too) and capped at its LABEL_MAX, so what is stored is what the server keeps.
const DEVICE_NAME_KEY = 'ft-device-name';
const DEVICE_NAME_MAX = 32;
function cleanDeviceName(raw) {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(raw == null ? '' : raw).replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, '').trim();
  return cleaned.length > DEVICE_NAME_MAX ? cleaned.slice(0, DEVICE_NAME_MAX).trim() : cleaned;
}
function getDeviceName() {
  try { return cleanDeviceName(localStorage.getItem(DEVICE_NAME_KEY)); } catch (_) { return ''; }
}
// Returns the stored name ('' when cleared). Empty (after cleaning) removes the key.
function setDeviceName(v) {
  const name = cleanDeviceName(v);
  try {
    if (name) localStorage.setItem(DEVICE_NAME_KEY, name); else localStorage.removeItem(DEVICE_NAME_KEY);
  } catch (_) { /* private mode: the name lasts only until reload */ }
  try { if (typeof window !== 'undefined' && window.FileTube && window.FileTube.remote) window.FileTube.remote.relabel(); } catch (_) { /* best effort */ }
  return name;
}

// The automatic label: the type plus this browser's word ("Mac · Otter").
function getAutoDeviceLabel() {
  let type = 'Another device';
  try { type = resolveDeviceLabel(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints }); } catch (_) { /* keep the fallback */ }
  return type + ' \u00B7 ' + deviceWord(getDeviceId());
}

// What every presence ping, Speakers row and "Controlled by" pill shows: the typed name when set.
function getDeviceLabel() {
  return getDeviceName() || getAutoDeviceLabel();
}

// ---- v1.78 device handoff: the card's PURE decisions ----------------------
//
// Everything that decides WHAT the card says, and WHETHER it says it, lives
// here as pure functions - the runtime below only fetches, renders and wires.
// That split is deliberate: the display rules are where the bugs live, and a
// pure function is the only part node:test can hold without a browser.

const HANDOFF_POLL_MS = 30000;
const HANDOFF_DISMISS_KEY = 'ft-handoff-dismissed';

// Where the card is ALLOWED to appear. Dean's ruling 2 scopes it to "Home and
// other top-level LIST surfaces" - so this is an INCLUDE list (default-deny),
// not an exclude list. The gate QA seat caught the earlier exclude-list
// version showing the card on Settings, search, and channel pages too - a
// playback toast over the Settings form is exactly the interruption ruling 2
// scopes out. Default-deny also means a NEW page added later cannot
// accidentally start showing the card; whoever adds a new list surface adds
// it here on purpose.
//
// These are the pathnames of the app's top-level browsing lists. NB the
// reader (/read.html) is deliberately ABSENT even though activeNavItem maps
// it to 'books' - it is a reading surface, not a list (same reason /watch.html
// is out). Query strings (?root=, ?search=, ?liked=) do not change the
// surface's identity, so only pathname is matched.
const HANDOFF_LIST_SURFACES = new Set([
  '/', '/index.html',      // Home (and the ?liked=1 Liked scope of it)
  '/music', '/music.html',
  '/podcasts', '/podcasts.html',
  '/history', '/history.html',
  '/books', '/books.html',
  '/subscriptions',
]);

// "18 min ago" / "just now". Coarse on purpose: this is a lingering-state
// hint, and a ticking seconds counter on a paused card reads as busywork.
function formatHandoffAge(ageSeconds) {
  const secs = Number.isFinite(ageSeconds) && ageSeconds > 0 ? Math.floor(ageSeconds) : 0;
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

// The headline names the DEVICE (the news) AND the MODALITY (v1.304): a
// LISTENED item reads "Listening on <device>", a watched one "Watching on
// <device>", so Dean can tell at a glance that continuing will land in the
// audio player, not the video player. `presence.listen` is stamped by the
// server resolver (true for tracks/podcasts and for a media item played via
// Listen); absent/false means watch.
function formatHandoffHeadline(presence) {
  const label = (presence && presence.deviceLabel) || 'another device';
  const verb = presence && presence.listen ? 'Listening' : 'Watching';
  if (presence && presence.state === 'paused') {
    return `Paused ${verb.toLowerCase()} on ${label} - ${formatHandoffAge(presence.ageSeconds)}`;
  }
  return `${verb} on ${label}`;
}

// "12:34 / 45:06", or just the position when the duration is unknown (a live
// stream, or a ping that never carried one) - never "12:34 / 0:00".
function formatHandoffTime(position, duration) {
  const pos = formatDuration(position);
  if (!Number.isFinite(duration) || duration <= 0) return pos;
  return `${pos} / ${formatDuration(duration)}`;
}

function handoffProgressPercent(position, duration) {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(100, Math.max(0, (position / duration) * 100));
}

// The dismissal identity. It carries the STATE as well as the item and device
// so that dismissing "Watching on iPhone" does not also swallow the later
// "Paused watching on iPhone" - a state flip is new news (Dean's ruling 2:
// dismiss hides it "until the state changes").
function handoffSuppressionToken(presence) {
  if (!presence) return '';
  return `${presence.mediaId}|${presence.deviceId}|${presence.state}`;
}

// v1.356 gate r1 (Q2 = A3): the card follows the remote control LIVE, not only at its 30 s poll. A phone that
// attaches to a speaker (a resume on launch decided the card while still local) hides it at once; one that
// lets go asks again under the normal rule. `card` = {hide, poll}. Returns the unsubscribe.
function bindHandoffToRemote(rc, card) {
  if (!rc || typeof rc.onChange !== 'function' || typeof rc.isRemote !== 'function' || !card) return () => {};
  let was = !!rc.isRemote();
  if (was) card.hide();
  return rc.onChange(() => {
    const now = !!rc.isRemote();
    if (now === was) return;
    was = now;
    if (now) card.hide(); else card.poll();
  });
}

/**
 * The one show/hide decision. `ctx` carries what only the browser knows:
 *   pathname       - the current page
 *   localPlayingId - the id THIS page's player currently has loaded (or null)
 *   dismissedToken - the token the user last dismissed (or '')
 */
function shouldShowHandoffCard(presence, ctx) {
  if (!presence || !presence.mediaId) return false;
  const c = ctx || {};
  if (!HANDOFF_LIST_SURFACES.has(c.pathname)) return false; // default-deny (ruling 2)
  // Never offer what this very page is already playing (the UI spec's
  // "nothing shown on a surface that is itself mid-playback of that item").
  if (c.localPlayingId && c.localPlayingId === presence.mediaId) return false;
  // v1.348 (D8): a device that is controlling another PC plays nothing itself, so "continue on this
  // device" would fight the remote session it is steering.
  if (c.controllingRemote) return false;
  if (c.dismissedToken && c.dismissedToken === handoffSuppressionToken(presence)) return false;
  return true;
}

// Guarded so requiring this file in Node (for unit tests) never touches
// `window`/`document`. Everything in this block is the actual router RUNTIME
// (registry storage, fetch/swap, click/popstate wiring) -- the pure helpers
// above are what node:test exercises directly.
if (typeof window !== 'undefined') {
  const viewRegistry = Object.create(null);
  let currentViewName = null;
  // FR-4 (T4) -- the URL (pathname+search) the CURRENT view is displaying,
  // kept in lockstep with currentViewName by every path that sets it
  // (swapToView, restoreHomeFromCache, bootRouter). This is what lets
  // "leaving home" record which home URL is being cached, independent of
  // whether a given history entry happened to store an absolute href
  // (navigate()'s pushState) or a relative one (bootRouter's initial
  // replaceState / parseHistoryState's fallback) -- see toPathAndQuery.
  let currentViewUrl = null;
  // v1.247 (Dean, F2 MENU-returns-to-origin): the URL the mobile skin player was launched FROM,
  // so the skin's MENU/collapse docks the mini-player back on THAT origin tab (dock-to-mini, not
  // close). The model is deliberately simple and set ONLY at the navigate() choke below:
  //   - a CROSS-VIEW launch (a card/search/deep-link on another tab navigating into /music?play=
  //     or /podcasts?play=) records the FROM url -> MENU returns THERE (home, search, whatever);
  //   - ANY OTHER navigation resets it to null -> so an IN-VIEW session (you were already on the
  //     music/podcasts tab, last nav was to that tab, you tapped a track) has no origin and MENU
  //     just docks IN PLACE on that tab; likewise a notification COLD-START onto /music?play=
  //     (no navigate() at all -> origin stays null -> dock in place = the content tab).
  // Because it is set only by navigation, prev/next/autoplay (which never navigate) can't corrupt
  // a launched session's origin - MENU still returns where you launched from after skipping tracks.
  let playerLaunchOrigin = null;
  function getPlayerLaunchOrigin() { return playerLaunchOrigin; }
  // v1.283 (Dean, adversarial WARNING): SPEND the origin explicitly. Only navigation sets it
  // (above), so an IN-VIEW change that "leaves" the origin behind - specifically a listen skin
  // docking in place on /music (music.js dockToOrigin) - has no navigation to clear it, and the
  // stale watch-page origin would fire on a LATER MENU after an in-view normal-track play,
  // bouncing the user to the original video. Clearing it here makes any subsequent MENU dock in
  // place (the Watch way-back button remains the explicit route back to the video).
  function clearPlayerLaunchOrigin() { playerLaunchOrigin = null; }
  function returnToPlayerOrigin() {
    // no origin (in-view session / cold-start) -> do nothing, the dock stays on the current tab;
    // a cross-view origin -> navigate back to it (the mini-player, reparented into the persistent
    // #player-dock by the dock, survives the #view-root swap and rides along to the origin tab).
    if (!playerLaunchOrigin) return;
    // v1.247 (adversarial SUGGESTION): if the origin is the SAME tab we're already on (e.g. a
    // /music?play= card tapped while already on /music -> origin '/music'), just dock in place -
    // don't navigate('/music'), which differs from the live '/music?play=x' by strict string
    // equality and would pointlessly re-init the view. A different tab still navigates.
    try {
      if (new URL(playerLaunchOrigin, window.location.href).pathname === window.location.pathname) return;
    } catch (_) { /* unparseable -> fall through to navigate */ }
    navigate(playerLaunchOrigin);
  }
  // v1.332 (Dean D7): HOME from the full-screen player - the sticker's Home row and a held MENU on
  // the Click wheel (skin-surface.js offers both; music.js and podcasts.js hand it here). Dock the
  // player (the song keeps playing in the mini, which the dock reparents into the persistent
  // #player-dock so it survives the #view-root swap), let the view re-render (afterDock - its
  // un-render clears the full-screen classes), then the SPA router to / (no reload; navigate()
  // itself resets the launch origin, so a later MENU docks in place).
  function goHomeFromPlayer(afterDock) {
    const pl = window.FileTube && window.FileTube.player;
    try { if (pl && typeof pl.dock === 'function') pl.dock(); } catch (_) { /* the dock is best-effort */ }
    try { if (typeof afterDock === 'function') afterDock(); } catch (_) { /* the view re-render is best-effort */ }
    navigate('/');
  }
  // FR-4 (T4) -- single-entry cache of the last home #view-root NODE (not a
  // re-render) retained across an in-app round trip, so returning to the
  // EXACT SAME home URL reattaches it instantly instead of re-fetching and
  // re-rendering (no flash, no scroll-jump, no image-height race -- see
  // restoreHomeFromCache below). Populated only when leaving home for a
  // DIFFERENT kind of view (swapToView's home-cache branch); consumed
  // (nulled) either by a matching reattach (restoreHomeFromCache) or, if
  // it's about to be orphaned by a fresh home re-init for a DIFFERENT home
  // URL, destroyed and discarded first (swapToView's `view === 'home'`
  // branch). main.js's home view registers ALL of its listeners --
  // including the ones it binds onto the PERSISTENT shell's
  // #sidebar-folders-list, not just its own #view-root subtree -- through
  // ONE AbortController per init() call (reused via closure, not per-node),
  // so at most one home instance's listeners may ever be live at a time;
  // this cache must never let two coexist (see the comments on both
  // branches below for exactly how that's kept true). The shell's header
  // #search-input/#search-btn are a separate, SHELL-owned control (bound
  // once at boot, never per-view -- see the C1 remediation comment on
  // common.js's DOMContentLoaded handler), so they are unaffected by any of
  // this.
  // In-memory only: a real page load/refresh starts with this null, so a
  // fresh or deep-linked home load is never affected by a previous session.
  let homeViewCache = null;

  // W2 remediation (v1.16.0): a monotonically-increasing navigation-
  // generation token -- mirrors player.js's `loadGeneration` guard exactly.
  // `navigate()`/`handlePopState()` each bump this at the START of every
  // navigation ATTEMPT (before any fetch); their fetch `.then()`/`.catch()`
  // callbacks re-check it and DISCARD their response (no swap, no
  // `pushState`, no fallback hard-navigation) if a NEWER navigation has
  // since started. Without this, two quick clicks (or a fast back/forward)
  // could let an earlier, slower fetch resolve AFTER a later, faster one --
  // flashing the wrong view, or running an extra destroy()/init() cycle
  // before the page "settles" on the correct one.
  let navGeneration = 0;

  // Gate r1 (adversary 3): ONE AbortSignal per SHOWN view, aborted the moment the user leaves it.
  // A view's own AbortController is not that: home (and its folder filters) is CACHED on
  // nav-away and never aborted, so a destructive confirm opened from a home card stayed up over
  // the next view and its OK still deleted. `viewSignal()` is read when a surface opens (never
  // stored at init: a cached home would hold an already-aborted one after its restore), and
  // leaveShownView() aborts it at every exit: a navigate() or popstate that leaves the view
  // (at its start, before the fetch, so no OK lands mid-swap; this also covers the cached-home
  // restore, which follows it synchronously), and swapToView (a surface opened on the old view
  // WHILE the next one was fetching). An in-view pop (a drill collapsing) keeps it.
  let shownViewController = null;
  function viewSignal() {
    if (!shownViewController) shownViewController = new AbortController();
    return shownViewController.signal;
  }
  function leaveShownView() {
    const c = shownViewController;
    shownViewController = null;
    if (c) c.abort();
  }

  // `FileTube.registerView(name, { init, destroy })` -- called by each view
  // module (main.js/watch.js/setup.js, and lazily lib/ytdlp/client/
  // subscriptions.js) at its own top-level parse time, which happens before
  // `DOMContentLoaded` fires (a plain `<script>` tag runs synchronously
  // during HTML parsing) -- so every view is already registered by the time
  // `bootRouter()` (below) runs.
  function registerView(name, handlers) {
    if (!name || !handlers || typeof handlers.init !== 'function') return;
    viewRegistry[name] = handlers;
  }

  function getViewRoot() {
    return document.getElementById('view-root');
  }

  // Updates the CURRENT history entry's stored scrollY (via `replaceState`,
  // which never adds a new entry) right before we navigate away from it, so
  // a later `popstate` back to this entry restores where the user actually
  // scrolled to -- not wherever they happened to be when the entry was first
  // pushed.
  // v1.311.2: the router's scroll seams go through the shared body lock
  // (body-scroll-lock.js). While an overlay pins the body (faux fullscreen, the
  // expanded audio view, a full-screen skin), window.scrollY reads 0 and
  // window.scrollTo is clamped - so a page left under a lock would record 0, and
  // a page placed under one (an autoplay advance that carries fullscreen) would
  // lose its place. pageScrollY reads the pinned Y; placePageScroll defers to the
  // lock's release. No lock (or no module): plain window scroll, as before.
  function pageScrollY() {
    const BL = window.FileTubeBodyLock;
    return BL ? BL.scrollYOf(document, window) : window.scrollY;
  }
  function placePageScroll(y) {
    const BL = window.FileTubeBodyLock;
    if (BL) BL.scrollTo(document, window, y);
    else window.scrollTo(0, y);
  }
  function recordScrollForCurrentState() {
    if (!window.history.state) return;
    // v1.45.0 (T2): preserve `depth` when rewriting this entry for scroll —
    // it's a replace-in-place, so the entry keeps its own in-app depth.
    // v1.217: likewise carry the entry's `viewState` forward - a scroll rewrite
    // on a sub-state entry (a drill / now-playing level) must NOT wipe the
    // payload its onPopState hook will need.
    const updated = buildHistoryState(
      window.history.state.view, window.history.state.url, pageScrollY(), window.history.state.depth,
      window.history.state.viewState, window.history.state.browseDepth);
    window.history.replaceState(updated, '');
  }

  // v1.217 (in-view back-stack): the two verbs a view uses to give itself an
  // in-app back level. Both keep the CURRENT view + URL (no navigation, no URL
  // change - deep links are untouched); they only add or amend a history entry
  // carrying the view's own `viewState` payload, which the router hands back to
  // the view's `onPopState` on the way back.
  //
  //  - pushViewState: a real DESCENT (open a drill, expand now-playing). Records
  //    the current entry's scroll first (so back restores it), then PUSHES a new
  //    entry at depth+1. `history.back()` from here fires a popstate the router
  //    delegates to the view (see handlePopState) - it collapses one level in
  //    place, no re-fetch, no player reparent.
  //  - replaceViewState: a LATERAL move at the same level (switch a browse tab).
  //    Amends the current entry's payload in place; adds no back level.
  function pushViewState(viewState) {
    if (!currentViewName) return;
    recordScrollForCurrentState();
    const url = window.location.pathname + window.location.search;
    const depth = nextHistoryDepth(window.history.state, false);
    window.history.pushState(buildHistoryState(currentViewName, url, 0, depth, viewState, browseDepthBehind(window.history.state)), '', url);
  }
  function replaceViewState(viewState) {
    if (!currentViewName) return;
    const s = window.history.state;
    const url = (s && s.url) || (window.location.pathname + window.location.search);
    const depth = nextHistoryDepth(s, true); // replace keeps the level
    const scrollY = (s && typeof s.scrollY === 'number') ? s.scrollY : pageScrollY();
    window.history.replaceState(buildHistoryState(currentViewName, url, scrollY, depth, viewState, s && s.browseDepth), '');
  }

  // Extracts `#view-root` (+ `<title>`) from a fetched HTML document string.
  // Returns `null` on any parse failure or a document with no `#view-root`
  // (a malformed/unexpected response) -- the caller falls back to a real
  // navigation rather than ever swapping in nothing.
  function extractViewFragment(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const root = doc.getElementById('view-root');
      if (!root) return null;
      return { root, title: doc.title || '' };
    } catch (_) {
      return null;
    }
  }

  // Invoked with (fromView, toView) immediately before every DOM swap (an
  // in-app click, `popstate`, and NOT the initial progressive-enhancement
  // boot -- there is no "from" view then), so the persistent player
  // controller (player.js, T2) can dock the player as appropriate BEFORE the
  // outgoing view's `#view-root` is destroyed/replaced.
  //
  // Only ONE transition is decided here: leaving the watch view for any other
  // in-shell view docks the player (a no-op if nothing is loaded, per
  // `player.dock()`'s own guard -- so there is never a dock when nothing is
  // playing -- and a no-op when v1.362's minimize already docked it before
  // leaving). watch -> watch (a related-card/prev-next click into a
  // DIFFERENT video) intentionally does NOT dock here: the host simply stays
  // wherever it currently is (inside the old `#player-slot`, about to be
  // replaced) and the incoming watch view's own `init()` reparents it into
  // the NEW `#player-slot` via `player.load()` -- see watch.js. That reparent
  // (old-slot -> new-slot) happens synchronously inside the same `swapToView`
  // call as the `replaceWith` below (no browser idle time in between), which
  // is the least-risky sequencing available to this fetch-based router (see
  // player.js's "iOS reparent risk" comment for the full rationale + the
  // documented fixed-overlay fallback).
  //
  // Returning TO the watch view (DOCKED -> FULL, i.e. tapping the dock, or a
  // fresh watch entry) is likewise NOT decided here -- by the time this hook
  // runs, the new view's `#player-slot` doesn't exist yet (the fetched
  // fragment hasn't been swapped in). watch.js's `init(root)` handles it: it
  // always calls `player.load(id, data, { slot })`, which is a no-restart
  // "adopt" (just a reparent) whenever `id` already matches the persistent
  // controller's `currentId`.
  function applyPlayerTransition(fromView, toView) {
    if (!window.FileTube || !window.FileTube.player) return; // player.js not loaded (shouldn't happen -- every shell loads it)
    if (shouldDockOnTransition(fromView, toView)) {
      window.FileTube.player.dock();
    }
  }

  // Re-derives which shell nav item (bottom-nav + sidebar) should be marked
  // active for the CURRENT location. Previously this only ran once at
  // DOMContentLoaded (baked into that page's static "active" class); now that
  // in-app navigation can change the URL without a fresh document, it must be
  // re-run after every swap too.
  function updateActiveNavHighlight() {
    // v1.47.4 item 2: the zoom policy rides this call site because it is the one
    // place already guaranteed to run after EVERY view change (all three
    // `currentViewName = ...` assignments call it) and it is location-driven, so
    // it cannot disagree with the router. See applyZoomPolicy's doc comment.
    applyZoomPolicy();
    // v1.47.4 item 6: same rationale as the zoom policy -- this call site
    // already runs after every view change and is location-driven, so the
    // resume pointer cannot drift out of sync with the router.
    recordLastSession();
    applyNavHighlight(window.location.pathname, window.location.search);
  }

  // Lazily fetches `/js/subscriptions.js` exactly once per session (T1 scope
  // item 4). A disabled install never links to `/subscriptions` in the first
  // place (the nav link is only ever injected on a genuine 2xx from
  // `injectSubscriptionsNavLinkIfEnabled`'s probe above), so nothing ever
  // calls this on a disabled install; the script itself is served only by a
  // route registered inside the module's own `isEnabled` gate
  // (lib/ytdlp/index.js), so even a stray call here just rejects (handled by
  // `navigate`'s fallback-to-real-navigation below) rather than leaking
  // anything.
  // v1.37.0: generalized from the subscriptions-only loader into a
  // src-keyed one-per-session lazy loader -- books/read reuse the exact
  // load/retry semantics rather than forking them (the exec plan's T7
  // "generalize rather than fork twice" instruction). A failed load clears
  // its slot so a later navigation can retry instead of wedging forever.
  const viewScriptPromises = {};
  function ensureScriptLoaded(src, registryKey) {
    if (viewRegistry[registryKey]) return Promise.resolve();
    if (viewScriptPromises[src]) return viewScriptPromises[src];
    viewScriptPromises[src] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.addEventListener('load', () => resolve());
      script.addEventListener('error', () => {
        viewScriptPromises[src] = null; // allow a later retry instead of wedging forever
        reject(new Error(`failed to load ${src}`));
      });
      document.body.appendChild(script);
    });
    return viewScriptPromises[src];
  }

  // Per-view lazy-script map. Views absent here (home/watch/setup) ship in
  // the page shell and are always registered by boot time.
  const VIEW_SCRIPT_SRC = {
    tv: '/js/tv.js',
    subscriptions: '/js/subscriptions.js',
    books: '/js/books.js',
    read: '/js/read.js',
    music: '/js/music.js',
    podcasts: '/js/podcasts.js',
    history: '/js/history.js',
    cleanup: '/js/cleanup.js',
    // v1.151: lazy-load the Stats view script on first in-app navigation
    // (same posture as the other secondary views above). stats.js registers
    // { init, destroy } at parse time and has NO DOMContentLoaded self-boot,
    // so there is exactly one init path (bootRouter on a standalone load,
    // swapToView on an in-app entry); ensureScriptLoaded's registry/promise
    // cache dedups so a standalone-loaded stats.js is never re-executed here.
    stats: '/js/stats.js',
  };

  function ensureViewScriptLoaded(view) {
    const src = VIEW_SCRIPT_SRC[view];
    return src ? ensureScriptLoaded(src, view) : Promise.resolve();
  }

  // The one swap routine every navigation (an in-app click, `popstate`, and
  // the progressive-enhancement boot) funnels through -- exactly one code
  // path, matching the per-view `init`/`destroy` contract.
  function swapToView(view, root, title, scrollY, url) {
    leaveShownView();
    applyPlayerTransition(currentViewName, view);
    const oldRoot = getViewRoot();

    // FR-4 (T4): leaving home for a DIFFERENT kind of view retains the live
    // node -- and its already-bound listeners -- instead of destroying it,
    // so a later return to this EXACT URL can reattach it instantly (see
    // restoreHomeFromCache). Home -> home (a different filter/search/sort
    // URL) falls through to the `else` branch below instead: that's a
    // genuinely different render, not a "return", and must build clean --
    // exactly like a fresh/deep-link load, which never even reaches this
    // function with a cache to worry about, since homeViewCache resets on
    // every real page load.
    if (currentViewName === 'home' && view !== 'home' && oldRoot) {
      homeViewCache = { url: currentViewUrl, node: oldRoot, title: document.title, scrollY: pageScrollY() };
    } else {
      // A stale, never-reattached home-cache entry is about to be orphaned
      // by the fresh `home` init() a few lines down (this branch only runs
      // on a NON-cache-hit swap -- a cache hit goes through
      // restoreHomeFromCache and never calls swapToView at all). Destroy
      // its listeners NOW: main.js's home view keeps exactly one
      // AbortController alive per instance, reused via closure rather than
      // tracked per-node, so this is the only safe moment to tear down the
      // OLD (cached, about-to-be-discarded) instance's listeners without
      // touching the brand-new controller init() is about to create below.
      // Skipping this would leave TWO live listener sets bound to the
      // persistent shell's #sidebar-folders-list -- the stale cached
      // instance's, and the fresh one's -- silently double-firing every
      // sidebar-drag handler.
      if (view === 'home' && homeViewCache) {
        const staleHome = viewRegistry.home;
        if (staleHome && typeof staleHome.destroy === 'function') {
          try { staleHome.destroy(); } catch (err) { console.error('Stale home-cache destroy() failed', err); }
        }
        homeViewCache = null;
      }
      const outgoing = currentViewName && viewRegistry[currentViewName];
      if (outgoing && typeof outgoing.destroy === 'function') {
        try { outgoing.destroy(); } catch (err) { console.error('View destroy() failed for', currentViewName, err); }
      }
    }

    if (oldRoot && root && oldRoot !== root) {
      oldRoot.replaceWith(root);
    }
    root.id = 'view-root';
    if (title) document.title = title;
    currentViewName = view;
    currentViewUrl = typeof url === 'string' ? url : currentViewUrl;
    updateActiveNavHighlight();
    placePageScroll(typeof scrollY === 'number' ? scrollY : 0);
    const incoming = viewRegistry[view];
    if (incoming && typeof incoming.init === 'function') {
      try { incoming.init(root); } catch (err) { console.error('View init() failed for', view, err); }
    }
    // B1 fast-follow (v1.24.1): reconcile the "Re-pull this channel now"
    // button against the view/root just swapped in -- see that section's
    // own comment (above `probeAndReconcileRepullButton`) for why this is
    // hooked here instead of a MutationObserver.
    probeAndReconcileRepullButton();
    scheduleCritterScatter(); // v1.166: Sneaky critter mode re-scatters per navigation
  }

  // v1.30.0 T8 (B1, AC5.2b): the SAME fetch -> extract `#view-root` -> swap
  // sequence `navigate()`/`handlePopState()`'s own cache-MISS branch already
  // uses for a normal home load (see those functions below) -- reused here
  // so `restoreHomeFromCache`'s dirty-flag reconcile is a genuinely fresh
  // render, not a second, divergent implementation of "load home". Never
  // falls back to `window.location.reload`/`.assign` on failure (AC5.4): a
  // failed reconcile just logs and leaves whatever is currently on screen,
  // the same as leaving the (still-cleared) dirty flag for the next natural
  // reconcile opportunity would.
  function loadFreshHomeView(url, scrollY) {
    const gen = ++navGeneration;
    return ensureViewScriptLoaded('home')
      .then(() => fetch(url, { credentials: 'same-origin' }))
      .then((res) => {
        if (!res.ok) throw new Error('home dirty-reconcile: fetch failed with status ' + res.status);
        return res.text();
      })
      .then((html) => {
        if (isStaleNavGeneration(gen, navGeneration)) return; // a newer navigation has since started -- discard this stale response
        const fragment = extractViewFragment(html);
        if (!fragment) throw new Error('home dirty-reconcile: response had no #view-root');
        swapToView('home', fragment.root, fragment.title, scrollY, url);
      })
      .catch((err) => {
        if (isStaleNavGeneration(gen, navGeneration)) return;
        console.error('Home grid dirty-reconcile (fresh load) failed:', err);
      });
  }

  // FR-4 (T4): reattaches a cached home node with NO fetch and NO
  // destroy()/init() cycle for home itself -- the entire point of the
  // cache. `cached` is the popped `homeViewCache` entry (the caller already
  // confirmed `cached.url === url`); `url`/`scrollY` are passed explicitly
  // rather than re-read off the (already-nulled) module cache.
  function restoreHomeFromCache(cached, url, scrollY) {
    homeViewCache = null; // consumed -- live again; the NEXT leave-home re-caches it fresh

    // v1.30.0 T8 (B1, AC5.2b): a one-shot may have completed while the user
    // was OFF home with no live refresh target (`refreshLibraryInPlace()`
    // returned `false`) -- `pollOnce`/the visibility resume handler marked
    // the grid dirty via a persistent flag instead of silently dropping the
    // done-edge (see `markHomeGridDirty` above `refreshLibraryInPlace`).
    // Reattaching `cached.node` below is deliberately a NO-render operation
    // (the entire point of the cache, see the comment above) -- it would
    // show the grid exactly as the user left it, WITHOUT the newly-completed
    // item. When dirty, bypass the reattach entirely and route through
    // `loadFreshHomeView` instead, so the completed item actually appears.
    // This is a FRESH render (a brand-new node, a brand-new `init()`), never
    // a second `init()` on the SAME cached node -- the double-bind hazard
    // the "deliberately NOT calling init()" comment below exists to avoid
    // only applies to reusing the SAME node, which this path never does.
    if (isHomeGridDirty()) {
      clearHomeGridDirty();
      // `homeViewCache` is already nulled (above), so `swapToView`'s OWN
      // stale-cache-orphan branch (its `if (view === 'home' && homeViewCache)`
      // check, below) will never see this cache to destroy it -- do it here
      // instead, synchronously, BEFORE `loadFreshHomeView`'s eventual
      // `init()` overwrites this view module's shared closure state (e.g.
      // main.js's `controller`). Skipping this would leave the STALE
      // instance's listeners (AbortController never aborted) live
      // indefinitely alongside the fresh instance's -- the exact double-bind
      // hazard `swapToView`'s own comment (below) documents, just reached
      // from a different branch.
      const staleHome = viewRegistry.home;
      if (staleHome && typeof staleHome.destroy === 'function') {
        try { staleHome.destroy(); } catch (err) { console.error('Stale (dirty-flagged) home-cache destroy() failed', err); }
      }
      loadFreshHomeView(url, scrollY);
      return;
    }

    applyPlayerTransition(currentViewName, 'home');
    if (currentViewName !== 'home') {
      const outgoing = currentViewName && viewRegistry[currentViewName];
      if (outgoing && typeof outgoing.destroy === 'function') {
        try { outgoing.destroy(); } catch (err) { console.error('View destroy() failed for', currentViewName, err); }
      }
    }
    const oldRoot = getViewRoot();
    if (oldRoot && oldRoot !== cached.node) {
      oldRoot.replaceWith(cached.node);
    }
    cached.node.id = 'view-root';
    if (cached.title) document.title = cached.title;
    currentViewName = 'home';
    currentViewUrl = url;
    updateActiveNavHighlight();

    // C3 remediation (v1.16.0): #sidebar-folders-list lives OUTSIDE
    // #view-root, in the persistent shell -- so it is NOT part of
    // `cached.node` and was left exactly as whichever OTHER view (e.g.
    // watch.js) rendered it last (a plain, non-draggable link list) after
    // home was cached. Ask the still-live cached home instance to re-render
    // it back to its draggable + active-highlighted state -- a thin,
    // single-purpose hook (`restoreSidebar`), NOT a full `init(cached.node)`
    // re-run (see the comment on that below for why re-running init() would
    // double-bind everything else).
    if (viewRegistry.home && typeof viewRegistry.home.restoreSidebar === 'function') {
      try { viewRegistry.home.restoreSidebar(); } catch (err) { console.error('Home restoreSidebar() failed', err); }
    }

    // Restore scroll AFTER the cached node is back in the live document --
    // its images/thumbnails already finished loading/decoding before it was
    // detached, and nothing here re-renders the grid, so its layout heights
    // are exactly what they were when the user left: there is no
    // image-height race to wait out (the race the design flags only arises
    // when a FRESH re-render's lazy images haven't resolved their intrinsic
    // size yet at the moment scroll is restored).
    placePageScroll(typeof scrollY === 'number' ? scrollY : cached.scrollY);
    // Deliberately NOT calling viewRegistry.home.init(cached.node): its
    // listeners (bound once, in the ORIGINAL init() call that produced this
    // node) are still fully live and intact -- never torn down while cached
    // (see swapToView's home-cache branch above) -- so re-running init()
    // here would register a SECOND AbortController/listener set on the SAME
    // node, double-firing every handler (search is now shell-owned and
    // unaffected either way -- see the C1 remediation comment on
    // common.js's DOMContentLoaded handler). Reattaching the live node
    // exactly as it was left, plus the targeted sidebar restore above, IS
    // the restore.

    // B1 fast-follow (v1.24.1): reconcile the "Re-pull this channel now"
    // button too -- a cache-hit reattach is still a navigation into a
    // (possibly different) `?root=` folder, even though it skips home's own
    // init(). See `probeAndReconcileRepullButton`'s comment above.
    probeAndReconcileRepullButton();
    scheduleCritterScatter(); // v1.166: Sneaky critter mode re-scatters per navigation
  }

  // `navigate(url, { replace })`: fetch -> parse -> extract `#view-root` ->
  // `pushState`/`replaceState` -> swap. Falls back to a REAL navigation
  // (`window.location.assign`) on ANY failure (network error, non-2xx,
  // missing `#view-root`, an unknown route, or the lazy subscriptions script
  // failing to load) so in-app navigation never dead-ends. Programmatic
  // callers (search submit, a future FR-2 prev/next, dock-expand) call this
  // directly instead of assigning `window.location`.
  //
  // History MUST be updated (`pushState`/`replaceState`) BEFORE the swap runs
  // (i.e. before `swapToView`/`restoreHomeFromCache`, both of which
  // synchronously run the incoming view's `init()`): `window.location` is the
  // router's single source of truth for "which URL are we on", and several
  // views read it SYNCHRONOUSLY during `init()` (e.g. watch.js reads `?v=`
  // off `window.location.search` to know which media to load). `pushState`
  // is the only thing that advances `window.location` -- swapping first would
  // leave `init()` reading the OUTGOING page's stale URL (this was a
  // release-blocking bug: every in-app click into a video read the previous
  // page's `?v=`, so it silently no-op'd or loaded the wrong media). This
  // mirrors `handlePopState` below, where the browser has ALREADY updated
  // `window.location` before `popstate` fires -- by pushing/replacing first
  // here too, both paths reach `swapToView`/`restoreHomeFromCache` (and, via
  // those, `updateActiveNavHighlight`) with an already-correct URL.
  function navigate(url, options) {
    const opts = options || {};
    let parsed;
    try {
      parsed = new URL(url, window.location.href);
    } catch (_) {
      window.location.assign(url);
      return Promise.resolve();
    }
    const view = deriveRouteView(parsed.pathname);
    if (!view) {
      window.location.assign(url);
      return Promise.resolve();
    }
    // tech-debt #46: no-op a same-URL in-app navigation (the active nav item, or
    // the docked-player return while already here). Skips the #view-root
    // teardown/rebuild that strands a FULL-mounted player and re-fetches for
    // nothing. popstate keeps its own path (back/forward to the same URL still
    // reattaches). `opts.reload` is an escape hatch (unused today).
    if (!opts.reload
      && isSameLocationNav(window.location.pathname + window.location.search, parsed.pathname + parsed.search)) {
      return Promise.resolve();
    }
    // v1.247 (F2): a navigation INTO the skin player from ANOTHER tab (a card / search result /
    // deep-link that targets /music?play= or /podcasts?play=) records where we came FROM, so the
    // skin's MENU/back docks the mini-player on that origin tab. currentViewUrl is still the FROM
    // here (swapToView sets it after the swap). Any OTHER navigation clears the origin, so a
    // later in-view play (or the next launch) starts clean and MENU docks in place. (This runs
    // AFTER the same-URL no-op above, so a genuine same-tab re-nav never spuriously clears it.)
    playerLaunchOrigin = nextPlayerLaunchOrigin(parsed.pathname, parsed.search, currentViewUrl, window.location.pathname + window.location.search);
    // v1.334: a tap that opens the player (a card, a search result, the mini player) is the gesture iOS
    // needs to ask for motion access - SYNCHRONOUSLY here, before the view fetch spends the gesture
    // (pocket-lighting.js askForOpen decides whether that player is a Click skin that would light).
    if (isPlayerOpenUrl(parsed.pathname, parsed.search)) {
      try { if (window.FileTubePocketLighting && typeof window.FileTubePocketLighting.askForOpen === 'function') window.FileTubePocketLighting.askForOpen(window); } catch (_) { /* lighting is optional */ }
    }
    recordScrollForCurrentState();

    // W2 remediation: this navigation attempt's own generation -- bumped
    // BEFORE the (possible) fetch below, so any PRIOR still-in-flight
    // navigate()/popstate fetch immediately becomes stale.
    const gen = ++navGeneration;
    leaveShownView(); // the user is leaving: close what the view had open (viewSignal)

    // v1.45.0 gate-fix (C1): a PUSH to the home ROOT ('/' with no query) is the
    // TOP of the walk — always depth 0, never current+1. Every go-home path
    // funnels through here (goHomeControl's depth-0 branch AND the programmatic
    // navigate('/') in watch.js/setup.js after an action); without this reset
    // they would stamp home at depth+1, leaving the next Home tap to resolve to
    // 'back'. A filtered/folder home ('/?root=', '/?search=') keeps incrementing
    // — it's a genuine level. A replace keeps the current entry's depth (it adds
    // no level). NB: this alone would fix C1; resolveHomeButtonAction's
    // atHome-first check is the belt-and-suspenders second layer.
    const desiredDepth = (!opts.replace && isHomeRootTarget(parsed.pathname, parsed.search))
      ? 0
      : nextHistoryDepth(window.history.state, opts.replace);

    // FR-4 (T4): a cache hit skips the fetch entirely -- only a
    // byte-identical home URL counts as "returning" (see the homeViewCache
    // module comment above); a different home filter/search/sort URL falls
    // through to the normal fetch+destroy+init path below and always builds
    // clean.
    const targetUrl = parsed.pathname + parsed.search;
    if (view === 'home' && homeViewCache && homeViewCache.url === targetUrl) {
      const cached = homeViewCache;
      // v1.45.2 (#1a): `opts.top` forces the top of home (scrollY 0) even on a
      // cache hit — the header-logo "jump home" wants a fresh top-of-home, not
      // the scroll position the cached node was left at.
      const restoreScroll = opts.top ? 0 : cached.scrollY;
      // Update the URL BEFORE reattaching the cached node (see the ordering
      // comment above `navigate` — restoreHomeFromCache's `updateActiveNavHighlight`
      // call must observe the target URL, not the outgoing one).
      const state = buildHistoryState('home', parsed.href, restoreScroll, desiredDepth);
      if (opts.replace) window.history.replaceState(state, '', parsed.href);
      else window.history.pushState(state, '', parsed.href);
      restoreHomeFromCache(cached, targetUrl, restoreScroll);
      return Promise.resolve();
    }

    return ensureViewScriptLoaded(view)
      .then(() => fetch(parsed.href, { credentials: 'same-origin' }))
      .then((res) => {
        if (!res.ok) throw new Error('navigate: fetch failed with status ' + res.status);
        return res.text();
      })
      .then((html) => {
        if (isStaleNavGeneration(gen, navGeneration)) return; // a newer navigation has since started -- discard this stale response
        const fragment = extractViewFragment(html);
        if (!fragment) throw new Error('navigate: response had no #view-root');
        // Update the URL BEFORE swapping (see the ordering comment above
        // `navigate`) -- the winning (non-stale) navigation pushes/replaces
        // exactly once, then swaps exactly once, so `window.location` is
        // already correct when the incoming view's `init()` reads it.
        // v1.362 (M7): a watch entry remembers the browse level it was opened from.
        const state = buildHistoryState(view, parsed.href, 0, desiredDepth, null, browseDepthBehind(window.history.state));
        if (opts.replace) window.history.replaceState(state, '', parsed.href);
        else window.history.pushState(state, '', parsed.href);
        swapToView(view, fragment.root, fragment.title, 0, targetUrl);
      })
      .catch((err) => {
        if (isStaleNavGeneration(gen, navGeneration)) return; // stale -- a newer navigation is already handling itself
        console.error('SPA navigation failed; falling back to a full page load:', err);
        window.location.assign(url);
      });
  }

  // v1.45.0 (T2): the Home control's incremental-pop coalescing guard. Set when
  // goHomeControl issues a history.back(); cleared ONLY by the resulting popstate
  // (handlePopState). A second Home tap while pending is ignored, so a fast
  // double-tap can never fire back() twice off the SAME (not-yet-updated)
  // window.history.state and pop two levels / past the app.
  // gate-fix (W1): the guard is EVENT-bounded, never time-bounded. An earlier
  // wall-clock deadline could lift mid-jank (a heavy grid re-render/scroll-
  // restore on a low-end phone blocking the main thread >2s) and let a second
  // back() through — exiting to the referrer. It cannot wedge instead: goHome-
  // Control only issues back() when depth>0, and depth rises only on this
  // router's own pushes (floored at the boot seed), so there is always a real
  // in-app entry behind us — history.back() therefore always traverses and
  // always fires the popstate that clears this flag.
  let homeBackPending = false;

  // v1.45.0 (T2): the Home affordance (header logo / sidebar Home / bottom-nav
  // Home) walks UP one in-app level per tap, restoring where the user was —
  // NOT a jump to a fresh top-of-feed. history.back() is the mechanism: it
  // reuses the router's existing popstate path, which already restores the
  // recorded scrollY (recordScrollForCurrentState) and re-swaps the prior view
  // (handlePopState / restoreHomeFromCache). Only when there is no in-app level
  // behind us (a deep-link entry, depth 0, that isn't already home) do we push
  // a fresh '/' so Home is always reachable.
  function goHomeControl() {
    if (homeBackPending) return; // a prior Home-back is still settling — coalesce until its popstate clears the guard
    const state = window.history.state;
    const depth = (state && typeof state.depth === 'number') ? state.depth : 0;
    const action = resolveHomeButtonAction(depth, window.location.pathname + window.location.search);
    if (action === 'back') {
      homeBackPending = true;
      window.history.back();
    } else if (action === 'go-home') {
      navigate('/');
    } else {
      // v1.86.2 (Dean): 'noop' = already at the session-root home. Instead of
      // doing nothing, RISE TO THE TOP - a Home tap while already on the feed
      // should scroll up (the mobile modern grid is ~1 card/screen tall, so
      // scrolling back manually is tedious). Matches the header logo's
      // goHomeToTop() behaviour; the pure resolveHomeButtonAction still returns
      // 'noop' (its contract/tests are unchanged - the scroll is a DOM-layer
      // effect here).
      window.scrollTo(0, 0);
    }
  }

  // Back only when there IS in-app history to pop (depth>0) - never exit the app
  // to an external referrer, never surprise-navigate from a directly-loaded page.
  function swipeBackIfPossible() {
    if (homeBackPending) return;
    const state = window.history.state;
    const depth = (state && typeof state.depth === 'number') ? state.depth : 0;
    if (depth > 0) { homeBackPending = true; window.history.back(); }
  }
  let swipeBackWired = false;
  function wireSwipeBack() {
    if (typeof document === 'undefined' || swipeBackWired) return;
    swipeBackWired = true;
    wireSwipeBackGesture(document, window, swipeBackIfPossible);
  }

  // v1.45.2 (#1a): the header LOGO is the "escape hatch" straight to the top of
  // home — the classic logo->home convention — distinct from the incremental
  // walk-back that the bottom-nav / sidebar Home affordances do (goHomeControl).
  // Already at the home root: just scroll to the top (a fresh navigate('/')
  // there would be a same-URL no-op and NOT scroll). Elsewhere: navigate to a
  // fresh top-of-home ({ top: true } so even a cache hit lands at scrollY 0).
  function goHomeToTop() {
    // gate SUGGESTION (v1.45.2): if a bottom-nav/sidebar Home walk-back is still
    // settling (its history.back() queued, popstate not yet fired), don't race
    // it — a fresh navigate('/') here would be popped off by that pending back().
    // Can't exit the app either way, but coalescing keeps the two affordances
    // from fighting. Cleared by the same popstate that clears goHomeControl.
    if (homeBackPending) return;
    if (isHomeRootTarget(window.location.pathname, window.location.search)) {
      window.scrollTo(0, 0);
      return;
    }
    navigate('/', { top: true });
  }

  // v1.362 (M7): minimizing the player (player.js minimizeToDock, after its dock())
  // lands on the last browse level: history.go back past every watch entry to the
  // nearest browse entry (the router restores that view and its scroll), or a fresh
  // Home from a deep link. Coalesced with the Home control (homeBackPending).
  function leaveWatchForBrowse() {
    if (homeBackPending) return;
    const state = window.history.state;
    // v1.362.1 (D5): how far back history.go can really reach, where the Navigation API exists.
    const nav = window.navigation;
    const reachableBack = (nav && nav.currentEntry && Number.isInteger(nav.currentEntry.index)) ? nav.currentEntry.index : undefined;
    const land = resolveMinimizeLanding(state && state.depth, browseDepthBehind(state), window.history.length, reachableBack);
    if (land.action === 'back') {
      homeBackPending = true;
      window.history.go(-land.steps);
    } else {
      navigate('/');
    }
  }

  function handleDocumentClick(event) {
    const anchor = event.target && typeof event.target.closest === 'function' ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    let target;
    try {
      target = new URL(anchor.getAttribute('href'), window.location.href);
    } catch (_) {
      return;
    }
    const sameOrigin = target.origin === window.location.origin;
    const view = sameOrigin ? deriveRouteView(target.pathname) : null;
    const shouldIntercept = shouldInterceptLinkClick({
      button: event.button,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      targetAttr: anchor.getAttribute('target'),
      sameOrigin,
      view,
    });
    if (!shouldIntercept) return;
    event.preventDefault();
    // v1.45.0 (T2): a click on a Home affordance (the home ROOT `/` — NOT a
    // `/?root=<folder>` drill, which is an ordinary forward nav) routes through
    // the incremental-pop Home control instead of a fresh navigate().
    // v1.45.2 (#1a): the header logo is the exception — it jumps straight to the
    // TOP of home (goHomeToTop) rather than walking back one level.
    if (isHomeRootTarget(target.pathname, target.search)) {
      if (anchor.classList.contains('logo')) goHomeToTop();
      else goHomeControl();
      return;
    }
    navigate(target.href);
  }

  // Re-derives the view from `location` (the browser has ALREADY updated it
  // by the time `popstate` fires) and runs the same swap, without touching
  // history itself (the entry already exists) -- restores the scrollY that
  // was recorded for it when the user originally navigated away.
  function handlePopState(event) {
    // v1.45.0 (T2): a popstate means the browser moved to another entry — clear
    // the Home-control coalescing guard so the next Home tap reads the now-current
    // depth and can pop again (this fires for BOTH a goHomeControl history.back()
    // and a plain browser back/forward, which is correct — either way we've moved).
    homeBackPending = false;
    const state = parseHistoryState(event.state, window.location);
    if (!state.view) return; // an unknown route — the browser has already navigated there natively

    // v1.217 (in-view back-stack): if this pop stays WITHIN the currently-mounted
    // view and that view opted into same-view pops, let it resolve the pop IN
    // PLACE (collapse a drill / now-playing) - no generation bump, no fetch, no
    // swapToView, no player reparent. `onPopState` returns truthy when it handled
    // the pop; a falsy return (e.g. it's already at its root, so this pop leaves
    // the view) FALLS THROUGH to the normal fetch+swap below, exactly as before.
    // A cross-view pop has a different `state.view` and never reaches this branch.
    const delegate = popStateDelegate(state, currentViewName, viewRegistry[currentViewName]);
    if (delegate) {
      let handled = false;
      try { handled = delegate(state); }
      catch (err) { console.error('View onPopState() failed for', currentViewName, err); }
      if (handled) return;
    }

    // FR-4 (T4): back/forward INTO the exact cached home URL reattaches the
    // node directly, restoring its scroll -- no fetch, no re-render, no
    // image-height race. Only a byte-identical match counts (see the
    // homeViewCache module comment above); `toPathAndQuery` normalizes
    // `state.url` since a history entry's stored url may be absolute
    // (navigate()'s pushState) or relative (bootRouter's initial
    // replaceState / parseHistoryState's own fallback).
    const targetUrl = toPathAndQuery(state.url, window.location.href);

    // W2 remediation: this popstate's own generation, bumped BEFORE the
    // (possible) fetch below -- same guard `navigate()` uses (see the
    // `navGeneration` module comment above). A rapid back/back or
    // click-then-back sequence can otherwise let an earlier fetch resolve
    // after a later one and swap in the wrong view.
    const gen = ++navGeneration;
    leaveShownView(); // the user is leaving: close what the view had open (viewSignal)

    if (state.view === 'home' && homeViewCache && homeViewCache.url === targetUrl) {
      const cached = homeViewCache;
      restoreHomeFromCache(cached, targetUrl, state.scrollY);
      return;
    }

    ensureViewScriptLoaded(state.view)
      .then(() => fetch(state.url, { credentials: 'same-origin' }))
      .then((res) => {
        if (!res.ok) throw new Error('popstate: fetch failed with status ' + res.status);
        return res.text();
      })
      .then((html) => {
        if (isStaleNavGeneration(gen, navGeneration)) return; // a newer navigation has since started -- discard this stale response
        const fragment = extractViewFragment(html);
        if (!fragment) throw new Error('popstate: response had no #view-root');
        swapToView(state.view, fragment.root, fragment.title, state.scrollY, targetUrl);
      })
      .catch((err) => {
        if (isStaleNavGeneration(gen, navGeneration)) return; // stale -- a newer navigation is already handling itself
        // Never leave back/forward stranded on a half-swapped page — a real
        // reload always lands on the correct, complete document (progressive
        // enhancement's own fallback guarantee).
        console.error('Back/forward SPA swap failed; reloading the page instead:', err);
        window.location.reload();
      });
  }

  document.addEventListener('click', handleDocumentClick);
  window.addEventListener('popstate', handlePopState);

  // Progressive-enhancement boot, called once from the existing
  // `DOMContentLoaded` handler below: on a fresh full page load the document
  // already IS the correct, complete view (server-rendered) -- this just
  // registers it as "current" and runs its `init()`, the IDENTICAL path a
  // swap runs (one code path per view, no divergence). Also seeds
  // `history.state` if this is the first entry, so the very first `popstate`
  // back to it has a scrollY to restore.
  function bootRouter() {
    const view = deriveRouteView(window.location.pathname);
    const root = getViewRoot();
    if (!view || !root) return; // not a known route, or this page has no shell yet
    // v1.160 (Dean): take MANUAL scroll control. Default 'auto' makes the browser
    // restore a remembered scroll position on a pushState in-app nav, which fires
    // AFTER swapToView's synchronous window.scrollTo(0,0) and overrides it - so a
    // tap into Stats/Settings/Subscriptions landed scrolled up under the fixed
    // header. The app already resets on forward nav (swapToView) and restores the
    // recorded scrollY on back (handlePopState), so it owns scroll fully now.
    try { if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'; } catch (_) { /* unsupported */ }
    wireSwipeBack(); // v1.160/.3: swipe-right-from-anywhere back gesture (once per session)
    if (!window.history.state) {
      // v1.45.0 (T2): the session's first stamped entry is depth 0 — the floor
      // the Home control's history.back() can never cross (see buildHistoryState).
      // An existing state (a reload, or a back INTO the app) keeps its own depth.
      window.history.replaceState(buildHistoryState(view, window.location.pathname + window.location.search, 0, 0), '');
    }
    currentViewName = view;
    currentViewUrl = window.location.pathname + window.location.search; // FR-4 (T4): keep in lockstep with currentViewName
    updateActiveNavHighlight();
    const handlers = viewRegistry[view];
    if (handlers && typeof handlers.init === 'function') {
      try { handlers.init(root); } catch (err) { console.error('View init() failed for', view, err); }
    }
    // B1 fast-follow (v1.24.1): reconcile the "Re-pull this channel now"
    // button on the very first, progressive-enhancement load too -- this is
    // the ONLY hook that ever runs for a session that enters directly on
    // watch.html/setup.html/subscriptions.html (no swap ever happens for
    // those), and it fires again harmlessly if a page IS the home view.
    probeAndReconcileRepullButton();
    scheduleCritterScatter(); // v1.166: Sneaky critter mode re-scatters per navigation
  }

  window.FileTube = window.FileTube || {};
  window.FileTube.registerView = registerView;
  window.FileTube.navigate = navigate;
  window.FileTube.viewSignal = viewSignal; // gate r1: aborts when the user leaves the shown view
  window.FileTube.pushViewState = pushViewState; // v1.217 in-view back-stack
  window.FileTube.replaceViewState = replaceViewState;
  // v1.247 (F2): the skin's MENU/collapse asks to dock back on the launch-origin tab. The getter
  // is exposed for tests + any surface that wants to read where the player was launched from.
  window.FileTube.playerLaunchOrigin = getPlayerLaunchOrigin;
  window.FileTube.clearPlayerLaunchOrigin = clearPlayerLaunchOrigin;
  window.FileTube.returnToPlayerOrigin = returnToPlayerOrigin;
  window.FileTube.goHomeFromPlayer = goHomeFromPlayer; // v1.332 D7
  window.FileTube.leaveWatchForBrowse = leaveWatchForBrowse; // v1.362 M7: the minimize landing
  window.FileTube.queueEntryHref = queueEntryHref;
  window.FileTube.bootRouter = bootRouter;
  // v1.52 instant watch: click surfaces stash, watch's init consumes.
  window.FileTube.stashWatchSeed = stashWatchSeed;
  window.FileTube.consumeWatchSeed = consumeWatchSeed;
  // v1.44 T12: the Settings bottom-bar editor drives these.
  // v1.78 device handoff: player.js reads these on every progress ping, and
  // the card reads the id to exclude itself. common.js loads before player.js
  // on every page that mounts a player, so the binding is always in place.
  window.FileTube.getDeviceId = getDeviceId;
  window.FileTube.getDeviceLabel = getDeviceLabel;
  window.FileTube.getAutoDeviceLabel = getAutoDeviceLabel;
  window.FileTube.getDeviceName = getDeviceName;
  window.FileTube.setDeviceName = setDeviceName;
  // v1.186.1 (Dean, device): an in-view layout change (theatre toggle) must
  // re-place the critters against the new furniture; exposed so watch.js can
  // trigger the same wait-then-place scatter the router hooks use.
  window.FileTube.scheduleCritterScatter = scheduleCritterScatter;
  window.FileTube.applyBottomNavCustomization = applyBottomNavCustomization;
  window.FileTube.readBottomNavConfig = readBottomNavConfig;
  window.FileTube.writeBottomNavConfig = writeBottomNavConfig;
  window.FileTube.BOTTOM_NAV_OPTIONAL = BOTTOM_NAV_OPTIONAL;
  window.FileTube.BOTTOM_NAV_DEFAULT_HIDDEN = BOTTOM_NAV_DEFAULT_HIDDEN;
  // v1.75: the editor renders the RESOLVED sequence (never the raw roster), so
  // its row order and the bar's order cannot drift; and it reads
  // `flooredToDefault` to refuse the un-check that would empty the bar.
  window.FileTube.resolveBottomNavLayout = resolveBottomNavLayout;
  // v1.72: the podcasts place's pin toggle refreshes the merged pin
  // surfaces (sidebar + sheet) after a pin/unpin round trip.
  window.FileTube.refreshAllPinSurfaces = refreshAllPinSurfaces;
  // v1.66 web push: setup.js's enable flow routes through the ONE locked
  // register call site + shares the key decoder.
  window.FileTube.registerPushWorker = registerPushWorker;
  window.FileTube.pushB64urlToUint8 = pushB64urlToUint8;
  window.FileTube.describePushEnableOutcome = describePushEnableOutcome;
  // v1.76: the shared drag-to-reorder gesture layer. It is also a plain
  // browser global (script order: common -> main -> setup), but setup.js
  // resolves it through this namespace when the bare global is absent, which
  // is exactly the case in a jsdom test that requires setup.js as a module.
  window.FileTube.wireReorderable = wireReorderable;
  // v1.102 (tranche 4 shimmer): the art-decode reveal helper, called by every
  // view file after it renders a batch of card images.
  window.FileTube.shimmerArt = shimmerArt;
  // v1.339 (L1): the batched in-viewport reveal (music first; a general helper for any view).
  window.FileTube.revealArtTogether = revealArtTogether;
}

// Renders the Playlists sheet's folder list — functionally equivalent to the
// existing #sidebar-folders-list (same /?root=<path> links, same folderSettings
// display-name lookup, same hidden-flag parity: the `hidden` ("Hide from
// home") flag only affects the home grid via the API, not this list, matching
// the sidebar today). `hiddenFromSidebar` (v1.14.0 item 3) DOES affect this
// list -- it's the mobile equivalent of the left sidebar, so a folder hidden
// from one is hidden from both (via visibleSidebarFolders()).
// v1.44 IA: the mobile Playlists sheet also surfaces the Music + Books library
// sections (mirrors the sidebar's Library section). Gated on the same injected
// sidebar entries so the sheet and sidebar can never disagree -- if Music/Books
// is enabled (its sidebar entry was injected), the sheet shows it too.
function libraryEntriesHtml() {
  let html = '';
  if (typeof document !== 'undefined') {
    // v1.73.1 (slim-gate W1): Downloads mirrors its sidebar marker FIRST,
    // like every other Library entry - and the href is read OFF the
    // injected entry (the runtime-derived /?root= link), never re-derived.
    // Without this mirror, filtering the sheet's folder rows would have
    // removed mobile access to Downloads entirely (the bottom item is
    // opt-in) - both halves land together.
    // v1.77: the GLYPH is mirrored off the injected sidebar entry too, exactly
    // as Downloads' href already is - reading it from the DOM rather than
    // re-resolving it means the sheet cannot disagree with the sidebar ONCE
    // BOTH HAVE PAINTED, which is the same reason the href is mirrored.
    //
    // Not "never, even for a moment" - that overclaim was measured false at the
    // adversarial gate (S3). A sheet opened BEFORE /api/auth/me resolves shows
    // the shipped glyph while the sidebar later becomes the chosen one: sheet
    // rows carry no data-nav* attribute, so applyLibraryGlyphs' selector does
    // not reach them. Cosmetic and self-healing on the next open, since the
    // sheet re-renders from the (by then repainted) sidebar.
    const mirroredGlyph = (navKey, fallback) => {
      const entry = document.querySelector('[data-nav-sidebar="' + navKey + '"]');
      const icon = entry && entry.querySelector('i');
      const cls = icon && icon.className;
      // Only a resolver-shaped class is trusted back into markup.
      return /^icon-[a-z0-9-]+$/.test(cls || '') ? cls : fallback;
    };
    const downloadsEntry = document.querySelector('[data-nav-sidebar="downloads"]');
    if (downloadsEntry) {
      html += '<a href="' + escapeAttr(downloadsEntry.getAttribute('href') || '/') + '" class="sidebar-item"><i class="' + mirroredGlyph('downloads', 'icon-downloads') + '"></i> Downloads</a>';
    }
    if (document.querySelector('[data-nav-sidebar="music"]')) {
      html += '<a href="/music" class="sidebar-item"><i class="' + mirroredGlyph('music', 'icon-play') + '"></i> Music</a>';
    }
    if (document.querySelector('[data-nav-sidebar="books"]')) {
      html += '<a href="/books" class="sidebar-item"><i class="' + mirroredGlyph('books', 'icon-books') + '"></i> Books</a>';
    }
    // v1.195.1: Shows mirrors its content-gated sidebar marker the same way, so
    // the mobile Playlists sheet lists it (it was reachable only from the desktop
    // sidebar before - a real mobile gap). Slots after Books, before Podcasts.
    if (document.querySelector('[data-nav-sidebar="tv"]')) {
      html += '<a href="/tv" class="sidebar-item"><i class="' + mirroredGlyph('tv', 'icon-tv') + '"></i> Shows</a>';
    }
    // v1.69: Podcasts mirrors its capability marker the same way.
    if (document.querySelector('[data-nav-sidebar="podcasts"]')) {
      html += '<a href="/podcasts" class="sidebar-item"><i class="' + mirroredGlyph('podcasts', 'icon-podcast') + '"></i> Podcasts</a>';
    }
    // v1.64: mirrors the count-gated sidebar marker, same as books/music
    // mirror their capability markers -- the sheet and the sidebars can
    // never disagree about whether History exists.
    if (document.querySelector('[data-nav-sidebar="history"]')) {
      html += '<a href="/history" class="sidebar-item"><i class="' + mirroredGlyph('history', 'icon-history') + '"></i> History</a>';
    }
  }
  return html;
}

function renderPlaylistsSheet(folders, folderSettings, syntheticFolders) {
  const list = document.getElementById('playlists-sheet-list');
  if (!list) return;
  const settings = folderSettings || {};
  const visible = visibleSidebarFolders(folders, settings, syntheticFolders); // v1.73.1: sheet/sidebar parity (slim-gate W1)
  const libEntries = libraryEntriesHtml();
  // v1.32 (Dean): the built-in Liked playlist entry -- fixed, first, static
  // markup. v1.33.1: no longer inlined here -- applied through the SAME
  // count-gated applyLikedSidebarEntry helper every sidebar surface now
  // uses (visible iff at least one liked video exists), so the sheet and
  // the sidebars can never disagree.
  // Sweep S1 (F50): the sheet's rows are ui-rows in ONE ui-list (a 56px row, the glyph in
  // the media column, a reserved action column so every title starts at the same x - G1).
  // The entries themselves still come from the SAME generators the sidebar mirrors
  // (libraryEntriesHtml's sidebar-item markup), converted in place by toSheetRow, so the
  // sheet and the sidebar can never disagree about WHAT is listed.
  const folderRows = visible.map((f) => {
    const base = f.split(/[\\/]/).pop() || f;
    const label = (settings[f] && settings[f].name) || base;
    const glyphClass = resolveFolderGlyphClass(settings[f] && settings[f].glyph); // v1.77
    return '<a href="/?root=' + encodeURIComponent(f) +
      '" class="sidebar-item"><i class="' + glyphClass + '"></i> ' +
      escapeAttr(label) + '</a>';
  }).join('');
  list.innerHTML = '<div class="' + PLAYLISTS_SHEET_LIST_CLASS + '" role="list" aria-label="Library">' + libEntries + folderRows + '</div>'
    + (visible.length === 0 ? '<p class="playlists-sheet-note">No folders configured.</p>' : '');
  const group = list.firstChild;
  Array.prototype.slice.call(group.children).forEach(toSheetRow);
  applyLikedSidebarEntry(group, { decorate: toSheetRow }); // v1.33.1: count-gated Liked entry, prepended
}

// The sheet's list classes (ui.css ui-list): 56px rows, a 36px media column, one reserved
// 44px action column (a pinned row's unpin; an empty slot elsewhere), no dividers.
const PLAYLISTS_SHEET_LIST_CLASS = 'ui-list ui-list--default ui-list--media-avatar ui-list--aside-none ui-list--actions-1 ui-list--divider-none playlists-sheet-group';

// Sweep S1 (F50): turn one generator row (`<a class="sidebar-item"><i class="icon-x"></i>
// Label</a>`) into a whole-row ui-row link IN PLACE: the glyph moves to the media slot, the
// label to the title, and the action column is reserved with an empty slot. Idempotent (a
// converted row is returned as is); the count-gated Liked row keeps its `sidebar-item-liked`
// hook, which applyLikedSidebarEntry's dedupe reads.
function toSheetRow(a) {
  if (!a || !a.classList || a.classList.contains('ui-row') || a.tagName !== 'A') return a;
  const d = a.ownerDocument;
  const glyph = a.querySelector('i, svg');
  const label = (a.textContent || '').trim();
  const liked = a.classList.contains('sidebar-item-liked');
  const active = a.classList.contains('active');
  a.className = 'ui-row ui-row--default playlists-sheet-item' + (liked ? ' sidebar-item-liked' : '') + (active ? ' active' : '');
  a.setAttribute('role', 'listitem');
  a.textContent = '';
  const span = (cls) => { const n = d.createElement('span'); n.className = cls; return n; };
  a.appendChild(span('ui-row__lead'));
  const media = span('ui-row__media');
  if (glyph) media.appendChild(glyph);
  a.appendChild(media);
  const body = span('ui-row__body');
  const title = span('ui-row__title');
  title.textContent = label;
  body.appendChild(title);
  a.appendChild(body);
  a.appendChild(span('ui-row__aside'));
  const acts = span('ui-row__actions');
  const slot = span('ui-row__slot');
  slot.setAttribute('aria-hidden', 'true');
  acts.appendChild(slot);
  a.appendChild(acts);
  return a;
}

// v1.21.0 FR-5: pure filter/derive step for the pinned-playlist Playlists-
// sheet subsection (see renderPinnedPlaylists below) -- drops any entry
// missing a usable channelDir (defensive; the server should never send one,
// but this keeps rendering fail-safe against a malformed/future response
// shape) and derives each entry's display label: the persisted snapshot
// `label` when present, else the channelDir's own basename, else a generic
// fallback -- never blank. Pure and side-effect-free, so it is directly
// unit-testable without a DOM (unlike renderPinnedPlaylists itself, which --
// like this file's other DOM-heavy render functions -- is exercised only
// indirectly/manually).
//
// F1 (v1.24.0, T3): also threads through `channelAvatarUrl` (C6, populated by
// T11 in Wave 3 -- always absent/null on a pin record today), normalized to
// `null` when absent/blank/non-string, so `resolveAvatarSource` has a single,
// already-validated field to read. Building this passthrough now means T11
// never has to touch this client file -- it only ever adds the field
// server-side.
// v1.37.0 (books shelves-as-pins): ONE pin-fetch helper for every render
// call site -- ytdlp channel pins first, book-shelf pins after (each fetch
// independently degrades to [] on 404/disabled/network failure, so all four
// enabled/disabled combinations reduce to today's behavior; a books-less +
// ytdlp-less install renders exactly nothing, byte-identical).
function fetchAllPins() {
  const safeJson = (url) => fetch(url)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  // v1.37.0 (Dean's orphaned-pin report): every pin is tagged with its
  // SOURCE so the unpin control (buildUnpinButton below) knows which DELETE
  // endpoint owns it -- the raw source field never enters
  // derivePinnedPlaylistEntries' locked shape; the renderers read it off
  // the parallel validPins view exactly like `id`.
  // v1.72: podcast show pins join as the third source (intake ruling 5).
  return Promise.all([safeJson('/api/subscriptions/pins'), safeJson('/api/books/pins'), safeJson('/api/podcasts/pins')])
    .then(([channelPins, bookPins, podcastPins]) => {
      const pins = [
        ...(Array.isArray(channelPins) ? channelPins : []).map((p) => ({ ...p, pinSource: 'channel' })),
        ...(Array.isArray(bookPins) ? bookPins : []).map((p) => ({ ...p, pinSource: 'books' })),
        ...(Array.isArray(podcastPins) ? podcastPins : []).map((p) => ({ ...p, pinSource: 'podcasts' })),
      ];
      // v1.53: the capability cache's pins half -- the next refresh paints
      // the pinned sidebar optimistically from this (primePinnedSidebarFromCache).
      writeCapabilityCache({ pins });
      return pins;
    });
}

// v1.37.0 (Dean's orphaned-pin report): the per-row UNPIN control. Before
// this, unpinning required the pinned thing to still have a surface (a
// watch page with videos, a subscription row) -- a pin whose folder emptied
// out (or whose subscription was removed) was PERMANENT. This control lives
// on the pinned rows themselves, so ANY pin is always unpinnable. Two-tap
// arm/confirm (the card-delete pattern -- no native confirm()); the DELETE
// endpoint is chosen by the pin's tagged source. `onDone` re-renders.
function pinDeleteEndpoint(pin) {
  if (pin && pin.pinSource === 'books') return `/api/books/pins/${encodeURIComponent(pin.id)}`;
  if (pin && pin.pinSource === 'podcasts') return `/api/podcasts/pins/${encodeURIComponent(pin.id)}`;
  return `/api/subscriptions/pins/${encodeURIComponent(pin.id)}`;
}

// Sweep S1 (D4.6/D4.8, F32): the unpin control is the one Pin concept - a plain ui-btn icon
// toggle showing the filled pin (`keep.fill`, pressed) - and the in-row "Unpin?" arm is
// gone: a tap asks through ui.confirm, and only a confirmed answer DELETEs (Cancel, Esc,
// the scrim and Close all keep the pin). `size`: 'md' in the phone sheet (a 44px button),
// 'sm' in the desktop sidebar's 13px rows (the hit area is 44 either way).
function buildUnpinButton(pin, onDone, size, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-btn ui-btn--plain ui-btn--' + (size === 'md' ? 'md' : 'sm') + ' ui-btn--icon pinned-unpin-btn';
  btn.setAttribute('aria-label', 'Unpin');
  btn.setAttribute('aria-pressed', 'true');
  const slot = document.createElement('span');
  slot.className = 'ui-btn__icon';
  const glyph = uiIconEl('keep.fill', 'md');
  if (glyph) slot.appendChild(glyph);
  btn.appendChild(slot);
  let asking = false;
  btn.addEventListener('click', (event) => {
    // Never navigate the row's own link.
    event.preventDefault();
    event.stopPropagation();
    if (!pin || typeof pin.id !== 'string' || asking) return;
    const U = typeof window !== 'undefined' ? window.ui : null;
    if (!U || typeof U.confirm !== 'function') return; // ui.js ships on every shell
    asking = true;
    const name = typeof label === 'string' && label.trim() ? label.trim() : 'this playlist';
    // Gate r1 (adversary 3): this button lives in the SHELL (the sidebar, the playlists sheet),
    // which no view teardown reaches, so the confirm binds the router's shown-view signal:
    // leaving the view dismisses it (resolves false) and its OK cannot act over the next one.
    const ft = window.FileTube;
    const shown = (ft && typeof ft.viewSignal === 'function') ? ft.viewSignal() : undefined;
    U.confirm({ title: 'Unpin ' + name + '?', body: 'It leaves your pinned playlists. You can pin it again from its page.', confirmLabel: 'Unpin', signal: shown })
      .then((ok) => {
        asking = false;
        if (ok !== true || (shown && shown.aborted)) return;
        btn.disabled = true;
        return fetch(pinDeleteEndpoint(pin), { method: 'DELETE' })
          .catch(() => {})
          .finally(() => { if (typeof onDone === 'function') onDone(); });
      });
  });
  return btn;
}

// The one refresh routine every unpin uses: re-fetch both pin sources and
// rebuild BOTH surfaces (sidebar section + playlists sheet).
function refreshAllPinSurfaces() {
  fetchAllPins().then((pins) => {
    renderPinnedSidebar(pins);
    // Gate fix (adversarial S1): the sheet's zero-pin empty-state must only
    // render when the ytdlp module is genuinely enabled -- the injected
    // Subscriptions nav link IS that probe's durable result, so use its
    // presence as the hint instead of hardcoding true (a books-only install
    // keeps the disabled-module nothing-at-all posture).
    const ytdlpEnabled = Boolean(document.querySelector('[data-nav="subscriptions"]'));
    renderPinnedPlaylists(pins, ytdlpEnabled);
    // v1.47.4 item 9: keep the sheet's zero-shift cache coherent. Without this,
    // unpinning something would leave the removed pin in the cache, and the
    // next open would paint it from cache and then visibly drop it once the
    // network answered -- reintroducing the exact shift item 9 removes, on the
    // one flow most likely to trigger it.
    if (playlistsSheetCache) {
      playlistsSheetCache = { ...playlistsSheetCache, pins, moduleEnabled: ytdlpEnabled };
    }
    // v1.47.4 gate WARNING (adversarial seat) -- THE DELETE-RESURRECT SHAPE.
    // The sheet paints its cache SYNCHRONOUSLY on open, so an unpin is
    // clickable while that open's own fetches are still in flight:
    //   t=0    open; cache paints; config+pins requests start; generation = N
    //   t=50   user unpins; this function DELETEs, refetches, rewrites the cache
    //   t=400  the ORIGINAL open's Promise.all resolves with pins read at t=0
    //          (still containing the pin). generation is still N, so its guard
    //          passes, it overwrites the cache and re-renders.
    // The just-unpinned pin REAPPEARS, and the poisoned cache repaints it on
    // every later open until some fresh fetch happens to win. Server state was
    // always correct, so no data was lost -- but it is the resurrect shape, on
    // the very flow item 9 was built for.
    // Bumping the generation invalidates any open still in flight, so a
    // response that predates this unpin can no longer paint.
    playlistsSheetGeneration += 1;
  });
}

function derivePinnedPlaylistEntries(pins) {
  const list = Array.isArray(pins) ? pins : [];
  return list
    .filter((p) => p && typeof p.channelDir === 'string' && p.channelDir !== '')
    .map((p) => {
      const trimmedLabel = displayChannelName(typeof p.label === 'string' ? p.label.trim() : ''); // v1.114 A2: a pin's snapshot label may be an "@handle" -> show the name
      const rawBase = p.channelDir.split(/[\\/]/).pop() || p.channelDir;
      // v1.126: a label-less pin's fallback consults the folder display map
      // before the raw dir basename (the unhealable-folder rename lane).
      const base = folderDisplayName(rawBase) || rawBase;
      const avatarUrl = typeof p.channelAvatarUrl === 'string' && p.channelAvatarUrl.trim() !== '' ? p.channelAvatarUrl.trim() : null;
      return {
        channelDir: p.channelDir,
        label: trimmedLabel !== '' ? trimmedLabel : (base || 'Pinned channel'),
        channelAvatarUrl: avatarUrl,
        // v1.37.0 (books shelves-as-pins): an optional explicit link target.
        // ytdlp pins never carry one (null -> the renderers' existing
        // `/?root=` default); a book-shelf pin's server payload pre-shapes
        // `/books?root=...`. THE one deliberate shared-renderer widening --
        // the shape-lock test updates in lockstep (exec plan risk #3).
        // Same-app ABSOLUTE PATHS only: '/x' qualifies, protocol-relative
        // '//host/x' (an external origin) does not (gate fix, QA S9).
        href: typeof p.href === 'string' && p.href.startsWith('/') && !p.href.startsWith('//') ? p.href : null,
      };
    });
}

// F1 (v1.24.0, T3): the small avatar node shared by renderPinnedPlaylists and
// renderPinnedSidebar below -- REPLACES the old generic `<i class="icon-star">`
// glyph with the avatar precedence (`resolveAvatarSource` above): a real
// captured channel icon (`<img>`, C6) when present, else the deterministic
// generated `{glyph, color}` avatar (`<span>`). createElement/textContent
// only, matching this file's SECURITY discipline for pin data (a pin's
// label/channelAvatarUrl are the same untrusted, creator-controlled snapshot
// `renderPinnedPlaylists`'s own comment already documents).
// Sweep S1 (D4.4): a ui-avatar (chromeAvatarEl) - the captured channel photo, else the
// primitive's monogram; a photo that fails becomes the monogram (never a broken image).
// `size` is a D2.3 avatar size: 'xs' (20px) in the desktop sidebar's rows, 'md' (36px, the
// list's media column) in the phone sheet.
function buildPinAvatarNode(label, channelAvatarUrl, size) {
  const source = resolveAvatarSource(label, channelAvatarUrl);
  const el = chromeAvatarEl(label, source.type === 'url' ? source.url : null, size || 'xs');
  el.classList.add('pinned-avatar');
  return el;
}

// v1.21.0 FR-5 (AC35/AC36): renders the pinned-channel-playlist subsection
// into the Playlists sheet -- appended AFTER, and structurally SEPARATE
// from (never merged into), the db.folders-driven list `renderPlaylistsSheet`
// builds above, per the design's explicit "alongside, never merged into"
// invariant. Idempotent: any previously-rendered pinned section is removed
// first, so repeated opens never accumulate duplicates.
//
// v1.26.3 (Item 2): `moduleEnabled` (optional, default falsy) gates a "No
// playlists pinned yet." empty-state message for the zero-pins case --
// deliberately NOT unconditional. A disabled module's 404 resolves to the
// exact same empty `pins` array an ENABLED-but-unused module would send
// (see openPlaylistsSheet's fetch below), so this function alone cannot
// tell those two cases apart; rendering the message unconditionally would
// leak new UI into an installation with the module OFF, breaking the
// disabled-module no-op guarantee (ARCHITECTURE.md). The caller passes
// `moduleEnabled: true` ONLY after observing a genuine 2xx response from
// `GET /api/subscriptions/pins` (proof the module is actually active) --
// every other caller/omission renders NOTHING for zero pins, preserving the
// prior "disabled and enabled-but-unused look identical" behavior exactly.
//
// SECURITY: unlike renderPlaylistsSheet above (which HTML-escapes
// operator-owned folder labels into an innerHTML template string), this
// function builds every node via createElement/textContent/createTextNode
// ONLY -- a pin's `label` is a channel-name SNAPSHOT captured from
// yt-dlp-derived metadata, the SAME untrusted, creator-controlled trust
// level lib/ytdlp/client/subscriptions.js treats a subscription's own
// `name` at (textContent-only, never innerHTML) -- this function holds
// itself to that same, stricter discipline for that reason. The new empty-
// state message is 100% static, developer-authored copy, but is still built
// via createElement/textContent to match this function's own discipline.
function renderPinnedPlaylists(pins, moduleEnabled) {
  const list = document.getElementById('playlists-sheet-list');
  if (!list) return;
  const existing = document.getElementById('playlists-pinned-section');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const entries = derivePinnedPlaylistEntries(pins);
  if (entries.length === 0) {
    if (moduleEnabled) {
      // Sweep S9 (F65): the one ui-state block (its title only - a compact note inside
      // the sheet), in ui.state's own DOM.
      const empty = document.createElement('div');
      empty.id = 'playlists-pinned-section';
      empty.className = 'ui-state';
      const title = document.createElement('h3');
      title.className = 'ui-state__title';
      title.textContent = 'No playlists pinned yet.';
      empty.appendChild(title);
      list.appendChild(empty);
    }
    return;
  }

  const section = document.createElement('div');
  section.id = 'playlists-pinned-section';
  section.className = 'playlists-pinned-section';

  const heading = document.createElement('div');
  heading.className = 'playlists-sheet-heading';
  heading.textContent = 'Pinned';
  section.appendChild(heading);
  // Sweep S1 (F50): the pinned rows are ui-rows in the same list shape as the library rows
  // above (media column, one action column), so the two lists' columns line up.
  const group = document.createElement('div');
  group.className = PLAYLISTS_SHEET_LIST_CLASS;
  group.setAttribute('role', 'list');
  group.setAttribute('aria-label', 'Pinned');
  section.appendChild(group);

  // v1.37.0: same-predicate parallel view of the raw pins, so each rendered
  // row can recover its source record (id + pinSource) for the unpin
  // control -- the sidebar renderer's validPins pattern.
  const validSheetPins = (Array.isArray(pins) ? pins : [])
    .filter((p) => p && typeof p.channelDir === 'string' && p.channelDir !== '');

  entries.forEach((entry, sheetIndex) => {
    const span = (cls) => { const n = document.createElement('span'); n.className = cls; return n; };
    // A ui-row div (it holds a button, so the whole row cannot be one link): the title's
    // link is stretched over the row by ui.css (.ui-row__link::before).
    const row = document.createElement('div');
    row.className = 'ui-row ui-row--default playlists-sheet-item';
    row.setAttribute('role', 'listitem');
    row.appendChild(span('ui-row__lead'));
    const media = span('ui-row__media');
    // F1: real channel icon when captured (C6), else the monogram avatar.
    media.appendChild(buildPinAvatarNode(entry.label, entry.channelAvatarUrl, 'md'));
    row.appendChild(media);
    const body = span('ui-row__body');
    const title = span('ui-row__title');
    const link = document.createElement('a');
    link.className = 'ui-row__link';
    // v1.37.0: a pre-shaped href (book shelves) wins; ytdlp pins keep the
    // classic /?root= link (entry.href is null there).
    link.href = entry.href || ('/?root=' + encodeURIComponent(entry.channelDir));
    // SECURITY: entry.label is untrusted -- a text node, never innerHTML.
    link.appendChild(document.createTextNode(entry.label));
    title.appendChild(link);
    body.appendChild(title);
    row.appendChild(body);
    row.appendChild(span('ui-row__aside'));
    const acts = span('ui-row__actions');
    // v1.37.0 (Dean's orphaned-pin report): the unpin control -- see
    // buildUnpinButton's comment.
    const sheetSourcePin = validSheetPins[sheetIndex];
    if (sheetSourcePin && typeof sheetSourcePin.id === 'string') {
      acts.appendChild(buildUnpinButton(sheetSourcePin, refreshAllPinSurfaces, 'md', entry.label));
    } else {
      const slot = span('ui-row__slot');
      slot.setAttribute('aria-hidden', 'true');
      acts.appendChild(slot);
    }
    row.appendChild(acts);
    group.appendChild(row);
  });

  list.appendChild(section);
}

// v1.22.0 FR-5 (AC32-AC38): renders the pinned-channel section into the
// DESKTOP left-nav sidebar (main.js/watch.js/setup.js each call this from
// their own init(), passing the SAME GET /api/subscriptions/pins response --
// see each file's call site). `#sidebar-folders-list` lives in the
// persistent shell OUTSIDE `#view-root`, so THREE independent
// `renderSidebarFolders` implementations exist (main.js/watch.js/setup.js,
// out of scope to de-duplicate here) -- several of them reassign
// `sidebarFoldersList.innerHTML` wholesale (drag-reorder persist, cache
// restore). Rather than append pins INSIDE `#sidebar-folders-list` (which
// any of those rebuilds would silently wipe), this renders a SEPARATE
// sibling section, `#sidebar-pinned-section`, inserted immediately AFTER
// `#sidebar-folders-list` in the shell -- structurally unreachable from any
// of those three folder renderers, so it survives every one of their
// rebuilds untouched (AC32/AC33).
//
// Otherwise mirrors `renderPinnedPlaylists` above EXACTLY: reuses the SAME
// pure `derivePinnedPlaylistEntries` helper (AC34 -- no second, divergent
// derivation of "what to display for a pin"), the same
// createElement/textContent/createTextNode-only construction (AC35 -- a
// pin's `label` is the same creator-controlled snapshot, never `innerHTML`),
// the same idempotent remove-then-rebuild (repeated calls, e.g. once per
// view's init(), never accumulate duplicates), and the same render-NOTHING-
// when-there-are-zero-pins no-op -- which is what makes a disabled module
// (its own `GET /api/subscriptions/pins` 404 resolved to `[]` by the call
// sites below) look identical to an enabled-but-unused one: the sidebar
// renders exactly as it does today, folders only (AC37).
//
// Read-only consumer of the existing gated pin store: this function never
// writes anything on its OWN -- no fetch, no POST, no `db.folders`/
// `folderSettings` access of any kind (AC36). The DnD it wires below (v1.24.3)
// is the one exception -- a drop event fires a POST, exactly as documented at
// `wirePinnedSidebarDragAndDrop`/`persistPinReorder`'s own comments.
//
// v1.24.3: also wires native HTML5 drag-and-drop reordering on the rendered
// rows -- mirrors main.js's `renderSidebarFolders` folder DnD (v1.15.0 item
// 1) and lib/ytdlp/client/subscriptions.js's subscription-row DnD (v1.24.0
// B4/T6). Both `renderPinnedSidebar` and `renderPinnedPlaylists` already
// DISPLAY pins in the persisted order for free (they read the SAME
// `GET /api/subscriptions/pins` response, which `store.listPins` now returns
// order-sorted) -- only this sidebar surface gets the drag GESTURE.
function renderPinnedSidebar(pins) {
  const folderList = document.getElementById('sidebar-folders-list');
  if (!folderList || !folderList.parentNode) return;
  const existing = document.getElementById('sidebar-pinned-section');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const entries = derivePinnedPlaylistEntries(pins);
  if (entries.length === 0) return;

  // v1.24.3: `entries` (built above) drops any pin lacking a usable
  // channelDir -- `derivePinnedPlaylistEntries`'s own frozen, unit-tested
  // `{channelDir, label, channelAvatarUrl}` shape deliberately does NOT
  // carry a pin's `id` (widening it would break
  // test/unit/pinned-playlist-entries.test.js's exact-shape assertions), so
  // the drag wiring below needs its OWN same-predicate, same-order filtered
  // view of the RAW `pins` to recover each rendered row's `id`. `validPins[i]`
  // is therefore guaranteed to be the source record for `entries[i]`.
  const validPins = (Array.isArray(pins) ? pins : [])
    .filter((p) => p && typeof p.channelDir === 'string' && p.channelDir !== '');

  const section = document.createElement('div');
  section.id = 'sidebar-pinned-section';
  section.className = 'sidebar-pinned-section';

  const heading = document.createElement('div');
  heading.className = 'sidebar-section-title';
  heading.textContent = 'Pinned';
  section.appendChild(heading);

  entries.forEach((entry, index) => {
    const link = document.createElement('a');
    link.className = 'sidebar-item';
    // v1.37.0: a pre-shaped href (book shelves) wins; ytdlp pins keep the
    // classic /?root= link (entry.href is null there).
    link.href = entry.href || ('/?root=' + encodeURIComponent(entry.channelDir));
    // v1.24.3: drag-and-drop reorder target -- see
    // wirePinnedSidebarDragAndDrop below. `data-pin-id` is how a drop
    // recovers WHICH pin a rendered row represents (the reorder route is
    // keyed by pin id, not channelDir).
    const sourcePin = validPins[index];
    if (sourcePin && typeof sourcePin.id === 'string') link.dataset.pinId = sourcePin.id;
    // F1: real channel icon when captured (C6), else a deterministic
    // generated avatar -- replaces the old generic icon-star glyph.
    link.appendChild(buildPinAvatarNode(entry.label, entry.channelAvatarUrl));
    // SECURITY: entry.label is untrusted -- a dedicated text node (not
    // link.textContent, which would also wipe the avatar appended above) so
    // both the avatar and the label survive, neither ever passed through
    // innerHTML. Same discipline as renderPinnedPlaylists above.
    // v1.341.1 (Dean): the label is its own element (.sidebar-item__label) so it can take the row's
    // leftover width on one line (ellipsis); as a bare text node a long one-word name
    // ("heavymachinegun") could not shrink and pushed the pin out of the column the others sit in.
    const label = document.createElement('span');
    label.className = 'sidebar-item__label';
    label.textContent = entry.label;
    link.appendChild(label);
    // v1.37.0 (Dean's orphaned-pin report): every pinned row carries its
    // own unpin control -- see buildUnpinButton's comment.
    if (sourcePin && typeof sourcePin.id === 'string') {
      link.appendChild(buildUnpinButton(sourcePin, refreshAllPinSurfaces, 'sm', entry.label));
    }
    section.appendChild(link);
  });

  // Insert as folderList's NEXT SIBLING (never a child of it) -- see the
  // function comment above for why this placement is load-bearing.
  folderList.parentNode.insertBefore(section, folderList.nextSibling);

  // v1.24.3: (re-)wire drag-and-drop on every full rebuild -- a fresh set of
  // `.sidebar-item` elements needs fresh listeners each time. Since this
  // function always REBUILDS the whole section from scratch (the
  // `existing`/removeChild above), the previous section's nodes -- and their
  // listeners -- are simply detached and eligible for GC, never doubly wired.
  // (The subscriptions list once re-wired the same way; its drag-to-reorder
  // was removed in v1.155, so this is now the pinned sidebar's own pattern.)
  wirePinnedSidebarDragAndDrop(section, validPins);
}

// v1.24.3, rewired in v1.76: drag-to-reorder for the PINNED SIDEBAR section.
// It used to carry its own copy of the native HTML5 DnD wiring (five
// listeners, mirroring main.js's and subscriptions.js's copies); it now calls
// the shared pointer gesture layer, `wireReorderable`, like every other
// reorder surface in the app. The user-visible change is that these pins can
// finally be reordered on a touch screen - native HTML5 drag never fired
// there, so the whole feature was desktop-only.
//
// Unchanged: the `.sidebar-item.dragging`/`.drag-over-before`/
// `.drag-over-after` class family (every pinned row already wears
// `.sidebar-item`, so no forked CSS is needed), the immediate persist on drop
// (a sidebar has no Save button), and the per-source partition below.
//
// The old comment here claimed drag events were "untestable-by-necessity".
// That was true of HTML5 DataTransfer, which jsdom does not implement; it is
// NOT true of pointer events, and the gesture layer is now bound end-to-end
// in test/unit/reorder-gesture.test.js (including this surface's cross-group
// refusal). The server side stays proven by
// test/integration/ytdlp-pin-reorder.test.js.
// @param {HTMLElement} section the freshly-built `#sidebar-pinned-section`
// @param {Array<object>} validPins the SAME filtered/ordered pin records
//   `renderPinnedSidebar` rendered rows FROM
// v1.37.0 gate fix (BOTH reviewers' CRITICAL): the pin's owning module --
// drag scoping and the reorder endpoint are decided by this, exactly like
// pinDeleteEndpoint above. Untagged legacy pins default to 'channel'.
function pinSourceOf(pin) {
  if (pin && pin.pinSource === 'books') return 'books';
  if (pin && pin.pinSource === 'podcasts') return 'podcasts';
  return 'channel';
}

function wirePinnedSidebarDragAndDrop(section, validPins) {
  // The rows that actually rendered a `data-pin-id`, in render order. The
  // previous wiring indexed `validPins` by ROW index, which silently
  // misaligned every row after an id-less pin (the render only sets the
  // attribute when `typeof pin.id === 'string'`, while every pin gets a row).
  // Deriving the row-aligned list with the SAME predicate the renderer uses
  // removes that class of drift outright; an id-less pin could never be
  // persisted anyway, since `orderedIds` drops it.
  const rowPins = (Array.isArray(validPins) ? validPins : []).filter((p) => p && typeof p.id === 'string');
  wireReorderable(section, {
    rowSelector: '.sidebar-item[data-pin-id]',
    scrollContainer: typeof document !== 'undefined' ? document.getElementById('sidebar') : null,
    // v1.37.0's cross-source contract, now a first-class option rather than
    // a hand-rolled check in two places: channel pins reorder among channel
    // pins, book shelves among book shelves, podcast shows among shows. The
    // helper refuses the drop AND never draws the drop line on a foreign row.
    groupOf: (index) => pinSourceOf(rowPins[index]),
    onReorder: (fromIndex, toIndex) => {
      const source = pinSourceOf(rowPins[fromIndex]);
      const reordered = moveArrayItem(rowPins, fromIndex, toIndex);
      // v1.37.0 gate fix, unchanged: persist ONLY this source's ids, in their
      // new relative order, to this source's OWN endpoint -- a mixed id list
      // hitting the ytdlp endpoint tail-dropped every book id and the response
      // re-render made book pins vanish from the sidebar.
      const orderedIds = reordered
        .filter((p) => pinSourceOf(p) === source)
        .map((p) => p && p.id)
        .filter((id) => typeof id === 'string' && id !== '');
      persistPinReorder(orderedIds, source);
    },
  });
}

// POSTs the dragged order to the new `POST /api/subscriptions/pins/reorder`
// route, which responds with the SAME reordered+enriched shape
// `GET /api/subscriptions/pins` returns -- re-render the sidebar section
// wholesale with it (simplest correct way to reflect the server's
// authoritative order, including its own unknown-id/tail-position tolerance
// -- see `store.reducePinReorder`'s doc comment). A failed request RELOADS
// pins from the server instead of trusting the optimistic client-side order,
// so a rejected/errored drag can never leave the sidebar silently diverged
// from what is actually persisted. (The subscriptions list once carried the
// same reload-on-failure fail-safe in `persistReorder`; that reorder was
// removed in v1.155, so this is now the pinned sidebar's own pattern.)
function persistPinReorder(orderedIds, source) {
  // v1.37.0 gate fix (BOTH reviewers' CRITICAL): the endpoint is the pin
  // SOURCE's own (book shelves have their own reorder route -- previously
  // client-dead), and the re-render ALWAYS goes through the merged
  // refreshAllPinSurfaces -- never a single endpoint's response, which only
  // carries that module's pins and made the other module's pins vanish
  // from the sidebar until the next full load.
  const endpoint = source === 'books' ? '/api/books/pins/reorder'
    : source === 'podcasts' ? '/api/podcasts/pins/reorder'
      : '/api/subscriptions/pins/reorder';
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds }),
  })
    .then((r) => (r.ok ? null : Promise.reject(new Error('pin reorder failed with status ' + r.status))))
    .catch((err) => {
      // A failed request still falls through to the merged refetch below --
      // the sidebar must never trust the optimistic client-side order.
      console.error('Pin reorder failed:', err);
    })
    .finally(() => refreshAllPinSurfaces());
}

// (v1.26.2's openOverlay / closeOverlayThen transition helpers - and prefersReducedMotion /
// overlayCanAnimate beside them - were retired in step 7 of the UI pass: sweeps S1, S4, S5
// and S9 moved every sheet and modal they animated onto ui.sheet, which owns its own
// enter/exit and reduced-motion handling (ui.js, ui.css).)

// ---- v1.47.4 item 9 (Dean): the Playlists sheet's late pin shift -----------
//
// Dean: "When I open the phone and then click Playlists after about a half a
// sec all of the pins then load shifting everything up. It's like a FOUC but
// not exactly."
//
// It isn't a FOUC -- it is a layout shift with two stacked causes:
//
//   1. SERIALIZED FETCHES. The pins request was chained to run only AFTER
//      /api/config resolved, so the sheet's content arrived in two waves, one
//      network round-trip apart. The chaining existed for a real reason (see
//      below), but the reason was a RENDER-ORDER constraint, not a data
//      dependency -- the two requests never needed to be sequential.
//   2. A BOTTOM-ANCHORED SHEET. The sheet is anchored to the bottom of the
//      viewport, so appending the pinned section grows it UPWARD. That is
//      exactly Dean's "shifting everything up": each late wave of content
//      pushes everything already on screen up the screen.
//
// The original chaining note, preserved because the constraint it describes is
// still real: `renderPlaylistsSheet` assigns `list.innerHTML` WHOLESALE, so it
// would wipe an already-appended pinned section if the pins arrived first.
// That is now handled by rendering both in ONE ordered pass instead of by
// delaying the network request.
//
// A 404 on the pins endpoint (module disabled) resolves to `[]`, preserving the
// disabled-module no-op guarantee -- never logs/throws on a 404. And per
// v1.26.3 (Item 2), `moduleEnabled` is captured from the response's OWN `r.ok`
// BEFORE the body is read, which is what lets `renderPinnedPlaylists` show
// "No playlists pinned yet." for a genuine zero-pins case without also showing
// it when the module is simply disabled (both otherwise resolve to `[]`). A
// network-level failure leaves it `false` -- the conservative "render nothing".

// Last successfully-rendered sheet payload, so a REOPEN paints its final
// content synchronously and therefore at its final height -- zero shift in the
// common case (Dean opens this repeatedly in a session). Null until the first
// successful load; a stale-but-correct-height render is strictly better than
// an empty sheet that jumps once the network answers.
let playlistsSheetCache = null;

// Guards against an out-of-order render when the sheet is closed and reopened
// while a previous open's fetches are still in flight: only the newest open may
// paint. Without this, a slow first response could overwrite a newer one.
let playlistsSheetGeneration = 0;

/**
 * Render the whole sheet body in ONE ordered pass: folders first (wholesale
 * innerHTML), pinned section appended after. Doing both together is what makes
 * the sheet reach its final height in a single layout, which is the entire
 * point of item 9 -- callers must never render just one half.
 */
function renderPlaylistsSheetContent(snapshot) {
  renderPlaylistsSheet(snapshot.folders, snapshot.folderSettings, snapshot.syntheticFolders);
  renderPinnedPlaylists(snapshot.pins, snapshot.moduleEnabled);
}

// Lazily fetches /api/config on first open, populates the sheet, then reveals
// it. Feature-detects its own elements so it's safe to call on any page.
// Sweep S1 (D4.6, F50): the sheet is ONE ui.sheet (a bottom sheet with a grab handle, the
// "Playlists" title and the one Close; scrim, Esc, a swipe down and Close all dismiss it),
// built on the first open and reused. Its list keeps the #playlists-sheet-list id the
// renderers write into; while the sheet is closed the list is detached (renders to it no-op).
let playlistsSheetCtrl = null;
function ensurePlaylistsSheet() {
  if (playlistsSheetCtrl) return playlistsSheetCtrl;
  const U = typeof window !== 'undefined' ? window.ui : null;
  if (!U || typeof U.sheet !== 'function') return null; // ui.js ships on every shell
  const list = document.createElement('div');
  list.id = 'playlists-sheet-list';
  list.className = 'playlists-sheet-list';
  playlistsSheetCtrl = U.sheet({ variant: 'bottom', title: 'Playlists', content: list, doc: document });
  // An id, not a class: ui.sheet rewrites the element's className on every open.
  playlistsSheetCtrl.el.id = 'playlists-sheet';
  // Tapping a playlist/folder LINK navigates (SPA) - close the sheet too, so the user is
  // not left with the overlay open after picking one (Dean: no extra manual close). Does
  // NOT preventDefault, so the navigation still happens; an unpin tap never reaches here
  // (its handler stops the event).
  list.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('a')) closePlaylistsSheet();
  });
  return playlistsSheetCtrl;
}

// Lazily fetches /api/config on every open, populates the sheet, then reveals it.
function openPlaylistsSheet() {
  const ctrl = ensurePlaylistsSheet();
  if (!ctrl) return;
  ctrl.open();

  // Paint last-known content SYNCHRONOUSLY, before any await -- the sheet then
  // animates open already at its final height instead of growing into it.
  if (playlistsSheetCache) renderPlaylistsSheetContent(playlistsSheetCache);

  const generation = ++playlistsSheetGeneration;

  // Both requests in PARALLEL. Still fetched fresh on every open (/api/config
  // is tiny) so a library change mid-session is never shown stale -- the change
  // is that they no longer wait for each other.
  Promise.all([
    fetch('/api/config').then((r) => r.json()).catch(() => null),
    fetch('/api/subscriptions/pins')
      .then((r) => Promise.all([r.ok, r.ok ? r.json() : []]))
      .catch(() => [false, []]),
  ]).then(([config, [moduleEnabled, pins]]) => {
    if (generation !== playlistsSheetGeneration) return; // superseded by a newer open
    if (!config) {
      // Keep whatever the cache already painted rather than replacing real
      // content with an error -- only a sheet with nothing in it says so.
      if (!playlistsSheetCache) {
        const list = document.getElementById('playlists-sheet-list');
        if (list) list.innerHTML = '<p class="playlists-sheet-note">Failed to load folders.</p>';
      }
      return;
    }
    playlistsSheetCache = {
      folders: config.folders || [],
      folderSettings: config.folderSettings || {},
      syntheticFolders: Array.isArray(config.syntheticFolders) ? config.syntheticFolders : [],
      pins,
      moduleEnabled,
    };
    // One render, one layout. When the payload matches what the cache already
    // painted above, this is visually a no-op -- which is the zero-shift case.
    renderPlaylistsSheetContent(playlistsSheetCache);
  });
}

function closePlaylistsSheet() {
  if (playlistsSheetCtrl) playlistsSheetCtrl.close();
}

// Mirrors the bottom nav's Dark/Light item icon/label to the current data-mode.
// Called from applyTheme(), so it stays in sync no matter how the mode changes
// (nav item, header toggle, or initial load).
function updateNavThemeItem() {
  const item = document.getElementById('nav-theme-toggle');
  if (!item) return;
  const dark = document.documentElement.getAttribute('data-mode') === 'dark';
  // v1.87.1 (Dean): the nav theme glyph is an inline sprite <svg>, not an
  // `.icon-moon/.icon-sun` mask. Sweep S1: the tab's ui-icon keeps its box; only its
  // <use> reference swaps (the glyph for the mode a tap switches TO).
  const use = item.querySelector('.ui-btn__icon use');
  const label = item.querySelector('.bottom-nav-label');
  if (use) use.setAttribute('href', iconHref(CHROME_ICON[dark ? 'sun' : 'moon']));
  if (label) label.textContent = dark ? 'Light' : 'Dark';
}

// v1.82: the account menu's Theme row glyph reflects the current mode (sun in
// dark, moon in light), updated on every toggle exactly like the bottom-nav item.
function updateAccountMenuThemeItem() {
  // Sweep S1: the row's glyph is a sprite ui-icon; its <use> swaps between the two modes.
  // (The menu is attached only while open, and openMenu re-syncs on every open.)
  const icon = document.getElementById('account-menu-theme-icon');
  const use = icon && icon.querySelector('use');
  if (!use) return;
  const dark = document.documentElement.getAttribute('data-mode') === 'dark';
  use.setAttribute('href', iconHref(dark ? 'light_mode' : 'dark_mode'));
}

// Global dialog helpers (sweep S9, D4.6 / D4.8): every dialog is a ui.sheet.
//
// showConfirmModal / showChoiceModal keep their v1.26-v1.110 signatures and return a
// dismiss() - callers in other views (watch.js, skin-surface.js, podcasts.js, main.js)
// reach them as plain globals - but they now draw ui.confirm / ui.menu: one scrim, one
// surface, one motion, one Close, Esc, focus in and back, the body lock.
//
// What the bespoke modal guaranteed and where it lives now:
//   - one answer per dialog (v1.26.2 F2: a double tap on Confirm fired a duplicate DELETE):
//     ui.confirm answers once and only from a LIVE dialog (a tap on a closing one is a
//     no-op), and `settled` below runs onConfirm at most once;
//   - one dialog per call, its own buttons (v1.49: a second dialog re-bound the first one's
//     buttons by id): ui.confirm builds its own nodes, there are no ids to collide;
//   - a dismiss() for the caller's view teardown (v1.49 W2: body-level dialogs outlive an
//     SPA nav): it aborts the dialog's own signal, which ui.confirm answers as a cancel.
//
// The title and body arrive as caller-built HTML (the callers escape the dynamic parts and
// wrap them in <strong>/<br>/<small>). ui.confirm takes TEXT: the markup is parsed in an
// inert <template> (no script runs, no image loads), <br> stays a line break (ui.css keeps a
// confirm body's line breaks), and the result goes in by textContent - no caller string can
// become live markup, and no inline style (the old red trash warning) survives into it.
// `labels` = {confirm, cancel, danger}: `danger: true` gives the confirm button the
// destructive treatment (D4.8, F33 - a caller whose confirm deletes passes it).
function confirmHtmlToText(html, doc) {
  if (html == null) return '';
  const str = String(html).replace(/<br\s*\/?>/gi, '\n');
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || typeof d.createElement !== 'function') return str.replace(/<[^>]*>/g, '').trim();
  const t = d.createElement('template');
  t.innerHTML = str;
  const text = t.content ? t.content.textContent : t.textContent;
  return String(text || '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
}

function dialogUi() {
  return overlayUiLib(); // the page's window.ui (Node tests: the sibling module)
}

// Is a LIVE dialog up - any ui.sheet that is not on its way out? A sheet carries
// `is-closing` from the moment it starts to close (ui.js), so a dialog whose answer is
// being acted on (the confirm that triggered this very call) does not count. The watch
// page's relocation offer asks this before it opens a second dialog over a first.
function isLiveDialogOpen(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  return !!(d && d.querySelector('.ui-sheet:not(.is-closing)'));
}

function showConfirmModal(title, bodyText, onConfirm, labels) {
  const U = dialogUi();
  const l = (labels && typeof labels === 'object') ? labels : {};
  let settled = false;
  if (!U || typeof AbortController === 'undefined') return function dismiss() { settled = true; };
  const ac = new AbortController();
  // Gate r2 (adversary): bound to the router's SHOWN-view signal, read now, like every
  // destructive confirm. A caller on a cached view (home's bulk attribution) or one that moves
  // a file (the watch page's attribution move) must not stay up over the next view and act.
  const ft = (typeof window !== 'undefined') ? window.FileTube : null;
  const shown = (ft && typeof ft.viewSignal === 'function') ? ft.viewSignal() : null;
  const onLeave = () => ac.abort();
  if (shown) {
    if (shown.aborted) ac.abort();
    else shown.addEventListener('abort', onLeave, { once: true });
  }
  const unbind = () => { if (shown) shown.removeEventListener('abort', onLeave); };
  U.confirm({
    title: confirmHtmlToText(title),
    body: confirmHtmlToText(bodyText),
    confirmLabel: (typeof l.confirm === 'string' && l.confirm !== '') ? l.confirm : 'Confirm',
    cancelLabel: (typeof l.cancel === 'string' && l.cancel !== '') ? l.cancel : 'Cancel',
    danger: l.danger === true,
    signal: ac.signal,
  }).then((ok) => {
    unbind();
    if (settled) return;
    settled = true;
    // Exactly true: ui.confirm answers only true/false, and nothing but the confirm
    // button's own click is true.
    if (ok === true && !(shown && shown.aborted) && typeof onConfirm === 'function') onConfirm();
  });
  return function dismiss() {
    unbind();
    if (settled) return;
    settled = true;
    ac.abort();
  };
}

// v1.110 (Dean): the pick-one action dialog -- a title and one row per choice. Now ui.menu
// (a bottom sheet on a phone, a dialog on desktop; Close, Esc and the scrim cancel). Labels
// and title are textContent (they can be media-derived, e.g. a chapter title). Settles once:
// the first pick closes the menu and runs its `onPick` SYNCHRONOUSLY in the same click (so
// navigator.share keeps its user gesture); a second tap picks nothing. Returns a dismiss()
// for the caller's view teardown.
function showChoiceModal(title, choices) {
  const U = dialogUi();
  if (!U) return function dismiss() {};
  let picked = false;
  const items = (Array.isArray(choices) ? choices : [])
    .filter((choice) => choice && typeof choice.label === 'string')
    .map((choice) => ({
      label: choice.label,
      onSelect: () => {
        if (picked) return;
        picked = true;
        if (typeof choice.onPick === 'function') choice.onPick();
      },
    }));
  const heading = typeof title === 'string' ? title : '';
  const ctrl = U.menu({ title: heading, label: heading || 'Choose', items });
  return function dismiss() { ctrl.close(); };
}

// ---- Transcript flow (v1.203: SHARED by the watch page and the card corner) ----
//
// `openTranscriptFor({ id, title, signal, onBusy })` runs the whole
// transcript hand-off for one video: fetches the plain-text document
// (GET /api/transcript/:id) and the "Share with AI" prompts together (so
// every pick is ready inside the tap - the iOS clipboard rule), then on a
// PHONE width opens the pick-one (Share transcript / Copy transcript /
// Share with AI), and elsewhere the read-only text-field modal
// (showTranscriptModal). Any prompts failure resolves to [] - the AI pick
// simply disappears. `signal` (the caller's view abort) tears whichever
// modal is open down; `onBusy(bool)` lets a caller disable its button while
// the fetch runs. Returns a promise resolving to the modal's dismiss (or
// null when nothing opened). Moved here from watch.js so a card can call
// it with just an id + title - identical flow, no card-specific variant
// (Dean's ruling).
function transcriptIsPhoneWidth() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;
}

function fetchTranscriptTextFor(id, timestamps) {
  const url = '/api/transcript/' + encodeURIComponent(id) + (timestamps ? '?timestamps=1' : '');
  return fetch(url).then((res) => {
    if (!res || !res.ok) throw new Error('transcript ' + (res && res.status));
    return res.text();
  });
}

// settings.transcriptAiPrompts, readable by every signed-in user.
function fetchTranscriptAiPrompts() {
  return fetch('/api/settings')
    .then((res) => (res && res.ok ? res.json() : null))
    .then((s) => ((s && Array.isArray(s.transcriptAiPrompts)) ? s.transcriptAiPrompts.filter((p) => p && typeof p.text === 'string' && p.text.trim() !== '' && typeof p.name === 'string') : []))
    .catch(() => []);
}

// Payload contract (Dean: "exactly"): the prompt, a blank line, then the
// same document Share/Copy send (title / date / channel / transcript).
function composeTranscriptAiShare(promptText, transcriptText) {
  return String(promptText).trim() + '\n\n' + transcriptText;
}

// Native sheet where present, else the clipboard, with a toast either way
// except a completed sheet (the user saw it).
function runTranscriptAiShare(promptText, transcriptText, title) {
  return shareTextContent(composeTranscriptAiShare(promptText, transcriptText), title).then((outcome) => {
    if (outcome === 'shared' || typeof showToast !== 'function') return;
    showToast(outcome === 'copied' ? 'Copied with your prompt - paste it into your AI app' : 'Could not share the transcript.');
  });
}

// ONE transcript surface at a time across BOTH callers (gate: the move had
// dropped the watch page's dismiss-before-open, so a keyboard user Tabbing
// behind the backdrop could stack two modals). dismiss() is idempotent.
let transcriptActiveDismiss = null;

function openTranscriptFor(opts) {
  const o = opts || {};
  const id = o.id;
  const title = (typeof o.title === 'string' && o.title !== '') ? o.title : 'Transcript';
  const signal = o.signal || null;
  const onBusy = typeof o.onBusy === 'function' ? o.onBusy : () => {};
  // `stillWanted()` (optional): a caller whose view is CACHED on nav-away
  // (the home grid - its AbortController never fires, the v1.160 lesson)
  // says whether the surface that asked is still on screen when the text
  // lands; false = open nothing (gate: a late text used to open the modal
  // over a different page).
  const stillWanted = typeof o.stillWanted === 'function' ? o.stillWanted : () => true;
  if (!id) return Promise.resolve(null);
  onBusy(true);
  let dismiss = null;
  const setDismiss = (fn) => {
    if (dismiss && signal) signal.removeEventListener('abort', dismiss);
    dismiss = fn;
    transcriptActiveDismiss = fn;
    if (dismiss && signal) signal.addEventListener('abort', dismiss, { once: true });
  };
  return Promise.all([fetchTranscriptTextFor(id, false), fetchTranscriptAiPrompts()]).then(([text, aiPrompts]) => {
    if (signal && signal.aborted) return null;
    if (!stillWanted()) return null;
    if (transcriptActiveDismiss) { transcriptActiveDismiss(); transcriptActiveDismiss = null; }
    if (transcriptIsPhoneWidth()) {
      // "Share with AI" is the third pick when prompts exist. One prompt
      // shares at once; several open a pick-one of their names.
      const aiPick = aiPrompts.length === 0 ? [] : [{ label: 'Share with AI', onPick: () => {
        if (aiPrompts.length === 1) { runTranscriptAiShare(aiPrompts[0].text, text, title); return; }
        setDismiss(showChoiceModal('Share with AI', aiPrompts.map((prompt) => ({ label: prompt.name, onPick: () => runTranscriptAiShare(prompt.text, text, title) }))));
      } }];
      setDismiss(showChoiceModal('Transcript', [
        { label: 'Share transcript', onPick: () => {
          // A phone-width browser WITHOUT a share sheet falls back to the
          // clipboard inside shareTextContent - toast that outcome like Copy
          // does, so the pick never looks like it did nothing.
          shareTextContent(text, title).then((outcome) => {
            if (outcome === 'shared' || typeof showToast !== 'function') return;
            showToast(outcome === 'copied' ? 'Transcript copied' : 'Could not share the transcript.');
          });
        } },
        { label: 'Copy transcript', onPick: () => {
          copyTextToClipboard(text).then((outcome) => {
            if (typeof showToast !== 'function') return;
            showToast(outcome === 'copied' ? 'Transcript copied' : 'Could not copy the transcript.');
          });
        } },
      ].concat(aiPick)));
    } else {
      setDismiss(showTranscriptModal({
        text,
        loadText: (timestamps) => fetchTranscriptTextFor(id, timestamps),
        aiPrompts,
        shareAi: (promptText, currentText) => runTranscriptAiShare(promptText, currentText, title),
      }));
    }
    return dismiss;
  }).catch((err) => {
    console.error('Transcript load failed:', err);
    if (!(signal && signal.aborted) && typeof showToast === 'function') showToast('Could not load the transcript.');
    return null;
  }).finally(() => onBusy(false));
}

// Transcript export (Dean: "primarily a text field on desktop"): the desktop Transcript
// dialog. `opts.text` is the already-fetched document (title / date / channel, blank line,
// transcript); `opts.loadText(timestamps)` re-fetches it with `[m:ss]` prefixes when the
// "Show timestamps" switch is flipped (default OFF - Dean's ruling). A read-only field
// (select-all + copy works natively) and Copy, whose feedback is a toast (D4.9: "Copied" is
// a toast, never a label swap).
// v1.201 (Dean): `opts.aiPrompts` ([{id, name, text}], may be empty) adds "Share with AI"
// where the browser has a share sheet, else "Copy for AI", handing `<prompt>\n\n<the CURRENT
// field value>` to `opts.shareAi(promptText, currentText, label)`. One prompt acts directly;
// several open a pick-one of names first (its dismiss rides on this dialog's). An empty list
// adds nothing (never a do-nothing button).
// Sweep S9: a ui.sheet dialog (the wide modifier - prose wants room), the sheet's own Close,
// Esc and scrim; textContent throughout; returns a `dismiss()` for the view's abort teardown
// (body-level overlays outlive SPA nav on their own - the v1.49 lesson).
function showTranscriptModal(opts) {
  const o = opts || {};
  const U = dialogUi();
  if (!U) return function dismiss() {};
  const body = document.createDocumentFragment();
  const fieldWrap = document.createElement('div');
  fieldWrap.className = 'ui-field transcript-field';

  const textarea = document.createElement('textarea');
  textarea.className = 'ui-field__input transcript-textarea';
  textarea.id = 'transcript-text';
  textarea.readOnly = true;
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', 'Transcript');
  textarea.value = typeof o.text === 'string' ? o.text : '';
  fieldWrap.appendChild(textarea);
  body.appendChild(fieldWrap);

  const options = document.createElement('label');
  options.className = 'transcript-options';
  const tsLabel = document.createElement('span');
  tsLabel.textContent = 'Show timestamps';
  const tsBox = document.createElement('input');
  tsBox.type = 'checkbox';
  tsBox.id = 'transcript-timestamps';
  tsBox.className = 'ui-switch';
  tsBox.setAttribute('role', 'switch');
  tsBox.checked = false;
  options.appendChild(tsLabel);
  options.appendChild(tsBox);
  body.appendChild(options);

  const actions = document.createElement('div');
  actions.className = 'ui-confirm__actions';
  const aiPrompts = Array.isArray(o.aiPrompts) ? o.aiPrompts.filter((p) => p && typeof p.text === 'string' && p.text !== '') : [];
  const hasShareSheet = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  let aiBtn = null;
  const aiLabel = hasShareSheet ? 'Share with AI' : 'Copy for AI';
  if (aiPrompts.length > 0 && typeof o.shareAi === 'function') {
    aiBtn = U.button({ variant: 'secondary', label: aiLabel });
    aiBtn.id = 'transcript-ai-btn';
    actions.appendChild(aiBtn);
  }
  const copyBtn = U.button({ variant: 'primary', icon: 'content_copy', label: 'Copy' });
  copyBtn.id = 'transcript-copy-btn';
  actions.appendChild(copyBtn);
  body.appendChild(actions);

  let settled = false;
  let loadSeq = 0; // supersession guard for a fast double-toggle
  let aiPickDismiss = null; // the prompt pick-one, torn down with this dialog
  const ctrl = U.sheet({
    variant: 'dialog',
    title: 'Transcript',
    content: body,
    onClosing: () => {
      settled = true;
      if (aiPickDismiss) { aiPickDismiss(); aiPickDismiss = null; }
    },
  });
  function dismiss() { ctrl.close(); }

  tsBox.addEventListener('change', () => {
    if (typeof o.loadText !== 'function') return;
    const seq = ++loadSeq;
    const wanted = tsBox.checked;
    tsBox.disabled = true;
    Promise.resolve(o.loadText(wanted)).then((text) => {
      if (settled || seq !== loadSeq) return;
      if (typeof text === 'string') textarea.value = text;
    }).catch(() => {
      if (settled || seq !== loadSeq) return;
      showToast('Could not load the transcript.', null, { kind: 'error' });
      tsBox.checked = !wanted; // reflect the state that is actually shown
    }).then(() => { if (seq === loadSeq) tsBox.disabled = false; });
  });

  copyBtn.addEventListener('click', () => {
    copyTextToClipboard(textarea.value).then((outcome) => {
      if (settled) return;
      if (outcome !== 'copied') {
        showToast('Could not copy - select the text and copy it manually.', null, { kind: 'error' });
        return;
      }
      showToast('Transcript copied', null, { kind: 'success' });
    });
  });
  if (aiBtn) {
    aiBtn.addEventListener('click', () => {
      const run = (prompt) => o.shareAi(prompt.text, textarea.value, aiLabel);
      if (aiPrompts.length === 1) { run(aiPrompts[0]); return; }
      if (aiPickDismiss) aiPickDismiss();
      aiPickDismiss = showChoiceModal(aiLabel, aiPrompts.map((prompt) => ({ label: prompt.name, onPick: () => { aiPickDismiss = null; run(prompt); } })));
    });
  }
  // A drag that starts in the field and ends outside never closes it: the scrim is the
  // sheet's SIBLING, so such a drag clicks their common ancestor, not the scrim (the v1.289
  // drag-safe property, by structure).
  ctrl.open();
  // After open(): ui.sheet sets the sheet's variant classes on open, replacing any set before.
  ctrl.el.classList.add('transcript-dialog');
  return dismiss;
}

// ---- FR-7 (v1.21.0, T6): which items are yt-dlp-managed ---------------------
// See docs/exec-plans/completed/2026-07-08-v1.21-polish-release.md ("FR-7").
// A yt-dlp-downloaded file is re-downloadable; a LOCAL file is not. Step 7 (UI pass):
// the checkbox-gated local-file dialog (showHardDeleteModal) and its flow picker
// (deleteFlowFor) are gone - sweeps S3/S7 moved every delete onto ONE danger
// ui.confirm, whose copy (main.js cardDeleteConfirmCopy) reads this predicate to add
// "This local file cannot be re-downloaded." for a local file. Every delete still
// sends the same `DELETE /api/videos/:id` (a Trash move).

// Pure, fail-safe (AC45/AC50/AC51 -- destructive-action two-reviewer gate).
// Reuses the v1.20 FR-2 signal (never a new, divergent detection mechanism):
// `true` ONLY when `item.channelUrl`/`channelId`/`channelName` (v1.338: or
// `sourceExtractor`, below) is a non-empty, non-whitespace string -- the
// server only ever sets these fields for a yt-dlp-managed download (see
// `db.metadata[id]`, spread via `...item` on both `GET /api/videos` and
// `GET /api/videos/:id`). ANY
// absence/ambiguity -- a plain local file (every pre-v1.20 download has
// none of these fields), a malformed/missing `item`, `null`/`undefined`
// fields, or empty/whitespace-only strings -- resolves to `false`, meaning
// "treat as LOCAL/irreplaceable" (the confirm then says it cannot be
// re-downloaded). There is no code path in this function that
// can turn a `false` into a `true` on ambiguous input, so it can only ever
// ADD friction relative to today, never remove it. Never throws. Exported
// for node:test.
// v1.338 D8d (Dean: "non-YouTube things supported by YT DLP should have
// generally first-class experiences"): `sourceExtractor` is a fourth signal. A
// download from another site carries no channelUrl/channelId, and when the
// site reported no uploader it had no channelName either, so it got the
// local-file copy. The scan sets `sourceExtractor` only on a file under the
// yt-dlp download root (lib/scan/orchestrator.js, the `ytdlpDownloadRoots`
// gate), and the delete archives + tombstones it by (site, id). Both kinds
// still send the same DELETE /api/videos/:id.
function isYtdlpManagedItem(item) {
  if (!item || typeof item !== 'object') return false;
  const hasSignal = (v) => typeof v === 'string' && v.trim() !== '';
  return hasSignal(item.channelUrl) || hasSignal(item.channelId) || hasSignal(item.channelName)
    || hasSignal(item.sourceExtractor);
}

// ---- C1 (v1.24 UX Round, Wave 3): per-item "Move to..." picker -------------
//
// Client half of C1 (server.js's `POST /api/videos/:id/move` +
// `moveItemToFolder`/`computeMoveTarget` -- see that file's own comment for
// the full path-confinement + id re-key design). `showMoveModal` is a pure,
// self-contained DOM builder (it appends itself to `doc.body` and tears
// itself down, no caller boilerplate) so a future per-card/per-watch-page trigger just calls
// `showMoveModal(item, folders, onMove)` with no other wiring. `folders` is
// the SAME `data.folders` array `GET /api/config` already returns (the
// existing "known folders" list `openPlaylistsSheet`/`renderPlaylistsSheet`
// above already fetch) -- no new data source. `requestMoveItem` below is the
// actual `POST /api/videos/:id/move` call, kept separate (mirrors
// `triggerLibraryRescanAndRefresh`'s injectable-`fetchImpl` pattern) so a
// caller can compose them however its surface needs (e.g. show a status line
// while the request is in flight, or auto-refresh on success).
//
// SECURITY: every dynamic string (the item's title, each folder path) is
// rendered via `createElement`/`textContent` ONLY -- never `innerHTML`.
//
// Sweep S9: a ui.sheet dialog - a line naming the file, a ui-select of the folders, a status
// line and Cancel / Move - not the old generic modal family.

/**
 * Pure, self-contained "Move to…" picker. `item` needs at least `title` (the confirmation
 * copy; falls back to a generic label). `folders` is a plain array of folder path strings
 * (the SAME shape `GET /api/config`'s `folders` field returns). `onMove(targetFolder,
 * { teardown, statusEl, reenable })` fires once, only when a folder is selected and Move is
 * clicked -- the callback owns the actual request + teardown timing (this function never
 * calls `fetch`). `doc` defaults to `document` (injectable for jsdom tests).
 *
 * v1.26.2 F2 (a double tap on Move fired two concurrent move requests): `busy` arms BEFORE
 * onMove runs, disables Move and Cancel, and refuses every dismissal (Cancel, Close, Esc,
 * the scrim - ui.sheet's `canDismiss`) until the caller hands control back through
 * `reenable` (a failed request) or closes it with `teardown` (success). A closing dialog
 * answers nothing either (`ctrl.isOpen()`).
 */
function showMoveModal(item, folders, onMove, doc) {
  const d = doc || document;
  const win = d.defaultView || (typeof window !== 'undefined' ? window : null);
  const U = (win && win.ui) || dialogUi();
  const it = item || {};
  const list = Array.isArray(folders) ? folders.filter((f) => typeof f === 'string' && f !== '') : [];
  if (!U) return null;

  const body = d.createDocumentFragment();
  const label = d.createElement('p');
  label.className = 'ui-confirm__body';
  const displayName = typeof it.title === 'string' && it.title !== '' ? it.title : 'this file';
  label.textContent = `Move "${displayName}" to:`;
  body.appendChild(label);

  const field = U.select({
    label: 'Folder',
    options: list.length ? list.map((f) => ({ value: f, label: f })) : [{ value: '', label: 'No folders configured' }],
    doc: d,
  });
  const select = field.select;
  body.appendChild(field.el);

  const statusEl = d.createElement('p');
  statusEl.className = 'ui-confirm__body move-dialog__status';
  statusEl.setAttribute('aria-live', 'polite');
  body.appendChild(statusEl);

  const actions = d.createElement('div');
  actions.className = 'ui-confirm__actions';
  const cancelBtn = U.button({ variant: 'secondary', label: 'Cancel', doc: d });
  // Starts disabled when there is nothing to move into (no configured folders).
  const moveBtn = U.button({ variant: 'primary', label: 'Move', disabled: list.length === 0, doc: d });
  actions.appendChild(cancelBtn);
  actions.appendChild(moveBtn);
  body.appendChild(actions);

  let busy = false;
  const ctrl = U.sheet({ variant: 'dialog', title: 'Move to…', content: body, canDismiss: () => !busy, doc: d, win });

  function setBusy(nextBusy) {
    busy = nextBusy;
    moveBtn.disabled = nextBusy || list.length === 0;
    cancelBtn.disabled = nextBusy;
    if (U.setBusy) U.setBusy(moveBtn, nextBusy);
  }
  function teardown() { ctrl.close(); }

  cancelBtn.addEventListener('click', () => {
    if (busy) return;
    teardown();
  });
  moveBtn.addEventListener('click', () => {
    if (busy || moveBtn.disabled || !ctrl.isOpen()) return;
    const target = select.value;
    if (!target) {
      statusEl.textContent = 'Choose a folder first.';
      return;
    }
    // F2: arm the busy guard BEFORE calling out -- onMove's request is async.
    setBusy(true);
    if (typeof onMove === 'function') onMove(target, { teardown, statusEl, reenable: () => setBusy(false) });
  });

  ctrl.open();
  // After open(): ui.sheet sets the sheet's variant classes on open, replacing any set before.
  ctrl.el.classList.add('move-dialog');
  return {
    sheet: ctrl.el, modal: ctrl.el, title: ctrl.el.querySelector('.ui-sheet__title'),
    body: ctrl.body, label, select, statusEl, cancelBtn, moveBtn, teardown,
  };
}

// Pocket menus gate r1 K2 (qa W1 + adversary W2): the ONE "the library changed under you" seam.
// A writer that changes what the music library lists (a chapter save - the editor below on every
// surface, and any future chapter writer such as a snap-to-silence save) raises this document
// event; a live view holding cached library lists (the music view's pocket menus) listens and
// re-loads, so a menu never shows or plays a dropped / re-timed chapter. `doc` injectable.
const LIBRARY_CHANGED_EVENT = 'filetube:library-changed';
function notifyLibraryChanged(detail, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || typeof d.dispatchEvent !== 'function') return false;
  try {
    const W = d.defaultView;
    const Ev = (W && W.CustomEvent) || (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
    if (!Ev) return false;
    d.dispatchEvent(new Ev(LIBRARY_CHANGED_EVENT, { detail: detail || {} }));
    return true;
  } catch (_) { return false; }
}

// ---- Sweep S9 (UI pass): dialogs on the ui.sheet primitive --------------------------
//
// The ui.js builders for the dialogs below: the page's window.ui, else (Node tests) the
// sibling module - the same resolver buildFilterChipRow uses.
function overlayUiLib() {
  return (typeof window !== 'undefined' && window.ui)
    || (typeof module !== 'undefined' && module.require ? module.require('./ui.js') : null);
}

/**
 * v1.34 T3 (Dean): the per-video CHAPTERS EDITOR modal -- a textarea, one
 * "0:00 Title" line per chapter (the SAME grammar the server's
 * parseChapterLines owns; the raw text is POSTed and parsed there, never
 * client-side). Clearing the textarea removes the manual list (the item
 * falls back to embedded/description chapters). Cloned from showMoveModal's
 * exact createElement/busy-guard/teardown shape above; `doc` injectable for
 * node:test. Called by player.js's chapters menu ("Edit/Add chapters…").
 * `onSaved(resolvedBody)` receives the server's re-resolved
 * `{chapters, chaptersSource}` on success.
 */
function showChaptersEditor(mediaId, initialText, onSaved, doc, opts) {
  const d = doc || document;
  const U = overlayUiLib();
  // chapter snap (2026-09-24, gate r1, adversary S8): the `version` the list was seeded with (GET
  // /api/videos/:id chaptersVersion) rides the save, so a list changed elsewhere since
  // (a snap save, a reheat) is refused by the server instead of overwritten.
  const seedVersion = opts && typeof opts.version === 'string' ? opts.version : undefined;

  // Sweep S9: a ui.sheet dialog (the one overlay primitive). v1.289's drag-safe dismiss holds
  // by construction: the scrim is a SIBLING of the sheet, so a text-selection drag that starts
  // in the textarea and releases outside clicks their common ancestor, never the scrim.
  const content = d.createElement('div');
  content.className = 'chapters-editor';

  const hint = d.createElement('p');
  hint.className = 'chapters-editor-hint';
  hint.textContent = 'One chapter per line: a timestamp then a title (e.g. "0:00 Intro"). Leave empty to remove your custom chapters.';
  content.appendChild(hint);

  const textarea = d.createElement('textarea');
  textarea.className = 'chapters-editor-textarea';
  textarea.rows = 10;
  textarea.value = typeof initialText === 'string' ? initialText : '';
  textarea.setAttribute('aria-label', 'Chapters, one "0:00 Title" line per chapter');
  content.appendChild(textarea);

  const statusEl = d.createElement('div');
  statusEl.className = 'chapters-editor-status';
  statusEl.setAttribute('aria-live', 'polite');
  content.appendChild(statusEl);

  const actionsRow = d.createElement('div');
  actionsRow.className = 'ui-confirm__actions chapters-editor-actions';

  // Chapter Snap (2026-09-24) (Dean): the text box stays for pasting a whole list; this
  // opens the SAME time editor every other entry point opens (showChapterSnapEditor),
  // seeded from storage. Offered once the item has at least two chapters; refused
  // while the textarea holds unsaved typing (switching would silently drop it).
  let snapBtn = null;
  const initialLines = (typeof initialText === 'string' ? initialText : '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (initialLines.length >= 2 && typeof showChapterSnapEditor === 'function') {
    snapBtn = U.button({ variant: 'tonal', label: 'Fix times', ariaLabel: 'Fix chapter start times in the visual editor', doc: d });
    snapBtn.classList.add('chapters-editor-snap');
    snapBtn.addEventListener('click', () => {
      if (busy) return;
      if (textarea.value !== (typeof initialText === 'string' ? initialText : '')) {
        statusEl.textContent = 'Save or undo your typed changes first, then fix the times.';
        return;
      }
      teardown();
      showChapterSnapEditor(mediaId, { onSaved, doc: doc || undefined });
    });
    actionsRow.appendChild(snapBtn);
  }

  const cancelBtn = U.button({ variant: 'secondary', label: 'Cancel', doc: d });
  cancelBtn.addEventListener('click', () => {
    if (busy) return;
    teardown();
  });
  actionsRow.appendChild(cancelBtn);

  const saveBtn = U.button({ variant: 'primary', label: 'Save', doc: d });
  saveBtn.addEventListener('click', () => {
    if (busy) return;
    setBusy(true);
    statusEl.textContent = 'Saving…';
    fetch('/api/videos/' + encodeURIComponent(mediaId) + '/chapters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(seedVersion ? { text: textarea.value, version: seedVersion } : { text: textarea.value }),
    })
      .then((res) => res.json().catch(() => ({})).then((bodyJson) => ({ ok: res.ok, bodyJson })))
      .then(({ ok, bodyJson }) => {
        if (!ok) {
          setBusy(false);
          statusEl.textContent = (bodyJson && bodyJson.error) || 'Could not save chapters.';
          return;
        }
        notifyLibraryChanged({ kind: 'chapters', mediaId: mediaId }, d); // the chapter list changed under any live library view
        if (typeof onSaved === 'function') onSaved(bodyJson);
        teardown();
      })
      .catch(() => {
        setBusy(false);
        statusEl.textContent = 'Could not save chapters (network error).';
      });
  });
  actionsRow.appendChild(saveBtn);
  content.appendChild(actionsRow);

  let busy = false;
  function setBusy(nextBusy) {
    busy = nextBusy;
    saveBtn.disabled = nextBusy;
    cancelBtn.disabled = nextBusy;
    if (snapBtn) snapBtn.disabled = nextBusy;
  }

  // A save in flight is never dismissed out from under its status line: Esc, the scrim
  // and Close all stand down while busy (the v1.26.2 busy guard, kept, via canDismiss).
  const sheet = U.sheet({
    variant: 'dialog', title: 'Edit chapters', content, initialFocus: textarea,
    canDismiss: () => !busy,
    doc: d, win: d.defaultView,
  });

  function teardown() {
    sheet.close();
  }

  sheet.open();

  return { sheet, backdrop: sheet.scrim, modal: sheet.el, textarea, statusEl, cancelBtn, saveBtn, snapBtn, teardown };
}

// ---- Chapter Snap (2026-09-24) (Dean 2026-09-24): the chapter TIME editor ---------
//
// ONE component, opened from four places (the Music album drill, the now-playing
// "This chapter starts wrong", the watch page's chapters list, and the text
// chapters editor above) - never a per-surface copy. It fixes WHEN chapters
// start, never what they are: no add, remove, reorder or rename (likes and
// progress are keyed `<mediaId>::c<n>`).
//
// Seeded from STORAGE: every open fetches GET /api/videos/:id/chapter-snap (the
// persisted record, not any list on screen), and every save/revert carries the
// `version` it was seeded with - the server refuses a record that changed since.
// Phone first: every control is a real button (>= 44px on phones, style.css
// .chapter-snap-*), nothing is drag-only, and the list scrolls inside a
// full-height sheet at phone widths.

// chapter snap (2026-09-24, gate r1, adversary W1): the text chapters editor's SEED stamp - LOSSLESS.
// Whole seconds read exactly as formatDuration writes them ("1:05", "1:02:05");
// a start with a fraction keeps it to the millisecond ("1:01.75"), which the
// server's editor grammar (server.js parseManualChapterText) reads back. Flooring
// here turned a title-only fix of a snap edit into a rewrite of every time, and
// two starts 0.7 s apart into ONE chapter (a like re-pointed). music.js
// chapterStamp mirrors this (parity-tested).
function formatChapterStamp(seconds) {
  let s = Number(seconds);
  if (!isFinite(s) || s <= 0) return '0:00';
  s = Math.round(s * 1000) / 1000;
  const whole = Math.floor(s);
  const ms = Math.round((s - whole) * 1000);
  const base = formatDuration(whole);
  return ms > 0 ? base + '.' + String(ms).padStart(3, '0').replace(/0+$/, '') : base;
}

// m:ss.s (h:mm:ss.s past an hour) - tenths are what a nudge moves.
function formatSnapTime(sec) {
  let s = Number(sec);
  if (!isFinite(s) || s < 0) s = 0;
  const tenths = Math.round(s * 10);
  const h = Math.floor(tenths / 36000);
  const m = Math.floor((tenths % 36000) / 600);
  const r = (tenths % 600) / 10;
  const rs = (r < 10 ? '0' : '') + r.toFixed(1);
  return h > 0 ? h + ':' + (m < 10 ? '0' : '') + m + ':' + rs : m + ':' + rs;
}

// Where a nudge of `delta` seconds lands for chapter `i`: rounded to the
// millisecond and kept strictly between its neighbours (a MIN gap either side)
// and before the end of the file. Chapter 1 never moves. Pure.
function clampSnapNudge(times, i, delta, durationSec, minGapSec) {
  if (!Array.isArray(times) || i <= 0 || i >= times.length) return null;
  // The gap is the SERVER's MIN_CHAPTER_GAP_SEC (the editor state carries it,
  // gate r1 qa S7); 0.1 only when a caller has no state.
  const GAP = typeof minGapSec === 'number' && isFinite(minGapSec) && minGapSec > 0 ? minGapSec : 0.1;
  let t = Math.round((Number(times[i]) + Number(delta)) * 1000) / 1000;
  const lo = Number(times[i - 1]) + GAP;
  let hi = i + 1 < times.length ? Number(times[i + 1]) - GAP : (Number(durationSec) > 0 ? Number(durationSec) - GAP : Infinity);
  if (hi < lo) hi = lo;
  if (t < lo) t = Math.round(lo * 1000) / 1000;
  if (t > hi) t = Math.round(hi * 1000) / 1000;
  return t;
}

// The one-line explanation under a chapter. Pure (the jsdom test and the
// render share it). `row` = {time, sourceStart}, `sug` = the server suggestion.
function snapChipText(i, row, sug, silenceState) {
  if (i === 0) return { text: 'First chapter, always stays put', kind: 'fine' };
  const moved = Math.abs(row.time - row.sourceStart) >= 0.05;
  if (moved) {
    const d = row.time - row.sourceStart;
    return { text: (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1) + 's from the source time', kind: 'moved' };
  }
  if (silenceState !== 'ready' || !sug) return { text: '', kind: '' };
  if (sug.status === 'suggest') {
    if (sug.reason === 'silence') return { text: 'Starts in ' + Math.max(0.1, (sug.silenceEnd - row.time)).toFixed(1) + 's of silence', kind: 'hint' };
    if (sug.reason === 'tail') return { text: 'Starts in the end of the previous song', kind: 'hint' };
    return { text: 'Starts after the music begins', kind: 'hint' };
  }
  if (sug.status === 'fine') return { text: 'Starts right where the music does', kind: 'fine' };
  return { text: 'No gap found near this start. Nudge it if it sounds wrong.', kind: 'fine' };
}

// ---- Shift all (Dean 2026-09-24): "a global offset ... the whole track is offset by a
// somewhat equivalent amount. It's not the same for everything." One control moves EVERY
// chapter after the first by the same amount (chapter 1 keeps its start), and the silence
// the editor already found says whether the file looks like a whole-track offset at all.
// Pure helpers (the editor and the unit tests share them). Times are handled in whole
// MILLISECONDS so a shift and its reset cancel exactly.

// The agreement rule for a suggested shift: at least SNAP_SHIFT_MIN_BOUNDARIES boundaries
// with a snap point, and at least 60 % of them each within SNAP_SHIFT_AGREE_SEC of the median
// (for an even count the median is the midpoint of the middle two, so two boundaries up to
// 0.6 s apart can both agree).
const SNAP_SHIFT_AGREE_SEC = 0.3;
const SNAP_SHIFT_AGREE_TENTHS = 6; // 60 %, compared in integers (agree * 10 >= of * 6)
const SNAP_SHIFT_MIN_BOUNDARIES = 2;
// Below this the chapters already sit on the silence: nothing to suggest.
const SNAP_SHIFT_ALIGNED_SEC = 0.05;

// "+2.3 s", "−1.75 s" (the nudges' minus sign). Whole milliseconds in.
function formatSnapShift(ms) {
  const n = Math.round(Number(ms)) || 0;
  let s = (Math.abs(n) / 1000).toFixed(3).replace(/0+$/, '');
  if (s.endsWith('.')) s += '0';
  return (n < 0 ? '−' : '+') + s + ' s';
}

// Whether moving chapters 2..N by `deltaMs` keeps the list valid. Every one of them moves
// by the same amount, so only the two ends can break: chapter 2 must stay after chapter
// 1's start plus the minimum gap, and the last chapter before the end of the file minus
// the gap. `minGapSec` and `durationSec` are the SERVER's (the editor state carries them).
// `stored` (the saved starts, optional): a SOURCE list may already hold chapter 2 within the
// gap of chapter 1, or the last chapter within the gap of the end - a shift may always go back
// to (or past) what the saved list has, so an end is refused only when it lands inside the gap
// AND closer than it is in the saved list (gate r2, qa 1 / adversary 2).
// Returns { ok: true } or { ok: false, dir: 'earlier' | 'later', reason }.
function snapShiftBlock(times, deltaMs, durationSec, minGapSec, stored) {
  if (!Array.isArray(times) || times.length < 2) return { ok: false, dir: '', reason: 'There are no chapters after the first to shift.' };
  const d = Math.round(Number(deltaMs)) || 0;
  const gapMs = Math.round((typeof minGapSec === 'number' && isFinite(minGapSec) && minGapSec > 0 ? minGapSec : 0.1) * 1000);
  const ms = (x) => Math.round(Number(x) * 1000);
  const last = times.length - 1;
  const saved = Array.isArray(stored) && stored.length === times.length ? stored : null;
  const newFirst = ms(times[1]) + d - ms(times[0]);
  const savedFirst = saved ? ms(saved[1]) - ms(saved[0]) : Infinity;
  if (d < 0 && newFirst <= gapMs && newFirst < savedFirst) return { ok: false, dir: 'earlier', reason: 'Shifting earlier would put chapter 2 at or before chapter 1.' };
  const dur = Number(durationSec);
  if (d > 0 && isFinite(dur) && dur > 0) {
    const newEnd = ms(dur) - (ms(times[last]) + d);
    const savedEnd = saved ? ms(dur) - ms(saved[last]) : Infinity;
    if (newEnd <= gapMs && newEnd < savedEnd) return { ok: false, dir: 'later', reason: 'Shifting later would put the last chapter at or past the end of the file.' };
  }
  return { ok: true };
}

// Where an edit breaks the server's minimum gap (the editor state's `minGapSec`, i.e.
// lib/media/chapterSnap.js MIN_CHAPTER_GAP_SEC). `next` = the times after the edit, `before` =
// the times on screen before it, `stored` = the saved starts. A pair breaks only when the edit
// NARROWS it (closer than `before`), into the gap (closer than the minimum; exactly the gap is
// fine, as the nudge clamp allows), AND closer than the saved list has that pair - so a close pair
// that came from the SOURCE, or that the edit does not touch, is never this edit's to refuse
// (gate r2, qa 1 / adversary 2). The last start against the end of the file follows the same
// three conditions. `before` / `stored` may be null (that condition is then not applied). Returns
// null or { index, end } (end = the last row against the end of the file). Pure; shared by Reset
// shift, the per-row Snap and Snap all.
function snapGapBreak(next, before, stored, durationSec, minGapSec) {
  const n = Array.isArray(next) ? next : [];
  const gapMs = Math.round((typeof minGapSec === 'number' && isFinite(minGapSec) && minGapSec > 0 ? minGapSec : 0.1) * 1000);
  const ms = (a) => (Array.isArray(a) && a.length === n.length ? a.map((x) => Math.round(Number(x) * 1000)) : null);
  const nm = ms(n);
  const bm = ms(before);
  const sm = ms(stored);
  for (let i = 1; i < nm.length; i += 1) {
    const g = nm[i] - nm[i - 1];
    if (g < gapMs && (!sm || g < sm[i] - sm[i - 1]) && (!bm || g < bm[i] - bm[i - 1])) return { index: i, end: false };
  }
  const last = nm.length - 1;
  const dur = Number(durationSec);
  if (last >= 1 && isFinite(dur) && dur > 0) {
    const durMs = Math.round(dur * 1000);
    const e = durMs - nm[last];
    if (e < gapMs && (!sm || e < durMs - sm[last]) && (!bm || e < durMs - bm[last])) return { index: last, end: true };
  }
  return null;
}

// The shift the silence suggests, measured from the CURRENT times. A boundary counts when
// the scan found a snap point near it (a server suggestion of status 'suggest' OR 'fine' -
// a boundary that already sits on its silence is evidence against an offset too, so it
// must count). delta = snap point - current start. Returns
//   { kind: 'suggest', deltaMs, agree, of }  - a whole-track offset (apply deltaMs)
//   { kind: 'aligned', agree, of }           - they agree and already line up
//   { kind: 'none', agree, of }              - no consistent offset (real misalignment)
//   { kind: 'few', agree: 0, of }            - fewer than two boundaries to compare
function snapShiftSuggestion(times, suggestions) {
  const deltas = [];
  const t = Array.isArray(times) ? times : [];
  const sug = Array.isArray(suggestions) ? suggestions : [];
  for (let i = 1; i < t.length; i += 1) {
    const s = sug[i];
    if (!s || (s.status !== 'suggest' && s.status !== 'fine')) continue;
    const at = Number(s.time);
    const cur = Number(t[i]);
    if (!isFinite(at) || !isFinite(cur)) continue;
    deltas.push(Math.round(at * 1000) - Math.round(cur * 1000));
  }
  const of = deltas.length;
  if (of < SNAP_SHIFT_MIN_BOUNDARIES) return { kind: 'few', agree: 0, of };
  const sorted = deltas.slice().sort((a, b) => a - b);
  const mid = Math.floor(of / 2);
  const median = of % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const tol = Math.round(SNAP_SHIFT_AGREE_SEC * 1000);
  const agree = deltas.filter((x) => Math.abs(x - median) <= tol).length;
  // (With of >= 2, the 60 % share alone already means at least two agree.)
  if (agree * 10 < of * SNAP_SHIFT_AGREE_TENTHS) return { kind: 'none', agree, of };
  if (Math.abs(median) < SNAP_SHIFT_ALIGNED_SEC * 1000) return { kind: 'aligned', agree, of };
  return { kind: 'suggest', deltaMs: median, agree, of };
}

/**
 * Open the chapter time editor for `mediaId`. `opts`:
 *   focusIndex - the chapter to scroll to and highlight (now playing's current)
 *   onSaved(body) - after a save or revert, with the server's
 *                   `{chapters, chaptersSource, chaptersEdited, version}`
 *   doc, fetchImpl, audioFactory, pollMs - injectable for node:test
 * Returns a handle ({ backdrop, modal, close, ready }) for tests.
 */
function showChapterSnapEditor(mediaId, opts) {
  const o = opts || {};
  const d = o.doc || document;
  const doFetch = o.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const pollMs = typeof o.pollMs === 'number' ? o.pollMs : 1500;
  const base = '/api/videos/' + encodeURIComponent(mediaId) + '/chapter-snap';
  const U = overlayUiLib();

  let state = null; // the server's editor state (seed)
  let rows = [];    // [{index, title, sourceStart, savedStart, time, shift}] - `shift` = the whole ms
                    // the Shift all control has added to THIS row's time (a snap clears it)
  let busy = false;
  let closed = false;
  let pollTimer = null;
  let audio = null;
  let auditionTimer = null;
  let auditionIndex = -1;
  let focusIndex = typeof o.focusIndex === 'number' ? o.focusIndex : -1;
  let staleSeed = false;

  function el(tag, cls, text) {
    const n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // Step 7 (UI pass): every control here is a ui-btn. `spec` is the variant ('primary' - the
  // one filled action of a group - or 'secondary') followed by the chapter-snap-* hook classes;
  // md is the desktop control height and 44 on a phone (the phone / short-screen arm below
  // floors every one of them at the touch size). The label lives in the button's
  // .ui-btn__label (setLabel), never as bare text, so a relabel keeps the primitive's box.
  function setLabel(b, text) {
    let l = b.querySelector('.ui-btn__label');
    if (!l) { l = el('span', 'ui-btn__label'); b.appendChild(l); }
    l.textContent = text == null ? '' : String(text);
  }
  function btn(spec, text, label) {
    const hooks = spec.split(' ');
    const variant = hooks.shift();
    const b = el('button', 'ui-btn ui-btn--' + variant + ' ui-btn--md ' + hooks.join(' '));
    b.type = 'button';
    setLabel(b, text);
    if (label) b.setAttribute('aria-label', label);
    return b;
  }

  // Sweep S9: the SHELL is a ui.sheet dialog titled "Fix chapter times" (wide on desktop,
  // the full screen on a phone - style.css `:has(.chapter-snap-editor)`); `modal` is its
  // content: the head, the one scrolling list, the pinned actions.
  const modal = el('div', 'chapter-snap-editor');

  const head = el('div', 'chapter-snap-head');
  const titleRow = el('div', 'chapter-snap-titlerow');
  const badge = el('span', 'ui-chip ui-chip--meta chapter-snap-badge', 'Edited'); // step 7: a meta chip (status, not a control)
  badge.hidden = true;
  titleRow.appendChild(badge);
  head.appendChild(titleRow);
  const sub = el('div', 'chapter-snap-sub', '');
  head.appendChild(sub);
  const statusEl = el('div', 'chapter-snap-status', 'Loading chapters…');
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  head.appendChild(statusEl);
  const tools = el('div', 'chapter-snap-tools');
  const snapAllBtn = btn('primary chapter-snap-snapall', 'Snap all');
  const undoBtn = btn('secondary chapter-snap-undo', 'Undo changes');
  const revertBtn = btn('secondary chapter-snap-revert', 'Revert to source chapters');
  const retryBtn = btn('secondary chapter-snap-retry', 'Try again');
  revertBtn.hidden = true;
  retryBtn.hidden = true;
  tools.appendChild(snapAllBtn);
  tools.appendChild(undoBtn);
  tools.appendChild(revertBtn);
  tools.appendChild(retryBtn);
  head.appendChild(tools);
  // The in-page confirm (never window.confirm): revert, discard, reload.
  const confirmBox = el('div', 'chapter-snap-confirm');
  confirmBox.hidden = true;
  const confirmText = el('p', 'chapter-snap-confirm-text', '');
  const confirmActs = el('div', 'chapter-snap-confirm-actions');
  const confirmYes = btn('primary chapter-snap-confirm-yes', 'Revert');
  const confirmNo = btn('secondary chapter-snap-confirm-no', 'Keep my corrections');
  confirmActs.appendChild(confirmYes);
  confirmActs.appendChild(confirmNo);
  confirmBox.appendChild(confirmText);
  confirmBox.appendChild(confirmActs);
  head.appendChild(confirmBox);
  modal.appendChild(head);

  const scroller = el('div', 'chapter-snap-scroll');
  // Shift all (Dean 2026-09-24): the top row of the list - every chapter after the first
  // moves by the same amount; the net shift reads out live; the silence says whether the
  // file looks like a whole-track offset. It scrolls with the rows (phone-first: the head
  // stays short so the list keeps its room).
  const shiftBox = el('section', 'chapter-snap-shift');
  shiftBox.setAttribute('aria-label', 'Shift all chapters');
  shiftBox.hidden = true;
  const shiftTop = el('div', 'chapter-snap-shift-top');
  shiftTop.appendChild(el('span', 'chapter-snap-shift-label', 'Shift all'));
  const shiftReadoutEl = el('span', 'chapter-snap-shift-readout', 'No shift');
  shiftReadoutEl.setAttribute('aria-live', 'polite');
  shiftTop.appendChild(shiftReadoutEl);
  const shiftResetBtn = btn('secondary chapter-snap-shift-reset', 'Reset shift', 'Reset the shift (your nudges stay)');
  shiftResetBtn.setAttribute('data-shift-act', 'reset');
  shiftResetBtn.hidden = true;
  shiftTop.appendChild(shiftResetBtn);
  shiftBox.appendChild(shiftTop);
  const shiftBtnsEl = el('div', 'chapter-snap-nudges chapter-snap-shift-btns');
  const shiftStepBtns = [[-1000, '−1 s', 'earlier by 1 second'], [-100, '−0.1 s', 'earlier by a tenth of a second'], [100, '+0.1 s', 'later by a tenth of a second'], [1000, '+1 s', 'later by 1 second']].map(function (n) {
    const b = btn('secondary chapter-snap-nudge chapter-snap-shift-btn', n[1], 'Shift every chapter after the first ' + n[2]);
    b.setAttribute('data-shift-act', 'step');
    b.setAttribute('data-shift', String(n[0]));
    shiftBtnsEl.appendChild(b);
    return b;
  });
  shiftBox.appendChild(shiftBtnsEl);
  const shiftWhy = el('div', 'chapter-snap-shift-why', '');
  shiftWhy.hidden = true;
  shiftBox.appendChild(shiftWhy);
  const shiftSuggestEl = el('div', 'chapter-snap-shift-suggest');
  shiftSuggestEl.hidden = true;
  const shiftApplyBtn = btn('primary chapter-snap-shift-apply', '');
  shiftApplyBtn.setAttribute('data-shift-act', 'apply');
  shiftApplyBtn.hidden = true;
  const shiftNote = el('span', 'chapter-snap-shift-note', '');
  shiftSuggestEl.appendChild(shiftApplyBtn);
  shiftSuggestEl.appendChild(shiftNote);
  shiftBox.appendChild(shiftSuggestEl);
  scroller.appendChild(shiftBox);
  const list = el('ol', 'chapter-snap-list');
  list.setAttribute('aria-label', 'Chapters');
  scroller.appendChild(list);
  modal.appendChild(scroller);

  const actions = el('div', 'modal-actions chapter-snap-actions');
  const cancelBtn = btn('secondary chapter-snap-cancel', 'Cancel');
  const saveBtn = btn('primary chapter-snap-save', 'Save');
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  modal.appendChild(actions);

  function setStatus(msg) { statusEl.textContent = msg || ''; }
  function dirty() { return rows.some((r) => Math.abs(r.time - r.savedStart) >= 0.0005); }
  function times() { return rows.map((r) => r.time); }
  function suggestionFor(i) { return state && Array.isArray(state.suggestions) ? state.suggestions[i] || null : null; }
  function silenceState() { return state && state.silence ? state.silence.state : 'none'; }
  // chapter snap (2026-09-24, gate r1, qa W1): "Snap all" is ONE plan, counted and applied from the
  // same function. It touches only rows that have a server suggestion AND are still
  // at their saved time - a row the user nudged or snapped by hand is theirs - and
  // each snapped time must stay at least the minimum gap inside the CURRENT neighbours (a nudged
  // neighbour included), checked in order so the result is strictly increasing.
  function snapAllPlan() {
    const plan = [];
    if (!state || !Array.isArray(state.snapAll) || !Array.isArray(state.suggestions)) return plan;
    const t = times();
    for (let i = 1; i < rows.length; i += 1) {
      const sug = state.suggestions[i];
      if (!sug || sug.status !== 'suggest') continue;
      // hand-edited: leave it. A row moved ONLY by Shift all is not hand-edited (Dean: Snap all
      // after a shift still snaps to the silence, absolute), so its shift is allowed for.
      if (Math.abs(rows[i].time - (rows[i].savedStart + rows[i].shift / 1000)) >= 0.0005) continue;
      const target = state.snapAll[i];
      if (!(Math.abs(target - rows[i].time) >= 0.0005)) continue;
      // At least the server's minimum gap from the CURRENT neighbours (and the end of the
      // file), the rule the nudges, the shift and Reset keep too (gate r1, adversary 4 / qa S3).
      const tt = t.slice();
      tt[i] = target;
      if (snapGapBreak(tt, t, savedTimes(), state.duration, state.minGapSec)) continue;
      t[i] = target;
      plan.push([i, target]);
    }
    return plan;
  }
  function pendingSnaps() { return snapAllPlan().length; }

  // ---- rendering ------------------------------------------------------------
  function renderHead() {
    const s = state;
    badge.hidden = !(s && s.edited);
    const srcLabel = s ? ({ embedded: 'chapters from the file', description: 'chapters from the description', manual: s.edited ? 'corrected chapters' : 'your typed chapters' }[s.chaptersSource] || 'chapters') : '';
    sub.textContent = s ? [(s.title || ''), rows.length + ' chapters', srcLabel].filter(Boolean).join(' · ') : '';
    const pending = pendingSnaps();
    setLabel(snapAllBtn, pending > 0 ? 'Snap all (' + pending + ')' : 'Snap all');
    snapAllBtn.disabled = busy || staleSeed || pending === 0;
    undoBtn.disabled = busy || !dirty();
    revertBtn.hidden = !(s && s.edited);
    revertBtn.disabled = busy || staleSeed;
    saveBtn.disabled = busy || staleSeed || !dirty();
    cancelBtn.disabled = busy;
    renderShift();
  }

  // ---- Shift all -----------------------------------------------------------------
  // The times a Reset would restore: each row minus exactly what the shift added to IT
  // (a nudge made after the shift stays; a row snapped since carries no shift). null when
  // no row carries a shift.
  // Times are kept to the MICROSECOND (not the millisecond) so a start stored on a half
  // millisecond (120.0005) comes back exactly after Shift + Reset, and whole-ms steps never
  // accumulate float drift (gate r1, adversary 6).
  function micro(x) { return Math.round(x * 1e6) / 1e6; }
  function savedTimes() { return rows.map(function (r) { return r.savedStart; }); }
  function gapText() { return formatSnapShift(Math.round(((state && state.minGapSec) || 0.1) * 1000)).slice(1); }
  function shiftResetTimes() {
    if (!rows.some(function (r) { return r.shift !== 0; })) return null;
    return rows.map(function (r) { return micro(r.time - r.shift / 1000); });
  }
  // A reset is refused when a row it moves would land before, on, or closer than the server's
  // minimum gap to its neighbour (a row snapped or nudged since can be in the way), or the last
  // one within the gap of the end of the file (gate r1: adversary 3 + 4, qa S3).
  function shiftResetProblem(t) {
    const brk = snapGapBreak(t, times(), savedTimes(), state && state.duration, state && state.minGapSec);
    if (!brk) return '';
    if (brk.end) return 'Resetting would put the last chapter at or past the end of the file, or within ' + gapText() + ' of it and closer than your saved chapters have it. Use Undo changes to start over.';
    return 'Resetting would put chapter ' + (brk.index + 1) + ' at or before chapter ' + brk.index + ', or within ' + gapText() + ' of it and closer than your saved chapters have them. Use Undo changes to start over.';
  }
  function shiftReadout() {
    const after = rows.slice(1);
    const moved = after.filter(function (r) { return r.shift !== 0; });
    if (moved.length === 0) return 'No shift';
    const same = moved.every(function (r) { return r.shift === moved[0].shift; });
    if (same && moved.length === after.length) return 'All chapters shifted ' + formatSnapShift(moved[0].shift);
    if (same) return 'Shifted ' + formatSnapShift(moved[0].shift) + ' on ' + moved.length + ' of ' + after.length + ' chapters (the others carry no shift)';
    return 'Shifted on ' + moved.length + ' of ' + after.length + ' chapters, by different amounts (some were snapped between shifts)';
  }
  function renderShift() {
    const on = !!state && rows.length >= 2;
    shiftBox.hidden = !on;
    if (!on) return;
    const t = times();
    const lock = busy || staleSeed;
    const reasons = [];
    shiftStepBtns.forEach(function (b) {
      const blk = snapShiftBlock(t, Number(b.getAttribute('data-shift')), state.duration, state.minGapSec, savedTimes());
      b.disabled = lock || !blk.ok;
      if (!blk.ok && reasons.indexOf(blk.reason) === -1) reasons.push(blk.reason);
    });
    // A polite live region: written only when the words change, so a screen reader announces a
    // new shift, not every re-render (gate r1, qa S4).
    const readout = shiftReadout();
    if (shiftReadoutEl.textContent !== readout) shiftReadoutEl.textContent = readout;
    const rt = shiftResetTimes();
    shiftResetBtn.hidden = !rt;
    const rp = rt ? shiftResetProblem(rt) : '';
    shiftResetBtn.disabled = lock || !!rp;
    if (rp) reasons.push(rp);
    // The suggestion, from the silence already found (no new scan).
    shiftApplyBtn.hidden = true;
    shiftApplyBtn.removeAttribute('data-shift');
    shiftNote.textContent = '';
    if (silenceState() === 'ready' && Array.isArray(state.suggestions)) {
      const g = snapShiftSuggestion(t, state.suggestions);
      if (g.kind === 'suggest') {
        shiftApplyBtn.hidden = false;
        setLabel(shiftApplyBtn, 'Suggested: shift all by ' + formatSnapShift(g.deltaMs) + ' (' + g.agree + ' of ' + g.of + ' agree)');
        shiftApplyBtn.setAttribute('data-shift', String(g.deltaMs));
        const blk = snapShiftBlock(t, g.deltaMs, state.duration, state.minGapSec, savedTimes());
        shiftApplyBtn.disabled = lock || !blk.ok;
        if (!blk.ok && reasons.indexOf(blk.reason) === -1) reasons.push(blk.reason);
      } else if (g.kind === 'aligned') {
        // Only when EVERY boundary agrees do "the chapters" line up; a majority on the silence
        // with the rest off is real misalignment, not a whole-track offset (gate r1, qa W1).
        shiftNote.textContent = g.agree === g.of
          ? 'The chapters line up with the silence (' + g.agree + ' of ' + g.of + ' agree).'
          : 'No whole-track offset: ' + g.agree + ' of ' + g.of + ' already line up. Fix the others one by one.';
      } else if (g.kind === 'few') {
        shiftNote.textContent = 'No consistent offset (too few gaps to compare).';
      } else {
        shiftNote.textContent = 'No consistent offset: the chapters are off by different amounts. Fix them one by one.';
      }
    }
    shiftSuggestEl.hidden = shiftApplyBtn.hidden && !shiftNote.textContent;
    shiftWhy.textContent = reasons.join(' ');
    shiftWhy.hidden = reasons.length === 0;
  }
  // Move chapters 2..N by `deltaMs` (chapter 1 keeps its start). Refused - with the reason -
  // when it would break the order; renderShift already disables such a button.
  function applyShift(deltaMs) {
    const d = Math.round(Number(deltaMs)) || 0;
    if (!d || busy || staleSeed || rows.length < 2) return;
    const blk = snapShiftBlock(times(), d, state && state.duration, state && state.minGapSec, savedTimes());
    if (!blk.ok) { setStatus(blk.reason); return; }
    for (let i = 1; i < rows.length; i += 1) {
      rows[i].time = micro(rows[i].time + d / 1000);
      rows[i].shift += d;
    }
    if (auditionIndex > 0) stopAudition();
    renderList();
    setStatus('Moved every chapter after the first ' + formatSnapShift(d) + '. Play one to check, then Save.');
  }
  function resetShift() {
    if (busy || staleSeed) return;
    const t = shiftResetTimes();
    if (!t) return;
    const problem = shiftResetProblem(t);
    if (problem) { setStatus(problem); return; }
    rows.forEach(function (r, i) { r.time = t[i]; r.shift = 0; });
    if (auditionIndex > 0) stopAudition();
    renderList();
    setStatus('The shift is gone. Your other changes stay.');
  }
  shiftBox.addEventListener('click', function (e) {
    const b = e.target && e.target.closest ? e.target.closest('button[data-shift-act]') : null;
    if (!b || b.disabled || busy) return;
    if (b.getAttribute('data-shift-act') === 'reset') { resetShift(); return; }
    applyShift(Number(b.getAttribute('data-shift')));
  });

  function renderRow(li, i) {
    const r = rows[i];
    while (li.firstChild) li.removeChild(li.firstChild);
    const sug = suggestionFor(i);
    const moved = Math.abs(r.time - r.sourceStart) >= 0.05;
    li.className = 'chapter-snap-item' + (moved ? ' is-moved' : '') + (i === focusIndex ? ' is-focus' : '') + (auditionIndex === i ? ' is-playing' : '');
    li.setAttribute('data-index', String(i));
    const top = el('div', 'chapter-snap-rowtop');
    top.appendChild(el('span', 'chapter-snap-n', String(i + 1)));
    top.appendChild(el('span', 'chapter-snap-name', r.title || ('Chapter ' + (i + 1))));
    const tm = el('span', 'chapter-snap-times');
    tm.appendChild(el('span', 'chapter-snap-now', formatSnapTime(r.time)));
    if (moved) tm.appendChild(el('span', 'chapter-snap-was', 'was ' + formatSnapTime(r.sourceStart)));
    top.appendChild(tm);
    li.appendChild(top);
    const chip = snapChipText(i, r, sug, silenceState());
    if (chip.text) li.appendChild(el('div', 'chapter-snap-note chapter-snap-note--' + chip.kind, chip.text));
    const ctl = el('div', 'chapter-snap-ctl');
    if (i > 0) {
      if (sug && sug.status === 'suggest' && Math.abs(sug.time - r.time) >= 0.0005) {
        const sb = btn('primary chapter-snap-snapone', 'Snap to ' + formatSnapTime(sug.time), 'Snap chapter ' + (i + 1) + ' to ' + formatSnapTime(sug.time));
        sb.setAttribute('data-act', 'snap');
        ctl.appendChild(sb);
      }
      const nudges = el('div', 'chapter-snap-nudges');
      [[-1, '−1s', 'earlier by 1 second'], [-0.1, '−0.1', 'earlier by a tenth of a second'], [0.1, '+0.1', 'later by a tenth of a second'], [1, '+1s', 'later by 1 second']].forEach(function (n) {
        const b = btn('secondary chapter-snap-nudge', n[1], 'Move chapter ' + (i + 1) + ' ' + n[2]);
        b.setAttribute('data-act', 'nudge');
        b.setAttribute('data-delta', String(n[0]));
        nudges.appendChild(b);
      });
      ctl.appendChild(nudges);
    }
    const playing = auditionIndex === i;
    const pb = btn('secondary chapter-snap-play', playing ? 'Stop' : 'Play from here', (playing ? 'Stop playing chapter ' : 'Play chapter ') + (i + 1) + ' from ' + formatSnapTime(r.time));
    pb.setAttribute('data-act', 'play');
    if (!playing && U && typeof U.icon === 'function') {
      // the registry glyph in the primitive's icon slot (it was the .icon-play mask)
      const slot = el('span', 'ui-btn__icon');
      slot.appendChild(U.icon('play_arrow', { doc: d }));
      pb.insertBefore(slot, pb.firstChild);
    }
    pb.disabled = busy;
    ctl.appendChild(pb);
    li.appendChild(ctl);
    Array.prototype.forEach.call(ctl.querySelectorAll('button'), function (b) { if (busy || (staleSeed && b.getAttribute('data-act') !== 'play')) b.disabled = true; });
  }

  // v1.341.1 (Dean, desktop, Music "Fix times"): a nudge re-renders the rows, which destroyed
  // the button that had focus, and Chrome then scrolled the list back toward the top (1200 ->
  // 21 -> 0 px over two nudges). A re-render now keeps the reader's place: the list's scroll
  // position, and focus on the same control of the same row (keyboard users kept losing it too).
  function keepPlace(render) {
    const top = scroller.scrollTop;
    const a = d.activeElement;
    let key = null;
    if (a && list.contains(a) && a.closest) {
      const li = a.closest('.chapter-snap-item');
      if (li) key = { i: li.getAttribute('data-index'), act: a.getAttribute('data-act'), delta: a.getAttribute('data-delta') };
    }
    render();
    if (key && key.act) {
      const sel = '.chapter-snap-item[data-index="' + key.i + '"] button[data-act="' + key.act + '"]' + (key.delta != null ? '[data-delta="' + key.delta + '"]' : '');
      const b = list.querySelector(sel);
      if (b && !b.disabled) { try { b.focus({ preventScroll: true }); } catch (_) { /* old engines */ } }
    }
    if (scroller.scrollTop !== top) scroller.scrollTop = top;
  }
  function renderList() {
    keepPlace(function () {
      while (list.firstChild) list.removeChild(list.firstChild);
      rows.forEach(function (_, i) {
        const li = el('li', 'chapter-snap-item');
        renderRow(li, i);
        list.appendChild(li);
      });
    });
    renderHead();
  }
  function rerenderRow(i) {
    const li = list.children[i];
    if (li) keepPlace(function () { renderRow(li, i); });
    renderHead();
  }

  // ---- seed / silence ------------------------------------------------------
  function describeSilence() {
    const s = silenceState();
    const err = state && state.silence && state.silence.error;
    retryBtn.hidden = s !== 'failed';
    if (s === 'running' || s === 'none' || s === 'stale') return 'Finding the silence between songs… You can nudge while this runs.';
    if (s === 'failed') return 'Could not find the silence: ' + (err || 'the scan failed') + ' You can still nudge each start.';
    if (s === 'unavailable') return 'The file is not available right now, so there is no silence to find. You can still nudge each start.';
    if (s === 'ready') {
      const gaps = state.silence.gaps || 0;
      if (gaps === 0) return 'No gaps found in this file (a gapless album). Nudge a start if it sounds wrong.';
      const pending = pendingSnaps();
      return pending > 0 ? pending + (pending === 1 ? ' start looks off.' : ' starts look off.') + ' Snap them, or nudge one and play it to check.' : 'Every start sits where the music does.';
    }
    return '';
  }

  function applySeed(s, keepEdits) {
    const prevTimes = keepEdits ? times() : null;
    const prevShift = keepEdits ? rows.map(function (r) { return r.shift; }) : null;
    state = s;
    rows = (s.chapters || []).map(function (c, i) {
      const keep = !!prevTimes && prevTimes.length === s.chapters.length;
      return { index: c.index, title: c.title, sourceStart: Number(c.sourceStart), savedStart: Number(c.startTime), time: keep ? prevTimes[i] : Number(c.startTime), shift: keep ? prevShift[i] : 0 };
    });
    if (focusIndex >= rows.length) focusIndex = -1;
  }

  function fetchState() {
    return doFetch(base, { headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; });
    });
  }

  function schedulePoll() {
    if (closed || pollTimer) return;
    pollTimer = setTimeout(function () {
      pollTimer = null;
      if (closed) return;
      fetchState().then(function (res) {
        if (closed || !res.ok) return;
        // A poll only refreshes the SILENCE; a record that changed meanwhile
        // (another tab, a text-editor save) makes this editor's seed stale.
        if (res.body.version !== state.version) {
          staleSeed = true;
          setStatus('These chapters changed somewhere else while this was open. Close and reopen the editor to see them.');
          renderList();
          return;
        }
        state.silence = res.body.silence;
        state.suggestions = res.body.suggestions;
        state.snapAll = res.body.snapAll;
        // gate r1 qa S5: a scan that vanished (a server restart mid-run: nothing
        // cached, nothing in flight) reads none/stale - say so and offer Try again,
        // never a "Finding the silence..." that no longer polls.
        const st = state.silence && state.silence.state;
        if (st === 'none' || st === 'stale') state.silence = { state: 'failed', error: 'The scan stopped before it finished.' };
        setStatus(describeSilence());
        renderList();
        if (silenceState() === 'running') schedulePoll();
      }).catch(function () { if (!closed) schedulePoll(); });
    }, pollMs);
  }

  function startScan() {
    return doFetch(base + '/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; }); })
      .then(function (res) {
        if (closed) return;
        if (res.status === 202 || (res.ok && res.body.state === 'running')) {
          state.silence = { state: 'running' };
          setStatus(describeSilence());
          schedulePoll();
          return;
        }
        if (res.ok && res.body.state === 'ready') { schedulePoll(); return; }
        state.silence = { state: res.status === 409 ? 'unavailable' : 'failed', error: (res.body && res.body.error) || '' };
        setStatus(res.status === 409 ? describeSilence() : ((res.body && res.body.error) || 'Could not start finding the silence.') + ' You can still nudge each start.');
        retryBtn.hidden = res.status === 409;
        renderHead();
      })
      .catch(function () { if (!closed) { setStatus('Could not start finding the silence (network error). You can still nudge each start.'); retryBtn.hidden = false; } });
  }

  function load(keepEdits) {
    setStatus('Loading chapters…');
    return fetchState().then(function (res) {
      if (closed) return;
      if (!res.ok) {
        setStatus((res.body && res.body.error) || (res.status === 403 ? 'You do not have permission to change chapters.' : 'Could not load the chapters.'));
        snapAllBtn.disabled = true; undoBtn.disabled = true; saveBtn.disabled = true;
        return;
      }
      if (!Array.isArray(res.body.chapters) || res.body.chapters.length < 2) {
        setStatus('This item needs at least two chapters to fix their times.');
        state = res.body; rows = [];
        renderList();
        saveBtn.disabled = true; snapAllBtn.disabled = true;
        return;
      }
      staleSeed = false;
      applySeed(res.body, keepEdits);
      renderList();
      setStatus(describeSilence());
      const s = silenceState();
      if (s === 'none' || s === 'stale') startScan();
      else if (s === 'running') schedulePoll();
      if (focusIndex >= 0 && list.children[focusIndex] && typeof list.children[focusIndex].scrollIntoView === 'function') {
        try { list.children[focusIndex].scrollIntoView({ block: 'center' }); } catch (_) { /* old engines */ }
      }
    }).catch(function () { if (!closed) setStatus('Could not load the chapters (network error).'); });
  }

  // ---- audition --------------------------------------------------------------
  function stopAudition() {
    if (auditionTimer) { clearTimeout(auditionTimer); auditionTimer = null; }
    if (audio) { try { audio.pause(); } catch (_) { /* gone */ } }
    const was = auditionIndex;
    auditionIndex = -1;
    if (was >= 0 && !closed) rerenderRow(was);
  }
  function pauseOtherMedia() {
    // The listener must hear the boundary, not the album playing underneath it.
    Array.prototype.forEach.call(d.querySelectorAll('audio, video'), function (m) {
      if (m !== audio && !m.paused) { try { m.pause(); } catch (_) { /* best-effort */ } }
    });
  }
  function audition(i) {
    if (auditionIndex === i) { stopAudition(); return; }
    stopAudition();
    if (!audio) {
      audio = typeof o.audioFactory === 'function' ? o.audioFactory() : d.createElement('audio');
      audio.className = 'chapter-snap-audio';
      audio.hidden = true;
      // Owned by the modal: it leaves the document with it (teardown pauses and unloads it first).
      try { if (!audio.parentNode) modal.appendChild(audio); } catch (_) { /* a detached element still plays */ }
      audio.preload = 'auto';
      audio.src = '/video/' + encodeURIComponent(mediaId);
      audio.addEventListener('error', function () {
        if (closed) return;
        setStatus('This file cannot be played here, so the start cannot be auditioned.');
        stopAudition();
      });
    }
    pauseOtherMedia();
    auditionIndex = i;
    rerenderRow(i);
    const t = rows[i].time;
    const seekAndPlay = function () {
      // gate r1 qa S6: a Stop (or another row's Play, or close) before the metadata
      // arrived cancels this pending start - never a late, timer-less playback.
      if (closed || auditionIndex !== i) return;
      try { audio.currentTime = t; } catch (_) { /* not seekable yet */ }
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(function () { if (!closed && auditionIndex === i) { setStatus('Playback was blocked. Tap Play from here again.'); stopAudition(); } });
    };
    if (audio.readyState >= 1) seekAndPlay();
    else audio.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    // Eight seconds is enough to hear whether a song starts on time.
    auditionTimer = setTimeout(stopAudition, 8000);
  }

  // ---- edits -------------------------------------------------------------------
  function setTime(i, t, absolute) {
    if (i <= 0 || i >= rows.length || staleSeed) return;
    rows[i].time = t;
    // A snap places the row on the silence, absolute: the shift no longer lives in it (so a
    // Reset shift leaves it on its snap). A nudge is relative and keeps the row's shift.
    if (absolute) rows[i].shift = 0;
    if (auditionIndex === i) stopAudition();
    // A neighbour's snap button is only valid relative to this row's time, so
    // the whole (small) list re-renders.
    renderList();
    setStatus(describeSilence());
  }

  list.addEventListener('click', function (e) {
    const b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b || b.disabled || busy) return;
    const li = b.closest('.chapter-snap-item');
    const i = li ? Number(li.getAttribute('data-index')) : -1;
    if (!(i >= 0 && i < rows.length)) return;
    focusIndex = i;
    const act = b.getAttribute('data-act');
    if (act === 'play') { audition(i); return; }
    if (act === 'nudge') {
      const t = clampSnapNudge(times(), i, Number(b.getAttribute('data-delta')), state && state.duration, state && state.minGapSec);
      if (t === null) return;
      if (Math.abs(t - rows[i].time) < 0.0005) { setStatus('Chapter ' + (i + 1) + ' cannot move further that way without crossing its neighbour.'); return; }
      setTime(i, t);
      return;
    }
    if (act === 'snap') {
      const sug = suggestionFor(i);
      if (!sug || sug.status !== 'suggest') return;
      const tt = times();
      tt[i] = sug.time;
      const brk = snapGapBreak(tt, times(), savedTimes(), state && state.duration, state && state.minGapSec);
      if (brk) {
        setStatus(brk.end
          ? 'Snapping chapter ' + (i + 1) + ' would put it within ' + gapText() + ' of the end of the file.'
          : 'Snapping chapter ' + (i + 1) + ' would cross its neighbour or come within ' + gapText() + ' of it. Nudge the neighbour first.');
        return;
      }
      setTime(i, sug.time, true);
    }
  });

  snapAllBtn.addEventListener('click', function () {
    if (busy || !state || !Array.isArray(state.snapAll)) return;
    const plan = snapAllPlan();
    const n = plan.length;
    plan.forEach(function (p) { rows[p[0]].time = p[1]; rows[p[0]].shift = 0; });
    renderList();
    setStatus(n > 0 ? 'Snapped ' + n + (n === 1 ? ' start' : ' starts') + '. Review them, then Save.' : describeSilence());
  });
  undoBtn.addEventListener('click', function () {
    if (busy) return;
    rows.forEach(function (r) { r.time = r.savedStart; r.shift = 0; });
    stopAudition();
    renderList();
    setStatus(describeSilence());
  });
  retryBtn.addEventListener('click', function () {
    if (busy || !state) return;
    retryBtn.hidden = true;
    startScan();
  });

  // ---- the in-page confirm ------------------------------------------------------
  let confirmAction = null;
  function askConfirm(text, yesLabel, noLabel, onYes) {
    confirmText.textContent = text;
    setLabel(confirmYes, yesLabel);
    setLabel(confirmNo, noLabel);
    confirmAction = onYes;
    confirmBox.hidden = false;
    try { confirmYes.focus(); } catch (_) { /* jsdom */ }
  }
  function hideConfirm() { confirmBox.hidden = true; confirmAction = null; }
  confirmNo.addEventListener('click', hideConfirm);
  confirmYes.addEventListener('click', function () {
    const fn = confirmAction;
    hideConfirm();
    if (typeof fn === 'function') fn();
  });

  function setBusy(v) {
    busy = v;
    renderList();
  }

  function sourceWord(src) {
    return src === 'description' ? 'the description' : src === 'manual' ? 'your typed list' : 'the file';
  }

  function doRevert(allowCountChange) {
    if (busy || !state) return;
    setBusy(true);
    setStatus('Reverting…');
    doFetch(base + '/revert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: state.version, allowCountChange: allowCountChange === true }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; }); })
      .then(function (res) {
        if (closed) return;
        setBusy(false);
        if (res.ok) {
          notifyLibraryChanged({ kind: 'chapters', mediaId: mediaId }, d); // pocket menus: the ONE library-changed seam
          if (typeof o.onSaved === 'function') { try { o.onSaved(res.body); } catch (_) { /* the caller's refresh */ } }
          if (typeof showToast === 'function') showToast('Back to the source chapters.');
          teardown();
          return;
        }
        if (res.status === 409 && res.body && res.body.countChange) {
          askConfirm(res.body.error + ' Revert anyway?', 'Revert anyway', 'Keep my corrections', function () { doRevert(true); });
          return;
        }
        if (res.status === 409 && res.body && res.body.stale) {
          // gate r1 (adversary W2): the record - or the SOURCE a revert lands on -
          // changed since this editor opened, so what the user confirmed is not what
          // would happen. RE-PLAN: reload from storage (the new revert target and its
          // count) and let them confirm again; never revert onto unconfirmed chapters.
          load(false).then(function () {
            if (closed) return;
            setStatus('The chapters changed since you opened this, so nothing was reverted. Check the list, then Revert again.');
          });
          return;
        }
        setStatus((res.body && res.body.error) || 'Could not revert.');
        renderHead();
      })
      .catch(function () { if (!closed) { setBusy(false); setStatus('Could not revert (network error).'); } });
  }

  revertBtn.addEventListener('click', function () {
    if (busy || !state || !state.revert) return;
    const src = sourceWord(state.revert.source);
    let text = 'Go back to the chapter times from ' + src + '? Your corrected times are removed.';
    // chapter snap gate r2 (Architect ruling): an unchanged count keeps YOUR titles;
    // a count change takes the source's list, titles included - the confirm says which.
    text += state.revert.count === rows.length
      ? ' Your chapter titles are kept. Likes and progress stay on the same chapters, because the chapter count does not change.'
      : ' The source now has ' + state.revert.count + ' chapters instead of ' + rows.length + ', so the chapter list AND its titles come from the source, and liked chapters can move to a different song.';
    askConfirm(text, 'Revert', 'Keep my corrections', function () { doRevert(state.revert.count !== rows.length); });
  });

  saveBtn.addEventListener('click', function () {
    if (busy || staleSeed || !dirty()) return;
    stopAudition();
    setBusy(true);
    setStatus('Saving…');
    doFetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: state.version, starts: times() }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; }); })
      .then(function (res) {
        if (closed) return;
        setBusy(false);
        if (res.ok) {
          notifyLibraryChanged({ kind: 'chapters', mediaId: mediaId }, d); // pocket menus: the ONE library-changed seam
          if (typeof o.onSaved === 'function') { try { o.onSaved(res.body); } catch (_) { /* the caller's refresh */ } }
          if (typeof showToast === 'function') showToast('Chapter times saved. A reheat keeps them.');
          teardown();
          return;
        }
        if (res.status === 409 && res.body && res.body.stale) {
          staleSeed = true;
          renderList();
        }
        setStatus((res.body && res.body.error) || 'Could not save the chapter times.');
      })
      .catch(function () { if (!closed) { setBusy(false); setStatus('Could not save the chapter times (network error).'); } });
  });

  // ---- close ---------------------------------------------------------------------
  // May the editor close right now? A save in flight refuses; unsaved corrections open the
  // in-page discard confirm (its Discard closes) and refuse this close. Cancel asks it, and
  // so does every way out the sheet owns (Esc, the scrim, Close - its canDismiss).
  // v1.341.1 (Dean: "can't close that chapter window without page refresh"): the question was
  // the in-page band in the editor's head, away from the X he pressed, and he never saw it; the
  // editor looked stuck. It is the app's standard confirm dialog now, opened ON TOP of the editor.
  let discardAsking = false;
  function mayClose() {
    if (busy) return false;
    if (dirty() && !staleSeed) {
      if (U && typeof U.confirm === 'function') {
        if (!discardAsking) {
          discardAsking = true;
          U.confirm({ title: 'Discard your changes?', body: 'Your corrected chapter times are not saved yet.',
            confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true, doc: d, win: d.defaultView })
            .then(function (ok) { discardAsking = false; if (ok) teardown(); });
        }
      } else {
        askConfirm('Discard your changes to the chapter times?', 'Discard', 'Keep editing', teardown);
      }
      return false;
    }
    return true;
  }
  function requestClose() {
    if (mayClose()) teardown();
  }
  cancelBtn.addEventListener('click', requestClose);
  // Esc, the scrim and the sheet's Close ASK first, exactly like Cancel: a save in flight
  // refuses, unsaved corrections open the in-page discard confirm (never a silent loss).
  const sheet = U.sheet({
    variant: 'dialog', title: 'Fix chapter times', content: modal,
    canDismiss: mayClose, onClosing: () => teardown(), doc: d, win: d.defaultView,
  });

  function teardown() {
    if (closed) return;
    closed = true;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (auditionTimer) { clearTimeout(auditionTimer); auditionTimer = null; }
    if (audio) { try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) { /* gone */ } }
    sheet.close();
  }

  sheet.open();
  const ready = load(false);

  return { sheet, backdrop: sheet.scrim, modal, list, statusEl, saveBtn, cancelBtn, snapAllBtn, undoBtn, revertBtn, confirmBox, shiftBox, close: teardown, ready, isClosed: () => closed };
}

/**
 * Calls `POST /api/videos/:id/move` with `{ targetFolder }`. `fetchImpl` is
 * injectable (mirrors `triggerLibraryRescanAndRefresh`'s pattern) so this is
 * directly node:test-covered without a real network call. Resolves with the
 * parsed JSON body on a 2xx response; rejects with an `Error` (whose message
 * is the server's own `error` field when present) on any non-2xx or network
 * failure -- callers decide how to surface that (a status line via
 * `showMoveModal`'s `statusEl`, a toast, etc.); this helper never touches the
 * DOM itself.
 */
function requestMoveItem(id, targetFolder, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return Promise.reject(new Error('fetch is not available'));
  return doFetch(`/api/videos/${encodeURIComponent(id)}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder }),
  }).then((res) => {
    return res.json().catch(() => ({})).then((data) => {
      if (!res.ok) {
        throw new Error((data && data.error) || `Move failed (${res.status})`);
      }
      return data;
    });
  });
}

/**
 * v1.32 (Dean, "white-label"): replace the header's text logo with the
 * user-uploaded custom logo when one is configured. A cheap HEAD probe of
 * GET /logo decides: 404 (or any failure) = keep the text logo untouched --
 * the default experience never regresses for the no-logo case. The <img>
 * is bounded by the `.logo-img` CSS rule to the text logo's own cap-height,
 * so any aspect ratio slots into the same header box. Runs on every page
 * (the header + common.js are shared across all five shells); guarded for
 * Node/jsdom-without-header.
 */
function applyCustomLogoIfSet(force) {
  if (typeof document === 'undefined' || typeof fetch !== 'function') return;
  const logoEl = document.querySelector('.logo');
  if (!logoEl) return;
  // v1.33.1: variant-aware -- the DARK-mode logo when data-mode is dark, the
  // light one otherwise. The server cross-falls-back when only one variant is
  // uploaded ("with only one uploaded, it is used for both"), so this stays a
  // dumb mode->URL mapping. Re-invoked by toggleTheme() so the header swaps
  // live with the moon/sun button.
  // `force` (setup.js, right after an upload): bypasses the same-variant
  // short-circuit AND cache-busts the fetch -- REPLACING the current mode's
  // logo with a new image must swap live, not sit behind the src-equality
  // check until a reload.
  const isDark = document.documentElement.getAttribute('data-mode') === 'dark';
  const url = isDark ? '/logo?variant=dark' : '/logo';
  // v1.41.17 (Dean): the FOUC flag. A tiny pre-paint head script reads
  // localStorage['ft-custom-logo'] and stamps html.ft-custom-logo so CSS
  // collapses the text wordmark BEFORE first paint -- no flash of "FileTube"
  // before the image swaps in. We are the sole writer: set it when a logo is
  // confirmed present, clear it (and the class, restoring the text) when the
  // probe 404s or the image fails to load, so a removed/corrupt logo self-heals.
  const clearLogoFlag = () => {
    try { localStorage.removeItem('ft-custom-logo'); } catch (_) { /* storage disabled */ }
    document.documentElement.classList.remove('ft-custom-logo');
  };
  const setLogoFlag = () => {
    try { localStorage.setItem('ft-custom-logo', '1'); } catch (_) { /* storage disabled */ }
    document.documentElement.classList.add('ft-custom-logo');
  };
  fetch(url, { method: 'HEAD' })
    .then((r) => {
      if (!r || !r.ok) { clearLogoFlag(); return; } // no custom logo -- text stays, flag cleared
      setLogoFlag();
      const existing = logoEl.querySelector('img.logo-img');
      if (!force && existing && existing.getAttribute('src') === url) return; // already showing this variant
      const img = document.createElement('img');
      img.className = 'logo-img';
      img.alt = 'Logo';
      img.src = force ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 'ts=' + Date.now() : url;
      // Only swap once the image actually loads -- a corrupt/vanished file
      // must never leave a broken-image glyph where the text logo was.
      img.addEventListener('load', () => {
        while (logoEl.firstChild) logoEl.removeChild(logoEl.firstChild);
        logoEl.appendChild(img);
      });
      // If the confirmed-present file nonetheless fails to decode, restore the
      // text wordmark rather than leave the pre-paint-hidden slot empty.
      img.addEventListener('error', clearLogoFlag);
    })
    .catch(() => { /* offline/no route -- leave the flag as-is; text or current img stays */ });
}

// ---- v1.33.1 (Dean): the Liked sidebar entry, EVERYWHERE -------------------
// One shared helper so every surface that lists playlist/folder links (home
// sidebar, watch sidebar, setup sidebar, stats/subscriptions shells, the
// mobile Playlists sheet) shows the SAME built-in Liked entry under the SAME
// rule: visible iff at least one liked ITEM exists - v1.72: the total spans
// every kind (videos, episodes, tracks, books) - hidden otherwise.
// Count fetched once per page load (cached promise); `force: true` refreshes
// it (the watch page calls that after a like/unlike so the entry appears the
// moment the first like lands).
let likedTotalPromise = null;
function fetchLikedTotal(force) {
  if (force) likedTotalPromise = null;
  if (!likedTotalPromise) {
    likedTotalPromise = fetch('/api/liked?limit=1')
      .then((r) => (r && r.ok ? r.json() : Promise.reject(new Error('liked count fetch failed'))))
      .then((body) => {
        const n = body && Number(body.total);
        return Number.isFinite(n) && n > 0 ? n : 0;
      })
      .catch(() => {
        // Adversarial-gate fix: a TRANSIENT failure (network blip, 5xx) must
        // not poison the session cache with a "confirmed 0" -- clear the
        // cached promise so the NEXT render retries, while this caller still
        // degrades to hidden-for-now. Only a genuine ok-response total is
        // ever cached.
        likedTotalPromise = null;
        return 0;
      });
  }
  return likedTotalPromise;
}

// ---- v1.343 Watch later ------------------------------------------------------
// The signed-in user's Watch later membership, fetched once per page load (a cached
// promise) and kept in step by setWatchLater. Card menus read the SYNC snapshot (null
// until the first fetch lands: the menu then offers "Watch later", an idempotent add).
let watchLaterIdsPromise = null;
let watchLaterIdsSet = null;
function fetchWatchLaterIds(force) {
  if (force) watchLaterIdsPromise = null;
  if (!watchLaterIdsPromise) {
    watchLaterIdsPromise = fetch('/api/watch-later/ids')
      .then((r) => (r && r.ok ? r.json() : Promise.reject(new Error('watch later fetch failed'))))
      .then((body) => {
        watchLaterIdsSet = new Set(body && Array.isArray(body.ids) ? body.ids : []);
        return watchLaterIdsSet;
      })
      .catch(() => {
        watchLaterIdsPromise = null; // a transient failure is retried on the next ask, never cached as "empty"
        return watchLaterIdsSet || new Set();
      });
  }
  return watchLaterIdsPromise;
}
function watchLaterSnapshot() { return watchLaterIdsSet; }

// THE one Watch later verb: on=true adds, false removes. NON-optimistic (the set flips only after
// the server says so). Toasts the outcome; resolves true/false = the new membership, or null on
// failure (callers keep their previous state). Refreshes the sidebar entry's count gate.
function setWatchLater(mediaId, on) {
  return fetch('/api/watch-later/' + encodeURIComponent(mediaId), { method: on ? 'POST' : 'DELETE' })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error('watch later request failed: ' + res.status))))
    .then((body) => {
      const now = body && typeof body.watchLater === 'boolean' ? body.watchLater : on;
      if (!watchLaterIdsSet) watchLaterIdsSet = new Set();
      if (now) watchLaterIdsSet.add(String(mediaId)); else watchLaterIdsSet.delete(String(mediaId));
      showToast(now ? 'Added to Watch later' : 'Removed from Watch later');
      const list = document.getElementById('sidebar-folders-list');
      if (list) applyWatchLaterSidebarEntry(list, { force: true });
      return now;
    })
    .catch(() => { showToast('Could not update Watch later.'); return null; }); // never fake success
}

// Play all: feed the list to the play queue (server side, in list order) and start the first one.
function playAllWatchLater() {
  return fetch('/api/queue/watch-later', { method: 'POST' })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error('play all failed: ' + res.status))))
    .then((body) => {
      if (!body || !body.first) { showToast(body && body.full ? 'The queue is full.' : 'Nothing to play.'); return null; }
      showToast(body.added === 1 ? 'Queued 1 video' : 'Queued ' + body.added + ' videos');
      if (typeof refreshQueueChrome === 'function') refreshQueueChrome();
      const entry = (body.queue && Array.isArray(body.queue.entries) ? body.queue.entries : []).find((e) => e && e.uid === body.first.uid);
      const href = entry ? queueEntryHref(entry) : null;
      if (href && window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(href);
      else if (href) window.location.href = href;
      return body;
    })
    .catch(() => { showToast('Could not start Play all.'); return null; });
}

// The sidebar's Watch later entry: right under Liked in the Library list, shown iff the list
// is non-empty (the Liked rule). Static markup only.
function applyWatchLaterSidebarEntry(listEl, opts) {
  if (!listEl || typeof fetch !== 'function') return Promise.resolve();
  const options = opts || {};
  return fetchWatchLaterIds(options.force === true).then((ids) => {
    const existing = listEl.querySelector('.sidebar-item-watchlater');
    if (ids.size > 0) {
      if (existing) {
        if (options.watchLaterActive !== undefined) existing.classList.toggle('active', options.watchLaterActive === true);
        return;
      }
      const entry = document.createElement('a');
      entry.href = '/?watchlater=1';
      entry.className = 'sidebar-item sidebar-item-watchlater' + (options.watchLaterActive === true ? ' active' : '');
      entry.title = 'Watch later';
      const icon = spriteIconEl('schedule', 'chrome-icon');
      if (icon) entry.appendChild(icon);
      entry.appendChild(document.createTextNode(' Watch later'));
      if (typeof options.decorate === 'function') options.decorate(entry);
      const liked = listEl.querySelector('.sidebar-item-liked');
      listEl.insertBefore(entry, liked ? liked.nextSibling : listEl.firstChild);
    } else if (existing) {
      existing.remove();
    }
  });
}

// Prepends (or removes) the Liked entry on `listEl`. Idempotent and safe to
// call after any innerHTML re-render -- it never touches the other children,
// so per-item wiring (the home sidebar's [data-index] drag handlers, etc.)
// is unaffected. Static markup only, no user-controlled text.
function applyLikedSidebarEntry(listEl, opts) {
  if (!listEl || typeof fetch !== 'function') return;
  const options = opts || {};
  fetchLikedTotal(options.force === true).then((total) => {
    const existing = listEl.querySelector('.sidebar-item-liked');
    if (total > 0) {
      if (existing) {
        existing.classList.toggle('active', options.active === true);
        return;
      }
      const entry = document.createElement('a');
      entry.href = '/?liked=1';
      entry.className = 'sidebar-item sidebar-item-liked' + (options.active === true ? ' active' : '');
      entry.title = 'Liked';
      const icon = document.createElement('i');
      // v1.77: `.icon-liked`, not `.icon-star`. This is the ONLY Liked surface
      // built at runtime rather than sitting in static markup, so a repoint
      // that swept the nine shells and missed this one would have left every
      // SIDEBAR Liked entry on the old glyph while the bottom bars changed -
      // visible only after liking a video, which is why the test that follows
      // this change counts across shells AND asserts this assignment.
      icon.className = 'icon-liked';
      entry.appendChild(icon);
      entry.appendChild(document.createTextNode(' Liked'));
      // Sweep S1: a caller can reshape the entry for its surface (the playlists sheet's
      // ui-row, toSheetRow) - the WHETHER stays this one count-gated decision.
      if (typeof options.decorate === 'function') options.decorate(entry);
      listEl.insertBefore(entry, listEl.firstChild);
    } else if (existing) {
      existing.remove();
    }
  }).then(() => applyWatchLaterSidebarEntry(listEl, options));
}

/**
 * v1.31 P5 (FR5, pure): the human acknowledgement for a repull trigger's
 * response body (v1.29's `{accepted, started, reason}` discriminator).
 * Returns '' when there is nothing worth saying (a normally-started repull
 * already shows up as the row's own 'queued' state on the next poll tick;
 * only the OTHERWISE-INVISIBLE outcomes get a message). Callers render via
 * toast/`textContent` only.
 */
/**
 * v1.32 (gate fix, pure): the sitewide chip's one-line breaker summary.
 * Individual check failures are muted off the badge, but a TRIPPED breaker
 * (the systemic many-checks-failing signal) still shows everywhere as one
 * compact, non-red line. '' when not tripped. Mirrors (compactly) the
 * subscriptions page's own formatBreakerBannerText -- duplicated because
 * the two files are separate browser scripts; keep the copy in sync.
 */
function formatBreakerChipText(breaker) {
  if (!breaker || typeof breaker !== 'object') return '';
  const resumeMs = typeof breaker.resumeAt === 'string' ? Date.parse(breaker.resumeAt) : NaN;
  const when = Number.isNaN(resumeMs) ? '' : ' — retrying at ' + new Date(resumeMs).toLocaleTimeString();
  return 'Downloads paused' + when;
}

function formatRepullAckText(body) {
  if (!body || typeof body !== 'object') return '';
  if (body.started === false && body.reason === 'busy') return 'Queued behind current run';
  if (body.started === false && body.reason === 'not-found') return 'Channel not found';
  return '';
}

// v1.41.10 (QA gate): DELETE /api/videos/:id can succeed three different ways
// -- clean delete, file-remains (read-only volume / undeletable, scan will
// retry), and delete-pending (the storage side reports an open handle still
// pinning the file; it finishes deleting when that handle closes). Both delete
// flows (main.js cards, watch.js page) used to toast a hardcoded "File
// deleted." for all three, so the server's honest messages were dead code.
// One shared mapper so the two flows can't drift.
function deleteResultToast(data) {
  if (data && data.deletePending) {
    return 'Removed from library. The file is still held open on the storage side -- it will finish deleting when that handle closes.';
  }
  if (data && data.fileRemainsOnDisk) {
    // v1.65: a trash move whose source dirent lingered still landed the
    // bytes safely in Trash -- say so instead of the scarier legacy line.
    return data.trashed
      ? 'Moved to Trash. The original location will finish cleaning up on the next scan.'
      : 'Removed from library, but the file itself could not be deleted -- the next scan will retry.';
  }
  if (data && data.trashed) {
    return 'Moved to Trash.';
  }
  return 'File deleted.';
}

// v1.67 (plan D6): THE share decision - native sheet vs clipboard vs nothing
// - extracted from watch.js's handleShareClick so the card share corner and
// the watch Share button run ONE decision function (the v1.41.7 lesson),
// each keeping its own UI feedback. Resolves to an outcome string:
//   'shared'      - the native sheet took it (or the user dismissed it -
//                   an AbortError is the user closing the sheet, silently
//                   fine, never an error; callers show no feedback either way)
//   'copied'      - clipboard fallback wrote the URL (callers confirm)
//   'copy-failed' - clipboard fallback threw (already console.error'd)
//   'unavailable' - no share sheet AND no clipboard API (very old /
//                   non-secure context; already console.error'd)
// v1.68 (Dean ruling 4): a play also closes its own DELIVERED push banner,
// so the phone's notification shade agrees with the app. The v1.66 worker
// stamps each banner's deep link into notification.data.url
// (/watch.html?v=<id> since v1.67.4; ?id=<id> before that) - matched here
// by PARSING the params, ?v= primary with the legacy ?id= fallback
// (v1.68.1: pre-v1.67.4 banners outlive that fix in the shade and must
// retire on play too; mirrors watch.js's resolveWatchMediaId precedence).
// Plan D4: URLSearchParams, never substring - "v=abc" must not close
// "v=abc2"'s banner. Feature-detected at every step and total-silent
// outside the PWA; resolves the count closed (tests) and never rejects.
function closeDeliveredPushBanners(mediaId) {
  if (typeof mediaId !== 'string' || mediaId === '') return Promise.resolve(0);
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)
    || !navigator.serviceWorker || typeof navigator.serviceWorker.getRegistration !== 'function') {
    return Promise.resolve(0);
  }
  return navigator.serviceWorker.getRegistration()
    .then((reg) => (reg && typeof reg.getNotifications === 'function' ? reg.getNotifications() : []))
    .then((list) => {
      let closed = 0;
      for (const n of list || []) {
        const url = n && n.data && typeof n.data.url === 'string' ? n.data.url : '';
        let v = null;
        try {
          // v1.68.1: `?v=` with legacy `?id=` fallback - banners minted before
          // v1.67.4's pushWatchUrl fix carry `?id=` and sit in the shade until
          // something closes them; a play must retire those too (mirrors
          // watch.js's resolveWatchMediaId, same precedence).
          const sp = new URL(url, 'http://localhost').searchParams;
          v = sp.get('v') || sp.get('id');
        } catch (_) { /* unparseable - skip */ }
        if (v === mediaId) {
          try { n.close(); closed++; } catch (_) { /* already gone */ }
        }
      }
      return closed;
    })
    .catch(() => 0);
}

// v1.110 (Dean): append a YouTube start-time to an ALREADY-server-resolved share
// URL. The URL IDENTITY is never assembled client-side (the v1.52 lesson) -- this
// only SETS the `t=<whole seconds>` query param on a resolved watchUrl via the
// platform URL parser, so it handles both `youtu.be/ID?t=` and `watch?v=ID&t=`,
// preserves any other params (e.g. `&list=`), and overwrites a pre-existing `t`.
// Returns the url UNCHANGED for a non-finite/non-positive time, a non-string url,
// or a url the parser rejects -- a share can never produce a BROKEN link, only
// (at worst) fall back to the plain one.
function withShareStartTime(url, seconds) {
  if (typeof url !== 'string' || url === '') return url;
  if (typeof seconds !== 'number' || !isFinite(seconds) || seconds <= 0) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('t', String(Math.floor(seconds)));
    return u.toString();
  } catch (e) {
    return url;
  }
}

function shareExternalUrl(url, title) {
  if (typeof navigator.share === 'function') {
    return navigator.share({ title: title || 'FileTube', url })
      .catch(() => { /* sheet dismissed / share failed -- no-op */ })
      .then(() => 'shared');
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(url).then(
      () => 'copied',
      (err) => { console.error('Share: clipboard copy failed:', err); return 'copy-failed'; }
    );
  }
  console.error('Share: no navigator.share or clipboard API available');
  return Promise.resolve('unavailable');
}

// Transcript export (Dean): share a block of TEXT (not a URL) - the native
// sheet where one exists (iOS/Android `navigator.share({title, text})`;
// Notes/Messages/Mail/AI apps all accept text), else the clipboard. Same
// outcome vocabulary as shareExternalUrl ('shared' | 'copied' | 'copy-failed'
// | 'unavailable') so callers give identical feedback. A dismissed sheet is
// 'shared' (the user's choice), never an error - exactly the URL helper's rule.
function shareTextContent(text, title) {
  const body = typeof text === 'string' ? text : '';
  if (typeof navigator.share === 'function') {
    return navigator.share({ title: title || 'FileTube', text: body })
      .catch(() => { /* sheet dismissed / share failed -- no-op */ })
      .then(() => 'shared');
  }
  return copyTextToClipboard(body);
}

// Clipboard write with the shared outcome vocabulary ('copied' | 'copy-failed'
// | 'unavailable'). Must be called synchronously inside a user gesture on
// iOS - callers PREFETCH the text and copy from memory on the tap.
function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(typeof text === 'string' ? text : '').then(
      () => 'copied',
      (err) => { console.error('Copy: clipboard write failed:', err); return 'copy-failed'; }
    );
  }
  console.error('Copy: no clipboard API available');
  return Promise.resolve('unavailable');
}

// v1.286 (Dean, "everything shareable"): share the actual media FILE, not a link.
// The link helpers above share an EXTERNAL source URL (only useful when the item
// came from one); a self-hosted file's own URL is unreachable off the user's
// network. shareMediaFile fetches the item's bytes from its `?download=1` stream
// arm and hands the real File to the OS share sheet (navigator.share({files})),
// so a friend gets the actual mp3/mp4/pdf/epub. Where file-share is unavailable
// (most desktops) or the file is too big to blob safely, it falls back to a
// browser download the caller's user can then send. One helper, wired into every
// media type's Share (video/music/podcasts/books) - the universal-Share contract
// the media-capability census enforces.

// Beyond this, don't pull the whole file into a Blob (memory) - fall back to a
// plain download instead. Audio/books are well under this; only large video hits it.
var SHARE_FILE_MAX_BYTES = 400 * 1024 * 1024;

// Pure decision (exported for node:test): 'file' when the platform can file-share
// AND the size is unknown or within the cap; otherwise 'download'.
function chooseShareStrategy(opts) {
  var o = opts || {};
  if (!o.canShareFiles) return 'download';
  if (typeof o.sizeBytes === 'number' && typeof o.maxBytes === 'number' && o.sizeBytes > o.maxBytes) return 'download';
  return 'file';
}

function shareMediaFile(opts) {
  var o = opts || {};
  var url = o.url;
  var title = o.title || 'FileTube';
  var filename = o.filename || 'media';
  if (!url) return Promise.resolve('unavailable');
  var canShareFiles = typeof navigator !== 'undefined'
    && typeof navigator.canShare === 'function'
    && typeof navigator.share === 'function';
  function fallbackDownload() {
    try {
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      return 'downloaded';
    } catch (e) { console.error('Share: download fallback failed:', e); return 'unavailable'; }
  }
  if (chooseShareStrategy({ canShareFiles: canShareFiles }) === 'download') {
    return Promise.resolve(fallbackDownload());
  }
  // Size guard (HEAD) before blobbing the bytes into memory.
  return fetch(url, { method: 'HEAD' })
    .then(function (h) { return (h && h.ok) ? (Number(h.headers.get('content-length')) || null) : null; }, function () { return null; })
    .then(function (sizeBytes) {
      if (chooseShareStrategy({ canShareFiles: true, sizeBytes: sizeBytes, maxBytes: SHARE_FILE_MAX_BYTES }) === 'download') {
        return fallbackDownload();
      }
      var serverName = null;
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('fetch ' + r.status);
        // Prefer the server's Content-Disposition filename - it carries the RIGHT extension
        // (.mp3/.m4a/.mp4/.pdf/.epub) so the shared file is typed correctly on the friend's device.
        try {
          var cd = r.headers.get('content-disposition') || '';
          var m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
          if (m && m[1]) serverName = decodeURIComponent(m[1].replace(/"$/, '').trim());
        } catch (_) { /* keep the fallback filename */ }
        return r.blob();
      }).then(function (blob) {
        var file = new File([blob], serverName || filename, { type: blob.type || 'application/octet-stream' });
        if (!navigator.canShare({ files: [file] })) return fallbackDownload();
        return navigator.share({ files: [file], title: title })
          // a dismissed sheet is the user's choice, never an error (the link helper's rule)
          .then(function () { return 'shared'; }, function () { return 'shared'; });
      }).catch(function (e) { console.error('Share: file fetch/share failed:', e); return fallbackDownload(); });
    });
}

// v1.362.2 (D6, Dean: "export everything with like a button press"): the ONE way a diagnostic log
// leaves the phone - docs/references/log-collection-pattern.md. A log is recorded in the background
// behind a Settings switch; Settings exports ALL of it with one button through this helper: the OS
// share sheet with a .txt file (save to Files, AirDrop, Messages, Mail), else the clipboard, else a
// download. The File is built and navigator.share is called SYNCHRONOUSLY inside the caller's click,
// from text the caller already holds (no fetch or await first: iOS drops the user activation).
// Pure strategy (exported for node:test): 'file' | 'copy' | 'download'.
function chooseLogExportStrategy(opts) {
  var o = opts || {};
  if (o.canShareFiles) return 'file';
  if (o.hasClipboard) return 'copy';
  return 'download';
}

// Resolves 'shared' | 'copied' | 'downloaded' | 'failed'. A dismissed share sheet is the user's
// choice, never an error (the shareMediaFile rule); a share that FAILS for another reason (no
// activation, a refused type) falls back to the download so the log is never silently lost.
// Toasts the copied / downloaded / failed outcomes (the share sheet is its own feedback).
function exportDiagnosticLog(opts) {
  var o = opts || {};
  var text = typeof o.text === 'string' ? o.text : '';
  var filename = o.filename || 'filetube-log.txt';
  var title = o.title || 'FileTube log';
  var nav = typeof navigator !== 'undefined' ? navigator : null;
  var file = null;
  try { if (typeof File === 'function') file = new File([text], filename, { type: 'text/plain' }); } catch (_) { file = null; }
  var canShareFiles = false;
  try {
    canShareFiles = !!(file && nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] }));
  } catch (_) { canShareFiles = false; }
  var hasClipboard = !!(nav && nav.clipboard && typeof nav.clipboard.writeText === 'function');
  function note(outcome) {
    if (outcome === 'copied') showToast('Log copied to the clipboard');
    else if (outcome === 'downloaded') showToast('Log downloaded as ' + filename);
    else if (outcome === 'failed') showToast('Could not export the log', null, { kind: 'error' });
    return outcome;
  }
  function download() {
    try {
      var blob = new Blob([text], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (_) { /* best-effort */ } }, 10000);
      return 'downloaded';
    } catch (e) { console.error('Export log: download failed:', e); return 'failed'; }
  }
  var strategy = chooseLogExportStrategy({ canShareFiles: canShareFiles, hasClipboard: hasClipboard });
  if (strategy === 'file') {
    var shared;
    try { shared = nav.share({ files: [file], title: title }); } catch (e) { shared = Promise.reject(e); }
    return Promise.resolve(shared).then(function () { return 'shared'; }, function (err) {
      if (err && err.name === 'AbortError') return 'shared';
      console.error('Export log: share failed:', err);
      return note(download());
    });
  }
  if (strategy === 'copy') {
    return copyTextToClipboard(text).then(function (r) { return note(r === 'copied' ? 'copied' : download()); });
  }
  return Promise.resolve(note(download()));
}

// Sweep S9 (F56): every toast rides ui.toast's ONE queue - one visible at a time, the rest
// wait, instead of each call appending its own node on top of the last. showToast stays as
// the thin shim every caller already uses (116 call sites, several of them in other views
// reaching it as window.showToast): `action` is the same optional {label, onAction} (the
// v1.63 Undo), now a sentence-case plain ui-btn in --accent; `opts.kind` ('success' |
// 'error') adds the kind's icon, so colour is never the only signal. The text is always
// textContent (ui.toast builds it with spanText), never markup. Returns ui.toast's handle
// ({dismiss, el}), or null where there is no document / no ui.js (a Node require).
function showToast(msg, action, opts) {
  if (typeof document === 'undefined') return null;
  const U = (typeof window !== 'undefined' && window.ui) || null;
  if (!U || typeof U.toast !== 'function') return null;
  const o = {};
  if (opts && typeof opts === 'object' && (opts.kind === 'success' || opts.kind === 'error')) o.kind = opts.kind;
  if (action && typeof action.onAction === 'function' && typeof action.label === 'string') {
    // One tap runs the action once; ui.toast dismisses the toast after it.
    let ran = false;
    o.action = { label: action.label, onAction: () => { if (ran) return; ran = true; action.onAction(); } };
  }
  return U.toast(msg == null ? '' : String(msg), o);
}

// === v1.21.0 FR-8 (T7): app-wide active-download status chip ===============
// See docs/exec-plans/completed/2026-07-08-v1.21-polish-release.md ("FR-8 --
// download retry + status chip") and docs/references/ui-research-2026-07.md §5.
//
// A fixed, bottom-LEFT corner chip -- gated behind the SAME
// `GET /api/subscriptions/health` capability probe every other optional-
// module surface in this file uses (`injectSubscriptionsNavLinkIfEnabled`/
// `injectOneOffDownloadButtonIfEnabled`) -- visible from ANY page while a
// yt-dlp download (subscription OR one-shot) is active, so a user who
// started a download and navigated away still has an at-a-glance affordance.
// It polls the EXISTING `GET /api/subscriptions/status` snapshot itself (no
// new backend polling primitive -- AC59), independently of the dedicated
// `/subscriptions` page's own ~2.5s poll and the one-off modal's per-job
// poll above; all three are cheap, independent readers of the same
// in-memory `activity` map. Collapsed = an ACTIVE-DOWNLOADS indicator, not a
// queue-depth counter (REFRAMED v1.24.9 -- see `formatDownloadChipSummary`'s
// own doc comment for the full rationale): the server marks EVERY targeted
// subscription `'queued'` before its serialized poll, so a "N queued" count
// was really "N subscriptions waiting to be CHECKED", not N downloads
// pending -- un-actionable noise the owner explicitly doesn't want a
// cancel/dequeue affordance for. The chip now stays HIDDEN through that
// queued/listing churn and only appears for a genuine `'downloading'`
// transition (or a sticky error/cancelled one-shot/subscription); tap
// expands a per-item panel (name/%/state) with Retry + Dismiss on a sticky
// errored item (AC56) -- a completed item is never even shown (auto-
// dismiss). Retry covers BOTH failure kinds through their EXISTING,
// unmodified mechanisms: a one-shot re-POSTs a reconstructed body to
// `POST /api/ytdlp/download` (the SAME `classifySingleVideo`/format-
// allowlist/`normalizeQuality`/`validateFiletype` validation path a brand
// new request goes through -- no bypass); a subscription calls the SAME
// `POST /api/subscriptions/:id/repull` the settings sheet's own Re-pull
// button already uses (no new endpoint either way -- AC52/AC53). All chip
// text is assigned via `textContent` ONLY -- never `innerHTML` -- matching
// this file's blanket discipline for every server/user-derived string
// (a subscription/one-shot's in-flight video `title`, a one-shot's `label`
// folder name, and the redacted `error` string can all be operator/attacker-
// influenced, exactly like `formatOneOffStatusText`'s callers already
// assume). No stop/cancel affordance exists for a SUBSCRIPTION row (or a
// "stop all" panel action) -- the owner pauses a subscription from the
// `/subscriptions` page itself; the chip's only actions are the ONE-SHOT
// Cancel button (the user's own active job, gated to `state==='downloading'`)
// and Retry/Dismiss on a sticky error/cancelled row.

const DL_CHIP_POLL_BASE_MS = 5000; // slower app-wide cadence than /subscriptions's own dedicated ~2.5s poll
const DL_CHIP_POLL_MAX_MS = 30000;

// v1.26 "real progress": same rationale as `ONEOFF_STATUS_POLL_FAST_MS`
// above -- the chip's 5s base cadence (already the slowest of the three
// pollers) under-samples an active transfer even more badly. Only used
// while `snapshotHasActiveDownload` finds a genuinely `'downloading'` entry
// anywhere in the latest snapshot; every other tick (idle, queued/listing
// churn, terminal/sticky-only) keeps the base cadence and the existing
// failure backoff untouched.
const DL_CHIP_POLL_FAST_MS = 700;

/**
 * Pure: does this `{subscriptions, oneShots}` snapshot (the exact shape
 * `GET /api/subscriptions/status` returns) have ANY entry -- subscription or
 * one-shot -- genuinely and RECENTLY in the `'downloading'` state right now?
 * Used to decide the chip's adaptive poll cadence (see
 * `nextDownloadChipPollDelay` below) -- never throws on a malformed/absent
 * snapshot.
 *
 * v1.26 code-review fix (F4): "active" now also requires a fresh `updatedAt`
 * (`isFreshlyActiveEntry`, `ACTIVE_ENTRY_STALE_MS`) -- a wedged/stuck yt-dlp
 * child can otherwise hold a `'downloading'` entry for the ENTIRE
 * `downloadTimeoutMinutes` window (180 minutes by default) with no further
 * progress output at all, which pre-fix kept this chip on the ~700ms fast
 * cadence needlessly for hours. `nowMs` is optional/injectable (forwarded to
 * `isFreshlyActiveEntry`) for deterministic tests.
 */
function snapshotHasActiveDownload(snapshot, nowMs) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const subs = snapshot.subscriptions && typeof snapshot.subscriptions === 'object' ? snapshot.subscriptions : {};
  const oneShots = snapshot.oneShots && typeof snapshot.oneShots === 'object' ? snapshot.oneShots : {};
  return Object.values(subs).some((entry) => isFreshlyActiveEntry(entry, nowMs))
    || Object.values(oneShots).some((entry) => isFreshlyActiveEntry(entry, nowMs));
}

// v1.21 FIX 3 (post-gate hardening, adversarial -- FR-8): module-scoped,
// SYNCHRONOUS in-flight/injected guard for `injectDownloadStatusChip`
// below. The function's OLD guard (`document.getElementById('dl-status-chip')`)
// only helps once the chip node exists -- but that node is only created
// inside the function's `fetch('/api/subscriptions/health').then(...)`
// callback, i.e. AFTER an async round-trip. Two calls to
// `injectDownloadStatusChip()` issued before that fetch resolves (e.g. two
// shell-init code paths both calling it during the same page load) would
// BOTH pass the old guard, race the fetch, and each build its own chip/poll
// loop/popstate listener -- two chips, two overlapping polls. This flag is
// set TRUE synchronously, before the fetch even starts, so a second/
// concurrent call is a no-op regardless of network timing. Deliberately
// never reset back to `false` -- injection is a one-shot, page-lifetime
// action (mirrors the chip DOM node itself, which is also never removed).
let dlStatusChipInjectStarted = false;

/**
 * Pure poll-delay reducer, same shape/intent as `lib/ytdlp/client/
 * subscriptions.js`'s `nextPollDelay` (duplicated rather than shared -- this
 * file is served to every page, that one only via the enabled-gated route):
 * `success` resets to the base ~5s cadence -- or, v1.26, the much faster
 * `DL_CHIP_POLL_FAST_MS` when `isActive` (an actively-downloading entry was
 * present in the snapshot this success came from -- see
 * `snapshotHasActiveDownload`). `isActive` defaults to `false` so every
 * pre-existing caller/test (`nextDownloadChipPollDelay(prev, success)`, two
 * args) keeps its exact old behavior.
 *
 * v1.26 code-review fix (F5): on FAILURE, the doubling is now computed from
 * AT LEAST the base cadence (`Math.max(prevDelayMs, DL_CHIP_POLL_BASE_MS)`),
 * not `prevDelayMs` verbatim -- capped, as before, at `DL_CHIP_POLL_MAX_MS`.
 * Pre-fix, a failure landing right after a fast (~700ms, `DL_CHIP_POLL_FAST_MS`)
 * success tick would back off to only ~1400ms -- FASTER than this backoff's
 * own original first retry ever was (`DL_CHIP_POLL_BASE_MS * 2` = 10s) --
 * effectively defeating the backoff exactly when the server is flakiest
 * (mid-download). The failure delay is still entirely UNCHANGED by
 * `isActive` (a flaky/offline server backs off the same way regardless of
 * what the last known-good snapshot showed).
 */
function nextDownloadChipPollDelay(prevDelayMs, success, isActive) {
  if (success) return isActive ? DL_CHIP_POLL_FAST_MS : DL_CHIP_POLL_BASE_MS;
  const prev = typeof prevDelayMs === 'number' && prevDelayMs > 0 ? prevDelayMs : DL_CHIP_POLL_BASE_MS;
  const base = Math.max(prev, DL_CHIP_POLL_BASE_MS);
  return Math.min(base * 2, DL_CHIP_POLL_MAX_MS);
}

/**
 * Pure (AC52's one-shot retry mechanism): reconstructs the JSON body a Retry
 * re-POST to `POST /api/ytdlp/download` needs, from a failed one-shot job's
 * ephemeral activity `LiveEntry` (the exact shape `GET /api/subscriptions/
 * status`'s `oneShots` namespace returns). `url` (the already-validated
 * watch URL) and `label` (the folder name) existed on every one-shot entry
 * before this release; `format`/`quality`/`filetype` are v1.21.0 FR-8's
 * additive fields (lib/ytdlp/index.js's download route + `runOneShot`).
 * Returns `null` for an entry with no reconstructable `url` -- callers must
 * treat `null` as "cannot retry" and never POST it. This function performs
 * NO validation of its own: the caller always re-POSTs the result through
 * the SAME `POST /api/ytdlp/download` route, which independently
 * re-validates every field (`classifySingleVideo`/format allowlist/
 * `normalizeQuality`/`validateFiletype`/`resolveChannelDir`) exactly as it
 * does for a brand-new one-off request -- there is no bypass.
 */
function buildOneShotRetryBody(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.url !== 'string' || entry.url.trim() === '') return null;
  const body = { url: entry.url };
  if (typeof entry.format === 'string' && entry.format.trim() !== '') body.format = entry.format;
  if (typeof entry.quality === 'string' && entry.quality.trim() !== '') body.quality = entry.quality;
  if (typeof entry.filetype === 'string' && entry.filetype.trim() !== '') body.filetype = entry.filetype;
  if (typeof entry.label === 'string' && entry.label.trim() !== '') body.folder = entry.label;
  return body;
}

/**
 * Pure (AC56's auto-dismiss-vs-sticky decision): classifies a LiveEntry's
 * `state` into the chip's lifecycle bucket -- `'auto-dismiss'` (a completed
 * download never even enters the chip's visible item list -- transient,
 * nothing to acknowledge), `'sticky'` (an errored OR user-cancelled download
 * stays visible until the user explicitly Dismisses it), or `'active'`
 * (queued/listing/downloading, or any unrecognized future state, defensively
 * treated as still in-flight rather than silently dropped).
 *
 * v1.24.0 A3: `'cancelled'` (a NEW terminal state distinct from `'error'` --
 * see `lib/ytdlp/index.js`'s cancel route) is sticky like `'error'` rather
 * than auto-dismissed like `'done'`: a cancel is a deliberate user action,
 * so the chip keeps it visible (with a Dismiss control, no Retry -- see
 * `createDownloadChipItemRow`/`updateDownloadChipItemRow` below) until
 * explicitly acknowledged, the same way a failure stays visible rather than
 * silently vanishing.
 */
function chipItemLifecycle(state, failureKind) {
  if (state === 'done') return 'auto-dismiss';
  // v1.32: a CHECK failure (list pass on a channel -- often a dormant one
  // whose check timed out; server tags failureKind:'check') auto-dismisses
  // like 'done' instead of sitting sticky red -- "nothing new was found
  // (the check itself failed)" is noise on the chip, per Dean. The row
  // status and the history page keep the full reason; the automatic
  // poll/breaker retry machinery re-checks it regardless. A DOWNLOAD
  // failure (failureKind:'download', or any error without a kind -- the
  // safe default) stays sticky.
  if (state === 'error' && failureKind === 'check') return 'auto-dismiss';
  if (state === 'error' || state === 'cancelled') return 'sticky';
  return 'active';
}

/**
 * Pure: builds one chip item descriptor from a raw `LiveEntry`, or `null`
 * for an invalid id/entry. `kind` is `'subscription'` or `'oneshot'` (the
 * two `GET /api/subscriptions/status` namespaces); `key` (`kind + ':' + id`)
 * disambiguates a coincidentally-equal id across the two namespaces for the
 * dismissed-set/DOM keying below.
 *
 * `name` (the chip row's LABEL) differs by kind:
 * - `'subscription'`: v1.24.8 (T2's frozen contract) -- every subscription
 *   entry now carries a `name` field (the channel/subscription name), which
 *   this prefers ABOVE all else. That single field is what finally labels
 *   the dozens of merely-`queued` rows (which have no `title` yet -- only
 *   the ONE actively-downloading subscription does) by channel instead of
 *   the generic "Subscription download" literal every row used to share.
 *   Falls back to the in-flight video `title` (defensive -- an entry that
 *   somehow has a title but no name yet), then the old generic literal for
 *   an entry with neither (e.g. a stale/malformed snapshot row).
 * - `'oneshot'`: UNCHANGED -- prefers the in-flight video `title` (set by
 *   the shared progress parser once downloading starts), falling back to
 *   the one-shot's `label` (folder name), then its own generic placeholder.
 *
 * Per-video progress (index/total) for the one ACTIVELY downloading
 * subscription is surfaced via `statusText` below (`formatOneOffStatusText`
 * already renders "title -- N of M -- X%" for any entry with those fields,
 * subscription or one-shot alike) -- no separate field needed here.
 *
 * v1.55 (Dean: "reheats, repulls... it just shows one off download. That
 * should be clearer"): BATCH-ACTIVITY entries ride the same `oneShots`
 * namespace under fixed ids, and every producer already stamps a `kind`
 * field (lib/ytdlp/index.js: 'repull'/'repull-item'/'refresh-avatars';
 * server.js: 'attribute-bulk'). Before this, they all fell through the
 * one-shot naming chain to the literal "One-off download" with statusText
 * "running" (the raw state). Now: a recognized `entry.kind` names the row by
 * OPERATION, its progress comes from the batch counters (done+skipped+failed
 * of total -- a real determinate bar, not the fake-0% class), and the row is
 * never `retryable` (the chip's Retry fires the ONE-SHOT retry route, which
 * has no meaning for a batch id -- Dismiss remains). Unrecognized kinds fall
 * through unchanged, so a future producer degrades to the old generic label
 * rather than breaking.
 */
const ACTIVITY_CHIP_LABELS = {
  'repull': 'Reheating library',
  'repull-item': 'Reheating video',
  'refresh-avatars': 'Refreshing avatars',
  'attribute-bulk': 'Attributing videos',
  // v1.56: the bulk subscriber-count reheat batch (lib/ytdlp/index.js's
  // runReheatSubsBatch stamps kind 'reheat-subs').
  'reheat-subs': 'Reheating sub counts',
};

// Pure: statusText for a batch-activity chip row. Position is PROCESSED
// count (done+skipped+failed -- successes alone would undercount progress on
// a skip-heavy reheat), " -- " joined with the current item label when the
// producer streams one, and attribute-bulk's `moved` tally (its most
// meaningful live number). Terminal states mirror formatOneOffStatusText's
// wording exactly so the two row families read alike.
function formatActivityStatusText(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const state = entry.state;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  if (state === 'running') {
    const total = num(entry.total);
    const processed = num(entry.done) + num(entry.skipped) + num(entry.failed);
    const parts = [];
    if (total > 1) parts.push(Math.min(processed, total) + ' of ' + total);
    const current = typeof entry.current === 'string' && entry.current.trim() !== '' ? entry.current.trim() : null;
    if (current) parts.push(current);
    if (entry.kind === 'attribute-bulk' && num(entry.moved) > 0) parts.push(num(entry.moved) + ' moved');
    return parts.length > 0 ? parts.join(' — ') : 'Running…';
  }
  if (state === 'done') return 'Done';
  if (state === 'error') return typeof entry.error === 'string' && entry.error.trim() !== '' ? entry.error : 'error';
  if (state === 'cancelled') return 'Cancelled';
  return null;
}

function buildDownloadChipItem(kind, id, entry) {
  if (!id || !entry || typeof entry !== 'object') return null;
  const activityKind = kind === 'oneshot' && typeof entry.kind === 'string'
    && Object.prototype.hasOwnProperty.call(ACTIVITY_CHIP_LABELS, entry.kind)
    ? entry.kind : null;
  if (activityKind) {
    const state = typeof entry.state === 'string' ? entry.state : 'running';
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    const total = num(entry.total);
    const processed = num(entry.done) + num(entry.skipped) + num(entry.failed);
    return {
      key: kind + ':' + id,
      id,
      kind,
      activityKind,
      name: ACTIVITY_CHIP_LABELS[activityKind],
      // A batch's bar is its own real progress: processed/total. A batch
      // with no meaningful total (absent, or a single-item reheat) shows NO
      // bar at all (see downloadChipItemShowsPercent) -- its statusText
      // carries the story; never a fake 0% or a dead indeterminate flag.
      percent: total > 1 ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : 0,
      // The bar-visibility gate (downloadChipItemShowsPercent) needs to know
      // whether a determinate processed/total basis exists at all.
      activityBar: total > 1,
      state,
      phase: null,
      indeterminate: false,
      failureKind: null,
      statusText: formatActivityStatusText(entry) || state,
      // NEVER retryable: Retry fires the one-shot retry route, meaningless
      // (and wrong) for a fixed batch id. Errors keep Dismiss only.
      retryable: false,
    };
  }
  const state = typeof entry.state === 'string' ? entry.state : 'queued';
  const percent = typeof entry.percent === 'number' && Number.isFinite(entry.percent)
    ? Math.max(0, Math.min(100, Math.round(entry.percent)))
    : 0;
  const title = typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title.trim() : '';
  const label = typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label.trim() : '';
  const subName = typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : '';
  const name = kind === 'subscription'
    ? (subName || title || 'Subscription download')
    : (title || label || 'One-off download');
  // v1.26 "real progress": a postprocess `phase` (see progress.js's
  // MERGER_RE/EXTRACT_AUDIO_RE/VIDEO_CONVERT_RE/FIXUP_RE) means there is no
  // genuine percent to show right now -- `percent` above is necessarily
  // stale/sticky during that window. `indeterminate` is also true for the
  // ordinary "downloading, but no real transfer percent has arrived yet"
  // window (percent still at its initial 0) -- either way, the row's bar
  // (see `updateDownloadChipItemRow` below) should animate rather than sit
  // at a frozen width.
  const phase = entry.phase === 'merging' || entry.phase === 'converting' ? entry.phase : null;
  const indeterminate = state === 'downloading' && (phase !== null || percent <= 0);
  // v1.32: the server tags subscription error entries with failureKind
  // ('check' = list pass, 'download' = download pass) -- carried through so
  // the lifecycle/summary can de-escalate check noise. Absent/unknown values
  // normalize to null (treated as 'download'-severity, the safe default).
  const failureKind = entry.failureKind === 'check' || entry.failureKind === 'download' ? entry.failureKind : null;
  return {
    key: kind + ':' + id,
    id,
    kind,
    name,
    percent,
    state,
    phase,
    indeterminate,
    failureKind,
    statusText: state === 'error' && failureKind === 'check'
      ? 'Check failed — will retry automatically'
      : (formatOneOffStatusText(entry) || state),
    retryable: state === 'error',
  };
}

/**
 * Pure (v1.24.8): does this chip item's row get a real percent readout (the
 * top-right `X%` label + the progress bar)? A one-shot's row is UNCHANGED --
 * always shows it, even a `0%` still-`queued` job, exactly as before.
 * A SUBSCRIPTION row only shows it while `state === 'downloading'` -- the
 * ONE entry actually in flight (downloads are serialized -- see
 * `formatDownloadChipSummary` below). Every other subscription state
 * (`'queued'`, `'listing'`, `'error'`, `'cancelled'`, ...) has no genuine
 * percent to show; rendering a `0%` bar next to a merely-queued channel is
 * exactly the misleading "fake %" this fixes -- `statusText` already says
 * "Queued..." on its own line, which is honest.
 */
function downloadChipItemShowsPercent(item) {
  if (!item || typeof item !== 'object') return false;
  // v1.55: a batch-activity row shows its bar only while RUNNING with a
  // determinate processed/total basis (activityBar -- total > 1). A batch
  // with no total (or a single-item reheat) shows no bar at all rather than
  // a fake 0%, and a terminal batch's statusText already says what happened.
  if (item.activityKind) return item.state === 'running' && item.activityBar === true;
  if (item.kind !== 'subscription') return true;
  return item.state === 'downloading';
}

/**
 * Pure (v1.24.0 A2, T14): builds the per-item failure line list for a
 * subscription's sticky error row -- `rawEntry.failures` (an array of
 * `{videoId, title?, reason}`, additively set by
 * `lib/ytdlp/index.js`'s `mapItemFailuresForActivity`) is additive and
 * stale-tolerant: this only ever reads it when `state === 'error'` (the SAME
 * lifecycle gate `chipItemLifecycle` uses elsewhere in this file), so a
 * `failures` array left over from a PRIOR failed cycle can never render once
 * the subscription's live state has moved past `'error'` --
 * `lib/ytdlp/activity.js`'s `mergeEntry` is a shallow merge that never clears
 * an old field on its own, so this state-gate is the mechanism that keeps
 * stale per-item failure data from ever being shown, mirroring how this
 * file already treats a stale `entry.error` string the same way (only ever
 * surfaced while `state === 'error'`). Each line prefers `title`
 * (already control-char-stripped/length-capped server-side), falls back to
 * `videoId`, and finally a fixed "Unknown video" literal for the
 * never-misattributed case (`videoId: null` -- see
 * lib/ytdlp/failures.js's "never misattribute" doc comment: an id this
 * confident's server-side parser couldn't attribute is still surfaced here,
 * never silently dropped). `reason` is already redacted (SF1)/sanitized
 * server-side; this function does no further escaping of its own -- the
 * caller renders every returned string via `textContent`, never `innerHTML`,
 * treating it as untrusted regardless.
 */
function buildDownloadChipFailureLines(state, rawEntry) {
  if (state !== 'error' || !rawEntry || !Array.isArray(rawEntry.failures)) return [];
  return rawEntry.failures
    .filter((f) => f && typeof f === 'object')
    .map((f) => {
      const title = typeof f.title === 'string' && f.title.trim() !== '' ? f.title.trim() : '';
      const videoId = typeof f.videoId === 'string' && f.videoId !== '' ? f.videoId : '';
      const label = title || videoId || 'Unknown video';
      const reason = typeof f.reason === 'string' && f.reason.trim() !== '' ? f.reason.trim() : 'Unknown reason';
      return label + ': ' + reason;
    });
}

/**
 * Aggregate reducer (AC54-AC56, REFRAMED v1.24.9; v1.55: no longer fully
 * pure -- it deliberately prunes the caller's live dismissedKeys Set when an
 * item is observed active again, see the W4 comment at the mutation site --
 * see the header
 * comment above): given the RAW `{subscriptions, oneShots}` snapshot
 * `GET /api/subscriptions/status` returns and the CURRENT set of
 * user-dismissed item keys, returns `{count, hasError, items}` --
 * everything the chip's DOM layer needs to decide whether to render at all
 * (`count === 0` -> hidden) and what to show. A `'done'` entry is
 * UNCONDITIONALLY excluded (auto-dismiss -- it never even reaches `items`);
 * an `'error'`/`'cancelled'` entry is excluded once its key is in
 * `dismissedKeys` (acknowledged).
 *
 * v1.24.9 (the ACTIVE-DOWNLOADS reframe): a SUBSCRIPTION entry whose state
 * is merely `'queued'` or `'listing'` is ALSO excluded, unconditionally --
 * the server marks EVERY targeted subscription `'queued'` before its
 * serialized poll (`lib/ytdlp/index.js`), and each only transitions to
 * `'listing'`/`'downloading'` if it turns out to have new videos; because
 * subscriptions are polled one at a time (`runExclusive`), at most ONE
 * subscription is ever genuinely `'downloading'` while the other N-1 sit in
 * `'queued'`/`'listing'` as un-actionable churn, not a real download
 * backlog. Deliberately scoped to `kind === 'subscription'` ONLY: a one-shot
 * that's merely `'queued'` is a single job the user JUST started themselves
 * (not sub-queue noise), so it stays visible/counted even before it starts
 * transferring bytes. Net effect: the chip stays HIDDEN through a big
 * subscription poll's queued/listing churn and only appears once a real
 * `'downloading'` transition happens (or a sticky error/cancelled item is
 * present) -- idle -> `count === 0` -> `chip.hidden = true`.
 */
function reduceDownloadChipState(snapshot, dismissedKeys) {
  const dismissed = dismissedKeys instanceof Set
    ? dismissedKeys
    : new Set(Array.isArray(dismissedKeys) ? dismissedKeys : []);
  const subs = (snapshot && snapshot.subscriptions && typeof snapshot.subscriptions === 'object') ? snapshot.subscriptions : {};
  const oneShots = (snapshot && snapshot.oneShots && typeof snapshot.oneShots === 'object') ? snapshot.oneShots : {};
  const items = [];
  Object.entries(subs).forEach(([id, entry]) => {
    const item = buildDownloadChipItem('subscription', id, entry);
    if (item) items.push(item);
  });
  Object.entries(oneShots).forEach(([id, entry]) => {
    const item = buildDownloadChipItem('oneshot', id, entry);
    if (item) items.push(item);
  });
  const visible = items.filter((item) => {
    // v1.24.9: a merely-queued/listing SUBSCRIPTION is sub-queue noise, not
    // an active download -- never contributes to the chip at all.
    if (item.kind === 'subscription' && (item.state === 'queued' || item.state === 'listing')) return false;
    const lifecycle = chipItemLifecycle(item.state, item.failureKind);
    // v1.55 gate round 1 (adversarial W4): an item observed ACTIVE again
    // clears its dismissal. Batch activities live under FIXED ids
    // (repull-metadata etc.), so without this, dismissing one errored
    // reheat swallowed every LATER reheat's terminal outcome for the rest
    // of the page lifetime (the reviewer's runnable repro); subscription
    // ids shared the same latent class. Only meaningful when the caller
    // passes its own live Set (the chip does) -- the defensive array copy
    // path prunes a throwaway.
    if (lifecycle === 'active') dismissed.delete(item.key);
    if (lifecycle === 'auto-dismiss') return false;
    if (lifecycle === 'sticky') return !dismissed.has(item.key);
    return true;
  });
  return {
    count: visible.length,
    hasError: visible.some((item) => item.state === 'error'),
    items: visible,
  };
}

/**
 * Pure (AC55's collapsed summary text, REFRAMED v1.24.9 -- see the header
 * comment above for the owner's full rationale). This is an
 * ACTIVE-DOWNLOADS indicator, not a queue-depth counter: "N queued" is
 * un-actionable noise (a subscription only means "waiting to be checked",
 * not "about to download"), so a queued/listing SUBSCRIPTION never
 * contributes any text here at all (`reduceDownloadChipState` already
 * excludes it from `state.items` entirely -- see that function's own doc
 * comment). This function only ever needs to describe three things:
 *
 * - Something is genuinely `'downloading'` (a subscription or a one-shot):
 *   "N downloading (X%)", where `X%` is the average percent over ONLY the
 *   `'downloading'` items. Downloads are serialized, so in practice this is
 *   almost always exactly one item -- when it's exactly one AND that item
 *   carries a `name`/`statusText` (the real per-item shape
 *   `buildDownloadChipItem` produces), this instead surfaces its channel/
 *   title + live progress inline, e.g. "Cool Channel — 3 of 12 — 47%",
 *   reusing the SAME `name`/`statusText` fields the expanded panel's row
 *   already renders (`updateDownloadChipItemRow`) -- no duplicate formatting
 *   logic.
 * - NOTHING is downloading, but a sticky `'error'`/`'cancelled'` item is
 *   present:
 *   - All `'error'` (no `'cancelled'` items at all) -- "N download(s)
 *     failed".
 *   - All `'cancelled'` (no `'error'` items at all) -- "N stopped", never
 *     "failed": a deliberate, user-initiated Stop is not a failure.
 *   - A MIX of both -- "N failed · M stopped", named separately so a
 *     stopped channel is never lumped into an unrelated failure count.
 * - NOTHING is downloading and nothing is sticky (e.g. only a just-started,
 *   still-`'queued'` one-shot -- kept visible/counted by
 *   `reduceDownloadChipState`, but with no headline text of its own yet):
 *   returns `''`. The chip itself stays visible (`count > 0`) with an empty
 *   collapsed label until that item transitions to a describable state; its
 *   own row in the expanded panel already shows "Queued…" regardless.
 *
 * The word "queued" is deliberately never produced by this function.
 */
function formatDownloadChipSummary(state) {
  if (!state || !Array.isArray(state.items) || state.items.length === 0) return '';
  const downloading = state.items.filter((item) => item.state === 'downloading');
  // v1.55: RUNNING batch activities (reheats, avatar refreshes,
  // attribution -- see ACTIVITY_CHIP_LABELS) are first-class in the
  // collapsed line now, not invisible-until-error. A single one headlines
  // by name exactly like a single download does. (Worded to dodge the
  // ytdlp-t6 route-lock's literal scanner, which cannot tell prose from
  // code -- the same reason its allowlist exists.)
  const running = state.items.filter((item) => item.activityKind && item.state === 'running');
  if (downloading.length === 0 && running.length === 0) {
    const errored = state.items.filter((item) => item.state === 'error');
    const cancelledCount = state.items.filter((item) => item.state === 'cancelled').length;
    const errorCount = errored.length;
    if (errorCount === 0 && cancelledCount === 0) return '';
    if (cancelledCount === 0) {
      // "download failed" was a lie when the failed thing was a reheat --
      // wording follows what actually failed.
      const allActivities = errored.every((item) => item.activityKind);
      const noun = allActivities
        ? (errorCount === 1 ? ' task failed' : ' tasks failed')
        : (errored.some((item) => item.activityKind)
          ? ' failed'
          : (errorCount === 1 ? ' download failed' : ' downloads failed'));
      return errorCount + noun;
    }
    if (errorCount === 0) {
      return cancelledCount + ' stopped';
    }
    return errorCount + ' failed · ' + cancelledCount + ' stopped';
  }
  const parts = [];
  if (downloading.length === 1) {
    const item = downloading[0];
    const hasNameAndStatus = typeof item.name === 'string' && item.name.trim() !== ''
      && typeof item.statusText === 'string' && item.statusText.trim() !== '';
    parts.push(hasNameAndStatus ? item.name + ' — ' + item.statusText : '1 downloading (' + item.percent + '%)');
  } else if (downloading.length > 1) {
    const avg = Math.round(downloading.reduce((sum, item) => sum + item.percent, 0) / downloading.length);
    parts.push(downloading.length + ' downloading (' + avg + '%)');
  }
  if (running.length === 1) {
    const act = running[0];
    parts.push(typeof act.statusText === 'string' && act.statusText.trim() !== '' && act.statusText !== 'Running…'
      ? act.name + ' — ' + act.statusText
      : act.name);
  } else if (running.length > 1) {
    parts.push(running.length + ' tasks running');
  }
  return parts.join(' · ');
}

/**
 * Pure mount-suppression gate: "the chip suppresses itself on /subscriptions
 * -- that page owns its own inline status" (avoids redundant, visually
 * duplicated status surfaces on the one page that already has a dedicated
 * one). Its own tiny pure function (rather than inlined) so it is directly
 * unit-testable without a real `window.location`.
 */
function shouldShowDownloadChipOnPath(pathname) {
  return typeof pathname === 'string' && pathname !== '/subscriptions';
}

/**
 * v1.29.0 T8 (R2.3/R2.4, AC4.3/AC4.4) -- PURE edge-detector, no DOM/timers,
 * same posture as `reduceDownloadChipState` above: given the raw `{oneShots}`
 * snapshot `GET /api/subscriptions/status` returns and the SET of one-shot
 * jobIds already known (from a PRIOR poll tick) to have reached `'done'`,
 * returns the jobIds that are `'done'` in THIS snapshot but were NOT yet in
 * `seenDoneJobIds` -- i.e. exactly the ones transitioning INTO `'done'` on
 * this tick. Fires once per job: the caller is responsible for adding the
 * returned ids to its own persisted `seenDoneJobIds` Set before the next
 * poll (this function never mutates its input, so it stays a pure
 * read -- `dismissedKeys`-in/`reduceDownloadChipState`-style). This is the
 * ONLY piece of the in-place library-refresh trigger that inspects raw
 * `oneShots` state directly; `reduceDownloadChipState` itself UNCONDITIONALLY
 * excludes `'done'` entries from its own `items` (auto-dismiss, see that
 * function's doc comment), so the edge can't be observed there.
 */
function detectNewlyDoneOneShots(snapshot, seenDoneJobIds) {
  const seen = seenDoneJobIds instanceof Set
    ? seenDoneJobIds
    : new Set(Array.isArray(seenDoneJobIds) ? seenDoneJobIds : []);
  const oneShots = (snapshot && snapshot.oneShots && typeof snapshot.oneShots === 'object') ? snapshot.oneShots : {};
  const newlyDone = [];
  Object.keys(oneShots).forEach((jobId) => {
    const entry = oneShots[jobId];
    if (entry && typeof entry === 'object' && entry.state === 'done' && !seen.has(jobId)) {
      newlyDone.push(jobId);
    }
  });
  return newlyDone;
}

/**
 * v1.29.0 T8 (R2.3/R2.4, AC4.3/AC4.4) -- invokes `window.__filetubeRefreshLibrary`
 * (the hook `public/js/main.js` exposes as its page-local `loadLibrary`, HOME
 * PAGE ONLY -- `main.js:203`) iff it exists and is a function; a safe no-op
 * everywhere else (any non-home page, or a page/tab that never set it -- e.g.
 * this tick's one-shot finished while the user is on /watch or
 * /subscriptions). This is a TARGETED re-fetch/re-render, never a page
 * reload -- `window.location.reload()` is NEVER called on this path (BUG 2,
 * see `decideOneOffTerminalAction`'s doc comment for the full incident
 * writeup); the server already rescanned after `runOneShot` completed, so
 * this client call is purely a client-side re-fetch of already-fresh
 * server-side data.
 *
 * v1.30.0 T8 (B1, AC5.1/AC5.2): now RETURNS a boolean -- `true` iff the hook
 * was a function AND was actually invoked (a live home refresh target
 * existed), `false` otherwise. Callers (`pollOnce`'s done-edge, the
 * visibility/pageshow catch-up) use this to distinguish "refreshed" from "no
 * live target -- mark the grid dirty instead of silently dropping the edge"
 * (see `markHomeGridDirty` below).
 */
function refreshLibraryInPlace() {
  if (typeof window !== 'undefined' && typeof window.__filetubeRefreshLibrary === 'function') {
    window.__filetubeRefreshLibrary();
    return true;
  }
  return false;
}

// v1.30.0 T8 (B1, AC5.2b) -- a persistent (localStorage) flag standing in for
// "the home grid's rendered content is stale relative to the server" when a
// one-shot's done-edge fires with NO live refresh target
// (`refreshLibraryInPlace()` returned `false`): the edge is never silently
// dropped -- it is deferred here instead, and `restoreHomeFromCache` (below,
// in the SPA router) reconciles it the next time the user actually returns to
// home, by routing to a fresh render instead of reattaching the stale cached
// node. Persistent (not an in-memory flag) so it survives the tab being
// backgrounded/closed and reopened, exactly like `pendingOneShotJobIds`
// below. Best-effort (try/catch) -- a private-mode/sandboxed browser (or a
// bare Node `require()` with no `localStorage` global at all) must never
// throw; a failed write just means the flag doesn't persist, not a crash.
const HOME_GRID_DIRTY_STORAGE_KEY = 'filetube_home_dirty';

function markHomeGridDirty() {
  try { localStorage.setItem(HOME_GRID_DIRTY_STORAGE_KEY, '1'); } catch (_) { /* storage disabled -- best effort */ }
}

function isHomeGridDirty() {
  try { return localStorage.getItem(HOME_GRID_DIRTY_STORAGE_KEY) === '1'; } catch (_) { return false; }
}

function clearHomeGridDirty() {
  try { localStorage.removeItem(HOME_GRID_DIRTY_STORAGE_KEY); } catch (_) { /* storage disabled -- best effort */ }
}

// v1.30.0 T8 (B1, AC5.3) -- a persistent (localStorage) record of which
// one-shot jobIds were `queued`/`downloading` as of the last-seen snapshot.
// Refreshed on every active chip poll tick AND right before the document
// goes hidden (see `injectDownloadStatusChip`'s `pollOnce`/visibility-
// listener below), so a `visibilitychange`/`pageshow` resume can still tell
// "a job I remember being in-flight is now gone from the server's snapshot"
// apart from "nothing was ever running" -- the whole point being to surface a
// job that completed AND was dropped from the snapshot while the tab was
// hidden (see `detectCompletedPendingOneShots` below). Persistent (not
// in-memory) because a backgrounded PWA tab, or the OS reclaiming/discarding
// it, must not lose this the way an in-memory `Set` would.
const PENDING_ONESHOT_STORAGE_KEY = 'filetube_pending_oneshots';

function getPendingOneShotJobIds() {
  try {
    const raw = localStorage.getItem(PENDING_ONESHOT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch (_) {
    return []; // disabled storage, or corrupt/non-JSON contents -- fail safe to "nothing pending"
  }
}

function setPendingOneShotJobIds(jobIds) {
  const normalized = Array.isArray(jobIds) ? jobIds.filter((id) => typeof id === 'string') : [];
  try { localStorage.setItem(PENDING_ONESHOT_STORAGE_KEY, JSON.stringify(normalized)); } catch (_) { /* storage disabled -- best effort */ }
}

// Pure (AC5.3): the jobIds in `snapshot.oneShots` that are currently
// `queued`/`downloading` -- what gets persisted as "in flight" on every
// active poll tick / right before backgrounding. Mirrors
// `detectNewlyDoneOneShots`'s defensive-parsing posture exactly (never
// throws on a missing/malformed snapshot). Exported for direct node:test
// coverage.
function computeActiveOneShotJobIds(snapshot) {
  const oneShots = (snapshot && snapshot.oneShots && typeof snapshot.oneShots === 'object') ? snapshot.oneShots : {};
  return Object.keys(oneShots).filter((jobId) => {
    const entry = oneShots[jobId];
    return entry && typeof entry === 'object' && (entry.state === 'queued' || entry.state === 'downloading');
  });
}

// Pure (AC5.3): of `pendingJobIds` (a previously-recorded "in flight" list),
// which are now "absent-or-done" in `snapshot` -- i.e. actually completed,
// whether or not the server snapshot still carries a 'done' entry for them
// (a job can be fully dropped from the snapshot by the time a backgrounded
// tab resumes -- see `PENDING_ONESHOT_STORAGE_KEY`'s comment above). A job
// still `queued`/`downloading`/`error`/`cancelled` in the fresh snapshot is
// NOT considered completed here on purpose -- only "gone" or "done" counts,
// mirroring `detectNewlyDoneOneShots`'s own terminal-state-only posture.
// Exported for direct node:test coverage; never mutates its inputs.
function detectCompletedPendingOneShots(pendingJobIds, snapshot) {
  const oneShots = (snapshot && snapshot.oneShots && typeof snapshot.oneShots === 'object') ? snapshot.oneShots : {};
  const ids = Array.isArray(pendingJobIds) ? pendingJobIds : [];
  return ids.filter((jobId) => {
    const entry = oneShots[jobId];
    return !entry || (typeof entry === 'object' && entry.state === 'done');
  });
}

/**
 * v1.26 code-review fix (F2): builds ONE download-chip item row's DOM
 * skeleton ONCE -- every possible sub-element (percent badge, progress bar,
 * cancel action, failures list, retry/dismiss actions) is created up front
 * and toggled via `.hidden` on later ticks (see `updateDownloadChipItemRow`
 * below), instead of the panel clearing and rebuilding every row from
 * scratch on every ~700ms-5s poll tick. That pre-fix full-rebuild had three
 * proven consequences: the fill's `transition: width 300ms` (style.css)
 * never fired (a fresh node every tick has no "previous width" to animate
 * from), the barber-pole `.indeterminate` animation restarted every tick
 * (jerky, never actually looping), and Cancel/Retry/Dismiss buttons were
 * destroyed and recreated out from under the user's finger, silently
 * dropping a tap landing in that narrow window.
 *
 * Every click handler is wired exactly ONCE, here, reading whatever the
 * LATEST `item`/`rawEntry` is off `row.state` (a plain mutable holder
 * `updateDownloadChipItemRow` refreshes on every subsequent call) -- this is
 * what lets the buttons stay the SAME DOM node/listener across ticks while
 * still acting on current data. `doc` is explicit (mirrors
 * `buildOneOffModal(doc, ...)` elsewhere in this file) so this is directly
 * `node:test`-callable against a fake document, no real browser needed.
 * `handlers` is `{onCancel(jobId), onRetry(item, rawEntry), onDismiss(key)}`.
 */
// Sweep S9 (F57, F47): the row's controls are ui-btn (sm secondary: Cancel / Retry /
// Dismiss - one button language, never a bordered bevel or a red fill), the error state
// carries an `error` icon beside its name (colour is never the only signal), and the fill's
// progress is the `--p` custom property (0..1, data only; ui.css-style transform, never an
// inline width). `doc.defaultView.ui` (or window.ui) builds the buttons.
function dlChipUi(doc) {
  const w = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
  return (w && w.ui) || null;
}

function createDownloadChipItemRow(doc, handlers) {
  const U = dlChipUi(doc);
  const row = doc.createElement('div');
  row.className = 'dl-status-chip-item';
  // Mutable holder the static click handlers below always read fresh data
  // from -- refreshed in place by `updateDownloadChipItemRow`, never
  // recreated.
  row.state = { item: null, rawEntry: null };

  const nameRow = doc.createElement('div');
  nameRow.className = 'dl-status-chip-item-head';
  const errIcon = U.icon('error', { size: 'sm', doc, cls: 'dl-status-chip-item-erricon' });
  errIcon.setAttribute('hidden', '');
  nameRow.appendChild(errIcon);
  const nameEl = doc.createElement('span');
  nameEl.className = 'dl-status-chip-item-name';
  nameRow.appendChild(nameEl);
  // v1.26 "real progress": once a postprocess `phase` is set, `percent` is
  // stale (there's no percent to report while ffmpeg merges/converts) -- the
  // numeric badge is hidden for that case specifically (the status line
  // already says "Merging…"/"Converting…"); see `updateDownloadChipItemRow`.
  const pctEl = doc.createElement('span');
  pctEl.className = 'dl-status-chip-item-percent';
  pctEl.hidden = true;
  nameRow.appendChild(pctEl);
  row.appendChild(nameRow);

  const track = doc.createElement('div');
  track.className = 'dl-status-chip-progress';
  track.hidden = true;
  const fill = doc.createElement('div');
  fill.className = 'dl-status-chip-progress-fill';
  track.appendChild(fill);
  row.appendChild(track);

  const statusEl = doc.createElement('div');
  statusEl.className = 'dl-status-chip-item-status';
  row.appendChild(statusEl);

  // v1.24.0 A3 / FIX-4 (two-reviewer gate, post-release): a Cancel
  // affordance for a one-shot job ONLY while it is actually cancellable --
  // `state === 'downloading'`, never `'queued'` -- see the pre-F2 doc
  // comment this replaced (git blame) for the full rationale; unchanged
  // here, only the create/update split is new.
  const cancelActions = doc.createElement('div');
  cancelActions.className = 'dl-status-chip-item-actions';
  cancelActions.hidden = true;
  const cancelBtn = U.button({ variant: 'secondary', size: 'sm', label: 'Cancel', doc });
  cancelBtn.classList.add('dl-status-chip-cancel-btn');
  cancelBtn.addEventListener('click', () => {
    if (row.state.item) handlers.onCancel(row.state.item.id);
  });
  cancelActions.appendChild(cancelBtn);
  row.appendChild(cancelActions);

  // v1.24.0 A2 (T14): per-item failure detail lines for a partially-failed
  // subscription download batch -- see `buildDownloadChipFailureLines`.
  const failuresWrap = doc.createElement('div');
  failuresWrap.className = 'dl-status-chip-item-failures';
  failuresWrap.hidden = true;
  row.appendChild(failuresWrap);

  // v1.24.0 A3: 'cancelled' is sticky (see `chipItemLifecycle`) like
  // 'error', but it is a user-initiated outcome, not a failure -- it gets a
  // Dismiss control only, never Retry.
  const actions = doc.createElement('div');
  actions.className = 'dl-status-chip-item-actions';
  actions.hidden = true;
  const retryBtn = U.button({ variant: 'secondary', size: 'sm', icon: 'refresh', label: 'Retry', doc });
  retryBtn.classList.add('dl-status-chip-retry-btn');
  retryBtn.hidden = true;
  retryBtn.addEventListener('click', () => {
    if (row.state.item) handlers.onRetry(row.state.item, row.state.rawEntry);
  });
  actions.appendChild(retryBtn);
  const dismissBtn = U.button({ variant: 'secondary', size: 'sm', label: 'Dismiss', doc });
  dismissBtn.classList.add('dl-status-chip-dismiss-btn');
  dismissBtn.addEventListener('click', () => {
    if (row.state.item) handlers.onDismiss(row.state.item.key);
  });
  actions.appendChild(dismissBtn);
  row.appendChild(actions);

  row.els = { nameEl, errIcon, pctEl, track, fill, statusEl, cancelActions, cancelBtn, failuresWrap, actions, retryBtn, dismissBtn };
  return row;
}

/**
 * v1.26 code-review fix (F2): refreshes an EXISTING row (previously built by
 * `createDownloadChipItemRow`) IN PLACE for the latest `item`/`rawEntry` --
 * textContent, the fill's width/classes, the indeterminate barber-pole
 * state, and which optional sections (percent badge/progress bar/cancel/
 * failures/retry+dismiss) are visible. Never creates or destroys the row
 * node itself, or any of its static button nodes -- only the (small,
 * bounded) failures list is rebuilt each call, since its line COUNT can
 * genuinely change between ticks.
 */
function updateDownloadChipItemRow(doc, row, item, rawEntry) {
  row.state.item = item;
  row.state.rawEntry = rawEntry;
  const els = row.els;

  els.nameEl.textContent = item.name;
  // The error icon, not the colour alone, says a row failed (F57).
  if (item.state === 'error') els.errIcon.removeAttribute('hidden');
  else els.errIcon.setAttribute('hidden', '');
  row.classList.toggle('is-error', item.state === 'error');

  const showPercent = downloadChipItemShowsPercent(item);
  const showBadge = showPercent && !item.phase;
  els.pctEl.hidden = !showBadge;
  if (showBadge) els.pctEl.textContent = item.percent + '%';

  els.track.hidden = !showPercent;
  if (showPercent) {
    els.fill.classList.toggle('dl-status-chip-progress-fill-error', item.state === 'error');
    // v1.26 "real progress": no genuine percent to animate toward (early
    // "just started"/postprocessing) -- go full-width with a moving
    // barber-pole stripe (`.indeterminate`, style.css) instead of sitting at
    // a flat, frozen-looking width. Reusing the SAME `fill` node across
    // ticks (the whole point of F2) is what lets both this class toggle and
    // the width transition below actually animate instead of restarting.
    els.fill.classList.toggle('indeterminate', Boolean(item.indeterminate));
    // --p is DATA (0..1): the fill scales by transform, so its motion is never a layout
    // transition (AC9) and nothing writes a visual style inline.
    els.fill.style.setProperty('--p', String((item.indeterminate ? 100 : item.percent) / 100));
  }

  els.statusEl.textContent = item.statusText;

  els.cancelActions.hidden = !(item.kind === 'oneshot' && item.state === 'downloading');

  const failureLines = item.state === 'error' ? buildDownloadChipFailureLines(item.state, rawEntry) : [];
  while (els.failuresWrap.firstChild) els.failuresWrap.removeChild(els.failuresWrap.firstChild);
  failureLines.forEach((line) => {
    const lineEl = doc.createElement('div');
    lineEl.className = 'dl-status-chip-item-failure';
    lineEl.textContent = line;
    els.failuresWrap.appendChild(lineEl);
  });
  els.failuresWrap.hidden = failureLines.length === 0;

  els.actions.hidden = !(item.state === 'error' || item.state === 'cancelled');
  // v1.55: gate on the item's own `retryable` (previously a write-only field
  // -- this row checked `state` directly, which would have offered a Retry
  // on an errored BATCH row and fired the one-shot retry route against a
  // fixed batch id). Downloads keep retryable === (state === 'error').
  els.retryBtn.hidden = item.retryable !== true;
}

/**
 * v1.26 code-review fix (F2): the panel-level diff driving the two functions
 * above -- adds a row for any NEW `item.key`, updates every row already
 * present IN PLACE (via `updateDownloadChipItemRow`), and removes a row
 * whose key is no longer present in `state.items` (a dismissed/settled/
 * TTL-expired item). `rowsByKey` is the caller-owned `Map<key, RowNode>`
 * this function reads and mutates -- a caller (or a test) can inspect row
 * IDENTITY across two calls to prove reuse. `panel.appendChild(row)` on an
 * ALREADY-present child is a cheap reorder (same node moved, never a new
 * element) -- used here only to keep DOM order matching `state.items`'
 * order; it is a no-op when a row is already correctly positioned.
 */
function updateDownloadChipPanel(doc, panel, rowsByKey, state, latestSnapshot, handlers) {
  const seenKeys = new Set();
  state.items.forEach((item) => {
    seenKeys.add(item.key);
    const rawEntry = item.kind === 'oneshot'
      ? (latestSnapshot.oneShots || {})[item.id]
      : (latestSnapshot.subscriptions || {})[item.id];
    let row = rowsByKey.get(item.key);
    if (!row) {
      row = createDownloadChipItemRow(doc, handlers);
      rowsByKey.set(item.key, row);
    }
    updateDownloadChipItemRow(doc, row, item, rawEntry);
    panel.appendChild(row);
  });
  for (const [key, row] of rowsByKey) {
    if (!seenKeys.has(key)) {
      panel.removeChild(row);
      rowsByKey.delete(key);
    }
  }
}

/**
 * Builds + wires the chip and appends it to `document.body`, gated behind
 * the capability probe described above. Idempotent (checks for its own DOM
 * node first) and defensive, mirroring `injectOneOffDownloadButtonIfEnabled`
 * exactly: a 404 (module disabled) or a network failure means this function
 * creates NOTHING at all -- no DOM, no poll -- keeping a disabled install
 * byte-identical (the chip is entirely absent, not merely hidden).
 */
function injectDownloadStatusChip() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (document.getElementById('dl-status-chip')) return; // already injected
  // v1.21 FIX 3: synchronous in-flight guard -- see `dlStatusChipInjectStarted`'s
  // own doc comment above for why the `getElementById` check alone is
  // insufficient (the chip node doesn't exist until the fetch below
  // resolves). Set BEFORE the fetch so a second/concurrent call, however
  // close in time, is always a no-op.
  if (dlStatusChipInjectStarted) return;
  dlStatusChipInjectStarted = true;

  fetch('/api/subscriptions/health')
    .then((res) => {
      if (!(res && res.ok === true)) return; // disabled (404) -- inject nothing

      const dismissedKeys = new Set();
      // v1.29.0 T8 (R2.3/R2.4, AC4.3/AC4.4): this chip INSTANCE's own record
      // of one-shot jobIds already observed reaching 'done' -- fed to
      // `detectNewlyDoneOneShots` every poll tick so the in-place library
      // refresh fires exactly once per job, never on every tick a 'done' job
      // happens to still be present in the snapshot.
      const seenDoneOneShotJobIds = new Set();
      let latestSnapshot = { subscriptions: {}, oneShots: {} };
      let expanded = false;
      let pollTimer = null;
      let pollDelay = DL_CHIP_POLL_BASE_MS;

      const chip = document.createElement('div');
      chip.id = 'dl-status-chip';
      chip.className = 'dl-status-chip';
      chip.hidden = true;

      // Sweep S9 (F57): the collapsed chip is a tonal pill ui-btn - a `download` glyph while
      // work runs, an `error` glyph in --danger once something failed (the glyph, not the
      // red alone, says so) - over the one overlay shadow. No bevel, no pulsing red dot.
      const U = dlChipUi(document);
      const summaryBtn = U.button({ variant: 'tonal', size: 'sm', pill: true, icon: 'download', label: 'Downloads' });
      summaryBtn.classList.add('dl-status-chip-summary');
      summaryBtn.setAttribute('aria-expanded', 'false');
      summaryBtn.setAttribute('aria-label', 'Active downloads');
      const summaryIconSlot = summaryBtn.querySelector('.ui-btn__icon');
      const summaryText = summaryBtn.querySelector('.ui-btn__label');
      summaryText.classList.add('dl-status-chip-text');
      let summaryIcon = 'download';
      const setSummaryIcon = (name) => {
        if (name === summaryIcon) return;
        summaryIcon = name;
        summaryIconSlot.replaceChildren(U.icon(name, { size: 'sm' }));
      };
      chip.appendChild(summaryBtn);

      const panel = document.createElement('div');
      panel.className = 'dl-status-chip-panel';
      panel.hidden = true;
      chip.appendChild(panel);

      // v1.32: 'Dismiss all' -- one tap acknowledges every currently-sticky
      // terminal row (errors/cancelled) instead of dismissing them one by
      // one. Appended directly to the panel (never tracked in rowsByKey, so
      // updateDownloadChipPanel's row-cleanup loop leaves it alone); hidden
      // whenever nothing is dismissible. Active (still-downloading/queued)
      // rows are never dismissed by it.
      const dismissAllBtn = U.button({ variant: 'plain', size: 'sm', label: 'Dismiss all' });
      dismissAllBtn.classList.add('dl-status-chip-dismiss-all');
      dismissAllBtn.hidden = true;
      dismissAllBtn.addEventListener('click', () => {
        const state = reduceDownloadChipState(latestSnapshot, dismissedKeys);
        for (const item of state.items) {
          if (chipItemLifecycle(item.state, item.failureKind) === 'sticky') {
            dismissedKeys.add(item.key);
          }
        }
        render();
      });
      panel.appendChild(dismissAllBtn);

      summaryBtn.addEventListener('click', () => {
        expanded = !expanded;
        summaryBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        panel.hidden = !expanded;
        chip.classList.toggle('dl-status-chip-expanded', expanded);
      });

      function retryOneShot(rawEntry, key) {
        const body = buildOneShotRetryBody(rawEntry);
        if (!body) return;
        fetch('/api/ytdlp/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then((r) => {
            if (r.ok) {
              // A retry is a NORMAL new one-shot job (a fresh jobId) -- the
              // OLD failed entry never transitions itself, so it must be
              // dismissed explicitly or it would linger, sticky, alongside
              // the brand-new job that appears on the next poll.
              dismissedKeys.add(key);
              render();
            }
          })
          .catch(() => { /* best-effort -- the item stays visible; the user can retry again */ });
      }

      function retrySubscription(id) {
        // No body needed -- the SAME existing endpoint the settings sheet's
        // own Re-pull button already calls (AC52/AC53); re-uses the SAME
        // subscription id, so the next poll naturally overwrites this same
        // entry's state -- no explicit dismiss needed here.
        // v1.31 P5 (FR5): the response body's v1.29 discriminator
        // ({started, reason}) is now READ instead of discarded -- a
        // busy-coalesced repull surfaces as a toast so the click is never a
        // silent no-op (the run it queued behind may take a while; the row
        // itself won't change until then).
        fetch('/api/subscriptions/' + encodeURIComponent(id) + '/repull', { method: 'POST' })
          .then((r) => (r && r.ok ? r.json() : null))
          .then((body) => {
            const ack = formatRepullAckText(body);
            if (ack) showToast(ack);
          })
          .catch(() => { /* best-effort -- the next poll reflects whatever actually happened */ });
      }

      // v1.24.0 A3: cancel an in-progress ONE-SHOT job (never a subscription
      // -- see `lib/ytdlp/index.js`'s cancel route for the scope rationale).
      // No explicit dismiss/re-render needed on SUCCESS: the server writes
      // the 'cancelled' terminal state synchronously (before its response
      // even returns), so the very next poll tick already reflects it;
      // `pollOnce` is called immediately too, best-effort, so the chip
      // updates without waiting out the full poll cadence.
      //
      // FIX-4 (two-reviewer gate, post-release): the button that calls this
      // is now gated to `state === 'downloading'` only (see
      // `createDownloadChipItemRow`/`updateDownloadChipItemRow` above), but
      // this function ALSO now checks `res.ok` itself rather
      // than only `.catch`ing a network-level failure -- a 404 (job no
      // longer cancellable, e.g. it settled on its own between the click and
      // this request landing) is a normal HTTP response, not a rejected
      // fetch, and the pre-fix `.catch`-only handling silently swallowed it
      // with zero feedback. A non-OK response now surfaces a brief,
      // non-blocking toast (`showToast`, `textContent`-only) instead of a
      // silent no-op; `pollOnce` still runs either way so the chip reflects
      // whatever the job's actual state turns out to be.
      function cancelOneShot(jobId) {
        fetch('/api/ytdlp/download/' + encodeURIComponent(jobId) + '/cancel', { method: 'POST' })
          .then((res) => {
            if (!res.ok) showToast("Couldn't cancel - the download may have already finished", null, { kind: 'error' });
          })
          .catch(() => { /* network-level failure -- the item stays visible; the next poll reconciles reality either way */ })
          .then(() => pollOnce());
      }

      // v1.26 code-review fix (F2): rows are now built/updated by the
      // module-scope `createDownloadChipItemRow`/`updateDownloadChipItemRow`/
      // `updateDownloadChipPanel` helpers above (see their doc comments for
      // the full defect this replaced) -- `rowsByKey` is this chip
      // INSTANCE's own row cache, keyed by `item.key`, reused across every
      // poll tick's `render()` call rather than rebuilt from scratch.
      const rowsByKey = new Map();

      function render() {
        const state = reduceDownloadChipState(latestSnapshot, dismissedKeys);
        // v1.32 (gate fix, QA "check-storm invisibility"): individual CHECK
        // failures are muted off the badge (Dean's noise ask), but a
        // TRIPPED BREAKER -- the systemic "many checks are failing" signal,
        // by definition -- still surfaces as one compact, non-red line on
        // every page. De-noised, never fully silent.
        const breakerText = formatBreakerChipText(latestSnapshot.breaker);
        if (!shouldShowDownloadChipOnPath(window.location.pathname) || (state.count === 0 && breakerText === '')) {
          chip.hidden = true;
          return;
        }
        chip.hidden = false;
        summaryText.textContent = state.count === 0 ? breakerText : formatDownloadChipSummary(state);
        chip.classList.toggle('dl-status-chip-has-error', state.hasError);
        setSummaryIcon(state.hasError ? 'error' : 'download');
        // v1.32: 'Dismiss all' only when there is something dismissible.
        dismissAllBtn.hidden = !state.items.some(
          (item) => chipItemLifecycle(item.state, item.failureKind) === 'sticky',
        );

        // v1.24.9 (the ACTIVE-DOWNLOADS reframe): the "Stop all subscription
        // downloads" panel action is REMOVED -- the owner never wants a
        // stop/cancel affordance for subscription downloads on this chip
        // (see the header comment above).

        updateDownloadChipPanel(document, panel, rowsByKey, state, latestSnapshot, {
          onCancel: (jobId) => cancelOneShot(jobId),
          onRetry: (item, rawEntry) => {
            if (item.kind === 'oneshot') retryOneShot(rawEntry, item.key);
            else retrySubscription(item.id);
          },
          onDismiss: (key) => {
            dismissedKeys.add(key);
            render();
          },
        });
      }

      function scheduleNextPoll(delay) {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = setTimeout(pollOnce, delay);
      }

      // v1.30.0 T8 (B1, AC5.3): `force` overrides the `document.hidden`
      // early-return below for exactly ONE call -- used by the visibility/
      // pageshow catch-up (see `handleVisibilityResume` below) to poll
      // immediately on resume, even though `document.hidden` can still read
      // stale/true for a tick around when the event fires in some browsers.
      // Every normal caller (the `setTimeout(pollOnce, delay)` timer,
      // `cancelOneShot`'s best-effort re-poll) calls it with no argument, so
      // `force` is `undefined`/falsy and today's early-return behavior is
      // unchanged. Now RETURNS the underlying fetch promise (previously
      // fire-and-forget) so the resume handler can sequence its own
      // reconcile step after a genuinely fresh snapshot has landed.
      function pollOnce(force) {
        if (!force && typeof document !== 'undefined' && document.hidden) {
          scheduleNextPoll(DL_CHIP_POLL_BASE_MS);
          return Promise.resolve();
        }
        return fetch('/api/subscriptions/status')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('status endpoint returned ' + r.status))))
          .then((snapshot) => {
            latestSnapshot = snapshot && typeof snapshot === 'object'
              ? {
                subscriptions: snapshot.subscriptions || {},
                oneShots: snapshot.oneShots || {},
                // v1.32 (gate fix): the breaker state rides along so the
                // SITEWIDE chip can show the one-line systemic signal even
                // while individual check failures are muted off the badge.
                breaker: snapshot.breaker || null,
              }
              : { subscriptions: {}, oneShots: {}, breaker: null };
            // v1.30.0 T8 (B1, AC5.3): persist which jobs are currently in
            // flight on every ACTIVE tick (a hidden-tab early-return above
            // never reaches here) -- the last value written here is what a
            // later visibility/pageshow resume reconciles against.
            setPendingOneShotJobIds(computeActiveOneShotJobIds(latestSnapshot));
            // v1.29.0 T8 (R2.3/R2.4, AC4.3/AC4.4): edge-triggered in-place
            // library refresh -- fires exactly once per one-shot job as it
            // transitions into 'done' (never on every tick it stays 'done',
            // never `window.location.reload()` -- see
            // `decideOneOffTerminalAction`'s BUG 2 fix). This is the ONLY
            // call site that ever mutates `seenDoneOneShotJobIds`;
            // `detectNewlyDoneOneShots` itself is a pure read.
            const newlyDoneJobIds = detectNewlyDoneOneShots(latestSnapshot, seenDoneOneShotJobIds);
            newlyDoneJobIds.forEach((jobId) => seenDoneOneShotJobIds.add(jobId));
            // v1.30.0 T8 (B1, AC5.1/AC5.2): a live home target consumes the
            // edge via the seen-set add above, same as before (AC5.2a). When
            // there is NO live target (off-home), the edge is still never
            // silently dropped -- `markHomeGridDirty()` persists a reconcile
            // signal `restoreHomeFromCache` picks up the next time the user
            // actually returns to home (AC5.2b).
            if (newlyDoneJobIds.length > 0) {
              const refreshed = refreshLibraryInPlace();
              if (!refreshed) markHomeGridDirty();
            }
            // v1.26 "real progress": poll much faster while this snapshot
            // shows an actively-downloading entry -- see
            // `nextDownloadChipPollDelay`'s doc comment.
            pollDelay = nextDownloadChipPollDelay(pollDelay, true, snapshotHasActiveDownload(latestSnapshot));
            render();
          })
          .catch(() => {
            pollDelay = nextDownloadChipPollDelay(pollDelay, false);
          })
          .finally(() => scheduleNextPoll(pollDelay));
      }

      // v1.30.0 T8 (B1, AC5.3): the `visibilitychange`/`pageshow` resume
      // reconcile. Going hidden just snapshots which jobs are currently in
      // flight (belt-and-suspenders alongside `pollOnce`'s own per-tick
      // write -- the tab could go hidden between two poll ticks). Becoming
      // visible runs one forced catch-up poll (overriding the
      // `document.hidden` early-return for this one call), THEN -- once that
      // fresh snapshot has actually landed -- checks whether any job
      // recorded as pending BEFORE the catch-up is now absent-or-`done`
      // (`detectCompletedPendingOneShots`): a job that finished and was
      // already dropped from the server's snapshot while the tab was hidden
      // would otherwise never trigger `detectNewlyDoneOneShots`'s own
      // "transitioned into 'done'" edge (it may never have been observed AT
      // 'done' by this tab at all). Reconciled exactly like the normal
      // done-edge: a live target refreshes in place, no live target defers
      // via the dirty flag -- never `window.location.reload()` (AC5.4).
      function handleVisibilityResume() {
        if (typeof document === 'undefined') return;
        if (document.hidden) {
          setPendingOneShotJobIds(computeActiveOneShotJobIds(latestSnapshot));
          return;
        }
        const pendingBeforeCatchUp = getPendingOneShotJobIds();
        pollOnce(true).then(() => {
          if (pendingBeforeCatchUp.length === 0) return;
          const completed = detectCompletedPendingOneShots(pendingBeforeCatchUp, latestSnapshot);
          if (completed.length === 0) return;
          const refreshed = refreshLibraryInPlace();
          if (!refreshed) markHomeGridDirty();
          const stillPending = getPendingOneShotJobIds().filter((id) => !completed.includes(id));
          setPendingOneShotJobIds(stillPending);
        });
      }

      // Route changes via the SPA router's pushState-based `navigate()`
      // don't fire `popstate` -- `render()`'s own path check (re-evaluated
      // on every poll tick, at worst one ~5s cadence later) is what
      // eventually reconciles that case too; this listener just makes the
      // common back/forward-navigation case instant.
      window.addEventListener('popstate', render);
      // v1.30.0 T8 (B1, AC5.3): `pageshow` fires on every visible (re)show,
      // including a bfcache restore that `visibilitychange` alone would
      // miss; `handleVisibilityResume` itself re-checks `document.hidden`,
      // so both listeners safely funnel into the same reconcile logic.
      document.addEventListener('visibilitychange', handleVisibilityResume);
      window.addEventListener('pageshow', handleVisibilityResume);

      document.body.appendChild(chip);
      pollOnce();
    })
    .catch(() => { /* network/parse failure -- fail closed, inject nothing */ });
}

// ---- B1 fast-follow (v1.24.1): "Re-pull this channel now", relocated ------
//
// v1.24.0's B1 button (per-channel re-pull, T6) started life as an inline
// `<script>` at the bottom of `public/index.html`. That only ever ran when
// the browser's INITIALLY loaded document happened to be index.html -- the
// SPA router above (`swapToView`/`restoreHomeFromCache`/`bootRouter`) never
// re-executes a target page's inline `<script>`s on an in-app swap (only
// `#view-root`'s fragment is replaced), so a session that ENTERED on
// watch.html/setup.html/subscriptions.html (e.g. a shared video link ->
// click the creator name -> land in the channel folder) never saw this
// button for the tab's entire life. The old widget's only workaround was a
// `MutationObserver` on `#main-content`, since an inline index.html script
// has no access to the router's internals -- relocating the logic HERE
// (a script every shell loads, on every entry point) lets it instead hook
// the router's own choke points directly: `probeAndReconcileRepullButton()`
// is called once at the end of `swapToView`, `restoreHomeFromCache`, and
// `bootRouter` (the progressive-enhancement boot) -- see those functions,
// below -- so it fires on every entry point AND every subsequent in-app
// navigation, with no observer/polling loop at all.
//
// Pure helpers first (match + gating), exported for node:test -- mirrors
// `shouldShowSubscribeButton`'s shape exactly. The DOM-heavy button
// builder/reconciler below them follows the same disabled-module-inert +
// one-time-probe pattern as `injectDownloadStatusChip` above.

const REPULL_BTN_ID = 'sub-repull-channel-btn';

// Pure: does subscription `sub` (from `GET /api/subscriptions`) identify the
// SAME folder as `root` (the current view's `?root=` folder)? An exact,
// case-sensitive path match on `channelDir` -- exactly what the original
// widget did. Returns the matching subscription, or `null` when `root` is
// falsy, `subs` isn't an array, or nothing matches. Exported for node:test.
function findRepullSubscriptionForRoot(root, subs) {
  if (!root || !Array.isArray(subs)) return null;
  return subs.find((s) => s && typeof s.channelDir === 'string' && s.channelDir === root) || null;
}

// Pure gating (mirrors `shouldShowSubscribeButton`'s shape): the disabled-
// module inert contract -- `moduleEnabled !== true` always resolves to `null`
// (no button), REGARDLESS of `root`/`subs`, so a disabled install can never
// surface this button no matter what `/api/subscriptions` would have
// returned. Exported for node:test.
function shouldShowRepullButton(moduleEnabled, root, subs) {
  return moduleEnabled === true ? findRepullSubscriptionForRoot(root, subs) : null;
}

// One-time-per-tab capability latch (mirrors `dlStatusChipInjectStarted`'s
// posture): once the health probe resolves (success OR failure), it is
// NEVER re-fetched again for the rest of the tab's life -- a disabled
// install is permanently inert (no DOM writes, no repeated fetches) from
// that point on.
let repullHealthChecked = false;
let repullModuleEnabled = false;

// Short-TTL cache + in-flight de-duplication for `GET /api/subscriptions`:
// a burst of reconcile calls (e.g. rapid back/forward navigation) collapses
// onto ONE in-flight request, and a fresh result is reused for
// `REPULL_SUBS_CACHE_MS` rather than re-fetched on every single hop -- so
// this never turns navigation into a `/api/subscriptions` fetch storm.
let repullSubsCache = null;        // { list, fetchedAt }
let repullSubsFetchPromise = null; // in-flight promise shared by concurrent callers

const REPULL_SUBS_CACHE_MS = 5000; // same order of magnitude as DL_CHIP_POLL_BASE_MS's cadence

function fetchSubscriptionsForRepull() {
  const now = Date.now();
  if (repullSubsCache && (now - repullSubsCache.fetchedAt) < REPULL_SUBS_CACHE_MS) {
    return Promise.resolve(repullSubsCache.list);
  }
  if (repullSubsFetchPromise) return repullSubsFetchPromise;
  repullSubsFetchPromise = fetch('/api/subscriptions')
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => [])
    .then((list) => {
      const safe = Array.isArray(list) ? list : [];
      repullSubsCache = { list: safe, fetchedAt: Date.now() };
      repullSubsFetchPromise = null;
      return safe;
    });
  return repullSubsFetchPromise;
}

function removeRepullButton() {
  const btn = document.getElementById(REPULL_BTN_ID);
  if (btn) btn.remove();
}

// No-double-inject guard: `getElementById` only ever finds a node still
// attached to the LIVE document -- once the router replaces `#view-root`'s
// whole subtree (an in-app navigation, popstate, or the home view-cache
// reattach), the OLD button (and its old click-listener closure) is simply
// gone and this builds fresh against the CURRENT `.section-actions`. When a
// button already exists in the CURRENT view, this reuses it (just updating
// `dataset.subId`) instead of appending a second one.
function ensureRepullButton(sub) {
  const actions = document.querySelector('.section-actions');
  if (!actions) { removeRepullButton(); return; }
  let btn = document.getElementById(REPULL_BTN_ID);
  if (!btn) {
    // UI pass sweep S2 (F19): a ui-btn icon tool beside the toolbar's others (the
    // library toolbar is ONE row that never wraps, so no word label): the
    // subscriptions glyph, distinct from Rescan's refresh. Busy = the ui-btn
    // spinner; the outcome is a toast (the v1.31 P5 never-silent posture).
    const ui = (typeof window !== 'undefined' && window.ui)
      || (typeof module !== 'undefined' && module.require ? module.require('./ui.js') : null);
    if (!ui) return;
    btn = ui.button({ variant: 'tonal', size: 'sm', shape: 'icon', icon: 'subscriptions', ariaLabel: 'Re-pull this channel now' });
    btn.id = REPULL_BTN_ID;
    const tools = actions.querySelector('.library-tools');
    (tools || actions).appendChild(btn);
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      btn.disabled = true;
      ui.setBusy(btn, true);
      // v1.31 P5 (FR5): read the v1.29 {started, reason} body instead of
      // discarding it -- a busy-coalesced repull says so, so the click is
      // never a silent no-op.
      fetch('/api/subscriptions/' + encodeURIComponent(btn.dataset.subId) + '/repull', { method: 'POST' })
        .then((r) => (r && r.ok ? r.json() : null))
        .then((body) => {
          if (body && body.started === false && body.reason === 'busy') ui.toast('Queued behind the current run');
          else if (body) ui.toast('Checking this channel for new videos');
          else ui.toast('Could not re-pull this channel', { kind: 'error' });
        })
        .catch((err) => { console.error('Re-pull-this-channel failed:', err); ui.toast('Could not re-pull this channel', { kind: 'error' }); })
        .finally(() => {
          setTimeout(() => {
            btn.disabled = false;
            ui.setBusy(btn, false);
          }, 1500);
        });
    });
  }
  btn.dataset.subId = sub.id;
}

// Re-derives the button's presence/target from scratch against the CURRENT
// location + subscription list. `repullModuleEnabled` gates everything below
// it (see `shouldShowRepullButton`) -- a disabled install never even
// fetches `/api/subscriptions` here.
function reconcileRepullButton() {
  if (typeof document === 'undefined') return;
  if (!repullModuleEnabled) { removeRepullButton(); return; }
  const rootAtCallTime = new URLSearchParams(window.location.search).get('root') || '';
  if (!rootAtCallTime) { removeRepullButton(); return; }
  fetchSubscriptionsForRepull().then((subs) => {
    // Re-read the root at RESOLUTION time, not call time: if the user has
    // since navigated elsewhere (a slow/cache-miss fetch racing a faster
    // subsequent navigation), this must reconcile against wherever they NOW
    // are, never a stale snapshot of where they were when the fetch started.
    const root = new URLSearchParams(window.location.search).get('root') || '';
    const match = shouldShowRepullButton(repullModuleEnabled, root, subs);
    if (match) ensureRepullButton(match); else removeRepullButton();
  });
}

// One-time capability probe (mirrors `injectDownloadStatusChip`'s own
// pattern): the FIRST call fires `GET /api/subscriptions/health` and
// latches the result forever (`repullHealthChecked`); every call after that
// just reconciles directly, with no further health fetch.
function probeAndReconcileRepullButton() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (!repullHealthChecked) {
    // v1.53 gate QA-W1: the capability cache seeds an OPTIMISTIC reconcile
    // (frame-one Re-pull button on refresh) while the REAL probe still runs
    // and re-reconciles -- the latch stays network-authoritative, so a
    // revoked module corrects after ~1 RTT (reconcileRepullButton's own
    // disabled path removes the button).
    const cachedCap = readCapabilityCache();
    if (cachedCap && cachedCap.moduleEnabled === true) {
      repullModuleEnabled = true;
      reconcileRepullButton();
    }
    fetch('/api/subscriptions/health')
      .then((res) => {
        repullHealthChecked = true;
        repullModuleEnabled = res.ok;
        writeCapabilityCache({ moduleEnabled: res.ok });
        reconcileRepullButton();
      })
      .catch(() => { repullHealthChecked = true; repullModuleEnabled = false; reconcileRepullButton(); });
    return;
  }
  reconcileRepullButton();
}

// unregisterStaleServiceWorkers (v1.27.2): FileTube's offline-shell service
// worker (shipped v1.26.4, removed v1.27.2) is GONE -- and this cleanup is
// what actively sheds it from installs that already registered it.
//
// WHY REMOVED (owner decision + documented WebKit behavior): a registered
// SW's fetch handler receives EVERY same-origin subresource request --
// including <video>/<audio> byte-range requests -- even when the handler
// never calls respondWith() for them ("pass-through" still dispatches the
// event; see WebKit bug 184447, where exactly such a pass-through SW broke
// mp4 playback outright). iOS additionally suspends SW processes when the
// page is backgrounded/locked, so a locked page's next media range request
// must first wake a suspended worker -- a credible mechanism for background
// playback dying on iPhone, which is FileTube's primary device. The offline
// fallback card the SW provided was a nice-to-have; reliable background
// media is the product. If offline support ever returns, it must be built
// WITHOUT a fetch handler touching media (and re-reviewed against this
// comment).
//
// Unregistering (not just no-longer-registering) matters: existing installs
// (HTTPS deployments) still carry a live, controlling SW that would
// otherwise keep intercepting until manually cleared. This runs on every
// page boot; once no registrations remain it is a cheap no-op. Failures are
// swallowed -- cleanup must never block or throw into page boot.
// v1.66 amendment: FileTube's own PUSH-ONLY worker (no fetch handler by
// lock - see public/filetube-worker.js's contract comment) is the ONE
// registration allowed to survive. Everything else is still shed exactly as
// before - INCLUDING the v1.26.4 offline shell, which registered at
// `/sw.js`. The first draft of this exemption matched `/sw.js` and
// therefore spared that exact worker; the v1.66 QA seat measured it. The
// push worker's distinct path is what makes the exemption a discriminator
// instead of a hole.
// v1.67.3 amendment: the worker's SECOND name, /push-sw.js, turned out to
// be a canonical filter-list pattern - content blockers (uBlock/Wipr/
// Vinegar, measured on Dean's iPhone) refuse to load scripts named like
// push-marketing SDKs, so it is now /filetube-worker.js. The OLD name stays
// exempt here: devices that registered under it carry LIVE push
// subscriptions, and the boot reconcile upgrades them to the new script
// IN PLACE (same scope keeps the subscription). Shedding them instead
// would silently kill every existing device's push. `/sw.js` alone is
// still shed forever.
// ---- v1.159 (Dean): the reusable sortable/filterable table -----------------
// The clarity wave's one component. Every tabular surface (Stats breakdowns,
// the A/V table, Users, Trash, Music) was a div-list with a FUSED
// "count · duration · size" string and no sort/filter; this splits that back
// into real columns with tappable headers (tap to sort, tap again to flip),
// a name-search filter, and per-table sort persistence.
//
// PURE CORE first (sortTableRows/filterTableRows), unit-tested with no DOM; the
// DOM builder is jsdom-mounted. Numeric columns sort by their RAW value (bytes/
// seconds), NOT the formatted label - so "9.3 GB" sorts below "24.8 GB".

// Compare rows by one column. Numeric cols use sortValue (a raw number); text
// cols locale-compare (case-insensitive, numeric-aware). STABLE: ties keep the
// input order (decorate-with-index), so a second sort key never scrambles.
function sortTableRows(rows, col, dir) {
  const list = Array.isArray(rows) ? rows : [];
  if (!col) return list.slice();
  const factor = dir === 'asc' ? 1 : -1;
  const valOf = col.sortValue
    ? (r) => col.sortValue(r)
    : (r) => (r ? r[col.key] : undefined);
  const decorated = list.map((row, i) => ({ row, i }));
  decorated.sort((a, b) => {
    let cmp;
    if (col.numeric) {
      cmp = (Number(valOf(a.row)) || 0) - (Number(valOf(b.row)) || 0);
    } else {
      const av = String(valOf(a.row) == null ? '' : valOf(a.row));
      const bv = String(valOf(b.row) == null ? '' : valOf(b.row));
      cmp = av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true });
    }
    return cmp !== 0 ? cmp * factor : a.i - b.i;
  });
  return decorated.map((d) => d.row);
}

// Narrow rows by a case-folded substring match against a per-row text extractor
// (what the caller decides is searchable - usually the name/title column). An
// empty query returns a copy of everything.
function filterTableRows(rows, textOf, query) {
  const list = Array.isArray(rows) ? rows : [];
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return list.slice();
  const get = typeof textOf === 'function' ? textOf : () => '';
  return list.filter((row) => String(get(row) == null ? '' : get(row)).toLowerCase().includes(q));
}

// The natural first-click direction for a column: numeric -> DESC (biggest
// first, the useful default for size/length/count), text -> ASC (A-Z).
function defaultSortDir(col) { return col && col.numeric ? 'desc' : 'asc'; }

// buildSortableTable(host, config) -> { root, update(rows) }
//   columns: [{ key, label, numeric, align:'start'|'end', format(row)->string|Node, sortValue(row) }]
//   rows, actions?(row)->Node, filter?:{ text(row)->string, placeholder }, caption,
//   defaultSort?:{ key, dir }, persistKey?
function buildSortableTable(host, config) {
  const cfg = config || {};
  const columns = Array.isArray(cfg.columns) ? cfg.columns : [];
  const doc = (host && host.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  if (!host || !doc || !columns.length) return { root: null, update() {} };
  let allRows = Array.isArray(cfg.rows) ? cfg.rows : [];

  // Restore the saved {key,dir}, else the configured default, else the first col.
  let sortKey = null; let sortDir = null;
  const applySaved = (key, dir) => {
    const col = columns.filter((c) => c.key === key)[0];
    if (col && (dir === 'asc' || dir === 'desc')) { sortKey = key; sortDir = dir; return true; }
    return false;
  };
  if (cfg.persistKey) {
    try {
      const raw = JSON.parse(window.localStorage.getItem(cfg.persistKey) || 'null');
      if (raw) applySaved(raw.key, raw.dir);
    } catch (_) { /* bad/absent -> fall through */ }
  }
  if (!sortKey && cfg.defaultSort) applySaved(cfg.defaultSort.key, cfg.defaultSort.dir);
  if (!sortKey) { sortKey = columns[0].key; sortDir = defaultSortDir(columns[0]); }

  const root = doc.createElement('div');
  root.className = 'stable' + (columns.some((c) => c.wrap) ? ' stable--top' : '');
  root.setAttribute('role', 'table');
  if (cfg.caption) root.setAttribute('aria-label', cfg.caption);
  // Grid template: the FIRST column flexes + truncates, the rest size to
  // content; an actions column adds one more auto track. fr/auto only (no
  // governed literals - census-safe).
  const trackCount = columns.length + (cfg.actions ? 1 : 0);
  root.style.setProperty('--stable-cols', 'minmax(0, 1fr)' + ' auto'.repeat(Math.max(0, trackCount - 1)));

  // Filter box (optional).
  let filterInput = null;
  if (cfg.filter && typeof cfg.filter.text === 'function') {
    const bar = doc.createElement('div');
    bar.className = 'stable-toolbar';
    filterInput = doc.createElement('input');
    filterInput.type = 'search';
    filterInput.className = 'ui-field__input stable-filter'; // sweep S8: the ui-field input (16px, focus ring)
    filterInput.setAttribute('aria-label', cfg.filter.placeholder || 'Filter');
    filterInput.placeholder = cfg.filter.placeholder || 'Filter...';
    bar.appendChild(filterInput);
    root.appendChild(bar);
  }

  // Header row of tappable column buttons.
  const head = doc.createElement('div');
  head.className = 'stable-head';
  head.setAttribute('role', 'row');
  const headBtns = {};
  columns.forEach((col) => {
    const th = doc.createElement('button');
    th.type = 'button';
    // Retire R3: a sort header is a plain sm ui-btn (the press / hover tint and the focus
    // ring are the primitive's); style.css .stable-th sets it in the header's type.
    th.className = 'ui-btn ui-btn--plain ui-btn--sm stable-th' + (col.align === 'end' ? ' stable-th--end' : '');
    th.setAttribute('role', 'columnheader');
    th.dataset.col = col.key;
    th.textContent = col.label;
    th.addEventListener('click', () => {
      if (sortKey === col.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = col.key; sortDir = defaultSortDir(col); }
      if (cfg.persistKey) {
        try { window.localStorage.setItem(cfg.persistKey, JSON.stringify({ key: sortKey, dir: sortDir })); } catch (_) { /* storage off */ }
      }
      render();
    });
    headBtns[col.key] = th;
    head.appendChild(th);
  });
  if (cfg.actions) {
    const spacer = doc.createElement('div');
    spacer.className = 'stable-th stable-th--actions';
    spacer.setAttribute('role', 'columnheader');
    spacer.setAttribute('aria-hidden', 'true');
    head.appendChild(spacer);
  }
  root.appendChild(head);

  const body = doc.createElement('div');
  body.className = 'stable-body';
  root.appendChild(body);

  function render() {
    // aria-sort on the active header (+ a CSS caret keys off it).
    columns.forEach((col) => {
      headBtns[col.key].setAttribute('aria-sort',
        col.key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    const col = columns.filter((c) => c.key === sortKey)[0];
    const q = filterInput ? filterInput.value : '';
    const view = sortTableRows(filterTableRows(allRows, cfg.filter && cfg.filter.text, q), col, sortDir);
    body.textContent = '';
    if (!view.length) {
      const empty = doc.createElement('div');
      empty.className = 'stable-empty';
      empty.textContent = q ? 'No matches.' : 'Nothing here yet.';
      body.appendChild(empty);
      return;
    }
    // renderCap: for large sets (e.g. the whole A/V library) render only the top
    // N of the CURRENT sort/filter + an honest "showing N of M" hint - never a
    // silent truncation. Sort/filter still run over the FULL set, so "biggest"
    // (desc) or "smallest" (asc) or a name filter all reach any item.
    const total = view.length;
    const shown = (cfg.renderCap && total > cfg.renderCap) ? view.slice(0, cfg.renderCap) : view;
    const frag = doc.createDocumentFragment();
    shown.forEach((row) => {
      const tr = doc.createElement('div');
      tr.className = 'stable-row';
      tr.setAttribute('role', 'row');
      columns.forEach((c, ci) => {
        const cell = doc.createElement('div');
        cell.className = 'stable-cell' + (c.align === 'end' ? ' stable-cell--num' : (c.wrap ? ' stable-cell--wrap' : (ci === 0 ? ' stable-cell--name' : '')));
        cell.setAttribute('role', 'cell');
        const out = c.format ? c.format(row) : (row ? row[c.key] : '');
        if (out && out.nodeType) cell.appendChild(out);
        else cell.textContent = out == null ? '' : String(out);
        tr.appendChild(cell);
      });
      if (cfg.actions) {
        const act = doc.createElement('div');
        act.className = 'stable-cell stable-actions';
        act.setAttribute('role', 'cell');
        // Pass the row ELEMENT too, so an action can attach a full-row expando
        // (e.g. the Users access editor: .stable-row child, grid-column 1/-1).
        const node = cfg.actions(row, tr);
        if (node) act.appendChild(node);
        tr.appendChild(act);
      }
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    if (shown.length < total) {
      const more = doc.createElement('div');
      more.className = 'stable-more';
      more.textContent = 'Showing ' + shown.length + ' of ' + total + ' - refine the filter to see more.';
      body.appendChild(more);
    }
    // onRender: fires after EVERY (re)render incl. a sort/filter. A caller with
    // per-row transient state (e.g. Trash's two-tap Purge arm) uses this to
    // reset that state so a re-render can't leave a stale, invisible arm.
    if (typeof cfg.onRender === 'function') { try { cfg.onRender(); } catch (_) { /* caller hook */ } }
  }

  if (filterInput) filterInput.addEventListener('input', render);
  host.textContent = '';
  host.appendChild(root);
  render();

  return {
    root,
    update(rows) { allRows = Array.isArray(rows) ? rows : []; render(); },
  };
}

function unregisterStaleServiceWorkers() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => {
        regs.forEach((r) => {
          const worker = r.active || r.waiting || r.installing;
          const scriptURL = worker && worker.scriptURL ? worker.scriptURL : '';
          // EXACT pathnames, never a suffix: a suffix match would also
          // spare a worker at /media/anything/filetube-worker.js.
          // Unreachable without XSS, but an exemption should never be
          // broader than the files it names. A malformed URL falls through
          // to the shed (fail closed).
          let pathname = '';
          try { pathname = new URL(scriptURL).pathname; } catch (_) { pathname = ''; }
          if (pathname === '/filetube-worker.js') return; // the push worker lives
          if (pathname === '/push-sw.js') return; // v1.67.3: old-name device, reconcile upgrades it
          r.unregister().catch(() => {});
        });
      })
      .catch(() => { /* best-effort cleanup only */ });
  } catch (_) { /* best-effort cleanup only */ }
}

// ---- v1.66 web push client ---------------------------------------------------
// THE one serviceWorker.register call site in the codebase (locked): both
// the Settings enable flow (setup.js) and the boot reconcile below route
// through here. Registration is idempotent and doubles as the update check.
function registerPushWorker() {
  // Registering into scope '/' UPGRADES any existing registration there
  // (including one still running the old /push-sw.js script) while KEEPING
  // its push subscription - the subscription belongs to the registration,
  // not the script URL. This is the v1.67.3 migration path for devices
  // that enabled push under the old, blocklist-colliding name.
  return navigator.serviceWorker.register('/filetube-worker.js');
}

function pushB64urlToUint8(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// v1.67.1: turn a Notification.requestPermission() result into the honest
// message the Settings enable button must SHOW. The v1.66 flow returned
// silently on a non-granted permission, and its error element was
// display:none besides - so a locked iPhone that dismissed the prompt, or
// denied it in a prior install, got no feedback at all. `granted` returns
// null (proceed, no message). Pure + exported so the copy is table-tested,
// not just wired (the v1.66 decision-vs-use lesson).
function describePushEnableOutcome(perm) {
  if (perm === 'granted') return null;
  if (perm === 'denied') {
    return 'Notifications are blocked for FileTube. On iPhone/iPad turn them on in Settings > Notifications > FileTube; on desktop, in the site settings.';
  }
  // 'default' (prompt dismissed / not answered) or any unexpected value.
  return 'Permission was not granted. Tap Enable again and choose Allow when the prompt appears.';
}

// Boot reconcile (exec plan D2's self-heal): if THIS device already carries
// a push subscription, re-POST it so the server row exists even after a
// users-restore wiped the table, and freshen the worker file. Never
// registers a worker on a device that has not opted in; never prompts;
// silently no-ops signed-out (401) and feature-off (404).
function reconcilePushSubscription() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || !reg.pushManager) return null;
      return reg.pushManager.getSubscription().then((sub) => {
        if (!sub) return null;
        registerPushWorker().catch(() => {});
        return fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        });
      });
    }).catch(() => { /* best-effort reconcile only */ });
  } catch (_) { /* best-effort reconcile only */ }
}

// ---- v1.150 (Dean): the search-box clear X ---------------------------------
// TOP LEVEL (outside the document guard below - module.exports needs them;
// both touch `document` only inside function bodies, the house rule). The
// boot block inside the guard calls the injector once per page load - the
// notification-bell one-injection-point posture, all shells covered.
function shouldShowSearchClear(value) {
  return typeof value === 'string' && value.length > 0;
}

// v1.247 (Dean, F2 MENU-returns-to-origin). Top-level + exported so the core logic is unit-
// testable without a full router boot (the router closure's navigate() calls nextPlayerLaunchOrigin).
// A "player launch" is a navigation INTO the mobile skin - /music or /podcasts carrying ?play=.
function isPlayerLaunchUrl(pathname, search) {
  return (pathname === '/music' || pathname === '/podcasts') && /[?&]play=/.test(search || '');
}
// The pure origin reducer: a launch nav records the FROM tab (currentViewUrl, or the live location
// as a fallback) so the skin's MENU can dock back there; ANY other nav clears it to null, so an
// in-view session or a cold-start docks in place on the current tab. prev/next/autoplay never
// navigate, so they never change a launched session's origin.
function nextPlayerLaunchOrigin(pathname, search, currentViewUrl, fallbackUrl) {
  return isPlayerLaunchUrl(pathname, search) ? (currentViewUrl || fallbackUrl || null) : null;
}
// v1.334 (Dean: "have it pop for that prompt on opening up the media player in that skin"): a navigation
// that OPENS the full player - a launch (?play=, above) or the mini player's return (?nowplaying=1, the
// readerHref music.js and podcasts.js stamp). navigate() asks for motion access from inside that tap.
function isPlayerOpenUrl(pathname, search) {
  return isPlayerLaunchUrl(pathname, search) || ((pathname === '/music' || pathname === '/podcasts') && /[?&]nowplaying=1(?:&|$)/.test(search || ''));
}

// v1.161 (Dean): after a search that FINDS something, clear the box so the next
// search needs no X-press first. On ZERO results, KEEP the text (the X still
// resets it - "the X is useful when it didn't find what you wanted"). The results
// themselves are driven by the `?search=` URL, never the box, so emptying it never
// wipes them. Pure; the wiring (main.js fetchLibraryPage0) passes the page-0 total.
function shouldClearSearchInputAfterResults(resultCount) {
  return Number(resultCount) > 0;
}

// Injects the clear X into the search form, BEFORE the Search button
// (Dean: "all the way to the right next to search"). Idempotent; no-ops on
// shells without the form pair. Visibility rides 'input' events (main.js
// dispatches one after its programmatic value set); clicking clears the BOX
// and refocuses - never navigates, never closes the mobile reveal (the user
// is mid-search). Returns the button (test seam).
function injectSearchClearButton(inputEl, btnEl) {
  if (!inputEl || !btnEl || !btnEl.parentNode) return null;
  const already = document.getElementById('search-clear-btn');
  if (already) return already;
  // Sweep S1 (AC4): a plain ui-btn icon button with the registry's close glyph (it was a
  // text X glyph); its 44px hit area comes from the primitive.
  const clearBtn = chromeButtonEl({ cls: 'search-clear-btn', icon: 'close', ariaLabel: 'Clear search' });
  clearBtn.id = 'search-clear-btn';
  clearBtn.hidden = !shouldShowSearchClear(inputEl.value);
  btnEl.parentNode.insertBefore(clearBtn, btnEl);
  inputEl.addEventListener('input', () => {
    clearBtn.hidden = !shouldShowSearchClear(inputEl.value);
  });
  clearBtn.addEventListener('click', () => {
    inputEl.value = '';
    clearBtn.hidden = true;
    inputEl.focus();
  });
  return clearBtn;
}

// D7 (sweep S1, AC9 stillness): the sidebar's slide transition is gated by `.is-animating`,
// which only the menu toggle sets; it clears on the transition's end (or a fallback timer
// past --dur-fast, so a transition that never runs cannot leave it armed).
const SIDEBAR_SLIDE_MS = 250;
function armSidebarSlide(sidebar) {
  if (!sidebar || !sidebar.classList) return;
  sidebar.classList.add('is-animating');
  const done = () => {
    sidebar.classList.remove('is-animating');
    sidebar.removeEventListener('transitionend', onEnd);
    clearTimeout(timer);
  };
  const onEnd = (e) => { if (e.target === sidebar) done(); };
  sidebar.addEventListener('transitionend', onEnd);
  const timer = setTimeout(done, SIDEBAR_SLIDE_MS);
}

// Sidebar toggle responsive menu helper. Guarded so requiring this file in Node
// (for unit tests) never touches `document`.
if (typeof document !== 'undefined') {
// ---- v1.78 device handoff: the card RUNTIME -------------------------------
//
// ONE controller, owned by the persistent shell. Its element is appended to
// <body>, never into #view-root, so in-app navigation cannot tear it down
// (the v1.38 "works on refresh, dies on in-app nav" class), and it owns
// exactly ONE interval for the life of the page - no per-view timer that a
// cached view could leak (the v1.45 listener-leak class).
const handoffCard = (() => {
  let el = null;
  let timer = null;
  let booted = false;
  let current = null; // the presence currently rendered, for the click handler

  function readDismissed() {
    try { return sessionStorage.getItem(HANDOFF_DISMISS_KEY) || ''; } catch (_) { return ''; }
  }
  function writeDismissed(token) {
    // sessionStorage (not localStorage) on purpose: a dismissal is a
    // this-sitting decision. Tomorrow's handoff is new news.
    try { sessionStorage.setItem(HANDOFF_DISMISS_KEY, token); } catch (_) { /* storage off: dismissal lasts the page */ }
  }

  // Built once, reused for every render. Structure is created with real DOM
  // calls rather than markup-from-strings, because two of these fields are
  // client-supplied - see the title/headline writes in render(), which are
  // always textContent.
  // Sweep S9 (F47, D4.6): the card is built from the primitives - the one close mark (a plain
  // icon ui-btn with the registry `close` glyph, never a text x), a ui-thumb with its progress
  // bar (`--p` as data), a primary ui-btn "Continue here" link, and a registry play / pause
  // glyph for the state (never a drawn dot in red). It sits on the overlay surface.
  function glyph(name) {
    return window.ui.icon(name, { size: 'sm' });
  }
  function build() {
    const U = window.ui;
    const card = document.createElement('div');
    card.id = 'handoff-card';
    card.hidden = true;

    const head = document.createElement('div');
    head.className = 'handoff-head';
    const state = document.createElement('span');
    state.className = 'handoff-state';
    state.setAttribute('aria-hidden', 'true');
    state.appendChild(glyph('play_arrow'));
    const headline = document.createElement('span');
    headline.className = 'handoff-headline';
    const dismiss = U.button({ variant: 'plain', shape: 'icon', size: 'sm', icon: 'close', ariaLabel: 'Dismiss' });
    head.append(state, headline, dismiss);

    const body = document.createElement('div');
    body.className = 'handoff-body';
    const thumbLink = document.createElement('a');
    thumbLink.className = 'handoff-cover';
    const thumb = U.thumb({ aspect: '16x9', context: 'row' });
    const img = document.createElement('img');
    img.className = 'ui-thumb__img';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    const bar = document.createElement('span');
    bar.className = 'ui-thumb__progress';
    const fill = document.createElement('span');
    fill.className = 'ui-thumb__bar';
    bar.appendChild(fill);
    thumb.append(img, bar);
    thumbLink.appendChild(thumb);

    const meta = document.createElement('div');
    meta.className = 'handoff-meta';
    const title = document.createElement('div');
    title.className = 'handoff-title';
    const time = document.createElement('div');
    time.className = 'handoff-time';
    // A link (it navigates), in the ui-btn's exact DOM: icon slot, then label.
    const go = document.createElement('a');
    go.className = 'ui-btn ui-btn--primary ui-btn--sm';
    const goIcon = document.createElement('span');
    goIcon.className = 'ui-btn__icon';
    goIcon.appendChild(glyph('play_arrow'));
    const goText = document.createElement('span');
    goText.className = 'ui-btn__label';
    goText.textContent = 'Continue here';
    go.append(goIcon, goText);
    meta.append(title, time, go);

    body.append(thumbLink, meta);
    card.append(head, body);
    document.body.appendChild(card);

    dismiss.addEventListener('click', () => {
      if (current) writeDismissed(handoffSuppressionToken(current));
      hide();
    });

    el = { card, state, headline, img, fill, title, time, go, thumbLink, stateName: 'play_arrow' };
    return el;
  }

  function hide() {
    if (!el) return;
    el.card.hidden = true;
    el.card.classList.remove('handoff-visible');
    current = null;
  }

  function render(presence) {
    if (!el) build();
    current = presence;

    el.headline.textContent = formatHandoffHeadline(presence);
    el.title.textContent = presence.title || '';
    el.time.textContent = formatHandoffTime(presence.position, presence.duration);
    const stateName = presence.state === 'paused' ? 'pause' : 'play_arrow';
    if (stateName !== el.stateName) {
      el.stateName = stateName;
      el.state.replaceChildren(glyph(stateName));
    }
    // --p is DATA (0..1): ui.css scales the thumb's bar by it.
    el.fill.style.setProperty('--p', String(handoffProgressPercent(presence.position, presence.duration) / 100));
    el.img.src = presence.thumbnailUrl || '';
    el.go.href = presence.href || '#';
    el.thumbLink.href = presence.href || '#';

    el.card.hidden = false;
    // Next frame, so the fade transition runs instead of being skipped on the
    // same paint that unhides the card (the toast's precedent).
    requestAnimationFrame(() => { if (el) el.card.classList.add('handoff-visible'); });
  }

  function localPlayingId() {
    try {
      const p = window.FileTube && window.FileTube.player;
      return (p && p.currentId) || null;
    } catch (_) { return null; }
  }

  async function poll() {
    try {
      const deviceId = getDeviceId();
      const r = await fetch(`/api/handoff?deviceId=${encodeURIComponent(deviceId)}`);
      if (!r.ok) return; // a cold/erroring server is silent, never a visible failure
      const data = await r.json();
      const presence = data && data.presence;
      const show = shouldShowHandoffCard(presence, {
        pathname: window.location.pathname,
        localPlayingId: localPlayingId(),
        dismissedToken: readDismissed(),
        controllingRemote: !!(window.FileTube.remoteControl && window.FileTube.remoteControl.isRemote()),
      });
      if (show) render(presence); else hide();
    } catch (_) {
      // Offline, or the endpoint is unavailable. The card is an enhancement;
      // it fails silently by design (#10: restart amnesia is not an error).
    }
  }

  function startTimer() {
    if (timer !== null) return; // ONE interval, ever - never a second one
    timer = setInterval(poll, HANDOFF_POLL_MS);
  }
  function stopTimer() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function init() {
    if (booted) return; // idempotent: a second boot must not double the timer
    booted = true;
    // Polling is visible-tab only (ruling 4). A backgrounded tab asking every
    // 30s forever is exactly the drain this feature must not become.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopTimer();
      } else {
        poll();
        startTimer();
      }
    });
    if (!document.hidden) {
      poll();
      startTimer();
    }
    // v1.356 gate r1 (Q2 = A3): D8 holds the moment the phone attaches, not 30 s later (remote.js loads after this file)
    bindHandoffToRemote(window.FileTube && window.FileTube.remoteControl, { hide, poll: () => { if (!document.hidden) poll(); } });
  }

  return { init, __poll: poll, __hide: hide };
})();

// UI pass D7: no transition runs for a rotate / width change (html.no-motion, style.css).
installResizeStillness();
installRotateDebug();

// UI pass D8.1: reflect the era's flourish NOW, from the data-theme the shell's
// pre-paint bootstrap already set, so the first card render (this script runs
// before any view's init) never shows a fabricated stat the era hides.
applyEraFlourish();

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initIconSet();   // reads ft-icons + the just-applied data-theme
  // v1.43: seed any locally-unchosen display prefs from the signed-in
  // user's record (async, after the local-first paint above -- a device
  // with local prefs is never overridden; a signed-out shell no-ops).
  pullMirroredDisplayPrefs();
  bootStarRatingsPref(); // v1.63.1: apply the stars pref before first paint settles
  // v1.77: per-user Library glyphs. A SEPARATE call on purpose - it must not
  // ride pullMirroredDisplayPrefs, which returns early once the four device
  // prefs are locally chosen (see applyLibraryGlyphs' comment; that early
  // return is what made v1.63.1's stars seed dead on customized devices).
  initLibraryGlyphs();
  bootHomeFeedPref(); // v1.79: seed the home-feed toggle from the user record (own path, like glyphs)
  bootModernModePref(); // v1.84: reflect + seed the Modern-mode toggle (own path, sets data-modern)
  wireSearchAffordances(); // v1.85 #1: the mobile magnifier + recent-search history panel
  injectYouNavItem(); // v1.85 #2: the mobile "You" bottom-nav tab (opens the account menu)
  // v1.78 device handoff: the offer card. Mounted on <body> by the controller
  // (never #view-root) and owning exactly ONE poll interval for the life of
  // the page - booted here, once, alongside the other shell-level injectors.
  handoffCard.init();

  // v1.27.2 (SW removal): actively unregister any service worker a previous
  // FileTube version installed -- see unregisterStaleServiceWorkers' own
  // comment for the full rationale. Deferred to 'load' (same scheduling the
  // old registration used) so cleanup never competes with first paint;
  // internally fully try/catch-wrapped, so neither branch can abort the
  // rest of this boot handler.
  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') {
      unregisterStaleServiceWorkers();
      reconcilePushSubscription();
    } else {
      window.addEventListener('load', unregisterStaleServiceWorkers, { once: true });
      // v1.66: after the shed pass, re-assert this device's push
      // subscription server-side (see reconcilePushSubscription).
      window.addEventListener('load', reconcilePushSubscription, { once: true });
    }
  }

  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.getElementById('main-content');
  
  if (menuToggle && sidebar && mainContent) {
    menuToggle.addEventListener('click', () => {
      // D7 (sweep S1): the drawer slides (transform only) ONLY when the user toggles it;
      // `.is-animating` gates the sidebar's transition (style.css), so a theatre collapse,
      // a resize or a rotation moves it without a slide.
      armSidebarSlide(sidebar);
      sidebar.classList.toggle('hidden');
      sidebar.classList.toggle('mobile-open');
      mainContent.classList.toggle('expanded');
      // v1.191 (Dean, desktop): collapsing/expanding the left bar widens the
      // content column - every critter anchor moves, but nothing re-places them
      // (a window resize is NOT fired, so the resize re-scatter never runs). Mirror
      // the theatre toggle's fix: the same wait-then-place scatter the router uses
      // (no-op when critters are off; debounced past the sidebar's transition).
      if (typeof scheduleCritterScatter === 'function') scheduleCritterScatter();
    });
  }

  // v1.82: the header #theme-toggle-btn was removed - light/dark now lives in the
  // account menu (injectAccountMenu) and the bottom-nav theme item, which own
  // their own click wiring. Nothing to wire here anymore.

  // Shell-owned header search box (C1 remediation, v1.16.0): #search-input/
  // #search-btn live in the PERSISTENT shell (outside #view-root) on every
  // page (index/watch/setup/subscriptions all carry the identical markup --
  // see each page's header comment). Search is a global action (navigate to
  // `/?search=...`), so it is bound EXACTLY ONCE here, at real-page-load boot
  // -- never per-view -- which fixes two bugs at once: (1) a view's init()
  // can no longer null-crash on a shell search control that a DIFFERENT
  // first-loaded page happened to lack (the whole point of making all 4
  // shells byte-uniform); (2) two views can never each bind their OWN
  // listener to this same persistent element, which used to double-fire
  // every search (double history entry + double fetch). Views that still
  // need to READ/SET the input's value (e.g. main.js populating it from
  // `?search=`) do so directly -- only the LISTENER binding moved here.
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  function performGlobalSearch() {
    if (!searchInput) return;
    const query = searchInput.value.trim();
    const url = query ? `/?search=${encodeURIComponent(query)}` : '/';
    if (query) recordSearchTerm(query); // v1.85 #1: remember it (per-user, synced)
    // v1.86.4 (Dean): on mobile the search field is a REVEAL (the `search-open`
    // class on <html>, toggled by the magnifier). Submitting it - Enter or the
    // search button - must CLOSE the reveal, exactly like picking a history entry
    // already does (wireSearchAffordances' onSearch). Otherwise the revealed bar
    // lingers and the user has to tap the magnifier again to dismiss it (Dean:
    // "incredibly clunky"). Unconditional + harmless on desktop, where the bar is
    // always visible and the class is never set.
    document.documentElement.classList.remove('search-open');
    if (window.FileTube && typeof window.FileTube.navigate === 'function') {
      window.FileTube.navigate(url);
    } else {
      window.location.href = url;
    }
  }
  if (searchBtn) searchBtn.addEventListener('click', performGlobalSearch);
  if (searchInput) {
    // v1.245 (Dean): iOS Safari does NOT reliably fire the deprecated `keypress` for the
    // virtual keyboard's return key, so pressing Return did nothing and you had to tap the
    // Search button. `keydown` fires reliably for Return on iOS; `enterkeyhint="search"`
    // also relabels the keyboard's return key to "Search". Bound once (shell-owned), so it
    // covers every shell. preventDefault stops any stray implicit submit / newline.
    searchInput.setAttribute('enterkeyhint', 'search');
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); performGlobalSearch(); }
    });
  }
  // v1.150 (Dean): the search-box clear X (top-level helper above; injected
  // once here at boot, between the input and the Search button).
  injectSearchClearButton(searchInput, searchBtn);

  // v1.47.4 item 6: a cold PWA start restores where the user was, so an iOS
  // eviction costs only the relaunch tap. Checked BEFORE the view-building work
  // below (nav injection, the router, the library fetch) because a restore is a
  // `location.replace` -- everything after this point would be built only to be
  // thrown away. In every non-restoring case (the overwhelming majority) this
  // costs a single localStorage read and returns false.
  if (maybeRestoreLastSession()) return;

  // v1.47.4 item 2: pinch/double-tap zoom suppression. Both calls run on EVERY
  // page, deliberately outside the router: `bootRouter` bails early on a
  // non-route shell (login/welcome), which would otherwise leave exactly the
  // pages a user first lands on still zoomy. `wirePinchZoomSuppression` binds
  // once for the document's lifetime; `applyZoomPolicy` seeds the initial state
  // that later view changes re-evaluate via updateActiveNavHighlight.
  wirePinchZoomSuppression();
  applyZoomPolicy();

  // v1.47.4 item 4: opt-in only (?debugUI=1); a completely inert no-op on a
  // normal load. See wireShellSingletonDebug for why this ships as an
  // instrument rather than a claimed fix.
  wireShellSingletonDebug();
  // v1.47.4 item 5: same opt-in posture (?debugTouch=1), inert otherwise.
  wireTouchTargetDebug();
  // v1.47.8: the `?` keyboard-shortcuts reference. Bound on every page (the
  // shortcuts themselves are app-wide); the desktop check happens at EVENT
  // time, not here.
  wireKeyboardShortcutsHelp();

  // Optional yt-dlp subscriptions nav-link capability probe (D4, T5). Runs on
  // every page (not just inside the `bottomNav` guard below) since it also
  // injects a sidebar link on pages that have one but no bottom nav.
  injectSubscriptionsNavLinkIfEnabled();
  // v1.37.0 books: same boot-time probe-gated injection.
  injectBooksNavLinkIfEnabled();
  // v1.44 music: same probe-gated Library-section injection.
  injectMusicNavLinkIfEnabled();
  // v1.195 TV Shows: same probe-gated Library-section injection.
  injectTvNavLinkIfEnabled();
  // v1.69 podcasts: same injection, gated on >=1 subscription.
  injectPodcastsNavLinkIfEnabled();
  injectDownloadsNavLinkIfEnabled(); // v1.73: the Downloads hard entry + bottom-item gate
  // v1.64 history: same injection, gated on >=1 history item (the Liked rule).
  injectHistoryNavLinkIfEnabled();
  // v1.117 (Dean bug): the PINNED sidebar is a SHELL-LEVEL surface (it lives in
  // #sidebar, outside #view-root), but its render was only booted by main.js
  // (home) and watch.js (watch) -- so pins vanished on Stats/Music/History/
  // Books/Podcasts/Subscriptions, every page whose controller didn't rebuild it.
  // Boot it HERE, once per full page load, on every shell that carries a sidebar
  // -- exactly like the nav injectors above. Idempotent (renderPinnedSidebar
  // removes+rebuilds its own #sidebar-pinned-section) and fail-closed
  // (fetchAllPins 404s -> [] on a disabled module; a rejection renders nothing).
  if (document.getElementById('sidebar-folders-list')) {
    primePinnedSidebarFromCache(); // v1.53 warm instant-paint from the capability cache
    fetchAllPins().then((pins) => renderPinnedSidebar(pins)).catch(() => {});
  }
  // v1.44 T12: apply the user's bottom-bar layout to the STATIC items now; the
  // async injectors (subscriptions/download) re-apply after inserting theirs.
  applyBottomNavCustomization();

  // v1.15.0 item 3: one-off download header button + modal, gated by the
  // SAME capability probe pattern -- runs on every page for the same reason
  // (index.html/watch.html/setup.html/subscriptions.html all share the
  // header and load common.js).
  injectOneOffDownloadButtonIfEnabled();

  // v1.21.0 FR-8 (T7): app-wide active-download status chip, gated by the
  // SAME capability probe pattern -- runs on every page for the same reason
  // as the two injections above.
  injectDownloadStatusChip();

  // v1.51: the notification bell (top-right, every shared-header shell),
  // gated by its own capability probe exactly like the injections above.
  injectNotificationBellIfEnabled();
  injectQueueChrome(); // v1.63: after the bell so insertBefore lands LEFT of it
  injectAccountMenu(); // v1.82: the avatar + account dropdown, rightmost in .header-right

  // v1.32 (Dean, "white-label"): swap the text logo for the user-uploaded
  // image when one is configured -- runs on every page (shared header).
  applyCustomLogoIfSet();

  // v1.33.1 (Dean): the Liked entry on EVERY page's sidebar folder list.
  // Covers the shells that never re-render the list themselves (stats,
  // subscriptions); the pages that DO re-render it (index/watch/setup) wipe
  // this and re-apply through the same helper after their own render.
  applyLikedSidebarEntry(document.getElementById('sidebar-folders-list'));

  // SPA-lite router boot (FR-1, T1): derives the current view from `location`
  // and runs its `init()` -- the identical path an in-app swap runs. Also
  // applies the initial active-nav highlight (bottom-nav + sidebar), which
  // used to be baked into each page's static HTML/inline logic below and now
  // must be re-derivable after every swap too (see updateActiveNavHighlight
  // in the router section above).
  if (window.FileTube && typeof window.FileTube.bootRouter === 'function') {
    window.FileTube.bootRouter();
  }

  // ---- Mobile app shell: bottom nav / Playlists sheet wiring ----
  // Guarded on the nav's presence so pages without it (or load-order issues)
  // never throw.
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    // Dark/Light item -> toggleTheme(), then sync its own icon/label
    const themeItem = document.getElementById('nav-theme-toggle');
    if (themeItem) {
      updateNavThemeItem();               // initial state from data-mode
      themeItem.addEventListener('click', () => {
        toggleTheme();
        updateNavThemeItem();
      });
    }

    // Playlists item -> open sheet
    const playlistsBtn = document.getElementById('nav-playlists-btn');
    if (playlistsBtn) playlistsBtn.addEventListener('click', openPlaylistsSheet);

    // Sweep S1: the sheet's own close wiring (scrim, Close, Esc, swipe down, a link tap)
    // lives with the ui.sheet it builds on the first open (ensurePlaylistsSheet).
  }
});
}

// Expose pure helpers to Node for unit testing (browsers ignore this block —
// `module` is undefined there).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    chooseLogExportStrategy, exportDiagnosticLog, // v1.362.2 (D6): the one log export (log-collection pattern)
    // v1.110 (Dean): the pure share-URL start-time param appender (unit-tested)
    // + the pick-one action modal (jsdom-tested for textContent + settle-once).
    withShareStartTime,
    // Chapter Snap (2026-09-24): the ONE chapter-time editor + its pure helpers (jsdom-tested).
    showChapterSnapEditor, formatSnapTime, clampSnapNudge, snapChipText, showChaptersEditor, formatChapterStamp,
    formatSnapShift, snapShiftBlock, snapShiftSuggestion, snapGapBreak,
    // v1.286 (Dean, everything shareable): universal file-share + its pure strategy decision.
    shareMediaFile, chooseShareStrategy,
    fetchWatchLaterIds, watchLaterSnapshot, setWatchLater, playAllWatchLater, applyWatchLaterSidebarEntry,
    showChoiceModal,
    // Sweep S9: the dialogs on ui.sheet (jsdom-tested with the real ui.js).
    confirmHtmlToText, isLiveDialogOpen, showTranscriptModal,
    // v1.87.1 / UI pass step 2: the chrome glyphs (the name map + markup/element
    // builders over the icon sprite). chrome-icons.test.js binds every map entry to a
    // registry icon and source-locks the shells' static markup against chromeIconMarkup.
    CHROME_ICON, chromeIconMarkup, chromeIconEl, spriteIconEl,
    uiIconMarkup, uiIconEl, chromeButtonEl, bottomNavItemEl, setBottomNavItemFilled, chromeAvatarEl, syncThemeColorMeta,
    armSidebarSlide, toSheetRow, buildUnpinButton, buildPinAvatarNode, openPlaylistsSheet, closePlaylistsSheet,
    // v1.102 (tranche 4 shimmer): the art-decode reveal helper (jsdom-tested).
    shimmerArt,
    // v1.339 (L1): the batched in-viewport reveal + its cap (jsdom-tested).
    revealArtTogether, REVEAL_TOGETHER_CAP_MS,
    // v1.339 (L2): the remembered chrome flags behind the shells' pre-paint reserve, and the
    // decidable-cache gate for the watch page's frame-one Subscribe render (jsdom-tested).
    CHROME_FLAG_KEYS, rememberModuleEnabled, rememberQueueShown,
    rememberBottomNavLayout, chromeReserveEl, cachedSubscribeState,
    injectQueueChrome, injectSubscriptionsNavLinkIfEnabled,
    // v1.247 (F2): the pure MENU-returns-to-origin decision (launch nav -> FROM tab, else null).
    isPlayerLaunchUrl, nextPlayerLaunchOrigin, isPlayerOpenUrl,
    // v1.63 playback queue: the chrome's pure decisions.
    shouldShowQueueButton, formatQueueBadge, buildQueueRowModel, buildQueueRowModels, queueEntryHref, audioOpenHref,
    formatQueuePosition,
    // v1.63.1: the stars pref's pure decision.
    shouldShowStarRatings,
    // v1.84: Modern-mode pref - exported so the apply/boot USE (the data-modern
    // attribute, localStorage, checkbox reflect, cross-device seed) is jsdom-
    // bound, not asserted as a source pattern (the "a decision is not its use"
    // strike this repo keeps taking).
    modernModeEnabled, applyModernModePref, bootModernModePref, MODERN_MODE_VALUES,
    // v1.84 T3: the chip filter allowlist + resolver (client half; source-locked
    // equal to the server's MODERN_GRID_FILTERS) + the bare-home layout decision.
    resolveModernChip, MODERN_CHIP_FILTERS, resolveHomeLayout,
    MODERN_SORT_OPTIONS, MODERN_SORT_DEFAULT, resolveModernSort,
    // v1.84 T4: the mobile avatar bar's pure selection.
    selectRecentUploaderChannels,
    // v1.84 T5: the per-card channel-avatar decision.
    modernCardAvatar,
    // v1.85 #1: the search-history record + panel render (jsdom-bound).
    recordSearchTerm, renderSearchHistoryPanel,
    // v1.209: the search affordances (toggle + history panel + tap-outside close), jsdom-bound.
    wireSearchAffordances,
    // v1.85 #2: the "You" bottom-nav tab injector (jsdom-bound).
    injectYouNavItem,
    // v1.31 P5 (FR5): repull-ack formatter.
    formatRepullAckText,
    // v1.32 (gate fix): the chip's one-line breaker summary.
    formatBreakerChipText,
    getStarRating, getCommentCount, formatRelativeTime, resolveChannelName, displayChannelName, resolveRootHeaderLabel, clampPositionState,
    // v1.126: the folder display-name map cache (setter + reader).
    setFolderDisplayNames, folderDisplayName,
    resolveTheme, THEME_REGISTRY, activeNavItem,
    // v1.82: the account menu injector + avatar builder + shared sign-out +
    // theme-glyph sync.
    injectAccountMenu, ensureAccountMenuSubscriptionsRow, buildAccountAvatarEl, accountSignOut, updateAccountMenuThemeItem,
    // v1.158: the account-menu disk-size formatter (byte-exact vs stats.js's).
    formatDiskBytes,
    // v1.305: the account-menu trash-count label ("1 item"/"N items in trash").
    formatTrashCountLabel,
    // v1.159: the reusable sortable/filterable table + its pure core.
    buildSortableTable, sortTableRows, filterTableRows, defaultSortDir,
    // v1.83: the pure avatar-crop geometry + the crop modal.
    avatarMinScale, clampAvatarOffset, avatarSourceRect, cropAvatarFile,
    // v1.78 device handoff: the UA label table. Pure, and exactly the kind of
    // roster that rots silently - every arm is pinned by node:test.
    resolveDeviceLabel,
    // v1.349: the per-browser word, the typed name and the labels built from them.
    DEVICE_WORDS, DEVICE_NAME_KEY, DEVICE_NAME_MAX, deviceWord, cleanDeviceName, getDeviceName, setDeviceName, getAutoDeviceLabel, getDeviceLabel,
    // v1.78: the card's pure decisions. The runtime around them is a thin
    // fetch/render shell on purpose - everything that can be WRONG is here,
    // where node:test can hold it without a browser.
    shouldShowHandoffCard, bindHandoffToRemote, handoffSuppressionToken, formatHandoffHeadline,
    formatHandoffTime, formatHandoffAge, handoffProgressPercent,
    HANDOFF_LIST_SURFACES, HANDOFF_POLL_MS,
    resolveIconSet, ICON_SET_REGISTRY, ICON_SETS, AUTO_ERA_ICON_MAP, migrateIconPref,
    // v1.77: exported so the Playlists sheet's folder rows can be asserted as
    // RENDERED DOM rather than as a source pattern. The per-folder glyph has
    // four render sites and this is one of only two with a test seam - the
    // "testing a decision is not testing its use" strike this repo keeps
    // taking is exactly what an unexported renderer produces.
    renderPlaylistsSheet,
    // v1.77 Library glyphs: the repainter and the injector's class picker.
    // Exported so the DOM pass is bound in jsdom rather than by a source
    // pattern - both are USES, and this repo's recurring strike is testing the
    // decision instead.
    applyLibraryGlyphs, libraryGlyphClassFor, libraryEntriesHtml,
    gbToBytes, bytesToGb,
    tokenize, rankRelated, RESULT_COUNT, SIMILAR_FLOOR,
    // v1.48 item 2: real day-of view counts (falls back to the mock).
    resolveViewCountLabel, getMockViews,
    resolveAudioArtUrl,
    shouldInjectSubscriptionsNav,
    shouldInjectBooksNav,
    shouldInjectMusicNav,
    shouldInjectTvNav,
    shouldInjectPodcastsNav,
    // v1.64 (adversarial gate W1): the History count-gate is DOM-bound by
    // test/integration/history-nav-gate.test.js through these two.
    injectHistoryNavLinkIfEnabled,
    injectLibraryNavEntry,
    // v1.66 web push: the shedder's exemption + the reconcile are DOM/SW-
    // bound by test/integration/push-client-gate.test.js through these.
    unregisterStaleServiceWorkers,
    reconcilePushSubscription,
    pushB64urlToUint8,
    describePushEnableOutcome,
    resolveBottomNavLayout,
    BOTTOM_NAV_DEFAULT_HIDDEN,
    // v1.75: the roster + the retired-anchor compat ids, exported so the tests
    // bind the REAL values rather than a hand-copied duplicate.
    BOTTOM_NAV_OPTIONAL,
    BOTTOM_NAV_COMPAT_HEAD, BOTTOM_NAV_COMPAT_TAIL,
    likedScopeQuery, bottomNavKeyForHighlight, SIDEBAR_HREF_BY_NAV_KEY,
    applyNavHighlight,
    injectDownloadsNavLinkIfEnabled,
    // v1.75: the bar's ORDER is now decided in JS alone (the v1.39.2 CSS
    // `order:` ladder is gone), so the DOM pass that applies it is bound at
    // the DOM by test/unit/bottom-nav-order-authority.test.js - a resolver
    // test alone would only prove the decision, never its use.
    applyBottomNavCustomization, readBottomNavConfig, writeBottomNavConfig,
    pinDeleteEndpoint,
    fisherYatesShuffle, sortItems, shouldShowShuffleButton,
    deriveOrderedIds, computeNeighbors, parentFolder,
    encodeListContext, decodeListContext, buildContextListUrl,
    appVersionString,
    // v1.144: the version row's release-notes link (pure, bounded).
    releaseNotesUrl,
    visibleSidebarFolders, resolveDefaultView,
    moveArrayItem, computeDropIndex, rebuildFullFolderOrder,
    // v1.339 S2: sidebar drops persist by path onto the fresh config (T-C1).
    sidebarMoveAnchor, applySidebarMoveByPath, persistSidebarMoveByPath,
    // v1.76: the one drag-to-reorder gesture layer -- the two pure decisions
    // plus the wiring itself, which jsdom tests drive end-to-end through
    // injected rects (jsdom does no layout).
    resolveReorderTarget, computeAutoScrollDelta, wireReorderable,
    REORDER_LONG_PRESS_MS, REORDER_MOUSE_THRESHOLD_PX, REORDER_TOUCH_SLOP_PX,
    REORDER_AUTOSCROLL_EDGE_PX, REORDER_AUTOSCROLL_STEP_PX,
    isSyntheticFolder,
    shouldInjectOneOffButton, reduceOneOffFiletypeOptions, buildOneOffDownloadBody,
    formatOneOffStatusText, buildOneOffModal,
    ONEOFF_FORMAT_OPTIONS, ONEOFF_QUALITY_OPTIONS, ONEOFF_DEFAULT_QUALITY,
    ONEOFF_FILETYPE_OPTIONS, ONEOFF_DEFAULT_FILETYPE, ONEOFF_STATUS_POLL_MS,
    // v1.26 "real progress": the modal's progress-bar reducer + adaptive
    // fast-poll cadence/reducer.
    ONEOFF_STATUS_POLL_FAST_MS, computeOneOffPollDelayMs, computeOneOffProgressBar,
    // v1.26 code-review fix (F4/F5): staleness gate + failure-backoff cap +
    // reducer for the modal's own poller.
    ACTIVE_ENTRY_STALE_MS, isFreshlyActiveEntry, ONEOFF_STATUS_POLL_MAX_MS, nextOneOffPollDelayMs,
    decideOneOffTerminalAction, applyOneOffTerminalAction, triggerLibraryRescanAndRefresh,
    injectOneOffDownloadButtonIfEnabled,
    showToast, deleteResultToast,
    // UI pass D8.1: the era flourish (fabricated stats) mechanism.
    ERA_FLOURISH_ERAS, eraShowsFabricated, applyEraFlourish, isFabricatedViewCount,
    ROTATE_LOG_KEY, ROTATE_LOG_CAP, ROTATE_LOG_MS, rotateSample, installRotateDebug, uninstallRotateDebug, // v1.350: the ?debugRotate=1 ring buffer (v1.355: + the Settings switch's OFF)
    STILLNESS_MS, installResizeStillness, // UI pass D7: html.no-motion around a rotate / resize
    deriveRouteView, shouldInterceptLinkClick, buildHistoryState, parseHistoryState, popStateDelegate,
    // v1.47.4 item 2: the pure zoom-policy decision + the viewport contents it
    // selects between, exported so tests assert the reader carve-out against the
    // real values rather than hardcoded duplicates.
    pinchZoomAllowedForView, ZOOM_ALLOWED_VIEW, VIEWPORT_ZOOM_LOCKED, VIEWPORT_ZOOM_FREE,
    // v1.47.4 item 4: injector idempotency + the shell singleton invariant.
    subscriptionsNavAlreadyInjected, findDuplicateShellSingletons, SHELL_SINGLETON_SELECTORS,
    // v1.47.4 item 5: the touch-target describer (the overlay instrument's
    // pure half).
    describeTouchTarget,
    // v1.47.4 item 6: the pure session-restore decisions.
    isRestorableSessionUrl, shouldRestoreSession, LAST_SESSION_KEY, LAST_SESSION_MAX_AGE_MS,
    // v1.47.8: the keyboard-shortcuts reference.
    KEYBOARD_SHORTCUT_GROUPS, SHORTCUT_KEY_ICONS, shouldOpenShortcuts, buildShortcutsModal,
    // v1.163: the DDR easter-egg mini-synth (pure key->note map + the synth).
    DDR_ARROWS, ddrNoteForArrow, playDdrNote,
    // v1.166: Sneaky critter mode - the pure core + the jsdom-testable DOM shims.
    CRITTER_DENSITY_COUNTS, CRITTER_BUILTINS, CRITTER_ANCHOR_SELECTORS, CRITTER_EXCLUSION_SELECTORS,
    CRITTER_REACTIONS, resolveCritterConfig, planCritterScatter, critterTapHit, critterOccludedAt,
    renderCritterPlacements, scatterCritters, applyCritterMode, playCritterChirp,
    ensureCritterLayer,
    // v1.167: button priority + the fixed-subtree guard (+ the collector, so
    // the WIRING of both is behaviourally bound, not just the helper - gate PNB).
    CRITTER_PRIORITY_SELECTORS, CRITTER_PRIORITY_WEIGHT, critterInsideFixed, critterInsideScroller, collectCritterRects,
    // v1.168: the sandwich clip (behind ONE anchor, above everything else).
    buildCritterClip,
    buildCritterRoundMask,
    critterSettleAction,
    warmCritterAssets,
    reglueCritterPlacements, critterSuppressedByPlayer,
    // v1.182 settle-before-reveal: the wait phase (driven end-to-end in tests).
    scheduleCritterScatter, critterPageLoading, disconnectCritterWait, revealCritterScatter,
    setCritterTimingForTest,
    // v1.184/v1.185 sound pool + the random-each-tap pick.
    buildCritterSoundPool, pickCritterRandomSound, playCritterSound, setCritterSoundPoolForTest,
    // v1.311.2: drive the real tap listener over a real button.
    wireCritterListeners, setCritterPlacementsForTest,
    CRITTER_STORAGE_RANDOMSOUND,
    // v1.187: critter size choice + the pure rect-overlap helper (so the
    // invariant tests can assert exclusion clearance directly).
    CRITTER_SIZE_SCALES, CRITTER_STORAGE_SIZE, critterRectsIntersect,
    // v1.193: the "light kiss" experimental overlap pref + its area-budget helper.
    CRITTER_STORAGE_KISS, CRITTER_KISS_FRACTION, critterOverlapExceeds,
    buildCritterShaveMask,
    probeCritterVoices,
    // v1.311.2: the "never block a button" predicate (critter taps over these pass through).
    critterOverInteractive, CRITTER_INTERACTIVE_SELECTORS, critterPageScrollY,
    getCritterLastChirpReason,
    // v1.50.3: the D dark/light toggle's pure decision.
    shouldToggleThemeKey,
    openShortcutsModal, closeShortcutsModal, isDesktopViewport, SHORTCUTS_DESKTOP_QUERY,
    // Consumed cross-file via `window` (read.js stands its page-flip arrows
    // down while the dialog is open), so it is exported here too rather than
    // reading as an unused local.
    isShortcutsModalOpen,
    shouldDockOnTransition, isSameLocationNav, toPathAndQuery, isStaleNavGeneration,
    // v1.45.0 (T2): incremental-pop Home helpers.
    nextHistoryDepth, resolveHomeButtonAction, isHomeRootTarget,
    // v1.362 (M7): the minimize landing (the last browse level).
    browseDepthBehind, resolveMinimizeLanding,
    // v1.160/.3: the swipe-back decision (pure; the wiring is DOM/device). v1.160.3
    // dropped the edge-start requirement - a rightward horizontal drag from
    // anywhere goes back.
    decideSwipeBack,
    // v1.160.1: the "claim the horizontal drag" decision (pure).
    swipeBackShouldClaim,
    // v1.160.3: the horizontal-scroller guard predicate (pure; the wiring walks
    // the ancestor chain with it so a drag inside a wide table/pill strip scrolls
    // instead of going back).
    isHorizontalScrollerBox,
    // v1.311.2: the gesture-owner stand-down + the lifted wiring (driven in tests).
    SWIPE_BACK_OWNER_SELECTORS, touchActionOwnsHorizontal, SWIPE_BACK_NET_EXEMPT_ROOT,
    swipeBackStandDownReason, wireSwipeBackGesture,
    canonicalizeChannelUrl, channelIdentityMatches, resolveFileChannelIdentity,
    shouldShowSubscribeButton, decideSubscribeButtonState,
    buildSubscribeRequestBody, buildSubscribeModal,
    // v1.25 QoL (T5): cutoffDate <-> <input type="date"> converters.
    cutoffDateToDateInput, dateInputToCutoffDate,
    derivePinnedPlaylistEntries, renderPinnedSidebar, renderPinnedPlaylists, fetchAllPins,
    isYtdlpManagedItem,
    // v1.24.0 (T9): C1 move-files client picker.
    showMoveModal, requestMoveItem,
    // pocket menus gate r1 K2: the library-changed seam + the chapters editor that raises it.
    LIBRARY_CHANGED_EVENT, notifyLibraryChanged, // showChaptersEditor is exported with the Chapter Snap group above
    nextDownloadChipPollDelay, buildOneShotRetryBody, chipItemLifecycle,
    buildDownloadChipItem, reduceDownloadChipState, formatDownloadChipSummary,
    ACTIVITY_CHIP_LABELS, formatActivityStatusText,
    setActionStatus, setButtonBusy, wireMasterDetail,
    shouldShowDownloadChipOnPath, injectDownloadStatusChip,
    // v1.29.0 T8: the pure done-edge detector + the in-place library-refresh
    // hook invoker, exported for direct node:test coverage (no DOM/timers).
    detectNewlyDoneOneShots, refreshLibraryInPlace,
    // v1.30.0 T8 (B1, AC5.1-AC5.4): the persistent dirty-flag + pending-
    // jobId helpers backing "never silently drop a one-shot done-edge",
    // exported for direct node:test coverage.
    markHomeGridDirty, isHomeGridDirty, clearHomeGridDirty,
    getPendingOneShotJobIds, setPendingOneShotJobIds,
    computeActiveOneShotJobIds, detectCompletedPendingOneShots,
    // v1.26 code-review fix (F2): panel diff-update helpers (row identity
    // reuse across poll ticks), exported for direct node:test coverage
    // against a fake DOM.
    createDownloadChipItemRow, updateDownloadChipItemRow, updateDownloadChipPanel,
    // v1.26 "real progress": the chip's adaptive fast-poll snapshot check.
    DL_CHIP_POLL_FAST_MS, snapshotHasActiveDownload,
    // v1.24.8: honest per-channel chip labels (channel `name` over the
    // generic literal) + a real-percent-only row gate.
    downloadChipItemShowsPercent,
    // v1.24.0 A2 (T14): per-item download-failure attribution chip render.
    buildDownloadChipFailureLines,
    // v1.24.0 (T3): C2 item count, C3 format toggle, C5 release-date sort
    // case (folded into sortItems above), F1 avatar fallback.
    countItems, formatItemCountLabel, renderItemCountBadge,
    getStoredFormatFilter, setStoredFormatFilter, filterByMediaType,
    // v1.45.6 (Dean): library view-mode + per-page-sort helpers.
    getStoredViewMode, setStoredViewMode,
    isPerPageSortEnabled, setPerPageSortEnabled, pageSortKey, getPerPageSort, setPerPageSort,
    pullRefreshState, pullIsHorizontalDrag,
    FORMAT_FILTER_MODES, FORMAT_TOGGLE_OPTIONS,
    // v1.50: the watched-state filter (the format filter's sibling).
    WATCH_TOGGLE_MODES, WATCH_TOGGLE_OPTIONS, getStoredWatchFilter, setStoredWatchFilter,
    // v1.149: the search scope (no storage - caller-owned state); v1.205: the type.
    SEARCH_SCOPE_MODES, SEARCH_SCOPE_OPTIONS, normalizeSearchScopeMode,
    SEARCH_TYPE_CHIPS, SEARCH_TYPE_OPTIONS, normalizeSearchTypeChip,
    // UI pass sweep S2 (F19): the ONE library filter chip row.
    buildFilterChipRow,
    // v1.150: the search-box clear X (pure predicate + injector).
    shouldShowSearchClear, injectSearchClearButton, shouldClearSearchInputAfterResults,
    deriveAvatar, resolveAvatarSource, AVATAR_PALETTE,
    // v1.24.1 (B1 fast-follow): relocated "Re-pull this channel now" widget.
    REPULL_BTN_ID, findRepullSubscriptionForRoot, shouldShowRepullButton,
    ensureRepullButton, removeRepullButton, reconcileRepullButton,
    fetchSubscriptionsForRepull, probeAndReconcileRepullButton,
    // v1.26.2 polish (sheet/modal transitions): shared open/close animation
    // helpers, exported for direct node:test coverage against a fake DOM.
    // v1.26.2 code-review fix (F2): exported for direct node:test coverage
    // of the settled-guard double-click fix (showMoveModal was already
    // exported above).
    showConfirmModal,
    // v1.26.3 (Item 2/3): shared empty-state / error-state card builders.
    buildEmptyStateHtml, buildErrorStateHtml, uiStateHtml,
    // v1.51: the notification bell's pure decisions.
    shouldInjectNotificationBell, formatNotificationBadge, buildNotificationRowModel,
    // Sweep S4 (D8.3): the row menu's items and the delete confirm's copy (pure).
    buildNotificationMenuItems, notifDeleteConfirmCopy, notifShowHref,
    // v1.68: the real injector, exported so the panel's row actions (sweep S4: the menu, the swipe and the delete confirm) are
    // bound by EXECUTION in jsdom (the history-nav-gate pattern), plus the
    // poll stand-down hook its harness needs (a pending badge-poll timer is
    // a NODE timer that would outlive the test's document).
    injectNotificationBellIfEnabled,
    __stopNotificationBellPollForTests() {
      if (typeof __notifBellPollStopForTests === 'function') __notifBellPollStopForTests();
      __notifBellPollStopForTests = null;
    },
    // v1.68 (ruling 4): the delivered-banner closer, executed in tests
    // against a stubbed registration.
    closeDeliveredPushBanners,
    // v1.52: the instant-watch seed stash (single-entry, id-matched, aged) +
    // the pure paint-plan builder the watch painter applies verbatim.
    stashWatchSeed, consumeWatchSeed, deriveWatchPaintPlan, isFullWatchSeedItem,
    // v1.54: subscriber-label pure helpers.
    formatCompactCount, resolveSubscriberLabel, formatViewCountCaptureDate,
    // v1.53: the shared attribution picker (DOM thin-shell; wiring-locked).
    showAttributionPicker,
    // v1.53: the capability cache's pure gate + accessors.
    sanitizeCapabilityCache, readCapabilityCache, writeCapabilityCache, scrubSubsForCache,
  };
}
