# Product Manager — Discovery: Settings: Automation & Cache Housekeeping (v1.8.0)

You are the product-manager agent for FileTube. Run **Discovery** for a new,
pre-approved feature and produce a requirements + acceptance-criteria exec plan.
You have no shared context with the EM — everything you need is below or in the
files referenced. Ground every requirement in the ACTUAL code, not just this text.

## LOCKED DECISIONS — bake these into requirements; do NOT re-open them
Dean reviewed the EM's two findings (below) and ruled. These are settled product
decisions; write the requirements AND acceptance criteria around them. Only escalate
back to the EM if a genuinely NEW product decision surfaces during design — not these:

- **D1 — Auto-scan default = 30 minutes.** UI options: **Off / 30m / 1h / 6h / 12h /
  24h** (30m default). This REPLACES the hardcoded `setInterval(scanDirectories, 10*60*1000)`
  at `server.js:989` — the interval must be driven by the persisted preference, and an
  **overlap guard** must be added (never start a scan while one is already in progress;
  `scanState.scanning` at 421-422 is the hook). Persist **server-side in db.json** (it's
  server automation). This is an intentional behavior change (10min→30m default); state it
  explicitly in the AC.
- **D2 — Prune missing files (item #6) = ON by default, WITH a mount-loss guard.** The
  guard SHIPS REGARDLESS of the toggle and is the critical part: if a configured root
  folder is entirely missing/unmounted (`server.js:442` currently just skips it), treat
  it as a MOUNT FAILURE and do NOT prune any entries under that root — never mistake an
  unmounted volume for "all these files were deleted." Only prune an individual entry
  when its root folder IS present/mounted but that specific file is gone. Expose on/off
  as a preference, **default ON**. This is the second intentional behavior change (an
  unconditional+unsafe prune becomes a safe, controllable one).
- **D3 — Transcode age-retention default = 30 days**, keyed off **last-watch**.
  Technical risk to design around (flag for the PE, don't resolve in discovery): atime is
  unreliable on `noatime`/`relatime` mounts (reads don't bump it), so a filesystem-atime
  "last watched" may never reset and could delete an actively-watched file. **Prefer a
  last-served timestamp WE control** (recorded in db.json when we serve/transcode) as the
  source of truth, with atime as fallback — PE's call. Age sweep LAYERS ON TOP of the
  existing size-cap LRU (`selectEvictions`/`parseCacheCap`/5GB `FILETUBE_CACHE_CAP`),
  which stays as the hard backstop.
- **D4 — Companions as scoped:** cache-size display + "Clear cache now"; size-cap
  surfaced in the UI (env var stays as default/override); last-scanned timestamp +
  "Scan now".
- **Everything additive / zero-regression EXCEPT the two intentional changes (D1, D2).**
  Ship target **v1.8.0**. Both the quality-assurance agent AND a separate `/code-review`
  pass are required before merge.

## First, read these
- `.state/feature-state.json` — the feature record (`state.description` has the full scope).
- `docs/CONTRIBUTING.md`, `docs/RELIABILITY.md` — mandatory standards; nothing you
  put in out-of-scope may conflict with these.
- `docs/exec-plans/future/metube-yt-dlp-sync.md` — the deferred delete-sync work
  that item #6 overlaps with. Read it: item #6 solves the MeTube staleness problem
  from FileTube's side, so note the relationship and what stays deferred.
- `server.js` — the whole backend. Read the specific seams below.
- `public/setup.html` — the settings page you'll extend.

## The feature (approved scope — six items)
A new **"Automation & Storage"** area in Settings (setup.html), plus the
server-side machinery behind it. Full text is in `state.description`. Summary:

**Core**
1. **Auto-scan interval** — see D1 (Off / 30m / 1h / 6h / 12h / 24h, default 30m;
   replaces the hardcoded interval; overlap-guarded; persisted in db.json).
2. **Transcode cache age-retention** — see D3 (Off / 7 / 14 / 30 / 90, default 30 days;
   keyed off a last-watch timestamp we control, atime fallback; layers on the size cap).

**Companions**
3. **Cache size display + "Clear cache now" button** — show current transcode-cache
   total size; button purges on demand. (Closes the original ~5.6 GB runaway concern.)
4. **Expose the transcode size cap in the UI** — surface the existing env-only
   `FILETUBE_CACHE_CAP` / `TRANSCODE_CACHE_MAX_BYTES` as a settable control; env var
   remains a valid override / default source.
5. **Last-scanned timestamp + "Scan now" button** — "Last scanned: N ago" + manual
   trigger, built on the existing scan-status endpoint and scan path.
6. **"Remove entries for deleted files during scan"** — see D2 (ON by default, with the
   mandatory mount-loss guard that ships regardless of the toggle).

## The TWO EM findings behind D1/D2 (context — verify against `server.js` yourself)

**Finding A (→ D1) — the auto-scan timer already exists.** `server.js:989` already runs
`setInterval(() => { scanDirectories()... }, 10 * 60 * 1000)` — a hardcoded 10-minute
periodic rescan (only under `require.main === module`, lines 978-998). So item #1 makes an
EXISTING interval configurable. `scanDirectories()` (lines 424-433) tracks
`scanState.scanning` but the interval fires regardless — no overlap guard today.

**Finding B (→ D2) — item #6's pruning already happens, unconditionally and dangerously.**
`runScanDirectories()` (lines 436-540) rebuilds `db.metadata` from scratch (line 450) and
drops any id whose file isn't in the freshly-scanned set (lines 494-540, including deleting
the thumbnail, transcode sidecar, and watch progress for dropped ids). AND line 442 does
`if (!fs.existsSync(folder)) { ...continue; }` — so if a configured root folder is
missing/unmounted, none of its files are scanned and **all its entries are permanently
dropped on the next scan.** That is the "nuke the library on a lost mount" catastrophe —
a CURRENT latent bug, on by default today. D2 fixes it (mount-loss guard) and makes the
prune legible/controllable.

## Concrete code seams (cite these; mirror their style)
- Cache cap + eviction: `parseCacheCap` (86-91), `TRANSCODE_CACHE_MAX_BYTES` (92),
  `selectEvictions` (94-117, pure, atime-keyed LRU), `cleanupOrphanTmp` (121-131),
  `recentlyServed`/`RECENT_STREAM_MS`/`markServed` (133-140), `evictTranscodeCache`
  (145-172), startup hygiene (981-983). Note: `evictTranscodeCache` already comments that
  atime is unreliable and uses `recentlyServed` as the real race guard — that same caveat
  is exactly why D3 prefers a tracked last-served timestamp over raw atime.
- Scan: `scanState` (421-422), `scanDirectories` (424-433), `runScanDirectories`
  (436-540), `reconcileTranscode` usage (532), `/api/scan` POST (642-649),
  `/api/scan-status` GET (652-665, already returns `scanning`, `lastScan`,
  `fileCount`, `folderCount`, `transcoding`).
- Config/prefs: `/api/config` GET (595-598) + POST (601-639), `db.folderSettings`
  persistence (35, 45-49, 632), `loadDatabase`/`saveDatabase`. Per D1, the automation/
  cache prefs live server-side in db.json (a top-level `settings` object, folderSettings-
  style) — NOT client localStorage (unlike theme/icon prefs). Specify the shape.
- `module.exports` (1002-1020) — the pure-helper test seam. New pure logic (e.g. an
  interval parser, an age-sweep selector) should be exported and unit-tested like
  `selectEvictions`/`parseCacheCap` in `test/unit/transcode-cache.test.js`.
- UI anchors in `public/setup.html`: the folders box + `#scan-status` span + "Save &
  Scan Library" button (109-113); the "Appearance" `setup-box` (115-124) — the new
  "Automation & Storage" `setup-box` sits alongside it; scan-status polling JS
  (~295-341). Prefs load via `/api/config` (162-173).

## What to produce
Write the exec plan to `docs/exec-plans/active/2026-07-05-settings-automation-cache.md`
with these sections:
- **## Goal** — the user value in 2-3 sentences.
- **## Scope** — the six items as concrete, testable requirements, with D1-D4 baked in.
- **## Out of scope** — the full MeTube/yt-dlp delete-sync (stays deferred), companion-file
  cleanup (Option C in the future plan) unless you argue it in, any DB migration beyond the
  additive `settings` object. Cross-check none of this conflicts with CONTRIBUTING/RELIABILITY.
- **## Constraints** — Node 22, node:test, `npm run lint` 0 errors, additive /
  zero-regression (except the two intentional D1/D2 changes), ships to prod Docker on a
  `v*.*.*` tag, FFmpeg kept out of the automated suite.
- **## Open questions / decisions for design** — D1-D4 are SETTLED; do not list them here.
  Surface only genuinely-open PE-level design choices, e.g.: exact db.json `settings` shape
  and defaulting/back-compat for older db.json; the D3 last-served-timestamp mechanism vs
  atime fallback (where to record it, how "Clear cache now" and startup interact); whether
  the age sweep runs on the scan timer, on its own timer, or on cache write; how "Scan now"/
  overlap-guard surface a "scan already running" response in the UI. Frame these for the PE,
  don't resolve them.
- **## Acceptance criteria** — explicit, verifiable pass/fail per item, INCLUDING: the
  10min→30m default change (D1), the overlap guard, the mount-loss guard as a hard AC with
  a test (D2 — e.g. simulate a missing root and assert its entries survive), the age sweep
  never deleting a recently-served file (D3), env-var-still-honored for the cap (item #4),
  and the two-reviewer QA requirement. Zero-regression checks for the existing scan,
  size-cap eviction, and streaming paths. "Looks good" is not acceptance.

Then update `.state/feature-state.json`: set `artifacts.requirements` and
`artifacts.exec_plan` to the exec plan path, append a discovery-complete history entry.

Do NOT design the implementation or write code — that's the principal engineer's next
stage. D1-D4 are locked; only surface a genuinely NEW product decision if one appears.
