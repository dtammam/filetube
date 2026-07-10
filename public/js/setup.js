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
    // Item 1 (v1.15.0): native HTML5 drag-and-drop, a progressive
    // enhancement OVER the up/down buttons below (which stay as the
    // keyboard/tap-accessible fallback -- see the reorder-btn handlers
    // and their comment further down).
    row.draggable = true;
    row.dataset.index = String(index);
    row.innerHTML = `
      <span class="drag-handle" draggable="false" title="Drag to reorder" aria-hidden="true"></span>
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
      <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
        <button type="button" class="reorder-btn" data-index="${index}" data-dir="up" title="Move up" ${index === 0 ? 'disabled' : ''}
                style="background:none;border:1px solid var(--border-dark);border-radius:var(--radius);cursor:pointer;color:var(--text-primary);font-size:16px;line-height:1;padding:6px 10px;"><i class="icon-arrow-up"></i></button>
        <button type="button" class="reorder-btn" data-index="${index}" data-dir="down" title="Move down" ${index === configuredFolders.length - 1 ? 'disabled' : ''}
                style="background:none;border:1px solid var(--border-dark);border-radius:var(--radius);cursor:pointer;color:var(--text-primary);font-size:16px;line-height:1;padding:6px 10px;"><i class="icon-arrow-down"></i></button>
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

  // Reorder handlers — swap positions in the folders array (that order is the sidebar order).
  // This is the keyboard/tap-accessible FALLBACK (item 1, v1.15.0) — it
  // stays fully functional alongside the drag-and-drop handlers below,
  // for mobile/keyboard users where native DnD is awkward.
  container.querySelectorAll('.reorder-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = parseInt(e.currentTarget.dataset.index);
      const j = e.currentTarget.dataset.dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= configuredFolders.length) return;
      [configuredFolders[i], configuredFolders[j]] = [configuredFolders[j], configuredFolders[i]];
      renderFolders();
    }, { signal: controller.signal });
  });

  // Drag-and-drop reorder (item 1, v1.15.0) — a progressive enhancement
  // over the up/down buttons above; both mutate the SAME
  // `configuredFolders` array, and the Save button (below) persists it
  // through the existing POST /api/config path either way. No immediate
  // save here (mirrors the up/down buttons -- Save is still required).
  let dragSrcIndex = null;
  container.querySelectorAll('.folder-item-row').forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      dragSrcIndex = parseInt(row.dataset.index, 10);
      row.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Firefox requires data to be set for the drag to initiate at all.
        e.dataTransfer.setData('text/plain', String(dragSrcIndex));
      }
    }, { signal: controller.signal });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      row.classList.toggle('drag-over-before', before);
      row.classList.toggle('drag-over-after', !before);
    }, { signal: controller.signal });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-before', 'drag-over-after');
    }, { signal: controller.signal });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIndex = parseInt(row.dataset.index, 10);
      const before = row.classList.contains('drag-over-before');
      row.classList.remove('drag-over-before', 'drag-over-after');
      if (dragSrcIndex === null || Number.isNaN(targetIndex)) return;
      const toIndex = computeDropIndex(dragSrcIndex, targetIndex, before);
      configuredFolders = moveArrayItem(configuredFolders, dragSrcIndex, toIndex);
      dragSrcIndex = null;
      renderFolders();
    }, { signal: controller.signal });
    row.addEventListener('dragend', () => {
      dragSrcIndex = null;
      container.querySelectorAll('.folder-item-row').forEach((r) => {
        r.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
      });
    }, { signal: controller.signal });
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
let sidebarDragSrcIndex = null;
function renderSidebarFolders(folders, settings = {}) {
  const sidebarContainer = document.getElementById('sidebar-folders-list');
  if (!sidebarContainer) return;
  const visible = visibleSidebarFolders(folders, settings);
  if (visible.length === 0) {
    sidebarContainer.innerHTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';
    return;
  }
  sidebarContainer.innerHTML = visible.map((f, index) => {
    const base = f.split(/[\\/]/).pop() || f;
    const label = (settings[f] && settings[f].name) || base;
    return `<a href="/?root=${encodeURIComponent(f)}" class="sidebar-item" data-index="${index}" draggable="true" title="${escapeHtml(f)}"><i class="icon-folder"></i> ${escapeHtml(label)}</a>`;
  }).join('');

  const items = sidebarContainer.querySelectorAll('.sidebar-item[data-index]');
  items.forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      sidebarDragSrcIndex = parseInt(el.dataset.index, 10);
      el.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(sidebarDragSrcIndex));
      }
    }, { signal: controller.signal });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = el.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      el.classList.toggle('drag-over-before', before);
      el.classList.toggle('drag-over-after', !before);
    }, { signal: controller.signal });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over-before', 'drag-over-after');
    }, { signal: controller.signal });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetIndex = parseInt(el.dataset.index, 10);
      const before = el.classList.contains('drag-over-before');
      el.classList.remove('drag-over-before', 'drag-over-after');
      const fromIndex = sidebarDragSrcIndex;
      sidebarDragSrcIndex = null;
      if (fromIndex === null || Number.isNaN(targetIndex)) return;
      const toIndex = computeDropIndex(fromIndex, targetIndex, before);
      const newVisibleOrder = moveArrayItem(visible, fromIndex, toIndex);
      const rebuiltFull = rebuildFullFolderOrder(folders, settings, newVisibleOrder);
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
    }, { signal: controller.signal });
    el.addEventListener('dragend', () => {
      sidebarDragSrcIndex = null;
      items.forEach((r) => r.classList.remove('dragging', 'drag-over-before', 'drag-over-after'));
    }, { signal: controller.signal });
  });
}

// ---- Default landing view (v1.14.0 item 4) -----------------------------
// Populates the "Most Recent" + one-per-configured-folder <select> and,
// once known, applies the currently saved db.settings.defaultView value.
// Called from BOTH loadConfig() (once configuredFolders/folderSettings
// are known) and loadAutomationSettings() (once the saved value is
// known) -- whichever resolves LAST ends up with both pieces of data and
// converges on the correct final state, regardless of fetch ordering.
function populateDefaultViewSelect() {
  const select = document.getElementById('default-view-select');
  if (!select) return;
  const options = ['<option value="">Most Recent</option>'].concat(
    configuredFolders.map(f => {
      const base = f.split(/[\\/]/).pop() || f;
      const label = (folderSettings[f] && folderSettings[f].name) || base;
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
        statusText.textContent = msg;
        statusText.style.color = 'var(--text-primary)';
        setTimeout(() => pollScanStatus(statusText), 1000);
      } else {
        let msg = `Scan complete — ${s.fileCount} file(s) across ${s.folderCount} folder(s).`;
        if (s.transcoding > 0) msg += ` Converting ${s.transcoding} file(s) in the background${transcodeNamesSuffix(s)}`;
        statusText.textContent = msg;
        statusText.style.color = 'green';
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
    const cacheAgeSelect = document.getElementById('cache-age-select');
    if (cacheAgeSelect) cacheAgeSelect.value = String(s.cacheMaxAgeDays);
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
  } catch (err) {
    console.error('Failed to load automation settings:', err);
  }
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
    el.textContent = `Scanning library… ${s.fileCount} file(s) found so far`;
  } else {
    const last = s.lastScan ? formatRelativeTime(new Date(s.lastScan).getTime()) : 'never';
    el.textContent = `Last scanned: ${last}`;
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
        if (btn) btn.disabled = false;
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
      const btn = document.getElementById('scan-now-btn');
      if (btn) btn.disabled = true;
      pollAutomationScanStatus();
    }
  } catch (err) {
    console.error('Failed to load scan status:', err);
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
      statusText.textContent = 'Saving configuration…';
      statusText.style.color = 'var(--text-primary)';

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
          statusText.textContent = 'Error: ' + data.error;
          statusText.style.color = 'var(--yt-red)';
        }
      } catch (err) {
        statusText.textContent = 'Error saving configuration.';
        statusText.style.color = 'var(--yt-red)';
        console.error(err);
      }
    }, { signal });
  }

  // Default view (v1.14.0 item 4): saves the selected folder path (or ''
  // for "Most Recent") the same way as every other automation setting.
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
      scanNowBtn.disabled = true;
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
          scanNowBtn.disabled = false;
          console.error('Scan failed to start:', data.error);
        }
      } catch (err) {
        scanNowBtn.disabled = false;
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
          clearCacheBtn.disabled = true;
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
            clearCacheBtn.disabled = false;
            clearCacheBtn.textContent = original;
          }
        }
      );
    }, { signal });
  }
}

// ---- Registered view module (FR-1, T1) ---------------------------------

function init(root) {
  controller = new AbortController();
  configuredFolders = [];
  folderSettings = {};
  syntheticFolders = [];
  loadedDefaultView = null;

  wireStaticControls(controller.signal);
  renderThemePicker();
  renderIconPicker();
  loadResumeThresholdControl();
  loadDebugLifecycleControl();

  loadAutomationSettings();
  loadCacheSize();
  loadScanStatusLine();

  // v1.22.0 FR-5 (AC32-AC38): desktop-sidebar channel pins -- a SEPARATE
  // fetch against the module's own gated pin store, independent of
  // loadConfig()'s folder-list rendering above: renderPinnedSidebar inserts
  // `#sidebar-pinned-section` as a SIBLING of, never a child of,
  // `#sidebar-folders-list`, so it is unaffected regardless of fetch/render
  // ordering between the two. A 404 (module disabled) resolves to `[]` (no
  // pins rendered), preserving the disabled-module no-op guarantee -- this
  // never logs/throws on a 404. Read-only: never writes db.folders/
  // folderSettings.
  fetch('/api/subscriptions/pins')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .then((pins) => renderPinnedSidebar(pins));

  // Start
  loadConfig();
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
  module.exports = { transcodeNamesSuffix };
}
