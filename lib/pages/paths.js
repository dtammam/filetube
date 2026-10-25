'use strict';

// lib/pages/paths.js - the Pages on-disk naming rules (plan D-STORE). Every path
// the feature touches is built HERE from validated parts and re-checked to sit
// under the user's own folder; nothing else in lib/pages joins a path from a
// request or a file's contents.
//
//   <PAGES_ROOT>/<userId>/owner.json                     who the folder belongs to
//   <PAGES_ROOT>/<userId>/items/<yyyy>/<folder>/         a saved item
//   <PAGES_ROOT>/<userId>/trash/<folder>/                a trashed item
//   <folder> = <yyyy-mm-dd>-<slug>-<id>
//
// The root is OPERATOR-CONTROLLED ONLY (env > <DATA_DIR>/pages), never read from
// the database or a backup bundle: the podcasts lesson (lib/podcasts/index.js
// resolvePodcastsRoot) - a db that can move a filesystem boundary defeats every
// check made against it.

const path = require('path');
const crypto = require('crypto');

const ID_RE = /^[0-9a-f]{12}$/;
const SLUG_MAX = 60;
const FOLDER_RE = /^(\d{4})-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*-([0-9a-f]{12})$/;
const YEAR_RE = /^\d{4}$/;
const ASSET_NAME_RE = /^[0-9a-f]{24}\.[a-z0-9]{1,5}$/;

function resolvePagesRoot(dataDir, env = process.env) {
  const fromEnv = typeof env.FILETUBE_PAGES_DIR === 'string' && env.FILETUBE_PAGES_DIR !== '' ? env.FILETUBE_PAGES_DIR : null;
  return path.resolve(fromEnv || path.join(dataDir, 'pages'));
}

function newItemId() {
  return crypto.randomBytes(6).toString('hex');
}

function isItemId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function isUserId(userId) {
  return Number.isSafeInteger(userId) && userId > 0;
}

// ASCII, lowercase, words joined by single hyphens, at most SLUG_MAX characters
// (cut at a word boundary when one is near), never empty.
function slugify(title) {
  const ascii = String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let s = ascii;
  if (s.length > SLUG_MAX) {
    s = s.slice(0, SLUG_MAX);
    const cut = s.lastIndexOf('-');
    if (cut >= 20) s = s.slice(0, cut);
    s = s.replace(/-+$/g, '');
  }
  return s || 'page';
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

// The folder date is the server's LOCAL calendar date of the save (LESSONS 11:
// as-of dates are local, never toISOString).
function folderName(savedAtMs, title, id) {
  if (!isItemId(id)) throw new Error('pages: folderName needs a valid item id');
  const d = new Date(savedAtMs);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `${date}-${slugify(title)}-${id}`;
}

// { year, id } for a valid folder name, else null.
function parseFolder(folder) {
  if (typeof folder !== 'string') return null;
  const m = FOLDER_RE.exec(folder);
  if (!m) return null;
  return { year: m[1], id: m[2] };
}

function isConfined(candidate, root) {
  if (typeof candidate !== 'string' || candidate === '') return false;
  const resolved = path.resolve(candidate);
  const base = path.resolve(root);
  return resolved.startsWith(base + path.sep);
}

function userRoot(root, userId) {
  if (!isUserId(userId)) throw new Error('pages: invalid user id');
  const p = path.join(root, String(userId));
  if (!isConfined(p, root)) throw new Error('pages: user folder escapes the root');
  return p;
}

// where: 'items' | 'trash'
function itemDir(root, userId, folder, where) {
  const parsed = parseFolder(folder);
  if (!parsed) throw new Error('pages: invalid item folder name');
  const base = userRoot(root, userId);
  let p;
  if (where === 'items') p = path.join(base, 'items', parsed.year, folder);
  else if (where === 'trash') p = path.join(base, 'trash', folder);
  else throw new Error('pages: unknown item location');
  if (!isConfined(p, base)) throw new Error('pages: item folder escapes the user folder');
  return p;
}

function isAssetName(name) {
  return typeof name === 'string' && ASSET_NAME_RE.test(name);
}

module.exports = {
  ID_RE,
  FOLDER_RE,
  YEAR_RE,
  ASSET_NAME_RE,
  SLUG_MAX,
  resolvePagesRoot,
  newItemId,
  isItemId,
  isUserId,
  slugify,
  folderName,
  parseFolder,
  isConfined,
  userRoot,
  itemDir,
  isAssetName,
};
