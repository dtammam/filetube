'use strict';

// lib/auth/routes.js - the IDENTITY routes: sign-in/sign-out and the current
// user (/api/auth), admin user management (/api/users), and the per-user
// self-service surfaces (/api/me - the display-pref mirror, the profile photo,
// the player sticker). Moved VERBATIM out of server.js in Wave 7b, slice S1b,
// of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md): the bodies are byte-identical to
// the server.js originals and keep their source order, group by group, with
// their free identifiers resolving from the `deps` bundle server.js hands in
// at each call site - the lib/ytdlp + lib/podcasts registerRoutes pattern. A
// missing dep is a hard failure (a destructured undefined that is later
// called throws), never a silent fallback.
//
// THREE registration functions, not one, because this group STRADDLES the
// shell wildcard. server.js registers `app.get('*')` (the SPA shell) and the
// static layer part-way down; the 15 identity routes below are ahead of both
// (their routing-signature prefix is the short one), while the avatar and
// sticker image routes are behind them. scripts/route-order-signature.js is
// the instrument: each route must keep exactly the layers it had ahead of it,
// so each function's call sits exactly where its first route was registered,
// and the avatar/sticker constants (declared between those two call sites)
// stay in server.js rather than being read before their own declaration.
//
// What moved WITH the routes (verified group-private by an espree reference
// census across server.js - no other top-level statement reads them): the
// login dummy hash, the settings-mirror allowlist and the new-account default,
// the username/password rule messages, the restriction enums, and the
// resolveTargetUser / wouldRemoveLastAdmin / readAccessMode / unitRows
// helpers. They live INSIDE registerRoutes because they close over `deps`
// (userStore, authCrypto, glyphPool). What did NOT move: requireAdmin,
// publicUser, issueSessionCookie and the avatar/sticker helpers - each has a
// reader outside this group (other routes, __mintTestSession,
// POST /api/admin/restore), so they cross in through `deps` instead.

// The 15 identity routes registered AHEAD of the shell wildcard + static layer.
function registerRoutes(app, deps) {
  const {
    authCrypto,
    avatarInfo, // GET /api/auth/me merges the profile photo's presence + cache-bust version
    booksDb,
    clearSessionCookie,
    dropPendingProgressForUser, // the user-delete cascade drops that user's staged pings first
    glyphPool, // LIBRARY_GLYPH_SLOTS - the mirrored-settings allowlist spreads from the registry
    issueSessionCookie,
    likedStore,
    loginRateLimiter,
    progressStore,
    publicUser, // the safe projection of a user row (never the password hash)
    rateKey, // the (ip, username) login-rate bucket key
    requireAdmin,
    unlinkAvatar, // the user-delete cascade: no orphaned profile image / sticker
    unlinkSticker,
    userStore,
    ytdlpDb,
  } = deps;

  // POST /api/auth/setup — one-time create-admin. Allowlisted ONLY while zero
  // users exist (the gate 409s it otherwise). Adopts the pre-auth global
  // state into the new admin (design-delta WARNING-4: hash async FIRST, then
  // the count-guarded insert + adoption in one synchronous transaction).
  app.post('/api/auth/setup', async (req, res) => {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const limit = loginRateLimiter.take(rateKey(req, username));
    if (!limit.allowed) return res.status(429).json({ error: 'too many attempts', retryAfterSec: limit.retryAfterSec });
    if (!userStore.validateUsername(username)) return res.status(400).json({ error: 'Username can use letters, numbers, and . _ - (up to 64 characters).' });
    if (password.length < authCrypto.MIN_PASSWORD_LENGTH) return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
    try {
      const passwordHash = await authCrypto.hashPassword(password); // async: off the event loop
      // Read the pre-auth global state to adopt (once, before the tx).
      const books = booksDb.read();
      const ytd = ytdlpDb.read(['pins']); // Wave 5: the frozen pre-auth channel pins, from their table
      const adoption = {
        progress: progressStore.getAll(), // Wave 2: the frozen pre-auth positions, from their table
        liked: likedStore.list(), // Wave 4: the frozen likes, from their table (like order)
        bookProgress: books.progress || {},
        bookPins: Array.isArray(books.pins) ? books.pins : [],
        channelPins: Array.isArray(ytd.pins) ? ytd.pins : [],
      };
      const admin = userStore.createFirstAdmin({ username, displayName, passwordHash }, adoption, new Date().toISOString());
      if (!admin) return res.status(409).json({ error: 'setup already complete' });
      userStore.setSettingsJson(admin.id, NEW_USER_DEFAULT_SETTINGS); // v1.79: net-new setup -> feed on
      loginRateLimiter.refund(rateKey(req, username));
      issueSessionCookie(res, req, admin);
      return res.json({ success: true, user: publicUser(admin) });
    } catch (err) {
      console.error('Error in /api/auth/setup:', err);
      return res.status(500).json({ error: `Could not create the admin account: ${err.message}` });
    }
  });

  // POST /api/auth/login — verify credentials, set the session cookie. Honest
  // timing: always run a hash (a dummy for an unknown user) so a missing
  // username doesn't return faster than a wrong password (user-enumeration
  // timing guard).
  const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  app.post('/api/auth/login', async (req, res) => {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const key = rateKey(req, username);
    const limit = loginRateLimiter.take(key);
    if (!limit.allowed) return res.status(429).json({ error: 'too many attempts', retryAfterSec: limit.retryAfterSec });
    try {
      const user = username ? userStore.getByUsername(username) : null;
      const hash = user ? userStore.getPasswordHash(user.id) : DUMMY_HASH;
      const result = await authCrypto.verifyPassword(password, hash || DUMMY_HASH);
      if (!user || user.disabled || !result.ok) {
        return res.status(401).json({ error: 'That username or password is not right.' });
      }
      // Params-upgrade-on-login: re-hash at current cost if the stored hash lags.
      if (result.needsRehash) {
        try { userStore.updatePassword(user.id, await authCrypto.hashPassword(password)); } catch (_) { /* non-fatal */ }
      }
      const fresh = userStore.getById(user.id); // pick up any tv bump from the rehash
      loginRateLimiter.refund(key);
      issueSessionCookie(res, req, fresh);
      return res.json({ success: true, user: publicUser(fresh) });
    } catch (err) {
      console.error('Error in /api/auth/login:', err);
      return res.status(500).json({ error: `Sign-in failed: ${err.message}` });
    }
  });

  // POST /api/auth/logout — clear the cookie (gated: you must be signed in).
  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res);
    return res.json({ success: true });
  });

  // GET /api/auth/me — the current user (gated). Powers the Settings Account
  // chip + client "am I logged in / am I admin" checks. `settings` is the
  // user's mirrored display prefs (settings_json) — the device-sync source a
  // FRESH device pulls from before localStorage has anything (locked intake
  // #6: localStorage stays the immediate, device-local source of truth).
  app.get('/api/auth/me', (req, res) => {
    // v1.82: the account menu reads `user.avatar` to render the photo (or fall
    // back to an initials monogram). Kept off publicUser (which stays a pure
    // projection) and merged here where the fs lookup belongs.
    return res.json({
      user: { ...publicUser(req.user), avatar: avatarInfo(req.user.id) },
      settings: parseUserSettings(req.user),
    });
  });

  function parseUserSettings(user) {
    try {
      const parsed = JSON.parse(user.settingsJson || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  // POST /api/me/settings — mirror a display pref (theme/era/icons) onto the
  // user record. Fire-and-forget from the client pickers; localStorage stays
  // the device-local fast path, this is only the cross-device seed. Keys are
  // allowlisted and values bounded — settings_json must never become an
  // arbitrary client-writable blob.
  // v1.63.1: 'starRatings' ('shown'|'hidden') - Dean's hide-the-fake-stars
  // toggle rides the same display-pref mirror as theme/era/icons.
  // v1.66: 'pushEnabled' ('on'|'off') - the PER-USER push opt-out (ruling:
  // per-device subscribe, per-user opt-out). Delivery honors only the literal
  // 'off' (lib/push/deliver.js pushOptedOut); absent = on.
  // v1.67: cornerTL/TR/BL are the card-corner controls (Dean's ruling C1:
  // per-user SERVER-persisted; the server is the truth, not a device seed).
  // v1.204: cornerBR joined them - the bottom-right corner became selectable
  // too (it shares its space with the duration badge, which slides left when
  // the slot is occupied). Values are enum-ish control names; the lane stays
  // SHAPE-only like its siblings and the card renderer defends against
  // unknown values (plan D1).
  // v1.77: the Library-entry glyph keys (glyphDownloads/Music/Books/Podcasts/
  // History) join on the same per-user SERVER-persisted footing as the corners.
  // SPREAD FROM THE REGISTRY, never re-typed - a slot added to
  // LIBRARY_GLYPH_SLOTS becomes writable here automatically, so the picker can
  // never offer an entry whose saves the server silently 400s. The lane stays
  // SHAPE-only like its siblings (the existing value regex below already bounds
  // these to registry-id shape) and the client resolver defends against unknown
  // values, exactly as the card renderer does.
  const MIRRORED_SETTING_KEYS = new Set([
    'theme', 'era', 'icons', 'starRatings', 'pushEnabled', 'cornerTL', 'cornerTR', 'cornerBL', 'cornerBR',
    // v1.79: the home-feed vs classic-grid toggle. Stored as the bounded string
    // 'on'/'off' like pushEnabled/starRatings (the value regex below bounds it).
    'homeFeed',
    // v1.84: Modern YouTube Mode - a third home layout (flat big-tile grid +
    // chips + mobile avatar bar). Same bounded 'on'/'off' string; absent => off.
    'modernMode',
    // Wave G master toggle - RETIRED in v1.242 (audio now projects unconditionally).
    // Intentionally RETAINED in the allowlist so a stale client's POST still 200s;
    // NOTHING reads it any more (inert - do not gate behavior on it).
    'musicIncludesLibrary',
    ...glyphPool.LIBRARY_GLYPH_SLOTS.map((s) => s.key),
  ]);

  // v1.79: net-new setups/accounts get the YouTube-style home feed out of the
  // box (Dean's intake default), while existing installs are UNCHANGED - the
  // store's settings_json default stays '{}', which the client resolves to
  // classic (absent => off). Only the two PRODUCT creation flows seed this; the
  // test-session mint (__mintTestSession) deliberately does NOT, so existing
  // suites that assume an empty settings_json are unaffected.
  const NEW_USER_DEFAULT_SETTINGS = { homeFeed: 'on' };
  app.post('/api/me/settings', (req, res) => {
    const body = req.body || {};
    const merged = parseUserSettings(req.user);
    for (const key of Object.keys(body)) {
      if (!MIRRORED_SETTING_KEYS.has(key)) {
        return res.status(400).json({ error: `unknown setting '${key}'` });
      }
      const value = body[key];
      if (value === null) {
        delete merged[key]; // explicit null clears the mirror (pref reset)
        continue;
      }
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(value)) {
        return res.status(400).json({ error: `invalid value for '${key}'` });
      }
      merged[key] = value;
    }
    userStore.setSettingsJson(req.user.id, merged);
    return res.json({ success: true, settings: merged });
  });

  // ---- v1.43 chunk 4c: admin user management --------------------------------
  // requireAdmin (and its requireManageSubscriptions / requireModifyLibrary
  // siblings) stayed in server.js - routes outside this group gate on them -
  // so the admin routes below reach it through `deps`.

  // The self-lockout guard for user management: refuse any change that would
  // leave the instance with ZERO enabled admins (disable/demote/delete of the
  // last one). Instant revocation (token_version bumps) makes such a mistake
  // unrecoverable from the UI — there would be nobody left who can undo it.
  function wouldRemoveLastAdmin(targetId, change) {
    const target = userStore.getById(targetId);
    if (!target) return false; // 404s elsewhere
    const isEnabledAdmin = target.role === 'admin' && !target.disabled;
    if (!isEnabledAdmin) return false;
    const enabledAdmins = userStore.listUsers().filter((u) => u.role === 'admin' && !u.disabled);
    if (enabledAdmins.length > 1) return false;
    return change === 'disable' || change === 'demote' || change === 'delete';
  }

  const USERNAME_RULE_MESSAGE = 'Username can use letters, numbers, and . _ - (up to 64 characters).';
  const PASSWORD_RULE_MESSAGE = `Use a password of at least ${authCrypto.MIN_PASSWORD_LENGTH} characters.`;

  app.get('/api/users', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ users: userStore.listUsers() });
  });

  app.post('/api/users', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const role = body.role === 'admin' ? 'admin' : 'member';
    const canManageSubscriptions = body.canManageSubscriptions === true;
    // v1.81 write-RBAC: strict boolean coercion (AC8) - a truthy string/1/[] can
    // never grant the capability. Default OFF when absent.
    const canModifyLibrary = body.canModifyLibrary === true;
    if (!userStore.validateUsername(username)) return res.status(400).json({ error: USERNAME_RULE_MESSAGE });
    if (password.length < authCrypto.MIN_PASSWORD_LENGTH) return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
    if (userStore.getByUsername(username)) return res.status(409).json({ error: 'That username is already taken.' });
    try {
      const passwordHash = await authCrypto.hashPassword(password); // async: off the event loop
      // The UNIQUE(username COLLATE NOCASE) constraint is the race backstop
      // behind the friendly pre-check above.
      const user = userStore.createUser({ username, displayName, passwordHash, role, canManageSubscriptions, canModifyLibrary }, new Date().toISOString());
      userStore.setSettingsJson(user.id, NEW_USER_DEFAULT_SETTINGS); // v1.79: net-new account -> feed on
      return res.status(201).json({ success: true, user: publicUser(user) });
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'That username is already taken.' });
      }
      console.error('Error creating user:', err);
      return res.status(500).json({ error: `Could not create the user: ${err.message}` });
    }
  });

  // Shared target resolution: integer id, existing row.
  function resolveTargetUser(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid user id' });
      return null;
    }
    const target = userStore.getById(id);
    if (!target) {
      res.status(404).json({ error: 'No such user.' });
      return null;
    }
    return target;
  }

  app.post('/api/users/:id/password', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const target = resolveTargetUser(req, res);
    if (!target) return;
    const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < authCrypto.MIN_PASSWORD_LENGTH) return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
    try {
      const passwordHash = await authCrypto.hashPassword(password);
      userStore.updatePassword(target.id, passwordHash); // bumps token_version -> every session revoked
      // Resetting YOUR OWN password revokes your own cookie too — reissue it
      // so the admin doing the reset is not bounced to /login mid-task.
      if (target.id === req.user.id) {
        issueSessionCookie(res, req, userStore.getById(target.id));
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Error resetting password:', err);
      return res.status(500).json({ error: `Could not reset the password: ${err.message}` });
    }
  });

  app.post('/api/users/:id/disabled', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const target = resolveTargetUser(req, res);
    if (!target) return;
    const disabled = req.body && req.body.disabled === true;
    if (disabled && target.id === req.user.id) {
      return res.status(409).json({ error: 'You cannot disable your own account.' });
    }
    if (disabled && wouldRemoveLastAdmin(target.id, 'disable')) {
      return res.status(409).json({ error: 'That is the last enabled admin - disable is refused so the instance cannot lock itself out.' });
    }
    userStore.setDisabled(target.id, disabled); // bumps token_version -> instant revocation on disable
    return res.json({ success: true, user: publicUser(userStore.getById(target.id)) });
  });

  app.post('/api/users/:id/role', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const target = resolveTargetUser(req, res);
    if (!target) return;
    const role = req.body && req.body.role;
    if (role !== 'admin' && role !== 'member') return res.status(400).json({ error: "role must be 'admin' or 'member'" });
    if (role === 'member' && wouldRemoveLastAdmin(target.id, 'demote')) {
      return res.status(409).json({ error: 'That is the last enabled admin - demotion is refused so the instance cannot lock itself out.' });
    }
    userStore.setRole(target.id, role);
    return res.json({ success: true, user: publicUser(userStore.getById(target.id)) });
  });

  app.post('/api/users/:id/subscriptions-flag', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const target = resolveTargetUser(req, res);
    if (!target) return;
    userStore.setCanManageSubscriptions(target.id, req.body && req.body.canManageSubscriptions === true);
    return res.json({ success: true, user: publicUser(userStore.getById(target.id)) });
  });

  // v1.81 write-RBAC: admin grants/revokes a user's library-WRITE capability.
  // Mirrors subscriptions-flag exactly (admin-only, strict boolean, self-safe -
  // nothing here can lock the instance out since admins bypass the flag anyway).
  app.post('/api/users/:id/modify-library-flag', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const target = resolveTargetUser(req, res);
    if (!target) return;
    userStore.setCanModifyLibrary(target.id, req.body && req.body.canModifyLibrary === true);
    return res.json({ success: true, user: publicUser(userStore.getById(target.id)) });
  });

  // v1.80 RBAC: admin management of a user's library restrictions (blocklist).
  const VALID_RESTRICTION_KINDS = new Set(['path', 'folder', 'show', 'library']);
  const VALID_LIBRARY_VALUES = new Set(['video', 'music', 'podcasts', 'books', 'tv']);
  const RESTRICTION_VALUE_MAX = 4096;

  // The stored mode is carried as a distinguished row {kind:'mode'} (no extra
  // schema); these helpers separate it from the unit rows at the API boundary.
  function readAccessMode(rows) {
    return rows.some((r) => r.kind === 'mode' && r.value === 'allowlist') ? 'allowlist' : 'blocklist';
  }
  function unitRows(rows) {
    return rows.filter((r) => r.kind !== 'mode');
  }

  app.get('/api/users/:id/restrictions', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const target = resolveTargetUser(req, res);
    if (!target) return;
    const rows = userStore.getRestrictions(target.id);
    return res.json({ mode: readAccessMode(rows), restrictions: unitRows(rows) });
  });

  // Replace a user's ENTIRE access config (the admin UI PUTs the desired set):
  //   { mode: 'blocklist'|'allowlist', restrictions: [{kind, value}, ...] }
  // mode 'blocklist' (default) => the listed units are BLOCKED; 'allowlist' => the
  // user sees ONLY the listed units (Dean's kid-account belt-and-suspenders).
  app.put('/api/users/:id/restrictions', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const target = resolveTargetUser(req, res);
    if (!target) return;
    const body = req.body || {};
    const mode = body.mode === undefined ? 'blocklist' : body.mode;
    if (mode !== 'blocklist' && mode !== 'allowlist') {
      return res.status(400).json({ error: `invalid mode '${mode}'` });
    }
    const rows = Array.isArray(body.restrictions) ? body.restrictions : null;
    if (!rows) return res.status(400).json({ error: 'restrictions must be an array' });
    const clean = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') return res.status(400).json({ error: 'each restriction must be an object' });
      if (!VALID_RESTRICTION_KINDS.has(r.kind)) return res.status(400).json({ error: `invalid restriction kind '${r.kind}'` });
      if (typeof r.value !== 'string' || r.value === '' || r.value.length > RESTRICTION_VALUE_MAX) {
        return res.status(400).json({ error: 'invalid restriction value' });
      }
      if (r.kind === 'library' && !VALID_LIBRARY_VALUES.has(r.value)) {
        return res.status(400).json({ error: `invalid library '${r.value}'` });
      }
      clean.push({ kind: r.kind, value: r.value });
    }
    // Persist the mode as a row only when it overrides the default.
    if (mode === 'allowlist') clean.push({ kind: 'mode', value: 'allowlist' });
    userStore.setRestrictions(target.id, clean);
    const stored = userStore.getRestrictions(target.id);
    return res.json({ success: true, mode: readAccessMode(stored), restrictions: unitRows(stored) });
  });

  app.delete('/api/users/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const target = resolveTargetUser(req, res);
    if (!target) return;
    if (target.id === req.user.id) {
      return res.status(409).json({ error: 'You cannot delete your own account.' });
    }
    if (wouldRemoveLastAdmin(target.id, 'delete')) {
      return res.status(409).json({ error: 'That is the last enabled admin - deletion is refused so the instance cannot lock itself out.' });
    }
    // Gate WARNING-1 (adversarial): drop this user's staged (un-flushed)
    // pings BEFORE the row is deleted — otherwise the next flush would carry a
    // ping whose user_id no longer exists. The batch flush filters vanished
    // users too (defense in depth), but clearing at the source keeps the
    // coalescer honest and avoids a wasted FK-filter round.
    dropPendingProgressForUser(target.id);
    // Hard delete: ON DELETE CASCADE clears the per-user state; AUTOINCREMENT
    // guarantees the id is never reused, so any still-valid cookie for it can
    // never inherit a future account (design-delta SUGGESTION-6).
    userStore.deleteUser(target.id);
    unlinkAvatar(target.id); // v1.82: no orphaned profile image for a reaped id
    unlinkSticker(target.id); // v1.238: same, for the custom player sticker
    return res.json({ success: true });
  });
}

// The per-user PROFILE PHOTO routes, registered BEHIND the shell wildcard and
// the static layer (their original position - see the header).
function registerAvatarRoutes(app, deps) {
  const {
    AVATARS_DIR,
    AVATAR_MAX_BYTES,
    AVATAR_TYPES, // the mime allowlist AND its magic-byte sniffers
    avatarInfo,
    avatarPath,
    express, // express.raw - the upload body parser, built at REGISTRATION time
    fs,
    sniffAvatarMime,
    unlinkAvatar,
  } = deps;

  // Serve any user's avatar by id (a profile photo is low-sensitivity: the header
  // fetches the CURRENT user's; the admin Users list may show others'). Numeric id
  // only -> no path traversal. 404 when unset OR corrupt (never serve junk bytes).
  app.get('/api/users/:id/avatar', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'No avatar' });
    let bytes;
    try { bytes = fs.readFileSync(avatarPath(id)); }
    catch { return res.status(404).json({ error: 'No avatar' }); }
    const mime = sniffAvatarMime(bytes);
    if (!mime) return res.status(404).json({ error: 'No avatar' });
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache'); // the client cache-busts via ?v=<mtime>
    return res.send(bytes);
  });

  // Upload the CURRENT user's avatar. Self-service by design: there is NO by-id
  // write route, so a member can only ever set their own photo.
  app.post(
    '/api/me/avatar',
    express.raw({ type: Object.keys(AVATAR_TYPES), limit: AVATAR_MAX_BYTES }),
    (req, res) => {
      // MIME types are case-insensitive (RFC 2045); express.raw's type-is already
      // matched case-insensitively, so lowercase before the allowlist check.
      const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(AVATAR_TYPES, mime)) {
        return res.status(400).json({ error: 'Photo must be a PNG, JPEG, or WebP image' });
      }
      const bytes = req.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return res.status(400).json({ error: 'Empty upload' });
      }
      if (!AVATAR_TYPES[mime](bytes)) {
        return res.status(400).json({ error: 'File content does not match its image type' });
      }
      const target = avatarPath(req.user.id);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        fs.mkdirSync(AVATARS_DIR, { recursive: true });
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, target); // atomic replace
      } catch (err) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
        console.error('Error saving avatar:', err);
        return res.status(500).json({ error: `Could not save photo: ${err.message}` });
      }
      return res.json({ ok: true, avatar: avatarInfo(req.user.id) });
    },
    // Oversized body -> clean JSON 413 (mirrors the logo route's mapping).
    (err, req, res, next) => {
      if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res.status(413).json({ error: 'Photo too large (max 1 MB)' });
      }
      return next(err);
    }
  );

  // Remove the current user's avatar -> back to the initials monogram.
  app.delete('/api/me/avatar', (req, res) => {
    unlinkAvatar(req.user.id);
    return res.json({ ok: true, avatar: { present: false, version: 0 } });
  });
}

// The per-user PLAYER STICKER routes, behind the same two layers, registered
// after the sticker constants server.js still owns (their original position).
function registerStickerRoutes(app, deps) {
  const {
    STICKERS_DIR,
    STICKER_MAX_BYTES,
    STICKER_TYPES, // the mime allowlist AND its magic-byte sniffers (no SVG)
    express, // express.raw - the upload body parser, built at REGISTRATION time
    fs,
    sniffStickerMime,
    stickerInfo,
    stickerPath,
    unlinkSticker,
  } = deps;

  // Serve the CURRENT user's sticker only (self-only: a sticker is a personal
  // player decoration with no cross-user display surface, so unlike the avatar
  // there is NO by-id read route to widen the surface). 404 when unset OR corrupt.
  app.get('/api/me/sticker', (req, res) => {
    let bytes;
    try { bytes = fs.readFileSync(stickerPath(req.user.id)); }
    catch { return res.status(404).json({ error: 'No sticker' }); }
    const mime = sniffStickerMime(bytes);
    if (!mime) return res.status(404).json({ error: 'No sticker' });
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache'); // the client cache-busts via ?v=<mtime>
    return res.send(bytes);
  });

  // Upload the CURRENT user's sticker. Self-service by design: no by-id write route.
  app.post(
    '/api/me/sticker',
    express.raw({ type: Object.keys(STICKER_TYPES), limit: STICKER_MAX_BYTES }),
    (req, res) => {
      const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(STICKER_TYPES, mime)) {
        return res.status(400).json({ error: 'Sticker must be a PNG, JPEG, or WebP image' });
      }
      const bytes = req.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return res.status(400).json({ error: 'Empty upload' });
      }
      if (!STICKER_TYPES[mime](bytes)) {
        return res.status(400).json({ error: 'File content does not match its image type' });
      }
      const target = stickerPath(req.user.id);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        fs.mkdirSync(STICKERS_DIR, { recursive: true });
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, target); // atomic replace
      } catch (err) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
        console.error('Error saving sticker:', err);
        return res.status(500).json({ error: `Could not save sticker: ${err.message}` });
      }
      return res.json({ ok: true, sticker: stickerInfo(req.user.id) });
    },
    // Oversized body -> clean JSON 413 (mirrors the avatar/logo route mapping).
    (err, req, res, next) => {
      if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res.status(413).json({ error: 'Sticker too large (max 1 MB)' });
      }
      return next(err);
    }
  );

  // Remove the current user's custom sticker -> back to the chosen preset/logo.
  app.delete('/api/me/sticker', (req, res) => {
    unlinkSticker(req.user.id);
    return res.json({ ok: true, sticker: { present: false, version: 0 } });
  });
}

module.exports = { registerRoutes, registerAvatarRoutes, registerStickerRoutes };
