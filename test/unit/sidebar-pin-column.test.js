'use strict';
// v1.341.1 (Dean, desktop): a long one-word pinned channel name ("heavymachinegun") pushed its pin
// right of every other row's pin. Measured headless with Dean's names: pin x 178 vs 173 before;
// 173 on every row after. The label is its own shrinkable, one-line, ellipsised element and the
// pin never shrinks (Dean picked one line + ellipsis over wrapping).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => { const m = CSS.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; };

test('the pinned label shrinks on one line with an ellipsis, and the pin keeps its width', () => {
  const label = rule('.sidebar-item__label');
  for (const d of [/flex:\s*1 1 0/, /min-width:\s*0/, /overflow:\s*hidden/, /text-overflow:\s*ellipsis/, /white-space:\s*nowrap/]) assert.match(label, d);
  assert.match(rule('.sidebar-item .ui-btn.pinned-unpin-btn'), /flex-shrink:\s*0/);
});

test('renderPinnedSidebar puts the label in .sidebar-item__label (never a bare text node)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  const body = src.slice(src.indexOf('function renderPinnedSidebar('), src.indexOf('function wirePinnedSidebarDragAndDrop('));
  assert.match(body, /label\.className = 'sidebar-item__label';/);
  assert.doesNotMatch(body, /createTextNode\(' ' \+ entry\.label\)/);
});
