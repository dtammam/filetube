'use strict';

// [UNIT] T5 / D4 / AC3: `shouldInjectSubscriptionsNav` is the pure decision
// public/js/common.js's capability probe uses before ever touching the DOM --
// "inject the Subscriptions nav link" iff the probe's response is a genuine
// 2xx. When the optional yt-dlp module is disabled, `GET
// /api/subscriptions/health` doesn't exist server-side at all (see
// lib/ytdlp/index.js's registerRoutes, gated on isEnabled) and the fetch
// resolves with a 404 Response -- this must resolve to `false` here, which is
// exactly what keeps the nav link structurally ABSENT from the DOM rather
// than merely hidden (this codebase has no browser/DOM test harness for any
// per-page script, so the DOM-mutation half of the probe is proven instead by
// test/integration/ytdlp-ui-routes.test.js's real-route 404/200 assertions;
// this file covers the pure decision that gates it).
const { test } = require('node:test');
const assert = require('node:assert');
const { shouldInjectSubscriptionsNav } = require('../../public/js/common.js');

test('shouldInjectSubscriptionsNav: a 200 response (module enabled) injects', () => {
  assert.strictEqual(shouldInjectSubscriptionsNav({ ok: true, status: 200 }), true);
});

test('shouldInjectSubscriptionsNav: a 404 response (module disabled) does NOT inject', () => {
  assert.strictEqual(shouldInjectSubscriptionsNav({ ok: false, status: 404 }), false);
});

test('shouldInjectSubscriptionsNav: a 5xx response does NOT inject', () => {
  assert.strictEqual(shouldInjectSubscriptionsNav({ ok: false, status: 500 }), false);
});

test('shouldInjectSubscriptionsNav: a missing/undefined response does NOT inject (fail closed)', () => {
  assert.strictEqual(shouldInjectSubscriptionsNav(undefined), false);
  assert.strictEqual(shouldInjectSubscriptionsNav(null), false);
});
