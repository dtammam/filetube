'use strict';

// [UNIT] UI professionalism pass step 4, AC7 (app-contained): the CSS half of the
// native-interaction policy (plan D6, Dean's ruling LOCKED 2026-09-27).
//
// Pinned here, comments stripped (a lock satisfied by prose is the v1.50.3 class):
// - the base rules open ui.css, with each declaration;
// - the field re-enable is the LAST user-select rule across tokens.css -> ui.css ->
//   style.css (the shells' order), because iOS WebKit loses the caret and the paste menu
//   in an input whose ancestor is user-select:none unless the field's own rule wins;
// - no other user-select / -webkit-touch-callout / -webkit-tap-highlight-color
//   declaration exists in the three sheets or in the app's JS/markup, except the listed
//   ones (ALLOWED below);
// - the `.ui-selectable` opt-in is used exactly at its two listed sites;
// - every shell's viewport meta locks zoom, except read.html (the reader keeps pinch
//   zoom) and diag.html (a standalone diagnostics page, not an app shell).
// What jsdom cannot see - the computed cascade in a real engine - is the Playwright
// check test/geometry/native-interaction.check.js; the loupe itself is Dean's device pass.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { cssRules, readTokensCss, readUiCss, readStyleCss } = require('../helpers/stylesheets');
const { VIEWPORT_ZOOM_LOCKED, VIEWPORT_ZOOM_FREE } = require('../../public/js/common.js');

const ROOT = path.join(__dirname, '..', '..');
const SHEETS = [['tokens.css', readTokensCss()], ['ui.css', readUiCss()], ['style.css', readStyleCss()]];
// Every rule of the three sheets in cascade order, tagged with its file.
const ALL = SHEETS.flatMap(([file, css]) => cssRules(css).map((r) => ({ ...r, file })));
const norm = (sel) => sel.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
function decls(body) {
  return body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    return [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()];
  });
}
const POLICY_PROPS = ['user-select', '-webkit-user-select', '-webkit-touch-callout', '-webkit-tap-highlight-color'];
const SELECT_PROPS = ['user-select', '-webkit-user-select'];

const FIELD_SEL = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
const SELECTABLE_SEL = '.ui-selectable';
// The only rules allowed to declare a policy property: the base, the listed opt-in, the fields.
const ALLOWED = {
  'ui.css|body': [['-webkit-user-select', 'none'], ['user-select', 'none'], ['-webkit-touch-callout', 'none'], ['-webkit-tap-highlight-color', 'transparent']],
  [`ui.css|${SELECTABLE_SEL}`]: [['-webkit-user-select', 'text'], ['user-select', 'text'], ['-webkit-touch-callout', 'default']],
  [`ui.css|${FIELD_SEL}`]: [['-webkit-user-select', 'text'], ['user-select', 'text'], ['-webkit-touch-callout', 'default']],
};

const uiRules = ALL.filter((r) => r.file === 'ui.css');
const findUi = (sel) => uiRules.find((r) => r.at === '' && norm(r.sel) === sel);

test('the parser sees all three sheets (guards the census below against going vacuous)', () => {
  for (const [file, css] of SHEETS) assert.ok(cssRules(css).length > 5, `${file} parsed`);
  // A parse floor: the sweeps shrink style.css (1974 rules after S9); a broken parse finds a handful.
  assert.ok(ALL.filter((r) => r.file === 'style.css').length > 1000);
});

test('the D6 base opens ui.css: html, body, then img/a/video/svg, each with its declarations', () => {
  assert.strictEqual(norm(uiRules[0].sel), 'html');
  assert.deepStrictEqual(decls(uiRules[0].body), [['-webkit-text-size-adjust', '100%'], ['text-size-adjust', '100%']]);
  assert.strictEqual(norm(uiRules[1].sel), 'body');
  assert.deepStrictEqual(decls(uiRules[1].body), [
    ['-webkit-user-select', 'none'], ['user-select', 'none'], ['-webkit-touch-callout', 'none'],
    ['-webkit-tap-highlight-color', 'transparent'], ['touch-action', 'manipulation'],
  ]);
  assert.strictEqual(norm(uiRules[2].sel), 'img, a, video, svg');
  assert.deepStrictEqual(decls(uiRules[2].body), [['-webkit-user-drag', 'none'], ['user-drag', 'none']]);
  for (const r of uiRules.slice(0, 3)) assert.strictEqual(r.at, '', `${r.sel} is unconditional (no @media)`);
});

test('the field re-enable exists and is the LAST user-select rule across tokens.css -> ui.css -> style.css', () => {
  const field = findUi(FIELD_SEL);
  assert.ok(field, 'the field rule exists');
  assert.deepStrictEqual(decls(field.body), ALLOWED[`ui.css|${FIELD_SEL}`]);
  const selectRules = ALL.filter((r) => decls(r.body).some(([p]) => SELECT_PROPS.includes(p)));
  const last = selectRules[selectRules.length - 1];
  assert.strictEqual(`${last.file}|${norm(last.sel)}`, `ui.css|${FIELD_SEL}`,
    `the last user-select rule in cascade order is ${last.file} "${last.sel}"`);
});

test('the .ui-selectable opt-in exists before the field rule and re-enables text', () => {
  const sel = findUi(SELECTABLE_SEL);
  assert.ok(sel, 'the .ui-selectable rule exists');
  assert.deepStrictEqual(decls(sel.body), ALLOWED[`ui.css|${SELECTABLE_SEL}`]);
  assert.ok(sel.index < findUi(FIELD_SEL).index, '.ui-selectable precedes the field rule');
});

test('census: no user-select / touch-callout / tap-highlight declaration outside the listed rules, none !important', () => {
  const seen = {};
  const stray = [];
  for (const r of ALL) {
    const own = decls(r.body).filter(([p]) => POLICY_PROPS.includes(p));
    if (!own.length) continue;
    const key = `${r.file}|${norm(r.sel)}`;
    if (!ALLOWED[key] || r.at !== '') { stray.push(`${key}${r.at ? ' @ ' + r.at : ''}: ${own.map((d) => d.join(':')).join('; ')}`); continue; }
    seen[key] = (seen[key] || []).concat(own);
  }
  assert.deepStrictEqual(stray, [], 'unlisted policy declarations');
  for (const [key, want] of Object.entries(ALLOWED)) {
    assert.deepStrictEqual(seen[key], want.filter(([p]) => POLICY_PROPS.includes(p)), `${key} carries exactly its listed declarations`);
  }
});

// The app's own markup and scripts must not set the policy properties inline either.
function appSources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['vendor', 'fonts', 'icons', 'assets'].includes(e.name)) walk(p); } else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'public'));
  walk(path.join(ROOT, 'lib', 'ytdlp', 'views'));
  return out;
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');

test('census: no inline user-select / touch-callout / tap-highlight in the app JS or markup (diag.html listed)', () => {
  const files = appSources();
  assert.ok(files.length > 30, `sources scanned: ${files.length}`);
  const hits = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    if (rel === path.join('public', 'diag.html')) continue; // standalone diagnostics page, its own inline sheet
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    if (/user-?select|userSelect|touch-?callout|touchCallout|tap-?highlight|tapHighlight/i.test(src)) hits.push(rel);
  }
  assert.deepStrictEqual(hits, []);
});

test('the .ui-selectable allow-list is exactly {the ?debugLifecycle=1 overlay, the reader page}', () => {
  const hits = [];
  for (const f of appSources()) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    const n = (src.match(/ui-selectable/g) || []).length;
    if (n) hits.push(`${path.relative(ROOT, f)}:${n}`);
  }
  assert.deepStrictEqual(hits.sort(), [path.join('public', 'js', 'player.js') + ':1', path.join('public', 'read.html') + ':1'].sort());
  const player = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  const fn = player.slice(player.indexOf('function ensureLifecycleOverlayEl()'), player.indexOf('function renderLifecycleOverlay()'));
  assert.match(fn, /el\.id = 'ft-lifecycle-overlay';[\s\S]*el\.className = 'ui-selectable';/, 'the lifecycle overlay element carries the class');
  const read = new JSDOM(fs.readFileSync(path.join(ROOT, 'public', 'read.html'), 'utf8')).window.document;
  assert.ok(read.querySelector('#reader-pane').classList.contains('ui-selectable'), 'the reader page (#reader-pane) carries the class');
  assert.ok(read.querySelector('#view-root').contains(read.querySelector('#reader-pane')), 'inside #view-root, so it survives the SPA swap');
});

test('viewport metas: every shell locks zoom (maximum-scale=1, user-scalable=no); read.html keeps pinch zoom', () => {
  const shells = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join('public', f))
    .concat([path.join('lib', 'ytdlp', 'views', 'subscriptions.html')]);
  const EXCEPT = { [path.join('public', 'read.html')]: VIEWPORT_ZOOM_FREE, [path.join('public', 'diag.html')]: null };
  assert.ok(shells.length >= 14, `shells: ${shells.length}`);
  let locked = 0;
  for (const rel of shells) {
    const doc = new JSDOM(fs.readFileSync(path.join(ROOT, rel), 'utf8')).window.document;
    const metas = doc.querySelectorAll('meta[name="viewport"]');
    assert.strictEqual(metas.length, 1, `${rel}: one viewport meta`);
    const content = metas[0].getAttribute('content');
    if (rel in EXCEPT) {
      if (EXCEPT[rel] !== null) assert.strictEqual(content, EXCEPT[rel], `${rel} keeps zoom`);
      continue;
    }
    assert.strictEqual(content, VIEWPORT_ZOOM_LOCKED, `${rel}: the locked viewport (the same string applyZoomPolicy writes)`);
    locked++;
  }
  assert.ok(locked >= 13, `locked shells: ${locked}`);
  assert.match(VIEWPORT_ZOOM_LOCKED, /maximum-scale=1(\.0)?\b/);
  assert.match(VIEWPORT_ZOOM_LOCKED, /user-scalable=no/);
  assert.doesNotMatch(VIEWPORT_ZOOM_FREE, /user-scalable|maximum-scale/);
});
