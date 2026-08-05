# HANDOFF: finish v1.70.0, then build v1.71.0

Paste this whole file to the new agent as its opening prompt. Read
`CLAUDE.md` first - lean mode is the contract. Dean's device pass is the
final arbiter of "done" on every wave.

---

## PACING RULE FOR THIS HANDOFF (Dean's correction, 2026-08-02)

The previous session ran the v1.70 adversarial gate for FOUR rounds and Dean
stopped it: "this seems egregiously long." Rounds 1-2 found real CRITICALs
(an arbitrary-file read/destroy primitive reachable from an admin backup);
rounds 3-4 were defence-in-depth on suggestions the seat itself called
non-blocking. **Ship on CRITICAL/WARNING closure. Take non-blocking
SUGGESTIONs only if they are one-liners, otherwise write them to
tech-debt and move on.** If a gate reaches round 3, stop and ask Dean
whether to continue or ship with the residual disclosed.

---

## STATE OF THE TREE (verified 2026-08-02)

- `main` = `01edeb4` (v1.69.1 merged + tagged + pushed; Docker published).
  Dean is RUNNING v1.69.1 and has confirmed the Podcasts place works.
- Current branch `release/v1.70.0`, HEAD `d36d731`, **NOT merged**.
- **UNCOMMITTED work in progress** (finish or discard - see below):
  - `lib/podcasts/index.js` - two applied delta-round suggestions:
    (1) `sweepExpiredTrash` purges per-user rows for the ids the mutation
    ACTUALLY tombstoned (`tombstoned[]`), not the pre-mutation `expired`
    list; (2) the cover-retry `catch` no longer clobbers a specific
    `coverFailure` message with `'unexpected'`.
  - `test/unit/podcasts-trash.test.js` - two tests binding exactly those
    ("delta S1: rows and record purge in LOCKSTEP", "delta S2: a missing
    root ... names the real incident"). Both PASS (16/16 in that file).
  - These are complete and green; they just need committing.

## WHAT v1.70.0 IS (both features BUILT and tested)

Exec plan: `docs/exec-plans/completed/2026-08-02-v1.70-podcast-episode-delete.md`.

1. **Cover-art fix** (Dean's device find: no artwork on the show card).
   Root-caused by live measurement: Patreon serves the show image as a
   15,494,765-byte PNG; `COVER_MAX_BYTES` was 8 MB, the abort was silent,
   and the retry was coupled to `targets.length > 0` so one failure was
   permanent. Now 32 MB, retried every poll until art lands, failures
   surfaced in the cycle status, 2-minute ceiling (not the episode hour).
2. **Recoverable episode delete** (closes tech-debt #81). Status
   `'trashed'` + `trashPath`/`trashedAt`; `DELETE /api/podcasts/episodes/:id`
   moves the file to `<podcastsRoot>/.filetube-trash` (rename; EXDEV ->
   copy+fsync+verify+unlink); `POST /:id/restore` (409 on collision, 410 +
   tombstone on a vanished trash file); retention sweep on the EXISTING
   `db.settings.trashRetentionDays` at boot + each cycle; two-tap delete UI,
   In-trash chip + Restore. Per-user rows survive trash, retire on purge.
3. **Dean's translucent-window bug + 4 siblings.** `background:
   var(--bg-primary)` - a token that NEVER EXISTED, so the declaration was
   invalid and the sheet had no background in every era. Same defect at
   `--text-inverse`, `--shadow-sm`, and two PRE-EXISTING sites
   (`--bg-primary` in the v1.43 users row, `--text-color` in the reloc
   panel). All five fixed. New lock in `test/unit/token-scale-lock.test.js`:
   every fallback-less `var()` must name a defined token (comments stripped
   first - the v1.50 lesson).

**Gate status: adversarial seat APPROVED at `d36d731`** after 4 rounds
(3 CRITICALs found and closed: record path fields unconfined -> the
confinement ROOT itself bundle-controllable via `settings.downloadDir` ->
`GET /episode/:id` serving a db-authored path with no confinement at all;
plus the v1.69 mount-loss guard re-introduced in the new sweep). **The QA
seat has NOT reviewed v1.70 at all.**

### TO FINISH v1.70 (short path, ~30 min)

1. `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every npm/node/git command.
2. Commit the two uncommitted files (message: the delta S1/S2 fixes above).
3. **Re-run these three files individually** - the last full run showed
   `backup-restore`, `books-tts`, `db-crash-kill9` failing with
   `fetch failed` / `child never reached READY`. That is the tech-debt #76
   load-sensitivity signature (every affected file passes alone), but it was
   NOT confirmed before the session ended. Confirm it; if any fails on a
   QUIET machine, that is a REAL finding - investigate before shipping.
4. Spawn the `quality-assurance` agent (full gate, both seats must approve).
   Brief: range `01edeb4..<HEAD>`, the plan above, and tell it the
   adversarial seat already approved and what it found, so it does not
   re-litigate. QA's remit: contract correctness, regressions, standards,
   comment accuracy after 4 fix rounds, test quality.
5. Fix round if needed -> delta re-confirm with the SAME QA instance.
6. Dual-Node sequential full suites (v22.23.1 then v24.14.0, reviewers
   idle), report counts verbatim.
7. Ceremony: `npm version 1.70.0 --no-git-tag-version`, honest ROADMAP
   entry (include what the gate caught AND the four-round overrun), move
   BOTH exec plans (`2026-08-02-v1.69-podcasts-place.md`, `2026-08-02-v1.70-podcast-episode-delete.md`)
   to `completed/` only when Dean's device pass closes them - otherwise
   leave in `active/`, `git merge --no-ff` into main, tag `v1.70.0`, push
   all refs. Docker auto-publishes; **the pull onto Dean's server is Dean's.**
8. Memory: update `v1-69-0-shipped.md` (add v1.70) or create
   `v1-70-0-shipped.md` + the MEMORY.md index line.

### Dean's v1.70 device probes
- The 15.5 MB cover finally rendering on the show card (the headline).
- Two-tap Delete on an episode row -> In-trash chip -> Restore -> plays
  again from the same resume position.
- Unsubscribe still keeps files on disk.
- The Podcasts Settings sheet now has an OPAQUE background in every era.

---

## v1.71.0 - DEAN'S SEVEN ITEMS (one branch, his ruling)

Rulings already given - do NOT re-intake:

1. **Settings-sheet transparency** - FIXED in v1.70 (see above). If Dean
   reports any surface still translucent after pulling v1.70, look for the
   same undefined-token class first; the new lock should now prevent it.
2. **Podcasts on the mobile bottom bar** - as a customizable OPTIONAL item
   (`BOTTOM_NAV_OPTIONAL` in `public/js/common.js:~3230`, editor in
   Settings), off by default.
3. **Local download of an episode** - "save to my phone like we have for
   other things" (NOT PWA offline caching). Mirror the existing download
   affordance used elsewhere in the app; a per-episode row control.
4. **Like episodes** - "like episodes to the liked folder". Episode-level
   likes surfacing in a Liked view (the music-place pattern). NOT
   show-level favourites.
5. **Home resume for podcasts** - two parts, both confirmed by Dean:
   (a) a mid-episode podcast appears in home's Continue-listening row and
   resumes from position (music's pattern); (b) "if you press home while
   in one thing it'll go back and save that position."
6. **One queue for all** - widen the v1.63 playback queue (`lib/queue/store.js`,
   `user_queue`/`user_queue_state`, routes ~server.js:8247) to carry podcast
   episodes alongside media items. NOT a separate podcast queue. Note the
   queue currently resolves entries against `db.metadata` only - that is the
   seam to widen, and tech-debt #72 (pointer semantics on removal) lives here.
7. **Mobile now-playing** - "like the audio player for mp3s that are NOT in
   music. audio only style from ytdlp is totally sufficient." I.e. reuse the
   existing audio-player presentation the watch page gives a non-music audio
   file, rather than designing something new. The docked mini-player stays;
   this is the expanded view.

### v1.71 build notes (from the v1.69/v1.70 work)
- Items 4 + 5 + 6 all touch per-user state -> ONE schema bump if possible
  (v9 -> v10). The id-keyed-carrier law: every new per-media/per-episode
  table wires its delete carrier AND backup export/restore/validation arms
  IN THE BIRTH COMMIT (see `user_podcast_progress` in `lib/auth/store.js`
  and `removePodcastEpisodeState` for the pattern; podcast episode ids are
  guid-derived so there is no re-key half).
- Podcast episode ids are NOT `db.metadata` ids. Anything that assumes
  media-shaped ids (queue resolution, history, home rows) needs an explicit
  podcast arm - this bit v1.69 twice.
- The nav anchor chain is Music > Books > Podcasts > History
  (`injectLibraryNavEntry`); `test/integration/history-nav-gate.test.js`
  race-tests all 24 permutations.
- Styling: census must stay TOTAL 0 (`npm run lint:css`), ledger CLEAN, and
  every new className needs a real CSS rule (the v1.68.3 styling-source
  rule) - AND now every `var()` must name a defined token (the new lock).
- **Walk the fresh-install path** for any new surface. Dean's v1.69.1 find
  (no door to /podcasts at zero subscriptions) is the lesson: no instrument
  checks "how does a human first get here."

### Open tech debt touching this area
#72 (queue pointer on removal - relevant to item 6), #80 (TOCTOU inherit),
#82 (non-mp3 enclosures, per-episode art, OPML, ytdlp dock parity),
#83 (rotated-token dup-add; guidKey collisions; guid-less signed-URL churn),
#84 (no in-flight download abort + backpressure), #85 (orphan-secret sweep's
synchronous-writer invariant), #86 (EXDEV-kill partial in .filetube-trash).
#81 closes with v1.70.

### Reusable adversarial harnesses
The v1.69/v1.70 seat left repro scripts in the session scratchpad
(`v70r3-episode-read.js`, `v70r2-chain.js`, `v70-sweep-mount.js`,
`attack-identity-e2e.js`, `repro-mount.js`, etc.). They live in SESSION
scratch and will be GONE - recreate from the tech-debt row descriptions if
a revisit trigger fires.
