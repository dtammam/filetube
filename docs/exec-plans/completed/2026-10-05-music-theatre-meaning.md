---
plan: music-theatre-meaning
harness: v2 · lean
branch: feat/v1.363.2-music-theatre
anchor: spec
status: Shipped v1.363.2
next: shipped
design: Dean's screenshots 2026-10-05 after v1.363.1; ruled "Match watch" via AskUserQuestion.
gate: APPROVED
---

# v1.363.2: music and podcasts theatre means what it means on the watch page

## 1. The outcome
Theatre OFF (grey, default): the song list sits beside the player, like Related files on the watch page. Theatre ON (red): wide
player, the list below. Podcasts the same. A saved theatre ON now gives the wide layout.

## 2. Root cause
Not a colour bug (v1.363.1 W1 was right that the colours follow aria-pressed). v1.222 defined music theatre ON as the panel
beside the player, the inverse of watch (ON = wide, Related hidden). The class `is-theater` carried that meaning.

## 3. Design
Class `is-split` = panel beside the player = NOT theatre. Both views toggle it with `!on`; CSS rules renamed; no stored-key change.

## 6. Build log
Targeted: music-theater-toggle, podcast-nowplaying-view, music-nowplaying-view, music-ambient 86+ pass. Real-browser probe
(tools/theatre-proof/probe-theatre-colour.js, light/dark, 10 scenarios): OFF = split true, panel right of the player; ON = split
false, panel below; colours grey/red unchanged.

## Adversary gate r1
Measured in real Chromium (1600/1100/900, stored null/0/1): split class, panel beside player (OFF) / below (ON), aria-pressed and colour (grey/red) all correct; stage height unchanged with 40 queue rows (queue scrolls inside, cap = measured slot height). Mutants: inverting `!on` (music: 4 red, podcasts: 2 red) and renaming either CSS selector (2 red each) are killed. SURVIVORS: `if (isSplit)` -> `if (false)` / `if (!isSplit)` in music.js and podcasts.js stay green (the cap gate is regex-pinned only; pre-existing at base). NOTE: default (null/'0') class goes `music-stage` -> `music-stage is-split` at init (JS-applied); stored '1' never has is-split (no flash).
Gate: APPROVED r1 @b4864f554eea9b4c8d63ddc54a0ca73a582a0d65 — adversary
