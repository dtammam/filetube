'use strict';

// Persistence accessors for the optional yt-dlp subscription module. Every
// side effect here goes exclusively through the INJECTED `updateDatabase`/
// `loadDatabase` deps (the same v1.9.0 serialized-writer primitive server.js
// uses for everything else) -- this module never touches the filesystem or
// `db.json` directly, and never imports server.js. Because this module is
// only ever reached from routes registered inside `registerRoutes`'s
// `isEnabled` gate (see lib/ytdlp/index.js), an empty/default namespace is
// materialized ONLY when an enabled module writer actually runs one of these
// functions -- the disabled path never calls in here at all, so it stays
// byte-identical.

const path = require('path');
const { validateChannelUrl, isSafeVideoId } = require('./url');
// v1.13.0 item 4: the filetype/container allowlist is OWNED by args.js (the
// file that actually turns it into an argv element) -- store.js imports it
// rather than forking a second copy, so there is exactly one source of
// truth for "what filetype values exist per format." No circular require:
// args.js does not import anything from store.js.
//
// v1.21.0 FR-5: `isPathUnder` is the SAME pure containment predicate
// `args.js`'s own `resolveChannelDir`/SF4 confinement checks are built on
// (args.js exports it explicitly for reuse, see its own module comment) --
// reused verbatim here for `isChannelDirConfined` below rather than a second,
// forked copy of the same `path.resolve` prefix-check logic.
const { VALID_FILETYPES, isPathUnder } = require('./args');

const DEFAULT_YTDLP_NAMESPACE = Object.freeze({ allowMembersOnly: false, subscriptions: [] });

const VALID_FORMATS = new Set(['audio', 'video']);
const DEFAULT_FORMAT = 'video';
const DEFAULT_QUALITY = 'best';

// Union of every valid filetype value across BOTH formats -- used only by
// the PATCH path's COARSE, format-agnostic reject (see
// `validateSubscriptionPatch` below): a patch may omit `format`, so there is
// no single per-format allowlist to check against yet. This is deliberately
// NOT the authoritative check -- `args.normalizeFiletype(effectiveFormat, ...)`
// at build time is -- it only catches a value that is not even PLAUSIBLE for
// either format (hostile garbage), letting a same-format-mismatch (e.g. an
// audio filetype on a video sub) through to degrade safely to `'default'`
// later, per the design's documented, acceptable behavior.
const ALL_FILETYPES = new Set([...VALID_FILETYPES.video, ...VALID_FILETYPES.audio]);

// FR-C: upper bound for a per-subscription `maxVideos` override -- generous
// enough for any real use case while still rejecting a pathological/garbage
// value (e.g. a typo'd extra zero) outright rather than silently accepting
// it as a valid `--playlist-end` bound.
const MAX_SUB_MAX_VIDEOS = 5000;

// v1.22.0 FR-6: upper bound for a per-subscription `maxDurationSeconds`
// override -- a generous 24h ceiling, rejecting a pathological/garbage value
// (e.g. a typo'd extra zero) outright rather than silently accepting it as a
// valid `--match-filter` duration bound. Mirrors `MAX_SUB_MAX_VIDEOS`'s
// posture exactly.
const MAX_SUB_MAX_DURATION_SECONDS = 86400;

// Defensive backfill, applied MODULE-LOCALLY (inside this file's own
// mutators/readers) rather than in server.js's core `loadDatabase`. Mirrors
// the `folderSettings`/`settings` backfill pattern there (server.js:83-86):
// a missing/partial `db.ytdlp` is completed without ever clobbering fields
// that are already present, and no other top-level key is touched. This is
// what keeps core `loadDatabase`/`DEFAULT_SETTINGS` untouched and the
// disabled path byte-identical -- an old or disabled db.json simply never
// gains a `ytdlp` key because nothing here ever runs against it.
//
// `nowMs` (v1.25 QoL, T1) is an OPTIONAL injected "current time," defaulting
// to the real `Date.now()` -- it exists purely so the `cutoffDate` migration
// below's "neither `lastCheckedAt` nor `addedAt` is usable -> fall back to
// YESTERDAY" branch is deterministic/testable; every other backfill in this
// function is unaffected by it.
function ensureYtdlp(db, nowMs = Date.now()) {
  if (!db.ytdlp || typeof db.ytdlp !== 'object') {
    // NOTE: build a fresh object/array here rather than `{ ...DEFAULT_YTDLP_NAMESPACE }`
    // -- a shallow spread of the frozen constant would copy the SAME
    // `subscriptions` array reference into every db that hits this branch
    // (Object.freeze is shallow), silently sharing subscriptions across
    // unrelated db instances. `DEFAULT_YTDLP_NAMESPACE` exists only as a
    // documented/exported shape constant, never as a literal to spread from.
    db.ytdlp = { allowMembersOnly: false, subscriptions: [], downloadMeta: {}, pins: [] };
  } else {
    if (typeof db.ytdlp.allowMembersOnly !== 'boolean') db.ytdlp.allowMembersOnly = false;
    if (!Array.isArray(db.ytdlp.subscriptions)) db.ytdlp.subscriptions = [];
    // v1.20.0 FR-2: the download->scan channel-identity bridge map, keyed by
    // yt-dlp video id. Same non-destructive backfill posture as
    // `allowMembersOnly`/`subscriptions` above -- an object that is ALREADY
    // present (even `{}`) is left completely untouched; only a missing/
    // non-object value is replaced with a fresh, empty map. A fresh object
    // literal (never a shared reference) for the same reason `subscriptions`
    // above is built fresh rather than spread from a frozen constant.
    if (!db.ytdlp.downloadMeta || typeof db.ytdlp.downloadMeta !== 'object' || Array.isArray(db.ytdlp.downloadMeta)) {
      db.ytdlp.downloadMeta = {};
    }
    // v1.21.0 FR-5: the pinned-channel-playlist snapshot list -- SAME
    // non-destructive backfill posture as `subscriptions`/`downloadMeta`
    // above (a present array, even `[]`, is left untouched; only a missing/
    // non-array value is replaced with a fresh, empty array -- never a
    // shared reference). This is a NEW, SEPARATE namespace from
    // `db.folders`/`db.folderSettings` -- see the module-level "HARD
    // INVARIANT" comment block above `isChannelDirConfined` below: nothing
    // in this file ever reads/writes `db.folders`/`db.folderSettings`, and
    // nothing outside this file (in particular `server.js`'s
    // `POST /api/config`) ever reads/writes `db.ytdlp.pins`.
    if (!Array.isArray(db.ytdlp.pins)) db.ytdlp.pins = [];
  }
  // FR-D: per-subscription backfill for `paused`, added after the initial
  // subscription record shape shipped. Existing subs written before this
  // field existed migrate to `paused: false` IN MEMORY on every read here,
  // and persist that value on whatever write next touches this db -- no
  // standalone migration pass, and (unlike the namespace-level backfill
  // above) this mutates each already-distinct sub object directly, never a
  // shared/frozen array or object. `maxVideos` (and, since v1.13.0 item 4,
  // `filetype`) are deliberately left untouched (stay `undefined` when
  // absent) -- they fall back to their respective defaults at build-arg time
  // (FR-C / args.normalizeFiletype), never backfilled to a concrete value.
  for (let index = 0; index < db.ytdlp.subscriptions.length; index++) {
    const sub = db.ytdlp.subscriptions[index];
    if (sub && typeof sub.paused !== 'boolean') sub.paused = false;
    // v1.15.0 item 4: `skipShorts` backfill mirrors `paused` EXACTLY -- a
    // boolean, default-false toggle, so an existing sub written before this
    // field existed migrates to `skipShorts: false` (download everything,
    // unchanged behavior) IN MEMORY here, persisting on whatever write next
    // touches this db.
    if (sub && typeof sub.skipShorts !== 'boolean') sub.skipShorts = false;
    // v1.24.0 B4 (FR-8 DnD reorder): `order` backfill mirrors `paused`/
    // `skipShorts`'s "migrate in memory, persist on next write" posture, but
    // the default is POSITIONAL rather than a fixed constant -- a
    // subscription written before this field existed migrates to
    // `order = <its current array index>`, so its on-screen position is
    // unchanged (the existing array order IS the existing display order)
    // until the user explicitly drags it (see `reduceReorder` below). A
    // present-but-non-integer value (defensive: hostile/corrupt db.json) is
    // also re-backfilled rather than trusted, matching every other numeric
    // field's posture in this file.
    if (sub && (typeof sub.order !== 'number' || !Number.isInteger(sub.order))) sub.order = index;
    // v1.25 QoL (T1): `cutoffDate` migration for a sub that predates this
    // field (coordinator decision D1, behavior-preserving/no-gap). Mirrors
    // `paused`/`skipShorts`/`order`'s "migrate in memory, persist on
    // whatever write next touches this db" posture EXACTLY, but is otherwise
    // unlike them: rather than a single fixed default, the fallback chain is
    // `lastCheckedAt`'s own DATE (so the sub picks up "everything since it
    // last successfully checked," never MISSING videos published since its
    // last poll, and never re-listing its whole back catalog) -> `addedAt`'s
    // own DATE (the sub has never successfully checked yet) -> YESTERDAY (the
    // same brand-new-subscription default `addSubscription` uses, for the
    // rare case where neither timestamp is a usable date at all). Idempotent/
    // additive, same as every other backfill in this function: an
    // ALREADY-valid `cutoffDate` (checked via the SAME `parseCapturedReleaseDate`
    // predicate `validateCutoffDate` uses) is never touched/overwritten.
    if (sub && (typeof sub.cutoffDate !== 'string' || parseCapturedReleaseDate(sub.cutoffDate) === null)) {
      sub.cutoffDate = isoToYyyymmdd(sub.lastCheckedAt) || isoToYyyymmdd(sub.addedAt) || formatYyyymmdd(nowMs - ONE_DAY_MS);
    }
  }
  // v1.24.3 (pinned-channel DnD reorder): pin `order` backfill mirrors the
  // subscription `order` backfill immediately above, field-for-field --
  // same POSITIONAL default (`order = <its current array index>`, so a
  // pin's on-screen position is unchanged until the user explicitly drags
  // it, see `reducePinReorder` below), same "migrate in memory, persist on
  // next write" posture, and the same defensive re-backfill of a
  // present-but-non-integer (corrupt) value rather than trusting it.
  for (let index = 0; index < db.ytdlp.pins.length; index++) {
    const pin = db.ytdlp.pins[index];
    if (pin && (typeof pin.order !== 'number' || !Number.isInteger(pin.order))) pin.order = index;
  }
  return db.ytdlp;
}

/**
 * Validate an optional per-subscription `maxVideos` override (FR-C).
 * `undefined` (the field simply absent) is valid and means "unset -- fall
 * back to the global `config.maxVideos` at build-arg time" (AC19). Any other
 * value must be a non-negative integer no greater than `MAX_SUB_MAX_VIDEOS`
 * (`0` is a valid, distinct value meaning "unlimited," mirroring
 * config.js's own convention) -- a non-integer, negative, or out-of-range
 * value is a hard validation error (never silently coerced/clamped), so the
 * API boundary can surface a clean `400` (AC20).
 */
function validateMaxVideos(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_SUB_MAX_VIDEOS) {
    return { ok: false, error: `maxVideos must be an integer between 0 and ${MAX_SUB_MAX_VIDEOS}` };
  }
  return { ok: true, value };
}

/**
 * Validate an optional per-subscription `maxDurationSeconds` override
 * (v1.22.0 FR-6). Mirrors `validateMaxVideos` EXACTLY: `undefined` (the field
 * simply absent) is valid and means "unset -- fall back to the global
 * `config.maxDurationSeconds` at build-arg time." Any other value must be a
 * non-negative integer no greater than `MAX_SUB_MAX_DURATION_SECONDS` (`0` is
 * a valid, distinct value meaning "unbounded," mirroring config.js's own
 * convention) -- a non-integer, negative, or out-of-range value is a hard
 * validation error (never silently coerced/clamped), so the API boundary can
 * surface a clean `400`.
 */
function validateMaxDurationSeconds(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_SUB_MAX_DURATION_SECONDS) {
    return { ok: false, error: `maxDurationSeconds must be an integer between 0 and ${MAX_SUB_MAX_DURATION_SECONDS}` };
  }
  return { ok: true, value };
}

/**
 * Validate an optional per-subscription `paused` flag (FR-D). `undefined` is
 * valid (unset -- `ensureYtdlp`'s backfill defaults it to `false`); anything
 * else must be a strict boolean, never coerced (e.g. a truthy string is
 * rejected, not silently treated as `true`).
 */
function validatePaused(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'boolean') {
    return { ok: false, error: 'paused must be a boolean' };
  }
  return { ok: true, value };
}

/**
 * Validate an optional per-subscription `skipShorts` flag (v1.15.0 item 4).
 * Mirrors `validatePaused` EXACTLY: `undefined` is valid (unset --
 * `ensureYtdlp`'s backfill defaults it to `false`); anything else must be a
 * strict boolean, never coerced (e.g. a truthy string is rejected, not
 * silently treated as `true`).
 */
function validateSkipShorts(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'boolean') {
    return { ok: false, error: 'skipShorts must be a boolean' };
  }
  return { ok: true, value };
}

/**
 * Validate an optional per-subscription/one-shot `filetype` (container)
 * override (v1.13.0 item 4), format-aware. `undefined` is valid and means
 * "unset -- resolve to `'default'` at build time" (AC16: non-destructive,
 * mirrors `validateMaxVideos`'s posture, NOT `validatePaused`'s backfill
 * one). A value is only valid when it is a member of `VALID_FILETYPES[format]`
 * -- a mismatched-format value (e.g. `'mp4'` when `format` is `'audio'`) is a
 * hard validation error here (so the API boundary can 400), even though
 * `args.normalizeFiletype` would ALSO neutralize it defensively at build
 * time if it ever slipped through. `format` itself must already be
 * `'audio'`/`'video'` -- an unknown format has no allowlist to check
 * against, so it also fails here.
 */
function validateFiletype(format, value) {
  if (value === undefined) return { ok: true, value: undefined };
  const allowed = VALID_FILETYPES[format];
  if (!allowed || typeof value !== 'string' || !allowed.has(value)) {
    const options = allowed ? [...allowed].join(', ') : '(unknown format)';
    return { ok: false, error: `filetype must be one of: ${options}` };
  }
  return { ok: true, value };
}

// Pure fallback display name derived from the channel URL, since no yt-dlp
// metadata exists yet at add-time in T2 (that arrives in T3/T4, which can
// enrich this with the real channel title). Prefers an `@handle` path
// segment (the common YouTube channel URL shape), else the last non-empty
// path segment, else the hostname, else a generic fallback -- never throws
// on a malformed input.
function deriveDisplayName(input) {
  if (typeof input !== 'string' || input.trim() === '') return 'Untitled channel';
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return input.trim();
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const handle = segments.find((seg) => seg.startsWith('@'));
  if (handle) return handle;
  if (segments.length > 0) return segments[segments.length - 1];
  return url.hostname || 'Untitled channel';
}

// Normalizes an ALREADY-VALIDATED channel URL for idempotent id derivation:
// re-lowercases the host (validateChannelUrl already does this, so this is
// belt-and-suspenders) and trims whitespace. `raw` is expected to have
// already passed `validateChannelUrl` (via `validateSubscriptionInput`
// below) -- this function stays defensive (never throws) for any other
// caller, but is no longer the URL's security boundary.
function normalizeChannelUrl(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Validate an add-subscription request body. Returns
 * `{ ok: true, value: { channelUrl, format, quality } }` on success (with
 * `channelUrl` NORMALIZED by `validateChannelUrl`, `format`/`quality`
 * defaulted) or `{ ok: false, error: string }` on failure. Pure -- does not
 * touch any deps.
 *
 * `validateChannelUrl` (lib/ytdlp/url.js) is the ONE source of truth for URL
 * validation: the YouTube host allowlist, path-shape check, and
 * option-injection/shell-metacharacter rejection all live there, not here.
 * This is the T2->T3 upgrade point noted in T2's history -- the previous
 * `isBasicHttpUrl` shape-only check has been replaced.
 */
function validateSubscriptionInput(body) {
  const input = body && typeof body === 'object' ? body : {};
  const urlResult = validateChannelUrl(input.channelUrl);
  if (!urlResult.ok) {
    return { ok: false, error: urlResult.error };
  }
  const format = input.format === undefined ? DEFAULT_FORMAT : input.format;
  if (!VALID_FORMATS.has(format)) {
    return { ok: false, error: "format must be 'audio' or 'video'" };
  }
  const quality = typeof input.quality === 'string' && input.quality.trim() !== ''
    ? input.quality.trim()
    : DEFAULT_QUALITY;
  // FR-C/FR-D: optional at add-time too, single-sourced through the SAME
  // validators the PATCH path (validateSubscriptionPatch, below) uses --
  // `undefined` is valid either way (unset -> global maxVideos / paused:false
  // backfill); anything else invalid is a hard `400`-worthy error.
  const maxVideosResult = validateMaxVideos(input.maxVideos);
  if (!maxVideosResult.ok) {
    return { ok: false, error: maxVideosResult.error };
  }
  // v1.22.0 FR-6: same optional-at-add-time posture as maxVideos above --
  // undefined is valid (unset -> global maxDurationSeconds backfill at
  // build-arg time); anything else invalid is a hard `400`-worthy error.
  const maxDurationSecondsResult = validateMaxDurationSeconds(input.maxDurationSeconds);
  if (!maxDurationSecondsResult.ok) {
    return { ok: false, error: maxDurationSecondsResult.error };
  }
  const pausedResult = validatePaused(input.paused);
  if (!pausedResult.ok) {
    return { ok: false, error: pausedResult.error };
  }
  // v1.15.0 item 4: same optional-boolean posture as `paused` above.
  const skipShortsResult = validateSkipShorts(input.skipShorts);
  if (!skipShortsResult.ok) {
    return { ok: false, error: skipShortsResult.error };
  }
  // v1.13.0 item 4: validated AFTER `format` is resolved (defaulted), since
  // the allowlist is format-partitioned -- format-aware validation needs the
  // final `format`, not `input.format`, which may be absent.
  const filetypeResult = validateFiletype(format, input.filetype);
  if (!filetypeResult.ok) {
    return { ok: false, error: filetypeResult.error };
  }
  // v1.25 QoL (T1): same optional-at-add-time posture as maxVideos/paused
  // above -- undefined is valid (unset -> addSubscription defaults it to
  // yesterday); anything else invalid is a hard `400`-worthy error.
  const cutoffDateResult = validateCutoffDate(input.cutoffDate);
  if (!cutoffDateResult.ok) {
    return { ok: false, error: cutoffDateResult.error };
  }
  return {
    ok: true,
    value: {
      channelUrl: urlResult.url,
      format,
      quality,
      name: typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : undefined,
      maxVideos: maxVideosResult.value,
      maxDurationSeconds: maxDurationSecondsResult.value,
      paused: pausedResult.value,
      skipShorts: skipShortsResult.value,
      filetype: filetypeResult.value,
      cutoffDate: cutoffDateResult.value,
    },
  };
}

/**
 * Validate a `PATCH /api/subscriptions/:id` request body (FR-D): any subset
 * of `{format, quality, maxVideos, maxDurationSeconds, paused, skipShorts}`.
 * Unlike `validateSubscriptionInput`
 * (the add path, where `channelUrl` is mandatory), every field here is
 * OPTIONAL -- a field simply absent from `patch` means "leave unchanged" (the
 * returned `value` only contains keys the caller actually supplied, and
 * `updateSubscription` below only mutates fields present in that value).
 * `format`/`maxVideos`/`maxDurationSeconds`/`paused` are hard validation
 * errors when present and invalid (never silently coerced); `quality` only
 * requires a non-empty
 * string here -- its own allowlist-or-default neutralization
 * (`args.normalizeQuality`) is re-asserted defense-in-depth immediately
 * before every spawn, exactly as it already is for the add path.
 */
function validateSubscriptionPatch(body) {
  const input = body && typeof body === 'object' ? body : {};
  const value = {};

  if (input.format !== undefined) {
    if (!VALID_FORMATS.has(input.format)) {
      return { ok: false, error: "format must be 'audio' or 'video'" };
    }
    value.format = input.format;
  }

  if (input.quality !== undefined) {
    if (typeof input.quality !== 'string' || input.quality.trim() === '') {
      return { ok: false, error: 'quality must be a non-empty string' };
    }
    value.quality = input.quality.trim();
  }

  const maxVideosResult = validateMaxVideos(input.maxVideos);
  if (!maxVideosResult.ok) {
    return { ok: false, error: maxVideosResult.error };
  }
  if (maxVideosResult.value !== undefined) value.maxVideos = maxVideosResult.value;

  // v1.22.0 FR-6: same optional-subset-of-a-patch posture as maxVideos above.
  const maxDurationSecondsResult = validateMaxDurationSeconds(input.maxDurationSeconds);
  if (!maxDurationSecondsResult.ok) {
    return { ok: false, error: maxDurationSecondsResult.error };
  }
  if (maxDurationSecondsResult.value !== undefined) value.maxDurationSeconds = maxDurationSecondsResult.value;

  const pausedResult = validatePaused(input.paused);
  if (!pausedResult.ok) {
    return { ok: false, error: pausedResult.error };
  }
  if (pausedResult.value !== undefined) value.paused = pausedResult.value;

  // v1.15.0 item 4: same optional-subset-of-a-patch posture as `paused`
  // above.
  const skipShortsResult = validateSkipShorts(input.skipShorts);
  if (!skipShortsResult.ok) {
    return { ok: false, error: skipShortsResult.error };
  }
  if (skipShortsResult.value !== undefined) value.skipShorts = skipShortsResult.value;

  // v1.13.0 item 4: `format` may be ABSENT from a patch, so there is no
  // single per-format allowlist to validate `filetype` against here yet --
  // this is a deliberately COARSE reject (present + not a string / not a
  // member of EITHER format's allowlist -> 400), catching hostile garbage
  // (an injection attempt, a path, an object) outright. A value that is
  // merely mismatched for the sub's eventual format (e.g. an audio filetype
  // alongside an unrelated video sub) is allowed THROUGH here and degrades
  // safely to `'default'` at build time via `args.normalizeFiletype`
  // (format-aware, the authoritative gate) -- documented, acceptable
  // per the design.
  if (input.filetype !== undefined) {
    if (typeof input.filetype !== 'string' || !ALL_FILETYPES.has(input.filetype)) {
      return { ok: false, error: 'filetype must be a valid container/format value' };
    }
    value.filetype = input.filetype;
  }

  // v1.25 QoL (T1): same optional-subset-of-a-patch posture as maxVideos/
  // paused above -- lets a user edit a subscription's cutoff date after the
  // fact.
  const cutoffDateResult = validateCutoffDate(input.cutoffDate);
  if (!cutoffDateResult.ok) {
    return { ok: false, error: cutoffDateResult.error };
  }
  if (cutoffDateResult.value !== undefined) value.cutoffDate = cutoffDateResult.value;

  return { ok: true, value };
}

// ---- v1.20.0 FR-2: captured channel-identity bridge (SECURITY-CRITICAL) ----
//
// Everything below handles UNTRUSTED input: `channelUrl`/`channelId`/
// `uploaderUrl`/`channelName` originate from yt-dlp's own `--print` stdout
// (lib/ytdlp/run.js's `parseChannelMetaLine`) -- creator-controlled text, the
// same trust level as user input. Nothing here is ever persisted or used for
// matching/display until it has passed `url.validateChannelUrl` (the SAME,
// unmodified validator the add-subscription path uses).

// A stable YouTube channel id is always `UC` followed by exactly 22
// characters of the same charset yt-dlp/YouTube ids use. Anything else is
// dropped rather than trusted -- this is a defense-in-depth SHAPE check on
// top of the URL validation below (channelId is never itself passed to a
// spawn or used to build a URL, but it IS persisted/displayed, so it must
// still be bounded/charset-checked before that).
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

// Same order-of-magnitude cap as other display-name bounds in this codebase
// (e.g. lib/ytdlp/args.js's MAX_CHANNEL_NAME_LENGTH for the on-disk folder
// name) -- generous for any real channel title while still rejecting a
// pathological/oversized value outright rather than storing it unbounded.
const MAX_CAPTURED_CHANNEL_NAME_LENGTH = 200;

// FIFO cap for `db.ytdlp.downloadMeta` (see `recordDownloadChannelMeta`
// below). In normal operation every entry is consumed-and-deleted at first
// scan (`consumeDownloadChannelMeta`), so the map should stay small/empty
// most of the time -- this is the backstop for the case where a scan somehow
// never runs (or never matches) for some entries, so the map can never grow
// unbounded across the lifetime of a long-running server.
const MAX_DOWNLOAD_META = 5000;

// ---- v1.24.0 C5-ytdlp/C6 (T11): release-date + channel-avatar capture -----
//
// Extends the SAME untrusted-capture posture above: `uploadDate`/
// `releaseDate` (raw `YYYYMMDD` strings) and `channelThumbnail` (a raw URL
// string) are additional fields `lib/ytdlp/args.js`'s widened
// `CHANNEL_META_PRINT_TEMPLATE` now selects -- creator-controlled/yt-dlp-
// controlled text, the same trust level as `channelUrl`/`channelName` above.
// Nothing here is ever persisted until it passes the bounded validators
// immediately below.

// yt-dlp's own documented convention for `upload_date`/`release_date`: an
// 8-digit `YYYYMMDD` calendar date with no time-of-day component. Anything
// else (missing, malformed, a different length) is dropped rather than
// trusted -- this is a SHAPE check, matching `CHANNEL_ID_PATTERN`'s posture
// immediately above.
const YTDLP_DATE_PATTERN = /^\d{8}$/;

// Sanity bounds for a captured release/upload date, defense-in-depth on top
// of the shape check above: rejects a date before 2000-01-01 -- a round
// floor chosen with a comfortable safety margin BEFORE YouTube itself even
// existed (2005), so it never clips a genuine early value while still
// catching pathological garbage (e.g. an all-zero/epoch-adjacent date) --
// or implausibly far in the future (clock skew / a hostile value), exactly
// the "reject pathological garbage outright" posture
// `MAX_CAPTURED_CHANNEL_NAME_LENGTH`/`MAX_SUB_MAX_VIDEOS` already use
// elsewhere in this file.
const MIN_PLAUSIBLE_RELEASE_DATE_MS = Date.UTC(2000, 0, 1);
const MAX_PLAUSIBLE_RELEASE_DATE_FUTURE_MS = 1000 * 60 * 60 * 24 * 365; // +1 year

/**
 * v1.24.0 C5-ytdlp: parse+bound a raw yt-dlp `YYYYMMDD` date string (from
 * `upload_date`/`release_date`) into an epoch-ms number, or `null` when the
 * value is absent/malformed/implausible. Pure, synchronous, never throws.
 *
 * Deliberately does NOT trust `Date.UTC`'s own silent day-of-month overflow
 * (e.g. `20230230` "Feb 30" would otherwise roll forward into March) --
 * round-trips the constructed date back through its own year/month/day and
 * rejects anything that does not land exactly where the input said it would.
 * Interpreted as UTC midnight (yt-dlp's date-only fields carry no timezone/
 * time-of-day of their own) so the resulting epoch ms is stable across
 * whatever timezone this server process happens to run in.
 * @param {*} raw a raw, untrusted `YYYYMMDD` string (or anything else)
 * @returns {number|null}
 */
function parseCapturedReleaseDate(raw) {
  if (typeof raw !== 'string' || !YTDLP_DATE_PATTERN.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(ms);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    return null; // e.g. "20230230" (Feb 30) silently overflowed -- reject, never trust the rolled-forward date
  }
  if (ms < MIN_PLAUSIBLE_RELEASE_DATE_MS || ms > Date.now() + MAX_PLAUSIBLE_RELEASE_DATE_FUTURE_MS) return null;
  return ms;
}

// ---- v1.25 QoL (T1): per-subscription download `cutoffDate` (schema only) --
//
// Replaces the old "download last N videos" mental model with a per-
// subscription cutoff DATE: everything published on/after it is downloaded,
// no count cap (T2, a later task, is the one that actually wires this into
// the yt-dlp arg builder via `--dateafter`/removes `--playlist-end`; this
// file only adds the schema + validators + migration). `maxVideos` is left
// completely in place/dormant -- nothing here removes or changes it.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Format an epoch-ms timestamp as yt-dlp's own `YYYYMMDD` convention,
// interpreted in UTC -- the SAME representation `parseCapturedReleaseDate`
// consumes, so a value this produces always round-trips through that
// validator. UTC (not the server's local timezone) keeps the result stable
// regardless of where this process happens to run, mirroring
// `parseCapturedReleaseDate`'s own UTC-midnight interpretation.
function formatYyyymmdd(ms) {
  const d = new Date(ms);
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// Best-effort convert an ISO-8601 timestamp string (e.g. `sub.lastCheckedAt`/
// `sub.addedAt`) to a `YYYYMMDD` string, or `null` when `raw` is not a
// parseable date -- never throws. Used only by `ensureYtdlp`'s `cutoffDate`
// migration below, which needs a `YYYYMMDD` DATE (not a full timestamp) to
// backfill from an existing sub's own history.
function isoToYyyymmdd(raw) {
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return formatYyyymmdd(ms);
}

/**
 * Validate an optional per-subscription `cutoffDate` override (v1.25 QoL:
 * subscription download model). Mirrors `validateMaxVideos`'s contract
 * EXACTLY: `undefined` (the field simply absent) is valid and means "unset"
 * -- `addSubscription` backfills a brand-new subscription's cutoff to
 * YESTERDAY when unset (see below); an EXISTING subscription without one is
 * backfilled by `ensureYtdlp`'s migration (also below). Any other value must
 * be a `YYYYMMDD` string that ALSO parses as a plausible calendar date --
 * this reuses `parseCapturedReleaseDate`'s own shape+calendar+bounds check
 * (rejects e.g. `"20230230"`/Feb-30, a non-8-digit string, or a year outside
 * ~2000..now+1) rather than forking a second copy of that logic, so there is
 * exactly one source of truth in this file for "what is a valid `YYYYMMDD`
 * date." A malformed/implausible value is a hard validation error (never
 * silently coerced/clamped), same fail-safe posture as `validateMaxVideos`.
 */
function validateCutoffDate(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (parseCapturedReleaseDate(raw) === null) {
    return { ok: false, error: 'cutoffDate must be a valid YYYYMMDD date' };
  }
  return { ok: true, value: raw };
}

// Generous-but-bounded cap for a captured avatar URL -- real CDN thumbnail
// URLs (e.g. yt3.ggpht.com/...) are well under this; a pathological/hostile
// oversized value is rejected outright, matching this file's other bounded-
// string posture (MAX_CAPTURED_CHANNEL_NAME_LENGTH, MAX_PIN_LABEL_LENGTH).
const MAX_CHANNEL_AVATAR_URL_LENGTH = 2000;

/**
 * v1.24.0 C6: validate/bound a raw captured channel-avatar URL. Pure,
 * synchronous, never throws. Returns the normalized `href` (via the `URL`
 * constructor -- never the raw input string) when the value is a
 * well-formed, `https:`-only absolute URL within the length cap; `null`
 * otherwise (absent, malformed, oversized, or ANY non-`https:` scheme --
 * `http:`, `javascript:`, `data:`, `file:`, etc. are all rejected, the same
 * "reject rather than neutralize" posture `url.validateChannelUrl` uses for
 * a hostile channel URL).
 *
 * Also rejects embedded `user:pass@` userinfo -- mirrors `validateChannelUrl`'s
 * own SF6 posture (`lib/ytdlp/url.js`): a captured avatar URL that carries
 * credentials is already suspicious, there is no legitimate use for userinfo
 * on a CDN thumbnail URL, and this value gets persisted and rendered (as an
 * `<img src>`), so the same "reject outright rather than silently strip"
 * fail-safe choice applies here too.
 * @param {*} raw a raw, untrusted URL string (or anything else)
 * @returns {string|null}
 */
function sanitizeChannelAvatarUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > MAX_CHANNEL_AVATAR_URL_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return null; // never persist a raw control char inside a stored URL string
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null; // not a well-formed absolute URL -- drop rather than store a relative/garbage value
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  return parsed.href;
}

/**
 * v1.20.0 FR-2: validate/bound a SINGLE captured channel-meta entry (the
 * shape `run.parseChannelMetaLine` returns, or a subscription's own
 * already-validated `{ channelUrl, channelName }` fallback -- see
 * lib/ytdlp/index.js) before it is ever allowed to reach
 * `recordDownloadChannelMeta`'s persistence. Pure, synchronous, never
 * throws. Returns `null` when the entry has no safe join key (`videoId`
 * fails `url.isSafeVideoId`) OR no usable channel URL survives validation --
 * either case means "drop this entry entirely," never a partial/best-effort
 * store.
 *
 * - `channelUrl` <- the first of `raw.channelUrl`, else `raw.uploaderUrl`,
 *   that passes `url.validateChannelUrl` (the returned, NORMALIZED value is
 *   what is kept -- never the raw input string).
 * - `channelHandleUrl` <- `raw.uploaderUrl` ONLY when it independently passes
 *   validation AND differs from the chosen `channelUrl` (broadens matching
 *   without ever duplicating the primary identity).
 * - `channelId` <- `raw.channelId` ONLY when it matches `CHANNEL_ID_PATTERN`.
 * - `channelName` <- `raw.channelName`, control characters stripped and
 *   length-bounded; absent when empty after stripping.
 * - `releaseDate` (v1.24.0 C5-ytdlp) <- `raw.releaseDate`, else
 *   `raw.uploadDate` (both raw `YYYYMMDD` strings), parsed/bounded via
 *   `parseCapturedReleaseDate` into an epoch-ms number; `release_date` is
 *   preferred when both are present since it is the more precise "when this
 *   was actually released" signal for a premiere/livestream, while
 *   `upload_date` is the reliable fallback present on every normal upload.
 *   Absent when neither survives parsing.
 * - `channelAvatarUrl` (v1.24.0 C6) <- `raw.channelThumbnail`, validated/
 *   bounded via `sanitizeChannelAvatarUrl` (an `https:`-only, length-capped,
 *   well-formed absolute URL). Absent when it does not survive validation.
 * @param {*} raw `{ videoId, channelUrl, channelId, uploaderUrl, channelName, uploadDate, releaseDate, channelThumbnail }`
 * @returns {{videoId: string, channelUrl: string, channelHandleUrl?: string, channelId?: string, channelName?: string, releaseDate?: number, channelAvatarUrl?: string} | null}
 */
function sanitizeCapturedChannelMeta(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  if (!isSafeVideoId(input.videoId)) return null; // no safe join key -- drop entirely

  let channelUrl = null;
  if (typeof input.channelUrl === 'string') {
    const check = validateChannelUrl(input.channelUrl);
    if (check.ok) channelUrl = check.url;
  }
  if (!channelUrl && typeof input.uploaderUrl === 'string') {
    const check = validateChannelUrl(input.uploaderUrl);
    if (check.ok) channelUrl = check.url;
  }
  if (!channelUrl) return null; // neither URL survives validation -- no identity

  let channelHandleUrl;
  if (typeof input.uploaderUrl === 'string') {
    const check = validateChannelUrl(input.uploaderUrl);
    if (check.ok && check.url !== channelUrl) channelHandleUrl = check.url;
  }

  let channelId;
  if (typeof input.channelId === 'string' && CHANNEL_ID_PATTERN.test(input.channelId)) {
    channelId = input.channelId;
  }

  let channelName;
  if (typeof input.channelName === 'string') {
    // eslint-disable-next-line no-control-regex
    const stripped = input.channelName.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (stripped !== '') {
      channelName = stripped.length > MAX_CAPTURED_CHANNEL_NAME_LENGTH
        ? stripped.slice(0, MAX_CAPTURED_CHANNEL_NAME_LENGTH)
        : stripped;
    }
  }

  // v1.24.0 C5-ytdlp: release_date preferred over upload_date (see this
  // function's own doc comment above for why); either is a raw `YYYYMMDD`
  // string, parsed/bounded by `parseCapturedReleaseDate`.
  const releaseDate = parseCapturedReleaseDate(input.releaseDate) ?? parseCapturedReleaseDate(input.uploadDate);

  // v1.24.0 C6: raw channel-thumbnail URL, validated/bounded exactly like
  // channelUrl is above (never the raw input string -- the normalized `href`
  // sanitizeChannelAvatarUrl returns, or absent entirely).
  const channelAvatarUrl = sanitizeChannelAvatarUrl(input.channelThumbnail);

  return {
    videoId: input.videoId,
    channelUrl,
    ...(channelHandleUrl ? { channelHandleUrl } : {}),
    ...(channelId ? { channelId } : {}),
    ...(channelName ? { channelName } : {}),
    ...(releaseDate !== null ? { releaseDate } : {}),
    ...(channelAvatarUrl ? { channelAvatarUrl } : {}),
  };
}

/**
 * v1.20.0 FR-2: persist ONE captured/sanitized channel-meta entry into
 * `db.ytdlp.downloadMeta`, keyed by `videoId`. Runs `sanitizeCapturedChannelMeta`
 * first -- an entry that fails sanitization is silently dropped (resolves
 * `false`, never rejects/throws for that reason) rather than partially
 * stored. Writes through the SAME serialized `updateDatabase` every other
 * mutator in this file uses. Enforces the `MAX_DOWNLOAD_META` FIFO cap:
 * once the map exceeds it, the OLDEST entries (by `capturedAt`) are evicted
 * first, so the map can never grow unbounded even if
 * `consumeDownloadChannelMeta` is never called for some entries (e.g. a scan
 * never runs, or the file is deleted before it is ever indexed).
 * @param {object} deps `{ updateDatabase }`
 * @param {*} entry raw, untrusted capture (or a subscription's own trusted fallback)
 * @returns {Promise<boolean>} whether the entry was recorded
 */
function recordDownloadChannelMeta(deps, entry) {
  const sanitized = sanitizeCapturedChannelMeta(entry);
  if (!sanitized) return Promise.resolve(false);
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    ns.downloadMeta[sanitized.videoId] = {
      channelUrl: sanitized.channelUrl,
      ...(sanitized.channelHandleUrl ? { channelHandleUrl: sanitized.channelHandleUrl } : {}),
      ...(sanitized.channelId ? { channelId: sanitized.channelId } : {}),
      ...(sanitized.channelName ? { channelName: sanitized.channelName } : {}),
      ...(sanitized.releaseDate !== undefined ? { releaseDate: sanitized.releaseDate } : {}),
      ...(sanitized.channelAvatarUrl ? { channelAvatarUrl: sanitized.channelAvatarUrl } : {}),
      capturedAt: Date.now(),
    };
    const keys = Object.keys(ns.downloadMeta);
    if (keys.length > MAX_DOWNLOAD_META) {
      const oldestFirst = keys.sort((a, b) => (ns.downloadMeta[a].capturedAt || 0) - (ns.downloadMeta[b].capturedAt || 0));
      const overflow = oldestFirst.length - MAX_DOWNLOAD_META;
      for (let i = 0; i < overflow; i++) delete ns.downloadMeta[oldestFirst[i]];
    }
  }).then(() => true);
}

/**
 * v1.20.0 FR-2: the scan-time bridge read. Reads (and re-validates,
 * defense-in-depth) `db.ytdlp.downloadMeta[videoId]`, then DELETES that key
 * regardless of outcome -- "consumed," bounding the map's growth to "lives
 * only until first index," per the design. Operates DIRECTLY on the `db`
 * object handed to it (never calls `updateDatabase` itself) so it is safe to
 * call from INSIDE an already-running `updateDatabase` mutator (server.js's
 * scan does exactly this) without violating that primitive's
 * non-reentrancy contract.
 *
 * Re-validates every field before returning it, even though
 * `recordDownloadChannelMeta` already sanitized it once at capture time --
 * the SAME untrusted-until-proven posture the whole FR-2 chain uses (a
 * value crossing this second boundary, persisted between two separate
 * server runs, gets the same scrutiny as one that just arrived from yt-dlp).
 * @param {object} db a database object (the `fresh` db inside a running
 *   `updateDatabase` mutator, or a plain loaded db)
 * @param {*} videoId
 * @returns {{channelUrl: string, channelHandleUrl?: string, channelId?: string, channelName?: string, releaseDate?: number, channelAvatarUrl?: string} | null}
 */
function consumeDownloadChannelMeta(db, videoId) {
  if (!isSafeVideoId(videoId)) return null;
  const ns = ensureYtdlp(db);
  const entry = ns.downloadMeta[videoId];
  if (!entry || typeof entry !== 'object') return null;
  delete ns.downloadMeta[videoId]; // consumed -- bounded growth regardless of what follows

  let channelUrl = null;
  if (typeof entry.channelUrl === 'string') {
    const check = validateChannelUrl(entry.channelUrl);
    if (check.ok) channelUrl = check.url;
  }
  if (!channelUrl) return null; // no usable identity survives re-validation

  const result = { channelUrl };
  if (typeof entry.channelHandleUrl === 'string') {
    const check = validateChannelUrl(entry.channelHandleUrl);
    if (check.ok) result.channelHandleUrl = check.url;
  }
  if (typeof entry.channelId === 'string' && CHANNEL_ID_PATTERN.test(entry.channelId)) {
    result.channelId = entry.channelId;
  }
  if (typeof entry.channelName === 'string' && entry.channelName !== '') {
    result.channelName = entry.channelName;
  }
  // v1.24.0 C5-ytdlp: re-validated the SAME way `recordDownloadChannelMeta`
  // stored it -- `entry.releaseDate` is already an epoch-ms number by the
  // time it was persisted (sanitizeCapturedChannelMeta's job), so re-parsing
  // via `parseCapturedReleaseDate` (which only ever accepts a raw `YYYYMMDD`
  // string) would always reject it; a plain finite-number + bounds re-check
  // is the correct re-validation shape for an ALREADY-epoch-ms persisted
  // value, mirroring `server.js`'s own consumer-side guard
  // (`typeof consumed.releaseDate === 'number' && Number.isFinite(...)`).
  if (
    typeof entry.releaseDate === 'number' &&
    Number.isFinite(entry.releaseDate) &&
    entry.releaseDate >= MIN_PLAUSIBLE_RELEASE_DATE_MS &&
    entry.releaseDate <= Date.now() + MAX_PLAUSIBLE_RELEASE_DATE_FUTURE_MS
  ) {
    result.releaseDate = entry.releaseDate;
  }
  // v1.24.0 C6: re-validated via the SAME sanitizeChannelAvatarUrl gate
  // recordDownloadChannelMeta already ran at capture time.
  const reCheckedAvatarUrl = sanitizeChannelAvatarUrl(entry.channelAvatarUrl);
  if (reCheckedAvatarUrl) result.channelAvatarUrl = reCheckedAvatarUrl;
  return result;
}

// Reads the current subscription list, SORTED by `order` ascending (v1.24.0
// B4: `ensureYtdlp`'s backfill above guarantees every subscription has an
// integer `order` by the time this runs, so the sort key is always present --
// this is a defensive belt-and-suspenders fallback to `0`, never a crash, for
// a hostile/corrupt record that somehow slips past the backfill). Read-only:
// backfills IN MEMORY (via ensureYtdlp on the freshly-loaded db) so a caller
// always sees a well-formed array, but never writes -- only
// `addSubscription`/`deleteSubscription`/`setSubscriptionStatus`/
// `reorderSubscriptions`/`setAllowMembersOnly` persist through
// `updateDatabase`. Returns a NEW array (`slice` before `sort`) -- the
// underlying `db.ytdlp.subscriptions` array order (insertion order) is never
// mutated by a read.
function listSubscriptions(deps) {
  const db = deps.loadDatabase();
  const subs = ensureYtdlp(db).subscriptions;
  return subs.slice().sort((a, b) => {
    const orderA = a && typeof a.order === 'number' ? a.order : 0;
    const orderB = b && typeof b.order === 'number' ? b.order : 0;
    return orderA - orderB;
  });
}

/**
 * Add a subscription. `{ channelUrl, format, quality, name }` is assumed
 * already-validated (callers should run `validateSubscriptionInput` first);
 * this function still defends against missing `format`/`quality` by
 * defaulting them, mirroring the record shape everywhere. Idempotent by id:
 * `id = getMediaId(normalizedChannelUrl)` (the same stable md5-of-path hash
 * server.js uses for media ids, reused for a stable hash-of-string). If a
 * subscription with that id already exists, no duplicate is created -- the
 * existing record is returned unchanged (add is a no-op re-add, not a
 * conflict error, since re-adding the same channel is a normal user action).
 *
 * `nowMs` (v1.25 QoL, T1) is an OPTIONAL injected "current time," defaulting
 * to the real `Date.now()` -- it exists purely so the "no `cutoffDate`
 * supplied -> default to YESTERDAY" rule below is deterministic/testable; it
 * does not affect `addedAt` (still the real wall clock at write time).
 */
function addSubscription(deps, { channelUrl, format, quality, name, maxVideos, maxDurationSeconds, paused, skipShorts, filetype, cutoffDate } = {}, nowMs = Date.now()) {
  const normalized = normalizeChannelUrl(channelUrl);
  const id = deps.getMediaId(normalized);
  const resolvedFormat = VALID_FORMATS.has(format) ? format : DEFAULT_FORMAT;
  const resolvedQuality = typeof quality === 'string' && quality.trim() !== '' ? quality.trim() : DEFAULT_QUALITY;
  // FR-C/FR-D: both optional at add-time. An invalid value fails safe to
  // "unset" here (the caller is expected to have already run
  // validateSubscriptionInput and rejected a bad value with a 400 well
  // before this point ever runs) rather than throwing mid-write.
  const maxVideosResult = validateMaxVideos(maxVideos);
  const resolvedMaxVideos = maxVideosResult.ok ? maxVideosResult.value : undefined;
  // v1.22.0 FR-6: same fail-safe-to-unset posture as maxVideos above.
  const maxDurationSecondsResult = validateMaxDurationSeconds(maxDurationSeconds);
  const resolvedMaxDurationSeconds = maxDurationSecondsResult.ok ? maxDurationSecondsResult.value : undefined;
  const pausedResult = validatePaused(paused);
  const resolvedPaused = pausedResult.ok && pausedResult.value !== undefined ? pausedResult.value : false;
  // v1.15.0 item 4: same fail-safe-to-`false` posture as `paused` above.
  const skipShortsResult = validateSkipShorts(skipShorts);
  const resolvedSkipShorts = skipShortsResult.ok && skipShortsResult.value !== undefined ? skipShortsResult.value : false;
  // v1.13.0 item 4: same fail-safe-to-unset posture as maxVideos above --
  // resolvedFormat is used (never the raw, possibly-absent `format`), since
  // the allowlist is format-partitioned.
  const filetypeResult = validateFiletype(resolvedFormat, filetype);
  const resolvedFiletype = filetypeResult.ok ? filetypeResult.value : undefined;
  // v1.25 QoL (T1): UNLIKE maxVideos/maxDurationSeconds/filetype above, an
  // unset (or invalid, defensively) `cutoffDate` does NOT fail safe to
  // "unset" -- a brand-new subscription always gets a concrete cutoff, so a
  // caller that never explicitly sets one still gets the documented default
  // (download everything published on/after YESTERDAY, never the entire back
  // catalog). A caller-supplied, VALID value is used as-is.
  const cutoffDateResult = validateCutoffDate(cutoffDate);
  const resolvedCutoffDate = cutoffDateResult.ok && cutoffDateResult.value !== undefined
    ? cutoffDateResult.value
    : formatYyyymmdd(nowMs - ONE_DAY_MS);

  let record;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const existing = ns.subscriptions.find((sub) => sub.id === id);
    if (existing) {
      record = existing;
      return false; // no-op re-add: nothing changed, skip the save
    }
    record = {
      id,
      channelUrl,
      name: name || deriveDisplayName(channelUrl),
      format: resolvedFormat,
      quality: resolvedQuality,
      maxVideos: resolvedMaxVideos,
      maxDurationSeconds: resolvedMaxDurationSeconds,
      paused: resolvedPaused,
      skipShorts: resolvedSkipShorts,
      filetype: resolvedFiletype,
      cutoffDate: resolvedCutoffDate,
      // v1.24.0 B4 (fast-follow fix): a brand-new subscription is appended at
      // the TAIL of the existing order -- one more than the MAX existing
      // `order` value, NOT `ns.subscriptions.length`. A deletion (see
      // `deleteSubscription` below) removes an entry from the array without
      // renumbering the survivors' `order` values, so the array length can
      // fall behind the highest `order` already in use once anything has
      // ever been deleted; using the length here would let a new
      // subscription's `order` collide with (or land BELOW) a surviving
      // one's, sorting it into the MIDDLE of the list instead of the tail
      // (the regression this fixes). Reducing over the current array's own
      // `order` values (defensively falling back to `-1` for any
      // non-integer, so an empty list starts a fresh add at `0`) is
      // therefore the only way to guarantee "always greater than every
      // existing order," matching this comment's own promise.
      order: 1 + ns.subscriptions.reduce((max, sub) => Math.max(max, Number.isInteger(sub.order) ? sub.order : -1), -1),
      addedAt: new Date().toISOString(),
      lastCheckedAt: null,
      lastStatus: null,
    };
    ns.subscriptions.push(record);
  }).then(() => record);
}

/**
 * Remove a subscription by id. Returns `true` if a subscription was removed,
 * `false` if no subscription with that id existed (so the route can 404).
 *
 * D3 nuance: this ONLY stops future polling of the subscription (it is
 * simply no longer in `db.ytdlp.subscriptions`). It never touches the
 * download-archive file -- that is a downloaded-media-file dedup concern
 * (T3/T4), entirely separate from subscription bookkeeping, and this
 * function has no knowledge of it.
 */
function deleteSubscription(deps, id) {
  let removed = false;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const before = ns.subscriptions.length;
    ns.subscriptions = ns.subscriptions.filter((sub) => sub.id !== id);
    removed = ns.subscriptions.length < before;
    if (!removed) return false; // unknown id: nothing changed, skip the save
  }).then(() => removed);
}

/**
 * Update a subscription's poll-status fields (used by T4's poll loop).
 * Returns `true` if the subscription was found and updated, `false`
 * otherwise. `lastCheckedAt`/`lastStatus` are unconditionally overwritten
 * when present (unchanged behavior); `cutoffDate` (v1.25 QoL, two-reviewer-
 * gate FIX 1) is the ONE exception -- see below.
 *
 * FIX 1 (two-reviewer gate, post-v1.25.0): `cutoffDate` is folded into this
 * SAME write (rather than a second `updateDatabase` round trip) so a poll
 * cycle's status persistence and its cutoff-advance are one atomic mutation.
 * Unlike `lastCheckedAt`/`lastStatus`, an incoming `cutoffDate` is NEVER
 * trusted/applied unconditionally: it is
 *   (a) re-validated as a plausible `YYYYMMDD` date (via the SAME
 *       `parseCapturedReleaseDate` shape+calendar+bounds check
 *       `validateCutoffDate` uses -- a malformed value from a hostile/buggy
 *       caller is silently ignored, never corrupts the record), AND
 *   (b) only ever applied when it is STRICTLY GREATER (lexicographic
 *       `YYYYMMDD` string compare == calendar-date compare) than the
 *       subscription's CURRENT `cutoffDate` (or the sub has none yet) --
 *       `cutoffDate` must only ever advance FORWARD, never regress the
 *       "everything since" download window. This guard lives HERE (the
 *       actual persistence boundary), not only in the caller
 *       (`lib/ytdlp/index.js`'s `processSubscription`) that decides WHETHER
 *       to advance -- defense-in-depth so a caller bug can never move a
 *       subscription's window backward and risk re-listing (never
 *       re-downloading -- `--download-archive` still dedups that) its whole
 *       history again.
 * `cutoffDate` absent (`undefined`) -- the overwhelmingly common case, every
 * cycle that did NOT qualify to advance -- leaves the field completely
 * untouched, exactly like every other omitted field in this function's
 * contract.
 */
function setSubscriptionStatus(deps, id, { lastCheckedAt, lastStatus, cutoffDate } = {}) {
  let updated = false;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const sub = ns.subscriptions.find((s) => s.id === id);
    if (!sub) return false;
    sub.lastCheckedAt = lastCheckedAt !== undefined ? lastCheckedAt : sub.lastCheckedAt;
    sub.lastStatus = lastStatus !== undefined ? lastStatus : sub.lastStatus;
    if (
      typeof cutoffDate === 'string' &&
      parseCapturedReleaseDate(cutoffDate) !== null &&
      (typeof sub.cutoffDate !== 'string' || cutoffDate > sub.cutoffDate)
    ) {
      sub.cutoffDate = cutoffDate;
    }
    updated = true;
  }).then(() => updated);
}

/**
 * v1.24.0 C6 (T11): best-effort backfill of a subscription's OWN
 * `channelAvatarUrl` from a freshly captured, already-sanitized avatar URL
 * (see `sanitizeChannelAvatarUrl` above -- re-validated here again,
 * defense-in-depth, the same re-validate-at-every-boundary posture
 * `consumeDownloadChannelMeta` uses). Matches by `channelUrl` (the SAME
 * identity `matchChannelDirToSubscription`, lib/ytdlp/index.js, already
 * matches subscriptions by), NOT by `id` -- the caller (`index.js`'s
 * `persistCapturedChannelMeta`) only ever has a captured entry's
 * `channelUrl` to key off of, never a subscription id.
 *
 * Never throws; a no-match, an invalid `channelAvatarUrl`, or an unchanged
 * value is a silent no-op (resolves `false`) -- mirroring this file's other
 * best-effort/tolerant-of-a-miss mutators (e.g. `reduceReorder`'s
 * ignore-unknown-id posture). Deliberately OVERWRITES a previously captured
 * avatar with a newer one -- unlike the identity fields
 * (`channelUrl`/`channelId`/`name`) this file otherwise treats as
 * write-once/never-overwrite (AC17), a channel's avatar image can
 * legitimately change over time, and staying current is more valuable than
 * pinning the first-ever captured value.
 * @param {object} deps `{ updateDatabase }`
 * @param {*} channelUrl the ALREADY-validated/normalized channelUrl to match
 *   subscriptions against (e.g. `sanitizeCapturedChannelMeta`'s own
 *   `channelUrl` output -- never a raw, unvalidated string)
 * @param {*} channelAvatarUrl a raw, untrusted avatar URL (re-validated here)
 * @returns {Promise<boolean>} whether a subscription's record was changed
 */
function recordSubscriptionChannelAvatar(deps, channelUrl, channelAvatarUrl) {
  const safeAvatarUrl = sanitizeChannelAvatarUrl(channelAvatarUrl);
  if (!safeAvatarUrl) return Promise.resolve(false);
  if (typeof channelUrl !== 'string' || channelUrl.trim() === '') return Promise.resolve(false);
  let changed = false;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const sub = ns.subscriptions.find((s) => s.channelUrl === channelUrl);
    if (!sub) return false; // no matching subscription -- nothing to backfill, not an error
    if (sub.channelAvatarUrl === safeAvatarUrl) return false; // already current -- no-op, skip the save
    sub.channelAvatarUrl = safeAvatarUrl;
    changed = true;
  }).then(() => changed);
}

/**
 * Update an existing subscription's editable fields (FR-D): any subset of
 * `{format, quality, maxVideos, maxDurationSeconds, paused, skipShorts}`
 * present in `patch` is written; fields ABSENT from `patch` are left
 * untouched. `id`/`channelUrl`/`name`/
 * `addedAt`/`lastCheckedAt`/`lastStatus` are NEVER touched by this function
 * (AC21) -- there is no code path here that can mutate them. `patch` is
 * assumed already validated (callers should run `validateSubscriptionPatch`
 * first, mirroring `addSubscription`'s `validateSubscriptionInput`
 * contract); each field is still re-checked against the SAME validators
 * immediately before it is allowed to mutate the persisted record, exactly
 * the defense-in-depth posture args.js's builders already use for
 * format/quality. Returns the updated record, or `null` if no subscription
 * with that id exists (the caller maps that to a `404`, AC24).
 */
function updateSubscription(deps, id, patch = {}) {
  const body = patch && typeof patch === 'object' ? patch : {};
  let record = null;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const sub = ns.subscriptions.find((s) => s.id === id);
    if (!sub) return false; // unknown id: nothing changed, skip the save

    if (body.format !== undefined && VALID_FORMATS.has(body.format)) {
      sub.format = body.format;
    }
    if (body.quality !== undefined && typeof body.quality === 'string' && body.quality.trim() !== '') {
      sub.quality = body.quality.trim();
    }
    if (body.maxVideos !== undefined) {
      const result = validateMaxVideos(body.maxVideos);
      if (result.ok) sub.maxVideos = result.value;
    }
    if (body.maxDurationSeconds !== undefined) {
      // v1.22.0 FR-6: re-validated immediately before mutate, same
      // defense-in-depth posture as maxVideos above.
      const result = validateMaxDurationSeconds(body.maxDurationSeconds);
      if (result.ok) sub.maxDurationSeconds = result.value;
    }
    if (body.paused !== undefined) {
      const result = validatePaused(body.paused);
      if (result.ok) sub.paused = result.value;
    }
    if (body.skipShorts !== undefined) {
      // v1.15.0 item 4: re-validated immediately before mutate, same
      // defense-in-depth posture as format/quality/maxVideos/paused above.
      const result = validateSkipShorts(body.skipShorts);
      if (result.ok) sub.skipShorts = result.value;
    }
    if (body.filetype !== undefined) {
      // v1.13.0 item 4: re-validated immediately before mutate, same
      // defense-in-depth posture as format/quality/maxVideos/paused above.
      // `effectiveFormat` accounts for a patch that changes `format` and
      // `filetype` together in the SAME request -- the allowlist check must
      // use the format the record will actually have after this write, not
      // its stale pre-patch value.
      const effectiveFormat = body.format !== undefined && VALID_FORMATS.has(body.format) ? body.format : sub.format;
      const result = validateFiletype(effectiveFormat, body.filetype);
      if (result.ok) sub.filetype = result.value;
    }
    if (body.cutoffDate !== undefined) {
      // v1.25 QoL (T1): re-validated immediately before mutate, same
      // defense-in-depth posture as maxVideos/paused/filetype above -- lets
      // a user edit a subscription's cutoff date after the fact (a hostile/
      // malformed value slipping past an upstream validator is ignored, not
      // written).
      const result = validateCutoffDate(body.cutoffDate);
      if (result.ok) sub.cutoffDate = result.value;
    }
    record = sub;
  }).then(() => record);
}

// ---- v1.24.0 B4 (FR-8): drag-and-drop subscription reorder ----
//
// Applies to the subscriptions MANAGEMENT list in
// `lib/ytdlp/views/subscriptions.html` -- a distinct concept from the pinned
// sidebar above. Client-side DnD mechanics (`moveArrayItem`/
// `computeDropIndex`) are reused VERBATIM from `public/js/common.js` (mirrors
// the existing folder-DnD reorder); this store only needs the RESULT of that
// drag -- the caller's full desired id order -- to persist it.

/**
 * Pure reducer: compute the next `subs` array after a drag-and-drop reorder.
 * `orderedIds` is the caller's full desired id order (typically every
 * currently-known subscription id, reordered by the drag) -- but this
 * function is deliberately tolerant of a partial/hostile list:
 *
 * - An id in `orderedIds` that does not match any subscription in `subs` is
 *   IGNORED (never creates a phantom entry, never errors).
 * - A duplicate id in `orderedIds` is only honored on its FIRST occurrence
 *   (later duplicates are treated as already-seen, same as an unknown id).
 * - A subscription in `subs` whose id is simply ABSENT from `orderedIds`
 *   keeps a stable TAIL position: it is placed after every id that DID
 *   appear in `orderedIds`, in its own original relative order (so a
 *   never-dragged subscription's relative position to its other
 *   never-dragged siblings never changes).
 *
 * Returns a NEW array (never mutates `subs` or any of its elements) with
 * `order` set to each subscription's resulting integer position. Every field
 * other than `order` is left byte-identical on each returned record (a
 * shallow copy only where `order` actually changes).
 * @param {Array<object>} subs the current subscription list (any order)
 * @param {Array<string>} orderedIds the desired id order (from a client drag)
 * @returns {Array<object>} a new subscription array with `order` reassigned
 */
function reduceReorder(subs, orderedIds) {
  const list = Array.isArray(subs) ? subs : [];
  const knownIds = new Set(list.filter((sub) => sub && sub.id !== undefined).map((sub) => sub.id));
  const candidateIds = Array.isArray(orderedIds) ? orderedIds : [];

  const seen = new Set();
  const leadingIds = [];
  for (const id of candidateIds) {
    if (knownIds.has(id) && !seen.has(id)) {
      leadingIds.push(id);
      seen.add(id);
    }
  }

  const position = new Map();
  leadingIds.forEach((id, index) => position.set(id, index));
  // Tail: every subscription NOT placed above, kept in its ORIGINAL relative
  // order (a stable partition, not a re-sort), appended after every leading id.
  let tailIndex = leadingIds.length;
  for (const sub of list) {
    if (sub && sub.id !== undefined && !position.has(sub.id)) {
      position.set(sub.id, tailIndex);
      tailIndex += 1;
    }
  }

  return list.map((sub) => (sub && position.has(sub.id) ? { ...sub, order: position.get(sub.id) } : sub));
}

/**
 * Persist a drag-and-drop reorder (B4). Reads the current subscription list,
 * runs it through the pure `reduceReorder` above, and writes the result back
 * through the SAME serialized `updateDatabase` every other mutator in this
 * file uses -- mutating ONLY `db.ytdlp.subscriptions`, never `db.folders`
 * (see the module-level HARD INVARIANT comment above `isChannelDirConfined`,
 * which applies to every mutator in this file, not just the pins ones).
 * `orderedIds` is assumed to already be a plain array of strings by the time
 * it reaches here (callers, e.g. T8's route, validate the request shape) --
 * `reduceReorder` itself still degrades safely (never throws) on a
 * malformed/partial value.
 * @param {object} deps `{ updateDatabase, loadDatabase }`
 * @param {Array<string>} orderedIds the desired id order
 * @returns {Promise<Array<object>>} the resulting, re-ordered subscription list
 */
function reorderSubscriptions(deps, orderedIds) {
  let result;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    ns.subscriptions = reduceReorder(ns.subscriptions, orderedIds);
    result = ns.subscriptions;
  }).then(() => result);
}

// Reads the persisted members-only toggle (default false). Read-only, same
// in-memory-backfill pattern as listSubscriptions.
function getAllowMembersOnly(deps) {
  const db = deps.loadDatabase();
  return ensureYtdlp(db).allowMembersOnly;
}

// Persists the members-only toggle. `value` is coerced to a strict boolean
// by the caller (the route validates it is a boolean before calling this).
function setAllowMembersOnly(deps, value) {
  const bool = value === true;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    ns.allowMembersOnly = bool;
  }).then(() => bool);
}

// ---- v1.21.0 FR-5: channel pins (HEAVY, two-reviewer, data-safety gate) ---
//
// A pin is a SNAPSHOT `{ id, channelDir, label, pinnedAt }` -- `id =
// getMediaId(channelDir)` (stable, slash-free key usable as a route param;
// distinct from a subscription's own `id`, which hashes `channelUrl`, NOT
// `channelDir` -- a pin and its originating subscription are deliberately
// two independent identities, per the resolved fork: unsubscribing a channel
// without deleting its files must never break an existing pin) -- and
// `label` is the display name at PIN time, not a live join back to the
// subscription record, so it survives an unsubscribe untouched.
//
// HARD INVARIANT (the two-reviewer gate's actual focus): `db.ytdlp.pins`
// lives EXCLUSIVELY in this module's own `db.ytdlp` namespace.
//   - It is never written into, or read from, `db.folders`/`db.folderSettings`
//     anywhere in this file (grep confirms: neither identifier appears
//     below this comment).
//   - `server.js`'s `POST /api/config` handler (the only writer of
//     `db.folders`/`db.folderSettings`) mutates ONLY those two keys inside
//     its `updateDatabase` callback (`db.folders = validFolders; db.folderSettings
//     = cleanSettings;`) -- `updateDatabase`'s contract (see server.js) hands
//     the mutator the FULL freshly-loaded `db` object and persists whatever
//     it did not explicitly overwrite, so `db.ytdlp` (and therefore
//     `db.ytdlp.pins`) round-trips through every config save completely
//     untouched. This module never calls into `server.js`, and `server.js`
//     never calls into this pin store -- there is no code path connecting
//     the two, structurally, not just by convention.
//   - A pin is surfaced client-side purely as a `/?root=<channelDir>` link
//     (`GET /api/videos`'s existing pure path-prefix filter, unrestricted to
//     `db.folders` entries -- the SAME mechanism v1.20 FR-4's `channelDir`
//     Playlist link already relies on) -- never as a `db.folders` entry, so
//     it is never scanned/pruned as a managed folder.

// Generous-but-bounded cap on the pinned-channel list -- pins are an
// explicit, low-frequency user action (unlike `downloadMeta`'s
// automatically-populated-per-download entries), so a much smaller cap than
// `MAX_DOWNLOAD_META` is appropriate. Exceeding it evicts the OLDEST pin
// first (FIFO, mirroring `recordDownloadChannelMeta`'s eviction posture)
// rather than rejecting a well-formed request -- a home-server operator
// pinning their 201st channel gets a quietly-recycled oldest slot, not an
// error.
const MAX_PINS = 300;

// Same order-of-magnitude bound as `MAX_CAPTURED_CHANNEL_NAME_LENGTH` above
// -- generous for any real channel display name while still rejecting a
// pathological/oversized value outright.
const MAX_PIN_LABEL_LENGTH = 200;

/**
 * Strip control characters and length-bound a pin's display label. Pure,
 * never throws. A non-string input yields `''` (the caller treats an empty
 * label as invalid -- see `validatePinInput` below).
 */
function sanitizePinLabel(label) {
  if (typeof label !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const stripped = label.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return stripped.length > MAX_PIN_LABEL_LENGTH ? stripped.slice(0, MAX_PIN_LABEL_LENGTH) : stripped;
}

/**
 * The add-pin confinement predicate (security): is `channelDir` the
 * download root itself, or a descendant of it? Delegates entirely to
 * `args.isPathUnder` -- the SAME containment primitive `resolveChannelDir`/
 * SF4's post-download confinement check are built on -- rather than a
 * second, forked `path.resolve` prefix check. Pure, no filesystem access;
 * never throws. A hostile/absent `channelDir`, or a missing/blank
 * `config.downloadDir`, both fail closed (`false`).
 */
function isChannelDirConfined(config, channelDir) {
  if (typeof channelDir !== 'string' || channelDir.trim() === '') return false;
  const downloadDir = config && config.downloadDir;
  if (typeof downloadDir !== 'string' || downloadDir.trim() === '') return false;
  return isPathUnder(channelDir, downloadDir);
}

/**
 * Validate a `POST /api/subscriptions/pins` request body. Returns
 * `{ ok: true, value: { channelDir, label } }` (with `channelDir`
 * `path.resolve`-normalized, matching the shape `GET /api/subscriptions`'s
 * own `channelDir` enrichment already produces) or `{ ok: false, error }`.
 * Pure -- does not touch any deps. A `channelDir` that resolves outside
 * `config.downloadDir` is a hard validation error (never silently
 * neutralized/truncated to something else) -- the route maps this to a
 * `400`, so a hostile pin can never reach `addPin`, let alone persist.
 */
function validatePinInput(config, body) {
  const input = body && typeof body === 'object' ? body : {};
  if (typeof input.channelDir !== 'string' || input.channelDir.trim() === '') {
    return { ok: false, error: 'channelDir is required' };
  }
  const channelDir = path.resolve(input.channelDir.trim());
  if (!isChannelDirConfined(config, channelDir)) {
    return { ok: false, error: 'channelDir must be confined under the configured download directory' };
  }
  const label = sanitizePinLabel(input.label);
  if (label === '') {
    return { ok: false, error: 'label is required' };
  }
  return { ok: true, value: { channelDir, label } };
}

/**
 * Pure reducer: compute the next `pins` array after adding
 * `{ id, channelDir, label, pinnedAt }`. Idempotent by id -- a pin that
 * already exists is returned UNCHANGED (`changed: false`, `record` is the
 * EXISTING record, never overwritten by a re-pin with a different label/
 * timestamp) rather than duplicated or updated; this mirrors
 * `addSubscription`'s own idempotent-no-op-re-add posture. Enforces
 * `MAX_PINS` by evicting the OLDEST entries (array-order == insertion
 * order, so a plain `slice` off the front is the FIFO eviction) once the
 * cap is exceeded. Never mutates its `pins` argument -- always returns a
 * fresh array.
 */
function reduceAddPin(pins, { id, channelDir, label, pinnedAt }) {
  const list = Array.isArray(pins) ? pins : [];
  const existing = list.find((p) => p && p.id === id);
  if (existing) return { pins: list, record: existing, changed: false };
  // v1.24.3 (pinned-channel DnD reorder): a brand-new pin is appended at the
  // TAIL of the existing order -- one more than the MAX existing `order`
  // value, NOT `list.length`. Mirrors `addSubscription`'s own order-gap fix
  // (see its comment for the full rationale): `reduceRemovePin` removes an
  // entry from the array without renumbering the survivors' `order` values,
  // so the array length can fall behind the highest `order` already in use
  // once anything has ever been unpinned; using the length here would let a
  // new pin's `order` collide with (or land BELOW) a surviving one's,
  // sorting it into the MIDDLE of the list instead of the tail.
  const order = 1 + list.reduce((max, p) => Math.max(max, p && Number.isInteger(p.order) ? p.order : -1), -1);
  const record = { id, channelDir, label, pinnedAt, order };
  const next = [...list, record];
  const bounded = next.length > MAX_PINS ? next.slice(next.length - MAX_PINS) : next;
  return { pins: bounded, record, changed: true };
}

/**
 * Pure reducer: compute the next `pins` array after removing `id`.
 * `changed` is `false` (array returned as-is) when no pin with that id
 * existed, so the caller can skip the `updateDatabase` save / map it to a
 * `404`. Never mutates its `pins` argument.
 */
function reduceRemovePin(pins, id) {
  const list = Array.isArray(pins) ? pins : [];
  const next = list.filter((p) => !p || p.id !== id);
  return { pins: next, changed: next.length !== list.length };
}

// Reads the current pin list, SORTED by `order` ascending (v1.24.3:
// `ensureYtdlp`'s backfill above guarantees every pin has an integer `order`
// by the time this runs, so the sort key is always present -- this is a
// defensive belt-and-suspenders fallback to `0`, never a crash, for a
// hostile/corrupt record that somehow slips past the backfill). Read-only:
// backfills IN MEMORY (via ensureYtdlp on the freshly-loaded db) so a caller
// always sees a well-formed array, but never writes. Returns a NEW array
// (`slice` before `sort`) -- the underlying `db.ytdlp.pins` array order
// (insertion order) is never mutated by a read. Mirrors `listSubscriptions`
// exactly.
function listPins(deps) {
  const db = deps.loadDatabase();
  const pins = ensureYtdlp(db).pins;
  return pins.slice().sort((a, b) => {
    const orderA = a && typeof a.order === 'number' ? a.order : 0;
    const orderB = b && typeof b.order === 'number' ? b.order : 0;
    return orderA - orderB;
  });
}

/**
 * Add (or idempotently re-affirm) a pin. `{ channelDir, label }` is assumed
 * ALREADY VALIDATED (callers must run `validatePinInput` first, exactly the
 * `validateSubscriptionInput` -> `addSubscription` contract) -- this
 * function does not itself re-check confinement. `id = deps.getMediaId(channelDir)`
 * (the SAME stable md5-of-string hash `addSubscription` uses for
 * `channelUrl`, reused here for `channelDir` -- two independent id spaces,
 * never compared to each other). Writes through the SAME serialized
 * `updateDatabase` every other mutator in this file uses, mutating ONLY
 * `db.ytdlp.pins` -- never `db.folders`/`db.folderSettings` (see the module
 * comment above).
 */
function addPin(deps, { channelDir, label } = {}) {
  const id = deps.getMediaId(channelDir);
  const pinnedAt = new Date().toISOString();
  let record;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const result = reduceAddPin(ns.pins, { id, channelDir, label, pinnedAt });
    record = result.record;
    if (!result.changed) return false; // idempotent no-op re-pin: nothing changed, skip the save
    ns.pins = result.pins;
  }).then(() => record);
}

/**
 * Remove a pin by id. Returns `true` if a pin was removed, `false` if no
 * pin with that id existed (so the route can 404). Mutates ONLY
 * `db.ytdlp.pins` -- never `db.folders`/`db.folderSettings`.
 */
function removePin(deps, id) {
  let removedFlag = false;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const result = reduceRemovePin(ns.pins, id);
    removedFlag = result.changed;
    if (!result.changed) return false; // unknown id: nothing changed, skip the save
    ns.pins = result.pins;
  }).then(() => removedFlag);
}

// ---- v1.24.3: drag-and-drop PINNED-channel reorder --------------------------
//
// Applies to the pinned-channel sections rendered by `public/js/common.js`'s
// `renderPinnedSidebar`/`renderPinnedPlaylists` -- the sidebar/Playlists-sheet
// mirror of the subscriptions-list reorder (`reduceReorder`/
// `reorderSubscriptions` above, v1.24.0 B4). Client-side DnD mechanics
// (`moveArrayItem`/`computeDropIndex`) are reused VERBATIM from
// `public/js/common.js` exactly as B4 already does; this store only needs the
// RESULT of that drag -- the caller's full desired id order -- to persist it.

/**
 * Pure reducer: compute the next `pins` array after a drag-and-drop reorder.
 * Mirrors `reduceReorder` (subscriptions) FIELD-FOR-FIELD, applied to pins
 * instead: an id in `orderedIds` that does not match any pin in `pins` is
 * IGNORED (never creates a phantom entry, never errors); a duplicate id in
 * `orderedIds` is only honored on its FIRST occurrence; a pin whose id is
 * simply ABSENT from `orderedIds` keeps a stable TAIL position, in its own
 * original relative order. Returns a NEW array (never mutates `pins` or any
 * of its elements) with `order` set to each pin's resulting integer
 * position -- every field other than `order` is left byte-identical on each
 * returned record (a shallow copy only where `order` actually changes).
 * @param {Array<object>} pins the current pin list (any order)
 * @param {Array<string>} orderedIds the desired id order (from a client drag)
 * @returns {Array<object>} a new pin array with `order` reassigned
 */
function reducePinReorder(pins, orderedIds) {
  const list = Array.isArray(pins) ? pins : [];
  const knownIds = new Set(list.filter((pin) => pin && pin.id !== undefined).map((pin) => pin.id));
  const candidateIds = Array.isArray(orderedIds) ? orderedIds : [];

  const seen = new Set();
  const leadingIds = [];
  for (const id of candidateIds) {
    if (knownIds.has(id) && !seen.has(id)) {
      leadingIds.push(id);
      seen.add(id);
    }
  }

  const position = new Map();
  leadingIds.forEach((id, index) => position.set(id, index));
  // Tail: every pin NOT placed above, kept in its ORIGINAL relative order (a
  // stable partition, not a re-sort), appended after every leading id.
  let tailIndex = leadingIds.length;
  for (const pin of list) {
    if (pin && pin.id !== undefined && !position.has(pin.id)) {
      position.set(pin.id, tailIndex);
      tailIndex += 1;
    }
  }

  return list.map((pin) => (pin && position.has(pin.id) ? { ...pin, order: position.get(pin.id) } : pin));
}

/**
 * Persist a pinned-channel drag-and-drop reorder. Reads the current pin
 * list, runs it through the pure `reducePinReorder` above, and writes the
 * result back through the SAME serialized `updateDatabase` every other
 * mutator in this file uses -- mutating ONLY `db.ytdlp.pins`, never
 * `db.folders`/`db.folderSettings` (see the module-level HARD INVARIANT
 * comment above `isChannelDirConfined`, which applies to every mutator in
 * this file, not just this one). `orderedIds` is assumed to already be a
 * plain array of strings by the time it reaches here (callers, e.g. the
 * route below, validate the request shape) -- `reducePinReorder` itself
 * still degrades safely (never throws) on a malformed/partial value. Mirrors
 * `reorderSubscriptions` exactly.
 * @param {object} deps `{ updateDatabase, loadDatabase }`
 * @param {Array<string>} orderedIds the desired id order
 * @returns {Promise<Array<object>>} the resulting, re-ordered pin list
 */
function reorderPins(deps, orderedIds) {
  let result;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    ns.pins = reducePinReorder(ns.pins, orderedIds);
    result = ns.pins;
  }).then(() => result);
}

module.exports = {
  ensureYtdlp,
  deriveDisplayName,
  normalizeChannelUrl,
  validateSubscriptionInput,
  validateSubscriptionPatch,
  validateMaxVideos,
  // v1.22.0 FR-6: configurable max-duration download gate.
  validateMaxDurationSeconds,
  MAX_SUB_MAX_DURATION_SECONDS,
  validatePaused,
  validateSkipShorts,
  validateFiletype,
  // v1.25 QoL (T1): per-subscription download `cutoffDate` (schema only --
  // T2 wires this into the yt-dlp arg builder via `--dateafter`).
  validateCutoffDate,
  listSubscriptions,
  addSubscription,
  updateSubscription,
  deleteSubscription,
  setSubscriptionStatus,
  // v1.24.0 B4 (FR-8): DnD subscription reorder -- `reduceReorder` (pure) and
  // `reorderSubscriptions` (mutator) are the FROZEN cross-file contract T8's
  // `POST /api/subscriptions/reorder` route imports.
  reduceReorder,
  reorderSubscriptions,
  getAllowMembersOnly,
  setAllowMembersOnly,
  DEFAULT_YTDLP_NAMESPACE,
  VALID_FORMATS,
  DEFAULT_FORMAT,
  DEFAULT_QUALITY,
  MAX_SUB_MAX_VIDEOS,
  // v1.21.0 FR-5: channel pins (data-safety two-reviewer gate -- see the
  // module comment above `isChannelDirConfined`).
  isChannelDirConfined,
  sanitizePinLabel,
  validatePinInput,
  reduceAddPin,
  reduceRemovePin,
  listPins,
  addPin,
  removePin,
  MAX_PINS,
  MAX_PIN_LABEL_LENGTH,
  // v1.24.3: pinned-channel DnD reorder -- `reducePinReorder` (pure) and
  // `reorderPins` (mutator) are the cross-file contract the new
  // `POST /api/subscriptions/pins/reorder` route (lib/ytdlp/index.js) imports.
  reducePinReorder,
  reorderPins,
  // v1.20.0 FR-2: captured channel-identity bridge (SECURITY-CRITICAL --
  // every captured URL passes through the UNMODIFIED url.validateChannelUrl
  // before persistence/use; see the doc comments above).
  sanitizeCapturedChannelMeta,
  recordDownloadChannelMeta,
  consumeDownloadChannelMeta,
  CHANNEL_ID_PATTERN,
  MAX_CAPTURED_CHANNEL_NAME_LENGTH,
  MAX_DOWNLOAD_META,
  // v1.24.0 C5-ytdlp/C6 (T11): release-date + channel-avatar capture (pure
  // helpers, unit-tested directly) + the subscription-record avatar backfill
  // mutator index.js's persistCapturedChannelMeta calls.
  parseCapturedReleaseDate,
  sanitizeChannelAvatarUrl,
  recordSubscriptionChannelAvatar,
  MAX_CHANNEL_AVATAR_URL_LENGTH,
  // v1.25 QoL (two-reviewer gate FIX 1): re-exported so
  // `lib/ytdlp/index.js`'s `processSubscription` can compute "today, as a
  // YYYYMMDD string" the SAME way `addSubscription`'s own default/
  // `ensureYtdlp`'s migration already do -- single-sourced, never a second,
  // forked copy of this UTC-midnight formatting logic.
  formatYyyymmdd,
};
