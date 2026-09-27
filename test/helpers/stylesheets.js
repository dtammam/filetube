'use strict';

// The app's stylesheets, for source locks. UI professionalism pass step 1: the token
// layer moved out of style.css into tokens.css, which every shell loads FIRST. A lock
// that reads a token DEFINITION reads tokens.css; one that must see every rule in
// cascade order reads readAllCss() (tokens.css, then style.css - the shells' order).

const fs = require('node:fs');
const path = require('node:path');

const CSS_DIR = path.join(__dirname, '..', '..', 'public', 'css');
const TOKENS_CSS_PATH = path.join(CSS_DIR, 'tokens.css');
const STYLE_CSS_PATH = path.join(CSS_DIR, 'style.css');

const readTokensCss = () => fs.readFileSync(TOKENS_CSS_PATH, 'utf8');
const readStyleCss = () => fs.readFileSync(STYLE_CSS_PATH, 'utf8');
const readAllCss = () => readTokensCss() + '\n' + readStyleCss();

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

module.exports = { eraBlock, TOKENS_CSS_PATH, STYLE_CSS_PATH, readTokensCss, readStyleCss, readAllCss };
