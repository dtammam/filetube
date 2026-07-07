# Software Developer inbox — T1 (v1.20 FR-2 capture + store + bridge, ENABLER)

Feature: **v1.20.0 "Subscribe button — real subscriptions from downloads"**
(feature_id `v1.20-subscribe`), branch `feature/v1.20-subscribe` (off `main` at
v1.19.1). This file **supersedes any prior-feature content**. This is **Task T1**.
Wave **1** — runs in PARALLEL with T5 (disjoint file sets). T1 is the ENABLER: it
**blocks T2/T3/T4**.

**Review tier: TWO-REVIEWER GATE** (quality-assurance + a separate adversarial
`/code-review`). Reasons: untrusted yt-dlp output must pass the UNMODIFIED
`url.validateChannelUrl`/`isSafeVideoId` before any persistence or use, and you
are changing the download-spawn argv.

## Environment

- **Node 22 toolchain bin** (prepend to PATH before any npm/node command):
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
  e.g. `export PATH="/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin:$PATH"`
- Use absolute paths (cwd resets between bash calls).

## Git — DO NOT commit

The **coordinator (EM) owns ALL git.** Do NOT `git add`/`commit`/`branch`/
`stash`/`push`. When done, report the exact files changed/created plus the full
`npm run lint` (0 warnings) and `npm test` output under Node 22. Fix any failure
before reporting done.

## Read first (you share NO memory with the EM)

- `docs/exec-plans/active/2026-07-08-v1.20-subscribe.md` — read the **## Design**
  section, especially **"FR-2 — capture + store + match channel identity (the
  enabler)"** and the T1 bullet under **## Task breakdown**. Implement to that
  design; it names every helper, cap, and field.
- `.state/feature-state.json` — the `tasks[]` entry `"id":"T1"`, plus
  `hard_constraints` and `shared_tree_serialization`.
- `docs/CONTRIBUTING.md` (CommonJS server, 2-space, semicolons, single-quotes,
  `node:test`, lint 0, NO new runtime deps) and `docs/RELIABILITY.md` (unit in
  `test/unit/`, integration boots `app` on an ephemeral port against an isolated
  temp `DATA_DIR`; keep FFmpeg out of the automated suite; "never let one bad
  file take down a scan").
- Live code: `lib/ytdlp/args.js` (`buildYtdlpDownloadArgs`, `OUTPUT_TEMPLATE`,
  `SHORTS_MATCH_FILTER`/`VIDEO_FORMAT_SORT` fixed-literal pattern),
  `lib/ytdlp/run.js` (`spawnYtdlpDownload`, `makeLineSplitter`,
  `parseProgressLine`, `runDownload`, `STDERR_TAIL_LIMIT`), `lib/ytdlp/store.js`
  (`ensureYtdlp`, `updateDatabase`, existing length-cap constants),
  `lib/ytdlp/url.js` (`validateChannelUrl`, `isSafeVideoId`),
  `lib/ytdlp/index.js` (`runSubscriptionCycle`, `runOneShot`), `server.js` scan
  (`getMediaId`, `cleanDisplayTitle`, `ytdlpDownloadRoots`, the Phase-2
  `updateDatabase(fresh => …)` mutator that already sets `rootFolder`).

## Task — implement THIS ONE task only (FR-2 enabler)

1. **Capture template (`lib/ytdlp/args.js`).** In `buildYtdlpDownloadArgs`, add
   UNCONDITIONALLY (audio + video, subscription + one-shot), emitted **before**
   the `--`/positional targets, a **fixed-literal** flag:
   `--print after_move:FTCHMETA\t%(id)s\t%(channel_url)s\t%(channel_id)s\t%(uploader_url)s\t%(channel)s`
   - `FTCHMETA` is a fixed sentinel; NEVER interpolate a per-sub/per-video value
     (same posture as `SHORTS_MATCH_FILTER`/`VIDEO_FORMAT_SORT`). The
     `after_move:` WHEN-prefix is LOAD-BEARING — a bare `--print` implies
     `--simulate` (no download). Do not drop it.
2. **Capture parse (`lib/ytdlp/run.js`).** Add pure exported
   `parseChannelMetaLine(line)` → `{ videoId, channelUrl, channelId,
   uploaderUrl, channelName } | null` (match only lines starting `FTCHMETA\t`,
   split on `\t`, `NA`/empty → absent). In `spawnYtdlpDownload`, the per-line
   handler tries `parseChannelMetaLine` FIRST; a match is pushed to a **bounded**
   `capturedMeta` array (`MAX_CAPTURED_META`, e.g. 1000, exported like
   `STDERR_TAIL_LIMIT`) and NOT forwarded to `onProgress`; a non-match falls
   through to `parseProgressLine`/`onProgress` exactly as today. Return
   `channelMeta: capturedMeta` on the `spawnYtdlpDownload`/`runDownload` result.
   Keep `result.stdout` as `''` (SF3 preserved).
3. **Validate before persistence (`lib/ytdlp/store.js`, reuse `url.js`).** Pure,
   exported, `node:test`-covered `sanitizeCapturedChannelMeta(raw)`:
   - `channelUrl` ← first of `channel_url` else `uploader_url` that passes
     `url.validateChannelUrl` (store normalized); neither passes → NO identity
     (drop the item).
   - `channelHandleUrl` ← `uploader_url` if it independently passes
     `validateChannelUrl` and differs from `channelUrl`.
   - `channelId` ← `channel_id` only if it matches `^UC[A-Za-z0-9_-]{22}$`.
   - `channelName` ← `channel`, control-chars stripped, length-bounded (~200,
     reuse existing cap style).
   - `videoId` ← must pass `url.isSafeVideoId`, else drop the whole entry.
4. **Persist the capture map (`lib/ytdlp/store.js`).**
   `db.ytdlp.downloadMeta = { [videoId]: { channelUrl, channelHandleUrl?,
   channelId?, channelName?, capturedAt } }`. `recordDownloadChannelMeta(deps,
   entry)` runs the sanitizer, drops invalid entries, writes through the
   serialized `updateDatabase`, and enforces a FIFO cap (`MAX_DOWNLOAD_META`,
   e.g. 5000, evict oldest by `capturedAt`). `ensureYtdlp` backfills
   `downloadMeta: {}` (disabled path stays byte-identical — nothing calls in).
5. **Wire both orchestrators (`lib/ytdlp/index.js`).** After a successful
   `run.runDownload` in `runSubscriptionCycle` and `runOneShot`, for each
   `downloadResult.channelMeta` entry call `recordDownloadChannelMeta`. On the
   SUBSCRIPTION path only, if capture produced nothing for a survivor id, fall
   back to the sub's already-validated `sub.channelUrl` + `sub.name` keyed by
   that id. The one-shot path has NO fallback (capture miss → item without
   identity).
6. **Bridge onto `db.metadata` (`server.js` + a `lib/ytdlp` helper).** Add pure
   `extractYtdlpVideoId(baseName)` (mirror `cleanDisplayTitle`'s regex: the
   trailing space-then-`[<11-char id>]` bracket → the id, else `null`). Add module helper
   `ytdlp.consumeDownloadChannelMeta(fresh, videoId)` that reads + validates
   `fresh.ytdlp.downloadMeta[videoId]`, **deletes** that key, and returns
   `{ channelUrl, channelHandleUrl?, channelId?, channelName? } | null`. In the
   existing Phase-2 `updateDatabase(fresh => …)` mutator, for each new/updated
   item under a download root with an extractable videoId, call it and assign
   returned fields onto the item. Keep all `db.ytdlp` structural knowledge inside
   the module.

## Tests to add

- **Unit** (`test/unit/`): `parseChannelMetaLine` (sentinel/`\t`-split, `NA`/
  empty absent, non-match null); `sanitizeCapturedChannelMeta` (URL-validation
  gating, `channelHandleUrl` broadening, `channelId` regex, name bounding,
  videoId gate, hostile/malformed dropped); `extractYtdlpVideoId`; the two caps.
- **Integration** (`test/integration/`): the download argv still DOWNLOADS with
  `--print after_move:` present (arg-shape, no `--simulate` leakage); an
  end-to-end capture→`downloadMeta`→scan→`db.metadata[id]` fields path
  (mock/stub the spawn as the existing download harness does; no real
  FFmpeg/network).

## Hard constraints

- TWO-REVIEWER GATE. Do NOT modify `validateChannelUrl`,
  `validateSubscriptionInput`, or any host allowlist / shell-metachar guard.
- No new npm deps. Lint 0 warnings. Disabled-module (`FILETUBE_YTDLP_ENABLED`
  off) path byte-identical.
- Do NOT touch `public/js/common.js`, `public/js/watch.js`, `public/watch.html`,
  `public/css/style.css`, `lib/ytdlp/client/subscriptions.js`, or
  `lib/ytdlp/config.js` — other tasks own those.

## Report back

Files changed (path + one-line each); the exact `--print` template + helper
signatures + cap values; a short "guards unchanged" checklist; the
capture→metadata path proof; lint + Node 22 test result; any deviation/new fork
with a recommendation. Signal clearly when T1 is done/verified so the coordinator
can unblock Wave 2 (T2 + T4).
