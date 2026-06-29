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
node dist/cli.js global scan --root ..
node dist/cli.js global migrate --root .. --global-db ~/.omo/memory/global.sqlite
node dist/cli.js session start --host grok --adapter lfg
node dist/cli.js event record --type decision --summary "Chose SQLite + MCP + CLI for OMO shared memory"
node dist/cli.js ontology candidates
node dist/cli.js ontology score
node dist/cli.js ontology recall --query "sqlite retention"
node dist/cli.js graph tui
node dist/cli.js recent
node dist/cli.js mcp
```

## Install

After the package is published to npm, use the same package for CLI and MCP:

```sh
npx -y omo-memory init
npx -y omo-memory update
npx -y omo-memory global scan --root .
npx -y omo-memory global migrate --root . --global-db ~/.omo/memory/global.sqlite
npx -y omo-memory session bootstrap --host codex --adapter lazycodex --limit 5
npx -y omo-memory ontology recall --query "why did we choose sqlite" --limit 5
npx -y omo-memory graph tui
npx -y omo-memory recent --limit 5
npx -y omo-memory recall --query "why did we choose sqlite" --limit 5
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

Adapters may call the bootstrap tool when they need a session id for later writes:

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

The response contains a new `sessionId` and project metadata only. It deliberately does not return recent memory, because starting a session should not inject the last session into every user prompt. Reuse that `sessionId` when recording follow-up events:

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

This is local routing, not transcript scraping. OMO Memory does not automatically read full Codex or Grok transcripts. Hooks should record concise user actions, decisions, QA evidence, and handoffs; they should retrieve memory only when the user explicitly asks for OMO Memory or when the current user input can be matched to recorded intent.
The packaged `scripts/omo-memory-user-prompt.mjs` helper is the supported UserPromptSubmit hook target for adapters that can invoke a command with the hook payload on stdin. It records only the current user prompt as a redacted `user_prompt` event, ignores assistant output, and exits successfully without blocking the host when OMO Memory is unavailable.

Use explicit retrieval for memory reads:

```sh
omo-memory recent --limit 5
omo-memory recall --query "schema migration decision" --limit 5
```

For MCP, use `memory_recent_events` for explicit recent-history requests and `memory_recall_events` for query-gated recall.

## MCP tools

Initial stdio MCP tools:

- `memory_init`
- `memory_project_context`
- `memory_start_session`
- `memory_bootstrap_session`
- `memory_record_event`
- `memory_recent_events`
- `memory_recall_events`
- `memory_write_handoff`
- `memory_export`
- `memory_purge`
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

## Updates

Installed CLI commands automatically launch a quiet background `npm install -g omo-memory@latest` at most once per day. MCP startup does not run the updater, so stdio handshakes stay clean.

Manual update:

```sh
omo-memory update
```

Disable automatic update for pinned environments:

```sh
OMO_MEMORY_AUTO_UPDATE=0 omo-memory doctor
```

## Second-brain layer

The base ledger remains project-local and chronological: sessions, events, handoffs, and explicit recall. The second-brain layer adds deterministic ontology tables and lifecycle commands:

- Global migration copies existing local `.omo/memory/state.sqlite` databases into one global SQLite store with source provenance and an aggregate OMO schema view. It does not delete or rewrite local project ledgers.
- Concept extraction turns concise event summaries into vocabulary candidates and reference counts.
- Retention scoring classifies memory as `forget`, `temporary`, `working`, `durable`, or `permanent`; manual pins force `permanent`.
- Durable memories can be promoted, demoted, superseded, and recalled through CLI or MCP.
- `omo-memory graph tui` opens an OpenTUI ontology graph viewer for concepts, relations, retention class, and detail panes. This command needs `bun` on `PATH` because OpenTUI's terminal renderer uses Bun native FFI; the rest of the CLI runs on Node.

Retention classes:

- `forget`: low-value or stale one-off context that can be dropped.
- `temporary`: short-term context useful during a narrow task.
- `working`: active project memory worth keeping across the current iteration.
- `durable`: cross-session knowledge that should survive normal decay.
- `permanent`: manually pinned or high-score knowledge; only explicit demote, supersede, or purge should change it.

Ontology lifecycle commands:

```sh
omo-memory ontology candidates
omo-memory ontology score
omo-memory ontology promote --concept linaforge --summary "Linaforge is an active game-engine project"
omo-memory ontology recall --query "linaforge"
omo-memory ontology demote --id <durable-id>
omo-memory ontology supersede --id <durable-id> --summary "Updated durable memory"
```

Global second-brain flow:

```sh
omo-memory global scan --root /Users/ilseoblee/workspace
omo-memory global migrate --root /Users/ilseoblee/workspace --global-db ~/.omo/memory/global.sqlite
OMO_MEMORY_DB=~/.omo/memory/global.sqlite omo-memory ontology candidates
OMO_MEMORY_DB=~/.omo/memory/global.sqlite omo-memory ontology score
bun --version
omo-memory graph tui --db ~/.omo/memory/global.sqlite --query linaforge
```

OpenTUI graph controls:

- `q`: quit.
- `Up` / `Down`: move selected concept.
- `Tab`: move to the next concept.
- `/` or `f`: focus filter input when supported by the terminal runtime.

The graph is terminal-native. It does not require a browser, web server, cloud service, or embeddings, but it does require Bun for the OpenTUI renderer.

## Non-goals for MVP

- No cloud sync.
- No full transcript capture by default.
- No secret storage.
- No adapter-specific host lock-in.
