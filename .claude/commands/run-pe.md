# Run the Principal Engineer agent.

Invoke the principal-engineer specialist agent from the mobile workflow (Session 2).
Use this in Session 2 (specialist workbench) after the EM has routed work via `/prep-pe-design` in Session 1.

## Workflow
1. Verify `.state/inbox/principal-engineer.md` exists and is non-empty
2. If missing or empty, stop with: "No inbox file found. The EM must write one first."
3. Execute: `bash scripts/run-principal-engineer.sh`
