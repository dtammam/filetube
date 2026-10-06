'use strict';

// [UNIT] v1.366.0 gate r1 (adversary W2, qa W2/W2b): the 360 view's WIRING, not just its pure decision. The REAL
// watch view (test/helpers/watch-view-harness.js: watch.html, ui.js, common.js, main.js, watch.js) with the
// persistent host cloned from watch.html's own template and a stub window.VrView whose mount() returns a handle
// that counts destroy(). Each boundary is driven through the real listener it depends on (the switch's change, the
// owner's pick, the <video> events, the host class observer, fullscreenchange, the view's abort), so deleting that
// listener or its unmount turns a named test red.

const { test } = require('node:test');
const assert = require('node:assert');
const { watchViewRealm, VIDEO } = require('../helpers/watch-view-harness');
const W = require('../../public/js/watch.js');

const SPHERE = { ...VIDEO, id: 'vr1', projection: '360', width: 512, height: 256 };
const FLAT = { ...VIDEO, id: 'flat1', width: 1920, height: 1080 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function stubVrView() {
  const mounts = [];
  return {
    mounts,
    live: () => mounts.filter((m) => m.destroyed === 0),
    api: {
      mount(video, host, projection, opts) {
        const m = {
          video, host, projection, opts, destroyed: 0, motion: false, enableCalls: 0, permission: 'granted',
          destroy() { m.destroyed++; },
          enableMotion() { m.enableCalls++; const ok = m.permission === 'granted'; return Promise.resolve(ok).then((v) => { if (v) m.motion = true; return v; }); },
          disableMotion() { m.motion = false; },
          motionOn() { return m.motion; },
        };
        mounts.push(m);
        return m;
      },
    },
  };
}

// opts: item, me, switchOn, vr (false = window.VrView absent at init), motion (a phone with a motion API), route
async function vrRealm(o) {
  const opts = o || {};
  const item = opts.item || SPHERE;
  const ps = { state: 'full' };
  const r = watchViewRealm({
    item, me: opts.me, route: opts.route,
    player: { getState: () => ps.state, currentId: item.id, togglePlay: () => {} },
  });
  const { w, doc } = r;
  // The persistent host (player.js ensureHost clones this template into the slot; the harness carves player.js out).
  doc.getElementById('player-slot').appendChild(doc.getElementById('player-host-template').content.cloneNode(true));
  const toasts = [];
  w.ui.toast = (m) => { toasts.push(typeof m === 'string' ? m : (m && m.message) || String(m)); };
  const menus = [];
  w.ui.menu = (cfg) => { menus.push(cfg); };
  if (opts.switchOn !== false) w.localStorage.setItem(W.VR_VIEW_STORAGE_KEY, '1');
  if (opts.motion) {
    w.DeviceOrientationEvent = function DeviceOrientationEvent() {};
    w.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  const vr = stubVrView();
  if (opts.vr !== false) w.VrView = vr.api;
  r.init();
  await r.settle(20);
  const $id = (id) => doc.getElementById(id);
  return Object.assign(r, { ps, vr, toasts, menus, $id, video: $id('media-player'), host: $id('player-wrapper') });
}
function flipSwitch(r, on) {
  const c = r.$id('watch-vr-check');
  c.checked = on;
  c.dispatchEvent(new r.w.Event('change', { bubbles: true }));
}

test('wiring: a sphere with the switch on mounts ONCE, on this item, inside the host', async () => {
  const r = await vrRealm();
  try {
    assert.strictEqual(r.vr.mounts.length, 1);
    assert.strictEqual(r.vr.mounts[0].projection, '360');
    assert.strictEqual(r.vr.mounts[0].video, r.video);
    assert.strictEqual(r.vr.mounts[0].host, r.host);
    assert.strictEqual(r.$id('watch-vr-row').hidden, false, 'the 360 row shows for a sphere');
    assert.strictEqual(r.$id('watch-vr-check').checked, true, 'it reflects the stored switch');
  } finally { r.close(); }
});

test('wiring: navigation away (the view\'s abort) unmounts the sphere and hides every VR row', async () => {
  const r = await vrRealm();
  try {
    assert.strictEqual(r.vr.live().length, 1, 'mounted (non-vacuity)');
    r.destroy();
    await r.settle();
    assert.strictEqual(r.vr.live().length, 0, 'the sphere does not outlive its view');
    for (const id of ['watch-vr-row', 'watch-vr-motion-row', 'video-type-btn']) assert.strictEqual(r.$id(id).hidden, true, id + ' hidden after the view ends');
  } finally { r.close(); }
});

test('wiring: the switch off unmounts; on again mounts a new sphere', async () => {
  const r = await vrRealm();
  try {
    flipSwitch(r, false);
    await r.settle();
    assert.strictEqual(r.vr.live().length, 0, 'off unmounts');
    assert.strictEqual(r.w.localStorage.getItem(W.VR_VIEW_STORAGE_KEY), null, 'off is stored');
    flipSwitch(r, true);
    await r.settle();
    assert.strictEqual(r.vr.live().length, 1);
    assert.strictEqual(r.vr.mounts.length, 2);
  } finally { r.close(); }
});

test('wiring: the owner\'s Flat pick unmounts and hides the 360 row; Auto brings it back', async () => {
  let serve = null;
  const r = await vrRealm({ route: (m, url, body) => (m === 'POST' && url === '/api/videos/vr1/projection'
    ? { status: 200, body: { success: true, projection: serve, projectionOverride: body.projection } } : null) });
  try {
    r.$id('video-type-btn').click();
    assert.strictEqual(r.menus.length, 1, 'the Video type menu opened (non-vacuity)');
    serve = null;
    r.menus[0].onSelect('flat');
    await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/videos/vr1/projection').map((f) => f.body), [{ projection: 'flat' }]);
    assert.strictEqual(r.vr.live().length, 0, 'Flat unmounts');
    assert.strictEqual(r.$id('watch-vr-row').hidden, true, 'and hides the 360 row');
    serve = '360';
    r.$id('video-type-btn').click();
    r.menus[1].onSelect('auto');
    await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/videos/vr1/projection')[1].body, { projection: null });
    assert.strictEqual(r.vr.live().length, 1, 'Auto: the file\'s sphere again');
  } finally { r.close(); }
});

test('wiring: the player moving to another item (loadedmetadata on the <video>) unmounts', async () => {
  const r = await vrRealm();
  try {
    r.w.FileTube.player.currentId = 'someone-else';
    r.video.dispatchEvent(new r.w.Event('loadedmetadata'));
    await r.settle();
    assert.strictEqual(r.vr.live().length, 0);
  } finally { r.close(); }
});

test('wiring: a flat video never mounts and hides the 360 row (switch on); the Video type row is the owner\'s only', async () => {
  const flat = await vrRealm({ item: FLAT });
  try {
    assert.strictEqual(flat.vr.mounts.length, 0, 'a flat video never mounts');
    assert.strictEqual(flat.$id('watch-vr-row').hidden, true, 'the 360 row is hidden for a flat video');
    assert.strictEqual(flat.$id('video-type-btn').hidden, false, 'an admin sees Video type on any video');
  } finally { flat.close(); }
  const member = await vrRealm({ me: { username: 'm', role: 'member' } });
  try {
    assert.strictEqual(member.$id('video-type-btn').hidden, true, 'a member never sees Video type');
    assert.strictEqual(member.$id('watch-vr-row').hidden, false, 'the 360 view itself is for everyone');
  } finally { member.close(); }
  const granted = await vrRealm({ me: { username: 'g', role: 'member', canModifyLibrary: true } });
  try { assert.strictEqual(granted.$id('video-type-btn').hidden, false, 'a member with the modify right does'); } finally { granted.close(); }
});

test('wiring (qa S5): a capability answer that lands AFTER the item still reveals the owner\'s Video type row', async () => {
  const r = await vrRealm({ route: (m, url) => (url === '/api/auth/me' ? { status: 200, body: { user: { username: 'admin', role: 'admin' } }, delayMs: 1000 } : null) });
  try {
    assert.ok(r.calls('GET', '/api/videos/vr1').length >= 1, 'the item loaded first (non-vacuity)');
    assert.strictEqual(r.$id('video-type-btn').hidden, true, 'not yet: the capability is unknown');
    await wait(1100);
    await r.settle();
    assert.strictEqual(r.$id('video-type-btn').hidden, false, 'the late answer re-syncs the row');
  } finally { r.close(); }
});

test('wiring: the state is RE-CHECKED after vr-view.js loads (the switch went off while it loaded: no mount)', async () => {
  for (const offDuringLoad of [true, false]) {
    const r = await vrRealm({ vr: false });
    try {
      const el = r.doc.querySelector('script[src="/js/vr-view.js"]');
      assert.ok(el, 'the script was requested on the first sphere mount');
      if (offDuringLoad) r.w.localStorage.removeItem(W.VR_VIEW_STORAGE_KEY); // no change event: only the re-check sees it
      r.w.VrView = r.vr.api;
      el.onload();
      await r.settle();
      assert.strictEqual(r.vr.mounts.length, offDuringLoad ? 0 : 1, offDuringLoad ? 'off while loading: nothing mounts' : 'control: still on, it mounts');
    } finally { r.close(); }
  }
});

test('wiring: the host class observer drives the sync - docking the player unmounts', async () => {
  const r = await vrRealm();
  try {
    r.ps.state = 'docked';
    r.host.classList.add('is-docked-for-test');
    await r.settle();
    assert.strictEqual(r.vr.live().length, 0, 'docked: no sphere');
    r.ps.state = 'full';
    r.host.classList.remove('is-docked-for-test');
    await r.settle();
    assert.strictEqual(r.vr.live().length, 1, 'back to full: the sphere again');
  } finally { r.close(); }
});

test('wiring: the native-controls mode unmounts and hides the 360 row (its switch could never mount there)', async () => {
  const r = await vrRealm();
  try {
    r.host.classList.add('native-controls');
    await r.settle();
    assert.strictEqual(r.vr.live().length, 0);
    assert.strictEqual(r.$id('watch-vr-row').hidden, true);
  } finally { r.close(); }
});

function setFullscreenElement(r, el) { Object.defineProperty(r.doc, 'fullscreenElement', { get: () => el, configurable: true }); }
function setPipElement(r, el) { Object.defineProperty(r.doc, 'pictureInPictureElement', { get: () => el, configurable: true }); }

test('wiring: the <video>\'s own full screen that HOLDS unmounts (flat), and leaving it remounts with the full-screen note', async () => {
  const r = await vrRealm();
  try {
    setFullscreenElement(r, r.video);
    r.doc.dispatchEvent(new r.w.Event('fullscreenchange'));
    await r.settle();
    assert.strictEqual(r.vr.live().length, 1, 'not yet: a presentation must hold first');
    await wait(W.VR_NATIVE_SETTLE_MS + 150);
    await r.settle();
    assert.strictEqual(r.vr.live().length, 0, 'held: the sphere gives way');
    assert.deepStrictEqual(r.toasts, [], 'no toast while the browser shows the video');
    setFullscreenElement(r, null);
    r.doc.dispatchEvent(new r.w.Event('fullscreenchange'));
    await r.settle();
    assert.strictEqual(r.vr.live().length, 1, 'back: the sphere returns');
    assert.deepStrictEqual(r.toasts, [W.VR_NATIVE_NOTE]);
  } finally { r.close(); }
});

test('wiring: iPhone native full screen (webkitbeginfullscreen) that holds unmounts; webkitendfullscreen remounts with the note', async () => {
  const r = await vrRealm();
  try {
    r.video.webkitDisplayingFullscreen = true;
    r.video.dispatchEvent(new r.w.Event('webkitbeginfullscreen'));
    await wait(W.VR_NATIVE_SETTLE_MS + 150);
    await r.settle();
    assert.strictEqual(r.vr.live().length, 0);
    r.video.webkitDisplayingFullscreen = false;
    r.video.dispatchEvent(new r.w.Event('webkitendfullscreen'));
    await r.settle();
    assert.strictEqual(r.vr.live().length, 1);
    assert.deepStrictEqual(r.toasts, [W.VR_NATIVE_NOTE]);
  } finally { r.close(); }
});

test('wiring: the iPhone rotate bounce (native full screen ends inside the settle window) keeps the sphere and says nothing', async () => {
  const r = await vrRealm();
  try {
    r.video.webkitDisplayingFullscreen = true;
    r.video.dispatchEvent(new r.w.Event('webkitbeginfullscreen'));
    await wait(100); // player.js bounces it into the app's own full screen (5 tries, 45 ms apart)
    r.video.webkitDisplayingFullscreen = false;
    r.video.dispatchEvent(new r.w.Event('webkitendfullscreen'));
    await wait(W.VR_NATIVE_SETTLE_MS + 150);
    await r.settle();
    assert.strictEqual(r.vr.mounts.length, 1, 'never remounted');
    assert.strictEqual(r.vr.live().length, 1, 'the sphere stayed up the whole time');
    assert.deepStrictEqual(r.toasts, [], 'no note: the user never saw a flat picture');
  } finally { r.close(); }
});

test('wiring: Picture in Picture that holds unmounts; leaving it says the PiP note, in its own words', async () => {
  const r = await vrRealm();
  try {
    setPipElement(r, r.video);
    r.video.dispatchEvent(new r.w.Event('enterpictureinpicture'));
    await wait(W.VR_NATIVE_SETTLE_MS + 150);
    await r.settle();
    assert.strictEqual(r.vr.live().length, 0);
    setPipElement(r, null);
    r.video.dispatchEvent(new r.w.Event('leavepictureinpicture'));
    await r.settle();
    assert.strictEqual(r.vr.live().length, 1);
    assert.deepStrictEqual(r.toasts, [W.VR_PIP_NOTE]);
  } finally { r.close(); }
});

test('wiring: a lost WebGL context stays flat - no remount on the next host change, until the switch is flipped', async () => {
  const r = await vrRealm();
  try {
    r.vr.mounts[0].opts.onFail();
    await r.settle();
    assert.strictEqual(r.vr.live().length, 0);
    assert.deepStrictEqual(r.toasts, ['360 view stopped; showing the flat picture']);
    r.host.classList.add('controls-autohidden'); // the bar auto-hides: the observer syncs
    r.host.classList.remove('controls-autohidden');
    await r.settle();
    assert.strictEqual(r.vr.mounts.length, 1, 'no new context after a loss');
    assert.strictEqual(r.toasts.length, 1, 'no toast cycle');
    flipSwitch(r, false); flipSwitch(r, true);
    await r.settle();
    assert.strictEqual(r.vr.live().length, 1, 'the user asking again tries again');
  } finally { r.close(); }
});

test('wiring: too large is refused the same way (no retry on a host change)', async () => {
  const r = await vrRealm();
  try {
    r.vr.mounts[0].opts.onTooLarge();
    r.host.classList.add('controls-autohidden');
    await r.settle();
    assert.strictEqual(r.vr.mounts.length, 1);
    assert.deepStrictEqual(r.toasts, ['This video is too large for 360 view on this device']);
  } finally { r.close(); }
});

test('R1 Move to look: shown only while a sphere is up on a device with motion; hidden on desktop or with no motion API', async () => {
  const desk = await vrRealm();
  try {
    assert.strictEqual(desk.vr.live().length, 1, 'a sphere is up (non-vacuity)');
    assert.strictEqual(desk.$id('watch-vr-motion-row').hidden, true, 'desktop / no motion: hidden');
  } finally { desk.close(); }
  const phone = await vrRealm({ motion: true });
  try {
    assert.strictEqual(phone.$id('watch-vr-motion-row').hidden, false, 'a phone with the sphere up: shown');
    assert.strictEqual(phone.$id('watch-vr-motion-check').checked, false, 'off by default at every mount');
    flipSwitch(phone, false);
    await phone.settle();
    assert.strictEqual(phone.$id('watch-vr-motion-row').hidden, true, 'no sphere: hidden');
  } finally { phone.close(); }
  const noApi = await vrRealm({ motion: true });
  try {
    delete noApi.w.DeviceOrientationEvent;
    noApi.host.classList.add('x'); await noApi.settle();
    assert.strictEqual(noApi.$id('watch-vr-motion-row').hidden, true, 'no DeviceOrientationEvent: hidden');
  } finally { noApi.close(); }
});

test('R1 Move to look: the tap calls enableMotion INSIDE the click; granted turns it on; denied leaves it off with a note', async () => {
  const r = await vrRealm({ motion: true });
  try {
    const m = r.vr.mounts[0];
    const check = r.$id('watch-vr-motion-check');
    check.click();
    assert.strictEqual(m.enableCalls, 1, 'asked synchronously, inside the click (iOS needs the gesture)');
    await r.settle();
    assert.strictEqual(m.motion, true);
    assert.strictEqual(check.checked, true, 'granted: on');
    check.click();
    await r.settle();
    assert.strictEqual(m.motion, false, 'a second tap turns it off');
    assert.strictEqual(check.checked, false);
    m.permission = 'denied';
    check.click();
    assert.strictEqual(m.enableCalls, 2);
    await r.settle();
    assert.strictEqual(m.motion, false);
    assert.strictEqual(check.checked, false, 'denied: the switch returns off');
    assert.deepStrictEqual(r.toasts, [W.VR_MOTION_DENIED_NOTE]);
    // A new sphere starts with motion off again.
    flipSwitch(r, false); flipSwitch(r, true);
    await r.settle();
    assert.strictEqual(r.vr.live().length, 1);
    assert.strictEqual(check.checked, false, 'off at every mount');
  } finally { r.close(); }
});

test('D: a TV episode shows no VR rows, even after a sphere page left them shown (the cog lives in the persistent host)', async () => {
  const r = await vrRealm({ route: (m, url) => (url.indexOf('/api/tv/episode/') === 0 ? { status: 200, body: { id: 'ep1', title: 'Pilot', showId: 's1', showName: 'Show', type: 'video', projection: '360' } } : null) });
  try {
    assert.strictEqual(r.$id('watch-vr-row').hidden, false, 'shown on the sphere page (non-vacuity)');
    r.destroy();
    await r.settle();
    // Even if a row were left shown (an older path), the TV view's own cog injection hides it.
    for (const id of ['watch-vr-row', 'watch-vr-motion-row', 'video-type-btn']) r.$id(id).hidden = false;
    r.w.history.replaceState(null, '', '/watch.html?tv=ep1');
    r.init();
    await r.settle(20);
    assert.ok(r.calls('GET', '/api/tv/episode/ep1').length >= 1, 'the TV path ran (non-vacuity)');
    for (const id of ['watch-vr-row', 'watch-vr-motion-row', 'video-type-btn']) assert.strictEqual(r.$id(id).hidden, true, id + ' hidden on a TV episode');
    assert.strictEqual(r.vr.live().length, 0, 'and nothing mounts there');
  } finally { r.close(); }
});
