# Software Developer — Task 8 of 8: docs + AC accounting (NO functional code)

You are the software-developer agent for FileTube. Implement **ONE task only** —
Task 8 below — then stop and report. Tasks 1-7 (all server machinery, the four API
routes, and the setup.html UI) are merged and build-verified; this final task is
**documentation + acceptance accounting only**. **NO functional code changes.** If you
discover a real bug that needs a code fix, STOP and flag it for the EM rather than
silently fixing it inside this docs task.

## Read first
- `docs/exec-plans/active/2026-07-05-settings-automation-cache.md` — the exec plan.
  Its `## Acceptance criteria`, `## Behavior changes vs current production`, and
  `## Progress log` are what you'll finalize.
- `docs/ARCHITECTURE.md` — the principal-engineer already refreshed the stale
  "unbounded cache" note in the design stage; verify it's accurate and decide whether the
  new subsystems warrant a brief additional mention (see below).
- `README.md` — Features (~19), env-file / Quick Start (~55-95), the "Settings" mention
  (~91). `.env.example` (referenced at README:58) is where `FILETUBE_CACHE_CAP` /
  `TRANSCODE_CACHE_MAX_BYTES` lives — read it to describe the env-var↔UI-cap relationship
  accurately.
- `ROADMAP.md` — "Planned" has a **"Transcode cache safety"** item (line ~10, size cap +
  LRU eviction) that is now largely shipped/extended; "Shipped" section starts ~14.

## Scope of Task 8 (docs + accounting only)

### 1. `docs/ARCHITECTURE.md`
- Confirm the cache note is current (no longer says "unbounded"). If the new subsystems
  aren't yet reflected, add a **tight** mention (a sentence or two / a bullet — no essays)
  for: the server-side **`db.settings`** persistence in `db.json`; the settings-driven
  **`armScanTimer`** replacing the old hardcoded interval; the **age-retention sweep
  (`sweepAgedTranscodes`) + `db.metadata[id].lastServedAt`** layered on the size-cap LRU;
  and the new **`/api/settings`, `/api/cache/size`, `/api/cache/clear`** endpoints. Only
  add what genuinely aids a future reader — don't duplicate the exec plan.

### 2. README.md / docs-facing surface
Document the new **Settings → Automation & Storage** controls, accurately and tightly (no
marketing fluff):
- The new controls: auto-scan interval (**default 30 minutes**, Off/30m/1h/6h/12h/24h),
  the "Remove entries for deleted files during scan" prune toggle (**on by default, with
  the mount-loss guard** — never prunes a library whose drive is unmounted), age-retention
  (Off/7/14/30/90 days, default 30), the cache-size display + "Clear cache now", and the
  size-cap control.
- The **`FILETUBE_CACHE_CAP` / `TRANSCODE_CACHE_MAX_BYTES` env var ↔ UI cap relationship**:
  the env var remains a valid default/override; the UI cap, when set, takes precedence; a
  blank UI cap means "use the env var / 5 GB default." State it exactly as it behaves
  (verify against the T2 `effectiveCacheCap` semantics and `.env.example`).
- Put these where they fit best (a short "Settings / Automation & Storage" subsection under
  Features or Quick Start). Keep the existing README structure/tone.

### 3. `ROADMAP.md`
- Move the **"Transcode cache safety"** Planned item to **Shipped** (or mark it done),
  since the size cap + LRU was already shipped and this feature adds age-retention + a UI +
  the configurable dir relationship. Add a concise Shipped entry for **Automation & Storage
  settings** (auto-scan interval, guarded prune, cache age-retention/size/clear controls).
  Match the existing Shipped-entry style. Don't over-claim — describe what actually shipped.

### 4. Final AC accounting in the exec plan
- Go through the exec plan's `## Acceptance criteria` (all 6 items + zero-regression). For
  each, annotate/confirm which are **[UNIT]/[INTEGRATION] covered by tests** (cite the test
  file — `database.test.js`, `settings-helpers.test.js`, `scan-api.test.js`,
  `scan-prune.test.js`, `age-sweep.test.js`, `settings-cache-api.test.js`, `gb-bytes.test.js`)
  vs **[MANUAL]** (deferred to Dean's on-device pass + the two-reviewer QA). A short
  checklist or a "Coverage" note per group is fine — don't rewrite the AC.
- Confirm the two intentional behavior changes (10min→30m default; unconditional-unsafe
  prune → guarded/toggleable) are documented in `## Behavior changes vs current production`
  (they are — just verify accuracy).
- Add a dated `## Progress log` entry summarizing T1-T8 shipped, the final test count, and
  "ready for the two-reviewer QA gate."

### 5. The stale icon-sets stub — LEAVE IT
`docs/exec-plans/active/icon-sets.md` is a RETIRED pointer stub (its full plan already lives
in `docs/exec-plans/completed/icon-sets.md`). **Do NOT git rm it in this task** — the EM has
flagged it in state for the main loop to `git rm` at the PR/commit step. Don't touch it.

## Out of scope
- ANY functional code change (`server.js`, `public/js/*`, `public/*.html`, `public/css/*`,
  test logic). This is docs + exec-plan accounting only. If a doc claim doesn't match the
  code, fix the DOC to match the code — do not change the code. If the code is actually
  wrong, STOP and flag it.

## T8 acceptance criteria ([PROCESS])
- README / ROADMAP / ARCHITECTURE updated, accurate, and tight (no fluff; claims match
  actual behavior, esp. the env-var↔UI-cap precedence and the two defaults).
- Exec plan AC accounting complete ([UNIT]/[INTEGRATION] vs [MANUAL], with test-file
  citations) and the two behavior changes confirmed documented; dated progress-log entry added.
- `npm run lint` 0 errors; `npm test` **fully green (expect 168)** — confirm no test changed
  behaviorally (docs task).
- No functional code diff (git diff shows only docs/markdown + the exec plan).

## When done
Report a concise summary: which docs you changed and the key additions (README Automation
section, ROADMAP shipped entry, any ARCHITECTURE mention), the exec-plan AC-coverage
annotations + progress-log entry, confirmation that the icon-sets stub was left untouched,
and the final `npm run lint` + `npm test` results. This is the last implementation task — after
the EM routes the build-specialist to verify T8, the feature goes to the two-reviewer QA gate.
Do not edit `.state/feature-state.json` (EM owns task status).
