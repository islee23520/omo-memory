#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "omo-memory-mcp-life-"));
const dbPath = join(tempDir, "state.sqlite");
const globalDbPath = join(tempDir, "global.sqlite");
const expectedLifecycleTools = [
  "memory_global_scan",
  "memory_global_migrate",
  "memory_global_list",
  "memory_ontology_candidates",
  "memory_ontology_extract",
  "memory_ontology_score",
  "memory_ontology_promote",
  "memory_ontology_demote",
  "memory_ontology_supersede",
  "memory_ontology_recall",
];

const pending = new Map();
let nextId = 1;
let stdoutBuffer = "";
let stderrBuffer = "";

function fail(message) {
  throw new Error(`VERIFY MCP LIFECYCLE FAIL: ${message}`);
}

function pass(label) {
  process.stdout.write(`verify-mcp-lifecycle PASS ${label}\n`);
}

function send(child, method, params = {}) {
  const id = nextId;
  nextId += 1;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 5000).unref();
  });
}

function notify(child, method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function parseToolText(response) {
  const text = response.result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") fail("tool response did not include text content");
  const parsed = JSON.parse(text);
  if (parsed.ok === false) fail(text);
  return parsed;
}

function callTool(child, name, args = {}) {
  return send(child, "tools/call", { name, arguments: args });
}

async function expectValidationError(child, name, args) {
  const response = await callTool(child, name, args);
  const text = response.result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text === "string" && text.includes("Input validation error")) {
    pass(`${name} validation rejected`);
    return;
  }
  fail(`${name} did not reject malformed input`);
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

const child = spawn(process.execPath, [join(root, "dist", "cli.js"), "mcp"], {
  cwd: root,
  env: { ...process.env, OMO_MEMORY_DB: dbPath },
  stdio: ["pipe", "pipe", "pipe"],
});

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  const lines = stdoutBuffer.split(/\r?\n/);
  stdoutBuffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (request === undefined) continue;
    pending.delete(message.id);
    if (message.error !== undefined) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message);
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderrBuffer += chunk;
});

try {
  const initialize = await send(child, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "omo-memory-lifecycle-smoke", version: "0.1.0" },
  });
  if (initialize.result?.serverInfo?.name !== "omo-memory") fail("unexpected MCP server name");
  notify(child, "notifications/initialized");
  pass("initialize");

  const toolsResponse = await send(child, "tools/list");
  const toolNames = toolsResponse.result?.tools?.map((tool) => tool.name).filter((name) => typeof name === "string") ?? [];
  for (const tool of expectedLifecycleTools) {
    if (!toolNames.includes(tool)) fail(`missing MCP lifecycle tool ${tool}`);
  }
  pass("lifecycle tools listed");

  const init = parseToolText(await callTool(child, "memory_init"));
  if (init.dbPath !== dbPath) fail("memory_init returned wrong db path");
  pass("memory_init");

  const globalScan = parseToolText(await callTool(child, "memory_global_scan", { rootPath: tempDir }));
  if (!Array.isArray(globalScan.candidates)) fail("memory_global_scan returned malformed candidates");
  pass("memory_global_scan");

  const globalMigrate = parseToolText(await callTool(child, "memory_global_migrate", { rootPath: tempDir, globalDbPath }));
  if (typeof globalMigrate.after?.sources !== "number") fail("memory_global_migrate returned malformed counts");
  pass("memory_global_migrate");

  const globalList = parseToolText(await callTool(child, "memory_global_list", { globalDbPath }));
  if (!Array.isArray(globalList.sources) || typeof globalList.counts?.sources !== "number") fail("memory_global_list returned malformed list");
  pass("memory_global_list");

  const bootstrap = parseToolText(await callTool(child, "memory_bootstrap_session", { host: "codex", adapter: "lifecycle-qa", limit: 5 }));
  if (typeof bootstrap.sessionId !== "string" || "recentEvents" in bootstrap) fail("memory_bootstrap_session returned recentEvents");
  pass("memory_bootstrap_session no recentEvents");

  const event = parseToolText(
    await callTool(child, "memory_record_event", {
      type: "decision",
      summary: "Durable ontology lifecycle stores Linaforge vector-retention preference",
      sessionId: bootstrap.sessionId,
    }),
  );
  if (typeof event.eventId !== "string") fail("memory_record_event did not return eventId");
  pass("memory_record_event");

  const candidates = parseToolText(
    await callTool(child, "memory_ontology_candidates", {
      summary: "Durable ontology lifecycle stores Linaforge vector-retention preference",
      eventType: "decision",
    }),
  );
  if (!Array.isArray(candidates.candidates) || !candidates.candidates.includes("linaforge")) fail("candidate extraction missed Linaforge");
  pass("memory_ontology_candidates");

  const extracted = parseToolText(
    await callTool(child, "memory_ontology_extract", {
      sourceEventId: event.eventId,
      summary: "Durable ontology lifecycle stores Linaforge vector-retention preference",
      eventType: "decision",
    }),
  );
  if (!Array.isArray(extracted.concepts) || extracted.concepts.length === 0) fail("memory_ontology_extract created no concepts");
  pass("memory_ontology_extract");

  const scored = parseToolText(await callTool(child, "memory_ontology_score", { nowIso: "2026-06-29T00:00:00.000Z" }));
  if (typeof scored.scannedConcepts !== "number") fail("memory_ontology_score returned malformed result");
  pass("memory_ontology_score");

  const promoted = parseToolText(
    await callTool(child, "memory_ontology_promote", {
      type: "preference",
      summary: "Linaforge keeps vector-retention lifecycle memories durable",
      body: "Do not leak sk-test-secret-lifecycle in MCP promotion",
      sourceEventId: event.eventId,
      confidence: 0.91,
    }),
  );
  if (typeof promoted.id !== "string" || JSON.stringify(promoted).includes("sk-test-secret-lifecycle") || !JSON.stringify(promoted).includes("[REDACTED]")) {
    fail("memory_ontology_promote failed redaction/id checks");
  }
  pass("memory_ontology_promote");

  const demoted = parseToolText(await callTool(child, "memory_ontology_demote", { durableId: promoted.id, retentionClass: "temporary" }));
  if (demoted.retentionClass !== "temporary") fail("memory_ontology_demote did not update retention class");
  pass("memory_ontology_demote");

  const recalled = parseToolText(await callTool(child, "memory_ontology_recall", { query: "Linaforge vector-retention" }));
  if (!Array.isArray(recalled.durableMemories) || !recalled.durableMemories.some((item) => item.id === promoted.id)) {
    fail("memory_ontology_recall did not return promoted durable memory");
  }
  pass("memory_ontology_recall");

  const superseded = parseToolText(
    await callTool(child, "memory_ontology_supersede", {
      durableId: promoted.id,
      reason: "manual lifecycle QA",
      newSummary: "Linaforge keeps vector-retention lifecycle memories permanent",
    }),
  );
  if (superseded.originalId !== promoted.id || typeof superseded.supersedingId !== "string") fail("memory_ontology_supersede malformed result");
  pass("memory_ontology_supersede");

  await expectValidationError(child, "memory_ontology_candidates", { summary: "" });
  await expectValidationError(child, "memory_ontology_candidates", { summary: "   " });
  await expectValidationError(child, "memory_ontology_promote", { type: "", summary: "" });
  await expectValidationError(child, "memory_ontology_promote", { type: "   ", summary: "   " });
  await expectValidationError(child, "memory_ontology_recall", { query: "" });
  await expectValidationError(child, "memory_ontology_recall", { query: "   " });
} finally {
  const exitPromise = waitForExit(child);
  child.kill("SIGTERM");
  child.stdin.destroy();
  await exitPromise;
  rmSync(tempDir, { recursive: true, force: true });
  pass("cleanup");
}

if (stderrBuffer.trim().length > 0) fail(`MCP stderr was not empty: ${stderrBuffer.trim()}`);
