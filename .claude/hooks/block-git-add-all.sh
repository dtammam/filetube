#!/usr/bin/env bash
# PreToolUse(Bash) hook — hard-blocks blind git staging.
#
# The Standing norm in CLAUDE.md is "stage EXPLICIT paths only": a `git add -A`
# once swept scratch files into a release commit. This enforces it mechanically
# so the discipline can't lapse under time pressure. Exit 2 => the Bash call is
# refused and the message is fed back to the agent; exit 0 => allowed.
#
# It must match `git add`/`git commit` ONLY at a real command position, never a
# mention inside a string or heredoc BODY — this repo commits via `git commit
# -F -` heredocs whose messages DOCUMENT this very rule (clauses literally begin
# "git add -A", "git commit -a"). So before scanning we drop heredoc bodies
# (data, not commands), then split the rest into statement segments and test
# each segment's LEADING token. python3 is a system binary (a hook cannot assume
# the fnm node PATH). The payload arrives on stdin as
# {"tool_name":"Bash","tool_input":{"command":"..."}}.

set -euo pipefail

payload="$(cat)"

# The script is read from stdin (`python3 -`); the payload is passed as argv[1]
# so heredoc/quote contents in the command can never collide with the script.
exec python3 - "$payload" <<'PY'
import sys, json, re

try:
    cmd = (json.loads(sys.argv[1]).get("tool_input") or {}).get("command", "") or ""
except Exception:
    sys.exit(0)  # unparseable payload -> don't block

# 1) Drop heredoc BODIES. Keep the opener line (the real command); skip the body
#    lines and the closing delimiter so a commit message documenting the rule is
#    never scanned as if it were commands.
lines = cmd.split("\n")
kept, i = [], 0
opener = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_]\w*)\1")
while i < len(lines):
    line = lines[i]
    kept.append(line)
    m = opener.search(line)
    if m:
        delim, dedent = m.group(2), ("<<-" in line)
        i += 1
        while i < len(lines):
            probe = lines[i].lstrip("\t") if dedent else lines[i]
            if probe.strip() == delim:
                break            # drop the closing delimiter line too
            i += 1
    i += 1
scrubbed = "\n".join(kept)

# 2) Split into statement segments and test each segment's leading token.
segments = re.split(r"\|\||&&|[\n;&|(){}]", scrubbed)
add_bad     = re.compile(r"^git\s+add\s+(-A|--all|\.)(\s|$)")
commit_head = re.compile(r"^git\s+commit(\s|$)")
# an auto-stage flag: a single-dash cluster containing 'a' (-a,-am,-va) or --all.
# --amend / --author / --allow-empty are NOT that (the leading -- blocks the
# single-dash alt, and none equal --all).
autostage   = re.compile(r"(^|\s)(-[A-Za-z]*a[A-Za-z]*|--all)(\s|$)")

for seg in segments:
    seg = seg.strip()
    if not seg:
        continue
    if add_bad.search(seg):
        sys.stderr.write("BLOCKED: 'git add -A/--all/.' is forbidden (CLAUDE.md git-hygiene norm).\n")
        sys.stderr.write("Stage explicit paths, e.g. 'git add server.js public/js/common.js'.\n")
        sys.exit(2)
    if commit_head.search(seg) and autostage.search(seg):
        sys.stderr.write("BLOCKED: 'git commit -a' auto-stages tracked changes (CLAUDE.md git-hygiene norm).\n")
        sys.stderr.write("Stage explicit paths first, then 'git commit' without -a.\n")
        sys.exit(2)

sys.exit(0)
PY
