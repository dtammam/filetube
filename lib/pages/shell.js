'use strict';

// lib/pages/shell.js - GET /pages serves the History shell with its #view-root, title and view
// script swapped (the lib/feed/shell.js pattern): the header, sidebar, bottom nav, player markup
// and the byte-identical pre-paint scripts come from the one shell on disk and never fork. The
// view's own markup is the library (toolbar, the view chips, the list) and the item reader, both
// filled by public/js/pages.js; `/pages?id=<item>` opens one item in the same view.

const VIEW_ROOT = `<div id="view-root" data-view="pages">
        <section class="pages-library" id="pages-library" aria-labelledby="pages-title">
          <div class="pages-toolbar">
            <h2 id="pages-title">Pages</h2>
            <div class="pages-toolbar-actions">
              <button class="ui-btn ui-btn--primary ui-btn--sm ui-btn--pill" id="pages-add-btn" type="button"><span class="ui-btn__icon"><svg class="ui-icon ui-icon--sm" aria-hidden="true" focusable="false"><use href="#i-add"/></svg></span><span class="ui-btn__label">Add</span></button>
            </div>
          </div>
          <div class="pages-search ui-field">
            <input class="ui-field__input" id="pages-search" type="search" placeholder="Search your pages" aria-label="Search your pages" autocomplete="off">
          </div>
          <div class="pages-views" id="pages-views" role="group" aria-label="Show"></div>
          <div class="pages-list-actions" id="pages-list-actions" hidden></div>
          <p class="pages-trash-note" id="pages-trash-note" hidden>Pages in the trash are deleted after 30 days.</p>
          <div id="pages-list" class="pages-list ui-list ui-list--lead ui-list--media ui-list--media-thumb ui-list--aside-none ui-list--actions-1 ui-list--divider-inset" role="list" aria-label="Saved pages"></div>
          <div class="pages-empty" id="pages-empty" hidden></div>
          <div class="pages-more-wrap">
            <button class="ui-btn ui-btn--secondary ui-btn--md ui-btn--pill" id="pages-loadmore" type="button" hidden><span class="ui-btn__label">Load more</span></button>
          </div>
        </section>
        <article class="pages-item" id="pages-item" hidden aria-live="polite"></article>
      </div>`;

function renderPagesShell(historyHtml) {
  const start = historyHtml.indexOf('<div id="view-root" data-view="history">');
  const end = historyHtml.indexOf('</main>');
  if (start < 0 || end < start) throw new Error('pages shell: the history shell has no #view-root');
  return (historyHtml.slice(0, start) + VIEW_ROOT + '\n    ' + historyHtml.slice(end))
    .replace('<title>History - FileTube</title>', '<title>Pages - FileTube</title>')
    .replace('<script src="/js/history.js"></script>', '<script src="/js/pages.js"></script>');
}

module.exports = { renderPagesShell, VIEW_ROOT };
