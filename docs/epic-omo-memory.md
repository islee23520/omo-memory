# Epic: OMO Memory — shared local session DB for OMO adapters

## Goal

Build a host-neutral local memory layer for OMO so lazycodex, omo-on-opencode, lfg, and future adapters can share task context across coding-tool sessions.

The product ships as both:

- CLI: install, inspect, search, export, purge, and handoff operations.
- MCP server: standard stdio tools for agents and coding tools to read/write OMO memory.

## Problem

OMO currently runs through multiple host adapters. Each host session can know what happened in its own conversation, but session decisions, QA results, failure reasons, next actions, and agent verdicts are not available to the next host/tool session in a reliable local-first format.

Codegraph solves code intelligence, not work/session memory. OMO needs a separate shared memory ledger.

## Product direction

- Project-local DB: `<project-root>/.omo/memory/state.sqlite`
- Project namespace: derive from git remote + repo root hash, with branch/head metadata
- Local-first privacy: no cloud sync and no secret storage by default
- Adapter-neutral schema: `host` and `adapter` are metadata, not separate products
- Shared API: CLI and MCP use the same core DB layer

## In scope

- SQLite schema and migrations
- CLI commands:
  - `init`
  - `session start`
  - `event record`
  - `recent`
  - `handoff write`
  - `doctor`
- MCP stdio server with tools:
  - `memory_init`
  - `memory_project_context`
  - `memory_record_event`
  - `memory_recent_events`
  - `memory_write_handoff`
- Privacy guardrails:
  - local-only default
  - no API key/token/env capture
  - explicit purge/export commands
- Adapter integration notes for lazycodex, omo-on-opencode, and lfg

## Out of scope

- Cloud sync
- Team sharing by default
- Full transcript capture by default
- Vector/embedding search in MVP
- Replacing codegraph
- Host-specific private APIs as required dependencies

## Acceptance criteria

### CLI

- `omo-memory init` creates or migrates `<project-root>/.omo/memory/state.sqlite`.
- `omo-memory session start --host grok --adapter lfg` records a session for the current project.
- `omo-memory event record --type decision --summary "..."` appends a project/session event.
- `omo-memory recent` lists recent project events.
- `omo-memory handoff write --summary-file path.md` stores a handoff summary.

### MCP

- `omo-memory mcp` starts a stdio MCP server.
- MCP tools can initialize the DB, read project context, record events, list recent events, and write handoffs.
- MCP tool responses are structured JSON text.

### Privacy and safety

- No secrets are read from `.env`, auth files, or host config by default.
- DB path can be overridden only by explicit `OMO_MEMORY_DB`.
- `doctor` reports DB path, schema version, and project identity without leaking sensitive values.

### QA evidence

- `npm run typecheck`
- `npm run build`
- CLI smoke:
  - `node dist/cli.js init`
  - `node dist/cli.js session start --host grok --adapter lfg`
  - `node dist/cli.js event record --type decision --summary "smoke"`
  - `node dist/cli.js recent`
- MCP smoke: start `node dist/cli.js mcp` and verify `tools/list` includes memory tools.

## Follow-up issue breakdown

1. Schema and migration core
2. CLI command surface
3. MCP stdio server
4. Project identity and git metadata
5. Privacy/redaction/purge/export
6. Adapter integration docs for lazycodex, omo-on-opencode, and lfg
7. QA harness for CLI and MCP smoke tests
