'use strict';

// [UNIT] v1.363.1 (Dean): the chapter-name label is the chapters menu's only trigger and it is hidden for
// an item with fewer than two chapters, so "Add chapters" was unreachable exactly when needed. The cog now
// carries the editor's own row on the WATCH page. The real syncChaptersEditRow is lifted out of player.js
// (the player boots too much to stand up here) and driven with stubs, so the gate is BOUND, not grepped.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
const BLOCK = SRC.slice(SRC.indexOf('var chaptersEditRow = null;'), SRC.indexOf('if (settingsBtn) {', SRC.indexOf('var chaptersEditRow = null;')));

function harness(state) {
  const dom = new JSDOM('<body data-view="' + (state.view || 'watch') + '"><div id="settings-menu" hidden></div></body>');
  const document = dom.window.document;
  const calls = [];
  const env = {
    document, settingsMenu: document.getElementById('settings-menu'),
    get playerCanModifyLibrary() { return state.can; }, get currentId() { return state.id; },
    get currentChapters() { return state.chapters || []; },
    closeSettingsMenu: () => calls.push('close'), openChaptersEditorFromMenu: () => calls.push('open'),
  };
  const fn = new Function('env', 'with (env) {' + BLOCK + '; return syncChaptersEditRow; }');
  return { sync: fn(env), document, calls, row: () => document.getElementById('chapters-edit-btn') };
}

test('the extracted block is real (non-vacuous)', () => {
  assert.ok(BLOCK.length > 200 && /function syncChaptersEditRow/.test(BLOCK));
});

test('cog row: shown only with the modify capability, on the watch page, with a current id', () => {
  for (const [state, shown] of [
    [{ can: true, id: 'f1', view: 'watch' }, true],
    [{ can: false, id: 'f1', view: 'watch' }, false],
    [{ can: true, id: '', view: 'watch' }, false],
    [{ can: true, id: 'f1', view: 'music' }, false],
  ]) {
    const h = harness(state);
    h.sync();
    const row = h.row();
    assert.strictEqual(!!row && !row.hidden, shown, JSON.stringify(state));
  }
});

test('cog row: label follows the chapter count, a flip back to hidden is honoured, the click opens the SAME editor', () => {
  const st = { can: true, id: 'f1', view: 'watch', chapters: [] };
  const h = harness(st);
  h.sync();
  assert.strictEqual(h.row().textContent, 'Add chapters');
  st.chapters = [{ startTime: 0, title: 'A' }, { startTime: 9, title: 'B' }];
  h.sync();
  assert.strictEqual(h.row().textContent, 'Edit chapters');
  h.row().dispatchEvent(new h.document.defaultView.MouseEvent('click', { bubbles: true }));
  assert.deepStrictEqual(h.calls, ['close', 'open'], 'closes the cog, then opens the existing editor');
  st.can = false;
  h.sync();
  assert.strictEqual(h.row().hidden, true, 'a revoked capability hides it on the next open');
});
