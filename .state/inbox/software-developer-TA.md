# SDE Task TA — FR-2: Retroactive folder-based Subscribe-button backfill

Feature: **v1.22.0 "Player Parity + Roadmap"** — branch `feature/v1.22-player-parity`.
Exec plan (READ `## Design (FR-2..FR-10)` → the `### FR-2` subsection in full, incl. AC80/AC81): `docs/exec-plans/active/2026-07-08-v1.22-player-parity.md`.
Standards: `docs/CONTRIBUTING.md` (CommonJS server, 2-space/semis/single-quotes, node:test, lint 0, no new deps).

This is a **SERVER-track** task, fully disjoint from every other Wave-1 task — you
are the ONLY editor of `server.js` and `lib/ytdlp/index.js` this wave.

## Context / root cause (confirmed in the design)

Channel identity (`channelUrl`/`channelName`/`channelId`) is bridged onto
`db.metadata[id]` ONLY when `freshlyScannedIds.has(item.id)` (server.js ~1607) —
i.e. only on a file's very first scan. Pre-v1.20 downloads and files indexed by
a periodic auto-scan before their `downloadMeta` was written are never revisited,
so their Subscribe button is missing forever. Fix = a second, folder-based
backfill pass that runs on EVERY scan (not scoped to `freshlyScannedIds`).

## Scope

**`lib/ytdlp/index.js` — new pure matcher + module wrapper:**
1. Pure `matchChannelDirToSubscription(filePath, resolvedSubs)` (exported for
   unit test): compare `path.dirname(path.resolve(filePath))` against each
   `resolvedSubs[].channelDir` by **EXACT directory equality** (NOT a `startsWith`
   prefix — a file merely sharing a path prefix that is not its actual parent
   channel dir must NOT match). Return the matched sub's
   `{ channelUrl, channelName, channelId }` or `null`.
2. `ytdlp.backfillChannelIdentityFromFolder(fresh, item, config)` (mirror the
   existing `ytdlp.consumeDownloadChannelMeta` export ~index.js:1634): memoize
   `resolvedSubs` **once per scan** from `fresh.ytdlp.subscriptions` via the
   existing `enrichSubscriptionWithChannelDir(config, sub)` (wrapped in its
   try/catch confinement — a sub that fails confinement is omitted); run the
   matcher; **re-validate** the matched `channelUrl` through the UNMODIFIED
   `url.validateChannelUrl` before returning; return the identity fields or `null`.

**`server.js` — sibling backfill block in the Phase-2 `updateDatabase(fresh => …)`
mutator, immediately after the existing `freshlyScannedIds`-scoped bridge, NOT
scoped to `freshlyScannedIds`:**
- Skip any item that already has a truthy `item.channelUrl` (never overwrite — a
  genuine gap only, AC17).
- Skip any item not under `ytdlpDownloadRoots` (reuse `matchRootFolder`, exactly
  as the existing bridge does).
- Call `ytdlp.backfillChannelIdentityFromFolder(...)`; on a non-null result,
  assign `channelUrl` **AND `channelName`** (AC80 — the creator name display
  depends on `channelName` being written, not just `channelUrl`; `channelId` if
  available) and set `dbChanged = true`, exactly like the existing bridge block.

**Display clarifications (fold in, mostly regression-locks):**
- **AC80:** `resolveChannelName` (common.js) already ranks `item.channelName`
  first, so writing `channelName` is all that's needed for the real creator to
  show on watch page + cards — no client change. Add an integration assertion.
- **AC81:** the v1.19 save-to-device button (`watch.js:309`) is wired
  UNCONDITIONALLY — add a regression-lock asserting it is NOT gated/hidden for
  yt-dlp/backfilled items. No code change expected.

## Race fix (AC20)
No download/scan re-sequencing needed: the folder backfill inherently heals the
periodic-scan race (a file indexed before its `downloadMeta` was written picks up
identity from its own folder on the next scan). Document this in the exec plan's
Decision log as confirmed-and-healed.

## Tests
- **Unit:** `matchChannelDirToSubscription` — exact parent match; a non-parent
  prefix is rejected; multiple-subs disambiguation; `null` on no match. Plus the
  never-overwrite guard behavior.
- **Integration:** an identity-less yt-dlp item under a sub's `channelDir` gets
  `channelUrl`+`channelName` backfilled on scan (NO yt-dlp spawn) and shows the
  resolved creator (AC80); a non-yt-dlp item under an ordinary library folder does
  NOT; an item that already has `channelUrl` is untouched (AC17); disabled-module
  (no subs) → total no-op (AC21); save-to-device button ungated (AC81).

## Acceptance criteria owned: AC15, AC16, AC17, AC18, AC19, AC20, AC21, AC22, AC80, AC81.

## Gate & reporting
- **Gate:** two-reviewer (db.metadata mutation + spawn-guard-adjacent via
  `validateChannelUrl` reuse).
- Do NOT modify `validateChannelUrl` or any validator. Do NOT touch
  `db.folders`/`folderSettings`. No new yt-dlp spawn, no re-download.
- Run Node 22 tests + lint; fix failures. **Report:** files changed, matcher
  signature, the Decision-log wording for AC20, test output.

---
**Toolchain:** Node 22 at `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin` — prepend to PATH. Test: `npm test`. Lint: `npm run lint`. Absolute paths.
**Git:** COORDINATOR owns ALL git. Do NOT commit. Report files-changed + test/lint output only.
