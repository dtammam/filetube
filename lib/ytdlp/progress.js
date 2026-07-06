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
const DESTINATION_RE = /\[download\]\s+Destination:\s+(.+?)\s*$/i;

// `[download] Title [dQw4w9WgXcQ].mp4 has already been downloaded`
const ALREADY_DOWNLOADED_RE = /\[download\]\s+(.+?)\s+has already been downloaded\s*$/i;

// `[download] Downloading item 3 of 12` -- printed once per positional URL
// when a single yt-dlp invocation is given multiple targets (exactly how
// buildYtdlpDownloadArgs invokes it: ONE spawn, N survivor URLs).
const ITEM_OF_RE = /\[download\]\s+Downloading item\s+(\d+)\s+of\s+(\d+)/i;

// `[youtube] dQw4w9WgXcQ: Downloading webpage` / `... Downloading m3u8 ...`
// etc -- printed once per video as yt-dlp starts working on it.
const YOUTUBE_ITEM_RE = /\[youtube\]\s+(\S+?):\s*Downloading/i;

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
function tidyTitle(name) {
  if (typeof name !== 'string') return name;
  const match = /^(.*?)[ _]\[[A-Za-z0-9_-]{11}\]$/.exec(name);
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
 *   title?: string, destination?: string, index?: number, total?: number,
 *   videoId?: string} | null)}
 */
function parseProgressLine(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (trimmed === '') return null;

  try {
    const destMatch = DESTINATION_RE.exec(trimmed);
    if (destMatch) {
      const destination = destMatch[1].trim();
      const patch = { state: 'downloading', destination };
      const rawTitle = basenameNoExt(destination);
      if (rawTitle) patch.title = tidyTitle(rawTitle);
      return patch;
    }

    const alreadyMatch = ALREADY_DOWNLOADED_RE.exec(trimmed);
    if (alreadyMatch) {
      const patch = { state: 'done', percent: 100 };
      const rawTitle = basenameNoExt(alreadyMatch[1].trim());
      if (rawTitle) patch.title = tidyTitle(rawTitle);
      return patch;
    }

    const itemMatch = ITEM_OF_RE.exec(trimmed);
    if (itemMatch) {
      const index = toFiniteNumber(itemMatch[1]);
      const total = toFiniteNumber(itemMatch[2]);
      if (index === null || total === null) return null;
      return { state: 'downloading', index, total };
    }

    const percentMatch = PERCENT_RE.exec(trimmed);
    if (percentMatch) {
      const percent = toFiniteNumber(percentMatch[1]);
      if (percent === null) return null;
      const patch = { state: percent >= 100 ? 'done' : 'downloading', percent };
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

    const youtubeMatch = YOUTUBE_ITEM_RE.exec(trimmed);
    if (youtubeMatch) {
      return { state: 'downloading', videoId: youtubeMatch[1] };
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
