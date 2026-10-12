#!/usr/bin/env node
'use strict';
/* global window, document, requestAnimationFrame, getComputedStyle */
// v1.387.0 offline playback (plan D6): MEASURE the offline pills and badges on a phone at 320 and 390 px wide, in the
// real browser engine against the real CSS (Dean's rule: rows wrap, buttons never shrink). Boots the visual-suite server
// (seeded), signs in, injects a fake native host that announces `downloads` and answers the subscription with a snapshot,
// then on each real page builds the shipped markup through the page's OWN builders (tv.js, music.js, main.js) and the
// offline module's decorate(), and reads boxes back:
//   - every offline pill (.tv-offline, .music-drill-offline): its height equals the page's other small pills, its width is
//     at least its own scrollWidth (the label is never squeezed or clipped), it sits inside its row / pill row;
//   - every row that carries a pill: its title is not clipped by the pill (the title box ends before the pill starts, or
//     the row wrapped - its height grew past a single line);
//   - no horizontal page overflow at either width;
//   - the "Offline" badge on a card and on rows: inside its text block, no overflow.
// Prints one line per measurement and a PASS / FAIL summary; exits 1 on any failure. Numbers quoted in the plan's evidence
// come from THIS run (LESSONS 1: copied from an instrument, never typed).
//
//   node tools/offline-proof/row-probe.js            # 320x568 and 390x844, light, 2021
//   node tools/offline-proof/row-probe.js --json out.json

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const capture = require('../../test/visual/capture.js');
const { seed, boot } = require('../../test/visual/server.js');
const { newGuardedContext } = require('../capture/request-policy.js');

const SIZES = [[320, 568], [390, 844]];

// The fake host: `downloads` announced; the subscription answered with a snapshot that marks the first episode and the
// first two tracks done, one episode downloading at 40%, so every badge / pill state is on screen at once.
function hostInit() {
  window.__ftPosts = [];
  window.FileTubeHost = {
    bridge: 1, app: { name: 'filetube-ios', version: '0.9.0', build: '1' }, platform: 'ios',
    capabilities: ['orientation', 'haptics', 'battery', 'serverSettings', 'statusBar', 'network', 'downloads'],
    post(msg) {
      window.__ftPosts.push(msg);
      if (msg && msg.type === 'downloads.subscribe') {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('filetube-host', { detail: { v: 1, type: 'downloadsSnapshot', items: window.__ftSnapshot || [] } }));
        }, 0);
      }
    },
  };
}

async function measurePage(page, build) {
  await page.addStyleTag({ content: capture.FREEZE_CSS });
  await page.evaluate(build);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const out = { overflow: document.documentElement.scrollWidth > window.innerWidth, pills: [], rows: [], badges: [] };
    // a VISIBLE small pill that is not ours (the TV page's own small pill, #tv-back's sibling, is hidden: 0 px)
    const ref = [...document.querySelectorAll('.ui-btn--sm.ui-btn--pill:not(.tv-offline):not(.music-drill-offline)')].find((el) => el.getBoundingClientRect().height > 0);
    out.refPillHeight = ref ? Math.round(ref.getBoundingClientRect().height) : null;
    const lineHeightOf = (el) => parseFloat(getComputedStyle(el).lineHeight) || 0;
    for (const pill of document.querySelectorAll('.tv-offline, .music-drill-offline')) {
      const b = pill.getBoundingClientRect();
      const label = pill.querySelector('.ui-btn__label');
      const lb = label ? label.getBoundingClientRect() : b;
      const row = pill.closest('.tv-episode, .music-drill-actions, .tv-season-label');
      const rb = row ? row.getBoundingClientRect() : null;
      out.pills.push({
        cls: pill.className.replace(/ui-btn[^ ]*/g, '').trim(), text: pill.textContent.trim(),
        w: Math.round(b.width), h: Math.round(b.height), scrollW: pill.scrollWidth, labelW: Math.round(lb.width), labelScrollW: label ? label.scrollWidth : null,
        insideRow: rb ? (b.left >= rb.left - 0.5 && b.right <= rb.right + 0.5 && b.top >= rb.top - 0.5 && b.bottom <= rb.bottom + 0.5) : null,
        rowH: rb ? Math.round(rb.height) : null,
      });
    }
    for (const row of document.querySelectorAll('.tv-episode')) {
      const title = row.querySelector('.ui-row__title');
      const pill = row.querySelector('.tv-offline');
      if (!title || !pill) continue;
      const tb = title.getBoundingClientRect(); const pb = pill.getBoundingClientRect(); const rb = row.getBoundingClientRect();
      out.rows.push({ text: title.textContent.trim(), rowH: Math.round(rb.height), titleRight: Math.round(tb.right), pillLeft: Math.round(pb.left), titleClipped: title.scrollWidth > title.clientWidth + 1, wrapped: rb.height > lineHeightOf(title) * 2.2 });
    }
    for (const badge of document.querySelectorAll('.offline-badge')) {
      const b = badge.getBoundingClientRect();
      const box = badge.closest('.card-text, .ui-row__body');
      const bb = box ? box.getBoundingClientRect() : null;
      out.badges.push({ text: badge.textContent.trim(), w: Math.round(b.width), h: Math.round(b.height), inside: bb ? (b.left >= bb.left - 0.5 && b.right <= bb.right + 0.5) : null, clipped: badge.scrollWidth > badge.clientWidth + 1 });
    }
    return out;
  });
}

// The pages: what each one builds from its own builders (evaluated in the page).
const BUILDS = {
  tv: () => {
    const detail = { id: 'probe-show', name: 'A Show With A Long Name For The Probe', seasons: [
      { seasonNum: 1, label: 'Season 1', episodes: [
        { id: 'probe-e1', title: 'A short title', seasonNum: 1, episodeNum: 1, durationSec: 1500 },
        { id: 'probe-e2', title: 'An episode title that is long enough to wrap on a narrow phone screen', seasonNum: 1, episodeNum: 2, durationSec: 2700 },
        { id: 'probe-e3', title: 'Third', seasonNum: 1, episodeNum: 3, durationSec: 100 },
      ] },
      { seasonNum: null, label: 'Extras', episodes: [{ id: 'probe-ex', title: 'Making of', seasonNum: null, episodeNum: null, durationSec: 600 }] },
    ] };
    const off = window.FileTube.offline;
    const content = document.getElementById('tv-content') || document.getElementById('view-root');
    content.innerHTML = window.buildShowDetailHtml ? window.buildShowDetailHtml(detail, { offline: (k, id) => off.menuEntry(k, id) }) : '<p>no builder</p>';
    off.decorate(content);
  },
  music: () => {
    const tracks = [
      { id: 'probe-t1', title: 'Mother', album: 'The Wall', albumArtist: 'Pink Floyd', artist: 'Pink Floyd', trackNo: 1, durationSec: 300 },
      { id: 'probe-t2', title: 'Hey You', album: 'The Wall', albumArtist: 'Pink Floyd', artist: 'Pink Floyd', trackNo: 2, durationSec: 280 },
    ];
    const drill = { type: 'album', key: 'Pink Floyd\u001fThe Wall', label: 'The Wall' };
    const off = window.FileTube.offline;
    const content = document.getElementById('music-content') || document.getElementById('view-root');
    content.innerHTML = '<div class="music-drill">' + window.buildDrillHeaderHtml(drill, tracks, { canEditChapters: true, offline: off.menuEntry('album', drill.key) })
      + '<div class="ui-list ui-list--media ui-list--media-art music-song-list" role="list">' + tracks.map((t, i) => window.buildSongRowHtml(t, i, { trackNumbers: true })).join('') + '</div></div>';
    off.decorate(content);
  },
  home: () => {
    const off = window.FileTube.offline;
    const grid = document.getElementById('video-grid') || document.getElementById('view-root');
    const items = [{ id: 'probe-v1', title: 'A card whose title is long enough to take two lines on a phone', duration: 600, hasThumbnail: false, kind: 'media' }, { id: 'probe-v2', title: 'Short', duration: 60, hasThumbnail: false, kind: 'media' }];
    grid.innerHTML = '';
    for (const it of items) grid.appendChild(window.buildVideoCardEl(it, { doc: document, href: '/watch.html?v=' + it.id, channelName: 'Probe', avatar: null }));
    off.decorate(grid);
  },
};
const SNAPSHOT = [
  { kind: 'tvEpisode', id: 'probe-e1', state: 'done', localSrc: 'filetube-local://e1', parentKind: 'tvSeason', parentId: 'probe-show:1' },
  { kind: 'tvEpisode', id: 'probe-e2', state: 'downloading', progress: 0.4, parentKind: 'tvSeason', parentId: 'probe-show:1' },
  { kind: 'track', id: 'probe-t1', state: 'done', localSrc: 'filetube-local://t1', parentKind: 'album', parentId: 'Pink Floyd\u001fThe Wall' },
  { kind: 'track', id: 'probe-t2', state: 'done', localSrc: 'filetube-local://t2', parentKind: 'album', parentId: 'Pink Floyd\u001fThe Wall' },
  { kind: 'video', id: 'probe-v1', state: 'done', localSrc: 'filetube-local://v1' },
  { kind: 'video', id: 'probe-v2', state: 'downloading', progress: 0.7 },
];

async function main() {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-offline-probe-'));
  const FX = seed(data);
  const srv = await boot(data, {});
  const browser = await capture.playwright().chromium.launch({ args: capture.LAUNCH_ARGS });
  const record = capture.newRecord(srv.base);
  const results = [];
  let failures = 0;
  try {
    const st = await capture.login(browser, srv.base, FX, record);
    const phone = capture.viewports(2).phone;
    for (const [w, h] of SIZES) {
      let refPill = null; // the music page's own small pills set the reference height for the whole width
      for (const [pageKey, pathname, ready] of [['music', '/music', '#view-root'], ['tv', '/tv', '#view-root'], ['home', '/', '#video-grid']]) {
        const ctx = await newGuardedContext(browser, { ...phone, viewport: { width: w, height: h }, ...capture.CONTEXT_PINS, storageState: st, reducedMotion: 'reduce' }, record, { scene: 'offline-probe:' + pageKey + ':' + w });
        await ctx.addInitScript(hostInit);
        await ctx.addInitScript((snap) => { window.__ftSnapshot = snap; }, SNAPSHOT);
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
        try {
          await page.goto(srv.base + pathname, { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForSelector(ready, { state: 'attached', timeout: 15000 });
          await page.waitForFunction(() => window.FileTube && window.FileTube.offline && window.FileTube.offline.enabled && window.FileTube.offline.state('tvEpisode', 'probe-e1').state === 'done', null, { timeout: 10000 });
          const m = await measurePage(page, BUILDS[pageKey]);
          if (m.refPillHeight !== null) refPill = m.refPillHeight; else m.refPillHeight = refPill;
          const fails = [];
          if (m.overflow) fails.push('horizontal page overflow');
          for (const p of m.pills) {
            if (m.refPillHeight !== null && Math.abs(p.h - m.refPillHeight) > 1) fails.push(`pill "${p.text}" height ${p.h} != the page's small pills ${m.refPillHeight} (shrunk)`);
            if (p.w + 1 < p.scrollW) fails.push(`pill "${p.text}" squeezed: width ${p.w} < scroll ${p.scrollW}`);
            if (p.labelScrollW !== null && p.labelW + 1 < p.labelScrollW) fails.push(`pill "${p.text}" label clipped`);
            if (p.insideRow === false) fails.push(`pill "${p.text}" outside its row`);
          }
          for (const r of m.rows) {
            if (r.titleClipped) fails.push(`row "${r.text.slice(0, 20)}" title clipped by the pill`);
            if (!r.wrapped && r.titleRight > r.pillLeft) fails.push(`row "${r.text.slice(0, 20)}" title under the pill without wrapping`);
          }
          for (const b of m.badges) {
            if (b.clipped) fails.push(`badge "${b.text}" clipped`);
            if (b.inside === false) fails.push(`badge "${b.text}" outside its text block`);
          }
          if (errors.length) fails.push('pageerror: ' + errors.join(' | '));
          failures += fails.length;
          results.push({ page: pageKey, width: w, measured: m, failures: fails });
          console.log(`${pageKey} @ ${w}: ${m.pills.length} pills (ref small-pill height ${m.refPillHeight}), ${m.rows.length} pill rows, ${m.badges.length} badges, overflow=${m.overflow}` + (fails.length ? `\n  FAIL ${fails.join('\n  FAIL ')}` : ' PASS'));
          for (const p of m.pills) console.log(`    pill ${p.cls} "${p.text}" ${p.w}x${p.h} (scroll ${p.scrollW}) row h ${p.rowH}`);
          for (const r of m.rows) console.log(`    row "${r.text.slice(0, 32)}" h ${r.rowH} title.right ${r.titleRight} pill.left ${r.pillLeft} wrapped=${r.wrapped} clipped=${r.titleClipped}`);
          for (const b of m.badges) console.log(`    badge "${b.text}" ${b.w}x${b.h} inside=${b.inside} clipped=${b.clipped}`);
        } catch (e) {
          failures += 1;
          results.push({ page: pageKey, width: w, failures: ['did not load: ' + String(e).split('\n')[0]] });
          console.log(`${pageKey} @ ${w}: FAIL did not load: ${String(e).split('\n')[0]}`);
        } finally { await ctx.close(); }
      }
    }
  } finally {
    await browser.close();
    await srv.stop();
    fs.rmSync(data, { recursive: true, force: true });
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
  console.log(failures ? `FAIL: ${failures} finding(s)` : 'PASS: every pill keeps its size, every row wraps or clears it, no overflow');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
