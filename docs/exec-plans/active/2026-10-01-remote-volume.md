---
plan: remote-volume
harness: v2 · lean
branch: feat/v1.353-remote-volume
anchor: spec
status: Building
next: full dual-Node npm test (22.23.1 then 24.20.0), then the FULL gate (section 6)
design: Dean 2026-10-01 ("I like this. Yes. Let's do it.") on option A, then "As long as the volume screen is low friction and looks like iPod volume I am good" (R1, R2 below are binding); R3, R4 are architect defaults he did not overrule
gate: FULL (adversary + qa + security-brief; a new command and state field on the remote channel, lib/remote/**)
---

# Speakers: set the speaker's PLAYER volume from the phone

Written 2026-10-01 by an Opus session at v1.352.0 (4cf591ad). Seams were read on main, not assumed.

## 1. The outcome (what Dean will do on device)

Dean's phone controls the speaker machine (Speakers). He opens Volume (in the Speakers menu, or by tapping the "on <PC>" badge
on Now Playing), turns the click wheel, and the music on the PC gets louder or quieter. The bar shows the PC's real level, and
if someone at the PC moves its own volume slider, the phone's bar follows. MENU goes back. The phone's own volume buttons still
change only the phone (a web page cannot take them).

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 2, 4, 5, 8, 10, 13**, and the v1.352 plan
`docs/exec-plans/completed/2026-10-01-speaker-bookmark.md` sections 5 (W0 needsClick), 7 (the gate's findings) for the
remote channel's shape. Read this plan once fully before editing. Order of work: V0, V1, V2, V3, V4.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node for the final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`; an empty grep is not green).

0.3 Worktree: `git -C /home/coder/projects/filetube worktree add .claude/worktrees/remote-volume feat/v1.353-remote-volume`
(the branch exists locally and carries this plan). Rebase onto `origin/main` first if main moved. In the worktree:
`ln -s /home/coder/projects/filetube/node_modules node_modules` before any commit/push, `rm node_modules` after, never stage it.

0.4 Git rules: stage files BY NAME; `git commit -F <file>`; never `--no-verify`, never force-push, never pipe a commit or push;
verify with `git log` / `git ls-remote`. The pre-commit hook runs the unit suite (~4.5 min); a long command goes to the background.

0.5 Tests while building: `test/unit/remote-target.test.js`, `test/unit/remote-controller.test.js`,
`test/integration/remote-api.test.js`, `test/unit/player-remote-api.test.js`, `test/unit/music-remote-controller-wiring.test.js`,
plus the new files each wave names. Full dual-Node `npm test` once after V3, again only if a gate round changes code.

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it. Mutants only on COMMITTED work, in a
/tmp `git archive` sandbox (the v1.352 session's runner pattern: apply an exact-once replace, run the named file, restore, check
the sandbox is pristine).

0.7 No em dashes in docs, comments or user-facing text. UI through `ui.js` primitives and tokens; `npm run lint:ui` must not
grow; `node scripts/overlay-containment-lint.js --enforce` stays 0.

0.8 **Stop rules.** Stop and ask Dean (AskUserQuestion) if: (a) a seam in section 4 does not exist or behaves differently and
the fix is not a like-for-like rename; (b) the dormant iPod volume bar (`.ip-vol`) cannot be shown without restyling every skin
(then propose the smallest alternative); (c) a skin family has no menu and no badge tap to reach Volume (Cider/Nordic: see R3);
(d) the PC's volume cannot be set without changing what its own slider or keyboard shortcuts do; (e) any step needs a new npm
dependency (none planned); (f) a gate seat asks for a scope change; (g) the gate passes 2 rounds and a 3rd is needed.
Never widen scope: log extras in ROADMAP.md Planned.

## 2. Intake: what is possible, and the rulings

- **Possible: the PLAYER's volume on the PC.** A desktop browser lets the page set `media.volume`; the player already has one
  volume with persistence (`ft-volume` / `ft-muted` in localStorage, `persistVolume`, `clampVolume`, the 'volumechange' sync
  path, `VOLUME_STEP` 0.05).
- **Not possible from a web page: the PC's SYSTEM volume** (a native helper on the speaker machine; out of scope, log only).
- **Not possible: the phone's hardware volume buttons.** iOS (and Android Chrome) do not give them to a web page; they change
  the phone's own output. The control must be on screen.
- **Why the phone has no volume today:** iOS makes `media.volume` read-only, so the in-tab skins never offered one. In REMOTE
  mode the phone plays nothing locally, so an on-screen control can drive the PC instead.
- **History that constrains the UI:** v1.235 had the wheel set volume on Now Playing (desktop pop-out); Dean retired it on
  2026-09-02 so the Now Playing wheel SCRUBS everywhere. The volume bar markup (`.ip-vol`, `.ip-vol-fill`, `.mms-voladj`) is
  still rendered, dormant (music-skins.js `ipScreen`, comment "DORMANT since v1.250").

| # | Question | Ruling |
|---|---|---|
| R1 | Surface and look | **Option A (Dean, 2026-10-01), with his constraint: "low friction and looks like iPod volume".** The Volume screen IS the Now Playing LCD with the iPod volume bar (the speaker glyph at each end, the segmented fill) in place of the scrubber, exactly as a real iPod shows it, only while controlling a speaker. The wheel turns the volume while it shows; after ~2 s with no turn it returns to the scrubber by itself (the iPod behaviour), and MENU returns at once. Outside it the Now Playing wheel keeps scrubbing (the 09-02 rule holds). The look is matched to reference photos of the real iPod volume bar (the skin's own era), shown to Dean side by side with the build BEFORE the gate (LESSONS look rule: research first, "look like X" = X's real look). |
| R2 | Reach (low friction) | ONE tap from Now Playing: tapping the volume area of the Now Playing LCD (the scrubber row) while controlling a speaker brings the volume bar up in place; no menu trip. Also a "Volume" row in the Speakers menu while a speaker is chosen (it opens Now Playing with the bar up). The "on <PC>" badge keeps opening Speakers, unchanged. If a tap on the scrubber row conflicts with seeking (it does today: a tap on the track seeks), use the tap on the time labels / an icon at the row end instead, and stop and show Dean the choice (stop rule b). |
| R3 | Skins without menus (Cider, Nordic: `onPlayOnBadge` ends remote control today) | A plain `ui` slider row on their remote Now Playing, visible only while remote. If that needs layout work beyond one row, stop rule (c). Architect default. |
| R4 | Step and rate | The wheel moves 5% per detent (the existing `VOLUME_STEP`); at most one command per 250 ms, the last level always sent (copy the controller's `seek` throttle). Architect default. |

## 3. The design

**Wire (lib/remote/routes.js):** add `'volume'` to `CMDS`; args `{ level }`, a finite number clamped to 0..1 (400 on anything
else); stored and delivered like `seek`. Rate limit: the existing per-user command limiter.

**State (the needsClick pattern, every carrier):** the PC reports `volume` (0..1, rounded to 2 places) and `muted` (boolean) in
`buildStatePayload`; POST `/api/remote/state` validates and stores them (only a finite number in 0..1, only a literal `true`
for muted); `resolvedState` carries them (the idle default too). The field list in `resolvedState` is explicit: a field not
added there never reaches the phone (the v1.352 W0 lesson).

**PC (public/js/remote.js target + player.js):** a public `player.setVolume(level)` wrapper that goes through the SAME path the
PC's own slider uses (set `mediaPlayer.volume`, raising off 0 un-mutes, persistence rides the existing 'volumechange' listener,
so the PC's slider and the stored level follow). `getRemoteSnapshot` gains `volume` and `muted`. The target listens for
`volumechange` (add it to the media event list) so a change made AT the PC reaches the phone (a throttled report).
Caution (v1.352 gate r2): remote.js `onPlaying` treats `volume === 0` as not audible for needsClick. A remote volume of 0 must
not raise the click hint, and coming back up must not need a click. Bind both.

**Phone (public/js/remote.js controller, music.js, music-skins.js, skin-surface.js):** `RC.volume(level)` (throttled like
`seek`; the shown level holds where it was dragged until the PC reports). A volume STATE of the Now Playing view (not a new
menu level): the dormant `.ip-vol` bar swaps in for the scrubber, the wheel's spin adjusts the level while it shows (a wheel
mode that exists ONLY while the bar is up; the scrub mode is unchanged otherwise), ~2 s idle or MENU puts the scrubber back.
Reached per R2. Cider/Nordic per R3.

## 4. The seams (read at v1.352.0; line numbers drift, names do not)

- `lib/remote/routes.js`: `CMDS`, the `seek` arm of POST `/api/remote/command`, POST `/api/remote/state` validation,
  `resolvedState` (both the idle and the reported shape).
- `public/js/remote.js`: target `handleCommand` (the `seek` arm), `buildStatePayload`, `bindMedia` (the media event list),
  `onPlaying` (the volume-0 rule); controller `seek` / `flushSeek` (the throttle to copy), the returned API.
- `public/js/player.js`: `clampVolume`, `persistVolume`, `loadStoredVolume`, `VOLUME_STEP`, the 'volumechange' listener, the
  public API object (`play`, `pause`, `togglePlay`, `seek`, `getRemoteSnapshot` near the end of the file).
- `public/js/music-skins.js`: `ipScreen` (the dormant `.ip-vol` markup), `menuStaticItems` (the `playon` level and
  `hasPlayOn`), `TYPE_TITLE`, `NON_ITEM_LEVELS`.
- `public/js/skin-surface.js`: the wheel gesture's `mode` choice (`'cursor'` vs `'scrub'`, "Now Playing is never idle"),
  `openPlayOn`, the `[data-skin-playon]` badge arm.
- `public/js/music.js`: `remoteCtl` / `hostCtl`, `remoteSkinCtx`, `playOnItems`, `remoteChoose`, `onPlayOnBadge`.
- Proof harness: `tools/listen-control-proof/serve.js` and `speaker-proof.js` (speaker-side reads through CDP
  `Runtime.evaluate` with `userGesture:false`: Playwright's page.evaluate grants a user gesture).

## 5. Waves (one branch, one gate, one release: v1.353.0)

### V0 - Falsifier / baseline (before editing)
In the real browser harness: confirm the PC's `media.volume` is settable on the kiosk Chromium and that today's phone sends no
volume (no command exists: a POST with `cmd: 'volume'` is 400). Record both in section 7.

### V1 - Wire + state (server and PC)
`volume` command; `volume`/`muted` in the state on every carrier; `player.setVolume`; the target's `volume` handler and its
`volumechange` report.
Tests (binding, each mutated red, recorded in section 7): command validation table (0, 1, 0.37, -0.1, 1.2, NaN, '0.5', missing);
the delivered frame; state round-trip POST -> GET targets -> stream frame (drop the field from `resolvedState`: red);
`player.setVolume` through the real player.js realm (persists `ft-volume`, raising off 0 un-mutes, the slider path untouched);
a remote volume of 0 then 0.5 never raises needsClick (unit) and never needs a click (W-row below).

### V2 - The phone's Volume screen (iPod skins) + Cider/Nordic row
FIRST the look (R1): pull reference photos of the real iPod volume bar for the skin eras that ship, build the bar, and send Dean
the reference and the build side by side (SendUserFile) before going further; he answers fast. Then `RC.volume` + throttle;
the volume state of Now Playing (R1), the one-tap reach and the Speakers row (R2), the 2 s idle return, R3's slider.
Tests: the throttle (one per 250 ms, the last level sent); the level renders the PC's reported volume (from a POPULATED state, and
the clear when the speaker is left); the wheel on Now Playing still scrubs (the 09-02 rule, a lock that goes red if the volume
mode leaks); the Volume row is absent when not controlling a speaker.

### V3 - Real-browser proof (W-rows, extend speaker-proof.js)
- a: phone sets 30% -> PC element volume 0.3, `ft-volume` 0.3, survives a PC reload.
- b: PC's own slider to 80% -> the phone's state reads 0.8 within 2 s.
- c: volume 0 then 50% on an unclicked kiosk tab: no click hint at any point, sound resumes.
- d: the Now Playing wheel still scrubs (position moves, volume unchanged).
Record raw numbers in section 7.

### V4 - Docs and release
README (Speakers and links: volume line, and that the phone's buttons stay the phone's), DEVICE-CHECKS lines (section 8),
ROADMAP Shipped, `docs/releases.json` in user language, LESSONS only if a new class appears. Release per docs/RELEASING.md and
the protected-main flow (the v1.352 session's exact sequence: release commit on the branch, local `merge --no-ff` into main,
annotated tag on that merge, push branch + tag in ONE push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o
ServerAliveCountMax=60"`, `gh pr create`, required CI `ci (22)`, `ci (24)`, `audit`, `secret-scan` green, ask Dean, `gh pr merge
--merge`, then `git reset --keep origin/main` only after `git diff <tagged merge> origin/main` is empty, delete branches `-d`).

## 6. The gate: FULL (adversary + qa + security-brief)

Briefs (LESSONS 2, 4, 5, 8, 10): **Adversary**: prove the control inert somewhere real (a skin that never reaches the level, the
wheel mode leaking into Now Playing, the PC reporting a stale level, a field missing from one carrier), the volume-0 / needsClick
interplay, the throttle losing the last value, mutate every binding test. **QA**: regressions in the PC's own volume (slider,
ArrowUp/Down, wheel-over-slider, mute icon, persistence), the existing remote suites, the 09-02 scrub rule, every skin family.
**Security-brief**: the new command's validation (type confusion, NaN/Infinity, a string level), the per-user bucket (another
user cannot set my speaker's volume), the rate limiter. Brief each seat with the trap list: page.evaluate grants a gesture.

## 7. Evidence and gate verdicts

Numbers below are copied from the instrument runs named; raw JSON is committed beside the proofs.

**V0 falsifier (tools/listen-control-proof/volume-v0.js, real server, headless Chromium, every speaker read through CDP
`Runtime.evaluate {userGesture:false}`; raw: volume-v0-out.json).** Before any edit:
- Kiosk (`--autoplay-policy=no-user-gesture-required`), a never-clicked tab playing song1 (`hasBeenActive` false): `media.volume`
  read 1, set to 0.3 read back 0.3, `ft-volume` "0.3" (the existing volumechange listener), still playing, `hasBeenActive` still
  false. The PC's volume IS settable with no click.
- Today's phone: `POST /api/remote/command {cmd:'volume', args:{level:0.5}}` -> `400 {"error":"unknown cmd"}` (both browsers);
  `typeof remoteControl.volume` "undefined".
- Measured, not in the plan: `--autoplay-policy=user-gesture-required`, a never-clicked tab whose stored pref is MUTED
  (`ft-muted` "1"): a phone play plays MUTED (`muted:true, paused:false`); un-muting it with no click PAUSES it
  (`muted:false, paused:true, vol:0.5`, Chromium's rule for un-muting without a gesture). So a phone raising a muted speaker's
  volume can stop it; no page code can lift that. Handling: the honest path that exists (needsClick stays true while only muted
  sound played, so the phone shows "Click the PC's tab once to let it play" once it pauses); bound as proof row c2 in V3.

**V1 mutants @3588e6b8 (tools: a /tmp `git archive` sandbox of the sha, exact-once replace, the named file run, restored; the
sandbox diffed pristine after): 25/25 RED.** routes (CMDS entry, the clamp, a string level, Infinity, resolvedState volume /
muted, the POST store, the in-range check, muted truthy, the idle default), store (the volume supersede), player (no un-mute,
strings accepted, no rounding, no store before the first load, the snapshot's volume / muted), target (the command ignored, the
payload's volume / clamp / muted, volumechange missing from the event list, onVolume never clearing / clearing while paused,
the navigate-timeout idle report without volume). Unit hook on the commit: 8210 tests, 8210 pass, 0 fail.

**V2 the look, Dean's rulings (2026-10-01, AskUserQuestion, with real-browser shots each time):**
- Reference: no freely licensed photo of the iPod's own volume screen was found (Wikimedia Commons, Openverse, Apple's iPod
  classic / nano user guides describe the bar but do not draw it); the 5G Now Playing photo (Commons, CC BY-SA 2.0) shows the
  progress bar the volume bar shares. Dean sent his own reference (the Mac OS X volume HUD: a rounded tile, 16 squares).
- Built the tile; Dean: "I want it to fit the iPOd aesthetic. What do you think?", then asked whether iPods drew a box. Answer
  given: no; the click-wheel iPods swapped the progress bar in place for a volume bar (a quiet speaker, the same bar, a loud
  speaker); the boxed tile is the Mac OS X / early iPhone OS overlay. **Ruling: "The iPod's own bar, in place."** Built: the
  scrubber row becomes the volume bar, its groove and fill are the scrubber's own rules (the Aqua tube; the Original's monochrome).
- **R2 reach ruling: "Tap the time labels"** (a tap on the bar seeks, the plan's stop). Also Speakers > Volume (R2) and a tap on
  the shown bar sets the level there (a shown control must act, LESSONS 4).

**V2 mutants @0a1c0d01: 33/36 RED** (the first run @afb4c63b also exposed two survivors, bound by a stale-tap test in 0a1c0d01:
the bar needs the view's available() AND a level). Survivors @0a1c0d01, each a real gap, bound in 57d6b9d4 and re-run there
**3/3 RED**: a turn not re-arming the idle timer; the renderers taking a string level; and a level still waiting out the
throttle when the phone leaves, which would have reached the NEXT speaker picked. One mutant (the step sign inverted) hung its
file; the runner now has a per-test timeout and restores in `finally`. Hook on 57d6b9d4: 8233 tests, 8233 pass, 0 fail.
Two old locks pinned the retired 09-02 shape ("no volume mode in the engine") and the dormant bar's tokens; updated with their
intent kept (local play never touches volume; the engine never writes an element volume); the dead `--pk-s-sel-hi` /
`--mms-ipod-blue-hi` went with their only reader (the screen-role floor and the token count -1 each, the UI ledger shrank 2).

**V3 (tools/listen-control-proof/volume-proof.js on 57d6b9d4 + the proof's own fix, real server, real login; raw:
volume-proof-out.json), all rows pass, 0 page errors:**
- a: phone 30% -> PC element 0.3 in 5 ms, `ft-volume` "0.3"; after a PC reload `ft-volume` "0.3", snapshot 0.3, the next
  song's element 0.3, the phone reads 0.3.
- b: the PC's own slider to 80% -> the phone's state 0.8 in 407 ms; the targets list 0.8.
- c (kiosk, `hasBeenActive` false before and after): volume 0 then 50%, 9 samples 400 ms apart: never a click hint
  (`needsClick` false, the pill never asking), playing in every sample.
- d (iPhone 13, the iPod skin, the bar down): a real mouse spin on the wheel moved the PC 0.7 s -> 9.2 s, volume 0.5 -> 0.5.
- e (the whole phone chain): a tap on -1:58 put the bar up; a 180 deg clockwise spin took the PC 0.5 -> 0.9 (the phone's bar
  90%), 90 deg back -> 0.7; MENU put the scrubber back; a tap then 2012 ms of nothing put it back by itself.
- f: the badge -> Speakers -> Volume landed on Now Playing with the bar up; after leaving the speaker no bar or tap target.
- c2 (`user-gesture-required`, a never-clicked tab, `ft-muted` "1"): the phone's play plays MUTED; raising to 0.5 un-mutes and
  Chromium PAUSES it (`paused:true`); the phone reads `paused`, `needsClick` true, the click hint shows; one real click on the
  pill's text, then the phone's play -> `playing`, the PC `paused:false` at 0.5, `needsClick` false.
- The proof's own click was wrong twice and was fixed in the proof, not the product: (640,700) is the player's click-to-toggle
  art; and in the full run the handoff card ("Continue here") covered the pill's text (a pre-existing overlap, logged in ROADMAP
  Planned > Bugs). The speaker context now hides the handoff card, as the phone context always did.

## 8. Device checks Dean would owe (into DEVICE-CHECKS.md at release, one line each)

- [ ] v1.353.0 - Phone controlling the speaker, Now Playing: one tap brings up the iPod volume bar in place of the scrubber; turn the wheel: the PC gets louder and quieter and the bar matches; stop turning and it goes back to the scrubber by itself.
- [ ] v1.353.0 - It looks like the iPod's own volume bar (speaker glyphs, the fill) on each iPod skin you use.
- [ ] v1.353.0 - Move the volume on the PC itself: the phone's Volume bar follows within a couple of seconds.
- [ ] v1.353.0 - Turn it all the way down and back up from the phone: it plays again with no click on the PC.
- [ ] v1.353.0 - On Now Playing the wheel still scrubs the song (it never changes volume there).
- [ ] v1.353.0 - Cider or Nordic skin while controlling the speaker: the volume row works the same.
- [ ] v1.353.0 - The phone's own volume buttons still change only the phone (expected).

## 9. Out of scope (log, do not build)

- The PC's SYSTEM volume (a native helper on the speaker machine).
- The phone's hardware volume buttons (not available to a web page).
- Speakers resume after the phone closes the app (ROADMAP Planned, its own plan).
