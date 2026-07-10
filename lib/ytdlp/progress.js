'use strict';

// Pure, defensive parser for yt-dlp's `--newline` progress output (FR-E).
// `parseProgressLine(line)` turns ONE line of yt-dlp's download-time stdout/
// stderr text into a small status PATCH object, or `null` when the line
// carries no progress signal. This file NEVER touches process state (no
// spawn, no fs, no globals) and NEVER sees the cookies path or the argv --
// lib/ytdlp/run.js only ever hands this function already-decoded, plain-text
// lines from yt-dlp's OWN stdout, which is a wholly separate channel from
// the args array. It also does NOT parse yt-dlp's `--dump-json` metadata --
// that NDJSON is a different, unrelated stream handled by rules.js on the
// LIST pass; this is strictly the free-text, line-oriented progress stream a
// DOWNLOAD prints when run with `--newline`.
//
// Defensive by construction: any input that isn't a non-empty string, or any
// line this parser doesn't recognize, returns `null` -- never throws, never
// half-produces a patch. A yt-dlp version drift that changes this text
// format degrades to "no percent, coarser state only" (the orchestrator's
// listing/downloading/done/error transitions are NOT driven by this parser),
// never a crash.

// `[download]  47.2% of  120.5MiB at 3.20MiB/s ETA 00:25` (also matches the
// no-ETA variant yt-dlp prints once a download finishes, e.g.
// `100% of  120.50MiB in 00:00:38 at 3.13MiB/s`, and the unknown-speed/ETA
// form `0.0% of  10.00MiB at  Unknown speed ETA Unknown`, where the ENTIRE
// "Unknown speed" text -- two words -- is itself the speed field's value).
// yt-dlp right-justifies the percentage with variable leading whitespace for
// alignment (the "double-space" formatting referenced in the task) -- `\s+`
// after `[download]` absorbs any amount of it. Percent/speed/eta are pulled
// out with separate, targeted sub-patterns (below) rather than one large
// composite regex -- the trailing text shape varies too much (with-ETA,
// without-ETA, multi-word "Unknown speed") for a single anchored pattern to
// stay both correct and readable.
const PERCENT_RE = /\[download\]\s+([\d.]+)%/i;
const ETA_SUFFIX_RE = /ETA\s+(\S+)\s*$/i;
const SPEED_RE = /\bat\s+(.+?)\s*$/i;

// `[download] Destination: /downloads/Channel/Title [dQw4w9WgXcQ].mp4`
//
// v1.26 code-review fix (F6): anchored to the START of the (already-trimmed)
// line -- a real yt-dlp `[download] Destination:` line is always its own
// whole-line print, never a substring embedded mid-line. Without the `^`
// anchor, a HOSTILE video title containing this exact text (e.g. one crafted
// to read `[download] Destination:` inside it) landing on some OTHER printed
// line (a title echo, an error message, ...) could spuriously match here and
// reset `percent`/`phase`/`title` mid-download -- the anchor closes that off
// structurally, the same defensive posture MERGER_RE/EXTRACT_AUDIO_RE/etc.
// already use (`^\[Tag\]`) below.
const DESTINATION_RE = /^\[download\]\s+Destination:\s+(.+?)\s*$/i;

// `[download] Title [dQw4w9WgXcQ].mp4 has already been downloaded`
const ALREADY_DOWNLOADED_RE = /\[download\]\s+(.+?)\s+has already been downloaded\s*$/i;

// `[download] Downloading item 3 of 12` -- printed once per positional URL
// when a single yt-dlp invocation is given multiple targets (exactly how
// buildYtdlpDownloadArgs invokes it: ONE spawn, N survivor URLs).
const ITEM_OF_RE = /\[download\]\s+Downloading item\s+(\d+)\s+of\s+(\d+)/i;

// `[youtube] dQw4w9WgXcQ: Downloading webpage` / `... Downloading m3u8 ...`
// etc -- printed once per video as yt-dlp starts working on it.
const YOUTUBE_ITEM_RE = /\[youtube\]\s+(\S+?):\s*Downloading/i;

// ---- v1.26 "real progress" phase patches -----------------------------------
//
// Everything above only ever fires DURING the byte-transfer window of a
// `[download]` stream. Once every requested format has finished
// transferring, yt-dlp hands off to ffmpeg-backed postprocessors -- muxing
// separate video+audio streams together, extracting audio, or remuxing/
// re-encoding the final container -- and NONE of them print a `[download]`
// line or a percent while they run. That gap (which can be the majority of
// a short clip's total wall-clock time) previously produced zero patches at
// all, so the live entry's `percent` sat stuck at the last stream's value
// and looked frozen exactly when real work was happening.
//
// Each regex below is anchored to ONLY the postprocessor's fixed `[Tag]`
// prefix, never the free-text message that follows it -- yt-dlp's exact
// trailing wording (e.g. "Merging formats into ...") is not something this
// module depends on staying byte-for-byte stable across versions; matching
// just the tag keeps this resilient to that kind of wording drift, in the
// same defensive spirit as the rest of this file (a line this parser no
// longer recognizes just degrades to "no signal", never a crash).
//
// Phase vocabulary is deliberately small -- exactly two values:
//   'merging'    -- muxing separate streams together, or a post-merge
//                    container fix-up ([Merger], [Fixup*])
//   'converting' -- pulling out/re-encoding a single stream into a
//                    different form ([ExtractAudio], [VideoConvertor]/
//                    [VideoRemuxer])
// Real yt-dlp output was captured for the byte-transfer/extraction lines
// this file already parsed (see test/unit/ytdlp-progress.test.js's header
// comment); the postprocessor tag NAMES below are yt-dlp's well-documented,
// stable postprocessor identifiers (their PP_NAME), but ffmpeg was not
// available in the environment these regexes were verified in, so the exact
// merge/convert TRAILING TEXT could not be captured from a real run --
// hence anchoring to the tag alone rather than the full message.

// `[Merger] Merging formats into "/downloads/x/Video [id].mp4"` -- printed
// once ffmpeg starts muxing multiple already-downloaded streams (e.g.
// separate video+audio) into one container.
const MERGER_RE = /^\[Merger\]/i;

// `[ExtractAudio] Destination: ...` -- printed when `-x`/`--extract-audio`
// pulls just the audio track out of an already-downloaded file.
const EXTRACT_AUDIO_RE = /^\[ExtractAudio\]/i;

// `[VideoRemuxer] Remuxing video from webm to mp4; Destination: ...` /
// `[VideoConvertor] Converting video from ... to ...` -- printed by
// `--remux-video`/`--recode-video` re-containerizing/re-encoding the final
// file.
const VIDEO_CONVERT_RE = /^\[(?:VideoConvertor|VideoRemuxer)\]/i;

// `[FixupM3u8]`/`[FixupM4a]`/`[FixupStretched]`/`[FixupTimestamp]`/
// `[FixupDuration]` -- yt-dlp's small family of post-download container-level
// fix-up postprocessors, all sharing the `Fixup*` tag prefix.
const FIXUP_RE = /^\[Fixup\w*\]/i;

/**
 * Strip a trailing directory path and file extension from a destination-
 * style string, returning just the base filename stem. Returns `null` for
 * anything that isn't a usable non-empty string -- never throws.
 */
function basenameNoExt(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const segments = value.split(/[\\/]/);
  const base = segments[segments.length - 1];
  if (!base) return null;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

// Small, DISPLAY-ONLY cosmetic cleanup mirroring FR-F's shape (strip a
// trailing bracketed exactly-11-char id, underscore -> space) so a LIVE
// in-progress title looks similar to the eventually-indexed one. This is
// deliberately NOT the FR-F source of truth (server.js's own
// `cleanDisplayTitle`, applied to the persisted library title) -- it is a
// tiny, independent, non-security formatting nicety for the ephemeral
// activity map only, and a name that doesn't match the shape is returned
// unchanged rather than mangled.
//
// v1.15.1 hotfix: `name` here is ALREADY extension-stripped by
// `basenameNoExt` (above) -- but only its FINAL extension. A yt-dlp
// per-format fragment/merge-temp destination like
// `"<Title> [<id>].f399.mp4"` or `"<Title> [<id>].temp.mp4"` therefore still
// arrives here as `"<Title> [<id>].f399"` / `"<Title> [<id>].temp"` -- the
// pre-fix regex only matched a bracket at the VERY end of the string, so
// these fell through unchanged and leaked yt-dlp's raw fragment/merge-temp
// infix into the live status (e.g. `"TRUMP FIXED THE WORLD CUP
// [wSx0Or20MZE].f399"` instead of the clean `"TRUMP FIXED THE WORLD CUP"`).
// The regex below allows an OPTIONAL trailing `.f<digits>` (per-format
// fragment) or `.temp` (merge temp) infix after the id bracket -- a normal
// `"<Title> [<id>]"` (no fragment/temp suffix) still matches exactly as
// before.
function tidyTitle(name) {
  if (typeof name !== 'string') return name;
  const match = /^(.*?)[ _]\[[A-Za-z0-9_-]{11}\](?:\.f\d+|\.temp)?$/.exec(name);
  if (!match) return name; // not a yt-dlp-shaped name -- returned untouched, like FR-F's cleanDisplayTitle
  const cleaned = match[1].replace(/_/g, ' ').trim();
  return cleaned === '' ? name : cleaned;
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse one line of yt-dlp `--newline` download output into a status patch,
 * or `null` when the line carries no progress signal. Never throws --
 * garbage/odd input (non-string, empty, unrecognized text) is always a safe
 * `null`, never a partial/malformed patch.
 * @param {*} line a single line of text (no trailing newline expected, but
 *   tolerated)
 * @returns {({state?: string, percent?: number, speed?: string, eta?: string,
 *   title?: string, index?: number, total?: number, videoId?: string,
 *   phase?: ('merging'|'converting'|null)} | null)} note: never includes a
 *   `destination` field --
 *   FIX-8 (two-reviewer gate) dropped it to avoid leaking an absolute
 *   filesystem path into the (unauthenticated) status snapshot; only the
 *   already-tidied cosmetic `title` (a basename) is kept.
 */
function parseProgressLine(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (trimmed === '') return null;

  try {
    const destMatch = DESTINATION_RE.exec(trimmed);
    if (destMatch) {
      const destination = destMatch[1].trim();
      // FIX-8 (two-reviewer gate): `destination` is yt-dlp's full ABSOLUTE
      // path (`[download] Destination: <abs path>`). This patch is merged
      // into the ephemeral activity map and served VERBATIM, unauthenticated,
      // by `GET /api/subscriptions/status` -- an absolute filesystem path
      // (which can reveal the host's directory layout/username/mount
      // structure) must never be persisted/served from here. Only the
      // cosmetic, already-tidied TITLE (a basename, never a path) is kept.
      //
      // v1.26: a Destination line means a BRAND NEW stream is starting (the
      // video track, then -- separately -- the audio track, each its own
      // `[download]` sequence from 0-100%). `percent` is otherwise STICKY
      // (activity.js's `mergeEntry` shallow-merges, so a later patch that
      // omits `percent` never clears a prior value) -- without this reset,
      // the gap between the video stream hitting 100% and the audio
      // stream's first percent line would keep showing a stale "100%" that
      // reads as "done" when in fact a whole second stream is only just
      // starting. Resetting to 0 here makes that restart visible instead of
      // looking frozen at 100. `phase` is reset too, defensively: a phase
      // set by a PRIOR item in a multi-target spawn (see ITEM_OF_RE) must
      // never leak into a later item's fresh download as a stale "Merging…"
      // label.
      const patch = { state: 'downloading', percent: 0, phase: null };
      const rawTitle = basenameNoExt(destination);
      if (rawTitle) patch.title = tidyTitle(rawTitle);
      return patch;
    }

    const alreadyMatch = ALREADY_DOWNLOADED_RE.exec(trimmed);
    if (alreadyMatch) {
      // FIX-4 (two-reviewer gate): a per-ITEM "already downloaded" line must
      // NOT flip state to the terminal 'done' -- `buildYtdlpDownloadArgs`
      // invokes yt-dlp with potentially MANY survivor targets in ONE spawn,
      // so this line fires once per already-archived item within a
      // multi-item subscription download, not once for the whole
      // subscription. Only the ORCHESTRATOR (`runSubscriptionCycle`/
      // `runOneShot` in lib/ytdlp/index.js), AFTER the whole spawn settles,
      // may set a subscription/one-shot to a terminal state. `percent: 100`
      // is still item-level-accurate (this one file is fully present), just
      // never terminal on its own.
      // v1.26 code-review fix (F3): `phase` is reset here too, same reasoning
      // as the DESTINATION_RE branch above -- `buildYtdlpDownloadArgs` can
      // target MANY survivor ids in one spawn, and this "already downloaded"
      // line is itself the natural per-item boundary a subsequent item's
      // fresh work starts from. Without this, an "already downloaded" item 2
      // arriving right after item 1's postprocess merge finished would
      // otherwise leave item 1's stale `phase: 'merging'` rendering
      // indefinitely -- no LATER line in item 2's (percent-less) processing
      // would ever clear it.
      const patch = { state: 'downloading', percent: 100, phase: null };
      const rawTitle = basenameNoExt(alreadyMatch[1].trim());
      if (rawTitle) patch.title = tidyTitle(rawTitle);
      return patch;
    }

    const itemMatch = ITEM_OF_RE.exec(trimmed);
    if (itemMatch) {
      const index = toFiniteNumber(itemMatch[1]);
      const total = toFiniteNumber(itemMatch[2]);
      if (index === null || total === null) return null;
      // v1.26 code-review fix (F3): `phase` is reset here too -- "Downloading
      // item N of M" is yt-dlp's own natural new-item boundary within a
      // multi-target spawn, same reasoning as the DESTINATION_RE/
      // ALREADY_DOWNLOADED_RE branches above: a phase set by the PRIOR item's
      // postprocess step must never leak into this next item's fresh window.
      return { state: 'downloading', index, total, phase: null };
    }

    const percentMatch = PERCENT_RE.exec(trimmed);
    if (percentMatch) {
      const percent = toFiniteNumber(percentMatch[1]);
      if (percent === null) return null;
      // FIX-4 (two-reviewer gate): a per-item `[download] 100%` line (this is
      // ITEM-level progress -- one spawn can target many survivor ids, see
      // the ALREADY_DOWNLOADED_RE branch's comment above) must not flip the
      // whole subscription/one-shot to the terminal 'done' state -- that is
      // the orchestrator's call to make, strictly AFTER its `runDownload`
      // await settles for the ENTIRE target set. Always 'downloading' here;
      // `percent` still faithfully reports this item's own completion.
      //
      // v1.26: `phase` is explicitly cleared (`null`, not omitted) whenever a
      // REAL percent line arrives. `mergeEntry` (activity.js) shallow-merges
      // `{...existing, ...patch}`, so an explicit `phase: null` key here DOES
      // overwrite a prior sticky `'merging'`/`'converting'` value (unlike
      // simply omitting the field, which would leave it untouched) -- this is
      // what keeps a genuinely resumed/retried transfer from continuing to
      // display a stale "Merging…" label once real byte-transfer progress is
      // flowing again.
      const patch = { state: 'downloading', percent, phase: null };
      // The text AFTER the percent match carries the optional "of <size> at
      // <speed> [ETA <eta>]" tail -- extracted independently since which
      // parts are present varies (a finished-download summary line has no
      // ETA; an unknown-speed line's speed value is itself multi-word).
      const rest = trimmed.slice(percentMatch.index + percentMatch[0].length);
      const etaMatch = ETA_SUFFIX_RE.exec(rest);
      let restForSpeed = rest;
      if (etaMatch) {
        patch.eta = etaMatch[1];
        restForSpeed = rest.slice(0, etaMatch.index);
      }
      const speedMatch = SPEED_RE.exec(restForSpeed);
      if (speedMatch && speedMatch[1].trim() !== '') {
        patch.speed = speedMatch[1].trim();
      }
      return patch;
    }

    // v1.26 "real progress" phase patches -- see the block comment above
    // MERGER_RE for the full rationale. None of these carry a percent (there
    // isn't one to report), so `percent` is deliberately left untouched here
    // (sticky at whatever the last real transfer percent was) -- the CLIENT
    // is responsible for treating a non-null `phase` as authoritative over a
    // stale percent while rendering (see formatOneOffStatusText/
    // formatLiveStatusText).
    if (MERGER_RE.test(trimmed) || FIXUP_RE.test(trimmed)) {
      return { state: 'downloading', phase: 'merging' };
    }
    if (EXTRACT_AUDIO_RE.test(trimmed) || VIDEO_CONVERT_RE.test(trimmed)) {
      return { state: 'downloading', phase: 'converting' };
    }

    const youtubeMatch = YOUTUBE_ITEM_RE.exec(trimmed);
    if (youtubeMatch) {
      // v1.26 code-review fix (F3): `phase` reset here too, for consistency
      // with every other branch above -- a `[youtube] <id>: Downloading ...`
      // line means yt-dlp has moved on to (re-)extracting a video's own
      // webpage/player data, which is never part of a postprocess phase; any
      // `phase` still set at this point is necessarily stale.
      return { state: 'downloading', videoId: youtubeMatch[1], phase: null };
    }
  } catch {
    // Defensive: this parser must NEVER throw on odd/adversarial input.
    return null;
  }

  return null;
}

module.exports = {
  parseProgressLine,
  // Exported for the activity/orchestration layer to reuse the same cosmetic
  // cleanup on a title derived from other sources, and for direct unit
  // testing -- not part of the FR-F security/display source of truth.
  tidyTitle,
};
