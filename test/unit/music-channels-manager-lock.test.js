'use strict';

// [UNIT] v1.211 - SOURCE-LOCK on the Settings "Channels in Music" manager wiring
// in public/js/setup.js. It is thin glue over two routes that ARE behaviourally
// bound (music-library-projection.test.js: GET /api/music/channels honest state
// + visibility scope; POST /api/folders/music-flag capability + effect). A full
// setup.js jsdom boot is disproportionate for the glue, so this locks the
// load-bearing invariants against silent removal: the manager renders ONLY for a
// library-write user, reads the channel list, and writes an explicit on/off per
// toggle. Comments are stripped ONCE (the comment-porous-lock lesson).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('the manager renders only for a library-write user (admin or canModifyLibrary)', () => {
  const m = SRC.match(/musicChannelsGroup && musicChannelsList[\s\S]{0,3200}?musicChannelsGroup\.hidden = false/);
  assert.ok(m, 'the channels-manager render block is present');
  const block = m[0];
  assert.match(block, /me\.user\.role === 'admin' \|\| me\.user\.canModifyLibrary === true/, 'gated on the library-write capability');
  assert.match(block, /if \(!canModify\) return null/, 'a non-library-write user gets nothing (group stays hidden)');
});

test('the manager reads the channel list and writes an explicit on/off per toggle', () => {
  assert.match(SRC, /fetch\('\/api\/music\/channels'\)/, 'reads the channels list');
  assert.match(SRC, /const next = cb\.checked \? 'on' : 'off'/, 'the toggle chooses an explicit on/off');
  assert.match(SRC, /fetch\('\/api\/folders\/music-flag',[\s\S]{0,220}?method: 'POST'[\s\S]{0,220}?folderName: ch\.folderName, music: next/,
    'writes that explicit on/off for the tapped channel');
  assert.match(SRC, /cb\.checked = !!ch\.effective/, 'the checkbox reflects the honest effective state');
});

test('the group is revealed only after a successful render (hidden by default)', () => {
  assert.match(SRC, /musicChannelsGroup\.hidden = false/, 'unhides on success');
  // and it uses class-based rows (no raw literals on a governed JS style surface)
  assert.match(SRC, /row\.className = 'music-channels-row'/, 'class-based row, not inline .style literals');
});
