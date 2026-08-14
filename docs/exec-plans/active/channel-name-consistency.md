# Exec plan: channel-name consistency on the last two folder-named surfaces (v1.122)

- Owner: main session (lean mode)
- Opened: 2026-08-14
- Target: v1.122.0
- Device pass: PENDING (Dean). Display-only -> slim gate (adversarial).
- FIRST WAVE under the new branch-hygiene ceremony (branch deleted remote+local
  post-tag; CLAUDE.md ceremony line updated as this wave's docs rider).

## The bug (Dean, on-device, v1.121)
The healed channel names (v1.115/116) show on all CARDS, but two surfaces still
render the raw FOLDER name ("nestalgiamusic" instead of "NESTALGIA") - the
recurring enumerate-every-surface class (v1.41.4, v1.113, v1.114, v1.117):
1. **watch.js:1530** - the related rail's uploader line renders `item.folderName`
   raw; it predates resolveChannelName and was never swept.
2. **main.js:1326** - the `?root=` folder view (the channel-name tap target)
   titles itself with the folder BASENAME; no channel resolution.

## Design
- **T1 (common.js):** pure `resolveRootHeaderLabel(items, folderSettings,
  fallbackLabel)` - if EVERY item resolves (via the existing resolveChannelName)
  to ONE distinct non-empty name, return it; else (mixed folder like
  "Miscellaneous from SLS", or no items) return the fallback (today's folder
  label). Exported + unit-tested; eslint globals roster entry (the v1.110 lesson).
- **T2 (watch.js):** related rail renders `resolveChannelName(item,
  folderSettings)` instead of raw folderName. Strictly better: the resolver's
  fallback chain ENDS in folderName, so nameless items render exactly as today.
- **T3 (main.js):** in fetchLibraryPage0 (the one seam every folder-view page-0
  passes through), when rootFilter is set, retitle videosHeader via
  resolveRootHeaderLabel(currentItems, folderSettings, currentLabel).
- **T4 (docs rider):** CLAUDE.md ceremony line "push all refs" -> push main +
  tag; delete the wave's branches remote+local after the tag verifies (the
  branch-hygiene norm, Dean 2026-08-14).

## Attack surfaces (slim gate)
- Mixed-channel folder must KEEP the folder label (never guess); empty page-0
  must keep the fallback; a search/liked/subs view (no rootFilter) untouched.
- The related-rail swap must not change nameless items (fallback parity).
- The header must not flash/regress on pagination (only page-0 retitles) or on
  the modern-grid path (rootFilter gating).
- eslint roster + source-locks bind the two call sites (redden on revert).

## Stop condition
Adversarial APPROVE; dual-Node green; released with device pass PENDING (Dean:
related rail shows NESTALGIA; tapping the channel name lands on a view titled
NESTALGIA; a mixed folder keeps its folder title). Move to completed/ at release.
