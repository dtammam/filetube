#!/usr/bin/env node
'use strict';
// Wave 7b R3: the FUNCTION-move verifier (the main session's machine check for the giant
// extractions; the route verifier is scripts/verify-split-slice.js).
//   node scripts/verify-split-functions.js <baseCommit> <treeDir> <fnName>=<module> [...]
// (run from the main checkout - the base is read with `git show` against this repo)
// For each named top-level function declaration in the BASE server.js: its full text must
// appear in <module> byte-identical modulo ONE uniform indent level on CODE lines (lines
// strictly inside a multi-line template/string literal stay put), every multi-line literal
// must be byte-identical, the declaration must be GONE from the tree's server.js, and if the
// base server.js exported the name, the tree's server.js must export the SAME object the
// module's factory hands back (checked by requiring the tree and comparing every exported
// function of the module's factory result is impossible generically - so the check is:
// require(tree/server)[name] is a function AND its source text equals the base function's
// body text modulo indent).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const espree = require('espree');

const [base, treeArg, ...maps] = process.argv.slice(2);
if (!base || !treeArg || maps.length === 0) { console.error('usage'); process.exit(2); }
const ROOT = path.join(__dirname, '..');
const tree = path.resolve(treeArg);
const baseSrc = execFileSync('git', ['show', `${base}:server.js`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const newSrc = fs.readFileSync(path.join(tree, 'server.js'), 'utf8');
const parse = (src) => espree.parse(src, { ecmaVersion: 'latest', sourceType: 'script', loc: true, range: true });
function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn));
    else if (v && typeof v.type === 'string') walk(v, fn);
  }
}
function topFunctions(src) {
  const out = new Map();
  for (const st of parse(src).body) {
    if (st.type !== 'FunctionDeclaration') continue;
    const contentLines = new Set(); const literals = [];
    walk(st, (n) => {
      if ((n.type === 'TemplateLiteral' || (n.type === 'Literal' && typeof n.value === 'string')) && n.loc.end.line > n.loc.start.line) {
        literals.push(src.slice(n.range[0], n.range[1]));
        for (let l = n.loc.start.line + 1; l <= n.loc.end.line; l++) contentLines.add(l - st.loc.start.line);
      }
    });
    out.set(st.id.name, { text: src.slice(st.range[0], st.range[1]), line: st.loc.start.line, contentLines, literals });
  }
  return out;
}
const baseFns = topFunctions(baseSrc);
const newFns = topFunctions(newSrc);
const exportNames = (src) => {
  const names = [];
  for (const st of parse(src).body) {
    if (st.type !== 'ExpressionStatement' || st.expression.type !== 'AssignmentExpression') continue;
    const l = st.expression.left;
    if (l.type !== 'MemberExpression' || l.object.name !== 'module' || l.property.name !== 'exports' || st.expression.right.type !== 'ObjectExpression') continue;
    for (const p of st.expression.right.properties) if (p.type === 'Property') names.push(p.key.name || String(p.key.value));
  }
  return names;
};
const baseExports = new Set(exportNames(baseSrc));
let failures = 0; const fail = (m) => { failures++; console.log(`FAIL ${m}`); };
const modSources = new Map();
for (const m of maps) {
  const [name, mod] = m.split('=');
  const f = baseFns.get(name);
  if (!f) { fail(`${name}: not a top-level function in the base`); continue; }
  if (!modSources.has(mod)) {
    const mp = path.join(tree, mod);
    if (!fs.existsSync(mp)) { fail(`${name}: module ${mod} does not exist in the tree`); continue; }
    modSources.set(mod, fs.readFileSync(mp, 'utf8'));
  }
  const modSrc = modSources.get(mod);
  const lines = f.text.split('\n');
  const indented = lines.map((l, i) => (l.length && !f.contentLines.has(i) ? `  ${l}` : l)).join('\n');
  const ok = modSrc.includes(f.text) || modSrc.includes(indented);
  if (!ok) fail(`${name} (base line ${f.line}, ${lines.length} lines): NOT byte-identical (modulo one indent level on code lines) in ${mod}`);
  for (const lit of f.literals) if (!modSrc.includes(lit)) fail(`${name}: a multi-line literal's bytes changed in ${mod}`);
  if (newFns.has(name)) fail(`${name}: still declared at top level in the tree's server.js`);
  console.log(`${name}: ${ok ? 'byte-identical' : 'DIFFERS'} in ${mod} (${lines.length} lines, ${f.literals.length} multi-line literal(s)); ${baseExports.has(name) ? 'exported by base server.js' : 'not exported'}`);
}
// re-export identity: require the tree, compare each exported moved function's SOURCE to the base text (modulo indent)
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-verify-fn-'));
process.env.DATA_DIR = dataDir;
process.on('exit', () => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best effort */ } });
const origLog = console.log; console.log = () => {};
let server; try { server = require(path.join(tree, 'server.js')); } finally { console.log = origLog; }
for (const m of maps) {
  const [name] = m.split('=');
  if (!baseExports.has(name)) continue;
  const f = baseFns.get(name); if (!f) continue;
  const exported = server[name];
  if (typeof exported !== 'function') { fail(`${name}: base exported it; the tree's server.js export is ${typeof exported}`); continue; }
  const norm = (s) => s.split('\n').map((l) => l.trimEnd()).join('\n');
  const src = norm(exported.toString());
  // Function.prototype.toString() never carries the declaration's OWN leading indent, so a
  // function declared at indent 2 inside a factory reads back with its first line unindented
  // and every continuation CODE line two spaces deeper (S5 caught the first cut expecting all lines indented).
  const want = norm(f.text); const wantIndented = norm(f.text.split('\n').map((l, i) => (i > 0 && l.length && !f.contentLines.has(i) ? `  ${l}` : l)).join('\n'));
  if (src !== want && src !== wantIndented) fail(`${name}: the object server.js exports is NOT the moved function (source differs - a wrapper or a stale copy)`);
  else console.log(`re-export ${name}: server.js exports the moved function itself (source-identical)`);
}
console.log(`server.js lines: base ${baseSrc.split('\n').length - 1} -> tree ${newSrc.split('\n').length - 1}`);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
setTimeout(() => process.exit(failures ? 1 : 0), 50);
