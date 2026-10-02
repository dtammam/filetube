---
plan: speaker-resume
harness: v2 · lean
branch: feat/v1.356-speaker-resume
anchor: spec
status: Building
next: Dean ruled R9 (ship as is, disclosed); the FULL gate
design: Dean 2026-10-02 - valid = the speaker is still on AND (it is still playing OR the app closed under 1 hour ago); reattach SILENTLY with a short toast; reattach and show whatever the speaker plays now (or idle); R4-R8 are architect defaults
gate: FULL (adversary + qa + security-brief; Dean: it changes what the phone trusts; never dial down)
---

# v1.356: a phone that closes the app comes back still connected to its speaker

Written 2026-10-02 by the Opus Architect at main 534f4a70, during the v1.355 intake. ROADMAP Planned "Speakers: a phone that
closes the app comes back still connected" is the WHAT; this plan is the HOW. Shares no code with v1.355 (A: the rotate-log
switch, B: keyboard search).

## 1. The outcome (what Dean will do on device)

1. Phone plays on a speaker PC (Play on... > Otter). Close the app fully (swipe it away) and reopen within the hour, or later
   while the PC is still playing: the phone opens already on Otter, Now Playing shows the PC's song and where it is, and a
   short "Playing on Otter" toast. Nothing on the PC changes (no restart, no seek, no pause).
2. Reopen after the PC turned Remote control off, closed its tab or went to sleep: the phone opens in its own (local) mode,
   quietly (no "Lost" toast, no error).
3. Reopen over an hour later with the PC paused or idle: local mode, quietly.
4. Minimizing and coming back keeps working as today.

## 0. Step 0

Same rules as every plan (see `docs/exec-plans/completed/2026-10-02-pocket-music.md` section 0, and AGENTS.md): fnm PATH, a
worktree in `.claude/worktrees/`, stage by name, `git commit -F`, never `--no-verify` / force-push / piped git, mutants only on
committed work in a /tmp `git archive` sandbox, failures verbatim with counts, no em dashes. Read `docs/LESSONS.md` sections
**0, 1, 2, 4, 8, 10, 12** and `docs/exec-plans/completed/2026-09-30-listen-control.md` (the channel's design and its gate).
Stop and ask the Architect if a seam differs from section 4 or the design needs a server change (none planned).

## 2. Rulings and defaults

| # | Question | Ruling |
|---|---|---|
| R1 | How long a remembered speaker stays valid | **Dean: the speaker is still listed by `GET /api/remote/targets` AND (its state is `playing` OR the phone last left under 1 hour ago).** "Last left" = the time the page was last hidden while attached (visibilitychange hidden / pagehide), so the hour counts from the close, not from the pick. |
| R2 | Silent or ask | **Dean: silent**, with a short toast "Playing on <label>" once the check passes. |
| R3 | The speaker now plays something else, or nothing | **Dean: reattach and show what it plays now** (or idle: the menu lands where an idle speaker pick lands today). The phone sends NOTHING on reattach. |
| R4 | Where the memory lives | A NEW localStorage record `ft-remote-resume` = `{ v: 1, deviceId, label, user, at }`, written only on a PHONE (`html.is-phone`, the class `isPhoneDoc` reads). The per-tab sessionStorage key `ft-remote-controlling` stays exactly as today (minimize, reload and desktop tabs unchanged). The record is read only when sessionStorage holds no pick (a fresh launch). Architect default: a desktop browser's new tab never inherits a speaker. |
| R5 | Never trust before the check | On a fresh launch the controller holds the record as PENDING: `targetId` stays empty (so `isRemote()` is false, the UI stays local and `send()` refuses) until the targets check confirms the device AND R1 passes. Only then `select()`-like attach (which writes sessionStorage as today). A failed or errored check = stay local, quietly; the record is kept (within R1) so the next foreground retries once. This is stricter than today's `restore()` (which sets `targetId` before asking and trusts it on a network error); today's per-tab restore keeps its behaviour. Architect default. |
| R6 | Whose speaker | The record carries the signed-in user's id (or another stable per-account value the client already has; W0 finds it). A different user = the record is deleted unread. Belt and braces: the server already buckets every remote route by `req.user.id` (lib/remote/routes.js), so a foreign deviceId is never listed and never accepts a command (410). Architect default. |
| R7 | When the record is forgotten | Picking "This device", `lost()` (the speaker went away while attached), a failed R1 on launch, a user mismatch, and sign-out. Architect default. |
| R8 | Quiet means quiet | A launch that does not reattach shows no toast and no error; `lost()`'s "Lost <label>" toast stays for a speaker that goes away WHILE attached. Architect default. |
| R9 | The listed state can be stale (builder finding 1) | **Dean 2026-10-02: ship as is, disclosed.** A speaker reports its state only while a phone is attached, so a pause or play AT THE PC after the phone left is not in `GET /api/remote/targets`; a record older than the hour can then reattach to a speaker paused by hand (shown paused, never commanded). Logged in ROADMAP Planned: the speaker posts its state on play / pause / track change / end even with no phone attached. |

## 3. The seams (read at 534f4a70)

- `public/js/remote.js`: `CONTROL_KEY` (~454), `createController` (~485): `store`, `select`, `leave`, `lost`, `restore` (~606),
  `fetchTargets` (~626), `send` (~631, refuses with no `targetId`), `visibility` (~683); `browserEnv` (~756, `storage` is
  sessionStorage; add a `localStore` the same safe way); `bootWhenReady` (~779: `control.restore()` and the visibilitychange
  hook); `isPhoneDoc`.
- `public/js/music.js`: `RC` (~1466), `remoteChoose` (~1579: pauses the local player on a pick; a reattach on launch must make
  sure the local player is not playing too, W0 checks what a cold launch does locally), the mirror (`RC.onChange`, ~2932).
- Server (read only, no change planned): `lib/remote/routes.js` GET `/api/remote/targets` (~231), POST `/api/remote/command`
  (~245), `lib/remote/store.js` `listTargets` (~304, `isLive`).
- Proof harness: `tools/listen-control-proof/speaker-proof.js` / `volume-proof.js` (two contexts as one user; CDP
  `Runtime.evaluate {userGesture:false}` for the speaker).

## 4. Waves

### W0 - Falsifiers (record in section 6)
1. Prove today's failure in a real browser: phone context picks a speaker, then a NEW page in a context carrying the same
   localStorage but empty sessionStorage (a killed PWA): it opens local. Record.
2. What a cold launch does locally (does the phone's own player restore or start anything?), so a reattach cannot leave both
   playing.
3. Where the client can read the signed-in user's id (R6).

### W1 - The record and the guarded resume (remote.js)
Write the record on attach (select/restore success) and stamp `at` on every hide while attached; delete it per R7. On boot with
no sessionStorage pick, read it (try/catch, JSON-validated shape, `v === 1`, string ids within the server's limits): wrong user
or older than R1 allows -> delete, done. Else PENDING (R5): `fetchTargets()`; attach only if the device is listed and R1 holds
against the LISTED state (`playing`, or `now - at < 1 h`); on attach, the same path as `select()` (stream, mirror, sessionStorage)
plus the R2 toast; else quiet local (R8). Pure decision exported (`resumeDecision(record, now, user, targets)` -> `'attach' |
'drop' | 'keep'`) so tests drive every arm.

### W2 - The phone's view (music.js)
On a resume attach: the local player paused if anything plays (the `remoteChoose` rule), Now Playing / the menu land as an
existing pick of that speaker does (a track -> Now Playing, idle -> the menu), the position shown is the interpolated one.

### W3 - Tests and proof
- Unit (jsdom, executing the real controller with injected env; each mutated red, recorded): every `resumeDecision` arm
  (playing + 3 h -> attach; paused + 20 min -> attach; paused + 61 min -> drop; idle + 2 h -> drop; not listed -> drop; other
  user -> drop and deleted; malformed JSON / wrong shape / `v` 2 -> drop and deleted; fetch rejects -> keep, local); NOTHING is
  sent (zero `fetch` to `/api/remote/command`) during any launch, attach or drop; `isRemote()` is false until the check passes;
  a desktop (no `is-phone`) never writes or reads the record; the sessionStorage path (minimize/reload) unchanged; `at` stamped
  on hide; R7's deletions each.
- Real browser (extend `speaker-proof.js` or a new `resume-proof.js`, JSON committed): two contexts as one user; phone picks the
  speaker, playing; phone context closed; a new phone page with the saved localStorage (Playwright `storageState`) and empty
  sessionStorage: attached, the mirror shows the speaker's song and a position within 2 s of the speaker's own `currentTime`,
  the toast, ZERO command POSTs, the speaker's `currentTime` keeps advancing (not restarted). Variants: speaker Remote control
  off -> local, no toast; speaker paused and the record's `at` set 61 min back -> local; playing and 3 h back -> attached; a
  SECOND user's phone carrying the first user's record -> local, record deleted, no command.

## 5. Acceptance

- **AC1** Fresh launch within R1 -> attached, song + position shown, toast, zero commands sent, the PC undisturbed.
- **AC2** Fresh launch outside R1 or speaker gone -> local, quietly; no toast, no command.
- **AC3** No command can be sent to the remembered device before the targets check confirms it (bound by a test that taps
  play during the PENDING window and asserts no POST).
- **AC4** Another account on the same phone never attaches to, or sends to, the first account's speaker.
- **AC5** Minimize/return, reload and desktop tabs behave exactly as v1.355.

## 6. Build log

Builder (Opus), 2026-10-02, worktree `.claude/worktrees/v1356`, branch `feat/v1.356-speaker-resume` on main d6abd4e3.
Commits: 078a410a (W1), 72816fd5 (W2), d090a6a1 (W3 tests + proof), 5b59e6d0 (W3 mutant-closing tests), then this log.

### W0 findings (measured; probe `b356-w0.js` in the session scratchpad, the real server, Chromium, iPhone 13 context)

1. **Today's failure, confirmed.** The phone picked the speaker (`RC.select`) and played song1 on it (speaker
   snapshot: `song1`, playing). Before the kill: `isRemote` true, `mms-on` true, `sessionStorage['ft-remote-controlling']`
   set, no remote key in localStorage. A NEW context with the same localStorage (Playwright `storageState`) and empty
   sessionStorage, opening `/music`: `isRemote` false, `label` "", `mms-on` false, the Now Playing panel hidden. It opens
   local.
2. **A cold launch plays nothing locally.** A fresh phone on `/music`: no `#media-player` element at all
   (`mediaSrc: "no-element"`), `player.currentId()` null, `mms-on` false. The PWA's own cold-start helper
   (`ft-last-session`, common.js) only restores the ROUTE; Jump back in needs a tap. So a reattach cannot leave two
   players sounding; the resume still calls `player.pause()` (the remoteChoose rule) for a tap made during the check.
3. **The signed-in user's id on the client:** `window.fetchCurrentUser()` (common.js, memoized per page load, the same
   `/api/auth/me` the shell already asks for) -> `me.user.id`, a NUMBER (measured `{"id":1,"type":"number"}`). The
   record stores it as a string; `/api/auth/me` failing (or no shared fetch) = "cannot tell" = stay local.

### What was built

- **W1 (public/js/remote.js, public/js/common.js).** `RESUME_KEY = 'ft-remote-resume'`, `{v:1, deviceId, label, user, at}`,
  phone only (`env.isPhone()` = `isPhoneDoc`), through a `safeLocalStorage` like the session one. Pure exported
  `validResume` + `resumeDecision(record, now, user, targets)`. Written on attach (`select`, and a per-tab `restore` the
  targets check confirmed), re-stamped on visibilitychange hidden and on pagehide while attached (bootWhenReady calls
  `control.pagehide()` beside the target's `/off`). `restore()` with no per-tab pick calls `resume()`: the record is read
  (bad JSON / shape / `v` != 1 deleted unread, no request), then the user (`currentUser()`): unknown -> keep; another
  user -> deleted, the targets check is never asked; then `GET /api/remote/targets` (a STRICT variant: a non-OK answer
  or a network error is "cannot tell", never "gone"). After each await: a pick made meanwhile (generation, `targetId`)
  wins, the record is re-read (forgotten or replaced = do nothing), and a page back in the background keeps it for the
  return. Attach = the same `attach()` a pick uses (stream, mirror, sessionStorage, record), after `player.pause()`, then
  the toast "Playing on <label>" with the LISTED label. Keep = local, quiet, one retry on the next visible. Forgotten on
  This device (`leave`), `lost()`, a failed R1, a user mismatch, a malformed record, and `accountSignOut`.
- **W2 (public/js/skin-surface.js, public/js/music.js).** One landing rule `landAfterPlayOn(landed)` used by the
  Speakers pick and by the new `engine.landPlayOn(hasTrack)`. The Music view consumes the controller's one-shot
  `consumeResume()` on every mirror change and once at mount (a resume that attached on Home lands when Music mounts):
  `remoteDocked = false`, `updateNowPlayingPanel()`, then `landPlayOn(r.hasTrack)` (`hasTrack` from the LISTED state,
  as `remoteChoose` reads it). The position shown is `RC.position()`, the interpolated one.
- **W3.** `test/unit/remote-resume.test.js` (25 tests), a landing test in `music-pocket-menus.test.js`, a wire lock in
  `music-remote-controller-wiring.test.js`, `tools/listen-control-proof/resume-proof.js` + `resume-proof-out.json`.

### Deviations (each stated)

1. **The local pause lives in remote.js, not music.js** (plan W2 put it in the view). A resume can attach on any shell
   (Home, Watch), where the Music view is not mounted; the controller pauses `FileTube.player` itself before attaching.
2. **skin-surface.js changed** (the plan named only music.js for W2): the engine had no outside door to its Speakers
   landing (`landOnMusic` / `showNowPlaying` are private). Added `landPlayOn` and moved the pick onto the same
   `landAfterPlayOn`, so pick and resume cannot drift.
3. **No time-only drop before the check.** W1's text says "older than R1 allows -> delete" before the fetch; R1 has no
   age that rules a record out on its own (a playing speaker attaches at any age), so the age is judged only against the
   listed state. A record stamped in the FUTURE (clock change, edited storage) fails the hour arm (a playing speaker
   still attaches).
4. **The user check runs BEFORE the targets request** (R6 says "deleted unread"): a mismatched record never causes a
   `/api/remote/targets` call (bound: AC4 test, `resume_targets_requests: 0` in the proof).
5. **Sign-out only, not login** (R7 lists sign-out). A different account logging in on the same phone is caught by the
   user check instead; the same account logging in again keeps its record.

### FINDING for the Architect (needs a ruling; not changed): the LISTED state can be stale

A speaker reports its state only while a controller is attached (`createTarget`: `if (!on || !attached) return;`), so
`GET /api/remote/targets` lists the last state reported while a phone was attached. Measured (proof rows below):
- `stale_*`: the phone left while the speaker played; the speaker was then paused AT THE PC; the listed state still
  read `{"state":"playing","ageMs":2823}`, so a record 3 h old ATTACHED (`stale_paused_3h_attached: true`); the mirror
  then showed `paused` from the speaker's fresh report. R1 says it should have stayed local.
- The reverse holds too (paused when the phone left, played at the PC later: listed `paused`, a record over an hour old
  is dropped though the speaker plays), and a speaker that turned Remote control off and on (or reloaded) lists `idle`
  until a controller attaches (`paused_20min`: listed idle, so the landing was the menu, `{"menuMode":true,"cursor":"Music"}`,
  though the speaker had a paused song; it attached by the hour arm).
- Dean's device steps (section 1) are unaffected: in steps 1-3 the speaker's state when the phone left is still its
  state at reopen. The gap is a state change made AT THE PC after the phone left.
- A fix needs the speaker to report while no phone is attached (a client change on the TARGET side: post on
  play/pause/track/ended even unattached, throttled; no server change), which changes what a desktop tab sends (AC5:
  "desktop tabs behave exactly as v1.355"). Not built; the Architect's call.

### Real-browser proof (`node tools/listen-control-proof/resume-proof.js`, raw: `tools/listen-control-proof/resume-proof-out.json`)

Real server, Chromium with `--autoplay-policy=no-user-gesture-required` for the speaker (1280x800, Remote control on via
`/music?remote=on`), the phone = Playwright's iPhone 13 (`is-phone`), a Click skin (ipod-2004) so the menu landing shows.
A killed app = a new context from `storageState` (localStorage kept, sessionStorage empty). Numbers copied from the file:

| Row | Result |
|---|---|
| setup: record after the pick | `{"v":1,...,"user":"1"}`; `at` vs the page close: 2 ms (stamped on pagehide/hide) |
| AC1 relaunch | per-tab pick at load `null`; attached in 311 ms; toasts `["Playing on Linux PC · Radish"]`; track "Proof Song 1", playing; Now Playing (`menuMode:false`) |
| AC1 position | speaker 4.3 s, phone 4.29 s, gap 0.01 s |
| AC1 PC undisturbed | speaker 3.08 s before -> 6.3 s two seconds after, same id `song1`, playing (`advanced_not_restarted: true`) |
| AC1 network | 0 command POSTs; 1 targets request, then the stream |
| relaunch on Home, then in-app nav to Music | attached on Home: true; iPod up on Music: true; Now Playing; 0 command POSTs |
| AC3 targets answer held | during: pending true, isRemote false, label "", mms-on false, no toast; play/toggle/next/prev returned `[false,false,false,false]`, seek and volume sent nothing; 0 command POSTs during, 0 after the release (attached) |
| AC3 note | the speaker's name DID show during the hold, in the v1.78 handoff card ("Listening on Linux PC · Radish ... Continue here", server presence of the same account), not from the record and not in the iPod (`ipodBadge: null`) |
| AC2 Remote control off | local, label "", no toast, record deleted, 0 command POSTs, 0 streams |
| AC2 paused + 61 min | local, no toast, record deleted, 0 command POSTs, 0 streams (the listed state here was idle, see the finding) |
| paused + 20 min | attached, `state: paused`, landing `{"menuMode":true,"cursor":"Music"}` (listed idle), 0 command POSTs, speaker still paused |
| playing + 3 h | attached, "Proof Song 1", toast, 0 command POSTs |
| AC4 | second account `otheruser` whose OWN speaker has the SAME device id (its targets list that id: true); carrying user 1's record: isRemote false, label "", record deleted, no toast, 0 command POSTs, 0 targets requests from the resume; user 1's speaker still playing song1 |
| idle speaker, record 5 min old | attached, `state: idle`, landing `{"menuMode":true,"cursor":"Music"}`, 0 command POSTs |
| page errors | `[]` |

### Mutants (sandbox: `git archive 5b59e6d0` under the session scratchpad, a pristine copy diffed after: identical)

Run: `node --test test/unit/remote-resume.test.js test/unit/music-pocket-menus.test.js test/unit/music-remote-controller-wiring.test.js test/unit/remote-controller.test.js` (93 tests).
The first pass (on d090a6a1, 90 tests) left M9, M11, M19 and M32 green; 5b59e6d0 added the tests that kill them.

| # | Mutant | Red (test names) |
|---|---|---|
| M1 | `record.user !== user` check deleted | resumeDecision: every arm; AC4: another account on this phone |
| M2 | the playing arm deleted | resumeDecision: every arm; AC1: a fresh launch...; AC3: during the check... |
| M3 | `age < 1 h` -> `<=` | resumeDecision: every arm |
| M4 | `age >= 0` dropped (future stamp trusted) | resumeDecision: every arm |
| M5 | not listed -> attach | resumeDecision: every arm; AC2: not listed (Remote control off, tab closed, asleep) |
| M6 | targets null -> drop | 7 tests incl. "a failed targets check stays local and quiet, keeps the record..." |
| M7 | unknown user not held as keep | resumeDecision: every arm |
| M8 | `r.v === 1` -> true | resumeDecision: a malformed record...; a malformed record is deleted without a single request |
| M9 | no re-read of the record after the await | a record REPLACED while the check was in flight ... is not acted on here |
| M10 | attaches while hidden | a check that answers while the app is back in the background... |
| M11 | no supersession check after the targets await | a pick of the SAME speaker during the check is the pick... |
| M12 | `select` does not bump the generation | none: MASKED (stale() also checks `targetId`, which a select sets; a leave bumps it itself) |
| M13 | leave/lost keep the record | a pick made during the check wins...; `at` is stamped...; R7: ... This device, lost(), a 410 |
| M14 | no stamp on hide | `at` is stamped on every hide and on pagehide... |
| M15 | no stamp on pagehide | `at` is stamped on every hide and on pagehide... |
| M16 | attach writes no record | 5 tests incl. AC1 and "the record carries the signed-in user..." |
| M17 | `restore()` never resumes | 11 tests (every launch test) |
| M18 | a desktop reads the record | AC5: a desktop (no is-phone) never writes or reads the record |
| M19 | a desktop writes the record | AC5: a desktop (no is-phone) never writes or reads the record |
| M20 | no toast | AC1: a fresh launch... |
| M21 | local player not paused | AC1: a fresh launch... |
| M22 | no landing handed to the view | AC1: a fresh launch...; AC1: a paused speaker inside the hour attaches; an idle one lands the menu |
| M23 | no same-user pre-check | AC4: another account on this phone: ... the targets check is never asked |
| M24 | a failed answer reads as `[]` | a failed targets check stays local and quiet... |
| M25 | no retry on the next foreground | AC4: the user that cannot be told...; a failed targets check...; a check that answers while... background |
| M26 | numeric user id not carried | 14 tests |
| M27 | sign-out keeps the record (common.js) | R7: sign-out forgets the remembered speaker (accountSignOut, executed) |
| M28 | engine `landPlayOn` ignores idle (skin-surface.js) | v1.356 W2: engine.landPlayOn(false)...; v1.356 W2: a resume on launch lands the Music view... |
| M29 | the view lands every resume on Now Playing (music.js) | v1.356 W2: a resume on launch lands the Music view... (a source lock); and the proof: `idle_screen` `{"menuMode":false,"cursor":null}` |
| M30 | `send()` without a target | with no target nothing is sent; AC3: during the check... |
| M31 | the mirror never lands a later resume (music.js) | v1.356 W2: a resume on launch lands the Music view... (a source lock); and the proof: `idle_screen` and `paused_20min` screen `{"menuMode":false,"cursor":null}` |
| M32 | bootWhenReady never calls `control.pagehide` | bootWhenReady wires the controller: pagehide stamps... |

### Suites and lints (at 5b59e6d0, the tree this log describes)

- Node 22.23.1, `npm test` (exit 0): `# tests 10779`, `# pass 10767`, `# fail 0`, `# cancelled 0`, `# skipped 12`, `# todo 0`.
- Node 24.20.0, `npm test` (exit 0): `ℹ tests 10779`, `ℹ pass 10767`, `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 12`, `ℹ todo 0`.
- `npm run lint`: `✖ 6 problems (0 errors, 6 warnings)` (the pre-existing no-unused-vars warnings; the new files lint clean).
- `npm run lint:ui`: `ui-lint: OK - the live debt equals docs/ui-exceptions.json` (TOTAL 3181, unchanged).
- `node scripts/overlay-containment-lint.js --enforce`: `overlay-containment: clean (0 violations)`.
- Em dashes added by the branch: 0 (`git diff d6abd4e3..HEAD | grep '^+' | grep -c` the em dash).
- Pre-commit hook (Node 22, unit): W1, W2 green; the first W3 attempt was REFUSED by one failure, verbatim:
  `test at test/unit/pocket-search.test.js:197:1` / `the wheel moves the marker along the strip (both ways, wrapping);
  center adds the letter under it` / `AssertionError [ERR_ASSERTION]: counter-clockwise comes back (got 38)`
  (`ℹ tests 8349`, `ℹ pass 8348`, `ℹ fail 1`, load average 5.45 / 8.23 / 6.54). The test sizes a wheel turn by gesture
  SPEED (its own comment); this branch does not touch the wheel. Standalone it passed 3 of 3 (34/34 each); after the load
  drained under 2.5 the same commit passed the hook (`ℹ tests 8349`, `ℹ pass 8349`, `ℹ fail 0`). Recorded as a
  load-sensitive test, not root-caused here.

### What headless cannot prove

- iOS kills: a swiped-away PWA may not fire pagehide or visibilitychange at all; then `at` is the last hide or the
  attach. iOS normally fires visibilitychange hidden on the app switcher, before the swipe (device check).
- The "Playing on" toast and the landing on a real iPhone home-screen app, and that a cold launch there plays nothing.
- The hour measured on a real clock (unit tests use an injected clock; the proof rewrites `at`).
- nginx / the poll fallback on resume (the stream opens through the same `attach()` as a pick; not re-measured).

## 7. Device checks owed (to DEVICE-CHECKS.md at release)

- v1.356.0 - Play on a speaker PC, swipe the app closed, reopen: it opens on the speaker, showing its song and place, with a
  "Playing on ..." toast; the PC kept playing undisturbed. Turn the PC's Remote control off, close and reopen the app: it opens on
  the phone, no message.

## 8. Gate record

(seats write their verdict lines here, bound to the sha they reviewed)

Gate: CHANGES r1 @53a36548 - security-brief
- Gap: no Bash in this seat, so `git diff` was not run; HEAD 53a36548 was confirmed from the branch ref file, and the
  changed code was read in place (remote.js controller + browserEnv + bootWhenReady, common.js fetchCurrentUser +
  accountSignOut, the music.js consumeResume hook, routes.js bucketing, the resume tests). Nothing was executed.
- WARNING S1 (traced in code, not run): sign-out while the phone is attached writes the record straight back, so R7's
  "sign-out forgets it" is false in exactly the case it is for. `accountSignOut` deletes `ft-remote-resume` and then
  sets `location.href = '/login'`. Nothing detaches the controller, so `targetId` is still set when the page unloads.
  The unload fires visibilitychange hidden (`visibility(true)` -> `writeResume()`) and pagehide (`control.pagehide()`
  -> `writeResume()`). `meUser` was memoized at attach, so `put` runs synchronously and `setItem` puts back
  `{deviceId, label, user: <A's id>, at}`. Result on a shared phone: A's speaker label and user id stay in localStorage
  after A signs out, and A's next sign-in auto-attaches. Not cross-account: B is dropped by the user check (no request),
  and the server buckets every route by req.user.id. Impact is low, but a stated security ruling is not upheld, and the
  R7 test (remote-resume.test.js "sign-out forgets...") runs with no attached controller, so it cannot see this.
  Fix: in accountSignOut, call `window.FileTube.remoteControl.leave()` (guarded) before the removals. leave() sends no
  POST, and it clears targetId so the unload writes nothing. Bind it with a test: attached controller, accountSignOut,
  then fire hide + pagehide, assert the record is null.
- Verified clean: (1) no command, poll, stream or label can come from the record before the check. `send`/`seek`/`volume`
  /`openStream`/`pollOnce` all require `targetId`, which a resume sets only in `attach(hit)` with `hit` taken from the
  server's own per-user list. The deviceId, label and state all come from the listed entry, and the toast uses the
  listed label; the record's label is never rendered. (2) user binding: /api/auth/me failing or slow = keep, no
  request. A mismatch = drop before any targets request. A planted record needs same-origin script, which already
  holds the session. A forged same-user record with a foreign deviceId is never listed, so it is dropped, and the
  server returns 410 anyway. Switching accounts without sign-out is a new page load, so the user is re-fetched; an old
  tab still holding A's id talks to the server as B and gets nothing of A's. (3) untrusted input: try/catch JSON.parse,
  shape checked before any field is read, deviceId limited to `^[A-Za-z0-9_-]{1,64}$` (no NUL, no separators), lengths
  capped, JSON.parse `__proto__` is an own key (no pollution), URL ids are encodeURIComponent'd. (4) nothing new on the
  wire: only the existing GET /api/remote/targets and /api/auth/me, both per-user. (5) see S1.
- NOTE: ids are numeric, which is fine. Even if a deleted user's id were reused, the record could only reach devices
  the server lists for the signed-in user.

Gate: CHANGES r1 @53a36548 - qa
- Instruments (sandbox `git archive 53a36548`, node_modules symlinked; verbatim): Node 22.23.1, 10 remote/skin files:
  `# tests 256`, `# pass 256`, `# fail 0`. remote-resume + music-pocket-menus + music-remote-controller-wiring +
  remote-controller: Node 22 `# tests 93` `# pass 93` `# fail 0`; Node 24.20.0 `ℹ tests 93` `ℹ pass 93` `ℹ fail 0`.
  remote-resume alone: `# tests 25` (matches section 6). The 4 accountSignOut test files: `# tests 44` `# pass 44`
  `# fail 0`. `npm run lint:ui`: `ui-lint: OK - the live debt equals docs/ui-exceptions.json` (TOTAL 3181).
  `node scripts/overlay-containment-lint.js --enforce`: `overlay-containment: clean (0 violations)`. eslint on the
  changed files: `✖ 6 problems (0 errors, 6 warnings)` (pre-existing common.js no-unused-vars). Em dashes added: 0.
  Proof JSON numbers vs the section 6 table: every row checked, all match.
- WARNING Q1 (= security-brief S1, VERIFIED in a real browser): sign-out while attached writes the record back.
  Probe (real server, iPhone 13 context): pick the speaker, `accountSignOut()`, land on `/login`; localStorage
  `ft-remote-resume` before `{"...","user":"1","at":1790968335010}`, after `{"...","user":"1","at":1790968335096}`
  (re-stamped by the unload's hide/pagehide -> writeResume, meUser memoized). R7 "sign-out" is false in the one case
  it exists for; A's next sign-in on that phone auto-attaches. The test "R7: sign-out forgets the remembered speaker"
  runs with no attached controller, so its title over-claims. Fix as S1 prescribes (detach the controller in
  accountSignOut before the removals, guarded), bound by a test with an ATTACHED controller + hide + pagehide.
- WARNING Q2 (VERIFIED, probe in the sandbox): the v1.348 D8 rule ("a device that is controlling another PC never
  shows the handoff card", common.js shouldShowHandoffCard) breaks in exactly AC1. On a resume launch the handoff
  poll runs at boot while the resume is PENDING (controllingRemote false), shows "Listening on <PC> ... Continue
  here", and nothing clears it on attach: measured on `/` and `/music`, `remote: true` AND the card up at 0.5 s, 3 s,
  10 s and 20 s after attach (it waits for the 30 s HANDOFF_POLL_MS). On Home it is tappable (elementFromPoint hits
  the link, mms-on false); the tap navigates to `/music?play=song1&listen=1` and does nothing (0 command POSTs, no
  local media element, the PC undisturbed: 9.23 s -> 14.24 s same song). So Dean's step 1 shows "Playing on Otter"
  AND "Listening on Otter - Continue here" with a dead button. Reveal/clear: the resume reveals remote mode but never
  clears the local-mode card. Fix: let the handoff module hide (or re-poll) when the controller attaches (e.g. an
  RC.onChange hook calling hide() when isRemote()), bound by a test that attaches with the card shown.
- WARNING Q3 (LESSONS 2: a survivor on correct code is a WARNING): three of my five mutants survived the 5 target
  files (remote-resume, music-pocket-menus, music-remote-controller-wiring, remote-controller, skin-surface; 164
  tests). Sandbox diffed pristine after. (A) drop `|| still.user !== rec.user` in the post-await re-read: 164 pass
  (a record replaced by another user's same-device record mid-check is acted on). (C) toast `label` -> `still.label`
  (the RECORD's label): 164 pass, so section 6's "the toast with the LISTED label" is unbound (fixtures use 'Desk'
  for both; give the listed entry a different label). (F) writeResume's `targetId !== id` guard removed: 164 pass
  (pick, then This device before /api/auth/me answers = a record of a speaker the user left; R7). Killed: (B) strict
  getTargets returning [] for a non-array 200 (red: "a failed targets check..."), (D) landResume without
  `remoteDocked = false` (red only by the source lock).
- SUGGESTION: the music.js landing (landResume) is bound by a source regex only (presence); the proof's
  idle_screen/paused_20min rows are the behavioural evidence. An executed test of the mount-time landing would close it.
- Security (standing brief): no new wire, no command before the check, ids validated and encodeURIComponent'd, the
  toast text is the server-listed label through ui.toast; no shell surface (the proof tool is dev-only). Q1 is the one
  exposure (a device label + numeric user id left in localStorage after sign-out).

Gate: CHANGES r1 @53a36548 - adversary
- Instruments (sandbox `git archive 53a36548` under the session scratchpad, node_modules symlinked, diffed against a
  pristine copy after every mutant and probe: identical). Node 22.23.1: the 4 plan files `# tests 93` `# pass 93`
  `# fail 0`; every remote/pocket/skin-surface/music-* unit file (65 files) `# tests 1181` `# pass 1181` `# fail 0`.
  eslint on the 4 changed sources + the new test + the proof tool: `0 errors, 6 warnings` (the pre-existing six).
  Em dashes added: 0. The proof JSON matches every section 6 row I spot-checked. 5b59e6d0..53a36548 is docs only.
- WARNING A1 (VERIFIED, real browser; = S1 / Q1): sign-out while attached writes the record straight back. Probe:
  iPhone 13 context picks the speaker, `accountSignOut()`, lands on /login: `ft-remote-resume` after sign-out =
  `{"...","user":"1","at":1790968197898}` (stamped after the logout POST, by the unload's hide/pagehide ->
  writeResume). The R7 unit test passes only because it runs with no attached controller (divergent fixture).
- WARNING A2 (VERIFIED, real browser, PRE-EXISTING since v1.348, same fix): the per-tab pick also survives
  sign-out. Same probe, then user 2 (`otheruser`) signs in in that tab and opens /music: the controller goes
  `false|` -> `true|Linux PC · Tiger` -> `false|`, and user 2 sees the toast `Lost Linux PC · Tiger` (user 1's
  speaker name; the server's per-user bucket refused it). Reproduced identically on base d6abd4e3. AC4 says
  "never attaches"; the diff's sign-out handling cleared one of the two sibling keys. FIX VERIFIED in the sandbox:
  one guarded `window.FileTube.remoteControl.leave()` at the top of accountSignOut's `done()` -> after sign-out
  record null AND per-tab pick null; user 2: states `["false|"]`, toasts `[]`, zero remote requests. Bind it with
  a test that signs out with an ATTACHED controller and then fires hide + pagehide. (Suggestion: login.js's
  catch-all could also drop `ft-remote-controlling`, for the session-expiry path that never runs accountSignOut.)
- WARNING A3 (VERIFIED, real browser; = Q2): the v1.78 handoff card survives the resume. The PC played 12 s, the
  phone closed, relaunch on `/`: 1 s after attach `remote: true, cardVisible: true, "Continue here"`; 8 s after,
  still both. (With only 3 s of PC play the card never showed: the presence needs a progress report.) The card is
  decided by the boot poll while the resume is PENDING and nothing hides it on attach; the next poll is 30 s
  later. So the brief's question is answered: it is in scope; Dean's step 1 shows it. Hide on attach.
- SUGGESTION A4 (binding; mutants against the 4 plan files, each restored): survivors on correct code:
  toast `label` -> `still.label`, and `attach(hit)` -> attach with the RECORD's label (the "LISTED label" claim is
  unbound: every fixture names record and listing 'Desk'); writeResume's `targetId !== id` guard dropped (R7: a
  This device made before /api/auth/me answers would leave a record); restore()'s new `writeResume()` dropped;
  the retry-once flag ignored. Equivalent / masked, no action: the first stale() check, `still.user` re-check,
  `resumeBusy` guard, the stale() guards inside keep/drop, the `Array.isArray` check, leave's resume resets, and
  M12 (confirmed masked: green). Builder mutants re-run, all red as tabled: M1, M3, M13, M17, M27, M30, M32.
- Verified clean: AC3 in a real browser with the targets answer held across an SPA nav Home -> /music (pending
  true, isRemote false, mms off during; after release Now Playing, one toast, 0 command POSTs); R1 boundaries,
  malformed records and AC5's desktop gate bound by unit tests that went red under mutation.
- NOTE: a song the user starts locally DURING the check is paused by the attach (deviation 1's remoteChoose rule).
  Rare (one targets round trip) but it is the phone overriding a fresh local tap; Dean's call, not a finding.
- R9 (stale listed state) is Dean's disclosed limit and not counted.
