# Device checks (the rolling list)

One list of what Dean taps on his phone or desktop to confirm a release, grouped by area. Each line
carries the version that introduced it. A release appends its checks here instead of adding a tracker
row; a line is deleted when Dean has confirmed it (or moved to the tracker if it turns into a bug).
Rows #280-#289 of `docs/exec-plans/tech-debt-tracker.md` keep their other residuals and point here for
the checks.

## Whole app, layout and dialogs

- [ ] v1.341.3 - Turn the phone back upright on the watch page: it settles in one step, no bump (one rotate
  with `?debugLifecycle=1`; the log shows the scroll).
- [ ] v1.350.0 - THE TURN BACK (still open): open `?debugRotate=1`, play in Pocket, turn to landscape and back to upright while
  screen-recording, then tap the green panel to copy the rows and send them. The giant-LCD flash and the 20 px dip are NOT fixed
  in this release; the log names the cause. (2026-10-02: Dean's screen recording measured the turn frame by frame; see
  ROADMAP Planned > Bugs, "Pocket turn". The log is still wanted for the fix.)

## Only if it comes back

- [ ] v1.336 - The black picture on resume from the background: capture `?debugLifecycle=1` (the
  `video:check` line), with Ambient off too, and once with only the bar's play button.
- [ ] v1.344.2 - On the phone, a video with chapters: watch to the middle of a later chapter, tap Listen;
  it carries on from that spot in that chapter (not chapter 1). Then Watch again: still the same spot.
  Repeat PAUSED: pause on Watch, tap Listen (still paused, same spot), then Watch (still paused).
