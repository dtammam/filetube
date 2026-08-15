# Wave A (v1.127): bulk-route RBAC bypass + schema rollback floor

Status: PLANNED 2026-08-15 (Dean approved scope + approach; authored by the
Fable session that verified every claim below against the tree/git - an Opus
session can execute this plan without re-deriving the analysis).

Origin: external static review round 2 (v1.122 vs v1.126 comparison). The two
HIGH findings below were independently verified in-session on 2026-08-15.
Dean's decisions at intake: (1) rollback floor, NOT a data migration;
(2) secret rotation CONFIRMED done on his server - close its debt entry here.

## Verified facts (do not re-litigate; re-verify mechanically if the tree moved)

F1. `POST /api/videos/attribute-channel-bulk` (server.js:15458) gates on
    `requireModifyLibrary` only. Its `selectWork` iterates
    `Object.values(db.metadata)` filtered only by `matchRootFolder` - NO
    `mediaVisibleTo`. Preview returns matched/resuming counts + destinationDir;
    execute rewrites attribution and (relocate:true) MOVES files. A member with
    modify-library capability but path/folder restrictions can therefore
    preview, rewrite, and physically relocate media hidden from them.

F2. The forcing net `test/integration/route-write-classification.test.js`
    classifies that route AND the whole `repull-metadata` family as
    `visibility: 'n/a'` (lines ~279-308). The net built to prevent this class
    contains an allowlist of exemptions covering exactly the vulnerable
    routes - the v1.123 "forcing net must be a denylist" lesson, violated by
    the net itself.

F3. v1.126 added `folderDisplayNames` to SINGLETON_NAMES (lib/db/sqlite.js:~86)
    while SCHEMA_VERSION stayed 17. v1.122's `load()` ingests EVERY doc_single
    row by name (`setPath(db, row.name, ...)` - confirmed via
    `git show v1.122.0:lib/db/sqlite.js`, load() ~line 766) and its `save()`
    calls `assertNoUnknownKeys()` which THROWS on unknown top-level keys
    (~line 789). Consequence: run v1.126 once, downgrade to v1.122 -> boots and
    reads, but EVERY durable write fails. Bumping SCHEMA_VERSION now cannot
    repair released v1.122 (its check `current >= SCHEMA_VERSION` merely skips
    migration; it never refuses).

F4. `migrateSchema` (current sqlite.js:269) accepts any `user_version >=
    SCHEMA_VERSION` silently - a FUTURE database is accepted rather than
    refused. Same class as F3 pointed forward.

F5. The adapter full-shape fixture in test/*db-sqlite-adapter* omits
    `folderDisplayNames`.

## Non-goals

- No data migration of folderDisplayNames (Dean's explicit call). The fix for
  F3 is a documented rollback floor + F4's forward strictness so the class
  cannot recur.
- Metadata/read-surface leaks (config, queues, duplicates, book folders) are
  Wave B, not here. Do not scope-creep.

## Task commits (each with its tests, each green before the next)

### T1. Visibility-filter the bulk attribution route

- In `selectWork` (or at its call sites), include an item only if
  `mediaVisibleTo(req, item)` passes. Both `toAttribute` and `toResume`.
  Preview and execute share the selector, so both are fixed at once.
- The post-response async move loop re-loads items by id. `req` is gone by
  then; capture the requester's visibility verdict at selection time (the
  moveIds list is already the captured post-filter set) and RE-CHECK at move
  time with a captured per-user predicate (build a closure over the user's
  restriction descriptor before responding - do NOT hold `req` itself).
- Tests (new file or extend test/integration/rbac-write-enforcement.test.js):
  a capable-but-RESTRICTED member (path-restriction AND allowlist mode - the
  v1.126 lesson: folder-kind-only tests passed while the PATH-kind bug was
  live) with one visible + one hidden item under the SAME root:
  - preview `matched` excludes the hidden item;
  - execute mutates only the visible item's attribution;
  - relocate moves only the visible file; the hidden file's path+mtime are
    byte-identical after (filesystem non-mutation, the podcast-RBAC pattern);
  - mutation-check: with the visibility filter deleted, these tests go red.

### T2. Visibility-filter the yt-dlp library-wide repull/reheat

- The routes live in the ytdlp module (deps-injected; see server.js:16371 and
  lib/ytdlp/index.js). FIRST machine-verify the reviewer's claim: confirm the
  enumeration in `buildImportRelocationPreview` / the repull executor iterates
  global `db.metadata` with no visibility filter, and that
  `requireManageSubscriptions` (a member-grantable capability) is the only
  gate. If confirmed, apply the T1 treatment: filter enumeration by the
  requester's visibility; preview must not emit paths/counts for hidden items;
  executor re-checks before touching a file. If the route turns out
  admin-only in practice, say so in the commit message and downgrade the fix
  to a test binding that invariant.
- Same test shape as T1 (restricted member, visible+hidden, preview + execute
  + filesystem non-mutation).

### T3. Rebuild the forcing net's n/a class as a denylist

- New rule, enforced by the net itself: a route classified `'n/a'` must not
  read or write per-item content stores. Mechanical binding: the net extracts
  each n/a route's handler source (it already parses the route table) and
  FAILS if the handler (or its named module entry point) references
  `db.metadata`, book/music/podcast item stores. Routes that legitimately
  touch items get reclassified `enforced` (with a real visibility test) or
  `personal`.
- Reclassify at minimum: `attribute-channel-bulk`, `repull-metadata`,
  `repull-metadata/preview`. Sweep the remaining n/a list (lines ~279-330)
  against the new rule and reclassify anything else it catches - the plan
  predicts zero others but the TEST is the authority, not this sentence.
- Order matters: land T3 AFTER T1/T2 so the net proves closure (it must fail
  if T1/T2 were reverted - verify by mutation before committing).

### T4. Schema strictness + version bump

- `migrateSchema`: THROW (clear message naming both versions and the rollback
  floor) when `user_version > SCHEMA_VERSION`. Loud refusal, never silent
  acceptance.
- Bump SCHEMA_VERSION 17 -> 18 with an APPEND-ONLY no-op migration block
  (memory lesson: editing an executed block hangs the suite - append, never
  edit). Purpose: any future namespace addition now has a version signal, and
  v1.127+ instances refuse databases from a future they don't understand.
- Add `folderDisplayNames` to the adapter full-shape fixture (F5).
- Tests: v17 db migrates to 18 and round-trips; a v19 db is REFUSED with the
  message; the refusal happens before any write. A runnable downgrade repro
  for the gate: extract `git show v1.122.0:lib/db/sqlite.js` to scratch, point
  it at a v1.127-written db file, show save() throwing (this is the
  adversarial seat's demand-a-repro artifact; keep it in scratch, not the
  suite - the suite can't depend on git history).

### T5. Docs + debt ledger

- RELEASING.md + ARCHITECTURE.md: document the rollback floor ("databases
  written by >= v1.126 are not writable by <= v1.125; never downgrade across
  it") and the new rule: ANY new persisted namespace = SCHEMA_VERSION bump in
  the same commit.
- tech-debt-tracker.md: CLOSE the session-secret rotation entry (Dean
  confirmed rotation + re-login complete, 2026-08-15). Add an entry for the
  folderDisplayNames basename-collision residual (two roots sharing a folder
  basename share one display name; a visible sibling grants rename over the
  shared label) with revisit trigger "a second root with colliding channel
  folder names actually exists".
- ROADMAP.md v1.127 entry at release time, honest about origin (external
  review round 2 caught what the v1.123 audit missed).

## Gate

FULL gate (file moves = data-loss class, never slim). Adversarial brief must
name: (a) mutate/probe hidden media as a restricted member through EVERY
n/a-classified route, not just the two fixed ones; (b) the downgrade repro
(T4) run live; (c) mutation-test T1/T2 bindings (delete the filter, watch
red); (d) the T3 net's own blind spots (can a handler reach db.metadata via a
helper the source-scan misses?). Two-round pacing norm applies.

## Release

Standard ceremony (CLAUDE.md). Dual-Node sequential suites. Device probes for
Dean: none required for this wave beyond normal smoke (the fixes remove
capability; nothing user-visible changes for unrestricted accounts). Explicitly
disclose in ROADMAP: rollback floor now exists.
