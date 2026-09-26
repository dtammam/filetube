'use strict';

// [UNIT] v1.337 Share for non-YouTube downloads (Dean: "a share button that basically just shares the
// logged URL of whatever it is that we captured"; watch page only, read from the file itself). Plan:
// docs/exec-plans/active/2026-09-26-share-any-download.md. The resolver turns the page URL yt-dlp wrote
// into a download's `purl` / `comment` tags into the watch route's `sourceShareUrl`.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  sanitizeSourceShareUrl,
  wantsSourceShareUrl,
  createSourceShareResolver,
  SOURCE_SHARE_URL_MAX,
} = require('../../lib/media/source-share');

// ---- sanitizeSourceShareUrl (pure) --------------------------------------------

test('sanitizeSourceShareUrl: a real page URL from another site passes through untouched', () => {
  for (const u of [
    'https://www.reddit.com/r/videos/comments/abc123/a_clip/',
    'https://www.facebook.com/watch/?v=1234567890',
    'http://example.org/v/1?x=1&y=%20z#frag',
  ]) assert.strictEqual(sanitizeSourceShareUrl(u), u);
  assert.strictEqual(sanitizeSourceShareUrl('  https://vimeo.com/1  '), 'https://vimeo.com/1', 'trimmed');
});

test('sanitizeSourceShareUrl: anything that is not a plain http(s) page link is refused (null)', () => {
  const bad = [
    undefined, null, 42, {}, '', '   ',
    'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://host/x', '//host/path', 'www.reddit.com/x',
    'https://user:pass@host.example/x', 'https://user@host.example/x', // credentials
    'https://host.example/a b', 'https://host.example/a\tb', 'https://host.example/a\u0000b', 'https://host.example/\u007f',
    'https://',
    'https://host.example/' + 'a'.repeat(SOURCE_SHARE_URL_MAX), // over the length cap
  ];
  for (const b of bad) assert.strictEqual(sanitizeSourceShareUrl(b), null, JSON.stringify(b));
  assert.strictEqual(sanitizeSourceShareUrl('https://h.example/' + 'a'.repeat(SOURCE_SHARE_URL_MAX - 'https://h.example/'.length)).length, SOURCE_SHARE_URL_MAX, 'exactly the cap passes');
});

// ---- wantsSourceShareUrl (pure) -----------------------------------------------

test('wantsSourceShareUrl: only a yt-dlp download from another site without a YouTube link', () => {
  const item = { sourceExtractor: 'Reddit', sourceId: 'abc', filePath: '/m/a.mp4' };
  assert.strictEqual(wantsSourceShareUrl(item, null), true);
  assert.strictEqual(wantsSourceShareUrl(item, undefined), true);
  assert.strictEqual(wantsSourceShareUrl(item, 'https://www.youtube.com/watch?v=x'), false, 'a YouTube link wins');
  assert.strictEqual(wantsSourceShareUrl({ filePath: '/m/a.mp4' }, null), false, 'a plain local file: no');
  assert.strictEqual(wantsSourceShareUrl({ sourceExtractor: '', filePath: '/m/a.mp4' }, null), false);
  assert.strictEqual(wantsSourceShareUrl({ sourceExtractor: 'Reddit' }, null), false, 'no file path: no');
  assert.strictEqual(wantsSourceShareUrl(null, null), false);
});

// ---- createSourceShareResolver ------------------------------------------------

function harness(opts) {
  const o = opts || {};
  const stats = new Map(Object.entries(o.stats || { '/m/a.mp4': { size: 10, mtimeMs: 1 } }));
  const probes = [];
  const tags = o.tags || { '/m/a.mp4': { sourceUrl: 'https://www.reddit.com/r/x/comments/1/' } };
  const deps = {
    stat: async (p) => { if (!stats.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return stats.get(p); },
    probe: o.probe || (async (p) => { probes.push(p); return Object.prototype.hasOwnProperty.call(tags, p) ? tags[p] : null; }),
    timeoutMs: o.timeoutMs,
    cacheMax: o.cacheMax,
  };
  return { r: createSourceShareResolver(deps), probes, stats, tags };
}

test('resolver: reads the URL from the file tags, then serves it from the cache (one probe)', async () => {
  const { r, probes } = harness();
  const item = { filePath: '/m/a.mp4', sourceExtractor: 'Reddit' };
  assert.strictEqual(await r.resolve(item), 'https://www.reddit.com/r/x/comments/1/');
  assert.strictEqual(await r.resolve(item), 'https://www.reddit.com/r/x/comments/1/');
  assert.deepStrictEqual(probes, ['/m/a.mp4'], 'the second call is a cache hit');
  assert.strictEqual(r.wants, wantsSourceShareUrl, 'the route asks the resolver whether to look');
});

test('resolver: a REPLACED file (size or mtime changed) is read again', async () => {
  const { r, probes, stats, tags } = harness();
  const item = { filePath: '/m/a.mp4' };
  await r.resolve(item);
  stats.set('/m/a.mp4', { size: 10, mtimeMs: 2 });
  tags['/m/a.mp4'] = { sourceUrl: 'https://vimeo.com/2' };
  assert.strictEqual(await r.resolve(item), 'https://vimeo.com/2');
  stats.set('/m/a.mp4', { size: 11, mtimeMs: 2 });
  await r.resolve(item);
  assert.strictEqual(probes.length, 3);
});

test('resolver: a file with no usable URL resolves null and that answer is cached', async () => {
  const { r, probes } = harness({ tags: { '/m/a.mp4': { sourceUrl: null } } });
  assert.strictEqual(await r.resolve({ filePath: '/m/a.mp4' }), null);
  assert.strictEqual(await r.resolve({ filePath: '/m/a.mp4' }), null);
  assert.strictEqual(probes.length, 1, 'a successful probe that found nothing is remembered');
  const bad = harness({ tags: { '/m/a.mp4': { sourceUrl: 'javascript:alert(1)' } } });
  assert.strictEqual(await bad.r.resolve({ filePath: '/m/a.mp4' }), null, 'a tag is data: re-validated');
});

test('resolver: a FAILED probe (null) is not cached - the next load retries', async () => {
  let calls = 0;
  const { r } = harness({ probe: async () => { calls += 1; return calls === 1 ? null : { sourceUrl: 'https://vimeo.com/3' }; } });
  assert.strictEqual(await r.resolve({ filePath: '/m/a.mp4' }), null);
  assert.strictEqual(await r.resolve({ filePath: '/m/a.mp4' }), 'https://vimeo.com/3');
  assert.strictEqual(calls, 2);
});

test('resolver: a slow probe is cut at the time limit (null, not cached) and a throwing one never rejects', async () => {
  const slow = harness({ timeoutMs: 20, probe: () => { return new Promise((res) => setTimeout(() => res({ sourceUrl: 'https://vimeo.com/4' }), 200)); } });
  const t0 = Date.now();
  assert.strictEqual(await slow.r.resolve({ filePath: '/m/a.mp4' }), null);
  assert.ok(Date.now() - t0 < 150, 'returned at the limit, not after the probe');
  assert.strictEqual(slow.r._cacheSize(), 0, 'a timeout is not an answer');
  const thrower = harness({ probe: () => { throw new Error('spawn EACCES'); } });
  assert.strictEqual(await thrower.r.resolve({ filePath: '/m/a.mp4' }), null);
  const rejecter = harness({ probe: () => Promise.reject(new Error('boom')) });
  assert.strictEqual(await rejecter.r.resolve({ filePath: '/m/a.mp4' }), null);
});

test('resolver: a missing file, a missing path or missing deps resolve null without probing', async () => {
  const { r, probes } = harness();
  assert.strictEqual(await r.resolve({ filePath: '/m/gone.mp4' }), null);
  assert.strictEqual(await r.resolve({}), null);
  assert.strictEqual(await r.resolve(null), null);
  assert.deepStrictEqual(probes, []);
  assert.strictEqual(await createSourceShareResolver({}).resolve({ filePath: '/m/a.mp4' }), null);
});

test('resolver: the cache is bounded, evicting the least recently used file', async () => {
  const stats = { '/1': { size: 1, mtimeMs: 1 }, '/2': { size: 1, mtimeMs: 1 }, '/3': { size: 1, mtimeMs: 1 } };
  const tags = { '/1': { sourceUrl: 'https://a.example/1' }, '/2': { sourceUrl: 'https://a.example/2' }, '/3': { sourceUrl: 'https://a.example/3' } };
  const { r, probes } = harness({ stats, tags, cacheMax: 2 });
  await r.resolve({ filePath: '/1' });
  await r.resolve({ filePath: '/2' });
  await r.resolve({ filePath: '/1' }); // /1 is now the most recent
  await r.resolve({ filePath: '/3' }); // evicts /2
  assert.strictEqual(r._cacheSize(), 2);
  await r.resolve({ filePath: '/1' });
  await r.resolve({ filePath: '/2' });
  assert.deepStrictEqual(probes, ['/1', '/2', '/3', '/2'], '/1 stayed cached, /2 was evicted and re-read');
});

// ---- the route wiring (source locks; test/integration/watch-source-share.test.js drives the real app) ----

const fs = require('node:fs');
const path = require('node:path');
const ROUTES = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'media', 'routes.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

test('GET /api/videos/:id: the visibility gate runs BEFORE the probe; only a wanted item awaits it', () => {
  const start = ROUTES.indexOf("app.get('/api/videos/:id', (req, res) => {");
  assert.ok(start !== -1);
  const route = ROUTES.slice(start, ROUTES.indexOf('\n  });\n', start));
  const gate = route.indexOf('if (!mediaVisibleTo(req, item)) {');
  const branch = route.indexOf('if (!sourceShare || !sourceShare.wants(item, watchUrl)) {');
  const probe = route.indexOf('sourceShare.resolve(item)');
  assert.ok(gate !== -1 && branch !== -1 && probe !== -1);
  assert.ok(gate < branch && branch < probe, 'RBAC 404 first; the synchronous send for every other item before the probe');
  assert.match(route, /if \(!sourceShare \|\| !sourceShare\.wants\(item, watchUrl\)\) \{\s*res\.json\(body\);\s*return;\s*\}/);
  assert.match(route, /res\.json\(sourceShareUrl \? \{ \.\.\.body, sourceShareUrl \} : body\);/, 'a SEPARATE field, never watchUrl');
  assert.match(route, /\}, \(\) => \{\s*if \(!res\.headersSent\) res\.json\(body\);/, 'a rejected resolve still answers');
});

test('server.js hands the browse routes a resolver built on the reheat probe', () => {
  assert.match(SERVER, /createSourceShareResolver\(\{\s*probe: probeEmbeddedTags,\s*stat: \(p\) => fs\.promises\.stat\(p\),\s*\}\);/);
  const reg = SERVER.slice(SERVER.indexOf('mediaRoutes.registerBrowseRoutes(app, {'));
  assert.match(reg.slice(0, reg.indexOf('});')), /\n {2}sourceShare, /);
});
