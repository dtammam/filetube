'use strict';

// [UNIT] lib/ytdlp/client/subscriptions.js -- the vanilla per-page controller
// for the optional yt-dlp /subscriptions page (T5, v1.21.0 T3). Requiring
// this file in Node is inert (its DOMContentLoaded wiring is guarded on
// `typeof document`, mirroring public/js/common.js), so its pure formatting
// helpers and its fetch/element-ref control appliers can be exercised
// directly here, against a minimal fake `document`/`Element` whose
// `innerHTML` setter THROWS (any innerHTML use fails loudly).
//
// UI pass S5: the page's ui.js-built DOM (rows, the settings sheet, the
// Activity panes, one-off rows, skeleton/error states) is exercised in jsdom
// with the real ui.js by test/unit/subs-sweep-s5.test.js, and the view's
// destructive paths by test/unit/subs-destructive-confirm.test.js.
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
  formatSubStatus,
  formatSubscribedDate,
  cutoffDateToInputValue,
  inputValueToCutoffDate,
  minutesInputToSeconds,
  secondsToMinutesInput,
  formatLiveStatusText,
  formatNextCheckText,
  formatRowStatusLine,
  isPartialRowStatus,
  buildFailureLines,
  buildFailureItems,
  renderFailuresInto,
  formatWarningLine,
  // v1.29.0 T6 (R1.1/R1.2/R1.5): row-level Retry-affordance gating +
  // busy-coalescing "queued behind current run" render.
  isErrorRowStatus,
  shouldShowRetryButton,
  isQueuedRepullResponse,
  pinLabelFallback,
  resolvePinLabel,
  buildFormatSelect,
  buildQualitySelect,
  buildFiletypeSelect,
  reduceFiletypeOptions,
  applyStatusUpdatesInPlace,
  createOneShotsListElement,
  // v1.26 code-review fix (F7): the one-shot list's cheap render-skip
  // signature + the container update it gates.
  computeOneShotsSignature,
  // v1.25 QoL follow-up ("reheat"): metadata+subtitle re-pull UI.
  REHEAT_ACTIVITY_ID,
  formatReheatSummary,
  formatReheatProgressText,
  applyReheatStateToControls,
  triggerReheat,
  triggerReheatCancel,
  // v1.25.5 QoL follow-up (channel avatars, round 2): "Refresh avatars" UI.
  REFRESH_AVATARS_ACTIVITY_ID,
  formatRefreshAvatarsSummary,
  formatRefreshAvatarsProgressText,
  applyRefreshAvatarsStateToControls,
  triggerRefreshAvatars,
  triggerRefreshAvatarsCancel,
  // v1.56 (Dean's bulk subscriber-count reheat): "Reheat sub counts" UI.
  REHEAT_SUBS_ACTIVITY_ID,
  formatReheatSubsSummary,
  formatReheatSubsProgressText,
  applyReheatSubsStateToControls,
  triggerReheatSubs,
  triggerReheatSubsCancel,
  formatChannelNameBackfillSummary,
  formatChannelNameBackfillProgressText,
  triggerChannelNameBackfill,
  // C5 (v1.30.0, T12): the shared avatar-precedence render helper.
  // v1.29.0 T9 (R4.1-R4.4): durable download-history section -- pure
  // formatters, createElement-only DOM builders, the terminal-transition
  // detector, and the DOM-free fetch-once/re-fetch orchestrator.
  formatHistoryOutcomeLine,
  formatHistoryFailuresLine,
  formatHistoryTimestamp,
  createHistoryListElement,
  detectNewlyTerminalRuns,
  fetchHistoryEntries,
  createHistoryRefreshController,
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
    // v1.29.0 T4 test support: a REAL (test-only) `Set`-backed classList --
    // upgraded from the old always-no-op stub so a test can assert the
    // `sub-row-status-partial` marker class was actually added/removed, not
    // just that the (side-effect-free) call didn't throw.
    this._classSet = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => this._classSet.add(n)),
      remove: (...names) => names.forEach((n) => this._classSet.delete(n)),
      contains: (name) => this._classSet.has(name),
      toggle: (name, force) => {
        const on = typeof force === 'boolean' ? force : !this._classSet.has(name);
        if (on) this._classSet.add(name); else this._classSet.delete(name);
        return on;
      },
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

  // v1.55 Track D test support: the collapsible-section assertions read the
  // persistence key back off the built node.
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
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

// Retire R3: formatSubMeta (the pre-S5 row's format/quality meta line) is deleted - sweep S5's
// row meta is one status line and nothing else called it; its four tests went with it.

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

// ---- v1.285: minutes<->seconds converters for the duration-window inputs -----

test('minutesInputToSeconds: minutes -> seconds; blank/invalid -> undefined (omit); 0 -> 0', () => {
  assert.strictEqual(minutesInputToSeconds('45'), 2700, '45 min -> 2700 s');
  assert.strictEqual(minutesInputToSeconds('75'), 4500);
  assert.strictEqual(minutesInputToSeconds('0'), 0, '0 = no bound (distinct from blank)');
  assert.strictEqual(minutesInputToSeconds(''), undefined, 'blank -> omit (unchanged)');
  assert.strictEqual(minutesInputToSeconds('   '), undefined);
  for (const bad of ['-1', '1.5', 'abc', null, undefined, {}]) {
    assert.strictEqual(minutesInputToSeconds(bad), undefined, `invalid ${JSON.stringify(bad)} -> omit`);
  }
});

test('secondsToMinutesInput: seconds -> minutes string; non-number/negative -> \'\'; rounds an odd legacy value', () => {
  assert.strictEqual(secondsToMinutesInput(2700), '45');
  assert.strictEqual(secondsToMinutesInput(0), '0');
  assert.strictEqual(secondsToMinutesInput(2730), '46', 'a legacy 45.5-min value rounds to the nearest minute (disclosed)');
  for (const bad of [undefined, null, -1, NaN, '2700']) {
    assert.strictEqual(secondsToMinutesInput(bad), '', `${JSON.stringify(bad)} -> blank`);
  }
});

test('minutes<->seconds round-trip: every whole-minute value survives unchanged', () => {
  for (const mins of ['0', '2', '10', '45', '75', '120']) {
    assert.strictEqual(secondsToMinutesInput(minutesInputToSeconds(mins)), mins);
  }
});

// The wiring (source-locked - the DOM builders are covered in jsdom by
// subs-sweep-s5.test.js; this binds that min travels through both flows as SECONDS).
test('the edit sheet + add form send minDurationSeconds in SECONDS via the minutes converter', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'client', 'subscriptions.js'), 'utf8');
  assert.match(src, /minSeconds = minutesInputToSeconds\(minField\.input\.value\);\s*if \(minSeconds !== undefined\) patch\.minDurationSeconds = minSeconds;/, 'edit PATCH carries min as seconds');
  assert.match(src, /addMinSeconds = minutesInputToSeconds\(addMinDurationInput[\s\S]{0,140}body\.minDurationSeconds = addMinSeconds;/, 'add body carries min as seconds');
  assert.match(src, /secondsToMinutesInput\(sub\.minDurationSeconds\)/, 'the edit sheet pre-fills min in minutes');
  // and the MAX field is now minutes too (converted), not raw seconds.
  assert.match(src, /secondsToMinutesInput\(sub\.maxDurationSeconds\)/, 'max pre-fills in minutes');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'), 'utf8');
  assert.match(html, /id="sub-add-minduration"/, 'the add form has a min input');
  assert.match(html, /<label class="ui-field__label" for="sub-add-maxduration">Max length \(minutes\)<\/label>/, 'the add max field is labelled minutes');
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

// ---- v1.29.0 T4 (R3a.6): partial-outcome distinct rendering ----------------

test('formatLiveStatusText: a "done" entry with outcome "partial" renders a DISTINCT label, never the bare "Done"', () => {
  const result = formatLiveStatusText({ state: 'done', percent: 100, outcome: 'partial' });
  assert.notStrictEqual(result, 'Done');
  assert.ok(typeof result === 'string' && result.trim() !== '', 'expected a non-empty distinct label');
});

test('formatLiveStatusText: a "done" entry with NO outcome field (plain success) still renders bare "Done"', () => {
  assert.strictEqual(formatLiveStatusText({ state: 'done', percent: 100 }), 'Done');
});

test('formatLiveStatusText: a "done" entry with outcome "success" (never actually set by the server, but defensively) still renders "Done"', () => {
  assert.strictEqual(formatLiveStatusText({ state: 'done', percent: 100, outcome: 'success' }), 'Done');
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

// Retire R3: formatFailuresLine (a `' | '` join of buildFailureLines with no caller outside
// these tests) is deleted with its tests; buildFailureLines keeps its own.

// ---- v1.29.0 T4 (R3a.6): buildFailureLines ALSO renders ---------------------
// ---- for a partial ("done" + outcome "partial") entry ----------------------

test('buildFailureLines: renders reasons for a partial entry (state "done", outcome "partial")', () => {
  const entry = {
    state: 'done',
    outcome: 'partial',
    failures: [{ videoId: 'vid1', title: 'My Video', reason: 'Video unavailable' }],
  };
  assert.deepEqual(buildFailureLines(entry), ['My Video: Video unavailable']);
});

test('buildFailureLines: a plain "done" entry with NO partial outcome still renders no reasons (never masks a false positive)', () => {
  const entry = { state: 'done', failures: [{ videoId: 'vid1', reason: 'stale from a prior error cycle' }] };
  assert.deepEqual(buildFailureLines(entry), []);
});

test('buildFailureLines: a stale outcome "partial" left over on a NEW active cycle (state moved past "done") never renders -- the state gate still applies', () => {
  const entry = {
    state: 'downloading',
    outcome: 'partial', // stale from the PRIOR completed cycle -- mergeEntry never clears it
    failures: [{ videoId: 'vid1', reason: 'a stale reason from the prior partial cycle' }],
  };
  assert.deepEqual(buildFailureLines(entry), []);
});

test('buildFailureLines: an error entry still renders (the pre-existing contract is unchanged)', () => {
  const entry = { state: 'error', failures: [{ videoId: 'vid1', reason: 'Video unavailable' }] };
  assert.deepEqual(buildFailureLines(entry), ['vid1: Video unavailable']);
});

// ---- v1.29.0 T4 (R3a.6): isPartialRowStatus (the sub-row-status-partial ----
// ---- marker-class predicate) ------------------------------------------------

test('isPartialRowStatus: true when the live entry is "done" with outcome "partial"', () => {
  assert.strictEqual(isPartialRowStatus({}, { state: 'done', outcome: 'partial' }), true);
});

test('isPartialRowStatus: false for a plain "done" live entry with no partial outcome', () => {
  assert.strictEqual(isPartialRowStatus({}, { state: 'done' }), false);
});

test('isPartialRowStatus: false for an active live entry even if a stale outcome "partial" lingers on it', () => {
  assert.strictEqual(isPartialRowStatus({}, { state: 'downloading', outcome: 'partial', percent: 10 }), false);
  assert.strictEqual(isPartialRowStatus({}, { state: 'error', outcome: 'partial', error: 'x' }), false);
});

test('isPartialRowStatus: no live entry -- falls back to the persisted lastStatus string starting with "partial:"', () => {
  assert.strictEqual(isPartialRowStatus({ lastStatus: 'partial: downloaded 9 new video(s), 1 failed: some reason' }, null), true);
  assert.strictEqual(isPartialRowStatus({ lastStatus: 'ok: downloaded 3 new video(s)' }, undefined), false);
  assert.strictEqual(isPartialRowStatus({ lastStatus: null }, { state: 'idle' }), false);
});

test('isPartialRowStatus: a missing/malformed sub or entry never throws', () => {
  assert.strictEqual(isPartialRowStatus(null, null), false);
  assert.strictEqual(isPartialRowStatus(undefined, undefined), false);
});

// ---- v1.29.0 T4 (R3c.1 client): formatWarningLine (cookie-missing) ---------

test('formatWarningLine: returns the fixed cookie-warning literal when entry.warning is true', () => {
  const result = formatWarningLine({ state: 'listing', warning: true });
  assert.ok(typeof result === 'string' && result.trim() !== '');
  assert.ok(result.toLowerCase().includes('cookie'));
});

test('formatWarningLine: returns "" when entry.warning is false, absent, or the entry is missing/malformed', () => {
  assert.strictEqual(formatWarningLine({ state: 'done', warning: false }), '');
  assert.strictEqual(formatWarningLine({ state: 'done' }), '');
  assert.strictEqual(formatWarningLine(null), '');
  assert.strictEqual(formatWarningLine(undefined), '');
  // "truthy but not literally === true" never trips the fixed literal -- no
  // implicit type coercion on a field this file otherwise treats strictly.
  assert.strictEqual(formatWarningLine({ warning: 'true' }), '');
  assert.strictEqual(formatWarningLine({ warning: 1 }), '');
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

// ---- v1.314: the per-channel push bell on the row ---------------------------
// Plan: docs/exec-plans/completed/2026-09-23-subscription-push-bell.md (AC9).

test('v1.314/v1.316 LOCK: the page wires onToggleBell to toggleBell, which PATCHes { pushBell: !current } and updates the row IN PLACE from the RESPONSE (never a list re-fetch, never an optimistic flip); a non-2xx is surfaced', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'client', 'subscriptions.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(src, /onToggleBell: toggleBell,/, 'the list handlers carry the bell (an unbound handler = an inert bell)');
  const start = src.indexOf('  function toggleBell(sub) {');
  assert.ok(start !== -1, 'toggleBell exists');
  const fn = src.slice(start, src.indexOf('\n  }', start));
  assert.match(fn, /method: 'PATCH'/);
  assert.match(fn, /JSON\.stringify\(\{ pushBell: !\(sub\.pushBell === true\) \}\)/, 'flips from the record\'s boolean truth');
  assert.match(fn, /if \(!res\.ok\)/, 'a 403/400 is checked, not swallowed');
  // v1.316 (B1): the refresh Dean saw WAS the list re-fetch - it must be gone.
  assert.doesNotMatch(fn, /loadSubscriptions\(/, 'B1: no list re-fetch after the PATCH (that was the page refresh)');
  assert.doesNotMatch(fn, /renderSubscriptions\(/, 'B1: no full re-render after the PATCH');
  assert.match(fn, /data\.pushBell === true/, 'the new state is read from the RESPONSE body, not the request');
  assert.match(fn, /applyBellUpdateInPlace\(rowElementsById, subId, on\)/, 'the clicked row is updated in place through the shared applier');
  assert.match(fn, /sub\.pushBell = on;/, 'the record the next tap reads is patched');
});

// ---- C5 (v1.30.0, T12): avatar render routed through the shared ----------
// `resolveAvatarSource` seam (AC7.5) -- REPLACES the old locally-
// reimplemented `hasRealChannelAvatar` presence check + inline
// `name[0].toUpperCase()` fallback tested here previously.

// ---- AC20: row tap navigation, gated on a resolved channelDir --------------

// v1.155 (Subscriptions redesign): a row tap opens the channel's settings
// panel (iOS list idiom), for EVERY row -- replacing the old onRowTap ->
// channel-playlist navigation, which moved onto the "View as Playlist" link.

// ---- a click on an inner link/button must NOT also open the panel -----------
// The channel `<a>`, the "View as Playlist" `<a>` and the inner buttons all
// live inside the row; the row handler guards closest('a')/closest('button')
// so tapping one of them never ALSO opens the settings panel.

// ---- AC21/AC22: kebab opens the settings sheet, independent of row tap ----

// ---- v1.20.0 FR-4: per-channel Playlist link (unchanged, still present) ---

// ---- v1.21.0 FR-5 (AC35): the star/pin toggle -------------------------------

// ---- data-sub-id: the poll's row-map key (v1.155) --------------------------
// Every row with a real id carries `data-sub-id` (unlike the Playlist link/
// pin toggle, this does not need a resolved channelDir). renderSubscriptions
// queries `.sub-row[data-sub-id]` to build `rowElementsById`, which the ~2.5s
// status poll (applyStatusUpdatesInPlace) reads to update each row's live
// status IN PLACE. (Before v1.155 this attribute keyed drag-to-reorder, since
// removed.) This proves the pure builder stamps that key.

// ---- SECURITY (mandatory regression test): a hostile subscription name -----

// ---- v1.24.0 A2 (T14) / v1.37.5: per-item failure items --------------------

test('buildFailureItems: structured {label,reason,videoId}, state/outcome gated, unattributed videoId is empty string', () => {
  // error state -> items; the label prefers title, then videoId, then a fallback.
  assert.deepStrictEqual(
    buildFailureItems({ state: 'error', failures: [
      { videoId: 'v1', title: 'T', reason: 'r' },
      { videoId: 'v2', reason: '' },
      { videoId: null, reason: 'x' },
    ] }),
    [
      { label: 'T', reason: 'r', videoId: 'v1' },
      { label: 'v2', reason: 'Unknown reason', videoId: 'v2' },
      { label: 'Unknown video', reason: 'x', videoId: '' },
    ],
  );
  // A non-terminal state with a stale failures array yields nothing (gated).
  assert.deepStrictEqual(buildFailureItems({ state: 'downloading', failures: [{ videoId: 'v', reason: 'stale' }] }), []);
  // A 'done' run is only surfaced when it is a partial outcome.
  assert.deepStrictEqual(buildFailureItems({ state: 'done', outcome: 'success', failures: [{ videoId: 'v', reason: 'r' }] }), []);
  assert.strictEqual(buildFailureItems({ state: 'done', outcome: 'partial', failures: [{ videoId: 'v', reason: 'r' }] }).length, 1);
});

// ---- v1.29.0 T4 (R3a.6, R3c.1 client): partial marker class + failures + ---
// ---- .sub-row-warning --------------------------------------------------------

// ---- v1.29.0 T6 (R1.1/R1.2/R1.5): Retry affordance + queued render --------

test('isErrorRowStatus: true for a live "error" entry, false for every other live state', () => {
  assert.strictEqual(isErrorRowStatus({}, { state: 'error', error: 'boom' }), true);
  assert.strictEqual(isErrorRowStatus({}, { state: 'done', percent: 100 }), false);
  assert.strictEqual(isErrorRowStatus({}, { state: 'downloading', percent: 10 }), false);
  assert.strictEqual(isErrorRowStatus({}, { state: 'queued' }), false);
});

test('isErrorRowStatus: falls back to the persisted lastStatus "error:" prefix when there is no live override', () => {
  assert.strictEqual(isErrorRowStatus({ lastStatus: 'error: yt-dlp exited with code 1' }, undefined), true);
  assert.strictEqual(isErrorRowStatus({ lastStatus: 'ok: downloaded 1 new video(s)' }, undefined), false);
  assert.strictEqual(isErrorRowStatus({ lastStatus: null }, undefined), false);
  assert.strictEqual(isErrorRowStatus(undefined, undefined), false);
});

test('isErrorRowStatus: a live override WINS even when a stale "error:" lastStatus lingers -- never double-counts a prior cycle', () => {
  assert.strictEqual(isErrorRowStatus({ lastStatus: 'error: old failure' }, { state: 'downloading', percent: 50 }), false);
});

test('shouldShowRetryButton: true for error OR partial, false for a plain success/idle row', () => {
  assert.strictEqual(shouldShowRetryButton({ lastStatus: 'error: x' }, undefined), true);
  assert.strictEqual(shouldShowRetryButton({ lastStatus: 'partial: 9 ok, 1 failed' }, undefined), true);
  assert.strictEqual(shouldShowRetryButton({ lastStatus: 'ok: downloaded 1 new video(s)' }, undefined), false);
  assert.strictEqual(shouldShowRetryButton({}, undefined), false);
});

test('isQueuedRepullResponse: true ONLY for {started:false, reason:"busy"}, false for started:true/404/null/malformed', () => {
  assert.strictEqual(isQueuedRepullResponse({ accepted: true, started: false, reason: 'busy' }), true);
  assert.strictEqual(isQueuedRepullResponse({ accepted: true, started: true }), false);
  assert.strictEqual(isQueuedRepullResponse({ accepted: true, started: false, reason: 'not-found' }), false);
  assert.strictEqual(isQueuedRepullResponse(null), false);
  assert.strictEqual(isQueuedRepullResponse(undefined), false);
  assert.strictEqual(isQueuedRepullResponse('busy'), false);
  assert.strictEqual(isQueuedRepullResponse({}), false);
});

// ---- v1.29.0 T9 (R4.1-R4.4): download-history section ----------------------

test('formatHistoryOutcomeLine: maps every known outcome to its label; an unknown/missing outcome falls back to "Unknown"', () => {
  assert.strictEqual(formatHistoryOutcomeLine({ outcome: 'success' }), 'Success');
  assert.strictEqual(formatHistoryOutcomeLine({ outcome: 'partial' }), 'Completed with some failures');
  assert.strictEqual(formatHistoryOutcomeLine({ outcome: 'error' }), 'Failed');
  assert.strictEqual(formatHistoryOutcomeLine({ outcome: 'cancelled' }), 'Cancelled');
  assert.strictEqual(formatHistoryOutcomeLine({ outcome: 'something-new' }), 'Unknown');
  assert.strictEqual(formatHistoryOutcomeLine({}), 'Unknown');
  assert.strictEqual(formatHistoryOutcomeLine(null), 'Unknown');
});

test('formatHistoryFailuresLine: renders joined "label: reason" lines for a partial or error entry', () => {
  const partial = {
    outcome: 'partial',
    failures: [
      { videoId: 'vid1', title: 'First', reason: 'reason A' },
      { videoId: 'vid2', reason: 'reason B' },
    ],
  };
  assert.strictEqual(formatHistoryFailuresLine(partial), 'First: reason A | vid2: reason B');

  const error = { outcome: 'error', failures: [{ videoId: null, reason: 'unattributed' }] };
  assert.strictEqual(formatHistoryFailuresLine(error), 'Unknown video: unattributed');
});

test('formatHistoryFailuresLine: returns "" for success/cancelled entries, or when failures is missing/malformed', () => {
  assert.strictEqual(formatHistoryFailuresLine({ outcome: 'success', failures: [{ videoId: 'x', reason: 'y' }] }), '');
  assert.strictEqual(formatHistoryFailuresLine({ outcome: 'cancelled', failures: [{ videoId: 'x', reason: 'y' }] }), '');
  assert.strictEqual(formatHistoryFailuresLine({ outcome: 'error' }), '');
  assert.strictEqual(formatHistoryFailuresLine({ outcome: 'error', failures: 'not-an-array' }), '');
  assert.strictEqual(formatHistoryFailuresLine(null), '');
  assert.strictEqual(formatHistoryFailuresLine(undefined), '');
});

test('formatHistoryTimestamp: formats a valid ISO string; falls back to "unknown time" for anything else', () => {
  const formatted = formatHistoryTimestamp('2026-01-02T03:04:05.000Z');
  assert.strictEqual(formatted, new Date('2026-01-02T03:04:05.000Z').toLocaleString());
  assert.strictEqual(formatHistoryTimestamp('not-a-date'), 'unknown time');
  assert.strictEqual(formatHistoryTimestamp(''), 'unknown time');
  assert.strictEqual(formatHistoryTimestamp(undefined), 'unknown time');
  assert.strictEqual(formatHistoryTimestamp(null), 'unknown time');
});

test('createHistoryListElement: an empty/missing entries array renders a single "No download history yet." message, no rows', () => {
  const empty = createHistoryListElement([], fakeDoc);
  assert.strictEqual(empty.children.length, 1);
  assert.strictEqual(empty.children[0].textContent, 'No download history yet.');

  const malformed = createHistoryListElement(undefined, fakeDoc);
  assert.strictEqual(malformed.children.length, 1);
  assert.strictEqual(malformed.children[0].textContent, 'No download history yet.');
});

// ---- detectNewlyTerminalRuns: pure terminal-transition edge detector ------

test('detectNewlyTerminalRuns: true when a subscription transitions from a non-terminal state into "done"', () => {
  const prev = { subscriptions: { s1: { state: 'downloading' } }, oneShots: {} };
  const next = { subscriptions: { s1: { state: 'done' } }, oneShots: {} };
  assert.strictEqual(detectNewlyTerminalRuns(prev, next), true);
});

test('detectNewlyTerminalRuns: true when a one-shot transitions into "error" or "cancelled"', () => {
  const prev = { subscriptions: {}, oneShots: { j1: { state: 'downloading' } } };
  assert.strictEqual(detectNewlyTerminalRuns(prev, { subscriptions: {}, oneShots: { j1: { state: 'error' } } }), true);
  assert.strictEqual(detectNewlyTerminalRuns(prev, { subscriptions: {}, oneShots: { j1: { state: 'cancelled' } } }), true);
});

test('detectNewlyTerminalRuns: false when a poll tick repeats an already-terminal state (no re-fire on subsequent identical polls)', () => {
  const snapshot = { subscriptions: { s1: { state: 'done' } }, oneShots: {} };
  assert.strictEqual(detectNewlyTerminalRuns(snapshot, snapshot), false);
});

test('detectNewlyTerminalRuns: false for a non-terminal-to-non-terminal transition, or an entry absent from both snapshots', () => {
  const prev = { subscriptions: { s1: { state: 'listing' } }, oneShots: {} };
  const next = { subscriptions: { s1: { state: 'downloading' } }, oneShots: {} };
  assert.strictEqual(detectNewlyTerminalRuns(prev, next), false);
  assert.strictEqual(detectNewlyTerminalRuns({ subscriptions: {}, oneShots: {} }, { subscriptions: {}, oneShots: {} }), false);
});

test('detectNewlyTerminalRuns: fires again for the SAME subscription id after it cycles back out of a terminal state and completes again (retry case)', () => {
  const idle = { subscriptions: { s1: { state: 'done' } }, oneShots: {} };
  const retrying = { subscriptions: { s1: { state: 'downloading' } }, oneShots: {} };
  const doneAgain = { subscriptions: { s1: { state: 'done' } }, oneShots: {} };
  assert.strictEqual(detectNewlyTerminalRuns(idle, retrying), false, 'leaving a terminal state is not itself a transition INTO one');
  assert.strictEqual(detectNewlyTerminalRuns(retrying, doneAgain), true, 'completing again after a retry must fire again');
});

test('detectNewlyTerminalRuns: never throws on missing/malformed snapshots', () => {
  assert.strictEqual(detectNewlyTerminalRuns(null, undefined), false);
  assert.strictEqual(detectNewlyTerminalRuns({}, {}), false);
  assert.strictEqual(detectNewlyTerminalRuns({ subscriptions: null }, { subscriptions: { s1: { state: 'done' } } }), true);
});

// ---- GF1 F3 (post-gate fix): within-one-tick terminal->terminal transition -

test('detectNewlyTerminalRuns (GF1 F3): true when a run completes entirely within one poll tick -- prev terminal from a PRIOR run, next terminal from a NEW run, with an advanced updatedAt marker and no observed intermediate state', () => {
  const prev = { subscriptions: { s1: { state: 'done', updatedAt: '2026-07-11T10:00:00.000Z' } }, oneShots: {} };
  const next = { subscriptions: { s1: { state: 'done', updatedAt: '2026-07-11T10:00:03.000Z' } }, oneShots: {} };
  assert.strictEqual(detectNewlyTerminalRuns(prev, next), true, 'a within-one-tick full cycle must still be detected via the advanced updatedAt marker');
});

test('detectNewlyTerminalRuns (GF1 F3): true for a one-shot job that completes within one poll tick too (error->error with an advanced marker)', () => {
  const prev = { subscriptions: {}, oneShots: { j1: { state: 'error', updatedAt: '2026-07-11T10:00:00.000Z' } } };
  const next = { subscriptions: {}, oneShots: { j1: { state: 'error', updatedAt: '2026-07-11T10:00:03.000Z' } } };
  assert.strictEqual(detectNewlyTerminalRuns(prev, next), true);
});

test('detectNewlyTerminalRuns (GF1 F3): false for a steady-state terminal entry whose updatedAt is UNCHANGED between polls -- no refresh storm', () => {
  const snapshot = { subscriptions: { s1: { state: 'done', updatedAt: '2026-07-11T10:00:00.000Z' } }, oneShots: {} };
  // Same value, but deliberately NOT the same object reference, to prove
  // this is a real value comparison, not an identity/reference check.
  const snapshotCopy = { subscriptions: { s1: { state: 'done', updatedAt: '2026-07-11T10:00:00.000Z' } }, oneShots: {} };
  assert.strictEqual(detectNewlyTerminalRuns(snapshot, snapshotCopy), false);
});

test('detectNewlyTerminalRuns (GF1 F3): false when both sides are terminal but updatedAt is missing/malformed on either side -- never a false positive from a malformed entry', () => {
  const withMarker = { subscriptions: { s1: { state: 'done', updatedAt: '2026-07-11T10:00:00.000Z' } }, oneShots: {} };
  const noMarker = { subscriptions: { s1: { state: 'done' } }, oneShots: {} };
  const malformedMarker = { subscriptions: { s1: { state: 'done', updatedAt: 12345 } }, oneShots: {} };
  assert.strictEqual(detectNewlyTerminalRuns(withMarker, noMarker), false);
  assert.strictEqual(detectNewlyTerminalRuns(noMarker, withMarker), false);
  assert.strictEqual(detectNewlyTerminalRuns(malformedMarker, withMarker), false);
});

test('detectNewlyTerminalRuns (GF1 F3): the pre-existing !terminal->terminal case still fires (regression lock)', () => {
  const prev = { subscriptions: { s1: { state: 'downloading', updatedAt: '2026-07-11T10:00:00.000Z' } }, oneShots: {} };
  const next = { subscriptions: { s1: { state: 'done', updatedAt: '2026-07-11T10:00:03.000Z' } }, oneShots: {} };
  assert.strictEqual(detectNewlyTerminalRuns(prev, next), true);
});

test('detectNewlyTerminalRuns (GF1 F3): the retried terminal->active->terminal case (crossing two poll ticks) still fires (regression lock)', () => {
  const idle = { subscriptions: { s1: { state: 'done', updatedAt: '2026-07-11T10:00:00.000Z' } }, oneShots: {} };
  const retrying = { subscriptions: { s1: { state: 'downloading', updatedAt: '2026-07-11T10:00:01.000Z' } }, oneShots: {} };
  const doneAgain = { subscriptions: { s1: { state: 'done', updatedAt: '2026-07-11T10:00:05.000Z' } }, oneShots: {} };
  assert.strictEqual(detectNewlyTerminalRuns(idle, retrying), false, 'leaving a terminal state is not itself a transition INTO one');
  assert.strictEqual(detectNewlyTerminalRuns(retrying, doneAgain), true, 'completing again after a retry must fire again');
});

// ---- fetchHistoryEntries / createHistoryRefreshController -----------------
// (DOM-free: an injected fake `fetch`, no real network, no document.)

test('fetchHistoryEntries: resolves to the entries array from a successful response', async () => {
  const calls = [];
  const fakeFetch = (url) => {
    calls.push(url);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ entries: [{ id: 'a' }, { id: 'b' }] }) });
  };
  const entries = await fetchHistoryEntries(fakeFetch);
  assert.deepEqual(entries, [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(calls, ['/api/subscriptions/history']);
});

test('fetchHistoryEntries: degrades to [] (never rejects) on a non-OK response, a malformed body, or a network error', async () => {
  assert.deepEqual(await fetchHistoryEntries(() => Promise.resolve({ ok: false, status: 404 })), []);
  assert.deepEqual(await fetchHistoryEntries(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })), []);
  assert.deepEqual(await fetchHistoryEntries(() => Promise.reject(new Error('network down'))), []);
});

test('fetchHistoryEntries: resolves to [] when no fetch implementation is available at all', async () => {
  assert.deepEqual(await fetchHistoryEntries(undefined), []);
});

test('createHistoryRefreshController: loadInitial always fetches once; maybeRefetchOnPoll only re-fetches on a terminal transition, and not again on the next identical poll', async () => {
  let fetchCount = 0;
  const fakeFetch = () => {
    fetchCount += 1;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ entries: [{ id: `call-${fetchCount}` }] }) });
  };
  const controller = createHistoryRefreshController(fakeFetch);

  const initial = await controller.loadInitial();
  assert.deepEqual(initial, [{ id: 'call-1' }]);
  assert.strictEqual(fetchCount, 1);

  // First poll tick: a subscription transitions into 'done' -> re-fetch.
  const transitioned = await controller.maybeRefetchOnPoll({ subscriptions: { s1: { state: 'done' } }, oneShots: {} });
  assert.deepEqual(transitioned, [{ id: 'call-2' }]);
  assert.strictEqual(fetchCount, 2);

  // Next poll tick: the SAME snapshot again (nothing newly terminal) -> no fetch.
  const repeated = await controller.maybeRefetchOnPoll({ subscriptions: { s1: { state: 'done' } }, oneShots: {} });
  assert.strictEqual(repeated, null);
  assert.strictEqual(fetchCount, 2, 'must not re-fetch on a subsequent identical poll');

  // A later, genuinely new completion (retry cycle) fires again.
  await controller.maybeRefetchOnPoll({ subscriptions: { s1: { state: 'downloading' } }, oneShots: {} });
  assert.strictEqual(fetchCount, 2, 'leaving the terminal state alone must not itself trigger a fetch');
  const refetched = await controller.maybeRefetchOnPoll({ subscriptions: { s1: { state: 'done' } }, oneShots: {} });
  assert.deepEqual(refetched, [{ id: 'call-3' }]);
  assert.strictEqual(fetchCount, 3);
});

test('createHistoryRefreshController: two independent controller instances never share state', async () => {
  const fakeFetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ entries: [] }) });
  const controllerA = createHistoryRefreshController(fakeFetch);
  const controllerB = createHistoryRefreshController(fakeFetch);

  await controllerA.maybeRefetchOnPoll({ subscriptions: { s1: { state: 'done' } }, oneShots: {} });
  // Controller B has never seen a poll yet -- its OWN first comparison
  // (against ITS empty baseline) must still evaluate independently of A.
  const bResult = await controllerB.maybeRefetchOnPoll({ subscriptions: { s1: { state: 'idle' } }, oneShots: {} });
  assert.strictEqual(bResult, null, 'an idle (non-terminal) first tick must not fetch');
});

// ---- createSubscriptionsListElement (empty state + ordering contract) -----

// ---- v1.21.0 FR-3 (AC21): the settings bottom-sheet -------------------------

// ---- v1.22.0 FR-6: max-duration download gate, settings-sheet field --------

// ---- v1.21.0 FR-1 fix (AC1/AC4/AC22): the targeted in-place poll update ----

test('renderFailuresInto: with no usable doc, falls back to the classic single joined text line (byte-identical to pre-v1.37.5)', () => {
  const container = new FakeElement('div');
  const entry = { state: 'error', failures: [
    { videoId: 'v1', title: 'One', reason: 'a' },
    { videoId: null, reason: 'b' },
  ] };
  renderFailuresInto(container, entry, null, { onSkip: () => Promise.resolve(true) }, 'sub');
  assert.strictEqual(container.hidden, false);
  assert.strictEqual(container.textContent, 'One: a | Unknown video: b');
  assert.strictEqual(container.children.length, 0, 'the fallback must never createElement');
});

// ---- v1.29.0 T4 (R3a.6, R3c.1 client): partial marker class + warning line -
// ---- refreshed IN PLACE on a poll tick --------------------------------------

test('applyStatusUpdatesInPlace: an id with no row reference, or an empty/missing rowElementsById, is a safe no-op (never throws)', () => {
  assert.doesNotThrow(() => applyStatusUpdatesInPlace({}, [{ id: 'missing' }], { subscriptions: {} }));
  assert.doesNotThrow(() => applyStatusUpdatesInPlace(null, [{ id: 'x' }], { subscriptions: {} }));
  assert.doesNotThrow(() => applyStatusUpdatesInPlace({}, null, { subscriptions: {} }));
});

// ---- FR-A/FR-E: one-shot job rows (unchanged by T3) -------------------------

test('createOneShotsListElement: renders an empty-state message when there are no one-shot jobs', () => {
  const container = createOneShotsListElement({}, fakeDoc, {});
  const texts = [...container.walk()].map((el) => el.textContent).filter(Boolean);
  assert.ok(texts.some((t) => t.includes('No one-off downloads')));
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
  assert.strictEqual(formatReheatSummary(5, 0), 'Reheating 5 items');
});

test('formatReheatSummary: exactly one eligible item uses the singular "item"', () => {
  assert.strictEqual(formatReheatSummary(1, 0), 'Reheating 1 item');
});

test('formatReheatSummary: eligible AND ineligible both render', () => {
  assert.strictEqual(
    formatReheatSummary(12, 40),
    'Reheating 12 items · 40 skipped'
  );
});

test('formatReheatSummary: eligible === 0 renders the explicit "nothing to reheat" message, never "Reheating 0 items"', () => {
  const result = formatReheatSummary(0, 40);
  assert.strictEqual(result, 'Nothing to reheat — no library items found.');
  assert.ok(!result.includes('Reheating 0'));
});

test('formatReheatSummary: eligible === 0 with ineligible === 0 too (an empty library) still renders the zero-eligible message', () => {
  assert.strictEqual(formatReheatSummary(0, 0), 'Nothing to reheat — no library items found.');
});

// v1.41.5 (MeTube-import hydration): the gate is root-agnostic now, so the
// summary must say how many of the eligible items actually go to the NETWORK
// (they carry a YouTube source id) vs. how many only get a local tag check --
// otherwise "Reheating 5,000 items" over a whole library badly overstates it.
test('formatReheatSummary: withSourceId < eligible calls out how many actually have a source link', () => {
  assert.strictEqual(
    formatReheatSummary(100, 0, 12),
    'Reheating 100 items · 12 with a source link (the rest get a local tag check) · '
    + 'one fetch each, so this can take a while — downloads and checks wait until it finishes (Cancel stops it between items)'
  );
});

test('formatReheatSummary: withSourceId === eligible says so plainly', () => {
  assert.strictEqual(
    formatReheatSummary(7, 0, 7),
    'Reheating 7 items · all with a source link · '
    + 'one fetch each, so this can take a while — downloads and checks wait until it finishes (Cancel stops it between items)'
  );
});

// Gate fix (adversarial WARNING -- scale honesty): a network-bound reheat holds
// the shared runExclusive gate, so downloads/polls queue behind it. The line
// must say so -- but ONLY when something is actually network-bound.
test('formatReheatSummary: a network-bound reheat discloses the duration + that downloads wait behind it', () => {
  const line = formatReheatSummary(500, 0, 480);
  assert.ok(line.includes('take a while'), line);
  assert.ok(line.includes('downloads and checks wait'), line);
  assert.ok(line.includes('Cancel'), line);
});

test('formatReheatSummary: withSourceId === 0 is explicit that nothing goes to the network -- and does NOT warn about blocking (nothing spawns)', () => {
  assert.strictEqual(
    formatReheatSummary(30, 0, 0),
    'Reheating 30 items · none have a source link yet (local tag check only)'
  );
});

test('formatReheatSummary: an absent withSourceId (older/stubbed server) simply omits that clause', () => {
  assert.strictEqual(formatReheatSummary(9, 2), 'Reheating 9 items · 2 skipped');
});

test('formatReheatSummary: non-finite/negative/missing counts are clamped to 0 rather than rendering "undefined"/"NaN"', () => {
  for (const bad of [undefined, null, NaN, -3, 'five', {}]) {
    const result = formatReheatSummary(bad, bad, bad);
    assert.ok(!result.includes('undefined'), `formatReheatSummary(${bad}) leaked "undefined": ${result}`);
    assert.ok(!result.includes('NaN'), `formatReheatSummary(${bad}) leaked "NaN": ${result}`);
  }
  // A garbage `withSourceId` alongside REAL counts must not render either.
  const mixed = formatReheatSummary(5, 1, NaN);
  assert.ok(!mixed.includes('undefined') && !mixed.includes('NaN'), mixed);
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

// v1.41.6 (import relocation): moves are reported ALONGSIDE the metadata
// counters, never folded into them -- a reheat that hydrated everything but
// could not move 3 files must not read as an unqualified success.
test('formatReheatProgressText: v1.41.6 relocation counters appear on both the running and done lines, and are omitted when zero/absent', () => {
  assert.strictEqual(
    formatReheatProgressText({ state: 'running', total: 10, done: 3, skipped: 0, failed: 0, moved: 2, moveFailed: 1, current: 'dQw4w9WgXcQ' }),
    'Reheating: 3 of 10 done · 2 moved into channel folders · 1 could not be moved · current: dQw4w9WgXcQ'
  );
  assert.strictEqual(
    formatReheatProgressText({ state: 'done', total: 10, done: 10, skipped: 0, failed: 0, moved: 4, moveFailed: 0 }),
    'Reheat done: 10 of 10 updated · 4 moved into channel folders'
  );
  // An older/stubbed server (or a batch with the toggle off) sends neither
  // counter -- the line must be byte-identical to the pre-v1.41.6 one.
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

test('triggerReheat: eligible === 0 surfaces the explicit "nothing to reheat" message on a real 202 response', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const fetchImpl = () => Promise.resolve(fakeJsonResponse(true, 202, { started: true, eligible: 0, ineligible: 40 }));

  triggerReheat(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(status.textContent, 'Nothing to reheat — no library items found.');
});

// v1.41.5: the 202's new `withSourceId` must actually reach the summary line --
// it is the only thing that keeps a whole-library reheat from reading as if
// every home video were about to be fetched from YouTube.
test('triggerReheat: the 202\'s withSourceId is forwarded into the rendered summary', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const fetchImpl = () => Promise.resolve(fakeJsonResponse(true, 202, {
    started: true, eligible: 120, ineligible: 0, withSourceId: 8,
  }));

  triggerReheat(elements, fetchImpl);
  await flushMicrotasks();

  assert.strictEqual(status.textContent, formatReheatSummary(120, 0, 8));
  assert.ok(status.textContent.includes('8 with a source link'), status.textContent);
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

// UI pass S5: each maintenance action is one .subs-tool (title, status line, a ui-btn
// trigger named by its aria-label, and its Cancel beside it).
function toolBlock(btnId) {
  const blocks = SUBS_HTML.split('<div class="subs-tool">').slice(1);
  const hit = blocks.filter((b) => b.includes(`id="${btnId}"`));
  assert.strictEqual(hit.length, 1, `expected #${btnId} in exactly one .subs-tool`);
  return hit[0];
}

test('subscriptions.html: #sub-reheat-btn exists exactly once, a ui-btn named "Reheat metadata and channels" in its own tool entry', () => {
  const matches = SUBS_HTML.match(/id="sub-reheat-btn"/g) || [];
  assert.strictEqual(matches.length, 1, 'expected #sub-reheat-btn to appear exactly once');
  const btnMatch = /<button[^>]*id="sub-reheat-btn"[^>]*>/.exec(SUBS_HTML);
  assert.match(btnMatch[0], /class="ui-btn ui-btn--tonal ui-btn--sm"/);
  assert.match(btnMatch[0], /aria-label="Reheat metadata and channels"/);
  const block = toolBlock('sub-reheat-btn');
  assert.match(block, /id="sub-reheat-cancel-btn"/, 'its Cancel sits beside it');
  assert.match(block, /id="sub-reheat-status"/, 'its status line sits in the same entry');
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

test('subscriptions.html: #sub-refresh-avatars-btn exists exactly once, a ui-btn named "Refresh avatars" in its own tool entry', () => {
  const matches = SUBS_HTML.match(/id="sub-refresh-avatars-btn"/g) || [];
  assert.strictEqual(matches.length, 1, 'expected #sub-refresh-avatars-btn to appear exactly once');
  const btnMatch = /<button[^>]*id="sub-refresh-avatars-btn"[^>]*>/.exec(SUBS_HTML);
  assert.match(btnMatch[0], /class="ui-btn ui-btn--tonal ui-btn--sm"/);
  assert.match(btnMatch[0], /aria-label="Refresh avatars"/);
  const block = toolBlock('sub-refresh-avatars-btn');
  assert.match(block, /id="sub-refresh-avatars-cancel-btn"/);
  assert.match(block, /id="sub-refresh-avatars-status"/);
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

// ---- v1.31 P2/P5/P6: queued-ahead text, breaker banner, version footer -----

const t31assert = require('node:assert');
const subsClient = require('../../lib/ytdlp/client/subscriptions.js');
const { test: t31test } = require('node:test');

t31test('v1.31 P5: formatLiveStatusText renders "Queued — N ahead" from queuedAhead, plain "Queued…" otherwise', () => {
  t31assert.equal(subsClient.formatLiveStatusText({ state: 'queued', queuedAhead: 3 }), 'Queued — 3 ahead');
  t31assert.equal(subsClient.formatLiveStatusText({ state: 'queued', queuedAhead: 1 }), 'Queued — 1 ahead');
  // 0 ahead = running next / already at the head -- the plain literal.
  t31assert.equal(subsClient.formatLiveStatusText({ state: 'queued', queuedAhead: 0 }), 'Queued…');
  t31assert.equal(subsClient.formatLiveStatusText({ state: 'queued' }), 'Queued…');
  // Defensive: a malformed field never breaks the render.
  t31assert.equal(subsClient.formatLiveStatusText({ state: 'queued', queuedAhead: 'lots' }), 'Queued…');
});

t31test('v1.31 P2: formatBreakerBannerText composes the honest paused/deferred/retrying line and returns "" when not tripped', () => {
  t31assert.equal(subsClient.formatBreakerBannerText(null), '');
  t31assert.equal(subsClient.formatBreakerBannerText(undefined), '');
  t31assert.equal(subsClient.formatBreakerBannerText({}), '');
  const text = subsClient.formatBreakerBannerText({
    trippedAt: '2026-07-12T10:00:00.000Z',
    consecutiveFailures: 4,
    skipped: 16,
    resumeAt: '2026-07-12T10:30:00.000Z',
  });
  t31assert.match(text, /^Downloads paused after 4 consecutive failures — 16 channels deferred; retrying at /);
  const single = subsClient.formatBreakerBannerText({ consecutiveFailures: 1, skipped: 1, resumeAt: 'not-a-date' });
  t31assert.match(single, /^Downloads paused after 1 consecutive failure — 1 channel deferred; retrying at not-a-date$/);
});

// Retire R3: formatYtdlpVersionText (the v1.31 P6 footer line; nothing renders it since the
// footer left the page) is deleted with its two tests.

t31test('v1.31 gate fix: history labels + reason lines for the tripped/requeued/dropped runlog kinds (never "Unknown")', () => {
  t31assert.equal(subsClient.formatHistoryOutcomeLine({ outcome: 'tripped' }), 'Run paused (circuit breaker)');
  t31assert.equal(subsClient.formatHistoryOutcomeLine({ outcome: 'requeued' }), 'Requeued after restart');
  t31assert.equal(subsClient.formatHistoryOutcomeLine({ outcome: 'dropped' }), 'Dropped');
  const reason = 'run paused after 4 consecutive failures; 3 channel(s) deferred; retrying at 2026-07-12T10:30:00.000Z';
  t31assert.equal(subsClient.formatHistoryFailuresLine({ outcome: 'tripped', reason }), reason);
  t31assert.equal(subsClient.formatHistoryFailuresLine({ outcome: 'requeued', reason: 'requeued after server restart' }), 'requeued after server restart');
  t31assert.equal(subsClient.formatHistoryFailuresLine({ outcome: 'dropped' }), '');
  // Pre-existing kinds keep their per-item failure semantics untouched.
  t31assert.equal(subsClient.formatHistoryFailuresLine({ outcome: 'success', reason: 'x' }), '');
});

t31test('v1.32: formatHistoryFailuresLine falls back to the run-level reason when a partial/error entry has NO per-item failures', () => {
  const reason = 'error: yt-dlp list pass timed out after 5.1m and was killed';
  t31assert.equal(subsClient.formatHistoryFailuresLine({ outcome: 'error', reason, failures: [] }), reason);
  t31assert.equal(subsClient.formatHistoryFailuresLine({ outcome: 'error', reason }), reason);
  // Per-item failures still win when present (unchanged v1.29 semantics).
  const withItems = subsClient.formatHistoryFailuresLine({
    outcome: 'error', reason, failures: [{ videoId: 'v1', reason: 'blocked' }],
  });
  t31assert.ok(withItems.includes('blocked'));
  t31assert.ok(!withItems.includes('list pass'), 'reason fallback only when item lines are empty');
});

// ---- v1.56 (Dean's bulk subscriber-count reheat): "Reheat sub counts" -----
// UI trio + markup. Mirrors the refresh-avatars block above test-for-test
// (same 202-summary/LiveEntry-progress/DOM-applier/fetch-trigger contract),
// plus the itemsUpdated videos tally that block has no equivalent of.

test('formatReheatSubsSummary: positive totals render channel counts (plural/singular); 0 renders the explicit nothing message; garbage clamps', () => {
  assert.strictEqual(formatReheatSubsSummary(5), 'Reheating subscriber counts for 5 channels…');
  assert.strictEqual(formatReheatSubsSummary(1), 'Reheating subscriber counts for 1 channel…');
  assert.strictEqual(formatReheatSubsSummary(0), 'No channels to reheat subscriber counts for.');
  for (const bad of [undefined, null, NaN, -3, 'five', {}]) {
    const result = formatReheatSubsSummary(bad);
    assert.ok(!result.includes('undefined'), `formatReheatSubsSummary(${bad}) leaked "undefined": ${result}`);
    assert.ok(!result.includes('NaN'), `formatReheatSubsSummary(${bad}) leaked "NaN": ${result}`);
  }
});

test('v1.115/v1.116: formatChannelNameBackfillSummary + progress render heal+probe copy, clamp garbage, POST the right route', () => {
  // v1.116: the summary now reflects BOTH the local heal and the online refresh.
  assert.strictEqual(formatChannelNameBackfillSummary(3), 'refreshing 3 channels online…');
  assert.strictEqual(formatChannelNameBackfillSummary(1), 'refreshing 1 channel online…');
  assert.strictEqual(formatChannelNameBackfillSummary(0, 0), 'No channels need a name refresh.');
  assert.strictEqual(formatChannelNameBackfillSummary(0, 5), 'repairing 5 channels locally…');
  assert.strictEqual(formatChannelNameBackfillSummary(2, 5), 'repairing 5 channels locally + refreshing 2 channels online…');
  for (const bad of [undefined, null, NaN, -3, 'x', {}]) {
    const r = formatChannelNameBackfillSummary(bad, bad);
    assert.ok(!r.includes('undefined') && !r.includes('NaN'), `leaked on ${bad}: ${r}`);
  }
  // Probe-phase running text.
  const running = formatChannelNameBackfillProgressText({ state: 'running', phase: 'probe', total: 5, done: 2, itemsUpdated: 8, current: 'AfterSkool' });
  assert.match(running, /2 of 5 channels done/);
  assert.match(running, /8 items updated/);
  // Heal-phase running text (no total yet).
  const healing = formatChannelNameBackfillProgressText({ state: 'running', phase: 'heal', healedItems: 12, current: 'NESTALGIA' });
  assert.match(healing, /Repairing channel identities locally/);
  assert.match(healing, /12 items fixed/);
  // Done text surfaces the local-heal channel count. "items" not "videos" (audio).
  const done = formatChannelNameBackfillProgressText({ state: 'done', total: 0, done: 0, itemsUpdated: 516, healedChannels: 8 });
  assert.match(done, /516 items updated/);
  assert.match(done, /8 channels repaired locally/);
  assert.strictEqual(formatChannelNameBackfillProgressText(null), '', 'malformed -> empty (leave last text alone)');
  // The trigger POSTs the backfill route (a fake fetch records the URL).
  let posted = null;
  triggerChannelNameBackfill({ button: {}, status: {} }, (url, opts) => { posted = { url, method: opts && opts.method }; return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ started: true, total: 3, healChannels: 8 }) }); });
  assert.deepEqual(posted, { url: '/api/ytdlp/backfill-channel-names', method: 'POST' });
});

test('formatReheatSubsProgressText: "running" renders channels done/total, and omits itemsUpdated/skipped/failed/current when zero/absent', () => {
  assert.strictEqual(
    formatReheatSubsProgressText({ state: 'running', total: 10, done: 3, skipped: 0, failed: 0, itemsUpdated: 0, current: null }),
    'Reheating sub counts: 3 of 10 channels done'
  );
});

test('formatReheatSubsProgressText: "running" appends the videos-updated tally, skipped/failed, and the current channel when present', () => {
  assert.strictEqual(
    formatReheatSubsProgressText({ state: 'running', total: 10, done: 3, skipped: 2, failed: 1, itemsUpdated: 41, current: 'UCabc' }),
    'Reheating sub counts: 3 of 10 channels done · 41 videos updated · 2 skipped · 1 failed · current: UCabc'
  );
});

test('formatReheatSubsProgressText: "done" always says how many videos were updated (0 included -- the honest outcome), skipped/failed only when non-zero', () => {
  assert.strictEqual(
    formatReheatSubsProgressText({ state: 'done', total: 10, done: 7, skipped: 2, failed: 1, itemsUpdated: 120 }),
    'Sub-count reheat done: 7 of 10 channels refreshed · 120 videos updated · 2 skipped · 1 failed'
  );
  assert.strictEqual(
    formatReheatSubsProgressText({ state: 'done', total: 5, done: 5, skipped: 0, failed: 0, itemsUpdated: 1 }),
    'Sub-count reheat done: 5 of 5 channels refreshed · 1 video updated'
  );
  assert.strictEqual(
    formatReheatSubsProgressText({ state: 'done', total: 2, done: 2, skipped: 0, failed: 0, itemsUpdated: 0 }),
    'Sub-count reheat done: 2 of 2 channels refreshed · 0 videos updated'
  );
});

test('formatReheatSubsProgressText: "cancelled"/"error" terminal wording; missing/idle entries render ""', () => {
  assert.strictEqual(
    formatReheatSubsProgressText({ state: 'cancelled', total: 10, done: 4 }),
    'Sub-count reheat cancelled — 4 of 10 channels refreshed before stopping'
  );
  assert.strictEqual(formatReheatSubsProgressText({ state: 'error' }), 'Sub-count reheat failed unexpectedly.');
  assert.strictEqual(formatReheatSubsProgressText(undefined), '');
  assert.strictEqual(formatReheatSubsProgressText(null), '');
  assert.strictEqual(formatReheatSubsProgressText({}), '');
  assert.strictEqual(formatReheatSubsProgressText({ state: 'idle' }), '');
});

test('applyReheatSubsStateToControls: "running" disables the button, swaps in Cancel (Track B in-cell swap), renders progress', () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = true;
  const elements = { button, status, cancelButton };

  applyReheatSubsStateToControls(elements, { state: 'running', total: 10, done: 4, skipped: 0, failed: 0, itemsUpdated: 0 });

  assert.strictEqual(button.disabled, true);
  assert.strictEqual(button.hidden, true, 'Track B: the trigger hides while its Cancel is shown');
  assert.strictEqual(cancelButton.hidden, false);
  assert.strictEqual(status.textContent, 'Reheating sub counts: 4 of 10 channels done');
});

test('applyReheatSubsStateToControls: a terminal ("done") entry re-enables/re-shows the button and re-hides Cancel', () => {
  const button = new FakeElement('button');
  button.disabled = true;
  button.hidden = true;
  const status = new FakeElement('span');
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = false;
  const elements = { button, status, cancelButton };

  applyReheatSubsStateToControls(elements, { state: 'done', total: 10, done: 10, skipped: 0, failed: 0, itemsUpdated: 55 });

  assert.strictEqual(button.disabled, false);
  assert.strictEqual(button.hidden, false);
  assert.strictEqual(cancelButton.hidden, true);
  assert.strictEqual(status.textContent, 'Sub-count reheat done: 10 of 10 channels refreshed · 55 videos updated');
});

test('applyReheatSubsStateToControls: a missing entry re-enables the button, hides Cancel, and leaves prior status text alone; malformed elements never throw', () => {
  const button = new FakeElement('button');
  button.disabled = true;
  const status = new FakeElement('span');
  status.textContent = 'Reheating subscriber counts for 5 channels…';
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = false;
  const elements = { button, status, cancelButton };

  applyReheatSubsStateToControls(elements, undefined);

  assert.strictEqual(button.disabled, false, 'no live batch -- the button must not stay stuck disabled');
  assert.strictEqual(cancelButton.hidden, true);
  assert.strictEqual(status.textContent, 'Reheating subscriber counts for 5 channels…', 'the prior 202 summary must not be blanked by an idle poll tick');

  assert.doesNotThrow(() => applyReheatSubsStateToControls(null, { state: 'running' }));
  assert.doesNotThrow(() => applyReheatSubsStateToControls({}, { state: 'running' }));
  assert.doesNotThrow(() => applyReheatSubsStateToControls({ button: new FakeElement('button') }, { state: 'running' }));
});

test('triggerReheatSubs: POSTs /api/ytdlp/reheat-sub-counts, disables immediately, renders the 202 summary, stays disabled (poll reconciles)', async () => {
  const button = new FakeElement('button');
  const status = new FakeElement('span');
  const elements = { button, status, cancelButton: new FakeElement('button') };
  const calls = [];
  const fetchImpl = (url, opts) => {
    calls.push([url, opts]);
    return Promise.resolve(fakeJsonResponse(true, 202, { started: true, total: 5 }));
  };

  triggerReheatSubs(elements, fetchImpl);
  assert.strictEqual(button.disabled, true, 'must disable immediately, before the response even arrives');
  await flushMicrotasks();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], '/api/ytdlp/reheat-sub-counts');
  assert.strictEqual(calls[0][1].method, 'POST');
  assert.strictEqual(status.textContent, formatReheatSubsSummary(5));
  assert.strictEqual(button.disabled, true, 'stays disabled after a successful 202 -- the poll re-enables it once terminal');
});

test('triggerReheatSubs: 409 alreadyRunning is "already in progress" (never a failure); 500 and network errors re-enable for retry', async () => {
  {
    const elements = { button: new FakeElement('button'), status: new FakeElement('span'), cancelButton: new FakeElement('button') };
    triggerReheatSubs(elements, () => Promise.resolve(fakeJsonResponse(false, 409, { started: false, alreadyRunning: true })));
    await flushMicrotasks();
    assert.strictEqual(elements.status.textContent, 'A sub-count reheat is already in progress.');
  }
  {
    const elements = { button: new FakeElement('button'), status: new FakeElement('span'), cancelButton: new FakeElement('button') };
    triggerReheatSubs(elements, () => Promise.resolve(fakeJsonResponse(false, 500, {})));
    await flushMicrotasks();
    assert.strictEqual(elements.status.textContent, 'Could not start the sub-count reheat.');
    assert.strictEqual(elements.button.disabled, false, 'must re-enable so the user can retry');
  }
  {
    const elements = { button: new FakeElement('button'), status: new FakeElement('span'), cancelButton: new FakeElement('button') };
    triggerReheatSubs(elements, () => Promise.reject(new Error('offline')));
    await flushMicrotasks();
    assert.strictEqual(elements.status.textContent, 'Could not start the sub-count reheat (network error).');
    assert.strictEqual(elements.button.disabled, false);
  }
});

test('triggerReheatSubs: a missing elements object is a safe no-op (never throws, never calls fetch)', () => {
  let called = false;
  const fetchImpl = () => { called = true; return Promise.resolve(fakeJsonResponse(true, 202, {})); };
  assert.doesNotThrow(() => triggerReheatSubs(null, fetchImpl));
  assert.strictEqual(called, false);
});

test('triggerReheatSubsCancel: POSTs the cancel endpoint, double-click-guards the Cancel control, re-enables after settle (success or network failure)', async () => {
  const status = new FakeElement('span');
  const cancelButton = new FakeElement('button');
  cancelButton.hidden = false;
  const elements = { button: new FakeElement('button'), status, cancelButton };
  const calls = [];
  const fetchImpl = (url, opts) => {
    calls.push([url, opts]);
    return Promise.resolve(fakeJsonResponse(true, 200, { cancelled: true }));
  };

  triggerReheatSubsCancel(elements, fetchImpl);
  assert.strictEqual(cancelButton.disabled, true, 'disabled immediately to guard against a double-click');
  await flushMicrotasks();

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], '/api/ytdlp/reheat-sub-counts/cancel');
  assert.strictEqual(calls[0][1].method, 'POST');
  assert.strictEqual(status.textContent, 'Cancelling sub-count reheat…');
  assert.strictEqual(cancelButton.disabled, false, 're-enabled once the request settles');

  const failingElements = { button: new FakeElement('button'), status: new FakeElement('span'), cancelButton: new FakeElement('button') };
  triggerReheatSubsCancel(failingElements, () => Promise.reject(new Error('offline')));
  await flushMicrotasks();
  assert.strictEqual(failingElements.cancelButton.disabled, false);
});

test('REHEAT_SUBS_ACTIVITY_ID matches the server module and its own fixed one-shot id', () => {
  assert.strictEqual(REHEAT_SUBS_ACTIVITY_ID, 'reheat-subs');
  assert.strictEqual(REHEAT_SUBS_ACTIVITY_ID, require('../../lib/ytdlp').REHEAT_SUBS_ACTIVITY_ID,
    'the client literal must track the server constant -- the poll looks the entry up by this exact key');
});

test('subscriptions.html: #sub-reheat-subs-btn exists exactly once, a ui-btn named "Reheat subscriber counts", its Cancel beside it', () => {
  const matches = SUBS_HTML.match(/id="sub-reheat-subs-btn"/g) || [];
  assert.strictEqual(matches.length, 1, 'expected #sub-reheat-subs-btn to appear exactly once');
  const btnMatch = /<button[^>]*id="sub-reheat-subs-btn"[^>]*>/.exec(SUBS_HTML);
  assert.match(btnMatch[0], /class="ui-btn ui-btn--tonal ui-btn--sm"/);
  assert.match(btnMatch[0], /aria-label="Reheat subscriber counts"/);
  // The v1.55 Track B contract: the trigger and its Cancel share one action cell
  // (the Cancel swaps in place of the trigger while it runs).
  const cell = /<div class="subs-tool__act">\s*<button[^>]*id="sub-reheat-subs-btn"[\s\S]*?id="sub-reheat-subs-cancel-btn"[\s\S]*?<\/div>/.exec(SUBS_HTML);
  assert.ok(cell, 'the trigger and its Cancel must share one .subs-tool__act');
});

test('subscriptions.html: #sub-reheat-subs-cancel-btn exists exactly once and starts hidden; the status span sits in the reserved status row', () => {
  const matches = SUBS_HTML.match(/id="sub-reheat-subs-cancel-btn"/g) || [];
  assert.strictEqual(matches.length, 1);
  const btnMatch = /<button[^>]*id="sub-reheat-subs-cancel-btn"[^>]*>/.exec(SUBS_HTML);
  assert.ok(btnMatch);
  assert.match(btnMatch[0], /\bhidden\b/, 'the Cancel control must start hidden -- only shown while a reheat is running');

  const statusMatches = SUBS_HTML.match(/id="sub-reheat-subs-status"/g) || [];
  assert.strictEqual(statusMatches.length, 1, 'expected exactly one status span');
  // UI pass S5: the status span lives in its tool entry's TEXT column (a line of
  // its own under the description), never in the action cell, so growing status
  // text never re-wraps the buttons (the v1.26.2 intent).
  const text = /<div class="subs-tool__text">([\s\S]*?)<\/div>\s*<div class="subs-tool__act">\s*<button[^>]*id="sub-reheat-subs-btn"/.exec(SUBS_HTML);
  assert.ok(text && /id="sub-reheat-subs-status"/.test(text[1]), 'the status span must live in the entry\'s text column');
  const statusSpanMatch = /<span id="sub-reheat-subs-status"[^>]*>/.exec(SUBS_HTML);
  assert.match(statusSpanMatch[0], /aria-live="polite"/, 'status updates must announce politely');
});
