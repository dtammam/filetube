# Start here. Bootstraps a new feature into the agent pipeline.

Use this command to begin a new feature. It initializes pipeline state and
points you to the first prep command.

## Input

$ARGUMENTS = optional one-line feature description.

## Procedure

Invoke the **engineering-manager** agent with these instructions:

> 1. Check `docs/exec-plans/active/` for overlapping plans. If a plan already
>    covers this area, warn the user and confirm before proceeding.
> 2. Check `docs/exec-plans/tech-debt-tracker.md` for related debt items.
>    If any exist, mention them so the user can decide whether to bundle.
> 3. If `$ARGUMENTS` is non-empty, use it as the feature name/description.
>    Otherwise, ask the user for a one-line feature description.
> 4. Initialize `.state/feature-state.json` with the feature name and
>    stage set to `discovery`.
> 5. Tell the user: "Run **`/prep-pm-discover`** to begin requirements gathering."

## Rules

- This command ONLY bootstraps. It does NOT run discovery, design, or any
  other stage.
- Do not invoke any specialist agent.
- Do not auto-progress to the next stage.
