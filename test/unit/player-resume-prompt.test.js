'use strict';

// [UNIT] v1.363: the "Resume playback?" prompt comes back as a Settings choice (Ask me) beside
// today's auto-resume. Two halves:
//   1. the pure decision (resolveResumeStart with the mode, the dock rule, the instant countdown),
//      the stored-value resolvers, the dock-transition rule and the R / S table;
//   2. the REAL player.js in a jsdom realm built from the real watch.html shell: Ask opens the
//      prompt PAUSED at 0 with the countdown ticking, the countdown fires the button's own
//      handler, a touch or key cancels it and the prompt stays, R / S, dock / close / the next
//      load kill the prompt and the timer, and the surfaces that never prompt do not.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const player = require('../../public/js/player.js');

const REPO = path.join(__dirname, '..', '..');
const {
  resolveResumeStart, resolveResumeMode, resolveResumeCountdownConfig, resolveResumeCountdownSeconds,
  resumeCountdownLabel, resolveDockedResumeAction, resolveDockTransitionResumeAction, resolveResumeShortcutAction,
} = player;

// ---- 1. the pure halves ---------------------------------------------------------------

test('resolveResumeMode: only the literal ask prompts; absent / garbage / auto are auto-resume', () => {
  assert.strictEqual(resolveResumeMode('ask'), 'ask');
  for (const v of [null, undefined, '', 'auto', 'ASK', 'prompt', '1', 0]) assert.strictEqual(resolveResumeMode(v), 'auto', String(v));
});

test('resolveResumeCountdownConfig: on unless the literal 0; resume unless the literal beginning', () => {
  assert.deepStrictEqual(resolveResumeCountdownConfig(null, null), { enabled: true, action: 'resume' });
  assert.deepStrictEqual(resolveResumeCountdownConfig('1', 'beginning'), { enabled: true, action: 'beginning' });
  assert.deepStrictEqual(resolveResumeCountdownConfig('0', 'junk'), { enabled: false, action: 'resume' });
  assert.deepStrictEqual(resolveResumeCountdownConfig('garbage', ''), { enabled: true, action: 'resume' });
});

test('resolveResumeCountdownSeconds: integer clamped 0-30, absent or garbage is 5, 0 stays 0', () => {
  for (const [raw, want] of [[null, 5], [undefined, 5], ['', 5], ['abc', 5], ['0', 0], [0, 0], ['7', 7], ['30', 30], ['31', 30], ['999', 30], ['-4', 0], ['3.9', 3]]) {
    assert.strictEqual(resolveResumeCountdownSeconds(raw), want, String(raw));
  }
  assert.strictEqual(resumeCountdownLabel('Resume', 4), 'Resume · 4');
});

test('resolveDockedResumeAction / resolveDockTransitionResumeAction: docked never prompts; a prompt up when docking is dismissed and resumed', () => {
  assert.strictEqual(resolveDockedResumeAction({ resumeDecisionPending: false, dockState: 'full' }), 'none');
  assert.strictEqual(resolveDockedResumeAction({ resumeDecisionPending: true, dockState: 'docked' }), 'auto-resume');
  assert.strictEqual(resolveDockedResumeAction({ resumeDecisionPending: true, dockState: 'full' }), 'prompt');
  assert.strictEqual(resolveDockTransitionResumeAction({ resumeOverlayVisible: true }), 'dismiss-and-auto-resume');
  assert.strictEqual(resolveDockTransitionResumeAction({ resumeOverlayVisible: false }), 'none');
  assert.strictEqual(resolveDockTransitionResumeAction(), 'none');
});

const ASK = { mode: 'ask', countdown: { enabled: true, action: 'resume', seconds: 5 } };
test('resolveResumeStart: AUTO mode is unchanged (resume + toast, no toast docked, quiet under the threshold)', () => {
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754 }), { action: 'resume', toast: true });
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754, mode: 'auto', dockState: 'docked' }), { action: 'resume', toast: false });
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754, mode: 'junk', countdown: { seconds: 0 } }), { action: 'resume', toast: true });
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 42 }), { action: 'resume', toast: false });
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 3 }), { action: 'start', toast: false });
});

test('resolveResumeStart: ASK mode prompts for announced progress, and ONLY for it', () => {
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754, ...ASK }), { action: 'prompt', toast: false });
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 60, ...ASK }), { action: 'prompt', toast: false }, 'the threshold is inclusive');
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754, ...ASK, autoplayAdvance: true }), { action: 'resume', toast: false }, 'an autoplay advance never prompts');
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 42, ...ASK }), { action: 'resume', toast: false }, 'under the threshold: quiet resume');
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 3, ...ASK }), { action: 'start', toast: false });
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754, ...ASK, threshold: 900 }), { action: 'resume', toast: false }, 'the threshold serves both modes');
});

test('resolveResumeStart: ASK + DOCKED resumes with no prompt (R3); length 0 acts at once with no prompt', () => {
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754, ...ASK, dockState: 'docked' }), { action: 'resume', toast: false });
  const zero = (action, enabled = true) => ({ savedProgress: 754, mode: 'ask', countdown: { enabled, action, seconds: 0 } });
  assert.deepStrictEqual(resolveResumeStart(zero('resume')), { action: 'resume', toast: false });
  assert.deepStrictEqual(resolveResumeStart(zero('beginning')), { action: 'start', toast: false, restart: true });
  assert.deepStrictEqual(resolveResumeStart(zero('resume', false)), { action: 'prompt', toast: false }, 'countdown off: the prompt waits');
});

test('resolveResumeShortcutAction: R resumes and S restarts while the prompt shows', () => {
  assert.strictEqual(resolveResumeShortcutAction({ key: 'R', promptVisible: true }), 'resume');
  assert.strictEqual(resolveResumeShortcutAction({ key: 's', promptVisible: true }), 'restart');
  assert.strictEqual(resolveResumeShortcutAction({ key: 'r', promptVisible: true, hasModifier: true }), 'none');
  assert.strictEqual(resolveResumeShortcutAction({ key: 'r', promptVisible: true, isTypingContext: true }), 'none');
  assert.strictEqual(resolveResumeShortcutAction({ key: 'r' }), 'none');
});

// ---- 2. the real player ---------------------------------------------------------------

function realPlayerRealm(savedSeconds, store) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'watch.html'), 'utf8'), {
    url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  for (const [k, v] of Object.entries(store || {})) w.localStorage.setItem(k, v);
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const media = { plays: 0 };
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.play = function () { media.plays += 1; return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.formatDuration = (s) => { const t = Math.floor(s); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  // the countdown's 1s interval, driven by hand (every other timer runs for real)
  const intervals = [];
  const realSetInterval = w.setInterval.bind(w);
  w.setInterval = (fn, ms) => {
    if (ms === 1000) { intervals.push({ fn, live: true }); return 2e6 + intervals.length; }
    return realSetInterval(fn, ms);
  };
  const realClearInterval = w.clearInterval.bind(w);
  w.clearInterval = (id) => { if (id > 2e6) { intervals[id - 2e6 - 1].live = false; return; } realClearInterval(id); };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) for (const t of intervals) if (t.live) t.fn(); };
  const fetches = [];
  w.fetch = (u, init) => {
    const method = (init && init.method) || 'GET';
    fetches.push({ method, url: String(u), body: init && init.body ? JSON.parse(init.body) : null });
    const body = String(u).indexOf('/api/progress/') === 0 ? { timestamp: savedSeconds } : (String(u).indexOf('/api/queue') === 0 ? { entries: [], pointerUid: null } : {});
    return Promise.resolve({ ok: true, json: async () => body });
  };
  w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8'));
  const $ = (sel) => w.document.querySelector(sel);
  return { w, player: w.FileTube.player, slot: $('#player-slot'), $, media, fetches, tick, liveTimers: () => intervals.filter((t) => t.live).length, close: () => w.close() };
}
const settle = () => new Promise((r) => setTimeout(r, 25));
const VIDEO = { id: 'v1', type: 'video', title: 'Clip', duration: 1800, filePath: '/lib/c.mp4', channelName: 'Chan', browseCtx: '', readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false };
async function loadAndSettle(r) {
  assert.strictEqual(r.player.load('v1', { ...VIDEO }, { slot: r.slot }), true, 'the load mounts');
  for (let i = 0; i < 6; i++) await settle();
}
const ASKED = { filetube_resume_mode: 'ask' };
const key = (r, k) => r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('Ask: an announced load opens PAUSED at 0 with the prompt, the time, no toast, and the Resume button counting down from 5', async () => {
  const r = realPlayerRealm(754, ASKED);
  try {
    await loadAndSettle(r);
    assert.strictEqual(r.$('#resume-overlay').hidden, false, 'the prompt shows');
    assert.strictEqual(r.$('#resume-prompt-time').textContent, '12:34');
    assert.strictEqual(r.$('#media-player').currentTime, 0, 'not seeked yet');
    assert.strictEqual(r.media.plays, 0, 'not playing yet');
    assert.strictEqual(r.$('#resume-toast').hidden, true, 'no toast with the prompt');
    const yes = r.$('#resume-yes-btn');
    assert.ok(yes.classList.contains('countdown-armed'));
    assert.strictEqual(yes.querySelector('.ui-btn__label').textContent, 'Resume · 5');
    assert.strictEqual(yes.style.getPropertyValue('--resume-countdown-duration'), '5s');
    assert.strictEqual(r.liveTimers(), 1);
  } finally { r.close(); }
});

test('Ask: the countdown ticks down and then fires the Resume button\'s own handler (seek there, play, prompt gone, label restored, timer gone)', async () => {
  const r = realPlayerRealm(754, ASKED);
  try {
    await loadAndSettle(r);
    r.tick(2);
    assert.strictEqual(r.$('#resume-yes-btn .ui-btn__label').textContent, 'Resume · 3');
    r.tick(3);
    assert.strictEqual(r.$('#media-player').currentTime, 754);
    assert.ok(r.media.plays >= 1, 'plays');
    assert.strictEqual(r.$('#resume-overlay').hidden, true);
    assert.strictEqual(r.$('#resume-yes-btn .ui-btn__label').textContent, 'Resume', 'label restored');
    assert.ok(!r.$('#resume-yes-btn').classList.contains('countdown-armed'));
    assert.strictEqual(r.liveTimers(), 0);
  } finally { r.close(); }
});

test('Ask: a pointer touch or a key cancels the countdown and the prompt STAYS (nothing fires later)', async () => {
  for (const how of ['pointer', 'key']) {
    const r = realPlayerRealm(754, ASKED);
    try {
      await loadAndSettle(r);
      r.tick(1);
      if (how === 'pointer') r.$('#player-wrapper').dispatchEvent(new r.w.Event('pointerdown', { bubbles: true }));
      else key(r, 'x');
      assert.strictEqual(r.liveTimers(), 0, how + ': the timer is gone');
      r.tick(10);
      assert.strictEqual(r.$('#resume-overlay').hidden, false, how + ': the prompt stays');
      assert.strictEqual(r.$('#media-player').currentTime, 0, how + ': nothing fired');
      assert.strictEqual(r.$('#resume-yes-btn .ui-btn__label').textContent, 'Resume', how + ': label restored');
    } finally { r.close(); }
  }
});

test('Ask: the countdown\'s listeners are balanced (a cancel by tap, by key, and by close each remove exactly what the start added, flag for flag)', async () => {
  for (const how of ['pointer', 'key', 'close']) {
    const r = realPlayerRealm(754, ASKED);
    try {
      // every (target, type, fn, capture) the player adds and has not removed with the SAME capture flag
      const live = new Set(); const ids = new Map();
      const id = (x) => { if (!ids.has(x)) ids.set(x, ids.size + 1); return ids.get(x); };
      const cap = (o) => (o === true || !!(o && o.capture)) ? 'c' : 'b';
      const tag = (t, ty, fn, o) => id(t) + ':' + ty + ':' + id(fn) + ':' + cap(o);
      const proto = r.w.EventTarget.prototype;
      const add = proto.addEventListener; const rem = proto.removeEventListener;
      proto.addEventListener = function (ty, fn, o) { if (ty === 'pointerdown' || ty === 'keydown') live.add(tag(this, ty, fn, o)); return add.call(this, ty, fn, o); };
      proto.removeEventListener = function (ty, fn, o) { if (ty === 'pointerdown' || ty === 'keydown') live.delete(tag(this, ty, fn, o)); return rem.call(this, ty, fn, o); };
      await loadAndSettle(r);
      const armed = new Set(live);
      if (how === 'pointer') r.$('#player-wrapper').dispatchEvent(new r.w.Event('pointerdown', { bubbles: true }));
      else if (how === 'key') key(r, 'x');
      else r.player.close();
      const gone = [...armed].filter((t) => !live.has(t));
      assert.strictEqual(gone.filter((t) => t.includes(':pointerdown:')).length, 1, how + ': one pointerdown listener removed');
      assert.strictEqual(gone.filter((t) => t.includes(':keydown:')).length, 1, how + ': one keydown listener removed');
    } finally { r.close(); }
  }
});

test('Ask: while the prompt is up a digit, Space, K and the arrows do nothing to the picture or the saved position (R and S still answer)', async () => {
  for (const k of ['5', '1', ' ', 'k', 'ArrowRight', 'ArrowLeft', 'l', 'j']) {
    const r = realPlayerRealm(754, ASKED);
    try {
      await loadAndSettle(r);
      const plays = r.media.plays;
      r.fetches.length = 0;
      key(r, k);
      await settle();
      assert.strictEqual(r.$('#resume-overlay').hidden, false, JSON.stringify(k) + ': the prompt stays');
      assert.strictEqual(r.$('#media-player').currentTime, 0, JSON.stringify(k) + ': no seek');
      assert.strictEqual(r.media.plays, plays, JSON.stringify(k) + ': no play');
      assert.deepStrictEqual(r.fetches.filter((f) => f.method !== 'GET' && /progress/.test(f.url)), [], JSON.stringify(k) + ': no progress write: ' + JSON.stringify(r.fetches));
    } finally { r.close(); }
  }
});

test('Ask: a countdown tick that finds the prompt hidden (by any path) cancels itself and fires nothing', async () => {
  const r = realPlayerRealm(754, ASKED);
  try {
    await loadAndSettle(r);
    const plays = r.media.plays;
    r.$('#resume-overlay').hidden = true;
    r.tick(10);
    assert.strictEqual(r.liveTimers(), 0, 'the timer is gone');
    assert.strictEqual(r.$('#media-player').currentTime, 0, 'nothing fired');
    assert.strictEqual(r.media.plays, plays, 'no play');
  } finally { r.close(); }
});

test('Ask + action Start from beginning: the Start button counts down and its firing seeks 0 and clears the saved position', async () => {
  const r = realPlayerRealm(754, { ...ASKED, filetube_resume_countdown_action: 'beginning' });
  try {
    await loadAndSettle(r);
    assert.ok(r.$('#resume-no-btn').classList.contains('countdown-armed'));
    assert.ok(!r.$('#resume-yes-btn').classList.contains('countdown-armed'));
    r.fetches.length = 0;
    r.tick(5);
    assert.strictEqual(r.$('#media-player').currentTime, 0);
    assert.strictEqual(r.$('#resume-overlay').hidden, true);
    await settle();
    assert.ok(r.fetches.some((f) => f.method !== 'GET' && /progress/.test(f.url) && f.body && f.body.timestamp === 0), 'saved position cleared: ' + JSON.stringify(r.fetches));
  } finally { r.close(); }
});

test('Ask + countdown off: the prompt waits with no timer; length 0 acts at once with NO prompt (Resume, or Start from beginning + clear)', async () => {
  let r = realPlayerRealm(754, { ...ASKED, filetube_resume_countdown: '0' });
  try {
    await loadAndSettle(r);
    assert.strictEqual(r.$('#resume-overlay').hidden, false);
    assert.strictEqual(r.liveTimers(), 0);
    assert.strictEqual(r.$('#resume-yes-btn .ui-btn__label').textContent, 'Resume');
  } finally { r.close(); }
  r = realPlayerRealm(754, { ...ASKED, filetube_resume_countdown_seconds: '0' });
  try {
    await loadAndSettle(r);
    assert.strictEqual(r.$('#resume-overlay').hidden, true, 'no prompt');
    assert.strictEqual(r.$('#media-player').currentTime, 754);
    assert.strictEqual(r.$('#resume-toast').hidden, true, 'and no toast');
  } finally { r.close(); }
  r = realPlayerRealm(754, { ...ASKED, filetube_resume_countdown_seconds: '0', filetube_resume_countdown_action: 'beginning' });
  try {
    await loadAndSettle(r);
    assert.strictEqual(r.$('#resume-overlay').hidden, true);
    assert.strictEqual(r.$('#media-player').currentTime, 0);
    assert.ok(r.fetches.some((f) => f.method !== 'GET' && /progress/.test(f.url) && f.body && f.body.timestamp === 0), 'saved position cleared');
  } finally { r.close(); }
});

test('Ask: R resumes, S starts from the beginning, a bare R with no prompt does nothing', async () => {
  let r = realPlayerRealm(754, ASKED);
  try { await loadAndSettle(r); key(r, 'r'); await settle(); assert.strictEqual(r.$('#media-player').currentTime, 754); assert.strictEqual(r.$('#resume-overlay').hidden, true); assert.strictEqual(r.liveTimers(), 0); } finally { r.close(); }
  r = realPlayerRealm(754, ASKED);
  try { await loadAndSettle(r); key(r, 'S'); await settle(); assert.strictEqual(r.$('#media-player').currentTime, 0); assert.strictEqual(r.$('#resume-overlay').hidden, true); assert.ok(r.media.plays >= 1); } finally { r.close(); }
  r = realPlayerRealm(754, {});
  try { await loadAndSettle(r); r.$('#media-player').currentTime = 300; key(r, 'r'); await settle(); assert.strictEqual(r.$('#media-player').currentTime, 300, 'auto mode: R is not bound'); } finally { r.close(); }
});

test('Ask: dock dismisses the prompt and RESUMES; close and the next load dismiss it and kill the timer', async () => {
  for (const seam of ['dock', 'close', 'next load']) {
    const r = realPlayerRealm(754, ASKED);
    try {
      await loadAndSettle(r);
      const overlay = r.$('#resume-overlay');
      const video = r.$('#media-player');
      assert.strictEqual(overlay.hidden, false, 'precondition (' + seam + ')');
      if (seam === 'dock') r.player.dock();
      else if (seam === 'close') r.player.close();
      else r.player.load('v2', { ...VIDEO, id: 'v2' }, { slot: r.slot });
      assert.strictEqual(overlay.hidden, true, seam + ' hid the prompt');
      assert.strictEqual(r.liveTimers(), 0, seam + ' killed the timer');
      if (seam === 'dock') assert.strictEqual(video.currentTime, 754, 'dock resumed');
      else assert.notStrictEqual(video.currentTime, 754, seam + ' did not resume');
    } finally { r.close(); }
  }
});

test('the surfaces that never prompt stay silent in Ask mode: under the threshold, no progress', async () => {
  for (const [saved, expect] of [[42, 42], [0, 0]]) {
    const r = realPlayerRealm(saved, ASKED);
    try {
      await loadAndSettle(r);
      assert.strictEqual(r.$('#resume-overlay').hidden, true, saved + 's: no prompt');
      assert.strictEqual(r.$('#media-player').currentTime, expect);
    } finally { r.close(); }
  }
});

test('no countdown timer survives a re-armed prompt (a second Ask load never leaves two timers)', async () => {
  const r = realPlayerRealm(754, ASKED);
  try {
    await loadAndSettle(r);
    r.player.load('v2', { ...VIDEO, id: 'v2' }, { slot: r.slot });
    for (let i = 0; i < 6; i++) await settle();
    assert.strictEqual(r.liveTimers(), 1, 'exactly one live timer for the new prompt');
  } finally { r.close(); }
});
