# FileTube Architecture Diagrams

Visual companion to `docs/ARCHITECTURE.md` (the prose reference) - five
diagrams: the module map, the data model, the scan pipeline, the
watch/stream flow, and the client SPA + player lifecycle. Mermaid, rendered
natively by GitHub.

Facts here are MACHINE-DERIVED and checker-bound:
`test/unit/docs-diagrams-census.test.js` verifies every repo path named in
this file exists, every persisted namespace and relational table appears in
the data-model section, and the headline counts match a live derivation -
so a rename or a new namespace turns this document red instead of letting
it lie. When this document and the code disagree, the code wins and this
file is the bug.

## 1. Module map

One process. Every request passes the auth gate; two subsystems own their
route surface via `registerRoutes(app, deps)`; everything else is a library
the monolith calls. Route counts measured at v1.135.0: 135 registrations in
`server.js`, 67 across `lib/podcasts/` + `lib/ytdlp/`.

```mermaid
flowchart TD
    subgraph CLIENT["Browser - public/"]
        SHELLS["Page shells<br/>index/watch/music/podcasts/books/read/history/stats/setup/login .html"]
        ROUTER["public/js/common.js<br/>SPA-lite router: swaps ONLY #view-root<br/>+ shell chrome, account menu, shared helpers"]
        VIEWS["View scripts<br/>main.js watch.js music.js podcasts.js<br/>books.js read.js history.js stats.js setup.js"]
        PLAYER["public/js/player.js<br/>ONE persistent #player-host"]
        SW["public/filetube-worker.js<br/>PUSH-ONLY service worker (never fetch/cache)"]
    end

    subgraph SERVER["Node process - server.js (the monolith host)"]
        GATE["lib/auth/gate.js<br/>ONE app.use(authGate): cookies, rate limit,<br/>per-request user re-check, pre-login allowlist"]
        ROUTES["server.js routes (135)<br/>media/books/music browse + bytes, scan, trash,<br/>move, users, backup, notifications, queue, stats"]
        PODR["lib/podcasts/ routes<br/>registerRoutes(app, deps)"]
        YTDR["lib/ytdlp/ routes<br/>registerRoutes(app, deps)"]
        AUDIT["mutation audit middleware<br/>logs every mutating request + actor"]
    end

    subgraph LIBS["lib/ - feature + pure libraries the monolith calls"]
        AUTHL["lib/auth/<br/>crypto.js store.js visibility.js"]
        VQ["lib/videoQuery.js<br/>browse contract (client-parity-locked)"]
        MEDIA["media libs - PURE planners<br/>lib/storyboard.js lib/previewClip.js<br/>lib/subtitles.js lib/rokuCompat.js lib/trashPaths.js<br/>(+ lib/faststart.js, which spawns ffmpeg ITSELF)"]
        PLACES["places<br/>lib/books/ lib/music/ lib/home/<br/>lib/queue/ lib/stats.js lib/presence/"]
        PUSHL["lib/push/<br/>Web Push delivery (VAPID)"]
        HG["lib/heavyGate.js<br/>ONE FIFO chain for heavy jobs"]
    end

    subgraph STORAGE["DATA_DIR"]
        DB[("filetube.db<br/>SQLite via lib/db/sqlite.js<br/>the ONLY node:sqlite caller")]
        SECRETS["0600 secrets OUTSIDE the db:<br/>session-secret, vapid-keys.json,<br/>podcast-feeds.json (feed URLs = credentials)"]
        CACHES["derived-output caches:<br/>transcoded/ + roku-compat/ (size-capped LRU),<br/>tts-cache/ (manual clear only),<br/>storyboard/preview files ({id}.sb.jpg / {id}.pv.mp4)<br/>inside the thumbnail dir"]
    end

    EXT["child processes<br/>ffmpeg / ffprobe / yt-dlp (argv arrays, never shell)"]
    ROKU["roku/ BrightScript channel<br/>same API, ?compat=roku renditions"]

    SHELLS --> ROUTER --> VIEWS
    VIEWS --> PLAYER
    ROUTER -- "fetch /api/*, /video/:id ..." --> GATE
    ROKU --> GATE
    GATE --> ROUTES
    GATE --> PODR
    GATE --> YTDR
    ROUTES --> AUDIT
    PODR --> AUDIT
    YTDR --> AUDIT
    ROUTES --> AUTHL
    ROUTES --> VQ
    ROUTES --> MEDIA
    ROUTES --> PLACES
    ROUTES --> PUSHL
    PODR --> HG
    YTDR --> HG
    ROUTES --> DB
    PODR --> DB
    YTDR --> DB
    AUTHL --> DB
    PODR --> SECRETS
    ROUTES --> CACHES
    ROUTES --> EXT
    MEDIA --> EXT
    YTDR --> EXT
    PUSHL --> SW
```

## 2. Data model

One SQLite file, two buckets (see ARCHITECTURE.md "Storage"). The document
store persists the legacy db.json object shape per row; everything
user-scoped is relational. The namespace lists in `lib/db/sqlite.js` are a
LOCK (`assertNoUnknownKeys()` throws on strangers). Measured at v1.135.0:
13 `doc_kv` namespaces, 18 `doc_single` names, 29 relational tables,
schema version 19.

```mermaid
flowchart LR
    subgraph DOC["Document store (the db.json shape, per-row)"]
        KV["doc_kv (namespace, key, json)<br/>per-item rows:<br/>metadata · progress · viewCounts · trash ·<br/>deleteTombstones · books.items · books.progress ·<br/>books.audio · music.tracks · podcasts.episodes ·<br/>tv.episodes · ytdlp.downloadMeta · ytdlp.channelAvatars"]
        SINGLE["doc_single (name, json)<br/>whole small objects:<br/>folders · folderSettings · folderDisplayNames ·<br/>settings · liked · books.folders · books.settings ·<br/>books.pins · music.folders · music.settings · music.channels ·<br/>podcasts.subscriptions · podcasts.settings ·<br/>tv.folders · tv.settings ·<br/>ytdlp.subscriptions · ytdlp.pins · ytdlp.allowMembersOnly"]
    end

    subgraph REL["Relational per-user tables (accessors: lib/auth/store.js)"]
        CORE["identity + core media<br/>users · user_restrictions ·<br/>user_progress · user_liked · user_watched ·<br/>user_queue · user_queue_state ·<br/>user_search_history · user_feed_hidden ·<br/>user_channel_pins"]
        PLACEST["per-place<br/>user_book_progress · user_book_pins ·<br/>user_book_liked · user_book_finished ·<br/>user_music_progress · user_music_liked ·<br/>user_music_state · user_podcast_progress ·<br/>user_podcast_liked · user_podcast_pins ·<br/>user_podcast_played ·<br/>user_tv_progress · user_tv_played · user_tv_liked"]
        NOTIF["notifications + push<br/>notifications · user_notification_reads ·<br/>user_notification_dismissals ·<br/>user_notification_state · push_subscriptions"]
    end

    subgraph OUT["Deliberately OUTSIDE the db (and outside backups)"]
        FEEDS["podcast-feeds.json (0600)<br/>feed URLs are CREDENTIALS"]
        SS["session-secret (0600)"]
        VAPID["vapid-keys.json (0600)"]
    end

    WRITERS["Writers:<br/>updateDatabase(mutatorFn) - one in-process mutex ·<br/>diff-save, changed rows only, one transaction ·<br/>getCachedDatabase() reads throw on mutation under test"]

    WRITERS --> DOC
    WRITERS --> REL
```

Ownership at a glance: `metadata`/`viewCounts`/`trash`/`folders*` belong to
the video core in `server.js`; `books.*` to `lib/books/`; `music.*` to
`lib/music/`; `podcasts.*` to `lib/podcasts/`; `ytdlp.*` to `lib/ytdlp/` -
feature-owned namespaces are what keep the persist-gate bug class away.

## 3. The scan pipeline

One interval drives media + books + music scans and the trash sweep.
`id = md5(filePath)` (path-derived - every move/relocate has an explicit
re-key lane).

```mermaid
flowchart TD
    TRIGGER["scan interval / manual POST /api/scan"] --> COAL{"scan already running?"}
    COAL -- "yes" --> QUEUED["coalesce: one follow-up queued"]
    COAL -- "no" --> WALK["async cooperative walker<br/>skips .filetube-trash + in-flight transcode temps,<br/>records unreadable dirs"]
    WALK --> KNOWN{"file already indexed<br/>+ unchanged?"}
    KNOWN -- "yes" --> REUSE["reuse fast-path:<br/>metadata never re-extracted"]
    KNOWN -- "no" --> EXTRACT["ffprobe/ffmpeg:<br/>duration, thumbnail, chapters,<br/>embedded tags, codecs"]
    REUSE --> MERGE["Phase-2 merge into db<br/>(carry-forward + gap-fill guards)"]
    EXTRACT --> MERGE
    MERGE --> PRUNE{"prune policy - ALL must hold:<br/>pruneMissing on · item vanished from walk ·<br/>root not missing/unmounted ·<br/>path not under an ERRORED dir ·<br/>root not vanished wholesale"}
    PRUNE -- "all hold" --> DROP["prune the record"]
    PRUNE -- "any fails" --> KEEP["keep (transient-loss guard)"]
    DROP --> PERSIST["updateDatabase - diff-save"]
    KEEP --> PERSIST
    PERSIST --> SWEEPS["post-scan: trash retention sweep,<br/>cache age sweeps"]
```

## 4. The watch/stream flow

Every byte passes the same gate as every page. Browser-incompatible
containers transcode on demand; iOS background audio rides a pre-extracted
`.m4a` sidecar.

```mermaid
sequenceDiagram
    participant B as Browser (watch.js + player.js)
    participant G as authGate (lib/auth/gate.js)
    participant S as server.js
    participant V as visibility (lib/auth/visibility.js)
    participant F as ffmpeg queues
    participant D as filetube.db

    B->>G: GET /video/:id (Range: bytes=...)
    G->>G: cookie HMAC + live user row re-check
    G->>S: authorized request
    S->>V: mediaVisibleTo(user, item)?
    V-->>S: visible / 404
    S->>D: item lookup (cached read)
    alt browser-compatible container
        S-->>B: sendRangeable - 206 byte ranges
    else needs transcode, cached result exists
        S-->>B: 206 from transcoded/ (LRU, eviction-protected in flight)
    else needs transcode, not cached
        S->>F: queueTranscode H.264/AAC (+faststart)
        S-->>B: 503 {error: transcoding}
        Note over B: client POLLS, shows "Preparing video"<br/>until the cache path serves 206
    end
    Note over B,S: separate DESKTOP-ONLY opt-in: ?live=1 -><br/>streamLiveTranscode pipes ffmpeg stdout as<br/>fragmented MP4 over a 200 - chosen by the client<br/>from the FIRST request, never a server fallback
    Note over B: progress saved every 4s -> per-user user_progress
    B->>G: POST /api/videos/:id/prepare-audio (video items, mobile)
    G->>S: authorized
    S->>F: extract .m4a background-audio sidecar
    Note over B: iOS lock/background -> player.js hands off<br/>to the hidden audio element playing the sidecar
```

## 5. The client SPA + the persistent player

The router swaps ONLY `#view-root`; header, nav, and the player host never
remount. The player is ONE host element reparented between states - the
battle-won subsystems (background-audio handoff, caption overlay, faux
fullscreen, immersive carry) live on it and are reused, never rebuilt.

```mermaid
flowchart LR
    subgraph SHELL["Persistent shell (survives navigation)"]
        HDR["header + nav + sidebar"]
        HOST["#player-host (ONE instance)"]
        DOCK["#player-dock (corner mini-player)"]
    end
    subgraph VR["#view-root (swapped per view)"]
        VIEW["active view DOM<br/>per-view AbortController owns every listener"]
    end
    NAV["FileTube.navigate(href)"] --> VR
    NAV -. "view styles MUST live in style.css<br/>(page-local head styles are lost here)" .-> VR
    HOST <--> DOCK
```

```mermaid
stateDiagram-v2
    [*] --> CLOSED
    CLOSED --> FULL: load() into a view's #player-slot
    FULL --> DOCKED: navigate away (dock() reparents)
    DOCKED --> FULL: tap dock / adopt load (same media, no restart)
    DOCKED --> CLOSED: dock close
    FULL --> CLOSED: close()
    note right of FULL
        FULL-only surfaces: faux fullscreen (.css-fullscreen),
        expanded audio (.audio-expanded), immersive carry
        across playback continuations, tap-to-pause,
        keyboard shortcuts, resume-countdown prompt
    end note
    note right of DOCKED
        no immersive surfaces; resume decisions
        auto-apply (prompt is unreadable at dock size)
    end note
```

## Reading order

New to the codebase: diagram 1 for the shape, then `docs/ARCHITECTURE.md`
top to bottom, then diagram 2 next to the "Storage" section. Debugging a
playback issue: diagrams 4 and 5, then the player.js header comments.
Adding a persisted field: diagram 2, then the namespace LOCK in
`lib/db/sqlite.js`, then ARCHITECTURE.md "Storage" - and remember the
schema-version rules in `docs/RELEASING.md`.
