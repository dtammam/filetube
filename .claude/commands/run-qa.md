# Run the Quality Assurance agent.

Invoke the quality-assurance agent from the mobile workflow (Session 2).
Use this in Session 2 (specialist workbench) after the EM has routed work via `/prep-qa-review` in Session 1.

## Workflow
1. Verify `.state/inbox/quality-assurance.md` exists and is non-empty
2. If missing or empty, stop with: "No inbox file found. The EM must write one first."
3. Execute: `bash scripts/run-quality-assurance.sh`
