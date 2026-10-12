'use strict';
// v1.386.0 W1: a TCP proxy that models a network link - a one-way delay on every chunk in both directions
// (RTT = 2 x oneWayMs) and a throughput cap per direction - so a browser run pays round trips the way a phone
// over the VPN does (HTTP/1.1, up to six connections, each request's revalidation a real round trip).
//   const p = await startProxy({ target: 3000, oneWayMs: 40, mbps: 20 }); p.port; p.stats(); await p.stop();
const net = require('node:net');

function startProxy(opts) {
  const oneWay = opts.oneWayMs || 0;
  const bytesPerMs = opts.mbps ? (opts.mbps * 1e6 / 8) / 1000 : Infinity;
  let conns = 0; let up = 0; let down = 0;
  const sockets = new Set();
  function pipe(from, to, count) {
    let busyUntil = 0; // the link's serialisation clock (throughput)
    from.on('data', (chunk) => {
      count(chunk.length);
      const now = Date.now();
      const sendDone = Math.max(now, busyUntil) + (bytesPerMs === Infinity ? 0 : chunk.length / bytesPerMs);
      busyUntil = sendDone;
      const at = sendDone + oneWay;
      setTimeout(() => { if (!to.destroyed) to.write(chunk); }, Math.max(0, at - now));
    });
    from.on('end', () => setTimeout(() => to.end(), Math.max(0, busyUntil + oneWay - Date.now())));
    from.on('error', () => to.destroy());
  }
  const server = net.createServer((client) => {
    conns++;
    const upstream = net.connect(opts.target, '127.0.0.1');
    sockets.add(client); sockets.add(upstream);
    client.on('close', () => sockets.delete(client)); upstream.on('close', () => sockets.delete(upstream));
    pipe(client, upstream, (n) => { up += n; });
    pipe(upstream, client, (n) => { down += n; });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    stats: () => ({ conns, upBytes: up, downBytes: down }),
    reset: () => { conns = 0; up = 0; down = 0; },
    stop: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  })));
}
module.exports = { startProxy };
