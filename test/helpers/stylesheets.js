'use strict';

// The app's stylesheets, for source locks. UI professionalism pass step 1: the token
// layer moved out of style.css into tokens.css, which every shell loads FIRST. A lock
// that reads a token DEFINITION reads tokens.css; one that must see every rule in
// cascade order reads readAllCss() (tokens.css, ui.css, then style.css - the shells' order;
// ui.css holds the step 3 primitives).

const fs = require('node:fs');
const path = require('node:path');

const CSS_DIR = path.join(__dirname, '..', '..', 'public', 'css');
const TOKENS_CSS_PATH = path.join(CSS_DIR, 'tokens.css');
const UI_CSS_PATH = path.join(CSS_DIR, 'ui.css');
const STYLE_CSS_PATH = path.join(CSS_DIR, 'style.css');

const readTokensCss = () => fs.readFileSync(TOKENS_CSS_PATH, 'utf8');
const readUiCss = () => fs.readFileSync(UI_CSS_PATH, 'utf8');
const readStyleCss = () => fs.readFileSync(STYLE_CSS_PATH, 'utf8');
const readAllCss = () => readTokensCss() + '\n' + readUiCss() + '\n' + readStyleCss();

// The body of one era x mode token block in tokens.css (comments stripped). 2021
// Modern LIGHT is the :root safe-default block (section 1), not a [data-theme]
// block: a missing or invalid era must resolve to it. Returns null if absent.
function eraBlock(era, mode = 'light') {
  const css = readTokensCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const marker = era === '2021' && mode === 'light' ? ':root {'
    : mode === 'dark' ? `[data-theme="${era}"][data-mode="dark"] {` : `[data-theme="${era}"] {`;
  const start = css.indexOf(marker);
  return start === -1 ? null : css.slice(start + marker.length, css.indexOf('}', start));
}

// Every style rule of a stylesheet in source order, comments stripped: { sel, body, at, index }.
// `at` joins the preludes of the at-rules the rule sits in ('' at top level), so a lock can
// ask "is this rule inside @media (hover: hover)" without a regex over nested braces.
// `index` is the rule's ordinal in the file (cascade order within one sheet).
function cssRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let prelude = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      const p = prelude.trim(); prelude = '';
      if (p.startsWith('@')) { stack.push(p); i++; continue; }
      const end = src.indexOf('}', i);
      out.push({ sel: p, body: src.slice(i + 1, end), at: stack.join(' '), index: out.length });
      i = end + 1; continue;
    }
    if (ch === '}') { stack.pop(); prelude = ''; i++; continue; }
    if (ch === ';') { prelude = ''; i++; continue; } // a statement at-rule (@import, @charset)
    prelude += ch; i++;
  }
  return out;
}

// True when an at-rule chain gates on a hover-capable primary pointer.
// (`@media not ...` negates the whole query, so it is never a gate.)
const isHoverGated = (at) => /@media(?![^{]*\bnot\b)[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(at);

// UI pass D7 (Dean: "Pocket is a phone mode, not a width mode"): the Pocket skin takeover was one
// `@media (max-width: 768px)` block and is now keyed on the device class music-skins.js sets once
// at load, as a zero-specificity scope on EVERY selector of the block. A lock written against the
// takeover's own rules reads the sheet through unscopePocket(): the scope is dropped exactly the way
// those locks dropped the @media wrapper they flattened before, so each keeps pinning the rule it
// pinned. That the scope really sits on every rule of the block (and nothing Pocket is left on a
// width query) is bound on its own by test/unit/pocket-phone-scope.test.js.
const POCKET_SCOPE = ':where(html.is-phone, html.mms-popout)';
const unscopePocket = (css) => String(css).split(POCKET_SCOPE + ' ').join('');

module.exports = { eraBlock, cssRules, isHoverGated, TOKENS_CSS_PATH, UI_CSS_PATH, STYLE_CSS_PATH, readTokensCss, readUiCss, readStyleCss, readAllCss, POCKET_SCOPE, unscopePocket };
