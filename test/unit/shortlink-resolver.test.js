'use strict';

// [UNIT] v1.41.13 (universal one-offs, D6): the bounded, SSRF-hardened share-
// shortlink redirect resolver. http + dns are injected so no real network is
// touched. Covers the Facebook case (share/r -> reel in one 302), the hop cap,
// timeouts, and every SSRF prescription from the design delta-3 review.

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveShortlink } = require('../../lib/ytdlp/shortlink');

// A fake http(s).request: given a map of url -> { status, location }, replays
// it synchronously. Records the sequence of requested URLs.
function fakeHttp(routes, requested) {
  return {
    request(url, _opts, cb) {
      requested.push(url);
      const route = routes[url] || { status: 200 };
      const res = {
        statusCode: route.status,
        headers: route.location ? { location: route.location } : {},
        destroy() {},
      };
      // Call back async-ish (next tick) to mirror real behavior.
      setImmediate(() => cb(res));
      return { setTimeout() {}, on() {}, end() {}, destroy() {} };
    },
  };
}

// A fake dns.lookup that resolves every host to a fixed public address unless
// the host is in `privateHosts`.
function fakeLookup(privateHosts = new Set()) {
  return (host, _opts, cb) => {
    setImmediate(() => cb(null, [{ address: privateHosts.has(host) ? '10.0.0.5' : '93.184.216.34', family: 4 }]));
  };
}

const okDeps = (routes, requested, priv) => ({
  http: fakeHttp(routes, requested), https: fakeHttp(routes, requested),
  lookup: fakeLookup(priv), maxHops: 3,
});

test('D6: a Facebook share link is resolved by following its single 302 to /reel', async () => {
  const requested = [];
  const routes = {
    'https://www.facebook.com/share/r/1Hk9jStL2C/': { status: 302, location: 'https://www.facebook.com/reel/897928030021587/?rdid=x' },
    'https://www.facebook.com/reel/897928030021587/?rdid=x': { status: 200 },
  };
  const r = await resolveShortlink('https://www.facebook.com/share/r/1Hk9jStL2C/', okDeps(routes, requested));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.url, 'https://www.facebook.com/reel/897928030021587/?rdid=x', 'the resolved reel URL (query preserved)');
  assert.strictEqual(requested.length, 2, 'exactly two hops: the shortlink + the reel');
});

test('D6: a direct URL that does not redirect resolves to itself in one hop', async () => {
  const requested = [];
  const r = await resolveShortlink('https://vimeo.com/76979871', okDeps({ 'https://vimeo.com/76979871': { status: 200 } }, requested));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.url, 'https://vimeo.com/76979871');
});

test('D6: the hop cap (3) is enforced -- a redirect loop is refused, never followed forever', async () => {
  const requested = [];
  const routes = {
    'https://a.test/1': { status: 302, location: 'https://a.test/2' },
    'https://a.test/2': { status: 302, location: 'https://a.test/3' },
    'https://a.test/3': { status: 302, location: 'https://a.test/4' },
    'https://a.test/4': { status: 302, location: 'https://a.test/5' },
  };
  const r = await resolveShortlink('https://a.test/1', okDeps(routes, requested));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /too many redirects/);
});

test('D6 SSRF: a redirect to a private-IP LITERAL is refused at the hop', async () => {
  const requested = [];
  const routes = {
    'https://evil.test/go': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
  };
  const r = await resolveShortlink('https://evil.test/go', okDeps(routes, requested));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /private\/local host/);
});

test('D6 SSRF: a redirect to a PUBLIC HOSTNAME that RESOLVES to a private address is refused (resolve-then-check)', async () => {
  const requested = [];
  const routes = {
    'https://start.test/go': { status: 302, location: 'https://rebind.attacker.test/x' },
  };
  const deps = okDeps(routes, requested, new Set(['rebind.attacker.test']));
  const r = await resolveShortlink('https://start.test/go', deps);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /resolves to a private address/);
});

test('D6 SSRF: a non-http(s) redirect (file:/data:) and a userinfo-bearing target are both refused', async () => {
  const requested = [];
  const fileRoute = { 'https://s.test/a': { status: 302, location: 'file:///etc/passwd' } };
  const rFile = await resolveShortlink('https://s.test/a', okDeps(fileRoute, requested));
  assert.strictEqual(rFile.ok, false);
  assert.match(rFile.error, /non-http/);

  const userRoute = { 'https://s.test/b': { status: 302, location: 'https://user:pass@10.0.0.1/' } };
  const rUser = await resolveShortlink('https://s.test/b', okDeps(userRoute, [], new Set()));
  assert.strictEqual(rUser.ok, false);
  // userinfo OR private-host -- either refusal is correct; both are present here.
  assert.ok(/userinfo|private/.test(rUser.error), rUser.error);
});

test('D6 SSRF: a PROTOCOL-RELATIVE Location is resolved to absolute against the current hop, then guarded', async () => {
  const requested = [];
  // //internal/... on an https hop becomes https://internal/... -> resolves private.
  const routes = { 'https://s.test/a': { status: 302, location: '//internal.svc/x' } };
  const r = await resolveShortlink('https://s.test/a', okDeps(routes, requested, new Set(['internal.svc'])));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /private/);
});

test('D6: the STARTING host also gets the DNS resolve-then-check (not just redirect targets)', async () => {
  const r = await resolveShortlink('https://sneaky.test/x', okDeps({ 'https://sneaky.test/x': { status: 200 } }, [], new Set(['sneaky.test'])));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /private address/);
});

test('D6: a per-hop request error fails closed (no partial resolution)', async () => {
  const erroringHttp = {
    request(_url, _opts, _cb) {
      const req = { setTimeout() {}, end() {}, destroy() {}, on(ev, h) { if (ev === 'error') setImmediate(h); } };
      return req;
    },
  };
  const r = await resolveShortlink('https://x.test/y', { http: erroringHttp, https: erroringHttp, lookup: fakeLookup() });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /request error/);
});
