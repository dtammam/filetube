// ui-lint-canary: path=public/js/canary.js expect=2
/* eslint-disable */
el.style.left = '8px'; // token-exempt: a line comment
el.style.top = '8px'; /* token-exempt: a block comment */
