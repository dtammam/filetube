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

  // Node backend + test suite (CommonJS).
  {
    files: ['server.js', 'test/**/*.js', 'eslint.config.js'],
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

  // Vanilla browser frontend (all client scripts).
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      // `module` is referenced only inside a `typeof module` guard so common.js
      // can export pure helpers to Node tests; harmless in the browser.
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
        resolveChannelName: 'readonly',
        resolveTheme: 'readonly',
        setTheme: 'readonly',
        showConfirmModal: 'readonly',
        THEME_REGISTRY: 'readonly',
        resolveIconSet: 'readonly',
        setIconSet: 'readonly',
        ICON_SET_REGISTRY: 'readonly',
        ICON_SETS: 'readonly',
      },
    },
  },
];
