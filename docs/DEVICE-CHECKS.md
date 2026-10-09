# Device checks (the rolling list)

One list of what Dean taps on his phone or desktop to confirm a release, grouped by area. Each line
carries the version that introduced it. A release appends its checks here instead of adding a tracker
row; a line is deleted when Dean has confirmed it, and a line that fails becomes a bug (in the tracker or
ROADMAP.md Planned > Bugs). Tracker row #284 points here for its open check (the v1.336 black picture, now the v1.361.0 checks).

## Whole app, layout and dialogs

## Minimize into the mini player (v1.362.0)

Settings > Experimental > "Use custom player controls on touch devices" ON for all of these.

- [ ] v1.362.0 - iPhone, inline video playing: pull down slowly and let go early (springs back, still playing); pull past a third (docks bottom-right, still playing, the page is where you browsed from). Watch the picture during and after the drag: if it goes black or freezes while the sound runs on, open the same page in a SAFARI TAB with `?minimizeAnim=0` and repeat (the switch is a URL parameter; the home-screen app has no address bar). Black with the animation and fine without = the moving picture is the trigger.
- [ ] v1.362.0 - Tap the down-chevron at the picture's top-left (since v1.362.1 it shows while paused, or for about 3 s after play or a touch on the picture): same end state. Then tap the mini player: back to the watch page, same position, still playing. Open a video from another video (a related card), minimize: you land on the feed / search you started from, and the second video keeps playing.
- [ ] v1.362.0 - The mini player's X and play/pause: hit each with a thumb ten times without a mis-tap into "expand". With captions on, they sit above the bar.
- [ ] v1.362.0 - Regressions: tap pauses, double-tap skips, hold 2x, hold-drag-down locks 2x, swipe right goes back, scroll the page from below the picture, full screen untouched. (Since v1.362.3 a finger that starts on the picture never scrolls the page: scrolled down, a pull on the picture does nothing, so the old "scroll down then pull on the picture" and "wiggle then drag up" steps no longer apply.)
- [ ] v1.362.0 - Home-screen app AND Safari tab: in the Safari tab the pull at the top fights the browser's own overscroll; report which wins (since v1.362.3 the browser never gets a touch that starts on the picture).

## The minimize chevron peeks (v1.362.1)

Settings > Experimental > "Use custom player controls on touch devices" ON for all of these.

- [ ] v1.362.1 - Tap to pause and lock the phone at once: does the pause still happen? (A tap waiting out the double-tap window now ends with backgrounding.)
- [ ] v1.362.1 - VoiceOver on, a video playing: rest the VoiceOver cursor on the chevron; does it stay, or vanish after about 3 s?
- [ ] v1.362.1 - Follow `docs/references/vpn-slowness-runbook.md` once; tell Claude where it was unclear, and send the run ids.

## No loupe on any hold; the black-picture tests (v1.362.3)

Settings > Experimental > "Use custom player controls on touch devices" ON for all of these. (The v1.362.2 loupe line failed on
2026-10-04: the magnifier still showed on a plain hold; this release cancels every touch on the picture instead.)

- [ ] v1.362.3 - iPhone: press and hold the playing picture with no tap before it, inline, in full screen and on an audio file's
  art; and a double-tap then a hold: 2x every time, NO grey magnifier. Hold-drag down: locks.
- [ ] v1.362.3 - Regressions: tap pauses, double-tap skips, chains skip, hold 2x, the lock pill, pull down minimizes, swipe right
  goes back, the mini player's tap expands. Expected change: a finger that starts on the picture no longer scrolls the page, and
  scrolled down, a pull on the picture does nothing (scroll from below the picture first).
- [ ] v1.362.3 - The black picture, four runs (lifecycle log ON; no double-taps): (A) twenty pause/play rounds by PICTURE tap, no
  holds; (B) the same with Settings > Troubleshooting > "No glyph on picture taps" ON; (C) pause by PICTURE tap, resume with the
  BAR's play button, twenty times; (D) a few 2x holds, then pause/play with the BAR only. Say which runs went black; after any black,
  Export log and send it (it now adds up short rounds and names a layer restart as `video:fcount-reset`).
- [ ] v1.362.2 - Whenever it goes black in normal use: Settings > Troubleshooting > Export log and send the file with a word on the
  last few things you did.
- [ ] v1.362.2 - Settings > Troubleshooting: lifecycle log ON (nothing appears on screen), use the app for a while (play, pause,
  hold, close and reopen the app), come back to Settings, press Export log: the share sheet offers a .txt file; save it to Files and
  open it: one line per event with times. Send one to Claude. Clear log asks first.

## The page fades under the video, like YouTube (v1.362.4)

Settings > Experimental > "Use custom player controls on touch devices" ON.

- [x] v1.362.4 - (Dean 2026-10-08: confirmed) iPhone, a video playing inline: pull it down slowly: the title, buttons and comments under it dim as you pull;
  let go early: they come back. Pull past a third (or tap the arrow): the page you came from fades in as the mini player lands.
  Tap the mini player: the page dims and the watch page fades back in under the picture. Try light mode too (it fades toward
  white). The picture itself never dims or goes black. Compare with the YouTube app side by side.

## The black picture after a pause (v1.361.0)

- [x] v1.361.0 - (Dean 2026-10-08: "seems done") iPhone, a video inline in the watch page: pause and play 20 times by TAPPING THE PICTURE (with a double-tap skip in a few), then the same in full screen and in the mini player. The picture never goes black. The play/pause icon still flashes on each tap, with a soft dark disc behind it (a little darker in dark mode), the pause bars centred on it. If it does go black: say so (the next step is no icon over the video).
- [x] v1.361.0 - (Dean 2026-10-08: "seems done") Background audio is as it was before v1.360: let a video start by itself, then lock the phone: the sound carries on.

## Mobile player edge to edge (v1.359.0)

- [x] v1.359.0 - (Dean 2026-10-08: "confirmed all") iPhone, portrait, a video in the watch page (not full screen): the picture touches both screen edges, square corners, no outline; the title and the buttons below keep their margin; the gap above the player is unchanged. Try a few eras (Settings > Appearance) and dark mode.
- [x] v1.359.0 - (Dean 2026-10-08: "confirmed all") Same with a song (cover art) and a tall Shorts-style video; then with Settings > Experimental custom controls ON: every control-bar button is there and full size.
- [x] v1.359.0 - (Dean 2026-10-08: "confirmed all") Press and hold the picture for 2x, drag down to lock, tap the pill; double-tap left and right to skip; a swipe from the left screen edge still goes back (Safari tab) and does not seek or pause.
- [x] v1.359.0 - (Dean 2026-10-08: "confirmed all") Scroll down so the player docks, then back to the video: the mini player looks as before and the full player returns edge to edge with no jump. Rotate to landscape and back while playing: full screen as before, then edge to edge again.
- [x] v1.359.0 - (Dean 2026-10-08: "confirmed all") Ambient on (dark mode): the glow still shows above and below the player; nothing scrolls sideways.

## Pocket music (v1.354.0)

- [x] v1.354.0 - (Dean 2026-10-08: "all good now") iPod Songs: scroll and letter-jump to the last songs (past H, to Z); Genres shows every genre; Shuffle Songs plays songs from the whole library; Liked lists every liked song.
- [x] v1.354.0 - (Dean 2026-10-08: "all good now") Controlling the speaker, Now Playing: the center button shows the PC's up-next list with the playing song marked; tap a song: the PC plays it. Before the PC has said its queue, the button does nothing (never a blank page).
- [x] v1.354.0 - (Dean 2026-10-08: "all good now") A Transparent skin: turn to landscape and back: the board lands in place in one step, and the skin lands in one step coming back upright (screen-record it with `?debugRotate=1` and send the rows if not; the upright half changed again in v1.357.0, see "Turn and speaker highlight"). Since v1.355.0 doable in the home-screen app: Settings > Troubleshooting > Show rotate debug log.
- [x] v1.354.0 - (Dean 2026-10-08: "all good now") Music > Search on the iPod: the wheel picks letters on the strip, center adds, MENU deletes; results narrow live; it looks like the iPod's own search on each iPod skin you use, the Original included.
- [x] v1.354.0 - (Dean 2026-10-08: "all good now") Search the skins list (Pocket Extras > Skins, Settings > Mobile player): typing a name narrows it.

## Rotate log switch and keyboard search (v1.355.0)

- [x] v1.355.0 - (Dean 2026-10-08: "all confirmed") In the HOME-SCREEN app: Settings > Troubleshooting > Show rotate debug log ON, go to Music, turn the phone: the green log appears. OFF: it is gone at once.
- [x] v1.355.0 - (Dean 2026-10-08: "all confirmed") Keyboard search OFF (the default): Music > Search on the iPod is the wheel letter strip, unchanged.
- [x] v1.355.0 - (Dean 2026-10-08: "all confirmed") Keyboard search ON (Settings > Mobile player): Music > Search brings up the phone's keyboard; typing narrows the results; NOTHING on screen moves, shrinks or zooms as the keyboard comes up or goes down (screen-record it with the rotate log ON and send the rows if anything does: each row now carries sy, vvo, vs and ae); Search key / Done puts the keyboard away and the wheel walks the results; MENU leaves Search. With the rotate log ON its green panel covers the lower part of the wheel: tap the panel's top edge to copy the rows, and turn the log off to use the wheel's bottom.

## Speaker resume (v1.356.0)

- [x] v1.356.0 - (Dean 2026-10-08: confirmed) Play on a speaker PC, swipe the app closed, reopen: it opens on the speaker, showing its song and place, with a
  "Playing on ..." toast; the PC kept playing undisturbed. Turn the PC's Remote control off, close and reopen the app: it opens on
  the phone, no message.

## Turn and speaker highlight (v1.357.0)

- [x] v1.357.0 - (Dean 2026-10-08: confirmed) Play on a speaker PC, pick a song from an album, MENU back to the album: the speaker's song is marked; when the PC
  moves to the next song, the mark moves too.

## Only if it comes back

- [ ] v1.344.2 - On the phone, a video with chapters: watch to the middle of a later chapter, tap Listen;
  it carries on from that spot in that chapter (not chapter 1). Then Watch again: still the same spot.
  Repeat PAUSED: pause on Watch, tap Listen (still paused, same spot), then Watch (still paused).

## Resume prompt (v1.363.0)

- [x] v1.363.0 - (Dean 2026-10-08: confirmed) Ask me: R and S on a keyboard work. Length 0: it resumes at once with no prompt. Default choice "Start from
  beginning": it starts over. Countdown off: the prompt waits.
- [x] v1.363.0 - (Dean 2026-10-08: confirmed) Ask me: a prompt up, then minimize: it resumes in the mini player. Back to "Resume automatically": the "Resumed at"
  note as before. Music, podcasts, a TV episode and an autoplay next never ask.

## Chapters from audio and the pop-out, Watch in the pop-out (v1.363.1)

- [x] v1.363.1 - (Dean 2026-10-08: "good") Desktop pop-out (music): its sticker menu shows "Add chapters" / "Edit chapters" and, for a video file played as
  audio, "Watch". The chapter editor opens IN the pop-out window (not behind it). Watch brings the main window forward on the watch
  page at the same spot. An audio-only mp3 shows no Watch row. Also: a very small pop-out window, does the menu clip.
- [x] v1.363.1 - (Dean 2026-10-08: "good") Add chapters on a chapterless mp3 (a long mix) from the music player's Extras (desktop actions menu and phone):
  type a few "0:00 Title" lines, Save. Chapter tracks appear after the list re-opens and on the next pick; the song playing now keeps
  playing; resume works inside a chapter. Close the pop-out while a save is in flight: nothing odd.
- [x] v1.363.1 - (Dean 2026-10-08: "good") Watch page settings cog (a chapterless video): "Add chapters" opens the same editor; with chapters it says "Edit
  chapters". The row is plain weight at the end of the menu; say if it looks out of place. The sticker menu's new rows match the old.

## Music radio and Shuffle (v1.368.0)

- [x] v1.368.0 - (Dean 2026-10-08: "good") An hour of Autoplay from a song (let an album or a single song run out): the station stays in that song's
  genre and nearby artists, drifts gently, and never plays one artist three times in a row. Say if anything jumps genre.
- [x] v1.368.0 - (Dean 2026-10-08: "good") Start radio from an artist (its page's Radio button, or the iPod's Artists > artist, last row), an album, and a
  genre (the iPod's Genres > genre, last row), and from a song's row menu (desktop) or the sticker menu (phone). Each replaces
  the queue; if Autoplay was off it turns on with a note.
- [x] v1.368.0 - (Dean 2026-10-08: "good") A DJ-set chapter the radio picks plays THAT chapter and moves on (it never rolls on through the rest of the set);
  a station started from a DJ channel stays on that channel, mixing its sets.
- [x] v1.368.0 - (Dean 2026-10-08: "good") Shuffle (the desktop chip beside Loop and Autoplay, the sticker row on the phone, the pop-out): on, the songs
  after the playing one change order and the list shows the new order; off, they go back. Turn it on on the phone: the desktop
  picks it up at the next song. Start an album with Shuffle on: it plays shuffled. Radio songs stay after your own songs.
- [x] v1.368.0 - (Dean 2026-10-08: "good") Start a radio, minimize to the mini player, tap it to come back: the station continues (Next plays a radio
  song, not the song's album).
- [x] v1.368.0 - (Dean 2026-10-08: "good") A long Autoplay session (several hours): it never stops while the library has songs; at most a single batch
  from an unrelated genre late in a very long session (disclosed, tracker #291).

## The iPod stays upright (v1.369.0)

- [x] v1.369.0 - (Dean 2026-10-08: "good") In the home-screen app, open the iPod (Now Playing) and turn the phone to the LEFT (its top to the left): the iPod
  stays upright in your hand, the same size, MENU at the top of the wheel as you hold it. Then to the RIGHT: the same. If it is
  ever upside down, say which way you turned.
- [x] v1.369.0 - (Dean 2026-10-08: "good") Sideways: scroll the wheel, press MENU / play / skip, hold the centre, scrub the time bar, change the volume
  (speaker), drag the up-next list, swipe right across the iPod to go back. Each works as in portrait; the wheel's tick (haptic)
  still lands under your thumb.
- [x] v1.369.0 - (Dean 2026-10-08: "good") The turn itself: any flash of a big screen or a missing wheel while it turns? Flip straight from left to right
  over the top: how long the iPod shows upside down before it rights itself.
- [x] v1.369.0 - (Dean 2026-10-08: "good") The notch / Dynamic Island side and the home bar: nothing of the iPod sits under them in either direction; say if
  the iPod looks shorter than in portrait.
- [x] v1.369.0 - (Dean 2026-10-08: "good") Settings > Mobile player > Keep the iPod upright OFF: turning the phone gives the old side-by-side layout; ON
  again: upright. The iPod's own Settings > Stay Upright does the same.
- [x] v1.369.0 - (Dean 2026-10-08: "good") Cider and Nordic stay upright too; the Transparent skins' board photo turns with the iPod; a video and the browse
  pages still turn with the phone.
- [x] v1.369.0 - (Dean 2026-10-08: "good") Known and left as is: a dialog, a toast or the keyboard (keyboard search) opened while sideways appears sideways
  to the iPod. Say if that is worth fixing.

## Playlists (v1.370.0)

- [x] v1.370.0 - (Dean 2026-10-08: "good") iPhone: share a YouTube video that is in a playlist from the YouTube app to the FileTube Shortcut. The reply says
  "Playlist found: open FileTube to choose"; a push arrives (if notifications are on). Tap it: the home-screen app opens the
  choice; Choose videos -> pick 3 -> Download. One row counts to 3; each video lands in its channel's folder.
- [x] v1.370.0 - (Dean 2026-10-08: "good") Without the push: open the app, the download indicator says "Playlist waiting: choose videos"; Choose -> the
  picker (Format / Quality / File type above the list). Dismiss removes it.
- [x] v1.370.0 - (Dean 2026-10-08: "good") The download box on the phone and on desktop: paste a video-in-playlist link -> "Just this video" downloads one;
  "Choose videos" -> the picker; a long playlist shows Load more; a video already in your library is marked and not tickable.
- [x] v1.370.0 - (Dean 2026-10-08: "good") Subscriptions > Add with a video-in-playlist link asks: "Subscribe to playlist" subscribes to the whole list.
- [x] v1.370.0 - (Dean 2026-10-08: "good") Desktop extension (reload it first: chrome://extensions, the reload icon): on a video in a playlist, Audio /
  Video download that one video and "Choose from playlist..." opens the picker in a new tab; on a playlist page Audio / Video
  are off.

## Save as an album (v1.371.0)

- [x] v1.371.0 - (Dean 2026-10-08: "good") Pick a few songs from an artist's playlist (one not already in your library), Format Audio: turn on Save as an
  album, check the two filled-in names (and the "Already in Music" note), turn on Clean up titles, Download. In Music the songs
  are ONE album under the album artist, numbered in playlist order, titles without "Artist - " or [Official Audio].
- [x] v1.371.0 - (Dean 2026-10-08: "good") On the phone the album switches and fields look like the rest of the app (no new styles); a quick double tap on
  the switch right as the picker opens does nothing.
- [x] v1.371.0 - (Dean 2026-10-08: "good") With File type Opus the album switch is not offered.

## Song names and the music switch (v1.372.0) - confirmed by Dean 2026-10-07

- [x] v1.372.0 - Picker, Format Audio, Save as an album and Clean up titles on: each song shows its cleaned name and
  "Track N"; tap a name, rename it, Download. In Music AND in the library list the song has that name.
- [x] v1.372.0 - Settings > Show music in the home feed OFF, then Home (and Back to Home): no songs on the home page, the
  Modern mode Audio chip included; Continue listening still shows; the song's folder and search still find it; a video's
  Related list still offers songs. ON brings them back. (Confirmed by Dean 2026-10-07 - "it literally worked" - then
  REMOVED in v1.373.0 at his ruling, for the picker's per-download Hide from feed.)
- [x] v1.372.0 - Desktop: right-click a card > Move to Trash, press Enter: the menu does NOT come back (Enter does nothing
  on the confirm; Esc cancels; click Move to Trash to confirm).

## Hide from feed and album track numbers (v1.373.0) - partly confirmed by Dean 2026-10-07

- [x] v1.373.0 - Settings no longer has "Show music in the home feed".
- [x] v1.373.0 - Playlist picker, any format: tick "Hide from feed", download a few songs you do not have yet. No bell or
  push per song; in Modern mode the songs are not in your feed, and Settings > Hidden from feed lists them (Unhide works);
  Music, the folder and search still show them. Without the box they show in the feed as usual, still without a bell.
- [x] v1.373.0 (Dean 2026-10-07: "Can confirm the hide works. Notification works. on iPhone it all displays beautifully.
  Show music in home feed is gone exactly.")
- [x] v1.373.0 - FOLLOW-UP (Dean 2026-10-07; addressed in v1.374.0, checks below): desktop Music shows no visible way to sort, and a downloaded album on desktop
  is not in track order; on iPhone, Recent Artists / Recent Albums rows show no artist or album line under them. See
  ROADMAP Planned > Features "Music follow-ups after v1.373.0".
- [ ] v1.373.0 - Music > Albums > a downloaded album: rows read "Track 1", "Track 2"... (if not, pick "Album order" in the
  sort menu once - the album sort is remembered). On the iPod: Artists > the artist > that album plays in track order.

## Sort in any album, iPod artist lines, one album cover (v1.374.0)

- [x] v1.374.0 - (Dean 2026-10-08: "sort is good") Desktop and iPhone: Music home > tap an album in a shelf. The sort menu shows on the album page; if it
  does not say "Album order", pick it once and the songs read Track 1, 2, 3 in order. If it already says Album order and the
  songs are still out of order, tell me (that album's files would lack track numbers).
- [x] v1.374.0 - (Dean 2026-10-08: "iPod lines good") iPhone iPod: Music > Recent Albums shows the artist under each album; Recent Artists shows the album you
  last played under each artist; Albums shows the artist under each album.
- [x] v1.374.0 - (Dean 2026-10-08: good; every file carries the cover - his probe - but one Music row kept the old art: v1.376.0 W6) Playlist picker, Format Audio, Save as an album on: tap Cover, pick a song (names only in the menu - is
  that enough?), download. Every new song of that album shows that one picture in Music (album card, song rows, iPod) on
  desktop and phone. With "Each song's own art" nothing changes. An older video's cover can be a smaller square.

## Radio that feels like radio (v1.375.0)

- [x] v1.375.0 - (Dean 2026-10-08: "Radio much better") Music > a Kirby album (e.g. a NESTALGIA or Vapid Kirby set) > Radio, right after playing some pop: the
  first songs are Kirby music from several channels, then other game music; no Prince or pop for a long while. Same from a
  Kirby song's Start radio and when Autoplay continues after the album. (Soundzantium / PSK Kirby sets may not appear:
  their channels file under YouTube "Music", by your round-3 choice.)

## Watch later from a notification, podcast options, device-pass fixes (v1.376.0)

- [x] v1.376.0 - (Dean 2026-10-08: "it all works") iPhone + desktop: the bell > a new video's row > kebab (or long-press / right-click) > Watch later: the video
  is in Watch later, the row is gone, the video did not open. Same on a podcast episode's row.
- [x] v1.376.0 - (Dean 2026-10-08: "it all works") Desktop Chrome: a new-video push shows a "Watch later" button doing the same (the iPhone shows no button:
  Safari has none; use the bell there).
- [x] v1.376.0 - (Dean 2026-10-08: "it all works") A podcast episode: Watch later and Delete (with its confirm) in the bell; Watch later, Share and Move to Trash
  on a home / search card; Watch later and Share in the show's episode list. Watch later lists it and plays it; playing it to
  the end removes it from Watch later.
- [x] v1.376.0 - (Dean 2026-10-08: "it all works") Filter the home feed to Audio, open a video, tap its channel name: the channel shows its videos; back on Home
  the filter is still Audio. A folder the filter empties says "No audio here" with "Show all".
- [x] v1.376.0 - (Dean 2026-10-08: "it all works"; the Listen Control bar's STYLE is a follow-up) iPhone, music playing on the Mac, a video in the mini player: the Listening on... card is a slim bar above the
  mini player; both fully visible and tappable.
- [x] v1.376.0 - (Dean 2026-10-08: "good"; Ambient OFF makes the line go away, so the cause is the ambient glow: ROADMAP Planned) iPhone watch page, the line under the controls: turn Ambient OFF in the player's cog (or light mode) and look.
  Gone = tell me (the glow's bloom is the cause). Still there = Settings > lifecycle log on, play with the line on screen,
  Export the log and send it.
- [x] v1.376.0 - (Dean 2026-10-08: "it all works") Save a playlist as an album with a Cover, skipping a song: every song shows that cover in every Music view
  (iPod menus and artist rows included) on desktop and phone without a hard refresh; the songs read Track 1..N with no gap.

## The Continue here card beside the mini player, Pocket art, "Pocket" (v1.377.0)

- [x] v1.377.0 - (Dean 2026-10-08: "good") iPhone, music playing (or paused) on the Mac, a video in the mini player on Home: the "Paused watching on /
  Work MacBook Air" card sits directly LEFT of the mini player, the same height, nothing of the feed hidden above them;
  Continue here and the X work; closing the mini player brings back the normal card.
- [x] v1.377.0 - (Dean 2026-10-08: "good") iPhone, nothing playing (also with a podcast or video paused): tap Music, then Music again to open Pocket:
  the main menu's right side shows album covers drifting within a couple of seconds, never the disc with "Music".
- [x] v1.377.0 - (Dean 2026-10-08: "good") The Music page button reads "Pocket"; Settings > Mobile player says "Keep Pocket upright"; no "iPod"
  anywhere you can read in the app.

## Feed polish (v1.380.0)

Home-screen app on the iPhone. Have a book you have never opened, a subscription with videos you have not watched and a podcast with a new episode.

- [ ] v1.380.0 - Settings > any long page (Mobile player is the longest): scroll to the bottom; the back arrow and the page title stay pinned
  under the app header the whole way, rows slide under them, and the arrow still goes back. Try a short page and a landscape turn.
- [ ] v1.380.0 - Settings > Personalize has a "Bottom bar" page right after Mobile player: drag to reorder, switch items off and on. Mobile player no longer has it.
- [ ] v1.380.0 - Start a Feed session (your first three on this phone): a small "Swipe up" cue sits at the bottom of the first card and fades when you
  swipe or after about 4 seconds. The fourth session shows none.
- [ ] v1.380.0 - A book you never opened comes as "Start something new": cover, author, what it is about, no pages of text until you tap "Read the opening"
  (its first real chapter, not the cover or copyright page). Swipe away without tapping anything, then open the book in the reader: it opens at the very start, as unstarted
  (not under "currently reading"). Only one such card per session.
- [ ] v1.380.0 - "Start reading" on that card: the reader opens at the first real chapter; the book is now one you are reading and its next feed card continues from there.
- [ ] v1.380.0 - Video and podcast cards read "Continue" or "New from <channel>" / "New episode of <show>" (Watch later keeps its word). Expect about one New for every two Continue.
- [ ] v1.380.0 - Swipe past a NEW video after about 10 seconds: it is not under Continue watching afterwards and not marked watched. Stay on a new one for over a minute: it is.
- [ ] v1.380.0 - A new video that starts with an intro chapter opens after it with "Skipped the intro" for 3 seconds; tap it to go back to the start.

## Feed mode (v1.379.0)

Home-screen app on the iPhone, a book you are partway through, a podcast in progress, a few subscriptions, some liked songs.

- [ ] v1.379.0 - The bottom bar has Feed (after Liked on an untouched bar, so beside Home; appended after your own items if you ever
  reordered the bar - Settings lists it either way); the sidebar has Feed under Library, and so does the phone's Playlists sheet. Tap it: the length picker, your last pick highlighted, and "This week: ..." once a session exists.
- [ ] v1.379.0 - Pick 10 min. Cards arrive; swipe up through five: the kind label, a book's text (plain, readable, "Open in reader"), a
  podcast's art with "4:00 of this episode", a video's chapter line, a Watch later label, a song's art. Never the same kind twice in a row.
- [ ] v1.379.0 - A video card plays WITH sound from its saved place inside its card (no second player, no black picture after the swipe
  from the previous card); the "left" readout counts down; at the slice end it pauses and says Done. Swipe to the next media card:
  the previous one is paused, the new one plays in ITS card. Then tap the mini player / go to the watch page: the position carried.
- [ ] v1.379.0 - A podcast card resumes at the saved place and plays 4 minutes; the podcasts page afterwards shows the moved place.
- [ ] v1.379.0 - A book card: read it (stay about a minute on a 450-word card), swipe on, then open the book in the reader: it opens on
  the page that holds the next unread paragraph (the first paragraph of the card after it). Open the same book on another device
  first, read on, then let the feed card finish: the toast "Your place in ... moved on another device" and the place is NOT moved back.
- [ ] v1.379.0 - A book card you SKIP (swipe on within a few seconds): the reader still opens where you were, and that book does not
  come back in this session until you read or open it (gate r1: a skipped card never puts unread pages behind your place).
- [ ] v1.379.0 - While a video card plays, leave the feed and open that video from Home (the player carries over), drag the scrubber BACK and pause: the
  watch page keeps that earlier place (gate r1: the feed's forward-only rule stays in the feed).
- [ ] v1.379.0 - The ring in the corner fills as the time runs; tap it: "m:ss left" for 3 s. When time is up mid-podcast the slice finishes
  (at most 2 more minutes) and the recap opens; when time is up on a book card the recap opens on your next swipe.
- [ ] v1.379.0 - The recap: the minutes, "N pages of <book>", "N chapters of <video>" or "N min of <video>", "N min of <episode>", "N songs";
  a TAP on "Another 10 minutes" does nothing; a HOLD (about a second, the button fills) adds ten minutes and the feed goes on; the next
  recap says ", extended once". Done returns to the page you came from.
- [ ] v1.379.0 - iOS reparent caveat (D7): a playing video moved from one card's slot to the next keeps playing; the lock screen shows the
  card's title; backgrounding mid-card behaves like the watch page (the sidecar handoff).
- [ ] v1.379.0 - After a week of using the feed: note your Reddit time in iOS Screen Time before and after (the plan's success measure).

## Radio stations, play counts, Radio in Pocket (v1.378.0)

- [ ] v1.378.0 - Music page: a Stations shelf sits above Recently added. Tap a station (a genre, a style like Chill or Reggae, or
  Recently added): the first 20 songs are that kind and the line above the player says "Radio: <name>". If a station you
  expect is missing, say which: a generated station needs 40 songs from 3 artists in your library.
- [ ] v1.378.0 - "New station" at the end of the shelf: name it, add an artist or a word (lofi), watch the count change as you type,
  Create: it is on the shelf and plays. Edit it from its menu; "Stay strict" on: it only ever plays those songs (and repeats them
  when they run out). Delete it. Hide a generated station from its menu: it moves under "More stations" marked Hidden; Unhide it
  there.
- [ ] v1.378.0 - Pocket: Main menu > Radio (right after Music) lists the same stations; pick one: it plays and the Click LCD's album
  line reads "Radio: <name>" (Cider and Nordic show it over the title). Minimize and come back: the line stays and Next keeps to
  the station. On a 320-wide phone a long station name ellipsizes on that line, like a long album name.
- [ ] v1.378.0 - Speakers: choose the PC, then Radio > a station: it starts ON the PC (the PC's page says "Radio: <name>" and its
  queue keeps filling from that station); your phone's mirror shows the same line.
- [ ] v1.378.0 - After a day of listening: Favorites holds your liked songs plus what you played 3+ times to the end (its subtitle stops
  saying "Builds as you listen"), Deep cuts appears (songs you rarely play by artists you do play), and a song you skipped three
  times stops coming up on the radio. Say if a skipped song keeps coming back.
