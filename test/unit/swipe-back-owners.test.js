'use strict';

// [UNIT] v1.311.2 (Dean, device-CONFIRMED): a rightward SCRUB of the seek bar fired
// the document-wide swipe-back (v1.160) on release - history.back() left the watch
// page and dropped fullscreen. These tests drive the REAL wired listeners
// (wireSwipeBackGesture, the same function bootRouter's wireSwipeBack calls) with
// touch events on the REAL shell markup, so they prove the stand-down is reachable
// from the seek bar itself - not just that a predicate returns true in isolation.
// The control case (a drag on ordinary page content still goes back) keeps every
// "no back" assertion from being vacuous.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUBLIC = path.join(__dirname, '../../public');
const COMMON = require.resolve('../../public/js/common.js');
const skins = require('../../public/js/music-skins.js');

// Require with no document so the shell boot never runs (the v1.78.1 lesson).
delete global.document; delete global.window;
delete require.cache[COMMON];
const {
  wireSwipeBackGesture, swipeBackStandDownReason, touchActionOwnsHorizontal,
  SWIPE_BACK_OWNER_SELECTORS,
} = require(COMMON);

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });

function shellBody(file) {
  const html = fs.readFileSync(path.isAbsolute(file) ? file : path.join(PUBLIC, file), 'utf8');
  return html.slice(html.indexOf('<body'), html.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
}

// Boot a jsdom page holding `bodyHtml`, wire the real gesture, count backs.
function boot(bodyHtml) {
  dom = new JSDOM('<!DOCTYPE html><html><head></head>' + bodyHtml + '</html>', { url: 'http://localhost/watch.html?v=x' });
  const doc = dom.window.document;
  const backs = { n: 0 };
  wireSwipeBackGesture(doc, dom.window, () => { backs.n += 1; });
  // Every shell ships the player as <template id="player-host-template">; player.js
  // stamps it into the page at runtime - do the same so the live markup is tested.
  const tpl = doc.getElementById('player-host-template');
  if (tpl) doc.body.appendChild(tpl.content.cloneNode(true));
  return { doc, win: dom.window, backs };
}
function touchEvt(win, type, target, x, y) {
  const e = new win.Event(type, { bubbles: true, cancelable: true });
  const list = type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y, target }];
  Object.defineProperty(e, 'touches', { value: list });
  target.dispatchEvent(e);
}
// A clearly horizontal, rightward drag well past the 90px threshold.
function dragRight(win, target, opts) {
  const o = opts || {};
  touchEvt(win, 'touchstart', target, 20, 300);
  touchEvt(win, 'touchmove', target, 60, 302);
  if (o.mid) o.mid();
  touchEvt(win, 'touchmove', target, 200, 305);
  touchEvt(win, 'touchend', target, 200, 305);
}

test('CONTROL: a rightward drag on ordinary page content still goes back (the gesture is live)', () => {
  const { doc, win, backs } = boot('<body><main id="content"><p id="p">text</p></main></body>');
  dragRight(win, doc.getElementById('p'));
  assert.strictEqual(backs.n, 1, 'the swipe-back fires on plain content - every "no back" below is a real stand-down');
});

test('Dean\'s repro: a rightward scrub of the watch page #seek-bar never goes back', () => {
  const { doc, win, backs } = boot(shellBody('watch.html'));
  const seek = doc.getElementById('seek-bar');
  assert.ok(seek, 'the real watch shell has the seek bar');
  dragRight(win, seek);
  assert.strictEqual(backs.n, 0, 'scrubbing right is a seek, never a back');
  dragRight(win, doc.getElementById('vol-bar'));
  assert.strictEqual(backs.n, 0, 'the volume slider too');
  // and a plain page element on the SAME shell still goes back (not vacuous)
  const plain = doc.createElement('p'); (doc.querySelector('main') || doc.body).appendChild(plain);
  dragRight(win, plain);
  assert.strictEqual(backs.n, 1, 'content outside the player still goes back');
});

test('every shell: every range/slider stands down, and the player host itself does NOT (v1.311.3 scrubbers only)', () => {
  // QA r1 S7: the yt-dlp module's subscriptions shell is a real player shell too.
  const SUBS = path.join(__dirname, '../../lib/ytdlp/views');
  const shells = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html')).map((f) => path.join(PUBLIC, f))
    .concat(fs.existsSync(SUBS) ? fs.readdirSync(SUBS).filter((f) => f.endsWith('.html')).map((f) => path.join(SUBS, f)) : []);
  let ranges = 0;
  for (const full of shells) {
    const file = path.basename(full);
    const { doc, win } = boot(shellBody(full));
    doc.querySelectorAll('input[type="range"], [role="slider"]').forEach((el) => {
      ranges += 1;
      assert.ok(swipeBackStandDownReason(el, doc, win), `${file}: #${el.id || el.className} must stand the swipe-back down`);
    });
    // v1.311.3 (Dean, "scrubbers only"): the video surface is not a scrubber - a clear
    // rightward swipe on it goes back again. Only the sliders inside the host own it.
    const video = doc.getElementById('media-player');
    if (video) assert.strictEqual(swipeBackStandDownReason(video, doc, win), null, `${file}: the video itself is not an owner`);
    dom.window.close(); dom = null;
  }
  assert.ok(ranges >= 18, `the census actually walked the shells' sliders (saw ${ranges})`);
});

test('every music/podcast skin: its seek, wheel and sliders stand down even outside .mms-full', () => {
  const CTX = { track: { title: 'T', artist: 'A' }, upNext: [], fullList: [], posLabel: '0:00', remLabel: '-1:00', playing: true };
  let owners = 0;
  for (const id of skins.IDS) {
    const { doc, win, backs } = boot('<body><div id="panel"></div></body>');
    const panel = doc.getElementById('panel'); // deliberately NOT .mms-full - bind the inner selectors
    panel.innerHTML = skins.renderFull(id, CTX);
    panel.querySelectorAll('[data-skin-seek], [role="slider"], .ip-wheel, input[type="range"]').forEach((el) => {
      owners += 1;
      assert.strictEqual(swipeBackStandDownReason(el, doc, win), 'owner', `skin ${id}: ${el.className}`);
      dragRight(win, el);
    });
    assert.strictEqual(backs.n, 0, `skin ${id}: no scrub or spin goes back`);
    dom.window.close(); dom = null;
  }
  assert.ok(owners >= skins.IDS.length, `every skin drew at least one scrubber (saw ${owners})`);
});

test('a range/slider OUTSIDE any player (the wheel-calibration slider, a settings slider) stands down on its own selector', () => {
  const { doc, win, backs } = boot('<body><section><input type="range" id="r"><div role="slider" id="s" tabindex="0"></div></section></body>');
  assert.strictEqual(swipeBackStandDownReason(doc.getElementById('r'), doc, win), 'owner');
  assert.strictEqual(swipeBackStandDownReason(doc.getElementById('s'), doc, win), 'owner');
  dragRight(win, doc.getElementById('r'));
  dragRight(win, doc.getElementById('s'));
  assert.strictEqual(backs.n, 0, 'dragging a bare slider right is a slide, never a back');
});

test('the wheel-calibration spin stage owns its drag; a held body lock no longer blocks the back (v1.311.3: the escape)', () => {
  const BL = require('../../public/js/body-scroll-lock.js');
  const { doc, win, backs } = boot('<body><p id="p">x</p><div class="whcal-overlay"><div class="whcal-head" id="head">h</div><div class="whcal-stage"><div class="whcal-wheel" id="wh"></div></div></div></body>');
  win.FileTubeBodyLock = BL; // as the shells load it
  BL.lock(doc, win, 'wheel-cal');
  assert.strictEqual(swipeBackStandDownReason(doc.getElementById('wh'), doc, win), 'owner', 'the spin stage is named');
  dragRight(win, doc.getElementById('wh'));
  assert.strictEqual(backs.n, 0, 'spinning the calibration wheel right is a spin, never a back');
  dragRight(win, doc.getElementById('head'));
  assert.strictEqual(backs.n, 1, 'the rest of the overlay is not a scrubber - the back fires even with the lock held');
  dragRight(win, doc.getElementById('p'));
  assert.strictEqual(backs.n, 2, 'plain content under a held lock goes back (a stranded lock is never a trap)');
  BL.release(doc, win, 'wheel-cal');
});

test('the full-screen skin is NOT an owner, only its scrubbers are - haptic or not (v1.311.3)', () => {
  const CTX = { track: { title: 'T', artist: 'A' }, upNext: [], fullList: [], posLabel: '0:00', remLabel: '-1:00', playing: true };
  for (const haptic of [false, true]) {
    for (const id of skins.IDS) {
      // The REAL .mms-full page lock: touch-action:none on the shell (lifted to auto when
      // haptic), pan-y on its lists - read as the NET, both would re-own the whole skin.
      const { doc, win, backs } = boot('<body><div id="panel" class="music-nowplaying-panel mms mms-full' + (haptic ? ' mms-haptic' : '') + '"' +
        (haptic ? '' : ' style="touch-action:none"') + '></div></body>');
      const panel = doc.getElementById('panel');
      panel.innerHTML = skins.renderFull(id, CTX);
      panel.querySelectorAll('.mms-qlist, .ip-listview').forEach((el) => { el.style.touchAction = 'pan-y'; });
      const plain = doc.createElement('p'); panel.appendChild(plain);
      assert.strictEqual(swipeBackStandDownReason(plain, doc, win), null, `skin ${id} (haptic ${haptic}): a non-scrubber spot is not an owner`);
      dragRight(win, plain);
      assert.strictEqual(backs.n, 1, `skin ${id} (haptic ${haptic}): a swipe on the skin goes back - the way out of a stuck skin`);
      const list = panel.querySelector('.mms-qlist, .ip-listview');
      if (list) assert.strictEqual(swipeBackStandDownReason(list, doc, win), null, `skin ${id}: a pan-y list inside the skin is not a horizontal owner`);
      const seek = panel.querySelector('[data-skin-seek], .ip-wheel, [role="slider"]');
      assert.ok(seek, `skin ${id} draws a scrubber`);
      assert.strictEqual(swipeBackStandDownReason(seek, doc, win), 'owner', `skin ${id}: its scrubber still owns the drag`);
      dom.window.close(); dom = null;
    }
  }
  const { doc, win } = boot('<body><div class="ipod-brick"><canvas id="c"></canvas></div></body>');
  assert.strictEqual(swipeBackStandDownReason(doc.getElementById('c'), doc, win), 'owner', 'the Brick paddle is a scrubber');
});

test('the touch-action NET still works OUTSIDE the skin (an unlisted drag handle)', () => {
  const { doc, win, backs } = boot('<body><div style="touch-action:none"><span id="h">handle</span></div><div class="mms-full" style="touch-action:none"><span id="in">art</span></div></body>');
  dragRight(win, doc.getElementById('h'));
  assert.strictEqual(backs.n, 0, 'outside .mms-full the NET owns the drag');
  dragRight(win, doc.getElementById('in'));
  assert.strictEqual(backs.n, 1, 'inside .mms-full the same touch-action is the page lock - the back fires');
});

test('immersive views no longer swallow the back; their scrubbers still do (v1.311.3 scrubbers only)', () => {
  for (const cls of ['ft-css-fullscreen', 'ft-audio-expanded']) {
    const { doc, win, backs } = boot(shellBody('watch.html'));
    doc.body.classList.add(cls);
    dragRight(win, doc.getElementById('seek-bar'));
    assert.strictEqual(backs.n, 0, `${cls}: scrubbing the seek bar is still a seek`);
    dragRight(win, doc.getElementById('media-player'));
    assert.strictEqual(backs.n, 1, `${cls}: a swipe on the video goes back`);
    dom.window.close(); dom = null;
  }
});

test('the touch-action NET: an unlisted element that took horizontal panning stands down', () => {
  const { doc, win, backs } = boot('<body><div id="none" style="touch-action:none"><span id="a">x</span></div><div id="py" style="touch-action:pan-y"><span id="b">x</span></div><div id="both" style="touch-action:pan-x pan-y"><span id="c">x</span></div></body>');
  dragRight(win, doc.getElementById('a'));
  dragRight(win, doc.getElementById('b'));
  assert.strictEqual(backs.n, 0, 'touch-action none / pan-y own the sideways drag');
  dragRight(win, doc.getElementById('c'));
  assert.strictEqual(backs.n, 1, 'pan-x pan-y leaves horizontal to the browser - still a back');
  assert.strictEqual(touchActionOwnsHorizontal('none'), true);
  assert.strictEqual(touchActionOwnsHorizontal('pan-y pinch-zoom'), true);
  assert.strictEqual(touchActionOwnsHorizontal('pan-x'), false);
  assert.strictEqual(touchActionOwnsHorizontal('manipulation'), false);
  assert.strictEqual(touchActionOwnsHorizontal('auto'), false);
  assert.strictEqual(touchActionOwnsHorizontal(''), false);
});

test('census: every JS-built slider in public/js is a range input or role=slider (so the generic owners cover it)', () => {
  const dir = path.join(PUBLIC, 'js');
  const hits = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /type\s*=\s*["']range["']|\.type\s*=\s*'range'|role\s*=\s*\\?["']slider/g;
    while (re.exec(src)) hits.push(f);
  }
  assert.ok(hits.includes('common.js') && hits.includes('setup.js') && hits.includes('music-skins.js'), `the known JS sliders were found (${hits.join(', ')})`);
  assert.ok(SWIPE_BACK_OWNER_SELECTORS.includes('input[type="range"]') && SWIPE_BACK_OWNER_SELECTORS.includes('[role="slider"]'),
    'the owner list covers every range input and ARIA slider generically');
});
