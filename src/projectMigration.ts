import type Database from "better-sqlite3";
import type { ProjectContext } from "./types.js";

type ProjectRow = {
  readonly id: string;
  readonly repo_root: string;
  readonly git_remote: string | null;
  readonly created_at: string;
};

export function resolveStoredProject(db: Database.Database, project: ProjectContext): ProjectContext {
  const current = readProjectById(db, project.id);
  if (current !== undefined) {
    updateProjectMetadata(db, project);
    return project;
  }

  const candidate = findMovedProjectCandidate(db, project);
  if (candidate === undefined || candidate.id === project.id) return project;

  updateProjectMetadata(db, { ...project, id: candidate.id });
  return { ...project, id: candidate.id };
}

function findMovedProjectCandidate(db: Database.Database, project: ProjectContext): ProjectRow | undefined {
  const byRoot = readProjectByRepoRoot(db, project.repoRoot);
  if (byRoot !== undefined) return byRoot;

  if (project.gitRemote !== null) {
    const byRemote = readProjectByGitRemote(db, project.gitRemote);
    if (byRemote !== undefined) return byRemote;
  }

  const allProjects = db
    .prepare("SELECT id, repo_root, git_remote, created_at FROM projects ORDER BY last_seen_at DESC, created_at DESC")
    .all() as ProjectRow[];
  return allProjects.length === 1 ? allProjects[0] : undefined;
}

function readProjectById(db: Database.Database, id: string): ProjectRow | undefined {
  return db.prepare("SELECT id, repo_root, git_remote, created_at FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

function readProjectByRepoRoot(db: Database.Database, repoRoot: string): ProjectRow | undefined {
  return db.prepare("SELECT id, repo_root, git_remote, created_at FROM projects WHERE repo_root = ?").get(repoRoot) as ProjectRow | undefined;
}

function readProjectByGitRemote(db: Database.Database, gitRemote: string): ProjectRow | undefined {
  return db
    .prepare("SELECT id, repo_root, git_remote, created_at FROM projects WHERE git_remote = ? ORDER BY last_seen_at DESC, created_at DESC")
    .get(gitRemote) as ProjectRow | undefined;
}

function updateProjectMetadata(db: Database.Database, project: ProjectContext): void {
  db.prepare("UPDATE projects SET repo_root = ?, git_remote = ?, last_seen_at = ? WHERE id = ?").run(
    project.repoRoot,
    project.gitRemote,
    new Date().toISOString(),
    project.id,
  );
}
