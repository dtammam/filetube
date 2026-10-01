---
plan: speaker-bookmark
harness: v2 · lean
branch: feat/v1.352-speaker-bookmark
anchor: spec
status: Building
next: gate r1 (W0-W3 built)
design: Rulings 2026-10-01 (Dean: R2 yes, R3 tooltip + README, R5 sliding renewal, L1-L3 in the same release; W0 from his autoplay report; R1, R4, W0 and the L defaults are architect defaults he did not overrule)
gate: FULL (adversary + qa + security-brief; forced by lib/auth/** via R2 and R5)
---

# Speaker bookmark, and bookmarkable links: a speaker machine that opens listening, a video at a time,
# app-icon shortcuts, and music links

Written 2026-10-01 by an Opus session at v1.351.0 (347a08b2). Seams were read on main, not assumed.

## 1. The outcome (what Dean will do on device)

A utility machine is wired to speakers. Dean opens a bookmark (or a kiosk launch) on it:
`https://filetube.tamm.am/music?remote=on`. The page lands on Music with **Remote control: On**,
and the address bar shows plain `/music`. On his phone he opens Speakers and the machine is listed.
He picks it and plays a song. If the browser refuses sound without a gesture, the phone says
"Click the PC's tab once to let it play"; one click anywhere on that tab and every play after that
works for the life of the tab. A kiosk launched with `--autoplay-policy=no-user-gesture-required`
needs no click at all.

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 2, 4, 5, 8, 10, 13**. Read this plan once
fully before editing. Order of work: W0, W1, W2, L1, L2, L3, W3 (W0 first: the speaker bookmark makes a never-clicked tab the normal case).

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node for the final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`; an empty grep is not green).

0.3 Worktree: `git -C /home/coder/projects/filetube worktree add .claude/worktrees/speaker-bookmark feat/v1.352-speaker-bookmark`
(the branch exists locally and carries this plan). Rebase onto `origin/main` first if main moved. In the
worktree: `ln -s /home/coder/projects/filetube/node_modules node_modules` before any commit/push,
`rm node_modules` after, never stage it.

0.4 Git rules: stage files BY NAME; `git commit -F <file>`; never `--no-verify`, never force-push, never
pipe a commit or push; verify with `git log` / `git ls-remote`.

0.5 Tests while building: the targeted files per wave (`test/unit/remote-target.test.js`,
`test/unit/auth-gate.test.js`, `test/unit/auth-crypto.test.js`, `test/integration/auth-flow.test.js`,
`test/integration/remote-api.test.js`, plus the new files each wave names). The full dual-Node suite
(`npm test`) once after L3 and once more only if a gate round changes code.

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it.

0.7 No em dashes in docs, comments or user-facing text. UI text uses the app's tokens and `ui.js`
primitives; `npm run lint:ui` must not grow; `node scripts/overlay-containment-lint.js --enforce` stays 0.

0.8 **Stop rules.** Stop and ask Dean (AskUserQuestion) if: (a) a seam in sections 4 or 10 does not exist
or behaves differently and the fix is not a like-for-like rename; (b) the router re-writes a stripped
parameter back and the strip cannot be moved to run last (section 4); (c) the session token has no
issue time and deriving one would log existing sessions out (Q7); (d) the L3 drills have no menu to hold
"Copy link"; (e) any step needs a new npm dependency (none is planned); (f) a gate seat asks for a scope
change; (g) the W0 falsifier contradicts the diagnosis (the log does not show the refusal). Never widen
scope: log extras in ROADMAP.md Planned.

## 2. Architect challenge, answers to Dean's questions, and his rulings

### Can the problem be made not worth solving?

Tried, and it does not fully go away:

- **Chrome's "Continue where you left off"** restores `sessionStorage` with restored tabs, so a speaker
  machine that is left open and only rebooted may already come back On. UNVERIFIED here (a claim about
  Chrome, not measured); it is a device check, not a design input. It does not cover a bookmark, a
  fresh kiosk launch, or a closed tab, which is the case Dean described.
- **Leave it as one click on the Music page.** The speaker machine has no one at it; walking over to
  click is the friction the request removes. Not dissolvable.

So the fix is real, and the smallest shape is the one Dean proposed: a query parameter that sets the
same per-tab flag a click sets. Everything else below is about keeping it that small.

### Q1. Scope: any shell page, or only /music? And login?

- **Read the parameter in `remote.js` boot (every in-app shell), not in `music.js`.** remote.js already
  owns the target and boots on every shell before any view mounts; putting it there means one reader,
  and `/music?remote=on`, `/?remote=on` and `/settings?remote=on` all work. The documented bookmark is
  `/music?remote=on`, because a play needs the Music view's handler (on another page the target
  navigates to /music first, `playRoute` 'navigate', 8 s timeout, which works but costs a page change).
- **Login: the parameter does NOT survive today.** Measured in code: the auth gate denies a page to a
  bare `/login` (`lib/auth/gate.js` `deny(req, res, '/login')`), with no `next`. `login.js` `safeNext()`
  can read `?next=`, but nothing on the server ever sends one, so after logging in the user lands on
  `/` and the parameter is gone. The session lasts 30 days (`SESSION_SECONDS_DEFAULT`), so on a speaker
  machine this bites about once a month, or after a password change (token version bump).
  See ruling **R2**.

### Q2. Persistence

**The bookmark is the persistence.** The parameter sets the existing per-tab flag
(`sessionStorage['ft-remote-target-on'] = '1'`), so a reload keeps it On, and a restart reopens the
bookmark, which turns it On again. Nothing new survives a browser restart on its own.

A per-browser saved setting (localStorage, or a Settings toggle) is **ruled out**, for a reason beyond
"accidental target": the device id is shared by every tab of a browser (D2 in the v1.348 plan), so a
browser-wide "always On" makes every tab it opens try to become the target, and each one REPLACES the
last ("Remote control moved to another tab" toasts on every new tab). The per-tab opt-in exists to
stop exactly that, and the URL keeps it per tab.

### Q3. Safety: could a link someone sends me turn my device into a target?

Yes, and that is acceptable, with one visible cue:

- The channel is bucketed by `req.user.id` (lib/remote/routes.js header). A link from anyone else only
  makes my device controllable **by my own account's devices**. It gives the sender nothing: they
  cannot see the target list or send commands without my session.
- A cross-site link is a top-level GET; the session cookie goes with it (SameSite=Lax) but the only
  effect is client-side: this tab opens its own SSE stream. No server state changes until the tab
  itself connects, same as a click.
- The real risk is mild surprise: I click such a link on my laptop and it quietly joins my Speakers
  list. **Cue:** when the parameter turns it on, toast "Remote control is on: your other devices can
  play music here". The existing Remote control button shows pressed, and the "Controlled by" pill
  appears the moment a phone attaches, with Stop.
- **No confirmation dialog.** It would defeat the whole point (nobody is at the speaker machine).
- Only the exact value `on` acts. `?remote=off` is not added (Off is one click, and no link should be
  able to stop a speaker that is playing).

### Q4. Browser autoplay

Confirmed in code, not new: after a remote `play`, the target waits 900 ms (`BLOCKED_CHECK_MS`) and
reports `blocked` when the player's `autoStartRefused()` is set (only on a `NotAllowedError`). The phone
renders the artist line as "Click the PC's tab once to let it play" (music.js `remoteSkinCtx`).

What the click does: it gives the tab sticky user activation; it does NOT itself start the song (the
refused-autostart flag only clears on the element's own `play`). The next play or play/pause from the
phone then succeeds. So the documented flow is: **click once anywhere on the speaker tab, then press
play on the phone.** W2 proves this end to end (the v1.348 plan's row f, "PC reloaded, no click", was
NOT run at that release, so this is new evidence, not a re-run).

Kiosk workarounds to document (README "Listen Control" + the phone's hint stays as is):
- Chrome/Chromium/Edge: `--autoplay-policy=no-user-gesture-required` (with `--kiosk <url>`), or the
  `AutoplayAllowlist` enterprise policy with the FileTube origin.
- Firefox: Site settings > Autoplay > Allow Audio and Video for the origin
  (or `media.autoplay.default = 0`).
- Safari: Settings for this website > Auto-Play > Allow All Auto-Play.

### Q5. Discoverability

The URL is the same for every device (`<origin>/music?remote=on`), so there is nothing per-device to
show. See ruling **R3**: architect recommendation is the cheapest honest surface, the Remote control
button's tooltip on the Music page gains "Bookmark /music?remote=on to open this way", plus the README.
A copy button in Settings > Account is the alternative.

### Q6. Alternatives ruled out

| Alternative | Why not |
|---|---|
| Saved per-device setting (localStorage) | Every tab of that browser fights for the target (replace storm); a machine becomes a target by accident. |
| Server-side "this device id is a speaker" flag | New persisted state, a migration-free but still new store, and a server that turns a tab on with no URL or click. More surface than the problem. |
| A dedicated `/speaker` page | A new shell route, its own allowlist and tests, and the same flag underneath. The parameter on `/music` is the same result for a few lines. |
| `?remote=on` read in music.js | Works only on /music and only after the view mounts; remote.js already owns the target and boots earlier. |

### Q7. Not logging in often on the speaker machine (Dean, mid-intake 2026-10-01)

Measured in code: a session is signed once at login with a FIXED 30-day life (`signSession`,
`SESSION_SECONDS_DEFAULT`) and is never renewed. A speaker machine that plays every day still gets
bounced to /login every 30 days. It also dies on a password change (token version bump), by design.

Options:

| Option | Verdict |
|---|---|
| **Sliding renewal:** the gate re-issues the cookie (same uid, same tv, fresh 30 days) on an authenticated request once the current one is past half its life (15+ days old). | **Recommended.** A speaker tab left open renews itself through its own state reports and polls; a machine opened at least once a month never logs in again. Every device benefits (the phone PWA too). Revocation is unchanged: disable, delete and token-version bump are still checked on every request. At most one Set-Cookie per 15 days per device. |
| A longer fixed TTL (env, e.g. 365 days) | Weakens every session to fix one machine; still expires on a schedule. |
| A separate speaker token / pairing code | A second credential type, its own storage, revocation and UI. The channel needs the SAME user as the phone anyway, so it buys nothing over a renewed session. |
| A dedicated "speaker" user account | Does not work: Listen Control only pairs devices of one user. |

The session token must carry its issue time for the half-life test. **Stop rule:** if the signed
payload has no issued-at field (only an expiry), derive it as `exp - SESSION_SECONDS_DEFAULT`; never
change the token format in a way that logs every existing session out.

### Rulings (Dean, 2026-10-01)

R2: **yes**, return to the page. R3: **tooltip + README**. R5: **renew at half life**. R1 and R4: the
architect defaults below, not overruled.


| # | Question | Ruling |
|---|---|---|
| R1 | Shape | `?remote=on`, read in remote.js boot on any shell page, stripped from the URL, sets the same per-tab flag, toasts once. |
| R2 | Login survival | **In scope (Dean):** the gate adds `?next=<original path+query>` when it bounces a page to /login, and `safeNext()` is hardened at the same time (see section 3, a live open redirect). |
| R3 | Discoverability | Tooltip line + README only (Dean). |
| R4 | Release | One branch, one gate, v1.352.0, now including L1-L3 (section 10). |
| R5 | Fewer logins | **Sliding renewal** (Q7, Dean): re-issue at half life on any authenticated request. |

## 3. Found during intake: a live open redirect in login.js (fix regardless of R2)

`public/js/login.js` `safeNext()` accepts `next` when `/^\/[^/]/` matches and it does not start with
`//`. Both checks pass for `/\evil.example` and for `/<TAB>/evil.example`. The URL parser treats `\`
as `/` in http(s) URLs and strips tabs/newlines, so both become `//evil.example`, a scheme-relative
URL to another host. `location.assign(safeNext())` runs after a successful login, so
`https://filetube.tamm.am/login?next=/%5Cevil.example` sends a user who logs in to another site
(phishing shape: a fake "session expired, log in again" page). This is reachable TODAY, independent of
the server never sending `next`, because login.js reads it straight from the address bar.
Reasoned from the URL spec, not yet measured in a browser: W1 measures it (red first) before fixing.

Fix: resolve with `new URL(next, location.origin)`, accept only when `.origin === location.origin`,
and return `pathname + search + hash` of the resolved URL.

## 4. The seams (read at v1.351.0; line numbers drift, names do not)

- `public/js/remote.js` `bootWhenReady(w, remote, control)`: today re-enables on `sessionStorage` '1'.
  The parameter read goes here, before that check. `remote.setOn(true)` already writes the flag.
- `public/js/music.js` `stripNowPlayingParam()`: the pattern to copy. It rewrites `history.state.url`
  too, because the SPA router (common.js `bootRouter`) records the entry's url in `history.state`.
  **Stop rule:** if bootRouter's initial `replaceState` runs AFTER remote.js boot and re-writes the
  URL from a value captured before the strip, the parameter comes back. W1 measures the order on a real
  page load before writing the strip, and strips in whichever place runs last.
- `lib/auth/gate.js` `deny(req, res, to)`: the only place a page is bounced to /login (R2).
- `public/js/login.js` `safeNext()` (section 3).
- Existing tests to extend, not duplicate: `test/unit/remote-target.test.js`,
  `test/unit/remote-shell-inclusion.test.js`, the gate tests under `test/unit/` (grep `createAuthGate`).

## 5. Waves (one branch, one gate, one release)

### W0 - Autoplay honesty: the phone and the PC say when a click is needed (Dean, 2026-10-01)

Dean's report (v1.348-v1.351, on device): "if I play on a machine that's remote sometimes I need to
interact with it once to get it to play. I can pick songs, see it on the machine... but it won't
literally play. But if I press play on the machine then the remote control from Speakers works."

**Diagnosis (read in code at v1.351.0; device evidence still owed, see the falsifier).**
- Cause, a platform rule: a browser refuses audible `play()` on a page the user has not clicked or
  tapped since it loaded (sticky user activation, per page load). The click on Remote control: On
  counts, but a reload or a restored tab keeps On (sessionStorage) and loses the activation. Chrome
  sometimes lets a site autoplay anyway on its Media Engagement score, which is why it is "sometimes":
  a machine that plays FileTube often may pass, a rarely used speaker machine will not. One press of
  play on the PC gives the page activation, and every play after that works. No page code can lift
  this; only a click, the kiosk flag or a per-site browser setting (Q4).
- Our part, why it LOOKS broken instead of saying so:
  1. **The 900 ms race.** After a remote `play`, remote.js `runPlay` checks `autoStartRefused()` once,
     900 ms later (`BLOCKED_CHECK_MS`). The player only calls `autoStart()` AFTER fetching the track's
     saved progress (player.js, the `resumeMode === 'music'` branch) and then `play()`. When that
     takes longer than 900 ms, the check reads false, the PC reports `paused`, and the phone shows a
     paused song with no hint. The refusal lands later and nobody tells the phone.
  2. **Play/pause, next and previous never report it.** `handleCommand` routes them to
     `pl.togglePlay()` / `next()` / `prev()`; `togglePlayPause` calls `mediaPlayer.play().catch(function () {})`,
     which swallows the refusal, and `blocked` is only ever set inside `runPlay`. Pressing play on the
     phone silently does nothing.
  3. **The PC shows nothing on desktop.** The "Tap to play" cue lives in skin-surface.js (phone skins).
- **Falsifier (gather before editing, LESSONS 1):** open the speaker tab with `?debugLifecycle=1`,
  reload it (On survives), play from the phone, and read the log. The diagnosis predicts
  `autostart:refused NotAllowedError · tap never`. If it shows `autostart:ok`, or no autostart line,
  while the PC stays silent, the diagnosis is WRONG: stop and ask Dean (stop rule g). Reproduce it in
  headless Chromium with `--autoplay-policy=user-gesture-required` too (W2 row c is the same setup).

**Fix.**
1. remote.js target: report `blocked` from the player's own `filetube:autostart` event (player.js
   `setAutoStartRefused` dispatches it) instead of the one-shot 900 ms timer: refused -> send state at
   once; cleared (the element's `play`) -> send state at once. Keep `BLOCKED_CHECK_MS` only if a test
   proves something still needs it; otherwise delete it (no inert sibling path).
2. player.js `togglePlayPause` (and the next/prev load path, which already goes through `autoStart`):
   a `NotAllowedError` from `play()` raises the same refused flag, so play/pause from the phone reports
   `blocked` too. Only on `NotAllowedError`, only while still paused (the v1.334 rule).
3. A new state field `needsClick` (boolean): the target sets it while On when
   `navigator.userActivation` exists and `hasBeenActive` is false. It goes in `buildStatePayload`, the
   POST `/api/remote/state` validation and `resolvedState` in lib/remote/routes.js (the field list
   there is explicit; a field not added there never reaches the phone). The target reports once on
   attach and again on its first `pointerdown`/`keydown`. A browser without `navigator.userActivation`
   reports false (never a false alarm).
4. Phone: when `needsClick` or `blocked`, the existing hint "Click the PC's tab once to let it play"
   shows (music.js `remoteSkinCtx`), now as soon as the speaker is picked, before any song, and on the
   Speakers row's detail line.
5. PC: while On and `needsClick`, the shell pill (remote.js `mountPill`, already in every shell) shows
   "Click anywhere so your phone can play music here", and hides on the first click. Reuse the pill;
   no new component.

Tests (binding, each mutated and watched red; record in section 7):
- Target: a fake player fires `filetube:autostart {refused:true}` 3 s after a play (past the old 900 ms):
  state `blocked` is posted. Mutant: remove the listener -> red.
- Toggle while refused: `play()` rejects NotAllowedError -> flag raised -> `blocked` posted. Mutant:
  restore the swallowing catch -> red.
- `needsClick`: userActivation.hasBeenActive false -> true in the payload; after a pointerdown -> false;
  no userActivation -> false. routes.js: the field survives POST -> GET targets -> stream `state`
  (test/integration/remote-api.test.js). Mutant: drop it from `resolvedState` -> red.
- Real browser (W2 row c extended): a reloaded On tab, no click: the phone context sees `needsClick`
  true before any play; after one CDP click, false; a phone play then plays.

### W1 - The parameter, the strip, the toast; safeNext hardened; the gate sends next

1. remote.js: a pure `wantsRemoteOn(search)` (exported) returns true only for `remote=on` exactly.
   Boot: if true, `remote.setOn(true)`, strip `remote` (keep every other param and `history.state`),
   toast once. A blocked `sessionStorage` still turns it on for the page (setOn already swallows it).
2. login.js `safeNext()` per section 3.
3. gate.js `deny`: for a page bounced to `/login` only (never `/welcome`, never an API 401), append
   `?next=` + `encodeURIComponent(req.originalUrl)`, capped (skip `next` if over 2048 chars).
4. gate.js: after a valid session passes the row re-check, if the token is 15+ days old, set a fresh
   cookie (same name, flags and Max-Age as login's `serializeCookie` call; same uid and tv). Never on a
   denied request, never on the API-token path.

Tests (each must go red when its line is mutated; record the mutant and the red in section 7):
- `wantsRemoteOn`: `?remote=on` true; `?remote=On`, `?remote=1`, `?remote=`, `?remote=off`, absent,
  `?x=remote=on` false.
- Boot with a fake window at `/music?remote=on&nowplaying=1`: setOn(true) called once, flag '1',
  replaceState URL `/music?nowplaying=1`, `history.state.url` rewritten, other state keys kept, one
  toast. Mutants: drop the read (red), drop the strip (red), drop the state.url rewrite (red).
- safeNext: `/music?remote=on` kept; `//evil`, `/\evil`, `/%09/evil` decoded, `https://evil`,
  `javascript:x` all return `/`. Measure `/\evil` red against the CURRENT code first.
- gate: logged-out `GET /music?remote=on` Accept html -> 302 `/login?next=%2Fmusic%3Fremote%3Don`;
  same with Accept json -> 401 JSON unchanged; zero users -> `/welcome` with no next.
- renewal, injected clock: token 14 days old -> no Set-Cookie; 16 days -> Set-Cookie whose token
  verifies with a 30-day life from now; a bumped tv or disabled user -> denied, no Set-Cookie; an
  expired token -> denied; an API (fetch/SSE) request renews too. Mutants: drop the age test (renews
  every request, red), drop the tv check on the renewed token (red).

### W2 - Reachability proof with the real shapes (headless Chromium, real server)

Not a mock: the real server, a real login, two browser contexts as the same user.
- a. Speaker context opens `/music?remote=on` fresh (no sessionStorage). Within 5 s the phone context's
  `GET /api/remote/targets` lists the speaker's device id. Speaker URL is `/music` (param gone).
  Speaker reloads: still listed (per-tab flag survives the reload, param not needed).
- b. Same with `/?remote=on` (another shell page) - listed; a phone play navigates it to /music and plays.
- c. Speaker launched with `--autoplay-policy=user-gesture-required`, no click: phone plays -> state
  `blocked`. Then one real CDP mouse click on the speaker page (Input.dispatchMouseEvent, not
  `el.click()`), phone sends toggle -> state `playing`. This is the "one click" documented.
- d. Speaker launched with `--autoplay-policy=no-user-gesture-required`: phone plays -> `playing`, no click.
- e. Logged-out speaker context opens `/music?remote=on` -> lands on login, logs in -> ends on
  `/music`, listed as a target.
- f. Real server with an injected clock (or a token signed 16 days back): the speaker tab's own
  state report / poll gets a Set-Cookie, and the browser's cookie jar shows the new expiry.
- g. A second tab of the speaker browser opens the bookmark: it becomes the target, the first tab
  toasts "moved to another tab" (the replace rule unchanged).
Record raw numbers and one line per row in section 7.

### W3 - Docs and release (runs AFTER L1-L3 in section 10)

README Listen Control section (bookmark, the one click, kiosk flags per browser), the Remote control button tooltip line (R3),
ROADMAP Shipped entry, `docs/releases.json` in user language,
DEVICE-CHECKS.md lines, LESSONS.md if the gate finds a new class. Release per docs/RELEASING.md.

## 6. The gate: FULL

Scrutiny table: `public/js/**` alone matches no baseline row (floor = adversary). Escalated (allowed,
never de-escalated) to **adversary + qa + security-brief**, because a URL now switches on a control
channel and the change hardens a redirect. R2 and R5 touch `lib/auth/**`, which FORCES the same full gate.

Briefs (LESSONS sections the diff touches: 2 test binding, 4 SPA shell, 8 platform facts, 10 security and access control):
- **Adversary:** prove the parameter is inert somewhere real (router re-writes the URL, boot order,
  the flag set but the stream never opened, a param on a non-/music page that never reaches play);
  mutate each binding test and watch it red; try to make a link turn on a target for ANOTHER user.
- **QA:** regressions in the existing remote/target suites and the router's history depth; the strip
  keeps other params; the toast fires once; dual-Node.
- **Security-brief:** the open-redirect fix (every bypass shape: backslash, tab/newline, encoded,
  `/%2F`, userinfo `/@`, protocol-relative); `next` cannot carry the redirect off-origin; the `next`
  cap; the cross-site link analysis in Q3 (SameSite, no server state change).

## 6a. Release (docs/RELEASING.md is the authority)

`npm version 1.352.0 --no-git-tag-version`; ROADMAP.md Shipped entry; `docs/releases.json` entry in pure
user language (e.g. "When a computer needs one click before it can play, your phone and the computer
now both say so. Open FileTube on a speaker computer from a bookmark and it is ready for your phone
to play music on. Sign-ins now stay active while you use them. Links can start a video at a time, open
an album, artist or playlist, or shuffle everything, and the installed app has shortcuts."); the
DEVICE-CHECKS.md lines from sections 8 and 10; README Listen Control + links sections; a LESSONS.md entry
only if the wave taught a reusable lesson. Move this plan with
`node scripts/plan-complete.js <this plan> "Shipped v1.352.0" --apply`. Protected-main PR flow; merge on
green unit CI (`ci (22)`, `ci (24)`, `audit`, `secret-scan`) plus the gate; Dean says merge; delete the
branch remote + local.

## 7. Evidence and gate verdicts (all waves, W and L)

Commits: W0 32e8f02d, W1 1d1cd8ef + 6153d42e, W2 6fac5c29, L1-L3 96453ed9, W3 docs (this commit). Numbers below are
copied from the instrument runs named; raw JSON for the browser rows is committed beside the proofs
(tools/listen-control-proof/speaker-proof-out.json, links-proof-out.json).

**W0 falsifier (headless Chromium, `--autoplay-policy=user-gesture-required`, `?debugLifecycle=1`).** A restored tab (the flag
pre-set, never clicked): the log read `autostart:refused NotAllowedError · tap never · page 3890ms`, so the diagnosis held (stop
rule g not triggered). Old code, `/api/progress` delayed 2 s: the phone saw `paused` with no hint, and a phone toggle reported
`paused` (the 900 ms race and the swallowed toggle, both measured). Fixed tree, same run: `blocked` in both. Two corrections to
the plan, both measured: (1) Chromium KEEPS the activation across a same-origin reload (`tap had` after click + reload), so the
failing case is a fresh or restored tab, not a reload (device check reworded); (2) Playwright's page.evaluate grants a user
gesture, so every speaker-side read goes through CDP `Runtime.evaluate {userGesture:false}` (LESSONS 2).

**Mutants (each in a /tmp `git archive` sandbox of the committed sha, the named test file run, restored after):**
- W0 @32e8f02d: 15/15 RED (autostart listener, blocked flag read, toggle NotAllowedError raise and its error-name filter,
  needsClick in the payload / needsClickNow / the activation clear / the activation listeners / the stale lower / the pill,
  routes resolvedState / POST / truthy coercion, the phone hint and the Speakers row).
- W1 @1d1cd8ef: 20/21 RED. Survivor: safeNext without its origin check; the fixtures had no off-origin URL with a path. New
  fixtures plus an invariant test then found a real hole in the plan's prescribed fix (`/.//evil` -> the path `//evil`), fixed in
  6153d42e; re-run @6153d42e 3/3 RED (origin check, re-resolve, the old prefix check).
- L1-L3 @96453ed9: 17/20 RED. Survivors: (a) the link branch moved before the play branches: equivalent, the precedence lives in
  musicLinkIntent (null whenever play= is present); a call-site count lock was added anyway; (b) the Copy link attribute
  unescaped: the link is URL-encoded except the `&`, now asserted as `&amp;`; (c) musicDrillLink without its separator check:
  MASKED by musicLinkName (redundant guards, LESSONS 2), documented, not faked.
- The typo'd shortcut URL (`/podcast`) reds both manifest tests (also run as a mutant above).

**W2 (tools/listen-control-proof/speaker-proof.js, real server, real login, two contexts as one user), all rows pass, 0 page errors:**
- a: `/music?remote=on` in a fresh tab: listed on the phone in 295 ms; URL `/music`, history.state.url `/music`, On, toast shown,
  `hasBeenActive` false; after a reload still On, still listed, URL `/music`.
- c (`user-gesture-required`, a fresh never-clicked tab): pill "Click anywhere so your phone can play music here"; the phone's
  targets list has `needsClick: true` before any song; play -> `blocked`, the speaker not playing; one CDP mouse click ->
  `needsClick: false`, the pill "Controlled by Linux PC · Robin"; the phone's play/pause -> `playing`, the speaker playing.
- d (`no-user-gesture-required`): a phone play -> `playing` with no click.
- b: `/?remote=on` (Home): URL `/`, listed; a phone play moved it to `/music` and played song3.
- e: logged out, the bookmark lands on `/login?next=%2Fmusic%3Fremote%3Don`; signing in ends on `/music`, On, listed. Through
  the real login page, `next=/%5Cevil.example`, `/%09/evil.example` and `/.//evil.example` all land on the same origin `/`.
- f: a cookie signed 16 days ago (jar expiry 14 days): the bookmark's first response (`/music`) renewed it once; jar expiry
  30 days after, token changed.
- g: a second tab opening the bookmark takes over; the first goes Off with "Remote control moved to another tab"; listed once.
- The first run of row e FAILED: `net::ERR_TOO_MANY_REDIRECTS` (the allowlist's traversal regex scanned the query, so
  `/login?next=%2F...` was not /login). Stop rule (a); Dean ruled "Path-only check" (2026-10-01); fixed in 6fac5c29.

**L (tools/listen-control-proof/links-proof.js, real server, seeded library), all rows pass, 0 page errors:**
- L1: saved position 300 s; `/watch.html?v=vid1&t=30` -> 30.4 s, no "Resumed at" toast, the URL keeps `t`; without `t` (300 s
  re-saved) -> 300.4 s; an in-app nav to `&t=1m30s` while it plays (adopt) -> 91.4 s. (The plan's `/watch?v=` 404s here.)
- L3: the album link opens "Proof Album" (3 rows) and plays nothing; `&mode=play` plays song1 (track 1); `&mode=shuffle` plays an
  album track; `?mode=shuffle` alone plays and a reload does not restart it; `mode` is gone from the URL and history.state.url
  every time; `?playlist=liked&mode=shuffle` with nothing liked toasts "Could not find Liked in your music"; after a like,
  `?playlist=liked&mode=play` plays song2; `?artist=Nobody%20Here` toasts "Could not find Nobody Here in your music";
  `play=song3` + an album link with a mode plays song3 (play wins); Copy link puts `<origin>/music?artist=Proof%20Band&album=Proof%20Album`
  on the clipboard with a "Link copied" toast.
- L2 platform truth, read at primary source (MDN browser-compat-data manifests/webapp/shortcuts.json): chrome 96, chrome_android
  84, safari 17.4, safari_ios false, firefox false. The README says so.

**Suites (`npm test`, after L3, before W3): Node 22.23.1: 10577 tests, 10565 pass, 0 fail, 12 skipped. Node 24.20.0: 10577 tests,
10565 pass, 0 fail, 12 skipped.** `npm run lint:ui` OK (live debt equals docs/ui-exceptions.json); overlay census 0.
Two older locks on the watch loads' exact data shape (watch-init-behavioral, watch-prev-next-flash) went red on startAt and were
updated with their intent unchanged (LESSONS 3).

**Dean's rulings during the build (2026-10-01):** the allowlist traversal check reads the path only; Copy link is a pill in the drill
row. Logged to ROADMAP Planned at his request: Speakers resume after the phone closes the app; a chaptered album on the PC keeps
the first chapter's name on the phone.

### Gate

## 8. Device checks Dean would owe (go into DEVICE-CHECKS.md, one line each, at release)

- [ ] v1.352.0 - Speaker tab On, then reload it and do not touch it. On the phone pick it in Speakers: it says to click the PC's tab once BEFORE you pick a song, and the PC shows "Click anywhere so your phone can play music here". Click once: both go away, and songs from the phone play.
- [ ] v1.352.0 - Same reloaded tab, no click, press play/pause on the phone: the phone shows the click hint instead of silently doing nothing.

- [ ] v1.352.0 - On the speaker machine, open the bookmark `/music?remote=on`: Remote control shows On, the address bar shows `/music`, and a toast says it is on.
- [ ] v1.352.0 - On the phone, Speakers lists the speaker machine; pick it, play a song: either it plays, or the phone says to click the PC's tab once; click once anywhere on it, press play on the phone, it plays.
- [ ] v1.352.0 - Reload the speaker tab: still On, still listed on the phone.
- [ ] v1.352.0 - Signed out on the speaker machine, open the bookmark, log in: you land on Music with Remote control On.
- [ ] v1.352.0 - (slow) Leave the speaker machine signed in; after 30+ days of normal use it is still signed in. (Nothing to do but notice if it ever asks for a login.)
- [ ] v1.352.0 - (Optional, kiosk) Launch Chrome with `--kiosk --autoplay-policy=no-user-gesture-required <bookmark>`: phone play plays with no click.
- [ ] v1.352.0 - (Optional) Chrome with "Continue where you left off": quit and reopen the browser on the speaker tab; note whether it comes back On by itself.

## 9. Out of scope (log, do not build)

- A device name in the URL (`&name=`): rename once in Settings > Account; the name lives in that
  browser's localStorage and survives.
- Starting a song on open (`&play=`): the autoplay rule makes it unreliable and it is a second
  control surface.
- `?remote=off`.

## 10. Bookmarkable links: L1-L3 (Dean, 2026-10-01: "I'd use 1, 2 and 3", built in sync with W1-W2)

Inventory at v1.351.0, already linkable (do NOT rebuild): `/watch?v=<id>` (+ `&list=liked`, `&ctx=`),
`/music?play=<trackId>` (+ `&listen=1`, `&ao=1`), `/music?nowplaying=1`, `/podcasts?play=<episodeId>`,
`/tv?show=<id>`, `/read?b=<bookId>`, Home filters (`/?search=`, `&root=`, `&liked`, `&watchlater`,
`&subs`, `&folder`, `&type`, `&browse=1`), Settings sections (`/setup#<section>`).

Order: W1, W2 (speaker), then L1, L2, L3, then W3 (docs + release). One branch, one gate.
No generic "view state in the URL" framework: each parameter below is read once, at view init, and
gets its own binding test and a real-browser reachability row.

### L1 - Start a library video at a time: `/watch?v=<id>&t=<time>`

- `t` accepts whole seconds (`90`) or the YouTube form (`1h2m3s`, `2m`, `45s`). A pure, exported
  `parseStartTime(str)` returns seconds or null (null for empty, negative, NaN, junk, over 24 h).
- It OVERRIDES the saved resume position for that load (player.js start decision: the
  `fetch('/api/progress/' + id)` branch calls `resolveResumeStart`; an explicit start wins over it and
  shows no "Resumed at" toast). Past the end -> start at 0 (never seek past duration). Seam: pass it
  through `player.load(id, data, opts)` data, the way `resumeMode` rides; check the ADOPT branch
  (`isAdoptLoad`: the same video already playing) seeks to `t` instead of ignoring it.
- The URL is left as is (YouTube keeps `t` too); a reload restarts at `t`, which is what a bookmark
  of a moment means.
- Not in scope: Share for a library video. `handleShareClick` only shares an external source link
  (`watchUrl`/`sourceShareUrl`); a library-only video has no FileTube link to share today. Log it.
- Tests: `parseStartTime` table; mutant: drop the override and the saved position wins (red); adopt
  branch seeks. W2-style row: real server, a video with saved progress at 300 s, open `&t=30` ->
  `currentTime` within 1 s of 30 after load; open without `t` -> resumes near 300.

### L2 - App-icon shortcuts in `public/manifest.webmanifest`

- Add `shortcuts`: **Music** (`/music`), **Now Playing** (`/music?nowplaying=1`), **Shuffle Songs**
  (`/music?mode=shuffle`, L3), **Podcasts** (`/podcasts`). Each with `name`, `short_name`, `url` and a
  96x96 PNG icon (generate from the existing icon set; sized PNGs, not the SVG).
- **Platform truth (state it in the README, do not oversell):** shortcuts show on Android (long-press
  the installed app) and on desktop Chrome/Edge installed apps (right-click the dock/taskbar icon).
  iOS Safari home-screen apps are believed NOT to support manifest `shortcuts`; Dean's iPhone will
  likely show nothing. Verify at primary source (WebKit feature status / MDN compat data) before
  writing the README line, and write what the source says.
- An installed app picks up a manifest change lazily (Chrome rechecks on its own schedule); a device
  check may need a reinstall.
- Tests: the manifest parses, every shortcut `url` is same-origin and root-relative, each `url` is a
  route the server serves (GET returns the shell, not a 404), each icon file exists with the stated
  size. Mutant: a typo'd url goes red.

### L3 - Music links: open or play an album, an artist, a playlist, or shuffle everything

Shape (read once in music.js init, beside the existing `play`/`nowplaying` reads):

| Link | Does |
|---|---|
| `/music?artist=<name>` | opens that artist's drill |
| `/music?artist=<name>&album=<title>` | opens that album's drill |
| `/music?playlist=liked` / `recent-played` / `recent-added` | opens that playlist's song list |
| add `&mode=play` | plays the list from its first song |
| add `&mode=shuffle` | plays the list shuffled |
| `/music?mode=shuffle` alone | Shuffle Songs: the whole library (`shuffleAllFromMenu`) |

- **Albums by artist + title, never the raw albumKey.** The key is `artist\x00album` (a NUL inside),
  which in a URL is `%00`: ugly, and NUL ids are a known trap (LESSONS 9). Build the key client-side
  from the two readable params, then resolve it against the library.
- Reuse, do not re-implement: the iPod menu's playlist sources (`n.type === 'playlist'` in music.js:
  liked, recent-played, the newest-100 list) and `shuffleAllFromMenu`'s `sort=random&seed=` call.
  Seam to verify: whether `/api/music?album=<key>&sort=random&seed=<s>` (and the artist/liked filters)
  honour `sort=random`. If yes, shuffle through the server like Shuffle Songs; if not, shuffle the
  fetched list client-side (Fisher-Yates) and say so in a comment.
- Play goes through the same `playFromMenu` path the iPod menu uses (the list becomes the queue, the
  browse view is redrawn from it: the v1.104/v1.207 wrong-track class).
- Not found (no such artist/album/playlist): toast "Could not find <name> in your music" and render
  Music normally. An unknown `playlist` or `mode` value is ignored.
- Strip `mode` after it acts (replaceState, the stripNowPlayingParam pattern including
  `history.state.url`), so a reload does not restart the playlist; keep `artist`/`album`/`playlist`
  (they describe what is on screen).
- Precedence: `play=<trackId>` wins over all of these (it is the older contract).
- Autoplay: `mode=play`/`shuffle` from a cold bookmark can be refused like any no-gesture start. On a
  phone skin the existing "Tap to play" cue (`autoStartRefused`, skin-surface.js) shows; on the desktop
  Music page there is no such cue today, the player sits paused on the first song and one press of
  play starts it. Do not build a desktop cue (log it if the gate asks). Combined with the speaker link
  (`/music?remote=on&playlist=liked&mode=shuffle`) it plays on the speaker machine itself.
- **Getting the link (architect default):** a "Copy link" item in the album and artist drill's menu
  and on the playlist list on the desktop Music page, building exactly the URLs above. The iPod skin
  menus get nothing new. If the drill has no menu to put it in, STOP and ask Dean rather than
  inventing a new control.
- Tests: a pure, exported `musicLinkIntent(search)` -> `{open, mode}` table (each row above, junk,
  precedence with `play`); a pure `musicLinkFor(intent)` that round-trips through `musicLinkIntent`;
  binding tests that the init calls them (mutant: delete the init call -> red); reachability rows in a
  real browser against a seeded library: album opens, `mode=play` plays track 1 of the album,
  `mode=shuffle` plays an album track, `?mode=shuffle` alone plays, the `mode` param is gone after.

### L gate notes

Same FULL gate as W1-W2 (one review of the whole branch). Brief additions: the Adversary attacks the
precedence (`play` + `album` + `mode`), the router re-writing a stripped `mode` back, the adopt branch
of L1, and a shortcut URL that 404s; QA checks nothing in the existing `?play`, `?nowplaying`,
`?listen` flows moved. Security-brief: names in params are only ever matched, never rendered as HTML
(the toast uses textContent).

### L device checks (into DEVICE-CHECKS.md at release, one line each)

- [ ] v1.352.0 - Open a library video with `&t=1m30s` added: it starts at 1:30 even if you had watched further before.
- [ ] v1.352.0 - On an Android phone or a desktop Chrome/Edge install: long-press (or right-click) the FileTube icon: Music, Now Playing, Shuffle Songs and Podcasts are listed and each opens the right place. (iPhone: per the README line.)
- [ ] v1.352.0 - On the desktop Music page, Copy link on an album, paste it in a new tab: the album opens; add `&mode=shuffle`: it plays the album shuffled.
- [ ] v1.352.0 - Bookmark `/music?playlist=liked&mode=shuffle`: your Liked songs play shuffled, and a reload does not restart them.
