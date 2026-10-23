'use strict';

// [UNIT] v1.394.0 W1: the shared rich-text renderer (public/js/rich-text.js) - untrusted text
// (a video's description, a saved comment) becomes text nodes, http(s) links in a new tab and
// seek chips, never markup. Driven through the pure tokenizer, the real DOM render (jsdom),
// the shell census (every shell that loads watch.js loads it first) and the REAL watch view
// (test/helpers/watch-view-harness.js: a description link opens a new tab, a chip seeks).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const RT = require('../../public/js/rich-text.js');
const { watchViewRealm, VIDEO } = require('../helpers/watch-view-harness');

const REPO = path.join(__dirname, '..', '..');
const kinds = (segs) => segs.map((s) => s.type + ':' + (s.type === 'link' ? s.href : s.type === 'time' ? s.sec : s.text));
const links = (text, o) => RT.tokenize(text, o).filter((s) => s.type === 'link').map((s) => s.href);
const times = (text, dur) => RT.tokenize(text, { duration: dur }).filter((s) => s.type === 'time').map((s) => s.sec);

// ---- links --------------------------------------------------------------------------------

test('links: http and https runs become links; the rest stays text, in order', () => {
  assert.deepStrictEqual(kinds(RT.tokenize('see https://example.com/a?b=1 and http://x.org now')), [
    'text:see ', 'link:https://example.com/a?b=1', 'text: and ', 'link:http://x.org/', 'text: now',
  ]);
});

test('links: every non-http(s) scheme stays plain text (javascript:, data:, vbscript:, file:, ftp:, mixed case)', () => {
  for (const s of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
    'file:///etc/passwd', 'ftp://example.com/x', ' javascript://example.com/%0aalert(1)', 'blob:https://example.com/x',
  ]) {
    assert.deepStrictEqual(links(s), [], s);
    assert.strictEqual(RT.tokenize(s).map((x) => x.text).join(''), s, 'the text survives verbatim: ' + s);
  }
});

test('links: https with javascript: inside is never a javascript link (the parser decides, its own serialization is the href)', () => {
  assert.deepStrictEqual(links('https://javascript:alert(1)'), [], 'unparseable host:port -> text');
  const l = links('https://example.com/javascript:alert(1)');
  assert.deepStrictEqual(l, ['https://example.com/javascript:alert(1)']);
  assert.ok(l.every((h) => /^https?:\/\//.test(h)));
});

test('links: mixed-case scheme is accepted and serialized lower-case; a word-glued scheme is not a link start', () => {
  assert.deepStrictEqual(links('HTTPS://Example.COM/X'), ['https://example.com/X']);
  assert.deepStrictEqual(links('xhttps://example.com'), []);
});

test('links: unicode lookalikes never form a scheme (long s, Kelvin sign, full-width letters)', () => {
  for (const s of ['http\u017f://example.com', 'h\uff54tps://example.com', '\u212a://x', 'https\uff1a//example.com']) assert.deepStrictEqual(links(s), [], s);
});

test('links: HTML in the text stays text (an <img onerror> is never an element)', () => {
  const t = 'hi <img src=x onerror=alert(1)> https://a.com/<b>x</b>';
  const segs = RT.tokenize(t);
  assert.deepStrictEqual(segs.filter((s) => s.type === 'link').map((s) => s.href), ['https://a.com/'], 'a link stops at <');
  const dom = new JSDOM('<div id="d"></div>');
  const d = dom.window.document.getElementById('d');
  d.appendChild(RT.render(t, { doc: dom.window.document }));
  assert.strictEqual(d.querySelector('img'), null);
  assert.strictEqual(d.querySelector('b'), null);
  assert.strictEqual(d.textContent, t);
});

test('links: trailing punctuation is trimmed, balanced parentheses are kept', () => {
  assert.deepStrictEqual(links('go to https://a.com/x.'), ['https://a.com/x']);
  assert.deepStrictEqual(links('(see https://a.com/x)'), ['https://a.com/x']);
  assert.deepStrictEqual(links('https://en.wikipedia.org/wiki/Foo_(bar)'), ['https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepStrictEqual(links('(https://en.wikipedia.org/wiki/Foo_(bar))'), ['https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepStrictEqual(links('"https://a.com/q?x=1",'), ['https://a.com/q?x=1']);
  assert.deepStrictEqual(links('https://a.com!?'), ['https://a.com/']);
  const segs = RT.tokenize('(see https://a.com/x).');
  assert.strictEqual(segs.map((s) => s.type === 'link' ? '[' + s.text + ']' : s.text).join(''), '(see [https://a.com/x]).');
});

test('links: a long link keeps its whole href and shows a shortened text; a link past MAX_HREF stays text', () => {
  const long = 'https://example.com/' + 'a'.repeat(200);
  const seg = RT.tokenize(long).find((s) => s.type === 'link');
  assert.strictEqual(seg.href, long);
  assert.strictEqual(seg.text.length, RT.MAX_LINK_TEXT);
  assert.ok(seg.text.endsWith('\u2026'));
  const huge = 'https://example.com/' + 'a'.repeat(RT.MAX_HREF);
  assert.deepStrictEqual(links(huge), []);
});

test('gate r1 (security NOTE-2): a shortened link never cuts inside its host', () => {
  const host = 'accounts.example.com.' + 'a'.repeat(80) + '.evil.test';
  const seg = RT.tokenize('https://' + host + '/login?x=1').find((x) => x.type === 'link');
  assert.ok(seg.text.startsWith('https://' + host), 'the whole host shows: ' + seg.text.slice(-24));
  assert.ok(seg.text.endsWith('\u2026'), 'the path part is what gets cut');
});

test('safeHref: the protocol check itself (mutating it to accept any scheme turns these red)', () => {
  assert.strictEqual(RT.safeHref('javascript:alert(1)'), null);
  assert.strictEqual(RT.safeHref('data:text/html,x'), null);
  assert.strictEqual(RT.safeHref('vbscript:x'), null);
  // these carry a hostname, so ONLY the protocol check refuses them (the hostname check masks the rest)
  assert.strictEqual(RT.safeHref('javascript://example.com/%0aalert(1)'), null);
  assert.strictEqual(RT.safeHref('ftp://example.com/x'), null);
  assert.strictEqual(RT.safeHref('file://host/etc/passwd'), null);
  assert.strictEqual(RT.safeHref('ws://example.com/'), null);
  assert.strictEqual(RT.safeHref('https://a.com'), 'https://a.com/');
  assert.strictEqual(RT.safeHref('http:///nohost'), 'http://nohost/', 'the WHATWG parser repairs it; still http');
});

// ---- times --------------------------------------------------------------------------------

test('times: m:ss and h:mm:ss within the duration become chips with their seconds', () => {
  assert.deepStrictEqual(times('intro 0:00, part 2:15, end 1:02:33', 4000), [0, 135, 3753]);
});

test('times: a time past the duration is not a chip; no duration means no chips', () => {
  assert.deepStrictEqual(times('at 2:15 and 12:00', 600), [135]);
  assert.deepStrictEqual(times('at 2:15', 0), []);
  assert.deepStrictEqual(times('at 2:15', undefined), []);
  assert.deepStrictEqual(times('at 1:00:01', 3600), [], 'one second past the end');
  assert.deepStrictEqual(times('at 1:00:00', 3600), [3600], 'the last second is in');
});

test('times: "10:00 am" and other clock times are not chips (decided: a time followed by am/pm is a clock)', () => {
  for (const s of ['meet at 10:00 am', 'at 7:30pm', 'at 9:15 a.m.', 'AT 10:00 PM', 'at 10:00AM']) assert.deepStrictEqual(times(s, 99999), [], s);
  assert.deepStrictEqual(times('10:00 amazing', 99999), [600], '"am" must be a whole word');
});

test('times: not glued to digits, letters, colons, dots or slashes; invalid seconds are not times', () => {
  assert.deepStrictEqual(times('v1:23 a1:23 1:2 1:60 12:345 1:02:33:44 2024/1:30 1.2:30 1:30.5', 99999), []);
  assert.deepStrictEqual(times('(1:23) [4:56] -7:08- "9:10"', 99999), [83, 296, 428, 550]);
  assert.deepStrictEqual(times('123:45:00', 999999), [], 'an hour has at most two digits');
  assert.deepStrictEqual(times('123:45', 999999), [7425], 'three-digit minutes are fine');
});

test('times: a time inside a link stays part of the link', () => {
  const segs = RT.tokenize('https://a.com/t=1:23 then 1:23', { duration: 600 });
  assert.deepStrictEqual(kinds(segs), ['link:https://a.com/t=1:23', 'text: then ', 'time:83']);
});

// ---- render (DOM) -------------------------------------------------------------------------

test('render: a link is <a href target=_blank rel="noopener noreferrer">; a chip is a button that calls onSeek', () => {
  const dom = new JSDOM('<div id="d"></div>');
  const doc = dom.window.document;
  const sought = [];
  const d = doc.getElementById('d');
  d.appendChild(RT.render('watch https://a.com/x at 2:15!', { doc, duration: 600, onSeek: (s) => sought.push(s) }));
  const a = d.querySelector('a');
  assert.strictEqual(a.getAttribute('href'), 'https://a.com/x');
  assert.strictEqual(a.getAttribute('target'), '_blank');
  assert.strictEqual(a.getAttribute('rel'), 'noopener noreferrer');
  const b = d.querySelector('button.rich-text__time');
  assert.strictEqual(b.getAttribute('type'), 'button');
  assert.strictEqual(b.textContent, '2:15');
  assert.strictEqual(b.getAttribute('aria-label'), 'Jump to 2:15');
  b.click();
  assert.deepStrictEqual(sought, [135]);
  assert.strictEqual(d.textContent, 'watch https://a.com/x at 2:15!');
  assert.deepStrictEqual(Array.from(d.childNodes).map((n) => n.nodeName), ['#text', 'A', '#text', 'BUTTON', '#text']);
});

test('render: without onSeek there are no chips (a time stays text)', () => {
  const dom = new JSDOM('');
  const frag = RT.render('at 2:15', { doc: dom.window.document, duration: 600 });
  assert.strictEqual(frag.querySelector('button'), null);
});

test('render: no innerHTML anywhere in the module', () => {
  const src = fs.readFileSync(path.join(REPO, 'public/js/rich-text.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src));
});

test('ReDoS: a 100 KB pathological description tokenizes in well under a second', () => {
  const inputs = [
    'https://' + 'a'.repeat(100000),
    'http://a.com/' + ')'.repeat(100000),
    '1:'.repeat(50000),
    '1:11'.repeat(25000),
    'https://a.com/'.repeat(7000),
    ('h' + 'ttp:/').repeat(16000),
    '9:59 am'.repeat(14000),
  ];
  for (const s of inputs) {
    const t0 = process.hrtime.bigint();
    RT.tokenize(s, { duration: 1e9 });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1000, s.slice(0, 20) + '... took ' + ms.toFixed(1) + ' ms');
  }
});

// ---- the shells ---------------------------------------------------------------------------

test('every shell that loads watch.js loads rich-text.js exactly once, immediately before it', () => {
  const dirs = [path.join(REPO, 'public'), path.join(REPO, 'lib/ytdlp/views')];
  let found = 0;
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!html.includes('<script src="/js/watch.js"></script>')) continue;
      found++;
      assert.strictEqual(html.split('<script src="/js/rich-text.js"></script>').length - 1, 1, f + ' loads it once');
      assert.match(html, /<script src="\/js\/rich-text\.js"><\/script>\s*<script src="\/js\/watch\.js"><\/script>/, f);
    }
  }
  assert.ok(found >= 11, 'the census found the shells (' + found + ')');
});

// ---- the real watch view ------------------------------------------------------------------

test('watch view: a description link opens a new tab, a chip seeks the shared player and plays; Copy description copies the RAW text', async () => {
  const long = 'https://example.com/' + 'b'.repeat(120);
  const desc = 'Parts list: https://example.com/parts. Sanding at 2:15, finish at 1:02:33.\n' + long;
  const seeks = [];
  let plays = 0;
  const r = watchViewRealm({ item: { ...VIDEO, duration: 600, tags: { description: desc } }, player: { seek: (s) => seeks.push(s), play: () => { plays++; } } });
  try {
    r.init();
    await r.settle(20);
    const box = r.$('#video-description');
    const a = box.querySelectorAll('a');
    assert.strictEqual(a.length, 2);
    assert.strictEqual(a[0].getAttribute('href'), 'https://example.com/parts');
    assert.strictEqual(a[0].getAttribute('target'), '_blank');
    assert.strictEqual(a[0].getAttribute('rel'), 'noopener noreferrer');
    const chips = box.querySelectorAll('button.rich-text__time');
    assert.deepStrictEqual(Array.from(chips).map((c) => c.textContent), ['2:15'], '1:02:33 is past the 600 s duration');
    chips[0].click();
    assert.deepStrictEqual(seeks, [135]);
    assert.strictEqual(plays, 1);
    // Copy description: the raw text, not the shortened link text
    let copied = null;
    r.w.ui.copy = (t) => { copied = t; };
    r.$('#more-actions-btn').click();
    await r.settle(4);
    const entry = Array.from(r.doc.querySelectorAll('.ui-sheet .ui-row')).find((x) => x.textContent.trim() === 'Copy description');
    assert.ok(entry, 'the More menu offers Copy description');
    entry.click();
    await r.settle(4);
    assert.strictEqual(copied, desc);
  } finally { r.close(); }
});

test('watch view: an empty description renders no nodes (the :empty collapse holds)', async () => {
  const r = watchViewRealm({ item: { ...VIDEO, tags: {} } });
  try {
    r.init();
    await r.settle(20);
    assert.strictEqual(r.$('#video-description').childNodes.length, 0);
  } finally { r.close(); }
});
