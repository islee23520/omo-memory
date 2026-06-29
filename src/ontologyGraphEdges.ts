import type Database from "better-sqlite3";
import type { OntologyGraphEdge, OntologyGraphProject } from "./ontologyGraph.js";
import { redactSecrets, sanitizeGitRemote } from "./privacy.js";

type RelationRow = {
  readonly id: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relation: string;
  readonly weight: number;
  readonly repoRoot: string;
  readonly gitRemote: string | null;
};

export function readGraphEdges(db: Database.Database, conceptIds: ReadonlySet<string>): readonly OntologyGraphEdge[] {
  const relationRows = db
    .prepare(`
      SELECT r.id, r.project_id AS projectId, r.source_id AS sourceId, r.target_id AS targetId,
        r.relation, COALESCE(r.weight, 1) AS weight, p.repo_root AS repoRoot, p.git_remote AS gitRemote
      FROM relations r
      JOIN projects p ON p.id = r.project_id
      WHERE r.source_type = 'concept' AND r.target_type = 'concept' AND r.valid_to IS NULL
      ORDER BY lower(r.relation) ASC, r.id ASC
    `)
    .all()
    .map(parseRelationRow)
    .filter((row) => conceptIds.has(row.sourceId) && conceptIds.has(row.targetId));
  const edgeRows = relationRows.length === 0 ? readCoOccurrenceRows(db, conceptIds) : relationRows;
  return edgeRows.map(toEdge);
}

function readCoOccurrenceRows(db: Database.Database, conceptIds: ReadonlySet<string>): readonly RelationRow[] {
  return db
    .prepare(`
      SELECT 'co:' || a.target_id || ':' || b.target_id AS id,
        a.project_id AS projectId, a.target_id AS sourceId, b.target_id AS targetId,
        'co_occurs' AS relation, COUNT(*) AS weight, p.repo_root AS repoRoot, p.git_remote AS gitRemote
      FROM memory_references a
      JOIN memory_references b
        ON b.project_id = a.project_id
        AND b.source_type = a.source_type
        AND b.source_id = a.source_id
        AND b.target_type = 'concept'
        AND a.target_id < b.target_id
      JOIN projects p ON p.id = a.project_id
      WHERE a.source_type = 'event' AND a.target_type = 'concept'
      GROUP BY a.project_id, a.target_id, b.target_id
      ORDER BY COUNT(*) DESC, a.target_id ASC, b.target_id ASC
      LIMIT 160
    `)
    .all()
    .map(parseRelationRow)
    .filter((row) => conceptIds.has(row.sourceId) && conceptIds.has(row.targetId));
}

function parseRelationRow(value: unknown): RelationRow {
  if (!isRecord(value)) throw new Error("invalid relation row");
  return {
    id: text(value["id"]),
    projectId: text(value["projectId"]),
    sourceId: text(value["sourceId"]),
    targetId: text(value["targetId"]),
    relation: text(value["relation"]),
    weight: numberValue(value["weight"]),
    repoRoot: text(value["repoRoot"]),
    gitRemote: nullableText(value["gitRemote"]),
  };
}

function toEdge(row: RelationRow): OntologyGraphEdge {
  const weight = Number(row.weight.toFixed(2));
  const relation = redactSecrets(row.relation);
  return {
    id: row.id,
    sourceId: row.sourceId,
    targetId: row.targetId,
    relation,
    label: `${relation} ${weight.toFixed(2)}`,
    weight,
    project: projectFrom(row),
  };
}

function projectFrom(row: RelationRow): OntologyGraphProject {
  return {
    id: row.projectId,
    repoRoot: redactSecrets(row.repoRoot),
    gitRemote: sanitizeGitRemote(row.gitRemote),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0);
}
