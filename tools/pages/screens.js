'use strict';
/* global window, document */

// tools/pages/screens.js - v1.395.0 Pages, plan Step 5 demo: boots the real server in-process on a
// scratch DATA_DIR, saves a few items through the real capture (fixture pages from
// test/fixtures/pages/, captured as a device would send them, so no network is needed), and takes
// phone (390x844) and desktop (1280x900) screenshots of the library, an item in Reader, the same
// item in Original, a text item, the trash and the Add sheet. Prints one JSON line per shot
// (console errors included). Run: node tools/pages/screens.js <out-dir> [--only=name]

const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'pages-screens'));
fs.mkdirSync(OUT, { recursive: true });
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-pages-screens-'));
const { app, pages, __mintTestSession } = require('../../server');
const pw = require(path.join(__dirname, '..', 'capture', 'node_modules', 'playwright'));
const FIX = path.join(__dirname, '..', '..', 'test', 'fixtures', 'pages');

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = __mintTestSession({ username: 'testadmin' });
  const uid = owner.user.id;
  // Images on fixture pages point at hosts the box may not reach; the capture stores what it can.
  const saved = [];
  for (const name of ['lazy-image-1', 'medium-1', 'bbc-1', 'keep-tabular-data']) {
    const r = await pages.capture.saveUrl(uid, { url: `https://example.org/${name}`, html: fs.readFileSync(path.join(FIX, name + '.html'), 'utf8'), source: 'extension', note: name === 'medium-1' ? 'From Sam - read before Thursday' : '' });
    await r.localized.catch(() => null);
    saved.push(r.item);
  }
  const text = await pages.service.saveText(uid, { text: 'Note to self.\n\nThe ferry leaves at noon from pier nine. Bring the blue folder and the receipts from March.', note: 'from an email' });
  pages.service.setReadState(uid, saved[2].id, { read: true });
  const trashed = await pages.service.saveText(uid, { text: 'An old shopping list.\n\nEggs, flour, a lemon.' });
  await pages.service.trash(uid, trashed.item.id);

  const shots = [
    ['library', '/pages', null],
    ['item-reader', `/pages?id=${saved[0].id}`, null],
    ['item-original', `/pages?id=${saved[0].id}`, 'original'],
    ['item-text', `/pages?id=${text.item.id}`, null],
    ['item-note', `/pages?id=${saved[1].id}`, null],
    ['trash', '/pages', 'trash'],
    ['add', '/pages', 'add'],
  ];
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
  const browser = await pw.chromium.launch({ args: ['--disable-gpu-rasterization', '--num-raster-threads=1'] });
  for (const [vpName, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
    for (const [name, url, mode] of shots) {
      if (only && only !== name) continue;
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const [cname, cval] = owner.cookie.split(';')[0].split('=');
      await ctx.addCookies([{ name: cname, value: cval, url: base }]);
      await ctx.addInitScript((m) => {
        try {
          window.localStorage.setItem('ft-pages-view', m === 'original' ? 'original' : 'reader');
          window.localStorage.setItem('ft-pages-tab', m === 'trash' ? 'trash' : 'all');
        } catch { /* storage off */ }
      }, mode);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message || e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(base + url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      if (mode === 'add') { await page.click('#pages-add-btn'); await page.waitForTimeout(600); }
      const file = path.join(OUT, `${name}--${vpName}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const probe = await page.evaluate(() => ({
        rows: document.querySelectorAll('#pages-list .ui-row').length,
        readerText: (document.querySelector('.pages-reader') || {}).textContent ? document.querySelector('.pages-reader').textContent.length : 0,
        frame: !!document.querySelector('.pages-original-frame'),
        sandbox: (document.querySelector('.pages-original-frame') || { getAttribute: () => null }).getAttribute('sandbox'),
        title: (document.querySelector('.pages-item-title') || {}).textContent || null,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      }));
      const real = errors.filter((e) => !/status of 404/.test(e)); // the app's own module probes 404 when yt-dlp is off
      console.log(JSON.stringify({ shot: name, vp: vpName, errors: real, ...probe }));
      await ctx.close();
    }
  }
  await browser.close();
  server.close();
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
