#!/usr/bin/env node
'use strict';
// Playwright driver for the Tier 3 capture manifest. Usage:
//   BASE_URL=http://host:3000 node capture.js [--out DIR] [--only 06,16]
//   [--fixture-video <mediaId>] [--fixture-book <bookId>]
// One dated output directory; filenames = <sceneId>-<era>-<mode>-<viewport>.png.
// EMULATED baselines (recorded in run-record.json): device-pixel-ratio 2,
// animations/transitions frozen at end-state via injected CSS, era/mode set
// through localStorage before load. Scenes in scenes.notAutomatable are
// listed in the run record for Dean's manual pass.
const fs = require('node:fs');
const path = require('node:path');
const { VIEWPORTS, ERAS_P1, scenes, p2EraSpotChecks, p3, notAutomatable } = require('./scenes.js');
const { guardContext } = require('./request-policy.js');

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const BASE = process.env.BASE_URL || arg('--base', 'http://127.0.0.1:3000');
const OUT = arg('--out', `captures-${new Date().toISOString().slice(0, 10)}`);
const ONLY = arg('--only', '') ? arg('--only', '').split(',') : null;
const FIXTURE_VIDEO = arg('--fixture-video', '');
const FIXTURE_BOOK = arg('--fixture-book', '');
// Credentials (Dean's ruling 3): NEVER on argv - shell history and the
// process table leak it. FILETUBE_CAPTURE_AUTH=user:pass, or an
// interactive hidden prompt. No CLI fallback exists on purpose.
const LOGIN = process.env.FILETUBE_CAPTURE_AUTH || '';
async function promptLogin() {
  const readline = require('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (t, mute) => new Promise((res) => {
    if (mute) {
      process.stdout.write(t);
      const rl2 = readline.createInterface({ input: process.stdin, output: undefined, terminal: true });
      rl2.question('', (a) => { rl2.close(); process.stdout.write('\n'); res(a); });
    } else rl.question(t, res);
  });
  const user = await q('capture login user: ');
  const pass = await q('capture login password (hidden): ', true);
  rl.close();
  return user + ':' + pass;
}

const FREEZE_CSS = `*,*::before,*::after{transition:none!important;animation-play-state:paused!important;animation-delay:-0.01s!important;caret-color:transparent!important}`;

async function runScene(browser, scene, era, mode, vpName, record) {
  const vp = VIEWPORTS[vpName];
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, reducedMotion: 'reduce', storageState: record.storageState });
  await guardContext(ctx, (b) => record.blockedRequests.push({ scene: scene.id, era, mode, viewport: vpName, ...b }));
  const page = await ctx.newPage();
  const fname = `${scene.id}-${era}-${mode}-${vpName}.png`;
  try {
    await page.addInitScript(([e, m]) => {
      localStorage.setItem('ft-era', e); localStorage.setItem('ft-mode', m);
    }, [era, mode]);
    let url = BASE + scene.path.replace('FIXTURE_VIDEO', FIXTURE_VIDEO).replace('FIXTURE_BOOK', FIXTURE_BOOK);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.addStyleTag({ content: FREEZE_CSS });
    for (const [op, target] of scene.actions) {
      if (op === 'wait') await page.waitForSelector(target.split(',')[0] + (target.includes(',') ? ', ' + target.split(',').slice(1).join(',') : ''), { timeout: 12000 });
      // Full selector LISTS pass through: Playwright resolves CSS unions
      // natively (the login click below has always relied on this). The old
      // split(',')[0] silently DROPPED every fallback selector - bucket-E of
      // the 2026-07-30 baseline run (2014 stats has no <footer>, and the
      // .stats-meta-text fallback never got a chance).
      else if (op === 'click') await page.click(target, { timeout: 8000 });
      else if (op === 'hover') { if (vpName === 'desktop' || !scene.hoverDesktopOnly) await page.hover(target); }
      else if (op === 'scrollTo') await page.locator(target).first().scrollIntoViewIfNeeded();
      else if (op === 'setViewportWidth') await page.setViewportSize({ width: Number(target), height: vp.height });
      else if (op === 'evalJs') await page.evaluate(target);
    }
    await page.waitForTimeout(350); // settle fonts/layout post-freeze
    await page.screenshot({ path: path.join(OUT, fname), fullPage: false });
    record.captured.push(fname);
  } catch (err) {
    record.failed.push({ scene: fname, error: String(err).slice(0, 200) });
  } finally {
    await ctx.close();
  }
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { console.error('playwright not installed - run: cd tools/capture && npm install && npx playwright install chromium'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const record = { base: BASE, date: new Date().toISOString(), emulated: true, blockedRequests: [],
    determinism: 'animations frozen at end-state; DPR 2; era/mode via localStorage; content pinned via --fixture-video/--fixture-book',
    manualScenes: notAutomatable, captured: [], failed: [] };
  const browser = await chromium.launch();
  // Auth: log in once, persist storageState for every scene context.
  const loginPair = LOGIN || (process.stdin.isTTY ? await promptLogin() : '');
  if (loginPair) {
    const [user, pass] = loginPair.split(':');
    const ctx = await browser.newContext();
    await guardContext(ctx, (b) => record.blockedRequests.push({ scene: 'login', ...b }));
    const page = await ctx.newPage();
    await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
    await page.fill('#login-username, input[name="username"], input[type="text"]', user);
    await page.fill('#login-password, input[name="password"], input[type="password"]', pass);
    await page.click('button[type="submit"], .login-submit');
    await page.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
    record.storageState = await ctx.storageState();
    await ctx.close();
    record.login = 'session established (state held in memory only)';
  }
  for (const scene of scenes) {
    if (ONLY && !ONLY.some((o) => scene.id.startsWith(o))) continue;
    for (const [era, mode] of ERAS_P1) {
      // scene.viewports restricts the matrix (e.g. phone-only sheets that
      // have no desktop rendering); default remains every viewport.
      for (const vpName of (scene.viewports || Object.keys(VIEWPORTS))) await runScene(browser, scene, era, mode, vpName, record);
    }
  }
  for (const [era, mode] of p2EraSpotChecks.eras) {
    for (const id of p2EraSpotChecks.sceneIds) {
      const scene = scenes.find((s) => s.id === id);
      if (scene && (!ONLY || ONLY.some((o) => id.startsWith(o)))) await runScene(browser, scene, era, mode, p2EraSpotChecks.viewport, record);
    }
  }
  for (const scene of p3) {
    if (ONLY && !ONLY.some((o) => scene.id.startsWith(o))) continue;
    for (const [era, mode] of scene.eras) await runScene(browser, scene, era, mode, 'desktop', record);
  }
  await browser.close();
  delete record.storageState; // session cookie never lands in the record
  fs.writeFileSync(path.join(OUT, 'run-record.json'), JSON.stringify(record, null, 1));
  console.log(`captured ${record.captured.length}, failed ${record.failed.length}, blocked mutating requests ${record.blockedRequests.length} -> ${OUT}/`);
  for (const f of record.failed) console.log('  FAIL', f.scene, f.error);
  for (const b of record.blockedRequests) console.log('  BLOCKED', b.scene, b.method, b.url);
  // A scene that ATTEMPTS a mutation is a broken scene: the guard makes it
  // harmless, and this exit makes it impossible to miss.
  process.exit(record.failed.length || record.blockedRequests.length ? 1 : 0);
})();
