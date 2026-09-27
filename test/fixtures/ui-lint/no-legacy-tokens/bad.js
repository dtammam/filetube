// ui-lint-canary: path=public/js/canary.js expect=2
/* eslint-disable */
el.innerHTML = '<i style="color: var(--text-link)"></i>';
const v = getComputedStyle(el).getPropertyValue('--btn-bg');
