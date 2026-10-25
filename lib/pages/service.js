'use strict';

// lib/pages/service.js - the Pages store: files (disk.js) + index (indexStore.js)
// kept in step. Every change to a user's files AND the matching index write run
// together inside ONE serial queue (`serial`), so a rebuild, a trash sweep, a note
// edit and a save can never interleave between a file operation and its database
// write (LESSONS 4: a window between a commit and a follow-up move needs a claim
// the other side honours). Network work (fetching a page, its images) happens
// OUTSIDE the queue; only the short write step queues.

const fs = require('fs');
const paths = require('./paths');
const meta = require('./meta');
const disk = require('./disk');
const { createPagesIndex } = require('./indexStore');

const TEXT_MAX_BYTES = 2 * 1024 * 1024;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A pasted text's Reader view: one <p> per paragraph (blank-line separated), single
// line breaks kept as <br/>. Escaped, never parsed.
function textToReaderHtml(text) {
  const paras = String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p) => '<p>' + p.split('\n').map(escapeHtml).join('<br/>') + '</p>').join('\n') + '\n';
}

// The first line of a pasted text, as a title.
function titleFromText(text) {
  const first = String(text).split('\n').map((l) => l.trim()).find(Boolean) || '';
  const t = first.length > 120 ? first.slice(0, 117).replace(/\s+\S*$/, '') + '...' : first;
  return t || 'Saved text';
}

function createPagesService({ adapter, root, now = () => Date.now(), log = console.log, userStore = null } = {}) {
  if (!adapter || !root) throw new Error('createPagesService needs { adapter, root }');
  const index = createPagesIndex(adapter);
  let chain = Promise.resolve();

  // The serial queue. fn may be async; its throw is the caller's, never the chain's.
  function serial(fn) {
    const run = chain.then(() => fn());
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  function usernameOf(userId) {
    if (!userStore || typeof userStore.getById !== 'function') return null;
    const u = userStore.getById(userId);
    return u && typeof u.username === 'string' ? u.username : null;
  }

  function ensureOwner(userId) {
    const name = usernameOf(userId);
    if (!name) return;
    const cur = disk.readOwner(root, userId);
    if (!cur || cur.username !== name) disk.writeOwner(root, userId, name);
  }

  function dirOf(item) {
    const at = disk.locate(root, item.userId, item.folder);
    return at ? at.dir : null;
  }

  function readText(item) {
    const dir = dirOf(item);
    return dir ? disk.readItemFile(dir, 'text.txt') : null;
  }

  // Save a new item. `record` is the item.json content minus id/savedAt/hashes;
  // files: { 'reader.html'?, 'original.html'?, 'text.txt' }. Runs in the queue.
  // Returns { item, duplicate } - an existing item with the same canonical URL wins (P12).
  function saveItem(userId, { record, files, assets = [] }) {
    if (!paths.isUserId(userId)) return Promise.reject(new Error('pages: invalid user'));
    return serial(() => {
      if (record.kind === 'url') {
        const dupe = (record.canonicalUrl && index.findByUrl(userId, record.canonicalUrl)) || (record.url && index.findByUrl(userId, record.url));
        if (dupe) return { item: dupe, duplicate: true };
      }
      const savedMs = now();
      const id = paths.newItemId();
      const full = { ...record, schema: meta.SCHEMA, id, savedAt: new Date(savedMs).toISOString() };
      const folder = paths.folderName(savedMs, full.title, id);
      ensureOwner(userId);
      const { record: written } = disk.createItem(root, userId, folder, { record: full, files, assets });
      index.indexItem(userId, folder, written, files['text.txt'] || '');
      return { item: index.getItem(userId, id), duplicate: false, record: written };
    });
  }

  function saveText(userId, { text, title = null, url = null, note = '', source = 'api' }) {
    if (typeof text !== 'string' || text.trim() === '') return Promise.reject(Object.assign(new Error('text is empty'), { status: 400 }));
    if (Buffer.byteLength(text, 'utf8') > TEXT_MAX_BYTES) return Promise.reject(Object.assign(new Error('text is larger than 2 MB'), { status: 413 }));
    const clean = meta.cleanText(text, TEXT_MAX_BYTES, true);
    const words = meta.countWords(clean);
    const record = {
      kind: 'text',
      title: meta.cleanText(title || '', meta.LIMITS.title) || titleFromText(clean),
      url: null,
      canonicalUrl: meta.cleanUrl(url),
      wordCount: words,
      readingMinutes: meta.readingMinutes(words),
      source,
      note,
      hasReader: true,
      hasOriginal: false,
      assets: { state: 'done', count: 0, bytes: 0, dropped: [] },
    };
    // A text save's link (if any) is context, not identity: never a duplicate key.
    record.url = null;
    return saveItem(userId, { record, files: { 'reader.html': textToReaderHtml(clean), 'text.txt': clean + '\n' } });
  }

  function getItem(userId, id) {
    return index.getItem(userId, id);
  }

  // The item's stored record (item.json) - the note lives only there and in the FTS row.
  function readRecord(item) {
    const dir = dirOf(item);
    return dir ? disk.readItem(dir) : null;
  }

  function readFile(item, name) {
    const dir = dirOf(item);
    return dir ? disk.readItemFile(dir, name) : null;
  }

  function assetFile(item, name) {
    const dir = dirOf(item);
    return dir ? disk.assetPath(dir, name) : null;
  }

  // Note edit: item.json rewritten (atomic), then the FTS row. Seeds from the FILE.
  function setNote(userId, id, note) {
    return serial(() => {
      const item = index.getItem(userId, id);
      if (!item) return null;
      const dir = dirOf(item);
      const cur = dir && disk.readItem(dir);
      if (!cur) throw new Error('pages: the item files are missing');
      const next = disk.updateItem(dir, { ...cur, note: meta.cleanText(note, meta.LIMITS.note, true) });
      index.indexItem(userId, item.folder, next, disk.readItemFile(dir, 'text.txt') || '');
      return { item: index.getItem(userId, id), record: next };
    });
  }

  // Apply a finished change to an existing item's files (the image localizer).
  // `mutate(record, dir)` returns { record, files, assets } or null to skip.
  function updateFiles(userId, id, mutate) {
    return serial(() => {
      const item = index.getItem(userId, id);
      if (!item) return null;
      const dir = dirOf(item);
      const cur = dir && disk.readItem(dir);
      if (!cur) return null;
      const change = mutate(cur, dir);
      if (!change) return null;
      const next = disk.updateItem(dir, change.record, { files: change.files || {}, assets: change.assets || [] });
      index.indexItem(userId, item.folder, next, disk.readItemFile(dir, 'text.txt') || '');
      return index.getItem(userId, id);
    });
  }

  function setReadState(userId, id, { read, position }) {
    const item = index.getItem(userId, id);
    if (!item) return null;
    const nowIso = new Date(now()).toISOString();
    const cur = index.getState(userId, id) || { readAt: null, position: null };
    let readAt = cur.readAt;
    if (read === true) readAt = readAt || nowIso;
    else if (read === false) readAt = null;
    let pos = cur.position;
    if (typeof position === 'number' && Number.isFinite(position)) pos = Math.max(0, Math.min(1, position));
    else if (position === null) pos = null;
    index.setState(userId, id, { readAt, position: pos }, nowIso);
    return index.getItem(userId, id);
  }

  function trash(userId, id) {
    return serial(() => {
      const item = index.getItem(userId, id);
      if (!item) return null;
      if (item.trashedAt) return item;
      const stamped = disk.moveToTrash(root, userId, item.folder, new Date(now()).toISOString());
      index.indexItem(userId, item.folder, stamped, readText(item) || '');
      return index.getItem(userId, id);
    });
  }

  function restore(userId, id) {
    return serial(() => {
      const item = index.getItem(userId, id);
      if (!item) return null;
      if (!item.trashedAt) return item;
      const back = disk.restoreFromTrash(root, userId, item.folder);
      index.indexItem(userId, item.folder, back, readText(item) || '');
      return index.getItem(userId, id);
    });
  }

  // The 30-day trash expiry. The candidates come from the index, but the decision
  // is the FILE's own stamp (disk.purgeTrashed re-reads it), and the whole user's
  // trash/ is also walked so an item the index lost is still expired on time.
  function purgeExpired(retentionMs = disk.TRASH_RETENTION_MS) {
    return serial(() => {
      const nowMs = now();
      let purged = 0;
      for (const userId of disk.listUserIds(root)) {
        for (const f of disk.listUserFolders(root, userId)) {
          if (f.where !== 'trash') continue;
          let gone = false;
          try { gone = disk.purgeTrashed(root, userId, f.folder, nowMs, retentionMs); } catch (err) { log(`[pages] trash expiry skipped ${userId}/${f.folder}: ${err.message}`); }
          if (gone) {
            purged += 1;
            const id = paths.parseFolder(f.folder).id;
            index.removeItem(userId, id);
          }
        }
      }
      return purged;
    });
  }

  // Rebuild the index from the files (plan D-DB): every user folder whose owner.json
  // names the account that holds that id now. A root that is missing or holds no
  // items while the index has rows is REFUSED (an unmounted share is not "everything
  // was deleted", LESSONS 9) unless `force`.
  function rebuild({ force = false } = {}) {
    return serial(() => {
      const nowMs = now();
      const entries = [];
      let skipped = 0;
      const rootExists = fs.existsSync(root);
      for (const userId of disk.listUserIds(root)) {
        const owner = disk.readOwner(root, userId);
        const current = usernameOf(userId);
        if (!current) { log(`[pages] rebuild: folder ${userId} has no account with that id - not indexed`); continue; }
        if (!owner || owner.username.toLowerCase() !== current.toLowerCase()) {
          log(`[pages] rebuild: folder ${userId} belongs to ${owner ? JSON.stringify(owner.username) : 'nobody (no owner.json)'}, not ${JSON.stringify(current)} - not indexed`);
          continue;
        }
        const seen = new Set();
        for (const f of disk.listUserFolders(root, userId)) {
          const record = disk.readItem(f.dir, { nowMs });
          const parsed = paths.parseFolder(f.folder);
          if (!record || record.id !== parsed.id || seen.has(record.id)) { skipped += 1; continue; }
          seen.add(record.id);
          // The stamp is the truth: a stamped item still in items/ is trashed.
          const text = disk.readItemFile(f.dir, 'text.txt') || '';
          entries.push({ userId, folder: f.folder, record, text });
        }
      }
      const had = index.countAll();
      if (!force && had > 0 && entries.length === 0) {
        log(`[pages] rebuild REFUSED: the index holds ${had} item(s) but ${rootExists ? 'the Pages folder has none' : 'the Pages folder is missing'} (${root}). Check the mount; nothing was changed.`);
        return { indexed: 0, skipped, refused: true };
      }
      const indexed = index.replaceIndex(entries);
      return { indexed, skipped, refused: false };
    });
  }

  // Boot: rebuild only when the index is empty (a fresh or lost database).
  function rebuildIfEmpty() {
    if (index.countAll() > 0) return Promise.resolve({ indexed: 0, skipped: 0, refused: false, ran: false });
    return rebuild().then((r) => ({ ...r, ran: true }));
  }

  function userDeleted(userId) {
    return serial(() => disk.setAsideUser(root, userId, now()));
  }

  return {
    root,
    index,
    serial,
    saveItem,
    saveText,
    getItem,
    readRecord,
    readFile,
    assetFile,
    setNote,
    updateFiles,
    setReadState,
    trash,
    restore,
    purgeExpired,
    rebuild,
    rebuildIfEmpty,
    userDeleted,
  };
}

module.exports = { createPagesService, textToReaderHtml, titleFromText, escapeHtml, TEXT_MAX_BYTES };
