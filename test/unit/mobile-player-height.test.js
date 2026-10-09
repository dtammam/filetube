'use strict';

// [UNIT] v1.13.0 item 2 (AC5/AC7) -- the mobile-PORTRAIT player height cap.
// The visual correctness itself is Dean's on-device call (AC6); this is the
// mechanical CSS-presence guard: a media query scoped to a narrow, PORTRAIT
// viewport sets `.player-container`'s `max-height` to a value in the
// requested 40vh-50vh range, and desktop/landscape are left alone (no
// unscoped `.player-container { max-height: ... }` rule exists outside that
// query).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

test('mobile player height: a portrait-scoped media query sets .player-container max-height between 40vh and 50vh', () => {
  // Match an `@media (... ) and (orientation: portrait) { ... .player-container { ... max-height: <N>vh ... } ... }`
  // block -- deliberately permissive about exact media-query syntax/ordering,
  // strict about the selector + property + value range.
  const mediaBlockRe = /@media[^{]*orientation:\s*portrait[^{]*\{([\s\S]*?)\n\}/g;
  let found = null;
  let match;
  while ((match = mediaBlockRe.exec(css)) !== null) {
    const block = match[1];
    const rule = /\.player-container\s*\{[^}]*max-height:\s*(\d+(?:\.\d+)?)vh/.exec(block);
    if (rule) {
      found = Number(rule[1]);
      break;
    }
  }
  assert.ok(found !== null, 'expected a portrait-scoped @media block setting .player-container max-height in vh');
  assert.ok(found >= 40 && found <= 50, `expected the portrait max-height (${found}vh) to be within the 40-50vh target range`);
});

test('mobile player height: the base (unscoped) .player-container rule carries no max-height (desktop/base behavior untouched)', () => {
  const baseRuleMatch = /(?:^|\n)\.player-container\s*\{([^}]*)\}/.exec(css);
  assert.ok(baseRuleMatch, 'expected to find the base .player-container rule');
  assert.ok(!/max-height/.test(baseRuleMatch[1]), 'the unscoped base .player-container rule must not itself cap max-height');
  // The aspect-ratio + object-fit:contain letterboxing this cap relies on
  // must still be present and unchanged.
  assert.match(baseRuleMatch[1], /aspect-ratio:\s*16\/9/);
});

test('mobile player height: the landscape-orientation media query does not touch .player-container (landscape unaffected)', () => {
  const landscapeBlockRe = /@media[^{]*orientation:\s*landscape[^{]*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = landscapeBlockRe.exec(css)) !== null) {
    assert.ok(!/\.player-container/.test(match[1]), 'a landscape media query must not style .player-container');
  }
});

test('mobile player height: the audio-mode/.audio-bg-art rules are untouched by this change (still present, unscoped by any new media query)', () => {
  // v1.21 FR-2 (T2) additively extended this rule with pointer-events/cursor
  // (the cover-art click-to-play surface) -- still asserting the same core
  // "audio mode reveals the art" declaration this test has always guarded,
  // just no longer requiring it to be the ONLY declaration in the block.
  assert.match(css, /#player-wrapper\.audio-mode #audio-bg-art\s*\{[^}]*display:\s*block;[^}]*\}/);
  assert.match(css, /#player-wrapper\.audio-mode #media-player\s*\{/);
});

// v1.359 (Dean: the phone player spans the screen side to side). The binding is the real-browser
// geometry check BLD (test/geometry); this is the source backstop. Rules are parsed (comments stripped,
// brace-walked, @media flattened) so a COMMENT or a lookalike cannot satisfy it.
function flatRules(src) {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  (function walk(text, mobile, base) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1; let j = open + 1;
      while (j < text.length && depth > 0) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@')) walk(body, mobile || /^@media[^{]*\(max-width:\s*768px\)/.test(head), base + open + 1);
      else out.push({ selector: head.replace(/\s+/g, ' '), body, mobile, index: base + open });
      i = j;
    }
  })(stripped, false, 0);
  return out;
}
const hasDecl = (body, prop, value) => new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*' + value + '\\s*(?:;|$)').test(body);

test('v1.359 mobile edge to edge: one mobile rule drops the wrapper frame, excluding faux full screen and the expanded audio view', () => {
  const rules = flatRules(css);
  const frame = rules.filter((r) => r.selector === '.watch-player-stage #player-wrapper:not(.css-fullscreen):not(.audio-expanded)');
  assert.strictEqual(frame.length, 1, 'exactly one frame-drop rule');
  assert.ok(frame[0].mobile, 'it sits inside @media (max-width: 768px): desktop keeps every era\'s frame');
  assert.ok(hasDecl(frame[0].body, 'border', 'none'), 'border: none');
  assert.ok(hasDecl(frame[0].body, 'border-radius', '0'), 'border-radius: 0');
  // A denylist that fails by default: every rule that paints a border or radius on the wrapper/container is known.
  // A new one is a finding (it may out-rank the drop above in some era or state) until the set is updated on purpose.
  const painters = rules.filter((r) => /#player-wrapper|\.player-container/.test(r.selector) && /(?:^|[;\s])(?:border|border-radius|border-[a-z-]+-radius)\s*:/.test(r.body)).map((r) => (r.mobile ? '@m ' : '') + r.selector).sort();
  assert.deepStrictEqual(painters, [
    '#fs-stage:fullscreen .player-container',
    '#player-dock .player-container',
    '#player-wrapper.audio-mode.audio-expanded',
    '#player-wrapper.css-fullscreen',
    // v1.381.0 (D3): the Feed card's slot drops the frame too (border 0, radius 0: the card is the frame), only inside a Feed card
    '#view-root[data-view="feed"] .feed-card__slot > #player-wrapper',
    '.player-container',
    '.player-container:fullscreen, .player-container:-webkit-full-screen',
    '.reader-nowplaying .player-container',
    '@m .watch-player-stage #player-wrapper:not(.css-fullscreen):not(.audio-expanded)',
  ].sort(), 'the set of rules that paint a border or radius on the player frame');
});

test('v1.359 mobile edge to edge: the reserved frame (#player-slot:empty) drops its outline and radius on a phone, after its base rule', () => {
  const rules = flatRules(css);
  const slot = rules.filter((r) => r.selector === '.watch-container #player-slot:empty');
  const base = slot.filter((r) => !r.mobile);
  const mob = slot.filter((r) => r.mobile);
  assert.strictEqual(base.length, 1, 'one base reserved-frame rule');
  assert.strictEqual(mob.length, 1, 'one mobile reserved-frame rule');
  assert.ok(mob[0].index > base[0].index, 'the mobile rule comes AFTER the base rule (equal specificity: file order decides)');
  assert.ok(hasDecl(mob[0].body, 'border', 'none'), 'border: none');
  assert.ok(hasDecl(mob[0].body, 'border-radius', '0'), 'border-radius: 0');
  assert.ok(hasDecl(base[0].body, 'border', '1px solid var\\(--separator\\)'), 'the base (desktop) frame still has its outline');
});
