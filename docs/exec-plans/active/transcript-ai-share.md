# Transcript: "Share with AI" + prose mode + one-row desktop action bar

Dean, 2026-08-28 (after v1.200.0 device pass: "goddamn amazing"). Ships as
v1.201.0 on `feat/transcript-ai-share`. Full gate.

## Rulings (intake, all agreed)

1. **Desktop second row (non-theatre):** drop the words, keep the glyphs
   when the column is too narrow for the labelled row - a CSS container
   query on `.watch-action-bar` (the column-wide block; never on the flex
   item itself). Theatre's wide column keeps the words. Buttons never
   deform (v1.200 norm); measured with `scripts/action-row-probe.js` in
   BOTH modes (new `--theatre` flag) at 1280/1366/1600/1920 + phones.
2. **Prose mode:** timestamps OFF -> lines joined into paragraphs, a new
   paragraph only at a real pause (>= 2000ms between one cue's end and the
   next cue's start). Timestamps ON -> one `[m:ss] line` per row (as today).
   Pure, in `lib/transcript.js`; the route and the modal are unchanged.
3. **Prompts live server-side, instance-wide:** `settings.transcriptAiPrompts`
   = `[{ id, name, text }]` (max 12; name 1-60 chars; text 1-4000 chars;
   ids server-assigned, unique). Admin-editable via `POST /api/settings`
   (existing write-RBAC), readable by every signed-in user via the existing
   `GET /api/settings`. Multiple named prompts (Dean: "a summarization
   prompt, then an analysis - select out of the list").
4. **Default:** one prompt, "Summarize": "I'm sharing a video transcript
   below. Summarize the narrative and key points, then note anything
   notable or questionable." An EMPTY list hides the AI action everywhere
   (never a do-nothing button).
5. **Placement:** phone picker gains a third pick "Share with AI"; desktop
   modal gains a third button - "Share with AI" when `navigator.share`
   exists, else "Copy for AI". One prompt -> acts directly; several ->
   a pick-one modal of prompt names first.
6. **Payload:** `<prompt text>\n\n<the transcript document>` - phone always
   prose (no timestamps); desktop follows the "Show timestamps" box.

## Tasks (each its own green commit)

- T1 server: DEFAULT_SETTINGS + KNOWN_KEYS + validation + settingsResponse
  for `transcriptAiPrompts`; `lib/transcript.js` prose paragraphs
  (`endMs` carried per line). Tests: settings API (accept / reject shapes /
  round-trip / partial-persist guard), transcript prose fixtures.
- T2 client: watch.js AI action (prefetch settings with the transcript;
  prompt pick modal), common.js modal third button; setup.js/setup.html
  prompts editor (list of name + textarea rows, add/remove, saves the whole
  array on change, field error surface). Tests: jsdom watch (payload =
  prompt + blank line + text; hidden when list empty; pick modal when >1),
  setup editor (render from GET, save shape on edit/add/remove).
- T3 CSS: container query + probe `--theatre` flag; before/after geometry
  quoted from what the probe PRINTS.

## Attack surfaces for the gate

- Validation: an object/array/oversize/duplicate-name/HTML-in-text prompt;
  partial persist alongside a valid key; member (non-admin) POST -> 403;
  member GET still sees the prompts (by design - they are not secret).
- Prose paragraphing: gap exactly 2000ms; a hold cue between paragraphs;
  timestamps mode byte-identical to v1.200.
- Client: payload order and separator; empty list hides BOTH surfaces;
  navigator.share absence on desktop -> Copy label + clipboard; SPA abort
  tears down the prompt-pick modal too; a settings fetch failure still
  offers Share/Copy (the AI pick just disappears).
- Container query: the token census (query literals are ungoverned like
  media queries); theatre keeps words; no deformation in either mode.
