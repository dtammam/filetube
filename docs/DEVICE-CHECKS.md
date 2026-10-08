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

- [ ] v1.362.4 - iPhone, a video playing inline: pull it down slowly: the title, buttons and comments under it dim as you pull;
  let go early: they come back. Pull past a third (or tap the arrow): the page you came from fades in as the mini player lands.
  Tap the mini player: the page dims and the watch page fades back in under the picture. Try light mode too (it fades toward
  white). The picture itself never dims or goes black. Compare with the YouTube app side by side.

## The black picture after a pause (v1.361.0)

- [ ] v1.361.0 - iPhone, a video inline in the watch page: pause and play 20 times by TAPPING THE PICTURE (with a double-tap skip in a few), then the same in full screen and in the mini player. The picture never goes black. The play/pause icon still flashes on each tap, with a soft dark disc behind it (a little darker in dark mode), the pause bars centred on it. If it does go black: say so (the next step is no icon over the video).
- [ ] v1.361.0 - Background audio is as it was before v1.360: let a video start by itself, then lock the phone: the sound carries on.

## Mobile player edge to edge (v1.359.0)

- [ ] v1.359.0 - iPhone, portrait, a video in the watch page (not full screen): the picture touches both screen edges, square corners, no outline; the title and the buttons below keep their margin; the gap above the player is unchanged. Try a few eras (Settings > Appearance) and dark mode.
- [ ] v1.359.0 - Same with a song (cover art) and a tall Shorts-style video; then with Settings > Experimental custom controls ON: every control-bar button is there and full size.
- [ ] v1.359.0 - Press and hold the picture for 2x, drag down to lock, tap the pill; double-tap left and right to skip; a swipe from the left screen edge still goes back (Safari tab) and does not seek or pause.
- [ ] v1.359.0 - Scroll down so the player docks, then back to the video: the mini player looks as before and the full player returns edge to edge with no jump. Rotate to landscape and back while playing: full screen as before, then edge to edge again.
- [ ] v1.359.0 - Ambient on (dark mode): the glow still shows above and below the player; nothing scrolls sideways.

## Pocket music (v1.354.0)

- [ ] v1.354.0 - iPod Songs: scroll and letter-jump to the last songs (past H, to Z); Genres shows every genre; Shuffle Songs plays songs from the whole library; Liked lists every liked song.
- [ ] v1.354.0 - Controlling the speaker, Now Playing: the center button shows the PC's up-next list with the playing song marked; tap a song: the PC plays it. Before the PC has said its queue, the button does nothing (never a blank page).
- [ ] v1.354.0 - A Transparent skin: turn to landscape and back: the board lands in place in one step, and the skin lands in one step coming back upright (screen-record it with `?debugRotate=1` and send the rows if not; the upright half changed again in v1.357.0, see "Turn and speaker highlight"). Since v1.355.0 doable in the home-screen app: Settings > Troubleshooting > Show rotate debug log.
- [ ] v1.354.0 - Music > Search on the iPod: the wheel picks letters on the strip, center adds, MENU deletes; results narrow live; it looks like the iPod's own search on each iPod skin you use, the Original included.
- [ ] v1.354.0 - Search the skins list (Pocket Extras > Skins, Settings > Mobile player): typing a name narrows it.

## Rotate log switch and keyboard search (v1.355.0)

- [ ] v1.355.0 - In the HOME-SCREEN app: Settings > Troubleshooting > Show rotate debug log ON, go to Music, turn the phone: the green log appears. OFF: it is gone at once.
- [ ] v1.355.0 - Keyboard search OFF (the default): Music > Search on the iPod is the wheel letter strip, unchanged.
- [ ] v1.355.0 - Keyboard search ON (Settings > Mobile player): Music > Search brings up the phone's keyboard; typing narrows the results; NOTHING on screen moves, shrinks or zooms as the keyboard comes up or goes down (screen-record it with the rotate log ON and send the rows if anything does: each row now carries sy, vvo, vs and ae); Search key / Done puts the keyboard away and the wheel walks the results; MENU leaves Search. With the rotate log ON its green panel covers the lower part of the wheel: tap the panel's top edge to copy the rows, and turn the log off to use the wheel's bottom.

## Speaker resume (v1.356.0)

- [ ] v1.356.0 - Play on a speaker PC, swipe the app closed, reopen: it opens on the speaker, showing its song and place, with a
  "Playing on ..." toast; the PC kept playing undisturbed. Turn the PC's Remote control off, close and reopen the app: it opens on
  the phone, no message.

## Turn and speaker highlight (v1.357.0)

- [ ] v1.357.0 - Play on a speaker PC, pick a song from an album, MENU back to the album: the speaker's song is marked; when the PC
  moves to the next song, the mark moves too.

## Only if it comes back

- [ ] v1.344.2 - On the phone, a video with chapters: watch to the middle of a later chapter, tap Listen;
  it carries on from that spot in that chapter (not chapter 1). Then Watch again: still the same spot.
  Repeat PAUSED: pause on Watch, tap Listen (still paused, same spot), then Watch (still paused).

## Resume prompt (v1.363.0)

- [ ] v1.363.0 - Ask me: R and S on a keyboard work. Length 0: it resumes at once with no prompt. Default choice "Start from
  beginning": it starts over. Countdown off: the prompt waits.
- [ ] v1.363.0 - Ask me: a prompt up, then minimize: it resumes in the mini player. Back to "Resume automatically": the "Resumed at"
  note as before. Music, podcasts, a TV episode and an autoplay next never ask.

## Chapters from audio and the pop-out, Watch in the pop-out (v1.363.1)

- [ ] v1.363.1 - Desktop pop-out (music): its sticker menu shows "Add chapters" / "Edit chapters" and, for a video file played as
  audio, "Watch". The chapter editor opens IN the pop-out window (not behind it). Watch brings the main window forward on the watch
  page at the same spot. An audio-only mp3 shows no Watch row. Also: a very small pop-out window, does the menu clip.
- [ ] v1.363.1 - Add chapters on a chapterless mp3 (a long mix) from the music player's Extras (desktop actions menu and phone):
  type a few "0:00 Title" lines, Save. Chapter tracks appear after the list re-opens and on the next pick; the song playing now keeps
  playing; resume works inside a chapter. Close the pop-out while a save is in flight: nothing odd.
- [ ] v1.363.1 - Watch page settings cog (a chapterless video): "Add chapters" opens the same editor; with chapters it says "Edit
  chapters". The row is plain weight at the end of the menu; say if it looks out of place. The sticker menu's new rows match the old.

## Music radio and Shuffle (v1.368.0)

- [ ] v1.368.0 - An hour of Autoplay from a song (let an album or a single song run out): the station stays in that song's
  genre and nearby artists, drifts gently, and never plays one artist three times in a row. Say if anything jumps genre.
- [ ] v1.368.0 - Start radio from an artist (its page's Radio button, or the iPod's Artists > artist, last row), an album, and a
  genre (the iPod's Genres > genre, last row), and from a song's row menu (desktop) or the sticker menu (phone). Each replaces
  the queue; if Autoplay was off it turns on with a note.
- [ ] v1.368.0 - A DJ-set chapter the radio picks plays THAT chapter and moves on (it never rolls on through the rest of the set);
  a station started from a DJ channel stays on that channel, mixing its sets.
- [ ] v1.368.0 - Shuffle (the desktop chip beside Loop and Autoplay, the sticker row on the phone, the pop-out): on, the songs
  after the playing one change order and the list shows the new order; off, they go back. Turn it on on the phone: the desktop
  picks it up at the next song. Start an album with Shuffle on: it plays shuffled. Radio songs stay after your own songs.
- [ ] v1.368.0 - Start a radio, minimize to the mini player, tap it to come back: the station continues (Next plays a radio
  song, not the song's album).
- [ ] v1.368.0 - A long Autoplay session (several hours): it never stops while the library has songs; at most a single batch
  from an unrelated genre late in a very long session (disclosed, tracker #291).

## The iPod stays upright (v1.369.0)

- [ ] v1.369.0 - In the home-screen app, open the iPod (Now Playing) and turn the phone to the LEFT (its top to the left): the iPod
  stays upright in your hand, the same size, MENU at the top of the wheel as you hold it. Then to the RIGHT: the same. If it is
  ever upside down, say which way you turned.
- [ ] v1.369.0 - Sideways: scroll the wheel, press MENU / play / skip, hold the centre, scrub the time bar, change the volume
  (speaker), drag the up-next list, swipe right across the iPod to go back. Each works as in portrait; the wheel's tick (haptic)
  still lands under your thumb.
- [ ] v1.369.0 - The turn itself: any flash of a big screen or a missing wheel while it turns? Flip straight from left to right
  over the top: how long the iPod shows upside down before it rights itself.
- [ ] v1.369.0 - The notch / Dynamic Island side and the home bar: nothing of the iPod sits under them in either direction; say if
  the iPod looks shorter than in portrait.
- [ ] v1.369.0 - Settings > Mobile player > Keep the iPod upright OFF: turning the phone gives the old side-by-side layout; ON
  again: upright. The iPod's own Settings > Stay Upright does the same.
- [ ] v1.369.0 - Cider and Nordic stay upright too; the Transparent skins' board photo turns with the iPod; a video and the browse
  pages still turn with the phone.
- [ ] v1.369.0 - Known and left as is: a dialog, a toast or the keyboard (keyboard search) opened while sideways appears sideways
  to the iPod. Say if that is worth fixing.

## Playlists (v1.370.0)

- [ ] v1.370.0 - iPhone: share a YouTube video that is in a playlist from the YouTube app to the FileTube Shortcut. The reply says
  "Playlist found: open FileTube to choose"; a push arrives (if notifications are on). Tap it: the home-screen app opens the
  choice; Choose videos -> pick 3 -> Download. One row counts to 3; each video lands in its channel's folder.
- [ ] v1.370.0 - Without the push: open the app, the download indicator says "Playlist waiting: choose videos"; Choose -> the
  picker (Format / Quality / File type above the list). Dismiss removes it.
- [ ] v1.370.0 - The download box on the phone and on desktop: paste a video-in-playlist link -> "Just this video" downloads one;
  "Choose videos" -> the picker; a long playlist shows Load more; a video already in your library is marked and not tickable.
- [ ] v1.370.0 - Subscriptions > Add with a video-in-playlist link asks: "Subscribe to playlist" subscribes to the whole list.
- [ ] v1.370.0 - Desktop extension (reload it first: chrome://extensions, the reload icon): on a video in a playlist, Audio /
  Video download that one video and "Choose from playlist..." opens the picker in a new tab; on a playlist page Audio / Video
  are off.

## Save as an album (v1.371.0)

- [ ] v1.371.0 - Pick a few songs from an artist's playlist (one not already in your library), Format Audio: turn on Save as an
  album, check the two filled-in names (and the "Already in Music" note), turn on Clean up titles, Download. In Music the songs
  are ONE album under the album artist, numbered in playlist order, titles without "Artist - " or [Official Audio].
- [ ] v1.371.0 - On the phone the album switches and fields look like the rest of the app (no new styles); a quick double tap on
  the switch right as the picker opens does nothing.
- [ ] v1.371.0 - With File type Opus the album switch is not offered.

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
