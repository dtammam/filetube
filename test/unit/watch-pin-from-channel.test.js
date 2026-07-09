'use strict';

// [UNIT] v1.24.0 T6, B3 -- "Pin this channel" from the watch page. The actual
// button/click wiring (setupPinButton/handleTogglePin in public/js/watch.js)
// builds real DOM at runtime and has no jsdom/browser-DOM test harness in
// this codebase (mirrors main.js/watch.js's existing untested-DOM-wiring
// posture -- see e.g. test/integration/folder-dnd-order.test.js's own
// documented rationale for the analogous DnD case). This proves, directly
// against the source, the two load-bearing contracts the B3 AC calls out:
// (1) it reuses the EXISTING gated pins route/store -- never a new route,
// never `db.folders` -- and (2) the POST body it sends is the IDENTICAL
// `{channelDir, label}` shape `lib/ytdlp/store.js`'s `validatePinInput`
// expects (the same shape the /subscriptions page's own pin flow sends, see
// lib/ytdlp/client/subscriptions.js's togglePin), so both pin flows persist
// through the SAME single source of truth.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const watchJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'watch.js'), 'utf8');
const storeJs = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'store.js'), 'utf8');

test('B3: watch.js only ever calls the EXISTING /api/subscriptions/pins route (GET/POST/DELETE), never a new pin endpoint', () => {
  // Scoped to actual `fetch(...)` call sites (not comments, which elsewhere
  // in this file reference the same route/DELETE verb inside backtick-quoted
  // prose): every string literal immediately following `fetch(` that
  // contains "/api/subscriptions/pins" must be exactly
  // `/api/subscriptions/pins` itself (the GET/POST target) or
  // `/api/subscriptions/pins/` (the DELETE target's prefix, concatenated
  // with an encodeURIComponent'd id) -- never some other, novel pin path.
  const literals = (watchJs.match(/fetch\(\s*(['"`])[^'"`]*\/api\/subscriptions\/pins[^'"`]*\1/g) || [])
    .map((call) => call.slice(call.indexOf("'")));
  assert.ok(literals.length >= 3, 'expected at least the sidebar-refresh GET, the toggle-pin GET/POST, and the DELETE prefix');
  const allowed = new Set(["'/api/subscriptions/pins'", "'/api/subscriptions/pins/'"]);
  for (const literal of literals) {
    assert.ok(allowed.has(literal), `unexpected pins-route literal: ${literal}`);
  }
});

test('B3: watch.js never references db.folders/folderSettings as a property access/assignment (comments documenting the invariant are fine)', () => {
  // `db.folders`/`folderSettings[...] =` as CODE (not prose inside a `//`
  // comment) would be the actual violation this guards against -- strip
  // every line-comment's content first so a comment that merely DOCUMENTS
  // the "never db.folders" invariant (as this file's own pin-toggle code
  // does, right above the sidebar pins fetch) can never trip this check.
  const codeOnly = watchJs.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(codeOnly, /\bdb\.folders\b/);
  assert.doesNotMatch(codeOnly, /folderSettings\[[^\]]*\]\s*=/);
});

test('B3: the pin POST body sent by watch.js is exactly {channelDir, label} -- the identical shape validatePinInput expects', () => {
  assert.match(
    watchJs,
    /JSON\.stringify\(\{\s*channelDir:\s*currentPinState\.channelDir,\s*label:\s*currentPinState\.label\s*\}\)/
  );
  // Cross-check against the server-side contract itself (lib/ytdlp/store.js),
  // never assumed: validatePinInput's success value is exactly
  // `{ channelDir, label }`, with no other required field.
  assert.match(storeJs, /return \{ ok: true, value: \{ channelDir, label \} \};/);
});

test('B3: a successful pin/unpin refreshes the shared sidebar shortcut via the existing renderPinnedSidebar (no forked render path)', () => {
  assert.match(watchJs, /\.then\(\(pins\)\s*=>\s*renderPinnedSidebar\(pins\)\)/);
});
