'use strict';

// [UNIT] v1.132 resume-countdown (Dean, 2026-08-16): the "Resume at..."
// prompt arms a short countdown on its DEFAULT button and fires that
// button's OWN click handler when it expires - any interaction with the
// player cancels the auto-fire and leaves the prompt up. Setting is
// device-local (Setup -> Playback, the resume-threshold pattern), ON by
// default; disabled = exactly the pre-wave prompt. Intake rulings: default
// action configurable (shipped default: resume), 5 seconds VARIABLEIZED
// (RESUME_COUNTDOWN_SECONDS - one edit to tweak, and the CSS drain reads the
// same constant via a custom property so the visual can never drift from the
// timer), ticking-count visual.
//
// Testing posture: pure helpers exercised directly; the impure machinery is
// locked against source text (no jsdom player harness; Dean's device pass is
// the arbiter of feel).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveResumeCountdownConfig, resumeCountdownLabel, resolveResumeCountdownSeconds } = require('../../public/js/player.js');
const { clampResumeSeconds } = require('../../public/js/setup.js');

// ---- resolveResumeCountdownConfig (pure) -----------------------------------

test('config: absent/garbage enabled-flag -> ON (Dean: defaulted as on); only the literal \'0\' disables', () => {
  assert.strictEqual(resolveResumeCountdownConfig(null, null).enabled, true);
  assert.strictEqual(resolveResumeCountdownConfig(undefined, null).enabled, true);
  assert.strictEqual(resolveResumeCountdownConfig('1', null).enabled, true);
  assert.strictEqual(resolveResumeCountdownConfig('garbage', null).enabled, true);
  assert.strictEqual(resolveResumeCountdownConfig('0', null).enabled, false);
});

test('config: absent/garbage action -> resume (continuing is the common intent); only the literal \'beginning\' selects start-over', () => {
  assert.strictEqual(resolveResumeCountdownConfig(null, null).action, 'resume');
  assert.strictEqual(resolveResumeCountdownConfig(null, undefined).action, 'resume');
  assert.strictEqual(resolveResumeCountdownConfig(null, 'resume').action, 'resume');
  assert.strictEqual(resolveResumeCountdownConfig(null, 'restart').action, 'resume');
  assert.strictEqual(resolveResumeCountdownConfig(null, 'beginning').action, 'beginning');
});

test('config: enabled and action resolve independently (a disabled config still carries the stored action)', () => {
  assert.deepStrictEqual(resolveResumeCountdownConfig('0', 'beginning'), { enabled: false, action: 'beginning' });
  assert.deepStrictEqual(resolveResumeCountdownConfig(null, 'beginning'), { enabled: true, action: 'beginning' });
});

// ---- resolveResumeCountdownSeconds (pure, v1.161) --------------------------

test('seconds (player read): integer clamp [0,30]; absent/garbage -> default 5', () => {
  assert.strictEqual(resolveResumeCountdownSeconds('5'), 5);
  assert.strictEqual(resolveResumeCountdownSeconds('0'), 0, '0 is a real value (instant), NOT the default');
  assert.strictEqual(resolveResumeCountdownSeconds('12'), 12);
  assert.strictEqual(resolveResumeCountdownSeconds('30'), 30);
  assert.strictEqual(resolveResumeCountdownSeconds('99'), 30, 'over-max clamps to 30');
  assert.strictEqual(resolveResumeCountdownSeconds('-4'), 0, 'negative clamps to 0');
  assert.strictEqual(resolveResumeCountdownSeconds('7.9'), 7, 'floored to an integer');
  for (const junk of [null, undefined, '', 'abc', {}]) {
    assert.strictEqual(resolveResumeCountdownSeconds(junk), 5, `absent/garbage (${String(junk)}) -> default 5`);
  }
});

// ---- clampResumeSeconds (setup WRITE side, v1.161) -------------------------

test('seconds (setup write): blank -> null (clear the key -> default); real values clamp to [0,30]', () => {
  assert.strictEqual(clampResumeSeconds(''), null, 'a cleared field removes the key (player default 5 returns)');
  assert.strictEqual(clampResumeSeconds('   '), null, 'whitespace-only is blank too');
  assert.strictEqual(clampResumeSeconds(null), null);
  assert.strictEqual(clampResumeSeconds('abc'), null, 'garbage removes the key rather than storing junk');
  assert.strictEqual(clampResumeSeconds('0'), 0, '0 is stored (instant), distinct from blank/null');
  assert.strictEqual(clampResumeSeconds('8'), 8);
  assert.strictEqual(clampResumeSeconds('99'), 30);
  assert.strictEqual(clampResumeSeconds('-2'), 0);
});

// ---- resumeCountdownLabel (pure) -------------------------------------------

test('label: the ticking format is "<base> · <n>" - one builder for arm and every tick', () => {
  assert.strictEqual(resumeCountdownLabel('Resume', 5), 'Resume · 5');
  assert.strictEqual(resumeCountdownLabel('Start from beginning', 1), 'Start from beginning · 1');
});

// ---- source locks: player.js machinery -------------------------------------

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
const startBody = /function startResumeCountdown\(gen\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
const cancelBody = /function cancelResumeCountdown\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);

test('the countdown arms in the overlay-SHOW branch with the load generation, and the config is read LIVE at that moment', () => {
  // Armed exactly where the prompt becomes visible - never for the docked
  // auto-resume, the autoplay-advance skip, or the below-threshold paths.
  assert.match(PLAYER_JS, /if \(resumeOverlay\) resumeOverlay\.style\.display = 'flex';\n\s*mediaPlayer\.autoplay = false;\n[\s\S]{0,300}?startResumeCountdown\(gen\);/);
  assert.ok(startBody, 'startResumeCountdown body not found');
  assert.match(startBody[1], /var config = getStoredResumeCountdownConfig\(\);/, 'config must be read fresh per prompt (the getStoredResumeThreshold posture), never cached at boot');
  assert.match(startBody[1], /if \(!config\.enabled\) return;/, 'disabled = a no-op, the pre-wave prompt exactly');
  // Gate W1 (v1.132 fix round): the action->BUTTON mapping is the wave's
  // central decision and was unbound - inverted, the shipped default would
  // auto-click "Start from beginning", whose handler saveProgressToServer(0)s
  // the saved position away, with the whole suite green. Bind the ternary.
  assert.match(startBody[1], /var btn = config\.action === 'beginning' \? resumeNoBtn : resumeYesBtn;/,
    "'beginning' maps to the start-over button and everything else to Resume - inverted, the default DESTROYS saved progress");
  // Gate W3 (v1.132 fix round): the arm-time re-arm belt - unreachable today
  // (one overlay-show per load) but desired; bind it so a future re-prompt
  // path inherits it instead of a second live timer.
  assert.match(startBody[1], /^\s*cancelResumeCountdown\(\); \/\/ belt/m, 'arming always clears any prior timer first');
});

test('the expiry fires the default button\'s OWN click - never a duplicated seek/play path', () => {
  assert.match(startBody[1], /if \(fireBtn\) fireBtn\.click\(\);/, 'behavior parity by construction: the same handler a human tap runs');
  // Negative: the machinery must not carry its own playback writes - if a
  // future edit inlines a seek/play here, the two paths can drift.
  assert.ok(!/currentTime\s*=|\.play\(\)|startLiveStream\(/.test(startBody[1]), 'no playback writes inside the countdown machinery');
  assert.ok(!/currentTime\s*=|\.play\(\)|startLiveStream\(/.test(cancelBody[1]), 'cancel is label/timer/listener cleanup only');
});

test('the tick carries the TOCTOU belt: a newer load or an already-hidden prompt cancels instead of firing', () => {
  assert.match(startBody[1], /if \(gen !== loadGeneration \|\| !resumeOverlay \|\| resumeOverlay\.style\.display === 'none'\) \{\s*cancelResumeCountdown\(\);\s*return;\s*\}/);
});

test('any player interaction cancels the auto-fire: capture-phase pointerdown + keydown armed on start, removed on cancel', () => {
  assert.match(startBody[1], /host\.addEventListener\('pointerdown', resumeCountdownCancelPointer, true\);/);
  assert.match(startBody[1], /document\.addEventListener\('keydown', resumeCountdownCancelKey, true\);/);
  assert.match(cancelBody[1], /host\.removeEventListener\('pointerdown', resumeCountdownCancelPointer, true\);/);
  assert.match(cancelBody[1], /document\.removeEventListener\('keydown', resumeCountdownCancelKey, true\);/);
});

test('EVERY prompt-hide seam cancels the countdown (the enumerate-every-writer discipline)', () => {
  // The five hide-writers + the arm site's own re-arm belt. A stale timer
  // that survives any of these auto-clicks into a vanished/next-load prompt.
  // Gate W3 (v1.132 fix round): EXACT count, not a floor - >= 7 left three
  // sites of slack, enough for a deleted seam to hide behind. A new
  // legitimate site moves this number consciously, in this lock.
  const cancels = (PLAYER_JS.match(/cancelResumeCountdown\(\);/g) || []).length;
  assert.strictEqual(cancels, 10, 'the 10 cancel sites: both choice buttons, dock-transition, teardown, close, the arm-time belt, the tick guard + expiry, and the two interaction listeners; found ' + cancels);
  assert.match(PLAYER_JS, /resumeYesBtn\.addEventListener\('click', function \(\) \{\n\s*cancelResumeCountdown\(\);/);
  assert.match(PLAYER_JS, /resumeNoBtn\.addEventListener\('click', function \(\) \{\n\s*cancelResumeCountdown\(\);/);
  assert.match(PLAYER_JS, /resumeOverlay\.style\.display = 'none';\n\s*cancelResumeCountdown\(\); \/\/ v1\.132: the dock transition dismissed the prompt/);
  assert.match(PLAYER_JS, /if \(resumeOverlay\) resumeOverlay\.style\.display = 'none';\n\s*cancelResumeCountdown\(\); \/\/ v1\.132: a stale timer must never fire into the NEXT load/);
  assert.match(PLAYER_JS, /if \(resumeOverlay\) resumeOverlay\.style\.display = 'none';\n\s*cancelResumeCountdown\(\); \/\/ v1\.132: a closed player must never auto-click a vanished prompt/);
});

test('v1.161: the countdown length is read LIVE from the store and single-sourced into the CSS drain', () => {
  // The hardcoded 5 is gone; the length now comes from getStoredResumeCountdownSeconds
  // (which validates via resolveResumeCountdownSeconds), read fresh in the arm - and
  // the CSS drain + the tick counter both read that SAME resolved value, so the
  // visual can never drift from the timer.
  assert.doesNotMatch(PLAYER_JS, /var RESUME_COUNTDOWN_SECONDS = 5;/, 'the hardcoded 5 is replaced by the configurable read');
  assert.match(startBody[1], /var countdownSeconds = getStoredResumeCountdownSeconds\(\);/, 'the length is read live at arm time');
  assert.match(startBody[1], /btn\.style\.setProperty\('--resume-countdown-duration', countdownSeconds \+ 's'\);/);
  assert.match(startBody[1], /var secondsLeft = countdownSeconds;/);
  assert.match(cancelBody[1], /removeProperty\('--resume-countdown-duration'\)/);
  // Gate W2 (v1.132 fix round): the wall-clock length is ticks x INTERVAL and
  // only the tick count was bound - a 500ms interval fires at half the CSS
  // drain with everything green, falsifying "the visual can never drift from
  // the timer". Bind the second factor and the per-tick label rewrite.
  assert.match(startBody[1], /\}, 1000\);/, 'the tick interval is the other half of the wall-clock duration');
  assert.match(startBody[1], /resumeCountdownBtn\.textContent = resumeCountdownLabel\(resumeCountdownBaseLabel, secondsLeft\);/,
    'every tick rewrites the label through the ONE builder');
});

test('v1.161: 0 seconds = INSTANT - fires the configured button with NO overlay show, and reuses the countdown\'s action->button mapping', () => {
  // The instant branch must (a) be gated on enabled AND a 0 length, (b) fire the
  // SAME action->button mapping the countdown uses (beginning->resumeNoBtn, else
  // resumeYesBtn) so behaviour is identical, and (c) NOT set the overlay to 'flex'
  // in that branch (no prompt flash). Binding the mapping stops a regression that
  // instant-fires the WRONG button (which, for 'resume', would start-over and wipe
  // saved progress - the v1.132 W1 destructive class).
  assert.match(PLAYER_JS, /if \(rcConfig\.enabled && getStoredResumeCountdownSeconds\(\) === 0\) \{[\s\S]{0,400}?var instantBtn = rcConfig\.action === 'beginning' \? resumeNoBtn : resumeYesBtn;[\s\S]{0,200}?if \(instantBtn\) instantBtn\.click\(\);/,
    'enabled + 0s fires the correctly-mapped button immediately');
  // The instant branch must NOT show the overlay (no prompt). Slice the branch and
  // assert it carries no display='flex'.
  const instantBranch = /if \(rcConfig\.enabled && getStoredResumeCountdownSeconds\(\) === 0\) \{([\s\S]*?)\n {12}\} else \{/.exec(PLAYER_JS);
  assert.ok(instantBranch, 'the instant branch is present');
  assert.doesNotMatch(instantBranch[1], /style\.display = 'flex'/, 'instant resume never shows the prompt overlay');
});

// ---- source locks: the CSS drain -------------------------------------------

const STYLE_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

test('style.css: the armed button drains via the JS-fed duration, with a reduced-motion carve-out (label still ticks)', () => {
  // Deliberately NO raw fallback in the var() - the JS always sets the
  // property (single source), and a literal here would re-enter the motion
  // token census.
  assert.match(STYLE_CSS, /\.resume-actions \.btn\.countdown-armed::after \{[\s\S]*?animation: resume-countdown-drain var\(--resume-countdown-duration\) linear forwards;/);
  assert.match(STYLE_CSS, /@keyframes resume-countdown-drain \{/);
  assert.match(STYLE_CSS, /@media \(prefers-reduced-motion: reduce\) \{\n[\s\S]{0,200}?\.resume-actions \.btn\.countdown-armed::after \{ animation: none; \}/);
});

// ---- source locks: Setup controls (the cross-file key convention) ----------

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
const SETUP_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
const SERVER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

test('setup.html: the checkbox (default checked) + the action select exist in the Playback section', () => {
  assert.match(SETUP_HTML, /<input type="checkbox" id="resume-countdown-check" checked \/>/);
  assert.match(SETUP_HTML, /<select id="resume-countdown-action-select"[^>]*>\s*<option value="resume">Resume from saved position<\/option>\s*<option value="beginning">Start from beginning<\/option>\s*<\/select>/);
});

test('setup.js and player.js agree on ALL THREE storage keys byte-for-byte (the RESUME_THRESHOLD cross-file convention)', () => {
  assert.match(SETUP_JS, /const RESUME_COUNTDOWN_KEY = 'filetube_resume_countdown';/);
  assert.match(SETUP_JS, /const RESUME_COUNTDOWN_ACTION_KEY = 'filetube_resume_countdown_action';/);
  assert.match(SETUP_JS, /const RESUME_COUNTDOWN_SECONDS_KEY = 'filetube_resume_countdown_seconds';/);
  assert.match(PLAYER_JS, /var RESUME_COUNTDOWN_STORAGE_KEY = 'filetube_resume_countdown';/);
  assert.match(PLAYER_JS, /var RESUME_COUNTDOWN_ACTION_STORAGE_KEY = 'filetube_resume_countdown_action';/);
  assert.match(PLAYER_JS, /var RESUME_COUNTDOWN_SECONDS_STORAGE_KEY = 'filetube_resume_countdown_seconds';/);
});

test('v1.161: setup.html carries the seconds field (0-30) + the "0 = instant" hint, and setup.js clamps on write', () => {
  assert.match(SETUP_HTML, /<input type="number" id="resume-countdown-seconds-input" min="0" max="30" step="1"[^>]*\/>/);
  assert.match(SETUP_HTML, /0 = resume instantly with no prompt at all/);
  // The field stores a clamped value, and a BLANK/garbage entry removes the key so
  // the player default (5) returns - never stores junk.
  assert.match(SETUP_JS, /const clamped = clampResumeSeconds\(e\.target\.value\);/);
  assert.match(SETUP_JS, /if \(clamped === null\) localStorage\.removeItem\(RESUME_COUNTDOWN_SECONDS_KEY\);\s*else localStorage\.setItem\(RESUME_COUNTDOWN_SECONDS_KEY, String\(clamped\)\);/);
});

test('setup.js: the checkbox stores \'0\' ONLY when unchecked (absent = on, mirroring resolveResumeCountdownConfig\'s !== \'0\')', () => {
  assert.match(SETUP_JS, /if \(e\.target\.checked\) localStorage\.removeItem\(RESUME_COUNTDOWN_KEY\);\s*else localStorage\.setItem\(RESUME_COUNTDOWN_KEY, '0'\);/);
  assert.match(SETUP_JS, /resumeCountdownCheck\.checked = rawEnabled !== '0';/);
});

test('device-local by design: the keys never appear in server.js (not a db.settings surface, no RBAC read exposure)', () => {
  assert.ok(!SERVER_JS.includes('filetube_resume_countdown'), 'the countdown keys must stay client-only');
});
