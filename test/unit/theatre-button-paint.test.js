// v1.363.1 W1 (Dean, 2026-10-05: "the music player's theatre button has its colours flipped").
// The pressed state is aria-pressed (music.js / watch.js / podcasts.js stamp it from their own stored flag),
// and the paint is ONE cascade rule. Measured in headless Chromium before this lock (light + dark x 2009 /
// 2014 / 2021, cold load, SPA hops, round trips): aria-pressed="true" is the accent red and "false" is the
// ink, in every case. This test binds the STATE to the COLOUR through the real stylesheet cascade (jsdom
// resolves author rules, not var()), so a flipped selector, a red unpressed rule or an era override that
// repaints one state goes red. Presence is not binding: mutate the selector to "false" and it must fail.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

function paint(cssText, { era, mode, view, pressed, docked }) {
  const dom = new JSDOM('<!doctype html><html data-theme="' + era + '" data-mode="' + mode + '"><head><style>' + cssText + '</style></head>'
    + '<body data-view="' + view + '"><div id="' + (docked ? 'player-dock' : 'slot') + '"><button id="theater-btn" class="pc-btn theater-btn" aria-pressed="' + pressed + '"></button></div></body></html>');
  const b = dom.window.document.getElementById('theater-btn');
  const cs = dom.window.getComputedStyle(b);
  return { color: cs.color, display: cs.display };
}

const ERAS = ['2009', '2014', '2021'];
const MODES = ['light', 'dark'];
const VIEWS = ['music', 'watch', 'podcasts'];

test('v1.363.1 theatre button paint: ON (aria-pressed true) is the accent red, OFF is never red, in every era, mode and view that owns it', () => {
  let cells = 0;
  for (const era of ERAS) for (const mode of MODES) for (const view of VIEWS) {
    const on = paint(CSS, { era, mode, view, pressed: 'true' });
    const off = paint(CSS, { era, mode, view, pressed: 'false' });
    assert.strictEqual(on.color, 'var(--yt-red)', `${era}/${mode}/${view}: pressed paints the accent`);
    assert.notStrictEqual(off.color, 'var(--yt-red)', `${era}/${mode}/${view}: unpressed is never the accent (got ${off.color})`);
    assert.notStrictEqual(on.color, off.color, `${era}/${mode}/${view}: the two states differ`);
    cells++;
  }
  assert.strictEqual(cells, 18, 'non-vacuity: all 18 cells ran');
});

test('v1.363.1 theatre button paint: the guard binds - a flipped selector or an always-red button goes red here', () => {
  const flipped = CSS.replace('#theater-btn[aria-pressed="true"]', '#theater-btn[aria-pressed="false"]');
  assert.notStrictEqual(flipped, CSS, 'the mutation applied');
  const on = paint(flipped, { era: '2021', mode: 'light', view: 'music', pressed: 'true' });
  const off = paint(flipped, { era: '2021', mode: 'light', view: 'music', pressed: 'false' });
  assert.strictEqual(off.color, 'var(--yt-red)', 'the mutant paints OFF red (what Dean described)');
  assert.notStrictEqual(on.color, 'var(--yt-red)', 'and ON grey - the mutant is a real flip');
  const always = CSS.replace('#theater-btn[aria-pressed="true"]', '#theater-btn');
  assert.strictEqual(paint(always, { era: '2021', mode: 'light', view: 'music', pressed: 'false' }).color, 'var(--yt-red)', 'an unconditional rule paints OFF red');
});
