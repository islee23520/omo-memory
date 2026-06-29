import { migrate, openMemoryDb } from "./memoryDb.js";
import type { ConceptExportRow, DurableMemoryExportRow, MemoryReferenceExportRow, ProjectContext } from "./types.js";

export type OntologyRows = {
  readonly concepts: readonly ConceptExportRow[];
  readonly durableMemories: readonly DurableMemoryExportRow[];
  readonly memoryReferences: readonly MemoryReferenceExportRow[];
};

export function listOntologyRows(dbPath: string, project: ProjectContext): OntologyRows {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const concepts = db
      .prepare(
        `SELECT id, kind, label, description, aliases_json AS aliasesJson, payload_json AS payloadJson,
          valid_from AS validFrom, valid_to AS validTo, created_at AS createdAt, updated_at AS updatedAt,
          COALESCE(score, 0) AS score, COALESCE(retention_class, 'working') AS retentionClass,
          COALESCE(manual_pin, 0) AS manualPin, COALESCE(ref_count, 0) AS refCount,
          COALESCE(project_spread, 1) AS projectSpread, first_seen AS firstSeen, last_seen AS lastSeen
         FROM concepts WHERE project_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(project.id) as ConceptExportRow[];
    const durableMemories = db
      .prepare(
        `SELECT id, type, summary, body, source_event_id AS sourceEventId, source_handoff_id AS sourceHandoffId,
          confidence, status, COALESCE(retention_class, 'durable') AS retentionClass,
          valid_from AS validFrom, valid_to AS validTo, created_at AS createdAt, updated_at AS updatedAt
         FROM durable_memories WHERE project_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(project.id) as DurableMemoryExportRow[];
    const memoryReferences = db
      .prepare(
        `SELECT id, source_type AS sourceType, source_id AS sourceId, target_type AS targetType, target_id AS targetId,
          ref_kind AS refKind, weight, created_at AS createdAt
         FROM memory_references WHERE project_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(project.id) as MemoryReferenceExportRow[];
    return { concepts, durableMemories, memoryReferences };
  } finally {
    db.close();
  }
}
