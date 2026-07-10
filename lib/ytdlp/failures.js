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
  if (!match) return null;

  const reason = sanitizeReason(match[2]);
  if (reason === '') return null; // no usable reason text left -- nothing to surface

  const candidateId = match[1];
  const known = knownIds instanceof Set
    ? knownIds
    : new Set(Array.isArray(knownIds) ? knownIds : []);
  if (known.has(candidateId)) {
    return { videoId: candidateId, reason };
  }
  // Never guessed/coerced onto a near-miss id -- an id not in `knownIds` is
  // ALWAYS unattributed, surfaced rather than silently dropped.
  return { videoId: null, reason };
}

module.exports = {
  parseItemFailureLine,
  MAX_REASON_LENGTH,
};
