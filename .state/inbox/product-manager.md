# Discovery inbox -- Product Manager

**Feature:** v1.13.0 "v1.12.0 polish + mobile fixes"
**Feature id:** `v1.13-polish`
**Branch (coordinator-owned):** `feature/v1.13-polish` off `main`
**Stage:** Discovery (LIGHT -- these 5 items are well-specified; do NOT re-open the v1.12.0 architecture)

## Your job

Turn the 5 scope items below into a crisp exec plan with **concrete, numbered,
tagged acceptance criteria**. Write it to:

`docs/exec-plans/active/2026-07-06-v1.13-polish.md`

Then update `.state/feature-state.json`: set `artifacts.requirements` and
`artifacts.exec_plan` to that path.

Structure the plan with: **Goal, Scope, Out-of-scope, Constraints (lead with the
NO-REGRESSION / disabled-no-op constraint), Functional Requirements (FR-1..FR-5),
NFRs (security for item 4, reliability for item 5), Acceptance Criteria** (numbered
`AC1..`, each tagged `[UNIT]` / `[INTEGRATION]` / `[MANUAL]` -- items 1 and 2 are
`[MANUAL]` Dean-on-device visual passes plus any feasible DOM/CSS-presence checks),
and an **Open Questions / Product Decisions** section resolving the two forks below.

Read first: `.state/feature-state.json` (full scope + confirmed root causes),
`docs/CONTRIBUTING.md` (vanilla DOM, textContent not innerHTML, node:test, lint 0,
no new deps), `docs/RELIABILITY.md` (graceful FS-failure handling), and the prior
feature record `docs/exec-plans/completed/2026-07-06-ytdlp-metube-parity.md` for the
locked v1.12.0 decisions this builds on (D1-D5, the T3/T4 security core, FR-G
synthetic-folder / E1 mount-loss protection).

## Context -- this is polish on top of shipped v1.12.0

v1.12.0 (yt-dlp MeTube parity) shipped. This round polishes that surface + fixes
two mobile/UX regressions + one always-on server DELETE gap. The EM has ALREADY
verified every diagnosed root cause against current code (file:line evidence in
`.state/feature-state.json` under `scope_items`). Write the bug items as concrete
pass/fail ACs against that evidence -- do NOT re-investigate the mechanics.

## The 5 items (concise -- full detail + confirmed file:line in feature-state.json)

**Item 1 -- Fix janky /subscriptions list (BUG, shipped v1.12.0).** The "Your
subscriptions" list renders each name/URL vertically (one char per line).
Confirmed cause: rows use `className='folder-item-row'` (a Setup class) + an info
column with inline `flex:1; min-width:0;` that collapses to ~1ch, so the name +
`word-break:break-all` URL wrap per character. FIX: give the /subscriptions list
its OWN row layout so the info column takes full width with normal wrapping (long
URLs break-word, not per-char); tidy the cramped add/edit/one-shot controls. KEEP
the XSS-safe `textContent` rendering + the disabled-absence. Files:
`lib/ytdlp/views/subscriptions.html`, `lib/ytdlp/client/subscriptions.js` (served
inside the isEnabled gate, NOT public/). Arbiter: Dean on-device.

**Item 2 -- Mobile player oversized (regression).** `.player-container` is
`width:100%; aspect-ratio:16/9` (style.css:614/616) with a `max-height:70vh` cap
(:1681) that's too tall for a phone. FIX: cap the mobile PORTRAIT player to a
sensible height (target ~40-50vh portrait -- make a reasonable change, Dean tunes
on-device). Must NOT break desktop, landscape, or the audio-mode / audio-bg-art
layout. Require the SDE to record exact before/after values. Arbiter: Dean
on-device. Write ACs as `[MANUAL]` device passes + any feasible CSS-rule-presence
assertion.

**Item 3 -- Synthetic "Downloads" folder: renamable + reorderable in Setup.**
NEEDS a small PE design (flag it as such -- your job is the ACs + the constraint,
PE designs the mechanism). Confirmed current behavior: the synthetic download
folder is derived display-only in GET /api/config (NOT in `db.folders`), already
renders in Setup and already renames via a `folderSettings` entry -- but REORDER
does NOT stick because the server strips synthetic roots from `db.folders` and
re-appends the synthetic entry last on the next GET. So the real gap is **order
persistence for a non-db.folders entry.** CRITICAL CONSTRAINT (bake into an AC):
the synthetic folder MUST STAY OUT of `db.folders` (that's the C3/C7 disable-reap
+ E1 mount-loss protection); its order must be stored SEPARATELY (a
`folderSettings.order` field or a dedicated pref) and merged into the sidebar +
Setup display order WITHOUT persisting a `db.folders` row. Write ACs that assert
BOTH: (a) rename + reorder persist across reload for the synthetic folder, AND (b)
the synthetic folder is still absent from `db.folders` and no scan/prune path
depends on it (disable-no-op + mount-loss unregressed). Flagged for extra review.

**Item 4 -- Filetype/container dropdown for one-off + subscription.** NEEDS a small
PE design (merge vs recode; default; allowlist). Add a THIRD dropdown (alongside
format + quality): VIDEO -> mp4 / mkv / webm / "default"; AUDIO -> mp3 / m4a / opus
/ "default". Wire to `lib/ytdlp/args.js`: video -> `--merge-output-format <ext>`
(PE decides merge vs `--recode-video`; recommend merge for mp4); audio ->
`-x --audio-format <fmt>`. Add a `filetype`/`container` field to the subscription
record + the one-shot body; validate against an allowlist (reject hostile ->
default); backfill existing subs (undefined -> default) via `updateDatabase`. Add
the dropdown to the add + one-shot forms AND the edit (PATCH) path. SECURITY (bake
into an NFR + AC): the filetype value flows into yt-dlp spawn args -- same bar as
v1.12.0 T3/T4 (arg-array via execFile, `--` separator, no shell, no injection via
the filetype value; keep `--restrict-filenames`). Flagged for extra review. See
the default fork below.

**Item 5 -- Graceful delete on read-only mounts (server, always-on).** DELETE
/api/videos/:id currently 500s with a generic "Could not delete file" on an unlink
failure (e.g. EROFS) and leaves the db untouched (catch at server.js:1831-1836).
FIX: catch the unlink failure and return a clear, SPECIFIC message (distinguish
EROFS/EACCES "read-only or permission" from other errors). See the "remove-anyway"
fork below. KEEP the existing success path + the thumbnail/transcode/db.progress
cleanup + the updateDatabase-error handling intact. Write ACs for the branch logic
as `[INTEGRATION]`/`[UNIT]` (a simulated unlink failure -> specific message; happy
path unchanged).

## Product decisions to resolve (surface these explicitly in Open Questions)

These are GENUINE forks -- state the recommendation, note the tradeoff, and record
the chosen default so PE/SDE can proceed. (Dean has pre-endorsed both recommended
defaults in the bootstrap; confirm and document, don't re-litigate.)

1. **Item 4 default filetype.** RECOMMENDED: default VIDEO -> **mp4** (best iOS
   compatibility; webm-on-iOS is the pain we're solving) via
   `--merge-output-format mp4`; default AUDIO -> **mp3**. Offer "default" (yt-dlp's
   own choice) as an explicit option but NOT the default. Confirm and document.

2. **Item 5 "remove from library anyway".** RECOMMENDED: **YES** -- a clearly
   labeled option to delete the db entry even when the file could not be unlinked
   (e.g. read-only mount), WITH an honest user-facing caveat that a still-scanned
   read-only mount re-adds it on the next rescan (UX-clarity fix, not a true
   removal). Decide the shape (a request param on DELETE vs a follow-up choice in
   the same flow) and the exact copy. Confirm and document.

## Constraints (lead the plan with these)

- **ADDITIVE / NO REGRESSIONS.** The yt-dlp module disabled-no-op guarantee is
  UNCHANGED: when `FILETUBE_YTDLP_ENABLED` is off, the /subscriptions page + new
  dropdowns + one-shot form + status polling stay absent and FileTube is
  byte-identical. Items 1/3/4 touch module-gated code; item 2 (CSS) + item 5
  (DELETE) are always-on core -- scope tightly, prove non-regression.
- **E1 mount-loss + C3/C7 disable-reap intact** (item 3): `extraScanRoots` stays
  the authoritative scan/mount-loss root; the synthetic folder stays out of
  `db.folders`; no scan/prune path depends on synthetic presence.
- **Security core reuse** (item 4): arg-array via execFile, `--` separator, no
  shell, `--restrict-filenames` kept, allowlist-validate the filetype value, no
  injection via it.
- **CONTRIBUTING.md**: vanilla DOM, `textContent` not `innerHTML` (KEEP the
  XSS-safe rendering in subscriptions.js), `node:test`, lint 0, **no new deps**.

## When done

Return a summary of the ACs (grouped by item, with counts and the two resolved
product decisions). The coordinator will commit your plan and route to the
principal-engineer via `/prep-pe-design` (PE has real-but-small design work on
items 3 and 4 only; items 1/2/5 are direct-to-implementation fixes).
