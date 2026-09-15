'use strict';

// lib/scan/identity.js -- scan-time item IDENTITY derivation - the yt-dlp
// filename bracket id, an untrusted URL-ish string reduced to a safe YouTube
// id, the combined scan-time youtubeId precedence, and the release-date
// precedence.
//
// Wave 6 of the relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md): extracted from server.js
// VERBATIM: every body and doc comment is the original text. The ONLY comment
// edits anywhere in the extraction were positional locator words
// ("above"/"below") that pointed at a server.js NEIGHBOUR - those now name
// their target instead, so no comment here lies about where its subject is.
// server.js requires this module back and re-exports each helper, so
// `require('../../server').<name>` is the SAME function object as the one
// `require('../../lib/scan/<this file>').<name>` hands you.

const path = require('path');

const { classifySingleVideo } = require('../ytdlp/url');
const { matchRootFolder } = require('./roots');

// v1.20.0 FR-2: sibling to cleanDisplayTitle (server.js) -- extracts the yt-dlp
// video id from the SAME trailing ` [<11-char id>]` bracket suffix
// cleanDisplayTitle recognizes (and strips), reusing the identical bracket
// shape rather than a second, forked regex, so the two helpers can never
// disagree about what counts as a yt-dlp-shaped filename. Returns the
// bracketed id -- already charset/length-bounded by the regex itself
// (exactly 11 characters of `[A-Za-z0-9_-]`, the same shape
// `url.isSafeVideoId` accepts) -- or `null` when the basename doesn't match
// this shape at all (an ordinary, non-yt-dlp library file). Scan-time-only:
// callers are expected to scope this to files actually rooted under the
// yt-dlp module's own download dir first (mirroring cleanDisplayTitle's own
// FIX-9 scoping), so a coincidentally-bracketed non-yt-dlp file is never fed
// through this at all.
function extractYtdlpVideoId(baseName) {
  const m = /^(.*?)[ _]\[([A-Za-z0-9_-]{11})\]$/.exec(baseName);
  return m ? m[2] : null;
}

// v1.33 T1: validate an untrusted URL-ish string (an embedded `purl`/`comment`
// tag, typically) down to a safe YouTube video id, through the SAME
// `classifySingleVideo` gate every other untrusted URL in the yt-dlp module
// crosses -- never a home-grown regex. Returns the 11-char id, or `null` for
// anything that is not a well-formed single-video YouTube URL. Pure, never
// throws (classifySingleVideo fails closed on garbage input).
function youtubeIdFromUrlString(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  const classified = classifySingleVideo(raw);
  return classified.ok ? classified.videoId : null;
}

// v1.33 T1: scan-time YouTube-id derivation, shared by the new/updated
// branch's probe path and its probe-failure path. Two sources, in trust
// order: (1) the filename's `[id]` bracket -- scoped to yt-dlp-rooted files
// exactly like the bridge/cleanDisplayTitle (a coincidentally-bracketed
// library file elsewhere is never fed through extractYtdlpVideoId); (2) the
// embedded `purl`/`comment` source URL off the file's own probe -- an
// EXPLICIT downloader-written provenance tag, trusted from any root, but
// only after it survives the classifySingleVideo gate. Returns the id or
// `null` -- callers persist the `null` too (probed-once convention).
//
// ACCEPTED trust boundary (v1.33 gate, conscious decision): the embedded tag
// is only ever a claim about which YouTube video this file CAME FROM --
// anyone with write access to the media files themselves (already full
// control in this LAN-only, single-user app) could edit it to point the
// Share link / reheat metadata at a different-but-legitimate YouTube video.
// The gate guarantees it can only ever be a well-formed YouTube video URL
// (never another host, a playlist, or a credentialed URL); content-vs-id
// agreement is not (and cannot be) verified. Revisit if multi-user/untrusted
// library roots ever land (see ROADMAP's accounts item).
//
// v1.41.5 WIDENED (Dean's explicit call): this id is now also what makes an
// item eligible for the reheat's NETWORK pass from ANY library root, not just
// the module's own download dir -- see `enumerateRepullableItems`. That makes
// this the FIRST code path that aims a yt-dlp network call at a file FileTube
// did not download itself (Dean's MeTube-era .mp3/.mp4 imports, whose only
// link back to YouTube is exactly this tag). The blast radius of a forged tag
// is unchanged in KIND (a well-formed YouTube video URL, fetched read-only,
// `--skip-download`; the media file is never touched) and now also covers the
// channel identity written back onto the item -- which the never-overwrite
// guard in `recordRepulledItemMeta` keeps from ever re-pointing an item that
// already has one. A file with NO such tag and no `[id]` bracket is never
// fetched at all (its local probe finds nothing and the item is skipped).
function deriveScanYoutubeId(filePath, info, ytdlpRoots, embeddedSourceUrl) {
  if (matchRootFolder(filePath, ytdlpRoots)) {
    const bracketId = extractYtdlpVideoId(path.basename(info.name, info.ext));
    if (bracketId) return bracketId;
  }
  return youtubeIdFromUrlString(embeddedSourceUrl);
}

// C5-local (v1.24): the release-date PRECEDENCE helper -- embedded date (from
// a probe the scan already ran) wins; filesystem `mtime` is the fragile-but-
// honest last resort (it resets on copy, but every local file has one).
// Pure and deliberately tiny/decoupled from `parseEmbeddedReleaseDateMs` so
// the SCHEMA-ONLY BACKFILL PATH (an already-indexed item whose entry
// predates this field) can call it with `embeddedMs=null` to force the
// mtime-only branch WITHOUT spawning a fresh probe -- see the scan loop's
// backfill branches in `runScanDirectories`, which pass `null` here on purpose (the
// thumbnail-backfill-regression lesson: adding this field to an existing
// item must never trigger re-processing). Returns epoch ms, or `null` only
// if `mtimeMs` itself is unusable (never expected in practice -- every
// scanned file has a `stat` result).
function deriveReleaseDate(embeddedMs, mtimeMs) {
  if (Number.isFinite(embeddedMs)) return embeddedMs;
  if (Number.isFinite(mtimeMs) && mtimeMs > 0) return mtimeMs;
  return null;
}

module.exports = {
  extractYtdlpVideoId,
  youtubeIdFromUrlString,
  deriveScanYoutubeId,
  deriveReleaseDate,
};
