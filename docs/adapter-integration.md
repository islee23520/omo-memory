# Adapter Integration

OMO Memory is the shared local work ledger for OMO adapters. It is host-neutral: lazycodex, omo-on-opencode, lfg, and future adapters all write summaries, decisions, QA evidence, task state, and handoffs to the same local SQLite database at `~/.omo/memory/state.sqlite` by default.

No full transcript capture by default. Do not store API keys, tokens, `.env` contents, auth files, raw tool logs, auth headers, cookies, or any other secret-bearing material.

## Contract

- Use the shared CLI or MCP surface; do not create adapter-specific tables, schemas, or side databases.
- Keep `host` and `adapter` as session metadata. Use `host` for `codex`, `opencode`, `grok`, or `unknown`; use `adapter` for names such as `lazycodex`, `omo-on-opencode`, or `lfg`.
- Record concise events with a stable `type`, a human-readable `summary`, and optional redacted JSON metadata in `payloadJson`.
- Store handoffs as summary markdown that another host can read without needing the originating transcript.
- Treat CLI and MCP as two entrypoints to the same core functions and schema.
- Use `OMO_MEMORY_DB` only when the caller explicitly chooses a different database path, such as an isolated smoke test.

## Adapter Metadata

| Adapter | host | adapter | Typical use |
| --- | --- | --- | --- |
| lazycodex | `codex` | `lazycodex` | Codex session memory, decisions, QA evidence, and handoffs. |
| omo-on-opencode | `opencode` | `omo-on-opencode` | OpenCode-hosted OMO session memory. |
| lfg | `grok` | `lfg` | Grok/GrokBuild-oriented harness memory. |

## CLI Examples

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

Adapters that run through MCP start:

```sh
node dist/cli.js mcp
```

Use these tools:

- `memory_init`
- `memory_project_context`
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
