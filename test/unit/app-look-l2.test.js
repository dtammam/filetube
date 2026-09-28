'use strict';

// [UNIT] v1.339 (L2, plan docs/exec-plans/completed/2026-09-26-fouc-toctou-audit.md, D5):
// the app-wide look. Measured by scripts/home-fouc-probe.js; bound here:
//   1. `[hidden]` guards for `.btn` and `.queue-btn` (source lock - jsdom has no cascade)
//      + the queue button's hide/flag behaviour;
//   2. TV posters are revealed (the shimmer used to sweep forever; a 404 never cleared);
//   3. every home card thumbnail / row cover ships `art-shimmer` and each render reveals;
//   4. the grid skeleton is built from the real card's line structure;
//   5. the header / bottom-nav pre-paint reserves (the shells' inline blocks) and the
//      injectors that REPLACE a placeholder in place (or drop it);
//   6. the modern chrome paints before loadLibrary's first await;
//   7. the watch page renders Subscribe from cache only when the cache can decide it;
//   8. the books Continue shelf reserves its last size.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const stripCss = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
const flush = () => new Promise((r) => setImmediate(r));
const COMMON = require.resolve('../../public/js/common.js');

const saved = {};
function setGlobals(dom) {
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'fetch']) saved[k] = global[k];
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.sessionStorage = dom.window.sessionStorage;
  // Sweep S4 (DELIBERATE, AC12): the bell and queue panels are ui.sheets, so their injectors
  // need the page's window.ui (ui.js loads before common.js on every shell); bind it here.
  const UI = require.resolve('../../public/js/ui.js');
  delete require.cache[UI];
  require(UI);
  delete require.cache[UI]; // this instance baked in THIS window; later plain requires get a fresh one
}
let lastCommon = null;
afterEach(() => {
  // the bell injector arms a badge-poll NODE timer that would outlive the test's document
  if (lastCommon && typeof lastCommon.__stopNotificationBellPollForTests === 'function') lastCommon.__stopNotificationBellPollForTests();
  lastCommon = null;
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete global[k]; else global[k] = saved[k]; }
});
function freshCommon() {
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  lastCommon = require(COMMON); // boot is guarded (no document at require time)
  return lastCommon;
}

// ---------------------------------------------------------------- 1. [hidden] guards
test('CSS: .btn[hidden] is display:none !important AFTER its base rule; the queue button rides the global [hidden] rule', () => {
  const css = stripCss(read('public/css/style.css'));
  const guard = '.btn[hidden] { display: none !important; }';
  const g = css.indexOf(guard);
  assert.ok(g >= 0, `${guard} exists (comments stripped)`);
  assert.strictEqual(css.indexOf(guard, g + 1), -1, `${guard} is unique`);
  assert.ok(css.indexOf('\n.btn {') >= 0 && css.indexOf('\n.btn {') < g, `${guard} follows its base rule`);
  // Sweep S1 (DELIBERATE lock update, AC12): the header queue button is a ui-btn now, so its
  // own `.queue-btn[hidden]` patch went with its bespoke rule. The v1.339 bug (display:flex
  // beat [hidden], an EMPTY queue showed the button) is guarded by ui.css's one global rule,
  // and no stylesheet may give .queue-btn a display of its own again.
  const ui = stripCss(read('public/css/ui.css'));
  assert.match(ui, /(^|\n)\[hidden\] \{\s*display: none !important;\s*\}/, 'the global [hidden] rule is in ui.css');
  for (const f of ['public/css/ui.css', 'public/css/style.css']) {
    assert.doesNotMatch(stripCss(read(f)), /\.queue-btn[^{,]*\{[^}]*display\s*:/, `${f}: no rule re-displays the queue button`);
  }
});

test('queue button: an EMPTY queue hides the injected button and remembers "not shown"; a non-empty one shows + remembers', async () => {
  for (const [entries, hidden, flag] of [[[], true, '0'], [[{ uid: 'u1', mediaId: 'm1', item: { id: 'm1', title: 'A' } }], false, '1']]) {
    const c = freshCommon();
    const dom = new JSDOM('<!DOCTYPE html><header><div class="header-right"></div></header>', { url: 'http://localhost/' });
    setGlobals(dom);
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ entries, pointerUid: null }) });
    c.injectQueueChrome();
    await flush(); await flush();
    const btn = dom.window.document.getElementById('queue-btn');
    assert.ok(btn, 'the button is injected');
    assert.strictEqual(btn.hidden, hidden, `entries=${entries.length}: hidden=${hidden}`);
    assert.strictEqual(dom.window.localStorage.getItem('ft-queue-shown'), flag, 'the next launch reserve flag');
  }
});

// ---------------------------------------------------------------- 2. TV posters
function tvEnv(fetchImpl) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="view-root"><h2 id="tv-heading"></h2><div id="tv-crumb" hidden></div><div id="tv-status" hidden></div><div id="tv-empty" hidden></div><div id="tv-content"></div></div></body>', { url: 'http://localhost/tv' });
  setGlobals(dom);
  global.fetch = fetchImpl;
  const calls = [];
  let view = null;
  dom.window.FileTube = {
    registerView: (name, v) => { if (name === 'tv') view = v; },
    revealArtTogether: (scope, opts) => { calls.push({ scope, opts }); return { abort() {} }; },
  };
  const TV = require.resolve('../../public/js/tv.js');
  delete require.cache[TV];
  require(TV);
  return { dom, calls, view: () => view };
}
const json = (body) => ({ ok: true, status: 200, json: async () => body });

test('TV: the grid render and the show render each hand their posters to revealArtTogether (view signal bound)', async () => {
  const env = tvEnv(async (url) => {
    if (url === '/api/tv') return json({ shows: [{ id: 'sh1', name: 'Harbor', seasonCount: 1, episodeCount: 3 }] });
    if (url === '/api/tv/continue') return json({ episodes: [] });
    if (url === '/api/tv/sh1') return json({ id: 'sh1', name: 'Harbor', seasons: [{ seasonNum: 1, label: 'Season 1', episodes: [{ id: 'e1', seasonNum: 1, episodeNum: 1, title: 'One' }] }] });
    return json({});
  });
  env.view().init();
  for (let i = 0; i < 6; i++) await flush();
  const content = env.dom.window.document.getElementById('tv-content');
  assert.ok(content.querySelector('img.show-poster.art-shimmer'), 'the grid rendered its shimmering poster');
  assert.strictEqual(env.calls.length, 1, 'the grid render revealed once');
  assert.strictEqual(env.calls[0].scope, content, 'scoped to #tv-content');
  assert.ok(env.calls[0].opts && env.calls[0].opts.signal && env.calls[0].opts.signal.aborted === false, 'bound to the live view signal');
  content.querySelector('.show-card').dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 6; i++) await flush();
  assert.ok(content.querySelector('img.tv-detail-poster'), 'the show detail rendered');
  assert.strictEqual(env.calls.length, 2, 'the show render revealed too');
  env.view().destroy();
  assert.strictEqual(env.calls[1].opts.signal.aborted, true, 'destroy aborts the signal the reveal holds (hands every poster back)');
});

test('TV: a poster that ERRORS (404) clears its shimmer through the real reveal (never a forever-shimmer)', () => {
  const c = freshCommon();
  const dom = new JSDOM('<!DOCTYPE html><body><div id="tv-content"></div></body>', { url: 'http://localhost/' });
  setGlobals(dom);
  const content = dom.window.document.getElementById('tv-content');
  content.innerHTML = require('../../public/js/tv.js').buildShowCardHtml({ id: 'gone', name: 'Gone' });
  const poster = content.querySelector('img');
  assert.ok(poster.classList.contains('art-shimmer'), 'populated: shimmering first');
  c.revealArtTogether(content);
  poster.dispatchEvent(new dom.window.Event('error'));
  assert.strictEqual(poster.classList.contains('art-shimmer'), false, 'the error cleared the shimmer');
});

// ---------------------------------------------------------------- 3. home art
test('home: every card thumbnail and row cover ships art-shimmer (the six builders)', () => {
  const src = read('public/js/main.js');
  // UI pass sweep S2: the grid card is DOM (buildVideoCardEl) - its ui-thumb image takes the class.
  assert.match(src, /const img = thumb\.querySelector\('\.ui-thumb__img'\);\s*if \(img\) img\.classList\.add\('art-shimmer'\);/, 'buildVideoCardEl thumbnail');
  const m = require('../../public/js/main.js');
  // the row builders read common.js's resolveChannelName (a shell global) - stub it
  const hadResolve = 'resolveChannelName' in global;
  if (!hadResolve) global.resolveChannelName = (item) => (item && item.folderName) || '';
  let covers;
  try {
  covers = [
    m.buildBookRowCardHtml({ id: 'b', title: 'B' }),
    m.buildMusicRowCardHtml({ id: 't', title: 'T' }),
    m.buildPodcastRowCardHtml({ id: 'e', subId: 's', title: 'E' }),
    m.buildVideoRowCardHtml({ id: 'v', title: 'V', folderName: 'F' }),
    m.buildFeedCardHtml({ id: 'f', title: 'F', thumbnailUrl: '/thumbnail/f', href: '/watch.html?v=f' }),
  ];
  } finally { if (!hadResolve) delete global.resolveChannelName; }
  for (const html of covers) assert.match(html, /<img class="art-shimmer" src=/, html.slice(0, 80));
});

test('home: revealHomeArt hands the scope (+ signal) to revealArtTogether, else falls back to shimmerArt', () => {
  const { revealHomeArt } = require('../../public/js/main.js');
  const saw = [];
  const prevWindow = global.window;
  try {
    global.window = { FileTube: { revealArtTogether: (s, o) => saw.push(['together', s, o]), shimmerArt: (s) => saw.push(['shimmer', s]) } };
    const sig = { aborted: false };
    revealHomeArt('grid', sig);
    revealHomeArt('rows');
    global.window = { FileTube: { shimmerArt: (s) => saw.push(['shimmer', s]) } };
    revealHomeArt('old');
  } finally { global.window = prevWindow; }
  assert.deepStrictEqual(saw[0].slice(0, 2), ['together', 'grid']);
  assert.strictEqual(saw[0][2].signal.aborted, false, 'the signal rides along');
  assert.deepStrictEqual(saw[1], ['together', 'rows', undefined]);
  assert.deepStrictEqual(saw[2], ['shimmer', 'old'], 'an older common.js keeps the per-image reveal');
});

test('home: EVERY grid/row render and append reveals right after it writes (source lock, comments stripped)', () => {
  const src = stripJs(read('public/js/main.js'));
  // UI pass sweep S2: every grid write (classic page 0 + append, modern page 0 +
  // append) goes through putCards, which reveals right after it writes.
  const sites = [
    /if \(append\) videoGrid\.appendChild\(frag\);\s*else videoGrid\.replaceChildren\(frag\);\s*revealHomeArt\(videoGrid, signal\);/, // putCards: every grid render + append
    /putCards\(items, false\);/, // classic/folder/search/Liked page 0 (and the modern page 0)
    /putCards\(items, true\);/, // classic append (appendCardsToGrid)
    /putCards\(fresh, true\);/, // modern append
    /host\.innerHTML = html \|\| '';\s*revealHomeArt\(host\);/, // Continue rows
    /host\.innerHTML = rows\.map\(buildFeedRowHtml\)\.join\(''\);\s*revealHomeArt\(host, signal\);/, // feed
    /encodeURIComponent\(searchQuery\),\s*\);\s*revealHomeArt\(booksRowHost, signal\);/, // search books row
  ];
  assert.ok(!/videoGrid\.innerHTML = items|videoGrid\.insertAdjacentHTML/.test(src), 'no grid write bypasses putCards');
  for (const re of sites) assert.match(src, re, String(re).slice(0, 90));
  assert.strictEqual((src.match(/revealHomeArt\(/g) || []).length, 5, 'putCards + the three row/feed sites + the definition (a new render site must join)');
});

// ---------------------------------------------------------------- 4. grid skeleton
test('buildSkeletonGrid: each card is built from the REAL card line structure (ui-thumb, 2-line title, uploader, meta, stars)', () => {
  // UI pass sweep S2 (D9, F63): built by buildSkeletonCardEl from the same primitives as the card.
  const { buildSkeletonGrid } = require('../../public/js/main.js');
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const g = new JSDOM(`<div id="g">${buildSkeletonGrid(2, { doc })}</div>`).window.document;
  const cards = g.querySelectorAll('#g > .video-card.skeleton-card[aria-hidden="true"]');
  assert.strictEqual(cards.length, 2);
  for (const card of cards) {
    const text = card.querySelector(':scope > .video-info > .card-text');
    assert.ok(card.querySelector(':scope > .card-media > .ui-thumb.ui-thumb--16x9.skeleton-shimmer'), 'the real 16:9 ui-thumb box');
    const kids = Array.from(text.children).map((k) => k.className.split(' ')[0]);
    assert.deepStrictEqual(kids, ['video-title', 'video-uploader', 'video-meta', 'card-rating'], 'the real info rows, in order');
    assert.strictEqual(text.querySelectorAll('.video-title > .skeleton-text').length, 2, 'the title reserves TWO lines');
    assert.ok(text.querySelector('.video-title > br'), 'the two title lines are separate line boxes');
    assert.strictEqual(card.querySelector('.ui-avatar'), null, 'no avatar on a classic card');
  }
  const modern = new JSDOM(buildSkeletonGrid(1, { avatar: true, doc })).window.document;
  assert.ok(modern.querySelector('.video-info > .ui-avatar.ui-avatar--sm.skeleton-shimmer + .card-text'), 'Modern: the byline avatar reserve sits where the real avatar does');
});

test('CSS: a .skeleton-text bar is one transparent line box, top-aligned (baseline + overflow:hidden would grow the line)', () => {
  const css = stripCss(read('public/css/style.css'));
  const rule = /\n\.skeleton-text \{([^}]*)\}/.exec(css);
  assert.ok(rule, '.skeleton-text rule exists');
  assert.match(rule[1], /display: inline-block;/);
  assert.match(rule[1], /color: transparent;/);
  assert.match(rule[1], /vertical-align: top;/);
  assert.doesNotMatch(read('public/js/main.js'), /produces zero\s*\n?\/\/ layout shift/, 'the old false "zero layout shift" claim is gone');
});

// ---------------------------------------------------------------- 5. pre-paint reserves
const SHELLS = ['public/index.html', 'public/watch.html', 'public/stats.html', 'public/setup.html', 'public/read.html', 'public/books.html',
  'public/music.html', 'public/history.html', 'public/tv.html', 'public/podcasts.html', 'lib/ytdlp/views/subscriptions.html'];
function block(html, kind) {
  const start = html.indexOf(`<!-- ft-chrome-reserve:${kind} (v1.339 L2) -->`);
  if (start < 0) return null;
  const end = html.indexOf('</script>', start) + '</script>'.length;
  return { start, end, text: html.slice(start, end) };
}

test('reserve blocks: every header shell (discovered, not listed) carries BOTH blocks, byte-identical, right after </header> and the bottom nav', () => {
  const discovered = fs.readdirSync(path.join(REPO, 'public')).filter((f) => f.endsWith('.html'))
    .map((f) => 'public/' + f).filter((f) => read(f).includes('class="header-right"'));
  discovered.push('lib/ytdlp/views/subscriptions.html');
  assert.ok(discovered.length >= 11, `found ${discovered.length} header shells (floor 11)`);
  assert.deepStrictEqual(discovered.slice().sort(), SHELLS.slice().sort(), 'the shell set is the one this test lists');
  let ref = null;
  for (const shell of discovered) {
    const html = read(shell);
    const h = block(html, 'header'); const n = block(html, 'nav');
    assert.ok(h && n, `${shell}: both blocks`);
    assert.strictEqual(html.indexOf('ft-chrome-reserve:header', h.start + 10), -1, `${shell}: one header block`);
    assert.strictEqual(html.slice(0, h.start).trimEnd().endsWith('</header>'), true, `${shell}: the header block follows </header>`);
    const navOpen = html.indexOf('id="bottom-nav"');
    assert.ok(navOpen > 0 && html.slice(navOpen, n.start).trimEnd().endsWith('</nav>'), `${shell}: the nav block follows the bottom nav`);
    // UI pass step 2: icons.js (the sprite) is the one external script in <head>, by design:
    // the reserves must still run before the first external script in <body>.
    assert.ok(n.end < html.indexOf('<script src=', html.indexOf('<body')), `${shell}: both run before the first external script in <body>`);
    if (!ref) ref = { h: h.text, n: n.text };
    assert.strictEqual(h.text, ref.h, `${shell}: header block byte-identical`);
    assert.strictEqual(n.text, ref.n, `${shell}: nav block byte-identical`);
  }
});

test('reserve blocks: their glyphs are the sprite icons common.js builds (no drift)', () => {
  // UI pass step 2 (DELIBERATE lock update): the reserves draw <use href="#i-NAME"> from the
  // icon sprite, like the injectors they stand in for; bind each to the SAME registry name
  // common.js's CHROME_ICON map gives the real glyph.
  const c = freshCommon();
  const html = read('public/index.html');
  const h = block(html, 'header').text; const n = block(html, 'nav').text;
  for (const name of ['search', 'download', 'queue']) {
    assert.ok(h.includes(`svg('${c.CHROME_ICON[name]}'`), `header block ${name} glyph`);
  }
  for (const name of ['refresh', 'download']) {
    assert.ok(n.includes(`svg('${c.CHROME_ICON[name]}'`), `nav block ${name} glyph`);
  }
  assert.ok(h.includes("u.setAttribute('href', '#i-' + name)") && n.includes("u.setAttribute('href', '#i-' + name)"), 'both draw from the sprite');
});

// Parse index.html with its inline scripts (external scripts are never fetched by jsdom).
function shellDom(flags, shell) {
  return new JSDOM(read(shell || 'public/index.html'), {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    beforeParse(w) { for (const [k, v] of Object.entries(flags || {})) w.localStorage.setItem(k, v); },
  });
}
const kidsOf = (el) => Array.from(el.children).map((k) => k.getAttribute('data-ft-reserve') || k.id || k.className);

test('header block: paints queue / bell / search / download / account placeholders from the flags, in the final order', () => {
  const dom = shellDom({ 'ft-queue-shown': '1', 'ft-notif-bell-enabled': '1', 'ft-ytdlp-module': '1' });
  const hr = dom.window.document.querySelector('.header-right');
  assert.deepStrictEqual(kidsOf(hr), ['queue', 'notif-bell-placeholder', 'search', 'download', 'account-menu-placeholder']);
  // Sweep S1 (DELIBERATE lock update): each placeholder is the real control's ui-btn box.
  assert.ok(hr.querySelector('[data-ft-reserve="queue"].ui-btn.ui-btn--plain.ui-btn--md.ui-btn--icon.queue-btn > .ui-btn__icon > svg.ui-icon.ui-icon--md'), 'the queue box = the real ui-btn icon button');
  assert.ok(hr.querySelector('#notif-bell-placeholder.ui-btn.ui-btn--icon.notif-bell-btn > .ui-btn__icon > .notif-bell-skel'), 'the bell box = the real ui-btn, a shimmer disc in its icon slot');
  assert.ok(hr.querySelector('[data-ft-reserve="download"].ui-btn.ui-btn--icon.oneoff-download-btn > .ui-btn__icon > svg.ui-icon'), 'the download box = the real icon-only ui-btn (no label since S1)');
  assert.ok(hr.querySelector('#account-menu-placeholder.account-menu > .ui-btn.ui-btn--icon.account-menu-trigger > .ui-avatar.ui-avatar--sm.account-avatar'), 'the account slot mirrors the real root');
  const none = shellDom({ 'ft-queue-shown': '0', 'ft-ytdlp-module': '0' });
  assert.deepStrictEqual(kidsOf(none.window.document.querySelector('.header-right')), ['search', 'account-menu-placeholder'], 'no flag -> no reserve (first-ever / feature off)');
});

test('nav block: lays the bar out as it last resolved - statics shown/hidden + ordered, async tabs reserved', () => {
  const dom = shellDom({ 'ft-bottomnav-last': JSON.stringify(['home', 'playlists', 'history', 'oneoff-download', 'subscriptions', 'you']) });
  const nav = dom.window.document.getElementById('bottom-nav');
  const visible = Array.from(nav.querySelectorAll('.bottom-nav-item')).filter((e) => !e.hidden)
    .map((e) => e.getAttribute('data-nav') || 'reserve:' + e.getAttribute('data-ft-reserve'));
  assert.deepStrictEqual(visible, ['home', 'playlists', 'history', 'reserve:oneoff-download', 'reserve:subscriptions', 'reserve:you']);
  assert.strictEqual(nav.querySelector('[data-nav="settings"]').hidden, true, 'a static item the layout dropped is hidden pre-paint');
  assert.ok(nav.querySelector('a[data-ft-reserve="subscriptions"][href="/subscriptions"].ui-btn.ui-btn--stack.bottom-nav-item > .ui-btn__icon > svg.ui-icon.ui-icon--lg'), 'Subs reserve: a working link, the real tab box with its inline glyph');
  assert.ok(nav.querySelector('[data-ft-reserve="you"] > .ui-btn__icon > .ui-avatar.ui-avatar--xs'), 'You reserve: the avatar disc in the fixed icon slot');
  const junk = shellDom({ 'ft-bottomnav-last': '["<img>", 42]' });
  assert.strictEqual(junk.window.document.querySelector('#bottom-nav [data-nav="settings"]').hidden, false, 'an unusable layout leaves the static bar alone');
});

// Run the injectors over a parsed shell (reserves painted) with stubbed fetches.
function bootShell(flags, routes) {
  const dom = shellDom(flags);
  const c = freshCommon();
  setGlobals(dom);
  global.fetch = async (url) => {
    const r = routes[url.split('?')[0]];
    if (r === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (r instanceof Error) throw r;
    return r;
  };
  return { dom, c, doc: dom.window.document };
}
const ALL_FLAGS = { 'ft-queue-shown': '1', 'ft-notif-bell-enabled': '1', 'ft-ytdlp-module': '1',
  'ft-bottomnav-last': JSON.stringify(['home', 'playlists', 'history', 'oneoff-download', 'subscriptions', 'you']) };
const ME = json({ user: { id: 1, username: 'Dean', role: 'admin' }, settings: {} });

test('injectors REPLACE their placeholders in place: the header and the bar keep their order, no reserve survives', async () => {
  const { c, doc } = bootShell(ALL_FLAGS, {
    '/api/queue': json({ entries: [{ uid: 'u', mediaId: 'm', item: { id: 'm', title: 'A' } }] }),
    '/api/notifications/badge': json({ count: 0 }),
    '/api/subscriptions/health': json({ enabled: true }),
    '/api/auth/me': ME,
  });
  doc.defaultView.localStorage.setItem('ft-bottomnav-last', '["stale"]'); // the reserves are painted; now prove apply RE-writes it
  c.wireSearchAffordances();
  c.injectYouNavItem();
  c.injectSubscriptionsNavLinkIfEnabled();
  c.applyBottomNavCustomization();
  c.injectOneOffDownloadButtonIfEnabled();
  c.injectNotificationBellIfEnabled();
  c.injectQueueChrome();
  c.injectAccountMenu();
  for (let i = 0; i < 10; i++) await flush();
  const hr = doc.querySelector('.header-right');
  assert.deepStrictEqual(kidsOf(hr), ['queue-btn', 'notif-bell-btn', 'search-toggle-btn', 'ytdlp-oneoff-btn', 'account-menu-root'], 'each real control took its placeholder\'s slot');
  const nav = doc.getElementById('bottom-nav');
  const visible = Array.from(nav.querySelectorAll('.bottom-nav-item')).filter((e) => !e.hidden).map((e) => e.getAttribute('data-nav'));
  assert.deepStrictEqual(visible, ['home', 'playlists', 'history', 'oneoff-download', 'subscriptions', 'you']);
  assert.strictEqual(doc.querySelectorAll('[data-ft-reserve]').length, 0, 'no placeholder survives');
  assert.ok(nav.querySelector('[data-nav="subscriptions"] > .ui-btn__icon > svg.ui-icon') && nav.querySelector('[data-nav="oneoff-download"] > .ui-btn__icon > svg.ui-icon'),
    'Subs + Download tabs carry the inline sprite glyph (no iOS mask decode lag)');
  assert.strictEqual(nav.querySelector('[data-nav="subscriptions"] i, [data-nav="oneoff-download"] i'), null, 'the old mask <i> glyphs are gone');
  assert.deepStrictEqual(JSON.parse(doc.defaultView.localStorage.getItem('ft-bottomnav-last')), visible, 'the resolved bar is remembered for the next launch');
  assert.strictEqual(doc.defaultView.localStorage.getItem('ft-ytdlp-module'), '1');
});

test('a feature that is gone DROPS its placeholder (module off, empty queue answer lost, signed out)', async () => {
  const { c, doc } = bootShell(ALL_FLAGS, {
    '/api/queue': new Error('offline'),
    '/api/notifications/badge': { ok: false, status: 404, json: async () => ({}) },
    '/api/auth/me': { ok: false, status: 401, json: async () => ({}) },
    // /api/subscriptions/health -> 404 (module disabled)
  });
  c.injectYouNavItem();
  c.injectSubscriptionsNavLinkIfEnabled();
  c.injectOneOffDownloadButtonIfEnabled();
  c.injectNotificationBellIfEnabled();
  c.injectQueueChrome();
  c.injectAccountMenu();
  for (let i = 0; i < 10; i++) await flush();
  assert.strictEqual(doc.querySelectorAll('[data-ft-reserve]:not([data-ft-reserve="search"])').length, 0, 'queue / download / subs / oneoff-download / you reserves all dropped');
  assert.strictEqual(doc.getElementById('notif-bell-placeholder'), null, 'bell placeholder dropped');
  assert.strictEqual(doc.getElementById('account-menu-placeholder'), null, 'account placeholder dropped');
  assert.strictEqual(doc.defaultView.localStorage.getItem('ft-ytdlp-module'), '0', 'the module-off answer is remembered');
});

test('#140: with no placeholders, the queue lands LEFT of the bell whichever fetch resolves first', async () => {
  for (const bellFirst of [true, false]) {
    const dom = new JSDOM('<!DOCTYPE html><header><div class="header-right"></div></header>', { url: 'http://localhost/' });
    const c = freshCommon();
    setGlobals(dom);
    const gates = {};
    const gate = (k) => new Promise((r) => { gates[k] = r; });
    const qP = gate('q'); const bP = gate('b');
    global.fetch = async (url) => {
      if (url === '/api/queue') { await qP; return json({ entries: [{ uid: 'u', mediaId: 'm', item: { id: 'm', title: 'A' } }] }); }
      if (url === '/api/notifications/badge') { await bP; return json({ count: 0 }); }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    c.injectNotificationBellIfEnabled();
    c.injectQueueChrome();
    if (bellFirst) { gates.b(); for (let i = 0; i < 6; i++) await flush(); gates.q(); } else { gates.q(); for (let i = 0; i < 6; i++) await flush(); gates.b(); }
    for (let i = 0; i < 8; i++) await flush();
    assert.deepStrictEqual(kidsOf(dom.window.document.querySelector('.header-right')), ['queue-btn', 'notif-bell-btn'], `bellFirst=${bellFirst}`);
    c.__stopNotificationBellPollForTests();
  }
});

test('Download lands LEFT of the account avatar even when the account resolves first (no placeholder)', async () => {
  const dom = new JSDOM('<!DOCTYPE html><header><div class="header-right"></div></header><nav id="bottom-nav"><a class="bottom-nav-item" data-nav="settings"></a></nav>', { url: 'http://localhost/' });
  const c = freshCommon();
  setGlobals(dom);
  let release;
  const healthGate = new Promise((r) => { release = r; });
  global.fetch = async (url) => {
    if (url === '/api/auth/me') return ME;
    if (url === '/api/subscriptions/health') { await healthGate; return json({ enabled: true }); }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  c.injectOneOffDownloadButtonIfEnabled();
  c.injectAccountMenu();
  for (let i = 0; i < 6; i++) await flush();
  release();
  for (let i = 0; i < 6; i++) await flush();
  assert.deepStrictEqual(kidsOf(dom.window.document.querySelector('.header-right')), ['ytdlp-oneoff-btn', 'account-menu-root']);
});

test('the per-user reserve flags are dropped on sign-out and on login', () => {
  const fn = read('public/js/common.js');
  const signOut = fn.slice(fn.indexOf('function accountSignOut'), fn.indexOf("window.location.href = '/login'", fn.indexOf('function accountSignOut')));
  const login = read('public/js/login.js');
  for (const key of ['ft-queue-shown', 'ft-bottomnav-last', 'ft-books-continue-count']) {
    assert.match(signOut, new RegExp(`removeItem\\('${key}'\\)`), `sign-out drops ${key}`);
    assert.match(login, new RegExp(`removeItem\\('${key}'\\)`), `login drops ${key}`);
  }
});

test('apply at boot keeps a reserve IN its slot, even when the user\'s order puts an async tab first', () => {
  const last = ['subscriptions', 'home', 'playlists', 'history', 'oneoff-download', 'you'];
  const { c, doc } = bootShell({ 'ft-bottomnav-last': JSON.stringify(last),
    'ft-bottomnav': JSON.stringify({ order: ['subscriptions', 'home', 'playlists', 'history', 'oneoff-download'], hidden: [], shown: [] }) }, {});
  c.applyBottomNavCustomization(); // the DOMContentLoaded apply, before any tab has landed
  const visible = Array.from(doc.getElementById('bottom-nav').querySelectorAll('.bottom-nav-item')).filter((e) => !e.hidden)
    .map((e) => e.getAttribute('data-nav') || e.getAttribute('data-ft-reserve'));
  assert.deepStrictEqual(visible, last, 'the bar resolves exactly as it painted (no re-space at DOMContentLoaded)');
});

test('the account menu takes its placeholder\'s SLOT (a later sibling stays after it)', async () => {
  const dom = new JSDOM('<!DOCTYPE html><header><div class="header-right"></div></header>', { url: 'http://localhost/' });
  const c = freshCommon();
  setGlobals(dom);
  global.fetch = async (url) => (url === '/api/auth/me' ? ME : { ok: false, status: 404, json: async () => ({}) });
  c.injectAccountMenu();
  const hr = dom.window.document.querySelector('.header-right');
  const later = dom.window.document.createElement('span');
  later.id = 'later';
  hr.appendChild(later);
  for (let i = 0; i < 6; i++) await flush();
  assert.deepStrictEqual(kidsOf(hr), ['account-menu-root', 'later']);
});

test('#140: the queue lands right before the bell PLACEHOLDER (not at firstChild, ahead of the modern sort glyph)', async () => {
  const dom = new JSDOM('<!DOCTYPE html><header><div class="header-right"></div></header>', { url: 'http://localhost/' });
  const c = freshCommon();
  setGlobals(dom);
  dom.window.localStorage.setItem('ft-notif-bell-enabled', '1');
  global.fetch = async (url) => {
    if (url === '/api/queue') return json({ entries: [{ uid: 'u', mediaId: 'm', item: { id: 'm', title: 'A' } }] });
    return new Promise(() => {}); // the bell badge never answers inside this test
  };
  c.injectNotificationBellIfEnabled(); // DOMContentLoaded: the bell placeholder
  c.injectQueueChrome();
  // then the home view's init mounts the modern sort glyph at firstChild (injectModernHeaderSort)
  const sort = dom.window.document.createElement('div');
  sort.className = 'modern-sort';
  const hr = dom.window.document.querySelector('.header-right');
  hr.insertBefore(sort, hr.firstChild);
  for (let i = 0; i < 6; i++) await flush();
  assert.deepStrictEqual(kidsOf(hr), ['modern-sort', 'queue-btn', 'notif-bell-placeholder']);
});

test('a Subs reserve painted from the LAYOUT (module flag not on) is dropped when the module answers off', async () => {
  const { c, doc } = bootShell({ 'ft-ytdlp-module': '0', 'ft-bottomnav-last': JSON.stringify(['home', 'playlists', 'history', 'subscriptions']) }, {});
  assert.ok(doc.querySelector('[data-ft-reserve="subscriptions"]'), 'populated: the reserve is painted');
  c.injectSubscriptionsNavLinkIfEnabled();
  for (let i = 0; i < 6; i++) await flush();
  assert.strictEqual(doc.querySelector('[data-ft-reserve="subscriptions"]'), null, 'dropped on the 404');
  assert.strictEqual(doc.querySelector('[data-nav="subscriptions"]'), null, 'and nothing injected');
});

// ---------------------------------------------------------------- 6. modern chrome
test('modern chrome (header sort/toggle, chips, avatar-bar reserve) paints BEFORE loadLibrary\'s first await', () => {
  const src = stripJs(read('public/js/main.js'));
  const start = src.indexOf('async function loadLibrary()');
  const firstAwait = src.indexOf('await ', start);
  const mount = src.indexOf('if (modernMode) mountModernChrome(modernChromeHost, signal);', start);
  assert.ok(mount > start && mount < firstAwait, 'mountModernChrome runs before the first await');
  const fnStart = src.indexOf('function mountModernChrome(');
  const fnBody = src.slice(fnStart, src.indexOf('async function renderModernHome(', fnStart));
  assert.match(fnBody, /buildModernChipRowHtml\(activeModernChip\)/, 'the chips');
  assert.match(fnBody, /readModernAvatarBarCount\(\)[\s\S]*buildAvatarBarSkeleton\(seedN\)/, 'the avatar-bar reserve');
  assert.doesNotMatch(fnBody, /await |fetch\(/, 'nothing in the mount waits');
});

// ---------------------------------------------------------------- 7. watch Subscribe cache
test('cachedSubscribeState: renders from cache only when the cache can DECIDE the state', () => {
  const c = freshCommon();
  assert.strictEqual(c.cachedSubscribeState(null), null);
  assert.strictEqual(c.cachedSubscribeState({ ts: 1 }), null, 'no module answer');
  assert.strictEqual(c.cachedSubscribeState({ moduleEnabled: true }), null, 'module on but NO subs (a nav probe wrote only moduleEnabled) -> undecidable');
  assert.strictEqual(c.cachedSubscribeState({ moduleEnabled: true, subs: 'x' }), null);
  const subs = [{ channelUrl: 'https://www.youtube.com/@a' }];
  assert.deepStrictEqual(c.cachedSubscribeState({ moduleEnabled: true, subs }), { moduleEnabled: true, subs });
  assert.deepStrictEqual(c.cachedSubscribeState({ moduleEnabled: true, subs: [] }), { moduleEnabled: true, subs: [] }, 'an empty list IS an answer');
  assert.deepStrictEqual(c.cachedSubscribeState({ moduleEnabled: false }), { moduleEnabled: false, subs: [] }, 'module off decides alone');
});

test('the nav probe writes a moduleEnabled-only cache, which the watch gate then REFUSES (the real upstream shape)', async () => {
  const c = freshCommon();
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  setGlobals(dom);
  global.fetch = async () => json({ enabled: true });
  c.injectSubscriptionsNavLinkIfEnabled();
  for (let i = 0; i < 4; i++) await flush();
  const cap = c.readCapabilityCache();
  assert.strictEqual(cap.moduleEnabled, true, 'the probe wrote the cache');
  assert.strictEqual(cap.subs, undefined, 'with no subs');
  assert.strictEqual(c.cachedSubscribeState(cap), null, 'so the watch page renders nothing from it');
  const watch = stripJs(read('public/js/watch.js'));
  assert.strictEqual((watch.match(/cachedSubscribeState\(/g) || []).length, 2, 'both cached render sites go through the gate');
});

// ---------------------------------------------------------------- 8. books Continue shelf
test('books: the Continue shelf reserves its remembered size synchronously, fills in place, remembers the new size', async () => {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="view-root"><div id="books-continue-section" hidden><div id="books-continue-grid"></div></div><div id="books-grid"></div><div id="books-empty" hidden></div></div></body>', { url: 'http://localhost/books' });
  setGlobals(dom);
  dom.window.localStorage.setItem('ft-books-continue-count', '3');
  let resolveReading;
  const reading = new Promise((r) => { resolveReading = r; });
  global.fetch = async (url) => {
    if (url.startsWith('/api/books?filter=reading')) { await reading; return json({ items: [{ id: 'a', title: 'A', format: 'pdf' }, { id: 'b', title: 'B', format: 'pdf' }] }); }
    if (url.startsWith('/api/books/folders')) return json({ folders: [] });
    return json({ items: [] });
  };
  let view = null;
  dom.window.FileTube = { registerView: (n, v) => { if (n === 'books') view = v; } };
  const BOOKS = require.resolve('../../public/js/books.js');
  delete require.cache[BOOKS];
  require(BOOKS);
  view.init(dom.window.document.getElementById('view-root'));
  const section = dom.window.document.getElementById('books-continue-section');
  const grid = dom.window.document.getElementById('books-continue-grid');
  assert.strictEqual(section.hidden, false, 'reserved synchronously (before the fetch)');
  assert.strictEqual(grid.querySelectorAll('.book-card[aria-hidden="true"]').length, 3, 'exactly the remembered size');
  resolveReading();
  for (let i = 0; i < 6; i++) await flush();
  assert.strictEqual(grid.querySelectorAll('.book-card[aria-hidden="true"]').length, 0, 'the skeleton is replaced');
  assert.strictEqual(grid.querySelectorAll('.book-card').length, 2, 'by the real cards');
  assert.strictEqual(dom.window.localStorage.getItem('ft-books-continue-count'), '2', 'the new size is remembered');
  view.destroy();
});

test('books: no remembered size -> no reserve; an emptied shelf collapses and remembers 0', async () => {
  const { reserveBooksContinueShelf, writeBooksContinueCount, readBooksContinueCount } = require('../../public/js/books.js');
  const dom = new JSDOM('<div id="s" hidden><div id="g"></div></div>', { url: 'http://localhost/' });
  setGlobals(dom);
  const s = dom.window.document.getElementById('s'); const g = dom.window.document.getElementById('g');
  assert.strictEqual(reserveBooksContinueShelf(s, g), false);
  assert.strictEqual(s.hidden, true, 'nothing reserved on a first visit');
  writeBooksContinueCount(99);
  assert.strictEqual(readBooksContinueCount(), 12, 'capped at the shelf limit');
  writeBooksContinueCount(0);
  assert.strictEqual(reserveBooksContinueShelf(s, g), false, 'a remembered empty shelf reserves nothing (no reverse-collapse)');
});
