# Read-only pipeline status report.

Read-only status report for the current SDLC pipeline state.

## Rules

- This command is STRICTLY READ-ONLY.
- Do NOT modify any files, state, or configuration.
- Do NOT invoke any agent (engineering-manager or otherwise).
- Do NOT write to `.state/` or any inbox file.

## Workflow

1. Read `.state/feature-state.json`.
   - If the file does not exist, is empty, contains `{}`, or has no `feature_name` value, report: "No active feature in the pipeline." and STOP.

2. Extract from the state file:
   - `feature_name` -- the active feature
   - `stage` -- the current pipeline stage
   - `exec_plan` -- path to the execution plan
   - `tasks` -- the task list (if present)

3. Determine the responsible agent for the current stage using this mapping:

   | Stage | Responsible Agent |
   |-------|-------------------|
   | `discovery` | Product Manager |
   | `design` | Principal Engineer |
   | `tasks` | Engineering Manager |
   | `implementation` | Software Developer |
   | `verification` | Build Specialist |
   | `review` | Quality Assurance |
   | `acceptance` | Product Manager |

4. Read the inbox file for the responsible agent at `.state/inbox/<agent-name>.md` (using kebab-case: `product-manager.md`, `principal-engineer.md`, `engineering-manager.md`, `software-developer.md`, `build-specialist.md`, `quality-assurance.md`). If the inbox file is missing or empty, note "No inbox content for this agent."

5. Run `git diff --stat` and `git diff --name-only` to capture uncommitted changes. If the working tree is clean, note "Working tree is clean."

6. Read the execution plan file at the path specified in the `exec_plan` field. If the path is missing or the file does not exist, note "No execution plan found."

7. If the `tasks` array is present, summarize task completion status (count completed vs total).

8. Present a formatted summary with these sections:

   ```
   ## Pipeline Status

   **Feature:** <feature_name>
   **Stage:** <stage>
   **Responsible agent:** <agent name from mapping>

   ## Agent Inbox

   <contents of the agent's inbox file, or "No inbox content for this agent.">

   ## Uncommitted Changes

   <output of git diff --stat, or "Working tree is clean.">

   ## Changed Files

   <output of git diff --name-only, or "No changed files.">

   ## Task Progress

   <X of Y tasks completed, or "No tasks defined yet.">

   ## Execution Plan

   <contents of the exec plan file, or "No execution plan found.">

   ## Recommended Next Step

   <Based on the current stage, recommend the appropriate /run-* command or action:
     - discovery: "/run-pm to invoke the Product Manager"
     - design: "/run-pe to invoke the Principal Engineer"
     - tasks: "Waiting for Engineering Manager to break down tasks"
     - implementation: "/run-sde to invoke the Software Developer"
     - verification: "/run-build to invoke the Build Specialist"
     - review: "/run-qa to invoke Quality Assurance"
     - acceptance: "/run-pm to invoke the Product Manager for acceptance">
   ```
