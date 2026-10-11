'use strict';
// v1.386.0: prints the plan's evidence tables (markdown) straight from browser-cost.js output files, so no number in
// the plan is typed by hand.   node tools/speed-proof/table.js <music jsonl> [<skin jsonl>]
const fs = require('node:fs');
const rows = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((o) => o.median);
const kb = (b) => (b >= 1e6 ? (b / 1e6).toFixed(2) + ' MB' : Math.round(b / 1000) + ' KB');
const music = rows(process.argv[2]).filter((o) => o.cell.startsWith('music'));
console.log('| engine | network | open | Home drawn (ms) | last main-thread stall ends (ms) | requests reaching the server (200 / 304) | bytes over the wire | music API server ms (sum) | all server ms (sum) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const o of music) {
  const m = o.median;
  console.log(`| ${o.engine} | ${o.net} (${o.rttMs} ms RTT, ${o.mbps} Mbit/s) | ${o.cell.split(' ')[1]} | ${m.shelvesMs} | ${m.quietMs} | ${m.server200} / ${m.server304} | ${kb(m.wireDownBytes)} | ${m.musicApiServerMsSum} | ${m.serverMsSum} |`);
}
const skinFile = process.argv[3] || process.argv[2];
const skin = rows(skinFile).filter((o) => o.cell.startsWith('skin'));
if (skin.length) {
  console.log('\n| engine | network | pick | tap -> Coil shown (ms) | Coil shown WITHOUT its photos (ms) | photos arrive after tap (ms) | photo bytes this pick | failed reps |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const o of skin) {
    const m = o.median;
    console.log(`| ${o.engine} | ${o.net} | ${o.cell.split(' ')[1]} | ${m.tapToCoilShownMs} | ${m.placeholderMs} | ${m.photosArriveAfterTapMs} | ${kb(m.wireDownBytes)} | ${o.failedReps || 0} |`);
  }
}
