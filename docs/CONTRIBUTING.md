# Contributing

Coding standards and conventions for this project. All agents read this file.

Dev, CI, and Docker all target **Node.js 22 LTS**. Use the pinned version via
`.nvmrc` / `.node-version` at the repo root (e.g. `nvm use` / `fnm use`) so
local runs match CI and the `node:22-alpine` Dockerfile base image — running
tests on a newer local Node (e.g. 24) can mask timing-sensitive test bugs
that only surface on 22 (see the CI workflow).

## Language & framework

- **Language:** JavaScript (Node.js 22 LTS; `engines` >=22.13.0 - node:sqlite needs it)
- **Framework:** Express 4 (backend); vanilla JS + DOM on the frontend (no build tooling)
- **Package manager:** npm

## Commands

| Action | Command |
|--------|---------|
| Install | `npm ci` |
| Run | `npm start` (`node server.js`) |
| Build | — (interpreted; no compile step) |
| Test (all) | `npm test` |
| Test (fast/unit) | `npm run test:unit` |
| Lint | `npm run lint` |
| Format | — (no formatter configured) |

## Code style

- 2-space indentation, semicolons, single-quoted strings
- CommonJS modules (`require` / `module.exports`) — no ESM, no TypeScript
- `camelCase` for variables and functions; `SCREAMING_SNAKE_CASE` for module-level constants (e.g. `DATA_DIR`, `TRANSCODE_DIR`)
- Vanilla frontend: plain DOM APIs in `public/js/`, no framework or bundler
- Comment the *why*: the codebase favors explanatory comments on non-obvious logic (transcode flow, Range requests, iOS quirks)
- Keep server logic in `server.js`; keep per-page client logic in `public/js/<page>.js`

## Styling: the design-token system (MANDATORY for any CSS/JS style change)

FileTube's styling runs on a governed design-token system (built up
across v1.56.0-v1.59.0; contract in
`docs/references/design-token-audit-v1.1.md`).
If you touch a color, spacing, radius, z-index, shadow, motion, type, or
control-size value ANYWHERE (style.css, `<style>` blocks, `el.style.*` /
`cssText` / `setProperty` in JS), the rules are:

- **Never write a raw literal in a governed property. Consume a token**
  (`var(--space-*)`, `var(--yt-red)`, `var(--radius)`, `var(--z-*)`,
  `var(--scrim)`, `var(--dur-fast)`, ...). The token layer lives at the top
  of `public/css/style.css` (`:root` + the `[data-theme]` era blocks); many
  tokens are ERA-VARYING by design - adopting one means your surface follows
  the eras, which is the point.
- **z-index:** only the nine `--z-*` ladder names; backdrop/content pairs
  derive with `calc(var(--z-X) +/- N)`. Never a new raw rung. Local
  in-component stacking (0-40 band) stays literal with a
  `token-exempt: local stacking` comment.
- **The linter is the drift detector, and since v1.62.0 it is THE
  RATCHET:** the census reached ZERO at v1.61.0 and is enforced there -
  `node scripts/css-token-lint.js --enforce` runs in pre-commit and CI,
  and ANY raw literal in a governed property FAILS the commit. Either
  adopt a token or, if the value is genuinely outside the system
  (positional geometry, era skin art, a legibility floor), annotate the
  line `/* token-exempt: <reason> */` and be prepared to defend the
  reason in review. `npm run lint:css` is the report-only view of the
  same census.
- **Never define a new token casually:** a new name joins the contract doc,
  the `:root` layer, AND `test/unit/token-scale-lock.test.js` (the byte-exact
  value authority) together - see `--thumbnail-bg` (Tier 4) for the pattern.
  `--accent`/`--accent-color` are ruled NEVER-DEFINE (consume `--yt-red`).
- **Do not edit token VALUES in passing** - a scale value change re-renders
  every consumer and fails token-scale-lock loudly; that is a design
  decision (Dean's), not a refactor.
- Every raw literal still in the census is enumerated with its reason in
  `docs/exec-plans/completed/2026-07-31-tokens-tier4-ledger.md` (bound by
  `npm run ledger:check`); `npm run lint:css` prints the current count -
  the ledger's unstruck rows and that number are the same set by
  construction. Breakpoints are documented constants, not tokens;
  width/height layout geometry is ungoverned by design (two ruled
  exceptions: `--header-h`/`--sidebar-w`, whose coupled sites are the
  point).

### Every rendered element must have a styling SOURCE - "none" is a finding

Ruled by Dean after v1.68.3: the v1.67 card-corner `<select>`s shipped with
a className that had NO CSS rule behind it and rendered browser-bare beside
six properly-tokened siblings - through the cleanest gate on record. The
instruments are structurally blind to this: the census only sees literals
PRESENT in declarations (absence is invisible), and gate seats review code,
not pixels. Two more selects were bare the same way (the move modal's, and
the ytdlp failures filter's orphan `form-input` class); the one-off modal
had shipped the same bug earlier and its point-wise fix left the class
open. The rules, for ANY new control or surface:

1. **Find the existing pattern FIRST.** Enumerate what the system already
   has for that element type and leverage it (selects: the base `select`
   element rule, `.setup-select`, `.btn`, scoped modal rules). Two surfaces
   rendering the same affordance must SHARE declarations, never hand-roll
   parallel stylings - if they must live in separate rules, add a mirror
   lock (`test/unit/panel-chrome-mirror.test.js`, the queue/notif
   clear-button precedent).
2. **No pattern exists? Prefer a base element-level rule** over a new
   one-off class - make the styled path the DEFAULT so forgetting a class
   can never ship a bare control again (the v1.68.3 base `select` rule
   precedent; specificity 0-0-1 so every class pattern still wins).
3. **A className with no CSS rule binding it is a DEFECT, not a stub -
   flag it.** Implementers: before shipping a new className, verify a rule
   binds it or a base element rule covers the element. Reviewers: for
   every new className in a diff, run that same check - it is one grep,
   and it is exactly the check every automated instrument cannot do.

### Every fetch-then-render surface reveals ONCE - no blank-then-pop (MANDATORY)

Ruled by Dean during the v1.98/v1.99 shimmer sweep: "any loading moment without
shimmer is the defect ... shimmer is beautiful ... it should feel like a modern
React app." This is now part of the design contract, not just a cleanup pass -
the same standing as the design-token rules above.

The rule, for ANY new surface (or any change to one) that renders from data
fetched AFTER first paint - a list, grid, card, count/badge, injected control,
image, or a whole view:

1. **Seed a reserved-space skeleton-shimmer BEFORE the await; reveal ONCE.**
   Paint the placeholder into the host before the fetch; the real
   `host.innerHTML = <markup>` (or DOM build) on resolve IS the single reveal.
   Never leave the host blank until data lands, never a bare spinner, never a
   layout that reflows as pieces arrive.
2. **Reuse the REAL box model so the reveal is ZERO-SHIFT.** The skeleton reuses
   the real container + the reserved-aspect box class (the `buildSkeletonGrid`
   discipline; lesson #7 - measure the box, never guess CSS-var heights). Match
   the EXACT shape the branch will reveal, per sub-state (a persisted tab/filter
   is a COLD landing, not just an in-app switch - v1.98 music-artists scar).
3. **STRAND-SAFE.** Every DATA exit clears the seed - success, EMPTY result, and
   ERROR/catch - so a failed first load shows the empty/error state, never a
   forever-shimmer. An aborted/navigated-away view may instead rely on the SPA
   teardown discarding the host node (only when that host is genuinely rebuilt on
   re-entry, e.g. the modern-home chrome); if the host can OUTLIVE the abort,
   clear on abort too.
4. **No FLASH-BACKWARD.** Do not re-seed a shimmer over already-loaded content on
   a refresh/re-render (guard on "is the real content already present?" - v1.98
   podcasts scar). A genuine new load (new query) may re-seed.
5. **Reuse the toolkit, don't rebuild it:** `.skeleton-shimmer` +
   `@keyframes skeleton-sweep`, `buildSkeletonGrid`, the `data-loading` reveal-
   once barrier (v1.96), synchronous seed-paint (v1.52 instant watch). Long-
   running JOBS (transcode) may keep a determinate progress affordance - the one
   disclosed exception to "no bare spinners."

Reviewers: for every new fetch-then-render surface in a diff, verify the seed +
zero-shift reveal + strand-clear exist - it is the exact check the census cannot
do. The FOUC audit (`docs/exec-plans/archive/fouc-shimmer-audit.md`) tracks the
remaining retrofit; NEW work ships compliant from birth.

### Every view/pane swap owns its scroll - the top is visible on arrival (MANDATORY)

Ruled by Dean (v1.164) after the same bug class shipped twice: the watch page
opened scrolled-under the header (fixed in v1.160 with `scrollRestoration ->
'manual'` + an explicit reset), then the settings master-detail push-in did the
exact same thing (a long nav list's scroll offset survived into the just-opened
section, hiding its title and back arrow under the app header).

The rule, for ANY change that swaps what fills the viewport - an SPA route, a
master-detail push-in/back, a tab/filter that replaces the page body, a
full-screen panel:

1. **Identify the REAL scroller by measurement, never assumption.** On mobile it
   is usually the WINDOW; a container's `scrollTop = 0` is a silent no-op unless
   that container actually overflows (the settings bug shipped with exactly that
   no-op in place). If the scroller differs by breakpoint, reset BOTH.
2. **Forward navigation lands at the TOP.** The new surface's heading and its
   primary controls (a back arrow) must be visible without scrolling.
3. **Backward navigation RESTORES the saved offset.** Save the scroller's offset
   at the moment of forward navigation, re-save on every forward pass (never a
   one-shot latch), and restore it on back - the user returns to their place in
   the list (iOS-Settings style).
4. **Bind it behaviourally.** Stub the scroller, drive the swap, and assert the
   reset AND the restore fire with the right values (see
   `test/unit/master-detail.test.js` "SCROLL OWNERSHIP"). A presence-grep of
   `scrollTo` is not the lock; the VALUES are.

Reviewers: for any diff that adds or reroutes a viewport swap, ask "which element
scrolls here, on EACH breakpoint - and who resets/restores it?" If the answer
names a container, demand the measurement that shows it actually overflows.

## The first-class media experience (MANDATORY vocabulary for any media-kind work)

FileTube serves several media KINDS - videos/ytdlp, music, books,
podcasts. The ytdlp/video experience is the REFERENCE: it defines what
"first-class" means, and every other kind is measured against it.
Codified 2026-08-03 (Dean's ruling); the capability list is the
contract, the per-kind standing is audited per wave, never assumed.

A first-class media kind delivers ALL of:

1. **A place.** A browsable surface (grid or list drill-in), reachable
   from the sidebar Library section (content-gated injection) AND
   walkable from a fresh install - a human's first path in must exist
   (the v1.69.1 lesson: no instrument checks "how does someone first
   get here").
2. **Bottom-bar presence.** An item in the customizable mobile bottom
   bar - in `BOTTOM_NAV_OPTIONAL`, reorderable/hidable (and, where
   ruled, default-hidden) via the Settings editor.
3. **The one queue.** Entries ride the SINGLE global playback queue
   (`entry_kind` carried, never inferred), advance IN and OUT of the
   kind correctly, and appear in the queue panel/up-next with
   kind-correct art and destination (`queueEntryHref` is the only
   INTENDED derivation - guarded legacy fallback arms still exist at
   the player/watch seams, bound by source lock). (v1.72: the kinds
   are 'media' | 'podcast' | 'track'; books do not queue - Dean's
   ruling, a non-goal not a gap. Cross-kind advances consult
   autoplayNext; same-kind advances are unconditional.)
4. **The global Liked playlist.** Content can be liked, and a liked
   entry surfaces in THE Liked playlist (the `/?liked=1` surface, its
   count-gated sidebar entry, and - opt-in - a bottom-bar entry).
   (v1.72: the playlist is MIXED-KIND - videos, podcast episodes,
   music tracks and books all surface, kind CARRIED on every item;
   the per-kind like carriers stay the write authorities.) (v1.75,
   Dean's ruling: a kind-scoped Liked lane inside the place is not a
   complement either - it is REDUNDANT and is now a defect to add.
   The podcasts Liked card/lane and the music Liked tab were removed;
   each showed a SUBSET of what the central playlist already shows in
   full, with its own drift (tech-debt #93). One read surface, N write
   surfaces: the per-kind HEART is how content enters the playlist and
   stays on every row.)
5. **Resume.** Per-user position persisted server-side; leaving
   mid-entry and returning resumes; in-progress entries surface in a
   home Continue row that deep-links back to the exact entry. (v1.72:
   videos joined the Continue-row pattern - Dean ruled the reference
   kind's missing row a GAP, not a non-goal; delivered by all four
   kinds.)
6. **Played/consumed state.** A per-user watched/played latch, both
   automatic (threshold) and manually toggleable. (v1.72: videos
   gained the manual toggle - POST/DELETE /api/watched/:id, the watch
   page action bar; books gained a MANUAL-ONLY finished latch (no
   auto threshold - a text position's "end" is format-dependent,
   tracked); MUSIC has no played latch at all - an open ruling, not
   an oversight: tracks have no consumption page to host the toggle
   and the port target is not obvious. See the tech-debt tracker.)
7. **Save to device.** A per-entry download affordance serving the
   original bytes with an attachment disposition through the shared
   `contentDispositionAttachment` helper.
8. **Recoverable delete.** Every destructive verb is a trash move with
   restore + retention - never a bare unlink (the
   every-delete-is-recoverable law). Per-user state survives trash and
   retires only on purge.
9. **Background play.** Playback survives navigation (the docked
   mini-player) and locked-device/background listening works.
10. **The full player.** An expanded now-playing view (the type:'audio'
    cover-art mount or the watch page), reachable in one gesture from
    the dock.

Standing rules that ride this list:

- **New capability, every kind.** When a wave adds a capability to one
  kind, the exec plan must state where every OTHER first-class kind
  stands on it - delivered, gapped (tech-debt row), or ruled
  not-applicable by Dean. Silence is not a standing.
- **Per-user state = the id-keyed-carrier law.** Every per-entry table
  wires ALL its arms in the birth commit (migration, statements,
  accessors, delete carrier, backup export/restore/validation, test
  reset, carrier tests) - see `lib/auth/store.js`'s carrier history.
- **Not-applicable is a ruling, not an inference.** Books do not
  obviously queue; whether that is a gap or a non-goal is Dean's call,
  recorded, never assumed. (v1.72 rulings on record: books queue /
  background play / full player = NON-GOALS; everything else is real
  for books.)
- **The Playlists surface is kind-extensible.** Pins know channel
  folders, book shelves and podcast shows (v1.72, Dean's ruling 5) -
  each source owns its routes and reducers, merged and TAGGED at
  fetchAllPins, dispatched per source at unpin/reorder. A new kind's
  natural container should expect the same treatment (a ruling to
  take at its intake, not an inference).
- **Onboarding a NEW media kind (the future-agent contract).** A new
  kind is not shipped "with a place and we'll see": its exec plan
  walks ALL TEN capabilities up front, machine-derived, and every
  cell lands as DELIVERED, GAPPED (a tech-debt row the day it ships),
  or NOT-APPLICABLE (Dean's recorded ruling). The templates to port,
  by capability: sidebar injection + fresh-install door (1), the
  BOTTOM_NAV_OPTIONAL/default-hidden pair in every shell (2), an
  entry_kind arm through reduceAdd/getQueue/setQueue/restore/
  shapedQueue/queueEntryHref plus a kind-scoped queue-delete carrier
  (3), a liked carrier + a shapedLiked<Kind>Items arm with the kind's
  own silent-drop rule (4), a progress carrier + home Continue row on
  the shared chassis (5), a latch with the podcast toggle contract
  (6), ?download=1 through contentDispositionAttachment (7), the
  trash lifecycle (8), the dock lists in shouldDockOnTransition -
  BOTH copies (9), and a type:'audio'/watch full mount (10). Per-user
  tables obey the id-keyed-carrier law in their birth commit; same-id
  cross-kind collision tests keep BOTH rows live at the destructive
  moment; every new per-user route family gets second-session
  wrong-user assertions the day it is born.

## Reordering: ONE gesture layer (MANDATORY, Dean's ruling 2026-08-04)

> "I think that should be our standard for these sortable things. We should
> leverage the same logic, etc. that we have for the sidebar drag and drop.
> I don't want to reinvent the wheel."

Any list a user can reorder is wired with `wireReorderable`
(`public/js/common.js`). Not a copy of it, not a variant of it.

**One surface does not yet obey this rule, and the rule is written knowing
that**: the playback queue panel (`public/js/common.js`'s `queue-row-move`
buttons -> `POST /api/queue/reorder`). v1.76 migrated the six surfaces Dean's
ruling named; the queue was never in scope and keeps its up/down buttons.
Tracked as tech-debt #111 with a revisit trigger. Stated here because the
adversarial gate found this section asserting a universal that was false in
the same file as the helper - a standard nobody can trust is worse than no
standard.

- **Never native HTML5 drag** (`draggable="true"`, `dragstart`/`dragover`/
  `drop`, `DataTransfer`). It does not fire on iOS touch AT ALL. Five
  surfaces shipped that way between v1.15.0 and v1.75.0 and were, on a
  phone, decoration. `test/unit/reorder-single-mechanism.test.js` is a
  census over `public/`, `public/js/`, `lib/ytdlp/client/` and
  `lib/ytdlp/views/` (non-recursively - `public/vendor/` is deliberately
  out) and will fail the commit that brings it back. Note what the census
  CANNOT do: it enumerates `rowSelector:` sites, so it only ever sees
  surfaces already on the helper. It can prove nobody went back to HTML5
  drag; it cannot prove a new list did not appear with up/down buttons.
- **Never up/down buttons as the reorder UI.** Dean, on them: "those just
  suck." THREE lists had them at v1.75.0 - the Setup directory list, the
  bottom-bar editor and the queue panel; v1.76 removed the first two.
  Keyboard access is not a reason to keep them - pass a `handleSelector` and
  the helper makes that handle focusable with arrow-key reorder.
- **The drag styling must be UNSCOPED.** The lock requires a rule whose
  selector is exactly `.your-row.dragging` (and the two `drag-over-*`
  indicators), not a container-scoped one - a scoped rule for one surface
  would otherwise stand in for another that shares its base class. If a
  surface legitimately needs container-scoped drag styling, the lock fails
  the build, deliberately: change the lock in the same commit and say why.
- **The helper decides nothing about ordering or persistence.** It hands you
  `(fromIndex, toIndex)`; you call `moveArrayItem` (plus
  `rebuildFullFolderOrder` where a hidden subset is in play) and persist
  however that surface already persists. Surfaces legitimately differ: the
  Setup wizard list waits for its Save button, every sidebar persists on
  drop. Preserve the surface's posture; do not flatten it into the helper.
- **Partitioned lists pass `groupOf`.** A drop across groups must be refused
  outright, not filtered afterwards - see the pinned sidebar, where a mixed
  id list once tail-dropped every book pin.
- **Each surface keeps its own drag CSS class family** (pass `classes`), so
  adopting the helper never changes what an existing rule means.
- **Bind it by execution, not by presence.** jsdom has a working
  `PointerEvent` constructor; what it lacks is layout, which is why the
  helper takes an injectable `measure`. "DOM drag events are untestable" was
  true of `DataTransfer` and is not true here - a new surface gets a jsdom
  test that drives real pointer events and asserts on what is persisted.

## File naming

- Lowercase, single-word or hyphenated filenames (`server.js`, `watch.js`, `docker-compose.yml`)
- Client scripts live in `public/js/` named after the page they drive (`watch.js` ↔ watch page)

## Testing

- Framework: **`node:test`** (Node's built-in runner) + `node:assert`. No extra runtime deps.
- Layout:
  - `test/unit/` — pure logic and DB helpers (`needsTranscode`, `getMediaId`, `matchRootFolder`, `loadDatabase`/`saveDatabase`, `reconcileTranscode`).
  - `test/integration/` — HTTP tests that boot `app` on an ephemeral port against an isolated temp `DATA_DIR`.
- Isolation: each test file sets `process.env.DATA_DIR` to a fresh temp dir **before** `require('../../server')`. The runner gives each file its own process, so there is no shared state. Tests never touch real project data.
- `server.js` exports `app` and the pure helpers; it only starts listening / scanning under `require.main === module`, so importing it is side-effect-free.
- **Every new feature or bugfix ships with tests.** Add a regression test for each bug you fix. Keep FFmpeg out of the core suite (it isn't installed on CI runners).
- Gates: `pre-commit` runs lint + unit tests; `pre-push` and CI run lint + the full suite (Node 22).

## Git conventions

- Branch naming: `feature/<name>`, `fix/<name>`, `refactor/<name>`
- Commit messages: imperative mood, descriptive, no generic messages
- Use HEREDOC format for multi-line commit messages
- Co-author trailer: `Co-authored-by: Claude <noreply@anthropic.com>`
- Never force-push. Never use `--no-verify`.
- Stage files explicitly — never `git add .`

## Definition of done

- [ ] Code compiles/builds without errors
- [ ] All existing tests pass
- [ ] New tests cover the change
- [ ] Lint passes with zero warnings
- [ ] No TODO/FIXME introduced without a tracking issue
