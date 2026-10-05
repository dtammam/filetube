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

### No em dashes, anywhere (MANDATORY, Dean's ruling 2026-08-23)

No em dashes in ANY new text: UI copy, HTML (including the `&mdash;` /
`&#8212;` entities - an entity renders as an em dash and counts), docs,
comments, commit messages, release notes. Use a spaced hyphen (` - `)
instead. Pre-existing em dashes in untouched legacy text may stay, but any
line you EDIT loses its em dashes as part of the edit. This codifies a
long-standing working norm; the tell that it was needed twice: new feature
copy shipped `&mdash;` entities by matching a legacy file's local style -
file-local convention never overrides this rule.

## Styling: the design-token system (MANDATORY for any CSS/JS style change)

FileTube's styling runs on a governed design system (the token layer was
built up across v1.56.0-v1.59.0, contract in
`docs/references/design-token-audit-v1.1.md`; the UI professionalism pass
added the roles, the primitives and the linter). Three files are the
cascade, loaded in this order by every shell:

- `public/css/tokens.css` - THE token layer: the ROLES (surfaces
  `--surface-0/1/2`, ink `--ink-1/2/3`, `--accent` for red text and icons,
  `--accent-fill` for a red-filled button, `--danger`, `--indicator`,
  `--fill-selected`, `--tint-press`, `--focus-ring`, `--scrim`,
  `--separator`), written for every era x mode block; the type roles
  (`font: var(--t-body)`, `--t-caption` ... `--t-display`, with
  `--t-*-size` twins); the geometry (`--space-*`, `--ctl-sm/md/lg`,
  `--hit`, `--icon-sm/md/lg`, `--r-xs/sm/md/lg/pill`, `--av-*`,
  `--row-*`, `--inset`); motion (`--dur-fast`, `--dur-slow`,
  `--ease-ui`) and the `--z-*` ladder. Red is brand, primary action,
  progress, danger and the unread indicator ONLY; a selected state is ink
  on `--fill-selected`.
- `public/css/ui.css` - the primitives (`ui-btn`, `ui-row`, `ui-list`,
  `ui-sheet` (menus and dialogs are sheets), `ui-field`, `ui-select`,
  `ui-switch`, `ui-segmented`, `ui-chip`, `ui-avatar`, `ui-thumb`,
  `ui-tile`, `ui-toast`, `ui-state`, `ui-icon`), built from
  JS by `public/js/ui.js` (`ui.button`, `ui.row`, `ui.sheet`, `ui.menu`,
  `ui.confirm`, `ui.prompt`, `ui.toast`, `ui.field`, `ui.select`,
  `ui.switch`, `ui.segmented`, `ui.chip`, `ui.avatar`, `ui.thumb`,
  `ui.state`, `ui.icon`, `ui.setPressed`, `ui.setBusy`).
- `public/css/style.css` - feature layout, consuming the two above.

If you touch a color, spacing, radius, z-index, shadow, motion, type, or
control-size value ANYWHERE (a stylesheet, `<style>` blocks, `style=""`,
`el.style.*` / `cssText` / `setProperty` in JS), the rules are:

- **Never write a raw literal in a governed property. Consume a role or a
  scale token** (`var(--ink-2)`, `var(--accent)`, `var(--space-*)`,
  `var(--r-md)`, `font: var(--t-meta)`, `var(--z-*)`, `var(--scrim)`,
  `var(--dur-fast)`, ...). Many tokens are ERA-VARYING by design -
  adopting one means your surface follows the eras, which is the point.
  The pre-pass per-era names (`--yt-red`, `--radius*`, `--fs-*`,
  `--text-link`, `--btn-*`, `--header-bg`, `--bg-sidebar`,
  `--border-dark`, `--star-*`, `--shadow`, `--shadow-lg`, `--scrim-legacy`) are LEGACY:
  ui-lint's `no-legacy-tokens` counts a new use as new debt, so a new rule
  names the role instead.
- **z-index:** only the ten `--z-*` ladder names (`--z-sticky`, `--z-nav`,
  `--z-chip`, `--z-dock`, `--z-header`, `--z-player-max`, `--z-sheet`,
  `--z-panel`, `--z-modal`, `--z-top`); backdrop/content pairs derive
  with `calc(var(--z-X) +/- N)`. Never a new raw rung (ui-lint's
  `z-ladder` rule). Local in-component stacking (0-40 band) stays literal
  with a `token-exempt: local stacking` comment, which is itself counted
  debt (below).
- **Overlay containment (anti-bleed).** The z-ladder governs stacking BETWEEN
  surfaces; these rules stop a surface bleeding over its OWN chrome (the class
  behind v1.309-v1.310). Two invariants, enforced by the ratchet
  `node scripts/overlay-containment-lint.js --enforce`
  (`test/unit/overlay-containment.test.js`):
  - **Split clip from scroll.** A rounded overlay that scrolls puts the
    `border-radius` + `overflow:hidden` on the OUTER (clipping) element and the
    `overflow:auto` on an INNER child that has NO `border-radius`. Combining a
    non-zero `border-radius` with `overflow:auto/scroll` on one rule is the iOS
    Safari rounded-corner clip-escape shape and FAILS the census. The panels and
    sheets do this with a flex column: `overflow:hidden` on the panel, a static
    header, and `overflow-y:auto; flex:1; min-height:0` on the list (see
    `.ui-sheet` / `.ui-sheet__body` in ui.css). A surface proven to have no
    compositing-layer descendant that can reach a corner (a centered modal, a
    native `<textarea>`, a short menu) is exempted with a
    `/* corner-clip-safe: <reason> */` comment - the `token-exempt` convention.
    Never "fix" a capped scroll menu by adding a bare `overflow:hidden`: that
    clips its own content unreachable - split or exempt.
  - **A `position:sticky` element declares a `z-index`** (else it paints under
    later positioned siblings that scroll beneath it).
  - Scope isolation (`isolation:isolate`) to small row/badge containers, NEVER a
    large layout ancestor - it traps every fixed overlay inside it (tech-debt #173).
- **The linter is the drift detector, and it is THE RATCHET:**
  `npm run lint:ui` (`scripts/ui-lint.js --enforce`, plan D10 of the UI
  professionalism pass) runs in pre-commit, pre-push and CI. Its
  `no-raw-values` rule covers every stylesheet in `public/css/`, every
  shell's `<style>` and `style=""`, and every JS style write
  (`el.style.*`, `cssText`, `setProperty`, `style="..."` in a string);
  the remaining debt is listed per key in the shrink-only
  `docs/ui-exceptions.json`, and ANY new raw literal in a governed
  property FAILS the commit (paid debt must be shrunk out of the file
  with `node scripts/ui-lint.js --shrink`). Either adopt a token or, if
  the value is genuinely outside the system (positional geometry, era
  skin art, a legibility floor), annotate the line
  `/* token-exempt: <reason> */` and be prepared to defend the reason in
  review. The annotation is not free: ui-lint's `token-exempt` rule counts
  every annotation per file under the same ratchet, so a new one fails the
  commit until `docs/ui-exceptions.json` grows with it (a reviewer sees
  that), and a removed one must shrink it. The other rules the ratchet
  holds: `no-legacy-tokens`, `no-bespoke-controls` (a control-shaped rule
  or a `<button>` must be a `ui-*` primitive), `hover-gated` (`:hover`
  only inside `@media (hover: hover)`), `pressed-state`,
  `native-interaction` (user-select, the touch callout and the tap
  highlight are set ONCE in ui.css; nothing else may set them),
  `icons` (the registry only), `no-layout-transition`, `z-ladder`,
  `display-ownership`, `colour-roles` and `no-shell-style` - the header
  of `scripts/ui-lint.js` states each one. Each rule runs its canary fixtures first
  (`test/fixtures/ui-lint/`), so a broken rule fails LOUD (exit 2).
  `node scripts/ui-lint.js --verbose` is the report view. (It replaced
  the v1.62.0 token ratchet, `css-token-lint.js`, retired at the UI
  pass's step 7.)
- **Button and menu-row labels are short verb phrases.** Every menu row and action button is an action in
  1-3 words, sentence case, no full sentence, no trailing punctuation or ellipsis: "Like", "Share",
  "Add to queue", "Fix chapter times", "Move to folder". Sibling rows are the same length class. Proper
  nouns and acronyms ("Move to Trash", "Share with AI") go on the allowed list in
  `test/unit/button-label-rule.test.js`, which scans the static labels of every menu-item and
  action-button shape in `public/js` against `^[A-Z][a-z]*( [a-z0-9]+){0,2}$`. A label built at runtime
  (a time, a count) follows the rule by hand. The Pocket iPod menus keep the device's own Title Case
  names ("Shuffle Songs", "Now Playing"); they name places, and the Original is meant to look like the
  real one.
- **Never define a new token casually:** a new name joins the contract doc,
  the `:root` layer, AND `test/unit/token-scale-lock.test.js` (the byte-exact
  value authority) together - see `--thumbnail-bg` (Tier 4) for the pattern.
  The red roles are `--accent` (text, icons) and `--accent-fill` (a filled
  button); `--progress` is the progress bar's red.
- **Do not edit token VALUES in passing** - a scale value change re-renders
  every consumer and fails token-scale-lock loudly; that is a design
  decision (Dean's), not a refactor.
- Every raw literal the ratchet still allows is a keyed entry, with its
  reason, in `docs/ui-exceptions.json` (the Tier 4 ledger in
  `docs/exec-plans/completed/2026-07-31-tokens-tier4-ledger.md` and its
  `ledger:check` retired with css-token-lint: that census was zero).
  Breakpoints are documented constants, not tokens. Since the UI pass,
  width/height ARE governed (`no-raw-values` counts them; allowed are
  tokens, `%`, `vw`/`vh`/`dvh`, `fr`, `auto`, and `min()`/`clamp()`/
  `calc()` over tokens).

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
   has for that element type and leverage it: a button is `ui.button`, a
   select is `ui.select` / `ui.field`, a list row is `ui.row`, a dialog is
   `ui.confirm` / `ui.prompt` / `ui.sheet`, a menu is `ui.menu`, a toggle is
   `ui.switch` or `ui.segmented`, an icon is `ui.icon` (all in
   `public/js/ui.js`, styled by `public/css/ui.css`). Two surfaces
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

### Every phone size: nothing tuned to one device (v1.364.0, Dean: "nothing hard-coded for small OR big")

Sizes come from tokens, `%`, `vw`/`vh` (with a `vh` fallback declared before any `dvh`), `min()`/`max()`/`clamp()`,
and flex/grid that wraps. A new media query is allowed only where the LAYOUT changes (the bottom bar vs the
sidebar, one column vs two) and is written against the content's need, never tuned to one device's width. No fixed
pixel widths on containers; touch targets keep 44 px. Existing breakpoints stay as they are until an instrument
shows one broken. The net is the geometry check `VPM` (`npm run test:geometry -- --only VPM`): seven phone sizes
from 320x568 to 430x932 plus two landscapes, on home, music browse, watch, the iPod skin and Settings. Scripts are
held to iOS 15 (Dean's iPhone SE): `test/unit/ios15-floor.test.js`.

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

## Visual changes and baselines (v1.349)

The screenshot job compares every scene in `test/visual/capture.js` against its baseline. What that
means for a change:

- **A changed look: do nothing special.** The PR's visual comment shows every changed look with
  crops; review it there. After the merge the baselines refresh themselves (`docs/RELEASING.md`,
  "The visual job and baselines"). Never commit baselines by hand and never take them on a dev box.
- **A NEW surface** (a Settings section, a page, a sheet, a menu level): add its scene to
  `test/visual/capture.js` in the SAME PR. The PR comment lists it as new and the refresh adds its
  baseline after the merge. A surface with no scene is never checked.
  `test/unit/visual-settings-coverage.test.js` fails a Settings section that has no scene; a new
  section gets a scene, never an entry in that test's `UNCOVERED` list (which may only shrink).
- **A removed or renamed surface:** remove or rename its scene in the same PR.
- **A button's label, icon or count changing** is also a measured change (the geometry rules below).

## Action rows: a button NEVER deforms - measure every button change (MANDATORY, Dean's ruling 2026-08-28)

Dean: "I've burned so much time adding a button and all of a sudden
everything's offset or it's not the right size." The transcript wave found
the mechanism: a `flex-wrap: nowrap` action row that is wider than its
column does not overflow cleanly, it SHRINKS its items - a label breaks onto
two lines and every button in the row grows taller (31px -> 42px on the
watch page at 1280-1600). The rules, for EVERY row of buttons (the watch
action row, section actions, dialog actions, settings rows):

1. **A button keeps its natural size at every width.** Every button is a
   `ui.button` (`ui-btn`), which is `flex: none` with a `nowrap` label, so
   it never shrinks; the group wraps (`flex-wrap: wrap`) and overflow
   becomes a second row of correctly-sized buttons, never a squeeze. A
   stacked bar button (`shape: 'stack'`, icon over caption, the watch
   action row) keeps the `--ctl-lg` 44px floor.
2. **Adding, removing, relabelling or re-iconing a button is a MEASURED
   change, never an eyeballed one.** Two instruments:
   - `test/geometry/` (`npm run test:geometry`; the fast set runs in
     pre-push when `public/` changed, the full set in CI's visual job)
     runs G1-G4 (row columns, icon centring, equal heights in a button
     group, and the rotation sequences) on a seeded instance, each check
     mutation-proven (`--mutants`). The watch page's own measure (one top
     and one height per row, equal bar widths, a toggle's width identical
     in both states) is `test/geometry/watch.check.js`, run by hand against
     a seeded server (its header gives the command).
   - For a before/after diff of the watch action row at many widths, run
     the headless-Chromium probe against the same seeded page on both
     trees:

     ```
     node scripts/action-row-probe.js <out-dir> [widths...]      # this tree
     FT_ROOT=<path to a main worktree> node scripts/action-row-probe.js <out-dir-main>
     ```

     It boots the real app on a scratch `DATA_DIR` with a seeded captioned
     video, drives the Playwright-cached Chromium over CDP, and prints one
     JSON line per width (`x/y/w/h` of every `.watch-actions .ui-btn`, the
     rating, the title, the description box) plus a PNG clip of the action
     bar. The acceptance evidence is: every PRE-EXISTING button has the
     same `w/h` (and the same `y` unless a wrap is the intended outcome),
     and the row count is what you intended, at 390 and 375 (phones) and
     1280 / 1366 / 1600 / 1920 (desktop). Quote what the probe PRINTED,
     never what you expected: the wave that wrote this rule mis-quoted 1600
     as "one row" from a line where only four buttons had mounted (the gate
     caught it).
3. **A new button is a `ui.button`, never a bespoke element.** It takes its
   icon from the registry by name (`ui.button({ icon: 'share', label:
   'Share' })`, or `ui.icon(name)` alone); the registry is
   `public/js/icons.js`, GENERATED from `tools/icons/src` (to add a glyph:
   its Material Symbols name in `tools/icons/names.js`, then
   `node tools/icons/fetch.js` and `node tools/icons/build.js`;
   `test/unit/icons-registry.test.js` fails on a missing name). ui-lint's
   `no-bespoke-controls` fails a `<button>` without a `ui-` class and a
   control-shaped rule outside the primitives, and its `icons` rule fails
   an inline `<svg>` or a text glyph outside the registry. A toggle whose
   words change passes both `labels` (the stable-width label stack) and is
   flipped with `ui.setPressed`, so its width never changes.

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
- Gates: `pre-commit` runs lint + unit tests; `pre-push` and CI run lint, `npm run lint:ui` and the full suite (Node 22). When `public/` changed against the upstream, `pre-push` also runs the fast geometry set (`npm run test:geometry:fast`), and CI's `visual` job runs the full geometry set and the visual diff (`.github/workflows/visual.yml`, `docs/RELEASING.md`).
- **Playwright is a prerequisite for the geometry and visual runners** (and so for a push that touches `public/`). It lives in its own package, not the app's: install it once per clone with `cd tools/capture && npm ci && npx playwright install chromium`. Without it the push fails with "Playwright not found".

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
