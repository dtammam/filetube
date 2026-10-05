'use strict';

// [UNIT] v1.364.0 W1 (plan 2026-10-05-small-phones-pocket-downloads-vr) - the iOS 15 floor. Dean's iPhone SE
// runs iOS 15.8.5 (the last iOS for it). Every page showed only its frame: the header, the "Listening on"
// card and the bottom bar drew, no view ever did, and the bottom buttons did nothing. Measured in a real
// WebKit 15.4 (Playwright 1.20.2's webkit-1616): "ReferenceError: Can't find variable: viewRegistry" at the
// first registerView. Old JavaScriptCore cannot see a block's const/let/class from a FUNCTION DECLARED IN
// THAT BLOCK when the block is top-level code of a non-strict classic script (same-script calls fail too);
// a strict script, or the block's body inside a function, works. common.js's whole router runtime sat in
// `if (typeof window !== 'undefined') { const viewRegistry ...; function registerView() {...} }`.
//
// The census below fails on any reintroduction, in every classic script the app serves (public/js, the
// /subscriptions client, the service worker, and every inline script of every public/*.html and the
// module-served shell), and its detector is proven able to see the shape (non-vacuity).
// The other iOS 15 census rows (W1 step 1: APIs and CSS) found nothing on a boot path; see the plan's
// build log. acorn ships with eslint's espree (no new dependency).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

// A tiny generic walker (acorn-walk is not a dependency): calls fn on every node under root.
function eachNode(root, fn) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== 'string') continue;
    fn(n);
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') stack.push(c); } else if (v && typeof v.type === 'string') stack.push(v);
    }
  }
}

const ROOT = path.join(__dirname, '..', '..');

// [label, source] for every classic script the browser runs.
function classicScripts() {
  const out = [];
  const jsDir = path.join(ROOT, 'public', 'js');
  for (const f of fs.readdirSync(jsDir).filter((x) => x.endsWith('.js'))) out.push(['public/js/' + f, fs.readFileSync(path.join(jsDir, f), 'utf8')]);
  const cl = path.join(ROOT, 'lib', 'ytdlp', 'client');
  for (const f of fs.readdirSync(cl).filter((x) => x.endsWith('.js'))) out.push(['lib/ytdlp/client/' + f, fs.readFileSync(path.join(cl, f), 'utf8')]);
  out.push(['public/filetube-worker.js', fs.readFileSync(path.join(ROOT, 'public', 'filetube-worker.js'), 'utf8')]);
  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => 'public/' + f)
    .concat(['lib/ytdlp/views/subscriptions.html']);
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
    let m; let i = 0;
    while ((m = re.exec(html))) {
      const attrs = m[1] || '';
      if (/\ssrc\s*=/i.test(attrs) || /\stype\s*=/i.test(attrs) || !m[2].trim()) continue;
      out.push([rel + ' inline #' + (i++), m[2]]);
    }
  }
  return out;
}

function collectIds(p, set) {
  if (!p) return;
  if (p.type === 'Identifier') set.add(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => collectIds(q.value || q.argument, set));
  else if (p.type === 'ArrayPattern') p.elements.forEach((q) => collectIds(q, set));
  else if (p.type === 'RestElement') collectIds(p.argument, set);
  else if (p.type === 'AssignmentPattern') collectIds(p.left, set);
}

// Every function declared in a block of TOP-LEVEL code (never inside a function) of a non-strict script that
// reads a const/let/class of that block or an enclosing top-level block, a let/const of an enclosing loop head,
// or an enclosing catch param. Returns [{ fn, line, uses }].
function blockFunctionHazards(src) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true, allowHashBang: true });
  const first = ast.body[0];
  if (first && first.type === 'ExpressionStatement' && first.directive === 'use strict') return [];
  const hits = [];
  function visit(node, lex) {
    if (!node) return;
    switch (node.type) {
      case 'BlockStatement': {
        const names = new Set(lex);
        for (const s of node.body) {
          if (s.type === 'VariableDeclaration' && s.kind !== 'var') for (const d of s.declarations) collectIds(d.id, names);
          if (s.type === 'ClassDeclaration' && s.id) names.add(s.id.name);
        }
        for (const s of node.body) {
          if (s.type === 'FunctionDeclaration' && names.size) {
            const used = new Set();
            eachNode(s.body, (n) => { if (n.type === 'Identifier' && names.has(n.name)) used.add(n.name); });
            if (used.size) hits.push({ fn: s.id.name, line: s.loc.start.line, uses: [...used] });
          }
          visit(s, names);
        }
        return;
      }
      case 'IfStatement': visit(node.consequent, lex); visit(node.alternate, lex); return;
      case 'TryStatement': {
        visit(node.block, lex);
        if (node.handler) {
          // A catch param binds like a let of the catch block (WebKit 15.4: "Can't find variable: err").
          const names = new Set(lex);
          collectIds(node.handler.param, names);
          visit(node.handler.body, names);
        }
        visit(node.finalizer, lex);
        return;
      }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        // A loop head's let/const binds for the body (WebKit 15.4: "Can't find variable: i").
        const names = new Set(lex);
        const head = node.type === 'ForStatement' ? node.init : node.left;
        if (head && head.type === 'VariableDeclaration' && head.kind !== 'var') for (const d of head.declarations) collectIds(d.id, names);
        visit(node.body, names);
        return;
      }
      case 'WhileStatement': case 'DoWhileStatement': case 'LabeledStatement':
        visit(node.body, lex); return;
      case 'SwitchStatement': for (const c of node.cases) visit({ type: 'BlockStatement', body: c.consequent }, lex); return;
      default: return; // a function, class or expression body is not top-level block code
    }
  }
  for (const s of ast.body) visit(s, new Set());
  return hits;
}

const SCRIPTS = classicScripts();

test('the census reads every classic script (a rename or a move cannot empty it)', () => {
  const labels = SCRIPTS.map((s) => s[0]);
  const jsCount = labels.filter((l) => l.startsWith('public/js/')).length;
  assert.ok(jsCount >= 25, 'public/js files: ' + jsCount);
  for (const must of ['public/js/common.js', 'public/js/main.js', 'public/js/music.js', 'public/js/player.js', 'lib/ytdlp/client/subscriptions.js', 'public/filetube-worker.js']) {
    assert.ok(labels.includes(must), must);
  }
  assert.ok(labels.filter((l) => l.includes(' inline #')).length >= 30, 'inline scripts: ' + labels.filter((l) => l.includes(' inline #')).length);
});

test('every classic script parses at ES2021 (iOS 15 has no ES2022 class fields, static blocks or top-level await)', () => {
  for (const [label, src] of SCRIPTS) {
    assert.doesNotThrow(() => acorn.parse(src, { ecmaVersion: 2021, sourceType: 'script', allowHashBang: true }), label);
  }
});

test('the detector sees the iOS 15 shape (non-vacuity), in each block kind, and passes the shapes that work', () => {
  const bad = [
    "if (true) { const a = 1; function f() { return a; } }",
    "if (x) {} else { let a = 1; function f() { return a; } }",
    "try { const a = 1; function f() { return a; } } catch (_) {}",
    "{ class C {} function f() { return C; } }",
    "if (true) { const a = 1; if (y) { function f() { return a; } } }",
    "switch (k) { case 1: const a = 1; function f() { return a; } }",
    "for (let i = 0; i < 1; i++) { function f() { return i; } }",
    "for (const k in o) { function f() { return k; } }",
    "for (const { v } of list) { function f() { return v; } }",
    "try { throw 5; } catch (err) { function f() { return err; } }",
    "try {} catch ({ message }) { function f() { return message; } }",
  ];
  for (const s of bad) assert.strictEqual(blockFunctionHazards(s).length, 1, s);
  const ok = [
    "'use strict'; if (true) { const a = 1; function f() { return a; } }",
    "if (true) { (function () { const a = 1; function f() { return a; } })(); }",
    "if (true) { var a = 1; function f() { return a; } }",
    "if (true) { const a = 1; function f() { return 2; } }",
    "function outer() { if (true) { const a = 1; function f() { return a; } } }",
    "const a = 1; function f() { return a; }",
    "for (var i = 0; i < 1; i++) { function f() { return i; } }",
    "try {} catch (err) { function f() { return 1; } }",
    "try {} catch { function f() { return 1; } }",
  ];
  for (const s of ok) assert.deepStrictEqual(blockFunctionHazards(s), [], s);
});

test('no classic script declares a function in a top-level block that reads the block\'s const/let/class (iOS 15 cannot resolve it)', () => {
  const found = [];
  for (const [label, src] of SCRIPTS) {
    for (const h of blockFunctionHazards(src)) found.push(label + ':' + h.line + ' ' + h.fn + ' reads ' + h.uses.join(', '));
  }
  assert.deepStrictEqual(found, [], 'iOS 15 throws "Can\'t find variable" for these. Put the block body inside a function (see common.js routerRuntime):\n' + found.join('\n'));
});

test('common.js: the router runtime runs inside routerRuntime(), and registers the views from there', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true });
  let fnNode = null;
  eachNode(ast, (n) => { if (n.type === 'FunctionExpression' && n.id && n.id.name === 'routerRuntime') fnNode = n; });
  assert.ok(fnNode, 'the routerRuntime function exists');
  const names = fnNode.body.body.filter((s) => s.type === 'FunctionDeclaration').map((s) => s.id.name);
  for (const n of ['registerView', 'bootRouter', 'navigate', 'wireSwipeBack']) assert.ok(names.includes(n), n + ' is declared inside routerRuntime');
});
