'use strict';

// lib/pages/disk.js - the Pages files (plan D-STORE, P10). The files are the
// source of truth for content: item.json + reader.html / original.html / text.txt
// + assets/ under one folder per item. Durability rules:
//
//  - A NEW item is built as a dot-prefixed `.<folder>.part-<rand>` sibling, every
//    file fsynced, item.json written LAST, then ONE rename makes it visible. A
//    crash leaves either nothing the rebuild reads (dot names are skipped) or the
//    whole item.
//  - A CHANGE to an existing item (a note, the localized images) writes each file
//    as a temp + fsync + rename, item.json last, so every file is always either
//    the old bytes or the new.
//  - Delete is a MOVE to trash/ (item.json gains `trashedAt` first, then the
//    rename); restore is the reverse. The only unlink of user content in the
//    feature is purgeTrashed, which re-reads the trash stamp FROM THE FILE and
//    refuses anything younger than the retention or outside the user's trash/.
//
// Every path comes from paths.js (validated parts, confined to the user folder).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');
const meta = require('./meta');

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const OWNER_FILE = 'owner.json';
const ITEM_FILE = 'item.json';
const ASSETS_DIR = 'assets';

function fsyncPath(p) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    fs.fsyncSync(fd);
  } catch (err) {
    // Some filesystems refuse fsync on a directory handle (EINVAL/EISDIR/EPERM);
    // the data files themselves were fsynced, so a directory refusal is not fatal.
    if (!err || !['EINVAL', 'EISDIR', 'EPERM', 'EBADF'].includes(err.code)) throw err;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

function writeDurable(file, data) {
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

// temp + fsync + rename + fsync(dir): the file is either its old bytes or the new.
function writeFileAtomic(file, data) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, '.' + path.basename(file) + '.tmp-' + crypto.randomBytes(4).toString('hex'));
  try {
    writeDurable(tmp, data);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* never created, or already renamed */ }
    throw err;
  }
  fsyncPath(dir);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function yearDir(root, userId, year) {
  if (!paths.YEAR_RE.test(year)) throw new Error('pages: invalid year');
  return path.join(paths.userRoot(root, userId), 'items', year);
}

// files: { 'reader.html'?: string, 'original.html'?: string, 'text.txt': string }
// assets: [{ name, data: Buffer }]. Returns the final folder path.
function createItem(root, userId, folder, { record, files, assets = [] }) {
  const parsed = paths.parseFolder(folder);
  if (!parsed) throw new Error('pages: invalid item folder name');
  const finalDir = paths.itemDir(root, userId, folder, 'items');
  const parent = yearDir(root, userId, parsed.year);
  fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(finalDir)) throw new Error('pages: the item folder already exists');
  const part = path.join(parent, '.' + folder + '.part-' + crypto.randomBytes(4).toString('hex'));
  if (!paths.isConfined(part, paths.userRoot(root, userId))) throw new Error('pages: temp folder escapes the user folder');
  fs.mkdirSync(part);
  try {
    const hashes = {};
    for (const name of meta.FILES) {
      if (typeof files[name] !== 'string') continue;
      writeDurable(path.join(part, name), files[name]);
      hashes[name] = sha256(files[name]);
    }
    if (assets.length > 0) {
      const ad = path.join(part, ASSETS_DIR);
      fs.mkdirSync(ad);
      for (const a of assets) {
        if (!paths.isAssetName(a.name)) throw new Error('pages: invalid asset name');
        writeDurable(path.join(ad, a.name), a.data);
      }
      fsyncPath(ad);
    }
    const full = meta.normalizeMeta({ ...record, hashes });
    if (!full) throw new Error('pages: the item record does not validate');
    writeDurable(path.join(part, ITEM_FILE), meta.serializeMeta(full));
    fsyncPath(part);
    fs.renameSync(part, finalDir);
    fsyncPath(parent);
    return { dir: finalDir, record: full };
  } catch (err) {
    // The temp folder is ours and was never visible; it holds no user content yet.
    try { fs.rmSync(part, { recursive: true, force: true }); } catch { /* best effort */ }
    throw err;
  }
}

function readItem(dir, opts = {}) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, ITEM_FILE), 'utf8')); } catch { return null; }
  return meta.normalizeMeta(raw, opts);
}

function readItemFile(dir, name) {
  if (!meta.FILES.includes(name)) throw new Error('pages: unknown item file');
  try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function assetPath(dir, name) {
  if (!paths.isAssetName(name)) return null;
  const p = path.join(dir, ASSETS_DIR, name);
  return paths.isConfined(p, dir) ? p : null;
}

// Change an existing item in place: new assets first (exclusive names), then the
// content files, item.json LAST (with the new hashes). `files` maps a name to its
// new text, or to null to remove it (never used for user content today).
function updateItem(dir, record, { files = {}, assets = [] } = {}) {
  if (assets.length > 0) {
    const ad = path.join(dir, ASSETS_DIR);
    fs.mkdirSync(ad, { recursive: true });
    for (const a of assets) {
      if (!paths.isAssetName(a.name)) throw new Error('pages: invalid asset name');
      const p = path.join(ad, a.name);
      if (fs.existsSync(p)) continue; // content-hashed: the same name is the same bytes
      writeDurable(p, a.data);
    }
    fsyncPath(ad);
  }
  const hashes = { ...(record.hashes || {}) };
  for (const name of Object.keys(files)) {
    if (!meta.FILES.includes(name)) throw new Error('pages: unknown item file');
    if (typeof files[name] !== 'string') continue;
    writeFileAtomic(path.join(dir, name), files[name]);
    hashes[name] = sha256(files[name]);
  }
  const full = meta.normalizeMeta({ ...record, hashes });
  if (!full) throw new Error('pages: the item record does not validate');
  writeFileAtomic(path.join(dir, ITEM_FILE), meta.serializeMeta(full));
  return full;
}

// Where an item's folder is now. A crash between the trash stamp and the rename
// leaves a stamped item in items/ (or an unstamped one in trash/ on restore):
// both locations are checked, and the stamp in item.json is the truth.
function locate(root, userId, folder) {
  for (const where of ['items', 'trash']) {
    const dir = paths.itemDir(root, userId, folder, where);
    if (fs.existsSync(path.join(dir, ITEM_FILE))) return { where, dir };
  }
  return null;
}

function moveToTrash(root, userId, folder, nowIso) {
  const at = locate(root, userId, folder);
  if (!at) throw Object.assign(new Error('pages: the item folder is missing'), { code: 'ENOENT' });
  const record = readItem(at.dir);
  if (!record) throw new Error('pages: item.json does not validate');
  const stamped = updateItem(at.dir, { ...record, trashedAt: nowIso });
  if (at.where === 'trash') return stamped;
  const dest = paths.itemDir(root, userId, folder, 'trash');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) throw new Error('pages: a trashed item with this folder name already exists');
  fs.renameSync(at.dir, dest);
  fsyncPath(path.dirname(dest));
  return stamped;
}

function restoreFromTrash(root, userId, folder) {
  const at = locate(root, userId, folder);
  if (!at) throw Object.assign(new Error('pages: the item folder is missing'), { code: 'ENOENT' });
  const record = readItem(at.dir);
  if (!record) throw new Error('pages: item.json does not validate');
  const { trashedAt: _drop, ...rest } = record;
  const restored = updateItem(at.dir, rest);
  if (at.where === 'items') return restored;
  const parsed = paths.parseFolder(folder);
  const dest = paths.itemDir(root, userId, folder, 'items');
  fs.mkdirSync(yearDir(root, userId, parsed.year), { recursive: true });
  if (fs.existsSync(dest)) throw new Error('pages: an item with this folder name already exists');
  fs.renameSync(at.dir, dest);
  fsyncPath(path.dirname(dest));
  return restored;
}

// The ONE unlink of user content: a trashed item whose OWN item.json stamp is
// older than the retention. Returns true when the folder was removed.
function purgeTrashed(root, userId, folder, nowMs, retentionMs = TRASH_RETENTION_MS) {
  const dir = paths.itemDir(root, userId, folder, 'trash');
  const trashRoot = path.join(paths.userRoot(root, userId), 'trash');
  if (!paths.isConfined(dir, trashRoot)) return false;
  let st;
  try { st = fs.lstatSync(dir); } catch { return false; }
  if (!st.isDirectory() || st.isSymbolicLink()) return false;
  const record = readItem(dir, { nowMs });
  if (!record || !record.trashedAt) return false;
  const at = Date.parse(record.trashedAt);
  if (!Number.isFinite(at) || at > nowMs || nowMs - at < retentionMs) return false;
  if (paths.parseFolder(folder).id !== record.id) return false;
  fs.rmSync(dir, { recursive: true });
  return true;
}

// Every item folder a user has, sorted (LESSONS 11: iterate a sorted readdir).
// Dot names (temps, a .part) are never items.
function listUserFolders(root, userId) {
  const base = paths.userRoot(root, userId);
  const out = [];
  const dirs = (p) => {
    try {
      return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
    } catch { return []; }
  };
  for (const year of dirs(path.join(base, 'items'))) {
    if (!paths.YEAR_RE.test(year)) continue;
    for (const folder of dirs(path.join(base, 'items', year))) {
      const parsed = paths.parseFolder(folder);
      if (parsed && parsed.year === year) out.push({ where: 'items', folder, dir: path.join(base, 'items', year, folder) });
    }
  }
  for (const folder of dirs(path.join(base, 'trash'))) {
    if (paths.parseFolder(folder)) out.push({ where: 'trash', folder, dir: path.join(base, 'trash', folder) });
  }
  return out;
}

function listUserIds(root) {
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  return names.filter((n) => /^[1-9][0-9]{0,15}$/.test(n)).map(Number).filter(paths.isUserId).sort((a, b) => a - b);
}

// owner.json names the account a user folder belongs to. User ids can be reused
// (users.id is a plain INTEGER PRIMARY KEY) and a restore can bring another
// instance's accounts, so a rebuild indexes a folder only for the account whose
// name matches (case-insensitive, like login).
function readOwner(root, userId) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(paths.userRoot(root, userId), OWNER_FILE), 'utf8'));
    if (!raw || raw.userId !== userId || typeof raw.username !== 'string' || raw.username === '') return null;
    return { userId, username: raw.username };
  } catch { return null; }
}

function writeOwner(root, userId, username) {
  const base = paths.userRoot(root, userId);
  fs.mkdirSync(base, { recursive: true });
  writeFileAtomic(path.join(base, OWNER_FILE), JSON.stringify({ userId, username }, null, 2) + '\n');
}

// A deleted account's folder is set aside (renamed, never unlinked) so a later
// account that reuses the id starts empty.
function setAsideUser(root, userId, nowMs) {
  const base = paths.userRoot(root, userId);
  if (!fs.existsSync(base)) return null;
  const asideRoot = path.join(root, '.deleted-users');
  fs.mkdirSync(asideRoot, { recursive: true });
  const dest = path.join(asideRoot, `${userId}-${nowMs}-${crypto.randomBytes(3).toString('hex')}`);
  fs.renameSync(base, dest);
  return dest;
}

module.exports = {
  TRASH_RETENTION_MS,
  ITEM_FILE,
  ASSETS_DIR,
  sha256,
  writeFileAtomic,
  createItem,
  readItem,
  readItemFile,
  assetPath,
  updateItem,
  locate,
  moveToTrash,
  restoreFromTrash,
  purgeTrashed,
  listUserFolders,
  listUserIds,
  readOwner,
  writeOwner,
  setAsideUser,
};
