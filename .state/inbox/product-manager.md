# Product Manager — Discovery brief

## Feature
**Optional yt-dlp subscription integration module** for FileTube. Target release **v1.11.0**.
Feature id: `yt-dlp-integration-module`.

This is a big, multi-task feature. Your job in this Discovery stage is to produce
crisp **requirements + acceptance criteria**, seed a new active exec plan, and
frame the genuine **open-question forks** for Dean to decide before design.
Do NOT design the implementation and do NOT write code.

## Read first (in this order)
1. `docs/exec-plans/future/yt-dlp-integration-module.md` — the parked design vision + the architect's take. This is the primary source; base your plan on it.
2. `.state/feature-state.json` — the captured constraints, decided architecture, security flags, and the 5 open questions (in `open_questions_to_relay_to_dean`).
3. `docs/CONTRIBUTING.md` — coding/testing standards (Node 22, `node:test`, `npm test`, ESLint 0 errors, additive/zero-regression, every feature ships with tests, keep FFmpeg/binaries out of the core suite).
4. `docs/ARCHITECTURE.md` — system context. Note especially: the v1.9.0 `updateDatabase(mutatorFn)` serialized-writer primitive (one source of truth for `db.json`), the `armScanTimer()` settings-driven `.unref()`'d poll model, `db.settings`, and the existing scan -> index -> UI pipeline.
5. `docs/RELIABILITY.md` — spawn calls wrapped in try/catch and degrade gracefully (never crash), plain console logging, keep binary-dependent paths out of the automated suite.

## THE #1 HARD CONSTRAINT — thread it through EVERY requirement and AC
**OPTIONAL / ADDITIVE / MUST-NOT-DEGRADE.** When the feature is **DISABLED (the
default)**, FileTube must behave **BYTE-IDENTICALLY to today**:
- no new routes registered,
- no background job started,
- no subscriptions UI shown/served,
- no assumption that yt-dlp is installed/available,
- the existing **241-test suite stays green with zero behavior change**.

Enabling it is **purely additive**. There MUST be an explicit acceptance
criterion (and a called-out test/verification) that **the disabled path is a
no-op** — a byte-identical behavior guarantee, not "looks fine." This is the
acceptance north star. Every AC must respect it.

## Architecture is DECIDED (do not relitigate — these are givens, not options)
- Optional, **dormant-by-default, IN-PROCESS module** inside FileTube (NOT a standalone service — that reintroduces the two-systems/orphan problem Dean is escaping).
- yt-dlp is **bundled in the container** (reusing the FFmpeg it already ships), but the module stays dormant unless enabled via ENV. Pin a yt-dlp version; keep updating it straightforward (the PE decides pip vs binary at design).
- Subscription config persists in **`db.json` via the v1.9.0 serialized `updateDatabase` primitive** (one source of truth).
- Downloads land in a media folder the **existing scanner indexes** -> they appear in the normal UI -> deleting in FileTube removes them everywhere (no orphans).
- **Dedup via yt-dlp's built-in `--download-archive`** (MeTube did not use one — that was a source of its orphan problem).
- **Premiere handling via POLL-AND-DEFER** (a poll that finds a premiere still inside its release+~2h window skips it that cycle; a later poll grabs it) — NOT a live per-video timer. Restart-safe, idempotent (the archive prevents dupes). Lesson from v1.9.0 deferred-rescan work.
- **Members-only skip as an ISOLATED, easily-updatable `shouldSkip(videoMeta)` rules layer** (config-driven, not hardcoded deep in the guts — YouTube changes this over time). **FAIL SAFE**: on uncertainty, skip + log, never grab the wrong thing. Prefer yt-dlp structured availability metadata over string-matching error text where possible.
- Members-only auth via yt-dlp **`--cookies` file** (NOT username/password, which mostly fails for YouTube now). Without creds, members-only content is **skipped** (fail-safe).

## SCOPE — keep it LEAN (this is what Dean values from MeTube; do NOT rebuild MeTube)
1. Subscribe to a channel by URL; unsubscribe / delete a channel/subscription.
2. Per-channel **AUDIO-ONLY vs VIDEO** (chosen per subscription).
3. Per-channel **QUALITY**, default **"best"** for all.
4. **Re-pull ALL** subscriptions, or **a single** subscription, on demand (manual trigger) — PLUS the scheduled background poll.
5. **Dedup** via `--download-archive` (skip already-pulled).
6. **Skip members-only** content as a **TOGGLE (default: skip)**, via the isolated fail-safe rules layer.
7. **Premiere handling**: defer premiered videos ~2h via poll-and-defer.
8. A **SIMPLE subscriptions UI**: list subs, add by URL with audio/video + quality, delete, re-pull-all / re-pull-one buttons, show last-checked/status. Placement (Settings vs dedicated page) is an open question for the PE — but it MUST be **completely absent/inert when the feature is disabled** (additive).

## ENV PARAMETERS to document (finalize exact names with Dean/PE)
Dean wants the "optional yt-dlp ENV parameters" documented (README / `.env.example`):
- a **master enable flag** (e.g. `FILETUBE_YTDLP_ENABLED`, default off),
- an optional **cookies-file path**,
- an optional **poll interval**,
- an optional **download root**,
- an optional **pinned yt-dlp version**.

## SECURITY (must be reflected in requirements/ACs; the PE will own the mechanics at design)
- Spawns yt-dlp as a **child process with user-provided channel URLs** — NEVER shell-interpolate. Use `execFile`/`spawn` with an **argument array** (no `shell:true`).
- **Validate/normalize** subscription URLs (allowlist expected channel URL shapes; reject the rest, fail-safe).
- **Constrain the download path** so a subscription can't write outside the media dir (path-traversal guard).
- Cookies/creds: **never log them**; treat the ENV as a path to a mounted **read-only** file; **no secrets in db.json**.

## Testability expectations (bake into ACs)
Extract **pure, unit-testable helpers** so they are `node:test`-covered without invoking real yt-dlp/network:
- URL parse/validate,
- the yt-dlp **arg builder** (format audio/video + quality),
- the **`shouldSkip`** rules,
- the **premiere poll-and-defer decision** (release_timestamp + 2h window),
- **dedup/archive** logic.
Mock/integration-test the process invocation itself. Do NOT require real yt-dlp or network in the automated suite (mirror how FFmpeg is kept out).

## OPEN QUESTIONS to frame CRISPLY for Dean (state each as a genuine fork with a recommended default)
The EM will relay these to Dean before we commit to a design. Frame each with the trade-offs and a recommended default:
1. **Exact enable mechanism + full ENV param set** — confirm master flag name and the complete set/names of the optional ENV params above.
2. **Creds/cookies handling + members-only default** — confirm cookies-file mechanism, read-only mount, and skip-members-only-by-default; confirm no-creds => members-only skipped (fail-safe).
3. **UI placement** — Settings section vs dedicated page.
4. **Download folder structure + how "re-pull" interacts with `--download-archive`** — per-channel folder layout; does "re-pull single/all" only fetch NEW items (archive respected) or can it force re-fetch of archived items; what does deleting a video in FileTube do to the archive entry (re-downloadable vs stay-skipped).
5. **yt-dlp bundling/update strategy in the Dockerfile** — pip vs static binary, version pinning, and slim-base vs bundled-in-container (Dean leans bundled-in-container since FFmpeg already ships).

## Deliverables (produce these)
1. Create a NEW active exec plan at **`docs/exec-plans/active/2026-07-05-yt-dlp-integration-module.md`**, based on the future/ vision doc. Include: Goal, In-scope, Out-of-scope (explicitly: NOT a MeTube rebuild, NOT a full download manager), Constraints (lead with OPTIONAL/ADDITIVE/NO-DEGRADE), Functional requirements, Non-functional/security requirements, Testability requirements, and a numbered **Acceptance Criteria** list.
2. Tag EVERY acceptance criterion with exactly one of **[UNIT]**, **[INTEGRATION]**, **[MANUAL]**, **[PROCESS]** (lint/build/tests-green), so they map cleanly to test/verification work later. Make ACs verifiable/explicit (each pass/fail checkable). Include the mandatory **disabled-path-is-a-no-op** AC and the security ACs (no shell interpolation, path-traversal-safe, creds-never-logged).
3. Cross-check: nothing in Out-of-scope may conflict with `docs/CONTRIBUTING.md` mandatory standards (tests-with-every-feature, lint 0, additive/zero-regression).
4. In the exec plan, add an **## Open Questions** section with the 5 forks framed for Dean (trade-offs + recommended default each).
5. Update `.state/feature-state.json`: set `artifacts.requirements` and `artifacts.exec_plan` to `docs/exec-plans/active/2026-07-05-yt-dlp-integration-module.md`.

## Do NOT
- Do NOT design the technical solution (that's the PE's Design stage next).
- Do NOT write application code or tests.
- Do NOT move the vision doc out of `future/` — leave it in place and create the new active plan.
- Keep requirements product-level (what/why + testable AC); the HOW (module layout, exact arg-builder, Dockerfile mechanics, pure-fn homes) is the Principal Engineer's Design stage.

When done, report the requirements + acceptance criteria summary and the 5 open questions so the EM can relay the genuine forks to Dean.
