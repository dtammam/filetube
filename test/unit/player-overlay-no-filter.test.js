'use strict';

// [UNIT] v1.361 - no filter, backdrop, mask or blend on the player or anything drawn over it.
// The tap glyph's `filter: drop-shadow`, flashed over a PLAYING video on every picture tap, is the
// suspect for the iPhone black picture on iOS 27 (Dean, 2026-10-03: bar-button-only pause/play never
// went black, picture taps did; sound and the ambient glow ran on). LESSONS 7 holds the class (v1.312:
// a filter / blur / mask / backdrop over or around a playing video blacks it out on the iPhone).
//
// The selector net is DERIVED from the real host markup: every id and class on #player-wrapper and on
// each element inside it in public/watch.html (the template every shell clones), plus the `video`
// element type and the shell-owned hosts the wrapper is reparented into. A rule whose selector names
// any of them, in any stylesheet (inside @media / @supports too), fails on any of the properties.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const CSS_DIR = path.join(PUB, 'css');
const LAYER_PROPS = /(^|[\s;{])(-webkit-)?(filter|backdrop-filter|mask(-[a-z-]+)?|mix-blend-mode)\s*:/i;
const HOSTS = ['player-dock', 'fs-stage']; // the shells the wrapper is reparented into (dock, desktop fullscreen)

function playerNames() {
  const html = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8');
  const start = html.indexOf('id="player-wrapper"');
  assert.ok(start !== -1, 'the host template');
  // walk the wrapper's subtree by tag depth
  const open = html.lastIndexOf('<', start);
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  tagRe.lastIndex = open;
  const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
  const ids = new Set(), classes = new Set();
  let depth = 0, m;
  while ((m = tagRe.exec(html))) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) { depth--; if (depth === 0) break; continue; }
    const id = /\bid="([^"]+)"/.exec(attrs);
    if (id) ids.add(id[1]);
    const cls = /\bclass="([^"]+)"/.exec(attrs);
    if (cls) cls[1].split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    if (!selfClose && !VOID.test(tag)) depth++;
  }
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
