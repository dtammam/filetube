---
plan: music-stations
harness: v2 · full
branch: feat/v1.378.0-stations
anchor: outcome
status: Gate:CHANGES r1 @c42a52bc
next: gate round 2 at the fix sha (re-engage the same three seats); T0 (Dean's census) pending, folded in when it lands
design: Dean's intake 2026-10-09 (rulings R1-R4 below; the rest are kickoff defaults D1-D12, Dean may overrule at his device pass). Base main 13fa0c72.
builder: extreme (a schema migration plus new write routes: the full gate, data-carrier surface)
gate: CHANGES r1 @c42a52bc - adversary, qa (security-brief APPROVED r1 @c42a52bc); round 2 pending
---

# v1.378.0: Radio stations (Chill, Reggae, Synth, Favorites...), play counts, and Radio in Pocket

Version note: v1.378.0 is the number at kickoff. If another release (the Web Push per-user fix, the stuck-download fix)
merges first, take the next free minor at release time and rename the branch-facing text, not the plan file.

Norms: no em dashes in docs or user prose; stage files by name; `git commit -F <file>`; never pipe a commit or push; export the
fnm Node 22.23.1 PATH before any node/npm/git command; no toggle workarounds; never self-merge.

Read first: AGENTS.md, docs/LESSONS.md sections 0, 1, 2 (inert feature: drive the REAL `/api/music` shape), 5 (media
playback, queue and chapters; the v1.368.0 class "a server picker the client filters is only as good as what the client TOLD
it"), 10 (access control: new read AND write surfaces), 12 (inert sibling list), and the two radio plans:
docs/exec-plans/completed/2026-10-06-v1368-music-radio.md (R1-R16) and 2026-10-08-v1375-radio-like-radio.md (the ladder, the
series-word leak the gate caught: Linkin Park / Holst / Queen in a Kirby station). Trackers #291, #295.

## Step 0. Before anything (builder)

- Work ONLY in the worktree the launcher made: `.claude/worktrees/feat-v1.378.0-stations` on branch `feat/v1.378.0-stations`
  (this plan is committed there; `node_modules` is a symlink to the main checkout's, never stage it). Never touch the main
  checkout (the Root works there) or another worktree.
- Release in version order: if another release merged to main since base 13fa0c72, merge the updated origin/main into this
  branch before the release commit and re-run the full dual suites; if that release touched the same files, stop and ask.
- Before every node / npm / git command: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
  Dual-Node runs: 22.23.1 then 24.20.0, sequential (Node 24 prints `ℹ`, not `#`). Targeted tests while building; the full
  dual suite once before the gate and once at release.
- Git: stage by name, `git commit -F <file>`, verify with `git log -1` / `git ls-remote`; never `--no-verify`, never
  force-push. main is protected: the PR flow in docs/RELEASING.md and the memory notes.
- Stop and ask Dean (AskUserQuestion) when: a ruling contradicts the code or a measurement; T0 shows a station kind cannot
  be built honestly from his library; the gate reaches round 3; `gh pr merge` is refused by the classifier.

## 1. Outcome (Dean's words, 2026-10-09)

"I love [named stations, play counts, a radio row in Pocket and on the speaker]. And make the radio stations available in
Pocket and standard view. I'm thinking things like Chill, Reggae, Synth - maybe somewhat generated based on existing
library/titles etc. but am unsure. I want to leverage radio more."

So, the outcomes the device pass checks:

1. One tap to music that fits a mood or a kind, without picking a song first: a list of stations on the Music page (standard
   view, desktop and phone) and in Pocket (every skin), each one plays a radio that stays on its kind.
2. The list is mostly made for him from his own library (genre and style stations, plus Favorites, Deep cuts, Throwback,
   Recently added), and he can make his own and hide the ones he does not want.
3. FileTube counts plays, skips and finishes per user for music, and radio uses them (Favorites and Deep cuts need them;
   every station leans away from songs he skips).
4. Pocket has a Radio row and the speaker's now playing shows that a station is playing and which.

## 2. Rulings (Dean, 2026-10-09)

| # | Question | Ruling |
|---|---|---|
| R1 | How stations get made | **Generated + your own.** FileTube suggests stations from real genre tags plus NARROW title/album/channel words (lofi, synthwave, reggae...), only where enough songs exist. Dean can make his own (a name + genres / artists / words / years) and hide any suggestion. NO outside data (MusicBrainz / Last.fm stays ROADMAP Planned, item "Opt-in outside similar-artist data"). |
| R2 | Built-in stations | **All four:** Favorites, Deep cuts, Throwback, Recently added. |
| R3 | Release shape | **One release** (counts, stations, Pocket, speaker together). |
| R4 | Where | Stations in BOTH the standard Music page and Pocket; the radio row also on the speaker's now playing. |

## 3. Kickoff defaults (D1-D12: chosen by the kickoff; state each in the ledger; Dean overrules at the device pass)

- **D1 Count definitions (per user, per track id; a chapter track `<id>::c<n>` is its own track).** play = listened 30 s or
  half the track, whichever first, counted once per load; finish = reached the last 5% or `ended` (a chapter: its end
  boundary); skip = the user moved on (next, a tap on another song, a Pocket / remote Next) before the play threshold.
  Autoplay or a queue advancing at the end is never a skip. A seek is not a play. Counted where the audio PLAYS: a phone
  driving the PC speaker never double-counts; the speaker tab counts under ITS signed-in user.
- **D2 No backfill.** Counts start at zero on this release (honest; `user_music_progress` 248 rows is not a play history).
  Favorites falls back to likes, then to the most-resumed songs, until counts exist, and says so in its subtitle
  ("Builds as you listen").
- **D3 Radio uses the counts.** In `pickRadioBatch`: 2+ skips and no finish = weight 0.3x; 3+ skips = left out of a station
  unless the station would run dry; a finish = 1.2x. Likes keep 2x, played-in-24h keeps 0.25x.
- **D4 Station = a new seed kind**, `station:<key>`, through the SAME `GET /api/music/radio` route and `pickRadioBatch` (no
  second picker). The station's members are its T1 pool; when the pool is exhausted for the session it widens to the nearest
  real genres of its members (the v1.368.0 ladder), never to the whole library before those; a custom station with "stay
  strict" set never widens (it repeats rather than drifts).
- **D5 Generated genre / style stations.** (a) Real genre tags: native tags plus non-category tags (the v1.368.0 rule: YouTube
  category names are not genres), keys folded (`hip-hop` = `hip hop`), a station needs at least 40 songs from at least 3
  artists. (b) A small CURATED style dictionary, matched as whole words on genre, album, title and channel/folder name:
  lofi (lo-fi, lofi hip hop, chillhop), synthwave (synthwave, retrowave, outrun, darksynth), chill (chillout, chill, ambient,
  downtempo), reggae (reggae, dub, dancehall, ska), vaporwave, jazz, game music (reuse v1.375.0's game family, not new words).
  Same thresholds. No learned words (v1.375.0's leak). A song may sit in several stations. (c) At most 12 generated stations
  shown, biggest first; the rest under "More stations".
- **D6 Built-ins.** Favorites = liked songs plus songs with 3+ plays and a finish (D2 fallback). Deep cuts = songs by artists
  he plays (any plays) that he has played 0-1 times; empty until counts exist, then shown. Throwback = one station per decade
  with 40+ songs, from RELEASE-year tags only: a yt-dlp download's year is its UPLOAD year and never counts (native tags, or a
  saved album's own year if present). Recently added = the newest 200 songs by `addedAt`, newest first weight.
- **D7 Custom stations.** Per user, private. Fields: name (1-40 chars), any of: genres, artists, words (whole-word, same
  matcher as D5b), year range, exclude words; "stay strict" (D4). Preview shows the song count before saving; a station that
  matches nothing cannot be saved. Edit / delete / hide on the standard view; Pocket lists and plays them (no editing there).
- **D8 Hide.** Hiding a generated or built-in station is per user, undoable from "More stations" > Hidden.
- **D9 Visibility (LESSONS 10).** Every station, its count and its art are built from `visibleMusicList(req)` (the function
  `/api/music` uses): a restricted account never sees a station, a count or an art tile drawn from songs it cannot see, and a
  station empty for that viewer is not listed. Counts are per user and never readable by another user.
- **D10 Standard view.** A Stations shelf on the Music page above the albums: cards with the name, song count, a 2x2 art
  mosaic; tap = play. "+ New station" at the end; a card's menu: Edit / Delete (custom), Hide (others). Phone and desktop.
- **D11 Pocket.** A top-level "Radio" row on the iPod main menu (after Music) -> the same list as the shelf (same order, same
  hides) -> select plays. The Now Playing screen shows "Radio: <name>" under the title while a station plays, in every skin.
  When the phone drives a speaker, choosing a station starts it ON the speaker (the existing Play on... command path).
- **D12 Speaker now playing.** The speaker's own now-playing view shows "Radio: <name>" too; the station survives a resume
  and a dock return (the v1.368.0 R-rules for Start radio apply to stations unchanged).

## 4. What exists (kickoff code read 2026-10-09; re-verify line numbers)

- Radio route: `GET /api/music/radio` (lib/music/routes.js:283): `parseSeed` (track:/artist:/album:/genre:,
  lib/music/radio.js:157), `buildStationProfile` (:168), `pickRadioBatch(profile, list, ctx, rng)` (:769) with likes,
  progress, exclude, queued, widen. `visibleMusicList(req)` (routes.js ~211) is the one visibility function.
- Client: `startRadio(seed, seedItem)` (public/js/music.js:5158), `radioSeedForSong` / `radioSeedForDrill` (:5186),
  `stationSeedFor(cur)` (:4406), the radio fetch (:4445). The "ended" hook (:2195).
- Pocket: main menu rows (public/js/music-skins.js:716-721: Music, Settings, Shuffle Songs, Speakers, Now Playing),
  `MUSIC_MENU` (:686-688), action rows ("Start radio", :1124). Speaker / remote: public/js/remote.js (now playing resolver :151).
- Storage: SQLite, forward-only `user_version` migrations (lib/db/sqlite.js:177; `SCHEMA_VERSION = 34` at :324);
  `user_music_liked`, `user_music_progress` (:509-515); `media_view_counts` is video only. `addedAt` exists on tracks
  (lib/music/libraryAudio.js:101-115) but is not in the radio payload.
- Production library (v1.368.0 T0 / v1.375.0 traces): ~23,850 tracks, 565 artists, genre on ~17.5k; top "genres" are categories
  (music, gaming) plus hip-hop, rock, pop; year on ~22.9k but mostly UPLOAD years on yt-dlp audio.

## 5. Measurements

- **T0 (before W2, read-only, on Dean's production library):** extend `tools/radio-sim/simulate.js` with `--stations` that
  prints, for the admin viewer, every station D5/D6 would generate: name, song count, artist count, top 5 artists by share,
  and for each style word its match count split by field (genre / album / title / channel). Aggregate counts and artist
  names only, no titles or paths in committed output. Dean (or his host agent) runs it over stdin like v1.368.0's T0. If a
  word in D5b matches mostly unrelated songs (the v1.375.0 class), drop or narrow it and say so in the ledger; ask Dean only
  if a station HE named (Chill, Reggae, Synth) cannot be built.
- **Falsifiers (each run, output pasted):** a Reggae station on the fixture library plays no non-reggae song in its first 20
  picks; a restricted user's station list and counts differ from the admin's exactly by the hidden songs; a skip-heavy song's
  pick share drops by D3's factor over 1000 draws; a yt-dlp upload year never places a song in a Throwback decade; a phone
  driving the speaker counts one play, not two.

## 6. Waves (one commit or more each; each with its falsifier)

### W0. Housekeeping (docs only)
(The kickoff committed this plan on the branch.) Move the ROADMAP items "Named radio stations", "Count plays, skips and finishes for music" and
"A radio row in the pocket iPod skins..." to point at this plan.

### W1. Play counts (schema v35, additive)
`user_music_plays (user_id, track_id, plays, skips, finishes, last_played_at, PRIMARY KEY (user_id, track_id))`; a write route
(POST, the session user only, rate-bounded, id validated against the viewer's visible list); client reporting per D1 from
music.js (standard view, pop-out, Pocket, speaker). Migration test: v34 -> v35 keeps every existing row; rollback floor noted
per lib/db/sqlite.js's own rules. D3 weighting in `pickRadioBatch`.

### W2. Stations on the server
`station:` seeds (D4), the generators (D5, D6), custom stations and hides (D7, D8: `user_music_stations`, same migration
v35), `GET /api/music/stations` (list for the viewer, D9) and the custom-station CRUD routes (session user only, input
bounded, name escaped on render). T0 first.

### W3. Standard view
The Stations shelf, the editor with live count preview, Hide / More stations (D10). The now-playing line "Radio: <name>".

### W4. Pocket and speaker
The Radio row and list (D11), Now Playing's station line in every skin, station start on a speaker, the speaker's own
now-playing line (D12). Measure the new row in the smallest skin (LESSONS: rows wrap, buttons never shrink).

### W5. Close-out
Ledger (D1-D12 as built), device checks added to docs/DEVICE-CHECKS.md (stations play their kind; Pocket Radio; speaker line;
counts after a day of listening), ROADMAP, LESSONS line if a new class appears.

## 7. Gate
FULL (alters-schema forces it): adversary, qa, security-brief. Attack surfaces to brief: the two new write routes (another
user's id, a hidden track id, oversized / hostile names, request floods), the visibility of station lists, counts and art
(D9), the migration (existing likes / progress untouched), double counting across devices (D1), the style matcher's leaks (D5b),
silence when a station runs dry, and the station surviving resume / dock / Shuffle.

## 8. Release
docs/RELEASING.md and AGENTS.md exactly: version bump, CHANGELOG / releases.json in Dean's plain words (no process jargon), the
plan closed out in the same PR (`node scripts/plan-complete.js docs/exec-plans/active/2026-10-09-music-stations.md "Shipped
vX.Y.Z" --apply`), the protected-main PR flow (tag the local no-ff merge, push branch + tag in one push, `gh pr create`, every
required CI job green, `gh pr merge --merge`, `git pull --ff-only`). Shipped = the tag's "Publish Docker Image" run is green.
Delete the branch remote (`gh api -X DELETE .../git/refs/heads/<b>`) and local (`-d`).

## 9. Evidence (builder fills: numbers copied from the runs named, verbatim verdict lines)

- T0 station census (Dean's library):
- Falsifiers (section 5), one line each with the output:
- Migration v34 -> v35:
- Suites (Node 22.23.1 / 24.20.0) at the reviewed sha:
- Gate rounds:

### Gate round 1 (reviewed sha c42a52bc; the three seats reviewed in parallel; each verdict line is verbatim at the end of this file, the findings below are the builder's CONDENSED summary with the numbers copied from the reports)

Gate: APPROVED r1 @c42a52bc - security-brief
- WARNING (MEDIUM) W1: GET /api/music/stations and a `station:` radio batch had no rate bound; a member's 50 custom stations x 20 two-word words + 20 excludes make buildStations ~190M string ops per request on 24k tracks (estimated, not measured). LOW L1: the backup restore stored station / plays / hidden rows without the route's validation (a `genres: 'rock'` row made every station route 500 for that user). INFO: the plays-route comment omitted the backup export as a reader; stations.js vs D6's "a saved album's own year" (none exists).
- Verified by reading: the route census and auth gate; session-user scoping; D9 on every output; the bounds; prototype keys; no user text in a RegExp or path; every renderer escapes; per-user buckets; the migration and carriers; the simulator prints no titles or paths.

Gate: CHANGES r1 @c42a52bc - qa
- CRITICAL C1 (= adversary C1): the tally's listeners were bound with the VIEW signal, so a song that ended while the user was on another page (the player docked) was recorded as a SKIP, never a play or finish (probe: `["t0 skip","t1 skip"]`, expected a play and a finish each); chapters rolling while away posted nothing.
- CRITICAL C2 (= adversary C2): a "stay strict" station drifted on both run-dry paths - the skipped-out pool was gathered library-wide before the station's tierOf, and the R11 recycle walked the whole exclude list (songs played before the station started): picks `metal0, queen1, reg0...`.
- WARNING W1: lib/music/radio.js's header never mentioned the station: seed kind, stationLadder or the D3 weights. WARNING W2: PLAY_MAX_STEP 2 s vs the LOOP / EXIT siblings' 4 s (iOS sparse ticks could record finishes but no plays).
- S1 hidden generated stations consumed the 12 shelf slots (shelf showed 9). S2 D3 as built = 3+ skips AND never a finish. S3 the Favorites fallback = most RECENTLY resumed. S4 Delete never checked its answer. S5 a failed stations read rendered "New station" only. S6 = security L1. S7 bindings for C1 / C2 / a failed fetch. S8 a load that never played posted a skip on the next pick.
- Instruments: lint:ui OK (3172); overlay clean; eslint 0 errors (6 pre-existing warnings, identical at base); targeted unit 138/138, integration 76/76; perf (synthetic 23.8k): buildStations 132-172 ms, a station batch 102 ms.

Gate: CHANGES r1 @c42a52bc - adversary
- CRITICAL C1, C2 as above (probes adv-dock-probe.js, adv-strict-probe.js: `Rock:id12 Rock:id13 Rock:id14 Reggae:id0 Reggae:id1` with three Rock plays before a strict station started).
- WARNING W1: the bundle restore as a second unvalidated ingress (measured: `genres: 'rock'` THROWS in matchCustom). WARNING W2: Favorites VANISHED on the viewer's first play when they had no likes (a literal "until counts exist"). WARNING W3: surviving mutants - M3 a station draw without playsWeight, M27 the speaker never adopting the station, M28 the phone never sending it, M31 the style->genre absorption (the test's fixture could never form g:reggae), M40 CUSTOM_MAX unbound; 43 applied, 36 killed, 7 survived (M1 equivalent).
- S1 stale comments (common.js seed kinds; the plays-route readers). S2 M35 the listen guard unbound. S3 cost at production size (synthetic 23,850 tracks): buildStations 112-276 ms, a station batch 209 ms vs 92 ms for a genre batch. S4 a deliberate replay of the same song never counts a second play (the same-id guard). S5 section 9 empty at the reviewed sha; T0 pending.

### Gate round 1: the builder's dispositions (every CRITICAL / WARNING fixed; suggestions fixed or disclosed)

- C1 (both seats): the tally lives OUTSIDE the view - `bindPlayCountTo` binds the tick and `ended` on the player element once per element with NO signal, and the tally carries the file's chapter list so it rolls segments itself while the view is away (reflectChapter's call is a no-op when the tally already rolled). Bound by the seats' probe as a test (music-play-counts "gate r1 C1": a song ending while destroyed posts play + finish, the next song too, chapters roll while away).
- C2 (both seats): a tier-0 track (a strict station's non-member) never enters the skipped-out pool nor the recycle; the skipped-out pool holds the station's own candidates only. Bound (music-stations "gate r1 C2": three non-member plays before the station + a skipped-out non-member, 40 seeds, members only). D3 as built, stated: the skipped-out pool (candidates only) is drawn before the R11 recycle when the station would otherwise run dry.
- qa W1: the radio.js header now carries v1.378.0 (the station: seed, stationLadder's tiers, the D3 weights, tier 11). qa W2: PLAY_MAX_STEP = 4 s (bound: 3.5 s steps count, 5 s jumps do not); the device falsifier stays owed (tick deltas on a locked phone).
- adversary W1 = security L1 = qa S6: the restore validates every station row through validateCustomDef with the route's 12-hex id, bounds hidden keys (120) and play ids (200, NUL-free, non-negative counts) and refuses the whole bundle on a bad row (backup-restore test); matchCustom also reads lists defensively.
- adversary W2: Favorites keeps its fallback (likes, then the most recently resumed, "Builds as you listen") until a COUNTED song qualifies (3+ plays and a finish); likes alone do not end it (bound: one play never empties it).
- adversary W3: M3 bound (a station draw: a 3x-skipped member left out, a 2x-skipped member ~0.3x); M27 / M28 bound through the real music.js at both ends (a station card tapped with a speaker chosen sends `{ ids, idx, radio: { seed, name } }`; the speaker's handler plays it with the station context, the name and Autoplay on); M31 bound with a fixture where g:reggae WOULD form; M40 bound (the 51st create is a 400 with nothing saved). M35: a listen item returns before a tally is made (a source binding).
- security W1: GET /api/music/stations and a `station:` radio batch share the per-user stations bucket (60 then 2/s; bound: 429 after the burst, a song batch unbounded by it, another user unaffected). Disclosed: no memo of buildStations; cost per the seats' numbers above.
- qa S1: a hidden station never holds one of the 12 shelf slots (bound). S4: a refused Delete is said (toast) and the card stays (bound). S5: a failed stations read is an error line with Retry in the shelf; Retry refetches (bound). S8: a skip needs at least one real step of playback first (bound: a pick replaced before any tick posts nothing).
- adversary S1 / security INFO: the comments corrected (common.js seed kinds; the plays-route readers; stations.js on D6's saved-album year). S4: a deliberate replay of the same loaded song counts no second play - disclosed in the D1 ledger line.
- Device checks owed:

## 10. Out of scope
Outside data (MusicBrainz / Last.fm), moods inferred from audio (BPM / energy), sharing stations between users, editing stations
in Pocket, video stations.

Gate: APPROVED r1 @c42a52bc - security-brief
Gate: CHANGES r1 @c42a52bc - qa

Gate: CHANGES r1 @c42a52bc - adversary
