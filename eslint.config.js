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
    files: ['server.js', 'lib/**/*.js', 'test/**/*.js', 'eslint.config.js'],
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
      // `renderIconPicker` is defined inline in setup.html (not a public/js/*
      // file) and feature-detected from common.js's applyIconSet(), so it must
      // be declared here for common.js's own lint pass.
      globals: { ...globals.browser, module: 'readonly', renderIconPicker: 'readonly' },
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
    files: ['public/js/main.js', 'public/js/watch.js'],
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
      },
    },
  },
];
