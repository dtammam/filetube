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
// hold values (never keys), so a value of '__proto__' is inert data. A row
// {kind:'mode', value:'allowlist'} flips the whole index to ALLOWLIST semantics
// (Dean's belt-and-suspenders for the kid account); absent/anything-else =
// BLOCKLIST (the default). The listed units mean the SAME thing in both modes
// (a "unit this user is scoped to"); only the sense of the match inverts.
function buildRestrictionIndex(rows) {
  const idx = { mode: 'blocklist', paths: [], folders: new Set(), shows: new Set(), libraries: new Set() };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.value !== 'string' || r.value === '') continue;
    switch (r.kind) {
      case 'mode': if (r.value === 'allowlist') idx.mode = 'allowlist'; break; // only valid override
      case 'path': idx.paths.push(r.value); break;
      case 'folder': idx.folders.add(r.value); break;
      case 'show': idx.shows.add(r.value); break;
      case 'library': idx.libraries.add(r.value); break;
      default: break; // unknown kind -> ignored
    }
  }
  return idx;
}

// Does this item match a LISTED unit (a path prefix / video channel / podcast
// show / whole library)? The pure positive test; `isBlocked` applies the mode.
function matchesUnit(idx, descriptor) {
  if (!idx || !descriptor || typeof descriptor !== 'object') return false;
  const d = descriptor;

  const lib = KIND_TO_LIBRARY[d.kind];
  if (lib && idx.libraries.has(lib)) return true;

  if (d.kind === 'podcast' && typeof d.subId === 'string' && idx.shows.has(d.subId)) return true;

  // 'folder' (channel) units apply to VIDEO items only - music has its own
  // folderName space; scope music by path or library.
  if (d.kind === 'media' && typeof d.folderName === 'string' && idx.folders.has(d.folderName)) return true;

  // Path-prefix units cover configured roots + everything nested. Check both
  // filePath and rootFolder so an exact-root unit still bites on odd shapes.
  for (let i = 0; i < idx.paths.length; i++) {
    if (underPath(d.filePath, idx.paths[i]) || underPath(d.rootFolder, idx.paths[i])) return true;
  }
  return false;
}

// True if this item is BLOCKED for the user whose index this is. `descriptor`:
//   { kind:'media'|'track'|'podcast'|'book', filePath, folderName, rootFolder, subId }
//   BLOCKLIST (default): blocked if it matches a listed (restricted) unit.
//   ALLOWLIST: blocked UNLESS it matches a listed (granted) unit - so a garbage
//     or unresolvable descriptor is blocked, which is the safe default-deny the
//     allowlist mode exists to provide. Serve routes still 404 on an unknown id
//     before reaching here, so this only decides KNOWN items.
function isBlocked(idx, descriptor) {
  if (!idx) return false; // no index (no user) -> deny nothing; the auth gate already ran
  const matches = matchesUnit(idx, descriptor);
  return idx.mode === 'allowlist' ? !matches : matches;
}

// Convenience for callers filtering a list: keep only items the user may see.
// `toDescriptor(item)` maps each item to its descriptor.
function filterVisible(idx, items, toDescriptor) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => !isBlocked(idx, toDescriptor(item)));
}

module.exports = {
  buildRestrictionIndex,
  matchesUnit,
  isBlocked,
  filterVisible,
  underPath,
  KIND_TO_LIBRARY,
};
