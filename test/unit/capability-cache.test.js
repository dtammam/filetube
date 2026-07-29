'use strict';

// [UNIT] v1.53 - the capability cache's PURE gate (sanitizeCapabilityCache:
// TTL, future-clock rejection, own-key primitive scrub) + the write-side sub
// scrub + wiring locks on the optimistic-render call sites. sessionStorage
// itself is a browser API - the accessors are thin try/catch shells; the
// sanitize gate is where correctness lives, and it is fully testable here.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeCapabilityCache, scrubSubsForCache } = require('../../public/js/common.js');

const NOW = 1_800_000_000_000;

test('sanitize: a fresh well-formed cache passes with only allowlisted primitive fields', () => {
  const out = sanitizeCapabilityCache({
    ts: NOW - 1000,
    moduleEnabled: true,
    subs: [{ id: 's1', channelUrl: 'https://www.youtube.com/@zébra', name: 'Zébra', nested: { evil: 1 }, fn: 'x' }],
    pins: [{ id: 'p1', channelDir: '/dl/Zébra', pinSource: 'channel', arr: [1, 2] }],
    junk: 'dropped',
  }, NOW);
  assert.equal(out.moduleEnabled, true);
  assert.equal(out.subs.length, 1);
  assert.equal(out.subs[0].channelUrl, 'https://www.youtube.com/@zébra');
  assert.equal(out.subs[0].nested, undefined, 'objects never survive the flat scrub');
  assert.equal(out.pins[0].arr, undefined, 'arrays never survive the flat scrub');
  assert.equal(out.junk, undefined, 'unknown top-level keys are dropped');
});

test('sanitize: TTL, future clocks, and garbage shapes all reject to null', () => {
  assert.equal(sanitizeCapabilityCache({ ts: NOW - 6 * 60 * 1000, moduleEnabled: true }, NOW), null, 'expired (5min TTL)');
  assert.equal(sanitizeCapabilityCache({ ts: NOW + 2 * 60 * 1000, moduleEnabled: true }, NOW), null, 'a future clock is a lie');
  assert.equal(sanitizeCapabilityCache({ moduleEnabled: true }, NOW), null, 'no ts');
  assert.equal(sanitizeCapabilityCache('true', NOW), null);
  assert.equal(sanitizeCapabilityCache(null, NOW), null);
  assert.equal(sanitizeCapabilityCache([{ ts: NOW }], NOW), null, 'arrays rejected');
  const nonBool = sanitizeCapabilityCache({ ts: NOW, moduleEnabled: 'yes' }, NOW);
  assert.equal(nonBool.moduleEnabled, undefined, 'a truthy string is not a capability answer');
});

test('sanitize: subs without a channelUrl are dropped (the one field every decision needs)', () => {
  const out = sanitizeCapabilityCache({ ts: NOW, subs: [{ id: 'x' }, { channelUrl: '' }, null, { channelUrl: 'https://www.youtube.com/@ok' }] }, NOW);
  assert.equal(out.subs.length, 1);
});

test('scrubSubsForCache: keeps exactly the decision fields, drops everything else', () => {
  const scrubbed = scrubSubsForCache([
    { id: 's1', channelUrl: 'https://www.youtube.com/@a', channelId: 'UCx', channelDir: '/dl/A', name: 'Ä', format: 'mp4', quality: '1080', cutoffDate: 123 },
    { id: 's2' }, // no channelUrl -> dropped
  ]);
  assert.equal(scrubbed.length, 1);
  assert.deepEqual(Object.keys(scrubbed[0]).sort(), ['channelDir', 'channelId', 'channelUrl', 'id', 'name']);
});

test('LOCK (wiring): the probes WRITE the cache and the render sites READ it optimistically', () => {
  const stripped = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const watch = stripped('public/js/watch.js');
  assert.match(watch, /writeCapabilityCache\(\{ moduleEnabled: res\.ok \}\)/, 'reheat probe write deleted');
  assert.match(watch, /writeCapabilityCache\(\{ moduleEnabled, subs: scrubSubsForCache\(subs\) \}\)/, 'subscribe probe write deleted');
  assert.match(watch, /if \(cachedCap && cachedCap\.moduleEnabled === true\) mountReheatBtn\(\);/, 'reheat optimistic mount deleted');
  assert.match(watch, /applySubscribeButtonLabel\(optimistic\.subscribed\)/, 'subscribe optimistic render deleted');
  const common = stripped('public/js/common.js');
  assert.match(common, /writeCapabilityCache\(\{ pins \}\)/, 'pins write deleted');
  assert.equal((watch.match(/primePinnedSidebarFromCache\(\);/g) || []).length >= 1, true, 'watch pinned priming deleted');
  const main = stripped('public/js/main.js');
  assert.match(main, /primePinnedSidebarFromCache\(\);/, 'main pinned priming deleted');
  // The no-service-worker constraint stays load-bearing.
  assert.match(common, /unregisterStaleServiceWorkers/, 'the SW shedding function must survive this wave');
  // Gate QA-W1: the two remaining latches the exec plan promised are wired.
  assert.match(common, /if \(cachedCap && cachedCap\.moduleEnabled === true\) \{\s*repullModuleEnabled = true;/, 'repull-button optimistic seed deleted');
  assert.match(common, /injectSubscriptionsNavNodes\(\);/, 'nav-link shared builders deleted');
  assert.equal((common.match(/writeCapabilityCache\(\{ moduleEnabled/g) || []).length >= 2, true, 'a common.js health probe (repull/nav) stopped writing the cache');
  assert.equal((watch.match(/writeCapabilityCache\(\{ moduleEnabled/g) || []).length >= 2, true, 'a watch.js health probe (reheat/subscribe) stopped writing the cache');
  // Gate W4: per-user pins must not leak across a same-tab user change.
  const setup = stripped('public/js/setup.js');
  assert.match(setup, /sessionStorage\.removeItem\('ft-cap-cache-v1'\)/, 'the logout cache clear was deleted');
  const login = stripped('public/js/login.js');
  assert.match(login, /sessionStorage\.removeItem\('ft-cap-cache-v1'\)/, 'the login cache clear was deleted (covers crash-logouts)');
});
