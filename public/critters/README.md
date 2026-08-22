# Sneaky critter mode - the critter folder

Drop your critters HERE. The folder is the manifest - no code changes, no lists
to edit. FileTube re-reads it on every page load.

The contract:

- **Any image file in this folder becomes a critter.** PNG (transparent
  recommended), WebP, GIF, SVG, or JPEG. File names do not matter and are never
  referenced in code.
- **Size does not matter.** Drop in the biggest, crispest renders you have - the
  app scales every critter down to its little on-page footprint automatically.
- **A sound file with the SAME base name becomes that critter's tap noise.**
  Example: `mopsy.png` + `mopsy.mp3` means tapping Mopsy plays `mopsy.mp3`.
  MP3, WAV, M4A, or OGG. A critter without a matching sound gets the built-in
  chirp.
- **No duplicates on a page**: each critter appears at most once per page, so
  the more files you add, the fuller the higher density tiers get (Obscene shows
  up to 16 distinct critters when the folder has 16+ images).
- While this folder holds no images, the app shows its three built-in
  placeholder figurines instead.
- **Real files only** - a symlink to an image elsewhere is skipped; copy the
  file in.
- Files are picked up on the next full page load (a refresh), or immediately
  when you re-apply the setting under Settings -> Appearance. In-app navigation
  alone keeps the session's cached list.

Turn the mode on under Settings -> Appearance -> Sneaky critter mode.
