# Desktop Music actions menu (video-parity Extras on /music)

**Owner:** main session · **Requested by:** Dean · **Status:** ACTIVE (started 2026-09-09)

## The ask (Dean)

On the DESKTOP `/music` now-playing view there is no way to Share, and none of
the other per-item actions a VIDEO gets. Dean noticed it on chaptered
YouTube-downloaded `.mp3`s (a single file split into `::c` chapter tracks - e.g.
NESTALGIA "Ocarina of Time EPIC MARIACHI"). He wants "the same options you'd get
for videos (transcript if detected, playback speed, watch, reheat, etc.) if
relevant." Trigger: a new button in the TOP TOOLBAR (next to Pop out / Shuffle /
Scan). Dean's explicit steer: **reuse the existing machinery - DRY, no second menu.**

## Why the surface is empty today (root cause)

The Extras subsystem (build + all action handlers) lives INSIDE the mobile skin
engine's `create()` closure in `public/js/skin-surface.js` (~282-595), tied to the
skin's sticker DOM. The engine instance (`inTabEngine`) is created only when a
MOBILE skin renders (`music.js` `renderNowPlayingSkin`). On desktop no skin
renders, so no engine exists, so there is no menu to open. Not a data/`youtubeId`
gap (an earlier investigation misread `db.json`, which this repo does not use - it
is SQLite; that finding is void).

## Approach: (D) minimal extraction into a shared factory

Extract the Extras ACTION CORE into a second factory exported from
`skin-surface.js` - `FileTubeSkinSurface.createExtrasMenu(cfg)` - and leave the
skin's two-page sticker chrome as a thin wrapper in the engine. The desktop
trigger in `music.js` instantiates the SAME factory against a desktop container,
reusing the SAME view hooks music already defines. `skin-surface.js` is already
loaded on `/music`, so no new `<script>` wiring. One implementation, two thin
callers. Rejected: (A) run the skin engine "menu-only" on desktop (fights the
desktop layout + the "never both live" viewport invariant; drags in wheel/skin);
(C) a desktop-local re-implementation (duplicates battle-won gates - TOCTOU token,
reheat poll, delete two-flow, like/watched flip-only-on-2xx - and drifts; violates
the repo's one-truth/SHELL-PARITY lessons).

### The three couplings to parameterize (everything else is already cfg/`window.*`)
1. Menu container: `panel.querySelector('[data-skin-sticker-menu]')` -> `cfg.getMenuEl()`.
2. `closeStickerMenu()` on navigating actions -> `cfg.close()`.
3. Two-page "Back" chrome: `extrasBackHtml` prefix + the `data-sm-page==='extras'`
   open-guard -> `cfg.backHtml()` (skin: the Back button; desktop: `''`) and
   `cfg.stillOnPage()` (skin: the page-attr check; desktop: `!menuEl.hidden`).

Hoist the two PURE helpers `escapeHtml` and `fmtTime` (currently inside `create()`)
to module scope so both factories share them.

## Task breakdown (each independently testable, committed green before the next)

1. **Hoist `escapeHtml`/`fmtTime` to module scope** in skin-surface.js. Pure move;
   existing suites (`skin-surface`, `music-sticker-menu`, `music-sticker-extras`) green.
2. **Extract `createExtrasMenu(cfg)`**; rewire `create()` to consume it via the
   three seams. PURE move - mobile markup/dispatch/guards byte-identical.
   `music-sticker-extras.test.js` is the lock; it must pass UNCHANGED.
3. **CSS lift**: move the `.mms-sm-*` item rules out of `@media (max-width:768px)`
   so the desktop menu is styled; keep the mobile-only POSITIONING inside the query;
   give `#music-actions-menu` its own desktop anchor. Source-lock the scope.
4. **Desktop trigger + wiring**: `music.html` `#music-actions-btn` + `#music-actions-menu`
   in `.music-toolbar-actions`; `music.js` instantiates `createExtrasMenu` reusing
   `extrasBaseId`/`extrasEligibleView`/`afterExtrasMutation`; toggle + delegated
   `[data-skin-x]` dispatch + outside-click/Esc close. Behavioral test at DESKTOP
   viewport: hidden until a library-backed track is expanded; open fetches
   `/api/videos/:baseId`; each action drives its REAL endpoint (anti-INERT); TOCTOU.
5. **Watch row**: hoist the `watchBack` closures (`music.js` ~801-817) to named
   `watchBackVisible/Tap`; compose into the desktop menu; sticker path unchanged.
6. **`updateActionsBtn` gating** wired into the `updateNowPlayingPanel`/`updatePopoutBtn`
   seam; hidden in the docked/no-track branch; `destroy()` tears the desktop
   instance down on view swap (reheat poll must never outlive the view).
7. **RESOLVED (redundant - not built):** Per-chapter Share is ALREADY served on
   desktop music by the player's NATIVE chapters menu (`player.js` ~6818 per-chapter
   share icon; music.html carries a chapters button). Adding it to the actions menu
   would double-expose it - so it is deliberately NOT duplicated there. The actions
   menu gives song-level Share + share-at-current-time; chapter-level share stays in
   the chapters menu. (Original note kept below for the record.)
7b. **(superseded by 7)** Per-chapter Share - NEW work, not parity (today's
   `extrasShare` is song + at-current-time only). FIRST verify the desktop player's
   native chapters menu (`player.js` ~6818) does not already surface per-chapter
   share for `::c` music; if not, extend the shared `extrasShare` to append
   per-chapter entries from the queue's `library-chapter` siblings via
   `withShareStartTime`. Lands on BOTH surfaces (consistent). Deferred unless cheap.

Speed stays in the settings cog (lowest risk, no duplication).

## Test plan
- Source-locks: the desktop path reuses the SAME `data-skin-x` action set + endpoints
  (no divergent markup); the CSS-scope lock (task 3).
- Behavioral (desktop harness, non-mobile matchMedia): expand a `source:'library'`
  track, open the menu, assert the fetch + per-action dispatch (like/watched
  POST/DELETE, queue, transcript, reheat, move/delete), the eligibility gate (native
  track -> hidden), outside/Esc close, and the TOCTOU guard (advance mid-fetch -> nothing).
- Regression: `skin-surface` + `music-sticker-menu` + `music-sticker-extras` pass
  UNCHANGED (the mobile-skin + pop-out + podcasts byte-behavior guarantee).

## Top risks
1. Mobile/podcast/pop-out regression via the shared engine - land task 2 as a pure
   move with green suites BEFORE any desktop code.
2. CSS scope (unstyled desktop menu) - task 3 source-lock.
3. TOCTOU predicate divergence (desktop has no `data-sm-page`) - `stillOnPage()`
   must express "menu open AND same base id live"; test explicitly.
4. Reheat poll lifetime - desktop instance `destroy()` on cross-view swap.
5. Watch/eligibility drift - HOIST the shared functions, never re-type them.
6. Per-chapter share redundancy vs the native chapters menu - verify before task 7.

## Machine-checked predictions (re-verified each commit)
- Existing engine test count UNCHANGED after task 2 (pure move).
- `grep -c 'data-skin-x' public/js/skin-surface.js` action set identical before/after task 2.
- No `.mms-sm-act` selector nested under `@media (max-width:768px)` after task 3.
