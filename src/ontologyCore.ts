import { randomUUID } from "node:crypto";
import { upsertProject } from "./memory.js";
import { migrate, openMemoryDb } from "./memoryDb.js";
import { redactSecrets } from "./privacy.js";
import type { ConceptExportRow, DurableMemoryExportRow, MemoryReferenceExportRow, ProjectContext } from "./types.js";

export type { OntologyRows } from "./ontologyQueries.js";
export { listOntologyRows } from "./ontologyQueries.js";
export type { SupersedeResult } from "./ontologySupersede.js";
export { supersedeDurableMemory } from "./ontologySupersede.js";

export type ConceptUpsertInput = {
  readonly kind: string;
  readonly label: string;
  readonly description?: string | null;
  readonly score?: number;
  readonly retentionClass?: string;
  readonly manualPin?: number;
};

export type DurableMemoryCreateInput = {
  readonly type: string;
  readonly summary: string;
  readonly body?: string | null;
  readonly sourceEventId?: string | null;
  readonly sourceHandoffId?: string | null;
  readonly confidence?: number;
  readonly status?: string;
  readonly retentionClass?: string;
};

export type MemoryReferenceInput = {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly refKind?: string;
  readonly weight?: number;
};

export type DurableRetentionUpdate = {
  readonly retentionClass?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

export function upsertConcept(dbPath: string, project: ProjectContext, input: ConceptUpsertInput): ConceptExportRow {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    upsertProject(db, project);
    const label = normalizeLabel(input.label);
    const now = nowIso();

    const existing = db.prepare(`SELECT id FROM concepts WHERE project_id = ? AND label = ? LIMIT 1`).get(project.id, label) as { id: string } | undefined;

    if (existing?.id) {
      db.prepare("UPDATE concepts SET last_seen = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(now, now, existing.id, project.id);

      const row = db
        .prepare(
          `SELECT id, kind, label, description, aliases_json AS aliasesJson, payload_json AS payloadJson,
             valid_from AS validFrom, valid_to AS validTo, created_at AS createdAt, updated_at AS updatedAt,
             COALESCE(score, 0) AS score, COALESCE(retention_class, 'working') AS retentionClass,
             COALESCE(manual_pin, 0) AS manualPin, COALESCE(ref_count, 0) AS refCount,
             COALESCE(project_spread, 1) AS projectSpread, first_seen AS firstSeen, last_seen AS lastSeen
            FROM concepts WHERE id = ?`,
        )
        .get(existing.id) as ConceptExportRow;
      return row;
    }

    const id = randomUUID();
    const score = input.score ?? 0;
    const retentionClass = input.retentionClass ?? "working";
    const manualPin = input.manualPin ?? 0;
    const created = now;

    db.prepare(`
      INSERT INTO concepts (
        id, project_id, kind, label, description, aliases_json, payload_json,
        valid_from, valid_to, created_at, updated_at,
        score, retention_class, manual_pin, ref_count, project_spread, first_seen, last_seen
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      project.id,
      input.kind,
      label,
      input.description ?? null,
      "[]",
      "{}",
      null,
      null,
      created,
      created,
      score,
      retentionClass,
      manualPin,
      0,
      1,
      created,
      created,
    );

    const row = db
      .prepare(
        `SELECT id, kind, label, description, aliases_json AS aliasesJson, payload_json AS payloadJson,
          valid_from AS validFrom, valid_to AS validTo, created_at AS createdAt, updated_at AS updatedAt,
          COALESCE(score, 0) AS score, COALESCE(retention_class, 'working') AS retentionClass,
          COALESCE(manual_pin, 0) AS manualPin, COALESCE(ref_count, 0) AS refCount,
          COALESCE(project_spread, 1) AS projectSpread, first_seen AS firstSeen, last_seen AS lastSeen
         FROM concepts WHERE id = ?`,
      )
      .get(id) as ConceptExportRow;
    return row;
  } finally {
    db.close();
  }
}

export function createDurableMemory(dbPath: string, project: ProjectContext, input: DurableMemoryCreateInput): DurableMemoryExportRow {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    upsertProject(db, project);
    const id = randomUUID();
    const created = nowIso();
    const redactedSummary = redactSecrets(input.summary);
    const redactedBody = input.body == null ? null : redactSecrets(input.body);
    const status = input.status ?? "active";
    const retentionClass = input.retentionClass ?? "durable";
    const confidence = input.confidence ?? 0;
    db.prepare(`
      INSERT INTO durable_memories (
        id, project_id, type, summary, body, source_event_id, source_handoff_id,
        confidence, status, retention_class, valid_from, valid_to, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      project.id,
      input.type,
      redactedSummary,
      redactedBody,
      input.sourceEventId ?? null,
      input.sourceHandoffId ?? null,
      confidence,
      status,
      retentionClass,
      null,
      null,
      created,
      created,
    );
    const row = db
      .prepare(
        `SELECT id, type, summary, body, source_event_id AS sourceEventId, source_handoff_id AS sourceHandoffId,
          confidence, status, COALESCE(retention_class, 'durable') AS retentionClass,
          valid_from AS validFrom, valid_to AS validTo, created_at AS createdAt, updated_at AS updatedAt
         FROM durable_memories WHERE id = ?`,
      )
      .get(id) as DurableMemoryExportRow;
    return row;
  } finally {
    db.close();
  }
}

export function recordMemoryReference(dbPath: string, project: ProjectContext, input: MemoryReferenceInput): MemoryReferenceExportRow {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    upsertProject(db, project);
    const id = randomUUID();
    const created = nowIso();
    const refKind = input.refKind ?? "mentions";
    const weight = input.weight ?? 1;
    const inserted = db
      .prepare(`
      INSERT INTO memory_references (
        id, project_id, source_type, source_id, target_type, target_id, ref_kind, weight, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, source_type, source_id, target_type, target_id, ref_kind) DO NOTHING
    `)
      .run(id, project.id, input.sourceType, input.sourceId, input.targetType, input.targetId, refKind, weight, created);
    if (inserted.changes > 0 && input.targetType === "concept") {
      db.prepare("UPDATE concepts SET ref_count = COALESCE(ref_count, 0) + 1, last_seen = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(
        created,
        created,
        input.targetId,
        project.id,
      );
    }
    const row = db
      .prepare(
        `SELECT id, source_type AS sourceType, source_id AS sourceId, target_type AS targetType, target_id AS targetId,
          ref_kind AS refKind, weight, created_at AS createdAt
         FROM memory_references
         WHERE project_id = ? AND source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND ref_kind = ?`,
      )
      .get(project.id, input.sourceType, input.sourceId, input.targetType, input.targetId, refKind) as MemoryReferenceExportRow;
    return row;
  } finally {
    db.close();
  }
}

export function updateDurableRetention(dbPath: string, project: ProjectContext, durableId: string, update: DurableRetentionUpdate): DurableMemoryExportRow {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const existing = db.prepare("SELECT retention_class FROM durable_memories WHERE id = ? AND project_id = ?").get(durableId, project.id) as
      | { retention_class?: string }
      | undefined;
    if (!existing) {
      throw new Error("durable memory not found for project");
    }
    const now = nowIso();
    db.prepare("UPDATE durable_memories SET retention_class = COALESCE(?, retention_class), updated_at = ? WHERE id = ? AND project_id = ?").run(
      update.retentionClass ?? null,
      now,
      durableId,
      project.id,
    );
    const row = db
      .prepare(
        `SELECT id, type, summary, body, source_event_id AS sourceEventId, source_handoff_id AS sourceHandoffId,
          confidence, status, COALESCE(retention_class, 'durable') AS retentionClass,
          valid_from AS validFrom, valid_to AS validTo, created_at AS createdAt, updated_at AS updatedAt
         FROM durable_memories WHERE id = ?`,
      )
      .get(durableId) as DurableMemoryExportRow;
    return row;
  } finally {
    db.close();
  }
}
