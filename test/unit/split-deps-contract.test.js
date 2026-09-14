'use strict';

// [UNIT] Wave 7b R2 gate (adversarial S3): the split hands every extracted
// module its collaborators through an explicit deps object at the call site,
// and the module destructures exactly the names it uses. Nothing bound that
// contract: dropping `probeTvEpisode,` from a call site left the tv suites
// green because the destructured name became `undefined` and, on a box
// without ffmpeg, that is indistinguishable from the supported "probe
// omitted" mode - the v1.185 inert-feature class. This binds, for EVERY
// `<module>.<fn>(app?, { ... })` call in server.js whose module is one of the
// split's extracted files: the set of literal keys at the call site equals the
// set of names the function destructures from `deps`. Both directions: a key
// passed but never destructured is dead weight (or a typo); a name destructured
// but never passed is `undefined` at runtime.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const espree = require('espree');
const { routeModulePaths } = require('../helpers/route-surface');

const ROOT = path.join(__dirname, '..', '..');
const parse = (src) => espree.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'parent') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn));
    else if (v && typeof v.type === 'string') walk(v, fn);
  }
}

// server.js: `const X = require('./lib/...')` bindings -> module path; then every
// call `X.fn(<args>)` whose LAST argument is an object literal.
function callSites(serverSrc) {
  const ast = parse(serverSrc);
  const bindings = new Map();
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init && n.init.type === 'CallExpression'
      && n.init.callee.type === 'Identifier' && n.init.callee.name === 'require' && n.init.arguments[0] && typeof n.init.arguments[0].value === 'string'
      && n.init.arguments[0].value.startsWith('./lib/')) {
      bindings.set(n.id.name, `${n.init.arguments[0].value.slice(2)}.js`);
    }
  });
  const sites = [];
  walk(ast, (n) => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' || n.callee.object.type !== 'Identifier' || n.callee.computed) return;
    const mod = bindings.get(n.callee.object.name);
    if (!mod) return;
    const last = n.arguments[n.arguments.length - 1];
    if (!last || last.type !== 'ObjectExpression') return;
    const keys = [];
    let spread = false;
    for (const p of last.properties) {
      if (p.type === 'SpreadElement') { spread = true; continue; }
      keys.push(p.key.type === 'Identifier' ? p.key.name : String(p.key.value));
    }
    sites.push({ module: mod, fn: n.callee.property.name, keys: keys.sort(), spread });
  });
  return sites;
}

// the module: the names `function fn(...)` destructures from its `deps` parameter
// (a `const { a, b } = deps;` anywhere in the body, incl. nested register calls)
function destructured(modSrc, fn) {
  const ast = parse(modSrc);
  let names = null;
  walk(ast, (n) => {
    if (n.type !== 'FunctionDeclaration' || !n.id || n.id.name !== fn) return;
    const found = [];
    walk(n.body, (m) => {
      if (m.type === 'VariableDeclarator' && m.id.type === 'ObjectPattern' && m.init && m.init.type === 'Identifier' && m.init.name === 'deps') {
        for (const p of m.id.properties) if (p.type === 'Property') found.push(p.key.type === 'Identifier' ? p.key.name : String(p.key.value));
      }
    });
    names = found.sort();
  });
  return names;
}

test('every call into an extracted module passes exactly the deps the function destructures (both directions, every register/factory call)', () => {
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const extracted = new Set(routeModulePaths());
  const sites = callSites(serverSrc).filter((s) => extracted.has(s.module));
  assert.ok(sites.length >= 20, `sanity: the split's call sites are real (${sites.length})`);
  const problems = [];
  for (const s of sites) {
    if (s.spread) { problems.push(`${s.module} ${s.fn}: the call site spreads another object - the contract cannot be read statically`); continue; }
    const modSrc = fs.readFileSync(path.join(ROOT, s.module), 'utf8');
    const want = destructured(modSrc, s.fn);
    if (!want) { problems.push(`${s.module}: no function ${s.fn} destructuring deps`); continue; }
    const missing = want.filter((k) => !s.keys.includes(k));
    const extra = s.keys.filter((k) => !want.includes(k));
    if (missing.length) problems.push(`${s.module} ${s.fn}: destructured but NOT passed (undefined at runtime): ${missing.join(', ')}`);
    if (extra.length) problems.push(`${s.module} ${s.fn}: passed but never destructured: ${extra.join(', ')}`);
  }
  assert.deepStrictEqual(problems, [], `deps contract violations:\n  ${problems.join('\n  ')}`);
});
