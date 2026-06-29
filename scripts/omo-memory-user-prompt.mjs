#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_SUMMARY_CHARS = 4000;

const host = process.env["OMO_MEMORY_HOST"] ?? "unknown";
const adapter = process.env["OMO_MEMORY_ADAPTER"] ?? "unknown";

const input = readStdin();
const payload = parseJson(input);
const prompt = extractPrompt(payload);

if (prompt === null) process.exit(0);

const summary = truncate(prompt.replace(/\s+/g, " ").trim(), MAX_SUMMARY_CHARS);
if (summary.length === 0) process.exit(0);

const hookSessionId = readString(payload, "sessionId") ?? readString(payload, "session_id");
const workspaceRoot = readString(payload, "workspaceRoot") ?? readString(payload, "cwd");
const metadata = {
  source: "hook",
  hookEventName: readString(payload, "hookEventName") ?? process.env["GROK_HOOK_EVENT"] ?? process.env["CODEX_HOOK_EVENT"] ?? "UserPromptSubmit",
  host,
  adapter,
  ...(hookSessionId === null ? {} : { hookSessionId }),
  ...(workspaceRoot === null ? {} : { workspaceRoot }),
};

const args = ["event", "record", "--type", "user_prompt", "--summary", summary, "--payload-json", JSON.stringify(metadata)];

const result = runOmoMemory(args) ?? runNpx(args);
if (result === undefined || result.status !== 0) process.exit(0);

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch (error) {
    if (error instanceof Error) process.exit(0);
    throw error;
  }
}

function parseJson(raw) {
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

function extractPrompt(value) {
  if (!isRecord(value)) return null;
  for (const key of ["prompt", "userPrompt", "user_prompt", "message", "text", "input"]) {
    const direct = readString(value, key);
    if (direct !== null) return direct;
  }
  const nestedPrompt =
    readNestedString(value, ["toolInput", "prompt"]) ?? readNestedString(value, ["payload", "prompt"]) ?? readNestedString(value, ["data", "prompt"]);
  if (nestedPrompt !== null) return nestedPrompt;
  return null;
}

function readNestedString(value, path) {
  let cursor = value;
  for (const key of path) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[key];
  }
  return typeof cursor === "string" ? cursor : null;
}

function readString(value, key) {
  const item = value[key];
  return typeof item === "string" ? item : null;
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 15)} [TRUNCATED]`;
}

function runOmoMemory(args) {
  const command = process.env["OMO_MEMORY_CLI"] ?? "omo-memory";
  return run(command, args);
}

function runNpx(args) {
  return run("npx", ["-y", "omo-memory", ...args]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });
  if (result.error?.code === "ENOENT") return undefined;
  return result;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
