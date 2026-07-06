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
// for ANY of that data (see `createSubscriptionRow`/`createOneShotRow`
// below, the two places all of it is rendered).
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

function formatSubMeta(sub) {
  const format = sub && sub.format === 'audio' ? 'Audio' : 'Video';
  const quality = sub && typeof sub.quality === 'string' && sub.quality.trim() !== ''
    ? sub.quality.trim()
    : 'best';
  return format + ' · quality: ' + quality + ' · max videos: ' + formatMaxVideos(sub);
}

/**
 * Renders the EFFECTIVE per-subscription `maxVideos` override for display:
 * unset (`undefined`/`null`) -> "default" (the global
 * `FILETUBE_YTDLP_MAX_VIDEOS` applies, per FR-C); `0` -> "unlimited" (the
 * per-sub unlimited sentinel, same semantics as the global); anything else ->
 * the number itself.
 */
function formatMaxVideos(sub) {
  const mv = sub && sub.maxVideos;
  if (mv === undefined || mv === null) return 'default';
  if (mv === 0) return 'unlimited';
  return String(mv);
}

function formatSubStatus(sub) {
  const checked = sub && sub.lastCheckedAt ? new Date(sub.lastCheckedAt).toLocaleString() : 'never checked';
  const status = sub && typeof sub.lastStatus === 'string' && sub.lastStatus.trim() !== ''
    ? sub.lastStatus
    : 'pending';
  return 'Last checked: ' + checked + ' — ' + status;
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

// ---- DOM construction (textContent-only for every server/user-derived string) --

/**
 * Build a `<select>` populated from `options` (an array of either plain
 * strings or `{value, label}` objects) via `createElement`/`textContent`
 * ONLY -- used for the dynamically-created per-row edit form (the two
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
 * dynamically-built per-row edit panel, mirroring buildFormatSelect/
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
 * one-shot, and edit-panel format `<select>`'s `change` listener (and the
 * edit panel's initial build indirectly, via buildFiletypeSelect above).
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
 * Build one subscription row as a real DOM node. `handlers` =
 * `{ onRepull(id), onDelete(sub), onTogglePause(sub), onSaveEdit(id, patch) }`
 * decouples DOM construction from network calls so this function stays pure
 * and unit-testable (a test can invoke a fake element's recorded click
 * listener directly, without a real fetch). `doc` defaults to the global
 * `document` so real page code can call this with no second argument; tests
 * inject a minimal fake. `liveEntry` is the subscription's current
 * `LiveEntry` from the status poll (or `undefined` when there is none yet) --
 * when it renders a non-null status line (`formatLiveStatusText`), that
 * REPLACES the persisted `formatSubStatus` line for this render; otherwise
 * the persisted status is shown, exactly as before FR-E existed.
 */
function createSubscriptionRow(sub, doc, handlers, liveEntry) {
  const d = doc || document;
  const h = handlers || {};
  const row = d.createElement('div');
  // v1.13.0 item 1/6: this page's OWN row layout class -- NOT Setup's
  // `folder-item-row` class + inline `flex:1; min-width:0` info column,
  // which was found to collapse the info column to ~1 character wide (names/
  // URLs wrapped one character per line, AC1). `.sub-row`/`.sub-row-info`
  // (public/css/style.css) give the info column a real, guaranteed minimum
  // width and let the row wrap onto a second line rather than crushing text
  // -- see the CSS comment there for the full rationale.
  row.className = 'sub-row';

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

  const urlEl = d.createElement('div');
  urlEl.className = 'sub-row-url';
  // SECURITY: channelUrl is server-persisted, user-supplied at add-time.
  urlEl.textContent = (sub && sub.channelUrl) || '';
  info.appendChild(urlEl);

  const metaEl = d.createElement('div');
  metaEl.className = 'sub-row-meta';
  metaEl.textContent = formatSubMeta(sub);
  info.appendChild(metaEl);

  const statusEl = d.createElement('div');
  statusEl.className = 'sub-row-status';
  // FR-E: a live in-flight status (queued/listing/downloading %/done/error)
  // takes over from the persisted `lastStatus` line while it is available;
  // SECURITY: `lastStatus`/`entry.error` can both carry a
  // redacted-but-still-server-composed error string (lib/ytdlp/index.js's
  // safeErrorStatus) -- textContent only, either way.
  statusEl.textContent = formatLiveStatusText(liveEntry) || formatSubStatus(sub);
  info.appendChild(statusEl);

  row.appendChild(info);

  const actions = d.createElement('div');
  actions.className = 'sub-row-actions';

  const pauseBtn = d.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'btn btn-sm';
  pauseBtn.textContent = sub && sub.paused ? 'Resume' : 'Pause';
  pauseBtn.addEventListener('click', () => {
    if (typeof h.onTogglePause === 'function') h.onTogglePause(sub);
  });
  actions.appendChild(pauseBtn);

  const editBtn = d.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-sm';
  editBtn.textContent = 'Edit';
  actions.appendChild(editBtn);

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
  deleteBtn.className = 'remove-folder-btn';
  deleteBtn.title = 'Delete subscription';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', () => {
    if (typeof h.onDelete === 'function') h.onDelete(sub);
  });
  actions.appendChild(deleteBtn);

  row.appendChild(actions);

  // ---- FR-D: inline edit panel (format/quality/filetype/maxVideos), -------
  // row-scoped. Hidden by default; the Edit button above toggles it. Reuses
  // buildFormatSelect/buildQualitySelect/buildFiletypeSelect (the exact same
  // option sets as the add form) so the edit form never diverges from what a
  // fresh add allows.
  const editPanel = d.createElement('div');
  editPanel.className = 'sub-edit-panel';
  editPanel.setAttribute('style', 'display:none; margin-top:12px; padding-top:12px; border-top:1px solid var(--border-color); display:flex; gap:10px; flex-wrap:wrap; align-items:center; width:100%;');
  editPanel.hidden = true;

  const editFormatSelect = buildFormatSelect(d, sub && sub.format);
  editPanel.appendChild(editFormatSelect);

  const editQualitySelect = buildQualitySelect(d, sub && sub.quality);
  editPanel.appendChild(editQualitySelect);

  // v1.13.0 item 4: filetype/container select, format-dependent. Its
  // `change` listener on editFormatSelect rebuilds its option list from the
  // CURRENT format via the pure reduceFiletypeOptions reducer whenever the
  // format changes (e.g. video -> audio mid-edit), so it never shows a
  // container option that doesn't apply to the selected format.
  const editFiletypeSelect = buildFiletypeSelect(d, sub && sub.format, sub && sub.filetype);
  editPanel.appendChild(editFiletypeSelect);
  editFormatSelect.addEventListener('change', () => {
    repopulateFiletypeSelect(d, editFormatSelect.value, editFiletypeSelect);
  });

  const editMaxVideosInput = d.createElement('input');
  editMaxVideosInput.type = 'number';
  editMaxVideosInput.min = '0';
  editMaxVideosInput.setAttribute('placeholder', 'Max videos (blank=unchanged)');
  if (sub && typeof sub.maxVideos === 'number') editMaxVideosInput.value = String(sub.maxVideos);
  editPanel.appendChild(editMaxVideosInput);

  // v1.15.0 item 4: per-subscription skip-Shorts toggle, edit-panel copy --
  // reflects the subscription's persisted `skipShorts` (default false, per
  // `ensureYtdlp`'s backfill) and is always included in the Save patch below
  // (unlike maxVideos, which is only sent when non-blank), since a checkbox
  // always has a definite checked/unchecked state.
  const editSkipShortsLabel = d.createElement('label');
  editSkipShortsLabel.setAttribute('style', 'display:flex; align-items:center; gap:6px; font-weight:normal; font-size:12px;');
  const editSkipShortsCheck = d.createElement('input');
  editSkipShortsCheck.type = 'checkbox';
  editSkipShortsCheck.checked = !!(sub && sub.skipShorts);
  editSkipShortsLabel.appendChild(editSkipShortsCheck);
  const editSkipShortsText = d.createElement('span');
  editSkipShortsText.textContent = 'Skip Shorts';
  editSkipShortsLabel.appendChild(editSkipShortsText);
  editPanel.appendChild(editSkipShortsLabel);

  const editSaveBtn = d.createElement('button');
  editSaveBtn.type = 'button';
  editSaveBtn.className = 'btn btn-sm btn-primary';
  editSaveBtn.textContent = 'Save';
  editSaveBtn.addEventListener('click', () => {
    const patch = {
      format: editFormatSelect.value,
      quality: editQualitySelect.value,
      filetype: editFiletypeSelect.value,
      // v1.15.0 item 4: always included (a checkbox always has a definite
      // checked/unchecked state, unlike the blank-means-unchanged maxVideos
      // input below).
      skipShorts: editSkipShortsCheck.checked,
    };
    const rawMaxVideos = typeof editMaxVideosInput.value === 'string' ? editMaxVideosInput.value.trim() : '';
    if (rawMaxVideos !== '') {
      const parsed = Number(rawMaxVideos);
      if (Number.isInteger(parsed) && parsed >= 0) patch.maxVideos = parsed;
    }
    if (typeof h.onSaveEdit === 'function') h.onSaveEdit(sub && sub.id, patch);
  });
  editPanel.appendChild(editSaveBtn);

  const editCancelBtn = d.createElement('button');
  editCancelBtn.type = 'button';
  editCancelBtn.className = 'btn btn-sm';
  editCancelBtn.textContent = 'Cancel';
  editCancelBtn.addEventListener('click', () => {
    editPanel.hidden = true;
    editPanel.style.display = 'none';
  });
  editPanel.appendChild(editCancelBtn);

  editBtn.addEventListener('click', () => {
    const isHidden = editPanel.hidden || editPanel.style.display === 'none';
    editPanel.hidden = !isHidden;
    editPanel.style.display = isHidden ? 'flex' : 'none';
  });

  row.appendChild(editPanel);
  return row;
}

/**
 * Build the full list (or an empty-state message) as a single container
 * node. Callers own replacing the target container's previous contents --
 * this function only ever builds, never clears/mutates anything else.
 * `statusSnapshot` (optional) is the `{subscriptions, oneShots}` object from
 * `GET /api/subscriptions/status` -- each row's own `LiveEntry` (keyed by
 * `sub.id`) is looked up and threaded into `createSubscriptionRow`.
 */
function createSubscriptionsListElement(subs, doc, handlers, statusSnapshot) {
  const d = doc || document;
  const container = d.createElement('div');
  if (!subs || subs.length === 0) {
    const empty = d.createElement('div');
    empty.setAttribute('style', 'color:var(--text-secondary); font-style:italic; padding:8px 4px;');
    empty.textContent = 'No subscriptions yet. Add a channel above to get started.';
    container.appendChild(empty);
    return container;
  }
  const liveSubs = (statusSnapshot && statusSnapshot.subscriptions) || {};
  subs.forEach((sub) => {
    const liveEntry = sub && sub.id ? liveSubs[sub.id] : undefined;
    container.appendChild(createSubscriptionRow(sub, d, handlers, liveEntry));
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

function initSubscriptionsView(root) {
  subscriptionsController = new AbortController();
  const { signal } = subscriptionsController;

  const listContainer = document.getElementById('sub-list-container');
  const addUrlInput = document.getElementById('sub-add-url');
  const addFormatSelect = document.getElementById('sub-add-format');
  const addQualitySelect = document.getElementById('sub-add-quality');
  const addFiletypeSelect = document.getElementById('sub-add-filetype');
  const addMaxVideosInput = document.getElementById('sub-add-maxvideos');
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

  // ---- FR-E: cached list + live snapshot, re-rendered on every poll tick --
  //
  // The subscription LIST itself (`GET /api/subscriptions`) is only
  // re-fetched on explicit actions (initial load, add/edit/delete/re-pull);
  // the ~2.5s poll only ever hits the cheap, dedicated
  // `GET /api/subscriptions/status` endpoint and re-renders the cached list
  // merged with the fresh snapshot -- this is what keeps the poll itself
  // lightweight (MeTube-simple; no re-listing every 2.5s).
  let currentSubs = [];
  let latestSnapshot = { subscriptions: {}, oneShots: {} };
  const dismissedOneShotIds = new Set();

  function renderSubscriptions() {
    if (!listContainer) return;
    clearChildren(listContainer);
    listContainer.appendChild(createSubscriptionsListElement(currentSubs, document, {
      onRepull: repullOne,
      onDelete: confirmAndDelete,
      onTogglePause: togglePause,
      onSaveEdit: saveEdit,
    }, latestSnapshot));
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

  function togglePause(sub) {
    if (!sub || !sub.id) return;
    fetch('/api/subscriptions/' + encodeURIComponent(sub.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: !sub.paused }),
    })
      .then((r) => r.json())
      .then(() => loadSubscriptions())
      .catch((err) => console.error('Pause/resume toggle failed:', err));
  }

  function saveEdit(id, patch) {
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
      })
      .catch((err) => console.error('Save edit failed (network error):', err));
  }

  function confirmAndDelete(sub) {
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
      .then(() => loadSubscriptions())
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
      const rawMaxVideos = addMaxVideosInput ? addMaxVideosInput.value.trim() : '';
      setFieldError(addError, null);
      if (!channelUrl) {
        setFieldError(addError, 'Enter a channel URL.');
        return;
      }
      const body = { channelUrl, format, quality };
      if (filetype !== undefined) body.filetype = filetype;
      if (rawMaxVideos !== '') {
        const parsed = Number(rawMaxVideos);
        if (Number.isInteger(parsed) && parsed >= 0) body.maxVideos = parsed;
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
          if (addMaxVideosInput) addMaxVideosInput.value = '';
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
        renderSubscriptions();
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

  loadSubscriptions();
  loadMembersOnlySetting();
  scheduleNextStatusPoll(statusPollDelay);
}

function destroySubscriptionsView() {
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
    formatMaxVideos,
    formatSubStatus,
    formatLiveStatusText,
    buildFormatSelect,
    buildQualitySelect,
    buildFiletypeSelect,
    reduceFiletypeOptions,
    createSubscriptionRow,
    createSubscriptionsListElement,
    createOneShotRow,
    createOneShotsListElement,
  };
}
