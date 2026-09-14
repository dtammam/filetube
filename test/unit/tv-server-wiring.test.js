'use strict';

// [UNIT] v1.195 TV Shows Phase 2b: the SERVER scan wiring + config routes. The pure
// core (walk/parse/group/prune) is behaviourally bound in tv-scan/tv-parse/tv-store;
// this SOURCE-LOCKs the server glue that is not unit-driven (the scanMusic posture) -
// the mount-loss guard, the prune carrier, the coalescing guard, the config overlap
// net, the RBAC guards, and the boot hooks. Comment-stripped (the comment-porous class).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
// Wave 7b (the monolith split): slice S2 moved the book config route - one of
// the three reciprocal overlap clauses this file locks - to lib/books/routes.js,
// and slice S4 moved the Shows ROUTES to lib/tv/routes.js and the scan PASS to
// lib/tv/scanRunner.js. SURFACE is server.js PLUS every module server.js was
// split into (derived from its own requires), so a lock reads the same sentence
// wherever the slice put it. The locks that still read SERVER are the ones whose
// code is still in server.js: the module requires + exports, probeTvEpisode, the
// thumb helpers, scanTv's coalescing guard, tvEpisodeVisibleTo, and the boot
// hooks.
const { routeSurfaceSource } = require('../helpers/route-surface');

const AUTH_STORE = fs.readFileSync(path.join(__dirname, '../../lib/auth/store.js'), 'utf8');
const strip = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
// The surface is read with EVERY comment gone (block, whole-line AND trailing) - the R1
// gate's W4: raw, the reciprocal-overlap lock was satisfied by the sentence quoted in a
// comment while the guard itself had been deleted. (Declared after `strip`: the first
// prescription put it above and hit the TDZ.)
const stripAll = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const SURFACE = routeSurfaceSource((p) => stripAll(fs.readFileSync(p, 'utf8')));

// ---- module wiring ----------------------------------------------------------

test('server requires the feature-owned tv modules + exports the scanner (scanMusic posture)', () => {
  assert.match(SERVER, /const tvStore = require\('\.\/lib\/tv\/store'\);/);
  assert.match(SERVER, /const tvScan = require\('\.\/lib\/tv\/scan'\);/);
  assert.match(SERVER, /const TV_THUMB_DIR = path\.join\(DATA_DIR, '\.tvthumbs'\);/);
  // exported for parity + future integration tests
  assert.match(SERVER, /\n {2}scanTv,\n/);
  assert.match(SERVER, /\n {2}runTvScan,\n/);
});

// ---- probe ------------------------------------------------------------------

test('probeTvEpisode: ffmpeg-guarded, returns duration + video/audio codec + container, degrade-safe', () => {
  const body = strip(SERVER.slice(SERVER.indexOf('function probeTvEpisode('), SERVER.indexOf('function tvThumbPath(')));
  assert.match(body, /if \(!ffmpegAvailable\) \{ resolve\(null\); return; \}/, 'no ffmpeg -> null (degrade-safe)');
  assert.match(body, /resolve\(\{ durationSec, codec: streams\.videoCodec \|\| null, audioCodec: streams\.audioCodec \|\| null, container \}\);/,
    'audioCodec is captured too (the codec-aware transcode decision needs it)');
});

// ---- /tvepisode: codec-aware transcode + live-watch eviction guard (gate) ----

test('/tvepisode: transcode decision is CODEC-aware (not ext-only), and a served rendition is protected from mid-watch eviction', () => {
  // S4: the route moved to lib/tv/routes.js, so the window is cut from the
  // comment-free SURFACE - and, the comments gone, bounded by the NEXT route
  // instead of a 2400-char guess, which is the same window minus the slack.
  const body = strip(SURFACE.slice(SURFACE.indexOf("app.get('/tvepisode/:id'"), SURFACE.indexOf("app.get('/tvaudio/:id'")));
  assert.match(body, /needsTranscode\(ep\.ext, ep\.codec, ep\.audioCodec\)/,
    'codec-aware, mirroring the main video path - an HEVC/AC3-in-mp4 episode is NOT served raw');
  assert.doesNotMatch(body, /needsTranscode\(ep\.ext\)/,
    'the ext-only form (the codec-blind bug) is gone - reverting to it turns this red');
  assert.match(body, /sendRangeable\(req, res, rendition, 'video\/mp4', \(\) => markServed\(rendition\)\)/,
    'a cached rendition is marked live-watched so the shared transcode-cache LRU/age sweep leaves it alone mid-stream');
});

// ---- runTvScan: prune discipline (the persist-gate lessons) -----------------

test('runTvScan: Shows-less no-op, mount-loss guard, prune carrier, thumb pass, orphan cleanup', () => {
  // S4: the pass moved to lib/tv/scanRunner.js, so the window is cut from the
  // SURFACE and ends at the factory's own return (scanTv, the old end anchor,
  // stayed in server.js and now sorts BEFORE the pass in the concatenation).
  const body = strip(SURFACE.slice(SURFACE.indexOf('async function runTvScan()'), SURFACE.indexOf('return { runTvScan };')));
  assert.match(body, /if \(folders\.length === 0 && Object\.keys\(ns\.episodes\)\.length === 0\) return;/, 'Shows-less install is a total no-op');
  assert.match(body, /tvScan\.collectEpisodes\(\s*folders, ns\.episodes, \{ getId: getMediaId, getShowId: getMediaId, probe: probeTvEpisode \}\)/, 'episode id = md5(path), show id = md5(showPath)');
  // Option-C mount-loss guard: exists-but-empty root prunes NOTHING beneath it.
  assert.match(body, /hadEpisodes && !hasSurvivors/, 'the exists-but-scanned-empty unmounted-share guard');
  assert.match(body, /effectiveMissingRoots\.add\(root\)/);
  assert.match(body, /tvStore\.selectPrunableEpisodeIds\(freshNs\.episodes, survivingIds, \{ missingRoots: effectiveMissingRoots, pruneMissing, erroredDirs \}\)/);
  // the per-user prune carrier fires for pruned ids (the id-keyed-carrier lesson).
  assert.match(body, /userStore\.removeTvEpisodeState\(prunedIds\);/, 'pruned episodes shed per-user state');
  // per-episode thumbnails + shed a pruned episode's stale thumb.
  assert.match(body, /tvScan\.selectThumbJobs\(finalEpisodes, tvThumbExists\)/);
  assert.match(body, /fs\.unlinkSync\(tvThumbPath\(id\)\)/, 'a pruned episode\'s cached thumb is unlinked');
});

// ---- scanTv: coalescing guard (the scanMusic discipline verbatim) -----------

test('scanTv: single-walker coalescing + a deferred single-guarded re-entry', () => {
  const body = strip(SERVER.slice(SERVER.indexOf('async function scanTv()'), SERVER.indexOf('async function scanTv()') + 1200));
  assert.match(body, /if \(tvScanState\.scanning\) \{ tvScanState\.rescanRequested = true; return; \}/, 'a scan requested mid-scan never starts a concurrent walker');
  assert.match(body, /while \(tvScanState\.rescanRequested && followups <= MAX_RESCAN_FOLLOWUPS\)/);
  assert.match(body, /deferredTvRescanTimer = setTimeout\(/);
  assert.match(body, /deferredTvRescanTimer\.unref\(\);/, 'the deferred re-entry is unref\'d (never holds the process open)');
});

// ---- Phase 3: config routes + RBAC + the overlap net ------------------------

test('POST /api/tv/config: admin-only + rejects overlap with media/book/music/podcast (both directions via foldersOverlap)', () => {
  // S4: the config routes moved to lib/tv/routes.js - same anchors, same order,
  // read off the SURFACE.
  const body = strip(SURFACE.slice(SURFACE.indexOf("app.post('/api/tv/config'"), SURFACE.indexOf("app.post('/api/tv/scan'")));
  assert.match(body, /if \(!requireAdmin\(req, res\)\) return;/, 'library config is admin-only (write-RBAC)');
  assert.match(body, /foldersOverlap\(tvRoot, mediaRoot\)/);
  assert.match(body, /foldersOverlap\(tvRoot, bookRoot\)/);
  assert.match(body, /foldersOverlap\(tvRoot, musicRoot\)/);
  assert.match(body, /foldersOverlap\(tvRoot, podcastsRoot\)/, 'a Shows root may not overlap the podcasts root');
  // Wave 5: the write goes through the feature store's mutate (the diff rides the doc commit).
  assert.match(body, /tvDb\.mutate\(\(h\) => \{ tvStore\.ensureTv\(h\)\.folders = resolved; return true; \}\)/);
  assert.match(body, /scanTv\(\)\.catch\(console\.error\);/, 'a config save triggers a scan');
});

test('GET /api/tv/config is visibility-GATED (a restricted member sees only roots with visible episodes)', () => {
  const body = strip(SURFACE.slice(SURFACE.indexOf("app.get('/api/tv/config'"), SURFACE.indexOf("app.post('/api/tv/config'"))); // S4: moved to lib/tv/routes.js
  assert.match(body, /visibleConfigRoots\(req, ns\.folders \|\| \[\], Object\.values\(ns\.episodes \|\| \{\}\), tvEpisodeVisibleTo\)/,
    'the nav-gate config filters roots through the SINGLE visibility decision (tvEpisodeVisibleTo)');
});

test('the RECIPROCAL overlap clause is present in the media/book/music config routes (order-independent ownership)', () => {
  // Adding a media/book/music root that overlaps an existing Shows root must be
  // rejected too - not just adding a Shows root over them (the "enumerate every
  // route" completeness lesson). Podcasts' root is module-owned (no config route),
  // so the tv route's own check covers that direction.
  for (const label of ['Media', 'Book', 'Music']) {
    assert.match(SURFACE, new RegExp(`overlaps a Shows folder: \\$\\{\\w+Root\\} <-> \\$\\{tvRoot\\}`),
      'a Shows-overlap reciprocal clause exists');
    assert.ok(SURFACE.includes(`${label} folder overlaps a Shows folder`), `${label} config route rejects overlap with a Shows root`);
  }
});

test('tvEpisodeVisibleTo routes through the single visibility decision (kind:tv), and KIND_TO_LIBRARY maps tv', () => {
  const helper = strip(SERVER.slice(SERVER.indexOf('function tvEpisodeVisibleTo('), SERVER.indexOf('function tvEpisodeVisibleTo(') + 400));
  assert.match(helper, /visibility\.isBlocked\(userRestrictionIndex\(req\), \{ kind: 'tv', filePath: ep\.filePath, rootFolder: ep\.rootFolder \}\)/,
    'no route re-implements the check - it goes through isBlocked with kind:tv');
  const VIS = fs.readFileSync(path.join(__dirname, '../../lib/auth/visibility.js'), 'utf8');
  assert.match(VIS, /const KIND_TO_LIBRARY = \{[^}]*tv: 'tv'[^}]*\}/, 'a whole-library "tv" restriction is honoured');
});

// ---- boot hooks -------------------------------------------------------------

test('scanTv rides BOTH boot slots (the periodic interval AND the deferred first-boot scan)', () => {
  // Two call sites in the boot code + the one inside scanTv's own deferred re-entry.
  const hooks = (SERVER.match(/\n\s*scanTv\(\)\.catch\(console\.error\);/g) || []).length;
  assert.ok(hooks >= 3, `scanTv must ride the interval + the deferred first-boot slot (+ its own re-entry) (found ${hooks})`);
});

// ---- the S4 mutable seam: ffmpeg availability is read LIVE, not at boot ------
//
// server.js's `ffmpegAvailable` is a `let` that starts FALSE and is flipped by an
// ASYNCHRONOUS probe, long after lib/tv/routes.js registers. It is the one thing
// the slice did NOT move byte-identically: the module reads `ffmpegIsAvailable()`
// and server.js passes `() => ffmpegAvailable`. Destructuring the VALUE would
// freeze it to that boot-time false - both tv queues would silently never start
// and the two 503 arms would answer "ffmpeg unavailable" forever (the v1.185
// inert-feature class, invisible on a box without ffmpeg). This EXECUTES the
// route to bind it: register while the flag is false, flip it, and the route must
// see the flip. Passing the value instead turns this red.
const tvRoutes = require('../../lib/tv/routes');

test('S4 seam: prepare-audio reads ffmpeg availability LIVE (the flag flips AFTER registration)', () => {
  const handlers = {};
  const app = {
    get: (p, h) => { handlers[`GET ${p}`] = h; },
    post: (p, h) => { handlers[`POST ${p}`] = h; },
    delete: (p, h) => { handlers[`DELETE ${p}`] = h; },
  };
  let ffmpeg = false; // the boot-time value, exactly as server.js has it at register time
  tvRoutes.registerRoutes(app, {
    TRANSCODE_DIR: path.join(__dirname, 'no-such-dir'),
    ffmpegIsAvailable: () => ffmpeg,
    fs: { existsSync: () => false },
    path,
    tvDb: { read: () => ({ episodes: { e1: { id: 'e1', filePath: '/nope/ep.mkv' } } }) },
    tvEpisodeVisibleTo: () => true,
  });
  const handler = handlers['POST /api/tv/episode/:id/prepare-audio'];
  assert.ok(handler, 'the prepare-audio route registered');
  const call = () => {
    const out = {};
    const res = { json: (b) => { out.body = b; return res; }, status: (c) => { out.code = c; return res; } };
    handler({ params: { id: 'e1' }, user: { id: 'u1' } }, res);
    return out;
  };
  assert.deepStrictEqual(call(), { code: 503, body: { error: 'ffmpeg unavailable' } }, 'ffmpeg-less: the 503 arm');
  ffmpeg = true; // the async boot probe lands
  assert.deepStrictEqual(call(), { body: { audioStatus: 'pending' } }, 'the flip is SEEN - a frozen boot-time value would still 503');
});

// ---- the prune carrier is born with the tables (lib/auth/store.js) ----------

test('lib/auth/store.js: removeTvEpisodeState + its three delete statements exist (id-keyed carrier)', () => {
  assert.match(AUTH_STORE, /delTvProgressByEpisode: sql\.prepare\('DELETE FROM user_tv_progress WHERE episode_id = \?'\)/);
  assert.match(AUTH_STORE, /delTvPlayedByEpisode: sql\.prepare\('DELETE FROM user_tv_played WHERE episode_id = \?'\)/);
  assert.match(AUTH_STORE, /delTvLikedByEpisode: sql\.prepare\('DELETE FROM user_tv_liked WHERE episode_id = \?'\)/);
  const fn = strip(AUTH_STORE.slice(AUTH_STORE.indexOf('removeTvEpisodeState(episodeIds)'), AUTH_STORE.indexOf('removeTvEpisodeState(episodeIds)') + 700));
  assert.match(fn, /s\.delTvProgressByEpisode\.run\(id\);/);
  assert.match(fn, /s\.delTvPlayedByEpisode\.run\(id\);/);
  assert.match(fn, /s\.delTvLikedByEpisode\.run\(id\);/);
});
