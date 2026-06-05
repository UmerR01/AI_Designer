import type { EditorTreeNode } from "@/lib/editor-project";
import { collectScreenIdsInTree } from "@/lib/editor-project";

export type GeneratedUiImageRecord = {
  id: string;
  url: string;
  filename: string;
  page_name?: string;
  created_at?: string;
  nodeId?: string;
  screenName?: string;
  isAnchor?: boolean;
  index?: number;
  total?: number;
};

export function isLandingPagePrototypeImage(
  img: Pick<GeneratedUiImageRecord, "page_name" | "filename" | "screenName">,
): boolean {
  const hay = `${img.page_name ?? ""} ${img.filename ?? ""} ${img.screenName ?? ""}`.toLowerCase();
  return hay.includes("landing page") || hay.includes("landing_page");
}

/** Screen that owns a landing prototype (tagged, or first screen for legacy saves). */
export function landingPrototypeOwnerScreenId(
  img: Pick<GeneratedUiImageRecord, "page_name" | "filename" | "screenName">,
  tree: EditorTreeNode[],
): string | null {
  const screenIds = collectScreenIdsInTree(tree);
  if (!screenIds.length) return null;

  const tag = (img.page_name || "").match(/\[ScreenID:([^\]]+)\]/i);
  if (tag) {
    return screenIds.includes(tag[1]) ? tag[1] : null;
  }
  if (!isLandingPagePrototypeImage(img)) return null;
  return screenIds[0];
}

/** Backfill [ScreenID:…] and [SectionID:…] on landing images saved before per-section tagging. */
export function repairLandingPrototypeImageTags<T extends GeneratedUiImageRecord>(
  images: T[],
  tree: EditorTreeNode[],
): T[] {
  const screenIds = collectScreenIdsInTree(tree);
  if (!screenIds.length) return images;

  return images.map((img) => {
    if (!isLandingPagePrototypeImage(img)) return img;

    let owner = landingPrototypeOwnerScreenId(img, tree);
    if (!owner) owner = screenIds[0];

    const name = img.page_name || "";
    const screenTagNeedle = `[screenid:${owner.toLowerCase()}]`;

    // Step 1: Ensure [ScreenID:...] tag is present
    let pageName = name;
    if (!pageName.toLowerCase().includes(screenTagNeedle)) {
      const label =
        pageName.replace(/\[ScreenID:[^\]]+\]\s*/gi, "").trim() ||
        "Landing Page Prototype";
      pageName = `[ScreenID:${owner}] ${label}`;
    }

    // Step 2: Backfill [SectionID:...] for images that are missing it (first canvas old saves).
    // Without a SectionID tag, pickImageForSection falls back to screenName matching which
    // picks the NEWEST image for every canvas, making older canvases invisible on reload.
    if (!pageName.match(/\[SectionID:[^\]]+\]/i)) {
      const ownerScreen = findScreenNodeById(tree, owner);
      const sections = (ownerScreen as any)?.sections as
        | Array<{ id: string; name: string }>
        | undefined;
      const firstSection = sections?.[0];
      if (firstSection?.id) {
        const labelPart =
          pageName
            .replace(/\[ScreenID:[^\]]+\]\s*/gi, "")
            .trim() || "Landing Page Prototype";
        pageName = `[ScreenID:${owner}] [SectionID:${firstSection.id}] ${labelPart}`;
      }
    }

    if (pageName === name && img.screenName) return img;
    return {
      ...img,
      page_name: pageName,
      screenName: img.screenName || "Landing Page",
    };
  });
}

function findScreenNodeById(
  tree: EditorTreeNode[],
  id: string,
): EditorTreeNode | undefined {
  for (const node of tree) {
    if (node.kind === "screen" && node.id === id) return node;
    if (node.kind === "folder") {
      const found = findScreenNodeById(
        (node as Extract<EditorTreeNode, { kind: "folder" }>).children ?? [],
        id,
      );
      if (found) return found;
    }
  }
  return undefined;
}

/** Human-readable screen label from page_name / filename when screenName was not persisted. */
export function inferScreenLabelFromImage(
  img: Pick<GeneratedUiImageRecord, "page_name" | "filename" | "screenName">,
): string | undefined {
  if (img.screenName?.trim()) return img.screenName.trim();
  const fromPage = (img.page_name || "")
    .replace(/\[SectionID:[^\]]+\]\s*/gi, "")
    .replace(/\[ScreenID:[^\]]+\]\s*/gi, "")
    .trim();
  if (fromPage && !/style guide/i.test(fromPage)) return fromPage;
  return undefined;
}

/** Fill screenName + swap asset:// placeholders for real DB URLs after reload. */
export function hydrateLoadedGeneratedImages(
  images: GeneratedUiImageRecord[],
  assetsFromDb: GeneratedUiImageRecord[] = [],
): GeneratedUiImageRecord[] {
  return images.map((img) => {
    let url = img.url;
    if (url.startsWith("asset://") && assetsFromDb.length) {
      const ref = url.slice("asset://".length);
      const label = inferScreenLabelFromImage(img)?.toLowerCase();
      const imgSectionId = img.page_name?.match(/\[SectionID:([^\]]+)\]/i)?.[1]?.toLowerCase();
      const match = assetsFromDb.find((row) => {
        if (row.id === ref || row.id === img.id) return true;

        // If SectionID is present in either, enforce SectionID match and prevent matching different sections
        const rowSectionId = row.page_name?.match(/\[SectionID:([^\]]+)\]/i)?.[1]?.toLowerCase();
        if (imgSectionId || rowSectionId) {
          return Boolean(imgSectionId && rowSectionId && imgSectionId === rowSectionId);
        }

        if (!label) return false;
        const rowLabel = inferScreenLabelFromImage(row)?.toLowerCase();
        return Boolean(rowLabel && rowLabel === label);
      });
      if (match?.url && !match.url.startsWith("asset://")) {
        url = match.url;
      }
    }

    const screenName = inferScreenLabelFromImage(img);
    return {
      ...img,
      url,
      ...(screenName ? { screenName } : {}),
    };
  });
}

/** Stable signature to avoid parent ↔ chat image sync loops (URLs normalized — not flow). */
export function prototypeImagesSignature(images: GeneratedUiImageRecord[]): string {
  const rows = images
    .map((i) => ({
      id: i.id,
      hasData: Boolean(i.url?.startsWith("data:")),
      screenName: i.screenName ?? "",
      nodeId: i.nodeId ?? "",
      isAnchor: i.isAnchor ?? false,
      index: i.index ?? 0,
      page_name: i.page_name ?? "",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(rows);
}

/** Merge / dedupe generated UI images while preserving prototype-flow metadata. */

/** Postgres / JSON may return Date objects — always coerce before compare or save. */
export function normalizeCreatedAt(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  return String(value);
}

export function normalizeGeneratedImage(
  img: Partial<GeneratedUiImageRecord> & { id?: string; url?: string; filename?: string },
): GeneratedUiImageRecord | null {
  const id = typeof img.id === "string" ? img.id : "";
  const url = typeof img.url === "string" ? img.url : "";
  const filename = typeof img.filename === "string" ? img.filename : "screen.png";
  if (!id || !url) return null;
  return {
    id,
    url,
    filename,
    page_name: typeof img.page_name === "string" ? img.page_name : undefined,
    created_at: normalizeCreatedAt(img.created_at),
    nodeId: typeof img.nodeId === "string" ? img.nodeId : undefined,
    screenName: typeof img.screenName === "string" ? img.screenName : undefined,
    isAnchor: typeof img.isAnchor === "boolean" ? img.isAnchor : undefined,
    index: typeof img.index === "number" ? img.index : undefined,
    total: typeof img.total === "number" ? img.total : undefined,
  };
}

/** Remove huge base64 payloads from project JSON — assets table stores the bytes. */
export function stripDataUrlsForProjectJson(
  images: GeneratedUiImageRecord[],
): GeneratedUiImageRecord[] {
  return images.map((img) => {
    const normalized = normalizeGeneratedImage(img);
    if (!normalized) return img;
    if (normalized.url.startsWith("data:")) {
      return { ...normalized, url: `asset://${normalized.id}` };
    }
    return normalized;
  });
}

function metadataScore(img: GeneratedUiImageRecord): number {
  let score = 0;
  if (img.nodeId) score += 4;
  if (img.screenName) score += 4;
  if (img.page_name?.includes("[SectionID:")) score += 2;
  if (img.isAnchor != null) score += 1;
  if (img.index != null) score += 1;
  if (img.total != null) score += 1;
  if (img.url && !img.url.startsWith("data:")) score += 2;
  return score;
}

function mergeImageFields(
  base: GeneratedUiImageRecord,
  incoming: Partial<GeneratedUiImageRecord>,
): GeneratedUiImageRecord {
  const pickUrl = (() => {
    const candidates = [incoming.url, base.url].filter(
      (u): u is string => typeof u === "string" && u.length > 0,
    );
    const durable = candidates.find(
      (u) => !u.startsWith("data:") && !u.startsWith("asset://"),
    );
    if (durable) return durable;
    const nonData = candidates.find((u) => !u.startsWith("data:"));
    return nonData || candidates[0] || "";
  })();

  return {
    id: base.id || incoming.id || "",
    url: pickUrl,
    filename: incoming.filename || base.filename,
    page_name: incoming.page_name ?? base.page_name,
    created_at: normalizeCreatedAt(incoming.created_at) ?? base.created_at,
    nodeId: incoming.nodeId ?? base.nodeId,
    screenName: incoming.screenName ?? base.screenName,
    isAnchor: incoming.isAnchor ?? base.isAnchor,
    index: incoming.index ?? base.index,
    total: incoming.total ?? base.total,
  };
}

/** Dedupe by id/url; keep richest metadata and prefer durable (non–data:) URLs. */
export function dedupeGeneratedImages(
  images: GeneratedUiImageRecord[],
): GeneratedUiImageRecord[] {
  const map = new Map<string, GeneratedUiImageRecord>();

  for (const img of images) {
    const key = img.id || img.url || img.filename;
    if (!key) continue;

    const normalized = normalizeGeneratedImage(img);
    if (!normalized) continue;

    const prev = map.get(key);
    if (!prev) {
      map.set(key, normalized);
      continue;
    }

    const richer =
      metadataScore(normalized) >= metadataScore(prev)
        ? mergeImageFields(prev, normalized)
        : mergeImageFields(normalized, prev);
    map.set(key, richer);
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      (normalizeCreatedAt(b.created_at) || "").localeCompare(
        normalizeCreatedAt(a.created_at) || "",
      ),
  );
}

/** Merge DB rows with prior project + incoming client payloads (keeps prototype fields). */
export function mergeProjectGeneratedImages(args: {
  existing: GeneratedUiImageRecord[];
  incoming: Partial<GeneratedUiImageRecord>[];
  canonical: Array<{
    id: string;
    page_name?: string | null;
    filename: string;
    url: string;
    created_at?: string;
    source_image_id?: string | null;
  }>;
}): GeneratedUiImageRecord[] {
  const metaByKey = new Map<string, GeneratedUiImageRecord>();

  const registerMeta = (img: GeneratedUiImageRecord) => {
    if (img.id) metaByKey.set(img.id, img);
    const sn = (img.screenName || "").trim().toLowerCase();
    if (sn) metaByKey.set(`screen:${sn}`, img);
    const pageLabelFull = (img.page_name || "").trim().toLowerCase();
    if (pageLabelFull) metaByKey.set(`screen_full:${pageLabelFull}`, img);
    const pageLabel = (img.page_name || "")
      .replace(/\[SectionID:[^\]]+\]\s*/gi, "")
      .trim()
      .toLowerCase();
    if (pageLabel) metaByKey.set(`screen:${pageLabel}`, img);
  };

  for (const img of args.existing) {
    registerMeta(img);
  }
  for (const img of args.incoming) {
    if (!img.id) continue;
    const prev = metaByKey.get(img.id);
    const merged = prev
      ? mergeImageFields(prev, img as GeneratedUiImageRecord)
      : (img as GeneratedUiImageRecord);
    registerMeta(merged);
  }

  const fromDb: GeneratedUiImageRecord[] = args.canonical.map((row) => {
    const sourceKey = row.source_image_id || row.id;
    const pageLabelFull = (row.page_name || "").trim().toLowerCase();
    const pageLabel = (row.page_name || "")
      .replace(/\[SectionID:[^\]]+\]\s*/gi, "")
      .trim()
      .toLowerCase();
    const meta =
      metaByKey.get(sourceKey) ||
      metaByKey.get(row.id) ||
      (pageLabelFull ? metaByKey.get(`screen_full:${pageLabelFull}`) : undefined) ||
      (pageLabel ? metaByKey.get(`screen:${pageLabel}`) : undefined) ||
      ({} as GeneratedUiImageRecord);

    return mergeImageFields(
      {
        id: sourceKey,
        url: row.url,
        filename: row.filename,
        page_name: row.page_name ?? undefined,
        created_at: normalizeCreatedAt(row.created_at),
      },
      meta,
    );
  });

  const dbIds = new Set(fromDb.map((r) => r.id));
  const dbSourceIds = new Set(
    args.canonical.map((r) => r.source_image_id).filter(Boolean) as string[],
  );

  const pending = args.existing.filter((img) => {
    if (dbIds.has(img.id)) return false;
    if (dbSourceIds.has(img.id)) return false;
    return true;
  });

  return dedupeGeneratedImages([...fromDb, ...pending]);
}

function imagesMatchClientToServer(
  client: GeneratedUiImageRecord,
  server: GeneratedUiImageRecord,
): boolean {
  if (client.id && (server.id === client.id)) return true;
  const cs = (client.screenName || "").trim().toLowerCase();
  const ss = (server.screenName || "").trim().toLowerCase();
  if (cs && ss && cs === ss) return true;
  const cNode = client.nodeId || "";
  const sNode = server.nodeId || "";
  if (cNode && sNode && cNode === sNode) return true;

  // If SectionID is present in either, enforce SectionID match and prevent matching different sections
  const cSec = client.page_name?.match(/\[SectionID:([^\]]+)\]/i)?.[1]?.toLowerCase();
  const sSec = server.page_name?.match(/\[SectionID:([^\]]+)\]/i)?.[1]?.toLowerCase();
  if (cSec || sSec) {
    return Boolean(cSec && sSec && cSec === sSec);
  }

  const cp = (client.page_name || "")
    .replace(/\[SectionID:[^\]]+\]\s*/gi, "")
    .trim()
    .toLowerCase();
  const sp = (server.page_name || "")
    .replace(/\[SectionID:[^\]]+\]\s*/gi, "")
    .trim()
    .toLowerCase();
  return Boolean(cp && sp && cp === sp);
}

/** After per-image asset uploads, merge client metadata with full server asset list. */
export function reconcileUploadedImages(
  clientImages: GeneratedUiImageRecord[],
  serverImages: GeneratedUiImageRecord[],
): GeneratedUiImageRecord[] {
  if (!serverImages.length) return clientImages;

  const matchedServer = new Set<string>();
  const reconciled: GeneratedUiImageRecord[] = [];

  for (const client of clientImages) {
    const server = serverImages.find(
      (s) => !matchedServer.has(s.id) && imagesMatchClientToServer(client, s),
    );
    if (server) {
      matchedServer.add(server.id);
      reconciled.push(
        mergeImageFields(client, {
          ...server,
          url:
            server.url && !server.url.startsWith("asset://")
              ? server.url
              : client.url,
        }),
      );
    } else {
      reconciled.push(client);
    }
  }

  for (const server of serverImages) {
    if (!matchedServer.has(server.id)) {
      reconciled.push(server);
    }
  }

  return dedupeGeneratedImages(reconciled);
}
