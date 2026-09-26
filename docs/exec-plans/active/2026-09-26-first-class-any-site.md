---
plan: first-class-any-site
harness: v2 · lean
branch: feat/v1.338-card-share-saved-link
anchor: spec
status: Gate:CHANGES r1 @c90977a2; r1 fixes at 0e90a9c7
next: gate r2 at 0e90a9c7 - fresh qa + security-brief (verify each r1 finding) + a fresh adversary; then release v1.338.0.
design: "Approved 2026-09-26 by Dean (D1-D10 and icon style A, AskUserQuestion; the plan as of commit 46427eb0)"
gate: pending
---

# v1.338.0: downloads from any site are first-class (the saved link, the card Share, and the rest of the gaps)

## The asks (Dean, 2026-09-26, verbatim)

- **A1** "Can you please make it so that the same buttons work for the chips for the corners of the
  non-Youtube thing. We now can share from the page. Is there a reason we can't just like share from
  the bottom right corner? What about delete? I know that's about the extent. Like, yeah, you could
  delete this content, or you could share it. If there are any transcripts collected, then it would be
  nice to be able to use the transcript button. Reheat is fine. What do you think? As a standalone
  effort."
- **A2** "maybe the goal level is to say non-YouTube things supported by YT DLP should have generally
  first-class experiences in terms of icon, shareability, deletion, transcripts, anything that can and
  is grabbed should be kind of treated and formed the same way. So maybe if that's a bigger thing,
  that's fine. But like, I don't know, I thought we generalized the functions enough to be like, oh, I
  grabbed this URL. There was an icon from this source."

### Dean's rulings at intake (AskUserQuestion, 2026-09-26)

- Decisions D1-D10 below: **"Approve all"** (one release). Site icon: **A, the brand disc** (from the
  rendered candidates: A brand disc / B grey disc / C white tile, 48 + 32px, light + dark), with a
  faint ring on dark mode for the black marks (TikTok, X).
- Scope (after the audit below): **all four** - Share everywhere (core), a site icon, the small fixes
  bundle, Reheat for any site. Counts: **keep the placeholders** where a site reports none (as every
  item without counts does today).

### The first ruling

- The card Share gets its link by **saving the link** with the video: new downloads save it when they
  land, existing ones fill in once from their files in the background; the full data-safety review.
  (This supersedes his v1.337 "watch page only, store nothing" ruling, which he made before cards were
  in scope.)

## Research

### What a non-YouTube download's card corners do today (measured)

`buildCardCorners` (public/js/main.js) driven in node with a Reddit item (`sourceExtractor`, no
`youtubeId`) and each chip in the bottom-right corner, `canModifyLibrary` + `reheatEnabled` on:

| Chip | Non-YouTube item |
|---|---|
| Delete | SHOWS (gated only on the library permission) |
| Transcript | SHOWS when the item has captions (`hasSubtitles`); every download lane asks yt-dlp for English captions (lib/ytdlp/args.js:1267) |
| Reheat | SHOWS |
| Share | MISSING: it reads `item.watchUrl`, derived only from a YouTube id |

(A YouTube item with the Share chip: SHOWS - the control case.)

### Audit: every YouTube-only surface (a read-only subagent, code-read; yt-dlp extractor facts from yt-dlp master reddit.py / facebook.py)

Root: a universal item never gets `watchUrl`, `channelUrl`, `channelId` or `channelAvatarUrl` - the
universal branch of `sanitizeCapturedChannelMeta` (lib/ytdlp/store.js:1142-1191) keeps `sourceExtractor`,
`sourceId`, `channelName`, title, date and counts only. There is NO "icon from this source" feature
anywhere (only the app's own favicon); a universal item shows the generated letter avatar.

| Gap (as the user sees it) | Universal today | Why | Data exists? | Size |
|---|---|---|---|---|
| Uploader icon (watch, cards, bell, queue, lists) | letter avatar | the resolver needs a YouTube channel identity (store.js:1010-1066) | Reddit / Facebook give NO avatar; a per-site badge keyed on `sourceExtractor` is certain | badge S-M; real avatars L |
| Card Share corner | hidden | lists derive `watchUrl` from `youtubeId` only (routes.js:402, server.js:5107) | the page URL (file tags; to be saved as `sourceUrl`) | S once saved |
| Share from search results | none | same (search/registry.js:52) | same | S |
| Share from the music / pocket skins | none | skin-surface.js:152-157 reads `watchUrl` | same | S |
| Chapter share icons, "at current time" | absent / plain link | `?t=` is YouTube's | few sites take a start time | S (plain link) |
| Reheat (refresh title / views / captions) | local tags only; toast "No YouTube source found" (watch.js:3669) | the network pass needs a YouTube `watchUrl` (index.js:779-793) | the saved `sourceUrl` | M; SSRF risk unless it reuses the universal lane's guards (args.js:1300, isPlausibleMediaUrl) |
| Pin channel | removed with Subscribe (watch.js:2629-2640) | coupled to the YouTube channel gate | the folder is enough (watch.js:2677-2679) | S |
| Stats "by channel" | left out (stats.js:111, 797) | grouped by `channelUrl` | `sourceExtractor` + `channelName` / folder | S |
| Duplicate report | not by id (stats.js:350) | YouTube ids only | `sourceExtractor` + `sourceId` | S |
| Delete confirm | a universal item with no captured uploader gets the local-file hard-delete modal (common.js:12493) | the check ignores `sourceExtractor` | yes | S |
| Views / subscriber counts | real only if the site reports them; Reddit shows invented placeholders (common.js:2922) | per extractor | Reddit has likes / comments (not captured) | S + a ruling |
| Subscribe, per-channel mute, channel-level refresh | none | subscriptions are YouTube-only | n/a | L; a product call |

Already first-class: title, date, uploader name, counts when reported, folder grouping and "More from",
notifications, the watch-page Share (v1.337), Delete (archive + tombstone handle `sourceExtractor`),
captions / transcript (every lane asks for English captions; whether a given site yields them needs a
real download), chapters / thumbnail / metadata embed, storyboard and hover preview, like / queue /
download / progress / trash / access rules, the browser extension.

### The saved link: capture, carriers, backfill (a read-only subagent; file:line in its report, summarized)

- Capture: the universal download prints `UNIVERSAL_CHANNEL_META_PRINT_TEMPLATE` (lib/ytdlp/args.js:749,
  an `after_move` `.{...}j` selector) -> `parseChannelMetaLine` (run.js:318-379) ->
  `recordDownloadChannelMeta` universal arm (store.js:1296-1309), sanitized at write
  (`sanitizeCapturedChannelMeta`, store.js:1146-1189) and at consume (`consumeUniversalDownloadMeta`,
  store.js:1446-1497). `webpage_url` is in the info dict there but not in the selector. The job's own
  validated `universalSourceUrl` (index.js:4282) is the fallback (the lane is one item:
  `--no-playlist --playlist-items 1`, args.js:1295). The YouTube template (args.js:740) is pinned
  byte-for-byte (test/unit/ytdlp-args.test.js:1358-1375, 1777-1789).
- Storage: one JSON blob per item (`media_items`, lib/db/sqlite.js:1315); a new per-item KEY is not a
  new namespace, so SCHEMA_VERSION (33) does not bump (docs/RELEASING.md:129-131). An older build
  ignores the key, but its changed-file re-init would drop it.
- Carriers the new key must join (LESSONS 9): the scan's terminal write (orchestrator.js:1625-1642),
  the re-init carry-forward (1068-1172), the Phase-2 re-read-merge gap-fill (1437-1565, beside
  `sourceExtractor` at 1562-1565), and - if the reheat writes it - the reheat OR-chain / persistMeta
  (index.js:913-938) and its terminal write (relocation.js:1134-1334). Carried automatically: move /
  rekey (in place), trash / restore (whole-item spread), backup (verbatim - so the READ side
  re-sanitizes), the fresh-only-id carry.
- Backfill for past downloads, no extra file reads: the scan already persists each item's
  `tags.comment` (server.js:2145-2147) and gives new / changed files `meta.embeddedSourceUrl` (purl,
  then comment; orchestrator.js:239); precedent = the `youtubeId` backfill from `existing.tags.comment`
  (orchestrator.js:846-850), in BOTH reuse arms. Gaps: Ogg / Opus keeps tags per stream, and `comment`
  is dropped when it equals the description (server.js:2185-2187) - the v1.337 on-demand resolver
  stays the watch page's fallback for those.
- Card read surfaces: GET /api/videos (spreads the item), GET /api/liked (spreads, and derives NO
  `watchUrl` - so its Share corner is blank even for YouTube today: a bug), the modern grid
  (`resolveModernGridItem`, server.js:5085-5133, field-complete), search (registry.js:33-56,
  field-complete). Every list gates on `mediaVisibleTo`.

## Decisions (spec anchor; ordered by blast radius; Dean approves the batch)

| ID | Decision |
|---|---|
| D1 | **Data model.** A new per-item key `sourceUrl` on universal items only (never on YouTube items): the page URL, passed through `sanitizeSourceShareUrl` (v1.337's strict check) at the capture write, at the consume, and again at every SERVE (a backup can plant any string). No schema bump (a key, not a namespace). |
| D2 | **Capture.** Add `webpage_url` to the universal print selector only (the YouTube template stays byte-identical); `parseChannelMetaLine` reads it; the universal arms of sanitize / record / consume carry it. Fallback: the job's validated `universalSourceUrl` when yt-dlp prints none. |
| D3 | **Carriers.** The scan's terminal write, re-init carry-forward and Phase-2 gap-fill carry `sourceUrl` exactly where `sourceExtractor` / `sourceTitle` go; every carrier is bound by a test that deletes it and goes red (LESSONS 2). |
| D4 | **Backfill.** Past downloads fill `sourceUrl` during the normal scan from what the library already holds (`tags.comment`, `embeddedSourceUrl`), in both reuse arms, gated on `sourceExtractor`; attempted once (absent vs null), no new file reads. The v1.337 resolver stays as the watch page's fallback (Opus, a comment that was the description). |
| D5 | **Serve.** A derived `sourceShareUrl` (the re-sanitized saved link) on GET /api/videos, GET /api/liked, the modern grid, search, and the watch route (saved link first, then the v1.337 probe). `watchUrl` stays YouTube-only (it feeds the chapter share with `?t=`). GET /api/liked also gains the YouTube `watchUrl` it has always lacked. |
| D6 | **Share everywhere.** The card Share corner, search results and the music / pocket skins' share use `watchUrl || sourceShareUrl`; the chapter share and "at current time" stay YouTube-only (a start time means nothing to most sites). |
| D7 | **Site icon.** Where a universal item has no uploader photo (Reddit / Facebook give none), the avatar shows the SOURCE site's mark, keyed on `sourceExtractor`, for a curated set of sites; any other site keeps the letter avatar. The look is Dean's pick from rendered candidates, before the gate. |
| D8 | **Small fixes.** (a) Pin channel works without Subscribe (it pins the folder, which universal items already live in); (b) Stats "by channel" includes universal items (grouped by site + uploader); (c) the duplicate report matches universal items by site + id; (d) a universal item always gets the downloaded-item delete confirm, never the local-file hard-delete modal. |
| D9 | **Reheat for any site.** The reheat's network pass runs for a universal item from its saved link, through the universal download lane's own guards (`isPlausibleMediaUrl`, which refuses private hosts, and `--use-extractors default,-generic`), refreshing title, date and counts (and captions where offered). The security-brief seat joins the gate (a server-side fetch of a stored URL). |
| D10 | **Out of scope, disclosed:** real uploader photos for other sites (none offered by Reddit / Facebook; a per-site effort), Subscribe for other sites (a product call), counts: placeholders stay (Dean). One plan; the gate is adversary + qa + security-brief. |

## D8 build notes

Branch `feat/v1.338-d8-small-fixes` (from 46427eb0). A "download from another site" below = an item with
`sourceExtractor` and no YouTube channel identity.

- **(a) Pin without Subscribe** - public/js/watch.js:2638-2658 (`applySubscribeAndPinState`): a `pinOnly`
  arm (no YouTube identity AND module enabled AND a non-blank `sourceExtractor`) removes / hides Subscribe
  and the bell as before but keeps the SAME Pin element (never removed, never hidden) and falls through to
  the existing Pin block (channelDir = the file's folder, label = the uploader). Pin, unpin and the pinned
  sidebar are unchanged: POST `{channelDir, label}` / DELETE `/api/subscriptions/pins/:id` (id =
  getMediaId(channelDir)), re-validated server-side by `validatePinInput` (confined under the download
  dir, where the universal lane lands). A plain local file and a disabled module still get no Pin.
- **(b) Stats By channel** - lib/stats.js:113 (`universalChannelGroup`), :128 (`computeBreakdownByChannel`):
  a second groupBy pass keyed `${sourceExtractor}:${uploader}` (uploader = `channelName`, else the folder);
  rows `{ sourceExtractor, channelName, count, ... }`, merged into the YouTube rows with groupBy's own
  order. An item with a `channelUrl` stays YouTube-only. public/js/stats.js:129 (`channelBreakdownLabel`):
  "uploader (Site)"; the empty message is now "No downloaded channel content yet." (it was "subscribed").
- **(c) Duplicates** - lib/stats.js:374 (`universalSourceKey`), :400: when no YouTube id resolves, the key is
  `${sourceExtractor}:${sourceId}`; it always holds a ':' that no YouTube id can, so it never collides.
- **(d) Delete confirm** - public/js/common.js:12506: `isYtdlpManagedItem` counts a non-blank
  `sourceExtractor`. Read first: both confirms end in the SAME `DELETE /api/videos/:id` (watch.js
  `performMediaDelete`; skin-surface.js `doDelete`), and the server keys the archive + tombstone on the
  item's own fields, not on which modal ran. The only difference is the checkbox friction. The card has
  had no modal since v1.86.2, so the gap was the watch page and the skins' extras delete
  (skin-surface.js:474 reads the same predicate, fixed with it).

Tests (Node 22.23.1, `node --test <file>`, final lines verbatim):

- test/unit/watch-init-behavioral.test.js (6 new, the REAL watch.js init; the harness gained `seedItem`):
  `# tests 38` `# pass 38` `# fail 0`
- test/unit/stats-aggregation.test.js (3 new): `# tests 29` `# pass 29` `# fail 0`
- test/unit/stats-duplicates.test.js (2 new): `# tests 11` `# pass 11` `# fail 0`
- test/unit/stats-page-formatters.test.js (1 new): `# tests 22` `# pass 22` `# fail 0`
- test/unit/hard-delete-local-files.test.js (2 new): `# tests 28` `# pass 28` `# fail 0`
- test/integration/stats-any-site.test.js (new; GET /api/stats, GET /api/duplicates, the RBAC axis for a
  member restricted on one uploader's folder, and GET /api/videos/:id's shape): `# tests 4` `# pass 4` `# fail 0`
- `npm run lint`: 0 errors (6 pre-existing common.js unused-var warnings); `npm run lint:css`: `TOTAL 0`.

Mutants (each applied alone, the named test watched red, restored): watch.js `pinOnly` forced false,
the `moduleEnabled === true` conjunct dropped, the `sourceExtractor` conjunct dropped, the confirmed-remove
`!pinOnly` dropped (a rebuilt Pin, caught by element identity), the cached-hide `!pinOnly` dropped,
`if (!pinOnly) return` made unconditional; lib/stats.js universal group nulled, its `channelUrl` exclusion
dropped, the folder fallback dropped, the site dropped from the key, the universal rows dropped, the merged
sort dropped, `universalSourceKey` unprefixed / unwired / its sourceId or sourceExtractor half-check
dropped; public/js/stats.js label's channelUrl-first dropped, site dropped from the label; common.js signal dropped
(red in both the pure table and the driven watch delete), made `Boolean()`, widened to `sourceId`.

What the plan got wrong or left out:

- The audit's "stats.js ~797" is public/js/stats.js (the renderer); the grouping is lib/stats.js:111.
- (d) is UI friction only: no server behaviour depends on which confirm ran (above), so no data-loss path
  changes; the scan sets `sourceExtractor` only under the yt-dlp download roots (lib/scan/orchestrator.js,
  the `ytdlpDownloadRoots` gate), so a plain library file never gains the signal from a scan.
- (a) Pin stays behind the yt-dlp module gate (the pins routes register only when it is enabled), as it
  always was for YouTube items.
- (c) residual, disclosed: two copies whose `sourceId` came from different writers (the raw captured id vs
  the sanitized filename-bracket fallback, e.g. an id holding `/`) do not match each other.

## Build record (D1-D7, D9; D8 above)

| Commit | What |
|---|---|
| e651a26b | D1-D4: `webpage_url` in the universal selector only; parser `webpageUrl`; sanitized at capture (store universal arm) and consume; the job-URL fallback (`withUniversalPageUrl`); scan carriers: terminal write, re-init carry-forward, Phase-2 gap-fill; the schema-only backfill in BOTH reuse arms (`deriveScanSourceUrl`, lib/scan/identity.js) and the new-file tag fallback |
| 09108c09 | D5-D6: `savedSourceShareUrl` (re-checked at serve) on GET /api/videos, GET /api/liked (+ its missing YouTube `watchUrl`), the modern grid, search, the watch route (saved first, the v1.337 probe as fallback); the card corner, search and skins share it |
| 98671cb3 | merge of D8 (92296185) |
| 2443becd | D7: 12 style-A badges (public/assets/sites/, Simple Icons CC0 + README), `siteBadgeAvatarUrl` at `resolveItemChannelAvatarUrl`'s no-identity exit |
| 30dc17da | D9: `enumerateRepullableItems` flags `universal` + the raw saved link; `reheatOneItem` re-pulls from it (else the file's tag link), re-checked; `repullItemMetaAndSubs` UNIVERSAL mode: `isPlausibleMediaUrl`, `shortlink.guardHop` (DNS resolve-then-check, fail closed), `--use-extractors default,-generic` + `--playlist-items 1` on both passes, no YouTube channel capture; the "nothing to refresh" text no longer says YouTube |
| 1f6e9b1b | the self-check's four survivors bound; the skins' timed share made YouTube-only (a defect the new test found) |

### Measured (copied from the runs)

- Pre-commit unit suite at 1f6e9b1b: `tests 7511`, `pass 7511`, `fail 0`; the merged tree before D7:
  `npm run test:unit` `# tests 7506` `# pass 7506` `# fail 0`.
- New / extended tests (node --test, Node 22.23.1): scan-source-url-bridge `# tests 12` `# pass 12`
  (with FILETUBE_TEST_FFMPEG; the real-MP4 case skips without it); source-share-lists `# tests 7` `# pass 7`;
  ytdlp-repull-universal `# tests 4` `# pass 4`; ytdlp-repull-item-endpoint `# tests 33` `# pass 33`;
  repull-persist `# tests 40` `# pass 40`; card-corner-renderer `# tests 30` `# pass 30`; skin-surface
  `# tests 71` `# pass 71`; site-badges `# tests 4` `# pass 4`; ytdlp-args + ytdlp-store + ytdlp-run
  `# tests 479` `# pass 479`.
- Pre-gate mutation self-check (a /tmp git-archive sandbox, pristine diff 0 after each): 17 mutants over the
  carriers, the backfills, the consume and serve re-checks, the re-pull guards, the reheat branch, the Liked
  `watchUrl`, the card and skins fallbacks. At 30dc17da 13 went red, 4 survived (the new-file fallback, the
  intake check, the DNS guard - their refusal tests hung instead of failing - and the skins fallback); at
  1f6e9b1b all bound (M8's literal form is equivalent: `guardHop` refuses the undefined URL; its meaningful
  form, the raw link past the intake check, goes red).
- Render (scratch CDP probe, the real app, modern cards with Share in the bottom-right, desktop 1280x800,
  light + dark): Reddit / Facebook / TikTok cards show their badge and a Share corner sharing the page link
  ("Share the original link"); YouTube shares its watch link ("Share the original YouTube link"); the plain
  file has no Share. The TikTok disc keeps its ring on dark. Sent to Dean. NOT captured: the phone watch page
  (the probe's page evaluate timed out twice; the watch route's badge / Share and the watch page's Pin are
  bound by source-share-lists and the D8 watch-init tests) - Dean's device check.

## Gate

Gate: APPROVED r1 @c90977a2 - security-brief

Not completed: no Bash, so no `git diff`. I read the named files at the working tree, which the session snapshot
says is clean at c90977a2. I also had no network, so I did not read yt-dlp's source. Anything below that depends on
yt-dlp behavior is a suspicion, not verified.

No CRITICAL, no WARNING. Verified: every path to yt-dlp is guarded. YouTube goes through buildWatchUrl /
classifySingleVideo (index.js:781-796). Universal goes sanitize -> isPlausibleMediaUrl -> guardHop, then argv with `--`
(run.js:1650-1675, 1801-1806), and only for `inDownloadRoot` non-YouTube extractors (relocation.js:1050-1058). Both
reheat routes require manage-subs, check visibility, and refuse read-only media (index.js:6445, 6616-6650). The one-off
download has the same capability gate (index.js:6207), with only the literal-host guard and no DNS check. So D9 gives
no one a fetch they could not already make, and its DNS check is stricter than the lane's. Every list checks
visibility before it adds `sourceShareUrl`. The share attribute is escaped (main.js:757, 141-147). The URL check
allows only http(s) with no `@` in the authority, rejects Cc/Cf/whitespace/backslash, and turns IDN hosts into
punycode (source-share.js:26-36). The SVGs contain only svg/circle/path elements and sit behind the auth gate
(gate.js:135).

1. SUGGESTION (residual not disclosed). run.js:1641-1647 lists the guards "before yt-dlp sees it", but yt-dlp
   resolves the host again and follows redirects with no address check. A public host that passes guardHop can 302
   or DNS-rebind to 192.168.x. The lane already has this residual (url.js:327-341, shortlink.js:28-29). What D9 adds
   is replay: a stored link is fetched later, including in the admin's batch. Suspicion, not verified: a named
   extractor that matches any host (MediasiteIE) could hand back subtitle URLs. Pass B would then write the internal
   response next to the media file, and /api/subtitles would serve it. The first download already has the same
   exposure. Fix: say this in the run.js comment. Also update the stale "already-validated single-video watch URL"
   @param (run.js:1626-1630).
2. SUGGESTION (stale comment). source-share.js:7-9 says "The library does not store its page URL", and lines 3-5 say
   "nothing new stored". Both are false as of D1. Fix: update.

INFO: (a) the raw `sourceUrl` rides the `...item` spread without being checked again (routes.js:409, 788). No client
code reads it, and the audience is the same as the item's. (b) The pins routes have no visibility check. That is
older code the server side of D8 does not touch (index.js:5696). (c) guardHop's DNS lookup runs inside runExclusive
with no timeout of its own. The libc resolver timeout bounds it, and the yt-dlp spawns already hold the same gate for
longer. (d) A `[Key=id]` file with a `comment` tag in the download root can now start a fetch on the next reheat. That
needs write access to that folder, and there is no upload route. (e) A saved link can carry a site's private-share
token. It reaches the same users the v1.337 watch page already served it to.

Gate: CHANGES r1 @c90977a2 - qa

Instruments (Node 22.23.1, run by this seat at c90977a2): `npm run test:unit` `# tests 7511` `# pass 7511` `# fail 0`
(exit 0); `npm run lint` `0 errors, 6 warnings` (the six pre-existing common.js unused vars); `npm run lint:css`
`TOTAL 0`; `npm run lint:overlay` `overlay-containment: clean (0 violations)`; `check-markers.sh` `clean`. The eight
named files with FILETUBE_TEST_FFMPEG, all exit 0: scan-source-url-bridge 12/12, source-share-lists 7/7,
ytdlp-repull-universal 4/4, ytdlp-repull-item-endpoint 33/33, repull-persist 40/40, stats-any-site 4/4,
watch-source-share 5/5, watch-share-button 10/10. The FULL integration suite (`node --test test/integration/*.test.js`):
`# tests 2228` `# pass 2218` `# fail 1` `# skipped 9` (exit 1).

1. CRITICAL - the integration suite is red at this sha. `not ok - runDownload: a captured FTCHMETA line is parsed onto
   result.channelMeta and is NEVER forwarded to onProgress` (test/integration/ytdlp-spawn-security.test.js:1733). The
   file is 118/118 at base ca185903 and 117/118 here. Cause: `parseChannelMetaLine` now returns `webpageUrl: null`
   (lib/ytdlp/run.js:356-359). This test pins the exact parsed shape with a deep equal. Its twin pins in
   test/unit/ytdlp-run.test.js were updated, but this one was not. The plan's Measured section lists only targeted
   files, never a full `npm test`, and the unit hook cannot see this test (LESSONS 2). The Definition of Done ("All
   existing tests pass") fails, and CI will go red. Fix: add `webpageUrl: null` to that expected shape (the intent
   holds: a YouTube line carries no page link), then run the full `npm test`.
2. WARNING - D7's badge reaches Music, which the plan never listed. server.js:4210 (`projectedLibraryTracks`) sets
   `track.avatarUrl` from `resolveItemChannelAvatarUrl`, which now returns the site badge. lib/music/query.js:175
   (`groupArtists`) takes the lowest-id track's avatar. public/js/music.js:97/143 then draws that circle INSTEAD OF the
   album-art mosaic, and music-skins.js:432/510 uses it as the menu art ahead of the cover. Scenario: someone downloads
   a Bandcamp or SoundCloud album as audio (both sites are in the curated set). Music > Artists then shows the Bandcamp
   logo instead of the cover mosaic. Driven: `groupArtists` on a Bandcamp track `b1` plus a YouTube track `y2` that
   has a real photo gives `avatarUrl "/assets/sites/bandcamp.svg"`, so the badge replaces a real channel photo. The
   research table ("watch, cards, bell, queue, lists") never lists this surface, and D7 says the badge replaces the
   LETTER avatar. Fix: keep the badge out of the Music projection, with a test. Or get Dean's ruling and disclose it.
3. WARNING - the library Reheat summary is wrong now that D9 exists. lib/ytdlp/client/subscriptions.js:1458-1476 bases
   its wording on `withSourceId`, which counts YouTube only (relocation.js:1061). A download from another site with a
   saved link now runs two yt-dlp passes and holds the `runExclusive` gate. Verified: `formatReheatSummary(3,0,0)` gives
   "Reheating 3 items · none have a YouTube source link yet (local tag check only)". The line leaves out the "one fetch
   each ... downloads and checks wait" warning. An earlier adversarial WARNING made that warning mandatory whenever
   any item is network-bound. Fix: count universal items with a usable link as network-bound and reword to "source
   link", with a test.
4. WARNING - in the batch, a failed universal network pass is never retried. lib/ytdlp/index.js:891-903:
   `exhausted = !watchUrl && local !== null` stays true for a universal item even after its network pass ran from the
   saved link. One 429 or timeout therefore marks the item complete (`metadataRepulledAt`), and a later non-force
   batch skips it (index.js:1200). A YouTube item in the same state stays retryable. The comment above it is now false
   ("NO watch URL is derivable from anywhere"), and it contradicts its own rule that "a brief ... hiccup must never
   permanently foreclose". Also undisclosed: universal downloads from before v1.338 already carry `metadataRepulledAt`
   from their earlier exhausted pass. So the library batch skips every existing one unless forced, and for them D9
   works only through the per-item button or a forced batch. Fix: not exhausted when a universal page link exists,
   with a test; disclose the old-marker behaviour. This could ship if disclosed, but only with the comment corrected.
5. WARNING - the capture fallback's call site is not bound by any test. lib/ytdlp/index.js:4556
   `persistCapturedChannelMeta(deps, withUniversalPageUrl(downloadResult.channelMeta, universalSourceUrl))`. The mutant
   `persistCapturedChannelMeta(deps, downloadResult.channelMeta)` was run in a /tmp git-archive sandbox against the 14
   ytdlp / scan-source / source-share / oneshot test files: `# tests 789` `# pass 788` `# fail 1`, and the one failure
   is item 1, which is also red without the mutant. The mutant SURVIVES. D2's fallback is tested only as a pure
   function. Fix: add a universal one-shot test (ytdlp-oneshot.test.js:1268 already stubs `run.runDownload` with
   `channelMeta`) that asserts the downloadMeta row's `sourceUrl` equals the job URL when yt-dlp printed none.
6. WARNING - lying comments, several of them now stating the wrong mechanism (LESSONS 12):
   (a) lib/media/source-share.js:3-15 still says "WATCH PAGE only ... nothing new stored", "The library does not
   store its page URL" and "turns that into the watch page's sourceShareUrl". (b) lib/media/routes.js:828-833 says
   `watchUrl` feeds "the music skins' share, which stay YouTube-only", but D6 made the skins share `sourceShareUrl`
   (skin-surface.js:159-160). (c) lib/ytdlp/store.js:~997-1008: the resolver's JSDoc now sits above `SITE_BADGES`, and
   it still says "Every candidate URL is re-validated via sanitizeChannelAvatarUrl" and that step 5 falls back to the
   letter avatar. The badge does neither. (d) lib/scan/orchestrator.js:1587-1588 ("a mid-scan reheat or capture may
   have written it") and the test title at scan-source-url-bridge.test.js:138 both claim writers that do not exist.
   Only the scan writes `metadata[].sourceUrl`: the reheat's persistMeta has no such key, and the capture writes the
   downloadMeta bridge row. (e) lib/ytdlp/index.js:1484-1486 says the client shows "No YouTube identity found".
   run.js:1626-1630 still says `@param watchUrl` is "an already-validated single-video watch URL".
   (f) test/unit/reheat-button-wiring.test.js:228 is still titled "no YouTube source".
7. SUGGESTION - the raw `sourceUrl` rides the `...item` spread on GET /api/videos, /api/videos/:id and /api/liked
   without the serve re-check D1 describes. No client code reads it today (grep of public/js: zero `.sourceUrl`
   reads). Either leave it out of the spreads or say that D1's serve rule covers the derived field only.
8. SUGGESTION - public/js/watch.js:2646-2660: the `pinOnly` path never sets `pinBtn.hidden = false`. If an earlier
   unconfirmed, non-pinOnly pass hid Pin (a cached `moduleEnabled:false` followed by a confirmed `true`), Pin stays
   hidden. Suspicion only: it needs the module to flip within one page. It is one line on the reveal axis.
9. SUGGESTION - the new toast "No source link found for this video" (watch.js:3683, skin-surface.js:356) has no
   exact-text binding (tests match /nothing to refresh/ only). For a universal item whose saved link exists but whose
   fetch failed, it contradicts the Share corner showing that same link. The same conflation existed before, when the
   YouTube text was "No YouTube source found".

Security (standing): no new route (0 added `app.<verb>(`), SCHEMA_VERSION 33 unchanged. Verified: the card attribute
is escaped (main.js:141-147, 757; test at card-corner-renderer), aria-label and title are fixed strings, and the Stats
and duplicate labels are textContent (common.js:16002, stats.js:291). The badge path comes from a fixed table; the 12
SVGs have no script, handler or href (grep, plus site-badges.test.js). Simple Icons 16.32.0 exists and its license is
CC0-1.0 (verified with `npm view simple-icons@16.32.0 version license`). Every list gates visibility before it adds
`sourceShareUrl`. The reheat's guards agree with the security-brief's entry above. No em dashes in the diff
(grep count 0). Acceptance: D1-D10 are each measured by a named test, except D2's call-site wire (item 5). The
phone watch-page render is honestly disclosed as Dean's device check, and the route and Pin halves are bound
elsewhere.

## r1 fix list (handoff 2026-09-26)

Seats at c90977a2: security-brief APPROVED r1 (2 suggestions); qa CHANGES r1 (1 CRITICAL, 5 WARNING,
3 SUGGESTION); adversary STOPPED mid-run by the Architect for a session handoff (no verdict; partial
scratch logs in the session scratchpad adv338-*: it had reached an end-to-end carrier test - move,
trash/restore, backup round-trip). A FRESH adversary must run r1 on the fix-round sha.

To do, in order:
1. qa 1 (CRITICAL): test/integration/ytdlp-spawn-security.test.js:1733 pins parseChannelMetaLine's
   exact shape - add `webpageUrl: null`. Then run the FULL `npm test` (the pre-commit hook runs only
   the unit suite; the integration suite was never run before the gate).
2. qa 2: the site badge leaks into Music (server.js ~4210 sets `track.avatarUrl` from
   resolveItemChannelAvatarUrl -> lib/music/query.js groupArtists -> music.js / music-skins.js artist
   circles show the site logo instead of the cover mosaic, and can displace a real channel photo).
   Planned fix: keep the badge out of the Music projection (e.g. an opts flag on the resolver,
   `{ siteBadge: false }`, at that one call site) + a test; disclose. (A ruling for Dean only if he
   wants badges in Music.)
3. qa 4 + security-brief's note: lib/ytdlp/index.js ~903 `exhausted = !watchUrl && local !== null`
   marks every universal item complete even when its NEW network pass failed (a 429 = never retried
   by a non-force batch). Fix: not exhausted when a universal page link was derivable (hoist
   `sourcePage`); a failed universal pass leaves it retryable; bind with a test; fix the comment.
   Disclose: downloads reheated before v1.338 carry `metadataRepulledAt`, so the batch skips them -
   D9 reaches them via the per-video Reheat or a forced batch.
4. qa 3: lib/ytdlp/client/subscriptions.js ~1458-1476 `formatReheatSummary` words on `withSourceId`
   (YouTube only): count universal items with a link as having a source (relocation.js
   enumerateRepullableItems `withSourceId`), reword "YouTube source link" -> "source link", keep the
   "one fetch each ... downloads wait" warning for them.
5. qa 5: bind the D2 fallback CALL SITE (index.js ~4556 `withUniversalPageUrl(...)` in runOneShot):
   a test through the one-shot harness (test/integration/ytdlp-oneshot.test.js ~1268) - a universal
   capture with no webpage_url saves the job's URL.
6. qa 6 + security-brief 1/2 (stale comments): lib/media/source-share.js header ("WATCH PAGE only ...
   nothing new stored" / "does not store its page URL"); lib/media/routes.js ~828-833 (skins share
   no longer YouTube-only); lib/ytdlp/store.js resolver JSDoc pushed above SITE_BADGES (move it back,
   note the badge bypasses sanitizeChannelAvatarUrl); lib/scan/orchestrator.js ~1587 + the test title
   scan-source-url-bridge.test.js:138 (no real mid-scan writer of sourceUrl exists today - word it as
   the persist-gate checkpoint); index.js ~1484-1486 client text quote; run.js ~1626-1630 @param and
   ~1641-1647: DISCLOSE the residual (yt-dlp re-resolves the host and follows redirects after
   guardHop; the download lane carries the same residual, url.js:327-341, shortlink.js:28-29; D9 adds
   REPLAY of a stored link); test/unit/reheat-button-wiring.test.js:228 title.
7. qa 7 (suggestion, cheap): strip the raw `sourceUrl` from the `...item` spreads of GET /api/videos,
   /api/videos/:id, /api/liked (serve only the re-checked `sourceShareUrl`).
8. qa 8/9 (suggestions): watch.js pinOnly never un-hides Pin (needs the module to flip on within one
   page - likely disclose); an exact-text test for the "No source link found" toast.

Then: commit (by name, -F file, verify git log); mutate each new fix in a /tmp git-archive sandbox;
full `npm test` on 22.23.1; re-engage QA + security-brief (SendMessage cannot reach them from a new
session - spawn FRESH seats with the r1 findings and "verify each r1 finding against the fix sha") +
a FRESH adversary; max two rounds (round 3 = ask Dean). Release per docs/RELEASING.md as v1.338.0.

## r1 fix record (0e90a9c7)

Every item of the list above, in order: (1) the integration pin gains `webpageUrl: null`; (2) Music: the
resolver takes `{ siteBadge: false }` at `projectedLibraryTracks` (server.js), bound through GET
/api/music/artists with a Bandcamp download (music-library-projection) and in site-badges; the resolver
JSDoc moved back above its function; (3) `sourcePage` hoisted, `exhausted = !watchUrl && !sourcePage &&
local !== null`: a failed universal pass persists nothing and stays retryable, a Pass-A-only pass is not
complete, no link from anywhere is still exhausted (ytdlp-repull-item-endpoint); (4) `withSourceId` counts
an in-root download from another site with a usable saved link (relocation.js; a hostile, an out-of-root,
an unlinked one: not counted; repull-persist), wording "source link"; (5) the D2 fallback bound at the
one-shot call site (ytdlp-oneshot: no printed link -> the job URL; a printed one wins); (6) the stale
comments and titles corrected, the re-pull residual disclosed in run.js; (7) `sourceUrl: undefined` after
the spread on GET /api/videos, /api/videos/:id, /api/liked and /api/history (source-share-lists, all four
bound); (8) the pin-only pass reveals a hidden Pin (watch-init-behavioral); exact-text bindings for both
reheat toasts; a failed fetch of a saved link reports outcome 'failed' ("try again"), never "No source
link found" (fix 3 made that so; bound).

Disclosed (ships): downloads from another site reheated before v1.338 carry `metadataRepulledAt` from
their earlier exhausted pass, so a non-force library batch skips them; D9 reaches them through the
per-video Reheat or a forced batch. A saved link found only in the file's tags is fetched at reheat time
but not counted in the summary's network count (no file reads while enumerating).

Measured (Node 22.23.1): full `npm test` with FILETUBE_TEST_FFMPEG at 0e90a9c7: `# tests 9746` `# pass 9746`
`# fail 0` `# skipped 0`, exit 0. `npm run lint` 0 errors (the 6 pre-existing warnings); `npm run lint:css`
`TOTAL 0`. Mutants (a /tmp git-archive sandbox of 0e90a9c7, pristine diff 0 after each): 16 of 16 RED -
the Music call site, the resolver opt, `exhausted` without `sourcePage`, the universal pass disabled,
the three `withSourceId` conjuncts, the summary wording, the D2 call site, the four spreads, the Pin
reveal, the skins toast text, and the parser's `webpageUrl` (the integration pin, the r1 CRITICAL).
