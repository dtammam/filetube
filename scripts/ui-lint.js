#!/usr/bin/env node
'use strict';

/*
 * ui-lint - the UI guardrail runner (UI professionalism pass, plan D10.1).
 *
 * ONE runner over every styling surface the app has:
 *   - css-tree AST over public/css/** (tokens.css -> ui.css -> style.css is the cascade);
 *   - the <style> blocks in public/*.html and lib/ytdlp/views/*.html;
 *   - HTML style="" attributes in those files;
 *   - JS style writes in public/js/*.js, lib/ytdlp/client/*.js and inline <script>s:
 *     el.style.X = '...', el.style.cssText = '...', setProperty('x', '...'), and
 *     style="..." inside JS string/template literals.
 * JS is read through espree's TOKENS (a declared devDependency, the parser eslint
 * itself uses), so comments never satisfy or trip a rule (LESSONS 3, comment-porous
 * locks) and a string is a string wherever it sits.
 *
 * THE RULES (the RULES table below; `on:false` = implemented and canaried, but not
 * counted as debt until its step turns it on):
 *   1 no-raw-values         colour, size (incl. width/height/min/max), radius, font,
 *                           weight, line-height, shadow, z-index, duration, easing
 *                           must be tokens. Custom-property DEFINITIONS in tokens.css
 *                           are the token layer and are exempt; a line carrying a
 *                           `token-exempt` comment is exempt (css-token-lint's
 *                           convention; a LINE comment in JS).
 *   2 no-legacy-tokens      (OFF until step 7) var() of an alias-block or legacy per-era
 *                           name from tokens.css, or the --fs-* scale / --scrim-legacy.
 *   3 no-bespoke-controls   a control-shaped rule subject must be a ui-* primitive; every
 *                           <button> / createElement('button') carries a ui- class.
 *   4 hover-gated           every :hover rule sits inside @media (hover: hover).
 *   5 pressed-state         every interactive ui-* primitive has :active/[data-pressed].
 *   6 native-interaction    the D6 base rules exist in ui.css; the input re-enable is the
 *                           LAST user-select rule in cascade order; no other user-select /
 *                           -webkit-touch-callout / -webkit-tap-highlight-color outside
 *                           the ui-selectable allow-list; `contextmenu` listeners only in
 *                           public/js/interaction.js; every shell's viewport meta pins
 *                           maximum-scale=1 and user-scalable=no (D6 pinch zoom).
 *   7 icons                 no inline <svg> outside icons.js and the skin files (a sprite
 *                           <svg><use href="#i-..."> reference is the registry, allowed);
 *                           no AC4 text glyphs in JS/HTML strings outside skin files; no
 *                           vertical-align on .ui-icon or inside .ui-btn.
 *   8 no-layout-transition  transition / transition-property never names a layout
 *                           property; `all` (spelled or implied) is banned.
 *   9 z-ladder              position:fixed|sticky and overlay subjects use ladder tokens.
 *  10 display-ownership     no display:...!important but the global [hidden] rule; no JS
 *                           style.display writes.
 *  11 colour-roles          no --accent/--accent-fill/--danger/--indicator (or the legacy
 *                           --yt-red/--yt-red-dark) in a
 *                           hover/active/focus/selected/pressed selector (D8.8), except
 *                           ui.css's primary-button fill.
 *  12 no-shell-style        no <style> in a shell (diag.html is listed, not hard-coded).
 *
 * DEBT KEYS are `file|selector|property`, `file|<what>` or a class name - never a line
 * number, so moving code does not churn docs/ui-exceptions.json. A key's COUNT is how
 * many times it occurs.
 *
 * CANARIES (css-token-lint's self-canary pattern, one per rule): every rule has a
 * fixture pair under test/fixtures/ui-lint/<rule>/. Every bad* file's first line names
 * its virtual path and the exact hit count it must produce (`ui-lint-canary:
 * path=public/css/style.css expect=3`); good* files must produce zero. A canary that
 * does not fire, or fires on its good twin, exits 2 LOUD: a broken detector's zero
 * proves nothing.
 *
 * MODES:
 *   (flagless)          report the debt per rule; always exit 0.
 *   --enforce           canaries (exit 2 on failure), then the live debt against
 *                       docs/ui-exceptions.json (plan D10.3, shrink-only): exit 1 on a key
 *                       or count above its entry (new debt), below it (paid debt: shrink
 *                       the file), or a missing / malformed file.
 *   --write-baseline    canaries, then write the file ONLY if it does not exist.
 *   --shrink            canaries, then lower each paid entry to its live count (delete
 *                       it at 0) and write the file; REFUSES, writing nothing, if any key
 *                       is above its entry - it can only ever shrink the file.
 *   --canaries          the canaries alone.
 *   --verbose           list every key (and its first location).
 *   --root <dir>        the tree to scan (default: this script's repo).
 *   --exceptions <file> the exceptions file (default: <root>/docs/ui-exceptions.json).
 */

const fs = require('node:fs');
const path = require('node:path');
const csstree = require('css-tree');
const espree = require('espree');

const DEFAULT_ROOT = path.join(__dirname, '..');
const EXCEPTIONS_REL = 'docs/ui-exceptions.json';
const FIXTURES_REL = 'test/fixtures/ui-lint';

// ---------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------

function listFiles(dir, re, recursive) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (recursive) out.push(...listFiles(p, re, true)); } else if (re.test(ent.name)) out.push(p);
  }
  return out.sort();
}

/** Every file ui-lint scans, as {path (repo-relative, posix), kind, text}. */
function collectSources(root) {
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const files = [
    ...listFiles(path.join(root, 'public/css'), /\.css$/, true).map((p) => [p, 'css']),
    ...listFiles(path.join(root, 'public'), /\.html$/, false).map((p) => [p, 'html']),
    ...listFiles(path.join(root, 'lib/ytdlp/views'), /\.html$/, false).map((p) => [p, 'html']),
    ...listFiles(path.join(root, 'public/js'), /\.js$/, false).map((p) => [p, 'js']),
    ...listFiles(path.join(root, 'lib/ytdlp/client'), /\.js$/, false).map((p) => [p, 'js']),
  ];
  return files.map(([p, kind]) => ({ path: rel(p), kind, text: fs.readFileSync(p, 'utf8') }));
}

// ---------------------------------------------------------------------------------------
// tokens.css facts (read from the scanned tree: the legacy names and the z ladder)
// ---------------------------------------------------------------------------------------

function tokensInfo(root) {
  const text = fs.readFileSync(path.join(root, 'public/css/tokens.css'), 'utf8');
  const legacy = new Set();
  // The alias block: "---- 3. aliases" up to the next "---- " section heading.
  const aliasStart = text.search(/\/\*\s*-+\s*3\.\s*aliases/);
  if (aliasStart !== -1) {
    const rest = text.slice(aliasStart + 4);
    const end = rest.search(/\/\*\s*-+\s*\d+\./);
    const block = end === -1 ? rest : rest.slice(0, end);
    for (const m of block.matchAll(/(--[\w-]+)\s*:/g)) legacy.add(m[1]);
  }
  // The legacy per-era names: in each era block, the declarations after its
  // `/* legacy` comment up to the block's closing brace.
  for (const m of text.matchAll(/\[data-theme="\d+"\][^{]*\{([^}]*)\}/g)) {
    const body = m[1];
    const at = body.search(/\/\*\s*legacy\b/);
    if (at === -1) continue;
    for (const d of body.slice(at).matchAll(/(--[\w-]+)\s*:/g)) legacy.add(d[1]);
  }
  legacy.add('--scrim-legacy');
  const ladder = [];
  for (const m of text.matchAll(/(--z-[\w-]+)\s*:\s*\d+\s*;/g)) ladder.push(m[1]);
  return { legacy, legacyPrefixes: ['--fs-'], ladder };
}

// ---------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------

const blankKeepLines = (s) => s.replace(/[^\n]/g, ' ');
const lineOf = (text, offset) => { let n = 1; for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++; return n; };

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; } return lo + 1; };
}

/** Lines (1-based) on which a CSS comment carries `word`. */
function cssCommentLines(text, word) {
  const lines = new Set();
  const at = lineIndex(text);
  for (const m of text.matchAll(/\/\*[\s\S]*?\*\//g)) {
    let i = m[0].indexOf(word);
    while (i !== -1) { lines.add(at(m.index + i)); i = m[0].indexOf(word, i + 1); }
  }
  return lines;
}

/** Split at top-level `sep` (outside (), [] and quotes). */
function splitTop(s, sep) {
  const out = [];
  let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] || ''; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(c) : c === sep)) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

const normSel = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

/** The subject compound of one complex selector (the element the rule styles). */
function subjectOf(sel) {
  const s = sel.replace(/\s*([>+~])\s*/g, '$1').trim();
  let depth = 0, cut = 0, q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) cut = i + 1;
  }
  return s.slice(cut);
}

/** The top-level parts of a compound: type, classes, ids, attrs, pseudos (arguments dropped). */
function compoundParts(compound) {
  let flat = '';
  const attrs = [];
  let depth = 0;
  for (let i = 0; i < compound.length; i++) {
    const c = compound[i];
    if (c === '[' && depth === 0) {
      const end = compound.indexOf(']', i);
      attrs.push(compound.slice(i + 1, end === -1 ? compound.length : end).trim());
      i = end === -1 ? compound.length : end;
      continue;
    }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth === 0) flat += c;
  }
  const typeM = /^([a-zA-Z][\w-]*|\*)/.exec(flat);
  return {
    type: typeM ? typeM[1].toLowerCase() : null,
    classes: [...flat.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
    ids: [...flat.matchAll(/#([\w-]+)/g)].map((m) => m[1]),
    attrs,
    pseudos: [...flat.matchAll(/::?([\w-]+)/g)].map((m) => m[1].toLowerCase()),
  };
}

// ---------------------------------------------------------------------------------------
// The model: CSS rules, inline declarations, JS token views, HTML documents
// ---------------------------------------------------------------------------------------

const CSS_RANK = { 'public/css/tokens.css': 0, 'public/css/ui.css': 1, 'public/css/style.css': 2 };

function newModel(info) {
  return { info, rules: [], inline: [], js: [], html: [], errors: [] };
}

/** Parse one stylesheet into flat rule records (selector, @-context, declarations). */
function addCss(model, text, file, lineOffset, rank) {
  const exempt = cssCommentLines(text, 'token-exempt');
  let ast;
  try {
    ast = csstree.parse(text, {
      positions: true, parseValue: false, parseRulePrelude: false, parseAtrulePrelude: false,
      parseCustomProperty: false,
      onParseError: (e) => model.errors.push(`${file}: css parse: ${e.message}`),
    });
  } catch (e) {
    model.errors.push(`${file}: css parse failed: ${e.message}`);
    return;
  }
  let idx = 0;
  const rawText = (n) => (n && typeof n.value === 'string' ? n.value : n ? csstree.generate(n) : '');
  const declOf = (node) => {
    const s = node.loc.start.line, e = node.loc.end.line;
    let ex = false;
    for (let l = s; l <= e; l++) if (exempt.has(l)) { ex = true; break; }
    const prop = node.property.startsWith('--') ? node.property : node.property.toLowerCase();
    return {
      prop,
      value: rawText(node.value).replace(/\/\*[\s\S]*?\*\//g, ' ').trim(),
      important: !!node.important,
      line: s + lineOffset,
      exempt: ex,
    };
  };
  const walk = (list, at, parentSel) => {
    const pendingDecls = [];
    list.forEach((node) => {
      if (node.type === 'Atrule') {
        const frame = { name: node.name.toLowerCase(), prelude: normSel(rawText(node.prelude)) };
        if (node.block) walk(node.block.children, at.concat(frame), frame.name === 'media' || frame.name === 'supports' || frame.name === 'container' || frame.name === 'layer' ? parentSel : null);
      } else if (node.type === 'Rule') {
        const own = normSel(rawText(node.prelude));
        const selector = parentSel ? splitTop(own, ',').map((c) => (c.includes('&') ? c.replace(/&/g, parentSel) : `${parentSel} ${c}`)).join(', ') : own;
        const decls = [];
        const nested = [];
        node.block.children.forEach((c) => {
          if (c.type === 'Declaration') decls.push(declOf(c));
          else nested.push(c);
        });
        model.rules.push({
          file, selector, items: splitTop(selector, ','), at, decls,
          line: node.loc.start.line + lineOffset, order: rank * 1e6 + idx++,
        });
        if (nested.length) {
          const l = new csstree.List();
          nested.forEach((n) => l.appendData(n));
          walk(l, at, selector);
        }
      } else if (node.type === 'Declaration') {
        pendingDecls.push(declOf(node));
      }
    });
    if (pendingDecls.length && at.length) {
      const top = at[at.length - 1];
      model.rules.push({
        file, selector: '@' + top.name, items: ['@' + top.name], at: at.slice(0, -1).concat(top), decls: pendingDecls,
        line: pendingDecls[0].line, order: rank * 1e6 + idx++, atDescriptor: true,
      });
    }
  };
  walk(ast.children, [], null);
}

/** Parse a declaration list (style="" / cssText) into inline declarations. */
function addInlineDecls(model, text, file, origin, line, exemptLine) {
  let ast;
  try {
    ast = csstree.parse(text, { context: 'declarationList', parseValue: false, parseCustomProperty: false, onParseError: () => {} });
  } catch { return; }
  ast.children.forEach((d) => {
    if (d.type !== 'Declaration') return;
    const prop = d.property.startsWith('--') ? d.property : d.property.toLowerCase();
    const value = (d.value && typeof d.value.value === 'string' ? d.value.value : csstree.generate(d.value)).trim();
    model.inline.push({ file, origin, prop, value, important: !!d.important, line, exempt: !!exemptLine });
  });
}

const JS_PLACEHOLDER = 'var(--js-expr)';

function decodeJs(s) {
  return s.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g, (m, _a, cp, u4, x2, ch) => {
    if (cp) return String.fromCodePoint(parseInt(cp, 16));
    if (u4) return String.fromCharCode(parseInt(u4, 16));
    if (x2) return String.fromCharCode(parseInt(x2, 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[ch] || (ch === '\n' ? '' : ch);
  });
}

function tokenize(text) {
  for (const sourceType of ['script', 'module']) {
    try {
      return espree.tokenize(text, { ecmaVersion: 'latest', sourceType, comment: true, loc: true });
    } catch (e) { if (sourceType === 'module') throw e; }
  }
  return null;
}

/** A JS source: its code tokens, string units (template literals joined), comment lines. */
function addJs(model, text, file, lineOffset) {
  let toks;
  try { toks = tokenize(text); } catch (e) { model.errors.push(`${file}: js tokenize failed: ${e.message}`); return; }
  const exemptLines = new Set();
  for (const c of toks.comments || []) {
    if (c.value.includes('token-exempt')) for (let l = c.loc.start.line; l <= c.loc.end.line; l++) exemptLines.add(l + lineOffset);
  }
  const code = toks.filter((t) => t.type !== 'Line' && t.type !== 'Block');
  code.forEach((t) => { t.line = t.loc.start.line + lineOffset; });
  // String units: every string literal, and every template literal with its
  // substitutions replaced by a placeholder (so `<button class="${c}">` reads whole).
  const units = [];
  const stack = [];
  const unitOf = new Map(); // token index -> unit (for the literal a style write assigns)
  code.forEach((t, i) => {
    if (t.type === 'String') {
      const u = { text: decodeJs(t.value.slice(1, -1)), line: t.line, dynamic: false };
      units.push(u); unitOf.set(i, u);
    } else if (t.type === 'Template') {
      const v = t.value;
      const opens = v.startsWith('`');
      const piece = decodeJs(v.slice(1, v.endsWith('${') ? -2 : -1));
      if (opens) {
        const u = { text: piece, line: t.line, dynamic: false };
        if (v.endsWith('${')) { u.text += JS_PLACEHOLDER; u.dynamic = true; stack.push(u); }
        units.push(u); unitOf.set(i, u);
      } else {
        const u = stack[stack.length - 1];
        if (!u) return;
        u.text += piece;
        if (v.endsWith('${')) u.text += JS_PLACEHOLDER; else stack.pop();
      }
    }
  });
  const view = { file, code, units, unitOf, exemptLines, text };
  model.js.push(view);

  // Style writes: X.style.prop = literal | X.style.cssText (+)= literal | .setProperty('p', literal)
  const lit = (i) => {
    const t = code[i];
    if (!t) return null;
    if (t.type !== 'String' && t.type !== 'Template') return null;
    const u = unitOf.get(i);
    if (!u) return null;
    // only a WHOLE literal RHS (the next token ends the expression)
    let j = i + 1;
    if (t.type === 'Template' && !t.value.endsWith('`')) {
      let depth = 0;
      for (; j < code.length; j++) {
        const tj = code[j];
        if (tj.type === 'Template') {
          if (tj.value.startsWith('`') && tj.value.endsWith('${')) depth++;
          else if (tj.value.startsWith('}') && tj.value.endsWith('`')) { if (depth === 0) { j++; break; } depth--; }
        }
      }
    }
    const next = code[j];
    if (next && next.type === 'Punctuator' && !/^(;|,|\)|\}|\])$/.test(next.value)) return null;
    return u.text;
  };
  for (let i = 1; i < code.length; i++) {
    const t = code[i];
    if (t.type === 'Identifier' && t.value === 'style' && code[i - 1].value === '.' && code[i + 1] && code[i + 1].value === '.' && code[i + 2] && code[i + 2].type === 'Identifier') {
      const p = code[i + 2].value;
      const op = code[i + 3];
      if (p === 'setProperty' || p === 'removeProperty' || p === 'getPropertyValue') continue;
      if (!op || op.type !== 'Punctuator' || (op.value !== '=' && op.value !== '+=')) continue;
      const exempt = exemptLines.has(t.line);
      const v = lit(i + 4);
      if (p === 'cssText') {
        if (v != null) addInlineDecls(model, v, file, 'js-style', t.line, exempt);
        else model.inline.push({ file, origin: 'js-style', prop: 'css-text', value: null, important: false, line: t.line, exempt });
        continue;
      }
      let prop = p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      if (/^(webkit|moz|ms)-/.test(prop)) prop = '-' + prop;
      model.inline.push({ file, origin: 'js-style', prop, value: v, important: false, line: t.line, exempt });
    }
    if (t.type === 'Identifier' && t.value === 'setProperty' && code[i - 1].value === '.' && code[i + 1] && code[i + 1].value === '(' && code[i + 2] && code[i + 2].type === 'String') {
      const prop = unitOf.get(i + 2).text.trim();
      if (!/^-?-?[a-zA-Z][\w-]*$/.test(prop)) continue;
      const v = code[i + 3] && code[i + 3].value === ',' ? lit(i + 4) : null;
      const imp = v != null && /important/.test(v);
      const pr = code[i + 5] && code[i + 5].value === ',' ? unitOf.get(i + 6) : null;
      model.inline.push({ file, origin: 'js-style', prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value: v, important: imp || !!(pr && /important/.test(pr.text)), line: t.line, exempt: exemptLines.has(t.line) });
    }
  }
  // style="..." inside JS string units
  for (const u of units) {
    for (const m of u.text.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      addInlineDecls(model, m[1] != null ? m[1] : m[2], file, 'js-template-style', u.line, exemptLines.has(u.line));
    }
  }
}

const HTML_ENTITIES = { times: '×', larr: '←', rarr: '→', lsaquo: '‹', rsaquo: '›', check: '✓', checkmark: '✓', star: '☆', starf: '★', bigstar: '★', vellip: '⋮', sung: '♪', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return HTML_ENTITIES[e] != null ? HTML_ENTITIES[e] : m;
  });
}

function addHtml(model, text, file) {
  const noComments = text.replace(/<!--[\s\S]*?-->/g, blankKeepLines);
  let markup = noComments;
  let styleBlocks = 0;
  for (const m of noComments.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    styleBlocks++;
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    addCss(model, m[1], file, lineOf(noComments, bodyStart) - 1, 4);
    markup = markup.slice(0, m.index) + blankKeepLines(m[0]) + markup.slice(m.index + m[0].length);
  }
  for (const m of noComments.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    const typeM = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
    const jsType = !typeM || /^(text\/javascript|module|application\/javascript)$/i.test(typeM[1]);
    if (!/\bsrc\s*=/.test(attrs) && jsType && m[2].trim()) {
      const bodyStart = m.index + m[0].indexOf('>') + 1;
      addJs(model, m[2], file, lineOf(noComments, bodyStart) - 1);
    }
    markup = markup.slice(0, m.index) + blankKeepLines(m[0]) + markup.slice(m.index + m[0].length);
  }
  const at = lineIndex(markup);
  const exemptLines = new Set();
  text.split('\n').forEach((l, i) => { if (/<!--[^>]*token-exempt/.test(l)) exemptLines.add(i + 1); });
  for (const m of markup.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const ln = at(m.index);
    addInlineDecls(model, decodeEntities(m[1] != null ? m[1] : m[2]), file, 'style-attr', ln, exemptLines.has(ln));
  }
  model.html.push({ file, markup, styleBlocks, at });
}

function buildModel(sources, info) {
  const model = newModel(info);
  for (const s of sources) {
    if (s.kind === 'css') addCss(model, s.text, s.path, 0, CSS_RANK[s.path] != null ? CSS_RANK[s.path] : 3);
    else if (s.kind === 'html') addHtml(model, s.text, s.path);
    else if (s.kind === 'js') addJs(model, s.text, s.path, 0);
  }
  return model;
}

// ---------------------------------------------------------------------------------------
// The raw-value classifier (css-token-lint's classifyDecl, widened to D10.1 rule 1)
// ---------------------------------------------------------------------------------------

const LEN_UNITS = new Set(['px', 'em', 'rem', 'pt', 'pc', 'ch', 'ex', 'cm', 'mm', 'in', 'q', 'lh', 'rlh', 'cap', 'ic', 'rex', 'rch', 'ric', 'rcap']);
const NAMED_COLOURS = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ');
const NAMED_RE = new RegExp(`(?<![\\w-])(?:${NAMED_COLOURS.join('|')})(?![\\w-])`, 'i');
const HEX_RE = /#[0-9a-fA-F]{3,8}(?![\w-])/;
const COLOUR_FN_RE = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const COLOUR_PROP = /^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|fill|stroke|[\w-]*-color|box-shadow|text-shadow|column-rule|text-decoration|text-emphasis|filter|backdrop-filter)$/;
const SIZE_PROP = /^(width|height|(min|max)-(width|height)|(min-|max-)?(inline|block)-size|margin(-[\w-]+)?|padding(-[\w-]+)?|gap|row-gap|column-gap|grid-gap|grid-(row|column)-gap|top|right|bottom|left|inset(-[\w-]+)?|flex|flex-basis|font-size|letter-spacing|word-spacing|text-indent|border|border-(top|right|bottom|left|block|inline)(-(start|end))?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?-width|outline|outline-width|outline-offset|column-rule(-width)?|column-width|grid-template-columns|grid-template-rows|grid-auto-columns|grid-auto-rows|scroll-(margin|padding)(-[\w-]+)?|text-decoration-thickness|text-underline-offset|stroke-width)$/;
const SHADOW_PROP = /^(box-shadow|text-shadow)$/;
const MOTION_PROP = /^(-webkit-)?(transition|animation)(-[\w-]+)?$/;
const RADIUS_PROP = /^border(-[\w]+)*-radius$/;
const EASING_FN = /(?<![\w-])(?:cubic-bezier|steps)\(/i;
const EASING_KW = /(?<![\w-])(?:ease|ease-in|ease-out|ease-in-out|step-start|step-end)(?![\w-])/i;
const FONT_SIZE_KW = /(?<![\w-])(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)(?![\w-])/i;
const NUM_RE = /(?<![\w.#-])-?(\d*\.?\d+(?:e[+-]?\d+)?)([a-zA-Z%]*)/g;

function numbers(s) { return [...s.matchAll(NUM_RE)].map((m) => ({ n: parseFloat(m[1]), unit: m[2].toLowerCase() })); }

/** Strip the parts of a value that are never style literals: comments, url(), strings. */
function denoise(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/gi, ' ').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ').replace(/!\s*important/i, '').trim();
}

/** var() strips, but a FALLBACK survives (it paints): css-token-lint's rule. Zero env() fallbacks strip. */
function stripVars(v) {
  let bare = v.replace(/env\(\s*[\w-]+\s*,\s*0(?:px)?\s*\)/gi, ' ').replace(/env\(\s*[\w-]+\s*\)/gi, ' ');
  for (let n = 0; n < 6; n++) {
    const next = bare.replace(/var\(\s*--[\w-]+\s*\)/g, ' ').replace(/var\(\s*--[\w-]+\s*,\s*([^()]*)\)/g, ' $1 ');
    if (next === bare) break;
    bare = next;
  }
  return bare.replace(/\s+/g, ' ').trim();
}

const KEYWORD_ONLY = /^(transparent|currentcolor|inherit|none|auto|normal|unset|initial|revert|revert-layer|0)$/i;

/**
 * The categories a declaration's raw literals hit ([] = clean). `ladder` pins the z
 * idiom calc(var(--z-X) +/- N) to the real ladder names (css-token-lint v6).
 */
function classifyValue(prop, value, ladder) {
  const cats = new Set();
  const v0 = denoise(value);
  const bare = stripVars(v0);
  if (bare === '' || KEYWORD_ONLY.test(bare)) return [];
  const nums = numbers(bare.replace(HEX_RE, ' '));
  const nonZero = (f) => nums.some((x) => x.n !== 0 && f(x));
  const isCustom = prop.startsWith('--');
  if (HEX_RE.test(bare) || COLOUR_FN_RE.test(bare)) cats.add('colour');
  else if ((COLOUR_PROP.test(prop) || isCustom) && NAMED_RE.test(bare)) cats.add('colour');

  if (prop === 'z-index') {
    const zIdiom = new RegExp(`^calc\\(\\s*var\\((?:${ladder.join('|') || '--z-none'})\\)\\s*[+-]\\s*\\d+\\s*\\)$`);
    if (!zIdiom.test(v0) && /\d/.test(bare)) cats.add('z-index');
  } else if (prop === 'font-weight') {
    if (nums.length || /(?<![\w-])(bold|bolder|lighter)(?![\w-])/i.test(bare)) cats.add('weight');
  } else if (prop === 'line-height') {
    if (nonZero(() => true)) cats.add('line-height');
  } else if (prop === 'font') {
    if (nonZero(() => true) || /(?<![\w-])(bold|bolder|lighter)(?![\w-])/i.test(bare) || FONT_SIZE_KW.test(bare)) cats.add('font');
  } else if (prop === 'font-size') {
    if (nonZero((x) => LEN_UNITS.has(x.unit)) || FONT_SIZE_KW.test(bare)) cats.add('size');
  } else if (SHADOW_PROP.test(prop)) {
    if (nonZero(() => true)) cats.add('shadow');
  } else if (MOTION_PROP.test(prop)) {
    if (nonZero((x) => x.unit === 's' || x.unit === 'ms')) cats.add('duration');
    if (EASING_FN.test(bare) || EASING_KW.test(bare)) cats.add('easing');
  } else if (RADIUS_PROP.test(prop)) {
    const radiusIdiom = /^calc\(\s*var\(--(?:radius|radius-lg|radius-full|r-xs|r-sm|r-md|r-lg|r-pill)\)\s*[+-]\s*\d+px\s*\)$/;
    if (!radiusIdiom.test(v0) && nonZero((x) => LEN_UNITS.has(x.unit))) cats.add('radius');
  } else if (SIZE_PROP.test(prop)) {
    if (nonZero((x) => LEN_UNITS.has(x.unit))) cats.add('size');
  } else if (isCustom) {
    if (nonZero((x) => LEN_UNITS.has(x.unit))) cats.add('size');
    if (nonZero((x) => x.unit === 's' || x.unit === 'ms')) cats.add('duration');
    if (EASING_FN.test(bare)) cats.add('easing');
  }
  return [...cats].sort();
}

// ---------------------------------------------------------------------------------------
// Detectors. Each takes (model, report) and calls report(key, where, detail).
// ---------------------------------------------------------------------------------------

// UI pass D7 (S7): the Pocket skin takeover was one `@media (max-width: 768px)` block; it is now
// keyed on the device class, as a zero-specificity scope on EVERY selector of the block
// (style.css). At-rule preludes were never part of a key, so the scope that replaced one is not
// either: the same rules keep the same debt keys (renaming them would read as new debt + paid
// debt for an unchanged rule). Only this exact scope is dropped.
const KEY_SCOPE = ':where(html.is-phone, html.mms-popout) ';
const keySelector = (sel) => String(sel).split(KEY_SCOPE).join('');
const ruleKey = (r, prop) => `${r.file}|${keySelector(r.selector)}${prop ? '|' + prop : ''}`;
const inlineKey = (d) => `${d.file}|${d.origin}|${d.prop}`;
const inAt = (r, name) => r.at.some((f) => f.name === name || f.name.endsWith('-' + name));

function detectNoRawValues(model, report) {
  const ladder = model.info.ladder;
  for (const r of model.rules) {
    if (inAt(r, 'font-face')) continue;
    for (const d of r.decls) {
      if (d.exempt) continue;
      if (d.prop.startsWith('--') && r.file === 'public/css/tokens.css') continue; // the token layer
      const cats = classifyValue(d.prop, d.value, ladder);
      if (cats.length) report(ruleKey(r, d.prop), `${r.file}:${d.line}`, `${d.prop}: ${d.value.slice(0, 60)} [${cats.join(',')}]`);
    }
  }
  for (const d of model.inline) {
    if (d.exempt || d.value == null) continue;
    const cats = classifyValue(d.prop, d.value, ladder);
    if (cats.length) report(inlineKey(d), `${d.file}:${d.line}`, `${d.prop}: ${d.value.slice(0, 60)} [${cats.join(',')}]`);
  }
}

function legacyRefs(model, s) {
  const out = [];
  for (const m of s.matchAll(/--[\w-]+/g)) {
    const name = m[0];
    if (model.info.legacy.has(name) || model.info.legacyPrefixes.some((p) => name.startsWith(p))) out.push(name);
  }
  return out;
}

function detectNoLegacyTokens(model, report) {
  for (const r of model.rules) {
    for (const d of r.decls) {
      for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (legacyRefs(model, m[1]).length) report(ruleKey(r, d.prop), `${r.file}:${d.line}`, `var(${m[1]})`);
      }
    }
  }
  for (const d of model.inline) {
    if (d.value == null) continue;
    for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) if (legacyRefs(model, m[1]).length) report(inlineKey(d), `${d.file}:${d.line}`, `var(${m[1]})`);
  }
  for (const v of model.js) {
    for (const u of v.units) {
      if (/\bstyle\s*=/.test(u.text)) continue; // counted through model.inline
      for (const name of legacyRefs(model, u.text)) report(`${v.file}|js|${name}`, `${v.file}:${u.line}`, name);
    }
  }
}

const CONTROL_CLASS = /(?:^|-)(btn|button|row|chip|badge|pill|modal|sheet|menu|avatar|thumb|toast|backdrop|scrim)$/;

function detectNoBespokeControls(model, report) {
  for (const r of model.rules) {
    if (r.atDescriptor || inAt(r, 'keyframes')) continue;
    const pointer = r.decls.some((d) => d.prop === 'cursor' && /^pointer$/i.test(denoise(d.value)));
    for (const item of r.items) {
      const p = compoundParts(subjectOf(item));
      if (p.classes.some((c) => c.startsWith('ui-'))) continue;
      const ctlClass = p.classes.find((c) => CONTROL_CLASS.test(c));
      const isButton = p.type === 'button' || p.attrs.some((a) => /^role\s*=\s*["']?button["']?$/i.test(a));
      if (ctlClass) report('.' + ctlClass, `${r.file}:${r.line}`, item);
      else if (isButton) report(`${r.file}|${item}`, `${r.file}:${r.line}`, item);
      else if (pointer) report(p.classes.length ? '.' + p.classes[0] : `${r.file}|${item}`, `${r.file}:${r.line}`, `${item} {cursor:pointer}`);
    }
  }
  const buttonTag = (file, text, line) => {
    for (const m of text.matchAll(/<button\b([^>]*)/gi)) {
      const cm = /\bclass\s*=\s*(?:"([^"]*)"?|'([^']*)'?|([^\s>"']+))/i.exec(m[1]);
      const cls = cm ? (cm[1] != null ? cm[1] : cm[2] != null ? cm[2] : cm[3]) : null;
      if (cls && /(?:^|\s)ui-/.test(cls)) continue;
      const first = cls ? cls.trim().split(/\s+/)[0].replace(JS_PLACEHOLDER, '${}') || '(dynamic)' : '(no class)';
      report(`${file}|<button>|${first}`, `${file}:${line(m.index)}`, `<button${m[1].slice(0, 60)}`);
    }
  };
  for (const h of model.html) buttonTag(h.file, h.markup, h.at);
  for (const v of model.js) {
    for (const u of v.units) buttonTag(v.file, u.text, () => u.line);
    const c = v.code;
    for (let i = 0; i < c.length; i++) {
      if (!(c[i].type === 'Identifier' && c[i].value === 'createElement' && c[i + 1] && c[i + 1].value === '(' && c[i + 2] && c[i + 2].type === 'String' && /^['"]button['"]$/i.test(c[i + 2].value))) continue;
      // the variable it lands in: `X = <...>.createElement('button')`
      let j = i - 1;
      while (j > 0 && (c[j].value === '.' || c[j].type === 'Identifier') && c[j - 1] && c[j - 1].value !== '=') j--;
      const name = c[j - 1] && c[j - 1].value === '=' && c[j - 2] && c[j - 2].type === 'Identifier' ? c[j - 2].value : null;
      let ok = false;
      if (name) {
        for (let k = i + 4; k < Math.min(c.length, i + 200); k++) {
          if (c[k].type !== 'Identifier' || c[k].value !== name || !c[k + 1] || c[k + 1].value !== '.') continue;
          const what = c[k + 2] && c[k + 2].value;
          const valAt = what === 'className' && c[k + 3] && (c[k + 3].value === '=' || c[k + 3].value === '+=') ? k + 4
            : (what === 'classList' && c[k + 4] && c[k + 4].value === 'add') ? k + 6
              : (what === 'setAttribute' && c[k + 4] && /^['"]class['"]$/.test(c[k + 4].value)) ? k + 6 : -1;
          if (valAt === -1) continue;
          const u = v.unitOf.get(valAt);
          if (u && /(?:^|\s)ui-/.test(u.text)) { ok = true; break; }
        }
      }
      if (!ok) report(`${v.file}|createElement(button)|${name || '(anonymous)'}`, `${v.file}:${c[i].line}`, `createElement('button') without a ui- class`);
    }
  }
}

function detectHoverGated(model, report) {
  const gated = (r) => r.at.some((f) => f.name === 'media' && /\(\s*(any-)?hover\s*:\s*hover\s*\)/i.test(f.prelude));
  for (const r of model.rules) {
    if (r.atDescriptor) continue;
    if (/:hover\b/i.test(r.selector) && !gated(r)) report(ruleKey(r), `${r.file}:${r.line}`, r.selector);
  }
}

function detectPressedState(model, report) {
  const interactive = new Map();
  for (const r of model.rules) {
    if (r.atDescriptor) continue;
    if (!r.decls.some((d) => d.prop === 'cursor' && /^pointer$/i.test(denoise(d.value)))) continue;
    for (const item of r.items) {
      if (/:(hover|disabled|focus)/i.test(item)) continue;
      const p = compoundParts(subjectOf(item));
      const cls = p.classes.find((c) => c.startsWith('ui-'));
      if (cls && !interactive.has(cls)) interactive.set(cls, `${r.file}:${r.line}`);
    }
  }
  for (const [cls, where] of interactive) {
    const re = new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}(?![\\w-])[^\\s>+~,()]*?(:active|\\[data-pressed)`);
    const has = model.rules.some((r) => !r.atDescriptor && re.test(r.selector));
    if (!has) report('.' + cls, where, `.${cls} is interactive (cursor:pointer) with no :active / [data-pressed] rule`);
  }
}

const UA_SELECT_PROPS = new Set(['user-select', '-webkit-user-select', '-moz-user-select', '-ms-user-select', '-webkit-touch-callout', '-webkit-tap-highlight-color']);
const USER_SELECT = new Set(['user-select', '-webkit-user-select', '-moz-user-select', '-ms-user-select']);
const UI_SELECTABLE_FILES = new Set(['public/read.html', 'public/js/read.js', 'public/js/player.js']); // D6: {read.html content, the ?debugLifecycle=1 overlay (player.js)}
const INTERACTION_JS = 'public/js/interaction.js';

function detectNativeInteraction(model, report) {
  const UI = 'public/css/ui.css';
  const val = (r, prop) => { const d = r.decls.find((x) => x.prop === prop); return d ? denoise(d.value).toLowerCase() : null; };
  const uiRules = model.rules.filter((r) => r.file === UI && r.at.length === 0 && !r.atDescriptor);
  const isBody = (r) => r.selector === 'body' && val(r, 'user-select') === 'none' && val(r, '-webkit-user-select') === 'none'
    && val(r, '-webkit-touch-callout') === 'none' && val(r, '-webkit-tap-highlight-color') === 'transparent' && val(r, 'touch-action') === 'manipulation';
  const FIELD_ITEMS = ['input', 'textarea', 'select', '[contenteditable="true"]', '[contenteditable=""]'];
  const isInput = (r) => FIELD_ITEMS.every((f) => r.items.includes(f)) && val(r, 'user-select') === 'text' && val(r, '-webkit-user-select') === 'text' && val(r, '-webkit-touch-callout') === 'default';
  const isHtml = (r) => r.selector === 'html' && val(r, 'text-size-adjust') === '100%' && val(r, '-webkit-text-size-adjust') === '100%';
  const isDrag = (r) => ['img', 'a', 'video', 'svg'].every((t) => r.items.includes(t)) && val(r, '-webkit-user-drag') === 'none';
  const body = uiRules.find(isBody);
  const input = uiRules.find(isInput);
  // (a) the D6 base rules exist in ui.css
  if (!uiRules.some(isHtml)) report(`${UI}|d6:html-text-size-adjust`, UI, 'the D6 html { text-size-adjust: 100% } rule is missing');
  if (!body) report(`${UI}|d6:body`, UI, 'the D6 body rule (user-select/touch-callout/tap-highlight none, touch-action manipulation) is missing');
  if (!uiRules.some(isDrag)) report(`${UI}|d6:no-drag`, UI, 'the D6 img, a, video, svg { user-drag: none } rule is missing');
  if (!input) report(`${UI}|d6:field-reenable`, UI, 'the D6 input, textarea, select, [contenteditable] re-enable rule is missing');
  const selectable = (r) => r.items.every((it) => compoundParts(subjectOf(it)).classes.includes('ui-selectable'));
  // (c) no other user-select / callout / tap-highlight declarations
  const cascade = model.rules.filter((r) => r.decls.some((d) => USER_SELECT.has(d.prop))).sort((a, b) => a.order - b.order);
  for (const r of model.rules) {
    if (r === body || r === input) continue;
    if (r.file === UI && selectable(r)) continue;
    for (const d of r.decls) if (UA_SELECT_PROPS.has(d.prop)) report(ruleKey(r, d.prop), `${r.file}:${d.line}`, `${d.prop}: ${d.value}`);
  }
  for (const d of model.inline) if (UA_SELECT_PROPS.has(d.prop)) report(inlineKey(d), `${d.file}:${d.line}`, `${d.prop}: ${d.value}`);
  // (b) the field re-enable is the LAST user-select rule in cascade order
  if (input && cascade.length && cascade[cascade.length - 1] !== input) {
    report(`${UI}|d6:field-reenable-not-last`, `${UI}:${input.line}`, `a later rule sets user-select: ${cascade.filter((r) => r.order > input.order).map((r) => r.selector).slice(0, 3).join(' / ')}`);
  }
  // (d) contextmenu listeners only in interaction.js; ui-selectable only on the allow-list
  for (const v of model.js) {
    const c = v.code;
    if (v.file !== INTERACTION_JS) {
      for (let i = 0; i < c.length; i++) {
        const t = c[i];
        if (t.type === 'String' && /^['"]contextmenu['"]$/i.test(t.value) && !(c[i - 2] && c[i - 2].value === 'removeEventListener')) report(`${v.file}|contextmenu`, `${v.file}:${t.line}`, 'a contextmenu listener outside interaction.js');
        if (t.type === 'Identifier' && t.value === 'oncontextmenu') report(`${v.file}|contextmenu`, `${v.file}:${t.line}`, 'oncontextmenu outside interaction.js');
      }
    }
    if (!UI_SELECTABLE_FILES.has(v.file)) for (const u of v.units) if (/(?<![\w-])ui-selectable(?![\w-])/.test(u.text)) report(`${v.file}|ui-selectable`, `${v.file}:${u.line}`, 'ui-selectable outside its allow-list');
  }
  for (const h of model.html) {
    for (const m of h.markup.matchAll(/\soncontextmenu\s*=/gi)) report(`${h.file}|contextmenu`, `${h.file}:${h.at(m.index)}`, 'oncontextmenu attribute');
    if (!UI_SELECTABLE_FILES.has(h.file)) for (const m of h.markup.matchAll(/(?<![\w-])ui-selectable(?![\w-])/g)) report(`${h.file}|ui-selectable`, `${h.file}:${h.at(m.index)}`, 'ui-selectable outside its allow-list');
    // D6 pinch zoom: every shell's viewport meta pins the scale
    for (const m of h.markup.matchAll(/<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/gi)) {
      const cm = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(m[0]);
      const content = cm ? cm[1].replace(/\s+/g, '') : '';
      if (!/(^|,)maximum-scale=1(\.0)?(,|$)/.test(content) || !/(^|,)user-scalable=no(,|$)/.test(content)) report(`${h.file}|meta-viewport`, `${h.file}:${h.at(m.index)}`, 'viewport meta without maximum-scale=1, user-scalable=no');
    }
  }
}

const GLYPHS = ['×', '✕', '▶', '★', '☆', '←', '→', '‹', '›', '✓', '⋮', '✎', '♪', '⛶', '⧉', '▴', '▾'];
const GLYPH_RE = new RegExp(`[${GLYPHS.join('')}]`, 'gu');
const ICON_FILES = new Set(['public/js/icons.js']);
const SKIN_FILES = new Set(['public/js/music-skins.js', 'public/js/skin-surface.js', 'public/js/ipod-brick.js']);
const hex = (ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

function detectIcons(model, report) {
  // A sprite reference (<svg ...><use href="#i-NAME"/></svg>, the registry's own output) is
  // allowed; anything that DRAWS (path, circle, rect...) is an inline icon. JS often builds
  // the tag across concatenated literals, so the body is read across the next units.
  const svgScan = (file, text, following, line) => {
    for (const m of text.matchAll(/<svg\b/gi)) {
      let body = text.slice(m.index) + (following ? following() : '');
      const end = body.search(/<\/svg\s*>/i);
      if (end !== -1) body = body.slice(0, end);
      if (/<use\b/i.test(body) && !/<(path|circle|rect|polygon|polyline|line|ellipse|g|image|text|symbol)\b/i.test(body)) continue;
      report(`${file}|<svg>`, `${file}:${line(m.index)}`, 'an inline <svg> outside the icon registry');
    }
  };
  const glyphScan = (file, text, line) => {
    for (const m of text.matchAll(GLYPH_RE)) report(`${file}|glyph|${hex(m[0])}`, `${file}:${line(m.index)}`, `text glyph ${m[0]}`);
  };
  for (const h of model.html) {
    svgScan(h.file, h.markup, null, h.at);
    glyphScan(h.file, decodeEntities(h.markup), h.at);
  }
  for (const v of model.js) {
    if (ICON_FILES.has(v.file) || SKIN_FILES.has(v.file)) continue;
    v.units.forEach((u, i) => {
      svgScan(v.file, u.text, () => v.units.slice(i + 1, i + 4).map((x) => x.text).join(''), () => u.line);
      glyphScan(v.file, u.text, () => u.line);
    });
  }
  for (const r of model.rules) {
    if (!/\.ui-(icon|btn)(?![\w])/.test(r.selector)) continue;
    for (const d of r.decls) if (d.prop === 'vertical-align') report(ruleKey(r, d.prop), `${r.file}:${d.line}`, `vertical-align: ${d.value}`);
  }
}

const LAYOUT_PROP = /^(width|height|(min|max)-(width|height)|(min-|max-)?(inline|block)-size|margin(-[\w-]+)?|padding(-[\w-]+)?|top|right|bottom|left|inset(-[\w-]+)?|grid(-[\w-]+)?|flex(-[\w-]+)?|gap|row-gap|column-gap)$/;

/** The properties a transition value names ('all' when an item names none). null = unknowable (var() only). */
function transitionProps(prop, value) {
  const v = denoise(value);
  if (/^none$/i.test(v)) return [];
  const items = splitTop(v, ',');
  const out = [];
  for (const it of items) {
    const parts = splitTop(it, ' ');
    if (prop.endsWith('transition-property')) { out.push(parts[0] && !/^var\(/.test(parts[0]) ? parts[0].toLowerCase() : null); continue; }
    const named = parts.find((p) => !/^var\(/i.test(p) && !/^-?[\d.]+m?s$/i.test(p) && !/^(cubic-bezier|steps|linear)\(/i.test(p)
      && !/^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete)$/i.test(p));
    if (named) out.push(named.toLowerCase());
    else if (parts.every((p) => /^var\(/i.test(p))) out.push(null);
    else out.push('all');
  }
  return out;
}

function detectNoLayoutTransition(model, report) {
  const check = (prop, value, key, where) => {
    const bare = prop.replace(/^-(webkit|moz|o)-/, '');
    if (bare !== 'transition' && bare !== 'transition-property') return;
    for (const p of transitionProps(bare, value)) {
      if (p === 'all' || (p && LAYOUT_PROP.test(p))) report(key, where, `${prop}: ${value.slice(0, 60)} (${p})`);
    }
  };
  for (const r of model.rules) for (const d of r.decls) check(d.prop, d.value, ruleKey(r, d.prop), `${r.file}:${d.line}`);
  for (const d of model.inline) if (d.value != null) check(d.prop, d.value, inlineKey(d), `${d.file}:${d.line}`);
}

const OVERLAY_CLASS = /(?:^|-)(modal|sheet|backdrop|scrim|overlay|popover|toast|dialog|menu)$/;

function detectZLadder(model, report) {
  const ladder = model.info.ladder;
  const esc = ladder.map((n) => n.replace(/-/g, '\\-')).join('|') || '--z-none';
  const ok = new RegExp(`^(?:var\\((?:${esc})\\)|calc\\(\\s*var\\((?:${esc})\\)\\s*[+-]\\s*\\d+\\s*\\))$`);
  const positioned = (r) => r.decls.some((d) => d.prop === 'position' && /^(-webkit-)?(fixed|sticky)$/i.test(denoise(d.value)));
  const primary = (item) => { const p = compoundParts(subjectOf(item)); return p.classes[0] ? '.' + p.classes[0] : p.ids[0] ? '#' + p.ids[0] : null; };
  const fixedSet = new Set();
  for (const r of model.rules) if (positioned(r)) for (const it of r.items) { const k = primary(it); if (k) fixedSet.add(k); }
  for (const r of model.rules) {
    if (r.atDescriptor) continue;
    const z = r.decls.filter((d) => d.prop === 'z-index');
    if (!z.length) continue;
    const governed = positioned(r) || r.items.some((it) => {
      const k = primary(it);
      const p = compoundParts(subjectOf(it));
      return (k && fixedSet.has(k)) || p.classes.some((c) => OVERLAY_CLASS.test(c));
    });
    if (!governed) continue;
    for (const d of z) {
      const v = denoise(d.value).replace(/\s+/g, ' ');
      if (/^(auto|inherit|initial|unset|revert)$/i.test(v) || ok.test(v)) continue;
      report(ruleKey(r, 'z-index'), `${r.file}:${d.line}`, `z-index: ${d.value}`);
    }
  }
}

function detectDisplayOwnership(model, report) {
  for (const r of model.rules) {
    for (const d of r.decls) {
      if (d.prop !== 'display' || !d.important) continue;
      if (r.file === 'public/css/ui.css' && r.selector === '[hidden]' && r.at.length === 0) continue; // the one global rule
      report(ruleKey(r, 'display'), `${r.file}:${d.line}`, `display: ${d.value} !important`);
    }
  }
  for (const d of model.inline) {
    if (d.origin === 'js-style' && d.prop === 'display') {
      report(`${d.file}|style.display`, `${d.file}:${d.line}`, `style.display = ${d.value == null ? '(expression)' : JSON.stringify(d.value)}`);
    } else if (d.prop === 'display' && d.important) {
      report(inlineKey(d), `${d.file}:${d.line}`, `display: ${d.value} !important`);
    }
  }
}

const STATE_SEL = /:(hover|active|focus|focus-visible|focus-within)(?![\w-])|\[aria-(selected|pressed)\b|\.(active|selected)(?![\w-])/i;
// The D2 red roles, plus the legacy --yt-red pair: until the sweeps split it into
// --accent/--accent-fill, a selected state painted --yt-red is the same D8.8 debt.
const RED_ROLE = /var\(\s*--(accent|accent-fill|danger|indicator|yt-red|yt-red-dark)\s*[,)]/;

function detectColourRoles(model, report) {
  for (const r of model.rules) {
    if (!r.items.some((it) => STATE_SEL.test(it))) continue;
    for (const d of r.decls) {
      if (!RED_ROLE.test(d.value)) continue;
      if (r.file === 'public/css/ui.css' && /^background(-color)?$/.test(d.prop) && r.items.every((it) => /\.ui-btn--primary(?![\w-])/.test(it))) continue;
      report(ruleKey(r, d.prop), `${r.file}:${d.line}`, `${d.prop}: ${d.value.slice(0, 60)}`);
    }
  }
}

function detectNoShellStyle(model, report) {
  for (const h of model.html) {
    for (let i = 0; i < h.styleBlocks; i++) report(`${h.file}|<style>`, h.file, 'a <style> block in a shell');
  }
}

const RULES = [
  { id: 'no-raw-values', on: true, detect: detectNoRawValues },
  { id: 'no-legacy-tokens', on: false, detect: detectNoLegacyTokens }, // OFF until step 7 (aliases deleted)
  { id: 'no-bespoke-controls', on: true, detect: detectNoBespokeControls },
  { id: 'hover-gated', on: true, detect: detectHoverGated },
  { id: 'pressed-state', on: true, detect: detectPressedState },
  { id: 'native-interaction', on: true, detect: detectNativeInteraction },
  { id: 'icons', on: true, detect: detectIcons },
  { id: 'no-layout-transition', on: true, detect: detectNoLayoutTransition },
  { id: 'z-ladder', on: true, detect: detectZLadder },
  { id: 'display-ownership', on: true, detect: detectDisplayOwnership },
  { id: 'colour-roles', on: true, detect: detectColourRoles },
  { id: 'no-shell-style', on: true, detect: detectNoShellStyle },
];
const RULE_IDS = RULES.map((r) => r.id);

/** Run one rule over a model: {keys: Map(key -> count), hits: [{key, where, detail}]}. */
function runRule(rule, model) {
  const keys = new Map();
  const hits = [];
  rule.detect(model, (key, where, detail) => {
    keys.set(key, (keys.get(key) || 0) + 1);
    hits.push({ key, where, detail });
  });
  return { keys, hits };
}

function lintTree(root) {
  const info = tokensInfo(root);
  const model = buildModel(collectSources(root), info);
  const results = {};
  for (const rule of RULES) results[rule.id] = runRule(rule, model);
  return { model, results };
}

// ---------------------------------------------------------------------------------------
// Canaries
// ---------------------------------------------------------------------------------------

function readFixture(file) {
  const text = fs.readFileSync(file, 'utf8');
  const first = text.split('\n', 1)[0];
  const m = /ui-lint-canary:\s*([^*]*?)\s*(?:\*\/|-->|$)/.exec(first);
  const opts = {};
  if (m) for (const kv of m[1].split(/\s+/)) { const [k, v] = kv.split('='); if (k && v != null) opts[k] = v; }
  const ext = path.extname(file).slice(1);
  const kind = ext === 'css' ? 'css' : ext === 'html' ? 'html' : 'js';
  const vpath = opts.path || { css: 'public/css/canary.css', html: 'public/canary.html', js: 'public/js/canary.js' }[kind];
  return { kind, path: vpath, text, expect: opts.expect != null ? Number(opts.expect) : null };
}

/** Run every rule's canary pair. Returns the list of failures ([] = all fire). */
function runCanaries(root) {
  const info = tokensInfo(root);
  const failures = [];
  const dir = path.join(root, FIXTURES_REL);
  for (const rule of RULES) {
    const rdir = path.join(dir, rule.id);
    const files = fs.existsSync(rdir) ? fs.readdirSync(rdir).sort() : [];
    const bad = files.filter((f) => f.startsWith('bad')).map((f) => readFixture(path.join(rdir, f)));
    const good = files.filter((f) => f.startsWith('good')).map((f) => readFixture(path.join(rdir, f)));
    if (!bad.length || !good.length) { failures.push(`${rule.id}: missing canary fixture pair under ${FIXTURES_REL}/${rule.id}/ (bad.* and good.*)`); continue; }
    const expect = bad.reduce((n, f) => n + (f.expect || 0), 0);
    if (bad.some((f) => !(f.expect > 0))) { failures.push(`${rule.id}: every bad fixture must declare expect=N (N > 0) on its first line`); continue; }
    let badHits, goodHits;
    try {
      badHits = runRule(rule, buildModel(bad, info)).hits;
      goodHits = runRule(rule, buildModel(good, info)).hits;
    } catch (e) {
      failures.push(`${rule.id}: the detector threw on its canary: ${e.message}`);
      continue;
    }
    if (badHits.length !== expect) failures.push(`${rule.id}: the bad canary produced ${badHits.length} hit(s), expected exactly ${expect} - the detector is broken`);
    if (goodHits.length !== 0) failures.push(`${rule.id}: the good canary produced ${goodHits.length} hit(s), expected 0 (${goodHits.slice(0, 3).map((h) => h.key + ' ' + h.detail).join('; ')})`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// The exceptions file (plan D10.3)
// ---------------------------------------------------------------------------------------

/** Validate the file's shape. Returns a list of problems ([] = well-formed). */
function validateExceptions(data) {
  const errs = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['the file is not a JSON object'];
  for (const k of Object.keys(data)) if (k !== 'comment' && k !== 'rules') errs.push(`unknown top-level field "${k}"`);
  if (typeof data.comment !== 'string' || !data.comment.trim()) errs.push('"comment" must be a non-empty string');
  if (!data.rules || typeof data.rules !== 'object' || Array.isArray(data.rules)) { errs.push('"rules" must be an object'); return errs; }
  for (const [rule, entries] of Object.entries(data.rules)) {
    if (!RULE_IDS.includes(rule)) { errs.push(`unknown rule "${rule}"`); continue; }
    if (!Array.isArray(entries)) { errs.push(`rules["${rule}"] must be an array`); continue; }
    const seen = new Set();
    entries.forEach((e, i) => {
      const at = `rules["${rule}"][${i}]`;
      if (!e || typeof e !== 'object' || Array.isArray(e)) { errs.push(`${at} must be an object`); return; }
      for (const k of Object.keys(e)) if (!['key', 'count', 'reason', 'added'].includes(k)) errs.push(`${at} has unknown field "${k}"`);
      if (typeof e.key !== 'string' || !e.key) errs.push(`${at}.key must be a non-empty string`);
      else if (seen.has(e.key)) errs.push(`${at}.key "${e.key}" is duplicated`);
      else seen.add(e.key);
      if (!Number.isInteger(e.count) || e.count < 1) errs.push(`${at}.count must be a positive integer`);
      if (typeof e.reason !== 'string' || !e.reason.trim()) errs.push(`${at}.reason must be a non-empty string`);
      if (typeof e.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.added)) errs.push(`${at}.added must be a YYYY-MM-DD date`);
    });
  }
  return errs;
}

/** Live debt vs the file: {over: [...], under: [...]} (both must be empty to pass). */
function compareDebt(results, data) {
  const over = [], under = [];
  for (const rule of RULES) {
    if (!rule.on) continue;
    const live = results[rule.id].keys;
    const allowed = new Map(((data.rules || {})[rule.id] || []).map((e) => [e.key, e.count]));
    for (const [key, n] of live) {
      const a = allowed.get(key) || 0;
      if (n > a) over.push({ rule: rule.id, key, live: n, allowed: a });
    }
    for (const [key, a] of allowed) {
      const n = live.get(key) || 0;
      if (n < a) under.push({ rule: rule.id, key, live: n, allowed: a });
    }
  }
  return { over, under };
}

/**
 * The shrink-only ratchet (test/unit/ui-exceptions-ratchet.test.js): the current file
 * against the merge-base's. A key added, or a count raised, is a problem.
 */
function compareRatchet(base, current) {
  const problems = [];
  const idx = (d) => {
    const m = new Map();
    for (const [rule, entries] of Object.entries((d && d.rules) || {})) for (const e of entries || []) m.set(rule + '\u0000' + e.key, e.count);
    return m;
  };
  const b = idx(base), c = idx(current);
  for (const [k, n] of c) {
    const [rule, key] = k.split('\u0000');
    if (!b.has(k)) problems.push(`${rule}: key added: ${key} (count ${n})`);
    else if (n > b.get(k)) problems.push(`${rule}: count raised: ${key} ${b.get(k)} -> ${n}`);
  }
  return problems;
}

function baselineData(results, today) {
  const rules = {};
  for (const rule of RULES) {
    if (!rule.on) continue;
    rules[rule.id] = [...results[rule.id].keys.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([key, count]) => ({ key, count, reason: 'baseline: debt at step 4, before the sweeps', added: today }));
  }
  return {
    comment: 'Shrink-only ui-lint debt (plan D10.3). Keys are file|selector|property, file|<what> or a class; never line numbers. '
      + 'npm run lint:ui -- --enforce fails on a key or count above its entry AND on one below it: when you pay debt, lower or delete its entry in the same commit. '
      + 'test/unit/ui-exceptions-ratchet.test.js fails on a key added or a count raised against the merge-base. The end state is plan D10.4.',
    rules,
  };
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { enforce: false, writeBaseline: false, shrink: false, canaries: false, verbose: false, root: DEFAULT_ROOT, exceptions: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--enforce') a.enforce = true;
    else if (x === '--write-baseline') a.writeBaseline = true;
    else if (x === '--shrink') { a.shrink = true; a.enforce = true; }
    else if (x === '--canaries') a.canaries = true;
    else if (x === '--verbose') a.verbose = true;
    else if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '--exceptions') a.exceptions = path.resolve(argv[++i]);
    else { a.unknown = x; }
  }
  if (!a.exceptions) a.exceptions = path.join(a.root, EXCEPTIONS_REL);
  return a;
}

function printTable(results, data) {
  const rows = [];
  let total = 0;
  for (const rule of RULES) {
    const live = results[rule.id].keys;
    const n = [...live.values()].reduce((s, x) => s + x, 0);
    if (!rule.on) { rows.push(`  ${rule.id.padEnd(22)} OFF   (would be ${n} across ${live.size} keys)`); continue; }
    total += n;
    let allowedCol = '';
    if (data) {
      const entries = (data.rules || {})[rule.id] || [];
      allowedCol = `  allowed ${String(entries.reduce((s, e) => s + (e.count || 0), 0)).padStart(5)}`;
    }
    rows.push(`  ${rule.id.padEnd(22)} ${String(n).padStart(5)}  (${live.size} keys)${allowedCol}`);
  }
  console.log('  rule                    debt');
  for (const r of rows) console.log(r);
  console.log(`  ${'TOTAL'.padEnd(22)} ${String(total).padStart(5)}`);
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.unknown) { console.error(`ui-lint: unknown argument ${args.unknown}`); return 2; }
  const needCanaries = args.enforce || args.writeBaseline || args.canaries;
  const t0 = Date.now();
  const failures = runCanaries(args.root);
  if (failures.length) {
    const msg = `ui-lint: CANARY FAILURE - ${failures.length} rule(s) did not behave on their known fixtures. The linter is broken; a zero from it proves nothing.\n` + failures.map((f) => '  ' + f).join('\n');
    if (needCanaries) { console.error(msg); return 2; }
    console.error(msg.replace('CANARY FAILURE', 'WARNING (report mode, exit 0): CANARY FAILURE'));
  }
  if (args.canaries) { console.log(`ui-lint: canaries OK (${RULES.length} rules, each bad fixture fired exactly, each good fixture silent)`); return 0; }

  const { model, results } = lintTree(args.root);
  if (model.errors.length) {
    console.error('ui-lint: parse problems (these files are partly unscanned):\n' + model.errors.map((e) => '  ' + e).join('\n'));
    if (args.enforce || args.writeBaseline) return 2;
  }
  const mode = args.enforce ? 'ENFORCING against ' + path.relative(args.root, args.exceptions) : args.writeBaseline ? 'writing the baseline' : 'report';
  console.log(`ui-lint (${mode}) - UI guardrail debt per rule (plan D10.1), ${Date.now() - t0}ms`);

  if (args.writeBaseline) {
    printTable(results, null);
    if (fs.existsSync(args.exceptions)) {
      console.error(`ui-lint: REFUSED - ${args.exceptions} already exists. The baseline is written once; after that the file only shrinks (edit it by hand when you pay debt).`);
      return 1;
    }
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(args.exceptions, JSON.stringify(baselineData(results, today), null, 2) + '\n');
    console.log(`ui-lint: wrote ${args.exceptions}`);
    return 0;
  }

  if (!args.enforce) {
    printTable(results, null);
    if (args.verbose) {
      for (const rule of RULES) {
        const r = results[rule.id];
        if (!r.hits.length) continue;
        console.log(`\n[${rule.id}]${rule.on ? '' : ' (OFF)'}`);
        const first = new Map();
        for (const h of r.hits) if (!first.has(h.key)) first.set(h.key, h);
        for (const [key, n] of r.keys) console.log(`  ${String(n).padStart(4)}  ${key}    (${first.get(key).where}: ${first.get(key).detail})`);
      }
    }
    return 0;
  }

  // --enforce
  if (!fs.existsSync(args.exceptions)) {
    printTable(results, null);
    console.error(`ui-lint: FAIL - ${args.exceptions} does not exist. Generate it once with: node scripts/ui-lint.js --write-baseline`);
    return 1;
  }
  let data;
  try { data = JSON.parse(fs.readFileSync(args.exceptions, 'utf8')); } catch (e) {
    printTable(results, null);
    console.error(`ui-lint: FAIL - ${args.exceptions} is not valid JSON: ${e.message}`);
    return 1;
  }
  const errs = validateExceptions(data);
  if (errs.length) {
    printTable(results, null);
    console.error(`ui-lint: FAIL - ${args.exceptions} is malformed:\n` + errs.slice(0, 20).map((e) => '  ' + e).join('\n'));
    return 1;
  }
  printTable(results, data);
  const off = RULES.filter((r) => !r.on && (data.rules[r.id] || []).length).map((r) => r.id);
  if (off.length) console.log(`  note: entries for OFF rule(s) ${off.join(', ')} are not compared until the rule is on`);
  const { over, under } = compareDebt(results, data);
  if (over.length) {
    console.error(`ui-lint: FAIL - ${over.length} key(s) of NEW debt (above docs/ui-exceptions.json). Fix them; the file never grows:`);
    const firstHit = (rule, key) => results[rule].hits.find((h) => h.key === key);
    for (const o of over.slice(0, 60)) { const h = firstHit(o.rule, o.key); console.error(`  [${o.rule}] ${o.key}  live ${o.live} > allowed ${o.allowed}   (${h.where}: ${h.detail})`); }
    if (over.length > 60) console.error(`  ... and ${over.length - 60} more (--verbose lists every key)`);
  }
  if (under.length) {
    if (!args.shrink) console.error(`ui-lint: FAIL - ${under.length} key(s) of PAID debt: the live count is below the entry. Shrink docs/ui-exceptions.json in this commit: run node scripts/ui-lint.js --shrink (it lowers each count to the live value and deletes an entry at 0):`);
    for (const u of under.slice(0, 60)) console.error(`  [${u.rule}] ${u.key}  live ${u.live} < allowed ${u.allowed}  -> ${u.live === 0 ? 'delete the entry' : 'set count to ' + u.live}`);
    if (under.length > 60) console.error(`  ... and ${under.length - 60} more`);
  }
  if (args.shrink) {
    if (over.length) { console.error('ui-lint: SHRINK REFUSED - fix the new debt above first; nothing was written.'); return 1; }
    if (!under.length) { console.log('ui-lint: nothing to shrink - the live debt equals docs/ui-exceptions.json'); return 0; }
    const live = new Map(under.map((u) => [u.rule + '\u0000' + u.key, u.live]));
    for (const [rule, entries] of Object.entries(data.rules)) {
      data.rules[rule] = entries
        .map((e) => (live.has(rule + '\u0000' + e.key) ? { ...e, count: live.get(rule + '\u0000' + e.key) } : e))
        .filter((e) => e.count > 0);
    }
    fs.writeFileSync(args.exceptions, JSON.stringify(data, null, 2) + '\n');
    const paid = under.reduce((n, u) => n + (u.allowed - u.live), 0);
    console.log(`ui-lint: shrank ${path.relative(args.root, args.exceptions)} - ${under.length} key(s), ${paid} item(s) of debt paid`);
    return 0;
  }
  if (over.length || under.length) return 1;
  console.log('ui-lint: OK - the live debt equals docs/ui-exceptions.json');
  return 0;
}

module.exports = {
  RULES, RULE_IDS, classifyValue, transitionProps, subjectOf, compoundParts, splitTop,
  tokensInfo, collectSources, buildModel, runRule, lintTree, runCanaries,
  validateExceptions, compareDebt, compareRatchet, baselineData, main,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
