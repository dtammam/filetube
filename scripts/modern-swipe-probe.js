#!/usr/bin/env node
'use strict';
/* global document, window, requestAnimationFrame, cancelAnimationFrame, PointerEvent, getComputedStyle */
// v1.403.0 swipe to Trash on Modern home (plan 2026-11-05-modern-swipe-trash): the real-browser proof of the plan's W3.
// It boots the real server on a scratch library (real files, real ids, a podcast episode), opens Modern home and drives
// the swipe the way a finger or a mouse does, checking the SERVER's record after every destructive step:
//
//   node scripts/modern-swipe-probe.js [chromium|webkit|both] [--shots <dir>]
//
// Per engine at 390x844 (touch), 820x1180 (touch) and 1440x900 (mouse). Chromium's touch is real input (CDP
// Input.dispatchTouchEvent: real touch-action, real scrolling, real pointercancel). Playwright has no touch input for
// WebKit, so WebKit's "touch" is synthetic pointer + touch events on the real listeners (no touch-action, no scrolling
// there: iOS itself is DEVICE-CHECKS (d)); its 1440 mouse is real. Each line says which it used.
// Not a CI gate: a proof tool. One line per case, a PASS/FAIL summary, exit 1 on any failure.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const ENGINE_ARG = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'both';
const ENGINES = ENGINE_ARG === 'both' ? ['chromium', 'webkit'] : [ENGINE_ARG];
const ONE_SIZE = process.argv.includes('--size-390-only'); // a quick re-run of the gesture cases while building
const SHOTS = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-swipe-'));

const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));

const SIZES = [
  { name: '390x844', viewport: { width: 390, height: 844 }, input: 'touch' },
  { name: '820x1180', viewport: { width: 820, height: 1180 }, input: 'touch' },
  { name: '1440x900', viewport: { width: 1440, height: 900 }, input: 'mouse' },
];
const MEDIA_COUNT = 90; // more than one page (60), so the append path is real
let fail = 0;
let passes = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function report(ok, line) {
  if (ok) passes += 1; else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${line}`);
}

// ---- the server ------------------------------------------------------------
async function boot() {
  const server = require(path.join(REPO, 'server.js'));
  const lib = path.join(process.env.DATA_DIR, 'library');
  const clips = path.join(lib, 'clips');
  fs.mkdirSync(clips, { recursive: true });
  const metadata = {};
  for (let i = 1; i <= MEDIA_COUNT; i++) {
    const fp = path.join(clips, `clip-${i}.mp4`);
    fs.writeFileSync(fp, `probe bytes ${i}`);
    const id = server.getMediaId(fp); // the REAL id (a hash of the path): Undo's id check depends on it
    metadata[id] = { id, type: 'video', title: `Swipe probe ${i}`, name: `clip-${i}.mp4`, filePath: fp, rootFolder: lib, folderName: 'clips',
      channelName: 'Probe', duration: 20, width: 640, height: 360, hasThumbnail: false, ext: '.mp4', addedAt: 1788000000000 - i * 1000, size: 1024 * i };
  }
  const { seedState } = require(path.join(REPO, 'test', 'helpers', 'seed-state'));
  seedState({ folders: [lib], folderSettings: {}, metadata, liked: [], settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null } });
  // a downloaded podcast episode, under the real podcasts root, with the newest date so it is on the first page
  const showDir = path.join(process.env.DATA_DIR, 'podcasts', 'Show');
  fs.mkdirSync(showDir, { recursive: true });
  const epPath = path.join(showDir, 'ep.mp3');
  fs.writeFileSync(epPath, 'episode bytes');
  await server.updateDatabase(() => server.podcastsDb.mutate((h) => {
    h.podcasts.subscriptions = [{ id: 's1', feedUrl: 'http://127.0.0.1:9/feed', name: 'Probe show', addedAt: 1 }];
    h.podcasts.episodes.ep1 = { id: 'ep1', subId: 's1', guid: 'g1', status: 'downloaded', title: 'Probe episode', filePath: epPath,
      duration: 60, addedAt: 1788000005000, size: 13 };
    return true;
  }));
  const listening = await new Promise((resolve) => { const s = server.app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, listening, base: `http://127.0.0.1:${listening.address().port}`, cookie: server.__mintTestSession().cookie };
}
function serverIds(env) {
  const ids = new Set(Object.keys(env.server.loadDatabase().metadata || {}));
  const eps = env.server.podcastsDb.read().episodes;
  for (const k of Object.keys(eps)) if (eps[k].status === 'downloaded') ids.add(k);
  return ids;
}
const diff = (a, b) => [...a].filter((x) => !b.has(x));

// ---- the page --------------------------------------------------------------
async function open(env, engine, size, opts = {}) {
  const browser = await pw[engine].launch();
  const ctx = await browser.newContext({ viewport: size.viewport, deviceScaleFactor: 1, hasTouch: size.input === 'touch', reducedMotion: opts.reducedMotion || 'no-preference' });
  await ctx.addCookies([{ name: env.cookie.split('=')[0], value: env.cookie.split('=')[1].split(';')[0], url: env.base }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('ft-modern-mode', 'on'); } catch (_) { /* first paint */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (opts.noSwipe) {
    await page.route('**/js/interaction.js*', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()) + '\n;window.FTInteraction.swipeRow = undefined;' });
    });
  }
  await page.goto(env.base + '/');
  await page.waitForFunction(() => document.querySelectorAll('#video-grid .video-card[data-id]').length > 0, null, { timeout: 30000 });
  const cdp = engine === 'chromium' ? await ctx.newCDPSession(page) : null;
  return { browser, ctx, page, cdp, errors, engine, size };
}

// One drag from (x0, y0) through the points. A CDP touch in Chromium, a real mouse where the size says mouse, synthetic
// pointer + touch events otherwise (WebKit's touch; see the header).
async function finger(r, x0, y0, pts, opts = {}) {
  const { page, cdp, size } = r;
  const stepMs = opts.stepMs === undefined ? 12 : opts.stepMs;
  if (size.input === 'mouse') {
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (const [x, y] of pts) { await page.mouse.move(x, y); await sleep(stepMs); }
    if (opts.mid) await opts.mid();
    await page.mouse.up();
    return;
  }
  if (cdp) {
    const tp = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(x0, y0) });
    for (const [x, y] of pts) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x, y) }); await sleep(stepMs); }
    if (opts.mid) await opts.mid();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await page.evaluate(([sx, sy, list]) => {
    const target = document.elementFromPoint(sx, sy);
    const pe = (type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 5, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y }));
    const te = (type, x, y) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y, target }] }); target.dispatchEvent(e); };
    te('touchstart', sx, sy); pe('pointerdown', sx, sy);
    let lx = sx; let ly = sy;
    for (const [x, y] of list) { te('touchmove', x, y); pe('pointermove', x, y); lx = x; ly = y; }
    te('touchend', lx, ly); pe('pointerup', lx, ly);
  }, [x0, y0, pts]);
  if (opts.mid) await opts.mid();
}

// Scrolls the nth card into view and returns its box and id.
async function cardAt(r, n) {
  return r.page.evaluate((i) => {
    const cards = document.querySelectorAll('#video-grid .video-card[data-id]');
    const c = cards[i];
    c.scrollIntoView({ block: 'center' });
    const b = c.getBoundingClientRect();
    return { id: c.getAttribute('data-id'), x: b.x, y: b.y, w: b.width, h: b.height, index: i };
  }, n);
}
function leftPath(card, dist, dy = 0) {
  const x0 = card.x + card.w - 12; const y0 = card.y + card.h * 0.4;
  const pts = [];
  for (let k = 1; k <= 14; k++) pts.push([x0 - dist * k / 14, y0 + dy * k / 14]);
  return { x0, y0, pts };
}
async function swipeLeft(r, card, dist, opts) {
  const p = leftPath(card, dist);
  await finger(r, p.x0, p.y0, p.pts, opts);
}
const metrics = (r, n) => r.page.evaluate((i) => {
  const c = document.querySelectorAll('#video-grid .video-card[data-id]')[i];
  const wrap = c.parentNode;
  const act = wrap.querySelector('.ui-swipe__actions');
  const btns = Array.from(act.querySelectorAll('button'));
  return {
    rowW: wrap.getBoundingClientRect().width,
    actionsW: act.scrollWidth || act.getBoundingClientRect().width,
    labels: btns.map((b) => b.getAttribute('data-label')),
    btnW: btns.map((b) => Math.round(b.getBoundingClientRect().width)),
  };
}, n);
const fullDist = (m) => Math.max(0.6 * m.rowW, m.actionsW);
const gridOrder = (r) => r.page.evaluate(() => Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).map((c) => c.getAttribute('data-id')));
const emptyCells = (r) => r.page.evaluate(() => Array.from(document.querySelectorAll('#video-grid > .ui-swipe')).filter((w) => !w.querySelector('.video-card')).length);
const toastText = (r) => r.page.evaluate(() => Array.from(document.querySelectorAll('.ui-toast')).map((t) => t.textContent).join(' | '));
async function waitToast(r, re, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const t = await toastText(r); if (re.test(t)) return t; await sleep(40); }
  return await toastText(r);
}
async function waitGone(r, id, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (!(await gridOrder(r)).includes(id)) return true; await sleep(40); }
  return false;
}
async function clickUndo(r) {
  await r.page.evaluate(() => { const b = document.querySelector('.ui-toast__action'); if (b) b.click(); });
}
async function waitBack(r, id, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if ((await gridOrder(r)).includes(id)) return true; await sleep(40); }
  return false;
}
async function closeRows(r) { await r.page.evaluate(() => document.querySelector('#view-root').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await sleep(450); }
async function tapButton(r, card, id) {
  // a real press on the revealed button at its screen position (the swipeRow guard needs the press to start on it)
  const box = await r.page.evaluate(([cid, a]) => {
    const c = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((x) => x.getAttribute('data-id') === cid);
    const b = c.parentNode.querySelector(`[data-action="${a}"]`);
    const q = b.getBoundingClientRect();
    return { x: q.x + q.width / 2, y: q.y + q.height / 2, w: q.width };
  }, [card.id, id]);
  if (r.size.input === 'mouse') { await r.page.mouse.click(box.x, box.y); return; }
  if (r.cdp) { await r.page.touchscreen.tap(box.x, box.y); return; }
  await r.page.evaluate(([cid, a, x, y]) => {
    const c = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === cid);
    const b = c.parentNode.querySelector(`[data-action="${a}"]`);
    const o = { bubbles: true, cancelable: true, pointerId: 6, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y };
    b.dispatchEvent(new PointerEvent('pointerdown', o)); b.dispatchEvent(new PointerEvent('pointerup', o));
    b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  }, [card.id, id, box.x, box.y]);
}
async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(40); }
  return false;
}

// ---- the cases -------------------------------------------------------------
async function runSize(env, engine, size, slot) {
  const tag = `${engine} ${size.name} (${size.input === 'mouse' ? 'real mouse' : (engine === 'chromium' ? 'real touch' : 'synthetic touch')})`;
  const r = await open(env, engine, size);
  const { page } = r;
  let k = 3 + slot * 8 + (engine === 'webkit' ? 24 : 0);   // each size and engine works on its own cards

  // the widths
  const m = await metrics(r, k);
  const pct = (v) => (100 * v / m.rowW).toFixed(1);
  const atFull = fullDist(m);
  const widthOk = size.name !== '390x844' || 100 * atFull / m.rowW <= 65;
  report(widthOk && m.actionsW < m.rowW, `${tag} width: card ${m.rowW.toFixed(0)} px, actions ${m.actionsW} px (${pct(m.actionsW)}%), full swipe at ${atFull.toFixed(0)} px (${pct(atFull)}%), buttons ${JSON.stringify(m.btnW)} ${JSON.stringify(m.labels)}`);
  const clipped = await page.evaluate(() => {
    // a label never overflows its button (the longest menu label included)
    const w = document.querySelector('#video-grid > .ui-swipe');
    const a = w.querySelector('[data-action="watchlater"]');
    const label = a.querySelector('.ui-swipe__label');
    const was = label.textContent;
    label.textContent = 'Remove from Watch later';
    w.classList.add('is-open');
    const q = { sw: a.scrollWidth, cw: a.clientWidth, sh: a.scrollHeight, ch: a.clientHeight };
    label.textContent = was;
    w.classList.remove('is-open');
    return q;
  });
  report(clipped.sw <= clipped.cw + 1 && clipped.sh <= clipped.ch + 1, `${tag} the longest label fits its button: scroll ${clipped.sw}x${clipped.sh} in client ${clipped.cw}x${clipped.ch}`);

  // a full swipe trashes exactly that card; Undo puts it back in place
  {
    const before = serverIds(env);
    const order0 = await gridOrder(r);
    const card = await cardAt(r, k);
    const beforeCount = order0.length;
    await swipeLeft(r, card, atFull + 8);
    const gone = await waitGone(r, card.id);
    const toast = await waitToast(r, /Moved to Trash/);
    const after = serverIds(env);
    const lost = diff(before, after);
    const empties = await emptyCells(r);
    report(gone && lost.length === 1 && lost[0] === card.id && after.size === before.size - 1 && empties === 0 && /Moved to Trash/.test(toast) && /Undo/.test(toast),
      `${tag} full swipe: card ${k} left, server lost exactly [that id] (${lost.length} of ${before.size}), ${beforeCount} -> ${(await gridOrder(r)).length} cards, empty cells ${empties}, toast "${toast}"`);
    if (size.name === '390x844' && SHOTS) await page.screenshot({ path: path.join(SHOTS, `${engine}-trashed-toast.png`) });
    await clickUndo(r);
    const back = await waitBack(r, card.id);
    await sleep(100);
    const order1 = await gridOrder(r);
    const restored = serverIds(env);
    report(back && order1.join() === order0.join() && restored.size === before.size && restored.has(card.id),
      `${tag} Undo: the same id is back at index ${order1.indexOf(card.id)} (was ${k}), the grid order equals the order before (${order1.length} cards), server has it again`);
  }

  // a vertical scroll with sideways drift trashes nothing
  {
    const before = serverIds(env);
    const y0Scroll = await page.evaluate(() => window.scrollY);
    const c = await cardAt(r, k + 1);
    const startY = Math.min(c.y + c.h * 0.8, size.viewport.height - 40);
    const x0 = c.x + c.w * 0.6;
    const drift = [[-20, -60], [-20, -120], [20, -180], [-20, -300], [-20, -400]];
    await finger(r, x0, startY, drift.map(([dx, dy], i) => { void i; return [x0 + dx, Math.max(20, startY + dy)]; }), { stepMs: 16 });
    // and a drift that starts sideways before the finger goes vertical
    const c2 = await cardAt(r, k + 1);
    const sy = Math.min(c2.y + c2.h * 0.8, size.viewport.height - 40);
    const x1 = c2.x + c2.w * 0.6;
    await finger(r, x1, sy, [[x1 - 9, sy - 2], [x1 - 14, sy - 40], [x1 - 18, sy - 120], [x1 - 20, sy - 300]], { stepMs: 16 });
    await sleep(450);
    const after = serverIds(env);
    const moved = await page.evaluate(() => window.scrollY);
    report(after.size === before.size, `${tag} a scroll with ~20 px of drift: server lost ${before.size - after.size}, scrollY ${y0Scroll.toFixed(0)} -> ${moved.toFixed(0)}`);
    await closeRows(r);
  }

  // a short swipe reveals the buttons; each does what its menu twin does
  k += 2;
  {
    const c = await cardAt(r, k);
    await swipeLeft(r, c, m.actionsW * 0.7);
    await sleep(450);
    const open1 = await page.evaluate((id) => { const x = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === id); return x.parentNode.classList.contains('is-open'); }, c.id);
    report(open1 && serverIds(env).has(c.id), `${tag} short swipe: the row opened, nothing ran`);
    if (size.name === '390x844' && SHOTS) await page.screenshot({ path: path.join(SHOTS, `${engine}-open.png`) });
    // Like
    await tapButton(r, await rectOnly(r, c.id), 'like');
    const liked = await waitFor(async () => (await apiJson(r, env, '/api/liked')).includes(c.id));
    const likeToast = await waitToast(r, /Added to Liked/);
    report(liked && /Added to Liked/.test(likeToast), `${tag} Like: the server has it liked, toast "${likeToast}"`);
    // Unlike on the next reveal
    await sleep(450);
    const c2 = await cardAt(r, k);
    await swipeLeft(r, c2, m.actionsW * 0.7);
    await sleep(450);
    const label = await page.evaluate((id) => { const x = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === id); return x.parentNode.querySelector('[data-action="like"]').getAttribute('data-label'); }, c.id);
    report(label === 'Unlike', `${tag} the Like button reads "${label}" on the next reveal`);
    // Watch later
    await tapButton(r, await rectOnly(r, c.id), 'watchlater');
    const later = await waitFor(async () => (await apiJson(r, env, '/api/watch-later')).includes(c.id));
    report(later, `${tag} Watch later: the server has it on the list`);
    await sleep(450);
  }
  // Hide from feed (its own card, with its own Undo)
  k += 1;
  {
    const c = await cardAt(r, k);
    await swipeLeft(r, c, m.actionsW * 0.7);
    await sleep(450);
    const order0 = await gridOrder(r);
    await tapButton(r, await rectOnly(r, c.id), 'feedhide');
    const gone = await waitGone(r, c.id);
    const t = await waitToast(r, /Hidden from feed/);
    const empties = await emptyCells(r);
    report(gone && /Hidden from feed/.test(t) && empties === 0, `${tag} Hide from feed: the card left, toast "${t}", empty cells ${empties}`);
    await clickUndo(r);
    const back = await waitBack(r, c.id);
    await sleep(100);
    const order1 = await gridOrder(r);
    const wrapped = await page.evaluate((id) => { const x = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === id); return !!(x && x.parentNode.classList.contains('ui-swipe')); }, c.id);
    report(back && order1.join() === order0.join() && wrapped, `${tag} Hide's Undo: back in place, and it swipes again (wrapped ${wrapped})`);
  }
  // The revealed Trash button: no question, same Undo
  k += 1;
  {
    const before = serverIds(env);
    const c = await cardAt(r, k);
    await swipeLeft(r, c, m.actionsW * 0.7);
    await sleep(450);
    const order0 = await gridOrder(r);
    await tapButton(r, await rectOnly(r, c.id), 'delete');
    const gone = await waitGone(r, c.id);
    const dialog = await page.evaluate(() => !!document.querySelector('.ui-sheet.is-open'));
    const after = serverIds(env);
    const lost = diff(before, after);
    report(gone && !dialog && lost.length === 1 && lost[0] === c.id, `${tag} the Trash button: no confirm (dialog ${dialog}), server lost exactly that id`);
    await waitToast(r, /Moved to Trash/);
    await clickUndo(r);
    await waitBack(r, c.id);
    await sleep(100);
    report((await gridOrder(r)).join() === order0.join(), `${tag} its Undo: back in place`);
  }

  // A podcast episode's card: the same
  {
    const before = serverIds(env);
    const idx = (await gridOrder(r)).indexOf('ep1');
    const c = await cardAt(r, idx);
    const pm = await metrics(r, idx);
    const hasHide = pm.labels.includes('Hide from feed');
    const order0 = await gridOrder(r);
    await swipeLeft(r, c, fullDist(pm) + 8);
    const gone = await waitGone(r, 'ep1');
    await waitToast(r, /Moved to Trash/);
    const lost = diff(before, serverIds(env));
    const status = env.server.podcastsDb.read().episodes.ep1.status;
    report(idx >= 0 && gone && lost.length === 1 && lost[0] === 'ep1' && status === 'trashed', `${tag} a podcast episode: full swipe trashed it (status ${status}), labels ${JSON.stringify(pm.labels)}, Hide offered ${hasHide}`);
    await clickUndo(r);
    await waitBack(r, 'ep1');
    await sleep(100);
    const st2 = env.server.podcastsDb.read().episodes.ep1.status;
    report((await gridOrder(r)).join() === order0.join() && st2 === 'downloaded', `${tag} its Undo: status ${st2}, back in place`);
  }

  // Select mode disables it; leaving select mode restores it
  k += 1;
  {
    const before = serverIds(env);
    const c = await cardAt(r, k);
    await page.evaluate(() => { const b = document.querySelector('.modern-select .ui-btn') || document.querySelector('#select-btn'); b.click(); });
    await sleep(80);
    const c1 = await rectOnly(r, c.id);
    await swipeLeft(r, c1, fullDist(m) + 8);
    await sleep(450);
    const lost = before.size - serverIds(env).size;
    const stateNow = await page.evaluate((id) => { const x = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === id); return { open: x.parentNode.classList.contains('is-open'), offset: x.parentNode.style.getPropertyValue('--swipe-x') }; }, c.id);
    report(lost === 0 && !stateNow.open, `${tag} select mode: a full swipe did nothing (server lost ${lost}, open ${stateNow.open}, offset "${stateNow.offset}")`);
    await page.evaluate(() => { const b = document.querySelector('.select-bar__cancel'); b.click(); });
    await sleep(80);
    const c2 = await rectOnly(r, c.id);
    await swipeLeft(r, c2, m.actionsW * 0.7);
    await sleep(450);
    const reopened = await page.evaluate((id) => { const x = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === id); return x.parentNode.classList.contains('is-open'); }, c.id);
    report(reopened, `${tag} leaving select mode restores it (the row opened)`);
    await closeRows(r);
  }

  // Dragging an open card back to the right closes it and does not go Back
  k += 1;
  {
    // The router stamps every bare Home at depth 0 (the top of the walk), where the swipe-back has nothing to pop, so
    // a Back from Home is out of reach today. To make "no Back" mean something, this entry is stamped depth 1 with a
    // real page behind it: a drag that reached the swipe-back WOULD leave (the CONTROL below proves it does).
    const go = (href) => page.evaluate((h) => { const a = document.createElement('a'); a.href = h; document.body.appendChild(a); a.click(); a.remove(); }, href);
    await page.goto(env.base + '/history');
    await page.waitForFunction(() => document.body.getAttribute('data-view') === 'history');
    await go('/');
    await page.waitForFunction(() => document.body.getAttribute('data-view') === 'home' && document.querySelector('#video-grid .video-card[data-id]'));
    await sleep(200);
    await page.evaluate(() => window.history.replaceState(Object.assign({}, window.history.state, { depth: 1 }), ''));
    const urlBefore = page.url();
    const depthAtHome = await page.evaluate(() => window.history.state && window.history.state.depth);
    if (!(depthAtHome > 0)) report(false, `${tag} the swipe-back case has no history to pop (depth ${depthAtHome}): the check below would be vacuous`);
    const c = await cardAt(r, k);
    await swipeLeft(r, c, m.actionsW * 0.7);
    await sleep(450);
    const c1 = await rectOnly(r, c.id);
    const x0 = c1.x + c1.w * 0.15 + (m.actionsW * -0.1); const y0 = c1.y + c1.h * 0.4;
    const start = Math.max(c1.x + c.w - m.actionsW - 30, 16);
    void x0;
    const pts = [];
    for (let i = 1; i <= 12; i++) pts.push([start + i * 15, y0]);
    await finger(r, start, y0, pts);
    await sleep(450);
    const st = await page.evaluate((id) => { const x = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === id); return { open: x.parentNode.classList.contains('is-open'), view: document.body.getAttribute('data-view') }; }, c.id);
    report(!st.open && st.view === 'home' && page.url() === urlBefore, `${tag} dragging an open card right: closed (open ${st.open}), still on ${st.view} (${page.url() === urlBefore ? 'same URL' : page.url()})`);
    if (size.input === 'touch') {
      // the CONTROL: the same drag on something that is not a card still goes Back, so the line above is a real stand-down
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(450);
      const hx = await page.evaluate(() => {
        // the page header: plain chrome, no card, no horizontal owner
        const h = document.querySelector('header').getBoundingClientRect();
        const y = h.y + h.height / 2;
        const el = document.elementFromPoint(40, y);
        return { y, depth: window.history.state && window.history.state.depth, el: el ? el.tagName : null };
      });
      await finger(r, 40, hx.y, Array.from({ length: 12 }, (_, i) => [40 + (i + 1) * 15, hx.y]));
      const left = await waitFor(() => page.evaluate(() => document.body.getAttribute('data-view') !== 'home'), 3000);
      report(left, `${tag} CONTROL: the same drag beside the grid (on ${hx.el}, depth ${hx.depth}) goes Back (left Home: ${left})`);
      if (left) { await go('/'); await page.waitForFunction(() => document.body.getAttribute('data-view') === 'home' && document.querySelector('#video-grid .video-card[data-id]')); await sleep(200); }
    }
  }

  // The kebab menu's Move to Trash still asks; a tap on a card still navigates
  k += 1;
  {
    const before = serverIds(env);
    const c = await cardAt(r, k);
    await page.evaluate((id) => { const x = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === id); x.querySelector('.card-kebab').click(); }, c.id);
    await page.waitForSelector('.ui-sheet.is-open');
    const offWhileMenu = await rectOnly(r, c.id);
    await swipeLeftOnGrid(r, offWhileMenu, fullDist(m) + 8);
    const lostWhileMenu = before.size - serverIds(env).size;
    const asked = await page.evaluate(async () => {
      const row = Array.from(document.querySelectorAll('.ui-sheet.is-open button, .ui-sheet.is-open [role="menuitem"]')).find((b) => /Move to Trash/.test(b.textContent));
      if (!row) return 'no menu row';
      await new Promise((res) => setTimeout(res, 500));
      row.click();
      await new Promise((res) => setTimeout(res, 300));
      const t = document.querySelector('.ui-sheet.is-open .ui-confirm__actions');
      return t ? 'asked' : 'no confirm';
    });
    await sleep(100);
    report(asked === 'asked' && lostWhileMenu === 0 && before.size === serverIds(env).size, `${tag} the card menu's Move to Trash: ${asked}, a swipe under the open menu lost ${lostWhileMenu}`);
    await page.keyboard.press('Escape');
    await sleep(400);
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.ui-sheet.is-open button')).find((x) => /Cancel/.test(x.textContent)); if (b) b.click(); });
    await sleep(300);
  }

  report(r.errors.length === 0, `${tag} no page errors${r.errors.length ? ': ' + r.errors.join(' / ') : ''}`);
  await r.browser.close();
}
async function swipeLeftOnGrid(r, card, dist) {
  // synthetic on purpose: the scrim swallows a real press, this asks the helper's own guard (enabled)
  await r.page.evaluate(([id, d]) => {
    const c = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === id);
    const b = c.getBoundingClientRect();
    const x = b.x + b.width - 12; const y = b.y + b.height * 0.4;
    const o = (cx) => ({ bubbles: true, cancelable: true, pointerId: 31, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: cx, clientY: y });
    c.dispatchEvent(new PointerEvent('pointerdown', o(x)));
    for (let k = 1; k <= 8; k++) c.dispatchEvent(new PointerEvent('pointermove', o(x - d * k / 8)));
    c.dispatchEvent(new PointerEvent('pointerup', o(x - d)));
  }, [card.id, dist]);
  await sleep(200);
}
async function rectOnly(r, id) {
  return r.page.evaluate((cid) => {
    const c = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((x) => x.getAttribute('data-id') === cid);
    const wrap = c.parentNode.getBoundingClientRect();
    return { id: cid, x: wrap.x, y: wrap.y, w: wrap.width, h: wrap.height };
  }, id);
}
async function apiJson(r, env, url) {
  const res = await r.ctx.request.get(env.base + url);
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.items || body.liked || body.ids || []);
  return list.map((x) => (x && typeof x === 'object' ? String(x.id) : String(x)));
}

// The paths that can only be reached by holding a request, or that need a second page.
// Every width the layout passes through: the actions fit, and the full swipe is reachable and stays an easy swipe.
async function runWidths(env, engine) {
  for (const width of [320, 360, 390, 430, 480, 481, 600, 768, 820, 1024, 1180, 1199, 1200, 1280, 1440, 1500, 1920]) {
    const size = { name: `${width}`, viewport: { width, height: 900 }, input: 'mouse' };
    const r = await open(env, engine, size);
    const m = await metrics(r, 2);
    const f = fullDist(m);
    const p = 100 * f / m.rowW;
    report(f < m.rowW && p <= 70, `${engine} width ${width}: card ${m.rowW.toFixed(0)} px, actions ${m.actionsW} px, full swipe at ${f.toFixed(0)} px (${p.toFixed(1)}%), buttons ${JSON.stringify(m.btnW)}`);
    await r.browser.close();
  }
}

async function runEdges(env, engine) {
  const size = SIZES[0];
  const tag = `${engine} 390x844 edges`;
  {
    const r = await open(env, engine, size);
    const m = await metrics(r, 4);
    // a refused Trash: the card comes back, today's message
    await r.page.route('**/api/videos/*', (route) => (route.request().method() === 'DELETE' ? route.fulfill({ status: 409, contentType: 'application/json', body: '{"readOnly":true}' }) : route.continue()));
    const before = serverIds(env);
    const order0 = await gridOrder(r);
    const c = await cardAt(r, 4);
    await swipeLeft(r, c, fullDist(m) + 8);
    const t = await waitToast(r, /read-only/);
    await sleep(400);
    const st = await r.page.evaluate((id) => { const x = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === id); const w = x.parentNode; return { cls: w.className, shown: w.getBoundingClientRect().height > 0 }; }, c.id);
    report(/read-only/.test(t) && st.shown && !/is-leaving|is-gone/.test(st.cls) && (await gridOrder(r)).join() === order0.join() && serverIds(env).size === before.size, `${tag} a refused Trash (409): toast "${t}", the card is back and visible (${st.cls})`);
    await r.page.unroute('**/api/videos/*');
    // a failed restore says so and points at Settings > Trash
    const c2 = await cardAt(r, 4);
    await r.page.route('**/api/trash/*/restore', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
    await swipeLeft(r, c2, fullDist(m) + 8);
    await waitGone(r, c2.id);
    await waitToast(r, /Moved to Trash/);
    await clickUndo(r);
    const t2 = await waitToast(r, /Could not restore/);
    report(/Settings > Trash/.test(t2) && !(await gridOrder(r)).includes(c2.id), `${tag} a failed restore: toast "${t2}", the card stays out`);
    await r.page.unroute('**/api/trash/*/restore');
    // put it back through the real route so later cases see the full library
    const list = await (await r.ctx.request.get(env.base + '/api/trash')).json();
    const rec = (list.items || list).find((x) => x && (x.originalId === c2.id || x.id === c2.id || String(x.originalPath || '').length > 0));
    if (rec) await r.ctx.request.post(env.base + '/api/trash/' + encodeURIComponent(rec.trashId || rec.id) + '/restore');
    await r.browser.close();
  }
  {
    const r = await open(env, engine, size);
    // Two trashes in a row: only the newest offers Undo, and it restores THAT one
    const m = await metrics(r, 6);
    const a = await cardAt(r, 6);
    await swipeLeft(r, a, fullDist(m) + 8);
    await waitGone(r, a.id);
    await waitToast(r, /Moved to Trash/);
    const b = await cardAt(r, 6);
    await swipeLeft(r, b, fullDist(m) + 8);
    await waitGone(r, b.id);
    await sleep(700);
    const n = await r.page.evaluate(() => document.querySelectorAll('.ui-toast__action').length);
    await clickUndo(r);
    const backB = await waitBack(r, b.id);
    await sleep(100);
    const live = serverIds(env);
    report(n === 1 && backB && live.has(b.id) && !live.has(a.id), `${tag} two trashes in a row: ${n} Undo on screen, it restored the second (the first stays in Trash: ${!live.has(a.id)})`);
    const list = await (await r.ctx.request.get(env.base + '/api/trash')).json();
    for (const rec of (list.items || list)) await r.ctx.request.post(env.base + '/api/trash/' + encodeURIComponent(rec.trashId || rec.id) + '/restore');
    await r.browser.close();
  }
  {
    // the wrong card after an append: a card from page 2 trashes THAT card; the grid's bookkeeping loses nothing
    const r = await open(env, engine, size);
    await r.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await waitFor(async () => (await gridOrder(r)).length > 60, 15000);
    const order = await gridOrder(r);
    const m = await metrics(r, order.length - 2);
    const before = serverIds(env);
    const c = await cardAt(r, order.length - 2);
    await swipeLeft(r, c, fullDist(m) + 8);
    await waitGone(r, c.id);
    const lost = diff(before, serverIds(env));
    report(order.length > 60 && lost.length === 1 && lost[0] === c.id, `${tag} after an append (${order.length} cards): a page-2 card trashed exactly that id`);
    await waitToast(r, /Moved to Trash/);
    await clickUndo(r);
    await waitBack(r, c.id);
    // a re-sort, then a trash, then Undo: a card never comes back into a different list
    const sortBefore = await gridOrder(r);
    const c3 = await cardAt(r, 2);
    await swipeLeft(r, c3, fullDist(m) + 8);
    await waitGone(r, c3.id);
    await waitToast(r, /Moved to Trash/);
    await r.page.evaluate(() => { const chips = Array.from(document.querySelectorAll('.modern-chip-row button, .modern-chip-row [role="button"], .modern-chip-row .ui-chip')); const b = chips.find((x) => /Audio/.test(x.textContent)); if (b) b.click(); });
    await sleep(700);
    await clickUndo(r);
    const t = await waitToast(r, /Restored/);
    const inAudio = (await gridOrder(r)).includes(c3.id);
    report(/Restored/.test(t) && !inAudio && serverIds(env).has(c3.id), `${tag} Undo after a chip change: the file is back (server ${serverIds(env).has(c3.id)}), the video card stayed out of Audio (${!inAudio}), toast "${t}"`);
    void sortBefore;
    await r.page.evaluate(() => { try { localStorage.setItem('filetube_modern_chip', 'all'); } catch (_) { /* scratch */ } });
    await r.browser.close();
  }
  {
    // Reduce Motion: leaves with no slide, the swipe itself still tracks
    const r = await open(env, engine, size, { reducedMotion: 'reduce' });
    const m = await metrics(r, 7);
    let release = null;
    const held = new Promise((res) => { release = res; });
    await r.page.route('**/api/videos/*', async (route) => { if (route.request().method() === 'DELETE') await held; route.continue(); });
    const c = await cardAt(r, 7);
    await swipeLeft(r, c, fullDist(m) + 8);
    await sleep(60);
    const st = await r.page.evaluate((id) => { const x = Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).find((n) => n.getAttribute('data-id') === id); const w = x.parentNode; return { gone: w.classList.contains('is-gone'), h: w.getBoundingClientRect().height, trans: getComputedStyle(x).transitionDuration }; }, c.id);
    release();
    await waitGone(r, c.id);
    await waitToast(r, /Moved to Trash/);
    await clickUndo(r);
    await waitBack(r, c.id);
    report(st.gone && st.h === 0 && /^0s/.test(st.trans), `${tag} Reduce Motion: out of the grid at once while the request is held (is-gone ${st.gone}, height ${st.h}, transition ${st.trans})`);
    await r.browser.close();
  }
}

// At rest the wrapper must not change a pixel: the same page with and without swipeRow.
async function runRest(env, engine) {
  for (const size of SIZES) {
    const shots = [];
    const rects = [];
    for (const noSwipe of [true, false]) {
      const r = await open(env, engine, size, { noSwipe });
      await r.page.evaluate(() => window.scrollTo(0, 0));
      await sleep(600);
      const wrapped = await r.page.evaluate(() => document.querySelectorAll('#video-grid > .ui-swipe').length);
      if (noSwipe ? wrapped !== 0 : wrapped === 0) report(false, `${engine} ${size.name} rest: the control is wrong (wrapped ${wrapped}, noSwipe ${noSwipe})`);
      shots.push(await r.page.screenshot());
      rects.push(await r.page.evaluate(() => Array.from(document.querySelectorAll('#video-grid .video-card[data-id]')).map((c) => { const b = c.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].join(); }).join('|')));
      if (SHOTS && !noSwipe) await r.page.screenshot({ path: path.join(SHOTS, `${engine}-${size.name}-rest.png`) });
      await r.browser.close();
    }
    report(Buffer.compare(shots[0], shots[1]) === 0 && rects[0] === rects[1], `${engine} ${size.name} at rest: the screenshot is byte-identical with and without the wrapper (${shots[1].length} bytes), every card rect equal`);
  }
}

// The frame time of a drag (p95), the v1.402.0 probe's method: 4x CPU throttle, 40 moves.
async function runFrames(env) {
  const size = SIZES[0];
  const r = await open(env, 'chromium', size);
  const c = await cardAt(r, 5);
  await r.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await r.page.evaluate(() => { window.__f = []; const loop = (t) => { window.__f.push(t); window.__raf = requestAnimationFrame(loop); }; window.__raf = requestAnimationFrame(loop); });
  const x0 = c.x + c.w - 12; const y0 = c.y + c.h * 0.4;
  const pts = [];
  for (let k = 1; k <= 40; k++) pts.push([x0 - k * (c.w * 0.5 / 40), y0]);
  await finger(r, x0, y0, pts, { stepMs: 16 });
  await r.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const fr = await r.page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__f; });
  const d = fr.slice(1).map((t, i) => t - fr[i]).sort((x, y) => x - y);
  const pct = (q) => d[Math.min(d.length - 1, Math.floor(q * d.length))];
  report(pct(0.95) < 34, `chromium 390x844 drag frames (4x CPU throttle, 40 moves): ${fr.length} frames, interval median ${pct(0.5).toFixed(1)} ms, p95 ${pct(0.95).toFixed(1)} ms`);
  await r.browser.close();
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const env = await boot();
  try {
    for (const engine of ENGINES) {
      if (ONE_SIZE) { await runSize(env, engine, SIZES[0], 0); continue; }
      await runRest(env, engine);
      await runWidths(env, engine);
      for (let i = 0; i < SIZES.length; i++) await runSize(env, engine, SIZES[i], i);
      await runEdges(env, engine);
    }
    if (ENGINES.includes('chromium') && !ONE_SIZE) await runFrames(env);
  } catch (e) {
    fail += 1;
    console.log('FAIL the probe itself threw:', e && e.stack);
  }
  env.listening.closeAllConnections?.();
  env.listening.close();
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) { /* scratch */ }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${passes} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
