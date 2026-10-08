---
plan: v1375-radio-like-radio
harness: v2 · lean
branch: feat/v1.375.0-radio
anchor: outcome
status: Building
next: the Architect's full dual-Node suite, then the gate (adversary floor + qa); then Dean runs the trace on production (below) before his device check
design: Dean's rulings Q1-Q4 (2026-10-08), the diagnosis below (production traces, read-only). Base main fa4e01aa.
gate: pending
---

# v1.375.0: Music radio that feels like RADIO

Dean (ROADMAP Planned > Features, 2026-10-07): a Kirby video game soundtrack album -> Radio played Prince. Read first:
docs/LESSONS.md 0, 1, 2, 5 (the v1.368.0 class "A server picker the client filters is only as good as what the client
TOLD it"), 12; the v1.368.0 plan docs/exec-plans/completed/2026-10-06-v1368-music-radio.md (R1-R16) and tracker #291.

## 1. Diagnosis (copied from Phase 2 step 0, production traces from Dean, 2026-10-08; tools/radio-sim --trace, read-only)

- Library: 23,852 tracks; genres: (none)[library-chapter] 5938, music[library-chapter] 3347, hip-hop[native] 2972,
  gaming[library-chapter] 2458, rock 1531, pop 1427 (native), ... video game[native] 156, chiptune[native] 20.
- Prince: 734 tracks, all native, genre "pop" -> 734 of the 1421 native pop tracks (52%).
- 17 albums with "Kirby" in the title, ALL yt-dlp library-chapter (DJ-set chapters): 13 NESTALGIA, 1 heavymachinegun,
  1 Vapid ("2 Hours of Happy and Underrated Kirby Music", 64 tracks, folder vapidVGM, genre Gaming), 1 Soundzantium (genre
  Music), 1 PSK Beats n' Vibes (25 tracks total for that artist).
- Every album profile: genre=null, category=null (YouTube categories are dropped on yt-dlp audio; album seeds never get a
  category). Seed artist sizes: NESTALGIA ~4280 tracks outside the album (every franchise: Mario, Zelda, Sonic, Mega Man, a
  podcast episode), heavymachinegun 1049, Soundzantium 829, Vapid 204-209, PSK 25.
- Empty-session replay (17 albums x {album page Radio, song Start radio, Autoplay after album} x 50 draws = 2550 batches):
  first pick T7 0, Prince 0, widen 0. Song/autoplay seeds of a 'gaming' chapter get T6 category = 713..3391 tracks from any
  game channel.
- Session replay ("D": album page Radio with exclude = Dean's 24 plays before he last played the album): 13 of 15 albums with
  history were re-genred by pickRadioBatch's anchor (`!profile.genre && !profile.category` -> most common genreKey of the last
  24 plays): hip hop, pop, alternative rock, thrash metal; non-T1 slots then drew Nas, Testament, Radiohead, "Reimagined AI"
  80s pop covers. The Kirby->Prince case: Vapid (last played 2026-10-08T00:04Z; the session before: Prince x3, Tears for
  Fears, David Bowie, The Shins) -> anchor "pop": T2 = 12 tracks, T3 = 1421 pop, of which Prince is 52%. T2 exhausts in ~4
  batches, then T3 -> Prince. (Inferred from tier sizes; the history keeps each item's LAST play only.)

Falsifier named before the edit: if the anchor were NOT the cause, an empty-session replay would also reach Prince. It did not
(Prince 0 of 2550 batches); the session replay did. So the cause is the session steering the station, plus a junk genre
leaving the station nothing of its own to stay close to.

## 2. Rulings (Dean, 2026-10-08)

| # | Question | Ruling |
|---|----------|--------|
| Q1 | A Kirby album's radio | Plays, first, the SAME GAME / SERIES from ANY artist (other Kirby from NESTALGIA, Vapid, Soundzantium, heavymachinegun...), mixed with a little of the album's artist; then other game soundtracks; only then wider. |
| Q2 | "Related" when the genre is junk | (1) SERIES WORDS in album/track titles, (2) GAME MUSIC AS A FAMILY (YouTube 'Gaming' uploads, native 'video game' / 'chiptune'...), (3) the channel / album artist as a MINORITY share. Not co-listening. |
| Q3 | The session anchor | REMOVED: a station is defined by its seed only; what was played before never steers it. |
| Q4 | When the related pool runs out | Widen GENTLY by family (other game music first, then the nearest real genres), never straight to the whole library; one rule for every entry point (album page Radio, a song's Start radio, the iPod's Start radio rows, Autoplay). |

## 3. Design as built (lib/music/radio.js)

**Q3.** The `if (!profile.genre && !profile.category)` block that borrowed the last 24 plays' genre is gone. The session's
plays still shape the exclusions and the artist spacing (v1.368.0's R11/R12), nothing else.

**Which ladder.** `stationPlan(profile, library)` returns a plan when the seed has NO real genre (none, or a YouTube category on
yt-dlp audio) or a GAME genre (`GAME_GENRES`: gaming, video game, chiptune, vgm, game music...), and is not a genre station;
otherwise null and the seed keeps v1.368.0's T1-T7 exactly (a native rock album is untouched). Deviation (stated): a native
'Video Game' album also takes the series ladder - a native Kirby OST should behave like a yt-dlp Kirby set (Q4 one rule).
Also (Q4): an untagged ALBUM now borrows its artists' / folder's most common genre exactly as a song of it always did, so the
album page Radio and a song's Start radio of the same album draw the same ladder.

**The series-first ladder** (tier numbers in the picker's trace; the simulator prints S / G / N):

| Tier | What | Notes |
|------|------|-------|
| S (8) | SERIES: shares a series word of the seed | words from the seed's album title (and any word in half its songs' titles) count alone; words from the seed SONG's title count only when 2+ are shared |
| 1 | the seed artist and the seed album's own songs | one slot per batch (a minority, Q2.3) |
| G (9) | GAME MUSIC (a game seed only) | a game genre tag, or a channel whose genre-tagged uploads are at least half game music (untagged chapters ride on their channel) |
| 5, 6 | the seed's folder, then its YouTube category | a NON-game junk seed's family (v1.368.0's T5/T6); never for game music - a native seed's folder is the whole native library |
| N (10) | the NEAREST real genres | genres the family's artists also play (strength = artists), plus soundtrack / score / anime / orchestral / film (+1) for game music |
| 7 | the rest | only when every closer tier is spent, or widen=1 (unchanged) |

**Series words.** Folded (accents, `'s`, punctuation off), minus English glue and a stoplist of style / format / mood /
platform / generic game words (lofi, remix, ost, music, chill, hours, happy, underrated, nintendo, super, world, land, man...),
plus two-word names (two adjacent words, at least one a content word: "mega man", "kirby super"). A word QUALIFIES when it is
in at least 2 distinct titles, at most max(8, 10%) of the library's titles, and used by 2+ channels (one channel's title
template - Vapid's "2 Hours of Happy and Underrated <X> Music" - is no series); the strongest 8 by IDF are kept. Words that are
the seed artist's own name are dropped (the artist has its own tier). Within S, each CHANNEL gets an equal share (so a channel
with 13 Kirby sets never drowns the others: Q1 "from ANY artist"), and a song sharing more words is up to 2x as likely.

**Game verdict.** The station is game music when its seed has a game genre, or most of its seed songs are game music, or most
of its series candidates are (so a YouTube-"Music" Kirby set from a lofi channel is still game music).

**Batch plan (5):** series, series, the seed artist, series, family. Each slot has an order (`STATION_ORDERS`): series slots
`S G 5 6 1 N 7`, the artist slot `1 S G 5 6 N 7`, the family slot `G 5 6 S 1 N 7`; a spent tier hands the slot on, so as the
series empties game music takes over, then the nearest genres, and the whole library only last. Within G, 1/sqrt(channel
size); within N, the genre's strength; likes x2 and the 24 h cool-down everywhere (R10).

**Kept invariants (v1.368.0):** exclude / queued split (queued never picked, not plays), no duplicate ids in a batch, the
widen=1 fallback, the seed never picked, artist spacing (a chapter is spaced by its SET) and its relax order, the recycle,
chapter exit (client, unchanged), the RBAC (the plan is computed from the visible list it is handed, per request, no shared
cache). The client (public/js/music.js) is unchanged: every entry point already sends its seed to the same route.

**The trace (tools/radio-sim/simulate.js --trace).** Applied the Phase 2 step 0 patch and extended it: per traced album and
per entry point it prints the ladder (SERIES / GENRE), whether it is game music, the series words with each word's title count,
channels and weight, the rejected candidate words, the family's size, the nearest genres, the tier sizes, the first pick's tier
over 50 draws, all picks by tier, series picks by channel, the "--why" artist's count, and a 10-batch session's tier path; the
D entry replays the session before the album and says the session no longer steers it. Command for Dean:

    node tools/radio-sim/bundle.js > radio-sim-bundle.js
    docker exec -i <container> node - --data /app/data --trace "kirby" < radio-sim-bundle.js

(also `--why "<artist>"` to count another artist, `--user <name>` for another user's history).

## 4. Acceptance

- Dean's device check: Kirby album -> Radio -> the same series / game music first, not Prince (also a song's Start radio, the
  iPod's Start radio row and Autoplay after the album).
- Before the device check, Dean runs the trace on production (command above) and the Architect copies its lines into this plan:
  the series words found for the Kirby albums, the family size, the tier sizes, the first-pick tiers.

## 5. Measured (fixture results, instruments, mutants)

Filled in below from the instruments (numbers copied, never typed).
