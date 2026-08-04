'use strict';

// ---- v1.77 Stop D: the Library-glyph settings lane -------------------------
//
// The five glyph keys join MIRRORED_SETTING_KEYS on the same per-user
// SERVER-persisted footing as the card corners (intake ruling 7). That set is a
// hard allowlist - a key not in it is a 400, not a silent drop - so a picker
// offering an entry whose key was never added would fail on every save while
// looking fine until reload.
//
// The keys are SPREAD FROM LIBRARY_GLYPH_SLOTS rather than re-typed in
// server.js. This file proves that binding actually holds end to end: every
// slot the picker will render is writable, and reading it back returns what was
// written. If someone later adds a slot to the registry and the spread is
// replaced by a hand-typed list, the derived loop below fails.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-libglyph-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { LIBRARY_GLYPH_SLOTS, GLYPH_POOL } = require('../../public/js/glyph-pool.js');

let server, base;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  // Residual #110: leave no mkdtemp dir behind.
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

const post = (body) => fetch(`${base}/api/me/settings`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const me = async () => (await (await fetch(`${base}/api/auth/me`)).json()).settings || {};

test('EVERY registry slot is writable and reads back - no dead option in the picker', async () => {
  for (const slot of LIBRARY_GLYPH_SLOTS) {
    const res = await post({ [slot.key]: 'shows' });
    assert.equal(res.status, 200, `${slot.key} was rejected - the picker would offer a dead entry`);
    assert.equal((await me())[slot.key], 'shows', `${slot.key} did not read back`);
  }
});

test('every pool id passes the value guard (hyphenated ids included)', async () => {
  // 'music-note' is the one that would break a stricter alphanumeric guard.
  for (const g of GLYPH_POOL) {
    const res = await post({ glyphBooks: g.id });
    assert.equal(res.status, 200, `pool id '${g.id}' was rejected by the settings guard`);
    assert.equal((await me()).glyphBooks, g.id);
  }
});

test("the 'default' meta-value round-trips, so a user can undo a choice", async () => {
  await post({ glyphBooks: 'shows' });
  assert.equal((await me()).glyphBooks, 'shows');
  const res = await post({ glyphBooks: 'default' });
  assert.equal(res.status, 200);
  assert.equal((await me()).glyphBooks, 'default',
    "'default' is stored verbatim; the client resolver maps it back to the shipped glyph");
});

test('null clears a glyph key, like every other mirrored setting', async () => {
  await post({ glyphMusic: 'radio' });
  await post({ glyphMusic: null });
  assert.ok(!('glyphMusic' in await me()), 'an explicit null must remove the key');
});

test('an unknown glyph key is a 400, not a silent write', async () => {
  for (const key of ['glyphNope', 'glyphSubscriptions', 'glyph', 'GLYPHBOOKS']) {
    const res = await post({ [key]: 'shows' });
    assert.equal(res.status, 400, `${key} must be rejected`);
  }
});

test('the value guard still bounds these keys (shape-only lane, renderer defends)', async () => {
  // Same posture as cornerTL/pushEnabled: the lane rejects anything outside the
  // charset/length bound, and the CLIENT resolver defends against a
  // charset-valid value that is not a real pool id. Locked so nobody
  // "hardens" this into a divergent second validator that could drift from the
  // registry the client uses.
  for (const bad of ['"><img src=x>', 'a'.repeat(33), 'has space', 'semi;colon']) {
    const res = await post({ glyphBooks: bad });
    assert.equal(res.status, 400, `${JSON.stringify(bad)} must be rejected by the value guard`);
  }
  const stillOk = await post({ glyphBooks: 'not-a-real-glyph-id' });
  assert.equal(stillOk.status, 200,
    'charset-valid garbage is accepted server-side by design - the client resolver is what maps it to the shipped glyph');
});
