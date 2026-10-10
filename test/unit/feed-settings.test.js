'use strict';

// [UNIT] v1.382.0 Feed settings (plan docs/exec-plans/completed/2026-10-10-feed-settings.md D1-D5, D11): the ONE shared
// reading (public/js/feed-settings.js, required by the server too) and the Settings > Feed page through the REAL setup.js
// over the page exactly as setup.html ships it (lifted, not re-typed).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const FS = require('../../public/js/feed-settings.js');

const ROOT = path.join(__dirname, '..', '..');
const SETUP_HTML = fs.readFileSync(path.join(ROOT, 'public', 'setup.html'), 'utf8');
const FEED_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'feed-settings.js'), 'utf8');

// ---- the shared reading ---------------------------------------------------------------------------------------------

test('normalize: junk, a non-object and an empty value read as the defaults (every kind on, Both, saved place, 60 s / 2 min)', () => {
  for (const raw of [null, undefined, '', 'not json', '[]', '42', '{"off":"song"}', { off: null }]) {
    const s = FS.normalize(raw);
    assert.deepStrictEqual(s.off, [], String(raw));
    assert.deepStrictEqual(s.which, { video: 'both', podcast: 'both', book: 'both' });
    assert.deepStrictEqual(s.where, { video: 'saved', podcast: 'saved', book: 'saved' });
    assert.strictEqual(s.reel, 60);
    assert.strictEqual(s.slice, 120);
    assert.deepStrictEqual(Object.keys(s).sort(), ['off', 'reel', 'slice', 'where', 'which'], 'v1.382.0 gate r1: the moved W5 fields (clip, music, station) are gone');
  }
});

test('normalize: every value is checked against its list; an off-list value is the default, never kept', () => {
  const s = FS.normalize({ off: ['song', 'bogus', '__proto__'], which: { video: 'new', podcast: 'everything', book: 'continue' }, where: { video: 'start', podcast: 'start', book: 'middle' }, reel: 45, slice: 240, clip: 0, music: 'loud', station: 'x' });
  assert.deepStrictEqual(s.off, ['song']);
  assert.deepStrictEqual(s.which, { video: 'new', podcast: 'both', book: 'continue' });
  assert.strictEqual(s.where.podcast, 'start');
  assert.strictEqual(s.where.book, 'saved', 'an unknown place is the saved place');
  assert.strictEqual(s.reel, 60, '45 s is not a video reel length');
  assert.strictEqual(s.slice, 240);
  assert.ok(!('clip' in s) && !('music' in s) && !('station' in s), 'an unknown field (the moved W5 ones) never comes through');
  assert.strictEqual(FS.normalize({ reel: '60' }).reel, 60, 'a string is not the number (defaults anyway)');
  assert.strictEqual(FS.normalize({ reel: 30 }).reel, 30);
});

test('normalize D4 (gate r1, qa suggestion 1): a chosen Where is kept while that kind is New only (it does nothing then) and is there when the kind goes back to Both', () => {
  const s = FS.normalize({ which: { video: 'new' }, where: { video: 'start' } });
  assert.strictEqual(s.where.video, 'start');
  assert.strictEqual(FS.normalize(FS.serialize(s)).where.video, 'start', 'it survives the stored form');
  assert.strictEqual(FS.normalize({ which: { video: 'continue' }, where: { video: 'start' } }).where.video, 'start');
});

test('normalize D2: a value with every kind off reads as all on (the Feed can never be switched off entirely)', () => {
  assert.deepStrictEqual(FS.normalize({ off: FS.KINDS.slice() }).off, []);
  assert.deepStrictEqual(FS.normalize({ off: FS.KINDS.slice(1) }).off, FS.KINDS.slice(1), 'four off is kept: one kind is on');
});

test('serialize writes only what differs from the defaults, round-trips, and its worst case fits the 512-byte pref cap', () => {
  assert.strictEqual(FS.serialize({}), '{}');
  const worst = { off: FS.KINDS.slice(1), which: { video: 'continue', podcast: 'continue', book: 'continue' }, where: { video: 'start', podcast: 'start', book: 'start' }, reel: 120, slice: 240 };
  const out = FS.serialize(worst);
  assert.ok(FS.utf8Bytes(out) <= FS.SETTINGS_MAX_BYTES, 'worst case ' + FS.utf8Bytes(out) + ' bytes');
  assert.deepStrictEqual(FS.normalize(out), FS.normalize(worst));
  assert.strictEqual(FS.SETTINGS_MAX_BYTES, require('../../lib/prefs-allowlist').prefValueMaxBytes(FS.SETTINGS_KEY));
});

test('the keys are the synced ones (both lists carry them)', () => {
  const shared = require('../../lib/prefs-allowlist');
  assert.ok(shared.SYNCED_PREF_KEYS.includes(FS.SETTINGS_KEY));
  assert.ok(shared.SYNCED_PREF_KEYS.includes(FS.FEWER_KEY));
  const client = fs.readFileSync(path.join(ROOT, 'public', 'js', 'prefs-sync.js'), 'utf8');
  assert.ok(client.includes("'" + FS.SETTINGS_KEY + "'") && client.includes("'" + FS.FEWER_KEY + "'"));
});

test('Fewer from: keys are typed, trimmed, deduplicated case-blind (the newest spelling kept), capped at 200 (oldest first out)', () => {
  assert.strictEqual(FS.fewerKey('channel', '  Lofi   Girl '), 'channel:Lofi Girl');
  assert.strictEqual(FS.fewerKey('planet', 'x'), '');
  assert.strictEqual(FS.fewerKey('show', ''), '');
  assert.strictEqual(FS.fewerKey('show', 'a\u0001b'), '');
  assert.strictEqual(FS.fewerKey('show', 'x'.repeat(101)), '');
  let l = FS.fewerAdd([], 'channel:Lofi Girl');
  l = FS.fewerAdd(l, 'show:Radiolab');
  l = FS.fewerAdd(l, 'channel:LOFI GIRL');
  assert.deepStrictEqual(l, ['show:Radiolab', 'channel:LOFI GIRL']);
  assert.deepStrictEqual(FS.fewerRemove(l, 'channel:lofi girl'), ['show:Radiolab']);
  const many = [];
  for (let i = 0; i < 210; i++) many.push('artist:A' + i);
  const capped = FS.parseFewer(many);
  assert.strictEqual(capped.length, 200);
  assert.strictEqual(capped[0], 'artist:A10', 'the oldest ten dropped');
  const set = FS.fewerSet(['channel:Lofi Girl', 'junk', 'author:Le Guin']);
  assert.strictEqual(set.size, 2);
  assert.ok(set.has('channel', 'lofi girl'));
  assert.ok(!set.has('show', 'Lofi Girl'), 'the type is part of the key');
  assert.ok(set.has('author', ' Le  Guin '));
});

test('Fewer from: 200 of the longest names fit the 8 KB key (serializeFewer trims the oldest past it)', () => {
  const many = [];
  for (let i = 0; i < 200; i++) many.push('channel:' + String(i).padStart(3, '0') + 'x'.repeat(97));
  const out = FS.serializeFewer(many);
  assert.ok(FS.utf8Bytes(out) <= FS.FEWER_MAX_BYTES);
  const kept = JSON.parse(out);
  assert.ok(kept.length > 0 && kept.length < 200, 'trimmed to fit: ' + kept.length);
  assert.strictEqual(kept[kept.length - 1], many[199], 'the newest is kept');
  const real = [];
  for (let i = 0; i < 200; i++) real.push('channel:Channel name number ' + i);
  assert.strictEqual(JSON.parse(FS.serializeFewer(real)).length, 200, 'ordinary names: all 200 fit');
});

test('feed-settings.js is plain ES5 for every shell (no const / let / arrow) and ships on every shell that loads setup.js', () => {
  const code = FEED_SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\b(const|let)\s/.test(code), 'no const / let');
  assert.ok(!/=>/.test(code), 'no arrow functions');
  const shells = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, 'public', f))
    .concat([path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html')]);
  let checked = 0;
  for (const f of shells) {
    const html = fs.readFileSync(f, 'utf8');
    const setupAt = html.indexOf('<script src="/js/setup.js"></script>');
    if (setupAt < 0) continue;
    checked += 1;
    const at = html.indexOf('<script src="/js/feed-settings.js"></script>');
    assert.ok(at > 0 && at < setupAt, path.basename(f) + ': feed-settings.js before setup.js');
  }
  assert.ok(checked >= 11, 'fail-safe floor: ' + checked + ' shells');
});

// ---- the Settings page (D1-D5) -------------------------------------------------------------------------------------

const PAGE = SETUP_HTML.match(/<details class="setup-box setup-sec sub-collapsible" data-collapse-key="feed"[\s\S]*?<\/details>/);

function boot(stored) {
  assert.ok(PAGE, 'setup.html ships the Feed page');
  delete global.document; delete global.window; delete global.fetch;
  const dom = new JSDOM(`<!DOCTYPE html><body>${PAGE[0]}</body>`, { url: 'http://localhost/setup.html', runScripts: 'outside-only' });
  dom.window.eval(FEED_SRC);
  if (stored !== undefined) dom.window.localStorage.setItem(FS.SETTINGS_KEY, stored);
  global.window = dom.window;
  global.document = dom.window.document;
  delete require.cache[require.resolve('../../public/js/setup.js')];
  const mod = require('../../public/js/setup.js');
  const ctl = new dom.window.AbortController();
  const page = mod.wireFeedSettingsPage(dom.window.document, ctl.signal);
  const $ = (id) => dom.window.document.getElementById(id);
  const change = (node, v) => { if (typeof v === 'boolean') node.checked = v; else node.value = v; node.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  const stored$ = () => FS.normalize(dom.window.localStorage.getItem(FS.SETTINGS_KEY));
  return { dom, page, $, change, stored$, mod, done: () => { ctl.abort(); dom.window.close(); delete global.window; delete global.document; } };
}

test('the page lives under Personalize after Bottom bar, and its option lists ARE the shared lists (a census both ways)', () => {
  const doc = new JSDOM(`<!DOCTYPE html><body>${PAGE[0]}</body>`).window.document;
  const sec = doc.querySelector('details');
  assert.strictEqual(sec.getAttribute('data-md-group'), 'Personalize');
  assert.ok(/data-collapse-key="bottom-bar"[\s\S]*?<\/details>\s*<!--[\s\S]*?-->\s*<details[^>]*data-collapse-key="feed"/.test(SETUP_HTML), 'right after Bottom bar');
  assert.deepStrictEqual(Array.from(doc.querySelectorAll('[data-feed-kind]')).map((b) => b.getAttribute('data-feed-kind')), FS.KINDS);
  for (const k of FS.CHOICE_KINDS) {
    assert.deepStrictEqual(Array.from(doc.querySelectorAll('#feed-which-' + k + ' option')).map((o) => o.value), FS.WHICH, k + ' which');
    assert.deepStrictEqual(Array.from(doc.querySelectorAll('#feed-where-' + k + ' option')).map((o) => o.value), FS.WHERE, k + ' where');
  }
  assert.deepStrictEqual(Array.from(doc.querySelectorAll('#feed-reel option')).map((o) => Number(o.value)), FS.VIDEO_REELS);
  assert.deepStrictEqual(Array.from(doc.querySelectorAll('#feed-slice option')).map((o) => Number(o.value)), FS.PODCAST_SLICES);
  assert.ok(!/—/.test(PAGE[0]), 'no em dashes in the page copy');
});

test('reflect-on-load: a stored value draws every control; nothing stored draws the defaults', () => {
  let b = boot(JSON.stringify({ off: ['song'], which: { podcast: 'continue' }, where: { podcast: 'start' }, reel: 90, slice: 60 }));
  try {
    assert.strictEqual(b.$('feed-kind-song').checked, false);
    assert.strictEqual(b.$('feed-kind-video').checked, true);
    assert.strictEqual(b.$('feed-which-podcast').value, 'continue');
    assert.strictEqual(b.$('feed-where-podcast').value, 'start');
    assert.strictEqual(b.$('feed-reel').value, '90');
    assert.strictEqual(b.$('feed-slice').value, '60');
  } finally { b.done(); }
  b = boot();
  try {
    assert.ok(['video', 'podcast', 'book', 'watchlater', 'song'].every((k) => b.$('feed-kind-' + k).checked));
    assert.strictEqual(b.$('feed-reel').value, '60');
    assert.strictEqual(b.$('feed-slice').value, '120');
  } finally { b.done(); }
});

test('persist: each control writes the synced key through the shared reading', () => {
  const b = boot();
  try {
    b.change(b.$('feed-kind-podcast'), false);
    assert.deepStrictEqual(b.stored$().off, ['podcast']);
    b.change(b.$('feed-which-video'), 'new');
    assert.strictEqual(b.stored$().which.video, 'new');
    b.change(b.$('feed-which-book'), 'continue');
    b.change(b.$('feed-where-book'), 'start');
    assert.strictEqual(b.stored$().where.book, 'start');
    b.change(b.$('feed-reel'), '30');
    assert.strictEqual(b.stored$().reel, 30);
    b.change(b.$('feed-slice'), '240');
    assert.strictEqual(b.stored$().slice, 240);
    b.change(b.$('feed-kind-podcast'), true);
    assert.deepStrictEqual(b.stored$().off, []);
    assert.strictEqual(b.dom.window.localStorage.getItem(FS.SETTINGS_KEY), JSON.stringify({ which: { video: 'new', book: 'continue' }, where: { book: 'start' }, reel: 30, slice: 240 }));
  } finally { b.done(); }
});

test('D2: the last kind on cannot be switched off (disabled, with the note); one more on frees it', () => {
  const b = boot(JSON.stringify({ off: ['video', 'podcast', 'book', 'watchlater'] }));
  try {
    assert.strictEqual(b.$('feed-kind-song').checked, true);
    assert.strictEqual(b.$('feed-kind-song').disabled, true, 'the last one is locked on');
    assert.match(b.$('feed-kinds-note').textContent, /switch another kind on/);
    // a forced uncheck (a script, a stale page) still cannot store every kind off
    b.change(b.$('feed-kind-song'), false);
    assert.deepStrictEqual(b.stored$().off, [], 'all off reads as all on: the Feed is never empty by settings');
    b.page.reflect();
    b.change(b.$('feed-kind-podcast'), false);
    b.change(b.$('feed-kind-video'), false);
    b.change(b.$('feed-kind-book'), false);
    b.change(b.$('feed-kind-watchlater'), false);
    assert.strictEqual(b.$('feed-kind-song').disabled, true);
    b.change(b.$('feed-kind-book'), true);
    assert.strictEqual(b.$('feed-kind-song').disabled, false, 'two on: either may go');
    assert.match(b.$('feed-kinds-note').textContent, /Keep at least one on\./);
  } finally { b.done(); }
});

test('D4: "Where they start" is disabled with its reason while that kind is New only, and comes back with its own text', () => {
  const b = boot();
  try {
    const help = b.dom.window.document.querySelector('[data-feed-where-help="video"]');
    const original = help.textContent;
    b.change(b.$('feed-which-video'), 'new');
    assert.strictEqual(b.$('feed-where-video').disabled, true);
    assert.strictEqual(help.textContent, b.mod.FEED_WHERE_NEW_ONLY_HELP);
    assert.strictEqual(b.$('feed-where-podcast').disabled, false, 'only that kind');
    b.change(b.$('feed-which-video'), 'continue');
    assert.strictEqual(b.$('feed-where-video').disabled, false);
    assert.strictEqual(help.textContent, original);
    b.change(b.$('feed-kind-video'), false);
    assert.strictEqual(b.$('feed-which-video').disabled, true, 'a kind switched off greys its choices');
  } finally { b.done(); }
});

test('D4 (gate r1, qa suggestion 1): From the beginning survives a trip through New only on the page', () => {
  const b = boot();
  try {
    b.change(b.$('feed-where-video'), 'start');
    b.change(b.$('feed-which-video'), 'new');
    assert.strictEqual(b.$('feed-where-video').disabled, true);
    b.change(b.$('feed-which-video'), 'both');
    assert.strictEqual(b.$('feed-where-video').value, 'start', 'the choice is still there');
    assert.strictEqual(b.stored$().where.video, 'start');
  } finally { b.done(); }
});

test('the account copy landing later (prefs-sync boot) draws the page again', () => {
  delete global.document; delete global.window;
  const dom = new JSDOM(`<!DOCTYPE html><body>${PAGE[0]}</body>`, { url: 'http://localhost/setup.html', runScripts: 'outside-only' });
  dom.window.eval(FEED_SRC);
  const waiters = [];
  dom.window.__ftPrefsSync = { whenBooted: (fn) => waiters.push(fn) };
  global.window = dom.window; global.document = dom.window.document;
  delete require.cache[require.resolve('../../public/js/setup.js')];
  const mod = require('../../public/js/setup.js');
  const ctl = new dom.window.AbortController();
  mod.wireFeedSettingsPage(dom.window.document, ctl.signal);
  assert.strictEqual(dom.window.document.getElementById('feed-reel').value, '60');
  dom.window.localStorage.setItem(FS.SETTINGS_KEY, JSON.stringify({ reel: 120 })); // what applyServer writes (raw)
  assert.strictEqual(waiters.length, 1);
  waiters[0]();
  assert.strictEqual(dom.window.document.getElementById('feed-reel').value, '120');
  ctl.abort(); dom.window.close(); delete global.window; delete global.document;
});

test('the Feed picker carries a gear to Settings > Feed', () => {
  const { renderFeedShell } = require('../../lib/feed/shell.js');
  const html = renderFeedShell(fs.readFileSync(path.join(ROOT, 'public', 'history.html'), 'utf8'));
  const doc = new JSDOM(html).window.document;
  const gear = doc.querySelector('#feed-picker #feed-settings-link');
  assert.ok(gear, 'the gear is in the picker');
  assert.strictEqual(gear.getAttribute('href'), '/setup.html#feed');
  assert.strictEqual(gear.getAttribute('aria-label'), 'Feed settings');
  assert.ok(doc.querySelector('details[data-collapse-key="feed"]') === null, 'the page itself is Settings\'s (the feed shell does not carry it)');
});
