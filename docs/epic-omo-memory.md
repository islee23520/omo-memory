# Epic: OMO Memory — shared local session/work ledger for OMO adapters

## Goal

Build a host-neutral local memory layer for OMO so lazycodex, omo-on-opencode, lfg, and future adapters can share task context, recorded decisions, QA evidence, event history, and handoffs across coding-tool sessions.

The product ships as both:

- CLI: install, inspect, global event import, search, export, purge, and handoff operations.
- MCP server: standard stdio tools for agents and coding tools to explicitly read/write OMO memory.

## Problem

OMO currently runs through multiple host adapters. Each host session can know what happened in its own conversation, but session decisions, QA results, failure reasons, next actions, and agent verdicts are not available to the next host/tool session in a reliable local-first format.

Codegraph solves code intelligence, not work/session memory. OMO needs a separate shared memory ledger.

## Product direction

- Project-local DB: `<project-root>/.omo/memory/state.sqlite`
- Optional global DB: user-selected SQLite path such as `~/.omo/memory/global.sqlite`, populated by copy/import from local project ledgers
- Project namespace: derive from git remote + repo root hash, with branch/head metadata
- Local-first privacy: no cloud sync and no secret storage by default
- Adapter-neutral schema: `host` and `adapter` are metadata, not separate products
- Shared API: CLI and MCP use the same core DB layer
- Explicit recall only: no automatic prompt injection, ontology extraction, graph TUI, concept extraction, retention scoring, or durable-memory lifecycle.

## In scope

- SQLite schema and migrations
- CLI commands:
  - `init`
  - `global scan`
  - `global migrate`
  - `global list`
  - `session start`
  - `session bootstrap`
  - `event record`
  - `recent`
  - `recall`
  - `handoff write`
  - `doctor`
  - `export`
  - `purge`

- MCP stdio server with tools:
  - `memory_init`
  - `memory_project_context`
  - `memory_bootstrap_session`
  - `memory_start_session`
  - `memory_record_event`
  - `memory_recent_events`
  - `memory_recall_events`
  - `memory_write_handoff`
  - `memory_global_scan`
  - `memory_global_migrate`
  - `memory_global_list`
  - `memory_export`
  - `memory_purge`

- Privacy guardrails:
  - local-only default
  - no API key/token/env capture
  - explicit purge/export commands
- Adapter integration notes for lazycodex, omo-on-opencode, and lfg
- Cross-project event import with source provenance through user-selected global SQLite files.

## Out of scope

- Cloud sync
- Team sharing by default
- Full transcript capture by default
- Vector/embedding search in MVP
- Ontology/concept extraction
- Graph UI, graph TUI, and OpenTUI
- Retention scoring or durable-memory curation lifecycle
- Automatic prompt injection from the last session
- Replacing codegraph
- Host-specific private APIs as required dependencies

## Acceptance criteria

### CLI

- `omo-memory init` creates or migrates `<project-root>/.omo/memory/state.sqlite`.
- `omo-memory global scan --root <path>` discovers project-local OMO DBs and reports schema versions.
- `omo-memory global migrate --root <path> --global-db <path>` copies source DB data into one global SQLite file without mutating source DBs.
- `omo-memory global list --global-db <path>` lists imported global event history with source provenance.
- `omo-memory session start --host grok --adapter lfg` records a session for the current project.
- `omo-memory session bootstrap --host codex --adapter lazycodex` returns a session id and project metadata without injecting recent events.
- `omo-memory event record --type decision --summary "..."` appends a project/session event.
- `omo-memory recent` lists recent project events.
- `omo-memory recall --query "..."` performs explicit query-gated event recall.
- `omo-memory handoff write --summary-file path.md` stores a handoff summary.
- `omo-memory doctor` reports DB path, schema version, and project identity.
- `omo-memory export` writes explicit local ledger export data.
- `omo-memory purge --yes` removes local ledger data only after explicit confirmation.


### MCP

- `omo-memory mcp` starts a stdio MCP server.
- MCP tools can initialize the DB, read project context, record events, list/retrieve explicit memory, write handoffs, export/purge local data, and scan/import/list global event memory.
- MCP tool responses are structured JSON text.
- `memory_bootstrap_session` remains write-only/session-only and does not return `recentEvents`.

### Privacy and safety

- No secrets are read from `.env`, auth files, or host config by default.
- DB path can be overridden only by explicit `OMO_MEMORY_DB`.
- `doctor` reports DB path, schema version, and project identity without leaking sensitive values.
- Global migration is copy/import only; source project DB mtimes and row counts must remain unchanged.
- Recall is local-first and explicit; no cloud sync, browser server, raw transcript capture, ontology extraction, graph UI, OpenTUI, retention scoring, durable-memory curation, or embeddings are required.

### QA evidence

- Focused CLI smoke covers init, global scan/migrate/list, session start/bootstrap, event record, recent, recall, handoff write, export, and purge.
- MCP smoke verifies `tools/list` includes the core `memory_*` ledger tools plus `memory_global_scan`, `memory_global_migrate`, and `memory_global_list`, and excludes `memory_ontology_*`.
- Global import smoke verifies source project DBs are copied/imported with provenance and not mutated.
- Documentation review verifies removed ontology, graph TUI/OpenTUI, concept extraction, retention scoring, and durable-memory curation surfaces are not documented as shipped features.

## Follow-up issue breakdown

1. Schema and migration core
2. CLI command surface
3. MCP stdio server
4. Project identity and git metadata
5. Privacy/redaction/purge/export
6. Global SQLite migration and source provenance
7. Adapter integration docs for lazycodex, omo-on-opencode, and lfg
8. QA harness for CLI, MCP, and global import smoke tests
9. Removal verification for ontology, graph TUI/OpenTUI, concept extraction, retention scoring, and durable-memory curation docs
