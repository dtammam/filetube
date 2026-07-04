#!/usr/bin/env bash
set -euo pipefail

AGENT=".claude/agents/product-manager.md"
INBOX=".state/inbox/product-manager.md"

if [ ! -f "$INBOX" ] || [ ! -s "$INBOX" ]; then
  echo "ERROR: No inbox file at $INBOX (or it's empty)."
  echo "The engineering-manager must write one first."
  exit 1
fi

echo "Invoking product-manager agent..."
echo "Inbox: $INBOX"
echo "---"

claude --agent "$AGENT" < "$INBOX"
