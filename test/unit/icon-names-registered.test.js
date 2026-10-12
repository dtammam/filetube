'use strict';
// v1.387.2: every icon name the client code spells out must exist in the icon registry, in every style. ui.icon throws
// on an unknown name by design (ui.js checkIcon, F39), so a missing glyph does not draw a blank: it aborts the whole
// menu or row it sits in. v1.387.0's offline rows named two glyphs the registry never had, and every "More" menu and
// the "You" menu went dead inside the iOS app; the unit tests compared the name as a string and never met the registry.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', '..', 'public', 'js');
const icons = require(path.join(JS, 'icons.js'));
const NAME = /^[a-z][a-z0-9_]*(\.fill)?$/;

// The call shapes that hand a literal name to the icon helpers: an `icon:` property (both arms of a ternary count),
// U.icon / ui.icon, and music's songIconHtml.
function namesIn(src) {
  const out = new Set();
  const lit = /'([^'\n]+)'/g;
  for (const m of src.matchAll(/\bicon\s*:\s*([^,}\n]*)/g)) {
    // A literal right after a comparison is the condition's operand (`variant === 'danger'`, `typeof x === 'string'`),
    // not a name the expression can yield.
    const expr = m[1].replace(/[!=]==?\s*'[^'\n]*'/g, '');
    for (const l of expr.matchAll(lit)) if (NAME.test(l[1])) out.add(l[1]);
  }
  for (const m of src.matchAll(/\b(?:U|ui)\.icon\(\s*'([^']+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/\bsongIconHtml\(\s*'([^']+)'/g)) out.add(m[1]);
  return out;
}

test('v1.387.2: every icon name spelled in public/js is in the registry', () => {
  const missing = [];
  let seen = 0;
  for (const f of fs.readdirSync(JS).filter((n) => n.endsWith('.js') && n !== 'icons.js')) {
    for (const name of namesIn(fs.readFileSync(path.join(JS, f), 'utf8'))) {
      seen++;
      if (!icons.has(name)) missing.push(f + ': ' + name);
    }
  }
  assert.ok(seen > 50, 'the scan found only ' + seen + ' names - the patterns no longer match the code');
  assert.deepStrictEqual(missing, []);
});

test('v1.387.2: the offline rows use registered glyphs (the names that broke the app menus are gone)', () => {
  for (const n of ['download', 'delete']) assert.ok(icons.has(n), n);
  const all = fs.readdirSync(JS).filter((n) => n.endsWith('.js')).map((n) => fs.readFileSync(path.join(JS, n), 'utf8')).join('\n');
  assert.ok(!/'download_for_offline'|'offline_pin'/.test(all), 'an unregistered offline glyph is back');
});
