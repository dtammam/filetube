---
plan: first-class-any-site
harness: v2 · lean
branch: feat/v1.338-card-share-saved-link
anchor: spec
status: Draft
next: build in blast-radius order - D1-D5 (the saved link: capture, carriers, backfill, serve), D6 Share, D7 icon, D8 fixes, D9 Reheat.
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

