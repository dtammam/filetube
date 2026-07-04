#!/usr/bin/env bash
# Post-hydration setup — wires git hooks, sets permissions, verifies structure.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "handoff-harness setup"
echo "==================="
echo ""

# Set git hooks path
if git rev-parse --git-dir &>/dev/null; then
  git config core.hooksPath hooks
  echo "✓ Git hooks path set to hooks/"
else
  echo "⚠ Not a git repo — skipping hooks configuration"
fi

# Ensure scripts are executable
chmod +x scripts/*.sh 2>/dev/null && echo "✓ Scripts marked executable" || true
chmod +x hooks/* 2>/dev/null && echo "✓ Git hooks marked executable" || true
chmod +x .claude/hooks/*.sh 2>/dev/null && echo "✓ Claude hooks marked executable" || true

# Verify directory structure
echo ""
echo "Verifying structure..."
EXPECTED_DIRS=(
  ".claude/agents"
  ".claude/commands"
  ".claude/hooks"
  ".state/inbox"
  ".state/plans/active"
  ".state/plans/completed"
  ".state/plans/legacy"
  "docs/exec-plans/active"
  "docs/exec-plans/completed"
  "docs/references"
  "hooks"
  "scripts"
)

ALL_GOOD=true
for dir in "${EXPECTED_DIRS[@]}"; do
  if [ -d "$ROOT/$dir" ]; then
    echo "  ✓ $dir"
  else
    echo "  ✗ $dir MISSING"
    ALL_GOOD=false
  fi
done

echo ""
if $ALL_GOOD; then
  echo "Setup complete. All directories verified."
else
  echo "Setup complete with warnings — some directories are missing."
fi

echo ""
echo "Remaining setup:"
echo "  1. Adapt hooks/pre-commit and hooks/pre-push to your tech stack"
echo "  2. For brownfield repos: run the onboarding agent to generate"
echo "     ARCHITECTURE.md from your existing codebase"
echo ""
echo "==============================================="
echo "NEXT: Start a Claude Code session and run /seed"
echo "This will auto-detect your project and fill in"
echo "all {{placeholder}} values in your config files."
echo "==============================================="
