'use strict';
// v1.265 (adversarial W-A/W-C): the ONE server-side source of the synced-pref
// allowlist + caps. server.js (the routes) and lib/auth/store.js (the backup
// RESTORE loop) both consume THIS module - the seat measured the restore path
// bypassing the route's allowlist, byte cap, and clock clamp (a bundle could
// plant an unbounded junk row served on every GET forever, or a far-future
// stamp that wedges a key for 285,000 years). One list, every ingress.
// The CLIENT's twin lives in public/js/prefs-sync.js (browser file, cannot
// require this); the triple-lock test binds client === this module === plan.
const SYNCED_PREF_KEYS = [
  'ft-era', 'ft-mode', 'ft-modern-mode', 'ft-icons',
  'filetube_sort', 'filetube_modern_sort', 'filetube_modern_chip',
  'ft-star-ratings', 'ft-ambient', 'ft-ambient-intensity',
  'ft-critters:on', 'ft-critters:density', 'ft-critters:size', 'ft-critters:kiss', 'ft-critters:randomsound',
  'ft-music-skin', 'ft-music-autoplay',
  'ft-home-feed', 'ft-home-continue-listening', 'ft-home-continue-podcasts', 'ft-tv-continue-watching',
];
const PREF_VALUE_MAX_BYTES = 512; // every real value is a short token; a data-URI does not belong here
const PREF_CLOCK_SLACK_MS = 300000; // stamps clamp to now + 5min (QA W3; the restore loop too - adversarial W-A)

module.exports = { SYNCED_PREF_KEYS, PREF_VALUE_MAX_BYTES, PREF_CLOCK_SLACK_MS };
