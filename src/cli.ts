#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { maybeRunAutoUpdate, runAutoUpdate } from "./autoUpdate.js";
import { applyConceptExtraction } from "./conceptExtraction.js";
import { migrateToGlobalMemory, scanForMemoryDbs } from "./globalMemory.js";
import { runGraphTui } from "./graphTui.js";
import { runMcpServer } from "./mcp.js";
import { bootstrapSession, exportMemory, purgeMemory, recentEvents, recordEvent, startSession, writeHandoff } from "./memory.js";
import { initMemory } from "./memoryDb.js";
import { recallEvents } from "./memoryRecall.js";
import { doctorReport } from "./memoryReport.js";
import { createDurableMemory, listOntologyRows, recordMemoryReference, supersedeDurableMemory, updateDurableRetention } from "./ontologyCore.js";
import { defaultDbPath } from "./projectContext.js";
import { recomputeRetentionScores } from "./retentionRecompute.js";
import type { ConceptExportRow, DurableMemoryExportRow, HostName } from "./types.js";

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

  const currentVersion = readPackageVersion();
  if (command === "update") {
    process.stdout.write(`${JSON.stringify(runAutoUpdate(currentVersion), null, 2)}\n`);
    return;
  }
  maybeRunAutoUpdate(currentVersion);

  if (command === "graph" && subcommand === "tui") {
    const query = readFlag(rest, "--query");
    await runGraphTui({ dbPath: readFlag(rest, "--db") ?? defaultDbPath(), ...(query === undefined ? {} : { query }) });
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

  if (command === "global") {
    return runGlobalCommand(subcommand, rest);
  }

  if (command === "ontology") {
    return runOntologyCommand(subcommand, rest);
  }

  if (command === "session" && subcommand === "start") {
    const host = parseHost(readFlag(rest, "--host") ?? "unknown");
    const adapter = readFlag(rest, "--adapter") ?? "unknown";
    return { ok: true, ...startSession({ host, adapter }) };
  }

  if (command === "session" && subcommand === "bootstrap") {
    const host = parseHost(readFlag(rest, "--host") ?? "unknown");
    const adapter = readFlag(rest, "--adapter") ?? "unknown";
    return { ok: true, ...bootstrapSession({ host, adapter, limit: readPositiveIntFlag(rest, "--limit", 5) }) };
  }

  if (command === "event" && subcommand === "record") {
    const type = readFlag(rest, "--type") ?? fail("event record requires --type");
    const summary = readFlag(rest, "--summary") ?? fail("event record requires --summary");
    const payloadJson = readFlag(rest, "--payload-json");
    const sessionId = readFlag(rest, "--session-id");
    return {
      ok: true,
      ...recordEvent({ type, summary, ...(payloadJson === undefined ? {} : { payloadJson }), ...(sessionId === undefined ? {} : { sessionId }) }),
    };
  }

  if (command === "recent") {
    const limitRaw = readFlag(
      [subcommand, ...rest].filter((value): value is string => value !== undefined),
      "--limit",
    );
    return { ok: true, events: recentEvents(parsePositiveInt(limitRaw, "recent --limit")) };
  }

  if (command === "recall") {
    const args = [subcommand, ...rest].filter((value): value is string => value !== undefined);
    const query = readFlag(args, "--query") ?? fail("recall requires --query");
    return { ok: true, events: recallEvents({ query, limit: readPositiveIntFlag(args, "--limit", 10) }) };
  }

  if (command === "handoff" && subcommand === "write") {
    const summary = readFlag(rest, "--summary");
    const summaryFile = readFlag(rest, "--summary-file");
    const sessionId = readFlag(rest, "--session-id");
    const summaryMd =
      summary ?? (summaryFile === undefined ? undefined : readFileSync(summaryFile, "utf8")) ?? fail("handoff write requires --summary or --summary-file");
    return { ok: true, ...writeHandoff(summaryMd, sessionId) };
  }

  fail(`unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

function runGlobalCommand(subcommand: string | undefined, rest: readonly string[]): CommandResult {
  if (subcommand === "scan") {
    const rootPath = readFlag(rest, "--root") ?? fail("global scan requires --root");
    return { ok: true, ...scanForMemoryDbs(rootPath) };
  }
  if (subcommand === "migrate") {
    const rootPath = readFlag(rest, "--root") ?? fail("global migrate requires --root");
    const globalDbPath = readFlag(rest, "--global-db") ?? fail("global migrate requires --global-db");
    return { ok: true, ...migrateToGlobalMemory({ rootPath, globalDbPath }) };
  }
  fail(`unknown command: global ${subcommand ?? ""}`.trim());
}

function runOntologyCommand(subcommand: string | undefined, rest: readonly string[]): CommandResult {
  const dbPath = defaultDbPath();
  if (subcommand === "candidates") return ontologyCandidates(dbPath);
  if (subcommand === "score" || subcommand === "recompute") {
    return { ok: true, ...recomputeRetentionScores({ dbPath, nowIso: new Date().toISOString() }) };
  }
  if (subcommand === "promote") return ontologyPromote(dbPath, rest);
  if (subcommand === "demote") {
    const id = readFlag(rest, "--id") ?? fail("ontology demote requires --id");
    return { ok: true, durableMemory: updateDurableRetention(dbPath, exportMemory(dbPath).project, id, { retentionClass: "temporary" }) };
  }
  if (subcommand === "supersede") {
    const id = readFlag(rest, "--id") ?? fail("ontology supersede requires --id");
    const newSummary = readFlag(rest, "--summary");
    return { ok: true, ...supersedeDurableMemory(dbPath, exportMemory(dbPath).project, id, newSummary === undefined ? {} : { newSummary }) };
  }
  if (subcommand === "recall") {
    const query = readFlag(rest, "--query") ?? fail("ontology recall requires --query");
    const limit = readPositiveIntFlag(rest, "--limit", 10);
    return { ok: true, durableMemories: recallDurableMemories(dbPath, query, limit) };
  }
  fail(`unknown command: ontology ${subcommand ?? ""}`.trim());
}

function ontologyCandidates(dbPath: string): CommandResult {
  const memory = exportMemory(dbPath);
  let references = 0;
  for (const event of memory.events) {
    references += applyConceptExtraction(dbPath, memory.project, event.id, event.summary, event.type).references.length;
  }
  return { ok: true, concepts: listOntologyRows(dbPath, memory.project).concepts, references };
}

function ontologyPromote(dbPath: string, rest: readonly string[]): CommandResult {
  const memory = exportMemory(dbPath);
  const conceptSelector = readFlag(rest, "--concept") ?? readFlag(rest, "--concept-id") ?? fail("ontology promote requires --concept");
  const concept = findConcept(memory.concepts, conceptSelector) ?? fail(`ontology promote candidate not found: ${conceptSelector}`);
  const summary = readFlag(rest, "--summary") ?? `Durable memory: ${concept.label}`;
  const body = readFlag(rest, "--body") ?? concept.description ?? concept.label;
  const durableMemory = createDurableMemory(dbPath, memory.project, {
    type: "concept",
    summary,
    body,
    confidence: Math.min(1, Math.max(0, concept.score / 100)),
    status: "active",
    retentionClass: "durable",
  });
  const reference = recordMemoryReference(dbPath, memory.project, {
    sourceType: "concept",
    sourceId: concept.id,
    targetType: "durable_memory",
    targetId: durableMemory.id,
    refKind: "promotes",
    weight: 1,
  });
  return { ok: true, concept, durableMemory, reference };
}

function findConcept(concepts: readonly ConceptExportRow[], selector: string): ConceptExportRow | undefined {
  const normalized = selector.trim().toLowerCase();
  return concepts.find((concept) => concept.id === selector || concept.label.toLowerCase() === normalized);
}

function recallDurableMemories(dbPath: string, query: string, limit: number): readonly DurableMemoryExportRow[] {
  const memory = exportMemory(dbPath);
  const terms = query.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [];
  if (terms.length === 0) return [];
  return listOntologyRows(dbPath, memory.project)
    .durableMemories.filter((durable) => durable.status === "active")
    .filter((durable) => {
      const haystack = `${durable.summary} ${durable.body ?? ""}`.toLowerCase();
      return terms.some((term) => haystack.includes(term));
    })
    .slice(0, limit);
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

function readPositiveIntFlag(args: readonly string[], name: string, defaultValue: number): number {
  return parsePositiveInt(readFlag(args, name) ?? String(defaultValue), name);
}

function parsePositiveInt(value: string | undefined, label: string): number {
  const limit = value === undefined ? 10 : Number(value);
  if (!Number.isInteger(limit) || limit <= 0) fail(`${label} must be a positive integer`);
  return limit;
}

function fail(message: string): never {
  throw new Error(message);
}

function printHelp(): void {
  process.stdout.write(
    `OMO Memory\n\nCommands:\n  omo-memory init\n  omo-memory doctor\n  omo-memory update\n  omo-memory export\n  omo-memory purge --yes\n  omo-memory global scan --root <path> [--json]\n  omo-memory global migrate --root <path> --global-db <path> [--json]\n  omo-memory ontology candidates\n  omo-memory ontology score\n  omo-memory ontology promote --concept <label|id> [--summary <text>] [--body <text>]\n  omo-memory ontology demote --id <durable-id>\n  omo-memory ontology supersede --id <durable-id> [--summary <text>]\n  omo-memory ontology recall --query <text> [--limit <n>]\n  omo-memory session start --host <codex|opencode|grok|unknown> --adapter <name>\n  omo-memory session bootstrap --host <codex|opencode|grok|unknown> --adapter <name> [--limit <n>]\n  omo-memory event record --type <type> --summary <text> [--session-id <id>]\n  omo-memory recent [--limit <n>]\n  omo-memory recall --query <text> [--limit <n>]\n  omo-memory handoff write (--summary <text> | --summary-file <path>) [--session-id <id>]\n  omo-memory graph tui [--db <path>] [--query <text>]  (requires Bun on PATH)\n  omo-memory mcp\n`,
  );
}

function readPackageVersion(): string {
  const rawPackage: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  if (!isObject(rawPackage)) return "0.0.0";
  const version = rawPackage["version"];
  return typeof version === "string" && version.length > 0 ? version : "0.0.0";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
  process.exitCode = 1;
});
