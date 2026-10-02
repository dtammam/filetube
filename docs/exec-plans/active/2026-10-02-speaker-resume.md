---
plan: speaker-resume
harness: v2 · lean
branch: feat/v1.356-speaker-resume
anchor: spec
status: Building
next: Step 0, then W0 (falsifiers), W1-W3; read the whole plan, every section
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

(empty)

## 7. Device checks owed (to DEVICE-CHECKS.md at release)

- v1.356.0 - Play on a speaker PC, swipe the app closed, reopen: it opens on the speaker, showing its song and place, with a
  "Playing on ..." toast; the PC kept playing undisturbed. Turn the PC's Remote control off, close and reopen the app: it opens on
  the phone, no message.

## 8. Gate record

(seats write their verdict lines here, bound to the sha they reviewed)
