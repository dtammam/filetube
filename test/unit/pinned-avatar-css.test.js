'use strict';

// [UNIT] v1.25.5: fix real channel avatars (v1.25.4) rendering UNBOUNDED in
// the pinned lists. `buildPinAvatarNode` (public/js/common.js) builds either
// an `<img class="pinned-avatar pinned-avatar-img">` (real captured avatar)
// or a `<span class="pinned-avatar pinned-avatar-generated">` (letter
// fallback) for both the Playlists-sheet pinned rows (renderPinnedPlaylists)
// and the sidebar pinned rows (renderPinnedSidebar) -- until now neither
// carried ANY size CSS at all, so a real avatar rendered at its natural,
// often-huge pixel size. These are pure source-assertion tests against
// style.css, matching the style of watch-action-bar-nowrap.test.js /
// mobile-input-zoom-fontsize.test.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

function findRule(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  return re.exec(css);
}

test('.pinned-avatar: has an explicit, equal fixed width+height so a real avatar image cannot render unbounded', () => {
  const rule = findRule('.pinned-avatar');
  assert.ok(rule, 'expected a .pinned-avatar rule in style.css');
  const widthMatch = /width:\s*(\d+)px;/.exec(rule[1]);
  const heightMatch = /height:\s*(\d+)px;/.exec(rule[1]);
  assert.ok(widthMatch, 'expected an explicit width in px');
  assert.ok(heightMatch, 'expected an explicit height in px');
  assert.strictEqual(widthMatch[1], heightMatch[1], 'expected width and height to match so the avatar is uniform, not stretched');
});

test('.pinned-avatar: is a circle (border-radius: 50%) that never grows the row (flex-shrink: 0)', () => {
  const rule = findRule('.pinned-avatar');
  assert.ok(rule);
  assert.match(rule[1], /border-radius:\s*50%;/);
  assert.match(rule[1], /flex-shrink:\s*0;/);
});

test('.pinned-avatar: matches the adjacent .sidebar-item icon box size (18px), so pinned rows stay visually uniform with their other leading glyphs', () => {
  const pinnedRule = findRule('.pinned-avatar');
  const iconRule = findRule('.sidebar-item i');
  assert.ok(pinnedRule);
  assert.ok(iconRule, 'expected the existing .sidebar-item i icon rule to exist for comparison');
  const pinnedWidth = /width:\s*(\d+)px;/.exec(pinnedRule[1]);
  const iconWidth = /width:\s*(\d+)px;/.exec(iconRule[1]);
  assert.ok(pinnedWidth && iconWidth);
  assert.strictEqual(pinnedWidth[1], iconWidth[1], 'expected .pinned-avatar to be sized to match .sidebar-item i so the row height/scale is unchanged');
});

test('.pinned-avatar-img: crops to fill its fixed box instead of stretching/overflowing (object-fit: cover)', () => {
  const rule = findRule('.pinned-avatar-img');
  assert.ok(rule, 'expected a .pinned-avatar-img rule in style.css');
  assert.match(rule[1], /object-fit:\s*cover;/);
});

test('.pinned-avatar-generated: centers its single-letter glyph at the fixed size (inline-flex + centered)', () => {
  const rule = findRule('.pinned-avatar-generated');
  assert.ok(rule, 'expected a .pinned-avatar-generated rule in style.css');
  assert.match(rule[1], /display:\s*inline-flex;/);
  assert.match(rule[1], /align-items:\s*center;/);
  assert.match(rule[1], /justify-content:\s*center;/);
  assert.match(rule[1], /font-weight:\s*bold;/);
});

test('.pinned-avatar-generated: does not hardcode background-color (left to the JS-set inline style per entry)', () => {
  const rule = findRule('.pinned-avatar-generated');
  assert.ok(rule);
  assert.doesNotMatch(rule[1], /background-color:/);
});

// v1.25.5 (coordinator follow-up): a real channel-avatar <img> is being
// wired directly INSIDE the existing fixed-size `.sub-row-avatar` /
// `.sub-sheet-avatar` containers on the subscriptions page -- this file only
// owns the CSS contract (an <img> placed inside either container fills it
// cleanly), decoupled from whichever code renders the <img> itself.
test('.sub-row-avatar img: fills the fixed-size container and crops to it (object-fit: cover)', () => {
  const rule = findRule('.sub-row-avatar img');
  assert.ok(rule, 'expected a .sub-row-avatar img rule in style.css');
  assert.match(rule[1], /width:\s*100%;/);
  assert.match(rule[1], /height:\s*100%;/);
  assert.match(rule[1], /object-fit:\s*cover;/);
});

test('.sub-row-avatar img: follows the container\'s own corner radius (border-radius: inherit)', () => {
  const rule = findRule('.sub-row-avatar img');
  assert.ok(rule);
  assert.match(rule[1], /border-radius:\s*inherit;/);
});

test('.sub-sheet-avatar img: fills its fixed-size container the same way as .sub-row-avatar img', () => {
  const rule = findRule('.sub-sheet-avatar img');
  assert.ok(rule, 'expected a .sub-sheet-avatar img rule in style.css');
  assert.match(rule[1], /width:\s*100%;/);
  assert.match(rule[1], /height:\s*100%;/);
  assert.match(rule[1], /object-fit:\s*cover;/);
  assert.match(rule[1], /border-radius:\s*inherit;/);
});
