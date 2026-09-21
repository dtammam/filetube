# Account-menu trash row: show reclaimable size

## Status
- status: Shipped v1.306.0 (2026-09-21)
- anchor: outcome
- branch: `feat/account-menu-trash-size`
- base sha: `360cc84830d990b264f84c7087a3cd9ccaae1189`
- reviewed sha: `16522371`
- gate: APPROVED @16522371 (adversary, slim — the required seat set for this change class)

## Intent
Dean's ask: in the account menu (the avatar dropdown — "on mobile and desktop
where I see my avatar and then trash and size on disk"), the trash line should
show, in parentheses, the amount of disk in trash, alongside the item count —
"so I can see as well as how many items are possible to be deleted."

## Change (client-only)
`/api/trash` already returns `totalSizeBytes` (summed server-side at
`lib/media/trash.js:1009`); the account-menu fetcher fetched it but discarded it.

- `public/js/common.js` — `formatTrashCountLabel(count, totalSizeBytes)` now
  takes an optional size and appends `" (X)"` using `formatDiskBytes` (the same
  formatter the adjacent "on disk" footer row uses). `loadTrashCount` passes
  `Number(body.totalSizeBytes)`.
- `test/unit/account-menu.test.js` — assertions locking the parenthetical and
  its absence.

## Acceptance
1. Row reads `2 items in trash (1.5 GB)` when trash is non-empty.
2. Zero/unknown/negative/NaN size → bare count, NO `(0 B)` parenthetical.
3. Singular still `1 item in trash (...)`; count-only behavior (single-arg) is
   byte-identical to v1.305.
4. Size string matches `formatDiskBytes` character-for-character (consistent with
   the "on disk" row directly above).
5. No server change; no regression in existing account-menu tests.

## Named attack surfaces for the gate
- The parenthetical must not appear as `(0 B)` / `(NaN ...)` for empty or absent
  size (the disk-row/version-row "hide, never a broken value" posture).
- `formatTrashCountLabel` is exported + unit-locked — the single-arg contract
  from v1.305 must not silently change.
- `body.totalSizeBytes` shape trust: confirm the server actually emits it and the
  client coercion (`Number(...)`) can't produce a spurious parenthetical.

## Gate verdicts
<!-- seats append bound verdict lines below -->

Gate: APPROVED r1 @16522371 — adversary
