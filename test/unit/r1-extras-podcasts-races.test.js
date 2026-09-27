'use strict';

// [UNIT] v1.339 R1 (plan 2026-09-26-fouc-toctou-audit, T-C4 + T-C8).
//
// T-C4: the shared Extras core (skin-surface.js createExtrasMenu) captures the item when the
//   menu opens; the Move/Delete confirm modal outlives an auto-advance, and the confirm used to
//   call player.close() on whatever played NOW (and tell the view to clear its playing state).
//   The podcasts adapter's own onDelete had the same shape. Each test holds the confirm open
//   (the captured modal callback IS the manually released await), advances the player, then
//   confirms.
// T-C8: podcasts openShow / consumeDeepLink re-checked only `signal.aborted` after the episodes
//   fetch - Back (or another show) during it got show A painted over the grid / over show B,
//   and a ?play= deep link still played after Back. Each test holds that fetch open.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const surfacePath = require.resolve('../../public/js/skin-surface.js');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const podcastsPath = require.resolve('../../public/js/podcasts.js');

const settle = () => new Promise((r) => setImmediate(r));
async function settleMany(n) { for (let i = 0; i < (n || 12); i++) await settle(); }
function defer() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

// ---- T-C4: the shared Extras core -------------------------------------------------------------

function bootExtras() {
  const dom = new JSDOM('<body><div id="menu" hidden></div></body>', { url: 'https://x.test/music' });
  const w = dom.window;
  const saved = { window: global.window, document: global.document, fetch: global.fetch };
  const calls = [];
  const state = { baseId: 'base9', closes: 0, mutated: [], confirm: null, move: null };
  w.fetch = (url, init) => {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    calls.push(method + ' ' + u);
    let body = {};
    if (method === 'GET' && u === '/api/videos/base9') body = { id: 'base9', title: 'Mix', liked: false, watchState: 'unwatched', filePath: '/lib/mix.mp3' };
    else if (u === '/api/config') body = { folders: [{ path: '/lib' }] };
    else if (method === 'DELETE') body = { success: true };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  w.fetchCurrentUser = () => Promise.resolve({ user: { role: 'admin' } });
  w.isYtdlpManagedItem = () => true;
  w.showConfirmModal = (title, html, onOk) => { state.confirm = onOk; }; // held open until the test confirms
  w.showMoveModal = (item, folders, onPick) => { state.move = onPick; };
  w.requestMoveItem = () => Promise.resolve({ success: true });
  w.showToast = () => {};
  global.window = w; global.document = w.document; global.fetch = w.fetch;
  delete require.cache[surfacePath];
  const api = require(surfacePath);
  const menuEl = w.document.getElementById('menu');
  const menu = api.createExtrasMenu({
    getMenuEl: () => menuEl,
    getBaseId: () => state.baseId,
    getPlayer: () => ({ getCurrentTime: () => 0, close: () => { state.closes += 1; } }),
    getSignal: () => null,
    close: () => { menuEl.hidden = true; },
    backHtml: () => '',
    stillOnPage: () => !menuEl.hidden,
    onMutated: (info) => { state.mutated.push(info); },
  });
  return {
    w, menuEl, menu, calls, state,
    done: () => { delete require.cache[surfacePath]; Object.assign(global, saved); },
  };
}
async function openOn(b) {
  b.menuEl.hidden = false;
  b.menu.open();
  await settleMany();
  assert.ok(b.menuEl.querySelector('[data-skin-x="delete"]'), 'precondition: the Extras page rendered for base9');
}

for (const [label, nowPlaying, expectClose] of [
  ['an auto-advance to another track during the confirm -> the NEW track is NOT closed', 'other7', false],
  ['control - still the same item -> playback is closed before the DELETE', 'base9', true],
  ['the same file as a ::c chapter track -> still the item, closed (the ::c normalization)', 'base9::c2', true],
]) {
  test('T-C4 Delete: ' + label, async () => {
    const b = bootExtras();
    try {
      await openOn(b);
      b.menu.handleAction('delete', null);
      assert.strictEqual(typeof b.state.confirm, 'function', 'precondition: the confirm modal is open (held)');
      b.state.baseId = nowPlaying; // what plays when the user finally confirms
      b.state.confirm();
      await settleMany();
      assert.ok(b.calls.includes('DELETE /api/videos/base9'), 'the confirmed item is deleted either way');
      assert.strictEqual(b.state.closes, expectClose ? 1 : 0, 'player.close() calls');
      assert.deepStrictEqual(b.state.mutated, [{ playingRemoved: expectClose }], 'the view is told whether its playing item went');
    } finally { b.done(); }
  });
}

for (const [label, nowPlaying, expectClose] of [
  ['an auto-advance during the move modal -> the NEW track is NOT closed', 'other7', false],
  ['control - still the same item -> the re-keyed playback is closed', 'base9', true],
]) {
  test('T-C4 Move: ' + label, async () => {
    const b = bootExtras();
    try {
      await openOn(b);
      b.menu.handleAction('move', null);
      await settleMany();
      assert.strictEqual(typeof b.state.move, 'function', 'precondition: the move modal is open (held)');
      b.state.baseId = nowPlaying;
      b.state.move('/lib/other', { statusEl: {}, teardown() {}, reenable() {} });
      await settleMany();
      assert.strictEqual(b.state.closes, expectClose ? 1 : 0, 'player.close() calls');
      assert.deepStrictEqual(b.state.mutated, [{ playingRemoved: expectClose }]);
    } finally { b.done(); }
  });
}

// ---- podcasts view harness (T-C4 adapter + T-C8) -----------------------------------------------

const VIEW_HTML = `<body><div id="view-root" data-view="podcasts">
  <video id="media-player"></video>
  <button id="podcast-theater-btn" type="button" hidden aria-pressed="false"></button>
  <button id="podcast-popout-btn" type="button" hidden aria-pressed="false"></button>
  <div id="podcast-stage" class="music-stage"><div id="player-slot"></div><div id="podcast-nowplaying-panel" hidden></div></div>
  <div class="music-crumb" id="podcasts-crumb" hidden></div>
  <div id="podcasts-status" role="status" hidden></div>
  <div id="podcasts-content"></div>
  <div class="music-empty" id="podcasts-empty" hidden></div>
</div></body>`;

const SHOWS = [{ id: 's1', name: 'Show One' }, { id: 's2', name: 'Show Two' }];
const EPS = {
  s1: [{ id: 'e1', subId: 's1', title: 'One Ep', status: 'downloaded', durationSec: 10 }],
  s2: [{ id: 'x1', subId: 's2', title: 'Two Ep', status: 'downloaded', durationSec: 10 }],
};

async function bootPodcasts(opts, run) {
  const dom = new JSDOM(VIEW_HTML, { url: opts.url || 'http://localhost/podcasts' });
  const w = dom.window;
  const saved = {
    window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch,
    AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame,
  };
  const loads = [];
  const player = {
    currentId: opts.currentId || null, closes: 0,
    getState: () => 'closed', getCurrentMeta: () => null,
    load: (id) => { loads.push(id); player.currentId = id; },
    expand() {}, setTrackNav() {}, close() { player.closes += 1; },
  };
  let registered = null;
  let engineCfg = null;
  global.window = w; global.document = w.document; global.localStorage = w.localStorage;
  global.AbortController = w.AbortController;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  w.scrollTo = function () {};
  w.showToast = () => {};
  w.FileTube = { registerView: (n, m) => { registered = m; }, shimmerArt: () => {}, player };
  const holds = opts.holds || {}; // show id -> deferred for its FIRST episodes fetch
  const fetches = [];
  global.fetch = (u, init) => {
    const url = String(u);
    const method = (init && init.method) || 'GET';
    fetches.push(method + ' ' + url);
    const reply = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
    const m = url.match(/\/api\/podcasts\/shows\/([^/]+)\/episodes/);
    if (m) {
      const sid = decodeURIComponent(m[1]);
      const body = { show: SHOWS.find((s) => s.id === sid) || { id: sid, name: sid }, episodes: EPS[sid] || [] };
      if (holds[sid] && !holds[sid].used) {
        holds[sid].used = true;
        const fail = holds[sid].fail; // a held FAILURE (the catch arms)
        return holds[sid].promise.then(() => (fail ? { ok: false, status: 500, json: () => Promise.resolve({}) } : reply(body)));
      }
      return Promise.resolve(reply(body));
    }
    const em = url.match(/\/api\/podcasts\/episodes\/([^/?]+)$/);
    if (em && method === 'GET') {
      const epBody = EPS.s1.concat(EPS.s2).find((e) => e.id === decodeURIComponent(em[1])) || {};
      const hk = 'ep:' + decodeURIComponent(em[1]);
      if (holds[hk] && !holds[hk].used) { holds[hk].used = true; return holds[hk].promise.then(() => reply(epBody)); }
      return Promise.resolve(reply(epBody));
    }
    if (/\/api\/podcasts\/shows$/.test(url)) return Promise.resolve(reply({ shows: SHOWS }));
    return Promise.resolve(reply({}));
  };
  try {
    delete require.cache[skinsPath]; require(skinsPath);
    delete require.cache[surfacePath]; require(surfacePath);
    const realCreate = w.FileTubeSkinSurface.create;
    w.FileTubeSkinSurface.create = (cfg) => { engineCfg = cfg; return realCreate(cfg); };
    delete require.cache[podcastsPath]; require(podcastsPath);
    registered.init(w.document.getElementById('view-root'));
    const content = () => w.document.getElementById('podcasts-content');
    await run({
      w, player, loads, fetches, registered, content,
      engineCfg: () => engineCfg,
      cards: () => content().querySelectorAll('.podcast-card'),
      text: () => content().textContent,
    });
    registered.destroy();
  } finally {
    delete require.cache[podcastsPath]; delete require.cache[surfacePath]; delete require.cache[skinsPath];
    Object.assign(global, saved);
  }
}

// ---- T-C4, the podcasts adapter's own delete ---------------------------------------------------

for (const [label, playingAtConfirm, expectClose] of [
  ['an auto-advance during the confirm -> the NEXT episode is NOT closed', 'e2', false],
  ['control - the deleted episode still plays -> it is closed', 'e1', true],
]) {
  test('T-C4 podcasts onDelete: ' + label, async () => {
    await bootPodcasts({ currentId: 'e1' }, async (c) => {
      await settleMany();
      const cfg = c.engineCfg();
      const extras = cfg && cfg.sticker && cfg.sticker.extras;
      assert.ok(extras && typeof extras.onDelete === 'function', 'precondition: the podcast Extras adapter is wired');
      let confirm = null;
      c.w.showConfirmModal = (t, h, ok) => { confirm = ok; };
      const successes = [];
      extras.onDelete({ id: 'e1', title: 'One Ep' }, (removed) => { successes.push(removed); }, c.player);
      assert.strictEqual(typeof confirm, 'function', 'precondition: the confirm is open (held)');
      c.player.currentId = playingAtConfirm;
      confirm();
      await settleMany();
      assert.ok(c.fetches.includes('DELETE /api/podcasts/episodes/e1'), 'the confirmed episode is trashed either way');
      assert.strictEqual(c.player.closes, expectClose ? 1 : 0, 'player.close() calls');
      assert.deepStrictEqual(successes, [expectClose], 'onSuccess learns whether the playing item went');
    });
  });
}

// ---- T-C8 -------------------------------------------------------------------------------------

const clickCard = (c, name) => {
  const card = Array.from(c.cards()).find((n) => n.textContent.indexOf(name) >= 0);
  assert.ok(card, 'precondition: the grid shows ' + name);
  card.click();
};

for (const back of [true, false]) {
  test('T-C8 openShow: ' + (back ? 'Back to the grid during the episodes fetch -> the late show does NOT paint over the grid' : 'control - the show paints'), async () => {
    const hold = defer();
    await bootPodcasts({ holds: { s1: hold } }, async (c) => {
      await settleMany();
      clickCard(c, 'Show One');
      await settleMany();
      assert.strictEqual(c.cards().length, 0, 'precondition: the show skeleton replaced the grid while its fetch is held');
      if (back) {
        c.registered.onPopState({}); // the in-view pop to the grid level
        await settleMany();
        assert.strictEqual(c.cards().length, 2, 'precondition: the grid is back');
      }
      hold.resolve();
      await settleMany();
      if (back) {
        assert.strictEqual(c.cards().length, 2, 'the grid is still on screen');
        assert.ok(c.text().indexOf('One Ep') < 0, 'show one\'s episodes did not paint over it');
      } else {
        assert.ok(c.text().indexOf('One Ep') >= 0, 'show one\'s episodes painted');
      }
    });
  });
}

test('T-C8 openShow: show B opened during show A\'s fetch -> A\'s late answer does NOT overwrite B', async () => {
  const hold = defer();
  await bootPodcasts({ holds: { s1: hold } }, async (c) => {
    await settleMany();
    clickCard(c, 'Show One');
    await settleMany();
    c.registered.onPopState({ viewState: { t: 'show', id: 's2', name: 'Show Two' } }); // e.g. a forward pop to B
    await settleMany();
    assert.ok(c.text().indexOf('Two Ep') >= 0, 'precondition: show two painted');
    hold.resolve();
    await settleMany();
    assert.ok(c.text().indexOf('Two Ep') >= 0, 'show two is still on screen');
    assert.ok(c.text().indexOf('One Ep') < 0, 'show one\'s late episodes did not replace it');
  });
});

for (const back of [true, false]) {
  test('T-C8 consumeDeepLink: ' + (back ? 'Back during the ?play= episodes fetch -> no paint and NO play' : 'control - the deep-linked episode plays'), async () => {
    const hold = defer();
    await bootPodcasts({ url: 'http://localhost/podcasts?play=e1', holds: { s1: hold } }, async (c) => {
      await settleMany();
      assert.ok(c.fetches.includes('GET /api/podcasts/shows/s1/episodes'), 'precondition: the deep link\'s episodes fetch is held');
      if (back) {
        c.registered.onPopState({});
        await settleMany();
      }
      hold.resolve();
      await settleMany();
      assert.deepStrictEqual(c.loads, back ? [] : ['e1']);
      if (back) assert.strictEqual(c.cards().length, 2, 'the grid stays');
    });
  });
}

// T-C8, the error axis: a stale FAILURE must not wipe the view that replaced its skeleton either
// (and, control, a current failure still clears its own skeleton - the v1.157 reveal-once clear).
for (const back of [true, false]) {
  test('T-C8 openShow catch: ' + (back ? 'Back during a fetch that then FAILS -> the grid is NOT wiped' : 'control - a failing fetch clears its own skeleton'), async () => {
    const hold = Object.assign(defer(), { fail: true });
    await bootPodcasts({ holds: { s1: hold } }, async (c) => {
      await settleMany();
      clickCard(c, 'Show One');
      await settleMany();
      assert.ok(c.content().querySelector('.skeleton-shimmer, [class*="skeleton"]'), 'precondition: the show skeleton is up');
      if (back) { c.registered.onPopState({}); await settleMany(); }
      hold.resolve();
      await settleMany();
      if (back) assert.strictEqual(c.cards().length, 2, 'the grid survived the stale failure');
      else assert.strictEqual(c.content().innerHTML, '', 'the skeleton was cleared');
    });
  });

  test('T-C8 consumeDeepLink catch: ' + (back ? 'Back during an episodes fetch that then FAILS -> the grid is NOT wiped' : 'control - the failure clears the deep link\'s skeleton'), async () => {
    const hold = Object.assign(defer(), { fail: true });
    await bootPodcasts({ url: 'http://localhost/podcasts?play=e1', holds: { s1: hold } }, async (c) => {
      await settleMany();
      assert.ok(c.fetches.includes('GET /api/podcasts/shows/s1/episodes'), 'precondition: the deep link\'s episodes fetch is held');
      if (back) { c.registered.onPopState({}); await settleMany(); assert.strictEqual(c.cards().length, 2, 'precondition: the grid is back'); }
      hold.resolve();
      await settleMany();
      if (back) assert.strictEqual(c.cards().length, 2, 'the grid survived the stale failure');
      else assert.strictEqual(c.content().innerHTML, '', 'the skeleton was cleared');
    });
  });
}

for (const drill of [true, false]) {
  test('T-C8 consumeDeepLink episode lookup: ' + (drill ? 'the user opens another show during it -> the deep link does NOT hijack the view' : 'control - the deep link drills and plays'), async () => {
    const hold = defer();
    await bootPodcasts({ url: 'http://localhost/podcasts?play=e1', holds: { 'ep:e1': hold } }, async (c) => {
      await settleMany();
      assert.ok(c.fetches.includes('GET /api/podcasts/episodes/e1'), 'precondition: the episode lookup is held');
      if (drill) {
        clickCard(c, 'Show Two');
        await settleMany();
        assert.ok(c.text().indexOf('Two Ep') >= 0, 'precondition: show two is open');
      }
      hold.resolve();
      await settleMany();
      if (drill) {
        assert.deepStrictEqual(c.loads, [], 'the deep-linked episode did not start');
        assert.ok(c.text().indexOf('Two Ep') >= 0 && c.text().indexOf('One Ep') < 0, 'show two stays on screen');
      } else {
        assert.deepStrictEqual(c.loads, ['e1']);
      }
    });
  });
}
