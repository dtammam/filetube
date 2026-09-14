'use strict';

// Relational-migration arc (Waves 4-5): the MACHINE-DERIVED consumer census
// the exec plan's per-namespace numbers come from. Counts CODE references
// (comments stripped) to each still-legacy namespace in server.js and lib/,
// plus the test blast radius (files whose fixtures carry the key, and files
// that read it back off loadDatabase()/getCachedDatabase()/readPersisted...).
//
//   node scripts/relational-arc-refs.js            # table
//   node scripts/relational-arc-refs.js --json     # machine form
//
// The regex deliberately names the doc-object spellings the codebase uses
// (db / freshDb / fresh / current / state / snapshot / cached / next / prev)
// and, for container sub-keys, the `ns.` spelling the feature stores use
// after an ensure*/read* call. It is a CENSUS, not a linter: a hit is a site
// to visit, and the rewrite's own source locks are the net afterwards.

const fs = require('node:fs');
const path = require('node:path');
const { DOC_KV_NAMESPACES, SINGLETON_NAMES } = require('../lib/db/sqlite');

const ROOT = path.join(__dirname, '..');
// Every spelling the codebase gives the doc object (the v1.294 gate lesson:
// `cachedForBooks`, `cached`, `mdb` were holders the first list missed).
const HOLDERS = '(?:db|freshDb|fresh|current|state|snapshot|cached\\w*|mdb|next|prev|loaded|persisted|getCachedDatabase\\(\\)|loadDatabase\\(\\))';

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:\\])\/\/.*$/, '$1')).join('\n');
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'vendor') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function count(re, text) {
  const m = text.match(re);
  return m ? m.length : 0;
}

function census() {
  const namespaces = [...SINGLETON_NAMES, ...DOC_KV_NAMESPACES];
  const server = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  const libFiles = walk(path.join(ROOT, 'lib')).map((p) => [path.relative(ROOT, p), stripComments(fs.readFileSync(p, 'utf8'))]);
  const testFiles = walk(path.join(ROOT, 'test')).map((p) => [path.relative(ROOT, p), fs.readFileSync(p, 'utf8')]);
  const rows = [];
  for (const ns of namespaces) {
    const [top, sub] = ns.split('.');
    // A container sub-key is spelled `db.books.items` anywhere, or `ns.items`
    // / `books.items` INSIDE the feature's own lib/<top>/ (after an
    // ensureBooks/readBooks call); a top-level key is spelled `db.folders`.
    const re = sub
      ? new RegExp(`\\b${HOLDERS}\\.${top}\\.${sub}\\b`, 'g')
      : new RegExp(`\\b${HOLDERS}\\.${ns}\\b`, 'g');
    const ownRe = sub ? new RegExp(`\\b(?:ns|${top}|${top}Ns)\\.${sub}\\b`, 'g') : null;
    const perLib = libFiles
      .map(([f, t]) => [f, count(re, t) + (ownRe && f.startsWith(`lib/${top}/`) ? count(ownRe, t) : 0)])
      .filter(([, n]) => n > 0);
    const fixtureKey = sub ? sub : ns;
    const fixtureRe = new RegExp(`(^|[{,\\s])${fixtureKey}\\s*:`, 'm');
    const readRe = sub
      ? new RegExp(`(loadDatabase|getCachedDatabase|readPersistedDatabase)\\([^)]*\\)\\.${top}\\.${sub}\\b`)
      : new RegExp(`(loadDatabase|getCachedDatabase|readPersistedDatabase)\\([^)]*\\)\\.${ns}\\b`);
    rows.push({
      namespace: ns,
      server: count(re, server),
      lib: perLib.reduce((a, [, n]) => a + n, 0),
      libFiles: perLib,
      testFixtureFiles: sub ? null : testFiles.filter(([, t]) => fixtureRe.test(t)).length,
      testReadFiles: testFiles.filter(([, t]) => readRe.test(t)).length,
    });
  }
  return rows;
}

if (require.main === module) {
  const rows = census();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log('namespace'.padEnd(26), 'server'.padStart(7), 'lib'.padStart(5), 'fixtureFiles'.padStart(13), 'readFiles'.padStart(10));
    for (const r of rows) {
      console.log(r.namespace.padEnd(26), String(r.server).padStart(7), String(r.lib).padStart(5), String(r.testFixtureFiles === null ? '-' : r.testFixtureFiles).padStart(13), String(r.testReadFiles).padStart(10));
    }
    const tot = rows.reduce((a, r) => ({ server: a.server + r.server, lib: a.lib + r.lib }), { server: 0, lib: 0 });
    console.log('TOTAL'.padEnd(26), String(tot.server).padStart(7), String(tot.lib).padStart(5));
  }
}

module.exports = { census };
