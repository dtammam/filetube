'use strict';
/* global window, document, HTMLCanvasElement, matchMedia, DeviceOrientationEvent */
// v1.366.0 (VR / 360) reachability, plan 2026-10-05 W4: the REAL server, the branch's product code, Chromium with
// SwiftShader WebGL (--use-angle=swiftshader). Not a CI gate (no browser in CI):
//   node tools/vr-proof/probe.js [out.json]
// The library is built by the REAL scan with the REAL ffprobe (FILETUBE_TEST_FFMPEG's directory, else
// ~/.local/bin/ffmpeg-static, put first on PATH before the server loads), so the sphere comes from the file's own
// metadata exactly as in production (Dean 2026-10-06: a video is VR only from its metadata or the owner's pick).
// Rows:
//   scan     - what the scan stored: the metadata-tagged vr-360-v2.mp4 -> projection '360'; the flat
//              'Best 360 dunk.mp4' (the same 2:1 panorama, no metadata, a 360-looking NAME) -> no key.
//   flat     - the flat-by-name video's watch page with the 360 switch stored ON: 0 getContext calls, no canvas,
//              vr-view.js never loaded, the 360 row hidden (a name never reaches WebGL), Video type shown (admin).
//   vrOff    - the labelled panorama (vr-360-v2.mp4, 360 by its metadata) with the switch OFF: the row shown, no canvas.
//   vrOn     - the switch tapped ON: one canvas, one 'webgl' context, the centre colour at yaw 0 is the FRONT band.
//   sense    - a mouse drag to the LEFT by 90 degrees of view shows the RIGHT band (green); a drag to the RIGHT by 90
//              degrees shows the LEFT band (yellow): the picture follows the finger, and the sphere is not mirrored.
//   off      - the switch tapped OFF: no canvas left.
//   pickFlat - the owner picks Video type > Flat: the canvas goes, the 360 row hides; Auto brings both back.
//   nav      - the switch on, then an in-app navigation home: no canvas left in the document.
//   tilt     - a phone context (390x844, touch, the custom mobile player): the Move to look row shows with the
//              sphere (and not on the desktop rows), the tap turns it on, and Chromium-dispatched deviceorientation
//              events move the view: upright reads the front (red), the phone turned 90 degrees LEFT (alpha 90)
//              reads the LEFT band (yellow), turned RIGHT (alpha -90) the RIGHT band (green); a drag with motion on
//              still turns the view.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const FIX = path.join(__dirname, '..', '..', 'test', 'fixtures', 'vr');
const FFDIR = process.env.FILETUBE_TEST_FFMPEG ? path.dirname(process.env.FILETUBE_TEST_FFMPEG) : path.join(os.homedir(), '.local', 'bin', 'ffmpeg-static');
if (!fs.existsSync(path.join(FFDIR, 'ffprobe'))) { console.error('no ffprobe in ' + FFDIR + ' (set FILETUBE_TEST_FFMPEG)'); process.exit(2); }
process.env.PATH = FFDIR + path.delimiter + process.env.PATH;

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
  // qa S2: the result names the commit it measured, and whether the product files differed from it.
  const git = (args) => { try { return require('node:child_process').execFileSync('git', args, { cwd: path.join(__dirname, '..', '..') }).toString().trim(); } catch { return null; } };
  const out = {
    runAt: new Date().toISOString(),
    head: git(['rev-parse', 'HEAD']),
    dirtyProductFiles: (git(['status', '--porcelain', '--', 'public', 'lib', 'server.js', 'tools/vr-proof/probe.js']) || '').split('\n').filter(Boolean),
    rows: {},
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-vr-proof-'));
  process.env.DATA_DIR = dataDir;
  const root = path.join(dataDir, 'media');
  fs.mkdirSync(path.join(root, 'Proof'), { recursive: true });
  const pano = path.join(root, 'Proof', 'vr-360-v2.mp4');
  const flat = path.join(root, 'Proof', 'Best 360 dunk.mp4');
  fs.copyFileSync(path.join(FIX, 'vr-360-v2.mp4'), pano);
  fs.copyFileSync(path.join(FIX, 'pano_360.mp4'), flat);
  const server = require('../../server');
  const { seedState } = require('../../test/helpers/seed-state');
  seedState({ folders: [root], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30, mobileCustomPlayer: true } });
  await new Promise((r) => setTimeout(r, 500)); // the server's boot-time `ffmpeg -version` check is async
  await server.scanDirectories();
  const panoId = server.getMediaId(pano);
  const flatId = server.getMediaId(flat);
  const meta = server.loadDatabase().metadata;
  out.rows.scan = {
    ffprobe: path.join(FFDIR, 'ffprobe'),
    vr360v2: meta[panoId] ? { projection: meta[panoId].projection, width: meta[panoId].width, height: meta[panoId].height } : null,
    best360dunk: meta[flatId] ? { hasProjectionKey: 'projection' in meta[flatId], width: meta[flatId].width, height: meta[flatId].height } : null,
  };
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
      motionRowHidden: (document.getElementById('watch-vr-motion-row') || {}).hidden,
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
    await p.goto(base + '/watch.html?v=' + encodeURIComponent(flatId), { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    out.rows.flat = await state();

    // vrOff: the panorama with the switch OFF.
    await p.evaluate(() => localStorage.removeItem('ft-vr-view'));
    await p.goto(base + '/watch.html?v=' + encodeURIComponent(panoId), { waitUntil: 'networkidle' });
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
    out.rows.pickFlat = { before, afterFlat, afterAuto, stored: await p.evaluate((id) => fetch('/api/videos/' + encodeURIComponent(id)).then((r) => r.json()).then((j) => ({ projection: j.projection, projectionOverride: j.projectionOverride })), panoId) };

    // nav: in-app navigation home with the sphere up.
    await p.evaluate(() => window.FileTube.navigate('/'));
    await p.waitForTimeout(1200);
    out.rows.nav = await state();

    // tilt: a phone, the switch stored on, the custom mobile player (settings.mobileCustomPlayer).
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await mctx.addCookies([{ name: session.cookieName, value: encodeURIComponent(session.token), url: base }]);
    const m = await mctx.newPage();
    m.on('pageerror', (e) => errs.push('phone: ' + e.message));
    await m.goto(base + '/', { waitUntil: 'networkidle' });
    await m.evaluate(() => localStorage.setItem('ft-vr-view', '1'));
    await m.goto(base + '/watch.html?v=' + encodeURIComponent(panoId), { waitUntil: 'networkidle' });
    await m.waitForTimeout(1500);
    await m.evaluate(async () => { const v = document.getElementById('media-player'); v.muted = true; try { await v.play(); } catch { /* the frame still loads */ } v.pause(); v.currentTime = 0.4; });
    await m.waitForTimeout(1200);
    const mstate = () => m.evaluate(() => ({
      nativeControls: document.getElementById('player-wrapper').classList.contains('native-controls'),
      canvases: document.querySelectorAll('canvas.vr-view-canvas').length,
      motionRowHidden: (document.getElementById('watch-vr-motion-row') || {}).hidden,
      motionChecked: (document.getElementById('watch-vr-motion-check') || {}).checked,
      hasDOE: typeof window.DeviceOrientationEvent === 'function',
      coarse: matchMedia('(pointer: coarse)').matches,
    }));
    const mbox = await m.evaluate(() => { const c = document.querySelector('canvas.vr-view-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const mcentre = async () => {
      const shot = await m.screenshot({ clip: { x: Math.round(mbox.x + mbox.w / 2) - 2, y: Math.round(mbox.y + mbox.h / 2) - 2, width: 5, height: 5 } });
      const px = pngPixel(shot, 2, 2); return { rgb: px, name: colourName(px) };
    };
    const orient = async (alpha, beta, gamma) => {
      await m.evaluate((o) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: o[0], beta: o[1], gamma: o[2], absolute: false })), [alpha, beta, gamma]);
      await m.waitForTimeout(300);
    };
    const tilt = { before: Object.assign(await mstate(), { box: mbox }) };
    // Open the cog (a tap reveals the bar first) and tap Move to look.
    for (let k = 0; k < 6; k++) {
      if (await m.evaluate(() => !document.getElementById('settings-menu').hidden)) break;
      await m.tap('#player-wrapper', { position: { x: 20, y: 20 } }).catch(() => {});
      await m.waitForTimeout(250);
      await m.click('#settings-btn', { timeout: 3000 }).catch(() => {});
      await m.waitForTimeout(300);
    }
    tilt.cogOpen = await m.evaluate(() => !document.getElementById('settings-menu').hidden);
    await m.click('#watch-vr-motion-row');
    await m.waitForTimeout(500);
    tilt.afterTap = await mstate();
    // Close the cog (the cog button toggles it) so the picture's centre is the canvas, then let the bar auto-hide.
    for (let k = 0; k < 4 && await m.evaluate(() => !document.getElementById('settings-menu').hidden); k++) {
      await m.click('#settings-btn', { timeout: 3000 }).catch(() => {});
      await m.waitForTimeout(300);
    }
    tilt.cogClosed = await m.evaluate(() => document.getElementById('settings-menu').hidden);
    await m.waitForTimeout(3500);
    await orient(0, 90, 0);
    tilt.upright = await mcentre();
    await orient(90, 90, 0);
    tilt.turnedLeft90 = await mcentre();
    await orient(-90, 90, 0);
    tilt.turnedRight90 = await mcentre();
    await orient(0, 90, 0);
    tilt.backUpright = await mcentre();
    // A drag with motion on still turns the view: 90 degrees of drag to the LEFT shows the RIGHT band.
    const mper90 = (Math.PI / 2) * mbox.w / (2 * Math.atan(Math.tan(75 * Math.PI / 360) * (mbox.w / mbox.h)));
    {
      let left = -mper90; const step = -Math.min(mper90, mbox.w * 0.4);
      while (Math.abs(left) > 0.5) {
        const d = Math.abs(left) < Math.abs(step) ? left : step;
        const sx = mbox.x + mbox.w / 2 - d / 2; const y = mbox.y + mbox.h / 2;
        await m.mouse.move(sx, y); await m.mouse.down(); await m.mouse.move(sx + d, y, { steps: 12 }); await m.mouse.up();
        left -= d;
      }
      await m.waitForTimeout(300);
    }
    tilt.dragLeft90WithMotion = await mcentre();
    tilt.per90px = Math.round(mper90);
    out.rows.tilt = tilt;
    out.rows.desktopMotionRowHidden = out.rows.vrOn.motionRowHidden;
    await mctx.close();
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
