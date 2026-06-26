import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { sanitizeGitRemote } from "./privacy.js";
import type { ProjectContext } from "./types.js";

export function defaultDbPath(): string {
  return process.env["OMO_MEMORY_DB"] ?? join(resolveProjectContext().repoRoot, ".omo", "memory", "state.sqlite");
}

export function resolveProjectContext(cwd = process.cwd()): ProjectContext {
  const repoRoot = gitValue(["rev-parse", "--show-toplevel"], cwd) ?? resolve(cwd);
  const rawGitRemote = gitValue(["config", "--get", "remote.origin.url"], repoRoot);
  const gitRemote = sanitizeGitRemote(rawGitRemote);
  const gitBranch = gitValue(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
  const gitHead = gitValue(["rev-parse", "HEAD"], repoRoot);
  const id = createHash("sha256")
    .update(`${rawGitRemote ?? ""}\n${repoRoot}`)
    .digest("hex")
    .slice(0, 24);
  return { id, repoRoot, gitRemote, gitBranch, gitHead };
}

function gitValue(args: readonly string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}
