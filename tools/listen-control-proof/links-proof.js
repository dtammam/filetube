'use strict';
/* global window, document, MutationObserver */
// END-TO-END PROOF (v1.352 L1/L3): bookmarkable links against the REAL server and a seeded library
// (three songs of "Proof Album" by "Proof Band"). Autoplay is allowed here (a kiosk-style launch), so
// "plays" is observable; the click rule is W2's. Not a CI gate.
//   node tools/listen-control-proof/links-proof.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function main() {
  const srv = await start({ seconds: 400 });
  // L1 needs a VIDEO (the watch page sends an audio item over to Music): the same tone file, typed video
  const server = require('../../server');
  const vidPath = path.join(srv.dataDir, 'ytdlp', 'Proof Band', 'vid1.wav');
  fs.copyFileSync(path.join(srv.dataDir, 'ytdlp', 'Proof Band', 'song1.wav'), vidPath);
  await server.updateDatabase((db) => {
    db.metadata.vid1 = { id: 'vid1', type: 'video', title: 'Proof Video', name: 'vid1.wav', filePath: vidPath, rootFolder: path.join(srv.dataDir, 'ytdlp'),
      folderName: 'Proof Band', channelName: 'Proof Band', duration: 400, hasThumbnail: false, ext: '.wav', addedAt: 1788000000100 };
    return true;
  });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const out = {};
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([srv.cookie]);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.base });
  // every toast text, as it appears (a toast is gone again within seconds)
  await ctx.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { const t = n.textContent || ''; if (/Could not|Link copied/.test(t)) window.__toasts.push(t.trim()); })))
      .observe(document, { childList: true, subtree: true });
  });
  const page = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); return p; };
  const snap = (p) => p.evaluate(() => { const pl = window.FileTube.player; const s = pl.getRemoteSnapshot(); return { id: s.id, playing: s.playing, t: Math.round(s.position * 10) / 10 }; });
  const waitPlaying = (p, ms) => p.waitForFunction(() => { const s = window.FileTube.player.getRemoteSnapshot(); return s.playing && s.id; }, null, { timeout: ms || 10000 }).then(() => true, () => false);
  const path0 = (p) => p.evaluate(() => window.location.pathname + window.location.search);
  const stateUrl = (p) => p.evaluate(() => window.history.state && window.history.state.url);

  // ---- L1: a saved position at 300 s; &t=30 starts at 30, no t resumes near 300 ----
  {
    const p = await page();
    await p.goto(srv.base + '/', { waitUntil: 'load' });
    out.l1_saved = await p.evaluate(async () => (await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'vid1', timestamp: 300, duration: 400 }) })).status);
    await p.goto(srv.base + '/watch.html?v=vid1&t=30', { waitUntil: 'load' });
    out.l1_landed = await path0(p);
    await waitPlaying(p);
    await p.waitForTimeout(500);
    out.l1_with_t = await snap(p);
    out.l1_with_t_toast = await p.evaluate(() => /Resumed at/.test(document.body.innerText));
    out.l1_url_keeps_t = await path0(p);
    await p.close();
    const q = await page();
    await q.goto(srv.base + '/', { waitUntil: 'load' });
    out.l1_resaved = await q.evaluate(async () => (await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'vid1', timestamp: 300, duration: 400 }) })).status);
    await q.goto(srv.base + '/watch.html?v=vid1', { waitUntil: 'load' });
    await waitPlaying(q);
    await q.waitForTimeout(500);
    out.l1_without_t = await snap(q);
    // adopt: the same video already playing, then an in-app nav to it with a new t
    await q.evaluate(() => window.FileTube.navigate('/watch.html?v=vid1&t=1m30s'));
    await q.waitForTimeout(1500);
    out.l1_adopt_1m30s = await snap(q);
    await q.close();
  }

  // ---- L3 ----
  const album = '/music?artist=Proof%20Band&album=Proof%20Album';
  {
    const p = await page();
    await p.goto(srv.base + album, { waitUntil: 'load' });
    await p.waitForSelector('.music-drill-title', { timeout: 8000 }).catch(() => null);
    await p.waitForTimeout(800);
    out.l3_open_album_title = await p.evaluate(() => { const e = document.querySelector('.music-drill-title'); return e && e.textContent; });
    out.l3_open_album_rows = await p.evaluate(() => document.querySelectorAll('.music-song-row').length);
    out.l3_open_album_plays = (await snap(p)).playing;
    out.l3_open_album_url = await path0(p);
    // Copy link on the drill: the clipboard holds the album link
    out.l3_copy_pill = await p.evaluate(() => { const b = document.querySelector('.music-drill-copylink'); return b && b.getAttribute('data-link'); });
    await p.click('.music-drill-copylink');
    await p.waitForTimeout(400);
    out.l3_clipboard = (await p.evaluate(() => navigator.clipboard.readText())).replace(srv.base, '<origin>');
    out.l3_copy_toast = await p.evaluate(() => /Link copied/.test(document.body.innerText));
    await p.close();
  }
  for (const [name, url] of [['play', album + '&mode=play'], ['shuffle', album + '&mode=shuffle'], ['shuffle_all', '/music?mode=shuffle'], ['liked_shuffle_empty', '/music?playlist=liked&mode=shuffle']]) {
    const p = await page();
    await p.goto(srv.base + url, { waitUntil: 'load' });
    const played = await waitPlaying(p, name === 'liked_shuffle_empty' ? 3000 : 10000);
    const s = await snap(p);
    out['l3_' + name] = { played, id: s.id, url: await path0(p), stateUrl: await stateUrl(p), toast: await p.evaluate(() => window.__toasts.filter((t) => /Could not/.test(t))[0] || null) };
    if (name === 'shuffle_all') {
      await p.reload({ waitUntil: 'load' });
      await p.waitForTimeout(1500);
      out.l3_shuffle_all_after_reload = { url: await path0(p), playing: (await snap(p)).playing };
    }
    await p.close();
  }
  {
    // like song2, then the Liked playlist plays it; a not-found artist toasts and shows Music
    const p = await page();
    await p.goto(srv.base + '/music', { waitUntil: 'load' });
    out.l3_like = await p.evaluate(async () => (await fetch('/api/liked/song2', { method: 'POST' })).status);
    await p.goto(srv.base + '/music?playlist=liked&mode=play', { waitUntil: 'load' });
    await waitPlaying(p);
    out.l3_liked_play = await snap(p);
    await p.goto(srv.base + '/music?artist=Nobody%20Here', { waitUntil: 'load' });
    await p.waitForTimeout(800);
    out.l3_not_found_toast = await p.evaluate(() => window.__toasts.filter((t) => /Could not/.test(t))[0] || null);
    out.l3_not_found_drill = await p.evaluate(() => !!document.querySelector('.music-drill-title'));
    // precedence: play=<id> wins over an album link with a mode
    await p.goto(srv.base + '/music?play=song3&artist=Proof%20Band&album=Proof%20Album&mode=play', { waitUntil: 'load' });
    await waitPlaying(p);
    await p.waitForTimeout(800);
    out.l3_precedence_play = (await snap(p)).id;
    await p.close();
  }
  out.errors = errs;
  await browser.close();
  await srv.stop();
  const file = process.argv[2] || path.join(__dirname, 'links-proof-out.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
