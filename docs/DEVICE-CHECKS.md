# Device checks (the rolling list)

One list of what Dean taps on his phone or desktop to confirm a release, grouped by area. Each line
carries the version that introduced it. A release appends its checks here instead of adding a tracker
row; a line is deleted when Dean has confirmed it (or moved to the tracker if it turns into a bug).
Rows #280-#289 of `docs/exec-plans/tech-debt-tracker.md` keep their other residuals and point here for
the checks.

## Pocket and the Click skins (Music)

- [ ] v1.345.0 - On the phone: Extras > Skins > Nano > 7G (2012) > Purple previews live and Select keeps it; Settings shows the groups; the Gold skin is champagne.
- [ ] v1.344 - Extras > Skins on the Click player: turn the wheel through Click's colours and watch the LCD
  re-skin; Menu puts your old one back; Select keeps the new one (reload and rotate keep it too). A Cider
  or Nordic row changes only on Select. Settings > Music skin: the preview grid scrolls smoothly and a tap applies.
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

- [ ] v1.349 - Desktop Music page: the Remote control button reads "Remote control: On" with a visible grey fill when on, and the
  toolbar does not jump when you press it.
- [ ] v1.349 - Phone Settings > Mobile player: Music skin and Player sticker work there (pick a skin, add and reset a sticker);
  Settings > Appearance no longer has them.
- [ ] v1.349 - Device names: the phone's Play on... shows the PC as "Mac · Word"; type a name in Settings > Account on the PC
  (with Remote control on) and the phone's Play on... shows it on the next open, no reload.
- [ ] v1.348 - Through https://filetube.tamm.am: PC Music page, Remote control On. iPhone PWA (play a song once so the
  iPod panel shows): MENU > Play on... lists the PC.
- [ ] v1.348 - Pick an album on the phone: it plays on the PC within about a second; the iPhone is silent; its screen
  shows the PC's track and the "on PC" badge.
- [ ] v1.348 - Wheel: play/pause, next, previous, scrub. The PC follows.
- [ ] v1.348 - Browse to Home on the PC: it keeps playing and still obeys the phone.
- [ ] v1.348 - Lock the phone for a minute, unlock: it reconnects and still shows the PC's track.
- [ ] v1.348 - Close the PC tab: the phone says "Lost PC" within about 12 s and stays quiet.
- [ ] v1.348 - If a step lags by more than about 3 s, note it: nginx buffered and the fallback kicked in.
- [ ] v1.348 - Reload the PC tab while controlling: the phone says it lost the PC; pick it again and a play shows
  "Click the PC's tab once to let it play" until you click the PC page.
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
- [ ] v1.344.1 - Liked is a heart in the sidebar, the Playlists sheet and the bottom bar, in all three icon sets.
- [ ] v1.343.1 - Phone: open Playlists; the Watch later row shows the clock glyph beside Liked's star.
- [ ] v1.343 - Watch later: add from a card menu and from the watch page's More menu, the sidebar row
  and account menu row appear, Play all starts the queue, a video you finish leaves the list, and going
  back to Watch later from the watch page does not still show a video you just finished.

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

- [ ] v1.350.0 - On the phone, Custom > Transparent (and Black, Coil) in Pocket: turn the phone to landscape left, then right. The
  circuit board photo stays where it was on the glass (it does not rotate with the page), in both directions; turn upright: it
  is exactly as before. The other skins look as before.
- [ ] v1.350.0 - Settings > Mobile player shows Player sticker first and the skin grid last; the iPod menu says Speakers and
  has Recent Albums (tap one: its tracks open).
- [ ] v1.350.0 - THE TURN BACK (still open): open `?debugRotate=1`, play in Pocket, turn to landscape and back to upright while
  screen-recording, then tap the green panel to copy the rows and send them. The giant-LCD flash and the 20 px dip are NOT fixed
  in this release; the log names the cause.

## Only if it comes back

- [ ] v1.336 - The black picture on resume from the background: capture `?debugLifecycle=1` (the
  `video:check` line), with Ambient off too, and once with only the bar's play button.
- [ ] v1.344.2 - On the phone, a video with chapters: watch to the middle of a later chapter, tap Listen;
  it carries on from that spot in that chapter (not chapter 1). Then Watch again: still the same spot.
  Repeat PAUSED: pause on Watch, tap Listen (still paused, same spot), then Watch (still paused).
- [ ] v1.346.0 - On the phone: Extras > Skins > Shuffle > 4G (2010/2012/2013/2015) lists its colours and one previews live; Touch and Custom > Transparent show; Settings shows the new groups.
- [ ] v1.347.0 - On the phone: Extras > Skins > Custom shows Transparent, Transparent Black and Transparent Coil; each looks like a frosted clear case over a circuit board, the wheel still turns and taps, and on Coil the ring and dome show while the wheel taps still work. With Ambient on, tilt the phone: Coil's ring shine and shadow follow the light.
- [ ] v1.351.0 - On the phone with a PC listening and a long device name: the top-bar "On <name>" label slides to show the end, on iPod, Cider and Nordic, and stays no wider than before; a short name never moves.
- [ ] v1.351.0 - iPod menus: roll the wheel onto a long row (Albums, Artists, Speakers): it slides; roll off and it goes back to its dots at once. In Speakers both the device name and its song line slide.
- [ ] v1.351.0 - iPod song list: the highlighted long song title slides, the one you leave goes back to dots; Reduce Motion on: nothing moves.
- [ ] v1.351.0 - Speakers: pick a PC that is playing nothing: you land on the Main menu with Music selected and the top bar still says On <PC>; pick a song and it plays on the PC.
- [ ] v1.351.0 - Speakers: pick a PC that is paused on a song (or playing): you land on Now Playing as before.
- [ ] v1.351.0 - Desktop pop-out: the same long rows and label slide.
