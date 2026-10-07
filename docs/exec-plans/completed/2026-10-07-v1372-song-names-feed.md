---
plan: v1372-song-names-feed
harness: v2 · lean
branch: feat/v1.372.0-song-names-feed
anchor: outcome
status: Shipped v1.372.0
next: the release as v1.372.0
design: Dean's rulings 2026-10-07 (R1-R6 below), right after v1.371.0 shipped. Base main c2d0d694. The subtitles + 360 + cleanup wave renumbers to v1.373.0 before it builds.
gate: APPROVED - security-brief + qa r2 @8e8056f5, adversary r3 @ad6d5d4d (Dean ruled a quick delta re-check by the adversary at round 3)
---

# v1.372.0: Edit the song names before an album downloads; keep music out of the home feed

Two asks from Dean on 2026-10-07, shipped as one release (his ruling):

1. "For cases where the name cleanup doesn't solve like the name of the song in the end. Can we make them modifiable in that
   window. Song names etc."
2. "If I download 20 songs and they are Audio from YouTube I have the option to not see them in the main feed. Even the Audio
   feed. We can try Audio never in the feed as an option."

Read first: AGENTS.md, docs/LESSONS.md sections 0, 2, 4 (the sheet activation guard; a surface opened from a sheet), 9 (a new
persisted field: the album's titles ride the pending entry), 10 (a new per-user read on every home surface), 11, 12 (inert
sibling lists: every home surface and every synced-pref list).

## 1. Outcomes

1. With Save as an album on, every pickable row shows the name the song WILL get (cleaned when Clean up titles is on) and
   "Track N". Tapping a song's name opens the app's standard text dialog (`ui.prompt`), prefilled; Save renames it, Cancel or
   an empty name keeps it. What the row shows is exactly what is written to the file.
2. With Save as an album off, tapping a pickable row ticks it (as a Settings row does), so the tap is never dead.
3. Settings has "Show music in the home feed" (per user, synced, on by default = today). Off: songs are left out of the
   home page (R9). Opening a folder, a channel, search, Music, the watch page's Related rail, Roku and prev/next still show
   everything. Podcasts are not music and stay.

## 2. What exists (recon 2026-10-07 on c2d0d694)

- Picker: `openPlaylistPicker` (public/js/common.js) builds rows with `ui.row({ title, meta, media, actions: [box] })`; a row
  given `onClick` with actions renders its title as a `ui-row__link` button stretched over the row (public/css/ui.css 426-459).
  `ui.prompt({ title, label, value, confirmLabel })` (public/js/ui.js) resolves the typed value or null and carries its own
  activation guard.
- Album tags: `lib/ytdlp/album.js` (`albumFrom`, `trackTagsFor`, `albumTagArgs`; `TITLE_NOISE_PATTERN` + the artist-prefix
  rule run inside yt-dlp when `cleanTitles`). Album = `{ title, artist, cleanTitles, tracks: {id: n} }`, persisted in the
  pending entry and the activity row (Retry).
- Home: `GET /api/home` (lib/media/routes.js; the row feed and `?view=grid`), `GET /api/videos` home arm (no search / folder /
  root: the hidden-folders filter). Synced prefs: `lib/prefs-allowlist.js` SYNCED_PREF_KEYS (+ the client twin in
  public/js/prefs-sync.js, a triple-lock test), stored per user in `user_prefs` (`userStore.getPrefs`). Home-row switches:
  setup.html rows + setup.js `wireHomeRowToggle` / `loadHomeRowControl` (`ft-home-continue-listening`).

## 3. Measurements
- `%(.{id,title,meta_title})j` (yt-dlp 2026.08.19, -s on QFIFEobmIIQ): with a `meta_title` set the dict carries it
  (`"meta_title": "Planet of the Bass"`); without one the key is absent, so the capture template changes nothing for any
  other download.
- Real yt-dlp end to end (FileTube's argv, album.titles = 'Planet of the Bass \\g<0> %(id)s'): exit 0; the captured
  library title and the file's title tag are both exactly that string; album "Kyle Gordon Is Everywhere", track 7; the
  file name keeps YouTube's title.
- 390px Chromium: each pickable row shows the cleaned name and "Track N"; the first draft's per-row "tap the name to edit"
  was cut off, so the hint moved to the Save as an album row ("Tap a song's name to rename it").

## 4. Rulings (Dean, 2026-10-07)

- R1 Song names are edited by tapping the name: the standard text dialog, prefilled; the row shows the name and its track.
- R2 One release with the feed switch (v1.372.0).
- R3 The feed switch is per user, a Settings option; off = audio never in the home feed, the Audio filter included.
- R4 (builder) What-you-see-is-what-you-get: the picker computes the cleaned names (the noise rule from the server, the
  artist prefix live from the Album artist field) and sends only names that differ from YouTube's; the server writes each
  as a literal `meta_title`. The in-yt-dlp cleanup stays for a pending entry written by v1.371.0 (no titles map).
- R5 (builder) The server decides the feed from the user's SYNCED pref (`ft-home-music`, '0' = off). Gate r1 (adversary W1,
  qa W2) found the original "pushes the pref before it reports done" was not in the tree: the change now flushes the sync at
  once (`__ftPrefsSync.flush()`, the POST `keepalive`) and drops the cached home page (`FileTube.forgetHomeView`).
- R9 (Dean, gate r1) Scope: off = no songs anywhere on the HOME PAGE (its grid, Recently added and the other rows, Continue
  watching, the modern grid and its Audio chip, Music-library songs in the rows) except "Continue listening" (its own
  switch). The watch page's Related rail, Roku and prev/next are untouched: the home page's own `/api/videos` requests carry
  `home=1` (main.js `isBareHome`), and only those are filtered.
- R6 (builder) Music = a media item of `type === 'audio'` (yt-dlp audio and local audio files alike); podcast episodes are not.
- R7 (Dean, mid-build) Each row shows the name it will be saved as ("It wasn't clear what the new saved name would have
  been"); the library list shows the same name as Music (he saw "Kyle Gordon - Name [...]" there but not in Music).
- R8 (Dean, mid-build, a bug folded in) "If you right-click or go to Move to Trash? and press Enter, it brings up the
  right-click menu." He first ruled that Enter should confirm; the pre-commit suite showed that contradicts F33 (the
  2026-09-27 UI pass: "the keyboard cannot confirm by accident", three locks), and asked again he ruled F33 stays: Enter
  does nothing on a confirm; only the focus fix ships.

## 5. Waves

### W1. Song names (server)
- `run.playlistEntryFrom` adds `titleClean`: the title with the noise groups removed (album.js `cleanTitleNoise`, the SAME
  pattern string the yt-dlp path uses).
- `albumFrom` accepts `titles: {id: string}` (each `cleanText`, ids of the job only, null-proto); `trackTagsFor` returns the
  track's title; `albumTagArgs` writes a literal `meta_title` when there is one (and then no regex cleanup for that track).
- Falsifier: unit tests per guard; the real yt-dlp writes the literal title (ffprobe read-back, hostile names).

### W2. Song names (client)
- Rows built with `onClick` (pickable rows only): album on -> `ui.prompt` rename; album off -> toggle the row's switch.
- Each row's shown title follows the album switch, Clean up titles, the Album artist field and the rename; meta "Track N".
- The POST's `album.titles` = the ticked rows whose final name differs from the original.
- Falsifier: jsdom through the real picker + ui.js (prompt Save / Cancel / empty, the activation guard on the row tap, the
  posted titles); a 390px Chromium shot.

### W3. Show music in the home feed
- `ft-home-music` joins SYNCED_PREF_KEYS (server + client twin), the Settings row (setup.html + setup.js, the home-row
  pattern), and `/api/home` (rows + grid) and the `/api/videos` home arm skip `type === 'audio'` media when it is '0'.
- Falsifier: integration tests per surface with a seeded pref (on, off, absent), the folder/search arms unaffected, the
  triple-lock and settings-shape locks.

### W4. Enter on Move to Trash re-opened the menu (ui.js, every sheet)
- Diagnosis (falsified first, in Chromium with real keys: a button -> ui.menu -> Move to Trash -> ui.confirm): the menu's
  `finish()` (after its ~280 ms exit) focused its opener unconditionally, AFTER the confirm had taken focus, so focus sat
  on the button behind the dialog and Enter pressed it. Before: focus "kebab", menuOpens 2, answers [].
- Fix: `finish()` gives focus back only if focus is still in the sheet (or nowhere); `open()` from inside a CLOSING sheet
  inherits that sheet's opener (focus returns to the card's button after the confirm). After: focus on the dialog,
  menuOpens 1, answers [] (Enter does nothing: F33).
- Bound: test/unit/ui-focus-handoff.test.js; the F33 locks (subs-destructive-confirm and the Extras delete) stay green.

## 6. Gate
Seats: adversary (floor) + qa + security-brief (a new per-user read on every home surface; a new persisted field).

Gate: APPROVED r1 @3965ade6 - security-brief
Read-only review from source (the seat has no shell, so it did not run git diff, tests or yt-dlp; every "verified" below was traced in source). No CRITICAL / HIGH / MEDIUM.
- S1 album.titles -> meta_title (verified): the route refuses an API token (403) and runs requireManageSubscriptions first; albumFrom takes only the job's own ids (isSafeVideoId) into a null-proto map, each value through cleanText (C0, DEL, C1, zero-width, bidi, U+2028/9 and BOM refused, 1-200 chars). A `__proto__` id passes isSafeVideoId but lands as an own key on the null-proto map: no pollution. The value is its own argv element and the third arg of nargs=3 `--replace-in-metadata` (stdlib optparse takes it positionally, so a leading `-` is data); WHEN comes from arg 1 only (options.py _dict_from_options_callback); pyReplacementLiteral doubles `\`, the only special character in a Python re replacement. The pending entry and a Retry are re-validated through playlistJobFrom/albumFrom. Not exploitable.
- S2 meta_title as the library title (INFO): a new source for sourceTitle, but from a user who can already download anything (and set album/artist tags shown in Music), never from a token; only on a NEW download (youtubeIdInLibrary), still through sanitizeCapturedTitle; no title reaches a path sink (grepped). No yt-dlp extractor sets meta_title (grepped the 2026.08.19 tree: zero hits), so subscription downloads are unchanged. Renderers are textContent.
- S3 ft-home-music (verified): read via getPrefs(req.user.id), own-property lookup, compared to '0' only; it can only REMOVE items after mediaVisibleTo, so failing open never shows anything RBAC hides. Restore goes through the shared allowlist module (512-byte cap). No sink.
- S4 picker + ui.js (verified): song names reach the DOM through textContent only; stripArtistPrefix escapes the artist before the RegExp; TITLE_NOISE_RE on 300-char titles is linear (no word is a concatenation of others). The focus change only declines to steal focus back and reads __uiOpener from a `.ui-sheet.is-closing` ancestor, which page content cannot create. No keystroke capture path.
- INFO (pre-existing, #150): the activity row's album, now with every song name, is in /api/subscriptions/status for any signed-in user (classified TRACKED in route-read-classification). Low value; noted, not a blocker.
- LOW (not security, for QA): a YouTube title with an emoji ZWJ sequence (U+200D) or a bidi mark, once Clean up titles changes it, is posted and cleanText refuses it, so the WHOLE job fails 400 with "Each song needs a name". The same happens if a typed name contains one.

Gate: CHANGES r1 @3965ade6 - qa
Ran (Node 22.23.1, verified): 18 targeted files (the 10 changed tests + subs/extras/watch destructive-confirm, ui-activation-guard, ui-builders, home-feed, prefs-store) `# pass 482 # fail 0`; `npm run lint:ui` OK (live debt = docs/ui-exceptions.json); overlay-containment clean (0); eslint on every changed file 0 errors (6 pre-existing no-unused-vars warnings in common.js, none on changed lines); no CSS file in the diff. Mutants (/tmp git archive sandbox, each restored + cmp'd): 25 run, 24 killed (focusIsOurs, opener inheritance, each of the 3 home filters, '0'-only value, posted-titles rule, album-off tick, tapRow accepts, guard mark, artist re-render, trim, hint, albumTagArgs title, trackTagsFor title, job-ids-only, meta_title precedence, titleClean, double noise pass, print template, allowlist key); the survivor (drop `if (!t) return` in tapRow) is equivalent (custom '' is falsy). Chromium, real keys (trash-repro): base c2d0d694 menuOpens 2 / focus "kebab" behind the confirm; 3965ade6 menuOpens 1, focus on the dialog, Enter answers nothing (F33 holds), Escape answers false and focus returns to "kebab". 390px: rows show the cleaned name + "Track N", the hint fits on the Save as an album row, the rename is the kit ui.prompt prefilled; a real touch on a row's switch toggles it only, a touch on the name opens "Song name".
- W1 (blocks) lib/ytdlp/album.js:60 + public/js/common.js:7790: a cleaned name keeps YouTube's invisible characters and cleanText refuses them, so the WHOLE album job is 400. Measured: title "Song <U+2764 U+FE0F U+200D U+1F525> [Official Video]" (a ZWJ emoji) or "<U+200F><RTL title> [Official Audio]" with Clean up titles on -> titles[id] posted -> albumFrom {"ok":false,"error":"Each song needs a name (up to 200 characters)"}. v1.371.0 cleaned these in yt-dlp without refusing; the message names no song and blames length. Fix: the picker strips (or the server strips, not refuses) the format characters from a SONG name before comparing/posting, and a refusal names the song.
- W2 (blocks) plan R5 vs public/js/setup.js:3390: R5 says "the Settings switch pushes the pref before it reports done"; the tree only writes localStorage (wireHomeRowToggle), and prefs-sync mirrors after a 1 s debounce with no pagehide flush and no boot re-push of a local-newer key (prefs-sync.js 80-120, 158-166). This is the first synced key whose READ is on the server, so (a) Home -> Settings -> off -> Home is a homeViewCache hit (common.js 11982, identical URL): the cached feed still shows the songs (should-work reasoning, not device-run); (b) toggle then reload/close within 1 s: the POST never lands, the switch reads off on this device forever while every home surface keeps music. Fix as R5 claims: on change call window.__ftPrefsSync.flush() and drop the home cache (or correct R5 and disclose).
- S1 lying numbers/comments: public/js/prefs-sync.js:22 and lib/user/routes.js:25,69 still say 22 keys (now 23); lib/ytdlp/album.js:36-38 albumFrom doc and lib/ytdlp/index.js:6809-6810 give the album shape without `titles`; public/setup.html:494 note under the new row says "Toggle the continue rows ... Device-local" (it is neither a continue row nor device-local).
- S2 the /api/videos home arm also feeds the watch page's Related rail (watch.js:2012) and root-level prev/next/autoplay: with the switch off a video's Related rail never suggests a song. Plan outcome 3 says only the home feed is pruned; name it or scope the filter (hiddenFolders has the same reach, so it is precedent, not new).
- S3 common.js:7703/7790: an entry with an empty listing title posts its video id as the song name (the file is tagged "dQw4w9WgXcQ" where v1.371.0 wrote the real title). S4 run.js:473 present() drops a typed name "NA", so the library shows YouTube's title while Music shows "NA". S5 a11y: the row's name button says only the song name (nothing says it renames; with the album off it toggles another control with no state). S6 test/unit/ui-focus-handoff.test.js:76 "opens no menu" is vacuous (Enter is dispatched on the dialog, jsdom never activates the opener); test 1 carries the binding.
Security (standing): no new exposure. Song names reach yt-dlp as one argv element (no shell), job ids only, null-proto, cleanText + pyReplacementLiteral; DOM writes are textContent; ft-home-music only removes items after mediaVisibleTo and fails open to today's feed; the synced pref rides the shared allowlist (512 B cap). Concur with security-brief.

Gate: CHANGES r1 @3965ade6 - adversary
Instruments (verified, Node 22.23.1, /tmp git archive sandbox, pristine copy diffed clean after every mutant): 12 targeted files `# tests 371 # pass 371 # fail 0`; the F33 locks + every test/unit/ui-*.test.js `# tests 298 # pass 297 # fail 0 # skipped 1` (the skip: the ui-exceptions merge-base test needs a .git). Mutants: 44 run, 36 killed, 8 survived (below). Real yt-dlp 2026.08.19 with FileTube's albumTagArgs + the capture template (-s, QFIFEobmIIQ): no album -> meta_title absent; 5 hostile names (`-x \g<0> %(id)s \`, `pre_process:title:(?P<x>.+)`, `a\1\\b $0 ${x} \n`, a leading en dash, 200 chars) each round-trip exactly. Flat-playlist vs full titles on PLUtyNbQXMTLg: 24 compared, 0 differ (the "equal name is not sent" rule is safe there).
- W1 (blocks; QA W2's leg (a) now MEASURED) the switch does not take effect when the user goes back Home. Chromium on a live server from 3965ade6 (seeded vid1 + audio song1): load / (2 items) -> in-app Settings -> Show music off -> wait 2 s (server row {"value":"0"} confirmed) -> in-app Home: SONGTITLE1 still on the page (homeViewCache reattach, common.js 11444-11470). The reverse (off -> on) also stays stale. Leg (b) measured: off, then a full navigation 150 ms later -> the server row is still "" at 6 s and 12 s (the debounced POST is lost; prefs-sync never re-pushes a local-newer key, reasoned from prefs-sync.js 80-166). R5's "pushes the pref before it reports done" is false in the tree. Fix: on change flush (window.__ftPrefsSync.flush) and drop the cached home; bind it with a test that toggles then reads /api/home.
- W2 (blocks) the filter's enumeration is wrong both ways (the plan's R6 + the homeHidesMusic comment "a folder, a channel, search and Music still show everything"). Measured on the live server, pref '0': GET /api/videos?limit=100000 (watch.js Related rail) -> ['vid1']; /api/videos?sort=newest (roku VideosTask) -> ['vid1']; ?root= -> both (unchanged). Probe through the real /api/home (home-api AC3 shape + an in-progress audio media item `s`): continue-watching = ["track:Song","media:Title v"] - the in-progress yt-dlp song LEFT Continue watching (the brief says continue rows must not change; classic main.js:3342 `filter=recent-watching` hits the same home arm), while a Music-library track ("Song") still rides the row feed with music off (the `kind: 'track'` arm, routes.js ~613, has no hideMusic check). Rule which of these is "music in the home feed", then make every arm match it and test each.
- W3 (blocks; concur with QA W1, measured independently) through the real picker in jsdom: title "Kyle Gordon - Family <man ZWJ woman ZWJ girl> [Official Video]", album + Clean on -> posted titles {"vid00000001":"Family <ZWJ emoji>"} -> albumFrom {"ok":false,"error":"Each song needs a name (up to 200 characters)"}; "<Hebrew> U+200F (Official)" the same. v1.371.0 cleaned these in yt-dlp. A typed name over 200 (ui.prompt has no maxlength) fails the whole job the same way.
- W4 (blocks) the rename dialog is not bound to the view signal (LESSONS 4: "every menu, confirm or sheet a view opens passes FileTube.viewSignal()"; ui.prompt forwards no signal at all, ui.js 895). Measured (jsdom, real picker + ui.js): picker opened with an AbortController signal, tap a name, abort -> the picker is gone, the "Song name" dialog is still on the page (its scroll lock held). Fix: pass a signal through ui.prompt and use the picker's.
- W5 (test binding) mutant U4 `focusIsOurs = !!focusNow && s.contains(focusNow)` (drop the body/null arm) SURVIVES ui-focus-handoff.test.js, yet it is the common path: Chromium, a ui.sheet closed by a mouse click on its scrim -> activeElement BODY at click, then committed ui.js returns focus to "opener", the mutant leaves BODY. Add a test where focus is on body at finish.
- S1 other survivors (each reasoned, none a live bug): M6 catch -> true (fail-open untested); M12/M13/M14 trackTagsFor typeof / hasOwn and albumTagArgs cleanText on the title (dead behind albumFrom); C9 (equivalent, as QA found); C16 `metaEl.hidden = false` (an empty meta span shows with the album off, unasserted); U5 reading focus AFTER removal is equivalent, so the "read BEFORE the sheet leaves the page" rationale in finish() is not load-bearing.
- S2 lying comments: lib/media/routes.js 149-154 (the Chapter Snap "this OWN-property lookup" block now sits above homeHidesMusic, not ownMediaItem); prefs-sync.js:22 "22" (now 23, as QA); public/setup.html puts the row under "Continue rows" with the note "Device-local" and the comment "(device-local display prefs)".
- S3 (reasoned) a video listed twice and both rows ticked: the first ticked row's name is posted, a rename on the second is dropped silently.
- Not attributed: a DIRECT load of /setup.html in headless Chromium never answers Runtime.evaluate on base c2d0d694 and on 3965ade6 alike (an instrument quirk or a pre-existing hang; not this diff).

Gate: APPROVED r2 @8e8056f5 - security-brief
Delta re-check, read-only from source at 8e8056f5 (no shell: no git diff or tests run; traced by reading the changed code). No CRITICAL / HIGH / MEDIUM.
- r1 LOW (ZWJ / bidi fails the whole job): fixed differently from a pure refuse, and the deviation is sound. In album.js, CONTROL_CHARS now allows U+200C-200F. A song name has INVISIBLE_FORMAT_ALL (200B, 2028-202E, 2060-2064, FEFF) STRIPPED, then goes through cleanText, which still refuses C0, DEL and C1 and enforces 1-200 characters, so a newline or NUL never reaches the argv, the pending file or the captured title. Strip, then validate is idempotent: albumTagArgs' cleanText on the stored name passes, and so does the requeue. U+2028/2029 can no longer survive into the yt-dlp "Changed meta_title to:" line (the r1 INFO 1 concern).
- Spoofing (verified that it is not a privilege issue): LRM/RLM (200E/200F) are strong direction MARKS, not overrides or embeddings, so they cannot reorder a run of text the way 202A-202E could (still refused / stripped). ZWNJ/ZWJ/LRM/RLM can make an album name that looks identical to an existing one, but only a download-capable user types it, and that user can already do the same with homoglyphs (Cyrillic "а"). Worst case is a second Music album, data hygiene with no cross-user or privilege effect. INFO.
- INFO (pre-existing since v1.371.0, not this delta): the bidi ISOLATES U+2066-2069 (LRI/RLI/FSI/PDI) were never in either set, so an album, artist or song name can carry one and visually reorder its own text (textContent rendering, no injection). The same user could already do this, and YouTube titles bring these in through sanitizeCapturedTitle anyway. Adding 2066-2069 to both classes would close it cheaply. Not a blocker.
- Error message with the id (verified, no leak): `The name for ${id} ...` echoes an id from the job's own isSafeVideoId-validated list (`[A-Za-z0-9_-]{1,64}`, no markup or control characters) back to the user who posted it. On a restart requeue it lands in the runlog reason, where it is a YouTube id the same job already records. The picker renders the error with textContent.
- routes.js: every hideMusic arm (`/api/videos` with `home=1`, the grid, the media rows, the new track branch) runs AFTER mediaVisibleTo / trackVisibleTo and only removes items. A forged or absent `home` only changes what the caller sees of their own visible set.
- prefs-sync keepalive: the same same-origin POST, credentials and allowlist on the server; the body is at most 23 keys x 512 bytes, under the 64 KB keepalive budget. forgetHomeView on window.FileTube only drops the caller's own cached view (a same-origin script could already navigate). ui.prompt's `signal` and the setup.js change listener (flush + forgetHomeView, each in a try) add no new sink.

Gate: APPROVED r2 @8e8056f5 - qa
Delta 3965ade6..8e8056f5. Ran (Node 22.23.1, verified): 20 targeted files (the r1 set + home-feed-render, music-home-row) `# tests 516 # pass 516 # fail 0`; the suites that lock main.js / setup.js / prefs-sync strings (library-toolbar(-wiring), library-pagination, liked, setup-advanced-pages, tv-view, remote-target, player-lifecycle-release) `# tests 166 # pass 166 # fail 0`; lint:ui OK; overlay-containment clean (0); eslint on the 15 changed .js files 0 errors (the same 6 old common.js warnings). Fix mutants (/tmp archive of 8e8056f5, each restored + cmp'd): 18 of 18 red (home=1 gate, Music-library tracks, main.js home=1 on the grid and on Continue watching, flush, forget, the cache drop, keepalive, the invisible-character strip, the allowed joiners/marks, the "NA" rule, the 200 bound, the per-video rename, never posting an id, the Select/Rename label, the picker's signal to the prompt, ui.prompt's signal, the body arm of focusIsOurs). Live Chromium on a real server from the sandbox (seeded vid1 + audio song1, session cookie): home shows TITLE_song1 -> in-app Settings -> switch off -> the server row is "0" within 400 ms -> in-app Home: the song is gone; switch on -> Back: the song is back.
- W1 fixed (differently from my prescription, accepted): joiners and RTL marks now pass, the hiding characters are dropped from song names, and the error names the video id. The picker refuses a name over 200 with a status note.
- W2 fixed as prescribed: flush + forgetHomeView + keepalive, and R5 is corrected (verified live above). Note: the forgetHomeView lock is a source regex; the behaviour is what I verified in Chromium.
- S1 fixed (counts, the album shape, the moved OWN-property comment). S2 resolved by Dean's R9 (home=1); the Roku and Related-rail shapes are bound. S3 / S4 / S5 / S6 fixed and bound.
New, non-blocking (SUGGESTION):
- (a) album.js CONTROL_CHARS also changed for the typed ALBUM and ARTIST: U+200C-U+200F now pass there too. A default artist carrying a trailing U+200F makes a second "Kyle Gordon" in Music that looks identical, and the "Already in Music" note misses it. This is the v1.371.0 gate r1 lookalike concern; stripping edge direction marks from the album and artist fields would close it.
- (b) public/setup.html:494, the edited note still says the continue rows are "device-local", but ft-home-continue-listening is synced.
- (c) a song name that is only stripped characters, or that contains a control character, is refused with "must be 1 to 200 characters" (the wrong reason).
- (d) cosmetic: setup.js export `wireHomeMusicApply,` is indented 2 spaces, not 4; the ui.js finish() comment line runs past the file's width.
Security (standing): the new surface is only `home=1` (it can only remove items after mediaVisibleTo) and `keepalive` on the same-origin prefs POST. Stripping before cleanText cannot let a control character through (C0/C1 are still refused). No new exposure.

Gate: CHANGES r2 @8e8056f5 - adversary
Delta 3965ade6..8e8056f5 (verified, Node 22.23.1, /tmp git archive sandbox, pristine diff clean after every mutant): 21 targeted files (the r1 set + home-api, extras/watch destructive-confirm, every ui-*) `# tests 563 # pass 562 # fail 0 # skipped 1` (the .git merge-base skip). Mutants: 25 run, 22 killed, 3 survived. Chromium on a live server from 8e8056f5:
- r1 W1 FIXED (measured): load / (song shown) -> in-app Settings -> off -> in-app Home AT ONCE: song gone, server row "0"; Settings -> on -> history.back(): song back, row "". Off, then a full navigation 150 ms later: server row "0" (the keepalive POST lands; at r1 it stayed ""). forgetHomeView while Settings is shown: no exception or console error, and a sidebar folder link still navigates (/?root=..., song listed).
- r1 W2 FIXED per R9 (killed: home=1 gate, the track branch, the main.js push, the Continue watching home=1). Note, not a finding: isBareHome is also true for `?browse=1` (Recently added's See all), so that page hides songs too; it is a home page by R9's reading.
- r1 W3 FIXED differently (song names: strip the hiding set, keep joiners and marks; the error names the video id). See NEW W2 for what the CONTROL_CHARS change did to album and artist.
- r1 W4 FIXED (killed: ui.prompt drops the signal; the picker omits it). r1 W5 FIXED (U4 now killed). r1 S1: M6 and C16 now killed. r1 S2 and S3 FIXED (16 per-row render killed).
- NEW W1 (test binding of the W1 fix) mutant R5: delete `wireHomeMusicApply(signal);` from wireStaticControls -> home-music-switch, settings-forms-sweep and settings-census all stay green. The test calls wireHomeMusicApply directly, so the ONE call site that makes the r1 W1 fix live is unbound. With it gone, r1 W1 comes back exactly as measured at r1. Fix: lock the call (or drive wireStaticControls in jsdom and assert flush + forget on change).
- NEW W2 (r1 gate fix of v1.371.0 reopened; QA filed it as a SUGGESTION, I rate it higher because the result is written into files) CONTROL_CHARS lost U+200C-U+200F for the ALBUM and the ARTIST as well. Measured: albumFrom({artist: 'Kyle Gordon' + U+200E}) -> ok:true, artist kept with the mark (r1: refused). It is reachable without typing: defaultAlbumArtist([{title: 'Kyle Gordon' + U+200E + ' - Song A'}, ...]) -> 'Kyle Gordon' + U+200E, and a channel '‏Artist - Topic' -> U+200F + 'Artist'. The tag is then written into every file, giving Music a second "Kyle Gordon" that looks the same, and checkExisting's sameName misses it. Fix: drop the marks (and the hiding set) from the album and the artist too (a strip, as for song names), or keep refusing them there only.
- S1 mutant R21: ui.prompt with an ALREADY-aborted signal never settles (measured: prompt PENDING after 300 ms; ui.confirm answers false). So "the caller's signal, like ui.confirm's" (ui.js) is untrue. The picker cannot reach it (tapRow needs accepts(), which needs the picker to be open). A one-line `if (o.signal && o.signal.aborted) { settle(null); return; }` would match confirm.
- S2 mutant R18: a TYPED name on a row with no listing title is not sent if the custom arm is dropped, and no test says so.
- S3 (as QA c) an all-stripped or control-character song name is refused as "must be 1 to 200 characters" (the wrong reason), and it names the video id, not the song.

Gate: APPROVED r3 @ad6d5d4d - adversary
Delta 8e8056f5..ad6d5d4d (verified, Node 22.23.1, /tmp git archive sandbox, pristine diff clean after): 16 targeted files (album, picker, focus-handoff, home-music-switch, playlist-job, forms-sweep, census, prefs-sync, ytdlp-run/args, every ui-*) `# tests 513 # pass 512 # fail 0 # skipped 1` (the .git merge-base skip). Mutants: 18 run, 16 killed, 2 survived (both below, neither a live bug).
- r2 W1 FIXED and bound: removing the `wireHomeMusicApply(signal);` call, wrapping it in `if (false)`, or moving it before the toggle's wiring each go red.
- r2 W2 FIXED and bound. Killed: tidyKeyName without the hidden-set drop; without the edge trim; trimming the start only; trimming the end only; stripping inner marks too; not applied to the album title; not applied to the artist; song names tidied like keys; the isolates left out of INVISIBLE_FORMAT_ALL; the default artist using trim() instead of the edge strip. An artist that is ONLY marks ('‎‏') is refused as "needs an album artist", and the picker's default skips it. An INNER mark ("Kyle‎Gordon") is kept by both client and server, so they agree.
- r2 S1 FIXED (pre-aborted ui.prompt: guard removed -> red, settling '' -> red). S2 FIXED (custom arm dropped -> red). S3 FIXED (the message states the rules).
- SUGGESTION, measured in jsdom through the real picker: the "Already in Music" note is checked against the RAW field, while the server writes the tidied key. Typed "Kyle Gordon"+U+200E: no note, server writes "Kyle Gordon". A default from the title "Kyle"+U+200B+"Gordon - A": no note, server writes "KyleGordon". Both are Music artists in the probe's library. So the tracks join the existing artist (the W2 harm is closed) without the note saying so; with a typed edge mark, the "Artist - " prefix also stops being stripped from song names. Fix if wanted: tidy the field value (or the checkExisting query) the way the server does.
- Survivors (equivalent or untested): T9, CONTROL_CHARS without U+2066-2069, survives because every cleanText input has already had INVISIBLE_FORMAT_ALL (which includes them) removed, so that part of CONTROL_CHARS is dead. D2, the "- Topic" channel branch of defaultAlbumArtist using trim(), has no client test (the server's tidy still trims it, which T7 binds).

## 7. Evidence
- Suites @3965ade6 (`npm test`, sequential): Node 22.23.1 `# tests 11485 / # pass 11472 / # fail 0 / # skipped 13`;
  Node 24.20.0 `tests 11485 / pass 11472 / fail 0 / skipped 13`.
- Gate r1 fixes: 18 of 18 fix mutants red by name (mut-r1-1372; one survivor bound by a tightened lock, then red).
- Suites @8e8056f5: Node 22.23.1 `# tests 11494 / # pass 11481 / # fail 0 / # skipped 13`; Node 24.20.0 `tests 11494 /
  pass 11481 / fail 0 / skipped 13`.
- Gate r2: security-brief + qa APPROVED @8e8056f5; adversary CHANGES (W1 the Settings call untested; W2 direction marks
  reached the album / artist key). Dean (round 3 rule): a quick delta re-check by the adversary. Fixes: the call is
  locked; album and artist drop the hidden set and lose joiners / marks at their ENDS (one inside a name stays; a song
  name keeps its marks); the default artist trims them too; the bidi isolates U+2066-2069 join the hidden set (security
  r2 INFO); ui.prompt answers an already-aborted signal at once; the refusal message states the real rules; the setup
  note and indentation (qa r2 b, d). 8 of 8 fix mutants red by name (mut-r3).
- Suites @ad6d5d4d (final): Node 22.23.1 `# tests 11498 / # pass 11485 / # fail 0 / # skipped 13`; Node 24.20.0 `tests 11498
  / pass 11485 / fail 0 / skipped 13`.

## 8. Out of scope
- Editing other per-track fields (artist per track, track numbers): only names were asked.
- Hiding podcasts from the feed.
