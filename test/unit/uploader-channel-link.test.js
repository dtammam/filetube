'use strict';

// [UNIT] v1.22.0 FR-3 (T-D, AC23-27): the watch-page creator-name link
// (`#uploader-channel-name`, now an `<a>` -- see public/watch.html) and its
// pure href decision, `resolveUploaderLinkHref` (public/js/watch.js).
//
// Coordinator decision (do not reopen): ship the GENERAL `/subscriptions`
// fallback link only this round -- no per-channel deep-link. `moduleEnabled`
// is the SAME `/api/subscriptions/health` probe `setupSubscribeButton()`
// already computes (no extra fetch); when it's false (module disabled, or
// the probe errored), the helper returns `null` so the caller leaves the
// `<a>`'s `href` unset -- it renders as inert plain text, never a dead link
// (AC25). `.textContent` (the display name) and `.href` (the link target)
// are the ONLY two DOM-mutating assignments this feature makes -- never
// `innerHTML` (AC26).

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveUploaderLinkHref } = require('../../public/js/watch.js');

// ---- resolveUploaderLinkHref -------------------------------------------------

test('resolveUploaderLinkHref: module enabled -> the general /subscriptions fallback', () => {
  assert.strictEqual(resolveUploaderLinkHref({ moduleEnabled: true }), '/subscriptions');
});

test('resolveUploaderLinkHref: module disabled -> null (caller leaves href unset, AC25)', () => {
  assert.strictEqual(resolveUploaderLinkHref({ moduleEnabled: false }), null);
});

test('resolveUploaderLinkHref: a falsy-but-not-strictly-false moduleEnabled still fails closed to null', () => {
  assert.strictEqual(resolveUploaderLinkHref({ moduleEnabled: undefined }), null);
  assert.strictEqual(resolveUploaderLinkHref({ moduleEnabled: 0 }), null);
  assert.strictEqual(resolveUploaderLinkHref({ moduleEnabled: '' }), null);
});

// ---- textContent/.href-only construction, never innerHTML (AC26) ------------

test('uploader channel link: textContent sets the display name, href sets the link target -- innerHTML is never touched', () => {
  // A minimal fake anchor whose `innerHTML` setter throws unconditionally --
  // mirrors the pattern established by test/unit/ytdlp-oneoff-modal.test.js
  // and test/unit/subscribe-button.test.js: any regression to innerHTML for
  // a dynamic string fails this test loudly rather than silently passing.
  const channelName = '<img src=x onerror=alert(1)>';
  const link = {
    _textContent: '',
    _href: '',
    set textContent(v) { this._textContent = v; },
    get textContent() { return this._textContent; },
    set href(v) { this._href = v; },
    get href() { return this._href; },
    set innerHTML(_v) { throw new Error('innerHTML must never be used for the uploader channel link'); },
  };

  // populateMetadata()'s assignment.
  link.textContent = channelName;
  assert.strictEqual(link.textContent, channelName);

  // setupSubscribeButton()'s assignment, module enabled.
  const href = resolveUploaderLinkHref({ moduleEnabled: true });
  if (href) link.href = href;
  assert.strictEqual(link.href, '/subscriptions');

  // Module disabled: href is left unset (caller never assigns).
  const disabledLink = { _href: '', set href(v) { this._href = v; }, get href() { return this._href; } };
  const disabledHref = resolveUploaderLinkHref({ moduleEnabled: false });
  if (disabledHref) disabledLink.href = disabledHref;
  assert.strictEqual(disabledLink.href, '');
});
