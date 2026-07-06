# Product Manager -- Discovery brief

## Feature
**yt-dlp module MeTube parity** for FileTube. Target release **v1.12.0**.
Feature id: `ytdlp-metube-parity`. Branch: `feature/ytdlp-metube-parity` (off `main`, which Dean states is v1.11.1).

This is ONE cohesive feature spanning 9 workstreams (A-I). It EXTENDS the already-shipped
optional yt-dlp module (v1.11.0/v1.11.1: `lib/ytdlp/*` + the dedicated `/subscriptions` page).
It does NOT re-litigate that module's architecture or its locked decisions D1-D5.

Your Discovery job: produce crisp **requirements + acceptance criteria** grouped by workstream,
seed a new active exec plan, and confirm scope. **Do NOT design the implementation. Do NOT write code.**

**Dean's north-star framing:** keep it to MeTube's SIMPLE shape -- a form + a list with
per-item status. This is NOT a job-queue cathedral. Do not gold-plate. Prefer reusing existing
`lib/ytdlp` primitives over new machinery. Hold the UX simple.

## Read first (in this order)
1. `.state/feature-state.json` -- the full captured scope: the 9 workstreams (A-I), the confirmed
   bug mechanics (`confirmed_mechanics_do_not_reinvestigate`), the carried constraints
   (`confirmed_carryover_constraints`), and the `hard_constraint` (disabled = byte-identical no-op).
2. `docs/exec-plans/completed/2026-07-05-yt-dlp-integration-module.md` -- the shipped v1.11.0 feature:
   its 34 ACs, locked decisions D1-D5, and the security core (validateChannelUrl, arg-array spawn,
   path confinement, cookies redaction) you will REUSE, not rebuild.
3. `docs/CONTRIBUTING.md` -- standards (Node 22, `node:test`, `npm test`, `npm run lint` 0 errors,
   additive/zero-regression, every feature ships with tests, keep FFmpeg/binaries out of the core suite).
4. `docs/RELIABILITY.md` -- spawn try/catch + graceful degrade, explicit HTTP status codes, per-item
   scan resilience, no external monitoring (health via status endpoints -- relevant to workstream E).

## The hard constraint (acceptance north star -- carry through EVERY AC group)
OPTIONAL / ADDITIVE / MUST-NOT-DEGRADE. When the module is DISABLED (default,
`FILETUBE_YTDLP_ENABLED` off) FileTube stays BYTE-IDENTICAL: no new routes (including the NEW
one-shot download, status, and edit endpoints), no background poll, no subscriptions/one-shot UI.
There MUST be an explicit AC that the disabled path is a no-op.

**EXCEPTION-BY-DESIGN (call this out explicitly in the plan):** bug fix **F** (clean display titles)
and the **G-hardening** (realpath/resolve scan-root normalization) touch CORE scan/title code that
runs for ALL users, including non-yt-dlp libraries. Those must be scoped so:
- non-yt-dlp library files are NOT rewritten (F's regex is tightly scoped to the yt-dlp filename shape), and
- behavior for existing non-yt-dlp trees is unchanged (G's realpath/resolve collapses only divergent
  spellings of the SAME tree; it must not merge or drop distinct trees).
Write ACs that PROVE both (a regression AC that a plain non-yt-dlp title/tree is untouched).

## Nothing here is an open investigation -- write CONCRETE ACs
Dean has LOCKED the product decisions. **You are not expected to surface new forks.** The bug fixes
F/G/I have confirmed mechanics with file:line evidence (EM re-verified :511, :955, :998 against the
current code) -- write them as **concrete pass/fail ACs**, not "investigate whether...". If you find a
GENUINE new product decision not covered below, flag it to the EM to relay to Dean before Design;
otherwise proceed on these locks.

## Workstreams -> group into AC sets

**A. One-shot URL download** (`POST /api/ytdlp/download`, inside the isEnabled gate). Absorbs the
parked `feature/ytdlp-oneshot-download` discovery. LOCKED: paste a single-video URL -> downloads once
into a folder, no persistent subscription; serialize with the poll loop (no parallel spawns);
single-video only (reject channel/playlist with **400**); default subfolder **"One-Off"**; **202 +
background**, fire-and-forget. REUSE all T3/T4 security (validateChannelUrl, arg-array + `--`, path
confinement on the folder param, cookies redaction, timeout+SIGKILL, --restrict-filenames). Small UI:
paste URL + the B dropdowns. ACs: 202 on valid single-video; 400 on channel/playlist/invalid URL;
download lands under the confined folder and is indexed; disabled => route 404; never a parallel spawn
(serialized with poll).

**B. Format + quality DROPDOWNS** on BOTH the subscription form AND the one-shot form. Media type =
audio/video; quality = the existing `normalizeQuality` allowlist values (default **best**). Replace any
free-text with dropdowns. ACs: both forms present the dropdowns; only allowlist values accepted; default
best; server re-validates (a hostile value never becomes a stray yt-dlp option -- reuses the existing
sanitization).

**C. Per-channel "download last N"** -- per-subscription override of the global
`FILETUBE_YTDLP_MAX_VIDEOS` (default 25), settable in the add/edit form, applied as `--playlist-end N`
for that sub's list pass; the global default applies when unset. ACs: per-sub N persists and is honored;
unset falls back to the global; bounds validation (positive integer, sane cap).

**D. Pause/resume + EDIT a subscription** -- an edit endpoint (e.g. `PATCH /api/subscriptions/:id`) to
change format/quality/N without delete-readd, plus a `paused` flag (paused subs SKIPPED by the poll loop;
UI toggle). Add/edit via the same form. ACs: edit changes fields without losing lastStatus/archive;
paused sub is skipped by poll and by re-pull; unpause resumes; 404 on unknown id; disabled => route 404.

**E. Live status via POLLING** (Dean-confirmed: polling, NO WebSocket). Replace the static "Pending..."
with real progress parsed from yt-dlp's stdout/stderr (% / eta during download) into a
per-subscription/per-download status: **state** (queued/listing/downloading/done/error), current video
title, **N of M**, **percent**. Expose via a status field on `GET /api/subscriptions` (or a dedicated
`GET /api/subscriptions/status`) that the `/subscriptions` UI polls every **~2-3s**. Keep it simple:
in-memory current-activity + the persisted `lastStatus`. MeTube UX shape (pending -> downloading % ->
finished/error per item). ACs: an in-flight download surfaces state+percent+N-of-M via the status
endpoint; the UI reflects it on a ~2-3s poll; terminal states (done/error) render; error status carries
NO cookies path (reuse SF1 redaction); disabled => status route 404.

**F. Clean display titles (BUG) -- DISPLAY-ONLY.** Confirmed: the title is
`path.basename(info.name, info.ext)` at **server.js:998**, which for downloads is the
`--restrict-filenames` name `Title_With_Underscores [<id>].ext`. FIX: a tightly-scoped helper that strips
a trailing ` [<11-char youtube id>]` and converts `_`->space (regex ~ `/^(.*?)[ _]\[[A-Za-z0-9_-]{11}\]$/`)
at title derivation. **DO NOT remove `--restrict-filenames`** (SF4 security). The `[id]` is CONFIRMED
non-load-bearing (`getMediaId` hashes the PATH at server.js:511; dedup uses the separate
`.ytdlp-archive.txt`) -> display-only cleanup is safe: no id churn, no db migration, works for existing
files. ACs: a yt-dlp filename renders a clean human title; a plain non-yt-dlp library title
(e.g. `My_Home_Movie` or a legit `Something [notanid]`) is UNCHANGED (regression AC); no media id changes;
no db migration required.

**G. Fix duplicate entries + auto-register the download folder (BUG #6 + FEATURE #7, unified).**
Confirmed root cause of duplicates: media id = md5(absolute path) (server.js:511) + `currentFolders =
Set([...db.folders, ...extraScanRoots])` (server.js:955) dedups only BYTE-IDENTICAL root strings, while
db.folders is stored as-typed/unresolved (~server.js:1258-1264) and extraScanRoots returns
`path.resolve(downloadDir)` -> a bind-mount/symlink/relative spelling of the same tree is walked twice ->
two path-ids -> two rows. FIX has two parts (write ACs for both):
  1. **Hardening:** realpath/normalize the merged scan roots before the Set dedup, and `path.resolve`
     db.folders entries on write, so divergent spellings collapse. (Realpath-per-ROOT, not per-file.)
  2. **Display-only folder merge (Dean-approved):** `GET /api/config` + the sidebar/playlists UI include
     the module's extraScanRoots as a SYNTHETIC folder WITHOUT writing db.folders. extraScanRoots stays
     the AUTHORITATIVE scan root + mount-loss protection (E1 intact); the db presence is a pure UI
     affordance. Renamable via a persisted `folderSettings[downloadDir].name` (persist ONLY the
     folderSettings, not the folder). Self-heals on launch (derived from extraScanRoots each time).
This delivers "folder shows in playlists, renamable, regenerated if deleted" AND removes the need for a
manual add (which is what causes the duplicates). **NOTE (state it in the plan):** this SOFTENS the prior
locked decision C7(ii) ("config never lists a folder the operator didn't add") -- this softening is
INTENDED and Dean-approved. ACs: two divergent spellings of the same download tree produce ONE row
(no duplicate); the download folder appears in playlists WITHOUT a db.folders entry; it is renamable and
the name persists; deleting it from the UI regenerates it on next launch; disabled => the synthetic folder
is absent; no scan/prune path depends on the synthetic db.folders presence (E1 mount-loss protection stays
intact). Design of the merge is PE's job -- you specify the observable behavior.

**H. Embed metadata + thumbnails** -- add `--embed-metadata` (and `--embed-thumbnail` where supported) to
the download args for audio AND video (MeTube embeds metadata for audio only; Dean wants it explicit for
both). ACs: audio downloads carry embedded metadata + thumbnail; video downloads carry embedded metadata
(+ thumbnail where the container supports it); confirm the flags + postprocessor deps are available in the
pinned image (ffmpeg is present) -- note as a build/verification AC.

**I. Deleted-stays-gone -- CONFIRMED already working, NO code change.** `.ytdlp-archive.txt` persists
through UI delete + prune-missing; the next poll skips archived ids; subscription-delete deliberately does
not touch the archive (D3). Write an AC that ASSERTS the guarantee (delete a downloaded video -> next poll
does NOT re-download it) plus a **docs note** on the archive-persistence dependency: for network-share
download dirs, if the share/archive is unavailable at poll time, dedup is lost and the channel
re-downloads. This is an assertion + docs AC only.

## Cross-cutting ACs to include
- **Disabled = no-op:** every NEW route (one-shot download, status, edit/pause) 404s when disabled; no
  poll armed; no new UI; the full existing suite stays green with the module present-but-disabled.
- **Security reuse:** the one-shot endpoint reuses the T3/T4 core verbatim (arg-array, `--`, path
  confinement, cookies redaction on every sink incl. the surfaced status/error, timeout+SIGKILL). Add an
  AC that a hostile one-shot URL never reaches a shell and its cookies path never surfaces in any
  log/response/db field.
- **Node 22:** ACs verifiable under `node:test` with mocked spawn (no real binary/network); tests must
  pass on Node 22 (not just 24).
- **F/G core-scan exception:** the two regression ACs above (non-yt-dlp title untouched; distinct trees
  not merged) so the "must-not-degrade" guarantee is provable for the code paths that DON'T sit behind
  the isEnabled gate.

## Testability
Every AC must be tagged `[UNIT]` / `[INTEGRATION]` / `[MANUAL]` / `[PROCESS]` (mirror the v1.11.0 exec
plan's convention). Keep FFmpeg/the real yt-dlp binary OUT of the automated suite -- status parsing,
arg building, URL validation, title cleanup, and folder-dedup are all pure/mockable; the download itself
and the embedded-metadata/thumbnail postprocessing are `[MANUAL]`/on-device + a build-verification AC.

## Deliverables
1. Create the active exec plan at **`docs/exec-plans/active/2026-07-06-ytdlp-metube-parity.md`** with:
   Goal / Scope / Out-of-scope / Constraints (lead with OPTIONAL-ADDITIVE-NO-DEGRADE + the F/G exception),
   requirements grouped by workstream A-I, the cross-cutting + security NFRs, testability requirements,
   and a numbered, tagged acceptance-criteria list.
2. Cross-check: nothing in Out-of-scope may conflict with CONTRIBUTING.md's mandatory standards
   (tests, lint-0, additive/zero-regression) -- keep those explicitly in-scope.
3. Update `.state/feature-state.json`: set `artifacts.requirements` and `artifacts.exec_plan` to the exec
   plan path (already pre-filled to that path -- confirm/keep it).
4. If (and only if) you surface a GENUINE new product fork not covered by the locks above, list it under
   an "Open Questions" section for the EM to relay to Dean; otherwise state explicitly that no new forks
   arose (all product decisions were pre-locked).

**Do NOT** design endpoint internals, the status-parser mechanism, or the folder-merge implementation --
that is the Principal Engineer's Design stage. Specify OBSERVABLE behavior and acceptance criteria only.

When done, return to the EM session and run `/prep-pe-design`.
