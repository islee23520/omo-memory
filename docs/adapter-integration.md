# Adapter Integration

OMO Memory is the shared local work ledger for OMO adapters. It is host-neutral: lazycodex, omo-on-opencode, lfg, and future adapters all write summaries, decisions, QA evidence, task state, and handoffs to the same project-local SQLite database at `<project-root>/.omo/memory/state.sqlite` by default.

No full transcript capture by default. Do not store API keys, tokens, `.env` contents, auth files, raw tool logs, auth headers, cookies, or any other secret-bearing material.

## Contract

- Use the shared CLI or MCP surface; do not create adapter-specific tables, schemas, or side databases.
- Keep `host` and `adapter` as session metadata. Use `host` for `codex`, `opencode`, `grok`, or `unknown`; use `adapter` for names such as `lazycodex`, `omo-on-opencode`, or `lfg`.
- Record concise events with a stable `type`, a human-readable `summary`, and optional redacted JSON metadata in `payloadJson`.
- Store handoffs as summary markdown that another host can read without needing the originating transcript.
- Treat CLI and MCP as two entrypoints to the same core functions and schema.
- When a project directory moves with its `.omo` ledger, OMO Memory migrates matching project rows to the new root automatically.
- Use `OMO_MEMORY_DB` only when the caller explicitly chooses a different database path, such as an isolated smoke test.

## Adapter Metadata

| Adapter | host | adapter | Typical use |
| --- | --- | --- | --- |
| lazycodex | `codex` | `lazycodex` | Codex session memory, decisions, QA evidence, and handoffs. |
| omo-on-opencode | `opencode` | `omo-on-opencode` | OpenCode-hosted OMO session memory. |
| lfg | `grok` | `lfg` | Grok/GrokBuild-oriented harness memory. |

## CLI Examples

After npm publish, adapters and users can invoke the packaged CLI directly:

```sh
npx -y omo-memory init
npx -y omo-memory session bootstrap --host codex --adapter lazycodex --limit 5
npx -y omo-memory session start --host codex --adapter lazycodex
npx -y omo-memory session start --host grok --adapter lfg
npx -y omo-memory recent --limit 10
```

For a source checkout:

```sh
node dist/cli.js init
node dist/cli.js session start --host codex --adapter lazycodex
node dist/cli.js session start --host opencode --adapter omo-on-opencode
node dist/cli.js session start --host grok --adapter lfg
node dist/cli.js event record --type decision --summary "Use OMO Memory as the shared local ledger."
node dist/cli.js event record --type qa_evidence --summary "CLI smoke passed for init/session/event/recent."
node dist/cli.js handoff write --summary "Continue from recent decision and qa_evidence events."
node dist/cli.js recent --limit 10
node dist/cli.js export
node dist/cli.js purge --yes
```

For isolated adapter tests:

```sh
OMO_MEMORY_DB="$(mktemp -u /tmp/omo-memory.XXXXXX.sqlite)" node dist/cli.js init
```

## MCP Tools

Adapters that run through MCP should register the packaged command after npm publish:

```sh
npx -y omo-memory mcp
```

For a source checkout:

```sh
node dist/cli.js mcp
```

Codex registration:

```sh
codex mcp add omo-memory -- npx -y omo-memory mcp
```

Grok registration:

```sh
grok mcp add omo-memory -- npx -y omo-memory mcp
```

Register the same MCP server in every host that needs memory access. Do not create separate Codex/Grok schemas or databases; host identity belongs in `memory_start_session` metadata.

## Session Bootstrap Flow

At the beginning of a Codex, OpenCode, or Grok adapter session, call `memory_bootstrap_session` instead of separately calling `memory_start_session` and `memory_recent_events`.

```json
{
  "tool": "memory_bootstrap_session",
  "arguments": {
    "host": "grok",
    "adapter": "lfg",
    "limit": 5
  }
}
```

The tool returns:

- `sessionId`: the new session row for subsequent event/handoff writes.
- `project`: the current git/project namespace.
- `recentEvents`: recent events from the same project namespace.

During the session, write concise task state and evidence with the returned `sessionId`:

```json
{
  "tool": "memory_record_event",
  "arguments": {
    "type": "qa_evidence",
    "summary": "npm-published MCP exposed memory_bootstrap_session and memory_recent_events.",
    "sessionId": "<sessionId>"
  }
}
```

This package is the local MCP-to-SQLite router. It does not scrape host transcripts or centralize cloud state. Hosts and adapters must call the MCP tools at their own lifecycle points.

Use these tools:

- `memory_init`
- `memory_project_context`
- `memory_bootstrap_session`
- `memory_start_session`
- `memory_record_event`
- `memory_recent_events`
- `memory_write_handoff`
- `memory_export`
- `memory_purge`

Example session start:

```json
{
  "tool": "memory_start_session",
  "arguments": {
    "host": "codex",
    "adapter": "lazycodex"
  }
}
```

Example QA evidence:

```json
{
  "tool": "memory_record_event",
  "arguments": {
    "type": "qa_evidence",
    "summary": "MCP tools/list included memory_export and memory_purge."
  }
}
```

## Privacy Review

- No full transcript capture by default.
- Do not read or record `.env`, auth files, tokens, cookies, API keys, bearer headers, or raw secret-bearing logs.
- Store sanitized summaries and evidence references instead of full logs.
- Host-specific values may appear only in small redacted metadata payloads and must not require schema branches.
- Export and purge are explicit lifecycle commands; purge requires explicit confirmation.

## Ontology Schema Boundary

OMO Memory's chronological ledger remains authoritative: sessions, events, and handoffs record what happened in a project. The ontology schema is an additive layer for durable memory derived from that ledger:

- `concepts` stores vocabulary entries such as project terms, practices, tools, and recurring ideas.
- `relations` stores typed links between concepts, decisions, events, sessions, and handoffs.
- `durable_memories` stores approved long-term facts, preferences, and working rules.
- `decision_records` stores important choices with rationale, evidence, status, reversibility, and provenance.

Adapters must treat ontology rows as curated local memory, not as raw capture. Do not write full transcripts, raw logs, `.env` contents, auth files, cookies, bearer headers, or secret-bearing payloads into ontology tables. User-authored text must pass through the same redaction boundary used by event and handoff writes before it is promoted into durable memory.

The ontology layer is intentionally not a new adapter surface by itself. CLI and MCP commands should continue to call shared core functions, and future concept/decision commands must not create host-specific schemas or side databases.
