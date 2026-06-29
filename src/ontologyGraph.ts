import { migrate, openMemoryDb } from "./memoryDb.js";
import { readGraphEdges } from "./ontologyGraphEdges.js";
import { redactSecrets, sanitizeGitRemote } from "./privacy.js";

export type OntologyGraphInput = {
  readonly dbPath: string;
  readonly query?: string;
  readonly selectedId?: string;
};

export type OntologyGraphProject = {
  readonly id: string;
  readonly repoRoot: string;
  readonly gitRemote: string | null;
};

export type OntologyGraphNode = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string | null;
  readonly aliases: readonly string[];
  readonly retentionClass: string;
  readonly score: number;
  readonly scoreLabel: string;
  readonly refCount: number;
  readonly projectSpread: number;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly project: OntologyGraphProject;
  readonly selected: boolean;
};

export type OntologyGraphEdge = {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relation: string;
  readonly label: string;
  readonly weight: number;
  readonly project: OntologyGraphProject;
};

export type OntologyGraphDetail = {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly description: string | null;
  readonly aliases: readonly string[];
  readonly retentionClass: string;
  readonly score: number;
  readonly scoreLabel: string;
  readonly refCount: number;
  readonly projectSpread: number;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly project: OntologyGraphProject;
};

export type OntologyGraph = {
  readonly nodes: readonly OntologyGraphNode[];
  readonly edges: readonly OntologyGraphEdge[];
  readonly detail: OntologyGraphDetail | null;
  readonly message: string | null;
};

type ConceptRow = {
  readonly id: string;
  readonly projectId: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string | null;
  readonly aliases: readonly string[];
  readonly score: number;
  readonly retentionClass: string;
  readonly refCount: number;
  readonly projectSpread: number;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly repoRoot: string;
  readonly gitRemote: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function parseAliases(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").map(redactSecrets);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0);
}

function projectFrom(row: ConceptRow): OntologyGraphProject {
  return {
    id: row.projectId,
    repoRoot: redactSecrets(row.repoRoot),
    gitRemote: sanitizeGitRemote(row.gitRemote),
  };
}

function parseConceptRow(value: unknown): ConceptRow {
  if (!isRecord(value)) {
    throw new Error("invalid concept row");
  }
  return {
    id: text(value["id"]),
    projectId: text(value["projectId"]),
    kind: text(value["kind"]),
    label: text(value["label"]),
    description: nullableText(value["description"]),
    aliases: parseAliases(value["aliasesJson"]),
    score: numberValue(value["score"]),
    retentionClass: text(value["retentionClass"]),
    refCount: numberValue(value["refCount"]),
    projectSpread: numberValue(value["projectSpread"]),
    firstSeen: nullableText(value["firstSeen"]),
    lastSeen: nullableText(value["lastSeen"]),
    repoRoot: text(value["repoRoot"]),
    gitRemote: nullableText(value["gitRemote"]),
  };
}

function matchesQuery(row: ConceptRow, query: string): boolean {
  const haystack = `${row.label}\n${row.description ?? ""}\n${row.aliases.join("\n")}`.toLowerCase();
  return haystack.includes(query);
}

function toNode(row: ConceptRow, selectedId: string | null): OntologyGraphNode {
  const score = Math.round(row.score);
  const retentionClass = redactSecrets(row.retentionClass);
  return {
    id: row.id,
    kind: redactSecrets(row.kind),
    label: redactSecrets(row.label),
    description: row.description === null ? null : redactSecrets(row.description),
    aliases: row.aliases,
    retentionClass,
    score,
    scoreLabel: `${score} ${retentionClass}`,
    refCount: Math.round(row.refCount),
    projectSpread: Math.round(row.projectSpread),
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    project: projectFrom(row),
    selected: selectedId === row.id,
  };
}

function toDetail(row: ConceptRow): OntologyGraphDetail {
  const score = Math.round(row.score);
  const retentionClass = redactSecrets(row.retentionClass);
  return {
    id: row.id,
    label: redactSecrets(row.label),
    kind: redactSecrets(row.kind),
    description: row.description === null ? null : redactSecrets(row.description),
    aliases: row.aliases,
    retentionClass,
    score,
    scoreLabel: `${score} ${retentionClass}`,
    refCount: Math.round(row.refCount),
    projectSpread: Math.round(row.projectSpread),
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    project: projectFrom(row),
  };
}

export function projectOntologyGraph(options: OntologyGraphInput): OntologyGraph {
  const db = openMemoryDb(options.dbPath);
  try {
    migrate(db);
    const query = options.query?.trim().toLowerCase() ?? "";
    const conceptRows = db
      .prepare(`
        SELECT c.id, c.project_id AS projectId, c.kind, c.label, c.description, c.aliases_json AS aliasesJson,
          COALESCE(c.score, 0) AS score, COALESCE(c.retention_class, 'working') AS retentionClass,
          COALESCE(c.ref_count, 0) AS refCount, COALESCE(c.project_spread, 1) AS projectSpread,
          c.first_seen AS firstSeen, c.last_seen AS lastSeen,
          p.repo_root AS repoRoot, p.git_remote AS gitRemote
        FROM concepts c
        JOIN projects p ON p.id = c.project_id
        WHERE c.valid_to IS NULL
        ORDER BY lower(c.label) ASC, c.id ASC
      `)
      .all()
      .map(parseConceptRow)
      .filter((row) => query === "" || matchesQuery(row, query));
    const conceptIds = new Set(conceptRows.map((row) => row.id));
    const selectedId = options.selectedId && conceptIds.has(options.selectedId) ? options.selectedId : (conceptRows[0]?.id ?? null);
    const nodes = conceptRows.map((row) => toNode(row, selectedId));
    const selectedRow = selectedId === null ? undefined : conceptRows.find((row) => row.id === selectedId);
    return {
      nodes,
      edges: readGraphEdges(db, conceptIds),
      detail: selectedRow === undefined ? null : toDetail(selectedRow),
      message: nodes.length === 0 ? "No ontology graph data is available yet." : null,
    };
  } finally {
    db.close();
  }
}
