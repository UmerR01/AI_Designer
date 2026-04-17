import type { ProjectKind } from "@/lib/designer-projects";

export type EditorTreeNode =
  | { id: string; kind: "folder"; name: string; children: EditorTreeNode[] }
  | { id: string; kind: "file"; name: string }
  | {
    id: string;
    kind: "screen";
    name: string;
    frame?: "desktop" | "mobile";
    /** For Campaign / social presets */
    formatLabel?: string;
    /** Expansion logic for Website: vertical for desktop, horizontal for mobile */
    expansionDirection?: "vertical" | "horizontal";
    /** Nested sections within a single screen/page */
    sections?: { id: string; name: string }[];
    /** Coordinates for Practice/Infinite Canvas */
    position?: { x: number; y: number };
  };

/**
 * Standard Design Resolutions (Standard 1X)
 */
export const RESOLUTIONS = {
  WEBSITE: {
    DESKTOP: { w: 1440, h: 900 },
    MOBILE: { w: 393, h: 852 },
  },
  UI_UX: { w: 1920, h: 1080 },
  LOGO: { w: 1200, h: 900 }, // 4:3 Professional ratio
  CAMPAIGN: {
    "Facebook Post (Landscape)": { w: 1200, h: 630 },
    "Facebook Cover": { w: 820, h: 312 },
    "Instagram Story": { w: 1080, h: 1920 },
    "Instagram Post (4:5)": { w: 1080, h: 1350 },
    "LinkedIn Post": { w: 1200, h: 627 },
    "LinkedIn Video": { w: 1920, h: 1080 },
    "TikTok Video": { w: 1080, h: 1920 },
    "Twitter / X Post": { w: 1600, h: 900 },
    "YouTube Shorts": { w: 1080, h: 1920 },
    "YouTube Thumbnail": { w: 1280, h: 720 },
    "YouTube Video": { w: 1920, h: 1080 },
  },
};

export const DEFAULT_EDITOR_KIND: ProjectKind = "ui/ux design";

export function resolveProjectKind(kind: ProjectKind | undefined): ProjectKind {
  return kind ?? DEFAULT_EDITOR_KIND;
}

export const EDITOR_FOLDER_WEB_DESKTOP = "folder-web-desktop";
export const EDITOR_FOLDER_WEB_MOBILE = "folder-web-mobile";
export const EDITOR_FOLDER_UX_SCREENS = "folder-ux-screens";
export const EDITOR_SCREEN_UX_1 = "screen-ux-1";
export const EDITOR_FOLDER_LOGO = "folder-logo";
export const EDITOR_FOLDER_PRACTICE_ROOT = "folder-practice-root";
export const EDITOR_SCREEN_PRACTICE_1 = "screen-practice-1";

const F_WEB_D = EDITOR_FOLDER_WEB_DESKTOP;
const F_WEB_M = EDITOR_FOLDER_WEB_MOBILE;
const F_UX = EDITOR_FOLDER_UX_SCREENS;
const S_UX_1 = EDITOR_SCREEN_UX_1;
const F_LOGO = EDITOR_FOLDER_LOGO;
const F_PR = EDITOR_FOLDER_PRACTICE_ROOT;
const S_PR_1 = EDITOR_SCREEN_PRACTICE_1;

export type EditorBootstrap = {
  tree: EditorTreeNode[];
  openFolders: Record<string, boolean>;
  activeId: string;
};

/** True when the tree is still the default ui/ux bootstrap (used to fix stale early-boot trees). */
export function isDefaultUiUxBootstrapTree(tree: EditorTreeNode[]): boolean {
  if (tree.length !== 1) return false;
  const n = tree[0];
  if (n.kind !== "folder" || n.id !== F_UX) return false;

  // Old default (kept for backward detection)
  if (n.name === "Project files" && n.children.length === 0) return true;

  // New default (Screens -> Screen 1)
  if (n.name !== "Screens") return false;
  if (n.children.length !== 1) return false;
  const c = n.children[0];
  return c.kind === "screen" && c.id === S_UX_1 && c.name === "Screen 1";
}

export function getEditorBootstrap(kind: ProjectKind): EditorBootstrap {
  switch (kind) {
    case "website design":
      return {
        tree: [
          { id: F_WEB_D, kind: "folder", name: "Desktop view", children: [] },
          { id: F_WEB_M, kind: "folder", name: "Mobile view", children: [] },
        ],
        openFolders: { [F_WEB_D]: true, [F_WEB_M]: true },
        activeId: F_WEB_D,
      };
    case "ui/ux design":
      return {
        tree: [
          {
            id: F_UX,
            kind: "folder",
            name: "Screens",
            children: [
              {
                id: S_UX_1,
                kind: "screen",
                name: "Screen 1",
                frame: "desktop",
                sections: [{ id: crypto.randomUUID(), name: "First Section" }],
                expansionDirection: "vertical",
              },
            ],
          }
        ],
        openFolders: { [F_UX]: true },
        activeId: S_UX_1,
      };
    case "campaign design":
      // Campaigns start with just the folder; selecting it shows the Gallery
      return {
        tree: [{ id: F_UX, kind: "folder", name: "Campaign assets", children: [] }],
        openFolders: { [F_UX]: true },
        activeId: F_UX,
      };
    case "logo design":
      return {
        tree: [{ id: F_LOGO, kind: "folder", name: "Logo", children: [] }],
        openFolders: { [F_LOGO]: true },
        activeId: F_LOGO,
      };
    case "practice":
      return {
        tree: [],
        openFolders: {},
        activeId: "",
      };
    default:
      return getEditorBootstrap("ui/ux design");
  }
}

/** Frame for a new screen added under this folder (website / practice). */
export function defaultFrameForFolder(folderId: string, folderName: string): "desktop" | "mobile" {
  if (folderId === F_WEB_M) return "mobile";
  const n = folderName.toLowerCase();
  if (n.includes("mobile")) return "mobile";
  return "desktop";
}

export function sidebarFilesLabel(kind: ProjectKind): string {
  if (kind === "website design" || kind === "practice") return "Project screens";
  return "Project files";
}

export function findNodeById(nodes: EditorTreeNode[], id: string): EditorTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.kind === "folder") {
      const found = findNodeById(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function mapTree(nodes: EditorTreeNode[], fn: (n: EditorTreeNode) => EditorTreeNode): EditorTreeNode[] {
  return nodes.map((n) => {
    const next = fn(n);
    if (next.kind === "folder") {
      return {
        ...next,
        children: mapTree(next.children, fn),
      };
    }
    return next;
  });
}

export function addChildToFolder(nodes: EditorTreeNode[], folderId: string, child: EditorTreeNode): EditorTreeNode[] {
  return mapTree(nodes, (n) => {
    if (n.kind === "folder" && n.id === folderId) {
      return { ...n, children: [...n.children, child] };
    }
    return n;
  });
}

export function removeNodeById(nodes: EditorTreeNode[], id: string): EditorTreeNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => {
      if (n.kind === "folder") {
        return { ...n, children: removeNodeById(n.children, id) };
      }
      return n;
    });
}

export function renameNodeById(nodes: EditorTreeNode[], id: string, name: string): EditorTreeNode[] {
  return mapTree(nodes, (n) => {
    if (n.id === id && (n.kind === "file" || n.kind === "screen" || n.kind === "folder")) {
      return { ...n, name } as EditorTreeNode;
    }
    return n;
  });
}

export function setScreenFormatLabel(
  nodes: EditorTreeNode[],
  screenId: string,
  formatLabel: string,
): EditorTreeNode[] {
  return mapTree(nodes, (n) => {
    if (n.kind === "screen" && n.id === screenId) {
      return { ...n, formatLabel };
    }
    return n;
  });
}

export function addSectionToScreen(nodes: EditorTreeNode[], screenId: string, sectionTitle: string): EditorTreeNode[] {
  return mapTree(nodes, (n) => {
    if (n.kind === "screen" && n.id === screenId) {
      const sections = n.sections ?? [];
      return {
        ...n,
        sections: [...sections, { id: crypto.randomUUID(), name: sectionTitle }],
      };
    }
    return n;
  });
}

