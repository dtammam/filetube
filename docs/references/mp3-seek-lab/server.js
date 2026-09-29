// seek lab: FileTube's real sendRangeable on :8801, a byte-pacing proxy on :8802 (a slow link)
const path = require('path'), fs = require('fs'), net = require('net'), { pipeline } = require('stream');
const REPO = path.resolve(__dirname, '../../..');
const express = require(REPO + '/node_modules/express');
const { createMediaStreams } = require(REPO + '/lib/media/streams.js');
const { sendRangeable } = createMediaStreams({ fs, pipeline, registerMediaStream: () => {} });
const app = express();
app.get('/lab.html', (req, res) => res.sendFile(path.join(__dirname, 'lab.html')));
app.get('/f/:name', (req, res) => {
  const f = path.join(__dirname, path.basename(req.params.name));
  sendRangeable(req, res, f, f.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg');
});
app.listen(8801, '127.0.0.1');
const RATE = Number(process.env.RATE || 300000); // bytes/s per connection, server -> browser
net.createServer(c => {
  const up = net.connect(8801, '127.0.0.1'); c.pipe(up);
  let q = [], busy = false;
  const pump = () => { if (!q.length) { busy = false; return; } busy = true; const b = q.shift(); c.write(b); setTimeout(pump, b.length / RATE * 1000); };
  up.on('data', d => { for (let i = 0; i < d.length; i += 16384) q.push(d.subarray(i, i + 16384)); if (!busy) pump(); });
  up.on('error', () => c.destroy()); c.on('error', () => up.destroy()); c.on('close', () => up.destroy());
}).listen(8802, '127.0.0.1');
console.log('lab up');
