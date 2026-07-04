# Plan-gated intake for multi-domain or risky changes.

Plan-gated intake for multi-domain or risky changes.

## Workflow

1. Check `docs/exec-plans/active/` for overlapping plans
2. Check `docs/exec-plans/tech-debt-tracker.md` for related debt items
3. Collect from the user:
   - **Goal:** What this achieves
   - **Scope:** What's in, what's explicitly out
   - **Constraints:** Technical or process boundaries
   - **Authoritative docs:** Which files/docs are the source of truth
   - **Deliverables:** What "done" looks like
   - **Complexity signal:** Why this is multi-domain or risky
4. Create an execution plan file in `docs/exec-plans/active/<feature-name>.md`
5. **BLOCK** — do not proceed to implementation until the plan is explicitly approved
6. On approval, invoke the engineering-manager agent to begin the pipeline
