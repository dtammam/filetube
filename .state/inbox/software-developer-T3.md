# Software Developer inbox — T3 (v1.21 FR-3 + FR-4, with FR-1 folded in)

Feature: **v1.21.0 "The Polish Release"** (feature_id `v1.21-polish-release`),
branch `feature/v1.21-polish-release` (off `main` at v1.20.0). This file
**supersedes any prior-feature content.** This is **Task T3**, **Wave 2** — runs
ALONE (strict per-file serialization: you share `style.css` + `subscriptions.html`
with T2 and `subscriptions.js` with T5/T7, so no task runs concurrently with you).
**Start only after the coordinator confirms T2 is integrated** (T2 leads the
`style.css` + `subscriptions.html` chain). **T3 blocks T5 and T7** (both rebase on
your new `subscriptions.js`).

**Review tier: HEAVY two-reviewer gate** (subscription CRUD UI surface — same
tier as v1.20 FR-1/FR-4). Dean's on-device pass is the arbiter for list/detail
feel.

## Environment

- **Node 22 toolchain bin** (prepend to PATH before any npm/node command):
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- Use absolute paths (cwd resets between bash calls).

## Git — DO NOT commit

The **coordinator (EM) owns ALL git.** Do NOT `git add`/`commit`/`branch`/
`stash`/`push`. Report exact files changed + full `npm run lint` (0 warnings) and
`npm test` (Node 22) output. Fix any failure before reporting done.

## Coordinator decisions (do NOT reopen)

- **FR-1 is FOLDED INTO this task.** There is no separate FR-1 hotfix. Your new
  rendering must satisfy FR-1's ACs (AC1–AC5): the count edit (and every settings
  field) must PERSIST and must NOT be clobbered by the ~2.5s live-status poll. You
  achieve this **structurally**: settings move OFF the list into a bottom-sheet
  the poll never re-renders, and the list poll updates only each row's
  `.sub-row-status` text IN PLACE (no `clearChildren`+full-rebuild). Do NOT port
  the old inline `editPanel` or an `openEditIds` guard — they are obsolete.
- **Subscription name = READ-ONLY.** `validateSubscriptionPatch`/
  `updateSubscription` do NOT accept a `name` patch, and editing name would
  change `resolveChannelDir` and orphan downloads. Render the channel name
  read-only in the sheet header. The sheet edits **count(maxVideos)/quality/
  type(format)/filetype/skipShorts** only.

## Read first (you share NO memory with the EM)

- `docs/exec-plans/active/2026-07-08-v1.21-polish-release.md` — the **## Design**
  sections **"FR-3 — subscriptions-first rearchitect (HEAVY)"** and **"FR-4 —
  subscribed date + clickable channel link (LIGHT)"**, plus **AC1–AC5, AC18–AC32**.
- `docs/ui-research-2026-07.md` §1 (list-not-grid, one row = avatar+name+one muted
  meta line+trailing kebab, detail-page/sheet settings, row-tap-opens-channel).
- `docs/CONTRIBUTING.md` (vanilla DOM, `textContent` over `innerHTML`, `node:test`,
  lint 0, no new deps).
- Live code (in full): `lib/ytdlp/client/subscriptions.js` (current
  `renderSubscriptions`/`createSubscriptionRow`/`pollStatusOnce`/`loadSubscriptions`,
  the inline `editPanel`, `repullOne`, the one-shot rendering) and
  `lib/ytdlp/views/subscriptions.html` (current `#view-root` order:
  add-form → one-off form+list → "Your subscriptions" `.folder-list-builder`).
  Note `sub.addedAt` (persisted since v1.11.0), `sub.channelUrl` (already
  `validateChannelUrl`-validated), `sub.channelDir` (v1.20 FR-4 per-channel link),
  and `window.FileTube.navigate`. Confirm `PATCH /api/subscriptions/:id` accepts
  `maxVideos:0` = unlimited (unchanged server path).

## Task — implement THIS ONE task only (FR-3 + FR-4 + FR-1 folded)

1. **New IA (`subscriptions.html`, `#view-root` region ONLY).** Reorder so "Your
   subscriptions" is FIRST/primary; wrap the add-subscription and one-off forms in
   native `<details>`/`<summary>` ("+ Add a subscription", "One-off download")
   BELOW the list (AC18/AC23, no JS). Replace the `.folder-list-builder` (240px
   cap) with a new `.sub-list` container, no scroll cap (AC24).
2. **New row (`subscriptions.js` `createSubscriptionRow` rewrite).** One dense row
   = avatar/letter (`name[0]`, beveled) + channel name + ONE muted meta line
   (`formatSubMeta` format/quality/count + FR-4 subscribed date) + FR-4 channel
   `<a>` link + a single trailing kebab/gear `<button>` (AC19). Remove the inline
   Pause/Edit/Re-pull/Delete cluster and `editPanel`.
   - **Row tap (AC20):** row body (outside kebab) → `window.FileTube.navigate` to
     `/?root=<channelDir>`. Rows without a resolved `channelDir` are non-navigating.
   - **Kebab → in-shell bottom-sheet (AC21/AC22):** the sheet holds
     maxVideos/quality/format/filetype/skipShorts + Pause/Resume, Re-pull, Delete,
     Save; name read-only in the header. Save PATCHes the existing, unmodified
     `PATCH /api/subscriptions/:id`. The sheet is NOT part of the poll-rerendered
     list → FR-1's race cannot recur by construction.
   - **Poll rerender (FR-1 fix):** `pollStatusOnce` updates only each row's
     `.sub-row-status` text in place; never `clearChildren`+rebuild while polling.
3. **FR-4 helpers (bundled).** Pure `formatSubscribedDate(addedAt)` (unit-tested)
   → "Subscribed on <date>"; missing/invalid → "date unknown" (never fabricated/
   crash, AC28/AC29). Channel link built via `.href = sub.channelUrl` +
   `target="_blank" rel="noopener noreferrer"` and `textContent` (AC30/AC31).
4. **Styling (`style.css`)** — add ONE labeled section
   `/* === v1.21 FR-3: subscriptions list / settings sheet === */`: zebra rows,
   1px separators, beveled avatars, era chips, the bottom-sheet — **era CSS vars
   only**.

Preserve the disabled-module no-op: `/subscriptions` still 404s server-side when
`FILETUBE_YTDLP_ENABLED` is off; nothing new is server-reachable (AC25/AC69).

## Tests to add

Unit: `formatSubscribedDate` (valid, missing, garbage → "date unknown");
href-safe link construction; a pure reducer/helper for "poll updates status text
without rebuilding an open sheet" (AC1/AC4). Integration: `PATCH
/api/subscriptions/:id` → `GET /api/subscriptions` round-trip for `maxVideos`
incl. `0` = unlimited (AC2); disabled-module 404 (AC25).

## File-ownership / serialization contract (STRICT — shared tree)

- You are the SOLE editor of `lib/ytdlp/client/subscriptions.js` this wave (T5
  adds a star toggle in Wave 2, T7 adds retry in Wave 4 — AFTER you; keep your
  row/kebab structure clean for them to attach to).
- In `lib/ytdlp/views/subscriptions.html` you edit `#view-root` + the collapsible
  forms. Leave the `<template id="player-host-template">` block exactly as T2 left
  it (T2 already integrated; do not disturb the player template).
- In `public/css/style.css` add ONLY your labeled `FR-3` section. Do NOT touch
  `public/js/common.js`, `lib/ytdlp/index.js`, `store.js`, `player.js`, or any
  other file.

## Report back

Files changed (path + one-line each); the new row anatomy + kebab-sheet field
list (with name read-only noted); how the poll-clobber race is structurally
eliminated (sheet-off-list + in-place status text) satisfying AC1–AC5; the
`formatSubscribedDate` signature + fallback; confirmation all dynamic strings use
`textContent`/`.href` (no `innerHTML`) and the disabled-module 404 still holds;
lint + Node 22 test result; any deviation/fork with a recommendation. Signal when
T3 is done/verified so the coordinator can schedule Wave 2 (T5).
