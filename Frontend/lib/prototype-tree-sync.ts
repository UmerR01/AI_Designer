import type { EditorTreeNode } from "@/lib/editor-project";
import { collectScreens, findNodeById, mapTree } from "@/lib/editor-project";
import {
  inferScreenLabelFromImage,
  type GeneratedUiImageRecord,
} from "@/lib/generated-ui-images";

function labelFromImage(img: PrototypeSectionSyncImage): string | undefined {
  return inferScreenLabelFromImage(
    img as Pick<GeneratedUiImageRecord, "page_name" | "filename" | "screenName">,
  );
}
import { supportsPrototypeFlow } from "@/lib/ui-flow-graph";

export type PrototypeSectionSyncImage = {
  page_name?: string;
  screenName?: string;
  filename?: string;
  nodeId?: string;
  index?: number;
};

/** Prototype flows that use one artboard with multiple vertical sections. */
export function usesPrototypeSectionCanvas(kind?: string): boolean {
  const k = (kind || "").toLowerCase().trim();
  return supportsPrototypeFlow(kind) || k === "landing page";
}

function defaultFrameForKind(kind?: string): "desktop" | "mobile" {
  const k = (kind || "").toLowerCase().trim();
  if (k === "product design - app") return "mobile";
  return "desktop";
}

function defaultScreenName(kind?: string): string {
  const k = (kind || "").toLowerCase().trim();
  if (k === "multi-page website" || k === "website design") return "Website";
  if (k === "landing page") return "Landing Page";
  return "Untitled";
}

export function shouldConsolidatePrototypeScreens(
  tree: EditorTreeNode[],
  kind?: string,
): boolean {
  const k = (kind || "").toLowerCase().trim();
  const isProto = supportsPrototypeFlow(kind);
  if (!isProto) return false;
  const screens = collectScreens(tree);
  if (screens.length <= 1) return false;

  if (k === "multi-page website" || k === "website design") {
    return true;
  }

  return screens.every((s) => {
    const name = (s.name || "").trim().toLowerCase();
    const generic =
      name === "untitled" ||
      name.startsWith("untitled ") ||
      name === "screen 1";
    const sectionCount = s.sections?.length ?? 0;
    return generic && sectionCount <= 1;
  });
}

function resolveTargetScreenId(
  tree: EditorTreeNode[],
  activeId: string,
  kind?: string,
): string | null {
  const node = findNodeById(tree, activeId);
  if (node?.kind === "screen") return node.id;
  if (node?.kind === "folder") {
    const first = node.children?.find((c) => c.kind === "screen");
    if (first) return first.id;
  }
  if (usesPrototypeSectionCanvas(kind)) {
    const screens = collectScreens(tree);
    if (screens.length >= 1) return screens[0].id;
  }
  return null;
}

/** Merge accidental per-image screens into one artboard with all sections. */
export function consolidatePrototypeScreens(
  tree: EditorTreeNode[],
  activeId: string,
  kind?: string,
): { tree: EditorTreeNode[]; activeId: string } {
  if (!shouldConsolidatePrototypeScreens(tree, kind)) {
    return { tree, activeId };
  }

  const screens = collectScreens(tree);
  const primary = screens[0];
  const sectionById = new Map<string, { id: string; name: string }>();

  for (const screen of screens) {
    for (const sec of screen.sections ?? []) {
      if (!sectionById.has(sec.id)) {
        sectionById.set(sec.id, { ...sec });
      }
    }
  }

  const mergedSections = Array.from(sectionById.values());
  const mergedScreen: Extract<EditorTreeNode, { kind: "screen" }> = {
    ...primary,
    name:
      primary.name && !/^untitled(\s|$)/i.test(primary.name)
        ? primary.name
        : defaultScreenName(kind),
    sections:
      mergedSections.length > 0
        ? mergedSections
        : primary.sections ?? [{ id: crypto.randomUUID(), name: "First Section" }],
    frame: primary.frame ?? defaultFrameForKind(kind),
    expansionDirection: primary.expansionDirection ?? "vertical",
  };

  const firstFolder = tree.find((n) => n.kind === "folder");
  if (firstFolder) {
    const nextTree = tree
      .filter((n) => n.kind !== "screen")
      .map((n) => {
        if (n.kind !== "folder") return n;
        if (n.id === firstFolder.id) {
          return { ...n, children: [mergedScreen] };
        }
        return {
          ...n,
          children: n.children.filter((c) => c.kind !== "screen"),
        };
      });
    return { tree: nextTree, activeId: mergedScreen.id };
  }

  const nonScreens = tree.filter((n) => n.kind !== "screen");
  if (nonScreens.length > 0) {
    return { tree: [...nonScreens, mergedScreen], activeId: mergedScreen.id };
  }

  return { tree: [mergedScreen], activeId: mergedScreen.id };
}

/** Ensure one screen and all prototype sections exist (single batched tree update). */
export function syncPrototypeSectionsToTree(
  tree: EditorTreeNode[],
  activeId: string,
  images: PrototypeSectionSyncImage[],
  kind?: string,
): {
  tree: EditorTreeNode[];
  activeId: string;
  sectionMap: Map<string, string>;
} {
  const sectionMap = new Map<string, string>();
  const k = (kind || "").toLowerCase().trim();
  const isProto = supportsPrototypeFlow(kind) || k === "landing page";
  if (!isProto) {
    return { tree, activeId, sectionMap };
  }

  let working = tree;
  let nextActiveId = activeId;

  const consolidated = consolidatePrototypeScreens(working, nextActiveId, kind);
  working = consolidated.tree;
  nextActiveId = consolidated.activeId;

  const sorted = [...images].sort((a, b) => (a.index ?? 999) - (b.index ?? 999));

  const ensureScreen = (): string => {
    let screenId = resolveTargetScreenId(working, nextActiveId, kind);
    if (screenId) return screenId;

    const newScreenId = crypto.randomUUID();
    const newSectionId = crypto.randomUUID();
    const first = sorted.find((img) => {
      const label = labelFromImage(img);
      return label && !String(img.page_name || "").toLowerCase().includes("style guide");
    });
    const label = (first && labelFromImage(first)) || "First Section";

    working = [
      ...working,
      {
        id: newScreenId,
        kind: "screen" as const,
        name: defaultScreenName(kind),
        frame: defaultFrameForKind(kind),
        sections: [{ id: newSectionId, name: label }],
        expansionDirection: "vertical" as const,
      },
    ];
    nextActiveId = newScreenId;
    if (first) {
      const mapKey = (first.nodeId || label).toLowerCase();
      sectionMap.set(mapKey, newSectionId);
    }
    return newScreenId;
  };

  let screenId = resolveTargetScreenId(working, nextActiveId, kind);
  if (!screenId) screenId = ensureScreen();

  for (const img of sorted) {
    const label = labelFromImage(img);
    if (!label) continue;
    if (String(img.page_name || "").toLowerCase().includes("style guide")) continue;

    const mapKey = (img.nodeId || label).toLowerCase();
    if (sectionMap.has(mapKey)) continue;

    screenId = resolveTargetScreenId(working, nextActiveId, kind) ?? ensureScreen();
    const screen = findNodeById(working, screenId);
    if (!screen || screen.kind !== "screen") continue;

    const sections = screen.sections ?? [];
    const tagMatch = img.page_name?.match(/\[SectionID:([^\]]+)\]/i);
    const existingTagId = tagMatch?.[1];

    if (existingTagId) {
      const byId = sections.find((s) => s.id === existingTagId);
      if (byId) {
        sectionMap.set(mapKey, byId.id);
        continue;
      }
      working = mapTree(working, (n) => {
        if (n.kind !== "screen" || n.id !== screenId) return n;
        return {
          ...n,
          sections: [...(n.sections ?? []), { id: existingTagId, name: label }],
        };
      });
      sectionMap.set(mapKey, existingTagId);
      continue;
    }

    const byName = sections.find(
      (s) => (s.name || "").trim().toLowerCase() === label.toLowerCase(),
    );
    if (byName) {
      sectionMap.set(mapKey, byName.id);
      continue;
    }

    const onlyDefault =
      sections.length === 1 &&
      /^first section$/i.test(sections[0].name || "") &&
      !images.some((i) =>
        (i.page_name || "").includes(`[SectionID:${sections[0].id}]`),
      );

    if (onlyDefault) {
      const sectionId = sections[0].id;
      working = mapTree(working, (n) => {
        if (n.kind !== "screen" || n.id !== screenId) return n;
        return {
          ...n,
          sections: (n.sections ?? []).map((s) =>
            s.id === sectionId ? { ...s, name: label } : s,
          ),
        };
      });
      sectionMap.set(mapKey, sectionId);
      continue;
    }

    const newSectionId = crypto.randomUUID();
    working = mapTree(working, (n) => {
      if (n.kind !== "screen" || n.id !== screenId) return n;
      return {
        ...n,
        sections: [...(n.sections ?? []), { id: newSectionId, name: label }],
      };
    });
    sectionMap.set(mapKey, newSectionId);
  }

  return { tree: working, activeId: nextActiveId, sectionMap };
}

export function repairPrototypeTreeForLoad(
  tree: EditorTreeNode[],
  activeId: string,
  images: PrototypeSectionSyncImage[],
  kind?: string,
): { tree: EditorTreeNode[]; activeId: string } {
  const { tree: synced, activeId: nextActive } = syncPrototypeSectionsToTree(
    tree,
    activeId,
    images,
    kind,
  );
  return { tree: synced, activeId: nextActive };
}

/** Shared editor / reload: ensure at least one artboard when designs exist (e.g. landing page). */
export function ensureEditorTreeForHydration(
  tree: EditorTreeNode[],
  activeId: string,
  images: PrototypeSectionSyncImage[],
  kind?: string,
): { tree: EditorTreeNode[]; activeId: string } {
  const screens = collectScreens(tree);
  if (screens.length > 0) {
    const activeNode = activeId ? findNodeById(tree, activeId) : null;
    const nextActive =
      activeNode?.kind === "screen"
        ? activeId
        : activeNode?.kind === "folder" && activeNode.children?.length
          ? activeNode.children.find((c) => c.kind === "screen")?.id ?? screens[0].id
          : screens[0].id;
    return { tree, activeId: nextActive };
  }

  if (!images.length) return { tree, activeId };

  const isProto = supportsPrototypeFlow(kind) || (kind || "").toLowerCase().trim() === "landing page";
  if (isProto) {
    return repairPrototypeTreeForLoad(tree, activeId, images, kind);
  }

  const k = (kind || "").toLowerCase().trim();
  const screenId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();
  let screenName = "Untitled";
  if (k === "landing page") screenName = "Landing Page";
  else if (k === "website design" || k === "multi-page website") screenName = "Website";

  const frame: "desktop" | "mobile" =
    k === "product design - app" ? "mobile" : "desktop";

  return {
    tree: [
      {
        id: screenId,
        kind: "screen",
        name: screenName,
        frame,
        sections: [
          {
            id: sectionId,
            name: k === "landing page" ? "Main" : "First Section",
          },
        ],
        expansionDirection: "vertical",
      },
    ],
    activeId: screenId,
  };
}

export const shareClaimStorageKey = (projectId: string) =>
  `share.claimSlug.${projectId}`;
