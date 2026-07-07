# Software Developer inbox — T2 (v1.20 FR-2 client matcher + creator precedence)

Feature: **v1.20.0 "Subscribe button — real subscriptions from downloads"**
(feature_id `v1.20-subscribe`), branch `feature/v1.20-subscribe` (off `main` at
v1.19.1). This file **supersedes any prior-feature content**. This is **Task T2**.
Wave **2** — runs in PARALLEL with T4 (disjoint file sets). **Depends on T1** and
must not start until the coordinator confirms T1 is done/verified. T2 **blocks
T3**.

**Review tier: TWO-REVIEWER GATE** — rides T1's FR-2 tier (this is the same
untrusted-channel-identity security surface, now on the client matcher).

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
  section, especially **"Matcher (`public/js/common.js`…)"** and **"Creator
  display precedence"** under FR-2, plus the T2 bullet in **## Task breakdown**.
- `.state/feature-state.json` — the `tasks[]` entry `"id":"T2"`; note T1 has
  landed the stored field shapes you consume (`channelUrl`, `channelName`,
  `channelId`, `channelHandleUrl` on yt-dlp `db.metadata` items).
- `docs/CONTRIBUTING.md` (vanilla DOM, 2-space, semicolons, single-quotes,
  `node:test`, lint 0, no new deps) and `docs/RELIABILITY.md`.
- Live code: `public/js/common.js` — the existing `resolveChannelName` and its
  current precedence chain (mapped folder friendly-name → `item.artist` →
  `item.folderName` → `'Library'`); how helpers are exported for `node:test` in
  this repo.

## Task — implement THIS ONE task only (FR-2 client side)

All in `public/js/common.js`, pure and `node:test`-covered:

1. `canonicalizeChannelUrl(url)` → canonical key or `null`. Parse; lowercase
   host; then `/channel/<UC…>` → `channel:<UCid>` (case PRESERVED — ids are
   case-sensitive); `/@handle` → `handle:<lowercased>`; `/user/<name>` →
   `user:<lowercased>`; `/c/<name>` → `c:<lowercased>`; a `youtu.be`/`/watch`
   video URL → `null` (a video URL is not a channel identity); anything
   unrecognized → `null` (conservative).
2. `channelIdentityMatches(fileIdentity, subUrl)` → boolean. Build the file's
   key-SET from `{ canonicalizeChannelUrl(channelUrl),
   'channel:'+channelId (when present), canonicalizeChannelUrl(channelHandleUrl)
   }` (drop nulls); return `true` iff `canonicalizeChannelUrl(subUrl)` is in that
   set. This lets a `/channel/UC…` file match a `/@handle` subscription (shared
   handle key from `uploader_url`) or a `/channel/UC…` subscription (channel-id
   key), and NEVER false-matches two forms that can't be proven equal.
3. `resolveFileChannelIdentity(item)` → `{ channelUrl, channelId,
   channelHandleUrl } | null` (null when no `channelUrl`) — single-sources what
   FR-1/FR-3 (T3) consume. Never throws on a missing/malformed item.
4. Extend `resolveChannelName` precedence: captured `item.channelName`
   (non-empty) ranks FIRST, THEN the existing chain unchanged. It must rank first
   ONLY when present, so non-yt-dlp files are completely unchanged.

## Tests to add

`node:test` unit coverage (all pure): `canonicalizeChannelUrl` for each URL shape
(`/channel/UC…` case-preserved, `/@handle`, `/user`, `/c`, video URL → null,
garbage → null); `channelIdentityMatches` for cross-shape match (handle vs
channel-id), non-match of unprovable forms, empty/partial identity;
`resolveFileChannelIdentity` (present, absent, malformed → null, no throw);
`resolveChannelName` (captured name wins when present; non-yt-dlp item unchanged
across the full existing chain).

## Hard constraints

- Pure / unit-testable; never naive string `===` on two channel URLs of
  differing shape. No new npm deps. Lint 0 warnings. `textContent` posture for
  any display strings (no `innerHTML`).
- **Do NOT touch** `lib/ytdlp/index.js`, `lib/ytdlp/client/subscriptions.js`,
  `public/css/style.css` (T4 owns those this wave), or `public/js/watch.js` /
  `public/watch.html` (T3). You are the SOLE editor of `public/js/common.js` this
  wave — keep your edits additive so T3 (Wave 3) merges cleanly on top.

## Report back

Files changed (path + one-line each); the four helper signatures + the canonical
key scheme; confirmation matching is set-membership on canonical keys (no naive
`===`) and that non-yt-dlp `resolveChannelName` output is unchanged; lint + Node
22 test result; any deviation/new fork with a recommendation. Signal when T2 is
done/verified so the coordinator can schedule T3 (needs T2 AND T4).
