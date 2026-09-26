'use strict';

// [UNIT] v1.336 (Dean, 2026-09-26; plan docs/exec-plans/active/2026-09-26-fullscreen-black-and-border.md).
//  D2 "in full screen, in all modes, I see a very thin white border around the entire screen": the base
//     `.player-container` 1px --border-color border (and its era radius) survived into every fullscreen.
//     Measured by scripts/faux-fullscreen-probe.js: 24 of 24 combos painted it before, 0 after. These
//     locks bind the CSS; the probe is the rendered measurement.
//  D1 "after I pause or resume, pause and resume again, the screen of the video goes black": not
//     reproducible off the iPhone, so this wave ships the INSTRUMENT (the video's own state in the
//     ?debugLifecycle=1 log), never a theory-fix (LESSONS 1).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { formatVideoStateDetail } = require('../../public/js/player.js');

const ROOT = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const PLAYER_JS = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');

// the declaration block of the rule whose selector list is EXACTLY `selector` (comments stripped)
function ruleBody(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  const m = new RegExp('(?:^|})\\s*' + esc + '\\s*\\{([^}]*)\\}').exec(CSS);
  return m ? m[1] : null;
}

// ---- D2: every fullscreen drops the inline border and radius ------------------

const FULLSCREEN_RULES = [
  '#player-wrapper.css-fullscreen', // the iPhone faux overlay (Dean's device)
  '.player-container:fullscreen,\n.player-container:-webkit-full-screen', // the un-staged Fullscreen API host
  '#fs-stage:fullscreen .player-container', // the staged desktop twin (v1.138)
];

for (const sel of FULLSCREEN_RULES) {
  test(`D2: ${sel.replace(/\n/g, ' ')} sets border:none and border-radius:0`, () => {
    const body = ruleBody(sel);
    assert.ok(body, 'the rule exists');
    assert.match(body, /(?:^|;)\s*border:\s*none;/, 'border: none');
    assert.match(body, /(?:^|;)\s*border-radius:\s*0;/, 'border-radius: 0');
  });
}

test('D2: the INLINE player keeps its 1px border (only fullscreen changed)', () => {
  const body = ruleBody('.player-container');
  assert.ok(body, 'the base rule exists');
  assert.match(body, /border:\s*1px solid var\(--border-color\);/);
  assert.match(body, /border-radius:\s*var\(--radius-lg\);/);
});

// ---- D1: the instrument's detail line (pure) ---------------------------------

test('formatVideoStateDetail: a full reading, in the fixed field order', () => {
  assert.strictEqual(
    formatVideoStateDetail({ rs: 4, ns: 1, paused: false, vw: 1920, vh: 1080, t: 12.34, frames: 345, dropped: 2, decoded: 340,
      pm: 'inline', act: 'video', bg: 'INLINE_VIDEO', fs: true, ah: false, amb: true, lock: true, ld: 3 }),
    'rs=4 ns=1 p=0 wh=1920x1080 t=12.3 f=345/2 dec=340 pm=inline act=video bg=INLINE_VIDEO fs=1 ah=0 amb=1 lock=1 ld=3');
});

test('formatVideoStateDetail: a property the engine lacks reads "-", never NaN or undefined', () => {
  const s = formatVideoStateDetail({ rs: 2, paused: true, vw: 0, vh: 0, t: NaN, frames: null, decoded: undefined });
  assert.match(s, /^rs=2 ns=- p=1 wh=0x0 t=- f=-\/- dec=- pm=- act=\? bg=\? fs=0 ah=0 amb=0 lock=0 ld=-$/);
  assert.doesNotMatch(s, /NaN|undefined|null/);
  assert.doesNotMatch(formatVideoStateDetail(undefined), /NaN|undefined|null/);
});

test('formatVideoStateDetail: dc (display-composited frames) appears only when the engine exposes it', () => {
  assert.match(formatVideoStateDetail({ frames: 90, dropped: 0, decoded: 0, composited: 88 }), / f=90\/0 dec=0 dc=88 pm=/);
  assert.doesNotMatch(formatVideoStateDetail({ frames: 90 }), / dc=/);
});

test('formatVideoStateDetail: an error code and the check deltas are appended only when present', () => {
  assert.match(formatVideoStateDetail({ err: 3 }), / err=3$/);
  assert.doesNotMatch(formatVideoStateDetail({}), /err=|\+f=/);
  // the black-picture signature: media time ran 2.0s, zero frames decoded
  assert.match(formatVideoStateDetail({ delta: { frames: 0, decoded: 0, t: 2.01 } }), / \+f=0 \+dec=0 \+t=2\.0$/);
  assert.match(formatVideoStateDetail({ delta: { frames: null, decoded: 48, t: 2 } }), / \+f=- \+dec=48 \+t=2\.0$/);
});

// ---- D1: the wiring (source locks; the probe drives the real events) ---------

function fnBody(name) {
  const start = PLAYER_JS.indexOf('function ' + name + '(');
  assert.ok(start !== -1, name + ' exists');
  const end = PLAYER_JS.indexOf('\n  }\n', start);
  return PLAYER_JS.slice(start, end);
}

test('the instrument is wired on every event that can start, stop or starve the picture', () => {
  const m = /\[([^\]]*)\]\.forEach\(function \(evName\) \{\s*mediaPlayer\.addEventListener\(evName, function \(\) \{ recordVideoState\(evName\); \}\);/.exec(PLAYER_JS);
  assert.ok(m, 'one forEach wiring onto the video element');
  const evs = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  for (const e of ['pause', 'playing', 'waiting', 'stalled', 'emptied', 'error', 'resize', 'loadstart', 'webkitpresentationmodechanged']) {
    assert.ok(evs.includes(e), 'wired: ' + e);
  }
});

test('the instrument is a no-op until ?debugLifecycle=1 (the flag is checked BEFORE any read)', () => {
  const body = fnBody('recordVideoState');
  const gate = body.indexOf('if (!isDebugLifecycleEnabled() || !mediaPlayer) return;');
  assert.ok(gate !== -1, 'the gate');
  assert.ok(gate < body.indexOf('readVideoState()'), 'gate precedes the first read');
  assert.match(body, /if \(!isDebugLifecycleEnabled\(\) \|\| !mediaPlayer \|\| loadGeneration !== s\.ld\) return;/, 'the delayed check re-gates (flag, and a newer load)');
  assert.match(body, /if \(videoStateCheckTimer\) clearTimeout\(videoStateCheckTimer\);/, 'one pending check at a time');
});

test('the instrument is PASSIVE: no requestVideoFrameCallback / canvas read of the video anywhere in player.js', () => {
  // in WebKit both attach a video output to the player - the v1.312 ambient blackout's shape
  const code = PLAYER_JS.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /requestVideoFrameCallback\s*\(/);
  assert.doesNotMatch(code, /drawImage\s*\(/);
  const body = fnBody('readVideoState');
  assert.doesNotMatch(body, /\.(play|pause|load)\(|currentTime\s*=|\.src\s*=|setAttribute|classList\.(add|remove|toggle)/, 'reads only');
});
