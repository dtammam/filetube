# Exec plan: Music page overhaul (IA rethink)

**Status:** ACTIVE - awaiting Dean's approval to implement
**Target version:** v1.103.0 (single wave; may split into .0/.1 if the gate warrants)
**Branch:** `feature/music-overhaul`
**Schema:** no bump (all changes are derived data, client sort, client URL state)

## Problem framing

Dean: the Music page "feels bad on multiple fronts... not polished / not
deterministic / not nice. It's not fun to use." Intake separated the gestalt
into three nameable causes, each confirmed against the code:

1. **Artist cards are drab (design).** Artist cards are bordered, text-only
   boxes ("N albums . M tracks") - `buildArtistCardHtml` (music.js:47),
   `.music-artist-card` (style.css:9067). Album cards are art-forward and
   borderless (`.music-album-card`, style.css:9029). Two inconsistent chassis;
   artists have **no artwork at all**. Dean: "just tiles of artists... feels
   poopy. Maybe an amalgamation of the albums as part of an image. Something
   visual. Consider YouTube Music for what good looks like."

2. **Mini-player tap doesn't always return you to the player (determinism
   BUG).** Once the URL carries `?nowplaying=1`, tapping a *different* song
   re-docks the player (`mountInDock`) but leaves the URL unchanged. The next
   dock-tap calls `navigate('/music?nowplaying=1')`, which `isSameLocationNav`
   (common.js:7000/7655) treats as a same-URL no-op - so `render()`/`expand()`
   never run and you're stranded with an empty `#player-slot`. Stale comment at
   player.js:6293-6294 still calls this "a benign no-op"; music.js:742-745 says
   that assumption "died." They disagree; the marker is added on first dock-tap
   and never cleared.

3. **Hard to sort (missing capability).** `#music-sort-select` exists but only
   affects the Songs tab / drill queues (`loadSongs` -> `GET /api/music?sort=`).
   Albums and Artists tabs **silently ignore it** and are hard-sorted by name
   server-side (`groupAlbums`/`groupArtists` end with a fixed `cmpStr`,
   query.js:121/140). The client menu exposes 6 of ~10 server sort keys.

## Design decisions (LOCKED at intake 2026-08-11)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Artist card visual | **2x2 album-art mosaic** built from the artist's album arts; graceful fill for <4 albums |
| D2 | Landing / default | **Artists tab default**, keep Albums/Artists/Songs tabs, polish cards; Songs tab is the flat sortable list |
| D3 | Tab + drill state | **URL-backed** (`/music?tab=artists`, drills as query state) with history; this is the clean root-fix for the mini-player bug and makes browser Back work |

Out of scope this wave (deliberate): a YT-Music-style scrollable "Home"
landing (Dean chose polished tabs over it); infinite-scroll pagination
(pre-existing tech-debt, `limit=10000` stays); the expanded now-playing
big-art view redesign (keep current `#player-slot` behavior, only fix its
expand determinism).

## Approach per axis

### A. Artist mosaic (D1)

- **Server:** extend `groupArtists` (query.js:126) to also collect up to 4
  representative album-art track ids per artist - prefer albums that carry
  embedded art, dedup by album key, stable order. Surface as `artIds: string[]`
  on each artist object (alongside existing `artist/albumCount/trackCount`).
  `GET /api/music/artists` (server.js:7910) passes them through.
- **Client:** rewrite `buildArtistCardHtml` (music.js:47) to emit an
  art-forward chassis mirroring the album card - a square mosaic image block
  + name + meta. Mosaic renders 1/2/3/4 tiles by available `artIds`
  (1 -> full bleed, 2 -> side-by-side, 3 -> one large + two stacked, 4 -> 2x2).
  Each tile is a real `<img src="/albumart/<artId>">` so the existing SVG
  placeholder fallback and `art-shimmer` reveal-once machinery apply per tile.
- **CSS:** unify the two chassis. One shared `.music-card` base; album and
  artist cards differ only in the image block (single art vs mosaic grid) and
  meta line. Remove the bordered text-box look (style.css:9067). Reconcile grid
  min-widths (currently 150px vs 160px) to one value.
- **Reveal-once contract (MANDATORY, CONTRIBUTING):** the mosaic is a
  fetch-then-render surface. Bind BOTH axes - happy reveal AND error/abort
  clear. A tile whose art 404s must resolve to the placeholder, not shimmer
  forever; an aborted `/api/music/artists` fetch must clear the artist
  skeleton, not strand it. (This is the exact class the v1.102 gate caught.)

### B. Mini-player return determinism (D3 - the real fix)

Root cause is the collision between a never-cleared `?nowplaying=1` marker and
the exact-match same-URL nav guard. Fix by making the player's docked/expanded
intent a **first-class URL state** rather than a one-shot marker:

- Represent now-playing expansion as a distinct, toggleable URL state the dock
  tap always drives to, and that a re-dock (new `loadTrack` while expanded)
  clears from the URL - so a subsequent dock-tap is a genuine state change, not
  a same-URL no-op.
- Reconcile the two disagreeing comments (player.js:6293-6294 vs
  music.js:742-745) to one truthful description of the contract; a lying
  comment is a gate finding.
- Because tabs/drills also become URL-backed, keep the marker orthogonal to
  tab/drill so Back steps through browse history without toggling the player.
- **Behavioural binding, not presence:** a jsdom test must reproduce the
  original 3-step strand (dock -> expand -> load different song -> dock-tap)
  and assert the player re-expands. Delete the fix and watch it go red
  (presence-not-binding is a repeat scar - v1.83, v1.96).

### C. Sort everywhere (axis 3)

- **Server:** teach `groupAlbums`/`groupArtists` to honor a `sort` param
  (name / newest-added / track-count; albums also year). `GET /api/music/albums`
  and `/artists` accept `?sort=` and pass it through; default preserves current
  name order.
- **Client:** `render()` (music.js:572) passes the persisted sort to the album
  and artist endpoints, not just songs. The sort menu becomes tab-aware -
  offer the keys valid for the active tab (a mosaic of albums can't sort by
  "duration"). Reconcile the 6-vs-10 key gap: expose the server keys that make
  sense per tab; drop dead client options.
- Persisted `SORT_KEY` semantics: decide per-tab vs global. **Recommend
  per-tab persistence** (sorting Songs by duration shouldn't reorder Artists on
  return) - store as a small `{tab: sortKey}` map.

## Task breakdown (small, independently green commits)

1. **T1 server/artist-mosaic-data** - `groupArtists` gains `artIds` (<=4,
   art-preferring, deduped); unit tests in `music-query.test.js` assert count
   cap, art preference, dedup, empty-library. `GET /api/music/artists` shape
   test in `music-api.test.js`.
2. **T2 server/group-sort** - `groupAlbums`/`groupArtists` honor `?sort=`;
   query + api tests for each key incl. default-order preservation.
3. **T3 client/card-chassis-unify** - shared `.music-card` CSS, album card
   reflow to it, artist card -> mosaic; design-token census stays green
   (`npm run lint:css`, `ledger:check`). jsdom `music-view.test.js`: 1/2/3/4
   tile mosaic renders correct tile count; reveal-once (happy + tile-404 +
   abort) bound behaviourally.
4. **T4 client/sort-all-tabs** - render passes sort to album/artist endpoints;
   tab-aware menu; per-tab persistence. jsdom test: switching tab restores that
   tab's sort; album/artist grids reorder on sort change.
5. **T5 client+server/url-state** - tabs + drills URL-backed; default tab
   Artists (D2); Back/forward step through browse; **mini-player return fix**
   with the 3-step strand repro. This is the highest-risk commit - full gate
   attention.
6. **T6 polish** - crumb/now-playing line, empty states, skeleton shapes match
   the exact revealed shape per sub-state (album grid / artist mosaic / song
   list), mobile pass.

Each commit: its tests green before the next. Commit messages record MEASURED
suite counts, never projected.

## Machine-derived predictions (re-verified at every commit)

- Client sort options today: **6** (`newest,title-asc,title-desc,artist-asc,
  album-asc,duration-desc`). Server keys: **10**. After T4 the client exposes
  a tab-appropriate subset with **zero dead options** (assert no client
  `value=` lacks a server handler).
- Card chassis today: **2** divergent (`.music-album-card` borderless art,
  `.music-artist-card` bordered text). After T3: **1** shared base, assert no
  remaining `.music-artist-card { border` text-box rule.
- Artist cards with artwork today: **0**. After T3: every artist with >=1
  album renders >=1 art tile (jsdom assert).
- Music test files today: **14** (11 unit + 3 integration). Net-new tests only
  add; suite count reported verbatim per commit and on both Node versions.

## Test plan

- Unit: `music-query.test.js` (grouping+sort+artIds), `music-view.test.js`
  (mosaic render, reveal-once both axes, sort-per-tab, URL-state), a new
  behavioural repro for the mini-player strand.
- Integration: `music-api.test.js` (artists `artIds` shape, `?sort=` on
  albums/artists), `rbac-music-enforcement.test.js` stays green (no new leak).
- `npm run lint`, `lint:css`, `ledger:check` green each commit.
- Dual-Node full `npm test` (v22.23.1 + v24.14.0) before release, sequential,
  reviewers idle. Node 24 reporter prints the info glyph, not `#`.

## Gate briefing (attack surfaces for the adversarial seat)

- **Reveal-once regressions** - the mosaic ADDS a fetch-then-render surface and
  per-tile images. Attack: 404 one tile, abort the artists fetch mid-flight,
  total `/api/music/artists` failure - prove no stranded shimmer (this is the
  bug class the v1.102 gate caught; the test there was presence-only).
- **Mini-player strand** - reproduce the 3-step strand and any sibling: dock ->
  expand -> switch tab -> dock-tap; drill -> play -> Back -> dock-tap. Mutation-
  test the fix (delete it, watch the repro go red). Verify the reconciled
  comment is TRUE.
- **URL-state fallout** - deep-link `/music?tab=...&...`, browser Back/forward,
  refresh mid-drill, the `/music?play=<id>` continue-listening deep link
  (common.js:3754) and `?nowplaying=1` legacy links still work.
- **Sort correctness** - every exposed key sorts as labeled; no client option
  without a server handler; per-tab persistence doesn't cross-contaminate.
- **RBAC** - artist `artIds` must not leak art for tracks a member can't see;
  re-run `rbac-music-enforcement`.
- Full gate (not slim): this touches the shared player host and adds a data
  path. No data-loss surface, but the player machinery is "battle-won" - treat
  regressions to background-audio continuity as CRITICAL.

## SHIPPED vs DEFERRED (updated during implementation)

Commits on `feature/music-overhaul` (after the exec-plan commit):
- **T1+T2** `feat(music): server grouping` - `artIds` mosaic data + sortable
  grids (`sortGroups`), `?sort=` on albums/artists endpoints.
- **T3** `feat(music): unify card chassis + artist mosaic` - one art-forward
  chassis, 2x2 album-art mosaic with data-tiles reflow, reveal-once per tile.
- **T4** `feat(music): per-tab sort` - tab-aware menu, per-tab persistence,
  drill hides the control, no-dead-option forcing test.
- **T5** `fix(music): dock-return determinism` - strip transient `?nowplaying`
  on init so a dock re-tap is always a real transition (the bug's ACTUAL
  root-fix; simpler than the URL-rework originally proposed).
- **T5b** `feat(music): Artists is the default landing tab` (D2).

**DEFERRED (disclosed): D3's URL-backed tabs/drills + browser-Back.** Rationale
recorded honestly: D3 was approved primarily as "the clean root-fix for the
mini-player bug." Implementation found a simpler, lower-risk root-fix (the
`?nowplaying` strip, T5) that does NOT require URL-backing - so the bug is fixed
without it. What URL-backed browse would still ADD is Back-button stepping
through tabs/drills + shareable deep links: a genuine enhancement, but it needs
view-level `pushState` against the SPA router's history/depth invariants (a
documented source of release-blocking bugs), which warrants its own focused
gate. Ships as a candidate follow-up wave, Dean's call. The mosaic + sort +
determinism + Artists-default deliver all three of Dean's stated symptoms.

## Known risks / residuals

- The shared player host is reparented between video/watch and music; URL-state
  changes must not regress video docking. Test both.
- `limit=10000` no-pagination stays (pre-existing tech-debt #, not this wave).
- If T5 proves too entangled to land safely in one wave, ship T1-T4 as v1.103.0
  (cards + sort) and T5 as v1.103.1 (URL-state + mini-player fix), disclosed.
