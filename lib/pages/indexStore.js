'use strict';

// lib/pages/indexStore.js - the Pages database (schema v39, lib/db/sqlite.js).
// Two halves with different durability:
//
//  - the INDEX (`pages_items` + `pages_fts`) is derived from the files and is
//    rebuilt from them (replaceIndex); losing it loses nothing;
//  - the per-user STATE (`pages_state`: read time + Reader position, and the
//    lists `pages_lists` / `pages_list_items`) lives only here and rides the
//    per-user backup bundle (exportUser / importUser). It references items by id
//    VALUE, never by FK to the index, so a rebuild never touches it.
//
// Every read and write takes the user id and scopes by it in SQL (plan P9): there
// is no unscoped read path. Prepared against adapter.sql (the source lock keeps
// node:sqlite itself in lib/db/sqlite.js).

const ITEM_COLS = 'i.id, i.user_id, i.folder, i.kind, i.url, i.canonical_url, i.title, i.site, i.author, i.published_at, i.saved_at, i.word_count, i.lead_image, i.description, i.has_reader, i.has_original, i.assets_state, i.trashed_at';
const STATE_COLS = 's.read_at, s.position';
const PAGE_LIMIT_MAX = 200;
const LIST_NAME_MAX = 100;
const LISTS_PER_USER_MAX = 500;
const ITEMS_PER_LIST_MAX = 5000;

function assertKey(id, what) {
  if (typeof id !== 'string' || id === '' || id.includes('\u0000')) throw new Error(`pages: invalid ${what}`);
}

function statementsFor(adapter) {
  if (adapter.__pagesStmts) return adapter.__pagesStmts;
  const sql = adapter.sql;
  const s = {
    upsertItem: sql.prepare(`INSERT INTO pages_items (id, user_id, folder, kind, url, canonical_url, title, site, author, published_at, saved_at, word_count, lead_image, description, has_reader, has_original, assets_state, trashed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET folder = excluded.folder, kind = excluded.kind, url = excluded.url, canonical_url = excluded.canonical_url,
        title = excluded.title, site = excluded.site, author = excluded.author, published_at = excluded.published_at, saved_at = excluded.saved_at,
        word_count = excluded.word_count, lead_image = excluded.lead_image, description = excluded.description, has_reader = excluded.has_reader,
        has_original = excluded.has_original, assets_state = excluded.assets_state, trashed_at = excluded.trashed_at
      WHERE pages_items.user_id = excluded.user_id`),
    rowidOf: sql.prepare('SELECT rowid AS r, user_id FROM pages_items WHERE id = ?'),
    ftsDelete: sql.prepare('DELETE FROM pages_fts WHERE rowid = ?'),
    ftsInsert: sql.prepare('INSERT INTO pages_fts (rowid, title, site, author, note, body) VALUES (?, ?, ?, ?, ?, ?)'),
    deleteItem: sql.prepare('DELETE FROM pages_items WHERE id = ? AND user_id = ?'),
    deleteUserItems: sql.prepare('DELETE FROM pages_items WHERE user_id = ?'),
    deleteAllItems: sql.prepare('DELETE FROM pages_items'),
    ftsClear: sql.prepare('DELETE FROM pages_fts'),
    countItems: sql.prepare('SELECT COUNT(*) AS c FROM pages_items'),
    countUserItems: sql.prepare('SELECT COUNT(*) AS c FROM pages_items WHERE user_id = ?'),
    getItem: sql.prepare(`SELECT ${ITEM_COLS}, ${STATE_COLS} FROM pages_items i LEFT JOIN pages_state s ON s.user_id = i.user_id AND s.item_id = i.id WHERE i.id = ? AND i.user_id = ?`),
    byCanonical: sql.prepare(`SELECT ${ITEM_COLS}, ${STATE_COLS} FROM pages_items i LEFT JOIN pages_state s ON s.user_id = i.user_id AND s.item_id = i.id WHERE i.user_id = ? AND (i.canonical_url = ? OR i.url = ?) ORDER BY i.trashed_at IS NOT NULL, i.saved_at LIMIT 1`),
    trashedBefore: sql.prepare('SELECT id, user_id, folder, trashed_at FROM pages_items WHERE trashed_at IS NOT NULL AND trashed_at < ? ORDER BY trashed_at, id'),
    getState: sql.prepare('SELECT read_at, position, updated_at FROM pages_state WHERE user_id = ? AND item_id = ?'),
    upsertState: sql.prepare(`INSERT INTO pages_state (user_id, item_id, read_at, position, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, item_id) DO UPDATE SET read_at = excluded.read_at, position = excluded.position, updated_at = excluded.updated_at`),
    deleteState: sql.prepare('DELETE FROM pages_state WHERE user_id = ? AND item_id = ?'),
    allState: sql.prepare('SELECT item_id, read_at, position, updated_at FROM pages_state WHERE user_id = ? ORDER BY item_id'),
    // lists
    lists: sql.prepare(`SELECT l.id, l.name, l.created_at, l.ord,
        (SELECT COUNT(*) FROM pages_list_items li JOIN pages_items i ON i.id = li.item_id AND i.user_id = l.user_id AND i.trashed_at IS NULL WHERE li.list_id = l.id) AS count
      FROM pages_lists l WHERE l.user_id = ? ORDER BY l.ord, l.created_at, l.id`),
    getList: sql.prepare('SELECT id, name, created_at, ord FROM pages_lists WHERE id = ? AND user_id = ?'),
    countLists: sql.prepare('SELECT COUNT(*) AS c FROM pages_lists WHERE user_id = ?'),
    maxListOrd: sql.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM pages_lists WHERE user_id = ?'),
    insertList: sql.prepare('INSERT INTO pages_lists (id, user_id, name, created_at, ord) VALUES (?, ?, ?, ?, ?)'),
    renameList: sql.prepare('UPDATE pages_lists SET name = ? WHERE id = ? AND user_id = ?'),
    deleteList: sql.prepare('DELETE FROM pages_lists WHERE id = ? AND user_id = ?'),
    listItemIds: sql.prepare('SELECT li.item_id, li.added_at FROM pages_list_items li JOIN pages_lists l ON l.id = li.list_id WHERE li.list_id = ? AND l.user_id = ? ORDER BY li.ord, li.item_id'),
    clearListItems: sql.prepare('DELETE FROM pages_list_items WHERE list_id = ?'),
    insertListItem: sql.prepare('INSERT INTO pages_list_items (list_id, item_id, ord, added_at) VALUES (?, ?, ?, ?)'),
    listsOfItem: sql.prepare('SELECT l.id FROM pages_list_items li JOIN pages_lists l ON l.id = li.list_id WHERE li.item_id = ? AND l.user_id = ? ORDER BY l.ord, l.id'),
    allListsRaw: sql.prepare('SELECT id, name, created_at, ord FROM pages_lists WHERE user_id = ? ORDER BY ord, created_at, id'),
  };
  adapter.__pagesStmts = s;
  return s;
}

function rowToItem(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    folder: r.folder,
    kind: r.kind,
    url: r.url || null,
    canonicalUrl: r.canonical_url || null,
    title: r.title,
    site: r.site || null,
    author: r.author || null,
    publishedAt: r.published_at || null,
    savedAt: r.saved_at,
    wordCount: r.word_count | 0,
    leadImage: r.lead_image || null,
    description: r.description || null,
    hasReader: r.has_reader === 1,
    hasOriginal: r.has_original === 1,
    assetsState: r.assets_state,
    trashedAt: r.trashed_at || null,
    readAt: r.read_at || null,
    position: typeof r.position === 'number' && Number.isFinite(r.position) ? r.position : null,
  };
}

// The FTS5 expression for what a person typed. Double-quoted runs are phrases;
// every other word is a term; all of them must match (AND). Each piece is quoted
// with internal quotes doubled, so no FTS operator, column filter or syntax error
// can come from the input; the last bare word matches as a prefix.
function ftsQuery(input) {
  if (typeof input !== 'string') return null;
  const q = input.slice(0, 500);
  const parts = [];
  const re = /"([^"]*)"|([^\s"]+)/g;
  let m;
  const tokens = (s) => (s.match(/[\p{L}\p{N}]+/gu) || []);
  while ((m = re.exec(q)) !== null) {
    if (m[1] !== undefined) {
      const words = tokens(m[1]);
      if (words.length) parts.push({ text: words.join(' '), phrase: true });
    } else {
      for (const w of tokens(m[2])) parts.push({ text: w, phrase: false });
    }
  }
  if (parts.length === 0) return null;
  const out = parts.slice(0, 32).map((p, i, arr) => {
    const quoted = '"' + p.text.replace(/"/g, '""') + '"';
    return !p.phrase && i === arr.length - 1 ? quoted + ' *' : quoted;
  });
  return out.join(' ');
}

function createPagesIndex(adapter) {
  const st = () => statementsFor(adapter);
  const tx = (fn) => {
    if (adapter.inTransaction) return fn();
    adapter.begin();
    try {
      const out = fn();
      adapter.commit();
      return out;
    } catch (err) {
      adapter.rollback();
      throw err;
    }
  };

  // One item's index rows from its record (item.json) + text. Never moves an item
  // between users (the upsert's WHERE keeps the first owner's row).
  function putRow(userId, folder, record, text) {
    assertKey(record.id, 'item id');
    st().upsertItem.run(
      record.id, userId, folder, record.kind, record.url, record.canonicalUrl, record.title, record.site, record.author,
      record.publishedAt, record.savedAt, record.wordCount, record.leadImage, record.description,
      record.hasReader ? 1 : 0, record.hasOriginal ? 1 : 0, record.assets && record.assets.state === 'pending' ? 'pending' : 'done',
      record.trashedAt || null
    );
    const row = st().rowidOf.get(record.id);
    if (!row || row.user_id !== userId) return false;
    st().ftsDelete.run(row.r);
    st().ftsInsert.run(row.r, record.title || '', record.site || '', record.author || '', record.note || '', typeof text === 'string' ? text : '');
    return true;
  }

  return {
    PAGE_LIMIT_MAX,
    LIST_NAME_MAX,
    LISTS_PER_USER_MAX,
    ITEMS_PER_LIST_MAX,
    ftsQuery,

    indexItem(userId, folder, record, text) {
      return tx(() => putRow(userId, folder, record, text));
    },

    removeItem(userId, id) {
      return st().deleteItem.run(id, userId).changes > 0;
    },

    // Replace the whole index (all users, or the listed users) with `entries`
    // [{ userId, folder, record, text }] in ONE transaction. Per-user state and
    // lists are untouched.
    replaceIndex(entries, { userIds = null } = {}) {
      return tx(() => {
        if (userIds === null) {
          st().deleteAllItems.run();
          st().ftsClear.run();
        } else {
          for (const uid of userIds) st().deleteUserItems.run(uid);
        }
        let n = 0;
        for (const e of entries) if (putRow(e.userId, e.folder, e.record, e.text)) n += 1;
        return n;
      });
    },

    countAll() { return st().countItems.get().c; },
    countForUser(userId) { return st().countUserItems.get(userId).c; },

    getItem(userId, id) {
      if (typeof id !== 'string' || id === '' || id.includes('\u0000')) return null;
      return rowToItem(st().getItem.get(id, userId));
    },

    findByUrl(userId, url) {
      if (typeof url !== 'string' || url === '') return null;
      return rowToItem(st().byCanonical.get(userId, url, url));
    },

    // The library. view: 'all' | 'unread' | 'trash'; listId narrows to a list (in
    // list order); q is a full-text search. Cursor = offset (bounded).
    listItems(userId, { view = 'all', listId = null, q = null, offset = 0, limit = 50 } = {}) {
      const lim = Math.max(1, Math.min(PAGE_LIMIT_MAX, Number.isInteger(limit) ? limit : 50));
      const off = Math.max(0, Math.min(1e6, Number.isInteger(offset) ? offset : 0));
      const where = ['i.user_id = ?'];
      const params = [userId];
      let from = 'pages_items i LEFT JOIN pages_state s ON s.user_id = i.user_id AND s.item_id = i.id';
      let order = 'i.saved_at DESC, i.id DESC';
      if (view === 'trash') where.push('i.trashed_at IS NOT NULL');
      else where.push('i.trashed_at IS NULL');
      if (view === 'unread') where.push('s.read_at IS NULL');
      if (listId !== null) {
        from += ' JOIN pages_list_items li ON li.item_id = i.id JOIN pages_lists l ON l.id = li.list_id AND l.user_id = i.user_id';
        where.push('li.list_id = ?');
        params.push(listId);
        order = 'li.ord, i.id';
      }
      const match = q !== null ? ftsQuery(q) : null;
      if (q !== null && match === null) return { items: [], total: 0, offset: off };
      if (match !== null) {
        from += ' JOIN pages_fts f ON f.rowid = i.rowid';
        where.push('pages_fts MATCH ?');
        params.push(match);
        if (listId === null) order = 'bm25(pages_fts, 8.0, 2.0, 3.0, 4.0, 1.0), i.saved_at DESC';
      }
      const base = `FROM ${from} WHERE ${where.join(' AND ')}`;
      const total = adapter.sql.prepare(`SELECT COUNT(*) AS c ${base}`).get(...params).c;
      const rows = adapter.sql.prepare(`SELECT ${ITEM_COLS}, ${STATE_COLS} ${base} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, lim, off);
      return { items: rows.map(rowToItem), total, offset: off };
    },

    trashedBefore(iso) {
      return st().trashedBefore.all(iso).map((r) => ({ id: r.id, userId: r.user_id, folder: r.folder, trashedAt: r.trashed_at }));
    },

    // ---- per-user state (read time, Reader position) ----
    getState(userId, itemId) {
      const r = st().getState.get(userId, itemId);
      return r ? { readAt: r.read_at || null, position: typeof r.position === 'number' ? r.position : null, updatedAt: r.updated_at } : null;
    },
    setState(userId, itemId, { readAt, position }, nowIso) {
      assertKey(itemId, 'item id');
      st().upsertState.run(userId, itemId, readAt || null, typeof position === 'number' && Number.isFinite(position) ? position : null, nowIso);
    },
    deleteState(userId, itemId) { st().deleteState.run(userId, itemId); },

    // ---- lists ----
    lists(userId) {
      return st().lists.all(userId).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, count: r.count | 0 }));
    },
    getList(userId, id) {
      if (typeof id !== 'string' || id === '' || id.includes('\u0000')) return null;
      const r = st().getList.get(id, userId);
      return r ? { id: r.id, name: r.name, createdAt: r.created_at } : null;
    },
    countLists(userId) { return st().countLists.get(userId).c; },
    createList(userId, id, name, nowIso) {
      assertKey(id, 'list id');
      return tx(() => {
        const ord = st().maxListOrd.get(userId).m + 1;
        st().insertList.run(id, userId, name, nowIso, ord);
        return { id, name, createdAt: nowIso, count: 0 };
      });
    },
    renameList(userId, id, name) { return st().renameList.run(name, id, userId).changes > 0; },
    deleteList(userId, id) { return st().deleteList.run(id, userId).changes > 0; },
    listItemIds(userId, listId) { return st().listItemIds.all(listId, userId).map((r) => r.item_id); },
    // Replace a list's membership + order (the caller has checked the list and
    // every item belong to the user). Keeps each kept item's added_at.
    setListItems(userId, listId, itemIds, nowIso) {
      return tx(() => {
        if (!st().getList.get(listId, userId)) return false;
        const prev = new Map(st().listItemIds.all(listId, userId).map((r) => [r.item_id, r.added_at]));
        st().clearListItems.run(listId);
        itemIds.forEach((id, k) => { assertKey(id, 'item id'); st().insertListItem.run(listId, id, k, prev.get(id) || nowIso); });
        return true;
      });
    },
    listsOfItem(userId, itemId) { return st().listsOfItem.all(itemId, userId).map((r) => r.id); },

    // ---- the backup bundle's per-user `pages` (state + lists, never the index) ----
    exportUser(userId) {
      const state = st().allState.all(userId).map((r) => ({ itemId: r.item_id, readAt: r.read_at || null, position: typeof r.position === 'number' ? r.position : null, updatedAt: r.updated_at }));
      const lists = st().allListsRaw.all(userId).map((l) => ({
        id: l.id, name: l.name, createdAt: l.created_at,
        items: st().listItemIds.all(l.id, userId).map((r) => ({ itemId: r.item_id, addedAt: r.added_at })),
      }));
      return { state, lists };
    },
    // Rows come pre-validated (validateUserBundle); inside the restore transaction.
    importUser(userId, bundle) {
      if (!bundle) return;
      for (const r of bundle.state || []) st().upsertState.run(userId, r.itemId, r.readAt || null, typeof r.position === 'number' ? r.position : null, r.updatedAt);
      let ord = 0;
      for (const l of bundle.lists || []) {
        st().insertList.run(l.id, userId, l.name, l.createdAt, ord++);
        (l.items || []).forEach((it, k) => st().insertListItem.run(l.id, it.itemId, k, it.addedAt));
      }
    },
  };
}

// The bundle's `pages` for one user, checked with the routes' bounds. Returns an
// error string or null. A bad row refuses the bundle (the lossy-import posture).
function validateUserBundle(p) {
  if (p === undefined) return null;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'pages must be an object';
  const isId = (v) => typeof v === 'string' && /^[0-9a-f]{12}$/.test(v);
  const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && v.length <= 40;
  if (p.state !== undefined) {
    if (!Array.isArray(p.state)) return 'pages.state must be an array';
    if (p.state.length > 1e6) return 'pages.state is too long';
    for (let k = 0; k < p.state.length; k += 1) {
      const r = p.state[k];
      if (!r || !isId(r.itemId)) return `pages.state[${k}] must carry a 12-hex item id`;
      if (r.readAt !== null && r.readAt !== undefined && !isIso(r.readAt)) return `pages.state[${k}].readAt must be a date or null`;
      if (r.position !== null && r.position !== undefined && !(typeof r.position === 'number' && Number.isFinite(r.position) && r.position >= 0 && r.position <= 1)) return `pages.state[${k}].position must be between 0 and 1`;
      if (!isIso(r.updatedAt)) return `pages.state[${k}].updatedAt must be a date`;
    }
  }
  if (p.lists !== undefined) {
    if (!Array.isArray(p.lists)) return 'pages.lists must be an array';
    if (p.lists.length > LISTS_PER_USER_MAX) return 'pages.lists has too many lists';
    const seen = new Set();
    for (let k = 0; k < p.lists.length; k += 1) {
      const l = p.lists[k];
      if (!l || !isId(l.id) || seen.has(l.id)) return `pages.lists[${k}] must carry a unique 12-hex id`;
      seen.add(l.id);
      if (typeof l.name !== 'string' || l.name.trim() === '' || l.name.length > LIST_NAME_MAX || /[\u0000-\u001f]/.test(l.name)) return `pages.lists[${k}].name must be 1 to ${LIST_NAME_MAX} characters`; // eslint-disable-line no-control-regex
      if (!isIso(l.createdAt)) return `pages.lists[${k}].createdAt must be a date`;
      if (!Array.isArray(l.items) || l.items.length > ITEMS_PER_LIST_MAX) return `pages.lists[${k}].items must be an array of at most ${ITEMS_PER_LIST_MAX}`;
      const ids = new Set();
      for (let j = 0; j < l.items.length; j += 1) {
        const it = l.items[j];
        if (!it || !isId(it.itemId) || ids.has(it.itemId)) return `pages.lists[${k}].items[${j}] must carry a unique 12-hex item id`;
        ids.add(it.itemId);
        if (!isIso(it.addedAt)) return `pages.lists[${k}].items[${j}].addedAt must be a date`;
      }
    }
  }
  return null;
}

module.exports = { createPagesIndex, validateUserBundle, ftsQuery, PAGE_LIMIT_MAX, LIST_NAME_MAX, LISTS_PER_USER_MAX, ITEMS_PER_LIST_MAX };
