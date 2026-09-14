#!/usr/bin/env node
'use strict';

// Wave 7b of the relational-migration arc (the monolith split): the
// MACHINE-DERIVED census the split's slice plan rests on
// (docs/exec-plans/active/2026-09-13-sqlite-relational-migration.md, Wave 7b).
// Parses server.js (espree - eslint's own parser, already a dev dependency),
// and reports, per top-level statement:
//   - what it is (a route registration `app.<verb>(path, ...)`, a top-level
//     function, a module-scope declaration, a require, other),
//   - how many lines it spans,
//   - which MODULE-SCOPE identifiers it references - the deps surface a
//     router module would need handed in through `registerRoutes(app, deps)`
//     (the lib/ytdlp + lib/podcasts pattern).
// Route registrations are grouped by their path's first two segments so a
// slice ("the /api/books router") is a measured line count with a measured
// deps list, never a hand estimate. Reference counting is by NAME and is
// scope-unaware (a local shadowing a module-scope name over-counts) - a
// census, not a linter: a listed dep is a name to visit.
//
//   node scripts/monolith-split-census.js            # table
//   node scripts/monolith-split-census.js --json     # machine form
//   node scripts/monolith-split-census.js --group /api/books   # one group's deps

const fs = require('node:fs');
const path = require('node:path');
const espree = require('espree');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ast = espree.parse(SRC, { ecmaVersion: 'latest', sourceType: 'script', loc: true, range: true });

// ---- module-scope names ------------------------------------------------------------------
function patternNames(p, out) {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.push(p.name); break;
    case 'ObjectPattern': for (const prop of p.properties) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out); break;
    case 'ArrayPattern': for (const el of p.elements) patternNames(el, out); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
    case 'RestElement': patternNames(p.argument, out); break;
    default: break;
  }
  return out;
}
const moduleScope = new Set();
for (const st of ast.body) {
  if (st.type === 'VariableDeclaration') for (const d of st.declarations) patternNames(d.id, [] ).forEach((n) => moduleScope.add(n));
  else if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') moduleScope.add(st.id.name);
}

// ---- walk ---------------------------------------------------------------------------------
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
function refs(node, selfNames = new Set()) {
  const out = new Set();
  walk(node, (n) => {
    if (n.type === 'Identifier' && moduleScope.has(n.name) && !selfNames.has(n.name)) out.add(n.name);
  });
  // property keys are not references: drop names that only appear as non-computed member properties
  const propsOnly = new Set();
  walk(node, (n) => {
    if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') propsOnly.add(n.property.name);
    if (n.type === 'Property' && !n.computed && n.key.type === 'Identifier' && !n.shorthand) propsOnly.add(n.key.name);
  });
  const real = new Set();
  walk(node, (n) => {
    if (n.type !== 'Identifier' || !out.has(n.name)) return;
    real.add(n.name);
  });
  return [...real].filter((name) => {
    // keep a name if it occurs at least once NOT as a member property / object key
    let plain = 0;
    walk(node, (n) => {
      if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && n.property.name === name) return;
      if (n.type === 'Identifier' && n.name === name) plain++;
    });
    // the walk above still counts the property identifier node itself; subtract those
    let asProp = 0;
    walk(node, (n) => {
      if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && n.property.name === name) asProp++;
      if (n.type === 'Property' && !n.computed && !n.shorthand && n.key.type === 'Identifier' && n.key.name === name) asProp++;
    });
    return plain - asProp > 0;
  }).sort();
}

// ---- classify top-level statements -----------------------------------------------------------
const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);
function classify(st) {
  const lines = st.loc.end.line - st.loc.start.line + 1;
  if (st.type === 'FunctionDeclaration') return { kind: 'function', name: st.id.name, lines, deps: refs(st, new Set([st.id.name])) };
  if (st.type === 'ClassDeclaration') return { kind: 'class', name: st.id.name, lines, deps: refs(st, new Set([st.id.name])) };
  if (st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression') {
    const c = st.expression.callee;
    if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'app' && !c.computed && VERBS.has(c.property.name)) {
      const first = st.expression.arguments[0];
      const route = first && first.type === 'Literal' && typeof first.value === 'string' ? first.value : (first && first.type === 'Identifier' ? `<${first.name}>` : '<dynamic>');
      return { kind: 'route', verb: c.property.name, route, lines, deps: refs(st).filter((d) => d !== 'app') };
    }
    if (c.type === 'MemberExpression' && c.property.type === 'Identifier' && c.property.name === 'registerRoutes') {
      return { kind: 'registerRoutes', name: SRC.slice(c.range[0], c.range[1]), lines, deps: refs(st).filter((d) => d !== 'app') };
    }
  }
  if (st.type === 'VariableDeclaration') {
    const names = st.declarations.flatMap((d) => patternNames(d.id, []));
    const isRequire = st.declarations.some((d) => d.init && d.init.type === 'CallExpression' && d.init.callee.type === 'Identifier' && d.init.callee.name === 'require')
      || st.declarations.some((d) => d.init && d.init.type === 'MemberExpression' && d.init.object.type === 'CallExpression' && d.init.object.callee.name === 'require');
    return { kind: isRequire ? 'require' : 'declaration', name: names.join(','), lines, deps: refs(st, new Set(names)) };
  }
  return { kind: 'other', name: st.type, lines, deps: refs(st) };
}
const items = ast.body.map((st) => ({ line: st.loc.start.line, ...classify(st) }));

// ---- groups ---------------------------------------------------------------------------------
function groupKey(route) {
  if (route.startsWith('<')) return route;
  const segs = route.split('/').filter(Boolean);
  if (segs[0] === 'api') return `/api/${segs[1] || ''}`;
  return `/${segs[0] || ''}`;
}
const groups = new Map();
for (const it of items.filter((x) => x.kind === 'route')) {
  const k = groupKey(it.route);
  const g = groups.get(k) || { group: k, routes: 0, lines: 0, deps: new Set() };
  g.routes++; g.lines += it.lines; it.deps.forEach((d) => g.deps.add(d));
  groups.set(k, g);
}
const groupRows = [...groups.values()].map((g) => ({ ...g, deps: [...g.deps].sort() })).sort((a, b) => b.lines - a.lines);
const functions = items.filter((x) => x.kind === 'function').sort((a, b) => b.lines - a.lines);
const totals = {
  serverLines: SRC.split('\n').length - 1,
  topLevelStatements: items.length,
  routeRegistrations: items.filter((x) => x.kind === 'route').length,
  routeLines: items.filter((x) => x.kind === 'route').reduce((a, b) => a + b.lines, 0),
  functionCount: functions.length,
  functionLines: functions.reduce((a, b) => a + b.lines, 0),
  requireLines: items.filter((x) => x.kind === 'require').reduce((a, b) => a + b.lines, 0),
  declarationLines: items.filter((x) => x.kind === 'declaration').reduce((a, b) => a + b.lines, 0),
  otherLines: items.filter((x) => x.kind === 'other' || x.kind === 'registerRoutes' || x.kind === 'class').reduce((a, b) => a + b.lines, 0),
  moduleScopeNames: moduleScope.size,
};

const argv = process.argv.slice(2);
if (argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ totals, groups: groupRows, functions }, null, 2)}\n`);
} else if (argv.includes('--group')) {
  const want = argv[argv.indexOf('--group') + 1];
  const g = groupRows.find((x) => x.group === want);
  if (!g) { console.error(`no group ${want}`); process.exit(1); }
  process.stdout.write(`${g.group}: ${g.routes} routes, ${g.lines} lines\ndeps (${g.deps.length}):\n  ${g.deps.join('\n  ')}\n`);
} else {
  process.stdout.write(`${Object.entries(totals).map(([k, v]) => `${k.padEnd(22)} ${v}`).join('\n')}\n\n`);
  process.stdout.write('route groups (lines / routes / distinct module-scope deps):\n');
  for (const g of groupRows) process.stdout.write(`  ${g.group.padEnd(22)} ${String(g.lines).padStart(5)} ${String(g.routes).padStart(3)} ${String(g.deps.length).padStart(4)}\n`);
  process.stdout.write('\ntop-level functions over 60 lines (lines / deps):\n');
  for (const f of functions.filter((x) => x.lines > 60)) process.stdout.write(`  ${f.name.padEnd(40)} ${String(f.lines).padStart(5)} ${String(f.deps.length).padStart(4)}  @${f.line}\n`);
}
