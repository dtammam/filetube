---
plan: reader-desktop-header
harness: v2 · lean
branch: fix/v1.402.1-reader-desktop-header
anchor: spec
status: Shipped v1.402.1
next: the builder's Step 0, then W1
design: Ruling approved by Dean 2026-11-05 (AskUserQuestion): R1 below
gate: adversary + qa + security-brief, APPROVED r1 @a8556fc6
builder: standard
---

# v1.402.1 - on a computer, the FileTube logo and search stay at the top while a book is open

Kickoff 2026-11-05 (FileTube Root, Opus). **Builder: Standard (Sonnet).** Why the tier: one contained CSS scoping
change with a known pattern and existing source-lock tests; no stored data, no route.

## Why

Dean, 2026-11-04, desktop browser: "when I click books ... the logo in the top left disappears". Then: "Just logo, not
back on refresh, goes away when I click a book".

**Root-caused (Root, 2026-11-05, measured on main 1b68378d, headless Chromium 1440x900, one seeded book):** since
v1.44.3 the reader is "immersive": `html.reader-immersive header { display: none; }` and
`html.reader-immersive .app-container { padding-top: 0; }` (public/css/style.css ~368-369), set pre-paint by
read.html's FOUC script (~line 42) and toggled by read.js `init()` / `destroy()`. That was designed for the phone,
where the header is wasted space. On a computer the sidebar stays on screen (it is persistent at
`@media (min-width: 769px)` unless `html.is-phone`, style.css ~3573 and ~6688), so hiding the header leaves an empty
56 px strip above the sidebar where the logo was (measured: header 0x0, sidebar at y=56). Search goes too; Dean sees
"just logo" because the reader's own bar (Back, title, Contents, Aa) fills the space to the right. Books, Music,
Podcasts, History and Home all keep the logo (measured at 820 / 1024 / 1280 / 1440 / 1920 wide).

## Ruling (Dean, 2026-11-05)

- **R1 - keep the top bar on a computer.** When the sidebar is on screen (min-width 769 px and not `html.is-phone`),
  the reader keeps the shell header (logo + search) like every other page; the reader's own bar sits under it.
  Phones (max-width 768 px, or `html.is-phone` at any width, including a phone held sideways) keep today's
  immersive reading byte-identical.

## Step 0 (before any code)

- Read AGENTS.md, docs/LESSONS.md (sections 3, 4, 6 at least: the CSS / SPA client traps and the UI ratchet), the
  reader CSS at style.css ~361-370, read.html's FOUC script, read.js `init()` (the `reader-immersive` add and
  `sizeReader()`, which MEASURES the chassis top so it adapts to a visible header) and `destroy()`,
  test/unit/reader-immersive.test.js and test/unit/ipad-header-safe-area.test.js, then this plan once.
- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every
  npm/node/git command. Local suites on Node 22 only; Node 24 runs in PR CI.
- Git: work on `fix/v1.402.1-reader-desktop-header` (this plan is committed there). Stage by name, never
  `git add .`/`-A`, never force-push, never `--no-verify`, never pipe a commit or push; verify with `git log` /
  `git ls-remote`. Commit with `-F <file>`. Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`.
- **Stop rules (ask Dean with AskUserQuestion):** R1 turns out to break the reader's sizing on a computer (the page
  turn area must still fit the window with no scroll); gate round 3.

## W1 - scope the immersive rules to the phone

- Keep the `reader-immersive` class exactly as today (read.html pre-paint, read.js init/destroy): it stays the
  signal. Change only WHERE the two CSS rules apply: inside `@media (max-width: 768px)`, plus `html.is-phone`
  at any width (`html.is-phone.reader-immersive header`, same for `.app-container`). Desktop: the rules never match.
- Update the comment above them (v1.402.1, why: the desktop sidebar left an empty strip; Dean's R1).
- Update test/unit/reader-immersive.test.js's C2 CSS assertion to the scoped rules, and add: the unscoped
  `html.reader-immersive header { display: none; }` no longer exists at top level (mutate it back, watch it red).
- Check `sizeReader()` on a computer with the header visible: the reader (and v1.402.0's page-turn area) fits
  the window, no page scroll, both one-page and two-page views.

## W2 - prove it in the browser

- A headless probe (seed one book the way scripts/home-fouc-probe.js seeds books; mint a session with
  `__mintTestSession`): open /books, click the book, record header + logo + search rects and the reader chassis
  bottom vs the window height. At 1440x900: header visible, logo at its normal place, chassis bottom <= 900. At
  390x844 with mobile emulation: header hidden as today. Also a phone held sideways (844x390, `is-phone`): hidden.
  Paste the numbers into Evidence.
- `npm run lint:ui` green (no new raw literals).

## Release

Per docs/RELEASING.md: version 1.402.1, ROADMAP "Shipped" entry, `docs/releases.json` ledger in user language, a
DEVICE-CHECKS "Reader top bar on a computer (v1.402.1)" section: (a) on a computer, open a book: logo and search stay
at the top, the book fits the window; (b) back to Books: unchanged; (c) on the iPhone, open a book: still full-screen
reading as before. Close the plan with `node scripts/plan-complete.js` in the same PR. Ask Dean before `gh pr merge`.

## Out of scope

Hiding the sidebar while reading; any change to the reader's own bar; the page turn.

## Evidence

Build commit a8556fc6 (W1+W2); pre-commit hook ran the full Node 22.23.1 suite: tests 10360, pass 10359, fail 0.
- W1 mutation: re-adding an unscoped top-level `html.reader-immersive header { display: none; }` turned test/unit/reader-immersive.test.js red (pass 2, fail 1); restored: green. Targeted: reader-immersive + ipad-header-safe-area + home-mobile-scale 18/18. `npm run lint:ui` OK (TOTAL 3142, unchanged). Note: the rules moved after the main 768px block because home-mobile-scale.test.js takes the first `@media (max-width: 768px)` as the mobile block.
- W2 probe (scripts/reader-header-probe.js, Node 22; same numbers for the in-app click and the direct load; base = 698ae741 in a git-archive sandbox):
  - 1440x900: header flex 0,0,1440x56 (base: display none); search 460,10,564x36; chassis 254,80,1162x820 (bottom 900 of 900); base chassis y=24 h=876.
  - 390x844 mobile: header none; chassis 16,16,358x776 - identical to base.
  - 844x390 mobile + is-phone: header none; chassis 24,24,796x366 - identical to base.
  - Document height 924 / 864 / 414 under the reader, equal to base (pre-existing 20-24 px overflow, ROADMAP Planned > Bugs).
  - Not exercised: a two-page view on a computer (sizeReader() is view-independent; chassis bottom = window bottom).
- Gate r1 @a8556fc6: adversary, qa, security-brief all APPROVED (verdict lines above).

Gate: APPROVED r1 @a8556fc6 — security-brief
Gate: APPROVED r1 @a8556fc6 — qa
Gate: APPROVED r1 @a8556fc6 — adversary
