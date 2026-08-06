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
// This binds BYTE IDENTITY, not just well-formedness. The v1.87.0 slim gate
// found that a "decodes to <svg>...</svg>" check passes a garbled-but-well-
// formed embed - e.g. a corrupted `d=` path that renders a BLANK mask (a well-
// formed XML document, an invisible glyph): exactly the AC7 blank-box class this
// commit defends against on Dean's phone. So each class' embed is reconstructed
// from the on-disk asset the way the generator did and compared byte-for-byte -
// a one-coordinate drift in the CSS goes red here. (The recurring "presence not
// binding" lesson: bind the real effect, not a weaker proxy.)
//
// The rounded/filled/emoji sets are deliberately NOT inlined (they load only
// when that set is chosen) - so this test does NOT touch them.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const ICON_DIR = path.join(REPO, 'public', 'assets', 'icons');
const css = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8');

// class -> on-disk DEFAULT-set asset. The first-paint roster: bottom-nav
// (home/liked/favorites/playlists=folder/history/podcast/music=play/books/
// downloads/theme moon+sun/settings=cog), the header (search/download/
// sort=arrow-down), subscriptions' refresh, and the Home-toolbar view-mode
// toggle (grid/list). liked + favorites share star.svg.
const CLASS_ASSET = {
  'icon-home': 'home',
  'icon-liked': 'star',
  'icon-favorites': 'star',
  'icon-folder': 'folder',
  'icon-history': 'history',
  'icon-podcast': 'podcast',
  'icon-play': 'play_arrow',
  'icon-books': 'books',
  'icon-downloads': 'downloads',
  'icon-moon': 'dark_mode',
  'icon-sun': 'light_mode',
  'icon-cog': 'settings',
  'icon-download': 'download',
  'icon-search': 'search',
  'icon-arrow-down': 'keyboard_arrow_down',
  'icon-refresh': 'refresh',
  'icon-grid': 'grid_view',
  'icon-list': 'view_list',
};

// Reconstruct the EXACT data-URI the generator embedded, from the on-disk asset.
function inlinedValue(asset) {
  const svg = fs.readFileSync(path.join(ICON_DIR, `${asset}.svg`), 'utf8').replace(/\s+/g, ' ').trim();
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

for (const [cls, asset] of Object.entries(CLASS_ASSET)) {
  test(`.${cls} default mask is the ${asset}.svg SVG inlined byte-for-byte (no async fetch, right icon)`, () => {
    // The DEFAULT-set MASK rule at line start whose body carries mask-image
    // (some classes ALSO appear at BOL in a shared base rule that only sets
    // display/size - skip those). The rounded/filled variants are
    // `[data-icons="..."] .icon-x`, never at BOL, so excluded.
    const re = new RegExp(`^\\.${cls} \\{([^}]*)\\}`, 'gm');
    const body = [...css.matchAll(re)].map((x) => x[1]).find((b) => /mask-image:/.test(b));
    assert.ok(body, `a default .${cls} mask rule exists`);

    const v = inlinedValue(asset);
    // BOTH properties are the exact inlined data-URI (byte-identical to the
    // on-disk asset). This subsumes: is-a-data-URI, decodes-to-well-formed-SVG,
    // AND is-the-right-icon-uncorrupted. A garbled path or a swapped asset both
    // go red.
    assert.ok(new RegExp(`-webkit-mask-image:\\s*${escapeRe(v)}`).test(body),
      `.${cls} -webkit-mask-image is ${asset}.svg inlined byte-for-byte`);
    assert.ok(new RegExp(`[^-]mask-image:\\s*${escapeRe(v)}`).test(body),
      `.${cls} standard mask-image is ${asset}.svg inlined byte-for-byte`);
    assert.ok(!/url\(\/assets\/icons\//.test(body),
      `.${cls} default rule must not fetch from /assets/icons (would pop in on cold start)`);
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
