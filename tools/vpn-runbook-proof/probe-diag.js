'use strict';
/* global window, document */
// v1.362.1 W3: every label, scenario, probe, matrix row and button the VPN runbook names, read off the REAL
// /diag page and the real Settings page in headless Chromium (iPhone 13), with FT_DIAG=1 on a throwaway server.
// Arms two runs (the LAN chip and the 5G + VPN chip), fires the three probes, tags scenarios in an app tab,
// stops and saves, views one run and compares two.
//   node tools/vpn-runbook-proof/probe-diag.js out.json [screenshot-dir]
const fs = require('node:fs');
const path = require('node:path');
process.env.FT_DIAG = '1';
const { start } = require('../minimize-proof/serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const txt = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.textContent.replace(/\s+/g, ' ').trim());

(async () => {
  const out = { runAt: new Date().toISOString() };
  const shots = process.argv[3] || null;
  const s = await start({ seconds: 30 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true }));
    await ctx.addCookies([s.cookie]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));

    // Settings: the section names and the switches the runbook names
    await p.goto(s.base + '/setup.html', { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    out.settings = await p.evaluate(() => {
      const lab = (id) => { const l = document.querySelector('label[for="' + id + '"]'); return l ? l.textContent.trim() : null; };
      const sec = (id) => { const i = document.getElementById(id); const d = i && i.closest('details'); const sm = d && d.querySelector('summary'); return sm ? sm.textContent.trim() : null; };
      const btn = document.getElementById('perf-diag-open-btn');
      return {
        perfDiag: { label: lab('perf-diag-check'), section: sec('perf-diag-check'), checked: document.getElementById('perf-diag-check').checked },
        openButton: btn ? { text: btn.textContent.trim(), hidden: btn.hidden, href: btn.getAttribute('href') } : null,
        bgAudioSync: { label: lab('bg-audio-sync-check'), section: sec('bg-audio-sync-check') },
        lifecycleLog: { label: lab('debug-lifecycle-check'), section: sec('debug-lifecycle-check') },
      };
    });

    // /diag itself
    await p.goto(s.base + '/diag', { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    if (shots) await p.screenshot({ path: path.join(shots, 'diag-idle.png'), fullPage: true });
    out.diag = await p.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1').textContent.trim(),
      back: document.getElementById('diag-back').textContent.trim(),
      status: document.getElementById('status').textContent.trim(),
      sections: Array.from(document.querySelectorAll('h2')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      fieldLabels: Array.from(document.querySelectorAll('label')).map((e) => e.textContent.trim()),
      chips: Array.from(document.querySelectorAll('.chips button')).map((b) => ({ text: b.textContent.trim(), fills: b.getAttribute('data-label') })),
      buttons: Array.from(document.querySelectorAll('button[id]')).map((b) => ({ id: b.id, text: b.textContent.trim(), disabled: b.disabled })),
      scenarios: Array.from(document.querySelectorAll('#scenarios li')).map((li) => ({ title: li.querySelector('strong').textContent, desc: li.querySelector('small').textContent, button: li.querySelector('button').textContent, disabled: li.querySelector('button').disabled })),
      probeIdle: document.getElementById('probeResults').textContent.trim(),
      hints: Array.from(document.querySelectorAll('.hint')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      compareHint: document.querySelector('#compareBtn + .muted') ? document.querySelector('#compareBtn + .muted').textContent.trim() : null,
    }));

    async function oneRun(chipText) {
      await p.click('.chips button:text-is("' + chipText + '")');
      const label = await p.inputValue('#label');
      await p.click('#startBtn');
      await p.waitForTimeout(300);
      const armed = await p.evaluate(() => ({ status: document.getElementById('status').textContent.replace(/\s+/g, ' ').trim(), scenarioButtons: Array.from(document.querySelectorAll('#scenarios button')).map((b) => b.disabled) }));
      // the app tab: cold load Home with a scenario tagged, then open a video
      await p.click('#scenarios li:nth-child(1) button');
      const app = await ctx.newPage();
      await app.goto(s.base + '/', { waitUntil: 'networkidle' });
      await app.waitForTimeout(800);
      const badge = await app.evaluate(() => { const b = Array.from(document.body.querySelectorAll('div')).find((d) => /^REC/.test(d.textContent || '')); return b ? b.textContent : null; });
      await p.click('#scenarios li:nth-child(4) button');
      await app.evaluate(() => window.FileTube.navigate('/watch.html?v=clip1'));
      await app.waitForTimeout(2500);
      await app.close();
      const scenarioActive = await p.evaluate(() => txt('#scenarios li.on strong'), null).catch(() => null);
      for (const [id, done] of [['#probeRtt', 'RTT done.'], ['#probeThroughput', 'Throughput done.'], ['#probeCompression', 'Compression done.']]) {
        await p.click(id);
        await p.waitForFunction((d) => document.getElementById('probeStatus').textContent === d, done, { timeout: 60000 });
      }
      const probes = await p.evaluate(() => document.getElementById('probeResults').textContent.replace(/\s+/g, ' ').trim());
      await p.click('#stopBtn');
      await p.waitForFunction(() => /^Saved run |^Save failed/.test(document.getElementById('probeStatus').textContent), null, { timeout: 30000 });
      await p.waitForTimeout(600);
      const saved = await p.evaluate(() => document.getElementById('probeStatus').textContent);
      return { chip: chipText, label, armed, appBadge: badge, scenarioActive, probes, saved };
    }
    await p.exposeFunction('noop', () => {});
    await p.evaluate(() => { window.txt = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.textContent.replace(/\s+/g, ' ').trim()); });
    out.run1 = await oneRun('LAN');
    out.matrixSingle = await p.evaluate(() => ({
      headers: Array.from(document.querySelectorAll('#matrix table:first-of-type th')).map((e) => e.textContent.trim()),
      rows: Array.from(document.querySelectorAll('#matrix table:first-of-type tr')).slice(1).map((tr) => Array.from(tr.children).map((td) => td.textContent.replace(/\s+/g, ' ').trim())),
      detailHeaders: Array.from(document.querySelectorAll('#matrix table:nth-of-type(2) th')).map((e) => e.textContent.trim()),
      detailRows: Array.from(document.querySelectorAll('#matrix table:nth-of-type(2) tr')).slice(1).map((tr) => Array.from(tr.children).map((td) => td.textContent.replace(/\s+/g, ' ').trim())),
      runsList: Array.from(document.querySelectorAll('#runs li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
    }));
    if (shots) await p.screenshot({ path: path.join(shots, 'diag-one-run.png'), fullPage: true });
    out.run2 = await oneRun('5G + VPN');
    await p.evaluate(() => { for (const cb of document.querySelectorAll('#runs input[type=checkbox]')) { cb.checked = true; cb.dispatchEvent(new Event('change')); } });
    out.compareEnabled = await p.evaluate(() => !document.getElementById('compareBtn').disabled);
    await p.click('#compareBtn');
    await p.waitForTimeout(1200);
    out.matrixCompare = await p.evaluate(() => ({
      headers: Array.from(document.querySelectorAll('#matrix table:first-of-type th')).map((e) => e.textContent.trim()),
      rows: Array.from(document.querySelectorAll('#matrix table:first-of-type tr')).slice(1).map((tr) => Array.from(tr.children).map((td) => td.textContent.replace(/\s+/g, ' ').trim())),
      runsList: Array.from(document.querySelectorAll('#runs li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
    }));
    if (shots) await p.screenshot({ path: path.join(shots, 'diag-compare.png'), fullPage: true });
    // the saved files and the API
    const dataDir = process.env.DATA_DIR;
    out.savedFiles = fs.existsSync(path.join(dataDir, '.diag')) ? fs.readdirSync(path.join(dataDir, '.diag')) : [];
    const id = (out.run1.saved.match(/Saved run (\S+)/) || [])[1];
    out.apiRun = id ? await p.evaluate(async (rid) => { const r = await fetch('/api/diag/runs/' + rid); const j = await r.json(); return { status: r.status, keys: Object.keys(j), label: j.label }; }, id) : null;
    out.serverTiming = await p.evaluate(async () => (await fetch('/api/diag/ping')).headers.get('Server-Timing'));
    out.errs = errs;
    await ctx.close();
  } catch (e) { out.error = String(e.stack || e); }
  await browser.close(); await s.stop();
  fs.writeFileSync(process.argv[2] || 'probe-diag.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})();
