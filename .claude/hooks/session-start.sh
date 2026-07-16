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

# Tech debt active count
DEBT_FILE="$ROOT/docs/exec-plans/tech-debt-tracker.md"
DEBT_COUNT=0
if [ -f "$DEBT_FILE" ]; then
  DEBT_COUNT="$(awk '/^## Active/,/^## Closed/' "$DEBT_FILE" | grep -cE '^\| *[0-9]' || true)"
fi

# Output
echo "=== Session Context ==="
echo "Branch: $BRANCH ($DIRTY uncommitted changes)"
echo "Active plans: $PLAN_COUNT"
if [ -n "$PLANS" ]; then
  echo "$PLANS" | sed 's/^/  - /'
fi
echo "Tech debt items: $DEBT_COUNT"
# Unfilled placeholder detection
CLAUDE_MD="$ROOT/CLAUDE.md"
if [ -f "$CLAUDE_MD" ] && grep -q '{{' "$CLAUDE_MD" 2>/dev/null; then
  echo "Unfilled placeholders detected in CLAUDE.md."
  echo "Run /seed to auto-configure your project."
fi
echo "======================"
