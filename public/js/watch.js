// FileTube Watch Page Logic — registered VIEW MODULE (FR-1/FR-2, T1/T2).
//
// `init(root)` runs both on a full page load (progressive-enhancement boot,
// via common.js's bootRouter) and on an in-app swap into `/watch.html` — the
// identical code path either way. Every listener this view adds (comments/
// rating/delete/description-toggle, and the shared shell's
// sidebar-folder-list) is registered through ONE per-view AbortController, so
// `destroy()` removes all of them in a single call when the user navigates
// away — no leaks across swaps. The header's #search-input/#search-btn are
// SHELL-owned (bound once at boot by common.js — see the C1 remediation
// comment there); this view never touches them.
//
// Player scope (T2): this view no longer owns the `<video>` or ANY player
// feature. `#player-slot` (see watch.html) is just a mount POINT: `init()`
// asks the persistent player controller (`window.FileTube.player`, see
// player.js) to mount/play the requested media there via `load(id, data,
// { slot })`. That call is idempotent -- if the controller already has this
// exact `id` loaded (the user tapped the docked mini-player, or a related-
// card click landed back on the same video), it's just a reparent (no
// restart, `<video>` src/currentTime untouched); otherwise it's a genuine new
// load. Leaving this view (any in-app nav to a non-watch view) does NOT stop
// playback -- the router's `applyPlayerTransition` (common.js) docks the
// player BEFORE this view's `destroy()` runs, so the video keeps playing in
// the corner dock. `destroy()` here only tears down this view's OWN
// (non-player) listeners.
// Pure, DOM-free helpers (v1.21 FR-9, T8) -- kept at module scope, above the
// view IIFE below, so `node:test` can `require()` them directly without
// touching `window`/`document` (mirrors player.js's own top-of-file pure-
// helper + `module.exports` guard pattern).

// nextTheaterState: the toggle's reducer -- flips the current boolean state.
// Kept as a named pure function (rather than an inline `!x` at the click
// site) so the toggle's actual state transition is isolated and unit-tested
// separately from the DOM-mutating class/attribute updates it drives.
function nextTheaterState(isActive) {
  return !isActive;
}

// isTheaterModeActive: parses the raw `localStorage.getItem('ft-theater')`
// return value (a string, or `null` if unset or storage is disabled/throws)
// into a boolean. Fail-safe like player.js's `clampVolume` -- ANY value
// other than the exact persisted "on" sentinel ('1') is treated as "off,"
// including `null`, `undefined`, or a garbage/foreign stored value, so a
// corrupted or missing preference can never surprise the user with an
// unexpected wide layout on load.
function isTheaterModeActive(rawValue) {
  return rawValue === '1';
}

// theaterModeStorageValue: the inverse serializer -- what gets written back
// to `localStorage['ft-theater']` for a given boolean state.
function theaterModeStorageValue(isActive) {
  return isActive ? '1' : '0';
}

// resolveUploaderLinkHref (v1.22.0 FR-3, updated v1.23.x per Dean): the
// creator/uploader name now links to THIS item's FOLDER content view --
// "show me this channel/creator's stuff" -- via the home view's existing
// `/?root=<folder>` filter (the same links the sidebar folders and channel
// pins use; the server's root filter is a prefix match that accepts any
// folder path, incl. a yt-dlp channelDir subfolder, which is why pins work).
// Derived purely from the item's own `filePath`: its parent directory. Works
// for BOTH local folders and yt-dlp channels (a downloaded video lives inside
// its channel's folder, so the parent dir IS the channel dir) and needs no
// yt-dlp module. Returns null when there is no usable parent folder (bare
// filename / empty) so the caller leaves the `<a>` inert plain text.
function resolveUploaderLinkHref({ filePath }) {
  if (!filePath || typeof filePath !== 'string') return null;
  var folder = filePath.replace(/[\\/][^\\/]*$/, ''); // strip trailing /file or \file
  if (!folder || folder === filePath) return null; // no separator -> no folder
  return '/?root=' + encodeURIComponent(folder);
}

// resolveChannelDirFromFilePath (v1.24.0, T6, B3): the RAW (non-URL-encoded)
// parent-folder path for a media item's file -- the same "one directory up"
// derivation `resolveUploaderLinkHref` above already uses for the `/?root=`
// creator link, just returned as a plain path instead of a pre-built href.
// Used ONLY as a pin target when the current file has no active subscription
// to source a server-resolved `channelDir` from (see `setupPinButton` below):
// for a video already living inside its downloaded channel's own folder, this
// parent directory already IS that channel's folder; for a pre-subscription
// one-off download it is at least the folder the file currently lives in --
// the best available confined target client-side (the server's own
// `isChannelDirConfined` check still gates the actual pin request, exactly
// like every other pin -- this is not a new trust boundary). Fails safe
// (returns `null`) on the same conditions as `resolveUploaderLinkHref`, never
// throws.
function resolveChannelDirFromFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  var folder = filePath.replace(/[\\/][^\\/]*$/, '');
  if (!folder || folder === filePath) return null;
  return folder;
}

// resolveWatchEntryReparentAction (D1, v1.24 UX Round, T12): watch.js's own
// SYNCHRONOUS-entry decision -- what init() should do with the persistent
// player host, right here, before ANY of initWatch()'s awaited fetches even
// start, given the controller's CURRENT (currentId, state) and the NEWLY
// requested media id for this watch-page open.
//
// Root cause this exists to fix (the ~1/4s blank/flash on Prev/Next, D1):
// the SPA router (common.js's swapToView) detaches the OUTGOING #view-root
// -- and the persistent `<video>` host, still nested inside its OLD
// #player-slot at that instant -- SYNCHRONOUSLY, well before this view's own
// init() runs. Previously the ONLY reparent into the NEW #player-slot
// happened deep inside initWatch() (an async function), AFTER it had
// awaited BOTH /api/config and /api/videos/:id -- so on a genuine
// watch -> watch navigation (Prev/Next, a related-card click into a
// DIFFERENT video), the host sat fully detached from the live document for
// the duration of those two network round-trips. Calling `player.expand()`
// synchronously here instead -- in the SAME synchronous task as the
// router's `oldRoot.replaceWith(root)` swap, with no `await`/paint in
// between -- means the host is never actually absent from the live
// document at all.
//
// Returns one of:
//   'adopt'    -- requestedId already matches what's loaded (not CLOSED): a
//                 pure reparent, no restart (mirrors `isAdoptLoad` in
//                 player.js -- the identical "same id" contract).
//   'reparent' -- a DIFFERENT id, but the host is currently mounted FULL
//                 (the outgoing watch page had something actually playing/
//                 shown): eagerly move that SAME host into the NEW
//                 #player-slot right now, before any fetch. `player.load()`
//                 (called later, once real data resolves) still performs
//                 the actual teardown + new-media load exactly as before --
//                 this is ONLY an earlier reparent of the same host, never
//                 a new/second load path.
//   'defer'    -- nothing FULL to carry over: DOCKED (a different video
//                 playing mini while landing fresh on this watch page from
//                 elsewhere -- forcing it to FULL before the real data
//                 resolves would briefly show the WRONG video in the FULL
//                 slot) or CLOSED/nothing loaded. The existing async
//                 load() path, once the fetches resolve, is unchanged and
//                 sufficient -- matches pre-D1 behavior exactly.
function resolveWatchEntryReparentAction(currentId, requestedId, state) {
  if (currentId != null && currentId === requestedId && state !== 'closed') return 'adopt';
  if (currentId != null && state === 'full') return 'reparent';
  return 'defer';
}

// ---- G1: Polite and Unhinged weighted mock-commenter + comment-bank selection ------
// (v1.24.0, T4). Pure/DOM-free, hoisted to module scope (like the pure
// helpers above) so node:test can exercise both the flat commentBank
// selection AND the new weighted Polite and Unhinged layer directly, without a
// browser.

// MOCK_COMMENT_BANK was previously a `const commentBank` declared INSIDE
// getMockInitialComments() (content byte-for-byte unchanged) -- hoisted here
// only so selectDeterministicComments()/buildMockComments() below can be
// unit-tested against the real pool, not just a synthetic one.
const MOCK_COMMENT_BANK = [
  { author: 'xX_GuitarHero_Xx', text: 'Unbelievable quality! Saved this to my hard drive immediately. Thanks for uploading!', timeStr: '2 years ago' },
  { author: 'RetroLover99', text: 'Wow, this brings back so many memories. HTML5 streaming is super smooth on my phone!', timeStr: '1 year ago' },
  { author: 'buffering_fan', text: 'First! Anyone else watching in 2026? 😂', timeStr: '6 months ago' },
  { author: 'code_runner', text: 'This FileTube container works flawlessly. Glad we can self-host this.', timeStr: '3 months ago' },
  { author: 'anonymous_user', text: 'Is it possible to download? Oh wait, it is already on my disk. Lol.', timeStr: '2 weeks ago' },
  { author: 'audio_phile', text: 'Great audio upload, sound quality is pristine.', timeStr: '5 days ago' },
  { author: 'MLG_toaster', text: 'who else is scrolling comments instead of watching 🙋', timeStr: '4 years ago' },
  { author: 'SubToMePls', text: 'thumbs up if u came here from the homepage', timeStr: '8 months ago' },
  { author: 'dial_up_survivor', text: 'buffered instantly?? in MY house?? we live in the future', timeStr: '1 year ago' },
  { author: 'CerealKiller2007', text: 'i showed this to my cat. no reaction. still a banger.', timeStr: '3 weeks ago' },
  { author: 'notabot_promise', text: 'the algorithm blessed me tonight 🙏', timeStr: '2 days ago' },
  { author: 'grainy480p_gang', text: 'came for the nostalgia, stayed for the vibes', timeStr: '5 months ago' },
  { author: 'LocalManYells', text: '0:32 you can literally hear the compression and i love it', timeStr: '11 months ago' },
  { author: 'ProSkater_1999', text: 'this belongs in a museum. or at least my flash drive.', timeStr: '7 months ago' },
  { author: 'keyboard_warrior_lite', text: 'im not crying you\'re crying', timeStr: '1 month ago' },
  { author: 'ServerRoomGremlin', text: 'self-hosted and DRM-free? based.', timeStr: '9 days ago' },
  { author: 'quantum_potato', text: 'my ISP is shaking rn', timeStr: '6 hours ago' },
  { author: 'VHS_Wizard', text: 'be right back, adding this to 14 playlists', timeStr: '2 years ago' },
  { author: 'lurk_mode_off', text: 'first comment in 6 years of watching. worth it.', timeStr: '4 months ago' },
  { author: 'CtrlAltDefeat', text: 'the resolution is low but my expectations were lower and it STILL exceeded them', timeStr: '3 days ago' },
  { author: 'SnackTimeSam', text: 'watching this instead of doing my homework, no regrets', timeStr: '1 week ago' },
  { author: 'aggressively_average', text: 'skipped the intro like a coward. do not recommend. 10/10.', timeStr: '5 weeks ago' },
  { author: 'MemoryLeakLarry', text: 'i have watched this 47 times and my RAM has not forgiven me', timeStr: '2 months ago' },
  { author: 'ohno_its_dave', text: 'the double-tap skip is smoother than my dance moves', timeStr: '10 days ago' },
  { author: 'PacketLossPaul', text: 'no ads, no tracking, no login wall. i forgot the internet could feel like this', timeStr: '3 months ago' },
  { author: 'ffmpeg_enjoyer', text: 'transcoded perfectly on the first try, which never happens. black magic.', timeStr: '1 year ago' },
  { author: '404_brain_not_found', text: 'clicked this at 2am and have zero regrets and even less sleep', timeStr: '4 days ago' },
  { author: 'CapsLockKaren', text: 'WHY IS THIS SO GOOD I CANT EVEN TURN OFF MY CAPS', timeStr: '6 months ago' },
  { author: 'reverse_engineer_rick', text: 'checked the network tab just to make sure it wasnt phoning home. it isnt. legend.', timeStr: '2 weeks ago' },
  { author: 'nostalgic_noodle', text: 'this is the digital equivalent of finding $20 in an old jacket', timeStr: '8 months ago' },
  { author: 'BandwidthBandit', text: 'streaming this on my toaster and it STILL loads faster than the big platforms', timeStr: '5 days ago' },
  { author: 'ctrl_z_forever', text: 'undid my whole afternoon to watch this. cant undo it back. worth it.', timeStr: '3 weeks ago' },
  { author: 'MidiFileMike', text: 'the audio slaps harder than a 90s ringtone', timeStr: '1 year ago' },
  { author: 'sudo_make_me_a_sandwich', text: 'ran this on my homelab and my wife asked why im smiling at the router', timeStr: '2 months ago' },
  { author: 'GifNotJif', text: 'i will die on the hill that this is peak content', timeStr: '11 months ago' },
  { author: 'lowpoly_larry', text: 'the pixels are fighting for their lives and i respect the hustle', timeStr: '4 months ago' },
  { author: 'TabHoarder3000', text: 'this is now permanently open in tab 47 of 231', timeStr: '9 days ago' },
  { author: 'cache_me_ousside', text: 'loaded from cache before i even finished blinking', timeStr: '6 hours ago' },
  { author: 'DefinitelyHuman__', text: 'beep boop i mean wow great video fellow human', timeStr: '1 month ago' },
  { author: 'compression_artist', text: 'those jpeg artifacts are basically abstract art at this point', timeStr: '7 months ago' },
  { author: 'yeet_the_skip', text: 'the skip button responds faster than my will to live on a monday', timeStr: '5 weeks ago' },
  { author: 'Rj45_romantic', text: 'plugged in an ethernet cable just to honor this upload', timeStr: '3 months ago' },
  { author: 'segfault_sally', text: 'watched it, cried, watched it again, cried professionally this time', timeStr: '2 days ago' },
  { author: 'ThumbnailLiar', text: 'thumbnail promised nothing and delivered everything. rare.', timeStr: '10 months ago' },
  { author: 'localhost_hero', text: 'runs on 127.0.0.1 and lives in my heart', timeStr: '1 week ago' },
  { author: 'bit_rot_betty', text: 'archived this before the heat death of the universe just to be safe', timeStr: '4 years ago' },
  { author: 'TerabyteTerry', text: 'my NAS thanks you, this is going in the good folder', timeStr: '6 months ago' },
  { author: 'off_by_one_ollie', text: 'watched it 1 too many times and 1 too few at the same time', timeStr: '3 days ago' },
  { author: 'RanchDressingFan', text: 'no thoughts. just vibes and mild buffering (jk it never buffered)', timeStr: '2 weeks ago' },
  { author: 'kernel_panic_kim', text: 'the only thing that crashed today was my composure watching this', timeStr: '8 months ago' },
  { author: 'ThreadRipperTina', text: 'used 1 core out of 32 to watch this and felt powerful', timeStr: '5 months ago' },
  { author: 'perpetual_beta', text: 'this is more stable than any app ive ever shipped', timeStr: '1 year ago' },
  { author: 'wget_wanderer', text: 'wget-ed the whole thing out of respect for the craft', timeStr: '9 days ago' },
  { author: 'BlinkTagBrenda', text: 'somewhere a 2004 webmaster is smiling', timeStr: '11 months ago' },
  { author: 'nullpointer_nate', text: 'expected nothing, got everything, threw no exceptions', timeStr: '4 days ago' },
  { author: 'RaidZeroRegret', text: 'backed this up to a drive with no redundancy. living dangerously.', timeStr: '2 months ago' },
  { author: 'silent_scroll', text: 'been watching for years, finally commenting, immediately regret the pressure', timeStr: '7 months ago' },
  { author: 'ohm_my_god', text: 'the resistance to closing this tab is futile', timeStr: '3 weeks ago' },
  { author: 'DownloadFinished', text: '99%... 99%... 100%. best 3 seconds of anticipation of my life.', timeStr: '6 months ago' },
  { author: 'legacy_browser_lou', text: 'works on the browser i refuse to update. miracle.', timeStr: '1 month ago' },
  { author: 'the_real_admin', text: 'i host this and even i keep coming back to watch it', timeStr: '5 days ago' },

  { author: 'JpegDreams', text: 'i can see individual pixels and i have named each one', timeStr: '3 days ago' },
  { author: 'uptime_uwu', text: '99.99% uptime and 100% serotonin', timeStr: '1 week ago' },
  { author: 'CronJobCarl', text: 'scheduled my entire evening around rewatching this', timeStr: '2 months ago' },
  { author: 'ping_of_death', text: 'latency so low i watched it before i clicked', timeStr: '5 hours ago' },
  { author: 'DarkModeDenise', text: 'toggled dark mode and ascended to a higher plane', timeStr: '4 days ago' },
  { author: 'YAMLwrangler', text: 'no indentation errors were harmed in the making of this comment', timeStr: '6 months ago' },
  { author: 'sneakernet_steve', text: 'almost drove a hard drive to my friends house before remembering this exists', timeStr: '2 weeks ago' },
  { author: 'RegexRhonda', text: 'this video matches /.*perfection.*/gi', timeStr: '9 days ago' },
  { author: 'buffer_underrun', text: 'my thumbnail loaded so fast i got startled', timeStr: '1 month ago' },
  { author: 'GrandpaOnDialup', text: 'in MY day we waited 40 minutes for a single gif. you kids are spoiled.', timeStr: '3 weeks ago' },
  { author: 'semicolon_survivor', text: 'no missing semicolons detected. we thrive.', timeStr: '7 months ago' },
  { author: 'ETL_enthusiast', text: 'extracted joy, transformed my mood, loaded it straight into my heart', timeStr: '4 days ago' },
  { author: 'mount_point_marie', text: 'mounted this directly into my soul, read-write', timeStr: '5 weeks ago' },
  { author: 'HeapOverflowHarry', text: 'allocated way too much memory to how much i love this', timeStr: '2 days ago' },
  { author: 'the_lag_is_gone', text: 'the buffering wheel walked so this could run', timeStr: '11 months ago' },

  // Friends
  { author: 'Maligned Mentor', text: 'cool. touch grass.', timeStr: '2 days ago' },
  { author: 'Maligned Mentor', text: 'you spent HOW long on this. the outdoors is free, you know.', timeStr: '5 days ago' },
  { author: 'Maligned Mentor', text: 'please tell me a human wrote this and not some chatbot', timeStr: '1 week ago' },
  { author: 'Maligned Mentor', text: 'impressive, i guess. the sun still exists though.', timeStr: '3 days ago' },
  { author: 'Maligned Mentor', text: 'neat. go outside.', timeStr: '4 days ago' },
  { author: 'Betting Bug', text: 'lil b really built his own youtube 😤', timeStr: '2 days ago' },
  { author: 'Betting Bug', text: 'clean work lil b. anyway i got the Lakers +4 tonight', timeStr: '5 days ago' },
  { author: 'Betting Bug', text: 'lil b i\'m 3 legs into a 5 leg parlay and STILL watching this', timeStr: '1 week ago' },
  { author: 'Betting Bug', text: '10/10 lil b. hits better than cashing a same-game parlay', timeStr: '3 days ago' },
  { author: 'Betting Bug', text: 'solid lil b. might put the whole bankroll on this app', timeStr: '4 days ago' },
  { author: 'Feedback Friend', text: 'nice work. consider a service worker for offline playback next.', timeStr: '2 days ago' },
  { author: 'Feedback Friend', text: 'solid. i\'d add rate limiting on the transcode endpoint though.', timeStr: '5 days ago' },
  { author: 'Feedback Friend', text: 'clean. throw some integration tests on the scan logic.', timeStr: '1 week ago' },
  { author: 'Feedback Friend', text: 'good stuff. debounce the progress saves to cut disk writes.', timeStr: '3 days ago' },
  { author: 'Feedback Friend', text: 'works well. extract that transcode queue into its own module.', timeStr: '4 days ago' },
  { author: 'Derby Owner\'s Club fanatic', text: 'solid. now boot up Derby Owner\'s Club and let\'s run a few races 🐎', timeStr: '2 days ago' },
  { author: 'Derby Owner\'s Club fanatic', text: 'good but it needs more Derby Owner\'s Club if we\'re being honest', timeStr: '5 days ago' },
  { author: 'Derby Owner\'s Club fanatic', text: '10/10 would watch between DOC sessions', timeStr: '1 week ago' },
  { author: 'Derby Owner\'s Club fanatic', text: 'my horse would approve of this upload 🏇', timeStr: '3 days ago' },

  // Family
  { author: 'Ball Busting Brother', text: 'oh good, another project instead of answering my texts', timeStr: '2 days ago' },
  { author: 'Ball Busting Brother', text: 'you invented youtube. truly no one has ever done this before.', timeStr: '5 days ago' },
  { author: 'Ball Busting Brother', text: 'impressive. anyway you still owe me for lunch.', timeStr: '1 week ago' },
  { author: 'Ball Busting Brother', text: 'cool app. still only the second funniest person in the family though.', timeStr: '3 days ago' },
  { author: 'Ball Busting Brother', text: 'so THIS is what "im busy" meant', timeStr: '4 days ago' },
  { author: 'My Wife', text: 'babe it is 2am. the server will still be here tomorrow.', timeStr: '2 hours ago' },
  { author: 'My Wife', text: 'very impressive. now do the dishes you promised 😘', timeStr: '1 day ago' },
  { author: 'My Wife', text: '10/10 but you STILL haven\'t watched the Calico Critters episode with me', timeStr: '3 days ago' },
  { author: 'My Wife', text: 'cute. the Calico Critters have a nicer house than we do though 🐰', timeStr: '5 days ago' },
  { author: 'My Wife', text: 'you named a git branch instead of taking out the trash didn\'t you', timeStr: '4 days ago' },
  { author: 'My Wife', text: 'love it honey. putting it on the shelf next to my Calico Critters 💕', timeStr: '1 week ago' },
  { author: 'Proud Dad', text: 'Very thorough assessment son. I wish I was next to you to help you with all these projects. Love you.', timeStr: '2 days ago' },
  { author: 'Proud Dad', text: 'Excellent work my son. So very proud of you. Love you.', timeStr: '5 days ago' },
  { author: 'Proud Dad', text: 'This is wonderful. You were always so talented. Call me and show me how it works. Love you son.', timeStr: '1 week ago' },
  { author: 'Proud Dad', text: 'Beautiful project son. I wish I could sit beside you and build these with you. Love you.', timeStr: '3 days ago' },

  // Loving Daughter
  { author: 'Loving Daughter', text: 'hi daddy i luv u 💖', timeStr: '2 hours ago' },
  { author: 'Loving Daughter', text: 'dis is the BEST vidyo EVER!!!', timeStr: '1 day ago' },
  { author: 'Loving Daughter', text: 'daddy ur so smart!!!', timeStr: '3 hours ago' },
  { author: 'Loving Daughter', text: 'i wach it a HUNDRED times 🥰', timeStr: '5 hours ago' },
  { author: 'Loving Daughter', text: 'can we hav ice cream after pleez 🍦', timeStr: '4 days ago' },
  { author: 'Loving Daughter', text: 'i luv u dad to the moon 🌙', timeStr: 'just now' },
  { author: 'Loving Daughter', text: 'my daddy maded dis!!!', timeStr: '2 days ago' },
  { author: 'Loving Daughter', text: 'SO GOOD i clapd 👏', timeStr: '6 hours ago' },
  { author: 'Loving Daughter', text: 'daddy is the best on the hole erf', timeStr: '1 day ago' },
  { author: 'Loving Daughter', text: 'i drawed u a picsher 🎨', timeStr: '3 days ago' },
  { author: 'Loving Daughter', text: 'yaaay daddy!!! 🎉', timeStr: '5 days ago' },
  { author: 'Loving Daughter', text: 'wach wif me daddy pleeez', timeStr: '1 week ago' }
];

// selectDeterministicComments: the ORIGINAL flat, unweighted, deterministic
// selection mechanism (byte-for-byte unchanged from pre-v1.24.0) -- `seed +
// i*7 % bank.length`, skipping already-used indices. Pure: the SAME
// (mediaId, bank, count) always returns the SAME ordered comment list. G1
// layers Polite and Unhinged on TOP of this in buildMockComments() below WITHOUT
// modifying this function's own selection at all -- which is exactly what
// preserves its existing per-mediaId determinism guarantee for the rest of
// commentBank (exec-plan G1 acceptance criterion).
function selectDeterministicComments(mediaId, bank, count) {
  const safeBank = Array.isArray(bank) ? bank : [];
  if (safeBank.length === 0) return [];
  const seed = String(mediaId || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const safeCount = Math.max(0, Math.min(count || 0, safeBank.length));
  const selected = [];
  const used = new Set();
  for (let i = 0; i < safeCount; i++) {
    let idx = (seed + i * 7) % safeBank.length;
    while (used.has(idx)) idx = (idx + 1) % safeBank.length;
    used.add(idx);
    selected.push(safeBank[idx]);
  }
  return selected;
}

// Pure djb2-style string hash -- the SAME string always produces the SAME
// non-negative integer, on any platform/Node version (no reliance on object
// iteration order, Math.random, or locale). A small, LOCAL, self-contained
// helper -- deliberately NOT imported from common.js's own (unexported)
// `hashAvatarSeed`, since this task owns only watch.js. Never used for
// anything security-sensitive.
function hashPersonaSeed(str) {
  let hash = 5381;
  const safe = String(str || '');
  for (let i = 0; i < safe.length; i++) {
    hash = ((hash << 5) + hash + safe.charCodeAt(i)) | 0; // hash*33 + c
  }
  return Math.abs(hash);
}

const PERSONA_AUTHOR = 'Polite and Unhinged';

// Polite and Unhinged's own timeStr pool -- picked deterministically per mediaId,
// same spirit as the rest of commentBank's fixed timeStr values.
const PERSONA_TIME_STRINGS = ['3 days ago', '1 week ago', '5 hours ago', '2 months ago', '6 days ago', 'just now'];

// 87% of the time: a normal, tasteful, on-brand retro-comment-section reply.
const PERSONA_POLITE_COMMENTS = [
  'Really enjoyed this, thanks for putting it up!',
  'Great quality upload, appreciate the effort that went into this.',
  'This made my afternoon a little better, thank you.',
  'Nice pacing and clean playback, solid work.',
  'Appreciate you keeping this online, definitely worth the watch.',
  'Good find, saving this one for later.',
  'Well put together, thanks for sharing this.',
  'This is exactly the kind of thing I come back to FileTube for.'
];

// 10% of the time: over-the-top ENERGY -- silly and enthusiastic, never
// mean-spirited, never at anyone's expense.
const PERSONA_UNHINGED_COMMENTS = [
  'I WATCHED THIS SEVEN TIMES BEFORE BREAKFAST AND I REGRET NOTHING',
  'screaming crying throwing my remote this is TOO good',
  'renamed my home wifi in honor of this upload, the whole street can see it now',
  'my smart watch just asked if I\'m ok. I am not. I am WATCHING THIS AGAIN',
  'I told my houseplants about this video. they seemed impressed',
  'cancelled my plans, my OTHER plans, and possibly my gym membership for this'
];

// 3% of the time: a good-natured, harmless conspiracy theory about WHATEVER
// the video happens to be -- `{title}` is substituted with the current
// video's title (falling back to a generic "this video" phrase when the
// title is blank/missing, so it never renders a literal "undefined").
const PERSONA_CONSPIRACY_TEMPLATES = [
  'wake up people, {title} was clearly uploaded at this exact time for a reason and none of you are asking why',
  'if you play {title} backwards you can hear the buffering wheel counting down to something',
  'coincidence that {title} exists at all? I THINK NOT. do your own research',
  '{title} is obviously a signal to the pigeons. I\'ve said too much'
];

// pickPersonaCategory: which bucket a given mediaId lands in. 87/10/3 is a
// LITERAL 0-99 range split (87 + 10 + 3 = 100), so the weighting is exact
// over a large deterministic sample, not a random approximation.
function pickPersonaCategory(mediaId) {
  const bucket = hashPersonaSeed(String(mediaId || '') + '::persona-category') % 100;
  if (bucket < 87) return 'polite';
  if (bucket < 97) return 'unhinged';
  return 'conspiracy';
}

function personaCommentPool(category) {
  if (category === 'unhinged') return PERSONA_UNHINGED_COMMENTS;
  if (category === 'conspiracy') return PERSONA_CONSPIRACY_TEMPLATES;
  return PERSONA_POLITE_COMMENTS;
}

// buildPersonaComment: the full Polite and Unhinged persona comment {author, text,
// timeStr} for a given (mediaId, videoTitle). Pure and fully deterministic --
// the SAME video always gets the SAME Polite and Unhinged comment, in the SAME
// weighted category, on every load.
function buildPersonaComment(mediaId, videoTitle) {
  const safeMediaId = String(mediaId || '');
  const category = pickPersonaCategory(safeMediaId);
  const pool = personaCommentPool(category);
  const textIdx = hashPersonaSeed(safeMediaId + '::persona-text::' + category) % pool.length;
  const timeIdx = hashPersonaSeed(safeMediaId + '::persona-time') % PERSONA_TIME_STRINGS.length;
  const safeTitle = typeof videoTitle === 'string' && videoTitle.trim() !== '' ? videoTitle.trim() : 'this video';
  const text = pool[textIdx].split('{title}').join(safeTitle);
  return { author: PERSONA_AUTHOR, text, timeStr: PERSONA_TIME_STRINGS[timeIdx] };
}

// buildMockComments: getMockInitialComments()'s pure core -- the ORIGINAL
// flat selection (selectDeterministicComments, untouched above) PLUS one
// Polite and Unhinged comment (G1) spliced in at a deterministic position. Because the
// base selection is computed FIRST and independently, layering Polite and Unhinged on
// top never changes which (or how many) of the rest of commentBank's entries
// get picked, or their relative order -- only where among them Polite and Unhinged's
// own comment lands.
function buildMockComments(mediaId, bank, count, videoTitle) {
  const base = selectDeterministicComments(mediaId, bank, count);
  const personaComment = buildPersonaComment(mediaId, videoTitle);
  const insertAt = base.length > 0
    ? hashPersonaSeed(String(mediaId || '') + '::persona-slot') % (base.length + 1)
    : 0;
  const withPersona = base.slice();
  withPersona.splice(insertAt, 0, personaComment);
  return withPersona;
}

// ---- v1.48 item 1: the video description shown in the description box ------
// Dean: "Can we have the full description of the video pulled. Right now it's
// truncated. We should add this to reheat so full descriptions can be
// displayed."
//
// It turned out to need NO reheat/backfill work, so this is deliberately a pure
// render-side decision and nothing else. The full text has always been present
// end to end: yt-dlp writes it into the media file itself via `--embed-metadata`
// (lib/ytdlp/args.js), server.js's ffprobe probe reads format tags under a 16MB
// maxBuffer raised specifically so long descriptions cannot overflow it, and
// `parseFfprobeTags` whitelists `description` while only trimming whitespace.
// The ONLY truncation in the whole path was cosmetic and client-side: the
// description appeared solely as one row of the "Embedded info" block, cut to
// 400 characters by `renderEmbeddedTags`'s `clip`.
//
// Returns the description to display, or '' for "show nothing" (which the
// `.video-description:empty` CSS rule turns into "occupy no space at all").
//
// The title-equality guard is NOT incidental. For non-YouTube ("universal")
// downloads the item's title IS its description, written by
// UNIVERSAL_OUTPUT_TEMPLATE's `%(title).100s` (v1.41.16-18) -- so rendering the
// description for those items would print the title twice, once truncated to
// 100 characters and once in full. Compared case-insensitively on trimmed text
// because the filename-derived title has been through path sanitization while
// the embedded tag has not.
// GATE FIX (adversarial WARNING W3): the displayed text is BOUNDED. Nothing
// upstream caps it -- `parseFfprobeTags` only trims, so the real ceiling was
// ffprobe's 16MB maxBuffer -- and before v1.48 nothing rendered past 400 chars
// anyway. Now the whole string goes into a `-webkit-line-clamp` box with
// `overflow-wrap: anywhere` (a break opportunity at EVERY character) and
// `setupDescriptionToggle` immediately reads `scrollHeight`, forcing a
// synchronous full-text layout. Multi-hundred-KB descriptions are ordinary on
// YouTube (auto-generated tracklists, link dumps), so the worst case was a
// browser hang on an attacker-influenced field.
//
// 50k characters is far above any real description (YouTube's own limit is
// 5000) while turning "unbounded" into a chosen number. This is an availability
// bound only; XSS was never in play (textContent, never innerHTML).
const MAX_DISPLAY_DESCRIPTION = 50000;

function resolveDisplayDescription(tags, title) {
  const raw = tags && typeof tags.description === 'string' ? tags.description.trim() : '';
  if (raw === '') return '';
  // DELTA GATE FIX (adversarial S-E2): the length bound is applied BEFORE the
  // title-equality compare. `raw.toLowerCase()` copies the entire string, so on
  // a multi-MB tag the compare cost more than the cut did -- and it is provably
  // pointless there, because a description longer than MAX_DISPLAY_DESCRIPTION
  // cannot equal a title that is itself length-capped far below it.
  //
  // Deliberately NOT a `raw.length === t.length` pre-check instead: lowercasing
  // can CHANGE length (U+0130 'İ' lowercases to two UTF-16 units), so a length
  // pre-check would false-negative on exotic Unicode and start printing a
  // duplicated title for exactly the universal-lane items the guard protects.
  // DELTA GATE FIX (adversarial W-D2): a UTF-16 unit slice with ONE boundary
  // repair, NOT `[...raw].slice().join('')`. The spread was measured
  // materialising the entire input as an array of per-code-point strings BEFORE
  // cutting -- 213ms and 95MB of heap on a 16MB tag -- which re-imported the
  // main-thread spike this bound exists to remove. This form is O(MAX) instead
  // of O(input), and the units-vs-code-points mismatch also made the effective
  // bound 2x looser than the constant claimed for astral text.
  //
  // It still cannot split a surrogate pair: if the cut lands between a HIGH
  // surrogate (U+D800-U+DBFF) and its low half, that dangling high surrogate is
  // dropped. A cut immediately AFTER a complete pair leaves a low surrogate as
  // the last unit, which is already valid and must not be touched.
  if (raw.length > MAX_DISPLAY_DESCRIPTION) {
    let cut = raw.slice(0, MAX_DISPLAY_DESCRIPTION);
    const lastUnit = cut.charCodeAt(cut.length - 1);
    if (lastUnit >= 0xD800 && lastUnit <= 0xDBFF) cut = cut.slice(0, -1);
    return cut + '…';
  }
  // The universal-lane guard, now reached only for strings at or under the
  // bound. For non-YouTube downloads the item's TITLE is its description
  // (UNIVERSAL_OUTPUT_TEMPLATE's `%(title).100s`, v1.41.16-18), so without this
  // those items print the same text twice, once cut to 100 chars and once in
  // full. Equality, deliberately NOT prefix: real descriptions routinely open by
  // restating the title, and suppressing those would hide what Dean asked for.
  const t = typeof title === 'string' ? title.trim().toLowerCase() : '';
  if (t !== '' && raw.toLowerCase() === t) return '';
  return raw;
}

// ---- v1.48 item 4: retire mock commenters left over in localStorage --------
// Dean: "I have some files that had some old commenters that are outdated I'd
// like all to show the proper modern ones." (The specific names are deliberately
// not reproduced here -- v1.44.3/v1.44.4 removed them from this repo and the
// migration below is name-agnostic, so nothing needs them written down.)
//
// This is NOT a code defect and grepping for those names finds nothing: a
// line-joined whole-tree scan confirms the source carries no real names, and
// MOCK_COMMENT_BANK was genericised back in v1.44.3/v1.44.4. The stale names
// live in the BROWSER. `loadComments` writes each video's generated comments to
// `comments_<mediaId>` on its FIRST view and, before this change, never looked
// at them again -- so every video Dean opened before v1.44.3 has the old bank
// frozen in localStorage forever, on every device he ever opened it on. That is
// exactly why only "some files" show them.
//
// THIS PATH CAN DESTROY USER DATA, which is why it is a reconciliation and not
// a reset. Dean's OWN posted comments live in the very same array (author
// 'You', unshifted to the front by the Comment button), so versioning the
// storage key -- the obvious one-line fix -- would silently delete every real
// comment he has ever written. Instead: keep every 'You' comment in its
// original order, drop only entries whose author no longer exists in the
// current bank, and regenerate the mock remainder deterministically.
//
// `makeFreshMock` is a FACTORY, not a value, so a video whose stored comments
// are already current costs nothing (no regeneration, no rewrite, no
// localStorage churn on every watch-page load).
const USER_COMMENT_AUTHOR = 'You';
const MOCK_COMMENT_AUTHORS = new Set(MOCK_COMMENT_BANK.map((c) => c.author));

// Is this author one the CURRENT bank can still produce? The persona author is
// included: it is generated by buildPersonaComment rather than listed in the
// bank, so omitting it here would make every persona comment look stale and
// force a pointless regeneration on every load.
function isCurrentCommentAuthor(author) {
  return typeof author === 'string' &&
    (MOCK_COMMENT_AUTHORS.has(author) || author === PERSONA_AUTHOR);
}

function reconcileStoredComments(stored, makeFreshMock) {
  const fresh = () => {
    const generated = typeof makeFreshMock === 'function' ? makeFreshMock() : null;
    return Array.isArray(generated) ? generated : [];
  };
  // Corrupt/non-array storage (hand-edited, or a truncated write) -- rebuild
  // rather than throw. There is nothing to preserve in a value that is not a list.
  if (!Array.isArray(stored)) return { comments: fresh(), changed: true };

  const usable = (c) => !!c && typeof c === 'object';
  // GATE FIX (adversarial SUGGESTION S7): the user-author test is trimmed and
  // case-insensitive. The Comment button only ever writes the exact literal
  // 'You', so this is theoretical -- but this is a data-DESTROYING path, and a
  // comparison that can only ever KEEP more costs nothing. (A homoglyph such as
  // Cyrillic 'Уou' still will not match, which is correct: it was never written
  // by the Comment button.)
  const isUserAuthored = (c) => typeof c.author === 'string' &&
    c.author.trim().toLowerCase() === USER_COMMENT_AUTHOR.toLowerCase();
  const isStale = (c) => !usable(c) ||
    (!isUserAuthored(c) && !isCurrentCommentAuthor(c.author));

  // The common case by far: nothing stale, so return the stored array
  // UNTOUCHED and report no change (the caller then skips the write entirely).
  if (!stored.some(isStale)) return { comments: stored, changed: false };

  // Dean's own comments survive, in their original relative order and still at
  // the front -- which is where the Comment button puts them.
  const mine = stored.filter((c) => usable(c) && isUserAuthored(c));
  return { comments: [...mine, ...fresh()], changed: true };
}

// v1.68.1: the watch id from the query string -- `?v=`, with legacy `?id=` as
// a fallback. Push banners minted before v1.67.4 (when lib/push/deliver.js's
// pushWatchUrl built `?id=`) OUTLIVE that server-side fix in the phone's
// notification shade: tapping one navigated here, found no `?v=`, and hit the
// bounce-to-home guard in init() below -- which on-device reads as "the tap
// did nothing". `?v=` wins when both are present (only ever minted alone, but
// the precedence must not depend on that).
function resolveWatchMediaId(search) {
  const params = new URLSearchParams(search || '');
  return params.get('v') || params.get('id') || null;
}

// v1.99 shimmer sweep: n `.related-card`-shaped shimmer rows seeded into
// #related-files-container BEFORE the /api/videos fetch, so the related rail
// shimmers instead of sitting blank then snapping in. Reuses the REAL
// `.related-card` / `.related-thumb` (aspect 16/9) / `.related-info` box, so the
// swap to real cards is zero-shift (the buildSkeletonGrid contract).
function buildRelatedSkeletonCards(n) {
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += '<div class="related-card" aria-hidden="true">'
      + '<div class="related-thumb skeleton-shimmer"></div>'
      + '<div class="related-info">'
      + '<div class="skeleton-line skeleton-line-title skeleton-shimmer"></div>'
      + '<div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div>'
      + '<div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div>'
      + '</div>'
      + '</div>';
  }
  return html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    resolveDisplayDescription,
    buildRelatedSkeletonCards,
    MAX_DISPLAY_DESCRIPTION,
    isCurrentCommentAuthor,
    reconcileStoredComments,
    USER_COMMENT_AUTHOR,
    PERSONA_AUTHOR,
    nextTheaterState,
    isTheaterModeActive,
    theaterModeStorageValue,
    resolveUploaderLinkHref,
    resolveChannelDirFromFilePath,
    resolveWatchEntryReparentAction,
    resolveWatchMediaId,
    MOCK_COMMENT_BANK,
    selectDeterministicComments,
    hashPersonaSeed,
    pickPersonaCategory,
    buildPersonaComment,
    buildMockComments,
  };
}

(function () {
  let controller = null;

  // v1.49: is the yt-dlp module enabled on this install? Latched at the IIFE
  // scope, NOT per view instance, so navigating between watch pages costs one
  // health probe for the whole tab session -- the same
  // probe-once-then-reconcile posture as common.js's
  // `probeAndReconcileRepullButton`. `null` = not probed yet.
  let reheatModuleEnabled = null;
  let reheatHealthProbe = null; // in-flight promise, shared by concurrent callers

  function probeReheatModule() {
    if (reheatModuleEnabled !== null) return Promise.resolve(reheatModuleEnabled);
    if (reheatHealthProbe) return reheatHealthProbe;
    reheatHealthProbe = fetch('/api/subscriptions/health')
      .then((res) => {
        reheatModuleEnabled = res.ok;
        // v1.53: the fresh answer refreshes the capability cache.
        writeCapabilityCache({ moduleEnabled: res.ok });
        return reheatModuleEnabled;
      })
      .catch(() => { reheatModuleEnabled = false; return false; })
      .finally(() => { reheatHealthProbe = null; });
    return reheatHealthProbe;
  }

  // v1.30.0 T7 (A5): `GET /api/videos` is now PAGINATED (server-authoritative,
  // default page size 60 -- see server.js's T6). `loadRelatedFiles()` and
  // `setupPrevNext()` (below) both need the FULL matching set to rank/order
  // correctly -- a truncated page would silently break related-video ranking
  // and prev/next for any library/folder over the page size (the current
  // item's own neighbor could sit past position 60). Both pass this
  // explicit, generous `limit` so the server always returns everything in
  // one response; the server itself still clamps to its own hard ceiling
  // (`MAX_LIMIT`, `lib/videoQuery.js`, comfortably above any real self-hosted
  // library), so this value is intentionally larger than that ceiling rather
  // than trying to mirror it exactly.
  const FULL_LIST_QUERY_LIMIT = 1000000;

  // Builds a view-area error message WITHOUT touching the player host's own
  // markup (never `playerWrapper.innerHTML = ...`) -- a fatal load error
  // must never nuke the player element itself, only inform the user next to
  // it. Built via DOM nodes + textContent (no innerHTML) per CONTRIBUTING's
  // XSS-safety guidance for new dynamic UI.
  function showFatalViewError(root) {
    const existing = root.querySelector('.watch-view-error');
    if (existing) existing.remove();

    const box = document.createElement('div');
    box.className = 'watch-view-error';
    box.style.cssText = 'display:flex;flex-direction:column;justify-content:center;align-items:center;padding:var(--space-12) var(--space-8);text-align:center;color:var(--text-secondary);';

    const heading = document.createElement('h3');
    heading.style.marginBottom = 'var(--space-6)';
    heading.textContent = 'Failed to Load Media';

    const message = document.createElement('p');
    message.textContent = 'The file may have been moved, deleted, or the format is unsupported by your browser.';

    const backLink = document.createElement('a');
    backLink.href = '/';
    backLink.className = 'btn';
    backLink.style.marginTop = 'var(--space-8)';
    backLink.textContent = 'Back to Home';

    box.appendChild(heading);
    box.appendChild(message);
    box.appendChild(backLink);

    const slot = root.querySelector('#player-slot');
    if (slot && slot.parentNode) {
      slot.parentNode.insertBefore(box, slot.nextSibling);
    } else {
      root.appendChild(box);
    }
  }

  function init(root) {
    controller = new AbortController();
    const { signal } = controller;

    // The persistent player controller (player.js) owns the actual
    // `<video>`/host -- this view only needs the SLOT it mounts into.
    const playerSlot = root.querySelector('#player-slot');
    if (!playerSlot || !window.FileTube || !window.FileTube.player) {
      // The slot is missing, or player.js somehow failed to load (shouldn't
      // happen -- every shell carries both) -- fail safe with a view-area
      // error rather than throwing on the next fetch.
      showFatalViewError(root);
      // v1.96 A2: initWatch never runs on this bail-out, so nothing would drop
      // the action row's `data-loading` -- clear it directly so it doesn't sit
      // shimmering (children invisible) under the error box.
      revealActionBar();
      return;
    }

    const mediaTitle = root.querySelector('#media-title');
    const viewsCount = root.querySelector('#views-count');
    const deleteBtn = root.querySelector('#delete-media-btn');
    const downloadBtn = root.querySelector('#download-media-btn');
    const uploaderAvatar = root.querySelector('#uploader-avatar-letter');
    const uploaderChannelName = root.querySelector('#uploader-channel-name');
    const uploaderSubsCount = root.querySelector('#uploader-subs-count');
    const subscribeBtn = root.querySelector('#subscribe-btn-mock');
    // B3 (v1.24.0, T6): the pin-channel button is NOT part of watch.html's
    // static markup -- this view builds it at runtime (see setupPinButton
    // below) and mounts it as a sibling of subscribeBtn. Captured here
    // (subscribeBtn's PARENT), before anything might `.remove()` subscribeBtn
    // itself, so there is always somewhere to mount into regardless of
    // whether subscribeBtn survives this load.
    const subscribeBtnContainer = subscribeBtn ? subscribeBtn.parentNode : null;
    // v1.81 write-RBAC: the EFFECTIVE library-modify capability (admin OR the
    // per-user flag) gates the delete/move/attribute affordances on this page.
    // Resolved from the memoized /api/auth/me WITHOUT blocking the player load
    // (a slow /api/auth/me must never stall playback). Fail-safe: the affordances
    // stay hidden until the capability confirms TRUE, so a capability-less member
    // (or an auth hiccup) never sees a delete/move/edit control. The server is
    // the real gate; this just removes dead buttons. setupMoveButton/
    // setupAttributeButton are ALSO called in the media-load flow (guarded), so
    // whichever of {capability, mediaData} resolves last mounts them.
    let canModifyLibrary = false;
    if (deleteBtn) deleteBtn.hidden = true; // hidden until the capability confirms
    // v1.96 A2 reveal-once barrier: the action row's FINAL button set depends
    // on BOTH async inputs -- the media record (Move/Like/.../Attribute) AND
    // the write capability. Move/Attribute are gated on canModifyLibrary and
    // mount from WHICHEVER of {mediaData, capability} resolves LAST (see the
    // "guarded, whichever resolves last mounts them" note below). So revealing
    // when only mediaData is in hand would show a partial row on a cold load
    // whose /api/auth/me lands after /api/videos -- then Move/Attribute pop in.
    // Reveal ONCE, only when BOTH have SETTLED. (Cold-cache Reheat's own async
    // health probe is the sole disclosed late-mount NOT gated here -- blocking
    // the row on a network probe would keep the common buttons non-tappable
    // longer; the v1.53 capability cache mounts it pre-reveal on warm cache.)
    let actionMediaSettled = false;
    let actionCapabilitySettled = false;
    function maybeRevealActionBar() {
      if (actionMediaSettled && actionCapabilitySettled) revealActionBar();
    }
    // typeof-guarded: a minimal harness (or a page that loads watch.js without
    // common.js) leaves fetchCurrentUser undefined - the affordances then simply
    // stay hidden rather than throwing during init (the shared-global scar).
    if (typeof fetchCurrentUser === 'function') {
      fetchCurrentUser().then(function (me) {
        canModifyLibrary = !!(me && me.user && (me.user.role === 'admin' || me.user.canModifyLibrary === true));
        if (canModifyLibrary) {
          if (deleteBtn) deleteBtn.hidden = false;
          // Mount now in case the media already loaded before this resolved.
          setupMoveButton();
          setupAttributeButton();
        }
        // The capability answer is now known (true OR false), so the final set
        // is determined -- release this half of the reveal barrier either way.
        actionCapabilitySettled = true;
        maybeRevealActionBar();
      }).catch(function () {
        // signed-out / offline -> affordances stay hidden, but the capability
        // is still SETTLED (no Move/Attribute will ever mount) -> release.
        actionCapabilitySettled = true;
        maybeRevealActionBar();
      });
    } else {
      // No capability probe at all -> Move/Attribute never mount -> settled now.
      actionCapabilitySettled = true;
      maybeRevealActionBar();
    }

    const addedDateText = root.querySelector('#added-date-text');
    const fileSizeText = root.querySelector('#file-size-text');
    const fileTypeText = root.querySelector('#file-type-text');
    const filePathText = root.querySelector('#file-path-text');

    // v1.48 item 1: the collapse/"Show more" mechanism now governs the VIDEO'S
    // DESCRIPTION (#video-description). It used to expand the static
    // self-hosting boilerplate, which is now the unnamed `.description-fileinfo`
    // block below it and is never clamped. The variable name is kept because
    // every reference below means "the thing Show more expands".
    const descriptionParagraph = root.querySelector('#video-description');
    const expandDescBtn = root.querySelector('#expand-desc-btn');

    const commentCountBadge = root.querySelector('#comment-count-badge');
    const commentsContainer = root.querySelector('#comments-container');
    const newCommentText = root.querySelector('#new-comment-text');
    const postCommentBtn = root.querySelector('#post-comment-btn');

    const starRatingControl = root.querySelector('#star-rating-control');
    const ratingText = root.querySelector('#rating-text');

    // FR-2 (T3): Prev/Next controls -- see setupPrevNext() below.
    const prevBtn = root.querySelector('#watch-prev-btn');
    const nextBtn = root.querySelector('#watch-next-btn');

    // FR-4a (v1.17.0, T3): visible autoplay toggle -- see setupAutoplayToggle() below.
    const autoplayCheck = root.querySelector('#watch-autoplay-check');

    // v1.22.0 FR-7 (TF): visible loop/repeat toggle -- see setupLoopToggle() below.
    const loopCheck = root.querySelector('#watch-loop-check');

    // FR-9 (v1.21.0, T8): theatre-mode toggle -- see setupTheatreToggle()
    // below. Wired synchronously here (not inside initWatch()'s async flow)
    // since it needs no network data and should be applied immediately, per
    // the design's "applied on watch init()."
    setupTheatreToggle();

    // v1.22.0 FR-7 (TF): loop/repeat toggle -- see setupLoopToggle() below.
    // Also wired synchronously (needs only localStorage, no network data),
    // mirroring setupTheatreToggle()'s placement above.
    setupLoopToggle();

    // #sidebar-folders-list lives in the PERSISTENT shell (outside
    // #view-root) -- wiring it through this view's own AbortController is
    // still safe (destroy() always runs before the next view re-wires it).
    // The header's #search-input/#search-btn are SHELL-owned (bound once at
    // boot by common.js -- see the C1 remediation comment there); this view
    // no longer touches them at all.
    const sidebarFoldersList = document.getElementById('sidebar-folders-list');
    const relatedContainer = root.querySelector('#related-files-container');

    // v1.52 instant watch: related-card hops seed the next watch view (the
    // main.js grid pattern -- bubble fires before the document-level anchor
    // handler; items come from this view's own list fetches).
    if (relatedContainer) {
      relatedContainer.addEventListener('click', (e) => {
        const cardLink = e.target && e.target.closest && e.target.closest('a[href*="/watch.html?v="]');
        if (!cardLink) return;
        let id = null;
        try { id = new URL(cardLink.href, window.location.origin).searchParams.get('v'); } catch { /* no seed */ }
        const item = id ? watchSeedLookup.get(id) : null;
        if (item && window.FileTube && window.FileTube.stashWatchSeed) {
          window.FileTube.stashWatchSeed(item, { folderSettings });
        }
      }, { signal });
    }

    // v1.22.0 FR-5 (AC32-AC38): desktop-sidebar channel pins -- a SEPARATE
    // fetch against the module's own gated pin store, independent of
    // initWatch()'s own folder-list fetch/render below: renderPinnedSidebar
    // inserts `#sidebar-pinned-section` as a SIBLING of, never a child of,
    // `#sidebar-folders-list`, so it is unaffected regardless of fetch/
    // render ordering between the two. A 404 (module disabled) resolves to
    // `[]` (no pins rendered), preserving the disabled-module no-op
    // guarantee -- this never logs/throws on a 404. Read-only: never writes
    // db.folders/folderSettings.
    // v1.37.0: channel pins + book-shelf pins, one merged sidebar section.
    // v1.53: paint the pinned section from the capability cache in frame one;
    // the real fetch below replaces it wholesale (reconcile-by-rebuild).
    primePinnedSidebarFromCache();
    fetchAllPins().then((pins) => renderPinnedSidebar(pins));

    // Parse media ID (?v=, with the legacy ?id= push-banner fallback -- see
    // resolveWatchMediaId's own comment above).
    const urlParams = new URLSearchParams(window.location.search);
    const mediaId = resolveWatchMediaId(window.location.search);
    // v1.36.2 (Dean): the LAUNCH-CONTEXT param -- which list the user was
    // browsing when they opened this video. Only 'liked' is recognized
    // today (an unknown/absent value degrades to the folder-scoped
    // behavior, byte-identical to pre-v1.36.2); the shape generalizes to
    // future virtual views (search, feeds) without another plumbing pass.
    const listContext = urlParams.get('list') === 'liked' ? 'liked' : null;
    // v1.40.0 (Dean): the FULL browse context the user was viewing (folder /
    // search / liked scope + sort + shuffle seed), superseding `list=liked`
    // (still honored above as a fallback for old links). `rawBrowseCtx` is the
    // opaque encoded param, carried verbatim across prev/next/autoplay hops and
    // into the player; `browseCtx` is its decoded form for the prev/next fetch.
    const rawBrowseCtx = urlParams.get('ctx') || '';
    const browseCtx = decodeListContext(rawBrowseCtx);

    if (!mediaId) {
      window.location.href = '/';
      return;
    }

    let mediaData = null;
    // C2 (v1.24 UX Round, Wave 3, T10 follow-up): one-shot guard so
    // pingView() below fires AT MOST ONCE per view instance -- fresh
    // (`false`) on every init(), like `currentSubState`/`moveBtn` above.
    let viewPinged = false;
    let folderSettings = {};   // { "<path>": { name, hidden } } — for channel display name
    // v1.73.1 slim-gate C1: the module-contributed roots - the shared
    // sidebar filter needs them HERE too (the v1.41.4 class re-bit at its
    // own documented site: threaded on home/setup, skipped on watch).
    let watchSyntheticFolders = [];
    // C1 follow-up (v1.24 UX Round, Wave 3): the FULL folders array from the
    // SAME `GET /api/config` fetch initWatch() already makes for the sidebar
    // (step 1 below) -- no new network call. Feeds `showMoveModal`'s
    // `folders` argument for this page's "Move to..." trigger (setupMoveButton
    // below). `moveBtn` is the runtime-created control itself -- fresh per
    // view instance, like `pinBtn` below.
    let currentFolders = [];
    let moveBtn = null;
    // v1.30 C2 (Visual polish cluster): watch-page "Like" toggle -- the
    // runtime-created control itself (fresh per view instance, like
    // `moveBtn`/`pinBtn` above) plus its local mirror of server membership.
    // Like state IS `db.liked` membership (server.js) -- `currentLikeState`
    // here is purely a UI-local cache of that membership for THIS view
    // instance, never an independent source of truth; every toggle round-
    // trips through `POST`/`DELETE /api/liked/:id` before this local mirror
    // is updated.
    let likeBtn = null;
    let currentLikeState = { liked: false };
    // v1.72 (cap 6): the manual mark-as-watched toggle - the podcast
    // played-toggle pattern on the watch action bar. Watched state IS the
    // server's derivation (latch OR >=90% position, GET /api/videos/:id's
    // watchState field); this local mirror updates ONLY after
    // POST/DELETE /api/watched/:id resolves, exactly like the Like button.
    let watchedBtn = null;
    let currentWatchedState = { watched: false };
    // v1.33 T2: watch-page "Share" button -- the runtime-created control
    // itself (fresh per view instance, like `moveBtn`/`likeBtn` above).
    // Mounted ONLY when the server derived an original YouTube link for this
    // item (`mediaData.watchUrl`, GET /api/videos/:id) -- a plain local
    // library file has nothing to share, so it gets no button at all.
    let shareBtn = null;
    // Restores the button's label after the transient "Copied!" feedback of
    // the clipboard fallback below; tracked so a rapid double-tap never
    // stacks two timers (the second tap clears the first).
    let shareBtnResetTimer = null;
    // v1.49 (Dean): the per-video "reheat" control -- the runtime-created
    // control itself (fresh per view instance, like `moveBtn`/`likeBtn`/
    // `shareBtn` above), plus the poll handle for the background job it
    // starts. The poll handle is tracked so leaving the page mid-reheat can
    // stop it: this is an SPA, the view instance is torn down on navigation,
    // and an un-cleared interval would keep polling (and keep holding a
    // reference to a dead view's DOM) for the life of the tab. See the
    // v1.41.11 lesson about async-registered handlers outliving their view.
    let reheatBtn = null;
    let reheatPollTimer = null;
    // v1.53: the manual-attribution control (fresh per view instance, like
    // moveBtn/likeBtn/reheatBtn above).
    let attributeBtn = null;
    // v1.49 gate fix (adversarial WARNING 2): the dismiss handle for an open
    // relocation confirm, so navigating away closes it instead of leaving a
    // "move this file" dialog for the PREVIOUS video on screen.
    let relocationDismiss = null;
    // v1.110 (Dean): dismiss handle for the share "video vs current time" choice
    // modal, torn down on view abort like relocationDismiss (a body-level modal
    // survives SPA nav on its own -- the v1.49 lesson).
    let shareChoiceDismiss = null;
    // One abort registration per view instance (see pollReheat's own comment).
    let reheatAbortHooked = false;
    // FIX C (two-reviewer-gate follow-up): the FR-2-derived display name,
    // computed once in initWatch() via the SAME resolveChannelName() call
    // that drives the on-page uploader display, cached here so the Subscribe
    // modal (below) can read it directly rather than back-reading the
    // rendered `#uploader-channel-name` DOM node's textContent -- a future
    // refactor of that DOM node's rendering can no longer silently break the
    // modal's pre-fill.
    let currentChannelName = '';
    // v1.52 instant watch: id -> full list item, populated by the view's own
    // list fetches (related + prev/next) so THEIR outbound hops can stash a
    // seed too. Fresh per view instance like every state above.
    const watchSeedLookup = new Map();

    // v1.52 instant watch: consume the seed the click surface stashed and
    // paint SYNCHRONOUSLY -- same frame as the SPA swap, so the common path
    // (tapping a card in-app) never shows a placeholder frame. Partial seeds
    // (bell rows) paint what they carry; the markup skeletons cover the rest
    // until hydration. initWatch()'s detail fetch below re-runs the same
    // painter with authoritative data.
    const watchSeed = (window.FileTube && window.FileTube.consumeWatchSeed)
      ? window.FileTube.consumeWatchSeed(mediaId)
      : null;
    if (watchSeed) {
      if (watchSeed.folderSettings) folderSettings = watchSeed.folderSettings;
      const seededChannelName = resolveChannelName(watchSeed.item, folderSettings);
      currentChannelName = seededChannelName;
      paintMetadata(watchSeed.item, seededChannelName);
    }
    // Stars, rating text, and the mock comments derive from the media ID
    // alone -- they were only ever gated behind two round trips by CALL
    // ORDER, never by data. Render unconditionally at init so they exist in
    // frame one on every path (their old initWatch() call sites are gone).
    renderStarRating();
    loadComments();

    // (v1.54 A1's frame-one Subscribe/Pin seed render moved BELOW the
    // applier's own `let` declarations -- gate round 1, adversarial C1: from
    // here it threw a TDZ ReferenceError on `currentSubState` and the
    // router's catch swallowed it, killing the rest of init. The browser
    // paints only after init returns, so any synchronous position in this
    // body is equally "frame one".)

    // W1 remediation (v1.16.0): for the DOCKED -> FULL "adopt" path (tapping
    // the docked mini-player while the SAME video is already loaded),
    // reparent the existing host + re-assert `play()` as EARLY as possible --
    // SYNCHRONOUSLY, right here, before EITHER of initWatch()'s own awaited
    // /api/config and /api/videos/:id fetches below. An adopt-load needs
    // none of that: `player.load()`'s adopt branch ignores its `data`
    // argument entirely (it's a pure reparent, see player.js), so gating it
    // behind two more chained network round-trips only widened the window
    // during which iOS could decide the tap's user-gesture chain had lapsed,
    // silently leaving the expanded player paused (see player.js's "iOS
    // reparent risk" comment for the full rationale). initWatch() below still
    // calls `player.load()` again once the real data resolves -- harmless/
    // idempotent on the adopt path (see `load()`), and the ONLY path taken at
    // all for a genuine new load (a fresh watch entry, a different video),
    // which still correctly awaits its metadata first.
    // D1 (v1.24 UX Round, Wave 4, T12): the SAME synchronous-entry decision
    // above now ALSO covers the watch -> watch, different-video case (Prev/
    // Next, a related-card click) via `resolveWatchEntryReparentAction` --
    // see that function's own comment for the full root-cause writeup.
    const entryReparentAction = resolveWatchEntryReparentAction(
      window.FileTube.player.currentId,
      mediaId,
      window.FileTube.player.getState()
    );
    // Gate round 2 (adversarial W-B): whether a full seed will pre-load,
    // decided ONCE -- it changes what the 'reparent' branch below should do.
    const canSeedPreload = Boolean(watchSeed && isFullWatchSeedItem(watchSeed.item));
    if (entryReparentAction === 'adopt') {
      // v1.40.0: carry the CURRENT browse context on the early adopt-mount too,
      // so re-opening a docked video from a new list view refreshes autoplay's
      // context immediately (load()'s adopt branch applies it). Data is
      // otherwise ignored on adopt.
      const mountedEarly = window.FileTube.player.load(mediaId, { browseCtx: rawBrowseCtx }, { slot: playerSlot });
      if (!mountedEarly) showFatalViewError(root);
    } else if (entryReparentAction === 'reparent' && !canSeedPreload) {
      // Eagerly reparent the STILL-loaded previous video's host into THIS
      // view's #player-slot right now -- a pure reparent (`expand` ==
      // `mountInSlot`), never touching src/currentTime -- so it never goes
      // dark/detached while initWatch() below awaits its two fetches.
      // `player.load(mediaId, mediaData, ...)` further down in initWatch()
      // still performs the real teardown + new-media load once mediaData
      // resolves, completely unchanged. Gate round 2 (W-B): SKIPPED when a
      // full seed is about to pre-load the NEW video right below -- keeping
      // the old one playing under the new video's already-painted metadata
      // was a title/audio mismatch window, and the pre-load's own
      // teardown+mount supersedes the eager reparent entirely.
      window.FileTube.player.expand(playerSlot);
    }

    // v1.52 T2 (+ gate round 2 W-B): a FULL seed starts the real media NOW,
    // two round trips before hydration -- on 'defer' (nothing loaded) AND on
    // 'reparent' (a DIFFERENT video still playing from the previous view):
    // the seed IS the requested video, which voids the reparent's
    // keep-alive rationale -- pre-wave that window showed neutral
    // placeholders over the old video, but a seeded paint asserts the NEW
    // title, so the audio/metadata must switch together. List data carries
    // everything the player needs for the stream decision
    // (type/needsTranscode/transcodeStatus), the aspect reservation
    // (width/height) and the poster (hasThumbnail). Resume is unaffected
    // either way -- the player always fetches /api/progress/:id itself
    // (gate QA W3: the seed's progress field plays no part).
    //
    // CHAPTERS ARE DELIBERATELY STRIPPED (gate C2): the list record carries
    // the RAW `chapters`/`chaptersManual` sets, and handing them to the
    // player would bypass the server's manual > embedded > description
    // precedence (resolveItemChapters, detail route only) -- painting junk
    // embedded chapters an operator manually overrode. applyLateDetail at
    // hydration is the ONLY chapters writer on this path. Partial seeds
    // (bell rows) skip pre-load entirely: no type, no stream decision.
    let seedPreloaded = false;
    if ((entryReparentAction === 'defer' || entryReparentAction === 'reparent') && canSeedPreload) {
      const seedItemForLoad = { ...watchSeed.item };
      delete seedItemForLoad.chapters;
      delete seedItemForLoad.chaptersManual;
      seedPreloaded = window.FileTube.player.load(
        mediaId,
        { ...seedItemForLoad, channelName: currentChannelName, browseCtx: rawBrowseCtx },
        { slot: playerSlot }
      ) === true;
    }

    // C2 (v1.24 UX Round, Wave 3, T10 follow-up): fires the view-count ping
    // (`POST /api/videos/:id/view`, added by T10 -- since v1.42 it
    // increments `db.viewCounts[id]` by exactly 1; the counter was extracted
    // OUT of the metadata item, where the scan could clobber it) exactly
    // ONCE per watch-page open. `viewPinged` (declared above, alongside `mediaData`) is a
    // one-shot flag scoped to THIS view instance, fresh on every init() --
    // mirrors how setupPinButton/setupMoveButton etc. guard their own
    // once-per-open setup work, so a stray second call (there isn't one
    // today -- initWatch() only reaches this once per open -- but this keeps
    // it true even if that ever changes) can never double-count a single
    // watch. Deliberately NOT called from the progress-saving path
    // (`POST /api/progress`, player.js) or the `/video/:id` Range-serve path
    // -- both fire many times per single playback (periodic timestamp saves;
    // one call per byte-range chunk a browser requests) and would wildly
    // over-count a view, which is exactly why T10's route comment calls
    // those out as the two routes this must stay independent of. Best-effort
    // and fire-and-forget: a missing view count is purely cosmetic (see
    // server.js), so this is never `await`ed by initWatch() and a
    // failed/rejected fetch (including this view's own AbortController
    // firing mid-flight, on navigate-away) is silently swallowed -- it must
    // never throw, block, or delay player start.
    function pingView(id) {
      if (viewPinged) return;
      viewPinged = true;
      fetch('/api/videos/' + encodeURIComponent(id) + '/view', { method: 'POST', signal }).catch(() => {});
      // v1.68 (Dean ruling 4): the same play moment retires this video's
      // DELIVERED push banner from the phone's shade (common.js helper -
      // feature-detected, silent no-op outside the PWA). The server-side
      // half (the bell-row dismissal) rides the ping above.
      closeDeliveredPushBanners(id);
    }

    // Initialize page
    async function initWatch() {
      try {
        // 1+2. v1.52 T3: config (sidebar + folderSettings) and the media
        // detail fetch run in PARALLEL -- they were strictly serial for no
        // reason, which was a full extra round trip on every cold open (the
        // recon-measured chain). One RTT saved for every path, seeded or not.
        // Gate round 2 (adversarial W-A): both fetches carry this view's
        // abort signal, so navigating away cancels them instead of leaving
        // an abandoned view's continuations to run against the LIVE player.
        const [configRes, mediaRes] = await Promise.all([
          fetch('/api/config', { signal }),
          fetch(`/api/videos/${mediaId}`, { signal }),
        ]);
        const configData = await configRes.json();
        folderSettings = configData.folderSettings || {};
        watchSyntheticFolders = Array.isArray(configData.syntheticFolders) ? configData.syntheticFolders : [];
        currentFolders = configData.folders || [];
        renderSidebarFolders(configData.folders || [], folderSettings);

        if (!mediaRes.ok) {
          throw new Error('Media file not found');
        }
        mediaData = await mediaRes.json();

        // 2b. C2 (v1.24 UX Round, Wave 3, T10 follow-up): now that mediaData
        // (a REAL, resolved media item) is in hand, fire the once-per-open
        // view-count ping -- see pingView()'s own comment above for why this
        // exact spot, and why it's fire-and-forget.
        pingView(mediaData.id);

        // Channel name resolution is shared with the list cards (see common.js)
        // so the author shown here, on the home grid, AND on the persistent
        // player's Media Session metadata all agree.
        const channelName = resolveChannelName(mediaData, folderSettings);
        currentChannelName = channelName;

        // 3. Populate metadata details
        populateMetadata(channelName);

        // 3b. C1 follow-up (v1.24 UX Round, Wave 3): mount/refresh the
        // "Move to..." trigger now that both `mediaData` and `currentFolders`
        // are resolved.
        setupMoveButton();

        // 3c. v1.30 C2 (Visual polish cluster, T11): mount/refresh the
        // "Like" toggle now that `mediaData` (carrying the server-derived
        // `liked` field) is resolved.
        setupLikeButton();

        // 3c-bis. v1.72 (cap 6): mount/refresh the manual "Watched" toggle
        // now that `mediaData` (carrying the server-derived `watchState`)
        // is resolved.
        setupWatchedButton();

        // 3d. v1.33 T2: mount the "Share" button when the server derived an
        // original YouTube link for this item (`mediaData.watchUrl`).
        setupShareButton();

        // 3e. v1.49 (Dean): mount the per-video "Reheat" button. Gated on a
        // latched yt-dlp health probe, so this is at most one extra request
        // per tab session, and none at all once the answer is known.
        setupReheatButton();

        // 3f. v1.53 (Dean): mount the "Attribute..." control for genuinely
        // unattributed items (absent otherwise -- the AC15 posture).
        setupAttributeButton();

        // 3g. v1.96 A2 (Dean): the media half of the button set is now mounted.
        // Release the media side of the reveal barrier; the row reveals in one
        // shot once the capability side has ALSO settled (so Move/Attribute --
        // which mount from whichever of {media, capability} resolves last --
        // are never shown popping in post-reveal). The one late-mount NOT gated
        // by the barrier is the COLD-cache Reheat button (setupReheatButton's
        // async probe), a disclosed 1-RTT residual the v1.53 capability cache
        // avoids on warm cache. See the barrier note above and ROADMAP.
        actionMediaSettled = true;
        maybeRevealActionBar();

        // 4. Mount/play this media in the persistent player controller. This
        // is idempotent -- if the controller already has this exact id loaded
        // (the docked mini-player was tapped, or a related-card click landed
        // back on the same video), it's just a reparent into `playerSlot`
        // (no restart -- and, per the early adopt fast-path above, likely
        // already done by the time we get here); otherwise it's a genuine new
        // load, including its own resume-overlay/transcode-overlay/Media
        // Session setup. `data` merges in `channelName` since the controller
        // doesn't have folderSettings. v1.40.0: `browseCtx` (the raw encoded
        // context param) rides along so autoplay-at-end -- which runs off the
        // controller's own state, even while docked on another page -- can
        // advance through the SAME browsed list/order the on-page prev/next use.
        const mounted = window.FileTube.player.load(mediaId, { ...mediaData, channelName, browseCtx: rawBrowseCtx }, { slot: playerSlot });
        if (!mounted) {
          showFatalViewError(root);
        }
        // v1.52: a seeded pre-load ran on LIST data; hand the
        // server-resolved chapters (the one detail-only field the player
        // renders) through the id-guarded late seam -- never a second load,
        // never a src/currentTime touch. (The load() just above was the
        // adopt/no-op path for this case.)
        if (seedPreloaded) {
          window.FileTube.player.applyLateDetail(mediaId, mediaData);
        }

        // 5. Load related sidebar
        loadRelatedFiles();

        // (Comments + star rating render at init() now -- v1.52: they are
        // id-only and belong to frame one, not to the data round trips.)

        // 8. Prev/Next (FR-2, T3): derive this video's position in the
        // current home sort order and wire the controls.
        setupPrevNext();

        // 9. Autoplay toggle (FR-4a, v1.17.0, T3): read/write the persisted
        // autoplayNext setting.
        setupAutoplayToggle();

        // 10. Subscribe toggle (FR-1/FR-3, v1.20.0, T3): resolve this file's
        // channel identity, probe the module + existing subscription list,
        // and wire the button's click handler. Its own async setup function
        // (mirroring setupPrevNext/setupAutoplayToggle's pattern above)
        // rather than inlined into populateMetadata(), which stays a plain
        // synchronous DOM-fill -- the state this needs (module-enabled probe
        // + subscription list) is computed here, on this same media load.
        setupSubscribeButton();

      } catch (err) {
        // Gate round 2 (adversarial W-A, the fix-round-fix-regresses class):
        // a DEAD view's catch must never touch the live player or the DOM.
        // Without this, a seeded tap -> navigate-away -> dock -> late fetch
        // failure ran this closure's close() against whatever is playing
        // NOW. The view's AbortController is the staleness truth (the same
        // idiom the prev/next handlers use).
        if (signal.aborted) return;
        console.error(err);
        // v1.52 gate W1: a seeded pre-load may already be STREAMING a file
        // whose detail fetch just said is gone -- a playing/erroring video
        // above a fatal "file not found" box contradicts itself. Stand the
        // player down before showing the error.
        if (seedPreloaded) {
          try { window.FileTube.player.close(); } catch (_) { /* best-effort */ }
        }
        showFatalViewError(root);
        if (mediaTitle) {
          mediaTitle.textContent = 'Error loading file details';
          mediaTitle.style.color = 'var(--yt-red)';
        }
        // v1.52 gate W1: the error state must not leave ANY field shimmering
        // forever (pre-fix only the title's skeleton was stripped).
        root.querySelectorAll('.skeleton-shimmer').forEach((el) => el.classList.remove('skeleton-shimmer'));
        const descSkelErr = root.querySelector('#video-desc-skel');
        if (descSkelErr) descSkelErr.hidden = true;
        // v1.96 A2: a failed record load must never strand the action row
        // invisible-under-shimmer (the `data-loading` children are
        // visibility:hidden). With no mediaData, Move/Attribute never mount
        // (both setups require it), so the static set is final -- release the
        // media side and let the barrier reveal once the capability settles too.
        actionMediaSettled = true;
        maybeRevealActionBar();
      }
    }

    // v1.96 A2: drop the `data-loading` attribute so `.watch-actions`'
    // children (star-rating + the now-complete button set) become visible in
    // one shot -- the reveal-once that eliminates the partial->full pop-in.
    // Idempotent (removeAttribute on an absent attr is a no-op), so calling it
    // from both the success path and the catch is safe.
    function revealActionBar() {
      const wa = root.querySelector('.watch-actions');
      if (wa) wa.removeAttribute('data-loading');
    }

    // F1 (v1.24.0, T4): applies the avatar precedence -- a real captured
    // `channelAvatarUrl` (C6, populated by T11 in Wave 3; always null/absent
    // today) wins when present, else the deterministic generated
    // {glyph, color} fallback -- via common.js's frozen `resolveAvatarSource`
    // contract (T3, same wave). Shared by BOTH the persistent uploader
    // avatar and every per-comment avatar below, which is what guarantees
    // the SAME name always renders the SAME avatar everywhere on this page
    // (F1's MANUAL acceptance criterion). createElement/textContent only --
    // never innerHTML. `el` is fully reset on every call, since the uploader
    // avatar is a single SPA-reused node that must never keep a stale
    // glyph/image from the previously-viewed item.
    function applyAvatarToElement(el, name, channelAvatarUrl) {
      if (!el) return;
      const source = resolveAvatarSource(name, channelAvatarUrl);
      el.textContent = '';
      if (source.type === 'url') {
        el.style.backgroundColor = '';
        el.style.color = '';
        el.style.overflow = 'hidden';
        const img = document.createElement('img');
        img.alt = '';
        img.src = source.url;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.display = 'block';
        el.appendChild(img);
        return;
      }
      el.style.overflow = '';
      el.style.backgroundColor = source.color;
      el.style.color = 'var(--on-accent)'; // AVATAR_PALETTE entries are all dark -- the on-accent white keeps the glyph legible regardless of era theme
      el.textContent = source.glyph;
    }

    // v1.52 instant watch: the ONE metadata painter, callable from the seed
    // pre-paint (init, synchronous) AND from initWatch()'s hydration -- so
    // the two can never disagree on how a field renders. Every field write
    // is GUARDED on the value being present: a partial seed (bell rows)
    // paints only what it carries, leaving the markup skeletons for the
    // rest, and hydration fills in behind it. Painting a field strips its
    // skeleton class. `isFullItem` (list/detail records always carry size +
    // filePath; partial seeds never do) gates the description block, where
    // "tags absent" legitimately means "this file HAS none" only on a full
    // record.
    function paintMetadata(item, channelName) {
      // The PURE plan (common.js deriveWatchPaintPlan) decides which fields
      // render and as what strings; this applier writes the plan verbatim --
      // seed pre-paint and hydration repaint cannot disagree by construction.
      const plan = deriveWatchPaintPlan(item, channelName);
      if (!plan) return;
      const paintText = (el, value) => {
        if (!el || value === undefined) return;
        el.textContent = value;
        el.classList.remove('skeleton-shimmer');
      };
      if (plan.title !== undefined) {
        paintText(mediaTitle, plan.title);
        document.title = `${plan.title} - FileTube`;
      }
      paintText(viewsCount, plan.viewsLabel);
      if (plan.channelName !== undefined) {
        // v1.52 T3 hydration discipline: applyAvatarToElement fully RESETS
        // the node (recreates the <img>), so re-running it with identical
        // inputs at hydration would flicker the already-painted avatar. The
        // key diff makes a repaint happen ONLY when the rendered source
        // actually changes -- which is exactly the one legitimate upgrade
        // (seed had no URL, hydration resolved the yt-dlp subscription
        // fallback). The fragment is fresh-parsed per navigation, so the
        // dataset key can never carry over from a previous item.
        const avatarKey = `${plan.channelName}|${plan.channelAvatarUrl}`;
        if (uploaderAvatar && uploaderAvatar.dataset.ftAvatarKey !== avatarKey) {
          applyAvatarToElement(uploaderAvatar, plan.channelName, plan.channelAvatarUrl);
          uploaderAvatar.dataset.ftAvatarKey = avatarKey;
        }
        uploaderAvatar.classList.remove('skeleton-shimmer');
        paintText(uploaderChannelName, plan.channelName);
        // Creator/uploader name links to THIS item's folder content view
        // (/?root=<folder>). Re-set (or cleared) every paint so the
        // SPA-reused node never keeps a stale href from the previous item.
        if (plan.filePath !== undefined) {
          const uploaderLinkHref = resolveUploaderLinkHref({ filePath: plan.filePath });
          if (uploaderLinkHref) uploaderChannelName.href = uploaderLinkHref;
          else uploaderChannelName.removeAttribute('href');
        }
        paintText(uploaderSubsCount, plan.subsLabel);
      }
      paintText(addedDateText, plan.dateLabel);
      paintText(fileSizeText, plan.sizeLabel);
      paintText(fileTypeText, plan.typeLabel);
      paintText(filePathText, plan.filePath);

      // FR-3 (v1.19.0): wire the Download button per paint -- the SPA reuses
      // this anchor node, so both attributes are re-set (never left stale
      // from a previous item). The save is authoritative on the server's
      // Content-Disposition header; the `download` attribute is a filename
      // hint for browsers that honor it.
      if (downloadBtn) {
        downloadBtn.href = `/video/${encodeURIComponent(plan.id)}?download=1`;
        downloadBtn.setAttribute('download', `${item.title || 'download'}${item.ext || ''}`);
      }

      // v1.63 playback queue: arm both verbs with THIS load's id. Direct
      // onclick (not addEventListener) so a re-arm on the next SPA load
      // REPLACES the handler - the accumulate-listeners leak class.
      const queueAddBtn = root.querySelector('#queue-add-btn');
      const queueNextBtn = root.querySelector('#queue-next-btn');
      if (queueAddBtn) queueAddBtn.onclick = () => addToQueue(plan.id, 'end');
      if (queueNextBtn) queueNextBtn.onclick = () => addToQueue(plan.id, 'next');

      if (plan.isFullItem) {
        renderVideoDescription(item.tags, item.title);
        renderEmbeddedTags(item.tags, item.title);
        // Measure once the (async) webfont has loaded, so line wrapping --
        // and thus the overflow check -- reflects the final font.
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(setupDescriptionToggle);
        } else {
          setupDescriptionToggle();
        }
      }
    }

    // Hydration entry, unchanged contract for initWatch(): paints from the
    // resolved mediaData.
    function populateMetadata(channelName) {
      paintMetadata(mediaData, channelName);
    }

    // v1.48 item 1: write the video's own description into the box. `textContent`
    // (never innerHTML) because this is attacker-influenced text read straight out
    // of a downloaded file's metadata tags -- and setting it to '' is what makes
    // `.video-description:empty` collapse the element for files with none.
    function renderVideoDescription(tags, title) {
      if (!descriptionParagraph) return;
      descriptionParagraph.textContent = resolveDisplayDescription(tags, title);
      // v1.52: the cold-load skeleton lines under the description collapse
      // the moment a real (possibly empty) description is painted.
      const descSkel = root.querySelector('#video-desc-skel');
      if (descSkel) descSkel.hidden = true;
    }

    // Only offer "Show more" when the description overflows by a meaningful amount;
    // otherwise show it in full. Avoids the silly toggle that hid a single line.
    function setupDescriptionToggle() {
      if (!descriptionParagraph || !expandDescBtn) return;
      descriptionParagraph.classList.remove('expanded');
      expandDescBtn.textContent = 'Show more';
      // v1.48 item 1: with no description there is nothing to expand -- the
      // element is `display: none` via `:empty`, so its scrollHeight/clientHeight
      // are both 0 and the overflow test below would otherwise leave a "Show
      // more" button sitting under an empty box.
      if (descriptionParagraph.textContent === '') {
        expandDescBtn.style.display = 'none';
        return;
      }
      const lh = parseFloat(getComputedStyle(descriptionParagraph).lineHeight) || 18;
      const hidden = descriptionParagraph.scrollHeight - descriptionParagraph.clientHeight;
      if (hidden <= lh * 1.5) {
        descriptionParagraph.classList.add('expanded'); // fits (or nearly) — show it all
        expandDescBtn.style.display = 'none';
      } else {
        expandDescBtn.style.display = '';
      }
    }

    // Additive: render any embedded file metadata (title/artist are shown elsewhere
    // so they're skipped) under the file-path block. Shows nothing if there are no
    // usable tags — the existing UI is untouched in that case.
    function renderEmbeddedTags(tags, itemTitle) {
      const el = root.querySelector('#embedded-tags');
      if (!el) return;
      const title = (itemTitle || '').toLowerCase();
      // Skip title/artist (shown elsewhere) and any tag whose value just repeats the
      // title. Cap very long values so a huge embedded tag can't blow out layout.
      //
      // v1.48 item 1: `description` is skipped here too -- it now has its own
      // full-text home at the top of this box (renderVideoDescription above), and
      // leaving it in would print it a SECOND time, still clipped to 400
      // characters, directly underneath the untruncated copy. This 400-char clip
      // deliberately survives for every OTHER tag: it exists to stop a huge
      // embedded lyrics/comment tag from blowing out the layout, and that guard is
      // still wanted for values with no expand affordance of their own.
      const clip = v => v.length > 400 ? v.slice(0, 400) + '…' : v;
      const entries = Object.entries(tags || {}).filter(([k, v]) =>
        k !== 'title' && k !== 'artist' && k !== 'description' && String(v).toLowerCase() !== title);
      if (!entries.length) { el.style.display = 'none'; return; }
      const label = k => k.charAt(0).toUpperCase() + k.slice(1);
      el.innerHTML = '<div class="embedded-tags-title">Embedded info</div>' +
        entries.map(([k, v]) =>
          `<div class="embedded-tag"><span class="embedded-tag-key">${escapeHtml(label(k))}:</span> ${escapeHtml(clip(String(v)))}</div>`
        ).join('');
      el.style.display = 'block';
    }

    // NOTE (T2): Media Session setup, resume overlay, transcode overlay +
    // polling, +-15s skip controls, rotate-to-fullscreen, keyboard shortcuts,
    // and progress saving all moved into the persistent player controller
    // (public/js/player.js) -- they're triggered by the `window.FileTube.player
    // .load(...)` call in initWatch() above, not by this view directly.

    // Load related files
    async function loadRelatedFiles() {
      // v1.99 shimmer sweep: reveal the header + seed shimmer rows BEFORE the
      // fetch, so the rail shimmers instead of sitting blank. The existing
      // innerHTML= (real cards / "No other files" / the catch's error box) is the
      // ONE reveal - each clears the seed, so it never strands.
      const relatedHeaderSeed = root.querySelector('#related-header');
      if (relatedHeaderSeed) relatedHeaderSeed.hidden = false;
      relatedContainer.innerHTML = buildRelatedSkeletonCards(6);
      try {
        // v1.30.0 T7: `GET /api/videos` now returns `{ items, total, offset,
        // limit }` (paginated, default page size 60) rather than a bare
        // array -- rankRelated needs the FULL library to find the current
        // item's genuine best matches (not just whatever happened to land on
        // page 1), so this explicitly requests everything via
        // `FULL_LIST_QUERY_LIMIT` (see its own comment, above).
        const res = await fetch(`/api/videos?limit=${FULL_LIST_QUERY_LIMIT}`);
        const data = await res.json();
        const allFiles = Array.isArray(data.items) ? data.items : [];
        // v1.52: every fetched item can seed an outbound hop.
        for (const it of allFiles) { if (it && it.id) watchSeedLookup.set(it.id, it); }

        // Fuzzy-similar ranking (title/filename token overlap, shared folder,
        // shared channel/artist), falling back to most-recent when thin. See
        // docs/exec-plans/completed/2026-07-05-audio-art-and-related.md ("Feature 2").
        const related = rankRelated({ ...mediaData, id: mediaId }, allFiles);

        // v1.52: the header appears together with its content (never over an
        // empty list).
        const relatedHeader = root.querySelector('#related-header');
        if (relatedHeader) relatedHeader.hidden = false;

        if (related.length === 0) {
          relatedContainer.innerHTML = '<div style="color: var(--text-secondary); font-style: italic;">No other files found.</div>';
          return;
        }

        relatedContainer.innerHTML = related.map(item => {
          const durationStr = item.duration > 0 ? formatDuration(item.duration) : (item.type === 'audio' ? 'Audio' : '');
          const durationBadge = durationStr ? `<div class="duration-badge">${durationStr}</div>` : '';
          const views = resolveViewCountLabel(item);

          return `
            <a href="/watch.html?v=${item.id}" class="related-card">
              <div class="related-thumb">
                <img src="/thumbnail/${item.id}" style="width:100%; height:100%; object-fit:cover;" loading="lazy" />
                ${durationBadge}
              </div>
              <div class="related-info">
                <div class="related-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
                <div class="related-uploader">${escapeHtml(item.folderName)}</div>
                <div class="related-meta">${views}</div>
              </div>
            </a>
          `;
        }).join('');

      } catch (e) {
        console.error('Error loading related files:', e);
        const relatedHeader = root.querySelector('#related-header');
        if (relatedHeader) relatedHeader.hidden = false;
        relatedContainer.innerHTML = '<div style="color: var(--yt-red);">Error loading related files.</div>';
      }
    }

    // FR-2 (T3): Prev/Next -- steps through the SAME ordered "playlist" the
    // home grid shows (the persisted `filetube_sort`), re-derived from the
    // FULL library on every init() so a refresh/deep-link always computes the
    // correct position (never relies on transient navigation state). Uses
    // the shared deriveOrderedIds/computeNeighbors helpers (common.js) --
    // the persistent player controller's autoplay-next 'ended' handler
    // (FR-3, player.js) calls the exact same two functions, so the two
    // features can never disagree on what "next" means.
    //
    // NOTE: this intentionally issues its OWN /api/videos fetch rather than
    // reusing loadRelatedFiles()'s -- the two serve different orderings
    // (rankRelated's similarity order vs. the home sort order) and this file
    // already makes several small independent fetches per visit (config,
    // media, related, comments), so a second small fetch here is consistent
    // with the existing style rather than a new pattern.
    // v1.63 (Dean ruling 5): the "playing from queue" box, rendered in the
    // uploader block's slot (watch.html #queue-upnext-box) ONLY while this
    // very item is the queue's pointer entry - browsing to an unrelated
    // video leaves the box hidden even with a queue banked. createElement/
    // textContent only. Re-rendered per load by setupPrevNext (which has
    // the queue payload in hand).
    function renderQueueUpNextBox(q, currentMediaId) {
      const box = root.querySelector('#queue-upnext-box');
      if (!box) return;
      box.hidden = true;
      box.textContent = '';
      const entries = q && Array.isArray(q.entries) ? q.entries : [];
      const pointerUid = q && typeof q.pointerUid === 'string' ? q.pointerUid : null;
      if (!pointerUid || entries.length === 0) return;
      const idx = entries.findIndex((e) => e && e.uid === pointerUid);
      if (idx === -1 || !entries[idx] || entries[idx].mediaId !== currentMediaId) return;
      const label = document.createElement('span');
      label.className = 'queue-upnext-label';
      label.textContent = `Playing from queue - ${idx + 1}/${entries.length}`;
      box.appendChild(label);
      const next = entries[idx + 1] || null;
      const nextLine = document.createElement(next && next.item ? 'a' : 'span');
      nextLine.className = 'queue-upnext-next';
      if (next && next.item) {
        // v1.71: kind-derived via the shared helper - a podcast entry's
        // up-next link opens the podcasts place, not a dead watch page.
        nextLine.href = (window.FileTube && typeof window.FileTube.queueEntryHref === 'function')
          ? window.FileTube.queueEntryHref(next)
          : `/watch.html?v=${encodeURIComponent(next.mediaId)}`;
        nextLine.textContent = `Up next: ${next.item.title || next.item.name || ''}`;
      } else {
        nextLine.textContent = 'Last in queue';
      }
      box.appendChild(nextLine);
      box.hidden = false;
    }

    async function setupPrevNext() {
      if (!prevBtn || !nextBtn) return;
      try {
        // Prev/Next walk the CURRENT ITEM'S FOLDER (Dean: "next/prev should be
        // in the folder your content is in, not all files"), scoped via the
        // home view's existing `?root=<folder>` filter. This also fixes prev/next
        // being greyed out for items in "Hide from home" folders -- the unscoped
        // /api/videos list excludes those, so the current item wasn't found and
        // computeNeighbors returned nothing. A folder query always includes it.
        // v1.30.0 T7: same paginated `{ items, ... }` shape + FULL-set
        // requirement as loadRelatedFiles() above -- deriveOrderedIds needs
        // the current item's folder-mates in full, or its neighbor could sit
        // past a truncated page-1 boundary and prev/next would wrongly grey
        // out.
        // v1.36.2 (Dean): when the player was launched FROM the Liked view
        // (`?list=liked`, set by the home grid's cards -- see main.js's
        // buildCardHtml), prev/next walk the LIKED list instead of the
        // item's folder: that is the list the user was actually browsing,
        // and a cross-folder liked item frequently has no folder-mates at
        // all (both buttons greyed -- the reported bug). GET /api/liked
        // returns the identical {items,...} shape; ORDER parity with the
        // grid comes from the client-side deriveOrderedIds re-sort below
        // (the same resolved key the grid uses), exactly like the folder
        // path -- the server's own default sort is immaterial here.
        // v1.40.0 (Dean): when a full browse context travelled with the link
        // (`?ctx=`, set by the home grid's cards -- see main.js), prev/next walk
        // the EXACT list the user was viewing, in its EXACT on-screen order --
        // the folder/search/liked scope, sort, AND the server shuffle seed.
        // We re-fetch that same list-API query and use the RESPONSE order
        // verbatim (the server already applied sort+seed) -- crucially NOT
        // deriveOrderedIds, which would re-shuffle a `random` list to a
        // different order than what was on screen. Absent/garbage ctx falls
        // through to the pre-v1.40.0 folder/liked path below.
        let orderedIds;
        if (browseCtx) {
          const res = await fetch(buildContextListUrl(browseCtx, FULL_LIST_QUERY_LIMIT));
          const data = await res.json();
          // v1.72 (QA gate W1): /api/liked is MIXED-KIND now - a liked
          // track/episode/book in the context order would make Prev/Next
          // navigate /watch.html?v=<non-media id> and 404 the view. The
          // watch page's walk is MEDIA-ONLY by definition; kind is CARRIED
          // on every /api/liked item exactly so consumers can dispatch
          // (/api/videos items carry kind:'media' or predate the field).
          const allFiles = (Array.isArray(data.items) ? data.items : [])
            .filter((it) => it && (it.kind === undefined || it.kind === 'media'));
          // v1.52: prev/next hops seed from these items (navigateToWatch).
          for (const it of allFiles) { if (it && it.id) watchSeedLookup.set(it.id, it); }
          orderedIds = allFiles.map((it) => it && it.id);
        } else {
          const folder = parentFolder(mediaData && mediaData.filePath);
          const folderBase = folder ? '/api/videos?root=' + encodeURIComponent(folder) : '/api/videos';
          const baseUrl = listContext === 'liked' ? '/api/liked' : folderBase;
          const separator = baseUrl.includes('?') ? '&' : '?';
          const res = await fetch(`${baseUrl}${separator}limit=${FULL_LIST_QUERY_LIMIT}`);
          const data = await res.json();
          // v1.72 (QA gate W1): same media-only filter as the ctx path
          // above - this legacy arm can hit the mixed /api/liked too.
          const allFiles = (Array.isArray(data.items) ? data.items : [])
            .filter((it) => it && (it.kind === undefined || it.kind === 'media'));
          // v1.52: prev/next hops seed from these items (navigateToWatch).
          for (const it of allFiles) { if (it && it.id) watchSeedLookup.set(it.id, it); }
          // v1.34: same precedence as the home grid (main.js) -- explicit
          // per-browser pick > the defaultSort setting > 'release-date' (the
          // server default). Keeps prev/next stepping through the SAME order
          // the home grid shows for browsers that rely on the setting.
          let sortKey = null;
          try { sortKey = localStorage.getItem('filetube_sort'); } catch (_) { /* storage disabled */ }
          if (!sortKey) {
            try {
              const settingsRes = await fetch('/api/settings');
              const settingsData = await settingsRes.json();
              if (typeof settingsData.defaultSort === 'string' && settingsData.defaultSort !== '') sortKey = settingsData.defaultSort;
            } catch (_) { /* settings unavailable -- fall through */ }
          }
          if (!sortKey) sortKey = 'release-date';
          orderedIds = deriveOrderedIds(allFiles, sortKey);
        }
        const { prevId, nextId } = computeNeighbors(orderedIds, mediaId);

        // v1.63 (Dean ruling 2, RESTRUCTURED at the gate - adversarial
        // CRITICAL-1): the queue OWNS up-next, but the context wiring must
        // arm IMMEDIATELY - the first cut awaited /api/queue before
        // enabling the buttons, so a HUNG queue response (not just a
        // rejected one) left Prev/Next dead and media keys unregistered
        // forever, and the integration tier caught it red. Now: context
        // handlers arm the moment the folder list resolves (byte-identical
        // to pre-wave), and the queue fetch UPGRADES the mutable effective
        // handlers when (if ever) it resolves - the same closures feed the
        // buttons and setTrackNav, so every surface upgrades together.
        const goQueueEntry = (entry) => {
          // Pointer moves server-side (fire-and-forget - the next queue
          // read re-syncs on failure), seed stashes, normal watch nav.
          fetch('/api/queue/pointer', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: entry.uid }), keepalive: true,
          }).catch(() => {});
          // v1.73 (Dean's device find - "Failed to Load Media"): the queue
          // is MIXED-KIND, and this was the LAST legacy arm hand-building
          // /watch.html?v= from a queue entry - a podcast/track up next
          // loaded its id into the VIDEO player and died. The destination
          // derives from the ONE kind-aware helper (the cap-3 contract);
          // the watch seed stays media-only (the media-positive guard
          // class, third strike).
          if ((entry.kind || 'media') !== 'media') {
            const kindHref = (window.FileTube && typeof window.FileTube.queueEntryHref === 'function')
              ? window.FileTube.queueEntryHref(entry)
              : null;
            if (kindHref) {
              if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(kindHref);
              else window.location.href = kindHref;
            }
            return;
          }
          if (entry.item && window.FileTube && typeof window.FileTube.stashWatchSeed === 'function') {
            window.FileTube.stashWatchSeed(entry.item);
          }
          // RAW id: navigateToWatch IS the one encoding layer (gate NEW-1 -
          // the fix round double-encoded here and broke the function's
          // argument contract vs its context-path caller).
          navigateToWatch(entry.mediaId);
        };
        let effNext = nextId ? () => navigateToWatch(nextId) : null;
        let effPrev = prevId ? () => navigateToWatch(prevId) : null;

        prevBtn.disabled = !effPrev;
        nextBtn.disabled = !effNext;
        // ONE stable listener per button reading the mutable ref - the
        // queue upgrade swaps the ref, never re-registers.
        prevBtn.addEventListener('click', () => { if (effPrev) effPrev(); }, { signal });
        nextBtn.addEventListener('click', () => { if (effNext) effNext(); }, { signal });

        fetch('/api/queue')
          .then((res) => (res.ok ? res.json() : null))
          .then((q) => {
            if (!q || signal.aborted) return; // late resolve from a departed view (the v1.41.11 staleness truth)
            const queueNextEntry = computeQueueNext(q);
            const queuePrevEntry = computeQueuePrev(q);
            if (queueNextEntry) effNext = () => goQueueEntry(queueNextEntry);
            if (queuePrevEntry) effPrev = () => goQueueEntry(queuePrevEntry);
            prevBtn.disabled = !effPrev;
            nextBtn.disabled = !effNext;
            renderQueueUpNextBox(q, mediaId);
            // Re-register trackNav so per-direction MediaSession availability
            // tracks the upgraded handlers (same seam, same staleness guard).
            registerTrackNav();
          })
          .catch(() => { /* queue unreachable - context behavior stands, buttons already live */ });

        // v1.41.11 (Dean: "play/pause works on my keyboard, but others
        // don't"): register the SAME context-aware neighbors with the
        // player's trackNav seam (v1.39.0 -- previously reader-chapters
        // only). This is the missing piece for hardware media keys: browsers
        // wire play/pause automatically, but previous/next fire ONLY when
        // explicit MediaSession handlers exist. One registration powers the
        // media keys, the lock screen, and the desktop Shift+N/Shift+P
        // shortcuts (player.js drives all three through this seam).
        //
        // GATE FIX (both seats, this release): this function sits behind
        // uncancelled fetches, so a SLOW list fetch from a departed view can
        // resolve AFTER the next view has already registered its own
        // handlers -- without a staleness guard, watch A's neighbors would
        // silently overwrite watch B's (or a book narration's chapter
        // handlers), sending media-key "next" to the wrong place. The view's
        // AbortController signal is the staleness truth: destroy() aborts it
        // before any successor view registers, so a stale continuation
        // always sees aborted=true here and registers nothing. (read.js's
        // own registration is synchronous and never needed this.)
        if (signal.aborted) return;
        // v1.63: ONE registration function, called immediately with the
        // context handlers and again on the queue upgrade - the buttons and
        // this seam read the same mutable effPrev/effNext, so on-page Next,
        // media keys, and the lock screen can never disagree.
        function registerTrackNav() {
          if (signal.aborted) return;
          if (window.FileTube && window.FileTube.player
              && typeof window.FileTube.player.setTrackNav === 'function' && (effPrev || effNext)) {
            window.FileTube.player.setTrackNav({
              onPrev: effPrev ? () => { if (effPrev) effPrev(); } : undefined,
              onNext: effNext ? () => { if (effNext) effNext(); } : undefined,
            });
          }
        }
        registerTrackNav();
      } catch (e) {
        console.error('Error deriving prev/next order:', e);
        prevBtn.disabled = true;
        nextBtn.disabled = true;
      }
    }

    // FR-4a (v1.17.0, T3): visible watch-page autoplay toggle -- backed by
    // the SAME persisted db.settings.autoplayNext the buried Settings-page
    // checkbox already reads/writes (public/js/setup.js's
    // loadAutomationSettings/saveAutomationSetting, server.js's GET/POST
    // /api/settings -- an existing partial-KNOWN_KEYS merge, unchanged here).
    // Sync between the two surfaces is by RE-FETCH ON LOAD (no shared client
    // state, no server change): flipping this toggle POSTs the new value
    // immediately, so player.js's handleAutoplayNext (which re-fetches
    // /api/settings fresh on every 'ended') picks it up on the very next
    // completed video, and the Settings page reflects it the next time THAT
    // page loads.
    async function setupAutoplayToggle() {
      if (!autoplayCheck) return;
      try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        autoplayCheck.checked = !!settings.autoplayNext;
      } catch (e) {
        console.error('Error fetching autoplay setting:', e);
      }
      autoplayCheck.addEventListener('change', async () => {
        try {
          await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autoplayNext: autoplayCheck.checked }),
          });
        } catch (e) {
          console.error('Error saving autoplay setting:', e);
        }
      }, { signal });
    }

    // FR-9 (v1.21.0, T8): the "Theatre" toggle. Widens the player to the
    // majority of page width by stacking `.watch-sidebar` (the related-items
    // list) below `.watch-main`, at desktop widths only -- see the
    // ".watch-container.theater-mode" rules ("v1.21 FR-9" section in
    // style.css). Built entirely in JS rather than watch.html: this task's
    // file-ownership contract leaves `#player-host-template`/the rest of
    // watch.html's static markup to T2, so the button is created here and
    // appended next to the existing Prev/Next bar instead.
    //
    // WATCH-VIEW-ONLY / DOCKED-unaffected (AC61): this toggles a class on
    // `.watch-container` ONLY -- `#player-dock` (the v1.16 persistent
    // mini-player host) lives entirely OUTSIDE `#view-root`/`.watch-container`
    // in the shell markup, so it is structurally unreachable from this
    // selector. The toggle never touches the `<video>` element, its `src`,
    // or playback state in any way -- purely a class flip on an ancestor
    // element -- so entering/leaving theatre mode never disturbs playback.
    //
    // Persistence (AC63, optional per design -- implemented): the last
    // choice is stored in `localStorage['ft-theater']` and re-applied here on
    // every `init()` (fresh page load OR an in-app SPA navigation back into
    // the watch view), via the pure `isTheaterModeActive`/
    // `theaterModeStorageValue` helpers (module scope, above the IIFE --
    // unit-tested in test/unit).
    function setupTheatreToggle() {
      const watchContainer = root.querySelector('.watch-container');
      const prevNextBar = root.querySelector('#watch-prevnext');
      if (!watchContainer || !prevNextBar || !nextBtn) return;

      const theaterBtn = document.createElement('button');
      theaterBtn.type = 'button';
      theaterBtn.id = 'watch-theater-btn';
      theaterBtn.className = 'watch-prevnext-btn watch-theater-btn';
      theaterBtn.setAttribute('aria-pressed', 'false');
      theaterBtn.setAttribute('aria-label', 'Toggle theatre mode');
      theaterBtn.textContent = 'Theatre';

      // Groups the new button with the existing Next button (rather than
      // appending it as a bare 4th child of `.watch-prevnext`) so it doesn't
      // disturb that row's existing `justify-content: space-between` 3-slot
      // layout (Prev / Autoplay / Next) -- see the ".watch-nextgroup" rule
      // in style.css. `nextBtn` is only reparented, never recreated, so the
      // click listener `setupPrevNext()` wires onto it (elsewhere in this
      // file) keeps working unaffected by this move, regardless of call
      // order.
      const nextGroup = document.createElement('div');
      nextGroup.className = 'watch-nextgroup';
      nextBtn.parentNode.insertBefore(nextGroup, nextBtn);
      nextGroup.appendChild(nextBtn);
      nextGroup.appendChild(theaterBtn);

      let isActive = false;
      try {
        isActive = isTheaterModeActive(localStorage.getItem('ft-theater'));
      } catch (_) {
        isActive = false; // storage disabled/unavailable -- default to off, never throw
      }
      applyTheatreState(isActive);

      function applyTheatreState(active) {
        watchContainer.classList.toggle('theater-mode', active);
        theaterBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      }

      theaterBtn.addEventListener('click', () => {
        isActive = nextTheaterState(isActive);
        applyTheatreState(isActive);
        try {
          localStorage.setItem('ft-theater', theaterModeStorageValue(isActive));
        } catch (_) {
          // storage disabled/unavailable -- the choice just doesn't persist
          // past this visit; the toggle itself still works.
        }
      }, { signal });
    }

    // v1.22.0 FR-7 (TF): the "Loop" toggle -- mirrors setupAutoplayToggle()'s
    // shape (read on load, write on change) but is a watch-page-LOCAL
    // preference persisted in `localStorage['ft-loop']` (coordinator
    // decision -- like theatre mode, NOT a cross-device `db.settings`
    // preference like `autoplayNext`), so there's no `/api/settings`
    // fetch/POST here at all. The actual read/write goes through
    // `window.FileTube.player.isLoopEnabled()`/`setLoop()` (player.js) --
    // that controller is the one that ACTS on the setting in its 'ended'
    // listener, so it owns the storage key; this just keeps the visible
    // checkbox in sync with it. State-independent of FULL/DOCKED (AC53):
    // the setting itself lives in localStorage and is read fresh by
    // player.js on every 'ended', regardless of which view (if any) is
    // currently mounted.
    function setupLoopToggle() {
      if (!loopCheck) return;
      const player = window.FileTube && window.FileTube.player;
      loopCheck.checked = !!(player && player.isLoopEnabled());
      loopCheck.addEventListener('change', () => {
        if (player) player.setLoop(loopCheck.checked);
      }, { signal });
    }

    // FR-1/FR-3 (v1.20.0, T3): the watch-page Subscribe toggle. Lives entirely
    // in this closure -- `currentSubState`/`subscribeModalState` are mutable,
    // private to this view instance, and torn down implicitly on the next
    // init() (a fresh view, fresh closure).
    //
    // SECURITY: every subscription create still goes through the UNMODIFIED
    // server-side `POST /api/subscriptions` -> `store.validateSubscriptionInput`
    // -> `url.validateChannelUrl` -- this view never constructs a spawn argv
    // or persists anything itself; the modal's confirm handler below is a
    // thin fetch() around that existing endpoint (see common.js's
    // `buildSubscribeModal`/`buildSubscribeRequestBody`). The DELETE below
    // targets ONLY the subscription id `decideSubscribeButtonState` itself
    // matched against THIS file's channel identity (via `channelIdentityMatches`,
    // common.js) -- never an arbitrary client-supplied id.
    let currentSubState = { visible: false, subscribed: false, subId: null, identity: null };
    let subscribeModalState = null;
    // B3 (v1.24.0, T6): pin-from-watch state + the button itself -- created
    // (at most once) per view instance by setupPinButton below, fresh for
    // every media load like every other closure in this init().
    let pinBtn = null;
    let currentPinState = { channelDir: null, label: '', pinned: false, pinId: null };

    function applySubscribeButtonLabel(subscribed) {
      if (!subscribeBtn) return;
      subscribeBtn.textContent = subscribed ? 'Subscribed' : 'Subscribe';
      // Reuses the existing era-themed .btn/.btn-primary tokens (no new CSS)
      // -- "Subscribed" drops the red primary styling for the neutral .btn
      // look, "Subscribe" keeps it, mirroring the real YouTube's own
      // subscribed/unsubscribed button treatment.
      subscribeBtn.classList.toggle('btn-primary', !subscribed);
    }

    function closeSubscribeModal() {
      if (!subscribeModalState) return;
      subscribeModalState.backdrop.remove();
      subscribeModalState = null;
    }

    function openSubscribeModal() {
      if (subscribeModalState || !currentSubState.identity) return; // already open, or nothing to subscribe to
      subscribeModalState = buildSubscribeModal(
        document,
        {
          channelName: currentChannelName,
          channelUrl: currentSubState.identity.channelUrl,
          format: mediaData && mediaData.type === 'audio' ? 'audio' : 'video',
        },
        {
          onClose: closeSubscribeModal,
          onConfirm: (body) => {
            subscribeModalState.setError('');
            fetch('/api/subscriptions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
              .then(async (r) => {
                const data = await r.json().catch(() => ({}));
                if (!subscribeModalState) return; // torn down mid-flight -- nothing left to update
                if (!r.ok) {
                  // SECURITY: the server's own validation error, rendered via
                  // the modal's textContent-only setError -- never innerHTML.
                  subscribeModalState.setError(data.error || 'Could not subscribe.');
                  return;
                }
                closeSubscribeModal();
                currentSubState = { ...currentSubState, subscribed: true, subId: data.id };
                applySubscribeButtonLabel(true);
                // v1.54 A2 write-through: the cache learns the new
                // subscription NOW, so the next page render never flashes
                // the stale "Subscribe" (the reported FOUC's root cause).
                const capAfterSub = readCapabilityCache();
                // Gate round 1 (adversarial S3; comment corrected round 2 --
                // both seats): carry channelId too when the identity has one
                // -- inert for matching today (the matcher reads only
                // sub.channelUrl) but shape-parity with the real row.
                // channelHandleUrl is deliberately omitted because no real
                // subscription record carries it (it is a db.metadata/
                // downloadMeta field), NOT because the scrub drops it -- the
                // scrub would actually keep it.
                const identity = currentSubState.identity || {};
                writeCapabilityCache({
                  subs: scrubSubsForCache([...((capAfterSub && capAfterSub.subs) || []),
                    {
                      id: data.id, channelUrl: identity.channelUrl || '', name: currentChannelName,
                      ...(identity.channelId ? { channelId: identity.channelId } : {}),
                    }]),
                });
              })
              .catch(() => {
                if (subscribeModalState) subscribeModalState.setError('Network error -- could not subscribe.');
              });
          },
        }
      );
      document.body.appendChild(subscribeModalState.backdrop);
      subscribeModalState.backdrop.hidden = false;
      subscribeModalState.modal.hidden = false;
    }

    // One-tap unsubscribe (Dean's explicit direction -- no options modal for
    // removal, low blast radius: this only stops future polling, it never
    // deletes already-downloaded files).
    function handleUnsubscribe() {
      const subId = currentSubState.subId;
      if (!subId) return;
      fetch(`/api/subscriptions/${encodeURIComponent(subId)}`, { method: 'DELETE' })
        .then((r) => {
          if (!r.ok) return;
          const removedSubId = subId;
          currentSubState = { ...currentSubState, subscribed: false, subId: null };
          applySubscribeButtonLabel(false);
          // v1.54 A2 write-through (the unsubscribe mirror).
          const capAfterUnsub = readCapabilityCache();
          if (capAfterUnsub && Array.isArray(capAfterUnsub.subs)) {
            writeCapabilityCache({ subs: capAfterUnsub.subs.filter((sub) => sub && sub.id !== removedSubId) });
          }
        })
        .catch((e) => console.error('Error unsubscribing:', e));
    }

    // B3 (v1.24.0, T6): mirrors applySubscribeButtonLabel's exact
    // primary-when-actionable / neutral-when-already-done convention (a
    // discoverable red "do this" state vs. a settled/neutral "already done"
    // state) -- reuses the SAME era-themed .btn/.btn-primary tokens, no new
    // CSS.
    function applyPinButtonLabel(pinned) {
      if (!pinBtn) return;
      pinBtn.textContent = pinned ? 'Pinned ★' : 'Pin channel';
      pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      pinBtn.classList.toggle('btn-primary', !pinned);
    }

    // Re-fetches the pin list and re-renders the shared sidebar shortcut via
    // common.js's EXISTING renderPinnedSidebar -- the SAME function/DOM
    // section the /subscriptions page's own pin toggle refreshes -- so
    // pinning/unpinning from the watch page updates the sidebar immediately,
    // without a page reload (AC: "the pinned-sidebar shortcut updates
    // immediately").
    function refreshPinnedSidebar() {
      // v1.37.0: channel + book-shelf pins, one merged sidebar section.
      fetchAllPins().then((pins) => renderPinnedSidebar(pins));
    }

    // One-tap pin/unpin, mirroring subscriptions.js's togglePin exactly:
    // `POST`/`DELETE /api/subscriptions/pins` (the SAME gated pins store/
    // route T8 exposes -- never db.folders), producing the identical pin
    // record shape `{channelDir, label}` the subscriptions-page pin flow
    // sends (AC: "identical pin record shape... single source of truth").
    function handleTogglePin() {
      if (!currentPinState.channelDir || !pinBtn) return;
      const wasPinned = currentPinState.pinned;
      pinBtn.disabled = true;
      const request = wasPinned
        ? (currentPinState.pinId
          ? fetch('/api/subscriptions/pins/' + encodeURIComponent(currentPinState.pinId), { method: 'DELETE' })
          : Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
        : fetch('/api/subscriptions/pins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelDir: currentPinState.channelDir, label: currentPinState.label }),
        });
      request
        .then(async (res) => {
          if (!res || !res.ok) {
            const data = res && typeof res.json === 'function' ? await res.json().catch(() => ({})) : {};
            console.error('Pin toggle failed:', (data && data.error) || (res && res.status));
            return;
          }
          if (wasPinned) {
            currentPinState = { ...currentPinState, pinned: false, pinId: null };
          } else {
            const data = await res.json().catch(() => ({}));
            currentPinState = { ...currentPinState, pinned: true, pinId: (data && data.id) || null };
          }
          // v1.54 A2 write-through: keep the cached pins truthful so the
          // next render (and the pinned sidebar prime) match reality.
          // Merge-only: when cache.pins was never populated we must NOT
          // synthesize a one-entry array (the sidebar prime would render
          // just this pin, dropping the user's others) -- refreshPinnedSidebar
          // in the .finally below always runs fetchAllPins, whose merged
          // writeCapabilityCache({ pins }) backfills authoritatively one
          // round trip later either way.
          const capAfterPin = readCapabilityCache();
          if (capAfterPin && Array.isArray(capAfterPin.pins)) {
            const others = capAfterPin.pins.filter((p) => !(p && p.pinSource === 'channel' && p.channelDir === currentPinState.channelDir));
            writeCapabilityCache({
              pins: currentPinState.pinned
                ? [...others, { id: currentPinState.pinId || '', channelDir: currentPinState.channelDir, label: currentPinState.label, pinSource: 'channel' }]
                : others,
            });
          }
        })
        .catch((err) => console.error('Pin toggle failed (network error):', err))
        .finally(() => {
          pinBtn.disabled = false;
          applyPinButtonLabel(currentPinState.pinned);
          refreshPinnedSidebar();
        });
    }

    // B3 (v1.24.0, T6): resolves the pin target + initial pinned state and
    // (re)creates the button -- called once per media load, right after
    // `currentSubState` resolves in setupSubscribeButton below, reusing the
    // SAME `subs`/module-enabled probe that function already fetched (no
    // second `/api/subscriptions` round-trip). `channelDir` prefers an
    // ACTUAL subscription's server-resolved directory (the exact same value
    // the /subscriptions page's own pin flow uses) when this file is already
    // subscribed; otherwise it falls back to this file's own parent folder
    // (`resolveChannelDirFromFilePath`) -- the best available target for a
    // not-yet-subscribed channel, still re-validated server-side by
    // `isChannelDirConfined` exactly like every other pin request (never a
    // new trust boundary). Visible under the SAME gate as the Subscribe
    // button (`currentSubState.visible` -- module enabled AND a resolvable
    // channel identity), per the AC's "when it has channel identity."
    // v1.54 A1 (Dean's FOUC report): ONE synchronous state applier for
    // Subscribe AND Pin, fed either CACHED answers (frame-one on a seeded
    // nav; hydration-instant otherwise) or CONFIRMED answers when the real
    // fetches resolve -- the same render path both times, so a warm-cache
    // page never pops. Click handlers wire exactly once per view instance.
    let subscribeClickWired = false;
    function applySubscribeAndPinState(item, moduleEnabled, subs, channelPins, confirmed) {
      if (!subscribeBtn || !item) return;
      currentSubState = decideSubscribeButtonState(item, subs, moduleEnabled);
      if (!currentSubState.visible) {
        // Gate v1.54 round 1 (QA CRITICAL + adversarial W4): only a CONFIRMED
        // answer may remove ("absent, not merely disabled/greyed", AC15 --
        // the settled state is unchanged). A CACHED answer may be a stale
        // moduleEnabled:false poisoned by one transient health blip (5-min
        // TTL) -- it merely hides, so the confirmed visible:true moments
        // later can still show the controls.
        if (confirmed) {
          subscribeBtn.remove();
          if (pinBtn) { pinBtn.remove(); pinBtn = null; }
        } else {
          subscribeBtn.hidden = true;
          if (pinBtn) pinBtn.hidden = true;
        }
        return;
      }
      // Belt-and-braces for the same finding: removal must never be terminal.
      // Re-mount into the container captured before any removal (see
      // subscribeBtnContainer above); first-child keeps Subscribe before Pin.
      if (!subscribeBtn.isConnected) {
        if (!subscribeBtnContainer) return;
        subscribeBtnContainer.insertBefore(subscribeBtn, subscribeBtnContainer.firstChild);
      }
      subscribeBtn.hidden = false;
      if (pinBtn) pinBtn.hidden = false;
      applySubscribeButtonLabel(currentSubState.subscribed);
      if (!subscribeClickWired) {
        subscribeClickWired = true;
        subscribeBtn.addEventListener('click', () => {
          if (currentSubState.subscribed) handleUnsubscribe();
          else openSubscribeModal();
        }, { signal });
      }
      // B3: the pin button, from the SAME answer set -- no serial second
      // fetch (the pre-v1.54 pin pop was exactly that extra round trip).
      if (!subscribeBtnContainer) return;
      const matchedSub = currentSubState.subscribed && Array.isArray(subs)
        ? subs.find((sub) => sub && sub.id === currentSubState.subId)
        : null;
      const channelDir = (matchedSub && typeof matchedSub.channelDir === 'string' && matchedSub.channelDir !== '')
        ? matchedSub.channelDir
        : resolveChannelDirFromFilePath(item.filePath);
      if (!channelDir) {
        if (pinBtn) { pinBtn.remove(); pinBtn = null; }
        return;
      }
      const existingPin = Array.isArray(channelPins) ? channelPins.find((p) => p && p.channelDir === channelDir) : null;
      currentPinState = { channelDir, label: currentChannelName, pinned: Boolean(existingPin), pinId: existingPin ? existingPin.id : null };
      if (!pinBtn) {
        pinBtn = document.createElement('button');
        pinBtn.type = 'button';
        pinBtn.id = 'pin-channel-btn';
        pinBtn.className = 'btn';
        pinBtn.style.marginLeft = 'var(--space-4)';
        subscribeBtnContainer.appendChild(pinBtn);
        pinBtn.addEventListener('click', handleTogglePin, { signal });
      }
      applyPinButtonLabel(currentPinState.pinned);
    }

    // Cached channel pins from the capability cache (fetchAllPins owns the
    // MERGED pins write; we only ever read the channel-tagged half here).
    function cachedChannelPins(cap) {
      return (cap && Array.isArray(cap.pins)) ? cap.pins.filter((p) => p && p.pinSource === 'channel') : [];
    }

    // v1.54 A1: a FULL seed + warm capability cache renders Subscribe AND
    // Pin in FRAME ONE (the seed item is metadata-shaped; the decision needs
    // only channelUrl). Hydration re-applies from confirmed answers -- a
    // no-op when nothing changed. This block lives HERE, below every `let`
    // the applier assigns (gate round 1, adversarial C1: called from init's
    // top -- 800 lines before those declarations -- it threw a TDZ
    // ReferenceError that the router's catch swallowed, killing everything
    // after it in init on every warm-cache navigation). The browser paints
    // only after init returns, so this is still frame one.
    if (watchSeed && isFullWatchSeedItem(watchSeed.item)) {
      const capAtInit = readCapabilityCache();
      if (capAtInit && typeof capAtInit.moduleEnabled === 'boolean') {
        applySubscribeAndPinState(watchSeed.item, capAtInit.moduleEnabled, capAtInit.subs || [], cachedChannelPins(capAtInit));
      }
    }

    async function setupSubscribeButton() {
      if (!subscribeBtn) return;
      // v1.54 A1: CACHED-STATE-FIRST -- full render + wiring from the warm
      // cache, synchronously; the confirmed pass below re-applies and only
      // changes pixels when an answer actually differs (write-through on
      // every mutation keeps the cache seconds-fresh, so the old
      // Subscribe->Subscribed flash is gone except cross-device, disclosed).
      const cachedCap = readCapabilityCache();
      if (cachedCap && typeof cachedCap.moduleEnabled === 'boolean') {
        applySubscribeAndPinState(mediaData, cachedCap.moduleEnabled, cachedCap.subs || [], cachedChannelPins(cachedCap));
      }
      let moduleEnabled = false;
      let subs = [];
      let channelPins = [];
      try {
        const healthRes = await fetch('/api/subscriptions/health');
        moduleEnabled = healthRes.ok;
        if (moduleEnabled) {
          // Subs and pins in PARALLEL -- the pin's serial fetch was the
          // second half of the pop Dean reported.
          const [subsRes, pinsRes] = await Promise.all([fetch('/api/subscriptions'), fetch('/api/subscriptions/pins')]);
          subs = subsRes.ok ? await subsRes.json().catch(() => []) : [];
          channelPins = pinsRes.ok ? await pinsRes.json().catch(() => []) : [];
        }
        // v1.53/v1.54: the fresh answers refresh the cache (pins stay owned
        // by fetchAllPins' merged write -- never clobbered from here).
        writeCapabilityCache({ moduleEnabled, subs: scrubSubsForCache(subs) });
      } catch (e) {
        console.error('Error resolving subscribe button state:', e);
        moduleEnabled = false;
        subs = [];
        channelPins = [];
      }
      if (signal.aborted) return;
      // `true` = CONFIRMED: this is the only caller allowed to remove.
      applySubscribeAndPinState(mediaData, moduleEnabled, subs, Array.isArray(channelPins) ? channelPins : [], true);
    }

    // Esc closes the subscribe modal while it's open -- backdrop-tap and the
    // [x] button are wired inside buildSubscribeModal itself (common.js).
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && subscribeModalState) closeSubscribeModal();
    }, { signal });

    // Navigates to another video's watch page through the SPA router (smooth,
    // no reload) -- watch -> watch never docks (see common.js's
    // shouldDockOnTransition), so the player just loads the new source in
    // place. Falls back to a hard navigation if the router failed to boot.
    function navigateToWatch(id) {
      // v1.36.2: PRESERVE the launch context across prev/next/autoplay
      // hops -- stepping through the Liked list must stay in the Liked
      // list, not silently fall back to folder order after the first hop.
      // v1.40.0: carry the browse context forward so every hop keeps walking
      // the same list/order. rawBrowseCtx is the DECODED param value (from
      // urlParams.get), so it must be re-encoded here for the URL. Falls back to
      // the legacy `list=liked` carry for old-style links.
      const ctxSuffix = rawBrowseCtx
        ? '&ctx=' + encodeURIComponent(rawBrowseCtx)
        : (listContext ? '&list=' + encodeURIComponent(listContext) : '');
      const url = '/watch.html?v=' + encodeURIComponent(id) + ctxSuffix;
      // v1.52 instant watch: prev/next (and the keyboard shortcuts, which
      // share this function) seed the next view when the item is in this
      // view's lookup. Autoplay-advance seeds separately in player.js's own
      // 'ended' cascade (gate C1) -- it never routes through here.
      const seedItem = watchSeedLookup.get(id);
      if (seedItem && window.FileTube && window.FileTube.stashWatchSeed) {
        window.FileTube.stashWatchSeed(seedItem, { folderSettings });
      }
      if (window.FileTube && typeof window.FileTube.navigate === 'function') {
        window.FileTube.navigate(url);
      } else {
        window.location.href = url;
      }
    }

    // Local ratings setup
    // Read-only star rating: a deterministic 3–5 value derived from the media id
    // (shared with the home cards via common.js getStarRating). Not user input —
    // just a fun cosmetic touch that's consistent across the card and this page.
    function renderStarRating() {
      const rating = getStarRating(mediaId);
      starRatingControl.querySelectorAll('.star').forEach(star => {
        const val = parseInt(star.dataset.value);
        star.classList.toggle('active', val <= rating);
      });
      starRatingControl.style.cursor = 'default';
      starRatingControl.title = `Rated ${rating} / 5`;
      if (ratingText) ratingText.textContent = `${rating} / 5`;
    }

    // Load comments
    function loadComments() {
      const savedCommentsKey = `comments_${mediaId}`;
      let comments = [];

      try {
        const localComments = localStorage.getItem(savedCommentsKey);
        if (localComments) {
          // v1.48 item 4: reconcile against the CURRENT bank before rendering.
          // Videos first opened before v1.44.3 still hold the pre-genericisation
          // commenter names in localStorage; nothing ever re-read them. Dean's
          // own 'You' comments are preserved -- see reconcileStoredComments.
          const reconciled = reconcileStoredComments(
            JSON.parse(localComments),
            getMockInitialComments
          );
          comments = reconciled.comments;
          // Written back ONLY when something actually changed, so an
          // already-current video does no localStorage write on every load.
          if (reconciled.changed) {
            localStorage.setItem(savedCommentsKey, JSON.stringify(comments));
          }
        } else {
          // Prepopulate with a few classic YouTube comments to keep the aesthetic alive!
          comments = getMockInitialComments();
          localStorage.setItem(savedCommentsKey, JSON.stringify(comments));
        }
      } catch (e) {
        console.error(e);
        comments = getMockInitialComments();
      }

      renderComments(comments);
    }

    // F1 (v1.24.0, T4): builds ONE comment row via createElement/textContent
    // only -- NEVER innerHTML -- which is what lets the avatar safely carry
    // either a real captured `channelAvatarUrl` (a future `<img src="...">`,
    // C6/T11, Wave 3) or a generated {glyph, color} node without ever
    // concatenating an untrusted string into an HTML template (an author
    // name/comment text/avatar URL never gets string-interpolated into
    // markup). Mirrors common.js's own buildPinAvatarNode construction
    // discipline (T3, same wave).
    function buildCommentNode(c) {
      const item = document.createElement('div');
      item.className = 'comment-item';

      const avatar = document.createElement('div');
      avatar.className = 'comment-avatar';
      // Mock comment authors are fictional personas, not real channels --
      // there is no real channelAvatarUrl to look up for them, so this
      // always resolves to the deterministic generated fallback. Passing
      // `null` explicitly (rather than omitting the arg) documents that this
      // is a deliberate "no real avatar for this author" choice, not an
      // oversight.
      applyAvatarToElement(avatar, c.author, null);
      item.appendChild(avatar);

      const body = document.createElement('div');
      body.className = 'comment-body';

      const meta = document.createElement('div');
      meta.className = 'comment-author-meta';
      const authorSpan = document.createElement('span');
      authorSpan.className = 'comment-author-name';
      authorSpan.textContent = c.author;
      const timeSpan = document.createElement('span');
      timeSpan.className = 'comment-time';
      timeSpan.textContent = c.timeStr;
      meta.appendChild(authorSpan);
      meta.appendChild(timeSpan);

      const content = document.createElement('div');
      content.className = 'comment-content';
      content.textContent = c.text;

      body.appendChild(meta);
      body.appendChild(content);
      item.appendChild(body);
      return item;
    }

    function renderComments(comments) {
      commentCountBadge.textContent = comments.length;

      commentsContainer.textContent = ''; // clear any previous render (never innerHTML)

      if (comments.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color: var(--text-secondary); text-align: center; padding: var(--space-6) 0;';
        empty.textContent = 'No comments yet. Be the first to comment!';
        commentsContainer.appendChild(empty);
        return;
      }

      comments.forEach((c) => {
        commentsContainer.appendChild(buildCommentNode(c));
      });
    }

    postCommentBtn.addEventListener('click', () => {
      const text = newCommentText.value.trim();
      if (!text) return;

      const savedCommentsKey = `comments_${mediaId}`;
      let comments = [];
      try {
        comments = JSON.parse(localStorage.getItem(savedCommentsKey)) || [];
      } catch (e) {}

      const newComment = {
        author: 'You',
        timeStr: 'just now',
        text: text
      };

      comments.unshift(newComment);
      localStorage.setItem(savedCommentsKey, JSON.stringify(comments));
      renderComments(comments);
      newCommentText.value = '';
    }, { signal });

    // Prepopulated mock retro comments. G1 (v1.24.0, T4): now layers in
    // exactly one weighted "Polite and Unhinged" persona comment per video (87%
    // polite / 10% unhinged / 3% conspiracy-about-the-video) on top of the
    // existing flat commentBank selection -- see MOCK_COMMENT_BANK/
    // selectDeterministicComments/buildMockComments at module scope (top of
    // file), which are hoisted out of this closure specifically so they're
    // unit-testable via node:test without a DOM. This closure only supplies
    // the two DOM-derived inputs: mediaId and the current video's title.
    function getMockInitialComments() {
      const count = getCommentCount(mediaId, MOCK_COMMENT_BANK.length);
      const videoTitle = mediaData && typeof mediaData.title === 'string' ? mediaData.title : '';
      return buildMockComments(mediaId, MOCK_COMMENT_BANK, count, videoTitle);
    }

    // C1 follow-up (v1.24 UX Round, Wave 3): "Move to..." trigger. Mirrors
    // `setupPinButton`'s runtime-creation pattern above (created once per
    // view instance, mounted into existing shell markup this file doesn't
    // own) since `watch.html`'s static markup carries no placeholder for
    // this control and this task edits ONLY `main.js`/`watch.js`. Mounted as
    // a sibling of Download/Delete inside `.watch-action-btns`, the nowrap
    // button sub-group of `.watch-actions` those two already live in (see
    // the v1.25.6 hotfix comment on `.watch-action-btns` in watch.html/
    // style.css), reusing the EXACT `.btn` class those buttons use -- no new
    // CSS. Idempotent (guarded on `moveBtn` already existing) so a second
    // media load within the same cached view instance never duplicates the
    // control. Falls back to `.watch-actions` itself if the sub-group is
    // ever absent (e.g. stale cached markup) so Move still mounts somewhere
    // rather than silently vanishing.
    //
    // Visual-consistency follow-up (button glyph polish): Download/Delete
    // already carry a leading <i class="icon-*"> glyph -- Move was the odd
    // one out (text-only), which also made it the widest/least predictable
    // width in the row and the one most likely to wrap onto its own line on
    // a narrow phone. Gives it `.icon-folder` (the closest existing glyph to
    // "move to a folder" in the icon-set -- see style.css's icon-set-axis
    // section; there is no dedicated move/arrow-into-folder asset and this
    // task does not add new icon assets), built via createElement/
    // createTextNode (not innerHTML) to match the rest of this file's DOM
    // conventions. `aria-label`/`title` stay fully descriptive even though
    // the visible label is the same short "Move" as before.
    // v1.53 (Dean): "Attribute..." -- the manual escape hatch for items no
    // reheat can ever attribute (dead/renamed channels, MeTube imports).
    // Structurally ABSENT unless the item is genuinely unattributed
    // (resolveFileChannelIdentity null -- the same predicate every other
    // surface uses), the setupMoveButton runtime-control pattern.
    function setupAttributeButton() {
      const watchActions = root.querySelector('.watch-actions');
      if (!watchActions || !mediaData) return;
      if (!canModifyLibrary) return; // v1.81 write-RBAC: attribution is a content edit
      const attributed = resolveFileChannelIdentity(mediaData) !== null;
      if (attributed) {
        if (attributeBtn) { attributeBtn.remove(); attributeBtn = null; }
        return;
      }
      if (attributeBtn) return;
      attributeBtn = document.createElement('button');
      attributeBtn.type = 'button';
      attributeBtn.id = 'attribute-media-btn';
      attributeBtn.className = 'btn';
      attributeBtn.title = 'Attribute to a channel';
      attributeBtn.setAttribute('aria-label', 'Attribute to a channel');
      const icon = document.createElement('i');
      icon.className = 'icon-user';
      attributeBtn.appendChild(icon);
      const label = document.createElement('span');
      label.className = 'btn-label';
      label.textContent = 'Attribute';
      attributeBtn.appendChild(document.createTextNode(' '));
      attributeBtn.appendChild(label);
      const btnGroup = watchActions.querySelector('.watch-action-btns');
      (btnGroup || watchActions).appendChild(attributeBtn);
      attributeBtn.addEventListener('click', handleAttributeClick, { signal });
    }

    async function handleAttributeClick() {
      let targets = [];
      try {
        const res = await fetch('/api/attribution-targets', { signal });
        const body = await res.json();
        targets = Array.isArray(body.targets) ? body.targets : [];
      } catch (_) { /* picker opens with its own empty state */ }
      // Gate W6: hold the dismiss handle -- navigating away must never leave
      // a body-mounted picker over the next view with a stale mediaId.
      const picker = showAttributionPicker(targets, { title: 'Attribute this video to' }, (target) => {
        fetch(`/api/videos/${encodeURIComponent(mediaId)}/attribute-channel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target }),
        })
          .then((res) => (res.ok ? res.json() : res.json().then((b) => Promise.reject(new Error(b.error || 'attribution failed')))))
          .then((body) => {
            // Repaint the uploader panel from the new identity (the painter
            // is idempotent) and stand the button down.
            mediaData.channelUrl = target.channelUrl;
            mediaData.channelName = target.channelName;
            mediaData.channelAvatarUrl = target.channelAvatarUrl || '';
            mediaData.channelAttributedManually = true;
            currentChannelName = resolveChannelName(mediaData, folderSettings);
            paintMetadata(mediaData, currentChannelName);
            setupAttributeButton();
            showToast(`Attributed to ${target.channelName}.`);
            const reloc = body && body.relocation;
            if (reloc && reloc.available && reloc.destinationDir) {
              offerAttributionMove(reloc.destinationDir, target.channelName);
            }
          })
          .catch((err) => showToast(err && err.message ? err.message : 'Attribution failed.'));
      });
      if (picker && picker.dismiss) {
        signal.addEventListener('abort', picker.dismiss, { once: true });
      }
    }

    // The physical move, through the EXISTING move endpoint -- explicit
    // confirm, player closed first (the offerRelocation posture), navigate
    // to the re-keyed id on success.
    function offerAttributionMove(destinationDir, channelLabel) {
      showConfirmModal(
        'File under the channel folder?',
        `Move this file into <strong>${escapeHtmlText(channelLabel)}</strong>'s folder?<br><small>${escapeHtmlText(destinationDir)}</small>`,
        () => {
          window.FileTube.player.close();
          fetch(`/api/videos/${encodeURIComponent(mediaId)}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetFolder: destinationDir }),
          })
            .then((res) => res.json().then((b) => ({ ok: res.ok, b })))
            .then(({ ok, b }) => {
              if (ok && b && b.id) {
                showToast('Moved into the channel folder.');
                if (window.FileTube && typeof window.FileTube.navigate === 'function') {
                  window.FileTube.navigate('/watch.html?v=' + encodeURIComponent(b.id));
                }
              } else {
                showToast((b && b.error) || 'Move failed - the file was attributed but not moved.');
              }
            })
            .catch(() => showToast('Move failed - the file was attributed but not moved.'));
        },
        { confirm: 'Move file', cancel: 'Keep it here' }
      );
    }

    function setupMoveButton() {
      const watchActions = root.querySelector('.watch-actions');
      if (!watchActions || !mediaData) return;
      if (!canModifyLibrary) return; // v1.81 write-RBAC: move is a content mutation
      if (!moveBtn) {
        moveBtn = document.createElement('button');
        moveBtn.type = 'button';
        moveBtn.id = 'move-media-btn';
        moveBtn.className = 'btn';
        moveBtn.title = 'Move to another folder';
        moveBtn.setAttribute('aria-label', 'Move to another folder');
        const moveIcon = document.createElement('i');
        moveIcon.className = 'icon-folder';
        moveBtn.appendChild(moveIcon);
        // v1.47.6: `.btn-label` rather than a bare text node, so the phone
        // breakpoint can hide the word and leave the glyph (see style.css).
        const moveLabel = document.createElement('span');
        moveLabel.className = 'btn-label';
        moveLabel.textContent = 'Move';
        moveBtn.appendChild(document.createTextNode(' '));
        moveBtn.appendChild(moveLabel);
        const btnGroup = watchActions.querySelector('.watch-action-btns');
        (btnGroup || watchActions).appendChild(moveBtn);
        moveBtn.addEventListener('click', handleMoveClick, { signal });
      }
    }

    // "Like" toggle, painted in the YouTube heart convention (v1.108, Dean):
    // NOT-liked is the neutral/grey resting state; LIKED fills the heart RED.
    // This is a DELIBERATE reversal of the old v1.30 "primary-when-actionable"
    // convention (which made the un-liked button `btn-primary`/red as a
    // call-to-action and the liked button neutral) -- Dean found red-as-CTA /
    // grey-as-done backwards, since it read the wrong way round. The state is
    // now carried by the `.liked` class (red heart via `color: var(--yt-red)`,
    // exactly mirroring `.card-like-btn.liked`, style.css) instead of
    // `btn-primary`; `aria-pressed` still carries it for AT and at phone widths
    // where the `.btn-label` word is hidden.
    // v1.47.6: rebuilt as icon + `.btn-label` instead of `textContent`.
    //   - `textContent =` wiped every child, so the button could never hold a
    //     glyph or a hideable label at all.
    //   - the heart is a real `.icon-heart` CSS mask, never a unicode codepoint:
    //     this repo's v1.38 lesson is "draw glyphs in CSS, never emoji
    //     codepoints" (iOS force-renders U+2665 as the red-heart emoji).
    function applyLikeButtonLabel(liked) {
      if (!likeBtn) return;
      likeBtn.replaceChildren();
      const icon = document.createElement('i');
      icon.className = 'icon-heart';
      const label = document.createElement('span');
      label.className = 'btn-label';
      label.textContent = liked ? 'Liked' : 'Like';
      likeBtn.appendChild(icon);
      likeBtn.appendChild(document.createTextNode(' '));
      likeBtn.appendChild(label);
      likeBtn.setAttribute('aria-pressed', liked ? 'true' : 'false');
      likeBtn.classList.toggle('liked', liked);
    }

    // One-tap like/unlike -- `POST`/`DELETE /api/liked/:id` (the server-side
    // `db.liked` membership store, server.js). Membership on the server is
    // the single source of truth; `currentLikeState` here only mirrors it
    // for this view instance's own render, updated ONLY after the request
    // resolves successfully (never optimistically), mirroring
    // `handleTogglePin`'s exact disable-during-request / resolve-then-render
    // shape above.
    function handleToggleLike() {
      if (!mediaData || !likeBtn) return;
      const wasLiked = currentLikeState.liked;
      likeBtn.disabled = true;
      const request = fetch(`/api/liked/${encodeURIComponent(mediaData.id)}`, { method: wasLiked ? 'DELETE' : 'POST' });
      request
        .then((res) => {
          if (!res || !res.ok) {
            console.error('Like toggle failed:', res && res.status);
            return;
          }
          currentLikeState = { liked: !wasLiked };
          // v1.33.1 (Dean): the sidebar's Liked entry is count-gated -- a
          // like/unlike changes the count, so refresh the cached total and
          // re-apply, making the entry appear the moment the FIRST like
          // lands (his "even a liked Video" annoyance).
          applyLikedSidebarEntry(sidebarFoldersList, { force: true });
        })
        .catch((err) => console.error('Like toggle failed (network error):', err))
        .finally(() => {
          likeBtn.disabled = false;
          applyLikeButtonLabel(currentLikeState.liked);
        });
    }

    // Creates (once per view instance) and mounts the Like button as a
    // sibling of Download/Delete/Move inside `.watch-action-btns` -- the SAME
    // nowrap sub-group `setupMoveButton` mounts into just above -- reading
    // the INITIAL liked state off `mediaData.liked` (a field GET
    // /api/videos/:id derives from `db.liked` membership at request time;
    // see that route's own comment, server.js). Unlike `setupPinButton`, the
    // Like control is never conditionally hidden/removed -- liking is a
    // per-item action independent of any resolved channel/subscribe
    // identity, so it's always shown for a valid media item.
    function setupLikeButton() {
      const watchActions = root.querySelector('.watch-actions');
      if (!watchActions || !mediaData) return;
      currentLikeState = { liked: !!mediaData.liked };
      if (!likeBtn) {
        likeBtn = document.createElement('button');
        likeBtn.type = 'button';
        likeBtn.id = 'like-media-btn';
        likeBtn.className = 'btn';
        likeBtn.title = 'Like this video';
        likeBtn.setAttribute('aria-label', 'Like this video');
        const btnGroup = watchActions.querySelector('.watch-action-btns');
        (btnGroup || watchActions).appendChild(likeBtn);
        likeBtn.addEventListener('click', handleToggleLike, { signal });
      }
      applyLikeButtonLabel(currentLikeState.liked);
    }

    // v1.72 (cap 6): the manual watched toggle's label/state painter -
    // applyLikeButtonLabel's exact shape (icon + hideable .btn-label,
    // aria-pressed carries state at phone widths where the label hides).
    function applyWatchedButtonLabel(watched) {
      if (!watchedBtn) return;
      watchedBtn.replaceChildren();
      const icon = document.createElement('i');
      icon.className = 'icon-history';
      const label = document.createElement('span');
      label.className = 'btn-label';
      label.textContent = watched ? 'Watched' : 'Mark watched';
      watchedBtn.appendChild(icon);
      watchedBtn.appendChild(document.createTextNode(' '));
      watchedBtn.appendChild(label);
      watchedBtn.setAttribute('aria-pressed', watched ? 'true' : 'false');
      watchedBtn.title = watched ? 'Mark as unwatched' : 'Mark as watched';
    }

    // POST marks the latch now; DELETE is the un-watch verb (the server
    // clears latch + position - the history-row-delete semantics, so a
    // fully-watched item's toggle actually releases). Non-optimistic,
    // disable-during-request - handleToggleLike's exact shape.
    function handleToggleWatched() {
      if (!mediaData || !watchedBtn) return;
      const wasWatched = currentWatchedState.watched;
      watchedBtn.disabled = true;
      fetch(`/api/watched/${encodeURIComponent(mediaData.id)}`, { method: wasWatched ? 'DELETE' : 'POST' })
        .then((res) => {
          if (!res || !res.ok) {
            console.error('Watched toggle failed:', res && res.status);
            return;
          }
          currentWatchedState = { watched: !wasWatched };
        })
        .catch((err) => console.error('Watched toggle failed (network error):', err))
        .finally(() => {
          watchedBtn.disabled = false;
          applyWatchedButtonLabel(currentWatchedState.watched);
        });
    }

    // Mounts the Watched toggle as a sibling of Like inside
    // `.watch-action-btns` (setupLikeButton's exact mount), reading the
    // INITIAL state off `mediaData.watchState` - the server's one
    // derivation authority, never a client-side re-derivation.
    function setupWatchedButton() {
      const watchActions = root.querySelector('.watch-actions');
      if (!watchActions || !mediaData) return;
      currentWatchedState = { watched: mediaData.watchState === 'watched' };
      if (!watchedBtn) {
        watchedBtn = document.createElement('button');
        watchedBtn.type = 'button';
        watchedBtn.id = 'watched-media-btn';
        watchedBtn.className = 'btn';
        watchedBtn.setAttribute('aria-label', 'Mark as watched');
        const btnGroup = watchActions.querySelector('.watch-action-btns');
        (btnGroup || watchActions).appendChild(watchedBtn);
        watchedBtn.addEventListener('click', handleToggleWatched, { signal });
      }
      applyWatchedButtonLabel(currentWatchedState.watched);
    }

    // v1.33 T2: share the item's ORIGINAL YouTube link (`mediaData.watchUrl`,
    // a server-side buildWatchUrl product -- never assembled client-side).
    // Native share sheet when the browser has one (iOS/Android
    // `navigator.share` -- exactly Dean's "share sheet with the real YouTube
    // link" ask); clipboard copy with a transient "Copied!" label as the
    // desktop fallback. An AbortError from `navigator.share` is the user
    // closing the sheet -- silently fine, never an error.
    // v1.110 (Dean): run the actual share of `url` (the original YouTube link,
    // optionally with a `?t=`) + the desktop-fallback "Copied!" feedback. Called
    // directly, or from a share-choice pick below.
    function runShare(url) {
      // v1.67 (plan D6): the share-sheet-vs-clipboard DECISION lives in
      // common.js's shareExternalUrl (the card share corner runs the same
      // one); only the watch-local "Copied!" label feedback stays here.
      shareExternalUrl(url, mediaData.title).then((outcome) => {
        if (outcome !== 'copied' || !shareBtn) return;
        // v1.47.6: write to the `.btn-label` span, NOT the button's own
        // textContent -- that would wipe the icon element added alongside
        // it. Falls back to the button itself if the span is somehow
        // absent, so the feedback can never silently disappear.
        //
        // Note 'copied' is the DESKTOP fallback: mobile has
        // `navigator.share` and resolves 'shared' above, so hiding the label
        // at phone widths does not cost anyone this confirmation. On the
        // rare mobile browser with no share sheet, the label is hidden and
        // the clipboard write still succeeds -- the toast below covers it.
        const label = shareBtn.querySelector('.btn-label') || shareBtn;
        label.textContent = 'Copied!';
        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
          window.showToast('Link copied');
        }
        if (shareBtnResetTimer) clearTimeout(shareBtnResetTimer);
        shareBtnResetTimer = setTimeout(() => {
          if (shareBtn) {
            const resetTarget = shareBtn.querySelector('.btn-label') || shareBtn;
            resetTarget.textContent = 'Share';
          }
          shareBtnResetTimer = null;
        }, 1500);
      });
    }

    // v1.110 (Dean): the Share button. When there's a meaningful playback position
    // to offer (>= 1s, non-live -- player.getCurrentTime returns null for live),
    // PROMPT "Share video" vs "Share at current time (M:SS)"; each shares the
    // original YouTube link, the second with a `?t=` start. Under 1s / no position
    // it shares the plain link directly (no pointless 0:00 prompt), the pre-v1.110
    // behaviour. The choice modal is body-level, so its dismiss is torn down on
    // view abort.
    function handleShareClick() {
      if (!mediaData || typeof mediaData.watchUrl !== 'string' || mediaData.watchUrl === '') return;
      const base = mediaData.watchUrl;
      const player = (typeof window !== 'undefined' && window.FileTube) ? window.FileTube.player : null;
      const t = (player && typeof player.getCurrentTime === 'function') ? player.getCurrentTime() : null;
      if (typeof t === 'number' && isFinite(t) && t >= 1) {
        if (shareChoiceDismiss) { signal.removeEventListener('abort', shareChoiceDismiss); shareChoiceDismiss = null; }
        shareChoiceDismiss = showChoiceModal('Share', [
          { label: 'Share video', onPick: () => runShare(base) },
          { label: 'Share at current time (' + formatDuration(t) + ')', onPick: () => runShare(withShareStartTime(base, t)) },
        ]);
        signal.addEventListener('abort', shareChoiceDismiss, { once: true });
        return;
      }
      runShare(base);
    }

    // Creates (once per view instance) and mounts the Share button as a
    // sibling of Download/Delete/Move/Like inside `.watch-action-btns` --
    // the SAME nowrap sub-group and createElement/textContent conventions as
    // `setupMoveButton`/`setupLikeButton` above. Unlike those, it is
    // CONDITIONAL: only an item the server derived an original YouTube link
    // for (`mediaData.watchUrl`) gets one -- and a stale button from a prior
    // item on this SPA view is removed when the current item has no link.
    function setupShareButton() {
      const watchActions = root.querySelector('.watch-actions');
      if (!watchActions || !mediaData) return;
      const hasUrl = typeof mediaData.watchUrl === 'string' && mediaData.watchUrl !== '';
      if (!hasUrl) {
        if (shareBtn) { shareBtn.remove(); shareBtn = null; }
        return;
      }
      if (!shareBtn) {
        shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.id = 'share-media-btn';
        shareBtn.className = 'btn';
        shareBtn.title = 'Share the original YouTube link';
        shareBtn.setAttribute('aria-label', 'Share the original YouTube link');
        const btnGroup = watchActions.querySelector('.watch-action-btns');
        (btnGroup || watchActions).appendChild(shareBtn);
        shareBtn.addEventListener('click', handleShareClick, { signal });
      }
      // v1.47.6: icon + hideable label, rebuilt each time so a pending
      // "Copied!" state is reset on re-render. `replaceChildren` first, because
      // this runs on every media load and must not accumulate children.
      shareBtn.replaceChildren();
      const shareIcon = document.createElement('i');
      shareIcon.className = 'icon-share';
      const shareLabel = document.createElement('span');
      shareLabel.className = 'btn-label';
      shareLabel.textContent = 'Share';
      shareBtn.appendChild(shareIcon);
      shareBtn.appendChild(document.createTextNode(' '));
      shareBtn.appendChild(shareLabel);
    }

    // ---- v1.49 (Dean): per-video reheat --------------------------------------
    //
    // "The ability to, on a specific video, force a reheat." The library-wide
    // Reheat lives on the Subscriptions page and is all-or-nothing; this is the
    // same work scoped to the item you are looking at -- refresh the channel
    // identity, the real title, the view count, chapters and subtitles for THIS
    // video, and then offer to file it under its channel.
    //
    // Mounted as a sibling of Download/Delete/Move/Like/Share inside
    // `.watch-action-btns` -- the SAME nowrap sub-group, the SAME `.btn` class
    // and the SAME icon + `.btn-label` shape as the other five, so it is the
    // same size as its neighbours and inherits the phone breakpoint's
    // label-hiding for free (Dean: "same size as the rest, maintain on the one
    // width"). No new button CSS is added; that is the point.
    //
    // Gated on the latched module health probe (see `probeReheatModule`): an
    // install running without yt-dlp has no reheat to offer and gets no button.
    function setupReheatButton() {
      const watchActions = root.querySelector('.watch-actions');
      if (!watchActions || !mediaData) return;
      const mountReheatBtn = () => {
        if (reheatBtn) return; // idempotent: a second media load must not duplicate it
        reheatBtn = document.createElement('button');
        reheatBtn.type = 'button';
        reheatBtn.id = 'reheat-media-btn';
        reheatBtn.className = 'btn';
        reheatBtn.title = 'Reheat: re-fetch this video’s channel, title, view count and subtitles';
        reheatBtn.setAttribute('aria-label', 'Reheat this video’s metadata');
        const icon = document.createElement('i');
        icon.className = 'icon-flame';
        const label = document.createElement('span');
        label.className = 'btn-label';
        label.textContent = 'Reheat';
        reheatBtn.appendChild(icon);
        reheatBtn.appendChild(document.createTextNode(' '));
        reheatBtn.appendChild(label);
        const btnGroup = watchActions.querySelector('.watch-action-btns');
        (btnGroup || watchActions).appendChild(reheatBtn);
        reheatBtn.addEventListener('click', handleReheatClick, { signal });
      };
      // v1.53 capability cache: OPTIMISTIC mount from the last known answer
      // (frame-one on refresh). The REAL probe below is the reconciler -- its
      // !enabled branch removes an optimistically-mounted button, so a
      // module revoked since the cache was written corrects after ~1 RTT
      // (the disclosed window).
      const cachedCap = readCapabilityCache();
      if (cachedCap && cachedCap.moduleEnabled === true) mountReheatBtn();
      probeReheatModule().then((enabled) => {
        // The probe is async, so by the time it resolves this view may already
        // have been torn down (SPA navigation) -- the abort signal is the
        // staleness truth this file uses everywhere else for exactly this.
        if (signal.aborted) return;
        if (!enabled) {
          if (reheatBtn) { reheatBtn.remove(); reheatBtn = null; }
          return;
        }
        mountReheatBtn();
      });
    }

    function setReheatBusy(busy) {
      if (!reheatBtn) return;
      reheatBtn.disabled = busy;
      reheatBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function stopReheatPoll() {
      if (reheatPollTimer) {
        clearInterval(reheatPollTimer);
        reheatPollTimer = null;
      }
    }

    // The server answers 202 and does the work in the background (one network
    // fetch, serialized behind whatever else the shared yt-dlp queue is doing),
    // so the result arrives via the SAME `GET /api/subscriptions/status`
    // snapshot the download chip already polls -- no second progress mechanism.
    function handleReheatClick() {
      if (!mediaData || !reheatBtn || reheatBtn.disabled) return;
      const id = mediaData.id;
      setReheatBusy(true);
      fetch(`/api/ytdlp/repull-metadata/item/${encodeURIComponent(id)}`, { method: 'POST' })
        .then((res) => res.json().catch(() => ({})).then((body) => ({ status: res.status, body })))
        .then(({ status, body }) => {
          if (status === 202) {
            showToast('Reheating…');
            pollReheat(id);
            return;
          }
          setReheatBusy(false);
          if (status === 409) { showToast('A reheat is already running.'); return; }
          if (status === 404) { showToast('This video has no source to reheat from.'); return; }
          if (status === 403) { showToast('Read-only mode: reheat is disabled on this instance.'); return; }
          showToast((body && body.error) || 'Reheat could not be started.');
        })
        .catch(() => {
          setReheatBusy(false);
          showToast('Reheat could not be started.');
        });
    }

    function pollReheat(id) {
      stopReheatPoll();
      let elapsed = 0;
      const everyMs = 1000;
      // A per-video reheat is one yt-dlp fetch, but it queues behind whatever
      // the shared FIFO gate is already running (a large download, a
      // subscription poll), so the ceiling is generous. Timing out here only
      // stops the POLL -- the job itself runs to completion server-side and its
      // result is still visible in the download status chip.
      //
      // GATE FIX (adversarial SUGGESTION 2): deliberately SHORTER than
      // activity.js's ONESHOT_TTL_MS (5 minutes). At exactly the TTL, a job
      // finishing near the ceiling could have its terminal entry pruned in the
      // same window this gives up in -- so the toast would say "check the
      // activity chip" and the chip would be empty.
      const ceilingMs = 4 * 60 * 1000;
      reheatPollTimer = setInterval(() => {
        elapsed += everyMs;
        if (elapsed >= ceilingMs) {
          stopReheatPoll();
          setReheatBusy(false);
          showToast('Reheat is taking a while; check the activity chip.');
          return;
        }
        fetch('/api/subscriptions/status')
          .then((res) => (res.ok ? res.json() : null))
          .then((snapshot) => {
            if (signal.aborted) { stopReheatPoll(); return; }
            const entry = snapshot && snapshot.oneShots && snapshot.oneShots['repull-metadata-item'];
            if (!entry || entry.state === 'running' || entry.state === 'queued') return;
            // Guard against reading a TERMINAL entry left over from a PREVIOUS
            // video's reheat BEFORE deciding this poll is finished: the one-shot
            // key is fixed and TTL-pruned only after minutes, so a stale `done`
            // entry is genuinely reachable. Checked here rather than after
            // `stopReheatPoll()` on purpose -- stopping first would abandon the
            // poll on someone else's result and silently never report ours.
            if (entry.mediaId && entry.mediaId !== id) return;
            stopReheatPoll();
            setReheatBusy(false);
            if (entry.state === 'error') { showToast('Reheat failed.'); return; }
            showToast(describeReheat(entry));
            // Re-render from the server rather than patching fields by hand --
            // the reheat can change the title, channel, view count, chapters
            // and subtitle availability at once, and reloadMedia() is the one
            // path that already knows how to render all of them consistently.
            reloadMediaAfterReheat(id);
            if (entry.relocation && entry.relocation.available) offerRelocation(id, entry.relocation);
          })
          .catch(() => { /* a transient poll failure is not fatal -- try again next tick */ });
      }, everyMs);
      // An un-cleared interval would outlive this view instance and keep
      // polling (and keep a dead view's closure alive) for the life of the tab.
      // GATE FIX (adversarial SUGGESTION 3): registered ONCE per view instance
      // rather than once per click -- `stopReheatPoll` reads the current timer
      // from the closure, so one registration covers every poll this view ever
      // starts, and repeated clicks stop accumulating listeners.
      if (!reheatAbortHooked) {
        reheatAbortHooked = true;
        signal.addEventListener('abort', stopReheatPoll, { once: true });
      }
    }

    // Honest, specific feedback: say what actually changed, and say plainly when
    // nothing did. `networkRan === false` is the "this is a home video" case --
    // reporting a cheerful success there would be a lie about work that never
    // happened (intake decision 3).
    function describeReheat(entry) {
      // Branch on the job's OWN outcome field, never on `state`: `state` is the
      // lifecycle marker and reads 'done' for a job that finished having failed
      // its item. Getting this backwards would report success for work that did
      // not happen -- the exact failure mode this repo's honesty norms exist for.
      if (entry.outcome === 'failed') {
        return 'Reheat did not complete. Some metadata may have been saved; try again.';
      }
      if (entry.networkRan === false) return 'No YouTube source found for this video, so there was nothing to refresh.';
      const before = entry.before || {};
      const after = entry.after || {};
      const parts = [];
      // v1.53 (Dean's decision 3): a manual attribution that DECLINED a
      // conflicting network identity is named specifically -- PREPENDED
      // (gate round S1: an early return swallowed the same run's real
      // title/views/chapters updates), never silent.
      if (entry.attributionConflict && entry.attributionConflict.kept) {
        parts.push(`kept your manual attribution (${entry.attributionConflict.kept}); the source now reports ${entry.attributionConflict.discovered}`);
      }
      if (after.channelName && after.channelName !== before.channelName) parts.push(`channel: ${after.channelName}`);
      if (after.title && after.title !== before.title) parts.push('title updated');
      if (typeof after.sourceViewCount === 'number' && after.sourceViewCount !== before.sourceViewCount) {
        parts.push(`views: ${formatCount(before.sourceViewCount)} → ${formatCount(after.sourceViewCount)}`);
      }
      if (after.hasSubtitles && !before.hasSubtitles) parts.push('subtitles added');
      // GATE FIX (adversarial SUGGESTION 1): the type check is load-bearing.
      // `after` is `{}` when the server's post-run database re-read threw (it
      // logs and continues), and `undefined !== 0` is true -- which toasted the
      // literal string "chapters: undefined".
      if (typeof after.chapterCount === 'number' && after.chapterCount !== before.chapterCount) {
        parts.push(`chapters: ${after.chapterCount}`);
      }
      if (after.releaseDate && after.releaseDate !== before.releaseDate) parts.push('release date updated');
      if (parts.length === 0) return 'Reheated. Everything was already up to date.';
      return `Reheated. ${parts.join(', ')}.`;
    }

    function formatCount(n) {
      return (typeof n === 'number' && Number.isFinite(n)) ? n.toLocaleString() : 'unknown';
    }

    // Re-render this page from the server after a reheat. A reheat can change
    // the title, the channel (name AND avatar), the view count, the release
    // date, the chapter list and subtitle availability -- all at once -- so
    // re-fetching the item and running the SAME `populateMetadata` the initial
    // load uses is both simpler and safer than hand-patching six fields into
    // the DOM and hoping the list stays in sync with what the reheat can write.
    //
    // Deliberately does NOT touch the player: the file itself is untouched by a
    // metadata reheat (nothing moves here -- see the confirm flow for the half
    // that does), so interrupting playback would be a regression, not a refresh.
    function reloadMediaAfterReheat(id) {
      fetch(`/api/videos/${encodeURIComponent(id)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((fresh) => {
          if (!fresh || signal.aborted) return;
          mediaData = fresh;
          const channelName = resolveChannelName(mediaData, folderSettings);
          currentChannelName = channelName;
          populateMetadata(channelName);
        })
        .catch(() => { /* the toast already reported the outcome; a failed re-render is cosmetic */ });
    }

    // The confirm step for the IRREVERSIBLE half. Dean has no media backup, so
    // this states the destination and HOW the bytes move (a hard link copies
    // nothing; a cross-filesystem move is a real copy, then the original is
    // removed after a checksum match) before he commits to anything.
    //
    // Built at runtime and appended to document.body via the shared
    // `showConfirmModal` -- deliberately NOT markup added to watch.html. The
    // v1.41.7 relocation-preview modal shipped broken for exactly that reason:
    // its markup lived outside `#view-root`, which the SPA router is the only
    // thing it swaps, so in-app navigation never mounted it (tech-debt #34).
    function offerRelocation(id, relocation) {
      // GATE FIX (adversarial CRITICAL 2, second half): never open on top of
      // another confirm dialog. The id-collision itself is fixed in
      // showConfirmModal, but two stacked, individually-undismissable modals is
      // still a broken screen -- and this is the only caller that can fire
      // without the user having just clicked something.
      //
      // GATE FIX (adversarial CRITICAL 4): `:not(.modal-closing)` is
      // LOAD-BEARING, and without it this whole function's stale-proposal
      // re-ask was itself dead code. `showConfirmModal`'s teardown adds
      // `.modal-closing` synchronously but leaves the node in `document.body`
      // for the ~200ms opacity transition, and it runs teardown BEFORE
      // `onConfirm` -- so the re-entrant call below (triggered by a 409 that
      // comes back in single-digit milliseconds: one db read, no I/O, no
      // spawn) always matched the still-fading backdrop of the dialog that
      // triggered it, and returned. The user saw "the destination changed" and
      // then nothing, ever. It would have worked only under
      // `prefers-reduced-motion`, where the node is removed synchronously.
      // `.modal-closing` exists (v1.26.2) precisely to mean "on its way out,
      // not interactive", so this asks the right question: is a LIVE dialog up?
      if (document.querySelector('.modal-backdrop:not(.modal-closing)')) {
        // Second half of the same finding: do not drop the offer in silence.
        // A genuinely open dialog (the Delete confirm, say) would otherwise
        // make the relocation offer vanish with no toast and no retry -- a
        // second quiet way for "the offer never appears", which is exactly the
        // bug this release already had to fix once.
        showToast('This video can also be filed under its channel — press Reheat again when you are done here.');
        return;
      }

      const dest = relocation.destinationPath || '';
      const isCopy = relocation.transfer === 'copy';
      const size = (typeof relocation.sizeBytes === 'number' && relocation.sizeBytes > 0)
        ? ` (${formatFileSizeSafe(relocation.sizeBytes)})`
        : '';
      const how = isCopy
        ? `Copied across filesystems${size}, then the original is removed after a checksum match.`
        : (relocation.transfer === 'hardlink'
          ? 'Hard link on the same filesystem — no data is copied.'
          : 'The transfer method is decided at move time.');
      const dismiss = showConfirmModal(
        'File this video under its channel?',
        `${escapeHtmlText(dest)}<br><br>${escapeHtmlText(how)}`,
        () => {
          if (relocationDismiss) { signal.removeEventListener('abort', relocationDismiss); relocationDismiss = null; }
          // GATE FIX (adversarial CRITICAL 1): stop the player BEFORE the move,
          // not just before the navigate. The server now allows relocating a
          // recently-watched file for this attended path (see
          // `allowRecentlyWatched`), so this client is the one that must not be
          // left Range-requesting a path that is about to stop existing.
          if (window.FileTube && window.FileTube.player) window.FileTube.player.close();
          fetch(`/api/ytdlp/repull-metadata/item/${encodeURIComponent(id)}/relocate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // GATE FIX (adversarial CRITICAL 3): echo back the exact move the
            // user was shown. Subscribing to the channel from this very page --
            // which is the reheat's own headline outcome -- changes the
            // destination folder, so "the plan is still legal" is not the same
            // question as "the plan is still the one you approved".
            // GATE FIX (adversarial WARNING 5): `transfer` rides along because
            // it is the SAFETY SENTENCE this dialog just showed -- hard link vs
            // copy-then-delete-the-original -- and it can flip with both paths
            // unchanged (see the executor's own comment). `sizeBytes` is what
            // the user judged "do I have room" on.
            body: JSON.stringify({
              expect: {
                currentPath: relocation.currentPath,
                destinationPath: relocation.destinationPath,
                transfer: relocation.transfer,
                sizeBytes: relocation.sizeBytes,
              },
            }),
          })
            .then((res) => res.json().catch(() => ({})).then((body) => ({ status: res.status, body })))
            .then(({ status, body }) => {
              if (body && body.status === 'moved') {
                showToast(body.archived === false
                  ? 'Moved, but it is not in the download archive — a subscription poll may re-download it.'
                  : 'Moved into its channel folder.');
                // The move re-keyed this item (the id is a hash of the path), so
                // this page is holding a dead id.
                const nextId = body.newId;
                const target = nextId ? `/watch/${encodeURIComponent(nextId)}` : '/';
                if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(target);
                else window.location.href = target;
                return;
              }
              // GATE FIX (adversarial SUGGESTION 4): NO MOVE HAPPENED, so the
              // pre-emptive `player.close()` above cost the user their playback
              // for nothing. Every path below this point is a non-move, so
              // playback is restored once, here, before any of them report.
              // `load` is idempotent for an id it already holds, so this is a
              // resume rather than a restart.
              if (window.FileTube && window.FileTube.player && mediaData && !signal.aborted) {
                try {
                  // `browseCtx` is LOAD-BEARING and was dropped here in the
                  // first cut of this restore (gate fix, adversarial Q4).
                  // `player.close()` nulls `currentData`, so this re-load takes
                  // the full new-load path and the adopt branch's browseCtx
                  // carry-forward never runs -- leaving `advanceRawCtx` empty,
                  // which silently reverts autoplay-at-end and the player's
                  // own next/prev to the FOLDER default instead of the list the
                  // user actually launched from (a shuffled home grid, a search,
                  // Liked). That is the v1.36.2 launch-context property, undone
                  // by one missing field on a re-issued call: this repo's
                  // most-repeated bug class, in a line added to fix something
                  // else. Matches the other two `player.load` call sites in this
                  // file exactly.
                  window.FileTube.player.load(
                    mediaData.id,
                    { ...mediaData, channelName: currentChannelName, browseCtx: rawBrowseCtx },
                    { slot: playerSlot },
                  );
                } catch (_) { /* a failed resume must never swallow the message below */ }
              }
              // The destination changed under us -- re-ask about the move that
              // is actually on the table now rather than reporting a failure.
              if (status === 409 && body && body.status === 'stale' && body.relocation) {
                showToast('The destination changed — check the new one.');
                offerRelocation(id, body.relocation);
                return;
              }
              if (status === 409) { showToast('Something else is running; try again in a moment.'); return; }
              if (status === 403) { showToast('Read-only mode: moving files is disabled on this instance.'); return; }
              if (status === 503) { showToast('Moving is unavailable on this install.'); return; }
              // An integrity FAILURE must not read like a benign skip. A
              // cross-device checksum mismatch and "you already have this video
              // in that folder" are not the same news about an irreplaceable file.
              if (body && (body.failed || body.status === 'failed')) {
                showToast(`The move FAILED and was rolled back: ${(body && body.reason) || 'unknown reason'}`);
                return;
              }
              showToast(`Not moved: ${(body && body.reason) || 'not a candidate'}.`);
            })
            .catch(() => showToast('The move could not be started.'));
        },
        { confirm: 'Move it', cancel: 'Leave it where it is' },
      );

      // GATE FIX (adversarial WARNING 2): this dialog lives on document.body,
      // which the SPA router never swaps -- without this it survives onto the
      // NEXT video's page, still showing the previous video's destination, and
      // "Move it" would move a file the user is no longer looking at.
      if (typeof dismiss === 'function') {
        if (relocationDismiss) signal.removeEventListener('abort', relocationDismiss);
        relocationDismiss = dismiss;
        signal.addEventListener('abort', relocationDismiss, { once: true });
      }
    }

    // `showConfirmModal` interpolates its body with innerHTML, and both strings
    // above are filesystem-derived (a path, a channel-named folder). Escaped
    // here rather than trusted -- a filename is attacker-influenced input on a
    // server that scans whatever folders it is pointed at.
    function escapeHtmlText(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatFileSizeSafe(bytes) {
      if (typeof formatFileSize === 'function') return formatFileSize(bytes);
      return `${Math.round(bytes / (1024 * 1024))} MB`;
    }

    // Opens the shared `showMoveModal` (common.js) with the CURRENT item +
    // `currentFolders` (the SAME `GET /api/config` folders array initWatch()
    // already fetched for the sidebar -- no new network call); confirming a
    // folder calls `requestMoveItem`. A successful move RE-KEYS this item
    // under a new id (server.js's C1 re-key -- see common.js's
    // `showMoveModal`/`requestMoveItem` comment), so THIS watch page's own
    // `mediaId` is stale the instant the move succeeds -- mirroring
    // `performMediaDelete`'s exact post-success navigate, the sensible
    // refresh here is the same "leave this page, back to the library" rather
    // than trying to reload this same, now-relocated id in place.
    function handleMoveClick() {
      if (!mediaData) return;
      showMoveModal(mediaData, currentFolders, (targetFolder, { teardown, statusEl, reenable }) => {
        statusEl.textContent = 'Moving...';
        requestMoveItem(mediaData.id, targetFolder)
          .then(() => {
            teardown();
            showToast('File moved.');
            // Mirrors `performMediaDelete`'s exact pre-navigate step: a
            // successful move re-keys this item under a brand-new id (the
            // C1 re-key), so the persistent player -- which is still holding
            // the OLD id -- would otherwise keep Range-requesting a media
            // resource that no longer exists under that id and 404 mid-
            // playback. Stop it BEFORE navigating away.
            if (window.FileTube && window.FileTube.player) window.FileTube.player.close();
            if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate('/');
            else window.location.href = '/';
          })
          .catch((err) => {
            statusEl.textContent = (err && err.message) || 'Move failed.';
            // v1.26.2 code-review fix (F2): showMoveModal's Move/Cancel
            // buttons are disabled for the duration of this request (its own
            // busy guard, common.js) -- on failure the modal stays open (no
            // teardown() call above) so the user can pick a different folder
            // and retry, which requires explicitly handing control back.
            if (typeof reenable === 'function') reenable();
          });
      });
    }

    // Deletion logic. FR-7 (v1.21.0, T6): a yt-dlp-managed file is
    // re-downloadable, so it keeps this EXACT, unmodified confirm flow
    // (AC47). A LOCAL file is irreplaceable, so it routes through the more
    // deliberate, checkbox-gated `showHardDeleteModal` (common.js) instead
    // (AC46/AC49) -- both paths converge on the exact same
    // `performMediaDelete()` below, which fires the SAME, unmodified
    // `DELETE /api/videos/:id` (AC48).
    async function performMediaDelete() {
      try {
        // Stop playback and release the (about to be deleted) media
        // resource -- there is nothing left to save progress for or dock.
        if (window.FileTube && window.FileTube.player) window.FileTube.player.close();

        const res = await fetch(`/api/videos/${mediaId}`, { method: 'DELETE' });
        // v1.81 write-RBAC: a member without the capability gets a 403 - tell
        // them plainly and leave the item exactly where it is (no phantom
        // removal / navigate). The server already refused; honor that truth.
        if (res.status === 403) {
          showToast("You don't have permission to delete library files.");
          return;
        }
        const data = await res.json();

        if (data.success) {
          // FR-3(a), T2: the post-success alert() was blocking friction --
          // a brief, non-blocking, auto-dismissing toast (common.js) gives
          // the same feedback without requiring a dismiss tap before the
          // navigate() below can proceed. v1.41.10 (QA gate): the message now
          // reflects the server's actual outcome (clean / remains / pending)
          // via the shared deleteResultToast mapper.
          showToast(deleteResultToast(data));
          // v1.33.1 (QA gate): deleting an item can change the liked COUNT
          // (a liked item's deletion removes it from the liked view) -- the
          // count-gated sidebar entry's cached total must be refreshed, or
          // deleting the LAST liked video leaves a stale Liked entry
          // pointing at an empty view until a reload. The home view the
          // navigate() below lands on re-applies through the same helper
          // and picks up this refreshed cache.
          applyLikedSidebarEntry(sidebarFoldersList, { force: true });
          if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate('/');
          else window.location.href = '/';
        } else {
          showToast('Error deleting file: ' + (data.error || 'unknown error'));
        }
      } catch (err) {
        console.error(err);
        showToast('Network error occurred while trying to delete file.');
      }
    }

    deleteBtn.addEventListener('click', () => {
      if (isYtdlpManagedItem(mediaData)) {
        // yt-dlp-managed confirm flow (AC47). v1.65 gate fix (QA W3): the
        // copy tells the trash truth now -- "permanent" became a lie the
        // moment deletes started routing through Trash.
        showConfirmModal(
          'Move to Trash?',
          `Move <strong>${escapeHtml(mediaData.title)}</strong> to Trash?<br><br><span style="color:var(--yt-red); font-weight:bold;">The file leaves your library now and is permanently removed when the Trash retention window empties it:</span><br><code style="word-break:break-all; font-size:11px;">${escapeHtml(mediaData.filePath)}</code>`,
          performMediaDelete
        );
      } else {
        // Local/irreplaceable -- the escalated, checkbox-gated confirm (AC46/AC49).
        showHardDeleteModal(mediaData, performMediaDelete);
      }
    }, { signal });

    // Description expand/collapse toggle
    expandDescBtn.addEventListener('click', () => {
      const isExpanded = descriptionParagraph.classList.toggle('expanded');
      expandDescBtn.textContent = isExpanded ? 'Show less' : 'Show more';
    }, { signal });

    // Header folder list rendering
    function renderSidebarFolders(folders, settings = {}) {
      // v1.41.4 (Dean bug): a folder flagged folderSettings[path].hiddenFromSidebar
      // must be omitted here TOO, exactly as the home sidebar (main.js), the
      // Setup list (setup.js), and the mobile Playlists sheet (common.js) already
      // do via visibleSidebarFolders(). This list previously mapped the RAW
      // `folders` array, so opening a video re-showed every hidden folder in the
      // sidebar -- the visibility setting held on Home but was ignored on watch.
      const visibleFolders = visibleSidebarFolders(folders, settings, watchSyntheticFolders); // v1.73.1: synthetic threads here too (slim-gate C1)
      if (visibleFolders.length === 0) {
        sidebarFoldersList.innerHTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';
        // v1.33.1 (Dean): the count-gated Liked entry, via the SAME shared
        // helper every other sidebar surface uses -- this list previously
        // never rendered it at all, so opening a video "lost" the Liked link.
        applyLikedSidebarEntry(sidebarFoldersList);
        return;
      }
      sidebarFoldersList.innerHTML = visibleFolders.map(f => {
        const folderName = f.split(/[\\/]/).pop() || f;
        const label = (settings[f] && settings[f].name) || folderName;
        const glyphClass = resolveFolderGlyphClass(settings[f] && settings[f].glyph); // v1.77
        // ?root= shows everything under the mapped folder, including subfolders.
        return `
          <a href="/?root=${encodeURIComponent(f)}" class="sidebar-item" title="${escapeHtml(f)}">
            <i class="${glyphClass}"></i> ${escapeHtml(label)}
          </a>
        `;
      }).join('');
      applyLikedSidebarEntry(sidebarFoldersList); // v1.33.1: see above
    }

    // NOTE: the header search box's click/keypress listeners are shell-owned
    // (bound once at boot by common.js — see the C1 remediation comment
    // there), not wired per-view here.

    // Local escape HTML helper
    function escapeHtml(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Run start
    initWatch();
  }

  // NOTE (T2): this view no longer owns the player, so destroy() no longer
  // touches playback at all -- it only tears down THIS view's own listeners
  // (comments/rating/delete/description-toggle/search/sidebar). Whether the
  // player docks (kept playing) or has nothing loaded is entirely decided by
  // the router's `applyPlayerTransition` (common.js), which runs BEFORE this
  // destroy() on every navigation away from the watch view.
  function destroy() {
    if (controller) {
      controller.abort();
      controller = null;
    }
  }

  if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('watch', { init, destroy });
  }
})();
