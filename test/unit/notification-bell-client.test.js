'use strict';

// [UNIT] v1.51 - the notification bell's pure client decisions
// (public/js/common.js): the capability-probe predicate, the badge label
// formatter, and the server-row -> render-model mapper. The DOM injector
// itself is the usual untested-by-necessity thin shell (no browser harness
// in this repo); the integration suite + Dean's device probes cover it.
//
// Fixture spellings are divergent (v1.41.9): nothing below matches a default
// the code could invent.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  shouldInjectNotificationBell,
  formatNotificationBadge,
  buildNotificationRowModel,
  describePushEnableOutcome,
} = require('../../public/js/common.js');

test('shouldInjectNotificationBell: ONLY a genuine 2xx injects (the fail-closed probe)', () => {
  assert.equal(shouldInjectNotificationBell({ ok: true }), true);
  assert.equal(shouldInjectNotificationBell({ ok: false, status: 404 }), false, 'disabled instance (404) injects nothing');
  assert.equal(shouldInjectNotificationBell({ ok: false, status: 500 }), false);
  assert.equal(shouldInjectNotificationBell(null), false);
  assert.equal(shouldInjectNotificationBell(undefined), false);
  assert.equal(shouldInjectNotificationBell({ ok: 'true' }), false, 'a truthy non-boolean ok is not a 2xx');
});

test('formatNotificationBadge: empty string at zero/garbage (never a literal "0"), 20+ cap', () => {
  assert.equal(formatNotificationBadge(0), '');
  assert.equal(formatNotificationBadge(-3), '');
  assert.equal(formatNotificationBadge(NaN), '');
  assert.equal(formatNotificationBadge('7'), '', 'a numeric STRING is not a count');
  assert.equal(formatNotificationBadge(1.5), '');
  assert.equal(formatNotificationBadge(undefined), '');
  assert.equal(formatNotificationBadge(1), '1');
  assert.equal(formatNotificationBadge(20), '20');
  assert.equal(formatNotificationBadge(21), '20+');
  assert.equal(formatNotificationBadge(9999), '20+');
});

const FULL_ROW = {
  id: 41,
  mediaId: 'f00dfacefeed',
  createdAt: Date.now() - 3 * 60 * 60 * 1000,
  unread: true,
  title: 'Ünmistakably Divergent Titlé',
  channelName: '  Zephyr Wörkshop  ',
  folderName: 'Fallback Földer',
  channelAvatarUrl: 'https://yt3.example/avatar.jpg',
  hasThumbnail: true,
  type: 'video',
  durationSec: 754, // 12:34
};

test('buildNotificationRowModel: full row maps to href/labels/thumb verbatim', () => {
  const m = buildNotificationRowModel(FULL_ROW);
  assert.equal(m.href, '/watch.html?v=f00dfacefeed', 'the SAME href shape main.js cards build');
  assert.equal(m.title, 'Ünmistakably Divergent Titlé');
  assert.equal(m.channelLabel, 'Zephyr Wörkshop', 'captured channel name wins, trimmed');
  assert.equal(m.channelAvatarUrl, 'https://yt3.example/avatar.jpg');
  assert.equal(m.thumbnailUrl, '/thumbnail/f00dfacefeed');
  assert.equal(m.unread, true);
  assert.equal(m.id, 41);
  assert.ok(typeof m.timeLabel === 'string' && m.timeLabel.length > 0, 'relative time label rendered');
  assert.notEqual(m.timeLabel, 'unknown date');
  assert.equal(m.durationSec, 754, 'v1.208: the watch length rides the model (for the panel duration badge)');
});

test('v1.208: durationSec is a positive number or 0 - the badge renders only when > 0', () => {
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, durationSec: 0 }).durationSec, 0, 'no length -> 0 (no badge)');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, durationSec: undefined }).durationSec, 0, 'absent -> 0');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, durationSec: -5 }).durationSec, 0, 'garbage negative -> 0');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, durationSec: '90' }).durationSec, 90, 'numeric string coerced');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, durationSec: 62.4 }).durationSec, 62.4, 'a float length is kept (formatDuration rounds)');
});

test('v1.208 SOURCE-LOCK: renderRows wraps the thumb and appends a duration badge ONLY when durationSec > 0', () => {
  // renderRows is an internal panel closure (not exported); bind its shape on
  // the source so the wrap + the guarded .duration-badge append cannot silently
  // regress. The data path (model + server payload) is bound behaviourally
  // elsewhere; the visual fit is measured against the 72x40 thumb.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  assert.match(src, /notif-row-thumb-wrap/, 'the positioned thumb wrapper exists');
  assert.match(src, /m\.durationSec > 0 && typeof formatDuration === 'function'/, 'the badge is guarded on a positive duration');
  assert.match(src, /badge\.className = 'duration-badge'/, 'it reuses the .duration-badge system');
  assert.match(src, /badge\.textContent = formatDuration\(m\.durationSec\)/, 'formatted via the shared formatDuration');
});

test('v1.208 CSS: the thumb wrapper is positioned and the panel badge is SCALED DOWN (fs-xs), winning over the mobile fs-2xl bump', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8')
    .replace(/\/\*[^]*?\*\//g, ''); // strip comments once
  const wrap = /\.notif-row-thumb-wrap\s*\{([^}]*)\}/.exec(css);
  assert.ok(wrap, '.notif-row-thumb-wrap rule exists');
  assert.match(wrap[1], /position:\s*relative/, 'the wrapper hosts the absolute badge');
  const badge = /\.notif-row-thumb-wrap\s+\.duration-badge\s*\{([^}]*)\}/.exec(css);
  assert.ok(badge, 'the scoped panel-badge rule exists');
  assert.match(badge[1], /font-size:\s*var\(--fs-xs\)/, 'scaled to fs-xs (the list-view small-pill language) so it fits a 72x40 thumb');
  // 0-2-0 specificity beats the mobile `.duration-badge { font-size: --fs-2xl }`
  // (0-1-0), so the panel badge stays small at every width - measured ~15px
  // tall in the 72x40 corner (width tracks the label: ~33px for "1:23",
  // ~40px for "12:34"), identical desktop + mobile.
});

test('buildNotificationRowModel: channel label falls back channelName -> folderName -> Library', () => {
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, channelName: '   ' }).channelLabel, 'Fallback Földer');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, channelName: undefined }).channelLabel, 'Fallback Földer');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, channelName: '', folderName: '' }).channelLabel, 'Library');
});

test('buildNotificationRowModel: absence handling — no thumbnail, no avatar, garbage rows', () => {
  // v1.288 (Dean's "nothing iconless" rule): a media row with no real thumbnail
  // no longer resolves to null - it falls back to the FileTube logo, flagged as
  // an icon-fit so the renderer contains it and hangs no duration badge.
  const noThumb = buildNotificationRowModel({ ...FULL_ROW, hasThumbnail: false });
  assert.equal(noThumb.thumbnailUrl, '/icons/icon-192.png');
  assert.equal(noThumb.thumbnailIsIcon, true, 'the logo fallback is an icon-fit, not a photo');
  const nonBool = buildNotificationRowModel({ ...FULL_ROW, hasThumbnail: 'yes' });
  assert.equal(nonBool.thumbnailUrl, '/icons/icon-192.png', 'truthy non-boolean is not a thumbnail claim — logo fallback');
  assert.equal(nonBool.thumbnailIsIcon, true);
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, channelAvatarUrl: undefined }).channelAvatarUrl, '');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, unread: 'true' }).unread, false, 'unread is boolean-strict');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, createdAt: undefined }).timeLabel, 'unknown date');
  assert.equal(buildNotificationRowModel(null), null);
  assert.equal(buildNotificationRowModel({}), null, 'a row without a mediaId cannot render');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, mediaId: '' }), null);
});

// v1.67.1: the push-enable outcome message (the honest-feedback fix). The
// v1.66 flow returned SILENTLY on a non-granted permission AND wrote to a
// display:none element besides, so a locked iPhone got zero feedback. Only
// 'granted' proceeds (null message); everything else names why.
test('describePushEnableOutcome: granted -> null; denied and dismissed each get a distinct, actionable message', () => {
  assert.equal(describePushEnableOutcome('granted'), null, 'granted proceeds with no error');
  const denied = describePushEnableOutcome('denied');
  assert.match(denied, /blocked/i);
  assert.match(denied, /Settings > Notifications/i, 'denied points iOS users at the real toggle');
  const dismissed = describePushEnableOutcome('default');
  assert.match(dismissed, /again/i, 'a dismissed prompt tells the user to retry');
  assert.notEqual(denied, dismissed, 'blocked and dismissed are DIFFERENT causes and must not share copy');
  // Any unexpected value degrades to the retry message, never null (null
  // would let the caller proceed as if granted).
  assert.equal(describePushEnableOutcome(undefined), dismissed);
  assert.equal(describePushEnableOutcome(''), dismissed);
  assert.equal(describePushEnableOutcome('prompt'), dismissed);
});

// v1.67.1 regression guard (a cheap PRESENCE lock; the RUNTIME binding lives
// in test/integration/push-settings-enable.test.js, which loads the real
// setup shell in jsdom, clicks Enable under a denied permission, and asserts
// #push-error actually becomes VISIBLE - that test reddens on the muted
// textContent-only form). The root cause was that the push error element
// (.field-error) is display:none and the enable flow's setError set
// textContent ONLY, so every failure message was invisible. This source lock
// is the fast belt to that suspenders: a regression to the muted form is
// caught in the unit tier without booting jsdom.
const fs = require('node:fs');
const path = require('node:path');
test('v1.67.1: setup.js push setError reveals the element (routes through setFieldError, not muted textContent)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
  // The push controls' setError must delegate to the show/hide helper.
  assert.match(src, /const setError = \(msg\) => setFieldError\(errorEl, msg\);/,
    'push setError must use setFieldError (which sets display:block); a textContent-only setError writes to a display:none element and is invisible');
  // And setFieldError itself must still toggle display (the mechanism).
  assert.match(src, /function setFieldError\(el, message\)[\s\S]*?el\.style\.display = 'block'/,
    'setFieldError must set display:block when showing a message');
});

// ---- v1.73: podcast rows in the bell panel ----------------------------------

test('v1.73: a podcast row deep-links /podcasts?play= and wears the SHOW cover; media rows are byte-identical', () => {
  const { buildNotificationRowModel } = require('../../public/js/common.js');
  const ep = buildNotificationRowModel({ id: 9, mediaId: 'ëp-1', kind: 'podcast', title: 'Ep', channelName: 'Show', artUrl: '/podcastart/süb', createdAt: 1000, unread: true });
  assert.equal(ep.kind, 'podcast');
  assert.equal(ep.href, '/podcasts?play=' + encodeURIComponent('ëp-1'), 'the ?play= contract, encoded');
  assert.equal(ep.thumbnailUrl, '/podcastart/süb', 'show cover, never /thumbnail');
  assert.equal(ep.thumbnailIsIcon, false, 'real show art is a photo (cover-fit), not a logo');
  const med = buildNotificationRowModel({ id: 10, mediaId: 'vid1', title: 'V', channelName: 'C', hasThumbnail: true, createdAt: 1000, unread: false });
  assert.equal(med.kind, 'media');
  assert.equal(med.href, '/watch.html?v=vid1');
  assert.equal(med.thumbnailUrl, '/thumbnail/vid1');
  assert.equal(med.thumbnailIsIcon, false, 'a real thumbnail is a photo (cover-fit), not a logo');
});

test('v1.288: a podcast row with no resolvable show art falls back to the FileTube logo, icon-fit', () => {
  const { buildNotificationRowModel } = require('../../public/js/common.js');
  const noArt = buildNotificationRowModel({ id: 11, mediaId: 'ëp-2', kind: 'podcast', title: 'Ep', channelName: 'Show', artUrl: '', createdAt: 1000, unread: true });
  assert.equal(noArt.thumbnailUrl, '/icons/icon-192.png', 'the guaranteed floor - never blank');
  assert.equal(noArt.thumbnailIsIcon, true, 'the logo fallback is icon-fit (contain, no badge)');
  // artUrl missing entirely (not just empty) is the same defensive floor.
  const undef = buildNotificationRowModel({ id: 12, mediaId: 'ëp-3', kind: 'podcast', title: 'Ep', channelName: 'Show', createdAt: 1000, unread: true });
  assert.equal(undef.thumbnailUrl, '/icons/icon-192.png');
  assert.equal(undef.thumbnailIsIcon, true);
});

// v1.288 (Dean's "nothing iconless" rule): the render loop is the repo's
// untested-by-necessity thin DOM shell (no browser harness), so bind its net
// with a source-lock - the two axes that keep a row from ever showing the
// browser's broken-image glyph: (1) BOTH the avatar and thumbnail imgs carry an
// onerror that swaps to the FileTube logo (self-nulling so it can't loop), and
// (2) the icon-fit thumb wears the contain class and a logo hangs no duration badge.
test('v1.288: the notification render loop wires an onerror logo-fallback on both images + icon-fit gating', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../public/js/common.js'), 'utf8');
  // The two fallback marks exist as named constants.
  assert.match(src, /const NOTIF_ENGINE_ICON = '\/icons\/ytdlp\.svg';/, 'the vendored yt-dlp mark');
  assert.match(src, /const NOTIF_FALLBACK_ICON = '\/icons\/icon-192\.png';/, 'the FileTube logo floor');
  // Avatar onerror: self-null, then swap to the logo (contain via the fallback class).
  assert.match(src, /img\.onerror = function \(\) \{[\s\S]{0,200}this\.onerror = null;[\s\S]{0,200}this\.src = NOTIF_FALLBACK_ICON;[\s\S]{0,200}notif-row-avatar-fallback/,
    'the avatar img must degrade a 404 to the logo, self-nulling first');
  // Thumb onerror: self-null, swap to the logo icon-fit, and drop any duration badge.
  assert.match(src, /thumb\.onerror = function \(\) \{[\s\S]{0,240}this\.onerror = null;[\s\S]{0,240}this\.src = NOTIF_FALLBACK_ICON;[\s\S]{0,240}notif-row-thumb-icon[\s\S]{0,240}duration-badge[\s\S]{0,80}\.remove\(\)/,
    'the thumb img must degrade a 404 to the icon-fit logo and remove its duration badge');
  // The icon-fit class is applied from the model flag, and a logo hangs no badge.
  assert.match(src, /m\.thumbnailIsIcon \? 'notif-row-thumb notif-row-thumb-icon' : 'notif-row-thumb'/,
    'an icon-fit thumb gets the contain class');
  assert.match(src, /if \(!m\.thumbnailIsIcon && m\.durationSec > 0/,
    'a duration badge is suppressed on a logo/icon thumb');
});

test('v1.73 (adversarial W5): the bell row TAP stashes a watch seed for MEDIA rows only (the fourth strike of the seed class)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../public/js/common.js'), 'utf8');
  const clickIdx = src.indexOf('// v1.52: partial seed');
  // window widened 900 -> 1600 for the v1.251 S3 annotation block (the guard gained a
  // six-line new-premise note between the anchor and the stash; semantics unchanged).
  const tail = src.slice(clickIdx, clickIdx + 1600);
  assert.ok(tail.includes("if ((m.kind || 'media') === 'media') {"), 'the media-positive guard exists at the bell click site');
  assert.ok(tail.indexOf("(m.kind || 'media') === 'media'") < tail.indexOf('stashWatchSeed({'), 'and the stash sits INSIDE it');
});

test('v1.146/v1.288: buildNotificationRowModel maps an engine row to the Setup href, wearing the yt-dlp mark', () => {
  const m = buildNotificationRowModel({
    id: 9, mediaId: 'engine:reverted:2026.8.17.73947.dev0', createdAt: Date.now() - 60000,
    unread: true, kind: 'engine',
    title: 'Downloader engine 2026.8.17.73947.dev0 stopped working - reverted to the bundled engine',
    channelName: 'Downloader engine', folderName: '', channelAvatarUrl: '', hasThumbnail: false, type: 'engine',
  });
  assert.equal(m.kind, 'engine');
  assert.equal(m.href, '/setup.html', 'an engine row must NEVER build a /watch.html href from its synthetic id');
  assert.match(m.title, /reverted to the bundled engine/);
  assert.equal(m.channelLabel, 'Downloader engine');
  // v1.288: an engine row is no longer blank on the right - it wears the vendored
  // yt-dlp mark as an icon-fit thumb (contain, no duration badge).
  assert.equal(m.thumbnailUrl, '/icons/ytdlp.svg');
  assert.equal(m.thumbnailIsIcon, true);
  assert.equal(m.channelAvatarUrl, '');
  assert.equal(m.unread, true);
});
