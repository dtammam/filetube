# Exec plan: in-view back-stack (shared primitive, Music first)

Status: ACTIVE. Owner: main session. Gate: FULL (router contract + player
machinery). Dean chose (2026-08-30): "step back within Music first," then adopt
the other media views incrementally with the SAME primitive.

## Problem (Dean's v1.216 device pass)

Pressing the iOS back-swipe (left-edge -> centre) or Android back while in Music
"brings me outside of music." Root cause, verified in source:

- The Music view (`public/js/music.js`) uses `history.replaceState` for the only
  URL churn it does (`stripNowPlayingParam`), and a **drill is pure in-memory
  state** (`var drill = {...}`; music.js ~675/1099) with **no history entry at
  all**. "Now-playing expanded" is driven by PLAYER state, not the URL.
- So Music has a **zero-depth in-app back-stack**: there is exactly one `/music`
  history entry. Back pops it and the router (`handlePopState`, common.js ~10477)
  swaps to whatever view preceded Music -> you leave the section.

Podcasts mirrors Music (same now-playing expand + replaceState) and has the same
bug; TV has drills but no history; Books/reader have chapter nav but no history.
The FIX's core is therefore a **generic, view-agnostic primitive**, adopted by
Music first (this wave), then Podcasts / TV / Books as later small waves.

## The router history model today (what we build on)

- History state shape: `buildHistoryState(view, url, scrollY, depth)` ->
  `{view, url, scrollY, depth}` (common.js:9436). `depth` = in-app levels behind
  this entry; `nextHistoryDepth(state, replace)` = current+1 on push, current on
  replace; seeded 0 at `bootRouter`. The Home control already reads `depth`.
- `navigate()` (10223) pushState's a NEW entry (depth+1) on a forward in-app nav;
  `handlePopState()` (10477) re-derives the view from the popped state and, for
  ANY view (same-view included), re-fetches `state.url` and `swapToView`s - a full
  re-init. There is NO per-view delegation today.
- `registerView(name, handlers)` (9862) stores `{init, destroy, restoreSidebar?}`
  in `viewRegistry`. `currentViewName` / `currentViewUrl` track the mounted view.
- `applyPlayerTransition(fromView, toView)` (swapToView:10011) is the ONLY place
  that docks/reparents the player across a swap. An in-view back MUST NOT trigger
  a swap, so the player is never reparented on a within-Music step.

## Design: the shared primitive

### 1. `viewState` payload on the history entry (router)
Extend `buildHistoryState` to carry an optional opaque per-view payload
`viewState` (5th arg), threaded through `parseHistoryState` (9455),
`recordScrollForCurrentState` (9876), and `navigate`'s pushState. Views that opt
in stamp their own sub-state (a drill descriptor, a "nowplaying" marker) here.
Default `null` - byte-identical for every existing caller (prove with a sweep).

### 2. A `pushViewState(viewState)` / `replaceViewState(viewState)` helper (router)
Exposed on `window.FileTube`. Pushes (or replaces) a history entry for the
CURRENT view + url, depth = nextHistoryDepth, carrying `viewState`. Push = a new
back-stack level (drill-open, now-playing-expand); replace = amend the current
level without adding one (e.g. switching tabs at the browse root). No URL change
by default (same visible `/music`), so deep-links are untouched.

### 3. A per-view `onPopState(poppedState)` delegation hook (router)
In `handlePopState`, BEFORE the fetch+swap: if `poppedState.view ===
currentViewName` AND `viewRegistry[currentViewName].onPopState` exists, call it
with the popped state. If it returns truthy ("I handled this in place"), STOP -
no fetch, no swap, no player reparent. Otherwise fall through to today's exact
fetch+swap path. Cross-view pops (leaving Music) never reach the hook (view
differs), so they behave exactly as today. Keep the `navGeneration` bump and the
scroll-restore semantics intact for the fall-through path.

### 4. Music adopter (music.js)
- On **drill-open** (the `.music-album-card`/`.music-artist-card`/`.music-artist-row`
  delegation + the `?play=`/`nowplaying` album drill): `pushViewState({t:'drill',
  drill})` so a back-entry exists. Tab switches at the browse root use
  `replaceViewState({t:'tab', tab})` (no new level - a lateral move).
- On **now-playing-expand** (player.expand into `#player-slot`):
  `pushViewState({t:'np'})`.
- Implement `onPopState(state)`:
  - If `state.viewState?.t === 'tab'` or the popped entry is the browse root ->
    if we are currently in a drill or now-playing-expanded, COLLAPSE one level
    (exit the drill to its tab, or collapse now-playing to the browse list) IN
    PLACE (mutate `drill`/call the EXISTING collapse path, re-render, return
    true). If we are ALREADY at the browse root -> return FALSE (let the router
    leave Music).
  - Restore uses the EXISTING render()/collapse code; the player is NOT
    reparented (an in-view collapse only re-docks via the existing dock path if
    that is what "collapse now-playing" already does today - reuse, never
    rebuild; the background-audio + mini-player machinery is battle-won).

### Adoption path (documented, built later, one small wave each)
Podcasts: identical now-playing shape -> `pushViewState({t:'np'})` + `onPopState`.
TV: show/season/episode drills -> push per drill level. Books/reader:
book/chapter -> push per level. Each reuses primitive #1-3 unchanged; only the
view's own `onPopState` + push sites are new. Record here as each ships.

## Task commits (each green before the next)

1. Router: `viewState` payload through buildHistoryState/parseHistoryState/
   recordScrollForCurrentState + a no-op-default sweep test (every existing
   entry still `{view,url,scrollY,depth}` with `viewState:null`).
2. Router: `pushViewState`/`replaceViewState` helpers + `onPopState` delegation
   in handlePopState (guarded: only same-view + hook present; fall-through
   byte-identical otherwise). Unit tests: delegation fires only same-view; a
   `false` return falls through to fetch+swap; a `true` return skips it.
3. Music: push on drill-open + now-playing-expand; `onPopState` collapse ladder;
   browse-root pop returns false (leaves Music). jsdom tests drive the real
   init(): drill -> back -> browse (no re-fetch); now-playing -> back -> collapse;
   browse-root back -> not handled.
4. (If needed) mini-player round-trip + deep-link regression tests.

## Regression / attack surface (brief the gate)

- **Player reparenting**: an in-view back must NEVER reparent the player or
  interrupt background audio. Prove no `swapToView`/`applyPlayerTransition` on a
  within-Music pop.
- **Existing history callers**: the `viewState` addition must be byte-identical
  for home/watch/all views (sweep buildHistoryState callers).
- **Home control depth**: `depth` semantics unchanged; the Home incremental-pop
  still works (its tests stay green).
- **Deep-link / fresh load** of `/music`, `?play=`, `?nowplaying=1` unchanged.
- **No history spam**: only drill-open + now-playing-expand PUSH; tab switches
  REPLACE; a second tap inside the same drill does not re-push.
- **Cross-view pop** (Music -> previous view) behaves exactly as today.
- **TOCTOU / navGeneration**: the fall-through path keeps its generation guard.

## Predictions (machine-derived, re-verified each commit)

- `buildHistoryState` callers today: 4 pass only 4 args (navigate x2 + bootRouter
  seed + none-other) -> viewState null; 4 pass a 5th (parse + scroll carry-forward,
  push/replace stamp). Swept + bound.
- Music push sites SHIPPED: card/artist descents (openDrill) + song-tap descent
  (playRowAt, gate) + the now-playing "Playing from" line. Dedup: pushDrillLevel
  skips a same-drill re-push.
- New tests: 8 router (commit 2) + 5 music (commit 3) + gate additions, mutation-bound.

## SHIPPED scope vs deferred (v1.217, after the gate)
SHIPPED - a back level for a DRILL descent from the browse view: an album card,
an artist card/row, a song-tap (playRowAt), and the "Playing from <Album>" line;
onPopState reconciles the drill (parent -> browse) in place.

DEFERRED (disclosed; tech-debt-tracker) - the NEXT slices:
1. now-playing collapse-on-back (entangled with the ?nowplaying navigate + the
   player expand/dock lifecycle; do NOT reparent the player).
2. the dock-return-restored album drill (music.js ~1488) has no pushed level -
   it arrives via the ?nowplaying navigate, so it belongs with slice 1.
3. leaving a drill by TAB-SWITCH (or See-all) clears `drill` without consuming the
   pushed level, so the first OS-back after that is swallowed (one dead press).
   Fix candidate: hide the tab strip inside a drill (a drill is a level) OR
   consume/reconcile the orphan level on tab-switch. Minor (one extra press).
4. cross-view re-entry does not restore the drill: leaving Music from a drill then
   OS-back re-inits Music at the browse root (init does not read
   history.state.viewState). Consistent with "drills not URL-shareable" below.

## Out of scope (the whole arc)
Podcasts/TV/Books adoption (later small waves, same primitive); making drills
URL-shareable deep links (state-object only); the bottom-nav Home button (leaving
Music via it is by design - app home != Music's Home tab; revisit only if Dean's
device pass flags it).
