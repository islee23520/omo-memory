#!/usr/bin/env node
/**
 * Focused verification for Todo 4 deterministic concept extraction + ref counting.
 * Real dist/ + temp DB. RED-first capture then GREEN after impl.
 *
 * Acceptance:
 * - extractConceptCandidates + applyConceptExtraction available from dist
 * - repeated domain terms ("ontology", "local-first", "Linaforge") across events -> concepts with refCount >= 2
 * - memory_references link event -> concept
 * - generic hook-only summaries produce zero candidates
 * - no raw transcript blobs promoted (we only feed short summaries)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);

async function main() {
  console.log("=== VERIFY-CONCEPT-EXTRACTION START ===");
  let conceptExtraction;
  let ontologyCore;
  let memoryMod;
  let memoryDbMod;

  try {
    conceptExtraction = await import(join(root, "dist", "conceptExtraction.js"));
  } catch (e) {
    const msg = String(e?.message ? e.message : e);
    console.error("RED BASELINE: conceptExtraction.js import failed");
    console.error(msg);
    console.error("This is the expected failing-first state before implementation.");
    process.exit(2);
  }

  try {
    ontologyCore = await import(join(root, "dist", "ontologyCore.js"));
  } catch (_e) {
    console.error("RED: ontologyCore import failed");
    process.exit(2);
  }
  try {
    memoryMod = await import(join(root, "dist", "memory.js"));
  } catch (_e) {
    console.error("RED: memory.js import failed");
    process.exit(2);
  }
  try {
    memoryDbMod = await import(join(root, "dist", "memoryDb.js"));
  } catch (_e) {
    console.error("RED: memoryDb.js import failed");
    process.exit(2);
  }

  const { extractConceptCandidates, applyConceptExtraction } = conceptExtraction;
  if (typeof extractConceptCandidates !== "function") {
    console.error("RED: extractConceptCandidates missing");
    process.exit(3);
  }
  if (typeof applyConceptExtraction !== "function") {
    console.error("RED: applyConceptExtraction missing");
    process.exit(3);
  }
  const { listOntologyRows } = ontologyCore;

  const tempRoot = mkdtempSync(join(tmpdir(), "omo-t4-extract-"));
  const dbPath = join(tempRoot, "state.sqlite");

  const db = new (await import("better-sqlite3")).default(dbPath); // dynamic to avoid top-level
  try {
    memoryDbMod.migrate(db);
  } finally {
    db.close();
  }

  const project = {
    id: "qa-t4-project",
    repoRoot: tempRoot,
    gitRemote: "https://example.com/linaforge.git",
    gitBranch: "main",
    gitHead: "abc1234",
  };

  // Seed repeated meaningful summaries (short, decision-style, no transcript blobs)
  const goodEvents = [
    { type: "decision", summary: "Chose ontology schema with local-first guarantees for Linaforge" },
    { type: "decision", summary: "Refined ontology + local-first rules; Linaforge benefits" },
    { type: "qa", summary: "Linaforge ontology extraction now produces stable candidates across events" },
  ];

  const seeded = [];
  for (const ev of goodEvents) {
    const r = memoryMod.recordEvent({ type: ev.type, summary: ev.summary }, dbPath);
    seeded.push({ eventId: r.eventId, ...ev });
  }

  // Generic-only hook words event (should yield zero candidates)
  const genericEvent = memoryMod.recordEvent(
    {
      type: "action",
      summary: "user asked for help with the current session please start work now",
    },
    dbPath,
  );

  console.log("SEED good events:", seeded.length, "generic:", genericEvent.eventId);

  // Run extraction on the good events
  const extracted = [];
  for (const s of seeded) {
    const res = applyConceptExtraction(dbPath, project, s.eventId, s.summary, s.type);
    extracted.push(res);
  }

  // Direct candidate probe
  const probe = extractConceptCandidates("ontology local-first Linaforge local-first design", "decision");
  console.log("PROBE candidates:", probe);

  // Inspect via listOntologyRows (explicit project)
  const rows = listOntologyRows(dbPath, project);
  const byLabel = new Map(rows.concepts.map((c) => [c.label, c]));
  const ontologyRow = byLabel.get("ontology");
  const localFirstRow = byLabel.get("local-first");
  const linaforgeRow = byLabel.get("linaforge");

  console.log(
    "CONCEPTS FOUND:",
    rows.concepts.map((c) => ({ label: c.label, refCount: c.refCount })),
  );

  if (!ontologyRow || !localFirstRow || !linaforgeRow) {
    console.error("FAIL: expected concepts not created for repeated terms");
    console.error(
      "labels:",
      rows.concepts.map((c) => c.label),
    );
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(4);
  }
  if (ontologyRow.refCount < 2 || localFirstRow.refCount < 2 || linaforgeRow.refCount < 2) {
    console.error("FAIL: refCount < 2 for repeated terms", {
      ontology: ontologyRow.refCount,
      localFirst: localFirstRow.refCount,
      linaforge: linaforgeRow.refCount,
    });
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(5);
  }
  console.log("HAPPY refCount check PASS >=2");

  // memory_references must link events to concepts
  const conceptRefs = rows.memoryReferences.filter((r) => r.targetType === "concept" && r.sourceType === "event");
  if (conceptRefs.length < 2) {
    console.error("FAIL: too few event->concept memory_references", conceptRefs.length);
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(6);
  }
  console.log("MEMORY_REFS to concepts:", conceptRefs.length, "PASS");

  for (const s of seeded) {
    applyConceptExtraction(dbPath, project, s.eventId, s.summary, s.type);
  }
  const rowsAfterRepeat = listOntologyRows(dbPath, project);
  const refsAfterRepeat = rowsAfterRepeat.memoryReferences.filter((r) => r.targetType === "concept" && r.sourceType === "event");
  const repeatedOntology = rowsAfterRepeat.concepts.find((c) => c.label === "ontology");
  if (refsAfterRepeat.length !== conceptRefs.length || repeatedOntology?.refCount !== ontologyRow.refCount) {
    console.error("FAIL: repeated extraction changed references/refCount", {
      beforeRefs: conceptRefs.length,
      afterRefs: refsAfterRepeat.length,
      beforeRefCount: ontologyRow.refCount,
      afterRefCount: repeatedOntology?.refCount,
    });
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(7);
  }
  console.log("IDEMPOTENT extraction PASS");

  // Generic-only must produce zero candidates
  const zeroCands = extractConceptCandidates(genericEvent.summary || "user asked current session action help please the and for with", "action");
  if (zeroCands.length !== 0) {
    console.error("FAIL: generic hook words produced candidates:", zeroCands);
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(8);
  }
  console.log("ZERO candidates for generic-only PASS");

  // Ensure we never promoted raw long blobs: concepts only hold normalized labels (not full summaries)
  const hasLongLabel = rows.concepts.some((c) => c.label && c.label.length > 80);
  if (hasLongLabel) {
    console.error("FAIL: suspiciously long label stored (possible blob leak)");
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(9);
  }
  console.log("NO long labels (anti-blob) PASS");

  // Cleanup
  rmSync(tempRoot, { recursive: true, force: true });
  console.log("CLEANUP receipt: removed", tempRoot);

  console.log("\nVERIFY PASS (deterministic extraction + reference counting + redaction boundary respected)");
  process.exit(0);
}

main().catch((e) => {
  console.error("UNEXPECTED", e);
  process.exit(99);
});
