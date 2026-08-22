# v1.167 - critters everywhere, popping out from behind buttons

Dean (2026-08-22, on-device with his 5 critters live): "it kinda looks like
randomly scattered behind certain things... what I was thinking was behind, like,
a subscription button... behind a comment... popping up behind the button in a
cute cartoonish way... I almost feel like wallpaper the way you do it... what you
did is great. And just more." Follow-up: "I kinda want them everywhere. Every
page would generally be fair game."

## Rulings (AskUserQuestion, 2026-08-22)
1. Pool = BUTTONS + comments + KEEP the big boxes, with buttons PRIORITY-WEIGHTED
   (ambush feel over wallpaper feel, without starving sparse pages).
2. SCALE-TO-ANCHOR: behind a small element the critter shrinks (~1.1-1.5x the
   anchor's height, floor 26px) so it reads as hiding behind it; big boxes keep
   the 44-88px band.
3. EVERY page fair game -> a per-view anchor sweep, MACHINE-DERIVED (each
   candidate's base CSS rule greped for a REAL background - the ground
   contract), never hand-aimed.

## The machine-derived pool delta (checker output, 2026-08-22)
ACCEPTED (base rule paints an opaque token):
- `.btn` (--btn-bg) - the buttons, weight 3 (priority)
- `.sub-row` (--bg-secondary) - subscriptions
- `.history-thumb` (--bg-secondary) - history rows
- `.book-row-cover` (--thumbnail-bg) - books shelf covers
- `.music-artist-mosaic` (--thumbnail-bg) - music
- `.podcast-card-art` (--thumbnail-bg) - podcasts
- `.comment-input-box` (--bg-color) - the comments area (Dean's ask)
REJECTED by the ground contract (transparent or paint-free; a critter "behind"
them would show through): music-album-card, music-artist-card, music-song-row,
podcast-card, book-row-card, book-card (media-query-only rule), history-row,
stable-row, comment-item.
FINDING folded in: `.music-artist-card` paints `background: transparent` -
which the v1.166.2 ground-contract LOCK would have false-passed (the .3 gate's
disclosed nit). The lock is TIGHTENED this wave: the background value must not
be `transparent`/`none`.

## Engine changes
- FIXED-POSITION SKIP: an anchor inside a `position: fixed` ancestor (header
  buttons, bottom-nav) has a viewport-anchored rect while critters live in
  document coordinates - they separate on scroll. collectCritterRects walks the
  ancestor chain and skips fixed subtrees.
- WEIGHTED sampling: anchors carry `weight` (buttons 3, everything else 1);
  planCritterScatter samples without replacement via the Efraimidis-Spirakis
  key (`rng()^(1/weight)`), pure and seed-testable.
- SCALE-TO-ANCHOR: anchor h <= 64 -> size = clamp(26, round(h * (1.1 +
  rng*0.4)), 88); larger anchors keep 44-88.
- Everything else (exclusions, peek geometry, bounds, retry ladder, tap paths)
  unchanged.

## Gate
SLIM (the seasoned adversarial seat) - additive engine evolution on the
device-passed base; no data surface. Dual-Node, then v1.167.0.
