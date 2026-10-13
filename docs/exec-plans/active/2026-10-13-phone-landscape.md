---
plan: phone-landscape
harness: v2 · full
branch: fix/v1.389.0-phone-landscape
anchor: spec
status: Planned
next: builder - Step 0, then reproduce both quirks at 844x390 with touch emulation before any edit
design: Dean's phone report 2026-10-13 + the Root's seam research the same day (FileTube Root). Base = main d49a0100 (v1.387.3 + baselines). Runs in parallel with v1.388.0 (sticker sheet, feat/v1.388.0-sticker-sheet).
builder: standard (two contained fixes with every seam named: a layout-state split and one entry trigger for an existing fullscreen mode)
gate: -
---

# v1.389.0: a sideways phone stays a phone (side menu as a drawer; videos open fullscreen)

Norms: no em dashes; stage by name; `git commit -F <file>`; never pipe a commit or push; fnm Node 22.23.1 PATH before any
node/npm/git command; never `--no-verify`; never self-merge. A status report NEVER ends your turn.

Read first: AGENTS.md (CSS / SPA traps, UI ratchet, overlay containment census); docs/LESSONS.md 0, 2, 4, 5, 6, 8 (LESSONS:66
Playwright grants user activation by itself; :187 iOS cannot lock orientation; :247 WebKit carries a gesture across a fetch);
docs/references/mobile-custom-player-findings.md (partly predates the v1.118 faux fullscreen; treat as history).

## Step 0 (builder)
- Work ONLY in `.claude/worktrees/fix-v1.389.0-phone-landscape` (hard-link node_modules; a clean install is
  `rm -rf node_modules && npm ci` there, never the main checkout).
- **Parallel release order:** v1.388.0 (sticker sheet) releases first. Before your release commit, merge the updated origin/main
  into this branch and re-run the full suite. If you find you must edit public/js/skin-surface.js, the `.mms-sm-*` / sticker CSS
  or music-sticker tests (v1.388.0's files), stop and ask.
- Stop and ask Dean (AskUserQuestion) when: a desktop or tablet layout would change; the fix needs native (iOS app) work; the
  gate reaches round 3.
- Merges: when the gate is closed and required checks are green, SendMessage "FileTube Root" (may be listed as "FileTube
  Server/Web Root Session") the PR number and sha; the Root merges.

## Rulings (Dean, 2026-10-13)
| # | Ruling |
|---|--------|
| 1 | "We just handle the phone viewport very explicitly every, each time": a phone is a phone in both orientations. |
| 2 | In landscape the side menu is hidden like the phone view; "they get to click it" (the hamburger opens it as a drawer). |
| 3 | Rotate-to-fullscreen works today; tapping a video while ALREADY sideways does not go fullscreen ("on first tap"). Fix that. |
| 4 | Landscape behavior (Root's proposal, sent to Dean with this launch): a video opened sideways enters the phone fullscreen view; if autoplay is refused it still enters, with the Tap to play cue; the exit button while sideways shows the normal watch page and does not re-enter until the next video or the next rotate; portrait exits as today; the next video auto-played in landscape stays fullscreen; Feed cards, the docked player and desktop unchanged. |

## 1. Outcome
1. Phone sideways (e.g. 844x390), any page: no sidebar on the left; the hamburger shows and opens the side menu as the phone
   drawer (over the page, with the phone's close behavior).
2. Close or open the menu in either orientation, rotate any number of times: the drawer is never left open by a rotation, and
   portrait never shows a drawer with no way to close it.
3. Phone sideways, tap a video card: the watch page opens in the phone fullscreen view (ruling 4).
4. Desktop and tablet (fine pointer, or a short screen side > 500): byte-identical behavior, including the theatre guide.

## 2. Root causes (Root seam research, 2026-10-13; line numbers drift, search the names)
- **Sidebar = width only.** `<aside class="sidebar" id="sidebar">` (public/index.html:181; also books.html:155, music.html:149
  and the other shells); hamburger `#menu-toggle` (index.html:102). State is three classes, nothing persisted:
  `.sidebar.hidden` (style.css:582), `.main-content.expanded` (style.css:774), `.sidebar.mobile-open` (style.css:3530). The mobile
  layout is `@media (max-width: 768px)` (style.css:3444): sidebar hidden by default (3527-3529), shown with `.mobile-open` (3530),
  hamburger hidden (`.header-left > .menu-toggle {display:none}`, 3644). An 844px phone gets the desktop layout.
- **The leak.** common.js:17951-17965 (`#menu-toggle` click) toggles all three classes together; watch.js:127-131
  `setGuideCollapsed` writes the same trio (theatre: `theatreGuideCollapse` 132, `theatreGuideRestore` 144, `syncTheatreGuide` /
  `wireTheatreGuide` 2644-2663 on `(min-width: 1025px)`, `data-theatre-guide` 121). Closing in landscape leaves `hidden mobile-open`;
  in portrait `.sidebar.mobile-open` (later in the file, same specificity) wins, so the drawer shows open, and the hamburger is
  hidden there. Nothing re-syncs on resize / orientationchange (common.js:372-401 only holds `no-motion`).
- **Phone detection.** `html.is-phone` (music-skins.js:555-578 `phoneFrom` / `detectPhone` / `markPhoneClass`):
  `(pointer: coarse)` AND `min(screen.width, screen.height) <= 500`, set once at load (screen size does not change on rotate, so
  once is correct). The sidebar CSS never uses it.
- **Fullscreen only on a rotation.** player.js:9264-9349 `onOrientationChange` (on `matchMedia('(orientation: landscape)')`
  change, fallback `orientationchange`), gated `state === STATE_FULL`; custom player: `shouldEnterFauxOnRotate` (808: landscape,
  playing, not already faux) -> `setCssFullscreen(true)` (2711: CSS only, `.css-fullscreen` + `body.ft-css-fullscreen`, needs NO
  user gesture). Native-controls / desktop: `shouldAutoFullscreenOnRotate` (790) -> `enterFullscreen()` (7589, iPhone
  `webkitEnterFullscreen` 7608-7616, needs transient activation). Feed exclusion `rotateIgnoredForHost` (822). Nothing checks
  "already landscape" on load or play: `autoStart` (6056; callers 6029-6219; refusal = `autostart:refused` + Tap to play cue).
  `isMobileFormFactor` (2586 / `resolveMobileFormFactor` 1452) still says mobile at 844 wide. Auto-advance seam ~6518.

## 3. Design
- **D1 One phone-layout switch.** A phone (`html.is-phone`) gets the mobile sidebar / header rules in BOTH orientations. Prefer
  making the existing mobile rules apply under `html.is-phone` as well as `(max-width: 768px)` (one selector list, not a copied
  block); check every rule in the 3444 block that the header / sidebar / main-content relies on, and list in Evidence which ones
  you extended and which you deliberately left width-only (content grids may legitimately use the landscape width: do not
  shrink the home grid to one column; ask if unsure).
- **D2 Split the state.** Desktop collapse and phone drawer become independent: the hamburger toggles ONLY `mobile-open` on a
  phone layout and ONLY `hidden` + `expanded` on the desktop layout (decide by the same test D1 uses, at click time). On crossing
  between layouts (a phone rotating is no longer a crossing after D1; a desktop window resized across 768 still is), clear
  `mobile-open`. The drawer closes on navigation / scrim / Escape exactly as it does in portrait today. Theatre (`setGuideCollapsed`,
  `data-theatre-guide`) is desktop-only (1025+) and must write only the desktop classes.
- **D3 Enter fullscreen when already sideways.** On the watch page, when the player reaches `STATE_FULL` with a video, on a
  mobile form factor (`isMobileFormFactor`), custom-player path, in landscape, and not a Feed host (`rotateIgnoredForHost`):
  `setCssFullscreen(true)` once, whether autoplay started or was refused (the Tap to play cue must be visible and work inside
  fullscreen). No `webkitEnterFullscreen` attempt from a non-gesture path (it would no-op silently on iPhone): native-controls
  mode keeps today's behavior; say so in the report.
- **D4 Respect an exit.** A per-video flag: once the user exits fullscreen while sideways, D3 does not re-enter for that video;
  a new video (including auto-advance) or a real rotation re-arms it. Portrait exit stays as today. An auto-advanced next video
  already in fullscreen stays in it (verify; fix only if it drops out).

## 4. Acceptance (instrument in brackets; headless with touch emulation + screen size, see the sticker plan's probe note:
`Emulation.setTouchEmulationEnabled` and screenWidth/Height are needed for is-phone)
- M0 (before edits, main): reproduce both quirks at 844x390 / 390x844 [probe screenshots + class dump].
- Sidebar: at 844x390 phone, sidebar not visible, hamburger visible; tap opens the drawer; rotate sequences (open/close in each
  orientation, 4 permutations) never leave a drawer open after rotation [test + probe].
- Desktop 1280x800 fine pointer and a 820x1180 tablet: hamburger collapse + theatre guide byte-identical to main [test].
- Fullscreen: phone 844x390, navigate to a video: `body.ft-css-fullscreen` set; with autoplay refused (stub `play()` rejecting
  NotAllowedError) still set and the cue visible; exit while sideways then wait: stays out; next video: re-enters; Feed card
  host: not entered; portrait load: not entered [tests, each mutated red once: remove the trigger, watch it fail].
- lint:ui does not grow docs/ui-exceptions.json; overlay containment census zero.

## 5. Gate
Adversary + QA. Brief with LESSONS 2, 4, 5, 6, 8 and: desktop regression of the hamburger / theatre guide; the drawer's close
paths on a landscape phone; a fullscreen trigger that never runs in the real route (prove reachability through `navigate()`, not
a direct call); Playwright's free user activation hiding a gesture dependency (LESSONS:66); the docked / Feed exclusions; a
`[hidden]` / `display` override.

## 6. Release
v1.389.0 per docs/RELEASING.md, AFTER v1.388.0 (Step 0). Ledger (user language): on a phone held sideways the side menu now
opens from the menu button like it does upright, and a video you open sideways starts fullscreen. DEVICE-CHECKS block "Phone
sideways": sidebar hidden + drawer works; rotate with the menu open/closed; tap a video sideways (Safari and the app); exit
fullscreen sideways stays out; desktop hamburger unchanged.

## Out of scope
Native-controls fullscreen from a non-gesture path; iPad / tablet layouts; Pocket; content grid density in landscape.

## Evidence (builder fills)
- M0: 
- D1 rules extended / left width-only: 
- Rotation permutations: 
- Desktop/tablet identical: 
- Fullscreen cases: 
- Mutations: 
- Full suite runs (counts, verbatim): 
- Gate verdicts: 
- Device checks Dean owes: 
