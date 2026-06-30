#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const evidencePath = join(root, ".omo", "evidence", "omo-memory-core-ledger", "task-13-installed-e2e.txt");
const pathEnv = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;
const expectedVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const expectedMcpTools = [
  "memory_init",
  "memory_export",
  "memory_purge",
  "memory_global_scan",
  "memory_global_migrate",
  "memory_global_list",
  "memory_start_session",
  "memory_bootstrap_session",
  "memory_record_event",
  "memory_recent_events",
  "memory_recall_events",
  "memory_write_handoff",
];

function fail(message) {
  throw new Error(`VERIFY FAIL: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, PATH: pathEnv, ...(options.env ?? {}) },
    encoding: "utf8",
    timeout: options.timeout ?? 30000,
  });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runFail(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, PATH: pathEnv, ...(options.env ?? {}) },
    encoding: "utf8",
    timeout: options.timeout ?? 30000,
  });
  if (result.status === 0) fail(`${command} ${args.join(" ")} unexpectedly succeeded`);
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runJson(args, options = {}) {
  const result = run("omo-memory", args, options);
  const parsed = JSON.parse(result.stdout);
  if (parsed.ok !== true) fail(`omo-memory ${args.join(" ")} returned ok!=true: ${result.stdout}`);
  return parsed;
}

function runJsonFail(args, options = {}) {
  const result = runFail("omo-memory", args, options);
  const parsed = JSON.parse(result.stdout);
  if (parsed.ok !== false || typeof parsed.error !== "string") fail(`omo-memory ${args.join(" ")} did not return JSON error: ${result.stdout}`);
  return parsed;
}

function writeFixtureProject(tempRoot, name, events) {
  const projectDir = join(tempRoot, name);
  const dbPath = join(projectDir, ".omo", "memory", "state.sqlite");
  mkdirSync(projectDir, { recursive: true });
  runJson(["init"], { cwd: projectDir, env: { OMO_MEMORY_DB: dbPath } });
  const session = runJson(["session", "start", "--host", "codex", "--adapter", "installed-e2e"], { cwd: projectDir, env: { OMO_MEMORY_DB: dbPath } });
  for (const [type, summary] of events) {
    runJson(["event", "record", "--type", type, "--summary", summary, "--session-id", session.sessionId], {
      cwd: projectDir,
      env: { OMO_MEMORY_DB: dbPath },
    });
  }
  runJson(["handoff", "write", "--summary", `${name} installed e2e handoff`, "--session-id", session.sessionId], {
    cwd: projectDir,
    env: { OMO_MEMORY_DB: dbPath },
  });
  return { projectDir, dbPath, sessionId: session.sessionId };
}

function createMcpClient(dbPath, cwd) {
  const child = spawn("omo-memory", ["mcp"], {
    cwd,
    env: { ...process.env, PATH: pathEnv, OMO_MEMORY_DB: dbPath },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  let stdoutBuffer = "";
  let stderrBuffer = "";
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
  function send(method, params = {}) {
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
  function notify(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }
  async function close() {
    const exitPromise = child.exitCode === null ? new Promise((resolve) => child.once("exit", resolve)) : Promise.resolve();
    child.kill("SIGTERM");
    child.stdin.destroy();
    await exitPromise;
    if (stderrBuffer.trim().length > 0) fail(`installed MCP stderr was not empty: ${stderrBuffer.trim()}`);
  }
  return { send, notify, close };
}

function toolText(response) {
  const text = response.result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") fail("MCP response missing text content");
  return text;
}

function parseTool(response, options = {}) {
  const parsed = JSON.parse(toolText(response));
  if (parsed.ok === false && options.allowOkFalse !== true) fail(`MCP tool returned ok=false: ${JSON.stringify(parsed)}`);
  return parsed;
}

async function verifyInstalledMcp(tempRoot) {
  const mcpRoot = join(tempRoot, "mcp-root");
  const projectDir = join(mcpRoot, "mcp-project");
  const dbPath = join(projectDir, ".omo", "memory", "state.sqlite");
  mkdirSync(projectDir, { recursive: true });
  const client = createMcpClient(dbPath, projectDir);
  try {
    const initialize = await client.send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "installed-e2e", version: "0.0.0" },
    });
    if (initialize.result?.serverInfo?.name !== "omo-memory" || initialize.result?.serverInfo?.version !== expectedVersion) {
      fail(`unexpected installed MCP serverInfo: ${JSON.stringify(initialize.result?.serverInfo)}`);
    }
    client.notify("notifications/initialized");
    const tools = await client.send("tools/list");
    const toolNames = tools.result?.tools?.map((tool) => tool.name).filter((name) => typeof name === "string") ?? [];
    for (const tool of expectedMcpTools) {
      if (!toolNames.includes(tool)) fail(`installed MCP missing ${tool}`);
    }
    const removed = toolNames.filter((name) => name.startsWith("memory_ontology_"));
    if (removed.length > 0) fail(`installed MCP still lists ontology tools: ${removed.join(", ")}`);

    const init = parseTool(await client.send("tools/call", { name: "memory_init", arguments: {} }));
    if (init.dbPath !== dbPath) fail(`installed MCP init wrong db path: ${JSON.stringify(init)}`);
    const bootstrap = parseTool(
      await client.send("tools/call", { name: "memory_bootstrap_session", arguments: { host: "codex", adapter: "installed-e2e", limit: 5 } }),
    );
    if (typeof bootstrap.sessionId !== "string" || "recentEvents" in bootstrap) fail("installed MCP bootstrap returned recentEvents");
    const event = parseTool(
      await client.send("tools/call", {
        name: "memory_record_event",
        arguments: { type: "decision", summary: "installed MCP core ledger event", sessionId: bootstrap.sessionId },
      }),
    );
    if (typeof event.eventId !== "string") fail("installed MCP record event missing eventId");
    const recent = parseTool(await client.send("tools/call", { name: "memory_recent_events", arguments: { limit: 5 } }));
    if (recent.events.length !== 1) fail(`installed MCP recent mismatch: ${JSON.stringify(recent)}`);
    const recall = parseTool(await client.send("tools/call", { name: "memory_recall_events", arguments: { query: "core ledger", limit: 5 } }));
    if (!recall.events.some((item) => item.id === event.eventId)) fail("installed MCP recall missed event");
    const handoff = parseTool(
      await client.send("tools/call", { name: "memory_write_handoff", arguments: { summaryMd: "installed MCP handoff", sessionId: bootstrap.sessionId } }),
    );
    if (typeof handoff.handoffId !== "string") fail("installed MCP handoff missing handoffId");
    const exported = parseTool(await client.send("tools/call", { name: "memory_export", arguments: {} }));
    if (exported.events.length !== 1 || exported.handoffs.length !== 1) fail(`installed MCP export mismatch: ${JSON.stringify(exported)}`);
    const globalDbPath = join(mcpRoot, "mcp-global.sqlite");
    const scan = parseTool(await client.send("tools/call", { name: "memory_global_scan", arguments: { rootPath: mcpRoot } }));
    if (scan.candidates.length !== 1) fail(`installed MCP global scan mismatch: ${JSON.stringify(scan)}`);
    const migrate = parseTool(await client.send("tools/call", { name: "memory_global_migrate", arguments: { rootPath: mcpRoot, globalDbPath } }));
    if (migrate.after.events !== 1 || migrate.after.handoffs !== 1) fail(`installed MCP global migrate mismatch: ${JSON.stringify(migrate)}`);
    const list = parseTool(await client.send("tools/call", { name: "memory_global_list", arguments: { globalDbPath } }));
    if (list.counts.events !== 1 || list.counts.handoffs !== 1 || list.sources.length !== 1)
      fail(`installed MCP global list mismatch: ${JSON.stringify(list)}`);
    const refusedPurge = parseTool(await client.send("tools/call", { name: "memory_purge", arguments: { confirm: false } }), { allowOkFalse: true });
    if (refusedPurge.ok !== false) fail(`installed MCP purge false confirm mismatch: ${JSON.stringify(refusedPurge)}`);
    const purged = parseTool(await client.send("tools/call", { name: "memory_purge", arguments: { confirm: true } }));
    if (purged.deleted.events !== 1 || purged.deleted.handoffs !== 1) fail(`installed MCP purge mismatch: ${JSON.stringify(purged)}`);
    return { toolCount: toolNames.length, globalDbPath };
  } finally {
    await client.close();
  }
}

async function main() {
  const install = run("npm", ["install", "-g", "."], { cwd: root, timeout: 120000 });
  const help = run("omo-memory", ["--help"]);
  for (const text of [
    "omo-memory init",
    "omo-memory doctor",
    "omo-memory export",
    "omo-memory purge --yes",
    "omo-memory global scan --root <path>",
    "omo-memory global migrate --root <path> --global-db <path>",
    "omo-memory global list --global-db <path>",
    "omo-memory session start",
    "omo-memory event record",
    "omo-memory recent",
    "omo-memory recall --query <text>",
    "omo-memory handoff write",
  ]) {
    if (!help.stdout.includes(text)) fail(`installed help missing ${text}`);
  }
  if (/ontology|graph tui|OpenTUI/i.test(help.stdout)) fail("installed help still lists removed ontology/graph surfaces");

  const tempRoot = mkdtempSync(join(tmpdir(), "omo-installed-e2e-"));
  try {
    const linaforge = writeFixtureProject(tempRoot, "linaforge", [
      ["decision", "Linaforge installed e2e global sqlite migration"],
      ["qa_evidence", "Linaforge installed e2e core ledger recall"],
    ]);
    writeFixtureProject(tempRoot, "lfg", [
      ["decision", "lfg installed e2e contributes cross-project memory"],
      ["qa_evidence", "lfg installed MCP exposes only core ledger tools"],
    ]);
    const recent = runJson(["recent", "--limit", "5"], { cwd: linaforge.projectDir, env: { OMO_MEMORY_DB: linaforge.dbPath } });
    if (recent.events.length !== 2) fail(`installed recent mismatch: ${JSON.stringify(recent)}`);
    const recall = runJson(["recall", "--query", "core ledger", "--limit", "5"], { cwd: linaforge.projectDir, env: { OMO_MEMORY_DB: linaforge.dbPath } });
    if (recall.events.length !== 1) fail(`installed recall mismatch: ${JSON.stringify(recall)}`);
    const exported = runJson(["export"], { cwd: linaforge.projectDir, env: { OMO_MEMORY_DB: linaforge.dbPath } });
    if (exported.events.length !== 2 || exported.handoffs.length !== 1) fail(`installed export mismatch: ${JSON.stringify(exported)}`);

    const globalDbPath = join(tempRoot, "global.sqlite");
    const scan = runJson(["global", "scan", "--root", tempRoot], { cwd: root });
    if (scan.candidates.length !== 2) fail(`installed global scan weak result: ${JSON.stringify(scan)}`);
    const migrate = runJson(["global", "migrate", "--root", tempRoot, "--global-db", globalDbPath], { cwd: root });
    if (migrate.after.projects < 2 || migrate.after.events < 4 || migrate.after.handoffs < 2)
      fail(`installed global migrate weak result: ${JSON.stringify(migrate)}`);
    const globalList = runJson(["global", "list", "--global-db", globalDbPath], { cwd: root });
    if (globalList.counts.projects < 2 || globalList.counts.events < 4 || globalList.counts.handoffs < 2) {
      fail(`installed global list weak result: ${JSON.stringify(globalList)}`);
    }

    const refusedPurge = runJsonFail(["purge"], { cwd: linaforge.projectDir, env: { OMO_MEMORY_DB: linaforge.dbPath } });
    if (!/purge requires --yes/i.test(refusedPurge.error)) fail(`installed purge refusal mismatch: ${refusedPurge.error}`);
    const purged = runJson(["purge", "--yes"], { cwd: linaforge.projectDir, env: { OMO_MEMORY_DB: linaforge.dbPath } });
    if (purged.deleted.events !== 2 || purged.deleted.handoffs !== 1) fail(`installed purge mismatch: ${JSON.stringify(purged)}`);

    const mcp = await verifyInstalledMcp(tempRoot);
    const evidence = {
      npmInstallGlobal: install.stdout.trim().split(/\r?\n/).slice(-3),
      installedHelp: "core ledger commands present; ontology/graph absent",
      globalDbPath,
      migratedProjects: migrate.after.projects,
      migratedEvents: migrate.after.events,
      migratedHandoffs: migrate.after.handoffs,
      globalListCounts: globalList.counts,
      cliCoreLedger: "session/event/handoff/recent/recall/export/purge checks passed",
      removedCliSurfacesAbsentFromHelp: ["ontology commands", "graph tui"],
      mcp: "initialize/tools/core-ledger/global/purge checks passed",
      mcpToolCount: mcp.toolCount,
      removedMcpSurfacesAbsentFromToolList: ["memory_ontology_*"],
      cleanup: "temp root removed; no graph TUI launched",
    };
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log("VERIFY PASS: installed package core ledger lifecycle");
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
