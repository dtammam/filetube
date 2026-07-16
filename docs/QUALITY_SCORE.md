<!-- Maintained by Dean. Populated 2026-07-16 by the working agent at Dean's
     EXPLICIT direction (v1.41.11 wave intake, overriding the previous
     "humans only" rule for that one request). Future agents: do NOT modify
     this file again without Dean's explicit, per-instance request. -->

# Quality Score

Grades each domain by architectural layer. Updated periodically.
If a grade is C/D/F, the next action must be concrete.

Graded 2026-07-16 (v1.41.11) from the shipped evidence: the ROADMAP release
history, `docs/exec-plans/tech-debt-tracker.md` (25 open items), the recurring
bug classes the gates have caught, and the test suite (4,200+ tests, 157 unit
+ 100 integration files, run on Node 22 + 24 for every release).

| Domain | Types | Repo | Service | Runtime | UI | Tests | Overall |
|--------|-------|------|---------|---------|-----|-------|---------|
| Media streaming & transcoding | C | C | B | B+ | B | B+ | **B** |
| Library scan & db.json persistence | D | C | B | B | — | B+ | **B-** |
| Delete & file integrity (tombstones) | C | C | B+ | B+ | B | A- | **B+** |
| yt-dlp subscriptions & downloads | C | B | B | B | B | B | **B** |
| Books & TTS | C | B+ | B | B | B | B | **B** |
| Player (web client) | C | C+ | B | B | B- | C+ | **B-** |
| SPA shell & views | C | C+ | — | B | C+ | C+ | **C+** |
| Stats & reporting | C | B+ | B+ | B+ | B | B+ | **B+** |
| Security & multi-user readiness | — | — | D | D | — | — | **D** |
| Build, test & release engineering | — | B+ | — | — | — | A- | **A-** |

## Grading scale

- **A:** Exemplary. No known issues.
- **B:** Good. Minor issues, no blockers.
- **C:** Needs work. Known gaps that should be addressed soon.
- **D:** Problematic. Active risk to reliability or velocity.
- **F:** Critical. Must be addressed before new feature work.

## Rationale (the honest version)

- **Types (C/D across the board):** deliberately plain JavaScript — there is
  no machine-checked typing anywhere. The mitigation is unusually thorough
  contract comments and lock tests, and it mostly works — but the db-item
  shape has NO single authoritative definition, and that exact gap is the
  repo's most-repeated bug class: the persist-gate/stale-snapshot class has
  struck **six times** (a new per-item field silently dropped by one of five
  merge/carry-forward sites). That is a type-system problem paid for in gate
  rounds. Scan & persistence gets the D; everywhere else the comment
  contracts earn a C.
- **Repo (C for server-side domains):** `server.js` is a ~9,900-line
  monolith. It is well-commented and the newer subsystems (`lib/ytdlp`,
  `lib/books`, `lib/stats`) are properly extracted with deps-bundle seams —
  but streaming, scan, delete, player-serving, and settings all still live in
  one file, and every gate reviewer pays the navigation tax. Client side:
  `player.js` (~5k lines) and `common.js` (~6k) carry the same weight.
- **Delete & file integrity (B+, best server domain):** three hard-won
  releases (v1.41.3 tombstones, v1.41.9 divergent-spelling root fix,
  v1.41.10 DELETE_PENDING/fd-leak) each survived an adversarial gate that
  found real data-loss CRITICALs, and the tests now replay those exact
  repros (mutation-tested). History says this class recurs, which is why it
  isn't an A — but it is the most battle-verified code in the repo.
- **Player UI (B- overall, C+ tests):** functionally strong (background
  audio, chapters, captions, faux-fullscreen, lock-screen integration are
  all battle-won), but the CSS cascade is fragile in known ways — the
  `#view-root` SPA style-loss class (tech-debt #34) and the iOS-specific
  traps have each caused multiple shipped regressions that only Dean's
  on-device pass caught. There is no real-browser automation; UI tests are
  source-locks + jsdom smoke, which cannot catch layout/cascade regressions.
- **SPA shell & views (C+, lowest non-security grade):** the router's
  "swap only `#view-root`" contract keeps biting (three shipped bugs in this
  class; #34's `.sub-*` slice is still latent), and shell/view lifecycle
  wiring (AbortController per view, persistent player host) is subtle enough
  that every new surface needs the lesson re-applied.
- **Security & multi-user (D, by design — for now):** no authentication, no
  authorization, no rate limiting; the trust model is "LAN + reverse proxy".
  Unauthenticated 500s used to leak stack traces (fixed v1.27); inputs are
  handled carefully, but the posture is single-trusted-user only. This is a
  *known, planned* gap: the v1.42–v1.44 multi-user tranche (SQLite → auth →
  RBAC) is intake-locked with an adversarially-reviewed exec plan.
- **Build/test/release (A-):** dual-Node suites on every release, a
  two-reviewer adversarial gate with delta re-confirms, quality gates in
  pre-commit/pre-push hooks, honest release notes with disclosed residuals.
  Docked a notch for the two documented full-suite-load flakes and the lack
  of CI-enforced gating (the process is discipline, not automation).

## Action items

<!-- For any C/D/F grade, list the specific next step here. -->

- **Scan/persistence Types (D):** define the db-item shape ONCE — a
  `normalizeItem()`/schema module every writer (scan re-init, Phase-2 merge,
  persist-gate OR-chain, final-merge gap-fill, terminal writes) must pass
  through, so a new field is added in exactly one place. This retires the
  six-strike persist-gate class structurally instead of by checklist. Good
  candidate to fold into the v1.42 SQLite migration (which already forces a
  schema definition).
- **Security & multi-user (D):** execute the prepped v1.42 tranche
  (docs/exec-plans/active/v1.42-multiuser-tranche.md) — read the plan first;
  db.json is read-only at migration, WAL-sidecar rename trap documented.
- **SPA shell & views (C+):** finish tech-debt #34 (relocate the remaining
  `.sub-*` page-local styles into style.css); adopt the "markup inside
  `#view-root`, styles in style.css" rule as a lock test for NEW views the
  way reloc-preview-mount.test.js does for the preview modal.
- **Player/UI tests (C+):** evaluate one real-browser smoke lane
  (Playwright against the five shells' boot + player mount) to catch the
  cascade/layout class that source-locks structurally cannot; keep Dean's
  on-device pass as the arbiter it already is.
- **Repo layout (C):** when a server domain is next touched for a feature,
  extract it to `lib/` behind the same deps-bundle seam the books/ytdlp
  modules use (streaming/`sendRangeable` + the delete flow are the ripest —
  both now have dense test coverage to make the move safe).
- **Types elsewhere (C):** low-cost first step — `// @ts-check` + JSDoc
  typedefs on NEW lib/ modules only; no repo-wide conversion.

## History

- **2026-07-16 (v1.41.11):** initial population, at Dean's explicit request.
