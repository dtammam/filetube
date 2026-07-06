'use strict';

// [UNIT] lib/ytdlp/client/subscriptions.js -- the vanilla per-page controller
// for the optional yt-dlp /subscriptions page (T5). Requiring this file in
// Node is inert (its DOMContentLoaded wiring is guarded on `typeof document`,
// mirroring public/js/common.js), so its pure formatting helpers and its
// DOM-construction function (`createSubscriptionRow`) can be exercised
// directly here.
//
// This codebase has no jsdom/browser-DOM test harness (public/js/main.js and
// watch.js have no DOM-level tests either) -- so this file supplies a
// PURPOSE-BUILT, minimal fake `document`/`Element` (test-only, not a new
// runtime dependency) sufficient to exercise `createSubscriptionRow`'s real
// construction path. Its `innerHTML` setter unconditionally THROWS: if any
// future edit to subscriptions.js ever used `innerHTML` to render a
// subscription's `name`/`channelUrl`/status, this test would fail loudly
// rather than silently passing -- a stronger regression guard than merely
// asserting equality on the output.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  FORMAT_OPTIONS,
  QUALITY_OPTIONS,
  DEFAULT_QUALITY_OPTION,
  STATUS_POLL_BASE_MS,
  STATUS_POLL_MAX_MS,
  nextPollDelay,
  formatSubMeta,
  formatMaxVideos,
  formatSubStatus,
  formatLiveStatusText,
  buildFormatSelect,
  buildQualitySelect,
  createSubscriptionRow,
  createSubscriptionsListElement,
  createOneShotRow,
  createOneShotsListElement,
} = require('../../lib/ytdlp/client/subscriptions.js');

// ---- Minimal fake DOM (test-only) ------------------------------------------

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this._textContent = '';
    this._listeners = {};
    this.style = {};
    this.hidden = false;
    this.classList = {
      add: () => {},
      remove: () => {},
      contains: () => false,
    };
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, handler) {
    (this._listeners[type] = this._listeners[type] || []).push(handler);
  }

  // Simulates a click by invoking every registered 'click' listener --
  // lets a test prove a button's handler actually fires with the right args,
  // without a real browser event loop.
  click() {
    (this._listeners.click || []).forEach((fn) => fn());
  }

  get textContent() {
    return this._textContent;
  }

  // A real DOM's `textContent` setter NEVER parses its argument as markup --
  // it is always rendered as inert text, no matter what it contains. This
  // fake mirrors that (plain string storage, no parsing) so a test can assert
  // the exact literal value survived unparsed/uninterpreted.
  set textContent(value) {
    this._textContent = value;
    this.children = []; // matches real DOM: assigning textContent clears children
  }

  // Deliberately UNIMPLEMENTED as a hard failure: subscriptions.js must never
  // assign `innerHTML` for any server/user-derived string (name, channelUrl,
  // lastStatus). If it ever did, this setter turns that into an immediate,
  // loud test failure instead of a silently-passed XSS hole.
  set innerHTML(_value) {
    throw new Error(
      'subscriptions.js must never assign innerHTML with server/user-derived data -- use textContent instead'
    );
  }

  get innerHTML() {
    throw new Error('subscriptions.js must never read/assign innerHTML');
  }

  // Recursively collects every descendant (incl. this node) -- used below to
  // assert no unexpected element (e.g. a parsed <script>/<img>) exists
  // anywhere in the built row.
  *walk() {
    yield this;
    for (const child of this.children) {
      if (child instanceof FakeElement) yield* child.walk();
    }
  }
}

const fakeDoc = {
  createElement: (tag) => new FakeElement(tag),
};

// ---- Pure formatting helpers ------------------------------------------------

test('formatSubMeta: defaults to Video / best / default maxVideos when all are absent', () => {
  assert.strictEqual(formatSubMeta({}), 'Video · quality: best · max videos: default');
});

test('formatSubMeta: reflects audio format, a custom quality, and a set maxVideos', () => {
  assert.strictEqual(
    formatSubMeta({ format: 'audio', quality: '720p', maxVideos: 10 }),
    'Audio · quality: 720p · max videos: 10'
  );
});

test('formatMaxVideos: unset (undefined/null) renders "default"', () => {
  assert.strictEqual(formatMaxVideos({}), 'default');
  assert.strictEqual(formatMaxVideos({ maxVideos: null }), 'default');
});

test('formatMaxVideos: 0 renders "unlimited" (the per-sub unlimited sentinel)', () => {
  assert.strictEqual(formatMaxVideos({ maxVideos: 0 }), 'unlimited');
});

test('formatMaxVideos: a positive integer renders as-is', () => {
  assert.strictEqual(formatMaxVideos({ maxVideos: 42 }), '42');
});

test('formatSubStatus: "never checked" / "pending" when the subscription has not been polled yet', () => {
  assert.strictEqual(
    formatSubStatus({ lastCheckedAt: null, lastStatus: null }),
    'Last checked: never checked — pending'
  );
});

test('formatSubStatus: renders a real timestamp and status string', () => {
  const iso = '2026-07-05T12:00:00.000Z';
  const result = formatSubStatus({ lastCheckedAt: iso, lastStatus: 'ok: downloaded 2 new video(s)' });
  assert.ok(result.startsWith('Last checked: '));
  assert.ok(result.endsWith('— ok: downloaded 2 new video(s)'));
});

// ---- FR-B: dropdown option values -------------------------------------------

test('FORMAT_OPTIONS: exactly video (default) and audio, in that order', () => {
  assert.deepStrictEqual(FORMAT_OPTIONS.map((o) => o.value), ['video', 'audio']);
});

test('QUALITY_OPTIONS: exactly the args.js QUALITY_ALLOWLIST values, best first (the default)', () => {
  assert.deepStrictEqual(QUALITY_OPTIONS, ['best', '2160p', '1440p', '1080p', '720p', '480p', '360p']);
  assert.strictEqual(DEFAULT_QUALITY_OPTION, 'best');
});

test('buildFormatSelect: builds an option per FORMAT_OPTIONS entry with textContent-only labels and selects the given value', () => {
  const select = buildFormatSelect(fakeDoc, 'audio');
  assert.strictEqual(select.tagName, 'SELECT');
  assert.strictEqual(select.children.length, 2);
  assert.deepStrictEqual(select.children.map((o) => o.value), ['video', 'audio']);
  assert.deepStrictEqual(select.children.map((o) => o.textContent), ['Video', 'Audio only']);
  assert.strictEqual(select.value, 'audio');
});

test('buildQualitySelect: builds one option per QUALITY_ALLOWLIST value and defaults to "best" when unset', () => {
  const select = buildQualitySelect(fakeDoc, undefined);
  assert.deepStrictEqual(select.children.map((o) => o.value), QUALITY_OPTIONS);
  assert.strictEqual(select.value, 'best');
});

// ---- FR-E: live status formatting + poll-delay reducer ----------------------

test('formatLiveStatusText: returns null when there is no live entry (falls back to persisted status)', () => {
  assert.strictEqual(formatLiveStatusText(undefined), null);
  assert.strictEqual(formatLiveStatusText(null), null);
});

test('formatLiveStatusText: "idle" state also yields null (no live override)', () => {
  assert.strictEqual(formatLiveStatusText({ state: 'idle' }), null);
});

test('formatLiveStatusText: "queued" renders a short queued message', () => {
  assert.strictEqual(formatLiveStatusText({ state: 'queued' }), 'Queued…');
});

test('formatLiveStatusText: "listing" renders a short checking message', () => {
  assert.strictEqual(formatLiveStatusText({ state: 'listing' }), 'Checking for new videos…');
});

test('formatLiveStatusText: "downloading" renders title, N of M, and a rounded percent', () => {
  const result = formatLiveStatusText({
    state: 'downloading',
    title: 'Some Video Title',
    index: 2,
    total: 5,
    percent: 47.2,
  });
  assert.strictEqual(result, 'Some Video Title — 2 of 5 — 47%');
});

test('formatLiveStatusText: "downloading" tolerates missing title/index/total (defaults gracefully)', () => {
  const result = formatLiveStatusText({ state: 'downloading', percent: 0 });
  assert.strictEqual(result, 'Downloading — 0%');
});

test('formatLiveStatusText: "done" renders a short done message', () => {
  assert.strictEqual(formatLiveStatusText({ state: 'done', percent: 100 }), 'Done');
});

test('formatLiveStatusText: "error" renders the redacted error string verbatim', () => {
  assert.strictEqual(
    formatLiveStatusText({ state: 'error', error: 'error: yt-dlp exited with code 1' }),
    'error: yt-dlp exited with code 1'
  );
});

test('formatLiveStatusText: "error" with no error text falls back to a generic label (never throws)', () => {
  assert.strictEqual(formatLiveStatusText({ state: 'error' }), 'error');
});

test('nextPollDelay: success resets to the base ~2.5s cadence', () => {
  assert.strictEqual(nextPollDelay(20000, true), STATUS_POLL_BASE_MS);
});

test('nextPollDelay: failure doubles the previous delay', () => {
  assert.strictEqual(nextPollDelay(STATUS_POLL_BASE_MS, false), STATUS_POLL_BASE_MS * 2);
});

test('nextPollDelay: failure never exceeds the max cap, even after many consecutive failures', () => {
  let delay = STATUS_POLL_BASE_MS;
  for (let i = 0; i < 20; i += 1) delay = nextPollDelay(delay, false);
  assert.strictEqual(delay, STATUS_POLL_MAX_MS);
});

// ---- DOM construction: structure + handler wiring --------------------------

test('createSubscriptionRow: builds a row with the expected fields and wires the delete/re-pull handlers', () => {
  const sub = {
    id: 'abc123',
    name: 'My Channel',
    channelUrl: 'https://www.youtube.com/@mychannel',
    format: 'video',
    quality: 'best',
    lastCheckedAt: null,
    lastStatus: null,
  };
  const repullCalls = [];
  const deleteCalls = [];
  const row = createSubscriptionRow(sub, fakeDoc, {
    onRepull: (id) => repullCalls.push(id),
    onDelete: (s) => deleteCalls.push(s),
  });

  const texts = [...row.walk()].map((el) => el.textContent).filter(Boolean);
  assert.ok(texts.includes('My Channel'));
  assert.ok(texts.includes('https://www.youtube.com/@mychannel'));
  assert.ok(texts.some((t) => t.includes('Video')));

  const buttons = [...row.walk()].filter((el) => el.tagName === 'BUTTON');
  assert.strictEqual(buttons.length, 6, 'expected Pause, Edit, Re-pull, Delete, and the edit panel\'s Save/Cancel');
  const repullBtn = buttons.find((b) => b.textContent === 'Re-pull');
  const deleteBtn = buttons.find((b) => b.textContent === '×');
  const pauseBtn = buttons.find((b) => b.textContent === 'Pause');
  const editBtn = buttons.find((b) => b.textContent === 'Edit');
  assert.ok(repullBtn, 'Re-pull button must exist');
  assert.ok(deleteBtn, 'Delete button must exist');
  assert.ok(pauseBtn, 'Pause button must exist (subscription is not paused)');
  assert.ok(editBtn, 'Edit button must exist');

  repullBtn.click();
  assert.deepStrictEqual(repullCalls, ['abc123']);

  deleteBtn.click();
  assert.deepStrictEqual(deleteCalls, [sub]);
});

// ---- FR-D: pause/resume + inline edit ---------------------------------------

test('createSubscriptionRow: shows "Pause" for an active subscription and "Resume" for a paused one, wiring onTogglePause', () => {
  const active = { id: 'a1', name: 'A', channelUrl: 'https://www.youtube.com/@a', paused: false };
  const toggleCalls = [];
  const activeRow = createSubscriptionRow(active, fakeDoc, { onTogglePause: (s) => toggleCalls.push(s) });
  const activeBtn = [...activeRow.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Pause');
  assert.ok(activeBtn, 'an active subscription must show a Pause button');
  activeBtn.click();
  assert.deepStrictEqual(toggleCalls, [active]);

  const paused = { id: 'p1', name: 'P', channelUrl: 'https://www.youtube.com/@p', paused: true };
  const pausedRow = createSubscriptionRow(paused, fakeDoc, {});
  const resumeBtn = [...pausedRow.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Resume');
  assert.ok(resumeBtn, 'a paused subscription must show a Resume button');
});

test('createSubscriptionRow: the inline edit form starts hidden and Save collects format/quality/maxVideos into a patch', () => {
  const sub = {
    id: 'e1',
    name: 'Editable Channel',
    channelUrl: 'https://www.youtube.com/@editable',
    format: 'video',
    quality: '720p',
    maxVideos: 5,
  };
  const saveCalls = [];
  const row = createSubscriptionRow(sub, fakeDoc, { onSaveEdit: (id, patch) => saveCalls.push([id, patch]) });

  const editPanel = row.children.find((el) => el.className === 'sub-edit-panel');
  assert.ok(editPanel, 'an edit panel must exist');
  assert.strictEqual(editPanel.hidden, true, 'the edit panel must start hidden');

  const saveBtn = [...editPanel.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Save');
  assert.ok(saveBtn, 'a Save button must exist inside the edit panel');
  saveBtn.click();

  assert.strictEqual(saveCalls.length, 1);
  const [id, patch] = saveCalls[0];
  assert.strictEqual(id, 'e1');
  assert.strictEqual(patch.format, 'video');
  assert.strictEqual(patch.quality, '720p');
  assert.strictEqual(patch.maxVideos, 5);
});

test('createSubscriptionRow: Edit toggles the panel visible, and Cancel hides it again', () => {
  const sub = { id: 'e2', name: 'C', channelUrl: 'https://www.youtube.com/@c' };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const editPanel = row.children.find((el) => el.className === 'sub-edit-panel');
  const editBtn = [...row.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Edit');

  editBtn.click();
  assert.strictEqual(editPanel.hidden, false, 'clicking Edit must reveal the panel');

  const cancelBtn = [...editPanel.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Cancel');
  cancelBtn.click();
  assert.strictEqual(editPanel.hidden, true, 'clicking Cancel must hide the panel again');
});

test('createSubscriptionRow: a live downloading status overrides the persisted lastStatus line', () => {
  const sub = {
    id: 'l1',
    name: 'Live Channel',
    channelUrl: 'https://www.youtube.com/@live',
    lastStatus: 'ok: downloaded 1 new video(s)',
    lastCheckedAt: '2026-07-05T00:00:00.000Z',
  };
  const liveEntry = { state: 'downloading', title: 'Ep 1', index: 1, total: 3, percent: 10 };
  const row = createSubscriptionRow(sub, fakeDoc, {}, liveEntry);
  const texts = [...row.walk()].map((el) => el.textContent);
  assert.ok(texts.some((t) => t.includes('Ep 1 — 1 of 3 — 10%')), 'the live status must be shown instead of lastStatus');
  assert.ok(!texts.some((t) => t.includes('ok: downloaded 1 new video(s)')), 'the persisted status must not also render');
});

test('createSubscriptionsListElement: renders an empty-state message when there are no subscriptions', () => {
  const container = createSubscriptionsListElement([], fakeDoc, {});
  const texts = [...container.walk()].map((el) => el.textContent).filter(Boolean);
  assert.ok(texts.some((t) => t.includes('No subscriptions yet')));
});

test('createSubscriptionsListElement: renders one row per subscription', () => {
  const subs = [
    { id: '1', name: 'Channel A', channelUrl: 'https://www.youtube.com/@a' },
    { id: '2', name: 'Channel B', channelUrl: 'https://www.youtube.com/@b' },
  ];
  const container = createSubscriptionsListElement(subs, fakeDoc, {});
  assert.strictEqual(container.children.length, 2);
});

// ---- SECURITY (T5 mandatory regression test): a hostile subscription name --

test('createSubscriptionRow: a hostile subscription name is rendered as inert TEXT, never interpreted as markup (XSS regression)', () => {
  const hostileName = '<script>window.__xss = true;</script><img src=x onerror="window.__xss2 = true">';
  const sub = {
    id: 'evil-1',
    name: hostileName,
    channelUrl: 'https://www.youtube.com/@evil',
    format: 'video',
    quality: 'best',
    lastCheckedAt: null,
    lastStatus: null,
  };

  // Must not throw -- if the implementation ever assigned `innerHTML` with
  // this string, the fake's innerHTML setter above would throw and fail this
  // test loudly.
  const row = createSubscriptionRow(sub, fakeDoc, {});

  const allNodes = [...row.walk()];

  // The hostile string must appear EXACTLY as given, as plain text content of
  // some element -- proving it was assigned via textContent (which never
  // parses its input), not silently dropped or double-escaped.
  const nameNode = allNodes.find((el) => el.textContent === hostileName);
  assert.ok(nameNode, 'the hostile name must be present verbatim as textContent somewhere in the row');

  // No <script> or <img> element must ever exist in the built row -- if the
  // implementation had used innerHTML with this string, a real browser (or
  // any HTML parser) would have created exactly those elements from it. The
  // row (including its inline edit panel) only ever calls `createElement`
  // with a fixed, known set of tags -- these are the ONLY tag names that can
  // legitimately appear.
  const tagNames = new Set(allNodes.map((el) => el.tagName));
  assert.ok(!tagNames.has('SCRIPT'), 'no <script> element must ever be created from subscription data');
  assert.ok(!tagNames.has('IMG'), 'no <img> element must ever be created from subscription data');
  for (const tag of tagNames) {
    assert.ok(['DIV', 'BUTTON', 'SELECT', 'OPTION', 'INPUT'].includes(tag), `unexpected element tag created from row data: ${tag}`);
  }
});

test('createSubscriptionRow: a hostile lastStatus (composed error text) is also rendered as inert text', () => {
  const hostileStatus = 'error: <img src=x onerror=alert(1)>';
  const sub = {
    id: 'evil-2',
    name: 'Channel',
    channelUrl: 'https://www.youtube.com/@c',
    format: 'video',
    quality: 'best',
    lastCheckedAt: '2026-07-05T00:00:00.000Z',
    lastStatus: hostileStatus,
  };

  const row = createSubscriptionRow(sub, fakeDoc, {});
  const allNodes = [...row.walk()];
  const statusNode = allNodes.find((el) => el.textContent.endsWith(hostileStatus));
  assert.ok(statusNode, 'the hostile status text must be present verbatim as textContent');
  const tagNames = new Set(allNodes.map((el) => el.tagName));
  assert.ok(!tagNames.has('IMG'), 'no <img> element must ever be created from a status string');
});

test('createSubscriptionRow: a hostile LIVE error status (FR-E) is also rendered as inert text, never innerHTML', () => {
  const hostileLiveError = 'error: <img src=x onerror=alert(1)>';
  const sub = { id: 'evil-3', name: 'Channel', channelUrl: 'https://www.youtube.com/@c' };
  const liveEntry = { state: 'error', error: hostileLiveError };

  // Must not throw (the fake's innerHTML setter would throw if it were ever
  // assigned) -- proves formatLiveStatusText's output reaches the DOM only
  // via textContent.
  const row = createSubscriptionRow(sub, fakeDoc, {}, liveEntry);
  const allNodes = [...row.walk()];
  const statusNode = allNodes.find((el) => el.textContent === hostileLiveError);
  assert.ok(statusNode, 'the hostile live error text must be present verbatim as textContent');
  const tagNames = new Set(allNodes.map((el) => el.tagName));
  assert.ok(!tagNames.has('IMG'), 'no <img> element must ever be created from a live error string');
});

// ---- FR-A/FR-E: one-shot job rows -------------------------------------------

test('createOneShotRow: renders label/url/status and wires the dismiss handler', () => {
  const entry = {
    state: 'downloading',
    label: 'One-Off',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    index: 1,
    total: 1,
    percent: 33,
  };
  const dismissCalls = [];
  const row = createOneShotRow('job-1', entry, fakeDoc, { onDismiss: (id) => dismissCalls.push(id) });

  const texts = [...row.walk()].map((el) => el.textContent).filter(Boolean);
  assert.ok(texts.includes('One-Off'));
  assert.ok(texts.includes('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  assert.ok(texts.some((t) => t.includes('33%')));

  const dismissBtn = [...row.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === '×');
  assert.ok(dismissBtn, 'a dismiss button must exist');
  dismissBtn.click();
  assert.deepStrictEqual(dismissCalls, ['job-1']);
});

test('createOneShotRow: a hostile label/url is rendered as inert TEXT, never innerHTML (XSS regression)', () => {
  const hostileLabel = '<script>window.__xss3 = true;</script>';
  const entry = { state: 'queued', label: hostileLabel, url: '<img src=x onerror=alert(1)>' };

  const row = createOneShotRow('job-evil', entry, fakeDoc, {});
  const allNodes = [...row.walk()];
  assert.ok(allNodes.some((el) => el.textContent === hostileLabel));
  assert.ok(allNodes.some((el) => el.textContent === entry.url));
  const tagNames = new Set(allNodes.map((el) => el.tagName));
  assert.ok(!tagNames.has('SCRIPT'));
  assert.ok(!tagNames.has('IMG'));
});

test('createOneShotsListElement: renders an empty-state message when there are no one-shot jobs', () => {
  const container = createOneShotsListElement({}, fakeDoc, {});
  const texts = [...container.walk()].map((el) => el.textContent).filter(Boolean);
  assert.ok(texts.some((t) => t.includes('No one-off downloads')));
});

test('createOneShotsListElement: renders one row per job entry', () => {
  const oneShots = {
    'job-1': { state: 'downloading', label: 'One-Off', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    'job-2': { state: 'done', label: 'One-Off', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' },
  };
  const container = createOneShotsListElement(oneShots, fakeDoc, {});
  assert.strictEqual(container.children.length, 2);
});
