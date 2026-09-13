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
    through an independent connection. 14 existing test files touched (7 re-seed a
    non-empty count through the store, 6 just drop the now-refused empty doc key, 1
    switches a read); new `test/unit/media-view-counts-store.test.js` (API, migration +
    idempotency + the 2^53 drop, save-lock, all bulk seams incl. rollback and the
    both-shapes precedence, the test read, source locks) and
    `test/integration/view-counts-carriers.test.js` (the gate's donated bindings: hard
    delete + purge reap the row, bundle validation refuses before the wipe incl. 2^53
    and 1e300, a `__proto__` view is 404).
  - Baseline after: doc_kv **12**, doc_single 18, total **30**, schema **21**, server.js
    **19,095** (+54 - the post-commit carrier calls and their comments outweigh the
    removed doc carries; the weight leaves in Wave 6/7, not here). `dbJsonRefFiles`
    drifted 15 -> 16 in the first commit (the store header named the file literally; QA
    W3) and is back to **15** after the reword - the metric counts literal mentions, so
    prose in new modules must not name db.json.

### Wave 2 - `progress` + `deleteTombstones` -> relational  (SOLO, full gate)
- Per-id semantics + tombstone semantics (19 + 12 refs). `media_progress`,
  `media_delete_tombstones`. Proves the per-id + delete-sweep pattern end to end.

### Wave 3 - `trash` -> `media_trash`  (SOLO, FULL gate, data-loss sensitive)
- 33 refs, restore path, backup bundle. Adversarial briefed to destroy trashed-item
  recovery. Extract `trashItem` / `restoreTrashItem` into `lib/media/trash` as it moves.

### Wave 4 - config singletons, batched  (full gate)
- `settings` (48), `folders` (39), `folderDisplayNames` (22), `liked` (12),
  `folderSettings` (10) -> `settings` (KV or typed columns), `folders`, `folder_display_names`,
  `media_liked`, `folder_settings`. Extract `moveItemToFolder` into `lib/media/folders`.

### Wave 5 - feature catalogs, batched (sub-waved per feature)  (full gate)
- The `books.*`, `music.*`, `podcasts.*`, `tv.*`, `ytdlp.*` content namespaces (each
  already has a `lib/<feature>` owner) -> relational tables owned by that module. May
  ship as one sub-wave per feature if the batch is too large for a single gate.

### Wave 6 - `metadata` -> `media_items`  (SOLO, FULL gate, adversarial destroys the catalog)
- The crown jewel: 172 refs, 284 rows, written by the 1,533-line `runScanDirectories`.
  New `media_items` table; extract the scan into `lib/scan/` as small tested functions
  (the player.js standard). Verify a full backup round-trip and a rescan-rebuild BEFORE
  and AFTER. This wave sheds the most `server.js` weight.

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
