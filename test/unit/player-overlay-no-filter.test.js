'use strict';

// [UNIT] v1.361 - no filter, backdrop, mask or blend on the player or anything drawn over it.
// The tap glyph's `filter: drop-shadow`, flashed over a PLAYING video on every picture tap, is the
// suspect for the iPhone black picture on iOS 27 (Dean, 2026-10-03: bar-button-only pause/play never
// went black, picture taps did; sound and the ambient glow ran on). LESSONS 7 holds the class (v1.312:
// a filter / blur / mask / backdrop over or around a playing video blacks it out on the iPhone).
//
// The selector net is DERIVED from the real player: every id and class on #player-wrapper and on each
// element inside it in public/watch.html (the template every shell clones; HTML comments stripped
// first, so a commented-out tag cannot move the walk), every class and id player.js itself builds into
// the player at runtime (the captions overlay, the seek preview, the chapter and speed sheets, the dock
// close), the `video` element type, and the hosts the wrapper is mounted or reparented into. A rule
// whose selector names any of them, in any stylesheet (inside @media / @supports too), fails on any of
// the properties. The net is deliberately wide: a template class shared with the rest of the app (the
// ui-btn / ui-icon primitives inside the bar) is held to the same rule everywhere, which errs safe.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const CSS_DIR = path.join(PUB, 'css');
const LAYER_PROPS = /(^|[\s;{])(-webkit-)?(filter|backdrop-filter|mask(-[a-z-]+)?|mix-blend-mode)\s*:/i;
// the wrapper's mount slots and the shells it is reparented into (watch / reader slot, dock, desktop fullscreen)
const HOSTS = ['player-slot', 'reader-player-slot', 'player-dock', 'fs-stage'];
// player.js's own debug panel is a page-level fixed panel, never drawn into the player
const JS_BUILT_EXCLUDE = new Set(['ui-selectable', 'ft-lifecycle-overlay']);
// Disclosed exceptions (v1.361 gate r2): the app's mask-drawn icon set. `.icon-share` is the share icon in the
// chapters menu, which opens only on request; its mask is the app-wide icon technique (style.css, the
// `.icon-*` family), not an effect painted over the playing picture by the player. Revisit if the
// picture ever blacks out with the chapters menu open.
const EXEMPT_CLASSES = new Set(['icon-share']);

function playerNames() {
  const html = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const start = html.indexOf('id="player-wrapper"');
  assert.ok(start !== -1, 'the host template');
  // walk the wrapper's subtree by tag depth
  const open = html.lastIndexOf('<', start);
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  tagRe.lastIndex = open;
  const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
  const ids = new Set(), classes = new Set();
  let depth = 0, m, closed = false;
  while ((m = tagRe.exec(html))) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) { depth--; if (depth === 0) { closed = true; break; } continue; }
    const id = /\bid="([^"]+)"/.exec(attrs);
    if (id) ids.add(id[1]);
    const cls = /\bclass="([^"]+)"/.exec(attrs);
    if (cls) cls[1].split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    if (!selfClose && !VOID.test(tag)) depth++;
  }
  assert.ok(closed, 'the walk reached the wrapper\'s own closing tag');
  const js = fs.readFileSync(path.join(PUB, 'js', 'player.js'), 'utf8');
  for (const w of js.matchAll(/\.className\s*=\s*'([^']+)'/g)) w[1].split(/\s+/).filter((c) => c && !JS_BUILT_EXCLUDE.has(c) && !EXEMPT_CLASSES.has(c)).forEach((c) => classes.add(c));
  for (const w of js.matchAll(/\.id\s*=\s*'([^']+)'/g)) if (!JS_BUILT_EXCLUDE.has(w[1])) ids.add(w[1]);
  // v1.366.0 (VR / 360): the sphere's canvas is built by vr-view.js inside the host (its class, and the class it puts
  // on the host): in the net too, so a filter on the 360 view's picture reds here like one on the video.
  const vr = fs.readFileSync(path.join(PUB, 'js', 'vr-view.js'), 'utf8');
  for (const w of vr.matchAll(/\.className\s*=\s*'([^']+)'/g)) w[1].split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
  for (const w of vr.matchAll(/classList\.add\('([^']+)'\)/g)) classes.add(w[1]);
  HOSTS.forEach((h) => ids.add(h));
  return { ids, classes };
}

function rules(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2], line: clean.slice(0, m.index).split('\n').length });
  return out;
}

function namesPlayer(selector, names) {
  if (/(^|[\s>+~(,])video\b/i.test(selector)) return true;
  const ids = selector.match(/#[\w-]+/g) || [];
  const cls = selector.match(/\.[\w-]+/g) || [];
  return ids.some((x) => names.ids.has(x.slice(1))) || cls.some((x) => names.classes.has(x.slice(1)));
}

test('the selector net is the real host: it holds the wrapper, the video, the overlays and the controls', () => {
  const n = playerNames();
  ['player-wrapper', 'media-player', 'speed-badge', 'player-dock', 'fs-stage'].forEach((id) => assert.ok(n.ids.has(id), '#' + id));
  ['player-container', 'art-play-glyph', 'skip-ripple', 'speed-badge', 'player-controls'].forEach((c) => assert.ok(n.classes.has(c), '.' + c));
  ['cc-overlay', 'cc-overlay-text', 'seek-preview', 'seek-chapters', 'chapter-now', 'speed-sheet-backdrop', 'player-dock-close'].forEach((c) => assert.ok(n.classes.has(c), 'built by player.js: .' + c));
  ['player-slot', 'bg-audio-sidecar'].forEach((id) => assert.ok(n.ids.has(id), '#' + id));
  ['vr-view-canvas', 'vr-view-on'].forEach((c) => assert.ok(n.classes.has(c), 'built by vr-view.js: .' + c)); // v1.366.0
  ['bottom-nav', 'bottom-nav-item', 'ui-selectable'].forEach((c) => assert.ok(!n.classes.has(c), 'outside the player: .' + c));
  assert.ok(!n.ids.has('ft-lifecycle-overlay'), 'the debug panel is not the player');
  assert.ok(n.ids.size + n.classes.size > 40, 'a real subtree, not one tag (' + (n.ids.size + n.classes.size) + ' names)');
});

test('no filter / backdrop-filter / mask / blend on the player host, the video or any element inside the host (every stylesheet, any case)', () => {
  const names = playerNames();
  const files = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
  assert.ok(files.includes('style.css'), 'read the real stylesheets');
  const hits = [];
  let seen = 0;
  for (const f of files) {
    for (const r of rules(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'))) {
      if (!namesPlayer(r.selector, names)) continue;
      seen++;
      if (LAYER_PROPS.test(r.body)) hits.push(f + ':' + r.line + ' ' + r.selector.slice(-90));
    }
  }
  assert.ok(seen > 100, 'the net is not vacuous (' + seen + ' player rules read)');
  assert.deepStrictEqual(hits, []);
});

test('the tap glyph keeps a painted legibility backing (a radial-gradient disc) that no later rule overrides, and no filter', () => {
  const css = fs.readFileSync(path.join(CSS_DIR, 'style.css'), 'utf8');
  const all = rules(css);
  const withBg = all.filter((r) => r.selector === '.art-play-glyph' && /(^|[\s;{])background(-image)?\s*:/i.test(r.body));
  assert.ok(withBg.length >= 1, 'a background on the glyph');
  assert.match(withBg[withBg.length - 1].body, /background:\s*radial-gradient\(circle, var\(--scrim\)/, 'the LAST one is the disc');
  const glyph = all.filter((r) => /\.art-play-glyph/.test(r.selector));
  assert.deepStrictEqual(glyph.filter((r) => /filter|mask/i.test(r.body)).map((r) => r.line), [], 'no filter or mask on any glyph rule');
});
