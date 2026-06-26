# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-25
**Commit:** d8b5a2d
**Branch:** main

## OVERVIEW

OMO Memory is a host-neutral local SQLite session/work ledger for OMO adapters, exposed through one shared TypeScript core plus CLI and MCP surfaces. It is local-first: no cloud sync, no full transcript capture, no secret storage by design.

## STRUCTURE

```text
omo-memory/
├── src/          # TypeScript source; flat module layout
├── scripts/      # smoke tests and GitHub epic issue helper
├── docs/         # adapter contract + roadmap epic
├── dist/         # generated JS from npm run build
├── package.json  # bin/scripts/dependencies
└── tsconfig.json # strict NodeNext compiler settings
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add or change CLI command | `src/cli.ts` | Dispatches `omo-memory ...`; JSON stdout shape is part of smoke coverage. |
| Add or change MCP tool | `src/mcp.ts` | MCP tools must call shared core and return structured JSON text. |
| Change persistence/schema | `src/memory.ts` | SQLite schema, migrations, project namespace, CRUD/export/purge live here. |
| Change privacy behavior | `src/privacy.ts` | Redaction and git remote sanitization. Update smoke redaction assertions too. |
| Change public data shape | `src/types.ts` | Shared CLI/MCP/core types. Keep host-neutral. |
| Validate CLI behavior | `scripts/smoke-cli.mjs` | Uses temp `OMO_MEMORY_DB`, exercises lifecycle + redaction + legacy purge. |
| Validate MCP behavior | `scripts/smoke-mcp.mjs` | JSON-RPC roundtrip, tool list/calls, redaction, purge. |
| Adapter contract | `docs/adapter-integration.md` | Privacy and integration boundaries for hosts/adapters. |
| Roadmap/epic text | `docs/epic-omo-memory.md` | Issue source for `npm run issue:epic`. |

## CODE MAP

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `main` | function | `src/cli.ts` | entry | Parses argv; routes `mcp` or JSON CLI commands. |
| `runCommand` | function | `src/cli.ts` | CLI | Maps commands to core memory functions. |
| `runMcpServer` | function | `src/mcp.ts` | MCP | Registers `memory_*` tools on stdio server. |
| `initMemory` | function | `src/memory.ts` | CLI/MCP | Opens DB and runs migration. |
| `migrate` | function | `src/memory.ts` | core | Creates `schema_meta`, `projects`, `sessions`, `events`, `handoffs`. |
| `resolveProjectContext` | function | `src/memory.ts` | core | Computes namespace from git remote + repo root hash; sanitizes remote for output. |
| `startSession` | function | `src/memory.ts` | CLI/MCP | Writes session rows with `host`, `adapter`, branch/head metadata. |
| `recordEvent` | function | `src/memory.ts` | CLI/MCP | Writes redacted event summaries/payloads. |
| `recentEvents` | function | `src/memory.ts` | CLI/MCP | Read-only event listing for current project. |
| `writeHandoff` | function | `src/memory.ts` | CLI/MCP | Writes redacted handoff markdown. |
| `exportMemory` | function | `src/memory.ts` | CLI/MCP | Exports current project sessions/events/handoffs. |
| `purgeMemory` | function | `src/memory.ts` | CLI/MCP | Deletes current project rows; requires explicit confirmation. |
| `redactSecrets` | function | `src/privacy.ts` | core | Replaces secret-looking text with `[REDACTED]`. |
| `sanitizeGitRemote` | function | `src/privacy.ts` | core | Removes credentials from git remote output. |
| `HostName` | type | `src/types.ts` | public | Allowed host metadata: `codex`, `opencode`, `grok`, `unknown`. |

## CONVENTIONS

- Node >=20, ESM (`"type": "module"`), TypeScript `NodeNext`.
- `tsconfig.json` is intentionally strict: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`.
- Source imports use `.js` extensions in TypeScript because output is ESM.
- Flat `src/` is intentional; do not create adapter-specific source trees unless the core abstraction changes.
- Default DB path is `<project-root>/.omo/memory/state.sqlite`; tests and tools override only with explicit `OMO_MEMORY_DB`.
- CLI and MCP must use the same functions in `src/memory.ts`; do not fork behavior per surface.
- JSON CLI responses use `ok: true` plus command-specific fields.
- MCP responses are JSON text payloads; side effects only for explicit write/record/purge tools.

## ANTI-PATTERNS (THIS PROJECT)

- Do not store API keys, tokens, `.env` contents, auth files, cookies, bearer headers, raw tool logs, or raw secret-bearing material.
- Do not capture full transcripts by default; store summaries, decisions, task state, evidence references, and handoffs.
- Do not branch the SQLite schema by host or adapter; keep `host` and `adapter` as metadata.
- Do not create side databases or adapter-specific tables for host integrations.
- Do not let read-only commands recreate project rows after purge; smoke CLI checks this.
- Do not expose token-bearing git remotes; sanitize output and keep legacy purge behavior working.

## UNIQUE STYLES

- Privacy behavior is smoke-tested by deliberately injecting token-like strings and asserting `[REDACTED]` in CLI/MCP outputs.
- Purge covers both current sanitized project identity and legacy raw-remote rows.
- `scripts/smoke-mcp.mjs` asserts no stderr from the MCP server.
- GitHub issues are the roadmap surface; epic text lives in `docs/epic-omo-memory.md` and is published by `scripts/create-epic-issue.mjs`.

## COMMANDS

```sh
npm install
npm run build
npm run typecheck
npm run smoke
npm run smoke:cli
npm run smoke:mcp
node dist/cli.js init
node dist/cli.js session start --host grok --adapter lfg
node dist/cli.js event record --type decision --summary "Chose SQLite + MCP + CLI for OMO shared memory"
node dist/cli.js recent
node dist/cli.js mcp
```

## NOTES

- There is no `.github/workflows/`, Makefile, unit test framework, ESLint, or Prettier config in this repo today.
- `dist/` mirrors `src/` after `npm run build`; edit `src/`, not generated `dist/`, unless explicitly preparing checked-in build output.
- `docs/adapter-integration.md` is the clearest source for host adapter boundaries and forbidden data capture.
