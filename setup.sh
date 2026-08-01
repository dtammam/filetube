#!/usr/bin/env bash
# FileTube repo setup — wires git hooks, sets permissions, verifies structure.
# (Descended from the retired handoff-harness seeder; the .state/ pipeline
# expectations were removed in the 2026-08-01 harness cleanup.)
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "FileTube harness setup (lean mode)"
echo "=================================="
echo ""

# Set git hooks path
if git rev-parse --git-dir &>/dev/null; then
  git config core.hooksPath hooks
  echo "✓ Git hooks path set to hooks/"
else
  echo "⚠ Not a git repo — skipping hooks configuration"
fi

# Ensure hooks are executable (scripts/ is all .js now - the .sh chmod
# was dead code after the 2026-08-01 cleanup, gate S2)
chmod +x hooks/* 2>/dev/null && echo "✓ Git hooks marked executable" || true
chmod +x .claude/hooks/*.sh 2>/dev/null && echo "✓ Claude hooks marked executable" || true

# Verify directory structure
echo ""
echo "Verifying structure..."
EXPECTED_DIRS=(
  ".claude/agents"
  ".claude/commands"
  ".claude/hooks"
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
echo "==============================================="
echo "Hooks wired. Start a Claude Code session -"
echo "CLAUDE.md is the entry point (lean mode)."
echo "==============================================="
