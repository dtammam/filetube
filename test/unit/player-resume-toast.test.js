'use strict';

// [UNIT] UI pass sweep S3 (D8.2, Dean's audit decision 3, F51): the "Resume playback?"
// modal and its v1.132 countdown are replaced by AUTO-RESUME + a "Resumed at 12:34 - Start
// over" toast over the bottom-left of the video for 4s, then a fade. It must not touch the
// <video> lifecycle, fullscreen or faux-fullscreen code: it only replaces the prompt UI and
// calls the EXISTING seek (resumeDirectly). Two halves:
//   1. the pure decision, resolveResumeStart (every arm, the docked D3 rule, the threshold);
//   2. the REAL player.js in a jsdom realm built from the real watch.html shell (its player
//      host template): a load with saved progress seeks there and plays, shows the toast,
//      hides it after 4s + the fade, Start over seeks 0 and clears the saved position, and
//      every seam that used to hide the modal (dock, close, the next load) hides the toast.
// Converts (AC12) player-resume-countdown, player-docked-resume and
// player-dock-transition-resume (the helpers they bound are gone with the modal).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const player = require('../../public/js/player.js');

const REPO = path.join(__dirname, '..', '..');
const { resolveResumeStart, resolveResumeShortcutAction } = player;

// ---- 1. the pure decision --------------------------------------------------------------

test('resolveResumeStart: announced progress (at/over the threshold, not an autoplay advance) RESUMES with the toast', () => {
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754, autoplayAdvance: false }), { action: 'resume', toast: true });
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 60, autoplayAdvance: false }), { action: 'resume', toast: true }, 'the 60s default is inclusive');
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754, dockState: 'full' }), { action: 'resume', toast: true });
});

test('resolveResumeStart: DOCKED resumes silently - the mini-player is too small for the toast (the v1.24.0 D3 rule)', () => {
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754, dockState: 'docked' }), { action: 'resume', toast: false });
});

test('resolveResumeStart: real but quiet progress (over 5s, under the threshold or an autoplay advance) resumes WITHOUT the toast', () => {
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 42 }), { action: 'resume', toast: false }, 'under the 60s default');
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 754, autoplayAdvance: true }), { action: 'resume', toast: false }, 'an autoplay advance never announces');
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 5.1 }), { action: 'resume', toast: false }, 'just over the 5s floor');
});

test('resolveResumeStart: no meaningful progress (<= 5s, missing, garbage) starts from the top', () => {
  for (const ctx of [{ savedProgress: 5 }, { savedProgress: 0 }, {}, undefined, { savedProgress: 'x' }, { savedProgress: -3 }]) {
    assert.deepStrictEqual(resolveResumeStart(ctx), { action: 'start', toast: false }, JSON.stringify(ctx));
  }
});

test('resolveResumeStart: the configurable threshold still decides the ANNOUNCEMENT (Setup -> Playback), never whether it resumes', () => {
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 30, threshold: 10 }), { action: 'resume', toast: true }, 'a lower threshold announces 30s');
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 90, threshold: 120 }), { action: 'resume', toast: false }, 'a higher one resumes 90s quietly');
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 1, threshold: 0 }), { action: 'resume', toast: true }, 'threshold 0 ("always announce") announces any real progress');
  assert.deepStrictEqual(resolveResumeStart({ savedProgress: 0, threshold: 0 }), { action: 'start', toast: false }, 'but never a never-watched video');
});

test('resolveResumeShortcutAction: S = Start over only while the toast shows; R is gone with the modal (the load has already resumed)', () => {
  assert.strictEqual(resolveResumeShortcutAction({ key: 's', overlayVisible: true }), 'restart');
  assert.strictEqual(resolveResumeShortcutAction({ key: 'S', overlayVisible: true }), 'restart');
  assert.strictEqual(resolveResumeShortcutAction({ key: 'r', overlayVisible: true }), 'none');
  assert.strictEqual(resolveResumeShortcutAction({ key: 's', overlayVisible: false }), 'none');
  assert.strictEqual(resolveResumeShortcutAction({ key: 's', overlayVisible: true, hasModifier: true }), 'none');
  assert.strictEqual(resolveResumeShortcutAction({ key: 's', overlayVisible: true, isTypingContext: true }), 'none');
});

test('the AUTO mode (the default) keeps the toast in every player template, and the v1.363 Ask me prompt sits beside it (hidden)', () => {
  const setupHtml = fs.readFileSync(path.join(REPO, 'public/setup.html'), 'utf8');
  assert.match(setupHtml, /id="resume-threshold-input"/, 'the threshold stays');
  const shells = fs.readdirSync(path.join(REPO, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join(REPO, 'public', f))
    .concat([path.join(REPO, 'lib/ytdlp/views/subscriptions.html')])
    .filter((f) => fs.readFileSync(f, 'utf8').includes('id="player-host-template"'));
  assert.ok(shells.length >= 10, 'every player-hosting shell found (' + shells.length + ')');
  for (const f of shells) {
    const html = fs.readFileSync(f, 'utf8');
    assert.match(html, /<div id="resume-toast" class="player-resumed" role="status" hidden>[\s\S]*?id="resume-time-str"[\s\S]*?<button type="button" class="ui-btn ui-btn--plain ui-btn--sm player-resumed__action" id="resume-restart-btn">/, path.basename(f));
    assert.match(html, /<div id="resume-overlay" class="resume-overlay" role="dialog" aria-labelledby="resume-prompt-title" hidden>[\s\S]*?id="resume-prompt-time"[\s\S]*?id="resume-no-btn"[\s\S]*?id="resume-yes-btn"/, path.basename(f) + ': the prompt');
  }
});

// ---- 2. the real player ---------------------------------------------------------------

function realPlayerRealm(savedSeconds) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'watch.html'), 'utf8'), {
    url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const media = { plays: 0, loads: 0 };
  w.HTMLMediaElement.prototype.load = function () { media.loads += 1; };
  w.HTMLMediaElement.prototype.play = function () { media.plays += 1; return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.formatDuration = (s) => { const t = Math.floor(s); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  // the toast's timers, driven by hand (every other timer runs for real)
  const timers = [];
  const realSetTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms) => {
    if (ms === 4000 || ms === 200) { timers.push({ fn, ms, done: false }); return 1e6 + timers.length; }
    return realSetTimeout(fn, ms);
  };
  const realClear = w.clearTimeout.bind(w);
  w.clearTimeout = (id) => { if (id > 1e6) { const t = timers[id - 1e6 - 1]; if (t) t.done = true; return; } realClear(id); };
  const runTimers = (ms) => { for (const t of timers) if (!t.done && t.ms === ms) { t.done = true; t.fn(); } };
  const fetches = [];
  w.fetch = (u, init) => {
    const method = (init && init.method) || 'GET';
    fetches.push({ method, url: String(u), body: init && init.body ? JSON.parse(init.body) : null });
    const body = String(u).indexOf('/api/progress/') === 0 ? { timestamp: savedSeconds } : (String(u).indexOf('/api/queue') === 0 ? { entries: [], pointerUid: null } : {});
    return Promise.resolve({ ok: true, json: async () => body });
  };
  w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8'));
  const $ = (sel) => w.document.querySelector(sel);
  return { w, player: w.FileTube.player, slot: $('#player-slot'), $, media, fetches, runTimers, close: () => w.close() };
}
const settle = () => new Promise((r) => setTimeout(r, 25));
const VIDEO = { id: 'v1', type: 'video', title: 'Clip', duration: 1800, filePath: '/lib/c.mp4', channelName: 'Chan', browseCtx: '', readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false };
async function loadAndSettle(r) {
  assert.strictEqual(r.player.load('v1', { ...VIDEO }, { slot: r.slot }), true, 'the load mounts');
  for (let i = 0; i < 6; i++) await settle();
}

test('a load with announced saved progress SEEKS there and plays through the existing seek, and shows "Resumed at 12:34" - no prompt (the default, auto mode)', async () => {
  const r = realPlayerRealm(754);
  try {
    await loadAndSettle(r);
    const toast = r.$('#resume-toast');
    assert.ok(toast, 'the template carries the toast');
    assert.strictEqual(r.$('#media-player').currentTime, 754, 'auto-resumed at the saved position');
    assert.ok(r.media.plays >= 1, 'and it plays (resumeDirectly -> autoStart)');
    assert.strictEqual(toast.hidden, false, 'the toast shows');
    assert.strictEqual(r.$('#resume-time-str').textContent, '12:34');
    assert.ok(toast.classList.contains('is-visible'), 'faded in on the next frame');
    assert.strictEqual(r.$('#resume-overlay').hidden, true, 'auto mode never opens the prompt');
    // 4s later it fades (the class goes), then hides ([hidden]) after the fade
    r.runTimers(4000);
    assert.ok(!toast.classList.contains('is-visible'), 'fading after 4s');
    assert.strictEqual(toast.hidden, false, 'still in the DOM during the fade');
    r.runTimers(200);
    assert.strictEqual(toast.hidden, true, 'hidden after the fade');
  } finally { r.close(); }
});

test('quiet progress (under the threshold) resumes WITHOUT the toast; no progress starts at 0 without it', async () => {
  for (const [saved, expectTime] of [[42, 42], [0, 0]]) {
    const r = realPlayerRealm(saved);
    try {
      await loadAndSettle(r);
      assert.strictEqual(r.$('#media-player').currentTime, expectTime, 'position ' + saved);
      assert.strictEqual(r.$('#resume-toast').hidden, true, 'no toast for ' + saved + 's');
    } finally { r.close(); }
  }
});

test('Start over = the old "Start from beginning": hides the toast, seeks 0, plays, and clears the saved position on the server', async () => {
  const r = realPlayerRealm(754);
  try {
    await loadAndSettle(r);
    const plays = r.media.plays;
    r.fetches.length = 0;
    r.$('#resume-restart-btn').click();
    await settle();
    assert.strictEqual(r.$('#resume-toast').hidden, true, 'the toast goes');
    assert.strictEqual(r.$('#media-player').currentTime, 0, 'seeked to the start');
    assert.ok(r.media.plays > plays, 'and plays');
    const save = r.fetches.find((f) => f.method === 'POST' && f.url === '/api/progress');
    assert.ok(save, 'the saved position is written');
    assert.strictEqual(save.body.timestamp, 0, 'as 0');
  } finally { r.close(); }
});

test('the S key starts over while the toast shows (through the real button), and does nothing once it is gone', async () => {
  const r = realPlayerRealm(754);
  try {
    await loadAndSettle(r);
    r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 's', bubbles: true }));
    await settle();
    assert.strictEqual(r.$('#media-player').currentTime, 0, 'S restarted');
    assert.strictEqual(r.$('#resume-toast').hidden, true);
    r.$('#media-player').currentTime = 300;
    r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 's', bubbles: true }));
    await settle();
    assert.strictEqual(r.$('#media-player').currentTime, 300, 'a bare s with no toast is not a restart');
  } finally { r.close(); }
});

test('every seam that hid the modal hides the toast: dock, close, and the next load (a stale toast never outlives its load)', async () => {
  for (const seam of ['dock', 'close', 'next load']) {
    const r = realPlayerRealm(754);
    try {
      await loadAndSettle(r);
      const toast = r.$('#resume-toast'); // the persistent host's node (dock/close move or detach the host)
      assert.strictEqual(toast.hidden, false, 'precondition: showing (' + seam + ')');
      if (seam === 'dock') r.player.dock();
      else if (seam === 'close') r.player.close();
      else r.player.load('v2', { ...VIDEO, id: 'v2' }, { slot: r.slot });
      assert.strictEqual(toast.hidden, true, seam + ' hid it');
      // and the old load's timers never re-show or fight it
      r.runTimers(4000); r.runTimers(200);
      if (seam !== 'next load') assert.strictEqual(toast.hidden, true, seam + ': still hidden after the timers');
    } finally { r.close(); }
  }
});
