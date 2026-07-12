'use strict';

// v1.24.0 A2 (T14, FR-3+FR-7 phase a): pure parser for yt-dlp's OWN
// per-video error line, used to attribute a batched subscription download's
// aggregate stderr back to the specific survivor video it belongs to.
//
// GROUNDING (see lib/ytdlp/index.js's `runSubscriptionCycle` doc comment and
// this round's exec plan, Design section "A2"): `runSubscriptionCycle` calls
// `run.runDownload` ONCE with N positional `watch?v=<id>` URLs and no
// `--abort-on-error` -- yt-dlp's default behavior is to keep going to the
// next URL on a per-video failure, but the whole spawn still exits non-zero
// if ANY of them failed, and the pre-A2 result was a single aggregate
// `{code, stderr, error}` with zero per-video attribution. This file is the
// new attribution layer; it does not change how/whether yt-dlp is invoked.
//
// Same posture as lib/ytdlp/progress.js (this module's closest sibling):
// NEVER touches process state (no spawn, no fs, no globals), NEVER sees the
// argv/cookies path -- lib/ytdlp/run.js hands this function only
// already-decoded, plain-text lines from yt-dlp's OWN stderr, a channel
// wholly separate from the args array. Defensive by construction: any input
// that isn't recognized, or isn't a non-empty string, returns `null` --
// never throws, never half-produces a result.
//
// THE NEVER-MISATTRIBUTE GUARANTEE (the whole point of the two-reviewer
// gate on this file): yt-dlp's stderr is, by construction, UNTRUSTED text.
// This parser extracts a CANDIDATE id from the `ERROR: [<extractor>] <id>:
// <reason>` shape, but that candidate is only ever returned as `videoId`
// when it is a byte-for-byte member of the caller-supplied `knownIds` set --
// the EXACT survivor id list this spawn was told to target (see run.js's
// `opts.knownIds`, sourced from the same `targetIds` array that built the
// download's own positional URLs). A candidate that fails that membership
// check is returned as an UNATTRIBUTED entry (`{videoId: null, reason}`) --
// surfaced to the caller, never silently dropped, and never guessed onto
// the wrong id. There is no other path to a non-null `videoId` in this file.
//
// RESIDUAL RISK (documented for the adversarial gate, not a gap to silently
// paper over): unlike lib/ytdlp/run.js's FTCHMETA capture (which is
// restricted to stdout because that JSON payload gets PERSISTED to db.json),
// this parser reads stderr, which is not JSON-escaped -- a sufficiently
// unusual error path could in principle echo attacker-controlled text
// (e.g. a hostile video title/description) containing a raw newline that,
// once line-split, LOOKS like this shape. The blast radius is bounded and
// low-severity: (a) the forged id must be a byte-for-byte match against one
// of THIS cycle's own already-targeted survivor ids for `videoId` to be
// attributed at all (no cross-subscription/id leak, no arbitrary id
// injection), and (b) the only effect is a misleading REASON string shown in
// an already-unauthenticated, ephemeral, non-persisted status display (never
// written to db.json, never used to make a download/skip/delete decision) --
// never a filesystem, execution, or persistence impact.

// Matches yt-dlp's own per-video error line, e.g.:
//   ERROR: [youtube] dQw4w9WgXcQ: Video unavailable
//   ERROR: [youtube:tab] someId123: Sign in to confirm your age
// The extractor tag (inside the brackets) is not captured -- it plays no
// role in attribution, only the id/reason pair does. The id segment is
// deliberately tight (`[^\s:]+`, no whitespace/colon) since a real yt-dlp
// video id never contains either; a line whose "id" position contains one
// simply fails to match this shape at all (returns `null`), never coerced
// into a wrong-shaped match.
const ITEM_ERROR_RE = /^ERROR:\s*\[[^\]]*\]\s*([^\s:]+):\s*(.+)$/;

// v1.36.2 (Dean: "no transcripts must be non-blocking"): reasons that are
// SUBTITLE/TRANSCRIPT-scoped -- the media download itself is unaffected;
// only the caption fetch or the --convert-subs ffmpeg step failed. Matched
// case-insensitively against the sanitized reason text of both per-video
// and global ERROR lines. Deliberately narrow nouns (subtitle/caption/
// transcript + the flag names + a .vtt/.srt artifact mention) -- a reason
// merely CONTAINING e.g. "video" never qualifies, and an unmatched subtitle
// phrasing degrades to the old (blocking) classification, never the other
// way around.
const SUBTITLE_REASON_RE = /subtitl|caption|transcript|--write-subs|--convert-subs|\.vtt\b|\.srt\b/i;

// The global (non-per-video) ERROR line shape: everything after `ERROR:`
// that did NOT parse as ITEM_ERROR_RE (no `[extractor] <id>:` prefix) --
// e.g. yt-dlp's `ERROR: Postprocessing: ...`. Only consulted for the
// subtitle-only classification above; any other global error still parses
// as nothing (channel-level failure posture unchanged).
const GLOBAL_ERROR_RE = /^ERROR:\s*(.+)$/;

// Same defensive posture as lib/ytdlp/run.js's `STDERR_TAIL_LIMIT`: a
// `reason` is bounded so a pathological/adversarial (arbitrarily long) error
// line can never grow an accumulated failures list, or a downstream
// persisted/served payload, without bound.
const MAX_REASON_LENGTH = 500;

/**
 * Strips ASCII control characters (C0 + DEL) from `reason` text and caps its
 * length -- yt-dlp's stderr is untrusted and could in principle embed a
 * `\r`/terminal-escape sequence; this keeps every returned reason safe to
 * render as plain text. Callers still render it via `textContent`, never
 * `innerHTML` -- this is defense-in-depth at the source, not the only line
 * of defense.
 */
function sanitizeReason(raw) {
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return stripped.length > MAX_REASON_LENGTH ? stripped.slice(0, MAX_REASON_LENGTH) : stripped;
}

/**
 * Parse one line of yt-dlp download output into a per-video failure
 * attribution, or `null` when the line doesn't carry yt-dlp's own per-video
 * `ERROR: [<extractor>] <id>: <reason>` shape at all (a progress line, a
 * warning, blank output, or any other unrecognized text).
 *
 * @param {*} line a single already-decoded, newline-stripped line
 * @param {(Set<string>|string[]|undefined)} knownIds the EXACT survivor id
 *   set this download spawn was told to target -- the only ids attribution
 *   is ever confident enough to assign. Omitted/invalid is treated as an
 *   empty set (every candidate is then unattributed, never guessed).
 * @returns {({videoId: (string|null), reason: string} | null)} `null` for a
 *   non-matching line, or a line whose reason is empty after sanitization
 *   (nothing usable to surface); `{videoId: <id>, reason}` when the
 *   extracted id is a member of `knownIds`; `{videoId: null, reason}`
 *   (unattributed, surfaced) when it is not. Never throws.
 */
function parseItemFailureLine(line, knownIds) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (trimmed === '') return null;

  let match;
  try {
    match = ITEM_ERROR_RE.exec(trimmed);
  } catch {
    // Defensive: this parser must NEVER throw on odd/adversarial input.
    return null;
  }
  if (!match) {
    // v1.36.2 (Dean: "no transcripts must be non-blocking"): a subtitle
    // failure can ALSO surface as a global/postprocessing ERROR line with no
    // `[extractor] <id>:` prefix (e.g. "ERROR: Postprocessing: ..." from the
    // --convert-subs ffmpeg step). Pre-fix such a line parsed as nothing at
    // all, so an exit-1 caused purely by subtitles read as a channel-level
    // failure ("credit NOTHING"). Classify it as a subtitle-only marker so
    // computeDownloadOutcome can discount it -- see SUBTITLE_REASON_RE.
    const globalMatch = GLOBAL_ERROR_RE.exec(trimmed);
    if (globalMatch) {
      const globalReason = sanitizeReason(globalMatch[1]);
      if (globalReason !== '' && SUBTITLE_REASON_RE.test(globalReason)) {
        return { videoId: null, reason: globalReason, subtitleOnly: true };
      }
    }
    return null;
  }

  const reason = sanitizeReason(match[2]);
  if (reason === '') return null; // no usable reason text left -- nothing to surface

  // v1.36.2: a per-video ERROR whose reason is subtitle/caption-scoped (the
  // media itself downloaded fine -- only the transcript fetch/convert
  // failed) is tagged subtitleOnly. It keeps its attribution (id + reason,
  // for diagnostics) but computeDownloadOutcome no longer counts it as a
  // failed VIDEO, and the activity/history surfacing filters it out.
  const subtitleOnly = SUBTITLE_REASON_RE.test(reason);

  const candidateId = match[1];
  const known = knownIds instanceof Set
    ? knownIds
    : new Set(Array.isArray(knownIds) ? knownIds : []);
  if (known.has(candidateId)) {
    return subtitleOnly ? { videoId: candidateId, reason, subtitleOnly: true } : { videoId: candidateId, reason };
  }
  // Never guessed/coerced onto a near-miss id -- an id not in `knownIds` is
  // ALWAYS unattributed, surfaced rather than silently dropped.
  return subtitleOnly ? { videoId: null, reason, subtitleOnly: true } : { videoId: null, reason };
}

/**
 * Classify a completed (or aborted) download spawn's result into a single
 * exhaustive/disjoint outcome -- `success` | `partial` | `error` -- with
 * `succeeded`/`failed` counts. This is THE both-directions failure-masking
 * containment point (v1.29 Downloads Reliability wave, T3(a)): today a
 * single failed video in a batched channel download makes yt-dlp exit
 * non-zero and the caller marks the WHOLE channel failed, discarding any
 * videos that actually succeeded (root cause 1). The fix must not swing to
 * the opposite failure mode -- masking a real total failure as
 * success/partial. Both directions are covered by this function's three
 * arms:
 *
 * - `success` <=> `ok === true`.
 * - `partial` <=> `!ok` AND `itemFailures.length > 0` AND `attributed.size >= 1`
 *   (a real target boundary exists) AND `succeeded > 0` after the bounded
 *   unattributed contribution below.
 * - `error`   <=> `!ok` AND (`itemFailures.length === 0` OR `attributed.size
 *   === 0` OR `succeeded === 0` after accounting).
 *
 * These three are exhaustive and disjoint by construction -- the function
 * body is a single `if`/`return` chain, so every input hits exactly one
 * `return` statement, never zero, never more than one:
 *   1. `ok` -> `success`. (Only path to `success`.)
 *   2. `!ok`, `failures.length === 0` -> `error` (channel-level guard).
 *   3. `!ok`, `failures.length > 0`, `attributed.size === 0` -> `error`
 *      (GF2 zero-attributed override, see below).
 *   4. `!ok`, `attributed.size >= 1`, `succeeded === 0` after the bounded
 *      unattributed contribution -> `error`.
 *   5. `!ok`, `attributed.size >= 1`, `succeeded > 0` -> `partial`.
 * Every input falls into exactly one of these five mutually-exclusive
 * conditions (they partition on `ok`, then on `failures.length`, then on
 * `attributed.size`, then on the sign of `succeeded` -- each a total order
 * over its domain), and (1)/(3)/(4) collapse to the same `error` return
 * value while (5) is the sole `partial` return -- so the three ARMS remain
 * exhaustive and disjoint even though five conditions feed them. (GF2: this
 * is a full rework of the GF1 F1 fix below -- the adversarial delta re-gate
 * found GF1's bias unsound; see "GF2" below.)
 *
 * Direction A (a real total failure must still surface as `error`, never
 * masked as partial/success) is held FOUR ways: (1) the `itemFailures.length
 * === 0` early return -- a CHANNEL-LEVEL failure (bot-check / 429 / age-gate
 * / members-only, i.e. yt-dlp's spawn failed before any per-item line was
 * even attributable) has zero per-item lines by construction, so nothing is
 * ever credited as succeeded; (2) the GF2 ZERO-ATTRIBUTED OVERRIDE -- when
 * there IS failure evidence but NONE of it could be tied to a known target
 * id, there is no real target boundary to reserve a "credited" slot
 * against, so the outcome is `error` with nothing credited, full stop (this
 * supersedes GF1's reserve-at-least-one bias for this exact shape -- see
 * "GF2" below); (3) every target id ATTRIBUTED as failed (a `videoId` match
 * against `knownIds`) is counted via an exact `Set`, one failure per
 * distinct id, no cap, no dedup-driven undercount -- so a true
 * all-attributed-failed run always lands on `succeeded === 0`; and (4) the
 * reserve-at-least-one bound (reached only once an attributed boundary
 * exists) is gated so it can never push `failed` past `target` -- attributed
 * failures alone already consuming every target keeps `succeeded === 0` and
 * extra unattributed noise on top changes nothing.
 *
 * Direction B (a real partial success must not be collapsed into total
 * failure) is the `succeeded > 0` branch -- reachable ONLY once at least one
 * ATTRIBUTED failure establishes a real target boundary (GF2): exact
 * attributed-id accounting (unchanged, unbounded) plus a bounded
 * contribution from the RAW (undeduped) unattributed evidence.
 *
 * GF2 (this round -- supersedes GF1 F1 entirely): the adversarial delta
 * re-gate issued a CRITICAL against GF1's fix, which deduped unattributed
 * failures by `reason` TEXT before bounding them. The reason the CRITICAL
 * was raised: yt-dlp emits GENERIC TEMPLATED stderr -- "Sign in to confirm
 * you're not a bot" (429), age-gate, "Video unavailable" -- BYTE-FOR-BYTE
 * IDENTICAL across DISTINCT videos. Deduping by that text before bounding
 * therefore collapsed 5 different videos failing with the identical 429
 * text down to a SINGLE dedup key, which the reserve-at-least-one bound
 * then read as "1 failure, room to credit 4 successes" -- PHANTOM successes
 * GF1 itself introduced while fixing the pre-GF1 bug (GF1's own fixture,
 * this file's sibling test "identical reason text... dedupe to a single
 * failure, crediting the rest as succeeded", demonstrated the exact
 * mechanism). Two further consequences were traced: a false `partial`
 * advances `cutoffDate` (`--dateafter` is the sole listing filter), so the
 * failed window became PERMANENTLY unreachable via both auto-poll and
 * Retry; and the metadata fallback recorded every unattributed-surviving id
 * as if genuinely succeeded.
 *
 * GF2's fix, in full:
 *
 *   1. REASON-DEDUP IS REMOVED. Unattributed accounting now uses the RAW
 *      count of unattributed entries (`{videoId: null, reason}` -- a
 *      candidate id that failed the `knownIds` membership check, or any
 *      malformed entry) -- NOT deduped by `reason` text. Two lines with an
 *      identical reason string are two pieces of evidence, not one, because
 *      yt-dlp's own generic templated stderr makes "identical text" carry
 *      zero information about whether it names one video or five.
 *      Attributed-failure accounting (the exact `videoId` `Set`) is
 *      UNCHANGED -- that dedup stays sound because a `videoId` is a real,
 *      trustworthy per-video identity, unlike free-text `reason`.
 *   2. ZERO-ATTRIBUTED OVERRIDE (new, the headline fix): when there is
 *      failure evidence (`failures.length > 0`, already past the
 *      channel-level guard) but `attributed.size === 0` -- NOT ONE failure
 *      could be tied to a known target id -- the outcome is `error`,
 *      `succeeded: 0`, `failed: target`. With zero attribution there is no
 *      real target BOUNDARY to reserve a "credited" slot against, so
 *      crediting even one target as succeeded would be exactly the
 *      phantom-success masking this wave exists to prevent. The CRITICAL's
 *      5-same-429 repro (5 targets, 5 unattributed failures, identical
 *      reason text, zero attributed) lands here: `error`, `succeeded: 0`,
 *      never `failed:1/succeeded:4`.
 *   3. RESERVE-AT-LEAST-ONE, now reached ONLY once `attributed.size >= 1`
 *      (a real target boundary exists): the RAW unattributed count still
 *      contributes toward `failed`, bounded so it alone can never be the
 *      SOLE reason every remaining target is deemed failed -- WITH ONE
 *      DELIBERATE, BY-DESIGN EXCEPTION at the `remainingAfterAttributed ===
 *      1` boundary, documented in full under "GF3 W1" below --
 *      `remainingAfterAttributed = target - attributed.size`;
 *      `unattributedContribution = remainingAfterAttributed > 0
 *          ? Math.max(1, Math.min(rawUnattributedCount, remainingAfterAttributed - 1))
 *          : 0` (the `remainingAfterAttributed > 0` guard keeps `failed`
 *      from ever exceeding `target` when attributed failures alone already
 *      consumed every target -- Direction A's `succeeded === 0` is already
 *      settled there and extra unattributed noise cannot un-settle it, nor
 *      inflate the reported `failed` count past `target`); `failed =
 *      attributed.size + unattributedContribution`; `succeeded =
 *      Math.max(0, target - failed)`.
 *
 * The exact GF1 F1 gate repro (`itemFailures: [{videoId:null,reason:'r1'},
 * {videoId:null,reason:'r2'}], targetIds:['a','b']`) has ZERO attributed
 * failures, so GF2's override (2) now governs: `{outcome:'error',
 * succeeded:0, failed:2}` -- NOT the GF1 `{outcome:'partial', succeeded:1,
 * failed:1}` result. This is intentional and SUPERSEDES GF1's resolution of
 * that repro: GF1 fixed the pre-GF1 bug (raw-count-no-bound deflating a
 * genuine partial into error) by introducing a new bug (dedup-by-reason
 * phantom successes); GF2 fixes both by removing the dedup AND requiring a
 * real attributed boundary before crediting anything at all.
 *
 * DOCUMENTED (RESOLVED) RESIDUAL RISK: GF1 accepted, as a documented cost,
 * that a run where EVERY target genuinely failed but NONE of those failures
 * could be attributed to a known id (every line unattributed) was reported
 * `partial` with one target credited `succeeded`, rather than `error` with
 * `succeeded: 0` -- exactly the CRITICAL. GF2's zero-attributed override (2
 * above) closes this: that shape is now unconditionally `error`,
 * `succeeded: 0`, regardless of how many unattributed lines exist or
 * whether their reason text repeats (see the `GF2 F1: all-unattributed`
 * lock in `ytdlp-download-outcome.test.js`). The reserve-at-least-one bias
 * from GF1 survives ONLY in the narrower, already-has-an-attributed-boundary
 * case (3 above), where it still credits at least 1 unattributed failure
 * (AC-FM-D: never silently dropped) but never more than
 * `remainingAfterAttributed - 1` (never lets unattributed noise alone claim
 * every remaining target) -- that residual ambiguity (raw unattributed
 * lines carry no id, so a batch of them carries no proof of mutual
 * distinctness) is unavoidable for that narrower shape, but it can no
 * longer manufacture a phantom success with zero attributed evidence, which
 * is what the CRITICAL required.
 *
 * GF3 W1 (DELIBERATE, by design -- not a bug, and not a doc-vs-code
 * contradiction): at the exact boundary `remainingAfterAttributed === 1`
 * (precisely one target remains after attributed accounting) with
 * `rawUnattributedCount >= 1`, point 3's bound evaluates to `Math.max(1,
 * Math.min(raw, remainingAfterAttributed - 1)) = Math.max(1, Math.min(raw,
 * 0)) = 1` -- the unattributed evidence consumes the SOLE remaining slot, so
 * `succeeded` lands at 0 and the outcome is `error`, not `partial`. This is
 * the one shape where "reserve-at-least-one" (AC-FM-D: an unattributed
 * failure is always counted, never silently dropped) and "unattributed noise
 * alone can never claim EVERY remaining target" cannot both hold in full --
 * there is exactly one slot left, and honoring AC-FM-D means that slot is
 * spent. GF2's original adversarial re-gate flagged this as a code-vs-doc
 * contradiction (W1); Dean's GF3 resolution is to KEEP the conservative
 * code behavior exactly as-is and correct the doc to state it deliberately:
 * AC-FM-D intentionally WINS over reserve-at-least-one at this single
 * boundary. The function prefers to under-credit a POSSIBLE success
 * (`error`, one extra retry cycle on the next poll with `cutoffDate` frozen
 * -- Direction A stays safe, no window is ever lost) rather than credit a
 * PHANTOM one on the strength of unattributed, un-id'd evidence alone. See
 * the `GF3 W1 boundary lock` test in `ytdlp-download-outcome.test.js` (9
 * attributed + 1 unattributed / 10 targets -> `error`/`succeeded:0`/
 * `failed:10`), which pins this exact shape so a future refactor cannot
 * silently flip it.
 *
 * Pure by construction: no fs, no logging, no spawn, no mutation of its
 * inputs, deterministic for a given input. Never throws -- malformed
 * `targetIds`/`itemFailures` (non-array, or arrays containing `null`/
 * malformed entries) degrade to safe, conservative defaults rather than
 * throwing or crediting anything ambiguous.
 *
 * @param {object} params
 * @param {boolean} params.ok whether the underlying download spawn reported
 *   overall success (yt-dlp exit code 0). Any falsy value is treated as
 *   failure.
 * @param {(Array<{videoId: (string|null), reason: string}>|*)} params.itemFailures
 *   the per-item failure attributions for this spawn, as produced by
 *   `parseItemFailureLine` (see above) -- `{videoId: <known id>, reason}`
 *   for an attributed failure, `{videoId: null, reason}` for an
 *   unattributed one. A non-array value is treated as an empty list.
 * @param {(Array<string>|*)} params.targetIds the full set of ids this
 *   spawn was told to download. A non-array value is treated as an empty
 *   list (length 0).
 * @returns {{outcome: ('success'|'partial'|'error'), succeeded: number, failed: number}}
 */
function computeDownloadOutcome({ ok, itemFailures, targetIds }) {
  const target = Array.isArray(targetIds) ? targetIds.length : 0;
  const allFailures = Array.isArray(itemFailures) ? itemFailures : [];
  // v1.36.2 (Dean: "no transcripts must be non-blocking"): subtitle-only
  // failure lines (see parseItemFailureLine's SUBTITLE_REASON_RE tagging)
  // never count against VIDEOS -- the media downloaded fine; only the
  // transcript fetch/convert failed. They are partitioned out here, and if
  // a non-zero exit was caused PURELY by subtitle errors, the run is an
  // honest SUCCESS (pre-fix it read as a channel-level failure: outcome
  // 'error', nothing credited, a red history row for a completed download).
  const failures = allFailures.filter((f) => !(f && f.subtitleOnly === true));
  const subtitleOnlyCount = allFailures.length - failures.length;
  if (ok) return { outcome: 'success', succeeded: target, failed: 0 };
  if (failures.length === 0 && subtitleOnlyCount > 0) {
    return { outcome: 'success', succeeded: target, failed: 0 };
  }
  // !ok with ZERO per-item attribution === a channel-level failure
  // (bot-check / 429 / age-gate / members-only before any item started):
  // credit NOTHING, surface the real reason. (Direction A guard.)
  if (failures.length === 0) return { outcome: 'error', succeeded: 0, failed: target };

  // Attributed failures: exact, deduped by videoId -- UNCHANGED by GF2. A
  // `videoId` is a real, trustworthy per-video identity, so this dedup is
  // sound; it is never bounded or discounted.
  //
  // GF3 S1 (defense-in-depth): also required to be a member of `targetIds`
  // itself, via `targetIdSet` below. In real usage this membership always
  // holds -- `parseItemFailureLine`'s own `knownIds` membership check is
  // single-sourced from the same `targetIds` this cycle downloads, so a
  // `videoId` reaching here can never be a stranger to `targetIds` -- but
  // this pure function takes `itemFailures`/`targetIds` as plain,
  // independently-suppliable params with no enforced coupling between them,
  // so a mismatched-id or `targetIds: []` input could otherwise let
  // `attributed.size` (and therefore `failed`) exceed `target`. Filtering to
  // `targetIdSet` membership here guarantees `attributed.size <=
  // targetIdSet.size <= target`, which keeps the function's `failed <=
  // target` invariant sound under ANY input, not just well-formed ones --
  // still pure/defensive, no throw.
  const targetIdSet = new Set(Array.isArray(targetIds) ? targetIds : []);
  const attributed = new Set(
    failures.map((f) => (f && typeof f.videoId === 'string' && f.videoId ? f.videoId : null))
            .filter((id) => Boolean(id) && targetIdSet.has(id)),
  );

  // GF2 zero-attributed override (supersedes GF1 F1 -- see doc comment
  // above): failure evidence exists, but NOT ONE line could be tied to a
  // known target id, so there is no real target boundary to credit a
  // success against. Crediting one here would be exactly the
  // phantom-success masking the CRITICAL flagged (5 distinct videos each
  // failing with byte-identical templated stderr, e.g. the 429 text, must
  // never read as failed:1/succeeded:4). error, nothing credited.
  if (attributed.size === 0) return { outcome: 'error', succeeded: 0, failed: target };

  // GF2: the RAW (undeduped) unattributed count -- the GF1 reason-text
  // dedup step is REMOVED. yt-dlp's stderr is generic/templated, so two
  // lines sharing identical reason text are still two independent pieces
  // of failure evidence, not one.
  const rawUnattributedCount = failures.filter(
    (f) => !f || typeof f.videoId !== 'string' || !f.videoId,
  ).length;

  // Reserve-at-least-one bound, reached only now that an attributed
  // boundary exists (attributed.size >= 1, guaranteed by the override
  // above): credit unattributed evidence toward `failed`, but never let it
  // alone claim every remaining target (`remainingAfterAttributed - 1`),
  // and never silently drop it (`Math.max(1, ...)`, AC-FM-D) -- while never
  // pushing `failed` past `target` when attributed failures alone already
  // consumed every target (the `remainingAfterAttributed > 0` guard).
  const remainingAfterAttributed = Math.max(0, target - attributed.size);
  let unattributedContribution = 0;
  if (rawUnattributedCount > 0 && remainingAfterAttributed > 0) {
    unattributedContribution = Math.max(1, Math.min(rawUnattributedCount, remainingAfterAttributed - 1));
  }

  const failed = attributed.size + unattributedContribution;
  const succeeded = Math.max(0, target - failed);
  if (succeeded > 0) return { outcome: 'partial', succeeded, failed };
  return { outcome: 'error', succeeded: 0, failed }; // all attributable ids failed
}

module.exports = {
  parseItemFailureLine,
  computeDownloadOutcome,
  MAX_REASON_LENGTH,
};
