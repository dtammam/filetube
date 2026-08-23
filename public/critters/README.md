# Critters - the critter folder

Drop your critters HERE - or characters, or anything with a transparent background. The folder is the manifest - no code changes, no lists
to edit. FileTube re-reads it on every page load.

The contract:

- **Any image file in this folder becomes a critter.** PNG (transparent
  recommended), WebP, GIF, SVG, or JPEG. File names do not matter and are never
  referenced in code.
- **Size does not matter.** Drop in the biggest, crispest renders you have - the
  app scales every critter down to its little on-page footprint automatically.
- **A sound file with the SAME base name becomes that critter's tap noise.**
  Example: `mopsy.png` + `mopsy.mp3` means tapping Mopsy plays `mopsy.mp3`.
  MP3, WAV, M4A, or OGG. Names do not have to match (v1.179): a critter
  without its own sound BORROWS one of the folder's sounds and keeps that
  same borrowed voice everywhere - the built-in chirp appears only when the
  folder has no sounds at all. An exact-name match always wins.
- **No duplicates on a page**: each critter appears at most once per page, so
  the more files you add, the fuller the higher density tiers get (Obscene shows
  up to 16 distinct critters when the folder has 16+ images).
- While this folder holds no images, the app shows its five built-in
  placeholder figurines instead (bunny, cat, bear, fox, chick).
- **Real files only** - a symlink to an image elsewhere is skipped; copy the
  file in.
- Files are picked up on the next full page load (a refresh), or immediately
  when you re-apply the setting under Settings -> Critters. In-app
  navigation alone keeps the session's cached list.

Turn the mode on under Settings -> Critters.

**Prefer a browser?** Since v1.171 an ADMIN can manage this folder from
Settings -> Critters -> Critter pool: upload images and sounds, delete
one critter or the whole pool, and download everything as a zip. The web UI
writes to THIS folder - both routes stay in sync because the folder itself is
the only source of truth. (Web upload accepts PNG/JPEG/WebP/GIF and
MP3/WAV/M4A/OGG; SVG works only as a hand-dropped file here.)

**Running under Docker?** The image bakes `public/` in, so THIS folder on your
host is only seen by the container through the volume mount that
`docker-compose.yml` ships (`./public/critters:/app/public/critters`). If you
run with plain `docker run` or an older compose file, add that `-v` mount -
otherwise files you drop here never reach the app. If you run compose WITHOUT a
git checkout, Docker auto-creates the host folder ROOT-owned - `chown` it (or
create it yourself first) so you can drop files in without sudo.
