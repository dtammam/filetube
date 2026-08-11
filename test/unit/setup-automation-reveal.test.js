'use strict';

// [UNIT] v1.102 shimmer sweep (tranche 4) - the setup Automation toggles no
// longer flash their static default then flip when /api/settings lands. Each of
// the 7 /api/settings-fed toggle rows ships `class="reveal-toggle" data-loading`
// (shimmered, hidden via the shared v1.96 barrier CSS); loadAutomationSettings
// drops `data-loading` from ALL of them on the SINGLE fetch settle - success OR
// error - so they reveal together in final state, never a per-row pop.
//
// Binds the REVEAL (not presence): a jsdom run proves the barrier is cleared and
// the server values applied on success, and cleared on a fetch error; source
// locks prove the 7 rows ship the barrier at first paint, that only
// /api/settings-fed controls carry it (no foreign control early-reveals), and
// that the CSS reuses the shared sweep.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

// The exact set loadAutomationSettings populates from /api/settings - the ONLY
// controls that may carry the barrier (foreign-fetch controls must not, or they
// would reveal early with stale content - the v1.96 partial-render lesson).
const SETTINGS_FED = [
  'autoplay-next-check', 'background-audio-check', 'pre-extract-audio-check',
  'relocate-hydrated-check', 'notifications-enabled-check', 'mobile-custom-player-check',
  'prune-missing-check',
];
// Controls in the SAME card fed by OTHER fetches / localStorage - must NOT be
// barriered by the /api/settings reveal.
const FOREIGN = [
  'home-feed-check', 'modern-mode-check', 'per-page-sort-check', 'debug-lifecycle-check',
  'push-user-enabled-check', 'home-continue-watching-check',
];

// ---- source locks: the barrier ships at first paint, scoped correctly -------

test('setup.html: each /api/settings-fed toggle label ships class="reveal-toggle" data-loading', () => {
  for (const id of SETTINGS_FED) {
    const re = new RegExp('<label class="reveal-toggle" data-loading[^>]*>\\s*\\n\\s*<input type="checkbox" id="' + id + '"');
    assert.match(SETUP_HTML, re, `${id} ships the reveal-once barrier`);
  }
});

test('setup.html: NO foreign-fetch control carries the barrier (no early-reveal partial render)', () => {
  for (const id of FOREIGN) {
    const re = new RegExp('reveal-toggle" data-loading[^>]*>\\s*\\n\\s*<input type="checkbox" id="' + id + '"');
    assert.doesNotMatch(SETUP_HTML, re, `${id} is NOT barriered (foreign fetch)`);
  }
});

test('setup.html: exactly 7 reveal-toggle barriers exist (matches the /api/settings-fed set)', () => {
  assert.strictEqual((SETUP_HTML.match(/class="reveal-toggle" data-loading/g) || []).length, 7);
});

test('style.css: .reveal-toggle[data-loading] reuses the shared v1.96 sweep barrier', () => {
  assert.match(CSS, /\.reveal-toggle\[data-loading\][^]*?background-color: var\(--bg-secondary\)/, 'gets the shimmer base fill');
  assert.match(CSS, /\.reveal-toggle\[data-loading\] \{ color: transparent; \}/, 'label text hidden via transparent colour');
  assert.match(CSS, /\.reveal-toggle\[data-loading\]::after/, 'grouped into the sweep ::after (no duplicated literal)');
  assert.match(CSS, /\.reveal-toggle\[data-loading\] > \* \{ visibility: hidden; \}/, 'the checkbox is hidden until reveal');
});

// ---- behavioural: the reveal actually fires ---------------------------------

function loadSetupInDom() {
  delete global.document; delete global.window; delete global.fetch;
  const labels = SETTINGS_FED.map((id) =>
    `<label class="reveal-toggle" data-loading><input type="checkbox" id="${id}" ${id === 'prune-missing-check' ? 'checked' : ''}/>x</label>`
  ).join('');
  const dom = new JSDOM(`<!DOCTYPE html><body>${labels}</body>`, { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  delete require.cache[require.resolve('../../public/js/setup.js')];
  const mod = require('../../public/js/setup.js');
  return { mod, dom };
}

const barrierCount = (doc) => doc.querySelectorAll('.reveal-toggle[data-loading]').length;

test('loadAutomationSettings: reveals every toggle AND applies the server values (success)', async () => {
  const { mod, dom } = loadSetupInDom();
  assert.strictEqual(barrierCount(dom.window.document), 7, 'all 7 shimmer before the fetch');

  global.fetch = async () => ({
    json: async () => ({
      // default-ON pair sent ON; prune sent OFF (flips from the HTML `checked`);
      // autoplay sent ON (flips from HTML unchecked) - all proving values applied.
      relocateHydratedImports: true, notificationsEnabled: true,
      pruneMissing: false, autoplayNext: true,
      backgroundAudioForVideo: false, preExtractAudio: false, mobileCustomPlayer: false,
    }),
  });
  await mod.loadAutomationSettings();

  assert.strictEqual(barrierCount(dom.window.document), 0, 'every barrier revealed on settle');
  const g = (id) => dom.window.document.getElementById(id).checked;
  assert.strictEqual(g('relocate-hydrated-check'), true, 'default-ON toggle set from server');
  assert.strictEqual(g('notifications-enabled-check'), true);
  assert.strictEqual(g('autoplay-next-check'), true, 'flipped ON from the static default');
  assert.strictEqual(g('prune-missing-check'), false, 'flipped OFF from the static `checked`');
  dom.window.close();
});

test('loadAutomationSettings: reveals every toggle even when the fetch throws (finally)', async () => {
  const { mod, dom } = loadSetupInDom();
  global.fetch = async () => { throw new Error('network down'); };
  await mod.loadAutomationSettings();
  assert.strictEqual(barrierCount(dom.window.document), 0,
    'a failed /api/settings still reveals the toggles (usable static-default fallback, never a forever-shimmer)');
  dom.window.close();
});

test('revealAutomationToggles: idempotent, clears all data-loading', () => {
  const { mod, dom } = loadSetupInDom();
  mod.revealAutomationToggles();
  assert.strictEqual(barrierCount(dom.window.document), 0);
  mod.revealAutomationToggles(); // second call is a harmless no-op
  assert.strictEqual(barrierCount(dom.window.document), 0);
  dom.window.close();
});
