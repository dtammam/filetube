'use strict';

// [UNIT] v1.29 Downloads Reliability wave (T2/T3(a)) -- lib/ytdlp/failures.js's
// pure `computeDownloadOutcome`, THE both-directions failure-masking
// containment point. Today one failed video in a batched channel download
// makes yt-dlp exit non-zero and the caller marks the WHOLE channel failed,
// discarding videos that actually succeeded (Direction B / root cause 1).
// The fix must not swing the other way and mask a REAL total failure as
// success/partial (Direction A). Every case below feeds representative
// yt-dlp-style `ERROR:` stderr fixture lines through the existing
// `parseItemFailureLine` to build `itemFailures[]`, so these tests exercise
// the real upstream shape end-to-end (no live network, no spawn).

const { test } = require('node:test');
const assert = require('node:assert');
const { parseItemFailureLine, computeDownloadOutcome } = require('../../lib/ytdlp/failures.js');

/** Build an attributed-or-unattributed itemFailures[] entry from a raw
 * yt-dlp-style stderr line, exactly as run.js's caller would. */
function fail(line, knownIds) {
  return parseItemFailureLine(line, knownIds);
}

// ---- success ----------------------------------------------------------------

test('computeDownloadOutcome: ok:true with N targets -> success, succeeded:N, failed:0', () => {
  const targetIds = ['a', 'b', 'c'];
  const result = computeDownloadOutcome({ ok: true, itemFailures: [], targetIds });
  assert.deepEqual(result, { outcome: 'success', succeeded: 3, failed: 0 });
});

test('computeDownloadOutcome: ok:true with zero targets -> success, succeeded:0, failed:0', () => {
  const result = computeDownloadOutcome({ ok: true, itemFailures: [], targetIds: [] });
  assert.deepEqual(result, { outcome: 'success', succeeded: 0, failed: 0 });
});

test('computeDownloadOutcome (R3a.4): ok:true is success even if a stale/inconsistent itemFailures[] is present -- ok is authoritative for the success arm', () => {
  const targetIds = ['a', 'b'];
  const knownIds = new Set(targetIds);
  const itemFailures = [fail('ERROR: [youtube] a: transient blip', knownIds)];
  const result = computeDownloadOutcome({ ok: true, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'success', succeeded: 2, failed: 0 });
});

// ---- AC-FM-A: Direction A -- total failure still surfaces, never masked ------

test('AC-FM-A: every target id fails (each attributed) -> error, succeeded:0, failed:target -- NOT partial, NOT success', () => {
  const targetIds = ['vid1', 'vid2', 'vid3'];
  const knownIds = new Set(targetIds);
  const itemFailures = [
    fail('ERROR: [youtube] vid1: Video unavailable', knownIds),
    fail('ERROR: [youtube] vid2: Sign in to confirm your age', knownIds),
    fail('ERROR: [youtube] vid3: Private video', knownIds),
  ];
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 3 });
  assert.notEqual(result.outcome, 'partial');
  assert.notEqual(result.outcome, 'success');
});

test('AC-FM-A: channel-level failure (ok:false, ZERO per-item attribution) -> error, succeeded:0, failed:N -- the Direction-A guard', () => {
  // Simulates a bot-check/429/age-gate/members-only spawn failure BEFORE any
  // per-video line was ever emitted -- itemFailures is empty by construction,
  // not because nothing failed.
  const targetIds = ['vid1', 'vid2', 'vid3', 'vid4'];
  const result = computeDownloadOutcome({ ok: false, itemFailures: [], targetIds });
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 4 });
  assert.notEqual(result.outcome, 'partial', 'a channel-level failure must never be miscounted as partial');
  assert.notEqual(result.outcome, 'success', 'a channel-level failure must never be miscounted as success');
});

test('AC-FM-A: channel-level failure with zero targets still reports error, not success, with failed:0', () => {
  const result = computeDownloadOutcome({ ok: false, itemFailures: [], targetIds: [] });
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 0 });
});

// ---- AC-FM-B: Direction B -- partial success not masked as failure -----------

test('AC-FM-B: 9/10 succeed (1 attributed failure) -> partial, succeeded:9, failed:1', () => {
  const targetIds = Array.from({ length: 10 }, (_, i) => `vid${i}`);
  const knownIds = new Set(targetIds);
  const itemFailures = [fail('ERROR: [youtube] vid7: Video unavailable', knownIds)];
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'partial', succeeded: 9, failed: 1 });
  assert.notEqual(result.outcome, 'error', 'a real partial success must not collapse into total failure');
});

test('AC-FM-B: a second partial ratio (1/2 succeed) -> partial, succeeded:1, failed:1', () => {
  const targetIds = ['vidA', 'vidB'];
  const knownIds = new Set(targetIds);
  const itemFailures = [fail('ERROR: [youtube] vidB: HTTP Error 403: Forbidden', knownIds)];
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'partial', succeeded: 1, failed: 1 });
});

test('AC-FM-B: duplicate attributed failure lines for the same videoId are counted once (distinct set)', () => {
  const targetIds = ['vid1', 'vid2', 'vid3'];
  const knownIds = new Set(targetIds);
  const itemFailures = [
    fail('ERROR: [youtube] vid1: Video unavailable', knownIds),
    fail('ERROR: [youtube] vid1: Video unavailable (retry)', knownIds),
  ];
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'partial', succeeded: 2, failed: 1 });
});

// ---- AC-FM-D: unattributed failure counted, never inflates succeeded ---------

// GF2 (semantics changed -- see failures.js's doc comment): pre-GF2 this
// asserted {outcome:'partial', succeeded:2, failed:1}. This shape has ZERO
// attributed failures (the only line is unattributed), so the GF2
// zero-attributed override now governs: with no real target boundary to
// credit a success against, crediting one here would be exactly the
// phantom-success masking the CRITICAL flagged. AC-FM-D's own guarantee
// (an unattributed failure is never silently dropped, never inflates
// succeeded) still holds -- succeeded is 0, not inflated -- it is just no
// longer credited a "reserved" success without an attributed boundary.
test('AC-FM-D (GF2): an unattributed (videoId:null) failure with ZERO attributed failures -> error, succeeded:0, failed:target (zero-attributed override, not partial)', () => {
  const targetIds = ['vid1', 'vid2', 'vid3'];
  const knownIds = new Set(targetIds); // note: 'mystery-id' below is deliberately NOT a member
  const itemFailures = [fail('ERROR: [youtube] mystery-id: Video unavailable', knownIds)];
  assert.equal(itemFailures[0].videoId, null, 'sanity: the fixture line really is unattributed');
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 3 });
});

// GF2 (semantics changed -- see failures.js's doc comment): pre-GF2 (GF1's
// fix) this asserted {outcome:'partial', succeeded:1, failed:1} via a
// reserve-1 bound applied unconditionally to unattributed evidence. This
// shape has ZERO attributed failures (none of unknownA/B/C is a member of
// knownIds), so the GF2 zero-attributed override now governs regardless of
// how many distinct-reason unattributed lines exist: error, nothing
// credited.
test('GF2: 3 distinct-reason unattributed lines with ZERO attributed failures -> error, succeeded:0, failed:target (zero-attributed override supersedes the reserve-1 bound)', () => {
  const targetIds = ['vid1', 'vid2'];
  const knownIds = new Set(targetIds);
  const itemFailures = [
    fail('ERROR: [youtube] unknownA: reason one', knownIds),
    fail('ERROR: [youtube] unknownB: reason two', knownIds),
    fail('ERROR: [youtube] unknownC: reason three', knownIds),
  ];
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 2 });
});

test('AC-FM-D: a mix of attributed and unattributed failures both count toward failed, and can co-occur with real successes', () => {
  const targetIds = ['vid1', 'vid2', 'vid3', 'vid4'];
  const knownIds = new Set(targetIds);
  const itemFailures = [
    fail('ERROR: [youtube] vid2: Private video', knownIds), // attributed
    fail('ERROR: [youtube] not-a-known-id: Video unavailable', knownIds), // unattributed
  ];
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'partial', succeeded: 2, failed: 2 });
});

// ---- GF2 F1 CRITICAL fix: the exact gate-repro, resolved to `error` -----

// GF2 (semantics changed -- supersedes GF1's resolution; see failures.js's
// doc comment): this exact repro has ZERO attributed failures, so the GF2
// zero-attributed override governs -- error, not the GF1 partial/1/1
// result. GF1's fix (raw-count-no-bound deflating a genuine partial into
// error) is superseded by GF2 requiring an attributed target boundary
// before crediting anything, which the adversarial re-gate's CRITICAL
// required.
test('GF2 F1 exact repro: 2 unattributed failures (different reasons), ZERO attributed, against 2 targets -> error (zero-attributed override), NOT the GF1 partial/1/1 result', () => {
  const result = computeDownloadOutcome({
    ok: false,
    itemFailures: [{ videoId: null, reason: 'r1' }, { videoId: null, reason: 'r2' }],
    targetIds: ['a', 'b'],
  });
  assert.equal(result.outcome, 'error', 'zero attributed failures -> no real target boundary -> error');
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 2 });
});

// GF2 F1 CRITICAL repro (the exact scenario the adversarial re-gate flagged):
// 5 DISTINCT videos each failing with the byte-for-byte IDENTICAL generic
// templated stderr yt-dlp emits for a 429/bot-check, zero attributed. Under
// GF1's dedup-by-reason bias this collapsed to a single dedup key and read
// as failed:1/succeeded:4 -- PHANTOM successes. GF2 removes the dedup AND
// requires an attributed boundary before crediting anything: this MUST be
// error, succeeded:0, never a phantom success.
test('GF2 F1 CRITICAL: 5 targets, 5 unattributed failures with the SAME reason text (429 bot-check), zero attributed -> error, succeeded:0 -- NOT failed:1/succeeded:4 phantom successes', () => {
  const targetIds = Array.from({ length: 5 }, (_, i) => `vid${i}`);
  const knownIds = new Set(targetIds);
  const sameReasonLine = "Sign in to confirm you're not a bot";
  const itemFailures = [
    fail(`ERROR: [youtube] mystery1: ${sameReasonLine}`, knownIds),
    fail(`ERROR: [youtube] mystery2: ${sameReasonLine}`, knownIds),
    fail(`ERROR: [youtube] mystery3: ${sameReasonLine}`, knownIds),
    fail(`ERROR: [youtube] mystery4: ${sameReasonLine}`, knownIds),
    fail(`ERROR: [youtube] mystery5: ${sameReasonLine}`, knownIds),
  ];
  itemFailures.forEach((f) => assert.equal(f.videoId, null, 'sanity: every line here is unattributed'));
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 5 });
  assert.notDeepEqual(result, { outcome: 'partial', succeeded: 4, failed: 1 }, 'must not be the phantom-success GF1 shape');
});

// GF2 F1 WITH-attributed variant: proves the RAW (undeduped) unattributed
// count is what feeds the reserve-1 bound now, not a reason-deduped count.
// 1 attributed failure (a real target boundary) + 3 unattributed lines that
// ALL share the identical 429 reason text. A dedup-by-reason reading (GF1)
// would collapse those 3 lines to 1 distinct reason and credit
// succeeded:8/failed:2; the RAW-count reading (GF2) credits all 3 as
// independent evidence, bounded by reserve-1 against the 9 remaining
// targets: succeeded:6/failed:4 -- the raw count no longer collapses
// identical-reason distinct failures into phantom successes.
test('GF2 F1 WITH-attributed variant: raw (undeduped) unattributed count feeds the reserve-1 bound, not a reason-deduped count', () => {
  const targetIds = Array.from({ length: 10 }, (_, i) => `vid${i}`);
  const knownIds = new Set(targetIds);
  const sameReasonLine = 'HTTP Error 429: Too Many Requests';
  const itemFailures = [
    fail('ERROR: [youtube] vid0: Private video', knownIds), // attributed
    fail(`ERROR: [youtube] mystery1: ${sameReasonLine}`, knownIds), // unattributed
    fail(`ERROR: [youtube] mystery2: ${sameReasonLine}`, knownIds), // unattributed, same reason
    fail(`ERROR: [youtube] mystery3: ${sameReasonLine}`, knownIds), // unattributed, same reason
  ];
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'partial', succeeded: 6, failed: 4 });
  assert.notDeepEqual(result, { outcome: 'partial', succeeded: 8, failed: 2 }, 'must not silently dedupe the 3 identical-reason unattributed lines into 1');
});

// GF2's zero-attributed override (see failures.js's doc comment): a
// GENUINE total failure whose per-item lines are ALL unattributed (no id
// could be matched at all) is now UNCONDITIONALLY reported `error`,
// `succeeded:0` -- this is the fix for the GF1 "documented residual risk"
// (pre-GF2, this same shape was reported `partial` with one target credited
// `succeeded`, which the adversarial re-gate's CRITICAL identified as
// exactly the phantom-success masking direction this wave exists to
// prevent). Locked here so a future regression cannot silently reopen it.
test('GF2 lock: an all-unattributed total failure (no id matched at all) is reported error, succeeded:0 -- NOT partial (closes the GF1 residual-risk/CRITICAL gap)', () => {
  const targetIds = ['vid1', 'vid2', 'vid3', 'vid4', 'vid5'];
  const knownIds = new Set(targetIds); // deliberately none of the ids below are members
  const itemFailures = [
    fail('ERROR: [youtube] unk1: reason one', knownIds),
    fail('ERROR: [youtube] unk2: reason two', knownIds),
    fail('ERROR: [youtube] unk3: reason three', knownIds),
    fail('ERROR: [youtube] unk4: reason four', knownIds),
    fail('ERROR: [youtube] unk5: reason five', knownIds),
  ];
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 5 });
});

// ---- GF3 W1: deliberate remainingAfterAttributed===1 boundary lock -----------

// GF3 W1 (see failures.js's doc comment, "GF3 W1"): at the exact boundary
// where exactly ONE target remains after attributed accounting, the
// reserve-at-least-one bound evaluates to `Math.max(1, Math.min(raw, 0)) =
// 1` -- the sole remaining slot is consumed by the unattributed evidence,
// so this is `error`/`succeeded:0`, NOT `partial`. This is DELIBERATE
// (Dean's GF3 resolution: AC-FM-D wins over reserve-at-least-one at this one
// boundary, trading a possible under-credit for guaranteed Direction-A
// safety) -- pinned here so a future refactor cannot silently flip it to a
// phantom-success `partial`.
test('GF3 W1 boundary lock: 9 attributed failures + 1 unattributed failure / 10 targets -> error, succeeded:0, failed:10 (deliberate remaining===1 behavior)', () => {
  const targetIds = Array.from({ length: 10 }, (_, i) => `vid${i}`);
  const knownIds = new Set(targetIds);
  const itemFailures = [
    fail('ERROR: [youtube] vid0: Video unavailable', knownIds),
    fail('ERROR: [youtube] vid1: Video unavailable', knownIds),
    fail('ERROR: [youtube] vid2: Video unavailable', knownIds),
    fail('ERROR: [youtube] vid3: Video unavailable', knownIds),
    fail('ERROR: [youtube] vid4: Video unavailable', knownIds),
    fail('ERROR: [youtube] vid5: Video unavailable', knownIds),
    fail('ERROR: [youtube] vid6: Video unavailable', knownIds),
    fail('ERROR: [youtube] vid7: Video unavailable', knownIds),
    fail('ERROR: [youtube] vid8: Video unavailable', knownIds), // 9th attributed failure
    fail('ERROR: [youtube] mystery: unattributed reason', knownIds), // 1 unattributed
  ];
  itemFailures.slice(0, 9).forEach((f) => assert.notEqual(f.videoId, null, 'sanity: first 9 lines are attributed'));
  assert.equal(itemFailures[9].videoId, null, 'sanity: the 10th line is unattributed');
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 10 });
  assert.notEqual(result.outcome, 'partial', 'the sole remaining slot must not be phantom-credited as a success');
});

// ---- GF3 S1: subset-filter hardening (attributed <= targetIds membership) ----

// GF3 S1 (see failures.js's doc comment on `targetIdSet`): `attributed` is
// now filtered to `targetIds` membership inside the pure function itself,
// so a mismatched-id shape (a `videoId` that isn't actually a member of
// `targetIds`) can never inflate `attributed.size` -- and therefore
// `failed` -- past `target`. This is unreachable via real callers
// (`knownIds` is single-sourced from the same `targetIds` array), but this
// pure function must hold its `failed <= target` invariant under ANY input.
test('GF3 S1: attributed videoIds NOT present in targetIds never inflate failed past target (mismatched-id defense-in-depth)', () => {
  const targetIds = ['a'];
  // All three "attributed-shaped" entries below carry a truthy videoId, but
  // only 'a' is actually a member of targetIds -- 'x' and 'y' are strangers
  // to this cycle's own target set (a shape that couldn't arise from a real
  // parseItemFailureLine call, since its own knownIds membership check is
  // sourced from targetIds, but is directly constructible here since
  // computeDownloadOutcome is a plain pure function).
  const itemFailures = [
    { videoId: 'a', reason: 'real target failure' },
    { videoId: 'x', reason: 'stranger id, not a member of targetIds' },
    { videoId: 'y', reason: 'another stranger id, not a member of targetIds' },
  ];
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.ok(result.failed <= 1, `failed (${result.failed}) must never exceed target (1)`);
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 1 });
  assert.ok(['success', 'partial', 'error'].includes(result.outcome));
});

test('GF3 S1: targetIds: [] (target:0) with failures present never reports failed > 0', () => {
  const itemFailures = [
    { videoId: 'phantom1', reason: 'no real targets exist for this cycle' },
    { videoId: null, reason: 'unattributed, but still no real targets' },
  ];
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds: [] });
  assert.ok(result.failed <= 0, `failed (${result.failed}) must never exceed target (0)`);
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 0 });
});

// ---- exhaustiveness / mutual exclusivity of the three arms -------------------

test('the three outcome arms are mutually exclusive and exhaustive across a broad input sweep', () => {
  const cases = [
    { ok: true, itemFailures: [], targetIds: [] },
    { ok: true, itemFailures: [], targetIds: ['a'] },
    { ok: false, itemFailures: [], targetIds: [] },
    { ok: false, itemFailures: [], targetIds: ['a', 'b'] },
    { ok: false, itemFailures: [{ videoId: 'a', reason: 'x' }], targetIds: ['a'] },
    { ok: false, itemFailures: [{ videoId: 'a', reason: 'x' }], targetIds: ['a', 'b'] },
    { ok: false, itemFailures: [{ videoId: null, reason: 'x' }], targetIds: ['a'] },
    { ok: false, itemFailures: [{ videoId: null, reason: 'x' }], targetIds: ['a', 'b'] },
    // GF2 additions: the exact repro shape (now zero-attributed -> error) + a mixed attributed/unattributed shape.
    { ok: false, itemFailures: [{ videoId: null, reason: 'r1' }, { videoId: null, reason: 'r2' }], targetIds: ['a', 'b'] },
    // GF2: an attributed boundary that already consumes every target, PLUS
    // unattributed noise on top -- the remainingAfterAttributed > 0 guard
    // must keep succeeded at 0 and failed sane (never exceeding target).
    {
      ok: false,
      itemFailures: [
        { videoId: 'a', reason: 'x' },
        { videoId: null, reason: 'r1' },
        { videoId: null, reason: 'r2' },
        { videoId: null, reason: 'r3' },
      ],
      targetIds: ['a'],
    },
    {
      ok: false,
      itemFailures: [{ videoId: 'a', reason: 'x' }, { videoId: null, reason: 'r1' }, { videoId: null, reason: 'r2' }],
      targetIds: ['a', 'b', 'c'],
    },
    // GF3 S1 additions: mismatched-id / target:0 shapes -- re-confirms
    // failed <= target still holds once `attributed` is filtered to
    // targetIds membership (the subset filter can only tighten
    // attributed.size, never loosen it, so the invariant is preserved).
    { ok: false, itemFailures: [{ videoId: 'stranger', reason: 'x' }], targetIds: ['a'] },
    { ok: false, itemFailures: [{ videoId: 'stranger1', reason: 'x' }, { videoId: 'stranger2', reason: 'y' }], targetIds: [] },
    {
      ok: false,
      itemFailures: [
        { videoId: 'a', reason: 'real' },
        { videoId: 'stranger', reason: 'not a real target' },
        { videoId: null, reason: 'unattributed' },
      ],
      targetIds: ['a', 'b'],
    },
  ];
  const validOutcomes = new Set(['success', 'partial', 'error']);
  for (const input of cases) {
    const result = computeDownloadOutcome(input);
    const target = Array.isArray(input.targetIds) ? input.targetIds.length : 0;
    assert.ok(validOutcomes.has(result.outcome), `unexpected/ambiguous outcome for ${JSON.stringify(input)}: ${result.outcome}`);
    assert.ok(Number.isInteger(result.succeeded) && result.succeeded >= 0, `succeeded must be a non-negative integer for ${JSON.stringify(input)}`);
    assert.ok(Number.isInteger(result.failed) && result.failed >= 0, `failed must be a non-negative integer for ${JSON.stringify(input)}`);
    // GF2 invariant: failed must never exceed target (the
    // remainingAfterAttributed > 0 guard keeps unattributed noise from
    // inflating failed past what was actually targeted).
    assert.ok(result.failed <= target, `failed (${result.failed}) must never exceed target (${target}) for ${JSON.stringify(input)}`);
  }
});

test('success is decided by ok alone; partial requires !ok AND an attributed boundary (attributed.size >= 1) AND succeeded > 0; error is everything else under !ok (GF2)', () => {
  // success <=> ok === true
  assert.equal(computeDownloadOutcome({ ok: true, itemFailures: [], targetIds: ['a'] }).outcome, 'success');
  // !ok, no itemFailures -> error (never partial/success), per the Direction-A guard
  assert.equal(computeDownloadOutcome({ ok: false, itemFailures: [], targetIds: ['a'] }).outcome, 'error');
  // !ok, itemFailures present but ZERO attributed -> error (GF2 zero-attributed
  // override), never partial, regardless of how many unattributed lines exist
  assert.equal(
    computeDownloadOutcome({ ok: false, itemFailures: [{ videoId: null, reason: 'x' }], targetIds: ['a', 'b'] }).outcome,
    'error'
  );
  // !ok, itemFailures present, all targets consumed by attributed failures -> error, not partial
  assert.equal(
    computeDownloadOutcome({ ok: false, itemFailures: [{ videoId: 'a', reason: 'x' }], targetIds: ['a'] }).outcome,
    'error'
  );
  // !ok, an attributed boundary exists, some targets survive -> partial
  assert.equal(
    computeDownloadOutcome({ ok: false, itemFailures: [{ videoId: 'a', reason: 'x' }], targetIds: ['a', 'b'] }).outcome,
    'partial'
  );
});

// ---- defensive / malformed input never throws --------------------------------

test('computeDownloadOutcome: non-array targetIds is treated as length 0, never throws', () => {
  assert.doesNotThrow(() => computeDownloadOutcome({ ok: true, itemFailures: [], targetIds: null }));
  assert.deepEqual(computeDownloadOutcome({ ok: true, itemFailures: [], targetIds: null }), { outcome: 'success', succeeded: 0, failed: 0 });
  assert.deepEqual(computeDownloadOutcome({ ok: true, itemFailures: [], targetIds: undefined }), { outcome: 'success', succeeded: 0, failed: 0 });
  assert.deepEqual(computeDownloadOutcome({ ok: true, itemFailures: [], targetIds: 'not-an-array' }), { outcome: 'success', succeeded: 0, failed: 0 });
  assert.deepEqual(computeDownloadOutcome({ ok: false, itemFailures: [], targetIds: 42 }), { outcome: 'error', succeeded: 0, failed: 0 });
});

test('computeDownloadOutcome: non-array itemFailures is treated as empty (channel-level-failure guard applies), never throws', () => {
  assert.doesNotThrow(() => computeDownloadOutcome({ ok: false, itemFailures: null, targetIds: ['a', 'b'] }));
  assert.deepEqual(computeDownloadOutcome({ ok: false, itemFailures: null, targetIds: ['a', 'b'] }), { outcome: 'error', succeeded: 0, failed: 2 });
  assert.deepEqual(computeDownloadOutcome({ ok: false, itemFailures: undefined, targetIds: ['a', 'b'] }), { outcome: 'error', succeeded: 0, failed: 2 });
  assert.deepEqual(computeDownloadOutcome({ ok: false, itemFailures: 'not-an-array', targetIds: ['a', 'b'] }), { outcome: 'error', succeeded: 0, failed: 2 });
});

// GF2 (semantics changed -- see failures.js's doc comment): under GF1 this
// test asserted {outcome:'partial', succeeded:1, failed:3} via dedup-by-reason
// then a reserve-1 bound. None of these 5 malformed entries carries a valid
// non-empty string videoId, so `attributed.size === 0` -- the GF2
// zero-attributed override now governs regardless of the raw count: error,
// nothing credited.
test('computeDownloadOutcome: malformed entries inside itemFailures (null, missing videoId, non-string videoId) are treated as unattributed -> zero-attributed override -> error, never throw', () => {
  const targetIds = ['a', 'b', 'c', 'd'];
  const itemFailures = [
    null,
    {},
    { reason: 'no videoId field at all' },
    { videoId: 42, reason: 'non-string videoId' },
    { videoId: '', reason: 'empty-string videoId' },
  ];
  assert.doesNotThrow(() => computeDownloadOutcome({ ok: false, itemFailures, targetIds }));
  const result = computeDownloadOutcome({ ok: false, itemFailures, targetIds });
  assert.deepEqual(result, { outcome: 'error', succeeded: 0, failed: 4 });
});

test('computeDownloadOutcome: entirely missing/malformed params object still returns a sane non-throwing result', () => {
  assert.doesNotThrow(() => computeDownloadOutcome({}));
  assert.deepEqual(computeDownloadOutcome({}), { outcome: 'error', succeeded: 0, failed: 0 });
});

test('computeDownloadOutcome never mutates its input itemFailures/targetIds arrays', () => {
  const itemFailures = Object.freeze([Object.freeze({ videoId: 'a', reason: 'x' })]);
  const targetIds = Object.freeze(['a', 'b']);
  assert.doesNotThrow(() => computeDownloadOutcome({ ok: false, itemFailures, targetIds }));
});
