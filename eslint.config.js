'use strict';

const js = require('@eslint/js');
const globals = require('globals');

// Rules shared by every file set.
const commonRules = {
  // Empty `catch {}` is an intentional "best-effort, ignore failure" idiom here.
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Finicky rule with false positives (e.g. a fallback value assigned before a
  // try/catch that may throw). Not worth the risk on existing code.
  'no-useless-assignment': 'off',
};

module.exports = [
  // Ignore generated / vendored / runtime paths.
  {
    ignores: [
      'node_modules/**',
      'data/**',
      '.thumbnails/**',
      'coverage/**',
      // v1.37.0: vendored client dists (minified upstream code) -- see
      // public/vendor/README.md.
      'public/vendor/**',
      'docs/**',
      // v1.77 (QA gate): Claude Code creates isolated git worktrees for
      // subagents under .claude/worktrees/<agent-id>/. They are full checkouts
      // of this repo, so eslint walked them and lint-of-the-repo became
      // lint-of-the-repo-times-N - 10,680 duplicate "errors" while a reviewer
      // was running, which the pre-commit hook then refuses. They are
      // registered git worktrees, so `git status` does not show them and the
      // breakage looks like it came from nowhere. Transient scratch space,
      // never source: ignored here and in .gitignore.
      '.claude/worktrees/**',
    ],
  },

  js.configs.recommended,

  // Node backend + test suite (CommonJS). `lib/**` is the optional yt-dlp
  // integration module (v1.11.0) -- same backend/CommonJS ruleset as server.js.
  // NOTE: `lib/ytdlp/client/**` is overridden to the vanilla-browser ruleset
  // below (it ships browser-only code, not Node backend code) -- ESLint's
  // flat config merges `languageOptions` across every matching block in
  // array order, so the later, more specific block's `globals`/`sourceType`
  // apply for those files while everything else in `lib/**` stays on this
  // Node/CommonJS ruleset.
  {
    files: ['server.js', 'lib/**/*.js', 'test/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...commonRules,
      // Allow unused function args (e.g. Express `next`), leading-underscore
      // names, and unused caught-error bindings (`catch (_) {}`).
      'no-unused-vars': ['error', {
        args: 'none',
        caughtErrors: 'none',
        varsIgnorePattern: '^_',
      }],
    },
  },

  // Vanilla browser frontend (all client scripts, incl. the optional yt-dlp
  // module's page controller -- see the note on the block above).
  {
    files: ['public/**/*.js', 'lib/ytdlp/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      // `module` is referenced only inside a `typeof module` guard so common.js
      // (and lib/ytdlp/client/subscriptions.js) can export pure helpers to
      // Node tests; harmless in the browser.
      // `FileTube` is the SPA-lite router/view-registry namespace common.js
      // attaches to `window` (FR-1, T1); every other view script
      // (main/watch/setup/subscriptions) calls `FileTube.registerView`/
      // `FileTube.navigate`.
      globals: { ...globals.browser, module: 'readonly', FileTube: 'readonly' },
    },
    rules: {
      ...commonRules,
      // Handlers are often referenced from inline HTML attributes, so functions
      // can look "unused" to the linter — warn rather than fail.
      'no-unused-vars': ['warn', {
        args: 'none',
        caughtErrors: 'none',
        varsIgnorePattern: '^_',
      }],
    },
  },

  // Tier 3: the isolated capture harness (tools/capture) is plain Node -
  // same globals as the server/scripts side. settle.js and the
  // determinism test additionally embed page.evaluate callbacks that run
  // IN THE BROWSER (document/window are real there), so they carry
  // browser globals too - the same dual-context shape Playwright code
  // always has.
  {
    files: ['tools/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['tools/capture/settle.js', 'tools/capture/capture.js', 'test/integration/capture-determinism.test.js', 'test/integration/capture-guard-browser.test.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // player.js exposes its pure queue mirrors as globals; declare them only
  // for watch.js (the consumer) — player.js DEFINES them (the same
  // definer-vs-consumer split as the common.js roster below).
  {
    files: ['public/js/watch.js'],
    languageOptions: {
      globals: {
        computeQueueNext: 'readonly',
        computeQueuePrev: 'readonly',
      },
    },
  },

  // common.js is loaded first and exposes these helpers as globals. Declare them
  // only for the CONSUMER scripts (not common.js itself, which defines them —
  // declaring them there would trip no-redeclare).
  {
    // v1.55: lib/ytdlp/client/subscriptions.js joined the consumers - it now
    // reads the shared action-status system (via typeof-guarded wrappers, so
    // Node `require`s of the file still work without common.js).
    // (v1.63 gate NEW-3: music.js briefly joined for addToQueue, then its
    // affordance was pulled - it consumes nothing from common.js again and
    // left the roster with the comment that had gone stale.)
    files: ['public/js/main.js', 'public/js/watch.js', 'public/js/setup.js', 'public/js/player.js', 'public/js/books.js', 'public/js/read.js', 'public/js/stats.js', 'lib/ytdlp/client/subscriptions.js'],
    languageOptions: {
      globals: {
        clampPositionState: 'readonly',
        formatDuration: 'readonly',
        formatFileSize: 'readonly',
        formatRelativeTime: 'readonly',
        getCommentCount: 'readonly',
        getMockSubCount: 'readonly',
        getMockViews: 'readonly',
        // v1.52: the instant-watch pure paint-plan builder + pre-load gate
        // (common.js).
        deriveWatchPaintPlan: 'readonly',
        isFullWatchSeedItem: 'readonly',
        // v1.53: the shared attribution picker (common.js).
        showAttributionPicker: 'readonly',
        // v1.81 write-RBAC: the memoized /api/auth/me fetcher (common.js),
        // read by watch.js/player.js to gate the delete/move/edit affordances.
        fetchCurrentUser: 'readonly',
        // v1.82: the shared sign-out (common.js), used by setup.js's button.
        accountSignOut: 'readonly',
        // v1.83: the shared avatar crop modal (common.js), used by setup.js's uploader.
        cropAvatarFile: 'readonly',
        // v1.53: the capability cache (common.js).
        readCapabilityCache: 'readonly',
        writeCapabilityCache: 'readonly',
        scrubSubsForCache: 'readonly',
        primePinnedSidebarFromCache: 'readonly',
        getStarRating: 'readonly',
        rankRelated: 'readonly',
        resolveAudioArtUrl: 'readonly',
        resolveChannelName: 'readonly',
        resolveTheme: 'readonly',
        // v1.48 item 2: real day-of view counts (wraps getMockViews as fallback).
        resolveViewCountLabel: 'readonly',
        setTheme: 'readonly',
        // v1.55 Track C/D: the ONE busy/status feedback system + collapsible
        // section persistence (common.js).
        setActionStatus: 'readonly',
        setButtonBusy: 'readonly',
        wireCollapsibleSections: 'readonly',
        showConfirmModal: 'readonly',
        // FR-3 (T2): the toast helper (watch.js's post-delete success +
        // main.js's card trash-can outcomes) and the card trash-can's pure
        // arm/disarm reducer (main.js only, but declared alongside its
        // sibling helpers here for consistency).
        showToast: 'readonly',
        // v1.63 playback queue: THE one add verb (common.js), called by
        // every affordance (main.js cards, watch.js verbs, music.js rows).
        addToQueue: 'readonly',
        // v1.67 (plan D6): THE share decision (common.js), called by the
        // watch Share button and the card share corner.
        shareExternalUrl: 'readonly',
        // v1.68 (ruling 4): close a played video's delivered push banner
        // (common.js), called by watch.js's pingView.
        closeDeliveredPushBanners: 'readonly',
        // v1.63.1: the stars display pref (common.js owns it; setup.js's
        // toggle reflects + fires it).
        shouldShowStarRatings: 'readonly',
        applyStarRatingsPref: 'readonly',
        // v1.79: the home-feed toggle (common.js owns it; main.js reads it at
        // home init, setup.js's toggle reflects + mirrors it).
        homeFeedEnabled: 'readonly',
        applyHomeFeedPref: 'readonly',
        // v1.84: the Modern-mode toggle (common.js owns it; main.js reads it at
        // home init, setup.js's toggle reflects + mirrors it).
        modernModeEnabled: 'readonly',
        applyModernModePref: 'readonly',
        // v1.41.10 (QA gate): shared delete-outcome -> toast-message mapper
        // (common.js), used by both delete flows (main.js cards + watch.js).
        deleteResultToast: 'readonly',
        nextArmState: 'readonly',
        THEME_REGISTRY: 'readonly',
        resolveIconSet: 'readonly',
        setIconSet: 'readonly',
        ICON_SET_REGISTRY: 'readonly',
        ICON_SETS: 'readonly',
        sortItems: 'readonly',
        shouldShowShuffleButton: 'readonly',
        visibleSidebarFolders: 'readonly',
        resolveDefaultView: 'readonly',
        moveArrayItem: 'readonly',
        computeDropIndex: 'readonly',
        rebuildFullFolderOrder: 'readonly',
        // v1.76: the shared drag-to-reorder gesture layer (common.js), consumed
        // by main.js + setup.js as bare globals the same way the two ordering
        // primitives above are.
        wireReorderable: 'readonly',
        resolveReorderTarget: 'readonly',
        computeAutoScrollDelta: 'readonly',
        // FR-4 (v1.19.0): setup.js's synthetic-download-folder remove-button
        // disable check.
        isSyntheticFolder: 'readonly',
        // FR-2/FR-3 (T3) shared prev/next order-derivation helpers -- consumed
        // by watch.js (Prev/Next controls) and player.js (autoplay-next).
        deriveOrderedIds: 'readonly',
        computeNeighbors: 'readonly',
        parentFolder: 'readonly',
        // v1.40.0 browse-context helpers -- consumed by main.js (emit card
        // links), watch.js (prev/next) and player.js (autoplay-next).
        encodeListContext: 'readonly',
        decodeListContext: 'readonly',
        buildContextListUrl: 'readonly',
        // setup.js-only (FR-1, T1 extraction from setup.html's former inline script)
        gbToBytes: 'readonly',
        bytesToGb: 'readonly',
        // FR-2 (T2, v1.20.0): channel-identity matcher primitives, consumed by
        // watch.js's Subscribe button wiring (T3).
        canonicalizeChannelUrl: 'readonly',
        channelIdentityMatches: 'readonly',
        resolveFileChannelIdentity: 'readonly',
        // FR-1/FR-3 (T3, v1.20.0): subscribe-button state derivation and the
        // compact subscribe-confirm modal builder, consumed by watch.js's
        // Subscribe button wiring.
        decideSubscribeButtonState: 'readonly',
        buildSubscribeModal: 'readonly',
        // FR-7 (T6, v1.21.0): the fail-safe yt-dlp-vs-local detection
        // predicate and the escalated, checkbox-gated hard-delete confirm,
        // consumed by watch.js's delete button and main.js's card two-tap
        // arm.
        isYtdlpManagedItem: 'readonly',
        showHardDeleteModal: 'readonly',
        // FR-5 (TC, v1.22.0): desktop-sidebar channel-pins renderer, called
        // from each of main.js/watch.js/setup.js's own init().
        renderPinnedSidebar: 'readonly',
        // v1.37.0 books: the merged pin fetch (common.js).
        fetchAllPins: 'readonly',
        refreshAllPinSurfaces: 'readonly',
        // F1 (T3, v1.24.0): deterministic uploader/channel avatar fallback +
        // the real-avatar-vs-generated precedence seam, consumed by
        // watch.js's uploader/comment avatar render (T4, same wave).
        deriveAvatar: 'readonly',
        resolveAvatarSource: 'readonly',
        // v1.32 (custom logo): common.js's header-logo swap, re-invoked by
        // setup.js right after a successful upload so the change is visible
        // without a reload.
        applyCustomLogoIfSet: 'readonly',
        // v1.33.1: common.js's count-gated Liked sidebar entry, applied by
        // every surface that (re-)renders #sidebar-folders-list.
        applyLikedSidebarEntry: 'readonly',
        // v1.77: common.js's Library-glyph repainter, called by setup.js's
        // Library-icon picker so a change is visible on this page immediately.
        applyLibraryGlyphs: 'readonly',
        // C2/C3 (T3-WIRE, v1.24.0): item-count badge + format-toggle
        // (video/audio/both) library controls, consumed by main.js's
        // home/folder/playlist/channel grid render.
        renderItemCountBadge: 'readonly',
        filterByMediaType: 'readonly',
        getStoredFormatFilter: 'readonly',
        setStoredFormatFilter: 'readonly',
        renderFormatToggle: 'readonly',
        // v1.50: watched-state toggle (common.js), consumed by main.js.
        getStoredWatchFilter: 'readonly',
        renderWatchToggle: 'readonly',
        // v1.45.6 (Dean): library view-mode + per-page-sort helpers (common.js),
        // consumed by main.js's grid render and setup.js's Settings toggles.
        getStoredViewMode: 'readonly',
        setStoredViewMode: 'readonly',
        isPerPageSortEnabled: 'readonly',
        setPerPageSortEnabled: 'readonly',
        pageSortKey: 'readonly',
        getPerPageSort: 'readonly',
        setPerPageSort: 'readonly',
        pullRefreshState: 'readonly',
        // C1 (T9, v1.24.0): the "Move to..." picker modal + its
        // POST /api/videos/:id/move caller, consumed by main.js's per-card
        // trigger and watch.js's current-item trigger (T9 follow-up wiring).
        showMoveModal: 'readonly',
        requestMoveItem: 'readonly',
        // Item 2/3 (v1.26.3): shared empty-state/error-state card builders,
        // consumed by main.js's home/library grid render + load-error path.
        buildEmptyStateHtml: 'readonly',
        buildErrorStateHtml: 'readonly',
      },
    },
  },

  // v1.77: the glyph pool. public/js/glyph-pool.js is loaded FIRST on every
  // shell (before common.js) and is also `require`d by server.js as a
  // CommonJS module, so the browser and the server validate/render against one
  // registry. Its exports are declared only for the CONSUMER scripts, per the
  // "declare only where consumed, not where defined" rule - which is why
  // common.js appears here (it consumes the pool) even though it is the
  // definer of the big roster above.
  {
    files: [
      'public/js/common.js', 'public/js/main.js',
      'public/js/setup.js', 'public/js/watch.js',
    ],
    languageOptions: {
      globals: {
        GLYPH_POOL: 'readonly',
        DEFAULT_FOLDER_GLYPH: 'readonly',
        LIBRARY_GLYPH_SLOTS: 'readonly',
        glyphClassName: 'readonly',
        resolveFolderGlyphClass: 'readonly',
        resolveLibraryGlyphClass: 'readonly',
      },
    },
  },

  // v1.67 (plan D9): the corner VOCABULARY (resolver + control roster) is
  // DEFINED at main.js module scope (main.js loads before setup.js on every
  // shell) and consumed by setup.js's corner editor. Declared ONLY for the
  // consumer, per the "declare only where consumed, not where defined" rule.
  {
    files: ['public/js/setup.js'],
    languageOptions: {
      globals: {
        resolveCardCornerPrefs: 'readonly',
        CARD_CORNER_CONTROLS: 'readonly',
      },
    },
  },

  // `renderIconPicker` is DEFINED in public/js/setup.js (a real global
  // function, deliberately not IIFE-wrapped -- see that file's module
  // comment) and feature-detected/called from common.js's `applyIconSet()`.
  // Declared as a global ONLY for the consumer (common.js), mirroring the
  // block above's "declare only where consumed, not where defined" rule --
  // declaring it for setup.js too would trip `no-redeclare` against its own
  // `function renderIconPicker() {}`.
  {
    files: ['public/js/common.js'],
    languageOptions: {
      globals: {
        renderIconPicker: 'readonly',
      },
    },
  },

  // v1.26.2 polish (sheet/modal transitions): `openOverlay`/`closeOverlayThen`
  // are DEFINED in public/js/common.js and consumed here (the subscription
  // settings sheet's open/close), same "declare only where consumed" posture
  // as the public/js/main.js|watch.js|setup.js|player.js block above --
  // common.js loads first as a classic script (see `/js/subscriptions.js`'s
  // route in lib/ytdlp/index.js), so this is the SAME bare-global pattern
  // `showHardDeleteModal`/`showMoveModal`/etc. already use.
  //
  // C5 (v1.30.0, T12): `resolveAvatarSource` joins this list -- the subs-row
  // and settings-sheet-header avatars now route through the SAME shared
  // precedence seam `watch.js` already consumes (see the block above), rather
  // than a locally-reimplemented one.
  {
    files: ['lib/ytdlp/client/subscriptions.js'],
    languageOptions: {
      globals: {
        openOverlay: 'readonly',
        closeOverlayThen: 'readonly',
        resolveAvatarSource: 'readonly',
      },
    },
  },

  // v1.66: a PUSH-ONLY worker at public/filetube-worker.js (no fetch
  // handler, no CacheStorage - locked by test/unit/v1264-service-worker
  // .test.js; the v1.27.2 removal rationale lives on
  // unregisterStaleServiceWorkers in public/js/common.js). Deliberately NOT
  // public/sw.js (the removed offline worker's path, unclaimed so the boot
  // shedder can tell the two apart) and NOT public/push-sw.js (v1.67.3:
  // a filter-list pattern content blockers refuse to load). Service-worker
  // globals scoped to this one file; `module` is there for the
  // decidePushDisplay test export.
  {
    files: ['public/filetube-worker.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, module: 'writable' },
    },
  },
];
