'use strict';
// The icon registry's name list (UI professionalism pass, plan D4.2). Every name is a
// Material Symbols name (https://fonts.google.com/icons), fetched in three styles by
// fetch.js and compiled into public/js/icons.js by build.js. A name listed in FILL also
// gets a `<name>.fill` entry (the FILL=1 variant) for on-states: bell on, pin on, liked.
//
// To add an icon: add its Material name here, run `node tools/icons/fetch.js` then
// `node tools/icons/build.js`, and commit the new sources with the regenerated icons.js.
// test/unit/icons-registry.test.js fails if a referenced name is missing.

const NAMES = [
  // chrome: header, bottom bar, sidebar, account menu
  'home', 'subscriptions', 'history', 'download', 'smart_display', 'podcasts', 'music_note',
  'menu_book', 'library_books', 'playlist_play', 'queue_music', 'search', 'menu', 'settings',
  'dark_mode', 'light_mode', 'account_circle', 'logout', 'refresh', 'bar_chart',
  // navigation and structure
  'close', 'arrow_back', 'chevron_right', 'expand_more', 'more_vert', 'more_horiz', 'folder', 'tv',
  'videocam', 'movie', 'book', 'info', 'open_in_new', 'add', 'edit', 'check', 'visibility', 'visibility_off',
  // actions and states
  'notifications', 'notifications_active', 'notifications_off', 'push_pin', 'keep', 'thumb_up',
  'favorite', 'star', 'share', 'headphones', 'subject', 'delete', 'content_copy', 'warning', 'error',
  'shuffle', 'repeat',
  // the reader (sweep S10): Contents, reader settings (Aa), the font-size stepper
  'toc', 'format_size', 'remove',
  // sweep S2 (cards and feeds): the card action menu, the library toolbar, the channel heading
  'local_fire_department', 'playlist_add', 'grid_view', 'view_list', 'sort', 'music_off',
  // media
  'play_arrow', 'pause', 'skip_next', 'skip_previous', 'fast_forward', 'fullscreen', 'fullscreen_exit',
  'picture_in_picture_alt', 'closed_caption', 'speed', 'volume_up', 'volume_off',
];

const FILL = ['notifications', 'notifications_active', 'push_pin', 'keep', 'thumb_up', 'favorite', 'star',
  'home', 'subscriptions'];

// The three icon sets (the data-icons axis). Each maps to a Material Symbols style +
// FILL: `filled` is the Outlined family at FILL=1 (the solid classic Material look).
const STYLES = {
  outlined: { family: 'materialsymbolsoutlined', fill: false },
  rounded: { family: 'materialsymbolsrounded', fill: false },
  filled: { family: 'materialsymbolsoutlined', fill: true },
};

module.exports = { NAMES, FILL, STYLES };
