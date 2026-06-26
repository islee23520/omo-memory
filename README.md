# OMO Memory

OMO Memory is a host-neutral local session/work memory for OMO adapters.

It gives lazycodex, omo-on-opencode, lfg, and future OMO adapters a shared local SQLite ledger that can be accessed through both:

- `omo-memory` CLI for install, inspection, search, and handoff workflows.
- `omo-memory mcp` stdio server for coding tools and agents.

## Product shape

- Project-local DB: `<project-root>/.omo/memory/state.sqlite`
- Project namespacing: by git remote + project root hash
- Move handling: if a project directory moves with its `.omo` ledger, existing rows are migrated to the new root automatically.
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

## Install

After the package is published to npm, use the same package for CLI and MCP:

```sh
npx -y omo-memory init
npx -y omo-memory session bootstrap --host codex --adapter lazycodex --limit 5
npx -y omo-memory recent --limit 5
npx -y omo-memory mcp
```

For local development before publish:

```sh
npm install
npm run build
npm link
omo-memory init
```

## MCP registration

Register the same MCP server in every host that should read/write the current project's memory DB.

Codex:

```sh
codex mcp add omo-memory -- npx -y omo-memory mcp
```

Grok:

```sh
grok mcp add omo-memory -- npx -y omo-memory mcp
```

Both hosts use the current project ledger at `<project-root>/.omo/memory/state.sqlite` by default. The `host` value is recorded when an adapter calls `memory_start_session`, not by installing separate servers.

## Session bootstrap

Adapters should call the bootstrap tool at the beginning of each host session:

```json
{
  "tool": "memory_bootstrap_session",
  "arguments": {
    "host": "codex",
    "adapter": "lazycodex",
    "limit": 5
  }
}
```

The response contains a new `sessionId` plus `recentEvents` for the current project. Reuse that `sessionId` when recording follow-up events:

```json
{
  "tool": "memory_record_event",
  "arguments": {
    "type": "decision",
    "summary": "Chose the npm MCP package as the shared local memory surface.",
    "sessionId": "<sessionId>"
  }
}
```

This is local routing, not transcript scraping. OMO Memory does not automatically read full Codex or Grok transcripts; the host or adapter must call these MCP tools.

## MCP tools

Initial stdio MCP tools:

- `memory_init`
- `memory_project_context`
- `memory_start_session`
- `memory_bootstrap_session`
- `memory_record_event`
- `memory_recent_events`
- `memory_write_handoff`
- `memory_export`
- `memory_purge`

## Non-goals for MVP

- No cloud sync.
- No full transcript capture by default.
- No secret storage.
- No adapter-specific host lock-in.
