# Wave C (v1.129): docs truth sweep round 2 + cheap release mechanicals

Status: SHIPPED v1.129.0 (2026-08-15; see ROADMAP.md). Slim gate (adversarial
seat, isolated worktree): 3 WARNINGs round 1 (a false claim in the truth pass
itself, a markup-variant blind spot in the debt census, an overclaimed
concurrency comment) - all fixed + mutant-re-verified; APPROVE on delta.
Dual-Node 6928/6928. QUALITY_SCORE.md re-graded under Dean's explicit
per-instance authorization ("Update it, it's okay"). Deviation from plan:
QUALITY_SCORE was RETIRE-or-refresh per C3; Dean chose refresh mid-wave.

Origin: external review round 2 found the v1.125 docs reset incomplete and
its own invariant false. Verified in-session 2026-08-15:

- THREE completed plans still open with `- **Status:** APPROVED ...`
  (2026-07-11-v1.29-downloads-reliability.md:4, 2026-07-11-v1.30-scale-perf-
  and-polish.md:4, 2026-07-12-v1.31-ytdlp-hardening.md:4). This is the
  divergent-spelling class striking the SAME sweep that already recorded the
  lesson: v1.125 caught `Status:`-at-line-start spellings; the bullet+bold
  `- **Status:**` spelling survived.
- CONTRIBUTING.md (~line 147) links `docs/exec-plans/active/fouc-shimmer-
  audit.md`; the file now lives in `docs/exec-plans/archive/`.

Claimed by the review, verify then fix:

- QUALITY_SCORE.md frozen at v1.41 (db.json era, ~4200 tests, no auth/RBAC).
- RELIABILITY.md says CI is Node 22 only; discusses JSON-era tests.
- RELEASING.md prescribes `git commit -am` while CONTRIBUTING + the
  PreToolUse hook forbid blind staging.
- tech-debt-tracker.md topology: rows marked OPEN sitting under `## Closed`,
  while scripts/session-start.sh counts only the earlier Active section - the
  hook injects a WRONG debt count into every session.
- README over-claims: "your data never leaves your network" (vs optional
  yt-dlp/RSS/Web Push egress), "full backup/restore" (app-state only; media,
  session secret, podcast feed secrets excluded), "every screen" (Roku is
  video-only); podcasts under-represented.
- Dockerfile/compose comments still describe db.json persistence.

## Task commits

### C1. Machine-checked status census (kill the divergent-spelling class)

Write the checker FIRST, watch it fail on the three known files, then fix
them. Checker: a unit test (or lint script wired into `npm test`) that scans
docs/exec-plans/completed/* for the FIRST status-like line (case-insensitive,
any of the observed spellings: `Status:`, `**Status:**`, `- **Status:**`,
`STATUS`) and fails unless its value starts with a terminal token (SHIPPED /
CLOSED / SUPERSEDED / ARCHIVED). The census is derived, never hand-aimed -
that is the lesson this commit exists to enforce.

### C2. Docs link checker + the broken link

Same pattern: a test that resolves every relative `docs/` link in *.md under
docs/ + CLAUDE.md + README and fails on any missing target; fix the
CONTRIBUTING link (point at archive/) and anything else it catches.

### C3. Stale-document truth pass

QUALITY_SCORE.md: retire it (move to docs/references/ with a dated banner
"historical, v1.41 era") - do NOT hand-refresh scores nobody derives.
RELIABILITY.md: correct the CI claim (22 + 24), remove JSON-era test prose.
RELEASING.md: replace `git commit -am` with explicit-path staging matching
CONTRIBUTING. Dockerfile/compose comments: SQLite, not db.json. Every claim
edited here must be DERIVED (cite the workflow file / tag / test count
command in the commit message), never remembered.

### C4. Tracker topology + hook count

Restructure tech-debt-tracker.md so OPEN rows live only in the Active
section; verify scripts/session-start.sh's count matches a manual count after
the move; add the count derivation to C1's checker if cheap.

### C5. README claim accuracy

Soften the three over-claims (egress caveat naming yt-dlp/RSS/push as
opt-in outbound; backup scope sentence; Roku video-only footnote) and give
podcasts feature-list parity. Keep the marketing voice; fix only truth.

### C6. Release mechanicals (the two cheap ones only)

- docker-publish workflow: assert the pushed tag equals `package.json`
  version before build (fail loud on mismatch).
- Add a `concurrency` group so an older slow run cannot overwrite a newer
  `latest`/`edge`.
- Everything heavier (digest-promotion, image smoke, non-root, HEALTHCHECK,
  pinned base, SBOM/signing/scan, SHA-pinned actions) goes to ONE tracker
  entry: "Wave D: pre-exposure hardening", revisit trigger = "before FileTube
  is reachable from outside LAN/VPN" (Dean 2026-08-15: exposure is 'maybe
  someday'). Include the HTTP-header baseline (CSP, frame-ancestors,
  Referrer-Policy, Permissions-Policy, HSTS posture) in the same entry.

### C7. Open device-probe debt

Tracker entry for the caption/PiP static inference (v1.124 F1 retired native
`mode='showing'`; the custom overlay cannot render inside the PiP window or
true native fullscreen): status PENDING DEAN PROBE - "play a captioned video,
enter PiP: are captions visible?" If the probe confirms blank captions, the
fix is a targeted wave: toggle the track to `showing` on
`enterpictureinpicture` / native-fullscreen entry and back to `hidden` on
exit - remembering the v1.124 lesson that TWO fullscreen mechanisms exist
(faux classes vs native API) and a gate must handle BOTH.

## Explicitly rejected review items (do not resurrect without Dean)

- Big-bang architecture decomposition (server.js split, worker isolation,
  TypeScript/typed contracts): DEFERRED by Dean 2026-08-15. Posture: new
  code lands in modules; extractions are opportunistic; revisit when feature
  velocity slows.
- Observability stack (structured logs, metrics, SLOs): not planned for a
  household deployment; tracker-grade at most.
