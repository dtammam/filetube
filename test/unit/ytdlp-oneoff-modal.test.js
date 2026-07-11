'use strict';

// [UNIT] v1.15.0 item 3 -- the header one-off download button + compact
// modal's pure logic and DOM-construction, all added to public/js/common.js
// (`injectOneOffDownloadButtonIfEnabled` + its supporting pure helpers).
//
// Mirrors the two established test patterns this file's task explicitly
// points at:
//   - test/unit/ytdlp-nav-injection.test.js: the gated-injection DECISION
//     (`shouldInjectOneOffButton`) is a pure function, node:test-covered
//     directly against 200/404/5xx/missing responses -- exactly the same
//     posture as `shouldInjectSubscriptionsNav`. The actual fetch()+DOM
//     wiring in `injectOneOffDownloadButtonIfEnabled` is a thin,
//     untested-by-necessity shell around this decision (this codebase has no
//     browser/DOM harness for any per-page script), same as the existing
//     nav-link injection.
//   - test/unit/ytdlp-subscriptions-client.test.js: a purpose-built, minimal
//     fake `document`/`Element` sufficient to exercise `buildOneOffModal`'s
//     real construction path, whose `innerHTML` setter unconditionally
//     THROWS -- if any future edit ever assigned `innerHTML` with a
//     dynamic/hostile string (the live-status line, in particular), this
//     test would fail loudly rather than silently passing.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  shouldInjectOneOffButton,
  reduceOneOffFiletypeOptions,
  buildOneOffDownloadBody,
  formatOneOffStatusText,
  buildOneOffModal,
  ONEOFF_FORMAT_OPTIONS,
  ONEOFF_QUALITY_OPTIONS,
  ONEOFF_DEFAULT_QUALITY,
  ONEOFF_FILETYPE_OPTIONS,
  ONEOFF_DEFAULT_FILETYPE,
  ONEOFF_STATUS_POLL_MS,
  ONEOFF_STATUS_POLL_FAST_MS,
  ONEOFF_STATUS_POLL_MAX_MS,
  ACTIVE_ENTRY_STALE_MS,
  isFreshlyActiveEntry,
  computeOneOffPollDelayMs,
  nextOneOffPollDelayMs,
  computeOneOffProgressBar,
  decideOneOffTerminalAction,
  applyOneOffTerminalAction,
  triggerLibraryRescanAndRefresh,
} = require('../../public/js/common.js');

// ---- Minimal fake DOM (test-only, mirrors ytdlp-subscriptions-client.test.js) --

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
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  // Real-DOM-equivalent surface needed by `repopulateOneOffFiletypeSelect`'s
  // `clearOneOffChildren` helper (a `while (el.firstChild) el.removeChild(...)`
  // loop) so the format->filetype rebuild wiring can be exercised end-to-end
  // through a real `change` event, not just the pure reducer in isolation.
  get firstChild() {
    return this.children.length > 0 ? this.children[0] : null;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, handler) {
    (this._listeners[type] = this._listeners[type] || []).push(handler);
  }

  // Simulates a real DOM event dispatch: invokes every registered listener
  // for `type` with `evt` (defaulting to `{ target: this }`, mirroring an
  // un-bubbled click directly on this element).
  fire(type, evt) {
    const event = evt || { target: this };
    (this._listeners[type] || []).forEach((fn) => fn(event));
  }

  // Convenience: a plain click with no custom event target (used for buttons
  // whose handlers don't inspect `e.target`, e.g. the close/download buttons).
  click() {
    this.fire('click', { target: this });
  }

  get textContent() {
    return this._textContent;
  }

  // A real DOM's `textContent` setter never parses its argument as markup --
  // this fake mirrors that (plain string storage, no parsing).
  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }

  // Deliberately UNIMPLEMENTED as a hard failure: buildOneOffModal must never
  // assign `innerHTML` for any dynamic string (the live-status line in
  // particular). If it ever did, this setter turns that into an immediate,
  // loud test failure instead of a silently-passed XSS hole.
  set innerHTML(_value) {
    throw new Error('buildOneOffModal must never assign innerHTML -- use textContent instead');
  }

  get innerHTML() {
    throw new Error('buildOneOffModal must never read/assign innerHTML');
  }

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

// ---- shouldInjectOneOffButton: the gated-injection decision -----------------

test('shouldInjectOneOffButton: a 200 response (module enabled) injects', () => {
  assert.strictEqual(shouldInjectOneOffButton({ ok: true, status: 200 }), true);
});

test('shouldInjectOneOffButton: a 404 response (module disabled) does NOT inject', () => {
  assert.strictEqual(shouldInjectOneOffButton({ ok: false, status: 404 }), false);
});

test('shouldInjectOneOffButton: a 5xx response does NOT inject', () => {
  assert.strictEqual(shouldInjectOneOffButton({ ok: false, status: 500 }), false);
});

test('shouldInjectOneOffButton: a missing/undefined response (network failure) does NOT inject (fail closed)', () => {
  assert.strictEqual(shouldInjectOneOffButton(undefined), false);
  assert.strictEqual(shouldInjectOneOffButton(null), false);
});

// ---- Dropdown option lists (FR-B mirror) ------------------------------------

test('ONEOFF_FORMAT_OPTIONS: exactly video (default) and audio, in that order', () => {
  assert.deepStrictEqual(ONEOFF_FORMAT_OPTIONS.map((o) => o.value), ['video', 'audio']);
});

test('ONEOFF_QUALITY_OPTIONS: mirrors args.js QUALITY_ALLOWLIST, best first (the default)', () => {
  assert.deepStrictEqual(ONEOFF_QUALITY_OPTIONS, ['best', '2160p', '1440p', '1080p', '720p', '480p', '360p']);
  assert.strictEqual(ONEOFF_DEFAULT_QUALITY, 'best');
});

test('ONEOFF_FILETYPE_OPTIONS: video offers mp4/mkv/webm/default, audio offers mp3/m4a/opus/default', () => {
  assert.deepStrictEqual(ONEOFF_FILETYPE_OPTIONS.video.map((o) => o.value), ['mp4', 'mkv', 'webm', 'default']);
  assert.deepStrictEqual(ONEOFF_FILETYPE_OPTIONS.audio.map((o) => o.value), ['mp3', 'm4a', 'opus', 'default']);
  assert.deepStrictEqual(ONEOFF_DEFAULT_FILETYPE, { video: 'mp4', audio: 'mp3' });
});

test('ONEOFF_STATUS_POLL_MS: ~2.5s cadence, matching subscriptions.js\'s STATUS_POLL_BASE_MS', () => {
  assert.strictEqual(ONEOFF_STATUS_POLL_MS, 2500);
});

// ---- reduceOneOffFiletypeOptions: the format->filetype reducer -------------

test('reduceOneOffFiletypeOptions: video format with no prior value selects mp4 (the recommended default)', () => {
  const result = reduceOneOffFiletypeOptions('video', undefined);
  assert.strictEqual(result.format, 'video');
  assert.deepStrictEqual(result.options.map((o) => o.value), ['mp4', 'mkv', 'webm', 'default']);
  assert.strictEqual(result.selected, 'mp4');
});

test('reduceOneOffFiletypeOptions: a prior value that is still valid for the (unchanged) format survives', () => {
  const result = reduceOneOffFiletypeOptions('audio', 'opus');
  assert.strictEqual(result.selected, 'opus');
});

test('reduceOneOffFiletypeOptions: "default" survives a format switch (member of both allowlists)', () => {
  const result = reduceOneOffFiletypeOptions('audio', 'default');
  assert.strictEqual(result.selected, 'default');
});

test('reduceOneOffFiletypeOptions: switching format invalidates a value that only applied to the OLD format, falling back to the new default', () => {
  const result = reduceOneOffFiletypeOptions('audio', 'webm');
  assert.strictEqual(result.format, 'audio');
  assert.deepStrictEqual(result.options.map((o) => o.value), ['mp3', 'm4a', 'opus', 'default']);
  assert.strictEqual(result.selected, 'mp3');
});

test('reduceOneOffFiletypeOptions: an unrecognized format falls back to the video option set (safe default)', () => {
  const result = reduceOneOffFiletypeOptions('not-a-format', undefined);
  assert.strictEqual(result.format, 'video');
  assert.deepStrictEqual(result.options.map((o) => o.value), ['mp4', 'mkv', 'webm', 'default']);
});

// ---- buildOneOffDownloadBody: the exact POST body shape ---------------------

test('buildOneOffDownloadBody: includes filetype when defined', () => {
  const body = buildOneOffDownloadBody('https://youtu.be/dQw4w9WgXcQ', 'video', '1080p', 'mkv');
  assert.deepStrictEqual(body, { url: 'https://youtu.be/dQw4w9WgXcQ', format: 'video', quality: '1080p', filetype: 'mkv' });
});

test('buildOneOffDownloadBody: omits filetype when undefined', () => {
  const body = buildOneOffDownloadBody('https://youtu.be/dQw4w9WgXcQ', 'audio', 'best', undefined);
  assert.deepStrictEqual(body, { url: 'https://youtu.be/dQw4w9WgXcQ', format: 'audio', quality: 'best' });
  assert.strictEqual('filetype' in body, false);
});

// v1.25 QoL (T3/T5): the folder is an OPTIONAL override -- the server now
// auto-routes a one-off download into a per-channel folder by default, so
// `folder` must only ever be sent when the user actually typed one.
test('buildOneOffDownloadBody: includes a trimmed folder override when the user typed one', () => {
  const body = buildOneOffDownloadBody('https://youtu.be/dQw4w9WgXcQ', 'video', 'best', 'mp4', '  My Folder  ');
  assert.strictEqual(body.folder, 'My Folder');
});

test('buildOneOffDownloadBody: omits folder entirely when blank/whitespace-only/absent (channel-derived default applies)', () => {
  assert.strictEqual('folder' in buildOneOffDownloadBody('https://youtu.be/dQw4w9WgXcQ', 'video', 'best', 'mp4', ''), false);
  assert.strictEqual('folder' in buildOneOffDownloadBody('https://youtu.be/dQw4w9WgXcQ', 'video', 'best', 'mp4', '   '), false);
  assert.strictEqual('folder' in buildOneOffDownloadBody('https://youtu.be/dQw4w9WgXcQ', 'video', 'best', 'mp4', undefined), false);
});

// ---- formatOneOffStatusText: live status formatting + XSS inertness --------

test('formatOneOffStatusText: null/undefined/idle yield null (no live override)', () => {
  assert.strictEqual(formatOneOffStatusText(undefined), null);
  assert.strictEqual(formatOneOffStatusText(null), null);
  assert.strictEqual(formatOneOffStatusText({ state: 'idle' }), null);
});

test('formatOneOffStatusText: queued/listing/done render short fixed messages', () => {
  assert.strictEqual(formatOneOffStatusText({ state: 'queued' }), 'Queued…');
  assert.strictEqual(formatOneOffStatusText({ state: 'listing' }), 'Checking for new videos…');
  assert.strictEqual(formatOneOffStatusText({ state: 'done' }), 'Done');
});

test('formatOneOffStatusText: downloading renders title, N of M, and a rounded percent', () => {
  const result = formatOneOffStatusText({ state: 'downloading', title: 'Some Title', index: 2, total: 5, percent: 47.6 });
  assert.strictEqual(result, 'Some Title — 2 of 5 — 48%');
});

test('formatOneOffStatusText: error renders the (already-redacted) error string verbatim', () => {
  assert.strictEqual(formatOneOffStatusText({ state: 'error', error: 'error: yt-dlp exited with code 1' }), 'error: yt-dlp exited with code 1');
  assert.strictEqual(formatOneOffStatusText({ state: 'error' }), 'error');
});

// v1.24.0 A3: a NEW terminal state distinct from 'error' (see
// lib/ytdlp/index.js's cancel route) -- gets its own short fixed message,
// mirroring 'done'/'queued'/'listing' above.
test('formatOneOffStatusText: cancelled renders a short fixed "Cancelled" message', () => {
  assert.strictEqual(formatOneOffStatusText({ state: 'cancelled' }), 'Cancelled');
});

test('formatOneOffStatusText: a hostile error/title string is returned VERBATIM as plain text (XSS-inert -- this function does no DOM work at all)', () => {
  const hostileError = '<img src=x onerror=alert(1)>';
  assert.strictEqual(formatOneOffStatusText({ state: 'error', error: hostileError }), hostileError);

  const hostileTitle = '<script>window.__xss = true;</script>';
  const result = formatOneOffStatusText({ state: 'downloading', title: hostileTitle, percent: 10 });
  assert.ok(result.startsWith(hostileTitle), 'the hostile title must survive verbatim, unescaped/unparsed, as plain text');
});

// ---- BUG 1 fix: honest phase label instead of a stalled "0%" ---------------
// yt-dlp's extraction/nsig/format-negotiation and ffmpeg-merge/postprocess
// phases emit NO percent line at all -- only the short byte-transfer phase
// ever does -- so `entry.percent` sits at its initial `0` for almost the
// whole job. Rendering "— 0%" that whole time reads as "stalled". This
// section covers the phase-aware indeterminate label that replaces it.

test('formatOneOffStatusText: downloading with percent 0 and nothing else yet renders "Preparing…", never "— 0%"', () => {
  const result = formatOneOffStatusText({ state: 'downloading', percent: 0 });
  assert.strictEqual(result, 'Preparing…');
});

test('formatOneOffStatusText: downloading with no percent field at all (absent, not just 0) also renders "Preparing…"', () => {
  const result = formatOneOffStatusText({ state: 'downloading' });
  assert.strictEqual(result, 'Preparing…');
});

test('formatOneOffStatusText: a videoId-only downloading entry (yt-dlp has picked the item, no title/percent yet) renders "Downloading…"', () => {
  const result = formatOneOffStatusText({ state: 'downloading', videoId: 'dQw4w9WgXcQ', percent: 0 });
  assert.strictEqual(result, 'Downloading…');
});

test('formatOneOffStatusText: a title-only downloading entry (Destination line arrived, still no real percent) renders "Downloading…"', () => {
  const result = formatOneOffStatusText({ state: 'downloading', title: 'Some Title', percent: 0 });
  assert.strictEqual(result, 'Downloading…');
});

test('formatOneOffStatusText: the indeterminate label keeps N of M indexing when present', () => {
  const result = formatOneOffStatusText({ state: 'downloading', videoId: 'dQw4w9WgXcQ', index: 2, total: 5, percent: 0 });
  assert.strictEqual(result, 'Downloading… — 2 of 5');
});

test('formatOneOffStatusText: a REAL transfer percent (> 0) still renders the numeric "— N%" form', () => {
  assert.strictEqual(formatOneOffStatusText({ state: 'downloading', percent: 47 }), 'Downloading — 47%');
  assert.strictEqual(
    formatOneOffStatusText({ state: 'downloading', title: 'Some Title', index: 2, total: 5, percent: 47 }),
    'Some Title — 2 of 5 — 47%'
  );
});

test('formatOneOffStatusText: "done" still renders the short fixed "Done" message', () => {
  assert.strictEqual(formatOneOffStatusText({ state: 'done' }), 'Done');
});

// ---- v1.26 "real progress": phase-aware rendering --------------------------

test('formatOneOffStatusText: a "merging" phase renders "Merging…", even with a stale 100% percent', () => {
  const result = formatOneOffStatusText({ state: 'downloading', phase: 'merging', percent: 100, title: 'Some Title' });
  assert.strictEqual(result, 'Merging…');
});

test('formatOneOffStatusText: a "converting" phase renders "Converting…"', () => {
  const result = formatOneOffStatusText({ state: 'downloading', phase: 'converting', percent: 100 });
  assert.strictEqual(result, 'Converting…');
});

test('formatOneOffStatusText: a phase label keeps N of M indexing when present', () => {
  const result = formatOneOffStatusText({ state: 'downloading', phase: 'merging', index: 3, total: 12, percent: 100 });
  assert.strictEqual(result, 'Merging… — 3 of 12');
});

test('formatOneOffStatusText: an unrecognized phase value is ignored, falling through to the normal percent/label logic', () => {
  assert.strictEqual(formatOneOffStatusText({ state: 'downloading', phase: 'some-future-phase', percent: 47 }), 'Downloading — 47%');
});

test('formatOneOffStatusText: never renders "undefined" or "NaN" for any downloading shape, real or malformed', () => {
  const shapes = [
    { state: 'downloading' },
    { state: 'downloading', percent: 0 },
    { state: 'downloading', percent: null },
    { state: 'downloading', percent: NaN },
    { state: 'downloading', percent: 'not a number' },
    { state: 'downloading', videoId: 'dQw4w9WgXcQ' },
    { state: 'downloading', title: '' },
    { state: 'downloading', index: 2 }, // total missing -- no position
    { state: 'downloading', percent: 47.6 },
  ];
  for (const entry of shapes) {
    const result = formatOneOffStatusText(entry);
    assert.strictEqual(typeof result, 'string', `expected a string for ${JSON.stringify(entry)}`);
    assert.doesNotMatch(result, /undefined/, `no "undefined" in "${result}"`);
    assert.doesNotMatch(result, /NaN/, `no "NaN" in "${result}"`);
  }
});

// ---- buildOneOffModal: DOM construction -------------------------------------

test('buildOneOffModal: builds the expected structure, starts hidden, with correct default select values', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  assert.strictEqual(modal.backdrop.hidden, true, 'the modal must start hidden');
  assert.strictEqual(modal.modal.hidden, true);
  assert.strictEqual(modal.urlInput.tagName, 'INPUT');
  assert.strictEqual(modal.formatSelect.tagName, 'SELECT');
  assert.strictEqual(modal.formatSelect.value, 'video');
  assert.strictEqual(modal.qualitySelect.value, 'best');
  assert.strictEqual(modal.filetypeSelect.value, 'mp4');
  assert.strictEqual(modal.downloadBtn.textContent, 'Download');
  assert.strictEqual(modal.closeBtn.textContent, '×');

  // v1.25 QoL (T3/T5): the folder field is an OPTIONAL channel-override --
  // an INPUT with an accessible name, left blank by default (no forced
  // value, unlike the format/quality/filetype selects above).
  assert.strictEqual(modal.folderInput.tagName, 'INPUT');
  assert.ok(!modal.folderInput.value, 'folder input must start blank -- the channel-derived default applies otherwise');
  assert.strictEqual(modal.folderInput.attributes['aria-label'], 'Folder (optional — defaults to the channel)');

  // Only the known, fixed set of tags may exist anywhere in the built modal.
  const tagNames = new Set([...modal.backdrop.walk()].map((el) => el.tagName));
  for (const tag of tagNames) {
    assert.ok(['DIV', 'SPAN', 'BUTTON', 'SELECT', 'OPTION', 'INPUT'].includes(tag), `unexpected element tag in the one-off modal: ${tag}`);
  }
});

test('buildOneOffModal: Download with a blank URL does NOT call onDownload, and shows an inline error', () => {
  const calls = [];
  const modal = buildOneOffModal(fakeDoc, { onDownload: (body) => calls.push(body) });
  modal.urlInput.value = '   ';
  modal.downloadBtn.click();
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(modal.statusEl.textContent, 'Enter a video URL.');
});

test('buildOneOffModal: Download with a filled form (no folder typed) posts {url, format, quality, filetype} -- folder omitted (channel-derived default)', () => {
  const calls = [];
  const modal = buildOneOffModal(fakeDoc, { onDownload: (body) => calls.push(body) });
  modal.urlInput.value = '  https://youtu.be/dQw4w9WgXcQ  ';
  modal.qualitySelect.value = '720p';
  modal.downloadBtn.click();
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], {
    url: 'https://youtu.be/dQw4w9WgXcQ', // trimmed
    format: 'video',
    quality: '720p',
    filetype: 'mp4',
  });
});

test('buildOneOffModal: Download with a typed folder override includes the trimmed folder in the body', () => {
  const calls = [];
  const modal = buildOneOffModal(fakeDoc, { onDownload: (body) => calls.push(body) });
  modal.urlInput.value = 'https://youtu.be/dQw4w9WgXcQ';
  modal.folderInput.value = '  Custom Folder  ';
  modal.downloadBtn.click();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].folder, 'Custom Folder');
});

test('buildOneOffModal: switching the format select to audio repopulates the filetype select (reduceOneOffFiletypeOptions wiring)', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  modal.formatSelect.value = 'audio';
  modal.formatSelect.fire('change');
  assert.deepStrictEqual(modal.filetypeSelect.children.map((o) => o.value), ['mp3', 'm4a', 'opus', 'default']);
  assert.strictEqual(modal.filetypeSelect.value, 'mp3');
});

test('buildOneOffModal: the [x] close button calls onClose', () => {
  let closed = false;
  const modal = buildOneOffModal(fakeDoc, { onClose: () => { closed = true; } });
  modal.closeBtn.click();
  assert.strictEqual(closed, true);
});

// BUG 2 regression guard: the freeze this fixed left the modal showing
// "Done" (or, in principle, a stuck "error") -- the X button must still
// dismiss it either way, independent of whatever terminal status was last
// rendered.
test('buildOneOffModal: the [x] close button still dismisses after a "done" or "error" status was rendered (BUG 2 regression guard)', () => {
  let closed = false;
  const doneModal = buildOneOffModal(fakeDoc, { onClose: () => { closed = true; } });
  doneModal.setStatus({ state: 'done' });
  doneModal.closeBtn.click();
  assert.strictEqual(closed, true, 'the X button must dismiss even after a terminal "done" status was rendered');

  closed = false;
  const errorModal = buildOneOffModal(fakeDoc, { onClose: () => { closed = true; } });
  errorModal.setStatus({ state: 'error', error: 'boom' });
  errorModal.closeBtn.click();
  assert.strictEqual(closed, true, 'the X button must dismiss even after a terminal "error" status was rendered');
});

test('buildOneOffModal: clicking the backdrop itself calls onClose, but a click that bubbled from inside the modal does not', () => {
  let closeCalls = 0;
  const modal = buildOneOffModal(fakeDoc, { onClose: () => { closeCalls += 1; } });

  // A direct click on the backdrop (target === backdrop).
  modal.backdrop.fire('click', { target: modal.backdrop });
  assert.strictEqual(closeCalls, 1);

  // A click whose target is the inner modal (simulating a real click that
  // originated inside the dialog and bubbled to the backdrop listener) must
  // NOT close the modal.
  modal.backdrop.fire('click', { target: modal.modal });
  assert.strictEqual(closeCalls, 1, 'a click on the inner modal content must not close it');
});

test('buildOneOffModal: setStatus renders a hostile live entry as inert TEXT, never innerHTML (XSS regression)', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  const hostileError = '<img src=x onerror=alert(1)>';

  // Must not throw -- if setStatus ever assigned innerHTML with this string,
  // the fake's innerHTML setter above would throw and fail this test loudly.
  modal.setStatus({ state: 'error', error: hostileError });
  assert.strictEqual(modal.statusEl.textContent, hostileError);

  const hostileTitle = '<script>window.__xss2 = true;</script>';
  modal.setStatus({ state: 'downloading', title: hostileTitle, percent: 5 });
  assert.ok(modal.statusEl.textContent.startsWith(hostileTitle));

  // No <script>/<img> element must ever exist anywhere in the modal.
  const tagNames = new Set([...modal.backdrop.walk()].map((el) => el.tagName));
  assert.ok(!tagNames.has('SCRIPT'));
  assert.ok(!tagNames.has('IMG'));
});

test('buildOneOffModal: setStatus with no live entry clears the status line', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  modal.setStatus({ state: 'downloading', percent: 10 });
  assert.notStrictEqual(modal.statusEl.textContent, '');
  modal.setStatus(undefined);
  assert.strictEqual(modal.statusEl.textContent, '');
});

// ---- v1.29.0 T6 (R1.4/AC3.4): modal error-state Retry control -------------
// `decideOneOffTerminalAction` leaves the modal OPEN on a non-'done' (error)
// entry -- until this task there was no Retry control in that error UI at
// all. `buildOneShotRetryBody` (public/js/common.js) is the SAME body
// builder the chip's own `retryOneShot` already uses; the live wiring
// (`injectOneOffDownloadButtonIfEnabled`) re-POSTs `/api/ytdlp/download`
// through it -- that deep fetch wiring is untested-by-necessity (this file's
// header comment), same posture as `onDownload`'s own fetch chain, so these
// tests exercise the DOM-level contract `buildOneOffModal` itself owns: the
// button's visibility gate and that it hands the LAST entry `setStatus`
// rendered to the injected `onRetry` handler.

test('buildOneOffModal: the Retry button is hidden by default and after a non-error status', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  assert.strictEqual(modal.retryBtn.hidden, true, 'hidden before any status is ever rendered');
  modal.setStatus({ state: 'queued' });
  assert.strictEqual(modal.retryBtn.hidden, true);
  modal.setStatus({ state: 'downloading', percent: 10 });
  assert.strictEqual(modal.retryBtn.hidden, true);
  modal.setStatus({ state: 'done' });
  assert.strictEqual(modal.retryBtn.hidden, true);
});

test('buildOneOffModal: the Retry button becomes visible ONLY while the entry is in its error state', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  modal.setStatus({ state: 'error', error: 'boom' });
  assert.strictEqual(modal.retryBtn.hidden, false);
  assert.strictEqual(modal.retryBtn.textContent, 'Retry');
  // A fresh job reusing this SAME modal instance (Retry/Download both start
  // a new job through it) must hide it again once state moves on.
  modal.setStatus({ state: 'queued' });
  assert.strictEqual(modal.retryBtn.hidden, true);
});

test('buildOneOffModal: clicking Retry calls h.onRetry with the LAST entry setStatus rendered', () => {
  const calls = [];
  const modal = buildOneOffModal(fakeDoc, { onRetry: (entry) => calls.push(entry) });
  const errorEntry = { state: 'error', error: 'boom', url: 'https://youtu.be/dQw4w9WgXcQ', format: 'video', quality: '720p' };
  modal.setStatus(errorEntry);
  modal.retryBtn.click();
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], errorEntry);
});

test('buildOneOffModal: clicking Retry with no h.onRetry handler is a safe no-op (never throws)', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  modal.setStatus({ state: 'error', error: 'boom' });
  assert.doesNotThrow(() => modal.retryBtn.click());
});

// ---- BUG 2 fix: 'done' no longer triggers a full-page reload ---------------
// Root cause: `pollStatusOnce`'s terminal branch used to call
// `triggerLibraryRescanAndRefresh()` (`POST /api/scan` -> a real
// `window.location.reload()`) on 'done'. Under load, `POST /api/scan`
// resolves near-instantly with a 409 (a scan is already running), so the
// reload fired immediately -- and a `window.location.reload()` against an
// already-saturated server could hang mid-navigation, freezing the whole
// page (the "Done" modal stayed painted, its own already-scheduled
// auto-close timer never fired, and even the [x] button went inert). The
// server already rescans after `runOneShot` completes, so the client-side
// rescan+reload was always redundant. `decideOneOffTerminalAction` no
// longer requests a rescan on 'done' at all, and `applyOneOffTerminalAction`
// (the small function `pollStatusOnce` now delegates to) runs the close
// independently of any refresh work either way.

test('decideOneOffTerminalAction: "done" no longer requests a rescan/reload (BUG 2 fix) -- still closes after a brief pause', () => {
  const action = decideOneOffTerminalAction({ state: 'done' });
  assert.strictEqual(action.close, true);
  assert.ok(action.closeDelayMs > 0, 'the user should still see the "Done" status before the modal disappears');
  assert.strictEqual(action.rescan, false, 'a rescan/reload must never be requested on "done" -- see BUG 2 fix');
});

test('decideOneOffTerminalAction: "error" still stays open and never rescans', () => {
  const action = decideOneOffTerminalAction({ state: 'error', error: 'boom' });
  assert.strictEqual(action.close, false);
  assert.strictEqual(action.rescan, false);
});

test('applyOneOffTerminalAction: on a "done" action, the injected close runs but the injected refresh never does', () => {
  const calls = [];
  const action = decideOneOffTerminalAction({ state: 'done' });
  applyOneOffTerminalAction(action, () => calls.push('close'), () => calls.push('refresh'), (fn) => fn());
  assert.deepStrictEqual(calls, ['close'], 'refresh must never run on a "done" action -- only close');
});

test('applyOneOffTerminalAction: composed with triggerLibraryRescanAndRefresh as the refresh fn, the injected reloadFn is NEVER invoked on "done" (no full-page reload)', () => {
  let reloaded = false;
  const fakeFetch = () => Promise.resolve({ ok: true });
  const action = decideOneOffTerminalAction({ state: 'done' });
  applyOneOffTerminalAction(
    action,
    () => {},
    () => triggerLibraryRescanAndRefresh(fakeFetch, () => { reloaded = true; }),
    (fn) => fn()
  );
  assert.strictEqual(reloaded, false, 'a "done" action must never reach window.location.reload()');
});

test('applyOneOffTerminalAction: an "error" action (close: false) invokes neither close nor refresh', () => {
  const calls = [];
  const action = decideOneOffTerminalAction({ state: 'error', error: 'boom' });
  applyOneOffTerminalAction(action, () => calls.push('close'), () => calls.push('refresh'), (fn) => fn());
  assert.deepStrictEqual(calls, []);
});

test('applyOneOffTerminalAction: close is scheduled through the injected scheduleFn using action.closeDelayMs, not called eagerly', () => {
  const scheduled = [];
  const action = decideOneOffTerminalAction({ state: 'done' });
  applyOneOffTerminalAction(action, () => {}, () => {}, (fn, delay) => scheduled.push(delay));
  assert.deepStrictEqual(scheduled, [1200]);
});

test('applyOneOffTerminalAction: a null/undefined action is a safe no-op', () => {
  assert.doesNotThrow(() => applyOneOffTerminalAction(null, () => { throw new Error('must not run'); }));
  assert.doesNotThrow(() => applyOneOffTerminalAction(undefined, () => { throw new Error('must not run'); }));
});

// ---- v1.26 "real progress": adaptive poll cadence --------------------------

test('computeOneOffPollDelayMs: ~700ms while a job is genuinely and RECENTLY "downloading"', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  const fresh = new Date(nowMs - 1000).toISOString();
  assert.strictEqual(computeOneOffPollDelayMs({ state: 'downloading', updatedAt: fresh }, nowMs), ONEOFF_STATUS_POLL_FAST_MS);
  assert.strictEqual(ONEOFF_STATUS_POLL_FAST_MS, 700);
});

test('computeOneOffPollDelayMs: the base ~2.5s cadence for every other state, and for no entry at all', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  const fresh = new Date(nowMs - 1000).toISOString();
  assert.strictEqual(computeOneOffPollDelayMs({ state: 'queued', updatedAt: fresh }, nowMs), ONEOFF_STATUS_POLL_MS);
  assert.strictEqual(computeOneOffPollDelayMs({ state: 'listing', updatedAt: fresh }, nowMs), ONEOFF_STATUS_POLL_MS);
  assert.strictEqual(computeOneOffPollDelayMs({ state: 'done', updatedAt: fresh }, nowMs), ONEOFF_STATUS_POLL_MS);
  assert.strictEqual(computeOneOffPollDelayMs(null, nowMs), ONEOFF_STATUS_POLL_MS);
  assert.strictEqual(computeOneOffPollDelayMs(undefined, nowMs), ONEOFF_STATUS_POLL_MS);
});

// ---- v1.26 code-review fix (F4): staleness gate ----------------------------

test('isFreshlyActiveEntry: true only for a "downloading" entry whose updatedAt is within ACTIVE_ENTRY_STALE_MS', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  assert.strictEqual(ACTIVE_ENTRY_STALE_MS, 10000);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading', updatedAt: new Date(nowMs - 1).toISOString() }, nowMs), true);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading', updatedAt: new Date(nowMs - 9999).toISOString() }, nowMs), true);
});

test('isFreshlyActiveEntry: F4 -- a "downloading" entry with a STALE updatedAt (a wedged download) is not active', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading', updatedAt: new Date(nowMs - 10000).toISOString() }, nowMs), false);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading', updatedAt: new Date(nowMs - 3600000).toISOString() }, nowMs), false, 'a download wedged for an hour must never be treated as active');
});

test('isFreshlyActiveEntry: F4 -- a missing/unparseable updatedAt is treated as NOT fresh, never throws', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading' }, nowMs), false);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading', updatedAt: 'garbage' }, nowMs), false);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'downloading', updatedAt: null }, nowMs), false);
  assert.doesNotThrow(() => isFreshlyActiveEntry(null, nowMs));
  assert.doesNotThrow(() => isFreshlyActiveEntry(undefined, nowMs));
  assert.strictEqual(isFreshlyActiveEntry(null, nowMs), false);
});

test('isFreshlyActiveEntry: false for a non-"downloading" state regardless of updatedAt freshness', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  const fresh = new Date(nowMs - 1).toISOString();
  assert.strictEqual(isFreshlyActiveEntry({ state: 'queued', updatedAt: fresh }, nowMs), false);
  assert.strictEqual(isFreshlyActiveEntry({ state: 'done', updatedAt: fresh }, nowMs), false);
});

// ---- v1.26 code-review fix (F5): failure backoff, floored at the base ------
// cadence ---------------------------------------------------------------------

test('nextOneOffPollDelayMs: success delegates straight to computeOneOffPollDelayMs (fast/base, staleness-aware)', () => {
  const nowMs = Date.UTC(2026, 6, 10, 12, 0, 0);
  const fresh = new Date(nowMs - 1).toISOString();
  assert.strictEqual(nextOneOffPollDelayMs(ONEOFF_STATUS_POLL_MS, true, { state: 'downloading', updatedAt: fresh }, nowMs), ONEOFF_STATUS_POLL_FAST_MS);
  assert.strictEqual(nextOneOffPollDelayMs(ONEOFF_STATUS_POLL_MS, true, { state: 'queued' }, nowMs), ONEOFF_STATUS_POLL_MS);
});

test('nextOneOffPollDelayMs: failure doubles the previous delay, capped at ONEOFF_STATUS_POLL_MAX_MS', () => {
  assert.strictEqual(ONEOFF_STATUS_POLL_MAX_MS, 30000);
  assert.strictEqual(nextOneOffPollDelayMs(ONEOFF_STATUS_POLL_MS, false), ONEOFF_STATUS_POLL_MS * 2);
  assert.strictEqual(nextOneOffPollDelayMs(25000, false), 30000);
  assert.strictEqual(nextOneOffPollDelayMs(30000, false), 30000);
});

test('nextOneOffPollDelayMs: F5 -- a failure right after a fast (~700ms) success backs off from the BASE cadence, not from 700ms', () => {
  // Pre-fix, this would have doubled the raw 700ms fast-cadence value to
  // 1400ms -- a FASTER retry than this backoff's own original first retry
  // ever was (ONEOFF_STATUS_POLL_MS * 2 = 5000ms).
  assert.strictEqual(
    nextOneOffPollDelayMs(ONEOFF_STATUS_POLL_FAST_MS, false),
    ONEOFF_STATUS_POLL_MS * 2,
    'a failure must never retry faster than doubling the BASE cadence, even if the previous delay was the fast 700ms tick',
  );
});

test('nextOneOffPollDelayMs: falls back to the base delay for an invalid previous value on failure', () => {
  assert.strictEqual(nextOneOffPollDelayMs(undefined, false), ONEOFF_STATUS_POLL_MS * 2);
  assert.strictEqual(nextOneOffPollDelayMs(-5, false), ONEOFF_STATUS_POLL_MS * 2);
});

// ---- v1.26 "real progress": computeOneOffProgressBar reducer ---------------

test('computeOneOffProgressBar: hidden for no entry, an idle/unrecognized state, or a terminal state', () => {
  assert.deepStrictEqual(computeOneOffProgressBar(null), { visible: false, indeterminate: false, percent: 0 });
  assert.deepStrictEqual(computeOneOffProgressBar(undefined), { visible: false, indeterminate: false, percent: 0 });
  assert.strictEqual(computeOneOffProgressBar({ state: 'idle' }).visible, false);
  assert.strictEqual(computeOneOffProgressBar({ state: 'done' }).visible, false);
  assert.strictEqual(computeOneOffProgressBar({ state: 'error' }).visible, false);
  assert.strictEqual(computeOneOffProgressBar({ state: 'cancelled' }).visible, false);
});

test('computeOneOffProgressBar: visible + indeterminate for queued/listing (no percent exists yet)', () => {
  assert.deepStrictEqual(computeOneOffProgressBar({ state: 'queued' }), { visible: true, indeterminate: true, percent: 0 });
  assert.deepStrictEqual(computeOneOffProgressBar({ state: 'listing' }), { visible: true, indeterminate: true, percent: 0 });
});

test('computeOneOffProgressBar: visible + indeterminate while downloading with no real percent yet', () => {
  assert.deepStrictEqual(computeOneOffProgressBar({ state: 'downloading' }), { visible: true, indeterminate: true, percent: 0 });
  assert.deepStrictEqual(computeOneOffProgressBar({ state: 'downloading', percent: 0 }), { visible: true, indeterminate: true, percent: 0 });
});

test('computeOneOffProgressBar: visible + determinate with the real, rounded/clamped percent once real transfer progress exists', () => {
  assert.deepStrictEqual(computeOneOffProgressBar({ state: 'downloading', percent: 47.6 }), { visible: true, indeterminate: false, percent: 48 });
  assert.deepStrictEqual(computeOneOffProgressBar({ state: 'downloading', percent: 150 }), { visible: true, indeterminate: false, percent: 100 });
});

test('computeOneOffProgressBar: a "merging"/"converting" phase is indeterminate even with a stale 100% percent (phase wins)', () => {
  assert.deepStrictEqual(
    computeOneOffProgressBar({ state: 'downloading', phase: 'merging', percent: 100 }),
    { visible: true, indeterminate: true, percent: 0 }
  );
  assert.deepStrictEqual(
    computeOneOffProgressBar({ state: 'downloading', phase: 'converting', percent: 100 }),
    { visible: true, indeterminate: true, percent: 0 }
  );
});

// ---- buildOneOffModal: the live progress bar -------------------------------

test('buildOneOffModal: the progress bar track starts hidden', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  assert.strictEqual(modal.progressTrack.hidden, true);
});

test('buildOneOffModal: setStatus shows the bar at the real percent width once transfer progress is real', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  modal.setStatus({ state: 'downloading', percent: 47 });
  assert.strictEqual(modal.progressTrack.hidden, false);
  assert.strictEqual(modal.progressFill.style.width, '47%');
  assert.strictEqual(modal.progressFill.className, 'dl-status-chip-progress-fill');
});

test('buildOneOffModal: setStatus marks the bar indeterminate (full-width, .indeterminate class) while queued/no real percent/postprocessing', () => {
  const modal = buildOneOffModal(fakeDoc, {});

  modal.setStatus({ state: 'queued' });
  assert.strictEqual(modal.progressTrack.hidden, false);
  assert.strictEqual(modal.progressFill.style.width, '100%');
  assert.match(modal.progressFill.className, /\bindeterminate\b/);

  modal.setStatus({ state: 'downloading', phase: 'merging', percent: 100 });
  assert.strictEqual(modal.progressTrack.hidden, false);
  assert.strictEqual(modal.progressFill.style.width, '100%');
  assert.match(modal.progressFill.className, /\bindeterminate\b/);
});

test('buildOneOffModal: setStatus hides the bar again once the job reaches a terminal state', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  modal.setStatus({ state: 'downloading', percent: 47 });
  assert.strictEqual(modal.progressTrack.hidden, false);
  modal.setStatus({ state: 'done' });
  assert.strictEqual(modal.progressTrack.hidden, true);
});

test('buildOneOffModal: setStatus(null) (no job) hides the bar', () => {
  const modal = buildOneOffModal(fakeDoc, {});
  modal.setStatus({ state: 'downloading', percent: 47 });
  modal.setStatus(null);
  assert.strictEqual(modal.progressTrack.hidden, true);
});

// ---- Static-source regression guard: no innerHTML in the new builder -------

test('buildOneOffModal source contains no innerHTML assignment (static regression guard, scoped to the new function only)', () => {
  // Scoped to buildOneOffModal's own source (via Function#toString) rather
  // than the whole common.js file, since common.js's pre-existing
  // showConfirmModal helper (unrelated to this task) already uses innerHTML
  // for admin-composed literal strings -- this guard is specifically about
  // the NEW one-off modal code this task adds. Comments are stripped first
  // (mirroring the served-bundle check in
  // test/integration/ytdlp-ui-routes.test.js) so a mention of "innerHTML" in
  // an explanatory `//` comment doesn't trip a false positive -- only a LIVE
  // `.innerHTML =` assignment must never appear.
  const stripComments = (src) => src.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(stripComments(buildOneOffModal.toString()), /\.innerHTML\s*=/, 'buildOneOffModal must never assign innerHTML');
  assert.doesNotMatch(stripComments(formatOneOffStatusText.toString()), /\.innerHTML\s*=/);
});
