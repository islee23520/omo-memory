# OMO Memory Guidelines

## Project Purpose

OMO Memory is a host-neutral local SQLite session/work ledger for OMO adapters. It is not specific to lfg, GrokBuild, Codex, or OpenCode.

## Architecture Rules

- Keep shared state under `~/.omo/memory/state.sqlite` by default.
- Keep host-specific data as metadata (`host`, `adapter`) rather than schema branches.
- Store summaries, decisions, task state, evidence references, and handoffs. Do not store full transcripts by default.
- Do not store API keys, tokens, `.env` contents, auth files, or raw secret-bearing logs.
- CLI and MCP must use the same core functions and schema.
- MCP tools must return structured JSON text and avoid side effects beyond explicit record/write commands.

## Development Commands

```sh
npm install
npm run build
npm run typecheck
node dist/cli.js init
node dist/cli.js mcp
```

## Issue Workflow

GitHub issues are the roadmap control surface. Epic issues must include:

- Goal
- Explicit out-of-scope boundaries
- CLI/MCP acceptance criteria
- Privacy/security acceptance criteria
- QA evidence commands
- Follow-up issue breakdown
