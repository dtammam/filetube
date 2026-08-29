'use strict';

// [UNIT] v1.67 T3 - the ONE card-corner renderer (plan D3): module-scope,
// exported, pure. `resolveCardCornerPrefs` turns a user-settings object into
// the three-corner layout (C5 defaults, `none`, garbage-tolerance per plan
// D1) and `buildCardCornerButtonsHtml` emits the corner buttons' markup -
// position via `.card-corner-tl/tr/bl` classes, identity via the control
// classes, applicability per C4 (share needs the server-derived watchUrl,
// reheat needs the module capability), duplicate-defense per D5 (a direct
// settings POST can bypass the editor's C2 filtering; TL > TR > BL, first
// assignment wins).
//
// These are string/shape assertions on the exported pure function - the
// RENDERED bind (the real buildCardHtml emitting these into a real jsdom
// grid, clicks included) is the T4 full-chain suite; T3's scope is the
// renderer's own contract.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  resolveCardCornerPrefs,
  buildCardCorners,
  buildCardCornerButtonsHtml,
} = require('../../public/js/main.js');

const ITEM = { id: 'vid1', title: 'A Video', ext: '.mp4', liked: false };

function defaults() {
  return resolveCardCornerPrefs(null);
}

// ---- resolveCardCornerPrefs -------------------------------------------------

test('resolve: absent settings -> the C5 defaults (TL download, TR delete, BL like, BR none)', () => {
  for (const empty of [null, undefined, {}, 'junk', 42]) {
    assert.deepStrictEqual(resolveCardCornerPrefs(empty), {
      cornerTL: 'download', cornerTR: 'delete', cornerBL: 'like', cornerBR: 'none',
    }, `input: ${String(empty)}`);
  }
});

test('resolve: the bottom-right slot (v1.204) defaults to none - no existing card moves', () => {
  // A settings object that predates the BR slot (only the three old keys)
  // must resolve BR to 'none', never to a control - the duration badge keeps
  // its home for every user who never touched the new picker.
  assert.strictEqual(resolveCardCornerPrefs({ cornerTL: 'download', cornerTR: 'delete', cornerBL: 'like' }).cornerBR, 'none');
  assert.strictEqual(resolveCardCornerPrefs({}).cornerBR, 'none');
  // A garbage BR value also falls back to the BR default ('none').
  assert.strictEqual(resolveCardCornerPrefs({ cornerBR: 'not_a_control' }).cornerBR, 'none');
  // And a real pick passes through.
  assert.strictEqual(resolveCardCornerPrefs({ cornerBR: 'queue' }).cornerBR, 'queue');
});

test('resolve: valid picks pass through, including none', () => {
  assert.deepStrictEqual(
    resolveCardCornerPrefs({ cornerTL: 'queue', cornerTR: 'none', cornerBL: 'share' }),
    { cornerTL: 'queue', cornerTR: 'none', cornerBL: 'share', cornerBR: 'none' }
  );
  assert.deepStrictEqual(
    resolveCardCornerPrefs({ cornerTL: 'reheat', cornerTR: 'like', cornerBL: 'download', cornerBR: 'transcript' }),
    { cornerTL: 'reheat', cornerTR: 'like', cornerBL: 'download', cornerBR: 'transcript' }
  );
});

test('resolve: a garbage value falls back to THAT corner\'s default only (starRatings precedent)', () => {
  assert.deepStrictEqual(
    resolveCardCornerPrefs({ cornerTL: 'not_a_control', cornerTR: 'queue' }),
    { cornerTL: 'download', cornerTR: 'queue', cornerBL: 'like', cornerBR: 'none' }
  );
});

// ---- buildCardCornerButtonsHtml: the C5 default layout ----------------------

test('defaults: download TL + delete TR (with the arm confirm) + like BL; NO queue/share/reheat', () => {
  // v1.81 write-RBAC: the delete corner now requires the modify-library
  // capability; pass it so this placement/shape test still exercises delete.
  const html = buildCardCornerButtonsHtml(ITEM, defaults(), { canModifyLibrary: true });
  assert.match(html, /class="card-download-btn card-corner-tl"/);
  assert.match(html, /href="\/video\/vid1\?download=1"/, 'the existing download href builder feeds the anchor');
  assert.match(html, /class="card-delete-btn card-corner-tr"/);
  assert.match(html, /<span class="card-delete-confirm">Sure\?<\/span>/, 'the two-tap confirm copy survives');
  assert.match(html, /class="card-like-btn card-corner-bl"/);
  assert.match(html, /aria-pressed="false"/);
  assert.ok(!html.includes('card-queue-btn'), 'queue is unassigned by default (C5 - the collision fix)');
  assert.ok(!html.includes('card-share-btn'), 'share only when assigned');
  assert.ok(!html.includes('card-reheat-btn'), 'reheat only when assigned');
});

test('defaults: the liked state still renders (class + aria-pressed + aria-label)', () => {
  const html = buildCardCornerButtonsHtml({ ...ITEM, liked: true }, defaults(), {});
  assert.match(html, /class="card-like-btn liked card-corner-bl"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-label="Unlike"/);
});

// ---- assignability ----------------------------------------------------------

test('every control renders in every corner with that corner\'s position class', () => {
  const cases = [
    ['cornerTL', 'card-corner-tl'],
    ['cornerTR', 'card-corner-tr'],
    ['cornerBL', 'card-corner-bl'],
  ];
  for (const [key, cornerClass] of cases) {
    for (const control of ['download', 'delete', 'like', 'queue']) {
      const prefs = { cornerTL: 'none', cornerTR: 'none', cornerBL: 'none', [key]: control };
      // v1.81: canModifyLibrary so the 'delete' control renders in this
      // placement sweep (the RBAC hide is proven in its own test below).
      const html = buildCardCornerButtonsHtml(ITEM, prefs, { canModifyLibrary: true });
      assert.match(html, new RegExp(`card-${control}-btn ${cornerClass}`), `${control} in ${key}`);
    }
  }
});

test('none -> that corner emits NOTHING (C4/C5)', () => {
  const html = buildCardCornerButtonsHtml(ITEM, { cornerTL: 'none', cornerTR: 'none', cornerBL: 'none' }, {});
  assert.strictEqual(html.trim(), '', 'three none corners -> empty markup');
});

test('queue renders the promoted icon-queue mask, never an inline svg', () => {
  const html = buildCardCornerButtonsHtml(ITEM, { cornerTL: 'queue', cornerTR: 'none', cornerBL: 'none' }, {});
  assert.match(html, /card-queue-btn card-corner-tl/);
  assert.match(html, /<i class="icon-queue"><\/i>/);
  assert.ok(!html.includes('<svg'), 'no inline svg in corner markup');
});

// ---- applicability (C4: inapplicable renders NOTHING, never a fallback) -----

test('share: renders only when the item carries the server-derived watchUrl', () => {
  const withUrl = buildCardCornerButtonsHtml(
    { ...ITEM, watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    { cornerTL: 'share', cornerTR: 'none', cornerBL: 'none' }, {}
  );
  assert.match(withUrl, /card-share-btn card-corner-tl/);
  assert.match(withUrl, /data-share-url="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  assert.match(withUrl, /<i class="icon-share"><\/i>/);

  const without = buildCardCornerButtonsHtml(ITEM, { cornerTL: 'share', cornerTR: 'none', cornerBL: 'none' }, {});
  assert.strictEqual(without.trim(), '', 'no watchUrl -> an EMPTY corner, no fallback control');
});

test('reheat: renders only when the module capability is affirmatively enabled', () => {
  const enabled = buildCardCornerButtonsHtml(ITEM, { cornerTL: 'reheat', cornerTR: 'none', cornerBL: 'none' }, { reheatEnabled: true });
  assert.match(enabled, /card-reheat-btn card-corner-tl/);
  assert.match(enabled, /<i class="icon-flame"><\/i>/);

  for (const caps of [{}, { reheatEnabled: false }, null, undefined, { reheatEnabled: 'yes' }]) {
    const html = buildCardCornerButtonsHtml(ITEM, { cornerTL: 'reheat', cornerTR: 'none', cornerBL: 'none' }, caps);
    assert.strictEqual(html.trim(), '', `caps=${JSON.stringify(caps)} -> empty corner (C4; === true only)`);
  }
});

// ---- D5: duplicate defense --------------------------------------------------

test('a duplicated control renders ONCE, in the first corner (TL > TR > BL)', () => {
  const html = buildCardCornerButtonsHtml(ITEM, { cornerTL: 'like', cornerTR: 'like', cornerBL: 'like' }, {});
  const hits = html.match(/card-like-btn/g) || [];
  assert.strictEqual(hits.length, 1, 'exactly one like button');
  assert.match(html, /card-like-btn card-corner-tl/, 'and it sits in the FIRST assigned corner');
});

// ---- escaping ---------------------------------------------------------------

test('item fields are attribute-escaped (id, title-derived filename, watchUrl)', () => {
  const nasty = {
    id: 'a"b<c>', title: 'Ti"tle & <x>', ext: '.mp4', liked: false,
    watchUrl: 'https://www.youtube.com/watch?v=x"onmouseover="alert(1)',
  };
  const html = buildCardCornerButtonsHtml(nasty,
    { cornerTL: 'delete', cornerTR: 'share', cornerBL: 'queue' }, {});
  assert.ok(!html.includes('a"b<c>'), 'raw id never lands in markup');
  assert.match(html, /data-id="a&quot;b&lt;c&gt;"/);
  assert.ok(!html.includes('"onmouseover="'), 'watchUrl quotes are escaped');
});

// ---- v1.72 (#94): the mixed-kind Liked card dispatch -------------------------

const { cardKindPresentation } = require('../../public/js/main.js');

test('v1.72: cardKindPresentation - media/absent kind is NULL (the media card path stays byte-identical)', () => {
  assert.strictEqual(cardKindPresentation(ITEM), null, 'no kind field');
  assert.strictEqual(cardKindPresentation({ ...ITEM, kind: 'media' }), null, 'explicit media kind');
  assert.strictEqual(cardKindPresentation(null), null);
});

test('v1.72: cardKindPresentation - the podcast arm (place deep link, show art, episode download, queueable)', () => {
  const kp = cardKindPresentation({ id: 'ep99', kind: 'podcast', subId: 'sub42', showName: 'My Show' });
  assert.strictEqual(kp.href, '/podcasts?play=ep99');
  assert.strictEqual(kp.thumbSrc, '/podcastart/sub42');
  assert.strictEqual(kp.uploaderLabel, 'My Show');
  assert.strictEqual(kp.uploaderHref, '/podcasts');
  assert.strictEqual(kp.downloadHref, '/episode/ep99?download=1');
  assert.strictEqual(kp.canQueue, true, 'episodes ride the v1.71 podcast entry kind');
});

test('v1.72: cardKindPresentation - the track arm (music deep link, album art, source download, queueable as entry kind track)', () => {
  const kp = cardKindPresentation({ id: 'trk7', kind: 'track', artist: 'Pink Floyd' });
  assert.strictEqual(kp.href, '/music?play=trk7');
  assert.strictEqual(kp.thumbSrc, '/albumart/trk7');
  assert.strictEqual(kp.uploaderLabel, 'Pink Floyd');
  assert.strictEqual(kp.downloadHref, '/track/trk7?download=1');
  assert.strictEqual(kp.canQueue, true, 'tracks ride the one queue (v1.72 cap 3)');
});

test('v1.72: corner buttons on a PODCAST item - kind-routed download, NO delete, data-kind on like+queue', () => {
  const ep = { id: 'ep99', kind: 'podcast', subId: 'sub42', title: 'Ep', liked: true };
  const html = buildCardCornerButtonsHtml(ep, { cornerTL: 'download', cornerTR: 'delete', cornerBL: 'like' }, {});
  assert.match(html, /href="\/episode\/ep99\?download=1"/, 'the download anchor rides the episode route');
  assert.ok(!html.includes('card-delete-btn'), 'the card delete verb (DELETE /api/videos/:id) never renders on a non-media card');
  assert.match(html, /card-like-btn liked[^>]*data-kind="podcast"/, 'the like toggle carries its kind');

  const withQueue = buildCardCornerButtonsHtml(ep, { cornerTL: 'queue', cornerTR: 'none', cornerBL: 'none' }, {});
  assert.match(withQueue, /card-queue-btn[^>]*data-kind="podcast"/, 'queue carries its entry kind');
});

test('v1.72: corner buttons on a TRACK item - queue renders with its entry kind; reheat never renders even with caps on', () => {
  const trk = { id: 'trk7', kind: 'track', artist: 'A', title: 'T', liked: false };
  const html = buildCardCornerButtonsHtml(trk, { cornerTL: 'queue', cornerTR: 'reheat', cornerBL: 'download' }, { reheatEnabled: true });
  assert.match(html, /card-queue-btn[^>]*data-kind="track"/, 'the queue button carries entry kind track');
  assert.ok(!html.includes('card-reheat-btn'), 'reheat is a media (yt-dlp) verb');
  assert.match(html, /href="\/track\/trk7\?download=1"/);
});

test('v1.72: a MEDIA item (no kind) renders the corner markup byte-identically to the pre-wave shape', () => {
  const html = buildCardCornerButtonsHtml(ITEM, defaults(), { canModifyLibrary: true });
  assert.ok(!html.includes('data-kind'), 'no kind attribute ever leaks onto a media card');
  assert.match(html, /href="\/video\/vid1\?download=1"/);
  assert.match(html, /class="card-delete-btn card-corner-tr"/);
});

test('v1.81 write-RBAC: the delete corner is HIDDEN without the modify-library capability, present with it', () => {
  // Default layout puts delete in TR. A member without the capability (empty
  // caps, or the flag false) must NOT get a delete affordance; admin/granted
  // (canModifyLibrary true) does. The other corners are unaffected either way.
  for (const caps of [{}, null, undefined, { canModifyLibrary: false }, { canModifyLibrary: 'yes' }]) {
    const html = buildCardCornerButtonsHtml(ITEM, defaults(), caps);
    assert.ok(!html.includes('card-delete-btn'), `delete hidden for caps=${JSON.stringify(caps)}`);
    assert.match(html, /card-download-btn/, 'download still renders');
    assert.match(html, /card-like-btn/, 'like still renders');
  }
  const withCap = buildCardCornerButtonsHtml(ITEM, defaults(), { canModifyLibrary: true });
  assert.match(withCap, /class="card-delete-btn card-corner-tr"/, 'delete renders with the capability');
});

test('v1.72 (adversarial W1): cardKindPresentation - the BOOK arm is bound (reader deep link, cover art, file download, never queue/delete/reheat)', () => {
  const kp = cardKindPresentation({ id: 'bk9', kind: 'book', author: 'Frank Herbert' });
  assert.strictEqual(kp.href, '/read.html?b=bk9');
  assert.strictEqual(kp.thumbSrc, '/bookcover/bk9');
  assert.strictEqual(kp.uploaderLabel, 'Frank Herbert');
  assert.strictEqual(kp.uploaderHref, '/books');
  assert.strictEqual(kp.downloadHref, '/book/bk9/file?download=1');
  assert.strictEqual(kp.canQueue, false, 'books do not queue (Dean ruling 7)');
  const bk = { id: 'bk9', kind: 'book', author: 'A', title: 'T', liked: true };
  const html = buildCardCornerButtonsHtml(bk, { cornerTL: 'download', cornerTR: 'delete', cornerBL: 'queue' }, { reheatEnabled: true });
  assert.match(html, /href="\/book\/bk9\/file\?download=1"/, 'the download anchor rides the book route');
  assert.ok(!html.includes('card-delete-btn'), 'the media delete verb never renders on a book card');
  assert.ok(!html.includes('card-queue-btn'), 'no queue button for a non-queueable kind');
});

// ---- v1.203 (Dean): the Transcript corner ------------------------------------
test('v1.203: transcript renders ONLY for an item with captions (hasSubtitles === true), with the icon-transcript glyph, in its corner', () => {
  const withCaptions = buildCardCornerButtonsHtml({ ...ITEM, hasSubtitles: true }, { cornerTL: 'transcript', cornerTR: 'none', cornerBL: 'none' }, {});
  assert.match(withCaptions, /card-transcript-btn card-corner-tl/);
  assert.match(withCaptions, /<i class="icon-transcript"><\/i>/);
  assert.match(withCaptions, /data-id="/, 'keyed by id for the delegation');
  for (const item of [ITEM, { ...ITEM, hasSubtitles: false }, { ...ITEM, hasSubtitles: 'yes' }]) {
    assert.ok(!buildCardCornerButtonsHtml(item, { cornerTL: 'transcript', cornerTR: 'none', cornerBL: 'none' }, {}).includes('card-transcript-btn'), 'no captions -> no corner');
  }
});

test('v1.203: transcript is a canonical control (resolves) and dedupes across corners like the others', () => {
  assert.deepStrictEqual(resolveCardCornerPrefs({ cornerTL: 'transcript', cornerTR: 'transcript', cornerBL: 'none' }), { cornerTL: 'transcript', cornerTR: 'transcript', cornerBL: 'none', cornerBR: 'none' });
  const html = buildCardCornerButtonsHtml({ ...ITEM, hasSubtitles: true }, { cornerTL: 'transcript', cornerTR: 'transcript', cornerBL: 'none' }, {});
  assert.strictEqual((html.match(/card-transcript-btn/g) || []).length, 1, 'rendered once (the dedupe rule)');
});

// ---- v1.204: the fourth (bottom-right) slot ---------------------------------

test('v1.204: a control assigned to cornerBR renders with the .card-corner-br position class', () => {
  for (const control of ['download', 'like', 'queue']) {
    const prefs = { cornerTL: 'none', cornerTR: 'none', cornerBL: 'none', cornerBR: control };
    const html = buildCardCornerButtonsHtml(ITEM, prefs, { canModifyLibrary: true });
    assert.match(html, new RegExp(`card-${control}-btn card-corner-br`), `${control} in the bottom-right slot`);
  }
});

test('v1.204: buildCardCorners.brOccupied is TRUE only when the BR slot actually renders a button', () => {
  // Occupied: a plain control that always applies.
  const occ = buildCardCorners(ITEM, { cornerTL: 'none', cornerTR: 'none', cornerBL: 'none', cornerBR: 'like' }, {});
  assert.strictEqual(occ.brOccupied, true, 'like in BR -> occupied');
  assert.match(occ.html, /card-like-btn card-corner-br/);

  // BR = none -> never occupied.
  assert.strictEqual(buildCardCorners(ITEM, { cornerBR: 'none' }, {}).brOccupied, false, 'none -> home');

  // BR assigned but INAPPLICABLE to this item (share needs watchUrl,
  // transcript needs captions) -> the badge keeps its home.
  assert.strictEqual(buildCardCorners(ITEM, { cornerTL: 'none', cornerTR: 'none', cornerBL: 'none', cornerBR: 'share' }, {}).brOccupied, false, 'no watchUrl -> BR empty -> home');
  assert.strictEqual(buildCardCorners(ITEM, { cornerTL: 'none', cornerTR: 'none', cornerBL: 'none', cornerBR: 'transcript' }, {}).brOccupied, false, 'no captions -> BR empty -> home');
  assert.strictEqual(buildCardCorners({ ...ITEM, hasSubtitles: true }, { cornerTL: 'none', cornerTR: 'none', cornerBL: 'none', cornerBR: 'transcript' }, {}).brOccupied, true, 'captions -> BR transcript renders -> beside');
});

test('v1.204: a control duplicated into BR is deduped away (TL wins) and does NOT occupy BR', () => {
  const res = buildCardCorners(ITEM, { cornerTL: 'like', cornerTR: 'none', cornerBL: 'none', cornerBR: 'like' }, {});
  assert.strictEqual((res.html.match(/card-like-btn/g) || []).length, 1, 'like renders once');
  assert.match(res.html, /card-like-btn card-corner-tl/, 'in the FIRST assigned corner (TL > ... > BR)');
  assert.strictEqual(res.brOccupied, false, 'the deduped BR duplicate rendered nothing -> badge stays home');
});
