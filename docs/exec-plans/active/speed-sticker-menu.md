# Exec plan: the speed-modifier "sticker" menu

Status: ACTIVE (targeting v1.238.0)
Branch: `feat/speed-sticker`
Owner: main session (lean mode)
Gate: FULL two-reviewer gate. **Data-touching** (a per-user uploaded image is
persisted server-side) -> per the destructive-work norm this is NEVER slim; the
adversarial seat is briefed to DESTROY the stored sticker data and attack the
upload endpoint.

## Intent (Dean)

> "A 'sticker' of the FileTube logo on the bottom-left-hand corner of the virtual
> iPod/interfaces that opens a menu that would show speed etc." ... "make the
> sticker an optional setting in the menu that defaults on the logo but can be
> updated."

A small sticker sits in the bottom-left corner of every music-player skin (and the
desktop pop-out). Tapping it opens a compact menu with **speed + loop + a skin
picker**. The sticker's ICON is a user setting that defaults to the FileTube logo
but is changeable - and (Dean's pick over preset/emoji-only) can be a **custom
uploaded image**, alongside a small preset gallery and an emoji option.

## Locked decisions (Dean)

1. Menu contents = **speed + loop + skin picker**. (Confirmed prior session.)
2. On **all skins + the desktop pop-out**. (Confirmed prior session.)
3. The sticker ICON is a **setting** defaulting to the FileTube logo, **changeable**.
4. Icon source (this session): **preset gallery + emoji + custom upload**.

## Design decisions (mine - overridable; flagged for Dean in the report)

- **Scope of the sticker choice = PER USER, self-service** - it is a personal
  decoration of *your* player, exactly like the v1.82 profile avatar. It is NOT
  instance-global (that is the admin logo) and NOT device-local for the custom
  image (a blob can't live in localStorage sensibly and should follow you between
  devices like your avatar does).
- **Custom upload mirrors the avatar pattern VERBATIM** (`server.js` ~9573): a new
  self-service `POST /api/me/sticker` (route-scoped `express.raw`, allowlisted
  Content-Type + magic-byte sniff, 1 MB cap, atomic tmp+rename), a self-only
  `GET /api/me/sticker` serve (sniffed mime, `nosniff`, `?v=<mtime>` cache-bust),
  and `DELETE /api/me/sticker` to reset to the chosen preset/logo. Disk-only at
  `DATA_DIR/stickers/<userId>.bin`, presence-IS-state, NO persisted db metadata ->
  so **no schema bump, no persist-gate field, and (like avatars) NOT in the backup
  bundle** - the deliberate v1.82 S4 precedent. Reaped on the user-delete cascade
  next to `unlinkAvatar`.
- **The non-custom choice (logo | preset-id | emoji) is device-local** - a
  `localStorage['ft-sticker']` JSON `{ kind, value }`, mirroring the device-local
  skin choice (`ft-music-skin`). `kind:'custom'` means "fetch `/api/me/sticker`".
  Default (unset) = `{ kind:'logo' }`.
- **The menu items are PROXIES / reuse, no new engine and player.js BYTE-UNCHANGED:**
  - speed: consume the exported `PLAYBACK_RATES` + `buildSpeedMenuModel` and set the
    rate through the SAME path `#speed-btn`'s picker uses (no new rate list).
  - loop: read `window.FileTube.player.isLoopEnabled()` / write `setLoop(on)` (FR-7).
  - skin picker: reuse `music-skins.js setActiveSkin()` + the registry, the same
    call `setup.js renderMusicSkinPicker` makes.
- **Rendering:** the sticker + menu are rendered by the skin engine so they land on
  EVERY skin and the pop-out uniformly (a shared `renderSticker(panel)` /
  `bindSticker(panel)` beside `bindSkinSurface`/`paintSkin`), never per-skin markup.

## Task commits (each green before the next)

- **T1 - server: per-user sticker upload/serve/delete + cascade + tests.** The
  avatar-pattern endpoints; unit + integration tests (RBAC self-only, magic-byte
  reject, oversized 413, traversal-proof numeric id, cascade unlink). No client yet.
- **T2 - client: the sticker element + menu shell on every skin + pop-out.** The
  shared `renderSticker`/`bindSticker`; tap opens/closes a popover; source-locked to
  appear on all registered skins + the pop-out panel (shell-coverage test, the v1.230
  lesson). Icon resolves from `ft-sticker` (logo default).
- **T3 - client: wire the three menu items** (speed rows from `buildSpeedMenuModel`,
  loop toggle proxying `setLoop`, skin chips via `setActiveSkin`). Behavioral tests
  that each item drives the REAL target (anti-INERT: prove reachability, not just a
  helper).
- **T4 - settings: the sticker-icon picker** (logo | preset gallery | emoji | upload)
  in setup.html/setup.js, reusing `loadHomeRowControl`/the skin-picker idiom; writes
  `ft-sticker` and POSTs the upload. Tests for each kind + the upload round-trip.
- **T5 - CSS:** sticker + menu styling via design tokens (lint:css must stay TOTAL 0),
  bottom-left placement on each skin + pop-out, `[hidden]{display:none!important}` on
  the menu, `env(safe-area-inset-*)` where it hugs a corner.

## Machine-derived predictions (re-verified at every commit)

- player.js diff vs `main`: **0 bytes** (`git diff main -- public/js/player.js | wc -l` = 0).
- lint:css TOTAL: **0**.
- New endpoints: exactly **3** (`POST`/`GET`/`DELETE /api/me/sticker`); no `:id` WRITE
  route (self-service only - the avatar RBAC posture).
- Skins carrying the sticker: **all** registered skins in the music-skins.js registry
  + the pop-out panel (count asserted from the registry, not hand-listed).

## Gate brief - named attack surfaces (adversarial seat)

- **Destroy the data:** corrupt/truncate/delete `stickers/<id>.bin` mid-serve; upload
  a valid header + garbage tail; two concurrent uploads (the logo's v1.32 race);
  confirm a failed upload never leaves a `.tmp` and never half-writes.
- **Traversal / RBAC:** non-numeric / negative / huge id; a member trying to set
  ANOTHER user's sticker (must be impossible - no by-id write route); an unauth GET.
- **Magic-byte bypass:** `Content-Type: image/png` with non-PNG bytes; a polyglot;
  an SVG (must be rejected - not on the allowlist, XSS vector).
- **Backup:** confirm the sticker is intentionally NOT in the bundle AND that its
  absence can't ERASE anything on restore (the v1.198 db.tv-erase class) - presence-
  is-state on disk means restore is a no-op for stickers, prove it.
- **Cascade:** delete a user, confirm the sticker file is reaped (no orphan, no
  id-reuse leak).
- **INERT:** mutate each menu item's target binding (speed setter, `setLoop`,
  `setActiveSkin`) and confirm a test REDS - the item must drive the real control.
- **player.js:** byte-identical to main.

## Residuals / non-goals

- No animated/GIF stickers (static image only - the allowlist is png/jpeg/webp).
- Custom sticker is per-user, not shareable/instance-wide (that's the admin logo).
- Emoji rendering uses the platform font (no bundled emoji set).
