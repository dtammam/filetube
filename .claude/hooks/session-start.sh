#!/usr/bin/env bash
# SessionStart hook — injects repo context at the start of every conversation.
# Keep this fast (<500ms). No network calls.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Branch and working tree state
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'detached')"
DIRTY="$(git status --short 2>/dev/null | wc -l | tr -d ' ' || echo '0')"

# Active execution plans
ACTIVE_DIR="$ROOT/docs/exec-plans/active"
PLANS=""
if [ -d "$ACTIVE_DIR" ]; then
  PLANS="$(find "$ACTIVE_DIR" -maxdepth 1 -name '*.md' -not -name 'README.md' -not -name '.*' -exec basename {} \; 2>/dev/null | sort)"
fi
PLAN_COUNT="$(echo "$PLANS" | grep -c . || true)"

# Tech debt OPEN count (v1.129 C4): the legacy Active table's rows (presence =
# open; it has no status cell) PLUS every row anywhere whose LAST cell starts
# with OPEN (the chronological Ledger mixes OPEN and CLOSED; the status cell
# is authoritative). The old expression counted only the Active section and
# injected 42 while ~111 items were open - test/unit/tech-debt-census.test.js
# now EXECUTES this hook and fails if this count drifts from its own parse.
DEBT_FILE="$ROOT/docs/exec-plans/tech-debt-tracker.md"
DEBT_COUNT=0
if [ -f "$DEBT_FILE" ]; then
  ACTIVE_ROWS="$(awk '/^## Active/,/^## Closed/' "$DEBT_FILE" | grep -cE '^\| *[0-9]' || true)"
  # [*_]* tolerates emphasis markup around OPEN (gate W2: a bolded **OPEN**
  # cell silently dropped from the count; the census test strips the same
  # markup and goes red if this grep and its parse ever disagree).
  OPEN_ROWS="$(grep -E '^\| *[0-9]+ \|' "$DEBT_FILE" | grep -cE '\| *[*_]*OPEN[^|]*\| *$' || true)"
  DEBT_COUNT=$((ACTIVE_ROWS + OPEN_ROWS))
fi

# Output
echo "=== Session Context ==="
echo "Branch: $BRANCH ($DIRTY uncommitted changes)"
echo "Active plans: $PLAN_COUNT"
if [ -n "$PLANS" ]; then
  echo "$PLANS" | sed 's/^/  - /'
fi
echo "Tech debt items: $DEBT_COUNT"
# Unfilled placeholder detection (the /seed auto-configure command was
# deleted in the 2026-08-01 harness cleanup - placeholders are filled by
# hand when this harness seeds a new repo)
CLAUDE_MD="$ROOT/CLAUDE.md"
if [ -f "$CLAUDE_MD" ] && grep -q '{{' "$CLAUDE_MD" 2>/dev/null; then
  echo "Unfilled {{placeholders}} detected in CLAUDE.md - fill them in before working."
fi
echo "======================"
