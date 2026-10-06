# Device checks (the rolling list)

One list of what Dean taps on his phone or desktop to confirm a release, grouped by area. Each line
carries the version that introduced it. A release appends its checks here instead of adding a tracker
row; a line is deleted when Dean has confirmed it, and a line that fails becomes a bug (in the tracker or
ROADMAP.md Planned > Bugs). Tracker row #284 points here for its open check (the v1.336 black picture, now the v1.361.0 checks).

## Whole app, layout and dialogs

## Minimize into the mini player (v1.362.0)

Settings > Mobile player > "Use custom player controls on touch devices" ON for all of these.

- [ ] v1.362.0 - iPhone, inline video playing: pull down slowly and let go early (springs back, still playing); pull past a third (docks bottom-right, still playing, the page is where you browsed from). Watch the picture during and after the drag: if it goes black or freezes while the sound runs on, open the same page in a SAFARI TAB with `?minimizeAnim=0` and repeat (the switch is a URL parameter; the home-screen app has no address bar). Black with the animation and fine without = the moving picture is the trigger.
- [ ] v1.362.0 - Tap the down-chevron at the picture's top-left (since v1.362.1 it shows while paused, or for about 3 s after play or a touch on the picture): same end state. Then tap the mini player: back to the watch page, same position, still playing. Open a video from another video (a related card), minimize: you land on the feed / search you started from, and the second video keeps playing.
- [ ] v1.362.0 - The mini player's X and play/pause: hit each with a thumb ten times without a mis-tap into "expand". With captions on, they sit above the bar.
- [ ] v1.362.0 - Regressions: tap pauses, double-tap skips, hold 2x, hold-drag-down locks 2x, swipe right goes back, scroll the page from below the picture, full screen untouched. (Since v1.362.3 a finger that starts on the picture never scrolls the page: scrolled down, a pull on the picture does nothing, so the old "scroll down then pull on the picture" and "wiggle then drag up" steps no longer apply.)
- [ ] v1.362.0 - Home-screen app AND Safari tab: in the Safari tab the pull at the top fights the browser's own overscroll; report which wins (since v1.362.3 the browser never gets a touch that starts on the picture).

## The minimize chevron peeks (v1.362.1)

Settings > Mobile player > "Use custom player controls on touch devices" ON for all of these.

- [ ] v1.362.1 - Tap to pause and lock the phone at once: does the pause still happen? (A tap waiting out the double-tap window now ends with backgrounding.)
- [ ] v1.362.1 - VoiceOver on, a video playing: rest the VoiceOver cursor on the chevron; does it stay, or vanish after about 3 s?
- [ ] v1.362.1 - Follow `docs/references/vpn-slowness-runbook.md` once; tell Claude where it was unclear, and send the run ids.

## No loupe on any hold; the black-picture tests (v1.362.3)

Settings > Mobile player > "Use custom player controls on touch devices" ON for all of these. (The v1.362.2 loupe line failed on
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

Settings > Mobile player > "Use custom player controls on touch devices" ON.

- [ ] v1.362.4 - iPhone, a video playing inline: pull it down slowly: the title, buttons and comments under it dim as you pull;
  let go early: they come back. Pull past a third (or tap the arrow): the page you came from fades in as the mini player lands.
  Tap the mini player: the page dims and the watch page fades back in under the picture. Try light mode too (it fades toward
  white). The picture itself never dims or goes black. Compare with the YouTube app side by side.

## The black picture after a pause (v1.361.0)

- [ ] v1.361.0 - iPhone, a video inline in the watch page: pause and play 20 times by TAPPING THE PICTURE (with a double-tap skip in a few), then the same in full screen and in the mini player. The picture never goes black. The play/pause icon still flashes on each tap, with a soft dark disc behind it (a little darker in dark mode), the pause bars centred on it. If it does go black: say so (the next step is no icon over the video).
- [ ] v1.361.0 - Background audio is as it was before v1.360: let a video start by itself, then lock the phone: the sound carries on.

## Mobile player edge to edge (v1.359.0)

- [ ] v1.359.0 - iPhone, portrait, a video in the watch page (not full screen): the picture touches both screen edges, square corners, no outline; the title and the buttons below keep their margin; the gap above the player is unchanged. Try a few eras (Settings > Appearance) and dark mode.
- [ ] v1.359.0 - Same with a song (cover art) and a tall Shorts-style video; then with Settings > Mobile player custom controls ON: every control-bar button is there and full size.
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

## Stuck or stale downloads (v1.365.0)

- [ ] v1.365.0 - Start a one-off download, then stop FileTube (or turn off Wi-Fi): the corner chip and /subscriptions say "Can't
  reach FileTube" (on a computer, "last reached N ago" too) and the rows keep their last state; bring it back: the line goes away
  by itself.
- [ ] v1.365.0 - If a download looks stuck: a Downloading row says "updated N ago" after a minute or more; a Queued row says
  "waiting N". Note which you see before restarting anything.
- [ ] v1.365.0 - In the HOME-SCREEN app, as an admin: Settings > Troubleshooting > Download trace saves (or offers to share) a
  .txt with your recent one-off downloads, hosts only, no full links. Say if the tap does nothing.

## 360 view (v1.366.0)

Settings > Mobile player > "Use custom player controls on touch devices" ON for the phone checks; turn on the 360 view in the
player's settings cog on a 360 video. Owners: Video type sets a video by hand.

- [ ] v1.366.0 - iPhone FIRST: one 360 video inline, 360 view on: does the picture stay live while you drag? If it goes black,
  that is a 360-only finding (keep it apart from the open black-picture bug): say so and Export log.
- [ ] v1.366.0 - Drag direction feels right (drag left, the view turns as if you turned right). Turn on "Move to look": turning the
  phone turns the view the same way (iOS asks for motion access on that tap).
- [ ] v1.366.0 - The phone's own full screen and picture in picture show the flat picture, with the matching note when you come
  back. Then, sphere up, rotate to landscape while playing, 5 times: the sphere stays and NO note shows.
- [ ] v1.366.0 - Video type > Flat removes the sphere; Auto brings it back. A normal (flat) video shows no 360 row at all.
- [ ] v1.366.0 - In the container: add a new 360 file, let the scan run: it shows the 360 row (the server's ffprobe reads the tag).
