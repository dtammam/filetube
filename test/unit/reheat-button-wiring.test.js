'use strict';

// [UNIT] v1.49 -- the per-video "Reheat" control on the watch page.
//
// There is no jsdom/browser harness in this codebase (see CONTRIBUTING.md), so
// this follows the established structural/wiring-lock pattern of
// test/unit/move-trigger-wiring.test.js and test/unit/card-download-btn.test.js:
// assert against the raw source text that the control is built the way the rest
// of the action row is built, and that the load-bearing safety properties are
// present.
//
// What is genuinely locked here (each of these is a bug this repo has shipped
// before, in some form):
//   1. the button mounts into `.watch-action-btns` -- the nowrap sub-group --
//      so the row keeps its single-line width (Dean's explicit ask);
//   2. the glyph is a CSS-masked `.icon-flame`, never a U+1F525 codepoint (the
//      v1.38 iOS emoji-glyph lesson);
//   3. `.icon-flame` actually exists in style.css and its asset exists on disk
//      -- a mask pointing at a 404 renders NOTHING, silently;
//   4. the confirm dialog is built at runtime (showConfirmModal appends to
//      document.body), NOT added to watch.html -- markup outside `#view-root`
//      is never mounted on in-app navigation (tech-debt #34, the exact bug that
//      shipped the v1.41.7 preview modal broken);
//   5. the metadata click never calls the relocate route -- only the confirm
//      callback does;
//   6. the poll interval is cleared on view teardown.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const watchJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'watch.js'), 'utf8');
const watchHtml = fs.readFileSync(path.join(ROOT, 'public', 'watch.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
const commonJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');

// Extract a top-level `function NAME(...) { ... }` body by brace counting --
// the same technique the reheat's own no-auto-run structural lock uses
// (test/integration/ytdlp-repull-metadata-endpoint.test.js).
function functionBody(src, fnName) {
  const nameIdx = src.indexOf(`function ${fnName}(`);
  assert.ok(nameIdx >= 0, `could not locate function ${fnName} -- this test needs updating`);
  let i = src.indexOf('{', src.indexOf(')', nameIdx));
  const start = i;
  let depth = 0;
  do {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    i += 1;
  } while (depth > 0 && i < src.length);
  return src.slice(start, i);
}

// ---- 1. It is a sibling of the other five, in the nowrap sub-group ---------

test('the Reheat button mounts into .watch-action-btns, reusing the shared .btn class -- the row stays one line', () => {
  const body = functionBody(watchJs, 'setupReheatButton');
  assert.ok(/watch-action-btns/.test(body),
    'must mount into the nowrap sub-group, like Download/Delete/Move/Like/Share');
  assert.ok(/reheatBtn\.className = 'btn'/.test(body),
    'must reuse the SAME .btn token as its five neighbours (no bespoke sizing)');
  assert.ok(/btn-label/.test(body),
    'the word must live in .btn-label so the phone breakpoint can hide it and leave the glyph');
  assert.ok(/reheat-media-btn/.test(body), 'stable id for the control');
});

test('the button is created at runtime, not added to watch.html', () => {
  assert.ok(!/reheat-media-btn/.test(watchHtml),
    'watch.html must not carry the button -- it is built per view instance like Move/Like/Share');
});

// ---- 2 + 3. The glyph is a real mask, and it resolves --------------------

test('the glyph is a CSS-masked .icon-flame, never an emoji codepoint (the v1.38 iOS lesson)', () => {
  const body = functionBody(watchJs, 'setupReheatButton');
  assert.ok(/icon-flame/.test(body), 'uses the .icon-flame mask class');
  assert.ok(!/\u{1F525}/u.test(watchJs), 'watch.js must not contain the fire emoji codepoint');
  assert.ok(!/\\1F525/.test(styleCss), 'style.css must not render the flame as an emoji escape');
});

test('.icon-flame is defined, sized, filled, and its mask asset exists on disk', () => {
  assert.ok(/\.icon-flame\s*\{[^}]*mask-image:\s*url\(\/assets\/icons\/flame\.svg\)/.test(styleCss),
    '.icon-flame must point at the bundled flame.svg mask');
  // A mask class that never joins the shared sizing list renders at the wrong
  // box; one that never joins the @supports fill list renders as nothing.
  const sizingBlock = styleCss.slice(styleCss.indexOf('.icon-refresh,'), styleCss.indexOf('.icon-home {'));
  assert.ok(/\.icon-flame/.test(sizingBlock), '.icon-flame must be in the shared 1em sizing rule');
  const supportsIdx = styleCss.indexOf('@supports (mask-image: url("#"))');
  const supportsBlock = styleCss.slice(supportsIdx, supportsIdx + 600);
  assert.ok(/\.icon-flame/.test(supportsBlock), '.icon-flame must be in the @supports currentColor fill list');

  const asset = path.join(ROOT, 'public', 'assets', 'icons', 'flame.svg');
  assert.ok(fs.existsSync(asset), 'flame.svg must exist -- a mask pointing at a 404 renders nothing, silently');
  const svg = fs.readFileSync(asset, 'utf8');
  assert.ok(/viewBox="0 -960 960 960"/.test(svg), 'same viewBox geometry as the bundled Material glyphs');
  assert.ok(/<path/.test(svg) && !/fill="(?!none)/.test(svg.replace(/fill-rule/g, '')),
    'a single currentColor path -- no hardcoded fill, or it would not theme');
});

// ---- 4. The confirm dialog is runtime-built (tech-debt #34) ---------------

test('the relocation confirm is the runtime showConfirmModal, never markup in watch.html', () => {
  const body = functionBody(watchJs, 'offerRelocation');
  assert.ok(/showConfirmModal\(/.test(body), 'reuses the shared runtime modal');
  assert.ok(!/reheat-confirm-backdrop|reheat-modal/.test(watchHtml),
    'no page markup for this dialog -- markup outside #view-root is never mounted on in-app nav (tech-debt #34)');
  assert.ok(/document\.body\.appendChild\(modalBackdrop\)/.test(commonJs),
    'showConfirmModal must still append to document.body (the property this test depends on)');
});

test('the confirm dialog escapes the filesystem paths it renders (showConfirmModal interpolates with innerHTML)', () => {
  const body = functionBody(watchJs, 'offerRelocation');
  assert.ok(/escapeHtmlText\(dest\)/.test(body), 'the destination path must be escaped');
  assert.ok(/escapeHtmlText\(how\)/.test(body), 'the transfer description must be escaped');
});

test('the confirm dialog names the actual decision rather than "Confirm"/"Cancel"', () => {
  const body = functionBody(watchJs, 'offerRelocation');
  assert.ok(/confirm: 'Move it'/.test(body) && /cancel: 'Leave it where it is'/.test(body),
    'an irreversible file move deserves a verb, not a formality');
});

test('showConfirmModal label overrides are applied with textContent, never interpolated into the innerHTML template', () => {
  const body = functionBody(commonJs, 'showConfirmModal');
  assert.ok(/confirmBtn\.textContent = labels\.confirm/.test(body));
  assert.ok(/cancelBtn\.textContent = labels\.cancel/.test(body));
  assert.ok(!/\$\{labels/.test(body), 'a caller-supplied label must never become markup');
});

// ---- 5. The metadata click never moves a file ----------------------------

test('the metadata click path never calls the relocate route -- only the confirm callback does', () => {
  const clickBody = functionBody(watchJs, 'handleReheatClick');
  assert.ok(!/relocate/.test(clickBody),
    'pressing Reheat must never move a file: the irreversible half is a separate, confirmed click');

  const pollBody = functionBody(watchJs, 'pollReheat');
  assert.ok(!/\/relocate/.test(pollBody),
    'the poll may only OFFER the relocation, never perform it');
  assert.ok(/offerRelocation\(/.test(pollBody), 'the poll offers it when the server says one is available');

  const offerBody = functionBody(watchJs, 'offerRelocation');
  assert.ok(/\/relocate/.test(offerBody), 'the confirm callback is the only caller of the relocate route');
});

test('a completed relocation closes the player before navigating (the move re-keys the id)', () => {
  const body = functionBody(watchJs, 'offerRelocation');
  const closeIdx = body.indexOf('player.close()');
  const navIdx = body.indexOf('FileTube.navigate');
  assert.ok(closeIdx > 0 && navIdx > closeIdx,
    'the player must be stopped BEFORE navigating, or it keeps Range-requesting a dead id');
  assert.ok(/body\.newId/.test(body), 'the new id from the server is what the page navigates to');
});

// ---- 6. Teardown ---------------------------------------------------------

test('the status poll is cleared on view teardown -- no interval outliving the view', () => {
  const body = functionBody(watchJs, 'pollReheat');
  assert.ok(/signal\.addEventListener\('abort', stopReheatPoll/.test(body),
    'an un-cleared interval would keep polling for the life of the tab');
  const stopBody = functionBody(watchJs, 'stopReheatPoll');
  assert.ok(/clearInterval\(reheatPollTimer\)/.test(stopBody));
});

test('the poll ignores a terminal entry belonging to a DIFFERENT video, BEFORE deciding it is finished', () => {
  const body = functionBody(watchJs, 'pollReheat');
  assert.ok(/entry\.mediaId && entry\.mediaId !== id/.test(body),
    'the one-shot key is fixed and TTL-pruned in minutes, so a stale done entry from another item is reachable');
  // Ordering is the whole point: stopping the poll first would abandon it on
  // someone else's result and never report this video's own.
  const guardIdx = body.indexOf('entry.mediaId !== id');
  const stopIdx = body.indexOf('stopReheatPoll();', body.indexOf('const entry ='));
  assert.ok(guardIdx > 0 && stopIdx > guardIdx,
    'the stale-entry guard must run BEFORE stopReheatPoll()');
});

test('the client polls the SAME activity key the server writes -- the literal and the constant cannot drift', () => {
  // watch.js hardcodes the one-shot key (it has no access to the server's
  // constant). A rename on either side would otherwise leave the button
  // spinning forever with no error anywhere.
  const ytdlpIndex = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'index.js'), 'utf8');
  const declared = /const REPULL_ITEM_ACTIVITY_ID = '([^']+)'/.exec(ytdlpIndex);
  assert.ok(declared, 'REPULL_ITEM_ACTIVITY_ID must be declared in lib/ytdlp/index.js');
  assert.ok(watchJs.includes(`oneShots['${declared[1]}']`),
    `watch.js must poll oneShots['${declared[1]}'] -- found a different literal`);
});

test('the running entry clears the previous run\'s result fields (setOneShot MERGES)', () => {
  const ytdlpIndex = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'index.js'), 'utf8');
  const body = functionBody(ytdlpIndex, 'runSingleItemReheat');
  const runningWrite = body.slice(0, body.indexOf('try {'));
  for (const field of ['before: null', 'after: null', 'relocation: null']) {
    assert.ok(runningWrite.includes(field),
      `the 'running' write must reset ${field} -- otherwise a poller reads the PREVIOUS video's result, including its relocation proposal`);
  }
  assert.ok(runningWrite.includes('mediaId: item.mediaId'),
    'and must stamp mediaId from the start, so a poller can always tell whose run it is');
});

// ---- Honesty ------------------------------------------------------------

test('a FAILED reheat is never reported as a success (state is a lifecycle marker, not a result)', () => {
  const body = functionBody(watchJs, 'describeReheat');
  assert.ok(/entry\.outcome === 'failed'/.test(body),
    'must branch on the job outcome, not on state -- state reads "done" for a job that finished having failed its item');
  const ytdlpIndex = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'index.js'), 'utf8');
  assert.ok(/outcome: failed \? 'failed' :/.test(ytdlpIndex),
    'the server must publish that outcome field for the client to branch on');
});

test('a video with no YouTube source is reported honestly, not as a success', () => {
  const body = functionBody(watchJs, 'describeReheat');
  assert.ok(/networkRan === false/.test(body), 'the no-identity case is branched on explicitly');
  assert.ok(/nothing to refresh/i.test(body), 'and says so plainly');
  assert.ok(/already up to date/i.test(body),
    'a reheat that changed nothing must say that too, rather than implying it did work');
});

// ---- v1.49 gate fixes (adversarial seat) -----------------------------------

test('CRITICAL 2: showConfirmModal resolves its buttons from ITS OWN backdrop, never document-wide', () => {
  const body = functionBody(commonJs, 'showConfirmModal');
  assert.ok(/modalBackdrop\.querySelector\('#modal-confirm-btn'\)/.test(body),
    'document.getElementById returns the FIRST match, so a second modal re-binds the first one\'s buttons');
  assert.ok(/modalBackdrop\.querySelector\('#modal-cancel-btn'\)/.test(body));
  assert.ok(!/document\.getElementById\('modal-(confirm|cancel)-btn'\)/.test(body),
    'no document-wide lookup may remain');
});

test('CRITICAL 2: the relocation offer refuses to open on top of another modal', () => {
  const body = functionBody(watchJs, 'offerRelocation');
  assert.ok(/document\.querySelector\('\.modal-backdrop'\)/.test(body),
    'this is the only confirm that can open without the user having just clicked something');
});

test('CRITICAL 1: the per-video proposal and confirm pass allowRecentlyWatched; nothing else does', () => {
  const ytdlpIndex = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'index.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  // The watch page streams the video on mount, so without this the proposal is
  // always 'recently-watched' and the whole relocation half is unreachable.
  assert.equal((ytdlpIndex.match(/allowRecentlyWatched: true/g) || []).length, 2,
    'exactly two: the per-video proposal and the per-video confirm');
  // ...and the guard is still OFF by default, so the unattended batch and the
  // whole-library preview keep refusing to move a file someone is streaming.
  assert.ok(/!\(opts && opts\.allowRecentlyWatched === true\)/.test(serverJs),
    'the clause must default to ON (i.e. only an explicit === true lifts it)');
  assert.ok(!/allowRecentlyWatched/.test(functionBody(ytdlpIndex, 'runRepullMetadataBatch')),
    'the library batch must never lift the guard');
});

test('CRITICAL 1: the player is closed BEFORE the move is requested, not just before the navigate', () => {
  const body = functionBody(watchJs, 'offerRelocation');
  const closeIdx = body.indexOf('player.close()');
  const postIdx = body.indexOf('/relocate');
  assert.ok(closeIdx > 0 && postIdx > closeIdx,
    'the server now permits moving a recently-watched file here, so this client must stop reading it first');
});

test('CRITICAL 3: the confirm echoes back the exact move it displayed, and the server refuses a mismatch', () => {
  const body = functionBody(watchJs, 'offerRelocation');
  assert.ok(/expect: \{ currentPath: relocation\.currentPath, destinationPath: relocation\.destinationPath \}/.test(body),
    'subscribing to the channel from this page changes the destination folder -- "still legal" is not "still what you approved"');
  assert.ok(/status === 409 && body && body\.status === 'stale'/.test(body),
    'a stale proposal must re-ask, not fail and not silently proceed');

  const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const relocBody = functionBody(serverJs, 'relocateHydratedImportIntoChannelFolder');
  assert.ok(/status: 'stale'/.test(relocBody), 'the executor is what refuses -- not the route');
  assert.ok(/e\.currentPath !== plan\.currentPath \|\| e\.destinationPath !== plan\.destinationPath/.test(relocBody),
    'both ends of the move are bound, not just the destination');
});

test('WARNING 2: an open relocation confirm is dismissed when the view is torn down', () => {
  const offer = functionBody(watchJs, 'offerRelocation');
  assert.ok(/signal\.addEventListener\('abort', relocationDismiss/.test(offer),
    'this modal lives on document.body, which the SPA router never swaps');
  const modal = functionBody(commonJs, 'showConfirmModal');
  assert.ok(/return function dismiss\(\)/.test(modal), 'showConfirmModal must hand back a dismiss handle');
  assert.ok(/if \(settled\) return;/.test(modal.slice(modal.indexOf('return function dismiss'))),
    'and dismissing after the user already answered must be a no-op');
});

test('WARNING 3: a failed move reads as a FAILURE, and 409/403/503 do not print a false reason', () => {
  const body = functionBody(watchJs, 'offerRelocation');
  assert.ok(/body\.failed \|\| body\.status === 'failed'/.test(body),
    'a cross-device checksum mismatch must not read like "you have two copies of this video"');
  assert.ok(/FAILED and was rolled back/.test(body), 'and must say so plainly');
  for (const code of ['409', '403', '503']) {
    assert.ok(new RegExp(`status === ${code}`).test(body),
      `${code} carries no 'reason' field, so it needs its own message rather than "not a candidate"`);
  }
});

test('SUGGESTION 1: a null AFTER snapshot cannot toast "chapters: undefined"', () => {
  const body = functionBody(watchJs, 'describeReheat');
  assert.ok(/typeof after\.chapterCount === 'number'/.test(body));
});

test('SUGGESTION 2: the poll ceiling is shorter than the activity TTL that prunes the result', () => {
  const activityJs = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'activity.js'), 'utf8');
  const ttl = /ONESHOT_TTL_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/.exec(activityJs);
  assert.ok(ttl, 'expected ONESHOT_TTL_MS in lib/ytdlp/activity.js');
  const ttlMs = Number(ttl[1]) * Number(ttl[2]) * Number(ttl[3]);
  const ceiling = /const ceilingMs = (\d+) \* (\d+) \* (\d+);/.exec(functionBody(watchJs, 'pollReheat'));
  assert.ok(ceiling, 'expected a poll ceiling');
  const ceilingMs = Number(ceiling[1]) * Number(ceiling[2]) * Number(ceiling[3]);
  assert.ok(ceilingMs < ttlMs,
    `the poll must give up BEFORE the result it points the user at is pruned (ceiling ${ceilingMs} vs TTL ${ttlMs})`);
});

test('SUGGESTION 3: the poll registers its abort listener once per view, not once per click', () => {
  const body = functionBody(watchJs, 'pollReheat');
  assert.ok(/if \(!reheatAbortHooked\)/.test(body));
});
