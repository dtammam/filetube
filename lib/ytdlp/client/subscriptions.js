'use strict';

// Vanilla per-page controller for the optional yt-dlp /subscriptions page
// (D4, T5). Served ONLY via the conditional `GET /js/subscriptions.js` route
// registered inside `registerRoutes`'s `isEnabled` gate (lib/ytdlp/index.js)
// -- this file is kept OUT of public/js/ so `express.static` can never leak
// it when the module is disabled; only the gated route can ever serve it
// (AC3). No framework/bundler, per CONTRIBUTING's vanilla-frontend rule.
//
// SECURITY (non-negotiable -- T5 inbox / T2-QA-folded reminder): every
// server/user-derived string rendered by this file -- a subscription's
// `name` (derived from yt-dlp channel metadata at add-time, so a hostile
// channel can craft it), its `channelUrl`, the composed `lastStatus`/live
// `error` string (which can carry a redacted-but-still-server-composed
// error), and a one-shot job's `label`/`url` -- is assigned via `textContent`
// ONLY. This file never uses `innerHTML` or a template-string interpolation
// for ANY of that data (see `createSubscriptionRow`/`createOneShotRow`/
// `buildSettingsSheet` below, the places all of it is rendered). v1.20.0
// FR-4/v1.21.0 FR-4: the same discipline applies to the per-channel
// Playlist link's `href` (server-derived `channelDir`, always
// `encodeURIComponent`-escaped) and the new channel `<a>` link's `href`
// (`sub.channelUrl`, already `validateChannelUrl`-validated server-side at
// add-time) -- both assigned via the anchor's `.href` property, never a
// template string handed to `innerHTML`.
//
// Mirrors public/js/common.js's Node-testability pattern: pure/DOM-building
// helpers are defined at module scope and exported at the bottom (guarded by
// `typeof module !== 'undefined'`) so node:test can exercise them directly,
// without a real browser, by injecting a minimal fake `document`.

// ---- FR-B: hardcoded dropdown option values (mirror args.js's allowlists) --
//
// These are a deliberate, hardcoded mirror of `lib/ytdlp/args.js`'s
// `VALID_FORMATS`/`QUALITY_ALLOWLIST` -- a client bundle has no access to
// that server-side module, so the exec plan's Design section calls for the
// SDE to hardcode the exact same values here. The server independently
// RE-VALIDATES both (`store.VALID_FORMATS`/`args.normalizeQuality`) on every
// request that carries them, so a value that ever drifted out of sync here
// would only ever be neutralized/rejected server-side, never trusted as-is.
const FORMAT_OPTIONS = [
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio only' },
];
const QUALITY_OPTIONS = ['best', '2160p', '1440p', '1080p', '720p', '480p', '360p'];
const DEFAULT_QUALITY_OPTION = 'best';

// ---- v1.13.0 item 4: filetype/container dropdown (mirrors args.js's -------
// VALID_FILETYPES, the same hardcoded-mirror posture FORMAT_OPTIONS/
// QUALITY_OPTIONS already use above). The server independently re-validates
// (`store.validateFiletype`/`args.normalizeFiletype`) on every request, so
// drift here can only ever be neutralized, never trusted as-is.
const FILETYPE_OPTIONS = {
  video: [
    { value: 'mp4', label: 'MP4 (recommended)' },
    { value: 'mkv', label: 'MKV' },
    { value: 'webm', label: 'WebM' },
    { value: 'default', label: 'Default (yt-dlp)' },
  ],
  audio: [
    { value: 'mp3', label: 'MP3 (recommended)' },
    { value: 'm4a', label: 'M4A' },
    { value: 'opus', label: 'Opus' },
    { value: 'default', label: 'Default (yt-dlp)' },
  ],
};
const DEFAULT_FILETYPE_OPTION = { video: 'mp4', audio: 'mp3' };

// ---- FR-E: poll cadence + backoff (pure, unit-testable) --------------------

const STATUS_POLL_BASE_MS = 2500;
const STATUS_POLL_MAX_MS = 30000;

// v1.26 "real progress": the base ~2.5s cadence under-samples a short
// video's actual byte-transfer window (often well under 2.5s), so the
// percent ramp that genuinely exists server-side is never observed -- real
// motion reads as "frozen" purely because of how infrequently it's polled.
// Only used while `snapshotHasActiveDownload` finds a genuinely
// `'downloading'` entry in the latest snapshot; every other tick (idle,
// queued/listing churn, terminal-only) keeps the base cadence.
const STATUS_POLL_FAST_MS = 700;

// v1.26 code-review fix (F4): a wedged/stuck yt-dlp child can hold an
// activity entry at `state: 'downloading'` for the ENTIRE
// `downloadTimeoutMinutes` window (180 minutes by default) with no further
// progress output at all -- polling every ~700ms for that whole time serves
// no purpose (there is nothing new to show) and needlessly hammers the
// server. An entry only counts as "genuinely active" (worth the fast
// cadence) when it is BOTH `state: 'downloading'` AND its `updatedAt`
// timestamp is recent; a missing/unparseable `updatedAt` is treated as NOT
// fresh (falls back to the base cadence) rather than crashing or defaulting
// to "active." Mirrors `public/js/common.js`'s identical constant/helper
// (duplicated, not shared -- see this file's own module comment for why).
// HOTFIX v1.26.3: named SUBS_-prefixed, NOT `ACTIVE_ENTRY_STALE_MS` -- this
// classic script shares ONE global lexical scope with common.js on the
// /subscriptions page, and a duplicate top-level `const` is a SyntaxError
// that killed this ENTIRE script at instantiation (v1.26.0-v1.26.2: the
// subscriptions list silently never rendered). Duplicate `function`
// declarations (isFreshlyActiveEntry below) are var-like and redeclare
// harmlessly; only lexical (const/let) collisions are fatal. Guarded by
// test/unit/shell-script-global-collisions.test.js.
const SUBS_ACTIVE_ENTRY_STALE_MS = 10000;

/**
 * Pure: is `entry` a genuinely, RECENTLY active `'downloading'` entry --
 * never throws on a malformed/absent entry or `updatedAt`. `nowMs` is
 * injectable (a raw ms number) for deterministic tests; omitted/non-finite
 * falls back to the real clock. See `SUBS_ACTIVE_ENTRY_STALE_MS`'s comment
 * for the full staleness rationale (F4).
 */
function isFreshlyActiveEntry(entry, nowMs) {
  if (!entry || typeof entry !== 'object' || entry.state !== 'downloading') return false;
  if (typeof entry.updatedAt !== 'string') return false;
  const updatedMs = Date.parse(entry.updatedAt);
  if (!Number.isFinite(updatedMs)) return false;
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  return (now - updatedMs) < SUBS_ACTIVE_ENTRY_STALE_MS;
}

/**
 * Pure: does this `{subscriptions, oneShots}` snapshot (the exact shape
 * `GET /api/subscriptions/status` returns) have ANY entry -- subscription or
 * one-shot -- genuinely and RECENTLY in the `'downloading'` state right now?
 * Used to decide this page's adaptive poll cadence (see `nextPollDelay`
 * below) -- never throws on a malformed/absent snapshot.
 *
 * v1.26 code-review fix (F4): "active" now also requires a fresh `updatedAt`
 * (`isFreshlyActiveEntry` above) -- see that function's doc comment.  `nowMs`
 * is optional/injectable, forwarded straight through.
 */
function snapshotHasActiveDownload(snapshot, nowMs) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const subs = snapshot.subscriptions && typeof snapshot.subscriptions === 'object' ? snapshot.subscriptions : {};
  const oneShots = snapshot.oneShots && typeof snapshot.oneShots === 'object' ? snapshot.oneShots : {};
  return Object.values(subs).some((entry) => isFreshlyActiveEntry(entry, nowMs))
    || Object.values(oneShots).some((entry) => isFreshlyActiveEntry(entry, nowMs));
}

/**
 * Pure poll-delay reducer: `success` resets to the base ~2.5s cadence -- or,
 * v1.26, the much faster `STATUS_POLL_FAST_MS` when `isActive` (an
 * actively-downloading entry was present in the snapshot this success came
 * from -- see `snapshotHasActiveDownload`). `isActive` defaults to `false`
 * so every pre-existing caller/test (`nextPollDelay(prev, success)`, two
 * args) keeps its exact old behavior. Takes (and returns) a plain delay
 * number rather than an object -- there is no other poll state worth
 * threading through -- so a test can call this directly with no DOM/fetch
 * involved at all.
 *
 * v1.26 code-review fix (F5): on FAILURE, the doubling is now computed from
 * AT LEAST the base cadence (`Math.max(prevDelayMs, STATUS_POLL_BASE_MS)`),
 * not `prevDelayMs` verbatim -- capped, as before, at `STATUS_POLL_MAX_MS`.
 * Pre-fix, a failure landing right after a fast (~700ms, `STATUS_POLL_FAST_MS`)
 * success tick would back off to only ~1400ms -- FASTER than this backoff's
 * own original first retry ever was (`STATUS_POLL_BASE_MS * 2` = 5s) --
 * effectively defeating the backoff exactly when the server is flakiest
 * (mid-download). The failure delay is still entirely UNCHANGED by
 * `isActive`, so a flaky/offline server never causes a tight error-spamming
 * retry loop regardless of what the last known-good snapshot showed.
 */
function nextPollDelay(prevDelayMs, success, isActive) {
  if (success) return isActive ? STATUS_POLL_FAST_MS : STATUS_POLL_BASE_MS;
  const prev = typeof prevDelayMs === 'number' && prevDelayMs > 0 ? prevDelayMs : STATUS_POLL_BASE_MS;
  const base = Math.max(prev, STATUS_POLL_BASE_MS);
  return Math.min(base * 2, STATUS_POLL_MAX_MS);
}

// ---- Pure formatting helpers (no DOM) --------------------------------------

/**
 * v1.25 QoL (T1 schema, T5 UI; post-gate fix): the row meta line's third
 * segment. Previously rendered the retired per-channel `maxVideos` count
 * cap (`'max videos: ' + formatMaxVideos(sub)`), which became meaningless
 * once v1.25 replaced that field with a per-channel `cutoffDate` -- every
 * row was showing "max videos: default" regardless of the subscription's
 * actual download-cutoff. Now renders the cutoff date the subscription
 * actually uses, via `cutoffDateToInputValue` (the SAME converter the
 * settings sheet's date input already uses, so the two never drift), e.g.
 * "Downloads since 2026-01-02". A missing/blank/malformed `cutoffDate`
 * (`cutoffDateToInputValue` returns `''` for all of those, never throws)
 * omits the segment entirely rather than rendering "undefined"/"NaN".
 */
function formatSubMeta(sub) {
  const format = sub && sub.format === 'audio' ? 'Audio' : 'Video';
  const quality = sub && typeof sub.quality === 'string' && sub.quality.trim() !== ''
    ? sub.quality.trim()
    : 'best';
  const base = format + ' · quality: ' + quality;
  const cutoffInputValue = cutoffDateToInputValue(sub && sub.cutoffDate);
  return cutoffInputValue === '' ? base : base + ' · Downloads since ' + cutoffInputValue;
}

function formatSubStatus(sub) {
  const checked = sub && sub.lastCheckedAt ? new Date(sub.lastCheckedAt).toLocaleString() : 'never checked';
  const status = sub && typeof sub.lastStatus === 'string' && sub.lastStatus.trim() !== ''
    ? sub.lastStatus
    : 'pending';
  return 'Last checked: ' + checked + ' — ' + status;
}

/**
 * A4 (v1.24.0, T6, FR-5): pure "next check ~" formatter for a subscription's
 * live `nextPollDue` field (`GET /api/subscriptions/status`'s per-id shape,
 * additively populated by T8's `computeNextPollDue` -- an epoch ms, or `null`
 * when there is no estimate: manual-only polling, or a never-yet-checked
 * subscription). Returns `null` -- "nothing to show" -- for any non-finite
 * input, so a caller can safely omit the suffix entirely rather than render a
 * broken string. Never throws. Deliberately coarse (rounds to the nearest
 * minute, then hour past 60) -- this is a rough "next check ~" estimate for
 * display, not a precise countdown (the underlying value is itself only an
 * estimate -- see index.js's `computeNextPollDue` doc comment).
 */
function formatNextCheckText(nextPollDue) {
  if (typeof nextPollDue !== 'number' || !Number.isFinite(nextPollDue)) return null;
  const deltaMs = nextPollDue - Date.now();
  const minutes = Math.round(deltaMs / 60000);
  if (minutes <= 0) return 'Next check: due now';
  if (minutes < 60) return 'Next check: in ' + minutes + ' min';
  const hours = Math.round(minutes / 60);
  return 'Next check: in ' + hours + (hours === 1 ? ' hr' : ' hrs');
}

/**
 * A4: the single source of truth for `.sub-row-status`'s rendered text,
 * shared by BOTH `createSubscriptionRow` (initial render) and
 * `applyStatusUpdatesInPlace` (the ~2.5s poll's in-place update) so the two
 * can never drift apart. An ACTIVE live status (`formatLiveStatusText`
 * returning non-null -- queued/listing/downloading/done/error) already reads
 * as "checking now" (or a terminal outcome) on its own and wins outright, with
 * no next-check suffix appended (redundant/confusing alongside an in-flight
 * state). Otherwise renders the persisted `formatSubStatus` line, with a
 * `formatNextCheckText` suffix appended when `liveEntry.nextPollDue` yields
 * one (omitted entirely when there is no estimate, e.g. manual-only polling).
 */
function formatRowStatusLine(sub, liveEntry) {
  const liveText = formatLiveStatusText(liveEntry);
  if (liveText) return liveText;
  const nextCheckText = formatNextCheckText(liveEntry && liveEntry.nextPollDue);
  const persisted = formatSubStatus(sub);
  return nextCheckText ? persisted + ' · ' + nextCheckText : persisted;
}

/**
 * v1.21.0 FR-4 (AC28/AC29): pure "Subscribed on <date>" formatter for the
 * already-persisted `sub.addedAt` (an ISO-8601 string written once at
 * add-time since v1.11.0 -- store.js's `addSubscription`; NO new stored
 * field needed here). Degrades to the literal `'date unknown'` -- never a
 * fabricated date, never a thrown exception -- for every input that is not a
 * genuinely parseable timestamp: missing/`null`/`undefined`, a non-string,
 * an empty/blank string, or a string `Date` cannot parse (e.g. a
 * hand-edited/corrupted `db.json`, which is not expected for any
 * subscription created through the normal add path, but must still never
 * crash rendering). Locale-formatted (`toLocaleDateString`) rather than a
 * fixed format -- callers/tests should assert on the `'Subscribed on '`
 * prefix and the `'date unknown'` fallback, not an exact date string, to
 * stay independent of the runtime's locale/timezone.
 */
function formatSubscribedDate(addedAt) {
  if (typeof addedAt !== 'string' || addedAt.trim() === '') return 'date unknown';
  const parsed = new Date(addedAt);
  if (Number.isNaN(parsed.getTime())) return 'date unknown';
  return 'Subscribed on ' + parsed.toLocaleDateString();
}

/**
 * v1.25 QoL (T1 schema, T5 UI): pure converter from a subscription's
 * `cutoffDate` (the API/yt-dlp `YYYYMMDD` convention, e.g. `store.js`'s
 * `validateCutoffDate`) to the value a native `<input type="date">` expects
 * (`YYYY-MM-DD`). Replaces the retired "download last N videos" `maxVideos`
 * count field everywhere a subscription's download-cutoff is edited (the
 * add form + this file's `buildSettingsSheet`). Never throws: an
 * absent/malformed/implausible value (not exactly 8 digits, or a
 * month/day outside a plausible calendar range -- the full calendar check,
 * e.g. rejecting Feb 30, is the server's `parseCapturedReleaseDate`'s job,
 * this is only a cheap sanity gate so the date input never renders a
 * garbage value) converts to `''`, which a native date input treats as
 * simply empty. Duplicated (not shared) in `public/js/common.js` as
 * `cutoffDateToDateInput` -- this file is only ever served via the
 * enabled-gated route, while common.js loads on every page (same posture as
 * `reduceFiletypeOptions`/`reduceOneOffFiletypeOptions`); giving the two
 * copies distinct names also avoids a global-scope function redeclaration
 * on this very page, which loads both files as plain (non-module) scripts.
 */
function cutoffDateToInputValue(raw) {
  if (typeof raw !== 'string' || !/^\d{8}$/.test(raw)) return '';
  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  if (month < '01' || month > '12' || day < '01' || day > '31') return '';
  return `${year}-${month}-${day}`;
}

/**
 * The inverse of `cutoffDateToInputValue` above: converts a native
 * `<input type="date">`'s value (`YYYY-MM-DD`) back to the API's
 * `cutoffDate` convention (`YYYYMMDD`). Returns `undefined` -- never a
 * malformed string -- for anything that is not a well-formed date string
 * (missing/blank/partial/non-string), so every caller can treat
 * `undefined` as "nothing entered, omit the field" and let the server apply
 * its own default (a brand-new subscription resolves to yesterday;
 * `PATCH`ing an existing one leaves its `cutoffDate` unchanged), exactly
 * mirroring the old `maxVideos` field's blank-means-omit posture. Same
 * cheap month/day sanity gate as `cutoffDateToInputValue` (the server
 * remains the authoritative calendar validator).
 */
function inputValueToCutoffDate(raw) {
  if (typeof raw !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  if (month < '01' || month > '12' || day < '01' || day > '31') return undefined;
  return `${year}${month}${day}`;
}

/**
 * v1.21 FIX 4 (post-gate hardening, adversarial -- FR-5): the final path
 * segment of `channelDir` (its basename), used by `resolvePinLabel` below as
 * a fallback pin label when a subscription has no usable `name`. Pure,
 * never throws -- a non-string/empty input yields `''` (the caller further
 * falls back to a fixed literal). Handles both `/`- and `\`-separated paths
 * (the server resolves `channelDir` via `path.resolve`, so on Windows it
 * could contain backslashes) and strips trailing separators first so a
 * directory path is never mistaken for having an empty basename.
 */
function pinLabelFallback(channelDir) {
  if (typeof channelDir !== 'string') return '';
  const trimmed = channelDir.replace(/[/\\]+$/, ''); // drop trailing slash(es), if any
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return (idx >= 0 ? trimmed.slice(idx + 1) : trimmed).trim();
}

/**
 * v1.21 FIX 4 (post-gate hardening, adversarial -- FR-5): resolves the
 * label `togglePin` sends to `POST /api/subscriptions/pins`. Prefers
 * `sub.name` (trimmed); when that is blank/whitespace-only (or absent),
 * falls back to `channelDir`'s basename (`pinLabelFallback` above), and
 * finally to a fixed literal if even that is empty -- so this NEVER returns
 * `''`. Server-side, `validatePinInput` (lib/ytdlp/store.js)
 * `sanitizePinLabel`s the label and 400s on an empty result; before this
 * fix, an unnamed subscription's `label: sub.name || ''` always hit that
 * 400 -- and since `fetch(...).then()` resolves (not rejects) on a 4xx, the
 * failure was swallowed client-side and the star silently reverted with no
 * error shown. Pure, never throws.
 */
function resolvePinLabel(sub) {
  const name = sub && typeof sub.name === 'string' ? sub.name.trim() : '';
  if (name !== '') return name;
  const fallback = pinLabelFallback(sub && sub.channelDir);
  return fallback !== '' ? fallback : 'Untitled channel';
}

/**
 * FR-E: formats a `LiveEntry` (GET /api/subscriptions/status's per-id shape --
 * `{state, title, index, total, percent, phase, label, url, error,
 * updatedAt}` -- `phase` is v1.26's addition, see lib/ytdlp/progress.js's
 * MERGER_RE/EXTRACT_AUDIO_RE/VIDEO_CONVERT_RE/FIXUP_RE) into a short, human
 * status line, or `null` when there is nothing live worth
 * overriding the persisted `lastStatus` text with (no entry at all, or an
 * `idle`/unrecognized state). Pure string formatting -- no DOM, no fetch --
 * so it is directly unit-testable against representative fixtures without a
 * real yt-dlp process or a fake document.
 *
 * SECURITY: the only free-form string this ever surfaces is `entry.error` /
 * `entry.title`, both of which are ALREADY redacted/confined server-side
 * (activity.js never stores a raw error/stderr -- NFR3; titles come from the
 * confined download path). Callers still render the RETURNED string via
 * `textContent`, never `innerHTML` -- this function itself does no DOM work
 * at all, so it cannot introduce an XSS path either way.
 */
/**
 * v1.31 P2/P5 (pure): the circuit-breaker banner line. `breaker` is the
 * status snapshot's additive `breaker` field (`null` when not tripped;
 * `{trippedAt, consecutiveFailures, skipped, resumeAt}` after a trip).
 * Returns '' when there is nothing to show. `resumeAt` is rendered as a
 * local time when parseable, verbatim otherwise -- server-composed either
 * way, and rendered by the caller via `textContent` only.
 */
function formatBreakerBannerText(breaker) {
  if (!breaker || typeof breaker !== 'object') return '';
  const failures = typeof breaker.consecutiveFailures === 'number' && breaker.consecutiveFailures > 0
    ? breaker.consecutiveFailures : null;
  const skipped = typeof breaker.skipped === 'number' && breaker.skipped > 0 ? breaker.skipped : null;
  const resumeMs = typeof breaker.resumeAt === 'string' ? Date.parse(breaker.resumeAt) : NaN;
  const resumeText = Number.isNaN(resumeMs)
    ? (typeof breaker.resumeAt === 'string' ? breaker.resumeAt : '')
    : new Date(resumeMs).toLocaleTimeString();
  if (!failures) return '';
  let text = `Downloads paused after ${failures} consecutive failure${failures === 1 ? '' : 's'}`;
  if (skipped) text += ` — ${skipped} channel${skipped === 1 ? '' : 's'} deferred`;
  if (resumeText) text += `; retrying at ${resumeText}`;
  return text;
}

/**
 * v1.31 P6 (pure): the binary-version footer line ('' when unknown). The
 * version string is charset-checked server-side (run.js's
 * YTDLP_VERSION_PATTERN, digits/dots only) and rendered via `textContent`.
 *
 * FR6.2 staleness note: yt-dlp versions are CalVer (YYYY.MM.DD), so the
 * release date is derivable from the string itself -- when it is more than
 * STALE_YTDLP_DAYS old, the footer appends an explicit warning (YouTube
 * changes constantly; a months-old extractor is the classic silent-breakage
 * cause) plus the sanctioned update path (bump the Dockerfile pin and
 * rebuild -- locked decision D5: no runtime auto-update). `nowMs` is
 * injectable for deterministic tests; production callers omit it.
 */
const STALE_YTDLP_DAYS = 90;
function formatYtdlpVersionText(version, nowMs) {
  if (typeof version !== 'string' || version === '') return '';
  let text = `yt-dlp ${version}`;
  const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version);
  if (m) {
    const releasedMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
    const ageDays = Math.floor((now - releasedMs) / 86400000);
    if (Number.isFinite(ageDays) && ageDays > STALE_YTDLP_DAYS) {
      text += ` — over ${STALE_YTDLP_DAYS} days old; YouTube changes frequently, so downloads may break until the image's pinned yt-dlp is updated (bump the Dockerfile ARG and rebuild)`;
    }
  }
  return text;
}

function formatLiveStatusText(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const state = entry.state;
  // v1.31 P5 (+FR3.9 gate fix): one-shot entries carry `queuedAhead` (gate
  // jobs ahead on the serial queue) and queued SUBSCRIPTION entries carry it
  // too (channels ahead in the current poll's plan + one-shots on the gate,
  // refreshed as each channel completes). Additive: an older/absent field
  // falls back to the plain literal unchanged.
  if (state === 'queued') {
    const ahead = typeof entry.queuedAhead === 'number' && entry.queuedAhead > 0 ? entry.queuedAhead : null;
    return ahead ? `Queued — ${ahead} ahead` : 'Queued…';
  }
  if (state === 'listing') return 'Checking for new videos…';
  if (state === 'downloading') {
    const index = typeof entry.index === 'number' && entry.index > 0 ? entry.index : null;
    const total = typeof entry.total === 'number' && entry.total > 0 ? entry.total : null;
    const position = index !== null && total !== null ? (index + ' of ' + total) : '';

    // v1.26 "real progress": once yt-dlp's ffmpeg-backed postprocessors take
    // over (muxing/extracting/converting -- see lib/ytdlp/progress.js's
    // MERGER_RE/EXTRACT_AUDIO_RE/VIDEO_CONVERT_RE/FIXUP_RE), `entry.phase`
    // is set and is AUTHORITATIVE over `percent` -- percent is necessarily
    // stale/sticky during this window (there is no percent to report while
    // ffmpeg runs), so rendering it here ("— 100%") would read as "done"
    // when real work is still happening.
    if (entry.phase === 'merging' || entry.phase === 'converting') {
      const label = entry.phase === 'merging' ? 'Merging…' : 'Converting…';
      return [label, position].filter((part) => part !== '').join(' — ');
    }

    const title = typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title.trim() : 'Downloading';
    const percent = typeof entry.percent === 'number' && Number.isFinite(entry.percent)
      ? Math.max(0, Math.min(100, Math.round(entry.percent)))
      : 0;
    return [title, position, percent + '%'].filter((part) => part !== '').join(' — ');
  }
  if (state === 'done') {
    // v1.29.0 T4 (R3a.6): a channel where SOME videos downloaded and SOME
    // failed still lands with `state: 'done'` (index.js's `partial` arm --
    // see lib/ytdlp/index.js's outcome-threading doc comment) -- rendering
    // the bare 'Done' string here would UI-mask that outcome as an
    // unqualified success. `entry.outcome` is ONLY ever set to `'partial'` by
    // that arm (the plain success arm never writes an `outcome` field at
    // all), and this branch only runs while `state === 'done'`, so a stale
    // `outcome: 'partial'` left over by `activity.js`'s shallow `mergeEntry`
    // can never leak into a later `queued`/`listing`/`downloading` cycle --
    // the SAME state-gated staleness discipline `buildFailureLines` below
    // already documents.
    return entry.outcome === 'partial' ? 'Completed with some failures' : 'Done';
  }
  if (state === 'error') return typeof entry.error === 'string' && entry.error.trim() !== '' ? entry.error : 'error';
  return null; // 'idle' (or an unrecognized future state) -- no live override
}

/**
 * v1.29.0 T4 (R3a.6): the SAME `sub-row-status-partial` -- so a partial run
 * reads as visually distinct from both a plain success and an error, using
 * the existing status-class mechanism (no new CSS/tokens -- off-limits guard
 * honored; this is a JS `classList` hook only). Mirrors `formatRowStatusLine`'s
 * OWN precedence exactly (a live override, when present, wins outright; only
 * falls back to the persisted `lastStatus` string when there is none) so the
 * two functions can never disagree about which source is authoritative:
 * - A live override is in effect (`formatLiveStatusText` returns non-null):
 *   partial iff `liveEntry.state === 'done' && liveEntry.outcome === 'partial'`
 *   -- an active `queued`/`listing`/`downloading`/`error` cycle is NEVER
 *   reported as partial here even if a PRIOR cycle's now-stale
 *   `outcome: 'partial'` still lingers on the shallow-merged entry (the same
 *   state-gated staleness discipline as `formatLiveStatusText`/
 *   `buildFailureLines`).
 * - No live override: falls back to the persisted `sub.lastStatus` string,
 *   which index.js's `partial` arm composes with a leading `'partial: '`
 *   (see `safePartialStatus`) -- so the class still applies once the live
 *   entry has expired/been superseded, matching `formatRowStatusLine`'s own
 *   fallback.
 */
function isPartialRowStatus(sub, liveEntry) {
  const liveText = formatLiveStatusText(liveEntry);
  if (liveText) return !!(liveEntry && liveEntry.state === 'done' && liveEntry.outcome === 'partial');
  const status = sub && typeof sub.lastStatus === 'string' ? sub.lastStatus : '';
  return status.indexOf('partial:') === 0;
}

/**
 * v1.24.0 A2 (T14): pure builder for the per-item failure line list under a
 * subscription row's status line -- `entry.failures` (an array of
 * `{videoId, title?, reason}`, additively set by
 * `lib/ytdlp/index.js`'s `mapItemFailuresForActivity`) is additive and
 * stale-tolerant: this only ever reads it while `entry.state === 'error'`
 * (the SAME lifecycle gate `formatLiveStatusText` above already uses for
 * `entry.error`), so an array left over from a PRIOR failed cycle can never
 * render once the subscription's live state has moved past `'error'` --
 * `lib/ytdlp/activity.js`'s `mergeEntry` is a shallow merge that never
 * clears an old field on its own, so this state-gate is the mechanism that
 * keeps stale per-item failure data from ever being shown. Each line
 * prefers `title` (already control-char-stripped/length-capped
 * server-side), falls back to `videoId`, and finally a fixed "Unknown
 * video" literal for the never-misattributed case (`videoId: null` -- see
 * lib/ytdlp/failures.js's "never misattribute" doc comment: an id the
 * server-side parser couldn't confidently attribute is still surfaced here,
 * never silently dropped). `reason` is already redacted (SF1)/sanitized
 * server-side; this function does no further escaping of its own -- callers
 * render every returned string via `textContent`, never `innerHTML`,
 * treating it as untrusted regardless.
 *
 * v1.29.0 T4 (R3a.6): ALSO renders for a `partial` run -- `state === 'done'
 * && entry.outcome === 'partial'` -- so the videos that DID fail in an
 * otherwise-successful channel run are still visibly attributed, not just an
 * `error` run's. Deliberately does NOT broaden to "any entry with
 * `outcome === 'partial'`" regardless of state: `outcome` is a shallow-merged
 * field that can linger stale on the entry after the cycle moves on (the SAME
 * hazard this comment already documents for `entry.state === 'error'`) --
 * gating on `state === 'done'` too keeps this state-gated/stale-tolerant,
 * exactly like the pre-existing `'error'` case, so a NEW `queued`/`listing`/
 * `downloading` cycle after a PRIOR partial run never shows that prior run's
 * failures.
 */
function buildFailureLines(entry) {
  if (!entry || !Array.isArray(entry.failures)) return [];
  const isPartial = entry.state === 'done' && entry.outcome === 'partial';
  if (entry.state !== 'error' && !isPartial) return [];
  return mapFailureItemsToLines(entry.failures);
}

/**
 * v1.29.0 T9 (R4.1): the per-item `label: reason` mapping `buildFailureLines`
 * above already used inline -- factored out (behavior-preserving; the return
 * value for any given `failures` array is byte-identical to before this
 * extraction) so the NEW history section (`formatHistoryFailuresLine` below)
 * can render the exact same "reuse the existing formatFailuresLine-style
 * rendering" text without duplicating the label/reason precedence. Takes the
 * raw `failures` array directly (no `state`/`outcome` gate of its own -- each
 * caller applies its OWN staleness/lifecycle gate first, exactly like
 * `buildFailureLines` still does for the live-activity case).
 */
function mapFailureItemsToLines(failures) {
  if (!Array.isArray(failures)) return [];
  return failures
    .filter((f) => f && typeof f === 'object')
    .map((f) => {
      const title = typeof f.title === 'string' && f.title.trim() !== '' ? f.title.trim() : '';
      const videoId = typeof f.videoId === 'string' && f.videoId !== '' ? f.videoId : '';
      const label = title || videoId || 'Unknown video';
      const reason = typeof f.reason === 'string' && f.reason.trim() !== '' ? f.reason.trim() : 'Unknown reason';
      return label + ': ' + reason;
    });
}

/**
 * v1.24.0 A2 (T14): joins `buildFailureLines`'s per-item lines into ONE
 * string (`' | '`-separated) for `.sub-row-failures`' `textContent` -- kept
 * as a single text node (never one child element per failure) so
 * `applyStatusUpdatesInPlace`'s targeted, poll-time update can refresh it
 * with a plain `textContent` assignment, exactly like `.sub-row-status`
 * already does, without ever calling `createElement` on a poll tick (the
 * whole point of the v1.21.0 FR-1 fix this function's caller preserves --
 * see `applyStatusUpdatesInPlace`'s own doc comment). Returns `''` when
 * there is nothing to show, so callers can hide the element entirely.
 */
function formatFailuresLine(entry) {
  return buildFailureLines(entry).join(' | ');
}

// v1.29.0 T4 (R3c.1 client): the FIXED cookie-warning literal rendered into
// `.sub-row-warning`. A fixed client-owned string, NOT server free-form text,
// so (unlike `entry.error`/`entry.failures[].reason`) there is no new trust
// boundary here -- textContent is still used to render it, matching this
// file's blanket textContent-only discipline regardless.
const COOKIE_WARNING_TEXT = 'Cookies file is configured but missing — some videos may be skipped';

/**
 * v1.29.0 T4 (R3c.1 client): pure builder for `.sub-row-warning`'s text --
 * mirrors `formatFailuresLine`'s "return '' when there is nothing to show"
 * contract so its caller can `hidden`-toggle the element the same way.
 * `entry.warning` is a plain boolean threaded onto EVERY activity write for a
 * cycle (index.js's `cookieWarning`, computed once per cycle and re-sent on
 * every `listing`/`downloading`/`done`/`error` patch for that SAME cycle --
 * see lib/ytdlp/index.js's outcome-threading doc comment), so unlike
 * `entry.outcome`/`entry.failures` this field is never stale across a state
 * transition within one cycle and needs no extra state-gate here.
 */
function formatWarningLine(entry) {
  return entry && entry.warning === true ? COOKIE_WARNING_TEXT : '';
}

/**
 * v1.29.0 T6 (R1.1/R1.2, AC3.1): the ERROR-side twin of `isPartialRowStatus`
 * -- SAME live-vs-persisted precedence, but decides whether this row is
 * currently in an error state (the OTHER condition, besides partial, that
 * warrants a Retry affordance -- see `shouldShowRetryButton` below):
 * - A live override is in effect (`formatLiveStatusText` returns non-null):
 *   error iff `liveEntry.state === 'error'` -- an active `queued`/`listing`/
 *   `downloading`/`done` cycle is never reported as error here even if a
 *   PRIOR cycle's now-stale `state` lingers on a shallow-merged entry (this
 *   function only ever reads the CURRENT `liveEntry.state`, so there is no
 *   staleness hazard to begin with -- unlike `outcome`/`failures`, `state`
 *   itself is never left over from a prior cycle).
 * - No live override: falls back to the persisted `sub.lastStatus` string,
 *   which index.js's error arm composes with a leading `'error: '` (see
 *   `safeErrorStatus`) -- so the affordance still applies once the live
 *   entry has expired/been superseded, matching `isPartialRowStatus`'s own
 *   fallback.
 */
function isErrorRowStatus(sub, liveEntry) {
  const liveText = formatLiveStatusText(liveEntry);
  if (liveText) return !!(liveEntry && liveEntry.state === 'error');
  const status = sub && typeof sub.lastStatus === 'string' ? sub.lastStatus : '';
  return status.indexOf('error:') === 0;
}

/**
 * v1.29.0 T6 (R1.1/R1.2, AC3.1): the row-level Retry-button gate --
 * `createSubscriptionRow` shows a Retry affordance when the row is either in
 * an error state (`isErrorRowStatus`) OR a partial-with-failures state
 * (`isPartialRowStatus`, "some videos downloaded, some failed" -- there is
 * still something worth retrying). A plain success/idle row never gets one.
 */
function shouldShowRetryButton(sub, liveEntry) {
  return isErrorRowStatus(sub, liveEntry) || isPartialRowStatus(sub, liveEntry);
}

// v1.29.0 T6 (R1.5/AC3.5): the fixed literal rendered on `.sub-row-status`
// (alongside its `sub-row-status-queued` marker class, a JS hook only -- no
// CSS/token added, off-limits guard honored) the moment a row's Retry click
// resolves to T5's busy-coalescing discriminator (see
// `isQueuedRepullResponse` below). Distinct from `formatLiveStatusText`'s
// "Queued…" (a channel actually about to be checked) -- this specifically
// means "the single-flight poll was already busy with another channel when
// you clicked Retry", the AC3.5 "not a silent no-op" signal.
const QUEUED_STATUS_TEXT = 'Queued behind current run';

/**
 * v1.29.0 T6 (R1.5/AC3.5): pure discriminator for T5's repull-route response
 * body -- `{accepted:true, started:false, reason:'busy'}` when the
 * single-flight poll guard was already in flight for another target,
 * `{accepted:true, started:true}` once a poll actually started for THIS
 * target. Keys OFF `reason === 'busy'` per the T5 downstream_note contract
 * (index.js's `onDecision` callback -- see T5's `sde_report`), tolerating any
 * other/missing shape (a failed fetch, a non-2xx response, `null`, or an
 * older server that never sent `reason` at all) as "not queued" -- never
 * throws.
 */
function isQueuedRepullResponse(body) {
  return !!(body && typeof body === 'object' && body.started === false && body.reason === 'busy');
}

// ---- v1.29.0 T9 (R4.1-R4.4): durable download-history section --------------
//
// Renders the T0/T1 capped JSONL run log (`GET /api/subscriptions/history`,
// registered inside lib/ytdlp/index.js's SAME `isEnabled` gate as every other
// route -- disabled means this endpoint 404s and the section below never
// mounts, R4.4/AC2.4) below the live subscriptions list. Every builder here
// follows this file's blanket `createElement`/`textContent`-only discipline
// (no `innerHTML`) and reuses the EXISTING `.sub-row`/`.sub-row-status`/
// `.sub-row-status-partial`/`.sub-row-failures`/`.sub-list`/`.sub-list-header`/
// `.setup-box` class families -- no new CSS/tokens/typography (off-limits
// guard honored).

// The four outcomes `lib/ytdlp/failures.js`'s `computeDownloadOutcome` (and
// the `'cancelled'` latch in `lib/ytdlp/index.js`) can ever record onto a
// run-log line -- see `runlog.js`'s module comment for the entry shape. An
// unrecognized/missing outcome (a hand-edited or future-format line) falls
// back to `'Unknown'` in `formatHistoryOutcomeLine` below rather than
// throwing or rendering `undefined`.
const HISTORY_OUTCOME_LABELS = {
  success: 'Success',
  partial: 'Completed with some failures',
  error: 'Failed',
  cancelled: 'Cancelled',
  // v1.31 (gate fix): the wave's three new runlog kinds -- without these,
  // a breaker trip / restart requeue / restart drop rendered as an
  // undiagnosable 'Unknown' and its carefully-composed reason string never
  // reached the history UI at all.
  tripped: 'Run paused (circuit breaker)',
  requeued: 'Requeued after restart',
  dropped: 'Dropped',
};

/**
 * Pure formatter for a history row's outcome text -- the SAME "Completed
 * with some failures" partial copy `formatLiveStatusText` already uses for a
 * live entry, kept as a single shared literal via `HISTORY_OUTCOME_LABELS`
 * above (not re-typed here) so the live and historical renderings of a
 * partial run can never drift apart.
 */
function formatHistoryOutcomeLine(entry) {
  const outcome = entry && typeof entry.outcome === 'string' ? entry.outcome : '';
  return HISTORY_OUTCOME_LABELS[outcome] || 'Unknown';
}

/**
 * Pure formatter for a history row's failure-reasons line -- the run-log
 * twin of `formatFailuresLine`. A run-log entry has no `state` field to gate
 * on (unlike a live activity entry, which can be mid-cycle) -- every entry
 * in the log is, by construction, already a COMPLETED run (T3's single-
 * terminal-line-per-run write) -- so this gates on `outcome` alone: only
 * `'partial'`/`'error'` runs ever carry attributable per-item failures
 * (`'success'`/`'cancelled'` never do, per `computeDownloadOutcome`'s
 * three-arm contract). Reuses `mapFailureItemsToLines` -- the SAME label/
 * reason precedence `buildFailureLines` uses for the live case -- so the two
 * surfaces can never disagree on how a given `{videoId, title?, reason}`
 * renders.
 */
function formatHistoryFailuresLine(entry) {
  if (!entry || typeof entry !== 'object') return '';
  // v1.31 (gate fix): the new kinds carry their whole story in `reason`
  // (there are no per-item failures for a breaker trip or a restart
  // requeue/drop) -- surface it verbatim so the history row explains itself.
  if (entry.outcome === 'tripped' || entry.outcome === 'requeued' || entry.outcome === 'dropped') {
    return typeof entry.reason === 'string' ? entry.reason : '';
  }
  if (entry.outcome !== 'partial' && entry.outcome !== 'error') return '';
  return mapFailureItemsToLines(entry.failures).join(' | ');
}

/**
 * Pure formatter for a history row's timestamp -- `entry.ts` is an ISO string
 * written by `new Date().toISOString()` at the run-log call sites
 * (lib/ytdlp/index.js); an absent/malformed value (a hand-edited or corrupt
 * line that still parsed as JSON) renders as a fixed 'unknown time' literal
 * rather than `'Invalid Date'`/`NaN`/throwing.
 */
function formatHistoryTimestamp(ts) {
  if (typeof ts !== 'string' || ts.trim() === '') return 'unknown time';
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? 'unknown time' : parsed.toLocaleString();
}

/**
 * Builds ONE history row -- `createElement`/`textContent` only, reusing the
 * existing `.sub-row`/`.sub-row-info`/`.sub-row-name`/`.sub-row-meta`/
 * `.sub-row-status`/`.sub-row-failures` class families verbatim (the SAME
 * classes `createSubscriptionRow` already builds a live row out of) so the
 * history section visually matches the subscriptions list above it with zero
 * new CSS. `.sub-row-status-partial` -- the SAME marker class
 * `isPartialRowStatus`'s live-row caller adds -- is the only conditional
 * class hook here (JS `classList` only, no CSS/token added); there is no
 * existing `.sub-row-status-error`/`-cancelled` class family in this
 * codebase to reuse, so an error/cancelled row is distinguished by its
 * TEXT alone (`formatHistoryOutcomeLine`), matching how a live error row is
 * ALSO only ever distinguished by its status text, never a dedicated class.
 * The failures line is appended only when non-empty (mirrors
 * `applyStatusUpdatesInPlace`'s own hide-when-empty treatment of
 * `.sub-row-failures`).
 */
function createHistoryRow(entry, doc) {
  const d = doc || document;
  const row = d.createElement('div');
  row.className = 'sub-row';

  const info = d.createElement('div');
  info.className = 'sub-row-info';

  const nameEl = d.createElement('div');
  nameEl.className = 'sub-row-name';
  nameEl.textContent = (entry && typeof entry.name === 'string' && entry.name.trim() !== '')
    ? entry.name.trim()
    : 'Unknown';
  info.appendChild(nameEl);

  const metaEl = d.createElement('div');
  metaEl.className = 'sub-row-meta';
  metaEl.textContent = formatHistoryTimestamp(entry && entry.ts);
  info.appendChild(metaEl);

  const statusEl = d.createElement('div');
  statusEl.className = 'sub-row-status';
  statusEl.textContent = formatHistoryOutcomeLine(entry);
  if (entry && entry.outcome === 'partial') statusEl.classList.add('sub-row-status-partial');
  info.appendChild(statusEl);

  const failuresLine = formatHistoryFailuresLine(entry);
  if (failuresLine !== '') {
    const failuresEl = d.createElement('div');
    failuresEl.className = 'sub-row-failures';
    failuresEl.textContent = failuresLine;
    info.appendChild(failuresEl);
  }

  row.appendChild(info);
  return row;
}

/**
 * Builds the full history LIST container -- the run-log twin of
 * `createSubscriptionsListElement`/`createOneShotsListElement` above,
 * including their SAME "empty state" treatment (an inline-styled italic
 * message; not a new CSS rule, copied verbatim from those two existing
 * functions). `entries` is rendered in the EXACT order given -- the backing
 * `GET /api/subscriptions/history` route already reverses `runlog.readRuns`'s
 * oldest-first on-disk order to newest-first (R4.1), so this function does
 * no re-ordering of its own (mirrors how `createSubscriptionsListElement`
 * trusts its caller's `subs` ordering too).
 */
function createHistoryListElement(entries, doc) {
  const d = doc || document;
  const container = d.createElement('div');
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) {
    const empty = d.createElement('div');
    empty.setAttribute('style', 'color:var(--text-secondary); font-style:italic; padding:8px 4px;');
    empty.textContent = 'No download history yet.';
    container.appendChild(empty);
    return container;
  }
  list.forEach((entry) => container.appendChild(createHistoryRow(entry, d)));
  return container;
}

/**
 * Builds the history section's own wrapper -- reuses the EXACT
 * `.setup-box` (page-section card) / `.sub-list-header` (heading row) /
 * `.sub-list` (row-list container) classes the "Your subscriptions" section
 * above it already uses (subscriptions.html's own markup), so this
 * dynamically-created section is visually indistinguishable from a
 * server-rendered one -- zero new CSS/tokens. Returns `{ section, list }`:
 * `section` is the top-level node to mount into the page, `list` is the
 * empty `.sub-list` node `renderHistorySection` (the live-wiring caller,
 * below) repopulates on every (re-)fetch.
 */
function createHistorySectionElement(doc) {
  const d = doc || document;
  const section = d.createElement('div');
  section.className = 'setup-box';

  const header = d.createElement('div');
  header.className = 'sub-list-header';
  const heading = d.createElement('h2');
  heading.textContent = 'Download history';
  header.appendChild(heading);
  section.appendChild(header);

  const list = d.createElement('div');
  list.className = 'sub-list';
  section.appendChild(list);

  return { section, list };
}

// The exact set of `LiveEntry.state` values `lib/ytdlp/activity.js` (server
// side) considers terminal -- mirrored here (rather than imported; this file
// is a standalone browser script, see the avatar-precedence comment below
// for why cross-file imports aren't used) so `detectNewlyTerminalRuns` below
// can recognize the SAME three states the run-log's `recordRun` call sites
// fire a terminal JSONL line for: a subscription settles as `'done'`/
// `'error'` (a cancelled SUBSCRIPTION's live entry is written as
// `state: 'error', error: 'cancelled'` -- see lib/ytdlp/index.js's
// outcome-threading doc comment -- so `'error'` alone already covers it),
// while a one-shot job can ALSO settle directly as `'cancelled'`.
const HISTORY_TERMINAL_STATES = new Set(['done', 'error', 'cancelled']);

/**
 * v1.29.0 T9 (R4.1, em_ratifications.history_refresh) -- PURE terminal-
 * transition detector, no DOM/timers/fetch, mirroring
 * public/js/common.js's `detectNewlyDoneOneShots` edge-detector STYLE but
 * generalized two ways: (1) across BOTH `subscriptions` and `oneShots`
 * (a completed run of either kind gets its own run-log line), and (2) across
 * every terminal state the run log can record, not just `'done'`.
 *
 * Deliberately compares the PREVIOUS poll tick's snapshot to the CURRENT one
 * (state-vs-state), rather than an id-based "seen" `Set` like
 * `detectNewlyDoneOneShots` uses -- a one-shot's `jobId` is always fresh per
 * job, so a "seen" set never under-fires there, but a SUBSCRIPTION keeps the
 * SAME `id` across every re-pull; a "seen" set would only ever fire once per
 * subscription id, ever, silently missing every later completed run for that
 * same subscription. Comparing `state` instead correctly fires again each
 * time a subscription cycles OUT of a terminal state (retried -> `'queued'`/
 * `'listing'`/`'downloading'`) and back INTO one.
 *
 * Returns `true` iff at least one subscription or one-shot either (a) had a
 * `state` that was NOT terminal on `prevSnapshot` and IS terminal on
 * `nextSnapshot`, OR (b) GF1 F3 (post-gate fix): was ALREADY terminal on both
 * snapshots but its `updatedAt` marker advanced -- a run that starts AND
 * completes entirely between two ~2.5s poll ticks (prev snapshot still
 * terminal from a PRIOR run, next snapshot terminal from a NEW run, with no
 * observed intermediate `queued`/`listing`/`downloading` snapshot in
 * between). Without (b), that within-one-tick cycle was silently missed --
 * the history list went stale until some UNRELATED entry's transition
 * happened to trigger a re-fetch.
 *
 * `updatedAt` (an ISO string) is the correct marker for this: `activity.js`'s
 * `mergeEntry` -- the SOLE place either namespace's LiveEntry is ever written
 * -- stamps a fresh `updatedAt` on every write, including a terminal write.
 * Critically, `GET /api/subscriptions/status` (the poll endpoint this
 * snapshot comes from) only ever READS `activity.getSnapshot()`, so an
 * already-settled, steady-state terminal entry's `updatedAt` never changes
 * between polls with no new activity -- comparing it cannot cause a refresh
 * storm. It only advances when a genuine new write lands, which for an
 * already-terminal entry means exactly one thing: the run cycled back out to
 * a non-terminal state and settled terminal again (the same real-world event
 * this detector exists to catch, just observed one tick later than usual). A
 * single boolean (not a list of ids) is all `createHistoryRefreshController`
 * below needs to decide whether to re-fetch. Never mutates either snapshot
 * (pure read); never throws on a missing/malformed snapshot (defensive
 * `|| {}` throughout, same posture as `detectNewlyDoneOneShots`); missing/
 * non-string `updatedAt` on either side is treated as "no marker to compare"
 * (never fires (b) on its own -- no false positives from a malformed entry).
 */
function detectNewlyTerminalRuns(prevSnapshot, nextSnapshot) {
  const prevSubs = (prevSnapshot && prevSnapshot.subscriptions && typeof prevSnapshot.subscriptions === 'object')
    ? prevSnapshot.subscriptions : {};
  const nextSubs = (nextSnapshot && nextSnapshot.subscriptions && typeof nextSnapshot.subscriptions === 'object')
    ? nextSnapshot.subscriptions : {};
  const prevOneShots = (prevSnapshot && prevSnapshot.oneShots && typeof prevSnapshot.oneShots === 'object')
    ? prevSnapshot.oneShots : {};
  const nextOneShots = (nextSnapshot && nextSnapshot.oneShots && typeof nextSnapshot.oneShots === 'object')
    ? nextSnapshot.oneShots : {};

  function enteredTerminal(prevMap, nextMap, key) {
    const prevEntry = prevMap[key];
    const nextEntry = nextMap[key];
    const prevState = prevEntry && typeof prevEntry === 'object' ? prevEntry.state : undefined;
    const nextState = nextEntry && typeof nextEntry === 'object' ? nextEntry.state : undefined;
    const prevTerminal = HISTORY_TERMINAL_STATES.has(prevState);
    const nextTerminal = HISTORY_TERMINAL_STATES.has(nextState);
    if (!prevTerminal && nextTerminal) return true; // the original, still-primary case
    if (prevTerminal && nextTerminal) {
      // GF1 F3: both terminal -- only a genuine new terminal WRITE (an
      // advanced `updatedAt`) counts as a transition; an unchanged marker is
      // steady-state (must NOT re-fire, no refresh storm).
      const prevUpdatedAt = prevEntry && typeof prevEntry === 'object' ? prevEntry.updatedAt : undefined;
      const nextUpdatedAt = nextEntry && typeof nextEntry === 'object' ? nextEntry.updatedAt : undefined;
      if (typeof prevUpdatedAt !== 'string' || typeof nextUpdatedAt !== 'string') return false;
      return prevUpdatedAt !== nextUpdatedAt;
    }
    return false;
  }

  return Object.keys(nextSubs).some((id) => enteredTerminal(prevSubs, nextSubs, id))
    || Object.keys(nextOneShots).some((jobId) => enteredTerminal(prevOneShots, nextOneShots, jobId));
}

/**
 * v1.29.0 T9 (R4.1) -- fetches `GET /api/subscriptions/history` and resolves
 * to its `entries` array (newest-first, per the route's own contract),
 * degrading to `[]` on ANY failure (non-OK response, network error, a
 * disabled module's native 404, an unparseable body) -- NEVER rejects, so
 * every caller can `.then()` this directly with no `.catch()` of its own.
 * `fetchImpl` is an injectable `fetch`-shaped function (defaults to the
 * global `fetch` when available) purely so this -- and
 * `createHistoryRefreshController` below -- can be exercised in `node:test`
 * with a fake implementation, mirroring this file's `repullOne`-style
 * fetch-injection posture; the live wiring below always passes the real
 * `window.fetch`.
 */
function fetchHistoryEntries(fetchImpl) {
  const doFetch = typeof fetchImpl === 'function'
    ? fetchImpl
    : (typeof fetch === 'function' ? fetch : undefined);
  if (typeof doFetch !== 'function') return Promise.resolve([]);
  return doFetch('/api/subscriptions/history')
    .then((r) => {
      if (!r || !r.ok) throw new Error('history endpoint returned ' + (r && r.status));
      return r.json();
    })
    .then((body) => (body && Array.isArray(body.entries) ? body.entries : []))
    .catch(() => []);
}

/**
 * v1.29.0 T9 (R4.1, em_ratifications.history_refresh) -- the DOM-free
 * orchestrator for "fetch history ONCE on view load, then re-fetch only when
 * `detectNewlyTerminalRuns` observes a completed run" (no second/dedicated
 * timer -- rides the EXISTING ~2.5s status poll, per the EM's ratification).
 * Returns `{ loadInitial, maybeRefetchOnPoll }`:
 * - `loadInitial()` always fetches (the view-load fetch-once) and resolves
 *   to the entries array.
 * - `maybeRefetchOnPoll(nextSnapshot)` is meant to be called with EVERY
 *   status-poll tick's snapshot; it resolves to a fresh entries array ONLY
 *   when `detectNewlyTerminalRuns` fires against the snapshot from the
 *   PREVIOUS call (internally tracked, starting from an empty `{subscriptions:
 *   {}, oneShots: {}}` baseline), and resolves to `null` (a cheap, fetch-free
 *   no-op) on every tick where nothing newly completed -- callers key off
 *   `=== null` to skip re-rendering. Kept as a small stateful closure
 *   (rather than a bare module-level `let`) so multiple independent view
 *   instances (or, here, isolated `node:test` cases) never share mutable
 *   state.
 *
 * Because the FIRST call to `maybeRefetchOnPoll` compares against that empty
 * baseline (there is no "previous poll" before the first one), an already-
 * terminal entry present on the very FIRST status poll after page load
 * counts as a transition and triggers one extra (harmless -- still-correct)
 * re-fetch alongside the view-load `loadInitial()` fetch; every SUBSEQUENT
 * identical poll fires zero further fetches, which is the behavior the T9
 * tests assert.
 */
function createHistoryRefreshController(fetchImpl) {
  let prevSnapshot = { subscriptions: {}, oneShots: {} };
  return {
    loadInitial: () => fetchHistoryEntries(fetchImpl),
    maybeRefetchOnPoll: (nextSnapshot) => {
      const safeNext = (nextSnapshot && typeof nextSnapshot === 'object')
        ? { subscriptions: nextSnapshot.subscriptions || {}, oneShots: nextSnapshot.oneShots || {} }
        : { subscriptions: {}, oneShots: {} };
      const transitioned = detectNewlyTerminalRuns(prevSnapshot, safeNext);
      prevSnapshot = safeNext;
      return transitioned ? fetchHistoryEntries(fetchImpl) : Promise.resolve(null);
    },
  };
}

// ---- C5 (v1.30.0, T12): shared avatar render, routed through the ---------
// SAME `resolveAvatarSource` seam public/js/common.js's `buildPinAvatarNode`
// (sidebar pins) and `watch.js`'s `applyAvatarToElement` (uploader/comment
// avatars) already use -- REPLACES the earlier locally-reimplemented
// `hasRealChannelAvatar` presence check + inline `name[0].toUpperCase()`
// fallback that used to live at each of this file's two avatar call sites
// (`.sub-row-avatar` in `createSubscriptionRow`, `.sub-sheet-avatar` in
// `buildSettingsSheet`). A subscription's captured avatar (or its absence)
// now renders IDENTICALLY to how the same channel name/avatar would render
// anywhere else in the app, instead of a divergent letter-only fallback.
//
// `resolveAvatarSource` is consumed here as a bare GLOBAL, NOT `require`d --
// this file is a standalone browser script served from its own dedicated
// route (`GET /js/subscriptions.js`, lib/ytdlp/index.js), not bundled/built
// alongside public/js/, so it cannot `require('../../../public/js/common.js')`
// (a relative Node path with no meaning in the browser). Instead it relies on
// the SAME load-order contract `watch.js` already uses: `common.js` is loaded
// as a classic `<script>` BEFORE this file (see subscriptions.html's script
// list), and a classic script's top-level `function` declarations become
// properties of the shared global object -- so `resolveAvatarSource` is
// simply in scope by the time this file's code runs, exactly like
// `openOverlay`/`closeOverlayThen` above (see eslint.config.js's
// consumer-globals block, which now also declares `resolveAvatarSource` for
// this file). For `node:test` (where there is no `<script>` load order),
// `test/unit/ytdlp-subscriptions-client.test.js` installs
// `global.resolveAvatarSource` from a real `require('../../public/js/common.js')`
// before requiring this file -- so tests exercise the ACTUAL shared function,
// not a stand-in.
//
// `channelAvatarUrl` is already validated (https-only, well-formed)
// server-side at write time (`store.sanitizeChannelAvatarUrl`) --
// `resolveAvatarSource` itself only re-checks non-blank presence, the same
// trust boundary the old local `hasRealChannelAvatar` applied.
//
// Shared by BOTH call sites below so a given subscription's avatar always
// looks the SAME in the row and in its own settings sheet. `doc` is the
// SAME injected/defaulted `document` each caller already threads through
// (mirrors this file's Node-testability pattern); `el` is the freshly
// created, still-empty `.sub-row-avatar`/`.sub-sheet-avatar` container.
function applySubAvatar(doc, el, name, channelAvatarUrl) {
  if (!el) return;
  const source = resolveAvatarSource(name, channelAvatarUrl);
  if (source.type === 'url') {
    const avatarImg = doc.createElement('img');
    avatarImg.alt = '';
    avatarImg.src = source.url;
    el.appendChild(avatarImg);
    return;
  }
  // AVATAR_PALETTE entries are all dark -- white text keeps the glyph
  // legible regardless of era theme, mirroring watch.js's
  // `applyAvatarToElement`.
  el.style.backgroundColor = source.color;
  el.style.color = '#ffffff';
  el.textContent = source.glyph;
}

// ---- v1.25 QoL follow-up ("reheat"): metadata+subtitle re-pull over -------
// EXISTING yt-dlp downloads. Distinct from FR-E's per-subscription/one-off
// download flows above -- this is a single, page-level batch triggered by a
// dedicated button (see subscriptions.html's `#sub-reheat-btn`), backed by
// `POST /api/ytdlp/repull-metadata` (already implemented server-side; this
// file only wires the UI). Progress rides the SAME ~2.5s
// `GET /api/subscriptions/status` poll this page already runs -- the batch's
// LiveEntry lives under that response's EXISTING `oneShots` namespace, keyed
// by the server's fixed `REPULL_METADATA_ACTIVITY_ID` -- mirrored here as a
// hardcoded literal (a client bundle has no access to that server module,
// the same posture FORMAT_OPTIONS/QUALITY_OPTIONS above already use for
// args.js's allowlists).

const REHEAT_ACTIVITY_ID = 'repull-metadata';

/**
 * Pure formatter for `POST /api/ytdlp/repull-metadata`'s `202` response body
 * (`{started:true, eligible, ineligible}`) -- the "blast radius" the user
 * needs to see BEFORE the batch runs. `eligible === 0` gets its own,
 * explicit message rather than a bare "Re-pulling 0 items": many libraries
 * (especially imported/MeTube-style items with no FileTube `[<id>]` filename
 * suffix -- see server.js's `enumerateRepullableItems`) will have few or zero
 * re-pullable items, and without this the user could easily be left thinking
 * the button silently did nothing. Never throws: a non-finite/negative count
 * is clamped to 0 rather than rendering "undefined"/"NaN".
 */
function formatReheatSummary(eligible, ineligible) {
  const e = typeof eligible === 'number' && Number.isFinite(eligible) && eligible > 0 ? Math.floor(eligible) : 0;
  const i = typeof ineligible === 'number' && Number.isFinite(ineligible) && ineligible > 0 ? Math.floor(ineligible) : 0;
  if (e === 0) {
    return 'No re-pullable items found — only videos FileTube downloaded itself can be re-pulled.';
  }
  const itemWord = e === 1 ? 'item' : 'items';
  return i > 0
    ? `Re-pulling ${e} ${itemWord} · ${i} not re-pullable (imported / no source id)`
    : `Re-pulling ${e} ${itemWord}`;
}

/**
 * Pure formatter for the reheat batch's LIVE progress -- the
 * `REHEAT_ACTIVITY_ID` one-shot `LiveEntry`
 * (`{state, total, done, skipped, failed, current}`, set by
 * `lib/ytdlp/index.js`'s `runRepullMetadataBatch`). Mirrors
 * `formatLiveStatusText`'s state-driven shape but for this entry's own
 * fields -- there is no `percent`/`title` here, and `current` is a bare
 * videoId, not a display title. Returns `''` for a missing/malformed entry
 * (or an idle/unrecognized state) so callers can leave whatever was last
 * rendered (e.g. the `202` summary line) alone rather than blanking it.
 * `state === 'running'` is the ONLY non-terminal state this batch ever
 * reports (unlike subscription/one-off downloads, there is no separate
 * `'queued'` phase -- the route sets `'running'` synchronously before it
 * ever responds).
 */
function formatReheatProgressText(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const total = typeof entry.total === 'number' && Number.isFinite(entry.total) ? entry.total : 0;
  const done = typeof entry.done === 'number' && Number.isFinite(entry.done) ? entry.done : 0;
  const skipped = typeof entry.skipped === 'number' && Number.isFinite(entry.skipped) ? entry.skipped : 0;
  const failed = typeof entry.failed === 'number' && Number.isFinite(entry.failed) ? entry.failed : 0;
  const current = typeof entry.current === 'string' && entry.current.trim() !== '' ? entry.current.trim() : '';

  if (entry.state === 'running') {
    const parts = [`Reheating: ${done} of ${total} done`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (current !== '') parts.push(`current: ${current}`);
    return parts.join(' · ');
  }
  if (entry.state === 'done') {
    const parts = [`Reheat done: ${done} of ${total} updated`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    return parts.join(' · ');
  }
  if (entry.state === 'cancelled') {
    return `Reheat cancelled — ${done} of ${total} updated before stopping`;
  }
  if (entry.state === 'error') {
    return 'Reheat failed unexpectedly.';
  }
  return ''; // idle / unrecognized state -- nothing live worth showing
}

/**
 * DOM-level (no fetch): given `{button, status, cancelButton}` element refs
 * (found via `getElementById` in the live wiring below) and the CURRENT
 * `REHEAT_ACTIVITY_ID` `LiveEntry` (or `undefined` -- no batch has run yet
 * this session), applies its state -- disables the main button and shows
 * Cancel ONLY while `state === 'running'`, and renders
 * `formatReheatProgressText` into the status span. A blank progress line
 * (idle/no entry) deliberately leaves the status span's existing text alone
 * -- this is what lets the `202` response's `formatReheatSummary` line
 * survive on screen up until the very next poll tick actually has live
 * progress to show, rather than being blanked out immediately. Pure DOM
 * mutation only, mirroring `applyStatusUpdatesInPlace`'s own
 * "element refs + data in, textContent out" shape -- directly unit-testable
 * with the fake DOM, no fetch/document access needed.
 */
function applyReheatStateToControls(elements, entry) {
  if (!elements) return;
  const running = !!(entry && entry.state === 'running');
  if (elements.button) elements.button.disabled = running;
  if (elements.cancelButton) elements.cancelButton.hidden = !running;
  if (elements.status) {
    const progressText = formatReheatProgressText(entry);
    if (progressText !== '') elements.status.textContent = progressText;
  }
}

/**
 * The `#sub-reheat-btn` click handler -- `POST`s `/api/ytdlp/repull-metadata`
 * and renders the result. A `202` renders the eligible/ineligible blast
 * radius (`formatReheatSummary`); the button is disabled immediately
 * (before the response even arrives) as instant feedback, and stays
 * disabled -- the very next status poll's `applyReheatStateToControls`
 * takes over re-enabling it once the batch's own `LiveEntry` reports it is
 * no longer `'running'`. A `409` (`{started:false, alreadyRunning:true}` --
 * the server's hard single-flight guard) is NOT treated as a failure: it
 * means a reheat is already in progress, so this renders that fact rather
 * than retrying/erroring, and never starts a second, duplicate batch. A
 * network failure re-enables the button so the user can retry.
 *
 * `fetchImpl` defaults to the global `fetch` -- this file has no other
 * dependency-injection seam for `fetch` (every other action here calls the
 * global directly), so this optional param exists purely so a Node unit
 * test can drive this function directly with a stub, the same way
 * `public/js/common.js`'s `probeAndReconcileRepullButton` is tested via a
 * monkey-patched `global.fetch`.
 */
function triggerReheat(elements, fetchImpl) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch !== 'undefined' ? fetch : undefined);
  if (typeof doFetch !== 'function' || !elements) return;
  if (elements.button) elements.button.disabled = true;
  if (elements.status) elements.status.textContent = 'Starting reheat…';
  doFetch('/api/ytdlp/repull-metadata', { method: 'POST' })
    .then((r) => r.json().catch(() => ({})).then((data) => ({ ok: r.ok, status: r.status, data: data || {} })))
    .then(({ ok, status, data }) => {
      if (ok && data.started) {
        if (elements.status) elements.status.textContent = formatReheatSummary(data.eligible, data.ineligible);
        return;
      }
      if (status === 409 || data.alreadyRunning) {
        if (elements.status) elements.status.textContent = 'A metadata reheat is already in progress.';
        return;
      }
      if (elements.status) elements.status.textContent = 'Could not start metadata reheat.';
      if (elements.button) elements.button.disabled = false;
    })
    .catch((err) => {
      if (elements.status) elements.status.textContent = 'Could not start metadata reheat (network error).';
      if (elements.button) elements.button.disabled = false;
      console.error('Reheat metadata request failed:', err);
    });
}

/**
 * The `#sub-reheat-cancel-btn` click handler -- `POST`s
 * `/api/ytdlp/repull-metadata/cancel` (a plain cooperative latch; see that
 * route's own doc comment for why there is nothing more granular to await
 * here). The response's `cancelled` boolean is not separately surfaced --
 * the NEXT status poll's `applyReheatStateToControls` reflects whatever the
 * batch's own `LiveEntry` ends up recording (`'cancelled'` once the loop
 * actually stops between items). `fetchImpl` mirrors `triggerReheat`'s own
 * injectable-for-testing default.
 */
function triggerReheatCancel(elements, fetchImpl) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch !== 'undefined' ? fetch : undefined);
  if (typeof doFetch !== 'function' || !elements) return;
  if (elements.cancelButton) elements.cancelButton.disabled = true;
  doFetch('/api/ytdlp/repull-metadata/cancel', { method: 'POST' })
    .then(() => {
      if (elements.status) elements.status.textContent = 'Cancelling reheat…';
    })
    .catch((err) => console.error('Reheat cancel request failed:', err))
    .finally(() => {
      if (elements.cancelButton) elements.cancelButton.disabled = false;
    });
}

// ---- v1.25.5 QoL follow-up (channel avatars, round 2): "Refresh avatars" --
// bulk pull over EVERY subscription. Distinct from the reheat block above
// (which re-pulls metadata+subtitles for EXISTING downloaded ITEMS) -- this
// button re-probes EVERY subscription's own channel avatar, right now,
// backed by `POST /api/ytdlp/refresh-avatars` (already implemented server-
// side; this file only wires the UI). Progress rides the SAME ~2.5s
// `GET /api/subscriptions/status` poll this page already runs -- the batch's
// LiveEntry lives under that response's EXISTING `oneShots` namespace, keyed
// by the server's fixed `REFRESH_AVATARS_ACTIVITY_ID` -- mirrored here as a
// hardcoded literal, exactly like `REHEAT_ACTIVITY_ID` above.

const REFRESH_AVATARS_ACTIVITY_ID = 'refresh-avatars';

/**
 * Pure formatter for `POST /api/ytdlp/refresh-avatars`'s `202` response body
 * (`{started:true, total}`) -- mirrors `formatReheatSummary`'s own shape (the
 * blast radius the user needs to see BEFORE the batch runs), but for a plain
 * subscription COUNT rather than an eligible/ineligible split (every
 * subscription is a candidate; subs with no `channelUrl` are simply skipped
 * once the batch actually runs, see `formatRefreshAvatarsProgressText`'s own
 * `skipped` rendering below). A non-finite/negative count is clamped to 0
 * rather than rendering "undefined"/"NaN" -- never throws.
 */
function formatRefreshAvatarsSummary(total) {
  const t = typeof total === 'number' && Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  if (t === 0) {
    return 'No subscriptions to refresh avatars for.';
  }
  const subWord = t === 1 ? 'subscription' : 'subscriptions';
  return `Refreshing avatars for ${t} ${subWord}…`;
}

/**
 * Pure formatter for the refresh-avatars batch's LIVE progress -- the
 * `REFRESH_AVATARS_ACTIVITY_ID` one-shot `LiveEntry`
 * (`{state, total, done, skipped, failed, current}`, set by
 * `lib/ytdlp/index.js`'s `runRefreshAvatarsBatch`). Mirrors
 * `formatReheatProgressText`'s own state-driven shape/fields exactly.
 * Returns `''` for a missing/malformed entry (or an idle/unrecognized state)
 * so callers can leave whatever was last rendered (e.g. the `202` summary
 * line) alone rather than blanking it.
 */
function formatRefreshAvatarsProgressText(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const total = typeof entry.total === 'number' && Number.isFinite(entry.total) ? entry.total : 0;
  const done = typeof entry.done === 'number' && Number.isFinite(entry.done) ? entry.done : 0;
  const skipped = typeof entry.skipped === 'number' && Number.isFinite(entry.skipped) ? entry.skipped : 0;
  const failed = typeof entry.failed === 'number' && Number.isFinite(entry.failed) ? entry.failed : 0;
  const current = typeof entry.current === 'string' && entry.current.trim() !== '' ? entry.current.trim() : '';

  if (entry.state === 'running') {
    const parts = [`Refreshing avatars: ${done} of ${total} done`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (current !== '') parts.push(`current: ${current}`);
    return parts.join(' · ');
  }
  if (entry.state === 'done') {
    const parts = [`Avatar refresh done: ${done} of ${total} updated`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    return parts.join(' · ');
  }
  if (entry.state === 'cancelled') {
    return `Avatar refresh cancelled — ${done} of ${total} updated before stopping`;
  }
  if (entry.state === 'error') {
    return 'Avatar refresh failed unexpectedly.';
  }
  return ''; // idle / unrecognized state -- nothing live worth showing
}

/**
 * DOM-level (no fetch): mirrors `applyReheatStateToControls` exactly, just
 * for the refresh-avatars button/status/cancel element refs and its own
 * `LiveEntry` shape.
 */
function applyRefreshAvatarsStateToControls(elements, entry) {
  if (!elements) return;
  const running = !!(entry && entry.state === 'running');
  if (elements.button) elements.button.disabled = running;
  if (elements.cancelButton) elements.cancelButton.hidden = !running;
  if (elements.status) {
    const progressText = formatRefreshAvatarsProgressText(entry);
    if (progressText !== '') elements.status.textContent = progressText;
  }
}

/**
 * The "Refresh avatars" button's click handler -- `POST`s
 * `/api/ytdlp/refresh-avatars` and renders the result. Mirrors
 * `triggerReheat` exactly (instant-disable feedback, `202` renders
 * `formatRefreshAvatarsSummary`, a `409` single-flight response is NOT
 * treated as a failure, a network failure re-enables the button so the user
 * can retry). `fetchImpl` mirrors `triggerReheat`'s own injectable-for-
 * testing default.
 */
function triggerRefreshAvatars(elements, fetchImpl) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch !== 'undefined' ? fetch : undefined);
  if (typeof doFetch !== 'function' || !elements) return;
  if (elements.button) elements.button.disabled = true;
  if (elements.status) elements.status.textContent = 'Starting avatar refresh…';
  doFetch('/api/ytdlp/refresh-avatars', { method: 'POST' })
    .then((r) => r.json().catch(() => ({})).then((data) => ({ ok: r.ok, status: r.status, data: data || {} })))
    .then(({ ok, status, data }) => {
      if (ok && data.started) {
        if (elements.status) elements.status.textContent = formatRefreshAvatarsSummary(data.total);
        return;
      }
      if (status === 409 || data.alreadyRunning) {
        if (elements.status) elements.status.textContent = 'An avatar refresh is already in progress.';
        return;
      }
      if (elements.status) elements.status.textContent = 'Could not start avatar refresh.';
      if (elements.button) elements.button.disabled = false;
    })
    .catch((err) => {
      if (elements.status) elements.status.textContent = 'Could not start avatar refresh (network error).';
      if (elements.button) elements.button.disabled = false;
      console.error('Refresh avatars request failed:', err);
    });
}

/**
 * The "Refresh avatars" cancel button's click handler -- `POST`s
 * `/api/ytdlp/refresh-avatars/cancel`. Mirrors `triggerReheatCancel` exactly.
 */
function triggerRefreshAvatarsCancel(elements, fetchImpl) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch !== 'undefined' ? fetch : undefined);
  if (typeof doFetch !== 'function' || !elements) return;
  if (elements.cancelButton) elements.cancelButton.disabled = true;
  doFetch('/api/ytdlp/refresh-avatars/cancel', { method: 'POST' })
    .then(() => {
      if (elements.status) elements.status.textContent = 'Cancelling avatar refresh…';
    })
    .catch((err) => console.error('Refresh avatars cancel request failed:', err))
    .finally(() => {
      if (elements.cancelButton) elements.cancelButton.disabled = false;
    });
}

// ---- DOM construction (textContent-only for every server/user-derived string) --

/**
 * Build a `<select>` populated from `options` (an array of either plain
 * strings or `{value, label}` objects) via `createElement`/`textContent`
 * ONLY -- used for the dynamically-created settings-sheet form (the two
 * STATIC forms -- add-subscription and one-shot -- hardcode their `<option>`
 * markup directly in subscriptions.html, per the exec plan's Design section;
 * this builder exists for the one place options are generated at runtime).
 */
function buildSelect(doc, options, selectedValue, className) {
  const d = doc || document;
  const select = d.createElement('select');
  if (className) select.className = className;
  let matchedValue = null;
  options.forEach((opt) => {
    const value = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    const option = d.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === selectedValue) {
      option.selected = true;
      matchedValue = value;
    }
    select.appendChild(option);
  });
  // Mirrors real `<select>` behavior: `.value` reflects whichever option was
  // marked `selected`, falling back to the first option when `selectedValue`
  // matched none of them (an unrecognized/stale persisted value).
  const firstValue = options.length > 0 ? (typeof options[0] === 'string' ? options[0] : options[0].value) : undefined;
  select.value = matchedValue !== null ? matchedValue : firstValue;
  return select;
}

function buildFormatSelect(doc, selectedValue) {
  return buildSelect(doc, FORMAT_OPTIONS, selectedValue || 'video', 'setup-select');
}

function buildQualitySelect(doc, selectedValue) {
  return buildSelect(doc, QUALITY_OPTIONS, selectedValue || DEFAULT_QUALITY_OPTION, 'setup-select');
}

/**
 * Build the filetype/container `<select>` for the given `format`
 * ('video'/'audio'; anything else is treated as 'video') -- used for the
 * dynamically-built settings sheet, mirroring buildFormatSelect/
 * buildQualitySelect. `selectedValue` falls back to the recommended default
 * for the format (mp4/mp3) when unset/not a member of that format's options.
 */
function buildFiletypeSelect(doc, format, selectedValue) {
  const fmt = format === 'audio' ? 'audio' : 'video';
  return buildSelect(doc, FILETYPE_OPTIONS[fmt], selectedValue || DEFAULT_FILETYPE_OPTION[fmt], 'setup-select');
}

/**
 * Pure reducer (no DOM): given the CURRENT `format` and the filetype value
 * that was selected before the format changed, decides the filetype
 * `<select>`'s new option list + selected value. A previously-selected value
 * that is STILL valid for the new format survives (e.g. `'default'` is valid
 * for both); otherwise the new format's recommended default (mp4/mp3) is
 * used. No DOM/fetch involved, so a test can call this directly.
 */
function reduceFiletypeOptions(format, prevFiletype) {
  const fmt = format === 'audio' ? 'audio' : 'video';
  const options = FILETYPE_OPTIONS[fmt];
  const stillValid = options.some((opt) => opt.value === prevFiletype);
  const selected = stillValid ? prevFiletype : DEFAULT_FILETYPE_OPTION[fmt];
  return { format: fmt, options, selected };
}

/**
 * DOM-level helper: rebuilds `filetypeSelect`'s `<option>` list in place from
 * `format`'s current value, via `reduceFiletypeOptions` -- used by the add,
 * one-shot, and settings-sheet format `<select>`'s `change` listener.
 * `createElement`/`textContent` only, matching this file's no-`innerHTML`
 * discipline; clears via `clearChildren` (defined below), never
 * `innerHTML = ''`.
 */
function repopulateFiletypeSelect(doc, format, filetypeSelect) {
  if (!filetypeSelect) return;
  const d = doc || document;
  const { options, selected } = reduceFiletypeOptions(format, filetypeSelect.value);
  clearChildren(filetypeSelect);
  let matchedValue = null;
  options.forEach((opt) => {
    const option = d.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === selected) {
      option.selected = true;
      matchedValue = opt.value;
    }
    filetypeSelect.appendChild(option);
  });
  filetypeSelect.value = matchedValue !== null ? matchedValue : (options.length > 0 ? options[0].value : undefined);
}

/**
 * Build a small labeled field wrapper (`<label>` containing a text `<span>`
 * + the given control element) for the settings sheet body -- a tiny,
 * reusable layout helper so `buildSettingsSheet` doesn't repeat the same
 * four lines per field. `labelText` is always a fixed literal supplied by
 * this file, never server/user-derived, so `textContent` here carries no
 * special XSS-review weight (documented anyway per the file's blanket
 * textContent-only discipline).
 */
function buildSheetField(doc, labelText, controlEl) {
  const d = doc || document;
  const wrap = d.createElement('label');
  wrap.className = 'sub-sheet-field';
  const labelSpan = d.createElement('span');
  labelSpan.className = 'sub-sheet-field-label';
  labelSpan.textContent = labelText;
  wrap.appendChild(labelSpan);
  wrap.appendChild(controlEl);
  return wrap;
}

/**
 * v1.21.0 FR-3 (T3): build ONE dense subscription row as a real DOM node.
 * Replaces the pre-v1.21 row (avatar-less, a cramped inline
 * Pause/Edit/Re-pull/Delete button cluster, and an inline `editPanel` that
 * the ~2.5s live-status poll used to unconditionally rebuild -- FR-1's root
 * cause). The new anatomy (AC19) is exactly four direct children of `.sub-row`:
 *   1. `.sub-row-avatar` -- a beveled avatar: a real captured channel image
 *      when present, else the SAME shared deterministic generated-glyph
 *      fallback pins/watch use (C5, v1.30.0, T12 -- see `applySubAvatar`),
 *      falling back to a literal `'?'` for a missing/blank name.
 *   2. `.sub-row-info` -- the name, ONE muted metadata line (`.sub-row-meta`
 *      -- `formatSubMeta` + the FR-4 subscribed date, joined into a single
 *      line -- plus `.sub-row-status`, a SEPARATE element the live poll
 *      targets in place, see `applyStatusUpdatesInPlace` below; both render
 *      on one visual line via CSS), and the FR-4 channel `<a>` link.
 *   3. `.sub-row-kebab` -- a single trailing gear/kebab `<button>` that
 *      opens the settings bottom-sheet (`onOpenSettings`), stopping
 *      propagation so it can never also fire the row-tap navigate handler.
 *
 * `handlers` = `{ onRowTap(sub), onOpenSettings(sub), onTogglePin(sub, pinned) }`
 * decouples DOM construction from navigation/sheet-opening/pin-toggling so
 * this function stays pure and unit-testable (a test can invoke a fake
 * element's recorded click listener directly, without a real
 * `window.FileTube.navigate`/fetch). `doc` defaults to the global `document`
 * so real page code can call this with no second argument; tests inject a
 * minimal fake. `liveEntry` is the subscription's current `LiveEntry` from
 * the status poll (or `undefined` when there is none yet) -- when it renders
 * a non-null status line (`formatLiveStatusText`), that REPLACES the
 * persisted `formatSubStatus` line for this render; otherwise the persisted
 * status is shown. `pinned` (v1.21.0 FR-5, boolean, defaults falsy) is
 * whether this row's `channelDir` currently has a persisted pin -- purely a
 * rendering flag the CALLER computes (by cross-referencing
 * `GET /api/subscriptions/pins`' `channelDir` field against this row's own),
 * never looked up by this function itself, keeping it pure/DOM-only.
 *
 * Row tap (AC20): the row body -- everything OUTSIDE the kebab/pin toggle --
 * navigates to `/?root=<channelDir>` via `onRowTap`, but ONLY when the row's
 * `channelDir` was resolved server-side (the v1.20 FR-4 per-channel link,
 * `GET /api/subscriptions`'s enrichment). A row without a resolved
 * `channelDir` gets NO click listener at all -- it is fail-safe
 * non-navigating, exactly like the old playlist link's omission.
 */
function createSubscriptionRow(sub, doc, handlers, liveEntry, pinned) {
  const d = doc || document;
  const h = handlers || {};
  const row = d.createElement('div');
  row.className = 'sub-row';

  // B4 (v1.24.0, T6, FR-8): drag-and-drop reorder target. Every row with a
  // real id is draggable -- unlike the Playlist link/pin toggle above (gated
  // on a RESOLVED `channelDir`), reordering doesn't need one: it only
  // rearranges `db.ytdlp.subscriptions`' `order` field, so a subscription
  // whose folder couldn't be confined/resolved is still reorderable. The
  // live wiring below (`wireSubRowDragAndDrop`) reads `data-sub-id` back off
  // each row to resolve source/target indices against the current in-memory
  // list -- attribute-only here, no listeners: keeps this builder pure/
  // DOM-only, mirroring the rest of this function's division of labor
  // (construction here, live wiring in the per-page controller below).
  if (sub && typeof sub.id === 'string' && sub.id !== '') {
    row.setAttribute('draggable', 'true');
    row.setAttribute('data-sub-id', sub.id);
  }

  const navigable = !!(sub && typeof sub.channelDir === 'string' && sub.channelDir !== '');
  if (navigable) {
    if (typeof row.classList === 'object' && row.classList && typeof row.classList.add === 'function') {
      row.classList.add('sub-row-navigable');
    }
    row.addEventListener('click', (event) => {
      // v1.21 FIX 2 (post-gate hardening, QA -- FR-3/FR-4): the FR-4 channel
      // `<a target="_blank">` link (below) and the FR-4 "View as Playlist"
      // `<a>` link (below) both live INSIDE this row and do NOT
      // `stopPropagation` (unlike the kebab/pin-toggle buttons, which do) --
      // without this guard, clicking either link would BOTH open the new tab
      // (or navigate for the playlist link) AND fire `onRowTap`'s SPA
      // navigation on the current tab, yanking the user away from the page
      // they just opened a link from. `closest('a')` also fail-safely covers
      // any future link added inside the row, not just these two.
      const target = event && event.target;
      if (target && typeof target.closest === 'function' && target.closest('a')) return;
      if (typeof h.onRowTap === 'function') h.onRowTap(sub);
    });
  }

  const avatar = d.createElement('div');
  avatar.className = 'sub-row-avatar';
  // C5 (v1.30.0, T12): a real, sanitized `sub.channelAvatarUrl` wins
  // (rendered as an `<img>`, DOM-only, no `innerHTML`, `alt=''` since the
  // name is already shown as text alongside it), else the SAME deterministic
  // generated-glyph fallback pins/watch use -- see `applySubAvatar`'s own doc
  // comment above for the full precedence rationale. The `.sub-row-avatar`
  // CONTAINER itself is unchanged either way (same class/size/shape); only
  // its content differs. SECURITY: `sub.name` itself is never rendered
  // here -- `resolveAvatarSource`/`deriveAvatar` only ever produce a single
  // inert alphabet character or literal '?', assigned via `textContent`.
  applySubAvatar(d, avatar, sub && sub.name, sub && sub.channelAvatarUrl);
  row.appendChild(avatar);

  const info = d.createElement('div');
  info.className = 'sub-row-info';

  const nameEl = d.createElement('div');
  nameEl.className = 'sub-row-name';
  // SECURITY: `sub.name` is derived from yt-dlp channel metadata at add-time
  // -- a malicious channel could set a hostile display name (e.g. containing
  // `<script>`/`<img onerror=...>`). `textContent` renders it as inert text
  // no matter what it contains; it is NEVER passed through `innerHTML` or a
  // template string.
  nameEl.textContent = (sub && sub.name) || '(untitled subscription)';
  info.appendChild(nameEl);

  const metaEl = d.createElement('div');
  metaEl.className = 'sub-row-meta';
  // v1.21.0 FR-3/FR-4: ONE muted metadata line -- format/quality/count
  // (formatSubMeta) plus the FR-4 "Subscribed on <date>" fragment, joined
  // with the same ' · ' separator formatSubMeta already uses internally.
  metaEl.textContent = formatSubMeta(sub) + ' · ' + formatSubscribedDate(sub && sub.addedAt);
  info.appendChild(metaEl);

  const statusEl = d.createElement('div');
  statusEl.className = 'sub-row-status';
  // FR-E: a live in-flight status (queued/listing/downloading %/done/error)
  // takes over from the persisted `lastStatus` line while it is available.
  // This is the ONE element `applyStatusUpdatesInPlace` (FR-1 fix) ever
  // mutates on a poll tick -- the rest of this row is never touched again
  // until the next FULL rebuild (an explicit add/edit/delete/pause action).
  // SECURITY: `lastStatus`/`entry.error` can both carry a
  // redacted-but-still-server-composed error string (lib/ytdlp/index.js's
  // safeErrorStatus) -- textContent only, either way.
  statusEl.textContent = formatRowStatusLine(sub, liveEntry);
  // v1.29.0 T4 (R3a.6): JS `classList` HOOK ONLY -- no CSS/token added here
  // (a parallel session owns styling this class; off-limits guard honored).
  // See `isPartialRowStatus`'s doc comment for why this mirrors
  // `formatRowStatusLine`'s own live-vs-persisted precedence.
  if (isPartialRowStatus(sub, liveEntry)) {
    statusEl.classList.add('sub-row-status-partial');
  } else {
    statusEl.classList.remove('sub-row-status-partial');
  }
  info.appendChild(statusEl);

  // v1.24.0 A2 (T14): the per-item failure detail line -- see
  // `formatFailuresLine`'s doc comment for the state-gated, stale-tolerant
  // contract. `hidden` when empty rather than leaving a bare, empty
  // element visible in the row.
  const failuresEl = d.createElement('div');
  failuresEl.className = 'sub-row-failures';
  const failuresLine = formatFailuresLine(liveEntry);
  failuresEl.textContent = failuresLine;
  failuresEl.hidden = failuresLine === '';
  info.appendChild(failuresEl);

  // v1.29.0 T4 (R3c.1 client): the cookie-missing warning line -- mirrors
  // `.sub-row-failures` above exactly (fixed literal via `formatWarningLine`,
  // `textContent` only, `hidden` when empty).
  const warningEl = d.createElement('div');
  warningEl.className = 'sub-row-warning';
  const warningLine = formatWarningLine(liveEntry);
  warningEl.textContent = warningLine;
  warningEl.hidden = warningLine === '';
  info.appendChild(warningEl);

  // v1.21.0 FR-4 (AC30/AC31): the channel URL row is now a real, clickable
  // `<a>` (rather than inert text) when `channelUrl` is present -- built via
  // `.href = sub.channelUrl` (already `validateChannelUrl`-validated
  // server-side at add-time, so this is not a new trust boundary) +
  // `target="_blank" rel="noopener noreferrer"`, and `textContent` for the
  // visible label (the URL itself). Falls back to a plain, non-link `<div>`
  // when there is no channelUrl to link to (mirrors the old `.sub-row-url`
  // element's graceful empty-string behavior).
  const hasChannelUrl = !!(sub && typeof sub.channelUrl === 'string' && sub.channelUrl !== '');
  const linkEl = d.createElement(hasChannelUrl ? 'a' : 'div');
  linkEl.className = 'sub-row-channel-link';
  if (hasChannelUrl) {
    linkEl.href = sub.channelUrl;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
  }
  linkEl.textContent = (sub && sub.channelUrl) || '';
  info.appendChild(linkEl);

  // v1.20.0 FR-4: a per-channel Playlist link, present only when the server
  // successfully resolved this subscription's confined download subfolder
  // (`GET /api/subscriptions`'s `channelDir` enrichment, lib/ytdlp/index.js --
  // omitted, never null/empty-string, on a confinement failure). Kept as its
  // OWN link (distinct from the FR-4 channel link above) so a channel with a
  // resolved directory still gets an explicit, always-visible way to open its
  // videos even when the row itself is also tap-to-navigate (redundant on
  // purpose -- discoverable for keyboard/assistive-tech users, not just a
  // full-row pointer target). Built via `createElement`/`.href`/`textContent`
  // only -- `channelDir` is `encodeURIComponent`-escaped into the query
  // string, and the link's own label is a fixed literal, never interpolated.
  // HARD INVARIANT (two-reviewer gate): `channelDir` is never written into
  // `db.folders`/`folderSettings` anywhere -- this is a read-only, per-render
  // link built from the response field alone.
  if (navigable) {
    const playlistLinkEl = d.createElement('a');
    playlistLinkEl.className = 'sub-row-playlist-link';
    playlistLinkEl.href = '/?root=' + encodeURIComponent(sub.channelDir);
    playlistLinkEl.textContent = 'View as Playlist';
    info.appendChild(playlistLinkEl);
  }

  row.appendChild(info);

  // v1.29.0 T6 (R1.1/R1.2, AC3.1/AC3.2): a Retry affordance directly on the
  // row for an error/partial state -- the settings-sheet Re-pull
  // (`buildSettingsSheet`, below) is no longer the ONLY path (R1.1). Reuses
  // the SAME `h.onRepull(id)` wiring the settings sheet already uses (see
  // `openSettingsSheet`'s wiring in the live controller below) -- `btn btn-sm`
  // is an EXISTING reused button class (the settings sheet's own Re-pull
  // button, `buildSettingsSheet` below), `sub-row-retry` is a JS marker class
  // hook only (no new CSS, off-limits guard honored). `h.onRepull` is
  // expected to return a Promise resolving to T5's parsed repull-route
  // response body (or `null`/anything else for "nothing to inspect") so this
  // handler can render the R1.5 "queued behind current run" state (AC3.5) --
  // see `isQueuedRepullResponse`. A plain, non-Promise-returning `h.onRepull`
  // (e.g. a minimal test double) is tolerated too -- the queued render is
  // simply skipped, never throwing.
  if (shouldShowRetryButton(sub, liveEntry)) {
    const retryBtn = d.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn btn-sm sub-row-retry';
    retryBtn.setAttribute('aria-label', 'Retry download');
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', (event) => {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof h.onRepull !== 'function') return;
      const result = h.onRepull(sub && sub.id);
      if (result && typeof result.then === 'function') {
        result.then((body) => {
          if (isQueuedRepullResponse(body)) {
            // AC3.5: an explicit, visible "queued behind current run" state --
            // never a silent no-op. `applyStatusUpdatesInPlace`'s poll-tick
            // clears this same marker class every tick (see its own doc
            // comment), so it naturally clears itself on the row's next real
            // status update -- no explicit dismiss needed here, mirroring the
            // chip's own "no explicit dismiss" started:true comment.
            statusEl.classList.add('sub-row-status-queued');
            statusEl.textContent = QUEUED_STATUS_TEXT;
          }
          // started === true: the row naturally transitions on the next poll
          // tick (`applyStatusUpdatesInPlace`) -- nothing to render here.
        }).catch(() => { /* best-effort -- the next poll reflects whatever actually happened */ });
      }
    });
    row.appendChild(retryBtn);
  }

  // v1.21.0 FR-5 (AC35): a discoverable star/pin TOGGLE (not drag-only), next
  // to the kebab -- pin vs. subscribe are different intents per the UI
  // research (docs/ui-research-2026-07.md §3), so this is a SEPARATE action
  // from the kebab's settings sheet, not folded into it. Only rendered when
  // `navigable` (a resolved `channelDir` -- exactly the same gate the
  // Playlist link above uses): there is nothing meaningful to pin without a
  // confined channel directory to snapshot. `stopPropagation` keeps a pin tap
  // from ALSO firing the row's own tap-to-navigate handler, mirroring the
  // kebab's own guard below. The glyph itself (filled vs. outline star) is
  // the ONLY thing `pinned` affects here -- the actual persisted state lives
  // entirely server-side (`db.ytdlp.pins`); this button never tracks it
  // itself.
  if (navigable) {
    const pinBtn = d.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = pinned ? 'sub-row-pin sub-row-pin-active' : 'sub-row-pin';
    pinBtn.setAttribute('aria-label', pinned ? 'Unpin this channel playlist' : 'Pin this channel playlist');
    pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    // SECURITY: a fixed literal glyph only -- never interpolates any
    // server/user-derived string, so this needs no escaping discussion.
    pinBtn.textContent = pinned ? '★' : '☆'; // filled star / outline star
    pinBtn.addEventListener('click', (event) => {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof h.onTogglePin === 'function') h.onTogglePin(sub, pinned);
    });
    row.appendChild(pinBtn);
  }

  // v1.21.0 FR-3 (AC19/AC21): the single trailing kebab/gear -- replaces the
  // old inline Pause/Edit/Re-pull/Delete cluster entirely. Opens the
  // settings bottom-sheet (built by buildSettingsSheet, below), which holds
  // ALL of those actions plus the edit fields. `stopPropagation` keeps a
  // kebab tap from ALSO firing the row's own tap-to-navigate handler above
  // (they are deliberately separate explicit targets, per the UI research).
  const kebabBtn = d.createElement('button');
  kebabBtn.type = 'button';
  kebabBtn.className = 'sub-row-kebab';
  kebabBtn.setAttribute('aria-label', 'Subscription settings');
  kebabBtn.textContent = '⋮';
  kebabBtn.addEventListener('click', (event) => {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof h.onOpenSettings === 'function') h.onOpenSettings(sub);
  });
  row.appendChild(kebabBtn);

  return row;
}

/**
 * v1.21.0 FR-3 (AC21/AC22): builds the per-subscription settings bottom-sheet
 * as a single, self-contained DOM subtree (`.sub-sheet-backdrop` wrapping
 * `.sub-sheet`) -- NOT part of the subscriptions list. This is the
 * structural fix for FR-1's poll-clobber bug class: the list's live-status
 * poll (`applyStatusUpdatesInPlace`) only ever touches `.sub-row-status`
 * elements it is handed a reference to; it has no reference to (and never
 * queries for) this sheet, so a poll tick arriving while the sheet is open
 * with unsaved input can never rebuild/destroy it. Live wiring
 * (`openSettingsSheet`/`closeSettingsSheet`, below) appends/removes this
 * node from `document.body` on demand -- it does not live in
 * subscriptions.html's static markup at all.
 *
 * Fields (AC21): quality/type(format)/filetype/skipShorts/cutoffDate
 * (v1.25 QoL, T5 -- retires the old count(maxVideos) field)/
 * maxDurationSeconds (v1.22.0 FR-6), plus Pause/Resume, Re-pull, Delete, and
 * Save action buttons. The channel
 * NAME renders READ-ONLY in the header (coordinator decision -- see
 * `.state/inbox/software-developer-T3.md`: `validateSubscriptionPatch`/
 * `updateSubscription` do not accept a `name` patch, and editing it would
 * change `resolveChannelDir` and orphan already-downloaded files).
 *
 * `handlers` = `{ onSave(id, patch), onTogglePause(sub), onRepull(id),
 * onDelete(sub), onClose() }`. Returns the backdrop node (the sheet is its
 * only child) -- callers own appending/removing it.
 */
function buildSettingsSheet(sub, doc, handlers) {
  const d = doc || document;
  const h = handlers || {};

  const backdrop = d.createElement('div');
  backdrop.className = 'sub-sheet-backdrop';
  backdrop.addEventListener('click', () => {
    if (typeof h.onClose === 'function') h.onClose();
  });

  const sheet = d.createElement('div');
  sheet.className = 'sub-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  // A click that lands INSIDE the sheet must never bubble up to the
  // backdrop's close-on-click listener above.
  sheet.addEventListener('click', (event) => {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  });

  // ---- header: avatar + READ-ONLY name + subscribed date + close --------
  const header = d.createElement('div');
  header.className = 'sub-sheet-header';

  const avatar = d.createElement('div');
  avatar.className = 'sub-sheet-avatar';
  // C5 (v1.30.0, T12): same shared `resolveAvatarSource` precedence as
  // `createSubscriptionRow`'s own `.sub-row-avatar` above -- see
  // `applySubAvatar`'s doc comment.
  applySubAvatar(d, avatar, sub && sub.name, sub && sub.channelAvatarUrl);
  header.appendChild(avatar);

  const titleWrap = d.createElement('div');
  titleWrap.className = 'sub-sheet-titlewrap';

  const nameEl = d.createElement('div');
  nameEl.className = 'sub-sheet-name';
  // READ-ONLY by design -- no input control backs this field anywhere in
  // the sheet (see the coordinator-decision comment above the function).
  nameEl.textContent = (sub && sub.name) || '(untitled subscription)';
  titleWrap.appendChild(nameEl);

  const subtextEl = d.createElement('div');
  subtextEl.className = 'sub-sheet-subtext';
  subtextEl.textContent = formatSubscribedDate(sub && sub.addedAt);
  titleWrap.appendChild(subtextEl);

  header.appendChild(titleWrap);

  const closeBtn = d.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sub-sheet-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    if (typeof h.onClose === 'function') h.onClose();
  });
  header.appendChild(closeBtn);

  sheet.appendChild(header);

  // ---- body: quality/count(maxVideos)/type(format)/filetype/skipShorts --
  const body = d.createElement('div');
  body.className = 'sub-sheet-body';

  const formatSelect = buildFormatSelect(d, sub && sub.format);
  body.appendChild(buildSheetField(d, 'Type', formatSelect));

  const qualitySelect = buildQualitySelect(d, sub && sub.quality);
  body.appendChild(buildSheetField(d, 'Quality', qualitySelect));

  const filetypeSelect = buildFiletypeSelect(d, sub && sub.format, sub && sub.filetype);
  body.appendChild(buildSheetField(d, 'Filetype', filetypeSelect));
  formatSelect.addEventListener('change', () => {
    repopulateFiletypeSelect(d, formatSelect.value, filetypeSelect);
  });

  // v1.25 QoL (T5): retires the old "download last N videos" count field --
  // replaced by a cutoff-DATE input (everything published on/after it
  // downloads, no count cap; see `store.js`'s `cutoffDate` schema, T1).
  // Pre-filled from the subscription's OWN current `cutoffDate`
  // (`cutoffDateToInputValue`), never a computed "today"/"yesterday" -- this
  // is an EXISTING subscription's real value, not a fresh default. Blank on
  // Save means "leave unchanged," exactly like `maxVideos`'s old posture.
  const cutoffDateInput = d.createElement('input');
  cutoffDateInput.type = 'date';
  cutoffDateInput.value = cutoffDateToInputValue(sub && sub.cutoffDate);
  body.appendChild(buildSheetField(d, 'Download videos published on or after (blank = unchanged)', cutoffDateInput));

  // v1.22.0 FR-6: max-duration download gate override, mirroring
  // `maxVideosInput` exactly (same input treatment, same blank/0 semantics)
  // -- the STORED value is always SECONDS (matching `sub.maxDurationSeconds`/
  // the server's `--match-filter "duration < <n>"`), never converted to
  // minutes/hours client-side, so the label spells out the unit + defaults
  // explicitly instead.
  const maxDurationInput = d.createElement('input');
  maxDurationInput.type = 'number';
  maxDurationInput.min = '0';
  maxDurationInput.setAttribute('placeholder', 'blank = unchanged, 0 = unlimited');
  if (sub && typeof sub.maxDurationSeconds === 'number') maxDurationInput.value = String(sub.maxDurationSeconds);
  body.appendChild(buildSheetField(d, 'Max length (seconds, blank = 2h default, 0 = unlimited)', maxDurationInput));

  const skipShortsLabel = d.createElement('label');
  skipShortsLabel.className = 'sub-sheet-checkbox-label';
  const skipShortsCheck = d.createElement('input');
  skipShortsCheck.type = 'checkbox';
  skipShortsCheck.checked = !!(sub && sub.skipShorts);
  skipShortsLabel.appendChild(skipShortsCheck);
  const skipShortsText = d.createElement('span');
  skipShortsText.textContent = 'Skip Shorts';
  skipShortsLabel.appendChild(skipShortsText);
  body.appendChild(skipShortsLabel);

  sheet.appendChild(body);

  // ---- footer actions: Pause/Resume, Re-pull, Delete, Save ---------------
  const actions = d.createElement('div');
  actions.className = 'sub-sheet-actions';

  const pauseBtn = d.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'btn btn-sm';
  pauseBtn.textContent = sub && sub.paused ? 'Resume' : 'Pause';
  pauseBtn.addEventListener('click', () => {
    if (typeof h.onTogglePause === 'function') h.onTogglePause(sub);
  });
  actions.appendChild(pauseBtn);

  const repullBtn = d.createElement('button');
  repullBtn.type = 'button';
  repullBtn.className = 'btn btn-sm';
  repullBtn.textContent = 'Re-pull';
  repullBtn.addEventListener('click', () => {
    if (typeof h.onRepull === 'function') h.onRepull(sub && sub.id);
  });
  actions.appendChild(repullBtn);

  const deleteBtn = d.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-sm sub-sheet-delete';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    if (typeof h.onDelete === 'function') h.onDelete(sub);
  });
  actions.appendChild(deleteBtn);

  const saveBtn = d.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-sm btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    // Mirrors the pre-v1.21 inline edit panel's patch-building logic
    // (skipShorts always included -- a checkbox always has a definite
    // checked/unchecked state; cutoffDate only sent when the date input is
    // non-blank and well-formed, so a blank field means "leave unchanged,"
    // the exact posture the retired maxVideos field used to have).
    const patch = {
      format: formatSelect.value,
      quality: qualitySelect.value,
      filetype: filetypeSelect.value,
      skipShorts: skipShortsCheck.checked,
    };
    const cutoffDate = inputValueToCutoffDate(cutoffDateInput.value);
    if (cutoffDate !== undefined) patch.cutoffDate = cutoffDate;
    // v1.22.0 FR-6: same blank-means-unchanged posture as cutoffDate above.
    const rawMaxDuration = typeof maxDurationInput.value === 'string' ? maxDurationInput.value.trim() : '';
    if (rawMaxDuration !== '') {
      const parsed = Number(rawMaxDuration);
      if (Number.isInteger(parsed) && parsed >= 0) patch.maxDurationSeconds = parsed;
    }
    if (typeof h.onSave === 'function') h.onSave(sub && sub.id, patch);
  });
  actions.appendChild(saveBtn);

  sheet.appendChild(actions);
  backdrop.appendChild(sheet);
  return backdrop;
}

/**
 * v1.21.0 FR-1 fix (AC1/AC4/AC22): the TARGETED, in-place status-poll update.
 * Given `rowElementsById` (a plain `{ [subId]: rowElement }` map -- built
 * ONLY on a full render, see `renderSubscriptions` in the live wiring below),
 * the CURRENT `subs` array, and the latest `statusSnapshot` (the
 * `GET /api/subscriptions/status` shape), this updates ONLY each known row's
 * `.sub-row-status` child's `textContent` -- it never calls `createElement`,
 * never removes/reorders/replaces any row, and never touches anything for a
 * subscription id it wasn't handed a row reference for.
 *
 * This is the whole FR-1 fix: the pre-v1.21 poll called `renderSubscriptions()`
 * (`clearChildren` + a full rebuild) on every ~2.5s tick, which is exactly
 * what used to destroy an open/unsaved inline edit panel out from under the
 * user (a class of bug, not narrowly a `maxVideos` one -- AC4). Since v1.21's
 * settings sheet (`buildSettingsSheet`) is ALSO not part of the row list at
 * all (a separate top-level DOM node), the same construction extends the
 * guarantee to it too: this function has no way to reach into an open sheet
 * even if it wanted to, so a poll tick arriving mid-edit can never clobber an
 * unsaved sheet field (AC1/AC22) -- see the "poll never touches an
 * independently-open sheet" regression test alongside this function's tests.
 */
function applyStatusUpdatesInPlace(rowElementsById, subs, statusSnapshot) {
  if (!rowElementsById || !Array.isArray(subs)) return;
  const liveSubs = (statusSnapshot && statusSnapshot.subscriptions) || {};
  subs.forEach((sub) => {
    if (!sub || !sub.id) return;
    const rowEl = rowElementsById[sub.id];
    if (!rowEl) return;
    const statusEl = findChildByClassName(rowEl, 'sub-row-status');
    if (!statusEl) return;
    statusEl.textContent = formatRowStatusLine(sub, liveSubs[sub.id]);
    // v1.29.0 T4 (R3a.6): SAME targeted, classList-only update as the
    // build-time hook in `createSubscriptionRow` -- see `isPartialRowStatus`'s
    // doc comment. JS hook only, no CSS.
    if (isPartialRowStatus(sub, liveSubs[sub.id])) {
      statusEl.classList.add('sub-row-status-partial');
    } else {
      statusEl.classList.remove('sub-row-status-partial');
    }
    // v1.29.0 T6 (R1.5/AC3.5): the "queued behind current run" marker
    // (`sub-row-status-queued`) is a TRANSIENT, click-triggered signal --
    // never derived from `statusSnapshot` itself (unlike `-status-partial`
    // above) -- so it is unconditionally cleared on every real poll tick,
    // exactly once `statusEl.textContent` above has already been overwritten
    // with the row's actual current status. This is the "naturally
    // transitions on the next poll" mechanism `createSubscriptionRow`'s Retry
    // handler's own doc comment describes: no explicit dismiss timer needed.
    statusEl.classList.remove('sub-row-status-queued');
    // v1.24.0 A2 (T14): SAME targeted, textContent-only update as
    // `.sub-row-status` above -- never `createElement` on a poll tick (see
    // `applyStatusUpdatesInPlace`'s own doc comment for why that invariant
    // matters). Absent in any pre-A2-built row (an older page load before
    // this shipped) -- `findChildByClassName` simply returns `null` and this
    // is skipped, never throwing.
    const failuresEl = findChildByClassName(rowEl, 'sub-row-failures');
    if (failuresEl) {
      const failuresLine = formatFailuresLine(liveSubs[sub.id]);
      failuresEl.textContent = failuresLine;
      failuresEl.hidden = failuresLine === '';
    }
    // v1.29.0 T4 (R3c.1 client): SAME targeted, textContent-only update as
    // `.sub-row-failures` above -- absent on a pre-T4-built row -> `null` ->
    // skipped, never throwing.
    const warningEl = findChildByClassName(rowEl, 'sub-row-warning');
    if (warningEl) {
      const warningLine = formatWarningLine(liveSubs[sub.id]);
      warningEl.textContent = warningLine;
      warningEl.hidden = warningLine === '';
    }
  });
}

/**
 * Small DOM-shape helper (works against BOTH a real element and this file's
 * test-only fake, since both expose an iterable `.children` of element
 * children): finds the first descendant (depth-first, any depth) whose
 * `className` exactly equals `name`. Used only by `applyStatusUpdatesInPlace`
 * above to locate `.sub-row-status` without relying on `querySelector`
 * (unavailable on the fake DOM the unit tests use).
 */
function findChildByClassName(el, name) {
  if (!el || !el.children) return null;
  for (const child of el.children) {
    if (child.className === name) return child;
    const nested = findChildByClassName(child, name);
    if (nested) return nested;
  }
  return null;
}

// buildSkeletonRows (Item 1, v1.26.3): `n` lightweight `.sub-row`-shaped
// loading placeholder ELEMENTS (a per-surface skeleton helper, mirroring
// `buildSkeletonGrid` in public/js/main.js), appended into
// `#sub-list-container` BEFORE `loadSubscriptions()`'s `GET /api/subscriptions`
// fetch settles -- kills the same "ships empty, pops in all at once" window
// the home grid had. Each skeleton row matches the REAL `.sub-row`'s box
// model exactly (`.sub-row-avatar`'s fixed 36x36 box, `.sub-row-info`'s
// flex-basis) so swapping skeleton nodes for real rows produces zero layout
// shift. Built via `createElement` ONLY, like every other DOM builder in
// this file -- this file carries a hard, file-wide "no live `.innerHTML`
// assignment" bar (see the SECURITY comment at the top of this file and its
// AC32 regression guard, test/integration/ytdlp-ui-routes.test.js), so an
// HTML-string-based builder (the way `buildSkeletonGrid` in main.js does it)
// is not an option here even though this markup is 100% static. Returns an
// ARRAY of elements (not a single container) so a caller can `appendChild`
// each one directly into an existing list without an extra wrapper `<div>`.
// `doc` (optional, defaults to `document`) mirrors this file's other DOM
// builders' Node-testability pattern. Exported for node:test.
function buildSkeletonRows(n, doc) {
  const d = doc || document;
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = d.createElement('div');
    row.className = 'skeleton-row';
    row.setAttribute('aria-hidden', 'true');

    const avatar = d.createElement('div');
    avatar.className = 'skeleton-row-avatar skeleton-shimmer';
    row.appendChild(avatar);

    const info = d.createElement('div');
    info.className = 'skeleton-row-info';
    const title = d.createElement('div');
    title.className = 'skeleton-line skeleton-line-title skeleton-shimmer';
    info.appendChild(title);
    const meta = d.createElement('div');
    meta.className = 'skeleton-line skeleton-line-meta skeleton-shimmer';
    info.appendChild(meta);
    row.appendChild(info);

    rows.push(row);
  }
  return rows;
}

// buildErrorStateNode (Item 3, v1.26.3): DOM-node twin of common.js's
// `buildErrorStateHtml` -- the SAME `.error-state` markup/classes (icon +
// message + Retry button), but built via `createElement`/`textContent`
// ONLY, for this file's own stricter "never `.innerHTML`" discipline (see
// `buildSkeletonRows`'s comment above for why the shared HTML-string
// builder can't be reused here). Returns `{ node, retryBtn }` so the caller
// wires the Retry click directly off the real button reference -- no
// `querySelector` round-trip needed (unlike main.js's string-based
// equivalent, which has no other way to reach the button after an
// `innerHTML` assignment).
function buildErrorStateNode(message, doc) {
  const d = doc || document;
  const node = d.createElement('div');
  node.className = 'error-state';

  const icon = d.createElement('i');
  icon.className = 'icon-refresh error-state-icon';
  icon.setAttribute('aria-hidden', 'true');
  node.appendChild(icon);

  const messageEl = d.createElement('p');
  messageEl.className = 'error-state-message';
  messageEl.textContent = (typeof message === 'string' && message) ? message : 'Something went wrong.';
  node.appendChild(messageEl);

  const retryBtn = d.createElement('button');
  retryBtn.setAttribute('type', 'button');
  retryBtn.className = 'btn error-state-retry';
  retryBtn.textContent = 'Retry';
  node.appendChild(retryBtn);

  return { node, retryBtn };
}

/**
 * Build the full list (or an empty-state message) as a single container
 * node. Callers own replacing the target container's previous contents --
 * this function only ever builds, never clears/mutates anything else.
 * `statusSnapshot` (optional) is the `{subscriptions, oneShots}` object from
 * `GET /api/subscriptions/status` -- each row's own `LiveEntry` (keyed by
 * `sub.id`) is looked up and threaded into `createSubscriptionRow`. When
 * `subs` is non-empty, `container.children[i]` corresponds to `subs[i]`, in
 * order -- the live wiring below relies on this to build `rowElementsById`
 * for `applyStatusUpdatesInPlace` without any extra bookkeeping here.
 * `pinnedChannelDirs` (v1.21.0 FR-5, optional) is a `Set` of every currently
 * pinned `channelDir` (from `GET /api/subscriptions/pins`) -- each row's
 * `pinned` flag is derived here (`pinnedChannelDirs.has(sub.channelDir)`) so
 * `createSubscriptionRow` itself never needs to know about pins as anything
 * but a plain boolean.
 */
function createSubscriptionsListElement(subs, doc, handlers, statusSnapshot, pinnedChannelDirs) {
  const d = doc || document;
  const container = d.createElement('div');
  if (!subs || subs.length === 0) {
    const empty = d.createElement('div');
    empty.setAttribute('style', 'color:var(--text-secondary); font-style:italic; padding:8px 4px;');
    empty.textContent = 'No subscriptions yet. Add a channel below to get started.';
    container.appendChild(empty);
    return container;
  }
  const liveSubs = (statusSnapshot && statusSnapshot.subscriptions) || {};
  const pinnedSet = pinnedChannelDirs instanceof Set ? pinnedChannelDirs : new Set();
  subs.forEach((sub) => {
    const liveEntry = sub && sub.id ? liveSubs[sub.id] : undefined;
    const pinned = !!(sub && typeof sub.channelDir === 'string' && sub.channelDir !== '' && pinnedSet.has(sub.channelDir));
    container.appendChild(createSubscriptionRow(sub, d, handlers, liveEntry, pinned));
  });
  return container;
}

/**
 * Build one transient one-shot job row (FR-A/FR-E) -- there is no persisted
 * subscription record backing this, only the ephemeral `LiveEntry` from
 * `GET /api/subscriptions/status`'s `oneShots` namespace. `handlers` =
 * `{ onDismiss(jobId) }`.
 */
function createOneShotRow(jobId, entry, doc, handlers) {
  const d = doc || document;
  const h = handlers || {};
  const row = d.createElement('div');
  // v1.13.0 item 1/6: same dedicated row layout as createSubscriptionRow
  // above -- see its comment for the full rationale.
  row.className = 'sub-row';

  const info = d.createElement('div');
  info.className = 'sub-row-info';

  const labelEl = d.createElement('div');
  labelEl.className = 'sub-row-name';
  // SECURITY: `entry.label` is the (operator-supplied, but still
  // server-persisted/echoed) folder name -- textContent only.
  labelEl.textContent = (entry && entry.label) || 'One-Off';
  info.appendChild(labelEl);

  const urlEl = d.createElement('div');
  urlEl.className = 'sub-row-url';
  // SECURITY: `entry.url` is only ever set to an already-validated
  // single-video YouTube watch URL (lib/ytdlp/index.js) -- still textContent,
  // never innerHTML, matching this file's blanket discipline.
  urlEl.textContent = (entry && entry.url) || '';
  info.appendChild(urlEl);

  const statusEl = d.createElement('div');
  statusEl.className = 'sub-row-status';
  // SECURITY: `entry.error` can carry a redacted-but-server-composed error
  // string -- textContent only.
  statusEl.textContent = formatLiveStatusText(entry) || (entry && entry.state) || 'queued';
  info.appendChild(statusEl);

  row.appendChild(info);

  const actions = d.createElement('div');
  actions.className = 'sub-row-actions';

  const dismissBtn = d.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'remove-folder-btn';
  dismissBtn.title = 'Dismiss';
  dismissBtn.textContent = '×';
  dismissBtn.addEventListener('click', () => {
    if (typeof h.onDismiss === 'function') h.onDismiss(jobId);
  });
  actions.appendChild(dismissBtn);

  row.appendChild(actions);
  return row;
}

/**
 * v1.26 code-review fix (F7): a cheap, deterministic STRING signature of
 * exactly the fields `createOneShotRow` actually renders (jobId + label +
 * url + the live status text) for the given (already client-dismiss-
 * filtered) `oneShots` map -- NOT a generic `JSON.stringify` of the whole
 * `LiveEntry`, which would also fire on fields that never render (e.g.
 * `format`/`quality`/`filetype`, only ever read on a Retry re-POST) and
 * defeat the point of skipping unnecessary rebuilds. Order-independent
 * (sorted by jobId) so an object whose KEY insertion order merely changed
 * between two otherwise-identical polls still compares equal. Used by
 * `renderOneShots` (below) to skip a full teardown+rebuild of the one-shot
 * list on every ~2.5s poll tick when NOTHING about it actually changed --
 * same disease class as F2 (the download-status chip's panel), just fixed
 * at the cheaper "skip the whole rebuild when unchanged" level rather than a
 * full per-row in-place diff (this list has no progress bar/animation to
 * protect, only a Dismiss button, so this is the cheapest fix that still
 * closes the unnecessary-DOM-churn/lost-tap risk).
 */
function computeOneShotsSignature(oneShots) {
  if (!oneShots || typeof oneShots !== 'object') return '';
  return Object.keys(oneShots).sort().map((jobId) => {
    const entry = oneShots[jobId];
    const label = (entry && typeof entry.label === 'string') ? entry.label : '';
    const url = (entry && typeof entry.url === 'string') ? entry.url : '';
    const statusText = formatLiveStatusText(entry) || (entry && entry.state) || 'queued';
    return jobId + '|' + label + '|' + url + '|' + statusText;
  }).join('\n');
}

/**
 * v1.26 code-review fix (F7): the render-skip decision + DOM update
 * `renderOneShots` (below) uses on every ~2.5s poll tick -- computes this
 * tick's signature (`computeOneShotsSignature`), and ONLY tears down +
 * rebuilds `container`'s content when it differs from `prevSignature` (the
 * value this same function returned on the PRIOR call). Returns the
 * signature the caller should pass back in as `prevSignature` next time.
 * Exported/`node:test`-covered directly against a fake `container` +
 * `doc` -- no real browser or full page-controller harness needed to prove
 * the "unchanged snapshot -> zero DOM churn" invariant (same child node(s)
 * across two calls).
 */
function updateOneShotsContainer(container, oneShots, doc, handlers, prevSignature) {
  const signature = computeOneShotsSignature(oneShots);
  if (signature === prevSignature) return prevSignature;
  clearChildren(container);
  container.appendChild(createOneShotsListElement(oneShots, doc, handlers));
  return signature;
}

/**
 * Build the full one-shot jobs list (or nothing, when there are none) as a
 * single container node. `oneShots` is a plain `{jobId: LiveEntry}` object
 * (already filtered by the caller to exclude client-dismissed jobs) --
 * mirrors `createSubscriptionsListElement`'s "callers own replacing the
 * container" contract.
 */
function createOneShotsListElement(oneShots, doc, handlers) {
  const d = doc || document;
  const container = d.createElement('div');
  const entries = oneShots && typeof oneShots === 'object' ? Object.entries(oneShots) : [];
  if (entries.length === 0) {
    const empty = d.createElement('div');
    empty.setAttribute('style', 'color:var(--text-secondary); font-style:italic; padding:8px 4px;');
    empty.textContent = 'No one-off downloads in progress.';
    container.appendChild(empty);
    return container;
  }
  entries.forEach(([jobId, entry]) => container.appendChild(createOneShotRow(jobId, entry, d, handlers)));
  return container;
}

// Removes all children of `el` without ever touching innerHTML -- kept
// consistent with this file's textContent-only discipline even though
// clearing to '' would carry no interpolation risk either way.
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ---- Live page wiring (guarded so requiring this file in Node is inert) ----
//
// Registered VIEW MODULE (FR-1, T1): this file is lazy-loaded by the SPA-lite
// router (common.js's ensureSubscriptionsScriptLoaded) only on the first
// in-app navigation to `/subscriptions` (which can only happen when the
// optional module is enabled — see the disabled no-op note there), OR loaded
// normally via this page's own `<script>` tag on a full page load/deep link.
// Either way it self-registers with `FileTube.registerView('subscriptions',
// ...)` at parse time and relies ENTIRELY on the router (or, on a full load,
// common.js's `bootRouter`) to call `init(root)` — the SAME code path a swap
// uses, so re-visiting `/subscriptions` after navigating away re-wires a
// fresh view correctly instead of silently doing nothing. All listeners are
// registered through one per-view AbortController so `destroy()` (called on
// navigate-away) removes them in one call and stops the live status poller —
// no leaks, no stray polling against a torn-down page.

let subscriptionsController = null;
let subscriptionsStatusPollTimer = null;
// C5 remediation (v1.16.0): tracks the one-shot post-repull `loadSubscriptions`
// refresh timers (repullOne/repullAllBtn, below) so destroy() can clear any
// still-pending ones outright -- on top of each callback's own `signal.aborted`
// re-check -- instead of letting them fire into a detached, closure-captured
// container after the view has been torn down (navigated away).
let repullRefreshTimers = new Set();
// v1.21.0 FR-3: the currently-open settings bottom-sheet's top-level DOM
// node (or null) -- module-scope (not nested in initSubscriptionsView) so
// destroySubscriptionsView can remove a still-open sheet on navigate-away
// without leaking it into the next view. A singleton by construction
// (openSettingsSheet always closes any prior one first) and NEVER
// referenced by rowElementsById/listContainer -- see buildSettingsSheet's
// doc comment for why that is what makes it immune to a poll rebuild.
let openSheetNode = null;

/**
 * v1.26.2 polish (Dean punchlist -- sheet/modal transitions): pre-fix, this
 * removed the whole `.sub-sheet-backdrop` subtree synchronously -- an
 * instant teleport-out, same class of issue `openOverlay`/`closeOverlayThen`
 * (public/js/common.js, a plain global here since common.js loads first as
 * a classic script -- same bare-global posture as `showHardDeleteModal`/
 * `nextArmState`) fix uniformly for every sheet/modal in the app. The inner
 * `.sub-sheet` slides down and the `.sub-sheet-backdrop` fades out
 * (`style.css`'s `.sheet-open` rules); the node is only actually detached
 * once the SHEET's own slide-down transition finishes (or the helper's
 * timeout fallback fires) -- never before, so there is no possible
 * stuck-half-animated frame. `openSheetNode` is nulled out immediately
 * (not after the animation) so a rapid re-open (`openSettingsSheet` always
 * calls this first) can never observe/race the still-fading-out node.
 */
function closeSettingsSheet() {
  if (!openSheetNode) return;
  const nodeToRemove = openSheetNode;
  const sheetEl = nodeToRemove.querySelector ? nodeToRemove.querySelector('.sub-sheet') : null;
  openSheetNode = null;
  closeOverlayThen(sheetEl, 'sheet-open', () => {
    if (nodeToRemove.parentNode) nodeToRemove.parentNode.removeChild(nodeToRemove);
  });
  closeOverlayThen(nodeToRemove, 'sheet-open', () => {});
}

function initSubscriptionsView(root) {
  subscriptionsController = new AbortController();
  const { signal } = subscriptionsController;

  const listContainer = document.getElementById('sub-list-container');
  const addUrlInput = document.getElementById('sub-add-url');
  const addFormatSelect = document.getElementById('sub-add-format');
  const addQualitySelect = document.getElementById('sub-add-quality');
  const addFiletypeSelect = document.getElementById('sub-add-filetype');
  // v1.25 QoL (T5): replaces the retired `sub-add-maxvideos` count field.
  const addCutoffDateInput = document.getElementById('sub-add-cutoffdate');
  // v1.22.0 FR-6: max-duration download gate override, add-subscription form.
  const addMaxDurationInput = document.getElementById('sub-add-maxduration');
  const addBtn = document.getElementById('sub-add-btn');
  const addError = document.getElementById('sub-add-error');
  const addSkipShortsCheck = document.getElementById('sub-add-skipshorts');
  const membersOnlyCheck = document.getElementById('sub-members-only-check');
  const membersOnlyError = document.getElementById('sub-members-only-error');
  const repullAllBtn = document.getElementById('sub-repull-all-btn');
  const repullStatus = document.getElementById('sub-repull-status');

  // v1.25 QoL follow-up ("reheat"): see this file's top-of-section comment
  // above `REHEAT_ACTIVITY_ID` for the full design. `reheatElements` is
  // handed to `applyReheatStateToControls`/`triggerReheat`/
  // `triggerReheatCancel` (all pure/DOM-only or fetch-only functions) rather
  // than each of those functions reaching into `document` itself, keeping
  // them unit-testable the same way `applyStatusUpdatesInPlace` already is.
  const reheatElements = {
    button: document.getElementById('sub-reheat-btn'),
    status: document.getElementById('sub-reheat-status'),
    cancelButton: document.getElementById('sub-reheat-cancel-btn'),
  };

  // v1.25.5 QoL follow-up (channel avatars, round 2): mirrors
  // `reheatElements` immediately above -- same element-refs-in, DOM-only/
  // fetch-only functions posture.
  const refreshAvatarsElements = {
    button: document.getElementById('sub-refresh-avatars-btn'),
    status: document.getElementById('sub-refresh-avatars-status'),
    cancelButton: document.getElementById('sub-refresh-avatars-cancel-btn'),
  };

  const oneShotListContainer = document.getElementById('oneshot-list-container');
  const oneShotUrlInput = document.getElementById('oneshot-url');
  const oneShotFormatSelect = document.getElementById('oneshot-format');
  const oneShotQualitySelect = document.getElementById('oneshot-quality');
  const oneShotFiletypeSelect = document.getElementById('oneshot-filetype');
  const oneShotFolderInput = document.getElementById('oneshot-folder');
  const oneShotDownloadBtn = document.getElementById('oneshot-download-btn');
  const oneShotError = document.getElementById('oneshot-error');
  const oneShotStatus = document.getElementById('oneshot-status');

  // Mirrors setup.html's own setFieldError helper: shows/clears a
  // field-level validation message next to a control. `message` is always
  // a server- or client-composed error STRING assigned via textContent --
  // never innerHTML (same discipline as the rest of this file).
  function setFieldError(el, message) {
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.style.display = 'block';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  // ---- FR-E: cached list + live snapshot -----------------------------------
  //
  // The subscription LIST itself (`GET /api/subscriptions`) is only
  // re-fetched on explicit actions (initial load, add/edit/delete/re-pull);
  // the ~2.5s poll only ever hits the cheap, dedicated
  // `GET /api/subscriptions/status` endpoint. v1.21.0 FR-1 fix: the poll no
  // longer re-renders the list at all -- it calls `applyStatusUpdatesInPlace`
  // against `rowElementsById` (built the one time `renderSubscriptions()`
  // actually runs) so it only ever mutates each row's `.sub-row-status` text.
  let currentSubs = [];
  let latestSnapshot = { subscriptions: {}, oneShots: {} };
  const dismissedOneShotIds = new Set();
  // v1.26 code-review fix (F7): the signature (`computeOneShotsSignature`)
  // of the LAST one-shot list actually rendered -- `null` until the first
  // render. `renderOneShots` below skips its teardown+rebuild entirely when
  // this poll tick's signature is identical, closing the same "rebuilds
  // every ~2.5s tick even when nothing changed" defect class F2 fixes for
  // the download-status chip.
  let lastOneShotsSignature = null;
  // Populated by renderSubscriptions() below; keyed by subscription id.
  let rowElementsById = {};
  // v1.21.0 FR-5: channelDir -> the persisted pin record `{id, channelDir,
  // label, pinnedAt}` for every currently-pinned channel (from
  // `GET /api/subscriptions/pins`). Keyed by `channelDir` (NOT the pin's own
  // `id`, which hashes `channelDir` -- see store.js) because that is what a
  // row already has on hand (`sub.channelDir`) to look itself up by; the
  // pin's own `id` is only needed at DELETE time (`togglePin` below reads it
  // back out of this map). Refreshed by `loadPins()`, consumed by
  // `renderSubscriptions()`.
  let currentPinsByChannelDir = new Map();

  // v1.29.0 T9 (R4.1-R4.4): the download-history section's own state --
  // `historyListEl` is the persistent `.sub-list` node `createHistorySectionElement`
  // built (populated/repopulated by `renderHistorySection`, mirroring how
  // `listContainer` itself is a persistent node `renderSubscriptions`
  // clears+repopulates); `null` until `mountHistorySection` runs (once, on
  // init) or if `#sub-list-container` itself is absent from the page (no
  // anchor to mount relative to -- defensive, unreachable on the real
  // subscriptions.html). `historyController` is the DOM-free fetch
  // orchestrator (`createHistoryRefreshController` above) -- passed the REAL
  // `window.fetch` here; every OTHER call site in this file uses a bare
  // `fetch(...)` call instead of going through this injectable seam, but
  // this controller specifically needs one so its "fetch-once + terminal-
  // transition re-fetch" decision logic (`detectNewlyTerminalRuns`) can be
  // unit-tested without any DOM at all.
  let historyListEl = null;
  const historyController = createHistoryRefreshController(
    typeof fetch === 'function' ? fetch : undefined
  );

  // `openSheetNode`/`closeSettingsSheet` are module-scope (above) so
  // destroySubscriptionsView can close a still-open sheet on navigate-away.

  // v1.29.0 T9 (R4.1): mounts the history section's DOM ONCE, dynamically,
  // relative to the EXISTING `#sub-list-container` -- never by editing
  // `lib/ytdlp/views/subscriptions.html` (a shell file this task does not
  // touch). Inserted as the next sibling of `#sub-list-container`'s OWN
  // `.setup-box` wrapper (i.e. "after the subscriptions list's section"), so
  // the history section reads as its own peer card below "Your
  // subscriptions" rather than nesting a second `.setup-box` inside the
  // first. Falls back to inserting directly after `listContainer` itself if
  // no `.setup-box` ancestor is found (defensive; every real page has one).
  // A no-op if `listContainer` itself is absent (module disabled/page
  // markup missing -- AC2.4's "no rendered history" half) or if already
  // mounted (re-entrant-safe, though `initSubscriptionsView` only ever calls
  // this once per view instance).
  function mountHistorySection() {
    if (!listContainer || historyListEl) return;
    const { section, list } = createHistorySectionElement(document);
    const anchor = (typeof listContainer.closest === 'function' && listContainer.closest('.setup-box'))
      || listContainer;
    if (anchor && typeof anchor.insertAdjacentElement === 'function') {
      anchor.insertAdjacentElement('afterend', section);
    } else if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(section, anchor.nextSibling);
    }
    historyListEl = list;
  }

  // v1.31 P2/P6: the breaker banner (above the subscriptions list) and the
  // yt-dlp version footer (below it). Mounted DYNAMICALLY relative to the
  // existing `#sub-list-container` -- never by editing subscriptions.html
  // (the same shell-untouched discipline as `mountHistorySection` above) --
  // and reusing existing class families only (`.sub-row-failures` for the
  // red banner text, `.sub-row-meta` for the muted footer): no new CSS.
  let breakerBannerEl = null;
  let versionFooterEl = null;
  function mountHardeningStrip() {
    if (!listContainer || breakerBannerEl) return;
    const anchor = (typeof listContainer.closest === 'function' && listContainer.closest('.setup-box'))
      || listContainer;
    breakerBannerEl = document.createElement('div');
    breakerBannerEl.className = 'sub-row-failures sub-breaker-banner';
    breakerBannerEl.hidden = true;
    versionFooterEl = document.createElement('div');
    versionFooterEl.className = 'sub-row-meta sub-ytdlp-version';
    versionFooterEl.hidden = true;
    if (anchor && typeof anchor.insertAdjacentElement === 'function') {
      anchor.insertAdjacentElement('beforebegin', breakerBannerEl);
      anchor.insertAdjacentElement('afterend', versionFooterEl);
    } else if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(breakerBannerEl, anchor);
      anchor.parentNode.insertBefore(versionFooterEl, anchor.nextSibling);
    }
  }
  function updateHardeningStrip(snapshot) {
    if (!breakerBannerEl) return;
    const bannerText = formatBreakerBannerText(snapshot && snapshot.breaker);
    breakerBannerEl.textContent = bannerText; // server-composed -- textContent only
    breakerBannerEl.hidden = bannerText === '';
    const versionText = formatYtdlpVersionText(snapshot && snapshot.ytdlpVersion);
    versionFooterEl.textContent = versionText;
    versionFooterEl.hidden = versionText === '';
  }

  // v1.29.0 T9 (R4.1): repopulates the mounted history section from
  // `entries` (a `GET /api/subscriptions/history` response's `entries`
  // array, already newest-first) -- clear-then-rebuild, exactly like
  // `renderSubscriptions()`'s own full-rebuild treatment of `listContainer`
  // (the history section has no in-place-update surface to protect, unlike
  // the live subscriptions list's open-edit-sheet concern that motivated
  // `applyStatusUpdatesInPlace` in the first place). A no-op before
  // `mountHistorySection` has run (or if it never found an anchor).
  function renderHistorySection(entries) {
    if (!historyListEl) return;
    clearChildren(historyListEl);
    historyListEl.appendChild(createHistoryListElement(entries, document));
  }

  // v1.29.0 T9 (R4.1): the view-load "fetch once" half of the EM's ratified
  // cadence -- called a single time from this function's own init tail,
  // below. The terminal-transition "re-fetch" half lives inside
  // `pollStatusOnce` (see that function's own T9 addition), riding the
  // EXISTING ~2.5s poll rather than a second timer.
  function loadHistorySection() {
    historyController.loadInitial().then((entries) => {
      if (signal.aborted) return;
      renderHistorySection(entries);
    });
  }

  function openSettingsSheet(sub) {
    closeSettingsSheet();
    openSheetNode = buildSettingsSheet(sub, document, {
      onClose: closeSettingsSheet,
      onTogglePause: (s) => togglePause(s, closeSettingsSheet),
      onRepull: (id) => repullOne(id),
      onDelete: (s) => confirmAndDelete(s, closeSettingsSheet),
      onSave: (id, patch) => saveEdit(id, patch, closeSettingsSheet),
    });
    document.body.appendChild(openSheetNode);
    // v1.26.2 polish (Dean punchlist -- sheet/modal transitions): slide the
    // inner `.sub-sheet` up + fade the `.sub-sheet-backdrop` in, mirroring
    // closeSettingsSheet's animated teardown above -- see openOverlay's own
    // doc comment (common.js) for the two-step-reveal mechanics.
    openOverlay(openSheetNode, 'sheet-open');
    const sheetEl = openSheetNode.querySelector('.sub-sheet');
    openOverlay(sheetEl, 'sheet-open');
  }

  function handleRowTap(sub) {
    if (!sub || typeof sub.channelDir !== 'string' || sub.channelDir === '') return;
    if (window.FileTube && typeof window.FileTube.navigate === 'function') {
      window.FileTube.navigate('/?root=' + encodeURIComponent(sub.channelDir));
    }
  }

  // v1.21.0 FR-3: FULL rebuild -- only ever called after an explicit action
  // (initial load, add/edit/delete/pause/re-pull success), NEVER by the
  // ~2.5s live-status poll (see pollStatusOnce's targeted update instead).
  // Rebuilds `rowElementsById` from the freshly-built container's children,
  // which are in the same order as `currentSubs` (createSubscriptionsListElement's
  // documented contract).
  function renderSubscriptions() {
    if (!listContainer) return;
    clearChildren(listContainer);
    const container = createSubscriptionsListElement(currentSubs, document, {
      onRowTap: handleRowTap,
      onOpenSettings: openSettingsSheet,
      onTogglePin: togglePin,
      // v1.29.0 T6 (R1.1/R1.2): the SAME `repullOne(id)` the settings sheet's
      // own Re-pull button already calls (below) -- now ALSO reachable
      // directly from an error/partial row's own Retry button
      // (`createSubscriptionRow`'s `shouldShowRetryButton` gate). Returns the
      // Promise `repullOne` resolves to (T5's parsed repull-route response
      // body) so the row can render the R1.5 "queued behind current run"
      // state -- the settings sheet's own `onRepull` caller ignores this
      // return value entirely, so it keeps working unchanged.
      onRepull: (id) => repullOne(id),
    }, latestSnapshot, new Set(currentPinsByChannelDir.keys()));
    listContainer.appendChild(container);
    rowElementsById = {};
    currentSubs.forEach((sub, index) => {
      if (sub && sub.id && container.children[index]) rowElementsById[sub.id] = container.children[index];
    });
    // B4 (v1.24.0, T6, FR-8): (re-)wire drag-and-drop on every full rebuild --
    // a fresh set of `.sub-row` elements needs fresh listeners each time,
    // exactly like main.js's sidebar-folder DnD re-wires after every
    // renderSidebarFolders() call.
    wireSubRowDragAndDrop();
  }

  // B4 (v1.24.0, T6, FR-8): drag-and-drop reorder for the subscriptions
  // management list -- mirrors main.js's `renderSidebarFolders` DnD wiring
  // (v1.15.0 item 1) as closely as this page's own row anatomy allows:
  // native HTML5 `dragstart`/`dragover`/`dragleave`/`drop`/`dragend`, a
  // drop-before/after half-height indicator (`computeDropIndex`'s own
  // contract), and an immediate persist on drop (no separate Save step --
  // there is none on this list, matching the sidebar's own "no Save button"
  // posture). Reuses `moveArrayItem`/`computeDropIndex` from
  // `public/js/common.js` VERBATIM, `window.`-qualified (both files load as
  // plain, non-module `<script>` tags on the same page -- see
  // subscriptions.html's script order -- so `window.moveArrayItem` IS the
  // exact same function common.js defines; qualifying it this way also
  // avoids needing an eslint.config.js globals-declaration edit, which is
  // outside this task's owned-file list) -- no forked reimplementation, no
  // new common.js helper (per the exec plan's explicit W2 partition note).
  // DOM drag events are untestable-by-necessity (Dean's on-device pass is
  // the arbiter, mirroring test/integration/folder-dnd-order.test.js's own
  // documented rationale) -- the underlying `moveArrayItem`/`computeDropIndex`
  // are already unit-tested in test/unit/folder-dnd-reorder.test.js, and the
  // server-side persistence this drop ultimately POSTs to is proven
  // end-to-end by T8's test/integration/ytdlp-reorder-poll-timing.test.js.
  function wireSubRowDragAndDrop() {
    if (!listContainer || typeof listContainer.querySelectorAll !== 'function') return;
    const rows = Array.prototype.slice.call(listContainer.querySelectorAll('.sub-row[data-sub-id]'));
    let dragSrcIndex = null;
    rows.forEach((rowEl, index) => {
      rowEl.addEventListener('dragstart', (e) => {
        dragSrcIndex = index;
        rowEl.classList.add('sub-row-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          // Firefox requires data to be set for the drag to initiate at all
          // (mirrors main.js's identical sidebar-folder DnD workaround).
          e.dataTransfer.setData('text/plain', String(index));
        }
      }, { signal });
      rowEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const rect = rowEl.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        rowEl.classList.toggle('sub-row-drag-over-before', before);
        rowEl.classList.toggle('sub-row-drag-over-after', !before);
      }, { signal });
      rowEl.addEventListener('dragleave', () => {
        rowEl.classList.remove('sub-row-drag-over-before', 'sub-row-drag-over-after');
      }, { signal });
      rowEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const before = rowEl.classList.contains('sub-row-drag-over-before');
        rowEl.classList.remove('sub-row-drag-over-before', 'sub-row-drag-over-after');
        const fromIndex = dragSrcIndex;
        dragSrcIndex = null;
        if (fromIndex === null || Number.isNaN(index)) return;
        // `window.`-qualified (rather than bare identifiers): common.js's
        // globals-declaration eslint override only covers public/js/*.js's
        // consumers today, and this file's own T6 scope is limited to
        // THIS file (no eslint.config.js edit) -- `window.computeDropIndex`/
        // `window.moveArrayItem` are the SAME function objects common.js
        // attaches to the global scope (both load as plain, non-module
        // `<script>` tags on the same page -- see subscriptions.html's
        // script order), reused verbatim either way.
        const toIndex = window.computeDropIndex(fromIndex, index, before);
        const reordered = window.moveArrayItem(currentSubs, fromIndex, toIndex);
        persistReorder(reordered.map((s) => s && s.id).filter((id) => typeof id === 'string' && id !== ''));
      }, { signal });
      rowEl.addEventListener('dragend', () => {
        dragSrcIndex = null;
        rows.forEach((r) => r.classList.remove('sub-row-dragging', 'sub-row-drag-over-before', 'sub-row-drag-over-after'));
      }, { signal });
    });
  }

  // POSTs the dragged order to T8's `POST /api/subscriptions/reorder`, which
  // responds with the SAME reordered+enriched shape `GET /api/subscriptions`
  // returns -- replace `currentSubs` wholesale with it and do a full rebuild
  // (simplest correct way to reflect the server's authoritative order,
  // including its own unknown-id/tail-position tolerance -- see
  // `store.reduceReorder`'s doc comment). A failed request reloads from the
  // server instead of trusting the optimistic client-side order, so a
  // rejected/errored drag can never leave the on-screen list silently
  // diverged from what is actually persisted.
  function persistReorder(orderedIds) {
    fetch('/api/subscriptions/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('reorder failed with status ' + r.status))))
      .then((subs) => {
        currentSubs = Array.isArray(subs) ? subs : [];
        renderSubscriptions();
      })
      .catch((err) => {
        console.error('Reorder failed:', err);
        loadSubscriptions();
      });
  }

  function renderOneShots() {
    if (!oneShotListContainer) return;
    const visible = {};
    Object.entries(latestSnapshot.oneShots || {}).forEach(([jobId, entry]) => {
      if (!dismissedOneShotIds.has(jobId)) visible[jobId] = entry;
    });
    // v1.26 code-review fix (F7): `updateOneShotsContainer` skips the
    // teardown+rebuild entirely when the rendered fields haven't actually
    // changed since the last render (`computeOneShotsSignature`). A dismiss
    // always changes the signature on its own (the dismissed jobId drops out
    // of `visible` above), so no separate invalidation is needed in the
    // `onDismiss` handler below.
    lastOneShotsSignature = updateOneShotsContainer(oneShotListContainer, visible, document, {
      onDismiss: (jobId) => {
        dismissedOneShotIds.add(jobId);
        renderOneShots();
      },
    }, lastOneShotsSignature);
  }

  function loadSubscriptions() {
    if (!listContainer) return;
    // Item 1 (v1.26.3): skeleton rows immediately, before the fetch below
    // even starts -- same "kill the blank-then-pop window" treatment as the
    // home grid (see buildSkeletonRows's own comment). A Retry click (below)
    // re-invokes this same function, so it gets a fresh skeleton too rather
    // than leaving the stale error card up while the retry is in flight.
    // `clearChildren`/`appendChild` only -- never `.innerHTML =` (this
    // file's file-wide discipline; see buildSkeletonRows's own comment).
    clearChildren(listContainer);
    buildSkeletonRows(5).forEach((row) => listContainer.appendChild(row));
    fetch('/api/subscriptions')
      .then((r) => r.json())
      .then((subs) => {
        currentSubs = Array.isArray(subs) ? subs : [];
        renderSubscriptions();
      })
      .catch((err) => {
        // Item 3 (v1.26.3): the shared-LOOK `.error-state` card (replaces
        // the old bare inline-styled red text) with a real Retry affordance
        // that re-invokes THIS SAME `loadSubscriptions()`. Built via
        // `buildErrorStateNode` (this file's own createElement-only twin of
        // common.js's `buildErrorStateHtml` -- see its comment for why the
        // shared string builder can't be reused here) so the Retry listener
        // binds directly off the real button reference. Bound via this
        // view's per-instance `signal` (same AbortController every other
        // listener in this file uses), so a retry click can never fire
        // against an already-torn-down (navigated-away-from) instance.
        clearChildren(listContainer);
        const { node, retryBtn } = buildErrorStateNode('Failed to load subscriptions.');
        listContainer.appendChild(node);
        retryBtn.addEventListener('click', () => loadSubscriptions(), { signal });
        console.error('Failed to load subscriptions:', err);
      });
  }

  function loadMembersOnlySetting() {
    if (!membersOnlyCheck) return;
    fetch('/api/subscriptions/settings')
      .then((r) => r.json())
      .then((s) => { membersOnlyCheck.checked = !!s.allowMembersOnly; })
      .catch((err) => console.error('Failed to load subscription settings:', err));
  }

  // v1.21.0 FR-5: refresh `currentPinsByChannelDir` from
  // `GET /api/subscriptions/pins`. A non-OK response (the module is disabled
  // -- unreachable in practice on THIS already-gated page, but defensive
  // regardless -- or a transient server error) resolves to an EMPTY map
  // rather than rejecting, so a pin-fetch hiccup degrades to "nothing shows
  // as pinned" instead of breaking the subscriptions list render. Returns the
  // promise so callers can sequence a render after it resolves.
  function loadPins() {
    return fetch('/api/subscriptions/pins')
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((pins) => {
        currentPinsByChannelDir = new Map();
        (Array.isArray(pins) ? pins : []).forEach((pin) => {
          if (pin && typeof pin.channelDir === 'string' && pin.channelDir !== '') {
            currentPinsByChannelDir.set(pin.channelDir, pin);
          }
        });
      });
  }

  // C5 remediation (v1.16.0): schedules a ONE-SHOT `loadSubscriptions()`
  // refresh, tracked in `repullRefreshTimers` (so destroy() can clear it
  // outright) and re-checked against `signal.aborted` INSIDE the callback
  // (the view can be torn down during the delay) so it can never fetch/render
  // into a detached, closure-captured `listContainer` after navigate-away.
  function scheduleRepullRefresh(delayMs) {
    const timer = setTimeout(() => {
      repullRefreshTimers.delete(timer);
      if (signal.aborted) return;
      loadSubscriptions();
    }, delayMs);
    repullRefreshTimers.add(timer);
  }

  // v1.29.0 T6 (R1.1/R1.2, R1.5): now RETURNS a Promise resolving to T5's
  // parsed repull-route response body (`{accepted, started, reason?}`), or
  // `null` for a non-OK response/unparseable body/network failure -- the row
  // Retry button's own handler (`createSubscriptionRow`) inspects this to
  // render the AC3.5 "queued behind current run" state via
  // `isQueuedRepullResponse`. The settings-sheet Re-pull button
  // (`buildSettingsSheet`'s `onRepull` wiring above) calls this exact same
  // function but never reads/awaits its return value, so it keeps working
  // completely unchanged -- this is purely an ADDITIVE return value, not a
  // behavior change to the existing fire-and-forget callers.
  function repullOne(id) {
    if (!id) return Promise.resolve(null);
    return fetch('/api/subscriptions/' + encodeURIComponent(id) + '/repull', { method: 'POST' })
      .then((r) => {
        if (repullStatus) {
          repullStatus.textContent = r.ok ? 'Re-pull requested…' : 'Re-pull could not be started.';
        }
        // No queue/progress viz needed here beyond the live poll -- just
        // refresh the persisted list once shortly after, so a quick
        // re-check's terminal status has a chance to land too.
        scheduleRepullRefresh(1500);
        return r.ok ? r.json().catch(() => null) : null;
      })
      .catch((err) => {
        if (repullStatus) repullStatus.textContent = 'Re-pull request failed.';
        console.error('Re-pull-one failed:', err);
        return null;
      });
  }

  function togglePause(sub, onSuccess) {
    if (!sub || !sub.id) return;
    fetch('/api/subscriptions/' + encodeURIComponent(sub.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: !sub.paused }),
    })
      .then((r) => r.json())
      .then(() => {
        loadSubscriptions();
        if (typeof onSuccess === 'function') onSuccess();
      })
      .catch((err) => console.error('Pause/resume toggle failed:', err));
  }

  // v1.21.0 FR-5 (AC35/AC37): the star toggle's click handler --
  // `POST`/`DELETE /api/subscriptions/pins` (server-persisted, survives a
  // restart per AC37), then re-fetches BOTH pins and the row's own render so
  // the star's filled/outline state reflects reality rather than being
  // optimistically flipped client-side. `pinned` is the row's CURRENT state
  // (handed in by `createSubscriptionRow`'s click listener) -- unpin when
  // already pinned, pin when not.
  function togglePin(sub, pinned) {
    if (!sub || typeof sub.channelDir !== 'string' || sub.channelDir === '') return;
    const request = pinned
      ? (() => {
        const existing = currentPinsByChannelDir.get(sub.channelDir);
        if (!existing || !existing.id) return Promise.resolve(); // nothing to delete -- already effectively unpinned
        return fetch('/api/subscriptions/pins/' + encodeURIComponent(existing.id), { method: 'DELETE' });
      })()
      : fetch('/api/subscriptions/pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelDir: sub.channelDir, label: resolvePinLabel(sub) }),
      })
        .then((res) => {
          // v1.21 FIX 4: surface a genuine pin failure (e.g. a 400 from a
          // confinement/validation error) instead of silently swallowing it
          // -- `fetch(...)` resolves (does not reject) on a 4xx/5xx, so this
          // must be checked explicitly rather than relying on `.catch`.
          if (!res.ok) {
            return res.json().catch(() => ({})).then((data) => {
              console.error('Pin failed:', (data && data.error) || res.status);
            });
          }
        });
    request
      .then(() => loadPins())
      .then(() => renderSubscriptions())
      .catch((err) => console.error('Pin toggle failed:', err));
  }

  // v1.21.0 FR-1/FR-3: saves a settings-sheet patch via the existing,
  // UNMODIFIED `PATCH /api/subscriptions/:id` -- the sheet is a separate DOM
  // node the poll never rebuilds (see buildSettingsSheet's doc comment), so
  // this is what makes the count edit (and every other field) actually
  // persist rather than silently reverting on the next poll tick (AC1-AC5).
  function saveEdit(id, patch, onSuccess) {
    if (!id) return;
    fetch('/api/subscriptions/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          console.error('Could not save subscription edit:', data.error || r.status);
          return;
        }
        loadSubscriptions();
        if (typeof onSuccess === 'function') onSuccess();
      })
      .catch((err) => console.error('Save edit failed (network error):', err));
  }

  function confirmAndDelete(sub, onSuccess) {
    if (!sub || !sub.id) return;
    // `window.confirm` renders its message as plain text (never parsed as
    // markup by the browser), so interpolating `sub.name`/`channelUrl`
    // here carries no XSS risk -- unlike common.js's `showConfirmModal`,
    // which builds its body via `innerHTML` and must never receive
    // user-derived text unescaped. This is why this confirmation
    // deliberately does NOT use `showConfirmModal`.
    const label = (sub.name || sub.channelUrl || 'this subscription');
    const confirmed = window.confirm(
      'Delete subscription "' + label + '"? This stops future checks; it does not re-download it.'
    );
    if (!confirmed) return;
    fetch('/api/subscriptions/' + encodeURIComponent(sub.id), { method: 'DELETE' })
      .then((r) => r.json())
      .then(() => {
        loadSubscriptions();
        if (typeof onSuccess === 'function') onSuccess();
      })
      .catch((err) => console.error('Delete failed:', err));
  }

  // v1.13.0 item 4: the add form's filetype/container select is
  // format-dependent -- whenever the format changes, rebuild its option
  // list from the CURRENT format (repopulateFiletypeSelect/
  // reduceFiletypeOptions), so it never offers a container that doesn't
  // apply (e.g. an audio codec while 'Video' is selected).
  if (addFormatSelect && addFiletypeSelect) {
    addFormatSelect.addEventListener('change', () => {
      repopulateFiletypeSelect(document, addFormatSelect.value, addFiletypeSelect);
    }, { signal });
  }

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const channelUrl = addUrlInput ? addUrlInput.value.trim() : '';
      const format = addFormatSelect ? addFormatSelect.value : 'video';
      const quality = addQualitySelect ? addQualitySelect.value : DEFAULT_QUALITY_OPTION;
      const filetype = addFiletypeSelect ? addFiletypeSelect.value : undefined;
      const rawMaxDuration = addMaxDurationInput ? addMaxDurationInput.value.trim() : '';
      setFieldError(addError, null);
      if (!channelUrl) {
        setFieldError(addError, 'Enter a channel URL.');
        return;
      }
      const body = { channelUrl, format, quality };
      if (filetype !== undefined) body.filetype = filetype;
      // v1.25 QoL (T5): blank (or invalid) means "omit -- let the server
      // default to yesterday" (store.js's `addSubscription`), same
      // blank-means-omit posture the retired `maxVideos` field used to have.
      const cutoffDate = inputValueToCutoffDate(addCutoffDateInput ? addCutoffDateInput.value : '');
      if (cutoffDate !== undefined) body.cutoffDate = cutoffDate;
      // v1.22.0 FR-6: same blank-means-omit posture as cutoffDate above.
      if (rawMaxDuration !== '') {
        const parsed = Number(rawMaxDuration);
        if (Number.isInteger(parsed) && parsed >= 0) body.maxDurationSeconds = parsed;
      }
      // v1.15.0 item 4: default unchecked (download everything) -- only
      // sent as an explicit boolean when the control is present.
      if (addSkipShortsCheck) body.skipShorts = addSkipShortsCheck.checked;
      fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) {
            // SECURITY: the server's validation error string is rendered
            // via setFieldError's textContent assignment above, never
            // innerHTML.
            setFieldError(addError, data.error || 'Could not add subscription.');
            return;
          }
          if (addUrlInput) addUrlInput.value = '';
          if (addCutoffDateInput) addCutoffDateInput.value = '';
          if (addMaxDurationInput) addMaxDurationInput.value = '';
          loadSubscriptions();
        })
        .catch((err) => {
          setFieldError(addError, 'Could not add subscription (network error).');
          console.error('Add subscription failed:', err);
        });
    }, { signal });
  }

  if (membersOnlyCheck) {
    membersOnlyCheck.addEventListener('change', (e) => {
      const desired = e.target.checked;
      fetch('/api/subscriptions/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowMembersOnly: desired }),
      })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) {
            setFieldError(membersOnlyError, data.error || 'Could not save setting.');
            membersOnlyCheck.checked = !desired; // revert the toggle on failure
            return;
          }
          setFieldError(membersOnlyError, null);
        })
        .catch((err) => {
          setFieldError(membersOnlyError, 'Could not save setting (network error).');
          membersOnlyCheck.checked = !desired;
          console.error('Failed to save members-only setting:', err);
        });
    }, { signal });
  }

  if (repullAllBtn) {
    repullAllBtn.addEventListener('click', () => {
      fetch('/api/subscriptions/repull', { method: 'POST' })
        .then((r) => {
          if (repullStatus) {
            repullStatus.textContent = r.ok ? 'Re-pull-all requested…' : 'Re-pull-all could not be started.';
          }
          scheduleRepullRefresh(1500);
        })
        .catch((err) => {
          if (repullStatus) repullStatus.textContent = 'Re-pull-all request failed.';
          console.error('Re-pull-all failed:', err);
        });
    }, { signal });
  }

  // v1.25 QoL follow-up ("reheat"): wires the button/cancel control to the
  // module-scope `triggerReheat`/`triggerReheatCancel` functions above --
  // `reheatElements` was already resolved when this view was set up.
  if (reheatElements.button) {
    reheatElements.button.addEventListener('click', () => triggerReheat(reheatElements), { signal });
  }
  if (reheatElements.cancelButton) {
    reheatElements.cancelButton.addEventListener('click', () => triggerReheatCancel(reheatElements), { signal });
  }

  // v1.25.5 QoL follow-up (channel avatars, round 2): wires the "Refresh
  // avatars" button/cancel control -- mirrors the reheat wiring immediately
  // above.
  if (refreshAvatarsElements.button) {
    refreshAvatarsElements.button.addEventListener('click', () => triggerRefreshAvatars(refreshAvatarsElements), { signal });
  }
  if (refreshAvatarsElements.cancelButton) {
    refreshAvatarsElements.cancelButton.addEventListener('click', () => triggerRefreshAvatarsCancel(refreshAvatarsElements), { signal });
  }

  // ---- FR-A: one-shot single-video download form --------------------------

  // v1.13.0 item 4: same format->filetype dependency as the add form above.
  if (oneShotFormatSelect && oneShotFiletypeSelect) {
    oneShotFormatSelect.addEventListener('change', () => {
      repopulateFiletypeSelect(document, oneShotFormatSelect.value, oneShotFiletypeSelect);
    }, { signal });
  }

  if (oneShotDownloadBtn) {
    oneShotDownloadBtn.addEventListener('click', () => {
      const url = oneShotUrlInput ? oneShotUrlInput.value.trim() : '';
      const format = oneShotFormatSelect ? oneShotFormatSelect.value : 'video';
      const quality = oneShotQualitySelect ? oneShotQualitySelect.value : DEFAULT_QUALITY_OPTION;
      const filetype = oneShotFiletypeSelect ? oneShotFiletypeSelect.value : undefined;
      const folder = oneShotFolderInput ? oneShotFolderInput.value.trim() : '';
      setFieldError(oneShotError, null);
      if (!url) {
        setFieldError(oneShotError, 'Enter a video URL.');
        return;
      }
      const body = { url, format, quality };
      if (filetype !== undefined) body.filetype = filetype;
      if (folder) body.folder = folder;
      fetch('/api/ytdlp/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) {
            // SECURITY: the server's validation error string, rendered via
            // textContent only -- never innerHTML.
            setFieldError(oneShotError, data.error || 'Could not start download.');
            return;
          }
          if (oneShotStatus) oneShotStatus.textContent = 'Download queued…';
          if (oneShotUrlInput) oneShotUrlInput.value = '';
          if (oneShotFolderInput) oneShotFolderInput.value = '';
          // The job appears in the very next status poll snapshot (the
          // server sets its `queued` activity entry before responding) --
          // no separate tracking of `data.jobId` is needed here.
        })
        .catch((err) => {
          setFieldError(oneShotError, 'Could not start download (network error).');
          console.error('One-shot download request failed:', err);
        });
    }, { signal });
  }

  // ---- FR-E: live status polling (~2.5s, backing off on failure) ---------
  //
  // A plain recursive `setTimeout` (not `setInterval`) so the delay between
  // polls can grow via `nextPollDelay` when a request fails, rather than
  // firing on a fixed cadence regardless of server health. Skips the fetch
  // entirely (but still reschedules at the base cadence) while the page is
  // hidden (`document.hidden`), so a backgrounded tab never spends network/
  // CPU polling a page nobody is looking at. Guarded on `signal.aborted`
  // (FR-1, T1) so a poll started on one visit to `/subscriptions` can never
  // keep running after the view has been torn down (navigated away).
  //
  // v1.21.0 FR-1 fix (AC1-AC5): this NO LONGER calls `renderSubscriptions()`
  // (a full clearChildren+rebuild). It calls `applyStatusUpdatesInPlace`
  // instead, which only ever mutates each already-built row's
  // `.sub-row-status` text -- see that function's doc comment for the full
  // rationale. `renderOneShots()` still fully rebuilds on every tick (it has
  // no open-edit surface of its own to protect -- one-shot jobs have only a
  // Dismiss button, unaffected by this bug class).
  let statusPollDelay = STATUS_POLL_BASE_MS;

  function scheduleNextStatusPoll(delay) {
    if (signal.aborted) return;
    if (subscriptionsStatusPollTimer) clearTimeout(subscriptionsStatusPollTimer);
    subscriptionsStatusPollTimer = setTimeout(pollStatusOnce, delay);
  }

  function pollStatusOnce() {
    if (signal.aborted) return;
    if (typeof document !== 'undefined' && document.hidden) {
      scheduleNextStatusPoll(STATUS_POLL_BASE_MS);
      return;
    }
    fetch('/api/subscriptions/status')
      .then((r) => {
        if (!r.ok) throw new Error('status endpoint returned ' + r.status);
        return r.json();
      })
      .then((snapshot) => {
        if (signal.aborted) return;
        latestSnapshot = snapshot && typeof snapshot === 'object'
          ? {
            subscriptions: snapshot.subscriptions || {},
            oneShots: snapshot.oneShots || {},
            // v1.31 P2/P6: additive fields; absent on older servers.
            breaker: snapshot.breaker || null,
            ytdlpVersion: snapshot.ytdlpVersion || null,
          }
          : { subscriptions: {}, oneShots: {}, breaker: null, ytdlpVersion: null };
        // v1.26 "real progress": poll much faster while this snapshot shows
        // an actively-downloading entry -- see `nextPollDelay`'s doc comment.
        statusPollDelay = nextPollDelay(statusPollDelay, true, snapshotHasActiveDownload(latestSnapshot));
        applyStatusUpdatesInPlace(rowElementsById, currentSubs, latestSnapshot);
        // v1.31 P2/P6: breaker banner + version footer ride this same tick.
        updateHardeningStrip(latestSnapshot);
        // v1.25 QoL follow-up ("reheat"): the SAME status snapshot the rest
        // of this poll tick already fetched -- no separate/parallel poller.
        applyReheatStateToControls(reheatElements, latestSnapshot.oneShots[REHEAT_ACTIVITY_ID]);
        // v1.25.5 QoL follow-up (channel avatars, round 2): same posture,
        // its own activity id.
        applyRefreshAvatarsStateToControls(refreshAvatarsElements, latestSnapshot.oneShots[REFRESH_AVATARS_ACTIVITY_ID]);
        renderOneShots();
        // v1.29.0 T9 (R4.1, em_ratifications.history_refresh): the "re-fetch
        // when the status poll observes a terminal transition" half of the
        // ratified cadence -- rides THIS SAME snapshot, no separate/parallel
        // poller (mirrors the reheat/refresh-avatars lines immediately
        // above). `maybeRefetchOnPoll` itself decides (via
        // `detectNewlyTerminalRuns`) whether a fetch is even warranted;
        // `null` means "nothing newly terminal this tick", a fetch-free
        // no-op.
        historyController.maybeRefetchOnPoll(latestSnapshot).then((entries) => {
          if (entries === null || signal.aborted) return;
          renderHistorySection(entries);
        });
      })
      .catch((err) => {
        // Never spam the console on repeated failures -- back off instead
        // (nextPollDelay doubles the delay up to STATUS_POLL_MAX_MS) and
        // keep rendering whatever was last known-good rather than clearing
        // the UI on a transient hiccup.
        statusPollDelay = nextPollDelay(statusPollDelay, false);
        console.error('Live status poll failed (backing off):', err && err.message);
      })
      .finally(() => scheduleNextStatusPoll(statusPollDelay));
  }

  // v1.21.0 FR-5: pins load FIRST so the very first subscriptions render
  // already reflects the correct star state (rather than rendering unpinned,
  // then flipping a moment later once pins arrive).
  loadPins().then(() => loadSubscriptions());
  loadMembersOnlySetting();
  // v1.29.0 T9 (R4.1/R4.4): mount the (initially empty) history section, then
  // fetch it once. Mounting even before the fetch resolves means a slow
  // history fetch never blocks or delays the subscriptions list above it --
  // the section just shows its own "No download history yet." empty state
  // until the real fetch settles. R4.4 ("no history route/DOM is reachable"
  // when the module is disabled) does not need a runtime check HERE: this
  // whole file (`GET /js/subscriptions.js`) and the `/subscriptions` page
  // that loads it are BOTH only ever registered inside `registerRoutes`'s
  // SAME `isEnabled` gate (lib/ytdlp/index.js) as the new history route
  // itself -- a disabled module means this code never runs at all (native
  // 404 on the page/script requests), the same structural guarantee every
  // other view-wiring function in this file already relies on. A residual
  // fetch failure for any OTHER reason (network hiccup, a genuinely missing
  // file) still degrades gracefully -- `fetchHistoryEntries` never rejects,
  // it resolves to `[]`, rendering the same harmless empty state.
  mountHistorySection();
  // v1.31 P2/P6: breaker banner + version footer (updated on every status
  // poll tick, hidden until they have something to say).
  mountHardeningStrip();
  loadHistorySection();
  scheduleNextStatusPoll(statusPollDelay);
}

function destroySubscriptionsView() {
  // v1.21.0 FR-3: close a still-open settings sheet on navigate-away -- it
  // is appended directly to document.body (outside #view-root), so the
  // router's per-view content swap alone would otherwise leave it behind.
  closeSettingsSheet();
  if (subscriptionsController) {
    subscriptionsController.abort();
    subscriptionsController = null;
  }
  if (subscriptionsStatusPollTimer) {
    clearTimeout(subscriptionsStatusPollTimer);
    subscriptionsStatusPollTimer = null;
  }
  // C5 remediation: clear any still-pending post-repull refresh timers too.
  repullRefreshTimers.forEach((timer) => clearTimeout(timer));
  repullRefreshTimers.clear();
}

if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.registerView === 'function') {
  window.FileTube.registerView('subscriptions', { init: initSubscriptionsView, destroy: destroySubscriptionsView });
}

// Expose pure/DOM-building helpers to Node for unit testing (browsers ignore
// this block -- `module` is undefined there), mirroring common.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // v1.31 P2/P6: the pure banner/footer formatters.
    formatBreakerBannerText,
    formatYtdlpVersionText,
    FORMAT_OPTIONS,
    QUALITY_OPTIONS,
    DEFAULT_QUALITY_OPTION,
    FILETYPE_OPTIONS,
    DEFAULT_FILETYPE_OPTION,
    STATUS_POLL_BASE_MS,
    STATUS_POLL_MAX_MS,
    // v1.26 "real progress": adaptive fast-poll cadence + its snapshot check.
    STATUS_POLL_FAST_MS,
    snapshotHasActiveDownload,
    nextPollDelay,
    // v1.26 code-review fix (F4): the staleness gate feeding both of the above.
    // (Export key kept stable across the v1.26.3 global-collision rename.)
    ACTIVE_ENTRY_STALE_MS: SUBS_ACTIVE_ENTRY_STALE_MS,
    isFreshlyActiveEntry,
    // v1.26 code-review fix (F7): the one-shot list's cheap render-skip
    // signature + the container update it gates.
    computeOneShotsSignature,
    updateOneShotsContainer,
    formatSubMeta,
    formatSubStatus,
    formatSubscribedDate,
    // v1.25 QoL (T5): cutoffDate <-> <input type="date"> converters.
    cutoffDateToInputValue,
    inputValueToCutoffDate,
    formatLiveStatusText,
    // v1.24.0 T6 (A4): poll-timing display helpers.
    formatNextCheckText,
    formatRowStatusLine,
    // v1.29.0 T4 (R3a.6): partial-outcome class-hook predicate.
    isPartialRowStatus,
    // v1.29.0 T6 (R1.1/R1.2/R1.5): row-level Retry-affordance gating +
    // busy-coalescing "queued behind current run" render.
    isErrorRowStatus,
    shouldShowRetryButton,
    isQueuedRepullResponse,
    // v1.24.0 A2 (T14): per-item download-failure attribution display.
    buildFailureLines,
    formatFailuresLine,
    // v1.29.0 T4 (R3c.1 client): cookie-missing warning line.
    formatWarningLine,
    // v1.25 QoL follow-up ("reheat"): metadata+subtitle re-pull UI.
    REHEAT_ACTIVITY_ID,
    formatReheatSummary,
    formatReheatProgressText,
    applyReheatStateToControls,
    triggerReheat,
    triggerReheatCancel,
    // v1.25.5 QoL follow-up (channel avatars, round 2): "Refresh avatars" UI.
    REFRESH_AVATARS_ACTIVITY_ID,
    formatRefreshAvatarsSummary,
    formatRefreshAvatarsProgressText,
    applyRefreshAvatarsStateToControls,
    triggerRefreshAvatars,
    triggerRefreshAvatarsCancel,
    // C5 (v1.30.0, T12): the shared avatar-precedence render helper, exported
    // for direct node:test coverage (mirrors createSubscriptionRow's other
    // exported DOM-construction pieces).
    applySubAvatar,
    pinLabelFallback,
    resolvePinLabel,
    buildFormatSelect,
    buildQualitySelect,
    buildFiletypeSelect,
    reduceFiletypeOptions,
    createSubscriptionRow,
    buildSettingsSheet,
    applyStatusUpdatesInPlace,
    createSubscriptionsListElement,
    createOneShotRow,
    createOneShotsListElement,
    // Item 1/3 (v1.26.3): subscriptions-list loading skeleton + the
    // createElement-only error-state card twin.
    buildSkeletonRows,
    buildErrorStateNode,
    // v1.29.0 T9 (R4.1-R4.4): durable download-history section -- pure
    // formatters, createElement-only DOM builders, the terminal-transition
    // detector, and the DOM-free fetch-once/re-fetch orchestrator.
    formatHistoryOutcomeLine,
    formatHistoryFailuresLine,
    formatHistoryTimestamp,
    createHistoryRow,
    createHistoryListElement,
    createHistorySectionElement,
    detectNewlyTerminalRuns,
    fetchHistoryEntries,
    createHistoryRefreshController,
  };
}
