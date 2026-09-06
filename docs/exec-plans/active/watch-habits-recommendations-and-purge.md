# Watch-habits model → recommendations + smart purge (PARKED)

**Status: PARKED — captured 2026-09-05 for later, NOT scheduled.** Dean: "I like all
of this. Let's save this effort for now... we're not gonna do it [yet]." This doc is the
whiteboard record of the design conversation so it survives, not a committed plan. When
it wakes up: the purge half is DATA-LOSS territory and gets the FULL adversarial gate
(never slim), briefed to destroy the data.

## The three things this came out of

1. **Understanding music autoplay** (already understood, recorded here for contrast — see
   below). It is NOT content-similarity; it is a radio queue-extender.
2. **Auto-purge** of downloaded content unlikely to be watched (Dean's new idea).
3. **"Next to watch"** optional recommendations (Dean's new idea).

## How music autoplay actually works today (the contrast that seeded the ideas)

`music.js` `maybeExtendQueueForAutoplay`. It is a RADIO STATION, not a similarity engine:

- Fires only when playback reaches the LAST track in the queue (just-in-time extension,
  so the queue never runs dry).
- Builds an exclude set = everything in the queue + a rolling ~2000-id session no-repeat
  memory (`autoplayPlayedIds`).
- Fills up to **5** new tracks (`AUTOPLAY_APPEND_COUNT`) via three arms:
  1. **Artist arm** (up to 3, `AUTOPLAY_ARTIST_MAX`): 30 random tracks by the CURRENT
     song's artist. This is the entire "feels related" effect.
  2. **Library arm**: top up to 5 from 60 random library tracks.
  3. **Recycle arm**: if a small/exhausted library yields nothing, relax no-repeat to
     "not in the queue right now" so it never dies in silence (Dean's radio intent).
- TOCTOU-guarded after the awaits (aborted view / autoplay toggled off / tail changed /
  playing track changed) before appending.

**The key architectural fact:** a REAL content-similarity ranker already exists —
`rankRelated` in `common.js` (token/folder/channel scoring, weights 3/2/1) — but it is
only wired to the VIDEO watch-page "Related" sidebar. It is the natural engine for a
smarter recommendation feature. Music similarity is left as an artist bias on purpose.

## The data we already persist (the foundation for BOTH ideas)

- **Per-user watch progress** (user store): `{ position, duration, updatedAt }` per opened
  item → derives (a) did you open it at all (entry exists?), (b) how far / finished vs
  abandoned (position÷duration), (c) when (`updatedAt`).
- `addedAt` (age), `viewCounts` (aggregate plays), channel/folder/artist attribution.
- GAPS: no discrete "finished" event for VIDEO (books/podcasts have a manual latch; video
  is derived from ratio). Subscription→item linkage is NAME-BASED and imperfect
  (tech-debt #122) — matters for any per-channel reasoning.

Enough to build a **transparent, per-channel consumption model** — the shared core of both
ideas.

## Framing (the architect challenge)

The purge idea actually hides TWO different problems:

- **A — disk space:** downloads outrun consumption; the drive fills. The ONLY problem that
  justifies deletion.
- **B — clutter/noise:** the feed/notifications drown in never-watched items. Solved by
  HIDING / de-prioritizing — non-destructive, low-risk, reversible.

Confirm which is real before committing to anything destructive. If it is mostly B, no
deletion is needed and the wave is far smaller and safer.

**On "predict what won't be watched":** on a single-user box a black-box ML score is the
wrong tool — data too sparse, and you cannot AUDIT an opaque score before it deletes
files. Use a **transparent, rules-based staleness report** where every candidate carries
its reason ("this channel: you've watched 2 of the last 40; these 38 are 60+ days old,
never opened, ~14 GB"). Per-channel consumption rate is the strongest AND most explainable
signal.

## Design directions

### #3 "Next to watch" (non-destructive — build FIRST)
- Reuse `rankRelated`, but seed from what you've FINISHED recently, weighted by channel
  affinity + freshness, over the unwatched / partially-watched pool.
- Opt-in menu setting. Worst case of a wrong answer is a mediocre suggestion.
- Strategic value: it forces us to DEFINE "watch habits" concretely (per-channel affinity,
  finished-vs-abandoned, recency weighting) on SAFE ground.

### #2 Smart purge (destructive — build SECOND, on the proven model)
- Literally #3's model INVERTED: low affinity + old + never-opened = purge candidate.
- NON-NEGOTIABLE guardrails: suggestion/report only by default; route through Trash
  (reversible), never hard-unlink; auto-delete is a separate explicit opt-in with a high
  bar.
- **yt-dlp archive interplay (real trap):** purging a subscription video without touching
  the download archive means it either re-downloads next poll OR is blocked from ever
  returning. Decide "purge and never re-fetch" vs "purge but let it return" deliberately.

## Recommended sequence
Build the watch-habit model behind **#3 (recommendations) first**, then invert it for
**#2 (purge)**. One shared engine; safe feature first; destructive feature on proven ground.

## Open intake questions (Dean's calls when this wakes up)
1. Which pain is real — disk space (A), clutter (B), or both? (Rec: confirm A before
   anything deletes.)
2. Purge = suggestion-report + Trash (recoverable), auto-delete a later separate opt-in?
   (Rec: yes.)
3. Build #3 first as the vehicle for the shared model, then #2? (Rec: yes.)
4. Per-channel consumption rate as the primary, auditable signal (not an opaque per-video
   score)? (Rec: yes.)
