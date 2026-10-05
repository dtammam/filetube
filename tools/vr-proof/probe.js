'use strict';
/* global window, document, HTMLCanvasElement */
// v1.366.0 (VR / 360) reachability, plan 2026-10-05 W4: the REAL server, the branch's product code, Chromium with
// SwiftShader WebGL (--use-angle=swiftshader). Not a CI gate (no browser in CI):
//   node tools/vr-proof/probe.js [out.json]
// Rows:
//   flat     - a flat video's watch page with the 360 switch stored ON: 0 getContext calls, no canvas, vr-view.js
//              never loaded, the 360 row hidden (the switch never reaches a flat video), Video type shown (admin).
//   vrOff    - the labelled panorama (pano_360.mp4, 360 by its NAME) with the switch OFF: the row shown, no canvas.
//   vrOn     - the switch tapped ON: one canvas, one 'webgl' context, the centre colour at yaw 0 is the FRONT band.
//   sense    - a mouse drag to the LEFT by 90 degrees of view shows the RIGHT band (green); a drag to the RIGHT by 90
//              degrees shows the LEFT band (yellow): the picture follows the finger, and the sphere is not mirrored.
//   off      - the switch tapped OFF: no canvas left.
//   pickFlat - the owner picks Video type > Flat: the canvas goes, the 360 row hides; Auto brings both back.
//   nav      - the switch on, then an in-app navigation home: no canvas left in the document.
// The panorama's bands (test/fixtures/vr/README.md): front red at longitude 0, right green at +90, back blue at
// 180, left yellow at -90; each 45 degrees wide.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const FIX = path.join(__dirname, '..', '..', 'test', 'fixtures', 'vr');

// A tiny PNG reader (8-bit RGB/RGBA, non-interlaced: what Chromium's screenshots are) -> pixel at (x, y).
function pngPixel(buf, x, y) {
  let off = 8; let w = 0; let h = 0; let ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8); const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported png'); }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3; const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let r = 0; r < h; r++) {
    const f = raw[r * (stride + 1)]; const src = raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[r * stride + i - bpp] : 0; const b = r > 0 ? out[(r - 1) * stride + i] : 0; const c = (r > 0 && i >= bpp) ? out[(r - 1) * stride + i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[r * stride + i] = v & 255;
    }
  }
  const i = y * stride + x * bpp;
  return [out[i], out[i + 1], out[i + 2]];
}
function colourName([r, g, b]) {
  if (r > 150 && g < 90 && b < 90) return 'red';
  if (g > 90 && r < 90 && b < 90) return 'green';
  if (b > 150 && r < 90 && g < 90) return 'blue';
  if (r > 150 && g > 150 && b < 90) return 'yellow';
  if (Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && r > 60) return 'gray';
  return 'other';
}

(async () => {
  const outFile = process.argv[2] || path.join(__dirname, 'probe-result.json');
  const out = { runAt: new Date().toISOString(), rows: {} };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-vr-proof-'));
  process.env.DATA_DIR = dataDir;
  const root = path.join(dataDir, 'media');
  fs.mkdirSync(path.join(root, 'Proof'), { recursive: true });
  const pano = path.join(root, 'Proof', 'pano_360.mp4');
  const flat = path.join(root, 'Proof', 'flat_clip.mp4');
  fs.copyFileSync(path.join(FIX, 'pano_360.mp4'), pano);
  fs.copyFileSync(path.join(FIX, 'pano_360.mp4'), flat);
  const server = require('../../server');
  const { seedState } = require('../../test/helpers/seed-state');
  seedState({ folders: [root], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  const item = (id, name, file, add) => ({ id, type: 'video', title: id, name, filePath: file, rootFolder: root, folderName: 'Proof', channelName: 'Proof', duration: 2, hasThumbnail: false, ext: '.mp4', addedAt: 1788000000000 + add, width: 512, height: 256, videoCodec: 'h264', audioCodec: null });
  await server.updateDatabase((db) => { db.metadata = { pano: item('pano', 'pano_360.mp4', pano, 1), flatclip: item('flatclip', 'flat_clip.mp4', flat, 2) }; return true; });
  const session = server.__mintTestSession({ username: 'vrproofadmin' });
  const http = await new Promise((resolve) => { const s = server.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + http.address().port;
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: session.cookieName, value: encodeURIComponent(session.token), url: base }]);
    // The getContext spy: every call, by context type, from document start.
    await ctx.addInitScript(() => {
      window.__gc = [];
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (t, o) { window.__gc.push(String(t)); return orig.call(this, t, o); };
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    const state = () => p.evaluate(() => ({
      gc: window.__gc.slice(),
      canvases: document.querySelectorAll('canvas.vr-view-canvas').length,
      script: !!document.querySelector('script[src*="vr-view.js"]'),
      vrRowHidden: (document.getElementById('watch-vr-row') || {}).hidden,
      typeBtnHidden: (document.getElementById('video-type-btn') || {}).hidden,
    }));
    const openCog = async () => {
      // The bar auto-hides and the cog toggles: poll until the menu is really open (the probe's own timing, not product).
      for (let k = 0; k < 6; k++) {
        if (await p.evaluate(() => !document.getElementById('settings-menu').hidden)) return;
        await p.mouse.move(640, 300); await p.hover('#player-wrapper');
        await p.click('#settings-btn', { timeout: 3000 }).catch(() => {});
        await p.waitForTimeout(300);
      }
      throw new Error('the cog would not open');
    };
    const tapSwitch = async () => { await openCog(); await p.click('#watch-vr-row'); await p.waitForTimeout(900); await p.keyboard.press('Escape').catch(() => {}); };

    // flat: the switch stored ON before the page loads.
    await p.goto(base + '/', { waitUntil: 'networkidle' });
    await p.evaluate(() => localStorage.setItem('ft-vr-view', '1'));
    await p.goto(base + '/watch.html?v=flatclip', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    out.rows.flat = await state();

    // vrOff: the panorama with the switch OFF.
    await p.evaluate(() => localStorage.removeItem('ft-vr-view'));
    await p.goto(base + '/watch.html?v=pano', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    out.rows.vrOff = await state();

    // vrOn: tap the switch; make sure a frame is decoded (play, then pause on frame one).
    await tapSwitch();
    await p.evaluate(async () => { const v = document.getElementById('media-player'); v.muted = true; try { await v.play(); } catch { /* autoplay refused: the frame still loads */ } v.pause(); v.currentTime = 0.4; });
    await p.waitForTimeout(1200);
    const box = await p.evaluate(() => { const c = document.querySelector('canvas.vr-view-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    out.rows.vrOn = Object.assign(await state(), { box });
    const centre = async () => {
      const shot = await p.screenshot({ clip: { x: Math.round(box.x + box.w / 2) - 2, y: Math.round(box.y + box.h / 2) - 2, width: 5, height: 5 } });
      const px = pngPixel(shot, 2, 2); return { rgb: px, name: colourName(px) };
    };
    // Pixels per 90 degrees of yaw, from vr-view's own drag math (dragView: yaw += dx * fovX / w).
    const per90 = await p.evaluate((b) => { const fovY = 75 * Math.PI / 180; const fovX = 2 * Math.atan(Math.tan(fovY / 2) * (b.w / b.h)); return (Math.PI / 2) * b.w / fovX; }, box);
    const drag = async (dx) => {
      // in steps that stay inside the canvas (a long drag in several strokes)
      let left = dx; const step = Math.sign(dx) * Math.min(Math.abs(dx), box.w * 0.4);
      while (Math.abs(left) > 0.5) {
        const d = Math.abs(left) < Math.abs(step) ? left : step;
        const sx = box.x + box.w / 2 - d / 2; const y = box.y + box.h / 2;
        await p.mouse.move(sx, y); await p.mouse.down(); await p.mouse.move(sx + d, y, { steps: 12 }); await p.mouse.up();
        left -= d;
      }
      await p.waitForTimeout(300);
    };
    out.rows.sense = { per90px: Math.round(per90), yaw0: await centre() };
    await drag(-per90);
    out.rows.sense.afterDragLeft90 = await centre();
    await drag(per90); // back to the front
    out.rows.sense.backToFront = await centre();
    await drag(per90);
    out.rows.sense.afterDragRight90 = await centre();

    // off: tap the switch off.
    await tapSwitch();
    out.rows.off = await state();

    // pickFlat: the switch on again, then the owner's Video type > Flat, then Auto.
    await tapSwitch();
    const before = await state();
    await openCog(); await p.click('#video-type-btn'); await p.waitForTimeout(900);
    await p.click('.ui-sheet.is-open .ui-row:has-text("Flat")'); await p.waitForTimeout(900);
    const afterFlat = await state();
    await openCog(); await p.click('#video-type-btn'); await p.waitForTimeout(900);
    await p.click('.ui-sheet.is-open .ui-row:has-text("Auto")'); await p.waitForTimeout(1200);
    const afterAuto = await state();
    out.rows.pickFlat = { before, afterFlat, afterAuto, stored: await p.evaluate(() => fetch('/api/videos/pano').then((r) => r.json()).then((j) => ({ projection: j.projection, projectionOverride: j.projectionOverride }))) };

    // nav: in-app navigation home with the sphere up.
    await p.evaluate(() => window.FileTube.navigate('/'));
    await p.waitForTimeout(1200);
    out.rows.nav = await state();
  } catch (e) {
    out.error = String(e && e.stack || e).slice(0, 800);
  } finally {
    out.pageErrors = errs;
    await browser.close();
    http.closeAllConnections?.(); await new Promise((r) => http.close(r));
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');
    console.log(JSON.stringify(out, null, 1));
    process.exit(0);
  }
})();
