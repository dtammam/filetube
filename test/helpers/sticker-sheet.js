'use strict';

// Shared accessors for the STICKER SHEET (v1.388.0, plan 2026-10-12-sticker-sheet). The sticker no longer owns a menu inside the
// player panel: it opens a ui.sheet on <body> (skin-surface.js openStickerSheet), whose content node is
// [data-skin-sticker-menu]. Every suite that drove the old popover reads it through these, so the question "is it open, and
// what page is it on" has ONE spelling. A test harness must give the window the real `ui` (ui.js) before the sticker is tapped:
// installUi(dom) does it (the sheet is built with ui.js builders; without them the tap opens nothing).

const settle = () => new Promise((resolve) => setImmediate(resolve));

// the open sheet (a closing one - ui.sheet marks it `is-closing` while it slides out - is no longer "open")
const sheetOf = (dom) => dom.window.document.querySelector('.mms-ss-root:not(.is-closing)');
// the content node of the open sheet, or null when no sheet is open
const menuOf = (dom) => { const s = sheetOf(dom); return s ? s.querySelector('[data-skin-sticker-menu]') : null; };
const isOpen = (dom) => !!sheetOf(dom);
const clickEl = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const panelOf = (dom) => dom.window.document.getElementById('music-nowplaying-panel');
const stickerOf = (dom) => panelOf(dom).querySelector('.mms-sticker[data-skin-sticker]');
// a control anywhere in the open sheet (the header's Back / Home / Channel live outside the content node)
const inSheet = (dom, sel) => { const s = sheetOf(dom); return s ? s.querySelector(sel) : null; };

// give a jsdom window the real ui.js + icon registry (the sheet's builders). `extra` overrides ui members (a held confirm).
function installUi(dom, extra) {
  const uiPath = require.resolve('../../public/js/ui.js');
  delete require.cache[uiPath];
  dom.window.ui = Object.assign({}, require('../../public/js/ui.js'), extra || {});
  dom.window.FTIcons = require('../../public/js/icons.js');
  return dom.window.ui;
}

// tap the sticker (opening the sheet) and let the open-time item load settle
async function openSheet(dom, rounds) {
  if (!isOpen(dom)) clickEl(dom, stickerOf(dom));
  for (let i = 0; i < (rounds || 6); i++) await settle();
  return menuOf(dom);
}
// open the sheet and go to its More page
async function openMore(dom, rounds) {
  await openSheet(dom, rounds);
  const more = inSheet(dom, '[data-skin-more]');
  if (!more) throw new Error('the sheet has no More tile');
  clickEl(dom, more);
  for (let i = 0; i < (rounds || 6); i++) await settle();
  return menuOf(dom);
}
async function closeSheet(dom) {
  const s = sheetOf(dom);
  if (!s) return;
  const x = s.querySelector('.ui-sheet__close');
  if (x) clickEl(dom, x);
  await settle();
}

module.exports = { settle, sheetOf, menuOf, isOpen, clickEl, panelOf, stickerOf, inSheet, installUi, openSheet, openMore, closeSheet };
