'use strict';

// [UNIT] v1.21.0 FR-8 (T7) -- the app-wide active-download status chip's pure
// helpers (public/js/common.js): the aggregate reducer, the collapsed-summary
// formatter, the auto-dismiss-vs-sticky lifecycle decision, the one-shot
// retry-body reconstruction, the poll-delay backoff, and the /subscriptions
// mount-suppression gate. None of these touch the DOM/fetch -- the actual
// chip DOM-wiring (`injectDownloadStatusChip`) is a thin, untested-by-
// necessity shell around them, same posture as
// `injectOneOffDownloadButtonIfEnabled`/`injectSubscriptionsNavLinkIfEnabled`
// (see test/unit/ytdlp-oneoff-modal.test.js's own header comment).

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

test('buildDownloadChipItem prefers the in-flight title, then falls back to label, then a per-kind placeholder', () => {
  const withTitle = buildDownloadChipItem('oneshot', 'job1', { state: 'downloading', title: 'Cool Video', label: 'Folder', percent: 40 });
  assert.equal(withTitle.name, 'Cool Video');

  const withLabelOnly = buildDownloadChipItem('oneshot', 'job2', { state: 'queued', label: 'My Folder' });
  assert.equal(withLabelOnly.name, 'My Folder');

  const withNeither = buildDownloadChipItem('oneshot', 'job3', { state: 'queued' });
  assert.equal(withNeither.name, 'One-off download');

  const subWithNeither = buildDownloadChipItem('subscription', 'sub1', { state: 'listing' });
  assert.equal(subWithNeither.name, 'Subscription download');
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

// ---- formatDownloadChipSummary: the collapsed "N downloading · X%" text ---

test('formatDownloadChipSummary reports the active count and the average percent across active items only', () => {
  const state = {
    items: [
      { state: 'downloading', percent: 20 },
      { state: 'downloading', percent: 60 },
    ],
  };
  assert.equal(formatDownloadChipSummary(state), '2 downloading · 40%');
});

test('formatDownloadChipSummary never lets an errored item drag the active percent average down', () => {
  const state = {
    items: [
      { state: 'downloading', percent: 50 },
      { state: 'error', percent: 0 },
    ],
  };
  assert.equal(formatDownloadChipSummary(state), '1 downloading · 50%');
});

test('formatDownloadChipSummary reports "N download(s) failed" when nothing is active, never "0 downloading · 0%"', () => {
  const oneError = { items: [{ state: 'error', percent: 0 }] };
  assert.equal(formatDownloadChipSummary(oneError), '1 download failed');

  const twoErrors = { items: [{ state: 'error', percent: 0 }, { state: 'error', percent: 0 }] };
  assert.equal(formatDownloadChipSummary(twoErrors), '2 downloads failed');
});

test('formatDownloadChipSummary returns an empty string for an empty/malformed state', () => {
  assert.equal(formatDownloadChipSummary({ items: [] }), '');
  assert.equal(formatDownloadChipSummary(null), '');
  assert.equal(formatDownloadChipSummary({}), '');
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
