# HANDOFF: v1.72.0 - the first-class parity wave

Paste this whole file to the new agent as its opening prompt. Read
`CLAUDE.md` first - lean mode is the contract. Dean's device pass is the
final arbiter of "done" on every wave.

---

## PACING RULE (Dean's standing correction)

Ship on CRITICAL/WARNING closure. Non-blocking SUGGESTIONs get a
tech-debt row unless they are one-liners. If any gate reaches round 3,
STOP and ask Dean whether to continue or ship with the residual
disclosed.

## STATE OF THE TREE (2026-08-03)

- `main` carries v1.70.0, v1.71.0 and v1.71.1, all shipped and tagged
  the same day (recoverable episode delete + cover fix; podcasts
  everywhere - Dean's seven items; the episode-row glyph swap). Docker
  published; Dean's device passes for all three are PENDING - probe
  lists live in persistent memory (`v1-70-0-shipped.md`,
  `v1-71-0-shipped.md`). If Dean reports probe failures, those come
  FIRST.
- `docs/CONTRIBUTING.md` now carries **"The first-class media
  experience"** - the ten-capability definition this wave exists to
  satisfy. Read it before anything else. It is the contract; do not
  re-derive or soften it.
- Open tech debt most relevant here: **#94** (hearted podcast episodes
  must surface in the GLOBAL Liked playlist - Dean's stated intent,
  effectively pre-approved), #91 (trackNav queue advance ignores
  autoplayNext - product call to raise at intake), #90 (music ended
  path awaits a queue read - disclosed), #72 (queue pointer asymmetry
  on removal), #42 (bottom-bar prefs localStorage-only). Full tracker:
  `docs/exec-plans/tech-debt-tracker.md`.

## THE JOB, in Dean's own framing

"We have this for ytdlp/videos. Some for music. Some for books. Some
for podcasts. I want ALL of it for podcasts. I want that global like."

1. **AUDIT first (machine-derived, never from memory).** For each
   non-video kind - music, books, podcasts - walk the ten capabilities
   in CONTRIBUTING's first-class definition and record DELIVERED /
   GAPPED / NEEDS-DEAN'S-RULING with file:line evidence for every
   cell. Commit the audit as the exec plan's foundation
   (`docs/exec-plans/completed/2026-08-03-v1.72-first-class-parity.md`). Numbers and
   standings must come from grep/tests, not recollection - hand
   enumerations rot.
2. **The ruled scope: PODCASTS reach full first-class.** The known gap
   is capability 4, the GLOBAL Liked playlist (#94): hearting an
   episode must surface it in the `/?liked=1` Liked playlist and its
   count-gated sidebar entry, alongside videos - the podcasts-place
   lane stays as a complement. Expect the mixed-kind problem: the
   Liked view renders media-item cards from `db.metadata`, episode ids
   are NOT media ids (the v1.69 lesson), so the view needs a
   kind-aware arm - the v1.71 queue widening (`entry_kind`,
   kind-dispatched resolution, `queueEntryHref`) is the precedent to
   follow, including preserving each id-space's silent-drop and
   carrier scoping. The audit may surface additional podcast gaps the
   ten-capability walk exposes; they are in scope for this wave.
3. **Music and books gaps: REPORT, do not build.** Present the audit's
   music/books findings to Dean at intake as numbered questions, each
   with your recommendation inline (agree/override per number) -
   including any not-applicable calls (e.g. whether books queue at
   all). Only what Dean rules IN joins the wave.
4. **Two rulings the definition itself flags for this intake** (the
   docs gate surfaced them): (a) VIDEOS have no home Continue row and
   no mark-as-watched affordance - reference gaps or non-goals, Dean's
   call (CONTRIBUTING caps 5/6 carry the honest parentheticals);
   (b) the PLAYLISTS surface (pinned folder-playlists + the sheet) has
   no capability cell - whether a podcast SHOW is pinnable there the
   way a channel folder is needs Dean's ruling, never an inference.

## BUILD NOTES (hard-won, from the v1.69-v1.71 waves)

- Podcast episode ids are md5 hex EXACTLY like media ids - kind is
  CARRIED, never inferred. Any table/route/view mixing the id spaces
  needs an explicit kind and kind-scoped lifecycle carriers, bound by
  a same-id-both-kinds collision test where BOTH rows are live at the
  destructive moment (the v1.71 W3 lesson: a re-key earlier in the
  test made the guard vacuous).
- A single-session integration harness is actor-blind: any new
  per-user route family gets a second real session
  (`__mintTestSession({username})`) and wrong-user assertions at the
  ROUTE layer the day it is born (v1.71 W4).
- Testing a DECISION is not testing its USE (struck 5+ times):
  constants, resolvers and helpers prove nothing about call sites -
  bind captured options, rendered hrefs, raw DB columns.
- Widening a shared branch changes the TIMING of every flow through
  it even when outcomes are identical - state blast radius honestly
  (the v1.71 W6/#90 lesson).
- One schema bump if multiple per-user tables are needed (v10 is
  current; the header-comment ritual and the id-keyed-carrier law are
  described at `lib/db/sqlite.js` and in CONTRIBUTING).
- Mutation-test against a COMMIT, never the dirty tree (a restore
  clobbered an uncommitted fix this very day). Capture suite failures
  with `grep "^not ok"` (Node 22) / the `ℹ` lines (Node 24) - never
  tail. Never put an unverified count in a brief or commit.
- Enforcement is SPLIT - know which checks are yours to run: the
  census (TOTAL 0) and the undefined-token lock refuse your commit via
  the hooks; but `ledger:check`, the styling-source rule (every new
  className has a real CSS rule) and the no-em-dashes norm are MANUAL
  disciplines - no instrument catches them, run them yourself before
  every commit.
- Fresh-install walk for any new surface: zero-content must render a
  sane, non-500, discoverable state.

## PROCESS (non-negotiable)

Export the fnm PATH before EVERY npm/node/git command:
`export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`

Intake questions first (numbered, recommendations inline). Exec plan
committed to `docs/exec-plans/active/`. Small task commits, each with
tests, each green. Full two-reviewer gate (per-user data + the Liked
surface = full gate, never slim; brief the adversarial seat on the
kind-confusion surface and the carrier arms). Fix rounds delta
re-confirm with the SAME reviewer instances. Dual-Node suites
(v22.23.1 then v24.14.0, sequential, reviewers idle). Ceremony:
version bump, honest ROADMAP entry, merge --no-ff, tag, push - the
Docker pull onto Dean's server is always Dean's. Memory update +
report with Dean's on-device probe list.
