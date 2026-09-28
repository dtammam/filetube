#!/usr/bin/env node
'use strict';
// Fetches the registry's Material Symbols sources (Apache-2.0, © Google) into
// tools/icons/src/<set>/<name>.svg (+ <name>.fill.svg for names in FILL), from the
// google/material-design-icons repository at a pinned commit. Idempotent: a source
// already on disk is kept unless --force. Then run build.js.
//
//   node tools/icons/fetch.js [--force]
//
// Sources live here, not under public/: the app serves the compiled sprite
// (public/js/icons.js), never these files.

const fs = require('node:fs');
const path = require('node:path');
const { NAMES, FILL, STYLES } = require('./names');

// Pinned so a re-fetch is reproducible; bump deliberately (and review the build diff).
const REF = process.env.ICONS_REF || 'bd8cb85bd4bad964fe6918f79665bb40c3a8efef'; // master on 2026-09-27
const BASE = `https://raw.githubusercontent.com/google/material-design-icons/${REF}/symbols/web`;
const SRC = path.join(__dirname, 'src');
const force = process.argv.includes('--force');

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  if (!/^<svg[\s>]/.test(text) || !/<path /.test(text)) throw new Error(`not an svg: ${url}`);
  return text.trim() + '\n';
}

(async () => {
  let fetched = 0; let kept = 0;
  const jobs = [];
  for (const [set, { family, fill }] of Object.entries(STYLES)) {
    fs.mkdirSync(path.join(SRC, set), { recursive: true });
    for (const name of NAMES) {
      const variants = [[name, fill]];
      if (FILL.includes(name)) variants.push([`${name}.fill`, true]);
      for (const [file, f] of variants) {
        const out = path.join(SRC, set, `${file}.svg`);
        if (!force && fs.existsSync(out)) { kept++; continue; }
        const url = `${BASE}/${name}/${family}/${name}${f ? '_fill1' : ''}_24px.svg`;
        jobs.push(get(url).then((svg) => { fs.writeFileSync(out, svg); fetched++; }));
      }
    }
  }
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  console.log(`icons: fetched ${fetched}, kept ${kept}, failed ${failed.length}`);
  for (const f of failed) console.log('  FAIL', f);
  process.exit(failed.length ? 1 : 0);
})();
