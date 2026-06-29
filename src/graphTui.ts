import { spawn } from "node:child_process";
import { BoxRenderable, createCliRenderer, TextRenderable } from "@opentui/core";
import { classCode, graphContent } from "./graphTuiCanvas.js";
import type { OntologyGraph, OntologyGraphDetail, OntologyGraphNode } from "./ontologyGraph.js";

export type GraphTuiOptions = {
  readonly dbPath: string;
  readonly query?: string;
};

type GraphSnapshot = {
  readonly graph: OntologyGraph;
  readonly details: readonly OntologyGraphDetail[];
};

type GraphTuiState = {
  readonly options: GraphTuiOptions;
  readonly selectedId: string | null;
  readonly snapshot: GraphSnapshot;
};

const SNAPSHOT_ENV = "OMO_MEMORY_GRAPH_TUI_SNAPSHOT";

const COLORS = {
  background: "#101419",
  border: "#516071",
  detail: "#17212b",
  text: "#d8dee9",
  muted: "#94a3b8",
  accent: "#7dd3fc",
} as const;

export async function runGraphTui(options: GraphTuiOptions): Promise<void> {
  const existingSnapshot = parseSnapshot(process.env[SNAPSHOT_ENV]);
  if (process.versions["bun"] === undefined) {
    const graphSnapshot = existingSnapshot ?? (await createGraphSnapshot(options));
    await runWithBun(options, graphSnapshot);
    return;
  }
  if (existingSnapshot === null) {
    throw new Error("graph tui OpenTUI renderer requires a graph snapshot");
  }

  const renderer = await createCliRenderer({
    targetFps: 12,
    maxFps: 12,
    screenMode: "main-screen",
    consoleMode: "disabled",
    clearOnShutdown: false,
  });
  renderer.setTerminalTitle("OMO Ontology Graph");

  let state: GraphTuiState = { options, selectedId: null, snapshot: existingSnapshot };
  let graph = loadGraph(state);
  state = { ...state, selectedId: graph.detail?.id ?? null };

  const root = new BoxRenderable(renderer, {
    id: "graph-root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: COLORS.background,
    padding: 1,
    gap: 1,
  });
  const title = new TextRenderable(renderer, { id: "graph-title", content: "", fg: COLORS.accent, height: 1, truncate: true });
  const body = new BoxRenderable(renderer, { id: "graph-body", flexGrow: 1, flexDirection: "row", gap: 1 });
  const nodesPane = new BoxRenderable(renderer, {
    id: "graph-nodes-pane",
    width: "50%",
    height: "100%",
    border: true,
    borderColor: COLORS.border,
    title: "Nodes",
    padding: 1,
    backgroundColor: COLORS.background,
  });
  const detailPane = new BoxRenderable(renderer, {
    id: "graph-detail-pane",
    flexGrow: 1,
    height: "100%",
    border: true,
    borderColor: COLORS.border,
    title: "Detail Pane",
    padding: 1,
    backgroundColor: COLORS.detail,
  });
  const nodesText = new TextRenderable(renderer, { id: "graph-nodes", content: "", fg: COLORS.text, wrapMode: "word" });
  const detailText = new TextRenderable(renderer, { id: "graph-detail", content: "", fg: COLORS.text, wrapMode: "word" });
  const footer = new TextRenderable(renderer, { id: "graph-footer", content: "", fg: COLORS.muted, height: 1, truncate: true });

  nodesPane.add(nodesText);
  detailPane.add(detailText);
  body.add(nodesPane);
  body.add(detailPane);
  root.add(title);
  root.add(body);
  root.add(footer);
  renderer.root.add(root);

  const render = (): void => {
    graph = loadGraph(state);
    state = { ...state, selectedId: graph.detail?.id ?? null };
    title.content = titleText(graph, state.options.query);
    nodesText.content = graphContent(graph);
    detailText.content = detailContent(graph);
    footer.content = "q quit | ArrowUp/ArrowDown/Tab select | Legend: D durable, W working, T temporary, E ephemeral";
    renderer.requestRender();
  };

  await new Promise<void>((resolve) => {
    const quit = (): void => {
      renderer.keyInput.removeAllListeners("keypress");
      renderer.destroy();
      resolve();
    };
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "q" || (key.name === "c" && key.ctrl)) {
        quit();
        return;
      }
      const nextId = nextSelectedId(graph.nodes, state.selectedId, key.name);
      if (nextId !== state.selectedId) {
        state = { ...state, selectedId: nextId };
        render();
      }
    });
    writeCaptureFrame(graph, state.options.query);
    renderer.start();
    render();
  });
}

async function runWithBun(options: GraphTuiOptions, snapshot: GraphSnapshot): Promise<void> {
  const scriptPath = process.argv[1];
  if (scriptPath === undefined) throw new Error("graph tui requires a CLI script path");
  const args = [scriptPath, "graph", "tui", "--db", options.dbPath];
  if (options.query !== undefined) args.push("--query", options.query);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("bun", args, {
      stdio: "inherit",
      env: { ...process.env, [SNAPSHOT_ENV]: JSON.stringify(snapshot) },
    });
    child.once("error", (error) => {
      reject(new Error(`graph tui requires Bun for OpenTUI native FFI: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`graph tui OpenTUI runtime exited with ${signal ?? code ?? "unknown status"}`));
    });
  });
}

async function createGraphSnapshot(options: GraphTuiOptions): Promise<GraphSnapshot> {
  const { projectOntologyGraph } = await import("./ontologyGraph.js");
  const graph = projectOntologyGraph({
    dbPath: options.dbPath,
    ...(options.query === undefined ? {} : { query: options.query }),
  });
  const details = graph.detail === null ? [] : [graph.detail];
  return { graph, details };
}

function parseSnapshot(raw: string | undefined): GraphSnapshot | null {
  if (raw === undefined) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!isGraphSnapshot(parsed)) throw new Error("invalid graph tui snapshot");
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isGraphSnapshot(value: unknown): value is GraphSnapshot {
  if (!isRecord(value)) return false;
  return isRecord(value["graph"]) && Array.isArray(value["details"]);
}

function loadGraph(state: GraphTuiState): OntologyGraph {
  const selectedId = state.selectedId ?? state.snapshot.graph.detail?.id ?? state.snapshot.graph.nodes[0]?.id ?? null;
  const selectedNode = selectedId === null ? undefined : state.snapshot.graph.nodes.find((node) => node.id === selectedId);
  const detail =
    selectedId === null ? state.snapshot.graph.detail : (state.snapshot.details.find((item) => item.id === selectedId) ?? nodeDetail(selectedNode) ?? null);
  return {
    ...state.snapshot.graph,
    nodes: state.snapshot.graph.nodes.map((node) => ({ ...node, selected: node.id === selectedId })),
    detail,
  };
}

function nodeDetail(node: OntologyGraphNode | undefined): OntologyGraphDetail | null {
  if (node === undefined) return null;
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    description: node.description,
    aliases: node.aliases,
    retentionClass: node.retentionClass,
    score: node.score,
    scoreLabel: node.scoreLabel,
    refCount: node.refCount,
    projectSpread: node.projectSpread,
    firstSeen: node.firstSeen,
    lastSeen: node.lastSeen,
    project: node.project,
  };
}

function titleText(graph: OntologyGraph, query: string | undefined): string {
  const queryLabel = query === undefined ? "all concepts" : `query "${query}"`;
  return `OMO Ontology Graph - ${queryLabel} - ${graph.nodes.length} nodes / ${graph.edges.length} edges`;
}

function detailContent(graph: OntologyGraph): string {
  if (graph.detail === null) return graph.message ?? "No ontology graph data is available yet.";
  const detail = graph.detail;
  return [
    `Label: ${detail.label}`,
    `Kind: ${detail.kind}`,
    `Retention: ${classCode(detail.retentionClass)} ${detail.retentionClass}`,
    `Score: ${detail.scoreLabel}`,
    `Refs: ${detail.refCount}`,
    `Projects: ${detail.projectSpread}`,
    `First seen: ${detail.firstSeen ?? "unknown"}`,
    `Last seen: ${detail.lastSeen ?? "unknown"}`,
    `Project: ${detail.project.repoRoot}`,
    `Remote: ${detail.project.gitRemote ?? "none"}`,
    "",
    "Description:",
    detail.description ?? "none",
    "",
    `Aliases: ${detail.aliases.length === 0 ? "none" : detail.aliases.join(", ")}`,
  ].join("\n");
}

function writeCaptureFrame(graph: OntologyGraph, query: string | undefined): void {
  process.stdout.write(
    [
      titleText(graph, query),
      "",
      "Graph",
      graphContent(graph),
      "",
      "Detail",
      detailContent(graph),
      "",
      "Legend: D durable, W working, T temporary, E ephemeral",
      "",
    ].join("\n"),
  );
}

function nextSelectedId(nodes: readonly OntologyGraphNode[], selectedId: string | null, keyName: string): string | null {
  if (nodes.length === 0) return null;
  const currentIndex = Math.max(
    0,
    nodes.findIndex((node) => node.id === selectedId),
  );
  const delta = keyName === "up" ? -1 : keyName === "down" || keyName === "tab" ? 1 : 0;
  if (delta === 0) return selectedId;
  const nextIndex = (currentIndex + delta + nodes.length) % nodes.length;
  return nodes[nextIndex]?.id ?? selectedId;
}
