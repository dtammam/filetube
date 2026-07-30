'use strict';
// P0 guard for the capture harness (2026-07-30 incident: a scene issued
// real DELETE /api/videos/:id calls and destroyed 8 library files). The
// policy is the enforced read-only contract; these tests pin every edge,
// including the gate's CRITICAL-1 (callsite binding), CRITICAL-3
// (fulfill-not-abort), WARNING-4 (expected-block classification) and
// WARNING-5 (redirect hop).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { requestVerdict, guardContext, newGuardedContext, ALLOWED_POST_PATHS } = require('../../tools/capture/request-policy.js');

const B = 'http://localhost:8082';

test('safe methods pass: GET/HEAD/OPTIONS, any path', () => {
  for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) {
    assert.strictEqual(requestVerdict(m, `${B}/api/videos/123`).allow, true, m);
  }
});

test('DELETE is blocked everywhere - including the incident endpoint - and is never "expected"', () => {
  const v = requestVerdict('DELETE', `${B}/api/videos/abc123`);
  assert.strictEqual(v.allow, false);
  assert.strictEqual(v.expected, false);
  assert.match(v.reason, /DELETE \/api\/videos\/abc123/);
});

test('PUT and PATCH are blocked everywhere as alarms', () => {
  for (const m of ['PUT', 'PATCH']) {
    const v = requestVerdict(m, `${B}/api/settings`);
    assert.deepStrictEqual([v.allow, v.expected], [false, false], m);
  }
});

test('POST is blocked by default as an alarm', () => {
  const v = requestVerdict('POST', `${B}/api/ytdlp/reheat-sub-counts`);
  assert.deepStrictEqual([v.allow, v.expected], [false, false]);
});

test('fire-and-forget page telemetry is blocked but EXPECTED (non-run-failing)', () => {
  for (const p of ['/api/videos/abc/view', '/api/progress', '/api/notifications/seen']) {
    const v = requestVerdict('POST', `${B}${p}`);
    assert.deepStrictEqual([v.allow, v.expected], [false, true], p);
  }
  // ...but only those exact shapes:
  assert.strictEqual(requestVerdict('POST', `${B}/api/videos/abc/view/extra`).expected, false);
  assert.strictEqual(requestVerdict('DELETE', `${B}/api/progress`).expected, false);
});

test('the two contract POSTs pass: login + relocation dry-run preview', () => {
  assert.strictEqual(requestVerdict('POST', `${B}/api/auth/login`).allow, true);
  assert.strictEqual(requestVerdict('POST', `${B}/api/ytdlp/repull-metadata/preview`).allow, true);
});

test('allowlist matches the PATH exactly - query strings ok, prefixes and cousins not', () => {
  assert.strictEqual(requestVerdict('POST', `${B}/api/auth/login?next=/`).allow, true);
  assert.strictEqual(requestVerdict('POST', `${B}/api/auth/login/extra`).allow, false);
  assert.strictEqual(requestVerdict('POST', `${B}/api/ytdlp/repull-metadata`).allow, false);
  assert.strictEqual(requestVerdict('DELETE', `${B}/api/auth/login`).allow, false);
});

test('a REDIRECTED request never qualifies for the POST allowlist (hop-1-only contract)', () => {
  assert.strictEqual(requestVerdict('POST', `${B}/api/auth/login`, true).allow, false);
  const v = requestVerdict('POST', `${B}/api/auth/login`, true);
  assert.strictEqual(v.expected, false);
  assert.match(v.reason, /redirected/);
  // Redirected GETs stay fine - only mutating verbs carry the contract.
  assert.strictEqual(requestVerdict('GET', `${B}/anything`, true).allow, true);
});

test('unparseable URL on a mutating method never passes', () => {
  assert.strictEqual(requestVerdict('POST', 'not a url').allow, false);
  assert.strictEqual(requestVerdict('DELETE', '').allow, false);
});

function mkRoute(method, url, redirectedFrom = null) {
  const calls = { continued: 0, fulfilled: 0, fulfillArg: null, aborted: 0 };
  return {
    calls,
    request: () => ({ method: () => method, url: () => url, redirectedFrom: () => redirectedFrom }),
    continue: () => { calls.continued++; },
    fulfill: (arg) => { calls.fulfilled++; calls.fulfillArg = arg; },
    abort: () => { calls.aborted++; },
  };
}

test('guardContext: FULFILLS blocked requests with an empty 200 (never aborts - aborts corrupt page state), continues allowed, records with the expected flag', async () => {
  let handler;
  const ctx = { route: async (pattern, h) => { assert.strictEqual(pattern, '**/*'); handler = h; } };
  const blocked = [];
  await guardContext(ctx, (b) => blocked.push(b));

  const ok = mkRoute('GET', `${B}/`);
  await handler(ok);
  assert.deepStrictEqual([ok.calls.continued, ok.calls.fulfilled], [1, 0]);

  const login = mkRoute('POST', `${B}/api/auth/login`);
  await handler(login);
  assert.deepStrictEqual([login.calls.continued, login.calls.fulfilled], [1, 0]);

  const del = mkRoute('DELETE', `${B}/api/videos/xyz`);
  await handler(del);
  assert.deepStrictEqual([del.calls.continued, del.calls.fulfilled, del.calls.aborted], [0, 1, 0]);
  assert.strictEqual(del.calls.fulfillArg.status, 200);
  assert.strictEqual(blocked.length, 1);
  assert.strictEqual(blocked[0].expected, false);

  const seen = mkRoute('POST', `${B}/api/notifications/seen`);
  await handler(seen);
  assert.strictEqual(seen.calls.fulfilled, 1);
  assert.strictEqual(blocked[1].expected, true);

  // Redirect hop: an allowlisted POST arriving via a redirect is blocked.
  const hop = mkRoute('POST', `${B}/api/auth/login`, { url: () => `${B}/somewhere` });
  await handler(hop);
  assert.strictEqual(hop.calls.fulfilled, 1);
  assert.match(blocked[2].reason, /redirected/);

  // A throwing recorder must not unblock the guard:
  let handler2;
  const ctx2 = { route: async (_p, h) => { handler2 = h; } };
  await guardContext(ctx2, () => { throw new Error('recorder boom'); });
  const del2 = mkRoute('DELETE', `${B}/api/videos/abc`);
  await handler2(del2);
  assert.strictEqual(del2.calls.fulfilled, 1);
});

test('newGuardedContext: creates the context WITH serviceWorkers blocked, installs the guard, routes records by class', async () => {
  let routeHandler;
  let newContextOpts;
  const fakeCtx = { route: async (_p, h) => { routeHandler = h; } };
  const browser = { newContext: async (opts) => { newContextOpts = opts; return fakeCtx; } };
  const record = { blockedRequests: [], blockedExpected: [] };
  const ctx = await newGuardedContext(browser, { viewport: { width: 1, height: 1 } }, record, { scene: '06-home-grid' });
  assert.strictEqual(ctx, fakeCtx);
  assert.strictEqual(newContextOpts.serviceWorkers, 'block');
  assert.strictEqual(newContextOpts.viewport.width, 1);

  await routeHandler(mkRoute('DELETE', `${B}/api/videos/x`));
  await routeHandler(mkRoute('POST', `${B}/api/progress`));
  assert.strictEqual(record.blockedRequests.length, 1);
  assert.strictEqual(record.blockedRequests[0].scene, '06-home-grid');
  assert.strictEqual(record.blockedExpected.length, 1);
});

test('CALLSITE BINDING (gate CRITICAL-1): capture.js creates contexts ONLY through newGuardedContext - bare newContext is banned', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../tools/capture/capture.js'), 'utf8');
  // Strip comments first - a lock satisfied by prose is the v1.50.3 class.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(!/\.newContext\s*\(/.test(code), 'bare browser.newContext( found in capture.js - every context MUST go through newGuardedContext');
  const sites = code.match(/newGuardedContext\s*\(/g) || [];
  assert.ok(sites.length >= 2, `expected the scene AND login contexts to use newGuardedContext (found ${sites.length})`);
});

test('the capture allowlist stays a SUBSET of the server readonly allowlist (twin contracts cannot drift apart)', () => {
  const { READONLY_ALLOWED_POSTS } = require('../../server.js');
  for (const p of ALLOWED_POST_PATHS) {
    assert.ok(READONLY_ALLOWED_POSTS.has(p), `${p} allowed by the capture policy but refused by FILETUBE_READONLY - a readonly capture instance would break`);
  }
});

test('the capture allowlist is exactly two entries - additions are a reviewed decision', () => {
  assert.deepStrictEqual([...ALLOWED_POST_PATHS].sort(), ['/api/auth/login', '/api/ytdlp/repull-metadata/preview']);
});
