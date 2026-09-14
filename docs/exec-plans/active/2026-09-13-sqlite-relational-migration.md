# Exec plan: retire the document model, relationalize the store, thin the monolith

- **Created:** 2026-09-13
- **Status:** ACTIVE (intake agreed with Dean 2026-09-13; Wave 0 in flight 2026-09-13)
- **Owner:** main session (lean mode)
- **Baseline commit:** `963f0ca2` (v1.289.0), `schema user_version = 20`

---

## 0. Why this exists (the corrected diagnosis)

The v1.42 migration to SQLite succeeded: `filetube.db` **is** the single physical
source of truth. `db.json` the file is a one-time import seed - read once at first
boot only if `filetube.db` is absent, then left "byte-for-byte untouched forever" as
a rollback net. It is **not** a live parallel store. (An earlier readout claimed it
was; that was wrong.)

What actually survives is **two data *models* inside the one SQLite file**:

1. **The legacy document model** - tables `doc_kv` (per-key rows) and `doc_single`
   (whole-blob rows) hold the entire old `db` mega-object, preserving "the exact
   object shape db.json produced." `server.js` still does
   `loadDatabase()` -> assemble the whole object -> mutate -> `saveDatabase(db)`.
   **This is the "JSON" that remains: not a file format, but a programming model**,
   and it is the direct cause of the persist-gate / stale-snapshot bug class (every
   new field needs a backfill + carry-forward + merge guard + a namespace-lock entry).
2. **The modern relational model** - real per-user tables (`user_progress`,
   `user_music_liked`, `notifications`, `user_queue`, ...). These are clean and are
   NOT in scope except as the pattern to copy.

The finding that reframes the whole arc: **`server.js` is 19,041 lines *because* it
hosts the document model** (assembly, backfill, the scan, move/trash/restore). Retire
the document model and three of Dean's goals collapse into one arc:

- **"No comment debt"** - already effectively true (see Wave 0); the 9 grep hits are false positives.
- **"Remove all trace of JSON"** - = migrate the 32 document-model namespaces to relational tables + retire the `db.json` file.
- **"server.js to player.js quality"** - = the same migration sheds the weight, then a teardown wave splits the rest.

**Goal:** one physical store, one data model (relational, feature-owned stores like
`lib/music`), a thin composition-root `server.js`, honest-zero comment debt, and the
`db.json` import path gone - with **zero data loss on Dean's real library**, proven
by his device pass at every release.

---

## 1. Machine-derived baseline (predictions the tools re-verify every commit)

Every number below is a **prediction re-derived by a command**, never hand-counted.
Re-run these at each wave commit; a drift is a finding. Since Wave 0 one command
re-derives the whole table: `node scripts/relational-arc-baseline.js --pretty`
(the marker floor is enforced by `test/unit/comment-debt-census.test.js` + eslint's
`no-warning-comments`, not printed).

| Metric | Baseline (2026-09-13, `963f0ca2`) | Command to re-derive | Target at Wave 7 |
|---|---|---|---|
| `server.js` lines | **19,041** | `wc -l < server.js` | **< 3,000** |
| `doc_kv` namespaces | **13** | `DOC_KV_NAMESPACES.length` in `lib/db/sqlite.js` | **0** (table dropped) |
| `doc_single` namespaces | **18** (the intake draft said 19 - a hand count; Wave 0's re-derivation corrected it) | `SINGLETON_NAMES.length` in `lib/db/sqlite.js` | **0** (table dropped) |
| Total legacy namespaces | **31** | sum of the two | **0** |
| Genuine TODO/FIXME/HACK markers | **0** (the intake draft's "9 grep hits are false positives" was not reproducible from a recorded command - the slim gate found the only 9-yielding grep counts 2 binary PNG matches and misses the `\XXXX` lines the draft cited; the pre-Wave-0 shipped-code prose hits are in commit `36a40a77`) | enforced, not printed: `test/unit/comment-debt-census.test.js` (TIER 1 marker-form over every tracked code file, TIER 2 loose word over shipped code) + eslint `no-warning-comments` | **0**, lint-enforced since Wave 0 |
| `db.json` refs in shipped code | **15 files** (`server.js`, `lib/db/sqlite.js`, `lib/ytdlp/*`, `scripts/*`) | `node scripts/relational-arc-baseline.js` (`dbJsonRefFiles`; the script excludes itself - its labels name the file) | **0** |
| Test cases | **8,310** across **657** files | `git ls-files 'test/*.js' \| xargs grep -hoE '^\s*(test\|it)\(' \| wc -l` | net-add; ratio stays >= 1.48:1 |
| Full suite | green on **both** Node 22.23.1 + 24.14.0 | `npm test` on each | green each release |

### The 31 legacy namespaces (the migration backlog)

`server.js` consumer counts (`grep -oE "db\.<ns>\b" server.js | wc -l`) drive the
sequencing - low blast radius first, `metadata` last.

**`doc_kv` (13, per-key rows):** `metadata` (172 refs / 284 rows on dev box),
`progress` (19 / 7), `deleteTombstones` (12), `viewCounts` (11), `trash` (33),
`books.items`, `books.progress`, `books.audio`, `music.tracks`, `podcasts.episodes`,
`tv.episodes`, `ytdlp.downloadMeta`, `ytdlp.channelAvatars`.

**`doc_single` (18, whole-blob rows):** `folders` (39), `folderSettings` (10),
`folderDisplayNames` (22), `settings` (48), `liked` (12), `books.folders`,
`books.settings`, `books.pins`, `music.folders`, `music.settings`, `music.channels`,
`podcasts.subscriptions`, `podcasts.settings`, `tv.folders`, `tv.settings`,
`ytdlp.subscriptions`, `ytdlp.pins`, `ytdlp.allowMembersOnly`.

**Extraction-target giant functions** (`server.js`, the monolith weight):
`runScanDirectories` (L4071, **1,533 lines**), `moveItemToFolder` (L13295, 553),
`trashItem` (L13930, 306), `restoreTrashItem` (L14376, 226), `recordRepulledItemMeta`
(L16045, 203), `planImportRelocation` (L15123, 176), `validateBackupBundle` (L9913,
172), plus `loadDatabase`/`saveDatabase`/`updateDatabase` (L504-681, ~180).

---

## 2. Risk posture

**Honest verdict: feasible, genuinely risky, not reckless - because it is incremental
and the crown jewel is recoverable.**

- **This is the destructive-work gate norm's reason to exist.** Every wave that holds
  data a user can lose gets the **FULL** gate, never slim; the adversarial seat is
  briefed to **destroy the data**, demand a runnable repro, and mutation-test the fix.
- **~10 small migrations, not a big-bang rewrite.** Each namespace follows the same
  template (Section 4) that the per-user tables already proved. One namespace can fail
  without endangering the others.
- **`metadata` goes LAST** and is the only truly scary one (172 refs, scan-written).
  **Key safety fact: the media catalog is REBUILDABLE by rescanning the files.** The
  one non-rebuildable per-item field (`viewCount`) was already extracted to its own
  `viewCounts` namespace in v1.42 and migrates first (Wave 1). So even a catastrophic
  `metadata` migration failure is recoverable by a rescan - the risk is downtime, not
  permanent loss.
- **`db.json` import path stays as the rollback net** until Wave 7, satisfying the
  "keep it one more cycle" decision, and every wave verifies a **backup-bundle
  round-trip** before and after.
- **Dean's device pass is the final arbiter** at each release; solo waves first so the
  template is battle-proven on real data before the batches.

**Accepted residual (to log in `tech-debt-tracker.md` at kickoff):** while the arc is
in flight, backup/restore and the scan re-init must carry BOTH models. Every wave
updates *every* carrier seam (the v1.42 lesson) - this is tracked, not silent.

---

## 3. The waves

Pacing (Dean, 2026-09-13): **solo waves 1-3** (prove the template on real data with a
device pass between each), **batch waves 4-5**, **solo wave 6** (mandatory), teardown 7.
Each wave = its own branch -> gate -> `merge --no-ff` -> release ceremony -> branch
hygiene, per CLAUDE.md.

**Pacing change (Dean, 2026-09-13, after Wave 3's gate):** the template held on real
data three times (Waves 0-2 device-passed; every gate finding was in the new bindings,
none in a shipped release), so the batch starts one wave early: Wave 3 releases as is
(device pass pending, disclosed); **Waves 4 + 5 ride ONE branch, one full gate, one
release** - no device pass between 3 and 4, the namespace groups land as separate
commits so a rollback floor exists per group; **Wave 6 (`metadata`) stays solo** with its
own gate and Dean's device pass; Wave 7 follows directly. The per-namespace template,
the full gate and the bundle round-trip are unchanged - only the cadence.

### Wave 0 - Honest-zero comment debt + JSON de-reliance groundwork  (slim gate)
- Reword the two comment strings that trip the marker grep (`lib/media-capabilities.js:7`
  "a TODO gap", `public/js/glyph-pool.js:29,33` the `\XXXX` escape prose) OR allowlist
  them, and add a lint/test that keeps the **genuine** marker count at 0 going forward.
- Confirm (test) that `db.json` is never read when `filetube.db` exists; document the
  import path as scheduled for removal in Wave 7.
- **Predicted `server.js` delta:** ~0. **Risk:** none. **Data touched:** none.
- **Wave 0 record (2026-09-13, branch `feat/wave0-comment-debt-json-groundwork`):**
  - Both nets landed: eslint `no-warning-comments` (comment-START, all linted JS sets) +
    `test/unit/comment-debt-census.test.js` (TIER 1 marker-form = 0 over every tracked
    code file - by extension incl. css/html/sh/brs/yml/json PLUS the extension-less
    hooks/Dockerfile/roku manifest; TIER 2 loose word = 0 in shipped code). The census
    caught its FIRST hit in Wave 0's own eslint comment before commit. Mutation sanity:
    a `// TODO:` in lib/ reds eslint AND the census; a `/* FIXME */` in style.css reds
    the census (eslint does not lint CSS).
  - Slim gate (adversarial seat, REQUEST CHANGES -> fix round): (W1) both nets missed
    `/** @todo */`, lowercase/title-case openers in css/sh/html/brs, and the 4
    extension-less tracked files - opener arm now case-insensitive with `@?`, tag arm
    stays upper-case (the registry's `todo(...)`/`todo: 0` are domain code),
    extension-less files enumerated; (W2) both floors could pass VACUOUSLY (scan over
    `[]`, dropped extensions, added exclusions all stayed green) - now bound by an
    end-to-end temp-fixture scan and a per-extension-class witness list; (W3) the
    baseline instrument counted ITSELF (`dbJsonRefFiles` 16 at HEAD, target 0
    unreachable) - it excludes itself; (W4) three unreproducible claims in this plan
    corrected; (S5-S8) comment honesty, copy-shaped spy holes, the comment-porous
    server.js lock, the fallback-walk asymmetry.
  - `test/unit/dbjson-never-read.test.js`: fs-spy binding that boot rule 1 never reads
    db.json CONTENT (garbage bytes beside filetube.db boot fine; the same bytes WITHOUT
    filetube.db are FATAL - the positive control), plus the server.js seam lock (DB_FILE
    is basename-only; one `openAdapter`; no `importDbJson`).
  - Re-derived baseline at `3273f5e6`: server.js **19,041** (matches), doc_kv **13**
    (matches), doc_single **18** (the draft said 19 - corrected above, total **31**),
    db.json ref files **15** (> 0, matches), tests **8,310 / 657** (matches; Wave 0 adds
    its own). `SCHEMA_VERSION` **20** (matches).

### Wave 1 - `viewCounts` -> `media_view_counts`  (SOLO, full gate: holds non-rebuildable data)
- Lowest blast radius (11 refs), self-contained per-id integer store, already isolated
  in v1.42 precisely because it is the one non-rebuildable field. Perfect template proof.
- New table (migration `user_version` 21), one-time backfill from `doc_kv.viewCounts`,
  a `lib/media/viewCounts` store, rewrite the 11 consumers, drop from `DOC_KV_NAMESPACES`,
  move to the SELECT-assembled backup bundle.
- **Wave 1 record (2026-09-13, branch `feat/wave1-view-counts-relational`):**
  - Schema **v21**: `media_view_counts (media_id TEXT PRIMARY KEY, count INTEGER)`; the
    migration block copies every `doc_kv` `viewCounts` row (v1.42 value filter: finite
    positive -> truncated integer; 0/negative/junk/null dropped) and DELETES the doc rows
    in ONE transaction - leaving them would make `load()` assemble a key the save-lock
    now refuses, i.e. boot would break on the first write. Idempotent under a crash
    between COMMIT and the version stamp (test-bound). Rollback floor documented in
    RELEASING.md (a <=v1.290 build refuses a v21 db; bundles restore on both sides).
  - Store `lib/media/viewCounts.js` (`.gitignore` had to be root-anchored: the unanchored
    `media/` swallowed `lib/media/` - the v1.286 scar, now fixed at the source): get /
    getAll / size / set / increment (ONE atomic upsert, RETURNING; honors the legacy
    embedded `item.viewCount` floor on first count) / remove / rekey (OR REPLACE) /
    replaceAll (refuse-whole); own-property keys, NUL refusal; multi-row writes join an
    already-open adapter transaction (the restore path) instead of nesting BEGIN.
  - `server.js` consumers: the doc carries at delete / scan-prune / move / trash / restore /
    purge are gone; `remove()` runs post-commit beside `userStore.removeMediaState` at
    THREE sites (delete, scan-prune, purge; the fourth `removeMediaState` site, the
    notifications phantom-prune, is a DELIBERATE exemption - it scrubs per-user badge
    state, and a GET route must not become a second deleter of media state; recorded at
    the site) and `rekey()` inside `rekeyInFlightState` (ONE seam, THREE callers: move,
    trash, restore). The view route no longer rides the doc write chain (one integer no
    longer load-mutate-saves the whole library); existence is a `hasOwnProperty` read on
    the cache (a `__proto__` id is 404, never a prototype walk). Stats/inventory/overlay
    read `getAll()` once per request.
  - Counts are capped at `Number.MAX_SAFE_INTEGER` at EVERY write boundary (store,
    bundle validator, restore handle, migration/import value rule): a count past 2^53
    lands in the INTEGER column and then every READ of the table throws - backup, stats
    and the view route all 500 until SQL surgery (adversarial W1, measured on a real v20
    file; v1.290's validator accepted it).
  - Backup: `viewCounts` left `BACKUP_NAMESPACE_KEYS` for `RELATIONAL_BUNDLE_KEYS`; the
    bundle still carries `{ id: count }` under the same key (assembled on the same chained
    tick); validation is field-level refuse-whole; restore routes it through
    `importParsedJson` -> the `insertViewCount` handle inside `exclusiveReplace`, which now
    WIPES the table too (restore = the bundle and nothing else; the between-test reset
    relies on the same wipe). The boot db.json import routes the embedded extraction the
    same way (one classifier, two callers, one upsert text exported by the store).
  - `readPersistedDatabase` (the test read) surfaces the table as `viewCounts` when rows
    exist, so the move/trash/restore/delete/prune carrier tests still read the REAL table
    through an independent connection. 15 existing test files touched (7 re-seed a
    non-empty count through the store, 6 just drop the now-refused empty doc key, 2
    adjust reads/assertions - dbjson-frozen and database.test); new `test/unit/media-view-counts-store.test.js` (API, migration +
    idempotency + the 2^53 drop, save-lock, all bulk seams incl. rollback and the
    both-shapes precedence, the test read, source locks) and
    `test/integration/view-counts-carriers.test.js` (the gate's donated bindings: hard
    delete + purge reap the row, bundle validation refuses before the wipe incl. 2^53
    and 1e300, a `__proto__` view is 404).
  - Baseline after (at the fix commit `b33eab5e`): doc_kv **12**, doc_single 18, total
    **30**, schema **21**, server.js **19,114** (+73 over the v1.290 baseline - the
    post-commit carrier calls, the validator, and their comments outweigh the removed doc
    carries; the weight leaves in Wave 6/7, not here). `dbJsonRefFiles`
    drifted 15 -> 16 in the first commit (the store header named the file literally; QA
    W3) and is back to **15** after the reword - the metric counts literal mentions, so
    prose in new modules must not name db.json.
  - **Full gate (both seats REQUEST CHANGES -> fix commit `b33eab5e` -> both APPROVE).**
    Adversarial (22 mutants on a real v20 file + live probes): W1 a count >= 2^53 poisoned
    every read of the table (backup/stats/view 500) - the safe-integer ceiling above; W2
    the hard-delete and purge `remove()` calls were UNBOUND (the delete test's item had a
    file, so the trash re-key satisfied it); W3 the bundle validation was unbound at the
    route; S5 the both-shapes import precedence had FLIPPED vs v1.290 (first-class key
    routed first, embedded upserted over it). QA: W1 purge unbound (same), W2 four stale
    mechanism comments, W3 the dbJsonRefFiles drift, S2 the same precedence flip, S3 the
    migrate-check CLI's expected value drifting from the importer's rule. All applied;
    the seats' own mutants re-run RED against the fix (M2/M3/M6/M12/M12b + 9 new). Kept
    from the seats: the phantom-prune exemption (a GET route must not become a second
    deleter of media state), and the float refusal in the validator (no legitimate
    v1.24 -> v1.41 -> v1.42 -> v1.290 chain ever emits a non-integer; verified at source).
  - **Template lessons for Wave 2+:** (1) a carrier binding must drive the branch that
    REAPS, not one that RE-KEYS (populate, then assert the row is gone, not just moved);
    (2) an INTEGER column needs a safe-integer ceiling at every write boundary, or one
    hostile value kills every read; (3) when two seams can write the same id, the
    authoritative one goes LAST; (4) new-module prose must not name db.json (the metric).

### Wave 2 - `progress` + `deleteTombstones` -> relational  (SOLO, full gate)
- Per-id semantics + tombstone semantics (19 + 12 refs). `media_progress`,
  `media_delete_tombstones`. Proves the per-id + delete-sweep pattern end to end.
- **Wave 2 record (2026-09-13, branch `feat/wave2-progress-tombstones-relational`):**
  - **Framing correction found at intake:** `db.progress` is NOT live watch state. Since
    v1.43 positions live per-user in `user_progress`; the doc namespace is the FROZEN
    pre-auth record the first admin ADOPTS once at setup (nothing else reads it - a
    read-through fallback was design finding #6's bug farm). It still deserves a table
    (an un-set-up instance adopts it later; every carrier re-keys it) but it is legacy
    data, and Wave 7 may retire it once adoption is the only reader left. Recorded so the
    "19 refs" is not mistaken for playback code.
  - Schema **v22**: `media_progress (media_id PK, json)` and `media_delete_tombstones
    (media_id PK, deleted_at, json)`. Records are stored VERBATIM (shapes vary by era: a flat
    tombstone with or without `youtubeId`/`sourceRef` - and the v1.81 stats reader
    tolerates an `item`-bearing record, though no writer mints one; a bare-number or
    `{position}` progress value) on a
    shared `lib/media/jsonRowStore.js` definition (`defineJsonRowStore`: get / has /
    getAll / size / set / remove / rekey / replaceAll, typed columns derived from the
    record by one row builder shared with the adapter's bulk seams). The v22 block copies
    both namespaces and deletes the doc rows in ONE transaction; a corrupt row rolls the
    whole block back to a re-runnable v21 (test-bound).
  - **Template refinement - `inSaveTransaction`.** The v1.41.3 tombstone contract is
    "mint in the SAME mutator that removes the entry" (a crash between the two would
    re-index the survivor on the next scan). Wave 1's post-commit carrier posture would
    have broken it, so the adapter's `save(db, { alsoInTransaction })` now runs a callback
    INSIDE the doc transaction, and `updateDatabase` exposes `inSaveTransaction(fn)` to
    mutators: the delete's mint + prune, the move/trash/restore retirements, the scan's
    consumption + progress prune, the purge, and both "mutator A" retirements ride the
    doc commit (a throw rolls both back; a mutator that queues effects and returns
    `false` rejects loudly; a `true` return with zero doc changes still opens the
    transaction). Rule for later waves: a carrier that WAS in-mutator stays in-transaction
    via the hook; one that was already post-commit (per-user rows, viewCounts) stays so.
  - Consumers: loadDatabase backfills gone; the scan reads a Phase-1 SNAPSHOT
    (`tombstoneStore.getAll()`) and re-verifies the matched key against the LIVE table
    before reaping; adoption reads `progressStore.getAll()`; stats/inventory read both
    tables; `pruneDeleteTombstones` + the two constants moved to the store module (pure
    policy `selectPrunedTombstoneIds` + `store.prune()`), re-exported from server.js.
    Backup: both keys moved to `RELATIONAL_BUNDLE_KEYS` (same bundle key + shape),
    validated field-level (object maps, NUL-free ids, no null holes; a tombstone record
    must be an object), restored via `importParsedJson` -> `insertProgress` /
    `insertTombstone` handles inside `exclusiveReplace` (which wipes both).
  - Tests: the doc keys are refused, so ~100 fixtures lost their empty `progress: {}` /
    `deleteTombstones: {}` seeds (a script; QA read the full diff - every removal was a
    top-level key, no container key was touched) and `test/helpers/seed-state.js` is the
    ONE seam that splits a legacy-shaped fixture into store writes + a doc save (12 files
    call `seedState`; 23 import the helper, the rest for its store accessors); 22 direct
    in-mutator writes/reads switched to the stores. New:
    `test/unit/media-record-stores.test.js` (store API, typed column + prune, migration +
    rollback, save-lock, both seams, the test read, the save hook, source locks) and
    `test/integration/save-transaction-effects.test.js` (a FAILED save lands neither the
    metadata removal nor the tombstone nor the progress removal; a throwing effect rolls
    the doc change back; effects-then-false rejects; hook outside a mutator throws; a
    no-doc-change mutator still commits its effect). crash-child moved its per-burst row
    to `metadata`.
  - Baseline after (at the fix commit): doc_kv **10**, doc_single 18, total **28**, schema
    **22**, server.js **19,197** (+83 this wave: the hook + effects + comments), tests
    **8,368 / 665**, dbJsonRefFiles 15. Full suite Node 22 before the gate (at `0db2e7b4`):
    8515 / 8512 / 0 fail / 3 skipped.
  - **Full gate (both seats REQUEST CHANGES -> fix commit -> delta).** No CRITICAL: the
    adversarial seat could not lose, duplicate or mis-key a tombstone or a frozen position
    (34/34 seam probes, a real v21 file through the migration incl. DDL rollback on both
    Nodes, cross-version bundles both ways). What it caught: 21 of 44 mutants SURVIVED -
    the scan's LIVE re-verify (a data-loss guard) and the adoption wiring were unbound,
    and eight carrier sites (trash/restore/purge/move-B retirements, the delete's in-txn
    prune) had no reap-axis binding (QA W3 too - the Wave 1 lesson re-struck on a NEW
    mechanism). Both seats: the migration's and the validator's NUL checks were INERT -
    the edit tool wrote a two-backslash literal (`'\\u0000'`, six characters) where a
    NUL escape was meant (the v21 sibling was right), so the validator's "400 before the
    wipe" was a 500-after-wipe-with-rollback for a NUL id and the migration would have
    silently DROPPED a legitimately-escaped key; `deleted_at` was written and never READ
    while three headers claimed it drove the prune; eight comments still narrated the doc
    mechanism; a null progress record exported fine and failed the validator (own export
    must restore); the record's test-file numbers were stale. All applied: the NUL literals
    fixed and route-bound; `prune()` now deletes on the typed column (age-out + FIFO cap
    with a media_id tie-break); the donated probes are
    `test/integration/tombstones-progress-carriers.test.js` (every carrier populated then
    reaped/re-keyed, the delete's in-txn cap, the LIVE re-verify with a mid-scan
    retirement, a mid-scan mint surviving the merge, adoption of every legacy shape,
    hostile bundle shapes 400-before-wipe, an own-export-with-null restores); comments and
    the record corrected. Disclosed, not chased: M8a/M14a (the move/restore mutator-B
    retirements of newId/originalId are redundant with mutator A by construction -
    unbindable without an interleave hook); `/api/stats` progress + member-scoped
    tombstone reads unbound (informational).

### Wave 3 - `trash` -> `media_trash`  (SOLO, FULL gate, data-loss sensitive)
- 33 refs at kickoff (39 measured code refs at the wave's start), restore path, backup bundle. Adversarial briefed to destroy trashed-item
  recovery. Extract `trashItem` / `restoreTrashItem` into `lib/media/trash` as it moves.
- **Wave 3 record (2026-09-13, branch `feat/wave3-trash-relational`):**
  - Schema **v23**: `media_trash (media_id = trashId PK, trashed_at, json)` on the shared
    `jsonRowStore` shape (`lib/media/trashRecords.js`); records verbatim (the full
    metadata snapshot inside `item` restores byte-identical); `trashed_at` is QUERIED:
    `expiredBefore(cutoff)` is the retention sweep's query (strictly older; a record
    without a numeric trashedAt is never returned - the v1.65 "never auto-sweep a
    malformed record" rule kept exactly). Migration: verbatim copy + doc-row delete in
    one transaction, corrupt row rolls back incl. the CREATE TABLE. Fourth rollback floor.
  - Consumers (the 39 refs): the mint (trash move) and the deferred-retry's leftover
    mint ride `inSaveTransaction` with the metadata removal (the record is the ONLY way
    back for a file whose bytes already sit in `.filetube-trash/`); restore retires the
    record in the same commit that re-creates the entry; purge retires it with the
    carriers; the scan's leftover reconcile reads a Phase-1 snapshot (`getAll()`); the
    trash list, purge-all, the three serve routes (thumbnail/storyboard/preview of a
    trashed item), the notifications phantom filter and the restore/purge routes'
    visibility check read the live table (the last two were `getCachedDatabase().trash`,
    a spelling the first grep missed - caught by the RBAC suite, then source-locked).
    Backup: `trash` joins `RELATIONAL_BUNDLE_KEYS` (same key/shape; the v1.65 path
    validation and the "a bundle without `trash` preserves the live records" rule are
    unchanged; a NUL/empty trash id in a bundle is refused at the bundle level, before
    the wipe - the ROUTES, by contrast, read such an id as "no record" (below)).
  - **Extraction deferred, disclosed:** the plan's "extract `trashItem`/`restoreTrashItem`
    into `lib/media/trash` as it moves" needs ~20 server.js internals threaded through a
    deps bag (sidecar path helpers, `rekeyInFlightState`, `destroyMediaStreams`,
    module-level served-at maps, the RBAC predicates). On a data-loss-sensitive wave
    that already touches 20 files, that extraction is a second risk class with its own
    gate; it moves to Wave 7's monolith split (where every giant function goes through
    the same deps-bag discipline at once). Storage move only this wave.
  - Tests: 15 fixtures re-routed (a codemod for the multi-line in-mutator record writes
    - `db.trash.NAME = {...}` - and the reads; one heuristic mis-quoted a loop VARIABLE as
    a string key, caught by eslint); the codemod's read rewrite turned three
    `db.trash[x].trashedAt = v` field mutations into `trashStore().get(x).trashedAt = v`
    - a SILENT NO-OP on a fresh object (caught by two red retention tests; rule: a
    codemod must never rewrite an assignment target into a getter). New
    `test/unit/media-trash-store.test.js` and
    `test/integration/trash-records-atomicity.test.js` (mint/restore/purge under a
    FAILED doc save, the sweep boundary on the typed column, the routes, NUL ids).
    The docs-diagrams census's sanity floor now sums the three rosters (doc_kv drains
    toward 0 by design).
  - **Gate (both seats, one fix round).** CRITICAL (both): the store's id assertion had
    moved onto READ paths fed by request ids - `POST /api/trash/%00/restore` and
    `DELETE /api/trash/%00` HUNG (an async handler rejection Express 4 never observes),
    the three serve routes 500'd, and one notification row with media id `''` (a hostile
    bundle restored on <=v1.292 stores a NUL id as `''`) made the bell 500 for every user.
    Fix: reads are tolerant (`isPersistableId` false -> absent / 0), writes still refuse;
    bound by `test/integration/trash-routes-hostile-ids.test.js` (the v1.292.0 statuses
    + the process keeps serving). Adversarial W1: a `''` trash key from an old bundle
    migrated VERBATIM into an unpurgeable row that aborted the sweep and purge-all - the
    v23 migration now skips an unaddressable key with a log line (bytes stay for the
    orphan pass; bound incl. a BLOB key, since `node:sqlite` cannot even plant a NUL key).
    Adversarial W2 / QA W4: the deferred-retry mint's atomicity was unbound - bound with
    a failure axis AND a positive control (the retry must REACH the mint). Non-blocking
    (all applied): DIAGRAMS KV box still listed `trash`, ARCHITECTURE's doc_kv list,
    nine stale test comments, six stale server.js comments, the `expiredBefore`
    statement now cached on the adapter. Disclosed residuals: storyboard/preview lookups
    of a TRASHED item are unbound (only thumbnail is); the orphan pass reads its
    `getAll()` snapshot after the purges (benign - a purge-then-orphan race deletes a
    file the purge already deleted).
  - Baseline after: doc_kv **9**, doc_single 18, total **27**, schema **23**, server.js
    **19,217**, tests 8,368 / 665 + the 2 new files. Full suite Node 22 before the gate:
    8538 / 8535 / 0 fail / 3 skipped.

### Wave 4 - config singletons  (batched with Wave 5 on ONE branch - Dean's pacing change)
- Kickoff figures: `settings` (48), `folders` (39), `folderDisplayNames` (22), `liked` (12),
  `folderSettings` (10). **Measured at the wave's start** (`node scripts/relational-arc-refs.js`,
  comments stripped, HEAD d5a80dce): server.js `settings` 46 / `folders` 11 /
  `folderDisplayNames` 16 / `liked` 15 / `folderSettings` 8; lib `settings` 2 / `folders` 10
  (3 code sites in `lib/ytdlp/index.js` + `lib/podcasts/index.js`, the rest log strings).
  Test blast radius: fixture files carrying `folders:` **148**, `folderSettings:` 128,
  `settings:` 122, `liked:` 64; `db.<key>` spellings inside tests: folders 207,
  folderSettings 43, settings 39, liked 28, folderDisplayNames 4; `saveDatabase(<variable>)`
  94 sites. The test side is the larger half of this wave.
- **Design (2026-09-14):**
  - Two new shared primitives beside `lib/media/jsonRowStore.js`, same contract (adapter
    in, statements cached on the adapter, joins an open transaction, ids by the ONE
    `isPersistableId` rule, tolerant reads / asserting writes):
    `lib/db/kvStore.js` - `defineKvStore({label, table})`: an object of key -> JSON value
    as one row per key (`get()` merges construction-time defaults, `update(patch)` writes
    only the touched keys, `replaceAll` refuse-whole); and `lib/db/orderedListStore.js` -
    `defineOrderedListStore({label, table, column})`: an ordered list of strings as
    `(value PK, position)` rows (`list()` in position order, `add` appends at max+1,
    `remove`, `rekey` OR REPLACE, `replaceAll` dedupes keep-first - a list has set
    semantics, so a legacy duplicate collapses instead of refusing an old export).
    `jsonRowStore` gains a `keyColumn` option (default `media_id`) so a store keyed by a
    path or a folder name does not carry a lying column name.
  - Tables (one schema bump per group, each its own rollback floor, each a separate commit):
    **v24** `app_settings (key TEXT PK, json)` <- `settings` (`lib/config/settings.js`;
    `DEFAULT_SETTINGS` stays in server.js and is handed to the store, so `get()` is what
    `withDefaultSettings(db.settings)` was; the bundle keeps exporting the MERGED object);
    **v25** `library_folders (path PK, position)` <- `folders`,
    `library_folder_settings (root_path PK, json)` <- `folderSettings`,
    `channel_folder_display_names (folder_name PK, json)` <- `folderDisplayNames`
    (`lib/config/folders.js`, `folderSettings.js`, `folderDisplayNames.js`);
    **v26** `media_liked (media_id PK, position)` <- `liked` (`lib/media/liked.js` - the
    FROZEN pre-auth likes the first admin adopts once, Wave 2's progress posture; its
    carriers are the four in-mutator rename/trash/restore/purge re-keys, which ride
    `inSaveTransaction`).
  - Consumers: reads become store reads at the same site (a mutator that read `db.settings`
    reads `settingsStore.get()`); a long-lived snapshot (the scan's `db` taken at scan
    start) captures `settingsStore.get()` / `folderStore.list()` ONCE where it captured
    `db`, so a mid-scan config change is still not observed mid-scan (unchanged semantics).
    Writes inside mutators ride `inSaveTransaction` (config POST, settings POST, the logo
    mime keys, the notifications seed stamp, the scan's display-name heal, the four liked
    re-keys). The backup bundle keeps every key and shape; `BACKUP_NAMESPACE_KEYS` shrinks
    to `metadata` + the containers and the five join `RELATIONAL_BUNDLE_KEYS`; restore
    routes them through handles (`insertSetting`, `replaceFolders`, `insertFolderSetting`,
    `insertFolderDisplayName`, `replaceLiked`) - validated field-level before the wipe.
  - Tests: `test/helpers/seed-state.js` routes the five keys; a codemod turns
    `saveDatabase({` fixtures into `seedState({` and `loadDatabase().<key>` reads into
    store reads; mutator/variable spellings are hand-fixed (the Wave 3 rule: a codemod
    never rewrites an assignment TARGET). `readPersistedDatabase` surfaces the five under
    their old keys when rows exist (tests only).
  - **`moveItemToFolder` extraction deferred to Wave 7**, same reason as Wave 3's
    `trashItem`: a deps-bag threading of ~20 server.js internals is a second risk class
    on a data-moving wave; storage move only here. Disclosed.
- **Wave 4 record (2026-09-14, branch `feat/wave4-5-config-and-catalogs`, three commits, one
  per group; Dean's overnight authorization the same day: "continuing on through the rest of
  the waves" - the per-wave device pass is waived until the arc completes, every release ships
  DEVICE-PENDING and disclosed):**
  - **Group 1 (v24)** `settings` -> `app_settings`: 48 server.js sites (the 46 doc spellings
    + the `getCachedDatabase().settings` ones the first census missed - it counts them now),
    one lib site (the podcasts trash sweep reads retention via a `getSettings` dep). The
    scans capture `settingsStore.get()` once beside their Phase-1 snapshot (a mid-scan
    change still not observed mid-scan). The bundle keeps the MERGED object.
  - **Group 2 (v25)** the folder config -> `library_folders` / `library_folder_settings` /
    `channel_folder_display_names`: 35 server.js sites + lib/podcasts (boot overlap warning)
    + lib/ytdlp (the stale-downloadDir migration, through `getLibraryFolders` /
    `removeLibraryFolder` + `inSaveTransaction` deps); the config POST writes both maps in
    ONE `inSaveTransaction`; the rename route and the channel heal write a display name the
    same way (the heal through a `setFolderDisplayName` dep so its unit harness stays
    deterministic). **Three reads hid behind holder names the census did not know**
    (`cachedForBooks.folders`, `cached.folders` x2, `mdb.folderDisplayNames`) - caught by the
    feature-config overlap tests; the census and the new source locks now enumerate every
    holder spelling. A `/*` inside a comment silently truncated the diagrams census's view
    of `lib/db/sqlite.js` (9 names / 12 tables until reworded).
  - **Group 3 (v26)** `liked` -> `media_liked` (`lib/media/liked.js`): the adoption and the
    stats inventory read `list()`; the four carriers (rename / trash / restore / purge)
    re-key or remove inside the commit; `rekey` keeps the SLOT (the array idiom wrote the
    new id back at the same index). After it NO top-level `doc_single` name remains.
  - Tests: `saveDatabase(` fixtures -> `seedState(` in 97 files (codemod), the folder
    spellings in 11 files (codemod) + ~40 hand sites, the liked spellings in 7 files; the
    seed helper routes the five keys REPLACE-ONLY-WHEN-PRESENT (a `loadDatabase()`-derived
    object no longer carries them - the first cut wiped them on re-seed); the crash probe
    writes two kv rows per burst; the adapter test's upgrade cases plant a v17 doc row raw.
    Six new test files (`db-kv-list-stores`, `app-settings-store`, `library-folders-stores`,
    `media-liked-store`, `app-settings-atomicity`, `media-liked-carriers`) + the gate's two
    (`library-folders-atomicity`, the move carrier case in `media-liked-carriers`).
  - Baseline after: doc_kv **9**, doc_single **13**, total **22**, schema **26**, server.js
    **19296** lines, tests 8426 / 674 files (re-derived at the gate; the first figure was a stale run). Full suite Node 22 before the gate:
    8581 / 8581 / 0 fail / 0 skipped. `moveItemToFolder` extraction deferred to Wave 7.
  - **Gate pass A (both seats, one fix round + delta).** No CRITICAL. QA W1: two of the
    three new source locks had an INERT holder arm (`cached\\w*` typed into a regex
    literal - a backslash and zero-or-more `w`; the mutant "reinstate `cached.folders`"
    survived) - fixed, re-verified by `re.test('cachedForBooks.folders')`. QA W2 = ADV W2:
    `scripts/migrate-check.js` refused every db.json with `liked: []` (the shape every
    v1.30+ file carries) and a duplicated list entry - it now normalizes the two lists
    like the importer and drops the empties (test-bound). ADV W1: the migration stamp was
    written once at the END, so a v25/v26 failure left v24 COMMITTED under a v23 stamp and
    v1.293.1 booted that partial database, defaulted the settings it no longer found and a
    re-run of v24 overwrote the migrated rows (measured settings loss) - v24/v25/v26 now
    stamp their own floor inside their commit (test-bound: v24 lands, v25 fails -> stamp
    24, rows kept, doc row gone). The v21-v23 blocks keep the end stamp (append-only
    rule; their partial states crash the old build rather than default). ADV W3 = QA W3:
    the config POST's atomicity was bound only by a regex (the hoisted-writes mutant
    survived 106 tests) - the seat's probes are adopted as
    `test/integration/library-folders-atomicity.test.js` (both tables under a failed
    save, a throw in the second replaceAll rolling back the first, the dedupe-by-resolved
    spelling, NUL paths dropped). ADV W4: the MOVE carrier's failure axis was unbound
    (the out-of-transaction mutant survived 74 tests) - bound in
    `media-liked-carriers`. Writing those tests found a REAL bug the seats' probes had
    not driven: `POST /api/folders/display-name` had no try/catch around its save, so a
    failed save HUNG the request (the Wave 3 class) - guarded, 500. Non-blocking, all
    applied: the notifications stamp and the rename route now have failed-save axes; the
    yt-dlp stale-prune requires the in-transaction hook (its direct-write fallback and the
    dead `setFolderDisplayName` in the timer bundle are gone); the podcasts sweep guards
    `getSettings` like `getLibraryFolders`; nine stale comments (the orphaned
    `withDefaultSettings` note, `db.liked` in three places, the clobber list, the version
    ladder); the record's test counts re-derived (8426 / 674). Disclosed: the bundle
    validator is deliberately tighter - v1.293.1 accepted a NUL folder path and an
    empty-string folderSettings key verbatim, this build 400s both; the source locks
    shell out to `git ls-files` and need a repo checkout (all waves' locks do); v25/v26
    log a collapsed duplicate now.
- **Gate pacing on the shared branch:** the two waves are gated in TWO passes by the SAME
  reviewer agents (pass A after the Wave 4 commits, pass B after Wave 5), so each review
  is bounded; ONE release (v1.294.0) at the end, no device pass between 3 and 4. Split
  trigger (disclosed if it fires): if pass A needs a third fix round, or pass B's diff is
  more than a seat can honestly cover in one pass, Wave 5 releases separately.

### Wave 5 - feature catalogs  (same branch; sub-waved per feature, smallest first)
- The `books.*`, `music.*`, `podcasts.*`, `tv.*`, `ytdlp.*` namespaces (each already has a
  `lib/<feature>` owner). Measured at the wave's start (same census): per-feature code
  sites server/lib - tv 0/20 (+ `readTv` 13 / `ensureTv` 3 accessor calls in server.js),
  music 13/24 (+23/3), books 0/57 (+25/7), podcasts 4/90 (+12/0; `ensurePodcasts` 22 in
  lib), ytdlp 15/95 (+ `ensureYtdlp` 25 in lib). Order: tv -> music -> books -> podcasts
  -> ytdlp (the security-gated downloader last, with the most probes).
- Per feature: the id-keyed catalogs (`items`/`tracks`/`episodes`/`progress`/`audio`/
  `downloadMeta`/`channelAvatars`) become `jsonRowStore` tables `<feature>_<name>`; the
  root lists (`folders`) become `orderedListStore` tables; the `settings` objects (and
  `ytdlp.allowMembersOnly`) become `kvStore` tables; `pins` / `subscriptions` /
  `music.channels` become jsonRow tables keyed by id with a `position` column derived
  from array order. The feature's `readX(db)` becomes `store.read()` (the same snapshot
  shape, so the GET routes change mechanically); every `ensureX(db)` mutation site is
  hand-rewritten to store writes inside `inSaveTransaction`. The doc container key
  (`db.books`) leaves `CONTAINER_KEYS` when its last sub-key moves.
- Each feature = one schema bump (v27 tv, v28 music, v29 books, v30 podcasts, v31 ytdlp),
  one commit, its own rollback floor, its own migration + atomicity + bundle tests.
- **Wave 5 record (2026-09-14, same branch, six commits: the primitives + one per feature;
  overnight, Dean's standing authorization):**
  - **The primitive (`lib/db/featureStore.js`, `lib/db/recordListStore.js`).** A namespace is a
    set of tables on the shared shapes (`list` / `map` / `kv` / `records` / `value`); `read()`
    is the module's old `readX(db)` snapshot, `holder(only)` wraps it as `{ [name]: snapshot }`
    so the module's own `ensureX(holder)` normaliser and reducers keep running UNCHANGED, and
    `mutate(fn)` writes back the DIFF (changed rows only, per part) through
    `inSaveTransaction` - one commit with the doc. `migrateFromDoc` copies the doc rows
    verbatim (only the parts that have rows; never wipes - a re-run is a no-op), per-block
    stamps as in Wave 4. A `value` part (ytdlp.allowMembersOnly) lives in an `internal` kv
    table that is never a namespace key; an unset value IS its default (no row, no diff).
  - **v27 tv** (2 server writers: the scan merge, the config POST) · **v28 music** (+ the
    channel-mark route; `music.channels` was a doc_single MAP - `docSingleMap`) · **v29
    books** (the five deps-mutators in `lib/books/store.js` take `booksDb` through deps; the
    scan merge, the config POST, the cover POST, the TTS boot reconcile, the clear-cache
    drop) · **v30 podcasts** (the module's 21 writers, a string/comment-aware codemod +
    hand edits; `subscriptions` is an ORDERED record list - a position column, never a
    sort; the search registry takes a `podcastsNs` dep; the restore's absent-key
    PRESERVATION reads the tables; the three simple mutating routes 500 on a failed
    commit instead of hanging) · **v31 ytdlp** (the 13 store writers; the index's reads take
    a holder or a VIEW - the doc snapshot with the namespace attached - because
    `collectDistinctChannelAvatarTargets` and friends read db.metadata AND the namespace;
    server.js hoists ONE `ytdlpDb.holder(['subscriptions','channelAvatars'])` per request
    for the 8 avatar-resolver loops, the scan takes one holder for the bridge map + the
    folder backfill and queues `syncFrom` into its own commit, the relocation joins and the
    attribution proposal take a subscriptions holder (the deep-clone dance is gone), the
    two fanout writers relabel the frozen pins through a NESTED feature mutate, an id-less
    legacy subscription gets `md5(channelUrl)` minted by the migration instead of falling
    through the record list's id floor). After v31: `CONTAINER_KEYS = []`,
    `SINGLETON_NAMES = []`, `DOC_KV_NAMESPACES = ['metadata']` - the doc model is one
    namespace; the container-object check in the bundle validator is subsumed by
    `validateFeatureBundle` (every container shape-checked BEFORE the wipe), so the
    mid-populate rollback test needs an injected failure (`__failNextRestorePopulateForTests`).
  - Tests: the per-feature unit harnesses that faked the doc object now hand the module a
    REAL store on a scratch database (`test/helpers/scratch-feature-store.js`:
    `featureStoreFor(FEATURE, db)` seeds one shared scratch store per feature per process
    from the fixture's key and `docView` attaches the snapshot to the doc IN PLACE - the
    21 yt-dlp module-only harnesses converted by a one-line codemod, the four `makeFakeDeps`
    builders by hand); the integration mutators wrapped by the Wave-4 codemod (extended to
    the `fresh` param) + ~30 mixed sites by hand; seeds carry ids (records need them);
    the adapter test's doc-model cases run on `metadata` now (the one doc_kv namespace);
    the fanout unit test's pin case runs through the REAL writer. New: five
    `<feature>-feature-store` unit suites (migration verbatim incl. order, re-run no-op,
    corrupt-row rollback of every CREATE TABLE, save-lock, import route, exclusiveReplace,
    test read, mutate diff, source locks on server.js AND the module) + five
    `<feature>-feature-atomicity` integration suites (failed-save axes through the REAL
    routes/writers, the order survival, the bundle round-trip + 400-before-wipe, the
    absent-key semantics: podcasts PRESERVES, the rest restore empty) + `db-feature-store`.
  - Baseline after the pass-B fix round: doc_kv **1**, doc_single **0**, total **1**
    (`node scripts/relational-arc-baseline.js`), schema **31**, 60 relational tables,
    server.js **19382** lines, tests 8502 / 687 files (the baseline script's count at the
    fix commit; the suite's own count is in the release notes). `scripts/migrate-check.js` passes a db.json carrying
    every container (all five route through `replaceFeature`).
  - Deferred to Wave 7 (disclosed): the doc-model seams that still exist for `metadata`
    alone (`BACKUP_NAMESPACE_KEYS = ['metadata']`, the save-lock's container walk over an
    empty list, `doc_single` as an empty table); the podcasts episode DELETE / restore
    routes still hang on a failed commit after their file move (pre-existing, the Wave 3
    class, not this wave's change - tracked in #224's revisit).
  - **Gate pass B (both seats FRESH instances - pass A's did not survive a context
    compaction; one fix round + delta).** No CRITICAL. **ADV W1 (data loss, a surviving
    mutant):** `syncFrom` treated a part absent from the snapshot as "emptied", so a PARTIAL
    holder (`holder(only)` - the very optimisation the `only` parameter invites) reaching
    the scan commit wiped the pins, the avatar registry and the flag; six suites stayed
    green under the mutant because no scan test seeded those parts. Fixed as prescribed: a
    partial snapshot is tagged (a non-enumerable Symbol) with the parts it read and
    `syncFrom` skips the rest; bound by a primitive-level case and by a scan case that
    seeds pins + avatars + flag and asserts them untouched. **ADV W2 = QA W2:** the scan
    bridge's "inside its own commit" was bound only by a source lock (the out-of-
    transaction mutant survived every executing test) - a failed-save scan case now binds
    it (the bridge row survives, no item lands, the next scan consumes). **ADV W3 = QA W1
    (perf):** whole-table reads per ITEM in the home row resolver, the grid card resolver,
    the push resolver and the handoff resolvers (measured: `musicDb.read()` at 10k tracks
    = ~50 ms per call) - every single-lookup site is a prepared point query now
    (`xDb.parts.<map>.get(id)`, six books routes included), the mark readers read one
    table, search reads the podcasts namespace once per query; the remaining per-request
    LIST reads are disclosed in tracker #226 with a Wave 6 revisit. **ADV W4:** the v31
    block minted an id for an id-less legacy yt-dlp subscription while the db.json boot
    import and the bundle restore REFUSED the same record (a boot that never opens) -
    one exported repair (`mintLegacyYtdlpSubscriptionIds`, md5 of the NORMALIZED url -
    QA W5's finding: the raw-url mint would have made a later re-add a duplicate) runs at
    all three seams; the validator accepts the shape. **QA W3:** the record's test count
    was stale - re-derived at the fix commit. **QA W4:** the podcasts feed-url route hung
    on a failed commit (undisclosed) - 500 now, test-bound. **QA W5:** five stale comments
    (the sqlite header's `books.audio` bullet, the scan bridge's `fresh.ytdlp` prose, the
    dead boot backfill's lead, the index's "server.js never reads the namespace",
    the mint comment). Non-blocking, applied: a `value` part is shape-checked in the
    bundle validator and coerced by the v31 block (QA S2 / ADV S7); the lock lists carry
    `handoffDb|srcMeta` (ADV S6); the fanout unit tests start each fake-deps case with an
    empty pin table (QA S3); the one-mutate-per-tick rule is stated in the primitive's
    header and recorded in #226 with a revisit (ADV S5); the double reads (QA S1).

### Wave 6 - `metadata` -> `media_items`  (SOLO, FULL gate, adversarial destroys the catalog)
- The crown jewel: 172 refs, 284 rows, written by the 1,533-line `runScanDirectories`.
  New `media_items` table; extract the scan into `lib/scan/` as small tested functions
  (the player.js standard). Verify a full backup round-trip and a rescan-rebuild BEFORE
  and AFTER. This wave sheds the most `server.js` weight.

- **Wave 6 design (2026-09-14, branch `feat/wave6-media-items`, Dean's split: the store, the
  adapter seams and the scan's write path stay with the main session; the scan-helper
  extraction is a worktree subagent's mechanical job reviewed by the main session):**
  - `lib/media/items.js` owns `media_items (media_id TEXT PRIMARY KEY, json TEXT NOT NULL)`
    - one row per indexed file, the json VERBATIM, in rowid order (the walk order doc_kv gave
    `Object.keys(db.metadata)`). It is the table's ONLY runtime writer.
  - **What deliberately did not change:** the routes keep reading the index as the
    `{ metadata }` object `loadDatabase()` / `getCachedDatabase()` hand them (the adapter's
    `load()` assembles it from the table; an empty table is absent, server.js backfills `{}`),
    and the mutators keep writing `db.metadata[id] = item` / `delete db.metadata[id]` inside
    an `updateDatabase` tick. The adapter's `save()` hands the object's `metadata` to the
    store's per-row diff - `planDiff` (serialized JSON vs the last commit's snapshot; an
    ABSENT key = rows kept, a PRESENT-but-empty map = wiped, an `undefined` value dropped as
    JSON.stringify dropped it, a NUL id refused), `applyPlan` inside the SAME transaction as
    the doc writes and every `inSaveTransaction` effect, `advancePlan` only after COMMIT. So
    the 150 `db.metadata` read sites and the scan's final merge are textually unchanged, the
    persist-gate seams (carry-forward, merge guard, epoch check) are untouched, and the
    `getCachedDatabase()` read cache is exactly as fast as before (the #226 read-cache design
    question does not arise for the index: the cached object IS the cache).
  - `lib/db/sqlite.js`: `DOC_KV_NAMESPACES = []` and `SINGLETON_NAMES = []` (BOTH doc tables
    are empty - Wave 7 drops them); `DOC_OBJECT_KEYS = ['metadata']` keeps the save-lock
    honest (a stray key still throws); the v32 block creates the table, copies the doc rows
    verbatim (a corrupt row rolls the block back to a re-runnable v31, an unaddressable key is
    skipped with a log line), deletes them and stamps inside the block; `exclusiveReplace`
    wipes the table and takes an `insertItem` handle; `importParsedJson` routes `metadata`
    through `insertItem` (the viewCount extraction unchanged, still through
    `insertViewCount`; the handle is required only when items exist); `readPersistedDatabase`
    surfaces the table under the old key; the stranded-import fingerprint counts the table.
    server.js: the bundle validator shape-checks `metadata` BEFORE the wipe (an object of
    item objects with NUL-free ids - a 500 "rolled back" until now). `scripts/migrate-check.js`
    drops an empty index like the other empties.
  - Tests: `media-items-store` (migration verbatim + order + skip + re-run + rollback, the
    diff's every axis incl. an in-transaction effect's throw, the seams, the locks: no file
    outside the store spells a raw write) and `media-items-atomicity` (a REAL scan indexes
    into the table, an unchanged tick writes nothing, a changed item rewrites its row; a scan
    whose save fails leaves the index AND its carriers untouched; the plan's backup
    round-trip + a RESCAN after the restore reusing the restored rows; a v1.294-shaped bundle;
    400-before-wipe). The adapter suite's doc-model cases (mid-transaction poison, the
    exclusiveReplace handle) moved onto the store's seams.
  - **The scan-helper extraction (a worktree subagent on Opus - Dean's ruling: not Sonnet for
    this - reviewed by the main session; merged d5613365).** 13 pure helpers left server.js
    for five `lib/scan/` modules, their bodies BYTE-IDENTICAL (machine-checked by the main
    session: each moved body appears verbatim in exactly one module and is gone from
    server.js): `roots.js` (matchRootFolder, normalizeScanRoot, detectVanishedRoots),
    `merge.js` (selectPrunableIds, mergeScannedMetadata), `identity.js` (extractYtdlpVideoId,
    youtubeIdFromUrlString, deriveScanYoutubeId, deriveReleaseDate), `captured.js`
    (applyCapturedViewCount, applyCapturedFollowerCount, collectDownloadNotification),
    `probe.js` (applyHasSubtitlesDetection). server.js re-exports every name (the SAME
    function object - the extraction lock binds identity, not presence). Deliberately left,
    disclosed: `reconcileTranscode` (reads TRANSCODE_DIR and stats the cache - not pure) and
    the `needsTranscode` cluster (its move was implemented and REVERTED: `tv-scan.test.js`
    parses `TRANSCODE_EXTENSIONS` out of server.js's text to prove TV_EXTENSIONS never
    drifts - a comment-porous lock, the repo-known class; the extraction lock now pins that
    the constant stays in server.js so a future move trips a test that names the
    consequence). Two more comment-porous locks bit the subagent (a quoted constant in a
    comment; a `require('../../server')` literal in a test header) - reworded. 105 new
    assertions; mutation-verified against the commit (a wrapper re-export, a leftover copy,
    a dropped mount-loss guard, a flipped return - all red).
  - Residuals the extraction surfaced (tracked in #227): `test/unit/v1362-minors-client.test.js`
    does not isolate DATA_DIR and opens `/tmp/filetube.db` - a v32 build's leftover there
    makes an older build's run of that test red (environment debris, not code); the
    pre-commit hook's `[ -d node_modules ]` check fails inside a git worktree (Node resolves
    modules by walking up, the hook does not); `node --test test/unit` (a bare directory)
    is not the suite's invocation on this Node - use the npm scripts.
  - Baseline after the storage move + the extraction: doc_kv **0**, doc_single **0**, legacy
    **0**, schema **32**, 61 relational tables, server.js **19092** lines (19396 before the
    extraction; 304 lines moved), tests re-derived at the gate.

### Wave 7 - Teardown + monolith split + `db.json` removal  (full gate)
- Remove `loadDatabase`/`saveDatabase`/`updateDatabase`, the mega-object backfill, and
  `doc_kv` + `doc_single` (arrays emptied, then tables dropped via a forward-only
  migration). Remove the `db.json` import path and legacy tmp-sweep (grace satisfied).
  Owed from Wave 0's slim gate (S7): an INTEGRATION boot of `server.js` itself with a
  garbage `db.json` beside `filetube.db` - the Wave 0 binding is at the adapter seam
  plus a source lock on `server.js`, and a source lock is evadable by an indirect spelling.
- Split the remaining routes into feature routers; `server.js` becomes a thin
  composition root under the predicted **< 3,000 lines**.
- Re-verify **every** Section 1 prediction; a miss is a finding, not a rounding note.

---

## 4. The per-namespace migration template (the proven pattern)

Each namespace migration MUST do all of these; a test binds each:

1. **Forward-only additive migration** from `user_version` 20 -> 21+, `CREATE TABLE
   IF NOT EXISTS`, table born complete. Never edit an executed block (append-only, or
   the suite hangs - repo scar).
2. **One-time idempotent backfill** copying the namespace's `doc_kv`/`doc_single` rows
   into the new table; NUL-safe (`node:sqlite` truncates TEXT at NUL - keep
   `assertRowKeySafe`); `__proto__`-safe (`defineRowProperty`).
3. **A feature-owned store module** (`lib/<feature>/store.js` shape) with the read/write
   API; the ONLY writer of its table.
4. **Rewrite every `server.js` consumer** (the N grep refs) to call the store, not
   `db.<ns>`.
5. **Remove the namespace from `DOC_KV_NAMESPACES` / `SINGLETON_NAMES`** so
   `assertNoUnknownKeys` now REFUSES a stray write to it (the lock becomes the net).
6. **Backup bundle:** move the namespace from the doc-model bundle to the table's
   SELECT-assembled bundle (`BACKUP_NAMESPACE_KEYS`); verify a restore round-trip.
7. **Tests (persist-gate discipline):** terminal-write coverage, restore round-trip,
   backup inclusion, empty/absent handling, and BOTH axes of any reveal/clear or
   symmetric invariant. Populate first, then drive the non-happy axis (no vacuous floors).
8. **Gate:** FULL for anything a user can lose; adversarial destroys the data, runnable
   repro, mutation-tested fix. Verify what a prescription REMOVES, not just what it adds.

---

## 5. Standing constraints (non-negotiable, from CLAUDE.md + memory)

- Every wave: branch -> gate -> `merge --no-ff` -> release ceremony (version bump,
  ROADMAP, `docs/releases.json` ledger in pure user language, tag) -> branch hygiene
  (delete remote+local, `-d` never `-D`). Waves RELEASE with device pass pending +
  disclosed, never merged-but-unreleased.
- Dual-Node suites (v22.23.1 + v24.14.0) SEQUENTIALLY, reviewers idle, before each
  release. Node 24 prints `ℹ` not `#` - an empty grep is not green.
- Migrations forward-only + append-only; schema bumps additive; `user_version` climbs
  from 20.
- Mutation-test against a COMMIT in a `/tmp` `git archive` sandbox, never the dirty tree.
- No blind staging (`git add -A` is hook-blocked); stage explicit paths; verify branch +
  `git log` (phantom-commit) and `git ls-remote` (phantom-push, never pipe a push).
- No em dashes in any output (plain " - "). No near-today date literals in tests (rot on
  rollover) - dynamic offsets.
- Diagnosis discipline: state the falsifying observation and gather it before editing; a
  device-failed fix means the diagnosis was WRONG - re-root-cause, never re-patch.

---

## 6. Definition of done (the arc closes when)

- `wc -l server.js` < 3,000; the top-10 giant functions live in tested `lib/` modules.
- `DOC_KV_NAMESPACES` and `SINGLETON_NAMES` are gone; `doc_kv` + `doc_single` tables
  dropped; no shipped code references `db.json`.
- Genuine marker count 0, lint-enforced; test ratio >= 1.48:1; full suite green on both
  Node versions.
- Every wave device-passed by Dean on his real library; this plan moved to
  `docs/exec-plans/completed/`.
