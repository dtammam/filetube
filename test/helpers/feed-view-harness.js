'use strict';
// A jsdom realm running the REAL feed view (public/js/feed.js) for its unit tests: the feed
// shell's markup (lib/feed/shell.js over public/history.html), the real ui.js + common.js, a
// recording fetch with the feed routes faked, a stub shared player whose load() drops a fake
// <video id="media-player"> into the card's slot, a controllable IntersectionObserver, and
// captured timers (setInterval callbacks are collected so a test ticks the session clock by
// hand after moving the realm's Date.now). `feedRealm({ batches, route, week, bookWriteStatus })`.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { renderFeedShell } = require('../../lib/feed/shell');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

const BOOK = { kind: 'book', id: 'bk1', title: 'Alpha', author: 'W', chapterLabel: 'Chapter 1 of 3', readerHref: '/read.html?b=bk1', start: { spineIndex: 0, blockIndex: 1 }, blocks: [{ spineIndex: 0, blockIndex: 1, text: 'First <b>para</b>.', heading: false, chapterStart: false }, { spineIndex: 0, blockIndex: 2, text: 'Second.', heading: false, chapterStart: false }], words: 500, dwellSec: 5, next: { spineIndex: 0, blockIndex: 3 }, atEnd: false };
const POD = { kind: 'podcast', media: 'podcast', id: 'ep1', title: 'Ep', showName: 'Show', subId: 's1', artUrl: '/podcastart/s1', streamSrc: '/episode/ep1', durationSec: 1800, position: 600, startAt: 600, endAt: 840, sliceSec: 240 };
const VID = { kind: 'video', media: 'video', id: 'v1', title: 'V', channelName: 'C', duration: 1200, width: 1920, height: 1080, thumbnailUrl: '/thumbnail/v1', startAt: 400, endAt: 900, chapter: { index: 1, count: 3, title: 'Middle' } };
const SONG = { kind: 'song', id: 't1', track: { id: 't1', title: 'Song', artist: 'Art', album: 'Al', durationSec: 200, liked: true } };
const WL = { kind: 'watchlater', media: 'video', id: 'v5', title: 'Later', channelName: 'C', duration: 600, startAt: 0, endAt: 180, chapter: null, watchLater: true, thumbnailUrl: '/thumbnail/v5' };

function feedRealm(o) {
  const opts = o || {};
  const vc = new VirtualConsole();
  const html = renderFeedShell(read('public/history.html'));
  const dom = new JSDOM(html, { url: 'http://localhost/feed', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  // v1.381.0 (D6): jsdom lays nothing out, so a book page box is MODELLED when a test asks: `pageWords` words fit a page
  // (clientHeight = the budget, scrollHeight = the words drawn). Without it the box has no height and the view keeps the
  // card on one unmeasured page, as a real card that is not laid out yet does.
  // `unlaidPages`: a page box with NO height yet but its text drawn (a real card before layout) - nothing may be measured then
  if (opts.pageWords || opts.unlaidPages) {
    const isPage = (el) => el && el.classList && el.classList.contains('feed-card__page');
    const words = (el) => { const t = (el.textContent || '').trim(); return t ? t.split(/\s+/).length : 0; };
    // `w.__pageWords` overrides the budget mid-test (a rotation: the box changes size)
    Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return isPage(this) ? (w.__pageWords !== undefined ? w.__pageWords : (opts.pageWords || 0)) : 0; } });
    Object.defineProperty(w.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return isPage(this) ? words(this) : 0; } });
  }
  w.HTMLElement.prototype.scrollIntoView = function () { w.__scrolledInto = this; };
  // jsdom has no IntersectionObserver: a controllable stub the test drives
  const observers = [];
  w.IntersectionObserver = class { constructor(cb, init) { this.cb = cb; this.init = init; this.targets = []; observers.push(this); } observe(t) { this.targets.push(t); } unobserve() {} disconnect() { this.disconnected = true; } };
  // timers: setInterval callbacks are captured (the session clock, the hold), setTimeout stays real
  const intervals = [];
  const realSetInterval = w.setInterval;
  w.setInterval = (fn, ms) => { const id = intervals.length + 1; intervals.push({ id, fn, ms, live: true }); return id; };
  w.clearInterval = (id) => { const it = intervals.find((x) => x.id === id); if (it) it.live = false; };
  const fetches = [];
  const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const batches = opts.batches || [{ cards: [BOOK, POD, VID, SONG, WL], exhausted: false }];
  let batchNo = 0;
  let finished = false;
  let sessionNo = 0;
  let extensions = 0;
  w.fetch = (u, init) => {
    // gate r1 (adversary W1): a fetch on an ABORTED signal rejects at once, as the platform's does (the view's abort on leave)
    if (init && init.signal && init.signal.aborted) return Promise.reject(new w.DOMException('The operation was aborted.', 'AbortError'));
    const method = (init && init.method) || 'GET';
    const url = String(u);
    const body = init && typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body); } catch (_) { return init.body; } })() : null;
    fetches.push({ method, url, body });
    const r = opts.route ? opts.route(method, url, body) : null;
    if (r) return json(r.status, r.body);
    if (url === '/api/feed/sessions/week') return json(200, finished ? { sessions: 3, totalSec: 1800 } : (opts.week || { sessions: 2, totalSec: 1500 }));
    // each session its own id (the first is the one most tests name): a test can tell the session a request rode
    if (url === '/api/feed/sessions' && method === 'POST') { sessionNo += 1; return json(200, { session: { id: sessionNo === 1 ? 'abcdef0123456789' : 'abcdef01234567' + (89 + sessionNo), plannedMin: body.plannedMin, startedAt: opts.startedAt || new Date(w.Date.now()).toISOString(), extensions: 0 }, week: { sessions: 2, totalSec: 1500 } }); }
    // a batch arrives as JSON (fresh objects every time, as from the server): the view may mutate its cards (a Start over
    // does), and a test must never see another test's mutation on a shared fixture object
    if (url.indexOf('/api/feed?') === 0) { const b = batches[Math.min(batchNo, batches.length - 1)]; batchNo += 1; return json(200, JSON.parse(JSON.stringify(b))); }
    if (url.indexOf('/api/feed/progress/book/') === 0) return json(opts.bookWriteStatus || 200, opts.bookWriteStatus === 409 ? { ok: false, reason: 'stale' } : { ok: true });
    if (url.indexOf('/api/feed/sessions/') === 0 && url.endsWith('/finish')) { finished = true; return json(200, { session: {}, week: { sessions: 3, totalSec: 1800 } }); }
    if (url.indexOf('/api/feed/sessions/') === 0 && url.endsWith('/extend')) { extensions += 1; return json(opts.extendStatus || 200, { session: { extensions } }); }
    if (url === '/api/auth/me') return json(200, { user: { username: 'admin', role: 'admin' } });
    if (url === '/api/config') return json(200, { folders: ['/lib'], folderSettings: {} });
    return json(200, {});
  };
  const loads = [];
  let registered = null;
  const media = w.document.createElement('video');
  media.id = 'media-player';
  const player = new Proxy({
    currentId: null,
    load: (id, data, lo) => { loads.push({ id, data, lo }); if (lo && lo.slot) lo.slot.appendChild(media); return true; },
    pause: () => { loads.push({ pause: true }); },
    close: () => { loads.push({ close: true }); },
    getState: () => 'full',
  }, { get(t, p) { return p in t ? t[p] : () => undefined; } });
  const toasts = [];
  w.__harness = { register: (name, h) => { if (name === 'feed') registered = h; }, player, navigate: (u) => { loads.push({ navigate: u }); } };
  const srcs = ['public/js/icons.js', 'public/js/glyph-pool.js', 'public/js/body-scroll-lock.js', 'public/js/ui.js', 'public/js/interaction.js', 'public/js/feed-settings.js', 'public/js/common.js'].map(read);
  srcs.push('window.FileTube = window.FileTube || {}; window.FileTube.registerView = window.__harness.register; window.FileTube.player = window.__harness.player; window.FileTube.navigate = window.__harness.navigate; window.ui.toast = function (m, o) { window.__toasts.push(typeof m === \'string\' ? m : \'[not a string: \' + typeof m + \']\'); window.__toastOpts.push(o || null); return { dismiss: function () {} }; };');
  w.__toasts = toasts;
  w.__toastOpts = []; // v1.381.0: the real signature is toast(message, opts) - a stub that took one object hid a shipped "[object Object]" toast
  srcs.push(read('public/js/feed.js'));
  w.eval(srcs.join('\n;\n'));
  const root = w.document.getElementById('view-root');
  const settle = async (n) => { for (let i = 0; i < (n || 12); i++) await new Promise((r) => setTimeout(r, 5)); };
  const show = (index) => {
    const ob = observers[observers.length - 1];
    const entries = ob.targets.map((t) => ({ target: t, isIntersecting: Number(t.getAttribute('data-index')) === index, intersectionRatio: Number(t.getAttribute('data-index')) === index ? 0.95 : 0 }));
    ob.cb(entries);
  };
  // move the realm's clock forward by ms (Date.now only; the tests tick timers by hand)
  let offset = 0;
  const realNow = w.Date.now.bind(w.Date);
  w.Date.now = () => realNow() + offset;
  const advance = (ms) => { offset += ms; };
  const tickIntervals = () => { intervals.filter((it) => it.live).forEach((it) => it.fn()); };
  const timeAt = (sec) => { Object.defineProperty(media, 'currentTime', { value: sec, configurable: true, writable: true }); media.dispatchEvent(new w.Event('timeupdate')); };
  return {
    w, doc: w.document, $: (s) => w.document.querySelector(s), $$: (s) => Array.from(w.document.querySelectorAll(s)), fetches, loads, toasts, root, settle, show, media, observers, intervals, advance, tickIntervals, timeAt,
    realSetInterval,
    calls: (method, prefix) => fetches.filter((f) => f.method === method && f.url.indexOf(prefix) === 0),
    init: () => { if (!registered) throw new Error('feed.js did not register'); registered.init(root); },
    destroy: () => registered.destroy(),
    close: () => w.close(),
  };
}

module.exports = { feedRealm, BOOK, POD, VID, SONG, WL };
