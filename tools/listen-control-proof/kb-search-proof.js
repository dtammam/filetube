'use strict';
/* global window, document, getComputedStyle, MouseEvent, PointerEvent */
// HEADLESS PROOF (v1.355 W2): keyboard search on the iPod. Real server (serve.js, seeded songs), headless Chromium
// with touch emulation (isMobile, hasTouch, an iPhone UA) at 393x852 and 375x667, a Click skin (ipod-charcoal) and the
// Original look (ipod-original). Flag ON: a REAL CDP touch tap on the center opens Search; the input is focused right
// after that tap; Input.insertText types; the /api/music?search= request is seen and rows render; scrollY, the visual
// viewport's offsetTop and scale, the LCD rect and the panel rect are read before the tap, after the focus and after the
// typing, and must be identical; the input's computed font-size and its on-screen scale (no transform shrink); the
// input's rect inside the .ipm-q rect; the LCD's bottom edge (to compare with the iPhone keyboard's top on device).
// Flag OFF: the same tap opens the v1.354 strip, no input exists, the center types a letter. Headless cannot show the
// iOS keyboard, its avoidance scroll or focus-zoom: the device check (rotate log ON) is the judge. Not a CI gate.
//   node tools/listen-control-proof/kb-search-proof.js   (writes kb-search-proof-out.json beside it)
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SIZES = [[393, 852], [375, 667]];
const SKINS = ['ipod-charcoal', 'ipod-original'];

// one read pass: nothing here changes layout
function measure() {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 100) / 100); };
  const vv = window.visualViewport;
  return {
    sy: window.scrollY,
    vvTop: vv ? vv.offsetTop : null,
    vvScale: vv ? vv.scale : null,
    lcd: r(document.querySelector('.mms-full .ip-lcd')),
    panel: r(document.getElementById('music-nowplaying-panel')),
  };
}

async function row(b, srv, size, skin, flagOn) {
  const ctx = await b.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  await ctx.addCookies([srv.cookie]);
  await ctx.addInitScript(([s, on]) => {
    try { localStorage.setItem('ft-music-skin', s); if (on) localStorage.setItem('ft-pocket-keyboard-search', '1'); else localStorage.removeItem('ft-pocket-keyboard-search'); } catch { /* */ }
  }, [skin, flagOn]);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const searches = []; p.on('request', (q) => { const u = q.url(); if (u.includes('/api/music?search=')) searches.push(u.slice(u.indexOf('/api/'))); });
  const cdp = await ctx.newCDPSession(p);
  const ev = async (fn, arg) => { const r = await cdp.send('Runtime.evaluate', { expression: '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')', returnByValue: true, awaitPromise: true, userGesture: false }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  await p.goto(srv.base + '/music?play=song1', { waitUntil: 'networkidle' });
  await p.waitForSelector('.mms-full .ip-lcd-in', { timeout: 15000 });
  // getting to Music with the cursor on Search is not what is measured: synthetic events (no focus moves)
  const click = (sel) => ev((s) => { const el = document.querySelector(s); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, sel);
  const tapRow = (label) => ev((l) => { const r = Array.from(document.querySelectorAll('[data-skin-mi]')).find((x) => x.textContent.trim().startsWith(l)); if (!r) return false; r.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, label);
  const cursor = () => ev(() => { const c = document.querySelector('.ipm-row.is-cursor .ipm-lbl'); return c ? c.textContent : null; });
  await click('[data-skin-menu]');
  await p.waitForTimeout(200);
  await tapRow('Music');
  await p.waitForTimeout(200);
  for (let k = 0; k < 30 && (await cursor()) !== 'Search'; k++) {
    await ev(() => {
      const w = document.querySelector('.ip-wheel'); const r = w.getBoundingClientRect(); const cx = r.x + r.width / 2; const cy = r.y + r.height / 2; const R = r.width * 0.4;
      const at = (d) => ({ clientX: cx + R * Math.cos(d * Math.PI / 180), clientY: cy + R * Math.sin(d * Math.PI / 180), pointerId: 7, bubbles: true });
      w.dispatchEvent(new PointerEvent('pointerdown', at(0)));
      for (let d = 6; d <= 30; d += 6) w.dispatchEvent(new PointerEvent('pointermove', at(d)));
      w.dispatchEvent(new PointerEvent('pointerup', at(30)));
    });
    await p.waitForTimeout(60);
  }
  const out = { size: size.join('x'), skin, flag: flagOn ? 'on' : 'off', cursorBefore: await cursor() };
  out.before = await ev(measure);
  out.activeBefore = await ev(() => (document.activeElement ? document.activeElement.tagName.toLowerCase() + (document.activeElement.id ? '#' + document.activeElement.id : '') : ''));
  // THE measured step: a real touch tap on the center
  const c = await ev(() => { const b = document.querySelector('.mms-full .ip-center').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(150);
  out.title = await ev(() => (document.querySelector('.ip-np') || {}).textContent || '');
  out.activeAfterTap = await ev(() => (document.activeElement ? document.activeElement.tagName.toLowerCase() + (document.activeElement.id ? '#' + document.activeElement.id : '') : ''));
  out.inputs = await ev(() => document.querySelectorAll('input.ipm-kb, #ipm-kb').length);
  out.strip = await ev(() => !!document.querySelector('.mms-full .ipm-strip'));
  if (flagOn) {
    out.afterFocus = await ev(measure);
    out.input = await ev(() => {
      const i = document.getElementById('ipm-kb'); const q = document.querySelector('.ip-menuview .ipm-q');
      const ir = i.getBoundingClientRect(); const qr = q.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(i).fontSize);
      const scale = i.offsetHeight ? ir.height / i.offsetHeight : null;
      return { parent: i.parentNode === document.body ? 'body' : i.parentNode.className, fontSizePx: fs, onScreenScale: scale, effectiveFontPx: scale == null ? null : fs * scale,
        rect: [ir.x, ir.y, ir.width, ir.height].map(Math.round), qRect: [qr.x, qr.y, qr.width, qr.height].map(Math.round),
        inside: ir.left >= qr.left - 0.5 && ir.top >= qr.top - 0.5 && ir.right <= qr.right + 0.5 && ir.bottom <= qr.bottom + 0.5,
        opacity: getComputedStyle(i).opacity, zIndex: getComputedStyle(i).zIndex, position: getComputedStyle(i).position };
    });
    await cdp.send('Input.insertText', { text: 'Proof' });
    for (let k = 0; k < 40; k++) { if (searches.length && (await ev(() => document.querySelectorAll('.ipm-list [data-skin-mi]').length)) > 0) break; await p.waitForTimeout(100); }
    out.searchRequests = searches.slice();
    out.query = await ev(() => (document.querySelector('.ipm-q') || {}).textContent || '');
    out.resultRows = await ev(() => Array.from(document.querySelectorAll('.ipm-list .ipm-row:not(.ipm-skel) .ipm-lbl')).map((x) => x.textContent));
    out.activeAfterType = await ev(() => (document.activeElement ? document.activeElement.tagName.toLowerCase() + (document.activeElement.id ? '#' + document.activeElement.id : '') : ''));
    out.afterType = await ev(measure);
    out.lcdBottomY = out.afterType.lcd ? Math.round((out.afterType.lcd[1] + out.afterType.lcd[3]) * 100) / 100 : null;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    out.unmoved = { focus: same(out.before, out.afterFocus), typing: same(out.before, out.afterType) };
    out.ok = out.title === 'Search' && out.activeAfterTap === 'input#ipm-kb' && out.inputs === 1 && !out.strip && out.input.parent === 'body' &&
      out.input.effectiveFontPx >= 16 && out.input.inside && out.searchRequests.some((u) => u.startsWith('/api/music?search=Proof')) &&
      out.resultRows.length > 0 && out.unmoved.focus && out.unmoved.typing;
  } else {
    // the wheel types: the center adds the letter under the marker (A on open)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(150);
    out.query = await ev(() => (document.querySelector('.ipm-q') || {}).textContent || '');
    out.inputsAfterType = await ev(() => document.querySelectorAll('input.ipm-kb, #ipm-kb').length);
    out.ok = out.title === 'Search' && out.inputs === 0 && out.inputsAfterType === 0 && out.strip && out.query === 'A' && !/^input/.test(out.activeAfterTap); // (Chromium focuses the tapped center button, as on v1.354)
  }
  out.errors = errs;
  out.ok = out.ok && !errs.length;
  await ctx.close();
  return out;
}

async function main() {
  const srv = await start({ seconds: 60 });
  const b = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const rows = [];
  for (const size of SIZES) for (const skin of SKINS) rows.push(await row(b, srv, size, skin, true));
  for (const skin of SKINS) rows.push(await row(b, srv, SIZES[0], skin, false));
  const out = { when: new Date().toISOString(), rows, ok: rows.every((r) => r.ok) };
  fs.writeFileSync(path.join(__dirname, 'kb-search-proof-out.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(rows.map((r) => ({ size: r.size, skin: r.skin, flag: r.flag, ok: r.ok }))));
  await b.close(); await srv.stop();
  process.exit(out.ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
