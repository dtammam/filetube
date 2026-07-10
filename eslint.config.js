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
      '.state/**',
      'docs/**',
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

  // common.js is loaded first and exposes these helpers as globals. Declare them
  // only for the CONSUMER scripts (not common.js itself, which defines them —
  // declaring them there would trip no-redeclare).
  {
    files: ['public/js/main.js', 'public/js/watch.js', 'public/js/setup.js', 'public/js/player.js'],
    languageOptions: {
      globals: {
        clampPositionState: 'readonly',
        formatDuration: 'readonly',
        formatFileSize: 'readonly',
        formatRelativeTime: 'readonly',
        getCommentCount: 'readonly',
        getMockSubCount: 'readonly',
        getMockViews: 'readonly',
        getStarRating: 'readonly',
        rankRelated: 'readonly',
        resolveAudioArtUrl: 'readonly',
        resolveChannelName: 'readonly',
        resolveTheme: 'readonly',
        setTheme: 'readonly',
        showConfirmModal: 'readonly',
        // FR-3 (T2): the toast helper (watch.js's post-delete success +
        // main.js's card trash-can outcomes) and the card trash-can's pure
        // arm/disarm reducer (main.js only, but declared alongside its
        // sibling helpers here for consistency).
        showToast: 'readonly',
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
        // FR-4 (v1.19.0): setup.js's synthetic-download-folder remove-button
        // disable check.
        isSyntheticFolder: 'readonly',
        // FR-2/FR-3 (T3) shared prev/next order-derivation helpers -- consumed
        // by watch.js (Prev/Next controls) and player.js (autoplay-next).
        deriveOrderedIds: 'readonly',
        computeNeighbors: 'readonly',
        parentFolder: 'readonly',
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
        // F1 (T3, v1.24.0): deterministic uploader/channel avatar fallback +
        // the real-avatar-vs-generated precedence seam, consumed by
        // watch.js's uploader/comment avatar render (T4, same wave).
        deriveAvatar: 'readonly',
        resolveAvatarSource: 'readonly',
        // C2/C3 (T3-WIRE, v1.24.0): item-count badge + format-toggle
        // (video/audio/both) library controls, consumed by main.js's
        // home/folder/playlist/channel grid render.
        renderItemCountBadge: 'readonly',
        filterByMediaType: 'readonly',
        getStoredFormatFilter: 'readonly',
        setStoredFormatFilter: 'readonly',
        renderFormatToggle: 'readonly',
        // C1 (T9, v1.24.0): the "Move to..." picker modal + its
        // POST /api/videos/:id/move caller, consumed by main.js's per-card
        // trigger and watch.js's current-item trigger (T9 follow-up wiring).
        showMoveModal: 'readonly',
        requestMoveItem: 'readonly',
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
  {
    files: ['lib/ytdlp/client/subscriptions.js'],
    languageOptions: {
      globals: {
        openOverlay: 'readonly',
        closeOverlayThen: 'readonly',
      },
    },
  },
];
