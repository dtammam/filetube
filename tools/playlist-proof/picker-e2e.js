'use strict';
/* global document */
// REAL-BROWSER PROOF (v1.370.0 W4, plan docs/exec-plans/active/2026-10-06-v1370-playlist-picker.md section 5 W4
// falsifier). Not a CI gate.
//   node tools/playlist-proof/picker-e2e.js [repoRoot]
// A seeded fixture library (test/visual/server.js seed) served by a WRITABLE FileTube (this script boots
// server.js itself: the visual fixture server is read-only media) with a FAKE yt-dlp first on PATH that answers
// the flat listing with the VERBATIM T0 output (test/fixtures/ytdlp-playlist) and fails every download (so the
// counts are deterministic). Chromium (desktop 1280x800):
//   1. the download box: Dean's link -> the R1 choice -> "Choose videos" -> the picker (only the linked video
//      ticked) -> tick 2 more -> Download (3) -> ONE chip row for the playlist that settles at "0 of 3
//      downloaded, 3 failed" with Retry;
//   2. the extension's `?pick=` link opened signed out -> the login -> the picker opens;
//   3. the Shortcut (the API token) posts the link -> 202 waiting -> the chip shows "Playlist waiting: choose
//      videos" -> Choose -> the choice -> the picker.
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const { spawn } = require('node:child_process');
const REPO = process.argv[2] || path.join(__dirname, '..', '..');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));
const { seed, freePort } = require(path.join(REPO, 'test/visual/server.js'));
const FIX = path.join(REPO, 'test', 'fixtures', 'ytdlp-playlist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'e2e-token-0123456789abcdef';
const LINK = 'https://www.youtube.com/watch?v=U3P8pUboZ5g&list=PLUtyNbQXMTLg';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-e2e-'));
  const FX = seed(dir);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-e2e-bin-'));
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-e2e-dl-'));
  fs.writeFileSync(path.join(bin, 'yt-dlp'), `#!${process.execPath}
const fs = require('fs'); const path = require('path');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('2026.08.19\\n'); process.exit(0); }
if (argv.includes('--flat-playlist')) {
  const doc = JSON.parse(fs.readFileSync(path.join(${JSON.stringify(FIX)}, 'example-list-PLUtyNbQXMTLg.json'), 'utf8'));
  const v = (f) => { const i = argv.indexOf(f); return i >= 0 ? Number(argv[i + 1]) : null; };
  doc.entries = doc.entries.slice((v('--playlist-start') || 1) - 1, v('--playlist-end') || 200);
  process.stdout.write(JSON.stringify(doc) + '\\n'); process.exit(0);
}
if (argv.includes('--dump-json')) { process.stdout.write(JSON.stringify({ channel: 'kylegordonisgreat' }) + '\\n'); process.exit(0); }
process.stderr.write('ERROR: e2e fake: downloads fail on purpose\\n'); process.exit(1);
`, { mode: 0o755 });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, DATA_DIR: dir, PORT: String(port), TZ: 'UTC', FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: dl, FILETUBE_API_TOKEN: TOKEN },
  });
  for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/login')).ok) break; } catch { /* booting */ } await sleep(200); }
  const browser = await chromium.launch();
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails += 1; };
  const login = async (page) => {
    await page.fill('#login-username, input[name="username"], input[type="text"]', FX.user);
    await page.fill('#login-password, input[name="password"], input[type="password"]', FX.password);
    await page.click('button[type="submit"], .login-submit');
  };
  const pickerState = (page) => page.evaluate(() => {
    const p = document.querySelector('.playlist-picker');
    if (!p) return null;
    const sw = [...p.querySelectorAll('input[type="checkbox"]')];
    return { rows: p.querySelectorAll('.ui-row').length, ticked: sw.filter((s) => s.checked).length, switches: sw.length, status: p.querySelector('.oneoff-status').textContent };
  });
  const chipText = (page) => page.evaluate(() => { const c = document.getElementById('dl-status-chip'); return c ? c.textContent : ''; });
  try {
    // ---- 1. the download box ----
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.goto(base + '/login', { waitUntil: 'networkidle' });
    await login(page);
    await page.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.click('#ytdlp-oneoff-btn');
    await page.fill('input[aria-label="Media URL"]', LINK);
    await sleep(500);
    await page.click('.oneoff-form .ui-btn--primary:has-text("Download")');
    await page.waitForSelector('.ui-sheet .ui-row:has-text("Choose videos")', { timeout: 5000 });
    await sleep(500);
    await page.click('.ui-sheet .ui-row:has-text("Choose videos")');
    await page.waitForSelector('.playlist-picker .ui-row', { timeout: 10000 });
    let st = await pickerState(page);
    ok(st && st.rows === 24 && st.ticked === 1, `1. the picker lists the 24 entries, only the linked video ticked (${JSON.stringify(st)})`);
    await sleep(500);
    const sw = page.locator('.playlist-picker input[type="checkbox"]');
    await sw.nth(2).check(); await sw.nth(3).check();
    st = await pickerState(page);
    ok(st.ticked === 3, '1. three ticked');
    await page.click('.playlist-picker button:has-text("Download (3)")');
    let chip = '';
    for (let i = 0; i < 60; i++) { await sleep(500); chip = await chipText(page); if (/3 failed/.test(chip)) break; }
    ok(/Kyle Gordon Is Everywhere/.test(chip) && /0 of 3 downloaded, 3 failed/.test(chip), `1. ONE chip row for the playlist, counted to the end: "${chip.replace(/\s+/g, ' ').slice(0, 160)}"`);
    const rows = await page.evaluate(() => document.querySelectorAll('#dl-status-chip .dl-status-chip-item').length);
    ok(rows === 1, `1. one row, the per-video children hidden (${rows})`);
    ok(await page.evaluate(() => { const b = document.querySelector('#dl-status-chip .dl-status-chip-retry-btn'); return !!b && !b.hidden; }), '1. Retry offered for the failed ones');
    ok(errs.length === 0, '1. no page errors ' + JSON.stringify(errs));
    await ctx.close();

    // ---- 2. the extension's ?pick= link, signed out ----
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p2 = await ctx2.newPage();
    await p2.goto(base + '/subscriptions?pick=' + encodeURIComponent(LINK), { waitUntil: 'networkidle' });
    ok(/login/.test(p2.url()), '2. signed out: the login page');
    await login(p2);
    await p2.waitForURL((u) => /subscriptions/.test(String(u)), { timeout: 10000 });
    await p2.waitForSelector('.ui-sheet .ui-row:has-text("Choose videos")', { timeout: 10000 }).catch(() => {});
    const asked = await p2.evaluate(() => !!document.querySelector('.ui-sheet .ui-row'));
    ok(asked, '2. after the login the ?pick= survives and asks (R1 choice)');
    if (asked) { await sleep(500); await p2.click('.ui-sheet .ui-row:has-text("Choose videos")'); await p2.waitForSelector('.playlist-picker .ui-row', { timeout: 10000 }); }
    const st2 = await pickerState(p2);
    ok(st2 && st2.rows === 24, '2. the picker opens from the extension link');
    ok(!/pick=/.test(p2.url()), '2. the ?pick= is dropped from the address bar');
    await ctx2.close();

    // ---- 3. the Shortcut ----
    const r = await fetch(base + '/api/ytdlp/download', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FileTube-Token': TOKEN }, body: JSON.stringify({ url: LINK, format: 'video' }) });
    const rb = await r.json();
    ok(r.status === 202 && rb.waiting === true && rb.message === 'Playlist found: open FileTube to choose', '3. the Shortcut gets 202 waiting: ' + JSON.stringify(rb));
    const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p3 = await ctx3.newPage();
    await p3.goto(base + '/login', { waitUntil: 'networkidle' });
    await login(p3);
    await p3.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
    let c3 = '';
    for (let i = 0; i < 30; i++) { await sleep(500); c3 = await chipText(p3); if (/Playlist waiting/.test(c3)) break; }
    ok(/Playlist waiting: choose videos/.test(c3), '3. the chip shows the waiting playlist');
    await p3.evaluate(() => { const chip = document.getElementById('dl-status-chip'); const t = chip && chip.querySelector('button'); if (t) t.click(); });
    await sleep(600);
    await p3.evaluate(() => { const b = document.querySelector('#dl-status-chip .dl-status-chip-choose-btn:not([hidden])'); if (b) b.click(); });
    await p3.waitForSelector('.ui-sheet .ui-row:has-text("Choose videos")', { timeout: 10000 }).catch(() => {});
    await sleep(500);
    await p3.click('.ui-sheet .ui-row:has-text("Choose videos")').catch(() => {});
    await p3.waitForSelector('.playlist-picker .ui-row', { timeout: 10000 }).catch(() => {});
    const st3 = await pickerState(p3);
    const selects = await p3.evaluate(() => [...document.querySelectorAll('.playlist-picker select')].map((s) => s.getAttribute('aria-label')));
    ok(st3 && st3.rows === 24 && selects.join() === 'Format,Quality,File type', `3. Choose -> the picker, with the box's three controls (${JSON.stringify(st3)} ${selects})`);
    await ctx3.close();
  } finally {
    await browser.close();
    child.kill('SIGTERM');
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
