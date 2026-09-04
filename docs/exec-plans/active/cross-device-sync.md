# Cross-device preference sync (v1.265)

Status: ACTIVE. Dean 2026-09-04: "pivot to the cross device sync." Intake settled
(his numbered replies): **scope (a) preference sync now, with (b) live playback
handoff as the acknowledged later direction** ("primarily a... with my real intent
at the end" - the design must not preclude a session-handoff channel, and doesn't:
see "What (b) adds later"); the synced-vs-local split as proposed; last-write-wins
per key with boot + tab-focus refresh, no live push; signed-out stays local-only.

## The framing (from intake)

Content state already syncs by construction - progress/resume/liked/watched/
subscriptions are server-side. The gap is the PREFERENCE layer: localStorage keys
that make his phone and desktop strangers about theme, era, skins, critters,
autoplay, sorts. This wave gives every SYNCED pref a per-user server home with
localStorage remaining the read path and offline cache.

## The synced allowlist (MACHINE-DERIVED; 21 keys after the QA round - 'theme'
REMOVED: it is a writer-less legacy read-fallback, and a key nothing writes can
never sync; per-key reader-file counts from `grep -rl` over public/js)

ft-era(3) · ft-mode(1) · ft-modern-mode(1) · ft-icons(2) ·
filetube_sort(3) · filetube_modern_sort(1) · filetube_modern_chip(1) ·
ft-star-ratings(2) · ft-ambient(1) · ft-ambient-intensity(1) ·
ft-critters:on/density/size/kiss/randomsound(2 each) ·
ft-music-skin(1) · ft-music-autoplay(1) ·
ft-home-feed(1) · ft-home-continue-listening(2) · ft-home-continue-podcasts(1) ·
ft-tv-continue-watching(2)

**Deliberately LOCAL (disclosed, per Dean's Q2 agreement):** ft-volume, ft-muted,
ft-rate, ft-loop, ft-theater, ft-music-theater, ft-music-pip, ft-podcast-theater,
ft-podcast-pip, ft-css-fullscreen, ft-audio-expanded, ft-tray-mode, ft-sticker,
ft-bottomnav (form-factor/ergonomics). **Excluded, not prefs:** ft-custom-logo
(server-owned global; the localStorage key is a flash-prevention cache),
ft-is-admin (session cache), ft-md:* (per-doc reading state - local in v1,
revisit on ask), ft-debug-* / ft-lifecycle-* (debug).

## Design

**Server (P1).**
- SCHEMA_VERSION 19 -> 20 (append-only migration): `user_prefs(user_id, key,
  value TEXT, updated_at INTEGER, PRIMARY KEY(user_id, key))`.
- `GET /api/prefs` (auth): `{prefs: {key: {value, updatedAt}}}` for the caller
  only. `POST /api/prefs` (auth): batch `[{key, value, updatedAt}]`; the SERVER
  enforces the allowlist (unknown keys rejected per-item, not whole-batch),
  a value cap (512 bytes - every real value is a short token), and LWW: an
  incoming updatedAt <= stored is dropped silently (the response reports
  applied/skipped per key so the client can reconcile).
- User deletion cascades user_prefs (like every user_* table).
- BACKUP: prefs ride each user's entry in `exportUsersForBackup()` /the restore
  import - NOT a new top-level namespace (matching progress/liked). **The
  data-loss axis: a restore from a pre-v1.265 bundle must not ERASE prefs the
  restoring instance already has for surviving users?** No - restore semantics
  here are wipe-and-repopulate for user state; a pre-v1.265 bundle legitimately
  restores to no-prefs (localStorage caches still repopulate the server on next
  write). Disclose in release notes; the gate's adversarial brief includes
  destroying prefs via backup/restore both directions.
- Access-control enumeration (the v1.80/81/97 class): both routes per-user only;
  no admin cross-user read exists (nothing to leak); the bundle already carries
  per-user state admin-only.

**Client (P2).** `public/js/prefs-sync.js`, loaded early on EVERY shell.
- ONE SEAM: patch `localStorage.setItem`/`removeItem` (try/catch-safe; falls back
  to no-op mirroring when Storage is unavailable). Allowlisted writes mirror to a
  debounced (1s) batch POST stamped with Date.now(). Stamps live in
  `ft-prefs-meta` (written via the RAW setter - the meta key itself must never
  recurse into the mirror).
  Rationale vs enumerating ~35 call sites: the repo's "seat that forgot to call
  the shared helper" class - a patch catches every FUTURE writer too.
- Boot: `GET /api/prefs`; for each key where server updatedAt > local stamp,
  raw-write value + stamp. v1 semantics are "applied by next render"; the live
  re-apply targets ft-era (data-theme) + ft-mode (data-mode) - the keys with
  real writers (QA W1 killed the original theme target as dead code in the
  wrong value space). QA-round mechanics, all gate-driven: EQUALITY SUPPRESSION
  at the seam (boot re-appliers re-persist unchanged values every load - an
  unsuppressed mirror turned LWW into last-BOOT-wins, the QA CRITICAL);
  flushes HOLD until the boot GET settles and applyServer drops boot-race
  losers (the legacy-seed race, QA W2 - residual architecture in tech-debt
  #203); un-acked batches restore into pending (QA S1); the server CLAMPS
  updatedAt to now+5min (QA W3: a wrong-clock device wedged keys FOREVER;
  now bounded at 5 minutes).
- `visibilitychange` (visible) -> refresh GET (the tab-focus leg of intake Q3).
- 401 -> dormant until next boot (signed-out local-only, intake Q4).
- SHELL PARITY (the v1.250 class): a DYNAMIC parity test enumerating
  public/*.html (12 at plan time; fail-safe floors) requiring the script tag.

**What (b) adds later (not built now, nothing here precludes it):** an ephemeral
per-user "session" channel (now-playing id + position + queue head) with push or
short-poll, plus a "continue here" affordance; it would NOT live in user_prefs
(prefs are durable taste; a session is ephemeral state). The boot/visibility
refresh seam built here is where its v0 polling would slot.

## Predictions (machine-verified per commit)

- Touched: server.js, lib/db/sqlite.js, lib/auth/* (userStore export/import),
  public/js/prefs-sync.js (new), the 12 shells (one script tag each),
  public/js/login.js? NO - untouched; tests.
- Frozen: player.js, music.js (readers unchanged - the seam is the patch),
  podcasts.js, skin-surface.js, all skin/css files. 0-diff.
- The 21-key allowlist appears ONCE server-side and ONCE client-side, both
  lock-tested against this plan's list (drift between the two = a silent
  never-syncs key).

## Tests (the gate's floor, not ceiling)

- Server: RBAC both routes (401 signed-out; user A cannot read/write B - the
  enumeration net), allowlist rejection per-item, value cap, LWW drop + report,
  cascade on user delete, backup round-trip (export -> wipe -> restore ->
  byte-equal prefs), pre-v1.265 bundle restore (no crash, no phantom prefs).
- Client (jsdom): the patch mirrors an allowlisted write and NOT a local key /
  the meta key; debounce batches; boot-apply server-newer wins and local-newer
  survives (BOTH axes); 401 dormancy; visibility refresh; Storage-throwing
  environments (private mode) leave the app functional.
- Parity: the dynamic shell test.
- Full gate (QA + adversarial; adversarial briefed to DESTROY prefs: restore
  paths, LWW races, the patch's recursion/loop axes, cross-user writes).

Gate: FULL. Release: v1.265.0.
