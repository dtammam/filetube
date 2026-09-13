#!/usr/bin/env node
'use strict';

// Re-derives the machine-derived baseline of the relational-migration arc
// (docs/exec-plans/active/2026-09-13-sqlite-relational-migration.md, Section 1)
// so every wave commit re-verifies the plan's predictions with the SAME
// commands, never a hand count. Prints one JSON object; pass --pretty for a
// table. Read-only: touches no data.
//
//   node scripts/relational-arc-baseline.js [--pretty]
//
// The comment-debt floor (genuine markers = 0) is not a number this script
// derives - it is ENFORCED by test/unit/comment-debt-census.test.js and
// eslint's no-warning-comments rule; run `npm run test:unit` / `npm run lint`.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const serverLines = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').split('\n').length - 1;

const sqlite = require(path.join(ROOT, 'lib', 'db', 'sqlite.js'));
const docKv = sqlite.DOC_KV_NAMESPACES.length;
const docSingle = sqlite.SINGLETON_NAMES.length;

// The instrument excludes itself: its own comments and labels name db.json,
// and an instrument that counts itself can never reach the Wave 7 target of 0
// (Wave 0 slim gate, WARNING 3).
const SELF = path.relative(ROOT, __filename);
const shippedJs = git(['ls-files', '*.js']).split('\n').filter(Boolean)
  .filter((p) => !/(^|\/)(vendor|node_modules)\//.test(p) && !p.startsWith('test/') && p !== SELF);
const dbJsonRefFiles = shippedJs.filter((p) => /db\.json/.test(fs.readFileSync(path.join(ROOT, p), 'utf8')));

const testFiles = git(['ls-files', 'test/*.js']).split('\n').filter(Boolean);
let testCases = 0;
for (const p of testFiles) {
  const m = fs.readFileSync(path.join(ROOT, p), 'utf8').match(/^\s*(test|it)\(/gm);
  testCases += m ? m.length : 0;
}

const schemaVersion = sqlite.SCHEMA_VERSION;
const head = git(['rev-parse', '--short', 'HEAD']).trim();

const out = {
  head,
  schemaVersion,
  serverLines,
  docKvNamespaces: docKv,
  docSingleNamespaces: docSingle,
  legacyNamespaces: docKv + docSingle,
  dbJsonRefFiles: dbJsonRefFiles.length,
  dbJsonRefFileList: dbJsonRefFiles,
  testCases,
  testFiles: testFiles.length,
  testCasesPerFile: Number((testCases / testFiles.length).toFixed(2)),
};

if (process.argv.includes('--pretty')) {
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) continue;
    process.stdout.write(`${k.padEnd(22)} ${v}\n`);
  }
  process.stdout.write(`db.json ref files:\n  ${dbJsonRefFiles.join('\n  ')}\n`);
} else {
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
