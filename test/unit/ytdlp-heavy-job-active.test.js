'use strict';

// [UNIT] v1.38.0 T8 — ytdlp.isHeavyJobActive() is the read-only "download/poll
// in flight or queued" signal the TTS worker gates synthesis on. It tracks the
// runExclusive FIFO's own counter, so it is true for the entire lifetime of any
// gate job and false when the gate is idle.

const { test } = require('node:test');
const assert = require('node:assert');

const ytdlp = require('../../lib/ytdlp');

test('isHeavyJobActive: false when idle, true while a runExclusive job is in flight, false after it settles', async () => {
  assert.strictEqual(ytdlp.isHeavyJobActive(), false, 'idle gate reads false');

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // Occupy the gate with a job that stays pending until we release it.
  const jobPromise = ytdlp.runExclusive(() => gate);
  // Synchronously after enqueue, the counter is already incremented.
  assert.strictEqual(ytdlp.isHeavyJobActive(), true, 'a job in flight reads true');

  release();
  await jobPromise;
  assert.strictEqual(ytdlp.isHeavyJobActive(), false, 'the gate reads false once the job settles');
});
