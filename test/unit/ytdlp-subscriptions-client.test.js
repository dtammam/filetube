'use strict';

// [UNIT] lib/ytdlp/client/subscriptions.js -- the vanilla per-page controller
// for the optional yt-dlp /subscriptions page (T5, v1.21.0 T3). Requiring
// this file in Node is inert (its DOMContentLoaded wiring is guarded on
// `typeof document`, mirroring public/js/common.js), so its pure formatting
// helpers and its DOM-construction functions (`createSubscriptionRow`,
// `buildSettingsSheet`) can be exercised directly here.
//
// This codebase has no jsdom/browser-DOM test harness (public/js/main.js and
// watch.js have no DOM-level tests either) -- so this file supplies a
// PURPOSE-BUILT, minimal fake `document`/`Element` (test-only, not a new
// runtime dependency) sufficient to exercise `createSubscriptionRow`'s/
// `buildSettingsSheet`'s real construction paths. Its `innerHTML` setter
// unconditionally THROWS: if any future edit to subscriptions.js ever used
// `innerHTML` to render a subscription's `name`/`channelUrl`/status, this
// test would fail loudly rather than silently passing -- a stronger
// regression guard than merely asserting equality on the output.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  FORMAT_OPTIONS,
  QUALITY_OPTIONS,
  DEFAULT_QUALITY_OPTION,
  FILETYPE_OPTIONS,
  DEFAULT_FILETYPE_OPTION,
  STATUS_POLL_BASE_MS,
  STATUS_POLL_MAX_MS,
  STATUS_POLL_FAST_MS,
  ACTIVE_ENTRY_STALE_MS,
  isFreshlyActiveEntry,
  snapshotHasActiveDownload,
  nextPollDelay,
  formatSubMeta,
  formatSubStatus,
  formatSubscribedDate,
  cutoffDateToInputValue,
  inputValueToCutoffDate,
  formatLiveStatusText,
  formatNextCheckText,
  formatRowStatusLine,
  buildFailureLines,
  formatFailuresLine,
  pinLabelFallback,
  resolvePinLabel,
  buildFormatSelect,
  buildQualitySelect,
  buildFiletypeSelect,
  reduceFiletypeOptions,
  createSubscriptionRow,
  buildSettingsSheet,
  applyStatusUpdatesInPlace,
  createSubscriptionsListElement,
  createOneShotRow,
  createOneShotsListElement,
  // v1.26 code-review fix (F7): the one-shot list's cheap render-skip
  // signature + the container update it gates.
  computeOneShotsSignature,
  updateOneShotsContainer,
  // v1.25 QoL follow-up ("reheat"): metadata+subtitle re-pull UI.
  REHEAT_ACTIVITY_ID,
  formatReheatSummary,
  formatReheatProgressText,
  applyReheatStateToControls,
  triggerReheat,
  triggerReheatCancel,
  // v1.25.5 QoL follow-up (channel avatars, round 2): "Refresh avatars" UI +
  // the real-avatar-vs-letter precedence helper.
  REFRESH_AVATARS_ACTIVITY_ID,
  formatRefreshAvatarsSummary,
  formatRefreshAvatarsProgressText,
  applyRefreshAvatarsStateToControls,
  triggerRefreshAvatars,
  triggerRefreshAvatarsCancel,
  hasRealChannelAvatar,
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
    if (child instanceof FakeElement) child.parentNode = this;
    return child;
  }

  // v1.26 code-review fix (F7) test support: `clearChildren`'s
  // `while (el.firstChild) el.removeChild(el.firstChild)` loop needs both of
  // these -- mirrors the equivalent primitives already added to this file's
  // sibling fake-DOM harnesses (ytdlp-oneoff-modal.test.js).
  get firstChild() {
    return this.children.length > 0 ? this.children[0] : null;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    return child;
  }

  // v1.21 FIX 2 test support: a minimal `closest(tagName)` -- walks up
  // `parentNode` (set by `appendChild` above), including this element
  // itself, and matches purely on tag name (uppercased, mirroring real DOM
  // tag-name comparisons). Sufficient for the row-click-guard tests below
  // (`event.target.closest('a')`); this fake never implements full CSS
  // selector matching.
  closest(tagName) {
    const wanted = String(tagName).toUpperCase();
    let node = this;
    while (node) {
      if (node.tagName === wanted) return node;
      node = node.parentNode || null;
    }
    return null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, handler) {
    (this._listeners[type] = this._listeners[type] || []).push(handler);
  }

  // Simulates a click by invoking every registered 'click' listener,
  // optionally passing a fake event object (so a handler that calls
  // `event.stopPropagation()` doesn't throw) -- lets a test prove a button's
  // handler actually fires with the right args, without a real browser event
  // loop or event bubbling.
  click(fakeEvent) {
    (this._listeners.click || []).forEach((fn) => fn(fakeEvent));
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

test('formatSubMeta: defaults to Video / best, omits the cutoff-date segment when cutoffDate is absent', () => {
  assert.strictEqual(formatSubMeta({}), 'Video · quality: best');
});

test('formatSubMeta: reflects audio format, a custom quality, and the cutoff date', () => {
  assert.strictEqual(
    formatSubMeta({ format: 'audio', quality: '720p', cutoffDate: '20260102' }),
    'Audio · quality: 720p · Downloads since 2026-01-02'
  );
});

test('formatSubMeta: a blank cutoffDate renders gracefully -- no "undefined"/"NaN" in the output', () => {
  const result = formatSubMeta({ cutoffDate: '' });
  assert.strictEqual(result, 'Video · quality: best');
  assert.ok(!result.includes('undefined'));
  assert.ok(!result.includes('NaN'));
});

test('formatSubMeta: a malformed cutoffDate is dropped, not rendered as garbage', () => {
  const result = formatSubMeta({ cutoffDate: 'not-a-date' });
  assert.strictEqual(result, 'Video · quality: best');
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

// ---- v1.21.0 FR-4 (AC28/AC29): formatSubscribedDate -------------------------

test('formatSubscribedDate: a valid ISO timestamp renders a "Subscribed on <date>" string', () => {
  const result = formatSubscribedDate('2026-07-05T12:00:00.000Z');
  assert.ok(result.startsWith('Subscribed on '), `expected a "Subscribed on " prefix, got: ${result}`);
  assert.notStrictEqual(result, 'Subscribed on date unknown');
});

test('formatSubscribedDate: missing/undefined/null/blank addedAt degrades to "date unknown" (never fabricated, never crashes)', () => {
  assert.strictEqual(formatSubscribedDate(undefined), 'date unknown');
  assert.strictEqual(formatSubscribedDate(null), 'date unknown');
  assert.strictEqual(formatSubscribedDate(''), 'date unknown');
  assert.strictEqual(formatSubscribedDate('   '), 'date unknown');
});

test('formatSubscribedDate: a garbage/unparseable string degrades to "date unknown" (e.g. a hand-edited/corrupted db.json)', () => {
  assert.strictEqual(formatSubscribedDate('not-a-date'), 'date unknown');
  assert.strictEqual(formatSubscribedDate('2026-13-99'), 'date unknown');
});

test('formatSubscribedDate: a non-string input (wrong type entirely) degrades to "date unknown" rather than throwing', () => {
  assert.strictEqual(formatSubscribedDate(12345), 'date unknown');
  assert.strictEqual(formatSubscribedDate({}), 'date unknown');
  assert.strictEqual(formatSubscribedDate([]), 'date unknown');
});

// ---- v1.25 QoL (T5): cutoffDate <-> <input type="date"> conversions -------

test('cutoffDateToInputValue: converts a well-formed YYYYMMDD to YYYY-MM-DD', () => {
  assert.strictEqual(cutoffDateToInputValue('20260709'), '2026-07-09');
});

test('cutoffDateToInputValue: empty/malformed/non-string input converts to \'\' (never throws)', () => {
  assert.strictEqual(cutoffDateToInputValue(''), '');
  assert.strictEqual(cutoffDateToInputValue(undefined), '');
  assert.strictEqual(cutoffDateToInputValue(null), '');
  assert.strictEqual(cutoffDateToInputValue('2026-07-09'), ''); // already the OTHER shape
  assert.strictEqual(cutoffDateToInputValue('not-a-date'), '');
  assert.strictEqual(cutoffDateToInputValue(20260709), ''); // wrong type (number, not string)
});

test('cutoffDateToInputValue: an implausible month/day (e.g. month 13) converts to \'\' rather than a garbage date', () => {
  assert.strictEqual(cutoffDateToInputValue('20261301'), '');
  assert.strictEqual(cutoffDateToInputValue('20260732'), '');
});

test('inputValueToCutoffDate: converts a well-formed YYYY-MM-DD to YYYYMMDD', () => {
  assert.strictEqual(inputValueToCutoffDate('2026-07-09'), '20260709');
});

test('inputValueToCutoffDate: empty/malformed/non-string input converts to undefined (never a garbage string)', () => {
  assert.strictEqual(inputValueToCutoffDate(''), undefined);
  assert.strictEqual(inputValueToCutoffDate('   '), undefined);
  assert.strictEqual(inputValueToCutoffDate(undefined), undefined);
  assert.strictEqual(inputValueToCutoffDate(null), undefined);
  assert.strictEqual(inputValueToCutoffDate('20260709'), undefined); // already the OTHER shape
});

test('inputValueToCutoffDate: an implausible month/day converts to undefined', () => {
  assert.strictEqual(inputValueToCutoffDate('2026-13-01'), undefined);
  assert.strictEqual(inputValueToCutoffDate('2026-07-32'), undefined);
});

test('cutoffDateToInputValue/inputValueToCutoffDate: round-trip every valid date unchanged', () => {
  assert.strictEqual(inputValueToCutoffDate(cutoffDateToInputValue('20250101')), '20250101');
  assert.strictEqual(cutoffDateToInputValue(inputValueToCutoffDate('2025-12-31')), '2025-12-31');
});

// ---- v1.21 FIX 4: pinLabelFallback / resolvePinLabel -------------------------

test('pinLabelFallback: returns the final path segment of a POSIX channelDir', () => {
  assert.strictEqual(pinLabelFallback('/data/ytdlp-downloads/Some Channel'), 'Some Channel');
});

test('pinLabelFallback: strips trailing slashes before taking the basename', () => {
  assert.strictEqual(pinLabelFallback('/data/ytdlp-downloads/Some Channel/'), 'Some Channel');
  assert.strictEqual(pinLabelFallback('/data/ytdlp-downloads/Some Channel///'), 'Some Channel');
});

test('pinLabelFallback: also handles a backslash-separated (Windows-style) channelDir', () => {
  assert.strictEqual(pinLabelFallback('C:\\data\\ytdlp-downloads\\Some Channel'), 'Some Channel');
});

test('pinLabelFallback: a non-string/empty input degrades to "" rather than throwing', () => {
  assert.strictEqual(pinLabelFallback(undefined), '');
  assert.strictEqual(pinLabelFallback(null), '');
  assert.strictEqual(pinLabelFallback(42), '');
  assert.strictEqual(pinLabelFallback(''), '');
});

test('resolvePinLabel: prefers a non-empty, trimmed sub.name over the channelDir fallback', () => {
  assert.strictEqual(
    resolvePinLabel({ name: '  My Channel  ', channelDir: '/data/ytdlp-downloads/other-dir' }),
    'My Channel'
  );
});

test('resolvePinLabel: falls back to the channelDir basename when name is missing/blank/whitespace-only', () => {
  assert.strictEqual(resolvePinLabel({ name: '', channelDir: '/data/ytdlp-downloads/Unnamed Channel' }), 'Unnamed Channel');
  assert.strictEqual(resolvePinLabel({ name: '   ', channelDir: '/data/ytdlp-downloads/Unnamed Channel' }), 'Unnamed Channel');
  assert.strictEqual(resolvePinLabel({ channelDir: '/data/ytdlp-downloads/Unnamed Channel' }), 'Unnamed Channel');
});

test('resolvePinLabel: never returns an empty string, even when both name and channelDir basename are unusable', () => {
  assert.strictEqual(resolvePinLabel({ name: '', channelDir: '/' }), 'Untitled channel');
  assert.strictEqual(resolvePinLabel({}), 'Untitled channel');
  assert.strictEqual(resolvePinLabel(null), 'Untitled channel');
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

// ---- v1.13.0 item 4: filetype/container dropdown ----------------------------

test('FILETYPE_OPTIONS: video offers exactly mp4/mkv/webm/default (mirrors args.js VALID_FILETYPES.video), mp4 first', () => {
  assert.deepStrictEqual(FILETYPE_OPTIONS.video.map((o) => o.value), ['mp4', 'mkv', 'webm', 'default']);
});

test('FILETYPE_OPTIONS: audio offers exactly mp3/m4a/opus/default (mirrors args.js VALID_FILETYPES.audio), mp3 first', () => {
  assert.deepStrictEqual(FILETYPE_OPTIONS.audio.map((o) => o.value), ['mp3', 'm4a', 'opus', 'default']);
});

test('DEFAULT_FILETYPE_OPTION: mp4 for video, mp3 for audio (best-compatibility recommended defaults)', () => {
  assert.deepStrictEqual(DEFAULT_FILETYPE_OPTION, { video: 'mp4', audio: 'mp3' });
});

test('buildFiletypeSelect: video format builds the video option set and defaults to mp4 when unset', () => {
  const select = buildFiletypeSelect(fakeDoc, 'video', undefined);
  assert.deepStrictEqual(select.children.map((o) => o.value), ['mp4', 'mkv', 'webm', 'default']);
  assert.strictEqual(select.value, 'mp4');
});

test('buildFiletypeSelect: audio format builds the audio option set and respects an explicit selection', () => {
  const select = buildFiletypeSelect(fakeDoc, 'audio', 'opus');
  assert.deepStrictEqual(select.children.map((o) => o.value), ['mp3', 'm4a', 'opus', 'default']);
  assert.strictEqual(select.value, 'opus');
});

test('buildFiletypeSelect: an unrecognized format falls back to the video option set (safe default)', () => {
  const select = buildFiletypeSelect(fakeDoc, 'not-a-format', undefined);
  assert.deepStrictEqual(select.children.map((o) => o.value), ['mp4', 'mkv', 'webm', 'default']);
});

test('reduceFiletypeOptions: video format returns the video options with mp4 selected when there was no prior value', () => {
  const result = reduceFiletypeOptions('video', undefined);
  assert.strictEqual(result.format, 'video');
  assert.deepStrictEqual(result.options.map((o) => o.value), ['mp4', 'mkv', 'webm', 'default']);
  assert.strictEqual(result.selected, 'mp4');
});

test('reduceFiletypeOptions: a prior value that is still valid for the (unchanged) format survives', () => {
  const result = reduceFiletypeOptions('audio', 'opus');
  assert.strictEqual(result.selected, 'opus');
});

test('reduceFiletypeOptions: "default" survives a format switch (it is a member of both allowlists)', () => {
  const result = reduceFiletypeOptions('audio', 'default');
  assert.strictEqual(result.selected, 'default');
});

test('reduceFiletypeOptions: switching format invalidates a prior value that only applied to the OLD format, falling back to the new format\'s recommended default', () => {
  // Was on 'video' with 'webm' selected; the user switches the format select
  // to 'audio' -- 'webm' is not a member of FILETYPE_OPTIONS.audio, so it
  // must fall back to the audio default ('mp3'), never silently keep 'webm'.
  const result = reduceFiletypeOptions('audio', 'webm');
  assert.strictEqual(result.format, 'audio');
  assert.deepStrictEqual(result.options.map((o) => o.value), ['mp3', 'm4a', 'opus', 'default']);
  assert.strictEqual(result.selected, 'mp3');
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

// ---- v1.26 "real progress": phase-aware rendering --------------------------

test('formatLiveStatusText: a "merging" phase renders "Merging…", even with a stale 100% percent', () => {
  const result = formatLiveStatusText({ state: 'downloading', phase: 'merging', percent: 100, title: 'Some Title' });
  assert.strictEqual(result, 'Merging…');
});

test('formatLiveStatusText: a "converting" phase renders "Converting…" and keeps N of M indexing when present', () => {
  const result = formatLiveStatusText({ state: 'downloading', phase: 'converting', percent: 100, index: 3, total: 12 });
  assert.strictEqual(result, 'Converting… — 3 of 12');
});

test('formatLiveStatusText: an unrecognized phase value is ignored, falling through to the normal title/percent logic', () => {
  const result = formatLiveStatusText({ state: 'downloading', phase: 'some-future-phase', percent: 47 });
  assert.strictEqual(result, 'Downloading — 47%');
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

// ---- A4 (v1.24.0, T6): poll-timing display ---------------------------------

test('formatNextCheckText: null/non-finite nextPollDue yields null (no estimate available)', () => {
  assert.strictEqual(formatNextCheckText(null), null);
  assert.strictEqual(formatNextCheckText(undefined), null);
  assert.strictEqual(formatNextCheckText(NaN), null);
  assert.strictEqual(formatNextCheckText('not-a-number'), null);
});

test('formatNextCheckText: a due-in-the-future timestamp renders minutes', () => {
  const text = formatNextCheckText(Date.now() + 42 * 60000);
  assert.match(text, /^Next check: in 4[12] min$/); // tolerate a ms of test-run jitter
});

test('formatNextCheckText: exactly 1 minute out uses singular "min"', () => {
  const text = formatNextCheckText(Date.now() + 60000);
  assert.ok(text === 'Next check: in 1 min' || text === 'Next check: due now');
});

test('formatNextCheckText: a due time in the past (or right now) renders "due now"', () => {
  assert.strictEqual(formatNextCheckText(Date.now() - 5000), 'Next check: due now');
  assert.strictEqual(formatNextCheckText(Date.now()), 'Next check: due now');
});

test('formatNextCheckText: over an hour out rounds to hours (plural)', () => {
  assert.strictEqual(formatNextCheckText(Date.now() + 130 * 60000), 'Next check: in 2 hrs');
});

test('formatNextCheckText: exactly 1 hour out uses singular "hr"', () => {
  assert.strictEqual(formatNextCheckText(Date.now() + 61 * 60000), 'Next check: in 1 hr');
});

test('formatRowStatusLine: an active live status (e.g. downloading) wins outright, no next-check suffix appended', () => {
  const sub = { lastCheckedAt: '2026-07-05T00:00:00.000Z', lastStatus: 'ok' };
  const liveEntry = { state: 'downloading', title: 'Ep 1', percent: 40, nextPollDue: Date.now() + 60000 };
  const text = formatRowStatusLine(sub, liveEntry);
  assert.ok(text.includes('Ep 1'));
  assert.ok(!text.includes('Next check'), 'an active state must never show a redundant next-check suffix');
});

test('formatRowStatusLine: idle with a nextPollDue estimate appends the suffix to the persisted status line', () => {
  const sub = { lastCheckedAt: '2026-07-05T00:00:00.000Z', lastStatus: 'ok: downloaded 1 new video(s)' };
  const liveEntry = { state: 'idle', nextPollDue: Date.now() + 30 * 60000 };
  const text = formatRowStatusLine(sub, liveEntry);
  assert.ok(text.startsWith('Last checked: '));
  assert.ok(text.includes('ok: downloaded 1 new video(s)'));
  assert.ok(text.includes('Next check: in 30 min'), text);
});

test('formatRowStatusLine: no live entry at all (never polled this session) omits the suffix entirely', () => {
  const sub = { lastCheckedAt: null, lastStatus: null };
  assert.strictEqual(formatRowStatusLine(sub, undefined), 'Last checked: never checked — pending');
});

test('formatRowStatusLine: manual-only polling (nextPollDue null) omits the suffix entirely', () => {
  const sub = { lastCheckedAt: '2026-07-05T00:00:00.000Z', lastStatus: 'ok' };
  const liveEntry = { state: 'idle', nextPollDue: null };
  const text = formatRowStatusLine(sub, liveEntry);
  assert.ok(!text.includes('Next check'));
});

// ---- v1.24.0 A2 (T14): buildFailureLines / formatFailuresLine --------------

test('buildFailureLines: an attributed failure with a title renders "title: reason"', () => {
  const entry = { state: 'error', failures: [{ videoId: 'vid1', title: 'My Video', reason: 'Video unavailable' }] };
  assert.deepEqual(buildFailureLines(entry), ['My Video: Video unavailable']);
});

test('buildFailureLines: an attributed failure with no title falls back to videoId; an unattributed failure falls back to "Unknown video"', () => {
  const entry = {
    state: 'error',
    failures: [
      { videoId: 'vid1', reason: 'Video unavailable' },
      { videoId: null, reason: 'Some unattributable error' },
    ],
  };
  assert.deepEqual(buildFailureLines(entry), [
    'vid1: Video unavailable',
    'Unknown video: Some unattributable error',
  ]);
});

test('buildFailureLines: stale failures on a NON-error state (e.g. a subsequent successful cycle) never render -- the state gate, not a cleared field, is what hides them', () => {
  const entry = { state: 'done', failures: [{ videoId: 'vid1', reason: 'a stale reason from a prior failed cycle' }] };
  assert.deepEqual(buildFailureLines(entry), []);
  assert.deepEqual(buildFailureLines({ state: 'downloading', failures: entry.failures }), []);
});

test('buildFailureLines: a missing/malformed entry or failures array degrades to [] -- never throws', () => {
  assert.deepEqual(buildFailureLines(null), []);
  assert.deepEqual(buildFailureLines(undefined), []);
  assert.deepEqual(buildFailureLines({ state: 'error' }), []);
  assert.deepEqual(buildFailureLines({ state: 'error', failures: 'not-an-array' }), []);
});

test('formatFailuresLine: joins multiple failure lines with " | "', () => {
  const entry = {
    state: 'error',
    failures: [
      { videoId: 'vid1', title: 'First', reason: 'reason A' },
      { videoId: 'vid2', title: 'Second', reason: 'reason B' },
    ],
  };
  assert.strictEqual(formatFailuresLine(entry), 'First: reason A | Second: reason B');
});

test('formatFailuresLine: returns "" (empty string) when there is nothing to show', () => {
  assert.strictEqual(formatFailuresLine(undefined), '');
  assert.strictEqual(formatFailuresLine({ state: 'downloading' }), '');
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

// v1.26 "real progress": adaptive fast poll while a download is active.

test('nextPollDelay: success + isActive resets to the fast ~700ms cadence', () => {
  assert.strictEqual(nextPollDelay(20000, true, true), STATUS_POLL_FAST_MS);
  assert.strictEqual(STATUS_POLL_FAST_MS, 700);
});

test('nextPollDelay: success + no isActive (or isActive omitted) keeps the pre-existing base-cadence behavior', () => {
  assert.strictEqual(nextPollDelay(20000, true, false), STATUS_POLL_BASE_MS);
  assert.strictEqual(nextPollDelay(20000, true), STATUS_POLL_BASE_MS, 'omitting isActive must behave exactly like the pre-v1.26 two-arg call');
});

test('nextPollDelay: a FAILURE still backs off exactly as before, regardless of isActive', () => {
  assert.strictEqual(nextPollDelay(STATUS_POLL_BASE_MS, false, true), STATUS_POLL_BASE_MS * 2);
});

test('snapshotHasActiveDownload: true when any subscription OR one-shot entry is genuinely and RECENTLY "downloading"', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  const fresh = new Date(nowMs - 1000).toISOString();
  assert.strictEqual(snapshotHasActiveDownload({ subscriptions: { s1: { state: 'downloading', updatedAt: fresh } }, oneShots: {} }, nowMs), true);
  assert.strictEqual(snapshotHasActiveDownload({ subscriptions: {}, oneShots: { j1: { state: 'downloading', updatedAt: fresh } } }, nowMs), true);
});

test('snapshotHasActiveDownload: false when nothing is downloading, and never throws for an empty/malformed/absent snapshot', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  const fresh = new Date(nowMs - 1000).toISOString();
  assert.strictEqual(snapshotHasActiveDownload({ subscriptions: { s1: { state: 'queued', updatedAt: fresh } }, oneShots: { j1: { state: 'done', updatedAt: fresh } } }, nowMs), false);
  assert.strictEqual(snapshotHasActiveDownload({ subscriptions: {}, oneShots: {} }, nowMs), false);
  assert.doesNotThrow(() => snapshotHasActiveDownload(null));
  assert.strictEqual(snapshotHasActiveDownload(null), false);
  assert.strictEqual(snapshotHasActiveDownload(undefined), false);
});

// ---- v1.26 code-review fix (F4): staleness gate ----------------------------

test('snapshotHasActiveDownload: F4 -- a "downloading" entry with a STALE updatedAt (a wedged download) is not active', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  const stale = new Date(nowMs - 20000).toISOString();
  assert.strictEqual(snapshotHasActiveDownload({ subscriptions: { s1: { state: 'downloading', updatedAt: stale } }, oneShots: {} }, nowMs), false);
});

test('isFreshlyActiveEntry: fresh -> true, stale -> false, missing updatedAt -> false (never throws)', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  assert.strictEqual(ACTIVE_ENTRY_STALE_MS, 10000);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading', updatedAt: new Date(nowMs - 1).toISOString() }, nowMs), true);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading', updatedAt: new Date(nowMs - 15000).toISOString() }, nowMs), false);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading' }, nowMs), false);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading', updatedAt: 'not-a-date' }, nowMs), false);
  assert.doesNotThrow(() => isFreshlyActiveEntry(undefined, nowMs));
});

// ---- v1.26 code-review fix (F5): failure backoff floors at BASE cadence ---

test('nextPollDelay: F5 -- a failure right after a fast (~700ms) success backs off from the BASE cadence, not from 700ms', () => {
  // Pre-fix, this would have doubled the raw 700ms fast-cadence value to
  // 1400ms -- a FASTER retry than the backoff's own original first retry
  // ever was (STATUS_POLL_BASE_MS * 2 = 5000ms).
  assert.strictEqual(
    nextPollDelay(STATUS_POLL_FAST_MS, false),
    STATUS_POLL_BASE_MS * 2,
    'a failure must never retry faster than doubling the BASE cadence, even if the previous delay was the fast 700ms tick',
  );
});

// ---- v1.21.0 FR-3 (T3): DOM construction -- new row anatomy ----------------

test('createSubscriptionRow: builds the new anatomy -- avatar + name + one muted meta line + channel link + a single trailing kebab', () => {
  const sub = {
    id: 'abc123',
    name: 'My Channel',
    channelUrl: 'https://www.youtube.com/@mychannel',
    format: 'video',
    quality: 'best',
    lastCheckedAt: null,
    lastStatus: null,
  };
  const row = createSubscriptionRow(sub, fakeDoc, {});

  assert.strictEqual(row.className, 'sub-row');
  // AC19: exactly avatar + info + kebab as direct children.
  assert.deepStrictEqual(row.children.map((el) => el.className), ['sub-row-avatar', 'sub-row-info', 'sub-row-kebab']);

  const avatar = row.children[0];
  assert.strictEqual(avatar.textContent, 'M', 'the avatar shows the first letter of the name, uppercased');

  const texts = [...row.walk()].map((el) => el.textContent).filter(Boolean);
  assert.ok(texts.includes('My Channel'));
  assert.ok(texts.some((t) => t.includes('Video')), 'the meta line must include the formatSubMeta fragment');

  const kebab = row.children[2];
  assert.strictEqual(kebab.tagName, 'BUTTON');
  assert.strictEqual(kebab.className, 'sub-row-kebab');

  // The old inline Pause/Edit/Re-pull/Delete cluster and edit panel are
  // entirely gone -- there is exactly ONE button in the whole row (the
  // kebab), not six.
  const buttons = [...row.walk()].filter((el) => el.tagName === 'BUTTON');
  assert.strictEqual(buttons.length, 1, 'expected only the single trailing kebab button');
});

test('createSubscriptionRow: avatar falls back to "?" for a missing/blank channel name', () => {
  const row = createSubscriptionRow({ id: 'av2', name: '', channelUrl: 'https://www.youtube.com/@blank' }, fakeDoc, {});
  assert.strictEqual(row.children[0].textContent, '?');
});

// ---- v1.25.5 QoL follow-up (channel avatars, round 2): real-avatar render -

test('hasRealChannelAvatar: true for a non-blank string, false for missing/blank/non-string', () => {
  assert.strictEqual(hasRealChannelAvatar('https://example.com/avatar.jpg'), true);
  assert.strictEqual(hasRealChannelAvatar('  https://example.com/avatar.jpg  '), true);
  assert.strictEqual(hasRealChannelAvatar(''), false);
  assert.strictEqual(hasRealChannelAvatar('   '), false);
  assert.strictEqual(hasRealChannelAvatar(undefined), false);
  assert.strictEqual(hasRealChannelAvatar(null), false);
  assert.strictEqual(hasRealChannelAvatar(42), false);
});

test('createSubscriptionRow: renders a real <img> avatar (DOM-only, alt="") inside .sub-row-avatar when channelAvatarUrl is present', () => {
  const sub = {
    id: 'av3',
    name: 'Real Avatar Channel',
    channelUrl: 'https://www.youtube.com/@realavatar',
    channelAvatarUrl: 'https://example.com/avatar.jpg',
  };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const avatar = row.children[0];
  assert.strictEqual(avatar.className, 'sub-row-avatar', 'the container itself is unchanged');
  assert.strictEqual(avatar.textContent, '', 'no letter fallback text when a real avatar renders');
  assert.strictEqual(avatar.children.length, 1);
  const img = avatar.children[0];
  assert.strictEqual(img.tagName, 'IMG');
  assert.strictEqual(img.alt, '');
  assert.strictEqual(img.src, 'https://example.com/avatar.jpg');
});

test('createSubscriptionRow: falls back to the letter avatar when channelAvatarUrl is absent/blank', () => {
  const withoutField = createSubscriptionRow({ id: 'av4', name: 'No Avatar', channelUrl: 'https://www.youtube.com/@x' }, fakeDoc, {});
  assert.strictEqual(withoutField.children[0].textContent, 'N');
  assert.strictEqual(withoutField.children[0].children.length, 0, 'no <img> child when there is no real avatar');

  const blankField = createSubscriptionRow({ id: 'av5', name: 'Blank', channelUrl: 'https://www.youtube.com/@y', channelAvatarUrl: '   ' }, fakeDoc, {});
  assert.strictEqual(blankField.children[0].textContent, 'B');
});

test('createSubscriptionRow: a channelAvatarUrl with surrounding whitespace is trimmed before being assigned to img.src', () => {
  const row = createSubscriptionRow({ id: 'av6', name: 'Trim', channelUrl: 'https://www.youtube.com/@trim', channelAvatarUrl: '  https://example.com/a.jpg  ' }, fakeDoc, {});
  assert.strictEqual(row.children[0].children[0].src, 'https://example.com/a.jpg');
});

test('buildSettingsSheet: renders a real <img> avatar inside .sub-sheet-avatar when channelAvatarUrl is present', () => {
  const sub = {
    id: 'sheet-av1',
    name: 'Sheet Avatar Channel',
    channelUrl: 'https://www.youtube.com/@sheetavatar',
    channelAvatarUrl: 'https://example.com/sheet-avatar.jpg',
  };
  const backdrop = buildSettingsSheet(sub, fakeDoc, {});
  const sheet = backdrop.children[0];
  const header = sheet.children[0];
  const avatar = header.children[0];
  assert.strictEqual(avatar.className, 'sub-sheet-avatar');
  assert.strictEqual(avatar.children.length, 1);
  const img = avatar.children[0];
  assert.strictEqual(img.tagName, 'IMG');
  assert.strictEqual(img.alt, '');
  assert.strictEqual(img.src, 'https://example.com/sheet-avatar.jpg');
});

test('buildSettingsSheet: falls back to the letter avatar in .sub-sheet-avatar when channelAvatarUrl is absent', () => {
  const backdrop = buildSettingsSheet({ id: 'sheet-av2', name: 'Letter Sheet' }, fakeDoc, {});
  const sheet = backdrop.children[0];
  const header = sheet.children[0];
  const avatar = header.children[0];
  assert.strictEqual(avatar.textContent, 'L');
  assert.strictEqual(avatar.children.length, 0);
});

test('createSubscriptionRow: the metadata line combines formatSubMeta with the FR-4 subscribed date', () => {
  const sub = {
    id: 'm1',
    name: 'Meta',
    channelUrl: 'https://www.youtube.com/@meta',
    format: 'audio',
    quality: '720p',
    cutoffDate: '20260102',
    addedAt: '2026-01-02T00:00:00.000Z',
  };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const info = row.children[1];
  const metaEl = info.children.find((el) => el.className === 'sub-row-meta');
  assert.ok(metaEl, 'a .sub-row-meta element must exist');
  assert.ok(metaEl.textContent.includes(formatSubMeta(sub)));
  assert.ok(metaEl.textContent.includes(formatSubscribedDate(sub.addedAt)));
});

test('createSubscriptionRow: the metadata line shows the cutoff date, not the retired max-videos cap', () => {
  const sub = {
    id: 'm2',
    name: 'Cutoff',
    format: 'video',
    quality: 'best',
    cutoffDate: '20260615',
  };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const info = row.children[1];
  const metaEl = info.children.find((el) => el.className === 'sub-row-meta');
  assert.ok(metaEl.textContent.includes('Downloads since 2026-06-15'));
  assert.ok(!metaEl.textContent.includes('max videos'));
});

test('createSubscriptionRow: a blank/missing cutoffDate renders the meta line without a cutoff segment (never "undefined"/"NaN")', () => {
  const sub = { id: 'm3', name: 'NoCutoff', format: 'video', quality: 'best' };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const info = row.children[1];
  const metaEl = info.children.find((el) => el.className === 'sub-row-meta');
  assert.ok(!metaEl.textContent.includes('undefined'));
  assert.ok(!metaEl.textContent.includes('NaN'));
  assert.ok(!metaEl.textContent.includes('Downloads since'));
});

test('createSubscriptionRow: a live downloading status overrides the persisted lastStatus line in .sub-row-status (a separate element from .sub-row-meta)', () => {
  const sub = {
    id: 'l1',
    name: 'Live Channel',
    channelUrl: 'https://www.youtube.com/@live',
    lastStatus: 'ok: downloaded 1 new video(s)',
    lastCheckedAt: '2026-07-05T00:00:00.000Z',
  };
  const liveEntry = { state: 'downloading', title: 'Ep 1', index: 1, total: 3, percent: 10 };
  const row = createSubscriptionRow(sub, fakeDoc, {}, liveEntry);
  const info = row.children[1];
  const statusEl = info.children.find((el) => el.className === 'sub-row-status');
  const metaEl = info.children.find((el) => el.className === 'sub-row-meta');
  assert.ok(statusEl.textContent.includes('Ep 1 — 1 of 3 — 10%'));
  assert.ok(!statusEl.textContent.includes('ok: downloaded 1 new video(s)'), 'the persisted status must not also render in .sub-row-status');
  assert.ok(!metaEl.textContent.includes('Ep 1'), 'the live status must never bleed into the separate, poll-immune .sub-row-meta element');
});

test('createSubscriptionRow: renders a real clickable channel <a> (href/target/rel set, textContent-only label) when channelUrl is present (AC30/AC31)', () => {
  const sub = { id: 'l2', name: 'Link Ch', channelUrl: 'https://www.youtube.com/@linkch' };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const info = row.children[1];
  const link = info.children.find((el) => el.className === 'sub-row-channel-link');
  assert.ok(link);
  assert.strictEqual(link.tagName, 'A');
  assert.strictEqual(link.href, sub.channelUrl);
  assert.strictEqual(link.target, '_blank');
  assert.strictEqual(link.rel, 'noopener noreferrer');
  assert.strictEqual(link.textContent, sub.channelUrl);
});

test('createSubscriptionRow: omits the <a> tag (renders a plain, non-link element) when channelUrl is absent', () => {
  const sub = { id: 'l3', name: 'No URL' };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const info = row.children[1];
  const link = info.children.find((el) => el.className === 'sub-row-channel-link');
  assert.ok(link);
  assert.notStrictEqual(link.tagName, 'A', 'must not render an <a> with no real href to point to');
  assert.strictEqual(link.textContent, '');
});

// ---- AC20: row tap navigation, gated on a resolved channelDir --------------

test('createSubscriptionRow: row tap invokes onRowTap when channelDir is resolved', () => {
  const sub = { id: 'r1', name: 'Nav', channelUrl: 'https://www.youtube.com/@nav', channelDir: '/data/x' };
  const tapCalls = [];
  const row = createSubscriptionRow(sub, fakeDoc, { onRowTap: (s) => tapCalls.push(s) });
  row.click();
  assert.deepStrictEqual(tapCalls, [sub]);
});

test('createSubscriptionRow: no row-tap listener is attached at all when channelDir is unresolved (fail-safe non-navigating)', () => {
  const sub = { id: 'r2', name: 'NoNav', channelUrl: 'https://www.youtube.com/@nonav' };
  const tapCalls = [];
  const row = createSubscriptionRow(sub, fakeDoc, { onRowTap: (s) => tapCalls.push(s) });
  row.click();
  assert.deepStrictEqual(tapCalls, [], 'a row with no resolved channelDir must never navigate');
});

test('createSubscriptionRow: an empty-string channelDir is also treated as unresolved (non-navigating)', () => {
  const sub = { id: 'r3', name: 'EmptyDir', channelUrl: 'https://www.youtube.com/@emptydir', channelDir: '' };
  const tapCalls = [];
  const row = createSubscriptionRow(sub, fakeDoc, { onRowTap: (s) => tapCalls.push(s) });
  row.click();
  assert.deepStrictEqual(tapCalls, []);
});

// ---- v1.21 FIX 2 (post-gate hardening, QA -- FR-3/FR-4): a click landing
// on the channel link or the playlist link must NOT also fire row-tap
// navigation (previously both links opened AND navigated the current tab
// away, since only the kebab/pin-toggle stopPropagation'd).

test('createSubscriptionRow: clicking the channel link does not also trigger row-tap navigation', () => {
  const sub = { id: 'rl1', name: 'LinkRow', channelUrl: 'https://www.youtube.com/@linkrow', channelDir: '/data/lr' };
  const tapCalls = [];
  const row = createSubscriptionRow(sub, fakeDoc, { onRowTap: (s) => tapCalls.push(s) });
  const channelLink = [...row.walk()].find((el) => el.className === 'sub-row-channel-link');
  assert.ok(channelLink, 'expected a .sub-row-channel-link to exist');
  assert.strictEqual(channelLink.tagName, 'A');
  row.click({ target: channelLink });
  assert.deepStrictEqual(tapCalls, [], 'a click on the channel link must never also navigate the row');
});

test('createSubscriptionRow: clicking the "View as Playlist" link does not also trigger row-tap navigation', () => {
  const sub = { id: 'rl2', name: 'PlaylistRow', channelUrl: 'https://www.youtube.com/@plrow', channelDir: '/data/pr' };
  const tapCalls = [];
  const row = createSubscriptionRow(sub, fakeDoc, { onRowTap: (s) => tapCalls.push(s) });
  const playlistLink = [...row.walk()].find((el) => el.className === 'sub-row-playlist-link');
  assert.ok(playlistLink, 'expected a .sub-row-playlist-link to exist');
  row.click({ target: playlistLink });
  assert.deepStrictEqual(tapCalls, [], 'a click on the playlist link must never also navigate the row');
});

test('createSubscriptionRow: a click on the row body (not a link) still navigates', () => {
  const sub = { id: 'rl3', name: 'BodyRow', channelUrl: 'https://www.youtube.com/@bodyrow', channelDir: '/data/br' };
  const tapCalls = [];
  const row = createSubscriptionRow(sub, fakeDoc, { onRowTap: (s) => tapCalls.push(s) });
  const nameEl = [...row.walk()].find((el) => el.className === 'sub-row-name');
  assert.ok(nameEl, 'expected a .sub-row-name to exist');
  row.click({ target: nameEl });
  assert.deepStrictEqual(tapCalls, [sub], 'clicking any non-link part of the row body must still navigate');
});

// ---- AC21/AC22: kebab opens the settings sheet, independent of row tap ----

test('createSubscriptionRow: the kebab button opens the settings sheet via onOpenSettings, and never also fires row-tap navigation', () => {
  const sub = { id: 'k1', name: 'K', channelUrl: 'https://www.youtube.com/@k', channelDir: '/data/k' };
  const tapCalls = [];
  const openCalls = [];
  const row = createSubscriptionRow(sub, fakeDoc, {
    onRowTap: (s) => tapCalls.push(s),
    onOpenSettings: (s) => openCalls.push(s),
  });
  // v1.21.0 FR-5: a navigable row (channelDir present) now also renders a
  // pin-toggle star BEFORE the kebab -- look the kebab up by className
  // rather than a fixed index so this test stays correct regardless of
  // sibling ordering.
  const kebab = row.children.find((el) => el.className === 'sub-row-kebab');
  assert.ok(kebab, 'expected a .sub-row-kebab child to exist');
  kebab.click({ stopPropagation: () => {} });
  assert.deepStrictEqual(openCalls, [sub]);
  assert.deepStrictEqual(tapCalls, [], 'the kebab click must never also trigger row navigation');
});

// ---- v1.20.0 FR-4: per-channel Playlist link (unchanged, still present) ---

test('createSubscriptionRow: still renders a "View as Playlist" link to /?root=<encodeURIComponent(channelDir)> when channelDir is present', () => {
  const sub = {
    id: 'pl1',
    name: 'Playlist Channel',
    channelUrl: 'https://www.youtube.com/@playlistchannel',
    channelDir: '/data/ytdlp-downloads/Playlist Channel',
  };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const link = [...row.walk()].find((el) => el.className === 'sub-row-playlist-link');
  assert.ok(link, 'a playlist link must be rendered when channelDir is present');
  assert.strictEqual(link.href, '/?root=' + encodeURIComponent(sub.channelDir));
  assert.strictEqual(link.textContent, 'View as Playlist');
});

test('createSubscriptionRow: omits the playlist link entirely when channelDir is absent', () => {
  const sub = { id: 'pl2', name: 'No Dir Channel', channelUrl: 'https://www.youtube.com/@nodir' };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const link = [...row.walk()].find((el) => el.className === 'sub-row-playlist-link');
  assert.strictEqual(link, undefined, 'no playlist link must be rendered when channelDir is missing');
});

test('createSubscriptionRow: a channelDir containing characters requiring escaping is properly encodeURIComponent-encoded in the href, never raw-interpolated', () => {
  const sub = {
    id: 'pl4',
    name: 'Channel & Co',
    channelUrl: 'https://www.youtube.com/@channelandco',
    channelDir: '/data/ytdlp-downloads/Channel & Co',
  };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const link = [...row.walk()].find((el) => el.className === 'sub-row-playlist-link');
  assert.ok(link);
  assert.strictEqual(link.href, '/?root=%2Fdata%2Fytdlp-downloads%2FChannel%20%26%20Co');
});

// ---- v1.21.0 FR-5 (AC35): the star/pin toggle -------------------------------

test('createSubscriptionRow: renders an OUTLINE star (unpinned) by default when channelDir is present, before the kebab', () => {
  const sub = { id: 'pin1', name: 'Pinnable', channelUrl: 'https://www.youtube.com/@pinnable', channelDir: '/data/x' };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const pinBtn = row.children.find((el) => el.className && el.className.indexOf('sub-row-pin') === 0);
  assert.ok(pinBtn, 'expected a .sub-row-pin child to exist for a navigable row');
  assert.strictEqual(pinBtn.className, 'sub-row-pin', 'unpinned must not carry the -active modifier class');
  assert.strictEqual(pinBtn.textContent, '☆');
  assert.strictEqual(pinBtn.attributes['aria-pressed'], 'false');
  // Ordering: pin toggle comes before the kebab, both after avatar+info.
  const kebabIndex = row.children.findIndex((el) => el.className === 'sub-row-kebab');
  const pinIndex = row.children.indexOf(pinBtn);
  assert.ok(pinIndex >= 0 && kebabIndex > pinIndex, 'the pin toggle must render before the kebab');
});

test('createSubscriptionRow: renders a FILLED star (pinned) with the -active modifier when pinned=true', () => {
  const sub = { id: 'pin2', name: 'Pinned', channelUrl: 'https://www.youtube.com/@pinned', channelDir: '/data/y' };
  const row = createSubscriptionRow(sub, fakeDoc, {}, undefined, true);
  const pinBtn = row.children.find((el) => el.className && el.className.indexOf('sub-row-pin') === 0);
  assert.strictEqual(pinBtn.className, 'sub-row-pin sub-row-pin-active');
  assert.strictEqual(pinBtn.textContent, '★');
  assert.strictEqual(pinBtn.attributes['aria-pressed'], 'true');
});

test('createSubscriptionRow: omits the pin toggle entirely when channelDir is absent (fail-safe, mirrors the playlist link)', () => {
  const sub = { id: 'pin3', name: 'NoDir', channelUrl: 'https://www.youtube.com/@nodir' };
  const row = createSubscriptionRow(sub, fakeDoc, {}, undefined, true);
  const pinBtn = row.children.find((el) => el.className && el.className.indexOf('sub-row-pin') === 0);
  assert.strictEqual(pinBtn, undefined, 'no pin toggle can exist without a resolved channelDir to pin');
});

test('createSubscriptionRow: clicking the pin toggle calls onTogglePin(sub, pinned) and never also fires row-tap navigation', () => {
  const sub = { id: 'pin4', name: 'Tap', channelUrl: 'https://www.youtube.com/@tap', channelDir: '/data/z' };
  const tapCalls = [];
  const pinCalls = [];
  const row = createSubscriptionRow(sub, fakeDoc, {
    onRowTap: (s) => tapCalls.push(s),
    onTogglePin: (s, p) => pinCalls.push([s, p]),
  }, undefined, false);
  const pinBtn = row.children.find((el) => el.className && el.className.indexOf('sub-row-pin') === 0);
  pinBtn.click({ stopPropagation: () => {} });
  assert.deepStrictEqual(pinCalls, [[sub, false]]);
  assert.deepStrictEqual(tapCalls, [], 'the pin toggle click must never also trigger row navigation');
});

// ---- B4 (v1.24.0, T6, FR-8): DnD reorder attributes ------------------------
// Reordering applies to every row with a real id (unlike the Playlist link/
// pin toggle, it does not need a resolved channelDir) -- the live wiring
// (subscriptions.js's wireSubRowDragAndDrop, untestable DOM drag events, see
// its own doc comment) reads `data-sub-id` back off each row; this only
// proves the pure builder sets the two attributes it must.

test('createSubscriptionRow: sets draggable="true" and data-sub-id for reordering, even without a resolved channelDir', () => {
  const sub = { id: 'drag1', name: 'Draggable', channelUrl: 'https://www.youtube.com/@drag1' };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  assert.strictEqual(row.attributes.draggable, 'true');
  assert.strictEqual(row.attributes['data-sub-id'], 'drag1');
});

test('createSubscriptionRow: omits draggable/data-sub-id when the subscription has no usable id (fail-safe, never a bogus attribute)', () => {
  const row = createSubscriptionRow({ name: 'NoId' }, fakeDoc, {});
  assert.strictEqual(row.attributes.draggable, undefined);
  assert.strictEqual(row.attributes['data-sub-id'], undefined);
});

test('createSubscriptionsListElement: derives each row\'s pinned flag from the pinnedChannelDirs Set, matched by channelDir', () => {
  const subs = [
    { id: '1', name: 'A', channelUrl: 'https://www.youtube.com/@a', channelDir: '/data/a' },
    { id: '2', name: 'B', channelUrl: 'https://www.youtube.com/@b', channelDir: '/data/b' },
  ];
  const container = createSubscriptionsListElement(subs, fakeDoc, {}, undefined, new Set(['/data/b']));
  const rowA = container.children[0];
  const rowB = container.children[1];
  const pinA = rowA.children.find((el) => el.className && el.className.indexOf('sub-row-pin') === 0);
  const pinB = rowB.children.find((el) => el.className && el.className.indexOf('sub-row-pin') === 0);
  assert.strictEqual(pinA.className, 'sub-row-pin', 'row A\'s channelDir is not in the pinned set');
  assert.strictEqual(pinB.className, 'sub-row-pin sub-row-pin-active', 'row B\'s channelDir IS in the pinned set');
});

test('createSubscriptionsListElement: an omitted pinnedChannelDirs defaults every row to unpinned (never throws)', () => {
  const subs = [{ id: '1', name: 'A', channelUrl: 'https://www.youtube.com/@a', channelDir: '/data/a' }];
  assert.doesNotThrow(() => createSubscriptionsListElement(subs, fakeDoc, {}));
  const container = createSubscriptionsListElement(subs, fakeDoc, {});
  const pin = container.children[0].children.find((el) => el.className && el.className.indexOf('sub-row-pin') === 0);
  assert.strictEqual(pin.className, 'sub-row-pin');
});

// ---- SECURITY (mandatory regression test): a hostile subscription name -----

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
  // any HTML parser) would have created exactly those elements from it.
  const tagNames = new Set(allNodes.map((el) => el.tagName));
  assert.ok(!tagNames.has('SCRIPT'), 'no <script> element must ever be created from subscription data');
  assert.ok(!tagNames.has('IMG'), 'no <img> element must ever be created from subscription data');
  for (const tag of tagNames) {
    assert.ok(['DIV', 'BUTTON', 'A'].includes(tag), `unexpected element tag created from row data: ${tag}`);
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
  // formatSubStatus prefixes "Last checked: <date> — " -- the hostile
  // fragment survives verbatim as a SUFFIX of .sub-row-status's textContent.
  const statusNode = allNodes.find((el) => typeof el.textContent === 'string' && el.textContent.endsWith(hostileStatus));
  assert.ok(statusNode, 'the hostile status text must be present verbatim as textContent');
  const tagNames = new Set(allNodes.map((el) => el.tagName));
  assert.ok(!tagNames.has('IMG'), 'no <img> element must ever be created from a status string');
});

// ---- v1.24.0 A2 (T14): per-item failure list in .sub-row-failures ---------

test('createSubscriptionRow: renders .sub-row-failures with one "video: reason" line per failure and un-hides it when a live error entry has failures', () => {
  const sub = { id: 'a2-1', name: 'Chan', channelUrl: 'https://www.youtube.com/@a2-1', lastCheckedAt: null, lastStatus: null };
  const liveEntry = {
    state: 'error',
    error: 'error: yt-dlp exited with code 1',
    failures: [
      { videoId: 'vid1', title: 'Cool Video', reason: 'Video unavailable' },
      { videoId: null, reason: 'unattributed reason' },
    ],
  };
  const row = createSubscriptionRow(sub, fakeDoc, {}, liveEntry);
  const info = row.children.find((el) => el.className === 'sub-row-info');
  const failuresEl = info.children.find((el) => el.className === 'sub-row-failures');
  assert.ok(failuresEl, '.sub-row-failures must exist on every row (hidden when empty)');
  assert.strictEqual(failuresEl.hidden, false);
  assert.strictEqual(failuresEl.textContent, 'Cool Video: Video unavailable | Unknown video: unattributed reason');
});

test('createSubscriptionRow: .sub-row-failures is present but HIDDEN (empty textContent) when there is no live error entry', () => {
  const sub = { id: 'a2-2', name: 'Chan', channelUrl: 'https://www.youtube.com/@a2-2', lastCheckedAt: null, lastStatus: null };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const info = row.children.find((el) => el.className === 'sub-row-info');
  const failuresEl = info.children.find((el) => el.className === 'sub-row-failures');
  assert.ok(failuresEl);
  assert.strictEqual(failuresEl.hidden, true);
  assert.strictEqual(failuresEl.textContent, '');
});

test('createSubscriptionRow: .sub-row-failures stays hidden when the live entry is a downloading state carrying a STALE failures array from a prior cycle', () => {
  const sub = { id: 'a2-3', name: 'Chan', channelUrl: 'https://www.youtube.com/@a2-3', lastCheckedAt: null, lastStatus: null };
  const liveEntry = { state: 'downloading', percent: 10, failures: [{ videoId: 'vid1', reason: 'stale from a prior failed cycle' }] };
  const row = createSubscriptionRow(sub, fakeDoc, {}, liveEntry);
  const info = row.children.find((el) => el.className === 'sub-row-info');
  const failuresEl = info.children.find((el) => el.className === 'sub-row-failures');
  assert.strictEqual(failuresEl.hidden, true, 'a stale failures array on a non-error state must never render');
});

test('createSubscriptionRow: a hostile reason/title inside a failure entry is rendered as inert textContent, never innerHTML', () => {
  const hostileReason = '<img src=x onerror=alert(1)>';
  const sub = { id: 'a2-4', name: 'Chan', channelUrl: 'https://www.youtube.com/@a2-4', lastCheckedAt: null, lastStatus: null };
  const liveEntry = { state: 'error', failures: [{ videoId: 'vid1', reason: hostileReason }] };
  const row = createSubscriptionRow(sub, fakeDoc, {}, liveEntry);
  const info = row.children.find((el) => el.className === 'sub-row-info');
  const failuresEl = info.children.find((el) => el.className === 'sub-row-failures');
  assert.ok(failuresEl.textContent.includes(hostileReason));
  const tagNames = new Set([...row.walk()].map((el) => el.tagName));
  assert.ok(!tagNames.has('IMG'), 'no <img> element must ever be created from a failure reason');
});

test('createSubscriptionRow: a hostile channelUrl never becomes an XSS vector -- it is only ever assigned via .href, and its label is plain textContent', () => {
  // `javascript:`-scheme URLs cannot reach this code path in practice
  // (validateChannelUrl confines add-time input to http(s) youtube URLs
  // server-side), but this proves the CLIENT-side rendering mechanism itself
  // (.href/.textContent) carries no interpolation risk regardless.
  const hostileUrl = 'https://www.youtube.com/@c"><script>alert(1)</script>';
  const sub = { id: 'evil-3', name: 'Channel', channelUrl: hostileUrl };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const allNodes = [...row.walk()];
  const link = allNodes.find((el) => el.className === 'sub-row-channel-link');
  assert.strictEqual(link.href, hostileUrl, 'href is assigned verbatim as a property, never parsed as markup');
  assert.strictEqual(link.textContent, hostileUrl);
  const tagNames = new Set(allNodes.map((el) => el.tagName));
  assert.ok(!tagNames.has('SCRIPT'));
});

test('createSubscriptionRow: a hostile LIVE error status (FR-E) is also rendered as inert text, never innerHTML', () => {
  const hostileLiveError = 'error: <img src=x onerror=alert(1)>';
  const sub = { id: 'evil-4', name: 'Channel', channelUrl: 'https://www.youtube.com/@c' };
  const liveEntry = { state: 'error', error: hostileLiveError };

  const row = createSubscriptionRow(sub, fakeDoc, {}, liveEntry);
  const allNodes = [...row.walk()];
  const statusNode = allNodes.find((el) => el.textContent === hostileLiveError);
  assert.ok(statusNode, 'the hostile live error text must be present verbatim as textContent');
  const tagNames = new Set(allNodes.map((el) => el.tagName));
  assert.ok(!tagNames.has('IMG'), 'no <img> element must ever be created from a live error string');
});

// ---- createSubscriptionsListElement (empty state + ordering contract) -----

test('createSubscriptionsListElement: renders an empty-state message when there are no subscriptions', () => {
  const container = createSubscriptionsListElement([], fakeDoc, {});
  const texts = [...container.walk()].map((el) => el.textContent).filter(Boolean);
  assert.ok(texts.some((t) => t.includes('No subscriptions yet')));
});

test('createSubscriptionsListElement: renders one row per subscription, in order (container.children[i] <-> subs[i])', () => {
  const subs = [
    { id: '1', name: 'Channel A', channelUrl: 'https://www.youtube.com/@a' },
    { id: '2', name: 'Channel B', channelUrl: 'https://www.youtube.com/@b' },
  ];
  const container = createSubscriptionsListElement(subs, fakeDoc, {});
  assert.strictEqual(container.children.length, 2);
  assert.strictEqual(container.children[0].children[1].children.find((el) => el.className === 'sub-row-name').textContent, 'Channel A');
  assert.strictEqual(container.children[1].children[1].children.find((el) => el.className === 'sub-row-name').textContent, 'Channel B');
});

// ---- v1.21.0 FR-3 (AC21): the settings bottom-sheet -------------------------

test('buildSettingsSheet: renders the channel name READ-ONLY (plain text, no input control) with the subscribed date, and all editable fields', () => {
  const sub = {
    id: 's1',
    name: 'Editable Channel',
    channelUrl: 'https://www.youtube.com/@editable',
    format: 'video',
    quality: '720p',
    filetype: 'mkv',
    cutoffDate: '20260201',
    skipShorts: true,
    addedAt: '2026-02-01T00:00:00.000Z',
    paused: false,
  };
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, {});
  assert.strictEqual(sheetBackdrop.className, 'sub-sheet-backdrop');
  const sheet = sheetBackdrop.children.find((el) => el.className === 'sub-sheet');
  assert.ok(sheet);

  const allNodes = [...sheetBackdrop.walk()];

  // Name is read-only: no INPUT/SELECT anywhere carries the channel name as
  // its value -- it only ever appears as plain textContent.
  const nameEl = allNodes.find((el) => el.className === 'sub-sheet-name');
  assert.ok(nameEl);
  assert.strictEqual(nameEl.textContent, sub.name);
  assert.notStrictEqual(nameEl.tagName, 'INPUT');

  const subtextEl = allNodes.find((el) => el.className === 'sub-sheet-subtext');
  assert.strictEqual(subtextEl.textContent, formatSubscribedDate(sub.addedAt));

  const selects = allNodes.filter((el) => el.tagName === 'SELECT');
  assert.strictEqual(selects.length, 3, 'expected format/quality/filetype selects');
  assert.strictEqual(selects[0].value, 'video');
  assert.strictEqual(selects[1].value, '720p');
  assert.strictEqual(selects[2].value, 'mkv');

  // v1.25 QoL (T5): retires the "download last N videos" number input --
  // replaced by a cutoff-DATE input, pre-filled from the sub's OWN current
  // cutoffDate (converted YYYYMMDD -> YYYY-MM-DD).
  const cutoffDateInput = allNodes.find((el) => el.tagName === 'INPUT' && el.type === 'date');
  assert.ok(cutoffDateInput);
  assert.strictEqual(cutoffDateInput.value, '2026-02-01');

  const skipShortsCheck = allNodes.find((el) => el.tagName === 'INPUT' && el.type === 'checkbox');
  assert.ok(skipShortsCheck);
  assert.strictEqual(skipShortsCheck.checked, true);
});

test('buildSettingsSheet: a subscription with no cutoffDate yet renders the date input blank', () => {
  const sub = { id: 's1b', name: 'C', channelUrl: 'https://www.youtube.com/@c' };
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, {});
  const cutoffDateInput = [...sheetBackdrop.walk()].find((el) => el.tagName === 'INPUT' && el.type === 'date');
  assert.strictEqual(cutoffDateInput.value, '');
});

test('buildSettingsSheet: Save collects format/quality/filetype/cutoffDate/skipShorts into a patch and calls onSave(id, patch)', () => {
  const sub = { id: 'e1', name: 'C', channelUrl: 'https://www.youtube.com/@c', format: 'video', quality: 'best' };
  const saveCalls = [];
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, { onSave: (id, patch) => saveCalls.push([id, patch]) });
  const saveBtn = [...sheetBackdrop.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Save');
  assert.ok(saveBtn);
  saveBtn.click();
  assert.strictEqual(saveCalls.length, 1);
  const [id, patch] = saveCalls[0];
  assert.strictEqual(id, 'e1');
  assert.strictEqual(patch.format, 'video');
  assert.strictEqual(patch.quality, 'best');
  assert.strictEqual(typeof patch.skipShorts, 'boolean');
});

test('buildSettingsSheet: Save omits cutoffDate entirely when the date field is left blank (blank = unchanged)', () => {
  const sub = { id: 'e2', name: 'C', channelUrl: 'https://www.youtube.com/@c' };
  const saveCalls = [];
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, { onSave: (id, patch) => saveCalls.push([id, patch]) });
  const saveBtn = [...sheetBackdrop.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Save');
  saveBtn.click();
  assert.strictEqual('cutoffDate' in saveCalls[0][1], false);
});

test('buildSettingsSheet: Save sends the edited cutoffDate (converted YYYY-MM-DD -> YYYYMMDD) when the date field is set', () => {
  const sub = { id: 'e3', name: 'C', channelUrl: 'https://www.youtube.com/@c' };
  const saveCalls = [];
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, { onSave: (id, patch) => saveCalls.push([id, patch]) });
  const cutoffDateInput = [...sheetBackdrop.walk()].find((el) => el.tagName === 'INPUT' && el.type === 'date');
  cutoffDateInput.value = '2026-03-15';
  const saveBtn = [...sheetBackdrop.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Save');
  saveBtn.click();
  assert.strictEqual(saveCalls[0][1].cutoffDate, '20260315');
});

// ---- v1.22.0 FR-6: max-duration download gate, settings-sheet field --------

test('buildSettingsSheet: renders a number input pre-filled with the persisted maxDurationSeconds', () => {
  const sub = {
    id: 's2', name: 'C', channelUrl: 'https://www.youtube.com/@c', cutoffDate: '20260201', maxDurationSeconds: 3600,
  };
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, {});
  const numberInputs = [...sheetBackdrop.walk()].filter((el) => el.tagName === 'INPUT' && el.type === 'number');
  assert.strictEqual(numberInputs.length, 1, 'expected exactly the maxDurationSeconds number input (the count field is retired)');
  assert.strictEqual(numberInputs[0].value, '3600');
});

test('buildSettingsSheet: Save omits maxDurationSeconds entirely when the field is left blank (blank = unchanged)', () => {
  const sub = { id: 'e4', name: 'C', channelUrl: 'https://www.youtube.com/@c' };
  const saveCalls = [];
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, { onSave: (id, patch) => saveCalls.push([id, patch]) });
  const saveBtn = [...sheetBackdrop.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Save');
  saveBtn.click();
  assert.strictEqual('maxDurationSeconds' in saveCalls[0][1], false);
});

test('buildSettingsSheet: Save sends maxDurationSeconds: 0 (unlimited sentinel) when the field is explicitly set to 0', () => {
  const sub = { id: 'e5', name: 'C', channelUrl: 'https://www.youtube.com/@c' };
  const saveCalls = [];
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, { onSave: (id, patch) => saveCalls.push([id, patch]) });
  const numberInputs = [...sheetBackdrop.walk()].filter((el) => el.tagName === 'INPUT' && el.type === 'number');
  numberInputs[0].value = '0';
  const saveBtn = [...sheetBackdrop.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Save');
  saveBtn.click();
  assert.strictEqual(saveCalls[0][1].maxDurationSeconds, 0);
});

test('buildSettingsSheet: Save sends a positive maxDurationSeconds override entered by the user', () => {
  const sub = { id: 'e6', name: 'C', channelUrl: 'https://www.youtube.com/@c' };
  const saveCalls = [];
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, { onSave: (id, patch) => saveCalls.push([id, patch]) });
  const numberInputs = [...sheetBackdrop.walk()].filter((el) => el.tagName === 'INPUT' && el.type === 'number');
  numberInputs[0].value = '3600';
  const saveBtn = [...sheetBackdrop.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Save');
  saveBtn.click();
  assert.strictEqual(saveCalls[0][1].maxDurationSeconds, 3600);
});

test('buildSettingsSheet: Pause/Resume label reflects the subscription\'s paused state and wires onTogglePause', () => {
  const pausedCalls = [];
  const pausedSheet = buildSettingsSheet(
    { id: 'p1', name: 'C', channelUrl: 'https://www.youtube.com/@c', paused: true },
    fakeDoc,
    { onTogglePause: (s) => pausedCalls.push(s) }
  );
  const resumeBtn = [...pausedSheet.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Resume');
  assert.ok(resumeBtn, 'a paused subscription must show a Resume button');
  resumeBtn.click();
  assert.strictEqual(pausedCalls.length, 1);

  const activeSheet = buildSettingsSheet({ id: 'p2', name: 'C', channelUrl: 'https://www.youtube.com/@c', paused: false }, fakeDoc, {});
  const pauseBtn = [...activeSheet.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Pause');
  assert.ok(pauseBtn, 'an active subscription must show a Pause button');
});

test('buildSettingsSheet: Re-pull wires onRepull(id) and Delete wires onDelete(sub)', () => {
  const sub = { id: 'd1', name: 'C', channelUrl: 'https://www.youtube.com/@c' };
  const repullCalls = [];
  const deleteCalls = [];
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, {
    onRepull: (id) => repullCalls.push(id),
    onDelete: (s) => deleteCalls.push(s),
  });
  const repullBtn = [...sheetBackdrop.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Re-pull');
  const deleteBtn = [...sheetBackdrop.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Delete');
  repullBtn.click();
  deleteBtn.click();
  assert.deepStrictEqual(repullCalls, ['d1']);
  assert.deepStrictEqual(deleteCalls, [sub]);
});

test('buildSettingsSheet: the close button and a backdrop click both invoke onClose', () => {
  const sub = { id: 'c1', name: 'C', channelUrl: 'https://www.youtube.com/@c' };
  const closeCalls = [];
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, { onClose: () => closeCalls.push(1) });
  const closeBtn = [...sheetBackdrop.walk()].find((el) => el.tagName === 'BUTTON' && el.className === 'sub-sheet-close');
  closeBtn.click();
  sheetBackdrop.click({ stopPropagation: () => {} });
  assert.strictEqual(closeCalls.length, 2);
});

test('buildSettingsSheet: a hostile subscription name is rendered as inert text (XSS regression, mirrors the row-level guarantee)', () => {
  const hostileName = '<script>window.__xssSheet = true;</script>';
  const sub = { id: 'evil-sheet', name: hostileName, channelUrl: 'https://www.youtube.com/@evil' };
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, {});
  const allNodes = [...sheetBackdrop.walk()];
  assert.ok(allNodes.some((el) => el.textContent === hostileName));
  const tagNames = new Set(allNodes.map((el) => el.tagName));
  assert.ok(!tagNames.has('SCRIPT'));
});

// ---- v1.21.0 FR-1 fix (AC1/AC4/AC22): the targeted in-place poll update ----

test('applyStatusUpdatesInPlace: updates ONLY each row\'s .sub-row-status text, never replacing/rebuilding the row element', () => {
  const subA = { id: 'a', name: 'A', channelUrl: 'https://www.youtube.com/@a', lastStatus: 'pending', lastCheckedAt: null };
  const rowA = createSubscriptionRow(subA, fakeDoc, {});
  const rowElementsById = { a: rowA };
  const beforeChildCount = rowA.children.length;
  const beforeNameText = rowA.children[1].children.find((el) => el.className === 'sub-row-name').textContent;

  applyStatusUpdatesInPlace(rowElementsById, [subA], {
    subscriptions: { a: { state: 'downloading', title: 'Ep', index: 1, total: 2, percent: 50 } },
  });

  // Same row object reference -- never rebuilt/replaced -- and its structure
  // (child count) is untouched.
  assert.strictEqual(rowElementsById.a, rowA);
  assert.strictEqual(rowA.children.length, beforeChildCount, 'row structure must be unchanged -- no rebuild');
  assert.strictEqual(rowA.children[1].children.find((el) => el.className === 'sub-row-name').textContent, beforeNameText);

  const statusEl = rowA.children[1].children.find((el) => el.className === 'sub-row-status');
  assert.ok(statusEl.textContent.includes('Ep'));
  assert.ok(statusEl.textContent.includes('50%'));
});

test('applyStatusUpdatesInPlace: A2 (T14) -- updates .sub-row-failures in place (textContent only, never createElement), un-hiding it once a poll tick reports per-item failures', () => {
  const sub = { id: 'a2-poll', name: 'Chan', channelUrl: 'https://www.youtube.com/@a2-poll', lastCheckedAt: null, lastStatus: null };
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const rowElementsById = { 'a2-poll': row };
  const info = row.children.find((el) => el.className === 'sub-row-info');
  const failuresElBefore = info.children.find((el) => el.className === 'sub-row-failures');
  assert.strictEqual(failuresElBefore.hidden, true, 'sanity: nothing to show yet');

  applyStatusUpdatesInPlace(rowElementsById, [sub], {
    subscriptions: {
      'a2-poll': {
        state: 'error',
        error: 'error: yt-dlp exited with code 1',
        failures: [{ videoId: 'vid1', title: 'A Video', reason: 'Video unavailable' }],
      },
    },
  });

  // Same row/element references -- never rebuilt.
  assert.strictEqual(rowElementsById['a2-poll'], row);
  const failuresElAfter = info.children.find((el) => el.className === 'sub-row-failures');
  assert.strictEqual(failuresElAfter, failuresElBefore, 'the SAME element must be updated in place, never replaced');
  assert.strictEqual(failuresElAfter.hidden, false);
  assert.strictEqual(failuresElAfter.textContent, 'A Video: Video unavailable');
});

test('applyStatusUpdatesInPlace: A2 (T14) -- re-hides .sub-row-failures once the subscription recovers on a later poll tick', () => {
  const sub = { id: 'a2-recover', name: 'Chan', channelUrl: 'https://www.youtube.com/@a2-recover', lastCheckedAt: null, lastStatus: null };
  const liveEntry = { state: 'error', failures: [{ videoId: 'vid1', reason: 'Video unavailable' }] };
  const row = createSubscriptionRow(sub, fakeDoc, {}, liveEntry);
  const rowElementsById = { 'a2-recover': row };

  // A later poll tick reports a clean 'done' -- even though `activity.js`'s
  // shallow merge could in principle leave a stale `failures` array on the
  // RAW entry, the state gate inside `formatFailuresLine` is what actually
  // determines rendering, so this proves the UI-visible behavior directly.
  applyStatusUpdatesInPlace(rowElementsById, [sub], {
    subscriptions: { 'a2-recover': { state: 'done', percent: 100 } },
  });

  const info = row.children.find((el) => el.className === 'sub-row-info');
  const failuresEl = info.children.find((el) => el.className === 'sub-row-failures');
  assert.strictEqual(failuresEl.hidden, true);
  assert.strictEqual(failuresEl.textContent, '');
});

test('applyStatusUpdatesInPlace: falls back to the persisted formatSubStatus line when there is no live entry for a sub', () => {
  const sub = { id: 'b', name: 'B', channelUrl: 'https://www.youtube.com/@b', lastStatus: 'ok: downloaded 1 new video(s)', lastCheckedAt: '2026-07-05T00:00:00.000Z' };
  const row = createSubscriptionRow(sub, fakeDoc, {}, { state: 'downloading', percent: 10 });
  const rowElementsById = { b: row };
  applyStatusUpdatesInPlace(rowElementsById, [sub], { subscriptions: {} });
  const statusEl = row.children[1].children.find((el) => el.className === 'sub-row-status');
  assert.ok(statusEl.textContent.includes('ok: downloaded 1 new video(s)'));
});

test('applyStatusUpdatesInPlace: an id with no row reference, or an empty/missing rowElementsById, is a safe no-op (never throws)', () => {
  assert.doesNotThrow(() => applyStatusUpdatesInPlace({}, [{ id: 'missing' }], { subscriptions: {} }));
  assert.doesNotThrow(() => applyStatusUpdatesInPlace(null, [{ id: 'x' }], { subscriptions: {} }));
  assert.doesNotThrow(() => applyStatusUpdatesInPlace({}, null, { subscriptions: {} }));
});

test('applyStatusUpdatesInPlace: NEVER touches an independently-open settings sheet -- the FR-1 poll-clobber bug class cannot recur because the sheet is not part of the row map (AC1/AC4/AC22)', () => {
  // This is the direct regression proof for T3's FR-1 fold-in: the ~2.5s
  // live-status poll must not drop an in-progress, unsaved settings-sheet
  // edit (e.g. a cutoff-date change, v1.25 QoL retired the old "download
  // last N videos" count field this test used to exercise here).
  const sub = { id: 'e1', name: 'Editable', channelUrl: 'https://www.youtube.com/@editable', cutoffDate: '20260301' };
  const sheetSaveCalls = [];
  const sheetBackdrop = buildSettingsSheet(sub, fakeDoc, { onSave: (id, patch) => sheetSaveCalls.push([id, patch]) });
  const cutoffDateInput = [...sheetBackdrop.walk()].find((el) => el.tagName === 'INPUT' && el.type === 'date');

  // The user opens the sheet and edits the cutoff date but has NOT saved
  // yet.
  cutoffDateInput.value = '2026-03-02';

  // A row for the SAME subscription exists in the list (as it would in the
  // real page) -- it is what the poll actually has a reference to via
  // rowElementsById. The sheet itself is a wholly separate top-level node
  // NEVER added to that map (see buildSettingsSheet's doc comment).
  const row = createSubscriptionRow(sub, fakeDoc, {});
  const rowElementsById = { e1: row };

  // A live poll tick arrives while the sheet is open with the unsaved edit.
  applyStatusUpdatesInPlace(rowElementsById, [sub], {
    subscriptions: { e1: { state: 'downloading', percent: 10 } },
  });

  // The unsaved input value must survive completely untouched.
  assert.strictEqual(cutoffDateInput.value, '2026-03-02', 'a live poll tick must never clobber the open sheet\'s unsaved edit');

  // The row's OWN status line was still updated in place, proving the poll
  // did run -- it just had no way to reach the sheet.
  const rowStatusEl = row.children[1].children.find((el) => el.className === 'sub-row-status');
  assert.ok(rowStatusEl.textContent.includes('10%'));

  // Saving now must still send the edited value.
  const saveBtn = [...sheetBackdrop.walk()].find((el) => el.tagName === 'BUTTON' && el.textContent === 'Save');
  saveBtn.click();
  assert.strictEqual(sheetSaveCalls.length, 1);
  assert.strictEqual(sheetSaveCalls[0][0], 'e1');
  assert.strictEqual(sheetSaveCalls[0][1].cutoffDate, '20260302', 'Save must persist the edited date, not the original 20260301');
});

// ---- FR-A/FR-E: one-shot job rows (unchanged by T3) -------------------------

test('createOneShotRow: also uses the dedicated .sub-row/.sub-row-info layout', () => {
  const entry = { state: 'queued', label: 'One-Off', url: 'https://www.youtube.com/watch?v=abc' };
  const row = createOneShotRow('job-x', entry, fakeDoc, {});
  assert.strictEqual(row.className, 'sub-row');
  const infoEl = row.children.find((el) => el.className === 'sub-row-info');
  assert.ok(infoEl, 'an element with the dedicated .sub-row-info class must exist');
});

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

// ---- v1.26 code-review fix (F7): computeOneShotsSignature -----------------

test('computeOneShotsSignature: identical rendered fields produce the identical signature', () => {
  const oneShots = {
    job1: { state: 'downloading', label: 'One-Off', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', percent: 40 },
  };
  const sig1 = computeOneShotsSignature(oneShots);
  const sig2 = computeOneShotsSignature({
    job1: { state: 'downloading', label: 'One-Off', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', percent: 40 },
  });
  assert.strictEqual(sig1, sig2);
});

test('computeOneShotsSignature: a change to a RENDERED field (status/percent) changes the signature', () => {
  const before = computeOneShotsSignature({ job1: { state: 'downloading', label: 'One-Off', url: 'https://x', percent: 10 } });
  const after = computeOneShotsSignature({ job1: { state: 'downloading', label: 'One-Off', url: 'https://x', percent: 55 } });
  assert.notStrictEqual(before, after, 'a percent change must change the signature (it changes the rendered status text)');
});

test('computeOneShotsSignature: a change to a field that is NEVER rendered (format/quality/filetype) does NOT change the signature', () => {
  const before = computeOneShotsSignature({ job1: { state: 'downloading', label: 'One-Off', url: 'https://x', percent: 10, format: 'video', quality: 'best', filetype: 'mp4' } });
  const after = computeOneShotsSignature({ job1: { state: 'downloading', label: 'One-Off', url: 'https://x', percent: 10, format: 'audio', quality: '720p', filetype: 'mp3' } });
  assert.strictEqual(before, after, 'a field that createOneShotRow never renders must not affect the signature');
});

test('computeOneShotsSignature: order-independent -- the same jobs in a different key order produce the same signature', () => {
  const a = computeOneShotsSignature({
    job1: { state: 'downloading', label: 'A', url: 'https://a' },
    job2: { state: 'done', label: 'B', url: 'https://b' },
  });
  const b = computeOneShotsSignature({
    job2: { state: 'done', label: 'B', url: 'https://b' },
    job1: { state: 'downloading', label: 'A', url: 'https://a' },
  });
  assert.strictEqual(a, b);
});

test('computeOneShotsSignature: a removed/added job changes the signature', () => {
  const before = computeOneShotsSignature({ job1: { state: 'downloading', label: 'A', url: 'https://a' } });
  const after = computeOneShotsSignature({});
  assert.notStrictEqual(before, after);
});

test('computeOneShotsSignature: an empty/malformed input never throws and returns a stable empty-ish value', () => {
  assert.strictEqual(computeOneShotsSignature({}), '');
  assert.strictEqual(computeOneShotsSignature(null), '');
  assert.strictEqual(computeOneShotsSignature(undefined), '');
  assert.doesNotThrow(() => computeOneShotsSignature('not-an-object'));
});

// ---- v1.26 code-review fix (F7): updateOneShotsContainer render-skip ------

test('updateOneShotsContainer: an UNCHANGED snapshot on the second call causes NO DOM churn (same child node)', () => {
  const container = new FakeElement('div');
  const oneShots = { job1: { state: 'downloading', label: 'One-Off', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', percent: 40 } };

  const sig1 = updateOneShotsContainer(container, oneShots, fakeDoc, {}, null);
  assert.strictEqual(container.children.length, 1);
  const firstChild = container.children[0];

  const sig2 = updateOneShotsContainer(container, oneShots, fakeDoc, {}, sig1);

  assert.strictEqual(sig2, sig1, 'the signature must be unchanged for an unchanged snapshot');
  assert.strictEqual(container.children.length, 1, 'still exactly one child -- no stray duplicate');
  assert.strictEqual(container.children[0], firstChild, 'F7: an unchanged snapshot must leave the EXISTING child node in place, never tear down and rebuild it');
});

test('updateOneShotsContainer: a CHANGED snapshot (new percent/status) DOES rebuild, and the signature advances', () => {
  const container = new FakeElement('div');
  const oneShots1 = { job1: { state: 'downloading', label: 'One-Off', url: 'https://x', percent: 10 } };
  const sig1 = updateOneShotsContainer(container, oneShots1, fakeDoc, {}, null);
  const firstChild = container.children[0];

  const oneShots2 = { job1: { state: 'downloading', label: 'One-Off', url: 'https://x', percent: 90 } };
  const sig2 = updateOneShotsContainer(container, oneShots2, fakeDoc, {}, sig1);

  assert.notStrictEqual(sig2, sig1, 'a real content change must advance the signature');
  assert.strictEqual(container.children.length, 1);
  assert.notStrictEqual(container.children[0], firstChild, 'a genuinely changed snapshot must rebuild the container content');
});

test('updateOneShotsContainer: a null/undefined prevSignature (first-ever render) always builds', () => {
  const container = new FakeElement('div');
  const oneShots = { job1: { state: 'queued', label: 'One-Off', url: 'https://x' } };
  updateOneShotsContainer(container, oneShots, fakeDoc, {}, null);
  assert.strictEqual(container.children.length, 1, 'the very first render must always populate the container');
});

test('updateOneShotsContainer: a dismiss (item removed from the snapshot) changes the signature and rebuilds', () => {
  const container = new FakeElement('div');
  const oneShots1 = {
    job1: { state: 'downloading', label: 'A', url: 'https://a' },
    job2: { state: 'error', label: 'B', url: 'https://b', error: 'boom' },
  };
  const sig1 = updateOneShotsContainer(container, oneShots1, fakeDoc, {}, null);

  // job2 dismissed -- caller (renderOneShots) excludes it from the snapshot
  // passed in on the next tick.
  const oneShots2 = { job1: { state: 'downloading', label: 'A', url: 'https://a' } };
  const sig2 = updateOneShotsContainer(container, oneShots2, fakeDoc, {}, sig1);

  assert.notStrictEqual(sig2, sig1);
  assert.strictEqual(container.children.length, 1, 'the rebuilt container must reflect the dismissal (one row remains)');
});

// ---- v1.25 QoL follow-up ("reheat"): metadata+subtitle re-pull UI ---------
//
// Client-side wiring against the ALREADY-IMPLEMENTED
// `POST /api/ytdlp/repull-metadata` / `POST /api/ytdlp/repull-metadata/cancel`
// routes (see test/integration/ytdlp-repull-metadata-endpoint.test.js for
// the server-side contract). `triggerReheat`/`triggerReheatCancel` are
// plain, MODULE-SCOPE functions (not nested inside the page's live-wiring
// closure) that accept an injectable `fetchImpl`, exactly so they can be
// unit-tested directly here without a real network or a full DOM --
// mirroring how public/js/common.js's `probeAndReconcileRepullButton` is
// tested via a monkey-patched fetch.

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeJsonResponse(ok, status, body) {
  return { ok, status, json: () => Promise.resolve(body) };
}

test('REHEAT_ACTIVITY_ID: mirrors the server\'s fixed one-shot activity key', () => {
  assert.strictEqual(REHEAT_ACTIVITY_ID, 'repull-metadata');
});

// ---- formatReheatSummary (the 202 response's blast-radius line) -----------

test('formatReheatSummary: eligible items with no ineligible ones renders a plain count (plural)', () => {
  assert.strictEqual(formatReheatSummary(5, 0), 'Re-pulling 5 items');
});

test('formatReheatSummary: exactly one eligible item uses the singular "item"', () => {
  assert.strictEqual(formatReheatSummary(1, 0), 'Re-pulling 1 item');
});

test('formatReheatSummary: eligible AND ineligible both render, with the ineligible reason spelled out', () => {
  assert.strictEqual(
    formatReheatSummary(12, 40),
    'Re-pulling 12 items · 40 not re-pullable (imported / no source id)'
  );
});

test('formatReheatSummary: eligible === 0 renders the explicit "nothing to re-pull" message, never "Re-pulling 0 items"', () => {
  const result = formatReheatSummary(0, 40);
  assert.strictEqual(
    result,
    'No re-pullable items found — only videos FileTube downloaded itself can be re-pulled.'
  );
  assert.ok(!result.includes('Re-pulling 0'));
});

test('formatReheatSummary: eligible === 0 with ineligible === 0 too (an empty library) still renders the zero-eligible message', () => {
  assert.strictEqual(
    formatReheatSummary(0, 0),
    'No re-pullable items found — only videos FileTube downloaded itself can be re-pulled.'
  );
});

test('formatReheatSummary: non-finite/negative/missing counts are clamped to 0 rather than rendering "undefined"/"NaN"', () => {
  for (const bad of [undefined, null, NaN, -3, 'five', {}]) {
    const result = formatReheatSummary(bad, bad);
    assert.ok(!result.includes('undefined'), `formatReheatSummary(${bad}) leaked "undefined": ${result}`);
    assert.ok(!result.includes('NaN'), `formatReheatSummary(${bad}) leaked "NaN": ${result}`);
  }
});

// ---- formatReheatProgressText (the live LiveEntry progress line) ----------

test('formatReheatProgressText: "running" renders done/total, and omits skipped/failed/current when they are all zero/absent', () => {
  assert.strictEqual(
    formatReheatProgressText({ state: 'running', total: 10, done: 3, skipped: 0, failed: 0, current: null }),
    'Reheating: 3 of 10 done'
  );
});

test('formatReheatProgressText: "running" appends skipped/failed/current when present', () => {
  const result = formatReheatProgressText({
    state: 'running', total: 10, done: 3, skipped: 2, failed: 1, current: 'dQw4w9WgXcQ',
  });
  assert.strictEqual(result, 'Reheating: 3 of 10 done · 2 skipped · 1 failed · current: dQw4w9WgXcQ');
});

test('formatReheatProgressText: "done" renders a terminal summary, including skipped/failed when non-zero', () => {
  assert.strictEqual(
    formatReheatProgressText({ state: 'done', total: 10, done: 7, skipped: 2, failed: 1 }),
    'Reheat done: 7 of 10 updated · 2 skipped · 1 failed'
  );
});

test('formatReheatProgressText: "done" with no skipped/failed omits those segments entirely (no stray "· 0 skipped")', () => {
  assert.strictEqual(
    formatReheatProgressText({ state: 'done', total: 5, done: 5, skipped: 0, failed: 0 }),
    'Reheat done: 5 of 5 updated'
  );
});

test('formatReheatProgressText: "cancelled" renders a partial-progress summary', () => {
  assert.strictEqual(
    formatReheatProgressText({ state: 'cancelled', total: 10, done: 4 }),
    'Reheat cancelled — 4 of 10 updated before stopping'
  );
});

test('formatReheatProgressText: "error" renders a fixed, generic failure message', () => {
  assert.strictEqual(formatReheatProgressText({ state: 'error' }), 'Reheat failed unexpectedly.');
});

test('formatReheatProgressText: a missing/malformed entry, or an idle/unrecognized state, renders "" (nothing to show)', () => {
  assert.strictEqual(formatReheatProgressText(undefined), '');
  assert.strictEqual(formatReheatProgressText(null), '');
  assert.strictEqual(formatReheatProgressText({}), '');
  assert.strictEqual(formatReheatProgressText({ state: 'idle' }), '');
  assert.strictEqual(formatReheatProgressText({ state: 'queued' }), '');
});

test('formatReheatProgressText: never leaks "undefined"/"NaN" for missing total/done/skipped/failed/current fields', () => {
  const result = formatReheatProgressText({ state: 'running' });
  assert.ok(!result.includes('undefined'));
  assert.ok(!result.includes('NaN'));
  assert.strictEqual(result, 'Reheating: 0 of 0 done');
});

// ---- applyReheatStateToControls (DOM-level, no fetch) ----------------------

test('applyReheatStateToControls: a "running" entry disables the button, un-hides Cancel, and renders progress text', () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = true;
  const elements = { button, status, cancelButton };

  applyReheatStateToControls(elements, { state: 'running', total: 10, done: 4, skipped: 0, failed: 0 });

  assert.strictEqual(button.disabled, true);
  assert.strictEqual(cancelButton.hidden, false);
  assert.strictEqual(status.textContent, 'Reheating: 4 of 10 done');
});

test('applyReheatStateToControls: a terminal ("done") entry re-enables the button and re-hides Cancel', () => {
  const button = new FakeElement('button');
  button.disabled = true;
  const status = new FakeElement('span');
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = false;
  const elements = { button, status, cancelButton };

  applyReheatStateToControls(elements, { state: 'done', total: 10, done: 10, skipped: 0, failed: 0 });

  assert.strictEqual(button.disabled, false);
  assert.strictEqual(cancelButton.hidden, true);
  assert.strictEqual(status.textContent, 'Reheat done: 10 of 10 updated');
});

test('applyReheatStateToControls: a missing/undefined entry (never polled, or the batch has since been pruned) re-enables the button, hides Cancel, and leaves any existing status text alone', () => {
  const button = new FakeElement('button');
  button.disabled = true;
  const status = new FakeElement('span');
  status.textContent = 'Re-pulling 5 items';
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = false;
  const elements = { button, status, cancelButton };

  applyReheatStateToControls(elements, undefined);

  assert.strictEqual(button.disabled, false, 'no live batch -- the button must not stay stuck disabled');
  assert.strictEqual(cancelButton.hidden, true);
  assert.strictEqual(status.textContent, 'Re-pulling 5 items', 'the prior 202 summary must not be blanked by an idle poll tick');
});

test('applyReheatStateToControls: a missing elements object (or missing sub-fields) is a safe no-op, never throws', () => {
  assert.doesNotThrow(() => applyReheatStateToControls(null, { state: 'running' }));
  assert.doesNotThrow(() => applyReheatStateToControls({}, { state: 'running' }));
  assert.doesNotThrow(() => applyReheatStateToControls({ button: new FakeElement('button') }, { state: 'running' }));
});

// ---- triggerReheat (POST /api/ytdlp/repull-metadata, injectable fetch) ----

test('triggerReheat: POSTs the correct endpoint/method, disables the button immediately, and renders the 202 eligible/ineligible summary', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const calls = [];
  const fetchImpl = (url, opts) => {
    calls.push([url, opts]);
    return Promise.resolve(fakeJsonResponse(true, 202, { started: true, eligible: 5, ineligible: 2 }));
  };

  triggerReheat(elements, fetchImpl);
  assert.strictEqual(button.disabled, true, 'must disable immediately, before the response even arrives');
  await flushMicrotasks();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], '/api/ytdlp/repull-metadata');
  assert.strictEqual(calls[0][1].method, 'POST');
  assert.strictEqual(status.textContent, formatReheatSummary(5, 2));
  assert.strictEqual(button.disabled, true, 'stays disabled after a successful 202 -- the poll re-enables it once terminal');
});

test('triggerReheat: eligible === 0 surfaces the explicit "nothing re-pullable" message on a real 202 response', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const fetchImpl = () => Promise.resolve(fakeJsonResponse(true, 202, { started: true, eligible: 0, ineligible: 40 }));

  triggerReheat(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(
    status.textContent,
    'No re-pullable items found — only videos FileTube downloaded itself can be re-pulled.'
  );
});

test('triggerReheat: a 409 alreadyRunning response is reflected as "already in progress", never treated as a failure or a second start', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  let calls = 0;
  const fetchImpl = () => {
    calls += 1;
    return Promise.resolve(fakeJsonResponse(false, 409, { started: false, alreadyRunning: true }));
  };

  triggerReheat(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(calls, 1, 'exactly one POST -- this function itself never retries/duplicates on a 409');
  assert.strictEqual(status.textContent, 'A metadata reheat is already in progress.');
});

test('triggerReheat: an unexpected non-OK response (not 409) renders a generic failure message and re-enables the button', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const fetchImpl = () => Promise.resolve(fakeJsonResponse(false, 500, {}));

  triggerReheat(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(status.textContent, 'Could not start metadata reheat.');
  assert.strictEqual(button.disabled, false, 'a genuine failure must re-enable the button so the user can retry');
});

test('triggerReheat: a network failure (fetch rejects) renders a network-error message and re-enables the button', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const fetchImpl = () => Promise.reject(new Error('offline'));

  triggerReheat(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(status.textContent, 'Could not start metadata reheat (network error).');
  assert.strictEqual(button.disabled, false);
});

test('triggerReheat: a missing elements object is a safe no-op (never throws, never calls fetch)', () => {
  let calls = 0;
  const fetchImpl = () => { calls += 1; return Promise.resolve(fakeJsonResponse(true, 202, {})); };
  assert.doesNotThrow(() => triggerReheat(null, fetchImpl));
  assert.doesNotThrow(() => triggerReheat(undefined, fetchImpl));
  assert.strictEqual(calls, 0, 'no elements to update -- must never fire the request at all');
});

test('triggerReheat: an elements object missing the status/cancelButton sub-fields tolerates them being absent (never throws)', async () => {
  const button = new FakeElement('button');
  const fetchImpl = () => Promise.resolve(fakeJsonResponse(true, 202, { started: true, eligible: 3, ineligible: 0 }));
  assert.doesNotThrow(() => triggerReheat({ button }, fetchImpl));
  await flushMicrotasks();
  assert.strictEqual(button.disabled, true);
});

// ---- triggerReheatCancel (POST /api/ytdlp/repull-metadata/cancel) ---------

test('triggerReheatCancel: POSTs the correct endpoint/method and is only meaningful while the Cancel control is visible (not hidden)', async () => {
  const status = new FakeElement('span');
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = false; // the caller only ever shows this while running (applyReheatStateToControls)
  const elements = { button: new FakeElement('button'), status, cancelButton };
  const calls = [];
  const fetchImpl = (url, opts) => {
    calls.push([url, opts]);
    return Promise.resolve(fakeJsonResponse(true, 200, { cancelled: true }));
  };

  triggerReheatCancel(elements, fetchImpl);
  assert.strictEqual(cancelButton.disabled, true, 'disabled immediately to guard against a double-click');
  await flushMicrotasks();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], '/api/ytdlp/repull-metadata/cancel');
  assert.strictEqual(calls[0][1].method, 'POST');
  assert.strictEqual(status.textContent, 'Cancelling reheat…');
  assert.strictEqual(cancelButton.disabled, false, 're-enabled once the request settles');
});

test('triggerReheatCancel: a network failure never throws and still re-enables the Cancel control', async () => {
  const cancelButton = new FakeElement('button');
  const elements = { button: new FakeElement('button'), status: new FakeElement('span'), cancelButton };
  const fetchImpl = () => Promise.reject(new Error('offline'));

  triggerReheatCancel(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(cancelButton.disabled, false);
});

// ---- v1.25.5 QoL follow-up (channel avatars, round 2): "Refresh avatars" --
// UI. Mirrors the reheat block immediately above test-for-test.

test('REFRESH_AVATARS_ACTIVITY_ID: mirrors the server\'s fixed one-shot activity key', () => {
  assert.strictEqual(REFRESH_AVATARS_ACTIVITY_ID, 'refresh-avatars');
});

// ---- formatRefreshAvatarsSummary (the 202 response's blast-radius line) ---

test('formatRefreshAvatarsSummary: a positive total renders a plain count (plural)', () => {
  assert.strictEqual(formatRefreshAvatarsSummary(5), 'Refreshing avatars for 5 subscriptions…');
});

test('formatRefreshAvatarsSummary: exactly one subscription uses the singular "subscription"', () => {
  assert.strictEqual(formatRefreshAvatarsSummary(1), 'Refreshing avatars for 1 subscription…');
});

test('formatRefreshAvatarsSummary: total === 0 renders the explicit "nothing to refresh" message, never "Refreshing avatars for 0 subscriptions"', () => {
  const result = formatRefreshAvatarsSummary(0);
  assert.strictEqual(result, 'No subscriptions to refresh avatars for.');
  assert.ok(!result.includes('Refreshing avatars for 0'));
});

test('formatRefreshAvatarsSummary: non-finite/negative/missing counts are clamped to 0 rather than rendering "undefined"/"NaN"', () => {
  for (const bad of [undefined, null, NaN, -3, 'five', {}]) {
    const result = formatRefreshAvatarsSummary(bad);
    assert.ok(!result.includes('undefined'), `formatRefreshAvatarsSummary(${bad}) leaked "undefined": ${result}`);
    assert.ok(!result.includes('NaN'), `formatRefreshAvatarsSummary(${bad}) leaked "NaN": ${result}`);
  }
});

// ---- formatRefreshAvatarsProgressText (the live LiveEntry progress line) --

test('formatRefreshAvatarsProgressText: "running" renders done/total, and omits skipped/failed/current when they are all zero/absent', () => {
  assert.strictEqual(
    formatRefreshAvatarsProgressText({ state: 'running', total: 10, done: 3, skipped: 0, failed: 0, current: null }),
    'Refreshing avatars: 3 of 10 done'
  );
});

test('formatRefreshAvatarsProgressText: "running" appends skipped/failed/current when present', () => {
  const result = formatRefreshAvatarsProgressText({
    state: 'running', total: 10, done: 3, skipped: 2, failed: 1, current: 'sub-id-123',
  });
  assert.strictEqual(result, 'Refreshing avatars: 3 of 10 done · 2 skipped · 1 failed · current: sub-id-123');
});

test('formatRefreshAvatarsProgressText: "done" renders a terminal summary, including skipped/failed when non-zero', () => {
  assert.strictEqual(
    formatRefreshAvatarsProgressText({ state: 'done', total: 10, done: 7, skipped: 2, failed: 1 }),
    'Avatar refresh done: 7 of 10 updated · 2 skipped · 1 failed'
  );
});

test('formatRefreshAvatarsProgressText: "done" with no skipped/failed omits those segments entirely (no stray "· 0 skipped")', () => {
  assert.strictEqual(
    formatRefreshAvatarsProgressText({ state: 'done', total: 5, done: 5, skipped: 0, failed: 0 }),
    'Avatar refresh done: 5 of 5 updated'
  );
});

test('formatRefreshAvatarsProgressText: "cancelled" renders a partial-progress summary', () => {
  assert.strictEqual(
    formatRefreshAvatarsProgressText({ state: 'cancelled', total: 10, done: 4 }),
    'Avatar refresh cancelled — 4 of 10 updated before stopping'
  );
});

test('formatRefreshAvatarsProgressText: "error" renders a fixed, generic failure message', () => {
  assert.strictEqual(formatRefreshAvatarsProgressText({ state: 'error' }), 'Avatar refresh failed unexpectedly.');
});

test('formatRefreshAvatarsProgressText: a missing/malformed entry, or an idle/unrecognized state, renders "" (nothing to show)', () => {
  assert.strictEqual(formatRefreshAvatarsProgressText(undefined), '');
  assert.strictEqual(formatRefreshAvatarsProgressText(null), '');
  assert.strictEqual(formatRefreshAvatarsProgressText({}), '');
  assert.strictEqual(formatRefreshAvatarsProgressText({ state: 'idle' }), '');
  assert.strictEqual(formatRefreshAvatarsProgressText({ state: 'queued' }), '');
});

// ---- applyRefreshAvatarsStateToControls (DOM-level, no fetch) -------------

test('applyRefreshAvatarsStateToControls: a "running" entry disables the button, un-hides Cancel, and renders progress text', () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = true;
  const elements = { button, status, cancelButton };

  applyRefreshAvatarsStateToControls(elements, { state: 'running', total: 10, done: 4, skipped: 0, failed: 0 });

  assert.strictEqual(button.disabled, true);
  assert.strictEqual(cancelButton.hidden, false);
  assert.strictEqual(status.textContent, 'Refreshing avatars: 4 of 10 done');
});

test('applyRefreshAvatarsStateToControls: a terminal ("done") entry re-enables the button and re-hides Cancel', () => {
  const button = new FakeElement('button');
  button.disabled = true;
  const status = new FakeElement('span');
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = false;
  const elements = { button, status, cancelButton };

  applyRefreshAvatarsStateToControls(elements, { state: 'done', total: 10, done: 10, skipped: 0, failed: 0 });

  assert.strictEqual(button.disabled, false);
  assert.strictEqual(cancelButton.hidden, true);
  assert.strictEqual(status.textContent, 'Avatar refresh done: 10 of 10 updated');
});

test('applyRefreshAvatarsStateToControls: a missing/undefined entry re-enables the button, hides Cancel, and leaves any existing status text alone', () => {
  const button = new FakeElement('button');
  button.disabled = true;
  const status = new FakeElement('span');
  status.textContent = 'Refreshing avatars for 5 subscriptions…';
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = false;
  const elements = { button, status, cancelButton };

  applyRefreshAvatarsStateToControls(elements, undefined);

  assert.strictEqual(button.disabled, false, 'no live batch -- the button must not stay stuck disabled');
  assert.strictEqual(cancelButton.hidden, true);
  assert.strictEqual(status.textContent, 'Refreshing avatars for 5 subscriptions…', 'the prior 202 summary must not be blanked by an idle poll tick');
});

test('applyRefreshAvatarsStateToControls: a missing elements object (or missing sub-fields) is a safe no-op, never throws', () => {
  assert.doesNotThrow(() => applyRefreshAvatarsStateToControls(null, { state: 'running' }));
  assert.doesNotThrow(() => applyRefreshAvatarsStateToControls({}, { state: 'running' }));
  assert.doesNotThrow(() => applyRefreshAvatarsStateToControls({ button: new FakeElement('button') }, { state: 'running' }));
});

// ---- triggerRefreshAvatars (POST /api/ytdlp/refresh-avatars, injectable ---
// fetch) ----------------------------------------------------------------

test('triggerRefreshAvatars: POSTs the correct endpoint/method, disables the button immediately, and renders the 202 total summary', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const calls = [];
  const fetchImpl = (url, opts) => {
    calls.push([url, opts]);
    return Promise.resolve(fakeJsonResponse(true, 202, { started: true, total: 5 }));
  };

  triggerRefreshAvatars(elements, fetchImpl);
  assert.strictEqual(button.disabled, true, 'must disable immediately, before the response even arrives');
  await flushMicrotasks();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], '/api/ytdlp/refresh-avatars');
  assert.strictEqual(calls[0][1].method, 'POST');
  assert.strictEqual(status.textContent, formatRefreshAvatarsSummary(5));
  assert.strictEqual(button.disabled, true, 'stays disabled after a successful 202 -- the poll re-enables it once terminal');
});

test('triggerRefreshAvatars: a 409 alreadyRunning response is reflected as "already in progress", never treated as a failure or a second start', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const fetchImpl = () => Promise.resolve(fakeJsonResponse(false, 409, { started: false, alreadyRunning: true }));

  triggerRefreshAvatars(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(status.textContent, 'An avatar refresh is already in progress.');
  // A 409 leaves the button disabled -- the very next status poll's
  // applyRefreshAvatarsStateToControls will reconcile it, exactly like the
  // reheat's own 409 handling.
});

test('triggerRefreshAvatars: an unexpected non-OK response (not 409) renders a generic failure message and re-enables the button', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const fetchImpl = () => Promise.resolve(fakeJsonResponse(false, 500, {}));

  triggerRefreshAvatars(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(status.textContent, 'Could not start avatar refresh.');
  assert.strictEqual(button.disabled, false, 'must re-enable so the user can retry');
});

test('triggerRefreshAvatars: a network failure (fetch rejects) renders a network-error message and re-enables the button', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const fetchImpl = () => Promise.reject(new Error('offline'));

  triggerRefreshAvatars(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(status.textContent, 'Could not start avatar refresh (network error).');
  assert.strictEqual(button.disabled, false);
});

test('triggerRefreshAvatars: a missing elements object is a safe no-op (never throws, never calls fetch)', () => {
  let called = false;
  const fetchImpl = () => { called = true; return Promise.resolve(fakeJsonResponse(true, 202, {})); };
  assert.doesNotThrow(() => triggerRefreshAvatars(null, fetchImpl));
  assert.strictEqual(called, false);
});

test('triggerRefreshAvatarsCancel: POSTs the correct endpoint/method and is only meaningful while the Cancel control is visible (not hidden)', async () => {
  const status = new FakeElement('span');
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = false; // the caller only ever shows this while running (applyRefreshAvatarsStateToControls)
  const elements = { button: new FakeElement('button'), status, cancelButton };
  const calls = [];
  const fetchImpl = (url, opts) => {
    calls.push([url, opts]);
    return Promise.resolve(fakeJsonResponse(true, 200, { cancelled: true }));
  };

  triggerRefreshAvatarsCancel(elements, fetchImpl);
  assert.strictEqual(cancelButton.disabled, true, 'disabled immediately to guard against a double-click');
  await flushMicrotasks();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], '/api/ytdlp/refresh-avatars/cancel');
  assert.strictEqual(calls[0][1].method, 'POST');
  assert.strictEqual(status.textContent, 'Cancelling avatar refresh…');
  assert.strictEqual(cancelButton.disabled, false, 're-enabled once the request settles');
});

test('triggerRefreshAvatarsCancel: a network failure never throws and still re-enables the Cancel control', async () => {
  const cancelButton = new FakeElement('button');
  const elements = { button: new FakeElement('button'), status: new FakeElement('span'), cancelButton };
  const fetchImpl = () => Promise.reject(new Error('offline'));

  triggerRefreshAvatarsCancel(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(cancelButton.disabled, false);
});

// ---- subscriptions.html markup: the button exists, glyph + short label ----

const SUBS_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  'utf8'
);

test('subscriptions.html: #sub-reheat-btn exists exactly once, with an icon glyph and the "Reheat metadata" label', () => {
  const matches = SUBS_HTML.match(/id="sub-reheat-btn"/g) || [];
  assert.strictEqual(matches.length, 1, 'expected #sub-reheat-btn to appear exactly once');
  const btnMatch = /<button[^>]*id="sub-reheat-btn"[^>]*>([\s\S]*?)<\/button>/.exec(SUBS_HTML);
  assert.ok(btnMatch, 'expected a well-formed <button id="sub-reheat-btn"> element');
  assert.match(btnMatch[1], /<i class="icon-[a-z-]+"><\/i>/, 'expected an icon glyph inside the button');
  assert.match(btnMatch[1], /Reheat metadata/, 'expected the short "Reheat metadata" label');
});

test('subscriptions.html: #sub-reheat-cancel-btn exists exactly once and starts hidden', () => {
  const matches = SUBS_HTML.match(/id="sub-reheat-cancel-btn"/g) || [];
  assert.strictEqual(matches.length, 1);
  const btnMatch = /<button[^>]*id="sub-reheat-cancel-btn"[^>]*>/.exec(SUBS_HTML);
  assert.ok(btnMatch);
  assert.match(btnMatch[0], /\bhidden\b/, 'the Cancel control must start hidden -- only shown while a reheat is running');
});

test('subscriptions.html: #sub-reheat-status exists exactly once', () => {
  const matches = SUBS_HTML.match(/id="sub-reheat-status"/g) || [];
  assert.strictEqual(matches.length, 1);
});

// ---- subscriptions.html markup: the "Refresh avatars" button ---------------

test('subscriptions.html: #sub-refresh-avatars-btn exists exactly once, with an icon glyph and the "Refresh avatars" label', () => {
  const matches = SUBS_HTML.match(/id="sub-refresh-avatars-btn"/g) || [];
  assert.strictEqual(matches.length, 1, 'expected #sub-refresh-avatars-btn to appear exactly once');
  const btnMatch = /<button[^>]*id="sub-refresh-avatars-btn"[^>]*>([\s\S]*?)<\/button>/.exec(SUBS_HTML);
  assert.ok(btnMatch, 'expected a well-formed <button id="sub-refresh-avatars-btn"> element');
  assert.match(btnMatch[1], /<i class="icon-[a-z-]+"><\/i>/, 'expected an icon glyph inside the button');
  assert.match(btnMatch[1], /Refresh avatars/, 'expected the short "Refresh avatars" label');
});

test('subscriptions.html: #sub-refresh-avatars-cancel-btn exists exactly once and starts hidden', () => {
  const matches = SUBS_HTML.match(/id="sub-refresh-avatars-cancel-btn"/g) || [];
  assert.strictEqual(matches.length, 1);
  const btnMatch = /<button[^>]*id="sub-refresh-avatars-cancel-btn"[^>]*>/.exec(SUBS_HTML);
  assert.ok(btnMatch);
  assert.match(btnMatch[0], /\bhidden\b/, 'the Cancel control must start hidden -- only shown while a refresh is running');
});

test('subscriptions.html: #sub-refresh-avatars-status exists exactly once', () => {
  const matches = SUBS_HTML.match(/id="sub-refresh-avatars-status"/g) || [];
  assert.strictEqual(matches.length, 1);
});
