'use strict';

// [UNIT] v1.112 (Dean, settings cog): the control bar's Speed / CC / PiP controls
// were centralized OFF the bar into a single gear-triggered #settings-menu popup
// (YouTube's gear), and the separate `Ch` chapters button was removed (the
// persistent chapter-NAME label is the new trigger -- see the chapter-follow-along
// tests). This file is the authoritative STRUCTURE lock for that layout across
// ALL NINE shells that carry #player-host-template; the per-control markup byte
// locks live in player-{speed-btn,cc-btn,pip-btn,chapters}-parity.test.js.
//
// WHY all nine: player.js clones the persistent host ONCE from whichever shell
// booted the session (the SPA-lite router only swaps #view-root), so a shell
// missing/ drifting the cog would strand that whole session without Speed/CC/PiP.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SHELLS = [
  path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  path.join(ROOT, 'public', 'history.html'),
  path.join(ROOT, 'public', 'index.html'),
  path.join(ROOT, 'public', 'music.html'),
  path.join(ROOT, 'public', 'podcasts.html'),
  path.join(ROOT, 'public', 'read.html'),
  path.join(ROOT, 'public', 'setup.html'),
  path.join(ROOT, 'public', 'stats.html'),
  path.join(ROOT, 'public', 'watch.html'),
];

const SETTINGS_BTN_OPEN = '<button type="button" id="settings-btn" class="pc-btn settings-btn" aria-label="Settings" aria-haspopup="true" aria-expanded="false">';
const SETTINGS_MENU_OPEN = '<div id="settings-menu" class="chapters-menu settings-menu" hidden>';

test('cog parity: every shell carries exactly one #settings-btn (gear) with an inline <svg> glyph', () => {
  for (const shell of SHELLS) {
    const html = fs.readFileSync(shell, 'utf8');
    assert.ok(html.includes(SETTINGS_BTN_OPEN), `${path.basename(shell)} is missing the byte-identical #settings-btn opening tag`);
    assert.equal((html.match(/id="settings-btn"/g) || []).length, 1, `${path.basename(shell)} must have exactly one #settings-btn`);
    // Inline SVG (never a CSS mask -- the iOS mask decode-lag scar) inside the cog.
    assert.match(html, /id="settings-btn"[\s\S]{0,120}?<svg class="pc-svg-ico"/, `${path.basename(shell)}'s cog must carry an inline <svg class="pc-svg-ico">`);
  }
});

test('cog parity: the cog sits on the bar immediately BEFORE #fs-btn (gear then fullscreen, YouTube order)', () => {
  const cogThenFs = /id="settings-btn"[\s\S]*?<\/button>\s*\n\s*<button type="button" id="fs-btn"/;
  for (const shell of SHELLS) {
    const html = fs.readFileSync(shell, 'utf8');
    assert.match(html, cogThenFs, `${path.basename(shell)} must place #settings-btn immediately before #fs-btn`);
  }
});

test('cog parity: #settings-menu contains exactly Speed -> CC -> PiP, then closes', () => {
  const menuBody = /<div id="settings-menu" class="chapters-menu settings-menu" hidden>\s*\n\s*<button type="button" id="speed-btn"[^>]*>1×<\/button>\s*\n\s*<button type="button" id="cc-btn"[^>]*>CC<\/button>\s*\n\s*<button type="button" id="pip-btn"[^>]*>⧉<\/button>\s*\n\s*<\/div>/;
  for (const shell of SHELLS) {
    const html = fs.readFileSync(shell, 'utf8');
    assert.ok(html.includes(SETTINGS_MENU_OPEN), `${path.basename(shell)} is missing the #settings-menu wrapper`);
    assert.equal((html.match(/id="settings-menu"/g) || []).length, 1, `${path.basename(shell)} must have exactly one #settings-menu`);
    assert.match(html, menuBody, `${path.basename(shell)}'s #settings-menu must hold Speed, CC, PiP rows in that order`);
  }
});

// The strongest parity guard: the ENTIRE control-bar tail (from the cog through
// the two popups) must be byte-identical across all nine shells. Extract it and
// prove every shell equals the first -- mutate any shell's block and this reddens.
test('cog parity: the cog + settings-menu + popups tail is byte-identical across all nine shells', () => {
  const extractTail = (html) => {
    const start = html.indexOf('        ' + SETTINGS_BTN_OPEN);
    const endMarker = '<div id="speed-menu" class="chapters-menu speed-menu" hidden></div>';
    const end = html.indexOf(endMarker);
    assert.ok(start >= 0 && end > start, 'the control-bar tail must be present');
    return html.slice(start, end + endMarker.length);
  };
  const tails = SHELLS.map((s) => ({ name: path.basename(s), tail: extractTail(fs.readFileSync(s, 'utf8')) }));
  const ref = tails[0];
  for (const t of tails.slice(1)) {
    assert.equal(t.tail, ref.tail, `${t.name}'s control-bar tail drifted from ${ref.name}`);
  }
});

// ---- v1.112 T2: cog open/close WIRING source-locks --------------------------
// jsdom cannot exercise the real popup feel (Dean's device pass is the arbiter);
// these bind the load-bearing wiring so a refactor that severs it goes red.
const playerJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
const code = playerJs.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('cog wiring: ensureHost caches the cog refs alongside the rest of the bar', () => {
  assert.match(code, /settingsBtn = host\.querySelector\('#settings-btn'\)/, 'the gear ref is cached');
  assert.match(code, /settingsMenu = host\.querySelector\('#settings-menu'\)/, 'the menu ref is cached');
});

test('cog wiring: closeSettingsMenu hides the popup + resets aria, and rides the SHARED close chain', () => {
  const fn = /function closeSettingsMenu\(\) \{[\s\S]*?\n {4}\}/.exec(code);
  assert.ok(fn, 'closeSettingsMenu exists');
  assert.match(fn[0], /settingsMenu\.hidden = true/, 'it hides the menu');
  assert.match(fn[0], /settingsBtn\.setAttribute\('aria-expanded', 'false'\)/, 'it resets aria');
  // The shared lifecycle teardown (teardown/outside-tap/play-pause-seek) must
  // dismiss the cog too -- closeChaptersMenu is the one funnel.
  const closeChapters = /function closeChaptersMenu\(\) \{[\s\S]*?\n {4}\}/.exec(code);
  assert.ok(closeChapters, 'closeChaptersMenu exists');
  assert.match(closeChapters[0], /closeSettingsMenu\(\)/, 'closeChaptersMenu also dismisses the cog');
});

test('cog wiring: the gear toggles the menu, dismissing other bar popups first, clamped after unhiding', () => {
  const handler = /settingsBtn\.addEventListener\('click', function \(e\) \{[\s\S]*?\n {6}\}\);/.exec(code);
  assert.ok(handler, 'the cog click handler exists');
  assert.match(handler[0], /e\.stopPropagation\(\)/, 'stops the click reaching the document outside-close');
  assert.match(handler[0], /var opening = settingsMenu\.hidden;/, 'reads open state before mutating');
  assert.match(handler[0], /closeChaptersMenu\(\);/, 'opening the cog first tears down chapters/speed/sheet (and settings)');
  assert.match(handler[0], /settingsMenu\.hidden = false;\s*\n\s*clampBarMenuHeight\(settingsMenu\);/, 'clamps AFTER unhiding (rendered geometry)');
});

test('cog wiring: opening the speed picker closes the cog (no stacked popups)', () => {
  // Gate WARNING (adversarial M1): the old lazy `[\s\S]*?` re-anchored ~3900
  // chars away to the closeSettingsMenu() inside closeChaptersMenu, so deleting
  // the speed-row call stayed GREEN (presence != binding). Anchor to the handler
  // HEAD so the call must be the first statement after stopPropagation -- delete
  // it and stopPropagation is followed by `if (!speedMenu)`, so this reddens.
  // (`code` has comment-only lines stripped, so the call sits right below.)
  const speedHandler = /speedBtn\.addEventListener\('click', function \(e\) \{\s*\n\s*e\.stopPropagation\(\);\s*\n\s*closeSettingsMenu\(\);/.exec(code);
  assert.ok(speedHandler, 'the speed row must call closeSettingsMenu() FIRST, before opening its picker');
});

test('cog wiring: the cog has its own outside-close (click + pointerdown), guarded on its own open state', () => {
  const outside = /var closeSettingsMenuOnOutside = function \(e\) \{[\s\S]*?\n {6}\};/.exec(code);
  assert.ok(outside, 'closeSettingsMenuOnOutside exists');
  assert.match(outside[0], /if \(!settingsMenu \|\| settingsMenu\.hidden\) return;/, 'guards on its own open state');
  assert.match(outside[0], /settingsMenu\.contains\(e\.target\) \|\| \(settingsBtn && settingsBtn\.contains\(e\.target\)\)/, 'a tap on the menu or the gear is not outside');
  assert.match(code, /addEventListener\('click', closeSettingsMenuOnOutside\)/, 'click bound');
  assert.match(code, /addEventListener\('pointerdown', closeSettingsMenuOnOutside\)/, 'pointerdown bound (iOS)');
});

test('cog wiring: dock() inlines the cog dismissal (Back-button dock has no click for the outside-close)', () => {
  const dockStart = code.indexOf('function dock()');
  assert.notEqual(dockStart, -1, 'dock() exists');
  const dockBody = code.slice(dockStart, code.indexOf('\n  function ', dockStart + 10));
  assert.match(dockBody, /settingsMenu\.hidden = true/, 'dock() must not leave the cog invisibly open');
  assert.match(dockBody, /settingsBtn\.setAttribute\('aria-expanded', 'false'\)/, 'dock() resets the cog aria');
});

// ---- v1.112 T4: cog + settings-menu CSS ------------------------------------
const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');

test('cog CSS: the gear glyph is a sized inline svg (fill: currentColor)', () => {
  const rule = /\.pc-svg-ico \{[^}]*\}/.exec(css);
  assert.ok(rule, '.pc-svg-ico rule exists');
  assert.match(rule[0], /fill: currentColor/, 'the glyph inherits the button colour');
  assert.match(rule[0], /width: [^;]+;/, 'the glyph is sized');
});

test('cog CSS: the relocated controls render as full-width menu rows (bevel/border reset), labelled via ::before', () => {
  // Scoped under #settings-menu so the (id+class) selector beats the bare
  // `#speed-btn { width:auto }` id rule the relocated speed button still carries.
  const row = /#settings-menu \.settings-menu-item \{[^}]*\}/.exec(css);
  assert.ok(row, 'the #settings-menu .settings-menu-item row rule exists');
  assert.match(row[0], /width: 100%/, 'rows fill the menu width (overriding the .pc-btn square)');
  assert.match(row[0], /border: 0/, 'the .pc-btn border is reset');
  assert.match(row[0], /box-shadow: none/, 'the .pc-btn bevel is reset');
  assert.match(row[0], /justify-content: space-between/, 'label left, the value/glyph right');
  // ::before supplies each row's descriptive label.
  assert.match(css, /#settings-menu #speed-btn::before \{ content: "Playback speed"; \}/, 'speed row label');
  assert.match(css, /#settings-menu #cc-btn::before \{ content: "Subtitles"; \}/, 'CC row label');
  assert.match(css, /#settings-menu #pip-btn::before \{ content: "Picture-in-picture"; \}/, 'PiP row label');
});
