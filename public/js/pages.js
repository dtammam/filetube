/* global showToast, composeTranscriptAiShare, shareTextContent, fetchTranscriptAiPrompts, copyTextToClipboard, uiStateHtml */
// FileTube Pages (v1.395.0, plan docs/exec-plans/active/2026-10-25-pages.md) -- registered VIEW
// MODULE (the history.js / feed.js pattern): `init(root)` runs on a full load AND an in-app swap
// into /pages; every listener binds through ONE per-instance AbortController so `destroy()`
// removes them all. Two modes in one view:
//   /pages          the library: All / Unread / each list / Trash, full-text search, Add
//   /pages?id=<id>  one item: metadata, the note, Reader / Original, lists, Share with AI,
//                   mark read, delete; the Reader keeps your place (PATCH position)
// Untrusted content: the Reader HTML comes from the server's allowlist sanitizer
// (lib/pages/sanitize.js) and is inserted into its own container; the Original loads in an
// <iframe sandbox> with no allow-scripts and no allow-same-origin, served under a strict CSP.
// Everything else is built with textContent.

// ---- Pure, DOM-free helpers (node:test-covered without a browser) ----------

// One bare http(s) link with nothing around it = a URL save; anything else = text.
function pagesLooksLikeUrl(input) {
  var s = String(input == null ? '' : input).trim();
  if (!/^https?:\/\/\S+$/i.test(s)) return false;
  try { var u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (_) { return false; }
}

// The POST /api/pages body for what was typed or pasted into Add.
function pagesSaveBody(input, note, source) {
  var s = String(input == null ? '' : input).trim();
  var body = pagesLooksLikeUrl(s) ? { url: s } : { text: s };
  var n = String(note == null ? '' : note).trim();
  if (n) body.note = n;
  body.source = source || 'web';
  return body;
}

// A local calendar date, e.g. "Oct 25, 2026" (the reader's own calendar, never UTC).
function pagesDateLabel(iso) {
  var t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (_) { return new Date(t).toDateString(); }
}

// The card's meta line: site, author, saved date, reading time.
function pagesMetaText(item) {
  var bits = [];
  if (item && item.site) bits.push(item.site);
  if (item && item.author && item.author !== item.site) bits.push(item.author); // a newsroom byline that IS the site, once
  var saved = pagesDateLabel(item && item.savedAt);
  if (saved) bits.push('Saved ' + saved);
  if (item && item.readingMinutes > 0) bits.push(item.readingMinutes + ' min read');
  if (item && item.saving) bits.push('Saving images');
  return bits.join(' \u00b7 ');
}

// How far through the Reader a scroll position is, 0..1 (1 = the end is on screen).
function pagesScrollFraction(scrollTop, contentTop, contentHeight, viewportHeight) {
  var span = contentHeight - viewportHeight;
  if (!(span > 0)) return 1;
  var f = (scrollTop - contentTop) / span;
  return Math.max(0, Math.min(1, f));
}

// The view's state from the URL: one item, or the library.
function pagesRouteState(search) {
  var q;
  try { q = new URLSearchParams(search || ''); } catch (_) { q = null; }
  var id = q && q.get('id');
  if (id && /^[0-9a-f]{12}$/.test(id)) return { mode: 'item', id: id };
  return { mode: 'library' };
}

// Reader / Original, remembered per user (a synced pref, public/js/prefs-sync.js).
var PAGES_VIEW_PREF = 'ft-pages-view';
function pagesPreferredView(stored, item) {
  if (!item || !item.hasReader) return 'original';
  if (!item.hasOriginal) return 'reader';
  return stored === 'original' ? 'original' : 'reader';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pagesLooksLikeUrl, pagesSaveBody, pagesDateLabel, pagesMetaText, pagesScrollFraction, pagesRouteState, pagesPreferredView, PAGES_VIEW_PREF };
}

(function () {
  if (typeof window === 'undefined') return;
  var controller = null;
  var PAGE_SEARCH_DEBOUNCE_MS = 250;
  var POSITION_DEBOUNCE_MS = 1500;
  var SAVING_POLL_MS = 3000;
  var TAB_KEY = 'ft-pages-tab'; // this viewer's last tab (a convenience, never synced)
  var READER_FONT_KEY = 'filetube_reader_fontsize'; // shared with the Books reader (read.js)
  var READER_THEME_KEY = 'filetube_reader_theme';
  var THEMES = ['paper', 'sepia', 'night'];

  function U() { return window.ui; }
  function readPref(k) { try { return window.localStorage.getItem(k); } catch (_) { return null; } }
  function writePref(k, v) { try { window.localStorage.setItem(k, v); } catch (_) { /* storage off */ } }
  function toast(msg, kind) { if (typeof showToast === 'function') showToast(msg); else if (U() && U().toast) U().toast(msg, { kind: kind || 'neutral' }); }
  function viewSignal(signal) { return (window.FileTube && typeof window.FileTube.viewSignal === 'function') ? window.FileTube.viewSignal() : signal; }
  function go(url) {
    if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(url);
    else window.location.assign(url);
  }
  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) { var e = new Error((body && body.error) || ('HTTP ' + r.status)); e.status = r.status; e.body = body; throw e; }
        return body;
      });
    });
  }
  function sendJson(method, path, body, signal) {
    return api(path, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: signal });
  }

  // ---- Add (a link or text, plus an optional note) ----
  function openAddSheet(signal, onSaved) {
    var u = U();
    var form = document.createElement('div');
    form.className = 'pages-add-form';
    var label = document.createElement('label');
    label.className = 'ui-field';
    var lt = document.createElement('span');
    lt.className = 'ui-field__label';
    lt.textContent = 'A link or some text';
    var input = document.createElement('textarea');
    input.className = 'ui-field__input pages-add-input';
    input.rows = 4;
    input.placeholder = 'https://... or paste text';
    label.appendChild(lt);
    label.appendChild(input);
    var noteLabel = document.createElement('label');
    noteLabel.className = 'ui-field';
    var nt = document.createElement('span');
    nt.className = 'ui-field__label';
    nt.textContent = 'Note (optional)';
    var note = document.createElement('input');
    note.className = 'ui-field__input';
    note.type = 'text';
    note.placeholder = 'Why you saved it, who sent it';
    noteLabel.appendChild(nt);
    noteLabel.appendChild(note);
    var status = document.createElement('p');
    status.className = 'pages-add-status';
    status.setAttribute('aria-live', 'polite');
    var actions = document.createElement('div');
    actions.className = 'pages-add-actions';
    var save = u.button({ variant: 'primary', size: 'md', label: 'Save', pill: true });
    actions.appendChild(save);
    form.appendChild(label);
    form.appendChild(noteLabel);
    form.appendChild(status);
    form.appendChild(actions);
    var sheet = u.sheet({ variant: 'auto', title: 'Add to Pages', content: form, initialFocus: input, signal: viewSignal(signal) });
    sheet.open();
    var busy = false;
    save.addEventListener('click', function (e) {
      if (typeof sheet.accepts === 'function' && !sheet.accepts(e)) return;
      if (busy) return;
      var value = input.value.trim();
      if (!value) { status.textContent = 'Paste a link or some text first.'; return; }
      busy = true;
      if (u.setBusy) u.setBusy(save, true);
      status.textContent = pagesLooksLikeUrl(value) ? 'Saving the page' : 'Saving the text';
      sendJson('POST', '/api/pages', pagesSaveBody(value, note.value, 'web'))
        .then(function (r) {
          sheet.close();
          toast(r.duplicate ? 'Already in Pages' : 'Saved to Pages');
          if (typeof onSaved === 'function') onSaved(r.item);
        })
        .catch(function (err) { status.textContent = err.message || 'Could not save that.'; })
        .then(function () { busy = false; if (u.setBusy) u.setBusy(save, false); });
    });
  }

  // ---- Share with AI (the shared prompt list; the text is fetched BEFORE the tap) ----
  function shareDocument(doc, title, prompt) {
    var text = prompt && typeof composeTranscriptAiShare === 'function' ? composeTranscriptAiShare(prompt.text, doc) : doc;
    if (typeof shareTextContent !== 'function') return;
    shareTextContent(text, title).then(function (outcome) {
      if (outcome === 'shared') return;
      toast(outcome === 'copied' ? (prompt ? 'Copied with your prompt - paste it into your AI app' : 'Copied') : 'Could not share that.');
    });
  }
  function openShareMenu(anchor, signal, docUrl, title) {
    var prompts = typeof fetchTranscriptAiPrompts === 'function' ? fetchTranscriptAiPrompts() : Promise.resolve([]);
    Promise.all([api(docUrl, { signal: signal }), prompts]).then(function (got) {
      if (signal.aborted) return;
      var doc = got[0].text;
      var list = got[1] || [];
      var items = list.map(function (p) { return { label: p.name, onSelect: function () { shareDocument(doc, title, p); } }; });
      items.push({ label: 'Share text', icon: 'share', onSelect: function () { shareDocument(doc, title, null); } });
      items.push({ label: 'Copy text', icon: 'content_copy', onSelect: function () {
        if (typeof copyTextToClipboard === 'function') copyTextToClipboard(doc).then(function (o) { toast(o === 'copied' ? 'Copied' : 'Could not copy.'); });
      } });
      U().menu({ title: 'Share with AI', label: 'Share with AI', anchor: anchor, items: items, signal: viewSignal(signal) });
    }).catch(function () { if (!signal.aborted) toast('Could not load the text to share.'); });
  }

  // ---- the library ----
  function initLibrary(root, signal) {
    var u = U();
    var listEl = root.querySelector('#pages-list');
    var emptyEl = root.querySelector('#pages-empty');
    var moreBtn = root.querySelector('#pages-loadmore');
    var viewsEl = root.querySelector('#pages-views');
    var searchEl = root.querySelector('#pages-search');
    var trashNote = root.querySelector('#pages-trash-note');
    var addBtn = root.querySelector('#pages-add-btn');
    var listActions = root.querySelector('#pages-list-actions');
    var tab = readPref(TAB_KEY) || 'all';
    var lists = [];
    var cursor = null;
    var gen = 0;
    var searchTimer = null;

    function tabQuery() {
      if (tab === 'unread' || tab === 'trash') return 'view=' + tab;
      if (tab.indexOf('list:') === 0) return 'list=' + encodeURIComponent(tab.slice(5));
      return 'view=all';
    }

    function rowFor(item) {
      var thumb = u.thumb({ src: item.leadImage || null, context: 'row' });
      var actions;
      if (item.trashedAt) {
        var restore = u.button({ variant: 'tonal', size: 'sm', label: 'Restore', pill: true });
        restore.classList.add('pages-restore');
        restore.setAttribute('data-id', item.id);
        actions = [restore];
      } else {
        actions = [null];
      }
      var row = u.row({ size: 'media', media: thumb, title: item.title || 'Untitled', meta: pagesMetaText(item), href: item.trashedAt ? null : '/pages?id=' + item.id, actions: actions, lead: item.read || item.trashedAt ? null : 'dot' });
      row.setAttribute('data-id', item.id);
      return row;
    }

    function skeleton(n) {
      var html = '';
      for (var i = 0; i < n; i++) {
        var thumb = u.thumb({ context: 'row' });
        thumb.classList.add('skeleton-shimmer');
        var t = document.createElement('span'); t.className = 'skeleton-text skeleton-text-long skeleton-shimmer'; t.textContent = ' ';
        var m = document.createElement('span'); m.className = 'skeleton-text skeleton-text-mid skeleton-shimmer'; m.textContent = ' ';
        var r = u.row({ size: 'media', media: thumb, title: t, meta: m, actions: [null] });
        r.setAttribute('aria-hidden', 'true');
        html += r.outerHTML;
      }
      return html;
    }

    function emptyState(q) {
      if (typeof uiStateHtml !== 'function') return '';
      if (q) return uiStateHtml({ icon: 'search', title: 'Nothing matches', body: 'No saved page has those words.' });
      if (tab === 'trash') return uiStateHtml({ icon: 'delete', title: 'The trash is empty', body: 'Pages you delete wait here for 30 days.' });
      if (tab === 'unread') return uiStateHtml({ icon: 'check', title: 'All read', body: 'Everything you saved has been read.' });
      return uiStateHtml({ icon: 'library_books', title: 'Nothing saved yet', body: 'Add a link or some text, or share a page from your phone or browser to save it here.' });
    }

    function load(append) {
      var my = ++gen;
      var q = searchEl && searchEl.value.trim();
      var url = '/api/pages?' + tabQuery() + (q ? '&q=' + encodeURIComponent(q) : '') + (append && cursor ? '&cursor=' + cursor : '');
      if (!append) { listEl.innerHTML = skeleton(5); listEl.hidden = false; emptyEl.hidden = true; moreBtn.hidden = true; }
      if (trashNote) trashNote.hidden = tab !== 'trash';
      return api(url, { signal: signal }).then(function (r) {
        if (signal.aborted || my !== gen) return;
        var frag = document.createDocumentFragment();
        r.items.forEach(function (it) { frag.appendChild(rowFor(it)); });
        if (append) listEl.appendChild(frag); else listEl.replaceChildren(frag);
        cursor = r.nextCursor;
        moreBtn.hidden = !cursor;
        var none = listEl.children.length === 0;
        listEl.hidden = none;
        emptyEl.hidden = !none;
        if (none) emptyEl.innerHTML = emptyState(q);
      }).catch(function (err) {
        if (signal.aborted || my !== gen) return;
        listEl.replaceChildren();
        listEl.hidden = true;
        emptyEl.hidden = false;
        emptyEl.innerHTML = typeof uiStateHtml === 'function' ? uiStateHtml({ icon: 'warning', title: 'Could not load your pages', body: err.message || '', tone: 'error' }) : '';
      });
    }

    function renderChips() {
      viewsEl.replaceChildren();
      var defs = [{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }];
      lists.forEach(function (l) { defs.push({ key: 'list:' + l.id, label: l.name }); });
      defs.push({ key: 'trash', label: 'Trash' });
      if (!defs.some(function (d) { return d.key === tab; })) tab = 'all';
      defs.forEach(function (d) {
        var chip = u.chip({ kind: 'filter', label: d.label, selected: d.key === tab, onClick: function () {
          if (tab === d.key) return;
          tab = d.key;
          writePref(TAB_KEY, tab);
          renderChips();
          load(false);
        } });
        viewsEl.appendChild(chip);
      });
      var add = u.chip({ kind: 'filter', label: 'New list', onClick: function () { newList(); } });
      add.classList.add('pages-newlist-chip');
      viewsEl.appendChild(add);
      renderListActions();
    }

    // A selected list: Share with AI (every page in list order, P5/P8), Rename, Delete (never its pages).
    function renderListActions() {
      if (!listActions) return;
      listActions.replaceChildren();
      var list = tab.indexOf('list:') === 0 ? lists.filter(function (l) { return 'list:' + l.id === tab; })[0] : null;
      listActions.hidden = !list;
      if (!list) return;
      var share = u.button({ variant: 'secondary', size: 'sm', icon: 'share', label: 'Share with AI', pill: true });
      var rename = u.button({ variant: 'secondary', size: 'sm', icon: 'edit', label: 'Rename', pill: true });
      var del = u.button({ variant: 'danger', size: 'sm', icon: 'delete', label: 'Delete list', pill: true });
      share.addEventListener('click', function () { openShareMenu(share, signal, '/api/pages/lists/' + list.id + '/share', list.name); });
      rename.addEventListener('click', function () {
        u.prompt({ title: 'Rename list', label: 'Name', value: list.name, confirmLabel: 'Rename', signal: viewSignal(signal) }).then(function (name) {
          if (!name || !name.trim()) return;
          sendJson('PATCH', '/api/pages/lists/' + list.id, { name: name.trim() }, signal).then(function (r) { list.name = r.list.name; renderChips(); }).catch(function (err) { toast(err.message); });
        });
      });
      del.addEventListener('click', function () {
        u.confirm({ title: 'Delete the list "' + list.name + '"?', body: 'Its pages stay in Pages; only the list goes.', confirmLabel: 'Delete list', danger: true, signal: viewSignal(signal) }).then(function (yes) {
          if (!yes) return;
          api('/api/pages/lists/' + list.id, { method: 'DELETE', signal: signal }).then(function () {
            lists = lists.filter(function (l) { return l.id !== list.id; });
            tab = 'all';
            writePref(TAB_KEY, tab);
            renderChips();
            load(false);
          }).catch(function (err) { toast(err.message); });
        });
      });
      [share, rename, del].forEach(function (b) { listActions.appendChild(b); });
    }

    function newList() {
      u.prompt({ title: 'New list', label: 'Name', confirmLabel: 'Create', signal: viewSignal(signal) }).then(function (name) {
        if (!name || !name.trim()) return;
        sendJson('POST', '/api/pages/lists', { name: name.trim() }, signal).then(function (r) {
          lists.push(r.list);
          tab = 'list:' + r.list.id;
          writePref(TAB_KEY, tab);
          renderChips();
          load(false);
        }).catch(function (err) { toast(err.message || 'Could not create the list.'); });
      });
    }

    function loadLists() {
      return api('/api/pages/lists', { signal: signal }).then(function (r) {
        if (signal.aborted) return;
        lists = r.lists || [];
        renderChips();
      }).catch(function () { renderChips(); });
    }

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.pages-restore');
      if (!btn) return;
      e.preventDefault();
      var id = btn.getAttribute('data-id');
      sendJson('POST', '/api/pages/' + id + '/restore', {}, signal).then(function () {
        toast('Restored');
        var row = btn.closest('.ui-row');
        if (row) row.remove();
        if (listEl.children.length === 0) load(false);
      }).catch(function (err) { toast(err.message || 'Could not restore it.'); });
    }, { signal: signal });
    if (moreBtn) moreBtn.addEventListener('click', function () { load(true); }, { signal: signal });
    if (searchEl) searchEl.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { if (!signal.aborted) load(false); }, PAGE_SEARCH_DEBOUNCE_MS);
    }, { signal: signal });
    if (addBtn) addBtn.addEventListener('click', function () { openAddSheet(signal, function () { load(false); }); }, { signal: signal });
    signal.addEventListener('abort', function () { clearTimeout(searchTimer); });

    renderChips();
    load(false);
    loadLists();
  }

  // ---- one item ----
  function initItem(root, signal, id) {
    var u = U();
    var host = root.querySelector('#pages-item');
    var lib = root.querySelector('#pages-library');
    if (lib) lib.hidden = true;
    host.hidden = false;
    host.innerHTML = '<div class="pages-item-skeleton" aria-hidden="true"><span class="skeleton-text skeleton-text-long skeleton-shimmer"> </span><span class="skeleton-text skeleton-text-mid skeleton-shimmer"> </span><span class="skeleton-text skeleton-text-long skeleton-shimmer"> </span><span class="skeleton-text skeleton-text-short skeleton-shimmer"> </span></div>';
    var posTimer = null;
    var pollTimer = null;
    signal.addEventListener('abort', function () { clearTimeout(posTimer); clearTimeout(pollTimer); });

    function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }

    function render(data) {
      var item = data.item;
      host.replaceChildren();
      var back = el('a', 'pages-back ui-btn ui-btn--plain ui-btn--sm');
      back.href = '/pages';
      back.appendChild(u.icon('arrow_back', { size: 'sm' }));
      back.appendChild(el('span', 'ui-btn__label', 'Pages'));
      host.appendChild(back);
      var head = el('div', 'pages-item-head'); // a div: the app styles every <header> as its own bar
      head.appendChild(el('h1', 'pages-item-title', item.title || 'Untitled'));
      var meta = el('p', 'pages-item-meta');
      var bits = [];
      if (item.author) bits.push(item.author);
      if (item.publishedAt) bits.push('Published ' + pagesDateLabel(item.publishedAt));
      bits.push('Saved ' + pagesDateLabel(item.savedAt));
      if (item.readingMinutes > 0) bits.push(item.readingMinutes + ' min read');
      meta.textContent = bits.join(' \u00b7 ');
      head.appendChild(meta);
      if (item.url) {
        var src = el('a', 'pages-item-source', item.site || item.url);
        src.href = item.url;
        src.target = '_blank';
        src.rel = 'noopener noreferrer';
        head.appendChild(src);
      }
      host.appendChild(head);

      // The note (tap to edit).
      var noteBox = el('div', 'pages-note');
      var noteText = el('p', 'pages-note-text', item.note || '');
      noteText.hidden = !item.note;
      var noteBtn = u.button({ variant: 'plain', size: 'sm', icon: 'edit', label: item.note ? 'Edit note' : 'Add note' });
      noteBox.appendChild(noteText);
      noteBox.appendChild(noteBtn);
      host.appendChild(noteBox);
      noteBtn.addEventListener('click', function () {
        u.prompt({ title: 'Note', label: 'Why you saved it, who sent it', value: item.note || '', confirmLabel: 'Save', signal: viewSignal(signal) }).then(function (v) {
          if (v === null || signal.aborted) return;
          sendJson('PATCH', '/api/pages/' + id, { note: v }, signal).then(function (r) {
            item.note = r.item.note;
            noteText.textContent = item.note;
            noteText.hidden = !item.note;
            var lbl = noteBtn.querySelector('.ui-btn__label');
            if (lbl) lbl.textContent = item.note ? 'Edit note' : 'Add note';
          }).catch(function (err) { toast(err.message || 'Could not save the note.'); });
        });
      }, { signal: signal });

      // Actions: the view toggle, Aa, lists, share, read, delete. A row that wraps, never shrinks.
      var bar = el('div', 'pages-item-actions');
      var current = pagesPreferredView(readPref(PAGES_VIEW_PREF), item);
      var toggle = null;
      if (item.hasReader && item.hasOriginal) {
        toggle = u.segmented({ label: 'View', value: current, options: [{ value: 'reader', label: 'Reader' }, { value: 'original', label: 'Original' }], onChange: function (v) {
          current = v;
          writePref(PAGES_VIEW_PREF, v);
          showView();
        } });
        bar.appendChild(toggle);
      }
      var aa = u.button({ variant: 'secondary', size: 'sm', icon: 'format_size', label: 'Text', pill: true });
      var listBtn = u.button({ variant: 'secondary', size: 'sm', icon: 'playlist_add', label: 'Add to list', pill: true });
      var shareBtn = u.button({ variant: 'secondary', size: 'sm', icon: 'share', label: 'Share with AI', pill: true });
      var readBtn = u.button({ variant: 'secondary', size: 'sm', icon: 'check', labels: ['Mark read', 'Mark unread'], pressed: !!item.read, pill: true });
      var delBtn = u.button({ variant: 'danger', size: 'sm', icon: 'delete', label: item.trashedAt ? 'Restore' : 'Delete', pill: true });
      [aa, listBtn, shareBtn, readBtn, delBtn].forEach(function (b) { bar.appendChild(b); });
      host.appendChild(bar);

      if (item.saving) host.appendChild(el('p', 'pages-item-saving', 'Saving images. They appear when they are stored.'));
      if (!item.hasReader && item.kind === 'url') host.appendChild(el('p', 'pages-item-note', 'Reader view unavailable for this page.'));

      var readerEl = el('div', 'pages-reader reader-content');
      // The text size (the Books reader's 80-170 %) scales this inner box against the reader's base size.
      var readerBody = el('div', 'pages-reader-body');
      readerEl.appendChild(readerBody);
      var originalEl = el('div', 'pages-original');
      host.appendChild(readerEl);
      host.appendChild(originalEl);
      var theme = THEMES.indexOf(readPref(READER_THEME_KEY)) >= 0 ? readPref(READER_THEME_KEY) : 'paper';
      var size = Number(readPref(READER_FONT_KEY));
      if (!(size >= 80 && size <= 170)) size = 120; // no saved size: a reading size above the app's body text
      function applyLook() {
        readerEl.classList.remove('theme-paper', 'theme-sepia', 'theme-night');
        readerEl.classList.add('theme-' + theme);
        readerBody.style.fontSize = size + '%';
      }
      applyLook();

      var originalLoaded = false;
      function showView() {
        var reader = current === 'reader' && data.reader !== null;
        readerEl.hidden = !reader;
        originalEl.hidden = reader;
        aa.hidden = !reader;
        if (!reader && !originalLoaded && item.hasOriginal) {
          originalLoaded = true;
          var f = document.createElement('iframe');
          f.className = 'pages-original-frame';
          f.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
          f.setAttribute('referrerpolicy', 'no-referrer');
          f.setAttribute('title', 'Original page');
          f.src = '/api/pages/' + id + '/original';
          originalEl.appendChild(f);
        }
      }
      if (data.reader !== null) {
        // Sanitized on the server (lib/pages/sanitize.js, reader profile + final mode).
        readerBody.innerHTML = data.reader;
      }
      showView();

      // Resume: restore the place, then keep it (debounced) and mark read at the end.
      function readerTop() { return readerEl.getBoundingClientRect().top + window.scrollY; }
      if (data.reader !== null && item.position > 0 && item.position < 1) {
        window.requestAnimationFrame(function () {
          var span = readerEl.offsetHeight - window.innerHeight;
          if (span > 0) window.scrollTo(0, readerTop() + item.position * span);
        });
      }
      window.addEventListener('scroll', function () {
        if (readerEl.hidden) return;
        clearTimeout(posTimer);
        posTimer = setTimeout(function () {
          if (signal.aborted) return;
          var f = pagesScrollFraction(window.scrollY, readerTop(), readerEl.offsetHeight, window.innerHeight);
          var body = { position: Math.round(f * 1000) / 1000 };
          if (f >= 0.98 && !item.read) { body.read = true; item.read = true; if (u.setPressed) u.setPressed(readBtn, true); }
          sendJson('PATCH', '/api/pages/' + id, body, signal).catch(function () { /* the next scroll tries again */ });
        }, POSITION_DEBOUNCE_MS);
      }, { signal: signal, passive: true });

      aa.addEventListener('click', function () {
        var box = el('div', 'reader-settings');
        var sizeRow = el('div', 'reader-setting');
        sizeRow.appendChild(el('span', 'reader-setting__name', 'Text size'));
        var stepper = el('div', 'reader-stepper');
        var minus = u.button({ variant: 'secondary', shape: 'icon', size: 'sm', icon: 'remove', ariaLabel: 'Smaller text' });
        var value = el('span', 'reader-stepper__value', size + '%');
        var plus = u.button({ variant: 'secondary', shape: 'icon', size: 'sm', icon: 'add', ariaLabel: 'Larger text' });
        function step(d) { size = Math.max(80, Math.min(170, size + d)); value.textContent = size + '%'; writePref(READER_FONT_KEY, String(size)); applyLook(); }
        minus.addEventListener('click', function () { step(-10); });
        plus.addEventListener('click', function () { step(10); });
        stepper.appendChild(minus); stepper.appendChild(value); stepper.appendChild(plus);
        sizeRow.appendChild(stepper);
        box.appendChild(sizeRow);
        var themeRow = el('div', 'reader-setting');
        themeRow.appendChild(el('span', 'reader-setting__name', 'Theme'));
        themeRow.appendChild(u.segmented({ label: 'Reading theme', value: theme, options: [{ value: 'paper', label: 'Paper' }, { value: 'sepia', label: 'Sepia' }, { value: 'night', label: 'Night' }], onChange: function (v) { theme = v; writePref(READER_THEME_KEY, v); applyLook(); } }));
        box.appendChild(themeRow);
        u.sheet({ variant: 'auto', anchor: aa, title: 'Reader settings', content: box, signal: viewSignal(signal) }).open();
      }, { signal: signal });

      listBtn.addEventListener('click', function () {
        api('/api/pages/lists', { signal: signal }).then(function (r) {
          if (signal.aborted) return;
          var mine = item.lists || [];
          var items = (r.lists || []).map(function (l) {
            var inIt = mine.indexOf(l.id) >= 0;
            return { label: l.name, checked: inIt, onSelect: function () { toggleList(l, !inIt); } };
          });
          items.push({ label: 'New list', icon: 'add', onSelect: function () {
            u.prompt({ title: 'New list', label: 'Name', confirmLabel: 'Create', signal: viewSignal(signal) }).then(function (name) {
              if (!name || !name.trim()) return;
              sendJson('POST', '/api/pages/lists', { name: name.trim() }, signal).then(function (c) { toggleList(c.list, true); }).catch(function (err) { toast(err.message); });
            });
          } });
          u.menu({ title: 'Add to list', label: 'Add to list', anchor: listBtn, items: items, signal: viewSignal(signal) });
        }).catch(function () { toast('Could not load your lists.'); });
      }, { signal: signal });

      // Membership is compare-and-set (the server's version): a stale copy retries once.
      function toggleList(list, add, retried) {
        api('/api/pages/lists/' + list.id + '/items', { signal: signal }).then(function (cur) {
          var ids = cur.items.filter(function (x) { return x !== id; });
          if (add) ids.push(id);
          return sendJson('PUT', '/api/pages/lists/' + list.id + '/items', { items: ids, version: cur.version }, signal);
        }).then(function () {
          item.lists = (item.lists || []).filter(function (x) { return x !== list.id; });
          if (add) item.lists.push(list.id);
          toast(add ? 'Added to ' + list.name : 'Removed from ' + list.name);
        }).catch(function (err) {
          if (err.status === 409 && !retried) { toggleList(list, add, true); return; }
          toast(err.message || 'Could not change the list.');
        });
      }

      shareBtn.addEventListener('click', function () { openShareMenu(shareBtn, signal, '/api/pages/' + id + '/share', item.title); }, { signal: signal });

      readBtn.addEventListener('click', function () {
        var next = !item.read;
        sendJson('PATCH', '/api/pages/' + id, { read: next }, signal).then(function (r) {
          item.read = r.item.read;
          if (u.setPressed) u.setPressed(readBtn, item.read);
        }).catch(function (err) { toast(err.message || 'Could not change that.'); });
      }, { signal: signal });

      delBtn.addEventListener('click', function () {
        if (item.trashedAt) {
          sendJson('POST', '/api/pages/' + id + '/restore', {}, signal).then(function () { toast('Restored'); go('/pages?id=' + id); }).catch(function (err) { toast(err.message); });
          return;
        }
        u.confirm({ title: 'Delete this page?', body: 'It moves to the trash in Pages and can be restored for 30 days.', confirmLabel: 'Delete', danger: true, signal: viewSignal(signal) }).then(function (yes) {
          if (!yes || signal.aborted) return;
          api('/api/pages/' + id, { method: 'DELETE', signal: signal }).then(function () {
            toast('Moved to the trash');
            go('/pages');
          }).catch(function (err) { toast(err.message || 'Could not delete it.'); });
        });
      }, { signal: signal });

      // While images are still being stored, check back until they land.
      if (item.saving) {
        pollTimer = setTimeout(function poll() {
          if (signal.aborted) return;
          api('/api/pages/' + id, { signal: signal }).then(function (d) {
            if (signal.aborted) return;
            if (d.item.saving) { pollTimer = setTimeout(poll, SAVING_POLL_MS); return; }
            render(d);
          }).catch(function () { /* stop polling on an error */ });
        }, SAVING_POLL_MS);
      }
    }

    api('/api/pages/' + id, { signal: signal }).then(function (d) {
      if (signal.aborted) return;
      render(d);
    }).catch(function (err) {
      if (signal.aborted) return;
      host.innerHTML = typeof uiStateHtml === 'function'
        ? uiStateHtml({ icon: 'warning', title: err.status === 404 ? 'This page is not in your Pages' : 'Could not open this page', body: err.status === 404 ? '' : (err.message || ''), tone: 'error' })
        : '';
    });
  }

  function init(root) {
    controller = new AbortController();
    var signal = controller.signal;
    if (!root || !window.ui) return;
    var st = pagesRouteState(window.location.search);
    if (st.mode === 'item') initItem(root, signal, st.id);
    else initLibrary(root, signal);
  }

  function destroy() {
    if (controller) controller.abort();
    controller = null;
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('pages', { init: init, destroy: destroy });
  }
})();
