'use strict';

// [UNIT] v1.393.0 W2 (plan 2026-10-20-listing-overflow, R2): the list pass never holds yt-dlp's whole
// `--dump-json` output. Bound here: (1) the slim result is BYTE-IDENTICAL in effect to today's full parse - the
// same entries, in order, carrying every field any reader of a list entry reads, and every decision the
// readers make (premiere defer, availability skip, Shorts, cutoff, id, title) is unchanged - proven on a fixture
// of real `--dump-json` lines at every chunking, multi-byte characters split across chunks included; (2) the
// field list covers every reader (a scan, so a new reader of a dropped field fails here); (3) an over-long line
// is skipped and counted, an over-budget entry is dropped and counted, neither crashes; (4) through a REAL child
// writing more than 0x1fffffe8 bytes (the production trigger) the run resolves ok with the slim entries, and the
// test process stays small - the streaming is what keeps it small.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const engine = require('../../lib/ytdlp/engine');
const run = require('../../lib/ytdlp/run');
const rules = require('../../lib/ytdlp/rules');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'ytdlp-list', 'real-dump-json.ndjson');
const fixtureText = fs.readFileSync(FIXTURE, 'utf8');
const fixtureBytes = Buffer.from(fixtureText, 'utf8');

const pick = (obj) => {
  const out = {};
  for (const f of run.LIST_KEEP_FIELDS) if (Object.prototype.hasOwnProperty.call(obj, f)) out[f] = obj[f];
  return out;
};
function slimThrough(buf, chunkSize, limits) {
  const c = run.makeSlimListCollector(run.LIST_KEEP_FIELDS, limits);
  for (let i = 0; i < buf.length; i += chunkSize) c.push(buf.subarray(i, i + chunkSize));
  c.end();
  return c;
}

const dirs = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

test('R2 byte-identical: the slim parse equals the full parse projected to the kept fields, at every chunking', () => {
  const full = rules.parseYtdlpVideoList(fixtureText);
  assert.ok(full.length >= 9, 'the fixture carries real + edge entries: ' + full.length);
  const expected = full.map(pick);
  for (const size of [1, 7, 4096, 65536, fixtureBytes.length]) {
    const slim = rules.parseYtdlpVideoList(slimThrough(fixtureBytes, size).text());
    assert.deepStrictEqual(slim, expected, 'chunk size ' + size);
  }
});

test('R2 byte-identical: every reader decision is unchanged on the slim entries', () => {
  const full = rules.parseYtdlpVideoList(fixtureText);
  const slim = rules.parseYtdlpVideoList(slimThrough(fixtureBytes, 4096).text());
  assert.strictEqual(slim.length, full.length);
  const now = Date.now();
  for (let i = 0; i < full.length; i++) {
    const a = full[i];
    const b = slim[i];
    assert.deepStrictEqual(rules.shouldDeferPremiere(b, now), rules.shouldDeferPremiere(a, now), 'defer ' + a.id);
    for (const opts of [{}, { allowMembersOnly: true, cookiesConfigured: true }]) {
      assert.deepStrictEqual(rules.shouldSkip(b, opts), rules.shouldSkip(a, opts), 'skip ' + a.id);
    }
    assert.strictEqual(rules.isShort(b), rules.isShort(a), 'short ' + a.id);
    for (const cutoff of ['20200101', '20260101', '20261015', undefined]) {
      assert.strictEqual(rules.isBeforeCutoff(b, cutoff), rules.isBeforeCutoff(a, cutoff), 'cutoff ' + a.id);
    }
    assert.strictEqual(b.id, a.id);
    assert.strictEqual(b.title, a.title);
    assert.strictEqual(b.extractor || b.extractor_key, a.extractor || a.extractor_key);
    assert.strictEqual(b.channel_id, a.channel_id);
  }
  // The edge entries really exercise the rules (not a vacuous equality).
  const byId = Object.fromEntries(slim.map((v) => [v.id, v]));
  assert.strictEqual(rules.isShort(byId.shortsAAAA1), true);
  assert.strictEqual(rules.shouldDeferPremiere(byId.liveBBBBBB2, now), true);
  assert.strictEqual(rules.shouldSkip(byId.membersCCC3, {}).skip, true);
  assert.strictEqual(rules.isBeforeCutoff(byId.noextrDDDD4, '20260101'), true);
  assert.strictEqual(byId.liveBBBBBB2.title, 'Premiere éè ☃ \u{1F600}');
});

test('R2 the slim output is small: the kept fields only, no formats / captions', () => {
  const slimText = slimThrough(fixtureBytes, 4096).text();
  assert.ok(slimText.length < fixtureBytes.length / 20, `slim ${slimText.length} of ${fixtureBytes.length}`);
  assert.doesNotMatch(slimText, /automatic_captions|"formats"/);
});

test('R2 contract: every field a reader of a list entry reads is in LIST_KEEP_FIELDS (an inert-sibling-list guard)', () => {
  const root = path.join(__dirname, '..', '..', 'lib', 'ytdlp');
  const rulesSrc = fs.readFileSync(path.join(root, 'rules.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const read = new Set();
  for (const m of rulesSrc.matchAll(/videoMeta\.([a-z_]+)/g)) read.add(m[1]);
  const cycle = indexSrc.slice(indexSrc.indexOf('async function runSubscriptionCycle('), indexSrc.indexOf('async function runSubscriptionCycle(') + 40000);
  const cycleEnd = cycle.indexOf('\n}\n');
  for (const m of cycle.slice(0, cycleEnd).matchAll(/\b(?:video|v|withChannelId)\.([a-z_]+)/g)) read.add(m[1]);
  const mapFn = indexSrc.slice(indexSrc.indexOf('function mapItemFailuresForActivity('));
  for (const m of mapFn.slice(0, mapFn.indexOf('\n}\n')).matchAll(/\bvideo\.([a-z_]+)/g)) read.add(m[1]);
  assert.ok(read.size >= 12, 'the scan must find the readers: ' + [...read].join(','));
  const missing = [...read].filter((f) => !run.LIST_KEEP_FIELDS.includes(f));
  assert.deepStrictEqual(missing, [], 'a reader reads a field the list pass drops: ' + missing.join(','));
});

test('R2 limits: a line over the cap is skipped and counted, its neighbours kept; an over-budget entry is dropped and counted', () => {
  const ok = (id) => JSON.stringify({ id, title: 't' }) + '\n';
  const huge = JSON.stringify({ id: 'huge', pad: 'x'.repeat(5000) }) + '\n';
  const buf = Buffer.from(ok('a') + huge + ok('b') + huge.trimEnd(), 'utf8'); // the last (over-long) line has no newline
  for (const size of [1, 13, 100000]) {
    const c = slimThrough(buf, size, { lineCapBytes: 1000 });
    assert.deepStrictEqual(rules.parseYtdlpVideoList(c.text()).map((v) => v.id), ['a', 'b'], 'chunk ' + size);
    assert.strictEqual(c.stats().skippedLines, 2, 'chunk ' + size);
  }
  const many = Buffer.from(['a', 'b', 'c', 'd'].map(ok).join(''), 'utf8');
  const c = slimThrough(many, 5, { keptCapBytes: ok('a').length * 2 });
  assert.deepStrictEqual(rules.parseYtdlpVideoList(c.text()).map((v) => v.id), ['a', 'b']);
  assert.strictEqual(c.stats().droppedOverBudget, 2);
});

test('R2 a malformed / non-object / blank / truncated line is skipped exactly like parseYtdlpVideoList', () => {
  const text = '{"id":"a"}\n\n   \nnot json\n[1]\n42\nnull\n{"id":"trunc';
  const slim = rules.parseYtdlpVideoList(slimThrough(Buffer.from(text), 3).text());
  assert.deepStrictEqual(slim, rules.parseYtdlpVideoList(text).map(pick));
  assert.deepStrictEqual(slim.map((v) => v.id), ['a']);
});

test('R2 a real child writing more than 0x1fffffe8 bytes resolves ok with the slim entries, in a small test process (the production wedge)', { timeout: 180000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-liststream-'));
  dirs.push(d);
  const bin = path.join(d, 'fake-ytdlp');
  const ENTRIES = 560; // 560 x about 1 MiB is above 0x1fffffe8 (536870888) bytes
  fs.writeFileSync(bin, `#!${process.execPath}
const filler = 'x'.repeat(1024 * 1024 - 100);
let i = 0;
function pump() {
  while (i < ${ENTRIES}) {
    const line = JSON.stringify({ id: 'vid' + i, title: 'T' + i, upload_date: '20261020', pad: filler }) + '\\n';
    i += 1;
    if (!process.stdout.write(line)) { process.stdout.once('drain', pump); return; }
  }
  process.exit(0);
}
pump();
`, { mode: 0o755 });
  const orig = engine.activeBinaryPath;
  engine.activeBinaryPath = () => bin;
  const base = process.memoryUsage();
  let peak = 0;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    peak = Math.max(peak, m.arrayBuffers + m.heapUsed - base.arrayBuffers - base.heapUsed);
  }, 25);
  try {
    const t0 = Date.now();
    const r = await run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 170000, listFields: run.LIST_KEEP_FIELDS });
    const ms = Date.now() - t0;
    assert.strictEqual(r.ok, true, JSON.stringify({ ...r, stdout: r.stdout.length }));
    assert.ok(r.listStats.bytesSeen > 0x1fffffe8, 'the child wrote ' + r.listStats.bytesSeen);
    const videos = rules.parseYtdlpVideoList(r.stdout);
    assert.strictEqual(videos.length, ENTRIES);
    assert.deepStrictEqual(videos[0], { id: 'vid0', title: 'T0', upload_date: '20261020' });
    assert.ok(r.stdout.length < 100000, 'slim stdout ' + r.stdout.length);
    console.log(`# list-stream: ${r.listStats.bytesSeen} bytes in ${ms} ms, peak test-process growth ${(peak / 1048576).toFixed(1)} MB`);
    // Buffers + JS heap, not RSS (RSS carries other tests' garbage when files share a process). Whole-output
    // buffering would show more than 500 MB here.
    assert.ok(peak < 100 * 1048576, 'the test process grew by ' + (peak / 1048576).toFixed(1) + ' MB');
  } finally {
    clearInterval(sampler);
    engine.activeBinaryPath = orig;
  }
});

test('R2 reachability: runList (the real list seam) slims the child output - not just spawnYtdlp called with the option', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-runlist-'));
  dirs.push(d);
  const bin = path.join(d, 'fake-ytdlp');
  fs.writeFileSync(bin, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ id: 'a1', title: 'T', upload_date: '20261020', automatic_captions: { en: ['x'.repeat(5000)] } }) + '\\n');\n`, { mode: 0o755 });
  const orig = engine.activeBinaryPath;
  engine.activeBinaryPath = () => bin;
  try {
    const config = { downloadDir: d, cookiesFile: null };
    const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
    const r = await run.runList(sub, config);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(rules.parseYtdlpVideoList(r.stdout), [{ id: 'a1', title: 'T', upload_date: '20261020' }]);
    assert.strictEqual(r.listStats.entries, 1);
  } finally {
    engine.activeBinaryPath = orig;
  }
});
