'use strict';

// [UNIT] v1.121 (Dean, the lock-blip tuning): background-audio POSITION
// PRE-SYNC. The sidecar buffers eagerly (preExtractAudio) but from ZERO; the
// handoff's `bgAudioEl.currentTime = resumeTime` seek at lock-time lands in an
// unbuffered range at minute-N -> the ~1/4s blip. With the new EXPERIMENTAL
// setting (bgAudioSyncPosition) the paused sidecar's position tracks the
// playing video (throttled), so its buffer window follows the watcher and the
// handoff seek lands already-buffered.
//
// Battle-won invariants bound here (the v1.27/v1.35 machinery):
//   - INLINE_VIDEO only -- a sync during HANDING_OFF/BACKGROUND_AUDIO would
//     SCRUB the element that is actually playing.
//   - F3b: armBackgroundAudioSrc stays the only real-URL site; presync runs it
//     (idempotent) rather than assigning src itself, and never runs with the
//     settings off.
//   - No new timers: piggybacks timeupdate (throttled) + seeked.
// The DOM wiring is source-locked (no jsdom harness); Dean's iPhone is the
// runtime arbiter of the actual blip shrink.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const playerExports = require('../../public/js/player.js');

const { shouldPresyncBgAudio } = playerExports;
const OK = {
  presyncOn: true, bgAudioOn: true, statusReady: true,
  mobile: true, isVideo: true, bgAudioState: 'inline_video',
};

test('shouldPresyncBgAudio: ALL six conditions required (each single veto flips to false)', () => {
  assert.strictEqual(shouldPresyncBgAudio(OK), true);
  for (const key of ['presyncOn', 'bgAudioOn', 'statusReady', 'mobile', 'isVideo']) {
    assert.strictEqual(shouldPresyncBgAudio({ ...OK, [key]: false }), false, `${key}=false must veto`);
  }
  // The state machine gate: INLINE_VIDEO only -- never scrub a live/handing-off sidecar.
  assert.strictEqual(shouldPresyncBgAudio({ ...OK, bgAudioState: 'handing_off' }), false, 'HANDING_OFF must veto');
  assert.strictEqual(shouldPresyncBgAudio({ ...OK, bgAudioState: 'background_audio' }), false, 'BACKGROUND_AUDIO must veto');
  assert.strictEqual(shouldPresyncBgAudio(), false, 'missing context fails safe');
  assert.strictEqual(shouldPresyncBgAudio(null), false);
});

// ---- wiring (source-locked) ------------------------------------------------

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('presyncBackgroundAudioPosition: pure gate -> armed sidecar -> drift-guarded currentTime nudge', () => {
  const m = /function presyncBackgroundAudioPosition\(\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(m, 'presyncBackgroundAudioPosition exists');
  const body = m[1];
  // v1.121 gate W3: pin EVERY signal mapping, not just three -- a `mobile: true`
  // hardcode (desktop installs paying sidecar scrubs + range requests, invisible
  // to the suite) must redden here. `mobile` is the one signal with NO backstop
  // in armBackgroundAudioSrc's own guards.
  assert.match(body, /shouldPresyncBgAudio\(\{\s*presyncOn: bgAudioSyncPositionCached,\s*bgAudioOn: bgAudioSettingCached,\s*statusReady: bgAudioStatusKnown === 'ready',\s*mobile: isMobileFormFactor\(\),\s*isVideo: !!\(currentData && currentData\.type !== 'audio'\),\s*bgAudioState: bgAudioState,\s*\}\)/,
    'routes through the pure gate with ALL SIX real signals (no hardcodes)');
  assert.match(body, /if \(!armBackgroundAudioSrc\(\)\) return;/, 'F3b: arms via the single assignment site, bails if refused');
  assert.match(body, /drift < PRESYNC_DRIFT_SECONDS\) return;/, 'a within-window position never causes churn');
  assert.match(body, /bgAudioEl\.currentTime = target;/, 'the nudge is a currentTime set on the paused sidecar');
});

test('the tuning digits are bound (gate S1): 8s drift, 10s throttle', () => {
  // A zero/zero mutation turns the "gentle" sync into a per-tick scrub storm --
  // pin the shipped values; a deliberate retune updates this lock consciously.
  assert.match(SRC, /var PRESYNC_DRIFT_SECONDS = 8;/, 'drift threshold is 8s');
  assert.match(SRC, /var PRESYNC_THROTTLE_MS = 10000;/, 'throttle is 10s');
});

test('setup.js: the toggle CHANGE listener is wired (gate W2, the save half)', () => {
  const setupSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
  assert.match(setupSrc, /bgAudioSyncCheck\.addEventListener\('change', \(e\) => \{\s*saveAutomationSetting\('bgAudioSyncPosition', e\.target\.checked,/,
    "flipping the toggle must save bgAudioSyncPosition (a deleted wiring block leaves the kill-switch flip a silent no-op)");
});

test('wiring: throttled timeupdate + immediate seeked both drive the presync; throttle stamp resets at teardown', () => {
  assert.match(SRC, /mediaPlayer\.addEventListener\('timeupdate', function \(\) \{\s*var now = Date\.now\(\);\s*if \(now - lastBgAudioPresyncAt < PRESYNC_THROTTLE_MS\) return;\s*lastBgAudioPresyncAt = now;\s*presyncBackgroundAudioPosition\(\);/,
    'timeupdate drives it, throttled');
  assert.match(SRC, /mediaPlayer\.addEventListener\('seeked', function \(\) \{\s*lastBgAudioPresyncAt = Date\.now\(\);\s*presyncBackgroundAudioPosition\(\);/,
    'a user seek re-syncs immediately (the buffer window must follow a jump)');
  assert.match(SRC, /bgAudioSyncPositionCached = false;\s*\n\s*lastBgAudioPresyncAt = 0;/,
    'teardown resets the cached flag + throttle stamp per load');
});

test('wiring: the setting is cached off the same per-load settings fetch as its siblings', () => {
  assert.match(SRC, /bgAudioSyncPositionCached = !!\(settings && settings\.bgAudioSyncPosition\);/,
    'cached alongside preExtractAudioCached from GET /api/settings');
});

test('the handoff itself is untouched: attemptBackgroundAudioHandoff still seeks + plays exactly as before', () => {
  const m = /function attemptBackgroundAudioHandoff\(trigger\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(m, 'handoff exists');
  assert.match(m[1], /var resumeTime = currentAbsTime\(\);/, 'position captured from the live element');
  assert.match(m[1], /bgAudioEl\.currentTime = resumeTime;/, 'the handoff still sets the exact position (presync only warms the buffer it seeks into)');
  assert.ok(!/presyncBackgroundAudioPosition/.test(m[1]), 'presync never runs inside the handoff itself');
});

// ---- manifest identity (the CC-misroute dice roll) -------------------------

test('manifest: explicit id + scope (the only web-side identity signals iOS gets)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(manifest.id, '/', 'explicit id');
  assert.strictEqual(manifest.scope, '/', 'explicit scope');
  assert.strictEqual(manifest.start_url, '/', 'start_url stays in scope');
});
