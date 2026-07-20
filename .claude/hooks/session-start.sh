#!/bin/bash
# SessionStart hook: keep the graphify code knowledge graph fresh.
# Installs the graphify CLI if missing, then rebuilds graphify-out/graph.json
# from the source tree (local tree-sitter AST extraction — no API key needed).
set -uo pipefail

# Only run in Claude Code on the web (remote) sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
export PATH="$HOME/.local/bin:$PATH"

# Ensure the graphify CLI is available. PyPI package is `graphifyy`; command is `graphify`.
if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install graphifyy 1>&2 || echo "graphify: install via uv failed (non-fatal)" 1>&2
  else
    python3 -m pip install --user graphifyy 1>&2 || echo "graphify: pip install failed (non-fatal)" 1>&2
  fi
fi

# Rebuild the code knowledge graph. Noisy logs go to stderr; one breadcrumb to stdout.
if command -v graphify >/dev/null 2>&1; then
  if graphify update . 1>&2; then
    echo 'graphify: knowledge graph ready in graphify-out/ — query it with: graphify query "<question>" (also: explain, path, affected)'
  else
    echo "graphify: graph rebuild failed (non-fatal); run 'graphify update .' manually" 1>&2
  fi
else
  echo "graphify: CLI unavailable; knowledge graph not built" 1>&2
fi
