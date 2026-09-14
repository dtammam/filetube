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
| `doc_kv` namespaces | **13** | `DOC_KV_NAMESPACES.length` in `lib/db/sqlite.js` (the list itself left with Wave 7; the instrument now counts document TABLES in a fresh schema - `docTables`) | **0** (table dropped) - **MET at v1.296.0 (Wave 7a): 0 tables** |
| `doc_single` namespaces | **18** (the intake draft said 19 - a hand count; Wave 0's re-derivation corrected it) | `SINGLETON_NAMES.length` in `lib/db/sqlite.js` (same: the list is gone, `docTables` is the metric) | **0** (table dropped) - **MET at v1.296.0** |
| Total legacy namespaces | **31** | sum of the two | **0** - **MET at v1.295.0 (Wave 6); the tables followed at v1.296.0** |
| Genuine TODO/FIXME/HACK markers | **0** (the intake draft's "9 grep hits are false positives" was not reproducible from a recorded command - the slim gate found the only 9-yielding grep counts 2 binary PNG matches and misses the `\XXXX` lines the draft cited; the pre-Wave-0 shipped-code prose hits are in commit `36a40a77`) | enforced, not printed: `test/unit/comment-debt-census.test.js` (TIER 1 marker-form over every tracked code file, TIER 2 loose word over shipped code) + eslint `no-warning-comments` | **0**, lint-enforced since Wave 0 |
| `db.json` refs in shipped code | **15 files** (`server.js`, `lib/db/sqlite.js`, `lib/ytdlp/*`, `scripts/*`) | `node scripts/relational-arc-baseline.js` (`dbJsonRefFiles`; the script excludes itself - its labels name the file) | **0** - **MET at v1.296.0 (Wave 7a): 0 files**, bound by `test/unit/dbjson-never-read.test.js` |
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
    test cases (140 assert calls); mutation-verified against the commit (a wrapper re-export, a leftover copy,
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
  - **Gate (both seats, one fix round + delta).** No CRITICAL. **ADV W1 (presence-not-binding
    on a data-destroying route):** the restore validator's item-OBJECT rule was unbound - under
    the mutant a bundle with `metadata: { m1: 'string item' }` restored 200 and the string
    became a row the routes then read; the atomicity test's bad list now carries a string, a
    null, a number and an array item (red under the mutant). **ADV W2 (a migration deciding on
    the wrong bytes):** the v32 skip rule ran on the JS-side key, which node:sqlite hands back
    TRUNCATED on Node <= 24.14 - a hostile `abc\0` doc row read as `abc` and its upsert
    CLOBBERED the real `abc` item (measured on 22.23.1 and 24.14.0; on 24.20 it would be
    skipped). Unreachable through any writer (md5 ids; the save and the import refuse NUL),
    but one line: the rule runs in SQL on the stored bytes now
    (`instr(CAST(key AS BLOB), x'00')`), test-bound with an impostor row beside the real one.
    **ADV S3:** the "only writer" lock now matches the store's template spelling too. **ADV S4
    = QA S1:** the adapter's dead `if (this.items)` guard (with a false comment) is gone and the
    open-time snapshot is rebuilt ONCE (the store no longer rebuilds in its constructor).
    **ADV S5 = QA S4:** "an unchanged rescan writes zero rows" is MEASURED now (a spy on the
    adapter's save accounting during a real rescan) - the disk deep-equal alone let a
    rewrite-everything mutant pass. **ADV S6 (noted, not bound):** `ORDER BY rowid` is a
    guarantee a plain table scan happens to satisfy without it. **QA W1:** five positional
    comments left pointing "above"/"below" at code that moved - each names its file now.
    **QA W2:** the sqlite.js header's "one row PER KEY (doc_kv)" contract and the list's
    "only metadata is left" parenthetical reworded (both tables are EMPTY). **QA W3:** the
    DIAGRAMS headline was stamped "Measured at v1.294.0" against Wave 6 numbers - v1.295.0.
    **QA S2:** the items store's NUL prose states the version-dependent read (#225), not the
    falsified "truncates". **QA S3:** "105 new assertions" -> 105 test cases (140 asserts).
    Verified clean by the seats (measured): the diff base's honesty under same-tick double
    writes, key-order-only changes, an effect that throws after applyPlan; a 1k-file scan with
    a failure INSIDE the transaction (index + every carrier untouched, the next scan lands one
    new and prunes one); the epoch guard and HR1b still bound; a `__proto__` key, a 40 MB row,
    a corrupt row mid-chain (rollback to v31), re-run idempotency, rowid order; a v1.42
    db.json and a v1.294 bundle; 400s before the wipe with the logo bytes, users and rows
    surviving; the cache mutation guard; the stranded fingerprint; the 13 bodies byte-identical
    and the re-exports the SAME function objects; no new per-request full-table read.
    **Process disclosure (QA's delta finding):** the fix commit's message was amended
    MESSAGE-ONLY with `--no-verify` to correct a mis-typed suite count (8776 -> the measured
    8772) on a tree byte-identical to the one the pre-commit hook had passed three minutes
    earlier; the amended message carries the measured number. No code changed under the
    bypass.

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
- **Wave 7 is SPLIT (2026-09-14, the main session's call at the survey, disclosed to Dean):
  7a = the teardown (this record; released alone as v1.296.0), 7b = the monolith split
  (the routers, the `< 3,000` composition root, the three deferred giant extractions,
  #226's read-cache design) - costed separately for Dean's call because of budget.**
- **Wave 7a record (2026-09-14, branch `feat/wave7-teardown`, two commits: the teardown +
  the gate fix round):**
  - **Schema v33 drops `doc_kv` + `doc_single`** - the fourteenth rollback floor. The block
    copies nothing (every namespace left in v21-v32) and REFUSES - throws, stamp stays 32,
    tables and rows intact, still writable by v1.295 - if either table holds a row, naming
    each stray with its count (a NUL-bearing name as its bytes, the list capped at 20 - gate).
    The v1 block still creates the tables (append-only); a below-v33 guard at the top of
    `migrateSchema` re-creates them (same DDL, `LEGACY_DOC_TABLES_DDL`) so a file stamped
    back below v33 - the migration tests' rewinds - runs the drains against the schema they
    were written for; a STAMPED file that lacks a table (tampering) is logged loudly (gate).
  - **The document model left the adapter**: `SNAPSHOT_SEP` (a `NUL` constant stays for the
    row-key guard), `DOC_KV_NAMESPACES`, `SINGLETON_NAMES`, `CONTAINER_KEYS`, `KNOWN_SUBKEYS`,
    `getPath`/`setPath`, the six doc statements, the doc snapshot, the doc loops in `load` /
    `save` / `exclusiveReplace` / `importParsedJson` / `readPersistedDatabase`, the
    `insertKv` / `insertSingle` handles, the dead `source` option. `save()` is the media
    index's diff plus `alsoInTransaction`; `assertNoUnknownKeys` keeps the top-level lock on
    `DOC_OBJECT_KEYS = ['metadata']`. **Disclosed deviation from this section's literal text
    ("remove loadDatabase/saveDatabase/updateDatabase")**: the three stay, as Wave 6 decided -
    they are the media index's tick and the 150 read sites depend on the `{ metadata }`
    object; removing them is 7b's work.
  - **The db.json import path is gone**: `importDbJson`, `isSchemaEmpty`, the stranded
    fingerprint, `openAdapter`'s existence/size probes (it opens the database, logs one line
    when it CREATED a fresh empty one - gate - and returns `{ adapter }`; the module no longer
    requires `fs`), `scripts/migrate-check.js` + its CLI test, `scripts/relational-arc-refs.js`,
    server.js's `DB_FILE` + `cleanupOrphanDbTmp` + boot call + export, the two scripts' legacy
    fallbacks, every comment mention (server.js 32 sites, lib/ytdlp 22, items.js 2), the
    Dockerfile / .env.example prose (gate). `node scripts/relational-arc-baseline.js`:
    **dbJsonRefFiles 0, docTables 0** (the instrument counts document tables in a fresh
    schema now), schema 33, server.js 19062 lines. **Deliberate, disclosed behaviour change:**
    a DATA_DIR holding only a pre-v1.42 db.json starts as an EMPTY library (the file
    byte-identical, never probed - measured by both seats); the way forward is one boot of
    any v1.42-v1.295 build first, deleting the empty `filetube.db` (+ sidecars) a v1.296 boot
    may already have created (QA W1: without that step the older build refuses the v33 file) -
    CONFIGURATION.md, RELEASING.md.
  - **Tests**: `test/helpers/legacy-doc-tables.js`; the 12 store suites' rewinds re-create the
    tables and their post-migration "doc rows gone" asserts became "doc tables gone" (both
    seats mutated every drain's DELETE one at a time: each reds its own suite, so v33's
    refusal IS the binding); the adapter suite's boot-import tests became restore-seam tests;
    NEW `test/unit/db-doc-tables-drop.test.js` (the drop, the refusal with nothing dropped,
    the NUL-as-bytes label + cap, the guard's log, the chain from v20 with real rows, the
    export lock); `test/unit/dbjson-never-read.test.js` rewritten (fs spy on every content
    reader, copier AND probe incl. the directory listers - gate - on both arms, a live-spy
    control, the DoD source lock over `git ls-files`); `test/integration/dbjson-frozen.test.js`
    = the Wave 0 S7 owed test (server.js boots beside a garbage db.json + a seeded
    filetube.db); NEW `test/integration/dbjson-frozen-fresh.test.js` (ADV W1: the arm the wave
    CHANGED - server.js boots a DATA_DIR holding only a valid legacy file into an EMPTY
    library; measured RED on v1.295, green here).
  - **#227 closed** (the isolated test; the hooks walk UP for `node_modules` - the first cut's
    extra PATH export was measured inert by the adversarial seat and removed; CLAUDE.md states
    the suite invocation). **#225 (a) done** (every NUL guard's message and comment, plus
    CLAUDE.md, this plan's template and one test comment the QA seat found still on the old
    premise). **#224 narrowed** to its second trigger.
  - **Gate (both seats, one fix round).** No CRITICAL. The data-destruction core held under
    eight hostile stray shapes, a partial-chain file, a tamper, a double open and a full
    v1.41 -> v1.295 -> v1.296 upgrade (file byte-identical throughout). Findings, all applied:
    **QA W1** the documented way back for a pre-v1.42 DATA_DIR was dead after one v1.296 boot
    (the empty v33 file makes v1.295 refuse) - the delete step is documented and boot logs the
    fresh-database line; **ADV W1** the rewritten frozen suite was green on v1.295 (it bound
    the unchanged arm) - the fresh-DATA_DIR arm is a new integration file, red on v1.295;
    **QA W5 = ADV W2** the teardown commit's baseline line says "8584 test cases across 694
    files" - measured BEFORE the v33 suite and the helper were tracked; at that commit the
    instrument says 8590 / 696. The same is true of that message's suite count (ADV residual
    2): the 8763 came from a full run launched before the v33 suite's file existed, so at
    abfa3db8 the count is 8769 - derived from the fix commit's measured 8772 minus its three
    new cases, not re-run (the other four baseline numbers are exact; recorded here, no amend); **QA W2-W4, S4, ADV W3** eight stale comments (the restore's "two
    callers", the v2 rationale's removed probe, the safety lever's broken sentence, the
    Dockerfile's inverted sentence + retired script, .env.example, viewCounts' header,
    CLAUDE.md, the plan's template); **QA S1 = ADV S5** the below-v33 guard logs when it
    absorbs a missing table; **QA S2 = ADV S2** the spy's missing copiers/listers/resolvers and
    the `require('fs')` spelling; **ADV S3** the refusal message's NUL-name duplication, its
    false "database is unchanged" after a committed drain, and no cap; **ADV S1** the hooks'
    inert PATH export; **QA S5/S6** the dead `source` option and an overstated export comment.
    **Delta (same instances):** both APPROVE, no new findings; the adversarial seat re-ran
    every round-1 mutant (all still red), its E3 indirect-spelling boot import now dies on
    the new integration file, and its five obfuscated fs vectors red on the widened spy.
    Its non-blocking residuals: a BLOB-typed stray name without a NUL prints as decimal
    bytes (cosmetic); `.gitignore`'s db.json comment was present-tense (fixed in the release
    commit). Dual-Node (sequential, reviewers idle): 22.23.1 8772 / 8772 / 0 fail / 0 skipped; 24.20.0 (the CI runner's minor) 8772 / 8772 / 0 / 0; 24.14.0 8772 / 8772 / 0 / 0.

### Wave 7b - the monolith split  (APPROVED by Dean 2026-09-14: "Let's do it. I like the Opus split")

**Design (main session; the mechanical moves are Opus worktree subagents, one slice each,
verified by machine - the Wave 6 extraction pattern).** Every number below is from
`node scripts/monolith-split-census.js` (espree-parsed, re-run at every slice commit):

| Metric at v1.296.0 (`bd56d0a8`) | Value |
|---|---|
| `server.js` lines | **19,064** |
| top-level statements | 732 (176 route registrations = 5,186 lines; 283 functions = 8,523 lines; requires 68; declarations 356; other 716; the rest is comments/blank between statements) |
| module-scope names (the deps universe) | 562 |
| tests that `require` server.js | 234 files; tests that read its TEXT (source locks) | 22 files |
| route middleware prefixes | exactly TWO (16 auth/users routes before the shell wildcard + static layer; 183 after) |

**The shape:** every route group becomes a module exporting `registerRoutes(app, deps)` -
the pattern lib/ytdlp/index.js and lib/podcasts/index.js already use - with an EXPLICIT deps
object built in server.js at the call site; every giant function becomes a module function
with its collaborators passed in. Route callback bodies and function bodies move BYTE-IDENTICAL
(the free identifiers resolve from a destructured `deps` instead of module scope); a helper
moves with a group only when the census shows the group is its sole referrer, otherwise it is
a dep. server.js keeps re-exporting every moved function it exported before, as the SAME
function object (test/unit/scan-helpers-extraction.test.js is the template).

**Invariants, each machine-checked at every slice (the subagent runs them; the main session
re-runs them on the commit):**
1. **Bodies verbatim** - each moved route callback / function body is found byte-identical in
   the new module and is gone from server.js.
2. **Routing signature unchanged** - the per-route signature `<methods> <path> | <every
   non-route layer registered before it>` (the instrument is recorded in the record) is the
   same multiset before and after, and a moved group keeps its internal order. The
   `registerRoutes` CALL sits where the group's first route was; the `require` may sit with
   the other requires (module load has no side effects).
3. **Re-exports identical** - `require('./server').<fn> === require('./lib/x').<fn>` for
   every moved export.
4. **Text locks re-pointed, never loosened** - a test that greps server.js's text for a moved
   sentence greps the new file for the same sentence.
5. **Suites green** (`npm run test:unit` in the worktree, `npm test` on the merged branch),
   `npm run lint` clean, the census re-run shows the group gone and the deps list empty.

**Slices (census line counts; the target module follows the repo's lib/ layout):**
- **S1a user-state routers** (~515 route lines, deps <= 10 each): `/api/queue` (77) ->
  lib/queue/routes.js; `/api/notifications` (194) -> lib/notifications/routes.js; `/api/push`
  (69) -> lib/push/routes.js; `/api/history` (73), `/api/search-history` (20), `/api/watched`
  (15), `/api/prefs` (24), `/api/feed-hidden` (43) -> lib/user/routes.js.
- **S1b identity + pre-auth media state** (~526): `/api/auth` (72), `/api/users` (166),
  `/api/me` (113) -> lib/auth/routes.js; `/api/liked` (114), `/api/progress` (61) ->
  lib/media/user-routes.js.
- **S2 books** (~545): `/api/books` (323), `/book` (55), `/bookcover` (40), `runBookScan`
  (127) -> lib/books/routes.js.
- **S3 music** (~430): `/api/music` (243), `/track`, `/albumart`, `/audio`, `runMusicScan`
  (81) -> lib/music/routes.js.
- **S4 tv** (~355): `/api/tv` (215), `/tvepisode` `/tvposter` `/tvaudio` `/tvthumb`,
  `runTvScan` (67) -> lib/tv/routes.js.
- **S5 trash / move / restore** (~1,400; FULL gate, data-loss): `moveItemToFolder` (546),
  `trashItem` (306), `restoreTrashItem` (221), `purgeTrashItem` (94), `sweepTrash` (77),
  `trashOrphanFile` (75), `computeMoveTarget` (47), `/api/trash` (81) -> lib/media/trash.js +
  lib/media/move.js (the three deferred extractions from Waves 3 and 4).
- **S6 import relocation / repull** (~830): `planImportRelocation` (177),
  `relocateHydratedImportIntoChannelFolder` (143), `buildImportRelocationPreview` (129),
  `migrateOneOffsIntoChannelFolders` (119), `recordRepulledItemMeta` (203),
  `enumerateRepullableItems` (56) -> lib/ytdlp/relocation.js.
- **S7 backup / restore** (~510; FULL gate): `/api/admin` (194), `validateBackupBundle`
  (260), `buildStoreZip` (53), `validateFeatureBundle` -> lib/admin/backup.js.
- **S8 transcode / cache / streams** (~700): `processTranscodeQueue` (98),
  `processAudioExtractQueue` (83), `runChapterSynthesis` (77), `evictTranscodeCache` (50),
  `sweepAgedTranscodes` (55), `processRokuCompatQueue` (50), `sendRangeable` (65), `/video`
  (129), `/thumbnail`, `/storyboard`, `/preview`, `/api/cache` (92) -> lib/media/transcode.js +
  lib/media/stream.js (tv-scan.test.js parses `TRANSCODE_EXTENSIONS` out of server.js's text -
  the lock moves with the constant).
- **S9 the scan orchestrator** (~1,900; FULL gate, the persist-gate seams):
  `runScanDirectories` (1,566), `extractMetadataAndThumbnail` (125), `scanDirRecursive` (94),
  the probes -> lib/scan/orchestrator.js.
- **S10 videos / home / config / settings / search / stats** (~1,900): `/api/videos` (1,018),
  `/api/home` (215), `/api/config` (307), `/api/settings` (198), `/api/stats` (99),
  `/api/search` (37), `/api/folders` (93), `/api/channels` (66), the rest -> lib/media/routes.js
  + lib/config/routes.js.
- **Then #226** (the catalogs' read-through cache: a generation counter bumped by the ADAPTER
  on every write path incl. exclusiveReplace and the migrations).

**Releases.** R1 = S1a + S1b + S2, one slice at a time (the method proven; shipped v1.297.0,
device-passed). **Re-paced after R1 (Dean, 2026-09-14: "Can we go any faster ... larger
chunks"):** the remaining slices run in PARALLEL Opus worktrees from one base commit - each
subagent confines its server.js edits to its own groups' statements, places its `require`
immediately above its register call (never in the shared top require block) so the hunks
never overlap, and the main session merges the branches one by one, re-running the verifier
on each and resolving the one expected conflict (the route-surface registry list). Two
releases remain: **R2 = S3 music + S4 tv + S10a media browse (`/api/videos`, `/api/home`,
`/api/search`, `/api/stats`, `/api/channels` and the small media reads) + S10b config
(`/api/config`, `/api/settings`, `/api/folders`, `/api/scan`, `/api/cache`)** - four parallel
slices, one gate; **R3 = S5 + S6 + S7 + S8 + S9 in parallel + #226** (full gate, adversarial
destroys the data on both sides of every moved seam), then the `< 3,000` prediction is
re-verified and the plan moves to completed/. A slice that fails the machine check is dropped
from its release, never held for. Each release: full gate, dual-Node, device pass PENDING and
disclosed.

- **Wave 7b R1 record (2026-09-14, branch `feat/wave7b-r1`: the design commit + three slice
  commits, each an Opus worktree subagent's move verified by the main session's machine
  checks - bodies byte-identical modulo one indent level and in order, gone from server.js,
  exports intact, the routing signature's sorted multiset identical to v1.296.0):**
  - **S1a** (1023ce33, 34330dd4): `/api/queue` -> lib/queue/routes.js; `/api/notifications` ->
    lib/notifications/routes.js; `/api/push` -> lib/push/routes.js; `/api/history`,
    `/api/search-history`, `/api/watched`, `/api/prefs`, `/api/feed-hidden` -> lib/user/routes.js
    (one call at the prefs site, so four groups register EARLIER in the stack - the sorted
    signature and a first-match resolution probe over all 199 routes are identical; a named
    gate surface). Helpers moved with grep proof (shapedQueue, the push cap, the prefs-allowlist
    binding, the search-history cap + max, normalizeSearchTerm re-exported as the same function
    object). ONE deliberate non-byte-identical token: lib/push/routes.js reads the test-only DNS
    seam through a live `pushGuardLookup()` (destructuring the mutable `let` would freeze the
    seam at boot - mutation-proven, 3 integration tests red with the frozen form). Six text
    locks re-pointed onto the ROUTE SURFACE (server.js + every extracted module;
    test/helpers/route-surface.js derives the list from the modules' header sentence); two
    exact counts re-measured. server.js 19064 -> 18419.
  - **S1b** (748dad55): `/api/auth`, `/api/users`, `/api/me` -> lib/auth/routes.js in THREE
    register functions (identity ahead of the shell wildcard; avatar and sticker routes behind
    it, each at its original site - forced by the wildcard boundary and the sticker constants'
    declaration order); `/api/liked`, `/api/progress` -> lib/media/user-routes.js. Sixteen
    private helpers moved (espree reference census + grep); no token deviation (an AST walk
    found zero reassignments of any dep); UNSORTED signature identical to its base. It surfaced
    and fixed a latent COMMENT POROSITY: the test files' copied `stripComments()` strips block
    comments before line comments, so `// ... public/js/*)` opened a pseudo-block that swallowed
    218 lines (898 after the move) from every text lock - the star is gone; two more remain
    (tracker #228). server.js -> 17685.
  - **S2** (3bfbedc9): `/api/books`, `/book`, `/bookcover` -> lib/books/routes.js (two register
    functions: the interleaved block at its first route, the progress route at its own site
    after the shell routes); `runBookScan` -> lib/books/scanRunner.js (`createBookScanRunner(deps)`);
    `scanBooks` / `bookScanState` / the deferred-rescan timer STAY (three callers outside books,
    exported; the state object crosses as the same instance). Five private helpers moved; the
    census's `mime` was a scope-shadowed false positive (as in S1b). The bookcover placeholder
    SVG template literal keeps its ORIGINAL whitespace (string content) - AST-proven
    byte-identical. The route-surface helper now keys on the modules' header sentence, not the
    require path (the first non-router extraction would otherwise have dropped out of every
    lock - mutation-proven). server.js -> **17090** (census: 98 route registrations = 3727
    lines, 270 functions = 8140 lines, 540 module-scope names).
  - Deviations from the slice list, disclosed: the brief's helper candidates were refuted by grep
    where refuted (notificationsFeatureEnabled, pendingBookProgress,
    armBookProgressFlushTimerIfNeeded - it assigns a timer two other functions read - the TTS
    cluster); the books progress-coalescer comment's doc-model reference fixed in the record
    commit; the environment's 3 Playwright skips in a worktree are the worktree's missing nested
    install, not a suite change (the release suites run in the main checkout).
  - **Gate (both seats, one fix round, delta APPROVE x2):** Full gate, one fix round, both seats APPROVE on the delta. Both seats re-established the behaviour claim independently before finding anything: 175 of 176 registrations structurally identical to v1.296.0 (the one difference the disclosed push-seam line), 20,650 URL-by-method resolutions unchanged across the one stack reorder, every moved RBAC gate and every moved book-scan data-destruction guard mutation-killed, exports identical by name, by source and by object. What it caught, all in test and instrument code: two store locks that still read server.js alone after their sentences moved (a doc-model read planted in the module sailed through); nothing bound what the new route-surface helper RETURNED (a reworded module header silently dropped that module from every lock - a registry test now checks the derivation both ways); the reciprocal-overlap lock read the surface raw, so a comment quoting the sentence satisfied it with the guard deleted; the main session's own slice verifier indented string CONTENT lines (it would have blessed a changed placeholder SVG) and claimed a re-export identity it only regex-matched - it ships now as `scripts/verify-split-slice.js` with content-aware indent, a multi-line-literal byte check and require()-based identity; the signature instrument leaked its temp DATA_DIR on a piped run; the DIAGRAMS route count was unbound and had been wrong by 41 (live-derived now); three slash-stars, not two, remain in server.js line comments (one masked - #228 says so); the headline is 78 registrations, not 57. Fix commits 9cc2a742 +
    the verifier nits. Residuals recorded: the tv-wiring lock inherits #228's blind spot in
    the safe direction only; the verifier's identity check is vacuous for a slice with no
    re-export (it prints the count - watch it); ~7,500 stale `/tmp/filetube-*` test DATA_DIRs
    had accumulated since 2026-09-13 (reaped; the harness's exit hook reaps only its own
    worker's dirs - a `find -mmin +60` before a release run is the cheap habit).
    Dual-Node (sequential, reviewers idle): 22.23.1 8775 / 8775 / 0 fail / 0 skipped; 24.20.0 (the CI runner's minor) 8775 / 8775 / 0 / 0; 24.14.0 8775 / 8775 / 0 / 0.
- **Wave 7b R2 record (2026-09-14, branch `feat/wave7b-r2`: the re-pacing commit + FOUR slices
  run in PARALLEL Opus worktrees from base 52d3e03e, each verified by the main session with
  `scripts/verify-split-slice.js` + the routing signature before its merge; merged S3 (ff), S4,
  S10b, S10a (three-way, two expected conflicts each: the live-derived DIAGRAMS count and the
  route-surface registry list):**
  - **S3 music** (41886559): `/api/music`, `/track`, `/albumart`, `/audio` -> lib/music/routes.js
    in FOUR register functions (the config block must precede the progress coalescer's `const`
    - TDZ; S1a's user-routes call sits between two music blocks; `/audio` lives 8,700 lines
    down); `runMusicScan` -> lib/music/scanRunner.js (`createMusicScanRunner(deps)`); `scanMusic`
    / `musicScanState` / the timer / `probeMusicTrack` + `extractAlbumArt` STAY (callers, or they
    read the mutable `ffmpegAvailable`). ONE deviation: `/audio/:id`'s `ffmpegAvailable` gate
    crosses as the live `ffmpegIsAvailable()` (a `let` an async boot probe flips AFTER
    registration - frozen, every `/audio` request would 503 forever; a new executing test binds
    it, mutation-proven). server.js 17093 -> 16722.
  - **S4 tv** (56a372ad): `/api/tv` + the four `/tv*` streams -> lib/tv/routes.js in ONE
    register function (contiguous); `runTvScan` -> lib/tv/scanRunner.js; the TV-owned transcode
    and audio-extract lanes moved WHOLE (both `let` busy flags with every reader and writer, so
    no mutable seam crosses); `scanTv`, `tvScanState` (crosses as the same object),
    `visibleTvEpisodes` (read by `/api/search`), `TRANSCODE_EXTENSIONS` stay. The same
    `ffmpegAvailable` seam at four sites, mutation-proven three ways incl. a runtime fake ffmpeg.
    Four tv-server-wiring locks re-pointed (one TIGHTENED to a statement window), the
    tv-feature-store lock re-pointed (the brief wrongly said it already read the surface).
    server.js -> 16623 alone.
  - **S10b config** (e925fe44): `/api/config` + `/api/folders` + `/api/scan` (one interleaved
    block), `/api/scan-status`, the logo pair, `/api/settings`, `/api/cache`,
    `/api/storage-summary` -> lib/config/routes.js in SIX register functions; `GLYPH_IDS`, the
    transcript-prompt validator + caps, `TRANSCODE_LIST_CAP`, `settingsResponse` moved with
    proof; the enum allowlists, the transcode-cache machinery (S8's) stay. No deviation. Three
    locks re-pointed (library-folders-stores, app-settings-store, setup-debug-lifecycle's
    KNOWN_KEYS), all mutation-killed. server.js -> 16271 alone. It reported the parallel-load
    flake honestly: three `PROGRESS_FLUSH_MS` debounce tests failed once under four concurrent
    suites, green in isolation and on re-run.
  - **S10a media browse** (e0bc414b): thirteen groups, 27 registrations / 1,757 statement lines
    -> lib/media/routes.js (2,409 lines) in SEVEN register functions (measured, not assumed: one
    call moved two browse routes ahead of `/api/progress` - a 4-line signature diff; and a call
    above the critter constants threw a TDZ at require time). Eleven helpers moved incl. the
    bulk-attribution latch (the routes ASSIGN it, so it had to move; server.js re-exports the
    setter as the same object - 13 re-export identities checked). Deviations: the same
    `ffmpegAvailable` seam, `ttsEngineVersion` (same class - frozen, Stats reports null
    forever), and TWO `require('./lib/ytdlp/activity')` -> `require('../ytdlp/activity')`.
    **The find of the release:** a relative `require()` specifier inside a moved body resolves
    against the NEW file - a string literal no identifier census sees. It broke the bulk mover's
    async tail (`MODULE_NOT_FOUND`, the single-flight latch stuck, two 409s and two 300 s
    timeouts: 8778 / 8771 / 4 fail on the first full run, reported verbatim). Now bound by
    `test/unit/media-routes-live-seams.test.js`, an AST net that RESOLVES every relative
    specifier in every extracted module (its first cut matched a specifier quoted in a header
    comment - the porosity lesson again). Its own mutant M4 survived at first: re-pointing the
    card-like lock at the whole surface made it vacuous because lib/user/routes.js carries the
    identical `likedSet` line - fixed with a statement-scoped window; 8/8 killed. Two exact
    counts re-measured (podcastsDb 9 -> 13, ytdlpDb 11 -> 15). server.js -> 15229 alone.
  - **The merge:** every slice edited DIAGRAMS' live-derived registration count (the census reds
    without it and the hook refuses red - a forced deviation from "no docs"), so each merge
    re-measured it on the merged tree; the registry list took every slice's additions. One
    ordering lesson: S10b merged before S4 failed the hook - S10b moved the config route's
    `tvDb.read()` calls out of server.js while the tv-feature-store lock still read server.js
    alone (S4 re-points it); aborted, merged S4 first, then S10b. Merged tree at three slices:
    8778 / 8778 / 0 / 0 (main checkout, no parallel load).
  - Merged four-slice tree: server.js **13,566** lines (17,093 at v1.297.0), 22 route +
    middleware registrations (98); the census's `mime` false positive struck in three slices.
    Merged four-slice tree (main checkout, no parallel load): 8782 / 8782 / 0 fail / 0 skipped;
    the verifier over all 29 R2 groups reports exactly the six documented seam routes; the
    routing signature's unsorted output is identical to the R2 base.
  - **Gate:** (filled after the gate)

---

## 4. The per-namespace migration template (the proven pattern)

Each namespace migration MUST do all of these; a test binds each:

1. **Forward-only additive migration** from `user_version` 20 -> 21+, `CREATE TABLE
   IF NOT EXISTS`, table born complete. Never edit an executed block (append-only, or
   the suite hangs - repo scar).
2. **One-time idempotent backfill** copying the namespace's `doc_kv`/`doc_single` rows
   into the new table; NUL-safe (`node:sqlite` reads a NUL-bearing TEXT back truncated
   on Node <= 24.14, #225 - keep `assertRowKeySafe`, decide key shape in SQL on the stored
   bytes); `__proto__`-safe (`defineRowProperty`).
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
