'use strict';

// [UNIT] v1.113 slim-gate WARNING forcing-net: the "monogram in search" bug was
// a CARD read surface (`GET /api/videos`) spreading the raw item without
// resolving the channel avatar -- and it had UN-SWEPT SIBLINGS (`/api/liked`,
// `/api/history`) doing the same, because they all feed the shared
// buildCardHtml -> modernCardAvatar path (main.js). This is this repo's
// repeatedly-paid "enumerate EVERY surface / shared resolver not called" class
// (v1.41.4, v1.80). Rather than trust a hand list, DERIVE the surfaces: every
// route projection that spreads `...item,` into a returned object must resolve
// the channel avatar via `resolveItemChannelAvatarUrl(db, item)` nearby. A NEW
// card projection that forgets it reddens HERE, before a user sees a monogram.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8').split('\n');

test('every `...item,` card projection in server.js resolves the channel avatar (no un-swept sibling)', () => {
  const spreadLines = [];
  src.forEach((line, i) => { if (/^\s*\.\.\.item,\s*$/.test(line)) spreadLines.push(i); });
  // The known card surfaces at authoring time: /api/videos, the watch route
  // /api/videos/:id, /api/liked, /api/history. If this drops below the known
  // count the derivation itself broke; if it grows, the new one must resolve.
  assert.ok(spreadLines.length >= 4, `expected >=4 \`...item,\` card projections, found ${spreadLines.length}`);
  for (const ln of spreadLines) {
    const window = src.slice(Math.max(0, ln - 25), ln + 25).join('\n');
    assert.match(
      window,
      /resolveItemChannelAvatarUrl\(db, item\)/,
      `the \`...item,\` projection at server.js:${ln + 1} must resolve the channel avatar within its block ` +
      `(Fix A sweep -- a card surface that spreads the raw item shows a monogram where the avatar is registry-resolvable)`
    );
  }
});
