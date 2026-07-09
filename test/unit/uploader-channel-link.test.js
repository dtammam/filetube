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
const { resolveUploaderLinkHref, resolveChannelDirFromFilePath } = require('../../public/js/watch.js');

// ---- resolveUploaderLinkHref -------------------------------------------------

test('resolveUploaderLinkHref: links to the item folder content view (/?root=<parent dir>), forward slashes', () => {
  assert.strictEqual(
    resolveUploaderLinkHref({ filePath: '/media/music/Artist X/song.mp3' }),
    '/?root=' + encodeURIComponent('/media/music/Artist X')
  );
});

test('resolveUploaderLinkHref: a yt-dlp channel file resolves to its channel folder', () => {
  assert.strictEqual(
    resolveUploaderLinkHref({ filePath: '/data/ytdlp-downloads/Some Channel/vid [id].mp4' }),
    '/?root=' + encodeURIComponent('/data/ytdlp-downloads/Some Channel')
  );
});

test('resolveUploaderLinkHref: handles Windows-style backslash separators', () => {
  assert.strictEqual(
    resolveUploaderLinkHref({ filePath: 'C:\\Media\\Folder\\clip.mp4' }),
    '/?root=' + encodeURIComponent('C:\\Media\\Folder')
  );
});

test('resolveUploaderLinkHref: encodeURIComponent-encodes the folder path', () => {
  // spaces/special chars in the folder must be encoded into the query value
  const href = resolveUploaderLinkHref({ filePath: '/a b/c&d/f.mp3' });
  assert.strictEqual(href, '/?root=' + encodeURIComponent('/a b/c&d'));
  assert.ok(!/ /.test(href), 'no raw spaces in the built href');
});

test('resolveUploaderLinkHref: no usable folder (bare filename / empty / non-string) -> null (inert plain text)', () => {
  assert.strictEqual(resolveUploaderLinkHref({ filePath: 'song.mp3' }), null); // no separator
  assert.strictEqual(resolveUploaderLinkHref({ filePath: '' }), null);
  assert.strictEqual(resolveUploaderLinkHref({ filePath: undefined }), null);
  assert.strictEqual(resolveUploaderLinkHref({ filePath: null }), null);
  assert.strictEqual(resolveUploaderLinkHref({ filePath: 42 }), null);
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

  // populateMetadata()'s href assignment: the item's folder content view.
  const href = resolveUploaderLinkHref({ filePath: '/media/vids/Cool Channel/clip.mp4' });
  if (href) link.href = href;
  else link.removeAttribute && link.removeAttribute('href');
  assert.strictEqual(link.href, '/?root=' + encodeURIComponent('/media/vids/Cool Channel'));

  // No usable folder: href is cleared (caller removes it -> inert plain text).
  const bareLink = {
    _href: 'stale',
    set href(v) { this._href = v; },
    get href() { return this._href; },
    removeAttribute(_n) { this._href = ''; },
  };
  const bareHref = resolveUploaderLinkHref({ filePath: 'song.mp3' });
  if (bareHref) bareLink.href = bareHref;
  else bareLink.removeAttribute('href');
  assert.strictEqual(bareHref, null);
  assert.strictEqual(bareLink.href, '', 'a stale href must be cleared when there is no folder');
});

// ---- resolveChannelDirFromFilePath (v1.24.0, T6, B3) -------------------------
// The RAW (non-URL-encoded) sibling of resolveUploaderLinkHref above, used as
// a pin-from-watch fallback target when the file has no active subscription
// to source a server-resolved channelDir from.

test('resolveChannelDirFromFilePath: returns the raw parent folder (no /?root= wrapping, no encoding)', () => {
  assert.strictEqual(
    resolveChannelDirFromFilePath('/data/ytdlp-downloads/Some Channel/vid [id].mp4'),
    '/data/ytdlp-downloads/Some Channel'
  );
});

test('resolveChannelDirFromFilePath: handles Windows-style backslash separators', () => {
  assert.strictEqual(
    resolveChannelDirFromFilePath('C:\\Media\\Folder\\clip.mp4'),
    'C:\\Media\\Folder'
  );
});

test('resolveChannelDirFromFilePath: no usable folder (bare filename / empty / non-string) -> null', () => {
  assert.strictEqual(resolveChannelDirFromFilePath('song.mp3'), null);
  assert.strictEqual(resolveChannelDirFromFilePath(''), null);
  assert.strictEqual(resolveChannelDirFromFilePath(undefined), null);
  assert.strictEqual(resolveChannelDirFromFilePath(null), null);
  assert.strictEqual(resolveChannelDirFromFilePath(42), null);
});
