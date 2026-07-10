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

/**
 * Pure poll-delay reducer: `success` resets to the base ~2.5s cadence;
 * failure doubles the previous delay, capped at `STATUS_POLL_MAX_MS`, so a
 * flaky/offline server never causes a tight error-spamming retry loop. Takes
 * (and returns) a plain delay number rather than an object -- there is no
 * other poll state worth threading through -- so a test can call this
 * directly with no DOM/fetch involved at all.
 */
function nextPollDelay(prevDelayMs, success) {
  if (success) return STATUS_POLL_BASE_MS;
  const base = typeof prevDelayMs === 'number' && prevDelayMs > 0 ? prevDelayMs : STATUS_POLL_BASE_MS;
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
 * `{state, title, index, total, percent, label, url, error, updatedAt}`) into
 * a short, human status line, or `null` when there is nothing live worth
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
function formatLiveStatusText(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const state = entry.state;
  if (state === 'queued') return 'Queued…';
  if (state === 'listing') return 'Checking for new videos…';
  if (state === 'downloading') {
    const title = typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title.trim() : 'Downloading';
    const index = typeof entry.index === 'number' && entry.index > 0 ? entry.index : null;
    const total = typeof entry.total === 'number' && entry.total > 0 ? entry.total : null;
    const percent = typeof entry.percent === 'number' && Number.isFinite(entry.percent)
      ? Math.max(0, Math.min(100, Math.round(entry.percent)))
      : 0;
    const position = index !== null && total !== null ? (index + ' of ' + total) : '';
    return [title, position, percent + '%'].filter((part) => part !== '').join(' — ');
  }
  if (state === 'done') return 'Done';
  if (state === 'error') return typeof entry.error === 'string' && entry.error.trim() !== '' ? entry.error : 'error';
  return null; // 'idle' (or an unrecognized future state) -- no live override
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
 */
function buildFailureLines(entry) {
  if (!entry || entry.state !== 'error' || !Array.isArray(entry.failures)) return [];
  return entry.failures
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
 *   1. `.sub-row-avatar` -- a beveled, single-letter avatar (`name[0]`,
 *      uppercased; falls back to `'?'` for a missing/blank name).
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
  // SECURITY: only ever a single character of `sub.name`, rendered via
  // `textContent` -- inert no matter what that character is.
  const trimmedName = sub && typeof sub.name === 'string' ? sub.name.trim() : '';
  avatar.textContent = trimmedName !== '' ? trimmedName[0].toUpperCase() : '?';
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
  const trimmedName = sub && typeof sub.name === 'string' ? sub.name.trim() : '';
  avatar.textContent = trimmedName !== '' ? trimmedName[0].toUpperCase() : '?';
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

function closeSettingsSheet() {
  if (openSheetNode && openSheetNode.parentNode) {
    openSheetNode.parentNode.removeChild(openSheetNode);
  }
  openSheetNode = null;
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

  // `openSheetNode`/`closeSettingsSheet` are module-scope (above) so
  // destroySubscriptionsView can close a still-open sheet on navigate-away.

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
    clearChildren(oneShotListContainer);
    oneShotListContainer.appendChild(createOneShotsListElement(visible, document, {
      onDismiss: (jobId) => {
        dismissedOneShotIds.add(jobId);
        renderOneShots();
      },
    }));
  }

  function loadSubscriptions() {
    if (!listContainer) return;
    fetch('/api/subscriptions')
      .then((r) => r.json())
      .then((subs) => {
        currentSubs = Array.isArray(subs) ? subs : [];
        renderSubscriptions();
      })
      .catch((err) => {
        clearChildren(listContainer);
        const failEl = document.createElement('div');
        failEl.setAttribute('style', 'color: var(--yt-red);');
        failEl.textContent = 'Failed to load subscriptions.';
        listContainer.appendChild(failEl);
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

  function repullOne(id) {
    if (!id) return;
    fetch('/api/subscriptions/' + encodeURIComponent(id) + '/repull', { method: 'POST' })
      .then((r) => {
        if (repullStatus) {
          repullStatus.textContent = r.ok ? 'Re-pull requested…' : 'Re-pull could not be started.';
        }
        // No queue/progress viz needed here beyond the live poll -- just
        // refresh the persisted list once shortly after, so a quick
        // re-check's terminal status has a chance to land too.
        scheduleRepullRefresh(1500);
      })
      .catch((err) => {
        if (repullStatus) repullStatus.textContent = 'Re-pull request failed.';
        console.error('Re-pull-one failed:', err);
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
          ? { subscriptions: snapshot.subscriptions || {}, oneShots: snapshot.oneShots || {} }
          : { subscriptions: {}, oneShots: {} };
        statusPollDelay = nextPollDelay(statusPollDelay, true);
        applyStatusUpdatesInPlace(rowElementsById, currentSubs, latestSnapshot);
        renderOneShots();
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
    FORMAT_OPTIONS,
    QUALITY_OPTIONS,
    DEFAULT_QUALITY_OPTION,
    FILETYPE_OPTIONS,
    DEFAULT_FILETYPE_OPTION,
    STATUS_POLL_BASE_MS,
    STATUS_POLL_MAX_MS,
    nextPollDelay,
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
    // v1.24.0 A2 (T14): per-item download-failure attribution display.
    buildFailureLines,
    formatFailuresLine,
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
  };
}
