# Software Developer inbox — T9 (v1.21 FR-10: README refresh)

Feature: **v1.21.0 "The Polish Release"** (feature_id `v1.21-polish-release`),
branch `feature/v1.21-polish-release` (off `main` at v1.20.0). This file
**supersedes any prior-feature content.** This is **Task T9**, **Wave 1** — runs
in PARALLEL with T2 (fully disjoint: you touch ONLY `README.md`). No dependencies;
blocks nothing. Fully independent of every code task.

**Review tier: PROCESS** — docs-only, no functional/code risk; a read-through for
accuracy against the actual shipped feature set is sufficient.

## Environment

- **Node 22 toolchain bin** (only needed if you run lint/tests; prepend to PATH):
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- Use absolute paths (cwd resets between bash calls).

## Git — DO NOT commit

The **coordinator (EM) owns ALL git.** Do NOT `git add`/`commit`/`branch`/
`stash`/`push`. Report exact files changed. (Docs-only; no lint/test gate, but do
not break any markdown build.)

## Read first (you share NO memory with the EM)

- `docs/exec-plans/active/2026-07-08-v1.21-polish-release.md` — the **## Design**
  section **"FR-10 — README refresh (PROCESS)"** plus **AC66–AC68**.
- `README.md` — the current stale (v1.10-era) Features list and any other stale
  copy (it still says "native controls" and omits the yt-dlp subscription module).
- For an accurate feature inventory, skim `ROADMAP.md` and the completed exec
  plans under `docs/exec-plans/completed/` (v1.16 watch experience, v1.20
  subscribe) to confirm what actually shipped.

## Task — implement THIS ONE task only (FR-10)

Rewrite `README.md`'s Features list (and any other stale copy) to reflect
everything shipped since v1.10 (AC66):

- yt-dlp subscription module + subscribe-from-downloads + per-channel playlists
- docked mini-player / SPA-lite navigation
- prev/next + autoplay-next
- download-to-device
- iOS codec transcoding
- PWA icons
- quicker (two-tap) delete

Plus this release's own headline items once landed (custom blocky theme-aware
audio/video controls, subscriptions-first page, pinned channels, theatre mode,
download retry + status chip). Note where "native controls" copy must be removed
(FR-2 replaces them). **Screenshots are explicitly Dean's to provide** — flag any
screenshot placeholders, do NOT block on them (AC67). No functional/code change
(AC68).

## File-ownership / serialization contract (STRICT — shared tree)

You edit ONLY `README.md`. Touch no other file. (You run alongside T2, which owns
the player/CSS files — zero overlap.)

## Report back

Files changed (just `README.md`); a short summary of what was updated in the
Features list; confirmation screenshots are flagged as Dean's to provide and that
no code/functional copy was changed. Signal when T9 is done.
