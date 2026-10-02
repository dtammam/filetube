---
plan: remote-volume
harness: v2 · lean
branch: feat/v1.353-remote-volume
anchor: spec
status: Shipped v1.353.0
next: shipped (device checks owed, see docs/DEVICE-CHECKS.md)
design: Dean 2026-10-01 ("I like this. Yes. Let's do it.") on option A, then "As long as the volume screen is low friction and looks like iPod volume I am good" (R1, R2 below are binding); R3, R4 are architect defaults he did not overrule
gate: APPROVED r2 @b145bd14 (FULL: adversary + qa + security-brief)
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

### Gate

Gate: APPROVED r1 @fdfb0d1e - security-brief
- Gap (stated first): this seat has no shell, so it did not run `git diff` and did not run any test. It read the files at the worktree's HEAD and assumed HEAD is fdfb0d1e without checking. Everything below is traced by reading code, not run.
- No CRITICAL, no WARNING.
- Verified (code traced), command validation: routes.js `clampLevel` takes only a finite `typeof number`. That rejects a string level, NaN, `1e999` (JSON.parse gives Infinity), arrays, objects and a missing level with a 400. `{"args":{"__proto__":{"level":0.5}}}` becomes an own key under JSON.parse, so `args.level` is undefined and the request gets a 400. A non-object or array `args` becomes `{}` and gets a 400. What is stored and sent is a fresh `{ level }` holding a clamped number, the same object on the live frame, the poll and the Last-Event-ID replay (`commandFrameArgs` returns the stored args). The PC side checks again: `player.setVolume` needs a number, clamps it and rounds it.
- Verified, state: POST /state stores `reportedLevel(body.volume)` (a finite number in 0..1, otherwise null) and `muted === true`. `resolvedState` checks the stored value again on every carrier (idle default, targets, poll, stream). The phone renderers (`volLevel`, `reflectVolume`) accept only a finite number, clamp it and `Math.round` it before it goes into `aria-valuenow` or a `style` width. No member-supplied string reaches another device's DOM.
- Verified, per-user bucketing: every new path reads only `req.user.id` and the store's per-user Maps. Another user's deviceId can never be found (it gets a 410). The outbox supersede filters only `cmd === 'volume'` inside that one target's outbox, so it cannot evict a play, seek or other command type. The per-user limiter (30 burst, 10/s) is far above a wheel's 4/s, and the supersede keeps a volume flood from growing the outbox.
- SUGGESTION (same user, not a security boundary): `remoteChoose(t)` switches speakers with `RC.select(B)` and never calls `leave()`. `select()` does not clear `volTimer`/`volPending`/`volHeld`, so a level still waiting out the 250 ms throttle when you switch from speaker A to speaker B is sent to B. The old held level can also show on B's bar for up to 1.5 s. Making this happen needs a menu trip finished inside 250 ms, so it is unlikely, and seek has the same shape already. Fix: clear the volume and seek throttle state in `select()` as `leave()` does. The plan's fix covers leaving a speaker, not switching straight to another one.
- SUGGESTION (functional, not security): a target that replays its outbox (poll `since` or Last-Event-ID) can re-apply the phone's last queued volume over a change made later at the PC's own slider. This is the same "replays queued commands once" limit v1.348 already accepted.

Gate: APPROVED r2 @b145bd14 - security-brief
- Gap (stated first): still no shell, so no `git diff fdfb0d1e..b145bd14` and no test run. I read the delta files the coordinator named at the worktree's HEAD and assumed HEAD is b145bd14 without checking. I did not read the delta's tests. I re-read `lib/remote/routes.js` only by grep and did not diff it; the coordinator lists no change there.
- r1 SUGGESTION 1 (switching sends a pending level to the new speaker): fixed as prescribed. `remote.js` `select()` now calls `dropPending()` (clears the seek timer and pending seek, the volume timer, the pending level and the held level) before it changes `targetId`. `leave()` calls the same helper.
- r1 SUGGESTION 2 (an outbox replay re-applies the last queued volume): accepted as the v1.348 known limit. No security impact.
- New in the delta, checked by reading the code, nothing opens a surface. A muted PC shows 0 on the phone (`music.js` `remoteVolume`): display only, the input is already a checked number. `getRemoteSnapshot` reports null when the volume cannot be set, and null is already a handled value on every carrier. The bar tap maps `clientX` across the groove, then clamps and rounds; a NaN still reaches `setVolumeLevel` as NaN, but `RC.volume` drops anything that is not finite and the server refuses it with a 400. The Cider/Nordic `::before` tap area is CSS only.
- No CRITICAL, no WARNING, no new SUGGESTION.

Gate: CHANGES r1 @fdfb0d1e - qa
- Instruments (QA ran these, Node 22.23.1): `npm run lint:ui` exit 0 ("the live debt equals docs/ui-exceptions.json"); `node scripts/overlay-containment-lint.js --enforce` exit 0 ("clean (0 violations)"); eslint on every changed js file and tools/listen-control-proof exit 0. Targeted suites: the remote set (remote-target, remote-controller, remote-api, player-remote-api, music-remote-controller-wiring, remote-store, remote-volume-surface) plus music-skins, music-sticker-menu, pocket-design-system, token-scale-lock gave 222 tests, 222 pass, 0 fail. Every test file that loads skin-surface (37 files) plus the PC volume files (player-controls, player-responsive-controls, player-cc-btn-parity, swipe-back-owners, prefs-sync-client, prefs-api) gave 1163 tests, 1163 pass, 0 fail. The full suite was not re-run (the builder's dual-Node runs stand).
- Regressions, none found. The PC's own volume (the #vol-bar input, ArrowUp/Down, wheel over the slider, the mute button, the volumechange persistence, initVolume, the iOS hide) is unchanged in the diff; setVolume is a new, separate entry point. Real browser, iPhone 13 (scratch script, worktree serve.js): the bar row and the scrubber row end at the same y (268.5) on ipod, ipod-original, ipod-frost, ipod-nano3-silver and ipod-2004. .ip-lcd-in stays 258.5 tall, and the meta above does not move. The bar is 20 px against the scrubber's 16.8, and the extra 3.2 px goes upward into the flexible meta area. Local play: no voltap, no [data-skin-vol], no .ip-vol. Cider puts the row in by moving the content above it up 34 px (the transport stays at 744). Nordic pushes the transport and queue down 46 px (one row, R3). 0 page errors.
- WARNING (verified, unit harness in scratch): public/js/remote.js `select()` (about line 547) does not clear `volTimer`/`volPending`/`volHeld`, and music.js `remoteChoose` switches A -> B with `RC.select(B)` and no `leave()`. Measured: (1) volume(0.5), volume(0.6), select(pc2), advance 1 s: commands sent `[["pc",0.5],["pc2",0.6]]`, so A's level reached B. (2) volume(0.9) on A, 300 ms later select(pc2) with B at 0.2: right after select B shows 0.2. B's first stream frame (routes.js:187 writes one on connect) then shows 0.9, and 5 s later, with no new B frame, it still shows 0.9. withHeldVolume writes the held level into `last`, and a paused or idle B sends no heartbeat, so A's level stays on B's bar after the hold ends. The next wheel detent then sends 0.95 to a speaker sitting at 0.2. Reach: turn the volume, tap the "on <PC>" badge, pick another PC, all inside 1.5 s. That is two taps, so this is more than the security seat's "inside 250 ms" case. Fix: clear the volume (and seek) throttle and hold state in `select()` the way `leave()` does, and bind the direct-switch path. The existing test only binds leave-then-select.
- WARNING (verified, real browser): the phone never reads `muted` (no reader in music.js, skin-surface.js or music-skins.js). Measured: the PC at 0.5, its mute button pressed, so the PC element is {v:0.5, muted:true}. The phone's state reads {volume:0.5, muted:true}, but its bar shows aria-valuenow "50" and a 50% fill. One detent DOWN (0.45) un-mutes the PC (the slider's rule), giving {v:0.45, muted:false, paused:false}. Turning down makes a silent speaker play, and the bar claims sound where there is none. That breaks section 1 ("the bar shows the PC's real level"), and the muted field is carried through every carrier and never used (an inert field). Fix: render a muted speaker (for example the fill at 0, or the quiet glyph, with aria-valuetext "Muted"), and decide what a detent does from a mute. Or have Dean rule it disclosed.
- WARNING (reasoned, not measured: no iOS device here): player.js getRemoteSnapshot reports `mediaPlayer.volume` even when `volumeSettable` is false, but setVolume returns false there. On an iPhone or iPad speaker (Remote control is not gated to desktop), the phone draws a 100% bar. Each turn shows the new level for 1.5 s and then snaps back, and the PC never changes: a shown control that does not act (LESSONS 4). This also makes the remote.js buildStatePayload comment "a player that cannot say reports no volume (null), never a made-up one" untrue. Fix: report volume null when the probe found it unsettable (then the phone draws no bar), and bind it.
- SUGGESTION: tools/listen-control-proof/volume-look.js line 3 still says "the volume tile up", and line 44 still counts `.ip-vol-seg.is-on`. Those are from the boxed tile Dean retired, so the committed tool reports segsOn 0 for every skin.
- SUGGESTION: R3 says "a plain `ui` slider row". What was built is a tap-only `.mms-bar` row in the skin renderer (no drag, no keys), which matches the skin seek bars. That is reasonable, but section 7 does not record the deviation.
- Security standing section, no new finding. The command level must be a finite number and is clamped (routes.js clampLevel). Reported state takes only an in-range number and a literal `true`. Everything goes through the existing per-user enqueue and the 30-burst / 10-per-second command limiter (a wheel sends at most 4 per second). The renderers write only a number they clamped and rounded into style and aria. I agree with the security-brief entry above.

Gate: CHANGES r1 @fdfb0d1e - adversary
- Instruments (Node 22.23.1 unless noted; a /tmp `git archive fdfb0d1e` sandbox, never the worktree): eslint . on the pristine tree: 0 errors, 6 warnings (all pre-existing, public/js/common.js, untouched). `npm run lint:ui`: "OK - the live debt equals docs/ui-exceptions.json". overlay-containment --enforce: "clean (0 violations)". Full suite, Node 22, first run in the archive sandbox with --test-timeout=120000: 10374 tests, 10352 pass, 8 fail, 1 cancelled, 13 skipped. All 9 were instrument artifacts: 7 git-ls-files source locks failed with "not a git repository", and ytdlp-store timed out at my 120 s cap. The same 8 files re-run in a git-initialised copy: 330 tests, 330 pass. Full suite, Node 24.20.0, in that copy: 10634 tests, 10621 pass, 0 fail, 0 cancelled, 13 skipped.
- Surface 1, verified (real browser, iPhone 13, all 131 skins in SK.SKINS): a real mouse tap on the time labels showed the bar on 129 of 129 iPod skins, including the Original look. Both labels and the bar were measured non-zero and on top at their centres (elementFromPoint), with mms-voladj set. Cider and Nordic each show one row. 0 page errors. No skin family is unreachable.
- WARNING (verified, real browser; agrees with QA): a MUTED speaker. The PC is at ft-volume 0.5 with ft-muted 1. The phone state reads {volume 0.5, muted true}, and the bar shows aria-valuenow 50 and a 50% fill. A real counter-clockwise wheel detent ("quieter") changed the PC from {v 0.5, muted true} to {v 0.45, muted false, paused false}, and ft-muted went to "0". A silent speaker starts playing when you turn it down. `muted` is carried on every carrier and read by no phone code. On a never-clicked tab under the default policy, the same un-mute pauses the speaker (the builder's own c2), so a downward turn can stop it.
- WARNING (verified in a SIMULATED read-only realm; no iOS device here): an init script made HTMLMediaElement volume read-only, like iOS. The PC hid its own slider (#vol-bar display none) but reported volume 1, and the phone drew a 100% bar. After RC.volume(0.3) the phone still showed 0.3 at 2500 ms while the PC element stayed at 1. The PC's report fell inside the 1.5 s hold, and the next report is the 5 s heartbeat, or none while paused. So the control does nothing and its level is wrong. An iPad can turn Remote control on (the switch gates only isPhone, short side 500). Mutant M18 (drop setVolume's `if (!volumeSettable) return false`) SURVIVES. The remote.js comment "a player that cannot say reports no volume (null), never a made-up one" is false. Fix: getRemoteSnapshot reports volume null when the probe found it unsettable, and bind that.
- WARNING (agrees with QA; reach measured): `select()` keeps volPending/volHeld, and remoteChoose switches with RC.select and no leave. Unit, the real controller: [["pc",0.25],["pc2",0.3]] was sent, and B's first stream frame showed A's held 0.2 over B's 0.9. Real browser, stream mode, switching 0.8 s after the turn: B showed its true 0.9 and a detent went 0.9 -> 0.95, because A's confirm had already released the hold. Reach is therefore the confirm latency: about 0.5 s on the stream, up to the 2 s CONTROL_POLL_MS cadence in poll fallback, where two taps fit. The builder's binding test drives leave() then select(), a path the product never takes (a divergent fixture). Mutant M27 (leave keeps volHeld) SURVIVES. Fix: clear the volume and seek throttle and hold state in select(), then bind the direct switch.
- SUGGESTION (verified, all 129 iPod skins): a bar tap maps across the whole .ip-vol, glyphs included, not across the groove. A tap at 80% of the groove set 0.75 on every iPod skin. The groove's ends give about 0.10 and 0.90, so the fill never ends under the finger. Cider/Nordic: the row's tap target is 6 px / 4 px tall (the seek bars' size), and its glyphs are not tap targets, unlike the iPod bar's.
- Mutants: 45 run, 35 RED, 10 SURVIVED. The sandbox diffed pristine after every batch. The builder's claimed set re-killed: CMDS, clamp, resolvedState, idle default, nav-timeout volume, volumechange, the un-mute, rounding, the supersede, the hold release, the onVolume rules, the Cider/Nordic rows, the Volume row, MENU/Select/idle/re-arm, and the 09-02 mode line. The mode line is red ONLY through the source regex, but the behaviour test covers the leak. Survivors besides M18/M27: M3/M9 (the list-mode close and guard), M10 (the menu-mode guard), M6 (destroy's closeVolume), M11 (a bar tap re-arming idle; a bar tap at 1.9 s is followed by a close at 2 s), M14 (the comment "the hold runs from the SEND" is unbound), B3 (POST /state's validation, redundant with the read-side reportedLevel) and B12 (flushVolume's targetId guard; leave clears the timer first). M3/M9/M10/B3/B12 are redundant guards, not bugs. M11 and M14 are small, unbound claims.
- Locks rewritten (surface 7): the 09-02 intent is now behavioural (the surface test spins and scrubs with a speaker present and with local play) as well as a source regex. The engine-writes-no-element-volume lock is stricter than before, not weaker. The token/ledger -1s match the CSS. The fill lock pins the same declaration on a selector list. No intent was lost.

r1 fix round (the builder; measured at the fix commit):
- **Dean's ruling (2026-10-01, AskUserQuestion): a MUTED PC shows the bar empty; turning up un-mutes it from 5%; turning down
  does nothing.** music.js remoteVolume returns 0 while muted; the controller's shown and held state un-mutes for a level above
  0 (player.setVolume already un-mutes off 0, the slider's rule). Proof row g (real browser): the PC's own mute button -> the
  phone reads {0.7, muted}, the bar 0%; one detent down -> the PC still {0.7, muted}; one detent up -> the PC {0.05, un-muted},
  the bar 5%.
- qa W1 = adversary W1 = security S1: select() drops the throttled seek and volume and the held level (dropPending, shared with
  leave); a test drives the DIRECT switch (no leave): nothing reaches pc2 and pc2's first frame shows its own 0.9.
- qa W3 = adversary W2: getRemoteSnapshot reports volume null where the volumeIsSettable probe failed (iOS), so a phone draws no
  bar; a test makes the element's volume read-only (the PC hides its slider, the snapshot is null, setVolume false, nothing stored).
- adversary S1: a bar tap maps across the GROOVE (.ip-vol-track); a tap on its speaker icons only keeps the bar up. The Cider /
  Nordic bar (4-6 px) gets a tap area 12 px above and below it (a ::before).
- adversary S2 survivors bound: a tap restarts the idle timer (M11), destroy() takes the timer (M6). Disclosed as redundant
  guards, not bound: M3/M9/M10 (list/menu guards repeated by volumeShowable), B3 (POST /state validation repeated by
  resolvedState), B12 (flushVolume's target check, now also covered by dropPending), M14 (the hold-from-send comment).
- qa S1: volume-look.js comments and its read fixed. qa S2 (R3): the Cider/Nordic row is a tap row in the skin renderer, the same
  shape as those skins' own seek bars (there is no `ui` slider primitive); no drag, no keys. Disclosed.
- security S2 (disclosed, the v1.348 known limit): a target replaying its outbox once (poll since / Last-Event-ID) can re-apply
  the phone's last queued volume over a later change at the PC.

Gate: APPROVED r2 @b145bd14 - qa
- Instruments at b145bd14 (Node 22.23.1): `npm run lint:ui` gives "OK - the live debt equals docs/ui-exceptions.json". `node scripts/overlay-containment-lint.js --enforce` gives "clean (0 violations)", exit 0. eslint on the changed js files, tools/listen-control-proof and the changed tests: exit 0. Targeted files gave 287 tests, 287 pass, 0 fail: the remote set, remote-volume-surface, music-skins, music-sticker-menu, pocket-design-system, token-scale-lock, player-controls and swipe-back-owners.
- r1 W1 (direct switch), fixed as prescribed. My r1 scratch probe was re-run unchanged against b145bd14. Sent `[["pc",0.5]]`, so nothing reached pc2. B showed its own 0.2 after select, after its first frame, and 5 s later.
- r1 W2 (muted), fixed per Dean's ruling, real browser, iPhone 13, iPod skin. With the PC muted at 0.5, the bar reads aria 0 and a 0% fill. A tap at the groove's left end gives the PC {v:0, muted:true}, still silent. A tap at 30% of the groove gives the PC {v:0.3, muted:false}, and the phone shows 0.3, un-muted, with a 30% fill. Wheel-down from a mute: stepVolume finds next == cur == 0 and sends nothing (code read; the builder's row g measured it).
- r1 W3 (iOS), fixed for a speaker that has loaded a song (the snapshot is null when volumeSettable is false, and the read-only-realm test binds it). See the first SUGGESTION for the case before the first load.
- r1 S1 (volume-look.js) fixed. r1 S2 disclosed in section 7.
- What the fix added, the Cider/Nordic ::before tap area, measured with elementFromPoint at x=195 (real browser, iPhone 13) on a vertical scan. Cider: SEEK 658-663, times 672-685, VOL 694-723, transport from 744. Nordic: SEEK 450-454, times 460-474, VOL 495-523, transport from 544. The volume area does not overlap the seek bar, its time labels or the transport (8-20 px clear). The seek bars keep their own 6 px / 4 px target, which is unchanged. The iPod bar's tap now maps across .ip-vol-track, and its icons only keep the bar up. 0 page errors.
- SUGGESTION: player.js getRemoteSnapshot still reports the stored level (or 1) while `mediaPlayer` is null (ensureHost runs only on the first load), and volumeSettable is only probed in initVolume. An iPhone/iPad speaker that has not played anything yet therefore still reports a volume, and the phone offers a bar until the first song loads. The new comment "null where a page cannot set it (iOS)" is true only after that load. This is narrow (an idle iOS speaker), so I do not block on it.
- SUGGESTION: withHeldVolume ends the hold on a volume match alone. Take a muted PC at 0.7 and a phone tap at 70%. A PC report sent before the command landed, {0.7, muted:true}, ends the hold and shows the bar empty for one report cycle (about 500 ms) until {0.7, muted:false} arrives. This is cosmetic; comparing `muted` as well (a held level above 0 means not muted) would close it.

Gate: APPROVED r2 @b145bd14 - adversary
- Delta reviewed: `git diff fdfb0d1e..b145bd14`. All runs were in a /tmp `git archive b145bd14` sandbox (Node 22.23.1), diffed pristine afterwards. No full suite was run (that is for after the gate, per the brief). No CRITICAL, no WARNING.
- r1 W muted, fixed as Dean ruled (verified, real browser, iPod skin). PC muted at 0.5: the bar shows 0 (aria 0, fill 0%). A real counter-clockwise detent left the PC at {0.5, muted}. Re-muted at the PC and tapped the groove at 60%: PC {0.6, un-muted}, bar 60. A tap at the groove's left edge: PC {0, un-muted}, bar 0. Cider and Nordic: muted shows the row at 0, and a tap 9 px above the 4-6 px bar set PC 0.4 un-muted. Unit test on the real controller: a turn up to 0.05 shows [0.05, un-muted], and a stale {0.7, muted} frame inside the hold keeps it.
- r1 W unsettable volume, fixed as prescribed (verified). Simulated read-only element volume, now playing: the phone state is volume null, with no .ip-vol and 0 tap targets. M18 is now RED.
- r1 W switching speakers, fixed as prescribed (verified). My r1 unit repro now sends [["pc",0.25]] (nothing to pc2), and B's first frame shows its own 0.9, not A's hold. Old M27 (the hold kept) is RED as R2.
- r1 S1, fixed. A tap on the loud speaker icon kept the bar up and set nothing (PC stayed 0.6). The Cider/Nordic ::before reaches 12 px above and below. Hit test: it takes 0 of 399 / 0 of 290 points from the seek bars, 0 of 855 / 0 of 870 from the time rows, and 0 from every transport button on both skins.
- Mutants on b145bd14: 15 run, 12 RED (select keeping its pending state, the hold kept, heldFields x3, the view ignoring muted, the snapshot ignoring settability, M18, the whole-bar tap mapping, an icon tap setting a level, M11, M6). 3 survived, all SUGGESTION:
  - R3: dropPending keeping seekPending (a direct switch would still send a waiting seek to the new speaker; unbound).
  - R11: an icon tap not re-arming the idle timer (the fix-round claim "only keeps the bar up" is unbound).
  - R12: deleting the Cider/Nordic ::before tap area (CSS, unbound; measured above).
- SUGGESTION (verified, simulated read-only realm): before the speaker's first load (the player host is created lazily), getRemoteSnapshot still reports the stored volume (1). An idle iOS/iPad speaker therefore shows the phone volume 1 and offers Speakers > Volume, and a level set then is only stored, which initVolume never applies there. The window closes at the first play (the state then reads null).
- SUGGESTION (unit test): a muted PC whose stored level is exactly 0.05. Its stale {0.05, muted} report releases the hold by level equality and briefly shows 0 until the un-muted report arrives. Re-picking the SAME speaker inside the 250 ms throttle drops the last waiting level (it sent 0.6, not 0.65). Both are cosmetic or hard to reach.

**Gate closed: all three seats APPROVED r2 @b145bd14** (their lines above). Fix-round mutants on b145bd14: 12/12 RED (the
builder); the adversary's 15 there: 12 RED, 3 SUGGESTION survivors (the waiting seek on a direct switch, the icon tap's idle
re-arm, the Cider/Nordic ::before tap area: the last two measured in the browser only). Disclosed, logged in ROADMAP Planned >
Bugs: an iOS speaker before its first song still offers a bar (QA S1 = adversary); a sub-second empty bar when a muted PC's
stored level equals the level set (QA S2 = adversary); re-picking the same speaker within 250 ms drops the last waiting level.

**Suites on b145bd14 (after the gate, the round changed code): Node 22.23.1: 10640 tests, 10628 pass, 0 fail, 12 skipped.
Node 24.20.0: 10640 tests, 10628 pass, 0 fail, 12 skipped.** Before the gate, on fdfb0d1e: Node 22.23.1 10634 / 10622 / 0 / 12
(a first Node 22 run read 10634 / 10621 / 1 fail / 12: ytdlp-outcome-threading "AC-FM-C baseline" `fetch failed`, under a CPU
straggler the builder had left from a hung mutant, pid killed; that file standalone 10/10 twice; the clean re-run is the record);
Node 24.20.0 10634 / 10622 / 0 / 12. `lint:ui` OK (2 paid entries shrunk), overlay census 0.

## 8. Device checks Dean would owe (in DEVICE-CHECKS.md, "Speakers volume (v1.353.0)")

The nine v1.353.0 lines there, reworded from this plan's draft for the shipped look (the in-place bar, the time-label tap,
Speakers > Volume, Dean's mute rule).

## 9. Out of scope (log, do not build)

- The PC's SYSTEM volume (a native helper on the speaker machine).
- The phone's hardware volume buttons (not available to a web page).
- Speakers resume after the phone closes the app (ROADMAP Planned, its own plan).
