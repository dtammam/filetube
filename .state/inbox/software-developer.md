# Software Developer -- Task T1 (ytdlp-metube-parity, v1.12.0)

## Your task: ONE task only -- T1: Lib primitives (pure, no routes)

This is the pure, low-risk foundation the rest of the feature builds on. It adds
per-subscription `maxVideos`, embed-metadata/thumbnail flags, a single-video URL
classifier, and a subscription-update store helper with validation/backfill.
**No new routes, no orchestration, no UI, no yt-dlp invocation in T1.**

## Read first (in this order)
1. `docs/exec-plans/active/2026-07-06-ytdlp-metube-parity.md` -- the `## Design`
   section. Specifically: **FR-C** (per-channel N), **FR-H** (embed flags),
   **FR-A** (the `classifySingleVideo` sub-section under "FR-A -- One-shot
   endpoint + shared serialization"), **FR-D** (the "Record fields" + `store.
   updateSubscription` parts). Also skim the Acceptance criteria for the AC
   numbers referenced below.
2. `docs/CONTRIBUTING.md` -- standards: Node 22, `node:test`, single-quoted 2-space
   CommonJS, `npm run lint` **zero** warnings, every change ships with tests,
   additive/zero-regression, keep FFmpeg/real yt-dlp out of the automated suite.
3. The existing module files you are extending (read before editing):
   `lib/ytdlp/args.js`, `lib/ytdlp/url.js`, `lib/ytdlp/store.js`, plus
   `lib/ytdlp/config.js` for `parseYtdlpConfig`/`maxVideos` default. Reuse the
   existing primitives -- do NOT fork or duplicate `validateChannelUrl`,
   `normalizeQuality`, `playlistEndArgs`, or the `updateDatabase` write path.

## Environment (required before any node/npm command)
`export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`
Run `npm run lint` and `npm test` (or `npm run test:unit` for the fast loop).
The coordinator additionally verifies on Node 22 -- keep tests free of Node-version-
sensitive timing (no real timers left armed; use fake timers where needed).

## What to implement

### 1. `lib/ytdlp/args.js` -- FR-C per-sub maxVideos + FR-H embed flags
- **FR-C:** In `buildYtdlpListArgs(sub, config)` compute the effective per-sub
  bound INLINE with precedence `sub.maxVideos ?? config.maxVideos` (config already
  defaults to 25; treat `0` as unlimited per-sub), and feed the EXISTING
  `playlistEndArgs` helper (its signature is unchanged -- it already reads
  `.maxVideos` off its argument; pass `{ maxVideos: effective }`). Do NOT change
  `playlistEndArgs`'s own signature. When `sub.maxVideos` is unset the global
  default must apply UNCHANGED (AC19 -- do not regress existing behavior).
- **FR-H:** In `buildYtdlpDownloadArgs` add `--embed-metadata` AND
  `--embed-thumbnail`, each as its OWN argv element, to BOTH the audio and the
  video branches. Keep `--restrict-filenames` and the `--`-before-URL discipline
  exactly as they are. Arg-array only; never string-concatenate.

### 2. `lib/ytdlp/url.js` -- FR-A `classifySingleVideo(raw)`
- Add `classifySingleVideo(raw)`: run the existing `validateChannelUrl(raw)`
  FIRST so ALL current security checks apply (host allowlist, http/https only,
  userinfo reject, metachar reject, decoded-id charset). Then inspect the
  normalized URL:
  - `youtu.be/<id>` -> `{ ok: true, videoId: <id> }`
  - `youtube.com/watch?v=<id>` (incl. `www.`/`m.`/`music.`) -> `{ ok: true, videoId: <v> }`
  - anything channel/playlist/`/@handle`/`/c/`/`/user/` (or validateChannelUrl
    failing) -> `{ ok: false, error: <short reason> }`
  - re-check the extracted `videoId` with the existing `isSafeVideoId`; fail ->
    `{ ok: false, error }`.
- SINGLE source of truth -- do NOT copy/fork `validateChannelUrl`. Export
  `classifySingleVideo` for T3 and the unit tests. This is FR-A's validator
  foundation (AC54); T3 wires it into `POST /api/ytdlp/download`.

### 3. `lib/ytdlp/store.js` -- FR-D updateSubscription + validation + backfill
- Add `updateSubscription(deps, id, patch)` writing via the injected
  `updateDatabase` primitive (same pattern as the existing add/delete/setStatus
  helpers -- single-mutator RMW, no second file, no lock held across anything
  async that isn't the update itself). It mutates ONLY the fields present in
  `patch` and PRESERVES `id`, `channelUrl`, `name`, `addedAt`, `lastCheckedAt`,
  `lastStatus`, and the download-archive association untouched (AC21). Returns the
  updated record, or `null` when the id is unknown (T3 maps null -> 404, AC24).
- Extend `validateSubscriptionInput` (or the shared validator the add path uses)
  to validate the two new optional fields:
  - `maxVideos`: an integer in `[0, MAX_SUB_MAX_VIDEOS]` (define
    `MAX_SUB_MAX_VIDEOS` ~5000 as a module constant); anything else (non-integer,
    negative, out-of-range) is INVALID -- surfaced so the API boundary can 400
    (AC20). Do NOT silently coerce. `undefined` (unset) stays valid -> global
    default at build time (AC19).
  - `paused`: boolean; anything else invalid.
- In `ensureYtdlp` add a per-subscription backfill: `if (typeof sub.paused !==
  'boolean') sub.paused = false;` so existing subs migrate in-memory on read and
  persist on the next write -- NO standalone migration, NO change to core
  `loadDatabase`/`DEFAULT_SETTINGS`. `maxVideos` stays `undefined` when unset.

## Constraints / invariants (do not break)
- **Disabled path stays byte-identical.** T1 touches only lib helpers + validators;
  it must NOT register routes, arm timers, spawn anything, or run at require time.
  The existing disabled-no-op tests must stay green.
- Reuse existing primitives (`validateChannelUrl`, `normalizeQuality`,
  `playlistEndArgs`, `isSafeVideoId`, `updateDatabase`) -- no parallel
  implementations.
- No new runtime dependencies. CommonJS, `require()`-safe (zero side effects at
  import). 2-space, single quotes, semicolons.

## Tests to add (node:test, no real binary/network)
- **[UNIT] FR-C:** `buildYtdlpListArgs` emits `--playlist-end <N>` from
  `sub.maxVideos` overriding the global (AC18); falls back to the global default
  when unset (AC19); `0` -> unlimited (assert whatever "unlimited" produces per
  your `playlistEndArgs` semantics).
- **[UNIT] FR-H:** `buildYtdlpDownloadArgs` includes `--embed-metadata` for
  audio (AC48) and video (AC49), and `--embed-thumbnail` for both (AC50);
  `--restrict-filenames` still present; `--` still immediately before the URL.
- **[UNIT] FR-A:** `classifySingleVideo` accepts `youtu.be/<id>` and
  `watch?v=<id>` (ok + correct videoId), rejects a channel/playlist/`@handle`
  URL, a non-YouTube host, a non-http(s) URL, and a metachar URL -- all
  `{ ok:false }` with no throw (AC54 foundation, AC9/10 groundwork).
- **[UNIT] FR-D:** `validateSubscriptionInput` rejects a non-integer / negative /
  >MAX `maxVideos` and a non-boolean `paused` (AC20); accepts unset.
- **[INTEGRATION or UNIT] FR-D:** `updateSubscription` changes only patched fields
  and preserves `addedAt`/`lastCheckedAt`/`lastStatus` (AC21); returns `null` for
  an unknown id (AC24); `ensureYtdlp` backfills `paused=false` on a legacy sub
  without it.

## Definition of done
- All the above implemented; new `[UNIT]`/`[INTEGRATION]` tests added and passing.
- `npm run lint` zero warnings; `npm test` green (existing suite unchanged +
  new tests). Verify it also passes on Node 22 posture (no dangling timers).
- **Do NOT commit, stage, or push** -- the coordinator owns git. Report back:
  the list of files changed, a one-line summary per file, the new test names, and
  the final lint/test output (pass counts).

When done, return to the EM session; the coordinator runs build-verify via
`/prep-build-verify`.
