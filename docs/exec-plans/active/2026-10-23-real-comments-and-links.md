---
plan: real-comments-and-links
harness: v2 · lean
branch: feat/v1.394.0-real-comments
anchor: spec
status: Building
next: the FULL gate (adversary + qa + security-brief) on W1-W4
design: Approved 2026-10-23 @a11d7b9d
gate: pending
builder: smart
---

# v1.394.0 - clickable links, and the real top comments

Kickoff 2026-10-23 (Server/Web Root, Opus). **Builder: Smart (Opus).** It adds a new per-video table (a carrier
seam, LESSONS 9), a third-party flag interplay (LESSONS 2, 11), and untrusted text rendered as links. The table is
additive and comments can be fetched again, so this is not Extreme. **The gate is still FULL** because the change
alters the schema (`.harness/scrutiny.toml` data-loss rule).

One release, version **1.394.0**. Two parts, one branch:

1. **Links and timestamps in descriptions are clickable.** A URL in a video's description opens in a new tab. A
   time like `2:15` or `1:02:33` jumps the player to that time.
2. **Real comments.** A downloaded YouTube video keeps its **top 10 comments**, the snapshot taken when it was
   downloaded. Reheat refreshes the snapshot. They show where the fun comments show today, on desktop and phone,
   behind a new setting: Real / Fun / Both / Off. Links and timestamps in a comment are clickable. Author names are
   plain text.

## Why

Descriptions are already saved (`item.tags.description`) but render as dead text (`renderVideoDescription`,
`public/js/watch.js:1949`, `textContent`). The fun comments are a toy. A video's real top comments are part of
its context, and they can disappear from the source. Dean wants them saved next to the file.

## Rulings (settled at kickoff - do not reopen)

| ID | Topic | Ruling |
|----|-------|--------|
| R1 | Setting | A new synced pref `ft-comments`, with values `both` / `real` / `fun` / `off`. **Real comments show in every look, Modern included. Fun comments stay limited to the retro looks**, exactly as today (`.ft-fabricated` + `data-era-flourish`). The default when unset is `both`, which shows fun + real in 2005/2009/2014 and real only in Modern (the fun ones are hidden there by the existing rule). `off` hides the real and the fun comments. The user's own posted ("You") comments keep today's behaviour in every mode except `off`. |
| R2 | Kid / restricted accounts | **Restricted accounts never receive real comments from the server**, only the fun ones. "Restricted" = a non-admin user with at least one `user_restrictions` row, in either mode (blocklist or allowlist; `lib/auth/routes.js:460-465`). This check runs on the server: the API omits the comments, and the client never just hides them. An admin, and no-auth single-user mode, get them. |
| R3 | Backfill | New downloads, the per-video **Reheat metadata**, and the **library-wide reheat** all fetch comments. The library-wide pass keeps its existing pacing. If that pacing does not cover the extra request, the builder adds a delay between items and documents the value. |
| R4 | Clickable | URLs in the description and in comment text become links (`http`/`https` only, a new tab, `rel="noopener noreferrer"`). Timestamps in the description and in comment text seek the player. **No** "view on the source site" link line (Dean declined it; it also keeps v1.391.0's no-brand-in-UI posture). Comment authors are **not** links. |
| R5 | How many | The top 10 top-level comments (`comment_sort=top`), with no replies. A pinned comment counts toward the 10 (yt-dlp returns it first). |
| R6 | Dates | YouTube only gives relative time ("2 years ago"). yt-dlp's `timestamp` is an **estimate** computed at fetch time (`_video.py:2399` marks `_time_text` "an estimate"). Store `_time_text`, the estimated `timestamp`, and the `fetchedAt` time. Display the estimate as relative time from now with a leading `~` ("~2 years ago"), so it ages correctly. Never show it as an exact date. |
| R7 | Download option | A downloads setting **"Save top comments"**, **on by default**. Off means no `--get-comments`. Reheat obeys it too. |
| R8 | Sites | **YouTube only** this release. The flag is scoped by `youtube:` extractor args, and a non-YouTube item stores nothing. **Reddit goes on ROADMAP Planned**: yt-dlp has NO Reddit comment extraction (`yt_dlp/extractor/reddit.py` has no `_get_comments`), so it would need our own Reddit fetch. |
| R9 | A failed fetch never erases | A reheat or download whose comment fetch fails, is interrupted, or returns zero comments **keeps the existing snapshot**. Only a successful, non-empty fetch replaces it. Exception: the video has comments disabled (yt-dlp `CommentsDisabled`, `comment_count` 0 with no warning). Store that as an explicit "comments off at the source" state. If telling the two apart is not reliable from the outputs we get, keep the old snapshot (STOP and report what you measured). |
| R10 | Labels | Neutral copy: "Top comments", "Saved <relative fetch date>". **No "YouTube" in user-facing strings** (v1.391.0 App Store posture). |

## Research (verified at kickoff against the pinned yt-dlp 2026.8.17.73947.dev0 wheel)

- `--get-comments` (`options.py:1526`, dest `getcomments`) fetches comments into the info dict without writing an
  info.json. FileTube avoids `--write-info-json` on purpose (`lib/ytdlp/args.js:657`). Read the comments through
  a `--print` template, like `FTCHMETA` (`args.js:743/757`, parsed at `run.js:587/628`).
- YouTube extractor args: `max_comments=<max>,<max_parents>,<max_replies>,...` (`_video.py:2578-2579`, `:2684`)
  and `comment_sort=top|new` (`:2466`). For R5: `max_comments=10,all,0` + `comment_sort=top`.
- **TRAP (LESSONS 2/11, already paid for in v1.47.4):** a second `--extractor-args youtube:...` element **replaces**
  the first (`args.js:965-982`). The comment args MUST join the existing `youtubeExtractorArgs` array
  (`args.js:~1003`, `skip=translated_subs;player_client=...`). Two flags would silently drop the bot-check
  `player_client` mitigation. Bind it with a test that parses the built argv. That covers presence. Also
  mutate the join and watch the test go red.
- Comment fields (`_video.py:2374-2400`, `:2403-2450`): `id`, `text`, `author`, `author_id`, `author_url`,
  `author_thumbnail`, `author_is_uploader`, `author_is_verified`, `like_count`, `is_pinned`, `parent`,
  `timestamp` (estimated), `_time_text`. Store only what R1-R6 render: id, text, author (display only),
  like_count, is_pinned, author_is_uploader, timestamp, _time_text. **Never store or serve `author_url` or
  thumbnails** (authors are not links, and serving them means fetching third-party images).
- Failure posture (`common.py:3880-3910`): a comment-extraction exception is caught and reported as a warning, and
  `comment_count` comes back `None` when interrupted. The download itself does not fail. Prove this on a real
  run (W2 evidence). Do not trust the reading alone.

## Design

**Storage (W2).** A new feature-owned table, never a `db.metadata` field (LESSONS 9: avoid the persist-gate
OR-chain entirely). Proposed: `media_source_comments (media_id TEXT PRIMARY KEY, payload TEXT NOT NULL,
fetched_at TEXT NOT NULL, state TEXT NOT NULL)`, where state is `ok` or `disabled`. `payload` is the JSON array,
capped at 10 entries and at a per-comment text length (2,000 characters) and a total byte cap. It is an
**append-only** schema step in `lib/db/sqlite.js` (`SCHEMA_VERSION` + 1). The prior art for the shape is
`media_liked` / `lib/media/jsonRowStore.js`. It is id-keyed, so **in the same commit** it joins
`removeMediaState` and `rekeyMediaState` (`lib/auth/store.js`). Also handle trash/restore, move/relocate (the
v1.41.6 import relocation, `server.js:6010+`) and the **backup bundle**, or argue in the plan why a carrier does
not apply. Refuse NUL ids at the write (LESSONS 9).

**Capture (W2).** Download argv (`buildYtdlpDownloadArgs`, `args.js:1252+`): when R7 is on and the lane is
YouTube, add `--get-comments` + the joined extractor args + a new `--print after_move:FTCOMMENTS ...` line that
prints the comments JSON together with the video id and `comment_count`. Parse it in `run.js` next to
`parseChannelMetaLine`. Carry it across the same downloadMeta bridge (`ytdlp_download_meta`) to the scan/consume
step that creates the item (`lib/scan/captured.js`, `lib/scan/orchestrator.js`), which then writes the table
under the item's media id. **Prove reachability** with the real upstream output shape: one real download on the
box, plus a fixture captured from it. A unit test over a hand-made line is not enough (LESSONS 11, inert
feature). If the bridge cannot carry it cleanly, a direct write keyed by the final filepath is acceptable. Log
the choice under Deviations.

**Reheat (W3).** `repullItemMetaAndSubs` (`run.js:2082`, `--dump-json --skip-download`) adds `--get-comments`
and the joined args under R7. The comments arrive in the dumped JSON, so there is no extra print. Apply R9.
Per-item route: `POST /api/ytdlp/repull-metadata/item/:mediaId` (`lib/ytdlp/index.js:7405`). Library-wide:
`POST /api/ytdlp/repull-metadata` (`:7234`), under R3. Note: the non-force reheat skips items that carry
`metadataRepulledAt` (`server.js:6101-6111`). Decide and document whether an item with no comments snapshot
counts as "may-refresh" for comments. Recommended: yes, so the library backfills once, and say so in the
reheat preview copy.

**Serving (W4).** The watch page's item fetch (or a small `GET /api/media/:id/comments`, whichever matches the
existing patterns better) returns `{state, fetchedAt, comments[]}`. It applies `isBlocked` visibility (the item's
own access check) **and R2**. Enumerate every surface that could leak the comments: the item route, any list or
aggregation, search (comments must NOT be indexed into search this release), the backup bundle (it should
carry them, for the admin), and the stats page. Put that list in Evidence (LESSONS 10).

**Rendering (W1 + W4).** One shared pure module, `public/js/rich-text.js` (name it as you like), that turns
untrusted text into DOM nodes: text nodes, `<a href target=_blank rel="noopener noreferrer">` for
`https?://` URLs (trim trailing punctuation, length-cap the visible text, never `innerHTML`, reject every other
scheme), and `<button>` seek chips for `h:mm:ss`/`m:ss` within the media duration. It is used by
`renderVideoDescription` and by `buildCommentNode` (`watch.js:3467`). The real comments render through
`renderComments` (`watch.js:3502`) as a block above the fun ones. They carry a class that is NOT
`.ft-fabricated`, so Modern shows them (R1). The pinned badge, the "uploader" badge and the like count are
optional and only allowed if they fit the existing comment row. The heading reads "Top comments · saved ~3
days ago". The setting goes into Settings next to the existing look options (`public/js/setup.js`, where
`ft-star-ratings` lives at `:1031`) and into `SYNCED_PREF_KEYS` (`lib/prefs-allowlist.js:10`). The R7 toggle
goes in the Downloads settings next to the existing yt-dlp options.

**iOS.** The host is documented to open non-server links in Safari (store-cleanup plan, "Disclosed up front").
Make no change here. Add a device check, and tell the iOS Root in the report.

## Step 0 (builder, before W1)

- Read `AGENTS.md` and `docs/LESSONS.md` (sections 2, 3, 6, 9, 10, 11 at least), `docs/RELEASING.md`, then this
  plan once.
- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every
  npm/node/git command. Use Node 22.23.1 locally; Node 24 runs in PR CI.
- Git: work on `feat/v1.394.0-real-comments` (this plan is committed there, branched from main @a11d7b9d). Stage
  by name. Commit with `git commit -F <file>`. Never pipe a commit or push; verify with `git log` / `git ls-remote`.
  No `--no-verify`, no force-push. main is protected: use the PR flow in `docs/RELEASING.md`. Before the release
  commit, merge the current origin/main in and re-run the full suite, if main moved.
- **Stop rules** (ask Dean with AskUserQuestion):
  1. R9's "disabled vs failed" cannot be told apart.
  2. The real download shows comment fetching adds more than ~5 s per video, or trips a bot check.
  3. A carrier (rekey/trash/backup) cannot take the new table without changing an existing table.
  4. Serving needs a route change that the iOS bridge contract (`docs/references/native-bridge.md`) pins.
  5. Anything that would change a fun-comments behaviour beyond R1.
- Run targeted tests per wave. Run the full suite once before the gate and once before the release commit.

## Waves (one branch; commit per wave)

### W1 - the shared rich-text renderer + clickable descriptions
The pure module + `renderVideoDescription` switched over. Tests: a table of inputs covering
`javascript:`/`data:`/`vbscript:`, mixed case, HTML in the text (`<img onerror>` stays text), trailing
punctuation, parentheses, very long URLs, `1:02:33`/`2:15`, a time past the duration (not a chip), and
`10:00` in "10:00 am" (decide and document). Mutate the scheme check and watch the tests go red. **Demo:** a
watch page with a URL and a timestamp in the description. The link opens in a new tab, and the chip seeks.

### W2 - storage + capture on download
The schema step, the store, the carriers (same commit), the R7 setting (server-side config + the argv), the
joined extractor args, the FTCOMMENTS print + parse, and the bridge to the item. Tests: an argv test (ONE youtube
`--extractor-args` element containing `skip=translated_subs`, the player client when set, `max_comments=10,all,0`,
`comment_sort=top`); the R7 off case; the carriers (rekey moves the row, remove deletes it, the backup round-trips
it); a NUL id refused. **Real run:** one YouTube download on the box with the pinned yt-dlp. Record the
FTCOMMENTS line shape, the time added (with vs without), and the stored row in Evidence. Keep the captured line
as a test fixture. **Demo:** a fresh download has a row in `media_source_comments`.

### W3 - reheat (per item + library-wide)
`repullItemMetaAndSubs` + both routes, R9, and the R3 pacing. Tests: success replaces; failure / interruption /
zero comments keeps the old snapshot; disabled stores `disabled`; R7 off leaves the row as it is; the
library-wide pass picks up items with no snapshot (per the design choice). Mutate R9's guard to "always replace"
and watch the test go red. **Demo:** Reheat metadata on an old download fills its comments.

### W4 - serving + the watch page + the setting
The API field/route with visibility + R2; the comments block; `ft-comments` in Settings + `SYNCED_PREF_KEYS`;
links and seek chips in comment text; the `~` relative dates; the "saved ~X ago" heading. Tests:
- R2 over all three account kinds (admin, restricted blocklist, restricted allowlist, plus an unrestricted member)
- a blocked item never returns comments
- the four `ft-comments` values × Modern vs a retro look (which nodes render; fun never in Modern)
- the "You" comments survive every mode except `off`
- `npm run lint:ui` and the overlay census at zero

**Measure** the comments block on desktop and at phone width (rows wrap, nothing shrinks; a long URL wraps
and does not widen the page). **Demo:** a downloaded video shows "Top comments" in Modern and in 2009, with
working links and chips. Switching the setting to Off empties the section.

## Acceptance

1. A URL in a description or a real comment is an `<a>` that opens in a new tab. A `javascript:` (or any
   non-http(s)) URL is never a link. No description or comment text ever reaches `innerHTML`.
2. A `m:ss` / `h:mm:ss` within the duration, in a description or a real comment, seeks the player there.
3. A new YouTube download with "Save top comments" on stores up to 10 top-level comments, and the watch page
   shows them, on desktop and phone, in every look.
4. Reheat (per item and library-wide) refreshes the snapshot. A failed or empty fetch never erases an
   existing one (R9).
5. `ft-comments` = both/real/fun/off behaves per R1, syncs across devices, and Modern never shows fun comments.
6. A restricted account's responses never contain real comments (R2). This is checked at the API, not the DOM.
7. Rekey, removal, trash and the backup carry the new table. The download argv keeps exactly ONE youtube
   `--extractor-args` element.
8. Comment dates show as `~<relative>` and never as an exact date.

## Gate

FULL: **adversary + qa + security-brief** (`lib/**` + a schema step). Brief them with LESSONS 2, 9, 10, 11 and the
attack surfaces below:
1. **XSS / scheme bypass** in the renderer: entity tricks, `JaVaScRiPt:`, `https:` with `javascript:` inside,
   unicode lookalikes, an extremely long or pathological regex input (ReDoS: time it on a 100 KB description).
2. **The extractor-args clobber.** Prove `player_client` survives with comments on.
3. **Inert feature:** does a real download actually populate the table? (the W2 real-run evidence; re-run it
   if in doubt).
4. **R9:** try to make a reheat erase a snapshot (network kill mid-fetch, a comments-disabled video, R7
   toggled off mid-library-pass).
5. **R2 leak completeness** across every read surface, including the backup and any list route.
6. **Carriers:** move, trash, restore and rekey a video, then confirm its comments follow it, and that a
   deleted video leaves no orphan row.
7. A lying comment, or the R1 matrix not bound (mutate the `.ft-fabricated` class onto real comments and watch
   a test go red).

## Release

Follow `docs/RELEASING.md` (v1.394.0). Add a ROADMAP Shipped entry and a `docs/releases.json` entry in pure user
language, e.g. "Links in video descriptions are clickable, times jump the video, and downloaded videos keep their
top comments". **ROADMAP Planned** gets: real comments for Reddit (needs our own fetch; yt-dlp has none) and
other sites. Add the LESSONS.md line the wave teaches, if any. Close the plan with
`node scripts/plan-complete.js docs/exec-plans/active/2026-10-23-real-comments-and-links.md "Shipped v1.394.0" --apply`
in the release PR. Merge on green unit CI + the approved gate (Dean authorizes merging on green for every PR
this plan produces). Shipped = the tag's Publish Docker Image run is green.

Add these DEVICE-CHECKS lines:
- (a) a link in a description and in a comment opens on the iPhone app (Safari) and on desktop
- (b) a timestamp chip seeks, on the phone and on desktop
- (c) "Top comments" in Modern and in a retro look, on the phone
- (d) the setting's four values
- (e) a kid account shows no real comments
- (f) Reheat fills comments on an older download

## Report (builder -> Dean, and SendMessage to "FileTube iOS Root Session")

1. The version and the merge sha.
2. For the iOS Root: description and comment links are now real `<a target=_blank>` to third-party sites, so
   please confirm they open in Safari. The comments section is labelled neutrally ("Top comments"). Ask whether
   showing source-site comments raises an App Review concern (5.2.3 / 4.1(c)) and whether the store build
   wants them gated behind `mediaFetch`. That is a ruling for Dean; do not build the gate unasked.
3. The measured cost of comment fetching per download, and the library-wide reheat pacing used.

## Disclosed up front

- Comment dates are estimates from YouTube's relative text, at fetch time.
- The snapshot is frozen until a reheat. Like counts and the order age with it.
- Only YouTube this release. Reddit and other sites are on ROADMAP Planned.
- Restricted accounts see only fun comments, even for videos they can watch.

## Deviations (builder logs here)

- **D1 (W2, Dean's ruling 2026-10-23): a comment failure fails the whole download.** The Research
  bullet ("the download itself does not fail") is wrong for FileTube's effective
  `ignoreerrors='only_download'`: `extract_comments` re-raises (`common.py:3899`), the post-extractor runs
  before the download, and `_handle_extraction_exceptions` reports the error and skips the video.
  Measured on the real pinned binary with an injected `ExtractorError` in `_comment_entries`: exit 1, no
  file. Asked Dean (AskUserQuestion, three options); he chose "Retry once without": a comments-on
  download that fails retries ONCE with every comment flag stripped (`run.js shouldRetryWithoutComments`),
  except when every failure is plainly about the video itself (private, removed, members-only, a bot
  check, a live event). Any retry strips comments. Measured through FileTube's own `runDownload`: the
  injected failure, then the stripped retry, landed the video (`commentsFallback: true`).
- **D2 (W2): the "comments disabled" discriminator is "both keys absent", not `comment_count` 0.**
  `CommentsDisabled` returns `{comments: None, comment_count: None}` (`common.py:3895`), and the `.{}`
  print selector (and `--dump-json`'s sanitize) drop None keys: the line is `{"id": ...}` (measured,
  injected). An interruption leaves a partial list with `comment_count` None, a success a full list with
  `comment_count == len`. So R9 is decidable (`sourceComments.decideSnapshot`); no stop rule.
- **D3 (W2): the stdout line cap.** `run.js`'s line splitter discarded every line over 4096 characters;
  the real FTCOMMENTS line is 5,716 bytes, so the capture would have been inert. stdout now has its own
  1 MiB cap (`STDOUT_LINE_LIMIT`); stderr keeps 4096. Bound by the real fixture through the spawn path.
- **D4 (W2): `--no-write-info-json`.** `yt_dlp/__init__.py:598` turns `--get-comments` into
  `writeinfojson=True` when nothing prints JSON and the option is unset. The download argv passes the
  explicit "no" so no `.info.json` is ever written.
- **D5 (W2): the R7 setting lives in the downloader's state file** (`lib/ytdlp/engine.js`, the store behind
  Settings > Downloads, beside `autoUpdate`), not a database namespace. It is not in the backup bundle;
  after a restore it reads as the default (on).
- **D6 (W2): comments ride only a YouTube-lane VIDEO download.** Audio downloads and the any-site
  (universal) lane never ask (R8, and audio files are music tracks).
- **D7 (W2): the bridge is the download-meta entry** (the plan's preferred path): run.js joins the
  FTCOMMENTS snapshot onto its FTCHMETA entry by video id, the existing record / consume re-validate it,
  and the scan writes the table under the item's id after its commit (`noteDownloaded(item, consumed)`,
  all three consume sites). A capture with no channel identity (consume returns null) carries no comments.
- **D8 (W2, widened in gate r1): a restore keeps snapshots only for ids the restore has** - the bundle's
  library index AND its trash records (a trashed video's snapshot lives under its trashId). A bundle without
  `sourceComments` (every older export) keeps those live snapshots; a bundle with it imports only those ids
  (orphans and `__proto__` keys dropped).
- **D9 (gate r1, Dean's ruling 2026-10-23, AskUserQuestion): "comments turned off" never erases saved comments.**
  R9's exception stored the disabled state over any snapshot; qa found yt-dlp raises `CommentsDisabled` for ANY
  source message with zero comments (`_video.py:2663-2666`), and the feature exists because comments vanish.
  Dean chose "Keep the saved ones": `apply()` stores `disabled` only where nothing was saved.
- **D10 (gate r1): an older fetch never replaces a newer one** (`apply()` compares `fetchedAt`; a stale
  download-meta entry consumed after a reheat is ignored).
- **D11 (gate r1): the comments retry keeps the first attempt's capture** for every video it skipped
  (`mergeRetryCapture`, both retry branches - the subtitle branch had the same drop before this release). A
  rate limit (HTTP 429) still retries once (the comment API's 429 is the case the retry rescues; it asks for
  fewer requests). A reheat writes only while the item still owns its id, never asks for an audio item, and
  the library pass paces a FAILED comments-on item too.
- **Disclosed (gate r1, security NOTE-3):** an extreme comment set (ten 10,000-character comments of emoji,
  escaped as `\uXXXX`) can exceed the 1 MiB stdout line; that download then saves no comments (R9 keeps any
  stored snapshot). A shortened link never cuts inside its host (NOTE-2, fixed).

## Evidence (builder fills)

### W1 - the rich-text renderer
- Tests: test/unit/rich-text.test.js 21/21 (schemes incl. `javascript://example.com/...`, `JaVaScRiPt:`, lookalikes,
  HTML-as-text, trailing punctuation + balanced parens, long links, times within/past the duration, "10:00 am"
  decided NOT a chip, the shell census, the real watch view: link + chip + Copy description copies the raw text).
- ReDoS: 7 pathological 100 KB inputs each tokenize in < 1 s (asserted; the scanners are a fixed prefix + one class).
- Mutants (sandbox of the committed tree): protocol check removed -> first SURVIVED (masked by the hostname check),
  a test with hostname-bearing non-http schemes added -> KILLED; scanner accepts any scheme -> KILLED (4); paren
  balance -> KILLED; duration bound -> KILLED; clock suffix -> KILLED.

### W2 - storage + capture (REAL run, pinned yt-dlp 2026.8.17.73947.dev0 in a scratch venv, static ffmpeg 7.0.2)
- Video jNQXAC9IVRw through FileTube's own `run.runDownload`, one-off lane: comments off 14.9 s, on 17.0 s (+2.1 s);
  raw yt-dlp with the FileTube argv: 13.6 / 13.3 s off, 15.8 / 15.7 s on (+2.2 / +2.4 s). Under the 5 s stop rule; no
  bot check.
- FTCOMMENTS line shape (fixture test/fixtures/ytdlp-comments/ftcomments-jNQXAC9IVRw.txt, 5,716 bytes):
  `FTCOMMENTS {"id": "jNQXAC9IVRw", "comment_count": 10, "comments": [{"id", "parent": "root", "text", "like_count",
  "author_id", "author", "author_thumbnail", "author_is_uploader", "author_is_verified", "author_url", "is_favorited",
  "_time_text", "timestamp", "is_pinned"}, ...10]}`. Stored row keeps id/text/author/likeCount/isPinned/isUploader/
  timestamp/timeText only.
- Injected comment-API error (real binary, `_comment_entries` raising ExtractorError): attempt 1 exit 1 with no file;
  the comments-stripped retry landed the video (`commentsFallback: true`). Injected `CommentsDisabled`:
  `FTCOMMENTS {"id": "jNQXAC9IVRw"}` -> stored state `disabled`.
- Stored row (bridge -> scan, test/integration/ytdlp-comments-capture.test.js on the real fixture lines):
  `{state:'ok', comments: 10, comments[0].author '@SanDiegoZoo', isPinned true}` under the scanned item's id.
- Mutants: 15/16 KILLED; M16 (the any-site proxy consume site not passing `consumed`) is equivalent - that lane
  never asks for comments (D6).

### W3 - reheat (REAL run)
- `repullItemMetaAndSubs` on the downloaded file: off 6.2 s / 6.1 s, on 8.7 s / 7.2 s (+1.1 to +2.5 s), 10 comments
  decided. (Its subtitle pass exits 1 on this box in BOTH modes - pre-existing, unrelated.)
- R3 pacing: the library batch had no inter-item gap and no --sleep-requests on the re-pull; a comments-on item is
  now followed by REHEAT_COMMENTS_GAP_MS = 2000 ms (the download lane's --sleep-interval default).
- Backfill choice: a reheated video with no snapshot is "may-refresh" (preview + executor share one predicate); the
  Run card copy says so. A zero-comment or always-failing video stays may-refresh (bounded, disclosed).
- Mutants: 9/10 KILLED (R9 "always replace" in the writer KILLED; the fallback dump deciding KILLED); W3M9 (the
  route's `result.sourceComments &&`) is masked by the store's own null guard, which W3M8b binds.

### W4 - serving + watch page + setting
- R2 surfaces (LESSONS 10): GET /api/videos/:id/comments is the ONLY reader (item gate first, R2 second, private
  no-store). Not in GET /api/videos/:id, the library list, search (asserted: no comment text on any of them), the
  stats page (lib/stats.js reads no comments table), the device-token scope (default deny, not listed), push or
  notifications. The backup bundle carries `sourceComments` (admin-only route).
- R2 over admin / restricted blocklist / restricted allowlist / unrestricted member / admin-with-rows: comments-api
  6/6. Hidden item, missing, `__proto__`, `constructor`, NUL id: 404.
- R1 matrix: 4 values x Modern + 2009 through the REAL view with the page's own era CSS (getComputedStyle):
  watch-real-comments 13/13.
- Measured (Chromium, the visual harness, seeded fixture + a hostile long name/link comment): phone 390 px and
  desktop 1440 px, Modern and 2009 - document width == viewport (first run found an unbroken 70-char author at
  579 px on the phone: fixed with overflow-wrap on .comment-author-name, re-measured 390); the long link wraps to
  2 lines on the phone; 10 rows; fun rows 0 in Modern, visible in 2009; Comment button 95.7 / 96.6 px.
- lint:ui OK (ledger unchanged); overlay census 0.
- Mutants: 10/10 KILLED (incl. .ft-fabricated on real rows, R2 off, visibility off, own-property lookup, the
  duration re-render, the "~", admin-first).

### Full suite before the gate (Node 22.23.1, npm test, at e74377cc)
- 12,698 tests: 12,684 pass, **1 fail**, 13 skipped. The fail: `ytdlp-oneshot-keep-mine.test.js` S1 (c),
  "anti-vacuity: the failing download really ran" expected 1 spawn, actual 2 - the new comments-stripped retry
  (D1), intended. The test now asserts 2 spawns with the retry free of comment flags and the only copy intact
  after both; re-run 8/8.

### Gate verdicts
- Gate: APPROVED r1 @73380359 — security-brief (no CRITICAL/WARNING: DOM-only renderer with http(s)-only parsed hrefs, fixed-literal argv, JSON-escaped sentinel with discard-whole cap, R2 enforced server-side on the only reader; 3 NOTEs)
- Gate: CHANGES r1 @73380359 — qa (2 WARNINGs: a comments retry drops the first attempt's captured meta/comments for a batch's landed siblings (verified repro); a 'disabled' fetch overwrites a saved ok snapshot (R9 vs the Why); 5 SUGGESTIONs)
- Gate: CHANGES r1 @73380359 — adversary (3 WARNINGs: the comments retry drops attempt-1 captured meta + comments of a batch's landed videos (repro); a reheat writes the snapshot under an id deleted/moved mid-run, an orphan row (repro); unbound wires - the subscription lane's saveComments and R7-off at both download sites and the reheat retry's numeric-code guard survive mutation; real e2e download+reheat reach the table; 5 SUGGESTIONs)
