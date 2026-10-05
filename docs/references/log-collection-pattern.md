# Log collection: record in the background, export with one button

The house rule for any log FileTube collects to diagnose a problem on a device (v1.362.2, the plan
docs/exec-plans/completed/2026-10-04-loupe-black-checks.md, ruling D6).

## The rule, in Dean's words

> "a debug log that allowed me to export everything with like a button press... you enable it in settings
> you go out you live you do your thing it's recording... at the end I go back and press like export or copy
> and it puts it on the clipboard or puts it into a file... copy pasting on mobile is really annoying"
>
> "we should document that pattern and use that for anything where we have to do any kind of log collection"

## The shape

1. **A Settings switch starts it.** The log has a switch under Settings > Troubleshooting (or the section
   it belongs to). On means recording; it reads its flag at every event, so it starts and stops at once.
   A URL parameter may also set the flag, but the switch is the way in: the home-screen app has no address
   bar.
2. **It records in the background.** Entries go to `localStorage` (they survive a reload, a force-quit and
   an app restart), capped so the stored JSON stays well under 1 MB. Nothing shows on screen while it
   records.
3. **Nothing on screen by default.** A live panel, if the log has one, is a SECOND, opt-in switch ("Show
   the log on screen"), off by default. A panel never clears or copies on a tap: a stray tap lost the
   evidence before (v1.336 lifecycle panel), and a panel over the app is in the way while living with it.
4. **One Export button** beside the switch exports EVERYTHING: the share sheet with a `.txt` file (save to
   Files, AirDrop, Messages, Mail), then the clipboard where file sharing is missing, then a download.
5. **A Clear button asks first** through the app's one confirm step (`confirmDestructive` in setup.js, a
   `ui.confirm` with danger), and clears only on an explicit OK.
6. **The file is complete and self-describing.** A header (what the log is, the export time, the app
   version, the user agent, standalone app or browser tab, the entry count), then one line per entry,
   OLDEST first, each with its wall time as ISO time to the millisecond and every detail in FULL (never the
   panel's cut).
7. **It leaves the device only by the user's share.** No network call ever sends a log; the share sheet,
   the clipboard or the download is the only way out.

## The helper: `exportDiagnosticLog`

`public/js/common.js` `exportDiagnosticLog({ filename, text, title })`, over the pure
`chooseLogExportStrategy({ canShareFiles, hasClipboard })` ('file' | 'copy' | 'download'):

- Builds a `File([text], filename, { type: 'text/plain' })` and calls `navigator.share({ files })`
  SYNCHRONOUSLY, inside the caller's click, from text the caller already holds. No `fetch` and no `await`
  before the share: iOS drops the user activation, and the share (or the clipboard write) is refused.
- `navigator.canShare({ files })` false or absent: `copyTextToClipboard(text)` (common.js, same rule: called
  inside the click).
- Neither: a Blob `a[download]` with the given filename.
- A dismissed share sheet (`AbortError`) is the user's choice, never an error (the `shareMediaFile` rule).
  A share that fails for another reason, or a clipboard write that fails, falls back to the download.
- Resolves `'shared' | 'copied' | 'downloaded' | 'failed'` and toasts copied / downloaded / failed (the
  share sheet is its own feedback).

## Adopting it for a new log

1. Record entries `{ type, detail, t: Date.now(), ... }` to a capped `localStorage` key behind a flag
   read at every event (`isDebugLifecycleEnabled` in player.js is the model). Off = no timers, no work.
2. Add the switch, Export and Clear to Settings (setup.html, the existing `ui-switch` row and
   `ui-btn ui-btn--secondary ui-btn--sm` buttons in an `.action-bar`; no new CSS).
3. Write ONE pure formatter for the file (the model: `formatLifecycleLogForExport(entries, meta)` in
   setup.js) and a filename `<log>-<yyyymmdd-hhmmss>.txt` (`lifecycleExportFilename`).
4. In the Export click: read storage, format, call `exportDiagnosticLog` in the same turn
   (`wireLifecycleLogControls` in setup.js). Bind it with stubbed `navigator.share` / `canShare` /
   `clipboard` (`test/unit/lifecycle-log-export.test.js`) and prove it once in a real browser
   (`tools/log-export-proof/probe.js`).
5. Clear through `confirmDestructive`; a panel, if any, behind its own opt-in switch.

## Who follows it

- **The lifecycle log** (Settings > Troubleshooting > "Show lifecycle debug log", `ft-lifecycle-log`,
  player.js): since v1.362.2. Its panel is "Show the log on screen" (`ft-debug-lifecycle-overlay`).

- **The error log** (Settings > Troubleshooting > Export error log / Clear error log, `ft-boot-errors`,
  v1.364.0): every app shell's FIRST head script, a tiny ES5 recorder byte-identical across shells
  (`test/unit/boot-error-recorder.test.js`), keeps the last 50 script errors, failed script/stylesheet loads and
  unhandled rejections (under 64 KB). Two stated deviations: (1) it is ALWAYS ON, with no switch, because the phone
  that needs it may never reach Settings (the iPhone SE on iOS 15 showed only the app's frame); (2) besides the
  helper, the standalone `/errors.html` exports it with its own share -> clipboard -> download fallback and loads
  no app script, because common.js (which owns `exportDiagnosticLog`) may be what fails. That is the second
  exception to "one helper". Its limit: `/errors.html` reads the storage of the browser it opens in. An iOS
  Home Screen app keeps its own storage, separate from Safari's (pwa-ios-notes.md), and has no address bar, so
  the app's log is reachable only from the app's own Settings > Export error log; `/errors.html` in a Safari tab
  shows Safari's log. A Home Screen app whose Settings never opens has no way out today (the copy on both pages
  says so plainly).

## Logs that do NOT follow it yet (listed, not migrated; ROADMAP Planned > Chores)

- **The rotate log** (Settings > Troubleshooting > "Show rotate debug log", `?debugRotate=1`, common.js
  `installRotateDebug`): in memory only (lost on a reload), and its green panel copies the rows on a TAP
  (`navigator.clipboard.writeText` in the panel's click listener); no file, no Export button.
- **The background audio timing log** (Settings > Experimental > "Background audio timing log",
  `filetube_bg_timing_log`, setup.js `wireBgTimingLog`): recorded in `localStorage` and shown as a table in
  Settings; its Copy button writes the clipboard inside the tap, with a select-the-text fallback; no file
  share. Its Clear already asks first.
- **The touch target logger** (`?debugTouch=1`, common.js): writes to the browser console only, which a
  phone cannot read without a cable and a desktop inspector.
