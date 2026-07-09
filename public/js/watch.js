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

// ---- G1: Zak Goldin weighted mock-commenter + comment-bank selection ------
// (v1.24.0, T4). Pure/DOM-free, hoisted to module scope (like the pure
// helpers above) so node:test can exercise both the flat commentBank
// selection AND the new weighted Zak Goldin layer directly, without a
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
  { author: 'Joe Dowden', text: 'cool. touch grass.', timeStr: '2 days ago' },
  { author: 'Joe Dowden', text: 'you spent HOW long on this. the outdoors is free, you know.', timeStr: '5 days ago' },
  { author: 'Joe Dowden', text: 'please tell me a human wrote this and not some chatbot', timeStr: '1 week ago' },
  { author: 'Joe Dowden', text: 'impressive, i guess. the sun still exists though.', timeStr: '3 days ago' },
  { author: 'Joe Dowden', text: 'neat. go outside.', timeStr: '4 days ago' },
  { author: 'Jesahel Vallejo', text: 'lil b really built his own youtube 😤', timeStr: '2 days ago' },
  { author: 'Jesahel Vallejo', text: 'clean work lil b. anyway i got the Lakers +4 tonight', timeStr: '5 days ago' },
  { author: 'Jesahel Vallejo', text: 'lil b i\'m 3 legs into a 5 leg parlay and STILL watching this', timeStr: '1 week ago' },
  { author: 'Jesahel Vallejo', text: '10/10 lil b. hits better than cashing a same-game parlay', timeStr: '3 days ago' },
  { author: 'Jesahel Vallejo', text: 'solid lil b. might put the whole bankroll on this app', timeStr: '4 days ago' },
  { author: 'Jesse Torres', text: 'nice work. consider a service worker for offline playback next.', timeStr: '2 days ago' },
  { author: 'Jesse Torres', text: 'solid. i\'d add rate limiting on the transcode endpoint though.', timeStr: '5 days ago' },
  { author: 'Jesse Torres', text: 'clean. throw some integration tests on the scan logic.', timeStr: '1 week ago' },
  { author: 'Jesse Torres', text: 'good stuff. debounce the progress saves to cut disk writes.', timeStr: '3 days ago' },
  { author: 'Jesse Torres', text: 'works well. extract that transcode queue into its own module.', timeStr: '4 days ago' },
  { author: 'TFR', text: 'solid. now boot up Derby Owner\'s Club and let\'s run a few races 🐎', timeStr: '2 days ago' },
  { author: 'TFR', text: 'good but it needs more Derby Owner\'s Club if we\'re being honest', timeStr: '5 days ago' },
  { author: 'TFR', text: '10/10 would watch between DOC sessions', timeStr: '1 week ago' },
  { author: 'TFR', text: 'my horse would approve of this upload 🏇', timeStr: '3 days ago' },

  // Family
  { author: 'Ray Tammam', text: 'oh good, another project instead of answering my texts', timeStr: '2 days ago' },
  { author: 'Ray Tammam', text: 'you invented youtube. truly no one has ever done this before.', timeStr: '5 days ago' },
  { author: 'Ray Tammam', text: 'impressive. anyway you still owe me for lunch.', timeStr: '1 week ago' },
  { author: 'Ray Tammam', text: 'cool app. still only the second funniest person in the family though.', timeStr: '3 days ago' },
  { author: 'Ray Tammam', text: 'so THIS is what "im busy" meant', timeStr: '4 days ago' },
  { author: 'Marcy Tammam', text: 'babe it is 2am. the server will still be here tomorrow.', timeStr: '2 hours ago' },
  { author: 'Marcy Tammam', text: 'very impressive. now do the dishes you promised 😘', timeStr: '1 day ago' },
  { author: 'Marcy Tammam', text: '10/10 but you STILL haven\'t watched the Calico Critters episode with me', timeStr: '3 days ago' },
  { author: 'Marcy Tammam', text: 'cute. the Calico Critters have a nicer house than we do though 🐰', timeStr: '5 days ago' },
  { author: 'Marcy Tammam', text: 'you named a git branch instead of taking out the trash didn\'t you', timeStr: '4 days ago' },
  { author: 'Marcy Tammam', text: 'love it honey. putting it on the shelf next to my Calico Critters 💕', timeStr: '1 week ago' },
  { author: 'Zouhir Tammam', text: 'Very thorough assessment son. I wish I was next to you to help you with all these projects. Love you.', timeStr: '2 days ago' },
  { author: 'Zouhir Tammam', text: 'Excellent work my son. So very proud of you. Love you.', timeStr: '5 days ago' },
  { author: 'Zouhir Tammam', text: 'This is wonderful. You were always so talented. Call me and show me how it works. Love you son.', timeStr: '1 week ago' },
  { author: 'Zouhir Tammam', text: 'Beautiful project son. I wish I could sit beside you and build these with you. Love you.', timeStr: '3 days ago' },

  // Daisy 💛 (she's 5)
  { author: 'Daisy Tammam', text: 'hi daddy i luv u 💖', timeStr: '2 hours ago' },
  { author: 'Daisy Tammam', text: 'dis is the BEST vidyo EVER!!!', timeStr: '1 day ago' },
  { author: 'Daisy Tammam', text: 'daddy ur so smart!!!', timeStr: '3 hours ago' },
  { author: 'Daisy Tammam', text: 'i wach it a HUNDRED times 🥰', timeStr: '5 hours ago' },
  { author: 'Daisy Tammam', text: 'can we hav ice cream after pleez 🍦', timeStr: '4 days ago' },
  { author: 'Daisy Tammam', text: 'i luv u dad to the moon 🌙', timeStr: 'just now' },
  { author: 'Daisy Tammam', text: 'my daddy maded dis!!!', timeStr: '2 days ago' },
  { author: 'Daisy Tammam', text: 'SO GOOD i clapd 👏', timeStr: '6 hours ago' },
  { author: 'Daisy Tammam', text: 'daddy is the best on the hole erf', timeStr: '1 day ago' },
  { author: 'Daisy Tammam', text: 'i drawed u a picsher 🎨', timeStr: '3 days ago' },
  { author: 'Daisy Tammam', text: 'yaaay daddy!!! 🎉', timeStr: '5 days ago' },
  { author: 'Daisy Tammam', text: 'wach wif me daddy pleeez', timeStr: '1 week ago' }
];

// selectDeterministicComments: the ORIGINAL flat, unweighted, deterministic
// selection mechanism (byte-for-byte unchanged from pre-v1.24.0) -- `seed +
// i*7 % bank.length`, skipping already-used indices. Pure: the SAME
// (mediaId, bank, count) always returns the SAME ordered comment list. G1
// layers Zak Goldin on TOP of this in buildMockComments() below WITHOUT
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
function hashZakGoldinSeed(str) {
  let hash = 5381;
  const safe = String(str || '');
  for (let i = 0; i < safe.length; i++) {
    hash = ((hash << 5) + hash + safe.charCodeAt(i)) | 0; // hash*33 + c
  }
  return Math.abs(hash);
}

const ZAK_GOLDIN_AUTHOR = 'Zak Goldin';

// Zak Goldin's own timeStr pool -- picked deterministically per mediaId,
// same spirit as the rest of commentBank's fixed timeStr values.
const ZAK_GOLDIN_TIME_STRINGS = ['3 days ago', '1 week ago', '5 hours ago', '2 months ago', '6 days ago', 'just now'];

// 87% of the time: a normal, tasteful, on-brand retro-comment-section reply.
const ZAK_GOLDIN_POLITE_COMMENTS = [
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
const ZAK_GOLDIN_UNHINGED_COMMENTS = [
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
const ZAK_GOLDIN_CONSPIRACY_TEMPLATES = [
  'wake up people, {title} was clearly uploaded at this exact time for a reason and none of you are asking why',
  'if you play {title} backwards you can hear the buffering wheel counting down to something',
  'coincidence that {title} exists at all? I THINK NOT. do your own research',
  '{title} is obviously a signal to the pigeons. I\'ve said too much'
];

// pickZakGoldinCategory: which bucket a given mediaId lands in. 87/10/3 is a
// LITERAL 0-99 range split (87 + 10 + 3 = 100), so the weighting is exact
// over a large deterministic sample, not a random approximation.
function pickZakGoldinCategory(mediaId) {
  const bucket = hashZakGoldinSeed(String(mediaId || '') + '::zak-goldin-category') % 100;
  if (bucket < 87) return 'polite';
  if (bucket < 97) return 'unhinged';
  return 'conspiracy';
}

function zakGoldinCommentPool(category) {
  if (category === 'unhinged') return ZAK_GOLDIN_UNHINGED_COMMENTS;
  if (category === 'conspiracy') return ZAK_GOLDIN_CONSPIRACY_TEMPLATES;
  return ZAK_GOLDIN_POLITE_COMMENTS;
}

// buildZakGoldinComment: the full Zak Goldin persona comment {author, text,
// timeStr} for a given (mediaId, videoTitle). Pure and fully deterministic --
// the SAME video always gets the SAME Zak Goldin comment, in the SAME
// weighted category, on every load.
function buildZakGoldinComment(mediaId, videoTitle) {
  const safeMediaId = String(mediaId || '');
  const category = pickZakGoldinCategory(safeMediaId);
  const pool = zakGoldinCommentPool(category);
  const textIdx = hashZakGoldinSeed(safeMediaId + '::zak-goldin-text::' + category) % pool.length;
  const timeIdx = hashZakGoldinSeed(safeMediaId + '::zak-goldin-time') % ZAK_GOLDIN_TIME_STRINGS.length;
  const safeTitle = typeof videoTitle === 'string' && videoTitle.trim() !== '' ? videoTitle.trim() : 'this video';
  const text = pool[textIdx].split('{title}').join(safeTitle);
  return { author: ZAK_GOLDIN_AUTHOR, text, timeStr: ZAK_GOLDIN_TIME_STRINGS[timeIdx] };
}

// buildMockComments: getMockInitialComments()'s pure core -- the ORIGINAL
// flat selection (selectDeterministicComments, untouched above) PLUS one Zak
// Goldin comment (G1) spliced in at a deterministic position. Because the
// base selection is computed FIRST and independently, layering Zak Goldin on
// top never changes which (or how many) of the rest of commentBank's entries
// get picked, or their relative order -- only where among them Zak Goldin's
// own comment lands.
function buildMockComments(mediaId, bank, count, videoTitle) {
  const base = selectDeterministicComments(mediaId, bank, count);
  const zakComment = buildZakGoldinComment(mediaId, videoTitle);
  const insertAt = base.length > 0
    ? hashZakGoldinSeed(String(mediaId || '') + '::zak-goldin-slot') % (base.length + 1)
    : 0;
  const withZak = base.slice();
  withZak.splice(insertAt, 0, zakComment);
  return withZak;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    nextTheaterState,
    isTheaterModeActive,
    theaterModeStorageValue,
    resolveUploaderLinkHref,
    MOCK_COMMENT_BANK,
    selectDeterministicComments,
    hashZakGoldinSeed,
    pickZakGoldinCategory,
    buildZakGoldinComment,
    buildMockComments,
  };
}

(function () {
  let controller = null;

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
    box.style.cssText = 'display:flex;flex-direction:column;justify-content:center;align-items:center;padding:24px 16px;text-align:center;color:var(--text-secondary);';

    const heading = document.createElement('h3');
    heading.style.marginBottom = '12px';
    heading.textContent = 'Failed to Load Media';

    const message = document.createElement('p');
    message.textContent = 'The file may have been moved, deleted, or the format is unsupported by your browser.';

    const backLink = document.createElement('a');
    backLink.href = '/';
    backLink.className = 'btn';
    backLink.style.marginTop = '16px';
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

    const addedDateText = root.querySelector('#added-date-text');
    const fileSizeText = root.querySelector('#file-size-text');
    const fileTypeText = root.querySelector('#file-type-text');
    const filePathText = root.querySelector('#file-path-text');

    const descriptionParagraph = root.querySelector('#description-paragraph');
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

    // v1.22.0 FR-5 (AC32-AC38): desktop-sidebar channel pins -- a SEPARATE
    // fetch against the module's own gated pin store, independent of
    // initWatch()'s own folder-list fetch/render below: renderPinnedSidebar
    // inserts `#sidebar-pinned-section` as a SIBLING of, never a child of,
    // `#sidebar-folders-list`, so it is unaffected regardless of fetch/
    // render ordering between the two. A 404 (module disabled) resolves to
    // `[]` (no pins rendered), preserving the disabled-module no-op
    // guarantee -- this never logs/throws on a 404. Read-only: never writes
    // db.folders/folderSettings.
    fetch('/api/subscriptions/pins')
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((pins) => renderPinnedSidebar(pins));

    // Parse media ID
    const urlParams = new URLSearchParams(window.location.search);
    const mediaId = urlParams.get('v');

    if (!mediaId) {
      window.location.href = '/';
      return;
    }

    let mediaData = null;
    let folderSettings = {};   // { "<path>": { name, hidden } } — for channel display name
    // FIX C (two-reviewer-gate follow-up): the FR-2-derived display name,
    // computed once in initWatch() via the SAME resolveChannelName() call
    // that drives the on-page uploader display, cached here so the Subscribe
    // modal (below) can read it directly rather than back-reading the
    // rendered `#uploader-channel-name` DOM node's textContent -- a future
    // refactor of that DOM node's rendering can no longer silently break the
    // modal's pre-fill.
    let currentChannelName = '';

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
    if (window.FileTube.player.currentId === mediaId) {
      const mountedEarly = window.FileTube.player.load(mediaId, {}, { slot: playerSlot });
      if (!mountedEarly) showFatalViewError(root);
    }

    // Initialize page
    async function initWatch() {
      try {
        // 1. Get configurations for sidebar
        const configRes = await fetch('/api/config');
        const configData = await configRes.json();
        folderSettings = configData.folderSettings || {};
        renderSidebarFolders(configData.folders || [], folderSettings);

        // 2. Fetch media details
        const mediaRes = await fetch(`/api/videos/${mediaId}`);
        if (!mediaRes.ok) {
          throw new Error('Media file not found');
        }
        mediaData = await mediaRes.json();

        // Channel name resolution is shared with the list cards (see common.js)
        // so the author shown here, on the home grid, AND on the persistent
        // player's Media Session metadata all agree.
        const channelName = resolveChannelName(mediaData, folderSettings);
        currentChannelName = channelName;

        // 3. Populate metadata details
        populateMetadata(channelName);

        // 4. Mount/play this media in the persistent player controller. This
        // is idempotent -- if the controller already has this exact id loaded
        // (the docked mini-player was tapped, or a related-card click landed
        // back on the same video), it's just a reparent into `playerSlot`
        // (no restart -- and, per the early adopt fast-path above, likely
        // already done by the time we get here); otherwise it's a genuine new
        // load, including its own resume-overlay/transcode-overlay/Media
        // Session setup. `data` merges in `channelName` since the controller
        // doesn't have folderSettings.
        const mounted = window.FileTube.player.load(mediaId, { ...mediaData, channelName }, { slot: playerSlot });
        if (!mounted) {
          showFatalViewError(root);
        }

        // 5. Load related sidebar
        loadRelatedFiles();

        // 6. Load comments
        loadComments();

        // 7. Render the deterministic (read-only) star rating
        renderStarRating();

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
        console.error(err);
        showFatalViewError(root);
        if (mediaTitle) {
          mediaTitle.textContent = 'Error loading file details';
          mediaTitle.style.color = 'var(--yt-red)';
        }
      }
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
      el.style.color = '#ffffff'; // AVATAR_PALETTE entries are all dark -- keep the glyph legible regardless of era theme
      el.textContent = source.glyph;
    }

    // Populate metadata to DOM. `channelName` is precomputed by initWatch()
    // (shared with the persistent player's Media Session setup — see there).
    function populateMetadata(channelName) {
      mediaTitle.textContent = mediaData.title;
      document.title = `${mediaData.title} - FileTube`;

      viewsCount.textContent = getMockViews(mediaData.id, mediaData.size);
      // F1: channelAvatarUrl is always null/absent today (C6/T11 populate it
      // in Wave 3) -- resolveAvatarSource gracefully falls back to the
      // generated avatar until then.
      applyAvatarToElement(uploaderAvatar, channelName, mediaData.channelAvatarUrl);
      uploaderChannelName.textContent = channelName;
      // Creator/uploader name links to THIS item's folder content view
      // (/?root=<folder>) -- routed by the shell's global anchor handler like a
      // sidebar-folder link. Re-set (or cleared) every load so the SPA-reused
      // node never keeps a stale href from the previous item.
      const uploaderLinkHref = resolveUploaderLinkHref({ filePath: mediaData.filePath });
      if (uploaderLinkHref) uploaderChannelName.href = uploaderLinkHref;
      else uploaderChannelName.removeAttribute('href');
      uploaderSubsCount.textContent = `${getMockSubCount(channelName)} subscribers`;

      addedDateText.textContent = formatRelativeTime(mediaData.addedAt);
      fileSizeText.textContent = formatFileSize(mediaData.size);
      // File type from the extension (e.g. ".mp4" -> "MP4")
      fileTypeText.textContent = (mediaData.ext || '').replace('.', '').toUpperCase() || 'Unknown';
      filePathText.textContent = mediaData.filePath;

      // FR-3 (v1.19.0): wire the Download button per media load -- the SPA
      // reuses this same anchor node across in-app navigations, so both
      // attributes are re-set every time populateMetadata() runs (never left
      // stale from a previous item). The actual save is authoritative on the
      // server's `Content-Disposition: attachment` header (works for both
      // audio and video, and for a needsTranscode item it downloads the
      // ORIGINAL file, never the transcode -- see server.js); the anchor's
      // `download` attribute here is just a belt-and-suspenders filename hint
      // for browsers that honor it (mainly desktop -- iOS Safari 13+ relies
      // on the Content-Disposition header instead, per the design note).
      if (downloadBtn) {
        downloadBtn.href = `/video/${encodeURIComponent(mediaData.id)}?download=1`;
        downloadBtn.setAttribute('download', `${mediaData.title || 'download'}${mediaData.ext || ''}`);
      }

      renderEmbeddedTags(mediaData.tags);
      // Measure once the (async) Roboto webfont has loaded, so line wrapping — and
      // thus the overflow check — reflects the final font, not the fallback.
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(setupDescriptionToggle);
      } else {
        setupDescriptionToggle();
      }
    }

    // Only offer "Show more" when the description overflows by a meaningful amount;
    // otherwise show it in full. Avoids the silly toggle that hid a single line.
    function setupDescriptionToggle() {
      if (!descriptionParagraph || !expandDescBtn) return;
      descriptionParagraph.classList.remove('expanded');
      expandDescBtn.textContent = 'Show more';
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
    function renderEmbeddedTags(tags) {
      const el = root.querySelector('#embedded-tags');
      if (!el) return;
      const title = (mediaData.title || '').toLowerCase();
      // Skip title/artist (shown elsewhere) and any tag whose value just repeats the
      // title. Cap very long values so a huge embedded description can't blow out layout.
      const clip = v => v.length > 400 ? v.slice(0, 400) + '…' : v;
      const entries = Object.entries(tags || {}).filter(([k, v]) =>
        k !== 'title' && k !== 'artist' && String(v).toLowerCase() !== title);
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
      try {
        const res = await fetch('/api/videos');
        const allFiles = await res.json();

        // Fuzzy-similar ranking (title/filename token overlap, shared folder,
        // shared channel/artist), falling back to most-recent when thin. See
        // docs/exec-plans/active/2026-07-05-audio-art-and-related.md ("Feature 2").
        const related = rankRelated({ ...mediaData, id: mediaId }, allFiles);

        if (related.length === 0) {
          relatedContainer.innerHTML = '<div style="color: var(--text-secondary); font-style: italic;">No other files found.</div>';
          return;
        }

        relatedContainer.innerHTML = related.map(item => {
          const durationStr = item.duration > 0 ? formatDuration(item.duration) : (item.type === 'audio' ? 'Audio' : '');
          const durationBadge = durationStr ? `<div class="duration-badge">${durationStr}</div>` : '';
          const views = getMockViews(item.id, item.size);

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
    async function setupPrevNext() {
      if (!prevBtn || !nextBtn) return;
      try {
        // Prev/Next walk the CURRENT ITEM'S FOLDER (Dean: "next/prev should be
        // in the folder your content is in, not all files"), scoped via the
        // home view's existing `?root=<folder>` filter. This also fixes prev/next
        // being greyed out for items in "Hide from home" folders -- the unscoped
        // /api/videos list excludes those, so the current item wasn't found and
        // computeNeighbors returned nothing. A folder query always includes it.
        const folder = parentFolder(mediaData && mediaData.filePath);
        const res = await fetch(folder ? '/api/videos?root=' + encodeURIComponent(folder) : '/api/videos');
        const allFiles = await res.json();
        let sortKey = 'newest';
        try { sortKey = localStorage.getItem('filetube_sort') || 'newest'; } catch (_) { /* storage disabled -- fall back to newest */ }
        const orderedIds = deriveOrderedIds(Array.isArray(allFiles) ? allFiles : [], sortKey);
        const { prevId, nextId } = computeNeighbors(orderedIds, mediaId);

        prevBtn.disabled = !prevId;
        nextBtn.disabled = !nextId;

        if (prevId) prevBtn.addEventListener('click', () => navigateToWatch(prevId), { signal });
        if (nextId) nextBtn.addEventListener('click', () => navigateToWatch(nextId), { signal });
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
    // in this closure -- `currentSubState`/`defaultMaxVideosForModal`/
    // `subscribeModalState` are mutable, private to this view instance, and
    // torn down implicitly on the next init() (a fresh view, fresh closure).
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
    let defaultMaxVideosForModal = 2;
    let subscribeModalState = null;

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
          defaultMaxVideos: defaultMaxVideosForModal,
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
          currentSubState = { ...currentSubState, subscribed: false, subId: null };
          applySubscribeButtonLabel(false);
        })
        .catch((e) => console.error('Error unsubscribing:', e));
    }

    async function setupSubscribeButton() {
      if (!subscribeBtn) return;
      let moduleEnabled = false;
      try {
        const healthRes = await fetch('/api/subscriptions/health');
        moduleEnabled = healthRes.ok;
        let subs = [];
        if (moduleEnabled) {
          const healthData = await healthRes.json().catch(() => ({}));
          if (Number.isInteger(healthData.defaultMaxVideos) && healthData.defaultMaxVideos >= 0) {
            defaultMaxVideosForModal = healthData.defaultMaxVideos;
          }
          const subsRes = await fetch('/api/subscriptions');
          subs = subsRes.ok ? await subsRes.json().catch(() => []) : [];
        }
        currentSubState = decideSubscribeButtonState(mediaData, subs, moduleEnabled);
      } catch (e) {
        console.error('Error resolving subscribe button state:', e);
        moduleEnabled = false;
        currentSubState = { visible: false, subscribed: false, subId: null, identity: null };
      }

      // (The creator-name link's href is wired in populateMetadata now -- it
      // points at the item's folder content view, /?root=<folder>, independent
      // of the yt-dlp module. See resolveUploaderLinkHref.)

      if (!currentSubState.visible) {
        subscribeBtn.remove(); // absent, not merely disabled/greyed (AC15)
        return;
      }
      subscribeBtn.hidden = false;
      applySubscribeButtonLabel(currentSubState.subscribed);
      subscribeBtn.addEventListener('click', () => {
        if (currentSubState.subscribed) handleUnsubscribe();
        else openSubscribeModal();
      }, { signal });
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
      const url = '/watch.html?v=' + encodeURIComponent(id);
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
          comments = JSON.parse(localComments);
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
        empty.style.cssText = 'color: var(--text-secondary); text-align: center; padding: 12px 0;';
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
    // exactly one weighted "Zak Goldin" persona comment per video (87%
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
        const data = await res.json();

        if (data.success) {
          // FR-3(a), T2: the post-success alert() was blocking friction --
          // a brief, non-blocking, auto-dismissing toast (common.js) gives
          // the same feedback without requiring a dismiss tap before the
          // navigate() below can proceed.
          showToast('File deleted.');
          if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate('/');
          else window.location.href = '/';
        } else {
          alert('Error deleting file: ' + data.error);
        }
      } catch (err) {
        console.error(err);
        alert('Network error occurred while trying to delete file.');
      }
    }

    deleteBtn.addEventListener('click', () => {
      if (isYtdlpManagedItem(mediaData)) {
        // yt-dlp-managed -- existing, byte-unchanged confirm flow (AC47).
        showConfirmModal(
          'Confirm Permanent Deletion',
          `Are you sure you want to permanently delete <strong>${escapeHtml(mediaData.title)}</strong>?<br><br><span style="color:var(--yt-red); font-weight:bold;">Warning: This will delete the actual file from your computer's disk:</span><br><code style="word-break:break-all; font-size:11px;">${escapeHtml(mediaData.filePath)}</code>`,
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
      if (folders.length === 0) {
        sidebarFoldersList.innerHTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';
        return;
      }
      sidebarFoldersList.innerHTML = folders.map(f => {
        const folderName = f.split(/[\\/]/).pop() || f;
        const label = (settings[f] && settings[f].name) || folderName;
        // ?root= shows everything under the mapped folder, including subfolders.
        return `
          <a href="/?root=${encodeURIComponent(f)}" class="sidebar-item" title="${escapeHtml(f)}">
            <i class="icon-folder"></i> ${escapeHtml(label)}
          </a>
        `;
      }).join('');
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
