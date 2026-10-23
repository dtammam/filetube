'use strict';

// [UNIT] v1.394.0 W4: the watch page's real top comments, through the REAL view (watch.html +
// ui.js + common.js + main.js + rich-text.js + watch.js in jsdom, test/helpers/watch-view-harness.js)
// with GET /api/videos/:id/comments answered from the REAL fixture comments. The R1 matrix: the
// four `ft-comments` values x Modern vs a retro look, read through the page's OWN era rule (the
// .ft-fabricated / data-era-flourish CSS, injected verbatim from style.css), so "fun never in
// Modern" and "real in every look" are measured with getComputedStyle, not inferred from classes.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { watchViewRealm, VIDEO } = require('../helpers/watch-view-harness');
const W = require('../../public/js/watch.js');
const SC = require('../../lib/media/sourceComments');

const REPO = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ERA_RULES = [
  CSS.match(/html:not\(\[data-era-flourish="on"\]\) \.ft-fabricated \{\s*display: none;\s*\}/)[0],
  CSS.match(/html\[data-era-flourish="on"\] \.ft-unfabricated \{\s*display: none;\s*\}/)[0],
  '[hidden] { display: none !important; }',
].join('\n');
const REAL_LINE = fs.readFileSync(path.join(REPO, 'test/fixtures/ytdlp-comments/ftcomments-jNQXAC9IVRw.txt'), 'utf8').trim();
const NOW = Date.now();
const SNAP = SC.decideSnapshot(JSON.parse(REAL_LINE.slice('FTCOMMENTS '.length)), NOW - 3 * 86400e3);
// One divergent comment with a link and a time in it (the real ones carry neither).
SNAP.comments.push({ id: 'x1', text: 'see https://example.com/parts at 2:15 and 1:02:33', author: '@Linker', timestamp: Math.floor((NOW - 2 * 365 * 86400e3) / 1000) });

async function page(opts) {
  const o = opts || {};
  const r = watchViewRealm({
    item: { ...VIDEO, duration: 600 },
    route: (m, u) => (u === '/api/videos/vid1/comments' ? { status: 200, body: o.snap === undefined ? SNAP : o.snap } : null),
    player: { seek: (s) => (r.seeks = (r.seeks || []).concat(s)), play: () => {} },
  });
  const style = r.doc.createElement('style');
  style.textContent = ERA_RULES;
  r.doc.head.appendChild(style);
  if (o.mode) r.w.localStorage.setItem('ft-comments', o.mode);
  r.init();
  await r.settle(20);
  // the look, set AFTER the page's own boot (common.js stamps the era attribute at init)
  r.doc.documentElement.setAttribute('data-era-flourish', o.retro ? 'on' : 'off');
  if (o.mine) { // the user posts one through the real form (stored beside the mock personas)
    r.$('#new-comment-text').value = 'my own comment';
    r.$('#post-comment-btn').click();
    await r.settle(4);
  }
  return r;
}
const shown = (r, el) => !!el && r.w.getComputedStyle(el).display !== 'none' && !el.closest('[hidden]');
const visibleItems = (r, sel) => Array.from(r.doc.querySelectorAll('#comments-container ' + sel)).filter((el) => shown(r, el));

test('pure: resolveCommentsMode defaults to both; commentsModeShows is the R1 table', () => {
  assert.strictEqual(W.resolveCommentsMode(null), 'both');
  assert.strictEqual(W.resolveCommentsMode('nope'), 'both');
  assert.deepStrictEqual(W.commentsModeShows('both'), { real: true, fun: true, mine: true, section: true });
  assert.deepStrictEqual(W.commentsModeShows('real'), { real: true, fun: false, mine: true, section: true });
  assert.deepStrictEqual(W.commentsModeShows('fun'), { real: false, fun: true, mine: true, section: true });
  assert.deepStrictEqual(W.commentsModeShows('off'), { real: false, fun: false, mine: false, section: false });
});

test('R6: dates are "~<relative>" from now, never an exact date; the heading says when it was saved', () => {
  const now = Date.UTC(2026, 9, 23);
  assert.strictEqual(W.formatEstimatedAgo(now / 1000 - 2 * 31536000 - 5, now), '~2 years ago');
  assert.strictEqual(W.formatEstimatedAgo(now / 1000 - 3 * 86400, now), '~3 days ago');
  assert.strictEqual(W.formatEstimatedAgo(now / 1000 - 3600, now), '~1 hour ago');
  assert.strictEqual(W.formatEstimatedAgo(undefined, now), '');
  assert.strictEqual(W.sourceCommentsHeading(new Date(now - 3 * 86400e3).toISOString(), now), 'Top comments · saved ~3 days ago');
  assert.ok(!/\d{4}-\d{2}|\b20\d\d\b/.test(W.formatEstimatedAgo(now / 1000 - 400 * 86400, now)), 'never a calendar date');
});

for (const retro of [false, true]) {
  const look = retro ? 'a retro look' : 'Modern';
  for (const mode of ['both', 'real', 'fun', 'off']) {
    test(`R1 matrix: ft-comments=${mode} in ${look}`, async () => {
      const r = await page({ mode, retro, mine: true });
      try {
        const shows = W.commentsModeShows(mode);
        const section = r.doc.querySelector('.comments-section');
        assert.strictEqual(shown(r, section), shows.section, 'the section');
        const realRows = visibleItems(r, '.comment-item--source');
        const funRows = visibleItems(r, '.comment-item.ft-fabricated');
        const mineRows = visibleItems(r, '.comment-item').filter((el) => /my own comment/.test(el.textContent));
        assert.strictEqual(realRows.length, shows.section && shows.real ? SNAP.comments.length : 0, 'the real top comments');
        assert.strictEqual(funRows.length > 0, shows.section && shows.fun && retro, 'fun comments: retro only, never Modern');
        assert.strictEqual(mineRows.length, shows.mine ? 1 : 0, 'the user\'s own comment');
        if (shows.section && shows.real) {
          assert.ok(shown(r, r.doc.querySelector('.source-comments__heading')), 'the heading shows');
          assert.match(r.doc.querySelector('.source-comments__heading').textContent, /^Top comments · saved ~3 days ago$/);
          assert.ok(realRows.every((el) => !el.classList.contains('ft-fabricated')), 'never .ft-fabricated');
        }
      } finally { r.close(); }
    });
  }
}

test('comment text: links are new-tab <a>, times seek the player, authors are plain text, the date is "~"', async () => {
  const r = await page({});
  try {
    const row = Array.from(r.doc.querySelectorAll('.comment-item--source')).find((el) => /Linker/.test(el.textContent));
    const a = row.querySelector('.comment-content a');
    assert.strictEqual(a.getAttribute('href'), 'https://example.com/parts');
    assert.strictEqual(a.getAttribute('target'), '_blank');
    assert.strictEqual(a.getAttribute('rel'), 'noopener noreferrer');
    const chips = row.querySelectorAll('.comment-content button.rich-text__time');
    assert.deepStrictEqual(Array.from(chips).map((c) => c.textContent), ['2:15'], '1:02:33 is past the 600 s video');
    chips[0].click();
    assert.deepStrictEqual(r.seeks, [135]);
    assert.strictEqual(row.querySelector('.comment-author-meta a'), null, 'the author is not a link');
    assert.strictEqual(row.querySelector('.comment-author-name').textContent, '@Linker');
    assert.strictEqual(row.querySelector('.comment-time').textContent, '~2 years ago');
    const pinned = Array.from(r.doc.querySelectorAll('.comment-item--source')).filter((el) => el.querySelector('.comment-pinned'));
    assert.strictEqual(pinned.length, 1, 'the pinned comment is marked');
    assert.ok(!r.doc.querySelector('#comments-container').innerHTML.includes('onerror'), 'sanity');
  } finally { r.close(); }
});

test('hostile comment text stays text (no element is created from it)', async () => {
  const hostile = { state: 'ok', fetchedAt: new Date(NOW).toISOString(), comments: [{ id: 'h', text: '<img src=x onerror=alert(1)> javascript:alert(1) <a href="javascript:x">y</a>', author: '<b>bold</b>' }] };
  const r = await page({ snap: hostile, mode: 'real' });
  try {
    const row = r.doc.querySelector('.comment-item--source');
    assert.strictEqual(row.querySelector('img'), null);
    assert.strictEqual(row.querySelector('b'), null);
    assert.strictEqual(row.querySelector('a'), null, 'no link from javascript: or from markup');
    assert.match(row.textContent, /<img src=x onerror=alert\(1\)>/);
  } finally { r.close(); }
});

test('counts: the top comments count in both badges; the empty state yields to them; comments-off at the source says so', async () => {
  const r = await page({ mode: 'both' });
  try {
    assert.strictEqual(r.$('#comment-count-real').textContent, String(SNAP.comments.length), 'Modern badge: the top comments');
    assert.strictEqual(r.doc.querySelector('#comments-container .comments-empty'), null, 'no "be the first" over real comments');
  } finally { r.close(); }
  const off = await page({ snap: { state: 'disabled', fetchedAt: new Date(NOW).toISOString(), comments: [] }, mode: 'real' });
  try {
    assert.match(off.doc.querySelector('[data-source-comments="disabled"]').textContent, /turned off/);
  } finally { off.close(); }
  const none = await page({ snap: { state: 'none', fetchedAt: null, comments: [] }, mode: 'real' });
  try {
    assert.strictEqual(none.doc.querySelector('.source-comments'), null, 'no snapshot (or a restricted account): no block at all');
    assert.ok(none.doc.querySelector('#comments-container .comments-empty'), 'the empty state shows');
  } finally { none.close(); }
});
