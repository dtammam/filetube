'use strict';

// [UNIT] v1.386.0 speed pass (W2): public/js/music-skins.js skinArtUrls / warmSkinArt / whenSkinArtReady - a skin's
// photos are read from the LOADED stylesheets (every url() in a rule naming one of the skin's classes, resolved
// against the sheet, versioned query kept), downloaded and decoded before a pick shows the skin. The real-CSS half
// (the Transparent Coil's board + ring, through the real served stylesheet) is measured in a browser by
// tools/speed-proof/browser-cost.js; this binds the parsing and the wait with a stand-in CSSOM and Image.

const { test } = require('node:test');
const assert = require('node:assert');

const skinsPath = require.resolve('../../public/js/music-skins.js');
function fresh() { delete require.cache[skinsPath]; return require(skinsPath); }

// a minimal CSSOM: a sheet is { href, cssRules }, a style rule { selectorText, style }, a group rule { cssRules }
function rule(selectorText, props) {
  const names = Object.keys(props);
  const style = { length: names.length, getPropertyValue: (n) => props[n] };
  names.forEach((n, i) => { style[i] = n; });
  return { selectorText, style };
}
const SHEET = 'http://h/css/style.css?v=1111222233334444';
function docWith(rules, extraSheets) {
  return { baseURI: 'http://h/music', styleSheets: [{ href: SHEET, cssRules: rules }].concat(extraSheets || []) };
}
const COIL_RULES = [
  rule(':where(html.is-phone, html.mms-popout, .skin-grid) .mms-ipod-custom5-transparent-coil', {
    '--pk-c-body': 'linear-gradient(red, blue), var(--mms-ipod-board-turn, var(--pk-c-board, none)), #2c4238',
    '--pk-c-board': 'url(../assets/skins/transparent-board.webp?v=aaaa) 50% 100% / 121% auto no-repeat',
    '--pk-c-board-r90': 'url(../assets/skins/transparent-board-r90.webp?v=bbbb) 100% 50% / auto 121% no-repeat',
    '--pk-c-board-r270': 'url(../assets/skins/transparent-board-r270.webp?v=cccc) 0% 50% / auto 121% no-repeat',
    '--pk-c-wheel-art': 'radial-gradient(red, blue), url("../assets/skins/transparent-ring.webp?v=dddd") center / 100% 100% no-repeat',
    'background-image': 'url(data:image/png;base64,AAAA)',
  }),
  // a prefix of the Coil's class (the plain Transparent) must not be read as the Coil
  rule(':where(html.is-phone) .mms-ipod-custom5-transparent', { '--pk-c-board': 'url(/assets/skins/plain-only.webp)' }),
  { cssRules: [rule('html.is-phone .mms-ipod-custom5-transparent-coil .x', { 'mask-image': "url('/assets/icons/in-media.svg?v=eeee')" })] }, // inside @media
  rule('.mms-ipod', { '--x': 'url(/assets/skins/base-art.webp)' }), // the Coil's base class
  rule('.mms-ipodx', { '--x': 'url(/assets/skins/not-base.webp)' }),
];

test('skinArtUrls reads the photos of exactly the skin\'s classes, resolved like the stylesheet, versions kept', () => {
  const S = fresh();
  const doc = docWith(COIL_RULES, [{ href: 'https://cdn.example/x.css', get cssRules() { throw new Error('SecurityError'); } }]);
  const portrait = S.skinArtUrls('ipod-custom5-transparent-coil', { doc, landscape: false }).sort();
  assert.deepStrictEqual(portrait, [
    'http://h/assets/icons/in-media.svg?v=eeee',
    'http://h/assets/skins/base-art.webp',
    'http://h/assets/skins/transparent-board.webp?v=aaaa',
    'http://h/assets/skins/transparent-ring.webp?v=dddd',
  ]);
  const landscape = S.skinArtUrls('ipod-custom5-transparent-coil', { doc, landscape: true });
  assert.ok(landscape.includes('http://h/assets/skins/transparent-board-r90.webp?v=bbbb'), 'the sideways boards only when landscape');
  assert.ok(landscape.includes('http://h/assets/skins/transparent-board-r270.webp?v=cccc'));
  assert.deepStrictEqual(S.skinArtUrls('ipod-custom5-transparent', { doc, landscape: false }).sort(), ['http://h/assets/skins/base-art.webp', 'http://h/assets/skins/plain-only.webp']);
  assert.deepStrictEqual(S.skinArtUrls('no-such-skin', { doc }), []);
  assert.deepStrictEqual(S.skinArtUrls('ipod-custom5-transparent-coil', { doc: { styleSheets: [] } }), []);
});

// a stand-in Image the test drives: each new Image is recorded; load() / fail() settle it
function fakeImages() {
  const made = [];
  class FakeImage {
    constructor() { made.push(this); this.decoded = false; }
    set src(u) { this._src = u; }
    get src() { return this._src; }
    decode() { this.decoded = true; return Promise.resolve(); }
    load() { this.onload(); }
    fail() { this.onerror(); }
  }
  global.Image = FakeImage;
  return { made, restore: () => { delete global.Image; } };
}
const settle = () => new Promise((r) => setImmediate(r));

test('whenSkinArtReady: null when nothing to wait for; a promise until every photo is downloaded AND decoded; null after', async () => {
  const S = fresh();
  const img = fakeImages();
  try {
    const doc = docWith(COIL_RULES);
    assert.strictEqual(S.whenSkinArtReady('apple', 1000, { doc }), null, 'a skin with no photos applies at once');
    let done = null;
    const p = S.whenSkinArtReady('ipod-custom5-transparent-coil', 10000, { doc, landscape: false });
    assert.ok(p && typeof p.then === 'function');
    p.then((v) => { done = v; });
    assert.strictEqual(img.made.length, 4, 'one download per photo');
    img.made.slice(0, 3).forEach((m) => m.load());
    await settle();
    assert.strictEqual(done, null, 'still waiting on the last photo');
    img.made[3].load();
    await settle(); await settle();
    assert.strictEqual(done, true);
    assert.ok(img.made.every((m) => m.decoded), 'decoded, not just downloaded');
    assert.strictEqual(S.whenSkinArtReady('ipod-custom5-transparent-coil', 10000, { doc, landscape: false }), null, 'warm: applies at once');
    // warmSkinArt reuses the same downloads (no second request for a photo already asked for)
    S.warmSkinArt(['ipod-custom5-transparent-coil'], { doc, landscape: false });
    assert.strictEqual(img.made.length, 4);
  } finally { img.restore(); }
});

test('whenSkinArtReady: a failed photo never blocks the pick (and is asked again next time); the cap ends a slow wait', async () => {
  const S = fresh();
  const img = fakeImages();
  try {
    const doc = docWith([rule('.mms-ipod-custom5-transparent-black', { '--pk-c-board': 'url(/assets/skins/b.webp)' })]);
    let done = null;
    S.whenSkinArtReady('ipod-custom5-transparent-black', 10000, { doc }).then((v) => { done = v; });
    img.made[0].fail();
    await settle(); await settle();
    assert.strictEqual(done, true, 'resolved on the error');
    const again = S.whenSkinArtReady('ipod-custom5-transparent-black', 30, { doc });
    assert.ok(again, 'a failed photo is not "done"');
    assert.strictEqual(img.made.length, 2, 'asked again');
    const t0 = Date.now();
    assert.strictEqual(await again, false, 'the cap resolves false');
    assert.ok(Date.now() - t0 >= 25);
  } finally { img.restore(); }
});

// gate r2 (adversary WARNING): the index is built ONCE per document and stylesheet set - without the cache every lookup
// re-walks every rule (60-270 ms each), and the idle warm of every skin would block the page for seconds.
function countingDoc(rules, href) {
  const doc = { baseURI: 'http://h/music', reads: 0, styleSheets: [] };
  const sheet = { href: href || SHEET };
  Object.defineProperty(sheet, 'cssRules', { get() { doc.reads += 1; return rules; } });
  doc.styleSheets.push(sheet);
  return doc;
}
test('the stylesheet index: one walk per document across every lookup and warm', () => {
  const S = fresh();
  const doc = countingDoc(COIL_RULES);
  S.skinArtUrls('ipod-custom5-transparent-black', { doc, landscape: false });
  assert.strictEqual(doc.reads, 1, 'the first lookup walks once');
  for (let i = 0; i < 5; i++) S.skinArtUrls('ipod-custom5-transparent-coil', { doc, landscape: false });
  S.skinArtUrls('ipod-custom5-transparent', { doc, landscape: true });
  assert.strictEqual(doc.reads, 1, 'lookups reuse it');
  assert.ok(S.skinArtUrls('ipod-custom5-transparent-coil', { doc, landscape: false }).includes('http://h/assets/skins/transparent-ring.webp?v=dddd'));
});
test('the stylesheet index is rebuilt when the set of sheets changes, even at the same count (a new stamp = a new href)', () => {
  const S = fresh();
  const doc = countingDoc(COIL_RULES);
  S.skinArtUrls('ipod-custom5-transparent-coil', { doc, landscape: false });
  assert.strictEqual(doc.reads, 1);
  const moved = [rule('.mms-ipod-custom5-transparent-coil', { '--pk-c-board': 'url(../assets/skins/new-board.webp?v=ffff)' })];
  const sheet2 = { href: 'http://h/css/style.css?v=9999888877776666' };
  Object.defineProperty(sheet2, 'cssRules', { get() { doc.reads += 1; return moved; } });
  doc.styleSheets[0] = sheet2; // same count, another stylesheet version
  assert.deepStrictEqual(S.skinArtUrls('ipod-custom5-transparent-coil', { doc, landscape: false }), ['http://h/assets/skins/new-board.webp?v=ffff']);
  assert.strictEqual(doc.reads, 2, 'rebuilt once for the new sheet');
});

test('the index reads a rule\'s properties only when its declaration text carries a url() (the per-page build stays cheap)', () => {
  const S = fresh();
  let propReads = 0;
  const mk = (sel, props) => { const r = rule(sel, props); const g = r.style.getPropertyValue; r.style.getPropertyValue = (n) => { propReads += 1; return g(n); };
    r.style.cssText = Object.keys(props).map((k) => k + ': ' + props[k]).join('; '); return r; };
  const doc = docWith([mk('.mms-ipod-custom5-transparent-coil', { '--a': 'red', '--b': 'blue' }), mk('.mms-ipod-custom5-transparent-coil .x', { '--c': 'url(/assets/skins/x.webp)' })]);
  assert.deepStrictEqual(S.skinArtUrls('ipod-custom5-transparent-coil', { doc, landscape: false }), ['http://h/assets/skins/x.webp']);
  assert.strictEqual(propReads, 1, 'only the url() rule\'s one property was read');
});
