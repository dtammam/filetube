'use strict';

// [UNIT] v1.157.1 (Dean device report, RE-ROOT-CAUSED): the desktop master-detail
// nav group headers (LIBRARY/SYSTEM/ACCOUNT on Settings; BREAKDOWNS/SYSTEM on
// Stats) "shifted up and stayed until refresh" on the first row click.
//
// Mechanism: `.md-nav` is `display: flex; flex-direction: column; gap:
// var(--space-N)`, and that flex `gap` is the SOLE separator between the groups
// (`.md-group` carries no margin). The desktop rule that re-shows the nav when a
// detail opens (data-md-open="true", overriding the mobile `.md-nav { display:
// none }`) used `display: block` - which drops the flex gap, so the groups
// collapsed together and stayed collapsed for as long as data-md-open stayed
// true (hence "until refresh"). Fix: re-show the opened nav as `flex`, not block.
//
// This binds the mechanism, not just the string: (a) the base `.md-nav` is flex
// WITH a gap (the separator), and (b) inside the desktop @media, the rule that
// applies to an OPENED `.md-nav` sets display:flex and NEVER display:block - a
// revert to block (split or grouped-selector form) goes red here.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

// Extract the desktop master-detail media block by brace-counting from the
// `@media (min-width: 769px)` that contains the .md-track grid (robust to nested
// braces, unlike a greedy regex).
function desktopMdBlock() {
  const at = CSS.indexOf('@media (min-width: 769px)');
  assert.ok(at !== -1, 'the desktop master-detail @media block exists');
  const open = CSS.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const block = CSS.slice(open + 1, i);
        // Gate SUGGESTION: anchor on the master-detail grid so that if a future
        // edit adds an EARLIER `@media (min-width: 769px)`, this fails loudly
        // instead of silently asserting against the wrong block.
        assert.match(block, /\.md-track\s*\{/, 'the desktop @media block is the master-detail one (has .md-track)');
        return block;
      }
    }
  }
  throw new Error('unbalanced braces after the desktop @media');
}

test('the base .md-nav is a flex column WITH a gap (the sole group separator)', () => {
  const m = /\.md-nav\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(m, '.md-nav base rule exists');
  assert.match(m[1], /display:\s*flex/, '.md-nav is display:flex');
  assert.match(m[1], /gap:\s*var\(--space-\d+\)/,
    '.md-nav carries the flex gap that separates the nav groups (LIBRARY/SYSTEM/ACCOUNT)');
  // .md-group must NOT carry its own inter-group margin - if it did, the gap
  // would not be the sole separator and this whole regression could not recur.
  const g = /\.md-group\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(g, '.md-group rule exists');
  assert.doesNotMatch(g[1], /margin/, '.md-group has no margin (the flex gap is the only separator)');
});

test('desktop: an OPENED .md-nav re-shows as flex, never block (the gap must survive a detail open)', () => {
  const block = desktopMdBlock();
  // The fix: the opened-nav reveal rule sets display:flex so the gap survives.
  assert.match(block, /\.md-root\[data-md-open="true"\]\s+\.md-nav\s*\{[^}]*display:\s*flex/,
    'the desktop rule re-showing the opened .md-nav must use display:flex (keeps the group gap)');
  // The regression: ANY rule whose block ends at `.md-nav {` and sets block
  // (split OR the old grouped `.md-panes, .md-nav { display: block }` form).
  assert.doesNotMatch(block, /\.md-root\[data-md-open="true"\]\s+\.md-nav\s*\{[^}]*display:\s*block/,
    'the opened .md-nav must NOT be display:block on desktop - block drops the flex gap and the groups collapse upward');
});
