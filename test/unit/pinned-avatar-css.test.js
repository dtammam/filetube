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
  // Tokens Phase 1 Tier 1 (DELIBERATE lock update): `bold` became
  // var(--fw-bold), which is 700 == bold - same rendered weight, one
  // spelling system-wide.
  assert.match(rule[1], /font-weight:\s*var\(--fw-bold\);/);
});

test('.pinned-avatar-generated: does not hardcode background-color (left to the JS-set inline style per entry)', () => {
  const rule = findRule('.pinned-avatar-generated');
  assert.ok(rule);
  assert.doesNotMatch(rule[1], /background-color:/);
});

// v1.25.5 (coordinator follow-up) -> UI pass S5: a real channel-avatar <img> on the
// Subscriptions page (its rows and its settings sheet) is ui.avatar's now (D4.4), so the
// CSS contract moves to ui.css: the <img> fills the fixed-size box and crops to it, and
// the box clips it to its own shape (overflow hidden + its radius), so no image can
// render unbounded or square in a round avatar (the v1.25.5 bug). AC12: the retired
// .sub-row-avatar / .sub-sheet-avatar img rules are replaced here, not dropped.
const UI_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'ui.css'), 'utf8');
function findUiRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(UI_CSS);
}

test('.ui-avatar__img (the Subscriptions row + sheet avatar): fills the fixed-size box and crops to it (object-fit: cover)', () => {
  const rule = findUiRule('.ui-avatar__img');
  assert.ok(rule, 'expected a .ui-avatar__img rule in ui.css');
  assert.match(rule[1], /width:\s*100%;/);
  assert.match(rule[1], /height:\s*100%;/);
  assert.match(rule[1], /object-fit:\s*cover;/);
});

test('.ui-avatar / .ui-art: a fixed box that clips its image to its own shape (overflow hidden; circle vs rounded square)', () => {
  const box = /\n\.ui-avatar,\s*\n\.ui-art \{([^}]*)\}/.exec(UI_CSS);
  assert.ok(box, 'expected the shared .ui-avatar, .ui-art box rule');
  assert.match(box[1], /width:\s*var\(--av\);/);
  assert.match(box[1], /height:\s*var\(--av\);/);
  assert.match(box[1], /overflow:\s*hidden;/);
  assert.match(box[1], /flex:\s*none;/, 'never squeezed by a row');
  assert.match(UI_CSS, /\n\.ui-avatar \{ border-radius: 50%; \}/, 'channels are circles (decision 7)');
});
