'use strict';

// [UNIT] v1.393.0 W3 (plan 2026-10-20-listing-overflow, R3): the gate's budget watchdog. A job whose own worst-case
// budget has passed is hung; the gate logs one loud line, marks it abandoned (it may spawn nothing more) and asks
// the job's hook whether it is SAFE to move on (every child gone). Only then does the next job run; the hung job's
// late result is ignored. A hook that cannot prove the children gone keeps the gate held.

const { test, after } = require('node:test');
const assert = require('node:assert');
const gate = require('../../lib/heavyGate');

// The watchdog's timers are unref'd (the server keeps the process alive); the test runner needs a keep-alive.
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function captureErrors(fn) {
  const orig = console.error;
  const lines = [];
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { return { value: await fn(), lines }; } finally { console.error = orig; }
}

test('R3 a job past its budget is released once the hook proves its children gone; the next job runs and the late result is ignored', async () => {
  let release;
  const hung = new Promise((r) => { release = r; });
  let hookCalls = 0;
  let nextRan = false;
  const { value, lines } = await captureErrors(async () => {
    const a = gate.runExclusive(() => hung, {
      kind: 'channel', label: 'Some Channel', budgetMs: 40,
      onBudgetExceeded: async () => { hookCalls += 1; return true; },
      budgetResult: () => ({ outcome: 'error', status: 'budget' }),
    });
    const b = gate.runExclusive(async () => { nextRan = true; return 'b'; }, { kind: 'channel', label: 'B' });
    const aResult = await a;
    const bResult = await b;
    release({ outcome: 'success', late: true }); // the hung job finally wakes: ignored
    await tick(10);
    return { aResult, bResult };
  });
  assert.deepStrictEqual(value.aResult, { outcome: 'error', status: 'budget' });
  assert.strictEqual(value.bResult, 'b');
  assert.strictEqual(nextRan, true);
  assert.strictEqual(hookCalls, 1);
  assert.ok(lines.some((l) => /^gate job exceeded its budget: channel Some Channel \d+$/.test(l)), lines.join('\n'));
  assert.strictEqual(gate.isHeavyJobActive(), false);
});

test('R3 a hook that cannot prove the children gone keeps the gate HELD (never two at once), and re-checks until it can', async () => {
  let checks = 0;
  let nextRan = false;
  const { value } = await captureErrors(async () => {
    const a = gate.runExclusive(() => new Promise(() => {}), {
      kind: 'oneshot', label: 'x', budgetMs: 20, recheckMs: 25,
      onBudgetExceeded: async () => { checks += 1; return checks >= 3; },
    });
    const b = gate.runExclusive(async () => { nextRan = true; }, { kind: 'channel', label: 'B' });
    await tick(60);
    const ranTooEarly = nextRan;
    const aResult = await a;
    await b;
    return { ranTooEarly, aResult };
  });
  assert.strictEqual(value.ranTooEarly, false, 'the next job must wait while a child may still be alive');
  assert.ok(checks >= 3, 'checks ' + checks);
  assert.strictEqual(value.aResult.code, 'EBUDGET');
  assert.strictEqual(nextRan, true);
});

test('R3 a throwing hook holds the gate too (the safe answer when the children cannot be proven gone)', async () => {
  let n = 0;
  const { value } = await captureErrors(async () => {
    const a = gate.runExclusive(() => new Promise(() => {}), {
      kind: 'x', budgetMs: 15, recheckMs: 15,
      onBudgetExceeded: async () => { n += 1; if (n < 3) throw new Error('boom'); return true; },
    });
    return a;
  });
  assert.ok(n >= 3);
  assert.strictEqual(value.code, 'EBUDGET');
});

test('R3 an abandoned job is told apart from the job that now holds the gate (its spawns are refused)', async () => {
  let abandonedSeenByHung = null;
  let abandonedSeenByNext = null;
  let wake;
  const hung = new Promise((r) => { wake = r; });
  await captureErrors(async () => {
    const a = gate.runExclusive(async () => {
      assert.strictEqual(gate.isCurrentJobAbandoned(), false, 'a healthy job may spawn');
      await hung;
      abandonedSeenByHung = gate.isCurrentJobAbandoned();
    }, { kind: 'c', budgetMs: 20, onBudgetExceeded: async () => true });
    const b = gate.runExclusive(async () => { abandonedSeenByNext = gate.isCurrentJobAbandoned(); });
    await a;
    await b;
    wake();
    await tick(10);
  });
  assert.strictEqual(abandonedSeenByHung, true, 'after the release the hung job is abandoned');
  assert.strictEqual(abandonedSeenByNext, false, 'the next job is not');
  assert.strictEqual(gate.isCurrentJobAbandoned(), false, 'outside any job');
});

test('R3 a job inside its budget is untouched: same value, same rejection, the timer is cleared, the uncontended path stays synchronous', async () => {
  let ran = false;
  const p = gate.runExclusive(() => { ran = true; return Promise.resolve(7); }, { kind: 'c', budgetMs: 60000, onBudgetExceeded: async () => { throw new Error('must not fire'); } });
  assert.strictEqual(ran, true, 'fn runs synchronously when the gate is idle');
  assert.strictEqual(await p, 7);
  await assert.rejects(gate.runExclusive(() => Promise.reject(new Error('own failure')), { kind: 'c', budgetMs: 60000 }), /own failure/);
  await assert.rejects(gate.runExclusive(() => { throw new Error('sync failure'); }, { kind: 'c', budgetMs: 60000 }), /sync failure/);
  assert.strictEqual(gate.isHeavyJobActive(), false);
});

test('R3 a job without a budget is exactly as before (no watchdog)', async () => {
  const lines = (await captureErrors(async () => {
    await gate.runExclusive(async () => { await tick(30); }, { kind: 'c', label: 'x' });
  })).lines;
  assert.deepStrictEqual(lines, []);
});
