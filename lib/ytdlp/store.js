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

const { validateChannelUrl, isSafeVideoId } = require('./url');
// v1.13.0 item 4: the filetype/container allowlist is OWNED by args.js (the
// file that actually turns it into an argv element) -- store.js imports it
// rather than forking a second copy, so there is exactly one source of
// truth for "what filetype values exist per format." No circular require:
// args.js does not import anything from store.js.
const { VALID_FILETYPES } = require('./args');

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

// Defensive backfill, applied MODULE-LOCALLY (inside this file's own
// mutators/readers) rather than in server.js's core `loadDatabase`. Mirrors
// the `folderSettings`/`settings` backfill pattern there (server.js:83-86):
// a missing/partial `db.ytdlp` is completed without ever clobbering fields
// that are already present, and no other top-level key is touched. This is
// what keeps core `loadDatabase`/`DEFAULT_SETTINGS` untouched and the
// disabled path byte-identical -- an old or disabled db.json simply never
// gains a `ytdlp` key because nothing here ever runs against it.
function ensureYtdlp(db) {
  if (!db.ytdlp || typeof db.ytdlp !== 'object') {
    // NOTE: build a fresh object/array here rather than `{ ...DEFAULT_YTDLP_NAMESPACE }`
    // -- a shallow spread of the frozen constant would copy the SAME
    // `subscriptions` array reference into every db that hits this branch
    // (Object.freeze is shallow), silently sharing subscriptions across
    // unrelated db instances. `DEFAULT_YTDLP_NAMESPACE` exists only as a
    // documented/exported shape constant, never as a literal to spread from.
    db.ytdlp = { allowMembersOnly: false, subscriptions: [], downloadMeta: {} };
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
  for (const sub of db.ytdlp.subscriptions) {
    if (sub && typeof sub.paused !== 'boolean') sub.paused = false;
    // v1.15.0 item 4: `skipShorts` backfill mirrors `paused` EXACTLY -- a
    // boolean, default-false toggle, so an existing sub written before this
    // field existed migrates to `skipShorts: false` (download everything,
    // unchanged behavior) IN MEMORY here, persisting on whatever write next
    // touches this db.
    if (sub && typeof sub.skipShorts !== 'boolean') sub.skipShorts = false;
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
  return {
    ok: true,
    value: {
      channelUrl: urlResult.url,
      format,
      quality,
      name: typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : undefined,
      maxVideos: maxVideosResult.value,
      paused: pausedResult.value,
      skipShorts: skipShortsResult.value,
      filetype: filetypeResult.value,
    },
  };
}

/**
 * Validate a `PATCH /api/subscriptions/:id` request body (FR-D): any subset
 * of `{format, quality, maxVideos, paused, skipShorts}`. Unlike `validateSubscriptionInput`
 * (the add path, where `channelUrl` is mandatory), every field here is
 * OPTIONAL -- a field simply absent from `patch` means "leave unchanged" (the
 * returned `value` only contains keys the caller actually supplied, and
 * `updateSubscription` below only mutates fields present in that value).
 * `format`/`maxVideos`/`paused` are hard validation errors when present and
 * invalid (never silently coerced); `quality` only requires a non-empty
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
 * @param {*} raw `{ videoId, channelUrl, channelId, uploaderUrl, channelName }`
 * @returns {{videoId: string, channelUrl: string, channelHandleUrl?: string, channelId?: string, channelName?: string} | null}
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

  return {
    videoId: input.videoId,
    channelUrl,
    ...(channelHandleUrl ? { channelHandleUrl } : {}),
    ...(channelId ? { channelId } : {}),
    ...(channelName ? { channelName } : {}),
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
 * @returns {{channelUrl: string, channelHandleUrl?: string, channelId?: string, channelName?: string} | null}
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
  return result;
}

// Reads the current subscription list. Read-only: backfills IN MEMORY (via
// ensureYtdlp on the freshly-loaded db) so a caller always sees a well-formed
// array, but never writes -- only `addSubscription`/`deleteSubscription`/
// `setSubscriptionStatus`/`setAllowMembersOnly` persist through
// `updateDatabase`.
function listSubscriptions(deps) {
  const db = deps.loadDatabase();
  return ensureYtdlp(db).subscriptions;
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
 */
function addSubscription(deps, { channelUrl, format, quality, name, maxVideos, paused, skipShorts, filetype } = {}) {
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
      paused: resolvedPaused,
      skipShorts: resolvedSkipShorts,
      filetype: resolvedFiletype,
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
 * otherwise. Only `lastCheckedAt`/`lastStatus` are touched.
 */
function setSubscriptionStatus(deps, id, { lastCheckedAt, lastStatus } = {}) {
  let updated = false;
  return deps.updateDatabase((db) => {
    const ns = ensureYtdlp(db);
    const sub = ns.subscriptions.find((s) => s.id === id);
    if (!sub) return false;
    sub.lastCheckedAt = lastCheckedAt !== undefined ? lastCheckedAt : sub.lastCheckedAt;
    sub.lastStatus = lastStatus !== undefined ? lastStatus : sub.lastStatus;
    updated = true;
  }).then(() => updated);
}

/**
 * Update an existing subscription's editable fields (FR-D): any subset of
 * `{format, quality, maxVideos, paused, skipShorts}` present in `patch` is written;
 * fields ABSENT from `patch` are left untouched. `id`/`channelUrl`/`name`/
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
    record = sub;
  }).then(() => record);
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

module.exports = {
  ensureYtdlp,
  deriveDisplayName,
  normalizeChannelUrl,
  validateSubscriptionInput,
  validateSubscriptionPatch,
  validateMaxVideos,
  validatePaused,
  validateSkipShorts,
  validateFiletype,
  listSubscriptions,
  addSubscription,
  updateSubscription,
  deleteSubscription,
  setSubscriptionStatus,
  getAllowMembersOnly,
  setAllowMembersOnly,
  DEFAULT_YTDLP_NAMESPACE,
  VALID_FORMATS,
  DEFAULT_FORMAT,
  DEFAULT_QUALITY,
  MAX_SUB_MAX_VIDEOS,
  // v1.20.0 FR-2: captured channel-identity bridge (SECURITY-CRITICAL --
  // every captured URL passes through the UNMODIFIED url.validateChannelUrl
  // before persistence/use; see the doc comments above).
  sanitizeCapturedChannelMeta,
  recordDownloadChannelMeta,
  consumeDownloadChannelMeta,
  CHANNEL_ID_PATTERN,
  MAX_CAPTURED_CHANNEL_NAME_LENGTH,
  MAX_DOWNLOAD_META,
};
