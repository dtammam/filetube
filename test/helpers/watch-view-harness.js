'use strict';
// A jsdom realm running the REAL watch view (UI pass sweep S3): public/watch.html's markup,
// the real ui.js, common.js, main.js and watch.js, a recording fetch and a stub persistent
// player (the <video> host is player.js's and is carved out of the sweep - its own tests
// drive it). `watchViewRealm({ item, subs, pins, me, settings, route })`:
//   item      the GET /api/videos/:id record (default VIDEO);
//   subs/pins the /api/subscriptions and /api/subscriptions/pins answers (module on);
//   me        the /api/auth/me user (default an admin: canModifyLibrary);
//   route     (method, url, body) -> {status, body, delayMs?} | null, consulted first (delayMs: answer late);
//   player    members merged into the stub player (v1.366.0: getState, currentId).
// Returns { w, doc, $, fetches, calls(method, prefix), settle(), init() , destroy() }.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

const VIDEO = {
  id: 'vid1', title: 'Restoring a bench', filePath: '/lib/Harbor Workshop/Restoring a bench.mp4', folderName: 'Harbor Workshop',
  rootFolder: '/lib', type: 'video', size: 40e6, ext: '.mp4', duration: 600, addedAt: Date.now() - 86400e3,
  channelUrl: 'https://www.youtube.com/@harborworkshop', channelName: 'Harbor Workshop', watchUrl: 'https://www.youtube.com/watch?v=abc',
  hasSubtitles: true, liked: false, watchState: 'unwatched', tags: { description: 'A description.', genre: 'Craft' },
};

function watchViewRealm(o) {
  const opts = o || {};
  const item = opts.item || VIDEO;
  const vc = new VirtualConsole();
  const dom = new JSDOM(read('public/watch.html'), {
    url: 'http://localhost/watch.html?v=' + encodeURIComponent(item.id), runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.scrollTo = () => {};
  const fetches = [];
  const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  w.fetch = (u, init) => {
    const method = (init && init.method) || 'GET';
    const url = String(u);
    const body = init && typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body); } catch (_) { return init.body; } })() : null;
    fetches.push({ method, url, body });
    const r = opts.route ? opts.route(method, url, body) : null;
    if (r && r.delayMs > 0) return new Promise((res) => setTimeout(res, r.delayMs)).then(() => json(r.status, r.body)); // v1.366.0: a late answer
    if (r) return json(r.status, r.body);
    if (url === '/api/auth/me') return json(200, { user: opts.me === undefined ? { username: 'admin', role: 'admin' } : opts.me });
    if (url === '/api/config') return json(200, { folders: ['/lib'], folderSettings: {} });
    if (url === '/api/videos/' + item.id) return json(200, item);
    if (url === '/api/settings') return json(200, opts.settings || {});
    if (url === '/api/subscriptions/health') return json(opts.moduleOff ? 503 : 200, {});
    if (url === '/api/subscriptions') return json(200, opts.subs || []);
    if (url === '/api/subscriptions/pins') return json(200, opts.pins || []);
    if (url.indexOf('/api/videos?') === 0) return json(200, { items: [], total: 0 });
    return json(200, {});
  };
  const loads = [];
  let registered = null;
  const player = new Proxy({
    currentId: null, getState: () => ({ docked: false, loaded: false }),
    load: (id, data, lo) => { loads.push({ id, data, lo }); return true; },
    close: () => { loads.push({ close: true }); }, expand: () => {}, setTrackNav: () => {}, isLoopEnabled: () => false,
    getCurrentTime: () => (opts.currentTime == null ? null : opts.currentTime), applyLateDetail: () => {},
    // v1.366.0: a test may override or add player members (getState, currentId, ...); `opts.player` is merged in.
    ...(opts.player || {}),
  }, { get(t, p) { return p in t ? t[p] : () => undefined; } });
  w.__harness = {
    register: (name, h) => { if (name === 'watch') registered = h; },
    player,
    navigate: (u) => { loads.push({ navigate: u }); },
  };
  // ONE script (the shell's order: the icon registry, the glyph pool, the body lock, the
  // primitives, the page scripts): classic scripts share one global lexical scope (common.js
  // reads glyph-pool.js's top-level consts), which separate evals would not. The stub player,
  // router hook and navigate go in right before watch.js registers.
  const srcs = ['public/js/icons.js', 'public/js/glyph-pool.js', 'public/js/body-scroll-lock.js', 'public/js/ui.js', 'public/js/interaction.js', 'public/js/common.js', 'public/js/main.js'].map(read);
  srcs.push('window.FileTube = window.FileTube || {}; window.FileTube.registerView = window.__harness.register; window.FileTube.player = window.__harness.player; window.FileTube.navigate = window.__harness.navigate;');
  srcs.push(read('public/js/watch.js'));
  w.eval(srcs.join('\n;\n'));
  const $ = (s) => w.document.querySelector(s);
  const settle = async (n) => { for (let i = 0; i < (n || 12); i++) await new Promise((r) => setTimeout(r, 5)); };
  const root = w.document.getElementById('view-root');
  return {
    w, doc: w.document, $, fetches, loads, root, settle,
    calls: (method, prefix) => fetches.filter((f) => f.method === method && f.url.indexOf(prefix) === 0),
    init: () => { if (!registered) throw new Error('watch.js did not register'); registered.init(root); },
    destroy: () => registered.destroy(),
    close: () => w.close(),
  };
}

module.exports = { watchViewRealm, VIDEO };
