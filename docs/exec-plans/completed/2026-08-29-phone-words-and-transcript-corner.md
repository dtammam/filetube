# Words on the phone row + Transcript as a card corner

Status: SHIPPED v1.203.0 (2026-08-29). Was: ACTIVE (started 2026-08-29).
Full gate (the card renderer every list uses is touched): two rounds, both
seats APPROVE; dual-Node 7756/0.

## Rulings (Dean, 2026-08-29 - all agreed)

1. **Words on the phone row:** the four PRIMARY buttons show their words at
   every width, in Dean's order **Queue, Like, Share, Transcript** (mid-wave
   ruling); "More" stays a
   glyph-only "..." (the five words are ~395px, four + a glyph ~333px: one
   row at 390 AND 375, wrapping only on 360px phones by the safety net).
   The stars return to their own line above. Desktop compact mode already
   shows words. Buttons never deform (v1.200 norm); measured before/after.
2. **Transcript as a card corner control:** joins the corner roster
   (download/delete/like/queue/share/reheat -> + transcript), pickable per
   corner in Settings like the others; the corner renders ONLY on cards
   whose item has captions (`hasSubtitles === true`), exactly as Share
   renders only with a `watchUrl`.
3. **Identical flow from a card:** the transcript machinery (fetch text +
   prompts; desktop modal with Copy / timestamps / Share-with-AI; phone
   picker Share / Copy / Share with AI) moves from watch.js into common.js
   as `openTranscriptFor({ id, title, signal })`; watch.js and the card
   both call it. No card-specific variant.

## Tasks

- T1 CSS: the label rules (768 block + the 639 container query) hide only
  `#more-actions-btn .btn-label`; locks updated (tiers, container-query,
  era-row); probe before (v1.202.0) / after at phones + desktop both modes.
- T2 shared transcript flow: `openTranscriptFor` in common.js (returns a
  dismiss; owns the loading guard per call); watch.js becomes a thin
  caller; existing watch tests must stay green unchanged.
- T3 card corner: CARD_CORNER_CONTROLS + 'transcript', renderer case
  (`card-transcript-btn`, `icon-transcript`, only with hasSubtitles), click
  delegation -> openTranscriptFor, editor label, CSS in the corner selector
  lists (+ mobile size pair), locks bumped deliberately (six -> seven).
  Tests: renderer (with/without captions; corner class), delegation opens
  the modal/picker from a card (jsdom index.html harness), editor option.

## Attack surfaces for the gate

- The move of the flow: every watch-page transcript test unchanged and
  green; the abort teardown now owned by the caller's signal; two rapid
  clicks (loading guard per call vs per view).
- Card: `hasSubtitles` reaches the card item (does the list API include
  it? bind); a card without captions never renders the corner; the
  delegation reads id + title from the item, never from the DOM text.
- CSS: no button deforms; the phone row measured at 390/375 (one row) and
  360 (wraps, by design); More is the only glyph-only button.
