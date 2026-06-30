#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "omo-memory-mcp-"));
const dbPath = join(tempDir, "state.sqlite");
const globalDbPath = join(tempDir, "global.sqlite");
const expectedTools = [
  "memory_init",
  "memory_project_context",
  "memory_start_session",
  "memory_bootstrap_session",
  "memory_recall_events",
  "memory_record_event",
  "memory_recent_events",
  "memory_write_handoff",
  "memory_export",
  "memory_purge",
  "memory_global_scan",
  "memory_global_migrate",
  "memory_global_list",
];
const pending = new Map();
let nextId = 1;
let stdoutBuffer = "";
let stderrBuffer = "";

function pass(label) {
  process.stdout.write(`smoke-mcp PASS ${label}\n`);
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
  if (typeof text !== "string") throw new Error("tool response did not include text content");
  const parsed = JSON.parse(text);
  if (parsed.ok === false) throw new Error(text);
  return parsed;
}

function callTool(child, name, args = {}) {
  return send(child, "tools/call", { name, arguments: args });
}

async function expectToolError(child, name, args = {}) {
  const response = await callTool(child, name, args);
  const text = response.result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text === "string" && text.includes("Input validation error")) return;
  throw new Error(`${name} did not return validation error text`);
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
    clientInfo: { name: "omo-memory-smoke", version: "0.1.0" },
  });
  if (initialize.result?.serverInfo?.name !== "omo-memory") throw new Error("unexpected MCP server name");
  notify(child, "notifications/initialized");
  pass("initialize");

  const toolsResponse = await send(child, "tools/list");
  const toolNames = toolsResponse.result?.tools?.map((tool) => tool.name).filter((name) => typeof name === "string") ?? [];
  for (const tool of expectedTools) {
    if (!toolNames.includes(tool)) throw new Error(`missing MCP tool ${tool}`);
    pass(`${tool} listed`);
  }
  const ontologyTools = toolNames.filter((name) => name.startsWith("memory_ontology_"));
  if (ontologyTools.length !== 0) throw new Error(`removed ontology tools still listed: ${ontologyTools.join(", ")}`);
  pass("memory_ontology tools absent");

  const init = parseToolText(await callTool(child, "memory_init"));
  if (init.dbPath !== dbPath || init.schemaVersion !== 3) throw new Error("memory_init returned unexpected metadata");
  pass("memory_init call");

  const globalScan = parseToolText(await callTool(child, "memory_global_scan", { rootPath: tempDir }));
  if (!Array.isArray(globalScan.candidates) || !Array.isArray(globalScan.skipped)) throw new Error("memory_global_scan returned malformed result");
  pass("memory_global_scan call");

  const globalMigrate = parseToolText(await callTool(child, "memory_global_migrate", { rootPath: tempDir, globalDbPath }));
  if (typeof globalMigrate.after?.sources !== "number") throw new Error("memory_global_migrate returned malformed result");
  pass("memory_global_migrate call");

  const globalList = parseToolText(await callTool(child, "memory_global_list", { globalDbPath }));
  if (!Array.isArray(globalList.sources) || typeof globalList.counts?.sources !== "number") throw new Error("memory_global_list returned malformed result");
  pass("memory_global_list call");

  const context = parseToolText(await callTool(child, "memory_project_context"));
  if (context.paths?.dbPath !== dbPath || context.project?.id === undefined) throw new Error("memory_project_context returned unexpected context");
  pass("memory_project_context call");

  const bootstrap = parseToolText(await callTool(child, "memory_bootstrap_session", { host: "codex", adapter: "smoke-mcp", limit: 5 }));
  if (typeof bootstrap.sessionId !== "string" || "recentEvents" in bootstrap) throw new Error("memory_bootstrap_session returned unexpected payload");
  pass("memory_bootstrap_session call");

  const event = parseToolText(await callTool(child, "memory_record_event", { type: "user_action", summary: "MCP smoke token=sk-test1234567890" }));
  if (typeof event.eventId !== "string") throw new Error("memory_record_event did not return eventId");
  pass("memory_record_event call");

  const recent = parseToolText(await callTool(child, "memory_recent_events", { limit: 5 }));
  if (!Array.isArray(recent.events) || !recent.events.some((item) => item.summary.includes("[REDACTED]")))
    throw new Error("memory_recent_events did not include redacted event");
  pass("memory_recent_events call");

  const recall = parseToolText(await callTool(child, "memory_recall_events", { query: "MCP smoke", limit: 5 }));
  if (!Array.isArray(recall.events) || !recall.events.some((item) => item.summary.includes("[REDACTED]")))
    throw new Error("memory_recall_events did not include matching redacted event");
  const unrelatedRecall = parseToolText(await callTool(child, "memory_recall_events", { query: "unrelated watercolor calendar", limit: 5 }));
  if (!Array.isArray(unrelatedRecall.events) || unrelatedRecall.events.length !== 0) throw new Error("memory_recall_events returned unrelated events");
  const genericHookRecall = parseToolText(await callTool(child, "memory_recall_events", { query: "unrelated user action profile button", limit: 5 }));
  if (!Array.isArray(genericHookRecall.events) || genericHookRecall.events.length !== 0) throw new Error("memory_recall_events matched generic hook words");
  const underscoreRecall = parseToolText(await callTool(child, "memory_recall_events", { query: "user_action", limit: 5 }));
  if (!Array.isArray(underscoreRecall.events) || underscoreRecall.events.length !== 0) throw new Error("memory_recall_events treated underscore as wildcard");
  const wildcardRecall = parseToolText(await callTool(child, "memory_recall_events", { query: "___", limit: 5 }));
  if (!Array.isArray(wildcardRecall.events) || wildcardRecall.events.length !== 0) throw new Error("memory_recall_events treated wildcard query as pattern");
  await expectToolError(child, "memory_recall_events", { query: "", limit: 5 });
  pass("memory_recall_events call");

  const handoff = parseToolText(await callTool(child, "memory_write_handoff", { summaryMd: "MCP smoke handoff Bearer abcdef123456" }));
  if (typeof handoff.handoffId !== "string") throw new Error("memory_write_handoff did not return handoffId");
  pass("memory_write_handoff call");

  const exported = parseToolText(await callTool(child, "memory_export"));
  if (!JSON.stringify(exported).includes("[REDACTED]")) throw new Error("memory_export did not include redacted data");
  pass("memory_export call");

  const purged = parseToolText(await callTool(child, "memory_purge", { confirm: true }));
  if (purged.deleted?.events < 1 || purged.deleted?.handoffs < 1) throw new Error("memory_purge did not delete expected rows");
  pass("memory_purge call");
} finally {
  const exitPromise = waitForExit(child);
  child.kill("SIGTERM");
  child.stdin.destroy();
  await exitPromise;
  rmSync(tempDir, { recursive: true, force: true });
  pass("cleanup");
}

if (stderrBuffer.trim().length > 0) throw new Error(`MCP stderr was not empty: ${stderrBuffer.trim()}`);
