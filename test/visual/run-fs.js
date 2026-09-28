'use strict';
// The two filesystem writes test/visual/run.js makes, kept here so a unit test can drive them
// on temp dirs (gate r1, qa 4 and NOTE 9: tooling that deletes paths gets the "I cannot lose
// data" guard).
//
// prepareOutDir(out): run.js empties --out before every run. It refuses (throws) unless the
// directory is absent, empty, or one run.js made before (it carries OUT_MARKER), and it never
// touches /, the repo root, $HOME or any ancestor of those two, marker or not. The same shape
// as seed.js's wipe guard for --data.
//
// replaceBaselines(baselines, shots, inScope): --update writes the captured shots as the new
// baselines. A full run (no --era/--only filter) replaces the whole set, so a scene that no
// longer exists drops out; a filtered run replaces ONLY the baselines inside its filter
// (inScope) and leaves every other baseline as it was.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT_MARKER = '.filetube-visual-run';
const REPO = path.resolve(__dirname, '..', '..');

function isSameOrAncestor(dir, of) {
  const rel = path.relative(dir, of);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Returns null when `out` may be emptied, else the reason it may not.
function outDirRefusal(out, { repo = REPO, home = os.homedir() } = {}) {
  const dir = path.resolve(out);
  if (dir === path.parse(dir).root) return `${dir} is a filesystem root`;
  for (const [name, p] of [['the repo root', repo], ['$HOME', home]]) {
    if (p && isSameOrAncestor(dir, path.resolve(p))) return `${dir} is ${name} or contains it (${p})`;
  }
  if (!fs.existsSync(dir)) return null;
  if (!fs.statSync(dir).isDirectory()) return `${dir} exists and is not a directory`;
  const entries = fs.readdirSync(dir);
  if (entries.length && !entries.includes(OUT_MARKER)) return `${dir} is not empty and was not made by run.js (no ${OUT_MARKER})`;
  return null;
}

function prepareOutDir(out, opts) {
  const why = outDirRefusal(out, opts);
  if (why) throw new Error(`visual: refusing to empty --out: ${why}`);
  const dir = path.resolve(out);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, OUT_MARKER), 'made by test/visual/run.js; emptied on every run\n');
  return dir;
}

const pngs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : []);

// inScope: null for a full run, else a predicate over a baseline file name.
function replaceBaselines(baselines, shots, inScope) {
  fs.mkdirSync(baselines, { recursive: true });
  let removed = 0;
  for (const f of pngs(baselines)) {
    if (inScope && !inScope(f)) continue;
    fs.unlinkSync(path.join(baselines, f));
    removed++;
  }
  const written = pngs(shots);
  for (const f of written) fs.copyFileSync(path.join(shots, f), path.join(baselines, f));
  return { removed, written: written.length, total: pngs(baselines).length };
}

module.exports = { OUT_MARKER, outDirRefusal, prepareOutDir, replaceBaselines, pngs };
