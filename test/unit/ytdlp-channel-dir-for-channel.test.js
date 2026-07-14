'use strict';

// [UNIT] v1.41.6 -- `resolveChannelDirForChannel` + its subscription join
// (`findSubscriptionForChannel`) + the "we cannot tell, so do not guess"
// predicate (`hasAmbiguousChannelSubscription`) + the opportunistic channelId
// backfill.
//
// THIS FILE EXISTS BECAUSE OF A GATE FINDING. Both reviewers independently found
// that the first cut SPLIT A SUBSCRIBED CHANNEL'S LIBRARY IN TWO, and neither the
// integration fixture nor any unit test caught it -- the fixture's subscription
// conveniently carried a `channelId`, which is the ONE shape the broken matcher
// handled. `addSubscription` never writes a channelId (it is backfilled only by a
// successful poll/probe), so the REAL, overwhelmingly common shape -- a
// subscription added by @handle that has not polled yet -- had no id at all, and
// the matcher then compared the item's canonical `/channel/UC…` URL against the
// sub's `/@handle` URL and missed. Result: imports filed into a PARALLEL folder,
// permanently (the relocator never moves an in-root file again).
//
// So the join is exercised here directly, in every combination of "which side
// knows which identity", against the ACTUAL record shape `addSubscription`
// produces.

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const ytdlp = require('../../lib/ytdlp');
const ytdlpArgs = require('../../lib/ytdlp/args');

const CONFIG = ytdlp.parseYtdlpConfig({
  FILETUBE_YTDLP_ENABLED: 'true',
  FILETUBE_YTDLP_DOWNLOAD_DIR: '/downloads',
});

// The item's identity, as v1.41.5's hydration persists it: yt-dlp returns the
// CANONICAL channel URL, and `sanitizeCapturedChannelMeta` also emits the handle
// form + the id.
const ITEM = {
  channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
  channelHandleUrl: 'https://www.youtube.com/@RickAstley',
  channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
  channelName: 'Rick Astley',
};

// EXACTLY what `addSubscription` persists for "subscribe to @RickAstley": the
// handle URL, a `name` of the user's choosing, and NO channelId.
const UNPOLLED_HANDLE_SUB = {
  id: 's1',
  channelUrl: 'https://www.youtube.com/@RickAstley',
  name: '@RickAstley',
};

function dbWith(subs) {
  return { ytdlp: { subscriptions: subs, pins: [], downloadMeta: {}, channelAvatars: {} } };
}

const CHANNEL_NAME_DIR = ytdlpArgs.resolveChannelDir(CONFIG, { name: ITEM.channelName });

test('THE GATE CRITICAL: an UNPOLLED @handle subscription (no channelId -- what addSubscription actually writes) is matched via the item\'s channelHandleUrl, so the import lands in the SUBSCRIPTION\'s folder, not a parallel one', () => {
  const db = dbWith([UNPOLLED_HANDLE_SUB]);
  const subsOwnDir = ytdlpArgs.resolveChannelDir(CONFIG, UNPOLLED_HANDLE_SUB);

  assert.notEqual(subsOwnDir, CHANNEL_NAME_DIR, 'sanity: the @handle folder and the display-name folder really are different');
  assert.equal(
    ytdlp.resolveChannelDirForChannel(db, CONFIG, ITEM),
    subsOwnDir,
    'the relocation must file into the folder that subscription\'s own downloads land in -- one channel, ONE folder',
  );
});

test('the id branch still wins when BOTH sides know a channelId (a polled subscription), even if the URL forms differ', () => {
  const polled = { ...UNPOLLED_HANDLE_SUB, channelId: ITEM.channelId, name: 'Rick Astley Official' };
  const db = dbWith([polled]);
  assert.equal(ytdlp.resolveChannelDirForChannel(db, CONFIG, ITEM), ytdlpArgs.resolveChannelDir(CONFIG, polled));
});

test('a subscription whose channelId belongs to a DIFFERENT channel is never matched (the join is exact, not fuzzy)', () => {
  const other = { id: 's2', channelUrl: 'https://www.youtube.com/@SomeoneElse', name: '@SomeoneElse', channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz' };
  const db = dbWith([other]);
  assert.equal(ytdlp.resolveChannelDirForChannel(db, CONFIG, ITEM), CHANNEL_NAME_DIR, 'unsubscribed -> the display-name folder (what a one-shot download of that channel also produces)');
});

test('the canonical-URL form matches too (a subscription added by /channel/UC… URL, unpolled)', () => {
  const canonicalSub = { id: 's3', channelUrl: ITEM.channelUrl, name: 'Rick Astley' };
  const db = dbWith([canonicalSub]);
  assert.equal(ytdlp.resolveChannelDirForChannel(db, CONFIG, canonicalSub.channelUrl ? ITEM : ITEM), ytdlpArgs.resolveChannelDir(CONFIG, canonicalSub));
});

test('no subscriptions at all -> the channel display-name folder, confined under the download dir', () => {
  const dir = ytdlp.resolveChannelDirForChannel(dbWith([]), CONFIG, ITEM);
  assert.equal(dir, CHANNEL_NAME_DIR);
  assert.equal(path.dirname(dir), path.resolve('/downloads'), 'confined: a direct child of the download root');
});

// ---- findSubscriptionForChannel (the join itself) ---------------------------

test('findSubscriptionForChannel: matches on channelId, on the canonical URL, and on the HANDLE url -- and returns null when it genuinely cannot', () => {
  assert.equal(ytdlp.findSubscriptionForChannel(dbWith([UNPOLLED_HANDLE_SUB]), ITEM).id, 's1', 'handle form');
  assert.equal(ytdlp.findSubscriptionForChannel(dbWith([{ id: 's3', channelUrl: ITEM.channelUrl, name: 'x' }]), ITEM).id, 's3', 'canonical form');
  assert.equal(ytdlp.findSubscriptionForChannel(dbWith([{ id: 's4', channelUrl: 'https://www.youtube.com/@Other', name: 'x', channelId: ITEM.channelId }]), ITEM).id, 's4', 'id wins over a mismatched URL');
  assert.equal(ytdlp.findSubscriptionForChannel(dbWith([{ id: 's5', channelUrl: 'https://www.youtube.com/@Other', name: 'x' }]), ITEM), null, 'a genuinely different channel');
  assert.equal(ytdlp.findSubscriptionForChannel(dbWith([]), ITEM), null);
});

// ---- hasAmbiguousChannelSubscription (skip rather than guess) ---------------

test('AMBIGUITY: an item with NO channelHandleUrl, against an UNPOLLED @handle subscription, is UNDECIDABLE -- the relocator must skip rather than risk a split', () => {
  const preV1415Item = { channelUrl: ITEM.channelUrl, channelId: ITEM.channelId, channelName: ITEM.channelName }; // no handle form
  assert.equal(
    ytdlp.hasAmbiguousChannelSubscription(dbWith([UNPOLLED_HANDLE_SUB]), preV1415Item),
    true,
    'neither identity is comparable to the other: "not subscribed" would be a GUESS, and guessing wrong splits the library forever',
  );
});

test('AMBIGUITY: it is FALSE whenever the question is actually decidable', () => {
  // (a) the item carries the handle form -> we compared both, a miss is a real miss
  assert.equal(ytdlp.hasAmbiguousChannelSubscription(dbWith([UNPOLLED_HANDLE_SUB]), ITEM), false);
  // (b) a subscription matched
  assert.equal(ytdlp.hasAmbiguousChannelSubscription(dbWith([{ id: 's3', channelUrl: ITEM.channelUrl, name: 'x' }]), ITEM), false);
  // (c) the only subscriptions are POLLED (they have ids -> the id branch decides)
  const polledOther = { id: 's6', channelUrl: 'https://www.youtube.com/@Other', name: 'x', channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz' };
  assert.equal(ytdlp.hasAmbiguousChannelSubscription(dbWith([polledOther]), { channelUrl: ITEM.channelUrl, channelId: ITEM.channelId }), false);
  // (d) no subscriptions at all
  assert.equal(ytdlp.hasAmbiguousChannelSubscription(dbWith([]), { channelUrl: ITEM.channelUrl }), false);
});

// ---- backfillSubscriptionChannelIdForChannel --------------------------------

test('the opportunistic channelId backfill writes the id onto an UNPOLLED matched subscription (so the ambiguity above can only ever cost ONE deferral)', async () => {
  const db = dbWith([{ ...UNPOLLED_HANDLE_SUB }]);
  const deps = {
    loadDatabase: () => db,
    updateDatabase: (fn) => Promise.resolve(fn(db)),
  };

  const changed = await ytdlp.backfillSubscriptionChannelIdForChannel(deps, ITEM);
  assert.equal(changed, true);
  assert.equal(db.ytdlp.subscriptions[0].channelId, ITEM.channelId, 'the subscription now carries the canonical channelId');

  // Write-once (the AC17 posture `recordSubscriptionChannelId` already enforces)
  // and idempotent on a re-run.
  const again = await ytdlp.backfillSubscriptionChannelIdForChannel(deps, ITEM);
  assert.equal(again, false, 'a second run is a no-op');
});

test('the channelId backfill is a no-op when the channel is not subscribed, or when we hold no id', async () => {
  const db = dbWith([{ id: 's5', channelUrl: 'https://www.youtube.com/@Other', name: 'x' }]);
  const deps = { loadDatabase: () => db, updateDatabase: (fn) => Promise.resolve(fn(db)) };

  assert.equal(await ytdlp.backfillSubscriptionChannelIdForChannel(deps, ITEM), false, 'not subscribed');
  assert.equal(await ytdlp.backfillSubscriptionChannelIdForChannel(deps, { channelUrl: ITEM.channelUrl }), false, 'no channelId in hand');
  assert.equal(db.ytdlp.subscriptions[0].channelId, undefined, 'and the unrelated subscription is untouched');
});

// ---- GATE FIX ROUND 2: ambiguity is about COMPARABILITY, not about `/@` -----
//
// `validateChannelUrl` accepts FOUR channel URL shapes (url.js
// CHANNEL_PATH_PATTERNS). The first cut of `hasAmbiguousChannelSubscription`
// only ever flagged `/@handle` subs -- so an id-less `/c/Name` or `/user/Name`
// subscription (equally uncomparable to an item's canonical `/channel/UC…` URL)
// sailed through as "not subscribed" and the import was filed into a PARALLEL
// folder, permanently. It also early-returned "decidable" whenever the ITEM had a
// `channelHandleUrl` -- but the item's handle tells you nothing about a `/c/` sub.
//
// The matrix below is exhaustive over the axes the gate named: every sub URL
// shape x (channelId / none) x (item carries channelHandleUrl / does not).

const SUB_URL_SHAPES = {
  handle: 'https://www.youtube.com/@RickAstley',
  canonical: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
  legacyC: 'https://www.youtube.com/c/RickAstley',
  legacyUser: 'https://www.youtube.com/user/RickAstley',
};
// A DIFFERENT channel in each shape -- so nothing below matches by URL, and the
// only question left is "could this sub secretly BE our channel?"
const OTHER_URL_SHAPES = {
  handle: 'https://www.youtube.com/@SomeoneElse',
  canonical: 'https://www.youtube.com/channel/UCzzzzzzzzzzzzzzzzzzzzzz',
  legacyC: 'https://www.youtube.com/c/SomeoneElse',
  legacyUser: 'https://www.youtube.com/user/SomeoneElse',
};
const ITEM_NO_HANDLE = { channelUrl: ITEM.channelUrl, channelId: ITEM.channelId, channelName: ITEM.channelName };

test('AMBIGUITY MATRIX: an id-less subscription in ANY non-/channel/ URL shape is ambiguous -- with or without the item\'s handle URL', () => {
  for (const [shape, url] of Object.entries(OTHER_URL_SHAPES)) {
    const idless = { id: 's', channelUrl: url, name: 'x' };
    const polled = { id: 's', channelUrl: url, name: 'x', channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz' };
    // `/channel/UC…` is the ONE shape an item can be compared against directly:
    // if it were our channel, the join would already have matched it.
    const expectedAmbiguous = shape !== 'canonical';

    for (const [label, item] of [['item WITH channelHandleUrl', ITEM], ['item WITHOUT channelHandleUrl', ITEM_NO_HANDLE]]) {
      assert.equal(
        ytdlp.hasAmbiguousChannelSubscription(dbWith([idless]), item),
        expectedAmbiguous,
        `id-less ${shape} sub, ${label}: expected ambiguous=${expectedAmbiguous}`,
      );
      // A POLLED sub (it has a channelId) is always decidable -- the id branch settles it.
      assert.equal(
        ytdlp.hasAmbiguousChannelSubscription(dbWith([polled]), item),
        false,
        `polled ${shape} sub, ${label}: a channelId always decides`,
      );
    }
  }
});

test('AMBIGUITY MATRIX: an id-less subscription whose URL IS one of the item\'s own forms is a REAL miss, never ambiguous (it simply is not this channel... and when it is, it MATCHES)', () => {
  // Same URL as the item's canonical/handle form -> the join matches it outright.
  for (const url of [SUB_URL_SHAPES.handle, SUB_URL_SHAPES.canonical]) {
    const sub = { id: 's', channelUrl: url, name: 'x' };
    assert.ok(ytdlp.findSubscriptionForChannel(dbWith([sub]), ITEM), `${url} must MATCH the item`);
    assert.equal(ytdlp.hasAmbiguousChannelSubscription(dbWith([sub]), ITEM), false, `${url}: matched -> decided`);
  }
});

test('C2-RESIDUAL REPRO: an id-less /c/ subscription for THIS channel must NOT be silently treated as "unsubscribed" -- that filed the import into a parallel folder', () => {
  // The subscription the user added: `/c/RickAstley`, never successfully polled,
  // so no channelId. Its downloads land in a folder derived from `sub.name`.
  const sub = { id: 's1', channelUrl: SUB_URL_SHAPES.legacyC, name: 'RickAstley' };
  const db = dbWith([sub]);
  const subsOwnDir = ytdlpArgs.resolveChannelDir(CONFIG, sub);

  assert.notEqual(subsOwnDir, CHANNEL_NAME_DIR, 'sanity: the sub folder and the display-name folder differ');
  // Nothing in the item is comparable to `/c/RickAstley`, so we CANNOT know this
  // is the same channel. The relocator must therefore refuse to move rather than
  // file into `CHANNEL_NAME_DIR` and split the channel across two folders forever.
  assert.equal(
    ytdlp.hasAmbiguousChannelSubscription(db, ITEM),
    true,
    'a /c/ sub with no channelId is UNCOMPARABLE -- guessing "unsubscribed" here is what split the library',
  );
});

test('an unparseable stored subscription URL is treated as ambiguous (fail toward not moving the file), never crashing the batch', () => {
  const sub = { id: 's1', channelUrl: 'not-a-url-at-all', name: 'x' };
  assert.equal(ytdlp.hasAmbiguousChannelSubscription(dbWith([sub]), ITEM), true);
});

test('a mix of subscriptions is ambiguous if ANY ONE of them is undecidable', () => {
  const polled = { id: 's1', channelUrl: OTHER_URL_SHAPES.handle, name: 'x', channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz' };
  const canonical = { id: 's2', channelUrl: OTHER_URL_SHAPES.canonical, name: 'y' };
  const idlessUser = { id: 's3', channelUrl: OTHER_URL_SHAPES.legacyUser, name: 'z' };

  assert.equal(ytdlp.hasAmbiguousChannelSubscription(dbWith([polled, canonical]), ITEM), false, 'all decidable');
  assert.equal(ytdlp.hasAmbiguousChannelSubscription(dbWith([polled, canonical, idlessUser]), ITEM), true, 'one id-less /user/ sub is enough to stop the move');
});

// ---- GATE FIX ROUND 3 (QA CRITICAL): the ID-LESS *ITEM* axis ---------------
//
// The mirror of the round-2 bug. An id decides NOTHING on its own: the join's id
// branch fires only when BOTH sides have one. The round-2 guard asked only whether
// the SUBSCRIPTION had an id and waved the move through on that -- so an item with
// NO channelId (a shape `sanitizeCapturedChannelMeta` produces BY DESIGN: it emits
// the field only when yt-dlp supplied one) against a POLLED, id-bearing @handle
// subscription was declared "decidable", missed, and filed into a parallel folder.
//
// The fix goes further than deferring: a canonical `/channel/UC…` URL LITERALLY
// CONTAINS the id, so it is read out of the URL and the subscription MATCHES.

const ITEM_NO_ID = { channelUrl: ITEM.channelUrl, channelName: ITEM.channelName }; // no channelId, no channelHandleUrl -- exactly QA's repro

test('QA REPRO: an item with NO channelId (canonical URL only) vs a POLLED @handle subscription -- the id is read OUT OF THE URL, so it MATCHES and lands in the subscription\'s folder', () => {
  const polledHandleSub = { id: 's1', channelUrl: 'https://www.youtube.com/@RickAstley', name: 'RickAstley', channelId: ITEM.channelId };
  const db = dbWith([polledHandleSub]);
  const subsOwnDir = ytdlpArgs.resolveChannelDir(CONFIG, polledHandleSub);

  assert.notEqual(subsOwnDir, CHANNEL_NAME_DIR, 'sanity: the sub folder and the display-name folder differ');
  assert.ok(ytdlp.findSubscriptionForChannel(db, ITEM_NO_ID), 'the subscription must be FOUND -- the item\'s canonical URL carries the id');
  assert.equal(ytdlp.hasAmbiguousChannelSubscription(db, ITEM_NO_ID), false, 'and therefore it is decided, not ambiguous');
  assert.equal(
    ytdlp.resolveChannelDirForChannel(db, CONFIG, ITEM_NO_ID),
    subsOwnDir,
    'SPLIT LIBRARY GUARD: the import must land where that subscription downloads',
  );
});

test('an item with NEITHER a channelId NOR a canonical URL (nothing to derive an id from) is AMBIGUOUS against a polled @handle sub -- an id on one side alone decides nothing', () => {
  const polledHandleSub = { id: 's1', channelUrl: 'https://www.youtube.com/@RickAstley', name: 'RickAstley', channelId: ITEM.channelId };
  // A `/c/`-only item identity: no id field, no id in the URL.
  const itemNoDerivableId = { channelUrl: 'https://www.youtube.com/c/RickAstley', channelName: 'Rick Astley' };
  assert.equal(ytdlp.findSubscriptionForChannel(dbWith([polledHandleSub]), itemNoDerivableId), null);
  assert.equal(
    ytdlp.hasAmbiguousChannelSubscription(dbWith([polledHandleSub]), itemNoDerivableId),
    true,
    'the SUB has an id but the ITEM has none and none can be derived -> the id branch decided NOTHING -> do not guess',
  );
});

test('AMBIGUITY MATRIX (id-less-ITEM axis): item {channelId present/absent} x {canonical URL or not} against a POLLED @handle subscription', () => {
  const polledHandleSub = { id: 's1', channelUrl: 'https://www.youtube.com/@RickAstley', name: 'RickAstley', channelId: ITEM.channelId };
  const db = dbWith([polledHandleSub]);
  const cases = [
    // [label, item, expectMatched, expectAmbiguous]
    ['id field + canonical URL', { channelUrl: ITEM.channelUrl, channelId: ITEM.channelId }, true, false],
    ['id field, NO canonical URL', { channelUrl: 'https://www.youtube.com/c/RickAstley', channelId: ITEM.channelId }, true, false],
    ['NO id field, canonical URL (id derivable)', { channelUrl: ITEM.channelUrl }, true, false],
    ['NO id field, NO canonical URL (nothing derivable)', { channelUrl: 'https://www.youtube.com/user/RickAstley' }, false, true],
  ];
  for (const [label, item, expectMatched, expectAmbiguous] of cases) {
    assert.equal(!!ytdlp.findSubscriptionForChannel(db, item), expectMatched, `${label}: matched=${expectMatched}`);
    assert.equal(ytdlp.hasAmbiguousChannelSubscription(db, item), expectAmbiguous, `${label}: ambiguous=${expectAmbiguous}`);
  }
});

test('extractChannelIdFromUrl: reads the id out of a canonical URL, re-validated through store.CHANNEL_ID_PATTERN, and never throws', () => {
  assert.equal(ytdlp.extractChannelIdFromUrl(ITEM.channelUrl), ITEM.channelId);
  assert.equal(ytdlp.extractChannelIdFromUrl('https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw/videos'), ITEM.channelId, 'a trailing path segment does not defeat it');
  assert.equal(ytdlp.extractChannelIdFromUrl('https://www.youtube.com/channel/not-a-real-id'), null, 'a malformed segment is NOT mistaken for an id');
  assert.equal(ytdlp.extractChannelIdFromUrl('https://www.youtube.com/@RickAstley'), null, 'a handle URL carries no id');
  assert.equal(ytdlp.extractChannelIdFromUrl('https://www.youtube.com/c/RickAstley'), null);
  assert.equal(ytdlp.extractChannelIdFromUrl('not a url'), null, 'never throws');
  assert.equal(ytdlp.extractChannelIdFromUrl(''), null);
  assert.equal(ytdlp.extractChannelIdFromUrl(undefined), null);
});

test('the derived id also matches a subscription that was added by CANONICAL URL and never polled (the id is read from the SUB\'s url too)', () => {
  const canonicalUnpolledSub = { id: 's1', channelUrl: ITEM.channelUrl, name: 'Rick Astley Official' };
  const itemHandleOnly = { channelUrl: 'https://www.youtube.com/@RickAstley', channelId: ITEM.channelId, channelName: 'Rick Astley' };
  const db = dbWith([canonicalUnpolledSub]);
  assert.ok(ytdlp.findSubscriptionForChannel(db, itemHandleOnly), 'the sub\'s own canonical URL yields its id');
  assert.equal(ytdlp.resolveChannelDirForChannel(db, CONFIG, itemHandleOnly), ytdlpArgs.resolveChannelDir(CONFIG, canonicalUnpolledSub));
});

// v1.41.6 gate round 3 (QA SUGGESTION 1): the SYMMETRIC MIRROR of the round-3
// CRITICAL. An item that carries ONLY a handle URL -- no canonical `/channel/`
// URL and no channelId, a shape reachable via sanitizeCapturedChannelMeta's
// uploaderUrl fallback -- has NOTHING to compare an id-less `/channel/UC...`
// subscription against. The previous guard carved such subs out as "directly
// comparable" and declared the pair decided, filing the file into a PARALLEL
// folder, permanently. Ambiguity is the only honest answer: skip the move.
test('an id-less canonical-URL subscription is AMBIGUOUS against an item that carries only a handle URL (nothing to compare it to)', () => {
  const idLessCanonicalSub = { id: 's1', channelUrl: ITEM.channelUrl, name: 'Rick Astley Official' };
  // No channelId, and no canonical channelUrl -- the ONLY thing this item knows
  // is its handle, so no id is derivable from either side of the comparison.
  const handleOnlyItem = { channelUrl: 'https://www.youtube.com/@SomeoneElse', channelName: 'Someone Else' };
  const db = dbWith([idLessCanonicalSub]);

  assert.equal(ytdlp.findSubscriptionForChannel(db, handleOnlyItem), null, 'genuinely cannot be matched');
  assert.equal(
    ytdlp.hasAmbiguousChannelSubscription(db, handleOnlyItem),
    true,
    'must be AMBIGUOUS -- declaring it decided files the video into a parallel folder forever',
  );
});

test('the ambiguity carve-out removal does not cost decidability: an id-bearing item still DECIDES against an id-less canonical sub', () => {
  // Both sides yield an id (the sub's comes from its own canonical URL), so
  // clause 1 settles it -- this is the case the removed carve-out was meant to
  // serve, and it is served correctly WITHOUT the carve-out.
  const otherChannelSub = { id: 's1', channelUrl: 'https://www.youtube.com/channel/UCZZZZZZZZZZZZZZZZZZZZZZ', name: 'Other' };
  const db = dbWith([otherChannelSub]);
  assert.equal(ytdlp.findSubscriptionForChannel(db, ITEM), null, 'a different channel: correctly no match');
  assert.equal(
    ytdlp.hasAmbiguousChannelSubscription(db, ITEM),
    false,
    'both sides had ids -- the id branch DECIDED "not this one"; the move may proceed',
  );
});
