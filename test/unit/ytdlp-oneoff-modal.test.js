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
