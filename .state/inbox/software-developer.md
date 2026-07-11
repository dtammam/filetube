# Gate-Fix micro-round GF1 — revert deriveAvatar glyph to first-letter (GD-1)

You are the **software-developer**. This is a **single-item gate-fix micro-round**
after the v1.30 two-reviewer gate PASSED. Both reviewers independently recommended
reverting T12's hash-letter avatar glyph back to the name's first letter (GD-1).
Implement **ONLY this one change** + its affected tests. Ship code + tests, run
lint + tests green, then report.

## Environment (do this FIRST — v1.29 process learning)

```bash
export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"
node --version   # expect v22.23.1 (CI parity)
```
Required before any `npm`/`node`/`git` command (git hooks run lint + unit tests).

## Context (why this change)

The gate PASSED (QA APPROVE + adversarial APPROVE). The one adopted item is **GD-1**:
T12 changed `deriveAvatar`'s fallback glyph from the name's first letter to a
hash-selected letter (`AVATAR_GLYPH_ALPHABET[seed % 26]`). Both reviewers judged
this LOSES the recognizable first-letter mnemonic ('Alice' → 'Q') and does not
serve Dean's "recognizable/deterministic avatar" intent as well as **first-letter +
deterministic color**. Revert the glyph; keep everything else T12 landed (the
deterministic hash-based COLOR, the C5 shared-resolver wiring in
`subscriptions.js`, the `'?'` blank-name case). Recorded on the Dean-on-device
ledger as adopted-per-reviewer-consensus (Dean can re-open on his on-device pass).

## The exact change (public/js/common.js)

`deriveAvatar` is at **common.js:172**. Current body (~172–179):

```js
function deriveAvatar(name) {
  const label = typeof name === 'string' ? name.trim() : '';
  const safeLabel = label !== '' ? label : '?';
  const seed = hashAvatarSeed(safeLabel);
  const glyph = safeLabel === '?' ? '?' : AVATAR_GLYPH_ALPHABET[seed % AVATAR_GLYPH_ALPHABET.length];
  const color = AVATAR_PALETTE[seed % AVATAR_PALETTE.length];
  return { glyph, color };
}
```

Revert the **glyph line** to the first-letter form, keeping the hash-based color:

```js
  const glyph = safeLabel.charAt(0).toUpperCase();
```

Note `('?').charAt(0).toUpperCase() === '?'`, so the blank-name `'?'` case is
preserved without the special-case ternary. Keep `seed` (still used for `color`).

- **Remove `AVATAR_GLYPH_ALPHABET`** if it becomes unused after this revert (lint
  will flag `no-unused-vars` otherwise) — grep for any other consumer first; if
  nothing else uses it, delete its declaration.
- **Update the doc comment** on `deriveAvatar` (common.js ~149–171): it currently
  describes the C3 hash-letter glyph upgrade and flags the mnemonic tradeoff for the
  gate. Rewrite it to describe the shipped behavior: deterministic hash-based COLOR
  + the channel name's first-letter-uppercase glyph, and note the GD-1 gate
  resolution (hash-letter reverted per unanimous two-reviewer recommendation;
  Dean-on-device may re-open). Do NOT leave a stale comment describing a glyph the
  code no longer produces.
- Do NOT touch `resolveAvatarSource`, `hashAvatarSeed`, `AVATAR_PALETTE`, the C5
  `subscriptions.js` wiring, or `watch.js` — those stay exactly as T12 landed.

## Tests to update

- **`test/unit/derive-avatar.test.js`** — the T12 hash-letter contract assertions
  must be reverted to the **first-letter** contract: same name → same
  `{glyph,color}`; glyph === the name's first letter uppercased; different names
  still get deterministic colors; the `'?'` blank-name case still holds; a captured
  URL still wins via `resolveAvatarSource`. **Keep the AC7.4 both-directions purity
  assertions** (pure function of name + real-avatar-wins) — only the glyph-VALUE
  expectation changes from hash-letter back to first-letter.
- **Any subscriptions-client assertion** (e.g. in
  `test/unit/ytdlp-subscriptions-client.test.js`) that derived from the hash-letter
  glyph value — update to the first-letter expectation. The C5 wiring itself
  (row + settings header route through the shared resolver) is unchanged and its
  cross-site-consistency assertion stays valid.

## SCOPE FENCE

- ONLY the `deriveAvatar` glyph revert + comment + the affected test expectations.
  No other source changes. Do not touch the tech-debt tracker (the EM filed the
  MAX_LIMIT and matchesSearch items). No other tasks.

## Definition of done

`deriveAvatar` glyph is the name's first-letter-uppercase again (deterministic color
kept, `'?'` case kept); dead `AVATAR_GLYPH_ALPHABET` removed if unused; doc comment
updated; `derive-avatar.test.js` + any subs-client assertions reflect first-letter;
AC7.4 both-directions purity still asserted. `npm run lint` and `npm test` green
under Node 22.23.1 (run them yourself and fix failures before reporting). Do NOT
commit or push.

## Report back (concise)

The one-line glyph change, whether `AVATAR_GLYPH_ALPHABET` was removed, which tests
you updated (and confirmation AC7.4 purity + C5 wiring assertions still pass), and
the `npm test` + `npm run lint` result (note the new test count vs 3593 — it should
be roughly flat; the hash-letter assertions convert to first-letter, no net add).

When done, return to the EM session and run `/prep-build-verify`.
