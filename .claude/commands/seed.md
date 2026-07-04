# Onboard the agent framework into this repository.

One-shot onboarding command that auto-detects project configuration and fills in template placeholders.

## Rules

- This command does NOT start a feature lifecycle.
- This command does NOT interact with `.state/feature-state.json`.
- This command does NOT create execution plans or tasks.
- This is a ONE-SHOT operation. It runs, produces a report, and finishes.
- NEVER silently overwrite existing non-placeholder content.

## Workflow

1. Invoke the engineering-manager agent with the following SEED instruction (use the Agent tool with the `engineering-manager` agent):

   ```
   SEED INSTRUCTION -- NOT A FEATURE KICKOFF

   This is a one-shot onboarding operation. Do NOT create a feature lifecycle
   entry. Do NOT write to .state/feature-state.json. Do NOT create an
   execution plan.

   Your job:

   A. SCAN the codebase to auto-detect:
      - Primary language(s) and framework(s)
      - Build command (e.g., `cargo build`, `npm run build`, `go build ./...`)
      - Test command (e.g., `cargo test`, `npm test`, `pytest`)
      - Lint command (e.g., `cargo clippy`, `npx eslint .`, `ruff check .`)
      - Format command (e.g., `cargo fmt`, `npx prettier --write .`, `black .`)
      - Package manager (e.g., cargo, npm, pip, go modules)
      - High-level architecture patterns (monolith, microservices, monorepo, etc.)
      - Existing coding conventions (naming style, module organization, error handling patterns)

      Detection sources: look for Cargo.toml, package.json, go.mod, pyproject.toml,
      Makefile, Dockerfile, CI config files (.github/workflows/, .gitlab-ci.yml),
      existing source files, and any existing documentation.

   B. CHECK for remaining placeholders in these target files:
      - CLAUDE.md
      - docs/CONTRIBUTING.md
      - docs/ARCHITECTURE.md
      - docs/RELIABILITY.md
      - hooks/pre-commit
      - hooks/pre-push

      Placeholders are tokens matching the pattern: {{PLACEHOLDER_NAME}} or {{TODO}}.

      If NO placeholders remain in ANY target file, produce a NO-OP REPORT:
        - State that all placeholders are already filled.
        - Summarize the current detected values for each field.
        - Offer to re-scan if the user wants to update values.
        - Do NOT modify any files.
        - STOP here.

   C. FILL IN detected values by replacing placeholder tokens in each target file:
      - {{LANGUAGE}} -> detected primary language
      - {{FRAMEWORK}} -> detected framework (or "None" if not applicable)
      - {{PACKAGE_MANAGER}} -> detected package manager
      - {{BUILD_CMD}} -> detected build command
      - {{TEST_CMD}} -> detected test command
      - {{LINT_CMD}} -> detected lint command
      - {{FORMAT_CMD}} -> detected format command
      - {{STYLE_RULES}} -> observed coding style conventions
      - {{NAMING_CONVENTIONS}} -> observed file/variable naming patterns
      - {{SYSTEM_OVERVIEW}} -> high-level architecture description
      - {{COMPONENT_LIST}} -> detected major components/modules
      - {{DATA_FLOW_DESCRIPTION}} -> how data moves through the system
      - {{CONSTRAINTS}} -> detected technical constraints
      - {{ERROR_HANDLING_PATTERNS}} -> observed error handling approach
      - {{LOGGING_CONVENTIONS}} -> observed logging patterns
      - {{UNIT_TEST_APPROACH}} -> detected unit test setup
      - {{INTEGRATION_TEST_APPROACH}} -> detected integration test setup
      - {{E2E_TEST_APPROACH}} -> detected E2E test setup
      - {{MONITORING_APPROACH}} -> detected monitoring setup
      - {{TEST_CMD_FAST}} -> fast test subset command
      - {{DOMAIN_1}} -> primary domain name

      For hooks/pre-commit and hooks/pre-push:
      - Uncomment the appropriate tech-stack section based on detected language
      - Fill in any placeholder commands
      - Leave other commented sections as-is

      PRESERVATION RULES:
      - Only replace the placeholder token itself. Do not alter surrounding text.
      - If a file contains both placeholder tokens and user-written content,
        preserve all user-written content exactly as-is.
      - If a placeholder cannot be auto-detected, leave the placeholder in place
        and flag it in the report.

   D. PRODUCE a structured seed report with these sections:

      ## Seed Report

      ### Detected Configuration
      | Field | Value | Confidence | Source |
      |-------|-------|------------|--------|
      (one row per detected value, with the file/signal that informed the detection)

      ### Files Modified
      - List each file that was modified and what placeholders were filled

      ### Unresolved Placeholders
      - List any placeholders that could NOT be auto-detected
      - For each, explain why and suggest how the user can fill it manually

      ### Recommendations
      - Any additional setup steps the user should take

   E. STOP. Do not proceed to any pipeline stage.
   ```

2. Present the seed report to the user.
3. If the engineering-manager reports a no-op (all placeholders filled), relay that to the user and offer to re-run with `--force` semantics (re-scan and update).
