# Tokens Tier 4 - era-consistency design (exec plan draft)

STATUS: DESIGN ONLY. Tier 4 executes after Tier 3 Stop B closes, behind
per-era screenshots with per-surface approval. This plan exists now so
the Tier 4 targets are baselined in the SAME capture session as Tier 3
(one device sitting, no second baseline round).

## T4-1: ghost-red retirement - the 9 var(--accent, #cc0000) sites

Ruling (recorded in the v1.1 contract): NEVER define --accent /
--accent-color. End state = the 9 sites consume var(--yt-red) directly.
Expected delta, verified against the era blocks (style.css):
--yt-red is #cc0000 in :root/2005/2009/2021 and **#e62117 in 2014
(both modes - dark inherits)**. Therefore the migration is ZERO-delta
in every era except 2014, where the 9 surfaces shift #cc0000 -> #e62117
- the deliberate era-consistency repair (the current split IS the bug).
Witness scenes: 23-ghost-red-books, 23b-ghost-red-reloc,
23c-ghost-red-stats (all 2014 light) + the P1 2021 set proving
zero-delta elsewhere. Site enumeration: the TIER4-GHOST-RED rows of
the Step 3 ledger (8 CSS + public/js/stats.js). Coverage check against
scenes lives in the scene-coverage section below.

## T4-2: monospace -> var(--mono-font) (.chapters-editor-textarea)

Ruling: TAKEN. --mono-font is "Courier New", monospace in 2005/2009
and plain monospace in :root/2014/2021, so the delta is confined to
2005/2009 (both modes): the chapters editor textarea moves from the
browser's default mono face to Courier New - joining the eras' defined
type instead of ignoring it. Witness: scene 22-chapters-editor
(2005 light + 2009 light).

## T4-3: z re-ladder (R11)

Gated on docs/references/z-ladder-coopen-enumeration.md (complete; no
pair renders differently in any reachable state). The re-ladder adopts
the --z-* names and removes two DOM-order-dependent ties
(notif/sub-sheet at 1600, reloc-preview/header at 1000). Deltas are in
RESOLVED VALUES (e.g. reloc-preview joins the modal band), not in any
photographable steady state - verification = differ enumeration
matching a dedicated ledger + the enumeration doc's pair matrix, plus
Dean's judgment on the two preserved deliberate inversions
(hard-delete above toast; audio-expanded below modals). No screenshot
delta expected in any single-surface scene.

## T4-4: radius - R7 raw sites only (SCOPE REDUCED by Dean's Q1 ruling)

All ten radius drift sites execute in Step 3 batch 3g per Dean's
ruling B (2026-07-30): the seven 6/8/14px sites adopt the existing
era-varying --radius-lg with per-era deltas enumerated, the 3px trio
goes 2/4 per-site. Nothing of the drift band remains here. What
remains Tier 4: the eleven era-varying R7 raw 4px sites (candidate: adopt var(--radius), which the 2005/2009 eras
override to 0/2 - surfaces get SQUARER in old eras, the classic
era-consistency repair) and the six geometry radii (never tokens).
Per-surface approval against scene 24-r7-radii + P1 shots, per
amendment (b).

## T4-5: UX questions riding along (Dean rulings wanted, no code)

1. Chip invisible behind the reloc-preview backdrop during a running
   preview (z-enumeration finding 3). Default: keep as-is.
2. Corner chip / reloc backdrop styling question deferred from Tier 3
   Stop A ("as surfaced").

## T4-6: phantom + dead fallback cleanup (NEW, from the ledger census)

- **--thumbnail-bg**: consumed at 6 sites via var(--thumbnail-bg, #222),
  defined NOWHERE - the same phantom class as --accent. **RULED
  (Dean, 2026-07-30): DEFINE IT** - a real semantic (media placeholder
  surface) with no era-value trap; #222 equals --overlay-surface only
  coincidentally. Defining at :root with the fallback's value is
  zero-delta by construction; executes in this tier.
- **13 dead var() fallbacks** on --border-color/--card-bg/--bg-color:
  those tokens ARE defined at :root and in every era block, so the
  literal fallbacks never paint (one is #1c1c22, matching no era value -
  proof). Zero-delta cleanup: normalize the fallback spellings away or
  leave annotated; ledger buckets DEAD-FALLBACK enumerate them.

## Scene-coverage audit (COMPLETE, from the Step 3 ledger census)

Ghost-red (9 sites): scene 23 covers the books fills/chips (6709, 6796,
6832), 23b the reloc preview trio (7210, 7252, 7253), 23c the stats
footer link (stats.js:347). GAPS closed/dispositioned: **23d-ghost-red-
reader added to scenes.js** (reader progress fill 6931 had no 2014
scene); .pinned-unpin-btn.armed (6742) is a transient armed state -
on-device judgment at the Tier 4 stop. Monospace: scene 22 covers both
Courier eras. Radius: scene 24 + P1 set. Z re-ladder: no photographable
steady-state delta (differ + pair matrix verify it). Step 3 gaps: scenes
25-login and 26-playlists-sheet added; remaining transient states are
enumerated as on-device judgment rows in the Step 3 ledger.
