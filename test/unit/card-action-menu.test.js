'use strict';

// [UNIT] UI pass sweep S2 (D8.5, D8.1, F03-F05, F53) - the clean card and its
// ONE action menu. Converted from the v1.67 card-corner-renderer suite (AC12:
// the corner renderer, its four position classes and the per-user corner
// layout are gone; this file carries the replacements):
//   - the corners' applicability rules (C4: an action that does not apply to an
//     item is ABSENT, never a substitute) now bind buildCardMenuItems - every
//     kind arm, the capability gates, share/transcript/reheat preconditions;
//   - cardKindPresentation's arms (kept verbatim - the menu and card read them);
//   - buildVideoCardEl's DOM contract: the thumbnail carries ONLY the duration
//     badge and the progress bar (no overlay button anywhere on the card), the
//     kebab is a ui-btn icon in the meta row, text is textContent (no markup);
//   - the Delete confirm's copy says what DELETE /api/videos/:id does (a move to
//     Trash), for a yt-dlp-managed AND a local item;
//   - D8.1: the era flourish - the stars and a MOCK view count carry
//     .ft-fabricated and are hidden in 2021 / shown in 2005/2009/2014 by the ONE
//     style.css rule, a real captured count shows in every era (jsdom cascade
//     over the real style.css, per era), and ft-hide-stars composes.
// The rendered chain (a real index.html, the real grid, the kebab / long-press /
// right-click / keyboard paths and the delete-confirm safety) is
// test/integration/card-action-menu-fullchain.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
// buildVideoCardEl reads these common.js globals at call time (the browser's
// shared classic-script scope); the node harness supplies them.
for (const k of ['resolveViewCountLabel', 'isFabricatedViewCount', 'formatRelativeTime', 'getStarRating',
  'isYtdlpManagedItem', 'eraShowsFabricated', 'applyEraFlourish', 'podcastShareUrl', 'podcastTrashConfirmCopy']) global[k] = common[k];

const {
  cardKindPresentation,
  buildCardMenuItems,
  cardDeleteConfirmCopy,
  cardShareUrl,
  cardDownloadHref,
  buildVideoCardEl,
  buildSkeletonCardEl,
} = require('../../public/js/main.js');

const ITEM = { id: 'vid1', title: 'A Video', ext: '.mp4', liked: false, duration: 125, addedAt: Date.now() - 3600e3 };
const ids = (items) => items.map((x) => x.id);

// ---- buildCardMenuItems: the corners' C4 applicability, as menu entries -------

test('media item, no capability: queue, like, save - never delete/reheat/share/transcript/feedhide', () => {
  assert.deepStrictEqual(ids(buildCardMenuItems(ITEM, {})), ['queue', 'watchlater', 'like', 'download']);
  for (const caps of [null, undefined, { canModifyLibrary: false }, { canModifyLibrary: 'yes' }, { reheatEnabled: 'true' }]) {
    const got = ids(buildCardMenuItems(ITEM, caps));
    assert.ok(!got.includes('delete'), `no delete for caps=${JSON.stringify(caps)}`);
    assert.ok(!got.includes('reheat'), `no reheat for caps=${JSON.stringify(caps)}`);
  }
});

test('v1.81 write-RBAC: Move to Trash appears ONLY with canModifyLibrary === true, last, marked danger', () => {
  const items = buildCardMenuItems(ITEM, { canModifyLibrary: true });
  const del = items[items.length - 1];
  assert.deepStrictEqual(del, { id: 'delete', icon: 'delete', label: 'Move to Trash', danger: true });
  assert.strictEqual(items.filter((x) => x.danger).length, 1, 'exactly one danger entry');
});

test('Reheat: only with the module capability affirmatively enabled (=== true), media only', () => {
  assert.ok(ids(buildCardMenuItems(ITEM, { reheatEnabled: true })).includes('reheat'));
  assert.ok(!ids(buildCardMenuItems(ITEM, { reheatEnabled: false })).includes('reheat'));
  assert.ok(!ids(buildCardMenuItems({ id: 't', kind: 'track', title: 'T' }, { reheatEnabled: true })).includes('reheat'), 'a media verb');
});

test('Share: only with the server-derived link; YouTube watchUrl wins over a saved page link (v1.338)', () => {
  assert.ok(!ids(buildCardMenuItems(ITEM, {})).includes('share'), 'no link -> no share');
  assert.ok(ids(buildCardMenuItems({ ...ITEM, sourceShareUrl: 'https://vimeo.com/1' }, {})).includes('share'));
  assert.strictEqual(cardShareUrl({ watchUrl: 'https://youtube.com/watch?v=a', sourceShareUrl: 'https://x/y' }), 'https://youtube.com/watch?v=a');
  assert.strictEqual(cardShareUrl({ sourceShareUrl: 'https://x/y' }), 'https://x/y');
  assert.strictEqual(cardShareUrl({ watchUrl: '', sourceShareUrl: '' }), '');
});

test('v1.203 Transcript: only for an item with captions (hasSubtitles === true), media only', () => {
  assert.ok(ids(buildCardMenuItems({ ...ITEM, hasSubtitles: true }, {})).includes('transcript'));
  for (const v of [false, 'yes', undefined]) assert.ok(!ids(buildCardMenuItems({ ...ITEM, hasSubtitles: v }, {})).includes('transcript'));
  assert.ok(!ids(buildCardMenuItems({ id: 'e', kind: 'podcast', subId: 's', hasSubtitles: true }, {})).includes('transcript'));
});

test('v1.97 Hide from feed: only when the caller passes feedHideable, media only', () => {
  assert.ok(ids(buildCardMenuItems(ITEM, {}, { feedHideable: true })).includes('feedhide'));
  assert.ok(!ids(buildCardMenuItems(ITEM, {}, {})).includes('feedhide'));
  assert.ok(!ids(buildCardMenuItems({ id: 'e', kind: 'podcast', subId: 's' }, {}, { feedHideable: true })).includes('feedhide'));
});

test('Like reads the item: Like / Unlike with the filled heart when liked', () => {
  assert.deepStrictEqual(buildCardMenuItems(ITEM, {})[2], { id: 'like', icon: 'favorite', label: 'Like' });
  assert.deepStrictEqual(buildCardMenuItems({ ...ITEM, liked: true }, {})[2], { id: 'like', icon: 'favorite.fill', label: 'Unlike' });
});

test('v1.343 Watch later: media and (v1.376.0) podcast episodes; label follows opts.watchLater; Move to top only when asked', () => {
  const wl = (it, opts) => buildCardMenuItems(it, {}, opts).filter((x) => x.id.startsWith('watchlater'));
  assert.deepStrictEqual(wl(ITEM, {}), [{ id: 'watchlater', icon: 'schedule', label: 'Watch later' }]);
  assert.deepStrictEqual(wl(ITEM, { watchLater: true }), [{ id: 'watchlater', icon: 'schedule', label: 'Remove from Watch later' }]);
  assert.deepStrictEqual(ids(wl(ITEM, { watchLater: true, watchLaterTop: true })), ['watchlater', 'watchlater-top']);
  assert.strictEqual(wl(ITEM, { watchLater: true, watchLaterTop: true })[1].label, 'Move to top');
  const ep = { id: 'e', kind: 'podcast', subId: 's' };
  assert.deepStrictEqual(wl(ep, {}), [{ id: 'watchlater', icon: 'schedule', label: 'Watch later' }], 'v1.376.0 W2: an episode offers Watch later');
  assert.deepStrictEqual(ids(wl(ep, { watchLater: true, watchLaterTop: true })), ['watchlater', 'watchlater-top']);
  for (const k of [{ id: 't', kind: 'track' }, { id: 'b', kind: 'book' }]) {
    assert.deepStrictEqual(wl(k, { watchLater: true, watchLaterTop: true }), [], `no Watch later for kind ${k.kind}`);
  }
});

test('v1.72 / v1.376.0 kinds: podcast - queue, Watch later, like, Share, download; Move to Trash ONLY with the capability; never reheat', () => {
  const ep = { id: 'ep 99', kind: 'podcast', subId: 'sub42', title: 'Ep' };
  assert.deepStrictEqual(ids(buildCardMenuItems(ep, { canModifyLibrary: true, reheatEnabled: true })), ['queue', 'watchlater', 'like', 'share', 'download', 'delete']);
  for (const caps of [{}, { canModifyLibrary: false }, { canModifyLibrary: 'yes' }]) {
    assert.ok(!ids(buildCardMenuItems(ep, caps)).includes('delete'), `no delete for caps=${JSON.stringify(caps)}`);
  }
  assert.strictEqual(cardDownloadHref(ep), '/episode/ep%2099?download=1');
  assert.strictEqual(cardShareUrl(ep), '/podcasts?play=ep%2099', 'the episode link (absolute in a browser: location.origin + this)');
  const copy = cardDeleteConfirmCopy(ep);
  assert.deepStrictEqual([copy.title, copy.confirmLabel, copy.danger], ['Move to Trash?', 'Move to Trash', true]);
  assert.match(copy.body, /“Ep” moves to Trash\. You can restore it from the show's episode list\./, 'gate r1: a card has no episode list - it names the show\'s');
});

test('v1.72 kinds: track - queue + like + its own download; book - like + download, never queue', () => {
  const trk = { id: 'trk7', kind: 'track', artist: 'A', title: 'T' };
  assert.deepStrictEqual(ids(buildCardMenuItems(trk, { canModifyLibrary: true })), ['queue', 'like', 'download']);
  assert.strictEqual(cardDownloadHref(trk), '/track/trk7?download=1');
  const bk = { id: 'bk9', kind: 'book', author: 'A', title: 'T' };
  assert.deepStrictEqual(ids(buildCardMenuItems(bk, { canModifyLibrary: true, reheatEnabled: true })), ['like', 'download']);
  assert.strictEqual(cardDownloadHref(bk), '/book/bk9/file?download=1');
});

test('v1.205 kinds: a TV card has no download, like, queue or delete (no such routes)', () => {
  for (const kind of ['tv-episode', 'tv-show']) {
    const item = { id: 'x', kind, title: 'T', showId: 'shZ' };
    assert.deepStrictEqual(ids(buildCardMenuItems(item, { canModifyLibrary: true, reheatEnabled: true }, { feedHideable: true })), [], kind);
  }
});

test('media download href: the /video/:id?download=1 route, id percent-encoded', () => {
  assert.strictEqual(cardDownloadHref({ id: 'a b/c' }), '/video/a%20b%2Fc?download=1');
});

// ---- the Delete confirm's copy (DELETE /api/videos/:id = a move to Trash) -----

test('delete copy: "Move to Trash?" with a Move to Trash danger confirm, for yt-dlp-managed and local items alike', () => {
  const managed = cardDeleteConfirmCopy({ id: '1', title: 'Clip', channelName: 'Chan' });
  const local = cardDeleteConfirmCopy({ id: '2', title: 'Home movie' });
  for (const c of [managed, local]) {
    assert.strictEqual(c.title, 'Move to Trash?');
    assert.strictEqual(c.confirmLabel, 'Move to Trash');
    assert.strictEqual(c.danger, true);
    assert.match(c.body, /stays in Trash, where you can restore it from Settings/);
    assert.ok(!/permanent/i.test(c.title + c.confirmLabel), 'never claims a permanent delete (the route trashes)');
  }
  assert.match(managed.body, /^"Clip" leaves your library now\./);
  assert.ok(!/cannot be re-downloaded/.test(managed.body), 'a yt-dlp item can be re-downloaded');
  assert.match(local.body, /This local file cannot be re-downloaded\.$/, 'a local file says so');
});

// ---- cardKindPresentation (kept from the corner suite, verbatim contract) -----

test('v1.72: cardKindPresentation - media/absent kind is NULL', () => {
  assert.strictEqual(cardKindPresentation(ITEM), null);
  assert.strictEqual(cardKindPresentation({ ...ITEM, kind: 'media' }), null);
  assert.strictEqual(cardKindPresentation(null), null);
});

test('v1.72: cardKindPresentation - podcast / track (+ v1.222 album byline) / book arms', () => {
  const kp = cardKindPresentation({ id: 'ep99', kind: 'podcast', subId: 'sub42', showName: 'My Show' });
  assert.deepStrictEqual([kp.href, kp.thumbSrc, kp.uploaderLabel, kp.uploaderHref, kp.canQueue], ['/podcasts?play=ep99', '/podcastart/sub42', 'My Show', '/podcasts', true]);
  const t = cardKindPresentation({ id: 't1', kind: 'track', artist: 'NESTALGIA', album: 'DJ Mix 2024' });
  assert.strictEqual(t.uploaderLabel, 'NESTALGIA · DJ Mix 2024');
  assert.strictEqual(cardKindPresentation({ id: 't2', kind: 'track', artist: 'Solo', album: '' }).uploaderLabel, 'Solo');
  const b = cardKindPresentation({ id: 'bk9', kind: 'book', author: 'Frank Herbert' });
  assert.deepStrictEqual([b.href, b.thumbSrc, b.uploaderHref, b.canQueue], ['/read.html?b=bk9', '/bookcover/bk9', '/books', false]);
});

test('v1.205: cardKindPresentation - tv-episode and tv-show arms', () => {
  const ep = cardKindPresentation({ id: 'tve', kind: 'tv-episode', showId: 'shZ', showName: 'Zephyr' });
  assert.deepStrictEqual([ep.href, ep.thumbSrc, ep.uploaderHref, ep.downloadHref, ep.likeable], ['/watch.html?tv=tve', '/tvthumb/tve', '/tv?show=shZ', '', false]);
  const show = cardKindPresentation({ id: 'shZ', kind: 'tv-show', posterEpisodeId: 'tve' });
  assert.deepStrictEqual([show.href, show.thumbSrc], ['/tv?show=shZ', '/tvthumb/tve']);
});

// ---- buildVideoCardEl: the clean card's DOM contract (jsdom) ------------------

function freshDoc(era) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  if (era) dom.window.document.documentElement.setAttribute('data-theme', era);
  return dom;
}

function card(item, doc, extra) {
  return buildVideoCardEl(item, Object.assign({ doc, href: '/watch.html?v=' + item.id, channelName: 'Harbor', channelHref: '/?folder=Harbor', avatar: null }, extra || {}));
}

test('D8.5: the thumbnail carries ONLY the duration badge and the progress bar - no overlay button anywhere on the media', () => {
  const { window } = freshDoc();
  const el = card({ ...ITEM, progressPercent: 40, hasPreview: true }, window.document);
  const thumb = el.querySelector('.card-media > .ui-thumb');
  assert.ok(thumb, 'the media link holds a ui-thumb');
  const kids = Array.from(thumb.children).map((c) => c.className);
  assert.deepStrictEqual(kids, ['ui-thumb__img art-shimmer', 'card-preview', 'ui-thumb__duration', 'ui-thumb__progress'],
    'img, hover preview, the ONE badge, the progress bar - in that paint order');
  assert.strictEqual(el.querySelectorAll('.card-media button, .card-media a a, .card-media [role="button"]').length, 0, 'no control inside the media');
  assert.strictEqual(thumb.querySelector('.ui-thumb__duration').textContent, '2:05');
  assert.strictEqual(thumb.querySelector('.ui-thumb__bar').style.getPropertyValue('--p'), '0.4', 'progress is the ui-thumb data property');
});

test('D8.5: the card has exactly ONE button - the kebab, a ui-btn plain icon in the info row (none of the eight .card-*-btn families)', () => {
  const { window } = freshDoc();
  const el = card({ ...ITEM, hasSubtitles: true, watchUrl: 'https://youtube.com/watch?v=x' }, window.document);
  const buttons = el.querySelectorAll('button, a[download], [role="button"]');
  assert.strictEqual(buttons.length, 1, 'one control on the whole card');
  const kebab = buttons[0];
  assert.ok(kebab.classList.contains('card-kebab') && kebab.classList.contains('ui-btn') && kebab.classList.contains('ui-btn--plain') && kebab.classList.contains('ui-btn--icon'));
  assert.strictEqual(kebab.parentNode.className, 'video-info', 'in the meta row, not over the thumbnail');
  assert.strictEqual(kebab.getAttribute('aria-label'), 'More actions');
  assert.strictEqual(kebab.getAttribute('data-id'), 'vid1');
  assert.strictEqual(kebab.querySelector('use').getAttribute('href'), '#i-more_vert', 'a registry icon, not a text glyph');
  assert.strictEqual(el.innerHTML.match(/card-(download|delete|like|queue|share|reheat|transcript|feedhide)-btn/g), null);
});

test('text is textContent: a title with markup renders as text, never parsed', () => {
  const { window } = freshDoc();
  const el = card({ ...ITEM, title: '<img src=x onerror=alert(1)>' }, window.document);
  assert.strictEqual(el.querySelectorAll('img').length, 1, 'only the thumbnail image');
  assert.strictEqual(el.querySelector('.video-title').textContent, '<img src=x onerror=alert(1)>');
});

test('D4.4: the Modern byline avatar is a ui-avatar circle (photo, else a monogram - never an inline colour)', () => {
  const { window } = freshDoc();
  const withPhoto = card(ITEM, window.document, { avatar: { url: '/avatar/x.jpg' } });
  assert.ok(withPhoto.querySelector('.video-info > .ui-avatar.ui-avatar--sm > img.ui-avatar__img'));
  const mono = card(ITEM, window.document, { avatar: { url: null } });
  const m = mono.querySelector('.video-info > .ui-avatar .ui-avatar__mono');
  assert.strictEqual(m.textContent, 'H');
  assert.strictEqual(m.getAttribute('style'), null, 'no inline style');
  assert.strictEqual(card(ITEM, window.document).querySelector('.ui-avatar'), null, 'no avatar outside Modern');
});

test('the skeleton card is built from the same primitives: a ui-thumb box and the info block line boxes, aria-hidden', () => {
  const { window } = freshDoc();
  const sk = buildSkeletonCardEl(window.document, { avatar: true });
  assert.strictEqual(sk.getAttribute('aria-hidden'), 'true');
  assert.ok(sk.querySelector('.card-media > .ui-thumb.ui-thumb--16x9.skeleton-shimmer'), 'the real thumb box');
  assert.strictEqual(sk.querySelectorAll('.video-title .skeleton-text').length, 2, 'a two-line title');
  assert.ok(sk.querySelector('.video-info > .ui-avatar.ui-avatar--sm'), 'the avatar reserve');
  assert.strictEqual(sk.querySelectorAll('.card-rating .ui-icon').length, 5, 'the five-icon rating row box');
});

// ---- D8.1: the era flourish over the REAL style.css (jsdom cascade, per era) --

const STYLE = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
// Only the rules that can decide these nodes' display: the flourish gate and the
// ft-hide-stars pref (both extracted from the real sheet, so deleting or
// mutating either in style.css changes what this test sees).
function gateRules() {
  const rules = [];
  const re = /(^|\n)([^{}\n][^{}]*?)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(STYLE))) {
    const sel = m[2].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (/ft-fabricated|ft-hide-stars/.test(sel)) rules.push(sel + '{' + m[3] + '}');
  }
  return rules.join('\n');
}

function renderIn(era, opts) {
  const dom = freshDoc(era);
  const doc = dom.window.document;
  const st = doc.createElement('style');
  st.textContent = gateRules();
  doc.head.appendChild(st);
  common.applyEraFlourish(undefined, doc); // the ONE mechanism: derived from data-theme
  if (opts && opts.hideStars) doc.documentElement.classList.add('ft-hide-stars');
  const mock = card({ ...ITEM, id: 'aaaaaa01' }, doc);
  const real = card({ ...ITEM, id: 'bbbbbb02', sourceViewCount: 1234 }, doc);
  doc.body.appendChild(mock);
  doc.body.appendChild(real);
  const shown = (el) => dom.window.getComputedStyle(el).display !== 'none';
  return {
    attr: doc.documentElement.getAttribute('data-era-flourish'),
    stars: shown(mock.querySelector('.card-rating')),
    mockViews: shown(mock.querySelector('.card-views')),
    realViews: shown(real.querySelector('.card-views')),
    realText: real.querySelector('.card-views').textContent,
    anti: shown(mock.querySelector('.card-when')),
  };
}

test('D8.1 fixture control: the stylesheet the per-era checks read carries the flourish gate', () => {
  assert.match(gateRules(), /html:not\(\[data-era-flourish="on"\]\) \.ft-fabricated\{\s*display: none;/);
});

for (const era of ['2021', '2014', '2009', '2005']) {
  test(`D8.1 era ${era}: fabricated stars + a mock view count are ${era === '2021' ? 'HIDDEN' : 'SHOWN'}; a real captured count shows`, () => {
    const r = renderIn(era);
    const on = era !== '2021';
    assert.strictEqual(r.attr, on ? 'on' : 'off', 'data-era-flourish derived from the era');
    assert.strictEqual(r.stars, on, 'the mock stars');
    assert.strictEqual(r.mockViews, on, 'a mock view count (no sourceViewCount)');
    assert.strictEqual(r.realViews, true, 'a real yt-dlp count shows in every era');
    assert.strictEqual(r.realText, '1,234 views');
    assert.strictEqual(r.anti, true, 'non-fabricated meta is never gated');
  });
}

test('D8.1: an unknown or missing era is the Modern default (flourish off)', () => {
  for (const e of [null, '', '1999', 'bogus']) assert.strictEqual(common.eraShowsFabricated(e), false, String(e));
  assert.deepStrictEqual(common.ERA_FLOURISH_ERAS, ['2005', '2009', '2014']);
  const r = renderIn(null);
  assert.strictEqual(r.attr, 'off');
  assert.strictEqual(r.stars, false);
});

test('D8.1 composes with the ft-hide-stars pref: a retro era shows stars unless the pref hides them; the mock views follow the era only', () => {
  const r = renderIn('2009', { hideStars: true });
  assert.strictEqual(r.stars, false, 'the pref still hides the stars');
  assert.strictEqual(r.mockViews, true, 'the pref never gated view counts');
});

test('D8.1: the flourish follows an era change live (applyTheme sets it with data-theme)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  const body = src.slice(src.indexOf('function applyTheme(era, mode) {'), src.indexOf('// Runs on DOMContentLoaded'));
  assert.match(body, /d\.setAttribute\('data-theme', era\);[\s\S]*applyEraFlourish\(era\);/, 'applyTheme reflects the flourish with the era');
  assert.match(src, /\napplyEraFlourish\(\);\n\ndocument\.addEventListener\('DOMContentLoaded'/, 'and at common.js load, before any view renders');
});

// ---- the retired corner layout leaves no inert control (LESSONS 4) ------------
// Replaces test/unit/card-corner-editor.test.js (AC12): the v1.67 Settings
// "Card corners" pickers placed controls the cards no longer have, so a picker
// left behind would be a control with no observable result. It is gone from the
// Settings shell and from setup.js, and nothing references the retired roster.
test('Settings has no card-corner editor: no host, no heading, no renderer, no corner vocabulary', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'public', 'setup.html'), 'utf8');
  const setupJs = fs.readFileSync(path.join(root, 'public', 'js', 'setup.js'), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/id="card-corner-editor"/.test(html), 'no editor host');
  assert.ok(!/>Card corners</.test(html), 'no heading');
  for (const name of ['renderCardCornerEditor', 'drawCardCornerEditor', 'CORNER_EDITOR_SLOTS', 'CARD_CORNER_CONTROLS', 'resolveCardCornerPrefs']) {
    assert.ok(!setupJs.includes(name), `setup.js no longer references ${name}`);
  }
  const mainJs = fs.readFileSync(path.join(root, 'public', 'js', 'main.js'), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  for (const name of ['CARD_CORNER_CONTROLS', 'resolveCardCornerPrefs', 'buildCardCorners', 'card-corner-']) {
    assert.ok(!mainJs.includes(name), `main.js no longer carries ${name}`);
  }
});

test('the eight .card-*-btn families and the four corner position classes have no rule left in any stylesheet', () => {
  const root = path.join(__dirname, '..', '..', 'public', 'css');
  for (const f of ['tokens.css', 'ui.css', 'style.css']) {
    const css = fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.strictEqual(css.match(/\.card-(download|delete|like|queue|share|reheat|transcript|feedhide)-btn|\.card-corner-(tl|tr|bl|br)\b|\.duration-badge--beside-corner/g), null, f);
  }
});

test('no inert kebab: a TV card (an empty menu in every capability) renders no kebab; every other kind does', () => {
  const { window } = freshDoc();
  for (const kind of ['tv-episode', 'tv-show']) {
    assert.strictEqual(card({ id: 'x', kind, title: 'T', showId: 's' }, window.document).querySelector('.card-kebab'), null, kind);
  }
  for (const it of [ITEM, { id: 'e', kind: 'podcast', subId: 's', title: 'E' }, { id: 't', kind: 'track', title: 'T' }, { id: 'b', kind: 'book', title: 'B' }]) {
    assert.ok(card(it, window.document).querySelector('.card-kebab'), it.kind || 'media');
  }
});
