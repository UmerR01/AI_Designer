/** Screen flow graph from UI designer backend (matches backend/main.py screen_graph). */

import { inferScreenLabelFromImage } from "@/lib/generated-ui-images";

export type UiFlowNode = {
  id: string;
  screen: string;
  label?: string;
  nav_label?: string;
  order?: number;
};

export type UiFlowRelation = {
  from: string;
  to: string;
  type?: string;
  label?: string;
};

export type UiFlowGraph = {
  nodes: UiFlowNode[];
  relations: UiFlowRelation[];
};

export function slugifyFlowName(value: string): string {
  return (
    String(value || "screen")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "screen"
  );
}

export function buildFallbackFlowGraph(
  anchorName: string,
  remainingScreens: string[],
): UiFlowGraph {
  const screens = [anchorName, ...remainingScreens].filter(Boolean);
  const nodes: UiFlowNode[] = screens.map((screen, index) => ({
    id: `${slugifyFlowName(screen)}_${index + 1}`,
    screen,
    label: screen,
    order: index + 1,
  }));
  const relations: UiFlowRelation[] = nodes.slice(1).map((node, index) => ({
    from: nodes[index].id,
    to: node.id,
    type: index === 0 ? "entry" : "next",
    label: index === 0 ? "next screen" : "continues to",
  }));
  return { nodes, relations };
}

/** Canonical position in the flow (1-based), from screen_graph — not backend `screen.index`. */
/** Node ids in navigation order (relations chain, then any leftover nodes by `order`). */
export function getOrderedFlowNodeIds(
  graph: UiFlowGraph | null | undefined,
): string[] {
  const ensured = ensureFlowRelations(graph);
  if (!ensured?.nodes?.length) return [];

  const nodes = [...ensured.nodes].sort(
    (a, b) => (a.order ?? 999) - (b.order ?? 999),
  );
  const relations = ensured.relations ?? [];
  if (!relations.length) return nodes.map((n) => n.id);

  const toIds = new Set(relations.map((r) => r.to));
  const nextByFrom = new Map(relations.map((r) => [r.from, r.to]));

  let starts = nodes.filter((n) => !toIds.has(n.id));
  if (!starts.length) starts = [nodes[0]];
  starts.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  const ordered: string[] = [];
  const visited = new Set<string>();

  for (const start of starts) {
    let cur: string | undefined = start.id;
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      ordered.push(cur);
      cur = nextByFrom.get(cur);
    }
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) ordered.push(n.id);
  }
  return ordered;
}

export function resolveFlowNodeId(
  graph: UiFlowGraph | null | undefined,
  info: {
    nodeId?: string;
    screenName?: string;
    page_name?: string;
    filename?: string;
  },
): string {
  const nodes = graph?.nodes ?? [];
  const nodeId = (info.nodeId || "").trim();
  if (nodeId && nodes.some((n) => n.id === nodeId)) return nodeId;

  const name = (
    info.screenName ||
    inferScreenLabelFromImage({
      screenName: info.screenName,
      page_name: info.page_name,
      filename: info.filename || "",
    }) ||
    ""
  )
    .trim()
    .toLowerCase();
  if (!name) return "";
  return (
    nodes.find((n) => (n.screen || "").trim().toLowerCase() === name)?.id || ""
  );
}

export function resolveFlowScreenOrder(
  graph: UiFlowGraph | null | undefined,
  info: { nodeId?: string; screenName?: string; page_name?: string; filename?: string },
): number | undefined {
  const nodes = graph?.nodes;
  if (!nodes?.length) return undefined;

  const resolvedId = resolveFlowNodeId(graph, info);
  if (resolvedId) {
    const byId = nodes.find((n) => n.id === resolvedId);
    if (byId?.order != null) return byId.order;
    const pos = getOrderedFlowNodeIds(graph).indexOf(resolvedId);
    if (pos >= 0) return pos + 1;
  }

  return undefined;
}

export type FlowGalleryImageLike = {
  id: string;
  nodeId?: string;
  screenName?: string;
  page_name?: string;
  filename?: string;
  isAnchor?: boolean;
  index?: number;
  created_at?: string;
};

function flowImageSortKey(
  graph: UiFlowGraph | null | undefined,
  img: FlowGalleryImageLike,
): number {
  return (
    resolveFlowScreenOrder(graph, img) ??
    (img.isAnchor ? 1 : undefined) ??
    img.index ??
    999
  );
}

/** One thumbnail per flow node, sorted by screen_graph navigation order. */
export function orderFlowGalleryImages<T extends FlowGalleryImageLike>(
  graph: UiFlowGraph | null | undefined,
  images: T[],
): T[] {
  const ensured = ensureFlowRelations(graph);
  if (!ensured?.nodes?.length) {
    return [...images].sort(
      (a, b) =>
        Number(Boolean(b.isAnchor)) - Number(Boolean(a.isAnchor)) ||
        flowImageSortKey(null, a) - flowImageSortKey(null, b),
    );
  }

  const nodeOrder = getOrderedFlowNodeIds(ensured);
  const positionByNodeId = new Map(nodeOrder.map((id, i) => [id, i]));
  const byNode = new Map<string, T[]>();
  const unassigned: T[] = [];

  for (const img of images) {
    const nodeId = resolveFlowNodeId(ensured, img);
    if (nodeId) {
      const list = byNode.get(nodeId) ?? [];
      list.push(img);
      byNode.set(nodeId, list);
    } else {
      unassigned.push(img);
    }
  }

  const pickBest = (candidates: T[]): T =>
    [...candidates].sort((a, b) => {
      if (a.isAnchor && !b.isAnchor) return -1;
      if (!a.isAnchor && b.isAnchor) return 1;
      const score = (img: T) =>
        (img.nodeId ? 4 : 0) +
        (img.screenName ? 2 : 0) +
        (img.created_at ? 1 : 0);
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return (
        (b.created_at || "").localeCompare(a.created_at || "") ||
        flowImageSortKey(ensured, a) - flowImageSortKey(ensured, b)
      );
    })[0];

  const ordered: T[] = [];
  for (const nodeId of nodeOrder) {
    const list = byNode.get(nodeId);
    if (list?.length) ordered.push(pickBest(list));
  }

  const placed = new Set(ordered.map((i) => i.id));
  const rest = unassigned
    .filter((img) => !placed.has(img.id))
    .sort((a, b) => flowImageSortKey(ensured, a) - flowImageSortKey(ensured, b));
  return [...ordered, ...rest];
}

export function flowScreenTotal(graph: UiFlowGraph | null | undefined): number {
  return graph?.nodes?.length ?? 0;
}

/** Keep relations when a later WS event omits screen_graph. */
export function mergeFlowGraphs(
  prev: UiFlowGraph | null | undefined,
  incoming: UiFlowGraph | null | undefined,
): UiFlowGraph | null {
  if (!incoming?.nodes?.length) return prev ?? null;
  if (!prev?.nodes?.length) return incoming;
  const byId = new Map<string, UiFlowNode>();
  for (const n of prev.nodes) byId.set(n.id, n);
  for (const n of incoming.nodes) {
    const existing = byId.get(n.id);
    byId.set(n.id, existing ? { ...existing, ...n } : n);
  }
  const nodes = [...byId.values()].sort(
    (a, b) => (a.order ?? 999) - (b.order ?? 999),
  );
  const relations =
    incoming.relations?.length ? incoming.relations : prev.relations ?? [];
  return { nodes, relations };
}

/** Best available flow graph for save/load (state + rebuilt from images). */
export function resolvePersistedFlowGraph(
  graph: UiFlowGraph | null | undefined,
  images: Array<{
    screenName?: string;
    page_name?: string;
    isAnchor?: boolean;
    index?: number;
    nodeId?: string;
  }>,
): UiFlowGraph | null {
  const fromState = ensureFlowRelations(graph);
  if ((fromState?.nodes?.length ?? 0) >= 2) return fromState;
  return ensureFlowRelations(buildFlowGraphFromImages(images));
}

/** Stable key for auto-save when flow topology changes. */
export function flowGraphPersistenceKey(graph: UiFlowGraph | null | undefined): string {
  if (!graph?.nodes?.length) return "";
  const nodes = [...graph.nodes]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .map((n) => `${n.id}:${n.screen}:${n.order ?? ""}`)
    .join("|");
  const rels = (graph.relations ?? [])
    .map((r) => `${r.from}->${r.to}`)
    .join("|");
  return `${nodes}::${rels}`;
}

/** Some payloads only include nodes — synthesize relations for the flow strip. */
export function ensureFlowRelations(graph: UiFlowGraph | null | undefined): UiFlowGraph | null {
  if (!graph?.nodes?.length) return null;
  if (graph.relations?.length) return graph;
  const nodes = [...graph.nodes].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const relations: UiFlowRelation[] = nodes.slice(1).map((node, index) => ({
    from: nodes[index].id,
    to: node.id,
    type: index === 0 ? "entry" : "next",
    label: index === 0 ? "next screen" : "continues to",
  }));
  return { nodes, relations };
}

/** Rebuild flow graph from saved images when uiFlowGraph was not stored or is incomplete. */
export function buildFlowGraphFromImages(
  images: Array<{
    screenName?: string;
    page_name?: string;
    isAnchor?: boolean;
    index?: number;
  }>,
): UiFlowGraph | null {
  const labels: string[] = [];
  const seen = new Set<string>();
  const sorted = [...images].sort((a, b) => {
    if (a.isAnchor && !b.isAnchor) return -1;
    if (!a.isAnchor && b.isAnchor) return 1;
    return (a.index ?? 999) - (b.index ?? 999);
  });

  for (const img of sorted) {
    if (String(img.page_name || "").toLowerCase().includes("style guide")) continue;
    const label = (img.screenName || "")
      .trim()
      || (img.page_name || "")
        .replace(/\[SectionID:[^\]]+\]\s*/gi, "")
        .replace(/\[ScreenID:[^\]]+\]\s*/gi, "")
        .trim();
    if (!label || /style guide/i.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }

  if (labels.length < 2) return null;

  const anchorImg = sorted.find((i) => i.isAnchor);
  const anchorLabel =
    (anchorImg?.screenName || anchorImg?.page_name || "")
      .replace(/\[SectionID:[^\]]+\]\s*/gi, "")
      .replace(/\[ScreenID:[^\]]+\]\s*/gi, "")
      .trim() || labels[0];
  const remaining = labels.filter((l) => l.toLowerCase() !== anchorLabel.toLowerCase());
  return buildFallbackFlowGraph(anchorLabel, remaining);
}


export function supportsPrototypeFlow(kind?: string): boolean {
  const k = (kind || "").toLowerCase().trim();
  return (
    k === "ui/ux design" ||
    k === "product design" ||
    k === "product design - desktop" ||
    k === "product design - app" ||
    k === "website design" ||
    k === "multi-page website"
  );
}
