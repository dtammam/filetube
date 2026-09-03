'use strict';

// [UNIT] v1.105 - the podcast now-playing view (mirrors music v1.104). Boots the
// REAL podcasts view against jsdom with a stateful mock player and asserts
// BEHAVIOUR: keep-player-position on episode change, the metadata + show-notes +
// up-next panel, its reveal-once CLEAR, the dock-return ?nowplaying strip, and the
// dock-tap re-init reseed (rebuild playable from the show, without racing a
// rendered show view).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const podcastsPath = require.resolve('../../public/js/podcasts.js');

const VIEW_HTML = `<body><div id="view-root" data-view="podcasts">
  <video id="media-player"></video>
  <button id="podcast-theater-btn" class="music-theater-btn" type="button" hidden aria-pressed="false"></button>
  <button id="podcast-popout-btn" type="button" hidden aria-pressed="false"></button>
  <div id="podcast-stage" class="music-stage">
  <div id="player-slot"></div>
  <div id="podcast-nowplaying-panel" hidden></div>
  </div>
  <div class="music-crumb" id="podcasts-crumb" hidden></div>
  <div id="podcasts-status" role="status" hidden></div>
  <div id="podcasts-content"></div>
  <div class="music-empty" id="podcasts-empty" hidden></div>
</div></body>`;

const EPISODES = [
  { id: 'e1', subId: 's1', title: 'Ep One', showName: 'The Show', pubDateMs: 1690000000000, durationSec: 3600, description: 'Notes for episode one.', status: 'downloaded' },
  { id: 'e2', subId: 's1', title: 'Ep Two', showName: 'The Show', pubDateMs: 1690100000000, durationSec: 3700, description: 'Notes for episode two.', status: 'downloaded' },
  { id: 'e3', subId: 's1', title: 'Ep Three', showName: 'The Show', pubDateMs: 1690200000000, durationSec: 3800, description: 'Notes for episode three.', status: 'downloaded' },
];

const S2_EPISODES = [
  { id: 'x1', subId: 's2', title: 'S2 One', showName: 'Show Two', pubDateMs: 10, durationSec: 100, description: 's2 notes one', status: 'downloaded' },
  { id: 'x2', subId: 's2', title: 'S2 Two', showName: 'Show Two', pubDateMs: 20, durationSec: 200, description: 's2 notes two', status: 'downloaded' },
];

const settle = () => new Promise((resolve) => setImmediate(resolve));

function makePlayer(initialState, meta) {
  const s = { value: initialState || 'closed', loadCalls: [], trackNav: null };
  const player = {
    currentId: meta ? meta.id : null,
    getState: () => s.value,
    getCurrentMeta: () => meta || null,
    load: (id, data, opts) => {
      s.loadCalls.push({ id, data, opts: opts || {} });
      player.currentId = id;
      if (opts && opts.slot) s.value = 'full';
      else if (opts && opts.dock) s.value = 'docked';
    },
    expand: () => { s.value = 'full'; },
    setTrackNav: (h) => { s.trackNav = h; },
  };
  return { player, s, setState: (v) => { s.value = v; } };
}

async function boot(url, initialState, run, opts) {
  opts = opts || {};
  const dom = new JSDOM(VIEW_HTML, { url });
  const saved = {
    window: global.window, document: global.document,
    localStorage: global.localStorage, fetch: global.fetch,
    AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame,
  };
  const mock = makePlayer(initialState, opts.meta);
  // v1.251 (adversarial W3): opts.mm = { narrow: bool } installs a LIVE-switchable viewport
  // (the pop-out gate + resize enforcement read matchMedia at call time).
  if (opts.mm) {
    dom.window.matchMedia = () => ({ matches: !!opts.mm.narrow, media: '(max-width: 768px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } });
  }
  const fetches = [];
  mock.fetches = fetches;
  let registered = null;
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  mock.scrollCalls = [];
  dom.window.scrollTo = function () { mock.scrollCalls.push(Array.prototype.slice.call(arguments)); };
  global.requestAnimationFrame = dom.window.requestAnimationFrame
    ? dom.window.requestAnimationFrame.bind(dom.window)
    : (cb) => setTimeout(cb, 0);
  dom.window.FileTube = { registerView: (n, m) => { registered = m; }, shimmerArt: () => {}, player: mock.player };
  const SHOW_EPS = { s1: opts.episodes || EPISODES, s2: S2_EPISODES };
  global.fetch = (u) => {
    const url2 = String(u);
    fetches.push(url2);
    const epMatch = url2.match(/\/api\/podcasts\/shows\/([^/]+)\/episodes/);
    if (epMatch) {
      const sid = decodeURIComponent(epMatch[1]);
      const body = { show: { id: sid, name: sid === 's2' ? 'Show Two' : 'The Show' }, episodes: SHOW_EPS[sid] || [] };
      // opts.deferSubId defers THAT show's episodes fetch (the rebuild's) so a test
      // can open another show mid-await and prove the post-await guard bails.
      if (opts.deferSubId && sid === opts.deferSubId) {
        return new Promise((res) => { mock.deferred = { resolve: () => res({ ok: true, json: () => Promise.resolve(body) }) }; });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }
    let body = {};
    if (/\/api\/podcasts\/shows/.test(url2)) body = { shows: opts.gridShows || [] };
    else if (/\/api\/podcasts\/status/.test(url2)) body = { running: false };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
  try {
    // v1.251 (R2/R3): the desktop panel renders through the shared engine builder and the
    // pop-out mounts a real engine instance - load the registry + engine into this window
    // exactly as podcasts.html does (music-skins.js then skin-surface.js, before podcasts.js).
    delete require.cache[require.resolve('../../public/js/music-skins.js')];
    require('../../public/js/music-skins.js');
    delete require.cache[require.resolve('../../public/js/skin-surface.js')];
    require('../../public/js/skin-surface.js');
    delete require.cache[podcastsPath];
    require(podcastsPath);
    assert.ok(registered && typeof registered.init === 'function', 'podcasts view registered');
    mock.destroyView = () => registered.destroy(); // W3: tests can destroy mid-flight (destroy is re-entrant)
    registered.init(dom.window.document.getElementById('view-root'));
    await settle(); await settle(); await settle();
    await run(dom, mock);
    registered.destroy();
  } finally {
    delete require.cache[podcastsPath];
    Object.assign(global, saved);
  }
}

const panel = (dom) => dom.window.document.getElementById('podcast-nowplaying-panel');
const lastLoad = (mock) => mock.s.loadCalls[mock.s.loadCalls.length - 1];
const playEp = async (dom, idx) => {
  const rows = dom.window.document.querySelectorAll('.podcast-episode-main');
  rows[idx].click();
  await settle(); await settle();
};

test('v1.105 (T1): an episode change while EXPANDED keeps the player in #player-slot', async () => {
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom, mock) => {
    await playEp(dom, 1); // play Ep Two while expanded
    const call = lastLoad(mock);
    assert.equal(call.id, 'e2', 'loaded the tapped episode');
    assert.ok(call.opts.slot && !call.opts.dock, 'stayed expanded (loaded into slot)');
    assert.equal(mock.s.value, 'full');
  });
});

test('v1.106: a fresh episode tap EXPANDS (opens the now-playing view) + scrolls it into view', async () => {
  await boot('http://localhost/podcasts?show=s1', 'closed', async (dom, mock) => {
    await playEp(dom, 0);
    const call = lastLoad(mock);
    assert.ok(call.opts.slot && !call.opts.dock, 'a fresh select mounts FULL into #player-slot (was dock pre-v1.106)');
    assert.equal(mock.s.value, 'full', 'expanded after a select');
    assert.ok(mock.scrollCalls.some((a) => a[0] === 0 && a[1] === 0), 'scrolled the expanded player into view');
  });
});

test('v1.106: a NAV step (next/prev) while DOCKED keeps it docked (does NOT force-expand)', async () => {
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom, mock) => {
    await playEp(dom, 0); // select -> expands, registers trackNav for index 0
    mock.setState('docked');
    mock.scrollCalls.length = 0;
    mock.s.trackNav.onNext(); // nav (keepPosition)
    await settle(); await settle();
    const call = lastLoad(mock);
    assert.ok(call.opts.dock === true && !call.opts.slot, 'nav kept the docked position');
    assert.equal(mock.scrollCalls.length, 0, 'a nav does not scroll');
  });
});

test('v1.105 (T2 panel): playing expanded shows title + "show · date" + show-notes + up-next', async () => {
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom) => {
    await playEp(dom, 0); // play Ep One
    const el = panel(dom);
    assert.equal(el.hidden, false, 'panel visible');
    assert.match(el.querySelector('.mnp-title').textContent, /Ep One/);
    assert.match(el.querySelector('.mnp-sub').textContent, /The Show/, 'show name in the sub-line');
    assert.match(el.querySelector('.mnp-desc').textContent, /Notes for episode one\./, 'show-notes rendered');
    // v1.251 (R2): the SHARED whole-queue treatment (music's v1.223 semantics) - the list
    // shows every episode windowed around the current one, the playing row marked.
    const upTitles = [...el.querySelectorAll('.mnp-queue-title')].map((n) => n.textContent);
    assert.deepEqual(upTitles, ['Ep One', 'Ep Two', 'Ep Three']);
    const cur = el.querySelector('.mnp-queue-row.is-current');
    assert.ok(cur, 'the playing episode row is marked current');
    assert.match(cur.textContent, /Ep One/, 'and it is the playing episode');
  });
});

test('v1.105 (T2): the show-notes are set via textContent, never innerHTML (no injection)', async () => {
  // A description with markup must render as literal text (the no-innerHTML law).
  const withMarkup = EPISODES.map((e) => (e.id === 'e1' ? { ...e, description: '<img src=x onerror=alert(1)>hi' } : e));
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom) => {
    await playEp(dom, 0);
    const desc = panel(dom).querySelector('.mnp-desc');
    assert.ok(desc, 'desc present');
    assert.equal(desc.querySelector('img'), null, 'no <img> element created - rendered as text');
    assert.match(desc.textContent, /onerror=alert\(1\)/, 'the markup is literal text');
  }, { episodes: withMarkup });
});

test('v1.105 (T2 tap): tapping an up-next row jumps to that episode', async () => {
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom, mock) => {
    await playEp(dom, 1); // play Ep Two so BOTH directions exist (v1.251 whole-queue rows)
    const rows = [...panel(dom).querySelectorAll('.mnp-queue-row')];
    const rowByTitle = (t) => rows.find((r) => r.textContent.indexOf(t) !== -1);
    assert.ok(rowByTitle('Ep One').classList.contains('is-played'), 'the earlier episode is greyed (is-played) but present');
    rowByTitle('Ep Three').click(); // forward jump
    await settle(); await settle();
    assert.equal(lastLoad(mock).id, 'e3');
    // v1.251: played rows stay CLICKABLE - the jump-BACK axis (music v1.223 parity).
    [...panel(dom).querySelectorAll('.mnp-queue-row')].find((r) => r.textContent.indexOf('Ep One') !== -1).click();
    await settle(); await settle();
    assert.equal(lastLoad(mock).id, 'e1', 'tapping a played row jumps back');
  });
});

test('v1.105/v1.106 (reveal-once CLEAR): a shown panel clears when a NAV docks the player', async () => {
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom, mock) => {
    await playEp(dom, 0);
    assert.equal(panel(dom).hidden, false);
    assert.ok(panel(dom).textContent.length > 0, 'populated first (non-vacuous)');
    mock.setState('docked');
    mock.s.trackNav.onNext(); // a NAV keeps it docked -> updateNowPlayingPanel hides+clears
    await settle(); await settle();
    assert.equal(panel(dom).hidden, true, 'docked -> panel HIDDEN');
    assert.equal(panel(dom).textContent, '', 'and CLEARED');
  });
});

test('v1.105 (reveal-once CLEAR): closing the player (emptied) clears a shown panel', async () => {
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom, mock) => {
    await playEp(dom, 0);
    assert.equal(panel(dom).hidden, false, 'shown');
    mock.player.currentId = null;
    dom.window.document.getElementById('media-player').dispatchEvent(new dom.window.Event('emptied'));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(panel(dom).hidden, true, 'hidden after close');
    assert.equal(panel(dom).textContent, '', 'cleared');
  });
});

test('v1.105 (T3 strip): init strips the transient ?nowplaying marker', async () => {
  const meta = { id: 'e1', title: 'Ep One', artist: 'The Show', resumeMode: 'podcast', subId: 's1' };
  await boot('http://localhost/podcasts?nowplaying=1', 'docked', async (dom) => {
    assert.equal(dom.window.location.search, '', 'nowplaying stripped');
  }, { meta });
});

test('v1.105 (T4 reseed): a dock-tap expand on the GRID re-seeds metadata + rebuilds up-next from the show', async () => {
  const meta = { id: 'e1', title: 'Ep One', artist: 'The Show', resumeMode: 'podcast', subId: 's1' };
  await boot('http://localhost/podcasts?nowplaying=1', 'full', async (dom) => {
    const el = panel(dom);
    assert.equal(el.hidden, false, 'panel shows even though playAt never ran this instance');
    assert.match(el.querySelector('.mnp-title').textContent, /Ep One/, 're-seeded title');
    // rebuildPlayable refetched the show -> full record -> description + up-next.
    assert.match(el.querySelector('.mnp-desc').textContent, /episode one/, 'description filled from the refetched episode');
    // v1.251 (R2): whole-queue rows - the reseeded panel shows every episode with
    // the current one marked (music parity), not just the forward slice.
    assert.deepEqual([...el.querySelectorAll('.mnp-queue-title')].map((n) => n.textContent), ['Ep One', 'Ep Two', 'Ep Three']);
    assert.match(el.querySelector('.mnp-queue-row.is-current').textContent, /Ep One/, 'the reseeded current row is marked');
  }, { meta });
});

test('v1.105 (T4 no rebuild-race): a SHOW view does NOT refetch/clobber playable (one episodes fetch)', async () => {
  // On a show drill (?show=s1), openShow owns `playable`; rebuildPlayable must
  // bail so it can't desync the rendered episode rows (the v1.104 CRITICAL class).
  const meta = { id: 'e1', title: 'Ep One', artist: 'The Show', resumeMode: 'podcast', subId: 's1' };
  await boot('http://localhost/podcasts?show=s1&nowplaying=1', 'full', async (dom, mock) => {
    const epFetches = mock.fetches.filter((u) => /\/api\/podcasts\/shows\/[^/]+\/episodes/.test(u));
    assert.equal(epFetches.length, 1, 'only openShow fetched episodes; rebuild bailed (a show view owns playable)');
  }, { meta });
});

test('v1.105 (gate CRITICAL): the dock-tap RESEED path binds the close listener - closing clears the panel (no strand)', async () => {
  // The panel is revealed by the reseed (seedNowPlayingFromPlayer + expand),
  // WITHOUT playAt running this instance. ensureEmptiedListener must still bind at
  // init, or closing the player strands the panel. Non-vacuous: panel shown first.
  const meta = { id: 'e1', title: 'Ep One', artist: 'The Show', resumeMode: 'podcast', subId: 's1' };
  await boot('http://localhost/podcasts?nowplaying=1', 'full', async (dom, mock) => {
    assert.equal(panel(dom).hidden, false, 'reseed revealed the panel (no playAt this instance)');
    assert.ok(panel(dom).textContent.length > 0, 'populated');
    mock.player.currentId = null;
    dom.window.document.getElementById('media-player').dispatchEvent(new dom.window.Event('emptied'));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(panel(dom).hidden, true, 'closing clears the RESEEDED panel');
    assert.equal(panel(dom).textContent, '', 'cleared - not stranded');
  }, { meta });
});

test('v1.105 (post-await TOCTOU): a show opened DURING the rebuild fetch is not clobbered', async () => {
  // Grid landing with show s1 playing + expanded -> rebuildPlayable passes the
  // pre-await gate and awaits s1's (DEFERRED) episodes. Meanwhile the user opens a
  // DIFFERENT show s2 from the grid (currentShow -> s2, playable -> s2 rows). When
  // the deferred s1 fetch resolves, the POST-await re-check must bail so it never
  // clobbers playable with s1 - else the rendered s2 rows go inert (indexOf -1).
  const meta = { id: 'e1', title: 'Ep One', artist: 'The Show', resumeMode: 'podcast', subId: 's1' };
  await boot('http://localhost/podcasts?nowplaying=1', 'full', async (dom, mock) => {
    dom.window.document.querySelector('.podcast-card').click(); // open s2
    await settle(); await settle();
    mock.deferred.resolve(); // now let the in-flight s1 rebuild fetch resolve
    await settle(); await settle();
    const rows = dom.window.document.querySelectorAll('.podcast-episode-main');
    rows[0].click(); // tap the rendered s2 row
    await settle(); await settle();
    assert.ok(lastLoad(mock), 'the rendered row played SOMETHING (playable still holds s2, not clobbered by s1)');
    assert.equal(lastLoad(mock).id, 'x1', 'it played the s2 episode the row represents');
  }, { meta, gridShows: [{ id: 's2', name: 'Show Two' }], deferSubId: 's1' });
});

test('v1.105 (T4 reseed): a NON-podcast item on the shared host does not show the podcast panel', async () => {
  const meta = { id: 'v9', title: 'A Song', artist: 'An Artist', resumeMode: 'music', subId: '' };
  await boot('http://localhost/podcasts?nowplaying=1', 'full', async (dom) => {
    assert.equal(panel(dom).hidden, true, 'a music/video item never shows the podcast panel');
  }, { meta });
});

// ---- v1.251 (R2): the desktop THEATRE toggle, music v1.222 parity ----------------------

test('v1.251 theatre: the button reveals with an expanded episode, toggles is-theater on the stage, and persists ft-podcast-theater', async () => {
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom) => {
    const btn = dom.window.document.getElementById('podcast-theater-btn');
    const stage = dom.window.document.getElementById('podcast-stage');
    await playEp(dom, 0);
    assert.equal(btn.hidden, false, 'an expanded episode reveals the toggle');
    assert.ok(!stage.classList.contains('is-theater'), 'off by default');
    btn.click();
    await settle();
    assert.ok(stage.classList.contains('is-theater'), 'toggle lays the panel beside the player');
    assert.equal(btn.getAttribute('aria-pressed'), 'true');
    assert.equal(dom.window.localStorage.getItem('ft-podcast-theater'), '1', 'persisted per device');
    btn.click();
    await settle();
    assert.ok(!stage.classList.contains('is-theater'), 'a second tap turns it off');
    assert.equal(dom.window.localStorage.getItem('ft-podcast-theater'), '0');
  });
});

test('v1.251 theatre (reveal-once CLEAR): docking hides the toggle again (populated first, both axes)', async () => {
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom, mock) => {
    const btn = dom.window.document.getElementById('podcast-theater-btn');
    await playEp(dom, 0);
    assert.equal(btn.hidden, false, 'populated first (non-vacuous)');
    mock.setState('docked');
    mock.s.trackNav.onNext();
    await settle(); await settle();
    assert.equal(btn.hidden, true, 'no expanded episode -> the toggle hides');
  });
});

// ---- v1.251 (R3): the desktop POP-OUT for podcasts (the shared shell music runs) --------

test('v1.251 pop-out: the button reveals with a playing episode; toggling mounts the skin in the pop-out window and closes it again', async () => {
  const meta = { id: 'e1', title: 'Ep One', artist: 'The Show', resumeMode: 'podcast', subId: 's1' };
  const pipDom = new JSDOM('<body></body>', { url: 'http://localhost/pip' });
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom) => {
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pipDom.window) };
    const btn = dom.window.document.getElementById('podcast-popout-btn');
    await playEp(dom, 0);
    assert.equal(btn.hidden, false, 'a playing episode on desktop reveals the pop-out button');
    btn.click();
    await settle(); await settle(); await settle();
    const pipPanel = pipDom.window.document.getElementById('podcast-nowplaying-panel');
    assert.ok(pipPanel, 'the pop-out surface mounted in the pop-out window');
    assert.ok(pipPanel.classList.contains('mms-full'), 'and the skin painted there');
    assert.ok(pipDom.window.document.body.classList.contains('mms-on'), 'the pop-out body wears the skin cover class');
    assert.equal(btn.getAttribute('aria-pressed'), 'true', 'the button reflects the open pop-out');
    const pipBody = pipDom.window.document.body; // captured ref - jsdom close() tears the window down
    btn.click(); // toggle closes
    await settle(); await settle();
    assert.ok(!pipBody.classList.contains('mms-on'), 'teardown cleared the pop-out mms-on (engine destroy ran before the window closed)');
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
  }, { meta });
});

test('v1.251 pop-out: a NON-podcast item never reveals the button (the gate is resumeMode, not mere playback)', async () => {
  const meta = { id: 'v9', title: 'A Song', artist: 'An Artist', resumeMode: 'music', subId: '' };
  await boot('http://localhost/podcasts?nowplaying=1', 'full', async (dom) => {
    assert.equal(dom.window.document.getElementById('podcast-popout-btn').hidden, true, 'music/video current -> no podcast pop-out');
  }, { meta });
});

// ---- v1.251 (adversarial W3): the podcast-side pop-out guard CLOSURES, each bound ----------

test('W3a TOCTOU: a pop-out grant resolving AFTER the view is destroyed mounts nothing and closes the granted window', async () => {
  const meta = { id: 'e1', title: 'Ep One', artist: 'The Show', resumeMode: 'podcast', subId: 's1' };
  const pipDom = new JSDOM('<body></body>', { url: 'http://localhost/pip' });
  let closed = 0;
  const realClose = pipDom.window.close.bind(pipDom.window);
  pipDom.window.close = () => { closed += 1; realClose(); };
  try {
    await boot('http://localhost/podcasts?show=s1', 'full', async (dom, mock) => {
      let grantResolve = null;
      dom.window.documentPictureInPicture = { requestWindow: () => new Promise((r) => { grantResolve = () => r(pipDom.window); }) };
      await playEp(dom, 0);
      dom.window.document.getElementById('podcast-popout-btn').click(); // grant in flight
      mock.destroyView(); // the view dies mid-grant (a cross-view swap)
      grantResolve();
      await settle(); await settle();
      assert.equal(closed, 1, 'the late grant CLOSED the window instead of mounting (aborted() guard)');
      assert.equal(pipDom.window.document && pipDom.window.document.getElementById && pipDom.window.document.getElementById('podcast-nowplaying-panel'), null, 'no surface was mounted');
    }, { meta });
  } finally {
    // Runner hygiene (the v1.250 wedge lesson): under the aborted()-guard MUTANT the late
    // grant MOUNTS and arms the pip clock past the destroyed view - close the window so a
    // red run FAILS instead of wedging node:test forever.
    try { pipDom.window.close(); } catch (_) { /* already closed by the guard */ }
  }
});

test('W3b supported() gate: a NARROW viewport hides the button and a forced toggle opens nothing (never-both-live)', async () => {
  const meta = { id: 'e1', title: 'Ep One', artist: 'The Show', resumeMode: 'podcast', subId: 's1' };
  const mm = { narrow: true };
  await boot('http://localhost/podcasts?show=s1', 'full', async (dom) => {
    let grants = 0;
    dom.window.documentPictureInPicture = { requestWindow: () => { grants += 1; return Promise.resolve(null); } };
    await playEp(dom, 0);
    const btn = dom.window.document.getElementById('podcast-popout-btn');
    assert.equal(btn.hidden, true, 'narrow viewport (the in-tab skin owns the surface) -> no pop-out button');
    btn.click(); // even a forced click must no-op at the open() gate
    await settle();
    assert.equal(grants, 0, 'open() re-checked supported() at click time - no grant requested');
  }, { meta, mm });
});

test('W3c resize enforcement: shrinking into the narrow range TEARS DOWN an open podcast pop-out', async () => {
  const meta = { id: 'e1', title: 'Ep One', artist: 'The Show', resumeMode: 'podcast', subId: 's1' };
  const mm = { narrow: false };
  const pipDom = new JSDOM('<body></body>', { url: 'http://localhost/pip' });
  try {
    await boot('http://localhost/podcasts?show=s1', 'full', async (dom) => {
      dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pipDom.window) };
      await playEp(dom, 0);
      const btn = dom.window.document.getElementById('podcast-popout-btn');
      btn.click();
      await settle(); await settle(); await settle();
      assert.equal(btn.getAttribute('aria-pressed'), 'true', 'pop-out open (populated first - non-vacuous)');
      const pipBody = pipDom.window.document.body;
      mm.narrow = true; // the viewport crosses into the in-tab-skin range
      dom.window.dispatchEvent(new dom.window.Event('resize'));
      await settle(); await settle();
      assert.equal(btn.getAttribute('aria-pressed'), 'false', 'the resize arm tore the pop-out down');
      assert.ok(!pipBody.classList.contains('mms-on'), 'the pop-out surface was destroyed (mms-on cleared before close)');
    }, { meta, mm });
  } finally {
    // Runner hygiene (adversarial delta S2, the v1.250 wedge class): under the D7
    // arm-deletion mutant the pop-out never tears down and its clock keeps the loop alive -
    // close the window so a red run FAILS fast instead of wedging node:test.
    try { pipDom.window.close(); } catch (_) { /* already closed by the resize arm */ }
  }
});
