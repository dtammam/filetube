# Software Developer inbox — T4 (v1.20 FR-4 per-channel playlist)

Feature: **v1.20.0 "Subscribe button — real subscriptions from downloads"**
(feature_id `v1.20-subscribe`), branch `feature/v1.20-subscribe` (off `main` at
v1.19.1). This file **supersedes any prior-feature content**. This is **Task T4**.
Wave **2** — runs in PARALLEL with T2 (disjoint file sets). **Depends on T1** and
must not start until the coordinator confirms T1 is done/verified. T4 **blocks
T3** (file-serialization on `lib/ytdlp/index.js` + `public/css/style.css`).

**Review tier: TWO-REVIEWER GATE** — must re-prove the `db.folders`/
`folderSettings` synthetic-root invariant holds with the new per-channel Playlist
links (nothing here may write `db.folders`).

## Environment

- **Node 22 toolchain bin** (prepend to PATH before any npm/node command):
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- Use absolute paths (cwd resets between bash calls).

## Git — DO NOT commit

The **coordinator (EM) owns ALL git.** Do NOT `git add`/`commit`/`branch`/
`stash`/`push`. Report files changed + full `npm run lint` (0 warnings) and
`npm test` output under Node 22; fix any failure before reporting done.

## Read first (you share NO memory with the EM)

- `docs/exec-plans/active/2026-07-08-v1.20-subscribe.md` — read the **## Design**
  section **"FR-4 — each subscribed channel = a playlist"** and the T4 bullet in
  **## Task breakdown** (note the SCOPING NOTE below).
- `.state/feature-state.json` — the `tasks[]` entry `"id":"T4"`; the
  `db.folders`/`folderSettings` invariant in `hard_constraints`.
- `docs/CONTRIBUTING.md` (vanilla DOM, `textContent`/`escapeAttr` not
  `innerHTML`, 2-space, semicolons, single-quotes, lint 0, no new deps) and
  `docs/RELIABILITY.md`.
- Live code: `lib/ytdlp/index.js` — the gated `GET /api/subscriptions` handler
  (has `config` in scope); `lib/ytdlp/args.js` `resolveChannelDir(config, sub)`
  (the confined per-channel path); `lib/ytdlp/store.js` `listSubscriptions`
  (keep pure/unchanged — enrich in the ROUTE, not the store);
  `lib/ytdlp/client/subscriptions.js` — `createSubscriptionRow` and the existing
  `escapeAttr`/`textContent` helpers; the existing `/?root=<path>` link pattern
  used by the Playlists sheet/sidebar; `server.js`'s `underFolder` `root=` filter
  (pure path-prefix match — confirms no backend filter change is needed).

## Task — implement THIS ONE task only (FR-4)

1. **Expose the resolved dir (`lib/ytdlp/index.js`).** In the gated
   `GET /api/subscriptions` handler, enrich each returned sub with a computed
   `channelDir: args.resolveChannelDir(config, sub)`, wrapped in try/catch (a sub
   that fails confinement simply omits the field). Read-only, per-request;
   NEVER write `db.folders`/`folderSettings`. Keep `store.listSubscriptions`
   pure/unchanged.
2. **Surface the link (`lib/ytdlp/client/subscriptions.js`).** In
   `createSubscriptionRow`, render a per-sub playlist link to
   `/?root=<encodeURIComponent(channelDir)>` (built via `textContent`/
   `escapeAttr`, never `innerHTML`), reusing the exact `/?root=<path>` pattern
   already used elsewhere, so it confines to that channel's own subfolder. Omit
   the link when `channelDir` is absent.
3. **Style (`public/css/style.css`).** Add ONLY a small, distinct per-sub
   playlist-link style block using era-theme CSS custom properties (no hardcoded
   colors). Keep it a separate block so T3 (Wave 3) merges its own distinct block
   cleanly.

### SCOPING NOTE (EM decision — read this)

The design mentions an OPTIONAL mobile-Playlists-sheet link in
`public/js/common.js`. It is **scoped OUT of T4** to keep this task disjoint from
T2 on the shared working tree. The Subscriptions-tab link alone satisfies AC22
(per the design's "Open fork for Dean"). **Do NOT edit `public/js/common.js`.**

## Tests to add

- **Unit** (`test/unit/`): the `channelDir` enrichment shape (present for a valid
  sub, omitted on a confinement failure); the `/?root=<encodeURIComponent(...)>`
  link construction; confirmation no code path writes `db.folders`.
- **Integration** (`test/integration/`): `GET /api/subscriptions` returns
  `channelDir` per sub; a `root=<channelDir>` filter surfaces ONLY that channel's
  own confined subfolder (never another channel's videos or the whole Downloads
  root); a `db.folders`/`folderSettings`-untouched assertion (the invariant
  regression lock).

## Hard constraints

- TWO-REVIEWER GATE. `db.folders`/`folderSettings` are NEVER written by anything
  in this task. `channelDir` comes from the confined `resolveChannelDir`; `root=`
  is an exact prefix match. No backend filtering primitive is added.
- Disabled-module byte-identical: `channelDir` only appears on the already-gated
  `GET /api/subscriptions`; no new always-present DOM or route.
- `textContent`/`escapeAttr`, never `innerHTML`. Era-theme tokens only. No new
  npm deps. Lint 0 warnings.
- **Do NOT touch** `public/js/common.js` (T2, scoped out here), `public/js/
  watch.js` / `public/watch.html` (T3), `lib/ytdlp/{args,run,store}.js` or
  `server.js` (T1), or `lib/ytdlp/config.js` (T5). Your files:
  `lib/ytdlp/index.js`, `lib/ytdlp/client/subscriptions.js`,
  `public/css/style.css` (+ tests).

## Report back

Files changed (path + one-line each); the enrichment + link construction;
explicit confirmation `db.folders`/`folderSettings` are untouched and the link
confines to the per-channel subfolder; lint + Node 22 test result; any
deviation/new fork with a recommendation. Signal when T4 is done/verified so the
coordinator can schedule T3 (needs T2 AND T4).
