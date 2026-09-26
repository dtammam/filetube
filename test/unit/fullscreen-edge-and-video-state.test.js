'use strict';

// [UNIT] v1.336 (Dean, 2026-09-26; plan docs/exec-plans/completed/2026-09-26-fullscreen-black-and-border.md).
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
const { formatVideoStateDetail, videoStateDelta, formatFrameSeries } = require('../../public/js/player.js');

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

test('D2: NO rule re-adds an edge to the host in any fullscreen (a later or stronger rule would undo the fix)', () => {
  // every rule whose selector names a fullscreen state AND ends on the host
  const HOST_END = /(#player-wrapper|\.player-container)((\.|:|\[)[^\s>+~]*)?\s*$/;
  const FS = /css-fullscreen|:fullscreen|:-webkit-full-screen/;
  const bad = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(CSS))) {
    const sels = m[1].split(',').map((x) => x.trim()).filter((x) => FS.test(x) && HOST_END.test(x) && !/audio-expanded/.test(x));
    if (!sels.length) continue;
    for (const decl of m[2].split(';')) {
      const [prop, ...rest] = decl.split(':');
      const name = (prop || '').trim(); const val = rest.join(':').trim();
      if (/^(border|border-(top|right|bottom|left)(-width|-style)?|border-width|border-style)$/.test(name) && !/^(none|0(px)?)(\s*!important)?$/.test(val)) bad.push(sels.join(', ') + ' { ' + name + ': ' + val + ' }');
      if (/^(outline|box-shadow)$/.test(name) && !/^none(\s*!important)?$/.test(val)) bad.push(sels.join(', ') + ' { ' + name + ': ' + val + ' }');
      if (/^border-(top-left-|top-right-|bottom-left-|bottom-right-)?radius$/.test(name) && !/^0(px)?(\s*!important)?$/.test(val)) bad.push(sels.join(', ') + ' { ' + name + ': ' + val + ' }');
    }
  }
  assert.deepStrictEqual(bad, []);
});

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
    'rs=4 ns=1 p=0 wh=1920x1080 t=12.3 f=345/2 dec=340 pm=inline act=video bg=INLINE_VIDEO bgp=- mu=0 vol=- fs=1 ah=0 amb=1 lock=1 ld=3');
  assert.match(formatVideoStateDetail({ act: 'video', bgp: false, muted: true, vol: 0.5 }), / act=video bg=\? bgp=0 mu=1 vol=0\.50 /,
    'bgp=0 with act=video: the sidecar is sounding while the player thinks the video is');
  assert.match(formatVideoStateDetail({ bgp: true }), / bgp=1 /);
});

test('formatVideoStateDetail: a property the engine lacks reads "-", never NaN or undefined', () => {
  const s = formatVideoStateDetail({ rs: 2, paused: true, vw: 0, vh: 0, t: NaN, frames: null, decoded: undefined });
  assert.match(s, /^rs=2 ns=- p=1 wh=0x0 t=- f=-\/- dec=- pm=- act=\? bg=\? bgp=- mu=0 vol=- fs=0 ah=0 amb=0 lock=0 ld=-$/);
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
  // the flat signature: media time ran 2.0s, the layer frame count did not move
  assert.match(formatVideoStateDetail({ delta: { frames: 0, decoded: 0, t: 2.01 } }), / \+f=0 \+dec=0 \+t=2\.0$/);
  assert.match(formatVideoStateDetail({ delta: { frames: null, decoded: 48, t: 2 } }), / \+f=- \+dec=48 \+t=2\.0$/);
});

test('videoStateDelta: b minus a per counter; a counter either side lacks is null (never NaN)', () => {
  assert.deepStrictEqual(videoStateDelta({ frames: 100, decoded: 90, t: 10 }, { frames: 148, decoded: 90, t: 12 }), { frames: 48, decoded: 0, t: 2 });
  assert.deepStrictEqual(videoStateDelta({ frames: 100, t: 10 }, { frames: undefined, t: 12 }), { frames: null, decoded: null, t: 2 });
  assert.deepStrictEqual(videoStateDelta(null, { frames: 1 }), { frames: null, decoded: null, t: null });
});

test('formatFrameSeries: each sample relative to the playing reading; a missing sample is "-"', () => {
  assert.strictEqual(formatFrameSeries(100, [100, 100, 148, 148, 196, 196]), '0,0,48,48,96,96');
  assert.strictEqual(formatFrameSeries(100, [100, null, 90]), '0,-,-10');
  assert.strictEqual(formatFrameSeries(null, [5, 6]), '-,-');
  assert.strictEqual(formatFrameSeries(0, []), '');
  assert.match(formatVideoStateDetail({ series: '0,0,48' }), / fser=0,0,48$/);
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
  // unconditional: at the top level of wireHostListeners (4-space indent), not inside a branch
  const body = fnBody('wireHostListeners');
  assert.match(body, /\n {4}\[[^\]]*\]\.forEach\(function \(evName\) \{\s*mediaPlayer\.addEventListener\(evName, function \(\) \{ recordVideoState\(evName\); \}\);/,
    'the wiring sits at the top level of wireHostListeners');
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
  // the series starts on 'playing' only, samples once a second, six times, then logs once
  const onlyPlaying = body.indexOf("if (evName !== 'playing') return;");
  assert.ok(onlyPlaying !== -1 && onlyPlaying < body.indexOf('setTimeout(tick'), "only a 'playing' starts the series");
  assert.match(PLAYER_JS, /var VIDEO_CHECK_SAMPLES = 6;/);
  assert.match(PLAYER_JS, /var VIDEO_CHECK_EVERY_MS = 1000;/);
  assert.strictEqual((body.match(/setTimeout\(tick, VIDEO_CHECK_EVERY_MS\)/g) || []).length, 2, 'both the first and every next sample use the 1s cadence');
  assert.match(body, /if \(samples\.length < VIDEO_CHECK_SAMPLES\) \{/);
  assert.match(body, /n\.delta = videoStateDelta\(s, n\);\s*n\.series = formatFrameSeries\(s\.frames, samples\);\s*recordLifecycleEvent\('video:check'/);
});

test('the instrument is PASSIVE: no requestVideoFrameCallback / canvas read of the video anywhere in player.js', () => {
  // in WebKit both attach a video output to the player - the v1.312 ambient blackout's shape
  const code = PLAYER_JS.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /requestVideoFrameCallback\s*\(/);
  assert.doesNotMatch(code, /drawImage\s*\(/);
  const body = fnBody('readVideoState');
  assert.doesNotMatch(body, /\.(play|pause|load)\(|currentTime\s*=|\.src\s*=|setAttribute|classList\.(add|remove|toggle)/, 'reads only');
});

test('the reader reads the REAL sources: the sounding element, the sidecar, and the attribute ambient.js writes', () => {
  const body = fnBody('readVideoState');
  assert.match(body, /act: activeMediaElement\(\) === bgAudioEl && bgAudioEl \? 'bgAudio' : 'video',/);
  assert.match(body, /bgp: bgAudioEl \? !!bgAudioEl\.paused : null,/);
  assert.match(body, /amb: !!\(root && root\.hasAttribute\('data-ambient-on'\)\),/);
  const AMBIENT_JS = fs.readFileSync(path.join(ROOT, 'public', 'js', 'ambient.js'), 'utf8');
  assert.match(AMBIENT_JS, /setAttribute\('data-ambient-on', ''\)/, 'ambient.js still writes the attribute the reader reads');
});

// ---- the panel Dean screenshots ------------------------------------------------

test('the panel renders a video: line IN FULL (every field is evidence); other types keep the 60 cut', () => {
  const body = fnBody('renderLifecycleOverlay');
  assert.match(body, /var detailCap = \(entry && typeof entry\.type === 'string' && entry\.type\.indexOf\('video:'\) === 0\) \? 400 : 60;/);
  assert.match(body, /String\(entry\.detail\)\.slice\(0, detailCap\)/);
  // the longest line the instrument can write fits the cap
  const longest = formatVideoStateDetail({ rs: 4, ns: 3, paused: false, vw: 3840, vh: 2160, t: 99999.9, frames: 99999999, dropped: 99999999,
    decoded: 99999999, composited: 99999999, pm: 'picture-in-picture', act: 'bgAudio', bg: 'background_audio', bgp: false, muted: true, vol: 1,
    fs: true, ah: true, amb: true, lock: true, ld: 99999, err: 4, delta: { frames: 99999999, decoded: 99999999, t: 99999.9 },
    series: formatFrameSeries(0, [99999999, 99999999, 99999999, 99999999, 99999999, 99999999]) });
  assert.ok(longest.length <= 400, 'longest detail ' + longest.length + ' <= 400');
});

test('in faux fullscreen the panel moves to the top and lets every tap through (it cleared the log on a #pp-btn tap)', () => {
  const body = ruleBody('body.ft-css-fullscreen #ft-lifecycle-overlay');
  assert.ok(body, 'the rule exists');
  assert.match(body, /pointer-events:\s*none\s*!important;/);
  assert.match(body, /top:\s*0\s*!important;/);
  assert.match(body, /bottom:\s*auto\s*!important;/);
});
