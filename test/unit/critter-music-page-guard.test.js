'use strict';

// [UNIT] v1.248 (Dean): critters must NOT scatter over the full-screen mobile skin player. On the
// music page the skin cover (.music-nowplaying-panel -> full-screen .mms-full under body.mms-on)
// is a critter EXCLUSION zone the size of the viewport, so a scatter/re-glue while it's up drops or
// overlays placements (the "weird spots / don't save" bug). The fix: scatterCritters and
// reglueCritterPlacements clear-and-skip while body.mms-on is set, and the music view re-scatters
// on its in-view renders + on the dock-return (source-locked here; those live in music.js).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const {
  critterSuppressedByPlayer, scatterCritters, reglueCritterPlacements,
} = require('../../public/js/common.js');

function withBody(html, fn, { crittersOn = false } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body>' + html + '</body>', { url: 'http://localhost/music' });
  const saved = { document: global.document, window: global.window, localStorage: global.localStorage };
  global.document = dom.window.document; global.window = dom.window;
  // scatterCritters reads the GLOBAL localStorage via resolveCritterConfig(); enable critters so
  // the mms-on GUARD (not the disabled-config branch) is what clears the layer - a real bind.
  global.localStorage = { getItem: (k) => (crittersOn && k === 'ft-critters:on' ? '1' : null), setItem() {}, removeItem() {} };
  try { return fn(dom); } finally { Object.assign(global, saved); }
}

test('critterSuppressedByPlayer: true only while body.mms-on (the full-screen skin) is up', () => {
  withBody('', () => {
    assert.strictEqual(critterSuppressedByPlayer(), false, 'no skin cover -> not suppressed');
    global.document.body.classList.add('mms-on');
    assert.strictEqual(critterSuppressedByPlayer(), true, 'skin cover up -> suppressed');
    global.document.body.classList.remove('mms-on');
    assert.strictEqual(critterSuppressedByPlayer(), false, 'cover down -> not suppressed');
  });
});

test('scatterCritters CLEARS the layer and SKIPS placement while the skin cover is up (critters ENABLED)', () => {
  // critters ENABLED (so absent the guard, scatter would keep/rebuild a layer, not clear it) +
  // the mms-on cover: the GUARD must remove the layer and NOT place. This distinguishes the guard
  // from the disabled-config branch (adversarial SUGGESTION: the prior version was vacuous).
  withBody('<div id="critter-layer"><span class="critter">x</span></div>', () => {
    global.document.body.classList.add('mms-on');
    scatterCritters();
    assert.strictEqual(global.document.getElementById('critter-layer'), null, 'the guard cleared the layer under the cover, even with critters enabled');
  }, { crittersOn: true });
});

test('reglueCritterPlacements also clears + skips under the skin cover (the drift path)', () => {
  withBody('<div id="critter-layer"><span class="critter">x</span></div>', () => {
    global.document.body.classList.add('mms-on');
    reglueCritterPlacements();
    assert.strictEqual(global.document.getElementById('critter-layer'), null, 'a re-glue under the cover clears rather than re-rolls');
  });
});

// ---- source locks: the guard sits FIRST, and the music view re-scatters ----

test('the guard is the FIRST thing scatterCritters/reglueCritterPlacements do (before config/anchor work)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  const scatter = src.slice(src.indexOf('function scatterCritters()'), src.indexOf('function reglueCritterPlacements()'));
  const guardAt = scatter.indexOf('if (critterSuppressedByPlayer()) { clearCritterLayer(); return; }');
  const cfgAt = scatter.indexOf('resolveCritterConfig()');
  assert.ok(guardAt > 0, 'scatterCritters has the cover guard');
  assert.ok(guardAt < cfgAt, 'the guard runs BEFORE resolveCritterConfig (no anchor/config work under the cover)');
  const reglue = src.slice(src.indexOf('function reglueCritterPlacements()'), src.indexOf('function reglueCritterPlacements()') + 500);
  assert.match(reglue, /if \(critterSuppressedByPlayer\(\)\) \{ clearCritterLayer\(\); return; \}/, 'reglue guards on the cover too');
});

test('music.js re-scatters on its in-view render AND on the skin->docked transition (self-skips while mms-on)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  assert.match(src, /if \(window\.FileTube && typeof window\.FileTube\.scheduleCritterScatter === 'function'\) window\.FileTube\.scheduleCritterScatter\(\);/,
    'render() re-scatters after populating #music-content (in-view swaps get no router nav)');
  assert.match(src, /var wasSkin = document\.body\.classList\.contains\('mms-on'\);/, 'the teardown captures the skin->docked transition');
  assert.match(src, /if \(wasSkin && window\.FileTube && typeof window\.FileTube\.scheduleCritterScatter === 'function'\) window\.FileTube\.scheduleCritterScatter\(\);/,
    'dock-return re-scatters, gated on the skin->docked transition');
});
