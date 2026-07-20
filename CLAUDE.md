# TrackFlow

Multi-tenant GPS-tracking SaaS (pnpm + turbo monorepo). See [README.md](README.md) for architecture
and [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) for the current status + roadmap.

## Knowledge graph (graphify)

This repo is indexed with [graphify](https://graphify.net): a queryable knowledge graph of the codebase
(symbols, files, and their relationships) lives in `graphify-out/graph.json`. It is rebuilt locally on
every web session by `.claude/hooks/session-start.sh` (tree-sitter AST extraction — no API key needed),
so it stays in sync with the code. `graphify-out/` is gitignored.

Prefer querying the graph before broad code search when you need to understand how things connect:

```bash
graphify query "how does a GPS position flow from ingest to the live map?"
graphify explain "recordPosition"          # a symbol and its neighbors
graphify path "withTenant" "positions"     # shortest path between two nodes
graphify affected "recordPosition"          # what breaks if this changes
```

If the CLI is missing (e.g. local session), install it with `uv tool install graphifyy` and build with
`graphify update .`.
