'use strict';
// Determinism regression for the capture harness (2026-07-31: the field
// determinism gate failed 34/89 because networkidle fires BEFORE lazy
// images start fetching - paint state was a coin flip). This test builds
// the race deliberately: a page of in-viewport loading="lazy" images
// served with a fixed 500ms delay. Arm 1 proves the race EXISTS without
// the gate (so the test can never pass vacuously); arm 2 proves
// settlePageImages closes it - all images decoded, and two fresh
// captures byte-identical. Also binds the volatile-text mask: the exact
// VOLATILE_MASK_CSS the driver injects hides the live-text glyphs while
// preserving the layout box.
//
// Skips cleanly where the isolated tools/capture package is absent.

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { settlePageImages, VOLATILE_MASK_CSS } = require('../../tools/capture/settle.js');

let chromium = null;
try {
  ({ chromium } = require('../../tools/capture/node_modules/playwright'));
} catch { /* not installed here - skip below */ }

// 1x1 PNG (red) - decodes instantly once delivered.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

function slowImageServer() {
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/img/')) {
      // Fixed delay: long enough that the 350ms settle floor has long
      // passed before these ever arrive.
      setTimeout(() => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); }, 500);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    // The FIELD mechanism, modeled faithfully: the page is quiet at load
    // (networkidle fires on an imageless document), then an SPA-style
    // render inserts lazy images AFTER idle - which then race any fixed
    // screenshot delay.
    res.end(`<html><body style="margin:0">
      <div class="sub-list-header-status" style="height:20px">last check: LIVE-TEXT-${Date.now()}</div>
      <div id="grid"></div>
      <script>
        setTimeout(() => {
          document.getElementById('grid').innerHTML = Array.from({ length: 12 }, (_, i) =>
            '<img loading="lazy" src="/img/' + i + '" width="40" height="40" style="background:#ccc">').join('');
        }, 700);
      </script></body></html>`);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

test('image-quiescence gate: the lazy race exists without it, dies with it, and two captures are byte-identical', { skip: !chromium && 'tools/capture playwright not installed' }, async (t) => {
  const srv = await slowImageServer();
  const base = `http://127.0.0.1:${srv.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    await new Promise((r) => srv.close(r));
    t.skip(`chromium not launchable: ${e.message.slice(0, 60)}`);
    return;
  }
  try {
    // Arm 1 - the race is REAL: networkidle resolves on the imageless
    // document, then the SPA render inserts images that are NOT done (if
    // this ever fails, the fixture no longer models the bug and the whole
    // test is vacuous - fix the fixture).
    const p1 = await browser.newPage();
    await p1.goto(base + '/', { waitUntil: 'networkidle', timeout: 20000 });
    await p1.waitForFunction(() => document.images.length > 0, null, { timeout: 5000 });
    const before = await p1.evaluate(() => Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).length);
    assert.ok(before > 0, `expected undecoded post-idle images, got ${before} - the fixture no longer reproduces the race`);
    // ...and the gate settles them all.
    const settled = await settlePageImages(p1);
    assert.strictEqual(settled.pending, 0, JSON.stringify(settled));
    assert.strictEqual(settled.outcome, 'settled');
    await p1.close();

    // Arm 2 - determinism: two FRESH loads, gate applied, byte-identical
    // shots (the live-text line is masked by the exact driver CSS; its
    // box must keep its height so layout cannot shift).
    const shots = [];
    for (let i = 0; i < 2; i++) {
      const p = await browser.newPage();
      await p.goto(base + '/', { waitUntil: 'networkidle', timeout: 20000 });
      await p.addStyleTag({ content: VOLATILE_MASK_CSS });
      await p.waitForFunction(() => document.images.length > 0, null, { timeout: 5000 });
      const s = await settlePageImages(p);
      assert.strictEqual(s.pending, 0);
      assert.strictEqual(s.total, 12);
      const h = await p.evaluate(() => document.querySelector('.sub-list-header-status').offsetHeight);
      assert.strictEqual(h, 20, 'mask must preserve the layout box (visibility, not display)');
      await p.waitForTimeout(100);
      shots.push(await p.screenshot());
      await p.close();
    }
    assert.ok(shots[0].equals(shots[1]), `two gated captures differ (${shots[0].length} vs ${shots[1].length} bytes) - the LIVE-TEXT line or an image raced through`);
  } finally {
    await browser.close();
    await new Promise((r) => srv.close(r));
  }
});

test('driver binding: capture.js gates images and injects the mask before every screenshot', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../tools/capture/capture.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const settleIdx = code.indexOf('settlePageImages(page)');
  const shotIdx = code.indexOf('page.screenshot(');
  assert.ok(settleIdx > -1, 'capture.js must call settlePageImages');
  assert.ok(shotIdx > settleIdx, 'the image gate must run BEFORE the screenshot');
  assert.ok(code.includes('FREEZE_CSS + VOLATILE_MASK_CSS'), 'the volatile mask must ride the freeze-CSS injection');
  assert.ok(code.includes('imageWaitPending'), 'a gate timeout must be recorded, not swallowed');
});
