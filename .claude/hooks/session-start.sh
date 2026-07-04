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

# Feature state
STATE_FILE="$ROOT/.state/feature-state.json"
FEATURE_STAGE="none"
FEATURE_NAME=""
if [ -f "$STATE_FILE" ] && [ -s "$STATE_FILE" ] && [ "$(cat "$STATE_FILE")" != "{}" ]; then
  FEATURE_NAME="$(grep -o '"feature_name"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" 2>/dev/null | head -1 | sed 's/.*: *"//;s/"//')"
  FEATURE_STAGE="$(grep -o '"stage"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" 2>/dev/null | head -1 | sed 's/.*: *"//;s/"//')"
fi

# Pending inbox files
INBOX_DIR="$ROOT/.state/inbox"
PENDING_INBOX=""
if [ -d "$INBOX_DIR" ]; then
  PENDING_INBOX="$(find "$INBOX_DIR" -maxdepth 1 -name '*.md' -not -empty -exec basename {} .md \; 2>/dev/null | sort)"
fi

# Output
echo "=== Session Context ==="
echo "Branch: $BRANCH ($DIRTY uncommitted changes)"
echo "Active plans: $PLAN_COUNT"
if [ -n "$PLANS" ]; then
  echo "$PLANS" | sed 's/^/  - /'
fi
echo "Tech debt items: $DEBT_COUNT"
if [ -n "$FEATURE_NAME" ]; then
  echo "Active feature: $FEATURE_NAME (stage: $FEATURE_STAGE)"
fi
if [ -n "$PENDING_INBOX" ]; then
  echo "Pending inbox:"
  echo "$PENDING_INBOX" | sed 's/^/  - /'
fi
# Unfilled placeholder detection
CLAUDE_MD="$ROOT/CLAUDE.md"
if [ -f "$CLAUDE_MD" ] && grep -q '{{' "$CLAUDE_MD" 2>/dev/null; then
  echo "Unfilled placeholders detected in CLAUDE.md."
  echo "Run /seed to auto-configure your project."
fi
echo "======================"
