# Run the Build Specialist agent.

Invoke the build-specialist specialist agent from the mobile workflow (Session 2).
Use this in Session 2 (specialist workbench) after the EM has routed work via `/prep-build-verify` in Session 1.

## Workflow
1. Verify `.state/inbox/build-specialist.md` exists and is non-empty
2. If missing or empty, stop with: "No inbox file found. The EM must write one first."
3. Execute: `bash scripts/run-build-specialist.sh`
