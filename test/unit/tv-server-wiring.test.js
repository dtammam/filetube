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
const AUTH_STORE = fs.readFileSync(path.join(__dirname, '../../lib/auth/store.js'), 'utf8');
const strip = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

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
  const body = strip(SERVER.slice(SERVER.indexOf("app.get('/tvepisode/:id'"), SERVER.indexOf("app.get('/tvepisode/:id'") + 2400));
  assert.match(body, /needsTranscode\(ep\.ext, ep\.codec, ep\.audioCodec\)/,
    'codec-aware, mirroring the main video path - an HEVC/AC3-in-mp4 episode is NOT served raw');
  assert.doesNotMatch(body, /needsTranscode\(ep\.ext\)/,
    'the ext-only form (the codec-blind bug) is gone - reverting to it turns this red');
  assert.match(body, /sendRangeable\(req, res, rendition, 'video\/mp4', \(\) => markServed\(rendition\)\)/,
    'a cached rendition is marked live-watched so the shared transcode-cache LRU/age sweep leaves it alone mid-stream');
});

// ---- runTvScan: prune discipline (the persist-gate lessons) -----------------

test('runTvScan: Shows-less no-op, mount-loss guard, prune carrier, thumb pass, orphan cleanup', () => {
  const body = strip(SERVER.slice(SERVER.indexOf('async function runTvScan()'), SERVER.indexOf('async function scanTv()')));
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
  const body = strip(SERVER.slice(SERVER.indexOf("app.post('/api/tv/config'"), SERVER.indexOf("app.post('/api/tv/scan'")));
  assert.match(body, /if \(!requireAdmin\(req, res\)\) return;/, 'library config is admin-only (write-RBAC)');
  assert.match(body, /foldersOverlap\(tvRoot, mediaRoot\)/);
  assert.match(body, /foldersOverlap\(tvRoot, bookRoot\)/);
  assert.match(body, /foldersOverlap\(tvRoot, musicRoot\)/);
  assert.match(body, /foldersOverlap\(tvRoot, podcastsRoot\)/, 'a Shows root may not overlap the podcasts root');
  assert.match(body, /tvStore\.ensureTv\(db\)\.folders = resolved;/);
  assert.match(body, /scanTv\(\)\.catch\(console\.error\);/, 'a config save triggers a scan');
});

test('GET /api/tv/config is visibility-GATED (a restricted member sees only roots with visible episodes)', () => {
  const body = strip(SERVER.slice(SERVER.indexOf("app.get('/api/tv/config'"), SERVER.indexOf("app.post('/api/tv/config'")));
  assert.match(body, /visibleConfigRoots\(req, ns\.folders \|\| \[\], Object\.values\(ns\.episodes \|\| \{\}\), tvEpisodeVisibleTo\)/,
    'the nav-gate config filters roots through the SINGLE visibility decision (tvEpisodeVisibleTo)');
});

test('the RECIPROCAL overlap clause is present in the media/book/music config routes (order-independent ownership)', () => {
  // Adding a media/book/music root that overlaps an existing Shows root must be
  // rejected too - not just adding a Shows root over them (the "enumerate every
  // route" completeness lesson). Podcasts' root is module-owned (no config route),
  // so the tv route's own check covers that direction.
  for (const label of ['Media', 'Book', 'Music']) {
    assert.match(SERVER, new RegExp(`overlaps a Shows folder: \\$\\{\\w+Root\\} <-> \\$\\{tvRoot\\}`),
      'a Shows-overlap reciprocal clause exists');
    assert.ok(SERVER.includes(`${label} folder overlaps a Shows folder`), `${label} config route rejects overlap with a Shows root`);
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
