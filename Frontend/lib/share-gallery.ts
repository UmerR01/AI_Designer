import {
  dedupeGeneratedImages,
  hydrateLoadedGeneratedImages,
  type GeneratedUiImageRecord,
} from "@/lib/generated-ui-images";
import {
  buildFlowGraphFromImages,
  ensureFlowRelations,
  orderFlowGalleryImages,
  type UiFlowGraph,
} from "@/lib/ui-flow-graph";

export type ShareGalleryImage = {
  id: string;
  url: string;
  filename: string;
  page_name?: string;
  screenName?: string;
  created_at?: string;
  nodeId?: string;
  isAnchor?: boolean;
  index?: number;
};

function isStyleGuide(img: Pick<ShareGalleryImage, "page_name" | "filename" | "screenName">) {
  const hay = `${img.page_name ?? ""} ${img.filename ?? ""} ${img.screenName ?? ""}`.toLowerCase();
  return hay.includes("style guide");
}

function isDisplayableUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("asset://")) return false;
  if (url.startsWith("data:")) return true;
  return url.startsWith("http") || url.startsWith("/");
}

function parseProjectRow(item: unknown): ShareGalleryImage | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const url = typeof row.url === "string" ? row.url : "";
  const filename = typeof row.filename === "string" ? row.filename : "design.png";
  const id = typeof row.id === "string" ? row.id : url || filename;
  if (!url) return null;
  return {
    id,
    url,
    filename,
    page_name: typeof row.page_name === "string" ? row.page_name : undefined,
    screenName: typeof row.screenName === "string" ? row.screenName : undefined,
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    nodeId: typeof row.nodeId === "string" ? row.nodeId : undefined,
    isAnchor: typeof row.isAnchor === "boolean" ? row.isAnchor : undefined,
    index: typeof row.index === "number" ? row.index : undefined,
  };
}

function toShareRecord(img: ShareGalleryImage): GeneratedUiImageRecord {
  return {
    id: img.id,
    url: img.url,
    filename: img.filename,
    page_name: img.page_name,
    screenName: img.screenName,
    created_at: img.created_at,
    nodeId: img.nodeId,
    isAnchor: img.isAnchor,
    index: img.index,
  };
}

function fromShareRecord(img: GeneratedUiImageRecord): ShareGalleryImage {
  return {
    id: img.id,
    url: img.url,
    filename: img.filename,
    page_name: img.page_name,
    screenName: img.screenName,
    created_at: img.created_at,
    nodeId: img.nodeId,
    isAnchor: img.isAnchor,
    index: img.index,
  };
}

export function shareImageLabel(img: ShareGalleryImage): string {
  const fromPage = (img.page_name || "")
    .replace(/\[SectionID:[^\]]+\]\s*/gi, "")
    .replace(/\[ScreenID:[^\]]+\]\s*/gi, "")
    .trim();
  return img.screenName?.trim() || fromPage || img.filename || "Design";
}

/** Stable key: one gallery card per prototype section / flow node / screen label. */
export function shareGalleryIdentityKey(img: ShareGalleryImage): string {
  const sectionId = img.page_name?.match(/\[SectionID:([^\]]+)\]/i)?.[1];
  if (sectionId) return `section:${sectionId}`;
  if (img.nodeId?.trim()) return `node:${img.nodeId.trim()}`;
  const label = shareImageLabel(img).trim().toLowerCase();
  if (label && label !== "design") return `label:${label}`;
  return `id:${img.id}`;
}

function imageQualityScore(img: ShareGalleryImage): number {
  let score = 0;
  if (img.url.startsWith("http")) score += 8;
  if (!img.url.startsWith("data:")) score += 2;
  if (img.screenName) score += 2;
  if (img.page_name?.includes("[SectionID:")) score += 2;
  if (img.nodeId) score += 2;
  return score;
}

/** One image per artboard section / screen name — prefer resolved DB URLs. */
export function dedupeShareGalleryByIdentity(images: ShareGalleryImage[]): ShareGalleryImage[] {
  const map = new Map<string, ShareGalleryImage>();
  for (const img of images) {
    const key = shareGalleryIdentityKey(img);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, img);
      continue;
    }
    const scoreDiff = imageQualityScore(img) - imageQualityScore(prev);
    const newer =
      (img.created_at || "").localeCompare(prev.created_at || "") > 0;
    if (scoreDiff > 0 || (scoreDiff === 0 && newer)) {
      map.set(key, img);
    }
  }
  return Array.from(map.values());
}

function readUiFlowGraph(projectData: unknown): UiFlowGraph | null {
  if (!projectData || typeof projectData !== "object") return null;
  const raw = (projectData as { uiFlowGraph?: unknown }).uiFlowGraph;
  if (!raw || typeof raw !== "object") return null;
  const g = raw as UiFlowGraph;
  if (!Array.isArray(g.nodes) || g.nodes.length === 0) return null;
  return ensureFlowRelations(g);
}

/**
 * Merge project JSON + DB assets for view-only share.
 * Shows one card per prototype screen (same as editor), not every duplicate upload row.
 */
export function collectShareGalleryImages(args: {
  projectData?: unknown;
  assets?: ShareGalleryImage[];
}): ShareGalleryImage[] {
  const fromData: ShareGalleryImage[] = [];
  const data = args.projectData;
  if (data && typeof data === "object") {
    const raw = (data as { generatedUiImages?: unknown }).generatedUiImages;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const row = parseProjectRow(item);
        if (row) fromData.push(row);
      }
    }
  }

  const dbAssets = (args.assets ?? []).filter((img) => img.url && !isStyleGuide(img));

  const merged = dedupeGeneratedImages([
    ...fromData.map(toShareRecord),
    ...dbAssets.map(toShareRecord),
  ]);

  const hydrated = hydrateLoadedGeneratedImages(merged, dbAssets.map(toShareRecord));

  let candidates = hydrated
    .map(fromShareRecord)
    .filter((img) => !isStyleGuide(img) && isDisplayableUrl(img.url));

  candidates = dedupeShareGalleryByIdentity(candidates);

  let graph = readUiFlowGraph(args.projectData);
  if (!graph?.nodes?.length && candidates.length >= 2) {
    graph = buildFlowGraphFromImages(candidates) ?? graph;
  }
  graph = graph ? ensureFlowRelations(graph) : null;

  if (graph?.nodes?.length) {
    candidates = orderFlowGalleryImages(graph, candidates);
    candidates = dedupeShareGalleryByIdentity(candidates);
  } else {
    candidates.sort(
      (a, b) =>
        Number(Boolean(b.isAnchor)) - Number(Boolean(a.isAnchor)) ||
        (a.index ?? 999) - (b.index ?? 999) ||
        (b.created_at || "").localeCompare(a.created_at || ""),
    );
  }

  return candidates;
}
