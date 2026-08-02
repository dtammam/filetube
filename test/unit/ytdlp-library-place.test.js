'use strict';

// [UNIT] v1.69.0 T9 (D15) - the ytdlp `libraryPlace` field: strict two-value
// patch validation, add-time default, and the ensureYtdlp backfill.

const { test } = require('node:test');
const assert = require('node:assert');

const store = require('../../lib/ytdlp/store');

test('validateSubscriptionPatch: libraryPlace is a strict two-value allowlist', () => {
  assert.deepStrictEqual(store.validateSubscriptionPatch({ libraryPlace: 'podcasts' }).value, { libraryPlace: 'podcasts' });
  assert.deepStrictEqual(store.validateSubscriptionPatch({ libraryPlace: 'default' }).value, { libraryPlace: 'default' });
  for (const bad of ['music', '', 'PODCASTS', 0, true, null, {}]) {
    const r = store.validateSubscriptionPatch({ libraryPlace: bad });
    assert.strictEqual(r.ok, false, `rejects ${JSON.stringify(bad)}`);
  }
  const absent = store.validateSubscriptionPatch({ paused: true });
  assert.strictEqual(absent.ok, true);
  assert.ok(!('libraryPlace' in absent.value), 'absent stays absent (optional-subset posture)');
});

test('addSubscription: a new sub starts libraryPlace default', async () => {
  let saved = null;
  const deps = {
    updateDatabase: async (mutator) => { const db = {}; mutator(db); saved = db; },
    getMediaId: (s) => require('crypto').createHash('md5').update(s).digest('hex'),
  };
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@example' });
  assert.strictEqual(saved.ytdlp.subscriptions[0].libraryPlace, 'default');
});

test('ensureYtdlp backfills libraryPlace on pre-v1.69 records; junk migrates to default', () => {
  const db = {
    ytdlp: {
      subscriptions: [
        { id: 'a', channelUrl: 'https://youtube.com/@a', name: 'A' }, // pre-v1.69: absent
        { id: 'b', channelUrl: 'https://youtube.com/@b', name: 'B', libraryPlace: 'podcasts' }, // set: untouched
        { id: 'c', channelUrl: 'https://youtube.com/@c', name: 'C', libraryPlace: 'garbage' }, // junk: reset
      ],
    },
  };
  store.ensureYtdlp(db, Date.now());
  assert.strictEqual(db.ytdlp.subscriptions[0].libraryPlace, 'default');
  assert.strictEqual(db.ytdlp.subscriptions[1].libraryPlace, 'podcasts');
  assert.strictEqual(db.ytdlp.subscriptions[2].libraryPlace, 'default');
});
