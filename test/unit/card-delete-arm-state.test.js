'use strict';

// [UNIT] v1.17.0 FR-3(b), T2 -- the card trash-can's two-tap arm, RETIRED.
//
// `nextArmState` was the pure "first tap arms, second tap confirms" reducer behind the home
// card's inline "Sure?" (main.js) and, last, the Stats table's delete. Sweep S2 moved the card
// delete onto ONE danger ui.confirm (D4.8, F28: a confirmation never grows in place), and retire
// R3 did the same for Stats. Step 7 (UI pass, DELIBERATE conversion) deleted the reducer with its
// last caller; its state-machine tests went with it. Bound here: it stays gone - no definition,
// export or call anywhere in the app - so an in-row arm cannot quietly come back on it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

test('step 7: nextArmState is retired - not exported, not defined, not called in public/ or lib/', () => {
  delete require.cache[require.resolve('../../public/js/common.js')];
  const common = require('../../public/js/common.js');
  assert.strictEqual(common.nextArmState, undefined, 'not exported');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'assets' && e.name !== 'fonts') walk(p); } else if (/\.(js|html)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'public'));
  walk(path.join(ROOT, 'lib'));
  assert.ok(files.length > 20, 'the scan reached the tree');
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /\bnextArmState\b/, path.relative(ROOT, f) + ': no definition or call');
  }
});
