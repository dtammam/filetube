# Exec plan: media capability parity — a standardization audit suite

Status: ACTIVE (Dean sanity-checked the 55-cell matrix, 2026-09-12)
Owner: main session (lean mode)
Wave: feat/capability-parity-audit

## Dean's final rulings on the matrix (2026-09-12)

1. **Book share** = TODO, but NEXT wave (tracked in the registry, not built here).
2. **Podcast transcript** = TODO (FUTURE) - needs RSS `podcast:transcript` ingestion first; the T2
   podcast menu wires "transcript-if-present" harmlessly (inert until ingestion lands).
3. **Podcast like + played** = INCLUDE in the T2 podcast player menu (they already work in the
   list rows; add them to the player too).
4. **Book delete-in-reader** and **podcast move** = N/A confirmed (deletion/folders are
   library-management concerns; RSS episodes aren't folder-library files).

So T2's podcast player subset = Download, Share, Add-to-queue, Delete, Like, Played
(+ Transcript-if-present, inert today).

## Scope revision (Dean, 2026-09-12, mid-plan)

Two directives that reshape the wave:
1. **"I want EVERYTHING to be shareable."** Share is now a UNIVERSAL first-class capability - no
   `N/A` for share anywhere in the matrix. Every media type (video/tv/music/podcasts/books) must
   have a reachable Share. This means the current link-only share (shareExternalUrl ->
   navigator.share({url}), gated on `hasWatchUrl`) is insufficient for the actual intent ("send my
   friend the mp3") and for locally-scanned items with no external URL - see the SHARE MECHANISM
   decision below.
2. **"Prep everything we're doing now for now; expect literally every other shoe in the wave as
   soon as this merges."** So: THIS wave ships the audit suite + podcasts + universal Share; and
   the registry/census MUST enumerate EVERY remaining gap as an explicit `TODO(next-wave)` so the
   immediate follow-up wave has a MACHINE-DERIVED worklist of every other shoe. The census test's
   TODO set IS that worklist.

### This wave (feat/capability-parity-audit)
- T1: registry + census checker (declares ALL cells, every gap as TODO with a target).
- T2: podcast player actions (the subset above) + **make Share universal** (podcasts + books get
  Share this wave, video's conditional share reconsidered per the mechanism decision).

### The next wave (pre-declared, fired on merge): "every other shoe"
Every remaining `TODO` cell the registry lists - music list-row parity, podcast transcript (after
RSS `podcast:transcript` ingestion), any book/TV surface gaps - closed systematically, the census
test flipping each TODO->SUPPORTED as it lands.

## SHARE MECHANISM decision: A (file-share, link fallback) - LOCKED (Dean, 2026-09-12)

A new shared `shareMediaFile(id, title, kind)` helper (common.js): fetch the item's bytes from
its `?download=1` stream arm and hand the File to `navigator.share({ files })` (guarded by
`navigator.canShare({files})`); desktop/unsupported fallback = the existing copy-link / download.
Wired into EVERY media type's Share action (video/music/podcasts/books; TV via the video watch
page). This is what makes "everything shareable" real - the friend gets the actual mp3/mp4/pdf/epub.
Universal Share (all types) ships THIS wave.

### Options considered

"Everything shareable" + "send the mp3" implies sharing the FILE, not a link. Options:
- **A (recommended): file-share.** `navigator.share({ files: [<the downloaded media>] })` (Web
  Share API L2, iOS/Android) - fetch the item's bytes from its `?download=1` stream arm, hand the
  File to the OS share sheet. Desktop fallback: the existing download. Works for EVERY media type
  (mp3/mp4/pdf/epub) regardless of external source - the true "everything shareable". A new shared
  `shareMediaFile(id, title, kind)` helper in common.js, used by every view's Share action.
- **B: keep link-share**, just extend it everywhere (share a local server URL). Simpler but the
  URL is only reachable on the user's own network - does NOT satisfy "send my friend the mp3".
- **C: hybrid** - file-share where `navigator.canShare({files})`, else copy a link / download.

## Goal (Dean's framing + intake, locked)

We built shared COMPONENTS (the skin engine, the `createExtrasMenu` factory, tokens, viewports)
but no shared CONTRACT: every capability (download/share/…) is OPT-IN per view, so parity is
unenforced and divergence is silent — surfaced only when Dean hits a missing button (the podcast
"send a friend the mp3" case). Make parity **enforced-by-test**, in this repo's own idiom
(the `search-provider-census` / `KIND_TO_LIBRARY` pattern).

Intake (AskUserQuestion, 2026-09-12):
- **Audit first**, then fix: build the registry + census checker FIRST (enumerates EVERY gap
  across all media types), then close the gaps deliberately.
- **Podcasts get the applicable subset** in the player: Download, Share, Add-to-queue, Delete,
  Transcript-if-present. Move / Reheat / Like-as-library-write are genuine N/A for RSS episodes.

## Current-state matrix (MACHINE-DERIVED, 2026-09-12 audit — file:line evidence in the wave notes)

Surfaces: **L** list/row · **P** in-player (mobile skin extras / desktop actions menu / watch
action bar) · cond = server-flag-gated. Media authority = `KIND_TO_LIBRARY` (lib/auth/visibility.js):
`media→video, track→music, podcast→podcasts, book→books, tv→tv`.

| Capability | Video | TV/Shows | Music | Podcasts | Books |
|---|---|---|---|---|---|
| download | P (bar+overflow) | →Video watch | L + P (extras) | **L only** | P (reader) |
| share | P cond | →Video watch | P cond (extras) | **MISSING** | MISSING |
| add-to-queue | P | →Video watch | L + P | **L only** | N/A |
| delete | P | →Video watch | P cond (extras) | **L only** | N/A (reader) |
| move | P (overflow) | →Video watch | P cond (extras) | N/A (RSS) | N/A |
| transcript | P cond | →Video watch | P cond (extras) | N/A (no sidecar) | N/A |
| reheat | P cond | →Video watch | P cond (extras) | N/A (no ytdlp src) | N/A |
| like | P | →Video watch | L + P | L | P (reader) |
| watched/played | P (overflow) | →Video watch | P (extras) | L | P (reader) |
| listen / watch-back | LISTEN (bar) | →Video watch | watch-back cond | N/A (already audio) | LISTEN cond |
| unified player menu | YES (overflow) | →Video watch | YES (extras) | **NO** | NO (flat toolbar) |

**TV/Shows delegates entirely** to Video's watch page (no per-episode controls of its own) — a
DELEGATED state, not a per-capability gap.

### The gaps the audit found (the whole class, not just the one Dean hit)

1. **Podcast player has NO in-player actions** — download/queue/delete/like/played all exist as
   list-row controls but are unreachable once you're in the podcast player (`podcastEngineConfig`
   omits the `extras` hook, podcasts.js:220-221). Music, on the SAME shared engine, exposes the
   full set in-player. **Sharpest divergence; the root of Dean's friction.**
2. **Podcast Share = missing everywhere** (real only for pure-RSS episodes; external/ytdlp
   episodes carry `watchHref` and route to the watch page, which has Share).
3. **Music list-row omits delete/move/share/watched/transcript/reheat** — reachable only via the
   player extras. Podcasts are the mirror image (row-first). The two audio types have
   MIRROR-IMAGE surface coverage — the clearest evidence parity was never a contract.

## Design (repo-idiomatic: authority + registry + census checker)

Two authorities + one registry + one census test, modeled on `lib/search/registry.js` +
`test/unit/search-provider-census.test.js`:

1. **`lib/media/capabilities.js`** (new) — the declarative matrix. Two authority lists
   (`MEDIA_TYPES` keyed off `KIND_TO_LIBRARY`; `CAPABILITIES` = the 11 columns above) and a
   `MATRIX` declaring EVERY (media × capability) cell as one of:
   - `SUPPORTED` + `surfaces` + a stable `marker` (the action id / hook string the checker
     greps for — NOT a line number: `data-skin-x="download"`, `#download-media-btn`, the
     `extras` hook, etc. — matching the repo's source-lock idiom),
   - `NA` + a one-line `reason`,
   - `TODO` + the wave/trigger that will close it,
   - `DELEGATED` (TV → the video watch page).
   No cell may be left undeclared.

2. **`test/unit/media-capability-census.test.js`** (new) — the enforcement, modeled on
   search-provider-census:
   - **Completeness**: every `KIND_TO_LIBRARY` media type and every `CAPABILITIES` entry has a
     declared cell — a new media type or capability goes RED until declared (zero-code discovery).
   - **SUPPORTED ⇒ wired**: each SUPPORTED cell's `marker` must be found in the named view file
     (a removed capability = a RED regression; the source-lock).
   - **TODO is explicit**: TODO cells are the disclosed, committed gaps — the test asserts the
     TODO set equals a declared snapshot, so a NEW silent gap can't appear and a CLOSED gap
     (now wired) must be promoted to SUPPORTED. This is the tech-debt-tracker-as-a-test.
   - **DELEGATED** cells assert the delegation target exists.

## Task commits

- **T1 (Phase 1 — the audit suite)**: `lib/media/capabilities.js` (the matrix as it is TODAY,
  gaps marked TODO) + `media-capability-census.test.js`. Green = the matrix matches reality and
  every intended-parity gap is explicitly TODO. This is the deliverable Dean sanity-checks first.
- **T2 (podcast player actions)**: give `podcastEngineConfig` the shared `extras` hook with the
  applicable subset (Download, Share, Queue, Delete, Transcript-if-present). Flip those podcast
  cells TODO→SUPPORTED; the census test proves they're now wired. Podcast SHARE needs a small
  server/client piece (share the downloaded episode audio, mirroring music's share) — designed in
  T2's own notes.
- **T3+ (further gaps, Dean-prioritized)**: e.g. music list-row parity, books share — each flips
  a TODO cell and the census test enforces it. Scope per Dean after T1.
- **Final**: full `npm test` (dual-Node), ROADMAP + ledger, move plan to completed/.

## Machine-derived predictions (the checker re-verifies)

5 media types × 11 capabilities = 55 cells. TV contributes 10 DELEGATED (+ its own unified-menu
row). Initial split (from the audit): the census test will print exact SUPPORTED / NA / TODO /
DELEGATED counts on first green; T2 moves ~5 podcast cells TODO→SUPPORTED. Each task states its
expected cell-state delta; the test re-counts, so a miscount is a missed wire.

## Gate brief (full gate)

Not data-loss, but it touches podcast DELETE (a destructive action) when T2 adds it to the
player — so T2 gets the full gate with the adversarial seat briefed on the two-tap delete +
undo. For T1 (the checker), the adversarial focus is: does the census test actually BIND (mutate
a SUPPORTED marker → RED; add a fake capability → RED; flip a TODO to wired without promoting →
RED), or is it a vacuous green? Reachability of the podcast share (verify against the real
share/stream route, the v1.185 inert class).
