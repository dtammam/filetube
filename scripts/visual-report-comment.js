#!/usr/bin/env node
'use strict';
/*
 * visual-report-comment - turn the 12 visual legs' reports into ONE PR comment.
 *
 *   node scripts/visual-report-comment.js --reports DIR --stage DIR --pr N --run ID --repo OWNER/NAME --out FILE
 *
 * --reports  the downloaded `visual-report-<era>-<vp>` artifacts, one directory per leg, each
 *            holding report.json and the *.sbs.png crops (test/visual/run.js --report).
 * --stage    the checkout of the `visual-reports` branch; the crops shown in the comment are
 *            copied to <stage>/pr-<N>/<run>/ (the ONLY place this script writes besides --out).
 * --out      the comment body (Markdown), first line the hidden marker the workflow finds it by.
 *
 * Prints `changed=true|false` (GITHUB_OUTPUT style) so the workflow pushes the crops only when
 * there is something to show. The visual check never blocks a merge: this only reports.
 */
const fs = require('node:fs');
const path = require('node:path');

const MARKER = '<!-- visual-report -->';
const MAX_CROPS = 12;
const MAX_LISTED = 40;
const arg = (a, n) => { const i = a.indexOf(n); return i === -1 ? undefined : a[i + 1]; };

// legs: [{ leg: '2021-phone', results: [{scene, changed, pct, crop, note}] | null }]
function buildComment(legs, { repo, pr, run }) {
  const lines = [MARKER, '### Visual report', ''];
  const reported = legs.filter((l) => l.results);
  const missing = legs.filter((l) => !l.results).map((l) => l.leg);
  const changedLegs = reported
    .map((l) => ({ leg: l.leg, rows: l.results.filter((r) => r.changed !== 0) }))
    .filter((l) => l.rows.length);
  const crops = [];
  if (!changedLegs.length && !missing.length) {
    lines.push(`No visual changes (${reported.length} legs compared). This report never blocks a merge.`);
    return { body: lines.join('\n') + '\n', crops, changed: false };
  }
  if (changedLegs.length) {
    const total = changedLegs.reduce((n, l) => n + l.rows.length, 0);
    lines.push(`${total} scene${total === 1 ? ' looks' : 's look'} different across ${changedLegs.length} leg${changedLegs.length === 1 ? '' : 's'}. `
      + 'If that is intended, nothing to do: a bot opens a baselines PR after the merge. This report never blocks a merge.', '');
    let listed = 0;
    for (const l of changedLegs) {
      lines.push(`**${l.leg}** (${l.rows.length})`);
      const ranked = [...l.rows].sort((a, b) => (b.pct || 0) - (a.pct || 0));
      for (const r of ranked) {
        if (listed >= MAX_LISTED) break;
        listed += 1;
        const what = r.changed === -1 ? (r.note || 'missing, extra or resized') : `${r.changed} px (${r.pct}%)`;
        lines.push(`- \`${r.scene}\`: ${what}`);
        if (r.crop && crops.length < MAX_CROPS) crops.push({ leg: l.leg, scene: r.scene, file: r.crop });
      }
      lines.push('');
    }
    if (total > listed) lines.push(`... and ${total - listed} more (the full list is in the run's \`visual-report-*\` artifacts).`, '');
  }
  if (missing.length) lines.push(`No report from: ${missing.join(', ')} (the capture did not finish there; see the run log).`, '');
  const shown = crops.map((c) => ({ ...c, name: `${c.leg}--${path.basename(c.file)}`.replace(/[^\w.-]/g, '_') }));
  if (shown.length) {
    lines.push(`<details><summary>Crops (${shown.length}, before on the left, after on the right)</summary>`, '');
    for (const c of shown) {
      lines.push(`\`${c.leg}\` ${c.scene}`, `![${c.scene}](https://raw.githubusercontent.com/${repo}/visual-reports/pr-${pr}/${run}/${encodeURIComponent(c.name)})`, '');
    }
    lines.push('</details>', '');
  }
  lines.push(`Run ${run}.`);
  return { body: lines.join('\n') + '\n', crops: shown, changed: changedLegs.length > 0 };
}

function readLegs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().map((name) => {
    const rj = path.join(dir, name, 'report.json');
    let results = null;
    try { results = JSON.parse(fs.readFileSync(rj, 'utf8')).results; } catch { /* a leg with no report */ }
    return { leg: name.replace(/^visual-report-/, ''), dir: path.join(dir, name), results: Array.isArray(results) ? results : null };
  });
}

function main(argv) {
  const reports = arg(argv, '--reports');
  const stage = arg(argv, '--stage');
  const pr = arg(argv, '--pr');
  const run = arg(argv, '--run');
  const repo = arg(argv, '--repo');
  const out = arg(argv, '--out');
  if (![reports, stage, pr, run, repo, out].every(Boolean) || !/^\d+$/.test(pr) || !/^\d+$/.test(run) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error('usage: visual-report-comment.js --reports DIR --stage DIR --pr N --run ID --repo OWNER/NAME --out FILE');
    return 2;
  }
  const legs = readLegs(reports);
  const { body, crops, changed } = buildComment(legs, { repo, pr, run });
  fs.writeFileSync(out, body);
  const dest = path.join(stage, `pr-${pr}`, run);
  if (crops.length) fs.mkdirSync(dest, { recursive: true });
  for (const c of crops) {
    const leg = legs.find((l) => l.leg === c.leg);
    const src = path.join(leg.dir, path.basename(c.file));
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, c.name));
  }
  console.log(`changed=${changed}`);
  return 0;
}

module.exports = { MARKER, MAX_CROPS, buildComment, readLegs };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
