'use strict';
/* global document, window, getComputedStyle */
// v1.381.0 Feed, TikTok style (plan docs/exec-plans/active/2026-10-09-feed-tiktok.md, W1 + W2): the MEASURED layout.
// Boots the real server on a real library with one item of every card kind (a reading book, an unstarted book with a
// cover and a description, a landscape video and a portrait video in progress with thumbnails, a podcast episode with
// show art, a liked song), opens /feed in a real browser at 390 x 844 and 320 x 568 (DPR 3, touch), walks the real
// stack card by card and reads back, per card: the rects of the card, the kind line, the title, the HUD (ring, time,
// Done), the media layer, the overlay; every element inside the card that SCROLLS (scrollHeight > clientHeight with
// overflow auto / scroll: the D6 "no scroll trap" count); text that overflows the card; the HUD's overlap with the
// title and the overlay. W1: on Home the other-device card shows (a real ping from another device), in the Feed it and
// the download chip are display:none, and back on Home the card is shown again. Screenshots of each card go to outDir.
//
//   node tools/feed-proof/layout.js <repoRoot> <outDir> [chromium|webkit|both] [390x844,320x568]
// Not a CI gate: a proof tool (like tools/feed-proof/card-player.js).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT_DIR = path.resolve(process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'ft-feed-layout-')));
const ENGINES = (process.argv[4] || 'chromium') === 'both' ? ['chromium', 'webkit'] : [process.argv[4] || 'chromium'];
const VIEWPORTS = (process.argv[5] || '390x844,320x568').split(',').map((v) => { const [w, h] = v.split('x').map(Number); return { w, h }; });
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedlayout-'));
process.env.PROGRESS_FLUSH_MS = '50';
fs.mkdirSync(OUT_DIR, { recursive: true });

const { seed, seedUser } = require('./fixture');
const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));

// Everything the plan's section 7 asks for, read in the page for the ACTIVE card.
function measureInPage() {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const overlap = (a, b) => (a && b ? Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) : 0);
  const card = document.querySelector('.feed-card[data-active]');
  if (!card) return null;
  const q = (s) => card.querySelector(s);
  const cardR = R(card);
  const scrollers = [];
  const spills = [];
  // the blurred backdrop is scaled past the card on purpose (the blur's soft edge) and clipped by the media layer
  card.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) scrollers.push({ cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className), scrollH: el.scrollHeight, clientH: el.clientHeight });
    const r = R(el);
    if (r && cs.visibility !== 'hidden' && !el.classList.contains('feed-card__backdrop') && (r.y + r.h > cardR.y + cardR.h + 1 || r.y < cardR.y - 1) && !el.closest('[hidden]')) spills.push({ cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 40), tag: el.tagName, r });
  });
  const title = q('.feed-card__title');
  const lh = title ? parseFloat(getComputedStyle(title).lineHeight) : 0;
  const hud = document.getElementById('feed-hud');
  const overlay = q('.feed-card__overlay');
  const media = q('.feed-card__media') || q('.feed-card__slot') || q('.feed-card__art') || q('.feed-card__poster');
  const host = document.getElementById('player-wrapper');
  const video = document.getElementById('media-player');
  const out = {
    kind: card.getAttribute('data-kind') + (card.hasAttribute('data-new-book') ? ':new' : '') + (card.hasAttribute('data-portrait') ? ':portrait' : ''),
    card: cardR,
    kindLine: R(q('.feed-card__kind')),
    title: R(title),
    titleLines: title && lh ? Math.round(title.getBoundingClientRect().height / lh) : null,
    titleClipped: title ? title.scrollHeight > title.clientHeight + 1 : null,
    meta: R(q('.feed-card__meta')),
    hud: R(hud), ring: R(document.getElementById('feed-ring-btn')), done: R(document.getElementById('feed-done-btn')),
    overlay: R(overlay),
    media: R(media),
    art: R(q('.feed-card__art')), poster: R(q('.feed-card__poster')), slot: R(q('.feed-card__slot')), cover: R(q('.feed-card__cover')),
    text: R(q('.feed-card__text:not(.feed-card__taste)')), desc: R(q('.feed-card__desc')), actions: R(q('.feed-card__actions')),
    host: host && card.contains(host) ? R(host) : null,
    video: video && card.contains(video) ? Object.assign(R(video) || {}, { fit: getComputedStyle(video).objectFit, vw: video.videoWidth, vh: video.videoHeight }) : null,
    controlsVisible: host && card.contains(host) ? Array.from(host.querySelectorAll('.player-controls, .controls-bar, .player-bar')).some((c) => { const r = c.getBoundingClientRect(); return r.height > 0 && getComputedStyle(c).visibility !== 'hidden' && getComputedStyle(c).opacity !== '0'; }) : null,
    // a classic (non-overlay) scrollbar on the stack narrows every card by its width (desktop engines; iOS overlays it)
    stackScrollbar: (() => { const st = document.getElementById('feed-stack'); return st ? st.offsetWidth - st.clientWidth : null; })(),
    scrollers,
    spills: spills.slice(0, 8),
    spillCount: spills.length,
  };
  out.hudOverTitle = overlap(out.hud, out.title);
  out.hudOverKind = overlap(out.hud, out.kindLine);
  out.hudOverOverlay = overlap(out.hud, out.overlay);
  out.hudOverText = overlap(out.hud, out.text);
  return out;
}

async function main() {
  const server = require(path.join(REPO, 'server.js'));
  const { app, __mintTestSession } = server;
  const helper = await pw.chromium.launch();
  const fx = await seed(server, helper, REPO);
  await helper.close();
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listening.address().port}`;
  const { cookie, user } = __mintTestSession();
  seedUser(server, user, fx);
  const results = [];

  for (const engine of ENGINES) {
    for (const vp of VIEWPORTS) {
      const browser = await pw[engine].launch({ args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 3, isMobile: engine === 'chromium', hasTouch: true });
      await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1].split(';')[0], url: base }]);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e && e.message)));
      const tag = `${engine}-${vp.w}x${vp.h}`;

      // W1: another device is watching the landscape clip (a real progress ping with a device identity)
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await page.evaluate(async () => { await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'land1', timestamp: 7, duration: 60, deviceId: 'probe-other-phone', deviceLabel: 'Kitchen iPad' }) }); });
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => { const c = document.getElementById('handoff-card'); return c && !c.hidden; }, null, { timeout: 15000 }).catch(() => {});
      const chipOn = () => { if (typeof window.injectDownloadStatusChip === 'function') window.injectDownloadStatusChip(); const c = document.getElementById('dl-status-chip'); if (c) c.hidden = false; return !!c; };
      await page.evaluate(chipOn);
      await page.waitForTimeout(300);
      const disp = () => ({ handoff: (() => { const c = document.getElementById('handoff-card'); return c ? (c.hidden ? 'hidden-attr' : getComputedStyle(c).display) : 'absent'; })(), chip: (() => { const c = document.getElementById('dl-status-chip'); return c ? (c.hidden ? 'hidden-attr' : getComputedStyle(c).display) : 'absent'; })(), view: document.body.getAttribute('data-view') });
      const w1Home = await page.evaluate(disp);
      await page.evaluate(() => window.FileTube.navigate('/feed'));
      await page.waitForSelector('#feed-picker-choices button[data-minutes="10"]', { timeout: 15000 });
      await page.evaluate(chipOn);
      const w1Feed = await page.evaluate(disp);

      await page.click('#feed-picker-choices button[data-minutes="10"]');
      await page.waitForSelector('.feed-card[data-active]', { timeout: 15000 });
      const cards = [];
      const seen = new Set();
      for (let i = 0; i < 14 && seen.size < 6; i++) {
        const has = await page.evaluate((n) => { const c = document.querySelectorAll('.feed-card')[n]; if (!c) return false; c.scrollIntoView({ block: 'start' }); return true; }, i);
        if (!has) { await page.waitForTimeout(800); const again = await page.evaluate((n) => !!document.querySelectorAll('.feed-card')[n], i); if (!again) break; await page.evaluate((n) => document.querySelectorAll('.feed-card')[n].scrollIntoView({ block: 'start' }), i); }
        await page.waitForFunction((n) => { const c = document.querySelectorAll('.feed-card')[n]; return c && c.hasAttribute('data-active'); }, i, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1800);
        const m = await page.evaluate(measureInPage);
        if (!m || m.kind === 'notice') continue;
        const key = m.kind;
        if (seen.has(key)) continue;
        seen.add(key);
        const shot = path.join(OUT_DIR, `${tag}-${key.replace(/:/g, '-')}.png`);
        await page.screenshot({ path: shot });
        cards.push(Object.assign({ shot: path.basename(shot) }, m));
      }
      await page.evaluate(() => window.FileTube.navigate('/'));
      await page.waitForFunction(() => document.body.getAttribute('data-view') === 'home', null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
      const w1Back = await page.evaluate(disp);
      await browser.close();
      const w1 = { home: w1Home, feed: w1Feed, back: w1Back };
      const row = { engine, viewport: `${vp.w}x${vp.h}`, w1, cards, errors };
      results.push(row);
      console.log(`== ${tag} W1 home=${JSON.stringify(w1Home)} feed=${JSON.stringify(w1Feed)} back=${JSON.stringify(w1Back)}${errors.length ? ' errors=' + JSON.stringify(errors) : ''}`);
      for (const c of cards) {
        console.log(`  ${c.kind.padEnd(16)} card=${JSON.stringify(c.card)} title=${JSON.stringify(c.title)} lines=${c.titleLines} hud=${JSON.stringify(c.hud)} hudOverTitle=${c.hudOverTitle} hudOverText=${c.hudOverText} overlay=${JSON.stringify(c.overlay)} media=${JSON.stringify(c.media)} art=${JSON.stringify(c.art)} poster=${JSON.stringify(c.poster)} host=${JSON.stringify(c.host)} video=${JSON.stringify(c.video)} controls=${c.controlsVisible} sb=${c.stackScrollbar} scrollers=${c.scrollers.length}${c.scrollers.length ? JSON.stringify(c.scrollers) : ''} spills=${c.spillCount}`);
      }
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'layout.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const kinds = results.map((r) => r.cards.length);
  console.log(`SUMMARY layout: ${results.length} runs, cards per run ${JSON.stringify(kinds)}, scrollers ${results.reduce((n, r) => n + r.cards.reduce((m, c) => m + c.scrollers.length, 0), 0)}, hudOverTitle>0 ${results.reduce((n, r) => n + r.cards.filter((c) => c.hudOverTitle > 0).length, 0)}, out ${OUT_DIR}`);
  listening.closeAllConnections?.();
  await new Promise((resolve) => listening.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(2); });
