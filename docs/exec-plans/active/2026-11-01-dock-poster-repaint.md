---
plan: dock-poster-repaint
harness: v2 · full
branch: fix/v1.401.1-dock-poster-repaint
anchor: spec
status: Planned
next: builder Step 0, then W1
design: Root-caused by the Root 2026-11-01 (WebKit repro, below); the fix shape is fixed here
gate: pending
builder: standard
---

# v1.401.1 - on the iPhone app, the mini player shows the thumbnail every time, not black from the second time on

Kickoff 2026-11-01 (FileTube Root, Opus). **Builder: Standard (Sonnet).** Why the tier: the cause is reproduced and
measured, the fix is a few lines in one function, the mechanism has a tested fix. One release, **1.401.1**.

## Step 0 (before any code)

- Read AGENTS.md, docs/LESSONS.md (sections 1, 2, 6, 8 at least), docs/CONTRIBUTING.md, docs/RELEASING.md, then this
  plan once.
- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every
  npm/node/git command. Local suites on Node 22 only; Node 24 runs in PR CI.
- Git: work on `fix/v1.401.1-dock-poster-repaint` (this plan is committed there). Stage by name, never `git add .`/`-A`,
  never force-push, never `--no-verify`, never pipe a commit or push; verify with `git log` / `git ls-remote`. Commit
  with `-F <file>`. Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`.
- **Stop rules (ask Dean with AskUserQuestion):** the WebKit repro below does not reproduce on your run; the fix
  interrupts playback or the live dock (nativeVideoDock) path in any measured way; gate round 3. A device failure after
  release = a re-root-cause at the Extreme tier, never a re-patch.

## Why

Dean, 2026-11-01, iPhone app v0.16.0, web v1.401.0: "i swipe down, miniplayer shows the thumbnail. bring it back. go
back down, it's black?"

## Root cause (measured by the Root, 2026-11-01)

Reproduced with the real app in headless WebKit (Playwright 1.20 + webkit-1616) and a fake host announcing nativeAudio
+ nativeVideoAudio + nativeVideo (not nativeVideoDock): dock 1 shows the thumbnail; dock 2 and 3 are BLACK with the
picture area black and the bar under it - Dean's screen. Same on v1.399.0, v1.400.0, v1.400.1 and v1.401.0: **not a
regression of the recent releases; present since v1.399.0** (Dean's v1.399.0 check (g) this morning exercised only a
first dock). Chromium paints the poster every time, so a Chromium probe cannot see it.

- The web state is correct in every cycle: `poster="/thumbnail/<id>"` on `#media-player` while docked, every
  `video.surface` `visible: false`, no hole, no stray clip / opacity / transform, the element has no `src` under native.
- Mechanism: in WebKit, once a `<video>`'s poster was REMOVED while the element had a renderer, setting a poster again
  (any URL) is not loaded or painted until the renderer is rebuilt; with no frame the element paints its black
  background. `dockArt(false)` (public/js/native-audio.js, `function dockArt`, the `removeAttribute('poster')` branch,
  and the belt in `holeApply`'s close branch) removes it on every expand. dock() moves the host into the dock (a renderer
  rebuild), but `setDockShown` -> `measureDockHeight` (player.js) forces layout BEFORE `nativeSurfaceSync`, so the
  renderer is rebuilt without a poster and the poster set afterwards never paints. Dock 1 works only because nothing
  had removed a poster from that element yet. Falsifying prediction that held: a poster set and removed once before the
  first dock makes the FIRST dock black too.
- Live tries on the black dock: re-setting the same URL - black; a different URL - black; moving the wrapper out and
  back - thumbnail; `display: none`, a forced layout, display restored - thumbnail.

The instruments (Root's scratchpad, not the repo; recreate from this description if gone): a WebKit probe driving the
chevron (`.player-minimize` -> minimizeToDock -> settle), a tap on the dock to expand, three cycles, one screenshot per
docked rest. WebKit was run with `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 PLAYWRIGHT_BROWSERS_PATH=/tmp/wk15/browsers`
(a leftover install; if it is gone, `npx playwright@1.20 install webkit` into a scratch dir, never into the repo - no new
dependencies, LESSONS / the no-dependencies norm).

## Requirements

- **R1 - the poster paints on every dock.** In `dockArt`, when the poster attribute actually CHANGES to the artwork,
  rebuild the element's renderer right after: save the inline `display`, set `display: none`, read `offsetWidth`,
  restore the saved value. Once per change, never per frame (the attribute-unchanged path writes nothing - the v1.399.0
  gate r1 rule: idempotent writes only, or the body observer feeds the sampler). Measured on a patched v1.401.0 in
  WebKit: docks 1-3 all show the thumbnail, also with a poster removed before the first dock.
- **R2 - nothing else changes.** Under native the element has no `src` (the toggle cannot interrupt playback - prove it
  with the proxy's state before and after); the live dock (nativeVideoDock, the covered fallback sets the poster too)
  gets the same fix through the same function; Safari / the PWA / desktop never reach `dockArt` (no native surface).
  Add a one-line comment naming the WebKit behaviour (LESSONS 8 platform fact).

## Waves

- **W1 - R1 + R2 + the test.** In test/unit/native-video-surface-rect.test.js (its jsdom realm with CAPS): dock, expand,
  dock again; record on `#media-player` the order of the poster set (MutationObserver, attributeOldValue), `style.display`
  writes and `offsetWidth` reads (a getter defined on the element); assert after the second dock's poster set: display
  -> none -> a layout read -> the original value. Mutate (delete the toggle): watch it red. Assert a same-value dockArt
  writes nothing. Re-run the WebKit probe on base and branch: base black at dock 2, branch thumbnail at docks 1-3; put the
  numbers and the PNG names in the evidence.
- **W2 - docs + release.** LESSONS 8 (the platform fact: "WebKit does not repaint a `<video>` poster re-set after a removal
  until the renderer is rebuilt"), DEVICE-CHECKS "Mini player thumbnail (v1.401.1)": (a) on the app v0.16.0, swipe down,
  expand, swipe down five times: the thumbnail every time, never black; (b) the chevron the same; (c) the sound never
  stops. ROADMAP Shipped, releases.json in user language, the version bump.

## Gate

Full gate per scrutiny (the version bump touches package.json): adversary (floor), qa, security-brief. Attack surfaces:
the toggle's reachability on the real dock() order (a fixture that sets the poster before the move proves nothing), the
idle census (zero extra writes per idle second docked), playback state across the toggle, the live-dock covered path.

## Release

`docs/RELEASING.md` + AGENTS.md; close the plan with `node scripts/plan-complete.js
docs/exec-plans/active/2026-11-01-dock-poster-repaint.md "Shipped v1.401.1" --apply` in the release PR; the protected-main
PR flow. **Ask Dean (AskUserQuestion) before `gh pr merge`** when CI is green; then merge, `git pull --ff-only`, delete the
branch (remote via `gh api -X DELETE`, local `-d`), confirm the tag's Publish Docker Image run is green.

## Evidence (the builder fills this)

- W1 (test red on mutant, WebKit base vs branch): test/unit/native-video-surface-rect.test.js (10/10 green); mutant (the toggle replaced by `void 0`) = 1 fail, restored = 0 fail. Deviation from the plan text, forced by `npm run lint:ui` (display-ownership: JS `style.display` writes are banned, live 2 > allowed 0): the renderer rebuild is `el.hidden = true; void el.offsetWidth; el.hidden = false` (the global `[hidden]` rule = display none), re-measured in WebKit. WebKit (Playwright 1.20 / webkit-1616, the Root's bd-wk.js probe, centre pixel of the docked picture, thumbnail = 33,204,66): base docks 1-3 = (33,204,66), (0,0,0), (0,0,0); base with a poster set and removed before dock 1 = (0,0,0) x3; branch docks 1-3 = (33,204,66) x3, also with the pre-removal (PRE=1) x3; 0 page errors. Screenshots: wk-base/c{1,2,3}-docked-px.png, wk-branch/..., wk-base-pre/..., wk-branch-pre/... under the builder scratchpad.
- Full suite (Node 22), before the gate and on the release commit: pre-gate (W1 as first written, before the lint-forced `hidden` change): 13175 tests, 13162 pass, 0 fail; the W1 commit's pre-commit hook ran the unit suite green on the final code.
- Gate verdicts (bound to sha): r1 @7b1ba7a7: security-brief APPROVED (package.json/lock diff = version lines only, verified by the builder); qa APPROVED (4 mutants red, instruments green); adversary CHANGES (W1: the idle-census assertion called the nonexistent `r.na.sync`, so dropping the changed-guard survived; fixed with `r.na.syncSurface()` twice, no-guard mutant now red: 9 pass 1 fail, real code 10 pass 0 fail). Note (not blocking): the live-dock covered path is reasoned through the same dockArt, not separately tested. r2: pending.
- Release: tag, PR, Publish run: 

## Out of scope

Setting the poster before the move into the dock (an untested alternative); anything in the live dock (v1.401.0) beyond
the shared dockArt fix; the iOS app.
