#!/usr/bin/env node
'use strict';
// UI professionalism pass, sweep S2 (cards and feeds): the rendered geometry the
// converted locks can only describe (home-mobile-scale, v1264-skeleton-states,
// shimmer-tranche2 - plan triage class (c)). Against a running seeded instance,
// in a phone (390x844) and a desktop (1440x900) context:
//   G-toolbar  the library toolbar is ONE line: every direct part of
//              .section-actions shares one row (tops within 1px), and the page
//              never scrolls sideways (documentElement.scrollWidth <= innerWidth);
//   G-grid     the phone grid is exactly 2 columns at <= 480px wide;
//   G-card     one kebab per card, its hit box >= 44x44 (the ui-btn --hit), and
//              it never overlaps the card's thumbnail;
//   G-skeleton a skeleton card (buildSkeletonCardEl) has the SAME thumb box and
//              info height as a real two-line-title card (zero-shift reveal, D9);
//   G-rail     on the watch page, a related skeleton card's thumb box equals the
//              real card's (desktop only; the rail sits under the player on a phone);
//   G-menu     the card menu opens and its rows are >= 44px tall on the phone.
// Read-only: every context comes from tools/capture/request-policy.js newGuardedContext.
//
//   node test/visual/seed.js --data DIR
//   test/visual/start-server.sh DIR PORT &
//   node test/geometry/library-toolbar.check.js --base http://127.0.0.1:PORT [--data DIR]
//
// Exit 0 = every check holds; 1 = a check failed (listed); 2 = the run itself broke.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CAP = path.resolve(__dirname, '..', '..', 'tools', 'capture');
const { chromium } = require(path.join(CAP, 'node_modules', 'playwright'));
const { newGuardedContext } = require(path.join(CAP, 'request-policy.js'));

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const BASE = (arg('--base', process.env.BASE_URL || 'http://127.0.0.1:3917')).replace(/\/$/, '');
const DATA = path.resolve(arg('--data', process.env.VISUAL_DATA_DIR || path.join(os.tmpdir(), 'filetube-visual-data')));
const FX = JSON.parse(fs.readFileSync(path.join(DATA, 'fixtures.json'), 'utf8'));

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CONTEXTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS_UA },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const PAGES = ['/', '/?folder=' + encodeURIComponent('Harbor Workshop'), '/?search=Harbor'];

async function login(browser, record) {
  const ctx = await newGuardedContext(browser, {}, record, { scene: 'login' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-username, input[name="username"], input[type="text"]', FX.user);
  await page.fill('#login-password, input[name="password"], input[type="password"]', FX.password);
  await page.click('button[type="submit"], .login-submit');
  await page.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
  const st = await ctx.storageState();
  await ctx.close();
  return st;
}

(async () => {
  const record = { captured: [], failed: [], blockedRequests: [], blockedExpected: [], imageWait: [], rotation: [] };
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const failures = [];
  const rows = [];
  try {
    const st = await login(browser, record);
    for (const [ctxName, opts] of Object.entries(CONTEXTS)) {
      for (const url of PAGES) {
        const ctx = await newGuardedContext(browser, { ...opts, storageState: st, reducedMotion: 'reduce' }, record, { scene: 'library-toolbar' });
        const page = await ctx.newPage();
        await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForSelector('#video-grid .video-card:not(.skeleton-card)', { timeout: 12000 });
        const m = await page.evaluate(() => {
          const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
          const bar = document.querySelector('.section-actions');
          const parts = Array.from(bar.children).filter((c) => !c.hidden && c.getBoundingClientRect().height > 0).map(r);
          const cards = Array.from(document.querySelectorAll('#video-grid .video-card:not(.skeleton-card)'));
          const lefts = Array.from(new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left))));
          const card = cards[0];
          const kebab = card.querySelector('.card-kebab');
          const hit = window.getComputedStyle(kebab, '::before');
          const thumb = card.querySelector('.card-media .ui-thumb');
          // A skeleton card built by the page's own builder, measured in the same grid.
          const host = document.getElementById('video-grid');
          const wrap = document.createElement('div');
          wrap.innerHTML = window.buildSkeletonGrid ? window.buildSkeletonGrid(1, { avatar: !!card.querySelector('.video-info > .ui-avatar'), typeLine: !!card.querySelector('.card-type') }) : '';
          const sk = wrap.firstElementChild;
          if (sk) host.insertBefore(sk, card);
          const skThumb = sk ? r(sk.querySelector('.ui-thumb')) : null;
          const skInfo = sk ? r(sk.querySelector('.video-info')) : null;
          if (sk) sk.remove();
          // the real card with a TWO-line title (the skeleton reserves the clamp maximum)
          const twoLine = cards.find((c) => { const t = c.querySelector('.video-title'); return t && t.getClientRects().length && t.getBoundingClientRect().height > parseFloat(getComputedStyle(t).lineHeight) * 1.5; }) || card;
          return {
            partTops: parts.map((p) => Math.round(p.y)), partBottoms: parts.map((p) => Math.round(p.y + p.h)),
            scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
            cols: lefts.length, kebab: r(kebab), hitW: parseFloat(hit.width), hitH: parseFloat(hit.height), thumb: r(thumb),
            kebabCount: card.querySelectorAll('button').length,
            skThumb, skInfo, realThumb: r(twoLine.querySelector('.ui-thumb')), realInfo: r(twoLine.querySelector('.video-info')),
            twoLineFound: twoLine !== card || !!twoLine,
          };
        });
        const tag = `${ctxName} ${url}`;
        const topSpread = Math.max(...m.partTops) - Math.min(...m.partTops);
        rows.push(`${tag}\ttoolbar parts=${m.partTops.length} top-spread=${topSpread}px\tscrollW=${m.scrollW}/${m.innerW}\tcols=${m.cols}\tkebab-hit=${m.hitW}x${m.hitH}\tskeleton thumb ${m.skThumb && m.skThumb.w.toFixed(1)}x${m.skThumb && m.skThumb.h.toFixed(1)} vs ${m.realThumb.w.toFixed(1)}x${m.realThumb.h.toFixed(1)}, info h ${m.skInfo && m.skInfo.h.toFixed(1)} vs ${m.realInfo.h.toFixed(1)}`);
        if (topSpread > 1) failures.push(`${tag}: the toolbar is not one line (tops ${m.partTops.join(',')})`);
        if (m.scrollW > m.innerW) failures.push(`${tag}: horizontal overflow ${m.scrollW} > ${m.innerW}`);
        if (ctxName === 'phone' && m.cols !== 2) failures.push(`${tag}: the phone grid has ${m.cols} columns (want 2)`);
        if (m.kebabCount !== 1) failures.push(`${tag}: ${m.kebabCount} buttons on a card (want the one kebab)`);
        if (!(m.hitW >= 44 && m.hitH >= 44)) failures.push(`${tag}: kebab hit ${m.hitW}x${m.hitH} < 44`);
        if (m.kebab.y < m.thumb.y + m.thumb.h) failures.push(`${tag}: the kebab overlaps the thumbnail`);
        if (!m.skThumb) failures.push(`${tag}: window.buildSkeletonGrid unavailable`);
        else {
          if (Math.abs(m.skThumb.w - m.realThumb.w) > 0.5 || Math.abs(m.skThumb.h - m.realThumb.h) > 0.5) failures.push(`${tag}: skeleton thumb ${m.skThumb.w}x${m.skThumb.h} != real ${m.realThumb.w}x${m.realThumb.h}`);
          if (Math.abs(m.skInfo.h - m.realInfo.h) > 1) failures.push(`${tag}: skeleton info height ${m.skInfo.h} != real two-line card ${m.realInfo.h}`);
        }
        if (url === '/' && ctxName === 'phone') {
          await page.click('#video-grid .video-card .card-kebab');
          await page.waitForSelector('.ui-sheet.is-open .ui-row', { timeout: 5000 });
          const heights = await page.evaluate(() => Array.from(document.querySelectorAll('.ui-sheet.is-open .ui-row')).map((r) => r.getBoundingClientRect().height));
          rows.push(`${tag}\tmenu rows ${heights.map((h) => h.toFixed(0)).join(',')}`);
          if (!heights.length || heights.some((h) => h < 44)) failures.push(`${tag}: a menu row under 44px (${heights.join(',')})`);
        }
        await ctx.close();
      }
    }
    // G-rail (desktop): the related rail's skeleton vs real thumb.
    const ctx = await newGuardedContext(browser, { ...CONTEXTS.desktop, storageState: st, reducedMotion: 'reduce' }, record, { scene: 'library-toolbar' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/watch.html?v=${FX.video}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForSelector('#related-files-container a.related-card', { timeout: 12000 });
    const rail = await page.evaluate(() => {
      const c = document.getElementById('related-files-container');
      const real = c.querySelector('a.related-card');
      const tmp = document.createElement('div');
      tmp.innerHTML = window.buildRelatedSkeletonCards ? window.buildRelatedSkeletonCards(1) : '';
      const sk = tmp.firstElementChild;
      if (!sk) return null;
      c.insertBefore(sk, real);
      const a = sk.querySelector('.ui-thumb').getBoundingClientRect();
      const b = real.querySelector('.ui-thumb').getBoundingClientRect();
      sk.remove();
      return { sk: [a.width, a.height], real: [b.width, b.height] };
    });
    await ctx.close();
    if (!rail) failures.push('rail: window.buildRelatedSkeletonCards unavailable');
    else {
      rows.push(`desktop rail\tskeleton thumb ${rail.sk.map((n) => n.toFixed(1)).join('x')} vs real ${rail.real.map((n) => n.toFixed(1)).join('x')}`);
      if (Math.abs(rail.sk[0] - rail.real[0]) > 0.5 || Math.abs(rail.sk[1] - rail.real[1]) > 0.5) failures.push('rail: the skeleton thumb box differs from the real one');
    }
  } finally {
    await browser.close();
  }
  console.log(rows.join('\n'));
  if (record.blockedRequests.length) failures.push(`unexpected blocked requests: ${record.blockedRequests.length}`);
  if (failures.length) {
    console.log(`\nlibrary-toolbar: FAIL (${failures.length})\n  ` + failures.join('\n  '));
    process.exit(1);
  }
  console.log('\nlibrary-toolbar: PASS');
})().catch((e) => { console.error(e); process.exit(2); });
