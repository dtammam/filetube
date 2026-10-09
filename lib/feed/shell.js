'use strict';

// lib/feed/shell.js - GET /feed serves the History shell with its #view-root, title and view script
// swapped (the lib/cleanup/shell.js pattern, plan D1: the cheaper shell route). Every page shell
// carries the same header, sidebar, bottom nav and player markup, so the feed reuses the one on
// disk; the view's own markup is the length picker and the empty card stack, filled by
// public/js/feed.js. Keeping it here (not in a 13th .html shell) means the byte-identical
// pre-paint scripts and the bottom bar come along for free and never fork.

const VIEW_ROOT = `<div id="view-root" data-view="feed">
        <section class="feed-picker" id="feed-picker" aria-labelledby="feed-picker-title">
          <h2 id="feed-picker-title">Feed</h2>
          <p class="feed-picker-blurb">Your library, one card at a time: the next pages of a book, a few minutes of a podcast, a chapter of a video, a song. Pick how long.</p>
          <div class="feed-picker-choices" id="feed-picker-choices" role="group" aria-label="How long"></div>
          <p class="feed-week" id="feed-week" aria-live="polite"></p>
          <div class="feed-empty" id="feed-empty" hidden></div>
        </section>
        <section class="feed-session" id="feed-session" hidden>
          <div class="feed-stack" id="feed-stack" role="feed" aria-busy="false" aria-label="Your feed"></div>
          <div class="feed-hud" id="feed-hud">
            <button class="ui-btn ui-btn--tonal ui-btn--sm ui-btn--pill" id="feed-done-btn" type="button"><span class="ui-btn__label">Done</span></button>
          </div>
        </section>
      </div>`;

function renderFeedShell(historyHtml) {
  const start = historyHtml.indexOf('<div id="view-root" data-view="history">');
  const end = historyHtml.indexOf('</main>');
  if (start < 0 || end < start) throw new Error('feed shell: the history shell has no #view-root');
  return (historyHtml.slice(0, start) + VIEW_ROOT + '\n    ' + historyHtml.slice(end))
    .replace('<title>History - FileTube</title>', '<title>Feed - FileTube</title>')
    .replace('<script src="/js/history.js"></script>', '<script src="/js/feed.js"></script>');
}

module.exports = { renderFeedShell };
