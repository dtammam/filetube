---
plan: store-cleanup
harness: v2 · lean
branch: chore/v1.391.0-store-cleanup
anchor: spec
status: Approved @2fea29a1
next: builder - cut the branch from main @2fea29a1, then W1 (the mediaFetch capability gate)
design: Approved 2026-10-14 @2fea29a1
gate: pending
builder: standard
---

# v1.391.0 - marketing and maintenance cleanup (App Store prep)

Kickoff 2026-10-14 (Server/Web Root, Opus), from the iOS Root's handoff of 2026-10-13 (Dean approved).
**Builder: Standard (Sonnet).** One release, version **1.391.0**. Behaviour stays the same for anyone in a
plain browser. The changes are a capability gate the iOS App Store build relies on, neutral wording, a shorter
README with a new FEATURES.md, and a privacy page.

**No feature work, and nothing that breaks the bridge.** No API route is renamed or removed. The
bridge contract changes by one add-only capability.

## Why

filetube-ios (private repo) is heading for the App Store. What App Review sees inside the app is mostly this
server's web UI. Three guidelines apply: 5.2.3 (no downloading media from third-party sources such as YouTube),
4.1(c) and 5.2.1 (no use of another company's brand). Google also has a history of going after YouTube
look-alikes. The iOS side ships in parallel as v0.13.0 and pins its `Contract/` to this release's commit.

## Rulings (settled at kickoff - do not reopen)

| # | Question | Ruling |
|---|----------|--------|
| R1 | Capability name | **`mediaFetch`**. It is a pure declaration that has no messages and no events. Its meaning is "this host build may show the web's server-side downloader UI". It is deliberately separate from the existing `downloads` capability (native offline downloads), which is NOT touched. |
| R2 | Gate shape | Show the downloader UI when `!host.present \|\| host.has('mediaFetch')`, read only through `public/js/host-adapter.js`. No User-Agent checks and no `platform` checks. |
| R3 | Settings migration | **None needed.** I checked at 2fea29a1: eras persist as years (`ft-era` = `2005`/`2009`/`2014`/`2021`, names already neutral in `THEME_REGISTRY`), Modern mode is `ft-modern-mode` / `modernMode`, and no `ft-*` key or server pref key or value carries "youtube". Skin ids (`apple`, `ipod-*`) **stay as they are** (no rename means no migration). If the builder finds a persisted YouTube-named or iPod-named VALUE, stop and ask; do not rename it in place. |
| R4 | Identifiers stay | Ids, CSS class names, data attributes, filenames (`ipod-brick.js`), localStorage keys, function and variable names (`isYouTube`, `youtubeId`, `YOUTUBE_ITEM_RE`), DB fields, `/api/ytdlp/*` and `/api/subscriptions/*` paths: **unchanged**. The sweep covers prose only, meaning user-visible copy, comments and live docs. |
| R5 | Functional YouTube references stay | These stay: references that name youtube.com as the external SOURCE the downloader reads (URL shapes, host lists, extractor behaviour, "a YouTube Mix", "Provided to YouTube" tag text, "private to your YouTube account"), yt-dlp args, and test fixtures. These are nominative and only show inside the downloader UI, which the store build hides. **Reword** references that compare FileTube's look or behaviour to YouTube ("YouTube-style", "YouTube's gear", "the YouTube convention", "YouTube's measured glow", "Modern YouTube Mode"). |
| R6 | Dean quotes in comments | A quote that names YouTube is paraphrased without the brand and marked as a paraphrase, e.g. `(Dean, paraphrased: match the reference theatre geometry)`. Never leave a falsified quote in quote marks. |
| R7 | Pocket line names (Dean, 2026-10-14) | **Classic, Mini, Slim, Clip, Touch, Custom.** Nano becomes Slim and Shuffle becomes Clip. The `line` keys (`nano`, `shuffle`) stay as internal keys (R4). Only the labels change. |
| R8 | Generations (Dean, 2026-10-14) | **Plain numbers in our own order inside each line**: "Slim 1" ... "Slim 7", "Classic 1" ... "Classic 3", "Touch 1" ... "Touch 4". No "G", no years, no "1G-3G" spans. The grouping (line > generation > colour) is unchanged. |
| R9 | Colour twins | When two colourways in one line and generation share a colour (today the year breaks the tie), the second and later ones get an ordinal in registry order: "Blue", "Blue 2". Rename "Space Gray" to "Dark Gray". A unit test asserts every row label within a group is unique. |
| R10 | Transparent skins (Dean, 2026-10-14) | **Original drawn art.** The builder replaces the four CC BY-SA webp files with original SVG, or webp rendered from original SVG: a stylized board and a ring. Before the gate, the builder sends Dean 2-3 candidates side by side (SendUserFile + AskUserQuestion). The skin ids stay. Delete the photo files and the CC BY-SA README table. The repo becomes plain MIT again. |
| R11 | Privacy page (Dean, 2026-10-14) | **A file in the repo**: `PRIVACY-IOS.md` at the root. URL: `https://github.com/dtammam/filetube/blob/main/PRIVACY-IOS.md` (live once merged). No GitHub Pages. |
| R12 | yt-dlp binary | **Stays bundled** in the image. App Review never sees the server image, and removing the binary would break existing self-hosters on upgrade. The flag stays off by default. |
| R13 | History is not rewritten | Completed plans, ROADMAP "Shipped" entries, past `docs/releases.json` entries, LESSONS, tech-debt tracker, handoffs archive and git history stay as they are. |
| R14 | Not in scope | Push relay, the icon (Dean: the icon stays, including the glossy red play button; do not flag it), the Jersey 10 font, Cider as the default skin, the browser extension's site hint list (`extension/popup.js` SITE_HINT: nominative, and the extension is a desktop downloader that is not in the App Store), Apple Music and Spotify riffs (Cider and Nordic are already neutral names). |

## Step 0 (builder, before W1)

- Read `AGENTS.md`, `docs/LESSONS.md` (sections 3, 6, 11 at least), `docs/RELEASING.md`, then this plan once.
- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every
  npm/node/git command. Node 22.23.1 locally; Node 24 runs in PR CI.
- Git: work on `chore/v1.391.0-store-cleanup` (this plan is committed there). Stage by name. Commit with
  `git commit -F <file>`. Never pipe a commit or push; verify with `git log` / `git ls-remote`. No `--no-verify`, no
  force-push. main is protected: the PR flow in `docs/RELEASING.md`.
- Stop rules (ask Dean with AskUserQuestion): a persisted YouTube- or iPod-named VALUE turns up (R3); a downloader
  entry point that cannot be gated without changing an API route; the Transparent art candidates (R10, always ask);
  a privacy claim the iOS facts contradict; anything that would change behaviour in a plain browser.
- Targeted tests per wave; the full suite once before the gate and once before the release commit.

## Waves (one branch; commit per wave)

### W1 - the `mediaFetch` capability gate (the one piece of logic)

What the tree does today (2fea29a1): the downloader UI shows when `/api/subscriptions/health` answers 2xx
(`moduleEnabled`). That probe is fetched separately at about 13 sites across `public/js/common.js`, `main.js`
and `watch.js`. The result is cached by `writeCapabilityCache({ moduleEnabled })` and remembered pre-paint as
`ft-ytdlp-module` (`CHROME_FLAG_KEYS.ytdlpModule`). The server registers every yt-dlp route only when
`FILETUBE_YTDLP_ENABLED=true`.

1. `public/js/host-adapter.js`: add `'mediaFetch'` to `CAPABILITIES`. Add `allowsMediaFetch()` to the host
   object, returning `!present || has('mediaFetch')`. Mirror the capability in
   `docs/references/native-bridge.v1.schema.json` (add-only). Document it in `docs/references/native-bridge.md`.
   `test/unit/native-bridge-contract.test.js` must stay green.
2. `public/js/common.js`: add ONE predicate, `mediaFetchAllowed()`, that reads `window.FileTube.host.allowsMediaFetch()`.
   It is true when there is no host object at all, for example in Node tests. Route **every** source of
   `moduleEnabled` through it:
   - each `/api/subscriptions/health` consumer computes `res.ok && mediaFetchAllowed()`. When it is not allowed,
     skip the fetch.
   - `readCapabilityCache()` coerces `moduleEnabled` to `false` when not allowed. `rememberModuleEnabled()` and the
     cache write do the same.
   - census: `grep -n "subscriptions/health\|moduleEnabled\|data-nav=\"subscriptions\"\|ytdlpModule" public/js/*.js`.
     Every hit is either routed or noted in the plan as already downstream of a routed one.
3. Entry points that `moduleEnabled` does NOT already gate must be gated too. The builder enumerates them, which is
   the INERT SIBLING class: one missed entry point is the finding. At minimum:
   - the header Download button and its dialog, and the bottom-nav Subs and Download tabs
   - the Subscriptions nav link and the notification bell
   - the watch page's Subscribe button, bell, Pin, Reheat/Re-pull and "Share the original link to download"
   - the playlist picker, the folder-view Reheat, and any paste-a-URL-to-download path in search
   - the PWA share target
   - in Settings: Downloads (the engine), the Notifications bell copy, the extension pairing, the Videos-section
     relocate note, and Transcript sharing if it is downloader-only
   - direct navigation to `/subscriptions`, which renders a plain "Not available in this app" state (or returns home)
     when not allowed

   Record the enumeration as a table in this plan (entry point -> how it is gated -> test).
4. **Do NOT hide the native offline Download control** (the `downloads` capability, `public/js/offline.js`).
   That is a different feature, and it must keep working in the store build.
5. The pre-paint reserve is the inline `ft-chrome-reserve` blocks reading `ft-ytdlp-module`. They run before
   host-adapter loads, so leave them alone. In a hosted build without the capability, the flag is written `'0'`
   after the first load. Disclose that the first launch after an app upgrade may show a reserved Download slot
   collapse once.
6. Tests (`test/unit/media-fetch-gate.test.js`), each proven by mutation (delete the predicate call, watch it go red):
   - no host: unchanged behaviour (moduleEnabled follows `res.ok`)
   - a host with `mediaFetch`: unchanged
   - a host without it: moduleEnabled is false from every source, there is no health fetch, the cache reads
     false even if it holds true, and each enumerated entry point is absent
   - the offline `downloads` control still renders under a host that lacks `mediaFetch`

### W2 - YouTube branding out of what users see, and out of comments

1. **User-visible copy (known at 2fea29a1, plus whatever the census finds):**
   - `public/setup.html` L384 "Pick the YouTube era FileTube dresses up as" -> "Pick the era FileTube dresses up as."
   - L474 "(YouTube-style rows)" -> "(rows by topic)"
   - L480 "Modern YouTube Mode (big-tile grid + filter chips)" -> "Modern grid (big tiles + filter chips)"
   - L482 "A modern YouTube-style home" -> "A modern home"
   - L337 bell "YouTube-style" -> drop the clause
   - L303 "nightly tracks YouTube's changes closest" -> "nightly tracks site changes closest"
   - L917 relocate note: keep it, it is nominative (R5), but reword "real YouTube identity" -> "a real source link
     from a supported site". Judgment: it stays legible.
   - `public/index.html` `<title>FileTube - Broadcast Yourself (Your Files)</title>` -> `<title>FileTube</title>`.
     "Broadcast Yourself" was YouTube's slogan. Check every other `<title>`.
   - `public/login.html` tagline "Broadcast your files." -> "Your files, on every screen."
   - `public/manifest.webmanifest` description "Self-hosted, nostalgic-YouTube media server." -> "Self-hosted media
     server with a nostalgic look."
   - `public/stats.html` L244 "shortcuts you already know from YouTube" -> "shortcuts you already know from video
     sites". L321 "the same YouTube video" -> "the same source video".
   - `public/js/watch.js` prepopulated fake comments (around L351-L368 and the L3447 seed): reword any that names
     YouTube ("lil b really built his own youtube", "you invented youtube") into brand-free jokes in the same voice.
   - `public/js/watch.js` L3797 "Share the original YouTube link" -> "Share the original link" (both branches).
   - Roku (`roku/`): census its user-visible strings too.
2. **Comments and HTML comments** in `public/`, `lib/`, `server.js`, `roku/`, `scripts/`: reword the brand-as-style
   references (R5, R6). The five-shell "(YouTube's gear)" HTML comment block is identical in every shell, so
   replace it identically everywhere ("(the gear menu)").
3. **The guard (binding, not presence):** `test/unit/brand-neutral.test.js` scans `public/**` (not `vendor/`,
   `fonts/`), `lib/**`, `server.js`, `roku/**`, `README.md`, `FEATURES.md`, `.env.example`, `docker-compose.yml`,
   `Dockerfile`, `package.json`, `docs/CONFIGURATION.md` and `docs/ARCHITECTURE.md`. It checks:
   - `/\bYouTube\b/` (case-sensitive: matches prose, never `isYouTube`, `youtubeId`, `youtube.com`, `YOUTUBE_*`).
     A hit fails unless its `{file, text}` is listed in `docs/brand-references.json`, an allowlist of functional
     lines (R5), each with a one-line reason. The list is shrink-only, like `docs/ui-exceptions.json`.
     `lib/ytdlp/**` is allowlisted as a GLOB (the downloader module names its source by design). Its brand-as-style
     comments are still reworded by hand.
   - `/iPod|IPOD|\bipods?\b(?![-_])/`: **zero** hits, no allowlist (identifiers are lowercase and hyphenated, like
     `ipod-brick`, `ipod-red`). If the lookahead misfires on a real identifier, narrow the regex. Never add an
     allowlist.
   - Prove it binds: put one "YouTube-style" back into setup.html and watch it red. Put one "iPod" into a CSS
     comment and watch it red.
4. Live repo docs that describe the product: the `AGENTS.md` Project context first paragraph ("resembling
   old-school YouTube... retro YouTube-style web UI" -> neutral), `docs/ARCHITECTURE.md` overview,
   `docs/CONFIGURATION.md`, `.env.example` section headers ("Optional: YouTube subscriptions" -> "Optional:
   subscriptions and downloads (yt-dlp)"), and the `package.json` `description`. AGENTS.md: edit only inside the
   `project` region (harness regions regenerate).

### W3 - Pocket: the iPod out

1. `public/js/music-skins.js`:
   - Labels per R7-R9. Drop `year` from the visible strings: the `label`, `GEN_YEAR` in the group label,
     `genName`'s "G" and `GEN_SPAN`, `colorwayLabel`'s year tie-break, and `skin-surface.js`
     `skinRowLabel` ("5G White · 2005").
   - Group labels become "Slim 4", rows become the colour.
   - `year` may stay as data if a test needs it. Nothing renders it.
   - The `label` field itself becomes the neutral full name ("Slim 4 Red"). `skin-surface.js` search
     (`data-label`) then matches "slim", not "nano". That is intended. Disclose it.
2. Comments: every "iPod" in `public/js/*.js`, `public/css/style.css` (about 830 lowercase hits are class names
   and stay; the prose "iPod" ones go), the `public/*.html` comments, `tools/`, `scripts/`, and `docs/CONTRIBUTING.md`.
   "the iPod" -> "the click-wheel player" or "the Click skin", whichever reads naturally.
3. The Transparent art (R10): original art, Dean picks from 2-3 candidates before the gate. Delete
   `public/assets/skins/transparent-*.webp`. Rewrite `public/assets/skins/README.md` to say the art is original
   (MIT), or delete it if nothing needs it. Update the CSS comments at style.css around L10831-L10912. Measure
   before and after (Dean's norm): one screenshot of each of the 3 Transparent skins on base and on the branch,
   sent with the candidates.
4. The disclaimer, visible: add a `setup-note` to Settings > Mobile player (the Pocket group): "Pocket is inspired
   by classic click-wheel players. FileTube is not affiliated with Apple or Google." Put the same line in the
   README footer and in FEATURES.md.

### W4 - README (shorter), FEATURES.md (new), yt-dlp opt-in

1. `README.md` (221 lines today) is fully rebranded and shorter. Keep the banner and badges. Use a neutral tagline
   such as "Your media library, on every screen in the house." Write one paragraph on what FileTube is (a
   self-hosted media server for your own video, music, podcasts and books, with switchable retro looks). Keep the
   screenshots, trimmed to a few. Add the Quick Start (Docker), then links onward to FEATURES.md,
   docs/CONFIGURATION.md and ROADMAP.md, and the license plus the non-affiliation line. Drop "Broadcast yourself",
   "classic-YouTube interface" and the per-mode and add-on listings, which move to FEATURES.md. Check every
   `#anchor` link still resolves, inside the README and from other docs that link into it (`.env.example` points
   at a README section, so repoint it to FEATURES.md).
2. `FEATURES.md` (new, root): one section per component and optional feature. Each section says what it is,
   whether it is on by default, and how to turn it on. Cover at least: eras and themes, Modern grid, the home feed,
   Music and Pocket (skins, Speakers, Radio), Podcasts, Books, Shows/TV, TV mode and the Roku channel, the iOS app
   (the bridge, offline), the browser extension, and **yt-dlp subscriptions and downloads: clearly opt-in**
   (`FILETUBE_YTDLP_ENABLED=true`, off by default, no routes and no UI when unset; write it neutrally, with no
   YouTube marketing). Also cover Web Push, multi-user and access control, backup and restore, and the
   transcript/TTS features if present. Take the facts from the current README and docs/CONFIGURATION.md, not from
   memory.
3. yt-dlp off by default (R12): confirm, and cite the test in this plan, that an unset or false flag means no
   `/api/ytdlp/*` or `/api/subscriptions/*` routes (find the existing integration test, e.g.
   `test/integration/ytdlp-ui-routes.test.js`; add one if none asserts exactly this) and no downloader UI (the
   health 404 makes moduleEnabled false; W1's test covers it).

### W5 - Privacy page, demo-server notes, ios-host.md

1. `PRIVACY-IOS.md` (root, short, plain language). It says:
   - The FileTube iOS app collects no data.
   - It talks only to the FileTube server address the user enters.
   - The pairing/device token is kept in the device Keychain.
   - Nothing is sent to the developer: no analytics, no tracking, no third-party SDKs.
   - What the user's own server stores is up to whoever runs it.
   - Contact: GitHub issues on dtammam/filetube.
   - An effective date.

   **iOS Root confirmed 2026-10-14 against filetube-ios v0.12.0 (8fed68e):**
   - There are no SPM, Pods or Carthage dependencies and no Package.resolved, so no analytics and no third-party SDKs.
   - The pairing token is stored in the Keychain: DeviceToken.swift, and Shared/SharedKeychain.swift, which uses a
     shared access group so the extensions can read it.
   - HostPolicy keeps the web view on the server's origin. Any other link opens in Safari.
   - Native requests (pairing, offline downloads, share/action sends) go only to the configured server, over
     ephemeral URLSessions. The share sends refuse redirects.
   - **There are no push notifications at all.** Say "The app sends no notifications". Do not write "from your own
     server".

   Add a "What the app keeps on your device" list:
   - the server address
   - the token (in the Keychain)
   - media saved for offline use, and its catalogue
   - playback progress, which syncs to your own server
   - the quick actions and Siri App Shortcuts, which run on the device

   Third-party origins (the iOS Root asked this repo to verify; checked at 2fea29a1): the web UI loads no
   third-party fonts, scripts or images. Everything is self-hosted. The only external URLs are links the user taps
   (GitHub release notes and the repo), and HostPolicy opens those in Safari. Album covers from a source site are
   fetched by the SERVER (lib/ytdlp/cover.js), never by the app. Re-check with
   `grep -rhoE "https?://[a-zA-Z0-9.-]+" public/*.html public/css public/js` before writing the claim.
   **Check each remaining claim against the iOS facts in `docs/references/ios-host.md`, `native-bridge.md` and
   `ios-offline.md`. If a claim cannot be verified from this repo, list it in the report for the iOS Root to
   confirm. Do not soften it into vagueness.**
2. A new demo-server doc, docs/references/app-review-demo-server.md (create it):
   - public HTTPS (a reverse proxy and certificate)
   - `FILETUBE_YTDLP_ENABLED` unset
   - a non-expiring demo account (check how FileTube sessions and accounts expire, and how to create a plain
     non-admin account)
   - only public-domain or Creative Commons media, with sources named: Blender open movies (CC BY), Internet
     Archive public domain films, Free Music Archive or ccMixter CC music so Pocket and background audio can be
     tested, LibriVox audio, Project Gutenberg books
   - the image pinned to `deantammam/filetube:1.391.0` (never `latest`) with auto-update off for the length of the
     review
   - what to put in App Store Connect's review notes
3. `docs/references/ios-host.md` L51-54: replace "capability flags that hide the YouTube downloader" with the
   `mediaFetch` capability gate. Add:
   > The v0.12.0 share actions POST any shared URL to /api/ytdlp/download; the App Store build excludes them.

   Also reword "(as in YouTube's app: custom UI, native engine underneath)" at L44 per R5.

## Acceptance

- [ ] A1: no host -> every downloader entry point behaves exactly as at 2fea29a1. Host + `mediaFetch` -> same.
  Host without it -> none of the enumerated entry points renders, there is no health fetch, and `/subscriptions`
  shows the not-available state. The offline Download control is unaffected. Each is proven by a test that goes red
  under mutation.
- [ ] A2: `mediaFetch` is in host-adapter, the schema and native-bridge.md. The contract test is green.
- [ ] A3: `brand-neutral.test.js` is green. Both regexes are proven to bind by mutation. `docs/brand-references.json`
  holds only R5-functional lines, each with a reason.
- [ ] A4: Pocket shows no iPod, no "G", no years. Lines read Classic/Mini/Slim/Clip/Touch/Custom. Labels within a
  group are unique (test). Saved skin choices still load, because the ids are unchanged (test: every id that existed
  at 2fea29a1 still resolves to itself).
- [ ] A5: no CC BY-SA photo assets remain. Dean has approved the Transparent art. The disclaimer is visible in
  Settings > Mobile player.
- [ ] A6: README is shorter and brand-free. FEATURES.md covers every component with on-by-default and how-to-enable.
  yt-dlp reads as opt-in. No broken anchors.
- [ ] A7: PRIVACY-IOS.md exists. Every claim is verified or listed as unverified. The demo-server doc exists.
  ios-host.md is updated.
- [ ] A8: no API route renamed or removed (`git diff 2fea29a1 -- lib server.js | grep -E "app\.(get|post|put|patch|delete)\("`
  shows comment-only changes). No persisted key or value changed.
- [ ] A9: `npm run lint`, `npm run lint:ui`, the overlay containment census and the full Node 22.23.1 suite are
  green. CI `ci (24)` is green.

## Gate

Seats per `.harness/scrutiny.toml`: `lib/**` is touched (comments), so **adversary + qa** (core-logic, full). Not a
data-loss change. Security-brief is the standing section (the gate is presentation only, and the API stays as it
is; say so). Brief the seats with LESSONS sections 3, 6 and 11 (inert sibling, presence-not-binding, lying
comment). Attack surfaces:
1. A downloader entry point W1 missed.
2. A guard that does not bind.
3. A reworded comment that now lies about the code.
4. A skin label collision or a saved skin that no longer resolves.
5. A README anchor that is now broken.
6. A privacy claim the repo cannot support.

## Release

Follow `docs/RELEASING.md` (v1.391.0): a ROADMAP Shipped entry and a `docs/releases.json` entry in pure user
language, for example "Clearer names in Settings and Pocket, a shorter README with a new features guide, and a
privacy page for the iPhone app". Then the protected-main PR flow, and the tag's Publish Docker Image run green.
Add a LESSONS.md line only if a wave taught one.
Add DEVICE-CHECKS lines:
- (a) the store-build gate, on an iOS build without `mediaFetch` (iOS Root / Dean)
- (b) Pocket skin names and the Transparent art on the phone
- (c) Settings copy

## Report (builder -> Dean, and SendMessage to "FileTube iOS Root Session")

1. Release version and the merge commit sha on main (the iOS side re-pins `Contract/` to it).
2. Final capability name: `mediaFetch`.
3. Privacy URL: https://github.com/dtammam/filetube/blob/main/PRIVACY-IOS.md
4. Everything left out or changed from the handoff, and why (start from R11, R12 and R14 above), plus any
   unverified privacy claims.

## Disclosed up front

- The App Store build may show a reserved Download slot collapse once on the first launch after the upgrade (W1.5).
- Skin search matches the new names only ("slim", not "nano").
- Historical docs keep their YouTube and iPod wording (R13).

## Evidence (builder fills)

- W1 entry-point table (entry point -> gate -> test). Every row's test is in `test/unit/media-fetch-gate.test.js` (MFG):
  | Entry point | How it is gated | Test |
  |---|---|---|
  | Every `/api/subscriptions/health` consumer (nav inject, header Download, status chip, Re-pull probe in common.js; the card-menu caps probe in main.js; the Reheat probe and Subscribe probe in watch.js: 8 sites) | one helper `probeSubscriptionsHealth()` answers a synthetic 404 with no request when `mediaFetchAllowed()` is false | MFG "probeSubscriptionsHealth()", "A1 injectors" |
  | Capability cache read (`sanitizeCapabilityCache`), cache write (`writeCapabilityCache`), remembered flag `ft-ytdlp-module` (`rememberModuleEnabled`) | each coerces `moduleEnabled` with `&& mediaFetchAllowed()`; the pre-paint inline reserve blocks are untouched (W1.5) | MFG "the capability cache and the remembered chrome flag" |
  | Subscriptions sidebar link, bottom-nav Subs tab, account-menu Subscriptions row | downstream of the routed nav injector (the optimistic cache inject also reads the coerced cache) | MFG "A1 injectors", "the cached module on answer cannot inject" |
  | Header Download button + dialog, bottom-nav Download tab | downstream of the routed `injectOneOffDownloadButtonIfEnabled` health probe (the modal is only ever built in that `.then`) | MFG "A1 injectors" |
  | Status chip (`dl-status-chip`) and its `/api/subscriptions/status` poll | downstream of the routed `injectDownloadStatusChip` probe | MFG "A1 injectors" (no `/api/subscriptions` request) |
  | Notification bell (`/api/notifications/badge`) and its pre-paint placeholder | NOT behind the health probe: `injectNotificationBellIfEnabled` returns early (placeholder removed, flag `'0'`) when shut | MFG "A1 injectors", "the pre-paint bell placeholder" |
  | Downloads folder entry (sidebar / bottom-nav, the downloader's output root) | NOT behind the health probe: `injectDownloadsNavLinkIfEnabled` reads no synthetic roots when shut | MFG "the Downloads folder entry" |
  | Watch page Subscribe, bell, Pin, Re-pull, Reheat (More menu) | downstream of the routed probes + coerced cache (`applySubscribeAndPinState`, `reheatAvailable`) | MFG "watch page, host without mediaFetch" x2 |
  | Watch page Share the original link (source-site link) | NOT behind the probe: `shareLinkOf` returns `''` when shut, so no Share button | MFG "watch page, host without mediaFetch" |
  | Sticker / desktop music-and-podcast actions menu: Reheat tile and the source-link Share | NOT behind the probe: `extrasMediaFetchOk()` gates the tile and `extrasShareLink`; the file Share stays | MFG "the music / podcast actions menu" |
  | Folder-view / card-menu Reheat (main.js) | downstream of the routed caps probe (`reheatEnabled`) + coerced cache | MFG "A1 injectors" (probe silent) + watch More-menu row |
  | Playlist picker pinned channels (`/api/subscriptions/pins`, two call sites) | `fetchAllPins` and `openPlaylistsSheet` skip the channel-pins request when shut (books and podcast pins unaffected) | MFG "the pinned channels and the playlists sheet" |
  | Direct navigation to `/subscriptions` (first load and in-app swap) | `viewBlockedByMediaFetch` renders "Not available in this app" in both `bootRouter` and `swapToView`; the view's `init()` never runs | MFG "a direct visit to /subscriptions" |
  | Settings: Downloads (engine), Notifications page (the bell copy + push), Imported videos (relocate note) | `data-media-fetch` markers removed by `applyMediaFetchGate` before the menu is built; `loadEngineSection` finds no box so asks nothing | MFG "Settings: a shut gate removes", "loadEngineSection makes no request" |
  | Offline `downloads` control (public/js/offline.js, account-menu Offline row) | NOT touched (the `downloads` capability) | MFG "the native offline downloads control still works" |
  Not downloader entry points, left as they are: PWA share target (none exists: `grep -rn share_target public server.js lib` is empty), search paste-a-URL (none: the only paste-to-download path is the header Download dialog), Settings extension pairing (none in the web UI), Transcript sharing (reads local subtitles, not the downloader), Assign channel (a library tool on `/api/videos`, not the module), the extension and the Roku channel (desktop / TV clients, R14).
- Mutation proofs (W1 gate, both brand regexes):
- Suite counts (Node 22.23.1), CI run ids:
- Transparent art: candidates sent, Dean's pick:
- Gate verdict lines:
- Merge sha on main / tag run:
