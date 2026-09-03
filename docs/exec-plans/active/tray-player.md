# Tray Player - the pop-out parks above the taskbar as a now-playing strip (v1.257)

Status: ACTIVE. Dean 2026-09-03: an optional desktop mode - "when someone goes to PiP
mode, add a new Sticker option" that puts the player "in the bottom right corner of the
screen under a taskbar... peeking out slightly so you'd see the Now Playing, Name,
author in a mostly unobtrusive way... behind the windows explorer taskbar but ahead of
apps... don't cover time." His follow-up SCREENSHOT validated the shape on his machine:
the pop-out dragged flush above the Windows taskbar, clock untouched, over apps.

## Platform facts (screenshot-confirmed + API reality)

- A Document-PiP window is ALWAYS-ON-TOP over apps; the taskbar/Dock are themselves
  topmost - so "above apps, never covering the clock" comes free. Literal tucking UNDER
  the taskbar edge and scripted screen-positioning are NOT web-reachable: the user drags
  the tray to the corner ONCE and Chrome remembers PiP window placement. Disclosed.
- Desktop Safari has no Document PiP - the feature is Chrome/Edge desktop; the existing
  popoutSupported() gate already handles absence (openPlain fallback keeps working).
- The browser draws its own title bar on the PiP window (the screenshot shows it);
  requested width/height are the CONTENT box.

## Design

**Tray mode = the IPOD skin's LCD without the wheel (Dean's Nano pivot, 2026-09-03,
two reference images: the 5g's now-playing screen - art, "Let It Be", "The Beatles",
status bar - and the square 6g).** The chosen read: the 5g screen, because it is
literally the ask ("Now Playing, Name, author") and the ipod donor ALREADY renders it -
ip-lcd status bar (Now Playing + play glyph + battery), ip-npmain art + title/artist/
album, and the Aqua ip-scrub. A `.mms-tray` marker on the PIP BODY reshapes: wheelwrap/
listview hidden, the LCD fills a ~340x210 window, art 88px beside the meta, stars
hidden, marquee ellipsis on the text. The ENGINE is untouched; the shell forces
getSkinId -> 'ipod' in tray mode; the user's chosen skin still governs the full
pop-out and the phone. (The square 6g layout is a dims+layout flip if Dean prefers
it on device.)

**Mechanics (all in createPopoutShell + engine sticker + CSS):**
- `ft-tray-mode` in localStorage (device-global). open() picks dims by mode (380x700
  full vs 340x210 tray); mount() adds `.mms-tray` + wraps getSkinId when tray.
- The sticker gains a `tray` hook rendered ONLY on the pop-out surface (the first
  !inMainDoc-gated row - the inverse of watchBack/Extras): "Tray" On/Off on page 1.
  Toggling persists the mode, tears the pip down, and reopens at the new dims (the
  click's user activation carries the requestWindow re-grant; pipPending guards).
  The shell injects the hook into engineConfigFor's returned config - music.js's
  config and the MAIN window surface are untouched.
- In tray mode the sticker shrinks via CSS (still tappable - the same row toggles
  back); the menu opens scrollable within the strip.
- MAIN-window behavior, phone behavior, podcasts: byte-identical (the hook is injected
  only by the pop-out shell; podcasts' shell gets the row too by construction - judge
  at gate whether that's right or gated off).

**Predictions (machine-verified per commit):** player.js, music.js, server.js 0-diff;
touched files = skin-surface.js, style.css, tests.

## Device-probe risks (Dean arbitrates)

- Chrome's DiPiP MINIMUM window size: if the UA floors height above ~110, the strip gets
  letterboxed (CSS should center gracefully); exact floor is UA-territory.
- Whether Chrome's remembered PiP placement carries across the close+reopen of the
  toggle (it remembers per-origin bounds; a dims change may re-center once - the
  one-time drag then re-teaches it).
- The pip title bar's height is the browser's own; the strip budget assumes ~35px above
  the content box (outside our control).

## Tests (jsdom = wiring; placement/feel = Dean's device)

Tray hook renders on the pop-out sticker only (main-doc surface shows NO tray row -
both axes); toggle calls the shell's mode switch (persist + teardown + reopen dims
asserted via a requestWindow spy); mount in tray mode adds the body marker + forces the
IPOD donor (both bound); the Nano reshape CSS source-locked (wheel/list hidden, LCD
fill, art box, title ellipsis, button-only sticker scale - adversarial W-A: the first
cut promised this lock and had not written it); mode memory: a fresh open() honors the stored mode; OFF
path (no localStorage flag) = today's pop-out byte-identical. Gate: full (a new
lifecycle seam in the pip shell), dual-Node, v1.257.0.
