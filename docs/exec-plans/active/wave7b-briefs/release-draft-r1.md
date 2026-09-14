# v1.297.0 release draft (apply after the R1 gate closes)

## ROADMAP.md "Shipped" entry (insert above v1.296.0)

### v1.297.0 - Relational-migration arc, Wave 7b R1: the monolith split begins (2026-09-14)

The first three slices of the server.js split. Seven route groups and the
books feature left the monolith for `registerRoutes(app, deps)` modules -
`lib/queue/routes.js`, `lib/notifications/routes.js`, `lib/push/routes.js`,
`lib/user/routes.js` (history, watched, prefs, search history, feed-hidden),
`lib/auth/routes.js` (auth, users, me), `lib/media/user-routes.js` (liked,
progress), `lib/books/routes.js` + `lib/books/scanRunner.js` - 78 route and
middleware registrations and one giant function, bodies byte-identical, an
explicit deps object at every call site. server.js: **19,064 -> 17,090 lines**; route registrations 176 ->
98. Every slice was an Opus worktree subagent's mechanical move, verified by
machine (a statement-level byte-identity check against the base commit, the
new routing-signature instrument, re-export identity) before it merged. Two
new instruments ship under scripts/: the espree census of server.js the
slice plan rests on, and the per-route middleware-prefix signature.

What the slices surfaced: one mutable test seam that a destructured dep would
have frozen (the push DNS override - crossed as a live reader,
mutation-proven); a latent porosity in the text locks' comment stripper (a
slash-star inside a line comment hid 218 lines of server.js from every lock -
one star removed, two more tracked as #228); the census's scope-unaware deps
list produced two false positives (a shadowed `mime`), caught by grep.

GATE_PLACEHOLDER Dual-Node, sequential, reviewers idle: COUNTS_PLACEHOLDER.

KNOWN GAPS (disclosed): DEVICE-PENDING until Dean's pass (probe list in the
report); seven slices remain (music, tv, videos/config, trash/move/restore,
import relocation, backup, transcode/streams, the scan orchestrator) across
three more releases, then the `< 3,000` prediction is re-verified; #228 (the
shared comment stripper) is its own slim-gated harness change.

## docs/releases.json ledger row (append)

{
  "version": "1.297.0",
  "date": "2026-09-14",
  "title": "Behind the scenes: the server code starts moving into smaller pieces",
  "intent": "Nothing changes on screen. The part of the server that handles your account, the play queue, the bell, push alerts, watch history, likes, preferences and the books library has been moved out of one very large file into smaller ones, exactly as it was, so future fixes land faster and with less risk. Every page, button and download works as before, and a backup taken on the previous version restores normally."
}
