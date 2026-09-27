// ui-lint-canary: path=public/js/canary.js expect=3
/* eslint-disable */
const b = document.createElement('button');
b.className = 'legacy-btn';
el.innerHTML = '<button class="btn">Go</button>';
document.body.append(document.createElement('button'));
