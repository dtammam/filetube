# Discovery — v1.15.0 "UI polish + yt-dlp enhancements + infra" (one big swing)

You are the **product-manager**. This is the **Discovery** stage for FileTube's
v1.15.0 round: ONE big feature spanning **9 items** across UI polish, the
optional yt-dlp module, and infra. Your job is to turn these 9 items into a
crisp exec plan with **grouped, tagged, testable acceptance criteria** — NOT to
design the implementation (that's the principal-engineer's job next).

## First, read these

- `.state/feature-state.json` — the full brief lives in `scope_items` (1–9),
  `hard_constraints`, `product_forks_for_dean`, `pe_design_items`, and
  `cross_cutting`. Read it carefully; it has EM-verified file:line evidence for
  every item so you do not need to re-investigate mechanics.
- `docs/CONTRIBUTING.md` — coding standards (vanilla DOM, CommonJS, node:test,
  lint 0, **NO new runtime deps**, every feature ships with tests).
- `docs/RELIABILITY.md` — spawn try/catch, graceful degrade, FFmpeg/yt-dlp out
  of the automated suite.
- `docs/ARCHITECTURE.md` — especially the `lib/ytdlp/` optional-module section
  (disabled-path byte-identical guarantee) and the transcode-cache constraints.
- Prior shipped exec plans for context (do NOT re-litigate their locked
  decisions): `docs/exec-plans/completed/2026-07-06-ytdlp-metube-parity.md`
  (the one-off endpoint, dropdowns, live status, synthetic Downloads folder)
  and `docs/exec-plans/completed/2026-07-06-v1.14-quickwins.md` (the mobile logo,
  random sort + the "Shuffle again" button that item 2 must stop overflowing).

## Deliverable

**Author the exec plan** at
`docs/exec-plans/active/2026-07-06-v1.15-bigswing.md` with these sections:

1. **Goal** — one paragraph: a single cohesive v1.15.0 round polishing the UI,
   extending the optional yt-dlp module, and improving infra/tests, without
   degrading FileTube when the yt-dlp module is disabled and without regressions.
2. **Scope** — the 9 items, grouped UI / yt-dlp / infra (mirror the brief's
   grouping).
3. **Out of scope** — be explicit. Cross-check every out-of-scope line against
   `docs/CONTRIBUTING.md` mandatory standards (nothing in out-of-scope may
   conflict with them). Include at least: no new runtime deps; no WebSocket/SSE
   (status stays polling); no change to subscription dedup behavior (item 6 is
   one-off-only); no removal of --restrict-filenames-equivalent path safety
   (item 5); no writing the synthetic Downloads folder into db.folders (item 1);
   no silent change to existing transcode quality (item 7 CRF is opt-in); no
   heavy image dependency for the PWA PNG (item 8 defers instead); tests are
   additive only (item 9, no rewrites).
4. **Constraints** — carry the `hard_constraints` from state verbatim-in-spirit,
   with the disabled-module byte-identical guarantee (items 3/4/5/6) as the
   north star for the yt-dlp items.
5. **Functional requirements** — one FR block per item (FR-1 … FR-9),
   restating the confirmed current behavior and the target behavior.
6. **Acceptance criteria** — the core deliverable. **Group by item**, plus a
   cross-cutting section. Tag every criterion `[UNIT]`, `[INTEGRATION]`,
   `[MANUAL]`, or `[PROCESS]`. Each must be a concrete pass/fail statement, not
   "looks good". Must-haves:
   - **Disabled-path no-op group** (items 3/4/5/6): with `FILETUBE_YTDLP_ENABLED`
     off, the header download button + modal are absent from served HTML,
     the skip-shorts toggle is absent, no new yt-dlp route is registered, and
     the full existing suite stays green — the header is byte-identical to today.
   - **Item 1**: an [INTEGRATION] criterion that DnD-reordering the synthetic
     Downloads folder persists via `folderSettings[downloadDir].order` and the
     folder is NEVER written into `db.folders`; a [MANUAL] criterion for the
     keyboard/tap fallback on mobile.
   - **Item 2**: [MANUAL] — the sort row (heading + select + "Shuffle again")
     no longer overflows on a mobile viewport; cards are sized so >1 is
     comfortably visible.
   - **Item 3**: [MANUAL] the header button opens the modal and a one-off
     download reports live status; [INTEGRATION] the button/modal are absent
     when the module is disabled.
   - **Item 4**: [UNIT] the arg builder emits the Shorts `--match-filter` only
     when skipShorts is on; [UNIT] a hostile skipShorts value never becomes a
     stray argv token; [INTEGRATION] the PATCH edit round-trips the field and
     ensureYtdlp backfills undefined→false; default = download everything.
   - **Item 5**: [UNIT] the download arg array keeps the SF4 path-confinement
     guarantee (an equivalent of `--restrict-filenames` stays, or the confinement
     helpers still hold) AND the id suffix for archive uniqueness; [UNIT] the
     new on-disk name shape is still cleaned correctly by `cleanDisplayTitle`;
     [MANUAL] on-disk names are readable (spaces allowed).
   - **Item 6**: [UNIT] one-off download args bypass the archive
     (`--no-download-archive`/`--force-overwrites`) while SUBSCRIPTION download
     args are UNCHANGED (still carry `--download-archive`); [MANUAL] a one-off
     re-download of an already-present video actually downloads + indexes.
   - **Item 7**: [UNIT] `TRANSCODE_DIR`/`TRANSCODE_CRF` env parsing (defaults =
     data/transcoded, 23) mirroring `parseCacheCap`; [UNIT/INTEGRATION] the
     size-cap eviction + age-retention still key off the configured dir;
     [MANUAL] a custom dir on external storage works.
   - **Item 8**: [PROCESS] either PNGs land with NO new dependency, or the item
     is explicitly deferred with a tracked note — state which.
   - **Item 9**: [PROCESS] additive core tests (scan/metadata/eviction unit +
     HTTP smoke) pass green on Node 22; name the specific core paths targeted.
   - **Cross-cutting**: security reuse for items 3/4/5/6 (arg-array/no-shell,
     `--` separator, path confinement, cookies redaction on any new sink);
     Node 22 process gate; the heavier-review items (5/4/6/1) ride the
     two-reviewer gate.
7. **Open Questions / Forks** — see below.

## Forks to resolve with Dean (recommend a default; do NOT block)

The EM surfaced 6 genuine forks in `product_forks_for_dean` (state file). Restate
each in the plan with your recommendation so Dean can confirm in one pass:
- **Item 4 skip-shorts scope**: per-sub only vs also-global. **Rec: per-sub only.**
- **Item 5 filename template**: PE owns the exact flag; state the user-visible
  goal (readable on-disk names with spaces, safety preserved). **Rec direction:
  `--windows-filenames`-style, keep the `[id]` suffix.**
- **Item 6 re-download**: overwrite vs "(1)" copy. **Rec: overwrite.**
- **Item 7 CRF**: default stays 23; higher-CRF opt-in via env (and/or Settings).
  **Rec: env-only for v1.15, default 23.**
- **Item 8 PWA PNG**: attempt no-dep, else DEFER. **Rec: attempt, else defer.**
- **Item 1 DnD**: progressive enhancement, keep keyboard/tap fallback. **Rec:
  keep fallback; confirm whether desktop up/down buttons stay alongside DnD.**
- Plus the minor item-3 note: keep or de-emphasize the existing /subscriptions
  one-off form now that the header modal is primary. **Rec: keep, header modal
  primary.**

Mark decisions Dean must make as **Open Questions** with your recommendation;
proceed on the recommended defaults so the plan is actionable if Dean stays
silent. Do NOT invent new scope beyond the 9 items.

## Constraints on your output

- Do NOT design the implementation (no chosen `--match-filter` expression, no
  final `-o` template, no chosen archive flag) — flag those as PE-design items
  (4, 5, 6, 1, 3) and let the principal-engineer own the mechanics.
- Every AC must be verifiable. Security/spawn-args items (4, 5, 6) and the
  folder-model item (1) get the heavier treatment — write their ACs so an
  adversarial reviewer can check them.
- Update `.state/feature-state.json`: keep `artifacts.requirements` and
  `artifacts.exec_plan` pointing at the exec plan path (already set), and append
  a history entry noting Discovery completion.

When done, report the AC count and the list of forks awaiting Dean's call, then
tell the coordinator you're ready for the Design stage.
