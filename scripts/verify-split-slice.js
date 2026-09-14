#!/usr/bin/env node
'use strict';

// Wave 7b of the relational-migration arc (the monolith split): the main
// session's MACHINE check of a slice - never the subagent's prose.
//
//   node scripts/verify-split-slice.js <baseCommit> <treeDir> <group>=<module> [...]
//   (run FROM the checkout - the base is read with `git show` against this repo; the
//   <treeDir> may be a worktree or a git-archive sandbox)
//
// For every top-level `app.<verb>('<path>', ...)` registration in the BASE
// commit's server.js whose path group matches, the statement must appear in
// <module> byte-identical modulo ONE uniform indent level (two spaces on every
// line that is CODE - lines that sit inside a multi-line template literal are
// string CONTENT and must not move; the R1 gate's W1: an indent applied to
// those lines changes the bytes the server emits and the first cut blessed
// it), in the group's original order, and must be gone from the tree's
// server.js. Three more checks: every multi-line string / template literal of
// the moved statements is found byte-identical in the module (an AST literal
// multiset, independent of the indent rule); the tree's server.js still
// exports every name the base exported; and every function the module exports
// under a name server.js also exports is the SAME object through both
// (re-export identity, checked by requiring the tree - the R1 gate's W2: the
// first cut only regex-matched the names while its header claimed identity).
//
// Exit 1 on any failure; the tree is never modified.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const espree = require('espree');

const [base, treeArg, ...maps] = process.argv.slice(2);
if (!base || !treeArg || maps.length === 0) {
  console.error('usage: node scripts/verify-split-slice.js <baseCommit> <treeDir> <group>=<module> [...]');
  process.exit(2);
}
const ROOT = path.join(__dirname, '..');
const tree = path.resolve(treeArg);
const baseSrc = execFileSync('git', ['show', `${base}:server.js`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const newSrc = fs.readFileSync(path.join(tree, 'server.js'), 'utf8');
const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

function parse(src) {
  return espree.parse(src, { ecmaVersion: 'latest', sourceType: 'script', loc: true, range: true });
}
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
function groupKey(route) {
  const segs = route.split('/').filter(Boolean);
  if (segs[0] === 'api') return `/api/${segs[1] || ''}`;
  return `/${segs[0] || ''}`;
}
// Every top-level route registration: its text, its group, and the line
// numbers (relative to the statement) that sit strictly INSIDE a multi-line
// template literal or string (content lines - never re-indented).
function routeStatements(src) {
  const ast = parse(src);
  const out = [];
  for (const st of ast.body) {
    if (st.type !== 'ExpressionStatement' || st.expression.type !== 'CallExpression') continue;
    const c = st.expression.callee;
    if (c.type !== 'MemberExpression' || c.object.type !== 'Identifier' || c.object.name !== 'app' || c.computed || !VERBS.has(c.property.name)) continue;
    const first = st.expression.arguments[0];
    if (!first || first.type !== 'Literal' || typeof first.value !== 'string') continue;
    const contentLines = new Set();
    const literals = [];
    walk(st, (n) => {
      if (n.type === 'TemplateLiteral' || (n.type === 'Literal' && typeof n.value === 'string')) {
        if (n.loc.end.line > n.loc.start.line) {
          literals.push(src.slice(n.range[0], n.range[1]));
          for (let l = n.loc.start.line + 1; l <= n.loc.end.line; l++) contentLines.add(l - st.loc.start.line);
        }
      }
    });
    out.push({ verb: c.property.name, route: first.value, group: groupKey(first.value), text: src.slice(st.range[0], st.range[1]), line: st.loc.start.line, contentLines, literals });
  }
  return out;
}

const baseRoutes = routeStatements(baseSrc);
const newRoutes = routeStatements(newSrc);
let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL ${m}`); };

for (const m of maps) {
  const [group, mod] = m.split('=');
  const modPath = path.join(tree, mod);
  if (!fs.existsSync(modPath)) { fail(`${group}: module ${mod} does not exist in the tree`); continue; }
  const modSrc = fs.readFileSync(modPath, 'utf8');
  const moved = baseRoutes.filter((r) => r.group === group);
  if (moved.length === 0) fail(`${group}: no routes in the base commit`);
  let cursor = 0;
  let verified = 0;
  for (const r of moved) {
    const lines = r.text.split('\n');
    // one indent level on CODE lines only; content lines of a multi-line literal stay put
    const indented = lines.map((l, i) => (l.length && !r.contentLines.has(i) ? `  ${l}` : l)).join('\n');
    const candidates = [r.text, indented];
    let at = -1; let used = null;
    for (const c of candidates) { const i = modSrc.indexOf(c, cursor); if (i !== -1 && (at === -1 || i < at)) { at = i; used = c; } }
    if (at === -1) {
      if (candidates.some((c) => modSrc.includes(c))) fail(`${group} ${r.verb} ${r.route}: present in ${mod} but OUT OF ORDER`);
      else fail(`${group} ${r.verb} ${r.route} (base line ${r.line}): NOT byte-identical (modulo one indent level on code lines) in ${mod}`);
    } else { cursor = at + used.length; verified++; }
    for (const lit of r.literals) {
      if (!modSrc.includes(lit)) fail(`${group} ${r.verb} ${r.route}: a multi-line literal's bytes changed in ${mod} (string content is not code)`);
    }
    if (newSrc.includes(r.text)) fail(`${group} ${r.verb} ${r.route}: statement text still in the tree's server.js`);
  }
  const left = newRoutes.filter((r) => r.group === group);
  if (left.length) fail(`${group}: ${left.length} route(s) still registered in server.js: ${left.map((r) => r.route).join(', ')}`);
  console.log(`${group}: ${verified} of ${moved.length} route statement(s) verified byte-identical + in order in ${mod}; ${moved.reduce((a, r) => a + r.text.split('\n').length, 0)} statement lines; ${moved.reduce((a, r) => a + r.literals.length, 0)} multi-line literal(s) byte-identical`);
}

// ---- exports: the same NAMES, and re-exports the same OBJECTS ------------------------------
// The export NAMES, from the AST (a regex missed method-shorthand entries - gate).
const exportNames = (src) => {
  const ast = parse(src);
  const names = [];
  for (const st of ast.body) {
    if (st.type !== 'ExpressionStatement' || st.expression.type !== 'AssignmentExpression') continue;
    const l = st.expression.left;
    if (l.type !== 'MemberExpression' || l.object.name !== 'module' || l.property.name !== 'exports') continue;
    if (st.expression.right.type !== 'ObjectExpression') continue;
    for (const prop of st.expression.right.properties) {
      if (prop.type === 'Property') names.push(prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value));
    }
  }
  return names;
};
const baseExports = exportNames(baseSrc);
const newExports = exportNames(newSrc);
const missing = baseExports.filter((e) => !newExports.includes(e));
if (missing.length) fail(`exports dropped from server.js: ${missing.join(', ')}`);
else console.log(`exports: all ${baseExports.length} base export names still exported`);

// Identity: require the TREE (a throwaway DATA_DIR - server.js opens the database on require).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-verify-split-'));
process.env.DATA_DIR = dataDir;
process.on('exit', () => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best effort */ } });
const origLog = console.log;
console.log = () => {}; // the boot lines
let server;
try { server = require(path.join(tree, 'server.js')); } finally { console.log = origLog; }
let identityChecks = 0;
for (const m of maps) {
  const mod = require(path.join(tree, m.split('=')[1]));
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== 'function' || !(name in server)) continue;
    identityChecks++;
    if (server[name] !== value) fail(`re-export ${name}: server.js exports a DIFFERENT object than ${m.split('=')[1]}`);
  }
}
console.log(`re-export identity: ${identityChecks} shared function name(s) checked through require()`);
console.log(`server.js lines: base ${baseSrc.split('\n').length - 1} -> tree ${newSrc.split('\n').length - 1}`);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
setTimeout(() => process.exit(failures ? 1 : 0), 50);
