'use strict';
// v1.386.0 W1: what each music-library call costs on the server and on the wire, against a library the size
// of Dean's. For every URL: server ms (median of REPS sequential requests on loopback, so it is the server's
// own time), the body size raw / gzip / brotli, and whether the response carries a validator (ETag) and a
// Content-Encoding. Prints one JSON line per URL.
//   node tools/speed-proof/api-cost.js [tracks]
const zlib = require('node:zlib');
const { start } = require('./serve');

const REPS = 5;
const URLS = [
  // the browse view's Home (renderHome) and its first list
  '/api/music/artists?limit=12&sort=newest',
  '/api/music/albums?limit=12&sort=newest',
  '/api/music?filter=recent-listening&limit=60',
  '/api/music/stations',
  '/api/music?sort=newest&limit=1000',
  // the browse view's Albums / Artists tabs
  '/api/music/albums?limit=10000&sort=title-asc',
  '/api/music/artists?limit=10000&sort=title-asc',
  // the Pocket menus: About's counts, Songs (fetchAllRows, MENU_PAGE 5000 per page), Albums, Artists, Recent
  '/api/music?limit=1',
  '/api/music?sort=title-asc&limit=5000&offset=0',
  '/api/music?sort=title-asc&limit=5000&offset=20000',
  '/api/music/albums?sort=title-asc&limit=5000&offset=0',
  '/api/music/artists?sort=title-asc&limit=5000&offset=0',
  '/api/music?filter=recent-listening&include=finished&limit=200',
  // the boot calls every shell makes beside the music view's (they share the one server thread)
  '/api/liked?limit=1',
  '/api/queue',
  '/api/config',
  '/api/history?limit=1',
  '/api/subscriptions/health',
  '/api/watch-later/ids',
];

async function main() {
  const n = process.argv[2] ? Number(process.argv[2]) : undefined;
  const s = await start({ tracks: n });
  const cookie = s.cookie.name + '=' + s.cookie.value;
  console.log(JSON.stringify({ library: { tracks: s.trackCount, albums: s.albumCount } }));
  for (const u of URLS) {
    const times = [];
    let body = null; let hdr = null;
    for (let i = 0; i < REPS; i++) {
      const t0 = process.hrtime.bigint();
      const r = await fetch(s.base + u, { headers: { Cookie: cookie, 'Accept-Encoding': 'gzip, br' } });
      const buf = Buffer.from(await r.arrayBuffer());
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      body = buf; hdr = r.headers;
    }
    times.sort((a, b) => a - b);
    let items = null;
    try { const j = JSON.parse(body.toString('utf8')); items = Array.isArray(j.items) ? j.items.length : (j.stations ? j.stations.length : null); } catch { /* not json */ }
    console.log(JSON.stringify({
      url: u, items, serverMsMedian: Math.round(times[Math.floor(REPS / 2)]), serverMsMin: Math.round(times[0]),
      rawBytes: body.length, gzipBytes: zlib.gzipSync(body).length, brBytes: zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }).length,
      contentEncoding: hdr.get('content-encoding'), etag: hdr.get('etag'), cacheControl: hdr.get('cache-control'),
    }));
  }
  // the covers the Home shelves request (one per album card): the server time of each /albumart answer
  const albums = await (await fetch(s.base + '/api/music/albums?limit=12&sort=newest', { headers: { Cookie: cookie } })).json();
  const times = [];
  for (const a of albums.items) {
    const t0 = process.hrtime.bigint();
    const r = await fetch(s.base + '/albumart/' + encodeURIComponent(a.artId) + '?s=256', { headers: { Cookie: cookie } });
    await r.arrayBuffer();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((x, y) => x - y);
  console.log(JSON.stringify({ url: '/albumart/<id>?s=256 (x' + times.length + ')', items: times.length, serverMsMedian: Math.round(times[Math.floor(times.length / 2)]), serverMsMin: Math.round(times[0]), rawBytes: 0, gzipBytes: 0, brBytes: 0 }));
  await s.stop();
}
main().then(() => process.exit(0), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
