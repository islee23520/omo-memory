# OMO Memory

OMO Memory is a host-neutral local session/work memory for OMO adapters.

It gives lazycodex, omo-on-opencode, lfg, and future OMO adapters a shared local SQLite ledger that can be accessed through both:

- `omo-memory` CLI for install, inspection, search, and handoff workflows.
- `omo-memory mcp` stdio server for coding tools and agents.

## Product shape

- Global local DB: `~/.omo/memory/state.sqlite`
- Project namespacing: by git remote + project root hash
- Privacy default: local-only, no network sync, no secrets by design
- Intended adapters: Codex/lazycodex, OpenCode/OMO, GrokBuild/lfg

## MVP commands

```sh
npm install
npm run build
node dist/cli.js init
node dist/cli.js session start --host grok --adapter lfg
node dist/cli.js event record --type decision --summary "Chose SQLite + MCP + CLI for OMO shared memory"
node dist/cli.js recent
node dist/cli.js mcp
```

## MCP tools

Initial stdio MCP tools:

- `memory_init`
- `memory_project_context`
- `memory_record_event`
- `memory_recent_events`
- `memory_write_handoff`

## Non-goals for MVP

- No cloud sync.
- No full transcript capture by default.
- No secret storage.
- No adapter-specific host lock-in.
