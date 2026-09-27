// ui-lint-canary: path=public/js/main.js expect=4
/* eslint-disable */
el.addEventListener('contextmenu', onMenu);
el.oncontextmenu = onMenu;
el.style.webkitUserSelect = 'none';
el.innerHTML = '<div class="ui-selectable">x</div>';
