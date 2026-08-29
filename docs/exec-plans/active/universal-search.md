# Exec plan: Universal search (Wave B)

Status: ACTIVE (in implementation). Branch `feat/universal-search`.
Owner: main session (lean mode). This doc is the reviewers' spec and survives
context compaction. Numbers marked (MACHINE-DERIVED) are PREDICTIONS the tools
re-verify at every commit.

## Goal

The global header search (`#search-input`) becomes a UNIFIED cross-content
search: today it drives `GET /api/videos?search=` over `db.metadata` only
(library videos + audio). It must ALSO return music, podcasts (shows AND
episodes), TV (shows AND episodes), and books - everything browsable - in ONE
flat results stream with a type badge per card.

## Dean's confirmed decisions (2026-08-29 intake)

1. **Ranking: BLENDED by relevance.** One flat stream. A title/name exact
   match outranks prefix outranks substring, REGARDLESS of type; ties broken
   by a fixed type priority, then recency. (Not grouped-by-type; not
   recency-first.)
2. **Drop the video Titles/Channels sub-scope (searchIn) in unified search.**
   Each provider matches its own natural fields. The video VIEW's own search
   box keeps Titles/Channels for in-view use; the unified header results do
   not carry it.
3. **Header box ONLY.** The header search becomes universal. The per-view
   search boxes (music/books/podcasts pages) stay as in-view filters,
   UNCHANGED. Lowest regression risk.
4. **Titles + identity fields only (v1).** Match title/name + identity fields
   (author/artist/album/albumArtist/channel/show name). NOT long descriptions
   (podcast/TV episode descriptions). Descriptions are a documented deferral -
   generic episode titles ("Episode 42") are harder to find; disclosed.

## Architecture

### A. The search-provider REGISTRY (the durability headline)

A registry array modeled on `LIBRARY_GLYPH_SLOTS` (glyph-pool.js) and the
`KIND_TO_LIBRARY` authority (lib/auth/visibility.js:23). New module
`lib/search/registry.js` (server-side). Each provider descriptor:

```
{
  type,        // result-type id: 'video'|'audio'|'music'|'podcast-show'|
               //   'podcast-episode'|'tv-show'|'tv-episode'|'book'
  chip,        // the filter chip it belongs to: 'videos'|'audio'|'music'|
               //   'podcasts'|'shows'|'books'
  library,     // the KIND_TO_LIBRARY value this covers: 'video'|'music'|
               //   'podcasts'|'books'|'tv'  (the census authority)
  search(query, req) -> [ normalizedResult ]  // RBAC-FILTERED, typed results
}
```

Each provider OWNS: its db namespace read, its match predicate (title +
identity fields, decision 4), its RBAC visibility filter (the EXISTING
per-kind `*VisibleTo` gate - never a new second gate), and its normalized
result projection (carrying `resultType` for the badge + the natural card
fields buildCardHtml already renders via `cardKindPresentation`).

**Provider set (8 providers -> 6 chips -> 5 libraries):**

| type | chip | library | namespace | match fields | RBAC gate |
|------|------|---------|-----------|--------------|-----------|
| video | Videos | video | db.metadata (type video) | title, channelName, folderName | mediaVisibleTo |
| audio | Audio | audio | db.metadata (type audio) | title, channelName, folderName | mediaVisibleTo |
| music | Music | music | db.music.tracks | title, artist, album, albumArtist | trackVisibleTo |
| podcast-show | Podcasts | podcasts | db.podcasts.subscriptions | name, author | (show-level, on subId) |
| podcast-episode | Podcasts | podcasts | db.podcasts.episodes | title, showName | podcastEpisodeVisibleTo |
| tv-show | Shows | tv | grouped db.tv.episodes | show name | tvEpisodeVisibleTo (derive from visible eps) |
| tv-episode | Shows | tv | db.tv.episodes | title, showName | tvEpisodeVisibleTo |
| book | Books | books | db.books.items | title, author | bookVisibleTo |

Note: `Videos` and `Audio` both read db.metadata (library 'video') split by
`type`. TV shows are DERIVED by grouping VISIBLE episodes (so a show never
appears from a blocked episode set).

### B. The census gate (the "automatic = enforced-by-test" honesty)

Two checkers, both RED when a media namespace lacks a registered, RBAC-bound
provider:

1. **Provider-coverage census** (new `test/integration/search-provider-census.test.js`):
   iterate `KIND_TO_LIBRARY` values (the SAME authority the RBAC layer uses).
   Assert every library value has >= 1 registered provider whose `library`
   equals it. A future media type added to KIND_TO_LIBRARY without a provider
   goes RED. (MACHINE-DERIVED: 5 library values -> all covered; 8 providers.)
2. **RBAC leak census** (EXTEND `test/integration/rbac-census.test.js`): the
   blocked-member LIST SWEEP gains the new `GET /api/search` surface - a
   member blocked from all libraries must see NO seeded item of ANY type in
   the unified results (titles/counts). This is THE access-control attack
   surface (the recurring leaks-titles/counts class). Every provider is
   mutation-bound here.

### C. The endpoint

`GET /api/search?q=&type=&limit=&offset=` (new; single route):
- `q`: the query (required; empty -> empty result set, 200).
- `type`: optional chip filter ('videos'|'audio'|'music'|'podcasts'|'shows'|
  'books'|absent=all). Absent/unknown -> all.
- Runs the matching providers, collects RBAC-filtered typed results, BLENDS by
  the ranking function, paginates the merged list, returns
  `{ items, total, offset, limit }` (the /api/videos pagination precedent).
- Libraries are in-memory maps (bounded, thousands not millions), so
  merge-then-paginate server-side is correct and simple.
- Route ORDER: register `/api/search` as a STATIC segment BEFORE any `/:id`
  param sibling (the Express route-order scar).
- (MACHINE-DERIVED: EXPECTED_ROUTE_COUNT 229 -> 230.)

### D. The ranking function (`lib/search/rank.js`)

Deterministic, comparable across heterogeneous types. Per result, a relevance
TIER on its matched field(s):
- tier 0: title/name === query (case-insensitive full match)
- tier 1: title/name startsWith query
- tier 2: title/name includes query
- tier 3: an IDENTITY field (author/artist/album/channel/show) includes query
  while the title did not
Sort: tier asc, then a fixed TYPE_PRIORITY (video, audio, music, podcast-show,
podcast-episode, tv-show, tv-episode, book), then recency (addedAt/pubDateMs
desc), then id (stable). Pure + unit-tested with a cross-type fixture.

### E. Client

- Header submit still navigates to `/?search=<q>` (decision 3: header box
  only). When a search is active the home/library view calls `/api/search`
  instead of `/api/videos` and renders the mixed-type cards.
- buildCardHtml already renders mixed `kind` via `cardKindPresentation`
  (podcast/track/book). ADD tv-show/tv-episode kinds + the small **type
  badge** per card (Video/Audio/Music/Podcast/Episode/Show/Book).
- The chip row: REPLACE the video-only searchIn (Titles/Channels) toggle with
  the content-TYPE chips (All/Videos/Audio/Music/Podcasts/Shows/Books) in the
  unified results. `?type=` mirrors the active chip (replaceState, like
  `?searchIn=` did). The video VIEW's own searchIn stays where it is.
- Search-history dropdown: UNCHANGED (personal state, no visibility gate).

## Task breakdown (small, independently-testable commits)

1. `lib/search/rank.js` + unit tests (pure ranking, cross-type fixture).
2. `lib/search/registry.js` provider registry + per-provider match predicates
   (reusing videoQuery/musicQuery.matchesSearch; new podcast/tv/book
   predicates) + provider-coverage census test.
3. `GET /api/search` endpoint (wires the registry + rank + pagination) +
   endpoint unit/integration tests (shape, type filter, pagination, empty q).
4. RBAC: every provider routed through its `*VisibleTo` gate + EXTEND
   rbac-census list-sweep for /api/search + per-provider leak tests. Bump
   EXPECTED_ROUTE_COUNT 229->230.
5. Client: mixed rendering (tv kinds + type badge), the type-chip row, the
   /api/search fetch when search active. jsdom full-chain test.
6. Docs: ARCHITECTURE/DIAGRAMS if a checker binds; ROADMAP + ledger at release.

## The gate brief (attack surfaces)

- **ACCESS-CONTROL is the headline** (the recurring leaks-titles/counts
  class): EVERY provider must be requester-visibility-filtered with
  MUTATION-bound tests. Brief the adversarial seat to be a blocked member and
  try to see ANY blocked title/count through /api/search (all types, the
  type= filter, and pagination edges - offset past the visible set).
- **The census must genuinely bind**: mutate a provider out of the registry ->
  provider-coverage census RED; mutate a provider's `*VisibleTo` to a pass-all
  -> rbac-census RED. Divergent-fixture pass-throughs are the failure mode.
- **Route-order scar**: /api/search static before any /:id param.
- **Pagination/rank across N providers**: total == full merged filtered
  length; a page never drops or dupes an item; ranking deterministic.
- **The tv-show derivation**: a show must never surface from a set of BLOCKED
  episodes (derive shows from VISIBLE episodes only).

## Known scope / deferrals (disclosed)

- Descriptions NOT matched in v1 (decision 4) - deferral, generic episode
  titles harder to find.
- Per-view search boxes UNCHANGED (decision 3).
- Video Titles/Channels sub-scope dropped in unified results (decision 2).
- Ranking is relevance-tier + type-priority + recency; no learned/weighted
  scoring (honest, deterministic).
