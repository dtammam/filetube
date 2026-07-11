'use strict';

// [UNIT] v1.21.0 FR-8 (T7), REFRAMED v1.24.9 -- the app-wide active-download
// status chip's pure helpers (public/js/common.js): the aggregate reducer,
// the collapsed-summary formatter, the auto-dismiss-vs-sticky lifecycle
// decision, the one-shot retry-body reconstruction, the poll-delay backoff,
// and the /subscriptions mount-suppression gate. None of these touch the
// DOM/fetch -- the actual chip DOM-wiring (`injectDownloadStatusChip`) is a
// thin, untested-by-necessity shell around them, same posture as
// `injectOneOffDownloadButtonIfEnabled`/`injectSubscriptionsNavLinkIfEnabled`
// (see test/unit/ytdlp-oneoff-modal.test.js's own header comment).
//
// v1.24.9: the chip was reframed from a "N queued (subscriptions)" counter
// into a pure ACTIVE-DOWNLOADS indicator -- a merely-`queued`/`listing`
// SUBSCRIPTION (the server marks EVERY targeted subscription `'queued'`
// before its serialized poll -- un-actionable "waiting to be checked" noise,
// not a real download backlog) no longer contributes to the chip's count or
// summary text at all, and the subscription Cancel/"Stop all" affordances
// were removed (the owner pauses a subscription from the /subscriptions
// page itself, and never wanted a queued cancel/dequeue action here).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  nextDownloadChipPollDelay,
  buildOneShotRetryBody,
  chipItemLifecycle,
  buildDownloadChipItem,
  reduceDownloadChipState,
  formatDownloadChipSummary,
  shouldShowDownloadChipOnPath,
  injectDownloadStatusChip,
  buildDownloadChipFailureLines,
  downloadChipItemShowsPercent,
  DL_CHIP_POLL_FAST_MS,
  snapshotHasActiveDownload,
  // v1.26 code-review fix (F2): the panel diff-update helpers, exercised
  // below against a purpose-built fake DOM (see that section's own header
  // comment).
  createDownloadChipItemRow,
  updateDownloadChipItemRow,
  updateDownloadChipPanel,
} = require('../../public/js/common.js');

// ---- buildOneShotRetryBody --------------------------------------------------

test('buildOneShotRetryBody reconstructs {url, format, quality, filetype, folder} from a full LiveEntry', () => {
  const entry = {
    state: 'error',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    label: 'My Folder',
    format: 'audio',
    quality: '720p',
    filetype: 'mp3',
    error: 'yt-dlp exited with code 1',
  };
  assert.deepEqual(buildOneShotRetryBody(entry), {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    format: 'audio',
    quality: '720p',
    filetype: 'mp3',
    folder: 'My Folder',
  });
});

test('buildOneShotRetryBody omits format/quality/filetype/folder that are absent/blank rather than sending garbage', () => {
  assert.deepEqual(
    buildOneShotRetryBody({ url: 'https://youtu.be/abc', format: '', quality: '   ' }),
    { url: 'https://youtu.be/abc' }
  );
});

test('buildOneShotRetryBody returns null for a missing/blank url -- fail-safe, never POSTs an empty body', () => {
  assert.equal(buildOneShotRetryBody(null), null);
  assert.equal(buildOneShotRetryBody(undefined), null);
  assert.equal(buildOneShotRetryBody({}), null);
  assert.equal(buildOneShotRetryBody({ url: '' }), null);
  assert.equal(buildOneShotRetryBody({ url: 42 }), null);
});

// ---- chipItemLifecycle (auto-dismiss vs. sticky) ---------------------------

test('chipItemLifecycle classifies done as auto-dismiss, error as sticky, everything else as active', () => {
  assert.equal(chipItemLifecycle('done'), 'auto-dismiss');
  assert.equal(chipItemLifecycle('error'), 'sticky');
  assert.equal(chipItemLifecycle('queued'), 'active');
  assert.equal(chipItemLifecycle('listing'), 'active');
  assert.equal(chipItemLifecycle('downloading'), 'active');
  assert.equal(chipItemLifecycle('some-future-unrecognized-state'), 'active');
});

// v1.24.0 A3: 'cancelled' is a NEW terminal state, distinct from 'error' --
// it is sticky (visible until dismissed) like an error, never auto-dismissed
// like 'done'.
test('chipItemLifecycle classifies cancelled as sticky, same as error', () => {
  assert.equal(chipItemLifecycle('cancelled'), 'sticky');
});

// ---- buildDownloadChipItem --------------------------------------------------

test('buildDownloadChipItem (oneshot): prefers the in-flight title, then falls back to label, then a per-kind placeholder', () => {
  const withTitle = buildDownloadChipItem('oneshot', 'job1', { state: 'downloading', title: 'Cool Video', label: 'Folder', percent: 40 });
  assert.equal(withTitle.name, 'Cool Video');

  const withLabelOnly = buildDownloadChipItem('oneshot', 'job2', { state: 'queued', label: 'My Folder' });
  assert.equal(withLabelOnly.name, 'My Folder');

  const withNeither = buildDownloadChipItem('oneshot', 'job3', { state: 'queued' });
  assert.equal(withNeither.name, 'One-off download');
});

// v1.24.8: every subscription row (including the 191 merely-`queued` ones
// with no `title` yet) is now labelled by CHANNEL, not a shared generic
// literal -- T2's frozen contract adds `name` to every subscription entry.
test('buildDownloadChipItem (subscription): labels the row by channel `name` -- even while merely queued (no title yet)', () => {
  const queued = buildDownloadChipItem('subscription', 'sub1', { state: 'queued', name: 'Cool Channel' });
  assert.equal(queued.name, 'Cool Channel');

  const listing = buildDownloadChipItem('subscription', 'sub2', { state: 'listing', name: 'Another Channel' });
  assert.equal(listing.name, 'Another Channel');

  const downloading = buildDownloadChipItem('subscription', 'sub3', { state: 'downloading', name: 'Active Channel', title: 'Ep 3', percent: 47 });
  assert.equal(downloading.name, 'Active Channel', 'the row label stays the CHANNEL name, not the in-flight video title');
});

test('buildDownloadChipItem (subscription): falls back to the in-flight title, then the generic literal, when `name` is absent', () => {
  const titleOnly = buildDownloadChipItem('subscription', 'sub1', { state: 'downloading', title: 'Some Video' });
  assert.equal(titleOnly.name, 'Some Video');

  const neither = buildDownloadChipItem('subscription', 'sub2', { state: 'listing' });
  assert.equal(neither.name, 'Subscription download');
});

// v1.24.8: a queued/listing subscription row's `statusText` never fabricates
// progress (no "N of M"/percent -- there is none yet); the actively
// downloading row's `statusText` DOES surface index/total via the shared
// `formatOneOffStatusText` formatter both namespaces already go through.
test('buildDownloadChipItem (subscription): a queued row shows no fake index/total/percent; the active row surfaces index/total', () => {
  const queued = buildDownloadChipItem('subscription', 'sub1', { state: 'queued', name: 'Channel A' });
  assert.equal(queued.statusText, 'Queued…');
  assert.doesNotMatch(queued.statusText, /\d+ of \d+/);
  assert.doesNotMatch(queued.statusText, /%/);

  const active = buildDownloadChipItem('subscription', 'sub2', {
    state: 'downloading', name: 'Channel B', title: 'Episode 3', index: 3, total: 12, percent: 47,
  });
  assert.match(active.statusText, /3 of 12/);
  assert.match(active.statusText, /47%/);
});

test('buildDownloadChipItem clamps percent to [0,100] and defaults a missing/invalid percent to 0', () => {
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'downloading', percent: 140 }).percent, 100);
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'downloading', percent: -5 }).percent, 0);
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'downloading' }).percent, 0);
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'downloading', percent: NaN }).percent, 0);
});

test('buildDownloadChipItem keys items by kind+id so a coincidentally-equal id across namespaces never collides', () => {
  const sub = buildDownloadChipItem('subscription', 'shared-id', { state: 'error' });
  const oneshot = buildDownloadChipItem('oneshot', 'shared-id', { state: 'error' });
  assert.notEqual(sub.key, oneshot.key);
});

test('buildDownloadChipItem marks retryable true only for an error state', () => {
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'error' }).retryable, true);
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'downloading' }).retryable, false);
  // v1.24.0 A3: 'cancelled' is a distinct terminal state -- a user-initiated
  // cancel is deliberately NOT auto-retryable via this flag.
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'cancelled' }).retryable, false);
});

test('buildDownloadChipItem returns null for a missing id or a non-object entry', () => {
  assert.equal(buildDownloadChipItem('oneshot', '', { state: 'error' }), null);
  assert.equal(buildDownloadChipItem('oneshot', 'job1', null), null);
  assert.equal(buildDownloadChipItem('oneshot', 'job1', 'not-an-object'), null);
});

// ---- v1.26 "real progress": phase + indeterminate --------------------------

test('buildDownloadChipItem carries a recognized "merging"/"converting" phase through unchanged, and marks the item indeterminate', () => {
  const merging = buildDownloadChipItem('oneshot', 'j1', { state: 'downloading', phase: 'merging', percent: 100 });
  assert.equal(merging.phase, 'merging');
  assert.equal(merging.indeterminate, true);

  const converting = buildDownloadChipItem('oneshot', 'j2', { state: 'downloading', phase: 'converting', percent: 100 });
  assert.equal(converting.phase, 'converting');
  assert.equal(converting.indeterminate, true);
});

test('buildDownloadChipItem: an unrecognized phase value is normalized to null (never trusted verbatim)', () => {
  const item = buildDownloadChipItem('oneshot', 'j', { state: 'downloading', phase: 'some-future-phase', percent: 10 });
  assert.equal(item.phase, null);
});

test('buildDownloadChipItem: downloading with no phase and no real percent yet is indeterminate', () => {
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'downloading' }).indeterminate, true);
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'downloading', percent: 0 }).indeterminate, true);
});

test('buildDownloadChipItem: downloading with a real percent and no phase is NOT indeterminate', () => {
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'downloading', percent: 40 }).indeterminate, false);
});

test('buildDownloadChipItem: a non-downloading state is never indeterminate (there is no bar motion to animate)', () => {
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'queued' }).indeterminate, false);
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'error' }).indeterminate, false);
  assert.equal(buildDownloadChipItem('oneshot', 'j', { state: 'done' }).indeterminate, false);
});

// ---- downloadChipItemShowsPercent: no fake "0%" on a merely-queued row ----

test('downloadChipItemShowsPercent: a one-shot row is UNCHANGED -- always shows a percent, even while queued', () => {
  assert.equal(downloadChipItemShowsPercent({ kind: 'oneshot', state: 'queued' }), true);
  assert.equal(downloadChipItemShowsPercent({ kind: 'oneshot', state: 'downloading' }), true);
  assert.equal(downloadChipItemShowsPercent({ kind: 'oneshot', state: 'error' }), true);
});

test('downloadChipItemShowsPercent: a subscription row shows a percent ONLY while actually downloading', () => {
  assert.equal(downloadChipItemShowsPercent({ kind: 'subscription', state: 'downloading' }), true);
  assert.equal(downloadChipItemShowsPercent({ kind: 'subscription', state: 'queued' }), false);
  assert.equal(downloadChipItemShowsPercent({ kind: 'subscription', state: 'listing' }), false);
  assert.equal(downloadChipItemShowsPercent({ kind: 'subscription', state: 'error' }), false);
  assert.equal(downloadChipItemShowsPercent({ kind: 'subscription', state: 'cancelled' }), false);
});

test('downloadChipItemShowsPercent: tolerates a missing/malformed item, never throws', () => {
  assert.equal(downloadChipItemShowsPercent(null), false);
  assert.equal(downloadChipItemShowsPercent(undefined), false);
  assert.equal(downloadChipItemShowsPercent('not-an-object'), false);
});

// ---- reduceDownloadChipState: the aggregate {count, hasError, items} -------

test('reduceDownloadChipState reports count 0 / hasError false for an empty snapshot', () => {
  const state = reduceDownloadChipState({ subscriptions: {}, oneShots: {} }, new Set());
  assert.deepEqual(state, { count: 0, hasError: false, items: [] });
});

test('reduceDownloadChipState includes active items from BOTH namespaces', () => {
  const snapshot = {
    subscriptions: { sub1: { state: 'downloading', percent: 30 } },
    oneShots: { job1: { state: 'queued' } },
  };
  const state = reduceDownloadChipState(snapshot, new Set());
  assert.equal(state.count, 2);
  assert.equal(state.hasError, false);
  const kinds = state.items.map((item) => item.kind).sort();
  assert.deepEqual(kinds, ['oneshot', 'subscription']);
});

// ---- v1.24.9 (the ACTIVE-DOWNLOADS reframe) --------------------------------
//
// A merely-`'queued'`/`'listing'` SUBSCRIPTION is sub-queue noise (the server
// marks EVERY targeted subscription 'queued' before its serialized poll --
// "waiting to be checked", not "about to download") and never contributes to
// the chip at all -- but a `'downloading'` subscription, ANY one-shot (even
// merely `'queued'` -- a single job the user just started themselves), and a
// sticky error/cancelled item all still count.

test('reduceDownloadChipState EXCLUDES a merely-"queued"/"listing" SUBSCRIPTION -- big-poll churn never shows in the chip', () => {
  const snapshot = {
    subscriptions: {
      sub1: { state: 'queued', name: 'Channel A' },
      sub2: { state: 'listing', name: 'Channel B' },
    },
    oneShots: {},
  };
  const state = reduceDownloadChipState(snapshot, new Set());
  assert.equal(state.count, 0, 'idle -- chip stays hidden through queued/listing churn');
  assert.deepEqual(state.items, []);
});

test('reduceDownloadChipState KEEPS a "downloading" subscription -- the one genuinely active item', () => {
  const snapshot = {
    subscriptions: { sub1: { state: 'downloading', name: 'Channel A', percent: 47 } },
    oneShots: {},
  };
  const state = reduceDownloadChipState(snapshot, new Set());
  assert.equal(state.count, 1);
  assert.equal(state.items[0].kind, 'subscription');
  assert.equal(state.items[0].state, 'downloading');
});

test('reduceDownloadChipState KEEPS a merely-"queued" ONE-SHOT -- a user-initiated job is not sub-queue noise', () => {
  const snapshot = { subscriptions: {}, oneShots: { job1: { state: 'queued', label: 'My Folder' } } };
  const state = reduceDownloadChipState(snapshot, new Set());
  assert.equal(state.count, 1);
  assert.equal(state.items[0].kind, 'oneshot');
  assert.equal(state.items[0].state, 'queued');
});

test('reduceDownloadChipState: a poll with 191 merely-queued subscriptions and ONE downloading yields count 1, not 192', () => {
  const subscriptions = { active: { state: 'downloading', name: 'Active Channel', percent: 47 } };
  for (let i = 0; i < 191; i += 1) {
    subscriptions['queued' + i] = { state: 'queued', name: 'Channel ' + i };
  }
  const state = reduceDownloadChipState({ subscriptions, oneShots: {} }, new Set());
  assert.equal(state.count, 1);
  assert.equal(state.items[0].id, 'active');
});

test('reduceDownloadChipState excludes a "done" item entirely (auto-dismiss -- AC56)', () => {
  const snapshot = { subscriptions: {}, oneShots: { job1: { state: 'done', percent: 100 } } };
  const state = reduceDownloadChipState(snapshot, new Set());
  assert.equal(state.count, 0);
  assert.deepEqual(state.items, []);
});

test('reduceDownloadChipState keeps an "error" item STICKY (visible) until its key is dismissed', () => {
  const snapshot = { subscriptions: {}, oneShots: { job1: { state: 'error', error: 'boom' } } };
  const notDismissed = reduceDownloadChipState(snapshot, new Set());
  assert.equal(notDismissed.count, 1);
  assert.equal(notDismissed.hasError, true);

  const dismissed = reduceDownloadChipState(snapshot, new Set(['oneshot:job1']));
  assert.equal(dismissed.count, 0);
  assert.equal(dismissed.hasError, false);
});

// v1.24.0 A3: a 'cancelled' one-shot stays STICKY (visible, never
// auto-dismissed) until its key is dismissed, and never counts toward
// hasError (it is not a failure).
test('reduceDownloadChipState keeps a "cancelled" one-shot STICKY (visible) until dismissed, and never counts as an error', () => {
  const snapshot = { subscriptions: {}, oneShots: { job1: { state: 'cancelled' } } };
  const notDismissed = reduceDownloadChipState(snapshot, new Set());
  assert.equal(notDismissed.count, 1);
  assert.equal(notDismissed.hasError, false);

  const dismissed = reduceDownloadChipState(snapshot, new Set(['oneshot:job1']));
  assert.equal(dismissed.count, 0);
});

test('reduceDownloadChipState accepts a plain array for dismissedKeys, not only a Set', () => {
  const snapshot = { subscriptions: {}, oneShots: { job1: { state: 'error' } } };
  const state = reduceDownloadChipState(snapshot, ['oneshot:job1']);
  assert.equal(state.count, 0);
});

test('reduceDownloadChipState tolerates a malformed/empty snapshot without throwing', () => {
  assert.doesNotThrow(() => reduceDownloadChipState(null, new Set()));
  assert.doesNotThrow(() => reduceDownloadChipState({}, new Set()));
  assert.deepEqual(reduceDownloadChipState(undefined, new Set()), { count: 0, hasError: false, items: [] });
});

// ---- formatDownloadChipSummary: the ACTIVE-DOWNLOADS summary (v1.24.9) ----
//
// Reframed from a queue-depth counter into a pure active-downloads
// indicator: "N queued" no longer exists anywhere in this function's output
// -- a merely-queued/listing SUBSCRIPTION never even reaches `state.items`
// (`reduceDownloadChipState` excludes it upstream), so this only ever
// describes three states: ACTIVE (something genuinely `'downloading'`),
// STICKY (nothing downloading, but a sticky error/cancelled item is
// present), or IDLE (neither -- empty string).

// ---- ACTIVE: something is genuinely downloading ----------------------------

test('formatDownloadChipSummary (ACTIVE): a single downloading item with name+statusText surfaces inline channel + progress, e.g. "Channel — 3 of 12 — 47%"', () => {
  const state = {
    items: [
      { state: 'downloading', percent: 47, name: 'Cool Channel', statusText: '3 of 12 — 47%' },
    ],
  };
  assert.equal(formatDownloadChipSummary(state), 'Cool Channel — 3 of 12 — 47%');
});

test('formatDownloadChipSummary (ACTIVE): a single downloading item with no name/statusText falls back to "1 downloading (X%)"', () => {
  const state = { items: [{ state: 'downloading', percent: 47 }] };
  assert.equal(formatDownloadChipSummary(state), '1 downloading (47%)');
});

test('formatDownloadChipSummary (ACTIVE): multiple downloading items report "N downloading (avg%)", never per-item detail', () => {
  const state = {
    items: [
      { state: 'downloading', percent: 20, name: 'A', statusText: 'x' },
      { state: 'downloading', percent: 60, name: 'B', statusText: 'y' },
    ],
  };
  assert.equal(formatDownloadChipSummary(state), '2 downloading (40%)');
});

test('formatDownloadChipSummary (ACTIVE): never lets a co-present sticky error item drag the downloading percent average down', () => {
  const state = {
    items: [
      { state: 'downloading', percent: 50 },
      { state: 'error', percent: 0 },
    ],
  };
  assert.equal(formatDownloadChipSummary(state), '1 downloading (50%)');
});

test('formatDownloadChipSummary (ACTIVE): a co-present merely-queued one-shot never leaks into the downloading headline', () => {
  const state = {
    items: [
      { state: 'downloading', percent: 50, name: 'Active Channel', statusText: '3 of 12 — 50%' },
      { state: 'queued' },
    ],
  };
  assert.equal(formatDownloadChipSummary(state), 'Active Channel — 3 of 12 — 50%');
});

// ---- STICKY: nothing downloading, but an error/cancelled item is present --

test('formatDownloadChipSummary (STICKY): reports "N download(s) failed" for one/multiple errors', () => {
  const oneError = { items: [{ state: 'error', percent: 0 }] };
  assert.equal(formatDownloadChipSummary(oneError), '1 download failed');

  const twoErrors = { items: [{ state: 'error', percent: 0 }, { state: 'error', percent: 0 }] };
  assert.equal(formatDownloadChipSummary(twoErrors), '2 downloads failed');
});

test('formatDownloadChipSummary (STICKY): only-cancelled items read "N stopped", never "failed" -- a deliberate Stop is not a failure', () => {
  const one = { items: [{ state: 'cancelled', percent: 0 }] };
  assert.equal(formatDownloadChipSummary(one), '1 stopped');

  const two = { items: [{ state: 'cancelled', percent: 0 }, { state: 'cancelled', percent: 0 }] };
  assert.equal(formatDownloadChipSummary(two), '2 stopped');
});

test('formatDownloadChipSummary (STICKY): a mix of error + cancelled distinguishes both, e.g. "1 failed · 2 stopped"', () => {
  const state = {
    items: [
      { state: 'error', percent: 0 },
      { state: 'cancelled', percent: 0 },
      { state: 'cancelled', percent: 0 },
    ],
  };
  assert.equal(formatDownloadChipSummary(state), '1 failed · 2 stopped');
});

// ---- IDLE: nothing downloading and nothing sticky --------------------------

test('formatDownloadChipSummary (IDLE): only a merely-queued one-shot present (no downloading, no sticky) -- empty string, not "N queued"', () => {
  const state = { items: [{ state: 'queued' }] };
  assert.equal(formatDownloadChipSummary(state), '');
});

test('formatDownloadChipSummary (IDLE): an all-"done" state never reaches here (auto-dismissed by reduceDownloadChipState upstream) -- empty items yields an empty string', () => {
  assert.equal(formatDownloadChipSummary({ items: [] }), '');
});

test('formatDownloadChipSummary (IDLE): returns an empty string for an empty/malformed state', () => {
  assert.equal(formatDownloadChipSummary({ items: [] }), '');
  assert.equal(formatDownloadChipSummary(null), '');
  assert.equal(formatDownloadChipSummary({}), '');
});

// ---- guard: the word "queued" must never appear in the summary output -----

test('formatDownloadChipSummary: the output NEVER contains the substring "queued", across every reachable state', () => {
  const cases = [
    { items: [{ state: 'downloading', percent: 47, name: 'Cool Channel', statusText: '3 of 12 — 47%' }] },
    { items: [{ state: 'downloading', percent: 47 }] },
    { items: [{ state: 'downloading', percent: 20 }, { state: 'downloading', percent: 60 }] },
    { items: [{ state: 'downloading', percent: 50 }, { state: 'queued' }] },
    { items: [{ state: 'error', percent: 0 }] },
    { items: [{ state: 'cancelled', percent: 0 }] },
    { items: [{ state: 'error', percent: 0 }, { state: 'cancelled', percent: 0 }] },
    { items: [{ state: 'queued' }] },
    { items: [] },
  ];
  cases.forEach((state) => {
    assert.doesNotMatch(formatDownloadChipSummary(state), /queued/i);
  });
});

// ---- shouldShowDownloadChipOnPath: /subscriptions self-suppression --------

test('shouldShowDownloadChipOnPath suppresses ONLY the exact /subscriptions path', () => {
  assert.equal(shouldShowDownloadChipOnPath('/subscriptions'), false);
  assert.equal(shouldShowDownloadChipOnPath('/'), true);
  assert.equal(shouldShowDownloadChipOnPath('/watch.html'), true);
  assert.equal(shouldShowDownloadChipOnPath('/setup.html'), true);
  assert.equal(shouldShowDownloadChipOnPath('/subscriptions/'), true, 'a trailing slash is a DIFFERENT path -- exact match only');
});

test('shouldShowDownloadChipOnPath tolerates a non-string pathname (defensively shows nothing to render against)', () => {
  assert.equal(shouldShowDownloadChipOnPath(null), false);
  assert.equal(shouldShowDownloadChipOnPath(undefined), false);
});

// ---- nextDownloadChipPollDelay: backoff reducer ----------------------------

test('nextDownloadChipPollDelay resets to the base cadence on success', () => {
  assert.equal(nextDownloadChipPollDelay(20000, true), 5000);
});

test('nextDownloadChipPollDelay doubles on failure, capped at the max', () => {
  assert.equal(nextDownloadChipPollDelay(5000, false), 10000);
  assert.equal(nextDownloadChipPollDelay(25000, false), 30000);
  assert.equal(nextDownloadChipPollDelay(30000, false), 30000);
});

test('nextDownloadChipPollDelay falls back to the base delay for an invalid previous value', () => {
  assert.equal(nextDownloadChipPollDelay(undefined, false), 10000);
  assert.equal(nextDownloadChipPollDelay(-5, false), 10000);
});

// v1.26 "real progress": adaptive fast poll while a download is active.

test('nextDownloadChipPollDelay: success + isActive resets to the fast ~700ms cadence', () => {
  assert.equal(nextDownloadChipPollDelay(20000, true, true), 700);
  assert.equal(DL_CHIP_POLL_FAST_MS, 700);
});

test('nextDownloadChipPollDelay: success + no isActive (or isActive omitted) keeps the pre-existing base-cadence behavior', () => {
  assert.equal(nextDownloadChipPollDelay(20000, true, false), 5000);
  assert.equal(nextDownloadChipPollDelay(20000, true), 5000, 'omitting isActive must behave exactly like the pre-v1.26 two-arg call');
});

test('nextDownloadChipPollDelay: a FAILURE still backs off exactly as before, regardless of isActive', () => {
  assert.equal(nextDownloadChipPollDelay(5000, false, true), 10000);
  assert.equal(nextDownloadChipPollDelay(30000, false, true), 30000);
});

// ---- v1.26 code-review fix (F5): backoff floors at the BASE cadence, ------
// never the (possibly much faster) previous delay ---------------------------

test('nextDownloadChipPollDelay: F5 -- a failure right after a fast (~700ms) success backs off from the BASE cadence, not from 700ms', () => {
  // Pre-fix, this doubled the raw 700ms fast-cadence value to 1400ms -- a
  // FASTER retry than the backoff's own original 10s first-retry ever was.
  assert.equal(
    nextDownloadChipPollDelay(DL_CHIP_POLL_FAST_MS, false),
    10000,
    'a failure must never retry faster than doubling the BASE cadence, even if the previous delay was the fast 700ms tick',
  );
});

// ---- snapshotHasActiveDownload ----------------------------------------------

test('snapshotHasActiveDownload: true when any subscription OR one-shot entry is genuinely and RECENTLY "downloading"', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  const fresh = new Date(nowMs - 1000).toISOString();
  assert.equal(snapshotHasActiveDownload({
    subscriptions: { sub1: { state: 'downloading', updatedAt: fresh } },
    oneShots: {},
  }, nowMs), true);
  assert.equal(snapshotHasActiveDownload({
    subscriptions: {},
    oneShots: { job1: { state: 'downloading', updatedAt: fresh } },
  }, nowMs), true);
});

test('snapshotHasActiveDownload: false when nothing is downloading (queued/listing/error/done churn only)', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  const fresh = new Date(nowMs - 1000).toISOString();
  assert.equal(snapshotHasActiveDownload({
    subscriptions: { sub1: { state: 'queued', updatedAt: fresh }, sub2: { state: 'listing', updatedAt: fresh } },
    oneShots: { job1: { state: 'error', updatedAt: fresh }, job2: { state: 'done', updatedAt: fresh } },
  }, nowMs), false);
});

// ---- v1.26 code-review fix (F4): staleness gate ----------------------------

test('snapshotHasActiveDownload: F4 -- a "downloading" entry with a STALE updatedAt (a wedged/wedged-forever download) is NOT active', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  const stale = new Date(nowMs - 20000).toISOString(); // 20s old, well past the 10s cutoff
  assert.equal(snapshotHasActiveDownload({
    subscriptions: { sub1: { state: 'downloading', updatedAt: stale } },
    oneShots: {},
  }, nowMs), false);
});

test('snapshotHasActiveDownload: F4 -- a "downloading" entry with a MISSING/unparseable updatedAt is NOT active (fails closed, never throws)', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  assert.equal(snapshotHasActiveDownload({
    subscriptions: { sub1: { state: 'downloading' } }, // no updatedAt at all
    oneShots: {},
  }, nowMs), false);
  assert.equal(snapshotHasActiveDownload({
    subscriptions: { sub1: { state: 'downloading', updatedAt: 'not-a-real-date' } },
    oneShots: {},
  }, nowMs), false);
});

test('snapshotHasActiveDownload: false and never throws for an empty/malformed/absent snapshot', () => {
  assert.equal(snapshotHasActiveDownload({ subscriptions: {}, oneShots: {} }), false);
  assert.doesNotThrow(() => snapshotHasActiveDownload(null));
  assert.equal(snapshotHasActiveDownload(null), false);
  assert.equal(snapshotHasActiveDownload(undefined), false);
  assert.equal(snapshotHasActiveDownload({}), false);
});

// ---- v1.21 FIX 3: injectDownloadStatusChip's synchronous double-inject guard

// The actual chip DOM node is only created inside the `fetch(...).then(...)`
// callback (an async round-trip) -- so the ORIGINAL `getElementById`-only
// guard could not stop a second call issued before the first fetch
// resolves. This stubs a minimal global `document`/`fetch` (no full DOM
// needed) sufficient to prove the fix: calling `injectDownloadStatusChip()`
// twice back-to-back, SYNCHRONOUSLY (before either fetch has a chance to
// resolve), only ever issues ONE network request -- the module-scoped
// `dlStatusChipInjectStarted` flag (set before the fetch, not after)
// short-circuits the second call.
// ---- v1.24.0 A2 (T14): buildDownloadChipFailureLines ------------------------

test('buildDownloadChipFailureLines: an attributed failure with a title renders "title: reason"', () => {
  const rawEntry = { state: 'error', failures: [{ videoId: 'vid1', title: 'My Video', reason: 'Video unavailable' }] };
  assert.deepEqual(buildDownloadChipFailureLines('error', rawEntry), ['My Video: Video unavailable']);
});

test('buildDownloadChipFailureLines: an attributed failure with NO title falls back to the raw videoId', () => {
  const rawEntry = { state: 'error', failures: [{ videoId: 'vid1', reason: 'Video unavailable' }] };
  assert.deepEqual(buildDownloadChipFailureLines('error', rawEntry), ['vid1: Video unavailable']);
});

test('buildDownloadChipFailureLines: an UNATTRIBUTED failure (videoId: null, no title) renders "Unknown video: reason" -- surfaced, never dropped', () => {
  const rawEntry = { state: 'error', failures: [{ videoId: null, reason: 'Some unattributable error' }] };
  assert.deepEqual(buildDownloadChipFailureLines('error', rawEntry), ['Unknown video: Some unattributable error']);
});

test('buildDownloadChipFailureLines: multiple failures render one line each, in order', () => {
  const rawEntry = {
    state: 'error',
    failures: [
      { videoId: 'vid1', title: 'First', reason: 'reason A' },
      { videoId: 'vid2', reason: 'reason B' },
    ],
  };
  assert.deepEqual(buildDownloadChipFailureLines('error', rawEntry), [
    'First: reason A',
    'vid2: reason B',
  ]);
});

test('buildDownloadChipFailureLines: returns [] when state is not "error", even if a stale failures array is still present on the entry', () => {
  const rawEntry = { state: 'done', failures: [{ videoId: 'vid1', reason: 'stale reason from a prior cycle' }] };
  assert.deepEqual(buildDownloadChipFailureLines('done', rawEntry), []);
  assert.deepEqual(buildDownloadChipFailureLines('downloading', rawEntry), []);
});

test('buildDownloadChipFailureLines: returns [] for a missing/malformed failures array, or a missing rawEntry -- never throws', () => {
  assert.deepEqual(buildDownloadChipFailureLines('error', { state: 'error' }), []);
  assert.deepEqual(buildDownloadChipFailureLines('error', { state: 'error', failures: 'not-an-array' }), []);
  assert.deepEqual(buildDownloadChipFailureLines('error', null), []);
  assert.deepEqual(buildDownloadChipFailureLines('error', undefined), []);
});

test('injectDownloadStatusChip: a second synchronous call before the first fetch resolves is a no-op (only one fetch fires)', () => {
  const originalDocument = global.document;
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.document = { getElementById: () => null };
  global.fetch = () => {
    fetchCalls += 1;
    return new Promise(() => {}); // never resolves -- this test only cares about the SYNCHRONOUS call count
  };
  try {
    injectDownloadStatusChip();
    injectDownloadStatusChip();
    assert.equal(fetchCalls, 1, 'a second concurrent call must not issue its own fetch/build its own chip');
  } finally {
    global.document = originalDocument;
    global.fetch = originalFetch;
  }
});

// ---- v1.26 code-review fix (F2): panel diff-update helpers -----------------
//
// A purpose-built, minimal fake DOM (mirrors the FakeElement patterns
// already established in ytdlp-oneoff-modal.test.js/oneoff-modal-teardown.
// test.js) sufficient to prove `updateDownloadChipPanel` reuses row DOM
// nodes across ticks instead of rebuilding them -- the exact defect class
// F2 fixes (the fill's width transition never firing, the barber-pole
// animation restarting, Cancel/Retry/Dismiss buttons losing a bound tap).

class FakeChipElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this._textContent = '';
    this._listeners = {};
    this.style = {};
    this.hidden = false;
    this._classes = new Set();
    this.classList = {
      add: (cls) => this._classes.add(cls),
      remove: (cls) => this._classes.delete(cls),
      contains: (cls) => this._classes.has(cls),
      toggle: (cls, force) => {
        const on = force !== undefined ? Boolean(force) : !this._classes.has(cls);
        if (on) this._classes.add(cls); else this._classes.delete(cls);
        return on;
      },
    };
  }

  appendChild(child) {
    // Real-DOM semantics: appending an ALREADY-present child MOVES it (no
    // duplicate, no new node) -- this is what lets `updateDownloadChipPanel`
    // reorder rows via a plain `appendChild` without ever recreating them.
    if (child.parentElement === this) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
    } else if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parentElement = null;
    return child;
  }

  get firstChild() {
    return this.children.length > 0 ? this.children[0] : null;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  addEventListener(type, handler) {
    (this._listeners[type] = this._listeners[type] || []).push(handler);
  }

  fire(type, evt) {
    const event = evt || { target: this };
    (this._listeners[type] || []).forEach((fn) => fn(event));
  }

  click() {
    this.fire('click', { target: this });
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }
}

const fakeChipDoc = { createElement: (tag) => new FakeChipElement(tag) };

function noopHandlers() {
  return { onCancel: () => {}, onRetry: () => {}, onDismiss: () => {} };
}

test('createDownloadChipItemRow: builds a row with every optional section present but hidden by default', () => {
  const row = createDownloadChipItemRow(fakeChipDoc, noopHandlers());
  assert.equal(row.els.pctEl.hidden, true);
  assert.equal(row.els.track.hidden, true);
  assert.equal(row.els.cancelActions.hidden, true);
  assert.equal(row.els.failuresWrap.hidden, true);
  assert.equal(row.els.actions.hidden, true);
});

test('updateDownloadChipItemRow: populates name/status/percent/fill width on a freshly built row', () => {
  const row = createDownloadChipItemRow(fakeChipDoc, noopHandlers());
  const item = {
    key: 'oneshot:job1', id: 'job1', kind: 'oneshot', name: 'My Video',
    percent: 42, state: 'downloading', phase: null, indeterminate: false,
    statusText: 'My Video — 42%',
  };
  updateDownloadChipItemRow(fakeChipDoc, row, item, {});
  assert.equal(row.els.nameEl.textContent, 'My Video');
  assert.equal(row.els.statusEl.textContent, 'My Video — 42%');
  assert.equal(row.els.pctEl.hidden, false);
  assert.equal(row.els.pctEl.textContent, '42%');
  assert.equal(row.els.track.hidden, false);
  assert.equal(row.els.fill.style.width, '42%');
  assert.equal(row.els.fill.classList.contains('indeterminate'), false);
});

test('updateDownloadChipPanel: the SAME key across two renders reuses the SAME row DOM node (not a fresh one)', () => {
  const panel = new FakeChipElement('div');
  const rowsByKey = new Map();
  const snapshot1 = { subscriptions: {}, oneShots: { job1: { state: 'downloading', percent: 10, title: 'Vid' } } };
  const state1 = reduceDownloadChipState(snapshot1, new Set());
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, state1, snapshot1, noopHandlers());
  assert.equal(panel.children.length, 1);
  const firstNode = panel.children[0];

  const snapshot2 = { subscriptions: {}, oneShots: { job1: { state: 'downloading', percent: 55, title: 'Vid' } } };
  const state2 = reduceDownloadChipState(snapshot2, new Set());
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, state2, snapshot2, noopHandlers());

  assert.equal(panel.children.length, 1, 'still exactly one row -- no stray duplicate/rebuilt node');
  assert.strictEqual(panel.children[0], firstNode, 'F2: the SAME key must reuse the SAME row node across renders, not a freshly built one');
});

test('updateDownloadChipPanel: the reused node\'s fill width is updated in place on the second render', () => {
  const panel = new FakeChipElement('div');
  const rowsByKey = new Map();
  const snapshot1 = { subscriptions: {}, oneShots: { job1: { state: 'downloading', percent: 10, title: 'Vid' } } };
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, reduceDownloadChipState(snapshot1, new Set()), snapshot1, noopHandlers());
  const row = panel.children[0];
  assert.equal(row.els.fill.style.width, '10%');

  const snapshot2 = { subscriptions: {}, oneShots: { job1: { state: 'downloading', percent: 55, title: 'Vid' } } };
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, reduceDownloadChipState(snapshot2, new Set()), snapshot2, noopHandlers());

  assert.strictEqual(panel.children[0], row, 'must still be the same node');
  assert.equal(row.els.fill.style.width, '55%', 'F2: the fill width must be updated on the REUSED node, not lost by a rebuild');
});

test('updateDownloadChipPanel: an item that disappears between renders (dismissed/settled) has its row REMOVED', () => {
  const panel = new FakeChipElement('div');
  const rowsByKey = new Map();
  const snapshot1 = {
    subscriptions: {},
    oneShots: {
      job1: { state: 'downloading', percent: 10, title: 'Vid1' },
      job2: { state: 'error', title: 'Vid2', error: 'boom' },
    },
  };
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, reduceDownloadChipState(snapshot1, new Set()), snapshot1, noopHandlers());
  assert.equal(panel.children.length, 2);
  assert.equal(rowsByKey.size, 2);

  // job2 dismissed (its key is now excluded from state.items, mirroring how
  // reduceDownloadChipState drops a dismissed sticky item).
  const dismissed = new Set(['oneshot:job2']);
  const state2 = reduceDownloadChipState(snapshot1, dismissed);
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, state2, snapshot1, noopHandlers());

  assert.equal(panel.children.length, 1, 'F2: the dismissed item\'s row must be removed from the panel');
  assert.equal(rowsByKey.size, 1, 'F2: the dismissed item\'s row must be dropped from the row cache too (no leak)');
  assert.equal(rowsByKey.has('oneshot:job2'), false);
  assert.equal(rowsByKey.has('oneshot:job1'), true);
});

test('updateDownloadChipPanel: Cancel/Retry/Dismiss buttons are the SAME node across renders (never re-created/re-bound)', () => {
  const panel = new FakeChipElement('div');
  const rowsByKey = new Map();
  const snapshot1 = { subscriptions: {}, oneShots: { job1: { state: 'error', title: 'Vid', error: 'boom' } } };
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, reduceDownloadChipState(snapshot1, new Set()), snapshot1, noopHandlers());
  const row = panel.children[0];
  const retryBtn = row.els.retryBtn;
  const dismissBtn = row.els.dismissBtn;
  assert.equal(retryBtn.hidden, false);
  assert.equal(dismissBtn.hidden, false);

  const snapshot2 = { subscriptions: {}, oneShots: { job1: { state: 'error', title: 'Vid', error: 'still broken' } } };
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, reduceDownloadChipState(snapshot2, new Set()), snapshot2, noopHandlers());

  assert.strictEqual(row.els.retryBtn, retryBtn, 'F2: Retry must be the SAME button node, never destroyed/recreated under a poll tick');
  assert.strictEqual(row.els.dismissBtn, dismissBtn, 'F2: Dismiss must be the SAME button node, never destroyed/recreated under a poll tick');
});

test('updateDownloadChipPanel: clicking Retry invokes the SAME handler with the current item/rawEntry after a re-render (listener still bound)', () => {
  const panel = new FakeChipElement('div');
  const rowsByKey = new Map();
  let retryCalls = 0;
  let lastRawEntry = null;
  const handlers = { onCancel: () => {}, onRetry: (item, rawEntry) => { retryCalls += 1; lastRawEntry = rawEntry; }, onDismiss: () => {} };

  const snapshot1 = { subscriptions: {}, oneShots: { job1: { state: 'error', title: 'Vid', error: 'first error' } } };
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, reduceDownloadChipState(snapshot1, new Set()), snapshot1, handlers);

  const snapshot2 = { subscriptions: {}, oneShots: { job1: { state: 'error', title: 'Vid', error: 'second error' } } };
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, reduceDownloadChipState(snapshot2, new Set()), snapshot2, handlers);

  const row = panel.children[0];
  row.els.retryBtn.click();
  assert.equal(retryCalls, 1);
  assert.equal(lastRawEntry.error, 'second error', 'the still-bound listener must act on the LATEST data, not a stale first-render snapshot');
});

// ---- v1.29.0 T6 (R1.3): CONFIRMATION -- the chip's one-shot Retry is -------
// already reachable in the error state (no new UI needed on this surface;
// see `els.retryBtn.hidden = item.state !== 'error'` in
// `updateDownloadChipItemRow` above, and `injectDownloadStatusChip`'s own
// `onRetry` dispatch which calls `retryOneShot(rawEntry, item.key)` for a
// `kind === 'oneshot'` item). This is a REGRESSION lock, not new coverage of
// new behavior -- it fails loudly if a future change ever re-narrows the
// gate away from a one-shot's error state.

test('T6 R1.3 confirmation: a ONE-SHOT chip item in error state has its Retry button reachable (not hidden), and Retry is hidden for every non-error one-shot state', () => {
  const errorItem = buildDownloadChipItem('oneshot', 'job1', { state: 'error', title: 'Vid', error: 'boom' });
  assert.equal(errorItem.retryable, true);

  const errorRow = createDownloadChipItemRow(fakeChipDoc, noopHandlers());
  updateDownloadChipItemRow(fakeChipDoc, errorRow, errorItem, { state: 'error', title: 'Vid', error: 'boom' });
  assert.equal(errorRow.els.retryBtn.hidden, false, 'Retry must be reachable for a one-shot job in the error state');
  assert.equal(errorRow.els.actions.hidden, false, 'the actions row containing Retry must itself be visible too');

  for (const state of ['queued', 'downloading', 'done', 'cancelled']) {
    const item = buildDownloadChipItem('oneshot', 'job2', { state, title: 'Vid' });
    const row = createDownloadChipItemRow(fakeChipDoc, noopHandlers());
    updateDownloadChipItemRow(fakeChipDoc, row, item, { state, title: 'Vid' });
    assert.equal(row.els.retryBtn.hidden, true, `Retry must stay hidden for a one-shot in state "${state}"`);
  }
});

test('T6 R1.3 confirmation: clicking Retry on a one-shot error row invokes onRetry(item, rawEntry) with kind "oneshot" -- the live wiring dispatches this to retryOneShot', () => {
  const calls = [];
  const handlers = { onCancel: () => {}, onRetry: (item, rawEntry) => calls.push({ item, rawEntry }), onDismiss: () => {} };
  const panel = new FakeChipElement('div');
  const rowsByKey = new Map();
  const snapshot = { subscriptions: {}, oneShots: { job1: { state: 'error', title: 'Vid', error: 'boom', url: 'https://youtu.be/x' } } };
  updateDownloadChipPanel(fakeChipDoc, panel, rowsByKey, reduceDownloadChipState(snapshot, new Set()), snapshot, handlers);

  panel.children[0].els.retryBtn.click();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].item.kind, 'oneshot');
  assert.equal(calls[0].rawEntry.url, 'https://youtu.be/x', 'the raw entry (the SAME shape buildOneShotRetryBody consumes) must be handed to onRetry');
});

