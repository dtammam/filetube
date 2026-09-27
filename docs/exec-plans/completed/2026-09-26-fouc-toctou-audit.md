---
plan: fouc-toctou-audit
harness: v2 · lean
branch: feat/v1.339-fouc-toctou
anchor: outcome
status: Shipped v1.339.0
next: shipped v1.339.0; Dean's device pass (tech-debt #287 lists the checks)
design: pending
gate: APPROVED r4 @ab880c99 (adversary + qa + security-brief); safety checkpoint approved r2 at f8a7ee52 after r1 CHANGES fixed in F1-F3; final delta approved r3 at 03a1f634; r4 = the qa W1 comment-only fix; residuals filed as tech-debt #287
---

# Audit: FOUC / layout shift / TOCTOU across the app

Captured 2026-09-26 (Dean, ROADMAP "Audit: TOCTOU / FOUC across the app"). Started as an audit (the
findings below); after Dean's triage the same plan carries the fix branch (see "Triage and build plan").

## The ask (Dean's words, 2026-09-25)

"I'm noticing in um, the music player, like I'll see the thumbnails all kind of loading somewhat
individually. It just feels like odd. And then there's like some slight page shifting. I just want an
overall audit of all the potential places. In some places we've solved it and it's pretty good. And
here, maybe not."

## Intake (2026-09-26)

- Where: every music surface - Music home shelves, Songs / Albums lists, album / artist drill,
  Now playing / queue. When: BOTH cold (first open) and warm (returning to a screen just seen).
- Target reveal: **reveal together** - keep the shimmer, reveal the on-screen set as one moment
  (with a cap so one slow image cannot hold the rest), not tile-by-tile.
- Scope: FOUC and TOCTOU in ONE audit doc, audit only, stop for Dean's triage.

Framing notes from intake:

- The tile-by-tile pop is the DESIGNED behavior: the v1.102 sweep reveals each `art-shimmer` image
  the instant it decodes (`shimmerArt`, public/js/common.js:101; music.js render). So the music
  finding is a policy change, not a missing guard.
- Hypothesis (unverified): `/albumart/:id` serves the full-size cover file (lib/music/routes.js:494)
  into ~50px tiles; per-image decode cost on iOS spreads the reveals even when warm (HTTP cache is
  `private, max-age=86400`). Falsified if the served art is already small, or warm reveals land in
  the same frame.
- The August audit (docs/exec-plans/archive/fouc-shimmer-audit.md, v1.95) and the v1.98-v1.102
  sweep already covered the app; this audit is the DELTA since v1.102.0 plus the open residuals
  (tracker #140, #141).
- FOUC (visible) and TOCTOU (invisible correctness race) are different kinds; they are reported in
  separate sections and triaged separately.

## Acceptance (what a pass looks like, per surface, cold and warm, 390x844)

- Layout-shift score 0 after first contentful paint (Layout Instability API, sources named).
- On-screen tiles reveal within ~1 frame of each other (reveal-together), capped.
- A warm revisit shows no shimmer.
- TOCTOU: every check-then-act across an await re-validates after the await (LESSONS "A pre-await
  guard is NOT a post-await guard").

## Findings

### FOUC - Music (measured), pass returned 2026-09-26

Instrument: `scripts/music-fouc-probe.js` (new, uncommitted). Seeds 40 tracks / 10 albums / 5
artists with 1200px and 600px covers plus 3 library-audio items; headless Chromium over CDP;
390x844@3 with 4x CPU and 1440x900@1; cold, warm-spa and warm-tab; `--net=Mbps,rtt` and `--art=px`
for A/B. Two noise runs agree within ~0.01 CLS. Raw output in the session scratchpad
(`musicprobe-run2`, `-run3`, `-art240`, `-net`, `-net240`).

**M1 - the "slight page shifting" is ONE element, not images (Architect verified).**
`section#music-jumpback` ships `hidden` ABOVE the tabs (public/music.html:201) and is filled and
unhidden only after its own `/api/music?filter=recent-listening` fetch (music.js:2085-2096, called
at :4086 independently of the tab render). Tabs and content drop 181px. CLS **0.14 on every mobile
tab, cold AND every SPA return**; 0.04-0.09 desktop (0 when the fetch beats first paint). Nothing
reserves it. Fix shape: last-known-has-items reserve (the v1.99 pattern), or co-reveal with the tab
render.

**M2 - full-size art confirmed; the cost is BYTES + per-track duplication, not warm decode.**
`/albumart/:id` sends the stored file (lib/music/routes.js:494-510); `extractAlbumArt` keeps native
size. 1200px covers land in 40-108px boxes (20-80x the needed pixels at DPR 3). Song rows, queue
rows and Jump-back tiles request `/albumart/<trackId>` (music.js:204, ~123), so a 12-track album
downloads and decodes the same cover 12 times (the cache keys on URL). Cold transfer: Home 4.0-4.7MB,
Songs 6.5MB for 10 visible rows, Albums 3.3-4.3MB. At 20Mbps/40ms the cold reveal spreads 0.7-1.25s
over 4-10 frames; with 240px covers 0.12-0.25s over 2-4 frames and ~620KB (-85%). Fix shape: a sized
art rendition (e.g. 256/512 by DPR) plus art URLs keyed by the ART (albumArtKey), not the track.

**M3 - warm one-by-one is NOT reproduced headless.** Warm: 0 in-view images shimmered on any
surface; reveals in 1-2 frames from memory cache; Chromium holds the frame until decode, so text and
art paint together. iOS WebKit decodes large images asynchronously and paints each as it finishes -
a plausible cause of Dean's warm pop that this instrument cannot represent. Needs a device capture;
M2's smaller art shrinks it either way.

**M4 - small shifts:** sort control hidden on Home / shown elsewhere reflows the toolbar (0.019 on
every Home entry; music.js:2449-2450, music.html:102); "Playing from" line pushes content 28px when
a track starts (music.html:216, music.js:2115-2127); cold header-right / bottom-nav injection
~0.001-0.004 (shared with the non-music findings). Album / artist drills and Now playing are clean
(CLS <= 0.002; desktop Now playing 0.50 is the intended full-player expansion).

**Reveal-together (Dean's pick) vs these numbers:** on a warm visit there is nothing to batch
(already one frame in Chromium); on cold, batching 4MB of art makes the whole screen wait for the
slowest cover. Smaller, de-duplicated art first, then batch the remaining cold reveal with a cap.

### FOUC - non-music surfaces, delta since v1.102.0, pass returned 2026-09-26

Top line: no August "done" row strictly regressed. The gaps are (a) sweep fixes seeded AFTER a 2-round-
trip await (never covered the cold path), (b) post-fetch chrome injectors never swept (header queue /
Download, bottom-nav You / Subs / Download, sidebar Library entries), (c) video-card thumbnails never
got `art-shimmer` (the same tile-by-tile pop Dean reported in Music), (d) two inert features. Classes:
OLD-GAP = pre-v1.102, never swept; NEW-GAP = added since; PARTIAL = fix sits behind the await it was
meant to cover. Architect spot-checked: tv.js has 0 `shimmerArt` calls; no `.queue-btn[hidden]` /
`.btn[hidden]` rule exists.

**Bugs found along the way (not cosmetic):**
- `.queue-btn{display:flex}` and `.btn{display:inline-flex}` beat `[hidden]`: the header queue button
  shows with an empty queue; Settings' perf-diag Open, Remove image, logo Remove and push enable /
  disable show in every state (common.js:4411; style.css:996, 14188; setup.html:235, 243, 612, 943).
- TV posters: `art-shimmer` applied, `shimmerArt` never called - shimmer animates forever, a 404 poster
  shimmers forever (tv.js:49, 65, 91). Inert feature.
- Read PDF: resume `await renderPage` is inert, resume can land on page p-1 (read.js:682-686).
- Podcasts drill: Back during the episodes fetch paints the old show over the grid (= T-C8).

**High / med-high (every load of a primary surface):**

| Surface | Finding | Class | Anchors | Fix shape |
|---|---|---|---|---|
| Video card thumbs (classic/modern/Liked/search/folder) | 16:9 box reserved but no `art-shimmer`: skeleton -> black -> picture, tile by tile | OLD-GAP | main.js:2579; style.css:1614-1628 | same reveal-together policy as music |
| Grid skeleton vs real card | skeleton `.video-info` ~30px vs real ~90px: every card grows ~60px on reveal; "zero shift" comment is false | OLD-GAP | main.js:67-90; style.css:2055-2186 | size skeleton lines to real line boxes, measure |
| Header queue btn | injected after `/api/queue`, no reserve, shifts search box; `[hidden]` inert | OLD-GAP + bug | common.js:4332-4411 | `[hidden]` guard, last-known reserve, #140 anchor |
| Header Download btn | ~100px appended after health probe, shifts search box | OLD-GAP | common.js:7080-7086 | reserve from remembered flag |
| Bottom nav You / Subs / Download | appended post-fetch, `flex:1` re-spaces every tab; mask glyphs pop on iOS; 5-min sessionStorage cache = cold PWA launch has none | OLD-GAP | common.js:6548-6578, 3196, 7102, 4830 | static slots in shells, inline SVG, unhide from remembered flag |
| Modern chips + avatar-bar reserve | chips (~54px) + reserve (~98px) land above the painted skeleton after 2 serial awaits | PARTIAL (v1.99) | main.js:1360-1364, 1559-1835 | paint synchronously at mount |
| Sidebar Library entries / Liked / Subs | six probes each insert a row ABOVE folders; mask glyphs | OLD-GAP | common.js:4644-4681, 14001-14056, 3184 | last-known entry-set placeholders |
| Watch channel row | cached pass renders `subs \|\| []`: subscribed channel paints "Subscribe", no Notify, then flips | hole in v1.54 fix | watch.js:2744-2746; common.js:3140, 3383-3388 | render cached only when `subs` is an array |
| Books Continue shelf | unhides ABOVE the grid after a separate fetch (August row 27, never fixed) | OLD-GAP | books.js:161-174 | co-reveal or last-count reserve |

**Medium:** feed-mode skeleton behind the same awaits (main.js:538, 1884); modern view toggle + sort
injected post-await, search box slides ~90px (main.js:1795-1832); card corner glyphs are masks (iOS
pop, main.js:719-782); row-card covers lack `art-shimmer` (main.js:159-290); search books row inserted
ABOVE results and duplicates unified search (main.js:3505-3516); folder/channel header double text swap
(main.js:1395-1413, 1608-1613, 2021-2025); bell panel "Loading..." then rows, no shimmer, mask delete
glyph, no `[hidden]` guard (common.js:3811-4041); watch channel row pops additively when cache >5 min
(watch.js:2737-2770); theatre reserve starts post-fetch (watch.js:2181-2234); TV episode back-link
inserted above the title (watch.js:4145-4156); TV shows grid no skeleton, serial fetches (tv.js:139-208);
podcasts drill re-seeds skeleton over a loaded list on every refresh, loses scroll (podcasts.js:434,
393-396, 817, 830, 1166); podcasts drill skeleton shape ~100px short (podcasts.js:1455-1468, 489-492);
podcasts pin label swap (August row 24, podcasts.js:553-568); books shelf chips strip (August row 28,
books.js:185-235); Read topbar controls unhide post-fetch as masks (read.js:851-857, 994-1001); /subscriptions
blank 1 round trip + short skeleton (subscriptions.js:4689, 4114-4123); Settings Appearance pickers pop
in and a sticker click cache-busts with `Date.now()` (setup.js:608-640, 1406-1479).

**Low / low-med:** Continue/feed skeleton text lines off +9/-4px (main.js:348-385); folder heading
pencil / music toggle / Attribute late pops (main.js:2046-2254); item-count badge (August row 6,
common.js:1660-1670); Pinned sidebar cold reserve (#141, see housekeeping); sidebar folders on
non-home shells (watch.js:1344, setup.js:89); custom logo width swap (common.js:13939-13981);
prefs-sync live theme flip leaves icons/stars/logo stale (prefs-sync.js:167-190); wide-monitor player
slot shrinks on mount (style.css:13381-13389 vs 9453-9457); chapter label / theatre btn narrow the
seek bar (player.js:2808-2821); watch action-row mask glyphs (watch.html:237-256); watch avatar /
related / up-next thumbs no shimmer (watch.js:1546-1558, 1783, 4230); podcasts now-playing two-pass
(podcasts.js:1005-1045); books grid skeleton short + re-seed on sort (books.js:54-145); Read EPUB
status then refit; PDF holders all 200px, "page 1 ratio" comment false (read.js:624-631); history
mask glyphs (history.js:103-105); Settings selects flash default (setup.js:1850-1935); Settings lists
no skeleton; Stats av-list + table skeleton shape (stats.js:715-739); pre-paint guard test enumerates
a hardcoded shell list (test/unit/pre-paint-fouc-guard.test.js:28); #140 queue/bell order.

**Solved and still good at HEAD:** pre-paint FOUC guard in every shell; watch metadata seed paint;
watch action-row `data-loading` barrier (every post-v1.102 control joined it); related + TV up-next
rail skeletons; classic toolbar; card corners / BR slot decided before first render; search chips;
stars; Continue-row cover reserve; avatar-bar reserve (v1.99); home sidebar folder skeleton; account
avatar / You avatar / bell placeholders; You-menu shimmer rows; admin nav reserve; Settings checkbox
barrier; Stats tiles; podcasts shows grid + art; books covers; history rows; overlays (handoff, resume,
ambient, transcode) never push content.

**Tracker housekeeping:** #141(a) is stale (`primePinnedSidebarFromCache` called since v1.117,
common.js:16531; the cold reserve is still missing); stats.js:733-738 claims "accepted as tech-debt"
with no row; main.js:67-70 and read.js "page 1 ratio" are lying comments.

### TOCTOU - client (public/js), pass returned 2026-09-26

**T-C1 HIGH, DATA LOSS (confirmed by reading, Architect re-verified; no device repro yet).** The home
sidebar drag-reorder POSTs the page's LOADED folder list back to `/api/config`
(public/js/main.js:2729-2761, `rebuildFullFolderOrder(allFolders, ...)`); the server replaces both
tables wholesale (`folderStore.replaceAll` / `folderSettingsStore.replaceAll`,
lib/config/routes.js:577-585) then fires `scanDirectories()` (:605). A folder absent from the stale
list is no longer configured, so its entries fall through to normal pruning (lib/scan/roots.js:77-80):
metadata, progress and thumbnails reaped; other folders' renames / hidden flags / glyphs reverted.
Interleaving: home open on device A; folder C added (or a folder renamed/hidden) on device B or in
Settings; drag a sidebar row on A. The cached-home path widens it (`restoreSidebarFn` re-renders the
init-time copy, main.js:1141, common.js:10718). Same class: setup.js:342-349 (setup sidebar) and
2527-2530 (Save). Fix shape (full destructive gate): a reorder-only route that re-orders the server's
CURRENT folder set by path and can never add or remove one, or a config `version` with 409 on stale
(the chapters-editor pattern).

| # | Area | Race -> outcome | Sev | Anchors | Fix shape |
|---|------|-----------------|-----|---------|-----------|
| T-C2 | Player ended advance | `fallbackToTrackNav` lacks the `currentId === endedId` re-check its sibling has; Next at a track's end skips 2 | Med-low | player.js:5474-5477, 5521 | one-line identity re-check |
| T-C3 | Outgoing item's final progress | teardown pauses then clears src before the pause save lands; resume point up to ~4s behind on every switch | Low-med | player.js:8530-8549, 9226-9228, 5245-5261 | save `currentAbsTime()` before pause |
| T-C4 | Skin Extras Move/Delete | modal outlives auto-advance; confirm closes the NEW item's playback | Med-low | skin-surface.js:430-437, 452-455, 492 | close only if `currentId` still equals the item |
| T-C5 | Music deep-link continuations | no `signal.aborted` after awaits; late `playAt` replaces a video, late `location.replace` hijacks nav, late `registerTrackNav` overwrites lock-screen nav | Low-med | music.js:3938-3963, 4035-4056, 4072-4078, 4129-4134, 3557-3562 | abort re-check after every await |
| T-C6 | Music browse `render()` | no per-render generation; a stale tab/sort/drill response paints over the active one | Low | music.js:2764-2807, 2663, 2576-2600 | `renderGen` in `stillMine` |
| T-C7 | Music Shuffle | superseded `loadSongs` returns the live queue; plays row 0 unshuffled / wrong list | Low | music.js:2599, 2511-2513, 2974-2977 | return null when superseded |
| T-C8 | Podcasts show open | only `signal.aborted`, never `currentShow`; A overwrites B's episodes + prev/next | Low | podcasts.js:429-446, 1276-1300 | show-id re-check (1022-1033 pattern) |
| T-C9 | Classic infinite scroll | no token; old filter's page appended to new grid (sibling of #138) | Low | main.js:2405-2420 | mirror `modernReqToken` |
| T-C10 | Hide-from-feed undo | restore appends old card to a reset grid, skews offset | Low | main.js:3309-3345 | grid generation |
| T-C11 | Watch autoplay toggle | listener attached after GET; the GET reverts a quick tap | Low | watch.js:2056-2075 | attach before GET |
| T-C12 | Router in-view back | in-view pop doesn't bump `navGeneration`; a pending nav lands after back | Low | common.js:10820-10870, 11011-11033 | bump on every popstate |
| T-C13 | First-boot pref seeds | "never chose" check not re-read after `fetchCurrentUser` | Low | common.js:276-302, 432-439, 541-553 | re-read after await |
| T-C14 | Queue panel + bell | unsequenced renders resurrect deleted rows; tap during 300ms fade lost | Low | common.js:4424-4604, 4036-4119 | render seq + sync `isOpen` |
| T-C15 | Pins / Liked / search history | ungenerationed repaints, stale pin cache (plausible) | Low | common.js:11296-11380, 14001-14054, 6438-6511 | generation stamps |
| T-C16 | Ended vs replay / Loop | replay during the ended round trip still advances (plausible) | Low | player.js:5455, 5528-5583 | ended-generation token |
| T-C17 | Progress write ordering | unordered progress/save(0) fetches; last arrival wins (plausible) | Low | player.js:5215-5331, 5763; music.js:3186-3191 | client seq, server drops older |

### TOCTOU - server (server.js, lib/), pass returned 2026-09-26

Base fact: `updateDatabase` (server.js:783) is a fresh-load-in-lock sync mutex over synchronous
node:sqlite, so races exist only where code reads, awaits real async work, then acts on the old read.

**T-S1 CRITICAL, DATA LOSS (confirmed; yt-dlp behavior verified at primary source).** A one-off
download argv carries `--force-overwrites` (lib/ytdlp/args.js:1283-1284) and writes straight into the
library folder under a deterministic name (`%(title)s [%(id)s].%(ext)s`, args.js:289/1124-1130,
-o at :1318). yt-dlp master `YoutubeDL.existing_file` (YoutubeDL.py:3323-3330): with `overwrites`
true it `os.remove`s every existing output file BEFORE downloading. So: re-requesting a URL already
in the library (same folder, same title) deletes the user's copy first; if the second download then
fails (cancel, 403, timeout, ENOSPC) the partials are cleaned and NO copy remains; a scan then prunes
the item's per-user state. No route-level already-in-library or in-flight dedup (index.js:4363).
Reheat is NOT affected (metadata-only, `--skip-download`, run.js:1557-1611). Fix shape: drop
`--force-overwrites`; download to a temp path and rename over the original only on success, or
refuse / single-flight a one-shot whose target already exists.

**T-S2 HIGH, DATA LOSS (confirmed by reading).** Media scan Phase-2 prune vs trash-restore: the
prune set is computed from the Phase-1 snapshot, so an item trashed then restored while the walk is
in flight is dropped by the merge and its progress, likes, view count, manual chapters and sourceUrl
removed (lib/scan/orchestrator.js:1219-1231, 1259-1290, 1873-1926; merge.js:69-78). Mirror of #4, not
covered by it. Fix: inside the final mutator drop an id from `prunable` if it is live with its file on
disk; unlink sidecars / prune per-user state only for ids actually pruned in that commit.

**T-S3 HIGH, DATA LOSS (confirmed by reading).** Music / books / TV scans vs admin restore: only the
media scan checks `persistedStateEpoch` (orchestrator.js:1338); the others prune restored per-user
state (lib/music/scanRunner.js:46-99; lib/tv/scanRunner.js:42-90; lib/books/scanRunner.js:40-110).
Fix: capture the epoch at Phase-1, abandon the merge and its prunes on mismatch.

**T-S4 HIGH, DATA LOSS (low likelihood).** Scan same-inode trash-leftover reconcile uses a stale
Phase-1 trash record; after a restore whose trash-side unlink failed, the scan unlinks the restored
file, and the orphan trash bytes are later swept (orchestrator.js:533-575; trash.js:747-752,
930-938). Fix: re-read `trashStore.get` after the `destroyMediaStreams` await (the :704-722 pattern).

**T-S5 CRITICAL, DATA LOSS (very low likelihood).** trashItem's post-commit window (up to 3s awaiting
`destroyMediaStreams`) vs a restore's same-inode heal: both links unlinked (trash.js:359-371 vs
575-583, 745-748). Fix: re-check before the source unlink, or an in-flight set that makes restore
refuse `alreadyLinked` while a trash of that id runs.

| # | Area | Race -> outcome | Sev | Anchors | Fix shape |
|---|------|-----------------|-----|---------|-----------|
| T-S6 | Login vs admin password reset | login mints a cookie at the new token_version; rehash overwrites the reset with the OLD password | Med (creds, very low likelihood) | lib/auth/routes.js:108-120 | re-read after scrypt; CAS rehash |
| T-S7 | Podcast poll finalize vs restore / unsubscribe | unconditional status set resurrects a trashed episode, orphans bytes | Med | lib/podcasts/index.js:302-501; store.js:259-309 | epoch + `{from:[...]}` guards |
| T-S8 | Subscription DELETE / pause mid-poll | removed / paused channel still downloads | Low-med | lib/ytdlp/index.js:3637, 3775, 5621-5626 | latch-and-kill on delete/pause |
| T-S9 | DELETE /api/videos/:id on trashItem 404 | double DELETE re-mints a tombstone; delete racing a move reports success | Low | lib/media/routes.js:1075-1290; trash.js:139-141, 345-351 | distinguish record-gone vs ENOENT |
| T-S10 | Transcode / audio-extract finalize | stale transcode served after in-place replace; orphans after move | Low-med (cache) | lib/media/transcode.js:571-819; move.js:549-581 | re-stat before rename |
| T-S11 | Scan sidecars to final paths | half-written poster/clip served and cached | Low-med (cache) | orchestrator.js:258, 338; streams.js:142-222 | tmp + rename |
| T-S12 | Small, self-healing | ALAC eviction mid-album, faststart rename over moved file, avatar orphan, push resubscribe, double queue add, backup misses ~5s progress | Low | music/routes.js:480-483; faststart.js:137; auth/routes.js:482-508; push/routes.js:82-97; backup.js:532 | as named |

Server known-open touched, not re-reported: #4, #22, #36, #38, #52, #65, #80, #85, #143, #202.
Server well guarded: the write chain + epoch, media-scan single-flight / carry-forward / tombstone
re-check, move (no-clobber link, verify, re-key rollback), trash vs purge, chapters version token,
coalescers, single-worker media caches with tmp+rename, yt-dlp heavyGate / poll single-flight /
reheat 409, auth UNIQUE + tokenVersion, prefs LWW in SQL, podcasts `.ptpart` + guarded sweeps.

Client known-open, not re-reported: #19, #138, #185, #190, #203, #233, #246. Well guarded: player
`loadGeneration`, router `navGeneration`, music `loadSongsGen`/`playGen`/`chapterApplyGen`, watch
init signals, main `modernReqToken`, skin-surface `extrasReqToken`, prefs-sync LWW, chapters editor
`version`/409.

## Triage and build plan (Dean, 2026-09-26)

Dean ruled: **one branch, one release, checkpointed gate** - the safety commits land first and take the
FULL gate bound to their own sha; the look and race slices land on top in parallel worktrees and the
final gate reviews the delta since the safety checkpoint. No phone capture for the music warm pop
(skip; his post-release device pass judges). Remaining medium/low findings go to the tracker, not
this branch.

### Decisions

- **D1 (T-S1, Dean: "Keep mine").** A one-off download whose target file already exists NEVER touches
  it: drop `--force-overwrites`; the job finishes as a success reading "Already in your library",
  never a failure. Replacing a file = delete it, then download. Plus single-flight: a second one-off
  for the same target while one is in flight joins it instead of spawning a second writer.
- **D2 (T-C1).** `/api/config` becomes compare-and-set: GET returns `configVersion` (a hash of the
  stored folders + folderSettings); POST with a `baseVersion` that no longer matches returns 409
  with the fresh version and writes nothing. Sidebar drags (main.js, setup.js) re-GET at drop time,
  apply the move BY PATH onto the fresh list, and retry once on 409; the Settings Save shows "Folders
  changed on another device - reloaded, review and save again" and reloads the form. A POST without
  `baseVersion` is still accepted (legacy callers; disclosed residual).
- **D3 (T-S2/S3/S4/S5).** Prune decisions are re-validated INSIDE the final mutator against fresh
  state, and per-user / sidecar prunes run only for ids actually pruned in that commit; every scan
  runner abandons its prunes on a `persistedStateEpoch` change; unlinks re-read the live trash /
  metadata record after their await.
- **D4 (Music look).** Hold a place for "Jump back in" from a remembered has-items flag; serve sized
  art renditions (lazy, cached, single-flight, original as fallback) and give tracks that share a
  cover ONE art URL (RBAC-safe representative); reveal on-screen art TOGETHER once all have decoded
  or a named cap elapses, off-screen art per image; fix the Home toolbar reflow.
- **D5 (App-wide look).** The same reveal-together helper on video-card thumbnails and row covers;
  skeleton cards sized to the real card; header Queue / Download and bottom-nav slots reserved from
  remembered flags; `[hidden]` guards for `.queue-btn` and `.btn`; TV calls `shimmerArt`; the watch
  channel row renders cached only when the cache holds `subs`.
- **D6 (Races).** T-C2, T-C3, T-C4, T-C5, T-C6, T-C7, T-C8: identity / abort / generation re-checks
  after every await, each with a manually-resolved-promise test.

### Slices (branch feat/v1.339-fouc-toctou)

| Slice | Findings | Gate |
|---|---|---|
| S1 keep-mine re-download | T-S1 | checkpoint: full (adversary + qa + security-brief) |
| S2 config compare-and-set | T-C1 (+ setup.js siblings) | checkpoint: full |
| S3 scan prune guards | T-S2, T-S3, T-S4 | checkpoint: full |
| S4 trash vs restore window | T-S5 | checkpoint: full |
| S2b offline folders kept on save | pre-existing: POST /api/config drops a configured folder missing on disk (routes.js:456), so a save while a share is unmounted un-configures it and the scan prunes it | checkpoint: full |
| S5 restore vs scan follow-ups | G1 remaining T-S4 window (restore unlinks trashPath after a scan unlinked the fresh link); G2 a mid-walk restore re-indexed as new overwrites manual fields | checkpoint: full |
| L1 Music look | M1, M2, M4 + reveal-together | final delta |
| L2 App-wide look | D5 list | final delta |
| R1 wrong-item races | T-C2..T-C8 | final delta |

### Acceptance

- S1-S4: each race has a RUNNABLE repro test (manually resolved promise / interleaved mutator) that
  is red on the base sha and green on the fix; the Adversary is briefed to DESTROY the data.
- L1: re-run `scripts/music-fouc-probe.js` before/after: mobile CLS on every Music tab < 0.01 cold
  and warm (was 0.14); Home cold bytes down >= 70% at the seeded covers; on-screen reveals within
  one frame of each other on cold, capped.
- L2: a probe measurement of the home grid: card growth on reveal 0; header/bottom-nav do not
  re-space after first paint when the remembered flags are warm.
- R1: each race has a test that is red on the base sha.

## Deviations

- **S1 detection signal (builder, verified at yt-dlp source + a real yt-dlp 2026.08.19).** The
  `has already been downloaded` line is never printed in production: any `--print` implies `--quiet`
  and the one-off argv always carries one. The kept-file signal is instead an
  `after_move:FTCHREAL %(__real_download)j` print (`__real_download` is a private yt-dlp field; if a
  future yt-dlp drops it the status reads "Done" - the file is still safe, the guarantee is the argv).
- **S1 explicit `--no-force-overwrites`.** FileTube does not pass `--ignore-config`; a user yt-dlp
  config with `--force-overwrites` re-enabled delete-first in a real run. The CLI flag wins.
- **S1 "never touches it" is "never deletes it".** On a kept file yt-dlp still runs the embed
  post-processors (metadata / thumbnail / chapters), which re-mux to `.temp` and `os.replace` over the
  original only after ffmpeg succeeds: bytes/inode may change, the media is never lost; a failing
  post-processor leaves the original intact (bound by test).
- **S1 single-flight key** = target + format + filetype + explicit folder (an audio request is never
  swallowed by an in-flight video job of the same id). Quality is not in the key (a join takes the
  running job's quality) and the key uses the REQUESTED folder, not the resolved one; `runExclusive`
  serialises one-offs, so two jobs are never concurrent writers.
- **S3 found two adjacent data-loss gaps** (G1, G2 above) - added as slice S5 on the same branch
  (Dean's "I cannot lose data" rule; same checkpoint gate).
- **S3 T-S4 skip:** on a failed live re-check the file is skipped for the pass (not indexed), so the
  fresh carry-forward keeps the restored metadata verbatim. Mutant M8 (`clearPersistedServedAt` over
  candidates) survives masked: `recordServed` re-checks inside the lock, no data effect.
- **S2 (builder):** `configVersion` omitted for a restricted member (hash of folders they cannot
  see); non-string `baseVersion` = 400; a drag whose dragged/anchor path is gone writes nothing and
  re-renders; Save body extracted to `saveFolderConfig()` for testing. S2 surfaced the pre-existing
  offline-folder drop, added as S2b.
- **S5 G1:** two guards, each isolated by its own test: a `restoresInFlight` claim on originalPath
  (restore's mirror of `trashesInFlight`; the scan reconcile refuses a claimed path; a second
  concurrent restore gets 409 "already being restored") and a last-link re-check before restore
  unlinks trashPath (vanished -> re-link, `relinked:true`; a different file -> keep the trash copy,
  409 naming it). server.js wires `isRestoreInFlight` as a lazy dep (orchestrator is built first).
- **S5 G2 partly refuted:** the manual fields named (chapters, sourceUrl, manual channel) already
  survived via the Phase-2 gap-fills; what was lost was title, addedAt, duration, hasThumbnail,
  artist, tags, codecs (on a failed re-probe), audioStatus, attributionConflict. Fix: a walk-new id
  whose fresh entry has the same path + size + codec fields is kept verbatim. Survivors M13 / M14
  are WARNING-class (argued equivalent-or-better); flagged for the gate.
- **S2b (builder):** a kept offline folder is stored under its STORED spelling (the scan's
  missing-root guard matches that exact string); a new nonexistent path is still not added and is
  named in a new response field `skippedFolders` (not surfaced in the UI: a status line would be
  overwritten by the scan poll + redirect; a UI message is a small decision for Dean). Reproduced on
  5af0f00f: the scan pruned the offline folder's item.
- **L1 (builder, probe numbers copied):** mobile CLS per Music tab cold 0.14-0.16 -> 0.0009-0.0051,
  warm-spa 0.14 -> 0; Home cold 4071KB -> 94KB (bytes 4168370 -> 96112, -97.7%). Beyond D4: a static
  Jump-back skeleton in music.html (byte-locked to `buildJumpBackSkeletonHtml(6)`) + an inline unhide
  script, because a JS-only reserve still shifted before music.js ran; rendition DPR capped at 2
  (128 rows / 256 cards / 512 drill; big now-playing + skin art stay full size); renditions under
  `.albumart/sized/<key>-<size>.jpg`; `artId` = lowest VISIBLE track id per album key, per request.
  Not done: desktop cold reveals take 2-3 frames (jump-back, grid, song chunks are separate batches);
  warm SPA return 2 frames; "Playing from" line left (a reserve = a permanent blank line when idle).
- **Branch mechanics:** the look/race slices build on `build/look-base` (safety tip 2915ce98 + L1)
  and merge into the feature branch only AFTER the safety checkpoint gate, so no seat reviews a
  moving tree.
- **S4 fix shape (b)**, an in-process `trashesInFlight` set; restore answers 409 "This item is still
  being moved to the trash -- try restoring it again in a moment". Shape (a) (re-check after the
  await) has a hole: a restore already past its `alreadyLinked` read still passes the re-check.

### Fix round r1 -> r2 (merged at e305fe56)

- **F1 (C1):** a prune candidate is kept only when `walkWouldInclude(filePath, walkedRoots)`: under a
  configured root that existed at walk time, not inside the trash folder, not a yt-dlp intermediate
  / in-flight temp, a media extension, a regular file by lstat; the walk now calls the SAME helpers
  (`isWalkedDirName`, `isSkippedTempName`, `isWalkedMediaExt`). New scan-prune-walk-scope tests:
  8/8 red on bd935043, 8/8 green on base cbb6ef8d and on the fix. The "yt-dlp disabled" case does
  not reproduce (a disabled module's existing folder stays a scan root, D1); the bound case is a
  repointed download folder. Also: T-S4 retired record is an explicit skip + test; the S4 hold
  helpers race the restore so a release mutant fails in ~2s (was a ~400s hang); G2 M14 bound (the
  harm is real: an unconsumed downloadMeta capture after S1). Survivor C1-relchk masked (documented).
- **F2 (C2, W1):** audio ONE-OFFS get `-f bestaudio/best -k` plus `post_process:FTCHSRC` /
  `after_move:FTCHDST` prints; a pure planner deletes a source only when this job downloaded it
  (`real === true`), it is not the final file, and it shares the final's folder + stem;
  `removeFreshOneOffSources` lstat + realpath-under-root re-checks. Status: "Already in your
  library" only when nothing was made from an existing file. Real yt-dlp 2026.08.19 through the
  real route: before, the folder ended with only the mp3; after, the mp4 is byte-identical beside
  the new mp3; a fresh audio download leaves only the mp3. Deviations: failed runs clean nothing
  (a rare post-conversion failure leaves the fresh video, safe); `-f` overrides a user config `-f`
  for audio one-offs; `-k` can leave other post-processor originals (a converted `.srt`, an
  `X.orig.<ext>`) - leftovers, never loss.
- **F3 (W + QA items):** Save refuses without a loaded base ("Could not load your folders - reload
  the page before saving"); a failed/partial loadConfig never leaves a savable empty form; `init()`
  resets the base (a second wipe path: a SPA revisit could save an empty form under the previous
  visit's still-current version); the sidebar persist refuses a GET without `configVersion`. Server:
  a LEGACY (no base) POST that would remove every stored folder is refused 409 inside the mutator
  (four existing tests now send the base). The POST body runs in a try/catch wrapper (no Express 4
  hang). skippedFolders never lists the synthetic download root; comments corrected; trash 409 texts
  unified on " - " and no absolute trash path.
- **L2 (look base):** probe-measured (copied): mobile home cold CLS 0.037 -> 0.0065, first-launch
  0.19 stays (no remembered flags yet), card growth on reveal 52.4px -> 0, books cold 0.6659 ->
  0.0027, TV stuck shimmer 1 -> 0, bottom nav 0 re-spaces on a warm launch. Deviation: pre-paint
  inline reserve scripts in all 11 header shells (the first frame paints before common.js). Dean
  ruled (2026-09-27): leave the Modern one-line-title card nudge (15px) and the "Playing from" line.

### Gate r2 notes (all three seats approved at f8a7ee52)

- security-brief r2 LOW (to fix in F4, reviewed in the final delta): `removeFreshOneOffSources`
  fences to the whole download root, not the job's output; only exploitable with an operator yt-dlp
  config adding a raw-title `--print`. INFO: an over-long stdout line keeps its tail and is parsed.
- qa r2: a repeat audio one-off whose mp3 already exists reads "Done" (yt-dlp leaves
  `__real_download` NA there), not "Already in your library" - the file is kept; a restricted member
  on the folder form sees "Could not load your folders" (POST is admin-only anyway).
- adversary r2: an entry whose parent folder later became a symlink is now kept (walk never follows
  symlinked dirs; lstat follows parents) - nothing lost; a fresh audio download into an explicit
  folder outside the download root leaves its mp4 (realpath fence) - a leftover, not loss. Adversary
  ran its Node 24 check on 24.14.0, not 24.20.0 (the Architect's full suite used 24.20.0).

### Merged-tree measurements (6de9dbd6, Architect runs, copied from the probe tables)

- Full suite Node 22.23.1 on 6de9dbd6: `# tests 9998 / # pass 9989 / # fail 0 / # cancelled 0 / # skipped 9`.
- Music probe 390x844@3: home cold 0 / 105KB, albums cold 0 / 94KB, songs cold 0 / 77KB; warm-spa 0
  on home / albums / artists / songs; on-screen cold reveals in 1 frame (home 799/800ms). REGRESSED vs
  L1's own numbers: artists cold + warm-tab 0.0174, album-drill 0.0194, nowplaying cold 0.0157 - one
  mover in all four: `#music-autoplay-btn` row 1 -> row 2. Cause: L2's global `.btn[hidden]` fix makes
  the tab/state-dependent toolbar buttons (Artists view toggle; pop-out) take no space while hidden,
  so they now reflow the row when shown (before L2 they wrongly occupied space). Fix slice L1b.
- **L1b (merged 9b1c459c):** two causes - the Artists view toggle, and the sort select widening 38px in a
  drill (widest option "Release date (newest)"). One writer `setToolbarSlot(el, shown|reserved|gone)`
  (reserved = visibility:hidden + inert + aria-hidden + tabindex -1; clicks belt-checked), fixed sort
  width 15em, markup ships the reserved state. Probe (builder, copied): artists cold 0.0174 -> 0.0004,
  warm-tab 0.0174 -> 0, album-drill 0.0194 -> 0.0001, nowplaying cold 0.0157 -> 0.0002; desktop all 0
  except artists cold 0.0046 (an early narrow toolbar frame, not root-caused) and the intended
  nowplaying full-player expansion. Trade-off (visible): the toggle slot (38px) and, on desktop, the
  pop-out slot are always held, so Autoplay sits on row 2 on every phone tab - a static layout, nothing
  moves between tabs. Dean's device pass judges.
- Home probe: mobile home cold 0.0065 (card growth 0), warm-spa 0; desktop home cold 0.0286; watch
  cold 0.0754 (the channel row, tracker); books 0.0027; tv 0.

- **F4 (merged, security r2 LOW + INFO):** `removeFreshOneOffSources` now requires the source AND its
  same-folder-and-stem final to be regular files created during the job (`birthtimeMs`, falling back
  to `ctimeMs` where birthtime is 0; never mtime), with `ONE_OFF_SOURCE_CLOCK_SKEW_MS = 1000`, plus
  realpath under the download root and, when known before spawn, under the job's own output folder
  (`resolveChannelDir`); a universal uploader-filed one-off has the timestamp fence only; missing
  options fail closed. statx birthtime is real on this box (ext4 + overlay). The line splitter drops
  an over-long line whole. Forged-line repro red on 6de9dbd6, green after; 21/21 mutants killed.
  Residual: an uploader-filed one-off's forged pair could still name a file created during the job
  window elsewhere (needs an operator `--print` + timing); that wiring is untested.

### Gate r3 notes (all three seats approved at 03a1f634)

- qa r3 W1: the pre-paint reserve blocks in all 11 header shells name `test/unit/chrome-reserve.test.js`,
  which does not exist (the lock is test/unit/app-look-l2.test.js) - fixed in a comment-only sweep.
- security-brief r3 LOW (tracker): no global cap on concurrent ffmpeg rendition jobs
  (artRendition.js runJob); a member or a cold HTTP/2 Music load can start one per key x size at
  once, once per key (cached after). INFO: harden the rendition ffmpeg with `-f image2` +
  `-protocol_whitelist file`; `ft-ytdlp-module` and `ft-music-jumpback-count` are not cleared on
  sign-out (cosmetic); the app sends no CSP (long-standing).
- qa r3 suggestions (tracker): home Continue-listening row (main.js ~204) and home track cards
  (main.js ~677) still request full-size `/albumart/<trackId>`; music-ambient's aborted-view guard is
  now masked by R1 T-C5; music-toolbar-slots popout/More click belts and slot-state decisions are
  source-lock-only (behavioural binding feasible); the first cold visit after a scan pays for every
  rendition (home cold first reveal 1372ms vs 899ms originals).
- adversary r3 suggestions (tracker): a SIGKILL mid-rendition leaves a `.tmp.jpg` in `.albumart/sized`
  (never swept); a filesystem clock >1s behind the server leaves a fresh audio source beside the mp3.

## For the tracker (found while building, not fixed here)

- F2: subscription audio has the same C2 mechanism if an audio subscription and a video of the same
  id share a folder (archive usually prevents it); the subtitle converter can delete a user's own
  same-name `.srt` on video one-offs; the escaped-download quarantine can delete a user's own
  pre-existing symlink (the link, not its target).
- L2: Modern sort / view toggle mount after first paint (header re-spaces once, 80-92px); watch
  channel row grows when Subscribe / Pin show on mobile (cold 0.0752); desktop home cold 0.0553 from
  sidebar Library entries + toolbar widening; TV has no grid skeleton.
- R1: `music.js prewarmThenLoad` has no view-abort check (late loadTrack after nav-away); podcasts
  `consumeDeepLink` early lookup failure clears the grid (pre-existing).

- S2b: a new folder path that does not exist is silently not added from the user's view
  (`skippedFolders` is response-only).
- S2b: Express 4 hangs a request on any throw inside the async /api/config handler outside its
  try/catch (seen while building a mutant) - audit the handler's pre-mutator code.

- L1: orphaned `t-<id>` thumbnail renditions are never pruned; home/search album thumbnails built
  in server.js (~5053, ~5204) are unsized.

- S5: guard B's keep path (a different file at originalPath) leaves an unrecorded trash copy the
  retention sweep ages out after 30 days (out-of-process writer only).
- S5: in the G2 race the walk still re-probes and rewrites the thumbnail / storyboard / preview
  sidecars from the same file; the reconcile's `destroyMediaStreams` still closes streams on a
  claimed path.

- S1: live download percent likely never parses in production (`--print` implies `--quiet`, which
  implies no progress output; no `--progress` in the argv) - verify on device before acting.
- S1: subscription downloads also lack `--ignore-config` / `--no-force-overwrites` (subscription argv
  byte-parity lock kept; the archive skips known ids, so exposure is a user config + an on-disk
  collision).

## Gate

Gate: APPROVED r1 - security-brief, reviewed at 8919ba55 (superseded: re-approved r4 @ab880c99)
Gate: CHANGES r1 @8919ba55 — qa
Gate: CHANGES r1 @8919ba55 — adversary
Gate: APPROVED r2 - security-brief, reviewed at f8a7ee52 (superseded: re-approved r4 @ab880c99)
Gate: APPROVED r3 - security-brief, reviewed at 03a1f634 (superseded: re-approved r4 @ab880c99)
Gate: APPROVED r4 @ab880c99 — security-brief
Gate: APPROVED r2 - qa, reviewed at f8a7ee52 (superseded: re-approved r4 @ab880c99)
Gate: APPROVED r3 - qa, reviewed at 03a1f634 (superseded: re-approved r4 @ab880c99)
Gate: APPROVED r4 @ab880c99 — qa
Gate: APPROVED r2 - adversary, reviewed at f8a7ee52 (superseded: re-approved r4 @ab880c99)
Gate: APPROVED r3 - adversary, reviewed at 03a1f634 (superseded: re-approved r4 @ab880c99)
Gate: APPROVED r4 @ab880c99 — adversary

r1 findings (seat reports, summarized by the Architect; repros live in the seats' scratch dirs):
- **C1 (qa + adversary, CRITICAL, regression from S3):** the T-S2 keep-guard (orchestrator.js
  ~1934-1950) keeps any prune candidate that is live with its file on disk, so a folder removed in
  Settings (files still on disk), the disabled yt-dlp root, and newly excluded files are never pruned;
  base prunes, 8919ba55 keeps (both seats reproduced). Also breaks roots.js:72-76's documented escape
  hatch. Fix: keep only a candidate whose file lies under a root this scan WALKED and passes the
  walker's inclusion rule; promote "removing a configured folder whose files remain prunes its items
  and per-user state".
- **C2 (adversary, CRITICAL, pre-existing, breaks D1 and the new status text):** an AUDIO one-off for a
  URL whose video is in the library: yt-dlp's `existing_video_file` picks up the existing mp4 as the
  download, FFmpegExtractAudio converts it and deletes the mp4, and FileTube reports "Already in your
  library" (measured with real yt-dlp 2026.08.19 + ffmpeg-static; YoutubeDL.py:3472-3479,
  postprocessor/ffmpeg.py:476-529).
- **W (adversary, pre-existing):** Settings opened while GET /api/config fails leaves
  `configuredFolders=[]`, `configBaseVersion=null`; Save posts `{folders:[],folderSettings:{}}` with no
  base, the legacy path wipes the folder config (and, once C1 is fixed, prunes the library).
- **W1 (qa):** lib/ytdlp/index.js ~3966-3974 `recordOneShotInArchive` doc still says a one-off
  "still actually re-downloads" - a lying comment on a data-loss surface.
- Suggestions: unify the new trash / restore 409 texts on " - "; drop the absolute trashPath from the
  "different file" 409; the skippedFolders comment is wrong for the synthetic download root; move
  S2b's `folderStore.list()` read inside the try (Express 4 hang); routes.js ~411-413 comment
  overstates the awaits; T-S4 `!!liveTrashRec` conjunct survives (test the retired-record case
  directly); S4 release mutants only die by a 400s hang (add a bounded assertion); G2 M14
  (`freshlyScannedIds.delete`) unbound; single-flight key omits quality / uses the requested folder
  (runExclusive serialises one-offs, so no second writer) - noted in Deviations.
