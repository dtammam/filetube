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
// channel can craft it), its `channelUrl`, and the composed `lastStatus`
// string (which can carry a redacted-but-still-server-composed error) -- is
// assigned via `textContent` ONLY. This file never uses `innerHTML` or a
// template-string interpolation for ANY of that data (see
// `createSubscriptionRow` below, the one place all of it is rendered).
//
// Mirrors public/js/common.js's Node-testability pattern: pure/DOM-building
// helpers are defined at module scope and exported at the bottom (guarded by
// `typeof module !== 'undefined'`) so node:test can exercise them directly,
// without a real browser, by injecting a minimal fake `document`.

// ---- Pure formatting helpers (no DOM) --------------------------------------

function formatSubMeta(sub) {
  const format = sub && sub.format === 'audio' ? 'Audio' : 'Video';
  const quality = sub && typeof sub.quality === 'string' && sub.quality.trim() !== ''
    ? sub.quality.trim()
    : 'best';
  return format + ' · quality: ' + quality;
}

function formatSubStatus(sub) {
  const checked = sub && sub.lastCheckedAt ? new Date(sub.lastCheckedAt).toLocaleString() : 'never checked';
  const status = sub && typeof sub.lastStatus === 'string' && sub.lastStatus.trim() !== ''
    ? sub.lastStatus
    : 'pending';
  return 'Last checked: ' + checked + ' — ' + status;
}

// ---- DOM construction (textContent-only for every server/user-derived string) --

/**
 * Build one subscription row as a real DOM node. `handlers` =
 * `{ onRepull(id), onDelete(sub) }` decouples DOM construction from network
 * calls so this function stays pure and unit-testable (a test can invoke a
 * fake element's recorded click listener directly, without a real fetch).
 * `doc` defaults to the global `document` so real page code can call this
 * with no second argument; tests inject a minimal fake.
 */
function createSubscriptionRow(sub, doc, handlers) {
  const d = doc || document;
  const h = handlers || {};
  const row = d.createElement('div');
  row.className = 'folder-item-row';

  const info = d.createElement('div');
  info.setAttribute('style', 'flex:1; min-width:0;');

  const nameEl = d.createElement('div');
  nameEl.className = 'folder-path-text';
  // SECURITY: `sub.name` is derived from yt-dlp channel metadata at add-time
  // -- a malicious channel could set a hostile display name (e.g. containing
  // `<script>`/`<img onerror=...>`). `textContent` renders it as inert text
  // no matter what it contains; it is NEVER passed through `innerHTML` or a
  // template string.
  nameEl.textContent = (sub && sub.name) || '(untitled subscription)';
  info.appendChild(nameEl);

  const urlEl = d.createElement('div');
  urlEl.setAttribute('style', 'font-size:11px; color:var(--text-secondary); margin-top:4px; word-break:break-all;');
  // SECURITY: channelUrl is server-persisted, user-supplied at add-time.
  urlEl.textContent = (sub && sub.channelUrl) || '';
  info.appendChild(urlEl);

  const metaEl = d.createElement('div');
  metaEl.setAttribute('style', 'font-size:11px; color:var(--text-secondary); margin-top:2px;');
  metaEl.textContent = formatSubMeta(sub);
  info.appendChild(metaEl);

  const statusEl = d.createElement('div');
  statusEl.setAttribute('style', 'font-size:11px; color:var(--text-secondary); margin-top:2px;');
  // SECURITY: `lastStatus` can carry a redacted-but-still-server-composed
  // error string (lib/ytdlp/index.js's safeErrorStatus) -- textContent only.
  statusEl.textContent = formatSubStatus(sub);
  info.appendChild(statusEl);

  row.appendChild(info);

  const actions = d.createElement('div');
  actions.setAttribute('style', 'display:flex; gap:6px; flex-shrink:0; align-items:center;');

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
  return row;
}

/**
 * Build the full list (or an empty-state message) as a single container
 * node. Callers own replacing the target container's previous contents --
 * this function only ever builds, never clears/mutates anything else.
 */
function createSubscriptionsListElement(subs, doc, handlers) {
  const d = doc || document;
  const container = d.createElement('div');
  if (!subs || subs.length === 0) {
    const empty = d.createElement('div');
    empty.setAttribute('style', 'color:var(--text-secondary); font-style:italic; padding:8px 4px;');
    empty.textContent = 'No subscriptions yet. Add a channel above to get started.';
    container.appendChild(empty);
    return container;
  }
  subs.forEach((sub) => container.appendChild(createSubscriptionRow(sub, d, handlers)));
  return container;
}

// Removes all children of `el` without ever touching innerHTML -- kept
// consistent with this file's textContent-only discipline even though
// clearing to '' would carry no interpolation risk either way.
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ---- Live page wiring (guarded so requiring this file in Node is inert) ----

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const listContainer = document.getElementById('sub-list-container');
    const addUrlInput = document.getElementById('sub-add-url');
    const addFormatSelect = document.getElementById('sub-add-format');
    const addQualityInput = document.getElementById('sub-add-quality');
    const addBtn = document.getElementById('sub-add-btn');
    const addError = document.getElementById('sub-add-error');
    const membersOnlyCheck = document.getElementById('sub-members-only-check');
    const membersOnlyError = document.getElementById('sub-members-only-error');
    const repullAllBtn = document.getElementById('sub-repull-all-btn');
    const repullStatus = document.getElementById('sub-repull-status');

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

    function loadSubscriptions() {
      if (!listContainer) return;
      fetch('/api/subscriptions')
        .then((r) => r.json())
        .then((subs) => {
          clearChildren(listContainer);
          listContainer.appendChild(createSubscriptionsListElement(subs, document, {
            onRepull: repullOne,
            onDelete: confirmAndDelete,
          }));
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

    function repullOne(id) {
      if (!id) return;
      fetch('/api/subscriptions/' + encodeURIComponent(id) + '/repull', { method: 'POST' })
        .then((r) => {
          if (repullStatus) {
            repullStatus.textContent = r.ok ? 'Re-pull requested…' : 'Re-pull could not be started.';
          }
          // No queue/progress viz (out of scope) -- just refresh the list once
          // shortly after, so a quick re-check's status has a chance to land.
          setTimeout(loadSubscriptions, 1500);
        })
        .catch((err) => {
          if (repullStatus) repullStatus.textContent = 'Re-pull request failed.';
          console.error('Re-pull-one failed:', err);
        });
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

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const channelUrl = addUrlInput ? addUrlInput.value.trim() : '';
        const format = addFormatSelect ? addFormatSelect.value : 'video';
        const quality = addQualityInput ? addQualityInput.value.trim() : '';
        setFieldError(addError, null);
        if (!channelUrl) {
          setFieldError(addError, 'Enter a channel URL.');
          return;
        }
        const body = { channelUrl, format };
        if (quality) body.quality = quality;
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
            if (addQualityInput) addQualityInput.value = '';
            loadSubscriptions();
          })
          .catch((err) => {
            setFieldError(addError, 'Could not add subscription (network error).');
            console.error('Add subscription failed:', err);
          });
      });
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
      });
    }

    if (repullAllBtn) {
      repullAllBtn.addEventListener('click', () => {
        fetch('/api/subscriptions/repull', { method: 'POST' })
          .then((r) => {
            if (repullStatus) {
              repullStatus.textContent = r.ok ? 'Re-pull-all requested…' : 'Re-pull-all could not be started.';
            }
            setTimeout(loadSubscriptions, 1500);
          })
          .catch((err) => {
            if (repullStatus) repullStatus.textContent = 'Re-pull-all request failed.';
            console.error('Re-pull-all failed:', err);
          });
      });
    }

    loadSubscriptions();
    loadMembersOnlySetting();
  });
}

// Expose pure/DOM-building helpers to Node for unit testing (browsers ignore
// this block -- `module` is undefined there), mirroring common.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatSubMeta,
    formatSubStatus,
    createSubscriptionRow,
    createSubscriptionsListElement,
  };
}
