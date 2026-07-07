# Software Developer inbox — T5 (v1.21 FR-5: pin a channel playlist to nav)

Feature: **v1.21.0 "The Polish Release"** (feature_id `v1.21-polish-release`),
branch `feature/v1.21-polish-release` (off `main` at v1.20.0). This file
**supersedes any prior-feature content.** This is **Task T5**, **Wave 4** — runs
ALONE. **Depends on T3** (attaches the star to T3's new subscription row and edits
the rewritten `subscriptions.js`). **Start only after the coordinator confirms T3
and T4 are integrated** (you share `subscriptions.js` with T3 and `style.css` with
T4). You are the first editor of `public/js/common.js` this release.

**Review tier: HEAVY two-reviewer gate (data-safety / folders-config invariant).**
Adversarial review must prove the new pin store never touches
`db.folders`/`folderSettings` and is never read/written/pruned by `POST /api/config`.

## Environment

- **Node 22 toolchain bin** (prepend to PATH before any npm/node command):
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- Use absolute paths (cwd resets between bash calls).

## Git — DO NOT commit

The **coordinator (EM) owns ALL git.** Do NOT `git add`/`commit`/`branch`/
`stash`/`push`. Report exact files changed + full `npm run lint` (0 warnings) and
`npm test` (Node 22) output. Fix any failure before reporting done.

## Read first (you share NO memory with the EM)

- `docs/exec-plans/active/2026-07-08-v1.21-polish-release.md` — the **## Design**
  section **"FR-5 — pin a channel playlist to persistent nav (HEAVY, data-safety)"**
  plus **AC33–AC39** and the "Data model changes"/"API changes" subsections.
- `docs/ui-research-2026-07.md` §3 (pin vs. subscribe are different intents;
  discoverable star toggle, not drag-only; pinned section alongside folders).
- `docs/CONTRIBUTING.md` (CommonJS server, vanilla DOM, `textContent`, `node:test`,
  lint 0, no new deps).
- Live code: `lib/ytdlp/store.js` (`ensureYtdlp` backfill pattern, `updateDatabase`
  serialized writer, `getMediaId`), `lib/ytdlp/index.js` (`registerRoutes`'s
  `isEnabled`/gated-route pattern, `resolveChannelDir` + its `downloadDir`
  confinement posture), `server.js`'s `POST /api/config` folder/folderSettings
  prune (confirm it only writes `db.folders`/`db.folderSettings`),
  `public/js/common.js` (`renderPlaylistsSheet`/`openPlaylistsSheet`, the
  subscriptions-nav capability probe), and T3's new `createSubscriptionRow`
  (where the star attaches) in `lib/ytdlp/client/subscriptions.js`.

## Task — implement THIS ONE task only (FR-5)

1. **New pin store (`store.js` or a new `lib/ytdlp/pins.js`).** `db.ytdlp.pins`:
   array of `{ id, channelDir, label, pinnedAt }` where `id = getMediaId(channelDir)`
   and `label` is a display SNAPSHOT (name at pin time — resolved fork: survives
   unsubscribe). `ensureYtdlp` backfills `pins: []` (disabled path stays
   byte-identical — nothing writes `db.ytdlp` unless the enabled module does).
   Functions (tested): `listPins(deps)`, `addPin(deps, {channelDir, label})`
   (idempotent by id), `removePin(deps, id)` — all via the serialized
   `updateDatabase`.
2. **Add-pin validation (security).** Before storing, confine `channelDir` under
   `config.downloadDir` (`path.resolve` prefix check, same posture as
   `resolveChannelDir`) and strip control chars + length-bound `label`.
3. **Routes (gated inside `registerRoutes`'s `isEnabled` — absent/404 when
   disabled, AC69):** `GET /api/subscriptions/pins` → `listPins`;
   `POST /api/subscriptions/pins` → validate + `addPin`;
   `DELETE /api/subscriptions/pins/:id` → `removePin`.
4. **UI.** A discoverable star/pin toggle on T3's subscription row (next to the
   kebab) calling `POST`/`DELETE` (AC35). In `common.js`, render pinned channels
   as a persistent "Pinned" subsection in `renderPlaylistsSheet` (mobile) and the
   sidebar folder list — ALONGSIDE, never merged into, the `db.folders`-driven
   list (AC36). Fetch `GET /api/subscriptions/pins` on sheet-open/sidebar-render;
   treat a 404 (module disabled) as "no pins" (empty). Tapping a pin opens
   `/?root=<channelDir>`. Labels via `textContent` (AC72). Pin state is
   server-persisted → survives restart (AC37).

## Tests to add

Unit (`test/unit/`): `addPin` idempotency, `removePin`, `channelDir` confinement
(a path outside `downloadDir` is rejected), label bounding. Integration
(`test/integration/`): pin persistence round-trip; **the invariant regression
(mirror the v1.20 FR-4 test): `POST /api/config` leaves `db.ytdlp.pins` untouched
and a pin never appears in `db.folders`/`folderSettings`** (AC34/AC38); a pin
route 404s when the module is disabled (AC69).

## File-ownership / serialization contract (STRICT — shared tree)

You are the sole running editor of `lib/ytdlp/store.js` (or new `pins.js`),
`lib/ytdlp/index.js`, `lib/ytdlp/client/subscriptions.js`, `public/js/common.js`,
`public/css/style.css` this wave. Keep `common.js` edits additive (T6 then T7
serialize AFTER you) and your `subscriptions.js` star toggle additive to T3's row.
Do NOT touch `db.folders`/`folderSettings` code paths, `server.js`'s
`POST /api/config`, `watch.js`, `main.js`, `player.js`, or the HTML shells. Label
your `style.css` block `/* v1.21 FR-5 */`.

## Report back

Files changed (path + one-line each); the pin record shape + the three route
signatures; the `downloadDir`-confinement + label-bounding proof; an explicit
"`db.folders`/`folderSettings` never touched; `POST /api/config` never
reads/writes/prunes pins" checklist with the regression-test name; disabled-module
404 confirmation; lint + Node 22 test result; any deviation/fork. Signal when T5
is done/verified so the coordinator can schedule Wave 5 (T6).
