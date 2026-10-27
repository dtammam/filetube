# Device checks (the rolling list)

One list of what Dean taps on his phone or desktop to confirm a release, grouped by area. Each line
carries the version that introduced it. A release appends its checks here instead of adding a tracker
row; a line is deleted when Dean has confirmed it, and a line that fails becomes a bug (in the tracker or
ROADMAP.md Planned > Bugs). Tracker row #284 points here for its open check (the v1.336 black picture, now the v1.361.0 checks).

## Toggle pills (v1.396.0)

- [ ] v1.396.0 - (a) Desktop Music: toggle Loop, Shuffle, Autoplay and Remote control. ON is obvious (solid ground + check) and hovering an ON one stays readable.
- [ ] v1.396.0 - (b) Play a chapter: "Loop chapter" ON looks the same.
- [ ] v1.396.0 - (c) Home chips, and Settings > sticker picker: the picked one is inverted.
- [ ] v1.396.0 - (d) Phone Sticker sheet skin: unchanged.

## Pages (v1.395.0)

- [ ] v1.395.0 - (a) iPhone, Safari: the Shortcut (Settings > Pages) saves the open article in one tap; in Pages it has title, author, site, published and saved dates and a clean Reader; Original shows the page as you saw it, with its images.
- [ ] v1.395.0 - (b) iPhone, another app (Mail, a chat): sharing a link through the second Shortcut saves it (fetched by the server); sharing text saves a text item.
- [ ] v1.395.0 - (c) Tell me which Shortcut path showed "Run JavaScript on Web Page" (expected: only the Safari one).
- [ ] v1.395.0 - (d) Phone: open a saved page, read halfway, open the same page on desktop: it resumes near the same place; reading to the end marks it read.
- [ ] v1.395.0 - (e) Phone and desktop: Reader / Original switch, text size and Paper / Sepia / Night; the choice of Reader or Original follows you to the other device.
- [ ] v1.395.0 - (f) Desktop: the browser extension (load `extension/` unpacked, add the Pages token in its options) saves the tab you are on, including a page you are signed in to.
- [ ] v1.395.0 - (g) The Download button: Page saves the link to Pages; Video / Audio still download.
- [ ] v1.395.0 - (h) Lists: make one, add a page from its page, Share with AI on the whole list pastes every page with its own header into your AI app.
- [ ] v1.395.0 - (i) Delete a page, find it in Pages > Trash, Restore it.
- [ ] v1.395.0 - (j) Settings > Bottom bar: turn on Pages; the item appears and opens Pages.
- [ ] v1.395.0 - (k) Signed in as the kid account: Pages is empty (none of your pages, nothing in search).

## Clickable links and real comments (v1.394.0)

- [ ] v1.394.0 - (a) A link in a video's description and in a top comment opens: on desktop in a new tab, in the iPhone app in Safari.
- [ ] v1.394.0 - (b) A time like 2:15 in a description or a comment jumps the video there, on the phone and on desktop.
- [ ] v1.394.0 - (c) Download a new video, open it on the phone: "Top comments · saved ..." shows the comments in Modern and in a retro look.
- [ ] v1.394.0 - (d) Settings > Appearance > Comments: Top comments and fun / Top comments only / Fun comments only / Off each show what they say (fun ones only in the retro looks; Off hides the section), and the choice follows you to another device.
- [ ] v1.394.0 - (e) Signed in as the kid account, a downloaded video shows no top comments (the fun ones only).
- [ ] v1.394.0 - (f) Reheat metadata on an older download: its top comments appear. (A library-wide Reheat now fetches every older download's comments once, about 10 s each - start it when you do not need downloads for a while.)

## A listing never wedges the queue (v1.393.0)

- [ ] v1.393.0 - Unpause the Scott Hanselman subscription (it was paused during the incident). It checks and finishes, or fails with a message, within an hour; it does not sit on "listing" for hours.
- [ ] v1.393.0 - Queue a one-off download while a subscription poll is running: the one-off starts when the poll's current channel finishes (it is not stuck behind a channel for hours).
- [ ] v1.393.0 - If a subscription ever sits on "Checking" for a long time, press Cancel on its row: it says cancelled, the next channel is checked, and the downloads behind it run.
- [ ] v1.393.0 - If a check or download is stopped by the safety limit, its row reads "stopped: exceeded its time budget"; send the Download trace (it now records the subscription lane and any crash).

## Downloads never wedge (v1.392.0)

- [ ] v1.392.0 - Next time a download looks stuck, do NOT restart: wait for the stall timer (10 min with no progress) or press Cancel. It clears on its own, and the downloads queued behind it start.
- [ ] v1.392.0 - After this update (and any later one), subscriptions are checked within a few minutes of FileTube starting, not an hour later (the bell or the Subscriptions page shows new videos without a manual re-pull).
- [ ] v1.392.0 - Server: `docker exec <container> cat /proc/1/comm` prints `tini`.
- [ ] v1.392.0 - If a download is ever freed this way, the container log has one line `yt-dlp settled without close: settledBy=...`; send it (and, for a one-off, the Download trace). It says which way the job was freed (exit-grace or kill-grace) and whether a helper was still alive in yt-dlp's group when it exited.

## App Store cleanup (v1.391.0)

- [ ] v1.391.0 - (a) The store-build gate: on an iOS build that does NOT announce `mediaFetch`, signed in to a server with downloads on, none of these appear: Subs or Download tabs, the header Download button, the bell, Reheat, Subscribe, Pin, the Downloads folder, Settings > Downloads, Notifications and Imported videos, and /subscriptions says "Not available in this app". The offline Download control still works. A build that announces it, and Safari, are unchanged. (iOS Root / Dean)
- [ ] v1.391.0 - (b) Pocket: skin names read Classic, Mini, Slim, Clip, Touch, Custom with plain numbers and no years; the three Transparent skins show the new board, the Coil skin the same ring, sideways too.
- [ ] v1.391.0 - (c) Settings copy: no brand names; Settings > Mobile player ends with the non-affiliation line; the Home page rows read "rows by topic" and "Modern grid".

## Sideways scrolling (v1.390.0)

Phone held sideways, a video's watch page (not fullscreen), Safari and the FileTube app:

- [ ] v1.390.0 - Leave fullscreen if it opened there: the video is a little shorter and centered, with the title row starting just under it on the first screen.
- [ ] v1.390.0 - Drag up and down with a finger ON the video: the page scrolls with your finger, and a quick flick glides on and slows down by itself. A finger put down on a gliding page stops it and does not pause the video.
- [ ] v1.390.0 - Pull down at the top of the page on the video (a narrower phone, or the app): it still shrinks to the mini player. Tap pauses, double-tap skips, hold plays at 2x and lets go when you lift, swipe right goes back.
- [ ] v1.390.0 - Upright: the video and every gesture are exactly as before (a finger on the video still does not scroll the page). iPad and computer: unchanged.
- [ ] v1.390.0 - Does the grey magnifier still stay away on a hold on the video, sideways? (nothing in the scroll turns it back on; say if it shows)

## Phone sideways (v1.389.0)

- [ ] v1.389.0 - Safari, phone held sideways, any page: no side menu on the left; the menu button (top left) shows. Tap it: the menu slides in over the page; tap the page, a link in it, or turn the phone: it closes.
- [ ] v1.389.0 - Open the menu upright (via Playlists) or sideways, close it, turn the phone back and forth a few times: the menu is never left open and nothing sits stuck on the left.
- [ ] v1.389.0 - Sideways, tap a video from Home: the watch page opens fullscreen (Safari and the FileTube app). If it does not start playing on its own it is still fullscreen with the play bar showing; say if it is not.
- [ ] v1.389.0 - Sideways fullscreen: tap the exit button; it shows the normal watch page and STAYS out. Open the next video: it is fullscreen again. Turn upright: it leaves fullscreen; turn sideways again while playing: it enters.
- [ ] v1.389.0 - Upright: open a video (not fullscreen), then turn sideways while it plays: fullscreen as before (unchanged). A video in the Feed does not go fullscreen sideways.
- [ ] v1.389.0 - Computer: the menu button still collapses and restores the left menu; Theatre mode still hides it and brings it back. Tablet unchanged.

## Whole app, layout and dialogs

## Sticker sheet (v1.388.0)

On the phone (the home-screen app and the FileTube app), Pocket player, sticker at 1x and at 2x:

- [ ] v1.388.0 - Tap the sticker on a chaptered track: the whole sheet shows with no scrolling (header, 8 tiles, Skin row), in light and in dark.
- [ ] v1.388.0 - Tap Like once after opening: the playing chapter is liked (caption says chapter, then Liked); a plain song says track.
- [ ] v1.388.0 - Speed: the tile shows the rate; tap it, pick 1.5x: the strip closes and the tile looks selected; Loop and Shuffle look selected when on.
- [ ] v1.388.0 - Skin: search "nano" narrows the list; every row is one line; the groups (Classic, Mini, Nano...) are closed except yours and a tap opens one; Recent shows the active skin first; picking one closes the sheet and repaints.
- [ ] v1.388.0 - More: Autoplay, Start radio, Watch, Lighting (Off / Subtle / Bold / Ambient) and the item actions all work; Delete only shows if you may delete.
- [ ] v1.388.0 - App only: the Download tile saves for offline with a progress ring, reads Saved, and tapping it removes the copy. In Safari it is the plain browser download.
- [ ] v1.388.0 - Desktop pop-out: the sheet opens inside the pop-out and works (the tiny Tray window scrolls inside it).

## Speed pass (v1.386.0)

On the phone, home-screen app and FileTube app, at home and over the VPN:

- [x] v1.386.0 - Pocket > sticker > Skin > Transparent Coil (and Transparent, Transparent Black; and Extras > Skins scrolling onto them): the old look stays until the new one appears whole - never the frame without its board or ring. The first pick on a new phone may take a moment; later picks are instant. (Dean 2026-10-12: passed)
- [x] v1.386.0 - Open Music at home, then over the VPN: the Home shelves are usable within about a second; the Albums and Songs tabs and the Pocket's Songs list open noticeably faster than before. (Dean 2026-10-12: passed)
- [ ] v1.386.0 - After the NEXT release (any version after v1.386.0), open the app without force-quitting: it shows the new version's changes at once (the account menu's version row reads the new number), in Safari, the home-screen app and the FileTube app.
- [x] v1.386.0 - Nothing looks different anywhere (pages, icons, fonts, skins); the sign-in page still looks right when signed out. (Dean 2026-10-12: passed)
- [ ] v1.386.0 - Settings > download a backup in Safari and in the FileTube app: the file saves and opens as readable JSON (it now travels compressed).
## Header panels (v1.387.3)

On a computer, in Chrome and in Safari (a normal-sized window, then a short one):

- [ ] v1.387.3 - Click the avatar, the bell, the queue icon and Home's sort button, one at a time: each panel opens directly under its button with its right edge lined up with the button's, and grows from that corner.
- [ ] v1.387.3 - Click the bell on a slow connection (or with many notifications): the panel stays where it opened while the rows load, no jump up over the bell; a long list scrolls inside the panel.
- [ ] v1.387.3 - Open the One-off download box: the first field's blue focus ring is whole at the top. Subscribe's box looks the same.
- [ ] v1.387.3 - On the phone: the You tab, the bell and the queue sheets look exactly as before.

## Offline playback (v1.387.0)

Browser and home-screen app: nothing should look or behave differently, except Settings > Account now has a Devices list
(empty until a phone pairs) and the podcast add form says "keep every episode on the server" instead of "full offline cache".
In the FileTube iOS app (needs the filetube-ios build that announces `downloads`, v0.9.0): the app half is owed until it ships;
these checks stay open until then.

- [ ] v1.387.0 - Browser / home-screen app: every menu that had Save to device still has it and nothing else new; no Offline badges anywhere; Settings > Account > Devices says "No devices. Devices appear here when the FileTube app is set up for offline playback."
- [ ] v1.387.0 - App: pair (the native password prompt); the phone appears under Settings > Account > Devices on the laptop with "added today" and a last-used time after its first fetch.
- [ ] v1.387.0 - App: make an album, a podcast episode, a video and a TV season available offline (the menu entry sits beside Save to device; the TV show page has a pill per episode and per season); the "Saving for offline... N%" text moves, then the Offline badge shows on the card or row; the album's badge appears once every track is done.
- [ ] v1.387.0 - App: airplane mode on; the native Downloads screen plays each of the four (an ALAC or FLAC track plays as the original, not a re-encode).
- [ ] v1.387.0 - App: online, play a downloaded video from its card: it plays from the phone's copy (no transcode wait, no server bytes on a slow link); a 360 video still plays from the server.
- [ ] v1.387.0 - App: listen offline to a track and watch half an episode; reconnect: the positions show on the laptop within a minute, and the watched / played marks follow where they crossed the line.
- [ ] v1.387.0 - App: make a position on the laptop AFTER an offline one on the phone, then let the phone sync: the laptop's position stays.
- [ ] v1.387.0 - App: in Settings > Account > Devices on the laptop, Remove the phone while it is downloading: the download stops at once and the app asks to pair again.
- [ ] v1.387.0 - App (a kid account): the hidden folder's videos and the hidden show's episodes offer no offline entry the kid can use; a direct manifest or file fetch with the kid's token is a 404; a restriction added later makes the app drop that copy on its next check (status = gone).
- [ ] v1.387.0 - App: the avatar menu shows the app's version and build under the server version ("iOS app 0.9.0 (12)"); the browser and the home-screen app show no such line.

## App menus (v1.387.2)

In the FileTube iOS app (v0.9.0 or later):

- [x] v1.387.2 - Tap You: the account menu opens and has an Offline row. (Dean 2026-10-12: passed)
- [x] v1.387.2 - Open the More menu of a video card, the watch page, a song and a podcast episode: each opens with "Make available offline" (a down arrow, distinct from Save to device). (Dean 2026-10-12: passed)

## Offline add failures (v1.387.1)

Browser and home-screen app: nothing should look or behave differently. In the FileTube iOS app (needs the build that sends `downloadsAddFailed`):

- [ ] v1.387.1 - App with the server unreachable: make an album available offline -> a toast says "No connection right now..." and the album's pill carries the reason; tap again once online -> it starts and the pill shows "Saving for offline...".
- [ ] v1.387.1 - App: the same on a TV season's pill; the pill also changes by itself as the download progresses (no page reload).

## The immersive Pocket (v1.385.0)

Browser and home-screen app: nothing should look or behave differently (Pocket's status bar has no clock and no connection mark; iOS's own bar stays).
In the FileTube iOS app (needs the filetube-ios build that announces statusBar and network):

- [ ] v1.385.0 - Browser / home-screen app: Pocket's status bar looks exactly as before (title, play mark, battery; no time, no connection mark).
- [ ] v1.385.0 - App: open Pocket: iOS's own status bar is gone, and Pocket's bar shows the time, the battery and the connection mark (one battery only). Rotate the phone sideways with Keep Pocket upright OFF: the bar stays hidden.
- [ ] v1.385.0 - App: close Pocket (dock, Home, another tab): iOS's status bar is back at once.
- [ ] v1.385.0 - App: turn Wi-Fi off: the mark becomes the cellular bars; turn on airplane mode: the no-connection mark; back on: Wi-Fi. The time moves on at the minute.
- [ ] v1.385.0 - App: with Pocket open, go to another page and swipe back into it: still upright, iOS's bar still hidden, the battery and connection mark still live.
- [ ] v1.385.0 - App: swipe back into a page where Pocket is closed: iOS's bar visible, the phone turns freely.

## The iOS bridge (v1.384.0)

Browser and home-screen app: nothing should look or behave differently (Pocket, the wheel, Feed, Settings, the battery stays the static drawing).
In the FileTube iOS app (filetube-ios, once it re-checks this server):

- [x] v1.384.0 - Browser / home-screen app: Pocket turns upright as before, the wheel ticks as before, Feed, Settings and Pocket's battery look exactly as before; Settings > Account has no Server address row. (Dean 2026-10-11: passed)
- [x] v1.384.0 - App: connect to the server; the "basic check" / older-server notice is gone (GET /api/host-info answers while signed out). (Dean 2026-10-11: passed)
- [x] v1.384.0 - App: open Pocket and turn the phone sideways with the phone's own rotation lock OFF: Pocket stays portrait. Close Pocket (dock, Home, another tab): the app turns with the phone again. With Settings > Mobile player > Keep Pocket upright OFF, Pocket is not locked. (Dean 2026-10-11: passed)
- [x] v1.384.0 - App: spin the wheel slowly and fast, quick-scroll a long list (a tick per letter), hold the center and hold MENU: real ticks, no dropped-out stretches, none with Buzz off. (Dean 2026-10-11: passed)
- [x] v1.384.0 - App: swipe Feed cards: one tick as each card settles; none on the first card, on the auto-advance, on Hide this, or when a swipe springs back. (Dean 2026-10-11: passed)
- [x] v1.384.0 - App: Pocket's battery bar matches the phone's level (and follows it as it changes); Cider / Nordic skins unchanged. (Dean 2026-10-11: passed)
- [x] v1.384.0 - App: Settings > Account (at the bottom) > Server address > Change opens the app's own address screen. (Dean 2026-10-11: passed)
- [x] v1.384.0 - App: force-quit while on a music page and reopen: it returns to that page, as the home-screen app does (the last-page restore now treats the app as installed). (Dean 2026-10-11: passed)

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

## Feed reels and speed (v1.383.0)

Home-screen app on the iPhone. Have a video, a podcast and a book you are partway through, a book you never opened, some liked songs,
and (for the music) a Lofi, Chill or Jazz station in Music or a few liked songs.

- [ ] v1.383.0 - Let a video card play to its end: "Next in 2" shows and the Feed moves to the next card by itself. Again, and touch
  the card while it counts down: it stays. Settings > Feed > Auto-advance off: a finished card stays. A book card never moves on.
- [ ] v1.383.0 - Swipe to the next card: it starts playing at once, with sound, without a tap (after the session's first tap on
  10 / 20 / 30 min). Swipe a little and let go (the card springs back): the card you were on plays on from where it was, and the
  recap at the end counts it once (a glimpse of the next card is not counted). Leave the Feed on one card for a few minutes, then
  let it move on: the next card starts as quickly as the rest (its file's start was read ahead on the server).
- [ ] v1.383.0 - Mid-way through a podcast card, tap its title (or its show line, or the small open button by the title): the full
  episode opens in Podcasts, still playing at the same spot. Same on a video (the watch page) and a song (Music).
- [ ] v1.383.0 - A book card you are partway through: "..." > Start over > Start over. The card shows the book's first chapter at
  once (its name as the book gives it: "Chapter I", "Chapter One", "Prologue"), and the confirm named the place you really had.
  Tap Undo within 10 seconds: the card shows the page you were on again, and the reader opens at your old place.
- [ ] v1.383.0 - The "Start something new" card for a book you never opened names its first chapter the way the book does (no more
  "Chapter 6" for a book's first chapter); Start reading opens the reader there.
- [ ] v1.383.0 - Song cards play a 45-second clip from about a third in (try 30 / 60 s and Whole song in Settings > Feed). Keep
  listening opens the song in Music, playing on. A clip heard to its end counts one play; swiping past one early never counts a skip.
- [ ] v1.383.0 - On a book card, music starts on its own with a chip (a note icon, then "song · artist"); it keeps playing as you swipe pages and on to
  the next book card, and stops when a video or podcast card comes. Tap the chip: Like the song, Mute music (for the rest of the session),
  Change station. With a long mix with chapters in the station, one chapter plays and then the next song. Keep reading: the music
  stops. Settings > Feed > Music while reading off: silence. The Feed never lowers the phone's volume (iOS does not let it).

## Feed settings (v1.382.0)

Home-screen app on the iPhone, and the desktop for one line. Have a video, a podcast and a book you are partway through, plus new
ones of each.

- [ ] v1.382.0 - Settings > Personalize > Feed (or the gear on the Feed's length picker): switch each kind off in turn and start a
  session; that kind never shows. The last kind left on cannot be switched off. Open Settings > Feed on the desktop: the same choices.
- [ ] v1.382.0 - Per kind (Videos, Podcasts, Books): New only shows only things you have not started; Only ones I started shows only
  those (and Where they start greys out on New only, saying why).
- [ ] v1.382.0 - Where they start = From the beginning on Videos: a started video plays from 0:00 and says "From the beginning". Swipe on,
  then open it on the watch page: it resumes at your old place. Same with a podcast (Podcasts page) and a book (the reader).
- [ ] v1.382.0 - Reels: a video card runs 60 seconds from its start, an episode 2 minutes. Try 30 s and Whole chapter for videos, 4 min for podcasts.
- [ ] v1.382.0 - Near the end of a video card (and once it says Done) tap Keep watching: the watch page opens, still playing at the same
  spot, no recap. Keep listening on a podcast: the Podcasts page, playing. Keep reading on a book card's last page: the reader.
- [ ] v1.382.0 - From the beginning, then Keep watching early in the video, watch a bit and close: the video still resumes at your old place.
  Once more with a video that has chapters: Keep watching, then Listen, let it play a little and close: still your old place.
- [ ] v1.382.0 - Double-tap a video, a podcast, a song and a book page: a heart pops where you tapped and it is in Liked. A single tap
  still pauses (after a short beat). "..." has Like / Unlike and Add to / Remove from Watch later.
- [ ] v1.382.0 - "..." > Hide this on a video, a podcast, a song and a book; Undo one within 10 seconds. "..." > Fewer from on a channel.
  Settings > Feed > Hidden and fewer lists them; Unhide and Remove work. A hidden item never comes back in a new session. Videos you
  hid from Home earlier are there too and stay out of the Feed; Unhide one and it is back on Home as well.
- [ ] v1.382.0 - A new video watched to the end of its 60-second reel says Continue next time; one you swiped after 10 seconds still says New.

## Feed, TikTok style (v1.381.0)

Home-screen app on the iPhone (and once on a small phone if you have one, 320 wide). Have a book you are partway through, a video
and a podcast you are partway through, a liked song, and something downloading.

- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") Every card fills the screen edge to edge: a video fills it (cropped like a phone feed), the title, channel and readout sit
  over a dark fade at the bottom, the ring and Done top right never touch the title. A podcast or song: the art blurred behind, the art
  once in the middle, not huge. Check each kind at your phone's width.
- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") Nothing inside a card scrolls. A book card shows one page; swipe left for the next page, right to go back ("Page 2 of 3").
  Past the last page the next pages load. Swipe up or down moves card to card from anywhere on a card, including from the playing video.
- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") The back swipe: start a swipe right at the very left edge on a book card. Safari's (or the app's) back gesture is the one
  that happens, never a page turn. A swipe starting a thumb's width in turns the page.
- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") On a playing video: tap pauses (a glyph in the middle), tap again plays; press and hold plays at 2x with the badge while
  you hold, back to normal when you let go. Hold for a few seconds: no magnifier bubble. A podcast or song: tap pauses / plays, a hold
  does not speed up.
- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") Fit / Fill on a video: Fit shows the whole picture with bars, Fill crops to the screen. Your choice sticks for the next video
  and the next session.
- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") Turn the phone sideways while a video or song plays in the Feed: nothing goes full screen and the card stays a card (the page
  itself may turn wide; a web app cannot lock it upright).
- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") In the Feed there is no "Watching on <device>" card and no download pill; go to Home: both are back, and the download went on.
- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") Start over on a video you are partway through: "..." > Start over > the sheet says "Your place, h:mm:ss of h:mm:ss, will be
  forgotten". Confirm: the card says New and plays from the start. Tap Undo within 10 seconds: it is back at your place, says Continue. Do it
  again and let the toast go: open the video on the watch page, it starts from the beginning. Once more: Start over, tap Home within
  10 seconds, then tap Undo on the toast still showing: "Your place is back", and the video resumes at your place.
- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") Start over on a podcast and on a book card; Undo each. Then Start over a book and open it in the reader: it opens at the
  beginning. Songs and new books have no "...".
- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") Things you only peeked at (under a minute) now say New, not Continue; anything you really watched or listened to still says Continue.
- [x] v1.381.0 - (Dean 2026-10-10: "everything is good") Optional, on the server: `docker exec -i <filetube container> node scripts/feed-stale-continue.js /app/data/filetube.db`
  (read-only) and send the summary lines; they show how many of your Continue items were under a minute or were moved by a feed session.

## Feed polish (v1.380.0)

Home-screen app on the iPhone. Have a book you have never opened, a subscription with videos you have not watched and a podcast with a new episode.

- [x] v1.380.0 - (Dean 2026-10-10: "everything is good") Settings > any long page (Mobile player is the longest): scroll to the bottom; the back arrow and the page title stay pinned
  under the app header the whole way, rows slide under them, and the arrow still goes back. Try a short page and a landscape turn.
- [x] v1.380.0 - (Dean 2026-10-10: "everything is good") Settings > Personalize has a "Bottom bar" page right after Mobile player: drag to reorder, switch items off and on. Mobile player no longer has it.
- [x] v1.380.0 - (Dean 2026-10-10: "everything is good") Start a Feed session (your first three on this phone): a small "Swipe up" cue sits at the bottom of the first card and fades when you
  swipe or after about 4 seconds. The fourth session shows none.
- [x] v1.380.0 - (Dean 2026-10-10: "everything is good") A book you never opened comes as "Start something new": cover, author, what it is about, no pages of text until you tap "Read the opening"
  (its first real chapter, not the cover or copyright page). Swipe away without tapping anything, then open the book in the reader: it opens at the very start, as unstarted
  (not under "currently reading"). Only one such card per session.
- [x] v1.380.0 - (Dean 2026-10-10: "everything is good") "Start reading" on that card: the reader opens at the first real chapter; the book is now one you are reading and its next feed card continues from there.
- [x] v1.380.0 - (Dean 2026-10-10: "everything is good") Video and podcast cards read "Continue" or "New from <channel>" / "New episode of <show>" (Watch later keeps its word). Expect about one New for every two Continue.
- [x] v1.380.0 - (Dean 2026-10-10: "everything is good") Swipe past a NEW video after about 10 seconds: it is not under Continue watching afterwards and not marked watched. Stay on a new one for over a minute: it is.
- [x] v1.380.0 - (Dean 2026-10-10: "everything is good") A new video that starts with an intro chapter opens after it with "Skipped the intro" for 3 seconds; tap it to go back to the start.
- [x] v1.380.0 - (Dean 2026-10-10: "everything is good") Start a NEW podcast episode in Feed, swipe nowhere, go to Home while it keeps playing in the mini player, listen past a minute: open the podcasts page; the episode has a place.

## Feed mode (v1.379.0)

Home-screen app on the iPhone, a book you are partway through, a podcast in progress, a few subscriptions, some liked songs.

- [x] v1.379.0 - (Dean 2026-10-10: "everything is good") The bottom bar has Feed (after Liked on an untouched bar, so beside Home; appended after your own items if you ever
  reordered the bar - Settings lists it either way); the sidebar has Feed under Library, and so does the phone's Playlists sheet. Tap it: the length picker, your last pick highlighted, and "This week: ..." once a session exists.
- [x] v1.379.0 - (Dean 2026-10-10: "everything is good") Pick 10 min. Cards arrive; swipe up through five: the kind label, a book's text (plain, readable, "Open in reader"), a
  podcast's art with "4:00 of this episode", a video's chapter line, a Watch later label, a song's art. Never the same kind twice in a row.
- [x] v1.379.0 - (Dean 2026-10-10: "everything is good") A video card plays WITH sound from its saved place inside its card (no second player, no black picture after the swipe
  from the previous card); the "left" readout counts down; at the slice end it pauses and says Done. Swipe to the next media card:
  the previous one is paused, the new one plays in ITS card. Then tap the mini player / go to the watch page: the position carried.
- [x] v1.379.0 - (Dean 2026-10-10: "everything is good") A podcast card resumes at the saved place and plays 4 minutes; the podcasts page afterwards shows the moved place.
- [x] v1.379.0 - (Dean 2026-10-10: "everything is good") A book card: read it (stay about a minute on a 450-word card), swipe on, then open the book in the reader: it opens on
  the page that holds the next unread paragraph (the first paragraph of the card after it). Open the same book on another device
  first, read on, then let the feed card finish: the toast "Your place in ... moved on another device" and the place is NOT moved back.
- [x] v1.379.0 - (Dean 2026-10-10: "everything is good") A book card you SKIP (swipe on within a few seconds): the reader still opens where you were, and that book does not
  come back in this session until you read or open it (gate r1: a skipped card never puts unread pages behind your place).
- [x] v1.379.0 - (Dean 2026-10-10: "everything is good") While a video card plays, leave the feed and open that video from Home (the player carries over), drag the scrubber BACK and pause: the
  watch page keeps that earlier place (gate r1: the feed's forward-only rule stays in the feed).
- [x] v1.379.0 - (Dean 2026-10-10: "everything is good") The ring in the corner fills as the time runs; tap it: "m:ss left" for 3 s. When time is up mid-podcast the slice finishes
  (at most 2 more minutes) and the recap opens; when time is up on a book card the recap opens on your next swipe.
- [x] v1.379.0 - (Dean 2026-10-10: "everything is good") The recap: the minutes, "N pages of <book>", "N chapters of <video>" or "N min of <video>", "N min of <episode>", "N songs";
  a TAP on "Another 10 minutes" does nothing; a HOLD (about a second, the button fills) adds ten minutes and the feed goes on; the next
  recap says ", extended once". Done returns to the page you came from.
- [x] v1.379.0 - (Dean 2026-10-10: "everything is good") iOS reparent caveat (D7): a playing video moved from one card's slot to the next keeps playing; the lock screen shows the
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
