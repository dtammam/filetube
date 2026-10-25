'use strict';

// [UNIT] v1.395.0 Pages, Step 3 (plan D-PARSE 5, Error handling, Testing strategy
// "SSRF"): a URL save end to end with injected transports (no real network). Every
// outbound request - the page AND each image, stylesheet and font - goes through
// the fetch guard: a private literal, a private DNS answer, a redirect to loopback
// and a file: URL are never fetched. Localized assets land as content-hashed local
// files; nothing in the stored Reader or Original can load anything remote.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const { createPagesService } = require('../../lib/pages/service');
const { createCapture } = require('../../lib/pages/capture');
const disk = require('../../lib/pages/disk');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')]);
const PNG2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('second')]);
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.from('font-body')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function fakeHttp(routes, requested) {
  return {
    request(url, _opts, cb) {
      requested.push(url);
      const route = routes[url] || { status: 404 };
      const res = new EventEmitter();
      res.statusCode = route.status;
      res.headers = Object.assign({}, route.headers || {});
      if (route.location) res.headers.location = route.location;
      res.destroy = () => { res.destroyed = true; };
      setTimeout(() => {
        cb(res);
        if (route.location) return;
        setImmediate(() => {
          for (const c of route.chunks || []) { if (res.destroyed) return; res.emit('data', Buffer.from(c)); }
          res.emit('end');
        });
      }, route.delayMs || 0);
      return { setTimeout() {}, on() {}, end() {}, destroy() {} };
    },
  };
}
// Every host resolves public except the ones named private.
function fakeLookup(privateHosts) {
  return (host, _opts, cb) => setImmediate(() => cb(null, [{ address: privateHosts.has(host) ? '10.1.2.3' : '203.0.113.7', family: 4 }]));
}

function setup(routes, { privateHosts = new Set(), maxActive, maxWaiting } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-pages-capture-'));
  const adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  adapter.sql.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (1, 'dean', 'x', 'admin', '2026-01-01T00:00:00.000Z')").run();
  const userStore = { getById: (id) => (id === 1 ? { id: 1, username: 'dean' } : null) };
  const root = path.join(dir, 'pages');
  const service = createPagesService({ adapter, root, userStore, log: () => {} });
  const requested = [];
  const fetchDeps = { http: fakeHttp(routes, requested), https: fakeHttp(routes, requested), lookup: fakeLookup(privateHosts) };
  const capture = createCapture({ service, deps: { fetch: fetchDeps }, log: () => {}, maxActive, maxWaiting });
  return { dir, adapter, root, service, capture, requested, fetchDeps, userStore };
}

const ARTICLE = (extra = '') => `<!DOCTYPE html><html lang="en"><head><title>Boathouse moves</title>
  <meta property="og:site_name" content="The River Gazette">
  <meta name="author" content="Sam Rivers">
  <meta property="article:published_time" content="2026-10-20T09:00:00Z">
  <meta property="og:image" content="https://cdn.example.com/lead.png">
  <link rel="stylesheet" href="https://cdn.example.com/site.css">
  <style>.hero{background:url(/hero.png)}</style>
  </head><body><header class="hero">Gazette</header><article><h1>Boathouse moves</h1>
  <p>${'The old boathouse is moving upstream this winter, the council said on Tuesday. '.repeat(8)}</p>
  <figure><img src="/photo.png" alt="The boathouse"><figcaption>The boathouse in 1990.</figcaption></figure>
  <p>${'Rowers will keep their slots, and the cafe stays open through the move. '.repeat(8)}</p>
  ${extra}
  </article><script>tracker()</script></body></html>`;

const BASE_ROUTES = {
  'https://news.example.com/boathouse': { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, chunks: [ARTICLE()] },
  'https://news.example.com/photo.png': { status: 200, chunks: [PNG] },
  'https://news.example.com/hero.png': { status: 200, chunks: [PNG2] },
  'https://cdn.example.com/lead.png': { status: 200, chunks: [PNG] },
  'https://cdn.example.com/site.css': { status: 200, headers: { 'content-type': 'text/css' }, chunks: ['@import url(https://cdn.example.com/more.css); @font-face{font-family:F;src:url(fonts/f.woff2) format("woff2")} body{color:#222;background:url(//tracker.example/pixel.gif)}'] },
  'https://cdn.example.com/fonts/f.woff2': { status: 200, chunks: [WOFF2] },
};

function allFiles(dir) {
  const out = {};
  const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, rel + e.name + '/'); else out[rel + e.name] = fs.readFileSync(p); } };
  walk(dir, '');
  return out;
}

test('a bare link: fetched, extracted, saved at once with images pending, then localized - nothing remote remains', async () => {
  const t = setup(BASE_ROUTES);
  const { item, duplicate, localized } = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse', source: 'web', note: 'for Thursday' });
  assert.strictEqual(duplicate, false);
  assert.strictEqual(item.assetsState, 'pending', 'the item exists before its images');
  assert.strictEqual(item.title, 'Boathouse moves');
  assert.strictEqual(item.author, 'Sam Rivers');
  assert.strictEqual(item.site, 'The River Gazette');
  assert.strictEqual(item.publishedAt, '2026-10-20T09:00:00.000Z');
  assert.ok(item.hasReader && item.hasOriginal);
  const done = await localized;
  assert.strictEqual(done.assetsState, 'done');
  assert.match(done.leadImage, /^assets\/[0-9a-f]{24}\.png$/);
  const dir = disk.locate(t.root, 1, item.folder).dir;
  const files = allFiles(dir);
  const reader = files['reader.html'].toString();
  const original = files['original.html'].toString();
  assert.match(reader, /<img src="assets\/[0-9a-f]{24}\.png" alt="The boathouse" loading="lazy"\/>/);
  assert.ok(!/https?:\/\/[^"]*\.(png|css|woff2|gif)/.test(reader + original), 'no remote asset URL is left in either view');
  assert.ok(!/ft-src:|data-ft-src|data-ft-href/.test(reader + original), 'no placeholder is left');
  assert.match(original, /<style>\s*@font-face\{font-family:F;src:url\("assets\/[0-9a-f]{24}\.woff2"\) format\("woff2"\)\} body\{color:#222;background:none\}<\/style>/, 'the stylesheet inlined, its font local, the tracker pixel gone, @import gone');
  assert.match(original, /\.hero\{background:url\("assets\/[0-9a-f]{24}\.png"\)\}/);
  assert.ok(!/tracker\(\)/.test(original), 'the page script is gone');
  const assetNames = Object.keys(files).filter((f) => f.startsWith('assets/'));
  assert.strictEqual(assetNames.length, 3, 'photo + hero (+ the lead is the photo bytes) + font: ' + assetNames.join(', '));
  for (const a of assetNames) assert.match(a, /^assets\/[0-9a-f]{24}\.(png|woff2)$/);
  const rec = JSON.parse(files['item.json'].toString());
  assert.strictEqual(rec.assets.state, 'done');
  assert.strictEqual(rec.note, 'for Thursday');
  assert.ok(!t.requested.some((u) => /more\.css/.test(u)), 'an @import is never requested: ' + t.requested.join(' '));
  assert.ok(t.requested.includes('https://tracker.example/pixel.gif'), 'a CSS image is an asset like any other (fetched by the server, through the guard); this one 404s and becomes none');
  // The item's text is searchable.
  assert.deepStrictEqual(t.service.index.listItems(1, { q: 'cafe stays open' }).items.map((i) => i.id), [item.id]);
});

test('SSRF: a private literal, a private DNS name, a redirect to loopback and a file: URL are never fetched', async () => {
  const html = ARTICLE(`<img src="http://10.0.0.5/admin.png"><img src="http://intranet.example/secret.png"><img src="https://news.example.com/redirects.png"><img src="file:///etc/passwd"><img src="http://[::1]/x.png"><img src="http://169.254.169.254/latest/meta-data">`);
  const routes = {
    ...BASE_ROUTES,
    'https://news.example.com/boathouse': { status: 200, headers: { 'content-type': 'text/html' }, chunks: [html] },
    'https://news.example.com/redirects.png': { status: 302, location: 'http://127.0.0.1:8080/internal.png' },
  };
  const t = setup(routes, { privateHosts: new Set(['intranet.example']) });
  const { localized } = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse' });
  const done = await localized;
  for (const bad of ['http://10.0.0.5/admin.png', 'http://intranet.example/secret.png', 'http://127.0.0.1:8080/internal.png', 'file:///etc/passwd', 'http://[::1]/x.png', 'http://169.254.169.254/latest/meta-data']) {
    assert.ok(!t.requested.includes(bad), `${bad} was requested`);
  }
  assert.ok(t.requested.includes('https://news.example.com/redirects.png'), 'the public hop itself was asked (and its redirect refused)');
  const reader = t.service.readFile(done, 'reader.html');
  assert.strictEqual((reader.match(/<img /g) || []).length, 1, 'only the public photo is shown');
});

test('SSRF: the page itself on a private address is refused, and nothing is written', async () => {
  const t = setup({}, { privateHosts: new Set(['router.lan']) });
  await assert.rejects(t.capture.saveUrl(1, { url: 'http://router.lan/' }), (err) => err.status === 502 && /private/.test(err.message));
  await assert.rejects(t.capture.saveUrl(1, { url: 'http://192.168.1.1/' }), (err) => err.status === 502);
  await assert.rejects(t.capture.saveUrl(1, { url: 'file:///etc/passwd' }), (err) => err.status === 400);
  assert.deepStrictEqual(t.requested, []);
  assert.strictEqual(t.service.index.countAll(), 0);
  assert.strictEqual(fs.existsSync(path.join(t.root, '1', 'items')), false);
});

test('a device capture is used as sent: the page is never fetched by the server', async () => {
  const t = setup(BASE_ROUTES);
  const html = ARTICLE().replace('Boathouse moves</h1>', 'Boathouse moves (members edition)</h1>');
  const { item, localized } = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse', html, source: 'shortcut' });
  await localized;
  assert.ok(!t.requested.includes('https://news.example.com/boathouse'), 'the page itself was not fetched');
  assert.match(t.service.readFile(item, 'text.txt'), /members edition/);
  assert.strictEqual(t.service.readRecord(item).source, 'shortcut');
});

test('extraction failed: the item is still saved, Original only (P3)', async () => {
  const t = setup({ 'https://app.example.com/dash': { status: 200, headers: { 'content-type': 'text/html' }, chunks: ['<html><head><title>Dashboard</title></head><body><nav>Home</nav><button>Go</button></body></html>'] } });
  const { item, localized } = await t.capture.saveUrl(1, { url: 'https://app.example.com/dash' });
  await localized;
  assert.strictEqual(item.hasReader, false);
  assert.strictEqual(item.hasOriginal, true);
  assert.strictEqual(t.service.readFile(item, 'reader.html'), null);
  assert.match(t.service.readFile(item, 'original.html'), /<nav>Home<\/nav>/);
});

test('a non-HTML link is refused before anything is written', async () => {
  const t = setup({ 'https://files.example.com/a.zip': { status: 200, headers: { 'content-type': 'application/zip' }, chunks: ['PK'] } });
  await assert.rejects(t.capture.saveUrl(1, { url: 'https://files.example.com/a.zip' }), /not a web page/);
  assert.strictEqual(t.service.index.countAll(), 0);
});

test('an "image" that is not an image (HTML, SVG) is never stored; fonts only from CSS', async () => {
  const html = ARTICLE('<img src="/fake.png"><img src="/vector.svg"><img src="/font-as-img.woff2">');
  const t = setup({
    ...BASE_ROUTES,
    'https://news.example.com/boathouse': { status: 200, headers: { 'content-type': 'text/html' }, chunks: [html] },
    'https://news.example.com/fake.png': { status: 200, chunks: ['<html>not a png</html>'] },
    'https://news.example.com/vector.svg': { status: 200, headers: { 'content-type': 'image/svg+xml' }, chunks: [SVG] },
    'https://news.example.com/font-as-img.woff2': { status: 200, chunks: [WOFF2] },
  });
  const { localized } = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse' });
  const done = await localized;
  const reader = t.service.readFile(done, 'reader.html');
  assert.strictEqual((reader.match(/<img /g) || []).length, 1);
  const rec = t.service.readRecord(done);
  assert.ok(rec.assets.dropped.some((d) => /not images or fonts/.test(d)), JSON.stringify(rec.assets.dropped));
});

test('the asset cap: past 300 assets the rest are dropped and the reason recorded, the save still succeeds', async () => {
  let imgs = '';
  const routes = { ...BASE_ROUTES };
  for (let k = 0; k < 310; k += 1) {
    imgs += `<img src="/i/${k}.png">`;
    routes[`https://news.example.com/i/${k}.png`] = { status: 200, chunks: [Buffer.concat([PNG, Buffer.from(String(k))])] };
  }
  routes['https://news.example.com/boathouse'] = { status: 200, headers: { 'content-type': 'text/html' }, chunks: [ARTICLE(imgs)] };
  const t = setup(routes);
  const { localized } = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse' });
  const done = await localized;
  const rec = t.service.readRecord(done);
  assert.ok(rec.assets.count <= 300, String(rec.assets.count));
  assert.ok(rec.assets.dropped.some((d) => /300-asset cap/.test(d)), JSON.stringify(rec.assets.dropped));
});

test('duplicates (P12): the same canonical URL returns the existing item and writes nothing new', async () => {
  const t = setup(BASE_ROUTES);
  const first = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse' });
  await first.localized;
  const again = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse' });
  assert.strictEqual(again.duplicate, true);
  assert.strictEqual(again.item.id, first.item.id);
  assert.strictEqual(t.service.index.countAll(), 1);
});

test('a restart mid-localization resumes from the files: a new capture instance finishes the pending item', async () => {
  const t = setup(BASE_ROUTES);
  // Save the item but never run the localizer (the process "died" right after the write).
  const { buildFromUrl } = require('../../lib/pages/capture');
  const built = await buildFromUrl({ url: 'https://news.example.com/boathouse' }, { deps: t.fetchDeps });
  const saved = await t.service.saveItem(1, { record: built.record, files: built.files });
  assert.strictEqual(saved.item.assetsState, 'pending');
  const fresh = createCapture({ service: t.service, deps: { fetch: t.fetchDeps }, log: () => {} });
  assert.strictEqual(await fresh.resumePending(), 1);
  const after = t.service.getItem(1, saved.item.id);
  assert.strictEqual(after.assetsState, 'done');
  assert.match(t.service.readFile(after, 'reader.html'), /src="assets\//);
});

test('a localization that fails entirely leaves the text item intact and marks it done', async () => {
  const t = setup({ 'https://news.example.com/boathouse': BASE_ROUTES['https://news.example.com/boathouse'] });
  const { item, localized } = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse' });
  const done = await localized;
  assert.strictEqual(done.assetsState, 'done');
  assert.match(t.service.readFile(item, 'text.txt'), /old boathouse is moving/);
  assert.ok(!/<img /.test(t.service.readFile(item, 'reader.html')), 'an image that could not be stored is removed, never left remote');
});

test('a FETCHED stylesheet that tries to close its <style> (</style><img onerror>) stays inert once inlined into the Original', async () => {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const t = setup({
    ...BASE_ROUTES,
    'https://cdn.example.com/site.css': { status: 200, headers: { 'content-type': 'text/css' }, chunks: ['p{color:red} a{content:"</style><img src=x onerror=alert(1)><style>"}'] },
  });
  const { item, localized } = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse' });
  await localized;
  const html = t.service.readFile(item, 'original.html');
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  const live = [...dom.window.document.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => a.name.startsWith('on')));
  assert.deepStrictEqual(live.map((el) => el.outerHTML.slice(0, 60)), [], 'no element with a handler: ' + html.slice(0, 300));
  assert.ok(![...dom.window.document.querySelectorAll('img')].some((i) => i.getAttribute('src') === 'x'));
  dom.window.close();
});

test('DNS rebinding: the CONNECT resolves through a checked lookup - a host that answers public to the guard and private to the socket is never reached', async () => {
  const http = require('http');
  const { guardedFetch } = require('../../lib/pages/fetch');
  let hits = 0;
  const local = http.createServer((req, res) => { hits += 1; res.end('secret router page'); });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  const port = local.address().port;
  let calls = 0;
  // The first answer (guardHop's resolve-then-check) is public; every later one (the connect) is loopback.
  const lookup = (host, opts, cb) => { calls += 1; setImmediate(() => cb(null, [{ address: calls === 1 ? '203.0.113.7' : '127.0.0.1', family: 4 }])); };
  try {
    const r = await guardedFetch(`http://rebind.example:${port}/admin`, { deps: { lookup } });
    assert.strictEqual(r.ok, false, JSON.stringify(r));
    assert.strictEqual(hits, 0, 'the private address was never connected to');
    assert.ok(calls >= 2, 'the connect resolved through the injected (checked) lookup');
    // The control: a lookup that answers loopback for the CONNECT only when the check is skipped would reach it.
    const { checkedLookup } = require('../../lib/podcasts/fetchGuard');
    await new Promise((resolve) => checkedLookup((h, o, cb) => cb(null, [{ address: '10.0.0.1', family: 4 }]))('x', {}, (err) => { assert.ok(err && err.code === 'EPRIVATE'); resolve(); }));
    await new Promise((resolve) => checkedLookup((h, o, cb) => cb(null, [{ address: '203.0.113.9', family: 4 }]))('x', {}, (err, addr, fam) => { assert.strictEqual(err, null); assert.strictEqual(addr, '203.0.113.9'); assert.strictEqual(fam, 4); resolve(); }));
  } finally {
    local.close();
  }
});

test('gate r1 C1: a URL save keeps its links in BOTH views after the images are stored', async () => {
  const html = ARTICLE('<p>Read <a href="https://other.example/report">the report</a>.</p>');
  const t = setup({ ...BASE_ROUTES, 'https://news.example.com/boathouse': { status: 200, headers: { 'content-type': 'text/html' }, chunks: [html] } });
  const { item, localized } = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse' });
  const done = await localized;
  assert.strictEqual(done.assetsState, 'done');
  for (const f of ['reader.html', 'original.html']) {
    assert.match(t.service.readFile(item, f), /<a href="https:\/\/other\.example\/report" target="_blank" rel="noopener noreferrer">the report<\/a>/, f);
  }
});

test('gate r1 A2: the heavy work runs in a worker - a hostile page never stalls the event loop, and a slow Reader saves Original-only', async () => {
  const { processInWorker } = require('../../lib/pages/process');
  const hostile = ('<div>'.repeat(195) + '<p>x, y.</p>' + '</div>'.repeat(195)).repeat(600);
  let last = Date.now();
  let worstGap = 0;
  const tick = setInterval(() => { const now = Date.now(); worstGap = Math.max(worstGap, now - last); last = now; }, 20);
  const t0 = Date.now();
  const got = await processInWorker(hostile, 'https://evil.example/a', { deadlineMs: 4000 });
  clearInterval(tick);
  const total = Date.now() - t0;
  assert.ok(worstGap < 500, `the event loop stalled ${worstGap} ms`);
  assert.ok(total < 6000, `bounded by the deadline (${total} ms)`);
  assert.ok(got.original, 'the Original phase finished: ' + got.error);
  assert.strictEqual(got.reader, null, 'the Reader phase was cut at the deadline');
  // No phase in time: nothing is written and the save answers an error.
  const { buildFromUrl } = require('../../lib/pages/capture');
  await assert.rejects(buildFromUrl({ url: 'https://evil.example/a', html: hostile }, { deadlineMs: 1 }), (err) => err.status === 422);
  // The control: a normal page gets both phases.
  const ok = await processInWorker(ARTICLE(), 'https://news.example.com/boathouse');
  assert.ok(ok.original && ok.reader, ok.error);
});

test('gate r2 A7: captures are bounded - past the active + waiting slots a save is refused at once (503, a message), never a pile of workers', async () => {
  const slowRoutes = { ...BASE_ROUTES, 'https://news.example.com/photo.png': { status: 200, chunks: [PNG], delayMs: 600 } };
  const t = setup(slowRoutes, { maxActive: 1, maxWaiting: 0 });
  const first = await t.capture.saveUrl(1, { url: 'https://news.example.com/boathouse', html: ARTICLE() });
  assert.deepStrictEqual(t.capture.limiter.stats(), { active: 1, waiting: 0 }, 'the first save holds its slot through the image localization');
  await assert.rejects(t.capture.saveUrl(1, { url: 'https://news.example.com/other', html: ARTICLE() }), (err) => err.status === 503 && /busy saving other pages/.test(err.message));
  await first.localized;
  assert.deepStrictEqual(t.capture.limiter.stats(), { active: 0, waiting: 0 }, 'released when the images are stored');
  const third = await t.capture.saveUrl(1, { url: 'https://news.example.com/third', html: ARTICLE() });
  await third.localized;
  assert.strictEqual(t.service.index.countAll(), 2);
});

test('gate r2 A7: the limiter - a refused acquire never takes a slot; a waiting one runs in order; a resume (wait) always waits', async () => {
  const { createLimiter } = require('../../lib/pages/capture');
  const l = createLimiter(1, 1);
  const r1 = await l.acquire();
  const order = [];
  const p2 = l.acquire().then((rel) => { order.push('second'); return rel; });
  await assert.rejects(l.acquire(), (e) => e.status === 503);
  const p4 = l.acquire({ wait: true }).then((rel) => { order.push('resume'); return rel; });
  assert.deepStrictEqual(l.stats(), { active: 1, waiting: 2 });
  r1();
  (await p2)();
  (await p4)();
  assert.deepStrictEqual(order, ['second', 'resume']);
  assert.deepStrictEqual(l.stats(), { active: 0, waiting: 0 });
});
