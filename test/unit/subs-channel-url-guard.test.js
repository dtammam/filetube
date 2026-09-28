'use strict';

// Gate r1 (security-brief 2): a subscription's channelUrl reaches two client sinks on the
// Subscriptions page - the settings sheet's link (.href) and the row menu's "Open channel
// page" (window.open). The server validates it at add time and on a backup restore; the
// client refuses anything that is not an http(s) URL before either sink (subsSafeChannelHref).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const S = require('../../lib/ytdlp/client/subscriptions.js');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'client', 'subscriptions.js'), 'utf8');
const newDoc = () => new JSDOM('<!doctype html><body></body>').window.document;
const HOSTILE = ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.example/x', '', null, undefined, 42, {}];

test('subsSafeChannelHref passes an http(s) URL through and refuses everything else', () => {
  assert.strictEqual(S.subsSafeChannelHref('https://www.youtube.com/@a'), 'https://www.youtube.com/@a');
  assert.strictEqual(S.subsSafeChannelHref('http://youtube.com/@a'), 'http://youtube.com/@a');
  assert.strictEqual(S.subsSafeChannelHref('HTTPS://youtube.com/@a'), 'HTTPS://youtube.com/@a');
  for (const bad of HOSTILE) assert.strictEqual(S.subsSafeChannelHref(bad), null, String(bad));
});

test('the row menu offers "Open channel page" only for an http(s) channelUrl', () => {
  const labels = (url) => S.buildRowMenuItems({ id: 'a', name: 'A', channelUrl: url, lastStatus: 'ok' }, undefined, {}).map((i) => i.label);
  assert.ok(labels('https://www.youtube.com/@a').includes('Open channel page'));
  for (const bad of HOSTILE) assert.ok(!labels(bad).includes('Open channel page'), String(bad));
});

test('the settings sheet renders the channel link only for an http(s) channelUrl', () => {
  const linkFor = (url) => {
    const d = newDoc();
    const el = S.buildSettingsSheet({ id: 's', name: 'A', addedAt: '2026-09-01T00:00:00.000Z', channelUrl: url }, d, {}, undefined);
    return el.querySelector('a.subs-sheet-link');
  };
  assert.strictEqual(linkFor('https://www.youtube.com/@a').getAttribute('href'), 'https://www.youtube.com/@a');
  for (const bad of HOSTILE) assert.strictEqual(linkFor(bad), null, String(bad));
});

test('the window.open sink goes through the gate (source lock: the handler is not exported)', () => {
  const opens = SRC.match(/window\.open\([^)]*\)/g) || [];
  assert.deepStrictEqual(opens, ["window.open(href, '_blank', 'noopener,noreferrer')"], 'the one window.open opens the gated href');
  assert.match(SRC, /onOpenChannel: \(s\) => \{ const href = subsSafeChannelHref\(s\.channelUrl\); if \(href\) window\.open\(href,/);
  assert.ok(!/\.href = sub\.channelUrl/.test(SRC), 'no ungated href write');
});
