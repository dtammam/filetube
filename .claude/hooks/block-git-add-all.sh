#!/usr/bin/env bash
# PreToolUse(Bash) hook — hard-blocks blind git staging.
#
# The Standing norm in CLAUDE.md is "stage EXPLICIT paths only": a `git add -A`
# once swept scratch files into a release commit. This enforces it mechanically
# so the discipline can't lapse under time pressure. Exit 2 => the Bash call is
# refused and this message is fed back to the agent.
#
# It matches `git add`/`git commit` ONLY at a command position (start of a
# statement), never a mention inside a string/heredoc/commit message — otherwise
# a commit whose message DOCUMENTS this very rule would trip it (it did, once).
# Segments are split on newlines and shell separators; each segment's LEADING
# token is what's tested. python3 is a system binary (a hook cannot assume the
# fnm node PATH).

set -euo pipefail

payload="$(cat)"

cmd="$(printf '%s' "$payload" | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception:
    print("")
' 2>/dev/null || true)"

# Split into statement segments: original newlines already separate lines; also
# break on ; && || | & ( ) { } so chained/subshelled commands are seen head-on.
segments="$(printf '%s\n' "$cmd" | sed -E 's/(\|\||&&|[;&|(){}])/\n/g')"

blocked=0
while IFS= read -r seg; do
  # strip leading whitespace -> the segment's leading token is now at column 0.
  seg="${seg#"${seg%%[![:space:]]*}"}"
  [ -z "$seg" ] && continue
  # 1) git add -A / --all / .   (an explicit path like `git add ./x` is fine:
  #    `.` only trips when it is the WHOLE pathspec.)
  if printf '%s' "$seg" | grep -qE '^git[[:space:]]+add[[:space:]]+(-A|--all|\.)([[:space:]]|$)'; then
    echo "BLOCKED: 'git add -A/--all/.' is forbidden (CLAUDE.md git-hygiene norm)." >&2
    echo "Stage explicit paths, e.g. 'git add server.js public/js/common.js'." >&2
    blocked=2; break
  fi
  # 2) git commit with an auto-stage flag: a single-dash cluster containing 'a'
  #    (-a, -am, -va) or --all. --amend / --author / --allow-empty are NOT that.
  if printf '%s' "$seg" | grep -qE '^git[[:space:]]+commit([[:space:]]|$)' \
     && printf '%s' "$seg" | grep -qE '(^|[[:space:]])(-[A-Za-z]*a[A-Za-z]*|--all)([[:space:]]|$)'; then
    echo "BLOCKED: 'git commit -a' auto-stages tracked changes (CLAUDE.md git-hygiene norm)." >&2
    echo "Stage explicit paths first, then 'git commit' without -a." >&2
    blocked=2; break
  fi
done <<EOF
$segments
EOF

exit "$blocked"
