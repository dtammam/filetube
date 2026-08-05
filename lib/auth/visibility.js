'use strict';

// v1.80 RBAC - the SINGLE per-user visibility decision point.
//
// Every list filter and every byte-serving route routes an item's descriptor
// through isBlocked() - NO route re-implements the check (the v1.41.4
// every-writer scar; and for a security gate a second implementation is a
// second place to get it wrong). PURE: no DB, no request, no I/O. The gate
// loads the user's restriction rows once per request and builds an index; admin
// is expressed as an EMPTY index (isBlocked then always false), so there is no
// role branch to forget here.
//
// Model (Dean's blocklist choice): a member sees everything EXCEPT units the
// admin restricted. Restriction rows are {kind, value}:
//   path    - value is a filePath PREFIX; blocks any item whose filePath (or
//             rootFolder) is that path or nested under it. Covers a configured
//             root AND every future download under it (the blocklist fail-safe
//             for new content).
//   folder  - value is a video folderName (a channel); blocks those video items.
//   show    - value is a podcast subId; blocks that show's episodes.
//   library - value in {video,music,podcasts,books}; blocks the whole library.

const KIND_TO_LIBRARY = { media: 'video', track: 'music', podcast: 'podcasts', book: 'books' };

// Is `filePath` the prefix path itself or nested under it? Boundary-correct:
// '/a/b' must NOT match '/a/bc' (the classic prefix-bypass), so a separator is
// required after the prefix. Handles both POSIX and Windows separators.
function underPath(filePath, prefix) {
  if (typeof filePath !== 'string' || typeof prefix !== 'string' || prefix === '') return false;
  return filePath === prefix || filePath.startsWith(prefix + '/') || filePath.startsWith(prefix + '\\');
}

// Build the per-user restriction index from raw {kind, value} rows. Sets/arrays
// hold values (never keys), so a value of '__proto__' is inert data.
function buildRestrictionIndex(rows) {
  const idx = { paths: [], folders: new Set(), shows: new Set(), libraries: new Set() };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.value !== 'string' || r.value === '') continue;
    switch (r.kind) {
      case 'path': idx.paths.push(r.value); break;
      case 'folder': idx.folders.add(r.value); break;
      case 'show': idx.shows.add(r.value); break;
      case 'library': idx.libraries.add(r.value); break;
      default: break; // unknown kind -> ignored (fails toward the caller's own default)
    }
  }
  return idx;
}

// True if this item is blocked for the user whose index this is. `descriptor`:
//   { kind:'media'|'track'|'podcast'|'book', filePath, folderName, rootFolder, subId }
// A missing/garbage descriptor is treated as NOT blocked here - callers must
// pass a real descriptor; a serve route that cannot resolve an item to a
// descriptor should 404 on its own (unknown id), not lean on this.
function isBlocked(idx, descriptor) {
  if (!idx || !descriptor || typeof descriptor !== 'object') return false;
  const d = descriptor;

  const lib = KIND_TO_LIBRARY[d.kind];
  if (lib && idx.libraries.has(lib)) return true;

  if (d.kind === 'podcast' && typeof d.subId === 'string' && idx.shows.has(d.subId)) return true;

  // 'folder' (channel) restrictions apply to VIDEO items only - music has its
  // own folderName space; restrict music by path or library.
  if (d.kind === 'media' && typeof d.folderName === 'string' && idx.folders.has(d.folderName)) return true;

  // Path-prefix restrictions cover configured roots + everything nested. Check
  // both filePath and rootFolder so an exact-root restriction still bites even
  // if a filePath is stored in an unexpected shape.
  for (let i = 0; i < idx.paths.length; i++) {
    if (underPath(d.filePath, idx.paths[i]) || underPath(d.rootFolder, idx.paths[i])) return true;
  }
  return false;
}

// Convenience for callers filtering a list: keep only items the user may see.
// `toDescriptor(item)` maps each item to its descriptor.
function filterVisible(idx, items, toDescriptor) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => !isBlocked(idx, toDescriptor(item)));
}

module.exports = {
  buildRestrictionIndex,
  isBlocked,
  filterVisible,
  underPath,
  KIND_TO_LIBRARY,
};
