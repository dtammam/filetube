'use strict';

// [INTEGRATION] v1.81 write-RBAC - the COMPLETENESS forcing net (gate WARNING-1).
//
// The rbac-census route-COUNT lock catches a NEW route but is blind to a
// PRE-EXISTING mutating route that was never gated - exactly how the bulk
// attribute + config holes slipped the initial enumeration. This test closes
// that blind spot structurally: it enumerates EVERY mutating route from the live
// Express table and (1) fails if any is unclassified - so a new mutating route
// cannot ship without a human deciding its category - and (2) for every route
// classified as needing a capability (library-write / manage-subs / admin),
// asserts a member holding NONE of those capabilities is refused with 403.
//
// This is the "derive the sweep from the route table, not a maintained literal"
// fix the gate asked for. Enables ytdlp + podcasts so the full set registers.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-route-class-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-route-class-dl-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession } = require('../../server');

// Every mutating route -> its category. Categories that require a capability
// (library-write | manage-subs | admin) are behaviourally probed below; a
// route classified `personal` (the member's own state) or `public` (pre-auth /
// session) is deliberately NOT capability-gated. To ADD a route: classify it
// here. To CHANGE a gate: move it between categories AND update its handler.
const CLASSIFICATION = {
  // --- public: pre-auth / session ---
  'POST /api/auth/login': 'public',
  'POST /api/auth/setup': 'public',
  'POST /api/auth/logout': 'personal',

  // --- personal: the member's OWN state (never capability-gated, AC2) ---
  'POST /api/progress': 'personal',
  'POST /api/videos/:id/view': 'personal',
  'POST /api/videos/:id/dimensions': 'personal',
  'POST /api/videos/:id/prepare-audio': 'personal',
  'POST /api/tv/episode/:id/prepare-audio': 'personal', // v1.197: the tv sidecar pre-warm (the video prepare-audio's exact classification)
  'POST /api/liked/:id': 'personal',
  'DELETE /api/liked/:id': 'personal',
  // v1.97 "Hide from feed" - the member's OWN modern-feed prune (never gated).
  'POST /api/feed-hidden/:id': 'personal',
  'DELETE /api/feed-hidden/:id': 'personal',
  'DELETE /api/history': 'personal',
  'DELETE /api/history/:id': 'personal',
  // v1.85 #1: per-user search history - the member's OWN state, never gated.
  'POST /api/search-history': 'personal',
  'DELETE /api/search-history/:term': 'personal',
  'DELETE /api/search-history': 'personal',
  'POST /api/watched/:id': 'personal',
  'DELETE /api/watched/:id': 'personal',
  'POST /api/queue/items': 'personal',
  'DELETE /api/queue/items/:uid': 'personal',
  'DELETE /api/queue': 'personal',
  'POST /api/queue/pointer': 'personal',
  'POST /api/queue/reorder': 'personal',
  'POST /api/me/settings': 'personal',
  'POST /api/me/avatar': 'personal', // v1.82: self-service profile photo (own state)
  'DELETE /api/me/avatar': 'personal',
  'POST /api/notifications/clear': 'personal',
  'POST /api/notifications/dismiss': 'personal',
  'POST /api/notifications/read': 'personal',
  'POST /api/notifications/seen': 'personal',
  'POST /api/push/subscribe': 'personal',
  'POST /api/push/unsubscribe': 'personal',
  'POST /api/music/progress': 'personal',
  'POST /api/music/resume': 'personal',
  'POST /api/music/liked/:id': 'personal',
  'DELETE /api/music/liked/:id': 'personal',
  'POST /api/books/liked/:id': 'personal',
  'DELETE /api/books/liked/:id': 'personal',
  'POST /api/books/:id/finished': 'personal',
  'POST /api/books/:id/progress': 'personal',
  'POST /api/books/pins': 'personal',
  'POST /api/books/pins/reorder': 'personal',
  'DELETE /api/books/pins/:id': 'personal',
  'POST /api/books/:id/cover': 'personal',
  'POST /book/:id/tts/:spineIndex/ensure': 'personal',
  'POST /api/podcasts/progress': 'personal',
  'POST /api/podcasts/episodes/:id/liked': 'personal',
  'DELETE /api/podcasts/episodes/:id/liked': 'personal',
  'POST /api/podcasts/episodes/:id/played': 'personal',
  'POST /api/tv/progress': 'personal',
  'POST /api/tv/played': 'personal',
  'DELETE /api/tv/played': 'personal',
  'POST /api/podcasts/pins': 'personal',
  'POST /api/podcasts/pins/reorder': 'personal',
  'DELETE /api/podcasts/pins/:id': 'personal',
  'POST /api/subscriptions/pins': 'personal',
  'POST /api/subscriptions/pins/reorder': 'personal',
  'DELETE /api/subscriptions/pins/:id': 'personal',

  // --- library-write: content mutation (requires canModifyLibrary) ---
  'DELETE /api/videos/:id': 'library-write',
  'POST /api/videos/:id/move': 'library-write',
  'POST /api/videos/:id/chapters': 'library-write',
  'POST /api/videos/:id/attribute-channel': 'library-write',
  'POST /api/videos/attribute-channel-bulk': 'library-write',
  'POST /api/videos/attribute-channel-bulk/cancel': 'library-write',
  'POST /api/scan': 'library-write',
  'POST /api/books/scan': 'library-write',
  'POST /api/music/scan': 'library-write',
  'POST /api/tv/scan': 'library-write',
  'POST /api/cache/clear': 'library-write',
  'POST /api/trash/:id/restore': 'library-write',
  'DELETE /api/trash/:id': 'library-write',
  'POST /api/trash/purge-all': 'library-write', // v1.158: bulk "Empty trash"
  'POST /api/folders/display-name': 'library-write', // v1.126: shared display metadata

  'DELETE /api/podcasts/episodes/:id': 'library-write',
  'POST /api/podcasts/episodes/:id/restore': 'library-write',

  // --- manage-subs: channel/podcast registry (requires canManageSubscriptions) ---
  'POST /api/subscriptions': 'manage-subs',
  'DELETE /api/subscriptions/:id': 'manage-subs',
  'PATCH /api/subscriptions/:id': 'manage-subs',
  'POST /api/subscriptions/:id/cancel': 'manage-subs',
  'POST /api/subscriptions/:id/repull': 'manage-subs',
  'POST /api/subscriptions/:id/skip': 'manage-subs',
  'POST /api/subscriptions/downloads/cancel': 'manage-subs',
  'POST /api/subscriptions/reorder': 'manage-subs',
  'POST /api/subscriptions/repull': 'manage-subs',
  'POST /api/subscriptions/settings': 'manage-subs',
  'DELETE /api/subscriptions/failures/:id': 'manage-subs',
  'DELETE /api/subscriptions/failures/all': 'manage-subs',
  'POST /api/ytdlp/download': 'manage-subs',
  'POST /api/ytdlp/download/:jobId/cancel': 'manage-subs',
  'POST /api/ytdlp/refresh-avatars': 'manage-subs',
  'POST /api/ytdlp/refresh-avatars/cancel': 'manage-subs',
  'POST /api/ytdlp/reheat-sub-counts': 'manage-subs',
  'POST /api/ytdlp/reheat-sub-counts/cancel': 'manage-subs',
  'POST /api/ytdlp/backfill-channel-names': 'manage-subs', // v1.115 A1: writes db.metadata channel names (+ pins), RBAC-gated + readonly-media-guarded
  'POST /api/ytdlp/backfill-channel-names/cancel': 'manage-subs',
  'POST /api/ytdlp/repull-metadata': 'manage-subs',
  'POST /api/ytdlp/repull-metadata/cancel': 'manage-subs',
  'POST /api/ytdlp/repull-metadata/preview': 'manage-subs',
  'POST /api/ytdlp/repull-metadata/item/:mediaId': 'manage-subs',
  'POST /api/ytdlp/repull-metadata/item/:mediaId/relocate': 'manage-subs',
  'POST /api/podcasts/check': 'manage-subs',
  'POST /api/podcasts/subscriptions': 'manage-subs',
  'DELETE /api/podcasts/subscriptions/:id': 'manage-subs',
  'PATCH /api/podcasts/subscriptions/:id': 'manage-subs',
  'POST /api/podcasts/subscriptions/:id/check': 'manage-subs',
  'POST /api/podcasts/subscriptions/:id/feed-url': 'manage-subs',
  'POST /api/podcasts/settings': 'manage-subs',

  // --- admin: instance config + user management (requires requireAdmin) ---
  'POST /api/config': 'admin',
  'POST /api/books/config': 'admin',
  'POST /api/music/config': 'admin',
  'POST /api/tv/config': 'admin',
  'POST /api/settings': 'admin',
  'POST /api/settings/logo': 'admin',
  'DELETE /api/settings/logo': 'admin',
  'POST /api/tv/:showId/poster': 'admin',
  'DELETE /api/tv/:showId/poster': 'admin',
  // v1.171 critter pool management (the logo-upload posture: server-wide
  // decorative assets are instance config; Dean's intake ruling = admin only).
  'POST /api/critters/upload': 'admin',
  'DELETE /api/critters/item': 'admin',
  'DELETE /api/critters/all': 'admin',
  'POST /api/admin/restore': 'admin',
  'POST /api/users': 'admin',
  'DELETE /api/users/:id': 'admin',
  'POST /api/users/:id/disabled': 'admin',
  'POST /api/users/:id/password': 'admin',
  'POST /api/users/:id/role': 'admin',
  'POST /api/users/:id/subscriptions-flag': 'admin',
  'POST /api/users/:id/modify-library-flag': 'admin',
  'PUT /api/users/:id/restrictions': 'admin',
  // v1.146 downloader-engine: RCE-adjacent (these cause pip to execute code
  // from PyPI) - admin, never a lesser capability.
  'POST /api/ytdlp/engine': 'admin',
  'POST /api/ytdlp/engine/update': 'admin',
};

// Categories whose routes MUST refuse a member holding none of the capabilities.
const CAPABILITY_CATEGORIES = new Set(['library-write', 'manage-subs', 'admin']);

// v1.123 T3: the VISIBILITY axis. The classification above binds "a flag-less
// member gets 403". This binds the ORTHOGONAL question the podcast delete/restore
// bypass exposed (and, in the same audit, trash restore/purge, book covers and
// the two ytdlp per-item routes): a member WITH the capability but RESTRICTED
// from the resource must not mutate it.
//
// GATE FIX (both seats, round 1): the first cut used an ALLOWLIST predicate
// (`isContentAddressed` matched today's `/api/videos/` etc. prefixes) so a NEW
// media namespace - e.g. a future `DELETE /api/music/tracks/:id` - escaped the
// net silently, re-shipping the exact class this wave closes. The adversarial
// seat proved it end-to-end. This is now a DENYLIST exactly like CLASSIFICATION:
// EVERY live mutating route must be explicitly bucketed here, there is NO
// default, and the completeness test below fails until a new route is classified.
//
//   enforced - content-addressed AND the handler applies the canonical
//              visibility decision (mediaVisibleTo / episodeVisibleTo /
//              bookVisibleTo / trashRecordVisibleTo / mediaVisiblePredicate):
//              single-target routes 404 a restricted member; LIBRARY-WIDE
//              routes (bulk attribute, the repull batch/preview) FILTER their
//              worklist and counts through the requester's predicate
//              (v1.127). Behavioral proof lives in the
//              rbac-{video,books,podcast}-enforcement +
//              ytdlp-repull-item-endpoint + rbac-bulk-visibility +
//              rbac-reheat-visibility suites.
//   personal - writes ONLY the caller's own per-user state (liked / watched /
//              progress / finished / played / queue / prefs). A restricted
//              member can at worst write or clear a useless row for an item they
//              cannot see - an existence oracle at worst, non-blocking. Note the
//              POST video routes (view/liked/watched/feed-hidden) ADDITIONALLY
//              enforce (they run restrictedVideoMutation) so they are `enforced`;
//              their DELETE siblings do NOT (un-liking a since-restricted item is
//              legitimate cleanup) so they are `personal` - the asymmetry is
//              deliberate, not an oversight (gate round 1, QA W2).
//   n/a      - not per-content: session/auth, instance config, the channel/
//              podcast REGISTRY (subscriptions/shows/pins/users), and job
//              control (cancels/scans). Capability-gated, not visibility-
//              gated - and since v1.127 every entry is na('why'): the
//              exemption must state WHAT the route touches and WHY no
//              per-item visibility decision applies (external review round 2
//              proved a bare label here exempted two routes that DID address
//              per-item content).
// v1.127 Wave A: an n/a exemption must CARRY its justification - see the
// bucket's own comment below. The shape is deliberately an object so a bare
// 'n/a' string fails the VALID check: exempting a route now costs a sentence
// a reviewer can refute, not a label.
const na = (why) => ({ na: why });

const VISIBILITY = {
  // --- session / auth ---
  'POST /api/auth/login': na('session mint; no content addressed'),
  'POST /api/auth/setup': na('first-run admin creation; no content addressed'),
  'POST /api/auth/logout': na('session teardown; no content addressed'),

  // --- content-addressed, visibility ENFORCED ---
  'POST /api/videos/:id/view': 'enforced',
  'POST /api/videos/:id/dimensions': 'enforced',
  'POST /api/videos/:id/prepare-audio': 'enforced',
  'POST /api/tv/episode/:id/prepare-audio': 'enforced', // v1.197: gated on tvEpisodeVisibleTo (restricted -> 404, no oracle/CPU sink)
  'POST /api/liked/:id': 'enforced',
  'POST /api/watched/:id': 'enforced',
  'POST /api/feed-hidden/:id': 'enforced',
  'DELETE /api/videos/:id': 'enforced',
  'POST /api/videos/:id/move': 'enforced',
  'POST /api/videos/:id/chapters': 'enforced',
  'POST /api/videos/:id/attribute-channel': 'enforced',
  'POST /api/trash/:id/restore': 'enforced',
  'DELETE /api/trash/:id': 'enforced',
  // v1.158: purge-all FILTERS the trash worklist to the requester's visible set
  // (trashRecordVisibleTo) - a restricted member never purges/counts a hidden
  // item. Bound end-to-end in trash-purge-all.test.js.
  'POST /api/trash/purge-all': 'enforced',
  'DELETE /api/podcasts/episodes/:id': 'enforced',
  'POST /api/podcasts/episodes/:id/restore': 'enforced',
  'POST /api/books/:id/cover': 'enforced',
  'POST /book/:id/tts/:spineIndex/ensure': 'enforced',
  'POST /api/ytdlp/repull-metadata/item/:mediaId': 'enforced',
  'POST /api/ytdlp/repull-metadata/item/:mediaId/relocate': 'enforced',
  // v1.127 Wave A (external review round 2, HIGH): the two LIBRARY-WIDE
  // mutators this net used to exempt as 'n/a' - the exemption WAS the bug
  // (they enumerate per-item content and can RELOCATE files). Their handlers
  // now filter the worklist through the requester's mediaVisiblePredicate
  // (the library-wide flavor of 'enforced': FILTER, where single-target
  // routes 404). Behavioral proof: rbac-bulk-visibility.test.js +
  // rbac-reheat-visibility.test.js, both mutation-verified.
  'POST /api/videos/attribute-channel-bulk': 'enforced',
  'POST /api/ytdlp/repull-metadata': 'enforced',
  'POST /api/ytdlp/repull-metadata/preview': 'enforced',
  // v1.126: the folder rename addresses a restrictable FOLDER (body-carried,
  // not URL-carried - still content-addressed); the handler 404s a member
  // restricted from the folder. Behavioral proof: folder-display-names.test.js.
  'POST /api/folders/display-name': 'enforced',

  // --- the caller's OWN per-user state (oracle at worst, non-blocking) ---
  'POST /api/progress': 'personal',
  'DELETE /api/liked/:id': 'personal',
  'DELETE /api/watched/:id': 'personal',
  'DELETE /api/feed-hidden/:id': 'personal',
  'DELETE /api/history': 'personal',
  'DELETE /api/history/:id': 'personal',
  'POST /api/search-history': 'personal',
  'DELETE /api/search-history/:term': 'personal',
  'DELETE /api/search-history': 'personal',
  'POST /api/queue/items': 'personal',
  'DELETE /api/queue/items/:uid': 'personal',
  'DELETE /api/queue': 'personal',
  'POST /api/queue/pointer': 'personal',
  'POST /api/queue/reorder': 'personal',
  'POST /api/me/settings': 'personal',
  'POST /api/me/avatar': 'personal',
  'DELETE /api/me/avatar': 'personal',
  'POST /api/notifications/clear': 'personal',
  'POST /api/notifications/dismiss': 'personal',
  'POST /api/notifications/read': 'personal',
  'POST /api/notifications/seen': 'personal',
  'POST /api/push/subscribe': 'personal',
  'POST /api/push/unsubscribe': 'personal',
  'POST /api/music/progress': 'personal',
  'POST /api/music/resume': 'personal',
  'POST /api/music/liked/:id': 'personal',
  'DELETE /api/music/liked/:id': 'personal',
  'POST /api/books/liked/:id': 'personal',
  'DELETE /api/books/liked/:id': 'personal',
  'POST /api/books/:id/finished': 'personal',
  'POST /api/books/:id/progress': 'personal',
  'POST /api/books/pins': 'personal',
  'POST /api/books/pins/reorder': 'personal',
  'DELETE /api/books/pins/:id': 'personal',
  'POST /api/podcasts/progress': 'personal',
  'POST /api/podcasts/episodes/:id/liked': 'personal',
  'DELETE /api/podcasts/episodes/:id/liked': 'personal',
  'POST /api/podcasts/episodes/:id/played': 'personal',
  'POST /api/tv/progress': 'personal',
  'POST /api/tv/played': 'personal',
  'DELETE /api/tv/played': 'personal',
  'POST /api/podcasts/pins': 'personal',
  'POST /api/podcasts/pins/reorder': 'personal',
  'DELETE /api/podcasts/pins/:id': 'personal',
  'POST /api/subscriptions/pins': 'personal',
  'POST /api/subscriptions/pins/reorder': 'personal',
  'DELETE /api/subscriptions/pins/:id': 'personal',

  // --- not per-content (n/a) - EVERY exemption carries its WHY -----------
  //
  // v1.127 Wave A: external review round 2 proved this bucket was the net's
  // own blind spot - a bare 'n/a' label exempted attribute-channel-bulk and
  // the library-wide repull, which DID address per-item content by the
  // REQUESTER's selection (they enumerated a requester-chosen root/library and
  // could RELOCATE hidden media; both are 'enforced' above now). The lesson is
  // the v1.123 one pointed at ourselves: a forcing net must be a denylist, and
  // an exemption without a stated, reviewable reason is an allowlist entry.
  // Every n/a is now na('why') - the why must say what the route touches and
  // why no per-REQUESTER visibility decision applies.
  //
  // The reviewer's question for every new na(): "does the route act on a set
  // of library items that the REQUESTER selected or scoped?" If yes -> NOT
  // n/a, it is 'enforced' (single-target 404, or library-wide FILTER). A
  // route may still be n/a while touching items IF its target set is fixed by
  // the shared REGISTRY, not by requester input:
  //   - the three yt-dlp fan-outs below (refresh-avatars / reheat-sub-counts /
  //     backfill-channel-names) WRITE channel-identity DISPLAY fields onto
  //     items, but the target set is "every item whose channel is in the
  //     registry", identical for every caller - there is no per-requester
  //     selection to honor. Their residual (an aggregate count-oracle, and a
  //     display write onto items a restricted member can't see) is DISCLOSED
  //     in tech-debt #150 and belongs to Wave B's read-surface census, not
  //     here. This is a NAMED exception, not a hole: a NEW route that writes
  //     items by requester selection is still 'enforced', full stop.
  // HONEST SCOPE (plan deviation, disclosed): the plan prescribed a MECHANICAL
  // handler-source scan (fail if an n/a handler references db.metadata et al).
  // That was descoped - a shallow handler.toString() grep is blind to
  // deps-injected fan-outs (the exact fan-out case above) and a sound
  // reachability analysis is undecidable (adversarial S3). The net's real
  // closure is: every live route MUST be classified (unclassified -> red), an
  // n/a MUST carry a reviewable justification, and the fixed routes are
  // pinned. Recurrence risk (a future item-touching route mislabeled n/a with
  // a plausible reason) is tracked in tech-debt #151.
  'POST /api/videos/attribute-channel-bulk/cancel': na('sets the cooperative-cancel latch for an in-flight job; reads/writes no item'),
  'POST /api/scan': na('triggers a rescan of the configured roots; writes scan state, returns no per-item data'),
  'POST /api/books/scan': na('triggers the book rescan; same shape as /api/scan'),
  'POST /api/music/scan': na('triggers the music rescan; same shape as /api/scan'),
  'POST /api/tv/scan': na('triggers the Shows rescan; writes scan state, returns no per-item data'),
  'POST /api/cache/clear': na('transcode-cache lifecycle; touches derived cache files only, never library items'),
  'POST /api/subscriptions': na('channel REGISTRY row create; the registry is shared by design (documented product shape)'),
  'DELETE /api/subscriptions/:id': na('channel registry row delete; no library item addressed'),
  'PATCH /api/subscriptions/:id': na('channel registry row edit; no library item addressed'),
  'POST /api/subscriptions/:id/cancel': na('stops one subscription\'s in-flight downloads; job control only'),
  'POST /api/subscriptions/:id/repull': na('re-polls one registry channel for NEW downloads into the download root; creates content, never touches existing items'),
  'POST /api/subscriptions/:id/skip': na('appends to the shared skip/archive list; registry-scoped state'),
  'POST /api/subscriptions/downloads/cancel': na('stops all in-flight subscription downloads; job control only'),
  'POST /api/subscriptions/reorder': na('registry display order; no library item addressed'),
  'POST /api/subscriptions/repull': na('re-polls the whole registry for NEW downloads; creates content, never touches existing items'),
  'POST /api/subscriptions/settings': na('module settings write; instance configuration'),
  'DELETE /api/subscriptions/failures/:id': na('clears one failure-log row; job bookkeeping only'),
  'DELETE /api/subscriptions/failures/all': na('clears the failure log; job bookkeeping only'),
  'POST /api/ytdlp/download': na('one-off download of a NEW file into the download root; addresses no existing item'),
  'POST /api/ytdlp/download/:jobId/cancel': na('stops one one-off download job; job control only'),
  'POST /api/ytdlp/refresh-avatars': na('registry fan-out: rewrites channel AVATAR files derived from the registry; response is aggregate counts only (count-oracle residual: Wave B read-surface census)'),
  'POST /api/ytdlp/refresh-avatars/cancel': na('cancel latch for the avatar fan-out; job control only'),
  'POST /api/ytdlp/reheat-sub-counts': na('registry fan-out: writes channel FOLLOWER COUNTS onto items, derived from the registry; aggregate counts only (count-oracle residual: Wave B read-surface census)'),
  'POST /api/ytdlp/reheat-sub-counts/cancel': na('cancel latch for the sub-count fan-out; job control only'),
  'POST /api/ytdlp/backfill-channel-names': na('registry fan-out: heals channel NAME display fields on items from the registry; aggregate counts only (count-oracle residual: Wave B read-surface census)'),
  'POST /api/ytdlp/backfill-channel-names/cancel': na('cancel latch for the name fan-out; job control only'),
  'POST /api/ytdlp/repull-metadata/cancel': na('sets the cooperative-cancel latch for the reheat batch; reads/writes no item'),
  'POST /api/podcasts/check': na('polls the podcast REGISTRY feeds for new episodes; creates content, never touches existing items'),
  'POST /api/podcasts/subscriptions': na('podcast registry row create; the registry is shared by design'),
  'DELETE /api/podcasts/subscriptions/:id': na('podcast registry row delete (show removal is a registry operation; episode deletes are the enforced routes above)'),
  'PATCH /api/podcasts/subscriptions/:id': na('podcast registry row edit; no episode addressed'),
  'POST /api/podcasts/subscriptions/:id/check': na('polls one show\'s feed; creates content only'),
  'POST /api/podcasts/subscriptions/:id/feed-url': na('rewrites one show\'s private feed URL in the secrets file; registry-scoped'),
  'POST /api/podcasts/settings': na('module settings write; instance configuration'),
  'POST /api/config': na('library ROOTS configuration write; admin-shaped instance config'),
  'POST /api/books/config': na('book roots configuration write; instance config'),
  'POST /api/music/config': na('music roots configuration write; instance config'),
  'POST /api/tv/config': na('Shows roots configuration write; instance config'),
  'POST /api/settings': na('instance settings write; no item addressed'),
  // v1.146 downloader-engine: instance-wide engine configuration/update -
  // no library item is ever addressed, so per-item visibility cannot apply.
  'POST /api/ytdlp/engine': na('downloader-engine channel/auto-update config; instance-wide, no item addressed'),
  'POST /api/ytdlp/engine/update': na('downloader-engine manual update trigger; instance-wide, no item addressed'),
  'POST /api/settings/logo': na('custom logo upload; instance branding asset'),
  'DELETE /api/settings/logo': na('custom logo removal; instance branding asset'),
  'POST /api/tv/:showId/poster': na('admin show-art upload; writes a DATA_DIR poster file, addresses no per-user or per-item content'),
  'DELETE /api/tv/:showId/poster': na('admin show-art removal; deletes a DATA_DIR poster file, addresses no per-user or per-item content'),
  'POST /api/critters/upload': na('critter pool image/sound upload; instance decorative asset, no library item addressed'),
  'DELETE /api/critters/item': na('critter pool per-critter delete (image + paired sound); instance decorative asset'),
  'DELETE /api/critters/all': na('critter pool delete-all; instance decorative assets, scoped to public/critters/'),
  'POST /api/admin/restore': na('whole-instance backup restore; admin-only by definition, replaces ALL state'),
  'POST /api/users': na('user administration (create); admin-only'),
  'DELETE /api/users/:id': na('user administration (delete); admin-only'),
  'POST /api/users/:id/disabled': na('user administration (disable flag); admin-only'),
  'POST /api/users/:id/password': na('user administration (password reset); admin-only'),
  'POST /api/users/:id/role': na('user administration (role); admin-only'),
  'POST /api/users/:id/subscriptions-flag': na('user administration (capability flag); admin-only'),
  'POST /api/users/:id/modify-library-flag': na('user administration (capability flag); admin-only'),
  'PUT /api/users/:id/restrictions': na('user administration (the restriction rows themselves); admin-only'),
};

function liveMutatingRoutes() {
  const out = [];
  for (const layer of (app._router && app._router.stack) || []) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) {
      if (['post', 'put', 'patch', 'delete'].includes(m)) out.push(`${m.toUpperCase()} ${layer.route.path}`);
    }
  }
  return out.sort();
}

let server, base, flagless;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  __mintTestSession(); // seed an admin so the gate is in normal mode
  // A member holding NEITHER capability: canModifyLibrary defaults false; clear
  // the mint's canManageSubscriptions so this one member probes all three
  // capability categories at once.
  flagless = __mintTestSession({ username: 'nocaps', role: 'member' });
  userStore.setCanManageSubscriptions(flagless.user.id, false);
  assert.strictEqual(userStore.getById(flagless.user.id).canModifyLibrary, false);
  assert.strictEqual(userStore.getById(flagless.user.id).canManageSubscriptions, false);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const fillParams = (p) => p
  .replace(/:jobId/g, 'job1').replace(/:mediaId/g, 'm1').replace(/:spineIndex/g, '0')
  .replace(/:uid/g, 'u1').replace(/:id/g, 'x');

test('COMPLETENESS: every live mutating route is classified (a new one fails here until categorized)', () => {
  const live = liveMutatingRoutes();
  const unclassified = live.filter((r) => !(r in CLASSIFICATION));
  assert.deepStrictEqual(unclassified, [],
    `unclassified mutating route(s) - add each to CLASSIFICATION in this file and gate it:\n  ${unclassified.join('\n  ')}`);
  // And the reverse: no stale entries for routes that no longer exist.
  const liveSet = new Set(live);
  const stale = Object.keys(CLASSIFICATION).filter((r) => !liveSet.has(r));
  assert.deepStrictEqual(stale, [], `stale CLASSIFICATION entrie(s) - route no longer exists:\n  ${stale.join('\n  ')}`);
});

test('ENFORCEMENT: every capability-gated route 403s a member holding NO capabilities', async () => {
  const live = liveMutatingRoutes();
  const failures = [];
  for (const route of live) {
    const cat = CLASSIFICATION[route];
    if (!CAPABILITY_CATEGORIES.has(cat)) continue;
    const [method, rawPath] = route.split(' ');
    const url = `${base}${fillParams(rawPath)}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: flagless.cookie },
      body: method === 'GET' ? undefined : JSON.stringify({}),
    });
    // The capability guard is the FIRST line of each such handler, so it wins
    // before any 400/404/existence branch: a flag-less member must see 403.
    if (res.status !== 403) failures.push(`${route} [${cat}] -> ${res.status} (expected 403)`);
  }
  assert.deepStrictEqual(failures, [], `capability-gated routes NOT refusing a flag-less member:\n  ${failures.join('\n  ')}`);
});

test('VISIBILITY COMPLETENESS (denylist): EVERY live mutating route has a visibility bucket - a new one fails here', () => {
  const live = liveMutatingRoutes();
  // (1) every live mutating route must be explicitly bucketed - NO default. This
  // is what makes a brand-new media namespace (e.g. DELETE /api/music/tracks/:id)
  // FAIL until someone decides its visibility, instead of escaping silently.
  const unclassified = live.filter((r) => !(r in VISIBILITY));
  assert.deepStrictEqual(unclassified, [],
    `mutating route(s) with NO visibility bucket - add each to VISIBILITY as\n`
    + `'enforced' (handler 404s a restricted member, or FILTERS a library-wide\n`
    + `worklist) | 'personal' (own-state only) | na('why') (not per-content -\n`
    + `the why must survive the reviewer's "does it touch any item?"):\n  ${unclassified.join('\n  ')}`);
  // (2) no stale entries, and every value is a legal bucket. v1.127: a bare
  // 'n/a' string is deliberately ILLEGAL - an exemption must carry a
  // non-empty justification via na('why').
  const liveSet = new Set(live);
  const stale = Object.keys(VISIBILITY).filter((r) => !liveSet.has(r));
  assert.deepStrictEqual(stale, [], `stale VISIBILITY entrie(s) - route no longer exists:\n  ${stale.join('\n  ')}`);
  const isNa = (v) => v && typeof v === 'object' && typeof v.na === 'string' && v.na.trim().length >= 15;
  const badValue = Object.entries(VISIBILITY)
    .filter(([, v]) => !(v === 'enforced' || v === 'personal' || isNa(v)))
    .map(([r, v]) => `${r} -> ${JSON.stringify(v)}`);
  assert.deepStrictEqual(badValue, [],
    `VISIBILITY value must be 'enforced' | 'personal' | na('a real justification, >=15 chars'):\n  ${badValue.join('\n  ')}`);
  // (3) the two axes cover the SAME routes (both are denylists over the live
  // table), so neither can drift out from under the other.
  const capOnly = Object.keys(CLASSIFICATION).filter((r) => !(r in VISIBILITY));
  const visOnly = Object.keys(VISIBILITY).filter((r) => !(r in CLASSIFICATION));
  assert.deepStrictEqual([capOnly, visOnly], [[], []],
    `CLASSIFICATION and VISIBILITY must classify the same route set;\n  cap-only: ${capOnly.join(', ')}\n  vis-only: ${visOnly.join(', ')}`);
});

test('VISIBILITY REGRESSION GUARD: the routes this wave fixed stay pinned `enforced`', () => {
  for (const r of [
    'DELETE /api/podcasts/episodes/:id',
    'POST /api/podcasts/episodes/:id/restore',
    'POST /api/trash/:id/restore',
    'DELETE /api/trash/:id',
    'POST /api/books/:id/cover',
    'POST /api/ytdlp/repull-metadata/item/:mediaId',
    'POST /api/ytdlp/repull-metadata/item/:mediaId/relocate',
  ]) {
    assert.strictEqual(VISIBILITY[r], 'enforced', `${r} must stay visibility-enforced (v1.123 T3)`);
  }
  // v1.127 Wave A: the two library-wide routes external review round 2 caught
  // (and the preview that rendered hidden paths) stay pinned too - moving any
  // of these back to na() reopens the reheat/bulk RBAC bypass.
  for (const r of [
    'POST /api/videos/attribute-channel-bulk',
    'POST /api/ytdlp/repull-metadata',
    'POST /api/ytdlp/repull-metadata/preview',
  ]) {
    assert.strictEqual(VISIBILITY[r], 'enforced', `${r} must stay visibility-enforced (v1.127 Wave A)`);
  }
});
