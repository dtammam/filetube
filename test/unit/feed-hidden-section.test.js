'use strict';

// [UNIT] v1.97.1 - the "Hidden" settings-page section's pure row builder
// (setup.js buildFeedHiddenRowHtml). The feed-hide RESTORE surface moved from
// the account-menu modal (which could not scroll) to a section beside Trash, so
// a long hidden list is reachable. Same escaping / no-inline-style contract the
// trash rows hold. Also asserts the account menu no longer carries the row.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildFeedHiddenRowHtml } = require('../../public/js/setup.js');

test('buildFeedHiddenRowHtml: escapes hostile titles, carries data-id + thumbnail + Restore, no inline style', () => {
  const html = buildFeedHiddenRowHtml({
    id: 'vid42', title: '<img src=x onerror=alert(1)>', channelName: 'Chan & <b>Co</b>',
  });
  assert.ok(!html.includes('<img src=x'), 'title escaped');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('data-id="vid42"'));
  assert.ok(html.includes('/thumbnail/vid42'), 'the item thumbnail renders');
  assert.ok(html.includes('feedhidden-restore-btn'), 'a Restore button is present');
  assert.ok(!html.includes('purge'), 'no Purge - hiding never deletes, restore is the only verb');
  assert.ok(html.includes('Chan &amp; &lt;b&gt;Co&lt;/b&gt;'), 'the channel meta is escaped too');
  assert.ok(!/style\s*=/.test(html), 'no inline style attribute (ratchet posture)');
});

test('buildFeedHiddenRowHtml: v1.114 A2 strips a leading "@" (handle-as-name -> name; this section was an un-swept surface)', () => {
  const html = buildFeedHiddenRowHtml({ id: 'x', title: 'V', channelName: '@Apple' });
  assert.ok(html.includes('Apple') && !html.includes('@Apple'), 'renders "Apple", not "@Apple"');
});

test('buildFeedHiddenRowHtml: a missing title falls back, and no channel omits the meta line', () => {
  const html = buildFeedHiddenRowHtml({ id: 'v', title: '', channelName: '' });
  assert.ok(html.includes('Untitled'), 'empty title -> Untitled');
  assert.ok(!html.includes('feed-hidden-meta'), 'no channel -> no meta div (never an empty bullet line)');
});

test('setup.html carries the Hidden section beside Trash; setup.js renders + wires it', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../../public/js/setup.js'), 'utf8');
  assert.match(html, /data-collapse-key="feedhidden"/, 'a collapsible Hidden section exists');
  assert.match(html, /id="feedhidden-list"/, 'the list host is present');
  assert.match(html, /<summary>Hidden<\/summary>/, 'the section header is just "Hidden" (Dean: shorter than "Hidden from feed")');
  // Ordered after Trash (the settings-page section it mirrors and sits beside).
  assert.ok(html.indexOf('id="trash-list"') < html.indexOf('id="feedhidden-list"'), 'Hidden follows Trash');
  assert.match(js, /renderFeedHiddenSection\(controller\.signal\)/, 'the section is rendered on setup init');
  assert.match(js, /fetch\('\/api\/feed-hidden\/' \+ encodeURIComponent\(id\), \{ method: 'DELETE' \}\)/, 'Restore un-hides via DELETE');
});

test('the account menu no longer carries a feed-hidden row or the old modal opener', () => {
  const common = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  assert.ok(!/openFeedHiddenPanel/.test(common), 'the account-menu modal opener is gone (moved to the settings section)');
  assert.ok(!/'Hidden from feed'/.test(common), 'no "Hidden from feed" account-menu row remains');
});
