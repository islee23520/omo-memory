#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const evidencePath = join(root, ".omo", "evidence", "omo-memory-second-brain-retention", "task-13-installed-e2e.txt");
const pathEnv = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;
const expectedVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

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

function runJson(args, options = {}) {
  const result = run("omo-memory", args, options);
  const parsed = JSON.parse(result.stdout);
  if (parsed.ok !== true) fail(`omo-memory ${args.join(" ")} returned ok!=true: ${result.stdout}`);
  return parsed;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
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
  return { projectDir, dbPath };
}

function createMcpClient(dbPath) {
  const child = spawn("omo-memory", ["mcp"], {
    cwd: root,
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

function parseTool(response) {
  const parsed = JSON.parse(toolText(response));
  if (parsed.ok === false) fail(`MCP tool returned ok=false: ${JSON.stringify(parsed)}`);
  return parsed;
}

async function verifyInstalledMcp(tempRoot) {
  const dbPath = join(tempRoot, "mcp.sqlite");
  const client = createMcpClient(dbPath);
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
    const bootstrap = parseTool(
      await client.send("tools/call", { name: "memory_bootstrap_session", arguments: { host: "codex", adapter: "installed-e2e", limit: 5 } }),
    );
    if (typeof bootstrap.sessionId !== "string" || "recentEvents" in bootstrap) fail("installed MCP bootstrap returned recentEvents");
    const badPromotionText = toolText(await client.send("tools/call", { name: "memory_ontology_promote", arguments: { type: "", summary: "" } }));
    if (!badPromotionText.includes("Input validation error")) fail(`installed MCP malformed promotion was not rejected: ${badPromotionText}`);
  } finally {
    await client.close();
  }
}

async function pause(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyInstalledGraph(globalDbPath) {
  const session = `ulw-installed-graph-${process.pid}`;
  const command = `omo-memory graph tui --db ${shellQuote(globalDbPath)} --query linaforge`;
  run("tmux", ["new-session", "-d", "-x", "120", "-y", "40", "-s", session, command], { env: { PATH: pathEnv } });
  try {
    const deadline = Date.now() + 6000;
    let capture = "";
    while (Date.now() < deadline) {
      const result = run("tmux", ["capture-pane", "-p", "-S", "-200", "-E", "200", "-t", session], { env: { PATH: pathEnv } });
      capture = result.stdout;
      if (capture.includes("OMO Ontology Graph") && capture.includes("linaforge") && capture.includes("Retention:")) break;
      await pause(250);
    }
    if (!capture.includes("OMO Ontology Graph") || !capture.includes("linaforge") || !capture.includes("Retention:")) {
      fail(`installed graph capture missing expected text:\n${capture}`);
    }
    run("tmux", ["send-keys", "-t", session, "q"], { env: { PATH: pathEnv } });
    await pause(800);
    const hasSession = spawnSync("tmux", ["has-session", "-t", session], { env: { ...process.env, PATH: pathEnv }, encoding: "utf8" });
    if (hasSession.status === 0) fail(`tmux session still running: ${session}`);
    return capture;
  } finally {
    spawnSync("tmux", ["kill-session", "-t", session], { env: { ...process.env, PATH: pathEnv }, encoding: "utf8" });
  }
}

async function main() {
  const install = run("npm", ["install", "-g", "."], { cwd: root, timeout: 120000 });
  const help = run("omo-memory", ["--help"]);
  if (!help.stdout.includes("omo-memory graph tui")) fail("installed help missing graph tui command");
  const tempRoot = mkdtempSync(join(tmpdir(), "omo-installed-e2e-"));
  try {
    writeFixtureProject(tempRoot, "linaforge", [
      ["decision", "Linaforge installed e2e global sqlite migration"],
      ["qa_evidence", "Linaforge installed OpenTUI graph renders ontology"],
    ]);
    writeFixtureProject(tempRoot, "lfg", [
      ["decision", "lfg installed e2e contributes cross-project memory"],
      ["qa_evidence", "lfg installed MCP rejects malformed promotion"],
    ]);
    const globalDbPath = join(tempRoot, "global.sqlite");
    const migrate = runJson(["global", "migrate", "--root", tempRoot, "--global-db", globalDbPath], { cwd: root });
    if (migrate.after.projects < 2 || migrate.after.events < 4) fail(`installed global migrate weak result: ${JSON.stringify(migrate)}`);
    const candidates = runJson(["ontology", "candidates"], { cwd: root, env: { OMO_MEMORY_DB: globalDbPath } });
    if (candidates.concepts.length === 0) fail("installed ontology candidates produced no concepts");
    runJson(["ontology", "score"], { cwd: root, env: { OMO_MEMORY_DB: globalDbPath } });
    const promoted = runJson(["ontology", "promote", "--concept", "linaforge", "--summary", "Installed Linaforge durable memory"], {
      cwd: root,
      env: { OMO_MEMORY_DB: globalDbPath },
    });
    const recall = runJson(["ontology", "recall", "--query", "linaforge"], { cwd: root, env: { OMO_MEMORY_DB: globalDbPath } });
    if (!recall.durableMemories.some((memory) => memory.id === promoted.durableMemory.id)) fail("installed ontology recall missed promoted memory");
    runJson(["ontology", "demote", "--id", promoted.durableMemory.id], { cwd: root, env: { OMO_MEMORY_DB: globalDbPath } });
    runJson(["ontology", "supersede", "--id", promoted.durableMemory.id, "--summary", "Installed Linaforge successor memory"], {
      cwd: root,
      env: { OMO_MEMORY_DB: globalDbPath },
    });
    await verifyInstalledMcp(tempRoot);
    const graphCapture = await verifyInstalledGraph(globalDbPath);
    const evidence = {
      npmInstallGlobal: install.stdout.trim().split(/\r?\n/).slice(-3),
      installedHelp: "graph command present",
      globalDbPath,
      migratedProjects: migrate.after.projects,
      migratedEvents: migrate.after.events,
      concepts: candidates.concepts.length,
      promotedDurableId: promoted.durableMemory.id,
      recallCount: recall.durableMemories.length,
      mcp: "initialize/bootstrap/malformed-promotion checks passed",
      graphCaptureIncludes: ["OMO Ontology Graph", "linaforge", "Retention:"],
      graphCapturePreview: graphCapture.split(/\r?\n/).slice(0, 12),
      cleanup: "temp root removed and tmux session exited",
    };
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log("VERIFY PASS: installed package second-brain lifecycle");
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
