# Device checks (the rolling list)

One list of what Dean taps on his phone or desktop to confirm a release, grouped by area. Each line
carries the version that introduced it. A release appends its checks here instead of adding a tracker
row; a line is deleted when Dean has confirmed it (or moved to the tracker if it turns into a bug).
Rows #280-#289 of `docs/exec-plans/tech-debt-tracker.md` keep their other residuals and point here for
the checks.

## Pocket and the Click skins (Music)

- [ ] v1.332 - Colour fidelity of the colorways against the real devices: Pink (warm-lit photo), Red
  (~7 degrees warmer in a browser), and whether the wheel labels on Red, Gold and Blue read well enough.
- [ ] v1.332 - Hold MENU: does iOS tick on a still finger (the 600 ms hold)? Android's long-press, if you
  have one.
- [ ] v1.333 - Ambient lighting on the iPhone: the streak and room light look right, the scroll stays
  smooth, the phone does not warm up.
- [ ] v1.333 / v1.335 - The sticker menu on your phone with the 2x sticker: the Skin page (25 skins, now 12
  chip rows) scrolls, its top is on screen, and a finger pan reaches the end.
- [ ] v1.334 - The motion prompt appears on the tap that opens the player; that tap's song still starts on
  the first launch of the day.
- [ ] v1.334 - The sticker's gloss and shadow catch the light on the iPhone.
- [ ] v1.334 - A notification's Tap to play plays on ONE tap (that tap is also the player's first and
  raises the motion prompt). After a failing notification, read `?debugLifecycle=1` (it records every
  auto-start's outcome, the tap history and the page's age).
- [ ] v1.335 - Click (Original) on the iPhone: the bitmap face, the ring, a `?play=` launch; the twelve
  newer colorways against the real devices you know.
- [ ] v1.340 - The Original's wheel is a plain disc and turns under a thumb without marks.
- [ ] v1.341 - Pocket stays up through a rotate; landscape puts the screen beside the wheel.
- [ ] v1.341.4 - The Original shows an emoji in a title, a row or the status bar in black and white; every
  other skin still shows it in colour.

## Music page

- [ ] v1.339 - Music tabs, an album page and Now playing hold still on the phone, cold and returning.
- [ ] v1.339 - The music toolbar's reserved slots: Autoplay sits on row 2 on every phone tab, a 38 px
  toggle slot, the desktop pop-out slot held while idle.
- [ ] v1.339 - Album art reveals together (no one-by-one pop-in).
- [ ] v1.341.1 - The chapter time editor ("Fix times") keeps your place after a nudge, with focus on the
  button you pressed; closing it with unsaved changes shows the confirm dialog on top.
- [ ] v1.341.4 - The chapter row in Extras now reads "Fix chapter times" (was "This chapter starts
  wrong") and Move reads "Move to folder"; both do what they did.

## Downloads, sharing and library

- [ ] v1.337 - Share on a Facebook or Reddit download, including one made before v1.337; a right swipe in
  fullscreen video does not go back.
- [ ] v1.338 - The phone watch page for a download from another site: the badge, Share and Pin; a card's
  Share on a Reddit or Facebook download; Reheat on one.
- [ ] v1.339 - Re-downloading something already in the library reads "Already in your library" and keeps
  the file; an audio request for a video already there keeps the video.
- [ ] v1.339 - The live download percent (it may be dead: `--print` implies `--quiet`); note whether it
  moves before anything is changed.
- [ ] v1.341.4 - The watch page's More menu reads "Move to folder", "Assign channel" and (on YouTube
  links, while playing) "Share at 1:23" beside "Share video".
- [ ] v1.342 - Clean up (account menu): nothing is ticked, the toolbar and rows fit the phone, Move to
  Trash names the count and size, and the moved items come back from Settings > Trash.

## Subscriptions, channels and podcasts

- [ ] v1.340 - Tap Notify, Pin channel and Subscribe on the phone and on desktop: nothing beside them
  moves, the bell is the header's (slashed when off), Pinned carries a drawn star.
- [ ] v1.340 - The Subscriptions page's row bells and bottom bar.
- [ ] v1.340 - The Podcasts "Pin to Playlists" button.
- [ ] v1.339 - Home cards and the bottom bar hold still on a warm launch.
- [ ] v1.341.1 - Pinned channels in the sidebar line up in one column; a long name ends in an ellipsis.

## Whole app, layout and dialogs

- [ ] v1.341 - The whole app on phone and desktop in each era (buttons, rows, menus and dialogs match and
  hold still).
- [ ] v1.341 - A quick double tap on a delete never answers the confirm; a card menu or confirm left open
  closes when you change page; menus near the bottom open above their button.
- [ ] v1.341 - The notifications panel in phone landscape now covers the bell slightly (it fits neither
  side): acceptable?
- [ ] v1.341.2 - Opening notifications, the account menu, a card's menu or a dialog does not shift the page
  sideways on desktop, including in a narrow window; fullscreen video and dialogs look as before.
- [ ] v1.341.3 - Turn the phone back upright on the watch page: it settles in one step, no bump (one rotate
  with `?debugLifecycle=1`; the log shows the scroll).
- [ ] v1.341.3 - Modern theme on the phone: a folder with a long video title or channel name fits the
  screen.

## Only if it comes back

- [ ] v1.336 - The black picture on resume from the background: capture `?debugLifecycle=1` (the
  `video:check` line), with Ambient off too, and once with only the bar's play button.
