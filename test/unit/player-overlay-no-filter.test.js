'use strict';

// [UNIT] v1.361 - no filter, backdrop or mask on the player or anything drawn over it.
// The tap glyph's `filter: drop-shadow`, flashed over a PLAYING video on every picture tap, is the
// suspect for the iPhone black picture on iOS 27 (Dean, 2026-10-03: bar-button-only pause/play never
// went black, picture taps did; sound and the ambient glow ran on). LESSONS 7 already holds the class
// (v1.312: a filter / blur / mask / backdrop over or around a playing video blacks it out on the
// iPhone). This lock reads every rule in every stylesheet whose selector names the player host, the
// video, or an overlay inside it, and fails on any of those properties.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_DIR = path.join(__dirname, '..', '..', 'public', 'css');
const PLAYER_SELECTOR = /#player-wrapper|#media-player|\.art-play-glyph|\.skip-ripple|#speed-badge|#transcode-overlay|\.player-controls|#player-dock|#fs-stage/;
const LAYER_PROPS = /(^|[\s;{])(-webkit-)?(filter|backdrop-filter|mask|mask-image|mix-blend-mode)\s*:/;

function rules(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2], line: clean.slice(0, m.index).split('\n').length });
  return out;
}

test('no filter / backdrop-filter / mask / blend on the player host, the video or any overlay drawn over it (every stylesheet)', () => {
  const files = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
  assert.ok(files.includes('style.css'), 'read the real stylesheets');
  const hits = [];
  let seen = 0;
  for (const f of files) {
    for (const r of rules(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'))) {
      if (!PLAYER_SELECTOR.test(r.selector)) continue;
      seen++;
      if (LAYER_PROPS.test(r.body)) hits.push(f + ':' + r.line + ' ' + r.selector.slice(-80));
    }
  }
  assert.ok(seen > 50, 'the selector net is not vacuous (' + seen + ' player rules read)');
  assert.deepStrictEqual(hits, []);
});

test('the tap glyph keeps a painted legibility backing (a radial-gradient disc), not a shadow filter', () => {
  const css = fs.readFileSync(path.join(CSS_DIR, 'style.css'), 'utf8');
  const glyph = rules(css).filter((r) => r.selector === '.art-play-glyph');
  assert.ok(glyph.some((r) => /background:\s*radial-gradient\(circle, var\(--scrim\)/.test(r.body)), 'the disc');
  const before = rules(css).filter((r) => r.selector === '.art-play-glyph::before');
  assert.ok(before.length >= 1 && before.every((r) => !/filter/.test(r.body)), 'no filter on the glyph art');
});
