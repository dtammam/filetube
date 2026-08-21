'use strict';

/* global buildSortableTable */ // v1.159: the shared table component (common.js, loaded first)

// C4 "fun stats" page (v1.24 UX Round, Wave 3). v1.151: Stats is now a
// REGISTERED SPA route -- deriveRouteView maps /stats.html -> 'stats', so
// navigating to it in-app swaps #view-root and keeps the docked mini-player
// playing, instead of the full page reload that used to destroy it. This
// module follows the routed-view contract (setup.js/books.js): it registers
// { init, destroy } and lets bootRouter run init() on a standalone full-page
// load AND swapToView run it on an in-app navigation -- ONE init path. There
// is deliberately NO self-run DOMContentLoaded boot: now that bootRouter no
// longer no-ops on this recognized route, a self-boot would double-init.
//
// Fetches GET /api/stats ONCE per page load (the route itself computes live,
// server-side, on every request -- see lib/stats.js's header comment) and
// renders it with vanilla DOM. `textContent` only, never `innerHTML`
// (CONTRIBUTING.md) -- every value on this page ultimately comes from
// user-controlled filenames/folder names/titles, so nothing here is ever
// interpreted as markup.
//
// Reuses EXISTING classes only (`.setup-box`, `.theme-picker`/`.theme-card`/
// `.theme-card-name`/`.theme-card-blurb` from the Appearance picker on
// setup.html, `.folder-list-builder` from the folder-management list) --
// this page owns no new CSS (see the T10 task card's client-ownership note).
//
// Deliberately self-contained: common.js already defines equivalent
// `formatDuration`/`formatFileSize`/`formatRelativeTime` globals, but this
// script does NOT reuse them -- doing so would require adding
// `public/js/stats.js` to eslint.config.js's cross-file `globals` allowlist
// (public/js/main.js/watch.js/setup.js/player.js only today), and
// eslint.config.js is outside this task's owned-files list. The small
// formatters below are independent, locally-scoped, and unit-tested here.

// ---- Pure formatting helpers (unit-tested directly, no DOM) ---------------

// A non-negative integer with thousands separators (e.g. `1234` -> `1,234`).
// Deliberately NOT `toLocaleString()` (locale-dependent, so it would be
// non-deterministic across environments) -- a fixed, always-en-US-shaped
// grouping instead. Fails safe to `'0'` on anything non-finite/negative.
function formatCount(n) {
  const value = (typeof n === 'number' && Number.isFinite(n) && n >= 0) ? Math.floor(n) : 0;
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// A compact "days/hours/minutes" readout for a LIBRARY-WIDE total duration
// (which can run into the thousands of hours -- unlike a single item's
// duration, `formatDuration` from common.js's MM:SS/H:MM:SS shape would be
// unreadable at that scale). Shows only the two most significant units so
// the number stays glanceable; fails safe to `'0m'` on anything non-finite/
// negative.
function formatTotalDuration(totalSeconds) {
  const seconds = (typeof totalSeconds === 'number' && Number.isFinite(totalSeconds) && totalSeconds >= 0) ? Math.floor(totalSeconds) : 0;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Human-readable file size (e.g. `1536` -> `1.5 KB`). Mirrors common.js's
// `formatFileSize` shape/rounding exactly, kept as an independent local copy
// (see this file's header comment for why). Fails safe to `'0 B'` on
// anything non-finite/negative.
function formatByteSize(bytes) {
  const value = (typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0) ? bytes : 0;
  if (value === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(k)), units.length - 1);
  return `${parseFloat((value / Math.pow(k, exponent)).toFixed(1))} ${units[exponent]}`;
}

// A single item's playback duration, MM:SS or H:MM:SS (for the Longest/
// Shortest record tiles -- distinct from `formatTotalDuration` above, which
// is for a LIBRARY-WIDE total). Mirrors common.js's `formatDuration` shape,
// kept as an independent local copy (see this file's header comment).
function formatItemDuration(seconds) {
  const value = (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) ? seconds : 0;
  if (value === 0) return '0:00';
  const hrs = Math.floor(value / 3600);
  const mins = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  const paddedSecs = secs < 10 ? `0${secs}` : String(secs);
  if (hrs > 0) return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${paddedSecs}`;
  return `${mins}:${paddedSecs}`;
}

// A relative "N days/hours/minutes ago" readout for the Newest record tile.
// `nowMs` is an injectable "current time" (defaults to `Date.now()`) so this
// stays deterministically unit-testable. Fails safe to `'unknown date'` on a
// missing/non-finite `epochMs`.
function formatRelativeDate(epochMs, nowMs) {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return 'unknown date';
  const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
  const diffMs = epochMs - now;
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  if (Math.abs(diffMinutes) < 60) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  if (Math.abs(diffHours) < 24) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(diffHours, 'hour');
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(diffDays, 'day');
}

// A short, human-friendly label for a channel breakdown row's `channelUrl`
// (a full URL, e.g. `https://www.youtube.com/@somechannel`). Prefers the
// `@handle` shape (the common case); otherwise falls back to the last
// non-empty path segment; otherwise the raw string. Never throws -- a
// malformed URL (or a non-URL string, defensively) just falls through to the
// raw-string fallback rather than crashing the dashboard render.
function shortenChannelLabel(channelUrl) {
  if (typeof channelUrl !== 'string' || channelUrl.trim() === '') return 'Unknown channel';
  try {
    const parsed = new URL(channelUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0) return decodeURIComponent(segments[segments.length - 1]);
    return channelUrl;
  } catch (_) {
    return channelUrl;
  }
}

// ---- DOM rendering (untested-by-necessity, mirrors the rest of the app) ---

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// A `.theme-card`-styled tile (reused verbatim from the Appearance picker --
// see this file's header comment): a big number/label on top, a muted
// caption below. `value`/`caption` are always `textContent`.
function buildStatTile(value, caption) {
  const tile = document.createElement('div');
  tile.className = 'theme-card';
  const valueEl = document.createElement('div');
  // Tokens Phase 1 Tier 1: the JS-applied 22px moved to .stat-tile-value
  // (style.css) - font-size rides var(--fs-4xl).
  valueEl.className = 'theme-card-name stat-tile-value';
  valueEl.textContent = value;
  const captionEl = document.createElement('div');
  captionEl.className = 'theme-card-blurb';
  captionEl.textContent = caption;
  tile.appendChild(valueEl);
  tile.appendChild(captionEl);
  return tile;
}

function renderGlanceTiles(root, statsData) {
  clearChildren(root);
  root.appendChild(buildStatTile(formatCount(statsData.count.total), 'Total items'));
  root.appendChild(buildStatTile(formatCount(statsData.count.video), 'Videos'));
  root.appendChild(buildStatTile(formatCount(statsData.count.audio), 'Audio tracks'));
  root.appendChild(buildStatTile(formatTotalDuration(statsData.totalDurationSeconds), 'Total watch time'));
  root.appendChild(buildStatTile(formatByteSize(statsData.totalSizeBytes), 'Total size on disk'));
}

// v1.159 (Dean): the folder/channel breakdown as a real sortable, filterable
// table (Name | Entries | Length | Size) via the shared buildSortableTable -
// replacing the old fused "count · duration · size" flex row. Numeric columns
// sort by the RAW value (bytes/seconds), default biggest-Size-first.
function renderBreakdownList(root, groups, labelFn, emptyMessage, persistKey) {
  clearChildren(root);
  if (!Array.isArray(groups) || groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'theme-card-blurb';
    empty.textContent = emptyMessage;
    root.appendChild(empty);
    return;
  }
  const rows = groups.map((g) => ({
    name: labelFn(g),
    count: Number(g.count) || 0,
    dur: Number(g.totalDurationSeconds) || 0,
    bytes: Number(g.totalSizeBytes) || 0,
  }));
  buildSortableTable(root, {
    caption: 'Breakdown by name',
    columns: [
      { key: 'name', label: 'Name', format: (r) => r.name },
      { key: 'count', label: 'Entries', numeric: true, align: 'end', sortValue: (r) => r.count, format: (r) => formatCount(r.count) },
      { key: 'dur', label: 'Length', numeric: true, align: 'end', sortValue: (r) => r.dur, format: (r) => formatTotalDuration(r.dur) },
      { key: 'bytes', label: 'Size', numeric: true, align: 'end', sortValue: (r) => r.bytes, format: (r) => formatByteSize(r.bytes) },
    ],
    rows,
    filter: { text: (r) => r.name, placeholder: 'Filter by name...' },
    defaultSort: { key: 'bytes', dir: 'desc' },
    persistKey,
  });
}

function renderRecordTiles(root, statsData) {
  clearChildren(root);
  if (statsData.longest) {
    root.appendChild(buildStatTile(formatItemDuration(statsData.longest.duration), `Longest: ${statsData.longest.title}`));
  }
  if (statsData.shortest) {
    root.appendChild(buildStatTile(formatItemDuration(statsData.shortest.duration), `Shortest: ${statsData.shortest.title}`));
  }
  if (statsData.newest) {
    root.appendChild(buildStatTile(formatRelativeDate(statsData.newest.addedAt), `Newest: ${statsData.newest.title}`));
  }
  if (!statsData.longest && !statsData.shortest && !statsData.newest) {
    root.appendChild(buildStatTile('—', 'No items yet'));
  }
}

// v1.160 (Dean): Most watched as a sortable table (Title | Plays, default Plays
// desc = the ranking; the old "N." rank prefix is dropped since sorting redefines
// it). "Plays" is the LOCAL watch counter (db.viewCounts, times played HERE) -
// NOT the source "views" cards show (the v1.48 W6 distinction, preserved).
function renderMostWatched(root, mostWatched, canModify) {
  clearChildren(root);
  if (!Array.isArray(mostWatched) || mostWatched.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'theme-card-blurb';
    empty.textContent = 'No watch data yet — most-watched fills in as you watch things.';
    root.appendChild(empty);
    return;
  }
  const rows = mostWatched.map((e) => ({ id: (e.id || '').toString(), title: (e.title || '').toString(), plays: Number(e.viewCount) || 0 }));
  const armRef = { current: null };
  let table = null;
  const cfg = {
    caption: 'Most watched',
    columns: [
      { key: 'title', label: 'Title', format: (r) => r.title },
      { key: 'plays', label: 'Plays', numeric: true, align: 'end', sortValue: (r) => r.plays, format: (r) => formatCount(r.plays) },
    ],
    rows,
    filter: { text: (r) => r.title, placeholder: 'Filter by title...' },
    defaultSort: { key: 'plays', dir: 'desc' },
    persistKey: 'ft-stable:stats-most-watched',
  };
  if (canModify) {
    cfg.actions = (row) => (row && row.id)
      ? buildStatsDeleteAction(row.id, row.title, () => {
        const idx = rows.indexOf(row);
        if (idx >= 0) rows.splice(idx, 1);
        if (table) table.update(rows);
      }, armRef)
      : null;
    cfg.onRender = () => resetStatsArm(armRef);
  }
  table = buildSortableTable(root, cfg);
}

// ---- v1.41.11 (Dean): duplicates report -------------------------------------
// Renders GET /api/duplicates (see lib/stats.js computeDuplicateReport for the
// two sections' semantics). Same idioms as the rest of this page: textContent
// only (filenames are user-controlled), inline styles (this page owns no CSS),
// and the existing container classes. v1.162 (Dean): library-write users get a
// per-group expand toggle -> per-copy two-tap delete (buildDuplicateExpando);
// read-only users see the report unchanged. Long reports render the top groups
// per section with an explicit "N more in the CSV" line -- never a silent cap.
const DUPLICATE_GROUPS_RENDER_CAP = 50;

function renderDuplicates(root, report, canModify) {
  clearChildren(root);
  const rep = report || {};
  const nameGroups = Array.isArray(rep.nameGroups) ? rep.nameGroups : [];
  const idGroups = Array.isArray(rep.idGroups) ? rep.idGroups : [];
  if (nameGroups.length === 0 && idGroups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'theme-card-blurb';
    empty.textContent = 'No duplicates found — every filename and video id in the library is unique.';
    root.appendChild(empty);
    return;
  }
  // The "Duplicate" cell: the group key (truncated) over its file paths - a
  // wrap column so the paths show (textContent throughout: filenames are
  // user-controlled). READ-ONLY, no delete affordance (unchanged).
  const dupNameCell = (group, keyText) => {
    const box = document.createElement('div');
    const key = document.createElement('div');
    key.className = 'dup-key';
    key.textContent = keyText;
    box.appendChild(key);
    (Array.isArray(group.items) ? group.items : []).forEach((item) => {
      const p = document.createElement('div');
      p.className = 'dup-path stats-meta-text';
      p.textContent = `${item.filePath} (${formatByteSize(item.size)})`;
      box.appendChild(p);
    });
    return box;
  };
  const renderSection = (title, groups, keyLabel, persistKey) => {
    if (groups.length === 0) return;
    const header = document.createElement('div');
    header.className = 'stable-section-title';
    header.textContent = title;
    root.appendChild(header);
    // v1.159 (Dean): sort by Reclaimable DESC BEFORE the 50-group cap, so the
    // biggest offenders always survive the cap (the old order was arbitrary);
    // the sortable table then re-sorts the shown set by any column.
    const shown = groups.slice()
      .sort((a, b) => (Number(b.wastedBytes) || 0) - (Number(a.wastedBytes) || 0))
      .slice(0, DUPLICATE_GROUPS_RENDER_CAP);
    const rows = shown.map((g) => ({
      group: g,
      key: keyLabel(g),
      copies: Array.isArray(g.items) ? g.items.length : 0,
      total: Number(g.totalBytes) || 0,
      wasted: Number(g.wastedBytes) || 0,
    }));
    const host = document.createElement('div');
    root.appendChild(host);
    const armRef = { current: null };
    let table = null;
    const cfg = {
      caption: title,
      columns: [
        { key: 'key', label: 'Duplicate', wrap: true, format: (r) => dupNameCell(r.group, r.key) },
        { key: 'copies', label: 'Copies', numeric: true, align: 'end', sortValue: (r) => r.copies, format: (r) => formatCount(r.copies) },
        { key: 'total', label: 'Total', numeric: true, align: 'end', sortValue: (r) => r.total, format: (r) => formatByteSize(r.total) },
        { key: 'wasted', label: 'Reclaim', numeric: true, align: 'end', sortValue: (r) => r.wasted, format: (r) => formatByteSize(r.wasted) },
      ],
      rows,
      filter: { text: (r) => r.key, placeholder: 'Filter by name...' },
      defaultSort: { key: 'wasted', dir: 'desc' },
      persistKey,
    };
    // v1.162: library-write users get an expand toggle per group -> per-copy deletes.
    if (canModify) {
      cfg.actions = (row, tr) => buildDuplicateExpando(row, tr, armRef, () => {
        const idx = rows.indexOf(row);
        if (idx >= 0) rows.splice(idx, 1);
        if (table) table.update(rows); // group is no longer a duplicate -> drop the row
      });
      cfg.onRender = () => resetStatsArm(armRef);
    }
    table = buildSortableTable(host, cfg);
    if (groups.length > DUPLICATE_GROUPS_RENDER_CAP) {
      const more = document.createElement('div');
      more.className = 'theme-card-blurb';
      more.textContent = `…and ${formatCount(groups.length - DUPLICATE_GROUPS_RENDER_CAP)} more groups — the CSV export has the complete list.`;
      root.appendChild(more);
    }
  };
  renderSection('Same filename', nameGroups, (group) => group.key, 'ft-stable:stats-dup-name');
  renderSection('Same video, different filenames', idGroups, (group) => `Video id [${group.key}]`, 'ft-stable:stats-dup-id');
}

// v1.162 (Dean): the shared two-tap delete affordance for the Stats tables that
// list deletable media - the SAME card/notification flow (DELETE /api/videos/:id
// -> Trash, recoverable). Only rendered for library-write users (the caller gates
// on canModify); the server DELETE is RBAC-guarded regardless. `armRef` is a shared
// {current} so only ONE delete is armed at a time; `onDeleted` removes the row
// after a confirmed 2xx (NON-OPTIMISTIC - failure re-enables). RE-RENDER SAFETY
// (the v1.159 Trash-arm class): the LOAD-BEARING guarantee is that armState is
// closure-local, so a sort/filter/update rebuild makes every new button idle - a
// re-render can NEVER leave a hot one-tap delete. resetStatsArm (the table's
// onRender) is DEFENSIVE belt-and-suspenders on top: it clears a dangling armRef
// pointer to the now-detached armed button. The safety holds without it (gate:
// neutering resetStatsArm keeps the destructive suite green; the closure-local
// armState is what binds).
function buildStatsDeleteAction(mediaId, title, onDeleted, armRef) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'stable-delete-btn';
  btn.setAttribute('aria-label', 'Delete ' + (title || 'this item'));
  btn.title = 'Delete';
  const icon = document.createElement('i');
  icon.className = 'icon-delete';
  const confirm = document.createElement('span');
  confirm.className = 'stable-delete-confirm';
  confirm.textContent = 'Sure?';
  btn.appendChild(icon);
  btn.appendChild(confirm);
  let armState = 'idle';
  let armTimer = null;
  const disarm = () => {
    armState = 'idle';
    btn.classList.remove('stable-delete-armed');
    if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    if (armRef && armRef.current === btn) armRef.current = null;
  };
  btn._disarm = disarm;
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const next = nextArmState(armState, 'tap');
    armState = next.state;
    if (!next.deleted) {
      if (armRef && armRef.current && armRef.current !== btn && typeof armRef.current._disarm === 'function') armRef.current._disarm();
      if (armRef) armRef.current = btn;
      btn.classList.add('stable-delete-armed');
      if (armTimer) clearTimeout(armTimer);
      armTimer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    btn.disabled = true;
    fetch('/api/videos/' + encodeURIComponent(mediaId), { method: 'DELETE' })
      .then((res) => (res.ok ? res.json().catch(() => ({})) : Promise.reject(new Error(`delete failed: ${res.status}`))))
      .then((data) => {
        if (typeof showToast === 'function' && typeof deleteResultToast === 'function') showToast(deleteResultToast(data));
        if (typeof onDeleted === 'function') onDeleted();
      })
      .catch(() => {
        btn.disabled = false; // non-optimistic: failure re-enables for retry
        if (typeof showToast === 'function') showToast('Could not delete. Try again.');
      });
  });
  return btn;
}

// The buildSortableTable onRender hook: DEFENSIVE cleanup - drop the shared armed
// pointer after a re-render so it never dangles at a detached button. NOT the
// load-bearing safety (that is the closure-local armState in buildStatsDeleteAction,
// which rebuilds every button idle); this is belt-and-suspenders only.
function resetStatsArm(armRef) {
  if (armRef && armRef.current && typeof armRef.current._disarm === 'function') armRef.current._disarm();
  if (armRef) armRef.current = null;
}

// v1.162 (Dean): the Duplicates per-copy delete. A duplicate ROW is a GROUP of N
// copies, so instead of guessing which copy to keep, an expand toggle reveals each
// actual copy (its path + size) with its OWN two-tap delete - you remove exactly
// the copies you choose. The expando is a full-row child of the .stable-row (the
// Users-access-editor pattern, grid-column 1/-1). Deleting a copy removes it from
// the group + the panel and keeps the row's aggregates honest for a later re-sort;
// when a group drops to <=1 copy it is no longer a duplicate, so onGroupCollapsed
// removes the whole row. armRef is shared with the table so only one delete arms.
function buildDuplicateExpando(row, tr, armRef, onGroupCollapsed) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'stable-expand-btn';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Delete individual copies');
  toggle.title = 'Delete individual copies';
  const chevron = document.createElement('i');
  chevron.className = 'icon-arrow-down';
  toggle.appendChild(chevron);
  let panel = null;
  const recomputeRowAggregates = () => {
    const items = Array.isArray(row.group.items) ? row.group.items : [];
    row.copies = items.length;
    row.total = items.reduce((sum, x) => sum + (Number(x.size) || 0), 0);
    const maxSize = items.reduce((m, x) => Math.max(m, Number(x.size) || 0), 0);
    row.wasted = row.total - maxSize;
  };
  const buildPanel = () => {
    const box = document.createElement('div');
    box.className = 'stable-expando dup-expando';
    (Array.isArray(row.group.items) ? row.group.items : []).slice().forEach((item) => {
      const line = document.createElement('div');
      line.className = 'dup-copy-row';
      const label = document.createElement('span');
      label.className = 'dup-copy-path stats-meta-text';
      label.textContent = `${item.filePath} (${formatByteSize(Number(item.size) || 0)})`;
      const del = buildStatsDeleteAction(item.id, item.filePath, () => {
        const gi = row.group.items.indexOf(item);
        if (gi >= 0) row.group.items.splice(gi, 1);
        line.remove();
        recomputeRowAggregates();
        if (row.group.items.length <= 1 && typeof onGroupCollapsed === 'function') onGroupCollapsed();
      }, armRef);
      line.appendChild(label);
      line.appendChild(del);
      box.appendChild(line);
    });
    return box;
  };
  toggle.addEventListener('click', () => {
    if (panel) { panel.remove(); panel = null; toggle.setAttribute('aria-expanded', 'false'); return; }
    panel = buildPanel();
    tr.appendChild(panel); // full-row child; CSS spans it grid-column 1 / -1
    toggle.setAttribute('aria-expanded', 'true');
  });
  return toggle;
}

// v1.159 (Dean): the "Videos & audio" table - the whole visible library as
// sortable rows (Title | Type | Length | Size) from its own /api/library-items
// fetch. renderCap keeps a multi-thousand-item library from mounting thousands
// of nodes; sort (biggest/longest) + the title filter reach the FULL set.
// v1.162: library-write users get a per-row trash icon (two-tap -> Trash).
const AV_RENDER_CAP = 300;
function renderAvTable(root, items, canModify) {
  clearChildren(root);
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'theme-card-blurb';
    empty.textContent = 'No videos or audio in your library yet.';
    root.appendChild(empty);
    return;
  }
  const rows = list.map((it) => ({
    id: (it.id || '').toString(),
    title: (it.title || '').toString(),
    type: it.type === 'audio' ? 'audio' : 'video',
    dur: Number(it.durationSeconds) || 0,
    bytes: Number(it.sizeBytes) || 0,
  }));
  const armRef = { current: null };
  let table = null;
  const cfg = {
    caption: 'Videos and audio',
    columns: [
      { key: 'title', label: 'Title', format: (r) => r.title },
      { key: 'type', label: 'Type', sortValue: (r) => r.type, format: (r) => (r.type === 'audio' ? 'Audio' : 'Video') },
      { key: 'dur', label: 'Length', numeric: true, align: 'end', sortValue: (r) => r.dur, format: (r) => formatItemDuration(r.dur) },
      { key: 'bytes', label: 'Size', numeric: true, align: 'end', sortValue: (r) => r.bytes, format: (r) => formatByteSize(r.bytes) },
    ],
    rows,
    filter: { text: (r) => r.title, placeholder: 'Filter by title...' },
    defaultSort: { key: 'bytes', dir: 'desc' },
    persistKey: 'ft-stable:stats-av',
    renderCap: AV_RENDER_CAP,
  };
  // v1.162: library-write users get a per-row two-tap delete (-> Trash). The row
  // closes over its own `id`/`title` (never a render index), so a sort can't
  // mis-target; onRender resets the shared arm (the v1.159 re-render-arm safety).
  if (canModify) {
    cfg.actions = (row) => (row && row.id)
      ? buildStatsDeleteAction(row.id, row.title, () => {
        const idx = rows.indexOf(row);
        if (idx >= 0) rows.splice(idx, 1);
        if (table) table.update(rows);
      }, armRef)
      : null;
    cfg.onRender = () => resetStatsArm(armRef);
  }
  table = buildSortableTable(root, cfg);
}

// ---- v1.41.0: Books inventory + About/version section ----------------------

function renderBookTiles(root, books) {
  clearChildren(root);
  const b = books || {};
  const byFormat = b.byFormat || {};
  const epub = byFormat.epub || {};
  const pdf = byFormat.pdf || {};
  root.appendChild(buildStatTile(formatCount(b.count || 0), 'Books'));
  root.appendChild(buildStatTile(formatByteSize(b.totalSizeBytes || 0), 'Total size on disk'));
  root.appendChild(buildStatTile(formatCount(epub.count || 0), 'EPUB'));
  root.appendChild(buildStatTile(formatCount(pdf.count || 0), 'PDF'));
  root.appendChild(buildStatTile(formatCount(b.narratedCount || 0), 'With narration'));
}

// v1.159: Book folders as a sortable table -- size-only (books have no
// duration), so Name | Books | Size (default Size-desc), with a name filter.
function renderBookFolders(root, books) {
  clearChildren(root);
  const groups = (books && Array.isArray(books.byFolder)) ? books.byFolder : [];
  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'theme-card-blurb';
    empty.textContent = 'No books yet: add a book folder in Settings.';
    root.appendChild(empty);
    return;
  }
  const rows = groups.map((g) => ({
    name: g.folderName,
    count: Number(g.count) || 0,
    bytes: Number(g.totalSizeBytes) || 0,
  }));
  buildSortableTable(root, {
    caption: 'Books by folder',
    columns: [
      { key: 'name', label: 'Name', format: (r) => r.name },
      { key: 'count', label: 'Books', numeric: true, align: 'end', sortValue: (r) => r.count, format: (r) => formatCount(r.count) },
      { key: 'bytes', label: 'Size', numeric: true, align: 'end', sortValue: (r) => r.bytes, format: (r) => formatByteSize(r.bytes) },
    ],
    rows,
    filter: { text: (r) => r.name, placeholder: 'Filter by name...' },
    defaultSort: { key: 'bytes', dir: 'desc' },
    persistKey: 'ft-stable:stats-books-folder',
  });
}

// A GitHub-style external link. href is always a server-provided repo URL (a
// trusted constant, never user data) with a fixed path; label is fixed text.
function buildRepoLink(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.cssText = 'color:var(--yt-red); text-decoration:none; font-weight:var(--fw-bold);';
  return a;
}

// One "label ..... value" row where the value can be a text node OR a link.
function buildAboutRow(label, valueNode) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:var(--space-5); padding:var(--space-4) var(--space-2); border-bottom:1px solid var(--border-color);';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.cssText = 'font-weight:var(--fw-bold);';
  const valueEl = document.createElement('span');
  valueEl.style.cssText = 'color:var(--text-secondary); flex-shrink:0;';
  valueEl.appendChild(valueNode);
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

// v1.146 (downloader-engine T8): the About row's text - "version (label)"
// where the label is the ACTIVE engine's channel. `active === 'venv'` is
// what earns a channel name; anything else (bundled active, post-revert
// fallback, unbound runtime, missing summary) HONESTLY reads "(bundled)" -
// the label describes what is running, never what is merely wished for.
// Null when no version is known (the row is not rendered at all).
function formatYtdlpAboutText(info) {
  if (!info || typeof info.version !== 'string' || info.version === '') return null;
  const eng = info.engine;
  const label = eng && eng.active === 'venv' && (eng.channel === 'stable' || eng.channel === 'nightly')
    ? eng.channel
    : 'bundled';
  return `${info.version} (${label})`;
}

function renderAbout(root, system) {
  clearChildren(root);
  const sys = system || {};
  const repoUrl = (typeof sys.repoUrl === 'string' && sys.repoUrl) ? sys.repoUrl : 'https://github.com/dtammam/filetube';

  // FileTube version -> links to its own release tag.
  if (sys.version) {
    root.appendChild(buildAboutRow('FileTube', buildRepoLink(`${repoUrl}/releases/tag/v${sys.version}`, `v${sys.version}`)));
  }
  // yt-dlp -- shown ONLY when the module is enabled AND a version is known
  // (Dean: if it isn't installed, don't show the row at all). v1.146: the
  // row names WHICH engine is active - "version (bundled|stable|nightly)".
  const ytdlpText = formatYtdlpAboutText(sys.ytdlp);
  if (sys.ytdlp && sys.ytdlp.enabled && ytdlpText) {
    root.appendChild(buildAboutRow('yt-dlp', document.createTextNode(ytdlpText)));
  }
  // Text-to-speech -- shown when available; version when known (espeak-ng),
  // otherwise just the engine name (piper's --version isn't trustworthy).
  if (sys.tts && sys.tts.available && sys.tts.engine) {
    const ttsText = sys.tts.version ? `${sys.tts.engine} ${sys.tts.version}` : sys.tts.engine;
    root.appendChild(buildAboutRow('Text-to-speech', document.createTextNode(ttsText)));
  }

  // GitHub links.
  const links = document.createElement('div');
  links.style.cssText = 'display:flex; flex-wrap:wrap; gap:var(--space-8); padding:var(--space-6) var(--space-2) var(--space-2);';
  links.appendChild(buildRepoLink(repoUrl, 'GitHub repository'));
  links.appendChild(buildRepoLink(`${repoUrl}/releases`, 'Releases'));
  links.appendChild(buildRepoLink(`${repoUrl}/issues`, 'Report an issue'));
  root.appendChild(links);
}

// v1.44.3 (Dean): the "Under the hood" inventory -- one label/value row per
// persisted namespace count (server payload `inventory`, from
// stats.computeInventory). textContent only, same idioms as the rest of the
// page; formatCount gives the thousands separators.
function renderInventory(root, inventory) {
  clearChildren(root);
  const inv = inventory || {};
  const books = inv.books || {};
  const music = inv.music || {};
  const rows = [
    ['Videos & audio', inv.videos],
    ['Watch positions', inv.watchProgress],
    ['View counts', inv.viewCounts],
    ['Liked items', inv.liked],
    ['Delete tombstones', inv.deleteTombstones],
    ['Scan folders', inv.scanFolders],
    ['Books', books.items],
    ['Reading positions', books.progress],
    ['Books with narration', books.narrationAudio],
    ['Music tracks', music.tracks],
    ['Music folders', music.folders],
    ['User accounts', inv.users],
  ];
  for (const [label, value] of rows) {
    // v1.81 (#127a): a null count means "not applicable to this user" (e.g. the
    // account roster for a non-admin) - omit the row rather than show a
    // misleading 0. A genuine zero is a number and still renders.
    if (value === null || value === undefined) continue;
    root.appendChild(buildAboutRow(label, document.createTextNode(formatCount(Number(value) || 0))));
  }
}

// ---- v1.102 (tranche 4 shimmer): pre-fetch dashboard skeleton ---------------
// Before EITHER /api/stats or /api/duplicates resolves, seed a shape-matched
// shimmer placeholder into every container so the dashboard never paints empty
// then reflows twice as the two independent fetches land. Reuses ONLY existing
// shared classes (the real `.theme-card` tile box + the `.skeleton-line`/
// `.skeleton-shimmer` toolkit) and the SAME inline row box model as
// buildAboutRow -- this page still owns no CSS. Every render*
// below does clearChildren(root) before it fills, so the swap to real content is
// automatic; on the four FIXED-shape tile grids the seed count is the real count
// (true zero-shift), and the variable-length lists seed a representative row
// count (a brief settle as the real list lands - the same accepted trade-off as
// the library-view skeletons in t1).

// The four fixed-shape tile grids -> their exact real tile counts.
const STATS_TILE_GRIDS = [
  ['stats-glance-grid', 5],   // total / video / audio / watch-time / size
  ['stats-by-type', 2],       // Video / Audio
  ['stats-records-grid', 3],  // longest / shortest / newest
  ['stats-books-grid', 5],    // books / size / EPUB / PDF / narration
];
// The seven list containers -> a representative pre-fetch row count.
const STATS_LIST_CONTAINERS = [
  ['stats-folder-list', 4],
  ['stats-channel-list', 3],
  ['stats-most-watched-list', 5],
  ['stats-books-folder-list', 3],
  ['stats-duplicates-list', 3],
  ['stats-inventory-list', 6],
  ['stats-about', 4],
];
// The stats-fed containers (everything EXCEPT the independently-fetched
// duplicates list, which owns its own fetch + error path). renderStatsError
// clears these so a failed /api/stats never leaves a container shimmering
// forever under a page that will never fill it.
const STATS_FETCH_CONTAINERS = [
  'stats-glance-grid', 'stats-by-type', 'stats-folder-list', 'stats-channel-list',
  'stats-records-grid', 'stats-most-watched-list', 'stats-books-grid',
  'stats-books-folder-list', 'stats-inventory-list', 'stats-about',
];
// The shared row box model -- tracks buildAboutRow (inventory / About still
// render as these flex rows). v1.159/v1.160: the By-folder / By-channel /
// Books / Duplicates / Most-watched breakdowns now render via the sortable `.stable` table
// instead, so their skeleton is an APPROXIMATE placeholder (the real table adds
// a filter bar + header row) -- a minor one-time Stats-open reflow, accepted as
// tech-debt (a shape-matched .stable skeleton is the fast-follow).
const STATS_SKELETON_ROW_CSS = 'display:flex; justify-content:space-between; align-items:center; gap:var(--space-5); padding:var(--space-4) var(--space-2); border-bottom:1px solid var(--border-color);';

// A `.theme-card`-shaped shimmer tile: two block skeleton lines (value + caption)
// standing in for buildStatTile's number + muted caption.
function buildStatsSkeletonTile() {
  const tile = document.createElement('div');
  tile.className = 'theme-card';
  tile.setAttribute('aria-hidden', 'true');
  const value = document.createElement('div');
  value.className = 'skeleton-line skeleton-line-title skeleton-shimmer';
  const caption = document.createElement('div');
  caption.className = 'skeleton-line skeleton-line-meta skeleton-shimmer';
  tile.appendChild(value);
  tile.appendChild(caption);
  return tile;
}

// A breakdown/about-row-shaped shimmer row: label bar + value bar in the same
// flex box the real rows use. Widths are inline (not a governed colour property,
// census-safe); margin:0 neutralises `.skeleton-line`'s default margin-bottom so
// the centred flex row height matches the real single-line row.
function buildStatsSkeletonRow() {
  const row = document.createElement('div');
  row.style.cssText = STATS_SKELETON_ROW_CSS;
  row.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'skeleton-line skeleton-shimmer';
  label.style.cssText = 'width:40%; margin:0;';
  const value = document.createElement('span');
  value.className = 'skeleton-line skeleton-shimmer';
  value.style.cssText = 'width:25%; margin:0; flex-shrink:0;';
  row.appendChild(label);
  row.appendChild(value);
  return row;
}

// Seed every dashboard container with its shape-matched shimmer BEFORE the two
// fetches fire. Idempotent (clearChildren first) so a re-seed can't stack.
function seedStatsSkeleton() {
  for (const [id, n] of STATS_TILE_GRIDS) {
    const root = document.getElementById(id);
    if (!root) continue;
    clearChildren(root);
    for (let i = 0; i < n; i++) root.appendChild(buildStatsSkeletonTile());
  }
  for (const [id, n] of STATS_LIST_CONTAINERS) {
    const root = document.getElementById(id);
    if (!root) continue;
    clearChildren(root);
    for (let i = 0; i < n; i++) root.appendChild(buildStatsSkeletonRow());
  }
}

function renderStatsDashboard(statsData, canModify) {
  const glanceRoot = document.getElementById('stats-glance-grid');
  const byTypeRoot = document.getElementById('stats-by-type');
  const folderRoot = document.getElementById('stats-folder-list');
  const channelRoot = document.getElementById('stats-channel-list');
  const recordsRoot = document.getElementById('stats-records-grid');
  const mostWatchedRoot = document.getElementById('stats-most-watched-list');
  const booksRoot = document.getElementById('stats-books-grid');
  const booksFolderRoot = document.getElementById('stats-books-folder-list');
  const inventoryRoot = document.getElementById('stats-inventory-list');
  const aboutRoot = document.getElementById('stats-about');

  if (glanceRoot) renderGlanceTiles(glanceRoot, statsData);
  if (byTypeRoot) {
    clearChildren(byTypeRoot);
    byTypeRoot.appendChild(buildStatTile(`${formatCount(statsData.byType.video.count)} · ${formatTotalDuration(statsData.byType.video.totalDurationSeconds)} · ${formatByteSize(statsData.byType.video.totalSizeBytes)}`, 'Video'));
    byTypeRoot.appendChild(buildStatTile(`${formatCount(statsData.byType.audio.count)} · ${formatTotalDuration(statsData.byType.audio.totalDurationSeconds)} · ${formatByteSize(statsData.byType.audio.totalSizeBytes)}`, 'Audio'));
  }
  if (folderRoot) renderBreakdownList(folderRoot, statsData.byFolder, (g) => g.folderName, 'No folders yet.', 'ft-stable:stats-folder');
  if (channelRoot) renderBreakdownList(channelRoot, statsData.byChannel, (g) => shortenChannelLabel(g.channelUrl), 'No subscribed-channel content yet.', 'ft-stable:stats-channel');
  if (recordsRoot) renderRecordTiles(recordsRoot, statsData);
  if (mostWatchedRoot) renderMostWatched(mostWatchedRoot, statsData.mostWatched, canModify);
  if (booksRoot) renderBookTiles(booksRoot, statsData.books);
  if (booksFolderRoot) renderBookFolders(booksFolderRoot, statsData.books);
  if (inventoryRoot) renderInventory(inventoryRoot, statsData.inventory);
  if (aboutRoot) renderAbout(aboutRoot, statsData.system);
}

function renderStatsError() {
  // v1.102: clear EVERY stats-fed container's seeded skeleton so a failed
  // /api/stats never strands a shimmer under a section that will never fill.
  // The duplicates list is fed by its own fetch and cleans up on its own path.
  for (const id of STATS_FETCH_CONTAINERS) {
    const el = document.getElementById(id);
    if (el) clearChildren(el);
  }
  const glanceRoot = document.getElementById('stats-glance-grid');
  if (!glanceRoot) return;
  const error = document.createElement('div');
  error.className = 'theme-card-blurb';
  error.textContent = 'Could not load stats right now. Try refreshing the page.';
  glanceRoot.appendChild(error);
}

// v1.151: per-view AbortController so destroy() (navigate-away) cancels the
// in-flight fetches and unbinds the { signal }-bound listeners -- mirrors
// books.js. Module-scoped so destroy() can reach it. A slow /api/stats
// resolving after the user left would otherwise render into a #view-root that
// has already been replaced.
let statsController = null;

// v1.162 (Dean): resolve the library-write capability once for the Stats delete
// affordances - admin OR the modify-library flag, the same admin-OR-flag the card
// delete uses (main.js fetchCardCornerState). Any failure/abort resolves FALSE (no
// delete controls) - the safe default; the server DELETE is RBAC-guarded regardless.
function resolveStatsCanModify(signal) {
  return fetch('/api/auth/me', { signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => !!(me && me.user && (me.user.role === 'admin' || me.user.canModifyLibrary === true)))
    .catch(() => false);
}

function init(viewRoot) {
  statsController = new AbortController();
  const signal = statsController.signal;
  // Resolved once, awaited by each deletable table so it renders WITH the correct
  // delete gating (never a flash of delete buttons before the capability is known).
  const capPromise = resolveStatsCanModify(signal);

  // v1.152: the master-detail menu (was per-section <details> collapse). Same
  // window-guarded reach as openShortcutsModal below (node:test requires this
  // file without common.js). Scope to the swapped-in view root; the component's
  // listeners bind to this init's signal so they die on destroy().
  const wireMD = (typeof window !== 'undefined') ? window.wireMasterDetail : undefined;
  const mdScope = viewRoot || (typeof document !== 'undefined' ? document : undefined);
  if (typeof wireMD === 'function') wireMD('stats', mdScope, signal);

  // v1.102 (tranche 4 shimmer): seed every container's shimmer BEFORE the three
  // fetches below, so the dashboard shimmers-then-reveals instead of painting
  // empty and reflowing as /api/stats, /api/duplicates and /api/library-items land.
  seedStatsSkeleton();

  // v1.47.8: the keyboard-shortcuts entry point. `openShortcutsModal` is a
  // common.js global (classic scripts, common.js loads first), reached via
  // `window` so this file still require()s cleanly in node:test. Wired before
  // the stats fetch so the button works even if /api/stats is slow or fails --
  // a shortcuts reference has no business depending on library statistics.
  const shortcutsBtn = document.getElementById('show-shortcuts-btn');
  if (shortcutsBtn) {
    shortcutsBtn.addEventListener('click', () => {
      const open = (typeof window !== 'undefined') ? window.openShortcutsModal : undefined;
      if (typeof open === 'function') open();
    }, { signal });
  }

  fetch('/api/stats', { signal })
    .then((res) => {
      if (!res.ok) throw new Error(`GET /api/stats failed (${res.status})`);
      return res.json();
    })
    .then((statsData) => capPromise.then((canModify) => renderStatsDashboard(statsData, canModify)))
    .catch((err) => {
      if (err && err.name === 'AbortError') return; // navigated away before it resolved -- expected
      console.error('Failed to load stats:', err);
      renderStatsError();
    });
  // v1.41.11: the duplicates report is its own fetch + render, deliberately
  // independent of /api/stats above -- a failure in either never blanks the
  // other's sections.
  fetch('/api/duplicates', { signal })
    .then((res) => {
      if (!res.ok) throw new Error(`GET /api/duplicates failed (${res.status})`);
      return res.json();
    })
    .then((report) => capPromise.then((canModify) => {
      const dupRoot = document.getElementById('stats-duplicates-list');
      if (dupRoot) renderDuplicates(dupRoot, report, canModify);
    }))
    .catch((err) => {
      if (err && err.name === 'AbortError') return; // navigated away before it resolved -- expected
      console.error('Failed to load duplicates report:', err);
      const dupRoot = document.getElementById('stats-duplicates-list');
      if (dupRoot) {
        clearChildren(dupRoot);
        const error = document.createElement('div');
        error.className = 'theme-card-blurb';
        error.textContent = 'Could not load the duplicates report right now. Try refreshing the page.';
        dupRoot.appendChild(error);
      }
    });
  // v1.159: the A/V table's own fetch (its own titles/sizes payload), independent
  // of /api/stats + /api/duplicates so any one failure never blanks the others.
  fetch('/api/library-items', { signal })
    .then((res) => {
      if (!res.ok) throw new Error(`GET /api/library-items failed (${res.status})`);
      return res.json();
    })
    .then((body) => capPromise.then((canModify) => {
      const avRoot = document.getElementById('stats-av-list');
      if (avRoot) renderAvTable(avRoot, body && body.items, canModify);
    }))
    .catch((err) => {
      if (err && err.name === 'AbortError') return; // navigated away -- expected
      console.error('Failed to load the videos & audio list:', err);
      const avRoot = document.getElementById('stats-av-list');
      if (avRoot) {
        clearChildren(avRoot);
        const error = document.createElement('div');
        error.className = 'theme-card-blurb';
        error.textContent = 'Could not load the videos & audio list right now. Try refreshing the page.';
        avRoot.appendChild(error);
      }
    });
}

// v1.151: the routed-view teardown. Aborts all three fetches and removes the
// { signal }-bound listeners; the next init() opens a fresh controller.
function destroy() {
  if (statsController) {
    statsController.abort();
    statsController = null;
  }
}

// v1.151: register with the SPA router (the setup.js/books.js contract).
// bootRouter runs init() for the initial view on a full-page load, and
// swapToView runs it on an in-app navigation -- ONE path, so no
// DOMContentLoaded self-boot (which would double-init now that /stats.html is
// a recognized route). Window-guarded so require()ing this file in node:test
// never touches window.
if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.registerView === 'function') {
  window.FileTube.registerView('stats', { init, destroy });
}

// Guarded so requiring this file in Node (for unit tests) never touches
// `window`/`document` -- mirrors setup.js/player.js's own module.exports guard.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatCount, formatTotalDuration, formatByteSize, formatItemDuration, formatRelativeDate, shortenChannelLabel, seedStatsSkeleton, renderStatsDashboard, renderStatsError, formatYtdlpAboutText, STATS_TILE_GRIDS, STATS_LIST_CONTAINERS, STATS_FETCH_CONTAINERS, renderBreakdownList, renderBookFolders, renderDuplicates, DUPLICATE_GROUPS_RENDER_CAP, renderAvTable, AV_RENDER_CAP, renderMostWatched, buildStatsDeleteAction, resolveStatsCanModify };
}
