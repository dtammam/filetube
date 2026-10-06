#!/usr/bin/env node
'use strict';
// Settings census (v1.367.0 falsifier): every Settings page, heading and control in
// public/setup.html with its save path and the roles that see it. Run on main BEFORE a
// reorganization and again after: the (control, save path, roles) set must be identical;
// only the page and heading a control sits under may move.
//   node scripts/settings-census.js            text table
//   node scripts/settings-census.js --json     machine-readable
//   node scripts/settings-census.js --controls sorted "id|save|roles" lines (for diff)
// Save paths: /api/settings = server-wide, admin-only POST; /api/me/settings = personal,
// synced to the account; localStorage = this device; own route = a dedicated endpoint.
// The SAVE table is the census' own claim about setup.js: an md-root control missing from it
// fails the run, so a new control cannot slip in unclassified.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = path.join(__dirname, '..', 'public', 'setup.html');

const S = '/api/settings';
const D = 'localStorage';
const U = '/api/me/settings';
// id -> [save path, roles that see the control today ("all" | "admin" | "library-write" | "push-on")]
const SAVE = {
  'hide-stars-check': [U + ' + ' + D, 'all'],
  'logo-file-input': ['/api/settings/logo', 'all'], 'logo-upload-btn': ['/api/settings/logo', 'all'], 'logo-reset-btn': ['/api/settings/logo', 'all'],
  'logo-file-input-dark': ['/api/settings/logo', 'all'], 'logo-upload-btn-dark': ['/api/settings/logo', 'all'], 'logo-reset-btn-dark': ['/api/settings/logo', 'all'],
  'sticker-file-input': ['/api/me/sticker', 'all'],
  'pocket-kb-search-check': [D, 'all'], 'music-skin-filter': ['none (search box)', 'all'],
  'critter-mode-check': [D, 'all'], 'critter-density-select': [D, 'all'], 'critter-size-select': [D, 'all'],
  'critter-kiss-check': [D, 'all'], 'critter-randomsound-check': [D, 'all'],
  'critter-image-input': ['/api/critters', 'admin'], 'critter-sound-input': ['/api/critters', 'admin'],
  'critter-upload-images-btn': ['/api/critters', 'admin'], 'critter-upload-sounds-btn': ['/api/critters', 'admin'],
  'critter-delete-all-btn': ['/api/critters/all', 'admin'],
  'new-folder-path': ['/api/config', 'all'], 'add-folder-btn': ['/api/config', 'all'], 'save-config-btn': ['/api/config', 'all'],
  'new-book-folder-path': ['/api/books/config', 'all'], 'add-book-folder-btn': ['/api/books/config', 'all'], 'scan-books-btn': ['/api/books/scan', 'all'], 'save-book-config-btn': ['/api/books/config', 'all'],
  'new-music-folder-path': ['/api/music/config', 'all'], 'add-music-folder-btn': ['/api/music/config', 'all'], 'scan-music-btn': ['/api/music/scan', 'all'], 'save-music-config-btn': ['/api/music/config', 'all'],
  'new-tv-folder-path': ['/api/tv/config', 'all'], 'add-tv-folder-btn': ['/api/tv/config', 'all'], 'scan-tv-btn': ['/api/tv/scan', 'all'], 'save-tv-config-btn': ['/api/tv/config', 'all'],
  'default-view-select': [S, 'all'], 'default-sort-select': [S, 'all'], 'autoplay-next-check': [S, 'all'],
  'relocate-hydrated-check': [S, 'all'], 'notifications-enabled-check': [S, 'all'],
  'push-user-enabled-check': [U, 'push-on'], 'push-device-enable-btn': ['/api/push/subscribe', 'push-on'], 'push-device-disable-btn': ['/api/push/unsubscribe', 'push-on'],
  'per-page-sort-check': [D, 'all'],
  'resume-mode-select': [D, 'all'], 'resume-threshold-input': [D, 'all'], 'resume-countdown-check': [D, 'all'],
  'resume-countdown-seconds-input': [D, 'all'], 'resume-countdown-action-select': [D, 'all'],
  'home-feed-check': [U + ' + ' + D, 'all'], 'modern-mode-check': [U + ' + ' + D, 'all'],
  'home-continue-watching-check': [D, 'all'], 'tv-continue-watching-check': [D, 'all'],
  'home-continue-listening-check': [D, 'all'], 'home-continue-reading-check': [D, 'all'],
  'scan-interval-select': [S, 'all'], 'prune-missing-check': [S, 'all'], 'chapter-snap-leadin-select': [S, 'all'],
  'scan-now-btn': ['/api/scan', 'all'], 'clear-cache-btn': ['/api/cache/clear', 'all'],
  'cache-age-select': [S, 'all'], 'cache-cap-input': [S, 'all'],
  'engine-channel-bundled': ['/api/ytdlp/engine', 'admin'], 'engine-channel-stable': ['/api/ytdlp/engine', 'admin'], 'engine-channel-nightly': ['/api/ytdlp/engine', 'admin'],
  'engine-autoupdate-check': ['/api/ytdlp/engine', 'admin'], 'engine-update-btn': ['/api/ytdlp/engine/update', 'admin'],
  'trash-retention-select': [S, 'all'], 'trash-empty-all': ['/api/trash/purge-all', 'all'],
  'logout-btn': ['/api/auth/logout', 'all'],
  'account-photo-upload': ['/api/me/avatar', 'all'], 'account-photo-remove': ['/api/me/avatar', 'all'], 'account-photo-input': ['/api/me/avatar', 'all'],
  'device-name-input': [D, 'all'],
  'new-user-username': ['/api/users', 'admin'], 'new-user-displayname': ['/api/users', 'admin'], 'new-user-password': ['/api/users', 'admin'],
  'new-user-role': ['/api/users', 'admin'], 'new-user-subs-flag': ['/api/users', 'admin'], 'add-user-btn': ['/api/users', 'admin'],
  'restore-file-input': ['/api/admin/restore', 'admin'], 'restore-btn': ['/api/admin/restore', 'admin'],
  'boot-error-log-export-btn': [D, 'all'], 'boot-error-log-clear-btn': [D, 'all'],
  'debug-lifecycle-check': [D, 'all'], 'debug-lifecycle-overlay-check': [D, 'all'], 'lifecycle-log-export-btn': [D, 'all'], 'lifecycle-log-clear-btn': [D, 'all'],
  'debug-no-tap-glyph-check': [D, 'all'], 'debug-rotate-check': [D, 'all'],
  'critter-voice-check-btn': ['none (plays sounds)', 'all'],
  'background-audio-check': [S, 'all'], 'pre-extract-audio-check': [S, 'all'], 'attribute-control-check': [S, 'all'],
  'bg-audio-sync-check': [S, 'all'], 'bg-keepalive-check': [D, 'all'], 'bg-timing-log-check': [D, 'all'],
  'bg-timing-log-copy': [D, 'all'], 'bg-timing-log-clear': [D, 'all'], 'bg-timing-log-text': ['none (readout)', 'all'],
  'audio-session-declare-check': [D, 'all'], 'mobile-custom-player-check': [S, 'all'],
  'wheel-cal-open': ['none (test overlay)', 'all'], 'perf-diag-check': [S, 'all'],
  'transcript-ai-add-btn': [S, 'all'],
};
// Unlabelled dynamic controls (built by setup.js): id of the host element -> save path.
const HOSTS = {
  'bottombar-editor': [D, 'all'], 'music-channels-list': ['/api/folders/music-flag', 'library-write'],
  'trash-list': ['/api/trash/:id', 'all'], 'feed-hidden-list': ['/api/feed-hidden/:id', 'all'],
};

function census(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const root = doc.querySelector('.md-root[data-md-page="setup"]');
  const pages = [];
  const problems = [];
  root.querySelectorAll(':scope > details[data-collapse-key]').forEach((sec) => {
    const page = {
      key: sec.getAttribute('data-collapse-key'),
      title: (sec.getAttribute('data-md-label') || sec.querySelector('summary').textContent).trim().replace(/\s+/g, ' '),
      group: sec.getAttribute('data-md-group') || '',
      pageAdmin: sec.hasAttribute('data-md-badge') || sec.hasAttribute('data-admin-only'),
      headings: [],
      controls: [],
    };
    let heading = '(page top)';
    const walk = (el, inAdminOnly) => {
      for (const ch of el.children) {
        if (ch.tagName === 'SUMMARY') continue;
        if (/^H[23]$/.test(ch.tagName) && ch.classList.contains('setup-heading')) {
          heading = ch.textContent.trim();
          page.headings.push(heading);
          continue;
        }
        const adm = inAdminOnly || ch.hasAttribute('data-admin-only');
        if (/^(INPUT|SELECT|BUTTON|TEXTAREA)$/.test(ch.tagName) && ch.id) {
          const rec = SAVE[ch.id];
          if (!rec) problems.push('unclassified control: ' + ch.id + ' (page ' + page.key + ')');
          const roles = adm || page.pageAdmin ? 'admin' : (rec ? rec[1] : '?');
          page.controls.push({ id: ch.id, heading, save: rec ? rec[0] : '?', roles: roles === 'all' && adm ? 'admin' : roles, adminRows: adm });
        } else if (HOSTS[ch.id]) {
          const rec = HOSTS[ch.id];
          page.controls.push({ id: ch.id, heading, save: rec[0], roles: adm || page.pageAdmin ? 'admin' : rec[1], adminRows: adm });
        }
        if (ch.id === 'transcript-ai-prompts' || ch.id === 'transcript-ai-list') {
          page.controls.push({ id: ch.id, heading, save: S, roles: 'all', adminRows: adm });
        }
        walk(ch, adm);
      }
    };
    walk(sec, false);
    pages.push(page);
  });
  const known = new Set(Object.keys(SAVE));
  const seen = new Set(pages.flatMap((p) => p.controls.map((c) => c.id)));
  known.forEach((id) => { if (!seen.has(id)) problems.push('SAVE entry with no control in a page: ' + id); });
  return { groupsDeclared: root.getAttribute('data-md-groups'), pages, problems };
}

module.exports = { census, SAVE, HOSTS };

if (require.main === module) {
  const c = census(fs.readFileSync(HTML, 'utf8'));
  const arg = process.argv[2];
  if (arg === '--json') {
    console.log(JSON.stringify(c, null, 2));
  } else if (arg === '--controls') {
    c.pages.flatMap((p) => p.controls).map((x) => x.id + '|' + x.save + '|' + x.roles).sort().forEach((l) => console.log(l));
  } else {
    console.log('groups: ' + c.groupsDeclared);
    c.pages.forEach((p) => {
      console.log('\n[' + (p.group || '-') + '] ' + p.title + '  (' + p.key + ')' + (p.pageAdmin ? '  ADMIN PAGE' : ''));
      let last = null;
      p.controls.forEach((x) => {
        if (x.heading !== last) { console.log('  ## ' + x.heading); last = x.heading; }
        console.log('     ' + x.id.padEnd(34) + x.save.padEnd(34) + x.roles);
      });
    });
  }
  if (c.problems.length) { console.error('\nPROBLEMS:\n' + c.problems.join('\n')); process.exit(1); }
}
