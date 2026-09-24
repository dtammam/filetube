'use strict';

// [UNIT] v1.40.0 — the per-card "Like" control (Dean). Source/asset locks in
// the established style of shuffle-rescan-icon.test.js: the heart is a real SVG
// mask painted in currentColor (NOT the U+2665 emoji codepoint), the card
// button mirrors the download/delete corner controls, the toggle uses the same
// db.liked API the watch page does (non-optimistic), and the list endpoint
// tags each item with `liked` so cards render their initial state. DOM behavior
// is validated on-device; these lock the wiring so a refactor fails loudly.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { routeSurfaceFiles } = require('../helpers/route-surface');

const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8');

test('assets: heart.svg exists and is a valid single-path <svg>', () => {
  const svg = fs.readFileSync(path.join(__dirname, '../../public/assets/icons/heart.svg'), 'utf8');
  assert.ok(svg.includes('<svg'), 'expected a valid <svg> document');
  assert.ok(svg.includes('<path'), 'expected a heart path');
});

test('style.css: .icon-heart is in the base chrome-icon sizing group, the @supports fill guard, and maps to heart.svg', () => {
  // v1.49: membership, not neighbour sequence -- the same correction this test
  // already applied to the fill guard below in v1.47.6. The old regex required
  // the sizing group's selector list to run from `.icon-heart` to a TERMINAL
  // `.icon-shuffle {`, so appending any new icon to that list (v1.49 added
  // `.icon-flame`) failed the test on a correct change.
  const sizingStart = css.indexOf('.icon-home,');
  assert.notEqual(sizingStart, -1, 'expected the shared chrome-icon sizing group');
  const sizingGroup = css.slice(sizingStart, css.indexOf('mask-repeat:', sizingStart));
  assert.ok(sizingGroup.includes('.icon-heart'), 'heart in the shared sizing/mask group');
  // v1.47.6: asserts MEMBERSHIP of the fill guard, not the exact neighbour
  // sequence. The original pinned `.icon-heart, .icon-download, .icon-shuffle`
  // literally, so simply inserting another icon into the list broke it -- an
  // over-specified lock that fails on correct changes while still not catching
  // the thing that matters (an icon MISSING from the list). The class-wide
  // parity check in icon-assets.test.js now covers that for every icon.
  const supportsIdx = css.indexOf('@supports (mask-image: url("#"))');
  assert.notEqual(supportsIdx, -1, 'expected the @supports fill guard');
  const fillGuard = css.slice(supportsIdx, css.indexOf('background-color: currentColor', supportsIdx));
  assert.ok(fillGuard.includes('.icon-heart'), 'heart in the currentColor fill guard');
  assert.match(css, /\.icon-heart\s*\{\s*-webkit-mask-image:\s*url\(\/assets\/icons\/heart\.svg\);/, 'heart maps to its SVG mask');
});

test('style.css: NOT the U+2665 emoji codepoint -- the heart is a mask asset, not a content glyph', () => {
  // Guard against a regression to a bare unicode heart (iOS renders U+2665 as
  // the red-heart emoji), mirroring the ⏮/⏭ lesson.
  assert.ok(!/\.icon-heart::before\s*\{\s*content/.test(css), 'heart must not be a ::before content glyph');
});

test('style.css: .card-like-btn is an absolutely-positioned corner control that turns red when liked (v1.67: anchored via .card-corner-*, default bottom-left)', () => {
  // v1.67 (plan D3): position split from identity. The like button's LOOK
  // rule (now a selector group shared with share/reheat) keeps
  // position:absolute; the ANCHOR lives on the corner classes, and the C5
  // default assigns like to bottom-left (.card-corner-bl = bottom/left 6px).
  // Match the LOOK rule by its full selector group - a looser
  // `.card-like-btn,` prefix match grabs the touch-action group at the top
  // of the file (which .card-like-btn joined in gate round 2, QA S5).
  const rule = /\.card-like-btn,\s*\.card-share-btn,\s*\.card-reheat-btn,\s*\.card-transcript-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected the .card-like-btn look rule (grouped with share/reheat)');
  assert.match(rule[1], /position:\s*absolute;/);
  assert.ok(!/bottom:/.test(rule[1]) && !/left:/.test(rule[1]),
    'the look rule must NOT carry anchor geometry (that is the corner classes\' job)');
  const bl = /\.card-corner-bl\s*\{([^}]*)\}/.exec(css);
  assert.ok(bl, 'expected the .card-corner-bl anchor class');
  assert.match(bl[1], /bottom:\s*6px;/);
  assert.match(bl[1], /left:\s*6px;/);
  assert.match(css, /\.card-like-btn\.liked\s*\{[^}]*color:\s*var\(--yt-red\)/, 'liked state paints the heart red');
});

test('the corner controls anchor to the thumbnail via .card-media (so bottom:6px reaches the thumbnail, not the card bottom)', () => {
  // v1.40.0 gate fix: overlays live in a thumbnail-height positioning box, not
  // directly on .video-card (whose bottom is below the title/meta/rating).
  const rule = /\.card-media\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a .card-media rule');
  assert.match(rule[1], /position:\s*relative;/, 'expected .card-media { position: relative }');
  // v1.40.1 regression lock: .card-media MUST be a flex column so
  // .thumbnail-container stays a flex item -- otherwise its aspect-ratio:16/9
  // height goes indefinite, .thumbnail-img{height:100%} collapses to auto, and
  // portrait/Shorts thumbnails render oversized at natural height.
  assert.match(rule[1], /display:\s*flex;/, 'card-media must be flex so the thumbnail keeps its definite 16:9 height');
  assert.match(rule[1], /flex-direction:\s*column;/);
  assert.ok(mainSrc.includes('<div class="card-media">'), 'the card wraps the thumbnail + overlays in .card-media');
});

test('main.js: the card renders a .card-like-btn reflecting item.liked, and toggles via POST/DELETE /api/liked/:id (non-optimistic)', () => {
  // v1.67: the like markup moved into the corner renderer (one appended
  // corner class after the liked flag); the seeding expression is unchanged.
  assert.ok(mainSrc.includes('class="card-like-btn${item.liked ? \' liked\' : \'\'} ${cornerClass}"'), 'the card seeds the liked class from item.liked');
  // v1.72 (#94): the toggle dispatches per KIND (data-kind on the button) -
  // bind the USE (the fetch consumes the dispatcher) and every arm of the
  // dispatcher, not just the helper's existence.
  assert.ok(mainSrc.includes('fetch(cardLikeEndpoint(btn.dataset.kind, id)'), 'the fetch consumes the kind dispatcher');
  assert.ok(mainSrc.includes("return '/api/liked/' + encId;"), 'media (default) arm hits the liked API by id');
  assert.ok(mainSrc.includes("if (kind === 'podcast') return '/api/podcasts/episodes/' + encId + '/liked';"), 'podcast arm');
  // M3 chapter likes (v1.317): a `<id>::c<n>` chapter of a chaptered audio file is
  // a MEDIA-store like; the chapter arm must sit BEFORE the native track arm or the
  // native lane (ownTrack-gated) swallows it and an unlike strands the row.
  const chapterArm = mainSrc.indexOf("if (kind === 'track' && /::c\\d+$/.test(String(id))) return '/api/liked/' + encId;");
  const nativeArm = mainSrc.indexOf("if (kind === 'track') return '/api/music/liked/' + encId;");
  assert.ok(chapterArm !== -1, 'chapter-track arm hits the media liked API');
  assert.ok(nativeArm !== -1, 'track arm');
  assert.ok(chapterArm < nativeArm, 'the chapter arm precedes the native track arm');
  // Adversarial gate v1.72 W1: the book arm survived the whole suite as a
  // deletable mutant - a book unlike falling to the media default would
  // DELETE /api/liked/<bookId>, a cross-kind kill when a media item shares
  // the md5 id. Every arm is bound or the claim "every arm" is a lie.
  assert.ok(mainSrc.includes("if (kind === 'book') return '/api/books/liked/' + encId;"), 'book arm');
  assert.ok(mainSrc.includes("method: currentlyLiked ? 'DELETE' : 'POST'"), 'DELETE when liked, POST when not');
  // Non-optimistic: the heart flips inside the resolved .then, guarded by res.ok.
  assert.ok(mainSrc.includes("if (!res.ok) throw new Error('like request failed"), 'a failed request never fakes success');
});

test('server.js: the GET /api/videos list tags each item with a `liked` flag from the USER\'s membership', () => {
  // v1.43 (chunk 4b): membership moved from the frozen db.liked record to
  // per-user user_liked rows -- the list derivation reads ONE per-request
  // membership set for the signed-in user and tags each page item from it.
  //
  // Wave 7b (slice S10a) SCOPED this to the statement. The route moved to
  // lib/media/routes.js, and reading the whole surface made the lock vacuous:
  // lib/user/routes.js carries the identical `likedSet` line (slice S1a's
  // history route), so deleting THIS route's derivation still matched - the
  // mutant survived. The window is the GET /api/videos registration up to the
  // next registration in the same file; a missing boundary reds rather than
  // silently widening (the #213 distance-lock lesson).
  const file = routeSurfaceFiles().find((p) => fs.readFileSync(p, 'utf8').includes("app.get('/api/videos', "));
  assert.ok(file, 'GET /api/videos is registered on the route surface');
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf("app.get('/api/videos', ");
  const after = /\bapp\.(?:get|post|put|patch|delete|all|use)\(/g;
  after.lastIndex = start + 1;
  const next = after.exec(src);
  assert.ok(next, 'a following route registration bounds the window');
  const body = src.slice(start, next.index);
  assert.match(body, /const likedSet = new Set\(userStore\.getLiked\(req\.user\.id\)\)/);
  assert.match(body, /liked:\s*likedSet\.has\(item\.id\)/);
});
