---
plan: ipod-more
harness: v2 · lean
branch: feat/ipod-more-colors
anchor: spec
status: Shipped v1.346.0
next: gate (adversary floor + qa + security-brief; package.json forces the full gate)
gate: pending
---

# iPod colours batch 2: every remaining colourway, a Touch line, a Custom section

Dean (2026-09-29): "Can we add some more. We are missing quite a few of the 3G, 4G shuffles. Especially
the 4G." then "If it's cheap enough can we just do all of the colorways from all of the generations."
then "add a custom section. Custom iPods. And add a transparent one" (eoe.works clear iPods).

## 1. Acceptance

- **AC1** The registry has 129 skins: the 52 shipped + 76 nanochromatic.com cards + 1 Custom (Transparent).
  No id or label of a shipped skin is removed; a shipped label gains a year only when a new same-colour
  twin appears in its line and generation (Nano 7G Space Gray becomes "Space Gray (2013)").
- **AC2** Every new skin has one role-token CSS block, one blurb, one design-system pin, and its
  ui-exceptions entries (skin-art carve-out); `lint:ui` OK.
- **AC3** Extras > Skins and Settings list the lines Classic, Mini, Nano, Shuffle, Touch, Custom (then
  Cider, Nordic); Touch 1G-3G and 6G-7G read as spans; the Custom group is "Custom 5G (2005)".
- **AC4** Full suite green on Node 22.23.1 and 24.20.0.

## 2. Decisions (Architect; Dean redirects any)

- Classic cards dropped: exact duplicates of shipped skins (4G White = 1G-3G White; 5G U2 = Encore).
- Touch is a new line; its first and last groups span generations ("1G-3G", "6G-7G").
- "Light Green" (#89bb93) and "Teal" are invented names to disambiguate same-name cards.
- Wheel style is a heuristic: shuffle tonal, mini = Mini 1G Sky, Nano 6G dark, else dark when body
  luminance < 0.35, else white. Colours are the site's hex through the batch-1 formula, not photo-sampled.
- The six existing "a orange center" blurbs stay (Dean's earlier ruling); new blurbs use a/an correctly.
- Transparent is hand-authored (frosted grey-blue shell, a dark board and a silver battery shown through
  as radial layers, white wheel). One skin only; more tints are one line each in the CSS.
- The "Cider and Nordic never preview" pocket-skins-menu test now reaches Nordic (the wheel's acceleration
  cannot land on Cider from Classic deterministically with 9 rows); Cider and Nordic non-preview stays
  pinned by the static-levels test (`preview` false for both).

## 3. Payload

`payload/gen-more.py` (run once: `python3 docs/exec-plans/completed/2026-09-29-ipod-more/payload/gen-more.py 2026-09-29`),
`site-cards.json`, `batch2-table.md` (every id, label, hex, wheel style).

## Gate

Gate: APPROVED r1 @95ebd0ed — security-brief
Evidence: static registry data only; picker escapes label/blurb (escStickerHtml) and ids are static literals; no new network/auth/secret surface; lock shows only the 1.346.0 version fields; no node_modules/.env/credential files in tree (git diff not runnable: no Bash, reviewed by direct reads).

QA r1: AC1-AC3 verified (129 skins, unique ids/labels, 77 new each with one CSS block, blurb, pin, exceptions; labels match batch2-table.md; lint:ui OK; eslint 0 errors; 6 targeted test files 100/100). No security surface (static data). NOTE only: ROADMAP has a stray double blank line before v1.344.2; AC4 dual-Node full suite not re-run by QA.
Gate: APPROVED r1 @95ebd0ed — qa
Adversary r1: 100/100 targeted tests, lint:ui OK. Mutants in a /tmp sandbox all red (palette hex 1, transparent glow/board 1 each, GEN_SPAN 2, custom line 5, touch/custom year 2, blurb drop 1, mis-set year/gen 1 each, id rename 7, previewAll 1, css rename 4). NOTE: blurb TEXT is unbound (swap 'slate' blurb to 'red' stays green; only presence pinned); palette pins are CSS-generated, so only the pin binds design drift, not intent. Cider never-preview stays bound (preview:true mutant red). No sibling ignores touch/custom; ratchet: 936 new keys, 0 removed/changed, all skin-art. No labels collide.
Gate: APPROVED r1 @95ebd0ed — adversary

## Build record

Measured 2026-09-29 on `feat/ipod-more-colors`. Node 22.23.1 full `npm test`: 10362 pass, 0 fail (before the
release docs). `lint:ui` OK; eslint 0 errors. Settings grid captured from a seeded instance: 129 tiles.
