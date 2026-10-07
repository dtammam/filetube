---
plan: v1372-song-names-feed
harness: v2 · lean
branch: feat/v1.372.0-song-names-feed
anchor: outcome
status: Building
next: W1-W3, then the gate (section 6) and the release as v1.372.0
design: Dean's rulings 2026-10-07 (R1-R6 below), right after v1.371.0 shipped. Base main c2d0d694. The subtitles + 360 + cleanup wave renumbers to v1.373.0 before it builds.
gate: pending
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

## 7. Evidence
- Suites @3965ade6 (`npm test`, sequential): Node 22.23.1 `# tests 11485 / # pass 11472 / # fail 0 / # skipped 13`;
  Node 24.20.0 `tests 11485 / pass 11472 / fail 0 / skipped 13`.
- Gate r1 fixes: 18 of 18 fix mutants red by name (mut-r1-1372; one survivor bound by a tightened lock, then red).

## 8. Out of scope
- Editing other per-track fields (artist per track, track numbers): only names were asked.
- Hiding podcasts from the feed.
