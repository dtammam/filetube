'use strict';

// [UNIT] v1.87.0 (Dean) - the FIRST-PAINT chrome icons are INLINED into
// style.css as data-URIs, not fetched from /assets/icons/*.svg.
//
// The device report: on a mobile PWA cold start the bottom-nav + top-right
// glyphs "pop in" a beat after their labels - the labels paint immediately but
// the mask-icons need a separate async SVG fetch, so the row renders naked then
// fills. The inline-SVG bell + queue (built in JS) never lagged because their
// markup ships in the first paint. The fix: embed the DEFAULT-set masks for the
// first-paint roster as `url("data:image/svg+xml,...")` so they need no fetch.
//
// This binds: (a) every critical class' DEFAULT rule is a data-URI (a revert to
// url(/assets/...) goes red), and (b) each data-URI decodes to a well-formed
// SVG (a truncated/garbled embed goes red). The rounded/filled/emoji sets are
// deliberately NOT inlined (they load only when that set is chosen) - so this
// test does NOT touch them.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

// The first-paint roster: bottom-nav (home/liked/favorites/playlists=folder/
// history/podcast/music=play/books/downloads/theme moon+sun/settings=cog) +
// header (search/download/sort=arrow-down) + subscriptions' refresh.
const CRITICAL = [
  'icon-home', 'icon-liked', 'icon-favorites', 'icon-folder', 'icon-history',
  'icon-podcast', 'icon-play', 'icon-books', 'icon-downloads', 'icon-moon',
  'icon-sun', 'icon-cog', 'icon-download', 'icon-search', 'icon-arrow-down',
  'icon-refresh',
];

for (const cls of CRITICAL) {
  test(`.${cls} default mask is inlined as a data-URI (no async /assets fetch on first paint)`, () => {
    // Grab the DEFAULT-set MASK rule: `\.icon-x { ... }` at line start whose
    // body carries mask-image (some classes ALSO appear at BOL in a shared
    // base rule that only sets display/size - skip those). The rounded/filled
    // variants are `[data-icons="..."] .icon-x`, never at BOL, so excluded.
    const re = new RegExp(`^\\.${cls} \\{([^}]*)\\}`, 'gm');
    const bodies = [...css.matchAll(re)].map((x) => x[1]);
    const body = bodies.find((b) => /mask-image:/.test(b));
    assert.ok(body, `a default .${cls} mask rule exists`);
    assert.ok(/-webkit-mask-image:\s*url\("data:image\/svg\+xml,/.test(body)
      && /[^-]mask-image:\s*url\("data:image\/svg\+xml,/.test(body),
      `.${cls} sets BOTH -webkit-mask-image and mask-image to a data-URI`);
    assert.ok(!/url\(\/assets\/icons\//.test(body),
      `.${cls} default rule must not fetch from /assets/icons (would pop in on cold start)`);
    // The embedded SVG decodes to well-formed markup (catches truncation).
    const uri = (body.match(/url\("data:image\/svg\+xml,([^"]+)"\)/) || [])[1];
    assert.ok(uri, `.${cls} has an extractable data-URI payload`);
    const svg = decodeURIComponent(uri);
    assert.match(svg, /^<svg[\s>]/, `.${cls} data-URI decodes to a <svg> open tag`);
    assert.match(svg, /<\/svg>$/, `.${cls} data-URI decodes to a closed </svg>`);
  });
}
