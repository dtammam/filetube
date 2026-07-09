# Product Manager — Discovery: v1.24 "UX Round" (PLAN-GATED, complex)

You are the Product Manager for a LARGE, plan-gated UX round. Your job in this
stage is **Discovery only**: produce a grounded requirements + execution list
for Dean's approval **before any implementation**. Do NOT write application or
test code. Do NOT touch git.

Read first, in order:
1. `.state/feature-state.json` (the full round framing — `fr_groups`,
   `out_of_scope`, `hard_constraints`, `clarification_questions_for_dean`,
   `review_tier_proposed`, `grounding_pointers`). This inbox summarizes it but
   the state file is authoritative.
2. `docs/CONTRIBUTING.md` and `docs/RELIABILITY.md` (standards + testing +
   the "no automated E2E; on-device is the arbiter" posture).
3. `ROADMAP.md` — the Planned sections are the source for the pulled-in items;
   the Shipped section is essential context (many items reference prior rounds).

## The round in one paragraph

v1.24 is a single branch (`feature/v1.24-ux-round`, off `main` at v1.23.10)
bundling ~25 user-experience improvements: 9 coordinator-briefed FRs PLUS all
remaining UX items from `ROADMAP.md`'s Planned sections. It is deliberately one
branch and deliberately large. This is `/kickoff-complex`: you produce the full
grounded EXECUTION LIST first, Dean approves it, THEN we build in collision-free
waves. Nothing is implemented until Dean approves the plan.

## What to produce (the Discovery exec plan)

Write `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md` containing:

- **Goal / Scope / Out-of-scope / Constraints** (pull constraints from the state
  file's `hard_constraints`; pull out-of-scope from `out_of_scope`).
- **FR clusters** — organize the ~25 items into coherent FR groups by DOMAIN
  (the state file's `fr_groups` A–G is a starting cut: downloads/yt-dlp,
  subscriptions, library/discovery, player-adjacent mobile UX, mobile polish,
  visual polish, mock-comments). De-dup overlaps (e.g. FR-3 already folds in
  ROADMAP "Clearer download progress" + "Make yt-dlp errors visible"; favicon
  appears in both the briefed set and ROADMAP). Do NOT just list 25 loose items.
- **Acceptance criteria per FR** — tight, outcome-focused, verifiable. Group by FR.
- **A PROPOSED BUILD ORDER in collision-free waves** — quick wins first, then
  heavier / security-sensitive, then data-architecture. Note file-overlap seams
  so the EM can later split into parallel tasks that don't collide. Keep it ONE
  branch.
- **One-branch-health assessment** — plan for one branch by DEFAULT. If the total
  is genuinely too big to be one healthy branch, SAY SO explicitly and propose a
  phased split (by wave) for Dean to decide. Do not silently split.
- **Open clarification questions for Dean** (see below) — surface these
  prominently; the coordinator will get Dean's answers EARLY, before you
  finalize. Where an answer changes the shape of an FR, note the fork.
- **Conflict check** — verify nothing in scope conflicts with CONTRIBUTING.md
  mandatory standards or the OUT-of-scope exclusions (especially: do NOT scope in
  player CONTROLS or the in-player CC toggle if it touches the control bar).
- **Decision log.**

Then update `.state/feature-state.json`: set `artifacts.requirements` and
`artifacts.exec_plan` to the exec plan path, and append a Discovery history entry.

## Ground everything against live code before finalizing

The state file's `grounding_pointers` map each domain to real files. Verify each
item against the live code — do not restate the brief. Key seams:

- **Security core (Group A):** `lib/ytdlp/url.js` — `validateChannelUrl`
  (`ALLOWED_HOSTS` allowlist, `FORBIDDEN_CHARS`, `CHANNEL_PATH_PATTERNS`,
  `classifySingleVideo`, `isSafeVideoId`/`buildWatchUrl`). `lib/ytdlp/args.js` —
  arg-array builders, the `--` separator, `SHORTS_MATCH_FILTER` (~L310),
  `buildMatchFilterArg` (~L347). NO `shell:true` ever. Widening the allowlist
  (FR-1) must NOT weaken injection safety — heaviest adversarial gate.
- **Disabled-module no-op:** every yt-dlp FR must preserve the guarantee that
  with `FILETUBE_YTDLP_ENABLED` off, no new route / UI / DOM is reachable.
- **Subscriptions + pins (Group B):** `lib/ytdlp/store.js` (gated subs + pins),
  `lib/ytdlp/client/subscriptions.js`, `lib/ytdlp/views/subscriptions.html`,
  pins routes (`/api/subscriptions/pins`). NEVER write `db.folders`.
- **FR-4 reconcile:** `lib/ytdlp/index.js`
  `matchChannelDirToSubscription`/`backfillChannelIdentityFromFolder`, the
  server.js Phase-2 scan mutator, `resolveChannelDir`; one-off downloads land in
  the download root's synthetic folder. Cross-reference the completed v1.22
  player-parity exec plan (FR-2 creator re-association) in
  `docs/exec-plans/completed/`.
- **Folder DnD to mirror (FR-8):** `common.js`
  `moveArrayItem`/`computeDropIndex`/`rebuildFullFolderOrder`,
  `test/unit/folder-dnd-reorder.test.js`.
- **`.section-actions` row (FR-2):** `public/index.html` ~L108.
- **Mock comments (FR-9) — SEAM CORRECTION:** the pool is the `commentBank`
  array in `public/js/watch.js` `getMockInitialComments()` (~L864), NOT
  `common.js`. `common.js` holds the adjacent `getMockViews`/`getMockSubCount`/
  `getCommentCount`. Design the "Zak Goldin" weighting (87% polite / 10%
  unhinged / 3% conspiracy-about-the-video) deterministically and tastefully.
- **Favicon:** all four shells carry SVG + PNG `rel=icon` (PNG added v1.22.2) +
  apple-touch-icon + manifest, but NO `favicon.ico`. Four-shell parity discipline
  (public/index.html, public/watch.html, public/setup.html,
  lib/ytdlp/views/subscriptions.html).

## Clarification questions to surface EARLY (flag, don't assume)

These are in `clarification_questions_for_dean` in the state file. Surface them
prominently in the exec plan and note where each answer forks an FR:

1. **FR-1 site-scope** — which sites, and explicit expanded allowlist vs
   deferring to yt-dlp's extractor list? Multi-site for SUBSCRIPTIONS or ONLY
   one-off downloads?
2. **FR-2 button action** — what does the per-subscription action button DO
   (re-pull this channel now / open its settings / unsubscribe / pin)?
3. **FR-4 approach** — virtual grouping by `channelUrl` vs physical file move
   (auto on subscribe), or both?
4. **FR-7 failing example** — can Dean share one or two failing URLs / a log
   snippet so root cause is pinned, not guessed?
5. **Subtitles/CC fit** — GRAB side only (sidecar/embedded) and DEFER the
   in-player CC toggle button (touches player controls = excluded), or defer the
   whole subtitles item? Advise; do not assume.
6. **"Playlists" label** — the bottom-nav Playlists button already shows a text
   label; which control did Dean actually mean?
7. **Release/upload date as DEFAULT sort** — making captured release date the
   DEFAULT home order changes everyone's default feed; confirm default vs
   just-an-option.
8. **One-branch size** — confirm Dean is OK with one big branch, or wants a
   phased split by wave.

## Guardrails

- Verify against live code; flag ALL ambiguities rather than assuming.
- Respect the OUT-of-scope list: player controls (incl. the custom-vs-native
  mobile control item), background-audio-for-video, ebooks+TTS,
  multi-user/permission-gated deletion, testing/infra + tech-debt sections. The
  in-player CC toggle leans OUT.
- Every FR ships with tests as normal (CONTRIBUTING.md) — no deferred testing.
- No new runtime dependencies; Node 22 LTS; vanilla DOM; four-shell parity for
  shared-shell changes; reuse the single `resolveMobileFormFactor` signal.
- Do NOT write application/test code. Do NOT touch git.

When done, report back to the coordinator/engineering-manager; the coordinator
will run `/prep-pe-design` after Dean's clarifications are in.
