'use strict';

// [UNIT] UI professionalism pass, sweep S6 (Podcasts). Boots the REAL podcasts view (with the
// REAL ui.js primitives, as every shell loads them) in jsdom and binds the migrated surface by
// BEHAVIOUR:
//   - the destructive paths (Move to Trash, Unsubscribe): one tap opens ui.confirm (danger),
//     and the SAME API as before runs only after the confirm resolves true - never on Cancel,
//     Esc, the scrim or Close, and exactly once on a double-tapped confirm;
//   - F42 / D4.4: show art is a ui-art rounded square (never the circle), a yt-dlp show with no
//     art draws the monogram, a broken image falls back to the monogram;
//   - AC5: every RSS episode row renders the same two reserved action slots, the kebab always in
//     the second, whatever the episode's state;
//   - F27: Played is quiet meta text; the like lives in the menu (POST, then DELETE);
//   - F41: Pin is BUSY (full opacity, not disabled) while the pins load;
//   - D9: a failed load is an error state; the skeletons are the real list's classes.

const commonJs = require('../../public/js/common.js'); // v1.376.0: the share link podcasts.js reads
const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const podcastsPath = require.resolve('../../public/js/podcasts.js');
const uiPath = require.resolve('../../public/js/ui.js');

const VIEW_HTML = `<body><div id="view-root" data-view="podcasts">
  <button class="ui-btn ui-btn--primary ui-btn--sm" id="podcasts-add-btn" type="button"><span class="ui-btn__label">Add podcast</span></button>
  <button class="ui-btn ui-btn--tonal ui-btn--sm" id="podcasts-settings-btn" type="button"><span class="ui-btn__label">Settings</span></button>
  <div id="podcast-stage" class="music-stage"><div id="player-slot"></div><div id="podcast-nowplaying-panel" hidden></div></div>
  <div class="music-crumb" id="podcasts-crumb" hidden></div>
  <div id="podcasts-status" role="status" hidden></div>
  <div id="podcasts-content"></div>
  <div id="podcasts-empty" hidden></div>
</div></body>`;

const SHOWS = [
  { id: 's1', name: 'Harbor Lights Radio', author: 'Marrow Lane', episodeCount: 4, downloadedCount: 2, lastStatus: 'ok' },
  { id: 'yt:a', name: 'No Art Channel', source: 'ytdlp', artUrl: null, episodeCount: 1, downloadedCount: 1 },
  { id: 'yt:b', name: 'Avatar Channel', source: 'ytdlp', artUrl: 'https://yt3.example.com/a.jpg', episodeCount: 1, downloadedCount: 1 },
];
const EPS = [
  { id: 'e1', subId: 's1', title: 'Pilot', status: 'downloaded', pubDateMs: Date.UTC(2026, 7, 2), durationSec: 1800, liked: false, played: false },
  { id: 'e2', subId: 's1', title: 'Trashed one', status: 'trashed', durationSec: 60, played: false },
  { id: 'e3', subId: 's1', title: 'Queued one', status: 'pending', durationSec: 60, played: false },
  { id: 'e4', subId: 's1', title: 'Heard it', status: 'downloaded', durationSec: 600, played: true },
];

const settle = () => new Promise((r) => setImmediate(r));
async function settleMany(n) { for (let i = 0; i < (n || 10); i++) await settle(); }

async function boot(opts, run) {
  opts = opts || {};
  const dom = new JSDOM(VIEW_HTML, { url: opts.url || 'http://localhost/podcasts' });
  const w = dom.window;
  const saved = {
    window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch,
    AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame,
  };
  const calls = [];
  const bodies = [];
  let registered = null;
  global.window = w; global.document = w.document; global.localStorage = w.localStorage;
  global.AbortController = w.AbortController;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  w.FileTube = {
    registerView: (n, m) => { registered = m; }, shimmerArt: () => {}, pushViewState: () => {},
    player: { currentId: null, getState: () => 'closed', getCurrentMeta: () => null, load() {}, expand() {}, setTrackNav() {} },
  };
  w.addToQueue = (id) => { calls.push('QUEUE ' + id); };
  // a common.js global podcasts.js reads (the shared classic-script scope in a browser).
  w.podcastShareUrl = commonJs.podcastShareUrl;
  global.fetch = (url, init) => {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    calls.push(method + ' ' + u);
    if (init && init.body) bodies.push({ url: u, body: JSON.parse(init.body) });
    if (opts.hold && opts.hold.url === u) return opts.hold.promise.then(() => reply(opts.hold.body));
    if (opts.failShows && u === '/api/podcasts/shows') return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    let body = {};
    if (u === '/api/podcasts/shows') body = { shows: SHOWS };
    else if (/\/api\/podcasts\/shows\/[^/]+\/episodes$/.test(u)) body = { show: SHOWS[0], episodes: EPS.map((e) => Object.assign({}, e)) };
    else if (u === '/api/podcasts/pins') body = opts.pins || [];
    return Promise.resolve(reply(body));
  };
  function reply(body) { return { ok: true, status: 200, json: () => Promise.resolve(body) }; }
  try {
    delete require.cache[uiPath]; require(uiPath);
    delete require.cache[podcastsPath]; require(podcastsPath);
    registered.init(w.document.getElementById('view-root'));
    await settleMany();
    await run({ w, d: w.document, calls, bodies, registered, content: () => w.document.getElementById('podcasts-content') });
    registered.destroy();
    // A closing ui.sheet finishes on a fallback timer (~320ms in jsdom, no transitionend); let
    // every one finish while this window is still the global, so none outlives the test.
    for (let i = 0; i < 60 && w.document.querySelector('.ui-sheet'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(w.document.querySelector('.ui-sheet'), null, 'no sheet outlives the view');
  } finally {
    delete require.cache[podcastsPath];
    Object.assign(global, saved);
  }
}

const deletes = (calls, url) => calls.filter((c) => c === 'DELETE ' + url).length;
const lastOf = (d, sel) => { const all = d.querySelectorAll(sel); return all[all.length - 1] || null; };
function openShow(c, id) {
  c.content().querySelector('[data-show-id="' + id + '"]').click();
}
function menuRow(c, label) {
  const menu = lastOf(c.d, '.ui-sheet--popover, .ui-sheet--bottom');
  assert.ok(menu, 'the episode menu opened');
  const row = Array.from(menu.querySelectorAll('.ui-row')).find((r) => r.textContent.trim() === label);
  assert.ok(row, 'menu item "' + label + '" exists');
  return row;
}
function openMenuFor(c, epId) {
  const row = c.content().querySelector('[data-episode-id="' + epId + '"]');
  row.querySelector('[data-episode-more]').click();
}
function confirmDialog(c) {
  const dlg = lastOf(c.d, '.ui-sheet--dialog');
  assert.ok(dlg, 'a confirm dialog opened');
  const btns = dlg.querySelectorAll('.ui-confirm__actions .ui-btn');
  return { dlg, cancel: btns[0], ok: btns[1] };
}

// ---- the destructive paths ---------------------------------------------------------------------

test('Move to Trash: one tap opens a DANGER confirm; the DELETE runs only after it resolves true', async () => {
  await boot({}, async (c) => {
    openShow(c, 's1');
    await settleMany();
    const URL = '/api/podcasts/episodes/e1';

    // Every dismissal resolves false and fetches nothing.
    for (const dismiss of ['cancel', 'escape', 'scrim', 'close']) {
      openMenuFor(c, 'e1');
      menuRow(c, 'Move to Trash').click();
      await settleMany();
      const k = confirmDialog(c);
      assert.ok(k.ok.classList.contains('ui-btn--destructive'), 'the confirm is the danger fill');
      assert.match(k.dlg.textContent, /Move to Trash\?/);
      assert.match(k.dlg.textContent, /Pilot/, 'the confirm names the episode');
      assert.strictEqual(deletes(c.calls, URL), 0, 'opening the confirm deletes nothing');
      if (dismiss === 'cancel') k.cancel.click();
      else if (dismiss === 'escape') c.d.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (dismiss === 'scrim') lastOf(c.d, '.ui-scrim').click();
      else k.dlg.querySelector('.ui-sheet__close').click();
      await settleMany();
      assert.strictEqual(deletes(c.calls, URL), 0, dismiss + ' never deletes');
      // A confirm tapped on the closing dialog must not flip the answer (ui.confirm contract).
      k.ok.click();
      await settleMany();
      assert.strictEqual(deletes(c.calls, URL), 0, dismiss + ' then a late OK tap never deletes');
    }

    // Confirmed: exactly one DELETE to the same route as before, even on a double tap.
    openMenuFor(c, 'e1');
    menuRow(c, 'Move to Trash').click();
    await settleMany();
    const k = confirmDialog(c);
    k.ok.click();
    k.ok.click();
    await settleMany();
    assert.strictEqual(deletes(c.calls, URL), 1, 'confirmed: exactly one DELETE');
    assert.ok(c.calls.indexOf('DELETE ' + URL) < c.calls.lastIndexOf('GET /api/podcasts/shows/s1/episodes'), 'then the list refreshes from server state');
  });
});

test('no single gesture on a row or the show header reaches a DELETE (no in-row arm survives)', async () => {
  await boot({}, async (c) => {
    openShow(c, 's1');
    await settleMany();
    const row = c.content().querySelector('[data-episode-id="e1"]');
    for (const b of row.querySelectorAll('button')) { b.click(); b.click(); }
    await settleMany();
    assert.strictEqual(c.calls.filter((x) => x.startsWith('DELETE ')).length, 0, 'tapping every row control twice deletes nothing');
    for (const b of c.content().querySelectorAll('.podcast-show-actions button')) { b.click(); b.click(); }
    await settleMany();
    assert.strictEqual(deletes(c.calls, '/api/podcasts/subscriptions/s1'), 0, 'tapping every show control twice never unsubscribes');
  });
});

// Unsubscribe lives in the show's overflow menu (a danger item); picking it opens the confirm.
function pickUnsubscribe(c) {
  c.content().querySelector('.podcast-show-actions [data-show-more]').click();
  const item = menuRow(c, 'Unsubscribe');
  assert.ok(item.classList.contains('ui-row--danger'), 'Unsubscribe is a danger menu item');
  item.click();
}

test('Unsubscribe: one tap opens a DANGER confirm that says files stay; the DELETE runs only after true', async () => {
  await boot({}, async (c) => {
    openShow(c, 's1');
    await settleMany();
    const URL = '/api/podcasts/subscriptions/s1';
    const unsub = () => ({ click: () => pickUnsubscribe(c) });

    for (const dismiss of ['cancel', 'escape', 'scrim']) {
      unsub().click();
      await settleMany();
      const k = confirmDialog(c);
      assert.match(k.dlg.textContent, /Unsubscribe from Harbor Lights Radio\?/);
      assert.match(k.dlg.textContent, /stay on disk/, 'the files-stay disclosure is in the confirm');
      assert.ok(k.ok.classList.contains('ui-btn--destructive'));
      assert.strictEqual(deletes(c.calls, URL), 0);
      if (dismiss === 'cancel') k.cancel.click();
      else if (dismiss === 'escape') c.d.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else lastOf(c.d, '.ui-scrim').click();
      await settleMany();
      assert.strictEqual(deletes(c.calls, URL), 0, dismiss + ' never unsubscribes');
    }

    unsub().click();
    await settleMany();
    const k = confirmDialog(c);
    k.ok.click();
    k.ok.click();
    await settleMany();
    assert.strictEqual(deletes(c.calls, URL), 1, 'confirmed: exactly one DELETE');
    assert.ok(c.content().querySelector('[data-show-id]'), 'and the view returns to the show list');
  });
});

test('a confirm left open when the view is torn down never deletes on a later OK', async () => {
  await boot({}, async (c) => {
    openShow(c, 's1');
    await settleMany();
    pickUnsubscribe(c);
    await settleMany();
    const k = confirmDialog(c);
    c.registered.destroy(); // an SPA nav away
    k.ok.click();
    await settleMany();
    assert.strictEqual(deletes(c.calls, '/api/podcasts/subscriptions/s1'), 0, 'an aborted view never unsubscribes');
    c.registered.init(c.d.getElementById('view-root')); // boot() destroys again at the end
    await settleMany();
  });
});

// ---- F42 / D4.4: the artwork -------------------------------------------------------------------

test('show art is a ui-art rounded square; a yt-dlp show with no art draws the monogram, never a frame', async () => {
  await boot({}, async (c) => {
    const list = c.content().querySelector('.podcast-show-list');
    assert.ok(list && list.classList.contains('ui-list'), 'the shows are a ui-list');
    const art = (id) => c.content().querySelector('[data-show-id="' + id + '"] .ui-row__media > *');
    for (const id of ['s1', 'yt:a', 'yt:b']) {
      assert.ok(art(id).classList.contains('ui-art'), id + ': a ui-art square');
      assert.ok(!art(id).classList.contains('ui-avatar'), id + ': never the circle');
      assert.ok(art(id).classList.contains('ui-avatar--xl'), id + ': the xl size the list column reserves');
    }
    assert.strictEqual(art('s1').querySelector('img').getAttribute('src'), '/podcastart/s1', 'an RSS show paints its cover route');
    assert.ok(art('s1').querySelector('img').classList.contains('art-shimmer'), 'with the decode-reveal shimmer');
    assert.strictEqual(art('yt:a').querySelector('img'), null, 'no art: no img at all');
    assert.strictEqual(art('yt:a').querySelector('.ui-avatar__mono').textContent, 'NA', 'the monogram');
    assert.strictEqual(art('yt:b').querySelector('img').getAttribute('src'), 'https://yt3.example.com/a.jpg', 'the channel avatar');
    for (const img of c.content().querySelectorAll('img')) assert.ok(!/\/thumbnail\//.test(img.getAttribute('src')), 'never a video frame');
    // A broken cover falls back to the monogram, never a broken image.
    art('s1').querySelector('img').dispatchEvent(new c.w.Event('error'));
    assert.strictEqual(art('s1').querySelector('img'), null);
    assert.strictEqual(art('s1').querySelector('.ui-avatar__mono').textContent, 'HL');
  });
});

test('the show header uses the same art builder (2xl ui-art) and the crumb is Back alone (F41: no duplicate title)', async () => {
  await boot({}, async (c) => {
    openShow(c, 's1');
    await settleMany();
    const head = c.content().querySelector('.podcast-show-head');
    const art = head.firstElementChild;
    assert.ok(art.classList.contains('ui-art') && art.classList.contains('ui-avatar--2xl'));
    assert.ok(art.querySelector('img').classList.contains('art-shimmer'));
    const crumb = c.d.getElementById('podcasts-crumb');
    assert.strictEqual(crumb.children.length, 1, 'the crumb holds one control');
    assert.ok(crumb.firstElementChild.classList.contains('ui-btn'), 'a ui-btn');
    assert.ok(!crumb.textContent.includes('Harbor'), 'the show name is not repeated in the crumb');
    assert.strictEqual(c.content().querySelectorAll('.podcast-show-title').length, 1, 'one title');
  });
});

// ---- AC5 + F27: the episode rows ---------------------------------------------------------------

test('AC5: every RSS episode row renders exactly two reserved action slots, the kebab always second', async () => {
  await boot({}, async (c) => {
    openShow(c, 's1');
    await settleMany();
    const list = c.content().querySelector('.podcast-episodes');
    assert.ok(list.classList.contains('ui-list--actions-2'), 'the list declares two action columns');
    const rows = list.querySelectorAll('[data-episode-id]');
    assert.strictEqual(rows.length, 4);
    for (const r of rows) {
      const acts = r.querySelector('.ui-row__actions').children;
      assert.strictEqual(acts.length, 2, r.getAttribute('data-episode-id') + ': two slots');
      assert.ok(acts[1].hasAttribute('data-episode-more'), r.getAttribute('data-episode-id') + ': the kebab is the second slot');
      const first = acts[0];
      const downloaded = ['e1', 'e4'].includes(r.getAttribute('data-episode-id'));
      if (downloaded) assert.strictEqual(first.getAttribute('aria-label'), 'Add to queue');
      else assert.ok(first.classList.contains('ui-row__slot'), 'an empty reserved slot, not a missing one');
      for (const b of r.querySelectorAll('button')) {
        assert.ok(/(^| )ui-/.test(b.className), 'every button is a primitive: ' + b.className);
        assert.ok(!/[✓×‹›▶★☆]/.test(b.textContent), 'no text glyph');
      }
    }
  });
});

test('F27: Played and the episode state are quiet meta text; the row itself plays', async () => {
  await boot({}, async (c) => {
    openShow(c, 's1');
    await settleMany();
    const meta = (id) => c.content().querySelector('[data-episode-id="' + id + '"] .ui-row__meta').textContent;
    assert.match(meta('e4'), /^Played · 10m$/);
    assert.ok(c.content().querySelector('[data-episode-id="e4"]').hasAttribute('data-played'));
    assert.match(meta('e3'), /^Queued · 1m$/);
    assert.match(meta('e2'), /^In trash · 1m$/);
    assert.match(meta('e1'), /2026 · 30m$/);
    assert.ok(c.content().querySelector('[data-episode-id="e1"] .ui-row__link'), 'a downloaded episode plays from its row');
    assert.strictEqual(c.content().querySelector('[data-episode-id="e3"] .ui-row__link'), null, 'a queued one is not tappable');
    // Mark played from the menu rewrites the meta in place.
    openMenuFor(c, 'e1');
    menuRow(c, 'Mark played').click();
    await settleMany();
    assert.match(meta('e1'), /^Played · /);
    assert.ok(c.calls.includes('POST /api/podcasts/episodes/e1/played'));
  });
});

test('the like lives in the episode menu: Like POSTs, then Unlike DELETEs the same endpoint', async () => {
  await boot({}, async (c) => {
    openShow(c, 's1');
    await settleMany();
    openMenuFor(c, 'e1');
    menuRow(c, 'Like').click();
    await settleMany();
    assert.ok(c.calls.includes('POST /api/podcasts/episodes/e1/liked'));
    openMenuFor(c, 'e1');
    menuRow(c, 'Unlike').click();
    await settleMany();
    assert.ok(c.calls.includes('DELETE /api/podcasts/episodes/e1/liked'));
    // The trashed episode's menu offers Restore, and no delete.
    openMenuFor(c, 'e2');
    assert.ok(menuRow(c, 'Restore'));
    const labels = Array.from(lastOf(c.d, '.ui-sheet--popover').querySelectorAll('.ui-row')).map((r) => r.textContent.trim());
    assert.ok(!labels.includes('Move to Trash'), 'no trash item on a trashed episode');
  });
});

// ---- F41: the Pin pending state ----------------------------------------------------------------

test('F41: Pin is BUSY (full opacity, not disabled) while the pins load, then reflects membership', async () => {
  let release;
  const hold = { url: '/api/podcasts/pins', promise: new Promise((r) => { release = r; }), body: [{ id: 's1' }] };
  await boot({ hold }, async (c) => {
    openShow(c, 's1');
    await settleMany();
    const pin = c.content().querySelector('.podcast-show-actions .ui-btn');
    assert.strictEqual(pin.getAttribute('aria-label'), 'Pin to Playlists');
    assert.strictEqual(pin.getAttribute('aria-busy'), 'true', 'busy while the pins load');
    assert.strictEqual(pin.disabled, false, 'never the disabled flash');
    assert.strictEqual(pin.getAttribute('aria-pressed'), 'false');
    release();
    await settleMany();
    assert.strictEqual(pin.getAttribute('aria-busy'), null, 'settled');
    assert.strictEqual(pin.getAttribute('aria-pressed'), 'true', 'pinned');
    assert.strictEqual(pin.querySelector('.ui-btn__stack').getAttribute('data-label'), 'Pinned');
    assert.match(pin.querySelector('use').getAttribute('href'), /#i-keep-fill$/, 'the filled pin glyph');
  });
});

// ---- D9: states and skeletons ------------------------------------------------------------------

test('D9: a failed shows load is an error state with Retry, never "No podcasts yet"', async () => {
  await boot({ failShows: true }, async (c) => {
    const st = c.content().querySelector('.ui-state');
    assert.ok(st && /Could not load podcasts/.test(st.textContent));
    assert.ok(st.querySelector('.ui-btn'), 'with a Retry action');
    assert.strictEqual(c.d.getElementById('podcasts-empty').hidden, true, 'the empty state stays hidden');
  });
});

test('the skeletons carry exactly the classes ui.list() emits (the final geometry)', async () => {
  await boot({}, async (c) => {
    const pod = require(podcastsPath);
    const ui = c.w.ui;
    const shows = ui.list({ size: 'media', media: 'art', label: 'x' });
    const eps = ui.list({ size: 'default', actions: 2, label: 'x' });
    assert.strictEqual(pod.SHOW_LIST_CLASS, shows.className + ' podcast-show-list');
    assert.strictEqual(pod.EPISODE_LIST_CLASS, eps.className + ' podcast-episodes');
    assert.strictEqual(c.content().querySelector('.podcast-show-list').className, pod.SHOW_LIST_CLASS, 'the real list matches its skeleton');
    // A skeleton row has the same slot sequence as a real row.
    const host = c.d.createElement('div');
    host.innerHTML = pod.buildPodcastSkeletonRows(1);
    const slots = (r) => Array.from(r.children).map((x) => x.className.split(' ')[0]);
    assert.deepStrictEqual(slots(host.querySelector('.ui-row')), slots(c.content().querySelector('.podcast-show-list > .ui-row')));
    host.innerHTML = pod.buildPodcastShowSkeleton(1);
    assert.strictEqual(host.querySelector('.ui-list').className, pod.EPISODE_LIST_CLASS);
    assert.strictEqual(host.querySelectorAll('.ui-row__actions > .ui-row__slot').length, 2, 'both action slots reserved');
  });
});

test('the add dialog is a ui.sheet; Subscribe posts the feed and closes', async () => {
  await boot({}, async (c) => {
    c.d.getElementById('podcasts-add-btn').click();
    await settleMany();
    const dlg = lastOf(c.d, '.ui-sheet--dialog');
    assert.ok(dlg && /Add a podcast/.test(dlg.textContent));
    dlg.querySelector('input[type="url"]').value = ' https://feeds.example.com/x.xml ';
    dlg.querySelector('select').value = '25';
    const ok = Array.from(dlg.querySelectorAll('.ui-btn')).find((b) => b.textContent.trim() === 'Subscribe');
    assert.ok(ok.classList.contains('ui-btn--primary'));
    ok.click();
    await settleMany();
    const post = c.bodies.find((b) => b.url === '/api/podcasts/subscriptions');
    assert.deepStrictEqual(post && post.body, { feedUrl: 'https://feeds.example.com/x.xml', backfill: '25' });
  });
});

// ---- v1.376.0 W2 (Dean: "podcasts get the same options") ------------------------------------

test('W2: a downloaded episode\'s kebab offers Watch later and Share; the toggle states kind podcast and follows membership; a trashed one offers neither', async () => {
  await boot({}, async (c) => {
    const wl = [];
    const shared = [];
    let listed = new Set();
    c.w.watchLaterHas = (id, kind) => listed.has(kind + ':' + id);
    c.w.setWatchLater = (id, on, kind) => { wl.push([id, on, kind]); return Promise.resolve(on); };
    c.w.shareExternalUrl = (url, title) => { shared.push([url, title]); return Promise.resolve('copied'); };
    openShow(c, 's1');
    await settleMany();
    openMenuFor(c, 'e1');
    menuRow(c, 'Watch later').click();
    await settleMany();
    assert.deepStrictEqual(wl, [['e1', true, 'podcast']], 'the add, kind stated');
    openMenuFor(c, 'e1');
    menuRow(c, 'Share').click();
    await settleMany();
    assert.deepStrictEqual(shared, [['/podcasts?play=e1', 'Pilot']], 'the episode link (absolute in a browser)');
    listed = new Set(['podcast:e1']);
    openMenuFor(c, 'e1');
    menuRow(c, 'Remove from Watch later').click();
    await settleMany();
    assert.deepStrictEqual(wl[1], ['e1', false, 'podcast'], 'a listed episode removes');
    openMenuFor(c, 'e2');
    await settleMany();
    const menu = lastOf(c.d, '.ui-sheet--popover, .ui-sheet--bottom');
    const labels = Array.from(menu.querySelectorAll('.ui-row')).map((r) => r.textContent.trim());
    assert.ok(!labels.some((l) => /Watch later|Share/.test(l)), 'a trashed episode offers neither: ' + labels.join(', '));
    c.d.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settleMany();
  });
});
