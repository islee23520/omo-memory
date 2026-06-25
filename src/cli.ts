#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { doctorReport, exportMemory, initMemory, purgeMemory, recentEvents, recordEvent, startSession, writeHandoff } from "./memory.js";
import { runMcpServer } from "./mcp.js";
import type { HostName } from "./types.js";

type CommandResult = {
  readonly ok: boolean;
  readonly [key: string]: unknown;
};

async function main(argv: readonly string[]): Promise<void> {
  const [command, subcommand, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "mcp") {
    await runMcpServer();
    return;
  }

  const result = runCommand(command, subcommand, rest);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function runCommand(command: string, subcommand: string | undefined, rest: readonly string[]): CommandResult {
  if (command === "init") {
    return { ok: true, ...initMemory() };
  }

  if (command === "doctor") {
    return { ok: true, ...doctorReport() };
  }

  if (command === "export") {
    return { ok: true, ...exportMemory() };
  }

  if (command === "purge") {
    const args = [subcommand, ...rest].filter((value): value is string => value !== undefined);
    return { ok: true, ...purgeMemory({ yes: args.includes("--yes") }) };
  }

  if (command === "session" && subcommand === "start") {
    const host = parseHost(readFlag(rest, "--host") ?? "unknown");
    const adapter = readFlag(rest, "--adapter") ?? "unknown";
    return { ok: true, ...startSession({ host, adapter }) };
  }

  if (command === "event" && subcommand === "record") {
    const type = readFlag(rest, "--type") ?? fail("event record requires --type");
    const summary = readFlag(rest, "--summary") ?? fail("event record requires --summary");
    const payloadJson = readFlag(rest, "--payload-json");
    const sessionId = readFlag(rest, "--session-id");
    return { ok: true, ...recordEvent({ type, summary, ...(payloadJson === undefined ? {} : { payloadJson }), ...(sessionId === undefined ? {} : { sessionId }) }) };
  }

  if (command === "recent") {
    const limitRaw = readFlag([subcommand, ...rest].filter((value): value is string => value !== undefined), "--limit");
    const limit = limitRaw === undefined ? 10 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit <= 0) fail("recent --limit must be a positive integer");
    return { ok: true, events: recentEvents(limit) };
  }

  if (command === "handoff" && subcommand === "write") {
    const summary = readFlag(rest, "--summary");
    const summaryFile = readFlag(rest, "--summary-file");
    const sessionId = readFlag(rest, "--session-id");
    const summaryMd = summary ?? (summaryFile === undefined ? undefined : readFileSync(summaryFile, "utf8")) ?? fail("handoff write requires --summary or --summary-file");
    return { ok: true, ...writeHandoff(summaryMd, sessionId) };
  }

  fail(`unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function parseHost(value: string): HostName {
  if (value === "codex" || value === "opencode" || value === "grok" || value === "unknown") return value;
  fail("--host must be one of codex, opencode, grok, unknown");
}

function fail(message: string): never {
  throw new Error(message);
}

function printHelp(): void {
  process.stdout.write(`OMO Memory\n\nCommands:\n  omo-memory init\n  omo-memory doctor\n  omo-memory export\n  omo-memory purge --yes\n  omo-memory session start --host <codex|opencode|grok|unknown> --adapter <name>\n  omo-memory event record --type <type> --summary <text> [--session-id <id>]\n  omo-memory recent [--limit <n>]\n  omo-memory handoff write (--summary <text> | --summary-file <path>) [--session-id <id>]\n  omo-memory mcp\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
