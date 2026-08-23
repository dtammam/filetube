'use strict';

// [UNIT] v1.171 (Dean): critter pool MANAGEMENT - the web UI for uploading,
// deleting and downloading the critter folder's images/sounds. This file binds
// the server's pure core: the upload filename gate (a path-traversal surface),
// the magic-byte validators, and the dependency-free store-only zip builder.
// The route-level admin gating is enforced by route-write-classification /
// rbac-census; the destructive routes' resolve-against-real-entries discipline
// is bound here through the exported pure pieces plus source locks.

const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const { sanitizeCritterUploadName, buildStoreZip } = require('../../server.js');

const SERVER = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

// ---- sanitizeCritterUploadName ---------------------------------------------

test('upload name gate: accepts plain names whose extension matches the declared mime family', () => {
  assert.strictEqual(sanitizeCritterUploadName('pearl.png', 'image/png'), 'pearl.png');
  assert.strictEqual(sanitizeCritterUploadName('Mopsy.JPG', 'image/jpeg'), 'Mopsy.JPG', 'case-insensitive extension, name preserved');
  assert.strictEqual(sanitizeCritterUploadName('biscuit.jpeg', 'image/jpeg'), 'biscuit.jpeg');
  assert.strictEqual(sanitizeCritterUploadName('maple.webp', 'image/webp'), 'maple.webp');
  assert.strictEqual(sanitizeCritterUploadName('hazel.gif', 'image/gif'), 'hazel.gif');
  assert.strictEqual(sanitizeCritterUploadName('pearl.mp3', 'audio/mpeg'), 'pearl.mp3');
  assert.strictEqual(sanitizeCritterUploadName('milo.wav', 'audio/wav'), 'milo.wav');
  assert.strictEqual(sanitizeCritterUploadName('milo.wav', 'audio/x-wav'), 'milo.wav', 'browser x-wav alias');
  assert.strictEqual(sanitizeCritterUploadName('milo.m4a', 'audio/mp4'), 'milo.m4a');
  assert.strictEqual(sanitizeCritterUploadName('milo.m4a', 'audio/x-m4a'), 'milo.m4a');
  assert.strictEqual(sanitizeCritterUploadName('milo.ogg', 'audio/ogg'), 'milo.ogg');
  assert.strictEqual(sanitizeCritterUploadName('  padded.png  ', 'image/png'), 'padded.png', 'trimmed');
});

test('upload name gate: REFUSES every traversal/injection shape (the destroy-the-data surface)', () => {
  const evil = [
    '../evil.png', '..\\evil.png', 'a/../../evil.png', '/etc/passwd.png',
    'C:\\evil.png', 'a/b.png', 'a\\b.png',
    '..', '.', '.hidden.png', '.png',
    'nul\u0000.png', 'ctrl\u0001.png', 'del\u007f.png',
    '', '   ', 'x'.repeat(81) + '.png',
  ];
  for (const name of evil) {
    assert.strictEqual(sanitizeCritterUploadName(name, 'image/png'), null, JSON.stringify(name) + ' must be refused');
  }
  assert.strictEqual(sanitizeCritterUploadName(['a.png'], 'image/png'), null, 'a repeated ?name= query (array) is refused');
  assert.strictEqual(sanitizeCritterUploadName(undefined, 'image/png'), null);
});

test('upload name gate: extension and mime must AGREE; svg is never uploadable (stored-XSS posture)', () => {
  assert.strictEqual(sanitizeCritterUploadName('pearl.mp3', 'image/png'), null, 'sound extension under an image mime');
  assert.strictEqual(sanitizeCritterUploadName('pearl.png', 'audio/mpeg'), null, 'image extension under a sound mime');
  assert.strictEqual(sanitizeCritterUploadName('pearl.jpg', 'image/png'), null, 'wrong image family');
  assert.strictEqual(sanitizeCritterUploadName('pearl.svg', 'image/svg+xml'), null, 'svg mime not in the upload allowlist');
  assert.strictEqual(sanitizeCritterUploadName('pearl.svg', 'image/png'), null, 'svg extension under an allowed mime');
  assert.strictEqual(sanitizeCritterUploadName('pearl.exe', 'image/png'), null);
  assert.strictEqual(sanitizeCritterUploadName('pearl', 'image/png'), null, 'no extension');
  assert.strictEqual(sanitizeCritterUploadName('README.md', 'image/png'), null, 'the folder contract file is untouchable');
});

// ---- magic-byte validators (BEHAVIORAL - QA W1 closure) ---------------------

const { CRITTER_UPLOAD_IMAGE_TYPES, CRITTER_UPLOAD_SOUND_TYPES } = require('../../server.js');

test('upload magic bytes: every declared mime ACCEPTS its real signature and REJECTS a lying body (validators called, not just present)', () => {
  // QA W1: the previous spelling of this test only source-grepped that each
  // mime HAD a validator entry - a wrong-offset signature (e.g. ftyp at 0)
  // would have shipped green and refused every real upload. Now each
  // validator is CALLED with a genuine-signature buffer and a lying one.
  const REAL = {
    'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPx')]),
    'image/gif': Buffer.from('GIF89a1'),
    'audio/mpeg': Buffer.from('ID3x'),
    'audio/wav': Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WAVEx')]),
    'audio/x-wav': Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WAVEx')]),
    'audio/mp4': Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A x')]),
    'audio/x-m4a': Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A x')]),
    'audio/ogg': Buffer.from('OggSx'),
  };
  const LIE = Buffer.from('this is not any media format at all, honest');
  const maps = { ...CRITTER_UPLOAD_IMAGE_TYPES, ...CRITTER_UPLOAD_SOUND_TYPES };
  // Completeness both ways: every parser-accepted mime has a validator, and
  // every REAL fixture above covers a validator (no orphan on either side).
  assert.deepStrictEqual(Object.keys(maps).sort(), Object.keys(REAL).sort(), 'validator maps and fixtures enumerate the same mimes');
  for (const [mime, validator] of Object.entries(maps)) {
    assert.strictEqual(validator(REAL[mime]), true, mime + ' must accept its real signature');
    assert.strictEqual(!!validator(LIE), false, mime + ' must reject a lying body');
    assert.strictEqual(!!validator(Buffer.alloc(0)), false, mime + ' must reject an empty buffer');
  }
  // The mp3 frame-sync arm (no ID3 tag): 11 set bits at the start.
  assert.strictEqual(CRITTER_UPLOAD_SOUND_TYPES['audio/mpeg'](Buffer.from([0xff, 0xfb, 0x90, 0x00])), true, 'raw mp3 frame sync accepted');
  assert.strictEqual(!!CRITTER_UPLOAD_SOUND_TYPES['audio/mpeg'](Buffer.from([0xff, 0x1b, 0x90, 0x00])), false, 'broken sync mask rejected');
  // And the parser's accept list stays in lockstep with the validator maps.
  const extMapStart = SERVER.indexOf('const CRITTER_UPLOAD_EXT_FOR_MIME');
  const extMapSrc = SERVER.slice(extMapStart, SERVER.indexOf('};', extMapStart));
  const mimes = [...new Set([...extMapSrc.matchAll(/'((?:image|audio)\/[a-z0-9+-]+)'/g)].map((m) => m[1]))];
  assert.deepStrictEqual(mimes.sort(), Object.keys(maps).sort(), 'every mime the raw parser accepts has a called validator');
});

// ---- buildStoreZip ----------------------------------------------------------

function readEocd(zip) {
  const sig = zip.readUInt32LE(zip.length - 22);
  return {
    sig,
    countThisDisk: zip.readUInt16LE(zip.length - 22 + 8),
    count: zip.readUInt16LE(zip.length - 22 + 10),
    cdSize: zip.readUInt32LE(zip.length - 22 + 12),
    cdStart: zip.readUInt32LE(zip.length - 22 + 16),
  };
}

test('buildStoreZip: structurally valid store-only zip - signatures, counts, offsets, CRCs, byte-exact stored data', () => {
  const entries = [
    { name: 'pearl.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    { name: 'pearl.mp3', data: Buffer.from('ID3-not-really-audio') },
    { name: 'm\u00f6psy.webp', data: Buffer.from('RIFFxxxxWEBP') }, // UTF-8 name survives
  ];
  const zip = buildStoreZip(entries);
  // EOCD
  const eocd = readEocd(zip);
  assert.strictEqual(eocd.sig, 0x06054b50, 'EOCD signature');
  assert.strictEqual(eocd.count, 3, 'entry count');
  assert.strictEqual(eocd.countThisDisk, 3, 'entries-THIS-DISK count matches (adversarial S1: both EOCD counts bound)');
  assert.strictEqual(eocd.cdStart + eocd.cdSize + 22, zip.length, 'EOCD geometry closes the file exactly');
  // Walk the central directory; verify every record against its local header.
  let p = eocd.cdStart;
  for (let i = 0; i < eocd.count; i += 1) {
    assert.strictEqual(zip.readUInt32LE(p), 0x02014b50, `central signature #${i}`);
    assert.strictEqual(zip.readUInt16LE(p + 10), 0, `method STORE #${i}`);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    assert.strictEqual(zip.readUInt32LE(p + 24), size, 'compressed == uncompressed under STORE');
    const nameLen = zip.readUInt16LE(p + 28);
    const localOff = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    // The matching local header - EVERY field a reader trusts (adversarial
    // S1: the central-only walk left local CRC/method/sizes mutable green).
    assert.strictEqual(zip.readUInt32LE(localOff), 0x04034b50, `local signature for ${name}`);
    assert.strictEqual(zip.readUInt16LE(localOff + 8), 0, `local method STORE for ${name}`);
    assert.strictEqual(zip.readUInt32LE(localOff + 14), crc, `local CRC matches central for ${name}`);
    assert.strictEqual(zip.readUInt32LE(localOff + 18), size, `local compressed size for ${name}`);
    assert.strictEqual(zip.readUInt32LE(localOff + 22), size, `local uncompressed size for ${name}`);
    const lNameLen = zip.readUInt16LE(localOff + 26);
    assert.strictEqual(zip.toString('utf8', localOff + 30, localOff + 30 + lNameLen), name, 'names agree');
    const data = zip.subarray(localOff + 30 + lNameLen, localOff + 30 + lNameLen + size);
    const src = entries.find((e) => e.name === name);
    assert.ok(src, `zip entry ${name} came from the input`);
    assert.ok(data.equals(src.data), `stored bytes are byte-exact for ${name}`);
    assert.strictEqual(crc, zlib.crc32(src.data) >>> 0, `CRC32 recomputed independently for ${name}`);
    assert.strictEqual((zip.readUInt16LE(localOff + 6) & 0x0800), 0x0800, 'UTF-8 name flag set');
    p += 46 + nameLen;
  }
  assert.strictEqual(p, eocd.cdStart + eocd.cdSize, 'central directory size accounts for every record');
});

test('buildStoreZip: an empty pool yields a valid empty zip (EOCD only)', () => {
  const zip = buildStoreZip([]);
  assert.strictEqual(zip.length, 22, 'bare EOCD');
  const eocd = readEocd(zip);
  assert.strictEqual(eocd.sig, 0x06054b50);
  assert.strictEqual(eocd.count, 0);
  assert.strictEqual(eocd.cdSize, 0);
  assert.strictEqual(eocd.cdStart, 0);
});

// ---- destructive-route source locks -----------------------------------------

test('delete routes: unlink targets come from the REAL directory listing, never from the caller\'s string joined into a path', () => {
  // The discipline that keeps traversal impossible even if the query slips
  // through: both DELETE routes iterate listCritterFiles() (regular files,
  // critter extensions only) and unlink only matched entries.
  const item = SERVER.slice(SERVER.indexOf("app.delete('/api/critters/item'"), SERVER.indexOf("app.delete('/api/critters/all'"));
  assert.ok(item.includes('listCritterFiles()'), 'item delete resolves against the listing');
  assert.match(item, /path\.basename\(n, path\.extname\(n\)\) === id/, 'match rule mirrors buildCritterListing basename semantics');
  assert.ok(!/fs\.unlinkSync\(path\.join\([^)]*\bid\b/.test(item), 'the caller id is NEVER joined into an unlink path');
  const all = SERVER.slice(SERVER.indexOf("app.delete('/api/critters/all'"), SERVER.indexOf("app.get('/api/critters/archive'"));
  assert.ok(all.includes('listCritterFiles()'), 'delete-all is scoped to the listing');
  const lister = SERVER.slice(SERVER.indexOf('function listCritterFiles'), SERVER.indexOf("app.post(\n  '/api/critters/upload'"));
  assert.ok(lister.includes('e.isFile()'), 'regular files only - symlinks/subdirs/README are never touched');
  assert.ok(lister.includes('CRITTER_IMAGE_EXTS.has(ext) || CRITTER_SOUND_EXTS.has(ext)'), 'critter extensions only');
});

test('every management route is admin-gated in-route (requireAdmin), matching the census classification', () => {
  for (const marker of ["app.post(\n  '/api/critters/upload'", "app.delete('/api/critters/item'", "app.delete('/api/critters/all'", "app.get('/api/critters/archive'"]) {
    const at = SERVER.indexOf(marker);
    assert.ok(at !== -1, marker + ' exists');
    const head = SERVER.slice(at, at + 600);
    assert.ok(head.includes('if (!requireAdmin(req, res)) return;'), marker + ' calls requireAdmin first');
  }
});

// ---- the client half: Settings section + manager UI -------------------------

const { JSDOM } = require('jsdom');
const SETUP_HTML = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');
const SETUP_JS = fs.readFileSync(path.join(__dirname, '../../public/js/setup.js'), 'utf8');
const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

test('setup.html: Sneaky critters is its OWN section (Dean\'s ruling) - the toggle/density MOVED out of Appearance, the manager ships hidden', () => {
  assert.match(SETUP_HTML, /<details class="setup-box sub-collapsible"[^>]*data-collapse-key="critters"[^>]*data-md-icon="paw"[^>]*open>/,
    'the section exists with its own collapse key + paw icon');
  // The toggle/density ids live inside the critters section, NOT in appearance.
  const appearance = SETUP_HTML.slice(SETUP_HTML.indexOf('data-collapse-key="appearance"'), SETUP_HTML.indexOf('data-collapse-key="critters"'));
  assert.ok(!appearance.includes('critter-mode-check'), 'the toggle left Appearance');
  const critters = SETUP_HTML.slice(SETUP_HTML.indexOf('data-collapse-key="critters"'), SETUP_HTML.indexOf('data-collapse-key="video-folders"'));
  for (const id of ['critter-mode-check', 'critter-density-select', 'critter-manager', 'critter-pool-grid',
    'critter-image-input', 'critter-sound-input', 'critter-upload-images-btn', 'critter-upload-sounds-btn',
    'critter-download-all-link', 'critter-delete-all-btn', 'critter-manager-status']) {
    assert.ok(critters.includes(`id="${id}"`), id + ' lives in the critters section');
  }
  assert.match(critters, /<div id="critter-manager" hidden>/, 'the manager ships HIDDEN (admin-only reveal)');
  assert.match(critters, /id="critter-download-all-link" href="\/api\/critters\/archive"/, 'Download all is a plain link to the archive route');
  assert.ok(!SETUP_HTML.includes('accept="image/svg') && !critters.includes('.svg'), 'svg is not offered for upload (stored-XSS posture)');
});

test('common.js: the paw icon exists for the section; style.css styles the grid + armed state with tokens', () => {
  assert.match(COMMON, /\n {2}paw: '<circle/, 'MD_ICON_PATHS.paw');
  for (const cls of ['.critter-pool-grid', '.critter-pool-item', '.critter-pool-name', '.critter-pool-empty', '.critter-delete-armed']) {
    assert.match(CSS, new RegExp(cls.replace(/\./g, '\\.') + '\\s*\\{'), cls + ' has a rule');
  }
  assert.match(CSS, /\.critter-delete-armed\s*\{[^}]*var\(--yt-red\)/, 'armed state paints the danger token');
});

test('setup.js: wireCritterManager is called ONLY from the admin branch (the reveal gate binds)', () => {
  const adminAt = SETUP_JS.indexOf("if (me.user.role === 'admin')");
  assert.ok(adminAt !== -1);
  const elseAt = SETUP_JS.indexOf('} else {', adminAt);
  const adminBranch = SETUP_JS.slice(adminAt, elseAt);
  assert.ok(adminBranch.includes('wireCritterManager(signal)'), 'wired inside the admin branch');
  const callLines = SETUP_JS.split('\n').filter((l) => l.includes('wireCritterManager(signal)') && !l.includes('function '));
  assert.strictEqual(callLines.length, 1, 'exactly ONE call site - no non-admin path can reach it');
});

// jsdom harness for the manager: mount the REAL section markup, stub fetch.
function mountManager(t, fetchImpl) {
  const critters = SETUP_HTML.slice(SETUP_HTML.indexOf('<details class="setup-box sub-collapsible" data-collapse-key="critters"'), SETUP_HTML.indexOf('data-collapse-key="video-folders"'));
  const dom = new JSDOM('<!DOCTYPE html><body>' + critters.slice(0, critters.lastIndexOf('<details')) + '</body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.fetch = fetchImpl;
  global.setActionStatus = (el, text) => { if (el && text !== null && text !== undefined) el.textContent = text; };
  const critterModeCalls = { n: 0 };
  global.applyCritterMode = () => { critterModeCalls.n += 1; };
  t.after(() => {
    delete global.window; delete global.document; delete global.fetch;
    delete global.setActionStatus; delete global.applyCritterMode;
    dom.window.close();
  });
  return { dom, critterModeCalls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function listingFetch(state) {
  // A stateful fetch stub: GET lists state.pool; DELETEs mutate it. Every call
  // is recorded verbatim for the assertions.
  const calls = [];
  const impl = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    const method = (opts && opts.method) || 'GET';
    if (method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => ({ critters: state.pool.slice() }) });
    }
    if (method === 'DELETE' && String(url).startsWith('/api/critters/item?id=')) {
      const id = decodeURIComponent(String(url).split('=')[1]);
      const before = state.pool.length;
      state.pool = state.pool.filter((c) => c.id !== id);
      const hit = state.pool.length < before;
      return Promise.resolve({ ok: hit, status: hit ? 200 : 404, json: async () => (hit ? { ok: true } : { error: 'No such critter' }) });
    }
    if (method === 'DELETE' && String(url) === '/api/critters/all') {
      const n = state.pool.length;
      state.pool = [];
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, deleted: n }) });
    }
    if (method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    }
    return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
  };
  impl.calls = calls;
  return impl;
}

const POOL2 = () => [
  { id: 'pearl', img: '/critters/pearl.png', sound: '/critters/pearl.mp3' },
  { id: 'milo', img: '/critters/milo.png', sound: null },
];

test('manager: reveals the hidden box and renders the pool grid (thumbnail, name, sound note, per-item delete)', async (t) => {
  const state = { pool: POOL2() };
  const fetchImpl = listingFetch(state);
  const { dom } = mountManager(t, fetchImpl);
  const { wireCritterManager } = require('../../public/js/setup.js');
  wireCritterManager(new dom.window.AbortController().signal);
  await flush();
  assert.strictEqual(dom.window.document.getElementById('critter-manager').hidden, false, 'the box is revealed');
  const items = dom.window.document.querySelectorAll('.critter-pool-item');
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].querySelector('img').getAttribute('src'), '/critters/pearl.png');
  assert.ok(items[0].querySelector('.critter-pool-name').textContent.includes('♪'), 'paired sound shows the note');
  assert.ok(!items[1].querySelector('.critter-pool-name').textContent.includes('♪'), 'no sound, no note');
  assert.strictEqual(items[0].querySelector('button').textContent, 'Delete');
});

test('manager DESTRUCTIVE two-tap: ONE tap NEVER deletes; the second fires exactly one DELETE for that id and refreshes', async (t) => {
  const state = { pool: POOL2() };
  const fetchImpl = listingFetch(state);
  const { dom, critterModeCalls } = mountManager(t, fetchImpl);
  const { wireCritterManager } = require('../../public/js/setup.js');
  wireCritterManager(new dom.window.AbortController().signal);
  await flush();
  const del = dom.window.document.querySelectorAll('.critter-pool-item button')[0];
  del.click();
  await flush();
  assert.strictEqual(fetchImpl.calls.filter((c) => c.opts.method === 'DELETE').length, 0, 'first tap ARMS, never deletes');
  assert.strictEqual(del.textContent, 'Really delete?');
  assert.ok(del.classList.contains('critter-delete-armed'));
  del.click();
  await flush(); await flush();
  const dels = fetchImpl.calls.filter((c) => c.opts.method === 'DELETE');
  assert.strictEqual(dels.length, 1, 'exactly one DELETE');
  assert.strictEqual(dels[0].url, '/api/critters/item?id=pearl');
  assert.ok(critterModeCalls.n >= 1, 'applyCritterMode fired (manifest cache bust + live re-scatter)');
  const items = dom.window.document.querySelectorAll('.critter-pool-item');
  assert.strictEqual(items.length, 1, 'the grid re-rendered from the fresh listing');
  assert.strictEqual(items[0].querySelector('button').textContent, 'Delete', 'the rebuilt row is UNARMED (v1.159/v1.162: state never leaks across renders)');
});

test('manager delete-all two-tap: the armed label carries the LIVE count; the second tap fires DELETE /api/critters/all', async (t) => {
  const state = { pool: POOL2() };
  const fetchImpl = listingFetch(state);
  const { dom, critterModeCalls } = mountManager(t, fetchImpl);
  const { wireCritterManager } = require('../../public/js/setup.js');
  wireCritterManager(new dom.window.AbortController().signal);
  await flush();
  const btn = dom.window.document.getElementById('critter-delete-all-btn');
  btn.click();
  await flush();
  assert.strictEqual(fetchImpl.calls.filter((c) => c.opts.method === 'DELETE').length, 0, 'first tap arms only');
  assert.ok(btn.textContent.includes('2'), 'the armed label shows the pool count: ' + btn.textContent);
  btn.click();
  await flush(); await flush();
  const dels = fetchImpl.calls.filter((c) => c.opts.method === 'DELETE');
  assert.deepStrictEqual(dels.map((c) => c.url), ['/api/critters/all']);
  assert.ok(critterModeCalls.n >= 1);
  assert.ok(dom.window.document.querySelector('.critter-pool-empty'), 'empty state after the purge');
  assert.strictEqual(btn.textContent, 'Delete all…', 'the button disarms after firing');
});

test('manager upload: each picked file POSTs raw with its name + mime; unsupported extensions are SKIPPED client-side', async (t) => {
  const state = { pool: [] };
  const fetchImpl = listingFetch(state);
  const { dom, critterModeCalls } = mountManager(t, fetchImpl);
  const { wireCritterManager } = require('../../public/js/setup.js');
  wireCritterManager(new dom.window.AbortController().signal);
  await flush();
  const input = dom.window.document.getElementById('critter-image-input');
  const fileA = { name: 'new critter.png' };
  const fileB = { name: 'evil.svg' };
  Object.defineProperty(input, 'files', { value: [fileA, fileB], configurable: true });
  input.dispatchEvent(new dom.window.Event('change'));
  await flush(); await flush();
  const posts = fetchImpl.calls.filter((c) => c.opts.method === 'POST');
  assert.strictEqual(posts.length, 1, 'the svg never leaves the client');
  assert.strictEqual(posts[0].url, '/api/critters/upload?name=' + encodeURIComponent('new critter.png'), 'name is URI-encoded');
  assert.strictEqual(posts[0].opts.headers['Content-Type'], 'image/png');
  assert.strictEqual(posts[0].opts.body, fileA, 'the raw File is the body (the logo posture - no multipart)');
  assert.ok(critterModeCalls.n >= 1, 'a successful upload busts the manifest + re-scatters');
});
