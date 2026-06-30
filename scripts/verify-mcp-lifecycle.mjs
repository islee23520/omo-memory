#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "omo-memory-mcp-life-"));
const projectDir = join(tempDir, "project");
const dbPath = join(projectDir, ".omo", "memory", "state.sqlite");
const globalDbPath = join(tempDir, "global.sqlite");
mkdirSync(projectDir, { recursive: true });
const expectedCoreTools = [
  "memory_init",
  "memory_project_context",
  "memory_export",
  "memory_purge",
  "memory_global_scan",
  "memory_global_migrate",
  "memory_global_list",
  "memory_start_session",
  "memory_bootstrap_session",
  "memory_recall_events",
  "memory_record_event",
  "memory_recent_events",
  "memory_write_handoff",
];
const removedToolPrefixes = ["memory_ontology_"];

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

function parseToolText(response, options = {}) {
  const text = response.result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") fail("tool response did not include text content");
  const parsed = JSON.parse(text);
  if (parsed.ok === false && options.allowOkFalse !== true) fail(text);
  return parsed;
}

function toolText(response) {
  const text = response.result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") fail("tool response did not include text content");
  return text;
}

function callTool(child, name, args = {}) {
  return send(child, "tools/call", { name, arguments: args });
}

async function expectValidationError(child, name, args) {
  const response = await callTool(child, name, args);
  const text = toolText(response);
  if (text.includes("Input validation error")) {
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
  cwd: projectDir,
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
    clientInfo: { name: "omo-memory-core-ledger-smoke", version: "0.1.0" },
  });
  if (initialize.result?.serverInfo?.name !== "omo-memory") fail("unexpected MCP server name");
  notify(child, "notifications/initialized");
  pass("initialize");

  const toolsResponse = await send(child, "tools/list");
  const toolNames = toolsResponse.result?.tools?.map((tool) => tool.name).filter((name) => typeof name === "string") ?? [];
  for (const tool of expectedCoreTools) {
    if (!toolNames.includes(tool)) fail(`missing MCP core ledger tool ${tool}`);
  }
  for (const prefix of removedToolPrefixes) {
    const removed = toolNames.filter((tool) => tool.startsWith(prefix));
    if (removed.length > 0) fail(`removed MCP tools still listed: ${removed.join(", ")}`);
  }
  pass("core ledger tools listed");

  const init = parseToolText(await callTool(child, "memory_init"));
  if (init.dbPath !== dbPath) fail("memory_init returned wrong db path");
  pass("memory_init");

  const context = parseToolText(await callTool(child, "memory_project_context"));
  if (context.paths?.dbPath !== dbPath) fail("memory_project_context returned wrong db path");
  pass("memory_project_context");

  const globalScan = parseToolText(await callTool(child, "memory_global_scan", { rootPath: tempDir }));
  if (!Array.isArray(globalScan.candidates) || globalScan.candidates.length !== 1) fail("memory_global_scan returned malformed candidates");
  pass("memory_global_scan");

  const bootstrap = parseToolText(await callTool(child, "memory_bootstrap_session", { host: "codex", adapter: "core-ledger-mcp", limit: 5 }));
  if (typeof bootstrap.sessionId !== "string" || "recentEvents" in bootstrap) fail("memory_bootstrap_session returned recentEvents");
  pass("memory_bootstrap_session no recentEvents");

  const session = parseToolText(await callTool(child, "memory_start_session", { host: "codex", adapter: "core-ledger-mcp" }));
  if (typeof session.sessionId !== "string") fail("memory_start_session did not return sessionId");
  pass("memory_start_session");

  const event = parseToolText(
    await callTool(child, "memory_record_event", {
      type: "decision",
      summary: "Core ledger MCP records Linaforge event token=sk-test-mcp-lifecycle",
      sessionId: session.sessionId,
    }),
  );
  if (typeof event.eventId !== "string") fail("memory_record_event did not return eventId");
  pass("memory_record_event");

  const recent = parseToolText(await callTool(child, "memory_recent_events", { limit: 5 }));
  if (!Array.isArray(recent.events) || recent.events.length !== 1) fail("memory_recent_events returned malformed events");
  if (JSON.stringify(recent).includes("sk-test-mcp-lifecycle") || !JSON.stringify(recent).includes("[REDACTED]")) fail("memory_recent_events redaction failed");
  pass("memory_recent_events");

  const recall = parseToolText(await callTool(child, "memory_recall_events", { query: "Linaforge", limit: 5 }));
  if (!Array.isArray(recall.events) || !recall.events.some((item) => item.id === event.eventId)) fail("memory_recall_events missed recorded event");
  if (JSON.stringify(recall).includes("sk-test-mcp-lifecycle")) fail("memory_recall_events leaked raw secret");
  pass("memory_recall_events");

  const handoff = parseToolText(
    await callTool(child, "memory_write_handoff", { summaryMd: "Core ledger MCP handoff token=sk-test-mcp-lifecycle", sessionId: session.sessionId }),
  );
  if (typeof handoff.handoffId !== "string") fail("memory_write_handoff did not return handoffId");
  pass("memory_write_handoff");

  const exported = parseToolText(await callTool(child, "memory_export"));
  if (exported.events.length !== 1 || exported.sessions.length !== 2 || exported.handoffs.length !== 1)
    fail(`memory_export counts mismatch: ${JSON.stringify(exported)}`);
  if (JSON.stringify(exported).includes("sk-test-mcp-lifecycle")) fail("memory_export leaked raw secret");
  pass("memory_export");

  const globalMigrate = parseToolText(await callTool(child, "memory_global_migrate", { rootPath: tempDir, globalDbPath }));
  if (globalMigrate.after?.events !== 1 || globalMigrate.after?.handoffs !== 1) fail("memory_global_migrate returned malformed counts");
  pass("memory_global_migrate");

  const globalList = parseToolText(await callTool(child, "memory_global_list", { globalDbPath }));
  if (!Array.isArray(globalList.sources) || globalList.counts?.events !== 1 || globalList.counts?.handoffs !== 1)
    fail("memory_global_list returned malformed list");
  pass("memory_global_list");

  await expectValidationError(child, "memory_record_event", { type: "decision", summary: "" });
  await expectValidationError(child, "memory_recall_events", { query: "" });
  await expectValidationError(child, "memory_write_handoff", { summaryMd: "" });

  const refusedPurge = parseToolText(await callTool(child, "memory_purge", { confirm: false }), { allowOkFalse: true });
  if (refusedPurge.ok !== false || !/confirm: true/.test(refusedPurge.error)) fail(`memory_purge false confirm mismatch: ${JSON.stringify(refusedPurge)}`);
  pass("memory_purge requires confirm");

  const purged = parseToolText(await callTool(child, "memory_purge", { confirm: true }));
  if (purged.deleted?.events !== 1 || purged.deleted?.handoffs !== 1 || purged.deleted?.sessions !== 2)
    fail(`memory_purge counts mismatch: ${JSON.stringify(purged)}`);
  pass("memory_purge");
} finally {
  const exitPromise = waitForExit(child);
  child.kill("SIGTERM");
  child.stdin.destroy();
  await exitPromise;
  rmSync(tempDir, { recursive: true, force: true });
  pass("cleanup");
}

if (stderrBuffer.trim().length > 0) fail(`MCP stderr was not empty: ${stderrBuffer.trim()}`);
