'use strict';

// v1.43 auth: the client for /login and /welcome. Posts to the auth API,
// shows honest inline errors, redirects on success. Also drives the era
// switcher on the sign-in card (reusing common.js's applyTheme). One file
// serves both pages — it detects which form is present.

(function () {
  // ---- era switcher (the signature flourish; pre-login theming) -----------
  var d = document.documentElement;
  var eraButtons = Array.prototype.slice.call(document.querySelectorAll('.login-era-switch button[data-era]'));
  function syncEraPressed() {
    var current = d.getAttribute('data-theme') || '2021';
    eraButtons.forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-era') === current ? 'true' : 'false');
    });
  }
  eraButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      var era = b.getAttribute('data-era');
      if (typeof window.applyTheme === 'function') {
        window.applyTheme(era, d.getAttribute('data-mode') || 'light');
      } else {
        d.setAttribute('data-theme', era);
        try { localStorage.setItem('ft-era', era); } catch (_) { /* storage off */ }
      }
      syncEraPressed();
    });
  });
  syncEraPressed();

  // ---- custom-logo (white-label) banner on the sign-in card ---------------
  // Dean's request: the login/welcome card shows the configured custom logo
  // (mode-aware light/dark variant), same as the app header. Mirrors
  // common.js's applyCustomLogoIfSet but targets the login card. The server
  // pre-stamps html.ft-custom-logo (no flash); this sets the image src and
  // self-heals to the text wordmark on a 404/decode failure.
  (function applyLoginLogo() {
    if (typeof fetch !== 'function') return;
    var wordmark = document.querySelector('.login-wordmark');
    var img = wordmark && wordmark.querySelector('.login-logo-img');
    if (!img) return;
    var isDark = d.getAttribute('data-mode') === 'dark';
    var url = isDark ? '/logo?variant=dark' : '/logo';
    var clear = function () {
      d.classList.remove('ft-custom-logo');
      try { localStorage.removeItem('ft-custom-logo'); } catch (_) { /* storage off */ }
    };
    fetch(url, { method: 'HEAD' }).then(function (r) {
      if (!r || !r.ok) { clear(); return; } // no custom logo -> text wordmark stays
      d.classList.add('ft-custom-logo');
      try { localStorage.setItem('ft-custom-logo', '1'); } catch (_) { /* storage off */ }
      img.onerror = clear; // confirmed present but won't decode -> restore text
      img.removeAttribute('hidden');
      img.src = url;
    }).catch(function () { /* offline: leave whatever the pre-paint stamp chose */ });
  })();

  // ---- shared post helper -------------------------------------------------
  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // A friendly line per known failure — never a raw status code, never a
  // stack. The server sends { error } for the specifics; these cover the
  // shapes the pages care about.
  function messageFor(status, payload) {
    if (status === 429) {
      var retry = payload && payload.retryAfterSec;
      return retry ? 'Too many attempts. Try again in about ' + retry + ' seconds.'
        : 'Too many attempts. Please wait a moment and try again.';
    }
    if (status === 401) return 'That username or password is not right.';
    if (payload && payload.error) return payload.error;
    return 'Something went wrong. Please try again.';
  }

  function wire(formId, errorId, submitId, handler) {
    var form = document.getElementById(formId);
    if (!form) return;
    var errorEl = document.getElementById(errorId);
    var submitEl = document.getElementById(submitId);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.textContent = '';
      submitEl.disabled = true;
      var restore = function () { submitEl.disabled = false; };
      handler(form, errorEl, restore).catch(function () {
        errorEl.textContent = 'Something went wrong. Please try again.';
        restore();
      });
    });
  }

  // ---- /login -------------------------------------------------------------
  wire('login-form', 'login-error', 'login-submit', function (form, errorEl, restore) {
    var username = form.username.value.trim();
    var password = form.password.value;
    if (!username || !password) {
      errorEl.textContent = 'Enter your username and password.';
      restore();
      return Promise.resolve();
    }
    return postJson('/api/auth/login', { username: username, password: password }).then(function (res) {
      if (res.ok) {
        // Server set the session cookie; go to the library (or the page the
        // user was headed to, if the server passed a safe `next`).
        window.location.assign(safeNext());
        return;
      }
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (res.status === 409 && payload && payload.needsSetup) {
          window.location.assign('/welcome');
          return;
        }
        errorEl.textContent = messageFor(res.status, payload);
        restore();
      });
    });
  });

  // ---- /welcome (create admin) --------------------------------------------
  wire('welcome-form', 'welcome-error', 'welcome-submit', function (form, errorEl, restore) {
    var username = form.username.value.trim();
    var displayName = form.displayName.value.trim();
    var password = form.password.value;
    var confirm = form.confirm.value;
    if (!username || !password) {
      errorEl.textContent = 'Choose a username and a password.';
      restore();
      return Promise.resolve();
    }
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) {
      errorEl.textContent = 'Username can use letters, numbers, and . _ - (up to 64 characters).';
      restore();
      return Promise.resolve();
    }
    if (password.length < 8) {
      errorEl.textContent = 'Use a password of at least 8 characters.';
      restore();
      return Promise.resolve();
    }
    if (password !== confirm) {
      errorEl.textContent = 'The two passwords do not match.';
      restore();
      return Promise.resolve();
    }
    return postJson('/api/auth/setup', { username: username, displayName: displayName, password: password }).then(function (res) {
      if (res.ok) {
        window.location.assign('/');
        return;
      }
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (res.status === 409) {
          // Someone already set up (or a race lost) — send them to sign in.
          window.location.assign('/login');
          return;
        }
        errorEl.textContent = messageFor(res.status, payload);
        restore();
      });
    });
  });

  // Only ever return a SAME-ORIGIN, root-relative path — never an
  // attacker-supplied absolute URL (open-redirect guard).
  function safeNext() {
    try {
      var params = new URLSearchParams(window.location.search);
      var next = params.get('next');
      if (next && /^\/[^/]/.test(next) && !next.startsWith('//')) return next;
    } catch (_) { /* fall through */ }
    return '/';
  }
})();
