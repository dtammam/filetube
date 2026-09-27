'use strict';
// The primitive kit (UI professionalism pass, plan D12 step 3): every ui-* primitive in
// every variant and state, on one page, built ONLY through public/js/ui.js - so the page
// is the visual source of truth for the primitives, in whichever era, mode and icon set
// the URL names (?era= &mode= &icons=). Not linked from the app. Nothing here persists.

(function () {
  const root = document.getElementById('ui-kit');
  if (!root || typeof ui === 'undefined') return;

  const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const section = (title, caption) => {
    const s = h('section', 'ui-kit__section');
    s.appendChild(h('h2', 'ui-kit__title', title));
    if (caption) s.appendChild(h('p', 'ui-kit__caption', caption));
    root.appendChild(s);
    return s;
  };
  const row = (parent, nodes) => {
    const r = h('div', 'ui-kit__row');
    nodes.forEach((n) => r.appendChild(n));
    parent.appendChild(r);
    return r;
  };
  const params = new URLSearchParams(location.search);
  const here = (k, v) => { const q = new URLSearchParams(location.search); q.set(k, v); return '?' + q.toString(); };

  // ---- the switcher: era, mode, icon set (links, so a screenshot names its state) ----
  const sw = section('FileTube UI kit', 'Every primitive, every variant and state. Switch the era, mode and icon set:');
  const cur = document.documentElement;
  row(sw, [
    ui.segmented({ label: 'Era', value: cur.getAttribute('data-theme'), options: ['2021', '2014', '2009', '2005'].map((v) => ({ value: v, label: v })), onChange: (v) => { location.search = here('era', v); } }),
    ui.segmented({ label: 'Mode', value: cur.getAttribute('data-mode'), options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], onChange: (v) => { location.search = here('mode', v); } }),
    ui.segmented({ label: 'Icons', value: cur.getAttribute('data-icons'), options: [{ value: 'outlined', label: 'Outlined' }, { value: 'rounded', label: 'Rounded' }, { value: 'filled', label: 'Filled' }], onChange: (v) => { location.search = here('icons', v); } }),
  ]);

  // ---- buttons ----
  const b = section('Buttons', 'ui-btn: primary / secondary / tonal / plain / danger x sm 32 / md 36 (44 on a phone) / lg 44.');
  for (const size of ['sm', 'md', 'lg']) {
    row(b, ['primary', 'secondary', 'tonal', 'plain', 'danger'].map((variant) =>
      ui.button({ variant, size, label: variant[0].toUpperCase() + variant.slice(1), icon: variant === 'danger' ? 'delete' : 'add' })));
  }
  row(b, [
    ui.button({ variant: 'primary', size: 'sm', pill: true, label: 'Subscribe' }),
    ui.button({ variant: 'secondary', size: 'sm', pill: true, labels: ['Subscribe', 'Subscribed'], pressed: true }),
    ui.button({ variant: 'plain', shape: 'icon', icon: { off: 'notifications_off', on: 'notifications_active' }, pressed: true, ariaLabel: 'Notify' }),
    ui.button({ variant: 'plain', shape: 'icon', icon: { off: 'keep', on: 'keep.fill' }, pressed: false, ariaLabel: 'Pin' }),
    ui.button({ variant: 'plain', shape: 'icon', icon: 'more_vert', ariaLabel: 'More' }),
  ]);
  // toggles that flip on tap: the label stack keeps the width still
  const liveToggle = ui.button({ variant: 'secondary', pill: true, labels: ['Notify', 'Notifying'], icon: { off: 'notifications_off', on: 'notifications_active' }, pressed: false });
  liveToggle.addEventListener('click', () => ui.setPressed(liveToggle, liveToggle.getAttribute('aria-pressed') !== 'true'));
  const busy = ui.button({ variant: 'tonal', icon: 'refresh', label: 'Checking' });
  ui.setBusy(busy, true);
  const busyToggle = ui.button({ variant: 'secondary', labels: ['Like', 'Liked'], icon: { off: 'thumb_up', on: 'thumb_up.fill' }, pressed: true });
  ui.setBusy(busyToggle, true);
  row(b, [liveToggle, busy, busyToggle, ui.button({ variant: 'secondary', label: 'Disabled', disabled: true })]);
  const bar = h('div', 'ui-kit__row');
  for (const [icon, label] of [['thumb_up', 'Like'], ['share', 'Share'], ['headphones', 'Listen'], ['subject', 'Transcript'], ['more_horiz', 'More']]) {
    bar.appendChild(ui.button({ variant: 'plain', shape: 'stack', icon, label }));
  }
  b.appendChild(bar);

  // ---- chips ----
  const c = section('Chips', 'ui-chip: filter (selected = ink on the tonal fill, never red), meta (not a button), count.');
  row(c, [
    ui.chip({ kind: 'filter', label: 'All', selected: true }),
    ui.chip({ kind: 'filter', label: 'Videos' }),
    ui.chip({ kind: 'filter', label: 'Audio' }),
    ui.chip({ kind: 'meta', label: '25.6K subscribers' }),
    ui.chip({ kind: 'count', label: '3' }),
  ]);

  // ---- avatars and thumbnails ----
  const a = section('Avatars and artwork', 'ui-avatar (circle: channels, people) and ui-art (rounded square: albums, podcasts, books); a missing or broken image falls back to a monogram.');
  row(a, ['xs', 'sm', 'md', 'lg', 'xl', '2xl'].map((size, i) =>
    ui.avatar({ name: ['Harbor Workshop', 'Northbound Field Notes', 'Glass Orchard', 'Marrow Lane', 'Oriel Vance', 'The Tidewater Set'][i], size })));
  row(a, [
    ui.avatar({ name: 'Harbor Lights Radio', kind: 'podcast', size: 'lg' }),
    ui.avatar({ name: 'Night Transit', kind: 'album', size: 'xl' }),
    ui.avatar({ name: 'Broken image', url: '/does-not-exist.jpg', size: 'lg' }),
  ]);
  const t = section('Thumbnails', 'ui-thumb: fixed aspect, placeholder ground, one duration badge size, 3px progress.');
  const grid = h('div', 'ui-kit__grid');
  grid.appendChild(ui.thumb({ duration: 754, progress: 0.4 }));
  grid.appendChild(ui.thumb({ duration: 3725 }));
  grid.appendChild(ui.thumb({ src: '/does-not-exist.jpg', duration: 61 }));
  t.appendChild(grid);

  // ---- rows and lists ----
  const r = section('Rows', 'ui-row in a ui-list: the list reserves every column, so the thumbnails and actions line up whether or not a row has them.');
  const notif = ui.list({ size: 'media', grouped: true, media: 'avatar', aside: 'thumb', actions: 1, divider: 'inset', label: 'Notifications' });
  const more = () => ui.button({ variant: 'plain', shape: 'icon', icon: 'more_vert', ariaLabel: 'More' });
  notif.appendChild(ui.row({ lead: 'dot', media: ui.avatar({ name: 'Harbor Workshop' }), overline: 'Harbor Workshop', title: 'Restoring a 1950s workbench, part one', meta: '2 hours ago', aside: ui.thumb({ context: 'row', duration: 240 }), actions: [more()], href: '#' }));
  notif.appendChild(ui.row({ media: ui.avatar({ name: 'Harbor Lights Radio', kind: 'podcast' }), overline: 'Harbor Lights Radio', title: 'Episode 5: The long way round', meta: 'yesterday', aside: null, actions: [more()], href: '#' }));
  notif.appendChild(ui.row({ lead: 'dot', media: ui.avatar({ name: 'FileTube' }), title: 'A download finished', meta: '3 days ago', aside: ui.thumb({ context: 'row', duration: 1834 }), actions: [null], href: '#' }));
  r.appendChild(notif);
  const settings = ui.list({ size: 'default', grouped: true, media: 'none', aside: 'text', actions: 1, divider: 'inset', label: 'Settings' });
  settings.appendChild(ui.row({ title: 'Autoplay next', meta: 'Plays the next video in the queue', actions: [ui.switch({ checked: true, label: 'Autoplay next' })] }));
  settings.appendChild(ui.row({ title: 'Theme', aside: 'Dark', actions: [ui.icon('chevron_right')], href: '#' }));
  settings.appendChild(ui.row({ title: 'Delete all history', danger: true, onClick: () => ui.confirm({ title: 'Delete all history?', body: 'Your watch history is removed on every device.', confirmLabel: 'Delete', danger: true }) }));
  r.appendChild(settings);

  // ---- forms ----
  const f = section('Forms', 'ui-field, ui-select, ui-switch, ui-segmented: 44px, 16px text (no iOS zoom), a visible focus ring.');
  const grid2 = h('div', 'ui-kit__grid');
  grid2.appendChild(ui.field({ label: 'Channel URL', placeholder: 'https://www.youtube.com/@...', help: 'A channel, playlist or video link.' }).el);
  grid2.appendChild(ui.field({ label: 'Folder name', value: 'Harbor Workshop', error: 'A folder with this name already exists.' }).el);
  grid2.appendChild(ui.select({ label: 'Quality', value: 'best', options: [{ value: 'best', label: 'Best' }, { value: '1080', label: '1080p' }, { value: '720', label: '720p' }] }).el);
  f.appendChild(grid2);
  row(f, [ui.switch({ checked: false, label: 'Off' }), ui.switch({ checked: true, label: 'On' }), ui.switch({ checked: true, label: 'Disabled', disabled: true }),
    ui.segmented({ label: 'Format', value: 'video', options: [{ value: 'video', label: 'Video' }, { value: 'audio', label: 'Audio' }] })]);

  // ---- overlays and feedback ----
  const o = section('Overlays and feedback', 'One sheet primitive (bottom on a phone, popover or dialog on desktop), one toast queue, confirm and prompt instead of the browser dialogs.');
  const menuBtn = ui.button({ variant: 'secondary', icon: 'more_vert', label: 'Menu' });
  menuBtn.addEventListener('click', () => ui.menu({ title: 'Sort by', anchor: menuBtn, items: [
    { icon: 'history', label: 'Newest', value: 'new', checked: true },
    { icon: 'star', label: 'Most viewed', value: 'views' },
    { icon: 'delete', label: 'Delete file', value: 'del', danger: true },
  ], onSelect: (v) => ui.toast('Picked ' + v) }));
  const sheetBtn = ui.button({ variant: 'secondary', label: 'Bottom sheet' });
  sheetBtn.addEventListener('click', () => {
    const body = h('p', 'ui-confirm__body', 'A sheet: grab handle, title, one close button; drag down to dismiss.');
    ui.sheet({ variant: 'bottom', title: 'Harbor Workshop', content: body }).open();
  });
  const confirmBtn = ui.button({ variant: 'danger', label: 'Confirm (danger)' });
  confirmBtn.addEventListener('click', () => ui.confirm({ title: 'Delete this file permanently?', body: 'It cannot be restored.', confirmLabel: 'Delete permanently', danger: true })
    .then((yes) => ui.toast(yes ? 'Deleted' : 'Kept', { kind: yes ? 'success' : 'neutral' })));
  const promptBtn = ui.button({ variant: 'secondary', label: 'Password prompt' });
  promptBtn.addEventListener('click', () => ui.prompt({ title: 'Reset password', label: 'New password', type: 'password', confirmLabel: 'Reset' })
    .then((v) => ui.toast(v ? 'Password set' : 'Cancelled')));
  const toastBtn = ui.button({ variant: 'secondary', label: 'Three toasts' });
  toastBtn.addEventListener('click', () => {
    ui.toast('Added to queue', { action: { label: 'Undo', onAction: () => {} } });
    ui.toast('Saved', { kind: 'success' });
    ui.toast('Check failed', { kind: 'error' });
  });
  const copyBtn = ui.button({ variant: 'tonal', icon: 'content_copy', label: 'Copy a path' });
  copyBtn.addEventListener('click', () => ui.copy('/library/Harbor Workshop/Restoring a 1950s workbench.mp4'));
  row(o, [menuBtn, sheetBtn, confirmBtn, promptBtn, toastBtn, copyBtn]);

  // ---- states ----
  const s = section('Empty, loading and error states', 'One ui-state block; skeletons take the final geometry.');
  const grid3 = h('div', 'ui-kit__grid');
  grid3.appendChild(ui.state({ icon: 'subscriptions', title: 'No subscriptions yet', body: 'Subscribe to a channel and its new videos land here.', action: { label: 'Add a channel', onClick: () => {} } }));
  grid3.appendChild(ui.state({ icon: 'error', title: 'Could not load your books', body: 'The server did not answer.', action: { label: 'Try again', onClick: () => {} } }));
  s.appendChild(grid3);

  // ---- gestures (interaction.js) ----
  if (typeof FTInteraction !== 'undefined') {
    const g = section('Gestures', 'Long-press or right-click the first row for its menu; swipe the second row left (a full swipe dismisses; Delete only from its button, then a confirm).');
    const list = ui.list({ size: 'default', grouped: true, media: 'avatar', aside: 'none', actions: 0, divider: 'inset' });
    const lp = ui.row({ media: ui.avatar({ name: 'Long press' }), title: 'Long-press or right-click me', meta: 'Opens the action menu' });
    const sw2 = ui.row({ media: ui.avatar({ name: 'Swipe' }), title: 'Swipe me left', meta: 'Dismiss (grey) and Delete (red)' });
    list.appendChild(lp);
    list.appendChild(sw2);
    g.appendChild(list);
    FTInteraction.onActionMenu(lp, () => ui.menu({ title: 'Actions', anchor: lp, items: [{ icon: 'playlist_play', label: 'Add to queue', value: 'q' }, { icon: 'share', label: 'Share', value: 's' }], onSelect: (v) => ui.toast('Picked ' + v) }));
    FTInteraction.swipeRow(sw2, {
      fullSwipe: 'dismiss',
      actions: [
        { id: 'dismiss', label: 'Dismiss', kind: 'neutral', onSelect: () => ui.toast('Dismissed') },
        { id: 'delete', label: 'Delete', kind: 'danger', onSelect: () => ui.confirm({ title: 'Delete this file?', confirmLabel: 'Delete', danger: true }).then((yes) => ui.toast(yes ? 'Deleted' : 'Kept')) },
      ],
    });
  }

  if (params.get('open') === 'menu') menuBtn.click();
})();
