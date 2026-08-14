# Exec plan: channel-name consistency on the remaining folder-named surfaces (v1.122)

- Owner: main session (lean mode)
- Opened: 2026-08-14
- Target: v1.122.0
- Device pass: PENDING (Dean). Display-only -> slim gate (adversarial).
- FIRST WAVE under the new branch-hygiene ceremony (branch deleted remote+local
  post-tag; CLAUDE.md ceremony line updated as this wave's docs rider).

## The bug (Dean, on-device, v1.121)
The healed channel names (v1.115/116) show on all CARDS, but THREE surfaces
still rendered the raw FOLDER name ("nestalgiamusic" instead of "NESTALGIA") -
the recurring enumerate-every-surface class (v1.41.4, v1.113, v1.114, v1.117).
Dean reported two; the gate found the third (its whole job):
1. **watch.js related rail** - the uploader line rendered `item.folderName` raw;
   it predates resolveChannelName and was never swept.
2. **main.js `?root=` header** (the channel-name tap target) - titled itself
   with the folder BASENAME; no channel resolution.
3. **main.js buildVideoRowCardHtml** (gate W2) - the classic bare-home
   "Continue watching" row's artist line rendered raw folderName (invisible in
   Dean's modern mode, real in classic).

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
  resolveRootHeaderLabel(currentItems, folderSettings, derived rootLabel). The
  honest contract (gate W3): the header never DISAGREES with the page-0 cards -
  a PARTIALLY-healed folder (some items still nameless) falls back to the folder
  label, exactly matching the fallback-named cards on that page; it is page-0-
  sample-strong, not omniscient.
- **T3b (gate W2):** buildVideoRowCardHtml's artist line -> resolveChannelName.
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
NESTALGIA; a mixed folder keeps its folder title). DIAGNOSIS-DISCIPLINE probe
note (gate W3): if the NESTALGIA header still shows the folder name after this
release, page 0 contains NAMELESS items - run "Refresh channel names" first
rather than filing the fix as failed. Move to completed/ at release.
