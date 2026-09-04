'use strict';

require('../helpers/isolate-data-dir'); // tech-debt #202: MUST precede any server.js require (it opens a db)
// The mutation audit middleware's CLOSE path, proven with a deferred
// handler (gate DELTA-B: the integration socket-destroy test raced a
// synchronous 404 and stayed green with the close listener deleted - the
// finish path answered for it). Here the handler responds at +250ms and
// the client tears the socket down at +40ms, so 'finish' can never fire
// first: only the 'close' listener can produce the line. Deleting
// res.on('close', emit) makes THIS test time out red.

const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const express = require('express');
const { createMutationAuditMiddleware } = require('../../server.js');

function collectLines() {
  const lines = [];
  return { lines, log: (s) => lines.push(s) };
}

async function pollFor(pred, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!pred() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  return pred();
}

test('close-path: socket destroyed while the handler is still pending -> exactly one line, marked incomplete', async () => {
  const { lines, log } = collectLines();
  const app = express();
  app.use(createMutationAuditMiddleware(log));
  let handlerRan = false;
  app.delete('/api/videos/:id', (req, res) => {
    setTimeout(() => { handlerRan = true; res.json({ ok: true }); }, 250);
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    await new Promise((resolve) => {
      const sock = net.connect(server.address().port, '127.0.0.1', () => {
        sock.write('DELETE /api/videos/REAL?removeAnyway=true HTTP/1.1\r\nHost: x\r\n\r\n');
        setTimeout(() => { sock.destroy(); resolve(); }, 40);
      });
      sock.on('error', () => resolve());
    });
    assert.ok(await pollFor(() => lines.length > 0), 'no audit line after socket teardown - the close listener is the only path here');
    // The mutation still completed inside the route - the hazard is real.
    assert.ok(await pollFor(() => handlerRan), 'deferred handler should still run');
    assert.strictEqual(lines.length, 1, lines.join(' | '));
    assert.match(lines[0], /^\[audit\] \S+ DELETE \/api\/videos\/REAL\?removeAnyway=true \d{3} incomplete user=unauthenticated$/);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('normal completion: exactly one line (finish+close both fire; the once-guard collapses them), no incomplete marker', async () => {
  const { lines, log } = collectLines();
  const app = express();
  app.use(createMutationAuditMiddleware(log));
  app.delete('/x', (req, res) => res.status(204).end());
  app.get('/safe', (req, res) => res.json({}));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await fetch(`${base}/x`, { method: 'DELETE' });
    await fetch(`${base}/safe`);
    assert.ok(await pollFor(() => lines.length > 0));
    // Give the close event room to double-log if the once-guard were gone.
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(lines.length, 1, lines.join(' | '));
    assert.match(lines[0], / 204 user=/);
    assert.doesNotMatch(lines[0], /incomplete/);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
