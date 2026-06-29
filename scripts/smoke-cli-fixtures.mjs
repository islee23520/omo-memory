import Database from "better-sqlite3";

export function seedOntologyFixture(dbPath, projectId, sourceEventId) {
  const db = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO concepts (id, project_id, kind, label, description, aliases_json, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("concept-smoke", projectId, "practice", "Local ledger", "Project-local durable memory", '["ledger"]', "{}", now, now);
    db.prepare(
      "INSERT INTO durable_memories (id, project_id, type, summary, body, source_event_id, confidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("memory-smoke", projectId, "preference", "Prefer local-first memory", "Keep OMO Memory local by default", sourceEventId, 0.9, "active", now, now);
    db.prepare(
      "INSERT INTO decision_records (id, project_id, title, rationale, status, source_event_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("decision-smoke", projectId, "Use ontology schema", "Graph-shaped memory needs first-class rows", "active", sourceEventId, now, now);
    db.prepare(
      "INSERT INTO relations (id, project_id, source_type, source_id, target_type, target_id, relation, weight, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("relation-smoke", projectId, "decision_record", "decision-smoke", "concept", "concept-smoke", "describes", 1, "{}", now, now);
  } finally {
    db.close();
  }
}
