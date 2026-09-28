'use strict';

// [UNIT] v1.25.5: fix real channel avatars (v1.25.4) rendering UNBOUNDED in
// the pinned lists (renderPinnedPlaylists / renderPinnedSidebar): until then no
// CSS sized them, so a real avatar rendered at its natural, often-huge pixel
// size. Since sweep S1, `buildPinAvatarNode` (public/js/common.js) builds a
// ui-avatar, so the guarantee is the primitive's contract (ui.css) - bound
// below - plus the Subscriptions page's own avatar boxes (S5's half).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');


// Sweep S1 (AC12, DELIBERATE conversion - the triage's "ui-avatar xs contract (fixed box,
// cover, monogram fallback)"). The pinned avatar is a ui-avatar now (common.js
// buildPinAvatarNode -> chromeAvatarEl / ui.avatar): the v1.25.5 guarantee - a real avatar
// can never render unbounded - is the PRIMITIVE's contract, bound here on ui.css + tokens.css
// and behaviourally on the builder. `.pinned-avatar` is only a hook class; no stylesheet may
// size it again (a second, drifting box).
const UI_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'tokens.css'), 'utf8');
const uiRule = (sel) => {
  const re = new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = re.exec(UI_CSS);
  return m && m[2];
};

test('ui-avatar: an equal fixed width+height from ONE size var, so a real avatar image cannot render unbounded', () => {
  const both = /\.ui-avatar,\s*\.ui-art\s*\{([^}]*)\}/.exec(UI_CSS);
  assert.ok(both, 'the shared .ui-avatar/.ui-art base rule');
  assert.match(both[1], /width:\s*var\(--av\);/);
  assert.match(both[1], /height:\s*var\(--av\);/);
  assert.match(both[1], /overflow:\s*hidden;/, 'a larger image is clipped to the box');
  assert.match(both[1], /flex:\s*none;/, 'never grows or shrinks in a flex row');
  assert.match(uiRule('.ui-avatar') || '', /border-radius:\s*50%;/, 'a circle');
});

test('ui-avatar sizes: the sidebar rows use xs (20px), the phone sheet md (36px), from the D2.3 tokens', () => {
  assert.match(UI_CSS, /\.ui-avatar--xs \{ --av: var\(--av-xs\); \}/);
  assert.match(UI_CSS, /\.ui-avatar--md \{ --av: var\(--av-md\); \}/);
  assert.match(TOKENS, /--av-xs:\s*20px;/);
  assert.match(TOKENS, /--av-md:\s*36px;/);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  assert.match(src, /link\.appendChild\(buildPinAvatarNode\(entry\.label, entry\.channelAvatarUrl\)\);/, 'the sidebar row takes the default (xs)');
  assert.match(src, /buildPinAvatarNode\(entry\.label, entry\.channelAvatarUrl, 'md'\)/, 'the sheet row takes md');
});

test('ui-avatar__img: fills its fixed box and crops (object-fit: cover)', () => {
  const r = uiRule('.ui-avatar__img');
  assert.ok(r, 'the .ui-avatar__img rule');
  assert.match(r, /width:\s*100%;/);
  assert.match(r, /height:\s*100%;/);
  assert.match(r, /object-fit:\s*cover;/);
});

test('buildPinAvatarNode: a photo pin is a ui-avatar img; a failed photo becomes the monogram (never a broken image); no inline colour', () => {
  const { JSDOM } = require('jsdom');
  const COMMON = require.resolve('../../public/js/common.js');
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const c = require(COMMON);
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  try {
    const el = c.buildPinAvatarNode('Harbor Workshop', 'https://example.com/a.jpg');
    assert.deepStrictEqual([...el.classList], ['ui-avatar', 'ui-avatar--xs', 'pinned-avatar']);
    const img = el.querySelector('img.ui-avatar__img');
    assert.ok(img && img.getAttribute('src') === 'https://example.com/a.jpg', 'the photo');
    img.dispatchEvent(new dom.window.Event('error'));
    assert.strictEqual(el.querySelector('img'), null, 'the broken image is dropped');
    assert.strictEqual(el.querySelector('.ui-avatar__mono').textContent, 'HW', 'the monogram replaces it');
    const mono = c.buildPinAvatarNode('Harbor Workshop', null, 'md');
    assert.ok(mono.classList.contains('ui-avatar--md') && mono.querySelector('.ui-avatar__mono'), 'no photo: the monogram at md');
    assert.strictEqual(mono.getAttribute('style'), null, 'no inline style (the tone is data-tone)');
  } finally {
    dom.window.close();
    delete global.document; delete global.window;
    delete require.cache[COMMON];
  }
});

test('no stylesheet sizes .pinned-avatar any more (the hook class never grows a second box)', () => {
  const style = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(style, /\.pinned-avatar[^{,]*\{/, 'no .pinned-avatar rule in style.css');
  assert.doesNotMatch(UI_CSS, /\.pinned-avatar/, 'nor in ui.css');
});

// v1.25.5 (coordinator follow-up) -> UI pass S5: a real channel-avatar <img> on the
// Subscriptions page (its rows and its settings sheet) is ui.avatar's now (D4.4), so the
// CSS contract moves to ui.css: the <img> fills the fixed-size box and crops to it, and
// the box clips it to its own shape (overflow hidden + its radius), so no image can
// render unbounded or square in a round avatar (the v1.25.5 bug). AC12: the retired
// .sub-row-avatar / .sub-sheet-avatar img rules are replaced here, not dropped.
const UI_CSS_RAW = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'ui.css'), 'utf8');
function findUiRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(UI_CSS_RAW);
}

test('.ui-avatar__img (the Subscriptions row + sheet avatar): fills the fixed-size box and crops to it (object-fit: cover)', () => {
  const rule = findUiRule('.ui-avatar__img');
  assert.ok(rule, 'expected a .ui-avatar__img rule in ui.css');
  assert.match(rule[1], /width:\s*100%;/);
  assert.match(rule[1], /height:\s*100%;/);
  assert.match(rule[1], /object-fit:\s*cover;/);
});

test('.ui-avatar / .ui-art: a fixed box that clips its image to its own shape (overflow hidden; circle vs rounded square)', () => {
  const box = /\n\.ui-avatar,\s*\n\.ui-art \{([^}]*)\}/.exec(UI_CSS_RAW);
  assert.ok(box, 'expected the shared .ui-avatar, .ui-art box rule');
  assert.match(box[1], /width:\s*var\(--av\);/);
  assert.match(box[1], /height:\s*var\(--av\);/);
  assert.match(box[1], /overflow:\s*hidden;/);
  assert.match(box[1], /flex:\s*none;/, 'never squeezed by a row');
  assert.match(UI_CSS_RAW, /\n\.ui-avatar \{ border-radius: 50%; \}/, 'channels are circles (decision 7)');
});
