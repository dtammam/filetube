# Tokens tranche F.5 - census toward zero (pre-ratchet)

STATUS: CLOSED (2026-08-01). All five rulings executed; ruling 1
closed same day ("I approve Both") on branch tokens/on-accent - 17
sites -> var(--on-accent) (48th contract name), eq bars -> the
existing var(--on-overlay), and ONE disclosed reclassification at
execution: .audio-player-visual's canvas text filed under --on-overlay
(overlay chrome, not accent; same #fff value). THE CENSUS IS ZERO
(692 -> 298 -> 110 -> 54 -> 19 -> 0). Remaining token work: the
ratchet only (tranche G, gated on tech-debt #68).

Original opener follows.
 Dean's
rulings at the 54-literal walkthrough, same day as the v1.59.0 device
pass:

1. --on-accent (the ~17 white-on-accent color rows): **agreed in
   principle, HELD OPEN** - Dean must first see the two of nineteen
   SEMANTIC-RESIDUE rows outside the seventeen (answer: the two
   `background:` fills - .watch-autoplay-thumb knob and .music-eq i
   bars; both still unstruck in the census, neither dropped). NOTHING
   in the SEMANTIC-RESIDUE bucket is touched this tranche.
2. Reader themes: **tokenize the trio, own axis** - defined at :root
   ONLY, never wired into light/dark or era tokens (the reader's own
   theme classes select them).
3. Linter v7: **agreed** - recognize the radius-plus-pixel calc idiom
   and ZERO-only env() fallbacks; "no fake tokens" (idioms pinned to
   real token names). Tech-debt #69's revisit trigger ("next linter
   rule change") fires: the duplicated CSS/JS classifiers unify in the
   same commit.
4. --header-h / --sidebar-w: **agreed conditionally** - only with the
   coupled sites shown. PROVEN in-tree: header 56px at header{} :537
   AND .app-container padding-top :765 (+ satellites: .sidebar top
   :776, --sticky-bar-top definition :60 whose comment says "header
   height", var(--mobile-header-h, 56px) fallbacks). Sidebar 230px at
   .sidebar width :771 AND .main-content margin-left :912 AND the
   slide-away translateX(-230px) pair :785/:3826 (animation MUST match
   the width). Player-bar reserves (40/80/44/26) stay literal
   regardless, per Dean.
5. Singletons: **stay literal with reason annotations**, exempt from
   the count.

## Batches (one commit each; per-commit protocol = Tier 4's:
ledger-check CLEAN after strikes, differ EQUIVALENT x9 - the WHOLE
tranche is zero-delta - measured linter total = prediction)

- **f5a linter v7**: RADIUS_CALC idiom ^calc(var(--radius|--radius-lg|
  --radius-full) +/- Npx)$; env(NAME, 0|0px) strips (nonzero env
  fallbacks still count - same class as var fallbacks, Dean's standing
  ruling); lintDecl/jsDecl classifier unified (#69). Fixtures +
  mutation per surface. Strikes: RADIUS-DERIVED x3 + the three env
  B1 rows. 54 -> 48.
- **f5b reader trio**: --reader-paper:#f7f4ec / --reader-sepia:#f0e3c9
  / --reader-night:#101014 at :root (own axis - comment forbids era/
  mode wiring); 3 consumers adopt; contract addendum +
  token-scale-lock (39 -> 42). 48 -> 45.
- **f5c layout pair**: --header-h:56px / --sidebar-w:230px; adoption
  at the census rows (765, 912) AND the coupled non-census sites
  (header height, sidebar width, translateX pair via
  calc(-1 * var(--sidebar-w)), --sticky-bar-top definition); scale-lock
  42 -> 44. 45 -> 43.
- **f5d exemptions**: 24 sites annotated token-exempt with honest
  reasons (art singletons, geometry radii, ruled floors, ruling-B
  radii, player-bar reserves, off-scale 40px/1px pads - the last three
  are MY dispositions, disclosed for Dean's cheap overrule). CONTRIBUTING's
  hardcoded "census 54" becomes a pointer to the linter. 43 -> 19.

END STATE: census 19 = exactly the SEMANTIC-RESIDUE bucket, every row
awaiting Dean's #1 close-out (--on-accent + the two background fills'
disposition; recommendation on file: eq bars adopt the EXISTING
--on-overlay, the knob joins --on-accent). The ratchet freezes only
after #1 resolves.

Gate: FULL (metric code + 5 contract names). Release: v1.60.0.
Ledger: strikes continue in docs/exec-plans/completed/
2026-07-31-tokens-tier4-ledger.md (its unstruck rows REMAIN the live
census binding; location changed at closure, role did not).
