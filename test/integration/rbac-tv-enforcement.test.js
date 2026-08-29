'use strict';

// [INTEGRATION] v1.195 TV Shows serve behaviour + RBAC enforcement. A member
// restricted on a path prefix is 404'd on every episode-serve/detail route and
// omitted from the shows grid + poster; the allowed show and the admin are
// unaffected. Every route routes its decision through the SINGLE
// tvEpisodeVisibleTo/isBlocked point. Also (gate additions): the live browse
// responses flow through the real client builders (v1.184 anti-inert
// reachability), and a codec-incompatible episode in a browser-native container
// transcodes rather than serving raw. Isolated DATA_DIR; own process; cleans up.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-tv-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, userStore, __mintTestSession } = require('../../server');
const tvStore = require('../../lib/tv/store');
const tvView = require('../../public/js/tv.js');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member;
const adultShow = path.join(DATA_DIR, 'adult', 'Adult Show');
const kidsShow = path.join(DATA_DIR, 'kids', 'Kids Show');
const blockedFile = path.join(adultShow, 'Season 1', 'Adult Show S01E01 - Pilot.mp4');
const allowedFile = path.join(kidsShow, 'Season 1', 'Kids Show S01E01 - Hello.mp4');
const hevcFile = path.join(kidsShow, 'Season 1', 'Kids Show S01E02 - Codec.mp4');
const ac3File = path.join(kidsShow, 'Season 1', 'Kids Show S01E03 - Sound.mp4');

before(async () => {
  fs.mkdirSync(path.join(adultShow, 'Season 1'), { recursive: true });
  fs.mkdirSync(path.join(kidsShow, 'Season 1'), { recursive: true });
  fs.writeFileSync(blockedFile, 'BLOCKED');
  fs.writeFileSync(allowedFile, 'ALLOWED');
  fs.writeFileSync(hevcFile, 'HEVCBYTES');
  fs.writeFileSync(ac3File, 'AC3BYTES');
  fs.writeFileSync(path.join(adultShow, 'poster.jpg'), 'ADULTPOSTER');
  fs.writeFileSync(path.join(kidsShow, 'poster.jpg'), 'KIDSPOSTER');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    const ns = tvStore.ensureTv(db);
    ns.folders = [path.join(DATA_DIR, 'adult'), path.join(DATA_DIR, 'kids')];
    ns.episodes = {
      blk: { id: 'blk', filePath: blockedFile, rootFolder: path.join(DATA_DIR, 'adult'), showId: 'sh-blk', showPath: adultShow, showName: 'Adult Show', seasonNum: 1, episodeNum: 1, title: 'Pilot', ext: '.mp4', durationSec: 100, addedAt: 1 },
      ok: { id: 'ok', filePath: allowedFile, rootFolder: path.join(DATA_DIR, 'kids'), showId: 'sh-ok', showPath: kidsShow, showName: 'Kids Show', seasonNum: 1, episodeNum: 1, title: 'Hello', ext: '.mp4', durationSec: 100, addedAt: 2 },
      // An .mp4 (browser-native CONTAINER) that carries an incompatible VIDEO
      // codec - the common TV-rip shape. Under the kids show so it never changes
      // the show-grouping counts the RBAC tests above assert.
      hevc: { id: 'hevc', filePath: hevcFile, rootFolder: path.join(DATA_DIR, 'kids'), showId: 'sh-ok', showPath: kidsShow, showName: 'Kids Show', seasonNum: 1, episodeNum: 2, title: 'Codec', ext: '.mp4', codec: 'hevc', audioCodec: 'aac', durationSec: 100, addedAt: 3 },
      // Gate round-1 SUGGESTION (audio axis): a CLEAN video codec with an
      // incompatible AUDIO codec (ac3-in-mp4, the route comment's "most common
      // TV-rip shape") - binds the audioCodec ARGUMENT of the needsTranscode
      // calls, which the hevc fixture alone cannot (dropping it stayed green).
      ac3: { id: 'ac3', filePath: ac3File, rootFolder: path.join(DATA_DIR, 'kids'), showId: 'sh-ok', showPath: kidsShow, showName: 'Kids Show', seasonNum: 1, episodeNum: 3, title: 'Sound', ext: '.mp4', codec: 'h264', audioCodec: 'ac3', durationSec: 100, addedAt: 4 },
    };
    return true;
  });
  member = __mintTestSession({ username: 'kidtv', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: path.join(DATA_DIR, 'adult') }]);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
const asMember = (p, opts) => fetch(`${base}${p}`, { ...opts, headers: { Cookie: member.cookie, ...(opts && opts.headers) } });
const asAdmin = (p, opts) => fetch(`${base}${p}`, opts);

test('TV: restricted member is 404 on the episode serve; admin serves it', async () => {
  assert.strictEqual((await asMember('/tvepisode/blk')).status, 404, 'blocked episode -> 404 (visibility, before file-exists)');
  assert.strictEqual((await asMember('/tvepisode/ok')).status, 200, 'allowed episode streams');
  assert.strictEqual((await asMember('/tvepisode/blk?download=1')).status, 404, 'download is not an escape');
  assert.strictEqual((await asAdmin('/tvepisode/blk')).status, 200, 'admin serves the blocked episode');
});

test('TV: the shows grid + show detail omit the restricted show for a member; admin sees both', async () => {
  const memberShows = ((await (await asMember('/api/tv')).json()).shows || []).map((s) => s.id);
  assert.deepStrictEqual(memberShows, ['sh-ok'], '/api/tv omits the restricted show');
  assert.strictEqual((await asMember('/api/tv/sh-blk')).status, 404, 'show detail 404s (no visible episodes)');
  assert.strictEqual((await asMember('/api/tv/sh-ok')).status, 200);

  const adminShows = ((await (await asAdmin('/api/tv')).json()).shows || []).map((s) => s.id).sort();
  assert.deepStrictEqual(adminShows, ['sh-blk', 'sh-ok'], 'admin sees both shows');
});

test('TV: /api/search hides the restricted show AND episode from a member; admin sees both (v1.205 Wave B leak proof for the tv providers)', async () => {
  const ids = (r) => ((r.items) || []).map((i) => i.id);
  const memberShow = ids(await (await asMember('/api/search?q=Adult&type=shows&limit=50')).json());
  assert.ok(!memberShow.includes('sh-blk'), '/api/search tv-show provider hides the restricted show');
  const memberEp = ids(await (await asMember('/api/search?q=Pilot&type=shows&limit=50')).json());
  assert.ok(!memberEp.includes('blk'), '/api/search tv-episode provider hides the restricted episode');
  const adminShow = ids(await (await asAdmin('/api/search?q=Adult&type=shows&limit=50')).json());
  assert.ok(adminShow.includes('sh-blk'), 'admin /api/search finds the tv-show (discrimination)');
  const adminEp = ids(await (await asAdmin('/api/search?q=Pilot&type=shows&limit=50')).json());
  assert.ok(adminEp.includes('blk'), 'admin /api/search finds the tv-episode');
});

test('TV: the poster never leaks the restricted show to a member (placeholder), but serves it to admin', async () => {
  const memberPoster = await asMember('/tvposter/sh-blk');
  assert.match(memberPoster.headers.get('content-type') || '', /image\/svg\+xml/, 'member gets the SVG placeholder, not the real poster');
  const adminPoster = await asAdmin('/tvposter/sh-blk');
  assert.strictEqual(await adminPoster.text(), 'ADULTPOSTER', 'admin gets the real show poster file');
});

test('TV: POST /api/tv/config is admin-only (a member is 403)', async () => {
  const r = await asMember('/api/tv/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folders: [DATA_DIR] }) });
  assert.strictEqual(r.status, 403, 'a member cannot write library config');
});

// v1.184 lesson (anti-inert): drive the REAL /api/tv + /api/tv/:showId responses
// through the REAL client builders, so the browse/episode-list branches are proven
// REACHABLE with the shape the server actually emits - not just that the isolated
// builders work on a hand-authored shape.
test('TV reachability: the live browse responses render through the real client builders', async () => {
  const grid = await (await asAdmin('/api/tv')).json();
  const okShow = (grid.shows || []).find((s) => s.id === 'sh-ok');
  assert.ok(okShow, 'the live grid response carries the show the builder consumes');
  const card = tvView.buildShowCardHtml(okShow);
  assert.match(card, /Kids Show/, 'the grid card renders the show name from the live response');
  assert.match(card, /data-show-id="sh-ok"/, 'the card is clickable back to the live show id');

  const detail = await (await asAdmin('/api/tv/sh-ok')).json();
  const html = tvView.buildShowDetailHtml(detail);
  assert.match(html, /Hello/, 'the show-detail renders an episode title from the live response');
  assert.match(html, /S01E01/, 'the SxxEyy code is reachable from the live episode fields');
  assert.match(html, /data-episode-id="ok"/, 'the episode row is clickable back to the live episode id');
});

// The gate's blocking codec finding, bound BEHAVIOURALLY: a browser-native
// CONTAINER (.mp4) carrying an incompatible codec (hevc) must route to the
// transcode branch (503), not be served raw (200) - reverting the serve route to
// the ext-only needsTranscode() turns this red.
test('TV: a codec-incompatible .mp4 episode transcodes (503), while a compatible one streams (200)', async () => {
  assert.strictEqual((await asAdmin('/tvepisode/hevc')).status, 503, 'hevc-in-mp4 -> transcode branch, never served raw');
  assert.strictEqual((await asAdmin('/tvepisode/ac3')).status, 503, 'ac3-AUDIO-in-mp4 -> transcode branch too (the serve route binds its audio argument)');
  assert.strictEqual((await asAdmin('/tvepisode/ok')).status, 200, 'a codec-clean .mp4 still streams directly');
});

// v1.196 (player integration): the per-episode detail/status endpoint that lets the
// shared player drive an episode. Player-SHAPED + visibility-gated + carries the tv
// source descriptor (so the player never touches /api/videos or /video).
test('TV: GET /api/tv/episode/:id is player-shaped, tv-sourced, and visibility-gated', async () => {
  assert.strictEqual((await asMember('/api/tv/episode/blk')).status, 404, 'restricted episode -> 404 (no detail oracle)');

  const d = await (await asMember('/api/tv/episode/ok')).json();
  assert.strictEqual(d.type, 'video', 'the player treats an episode as a video source');
  assert.strictEqual(d.title, 'Hello');
  assert.strictEqual(d.showId, 'sh-ok');
  assert.strictEqual(d.streamSrc, '/tvepisode/ok', 'streams the tv route, never /video/:id');
  assert.strictEqual(d.statusUrl, '/api/tv/episode/ok', 'polls the tv detail route, never /api/videos/:id');
  assert.strictEqual(d.artUrl, '/tvposter/sh-ok');
  assert.strictEqual(d.needsTranscode, false, 'a codec-clean .mp4 plays direct');
  assert.strictEqual(d.transcodeStatus, 'ready', 'not transcoding -> ready');
  // v1.197 (W2): the description-panel display fields - fileName is the BASENAME
  // only (the full filesystem path never rides the payload).
  assert.strictEqual(d.fileName, 'Kids Show S01E01 - Hello.mp4', 'the file NAME (basename)');
  assert.ok(!JSON.stringify(d).includes(DATA_DIR), 'the full filesystem path never leaks');
  assert.strictEqual(typeof d.sizeBytes, 'number');
  assert.strictEqual(typeof d.addedAtMs, 'number');
  assert.strictEqual(d.ext, '.mp4', 'ext rides the payload (both gate seats: omitting it made Type always paint the fallback)');

  const h = await (await asAdmin('/api/tv/episode/hevc')).json();
  assert.strictEqual(h.needsTranscode, true, 'hevc-in-mp4 -> codec-aware transcode');
  assert.strictEqual(h.transcodeStatus, 'pending', 'no rendition yet -> pending (the player polls until ready)');
});

// v1.196 Phase B: per-user resume + Continue-Watching, visibility-gated. (Runs
// last - it MUTATES the member's progress/watched state for 'ok'.)
const postJson = (auth, p, body) => auth(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('TV Phase B: progress saves + reflects in the detail; continue is visibility-filtered; 90% auto-marks watched', async () => {
  assert.strictEqual((await postJson(asMember, '/api/tv/progress', { id: 'ok', timestamp: 30, duration: 100 })).status, 200);
  const d = await (await asMember('/api/tv/episode/ok')).json();
  assert.strictEqual(d.progress, 30, 'the saved resume position is reflected in the detail');

  let cont = await (await asMember('/api/tv/continue')).json();
  assert.deepStrictEqual((cont.episodes || []).map((e) => e.id), ['ok'], 'the in-progress episode is in Continue');

  // A member cannot write progress for a BLOCKED episode (404, no oracle).
  assert.strictEqual((await postJson(asMember, '/api/tv/progress', { id: 'blk', timestamp: 5, duration: 100 })).status, 404);

  // Crossing 90% auto-marks watched -> the episode leaves Continue.
  await postJson(asMember, '/api/tv/progress', { id: 'ok', timestamp: 95, duration: 100 });
  cont = await (await asMember('/api/tv/continue')).json();
  assert.deepStrictEqual((cont.episodes || []).map((e) => e.id), [], 'a >=90% episode is finished, not "continue"');
  assert.strictEqual((await (await asMember('/api/tv/episode/ok')).json()).watched, true, 'auto-marked watched');

  // Manual un-watch clears the latch.
  assert.strictEqual((await asMember('/api/tv/played', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId: 'ok' }) })).status, 200);
  assert.strictEqual((await (await asMember('/api/tv/episode/ok')).json()).watched, false, 'un-watch cleared the latch');
});

// v1.196 Phase D (the v1.195.1 gate finding): a WHOLE-LIBRARY Shows restriction is
// now creatable (VALID_LIBRARY_VALUES + the setup checkbox) AND enforced via
// KIND_TO_LIBRARY - before, `{kind:'library',value:'tv'}` 400'd, so Shows could
// only be gated per-path and a blocklist member saw every show.
test('TV: a whole-library tv restriction is CREATABLE and blocks every Shows surface', async () => {
  const noTv = __mintTestSession({ username: 'notv', role: 'member' });
  const asNoTv = (p, opts) => fetch(`${base}${p}`, { ...opts, headers: { Cookie: noTv.cookie, ...(opts && opts.headers) } });
  // CREATABLE: the restriction route now accepts a library:'tv' row (was 400).
  const put = await asAdmin(`/api/users/${noTv.user.id}/restrictions`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'blocklist', restrictions: [{ kind: 'library', value: 'tv' }] }),
  });
  assert.strictEqual(put.status, 200, 'a whole-library Shows restriction is creatable');
  // ENFORCED: the member sees no shows and is 404 on every serve/detail route.
  assert.deepStrictEqual(((await (await asNoTv('/api/tv')).json()).shows || []), [], 'the grid is empty for a tv-library-blocked member');
  assert.strictEqual((await asNoTv('/api/tv/episode/ok')).status, 404, 'episode detail 404s');
  assert.strictEqual((await asNoTv('/tvepisode/ok')).status, 404, 'episode serve 404s');
  assert.strictEqual((await asNoTv('/api/tv/sh-ok')).status, 404, 'show detail 404s');
  assert.match((await asNoTv('/tvposter/sh-ok')).headers.get('content-type') || '', /image\/svg\+xml/, 'placeholder poster, not the real file');
});


// v1.196 gate (adversarial WARNING-1): /api/tv/continue is an access-control
// AGGREGATION surface (leaks title/show/SxxEyy). Its visibility filter must be
// BOUND, not merely present. "Restrict-after-watch": a member has a resume
// position on an episode that is NOW blocked for them (written directly here, as
// if before the restriction) - Continue must exclude it and never leak its title.
// Removing the filter makes this test go red.
test('TV: /api/tv/continue never leaks a now-restricted episode the user has progress on', async () => {
  // Direct write bypasses the progress route's own gate (as a restrict-AFTER-watch
  // row would have): only the /api/tv/continue visibility filter can exclude it.
  userStore.setTvProgress(member.user.id, 'blk', { position: 20, duration: 100, updatedAt: '2026-08-27T00:00:00.000Z' });
  const cont = await (await asMember('/api/tv/continue')).json();
  assert.ok(!(cont.episodes || []).some((e) => e.id === 'blk'), 'the restricted episode is absent from Continue (drop the filter -> it appears -> red)');
  assert.ok(!JSON.stringify(cont).includes('Pilot') && !JSON.stringify(cont).includes('Adult Show'), 'its title/show name never leak into the payload');
  // Control: admin (unrestricted) with the SAME direct row DOES surface it, so the
  // member exclusion above is the filter at work, not an always-empty list.
  userStore.setTvProgress(auth.user.id, 'blk', { position: 20, duration: 100, updatedAt: '2026-08-27T00:00:01.000Z' });
  const adminCont = await (await asAdmin('/api/tv/continue')).json();
  assert.ok((adminCont.episodes || []).some((e) => e.id === 'blk'), 'admin sees the row - proves the exclusion is visibility, not emptiness');
});

// v1.197 (W3): the background-audio sidecar pair - the video /audio +
// prepare-audio posture: GATED (restricted -> 404, no oracle/CPU sink), the
// detail endpoint carries the descriptor trio the player's handoff reads.
test('TV W3: the audio sidecar pair is gated and the detail carries the bg-audio descriptor trio', async () => {
  // Restricted member: both routes 404 (no existence oracle, no CPU sink).
  assert.strictEqual((await asMember('/tvaudio/blk')).status, 404, 'sidecar bytes: restricted -> 404');
  assert.strictEqual((await asMember('/api/tv/episode/blk/prepare-audio', { method: 'POST' })).status, 404, 'pre-warm: restricted -> 404');

  // Allowed, sidecar absent: with ffmpeg the pre-warm enqueues and answers 200
  // 'pending'; without it (this CI) it 503s like the video pair (a 200 would
  // send the client's bounded repoll on a futile ~60s chain). Either way the
  // bytes route 503s while the sidecar is absent - never 200s garbage.
  const prep = await asMember('/api/tv/episode/ok/prepare-audio', { method: 'POST' });
  if (prep.status === 200) assert.strictEqual((await prep.json()).audioStatus, 'pending');
  else assert.strictEqual(prep.status, 503, 'ffmpeg-less -> 503 (the video pair parity), never a misleading 200');
  assert.strictEqual((await asMember('/tvaudio/ok')).status, 503, 'sidecar absent -> 503 (extracting/unavailable), never raw bytes');

  // The detail endpoint carries the descriptor trio the player's handoff reads.
  const d = await (await asMember('/api/tv/episode/ok')).json();
  assert.strictEqual(d.audioSrc, '/tvaudio/ok');
  assert.strictEqual(d.prepareAudioUrl, '/api/tv/episode/ok/prepare-audio');
  assert.strictEqual(d.audioStatus, 'pending', 'live file-existence readiness');
});

// v1.198.1: /tvthumb/:id (the Up-next rail's per-episode art) - gated like
// /tvepisode; with no generated frame it falls back to the show's folder poster.
test('TV: /tvthumb/:id is gated (restricted -> 404) and falls back to the folder poster', async () => {
  assert.strictEqual((await asMember('/tvthumb/blk')).status, 404, 'restricted episode art -> 404 (no oracle)');
  const t = await asMember('/tvthumb/ok');
  assert.strictEqual(t.status, 200);
  assert.strictEqual(await t.text(), 'KIDSPOSTER', 'no generated frame -> the show folder poster serves');
});

// v1.199 (Roku W1): /api/tv/:showId's per-episode rows now carry what the Roku
// channel's playback queue needs - ext, the CODEC-AWARE needsTranscode, and the
// REQUESTER's own resume position. progress must be requester-scoped (member vs
// admin rows differ on the same episode - a shared read would be a cross-user
// resume leak straight onto the TV grid).
test('TV Roku W1: show-detail episodes carry ext + codec-aware needsTranscode + requester-scoped progress', async () => {
  // Fresh, explicit progress for THIS test (never rides earlier tests' state).
  assert.strictEqual((await postJson(asMember, '/api/tv/progress', { id: 'hevc', timestamp: 41, duration: 100 })).status, 200);

  const flatten = (detail) => (detail.seasons || []).flatMap((s) => s.episodes || []);
  const memberEps = flatten(await (await asMember('/api/tv/sh-ok')).json());
  const byId = Object.fromEntries(memberEps.map((e) => [e.id, e]));

  assert.strictEqual(byId.ok.ext, '.mp4', 'ext rides each episode row (the channel picks its demuxer from it)');
  assert.strictEqual(byId.ok.needsTranscode, false, 'a codec-clean .mp4 plays direct');
  assert.strictEqual(byId.hevc.needsTranscode, true, 'hevc-in-mp4 -> transcode (codec-AWARE: reverting to ext-only turns this red)');
  // The AUDIO axis, separately bound (gate round 1: dropping the audioCodec
  // argument from the route's needsTranscode call survived the hevc-only net).
  assert.strictEqual(byId.ac3.needsTranscode, true, 'ac3-audio-in-mp4 -> transcode (the AUDIO argument binds: dropping it turns this red)');
  assert.strictEqual(byId.ac3.codec, 'h264', 'the video codec string rides the row (playback-error diagnostics)');
  assert.strictEqual(byId.ac3.audioCodec, 'ac3', 'the audio codec string rides the row');
  assert.strictEqual(byId.hevc.progress, 41, "the MEMBER's own resume position rides the member's rows");

  // Requester scoping: the ADMIN's rows carry the admin's (absent) position for
  // the same episode, never the member's 41.
  const adminEps = flatten(await (await asAdmin('/api/tv/sh-ok')).json());
  const adminHevc = adminEps.find((e) => e.id === 'hevc');
  assert.strictEqual(adminHevc.progress, 0, "progress is REQUESTER-scoped - the admin never sees the member's position");

  // The tightened-payload invariant holds: no full filesystem path leaks.
  assert.ok(!JSON.stringify(memberEps).includes(DATA_DIR), 'no full-path leak on the extended rows');
});
