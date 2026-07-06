# Principal Engineer — T4 Fix-Round Design Note (SCOPED)

Feature: **Optional yt-dlp subscription integration module** (target v1.11.0),
branch `feat/ytdlp-integration`. You are being called for a **narrow, mid-implementation
design decision**, NOT discovery and NOT a whole-module re-design. Task **T4** (the
download/poll loop, committed at `d0f53a0`) went through its first two-reviewer gate
(the quality-assurance agent + a separate adversarial `/code-review`, 11 findings) and
came back **CHANGES REQUESTED**. Both reviewers **independently confirmed the same
architectural critical (C1)**. C1 needs a design decision from you before the SDE can
remediate. C2–C7 are localized fixes the SDE will implement against your note; you only
need to (a) DECIDE the C1 mechanism and (b) reconcile C3+C7 into ONE folder-registration
approach.

## Read first (grounding)

- `.state/feature-state.json` — the `tasks[T4].review_result` field has the full,
  ranked C1–C7 triage + the low/tech-debt tail + the regression tests the fix must add.
  Also see `locked_decisions` (esp. **D2** members-only fail-safe, **D3** delete-stays-gone)
  and `hard_constraint` (OPTIONAL / ADDITIVE / disabled == byte-identical to today).
- `docs/exec-plans/active/2026-07-05-yt-dlp-integration-module.md` — the exec plan
  (## Design + acceptance criteria; you will append a **## T4 Fix-Round Design Note**).
- `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`, `docs/RELIABILITY.md` — spawn try/catch +
  graceful-degrade + keep binaries out of the core test suite; single serialized
  `updateDatabase` writer; poll-and-defer premiere model.
- Code you are reasoning about (do NOT edit — design only):
  - `lib/ytdlp/index.js` — `runSubscriptionCycle` (the survivorCount loop + the single
    `run.runDownload(sub, config)` at **line 170**), `quarantineEscapedDownloads` (line 87),
    `ensureDownloadDirRegistered` (line 472), `startBackground` (line 503, early-returns
    when disabled), the `cookiesConfigured = Boolean(config && config.cookiesFile)` at line 140.
  - `lib/ytdlp/args.js` — `buildYtdlpListArgs` / `buildYtdlpDownloadArgs` (both take only
    `sub.channelUrl`, emit `--download-archive` + the positional URL after `--`; NO
    `--match-filter` / `--playlist-items` / per-id list), `cookiesArgs` (attaches `--cookies`
    whenever the file EXISTS, independent of any toggle), `resolveChannelDir`,
    `realpathUnderChannelDir`, `OUTPUT_TEMPLATE`.
  - `lib/ytdlp/url.js` — `validateChannelUrl`; ids/params already constrained to
    `/^[A-Za-z0-9_-]+$/` and bounded length (relevant to safe watch-URL construction).
  - `lib/ytdlp/rules.js` — `isArchived` (case-sensitive needle, C2), `shouldSkip`,
    `shouldDeferPremiere`, `parseYtdlpVideoList`.
  - `server.js` — `POST /api/config` at **line 1226** rebuilds `db.folders = validFolders`
    wholesale (line 1257, `fs.existsSync`-filtered); `GET /api/config` at line 1220;
    `scanDirectories()` call site at line 1274. This is the C3/C7 blast radius.

## Decision 1 — C1: the download-scoping mechanism (THE decision)

**The bug:** `run.runDownload(sub, config)` downloads the WHOLE channel URL. The pure
filters `isArchived` / `shouldDeferPremiere` / `shouldSkip` only decrement/gate an integer
`survivorCount`, whose ONLY effect is `if (survivorCount === 0) return; else runDownload(entire channel)`.
So skip/defer decisions are **advisory** — they decide WHETHER any download runs, never
WHICH videos. `--download-archive` is the only bound on what yt-dlp actually fetches. Two
confirmed breaches:

- **(a) Premiere/live hang:** a channel with one public survivor A + one `is_live` video B
  → `shouldDeferPremiere(B)=true` so B is un-counted, but the whole-channel `runDownload`
  still fetches B (not archived) → yt-dlp records the live broadcast until
  `DEFAULT_DOWNLOAD_TIMEOUT_MS` (60 min) SIGKILL; the killed capture is never archived →
  recurs every cycle → because `runPoll` is sequential, that one sub wedges the whole poll
  loop ~60 min/cycle. **This is the exact hang poll-and-defer existed to prevent.**
- **(b) Members-only bypass (violates D2):** with a cookies file mounted but
  `allowMembersOnly=false`, `shouldSkip` marks the `subscriber_only` video `skip:true`, yet
  `cookiesArgs` attaches `--cookies` whenever the file EXISTS → the single whole-channel
  `runDownload` authenticates and downloads the members-only content the operator disabled.

**Your job:** pick and specify the mechanism that makes skip/defer **structurally binding
on the child process**. Options (coordinator's recommendation is **option 1**):

1. **(recommended) Per-survivor watch URLs.** Stop passing the channel URL to `runDownload`.
   Build explicit `https://www.youtube.com/watch?v=<id>` targets from the survivor id set the
   JS filters already produce, and pass those as the download targets (one invocation with N
   positional URLs, or per-id — you decide, weighing spawn count on a home server vs. failure
   isolation). A skipped members-only id or deferred premiere id is then simply never handed
   to yt-dlp. Composes with `--download-archive` for dedup. Ids are already constrained by
   `url.js` (`/^[A-Za-z0-9_-]+$/`, ≤64) so watch-URL construction is safe; keep the `--`
   separator + host-allowlist discipline. **Note `buildYtdlpDownloadArgs` currently takes the
   sub's `channelUrl` — this needs a signature/shape change to accept a target list; specify
   the new shape.**
2. `--match-filter` expression derived from the SAME rules. Declarative but must EXACTLY
   mirror the JS rules or drift; still a channel-wide crawl; harder to keep members-only +
   premiere logic in sync. **Not recommended (two sources of truth).**
3. `--playlist-items` by index — fragile (indices shift between list and download passes).
   **Reject.**

**Cookies-toggle interaction to resolve explicitly in your note:** confirm that public
surviving items may STILL attach `--cookies` (public items can need cookies for
age-gate/region — that's fine), while the toggle purely controls WHICH ids survive (it does,
via `shouldSkip`) — option 1 largely resolves breach (b) by never targeting a skipped id.
Keep the existing SF1 cookies-redaction discipline. Also decide whether C4 (below) —
`cookiesConfigured` should reflect file-EXISTS, not just path-set, sharing ONE
`fs.existsSync` helper with `cookiesArgs` — is a pure SDE fix or needs any shape guidance
from you.

## Decision 2 — reconcile C3 + C7 into ONE folder-registration approach

- **C3 (HIGH):** `downloadDir` is injected into the client-owned `db.folders` only once, by
  `ensureDownloadDirRegistered` at process start. `POST /api/config` (server.js:1226) rebuilds
  `db.folders` solely from the submitted array (line 1257) and wholesale-replaces it — any
  save omitting `downloadDir`, or made while the download volume is transiently unmounted,
  **evicts it** → the scanner skips the download tree → survivors never indexed (AC17 broken)
  until restart.
- **C7 (MEDIUM):** once enabled+registered, disabling the module never de-registers
  `downloadDir` (startBackground early-returns at line 504) → the core scanner keeps indexing
  it and `GET /api/config` keeps listing it → the "disabled == byte-identical to a
  never-enabled install" guarantee breaks; a folder the operator never knowingly added stays
  live with the feature off.

Both point at the same root cause: **the module injects its download root into the
client-owned `db.folders`.** Decide ONE approach and specify it. Lean toward the cleaner
option that resolves both at once — e.g. the scanner becomes aware of `downloadDir` via a
**module-owned path independent of `db.folders`** (so a `POST /api/config` save can't evict
it and disabling structurally removes it), OR keep `db.folders` injection but re-register
defensively before each post-download scan AND de-register on disabled startup. Whatever you
pick must preserve: (i) the disabled path stays byte-identical to a never-enabled install;
(ii) `GET /api/config` must not surface a module folder the operator never added when the
module is off; (iii) no change to the existing scanner's per-folder semantics; (iv) all
writes still go through the single serialized `updateDatabase` writer. If your approach
touches `server.js` core scan/config code, keep it minimal + additive and call out exactly
which anchors change.

## What to produce (design only — do NOT write code or tests)

1. Append a **## T4 Fix-Round Design Note** section to
   `docs/exec-plans/active/2026-07-05-yt-dlp-integration-module.md` containing:
   - The chosen C1 mechanism, WHY, and the concrete `buildYtdlpDownloadArgs` (and any
     `runDownload`) **signature/shape change** — enough for the SDE to implement without
     re-deciding. Include how survivor ids flow from the JS filters into the target list, and
     how it composes with `--download-archive`.
   - The cookies-toggle resolution (public survivors keep cookies; skipped ids never target;
     C4 file-exists helper guidance).
   - The single reconciled C3+C7 folder-registration approach, with the exact server.js /
     index.js anchors that change and the invariants it preserves.
   - A short "leave intact" list: the parts both reviewers confirmed SOLID — no lock held
     across the download await, no unhandled rejection, SF1 status redaction, disabled ==
     provable no-op — so the SDE doesn't churn them.
   - A one-line note on each of C2, C5, C6 confirming they are pure SDE fixes needing no
     design input (or flag any that do).
2. Update `docs/ARCHITECTURE.md` ONLY if the folder-registration mechanism changes how the
   scanner discovers the download tree (new module-owned path, etc.).
3. Do NOT implement. Do NOT touch `lib/ytdlp/*.js`, `server.js`, or any test file.

**If your C1 decision diverges from option 1**, say so explicitly and state the tradeoff —
the coordinator needs to flag it to Dean before implementation proceeds.

Environment note: any `node`/`npm` command in this repo needs
`export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`
first (fnm is not auto-sourced) — though this is a design task, so you likely won't run the
suite.
