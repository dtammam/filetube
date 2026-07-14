'use strict';

// [UNIT] v1.24.0 T6 -- A5 ("check all subscriptions now" prominence) and B1
// ("Re-pull this channel now" in the home `.section-actions` row). Both
// features are UI-ONLY wiring against the ALREADY-EXISTING
// `POST /api/subscriptions/repull` / `POST /api/subscriptions/:id/repull`
// endpoints (see the exec plan's A5/B1 design + lib/ytdlp/index.js, which T6
// does not own/edit). This file proves that assertion directly against T6's
// OWN owned source files, rather than merely by omission: every string
// literal containing a slash-prefixed "/repull" across `public/js/common.js`
// (B1 -- see the v1.24.1 fast-follow note below), `lib/ytdlp/views/
// subscriptions.html` (A5 markup), and `lib/ytdlp/client/subscriptions.js`
// (A5/B1 wiring, both pre-existing and unchanged) resolves to one of exactly
// the two known, pre-existing routes -- never a novel third endpoint.
//
// v1.24.1 fast-follow: B1's widget was relocated from an inline
// `public/index.html` `<script>` into `public/js/common.js` (hooked into the
// SPA router's own choke points -- `swapToView`/`restoreHomeFromCache`/
// `bootRouter` -- rather than a `MutationObserver`) so it fires on every
// entry point/navigation, not just a session that happened to load
// index.html first. See test/unit/ytdlp-b1-repull-relocation.test.js for the
// dedicated coverage of that relocation's match/gating/dedup/inert
// behavior; this file keeps its original "no new route" + structural
// assertions, repointed at the new location.
//
// Also locks a couple of light structural facts about the relocated A5
// control and the B4 CSS this task's inbox calls out as "own the CSS for any
// new DOM you introduce": subscriptions.html's #sub-repull-all-btn is no
// longer nested inside the collapsed "+ Add a subscription" <details>, and a
// dedicated <style> block exists for the new .sub-list-header/.sub-row drag
// classes.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..', '..');
const commonJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
const subsHtml = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'), 'utf8');
const subsClientJs = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'client', 'subscriptions.js'), 'utf8');

// ---- A5/B1: no new backend route -------------------------------------------

test('A5/B1: every slash-prefixed "/repull" string literal across the T6-owned files resolves to one of the two pre-existing routes', () => {
  const allowed = new Set([
    "'/api/subscriptions/repull'", "'/repull'",
    // A pre-existing common.js doc comment describes the SAME per-id route
    // in markdown-code-span backticks (prose, not a JS string literal) --
    // the regex below can't distinguish comment prose from code, so this
    // exact known-safe span is allowlisted rather than the regex weakened.
    '`POST /api/subscriptions/:id/repull`',
    // v1.25 QoL follow-up ("reheat"): two ALREADY-IMPLEMENTED, pre-existing
    // backend routes (see test/integration/ytdlp-repull-metadata-endpoint.test.js)
    // this task's client-only UI wiring calls -- both the real code-string
    // literals (`lib/ytdlp/client/subscriptions.js`'s two `fetch(...)`
    // calls) and their markdown-code-span mentions in that same file's doc
    // comments.
    "'/api/ytdlp/repull-metadata'", "'/api/ytdlp/repull-metadata/cancel'",
    '`POST /api/ytdlp/repull-metadata`', '`/api/ytdlp/repull-metadata`', '`/api/ytdlp/repull-metadata/cancel`',
    // v1.41.7 (Dean has NO media backup): the DRY-RUN relocation preview route
    // -- a legitimately-added, read-only endpoint the "Preview changes" button
    // calls (see test/integration/repull-relocate-preview.test.js +
    // ytdlp-repull-metadata-endpoint.test.js). Its fetch-call string literal and
    // its doc-comment markdown-code-span mention.
    "'/api/ytdlp/repull-metadata/preview'", '`/api/ytdlp/repull-metadata/preview`',
  ]);
  const pattern = /(['"`])[^'"`]*\/repull[^'"`]*\1/g;
  const found = [];
  for (const src of [commonJs, subsHtml, subsClientJs]) {
    let match;
    while ((match = pattern.exec(src))) found.push(match[0]);
  }
  assert.ok(found.length >= 2, 'expected at least the repull-all and repull-one literals to be present across these files');
  for (const literal of found) {
    assert.ok(
      allowed.has(literal),
      `unexpected repull-related literal "${literal}" -- A5/B1 must call ONLY the pre-existing ` +
      '/api/subscriptions/repull (all) and .../<id>/repull (one) endpoints, never a new route'
    );
  }
});

test('B1: public/js/common.js builds the per-channel repull request against the per-id endpoint (id interpolated via encodeURIComponent, never the URL scheme/host)', () => {
  assert.match(
    commonJs,
    /fetch\(\s*'\/api\/subscriptions\/'\s*\+\s*encodeURIComponent\([^)]+\)\s*\+\s*'\/repull'/,
    'expected the exact "/api/subscriptions/" + encodeURIComponent(id) + "/repull" shape'
  );
});

test('B1: the home .section-actions row is the mount point referenced by the new control (no other container introduced)', () => {
  assert.match(commonJs, /document\.querySelector\('\.section-actions'\)/);
});

test('B1: public/index.html no longer contains its own inline copy of the widget (relocated -- exactly ONE code path injects this button)', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(!/sub-repull-channel-btn/.test(indexHtml), 'expected the inline B1 widget to be fully removed from index.html');
});

// ---- A5: relocated, prominent "check all subscriptions now" control -------

test('A5: #sub-repull-all-btn is no longer nested inside the collapsed "+ Add a subscription" <details> disclosure', () => {
  const detailsMatch = /<details class="setup-box sub-collapsible" id="sub-add-details">[\s\S]*?<\/details>/.exec(subsHtml);
  assert.ok(detailsMatch, 'expected the sub-add-details disclosure to still exist');
  assert.ok(
    !detailsMatch[0].includes('sub-repull-all-btn'),
    'the re-pull-all control must be relocated OUT of the collapsed disclosure (A5: reachable without expanding anything)'
  );
});

test('A5: #sub-repull-all-btn and #sub-repull-status exist exactly once, both outside any <details>', () => {
  const allBtnMatches = subsHtml.match(/id="sub-repull-all-btn"/g) || [];
  const statusMatches = subsHtml.match(/id="sub-repull-status"/g) || [];
  assert.strictEqual(allBtnMatches.length, 1, 'sub-repull-all-btn must appear exactly once');
  assert.strictEqual(statusMatches.length, 1, 'sub-repull-status must appear exactly once');
});

test('A5: the relocated control sits directly under the "Your subscriptions" heading, inside .sub-list-header', () => {
  assert.match(
    subsHtml,
    /<div class="sub-list-header">\s*<h2>Your subscriptions<\/h2>[\s\S]*?id="sub-repull-all-btn"[\s\S]*?<\/div>\s*<div id="sub-list-container"/
  );
});

// ---- B4: CSS ownership for the new DnD affordance --------------------------

test('B4: subscriptions.html carries its own <style> block for the new .sub-row drag-and-drop classes (no style.css edit)', () => {
  const styleMatch = /<style>[\s\S]*?<\/style>/.exec(subsHtml);
  assert.ok(styleMatch, 'expected a <style> block in subscriptions.html');
  for (const cls of ['.sub-row-dragging', '.sub-row-drag-over-before', '.sub-row-drag-over-after', '.sub-list-header']) {
    assert.ok(styleMatch[0].includes(cls), `expected ${cls} to be styled in the new <style> block`);
  }
});
