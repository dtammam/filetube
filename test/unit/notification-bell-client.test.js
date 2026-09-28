'use strict';

// [UNIT] v1.51 - the notification bell's pure client decisions
// (public/js/common.js): the capability-probe predicate, the badge label
// formatter, and the server-row -> render-model mapper. Sweep S4: the panel's rendered
// rows are driven in jsdom too (the real injector + ui.js + interaction.js, through
// test/helpers/notif-panel-harness.js; see also notif-delete-confirm.test.js and
// notification-dismiss-client.test.js).
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

// Sweep S4 (AC12 conversion): the v1.208 thumb wrapper + scaled-down .duration-badge (and
// the v1.68.3 isolation that kept that badge under the sticky header) became ui.thumb's
// ONE duration badge (F04) inside a reserved aside column; the source locks on the old
// render loop are replaced by the rendered DOM below and by panel-chrome-mirror.test.js.
test('v1.208 (sweep S4): the panel thumb carries ui.thumb\'s duration badge ONLY on a real thumbnail with a length', async () => {
  const { mountBell } = require('../helpers/notif-panel-harness');
  const h = await mountBell();
  try {
    await h.open();
    const badgeOf = (id) => { const b = h.row(id).querySelector('.ui-row__aside .ui-thumb .ui-thumb__duration'); return b ? b.textContent : null; };
    assert.strictEqual(badgeOf(41), '12:34', 'a media thumbnail with a length');
    assert.strictEqual(badgeOf(43), '30:00', 'a podcast\'s show art with an episode length');
    assert.strictEqual(badgeOf(42), null, 'no thumbnail -> the logo, which hangs no badge');
    assert.strictEqual(badgeOf(44), null, 'the engine mark hangs no badge');
    // every row renders its aside thumb (the column is reserved on every row, F28)
    for (const r of h.rows()) assert.ok(r.querySelector('.ui-row__aside > .ui-thumb.ui-thumb--row'), `row ${r.dataset.notifId} has its thumb`);
  } finally { await h.teardown(); }
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
    'push setError must use setFieldError (which un-hides the element); a textContent-only setError writes to a hidden element and is invisible');
  // And setFieldError itself must still reveal the element (the mechanism). Sweep S8: the
  // reveal is the `hidden` attribute (no inline display write; the global [hidden] rule).
  assert.match(src, /function setFieldError\(el, message\) \{\s*if \(!el\) return;\s*el\.textContent = message \? message : '';\s*el\.hidden = !message;\s*\}/,
    'setFieldError must un-hide the element when showing a message');
});

// ---- v1.73: podcast rows in the bell panel ----------------------------------

test('v1.73: a podcast row deep-links /podcasts?play= and wears the SHOW cover; media rows are byte-identical', () => {
  const { buildNotificationRowModel } = require('../../public/js/common.js');
  const ep = buildNotificationRowModel({ id: 9, mediaId: 'ëp-1', kind: 'podcast', title: 'Ep', channelName: 'Show', artUrl: '/podcastart/süb', createdAt: 1000, unread: true });
  assert.equal(ep.kind, 'podcast');
  assert.equal(ep.href, '/podcasts?play=' + encodeURIComponent('ëp-1'), 'the ?play= contract, encoded');
  assert.equal(ep.thumbnailUrl, '/podcastart/süb', 'show cover, never /thumbnail');
  assert.equal(ep.thumbnailIsIcon, false, 'real show art is a photo (cover-fit), not a logo');
  // v1.302 (Dean): the AVATAR is the SHOW COVER too, not a monogram - the show art is its
  // identity. Mutation guard: dropping the isPodcast->artUrl avatar branch reds this.
  assert.equal(ep.channelAvatarUrl, '/podcastart/süb', 'the avatar is the show cover, not a C/H/T monogram');
  const med = buildNotificationRowModel({ id: 10, mediaId: 'vid1', title: 'V', channelName: 'C', channelAvatarUrl: 'https://yt3/av.jpg', hasThumbnail: true, createdAt: 1000, unread: false });
  assert.equal(med.kind, 'media');
  assert.equal(med.href, '/watch.html?v=vid1');
  assert.equal(med.thumbnailUrl, '/thumbnail/vid1');
  assert.equal(med.thumbnailIsIcon, false, 'a real thumbnail is a photo (cover-fit), not a logo');
  assert.equal(med.channelAvatarUrl, 'https://yt3/av.jpg', 'a media/YT row keeps its CAPTURED channel avatar, not the thumbnail');
});

test('v1.288: a podcast row with no resolvable show art falls back to the FileTube logo, icon-fit', () => {
  const { buildNotificationRowModel } = require('../../public/js/common.js');
  const noArt = buildNotificationRowModel({ id: 11, mediaId: 'ëp-2', kind: 'podcast', title: 'Ep', channelName: 'Show', artUrl: '', createdAt: 1000, unread: true });
  assert.equal(noArt.thumbnailUrl, '/icons/icon-192.png', 'the guaranteed floor - never blank');
  assert.equal(noArt.thumbnailIsIcon, true, 'the logo fallback is icon-fit (contain, no badge)');
  // v1.302: an art-less podcast has no cover to be the avatar, so it still falls to the
  // monogram (empty channelAvatarUrl) - the avatar upgrade must not manufacture a bad URL.
  assert.equal(noArt.channelAvatarUrl, '', 'no show art -> the avatar stays the monogram fallback');
  // artUrl missing entirely (not just empty) is the same defensive floor.
  const undef = buildNotificationRowModel({ id: 12, mediaId: 'ëp-3', kind: 'podcast', title: 'Ep', channelName: 'Show', createdAt: 1000, unread: true });
  assert.equal(undef.thumbnailUrl, '/icons/icon-192.png');
  assert.equal(undef.thumbnailIsIcon, true);
});

// v1.288 (Dean's "nothing iconless" rule), sweep S4 (AC12 conversion of the source lock):
// driven on the rendered panel. (1) a logo thumbnail (engine mark, the FileTube floor) is
// contained (.notif-thumb-icon), (2) a thumbnail that 404s becomes the contained logo and
// drops its duration badge, once (no loop), and (3) an avatar that 404s becomes ui.avatar's
// monogram (D4.4: never the logo, never a broken image).
test('v1.288 (sweep S4): logo thumbs are contained; a 404 thumb becomes the contained logo without its badge; a 404 avatar becomes the monogram', async () => {
  const { mountBell } = require('../helpers/notif-panel-harness');
  const h = await mountBell();
  try {
    await h.open();
    const logoOf = (id) => h.row(id).querySelector('.ui-thumb__img.notif-thumb-icon');
    assert.strictEqual(logoOf(44).getAttribute('src'), '/icons/ytdlp.svg', 'the engine row wears the yt-dlp mark, contained');
    assert.strictEqual(logoOf(42).getAttribute('src'), '/icons/icon-192.png', 'a thumbnail-less row wears the FileTube floor, contained');
    assert.strictEqual(logoOf(41), null, 'a real thumbnail is a photo, not contained');
    const img = h.row(41).querySelector('.ui-thumb__img');
    assert.strictEqual(img.getAttribute('src'), '/thumbnail/Vídeo-One', 'the raw md5-style id, as main.js cards build it');
    img.dispatchEvent(new h.w.Event('error'));
    assert.strictEqual(logoOf(41).getAttribute('src'), '/icons/icon-192.png', 'the 404 thumb became the logo');
    assert.strictEqual(h.row(41).querySelectorAll('.ui-thumb__img').length, 1, 'the broken image is gone, one logo in its place');
    assert.strictEqual(h.row(41).querySelector('.ui-thumb__duration'), null, 'and its duration badge went with it');
    logoOf(41).dispatchEvent(new h.w.Event('error'));
    assert.strictEqual(h.row(41).querySelectorAll('.ui-thumb__img').length, 1, 'a failing logo never loops or stacks');
    const art = h.row(43).querySelector('.ui-row__media .ui-art .ui-avatar__img');
    assert.strictEqual(art.getAttribute('src'), '/podcastart/s%C3%BCb', 'the podcast avatar is its show ART (D4.4)');
    art.dispatchEvent(new h.w.Event('error'));
    const media = h.row(43).querySelector('.ui-row__media');
    assert.strictEqual(media.querySelector('img'), null, 'no broken image');
    assert.strictEqual(media.querySelector('.ui-avatar__mono').textContent, 'S', 'the monogram, never the logo');
  } finally { await h.teardown(); }
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
