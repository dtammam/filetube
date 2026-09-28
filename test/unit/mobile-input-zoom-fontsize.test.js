'use strict';

// [UNIT] v1.25.4 polish (on-device iOS PWA): focusing an <input>/<select>/
// <textarea> whose COMPUTED font-size is under 16px makes iOS Safari
// auto-zoom the page in on focus -- well-known iOS behavior, not something
// the viewport meta tag controls (and `user-scalable=no`/`maximum-scale=1`
// is an accessibility anti-pattern that is NOT used here -- see index.html/
// watch.html/setup.html's shared viewport meta tag, unchanged). The one-off
// download modal's URL/folder text inputs and format/quality/filetype
// selects (shared by common.js's buildOneOffModal AND buildSubscribeModal,
// both reuse `.oneoff-modal-field`/`.oneoff-modal-row select`), the Settings
// (setup.html) form's text/number inputs and selects (`.setup-box
// .setup-select`/`input[type="text"|"number"]`, which also reaches the
// Subscriptions page's own format/quality/filetype selects since its
// "Add a subscription"/one-shot rows share the SAME `.setup-select` class),
// and the per-subscription settings sheet's cutoff-date/max-duration inputs
// and selects (the retired `.sub-sheet-field`; ui-field since UI pass S5) were all 13px -- bumped to 16px, scoped
// to the existing mobile `@media (max-width: 768px)` breakpoint so desktop
// (mouse input, no zoom-on-focus behavior to guard against) keeps its
// compact 13px sizing.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');
// UI pass step 1: the --fs-* scale is defined in tokens.css (loaded before style.css).
const TOKENS_CSS = require('../helpers/stylesheets').readTokensCss();

// v1.30 C1 (AC7.1/AC7.2): style.css's font-size declarations are now
// token-driven (`var(--fs-*)`) rather than bare px literals -- see the
// `:root` block. Parse the token definitions once so these tests can resolve
// `var(--fs-*)` back to a px number and keep asserting the FLOOR VALUE
// (>=16px via --fs-input-min specifically), not a specific source-text
// spelling.
function parseRootFsTokens(source) {
  const rootMatch = /:root\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(rootMatch, 'expected a :root block in tokens.css');
  const tokens = {};
  const re = /(--fs-[a-z0-9-]+):\s*([0-9]+)px/g;
  let m;
  while ((m = re.exec(rootMatch[1]))) {
    tokens[m[1]] = Number(m[2]);
  }
  return tokens;
}

const fsTokens = parseRootFsTokens(TOKENS_CSS);

// Resolves a font-size declaration's VALUE (e.g. "16px" or
// "var(--fs-input-min)") to a numeric px, following the token indirection
// through the parsed :root block.
function resolveFontSizePx(value) {
  const trimmed = value.trim();
  const varMatch = /^var\((--fs-[a-z0-9-]+)\)$/.exec(trimmed);
  if (varMatch) {
    const px = fsTokens[varMatch[1]];
    assert.ok(px !== undefined, `expected token ${varMatch[1]} to be defined in :root`);
    return px;
  }
  const pxMatch = /^([0-9]+)px$/.exec(trimmed);
  assert.ok(pxMatch, `expected a px literal or var(--fs-*) token, got "${value}"`);
  return Number(pxMatch[1]);
}

// This file has several independent `@media (max-width: 768px) { ... }`
// blocks (one per feature area) -- isolate the one containing `marker` by
// brace-depth counting, mirroring the pattern in
// the (retired, UI pass S3) watch-action-bar-nowrap.test.js, rather than a single `[\s\S]*?` regex
// that could span (and falsely match against) unrelated blocks.
function findMobileBlockContaining(marker) {
  const mediaRe = /@media \(max-width: 768px\)\s*\{/g;
  let m;
  while ((m = mediaRe.exec(css))) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    if (body.includes(marker)) return body;
  }
  return null;
}

function assertMobileFontSizeAtLeast16(marker, selectorSource, ruleRe) {
  const block = findMobileBlockContaining(marker);
  assert.ok(block, `expected to find the @media (max-width: 768px) block containing "${marker}"`);
  const rule = ruleRe.exec(block);
  assert.ok(rule, `expected a mobile-scoped rule for ${selectorSource}`);
  const fontMatch = /font-size:\s*([^;]+);/.exec(rule[1]);
  assert.ok(fontMatch, `expected a font-size declaration on ${selectorSource}`);
  const px = resolveFontSizePx(fontMatch[1]);
  assert.ok(px >= 16, `expected ${selectorSource}'s mobile font-size >= 16px to avoid iOS auto-zoom-on-focus (got ${px}px)`);
}

test('one-off download modal: .oneoff-modal-field (URL/folder text inputs) is >=16px on mobile', () => {
  assertMobileFontSizeAtLeast16(
    '.oneoff-modal-field',
    '.oneoff-modal-field, .oneoff-modal-row select',
    /\.oneoff-modal-field,\s*\n\s*\.oneoff-modal-row select\s*\{([^}]*)\}/
  );
});

test('one-off download modal / Subscribe modal: .oneoff-modal-row select (format/quality/filetype) is >=16px on mobile', () => {
  // Same grouped rule as above -- .oneoff-modal-field is reused by BOTH the
  // header one-off download modal AND buildSubscribeModal's cutoff-date
  // input (common.js), and .oneoff-modal-row select is reused by both
  // modals' format/quality/filetype selects, so this single rule covers all
  // of them.
  const block = findMobileBlockContaining('.oneoff-modal-field');
  const rule = /\.oneoff-modal-field,\s*\n\s*\.oneoff-modal-row select\s*\{([^}]*)\}/.exec(block);
  assert.ok(rule, 'expected the grouped .oneoff-modal-field/.oneoff-modal-row select mobile rule');
  assert.match(rule[1], /font-size:\s*var\(--fs-input-min\);/);
  const fontMatch = /font-size:\s*([^;]+);/.exec(rule[1]);
  assert.ok(resolveFontSizePx(fontMatch[1]) >= 16);
});

// Retire R3 (DELIBERATE conversion of the two v1.25.4 `.setup-box .setup-select / input`
// locks): that mobile 16px rule is gone because nothing needs it - the `.setup-select` class is
// rendered nowhere any more (the Subscriptions builders' last default became ui-select__native),
// and every Settings text field is a ui-field input, 16px at EVERY width in ui.css (the census
// below holds that for every classed control). This pins both halves so the old rule's reason
// cannot quietly come back.
test('Settings form: no field wears the retired .setup-select, and every Settings text field is a 16px ui field', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  const strip = (t) => t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  for (const rel of ['public/setup.html', 'public/stats.html', 'public/js/setup.js', 'public/js/stats.js', 'lib/ytdlp/views/subscriptions.html', 'lib/ytdlp/client/subscriptions.js']) {
    assert.doesNotMatch(strip(read(rel)), /setup-select/, `${rel}: no .setup-select field`);
  }
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.setup-select\b/, 'and no rule styles one');
  const setupHtml = read('public/setup.html');
  const viewRoot = setupHtml.slice(setupHtml.indexOf('<div id="view-root"'));
  const fields = [...viewRoot.matchAll(/<input\b([^>]*)>/g)].map((m) => m[1])
    .filter((a) => /\btype="(text|number|password|search|url|email)"/.test(a));
  assert.ok(fields.length >= 5, 'precondition: the Settings text fields are seen (' + fields.length + ')');
  for (const a of fields) assert.match(a, /class="[^"]*\bui-field__input\b/, `a Settings text field is a ui field: <input${a}>`);
  const uiCss = require('../helpers/stylesheets').readUiCss().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(uiCss, /\n\.ui-field__input,\s*\n\.ui-select__native \{[^}]*font:\s*var\(--fw-normal\) var\(--fs-input-min\)/, 'the ui field is 16px at every width');
});

test('per-subscription settings sheet + the Subscriptions forms: ui-field / ui-select fields are 16px at EVERY width (UI pass S5)', () => {
  // UI pass S5 (AC12): the settings sheet and the Add / One-off forms are ui-field /
  // ui-select markup now (ui.js field/select + the view's static fields), and the
  // primitive holds the 16px iOS floor UNCONDITIONALLY (no mobile override to forget).
  // It must be exactly --fs-input-min (16px), in the field rule's font shorthand.
  const uiCss = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /\n\.ui-field__input,\s*\n\.ui-select__native \{([^}]*)\}/.exec(uiCss);
  assert.ok(rule, 'expected the shared .ui-field__input, .ui-select__native rule');
  assert.match(rule[1], /font:\s*var\(--fw-normal\) var\(--fs-input-min\) \/ var\(--lh-tight\) var\(--font-ui\);/);
  const tokens = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'tokens.css'), 'utf8');
  assert.match(tokens, /--fs-input-min:\s*16px;/, 'the floor token is 16px');
  // no later rule in the ui layer shrinks the field font
  assert.doesNotMatch(uiCss.slice(rule.index + rule[0].length), /\.(ui-field__input|ui-select__native)[^{]*\{[^}]*font(-size)?:/,
    'nothing after the base rule re-sizes a ui field');
  // and the Subscriptions view's fields actually ARE ui fields (no bare classed input left)
  const subsHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'), 'utf8');
  const viewRoot = subsHtml.slice(subsHtml.indexOf('<div id="view-root"'), subsHtml.indexOf('</main>'));
  const fields = [...viewRoot.matchAll(/<(input|select)\b([^>]*)>/g)].map((m) => m[2]);
  assert.strictEqual(fields.length, 13, 'the view carries its 13 form fields (search + Add 7 + One-off 5)');
  for (const attrs of fields) {
    assert.match(attrs, /class="(ui-field__input|ui-select__native)"/, `every view field is a ui field: <${attrs}>`);
  }
});

test('header search: .search-input is >=16px on mobile (v1.25.10 -- tapping search no longer auto-zooms on iOS)', () => {
  assertMobileFontSizeAtLeast16(
    '.search-input',
    '.search-input',
    /\.search-input\s*\{([^}]*)\}/
  );
});

test('desktop sizing is unchanged: the base (unscoped) .oneoff-modal-field/.oneoff-modal-row select rules still resolve to 13px', () => {
  const oneOffField = /(?:^|\n)\.oneoff-modal-field\s*\{([^}]*)\}/.exec(css);
  assert.ok(oneOffField);
  assert.strictEqual(resolveFontSizePx(/font-size:\s*([^;]+);/.exec(oneOffField[1])[1]), 13);

  const oneOffSelect = /(?:^|\n)\.oneoff-modal-row select\s*\{([^}]*)\}/.exec(css);
  assert.ok(oneOffSelect);
  assert.strictEqual(resolveFontSizePx(/font-size:\s*([^;]+);/.exec(oneOffSelect[1])[1]), 13);

  // (retire R3: the third member, .setup-select, is retired - see the Settings form test above)
});

// ---- census: every CLASSED text-entry control in the shells ------------------
// Gate r1 (lock-audio-measure, qa W2): the tests above are a hand-picked list of
// surfaces, so a NEW control whose class sets a small font-size never enters it -
// the timing log's fallback <textarea class="bg-timing-log-text"> shipped at 10px
// on mobile, because a class selector outranks the v1.26.2 bare-element floor
// (`input, select, textarea` in the max-width: 768px block). This census closes
// that hole for every classed <input>/<select>/<textarea> in public/*.html: a
// class that an unconditional rule sizes under 16px must be lifted back to
// >=16px by a rule inside the mobile block. Rules are walked with their @media
// context (comments stripped first).
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
function cssRulesWithMedia(source) {
  const rules = [];
  (function walk(src, media) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, media.concat(head));
      else if (!head.startsWith('@')) rules.push({ selectors: head.split(';').pop().split(',').map((x) => x.trim()), body, media });
      i = j;
    }
  })(source.replace(/\/\*[\s\S]*?\*\//g, ''), []);
  return rules;
}
// Sweep S8 (the v1.25.4 risky conversion): Settings' fields moved onto the ui-field
// primitive, styled in ui.css with the `font:` shorthand, and several of them are built by
// setup.js templates. The census now reads BOTH stylesheets, resolves a size from `font:` as
// well as `font-size:`, and scans the Settings builder's markup too - so a ui-field (16px)
// and a JS-built field enter it like any shell control.
function classedEntryControls() {
  const out = [];
  const sources = fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html')).map((f) => path.join(PUBLIC_DIR, f))
    .concat([path.join(PUBLIC_DIR, 'js', 'setup.js')]);
  for (const fileAbs of sources) {
    const file = path.relative(PUBLIC_DIR, fileAbs);
    const html = fs.readFileSync(fileAbs, 'utf8');
    const re = /<(textarea|select|input)\b([^>]*)>/g;
    let m;
    while ((m = re.exec(html))) {
      if (m[1] === 'input') {
        const type = /\btype="([^"]+)"/.exec(m[2]);
        if (type && !/^(text|search|url|email|number|password|tel|date|time)$/.test(type[1])) continue; // no keyboard, no zoom
      }
      const cls = /\bclass="([^"]+)"/.exec(m[2]);
      if (cls) for (const c of cls[1].split(/\s+/).filter(Boolean)) out.push({ cls: c, tag: m[1], file });
    }
  }
  return out;
}
// Pre-existing, filed rather than fixed here: the Music and Books sort
// <select class="btn btn-sm"> (tracker #252).
const ZOOM_CENSUS_KNOWN = { btn: '#252' };

// The size a rule body sets: `font-size: X`, or the size inside a `font:` shorthand
// (`font: 400 var(--fs-input-min) / 1.2 family`, or a type role `font: var(--t-meta)`,
// resolved through its `--t-meta-size` twin in tokens.css). null when the body sets none.
const T_SIZES = {};
for (const m of TOKENS_CSS.matchAll(/(--t-[a-z]+)-size:\s*([0-9]+)px/g)) T_SIZES[m[1]] = Number(m[2]);
function bodySizePx(body) {
  const fsDecl = /(?:^|;)\s*font-size:\s*([^;]+)/.exec(body);
  if (fsDecl) {
    const v = fsDecl[1].trim().replace(/\s*!important$/, '');
    return /^(var\(--fs-[a-z0-9-]+\)|[0-9]+px)$/.test(v) ? resolveFontSizePx(v) : null;
  }
  const font = /(?:^|;)\s*font:\s*([^;]+)/.exec(body);
  if (!font) return null;
  const role = /^var\((--t-[a-z]+)\)$/.exec(font[1].trim());
  if (role) return T_SIZES[role[1]] === undefined ? null : T_SIZES[role[1]];
  const size = /(var\(--fs-[a-z0-9-]+\)|\b[0-9]+px)/.exec(font[1]);
  return size ? resolveFontSizePx(size[1]) : null;
}

test('census: every classed input/select/textarea in public/*.html (and the Settings builder) that a class rule sizes under 16px is lifted to >=16px on mobile', () => {
  const uiCss = require('../helpers/stylesheets').readUiCss();
  const rules = cssRulesWithMedia(uiCss + '\n' + css);
  const controls = classedEntryControls();
  assert.ok(controls.some((c) => c.cls === 'bg-timing-log-text'), 'precondition: the census sees the timing-log text box');
  assert.ok(controls.some((c) => c.cls === 'ui-field__input' && c.file === 'setup.html'), 'precondition: the census sees the Settings ui-field inputs');
  assert.ok(controls.some((c) => c.cls === 'folder-name-input' && c.file === path.join('js', 'setup.js')), 'precondition: the census sees the JS-built folder name field');
  const fieldRule = rules.find((r) => r.selectors.includes('.ui-field__input') && !r.media.length && bodySizePx(r.body) !== null);
  assert.ok(fieldRule && bodySizePx(fieldRule.body) >= 16, 'witness: the ui-field input resolves to >= 16px through its font shorthand');
  const offenders = [];
  const seen = new Set();
  for (const { cls, tag, file } of controls) {
    if (seen.has(cls) || ZOOM_CENSUS_KNOWN[cls]) continue;
    seen.add(cls);
    const hit = new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '(?![\\w-])');
    let small = null;
    let floored = false;
    for (const r of rules) {
      if (!r.selectors.some((sel) => hit.test(sel))) continue;
      const px = bodySizePx(r.body);
      if (px === null) continue;
      if (r.media.some((q) => /max-width:\s*768px/.test(q))) { if (px >= 16) floored = true; } else if (!r.media.length && px < 16) small = px;
    }
    if (small !== null && !floored) offenders.push('.' + cls + ' (' + tag + ' in ' + file + ') computes ' + small + 'px on mobile');
  }
  assert.deepStrictEqual(offenders, [], 'add each to the v1.26.2 mobile floor list (style.css, beside .comment-input-box)');
});
