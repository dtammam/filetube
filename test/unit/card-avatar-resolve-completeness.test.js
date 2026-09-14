'use strict';

// [UNIT] v1.113 slim-gate WARNING forcing-net: the "monogram in search" bug was
// a CARD read surface (`GET /api/videos`) spreading the raw item without
// resolving the channel avatar -- and it had UN-SWEPT SIBLINGS (`/api/liked`,
// `/api/history`) doing the same, because they all feed the shared
// buildCardHtml -> modernCardAvatar path (main.js). This is this repo's
// repeatedly-paid "enumerate EVERY surface / shared resolver not called" class
// (v1.41.4, v1.80). Rather than trust a hand list, DERIVE the surfaces: every
// route projection that spreads `...item,` into a returned object must resolve
// the channel avatar via `resolveItemChannelAvatarUrl(ytView, item)` nearby (Wave 5:
// `ytView` is the per-request feature-store holder the handler hoists). A NEW
// card projection that forgets it reddens HERE, before a user sees a monogram.
//
// Wave 7b (the monolith split, slice S1a): /api/history moved to
// lib/user/routes.js, so the net reads the whole ROUTE SURFACE - server.js plus
// every registerRoutes module it registers (derived, never a hand list) - and
// keeps the same >=4 floor. Scanning only server.js after the move would have
// let the count fall to 3 and quietly stopped covering the moved surface.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { routeSurfaceFiles } = require('../helpers/route-surface');

const SURFACE = routeSurfaceFiles().map((file) => ({
  label: path.relative(path.join(__dirname, '..', '..'), file),
  lines: fs.readFileSync(file, 'utf8').split('\n'),
}));

test('every `...item,` card projection in the route surface resolves the channel avatar (no un-swept sibling)', () => {
  const spreads = [];
  for (const f of SURFACE) {
    f.lines.forEach((line, i) => { if (/^\s*\.\.\.item,\s*$/.test(line)) spreads.push({ f, i }); });
  }
  // The known card surfaces at authoring time: /api/videos, the watch route
  // /api/videos/:id, /api/liked, /api/history. If this drops below the known
  // count the derivation itself broke; if it grows, the new one must resolve.
  assert.ok(spreads.length >= 4, `expected >=4 \`...item,\` card projections, found ${spreads.length}`);
  for (const { f, i } of spreads) {
    const window = f.lines.slice(Math.max(0, i - 25), i + 25).join('\n');
    assert.match(
      window,
      /resolveItemChannelAvatarUrl\((db|ytView), item\)/,
      `the \`...item,\` projection at ${f.label}:${i + 1} must resolve the channel avatar within its block ` +
      `(Fix A sweep -- a card surface that spreads the raw item shows a monogram where the avatar is registry-resolvable)`
    );
  }
});
