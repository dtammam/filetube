'use strict';

// v1.43 auth: the client for /login and /welcome. Posts to the auth API,
// shows honest inline errors, redirects on success. Also drives the era
// switcher on the sign-in card (reusing common.js's applyTheme). One file
// serves both pages — it detects which form is present.

// v1.352 W1: where a successful sign-in goes. `next` (the page the gate bounced) is resolved by the
// real URL parser and kept only when it lands on THIS origin: a prefix check let `/\evil.example` and
// `/<TAB>/evil.example` through, which a browser reads as //evil.example (an open redirect).
// The returned path is resolved again before it is trusted (see below).
function safeNextFrom(search, origin) {
  try {
    var next = new URLSearchParams(search || '').get('next');
    if (!next || next.charAt(0) !== '/') return '/';
    var u = new URL(next, origin);
    if (u.origin !== origin) return '/';
    var out = u.pathname + u.search + u.hash;
    // a same-origin URL can still have a path that STARTS with // (/.//evil resolves to the path
    // //evil), which leaves the origin when assigned: the value handed to location must resolve here too
    if (new URL(out, origin).origin !== origin) return '/';
    return out;
  } catch (_) { return '/'; }
}
if (typeof module === 'object' && module.exports) module.exports = { safeNextFrom: safeNextFrom };

if (typeof document !== 'undefined') (function () {
  // ---- era switcher (the signature flourish; pre-login theming) -----------
  // Sweep S8: the switcher is a ui-segmented radiogroup. The page ships its static markup
  // (the same classes, so the first paint already has the right shape); ui.segmented then
  // takes it over for the checked state, roving focus and arrow keys. Without ui.js the
  // static buttons still switch the era.
  var d = document.documentElement;
  function applyEra(era) {
    if (typeof window.applyTheme === 'function') {
      window.applyTheme(era, d.getAttribute('data-mode') || 'light');
    } else {
      d.setAttribute('data-theme', era);
      try { localStorage.setItem('ft-era', era); } catch (_) { /* storage off */ }
    }
  }
  var staticSeg = document.querySelector('.login-era-switch .ui-segmented');
  if (staticSeg) {
    var current = d.getAttribute('data-theme') || '2021';
    var items = Array.prototype.slice.call(staticSeg.querySelectorAll('[data-era]'));
    if (window.ui && typeof window.ui.segmented === 'function') {
      var seg = window.ui.segmented({
        label: 'Theme era',
        value: current,
        options: items.map(function (b) { return { value: b.getAttribute('data-era'), label: b.textContent }; }),
        onChange: applyEra,
      });
      seg.setAttribute('aria-labelledby', staticSeg.getAttribute('aria-labelledby') || '');
      seg.removeAttribute('aria-label');
      Array.prototype.forEach.call(seg.querySelectorAll('.ui-segmented__item'), function (b) {
        b.setAttribute('data-era', b.getAttribute('data-value'));
      });
      staticSeg.replaceWith(seg);
    } else {
      var sync = function () {
        var era = d.getAttribute('data-theme') || '2021';
        items.forEach(function (b) {
          var on = b.getAttribute('data-era') === era;
          b.setAttribute('aria-checked', on ? 'true' : 'false');
          b.setAttribute('tabindex', on ? '0' : '-1');
        });
      };
      items.forEach(function (b) {
        b.addEventListener('click', function () { applyEra(b.getAttribute('data-era')); sync(); });
      });
      sync();
    }
  }

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
        // v1.53 gate W4: a fresh login clears any previous user's capability
        // cache in this tab (covers crash-logouts that never ran the setup
        // page's own clear -- every login flows through here).
        try { sessionStorage.removeItem('ft-cap-cache-v1'); } catch (_) { /* storage disabled */ }
        // v1.101 gate SUGGESTION: also drop the per-DEVICE reveal-once reserve
        // keys (v1.99 avatar-bar count + v1.101 bell-enabled). accountSignOut
        // clears them on an EXPLICIT sign-out, but a session-expiry / crash-logout
        // lands here WITHOUT one, so a fresh login is the catch-all that stops
        // user B from inheriting user A's reserved avatar-strip / bell slot on a
        // shared browser.
        try { localStorage.removeItem('ft-modern-avatarbar-count'); } catch (_) { /* storage disabled */ }
        try { localStorage.removeItem('ft-notif-bell-enabled'); } catch (_) { /* storage disabled */ }
        // v1.339 (L2): the per-user pre-paint reserves too (common.js accountSignOut's list).
        try { localStorage.removeItem('ft-queue-shown'); } catch (_) { /* storage disabled */ }
        try { localStorage.removeItem('ft-bottomnav-last'); } catch (_) { /* storage disabled */ }
        try { localStorage.removeItem('ft-books-continue-count'); } catch (_) { /* storage disabled */ }
        // v1.356 gate r1: the phone's remembered speaker and the per-tab pick (remote.js RESUME_KEY / CONTROL_KEY)
        // belong to whoever was signed in before; a session that expired never ran accountSignOut.
        try { localStorage.removeItem('ft-remote-resume'); } catch (_) { /* storage disabled */ }
        try { sessionStorage.removeItem('ft-remote-controlling'); } catch (_) { /* storage disabled */ }
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
    return safeNextFrom(window.location.search, window.location.origin);
  }
})();
