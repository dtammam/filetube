'use strict';
// REAL-BROWSER binding for the capture guard (gate DELTA-A): the redirect
// enforcement lives in how Playwright's network stack is driven -
// route.continue() follows redirects internally WITHOUT re-invoking the
// route handler, so no fake-route unit test can bind it. This test runs
// the actual guard in actual Chromium against a local server that 307s
// out of the allowlisted login POST, and asserts the hop NEVER lands.
// Also replays the 2026-07-30 incident shape (a page-issued DELETE) and
// the expected-telemetry classification, end to end.
//
// Skips cleanly when the isolated tools/capture package (playwright +
// chromium) is not installed - the harness package is not part of the
// app's runtime deps by design.

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { newGuardedContext } = require('../../tools/capture/request-policy.js');

let chromium = null;
try {
  ({ chromium } = require('../../tools/capture/node_modules/playwright'));
} catch { /* not installed here - skip below */ }

test('real Chromium: redirects out of the allowlist never land; DELETEs never reach the server; telemetry classifies as expected', { skip: !chromium && 'tools/capture playwright not installed' }, async () => {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      res.writeHead(307, { Location: '/api/videos/redirect-destroy' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': req.url === '/' ? 'text/html' : 'application/json' });
    res.end(req.url === '/' ? '<html><body>ok</body></html>' : '{"ok":true}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    srv.close();
    test.skip?.(`chromium not launchable: ${e.message.slice(0, 60)}`);
    return;
  }
  const record = { blockedRequests: [], blockedExpected: [] };
  try {
    const ctx = await newGuardedContext(browser, {}, record, { scene: 'browser-binding-test' });
    const page = await ctx.newPage();
    await page.goto(base + '/');

    // 1) The DELTA-A replay: allowlisted POST answered with a 307.
    const loginResult = await page.evaluate(async () => {
      const r = await fetch('/api/auth/login', { method: 'POST' });
      return { status: r.status, url: r.url };
    });
    // The page sees a neutral success AT THE LOGIN URL - the hop was
    // refused, not followed.
    assert.strictEqual(loginResult.status, 200);
    assert.match(loginResult.url, /\/api\/auth\/login$/);

    // 2) The incident replay: a page-issued DELETE.
    await page.evaluate(() => fetch('/api/videos/incident-replay', { method: 'DELETE' }));

    // 3) Expected telemetry.
    await page.evaluate(() => fetch('/api/progress', { method: 'POST' }));

    await ctx.close();
  } finally {
    await browser.close();
    await new Promise((r) => srv.close(r));
  }

  // Server-side truth: only the page GET and the hop-1 login POST landed.
  assert.deepStrictEqual(hits, ['GET /', 'POST /api/auth/login'], `server saw: ${hits.join(', ')}`);
  // Run-record truth: the redirect and the DELETE are alarms; progress is expected.
  const alarms = record.blockedRequests.map((b) => b.reason);
  assert.strictEqual(record.blockedRequests.length, 2, JSON.stringify(alarms));
  assert.ok(alarms.some((r) => /redirect out of allowlisted/.test(r)), alarms.join(' | '));
  assert.ok(alarms.some((r) => /DELETE \/api\/videos\/incident-replay/.test(r)), alarms.join(' | '));
  assert.strictEqual(record.blockedExpected.length, 1);
  assert.match(record.blockedExpected[0].reason, /POST \/api\/progress/);
});
