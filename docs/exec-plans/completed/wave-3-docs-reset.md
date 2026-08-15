# Wave 3: documentation reset (v1.125.0)

Status: SHIPPED v1.125.0 (2026-08-15; see ROADMAP.md). Gate round 1 findings applied and re-verified. Final count:
**41 files corrected** - 29 via the original keyword regex, 4 via the stronger
first-Status-line check, and 8 MORE the gate caught using the all-caps
`STATUS:` spelling with `DESIGNED`/`EXECUTING` keywords (the repo's
divergent-spelling survivor class - the sweep instrument was case-sensitive;
gate W1). Every version machine-verified against ROADMAP first. THE METRIC
(restated per gate W1/S2): the first `status:` line of every completed/ plan,
matched CASE-INSENSITIVELY, must contain SHIPPED|COMPLETED|CLOSED (the
terminal set; DESIGNED/EXECUTING/ACTIVE/DRAFT/planned/in-progress are
non-terminal) - now holds at ZERO violations. Gate W2: the first archive
banners carried hand-written WRONG version anchors (subscriptions "v1.29+",
one-offs "v1.39+"); corrected to measured anchors (lib/ytdlp born v1.11.0 by
tag-contains; reliability hardened v1.29.0; universal one-offs v1.41.13) -
a truth-reset wave writing new false history is the inverted form of the
hazard it fights. T2: 3 plans archived (2 false-future ytdlp + the shipped
shimmer-sweep audit input); future/ now means genuinely-unbuilt. T3:
ARCHITECTURE.md rewritten (250 lines) off the db.json era, grounded in a
fresh whole-tree survey; remaining db.json mentions are legacy-framed only.
T4 (generated route inventory) SKIPPED per this plan's own if-cheap clause -
the live route table is already machine-enumerated by the forcing-net tests.
D4 honored: QUALITY_SCORE.md untouched (owner-frozen header; Dean has not
asked). Originally grounded at `aa06fa2` (v1.122.0). Chosen over the review's items
6/7/9/10 (architecture extraction, typed contracts, observability, product
narrowing) because it is CHEAP and directly de-hazards future agent sessions -
which the review correctly named the single biggest AI-specific risk. Items
6/7/9/10 remain un-adopted, each needing its own intake with Dean.

Origin: the external review's items 8 (docs) and the AI-usage note that "stale
plans and authority documents make the repository's AI knowledge base
hazardous: future agents can confidently follow obsolete information." Every
count below was MACHINE-DERIVED and is stated as a prediction the wave
re-verifies, per the CLAUDE.md measurable-plan rule.

## Verified findings

- **D1 - `docs/exec-plans/completed/` carries stale in-body statuses.**
  99 files in `completed/`; `grep -l -iE "status.*(active|in.progress|
  pending|proposed|planned|not.started)"` matches 37 of them - plans that
  SHIPPED but still read "ACTIVE"/"pending" in their body. A future agent
  grepping for active work gets 37 false positives that look authoritative.
  (Re-derive both counts at implementation time - they drift as waves ship.)
- **D2 - `future/` holds a shipped feature.** `docs/exec-plans/future/`
  contains `yt-dlp-integration-module.md` and `metube-yt-dlp-sync.md`, both
  marked "Parked / do NOT start" and dated 2025-07 - but `lib/ytdlp/` is a
  large, shipped subsystem (index/pending/progress/rules/failures/...). The
  "future" framing is now false; these are archaeology.
- **D3 - `ARCHITECTURE.md` predates the SQLite migration.** It describes the
  store as `db.json` throughout (`:20,30,84,112,115,137,160`) though the app
  migrated to `node:sqlite` (`filetube.db`) at v1.42. The auth wall (v1.43),
  users/RBAC, books/music/podcasts places, and Modern mode are absent or
  under-described. A new agent reading it builds a wrong mental model.
- **D4 - `QUALITY_SCORE.md` is owner-maintained and frozen.** Its header bans
  agent edits without Dean's explicit per-instance request. It must NOT be
  rewritten by this wave; it is RENAMED/relocated only if Dean asks. Noted here
  so the implementing session does not "helpfully" update it (a contract trap).

## Tasks (each its own commit, each green before the next)

- **T1 - correct stale completed-plan statuses.** For every `completed/` file
  whose body still claims an in-flight status, set a terminal status line
  (`Status: SHIPPED <version>`), derived from the file's own content / git
  history - NOT hand-guessed. Mechanical, high-volume; the count is the D1
  prediction and the commit records the measured before/after.
- **T2 - archive the false-future plans.** Move `future/*.md` to an
  `archive/` (or annotate them "SUPERSEDED - shipped as lib/ytdlp/") so
  `future/` means "genuinely not built". No source change.
- **T3 - rewrite `ARCHITECTURE.md` around the current system.** SQLite store +
  WAL, the auth wall + per-user RBAC/restrictions, the four media places, the
  scan/transcode/thumbnail pipeline, the SPA `#view-root` router, and the
  client controller split. Anchor claims to real files. This is the one
  substantive-prose task; the rest are mechanical.
- **T4 - a generated route inventory (optional, if cheap).** A small script
  that dumps the live Express route table to `docs/generated/routes.md`, so the
  route list is machine-truth, not prose that rots. Reuses the same table the
  Wave 1 forcing net already walks. Skip if it balloons scope.

## Machine-derived predictions (re-verified at every commit)

- D1 stale count: `grep -l -iE "status.*(active|in.progress|pending|proposed|
  planned|not.started)" docs/exec-plans/completed/*.md | wc -l` (37 at
  `aa06fa2`). T1 drives it to 0.
- D3 db.json references in ARCHITECTURE.md:
  `grep -c "db.json" docs/ARCHITECTURE.md` (8 at `aa06fa2`). T3 replaces each
  with the accurate SQLite description (some may legitimately remain as
  historical notes - the point is no CURRENT-STATE claim says db.json).

## Gate

SLIM gate (docs-only, no data at risk, no runtime behavior touched - the
CLAUDE.md slim-gate lane for docs/minor batches). Adversarial seat verifies the
mechanical status edits did not corrupt any file and that ARCHITECTURE.md's new
claims match the actual tree (spot-check the file anchors).

## Stop condition

Adversarial seat APPROVES; D1 count at 0; ARCHITECTURE.md carries no stale
current-state claim; `future/` holds only genuinely-unbuilt plans. Suites are
untouched by docs (still run dual-Node to confirm green). Then release ceremony
(docs-only, likely a patch bump or folded into the next wave per Dean's call),
plan to `completed/` - correctly statused, this time.
