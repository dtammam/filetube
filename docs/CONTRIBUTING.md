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
   place a destination is derived).
4. **The global Liked playlist.** Content can be liked, and a liked
   entry surfaces in THE Liked playlist (the `/?liked=1` surface and
   its count-gated sidebar entry) - a kind-scoped Liked lane inside
   the place is a complement, never the fulfillment. (As of
   codification this is delivered ONLY by videos; podcasts have the
   lane half - tech-debt #94.)
5. **Resume.** Per-user position persisted server-side; leaving
   mid-entry and returning resumes; in-progress entries surface in a
   home Continue row that deep-links back to the exact entry.
6. **Played/consumed state.** A per-user watched/played latch, both
   automatic (threshold) and manually toggleable.
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
  recorded, never assumed.

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
