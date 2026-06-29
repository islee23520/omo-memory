import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PACKAGE_NAME = "omo-memory";
const DEFAULT_INTERVAL_MS = 86_400_000;
const STATE_PATH = join(homedir(), ".omo", "memory", "auto-update.json");

export type AutoUpdateResult = {
  readonly ok: boolean;
  readonly packageName: string;
  readonly currentVersion: string;
  readonly command: readonly string[];
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export function maybeRunAutoUpdate(currentVersion: string, nowMs = Date.now()): void {
  const statePath = process.env["OMO_MEMORY_UPDATE_STATE"] ?? STATE_PATH;
  if (!shouldAttemptAutoUpdate({ nowMs, statePath })) return;
  writeAttemptStamp(statePath, nowMs);
  const child = spawn(npmCommand(), installArgs(), {
    detached: true,
    stdio: "ignore",
    env: updateEnv(currentVersion),
  });
  child.unref();
}

export function runAutoUpdate(currentVersion: string): AutoUpdateResult {
  const command = npmCommand();
  const args = installArgs();
  const result = spawnSync(command, args, { encoding: "utf8", env: updateEnv(currentVersion) });
  return {
    ok: result.status === 0,
    packageName: PACKAGE_NAME,
    currentVersion,
    command: [command, ...args],
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function shouldAttemptAutoUpdate(input: { readonly nowMs: number; readonly statePath: string }): boolean {
  if (process.env["OMO_MEMORY_AUTO_UPDATE"] === "0") return false;
  if (process.env["OMO_MEMORY_AUTO_UPDATE"] === "false") return false;
  if (process.env["OMO_MEMORY_AUTO_UPDATE_CHILD"] === "1") return false;
  const intervalMs = updateIntervalMs();
  if (!existsSync(input.statePath)) return true;
  const lastAttemptMs = readLastAttemptMs(input.statePath);
  return lastAttemptMs === null || input.nowMs - lastAttemptMs >= intervalMs;
}

function updateIntervalMs(): number {
  const raw = process.env["OMO_MEMORY_AUTO_UPDATE_INTERVAL_MS"];
  if (raw === undefined) return DEFAULT_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_INTERVAL_MS;
}

function readLastAttemptMs(statePath: string): number | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"));
    if (!isRecord(parsed)) return null;
    const value = parsed["lastAttemptMs"];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch (error: unknown) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function writeAttemptStamp(statePath: string, nowMs: number): void {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify({ lastAttemptMs: nowMs })}\n`);
}

function npmCommand(): string {
  return process.env["OMO_MEMORY_NPM_COMMAND"] ?? "npm";
}

function installArgs(): readonly string[] {
  const target = process.env["OMO_MEMORY_UPDATE_TARGET"] ?? `${PACKAGE_NAME}@latest`;
  return ["install", "-g", target];
}

function updateEnv(currentVersion: string): NodeJS.ProcessEnv {
  return { ...process.env, OMO_MEMORY_AUTO_UPDATE_CHILD: "1", OMO_MEMORY_CURRENT_VERSION: currentVersion };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
