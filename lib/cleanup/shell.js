'use strict';

// lib/cleanup/shell.js - GET /cleanup serves the History shell with its #view-root, title and view
// script swapped. Every page shell carries the same header, sidebar, bottom nav and player markup;
// a second copy would double the ui-lint debt for it, so this page reuses the one on disk.

const VIEW_ROOT = `<div id="view-root" data-view="cleanup">
        <div class="cleanup-toolbar">
          <h2>Clean up</h2>
          <div class="cleanup-toolbar-actions">
            <span class="cleanup-summary" id="cleanup-summary" aria-live="polite"></span>
            <button class="ui-btn ui-btn--tonal ui-btn--sm ui-btn--pill" id="cleanup-trash-btn" type="button" disabled><span class="ui-btn__icon"><svg class="ui-icon ui-icon--sm" aria-hidden="true" focusable="false"><use href="#i-delete"/></svg></span><span class="ui-btn__label">Move to Trash</span></button>
          </div>
        </div>
        <p class="cleanup-blurb">A shortlist of things you could clear to free up space. Nothing is removed until you pick it and confirm, and everything goes to Trash first, where you can restore it.</p>
        <div class="cleanup-days" id="cleanup-days"></div>
        <div id="cleanup-groups" class="cleanup-groups" aria-live="polite"></div>
      </div>`;

function renderCleanupShell(historyHtml) {
  const start = historyHtml.indexOf('<div id="view-root" data-view="history">');
  const end = historyHtml.indexOf('</main>');
  if (start < 0 || end < start) throw new Error('cleanup shell: the history shell has no #view-root');
  return (historyHtml.slice(0, start) + VIEW_ROOT + '\n    ' + historyHtml.slice(end))
    .replace('<title>History - FileTube</title>', '<title>Clean up - FileTube</title>')
    .replace('<script src="/js/history.js"></script>', '<script src="/js/cleanup.js"></script>');
}

module.exports = { renderCleanupShell };
