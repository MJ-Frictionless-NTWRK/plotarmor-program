#!/usr/bin/env bash
# Workaround for a known Claude Code bug where HTTP-transport MCP tools
# (here: solana-mcp's program_autofixer) never surface via the native
# ToolSearch/tool-calling path in a long-running interactive session, even
# though the server connects fine and a one-shot `claude -p` process can
# reach it. See CLAUDE.md "program_autofixer" entries for the investigation
# and matching upstream GitHub issues (anthropics/claude-code #39167, #38245).
#
# This calls the real, live solana-mcp server directly over the same
# JSON-RPC/HTTP protocol Claude Code's MCP client uses. It is not a
# simulation -- the response is the actual tool's actual output.
#
# Usage: scripts/check_program_autofixer.sh
# Requires: curl, python3

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/programs/plotarmor/src"
MCP_URL="https://mcp.solana.com/mcp"

python3 - "$SRC_DIR" <<'PYEOF'
import json
import sys
import glob
import os
import subprocess

src_dir = sys.argv[1]
files = sorted(glob.glob(os.path.join(src_dir, "**", "*.rs"), recursive=True))
if not files:
    print(f"No .rs files found under {src_dir}", file=sys.stderr)
    sys.exit(1)

parts = []
for f in files:
    rel = os.path.relpath(f, src_dir)
    with open(f) as fh:
        content = fh.read()
    parts.append(f"// ==== FILE: {rel} ====\n" + content)

full_code = "\n\n".join(parts)
print(f"Concatenated {len(files)} files, {len(full_code)} bytes:", file=sys.stderr)
for f in files:
    print("  -", os.path.relpath(f, src_dir), file=sys.stderr)

payload = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
        "name": "program_autofixer",
        "arguments": {
            "code": full_code,
            "filename": "plotarmor_full_program_concat.rs",
            "framework": "anchor",
        },
    },
}

result = subprocess.run(
    [
        "curl", "-s", "-X", "POST", "https://mcp.solana.com/mcp",
        "-H", "Content-Type: application/json",
        "-H", "Accept: application/json, text/event-stream",
        "--data-binary", "@-",
    ],
    input=json.dumps(payload),
    capture_output=True,
    text=True,
    check=True,
)
print(result.stdout)
PYEOF
