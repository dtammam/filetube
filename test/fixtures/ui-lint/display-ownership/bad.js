// ui-lint-canary: path=public/js/canary.js expect=4
/* eslint-disable */
el.style.display = 'none';
el.style.display = on ? 'flex' : '';
el.style.setProperty('display', 'block');
el.style.cssText = 'display:block';
