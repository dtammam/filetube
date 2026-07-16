# handoff-harness v2 proposal — "lean harness"

A proposal for the next revision of
[handoff-harness](https://github.com/dtammam/handoff-harness), distilled
from ~65 FileTube releases (v1.26 → v1.41.x) run in lean mode after the
v1 pipeline was retired. Companion to `lean-mode-methodology.md` (the
portable spec of WHAT to operate); this doc is about WHAT THE HARNESS
REPO SHIPS and how v1 installs migrate.

## 1. Scorecard: what v1 got right vs what practice rejected

**Keep (proven valuable):**

- The **one-liner install + `/seed` auto-detect** flow. Hydrating a repo
  with docs skeleton + placeholders + a stack-detecting seed pass is the
  harness's best idea and transfers unchanged.
- The **docs skeleton**: `docs/exec-plans/{active,completed}/`,
  tech-debt tracker, ARCHITECTURE/CONTRIBUTING/RELIABILITY templates.
  These became lean mode's durable state.
- The **quality-assurance agent** — it survived as the gate's QA seat.
- The **session-start hook** concept (context injection) — with a fix
  (see below).
- **Brownfield safety**: archive-don't-overwrite, placeholder
  preservation rules.

**Retire (ceremony that cost more than it caught):**

- **Role agents for implementation** (EM/PM/PE/SDE/build-specialist).
  Hand-offs lost context; a capable model implementing directly with an
  exec plan outperformed the relay. The durable value of multi-agent is
  review independence, not role separation.
- **Per-stage human approval.** Approval belongs at the edges: scope at
  intake, verification at the end. Modern sessions are trusted between
  those edges because the gate + honesty norms make autonomy safe.
- **`.state/` lifecycle files.** They rot and then actively mislead
  (FileTube's session hook advertised a v1.31 "active feature" ten
  releases later). State that isn't exercised by the workflow must not
  be injected into every session.
- **The two-session mobile choreography** (EM session + specialist
  session). One autonomous session + phone-friendly reports replaced it.

**Add (what v1 was missing and FileTube had to invent):**

- The **two-reviewer gate** as a first-class primitive (QA seat +
  adversarial seat, verdict protocol, delta re-confirm loop).
- **Honesty norms** written into the operating contract.
- **Persistent memory conventions** (shipped records with lessons).
- **Release ceremony** (release branch → no-ff merge → tag → honest
  shipped-log entry).
- **Data-loss escalation rule** (full gate, destroy-the-data brief,
  mutation-tested fixes for anything touching user data).

## 2. Proposed v2 contents

```text
handoff-harness/
├── install.sh                     # unchanged mechanics; installs the v2 set
├── CLAUDE.md.template             # lean-mode contract + {{PROJECT_CONFIG}} placeholders
├── .claude/
│   ├── agents/
│   │   ├── quality-assurance.md   # gate QA seat (evolved from v1's)
│   │   └── adversarial-reviewer.md# NEW: refutation seat; primary-source
│   │                              #   mandate + concrete-failure-scenario rule
│   ├── commands/
│   │   ├── seed.md                # kept: placeholder auto-detect (retargeted at v2 files)
│   │   ├── gate.md                # NEW: run the two-reviewer gate on the branch diff,
│   │   │                          #   manage fix rounds + delta re-confirm until dual-APPROVE
│   │   ├── release.md             # NEW: walk the release ceremony (bump → changelog →
│   │   │                          #   plan to completed/ → branch/merge/tag/push)
│   │   ├── commit-only.md         # kept
│   │   └── commit-and-push.md     # kept
│   └── hooks/
│       └── session-start.sh       # branch/dirty, active plans, tech-debt count ONLY —
│                                  #   nothing that can silently go stale
├── docs/
│   ├── METHODOLOGY.md             # = lean-mode-methodology.md (the portable spec)
│   ├── WORKING-STYLE.template.md  # per-human narrative: communication prefs,
│   │                              #   autonomy level, verification arbiter
│   ├── ARCHITECTURE.md / CONTRIBUTING.md / RELIABILITY.md   # kept templates
│   ├── ROADMAP.template.md        # NEW: Planned + honest Shipped-log structure
│   └── exec-plans/{active,completed,future}/ + tech-debt-tracker.md
└── legacy/                        # the entire v1 pipeline, preserved + documented
```

Notable design decisions:

1. **CLAUDE.md.template is the contract, METHODOLOGY.md is the spec.**
   The template holds the condensed lifecycle + gate + honesty norms and
   the per-repo config placeholders; the full spec ships alongside so
   sessions can consult depth without bloating the entry point.
2. **The adversarial reviewer is a distinct agent definition**, not a
   prompt the main session improvises each time. Its file bakes in the
   rules experience proved necessary: assume QA missed something too;
   read third-party SOURCE, never docs; concrete failure scenario per
   finding; for data-touching diffs, actively try to destroy data while
   keeping the suite green.
3. **`/gate` and `/release` replace the eight `/prep-*` commands.** The
   two ceremonies worth scripting are the ones that must never be done
   sloppily. Everything between intake and gate is unscripted by design.
4. **Seed gains two questions it must ask the human** (not auto-detect):
   the verification arbiter ("what does 'verified in your environment'
   mean here?") and the autonomy level (per-wave approval vs
   pre-authorized overnight runs). These go into WORKING-STYLE.
5. **No `.state/` at all.** Session context = git + docs that the
   workflow actually maintains. If a future feature needs machine state,
   it must be state some ceremony writes AND reads every wave, or it
   will rot.

## 3. Migration path for v1-installed repos (what FileTube did, v1.41.19)

1. Rewrite `CLAUDE.md` from the v2 template — lean mode first, zero
   pipeline routing instructions; keep the project-config block.
2. Archive the pipeline reference into
   `docs/references/legacy-agent-pipeline.md`; leave `.claude/agents/`
   files on disk (quality-assurance is still the QA seat) but **mark
   every retired agent and command description `LEGACY — do not
   invoke`** — descriptions are injected into every session's tool
   roster independently of CLAUDE.md, so an un-marked "use PROACTIVELY"
   orchestrator can still self-route sessions into the dead pipeline
   (the gate caught exactly this).
3. Delete `.state/` from the repo; strip the feature-state/inbox
   sections from `session-start.sh`.
4. Add the adversarial-reviewer agent definition (FileTube currently
   briefs a general-purpose agent per gate; codifying it is the v2 win).
5. Write/adopt the WORKING-STYLE narrative and METHODOLOGY spec.

## 4. Open questions for Dean

1. **Ship a memory story for non-Claude-Code contexts?** FileTube leans
   on Claude Code's persistent memory; the harness could ship a
   `docs/memory/` fallback convention (same record format, git-tracked)
   for environments without it. Recommendation: yes, as an optional
   convention — git-tracked memory also survives machine moves.
2. **Keep the v1 pipeline as an installable "classic mode"?**
   Recommendation: no — move it to `legacy/` with a README explaining
   why. Two modes doubles maintenance and reintroduces the conflicting-
   instructions problem v1.41.19 just cleaned up.
3. **How much of the gate should `/gate` hard-script?** Recommendation:
   script the protocol (two seats, verdicts, delta re-confirm loop,
   data-loss escalation) but leave the attack-surface briefing to the
   session — naming the surfaces is where the implementer's context
   earns its keep.
4. **Versioning the methodology itself.** Put a version stamp in
   METHODOLOGY.md so installed repos can diff against upstream when the
   harness evolves. Recommendation: yes, plus a `/seed --update` path
   that re-syncs templates without touching filled placeholders.
