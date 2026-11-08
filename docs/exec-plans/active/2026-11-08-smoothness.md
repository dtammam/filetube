---
plan: smoothness
harness: v2 · full
branch: feat/v1.406.0-smoothness
anchor: outcome
status: Approved @0ece22d6
next: Step 0, then W1 (A1 + A2 + H, the player never shows black)
design: Dean 2026-11-08 "Let's do all of this!!!" on the smoothness audit's two waves (both waves + P + F + H); single-page rebuild ruled out by Dean
gate: pending
builder: smart
---

# v1.406.0 - smoothness: no black player, no blank Now Playing, no dead taps, a launch that lands on content

Kickoff 2026-11-08 (FileTube Root, Opus). **Builder: Smart (Opus).** Why the tier: cross-cutting (router, watch,
player, music, home, boot), the SPA-shell class of LESSONS 4, the native video surface's reveal / cover rules, and two
add-only bridge fields. Not Extreme: no data, no migration. The iOS half (two fields) is the iOS Root's (relay below).

## Why

Dean, 2026-11-08: "everything is perfectly functional ... But there's something about, like, the real YouTube app ...
that have a level of smoothness and polish that I don't seem to have accomplished." His examples: launch loads in
stages, tapping a video shows black, the music player shows a blank Now Playing first.

Evidence: `docs/exec-plans/active/2026-11-08-smoothness-audit.md` (read it whole; it is this plan's spec of causes,
with file:line traces and measurements) and Dean's iPhone recordings in `/home/coder/smooth-recordings/` (rec1 =
FileTube, rec2 = the YouTube app). Device numbers: launch 1.9 s black + 1.8 s skeleton; video tap 2.4 s black player;
music tap 0.5 s "Unknown track" with a white art box. YouTube: never black, the tapped thumbnail sits in the player
until the first frame.

## Rulings (Dean, 2026-11-08)

- **No single-page rebuild.** (The app already is an in-document router; keep its shape.)
- **All of it:** wave 1 (A1, A2, H, G, A3, P) and wave 2 (E1, E2, E3, F) in this one release.
- Out (the audit's evidence): B cross-document view transitions and D bfcache (no document loads in-app). C intent
  prefetch and same-document view transitions are deferred to ROADMAP Planned.

## Outcomes (anchor: outcome - each one is measured, base vs branch, and becomes a device check)

- **O1 - the player never shows black.** From the frame a video or audio item is tapped (Modern, Classic, every home
  surface that opens watch) the player box shows the tapped item's thumbnail or audio art until the first real frame.
  Under the native video surface the cover stays until native says the picture is ready.
- **O2 - Now Playing is never empty.** A Music open from any tile, row or Continue item paints the tapped track's
  title, artist and art in its first frame. No "Unknown track", no blank art, never another item's time.
- **O3 - no dead tap.** Every in-app hop gives visible feedback within one frame and swaps without waiting for the
  destination's HTML after the first visit (or the idle prefetch).
- **O4 - launch lands on content.** In the app, no black frame between the splash and real content (native, via E1).
  On any relaunch with a stored snapshot, home paints the last known first screen with no skeleton, then revalidates in
  place.
- **O5 - fewer flashes.** No shimmer appears for a load that finishes under 150 ms; the box still reserves its space.
- **O6 - previews come back after Back** on Modern (the P bug).

## Step 0 (before any code)

Read AGENTS.md; docs/LESSONS.md sections 0, 2, 4, 6, 8, 11 (reveal / clear axes, reachability, the SPA-shell and
TOCTOU classes, the overlay census, the v1.401.1 poster lesson, the UI ratchet); docs/references/native-bridge.md,
native-bridge.v1.schema.json, ios-host.md; the completed plans 2026-10-30 native video surface and 2026-11-01 live
dock picture; then the audit, then this plan.

- Environment: export the fnm Node PATH (AGENTS.md Environment) before every npm / node / git-hook command; dual-Node
  22.23.1 + 24.20.0 suites once or twice for the wave set, targeted tests while building.
- Worktree: you run in `.claude/worktrees/feat/v1.406.0-smoothness`. Stage by name, no force-push, no --no-verify.
- Version order: builder "FileTube Builder vpm-pill-scroll" (branch fix/vpm-pill-scroll) may merge first. Before the
  release commit, merge the updated origin/main into this branch and re-run the full suites; if it touched the same
  files, stop and ask.
- Stop rules (ask Dean with AskUserQuestion): A1 needs a field the role may not see; G cannot honour a route class
  (same-route, hash, a shell with per-request content); a measured outcome O1-O6 does not move on the branch (then
  re-root-cause, never re-patch); any change to what a seeded play actually streams.

## Workstreams

- **A1 - full seeds.** Every surface that opens watch hands a seed the player can start from. The Modern grid
  projection (server.js `resolveModernGridItem`) gains the fields the player actually reads, or
  `isFullWatchSeedItem` (common.js ~3840) is narrowed to what the player truly needs; decide by reading the player,
  not the predicate. Never add a server path or anything the role may not see (RBAC projection; the v1.52 gate C2
  stream decision stays correct). `hasThumbnail` reaches the audio art path.
- **A2 - cover until the first frame.** The tapped thumbnail (an `<img>` cover over the box, not a re-set poster:
  LESSONS 8 v1.401.1) shows from the swap. Web video: drop it on the first decoded frame. Native surface: keep the
  cover and keep the hole shut until `audioState.pictureReady === true` (new, add-only, from native
  `AVPlayerLayer.isReadyForDisplay`); without the field (today's app) fall back to `state === 'playing'` plus the
  first tick. Every stand-down path (error, skip, close, minimize, PiP, a new item) drops the cover: reveal and clear
  are two axes (LESSONS 0); "covered by a hole or the cover, never neither" (LESSONS 4).
- **H - out of the first frame's way.** Defer watch's two `limit=1000000` list fetches and the duplicate settings /
  health calls until `playing` or idle; prev / next and related still ready in time.
- **G - view-shell cache.** Cache each path's parsed `#view-root` fragment in memory, clone per hop (never reuse a
  node), prefetch the main shells at idle, load a lazy view script in parallel with its shell and by a versioned URL.
  Immediate tap feedback (the pressed state holds until the swap). A release mid-session must not pair a new shell with
  old JS (key the cache by the page's ft-version).
- **A3 - seeded Music.** The tapped item's title, artist, album key, art URL and duration go into an in-memory seed
  (consumed by id, expires; the TOCTOU class) that `mountEarlyCover` paints; fetch the album directly when the seed
  has its key, skipping the recent-listening lookup. `buildSkinCtx` never shows the live element's time for another
  item.
- **P - previews after Back.** Restored Modern cards are observed again (clear `data-pv-obs` on detach, or track by
  the `observed` set); the v1.85 leak guard stays.
- **E1 - splash until content (web half).** Post `host.ready` (new, add-only) once, when the first screen's real
  content is painted (cards with decoded thumbnails, or the snapshot from E2), on every launch and full reload.
  Native holds its launch screen until then, capped at about 2 s.
- **E2 - last-known home.** Store the default home's first screen (ids, titles, thumbnail URLs, per user, small) in
  localStorage; paint it synchronously at init; revalidate in place without a flash; key by user, clear on logout and
  user switch; a deleted item must not linger past the revalidate.
- **E3 - boot fetch diet.** `/api/settings` starts with `/api/config`; single-flight the health probe; config and
  auth/me once; defer pins, badge, handoff, history, queue and counts until after the grid's first render, without
  regressing the cold-launch crispness work (chrome placeholders, count-gated nav items).
- **F - shimmer delay.** One rule: skeletons fade in after 150 ms (space reserved from frame one); no placeholder
  when a seed or snapshot exists. Motion through the tokens (UI ratchet).
- **M - marks.** Perf marks (tap, swap, seed paint, cover shown, surface visible, first frame / pictureReady, panel
  filled, first card, host.ready) recorded into the existing lifecycle log in the background and exported with its one
  button (house rule). Rename its switch from the lying "Show lifecycle debug log" to a true name (the owed rename;
  Dean's earlier pick was "Player event log" - use it unless the marks make it untrue, then say why).

## Contract (add-only; frozen by this plan, confirmed by the iOS Root through Dean before the web merges)

- `audioState.pictureReady: boolean` - native sets true when the current item's layer has a displayable frame
  (`isReadyForDisplay`), false on every item change and teardown. Absent = unknown (fallback rule in A2).
- `host.ready {}` - web -> native, once per document load, when first content is on screen. Native hides its launch
  screen / spinner on it, or after its own cap.
- Both in native-bridge.md and the schema; no existing field changes meaning.

## Waves

- **W1 - A1 + A2 + H.** jsdom tests driving the real watch / player paths with a fake host: a Modern seed starts the
  player; the cover is up from the swap and drops on the first frame; under the native fake it waits for
  `pictureReady`, falls back without it, and drops on every stand-down path. Mutate each guard, watch it go red.
- **W2 - G + P.** Tests of the shell cache: clone per hop, version key, same-route and hash rules, parallel script
  load. The preview restart test.
- **W3 - A3.** The seed by id, its expiry, the wrong-item race, no foreign time.
- **W4 - E1 + E2 + E3 + F.** host.ready reachability with the fake host; snapshot paint, revalidate, user switch,
  logout; the boot fetch census before and after (counted, not eyeballed).
- **W5 - M + measure.** Re-run the audit's probe (scratchpad `smooth-audit/sa-probe.js`; copy it to scripts/ if it
  earns a home) base vs branch for O1-O6, report the numbers verbatim in Evidence. Send Dean a before / after
  filmstrip of the video tap and the music tap (SendUserFile).
- **W6 - docs + release.** LESSONS (the class: "the next screen paints what the tap already knew - a seed that falls
  short of the predicate silently drops the instant path"), DEVICE-CHECKS, ROADMAP Shipped + Planned (C, same-document
  view transitions), releases.json in user language, the version bump.

## iOS Root relay (send to "SANDYJAR iOS Dev Root" when the contract is final; Dean confirms it)

> FileTube web v1.406.0 removes the black player and the black launch. Two add-only fields, please:
> (1) `audioState.pictureReady: boolean` on the native video surface - true when the current item's AVPlayerLayer
> `isReadyForDisplay` turns true, false on every item change and teardown; post a state update when it flips. The web
> keeps the tapped thumbnail over the player until it is true (it falls back to playing + first tick when absent).
> (2) `host.ready {}` arrives once per document load when the web's first content is painted: hold the launch screen
> (no black, no spinner over black) until it arrives, capped at about 2 s, then show the web view. Also on a full
> reload. Please confirm or push back before the web merges; device checks: DEVICE-CHECKS "Smoothness (v1.406.0)".

## Gate

Full gate: adversary (floor), qa, security-brief (the projection is an RBAC surface; two bridge fields). Attack
surfaces: (1) a seed that carries a field the role may not see, or a path; (2) a stand-down path that leaves the cover
up over a playing picture, or drops it to black; (3) a stale shell with new JS across a release; a reused node; (4)
the music seed showing the wrong item (fast double tap, back-forward); (5) the snapshot showing another user's or a
deleted item after revalidate; (6) host.ready never sent (splash stuck until the cap) on any boot path, including an
error page; (7) the boot fetch diet dropping a call something still needs. Ship on CRITICAL/WARNING closure; ask
Dean at round 3.

## Release

`docs/RELEASING.md` + AGENTS.md: version 1.406.0, ROADMAP, releases.json, DEVICE-CHECKS "Smoothness (v1.406.0)":
now (web and today's app) - (a) Modern home -> a video: thumbnail in the player from the first frame, no black;
(b) an audio item: art from the first frame; (c) Music tile -> title and art at once, never "Unknown track";
(d) a tab hop answers at once; the second visit has no skeleton; (e) relaunch: last home at once, then fresh;
(f) Back on Modern: previews play again; (g) fast loads show no shimmer. On the app build with the two fields -
(h) native video: zero black frames on a tap (screen recording); (i) launch: splash straight to content, no black.
Close the plan with `node scripts/plan-complete.js` in the same PR, and move the audit plan to completed with it.
**Do not run `gh pr merge` until Dean says so.**

## Out of scope

A single-page rebuild; cross-document view transitions; bfcache work; intent prefetch (Planned); same-document
view transitions (Planned); any native work beyond the two fields (the iOS Root's).

## Evidence
