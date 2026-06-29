import type { OntologyGraph, OntologyGraphNode } from "./ontologyGraph.js";

const GRAPH_WIDTH = 66;
const GRAPH_HEIGHT = 24;
const NODE_LIMIT = 28;

type GraphPoint = {
  readonly x: number;
  readonly y: number;
};

export function graphContent(graph: OntologyGraph): string {
  if (graph.nodes.length === 0) return graph.message ?? "No ontology graph data is available yet.";
  const drawnNodes = graph.nodes.slice(0, NODE_LIMIT);
  const positions = layoutNodes(drawnNodes);
  const rows = Array.from({ length: GRAPH_HEIGHT }, () => Array.from({ length: GRAPH_WIDTH }, () => " "));
  for (const edge of graph.edges) {
    const source = positions.get(edge.sourceId);
    const target = positions.get(edge.targetId);
    if (source === undefined || target === undefined) continue;
    drawEdge(rows, source, target);
  }
  for (const node of drawnNodes) {
    const position = positions.get(node.id);
    if (position === undefined) continue;
    drawNode(rows, node, position);
  }
  const graphLines = rows.map((row) => row.join("").trimEnd());
  const legend = drawnNodes.map((node) => nodeLine(node));
  return [...graphLines, "", "Nodes", ...legend, "", "Relations", ...relationLines(graph, positions)].join("\n");
}

export function nodeLine(node: OntologyGraphNode): string {
  const marker = node.selected ? ">" : " ";
  return `${marker} ${classCode(node.retentionClass)} ${node.label} (${node.kind}, ${node.scoreLabel}, refs ${node.refCount})`;
}

export function classCode(retentionClass: string): string {
  const normalized = retentionClass.toLowerCase();
  if (normalized === "durable") return "D";
  if (normalized === "temporary") return "T";
  if (normalized === "ephemeral") return "E";
  return "W";
}

function layoutNodes(nodes: readonly OntologyGraphNode[]): ReadonlyMap<string, GraphPoint> {
  const centerX = Math.floor(GRAPH_WIDTH / 2);
  const centerY = Math.floor(GRAPH_HEIGHT / 2);
  const radiusX = Math.max(8, Math.floor(GRAPH_WIDTH / 2) - 8);
  const radiusY = Math.max(4, Math.floor(GRAPH_HEIGHT / 2) - 3);
  const positions = new Map<string, GraphPoint>();
  nodes.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / Math.max(1, nodes.length);
    const scorePull = Math.max(0.55, 1 - Math.min(90, node.score) / 220);
    positions.set(node.id, {
      x: clamp(Math.round(centerX + Math.cos(angle) * radiusX * scorePull), 2, GRAPH_WIDTH - 3),
      y: clamp(Math.round(centerY + Math.sin(angle) * radiusY * scorePull), 1, GRAPH_HEIGHT - 2),
    });
  });
  return positions;
}

function drawEdge(rows: string[][], source: GraphPoint, target: GraphPoint): void {
  const steps = Math.max(Math.abs(target.x - source.x), Math.abs(target.y - source.y), 1);
  for (let index = 1; index < steps; index += 1) {
    const x = Math.round(source.x + ((target.x - source.x) * index) / steps);
    const y = Math.round(source.y + ((target.y - source.y) * index) / steps);
    const row = rows[y];
    const current = row?.[x];
    if (row === undefined || current === undefined || current !== " ") continue;
    row[x] = edgeGlyph(source, target);
  }
}

function edgeGlyph(source: GraphPoint, target: GraphPoint): string {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) > Math.abs(dy) * 2) return "-";
  if (Math.abs(dy) > Math.abs(dx) * 2) return "|";
  return dx * dy > 0 ? "\\" : "/";
}

function drawNode(rows: string[][], node: OntologyGraphNode, point: GraphPoint): void {
  const glyph = node.selected ? "●" : classCode(node.retentionClass);
  const label = `${glyph}${shortLabel(node.label)}`;
  const startX = clamp(point.x - Math.floor(label.length / 2), 0, Math.max(0, GRAPH_WIDTH - label.length));
  for (let index = 0; index < label.length; index += 1) {
    const row = rows[point.y];
    if (row === undefined) continue;
    row[startX + index] = label[index] ?? " ";
  }
}

function shortLabel(label: string): string {
  const compact = label.replace(/\s+/g, " ").trim();
  return compact.length <= 11 ? compact : compact.slice(0, 10);
}

function relationLines(graph: OntologyGraph, positions: ReadonlyMap<string, GraphPoint>): readonly string[] {
  const visible = graph.edges.filter((edge) => positions.has(edge.sourceId) && positions.has(edge.targetId)).slice(0, 12);
  if (visible.length === 0) return ["  none in current filter"];
  return visible.map((edge) => `  ${nodeLabel(graph, edge.sourceId)} -> ${nodeLabel(graph, edge.targetId)} [${edge.label}]`);
}

function nodeLabel(graph: OntologyGraph, nodeId: string): string {
  return graph.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
