'use strict';

// [UNIT] v1.74.0: era-appropriate scrollbars. Pure source-assertion tests
// against style.css (the pinned-avatar-css.test.js pattern), locking the
// structural subtleties a future edit could silently break:
//
// 1. ENGINE PARTITION: Chromium 121+ implements the standard
//    scrollbar-color/scrollbar-width properties, and specifying EITHER makes
//    Chromium DISCARD all ::-webkit-scrollbar-* styling for that subtree. The
//    standard pair therefore lives ONLY inside
//    `@supports not selector(::-webkit-scrollbar)` (true only in engines
//    without the webkit pseudo - today, Firefox). An unguarded
//    scrollbar-color anywhere in the file would kill the full era art in
//    Chrome/Edge while every browser still "has styled scrollbars" -
//    invisible in any functional test.
//
// 2. ROOT + DESCENDANT PAIRING: data-theme lives on <html>
//    (applyTheme -> documentElement), and the VIEWPORT scrollbar belongs to
//    <html> itself - a descendant-only selector ([data-theme="X"] ::-w-s)
//    would theme every inner panel but leave the main page scrollbar on the
//    base look. Each era override must carry the no-space root form too,
//    for EVERY pseudo it overrides (gate W2: an earlier substring check let
//    a deleted root form survive via the :hover sibling's spelling).
//
// 3. CENSUS BLINDNESS (gate W1, measured): css-token-lint's era/def-layer
//    exclusion is SELECTOR-based (scripts/css-token-lint.js DEF_SELECTOR
//    matches any [data-theme...] selector), so the era-scoped scrollbar
//    rules are invisible to the token ratchet - a raw hex there ships with
//    the census green. The tokens-only test below is the binding lock for
//    this section; the linter-side gap is tech-debt #103.
//
// All source matching runs on a comment-stripped copy - the v1.50.x lesson,
// re-proved by this very file's first run: the section-header PROSE mentions
// the @supports marker and both property names, and raw-source regexes find
// the comment first.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// Comment-stripped copy with INDEXES PRESERVED (comments become spaces).
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findRule(selector) {
  const re = new RegExp(esc(selector) + '\\s*\\{([^}]*)\\}');
  return re.exec(stripped);
}

// True only if `selector` appears as an actual selector (immediately followed
// by `{` or `,`), not as a substring of a longer selector or of prose.
function hasSelector(selector) {
  return new RegExp(esc(selector) + '\\s*[,{]').test(stripped);
}

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

test('base ::-webkit-scrollbar family exists with explicit bar sizing', () => {
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

// Every pseudo each era overrides. 2014 deliberately has NO bar-size
// override (it keeps the base 12px; only construction changes) - encoded
// below, not skipped.
const ERA_PSEUDOS = {
  2005: ['::-webkit-scrollbar', '::-webkit-scrollbar-track', '::-webkit-scrollbar-thumb', '::-webkit-scrollbar-thumb:hover', '::-webkit-scrollbar-corner'],
  2009: ['::-webkit-scrollbar', '::-webkit-scrollbar-track', '::-webkit-scrollbar-thumb', '::-webkit-scrollbar-thumb:hover', '::-webkit-scrollbar-corner'],
  2014: ['::-webkit-scrollbar-track', '::-webkit-scrollbar-thumb', '::-webkit-scrollbar-thumb:hover', '::-webkit-scrollbar-corner'],
};

for (const [era, pseudos] of Object.entries(ERA_PSEUDOS)) {
  test(`era ${era}: EVERY overridden pseudo pairs the root form with the descendant form (the viewport scrollbar lives on <html>, which itself carries data-theme)`, () => {
    for (const pseudo of pseudos) {
      const rootForm = `[data-theme="${era}"]${pseudo}`;
      const descForm = `[data-theme="${era}"] ${pseudo}`;
      assert.ok(hasSelector(rootForm), `expected selector ${rootForm} (no space: the root's own bar)`);
      assert.ok(hasSelector(descForm), `expected selector ${descForm} (inner panels)`);
    }
  });

  test(`era ${era}: retro thumbs are flush (background-clip: border-box overrides the base padding-box float)`, () => {
    const rule = findRule(`[data-theme="${era}"] ::-webkit-scrollbar-thumb`);
    assert.ok(rule, `expected an era-${era} thumb rule`);
    assert.match(rule[1], /background-clip:\s*border-box;/);
  });
}

test('2014 has NO bar-size override (keeps the base 12px - flat era, construction-only changes)', () => {
  assert.ok(!hasSelector('[data-theme="2014"]::-webkit-scrollbar'));
  assert.ok(!hasSelector('[data-theme="2014"] ::-webkit-scrollbar'));
});

test('2021 has NO era-scoped ::-webkit-scrollbar override at all: the base rules ARE 2021 Modern, per the :root safe-default contract', () => {
  assert.ok(!stripped.includes('[data-theme="2021"]::-webkit-scrollbar'));
  assert.ok(!stripped.includes('[data-theme="2021"] ::-webkit-scrollbar'));
});

test('CENSUS-BLINDNESS LOCK (gate W1): the entire scrollbar section carries NO raw color literal - css-token-lint cannot see [data-theme]-scoped rules, so this test is the ratchet for them', () => {
  const guard = supportsGuardRange();
  assert.ok(guard, 'expected the @supports guard (section end marker)');
  const sectionStart = stripped.indexOf('::-webkit-scrollbar');
  assert.ok(sectionStart !== -1 && sectionStart < guard.start, 'expected the webkit rules to precede the guard');
  const section = stripped.slice(sectionStart, guard.end);
  // Sanity: the slice really spans the era-scoped rules the census is blind to.
  assert.ok(section.includes('[data-theme="2005"]::-webkit-scrollbar'), 'section slice must cover the era-scoped rules');
  const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|(?<![\w-])(white|black|gold)(?![\w-])/.exec(section);
  assert.strictEqual(literal, null, `raw color literal in the scrollbar section: "${literal && literal[0]}" - consume an era token instead (the token census is selector-blind here, tech-debt #103)`);
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

test('Firefox fallback: scrollbar-width does NOT inherit (gate W3), so both guard rules pair the root with a * descendant form, and era selectors override the base pair', () => {
  const guard = supportsGuardRange();
  assert.ok(guard);
  const body = stripped.slice(guard.start, guard.end);
  assert.match(
    body,
    /html\s*,\s*html \*\s*\{[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--border-dark\)\s+var\(--bg-color\);[^}]*\}/,
    'expected the 2021-look base on html AND html * (width does not inherit to inner scrollers)'
  );
  assert.match(
    body,
    /\[data-theme="2005"\]\s*,\s*\[data-theme="2005"\] \*\s*,\s*\[data-theme="2009"\]\s*,\s*\[data-theme="2009"\] \*\s*,\s*\[data-theme="2014"\]\s*,\s*\[data-theme="2014"\] \*\s*\{[^}]*scrollbar-width:\s*auto;[^}]*scrollbar-color:\s*var\(--border-dark\)\s+var\(--bg-secondary\);[^}]*\}/,
    'expected the retro-era override with per-era * descendant forms'
  );
});
