'use strict';

// [UNIT] Wave 7b slice S10a (the monolith split): the TWO deliberate
// non-byte-identical tokens in lib/media/routes.js, bound behaviourally.
//
// Every other moved route body is verbatim - its free identifiers resolve from
// a `const { ... } = deps` destructure at the top of each register function.
// That destructure runs ONCE, at registration, so it SNAPSHOTS whatever it is
// handed. Two of the deps are server.js `let`s that an async probe callback
// fills in AFTER boot (`exec('ffmpeg -version')` and the TTS engine probe), so
// a snapshot would freeze them at their boot values forever: POST
// /api/videos/:id/prepare-audio would answer 503 'ffmpeg unavailable' on a box
// that has ffmpeg, and the Stats "About" row would report a null TTS version
// on a box with espeak-ng. server.js therefore hands in `ffmpegIsAvailable: () => ffmpegAvailable`
// and `() => ttsEngineVersion`, and those two reads carry a `()`.
//
// These tests drive the seams: register the routes with an accessor over a
// mutable local, flip the local AFTER registration, and assert the RESPONSE
// changes. Delete either `()` in lib/media/routes.js and the matching test
// reds (the S1a push-guard lesson: a mutable seam needs a live reader, and a
// live reader needs a test that moves it).
//
// The other half of each seam - that server.js passes an accessor rather than
// the value - is bound end-to-end for /api/stats by every integration test
// that fetches it (a value there would make `ttsEngineVersion()` a TypeError
// and the route a 500). Nothing exercises prepare-audio end to end, so the
// call-site shape is locked as text below, on the ROUTE SURFACE.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { routeSurfaceSource, routeModulePaths } = require('../helpers/route-surface');
const mediaRoutes = require('../../lib/media/routes');

const ROOT = path.join(__dirname, '..', '..');

// A minimal Express stand-in: record the handler registered for each path.
function fakeApp() {
  const handlers = new Map();
  const record = (method) => (routePath, ...rest) => {
    handlers.set(`${method} ${routePath}`, rest[rest.length - 1]);
  };
  return {
    get: record('get'),
    post: record('post'),
    put: record('put'),
    patch: record('patch'),
    delete: record('delete'),
    handlers,
  };
}

function fakeRes() {
  const res = {
    code: 200,
    body: undefined,
    headers: {},
    status(c) { res.code = c; return res; },
    json(b) { res.body = b; return res; },
    send(b) { res.body = b; return res; },
    setHeader(k, v) { res.headers[k] = v; },
  };
  return res;
}

test('S10a seam: POST /api/videos/:id/prepare-audio reads ffmpegAvailable LIVE, not as a registration-time snapshot', () => {
  let ffmpegAvailable = false; // exactly server.js's boot value
  const app = fakeApp();
  mediaRoutes.registerPrepareAudioRoute(app, {
    audioPath: (id) => `/nowhere/${id}.m4a`,
    ffmpegIsAvailable: () => ffmpegAvailable,
    fs: { existsSync: () => false }, // the sidecar is missing, so the ffmpeg gate is reached
    healStaleAudioReady: () => 'pending',
    loadDatabase: () => ({ metadata: { v1: { id: 'v1', type: 'video', filePath: '/lib/v1.mp4' } } }),
    mediaVisibleTo: () => true,
    queueAudioExtract: () => {},
  });
  const handler = app.handlers.get('post /api/videos/:id/prepare-audio');
  assert.ok(typeof handler === 'function', 'the route registered');

  const req = { params: { id: 'v1' }, user: { id: 'u1', role: 'admin' } };
  const before = fakeRes();
  handler(req, before);
  assert.strictEqual(before.code, 503, 'with ffmpeg still absent the pre-warm refuses');
  assert.deepStrictEqual(before.body, { error: 'ffmpeg unavailable' });

  // The probe callback lands - exactly what happens a few hundred ms into boot.
  ffmpegAvailable = true;
  const after = fakeRes();
  handler(req, after);
  assert.strictEqual(after.code, 200, 'the SAME registered handler must see the flipped value (a snapshot would still 503)');
  assert.deepStrictEqual(after.body, { audioStatus: 'pending' });
});

test('S10a seam: GET /api/stats reads ttsEngineVersion LIVE, not as a registration-time snapshot', () => {
  let ttsEngineVersion = null; // exactly server.js's boot value
  const app = fakeApp();
  const empty = { getAll: () => ({}), list: () => [], read: () => ({ items: {}, progress: {}, audio: {}, tracks: {}, folders: [] }) };
  mediaRoutes.registerLibraryRoutes(app, {
    APP_VERSION: '9.9.9',
    CRITTER_IMAGE_EXTS: new Set(['.png']),
    CRITTER_SOUND_EXTS: new Set(['.mp3']),
    CRITTER_UPLOAD_EXT_FOR_MIME: {},
    CRITTER_UPLOAD_IMAGE_TYPES: {},
    CRITTER_UPLOAD_SOUND_TYPES: {},
    MAX_MEDIA_DIMENSION: 8192,
    REPO_URL: 'https://example.invalid/repo',
    bookVisibleTo: () => true,
    booksDb: empty,
    buildStoreZip: () => Buffer.alloc(0),
    configuredLibraryRoots: () => [],
    crittersDir: () => '/nowhere',
    express: { raw: () => (req, res, next) => next() },
    extractYtdlpVideoId: () => null,
    folderStore: empty,
    fs: {},
    getCachedDatabase: () => ({ metadata: {} }),
    getMediaId: (x) => x,
    isPrimitiveNumericInput: () => true,
    isValidMediaDimension: () => true,
    likedStore: empty,
    loadDatabase: () => ({ metadata: {} }),
    matchRootFolder: () => null,
    mediaVisiblePredicate: () => () => true,
    mediaVisibleTo: () => true,
    moveItemToFolder: () => {},
    musicDb: empty,
    parseChapterLines: () => [],
    path: require('node:path'),
    progressStore: empty,
    refuseIfReadOnlyMedia: () => false,
    requireAdmin: () => true,
    requireModifyLibrary: () => true,
    resolveItemChapters: () => ({ chapters: [] }),
    restrictedVideoMutation: () => false,
    sanitizeCritterUploadName: () => null,
    settingsStore: { getKey: () => undefined },
    stats: require('../../lib/stats'),
    subtitles: {},
    tombstoneStore: empty,
    trackVisibleTo: () => true,
    transcript: {},
    ttsAvailable: () => false,
    ttsConfig: { engine: 'espeak-ng' },
    ttsEngineVersion: () => ttsEngineVersion,
    updateDatabase: async () => {},
    userStore: { countUsers: () => 0, getProgress: () => ({}), getLiked: () => [], getBookProgress: () => ({}) },
    validateChannelUrl: () => ({ ok: false }),
    viewCountStore: empty,
    visibleMetadataFor: () => ({}),
    withEffectiveViewCounts: () => ({}),
    ytdlp: { isEnabled: () => false, parseYtdlpConfig: () => ({}) },
    ytdlpDb: empty,
  });
  const handler = app.handlers.get('get /api/stats');
  assert.ok(typeof handler === 'function', 'the route registered');

  const req = { user: { id: 'u1', role: 'admin' }, query: {} };
  const before = fakeRes();
  handler(req, before);
  assert.strictEqual(before.body.system.tts.version, null, 'before the probe lands, no version');

  // The TTS probe callback lands.
  ttsEngineVersion = '1.51';
  const after = fakeRes();
  handler(req, after);
  assert.strictEqual(after.body.system.tts.version, '1.51', 'the SAME registered handler must see the flipped value (a snapshot would still report null)');
});

// The third seam class, and the one the deps census structurally cannot see:
// a relative require() SPECIFIER inside a moved body resolves against the file
// it now lives in. The split's own instruments are blind to it (the census
// reads module-scope identifiers; a specifier is a string literal), and a lazy
// require inside a handler only fails when that handler RUNS - in S10a it
// surfaced as MODULE_NOT_FOUND inside the bulk mover's async tail, 300s into
// an integration test. This net resolves every relative specifier in every
// extracted module of the surface, so the next slice's re-rooting mistake reds
// a unit test instead of a release suite.
test('S10a class net: every relative require() in an extracted split module resolves from THAT module', () => {
  const mods = routeModulePaths();
  assert.ok(mods.length > 0, 'sanity: the surface has extracted modules');
  // Specifiers come from the AST, not a regex: the first cut matched the
  // specifier quoted in this module's OWN header comment and failed on a
  // sentence, not on code (the repo's comment-porosity lesson, again).
  const espree = require('espree');
  const specifiers = (src) => {
    const found = [];
    (function walk(node) {
      if (!node || typeof node.type !== 'string') return;
      // require('x'), require.resolve('x') and import('x') are the three spellings of
      // a relative specifier (the R2 gate's S1: the first cut saw only the first).
      const isRequire = node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require';
      const isResolve = node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'require' && node.callee.property.name === 'resolve';
      const isImport = node.type === 'ImportExpression';
      if (isRequire || isResolve || isImport) {
        const a = isImport ? node.source : node.arguments[0];
        if (a && a.type === 'Literal' && typeof a.value === 'string' && a.value.startsWith('.')) found.push(a.value);
      }
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'range') continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c));
        else if (v && typeof v.type === 'string') walk(v);
      }
    }(espree.parse(src, { ecmaVersion: 'latest', sourceType: 'script' })));
    return found;
  };
  let checked = 0;
  for (const rel of mods) {
    const abs = path.join(ROOT, rel);
    for (const spec of specifiers(fs.readFileSync(abs, 'utf8'))) {
      checked += 1;
      assert.doesNotThrow(
        () => require.resolve(spec, { paths: [path.dirname(abs)] }),
        `${rel} requires ${spec}, which does not resolve from ${path.dirname(rel)} - a moved body's relative specifier follows the FILE, not the caller`
      );
    }
  }
  assert.ok(checked > 0, 'sanity: the net actually resolved something (a vacuous pass is not a pass)');
});

test('S10a seam: server.js hands BOTH live seams in as accessors, never as the value', () => {
  const surface = routeSurfaceSource();
  assert.ok(surface.includes('ffmpegIsAvailable: () => ffmpegAvailable'),
    'the prepare-audio call site must pass an accessor - `ffmpegAvailable,` would snapshot the boot value');
  assert.ok(surface.includes('ttsEngineVersion: () => ttsEngineVersion'),
    'the /api/stats call site must pass an accessor - `ttsEngineVersion,` would snapshot null');
});
