'use strict';

// [UNIT] v1.353 Speakers volume, the phone's half, through the REAL skin engine (skin-surface.js) and
// the REAL skin registry (music-skins.js) in jsdom: the iPod's own volume bar takes the scrubber's
// place while this device controls a speaker (a tap on the time labels, or Speakers > Volume), the
// wheel turns the speaker's volume 5% a detent while it shows, and MENU, Select or ~2 s idle put the
// scrubber back. Without a speaker the Now Playing wheel SCRUBS (Dean, 2026-09-02): the lock below
// goes red if the volume mode leaks. Cider/Nordic get one row. Every iPod skin renders the bar.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const SK = require('../../public/js/music-skins.js');

const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;

// opts.speaker: {level} = this device controls a speaker that reported that level; null = local play.
function boot(opts) {
  const o = opts || {};
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  // the engine's idle timer runs on the PANEL's window: manual-fire fakes
  const timers = [];
  dom.window.setTimeout = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; };
  dom.window.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].live = false; };
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const st = { skin: o.skin || 'ipod', speaker: o.speaker === undefined ? { level: 0.5 } : o.speaker, sets: [], dock: 0 };
  const volume = {
    available: () => !!st.speaker && !st.docked,
    level: () => (st.speaker && typeof st.speaker.level === 'number' ? st.speaker.level : null),
    set: (v) => { st.sets.push(v); if (st.speaker) st.speaker.level = v; },
  };
  const cfg = {
    panel: dom.window.document.getElementById('panel'),
    getSkinId: () => st.skin,
    getCtx: () => ({ track: { title: 'T', artist: 'A', album: 'B', artUrl: '' }, upNext: [], fullList: [], playing: true, posSec: 10, durSec: 100,
      posLabel: '0:10', remLabel: '-1:30', remote: st.speaker ? { label: 'Desk' } : undefined, volume: volume.level() }),
    hostCtl: (id) => dom.window.document.getElementById(id),
    onSelectIndex: () => {},
    onDock: () => { st.dock += 1; },
    win: dom.window,
  };
  if (!o.noVolumeCfg) cfg.volume = volume;
  if (o.menu) cfg.menu = o.menu;
  const engine = dom.window.FileTubeSkinSurface.create(cfg);
  return { dom, engine, st, timers, restore: () => Object.assign(global, saved) };
}
const P = (b) => b.dom.window.document.getElementById('panel');
const click = (b, el) => el.dispatchEvent(new b.dom.window.MouseEvent('click', { bubbles: true }));
function spin(b, angles) {
  const wheel = P(b).querySelector('.ip-wheel');
  const at = (deg) => { const r = deg * Math.PI / 180; return { clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) }; };
  const s = at(angles[0]);
  wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: s.clientX, clientY: s.clientY }));
  angles.slice(1).forEach((d) => { const q = at(d); wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); });
  wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
}
function liveMedia(b) {
  const mp = b.dom.window.document.getElementById('media-player');
  Object.defineProperty(mp, 'duration', { value: 300, configurable: true });
  const m = { ct: 150 };
  Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => m.ct, set: (v) => { m.ct = v; } });
  return m;
}
const voladj = (b) => P(b).classList.contains('mms-voladj');
const openByTap = (b) => click(b, P(b).querySelector('[data-skin-voltap]'));
const fireIdle = (b) => { const live = b.timers.filter((t) => t.live && t.ms === 2000); live.forEach((t) => { t.live = false; t.fn(); }); return live.length; };

test('v1.353 the 09-02 lock: with a speaker controlled but the bar NOT up, a Now Playing spin scrubs and never sets a volume', () => {
  const b = boot();
  try {
    b.engine.paint();
    const m = liveMedia(b);
    spin(b, [0, 40, 80, 120, 160]);
    assert.ok(m.ct > 150, 'scrubbed');
    assert.deepStrictEqual(b.st.sets, [], 'no volume sent');
    assert.strictEqual(voladj(b), false);
  } finally { b.restore(); }
});

test('v1.353 local play (no volume config, no speaker): no bar renders, no time-label tap, and the spin scrubs', () => {
  for (const o of [{ noVolumeCfg: true, speaker: null }, { speaker: null }]) {
    const b = boot(o);
    try {
      b.engine.paint();
      assert.strictEqual(P(b).querySelector('.ip-vol'), null, 'no bar');
      assert.strictEqual(P(b).querySelector('[data-skin-voltap]'), null, 'no tap target');
      assert.strictEqual(b.engine.openVolume(), false, 'nothing to open');
      const m = liveMedia(b);
      spin(b, [0, 40, 80, 120]);
      assert.ok(m.ct > 150);
    } finally { b.restore(); }
  }
});

test('v1.353 a tap on a time label brings the bar up in the scrubber\'s place; the wheel then turns the speaker\'s volume 5% a detent', () => {
  const b = boot();
  try {
    b.engine.paint();
    const labels = P(b).querySelectorAll('[data-skin-voltap]');
    assert.deepStrictEqual([...labels].map((e) => e.className), ['mms-pos', 'mms-rem'], 'both time labels');
    click(b, labels[1]);
    assert.strictEqual(voladj(b), true, 'the bar is up');
    const m = liveMedia(b);
    let commits = 0;
    b.dom.window.document.getElementById('seek-bar').addEventListener('change', () => { commits += 1; });
    spin(b, [0, 30, 60, 90]); // 90 deg clockwise = 4 detents of 22
    assert.deepStrictEqual(b.st.sets, [0.55, 0.6, 0.65, 0.7], 'louder, 5% a detent');
    assert.strictEqual(m.ct, 150, 'the playhead never moved');
    assert.strictEqual(commits, 0, 'no seek committed');
    spin(b, [90, 60, 30]); // 60 deg back = 2 detents
    assert.deepStrictEqual(b.st.sets.slice(4), [0.65, 0.6], 'counter-clockwise is quieter');
    assert.strictEqual(P(b).querySelector('.ip-vol-fill').style.width, '60%', 'the bar shows it');
    assert.strictEqual(P(b).querySelector('.ip-vol').getAttribute('aria-valuenow'), '60');
  } finally { b.restore(); }
});

test('v1.353 the ends clamp: 0 and 1 never overshoot, and a turn at the end sends nothing more', () => {
  const b = boot({ speaker: { level: 0.95 } });
  try {
    b.engine.paint(); openByTap(b);
    spin(b, [0, 30, 60, 90]);
    assert.deepStrictEqual(b.st.sets, [1], 'one step to 1, then nothing');
    b.st.speaker.level = 0.05;
    spin(b, [90, 60, 30, 0]);
    assert.deepStrictEqual(b.st.sets.slice(1), [0]);
  } finally { b.restore(); }
});

test('v1.353 MENU puts the scrubber back at once (and does NOT dock); the next MENU docks as before', () => {
  const b = boot();
  try {
    b.engine.paint(); openByTap(b);
    click(b, P(b).querySelector('[data-skin-menu]'));
    assert.strictEqual(voladj(b), false);
    assert.strictEqual(b.st.dock, 0, 'MENU only closed the bar');
    const m = liveMedia(b);
    spin(b, [0, 40, 80, 120]);
    assert.ok(m.ct > 150, 'the wheel scrubs again');
    click(b, P(b).querySelector('.ip-wheel')); // the browser's click after a moved spin (the suppress guard eats it)
    click(b, P(b).querySelector('[data-skin-menu]'));
    assert.strictEqual(b.st.dock, 1, 'the next MENU docks as before');
  } finally { b.restore(); }
});

test('v1.353 Select also puts the scrubber back (never opens the song list from the volume bar)', () => {
  const b = boot();
  try {
    b.engine.paint(); openByTap(b);
    click(b, P(b).querySelector('[data-skin-select]'));
    assert.strictEqual(voladj(b), false);
    assert.strictEqual(P(b).classList.contains('mms-listmode'), false, 'no list');
  } finally { b.restore(); }
});

test('v1.353 ~2 s with no turn puts the scrubber back; a thumb still on the wheel re-arms instead', () => {
  const b = boot();
  try {
    b.engine.paint(); openByTap(b);
    assert.ok(fireIdle(b) >= 1, 'a 2 s timer was armed');
    assert.strictEqual(voladj(b), false, 'idle closed it');
    openByTap(b);
    const wheel = P(b).querySelector('.ip-wheel');
    const at = (deg) => { const r = deg * Math.PI / 180; return { clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) }; };
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, ...at(0) }));
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, ...at(30) }));
    fireIdle(b);
    assert.strictEqual(voladj(b), true, 'mid-turn the bar stays');
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
    fireIdle(b);
    assert.strictEqual(voladj(b), false, 'after the lift, idle closes it');
  } finally { b.restore(); }
});

test('v1.353 the bar shows the speaker\'s REPORTED level, follows a new report, and a repaint keeps it up', () => {
  const b = boot({ speaker: { level: 0.3 } });
  try {
    b.engine.paint(); openByTap(b);
    assert.strictEqual(P(b).querySelector('.ip-vol-fill').style.width, '30%');
    b.st.speaker.level = 0.8; // the PC's own slider moved; the view reflects
    b.engine.reflect();
    assert.strictEqual(P(b).querySelector('.ip-vol-fill').style.width, '80%');
    assert.strictEqual(P(b).querySelector('.ip-vol').getAttribute('aria-valuenow'), '80');
    b.engine.paint(); // a state report / track change repaints
    assert.strictEqual(voladj(b), true, 'still up after the repaint');
    assert.strictEqual(P(b).querySelector('.ip-vol-fill').style.width, '80%');
  } finally { b.restore(); }
});

test('v1.353 the clear: leaving the speaker (from a POPULATED, open bar) repaints with no bar, no tap target, and a scrubbing wheel', () => {
  const b = boot({ speaker: { level: 0.4 } });
  try {
    b.engine.paint(); openByTap(b);
    assert.strictEqual(voladj(b), true);
    b.st.speaker = null; // RC.leave()
    b.engine.paint();
    assert.strictEqual(voladj(b), false);
    assert.strictEqual(P(b).querySelector('.ip-vol'), null);
    assert.strictEqual(P(b).querySelector('[data-skin-voltap]'), null);
    const m = liveMedia(b);
    spin(b, [0, 40, 80, 120]);
    assert.ok(m.ct > 150);
    assert.deepStrictEqual(b.st.sets, []);
  } finally { b.restore(); }
});

test('v1.353 a tap on the volume bar sets the level where it lands (5% steps)', () => {
  const b = boot();
  try {
    b.engine.paint(); openByTap(b);
    const bar = P(b).querySelector('.ip-vol');
    bar.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 10, right: 300, bottom: 10 });
    bar.dispatchEvent(new b.dom.window.MouseEvent('click', { bubbles: true, clientX: 241 }));
    assert.deepStrictEqual(b.st.sets, [0.7]);
    assert.strictEqual(voladj(b), true, 'still up');
  } finally { b.restore(); }
});

test('v1.353 Cider and Nordic: one volume row while a speaker reports a level, none otherwise; a tap sets the level', () => {
  for (const skin of ['apple', 'spotify']) {
    const b = boot({ skin, speaker: { level: 0.25 } });
    try {
      b.engine.paint();
      const row = P(b).querySelector('.mms-volrow [data-skin-vol]');
      assert.ok(row, skin + ' has the row');
      assert.strictEqual(row.querySelector('.mms-volfill').style.width, '25%');
      row.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 4, right: 100, bottom: 4 });
      row.dispatchEvent(new b.dom.window.MouseEvent('click', { bubbles: true, clientX: 90 }));
      assert.deepStrictEqual(b.st.sets, [0.9], skin);
      assert.strictEqual(row.querySelector('.mms-volfill').style.width, '90%');
      b.st.speaker = null;
      b.engine.paint();
      assert.strictEqual(P(b).querySelector('.mms-volrow'), null, skin + ' row gone with the speaker');
    } finally { b.restore(); }
  }
});

test('v1.353 every iPod skin renders the bar and the time-label taps with a level, and none without (inert sibling)', () => {
  const ipods = SK.IDS.filter((id) => /<div class="ip-wheel">/.test(SK.renderFull(id, { track: {} })));
  assert.ok(ipods.length > 100, 'the real registry: ' + ipods.length);
  for (const id of ipods) {
    const on = SK.renderFull(id, { track: {}, volume: 0.4 });
    assert.match(on, /<div class="ip-vol" data-skin-vol role="slider" aria-label="Volume"[^>]*aria-valuenow="40"/, id);
    assert.match(on, /<div class="ip-vol-fill" style="width:40%">/, id);
    assert.strictEqual((on.match(/data-skin-voltap/g) || []).length, 2, id);
    const off = SK.renderFull(id, { track: {} });
    assert.ok(!/ip-vol|data-skin-voltap/.test(off), id + ' local');
  }
  for (const id of ['apple', 'spotify']) assert.ok(!/ip-vol"/.test(SK.renderFull(id, { track: {}, volume: 0.4 })), id + ' has no iPod bar');
});

test('v1.353 Speakers > Volume (the menu row) lands on Now Playing with the bar up', async () => {
  const menu = {
    load: (node) => Promise.resolve(node.type === 'playon' ? { items: [{ label: 'Volume', action: 'volume' }] } : { items: [] }),
    hasCurrent: () => true, hasPlayOn: () => true, onPlay: () => {}, onShuffleAll: () => {}, currentId: () => null,
  };
  const b = boot({ menu });
  try {
    b.engine.paint();
    click(b, P(b).querySelector('[data-skin-playon]')); // the badge opens Speakers
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
    const row = [...P(b).querySelectorAll('.ipm-row:not(.ipm-skel)')].find((x) => /Volume/.test(x.textContent));
    assert.ok(row, 'the Volume row is listed');
    click(b, row);
    assert.strictEqual(P(b).querySelector('.ip-np').textContent, 'Now Playing');
    assert.strictEqual(voladj(b), true, 'the bar is up');
  } finally { b.restore(); }
});

test('v1.353 a stale tap target never opens the bar: the speaker left (no repaint yet), or the view stepped aside with a level still known', () => {
  const b = boot({ speaker: { level: 0.5 } });
  try {
    b.engine.paint();
    b.st.docked = true; // the view says no (remoteDocked) while the PC's level is still known
    openByTap(b);
    assert.strictEqual(voladj(b), false, 'not available: no bar');
    b.st.docked = false;
    b.st.speaker = null; // RC.leave(), the repaint not run yet
    openByTap(b);
    assert.strictEqual(voladj(b), false, 'no speaker: no bar');
    const m = liveMedia(b);
    spin(b, [0, 40, 80, 120]);
    assert.ok(m.ct > 150, 'and the wheel scrubs');
    assert.deepStrictEqual(b.st.sets, []);
  } finally { b.restore(); }
});
