# Tokens Tier 4 - era-consistency design + execution plan

STATUS: CLOSED (2026-07-31). Shipped as v1.59.0 (main 2b6da82, tag
pushed) after the full two-reviewer gate (both seats delta-APPROVE)
and sequential dual-Node 5321/5321 x2. **The Tier 4 Stop closed the
same day on Dean's on-device pass: "I've checked and everything just
seems beautiful" - ZERO rejections**, so all eleven R7 radius
adoptions stand per-surface approved (amendment b satisfied), and the
two preserved z inversions + the armed-unpin transient passed
on-device judgment. Per-site rejection flips were never needed and
remain trivially available (one line each) if anything surfaces later.
Intake rulings honored: code first, screenshots at the Stop, branch
flow, T4-5 both keep as-is. Residue after this tier: burn-down 54
(enumerated in the ledger), tech-debt #67/#68/#69; the linter ratchet
(tranche G, gated on #68) is the only remaining token tranche.

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

## EXECUTION (added at wave open, 2026-07-31)

### Batch order and per-commit protocol

Order: 4a (thumbnail-bg define + dead fallbacks, zero-delta) -> 4b
(ghost-red) -> 4c (monospace) -> 4d-pre (linter v6) -> 4d (z re-ladder)
-> 4e (R7 radii). One commit per batch. Every batch commit must show,
in this order:

1. `npm run ledger:check` CLEAN (its own rows struck, nothing else).
2. `scripts/css-equivalence-diff.js <main-at-branch-point style.css>
   <HEAD style.css>` - cumulative enumerated deltas = exactly the union
   of executed batches' ledger delta columns, all 9 contexts.
3. `npm run lint:css` total matches the ledger's prediction chain
   (110 -> 91 -> 82 -> 82 -> 82 -> 65 -> 54); the MEASURED number is
   authoritative and any mismatch stops the wave for re-derivation.
4. Full unit suite green (pre-commit hook enforces).

### 4d-pre: linter v6 (z-ladder-relative calc)

The z re-ladder's designed idiom (the :root comment, lines ~193-196)
derives backdrop/content rungs with calc(var(--z-X) +/- N). The v5
linter var-strips to `calc( + N)` and the /\d/ z-index pattern would
report a fully-tokenized site forever. v6: a z-index value matching
^calc\(\s*var\(--z-[\w-]+\)\s*[+-]\s*\d+\s*\)$ (var-resolved ladder
name, integer offset) is tokenized; anything else with a digit still
counts. Ships WITH fixture rows (positive + negative controls + a
mutation each) in the linter's fixture suite, as its own commit BEFORE
4d; count change at that commit: zero (no calc sites exist yet).

### 4d mapping (the whole batch, pinned)

| site | selector | before | after | resolved |
| ---- | -------- | ------ | ----- | -------- |
| 536 | header | 1000 | var(--z-header) | 1000 = |
| 1609 | #player-dock | 950 | var(--z-dock) | 950 = |
| 3185 | .modal-backdrop | 2000 | var(--z-modal) | 2000 = |
| 3270 | .toast | 2200 | var(--z-top) | 2200 = |
| 3305 | .oneoff-modal-backdrop | 2100 | calc(var(--z-modal) + 100) | 2100 = |
| 3869 | .bottom-nav | 900 | var(--z-nav) | 900 = |
| 3973 | .playlists-sheet-backdrop | 1500 | var(--z-sheet) | 1500 = |
| 3992 | .playlists-sheet | 1501 | calc(var(--z-sheet) + 1) | 1501 = |
| 5201 | #player-wrapper.css-fullscreen | 1500 | var(--z-sheet) | 1500 = |
| 5625 | .audio-expanded | 1100 | var(--z-player-max) | 1100 = |
| 5790 | .sub-sheet-backdrop | 1600 | calc(var(--z-panel) + 1) | MOVE 1601 |
| 6124 | .hard-delete-modal-backdrop | 2250 | calc(var(--z-top) + 1) | MOVE 2201 |
| 6257 | #dl-status-chip | 940 | var(--z-chip) | 940 = |
| 7011 | .reader-nowplaying | 940 | var(--z-chip) | 940 = |
| 7168 | .reloc-preview-backdrop | 1000 | calc(var(--z-modal) - 100) | MOVE 1900 |
| 8116 | .notif-panel | 1600 | var(--z-panel) | 1600 = |
| 8265 | .notif-panel-backdrop | 1599 | calc(var(--z-panel) - 1) | 1599 = |

(Line numbers = branch-point positions; they shift as batches land -
the ledger's file:line cells are re-verified by ledger-check, which
reads the LIVE tree.)

The three MOVES, re-derived against the pair matrix
(docs/references/z-ladder-coopen-enumeration.md):

- **sub-sheet 1600 -> 1601**: breaks the accidental notif-panel tie
  (impossible co-open pair - either order is behavior-identical);
  stays above the playlists sheet (1501, the site comment's documented
  ordering) and below modals/toast.
- **hard-delete 2250 -> 2201**: the enumeration's own prescription
  (calc(--z-top) + 1 keeps warning primacy). Still above toast 2200,
  oneoff 2100, modal 2000 - "NEVER hidden behind another dialog" holds.
  PRESERVED INVERSION #1 (above toast), documented at the site.
- **reloc-preview 1000 -> 1900**: joins the modal band per the
  enumeration ("tie eliminated, header cleanly under"), on its own rung
  BELOW the confirm modal (2000) so no new tie is created. Order
  changes vs sheets/panels (1500-1601) and audio-expanded (1100) are
  all impossible co-open pairs (reloc's full-cover backdrop blocks
  their openers and vice versa; none are async). Chip (940) stays
  under per Dean's T4-5 ruling; toast (2200) stays above.

PRESERVED INVERSION #2: audio-expanded (1100) below modals/toasts -
untouched by the mapping (value unchanged).

Differ expectation for 4d: the differ resolves var() but not calc()
arithmetic -> exactly 6 textual pairs x 9 contexts (the 6 calc sites);
3 of them value-preserving (2000+100=2100, 1500+1=1501, 1600-1=1599 -
arithmetic stated in the ledger, checked by eye and by the browser),
3 the deliberate MOVES. The 11 plain-var sites must resolve EQUIVALENT.

Comment prose: every edited z site's comment that cites a numeric rung
(dock "above 900 / below 2000+", toast "above 2100", oneoff "above
2000", sub-sheet "above 1501 / below 2200/2000+", hard-delete's 2250
block, css-fullscreen "above ~1000/900 below 2000", reader-nowplaying
"above 900 below 950") is rewritten in ladder names in the SAME commit
- stale z comments were exactly the misread that produced the 2250
scan error recorded in the enumeration doc.

### 4b note

public/js/stats.js:347 (cssText) is outside the differ (CSS-only
tool): bound by its ledger strike + linter drop + scene 23c witness.

### 4e per-surface list (Stop approval targets, amendment b)

cc-overlay-text 5493 (flag: cc-adjacent surface - radius only, the
amendment-c background is untouched), book-row-cover 6698,
book-cover-link 6777, music-sticky-thumb 7566, music-song-thumb 7648,
music-eq 7684, skel-title 7862, skel-w* 7872, watch-desc-skel skel-line
7920, notif-clear-btn 8147, notif-row-thumb 8220. Each gets a
per-site rejection flip (revert to 4px literal) if Dean rejects it
against the shots.

### Tier 4 Stop (the review packet, assembled at gate time)

Scene groups: 23/23b/23c/23d (2014 L, ghost-red) + P1 2021 zero-delta
set; 22 (2005/2009, monospace); 24 + P1 (radii, per-surface); no scene
for 4a (zero-delta x9 differ-certified) or 4d (differ + pair matrix;
Dean judges the two preserved inversions from the mapping table above).
On-device judgment rows: .pinned-unpin-btn.armed (transient, 2014),
the two preserved z inversions. Before-baseline: the v1.58.0 image +
pinned ops profile (ytdlp ON + FILETUBE_READONLY=1 + READ_ONLY_MEDIA=1,
pending-oneshots empty). Release: v1.59.0 ships after the gate with
the Stop disclosed as pending, per the wave->release->device-pass
standard.
