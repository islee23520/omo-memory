import { migrate, openMemoryDb } from "./memoryDb.js";
import { defaultDbPath, resolveProjectContext } from "./projectContext.js";
import { resolveStoredProject } from "./projectMigration.js";
import type { MemoryRecallInput, RecentEvent } from "./types.js";

export function recallEvents(input: MemoryRecallInput, dbPath = defaultDbPath()): readonly RecentEvent[] {
  const terms = recallTerms(input.query);
  if (terms.length === 0) return [];

  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveStoredProject(db, resolveProjectContext());
    const minimumMatches = Math.min(2, terms.length);
    const score = terms.map(() => "CASE WHEN LOWER(summary) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END").join(" + ");
    const patternArgs = terms.map((term) => `%${escapeLikeTerm(term)}%`);
    return db
      .prepare(`
      SELECT id, type, summary, created_at AS createdAt, session_id AS sessionId
      FROM events
      WHERE project_id = ? AND (${score}) >= ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
      .all(project.id, ...patternArgs, minimumMatches, input.limit) as RecentEvent[];
  } finally {
    db.close();
  }
}

function recallTerms(query: string): readonly string[] {
  return Array.from(new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []))
    .filter((term) => !GENERIC_RECALL_TERMS.has(term))
    .slice(0, 8);
}

function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const GENERIC_RECALL_TERMS = new Set([
  "action",
  "asked",
  "current",
  "help",
  "memory",
  "need",
  "needs",
  "omo",
  "please",
  "prompt",
  "request",
  "requested",
  "session",
  "user",
  "want",
  "wants",
  "work",
  "working",
]);
