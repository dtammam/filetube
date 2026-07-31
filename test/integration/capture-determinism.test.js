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
//
// BINDING: the causally-chained late batches bind the STRUCTURAL
// mutants - first-stable return (the field-bug shape) dies on the chain
// itself, and a fixed N-observation cap (the round-2 regression) dies on
// the N+1th hop (the reviewer proved a 3-hop chain lets a 3-cap mutant
// through; hence four hops). What genuinely remains timing-arbitrated is
// only the quiet-window DURATION (450 vs 400ms) - the field's
// back-to-back gate owns that. Each chained hop lands 250ms after the
// prior batch's last image load, provably inside any quiet window that
// opened after that batch settled (250 < quietMs 450).

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
  let reqCount = 0;
  const srv = http.createServer((req, res) => {
    if (req.url === '/img/broken') {
      // Instantly 404s: an already-errored image must fast-path, never
      // hang a pass or raise the alarm (gate W1 - a stably-broken image
      // is perfectly deterministic).
      res.writeHead(404); res.end(); return;
    }
    if (req.url === '/img/hang') {
      // Never responds - for the timeout-contract test only.
      return;
    }
    if (req.url.startsWith('/img/')) {
      // Fixed delay: long enough that the 350ms settle floor has long
      // passed before these ever arrive.
      setTimeout(() => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); }, 500);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    // The FIELD mechanism, modeled faithfully: the page is quiet at load
    // (networkidle fires on an imageless document), then an SPA-style
    // render inserts lazy images AFTER idle in TWO batches (the second
    // lands while the first is still settling - binds the multi-pass
    // loop, gate N5), plus one broken image (W1) and one genuinely
    // BELOW-FOLD lazy image behind a 40000px spacer that Chromium will
    // never fetch without the eager flip (gate N6 - the reviewer's own
    // binding fixture).
    // The status text VARIES IN LENGTH per load (word count keyed to
    // request order) and has NO fixed height: without the one-line clamp
    // it wraps to a different line count between loads and reflows
    // everything below - the field's 10.31% failure shape.
    reqCount++;
    res.end(`<html><body style="margin:0;width:300px">
      <div class="sub-list-header-status">last check ${'word '.repeat(5 + (reqCount % 2) * 40)}</div>
      <div style="height:20px">Added <span id="added-date-text">LIVE-${Date.now()}</span> &bull; static</div>
      <div id="grid"></div><div id="grid2"></div><div id="grid3"></div>
      <div style="height:40000px"></div>
      <img id="deep" loading="lazy" src="/img/deep" width="40" height="40">
      <script>
        setTimeout(() => {
          document.getElementById('grid').innerHTML = Array.from({ length: 6 }, (_, i) =>
            '<img loading="lazy" src="/img/' + i + '" width="40" height="40" style="background:#ccc">').join('') +
            '<img src="/img/broken" width="40" height="40">';
        }, 700);
        setTimeout(() => {
          document.getElementById('grid2').innerHTML = Array.from({ length: 6 }, (_, i) =>
            '<img loading="lazy" src="/img/b' + i + '" width="40" height="40" style="background:#eee">').join('');
          // The LATE async render (field round 2), CAUSALLY CHAINED: it
          // inserts 250ms after batch 2's last image loads - guaranteed
          // BEFORE any quiet window that started after batch 2 settled
          // can complete (250 < quietMs), so convergence deterministically
          // sees it. A wall-clock delay here raced the quiet window and
          // made this very test flake - the same class it guards against.
          const imgs2 = document.getElementById('grid2').querySelectorAll('img');
          imgs2[imgs2.length - 1].addEventListener('load', () => {
            setTimeout(() => {
              document.getElementById('grid3').innerHTML = Array.from({ length: 4 }, (_, i) =>
                '<img loading="lazy" src="/img/c' + i + '" width="40" height="40" style="background:#ddd">').join('');
              // Batch 4, chained one hop deeper (gate FINDING 1): a fixed
              // N-observation cap is only caught by a chain N+1 deep - the
              // 3-hop fixture let a fixed-3-cap mutant (the round-2
              // regression itself) return early with a green suite.
              const imgs3 = document.getElementById('grid3').querySelectorAll('img');
              imgs3[imgs3.length - 1].addEventListener('load', () => {
                setTimeout(() => {
                  const d = document.createElement('div');
                  d.innerHTML = Array.from({ length: 3 }, (_, i) =>
                    '<img loading="lazy" src="/img/d' + i + '" width="40" height="40" style="background:#bbb">').join('');
                  document.body.insertBefore(d, document.getElementById('grid3').nextSibling);
                }, 250);
              }, { once: true });
            }, 250);
          }, { once: true });
        }, 1100);
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
    await p1.waitForFunction(() => document.images.length > 1, null, { timeout: 5000 });
    const before = await p1.evaluate(() => Array.from(document.images).filter((i) => !i.complete).length);
    assert.ok(before > 0, `expected in-flight post-idle images, got ${before} - the fixture no longer reproduces the race`);
    // The deep below-fold lazy image must NOT have been fetched yet - if
    // Chromium starts fetching it unflipped, the N6 fixture is dead and
    // the eager-flip is no longer bound.
    const deepBefore = await p1.evaluate(() => { const d = document.getElementById('deep'); return { complete: d.complete, w: d.naturalWidth }; });
    assert.strictEqual(deepBefore.complete && deepBefore.w > 0, false, 'deep lazy image fetched WITHOUT the flip - fixture no longer binds N6');
    // ...and the gate settles everything - both insertion batches (the
    // second lands mid-settle: multi-pass), the deep image (eager flip),
    // and the broken image (fast-path, no hang, no alarm) - FAST.
    const t0 = Date.now();
    const settled = await settlePageImages(p1);
    const elapsed = Date.now() - t0;
    assert.strictEqual(settled.pending, 0, JSON.stringify(settled));
    assert.strictEqual(settled.stable, true, JSON.stringify(settled));
    assert.strictEqual(settled.total, 21, 'all FOUR chained batches + deep + broken must be present post-settle - a fixed observation cap of N misses the N+1th hop');
    assert.strictEqual(settled.errored, 1, 'the broken image is counted as errored, not pending');
    assert.ok(elapsed < 10000, `settle took ${elapsed}ms - the broken image is hanging an observation (gate W1)`);
    const deepAfter = await p1.evaluate(() => { const d = document.getElementById('deep'); return d.complete && d.naturalWidth > 0; });
    assert.strictEqual(deepAfter, true, 'the eager flip must fetch the below-fold lazy image');
    await p1.close();

    // Timeout CONTRACT: a genuinely hanging image reports pending>0 and
    // outcome timeout within the budget - the alarm the driver records.
    const ph = await browser.newPage();
    // domcontentloaded, not load: the hanging image blocks 'load' forever
    // by construction.
    await ph.setContent('<img src="' + base + '/img/hang" width="10" height="10">', { waitUntil: 'domcontentloaded' });
    const hung = await settlePageImages(ph, 800);
    assert.strictEqual(hung.stable, false);
    assert.ok(hung.pending > 0);
    await ph.close();

    // Arm 2 - determinism: two FRESH loads, gate applied, byte-identical
    // shots (the live-text line is masked by the exact driver CSS; its
    // box must keep its height so layout cannot shift).
    const shots = [];
    const heights = [];
    for (let i = 0; i < 2; i++) {
      const p = await browser.newPage();
      await p.goto(base + '/', { waitUntil: 'networkidle', timeout: 20000 });
      await p.addStyleTag({ content: VOLATILE_MASK_CSS });
      await p.waitForFunction(() => document.images.length > 1, null, { timeout: 5000 });
      const s = await settlePageImages(p);
      assert.strictEqual(s.pending, 0);
      assert.strictEqual(s.total, 21);
      heights.push(await p.evaluate(() => document.querySelector('.sub-list-header-status').offsetHeight));
      shots.push(await p.screenshot());
      await p.close();
    }
    // The clamp must normalize the VARIABLE-LENGTH status to one line in
    // both loads - without it, the wrap-count difference reflows every
    // element below (the field's 10.31% shape) and the byte compare
    // below fails anyway; this assertion just names the mechanism.
    assert.strictEqual(heights[0], heights[1], `masked status heights differ across loads: ${heights.join(' vs ')}`);
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
  const pushes = code.match(/record\.imageWaitPending\.push\(/g) || [];
  assert.ok(pushes.length >= 2, `gate timeouts AND late insertions must be RECORDED (found ${pushes.length} push sites; presence of the array alone is not binding - gate N3)`);
  // FINDING 2: a non-converging page with pending===0 at the last
  // observation (an image set that keeps CHANGING) is exactly the
  // round-2 diagnostic hole - the !stable guard must gate the record.
  assert.match(code, /!imgs\.stable\s*\|\|\s*imgs\.pending\s*>\s*0/, 'the record condition must include !imgs.stable - a never-converging set with zero in-flight images would otherwise go unrecorded');
  assert.match(code, /record\.erroredImages\.push\(/, 'errored-image counts must be recorded (server nondeterminism diagnosability)');
});
