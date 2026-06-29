#!/usr/bin/env node
/**
 * Focused verification for Todo 2 ontology core APIs.
 * Runs against real dist/ exports + temp SQLite DBs.
 * RED first: fails because core functions do not exist / cannot redact/create durable from secret.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);

async function main() {
  let ontologyCore;
  let memoryMod;
  let memoryDbMod;

  try {
    ontologyCore = await import(join(root, "dist", "ontologyCore.js"));
  } catch (e) {
    console.error("RED BASELINE: ontologyCore.js missing or failed to import");
    console.error(String(e?.message ? e.message : e));
    process.exit(2);
  }
  try {
    memoryMod = await import(join(root, "dist", "memory.js"));
  } catch (e) {
    console.error("RED: memory.js import failed");
    console.error(String(e?.message ? e.message : e));
    process.exit(2);
  }
  try {
    memoryDbMod = await import(join(root, "dist", "memoryDb.js"));
  } catch (e) {
    console.error("RED: memoryDb.js import failed");
    console.error(String(e?.message ? e.message : e));
    process.exit(2);
  }

  const { upsertConcept, createDurableMemory, recordMemoryReference, listOntologyRows, updateDurableRetention, supersedeDurableMemory } = ontologyCore;
  if (typeof upsertConcept !== "function") {
    console.error("RED: upsertConcept missing");
    process.exit(3);
  }
  if (typeof createDurableMemory !== "function") {
    console.error("RED: createDurableMemory missing");
    process.exit(3);
  }
  if (typeof recordMemoryReference !== "function") {
    console.error("RED: recordMemoryReference missing");
    process.exit(3);
  }
  if (typeof listOntologyRows !== "function") {
    console.error("RED: listOntologyRows missing");
    process.exit(3);
  }
  if (typeof supersedeDurableMemory !== "function") {
    console.error("RED: supersedeDurableMemory missing");
    process.exit(3);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "omo-t2-verify-"));
  const dbPath = join(tempRoot, "state.sqlite");

  const db = new Database(dbPath);
  try {
    memoryDbMod.migrate(db);
  } finally {
    db.close();
  }

  const project = {
    id: "qa-t2-project",
    repoRoot: tempRoot,
    gitRemote: "https://example.com/test.git",
    gitBranch: "main",
    gitHead: "deadbeef",
  };

  const sess = memoryMod.startSession({ host: "codex", adapter: "verify-t2" }, dbPath);
  const ev = memoryMod.recordEvent({ type: "decision", summary: "Core API redaction test with secret Bearer abc.def.123 and sk-test-secret-value" }, dbPath);

  console.log("SEED session:", sess.sessionId, "event:", ev.eventId);

  const concept = upsertConcept(dbPath, project, { kind: "term", label: "redaction-test", score: 42, retentionClass: "working" });
  if (!concept?.id) throw new Error("upsertConcept did not return id");
  console.log("UPSERT concept:", concept.id, concept.label);

  const secretBody = "Bearer abc.def.123 sk-test-secret-value password=supersecret123";
  const dm = createDurableMemory(dbPath, project, {
    type: "preference",
    summary: "Redacted durable memory test",
    body: secretBody,
    sourceEventId: ev.eventId,
    confidence: 0.95,
    status: "active",
  });
  if (!dm?.id) throw new Error("createDurableMemory failed");
  console.log("CREATE durable:", dm.id, "body-len-from-return:", (dm.body || "").length);

  // Use listOntologyRows (explicit project) for assertions on temp project data.
  // exportMemory() resolves default project context and would miss the explicit-project rows.
  const rowsAfterCreate = listOntologyRows(dbPath, project);
  const dmRow = rowsAfterCreate.durableMemories.find((d) => d.id === dm.id);
  const bodyStr = dmRow?.body ? dmRow.body : "";
  if (bodyStr.includes("abc.def.123") || bodyStr.includes("sk-test-secret-value") || bodyStr.includes("supersecret123")) {
    console.error("FAIL: raw secret present in stored body:", bodyStr);
    process.exit(4);
  }
  if (!bodyStr.includes("[REDACTED]")) {
    console.error("FAIL: [REDACTED] not present in body:", bodyStr);
    process.exit(4);
  }
  console.log("REDACTION PASS: body contains [REDACTED] and no raw secrets. body=", JSON.stringify(bodyStr));

  const ref = recordMemoryReference(dbPath, project, {
    sourceType: "event",
    sourceId: ev.eventId,
    targetType: "durable_memory",
    targetId: dm.id,
    refKind: "derives",
    weight: 1,
  });
  if (!ref?.id) throw new Error("recordMemoryReference failed");
  console.log("RECORD ref:", ref.id);

  const rows = listOntologyRows(dbPath, project);
  if (!rows || !Array.isArray(rows.concepts) || rows.concepts.length < 1) throw new Error("listOntologyRows concepts missing");
  if (!rows.durableMemories || rows.durableMemories.length < 1) throw new Error("listOntologyRows durable missing");
  if (!rows.memoryReferences || rows.memoryReferences.length < 1) throw new Error("listOntologyRows refs missing");
  console.log("LIST counts c=", rows.concepts.length, "dm=", rows.durableMemories.length, "refs=", rows.memoryReferences.length);

  const updated = updateDurableRetention(dbPath, project, dm.id, { retentionClass: "durable" });
  if (updated?.retentionClass !== "durable") throw new Error("updateDurableRetention failed");
  console.log("UPDATE retention:", updated.id, updated.retentionClass);

  const sup = supersedeDurableMemory(dbPath, project, dm.id, { reason: "test-supersede", newSummary: "Superseded version" });
  if (!sup?.supersedingId) throw new Error("supersedeDurableMemory failed");
  const afterSupRows = listOntologyRows(dbPath, project);
  const orig = afterSupRows.durableMemories.find((d) => d.id === dm.id);
  if (!orig) throw new Error("original durable disappeared (hard delete)");
  const superseded = afterSupRows.durableMemories.find((d) => d.id === sup.supersedingId);
  if (!superseded) throw new Error("superseding durable not created");
  const origStatusInactive = orig.status === "superseded" || orig.status === "inactive" || !!orig.validTo;
  if (!origStatusInactive) {
    console.error("FAIL: original not marked superseded/inactive/valid_to:", orig);
    process.exit(5);
  }
  console.log("SUPERSEDE PASS: original remains status=", orig.status, "validTo=", orig.validTo, "new=", superseded.id);

  rmSync(tempRoot, { recursive: true, force: true });
  console.log("CLEANUP: removed", tempRoot);

  console.log("\nVERIFY PASS (ontology core APIs + redaction + supersede + provenance explicit)");
  process.exit(0);
}

main().catch((e) => {
  console.error("UNEXPECTED", e);
  process.exit(99);
});
