'use strict';

// [UNIT] Settings > Comments > Show comments on TV shows (synced pref ft-tv-comments). The gate is
// watch.js commentsShownForItem(isTv, stored): a TV episode (?tv=) hides its comments only when the
// pref is 'off'; every other item keeps them whatever the pref says. The gate's caller (initTvWatch)
// is checked for wiring: the gate must sit in front of loadComments() on the TV path.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../../public/js/watch.js');

const REPO = path.join(__dirname, '..', '..');
const WATCH_SRC = fs.readFileSync(path.join(REPO, 'public/js/watch.js'), 'utf8');
const SETUP_HTML = fs.readFileSync(path.join(REPO, 'public/setup.html'), 'utf8');

test('TV episode + off: the comments are hidden', () => {
  assert.strictEqual(W.commentsShownForItem(true, 'off'), false);
});

test('TV episode + on: the comments show', () => {
  assert.strictEqual(W.commentsShownForItem(true, 'on'), true);
});

test('TV episode + nothing stored: the comments show (default on)', () => {
  assert.strictEqual(W.commentsShownForItem(true, null), true);
});

test('non-TV item + off: the comments still show (videos and other media keep comments)', () => {
  assert.strictEqual(W.commentsShownForItem(false, 'off'), true);
});

test('non-TV item + on or nothing stored: the comments show', () => {
  assert.strictEqual(W.commentsShownForItem(false, 'on'), true);
  assert.strictEqual(W.commentsShownForItem(false, null), true);
});

test('wiring: initTvWatch consults the gate before loadComments() and the posting form', () => {
  const start = WATCH_SRC.indexOf('async function initTvWatch(');
  assert.ok(start > -1, 'initTvWatch exists');
  const body = WATCH_SRC.slice(start);
  const gate = body.indexOf('commentsShownForItem(true, storedTvComments)');
  const load = body.indexOf('loadComments();');
  assert.ok(gate > -1, 'initTvWatch calls the gate with isTv=true and the stored pref');
  assert.ok(load > gate, 'the gate sits before loadComments()');
  assert.ok(body.indexOf('wireCommentForm();') > gate, 'the gate sits before wireCommentForm()');
  assert.ok(body.indexOf("localStorage.getItem('ft-tv-comments')") > -1, 'the gate reads the synced pref key');
});

test('Settings: the switch exists, is a ui-switch, and sits in the Comments group', () => {
  const m = SETUP_HTML.match(/<input type="checkbox" role="switch" class="ui-switch" id="tv-comments-check" \/>/);
  assert.ok(m, '#tv-comments-check is a role=switch checkbox');
  const group = SETUP_HTML.slice(SETUP_HTML.lastIndexOf('<h3 class="setup-heading">Comments</h3>', m.index), m.index);
  assert.ok(group.includes('comments-mode-select'), 'it sits under the Comments heading');
});

test('TV episode panel clears the views-count skeleton (an episode has no view count, the bar never filled)', () => {
  const start = WATCH_SRC.indexOf('function paintTvEpisodePanel(');
  const end = WATCH_SRC.indexOf('\n    function ', start + 10);
  assert.ok(start > 0 && end > start, 'paintTvEpisodePanel found');
  const body = WATCH_SRC.slice(start, end);
  assert.match(body, /viewsCount\.classList\.remove\('skeleton-shimmer'/);
  assert.match(body, /viewsCount\.hidden = true/);
});

test('wiring: the off branch of initTvWatch hides the whole comments section (form and header too)', () => {
  const start = WATCH_SRC.indexOf('async function initTvWatch(');
  const body = WATCH_SRC.slice(start);
  const gate = body.indexOf('commentsShownForItem(');
  assert.ok(gate > 0, 'gate found');
  assert.match(body.slice(gate, gate + 700), /else if \(commentsSection\) \{\s*commentsSection\.hidden = true/);
});

test('wiring: the Settings switch starts on unless stored off, and writes on/off back to ft-tv-comments', () => {
  const src = fs.readFileSync(path.join(REPO, 'public/js/setup.js'), 'utf8');
  const start = src.indexOf('function wireTvCommentsControl(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /check\.checked = stored !== 'off'/);
  assert.match(body, /setItem\('ft-tv-comments', check\.checked \? 'on' : 'off'\)/);
});
