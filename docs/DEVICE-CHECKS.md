# Device checks (the rolling list)

One list of what Dean taps on his phone or desktop to confirm a release, grouped by area. Each line
carries the version that introduced it. A release appends its checks here instead of adding a tracker
row; a line is deleted when Dean has confirmed it, and a line that fails becomes a bug (in the tracker or
ROADMAP.md Planned > Bugs). Tracker row #284 points here for its open check (the v1.336 black picture, now the v1.360.0 checks).

## Whole app, layout and dialogs

- [ ] v1.341.3 - Turn the phone back upright on the watch page: it settles in one step, no bump (one rotate
  with `?debugLifecycle=1`; the log shows the scroll).
- [ ] v1.350.0 - THE TURN BACK (still open): open `?debugRotate=1`, play in Pocket, turn to landscape and back to upright while
  screen-recording, then tap the green panel to copy the rows and send them. The giant-LCD flash and the 20 px dip are NOT fixed
  in this release; the log names the cause. (2026-10-02: Dean's screen recording measured the turn frame by frame; see
  ROADMAP Planned > Bugs, "Pocket turn". The log is still wanted for the fix.) v1.357.0 changed the turn: its check is under "Turn and speaker highlight" below, and covers this one. Since v1.355.0 this can be done in the
  HOME-SCREEN app: Settings > Troubleshooting > Show rotate debug log (no URL bar needed).

## The black picture after a pause (v1.360.0)

- [ ] v1.360.0 - iPhone, a video inline in the watch page, Background audio for video ON, Ambient on: pause and unpause 20 times (picture taps, the bar's button, a double-tap in some), the first pause right after it starts by itself. The picture never goes black, or, if it does, it comes back by itself within about 6 seconds. Same in a Safari tab and the home-screen app.
- [ ] v1.360.0 - The same in full screen, then in the mini player (scroll down so it docks, pause/play there).
- [ ] v1.360.0 - Background audio still works: let a video start by itself, pause, unpause, then lock the phone: the sound carries on. (Disclosed: if you never paused it before locking, the first lock may only pause; pause and play once, then lock again.)
- [ ] v1.360.0 - If it ever goes black again: open `?debugLifecycle=1`, make it go black, wait 15 s, screenshot the panel. A `video:heal` line with no `video:heal-ok` after it, or no `video:heal` line at all, is the next clue; also try once with Background audio for video OFF.

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

- [ ] v1.357.0 - Home-screen app, Pocket on an iPod skin, rotate log ON (Settings > Troubleshooting > Show rotate debug log): turn to
  landscape and back upright while screen-recording; the skin lands in one step both ways (no giant LCD, no drop, no flash under the
  status bar). Copy the log rows and send them with the recording either way (each row now carries sh, cvw, cvh and pti).
- [ ] v1.357.0 - Play on a speaker PC, pick a song from an album, MENU back to the album: the speaker's song is marked; when the PC
  moves to the next song, the mark moves too.

## Hold to speed up, lock (v1.358.0)

- [ ] v1.358.0 - Settings > Mobile player > custom player controls ON. Play a video full screen: press and hold the picture (2x), drag
  your finger down a little, lift: it stays at 2x and the pill shows a lock. Tap the picture: it pauses and plays as usual, still
  2x. Tap the pill: back to normal speed. A plain hold and lift still goes back to normal on its own.
- [ ] v1.358.0 - Lock 2x, then lock the phone or switch apps and come back: normal speed (with background audio on, the sound in the
  background is normal speed too). Lock 2x, then open the next item or dock the player: normal speed. Lock 2x, then pick a speed
  from the speed menu: that speed wins and the pill goes.
- [ ] v1.358.0 - In a Safari tab and in the home-screen app, lock 2x on a video in a page that scrolls (not full screen), and on the
  audio file's art: the page does not scroll or refresh while you hold and drag. Chromium only was measured.

## Only if it comes back

- [ ] v1.344.2 - On the phone, a video with chapters: watch to the middle of a later chapter, tap Listen;
  it carries on from that spot in that chapter (not chapter 1). Then Watch again: still the same spot.
  Repeat PAUSED: pause on Watch, tap Listen (still paused, same spot), then Watch (still paused).
