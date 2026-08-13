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
