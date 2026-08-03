'use strict';

// [UNIT] v1.74.0: era-appropriate scrollbars. Pure source-assertion tests
// against style.css (the pinned-avatar-css.test.js pattern), locking the two
// structural subtleties a future edit could silently break:
//
// 1. ENGINE PARTITION: Chromium 121+ implements the standard
//    scrollbar-color/scrollbar-width properties, and specifying EITHER makes
//    Chromium DISCARD all ::-webkit-scrollbar-* styling for that subtree. The
//    standard pair therefore lives ONLY inside
//    `@supports not selector(::-webkit-scrollbar)` (true only in Firefox).
//    An unguarded scrollbar-color anywhere in the file would kill the full
//    era art in Chrome/Edge while every browser still "has styled
//    scrollbars" - invisible in any functional test.
//
// 2. ROOT + DESCENDANT PAIRING: data-theme lives on <html>
//    (applyTheme -> documentElement), and the VIEWPORT scrollbar belongs to
//    <html> itself - a descendant-only selector ([data-theme="X"] ::-w-s)
//    would theme every inner panel but leave the main page scrollbar on the
//    base look. Each era override must carry the no-space root form too.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

function findRule(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  return re.exec(css);
}

// Comment-stripped copy with INDEXES PRESERVED (comments become spaces).
// The v1.50.x lesson, re-learned by this very file's first run: source-lock
// regexes must strip comments - the section header PROSE mentions both the
// @supports marker and the property names, and matching the raw source finds
// the comment first.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));

// The body of the one @supports guard block, extracted by brace matching
// (the block nests rules, so a lazy [^}]* body regex cannot span it).
function supportsGuardRange() {
  const m = /@supports not selector\(::-webkit-scrollbar\)\s*\{/.exec(stripped);
  if (!m) return null;
  let i = stripped.indexOf('{', m.index);
  let depth = 1;
  for (i += 1; i < stripped.length && depth > 0; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') depth--;
  }
  return depth === 0 ? { start: m.index, end: i } : null;
}

test('base ::-webkit-scrollbar family exists and consumes era tokens only', () => {
  const bar = findRule('::-webkit-scrollbar');
  assert.ok(bar, 'expected a base ::-webkit-scrollbar rule');
  assert.match(bar[1], /width:\s*\d+px;/);
  assert.match(bar[1], /height:\s*\d+px;/);

  const track = findRule('::-webkit-scrollbar-track');
  assert.ok(track, 'expected a base ::-webkit-scrollbar-track rule');
  assert.match(track[1], /background:\s*var\(--bg-color\);/);

  const thumb = findRule('::-webkit-scrollbar-thumb');
  assert.ok(thumb, 'expected a base ::-webkit-scrollbar-thumb rule');
  assert.match(thumb[1], /background:\s*var\(--border-dark\);/);
  const corner = findRule('::-webkit-scrollbar-corner');
  assert.ok(corner, 'expected a base ::-webkit-scrollbar-corner rule (two-axis scrollers)');
});

test('base thumb takes its corner shape from --radius-lg, so every era skins the SHAPE without an override (2021 pill / 2005 square / 2009+2014 2px)', () => {
  const thumb = findRule('::-webkit-scrollbar-thumb');
  assert.ok(thumb);
  assert.match(thumb[1], /border-radius:\s*var\(--radius-lg\)/);
});

test('base thumb floats via transparent border + padding-box clip (the modern-2021 gutter)', () => {
  const thumb = findRule('::-webkit-scrollbar-thumb');
  assert.ok(thumb);
  assert.match(thumb[1], /border:\s*\d+px solid transparent;/);
  assert.match(thumb[1], /background-clip:\s*padding-box;/);
});

for (const era of ['2005', '2009', '2014']) {
  test(`era ${era}: every override pairs the root form with the descendant form (the viewport scrollbar lives on <html>, which itself carries data-theme)`, () => {
    for (const pseudo of ['::-webkit-scrollbar-track', '::-webkit-scrollbar-thumb']) {
      const rootForm = `[data-theme="${era}"]${pseudo}`;
      const descForm = `[data-theme="${era}"] ${pseudo}`;
      assert.ok(css.includes(rootForm), `expected ${rootForm} (no space: the root's own bar)`);
      assert.ok(css.includes(descForm), `expected ${descForm} (inner panels)`);
    }
  });

  test(`era ${era}: retro thumbs are flush (background-clip: border-box overrides the base padding-box float)`, () => {
    const rule = findRule(`[data-theme="${era}"] ::-webkit-scrollbar-thumb`);
    assert.ok(rule, `expected an era-${era} thumb rule`);
    assert.match(rule[1], /background-clip:\s*border-box;/);
  });
}

test('2021 has NO era-scoped ::-webkit-scrollbar override: the base rules ARE 2021 Modern, per the :root safe-default contract', () => {
  assert.ok(!css.includes('[data-theme="2021"]::-webkit-scrollbar'));
  assert.ok(!css.includes('[data-theme="2021"] ::-webkit-scrollbar'));
});

test('ENGINE PARTITION: every scrollbar-color and scrollbar-width declaration lives inside @supports not selector(::-webkit-scrollbar) - unguarded, Chromium 121+ discards the whole ::-webkit-scrollbar art', () => {
  const guard = supportsGuardRange();
  assert.ok(guard, 'expected exactly the @supports not selector(::-webkit-scrollbar) guard block');
  for (const prop of ['scrollbar-color', 'scrollbar-width']) {
    const re = new RegExp(`${prop}\\s*:`, 'g');
    let m;
    let count = 0;
    while ((m = re.exec(stripped)) !== null) {
      count++;
      assert.ok(
        m.index > guard.start && m.index < guard.end,
        `${prop} at index ${m.index} sits OUTSIDE the @supports guard - this disables all ::-webkit-scrollbar styling in Chromium`
      );
    }
    assert.ok(count > 0, `expected at least one ${prop} declaration (the Firefox fallback)`);
  }
});

test('Firefox fallback covers the root for every era: a base html rule plus a retro-era override, both setting the standard pair', () => {
  const guard = supportsGuardRange();
  assert.ok(guard);
  const body = stripped.slice(guard.start, guard.end);
  assert.match(body, /html\s*\{[^}]*scrollbar-color:\s*var\(--border-dark\)\s+var\(--bg-color\);[^}]*\}/, 'expected the 2021-look base on html');
  assert.match(body, /\[data-theme="2005"\],\s*\[data-theme="2009"\],\s*\[data-theme="2014"\]\s*\{[^}]*scrollbar-color:\s*var\(--border-dark\)\s+var\(--bg-secondary\);[^}]*\}/, 'expected the retro-era override');
});
