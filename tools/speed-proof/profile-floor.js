'use strict';
// v1.386.0 W1: CPU-profile N sequential requests of one URL (default the cheapest music call, limit=1) to name
// where the per-request floor goes. Writes a .cpuprofile and prints the top self-time functions.
//   node tools/speed-proof/profile-floor.js [url] [n] [out.cpuprofile]
const fs = require('node:fs');
const inspector = require('node:inspector');
const { start } = require('./serve');

async function main() {
  const url = process.argv[2] || '/api/music?limit=1';
  const n = Number(process.argv[3] || 10);
  const out = process.argv[4] || 'floor.cpuprofile';
  const s = await start({});
  const cookie = s.cookie.name + '=' + s.cookie.value;
  await fetch(s.base + url, { headers: { Cookie: cookie } }).then((r) => r.arrayBuffer()); // warm
  const session = new inspector.Session(); session.connect();
  const post = (m, p) => new Promise((res, rej) => session.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));
  await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 200 }); await post('Profiler.start');
  for (let i = 0; i < n; i++) await fetch(s.base + url, { headers: { Cookie: cookie } }).then((r) => r.arrayBuffer());
  const { profile } = await post('Profiler.stop');
  fs.writeFileSync(out, JSON.stringify(profile));
  const self = new Map(); const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
  const dt = profile.timeDeltas; let total = 0;
  profile.samples.forEach((id, i) => { const nd = byId.get(id); const f = nd.callFrame; const k = (f.functionName || '(anon)') + ' ' + (f.url || '').replace(/^.*\/(perf-v1\.386\.0-speed-pass)\//, '') + ':' + (f.lineNumber + 1); self.set(k, (self.get(k) || 0) + dt[i]); total += dt[i]; });
  console.log('total ms', Math.round(total / 1000), 'per request', Math.round(total / 1000 / n));
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(String(Math.round(v / 1000)).padStart(6), k));
  await s.stop();
}
main().then(() => process.exit(0), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
