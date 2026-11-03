#!/usr/bin/env node
'use strict';
/* global document, window, MutationObserver, requestAnimationFrame, cancelAnimationFrame, KeyboardEvent */
// v1.402.0 page turn (plan 2026-11-03-book-page-turn): the real-browser proof of the plan's acceptance. It boots
// the real server with a generated EPUB (long chapters, so a chapter spans many phone pages) and a generated PDF,
// opens /read.html?b=<id> in Playwright, and drives the reader the way a finger or a mouse does:
//
//   node scripts/page-turn-probe.js <mode> [chromium|webkit|both] [--epub <file>]
//     smoke     open each book, report errors, the viewers and the first place
//     trigger   the prototype's seven release cases (slow 8% / 25% stay; 32% / 45% turn; a 12% flick turns;
//               pull back from 32% and from 45% stays), one-page phone viewport, per engine
//     landing   the frame after a page lands equals the resting frame of the new place (screenshot bytes),
//               both directions, one-page and two-page, EPUB and PDF
//     place     hidden pool views never save a place; forward 5 and back 2 saves the visible page's locator
//     reduced   with reduced motion emulated, a turn changes the page in one frame
//     frames    a scripted drag under a 4x CPU throttle (Chromium): main-thread ms per frame and Paint events
//               for page content during the drag, from a Chrome trace
//     pdfscroll P4: a PDF opens paged; More > Scroll pages brings back the scroll column on the same page, and
//               the choice is remembered; Turn pages brings the turning pages back
//     link      an in-book link moves the whole pool: the visible page AND the turn after it are the target's
//     csp       P9: a hostile EPUB (inline script, onerror, javascript: link, SVG script, meta refresh) runs NONE
//               of its code, while the reader still hears a drag that starts on its text
// Not a CI gate: a proof tool. Prints one line per case and a PASS/FAIL summary; exit 1 on any failure.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const MODE = process.argv[2] || 'smoke';
const ENGINE_ARG = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'both';
const ENGINES = ENGINE_ARG === 'both' ? ['chromium', 'webkit'] : [ENGINE_ARG];
const EPUB_ARG = (() => { const i = process.argv.indexOf('--epub'); return i > 0 ? process.argv[i + 1] : null; })();
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pageturn-'));
process.env.PROGRESS_FLUSH_MS = '50';

const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));
const { buildEpub } = require(path.join(REPO, 'test/helpers/build-zip'));

// ---- fixtures
function para(ch, i) {
  const words = [];
  for (let w = 0; w < 46; w++) words.push(`c${ch}p${i}w${w}`);
  return `<p>${words.join(' ')}</p>`;
}
const CHAPTER_PARAS = Number(process.env.PT_CHAPTER_PARAS || 22);
const CHAPTERS = [1, 2, 3, 4].map((c) => `<h1>Chapter ${c}</h1>${Array.from({ length: CHAPTER_PARAS }, (_, i) => para(c, i)).join('')}`);

// A minimal valid PDF: N pages, each with its number in big type and a few text lines (Helvetica).
function buildPdf(n) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objs.length + 1 + n * 2; // reserved below
  const kids = [];
  for (let i = 1; i <= n; i++) {
    let text = `BT /F1 72 Tf 220 600 Td (${i}) Tj ET`;
    for (let l = 0; l < 14; l++) text += ` BT /F1 14 Tf 72 ${520 - l * 24} Td (Page ${i} line ${l + 1} of the probe document) Tj ET`;
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${n} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((b, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function boot() {
  const server = require(path.join(REPO, 'server.js'));
  const { app, updateDatabase, scanBooks, booksDb, __mintTestSession, flushPendingBookProgress } = server;
  const booksDir = path.join(process.env.DATA_DIR, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  if (EPUB_ARG) fs.copyFileSync(EPUB_ARG, path.join(booksDir, 'probe.epub'));
  else fs.writeFileSync(path.join(booksDir, 'probe.epub'), buildEpub({ title: 'Probe', author: 'Turn', chapters: CHAPTERS }));
  fs.writeFileSync(path.join(booksDir, 'probe.pdf'), buildPdf(12));
  await updateDatabase(() => booksDb.mutate((db) => { require(path.join(REPO, 'lib/books/store')).ensureBooks(db).folders = [booksDir]; return true; }));
  await scanBooks();
  const items = Object.values(booksDb.read().items);
  const epubId = items.find((i) => i.format === 'epub').id;
  const pdfId = items.find((i) => i.format === 'pdf').id;
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listening.address().port}`;
  const { cookie } = __mintTestSession();
  return { server, listening, base, cookie, epubId, pdfId, flushPendingBookProgress };
}

async function openReader(env, engine, id, viewport, opts = {}) {
  const browser = await pw[engine].launch(opts.launch || {});
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: opts.reducedMotion || 'no-preference' });
  await ctx.addCookies([{ name: env.cookie.split('=')[0], value: env.cookie.split('=')[1].split(';')[0], url: env.base }]);
  if (opts.prefs) await ctx.addInitScript((prefs) => { for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v); }, opts.prefs);
  const page = await ctx.newPage();
  const pings = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/progress')) { try { pings.push(JSON.parse(req.postData() || '{}')); } catch { pings.push({}); } }
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message)));
  await page.goto(`${env.base}/read.html?b=${encodeURIComponent(id)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => { const p = document.getElementById('reader-pane'); return p && p.dataset.ptPlace; }, null, { timeout: 30000 });
  await settle(page);
  return { browser, ctx, page, pings, errors };
}

// Wait until no turn is in flight and the place has stayed put for a few frames.
async function settle(page, ms = 400) {
  await page.waitForFunction(() => document.getElementById('reader-pane').dataset.ptTurning === '0', null, { timeout: 15000 });
  await page.waitForTimeout(ms);
}
const place = (page) => page.evaluate(() => document.getElementById('reader-pane').dataset.ptPlace);
const bookBox = (page) => page.evaluate(() => { const r = document.querySelector('.pt-book').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });

module.exports = { boot, openReader, settle, place, bookBox, buildPdf, ENGINES, MODE, pw };

async function smoke(env) {
  let fail = 0;
  for (const engine of ENGINES) {
    for (const [kind, id] of [['epub', env.epubId], ['pdf', env.pdfId]]) {
      const r = await openReader(env, engine, id, { width: 390, height: 844 });
      const info = await r.page.evaluate(() => ({
        viewers: document.querySelectorAll('.pt-page').length,
        iframes: document.querySelectorAll('.pt-book iframe').length,
        sandbox: (document.querySelector('.pt-book iframe') || { getAttribute: () => null }).getAttribute('sandbox'),
        csp: (() => { const f = document.querySelector('.pt-book iframe'); const m = f && f.contentDocument && f.contentDocument.querySelector('meta[http-equiv="Content-Security-Policy"]'); return m ? m.getAttribute('content').slice(0, 30) : null; })(),
        status: document.getElementById('reader-status').hidden,
      }));
      const p0 = await place(r.page);
      const box = await bookBox(r.page);
      await r.page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.6);
      await r.page.mouse.down();
      for (let k = 1; k <= 12; k++) { await r.page.mouse.move(box.x + box.w * (0.6 - k * 0.04), box.y + box.h * 0.6); await r.page.waitForTimeout(16); }
      await r.page.waitForTimeout(120);
      await r.page.mouse.up();
      await settle(r.page);
      const p1 = await place(r.page);
      await r.page.keyboard.press('ArrowLeft');
      await settle(r.page);
      const p2 = await place(r.page);
      const ok = r.errors.length === 0 && p1 !== p0 && p2 === p0;
      if (!ok) fail++;
      console.log(`${ok ? 'PASS' : 'FAIL'} smoke ${engine} ${kind} ${JSON.stringify({ ...info, p0, afterDrag: p1, afterArrowLeft: p2, errors: r.errors })}`);
      await r.browser.close();
    }
  }
  return fail;
}


// ---- PNG decode (8-bit RGB/RGBA, no interlace: what Playwright writes) for pixel diffs
function decodePng(buf) {
  const zlib = require('node:zlib');
  let o = 8; let w = 0; let h = 0; let ct = 6; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8); const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3; const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)); const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0; const b = prev[x]; const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 255;
    }
    cur.copy(out, y * stride); prev = cur;
  }
  return { w, h, bpp, data: out };
}
function pixelDiff(a, b) {
  const A = decodePng(a); const B = decodePng(b);
  if (A.w !== B.w || A.h !== B.h) return { differing: -1, max: 255 };
  let differing = 0; let max = 0;
  for (let i = 0; i < A.w * A.h; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i * A.bpp + c] - B.data[i * B.bpp + c]));
    if (d) differing++;
    if (d > max) max = d;
  }
  return { differing, max, pixels: A.w * A.h };
}

// ---- drags. The press starts in the middle of the page (x 0.7 W: inside the page text, not a tap zone), so
// the drag is heard through the chapter document's own listeners in an EPUB (P6, P9).
async function drag(page, box, plan) {
  const x0 = box.x + box.w * 0.7; const y0 = box.y + box.h * 0.7; const W = box.w;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  let x = x0;
  for (const seg of plan) {
    const steps = seg.steps; const dx = (seg.to * W - (x0 - x)) / steps;
    for (let k = 0; k < steps; k++) { x -= dx; await page.mouse.move(x, y0 + 1); if (seg.wait) await page.waitForTimeout(seg.wait); }
    if (seg.rest) await page.waitForTimeout(seg.rest);
  }
  await page.mouse.up();
}
const CASES = [
  { name: 'slow 8% stays', turn: false, plan: [{ to: 0.08, steps: 6, wait: 16, rest: 150 }] },
  { name: 'slow 25% stays', turn: false, plan: [{ to: 0.25, steps: 12, wait: 16, rest: 150 }] },
  { name: 'slow 32% turns', turn: true, plan: [{ to: 0.32, steps: 14, wait: 16, rest: 150 }] },
  { name: 'slow 45% turns', turn: true, plan: [{ to: 0.45, steps: 18, wait: 16, rest: 150 }] },
  { name: 'flick 12% turns', turn: true, plan: [{ to: 0.12, steps: 4 }] },
  { name: 'pull back from 32% stays', turn: false, plan: [{ to: 0.32, steps: 14, wait: 16, rest: 40 }, { to: 0.24, steps: 3 }] },
  { name: 'pull back from 45% stays', turn: false, plan: [{ to: 0.45, steps: 18, wait: 16, rest: 40 }, { to: 0.37, steps: 3 }] },
];
async function trigger(env) {
  let fail = 0;
  for (const engine of ENGINES) {
    const r = await openReader(env, engine, env.epubId, { width: 390, height: 844 });
    // start mid-book so a fall back and a turn are both possible
    await r.page.keyboard.press('ArrowRight'); await settle(r.page);
    let passed = 0;
    for (const c of CASES) {
      const before = await place(r.page);
      const box = await bookBox(r.page);
      await drag(r.page, box, c.plan);
      await settle(r.page);
      const after = await place(r.page);
      const turned = after !== before;
      const ok = turned === c.turn;
      if (ok) passed++; else fail++;
      console.log(`${ok ? 'PASS' : 'FAIL'} trigger ${engine} ${c.name}: ${before} -> ${after}`);
      if (turned) { await r.page.keyboard.press('ArrowLeft'); await settle(r.page); }
    }
    console.log(`trigger ${engine}: ${passed}/${CASES.length} pass; page errors ${r.errors.length}`);
    if (r.errors.length) fail++;
    await r.browser.close();
  }
  return fail;
}

// ---- landing: hold rAF at the landing frame (the swap to the twin rig waits on rAF), shoot it, release, let
// the swap and the re-point finish, shoot the rest frame of the same place, and diff the pixels.
async function shootBook(page) {
  const b = await bookBox(page);
  return page.screenshot({ clip: { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.floor(b.w), height: Math.floor(b.h) } });
}
async function landing(env) {
  let fail = 0;
  const engine = ENGINES[0];
  for (const [kind, id] of [['epub', env.epubId], ['pdf', env.pdfId]]) {
    for (const [lay, vp] of [['one-page', { width: 390, height: 844 }], ['two-page', { width: 1100, height: 760 }]]) {
      const r = await openReader(env, engine, id, vp, { launch: { args: ['--disable-gpu-rasterization', '--num-raster-threads=1'] } });
      await r.page.keyboard.press('ArrowRight'); await settle(r.page, 800);
      for (const [dir, key] of [['forward', 'ArrowRight'], ['back', 'ArrowLeft']]) {
        await r.page.evaluate(() => {
          const pane = document.getElementById('reader-pane');
          window.__held = []; window.__realRaf = window.requestAnimationFrame;
          window.__landed = new Promise((res) => {
            const mo = new MutationObserver(() => {
              if (pane.dataset.ptTurning === '0') {
                mo.disconnect();
                window.requestAnimationFrame = (fn) => { window.__held.push(fn); return 0; };
                res(pane.dataset.ptPlace);
              }
            });
            mo.observe(pane, { attributes: true, attributeFilter: ['data-pt-turning'] });
          });
        });
        await r.page.keyboard.press(key);
        const landedAt = await r.page.evaluate(() => window.__landed);
        await r.page.waitForTimeout(250);
        const landed = await shootBook(r.page);
        const twinsBefore = await r.page.evaluate(() => document.querySelector('.pt-rig.is-top') === document.querySelectorAll('.pt-rig')[1] ? 'f' : 'b');
        await r.page.evaluate(() => { window.requestAnimationFrame = window.__realRaf; const q = window.__held; window.__held = []; q.forEach((fn) => window.requestAnimationFrame(fn)); });
        await settle(r.page, 900);
        const twinsAfter = await r.page.evaluate(() => document.querySelector('.pt-rig.is-top') === document.querySelectorAll('.pt-rig')[1] ? 'f' : 'b');
        const rest = await shootBook(r.page);
        const d = pixelDiff(landed, rest);
        if (process.env.PT_SHOTS) { fs.writeFileSync(path.join(process.env.PT_SHOTS, `landed-${kind}-${lay}-${dir}.png`), landed); fs.writeFileSync(path.join(process.env.PT_SHOTS, `rest-${kind}-${lay}-${dir}.png`), rest); }
        const ok = d.differing === 0 && twinsBefore !== twinsAfter && (await place(r.page)) === landedAt;
        if (!ok) fail++;
        console.log(`${ok ? 'PASS' : 'FAIL'} landing ${engine} ${kind} ${lay} ${dir}: place ${landedAt}, top rig ${twinsBefore} -> ${twinsAfter}, differing pixels ${d.differing} of ${d.pixels} (max delta ${d.max})`);
      }
      if (r.errors.length) { fail++; console.log('page errors', r.errors); }
      await r.browser.close();
    }
  }
  return fail;
}

// ---- place (P8): forward 5, back 2; the saved locator is the visible page's, and its blockIndex is the first
// block on the visible page (what Listen from here starts from).
async function placeMode(env) {
  let fail = 0;
  for (const engine of ENGINES) {
    const r = await openReader(env, engine, env.epubId, { width: 390, height: 844 });
    for (let i = 0; i < 5; i++) { await r.page.keyboard.press('ArrowRight'); await settle(r.page, 150); }
    for (let i = 0; i < 2; i++) { await r.page.keyboard.press('ArrowLeft'); await settle(r.page, 150); }
    await settle(r.page, 3600); // the progress ping is debounced 3 s
    const p = await place(r.page);
    const vis = await r.page.evaluate((selector) => {
      const top = document.querySelector('.pt-rig.is-top');
      const isF = top === document.querySelectorAll('.pt-rig')[1];
      const el = isF ? top.querySelector(':scope > .pt-mask > .pt-inner > .reader-epub-page') : top.querySelector(':scope > .pt-slot > .reader-epub-page');
      const container = el.querySelector('.epub-container'); const iframe = el.querySelector('iframe');
      const box = container.getBoundingClientRect(); const fr = iframe.getBoundingClientRect();
      const blocks = Array.from(iframe.contentDocument.querySelectorAll(selector));
      const on = [];
      blocks.forEach((b, i) => { for (const rc of b.getClientRects()) { const l = fr.left + rc.left; const rr = fr.left + rc.right; if (rr > box.left + 1 && l < box.right - 1) { on.push(i); break; } } });
      return { first: on[0], count: on.length, text: on.length ? blocks[on[0]].textContent.slice(0, 12) : '' };
    }, 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, td');
    const last = r.pings[r.pings.length - 1] || {};
    const loc = last.locator || {};
    const ok = p === '1:3' && loc.kind === 'epub' && loc.blockIndex === vis.first && vis.count > 0 && vis.count < 40;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} place ${engine}: place ${p} (5 forward, 2 back = page 3); last saved ${JSON.stringify(loc)}; visible page's first block ${vis.first} ("${vis.text}"), ${vis.count} blocks on it; pings ${r.pings.length}`);
    await r.browser.close();
  }
  return fail;
}

// ---- reduced (P5): with reduced motion a key turn changes the page inside the key's own task (no frame of
// curl), and a drag past the trigger never folds the page.
async function reduced(env) {
  let fail = 0;
  for (const engine of ENGINES) {
    const r = await openReader(env, engine, env.epubId, { width: 390, height: 844 }, { reducedMotion: 'reduce' });
    const out = await r.page.evaluate(() => new Promise((res) => {
      const pane = document.getElementById('reader-pane'); const before = pane.dataset.ptPlace;
      let frames = 0; const tick = () => { frames++; if (frames < 3) requestAnimationFrame(tick); else res({ before, after: pane.dataset.ptPlace, framesWhenChecked: frames, changedSync }); };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const changedSync = pane.dataset.ptPlace !== before;
      requestAnimationFrame(tick);
    }));
    const box = await bookBox(r.page);
    const before2 = await place(r.page);
    await r.page.mouse.move(box.x + box.w * 0.7, box.y + box.h * 0.7); await r.page.mouse.down();
    // P5: no curl while dragging - neither rig's fold moves at all between the drag's samples.
    const folds = new Set();
    for (let k = 1; k <= 14; k++) {
      await r.page.mouse.move(box.x + box.w * (0.7 - k * 0.025), box.y + box.h * 0.7); await r.page.waitForTimeout(16);
      folds.add(await r.page.evaluate(() => Array.from(document.querySelectorAll('.pt-mask')).map((m) => m.style.transform).join('|')));
    }
    const folded = folds.size > 1;
    await r.page.waitForTimeout(150); await r.page.mouse.up();
    await r.page.waitForTimeout(50);
    const after2 = await place(r.page);
    const ok = out.changedSync && out.before !== out.after && !folded && after2 !== before2;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} reduced ${engine}: key ${out.before} -> ${out.after} (changed inside the key event: ${out.changedSync}); drag 35%: ${before2} -> ${after2}, the leaf folded during the drag: ${folded}`);
    await r.browser.close();
  }
  return fail;
}

// ---- frames: Chromium, phone viewport, 4x CPU throttle, a 40-move drag; from a Chrome trace: main-thread
// task time per frame, and Paint events during the drag.
async function frames(env) {
  let fail = 0;
  // from the right-hand tap zone (the parent document), and from inside the page's text (the chapter frame)
  for (const [kind, id, from, fx] of [['epub', env.epubId, 'tap zone', 0.85], ['epub', env.epubId, 'page text', 0.6], ['pdf', env.pdfId, 'tap zone', 0.85]]) {
    const r = await openReader(env, 'chromium', id, { width: 390, height: 844 });
    const box = await bookBox(r.page);
    const cdp = await r.ctx.newCDPSession(r.page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const x0 = box.x + box.w * fx; const y0 = box.y + box.h * 0.75;
    // frames run from before the press, so what the press and the recognition invalidate is painted before
    // the trace starts; the trace sees the drag itself
    await r.page.evaluate(() => { window.__f = []; const loop = (t) => { window.__f.push(t); window.__raf = requestAnimationFrame(loop); }; window.__raf = requestAnimationFrame(loop); });
    await r.page.mouse.move(x0, y0); await r.page.mouse.down();
    await r.page.mouse.move(x0 - 8, y0); await r.page.waitForTimeout(100); // the drag is recognised; the turn starts
    const events = [];
    cdp.on('Tracing.dataCollected', (e) => { for (const ev of e.value) events.push(ev); });
    const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
    await cdp.send('Tracing.start', { categories: `devtools.timeline,disabled-by-default-devtools.timeline,toplevel${process.env.PT_BREAKDOWN ? ',disabled-by-default-devtools.timeline.invalidationTracking,disabled-by-default-blink.invalidation' : ''}`, transferMode: 'ReportEvents' });
    await r.page.evaluate(() => { window.__f = []; });
    const stepX = (fx - 0.1) * box.w / 40;
    for (let k = 1; k <= 40; k++) { await r.page.mouse.move(x0 - 8 - k * stepX, y0 - k * 0.6); await r.page.waitForTimeout(16); }
    await cdp.send('Tracing.end');
    await done;
    await r.page.mouse.up();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const main = events.filter((e) => e.name === 'thread_name' && e.args && e.args.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`);
    const onMain = (e) => main.includes(`${e.pid}:${e.tid}`);
    // Main-thread WORK: input dispatch, script, style, layout, pre-paint, paint, layerize, commit, hit tests,
    // microtasks, GC - the union of their intervals (nested events never count twice; the IPC wrapper a
    // Playwright mouse move arrives in is not work a finger's input would add).
    const WORK = /^(EventDispatch|FunctionCall|TimerFire|FireAnimationFrame|UpdateLayoutTree|Layout|PrePaint|Paint|Layerize|Commit|HitTest|UpdateLayer|BlinkScheduler_PerformMicrotaskCheckpoint|V8\.GC_SCAVENGER|MinorGC|MajorGC|IntersectionObserverController::computeIntersections|ParseHTML|EvaluateScript)$/;
    const iv = events.filter((e) => onMain(e) && e.ph === 'X' && e.dur && WORK.test(e.name)).map((e) => [e.ts, e.ts + e.dur]).sort((x, y) => x[0] - y[0]);
    let busy = 0; let end = -Infinity;
    for (const [a, b] of iv) { if (a > end) { busy += b - a; end = b; } else if (b > end) { busy += b - end; end = b; } }
    busy /= 1000;
    const fr = await r.page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__f; });
    const d = fr.slice(1).map((t, i) => t - fr[i]).sort((x, y) => x - y);
    const pct = (q) => d[Math.min(d.length - 1, Math.floor(q * d.length))];
    const draws = fr.length;
    const paints = events.filter((e) => e.name === 'Paint');
    const moves = events.filter((e) => onMain(e) && e.name === 'EventDispatch' && e.args && e.args.data && /pointermove|mousemove/.test(e.args.data.type)).length;
    const perFrame = busy / Math.max(1, draws);
    if (process.env.PT_BREAKDOWN) {
      const by = {};
      for (const e of events) if (onMain(e) && e.ph === 'X' && e.dur && WORK.test(e.name)) by[e.name] = (by[e.name] || 0) + e.dur / 1000;
      console.log('  main-thread work by event (ms, nested included):', JSON.stringify(Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => [k, +v.toFixed(1)])));
    }
    const ok = perFrame <= 4 && paints.length === 0;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} frames chromium ${kind} from the ${from} (4x CPU throttle, 390x844, 40-move drag): ${draws} animation frames, interval median ${pct(0.5).toFixed(1)} ms / p95 ${pct(0.95).toFixed(1)} ms / max ${d[d.length - 1].toFixed(1)} ms, over 20 ms: ${d.filter((x) => x > 20).length}; main-thread work ${busy.toFixed(1)} ms = ${perFrame.toFixed(2)} ms/frame; Paint events ${paints.length}; move events dispatched ${moves}`);
    if (paints.length && process.env.PT_BREAKDOWN) {
      const t0 = Math.min(...events.filter((e) => onMain(e) && e.name === 'EventDispatch').map((e) => e.ts));
      const ids = [...new Set(paints.map((e) => e.args && e.args.data && e.args.data.nodeId).filter(Boolean))];
      await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      for (const id of ids) {
        try { const n = await cdp.send('DOM.describeNode', { backendNodeId: id }); console.log(`  painted node ${id}: <${n.node.localName} class="${(n.node.attributes || []).join(' ')}">`); } catch (e) { console.log(`  painted node ${id}: ${e.message}`); }
      }
      const inv = events.filter((e) => /Invalidat|invalidat/.test(e.name) && e.args && e.args.data);
      const seen = new Set();
      for (const e of inv) { const k = `${e.name}|${e.args.data.nodeName || ''}|${e.args.data.reason || ''}`; if (seen.has(k)) continue; seen.add(k); console.log(`  invalidation ${((e.ts - t0) / 1000).toFixed(1)} ${k}`); if (seen.size > 25) break; }
      console.log('  paint times (ms after the first traced move):', paints.map((e) => ((e.ts - t0) / 1000).toFixed(1)).join(', '));
      const disp = events.filter((e) => onMain(e) && e.name === 'EventDispatch' && e.args && e.args.data).slice(0, 6).map((e) => `${((e.ts - t0) / 1000).toFixed(1)}:${e.args.data.type}`);
      console.log('  first dispatches:', disp.join(' '));
    }
    if (paints.length) console.log('  paints:', JSON.stringify(paints.slice(0, 5).map((e) => ({ ts: e.ts, dur: e.dur, data: e.args && e.args.data && { frame: e.args.data.frame, nodeId: e.args.data.nodeId, clip: e.args.data.clip } }))));
    await r.browser.close();
  }
  return fail;
}

// ---- csp (P9): a hostile chapter runs nothing; the reader still hears a drag on its text.
async function csp(env) {
  let fail = 0;
  const fsx = require('node:fs');
  const hostile = [
    '<h1>Hostile</h1><script>parent.__pwned = (parent.__pwned || []).concat("inline")</script>'
      + '<img src="nope.png" onerror="parent.__pwned = (parent.__pwned || []).concat(\'onerror\')"/>'
      + '<a id="js" href="javascript:parent.__pwned = (parent.__pwned || []).concat(\'jsurl\')">j</a>'
      + '<svg xmlns="http://www.w3.org/2000/svg"><script>parent.__pwned = (parent.__pwned || []).concat("svg")</script></svg>'
      + '<p onclick="parent.__pwned = (parent.__pwned || []).concat(\'onclick\')">' + Array.from({ length: 30 }, (_, i) => para(9, i)).join('') + '</p>',
    `<h1>Two</h1>${Array.from({ length: 20 }, (_, i) => para(8, i)).join('')}`,
  ];
  const booksDir = path.join(process.env.DATA_DIR, 'books');
  fsx.writeFileSync(path.join(booksDir, 'hostile.epub'), buildEpub({ title: 'Hostile', author: 'X', chapters: hostile }));
  const { scanBooks, booksDb } = env.server;
  await scanBooks();
  const id = Object.values(booksDb.read().items).find((i) => i.title === 'Hostile').id;
  for (const engine of ENGINES) {
    const r = await openReader(env, engine, id, { width: 390, height: 844 });
    await r.page.waitForTimeout(800);
    const frameState = await r.page.evaluate(() => {
      const f = document.querySelector('.pt-rig.is-top iframe') || document.querySelector('.pt-book iframe');
      const d = f.contentDocument;
      const link = d.getElementById('js'); if (link) link.click();
      const p = d.querySelector('p'); if (p) p.click();
      return { sandbox: f.getAttribute('sandbox'), firstHead: d.head.firstElementChild && d.head.firstElementChild.getAttribute('http-equiv'), scripts: d.querySelectorAll('script').length, handlers: Array.from(d.querySelectorAll('*')).filter((el) => Array.from(el.attributes).some((a) => /^on/i.test(a.name))).length };
    });
    await r.page.waitForTimeout(300);
    const pwned = await r.page.evaluate(() => window.__pwned || []);
    const before = await place(r.page);
    const box = await bookBox(r.page);
    await drag(r.page, box, [{ to: 0.45, steps: 18, wait: 16, rest: 150 }]);
    await settle(r.page);
    const after = await place(r.page);
    const ok = pwned.length === 0 && frameState.firstHead === 'Content-Security-Policy' && frameState.scripts === 0 && frameState.handlers === 0 && after !== before;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} csp ${engine}: book code that ran ${JSON.stringify(pwned)}; frame ${JSON.stringify(frameState)}; a drag from the hostile page's text turned it: ${before} -> ${after}`);
    await r.browser.close();
  }
  return fail;
}

async function pickMore(page, title) {
  await page.click('#reader-more-btn');
  await page.waitForSelector('.ui-sheet .ui-row');
  await page.waitForTimeout(700); // the menu ignores a tap right after it opens (the double-tap guard)
  const rows = await page.$$('.ui-sheet .ui-row');
  for (const row of rows) {
    if ((await row.$eval('.ui-row__title', (n) => n.textContent)) === title) { await row.click(); return true; }
  }
  return false;
}
async function pdfscroll(env) {
  let fail = 0;
  for (const engine of ENGINES) {
    const r = await openReader(env, engine, env.pdfId, { width: 390, height: 844 });
    await r.page.keyboard.press('ArrowRight'); await settle(r.page);
    await r.page.keyboard.press('ArrowRight'); await settle(r.page);
    const pagedPct = await r.page.textContent('#reader-percent');
    const picked = await pickMore(r.page, 'Scroll pages');
    await r.page.waitForSelector('#reader-pane.pdf-scroll .reader-pdf-page canvas', { state: 'attached', timeout: 20000 });
    await r.page.waitForTimeout(600);
    const scroll = await r.page.evaluate(() => {
      const pane = document.getElementById('reader-pane');
      const holders = Array.from(pane.querySelectorAll('.reader-pdf-page'));
      const top = pane.scrollTop;
      const at = holders.findIndex((h) => h.offsetTop + h.offsetHeight - top > pane.clientHeight * 0.35) + 1;
      return { pages: holders.length, at, desk: !!pane.querySelector('.pt-desk'), pref: localStorage.getItem('filetube_reader_pdf_layout') };
    });
    await r.page.waitForTimeout(400);
    const back = await pickMore(r.page, 'Turn pages');
    await r.page.waitForFunction(() => { const p = document.getElementById('reader-pane'); return !p.classList.contains('pdf-scroll') && p.dataset.ptPlace && p.querySelector('.pt-desk'); }, null, { timeout: 20000 });
    await settle(r.page);
    const backPct = await r.page.textContent('#reader-percent');
    const pref2 = await r.page.evaluate(() => localStorage.getItem('filetube_reader_pdf_layout'));
    // The scroll column is today's openPdf, kept as-is (P4): it scrolls to the page before the canvases around
    // it have rendered, so it can settle a page early (reported, ROADMAP Planned). The paged reader must come
    // back exactly where the scroll column left the book.
    const pagedAt = Math.round(parseInt(pagedPct, 10) * 12 / 100);
    const backAt = Math.round(parseInt(backPct, 10) * 12 / 100);
    const ok = picked && back && scroll.pages === 12 && (scroll.at === pagedAt || scroll.at === pagedAt - 1) && !scroll.desk && scroll.pref === 'scroll' && pref2 === 'pages' && backAt === scroll.at && r.errors.length === 0;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} pdfscroll ${engine}: paged at ${pagedPct} (page ${pagedAt}), scroll column at page ${scroll.at}${scroll.at === pagedAt ? '' : ' (one early)'}; Scroll pages -> ${JSON.stringify(scroll)}; Turn pages -> ${backPct} (pref ${pref2}); errors ${JSON.stringify(r.errors)}`);
    await r.browser.close();
  }
  return fail;
}

async function visibleText(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.pt-rig.is-top');
    const isF = top === document.querySelectorAll('.pt-rig')[1];
    const el = isF ? top.querySelector(':scope > .pt-mask > .pt-inner > .reader-epub-page') : top.querySelector(':scope > .pt-slot > .reader-epub-page');
    const container = el.querySelector('.epub-container'); const iframe = el.querySelector('iframe');
    const box = container.getBoundingClientRect(); const fr = iframe.getBoundingClientRect();
    for (const b of iframe.contentDocument.querySelectorAll('h1, p')) {
      for (const rc of b.getClientRects()) { const l = fr.left + rc.left; if (l + rc.width > box.left + 1 && l < box.right - 1) return b.textContent.slice(0, 10); }
    }
    return '';
  });
}
async function link(env) {
  let fail = 0;
  const fsx = require('node:fs');
  const chapters = [
    `<h1>Linked</h1><p style="text-align:center"><a id="go" href="ch2.xhtml">Go to part three</a></p>${Array.from({ length: 10 }, (_, i) => para(1, i)).join('')}`,
    `<h1>Part two</h1>${Array.from({ length: 10 }, (_, i) => para(2, i)).join('')}`,
    `<h1>Part three</h1>${Array.from({ length: 22 }, (_, i) => para(3, i)).join('')}`,
  ];
  fsx.writeFileSync(path.join(process.env.DATA_DIR, 'books', 'links.epub'), buildEpub({ title: 'Links', author: 'X', chapters }));
  await env.server.scanBooks();
  const id = Object.values(env.server.booksDb.read().items).find((i) => i.title === 'Links').id;
  for (const engine of ENGINES) {
    const r = await openReader(env, engine, id, { width: 390, height: 844 });
    const before = await place(r.page);
    const at = await r.page.evaluate(() => {
      const top = document.querySelector('.pt-rig.is-top');
      const isF = top === document.querySelectorAll('.pt-rig')[1];
      const el = isF ? top.querySelector(':scope > .pt-mask > .pt-inner > .reader-epub-page') : top.querySelector(':scope > .pt-slot > .reader-epub-page');
      const f = el.querySelector('iframe'); const a = f.contentDocument.getElementById('go');
      const fr = f.getBoundingClientRect(); const rc = a.getBoundingClientRect();
      return { x: fr.left + rc.left + rc.width / 2, y: fr.top + rc.top + rc.height / 2 };
    });
    await r.page.mouse.click(at.x, at.y);
    await r.page.waitForFunction((b) => document.getElementById('reader-pane').dataset.ptPlace !== b, before, { timeout: 10000 }).catch(() => {});
    await settle(r.page, 600);
    const jumped = await place(r.page);
    const shown = await visibleText(r.page);
    await r.page.keyboard.press('ArrowRight'); await settle(r.page, 600);
    const next = await visibleText(r.page);
    const ok = jumped !== before && jumped.endsWith(':0') && shown === 'Part three' && /^c3p/.test(next) && r.errors.length === 0;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} link ${engine}: ${before} -> ${jumped}, shows "${shown}"; the next turn shows "${next}"; errors ${JSON.stringify(r.errors)}`);
    await r.browser.close();
  }
  return fail;
}

if (require.main === module) {
  (async () => {
    const env = await boot();
    const modes = { smoke };
    Object.assign(modes, { trigger, landing, place: placeMode, reduced, frames, csp, pdfscroll, link });
    if (!modes[MODE]) throw new Error(`unknown mode ${MODE}`);
    const fail = await modes[MODE](env);
    console.log(`${MODE}: ${fail ? 'FAIL' : 'PASS'} (${fail} failing)`);
    env.listening.close();
    process.exit(fail ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
