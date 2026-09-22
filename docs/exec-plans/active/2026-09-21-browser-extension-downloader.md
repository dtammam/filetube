---
plan: browser-extension-downloader
harness: v2 · spec
branch: feat/downloader-extension
anchor: spec
status: Building
next: Dean confirmed it works end-to-end (YouTube tested). D9 DONE - the FileTube cube logo (from public/icons/icon-512.png, resized to 16/32/48/128) added under extension/icons/ + wired into manifest icons + action.default_icon. This changed the code AFTER the r1 gate, so a DELTA re-confirm at the new sha is needed before merge (delta = static PNG assets + a manifest icons block; the logic was already 3/3 APPROVED @7636c5ed). Then merge/release on Dean's go. Also added (Dean request): the popup recognizes ~12 well-known sites (YouTube/Vimeo/SoundCloud/Twitch/TikTok/etc.) and shows a green "supported site" line + an always-visible supported-sites footer hint - a POSITIVE hint only, never a gate (unrecognized hosts stay enabled and let yt-dlp decide). `recognizeSite`/`KNOWN_SITES` are popup-local; consider moving them into the pure `ftClient.js` for node:test coverage during the merge delta. Still-deferred nits: D8 CI wiring, M7 test, options.js prior-origin permission cleanup, optional fetch redirect:'error'.
gate: APPROVED r1 @7636c5ed (STALE - icons added after; delta re-confirm pending at the new sha before merge)
design: Approved 2026-09-21 @7636c5ed
---

# Chromium (MV3) browser extension: download the current tab into FileTube

A Manifest V3 Chromium extension that sees the active tab's URL, decides whether
yt-dlp can handle it, and lets the user download the page as **Audio** or
**Video** into their own FileTube instance. This document is the RESEARCH +
DESIGN for the feature; a minimal runnable scaffold lands under `extension/`
alongside it. It builds toward a reviewable branch - nothing merges without the
gate.

## Acceptance (spec anchor - proposed, Dean confirms)

1. From any tab, the extension popup shows the current URL and offers **Audio** /
   **Video** download buttons; a clearly-incompatible page is disabled with a reason.
2. A download press reaches the configured FileTube instance authenticated as
   Dean and enqueues a one-off yt-dlp download in the correct format; the popup
   reports accepted / rejected verbatim (the server's own message, never invented).
3. The extension holds NO long-lived secret in a way a rogue page can read, makes
   NO cross-origin request a page could forge, and adds NO new unauthenticated
   server surface. Default install requests minimal permissions.

## Research

All citations are to this repo at the branch base. The server surface the
extension depends on ALREADY EXISTS - this feature is almost entirely client
(extension) side, with at most one small optional server addition (see Open
Decisions).

### 1. How FileTube triggers a one-off download today

- **Route:** `POST /api/ytdlp/download` - `lib/ytdlp/index.js:5982` (registered
  inside `registerRoutes`, `lib/ytdlp/index.js:5432`). It is the one-off /
  single-download lane; subscriptions are a separate route family
  (`POST /api/subscriptions`, `lib/ytdlp/index.js:5521`). The whole subsystem is
  opt-in via `FILETUBE_YTDLP_ENABLED`.
- **Body shape** (`lib/ytdlp/index.js:5992`-`6027`): JSON `{ url, format,
  quality, filetype, folder }`, OR a bare `text/plain` body which the route
  treats as `{ url: <body> }` (an iOS-Shortcut affordance; route-scoped
  `express.text({limit:'256kb'})` at `:5984`). Only `url` is required.
  - `url` - validated by `url.classifyOneOffUrl(body.url)` (`:6002`). YouTube
    single-video URLs take the "youtube" lane; any other named-extractor host
    takes the "universal" lane; a YouTube channel/playlist/handle is a hard 400.
  - `format` - `'audio'` or `'video'`; anything else 400s. Constants:
    `VALID_FORMATS = new Set(['audio','video'])`, `DEFAULT_FORMAT = 'video'`
    (`lib/ytdlp/store.js:34`-`35`; body handling at `lib/ytdlp/index.js:6008`).
    **This is exactly the Audio vs Video toggle the extension needs - one field.**
  - `quality` - soft preference, `args.normalizeQuality(body.quality)`
    neutralizes unknown values to `'best'` (`lib/ytdlp/index.js:6016`); never a
    hard boundary.
  - `filetype` - optional, format-aware, validated by `store.validateFiletype`
    (`:6023`).
  - `folder` - optional advanced override, traversal-confined by
    `resolveChannelDir` (`:6052`); absent = server routes into the video's
    channel folder or a fallback.
- **Responses:** `202 { accepted:true, jobId }` on accept (`:6104`); `400
  { error }` for a bad url/format/filetype/folder; `503` if too many downloads
  are already queued (`:6068`). The actual download runs in the background after
  the 202 (`launchOneShotJob`, `:6138`); progress is observable at
  `GET /api/subscriptions/status` (per the retry-body comment at `:6081`).
- **RBAC on the route** (`lib/ytdlp/index.js:5990`): an `api-token` caller is
  exempt; a SESSION caller must be admin OR have `canManageSubscriptions`. Then a
  read-only-media safe-mode check (`:5991`).

### 2. Determining "compatible"

- There is **no existing server endpoint that answers "can yt-dlp handle this
  URL?"** without actually downloading. The closest pure check is
  `url.classifyOneOffUrl` (`lib/ytdlp/url.js:530`), composed of
  `classifySingleVideo` (YouTube) + `isPlausibleMediaUrl`
  (`lib/ytdlp/url.js:457`). It is SYNCHRONOUS and I/O-free.
- Crucially, `isPlausibleMediaUrl` is **permissive by design**: it accepts almost
  any well-formed public http(s) URL (rejecting only private/local hosts,
  embedded creds, bad chars, non-http). The real extractor decision is delegated
  to yt-dlp at spawn time (`--use-extractors default,-generic`, per the comment
  at `lib/ytdlp/url.js:331`). So "plausible" is NOT "yt-dlp will succeed" - true
  compatibility is only knowable by running yt-dlp.
- yt-dlp DOES expose its extractor list (`yt-dlp --list-extractors` /
  `--dump-json --simulate`), but that is a server-side spawn, not something the
  extension can run.
- **Cheapest reliable check the extension can do, recommended (tiered):**
  1. **Client heuristic for instant UX (no network):** enable the buttons for any
     public http(s) URL (mirroring `isPlausibleMediaUrl`'s permissiveness);
     disable them only for obviously-out-of-scope schemes/hosts
     (`chrome://`, `file://`, `about:`, `localhost`/private IPs, the FileTube
     instance origin itself). Ship a small, clearly-labeled "known-good hosts"
     hint list (YouTube, Vimeo, etc.) purely to reassure - never as a hard gate.
  2. **Authoritative verdict = the server's own response.** The download POST is
     itself the compatibility check: `400` (bad shape) is surfaced verbatim, and
     the eventual job failure (visible via the status route) is the true "yt-dlp
     couldn't handle it" signal.
  - A **static host allowlist is NOT recommended as the gate** - it silently
    rots against yt-dlp's ~1800 extractors and would block sites that work.
  - OPTIONAL server addition (Open Decision D2): a tiny `POST /api/ytdlp/probe`
    that runs `classifyOneOffUrl` only (pure, no spawn) and returns `{ok, lane}`
    for instant pre-flight feedback without queueing. This mirrors exactly what
    the download route already enforces, adds no spawn cost, and needs the same
    auth as the download route. It does NOT confirm yt-dlp will succeed (only a
    spawn does), so it is a nicety, not a requirement.

### 3. Auth - how the extension authenticates a POST

- **Session cookie mechanism:** login is `POST /api/auth/login`
  (`lib/auth/routes.js:100`) which sets an HMAC-signed session cookie via
  `issueSessionCookie` (`:120`). The gate (`lib/auth/gate.js:233`) covers every
  route; cookie is HttpOnly, **SameSite=Lax**, per-instance name
  (`ft_session_`+hash), Secure only when HTTPS is trusted (per
  `docs/ARCHITECTURE.md` Auth section).
- **Token path (the key finding):** when `FILETUBE_API_TOKEN` is set
  (`server.js:315`, threaded as `apiToken` at `server.js:3074`), the auth gate
  accepts an `X-FileTube-Token` header **for exactly `POST /api/ytdlp/download`**
  as a session-less alternative (`lib/auth/gate.js:244`-`257`). It is compared
  with a constant-time `authCrypto.tokensEqual`, tags the request
  `req.auditActor='api-token'`, and that actor is RBAC-exempt on the download
  route (`lib/ytdlp/index.js:5990`). Documented in `docs/CONFIGURATION.md:25` as
  the iOS-Shortcut token.
- **There is NO CORS anywhere** in the server (grep for
  `Access-Control-Allow-Origin` / a `cors` middleware across `lib/` and
  `server.js` = zero hits). This is decisive for the extension design:
  - A **session-cookie** approach is the wrong fit. The extension's fetch runs
    from the `chrome-extension://` origin - a **cross-site** request to the
    FileTube host. A **SameSite=Lax** cookie is NOT sent on a cross-site POST, so
    even a logged-in browser wouldn't attach the session cookie to the
    extension's POST. Working around it (reading the cookie via a `cookies`
    permission and re-attaching) is fragile, needs broad permissions, and fights
    the HttpOnly/SameSite design.
  - The **`X-FileTube-Token` bearer header** is the natural, already-supported
    fit: it needs no cookie, no CORS (an MV3 service worker with host permission
    for the instance origin can POST cross-origin and read the response), and the
    server already scopes it to precisely this one route. This is the RECOMMENDED
    auth path.
- **Trust model (from the repo):** FileTube is self-hosted, single-operator,
  LAN/VPN-posture (the download route's own comment at `lib/ytdlp/index.js:6060`
  calls out "the app's existing LAN posture"; the token exists for exactly the
  remote-caller case). The extension inherits that model: it is Dean's own tool
  pointed at Dean's own instance.

## Design

### Architecture (MV3)

- **`background.js`** - the service worker; the ONLY component that holds the API
  token and makes network calls to the instance. Receives
  `{type:'download', url, format}` messages from the popup, POSTs
  `/api/ytdlp/download` with the `X-FileTube-Token` header, relays the
  server's response verbatim back to the popup.
- **`popup.html` / `popup.js`** - reads the active tab URL (via `activeTab` on
  user gesture), runs the client compatibility heuristic to enable/disable the
  Audio/Video buttons, and on press sends a message to the background worker.
  Shows the accepted `jobId` or the verbatim error.
- **`options.html` / `options.js`** - the settings page: the FileTube instance
  URL and the credential (token, per recommendation). On save it requests the
  runtime host permission for the instance origin and can verify reachability.

### Auth approach (recommended) + tradeoffs

- **Recommended: `X-FileTube-Token` bearer** stored in `chrome.storage.local`,
  read only by the service worker, sent only to the configured instance origin.
  - PRO: already supported and route-scoped server-side; no CORS needed; no
    cookie/SameSite fight; least server change (none).
  - CON: it is a bearer secret at rest in extension storage (mitigations:
    service-worker-only access, never expose to content scripts / the popup DOM
    beyond a masked field, scope host permission to the one origin, document that
    revocation = rotate `FILETUBE_API_TOKEN`). The token is admin-equivalent FOR
    THIS ONE ROUTE only (it cannot read the library, manage users, etc.).
  - Requires the operator to set `FILETUBE_API_TOKEN` (already a documented env).
- **Alternative considered: username/password -> session cookie.** Rejected for
  v1: SameSite=Lax + no CORS make the extension's cross-site POST cookie-less; a
  `cookies`-permission workaround is broad and brittle. If Dean wants
  password-based auth instead of a static token, the clean answer is a NEW
  server change (a token-mint endpoint, or a CORS/allowance for the extension
  origin) - that is an Open Decision, not something to assume.

### Compatibility-check approach

Client heuristic for instant enable/disable (permissive, mirrors
`isPlausibleMediaUrl`; hard-disables only chrome://, file://, about://, the
instance origin, and private/local hosts) + the server's own 400/job-failure as
the authoritative verdict. Optionally a pure `/api/ytdlp/probe` endpoint (D2)
for pre-flight confirmation without a spawn.

### The download-trigger API contract it depends on (EXISTS today)

`POST {instanceUrl}/api/ytdlp/download`
Headers: `Content-Type: application/json`, `X-FileTube-Token: <token>`
Body: `{ "url": "<tab url>", "format": "audio" | "video" }`
(`quality`/`filetype`/`folder` optional; the extension omits them in v1 = server
defaults: `quality` -> `best`, `format` default `video`, folder auto-routed.)
Success: `202 { accepted:true, jobId }`. Errors surfaced verbatim: `400`
(bad url/format), `401` (bad/missing token), `503` (queue full). Requires the
instance booted with `FILETUBE_YTDLP_ENABLED` and `FILETUBE_API_TOKEN` set.

### Minimal-permissions manifest (each permission justified)

- `activeTab` - read the active tab's URL on popup open (user gesture); avoids a
  broad `tabs` permission or blanket host access just to read one URL.
- `storage` - persist the instance URL + token in `chrome.storage.local`.
- `optional_host_permissions: ["*://*/*"]` - NOT granted at install; the options
  page requests permission for the ONE configured instance origin at save time,
  so the network reach is scoped to Dean's instance and nothing else.
- (No `tabs`, no `cookies`, no `<all_urls>` host_permissions, no content
  scripts - none are needed for the token-bearer design.)

## Decisions (Dean ruled 2026-09-21)

- **D1 - Auth method: `X-FileTube-Token` bearer. CONFIRMED.** Operator sets
  `FILETUBE_API_TOKEN`; the extension stores the token in `chrome.storage.local`,
  read/used only by the background service worker.
- **D2 - Reuse `POST /api/ytdlp/download`. CONFIRMED.** No `/api/ytdlp/probe`;
  pure client-only merge, zero server change.
- **D3 - Extension source: top-level `extension/`. CONFIRMED.**
- **D4 - v1 sends `{url, format}`. CONFIRMED.** Server defaults quality=`best`
  and auto-routes the folder.
- **D5 - Permissive client-side compatibility heuristic. CONFIRMED.** Server's
  400 / eventual job-failure is the authoritative verdict.
- **D6 - Token at rest in `chrome.storage.local`** (service-worker-read only),
  masked in the field - standard MV3 posture; flagged for the security seat.
- **D7 - Dev-load (unpacked) for v1. CONFIRMED.**

### New open decisions (this build pass)

- **D8 - Where extension tests live in CI.** `extension/ftClient.test.js` runs
  standalone (`node --test extension/ftClient.test.js`, 6/6 on Node 22+24) but is
  NOT wired into the repo's `npm test` (that glob is `test/*/*.test.js`,
  server-side). Options: (a) a new `test:extension` npm script + a CI step; (b)
  leave it standalone/dev-only for v1. It relies on Node's ESM-syntax detection
  (the repo is CommonJS; `ftClient.js` uses ESM `export`); if that implicitness is
  unwanted, rename `ftClient.js` -> `ftClient.mjs` for explicit ESM (browser
  import specifier updates to match). Recommendation: (a) + keep `.js` (detection
  works on both supported Node versions).
- **D9 - Extension icons.** The manifest ships no `icons`/`action.default_icon`;
  Chrome renders a default placeholder. Add a 16/32/48/128 icon set before any
  packed build. Cosmetic for dev-load; deferred.

## Build state (pass 2 - the confirmed decisions wired end-to-end, client-only)

- `extension/manifest.json` - MV3; `activeTab` + `storage`; broad
  `optional_host_permissions` granted only for the one configured origin at
  save/test time; module service worker; popup + options_ui.
- `extension/ftClient.js` - **PURE module** (no `chrome.*`, no DOM, no I/O): the
  request builders (`buildDownloadRequest`, `buildTestRequest`,
  `originPattern`, `normalizeInstanceUrl`) and response interpreters
  (`interpretDownloadResponse`, `interpretTestResponse`). This is the auth/POST
  logic, isolated so it is testable without a browser.
- `extension/background.js` - thin service worker over `ftClient.js`; the ONLY
  holder of the token. Handles `download` (the `X-FileTube-Token` POST, verbatim
  server-error relay), `test` (the side-effect-free connection probe), and
  `status` (`{configured}` - no secret leaves the worker).
- `extension/popup.{html,js}` - reads active tab URL; on open asks the worker
  `status` and, when not configured, disables Audio/Video with a clear "Open
  options" message; otherwise runs the permissive heuristic; on press surfaces
  the returned `jobId` on success and the verbatim server error on failure.
- `extension/options.{html,js}` - instance URL + token fields; **Save** and
  **Test connection** both validate + request the scoped host permission, then
  Save persists and Test messages the worker to run the probe.
- `extension/ftClient.test.js` - proof-of-approach unit tests (6/6 on Node
  22.23.1 and 24.20.0), run via `node --test extension/ftClient.test.js`.

### "Test connection" - which endpoint and why

The `X-FileTube-Token` header is accepted by the auth gate for EXACTLY one route,
`POST /api/ytdlp/download` (`lib/auth/gate.js:244`); every other authed endpoint
needs the session cookie the extension does not have. So there is no generic
authed GET to probe. Test connection therefore POSTs that one route with an
**empty `url`**: the handler validates the url synchronously and returns `400`
BEFORE queuing anything (`lib/ytdlp/index.js:6002`-`6004`), so no download is
triggered. Interpretation: `401` = bad/missing token; a non-JSON/`404` reply =
endpoint not found (yt-dlp disabled or wrong URL); `403 {readOnlyMedia}` = token
OK but instance read-only; any other JSON reply (`400`/`202`/`503`) = token got
past the gate and the endpoint is live = success.

## Test-harness proposal (repo has none for client JS yet)

The gate needs to bind the auth/POST logic without a browser. Approach, already
demonstrated by `extension/ftClient.test.js`:

- **Factor the decision logic into a pure module** (`ftClient.js`) that takes
  plain inputs and returns plain `{endpoint, init}` request descriptors and
  `{ok, ...}` verdicts - no `fetch`, no `chrome.*`, no DOM. `background.js` is
  then a thin adapter that only wires storage + `fetch` to it. This is the same
  "isolate the pure core" move the server uses (e.g. `lib/ytdlp/url.js` classify
  functions are pure and unit-tested).
- **`node:test` exercises the pure module directly** - request shape (method,
  `X-FileTube-Token` header, `{url, format}` body, URL normalization), the
  verbatim-error contract, and every branch of the test-connection interpreter.
- **DOM/message wiring** (popup, options) is the thin, hard-to-unit-test layer;
  keep it minimal. If deeper coverage is wanted later, `jsdom` (already a dev
  dep, used across the repo's unit suite) can drive `popup.js`/`options.js` with
  a stubbed `chrome` global and a stubbed `chrome.runtime.sendMessage`.
- **CI wiring is D8** - a `test:extension` script + step, or standalone for v1.
  Note the CommonJS-repo / ESM-module detection point (D8): rename to `.mjs` if
  implicit detection is unwanted.

## Next build step

Resolve D8 (CI wiring) and D9 (icons), optionally add jsdom coverage for the
popup/options wiring, then take the client-only branch to the gate (adversary +
qa; no server change = no full server suite, but the security-brief standing
section still applies - token-at-rest, host-permission scoping, verbatim-error
relay, no new unauthenticated surface). Manual verification steps are in the
report accompanying this pass.

## Gate

Full gate (forced by scrutiny.toml's network/`*client*` rule + the token/credential surface); all required seats APPROVED at the reviewed sha.

```
Gate: APPROVED r1 @7636c5ed — security-brief
Gate: APPROVED r1 @7636c5ed — qa
Gate: APPROVED r1 @7636c5ed — adversary
```

### r2 delta re-confirmation @ d6c45c49

Delta since r1 (all landed after the r1 sha): `e5a3d4be` icons+manifest, `688daa21` popup "known-supported sites" positive hint, `7afde5fa` the sticky notif/queue panel-header z-index fix + its guard, `d6c45c49` README + extension/README docs. The approved auth core is byte-identical (`git diff 7636c5ed..d6c45c49 -- lib/ server.js extension/background.js extension/ftClient.js` is EMPTY). All required seats APPROVED at the reviewed sha.

```
Gate: APPROVED r2 @d6c45c49 — security-brief
Gate: APPROVED r2 @d6c45c49 — qa
Gate: APPROVED r2 @d6c45c49 — adversary
```

- **security-brief (r2):** no CRITICAL/HIGH/MEDIUM/LOW; none of the three r1 concerns regressed. popup hint has no network / no token access / no new permissions, DOM writes via `textContent`, `recognizeSite` suffix-match has no lookalike bypass and is non-gating anyway; manifest permissions unchanged (activeTab+storage, optional origin-scoped host perm); no secret in docs/icons; CSS is presentation-only. (Seat had no Bash - CSS confirmed by file read + no active constructs; adversary/qa covered it by diff/mutation.) r1 INFO advisories carry forward unchanged.
- **qa (r2):** panel-chrome-mirror 10/10 (incl. both new z-index guards AND the declaration-identical mirror lock) and ftClient 6/6, each on Node 24.14.0 AND 22.23.1; `npm run lint` 0 errors / 7 pre-existing warnings (none in touched files). recognizeSite verified hint-only with no false positives (notyoutube.com/youtube.com.evil.com→false; m.youtube.com→true); buttons stay enabled for unrecognized hosts; manifest valid MV3 with all four PNG icons; doc claims + file map accurate. Tree byte-identical.
- **adversary (r2):** MUTATION-VERIFIED the z-index guard in a `git archive` sandbox - strip from BOTH headers → the two guards go RED while the mirror lock stays GREEN (proving the direct binding is necessary); strip from one → mirror + that guard RED. Sticky-scan claim confirmed (the 4 sticky rules all carry a z-index). popup hint executed against hostile/unrecognized inputs → `ok:true` unchanged, no host newly blocked. Icons/manifest/docs all verified against the tree. 1 non-blocking SUGGESTION (carried from r1's coverage theme): recognizeSite/KNOWN_SITES remain popup-local, outside the node:test net - optional move into ftClient.js for a committed regression test; carries no security weight.

- **security-brief (r1):** no CRITICAL/HIGH/MEDIUM/LOW. Token never sent to any origin but the configured instance (endpoint derived from stored instanceUrl; tab URL only in the body); no content scripts / externally_connectable, so no page/content-script can read the token or drive the worker; manifest permissions minimal (activeTab + storage; origin-scoped optional host permission, gesture-gated); no secret logged; verbatim-error relay can't crash on non-JSON. 3 INFO advisories: fetch `redirect:'error'` hardening, http-instance plaintext caveat, all advisory.
- **qa:** contract PROVEN against source (lib/auth/gate.js:244 token path for exactly POST /api/ytdlp/download; lib/ytdlp/index.js download handler; empty-url test truly 400s before queuing); ftClient tests 6/6 on Node 22.23.1 AND 24.20.0; lint 0 errors; doc claims accurate; extension not in the Docker image. No new attack surface.
- **adversary:** sandbox mutation proved coverage real (drop token header / method / format / normalization / guards all RED); lint override tightly scoped (verified via `eslint --print-config`, does not leak to server.js); token/origin binding holds under hostile scenarios. 1 SUGGESTION (M7: a 202-without-`accepted` mutant survives - benign, worth a one-line test).

### Non-blocking follow-ups (deferred; none warrants a round)
- D8: extension tests are not in the `npm test` glob (`test/*/*.test.js`) - add a `test:extension` script + CI step before any packed/distributed build.
- D9: add 16/32/48/128 icons before a packed build (cosmetic for dev-load).
- M7 (adversary): add a test for a 202 response lacking `{accepted:true}`.
- options.js: `chrome.permissions.remove` the prior origin when instanceUrl changes (permission hygiene, not a leak).
- security INFO: consider `redirect:'error'` on the download fetch; prefer an https instance.
