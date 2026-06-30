import { migrate, openMemoryDb, tableExists } from "./memoryDb.js";
import { defaultDbPath, resolveProjectContext } from "./projectContext.js";
import { resolveStoredProject } from "./projectMigration.js";
import type { DoctorReport, MemoryPaths } from "./types.js";

export function memoryPaths(): MemoryPaths {
  return { dbPath: defaultDbPath() };
}

export function doctorReport(dbPath = defaultDbPath()): DoctorReport {
  const db = openMemoryDb(dbPath);
  try {
    migrate(db);
    const project = resolveStoredProject(db, resolveProjectContext());
    const schemaVersion = Number(db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").pluck().get());
    const count = (table: string): number => (tableExists(db, table) ? Number(db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()) : 0);
    return {
      paths: { dbPath },
      schemaVersion,
      project,
      counts: {
        projects: count("projects"),
        sessions: count("sessions"),
        events: count("events"),
        handoffs: count("handoffs"),
        concepts: count("concepts"),
        relations: count("relations"),
        durableMemories: count("durable_memories"),
        decisionRecords: count("decision_records"),
      },
    };
  } finally {
    db.close();
  }
}
