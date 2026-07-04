# Run the Software Developer agent.

Invoke the software-developer specialist agent from the mobile workflow (Session 2).
Use this in Session 2 (specialist workbench) after the EM has routed work via `/prep-sde-implement` in Session 1.

## Workflow
1. Verify `.state/inbox/software-developer.md` exists and is non-empty
2. If missing or empty, stop with: "No inbox file found. The EM must write one first."
3. Execute: `bash scripts/run-software-developer.sh`
