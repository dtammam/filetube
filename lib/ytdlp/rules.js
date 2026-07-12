'use strict';

// Pure, table-driven decision helpers for T4's download loop (lib/ytdlp/index.js's
// `runPoll`). Every function in this file is SYNCHRONOUS and side-effect-free
// (no fs, no child_process, no persistence, no Date.now() called internally --
// `now`/inputs are always passed in) so the whole dedup/premiere/skip decision
// surface is `node:test`-covered without a real yt-dlp binary or network access
// (the exec plan's "Testability requirements" + the Pure helper inventory
// table). Requiring this file has no side effects either.

// ---- parseYtdlpVideoList ----------------------------------------------------

/**
 * Parse yt-dlp's `--dump-json` output: one JSON object per line (NDJSON).
 * Defensive by design -- a blank line or a single malformed/garbled line
 * (e.g. a stray warning that slipped past `--no-warnings`, or a truncated
 * line from a killed/timed-out process) is silently skipped, never thrown.
 * The download loop must be able to make progress on whatever metadata DID
 * parse even if one line didn't.
 * @param {string} stdout raw stdout from a `runList` call
 * @returns {object[]} parsed video metadata objects (possibly empty)
 */
function parseYtdlpVideoList(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') return [];
  const videos = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // malformed line -- skip, never throw
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      videos.push(parsed);
    }
    // A parsed-but-non-object value (a bare number/string/array/null) is not
    // a video metadata record -- skip it the same way as a parse failure.
  }
  return videos;
}

// ---- isArchived (dedup pre-check) ------------------------------------------

/**
 * Dedup pre-check against the `--download-archive` file's CONTENTS. yt-dlp's
 * own `--download-archive` flag is the actual dedup mechanism at spawn time
 * (FR4) -- this pure helper lets the poll loop pre-filter/account for
 * already-archived ids in plain JS before ever spawning a download, using the
 * SAME archive line format yt-dlp itself writes/reads: `"<extractor> <id>"`,
 * one entry per line. D3: a FileTube-deleted media file is never removed from
 * this archive text, so a deleted video keeps resolving here as "already have
 * it" and is never re-downloaded.
 *
 * C2 (T4 fix round): yt-dlp writes archive lines with a LOWERCASED extractor
 * (e.g. `youtube <id>`), but `--dump-json`'s `extractor_key` field is
 * TitleCase (`Youtube`) -- a case-SENSITIVE compare here never matched a real
 * YouTube video against its own archive line, so every already-archived video
 * was silently re-treated as a survivor every poll. The extractor is now
 * compared case-INSENSITIVELY; the id stays an EXACT match (ids are
 * case-significant, unlike the extractor name).
 * @param {string} archiveText the archive file's raw contents (or '' if it
 *   doesn't exist yet -- nothing is archived)
 * @param {string} extractor yt-dlp's extractor key for this video (e.g. 'youtube'/'Youtube')
 * @param {string} id the video's id
 * @returns {boolean} true if this (extractor, id) pair is already recorded
 */
function isArchived(archiveText, extractor, id) {
  if (typeof archiveText !== 'string' || archiveText === '') return false;
  if (typeof id !== 'string' || id === '') return false;
  const safeExtractor = typeof extractor === 'string' && extractor.trim() !== '' ? extractor.trim() : 'youtube';
  const safeExtractorLower = safeExtractor.toLowerCase();
  return archiveText
    .split('\n')
    .some((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return false;
      const spaceIdx = trimmed.indexOf(' ');
      if (spaceIdx === -1) return false;
      const lineExtractor = trimmed.slice(0, spaceIdx);
      const lineId = trimmed.slice(spaceIdx + 1);
      return lineExtractor.toLowerCase() === safeExtractorLower && lineId === id;
    });
}

// ---- shouldDeferPremiere (poll-and-defer, restart-safe by construction) ----

// ~2h window: a premiere/upcoming stream is deferred until this long after its
// announced release time has elapsed, mirroring the v1.9.0 poll-and-defer
// philosophy (server.js:860-879) -- no live per-video timer is ever created,
// so there is nothing to restore after a restart; the SAME (meta, now) pair
// always yields the SAME decision.
const PREMIERE_WINDOW_MS = 2 * 60 * 60 * 1000;

const LIVE_STATUSES_TO_DEFER = new Set(['is_upcoming', 'is_live']);

/**
 * PURE poll-and-defer decision: should this video be skipped THIS cycle
 * because it is a premiere/upcoming/live broadcast still inside its defer
 * window? A later poll re-evaluates the same fields against a later `now`
 * and will proceed once the window has elapsed -- there is no persisted
 * per-video state, so this is restart-safe by construction (AC 24-26).
 * @param {object} videoMeta a parsed video metadata object (may be missing/
 *   odd fields -- handled defensively)
 * @param {number} now epoch milliseconds (always passed in, never read
 *   internally, so this stays pure and independently testable)
 * @returns {boolean} true = defer this cycle, false = proceed
 */
function shouldDeferPremiere(videoMeta, now) {
  if (!videoMeta || typeof videoMeta !== 'object') return false;
  const currentTime = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();

  if (LIVE_STATUSES_TO_DEFER.has(videoMeta.live_status)) return true;

  const releaseTimestamp = videoMeta.release_timestamp;
  if (typeof releaseTimestamp === 'number' && Number.isFinite(releaseTimestamp)) {
    if (releaseTimestamp * 1000 + PREMIERE_WINDOW_MS > currentTime) return true;
  }

  return false;
}

// ---- shouldSkip (members-only/availability gating, table-driven, fail-safe) -
//
// | Rule       | Condition (`availability`)                                | Result                                            |
// |------------|------------------------------------------------------------|----------------------------------------------------|
// | public     | `public`, `unlisted`, or absent (`undefined`/`null`)        | proceed                                             |
// | members    | `subscriber_only`, `premium_only`, `needs_subscription`     | skip UNLESS `allowMembersOnly && cookiesConfigured` |
// | restricted | `needs_auth`, `private`                                     | skip                                                |
// | unknown    | any OTHER non-empty value (fail-safe catch-all)             | SKIP                                                |
//
// `availability` is preferred over string-matching a human-readable title/
// label because it's yt-dlp's own structured field. Absent `availability` is
// treated as public because ordinary videos frequently omit the field
// entirely -- treating "missing" as "restricted" would over-skip normal
// content. Any RECOGNIZED-but-not-yet-handled or entirely unrecognized token
// (e.g. a future YouTube wording/format change) falls through to the
// fail-safe "unknown" row and is skipped, never downloaded speculatively.

const PUBLIC_AVAILABILITY = new Set(['public', 'unlisted']);
const MEMBERS_AVAILABILITY = new Set(['subscriber_only', 'premium_only', 'needs_subscription']);
const RESTRICTED_AVAILABILITY = new Set(['needs_auth', 'private']);

/**
 * Table-driven, fail-safe members-only/availability gate. See the rule table
 * above (also documented in the exec plan's Design section).
 * @param {object} videoMeta a parsed video metadata object
 * @param {{allowMembersOnly?: boolean, cookiesConfigured?: boolean}} [opts]
 * @returns {{skip: boolean, reason: string}}
 */
function shouldSkip(videoMeta, opts = {}) {
  const availability = videoMeta && typeof videoMeta === 'object' ? videoMeta.availability : undefined;
  const allowMembersOnly = Boolean(opts && opts.allowMembersOnly);
  const cookiesConfigured = Boolean(opts && opts.cookiesConfigured);

  if (availability === undefined || availability === null || PUBLIC_AVAILABILITY.has(availability)) {
    return { skip: false, reason: 'public/unlisted (or no availability field)' };
  }

  if (MEMBERS_AVAILABILITY.has(availability)) {
    if (allowMembersOnly && cookiesConfigured) {
      return { skip: false, reason: `members-only allowed (toggle on + cookies configured, availability=${availability})` };
    }
    return { skip: true, reason: `members-only skipped (availability=${availability}, allowMembersOnly=${allowMembersOnly}, cookiesConfigured=${cookiesConfigured})` };
  }

  if (RESTRICTED_AVAILABILITY.has(availability)) {
    return { skip: true, reason: `restricted content skipped (availability=${availability})` };
  }

  // Fail-safe catch-all (AC 21): any other non-empty, unrecognized
  // `availability` token (a wording/format change, a typo, an extractor
  // quirk) resolves to SKIP, never proceed.
  return { skip: true, reason: `unrecognized availability value, skipped fail-safe (availability=${String(availability)})` };
}

// ---- isShort (v1.15.0 item 4: per-subscription Shorts exclusion) -----------

/**
 * Pure, fail-open Shorts detector. Returns `true` only when one of
 * `videoMeta.webpage_url` / `videoMeta.original_url` / `videoMeta.url` is a
 * STRING containing the substring `/shorts/` -- the shape yt-dlp's YouTube
 * extractor uses for a Shorts video's canonical page URL. Missing/odd fields
 * (not an object, no matching field, a non-string field) resolve to `false`
 * (NOT a short) -- this fails open toward "download it," matching the
 * feature's "default off = download everything" posture (a false positive
 * here would silently drop a normal video; a false negative just means the
 * JS filter didn't catch a Short, which the caller only acts on when
 * `sub.skipShorts === true` anyway). Pure/synchronous, no I/O.
 * @param {object} videoMeta a parsed video metadata object (may be missing/
 *   odd fields -- handled defensively)
 * @returns {boolean} true = this video's URL indicates a YouTube Short
 */
function isShort(videoMeta) {
  if (!videoMeta || typeof videoMeta !== 'object') return false;
  const candidates = [videoMeta.webpage_url, videoMeta.original_url, videoMeta.url];
  return candidates.some((value) => typeof value === 'string' && value.includes('/shorts/'));
}

/**
 * v1.36 F1 (fix round): the AUTHORITATIVE per-video date gate, replacing
 * `--dateafter` on the list argv (which had to be dropped: yt-dlp's own
 * daterange rejection is non-breaking and evaluated BEFORE match filters,
 * so its presence masked the break-early filter entirely -- see
 * lib/ytdlp/args.js's `breakEarlyArgs`). The break filter deliberately
 * breaks at cutoff-minus-slack, so entries between the slacked and real
 * cutoffs ARE printed by the listing; this gate is what drops them (and any
 * out-of-order pre-cutoff stragglers) from the survivor set.
 *
 * PARITY with the retired `--dateafter <cutoff>` semantics, exactly:
 *   - upload_date >= cutoff  -> false (keep). Lexicographic compare of two
 *     fixed 8-digit YYYYMMDD strings IS calendar compare.
 *   - upload_date <  cutoff  -> true (skip).
 *   - upload_date missing/malformed -> false (KEEP) -- yt-dlp's daterange
 *     check is skipped entirely when `upload_date` is absent (a premiere/
 *     live placeholder), so those flowed through to the premiere-defer/
 *     availability rules before, and still must.
 *   - cutoffDate missing/malformed -> false (keep everything) -- mirrors
 *     `dateAfterArgs`'s own fail-safe-to-no-bound validation.
 * Pure/synchronous, no I/O, never throws.
 * @param {object} videoMeta parsed video metadata (defensively handled)
 * @param {*} cutoffDate the subscription's YYYYMMDD cutoff (re-validated)
 * @returns {boolean} true = uploaded strictly before the cutoff (skip it)
 */
function isBeforeCutoff(videoMeta, cutoffDate) {
  if (typeof cutoffDate !== 'string' || !/^\d{8}$/.test(cutoffDate)) return false;
  const uploadDate = videoMeta && typeof videoMeta.upload_date === 'string' ? videoMeta.upload_date : null;
  if (!uploadDate || !/^\d{8}$/.test(uploadDate)) return false;
  return uploadDate < cutoffDate;
}

module.exports = {
  parseYtdlpVideoList,
  isArchived,
  shouldDeferPremiere,
  shouldSkip,
  isShort,
  isBeforeCutoff,
  PREMIERE_WINDOW_MS,
};
