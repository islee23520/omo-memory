# Epic: OMO Memory — shared local second-brain DB for OMO adapters

## Goal

Build a host-neutral local memory layer for OMO so lazycodex, omo-on-opencode, lfg, and future adapters can share task context, durable decisions, and ontology-backed project knowledge across coding-tool sessions.

The product ships as both:

- CLI: install, inspect, global migration, ontology lifecycle, graph, search, export, purge, and handoff operations.
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
- Second-brain lifecycle: candidate extraction, deterministic retention scoring, promotion, demotion, supersession, explicit recall, and OpenTUI graph inspection

## In scope

- SQLite schema and migrations
- CLI commands:
  - `init`
  - `global scan`
  - `global migrate`
  - `session start`
  - `session bootstrap`
  - `event record`
  - `recent`
  - `recall`
  - `handoff write`
  - `doctor`
  - `ontology candidates`
  - `ontology score`
  - `ontology promote`
  - `ontology demote`
  - `ontology supersede`
  - `ontology recall`
  - `graph tui`
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
  - `memory_ontology_candidates`
  - `memory_ontology_extract`
  - `memory_ontology_score`
  - `memory_ontology_promote`
  - `memory_ontology_demote`
  - `memory_ontology_supersede`
  - `memory_ontology_recall`
- Privacy guardrails:
  - local-only default
  - no API key/token/env capture
  - explicit purge/export commands
- Adapter integration notes for lazycodex, omo-on-opencode, and lfg
- Retention classes:
  - `forget`: safe to drop after low score or decay
  - `temporary`: short-term task context
  - `working`: active project memory
  - `durable`: cross-session knowledge
  - `permanent`: manual-pin or high-score knowledge; only explicit demote/supersede/purge changes it

## Out of scope

- Cloud sync
- Team sharing by default
- Full transcript capture by default
- Vector/embedding search in MVP
- Browser-only graph UI
- Automatic prompt injection from the last session
- Replacing codegraph
- Host-specific private APIs as required dependencies

## Acceptance criteria

### CLI

- `omo-memory init` creates or migrates `<project-root>/.omo/memory/state.sqlite`.
- `omo-memory global scan --root <path>` discovers project-local OMO DBs and reports schema versions.
- `omo-memory global migrate --root <path> --global-db <path>` copies source DB data into one global SQLite file without mutating source DBs.
- `omo-memory session start --host grok --adapter lfg` records a session for the current project.
- `omo-memory session bootstrap --host codex --adapter lazycodex` returns a session id and project metadata without injecting recent events.
- `omo-memory event record --type decision --summary "..."` appends a project/session event.
- `omo-memory recent` lists recent project events.
- `omo-memory recall --query "..."` performs explicit query-gated event recall.
- `omo-memory handoff write --summary-file path.md` stores a handoff summary.
- `omo-memory ontology candidates` extracts vocabulary candidates from concise summaries.
- `omo-memory ontology score` recomputes deterministic retention classes.
- `omo-memory ontology promote/demote/supersede/recall` supports curated durable memory lifecycle.
- `omo-memory graph tui --db <path> --query <term>` opens an OpenTUI graph with `q` quit, arrow/tab selection, retention class, score, provenance, and detail pane. It requires `bun` on `PATH`; other CLI and MCP commands run on Node.

### MCP

- `omo-memory mcp` starts a stdio MCP server.
- MCP tools can initialize the DB, read project context, record events, list/retrieve explicit memory, write handoffs, migrate global memory, and manage ontology lifecycle.
- MCP tool responses are structured JSON text.
- `memory_bootstrap_session` remains write-only/session-only and does not return `recentEvents`.

### Privacy and safety

- No secrets are read from `.env`, auth files, or host config by default.
- DB path can be overridden only by explicit `OMO_MEMORY_DB`.
- `doctor` reports DB path, schema version, and project identity without leaking sensitive values.
- Global migration is copy/import only; source project DB mtimes and row counts must remain unchanged.
- Graph and recall are local-first and explicit; no cloud sync, browser server, raw transcript capture, or embeddings are required.

### QA evidence

- `npm run typecheck`
- `npm run build`
- `npm run check`
- CLI smoke:
  - `node dist/cli.js init`
  - `node dist/cli.js global scan --root <tmp-workspace>`
  - `node dist/cli.js global migrate --root <tmp-workspace> --global-db <tmp-global.sqlite>`
  - `node dist/cli.js session start --host grok --adapter lfg`
  - `node dist/cli.js event record --type decision --summary "smoke"`
  - `node dist/cli.js ontology candidates`
  - `node dist/cli.js ontology score`
  - `bun dist/cli.js graph tui --db <tmp-db> --query smoke`
  - `node dist/cli.js recent`
- MCP smoke: start `node dist/cli.js mcp` and verify `tools/list` includes memory tools.
- Backfill verifier: synthetic Linaforge/omo-memory/lfg/omo-phone DB replicas plus read-only scan of real local DB paths.

## Follow-up issue breakdown

1. Schema and migration core
2. CLI command surface
3. MCP stdio server
4. Project identity and git metadata
5. Privacy/redaction/purge/export
6. Global SQLite migration and source provenance
7. Deterministic ontology extraction and retention scoring
8. Durable memory promote/demote/supersede lifecycle
9. OpenTUI graph visualization
10. Adapter integration docs for lazycodex, omo-on-opencode, and lfg
11. QA harness for CLI, MCP, global backfill, and TUI smoke tests
