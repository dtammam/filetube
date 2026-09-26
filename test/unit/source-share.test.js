'use strict';

// [UNIT] v1.337 Share for non-YouTube downloads (Dean: "a share button that basically just shares the
// logged URL of whatever it is that we captured"; watch page only, read from the file itself). Plan:
// docs/exec-plans/completed/2026-09-26-share-any-download.md. The resolver turns the page URL yt-dlp wrote
// into a download's `purl` / `comment` tags into the watch route's `sourceShareUrl`.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  sanitizeSourceShareUrl,
  sourceUrlFromProbeJson,
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
  // the PARSED form is returned: a non-ASCII host becomes its punycode (what a browser would open)
  assert.strictEqual(sanitizeSourceShareUrl('https://b\u00fccher.example/x'), 'https://xn--bcher-kva.example/x');
  assert.strictEqual(sanitizeSourceShareUrl('https://vimeo.com'), 'https://vimeo.com/');
});

test('sanitizeSourceShareUrl: anything that is not a plain http(s) page link is refused (null)', () => {
  const bad = [
    undefined, null, 42, {}, '', '   ',
    'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://host/x', '//host/path', 'www.reddit.com/x',
    'https://user:pass@host.example/x', 'https://user@host.example/x', // credentials
    'https://host.example/a b', 'https://host.example/a\tb', 'https://host.example/a\u0000b', 'https://host.example/\u007f',
    'https://',
    'https://host.example/' + 'a'.repeat(SOURCE_SHARE_URL_MAX), // over the length cap
    // gate r1 (qa 1, adversary 3 + 7): hidden characters, userinfo in any form, an empty authority,
    // a scheme without its slashes, a backslash
    'https://www.reddit.com/r/\u202egpj.exe', // RLO: displays as ".../exe.jpg"
    'https://www.reddit.com/r/\u2066x\u2069', 'https://www.reddit.com/\u200bx', 'https://www.reddit.com/\ufeffx',
    'https://www.reddit.com/\u0085x', 'https://www.reddit.com/\u009bx', // C1 controls
    'https://www.reddit.com/\u2028x', 'https://www.reddit.com/\u00a0x',
    'https://www.reddit.com\\@evil.example/', 'https://evil.example\\@good.example/', 'https://h.example\\x',
    'https://:secret@host.example/x', 'https://@a.example/', 'https://a@b@c.example/',
    'https:///x', 'http:///nohost', 'https:www.reddit.com/x', 'https:/www.reddit.com/x',
  ];
  for (const b of bad) assert.strictEqual(sanitizeSourceShareUrl(b), null, JSON.stringify(b));
  assert.strictEqual(sanitizeSourceShareUrl('https://h.example/' + 'a'.repeat(SOURCE_SHARE_URL_MAX - 'https://h.example/'.length)).length, SOURCE_SHARE_URL_MAX, 'exactly the cap passes');
});

// ---- sourceUrlFromProbeJson (pure): where each container keeps the tags ---------

test('sourceUrlFromProbeJson: file-level purl, then comment (MP4 keeps only comment), case-insensitive', () => {
  assert.strictEqual(sourceUrlFromProbeJson({ format: { tags: { comment: 'https://a.example/mp4' } } }), 'https://a.example/mp4');
  assert.strictEqual(sourceUrlFromProbeJson({ format: { tags: { PURL: 'https://a.example/p', COMMENT: 'https://a.example/c' } } }), 'https://a.example/p', 'MKV upper-case; purl first');
  assert.strictEqual(sourceUrlFromProbeJson({ format: { tags: { purl: 'not a url', comment: 'https://a.example/c' } } }), 'https://a.example/c');
  assert.strictEqual(sourceUrlFromProbeJson({ format: { tags: { comment: 'A description, no link' } } }), null);
});

test('sourceUrlFromProbeJson: Ogg (an Opus download) keeps the tags per STREAM (gate r1 adversary 1)', () => {
  // the shape the box's ffprobe prints for an Opus file written with yt-dlp's metadata arguments
  const opus = { format: {}, streams: [{ tags: { title: 'x', purl: 'https://www.reddit.com/r/v/comments/1/', comment: 'https://www.reddit.com/r/v/comments/1/' } }] };
  assert.strictEqual(sourceUrlFromProbeJson(opus), 'https://www.reddit.com/r/v/comments/1/');
  assert.strictEqual(sourceUrlFromProbeJson({ format: { tags: { comment: 'https://a.example/file' } }, streams: [{ tags: { purl: 'https://a.example/stream' } }] }), 'https://a.example/file', 'the file level wins');
  assert.strictEqual(sourceUrlFromProbeJson({ streams: [{}, null, { tags: { comment: 'https://a.example/2nd' } }] }), 'https://a.example/2nd');
  for (const junk of [null, undefined, 'x', {}, { format: null, streams: 'no' }]) assert.strictEqual(sourceUrlFromProbeJson(junk), null);
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
    waitMs: o.waitMs,
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

test('resolver: a slow probe answers the page at the limit, and its LATE answer still fills the cache (gate r1 qa 2)', async () => {
  let calls = 0;
  const slow = harness({ waitMs: 20, probe: () => { calls += 1; return new Promise((res) => setTimeout(() => res({ sourceUrl: 'https://vimeo.com/4' }), 120)); } });
  const t0 = Date.now();
  assert.strictEqual(await slow.r.resolve({ filePath: '/m/a.mp4' }), null);
  assert.ok(Date.now() - t0 < 100, 'returned at the limit, not after the probe');
  assert.strictEqual(slow.r._inFlight(), 1, 'the probe keeps running');
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(slow.r._inFlight(), 0);
  assert.strictEqual(await slow.r.resolve({ filePath: '/m/a.mp4' }), 'https://vimeo.com/4', 'the next load is served from the late answer');
  assert.strictEqual(calls, 1, 'one probe in all');
});

test('resolver: concurrent loads of one file share ONE probe (gate r1 qa 2 / adversary 2)', async () => {
  let calls = 0;
  const { r } = harness({ waitMs: 1000, probe: () => { calls += 1; return new Promise((res) => setTimeout(() => res({ sourceUrl: 'https://vimeo.com/5' }), 40)); } });
  const answers = await Promise.all(Array.from({ length: 20 }, () => r.resolve({ filePath: '/m/a.mp4' })));
  assert.deepStrictEqual(new Set(answers), new Set(['https://vimeo.com/5']));
  assert.strictEqual(calls, 1, '20 simultaneous first loads, one probe');
  const slowCalls = { n: 0 };
  const slow = harness({ waitMs: 10, probe: () => { slowCalls.n += 1; return new Promise((res) => setTimeout(() => res({ sourceUrl: 'https://vimeo.com/6' }), 80)); } });
  await Promise.all(Array.from({ length: 20 }, () => slow.r.resolve({ filePath: '/m/a.mp4' })));
  await slow.r.resolve({ filePath: '/m/a.mp4' });
  assert.strictEqual(slowCalls.n, 1, 'a probe that outlives every wait is still the only one');
});

test('resolver: a hung stat answers the page at the limit too (gate r1 adversary S5), one stat in flight per file', async () => {
  let stats = 0;
  const r = createSourceShareResolver({ waitMs: 20, stat: () => { stats += 1; return new Promise(() => {}); }, probe: async () => ({ sourceUrl: 'https://a.example/' }) });
  const t0 = Date.now();
  const answers = await Promise.all([r.resolve({ filePath: '/m/a.mp4' }), r.resolve({ filePath: '/m/a.mp4' })]);
  assert.deepStrictEqual(answers, [null, null]);
  assert.ok(Date.now() - t0 < 150);
  assert.strictEqual(stats, 1, 'the second load joined the hung stat instead of starting another');
});

test('resolver: a throwing or rejecting probe never rejects', async () => {
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
  assert.match(route, /\.then\(\(\) => sourceShare\.resolve\(item\)\)\s*\.catch\(\(\) => null\)/, 'a rejected resolve still answers (no link)');
  assert.match(route, /\.catch\(\(\) => \{[^}]*\n\s*if \(!res\.headersSent\) res\.status\(500\)/, 'a throwing send is a 500, never a hung request');
});

test('server.js hands the browse routes a resolver on its OWN hard-killed probe of both tag levels', () => {
  assert.match(SERVER, /createSourceShareResolver\(\{\s*probe: probeSourceShareUrl,\s*stat: \(p\) => fs\.promises\.stat\(p\),\s*\}\);/);
  const fn = SERVER.slice(SERVER.indexOf('function probeSourceShareUrl('), SERVER.indexOf('const sourceShare = sourceShareLib'));
  assert.match(fn, /'-show_entries', 'format_tags:stream_tags'/, 'reads the file AND stream tags (Ogg)');
  assert.match(fn, /timeout: SOURCE_SHARE_PROBE_KILL_MS, killSignal: 'SIGKILL'/, 'a hung ffprobe is killed, never left behind');
  assert.match(SERVER, /const SOURCE_SHARE_PROBE_KILL_MS = 15000;/);
  assert.match(fn, /resolve\(\{ sourceUrl: sourceShareLib\.sourceUrlFromProbeJson\(j\) \}\)/);
  const reg = SERVER.slice(SERVER.indexOf('mediaRoutes.registerBrowseRoutes(app, {'));
  assert.match(reg.slice(0, reg.indexOf('});')), /\n {2}sourceShare, /);
});
