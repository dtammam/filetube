'use strict';
// P0 guard for the capture harness (2026-07-30 incident: a scene issued
// real DELETE /api/videos/:id calls and destroyed 8 library files). The
// policy is the enforced read-only contract; these tests pin every edge.

const { test } = require('node:test');
const assert = require('node:assert');
const { requestVerdict, guardContext, ALLOWED_POST_PATHS } = require('../../tools/capture/request-policy.js');

const B = 'http://localhost:8082';

test('safe methods pass: GET/HEAD/OPTIONS, any path', () => {
  for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) {
    assert.strictEqual(requestVerdict(m, `${B}/api/videos/123`).allow, true, m);
  }
});

test('DELETE is blocked everywhere - including the incident endpoint', () => {
  const v = requestVerdict('DELETE', `${B}/api/videos/abc123`);
  assert.strictEqual(v.allow, false);
  assert.match(v.reason, /DELETE \/api\/videos\/abc123/);
});

test('PUT and PATCH are blocked everywhere', () => {
  assert.strictEqual(requestVerdict('PUT', `${B}/api/settings`).allow, false);
  assert.strictEqual(requestVerdict('PATCH', `${B}/api/videos/1`).allow, false);
});

test('POST is blocked by default', () => {
  assert.strictEqual(requestVerdict('POST', `${B}/api/videos/1/like`).allow, false);
  assert.strictEqual(requestVerdict('POST', `${B}/api/ytdlp/reheat-sub-counts`).allow, false);
});

test('the two contract POSTs pass: login + relocation dry-run preview', () => {
  assert.strictEqual(requestVerdict('POST', `${B}/api/auth/login`).allow, true);
  assert.strictEqual(requestVerdict('POST', `${B}/api/ytdlp/repull-metadata/preview`).allow, true);
});

test('allowlist matches the PATH exactly - query strings ok, prefixes and cousins not', () => {
  assert.strictEqual(requestVerdict('POST', `${B}/api/auth/login?next=/`).allow, true);
  assert.strictEqual(requestVerdict('POST', `${B}/api/auth/login/extra`).allow, false);
  assert.strictEqual(requestVerdict('POST', `${B}/api/ytdlp/repull-metadata`).allow, false);
  // DELETE to an allowlisted POST path is still a DELETE:
  assert.strictEqual(requestVerdict('DELETE', `${B}/api/auth/login`).allow, false);
});

test('unparseable URL on a mutating method never passes', () => {
  assert.strictEqual(requestVerdict('POST', 'not a url').allow, false);
  assert.strictEqual(requestVerdict('DELETE', '').allow, false);
});

test('guardContext: aborts blocked requests, continues allowed, records via onBlocked', async () => {
  // Fake Playwright context/route - the guard's contract, without a browser.
  let handler;
  const ctx = { route: async (pattern, h) => { assert.strictEqual(pattern, '**/*'); handler = h; } };
  const blocked = [];
  await guardContext(ctx, (b) => blocked.push(b));

  const mkRoute = (method, url) => {
    const calls = { continued: 0, aborted: 0, abortArg: null };
    return {
      calls,
      request: () => ({ method: () => method, url: () => url }),
      continue: () => { calls.continued++; },
      abort: (why) => { calls.aborted++; calls.abortArg = why; },
    };
  };

  const ok = mkRoute('GET', `${B}/`);
  await handler(ok);
  assert.deepStrictEqual([ok.calls.continued, ok.calls.aborted], [1, 0]);

  const login = mkRoute('POST', `${B}/api/auth/login`);
  await handler(login);
  assert.deepStrictEqual([login.calls.continued, login.calls.aborted], [1, 0]);

  const del = mkRoute('DELETE', `${B}/api/videos/xyz`);
  await handler(del);
  assert.deepStrictEqual([del.calls.continued, del.calls.aborted], [0, 1]);
  assert.strictEqual(del.calls.abortArg, 'blockedbyclient');
  assert.strictEqual(blocked.length, 1);
  assert.strictEqual(blocked[0].method, 'DELETE');

  // A throwing recorder must not unblock the abort:
  let handler2;
  const ctx2 = { route: async (_p, h) => { handler2 = h; } };
  await guardContext(ctx2, () => { throw new Error('recorder boom'); });
  const del2 = mkRoute('DELETE', `${B}/api/videos/abc`);
  await handler2(del2);
  assert.strictEqual(del2.calls.aborted, 1);
});

test('the allowlist is exactly two entries - additions are a reviewed decision', () => {
  assert.deepStrictEqual([...ALLOWED_POST_PATHS].sort(), ['/api/auth/login', '/api/ytdlp/repull-metadata/preview']);
});
