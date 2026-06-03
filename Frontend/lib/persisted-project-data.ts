import { ensureFlowRelations, type UiFlowGraph } from "@/lib/ui-flow-graph";
import type { EditorTreeNode } from "@/lib/editor-project";
import {
  normalizeCreatedAt,
  normalizeGeneratedImage,
} from "@/lib/generated-ui-images";
import type { GeneratedUiImageRecord } from "@/lib/generated-ui-images";

export type PersistedProjectData = {
  tree: EditorTreeNode[];
  activeId: string;
  openFolders: Record<string, boolean>;
  generatedUiImages: GeneratedUiImageRecord[];
  uiFlowGraph: UiFlowGraph | null;
  savedAt?: string;
  updatedBy?: { id: string; email?: string };
};

/** Lenient parse for DB / API — never drop the whole project on one bad field. */
export function coercePersistedProjectData(raw: unknown): PersistedProjectData {
  const empty: PersistedProjectData = {
    tree: [],
    activeId: "",
    openFolders: {},
    generatedUiImages: [],
    uiFlowGraph: null,
  };

  if (!raw || typeof raw !== "object") return empty;
  const obj = raw as Record<string, unknown>;

  const tree = Array.isArray(obj.tree) ? (obj.tree as EditorTreeNode[]) : [];

  let activeId = typeof obj.activeId === "string" ? obj.activeId : "";
  if (!activeId && tree.length > 0) {
    const first = tree[0];
    activeId = first?.id ?? "";
  }

  const openFolders: Record<string, boolean> = {};
  if (obj.openFolders && typeof obj.openFolders === "object") {
    for (const [k, v] of Object.entries(obj.openFolders as Record<string, unknown>)) {
      openFolders[k] = Boolean(v);
    }
  }

  const generatedUiImages: GeneratedUiImageRecord[] = [];
  if (Array.isArray(obj.generatedUiImages)) {
    for (const item of obj.generatedUiImages) {
      if (!item || typeof item !== "object") continue;
      const normalized = normalizeGeneratedImage(item as GeneratedUiImageRecord);
      if (!normalized) continue;
      generatedUiImages.push(normalized);
    }
  }

  let uiFlowGraph: UiFlowGraph | null = null;
  const flowRaw = obj.uiFlowGraph;
  if (flowRaw && typeof flowRaw === "object" && Array.isArray((flowRaw as UiFlowGraph).nodes)) {
    uiFlowGraph = ensureFlowRelations(flowRaw as UiFlowGraph);
  }

  return {
    tree,
    activeId,
    openFolders,
    generatedUiImages,
    uiFlowGraph,
    savedAt: typeof obj.savedAt === "string" ? obj.savedAt : undefined,
    updatedBy:
      obj.updatedBy && typeof obj.updatedBy === "object"
        ? {
            id: String((obj.updatedBy as { id?: string }).id ?? ""),
            email:
              typeof (obj.updatedBy as { email?: string }).email === "string"
                ? (obj.updatedBy as { email?: string }).email
                : undefined,
          }
        : undefined,
  };
}
