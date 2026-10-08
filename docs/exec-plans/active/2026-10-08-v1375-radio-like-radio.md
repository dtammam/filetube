---
plan: v1375-radio-like-radio
harness: v2 · lean
branch: feat/v1.375.0-radio
anchor: outcome
status: Building
next: gate r2 (both seats re-confirm the r1 fix round); then Dean runs the trace on production (below) before his device check
design: Dean's rulings Q1-Q4 (2026-10-08), the diagnosis below (production traces, read-only). Base main de554c57 (rebased from fa4e01aa after v1.374.0 shipped).
gate: r1 CHANGES (qa W1 + S1-S4 @674cf4c1; adversary C1, W1-W3, S1 @674cf4c1) - fix round at 8805849f, 19f49a61, 4b18ffb5, then the Architect's pre-r2 adjustment at fbb9d2b8, 65daa3e2, 21e9c9d3; r2 pending
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

**Which ladder.** `stationPlan(profile, library)` returns a plan only for a GAME-MUSIC station: a seed with a GAME genre
(`GAME_GENRES`: gaming, video game, chiptune, vgm, game music...), or a seed with NO real genre (none, or a YouTube category on
yt-dlp audio) whose songs or series candidates are mostly game music (the game verdict below). Everything else - a real genre, a
genre station, and a junk-genre station that is NOT game music (a lofi channel, a vlog) - gets null and v1.368.0's T1-T7 exactly,
minus the session anchor. Gate r1 qa W1: the first build gave every junk-genre station the series ladder, and a lofi channel's
"Chillhop Radio - jazzy and lofi hip hop beats" found the series words "radio", "hip hop" and pulled Queen's "Radio Ga Ga", the
Buggles and "Hip Hop Classics" (qa: Queen 60 / Sugarhill 66 / Buggles 56 of 500 picks); series words are now a game-music notion
only. Deviation (stated): a native 'Video Game' album also takes the series ladder - a native Kirby OST should behave like a
yt-dlp Kirby set (Q4 one rule). A native 'Soundtrack' / 'OST' / 'Score' album keeps the v1.368.0 genre ladder (gate r1 qa S3):
those tags also cover film and TV scores, and a soundtrack station that stays in soundtrack (its genre tiers) is already right;
they are the game ladder's nearest genres (N) instead.
Also (Q4): an untagged ALBUM now borrows its artists' / folder's most common genre exactly as a song of it always did, and keeps
its YouTube category (T6) as a song of it always did (a lofi album widens to other "Music" uploads before the whole library), so
the album page Radio and a song's Start radio of the same album draw the same ladder.

**The series-first ladder** (tier numbers in the picker's trace; the simulator prints S / G / N):

| Tier | What | Notes |
|------|------|-------|
| S (8) | SERIES: game music, or a yt-dlp upload untagged or in YouTube "Music", sharing a series word of the seed | never a native real-genre song (gate r1, the Architect's ruling on adversary C1: rock, hip-hop, classical, latin or jazz never enters it, whatever words it shares), never a native untagged file, never a non-music category upload; the Architect's pre-r2 adjustment let the YouTube-"Music" uploads JOIN because Dean's Q1 names Soundzantium in the first stretch - the words are still LEARNED only from game-music titles, and a non-game channel's YouTube "Gaming" upload does not join (that is the W2 talk show / vlog; a game channel's Gaming upload is game music already); a word of the seed's album title (or one in 3+ and half of its songs' titles) counts alone; words of the seed SONG's title count only when 2+ are shared, a two-word name and its own words counting as ONE |
| 1 | the seed artist and the seed album's own songs | one slot per batch (a minority, Q2.3) |
| G (9) | GAME MUSIC | a native game genre tag ('video game', 'chiptune'...), or an upload of a GAME CHANNEL: a strict majority of its genre-tagged uploads game music, and 3 at least (untagged chapters ride on their channel; YouTube's 'Gaming' category counts only this way). Never an upload filed in a non-music category (People & Blogs, Comedy, Entertainment, News & Politics, Education, Howto & Style...): the podcasts and vlogs of gate r1 adversary W2 |
| N (10) | the NEAREST real genres | genres the family's artists also play (strength = artists), plus soundtrack / score / anime / orchestral / film (+1) |
| 7 | the rest | only when every closer tier is spent, or widen=1 (unchanged) |

No folder (T5) or category (T6) tier on this ladder (gate r1 qa S1 restated the reason): for game music the family IS the game
channels (G); a folder is only where files sit - a native file's folder is its parent directory (lib/music/scan.js), an album
folder on an Artist/Album layout but the whole library on a flat one (Prince included), and a yt-dlp folder is the channel, which
is already the seed artist or G. The seed album's own songs are recognised by album key alone (gate r1 qa S2).

**Series words.** Folded (accents, `'s`, punctuation off), minus English glue and a stoplist of style / format / mood /
platform / generic game words (lofi, remix, ost, music, chill, hours, happy, underrated, nintendo, super, world, land, man...),
plus two-word names (two adjacent words, at least one a content word: "mega man", "kirby super"). Only GAME-MUSIC titles are read,
and the counts are over them: a word QUALIFIES when it is in at most max(8, 25%) of the game-music titles and used by 2+ channels
(one channel's title template - Vapid's "2 Hours of Happy and Underrated <X> Music" - is no series); the strongest 8 by IDF are
kept. What the 2+ channel rule costs (adversary S2): a franchise only ONE channel holds is never a series word, so its station
plays that channel as the seed artist (one slot) and game music for the rest. Within S and within G each song weighs
1/sqrt(its channel's songs in that tier): a big channel still plays the most, a 1-2 song channel can never out-weigh it (the r1
"equal share per channel" let one stray track play early, adversary C1). Removed in the fix round as unbindable or unneeded
(adversary W3): the per-song series score, the artist-word drop, df >= 2.

**Cost (gate r1 adversary W1).** Pass 1 tallies every channel's genre tags; pass 2 reads only game-music titles, each folded and
split once, and looks its words (and a word + the next, after a word that starts a candidate pair) up among the seed's words: no
per-title regex. Three pure-function memos keyed by the raw STRING (a title's folded words, a genre tag's folded genre, and a
station's word list -> a title's mask, 8 stations kept), each bounded at 200,000 entries. They hold nothing library-derived and no
viewer's view: a lookup is only ever made with a string from the caller's own visible list, so the v1.368.0 "no shared cache"
invariant (a viewer's library never shapes another's station) holds.

**Game verdict.** The station is game music when its seed has a game genre, or at least half of its seed songs are game music, or
its series holds 10+ GAME-MUSIC songs from 2+ game channels (the joined YouTube-"Music" uploads do not count) (so a YouTube-"Music" Kirby set from a lofi channel is still a
game station). A junk-genre station that is none of these takes the genre ladder (gate r1 qa W1).

**Batch plan (5):** series, series, the seed artist, series, family. Each slot has an order (`STATION_ORDERS`): series slots
`S G 1 N 7`, the artist slot `1 S G N 7`, the family slot `G S 1 N 7`; a spent tier hands the slot on, so as the
series empties game music takes over, then the nearest genres, and the whole library only last. Within S and G, 1/sqrt(the
channel's songs in the tier) per song; within N, the genre's strength; likes x2 and the 24 h cool-down everywhere (R10).

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

## 5. Measured (fixture results, instruments, mutants; numbers copied from the runs named)

Gate r1 fix round plus the Architect's pre-r2 adjustment. Every instrument below ran on the committed tree 21e9c9d3 in a /tmp
git-archive sandbox (the scratchpad scripts named). The numbers of 674cf4c1 (cbde2741) and of 4b18ffb5 (394e2f44) are in git;
they are superseded.

**Fixture** (test/helpers/radio-kirby-library.js, 660 tracks; the yt-dlp sets through the real `expandAudioToTracks`; native files
in per-album folders, as lib/music/scan.js sets them). `v1375-measure.js`, 100 rng seeds per row, every row after the 24-play Pop
session (Prince x18, Tears for Fears x3, David Bowie x3):

    library 660 tracks; Pop session 24 plays
    seed / entry | first pick Kirby | batches <3 Kirby | Prince | Kirby picks by channel (batch 1, 100 draws)
    2 Hours of Happy and Underrated  / album | 100/100 | 0/100 | 0 | NESTALGIA 83, Soundzantium 64, heavymachinegun 55, PSK Beats n' Vibes 50, Jun Ishikawa 48
    2 Hours of Happy and Underrated  / song | 100/100 | 0/100 | 0 | NESTALGIA 83, Soundzantium 64, heavymachinegun 55, PSK Beats n' Vibes 50, Jun Ishikawa 48
    2 Hours of Happy and Underrated  / autoplay | 100/100 | 0/100 | 0 | NESTALGIA 83, Soundzantium 64, heavymachinegun 55, PSK Beats n' Vibes 50, Jun Ishikawa 48
    Kirby Lofi Mix ~ chill beats to  / album | 100/100 | 0/100 | 0 | NESTALGIA 62, Soundzantium 54, Vapid 53, heavymachinegun 51, Jun Ishikawa 47, PSK Beats n' Vibes 33
    Kirby Lofi Mix ~ chill beats to  / song | 100/100 | 0/100 | 0 | NESTALGIA 62, Soundzantium 54, Vapid 53, heavymachinegun 51, Jun Ishikawa 47, PSK Beats n' Vibes 33
    Kirby Lofi Mix ~ chill beats to  / autoplay | 100/100 | 0/100 | 0 | NESTALGIA 62, Soundzantium 54, Vapid 53, heavymachinegun 51, Jun Ishikawa 47, PSK Beats n' Vibes 33
    kirby lofi beats / album | 100/100 | 0/100 | 0 | NESTALGIA 84, Vapid 73, Jun Ishikawa 50, heavymachinegun 49, Soundzantium 44
    kirby lofi beats / song | 100/100 | 0/100 | 0 | NESTALGIA 84, Vapid 73, Jun Ishikawa 50, heavymachinegun 49, Soundzantium 44
    kirby lofi beats / autoplay | 100/100 | 0/100 | 0 | NESTALGIA 84, Vapid 73, Jun Ishikawa 50, heavymachinegun 49, Soundzantium 44
    Kirby Super Star Original Soundt / album | 100/100 | 0/100 | 0 | NESTALGIA 111, Vapid 105, heavymachinegun 68, Soundzantium 60, PSK Beats n' Vibes 56
    Kirby Super Star Original Soundt / song | 100/100 | 0/100 | 0 | NESTALGIA 111, Vapid 105, heavymachinegun 68, Soundzantium 60, PSK Beats n' Vibes 56
    Kirby Super Star Original Soundt / autoplay | 100/100 | 0/100 | 0 | NESTALGIA 111, Vapid 105, heavymachinegun 68, Soundzantium 60, PSK Beats n' Vibes 56
    Vapid album plan: terms kirby; game true; family 180; near [["electronic",1],["soundtrack",1]]; tier sizes {"1":30,"7":455,"8":45,"9":104,"10":14}
    20 sessions x 195 plays from the Vapid album (no Pop session): last series pick at play (median) 78; first nearest-genre (N) pick 177; first real-genre pick 177; first T7 pick 193; first Prince -1 (-1 = never); min first real genre 169

Soundzantium's and PSK's YouTube-"Music" Kirby sets are back in the first stretch (Dean's Q1). In the long sessions the series
lasts to play 78 (median), the first real genre comes at 177 (never before 169), the rest at 193, Prince never in 195 plays.

**Game-music family on production:** not measured here (no production data on this box). The trace prints it per album
("game-music family N tracks"); the Architect copies it from Dean's run.

**Cost** (`v1375-perf2.js`: three 24,420-track shapes built from the fixture - ASCII titles with 18 extra words, accented titles,
and seed chapters sharing 30 words with every title - the Vapid album seed, 25 requests each, base fa4e01aa vs 21e9c9d3, this box):

    ascii (24420 tracks): base median 46.5 p90 53.4 max 82.4 ms | head median 59.3 p90 76.6 max 200.4 ms
    accented (24420 tracks): base median 42.4 p90 57.6 max 87.0 ms | head median 50.7 p90 67.8 max 100.6 ms
    shared (24420 tracks): base median 42.8 p90 44.7 max 55.8 ms | head median 54.8 p90 59.1 max 144.9 ms

Against the +25% target, medians: ASCII 59.3 / 46.5 = +28%, accented 50.7 / 42.4 = +20%, shared 54.8 / 42.8 = +28%. The ASCII and
shared shapes miss the target by a few points (the pre-r2 join reads the non-game uploads' titles too; the box is noisy - the
same instrument on 4b18ffb5 gave +25% / +22% / +20% in one run, +36% ASCII in another). The max of each head row is the FIRST
request, which fills the memos (cold: 100-200 ms). The unit test "gate r1 adversary W1: a game station costs at most 2.5x a
real-genre..." binds a generous bound in the same run.

**Mutants** (`v1375-mutants3.js`, 37 mutants, one string replace each on lib/music/radio.js, the 9 radio test files, restored
byte-identical). On 19f49a61: 31 of 33 red (M8 was a weak mutant, rewritten; M22 -> 4b18ffb5 binds it). On fbb9d2b8 (the pre-r2
join, with M19 rewritten and M34-M37 added): M36 and M37 survived -> 65daa3e2 binds them; M19 reddened only the talk-show and
native-untagged tests because the C1 repros share words that never qualify -> 21e9c9d3 adds a real-genre song sharing the series
word itself. On 21e9c9d3: **37 of 37 red**:

| Mutant | Fail | Killed by (one of) |
|--------|------|--------------------|
| M1 restore the session anchor | 6 | e2e album page Radio, P10 inverted, Q3 never steers |
| M2 drop the series tier | 14 | all e2e, Q1 |
| M3 G before S / M4 N before G / M5 artist first | 13 / 12 / 14 | all e2e, Q1, Q4 |
| M6 no plan | 30 | most |
| M7 one channel makes a word | 6 | "a word only ONE channel uses..." |
| M8 no stoplist | 10 | "series words: a title template..." |
| M9 one song word enough / M10 a name and its words apart | 4 / 1 | "Ice Cream Parlor ... ONE shared match" |
| M11 flat S/G weight / M12 equal share per channel | 2 / 2 | W3 (U11) 1/sqrt, "weighed per channel by 1/sqrt" |
| M13 no series verdict / M14 no seed-song verdict / M26 song seed without member ids | 3 / 2 / 1 | PSK game music, W3 (U7, U13) |
| M15 half a majority / M16 no 3-upload minimum / M17 non-music admitted / M18 Gaming per upload | 1 each | W2 talk shows |
| M19 any non-game song may join | 3 | W2 talk shows, native untagged, "a native REAL-GENRE song never joins ... Kirby" |
| M34 no YouTube-"Music" allowance | 3 | Q1 (Soundzantium / PSK counts) |
| M35 a non-game channel's Gaming upload joins | 1 | W2 talk shows |
| M36 a native untagged file may join | 1 | "only a yt-dlp upload joins..." |
| M37 the verdict counts the joined uploads | 1 | "the game verdict counts the series' GAME songs only..." |
| M20 a non-game junk station gets the plan | 2 | qa W1 lofi radio |
| M21 no coverage / M22 no 3-title minimum | 1 / 1 | W3 (U5); Pokemon "Route" |
| M23 the df cap off | 1 | "a COMMON word ... love" |
| M24 likes / M25 the 24 h cool-down dropped | 1 / 1 | W3 (U4, U12) |
| M27 no accent fold | 1 | W3 (U6) |
| M28 the seed album's songs in S | 1 | "the series is OTHER sets" |
| M29 no album borrow / M30 no album category | 1 / 2 | "Q4 one rule...", qa W1 lofi radio |
| M31 no family slot / M32 no artist slot / M33 native game genre on the genre ladder | 3 / 4 / 2 | Q2 family slot, Q1 minority, Q1 OST rows |

The full output (every failing test name per mutant) is `v1375-mutants7.out` in the scratchpad.

**Open (disclosed):** a channel that files 3+ talk uploads under Gaming (and no other genre) is still a game channel - the tags
cannot tell it from a music channel; a YouTube-"Music" game-music channel (Soundzantium) is not GAME MUSIC (its uploads join the series by their words, but its
non-series sets are not in the game family G); the 2+ channel rule (above); the ASCII and shared cost shapes at about +28%
(target +25%) and the cold first request.
