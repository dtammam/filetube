'use strict';

// FileTube Setup/Settings page — registered VIEW MODULE (FR-1, T1).
//
// Extracted from setup.html's former inline <script> (byte-for-byte the same
// behavior) so it can be loaded like every other view script and registered
// with the SPA-lite router in common.js. `init(root)` is called both on a
// full page load (progressive-enhancement boot) and on an in-app swap into
// `/setup.html` — the identical code path either way. All listeners are
// registered through ONE per-view AbortController so `destroy()` removes
// them in a single call when the user navigates away (no leaks across
// swaps); the two recursive-`setTimeout` scan pollers check the same
// controller's `signal.aborted` before rescheduling, so a poll started on
// one visit can never keep running (or touch stale DOM) after the view has
// been torn down.

let configuredFolders = [];
let folderSettings = {}; // { "<path>": { name, hidden } }
// FR-4 (v1.19.0): the yt-dlp module's synthetic download-folder path(s), as
// surfaced by GET /api/config's additive, read-only `syntheticFolders`
// field -- lets renderFolders() disable that one row's remove button (see
// isSyntheticFolder() in common.js) without ever touching the server-side
// db.folders-exclusion invariant.
let syntheticFolders = [];
let loadedDefaultView = null; // null until the /api/settings fetch resolves
// v1.38.0 Part A: book folders — an unordered set of paths (no per-folder
// display/hide/reorder), wired to the existing /api/books/config routes.
let bookFolders = [];
// v1.44: music folders — same unordered-set shape as book folders.
let musicFolders = [];
let controller = null;
// C4 remediation (v1.16.0): tracks pollScanStatus's one-shot post-scan
// redirect timer so destroy() can clear it outright (belt-and-suspenders on
// top of the in-callback `signal.aborted` re-check below -- see
// pollScanStatus).
let scanRedirectTimer = null;

// ---- HTML escape helper locally ----------------------------------------
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Load initial folders
async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    configuredFolders = data.folders || [];
    folderSettings = data.folderSettings || {};
    syntheticFolders = data.syntheticFolders || [];
    renderFolders();
    renderSidebarFolders(configuredFolders, folderSettings);
    populateDefaultViewSelect();
  } catch (err) {
    console.error('Failed to load configuration:', err);
  }
}

// Render configured folder rows in wizard
function renderFolders() {
  const container = document.getElementById('folders-builder-list');
  if (!container) return;
  if (configuredFolders.length === 0) {
    container.innerHTML = '<div class="empty-folders-msg">No folders configured yet. Add one above.</div>';
    return;
  }

  container.innerHTML = '';
  configuredFolders.forEach((folder, index) => {
    const s = folderSettings[folder] || {};
    const row = document.createElement('div');
    row.className = 'folder-item-row';
    // v1.76: no `draggable` attribute and no up/down buttons. The row is
    // wired to the shared POINTER-event gesture layer below, which is what
    // makes it draggable on a touch screen at all - native HTML5 drag (here
    // since v1.15.0) never fired on iOS, so this handle really was decoration
    // on Dean's phone. The handle is no longer aria-hidden either: it is now
    // the keyboard reorder control that replaces the deleted buttons.
    row.dataset.index = String(index);
    row.innerHTML = `
      <span class="drag-handle" title="Drag to reorder"></span>
      <div style="flex:1; min-width:0;">
        <div class="folder-path-text" title="${escapeHtml(folder)}">${escapeHtml(folder)}</div>
        <div style="display:flex; gap:10px; align-items:center; margin-top:8px; flex-wrap:wrap;">
          <input type="text" class="folder-name-input" data-index="${index}" placeholder="Display name (optional)"
                 value="${escapeHtml(s.name || '')}" style="flex:1; min-width:120px; padding:8px 10px;" />
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-secondary); white-space:nowrap;">
            <input type="checkbox" class="folder-hidden-check" data-index="${index}" ${s.hidden ? 'checked' : ''} /> Hide from home
          </label>
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-secondary); white-space:nowrap;">
            <input type="checkbox" class="folder-hidden-sidebar-check" data-index="${index}" ${s.hiddenFromSidebar ? 'checked' : ''} /> Hide from sidebar
          </label>
        </div>
      </div>
      <button class="remove-folder-btn" data-index="${index}" title="Remove folder">&times;</button>
    `;
    container.appendChild(row);

    // FR-4 (v1.19.0): the synthetic download folder self-heals on the very
    // next GET /api/config no matter what the client does (see server.js) --
    // removing it accomplishes nothing durable, so disable (never hide -- the
    // row itself must still display) its remove button with a static,
    // explanatory tooltip instead of leaving a live-looking control that
    // silently does nothing. Set as DOM properties (not string-interpolated
    // into the innerHTML template above) so a disabled button dispatches no
    // click at all -- the remove handler below never runs for this row even
    // without its own defensive guard, which is added anyway (belt-and-
    // suspenders) in case a future change re-enables the control. The tooltip
    // text is a static literal (no dynamic/user data), so no innerHTML
    // interpolation of dynamic strings is introduced.
    if (isSyntheticFolder(folder, syntheticFolders)) {
      const removeBtn = row.querySelector('.remove-folder-btn');
      if (removeBtn) {
        removeBtn.disabled = true;
        removeBtn.title = "This is the auto-managed downloads folder — rename or reorder it here, but it can't be removed (disable the yt-dlp module to remove it).";
      }
    }
  });

  // v1.76: ONE drag-to-reorder gesture (pointer events - mouse, touch and
  // pen), replacing BOTH the up/down `.reorder-btn` buttons and the v1.15.0
  // native HTML5 DnD that never worked on a touch screen. Dean's report was
  // that the row only dragged "from a small portion of the card": native drag
  // never starts inside a text input, so the display-name field, both
  // checkboxes and the buttons were all dead zones. The whole row is the drag
  // surface now, minus its genuinely interactive children (the helper's
  // default ignore list), and a touch drag arms on a long press so the list
  // can still be scrolled with a finger.
  //
  // The persist posture is UNCHANGED and deliberately different from the
  // sidebar's: this list has a Save button, so a reorder only mutates
  // `configuredFolders` and Save persists it through POST /api/config. A drag
  // followed by no Save must persist nothing.
  const wireRows = (typeof wireReorderable === 'function')
    ? wireReorderable
    : (window.FileTube && window.FileTube.wireReorderable);
  wireRows(container, {
    rowSelector: '.folder-item-row',
    handleSelector: '.drag-handle',
    focusKey: 'setup-folders',
    // The box scrolls (and got taller this wave), so a drag near its edge
    // needs the list to come to the pointer.
    scrollContainer: container,
    labelOf: (i) => {
      const folder = configuredFolders[i];
      const s2 = folderSettings[folder] || {};
      return s2.name || (folder || '').split(/[\\/]/).pop() || folder;
    },
    onReorder: (from, to) => {
      configuredFolders = moveArrayItem(configuredFolders, from, to);
      renderFolders();
    },
    signal: controller.signal,
  });

  // Persist per-folder edits as they happen (keyed by path so row order doesn't matter)
  container.querySelectorAll('.folder-name-input').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const folder = configuredFolders[parseInt(e.target.dataset.index)];
      folderSettings[folder] = { ...(folderSettings[folder] || {}), name: e.target.value };
    }, { signal: controller.signal });
  });
  container.querySelectorAll('.folder-hidden-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const folder = configuredFolders[parseInt(e.target.dataset.index)];
      folderSettings[folder] = { ...(folderSettings[folder] || {}), hidden: e.target.checked };
    }, { signal: controller.signal });
  });
  // "Hide from sidebar" (v1.14.0 item 3) -- independent of "Hide from
  // home" above: omits the folder from the left sidebar/Playlists sheet
  // list only. The folder stays fully browsable via its direct
  // /?root=<path> link and keeps its own "Hide from home" behavior.
  container.querySelectorAll('.folder-hidden-sidebar-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const folder = configuredFolders[parseInt(e.target.dataset.index)];
      folderSettings[folder] = { ...(folderSettings[folder] || {}), hiddenFromSidebar: e.target.checked };
    }, { signal: controller.signal });
  });

  // Add delete handlers
  container.querySelectorAll('.remove-folder-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      // FR-4 (v1.19.0): defensive guard, belt-and-suspenders alongside the
      // `disabled` DOM property set above (which already stops a click from
      // ever reaching this handler for the synthetic row) -- removing it
      // would accomplish nothing durable anyway (see server.js's synthetic-
      // folder self-heal), so never mutate state for it even if this handler
      // somehow ran.
      if (isSyntheticFolder(configuredFolders[index], syntheticFolders)) return;
      delete folderSettings[configuredFolders[index]];
      configuredFolders.splice(index, 1);
      renderFolders();
    }, { signal: controller.signal });
  });
}

// Helper to render sidebar list. A folder flagged hiddenFromSidebar
// (v1.14.0 item 3) is omitted here too -- the Setup page's own sidebar
// is the same left sidebar as everywhere else.
//
// Item 1 (v1.15.0): the sidebar has no Save button (unlike the wizard
// list above), so a drag-and-drop reorder here persists IMMEDIATELY via
// the SAME POST /api/config path the wizard's Save button uses --
// computed the same way the design's sidebar reorder always is: (1) the
// reordered VISIBLE subset via moveArrayItem, (2) rebuilt into the FULL
// folders order via rebuildFullFolderOrder (hidden-from-sidebar folders
// keep their absolute positions), (3) POSTed, then the full config is
// reloaded so the synthetic Downloads folder's GET-time position splice
// (server.js) is reflected everywhere (wizard list + sidebar).
function renderSidebarFolders(folders, settings = {}) {
  const sidebarContainer = document.getElementById('sidebar-folders-list');
  if (!sidebarContainer) return;
  const visible = visibleSidebarFolders(folders, settings, syntheticFolders); // v1.73.1: the hard Downloads entry owns the sidebar surface
  if (visible.length === 0) {
    sidebarContainer.innerHTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';
    // v1.33.1 (Dean): count-gated Liked entry, same shared helper as every
    // other sidebar surface (prepends without touching siblings).
    applyLikedSidebarEntry(sidebarContainer);
    return;
  }
  sidebarContainer.innerHTML = visible.map((f, index) => {
    const base = f.split(/[\\/]/).pop() || f;
    const label = (settings[f] && settings[f].name) || base;
    return `<a href="/?root=${encodeURIComponent(f)}" class="sidebar-item" data-index="${index}" title="${escapeHtml(f)}"><i class="icon-folder"></i> ${escapeHtml(label)}</a>`;
  }).join('');
  applyLikedSidebarEntry(sidebarContainer); // v1.33.1: see above

  // v1.76: the shared POINTER gesture layer, replacing this file's second
  // copy of the native HTML5 DnD wiring. Same row selector, so the injected
  // Liked entry is still not a drag target; no `handleSelector`, so these
  // link rows drag whole and keep their normal arrow-key focus behaviour
  // (see main.js's identical sidebar for the full rationale).
  //
  // The persist posture is UNCHANGED: the sidebar has no Save button of its
  // own (unlike the wizard list above), so a drop persists immediately via
  // moveArrayItem -> rebuildFullFolderOrder -> POST /api/config, then
  // reloads the whole config so the synthetic Downloads folder's GET-time
  // position splice is reflected in BOTH lists.
  const wireRows = (typeof wireReorderable === 'function')
    ? wireReorderable
    : (window.FileTube && window.FileTube.wireReorderable);
  wireRows(sidebarContainer, {
    rowSelector: '.sidebar-item[data-index]',
    scrollContainer: document.getElementById('sidebar'),
    onReorder: async (fromIndex, toIndex) => {
      const newVisibleOrder = moveArrayItem(visible, fromIndex, toIndex);
      const rebuiltFull = rebuildFullFolderOrder(folders, settings, newVisibleOrder, syntheticFolders);
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folders: rebuiltFull, folderSettings: settings })
        });
        const data = await res.json();
        if (data.success) await loadConfig();
      } catch (err) {
        console.error('Failed to persist sidebar folder reorder:', err);
      }
    },
    signal: controller.signal,
  });
}

// ---- Default landing view (v1.14.0 item 4) -----------------------------
// Populates the "Most recent" + one-per-configured-folder <select> and,
// once known, applies the currently saved db.settings.defaultView value.
// Called from BOTH loadConfig() (once configuredFolders/folderSettings
// are known) and loadAutomationSettings() (once the saved value is
// known) -- whichever resolves LAST ends up with both pieces of data and
// converges on the correct final state, regardless of fetch ordering.
function populateDefaultViewSelect() {
  const select = document.getElementById('default-view-select');
  if (!select) return;
  const options = ['<option value="">Most recent</option>'].concat(
    configuredFolders.map(f => {
      const base = f.split(/[\\/]/).pop() || f;
      // v1.73.1 (Dean's device find): the synthetic ytdlp folder is the
      // "Downloads" library everywhere else now - the picker names it the
      // same instead of leaking the raw directory basename. The VALUE
      // stays the path (the saved defaultView contract is unchanged, so
      // an existing selection keeps working).
      // Slim-gate S1: a CUSTOM rename (Setup still advertises it, the
      // server persists it, every other surface displays it) wins; only
      // the un-renamed synthetic folder defaults to "Downloads" instead
      // of leaking the raw directory basename.
      const label = isSyntheticFolder(f, syntheticFolders)
        ? ((folderSettings[f] && folderSettings[f].name) || 'Downloads')
        : ((folderSettings[f] && folderSettings[f].name) || base);
      return `<option value="${escapeHtml(f)}">${escapeHtml(label)}</option>`;
    })
  );
  select.innerHTML = options.join('');
  if (loadedDefaultView !== null) select.value = loadedDefaultView;
}

// FR-3 (v1.18.0): builds the "…: name1, name2 +K more" suffix appended after
// the existing "Converting N file(s) in the background" message, from the
// (bounded) `transcodeNames`/`transcodeOverflow` fields GET /api/scan-status
// now returns. Pure/extractable so it's unit-testable without a DOM/fetch --
// returns '' (no suffix) when there are no names to show, so a stale/older
// response shape (missing transcodeNames) degrades to the pre-FR-3 message
// rather than throwing.
function transcodeNamesSuffix(s) {
  if (!Array.isArray(s.transcodeNames) || s.transcodeNames.length === 0) return '';
  let suffix = `: ${s.transcodeNames.join(', ')}`;
  if (s.transcodeOverflow > 0) suffix += ` +${s.transcodeOverflow} more`;
  return suffix;
}

// Poll the server's scan status and report live progress until the scan finishes.
function pollScanStatus(statusText) {
  if (!controller || controller.signal.aborted) return; // view torn down -- stop the chain
  fetch('/api/scan-status')
    .then((r) => r.json())
    .then((s) => {
      if (!controller || controller.signal.aborted) return;
      if (s.scanning) {
        let msg = `Scanning library… ${s.fileCount} file(s) found so far`;
        if (s.transcoding > 0) msg += ` Converting ${s.transcoding} file(s) in the background${transcodeNamesSuffix(s)}`;
        // v1.55 Track C: the shared feedback system replaces the ad-hoc
        // style.color juggling everywhere in this file.
        setActionStatus(statusText, msg, 'busy');
        setTimeout(() => pollScanStatus(statusText), 1000);
      } else {
        let msg = `Scan complete — ${s.fileCount} file(s) across ${s.folderCount} folder(s).`;
        if (s.transcoding > 0) msg += ` Converting ${s.transcoding} file(s) in the background${transcodeNamesSuffix(s)}`;
        setActionStatus(statusText, msg);
        // C4 remediation (v1.16.0): re-check `signal.aborted` INSIDE the
        // timeout callback, not just before arming it -- the user can
        // navigate away in-app during this 1.8s window (this view's own
        // destroy() runs on that navigation), and without this guard the
        // callback fired anyway and force-navigated back to '/' regardless
        // of wherever the user had since gone. Matches
        // pollAutomationScanStatus's guard pattern above. Also tracked in
        // `scanRedirectTimer` so destroy() can clear it outright.
        scanRedirectTimer = setTimeout(() => {
          scanRedirectTimer = null;
          if (!controller || controller.signal.aborted) return;
          if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate('/');
          else window.location.href = '/';
        }, 1800);
      }
    })
    .catch(() => {
      if (!controller || controller.signal.aborted) return;
      // C4 remediation: same re-check + tracking as the terminal branch above.
      scanRedirectTimer = setTimeout(() => {
        scanRedirectTimer = null;
        if (!controller || controller.signal.aborted) return;
        if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate('/');
        else window.location.href = '/';
      }, 1500);
    });
}

// Appearance (era theme) picker — THEME_REGISTRY/setTheme come from common.js
function renderThemePicker() {
  const container = document.getElementById('theme-picker');
  if (!container) return;
  const active = document.documentElement.getAttribute('data-theme');
  container.innerHTML = THEME_REGISTRY.map(t => `
    <button type="button" class="theme-card${t.id === active ? ' active' : ''}"
            data-era="${t.id}">
      <span class="theme-swatch">
        <span style="background:${t.swatch[0]}"></span>
        <span style="background:${t.swatch[1]}"></span>
      </span>
      <span class="theme-card-name">${t.name}
        <span class="theme-card-year">${t.year}</span></span>
      <span class="theme-card-blurb">${t.blurb}</span>
    </button>`).join('');
  container.querySelectorAll('.theme-card').forEach(btn => {
    btn.addEventListener('click', () => {
      setTheme(btn.dataset.era);   // applies + persists immediately, no Save step
      renderThemePicker();          // re-highlight active card
    }, { signal: controller.signal });
  });
}

// Icons picker — ICON_SET_REGISTRY/setIconSet come from common.js. Mirrors
// renderThemePicker() above (no Save step, re-highlight on click). The
// active card is the raw STORED pref (never data-icons, which never holds
// 'auto'), defaulting to 'outlined' when unset.
function renderIconPicker() {
  const container = document.getElementById('icon-picker');
  // v1.26.4 (found while writing the jsdom shell smoke-test, test/
  // integration/shell-smoke.test.js): `container` can exist WITHOUT this
  // module's own `controller` yet being set. common.js's `applyIconSet()`
  // calls this function (feature-detected, `typeof renderIconPicker ===
  // 'function'`) from its OWN `initIconSet()`, which runs EARLY in
  // common.js's single `DOMContentLoaded` handler -- BEFORE `bootRouter()`
  // (called later in that same handler) ever invokes THIS module's own
  // `init()`, which is what actually sets `controller`. On a fresh direct
  // load of /setup.html, `#icon-picker` is already present in the
  // server-rendered markup, so that early call used to reach
  // `controller.signal` while `controller` was still `null`, throwing and
  // aborting the REST of common.js's DOMContentLoaded handler entirely
  // (menu-toggle wiring, click interception, bootRouter() itself, etc. --
  // everything queued after the throw point never ran). Bailing here is
  // safe and lossless: this module's own `init()` (a few lines later, same
  // tick) unconditionally calls `renderIconPicker()` again once `controller`
  // is set, which fully (re)builds the picker and wires its click handlers
  // -- so the picker still ends up correct; only the earlier, premature
  // attempt is now skipped instead of crashing.
  if (!container || !controller) return;
  let pref = null;
  try { pref = localStorage.getItem('ft-icons'); } catch (_) { /* fall through to default */ }
  const active = (pref === 'auto' || ICON_SETS.includes(pref)) ? pref : 'outlined';
  container.innerHTML = ICON_SET_REGISTRY.map(s => `
    <button type="button" class="theme-card${s.id === active ? ' active' : ''}"
            data-icons-pref="${s.id}">
      <span class="theme-card-name">${s.name}</span>
      <span class="theme-card-blurb">${s.blurb}</span>
    </button>`).join('');
  container.querySelectorAll('.theme-card').forEach(btn => {
    btn.addEventListener('click', () => {
      // Applies + persists immediately (no Save). setIconSet -> applyIconSet
      // already re-renders this picker (feature-detected), so the highlight
      // refreshes without a second renderIconPicker() call here.
      setIconSet(btn.dataset.iconsPref);
    }, { signal: controller.signal });
  });
}

// ---- Automation & Storage --------------------------------------------
// Persisted server-side (db.settings via /api/settings), NOT localStorage
// like the theme/icon prefs above — these govern server automation
// (scan cadence, cache housekeeping), not per-browser display prefs.
// Save UX choice: immediate-apply per control on 'change' (mirrors the
// theme/icon pickers' no-Save-button precedent above), rather than a
// single batched "Save" button — least surprising given the surrounding
// page already commits changes as they're made.

// Shows/clears a field-level validation error next to a control (400s
// from POST /api/settings), instead of silently swallowing them or using
// a page-wide alert.
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

// POSTs a single changed key to /api/settings. Returns the parsed response
// body on success (200), or null on failure (400 validation error or a
// network/fetch failure) — either way surfaces the message via errorEl
// rather than throwing/crashing the page.
async function saveAutomationSetting(key, value, errorEl) {
  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value })
    });
    const data = await r.json();
    if (!r.ok) {
      setFieldError(errorEl, data.error || 'Failed to save setting.');
      return null;
    }
    setFieldError(errorEl, null);
    return data;
  } catch (err) {
    console.error('Failed to save automation setting:', key, err);
    setFieldError(errorEl, 'Failed to save setting (network error).');
    return null;
  }
}

// ---- Resume-prompt threshold (D2, v1.24.0, T13) --------------------------
// A CLIENT-side (localStorage) preference, NOT a server db.settings value --
// mirrors player.js's own `ft-volume`/`ft-loop`/`ft-rate` prefs (immediate-
// apply on 'change', best-effort try/catch, no Save button), rather than the
// server-persisted controls above/below this section. Read LIVE by
// `shouldShowResumeOverlay`'s call site (`getStoredResumeThreshold`, public/
// js/player.js) at the moment a new video is opened -- so this control's
// 'change' handler takes effect on the very next video open, no page reload
// needed. The key MUST match `RESUME_THRESHOLD_STORAGE_KEY` in player.js
// exactly (duplicated string literal -- same cross-file convention already
// used for 'ft-icons'/'ft-era' between common.js and this page's own inline
// FOUC-guard script; no shared-constant module exists in this codebase for
// cross-file storage keys).
const RESUME_THRESHOLD_KEY = 'filetube_resume_threshold';
const RESUME_THRESHOLD_DEFAULT = 60;

// Populates the control from whatever's currently stored (or the default,
// on first visit / a garbage value / storage disabled) -- mirrors
// resolveResumeThreshold's own "garbage/missing -> 60" fallback in
// player.js so the two never disagree about what counts as valid.
// v1.63.1 (Dean): the hide-the-fake-stars toggle. common.js OWNS the pref
// semantics (applyStarRatingsPref: root class + localStorage + per-user
// mirror); this control just reflects and fires it. Checked = hidden.
function wireHideStarsControl(signal) {
  const check = document.getElementById('hide-stars-check');
  if (!check) return;
  let stored = null;
  try { stored = localStorage.getItem('ft-star-ratings'); } catch (_) { /* storage off */ }
  check.checked = !shouldShowStarRatings(stored);
  check.addEventListener('change', () => {
    applyStarRatingsPref(check.checked ? 'hidden' : 'shown', { mirror: true });
  }, { signal });
}

function loadResumeThresholdControl() {
  const input = document.getElementById('resume-threshold-input');
  if (!input) return;
  let raw = null;
  try { raw = localStorage.getItem(RESUME_THRESHOLD_KEY); } catch (_) { /* storage disabled -- fall back to the default */ }
  const n = parseFloat(raw);
  input.value = String(Number.isFinite(n) && n >= 0 ? n : RESUME_THRESHOLD_DEFAULT);
}

// v1.27.1: the on-screen `?debugLifecycle=1` player-lifecycle debug overlay
// (public/js/player.js) toggled from Setup, for owners on an installed PWA
// with no address bar to type the URL param into. A CLIENT-side (localStorage)
// flag, same as the resume-threshold control above -- NOT a server
// db.settings value, so it is deliberately absent from DEFAULT_SETTINGS/
// KNOWN_KEYS/the settings API (see server.js) and never round-trips through
// saveAutomationSetting. The key MUST match `DEBUG_LIFECYCLE_STORAGE_KEY` in
// player.js exactly (same cross-file string-literal convention as
// RESUME_THRESHOLD_KEY above -- grep it there for the precedent).
const DEBUG_LIFECYCLE_STORAGE_KEY = 'ft-debug-lifecycle';

// Prefills the checkbox from whatever's currently stored -- mirrors
// `isDebugLifecycleEnabled()`'s own `=== '1'` check in player.js exactly, so
// the two never disagree about what counts as "on".
function loadDebugLifecycleControl() {
  const check = document.getElementById('debug-lifecycle-check');
  if (!check) return;
  let raw = null;
  try { raw = localStorage.getItem(DEBUG_LIFECYCLE_STORAGE_KEY); } catch (_) { /* storage disabled -- treat as off */ }
  check.checked = raw === '1';
}

// v1.44: home-row toggle prefill/wire (device-local, default ON -- stored '0'
// = off). Mirrors main.js's homeRowEnabled so the Settings UI and the home
// render never disagree.
function loadHomeRowControl(id, key) {
  const check = document.getElementById(id);
  if (!check) return;
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (_) { /* storage disabled -- default on */ }
  check.checked = raw !== '0';
}
function wireHomeRowToggle(id, key, signal) {
  const check = document.getElementById(id);
  if (!check) return;
  check.addEventListener('change', (e) => {
    try {
      if (e.target.checked) localStorage.removeItem(key);
      else localStorage.setItem(key, '0');
    } catch (_) { /* storage disabled/full -- best-effort only */ }
  }, { signal });
}

// v1.44 T12: the customizable bottom-bar editor. Lists the optional items
// (labels below), each with a Show toggle + up/down reorder, driving the
// device-local config through common.js's exposed helpers. applyBottomNav-
// Customization re-renders the live bar immediately.
// v1.75: home + liked + settings joined the roster when the fixed anchors
// retired, so all twelve ids need a label here. The unit suite binds this map
// against common.js's live roster - an id without a label would otherwise
// render as its raw slug in Dean's Settings panel.
const BOTTOMBAR_LABELS = { home: 'Home', liked: 'Liked', playlists: 'Playlists', history: 'History', subscriptions: 'Subscriptions', 'oneoff-download': 'Download', theme: 'Light / Dark', podcasts: 'Podcasts', music: 'Music', books: 'Books', downloads: 'Downloads', settings: 'Settings' };
// ---- v1.67: the card-corner editor (plan D9) --------------------------------
//
// Three pickers (Top left / Top right / Bottom left) in the Appearance box.
// The corner VOCABULARY (control roster, defaults, resolver) is main.js's -
// consumed here as browser globals (script order: common -> main -> setup),
// never hand-copied (the v1.64 roster-rot lesson; the unit suite binds the
// label map against main.js's exported roster). Per-user SERVER-persisted
// (C1): seeds from GET /api/auth/me, writes one key per change via
// POST /api/me/settings, and deliberately touches NO localStorage.
// Bottom-right has no picker - it is reserved for the duration badge.

const CARD_CORNER_LABELS = {
  download: 'Download', delete: 'Delete', like: 'Like',
  queue: 'Queue', share: 'Share', reheat: 'Reheat', none: 'None',
};

const CORNER_EDITOR_SLOTS = [
  ['cornerTL', 'Top left'],
  ['cornerTR', 'Top right'],
  ['cornerBL', 'Bottom left'],
];

// Pure (C2): one corner's <option> list - every canonical control MINUS the
// ones the OTHER two corners currently hold (a duplicate is a UI bug, not a
// feature), plus None always (two empty corners are legal). `controls` is
// injected (main.js's CARD_CORNER_CONTROLS) so Node tests need no globals.
function buildCornerEditorOptions(effective, cornerKey, controls) {
  const chosenElsewhere = new Set(
    CORNER_EDITOR_SLOTS.map((s) => s[0]).filter((k) => k !== cornerKey).map((k) => effective[k])
  );
  const options = [];
  for (const control of controls) {
    // v1.67 gate (adversarial S1): a corner's OWN stored value is never
    // filtered, even when a direct settings POST duplicated it into another
    // corner (bypassing this editor is the plan's accepted residual). The
    // select must display the stored truth - a filtered-out own-value left
    // no selected option, so the browser showed the first entry as a lie.
    if (chosenElsewhere.has(control) && effective[cornerKey] !== control) continue;
    options.push({
      value: control,
      label: CARD_CORNER_LABELS[control] || control,
      selected: effective[cornerKey] === control,
    });
  }
  options.push({ value: 'none', label: CARD_CORNER_LABELS.none, selected: effective[cornerKey] === 'none' });
  return options;
}

async function renderCardCornerEditor(signal) {
  const host = document.getElementById('card-corner-editor');
  if (!host) return;
  let settings = null;
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) {
      const me = await r.json();
      settings = me && me.settings;
    }
  } catch (_) { /* signed-out/offline: draw the C5 defaults (a save would fail the same way and re-seed) */ }
  drawCardCornerEditor(host, resolveCardCornerPrefs(settings), signal);
}

function drawCardCornerEditor(host, effective, signal) {
  host.innerHTML = '';
  for (const [key, slotLabel] of CORNER_EDITOR_SLOTS) {
    const row = document.createElement('div');
    row.className = 'card-corner-editor-row';
    const label = document.createElement('span');
    label.className = 'card-corner-editor-label';
    label.textContent = slotLabel;
    const select = document.createElement('select');
    select.className = 'card-corner-editor-select';
    select.setAttribute('aria-label', `${slotLabel} corner control`);
    for (const opt of buildCornerEditorOptions(effective, key, CARD_CORNER_CONTROLS)) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      o.selected = opt.selected;
      select.appendChild(o);
    }
    select.addEventListener('change', () => {
      const value = select.value;
      effective[key] = value;
      // Redraw FIRST so the sibling pickers re-filter instantly (C2 live),
      // then persist; a failed save re-seeds the whole editor from the
      // server truth rather than leaving the UI lying about what stuck.
      // QA S2: the redraw destroys the focused <select>, which strands a
      // keyboard user (Firefox fires `change` per arrow press) - re-focus
      // the SAME slot's fresh select so arrow-keying keeps working.
      drawCardCornerEditor(host, effective, signal);
      const slotIndex = CORNER_EDITOR_SLOTS.findIndex((s) => s[0] === key);
      const freshSelect = host.querySelectorAll('select')[slotIndex];
      if (freshSelect) freshSelect.focus();
      fetch('/api/me/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })
        .then((res) => { if (!res.ok) throw new Error(`save failed: ${res.status}`); })
        .catch(() => {
          showToast('Could not save the corner layout.');
          renderCardCornerEditor(signal);
        });
    }, { signal });
    row.appendChild(label);
    row.appendChild(select);
    host.appendChild(row);
  }
}

function renderBottomBarEditor(signal) {
  const host = document.getElementById('bottombar-editor');
  const FT = typeof window !== 'undefined' ? window.FileTube : null;
  if (!host || !FT || !FT.readBottomNavConfig) return;
  const optional = FT.BOTTOM_NAV_OPTIONAL || [];
  const cfg = FT.readBottomNavConfig();
  // v1.75: the row order is the RESOLVER's resolved sequence, never a second
  // ordering walk of our own. The editor used to re-derive it (config order,
  // then unlisted roster order), which was fine while home/settings sat
  // outside the roster - but the moment they joined, that walk listed both at
  // the BOTTOM for any existing config (whose `order` cannot name them), and
  // one tap of a reorder button would then have written that as the real
  // order and thrown Home to the end of the user's bar. Asking the resolver
  // makes the panel's list and the bar's sequence the same answer by
  // construction, compat fallbacks included.
  // (Adversarial gate S4: the previous `: { sequence: optional.slice(), ... }`
  // fallback arm was unreachable - resolveBottomNavLayout is exported from the
  // same block as readBottomNavConfig, which the guard above already requires -
  // and if it HAD fired it would have ticked all twelve boxes including the
  // default-hidden ones. A dead arm that lies is worse than no arm.)
  const layout = FT.resolveBottomNavLayout(optional, cfg);
  const items = layout.sequence;
  // Checked-ness comes from the SAME resolution, not from a second copy of the
  // hidden/shown/default-hidden formula (the one-decision-function rule).
  //
  // It resolves against the ROSTER, deliberately, so a tick means "I want this
  // in my bar whenever it is available" - which is what the panel's own copy
  // promises ("Some items only appear when their feature is enabled"). The gate
  // (round 2, S3) proposed resolving against the live bar instead, so the ticks
  // would always mirror what is on screen; I measured that trade and did not
  // take it. Availability-based ticks make the Subscriptions/Download rows
  // un-tickable on a module-off device: the box would spring back on the next
  // render even though the config write succeeded, which is a worse lie than
  // the one it fixes. The residual it leaves is narrow and cosmetic - a config
  // that hides every MOUNTED id while opting in only unmounted ones shows its
  // ticks against a floored default bar - and the change-time floor below means
  // this panel can no longer author that state; only a hand-edited config, or
  // disabling a module after the fact, can reach it.
  const visibleSet = new Set(layout.visible);
  // The FLOOR is checked against the ids the bar ACTUALLY mounts, not the
  // roster: on a device with the yt-dlp module off, leaving only Subscriptions
  // and Download ticked satisfies a roster-shaped floor (two visible) while the
  // real bar has nothing at all and falls back to the default - the panel would
  // then show ten empty boxes over a fully populated bar (adversarial gate S4).
  // setup.html carries the bar itself, so the live list is right here.
  //
  // Read at CHANGE time, not at render time (QA gate round 2). The two
  // capability probes resolve asynchronously, so a snapshot taken while the
  // panel renders usually holds only the ten static ids on a hard load, and the
  // same un-check would be refused after a reload but accepted after in-app
  // navigation - the identical async-injection-leaks-into-behaviour class this
  // wave just fixed in the resolver.
  const livePresentIds = () => {
    const els = document.querySelectorAll('#bottom-nav .bottom-nav-item');
    const ids = Array.prototype.map.call(els, (el) => el.getAttribute('data-nav')).filter(Boolean);
    return ids.length ? ids : optional;
  };

  host.innerHTML = '';
  items.forEach((id, index) => {
    const row = document.createElement('div');
    row.className = 'bottombar-editor-row';
    // v1.76 (Dean: the up/down arrows "just suck"): the handle replaces both
    // buttons. It is the drag grip AND the keyboard control - wireReorderable
    // gives it tabindex/role/aria-label and arrow-key reorder below, so
    // deleting the buttons costs no accessibility.
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.title = 'Drag to reorder';
    const label = document.createElement('span');
    label.className = 'bottombar-editor-label';
    label.textContent = BOTTOMBAR_LABELS[id] || id;
    const toggle = document.createElement('label');
    toggle.style.cssText = 'display:flex; align-items:center; gap:var(--space-3); font-weight:normal;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = visibleSet.has(id);
    toggle.appendChild(cb);
    toggle.appendChild(document.createTextNode('Show'));

    cb.addEventListener('change', () => {
      const c = FT.readBottomNavConfig();
      const h = new Set(Array.isArray(c.hidden) ? c.hidden : []);
      const sh = new Set(Array.isArray(c.shown) ? c.shown : []);
      // One uniform rule: checked = out of `hidden` AND into `shown` (the
      // shown entry only matters for default-hidden ids; harmless else).
      if (cb.checked) { h.delete(id); sh.add(id); } else { h.add(id); sh.delete(id); }
      c.hidden = Array.from(h);
      c.shown = Array.from(sh);
      // v1.75 FLOOR (ruling R2): with Home and Settings hidable, the last
      // un-check would leave a fixed, empty, un-navigable strip. Refuse it
      // here rather than writing a config the resolver then has to override -
      // `flooredToDefault` is precisely "this config empties the bar", asked
      // of the same function that would have to clean up after it.
      if (FT.resolveBottomNavLayout(livePresentIds(), c).flooredToDefault === true) {
        cb.checked = true; // put the tick back; nothing is persisted
        showToast('Keep at least one item in the bottom bar.');
        return;
      }
      FT.writeBottomNavConfig(c);
      if (FT.applyBottomNavCustomization) FT.applyBottomNavCustomization();
    }, { signal });
    row.appendChild(handle); row.appendChild(label); row.appendChild(toggle);
    host.appendChild(row);
  });

  // v1.76: drag-to-reorder (pointer events - mouse, touch and pen alike),
  // replacing the up/down buttons. `moveBottomBarItem` is UNCHANGED: it still
  // takes (items, from, to) and still persists the FULL resolved roster, which
  // is what releases the v1.75 compat pins on home/settings. The gesture layer
  // decides nothing about ordering or persistence.
  //
  // Resolved through window.FileTube when the bare global is absent: setup.js
  // is required as a plain Node module by its jsdom tests, where common.js was
  // never evaluated into the page.
  // Deliberately NOT guarded by a `typeof === 'function'` check: common.js
  // always loads before setup.js in the browser, so such a guard could never
  // be false in production, and a silent no-op would leave the panel looking
  // reorderable while doing nothing. A missing helper should be loud.
  const wireRows = (typeof wireReorderable === 'function') ? wireReorderable : FT.wireReorderable;
  wireRows(host, {
    rowSelector: '.bottombar-editor-row',
    handleSelector: '.drag-handle',
    focusKey: 'bottombar-editor',
    labelOf: (i) => BOTTOMBAR_LABELS[items[i]] || items[i],
    onReorder: (from, to) => moveBottomBarItem(items, from, to, signal),
    signal,
  });
}
function moveBottomBarItem(items, from, to, signal) {
  if (to < 0 || to >= items.length) return;
  const FT = window.FileTube;
  const arr = items.slice();
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  const c = FT.readBottomNavConfig();
  c.order = arr;
  FT.writeBottomNavConfig(c);
  if (FT.applyBottomNavCustomization) FT.applyBottomNavCustomization();
  renderBottomBarEditor(signal);
}

// GET /api/settings on load: populate all four controls, plus the
// size-cap placeholder from effectiveCacheMaxBytes (the env-var/5GB
// default that applies whenever no UI override is persisted).
async function loadAutomationSettings() {
  try {
    const r = await fetch('/api/settings');
    const s = await r.json();
    const scanSelect = document.getElementById('scan-interval-select');
    if (scanSelect) scanSelect.value = String(s.scanIntervalMinutes);
    const pruneCheck = document.getElementById('prune-missing-check');
    if (pruneCheck) pruneCheck.checked = !!s.pruneMissing;
    // v1.16.0 FR-3 (T3): autoplay-next toggle, OFF by default.
    const autoplayNextCheck = document.getElementById('autoplay-next-check');
    if (autoplayNextCheck) autoplayNextCheck.checked = !!s.autoplayNext;
    // v1.27.0 (EXPERIMENTAL): background-audio-for-video toggle, OFF by
    // default -- mirrors autoplayNext's own prefill exactly.
    const backgroundAudioCheck = document.getElementById('background-audio-check');
    if (backgroundAudioCheck) backgroundAudioCheck.checked = !!s.backgroundAudioForVideo;
    // v1.35: deterministic background audio, OFF by default.
    const preExtractAudioCheck = document.getElementById('pre-extract-audio-check');
    if (preExtractAudioCheck) preExtractAudioCheck.checked = !!s.preExtractAudio;
    // v1.41.6: relocate hydrated imports into their channel folder. ON by
    // default -- so an older server (or a fetch that returned no such key) must
    // NOT render this as off: `!== false` keeps `undefined` checked, matching
    // the server's own default.
    const relocateHydratedCheck = document.getElementById('relocate-hydrated-check');
    if (relocateHydratedCheck) relocateHydratedCheck.checked = s.relocateHydratedImports !== false;
    // v1.51: the notification bell's instance toggle -- default-on, so the
    // prefill mirrors relocateHydratedImports' `!== false` posture.
    const notificationsEnabledCheck = document.getElementById('notifications-enabled-check');
    if (notificationsEnabledCheck) notificationsEnabledCheck.checked = s.notificationsEnabled !== false;
    // v1.34 T4: custom-vs-native mobile video controls, OFF (native) by default.
    const mobileCustomPlayerCheck = document.getElementById('mobile-custom-player-check');
    if (mobileCustomPlayerCheck) mobileCustomPlayerCheck.checked = !!s.mobileCustomPlayer;
    // v1.34: default home sort (release-date out of the box).
    const defaultSortSelect = document.getElementById('default-sort-select');
    if (defaultSortSelect) defaultSortSelect.value = typeof s.defaultSort === 'string' && s.defaultSort !== '' ? s.defaultSort : 'release-date';
    const cacheAgeSelect = document.getElementById('cache-age-select');
    if (cacheAgeSelect) cacheAgeSelect.value = String(s.cacheMaxAgeDays);
    // v1.65: trash retention (same select pattern).
    const trashRetentionSelect = document.getElementById('trash-retention-select');
    if (trashRetentionSelect) trashRetentionSelect.value = String(s.trashRetentionDays);
    const capInput = document.getElementById('cache-cap-input');
    if (capInput) {
      capInput.value = s.cacheMaxBytes != null ? bytesToGb(s.cacheMaxBytes) : '';
      const defaultGb = bytesToGb(s.effectiveCacheMaxBytes);
      capInput.placeholder = defaultGb != null ? `${defaultGb} GB (default)` : 'Default';
    }
    // v1.14.0 item 4: remember the saved value and (re-)populate the
    // select — whichever of loadConfig()/loadAutomationSettings()
    // resolves last applies the saved selection (see
    // populateDefaultViewSelect() above).
    loadedDefaultView = typeof s.defaultView === 'string' ? s.defaultView : '';
    populateDefaultViewSelect();
    // v1.32 (custom logo) / v1.33.1 (per-mode variants): reflect which
    // variants are currently set.
    updateLogoControls(!!s.customLogo, !!s.customLogoDark);
  } catch (err) {
    console.error('Failed to load automation settings:', err);
  }
}

// ---- v1.32 (Dean, "white-label"): custom header logo -----------------------
// Upload posts the RAW image bytes (route-scoped express.raw server-side --
// no multipart machinery in this app) with the file's own Content-Type;
// the server validates the type allowlist + magic bytes + 1 MB cap.
const LOGO_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// v1.33.1: tracks each variant's set/unset state so the shared status line
// can describe the combined situation after any upload/reset.
const logoVariantState = { light: false, dark: false };

function describeLogoState() {
  const { light, dark } = logoVariantState;
  if (light && dark) return 'Custom light + dark logos active.';
  if (light) return 'Custom logo active (used for both modes until a dark one is uploaded).';
  if (dark) return 'Custom dark logo active (used for both modes until a light one is uploaded).';
  return 'Using the default FileTube logo.';
}

function updateLogoControls(hasLight, hasDark) {
  logoVariantState.light = !!hasLight;
  logoVariantState.dark = !!hasDark;
  const lightReset = document.getElementById('logo-reset-btn');
  const darkReset = document.getElementById('logo-reset-btn-dark');
  const statusEl = document.getElementById('logo-status');
  if (lightReset) lightReset.hidden = !logoVariantState.light;
  if (darkReset) darkReset.hidden = !logoVariantState.dark;
  setActionStatus(statusEl, describeLogoState());
}

// Wires ONE variant's upload/reset pair against the variant-scoped routes
// (v1.33.1: `?variant=dark` for the dark set; the plain route stays the
// light/default one, byte-compatible with v1.32).
function wireLogoVariantControls(variant, inputId, uploadId, resetId) {
  const fileInput = document.getElementById(inputId);
  const uploadBtn = document.getElementById(uploadId);
  const resetBtn = document.getElementById(resetId);
  const statusEl = document.getElementById('logo-status');
  if (!fileInput || !uploadBtn || !resetBtn) return;
  const routeSuffix = variant === 'dark' ? '?variant=dark' : '';

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
      setActionStatus(statusEl, 'Logo must be a PNG, JPEG, or WebP image.', 'error');
      return;
    }
    if (file.size > 1024 * 1024) {
      setActionStatus(statusEl, 'Logo is too large (max 1 MB).', 'error');
      return;
    }
    setActionStatus(statusEl, 'Uploading…', 'busy');
    try {
      const r = await fetch('/api/settings/logo' + routeSuffix, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setActionStatus(statusEl, body.error || 'Upload failed.', 'error');
        return;
      }
      updateLogoControls(
        variant === 'light' ? true : logoVariantState.light,
        variant === 'dark' ? true : logoVariantState.dark
      );
      // Swap the live header immediately so the change is visible without a
      // reload (same helper every page's boot uses; it resolves the variant
      // for the CURRENT mode itself). `true` = force: a REPLACED same-variant
      // logo must bypass the src-equality short-circuit and cache-bust.
      if (typeof applyCustomLogoIfSet === 'function') applyCustomLogoIfSet(true);
    } catch (err) {
      setActionStatus(statusEl, 'Upload failed (network error).', 'error');
    }
  });

  resetBtn.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/settings/logo' + routeSuffix, { method: 'DELETE' });
      if (!r.ok) {
        setActionStatus(statusEl, 'Could not reset the logo.', 'error');
        return;
      }
      updateLogoControls(
        variant === 'light' ? false : logoVariantState.light,
        variant === 'dark' ? false : logoVariantState.dark
      );
      // The header swap only ever goes text->img in-page; going back to the
      // text logo (or the surviving variant) cleanly is a reload's job.
      window.location.reload();
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Could not reset the logo (network error).';
    }
  });
}

function wireLogoControls() {
  wireLogoVariantControls('light', 'logo-file-input', 'logo-upload-btn', 'logo-reset-btn');
  wireLogoVariantControls('dark', 'logo-file-input-dark', 'logo-upload-btn-dark', 'logo-reset-btn-dark');
}

// GET /api/cache/size -> "Current size: X" via the shared formatFileSize.
async function loadCacheSize() {
  const el = document.getElementById('cache-size-display');
  if (!el) return;
  try {
    const r = await fetch('/api/cache/size');
    const s = await r.json();
    el.textContent = 'Current size: ' + formatFileSize(s.bytes);
  } catch (err) {
    el.textContent = 'Current size: unknown';
    console.error('Failed to load cache size:', err);
  }
}

// Renders the "Last scanned"/scanning-progress line from a /api/scan-status
// payload. Shared by the initial load and the in-place poller below.
function renderScanStatusLine(s) {
  const el = document.getElementById('automation-scan-status');
  if (!el) return;
  if (s.scanning) {
    setActionStatus(el, `Scanning library… ${s.fileCount} file(s) found so far`, 'busy');
  } else {
    const last = s.lastScan ? formatRelativeTime(new Date(s.lastScan).getTime()) : 'never';
    setActionStatus(el, `Last scanned: ${last}`);
  }
}

// Non-redirecting scan-status poller for this box. NOTE: the existing
// pollScanStatus() above (used by "Save & Scan Library") navigates to "/"
// when the scan finishes -- fine for the folders flow, but wrong here: a
// user watching "Scan now" on the Settings page shouldn't be bounced off
// the page they're editing. This poller just keeps refreshing the
// "Last scanned" line (and the cache-size display, since a scan can touch
// on-disk state) in place until the scan completes.
function pollAutomationScanStatus() {
  if (!controller || controller.signal.aborted) return; // view torn down -- stop the chain
  const btn = document.getElementById('scan-now-btn');
  fetch('/api/scan-status')
    .then(r => r.json())
    .then(s => {
      if (!controller || controller.signal.aborted) return;
      renderScanStatusLine(s);
      if (s.scanning) {
        setTimeout(pollAutomationScanStatus, 1000);
      } else {
        setButtonBusy(btn, false);
        loadCacheSize();
      }
    })
    .catch(() => {
      // Transient fetch failure -- retry rather than leaving the button
      // stuck disabled or surfacing an error on the settings page.
      if (!controller || controller.signal.aborted) return;
      setTimeout(pollAutomationScanStatus, 1500);
    });
}

// GET /api/scan-status on load: populate the line, and join an
// already-in-progress scan (e.g. the periodic timer fired while this page
// was loading) instead of showing a stale "Last scanned" line.
async function loadScanStatusLine() {
  try {
    const r = await fetch('/api/scan-status');
    const s = await r.json();
    renderScanStatusLine(s);
    if (s.scanning) {
      setButtonBusy(document.getElementById('scan-now-btn'), true);
      pollAutomationScanStatus();
    }
  } catch (err) {
    console.error('Failed to load scan status:', err);
  }
}

// ---- v1.38.0 Part A: book folders --------------------------------------------
//
// A thin UI over the EXISTING, already-validated /api/books/config +
// /api/books/scan routes (config was API-only since v1.37.0). Book roots are an
// unordered set of paths -- no display-name/hide/reorder (that machinery is
// media-only). Rows are built with createElement/textContent (XSS-safe for the
// folder-path strings, no escapeHtml/innerHTML interpolation needed).

function renderBookFolders() {
  const container = document.getElementById('book-folders-builder-list');
  if (!container) return;
  container.innerHTML = '';
  if (bookFolders.length === 0) {
    container.innerHTML = '<div class="empty-folders-msg">No book folders configured yet. Add one above.</div>';
    return;
  }
  bookFolders.forEach((folder, index) => {
    const row = document.createElement('div');
    row.className = 'folder-item-row';
    const pathWrap = document.createElement('div');
    pathWrap.style.cssText = 'flex:1; min-width:0;';
    const pathText = document.createElement('div');
    pathText.className = 'folder-path-text';
    pathText.title = folder;
    pathText.textContent = folder;
    pathWrap.appendChild(pathText);
    row.appendChild(pathWrap);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-folder-btn';
    removeBtn.title = 'Remove folder';
    removeBtn.textContent = '×'; // ×
    removeBtn.addEventListener('click', () => {
      bookFolders.splice(index, 1);
      renderBookFolders();
    }, { signal: controller.signal });
    row.appendChild(removeBtn);
    container.appendChild(row);
  });
}

async function loadBookConfig() {
  try {
    const r = await fetch('/api/books/config');
    if (!r.ok) return; // books disabled / no folders -> leave the empty state
    const data = await r.json();
    bookFolders = Array.isArray(data.folders) ? data.folders.slice() : [];
    renderBookFolders();
  } catch (err) {
    console.error('Failed to load book folders:', err);
  }
}

function pollBookScanStatus() {
  const status = document.getElementById('book-scan-status');
  fetch('/api/books/scan-status')
    .then((r) => r.json())
    .then((s) => {
      if (!status) return;
      if (s && s.scanning) {
        setActionStatus(status, 'Scanning books…', 'busy');
        setTimeout(pollBookScanStatus, 1000);
      } else {
        setActionStatus(status, s && s.lastScan ? 'Books scanned.' : 'Idle.');
      }
    })
    .catch(() => {});
}

function wireBookFolderControls(signal) {
  const addBtn = document.getElementById('add-book-folder-btn');
  const input = document.getElementById('new-book-folder-path');
  if (addBtn && input) {
    const add = () => {
      const v = input.value.trim();
      if (!v) return;
      if (bookFolders.includes(v)) { alert('This book folder is already added.'); return; }
      bookFolders.push(v);
      renderBookFolders();
      input.value = '';
    };
    addBtn.addEventListener('click', add, { signal });
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') add(); }, { signal });
  }

  const saveBtn = document.getElementById('save-book-config-btn');
  const status = document.getElementById('book-scan-status');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      setActionStatus(status, 'Saving…', 'busy');
      try {
        const r = await fetch('/api/books/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folders: bookFolders }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          // The server validated/deduped/overlap-checked; reflect its list back
          // and reflect that it already kicked a scan.
          bookFolders = Array.isArray(data.folders) ? data.folders.slice() : bookFolders;
          renderBookFolders();
          setActionStatus(status, 'Saved — scanning books…', 'busy');
          pollBookScanStatus();
        } else {
          // Surface the server's readable error (existence / media-overlap).
          setActionStatus(status, (data && data.error) || 'Could not save book folders.', 'error');
        }
      } catch (err) {
        setActionStatus(status, 'Could not save book folders.', 'error');
        console.error('Save book folders failed:', err);
      }
    }, { signal });
  }

  const scanBtn = document.getElementById('scan-books-btn');
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      setButtonBusy(scanBtn, true);
      try {
        await fetch('/api/books/scan', { method: 'POST' });
        pollBookScanStatus();
      } catch (err) {
        console.error('Book scan failed to start:', err);
      } finally {
        setButtonBusy(scanBtn, false);
      }
    }, { signal });
  }
}

// ---- v1.44 music folders (mirrors the book-folder controls verbatim) --------

function renderMusicFolders() {
  const container = document.getElementById('music-folders-builder-list');
  if (!container) return;
  container.innerHTML = '';
  if (musicFolders.length === 0) {
    container.innerHTML = '<div class="empty-folders-msg">No music folders configured yet. Add one above.</div>';
    return;
  }
  musicFolders.forEach((folder, index) => {
    const row = document.createElement('div');
    row.className = 'folder-item-row';
    const pathWrap = document.createElement('div');
    pathWrap.style.cssText = 'flex:1; min-width:0;';
    const pathText = document.createElement('div');
    pathText.className = 'folder-path-text';
    pathText.title = folder;
    pathText.textContent = folder;
    pathWrap.appendChild(pathText);
    row.appendChild(pathWrap);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-folder-btn';
    removeBtn.title = 'Remove folder';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      musicFolders.splice(index, 1);
      renderMusicFolders();
    }, { signal: controller.signal });
    row.appendChild(removeBtn);
    container.appendChild(row);
  });
}

async function loadMusicConfig() {
  try {
    const r = await fetch('/api/music/config');
    if (!r.ok) return; // music disabled / no folders -> leave the empty state
    const data = await r.json();
    musicFolders = Array.isArray(data.folders) ? data.folders.slice() : [];
    renderMusicFolders();
  } catch (err) {
    console.error('Failed to load music folders:', err);
  }
}

function pollMusicScanStatus() {
  const status = document.getElementById('music-scan-status');
  fetch('/api/music/scan-status')
    .then((r) => r.json())
    .then((s) => {
      if (!status) return;
      if (s && s.scanning) {
        setActionStatus(status, 'Scanning music…', 'busy');
        setTimeout(pollMusicScanStatus, 1000);
      } else {
        setActionStatus(status, s && s.lastScan ? 'Music scanned.' : 'Idle.');
      }
    })
    .catch(() => {});
}

function wireMusicFolderControls(signal) {
  const addBtn = document.getElementById('add-music-folder-btn');
  const input = document.getElementById('new-music-folder-path');
  if (addBtn && input) {
    const add = () => {
      const v = input.value.trim();
      if (!v) return;
      if (musicFolders.includes(v)) { alert('This music folder is already added.'); return; }
      musicFolders.push(v);
      renderMusicFolders();
      input.value = '';
    };
    addBtn.addEventListener('click', add, { signal });
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') add(); }, { signal });
  }

  const saveBtn = document.getElementById('save-music-config-btn');
  const status = document.getElementById('music-scan-status');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      setActionStatus(status, 'Saving…', 'busy');
      try {
        const r = await fetch('/api/music/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folders: musicFolders }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          musicFolders = Array.isArray(data.folders) ? data.folders.slice() : musicFolders;
          renderMusicFolders();
          setActionStatus(status, 'Saved — scanning music…', 'busy');
          pollMusicScanStatus();
        } else {
          // Surface the server's readable error (existence / media-or-book overlap).
          setActionStatus(status, (data && data.error) || 'Could not save music folders.', 'error');
        }
      } catch (err) {
        setActionStatus(status, 'Could not save music folders.', 'error');
        console.error('Save music folders failed:', err);
      }
    }, { signal });
  }

  const scanBtn = document.getElementById('scan-music-btn');
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      setButtonBusy(scanBtn, true);
      try {
        await fetch('/api/music/scan', { method: 'POST' });
        pollMusicScanStatus();
      } catch (err) {
        console.error('Music scan failed to start:', err);
      } finally {
        setButtonBusy(scanBtn, false);
      }
    }, { signal });
  }
}

function wireStaticControls(signal) {
  const addFolderBtn = document.getElementById('add-folder-btn');
  const newFolderPathInput = document.getElementById('new-folder-path');
  if (addFolderBtn && newFolderPathInput) {
    addFolderBtn.addEventListener('click', () => {
      const pathValue = newFolderPathInput.value.trim();
      if (!pathValue) return;
      if (configuredFolders.includes(pathValue)) {
        alert('This folder directory is already added.');
        return;
      }
      configuredFolders.push(pathValue);
      renderFolders();
      newFolderPathInput.value = '';
    }, { signal });

    newFolderPathInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addFolderBtn.click();
    }, { signal });
  }

  const saveConfigBtn = document.getElementById('save-config-btn');
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
      const statusText = document.getElementById('scan-status');
      if (!statusText) return;
      setActionStatus(statusText, 'Saving configuration…', 'busy');

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folders: configuredFolders, folderSettings })
        });
        const data = await response.json();

        if (data.success) {
          renderSidebarFolders(data.folders, data.folderSettings || {});
          // The scan runs in the background — poll it so the user sees real progress.
          pollScanStatus(statusText);
        } else {
          setActionStatus(statusText, 'Error: ' + data.error, 'error');
        }
      } catch (err) {
        setActionStatus(statusText, 'Error saving configuration.', 'error');
        console.error(err);
      }
    }, { signal });
  }

  // Default view (v1.14.0 item 4): saves the selected folder path (or ''
  // for "Most recent") the same way as every other automation setting.
  const defaultViewSelect = document.getElementById('default-view-select');
  if (defaultViewSelect) {
    defaultViewSelect.addEventListener('change', (e) => {
      saveAutomationSetting('defaultView', e.target.value,
        document.getElementById('default-view-error'));
    }, { signal });
  }

  const scanIntervalSelect = document.getElementById('scan-interval-select');
  if (scanIntervalSelect) {
    scanIntervalSelect.addEventListener('change', (e) => {
      saveAutomationSetting('scanIntervalMinutes', parseInt(e.target.value, 10),
        document.getElementById('scan-interval-error'));
    }, { signal });
  }

  // v1.35: pre-extract background audio toggle.
  const preExtractAudioCheck = document.getElementById('pre-extract-audio-check');
  if (preExtractAudioCheck) {
    preExtractAudioCheck.addEventListener('change', (e) => {
      saveAutomationSetting('preExtractAudio', e.target.checked,
        document.getElementById('pre-extract-audio-error'));
    }, { signal });
  }

  // v1.41.6: relocate-hydrated-imports toggle -- same pattern as preExtractAudio.
  const relocateHydratedCheck = document.getElementById('relocate-hydrated-check');
  if (relocateHydratedCheck) {
    relocateHydratedCheck.addEventListener('change', (e) => {
      saveAutomationSetting('relocateHydratedImports', e.target.checked,
        document.getElementById('relocate-hydrated-error'));
    }, { signal });
  }

  // v1.51: notification-bell toggle -- same pattern as relocateHydratedImports.
  const notificationsEnabledCheck = document.getElementById('notifications-enabled-check');
  if (notificationsEnabledCheck) {
    notificationsEnabledCheck.addEventListener('change', (e) => {
      saveAutomationSetting('notificationsEnabled', e.target.checked,
        document.getElementById('notifications-enabled-error'));
    }, { signal });
  }

  // v1.66: web push controls (see initPushControls below - probe-gated, so
  // wiring lives with its own loader rather than this static block).
  initPushControls(signal);

  // v1.34 T4: custom mobile player toggle -- same pattern as backgroundAudio.
  const mobileCustomPlayerCheck = document.getElementById('mobile-custom-player-check');
  if (mobileCustomPlayerCheck) {
    mobileCustomPlayerCheck.addEventListener('change', (e) => {
      saveAutomationSetting('mobileCustomPlayer', e.target.checked,
        document.getElementById('mobile-custom-player-error'));
    }, { signal });
  }

  // v1.34: default home sort -- same immediate-save pattern as defaultView.
  const defaultSortSelect = document.getElementById('default-sort-select');
  if (defaultSortSelect) {
    defaultSortSelect.addEventListener('change', (e) => {
      saveAutomationSetting('defaultSort', e.target.value,
        document.getElementById('default-sort-error'));
    }, { signal });
  }

  const pruneMissingCheck = document.getElementById('prune-missing-check');
  if (pruneMissingCheck) {
    pruneMissingCheck.addEventListener('change', (e) => {
      saveAutomationSetting('pruneMissing', e.target.checked,
        document.getElementById('prune-missing-error'));
    }, { signal });
  }

  // v1.16.0 FR-3 (T3): autoplay-next -- saves immediately on toggle, mirroring
  // pruneMissing's own boolean-checkbox pattern exactly.
  const autoplayNextCheck = document.getElementById('autoplay-next-check');
  if (autoplayNextCheck) {
    autoplayNextCheck.addEventListener('change', (e) => {
      saveAutomationSetting('autoplayNext', e.target.checked,
        document.getElementById('autoplay-next-error'));
    }, { signal });
  }

  // v1.27.0 (EXPERIMENTAL): background-audio-for-video -- saves immediately
  // on toggle, mirroring autoplayNext's own boolean-checkbox pattern exactly.
  const backgroundAudioCheck = document.getElementById('background-audio-check');
  if (backgroundAudioCheck) {
    backgroundAudioCheck.addEventListener('change', (e) => {
      saveAutomationSetting('backgroundAudioForVideo', e.target.checked,
        document.getElementById('background-audio-error'));
    }, { signal });
  }

  const cacheAgeSelect = document.getElementById('cache-age-select');
  if (cacheAgeSelect) {
    cacheAgeSelect.addEventListener('change', (e) => {
      saveAutomationSetting('cacheMaxAgeDays', parseInt(e.target.value, 10),
        document.getElementById('cache-age-error'));
    }, { signal });
  }

  // v1.65: trash retention -- save, then re-render the list (the days-left
  // labels depend on it).
  const trashRetentionSelect = document.getElementById('trash-retention-select');
  if (trashRetentionSelect) {
    trashRetentionSelect.addEventListener('change', async (e) => {
      await saveAutomationSetting('trashRetentionDays', parseInt(e.target.value, 10),
        document.getElementById('trash-retention-error'));
      if (typeof renderTrashSection.__refresh === 'function') renderTrashSection.__refresh();
    }, { signal });
  }

  // Resume-prompt threshold (D2, v1.24.0, T13): immediate-apply localStorage
  // write, same pattern as the theme/icon pickers (no Save button, no server
  // round-trip -- see the section comment above loadResumeThresholdControl).
  // Blank/garbage/negative input snaps back to the 60s default rather than
  // persisting an invalid value.
  const resumeThresholdInput = document.getElementById('resume-threshold-input');
  if (resumeThresholdInput) {
    resumeThresholdInput.addEventListener('change', (e) => {
      const raw = e.target.value.trim();
      const n = parseFloat(raw);
      const value = raw !== '' && Number.isFinite(n) && n >= 0 ? n : RESUME_THRESHOLD_DEFAULT;
      e.target.value = String(value);
      try { localStorage.setItem(RESUME_THRESHOLD_KEY, String(value)); } catch (_) { /* storage disabled/full -- best-effort only */ }
    }, { signal });
  }

  // v1.27.1: lifecycle debug overlay toggle -- same immediate-apply
  // localStorage pattern as the resume-threshold control just above, writing
  // the exact key/value shape `initDebugLifecycleFlag()` (player.js) already
  // writes for the `?debugLifecycle=1`/`=0` URL-param mechanism, so both
  // paths stay interchangeable. player.js does not currently expose a hook to
  // re-render its already-initialized overlay from another page's script, so
  // a reload is the simplest correct way to pick up a change made here (see
  // the hint text in setup.html) -- deliberately not adding a new cross-file
  // API surface just for this.
  const debugLifecycleCheck = document.getElementById('debug-lifecycle-check');
  if (debugLifecycleCheck) {
    debugLifecycleCheck.addEventListener('change', (e) => {
      try {
        if (e.target.checked) localStorage.setItem(DEBUG_LIFECYCLE_STORAGE_KEY, '1');
        else localStorage.removeItem(DEBUG_LIFECYCLE_STORAGE_KEY);
      } catch (_) { /* storage disabled/full -- best-effort only */ }
    }, { signal });
  }

  // v1.45.6 (Dean): per-page sort — a CLIENT toggle (localStorage), like the
  // debug-lifecycle overlay above. Prefill from + persist via the common.js
  // helpers (isPerPageSortEnabled/setPerPageSortEnabled) so the storage key
  // lives in exactly one place.
  const perPageSortCheck = document.getElementById('per-page-sort-check');
  if (perPageSortCheck) {
    perPageSortCheck.checked = isPerPageSortEnabled();
    perPageSortCheck.addEventListener('change', (e) => {
      setPerPageSortEnabled(e.target.checked);
    }, { signal });
  }

  // v1.44: home-page resume-row toggles (device-local, default ON). Keys match
  // main.js's homeRowEnabled (`!== '0'` = on): checked -> clear (default on),
  // unchecked -> '0'.
  wireHomeRowToggle('home-continue-watching-check', 'ft-home-continue-watching', signal);
  wireHomeRowToggle('home-continue-listening-check', 'ft-home-continue-listening', signal);
  wireHomeRowToggle('home-continue-reading-check', 'ft-home-continue-reading', signal);

  // Size-cap input: 'change' (fires on blur/Enter, not per keystroke) is a
  // natural debounce for a free-typed number field. Blank -> null ("use the
  // default"); a non-empty value that isn't a valid positive number is
  // rejected client-side (with the same field-error styling as a server 400)
  // without ever calling the API.
  const cacheCapInput = document.getElementById('cache-cap-input');
  if (cacheCapInput) {
    cacheCapInput.addEventListener('change', async (e) => {
      const errorEl = document.getElementById('cache-cap-error');
      const raw = e.target.value.trim();
      const bytes = gbToBytes(raw);
      if (raw !== '' && bytes === null) {
        setFieldError(errorEl, 'Enter a positive number of GB, or leave blank for the default.');
        return;
      }
      const saved = await saveAutomationSetting('cacheMaxBytes', bytes, errorEl);
      if (saved) {
        // Reflect the (possibly changed) effective default in the placeholder.
        const defaultGb = bytesToGb(saved.effectiveCacheMaxBytes);
        e.target.placeholder = defaultGb != null ? `${defaultGb} GB (default)` : 'Default';
      }
    }, { signal });
  }

  const scanNowBtn = document.getElementById('scan-now-btn');
  if (scanNowBtn) {
    scanNowBtn.addEventListener('click', async () => {
      setButtonBusy(scanNowBtn, true);
      try {
        const r = await fetch('/api/scan', { method: 'POST' });
        if (r.status === 409) {
          // A scan (automatic or manual) is already running -- join its
          // progress instead of surfacing an error (no error toast for 409).
          pollAutomationScanStatus();
          return;
        }
        const data = await r.json();
        if (data.success) {
          pollAutomationScanStatus();
        } else {
          setButtonBusy(scanNowBtn, false);
          console.error('Scan failed to start:', data.error);
        }
      } catch (err) {
        setButtonBusy(scanNowBtn, false);
        console.error('Failed to start scan:', err);
      }
    }, { signal });
  }

  const clearCacheBtn = document.getElementById('clear-cache-btn');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', () => {
      showConfirmModal(
        'Clear transcode cache?',
        'This deletes all cached transcoded files. They will be regenerated automatically the next time they\'re watched.',
        async () => {
          const original = clearCacheBtn.textContent;
          setButtonBusy(clearCacheBtn, true);
          clearCacheBtn.textContent = 'Clearing…';
          try {
            const r = await fetch('/api/cache/clear', { method: 'POST' });
            const data = await r.json();
            if (data.success) {
              await loadCacheSize();
            } else {
              console.error('Failed to clear cache:', data.error);
            }
          } catch (err) {
            console.error('Failed to clear cache:', err);
          } finally {
            setButtonBusy(clearCacheBtn, false);
            clearCacheBtn.textContent = original;
          }
        }
      );
    }, { signal });
  }
}

// ---- v1.43: Account + admin user management -------------------------------
// Server-enforced (every /api/users route 403s for non-admins); the client
// role check below only decides what to RENDER. All display text uses
// hyphens, never em dashes (Dean's hard rule).

function accountErrorEl() {
  return document.getElementById('add-user-error');
}

async function initAccountSection(signal) {
  const chip = document.getElementById('account-chip');
  const logoutBtn = document.getElementById('logout-btn');
  if (!chip || !logoutBtn) return;
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_) { /* the redirect below lands on /login either way */ }
    // v1.53 gate W4: pins in the capability cache are PER-USER -- a logout
    // must not let the next login in this tab paint the previous user's
    // pinned channels for a frame.
    try { sessionStorage.removeItem('ft-cap-cache-v1'); } catch (_) { /* storage disabled */ }
    window.location.href = '/login';
  }, { signal });

  let me = null;
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) me = await r.json();
  } catch (_) { /* chip shows the failure text below */ }
  if (!me || !me.user) {
    chip.textContent = 'Could not load your account.';
    return;
  }
  const roleLabel = me.user.role === 'admin' ? 'admin' : 'member';
  chip.textContent = `Signed in as ${me.user.displayName || me.user.username} (${roleLabel})`;

  if (me.user.role === 'admin') {
    const usersBox = document.getElementById('users-box');
    if (usersBox) usersBox.hidden = false;
    wireAddUserForm(signal, me.user);
    loadUsersList(signal, me.user);
    const backupBox = document.getElementById('backup-box');
    if (backupBox) backupBox.hidden = false;
    wireRestoreControls(signal);
  }
}

// v1.43: restore-from-file. Reads the picked JSON, confirms (a restore
// REPLACES config + accounts), POSTs, and surfaces the server's honest
// error text verbatim (the self-lockout refusal in particular).
function wireRestoreControls(signal) {
  const btn = document.getElementById('restore-btn');
  const fileInput = document.getElementById('restore-file-input');
  const statusEl = document.getElementById('restore-status');
  if (!btn || !fileInput) return;
  btn.addEventListener('click', async () => {
    setFieldError(statusEl, null);
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      setFieldError(statusEl, 'Pick a backup file first.');
      return;
    }
    let bundle;
    try {
      bundle = JSON.parse(await file.text());
    } catch (_) {
      setFieldError(statusEl, 'That file is not valid JSON.');
      return;
    }
    if (!window.confirm('Restore this backup? It replaces this FileTube\'s configuration and accounts with the backup\'s contents.')) return;
    try {
      const r = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFieldError(statusEl, data.error || 'Restore failed.');
        return;
      }
      window.alert('Restore complete. The page will reload.');
      window.location.reload();
    } catch (_) {
      setFieldError(statusEl, 'Restore failed (network error).');
    }
  }, { signal });
}

async function loadUsersList(signal, me) {
  const listEl = document.getElementById('users-list');
  if (!listEl) return;
  let payload = null;
  try {
    const r = await fetch('/api/users');
    if (r.ok) payload = await r.json();
  } catch (_) { /* rendered below */ }
  if (!payload || !Array.isArray(payload.users)) {
    listEl.textContent = 'Could not load the user list.';
    return;
  }
  listEl.innerHTML = '';
  for (const user of payload.users) {
    listEl.appendChild(renderUserRow(user, me, signal));
  }
}

// One row per user: name + badges, then the admin actions. Buttons re-fetch
// the list after every change so the rendered state is always the server's.
function renderUserRow(user, me, signal) {
  const row = document.createElement('div');
  row.className = 'users-row';
  const isSelf = user.id === me.id;

  const who = document.createElement('div');
  who.className = 'users-row-who';
  const name = document.createElement('strong');
  name.textContent = user.displayName || user.username;
  who.appendChild(name);
  const meta = document.createElement('span');
  meta.className = 'users-row-meta';
  const badges = [user.username, user.role];
  if (user.canManageSubscriptions) badges.push('subscriptions');
  if (user.disabled) badges.push('disabled');
  if (isSelf) badges.push('you');
  meta.textContent = badges.join(' - ');
  who.appendChild(meta);
  row.appendChild(who);

  const actions = document.createElement('div');
  actions.className = 'users-row-actions';
  const refresh = () => loadUsersList(signal, me);
  const act = async (path, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      const r = await fetch(path, {
        method: body === undefined ? 'DELETE' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        window.alert(data.error || 'That change was refused.');
        return;
      }
      refresh();
    } catch (_) {
      window.alert('That change failed (network error).');
    }
  };

  const addBtn = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm';
    b.textContent = label;
    b.addEventListener('click', onClick, { signal });
    actions.appendChild(b);
  };

  addBtn('Reset password', () => {
    const pw = window.prompt(`New password for ${user.username} (at least 8 characters):`);
    if (pw === null) return;
    act(`/api/users/${user.id}/password`, { password: pw });
  });
  if (!isSelf) {
    addBtn(user.disabled ? 'Enable' : 'Disable', () => act(`/api/users/${user.id}/disabled`, { disabled: !user.disabled }));
  }
  addBtn(user.role === 'admin' ? 'Make member' : 'Make admin', () => act(`/api/users/${user.id}/role`, { role: user.role === 'admin' ? 'member' : 'admin' }));
  addBtn(user.canManageSubscriptions ? 'Revoke subscriptions' : 'Allow subscriptions', () => act(`/api/users/${user.id}/subscriptions-flag`, { canManageSubscriptions: !user.canManageSubscriptions }));
  if (!isSelf) {
    addBtn('Delete', () => act(`/api/users/${user.id}`, undefined,
      `Delete ${user.username}? Their watch progress, likes, reading positions, and pins go with the account. This cannot be undone.`));
  }
  row.appendChild(actions);
  return row;
}

function wireAddUserForm(signal, me) {
  const btn = document.getElementById('add-user-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const errorEl = accountErrorEl();
    const username = (document.getElementById('new-user-username').value || '').trim();
    const displayName = (document.getElementById('new-user-displayname').value || '').trim();
    const password = document.getElementById('new-user-password').value || '';
    const role = document.getElementById('new-user-role').value === 'admin' ? 'admin' : 'member';
    const canManageSubscriptions = document.getElementById('new-user-subs-flag').checked;
    setFieldError(errorEl, null);
    try {
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName, password, role, canManageSubscriptions }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFieldError(errorEl, data.error || 'Could not add the user.');
        return;
      }
      document.getElementById('new-user-username').value = '';
      document.getElementById('new-user-displayname').value = '';
      document.getElementById('new-user-password').value = '';
      document.getElementById('new-user-subs-flag').checked = false;
      loadUsersList(signal, me);
    } catch (_) {
      setFieldError(errorEl, 'Could not add the user (network error).');
    }
  }, { signal });
}

// ---- Registered view module (FR-1, T1) ---------------------------------

// ---- v1.65: the Trash section ----------------------------------------------

// Pure row builders (node:test-covered without a browser -- the
// transcodeNamesSuffix export posture).
function escapeTrashHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// How long a trashed item has left before the retention sweep takes it.
// nowMs injectable for deterministic tests.
function trashDaysLeftLabel(trashedAt, retentionDays, nowMs) {
  var days = Number(retentionDays);
  if (!isFinite(days) || days <= 0) return 'kept until purged';
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  var left = Math.ceil((Number(trashedAt) + days * 86400000 - now) / 86400000);
  if (!isFinite(left)) return 'kept until purged';
  if (left <= 0) return 'purging soon';
  return left === 1 ? '1 day left' : left + ' days left';
}

function formatTrashSize(bytes) {
  var n = Number(bytes);
  if (!isFinite(n) || n <= 0) return '';
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + ' GB';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

// One trash row: thumbnail (the sidecar re-keyed with the move, so
// /thumbnail/<trashId> resolves), title, meta line, Restore + two-tap Purge.
function buildTrashRowHtml(item, retentionDays, nowMs) {
  var tid = escapeTrashHtml(item.trashId);
  var title = escapeTrashHtml(item.title || item.name || 'Untitled');
  var metaBits = [];
  var size = formatTrashSize(item.size);
  if (size) metaBits.push(escapeTrashHtml(size));
  metaBits.push(escapeTrashHtml(trashDaysLeftLabel(item.trashedAt, retentionDays, nowMs)));
  return '' +
    '<div class="trash-row" data-trash-id="' + tid + '">' +
    '<img class="trash-thumb" src="/thumbnail/' + encodeURIComponent(item.trashId || '') + '" alt="" loading="lazy" />' +
    '<div class="trash-info">' +
    '<div class="trash-title" title="' + title + '">' + title + '</div>' +
    '<div class="trash-meta">' + metaBits.join(' &bull; ') + '</div>' +
    '</div>' +
    '<button type="button" class="btn btn-sm trash-restore-btn" data-trash-id="' + tid + '">Restore</button>' +
    '<button type="button" class="btn btn-sm trash-purge-btn" data-trash-id="' + tid + '">' +
    '<span class="trash-purge-label">Purge</span><span class="trash-purge-confirm">Sure?</span>' +
    '</button>' +
    '</div>';
}

// Fetch + render the Trash list; wires Restore (single tap -- it destroys
// nothing) and the two-tap Purge (the history/queue arm pattern). Re-renders
// after every action and after a retention change (the days-left labels).
function renderTrashSection(signal) {
  const listEl = document.getElementById('trash-list');
  const emptyEl = document.getElementById('trash-empty');
  if (!listEl) return;

  let armed = null; // { id, timer }
  function disarm() {
    if (!armed) return;
    clearTimeout(armed.timer);
    const el = listEl.querySelector('.trash-purge-btn.trash-confirming');
    if (el) el.classList.remove('trash-confirming');
    armed = null;
  }

  function refresh() {
    fetch('/api/trash')
      .then((r) => { if (!r.ok) throw new Error('trash fetch failed: ' + r.status); return r.json(); })
      .then((body) => {
        if (signal.aborted) return;
        disarm();
        listEl.innerHTML = body.items.map((item) => buildTrashRowHtml(item, body.retentionDays)).join('');
        if (emptyEl) emptyEl.hidden = body.items.length > 0;
      })
      .catch((err) => { if (!signal.aborted) console.error('Trash: list failed', err); });
  }

  listEl.addEventListener('click', (e) => {
    const restoreBtn = e.target.closest('.trash-restore-btn');
    if (restoreBtn) {
      const tid = restoreBtn.getAttribute('data-trash-id');
      if (!tid) return;
      restoreBtn.disabled = true;
      fetch('/api/trash/' + encodeURIComponent(tid) + '/restore', { method: 'POST' })
        .then(async (r) => {
          if (signal.aborted) return;
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            if (typeof showToast === 'function') showToast(body.error || 'Could not restore.');
          } else if (typeof showToast === 'function') {
            showToast('Restored.');
          }
          refresh();
        })
        .catch(() => { if (!signal.aborted) refresh(); });
      return;
    }
    const purgeBtn = e.target.closest('.trash-purge-btn');
    if (purgeBtn) {
      const tid = purgeBtn.getAttribute('data-trash-id');
      if (!tid) return;
      if (!(armed && armed.id === tid)) {
        disarm();
        purgeBtn.classList.add('trash-confirming');
        armed = { id: tid, timer: setTimeout(disarm, 3000) };
        return;
      }
      disarm();
      fetch('/api/trash/' + encodeURIComponent(tid), { method: 'DELETE' })
        .then(async (r) => {
          if (signal.aborted) return;
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            if (typeof showToast === 'function') showToast(body.error || 'Could not purge.');
          }
          refresh();
        })
        .catch(() => { if (!signal.aborted) refresh(); });
    }
  }, { signal });

  refresh();
  // Expose the re-render for the retention listener (labels change with it).
  renderTrashSection.__refresh = refresh;
}

// ---- v1.66 web push controls ------------------------------------------------
// Visibility: the whole group stays hidden unless GET /api/push/key answers
// 200 (the bell's three-way feature gate, probe-not-assume like the bell
// itself). Support: without serviceWorker+PushManager the buttons hide and
// the status line says WHY (iOS needs the home-screen app; push needs
// HTTPS) - an honest explanation, never a dead button. The Enable button is
// the USER GESTURE the permission prompt requires (iOS hard requirement).
function pushSupportProblem() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    if (typeof window !== 'undefined' && window.location && window.location.protocol === 'http:') {
      return 'Push needs HTTPS - this page was loaded over plain http.';
    }
    return 'This browser does not support push here. On iPhone/iPad: Share → Add to Home Screen, then enable from the installed app.';
  }
  if (typeof window === 'undefined' || !('PushManager' in window) || !('Notification' in window)) {
    return 'This browser does not support Web Push notifications.';
  }
  return null;
}

function initPushControls(signal) {
  const group = document.getElementById('push-controls');
  const userCheck = document.getElementById('push-user-enabled-check');
  const enableBtn = document.getElementById('push-device-enable-btn');
  const disableBtn = document.getElementById('push-device-disable-btn');
  const statusEl = document.getElementById('push-device-status');
  const errorEl = document.getElementById('push-error');
  if (!group || !userCheck || !enableBtn || !disableBtn || !statusEl) return;

  // v1.67.1 ROOT-CAUSE FIX: .field-error is display:none by default (it is
  // only revealed by toggling display, see setFieldError). The v1.66 setError
  // set textContent ONLY, so EVERY push error message - denied permission, a
  // subscribe() DOMException, a server refusal - was written to a hidden
  // element and never seen. Route through setFieldError so the message
  // actually shows/clears like every other field error on this page.
  const setError = (msg) => setFieldError(errorEl, msg);

  const reflectDevice = (sub) => {
    const problem = pushSupportProblem();
    if (problem) {
      enableBtn.hidden = true;
      disableBtn.hidden = true;
      statusEl.textContent = problem;
      return;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      enableBtn.hidden = true;
      disableBtn.hidden = true;
      statusEl.textContent = 'Notifications are blocked for this site in the browser settings.';
      return;
    }
    enableBtn.hidden = Boolean(sub);
    disableBtn.hidden = !sub;
    statusEl.textContent = sub ? 'This device receives push notifications.' : 'Not enabled on this device.';
  };

  const currentSubscription = () => {
    if (pushSupportProblem()) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration()
      .then((reg) => (reg && reg.pushManager ? reg.pushManager.getSubscription() : null))
      .catch(() => null);
  };

  fetch('/api/push/key')
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      if (!body || !body.key) return; // feature off -> the group stays hidden
      group.hidden = false;
      fetch('/api/auth/me')
        .then((r) => (r.ok ? r.json() : null))
        .then((me) => {
          if (me) userCheck.checked = !(me.settings && me.settings.pushEnabled === 'off');
        })
        .catch(() => { /* default checked state stands */ });
      currentSubscription().then(reflectDevice);

      userCheck.addEventListener('change', (e) => {
        setError('');
        fetch('/api/me/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pushEnabled: e.target.checked ? 'on' : 'off' }),
        }).then((r) => { if (!r.ok) setError('Could not save the push preference.'); })
          .catch(() => setError('Could not save the push preference.'));
      }, { signal });

      enableBtn.addEventListener('click', async () => {
        setError('');
        enableBtn.disabled = true;
        try {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') {
            // v1.67.1: was a SILENT return. Now says why (blocked vs
            // dismissed) - the decision is table-tested in common.js.
            setError(window.FileTube.describePushEnableOutcome(perm));
            reflectDevice(null);
            return;
          }
          await window.FileTube.registerPushWorker();
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: window.FileTube.pushB64urlToUint8(body.key),
          });
          const res = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub.toJSON()),
          });
          if (!res.ok) {
            // The browser holds a subscription the server refused - drop it
            // or the device believes it is enabled while receiving nothing.
            await sub.unsubscribe().catch(() => {});
            const b = await res.json().catch(() => null);
            setError((b && b.error) || 'The server refused this subscription.');
            reflectDevice(null);
            return;
          }
          reflectDevice(sub);
        } catch (err) {
          // v1.67.2: the raw exception ALWAYS rides the message. v1.67.1 hid
          // it behind ?pushdebug=1, which is unreachable on the one device
          // that needs it - the installed iOS PWA has no address bar to add
          // a query string with. The name/message pair is exactly what a
          // no-console device must surface: this is the step that talks to
          // the push service (Apple on iOS), and e.g. an AbortError here
          // usually means the device could not reach it (DNS blocker,
          // Lockdown Mode, VPN). Nothing sensitive rides a DOMException.
          const base = 'Could not enable push on this device (the browser could not register with the push service).';
          setError(err ? `${base} [${err.name || 'Error'}: ${err.message || String(err)}]` : base);
          reflectDevice(null);
        } finally {
          enableBtn.disabled = false;
        }
      }, { signal });

      disableBtn.addEventListener('click', async () => {
        setError('');
        disableBtn.disabled = true;
        try {
          const sub = await currentSubscription();
          if (sub) {
            // Server first (needs the endpoint), then the browser side;
            // either alone would leave a half-dead subscription, and the
            // boot reconcile would resurrect a browser-side survivor.
            await fetch('/api/push/unsubscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: sub.endpoint }),
            }).catch(() => {});
            await sub.unsubscribe().catch(() => {});
          }
          reflectDevice(null);
        } catch {
          setError('Could not disable push on this device.');
        } finally {
          disableBtn.disabled = false;
        }
      }, { signal });
    })
    .catch(() => { /* probe failure -> group stays hidden (fail closed) */ });
}

function init(root) {
  controller = new AbortController();
  configuredFolders = [];
  folderSettings = {};
  syntheticFolders = [];
  loadedDefaultView = null;

  // v1.55 Track D: per-section collapse persistence (details toggles).
  // Scoped to the view root (QA S1) with a document fallback.
  wireCollapsibleSections('setup', root || document, controller.signal);
  wireStaticControls(controller.signal);
  wireBookFolderControls(controller.signal); // v1.38.0 Part A
  wireMusicFolderControls(controller.signal); // v1.44 music
  renderThemePicker();
  renderIconPicker();
  wireHideStarsControl(controller.signal); // v1.63.1: the fake-stars toggle
  loadResumeThresholdControl();
  loadDebugLifecycleControl();
  loadHomeRowControl('home-continue-watching-check', 'ft-home-continue-watching');
  loadHomeRowControl('home-continue-listening-check', 'ft-home-continue-listening');
  loadHomeRowControl('home-continue-reading-check', 'ft-home-continue-reading');
  renderBottomBarEditor(controller.signal); // v1.44 T12 bottom-bar editor
  renderCardCornerEditor(controller.signal); // v1.67 card-corner pickers (Appearance box)
  renderTrashSection(controller.signal); // v1.65 trash list + actions

  loadAutomationSettings();
  loadCacheSize();
  loadScanStatusLine();
  // v1.32 (custom logo): wire the Appearance-box upload/reset controls.
  wireLogoControls();
  // v1.43: Account chip + sign out + (admin) user management.
  initAccountSection(controller.signal);

  // v1.22.0 FR-5 (AC32-AC38): desktop-sidebar channel pins -- a SEPARATE
  // fetch against the module's own gated pin store, independent of
  // loadConfig()'s folder-list rendering above: renderPinnedSidebar inserts
  // `#sidebar-pinned-section` as a SIBLING of, never a child of,
  // `#sidebar-folders-list`, so it is unaffected regardless of fetch/render
  // ordering between the two. A 404 (module disabled) resolves to `[]` (no
  // pins rendered), preserving the disabled-module no-op guarantee -- this
  // never logs/throws on a 404. Read-only: never writes db.folders/
  // folderSettings.
  // v1.37.0: channel pins + book-shelf pins, one merged sidebar section.
  fetchAllPins().then((pins) => renderPinnedSidebar(pins));

  // Start
  loadConfig();
  loadBookConfig(); // v1.38.0 Part A: populate the book-folders list
  loadMusicConfig(); // v1.44: populate the music-folders list
}

function destroy() {
  if (controller) {
    controller.abort();
    controller = null;
  }
  // C4 remediation: belt-and-suspenders clear of the post-scan redirect
  // timer on top of its own in-callback `signal.aborted` guard above.
  if (scanRedirectTimer) {
    clearTimeout(scanRedirectTimer);
    scanRedirectTimer = null;
  }
}

if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.registerView === 'function') {
  window.FileTube.registerView('setup', { init, destroy });
}

// Guarded so requiring this file in Node (for unit tests) never touches
// `window`/`document` -- mirrors player.js's own module.exports guard.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    transcodeNamesSuffix, escapeTrashHtml, trashDaysLeftLabel, formatTrashSize, buildTrashRowHtml,
    // v1.67: the card-corner editor (drawn pieces are jsdom-tested).
    buildCornerEditorOptions, CARD_CORNER_LABELS, CORNER_EDITOR_SLOTS, renderCardCornerEditor,
    // v1.75: the bottom-bar editor is jsdom-tested the same way - its ROW
    // ORDER, its label coverage and its >=1-visible floor are all behaviour
    // no constant can stand in for.
    renderBottomBarEditor, BOTTOMBAR_LABELS,
    // v1.76: the wizard's directory list is jsdom-tested through its REAL
    // render + REAL gesture wiring (the arrows it used to be driven by are
    // gone). `init()` normally owns this module state, so a test needs a seat
    // to stand it up -- and a reader, since the whole point of this list's
    // posture is that a reorder lands in the ARRAY and waits for Save.
    renderFolders,
    // v1.76: the sidebar PREVIEW on this page - the other half of the same
    // migration, and the one with the interesting persist chain (immediate
    // POST, hidden/synthetic folders holding their absolute positions).
    renderSidebarFolders,
    __setFolderStateForTests(state) {
      configuredFolders = Array.isArray(state.folders) ? state.folders.slice() : [];
      folderSettings = state.settings || {};
      syntheticFolders = state.synthetic || [];
      controller = state.controller;
    },
    __getConfiguredFoldersForTests() { return configuredFolders.slice(); },
  };
}
