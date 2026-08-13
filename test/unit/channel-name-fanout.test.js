'use strict';

// [UNIT] v1.115 (Dean, A1) -- `recordChannelNameBackfillFanout` (server.js's ONE
// channel->items NAME writer, deps-injected into the module's name-backfill
// batch) + `refreshPinLabelsForBackfilledChannel` (the pure pin snapshot
// re-label). DATA-MUTATING: pinned adversarially (the write path + the pin
// snapshot invariant), deps FAKE (in-memory db), no server boot.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-name-fanout-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { recordChannelNameBackfillFanout, refreshPinLabelsForBackfilledChannel } = require('../../server');

const UC_A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const UC_B = 'UCbbbbbbbbbbbbbbbbbbbbbb';

function makeDeps(metadata, ytdlp) {
  const db = { metadata, ytdlp: ytdlp || { pins: [] } };
  const mutatorReturns = [];
  let calls = 0;
  return {
    db,
    mutatorReturns,
    get calls() { return calls; },
    deps: { updateDatabase: (fn) => { calls += 1; mutatorReturns.push(fn(db)); return Promise.resolve(); } },
  };
}
const vid = (over) => Object.assign({ type: 'video', channelName: '', channelId: UC_A, folderName: 'AfterSkool' }, over);

test('fanout: writes the probed name to matching bad-name items, persists only on a change', async () => {
  const h = makeDeps({ a1: vid(), a2: vid({ channelName: '@handle' }), b: vid({ channelId: UC_B, folderName: 'Other' }) });
  const n = await recordChannelNameBackfillFanout(h.deps, { channelId: UC_A }, { channelName: 'After Skool' });
  assert.equal(n, 2, 'both A items written');
  assert.equal(h.db.metadata.a1.channelName, 'After Skool');
  assert.equal(h.db.metadata.a2.channelName, 'After Skool');
  assert.equal(h.db.metadata.b.channelName, '', 'different channel untouched');
  assert.deepEqual(h.mutatorReturns, [true], 'persisted (returned true) because something changed');
});

test('fanout: a blank/absent probed name is a total no-op -- never even calls updateDatabase', async () => {
  const h = makeDeps({ a: vid() });
  assert.equal(await recordChannelNameBackfillFanout(h.deps, { channelId: UC_A }, { channelName: '   ' }), 0);
  assert.equal(await recordChannelNameBackfillFanout(h.deps, { channelId: UC_A }, {}), 0);
  assert.equal(h.calls, 0, 'no db write attempted for a nameless probe');
  assert.equal(h.db.metadata.a.channelName, '');
});

test('fanout: a match-nothing pass returns false from the mutator (skip-the-save contract) and resolves 0', async () => {
  const h = makeDeps({ g: vid({ channelName: 'Already Real' }) });
  assert.equal(await recordChannelNameBackfillFanout(h.deps, { channelId: UC_A }, { channelName: 'Nope' }), 0);
  assert.deepEqual(h.mutatorReturns, [false], 'nothing changed -> no save');
  assert.equal(h.db.metadata.g.channelName, 'Already Real');
});

test('fanout ALSO refreshes the channel pin label (the snapshot the backfill would otherwise miss)', async () => {
  const pins = [{ id: 'p1', channelDir: '/media/AfterSkool', label: '@afterskool', pinnedAt: 1 }];
  const h = makeDeps({ a: vid() }, { pins });
  await recordChannelNameBackfillFanout(h.deps, { channelId: UC_A }, { channelName: 'After Skool' });
  assert.equal(pins[0].label, 'After Skool', 'the pin snapshot was re-labelled to the backfilled name');
});

// ---- refreshPinLabelsForBackfilledChannel (pure) ----------------------------
test('pin refresh: only relabels pins whose channelDir basename matches THIS channel folders', () => {
  const db = {
    metadata: { a: vid({ folderName: 'AfterSkool' }), b: vid({ channelId: UC_B, folderName: 'Other' }) },
    ytdlp: { pins: [
      { id: 'p1', channelDir: '/media/AfterSkool', label: '@old', pinnedAt: 1 },
      { id: 'p2', channelDir: '/media/Other', label: '@other', pinnedAt: 1 },
      { id: 'p3', channelDir: '/media/Unrelated', label: 'Unrelated', pinnedAt: 1 },
    ] },
  };
  const n = refreshPinLabelsForBackfilledChannel(db, { channelId: UC_A }, 'After Skool');
  assert.equal(n, 1, 'only p1 (this channel folder) relabelled');
  assert.equal(db.ytdlp.pins[0].label, 'After Skool');
  assert.equal(db.ytdlp.pins[1].label, '@other', 'a different channel pin untouched');
  assert.equal(db.ytdlp.pins[2].label, 'Unrelated');
});

test('pin refresh: blank name / no pins / no matching folder are safe no-ops', () => {
  assert.equal(refreshPinLabelsForBackfilledChannel({ metadata: {}, ytdlp: { pins: [] } }, { channelId: UC_A }, 'X'), 0);
  assert.equal(refreshPinLabelsForBackfilledChannel({ metadata: { a: vid() }, ytdlp: { pins: [{ channelDir: '/m/AfterSkool', label: 'x' }] } }, { channelId: UC_A }, '  '), 0, 'blank name no-op');
  assert.equal(refreshPinLabelsForBackfilledChannel({ metadata: { a: vid() } }, { channelId: UC_A }, 'X'), 0, 'no pins array -> 0');
});
