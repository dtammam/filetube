'use strict';

// [UNIT] v1.377.0 (W3, Dean's ruling R3: "I don't want to use the term iPod in the app"): the word "iPod" leaves
// every string a person can read. The census reads what a user can see, never comments:
//   - every HTML shell (public/*.html and lib/**/*.html): the text nodes (script and style bodies aside) and the
//     attributes that reach a person (title, aria-label, alt, placeholder, value, content, label, aria-description,
//     aria-placeholder, aria-roledescription), parsed by jsdom, so a comment can neither hide nor trip it;
//   - every string and template literal (espree's tokens: comments are never tokens) in public/js (vendor aside),
//     lib/, server.js and each shell's inline scripts: a literal is TEXT when it spells the word with a capital
//     (iPod, IPod, Ipod, IPOD - any context, so "iPod-dense" counts) or carries the lowercase word on its own in a
//     literal with a space. Identifiers stay (R3): a bare id ('ipod', 'ipod-original'), a class ('mms-ipod',
//     '.ipod-brick'), an ffmpeg muxer name.
//   - (gate r1) the top-level scripts in public/ (the service worker's notification text) and the PWA manifest's strings.
// ALLOW lists the only sanctioned survivors, each with its reason. Skin names never carried the word (Classic 4G...).
// Known blind spots (gate r1, disclosed): a word split across literals ('i' + 'Pod'), String.fromCharCode and CSS
// `content:` strings are not seen; none of them holds the word today (grep).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const espree = require('espree');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');

// file -> exact literal source (as tokenised) -> why it is not app wording
const ALLOW = {
  'public/js/common.js': {
    "'iPod'": 'the device-name detector (deviceLabelFromUa): a real iPod touch names ITSELF "iPod" in "Listening on <device>", the user\'s own device, not the app',
  },
};

const VISIBLE_ATTRS = ['title', 'aria-label', 'alt', 'placeholder', 'value', 'content', 'label', 'aria-description', 'aria-placeholder', 'aria-roledescription'];

function isTextLiteral(lit) {
  if (/iPod|IPod|Ipod|IPOD/.test(lit)) return true;
  return /\s/.test(lit) && /(^|[^\w.#-])ipod(?![\w-])/i.test(lit);
}

function walk(dir, ext, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

// Every string/template literal of a script, with its line. sourceType script first, module as the fallback.
function literals(src) {
  let toks;
  try { toks = espree.tokenize(src, { ecmaVersion: 'latest', sourceType: 'script', loc: true }); } catch (_) {
    toks = espree.tokenize(src, { ecmaVersion: 'latest', sourceType: 'module', loc: true });
  }
  return toks.filter((t) => t.type === 'String' || t.type === 'Template').map((t) => ({ value: t.value, line: t.loc.start.line }));
}

function scanScript(file, src, lineOffset, hits, seen) {
  for (const l of literals(src)) {
    if (!isTextLiteral(l.value)) continue;
    const why = ALLOW[file] && ALLOW[file][l.value];
    if (why) { seen.add(file + ' ' + l.value); continue; }
    hits.push(`${file}:${l.line + lineOffset}: ${l.value.slice(0, 140)}`);
  }
}

function scanHtml(file, html, hits, seen) {
  const doc = new JSDOM(html).window.document;
  const tw = doc.createTreeWalker(doc, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const host = n.parentElement && n.parentElement.closest('script, style, template');
    if (host && host.tagName !== 'TEMPLATE') continue;
    if (/ipod/i.test(n.data)) hits.push(`${file}: text "${n.data.trim().slice(0, 120)}"`);
  }
  // <template> content is a separate fragment: walk it too (a player template is visible once stamped).
  for (const tpl of doc.querySelectorAll('template')) {
    const frag = tpl.content;
    const tw2 = doc.createTreeWalker(frag, 4);
    for (let n = tw2.nextNode(); n; n = tw2.nextNode()) if (/ipod/i.test(n.data)) hits.push(`${file}: template text "${n.data.trim().slice(0, 120)}"`);
    for (const el of frag.querySelectorAll('*')) for (const a of VISIBLE_ATTRS) if (el.hasAttribute(a) && /ipod/i.test(el.getAttribute(a))) hits.push(`${file}: template ${el.tagName.toLowerCase()}[${a}="${el.getAttribute(a)}"]`);
  }
  for (const el of doc.querySelectorAll('*')) {
    for (const a of VISIBLE_ATTRS) {
      if (el.hasAttribute(a) && /ipod/i.test(el.getAttribute(a))) hits.push(`${file}: ${el.tagName.toLowerCase()}[${a}="${el.getAttribute(a)}"]`);
    }
  }
  for (const s of doc.querySelectorAll('script:not([src])')) {
    const type = (s.getAttribute('type') || '').toLowerCase();
    if (type && !/javascript|module/.test(type)) continue; // JSON / templates are data
    scanScript(file + ' <script>', s.textContent, 0, hits, seen);
  }
  return doc;
}

function census() {
  const html = [
    ...fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, 'public', f)),
    ...walk(path.join(ROOT, 'lib'), '.html', []),
  ];
  const topJs = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'public', f));
  const js = [...walk(path.join(ROOT, 'public', 'js'), '.js', []), ...topJs, ...walk(path.join(ROOT, 'lib'), '.js', []), path.join(ROOT, 'server.js')];
  const hits = [];
  const seen = new Set();
  const docs = {};
  for (const f of html) docs[rel(f)] = scanHtml(rel(f), fs.readFileSync(f, 'utf8'), hits, seen);
  for (const f of js) scanScript(rel(f), fs.readFileSync(f, 'utf8'), 0, hits, seen);
  const manifests = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => /\.webmanifest$|^manifest\.json$/.test(f));
  const strings = (v, out) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; };
  for (const m of manifests) for (const v of strings(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', m), 'utf8')), [])) if (/ipod/i.test(v)) hits.push(`public/${m}: "${v}"`);
  return { hits, seen, docs, counts: { html: html.length, js: js.length, topJs: topJs.length, manifests: manifests.length } };
}

test('W3: no user-visible "iPod" in any shell or script (comments never count; identifiers stay)', () => {
  const { hits, counts } = census();
  assert.ok(counts.html >= 15, `precondition: the census reads every shell (${counts.html})`);
  assert.ok(counts.js >= 100, `precondition: the census reads the scripts (${counts.js})`);
  assert.ok(counts.topJs >= 1 && counts.manifests >= 1, `precondition: the service worker and the manifest are read (${counts.topJs} scripts, ${counts.manifests} manifests)`);
  assert.deepStrictEqual(hits, [], 'user-visible "iPod" left behind - say Pocket');
});

test('W3: the census is not vacuous - each file class reaches its witness', () => {
  const { seen, docs } = census();
  // JS class: the one allowed literal is SEEN (the tokenizer reached common.js's strings).
  for (const [file, lits] of Object.entries(ALLOW)) for (const lit of Object.keys(lits)) assert.ok(seen.has(file + ' ' + lit), `the allowed ${lit} in ${file} was never reached - stale ALLOW entry or a blind scan`);
  // HTML class: the scan parsed the Music page's button, and it says Pocket in all three places.
  const btn = docs['public/music.html'].getElementById('music-pocket-btn');
  assert.ok(btn, 'the Music page Pocket button is in the parsed shell');
  assert.strictEqual(btn.querySelector('.ui-btn__label').textContent, 'Pocket');
  assert.strictEqual(btn.getAttribute('title'), 'Open Pocket');
  assert.strictEqual(btn.getAttribute('aria-label'), 'Open Pocket');
  const upright = docs['public/setup.html'].querySelector('label[for="pocket-upright-check"]');
  assert.strictEqual(upright && upright.textContent, 'Keep Pocket upright');
});

test('W3: the detector trips on every spelling a person can read, and spares identifiers and comments', () => {
  // HTML: label text, a title, an aria-label, template text - each a separate witness.
  for (const html of [
    '<button><span>iPod</span></button>',
    '<button title="Open the iPod"></button>',
    '<a aria-label="ipod menu"></a>',
    '<template><p>the iPod lays itself out</p></template>',
    '<script>el.textContent = "Open the iPod";</script>',
  ]) {
    const hits = []; scanHtml('witness.html', '<!doctype html><body>' + html + '</body>', hits, new Set());
    assert.strictEqual(hits.length, 1, 'one hit for ' + html + ' (' + hits.join(' | ') + ')');
  }
  for (const html of ['<div class="mms-ipod" id="ipod-brick" data-skin="ipod"></div>', '<!-- the iPod portrait lock -->']) {
    const hits = []; scanHtml('witness.html', '<!doctype html><body>' + html + '</body>', hits, new Set());
    assert.deepStrictEqual(hits, [], 'no hit for ' + html);
  }
  // JS: a capitalised spelling anywhere in a literal, the lowercase word in a sentence; never an identifier or a comment.
  const js = (src) => { const hits = []; scanScript('w.js', src, 0, hits, new Set()); return hits.length; };
  assert.strictEqual(js("btn.title = 'Open the iPod';"), 1);
  assert.strictEqual(js('toast(`Fine is iPod-dense`);'), 1);
  assert.strictEqual(js("label: 'open the ipod'"), 1);
  assert.strictEqual(js("x = 'IPOD';"), 1);
  assert.strictEqual(js("var id = 'ipod'; var k = 'ipod-original'; q('.mms-ipod .ip-np'); args.push('-f', 'ipod');"), 0);
  assert.strictEqual(js("// Open the iPod\n/* the iPod */ var a = 1;"), 0);
});
