'use strict';
/* global window, document, getComputedStyle */

// tools/pages/original-render-probe.js - v1.395.0 Pages, plan Step 3 demo: an
// Original renders in the app's sandboxed iframe WITH its local images, and a
// script planted straight into the stored original.html (bypassing the
// sanitizer, as a bug or a tampered file would) does not run under the served
// CSP (no script-src, CSP sandbox) inside the app's iframe sandbox. Boots the real server in-process on a scratch DATA_DIR,
// drives Chromium, WebKit and Firefox (Playwright from tools/capture), prints one
// JSON line per engine. Run: node tools/pages/original-render-probe.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-pages-probe-'));
const { app, pages, __mintTestSession } = require('../../server');
const pw = require(path.join(__dirname, '..', 'capture', 'node_modules', 'playwright'));

// A real 4x3 PNG (naturalWidth must be > 0 when it renders).
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80);
  for (let y = 0; y < h; y += 1) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = __mintTestSession({ username: 'testadmin' });
  const PNG = png(4, 3);
  const NAME = require('crypto').createHash('sha256').update(PNG).digest('hex').slice(0, 24) + '.png';
  const original = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"/><style>.hero{width:40px;height:30px;background:url("assets/${NAME}")}</style></head><body><div class="hero"></div><img id="pic" src="assets/${NAME}" alt="pic"/>`
    + '<script>try { parent.postMessage("script-ran", "*"); } catch (e) {}</script>'
    + '<img src="x" onerror="parent.postMessage(\'handler-ran\', \'*\')"/></body></html>\n';
  const { item } = await pages.service.saveItem(owner.user.id, {
    record: { kind: 'url', title: 'Probe', url: 'https://example.com/p', hasReader: false, hasOriginal: true, source: 'web', assets: { state: 'done', count: 1, bytes: PNG.length, dropped: [] } },
    files: { 'original.html': original, 'text.txt': 'probe\n' },
    assets: [{ name: NAME, data: PNG }],
  });
  const results = [];
  for (const [name, type] of [['chromium', pw.chromium], ['webkit', pw.webkit], ['firefox', pw.firefox]]) {
    let browser;
    try { browser = await type.launch(); } catch (e) { results.push({ engine: name, error: 'launch: ' + e.message.split('\n')[0] }); continue; }
    const ctx = await browser.newContext();
    const [cname, cval] = owner.cookie.split(';')[0].split('=');
    await ctx.addCookies([{ name: cname, value: cval, url: base }]);
    const page = await ctx.newPage();
    await page.goto(base + '/api/auth/me');
    const out = await page.evaluate(async (src) => {
      const messages = [];
      window.addEventListener('message', (e) => messages.push(String(e.data)));
      document.body.innerHTML = '';
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      f.src = src;
      document.body.appendChild(f);
      await new Promise((r) => { f.onload = r; setTimeout(r, 5000); });
      await new Promise((r) => setTimeout(r, 800));
      let inner = null;
      try { inner = f.contentDocument ? 'readable' : 'opaque'; } catch { inner = 'opaque'; }
      return { messages, inner };
    }, `${base}/api/pages/${item.id}/original`);
    // The frame's own view: did its images decode? (Playwright reaches into opaque frames.)
    const frame = page.frames().find((fr) => fr.url().includes('/original'));
    const images = frame ? await frame.evaluate(() => {
      const img = document.getElementById('pic');
      const hero = getComputedStyle(document.querySelector('.hero')).backgroundImage;
      return { picWidth: img ? img.naturalWidth : -1, picHeight: img ? img.naturalHeight : -1, heroBackground: hero.slice(0, 30) };
    }).catch((e) => ({ error: e.message.split('\n')[0] })) : { error: 'no frame' };
    results.push({ engine: name, scriptsRan: out.messages, parentCanReadFrame: out.inner === 'readable', images });
    await browser.close();
  }
  for (const r of results) console.log(JSON.stringify(r));
  server.close();
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
