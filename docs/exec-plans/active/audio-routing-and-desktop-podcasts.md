# Audio-routing consistency + the desktop podcast player (v1.251 wave)

Status: SHIPPED as v1.251.0 (2026-09-03; full gate SERIALIZED seats, 3 rounds, both APPROVE;
dual-Node 8194/8194; DEVICE-PENDING Dean's pass - the pinned-channel probe needs a scan to
have run first). Move to completed/ on Dean's device pass; LISTEN-MODE (locked intake in
completed/player-extras-and-unify.md) is next. Original intake below.
Intake LOCKED 2026-09-02, Dean "Agree" to both recommendations:
1. THE RULE: anything PURELY AUDIO (YouTube-audio / library audio, chaptered albums), tapped
   from ANY surface on desktop, opens in MUSIC; podcast episodes always open the podcast
   player; video stays video. Confirmed on-device bug: the pinned-left-sidebar channel view
   opens audio in the VIDEO player; "depending on where you route from, something purely
   audio does not load" as music.
2. DESKTOP PODCASTS get the full music-grade treatment: the shared expanded panel (metadata +
   up-next episode queue) + the THEATRE toggle + the desktop POP-OUT (the engine unification
   made it cheap). Mobile podcast skin already correct.
Then LISTEN-MODE begins (its locked intake is in completed/player-extras-and-unify.md, which
also carries the rest of the queue: chapter-rename + pop-out-Extras bundle, cross-device sync).

player.js stays BYTE-UNCHANGED (0-line diff verified every commit).

## Machine-derived recon (2026-09-02, at v1.250.0 / d66c98e8)

### The ONE decision today, and its coverage gap
`musicHrefForItem(item)` (main.js:837) is the whole client-side rule: type==='audio' + kind
absent-or-'media' -> `/music?play=<id|id::c0>&ao=1` (chaptered via chapters array OR
chapterCount >= 2), else null -> caller keeps its /watch href. Exactly THREE callers, all in
main.js: 253 (list row), 287 (home feed card), 2517 (grid/classic card via buildCardHtml).

UNCOVERED `/watch.html?v=` PRODUCERS (grep-derived; each is a candidate tap surface for the
rule, to be dispositioned in R1 - route, or document why not):
- history.js:85 - history rows (an audio item in history -> video player today).
- common.js:3565 - a row model (podcast branch exists; the media branch never consults the
  rule) - identify the surface (bell/notifications?) during R1.
- common.js:4115 - queue-chrome entry href: kind 'track' -> /music, kind 'media' -> /watch
  even when the media item is audio (v1.249's Extras queues audio as kind media, so playing
  it from the queue chrome opens the video player).
- watch.js:1669 (related cards), 1734 + 1845 (up-next-from-queue), 2675, 2968 - disposition
  each in R1 (a related-card tap on an audio item should follow the rule; the up-next
  IN-PLAYER advance is a player behavior, see out-of-scope).
OUT OF SCOPE (byte-frozen file): player.js:4617/4817/8082 - the player's OWN queue-advance /
mini-bar-return navigations keep current behavior; changing them is a future player.js wave
if Dean asks. music.js:2102 is the deliberate ao=1 miss-bounce (keep).

### The pinned-channel mechanism is NOT yet root-caused (diagnosis discipline)
Derivation kept passing: the pinned sidebar links to `/?root=<dir>` (common.js:~3400) ->
main.js's covered buildCardHtml (2517) -> the same /api/videos endpoint, whose mapper spreads
`...item` so `type` should be present. Two live hypotheses, each with a falsifying probe:
- H1 LEGACY DATA - CONFIRMED, SHIPPED (R1; amended per the QA gate, W2 - the record must
  match the shipped mechanism): old scans' db.metadata items lack a baked `type`, and the
  scan's reuse arms backfilled releaseDate/youtubeId but NEVER type - proven by CODE
  DERIVATION (the reuse-arm reading + the conditional serializer emission), which accounted
  for the symptom fully (older pinned-channel downloads misroute, the recent-item feed
  works), discharging H2 without a device probe. SHIPPED FIX: a SCHEMA-ONLY scan-time
  BACKFILL of the existing `type` field in BOTH reuse arms (NOT the originally-sketched
  serve-time derivation - the backfill uses the established releaseDate/youtubeId pattern,
  heals every read surface at once incl. the v1.242 Music projection, is presence-wins, and
  is hard-gated zero-spawn by scan-type-backfill.test.js). DEPLOYMENT NOTE (disclose in the
  release + Dean's probe list): the heal lands on the FIRST POST-DEPLOY SCAN - the pinned
  channel stays misrouted until it runs.
- H2 A DIFFERENT RENDER PATH: discarded - H1's mechanism fully explains the observation.

### Desktop podcasts today (the legacy panel)
podcasts.js:755 updateNowPlayingPanel: mobile -> the shared skin (correct); desktop -> a
hand-built mnp fragment (title + episode rows), no theatre, no pop-out. Music's desktop
treatment: buildNowPlayingPanelHtml (metadata + windowed queue), the theatre toggle
(#music-theater-btn + is-theater on the stage), the pop-out shell (music.js ~1030-1210:
open/mount/teardown/clock, Document-PiP + window fallback, the v1.235 gate history).

## Task commits
- R1 ROUTING: (a) the pinned repro (drive the REAL ?root= flow; prove H1/H2), fix the proven
  mechanism; (b) move the decision to common.js as THE exported rule (one authority; main.js
  re-exports for its tests), route every in-scope uncovered surface through it with a test
  per surface driving the REAL payload shape that surface receives (the anti-INERT lesson);
  (c) an ENUMERATION net: a test that greps the client js for `/watch.html?v=` producers and
  asserts each is either rule-routed or on the documented out-of-scope list - a new producer
  fails until dispositioned (the route-table-net discipline).
- R2 DESKTOP PODCAST PANEL: podcasts' desktop branch renders the SHARED panel treatment
  (metadata + up-next from `playable`) + the theatre toggle; shared code, never a copy
  (extract music's panel builder if needed). lint:css census 0.
- R3 POP-OUT SHELL: extract music.js's shell into shared code (the F-UNIFY disclosed
  deferral, now needed) and enable the podcast desktop pop-out (a second consumer at last);
  music behavior byte-identical (its 64-test integration suite green unchanged).
- R4: FULL gate (SERIALIZED seats, adversarial mutants in sandboxes), dual-Node sequential,
  release v1.251.0, branch hygiene, memory.

## Predictions (re-verified each commit)
- `git diff main -- public/js/player.js | wc -l` == 0 at every commit.
- No NEW stored per-item db.metadata field anywhere (H1's fix backfills the EXISTING `type`
  field via the established schema-only pattern - amended per the QA gate, W2).
- R3 leaves music-skin-integration (64) green with zero assertion edits (shell extraction is
  a move, not a behavior change); any needed edit is a disclosed finding.
