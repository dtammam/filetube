'use strict';

// [UNIT] v1.113: the Docker image must ship the ops/diagnostic scripts under
// scripts/, or a script the docs/device-pass notes tell Dean to run on his
// server (e.g. `node scripts/probe-channel-metadata.js`,
// `node scripts/probe-faststart.js`) is ABSENT from the image and fails. This
// is a real gap Dean caught: pre-v1.113 the Dockerfile copied server.js/public/
// lib/ but NOT scripts/, so the v1.111 faststart device-pass note pointed at a
// file that was never in the image. Bind the COPY so it can't silently drop.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dockerfile = fs.readFileSync(path.join(__dirname, '..', '..', 'Dockerfile'), 'utf8');

test('Dockerfile ships scripts/ so the diagnostics are runnable on a deployed server', () => {
  assert.match(dockerfile, /^COPY\s+scripts\/\s+\.\/scripts\//m,
    'the Dockerfile must `COPY scripts/ ./scripts/` (docker exec node scripts/... needs it)');
});

test('Dockerfile still ships the runtime essentials (server.js, public/, lib/)', () => {
  for (const re of [/^COPY\s+server\.js\s+\.\//m, /^COPY\s+public\/\s+\.\/public\//m, /^COPY\s+lib\/\s+\.\/lib\//m]) {
    assert.match(dockerfile, re, `missing an essential COPY (${re})`);
  }
});

test('the scripts the device-pass notes reference actually exist on disk to be copied', () => {
  const ROOT = path.join(__dirname, '..', '..');
  for (const s of ['probe-channel-metadata.js', 'probe-faststart.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', s)), `scripts/${s} must exist to ship`);
  }
});
