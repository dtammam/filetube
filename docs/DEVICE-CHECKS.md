# Device checks (the rolling list)

One list of what Dean taps on his phone or desktop to confirm a release, grouped by area. Each line
carries the version that introduced it. A release appends its checks here instead of adding a tracker
row; a line is deleted when Dean has confirmed it, and a line that fails becomes a bug (in the tracker or
ROADMAP.md Planned > Bugs). Tracker row #284 points here for its open check (the v1.336 black picture).

## Whole app, layout and dialogs

- [ ] v1.341.3 - Turn the phone back upright on the watch page: it settles in one step, no bump (one rotate
  with `?debugLifecycle=1`; the log shows the scroll).
- [ ] v1.350.0 - THE TURN BACK (still open): open `?debugRotate=1`, play in Pocket, turn to landscape and back to upright while
  screen-recording, then tap the green panel to copy the rows and send them. The giant-LCD flash and the 20 px dip are NOT fixed
  in this release; the log names the cause. (2026-10-02: Dean's screen recording measured the turn frame by frame; see
  ROADMAP Planned > Bugs, "Pocket turn". The log is still wanted for the fix.)

## Pocket music (v1.354.0)

- [ ] v1.354.0 - iPod Songs: scroll and letter-jump to the last songs (past H, to Z); Genres shows every genre; Shuffle Songs plays songs from the whole library; Liked lists every liked song.
- [ ] v1.354.0 - Controlling the speaker, Now Playing: the center button shows the PC's up-next list with the playing song marked; tap a song: the PC plays it. Before the PC has said its queue, the button does nothing (never a blank page).
- [ ] v1.354.0 - A Transparent skin: turn to landscape and back: the board lands in place in one step, and the skin lands in one step coming back upright (screen-record it with `?debugRotate=1` and send the rows if not).
- [ ] v1.354.0 - Music > Search on the iPod: the wheel picks letters on the strip, center adds, MENU deletes; results narrow live; it looks like the iPod's own search on each iPod skin you use, the Original included.
- [ ] v1.354.0 - Search the skins list (Pocket Extras > Skins, Settings > Mobile player): typing a name narrows it.

## Only if it comes back

- [ ] v1.336 - The black picture on resume from the background: capture `?debugLifecycle=1` (the
  `video:check` line), with Ambient off too, and once with only the bar's play button.
- [ ] v1.344.2 - On the phone, a video with chapters: watch to the middle of a later chapter, tap Listen;
  it carries on from that spot in that chapter (not chapter 1). Then Watch again: still the same spot.
  Repeat PAUSED: pause on Watch, tap Listen (still paused, same spot), then Watch (still paused).
