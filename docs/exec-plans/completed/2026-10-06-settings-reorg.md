---
plan: settings-reorg
harness: v2 · lean
branch: feat/v1.367.0-settings-reorg
anchor: spec
status: Shipped v1.367.0
next: the builder (Sonnet) runs W1 (markup) -> W2 (aliases + member rows) -> W3 (tests + docs), then the gate
design: Dean's rulings 2026-10-05/06 (handoff at main 6bd384d6, v1.366.1 shipped) + the member-view answer 2026-10-06.
gate: APPROVED (adversary r2 @60b36546, qa r3 @dce8e2d1; security brief applied as a section by both)
---

# v1.367.0: Settings reorganized into SYSTEM, PERSONALIZE, ACCOUNT, LIBRARY, ADVANCED

MOVES AND RENAMES ONLY. No setting changes meaning, stored key, default, save route or who can change it. The one deliberate
visibility change is the member view below (Dean's answer, 2026-10-06).

## 1. Rulings (binding)

1. Groups and pages, in this order (`*` = saves through the admin-only `POST /api/settings`, which applies to everyone):

       SYSTEM       Scan & cache | Downloads | Notifications | Trash
       PERSONALIZE  Appearance | Home page * | Playback * | Mobile player | Critters
       ACCOUNT      Account | Users | Backup & Restore
       LIBRARY      Videos | Music | Books | Shows | Podcasts | Hidden
       ADVANCED     Troubleshooting | Experimental | Transcript sharing

   Rows: Scan & cache = Scan, Chapter snap, Transcode cache. Downloads = Downloader engine. Notifications = Download bell, Push
   notifications. Home page = Default view & sort, Home feed, Continue rows (was "Resume rows"). Playback = Autoplay, Resume
   prompt. Mobile player = Player sticker, Music skin, Bottom bar. Critters = Critter pool, Sound check (moved from
   Troubleshooting). Videos (was "FileTube Setup & Configuration") = folders, Imported videos. Music (was "Music folders") =
   folders, Channels in Music.
2. Home page and Playback each carry one plain line, "These apply to everyone on this FileTube", over their server-wide rows.
3. "Automation & Storage" disappears (rows distributed as above).
4. Old `#link`s and the remembered selection (`ft-md:setup`) land on the right new page; a mapping table is tested both ways.
5. Gate: adversary + qa (UI on every role; security brief as a section). Escalate if any save path or route changes.

## 2. The measured finding that shaped the member view

The census (`scripts/settings-census.js`, run on main before any edit; baseline: 109 controls, 0 unclassified) shows
"Automation & Storage" is visible to EVERY role today, and its rows are of three kinds: server-wide (`/api/settings`, admin-only
POST, so a member's save is refused), per-user (`/api/me/settings`: Home feed, Modern mode, Push), and per-device
(`localStorage`: Continue rows, Resume prompt, Remember sort, Bottom bar). Home page and Playback therefore MIX them; "members
never see these pages" would have taken Home feed, Continue rows, Remember sort and the Resume prompt away from members.

Dean's answer (AskUserQuestion, 2026-10-06): **show the page, hide the admin rows.** Applied as:

- A server-wide row group is `data-admin-only hidden` and revealed by the admin branch of `initAccountSection` (the same place
  Users/Backup are revealed). Members never see it, and its "These apply to everyone" line goes with it.
- Wholly server-wide pages (Scan & cache) are admin pages (`hidden data-md-reserve data-admin-only`) like
  Downloads, so a returning admin gets the shimmer slot and a member never gets a row.
- Notifications: page is shown to an admin always, and to a member only when the push probe says push is on (the one member row).
- Trash stays visible to every role (it is per-user, visibility-filtered). So a member's SYSTEM group holds Trash (and
  Notifications when push is on). DISCLOSED: Dean wrote "members start at PERSONALIZE"; the member menu still lists SYSTEM first
  when it has a page for them. Not changed without a ruling.
- Left exactly as today (not named by the answer): Imported videos, Channels in Music (library-write), Bottom bar (device),
  Trash retention (server-wide select inside Trash, inert for members as now), Experimental/Transcript sharing rows.

## 3. Page ids (old -> new)

| old `data-collapse-key` | new | note |
|---|---|---|
| appearance, mobile-player, critters | same | gain `data-md-group="Personalize"` |
| automation-storage | scan-cache (fallback) + home-page, playback, notifications | an old link to the split page lands on Scan & cache |
| video-folders | videos | title "Videos" |
| music-folders | music | title "Music" |
| book-folders | books | title "Books" |
| tv-folders | shows | title "Shows" |
| podcasts-place | podcasts | |
| downloads, trash | same | |
| feedhidden | hidden | group System -> Library |
| account, users, backup-restore | same | |
| troubleshooting, experimental | same | |
| transcript-ai | transcript-sharing | |

`data-md-aliases` on the `.md-root` carries the table; `wireMasterDetail` resolves a URL hash and the stored `ft-md:<page>`
selection through it (and rewrites the stored value). Nothing else stored is keyed by these ids (the open/closed state is the one
`ft-md:setup` selection; verified by grep: no `ft-collapse` key exists in public/js or lib).

## 4. Falsifiers

F1. Census diff: `node scripts/settings-census.js --controls` on main vs branch. Allowed differences: ONLY `roles` all -> admin
    for the rows named in section 2. Any other change in (id, save path, roles) fails the wave.
F2. Alias table both ways (test): every old id resolves to a live new key in the real setup.html; every new key resolves to itself;
    a stored old selection is rewritten; an unknown hash is ignored.
F3. Member jsdom run of the real setup.html + setup.js: no `data-admin-only` row visible; Home page, Playback show only personal
    rows; Scan & cache absent from the nav.
F4. Phone and desktop before/after, as admin and as member (rows wrap, buttons never shrink).

## 5. Build waves

- W0 (done, b2534db3): device checks 39-46 passed, deleted.
- W1: setup.html restructure + the census script committed with its baseline.
- W2: aliases in common.js; member rows.
- W3: tests, docs (CONFIGURATION.md, ROADMAP, device checks paths), release.

## 6. Verdicts

Adversary r1 CHANGES @4768ecb1: W1 an admin's old #automation-storage link and remembered selection landed on Trash (the target page
is hidden when the menu is wired; fixed with a pending key, tested in the real wire-then-reveal order); W2 a dangling "Push
notifications" heading (moved inside the hidden push group); W3 the member Notifications reveal unbound (bound). Census diff
measured: exactly the 11 named rows change role; no route change.

Gate: APPROVED r2 @60b36546 - adversary

QA r1 CHANGES @4768ecb1 (M10 survived: the push reveal unbound; two stale comments). r2 CHANGES @60b36546 (P3 survived: jsdom's late
hashchange masked the hash branch of the pending key). Fixed in dce8e2d1 (history.replaceState): P3 killed 6 of 6, 0 flakes in 10.
Real-script jsdom runs for member and admin, push on and off: no throw, member nav 16 or 17 rows, no admin row visible.

Gate: APPROVED r3 @dce8e2d1 - qa

Security brief (applied as a section by both seats): `git diff origin/main -- lib` is two comment lines; no route, handler, save path
or middleware changed; the member view is UI only and the server still enforces every admin route. No finding.

Gate: APPROVED r2 @60b36546 - security-brief
