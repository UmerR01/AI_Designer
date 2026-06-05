"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  Plus,
  Send,
  Search,
  Layout,
  Trash2,
  Type,
  Sidebar,
  ArrowRight,
  Monitor,
  Smartphone,
  Mic,
  Paperclip,
  MoreHorizontal,
  Download,
  Share,
  LayoutGrid,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

import { readDesignerProjects, type DesignerProject, type ProjectKind } from "@/lib/designer-projects";
import { ApiError, getJson, getMeCached, postJson, putJson } from "@/lib/auth-api";
import { loginUrlWithNext } from "@/lib/auth/login-redirect";
import {
  addChildToFolder,
  defaultFrameForFolder,
  EDITOR_FOLDER_PRACTICE_ROOT,
  EDITOR_FOLDER_UX_SCREENS,
  findNodeById,
  getEditorBootstrap,
  isBlankStarterTree,
  isDefaultUiUxBootstrapTree,
  collectScreens,
  countScreensInTree,
  treeHasScreens,
  type EditorTreeNode,
  resolveProjectKind,
  setScreenFormatLabel,
  sidebarFilesLabel,
  RESOLUTIONS,
  removeNodeById,
  addSectionToScreen,
  mapTree,
  renameNodeById,
  duplicateNodeById,
  convertToPx,
} from "@/lib/editor-project";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UIDesignerEditorChatPanel } from "@/components/editor/ui-designer/UIDesignerEditorChatPanel";
import {
  UiPrototypeFlowPanel,
  type FlowGalleryImage,
} from "@/components/editor/ui-designer/UiPrototypeFlowPanel";
import {
  dedupeGeneratedImages,
  hydrateLoadedGeneratedImages,
  inferScreenLabelFromImage,
  isLandingPagePrototypeImage,
  landingPrototypeOwnerScreenId,
  prototypeImagesSignature,
  reconcileUploadedImages,
  repairLandingPrototypeImageTags,
  stripDataUrlsForProjectJson,
} from "@/lib/generated-ui-images";
import {
  downloadImageAsFavicon,
  downloadImageAsPng,
  sanitizeDownloadBasename,
  sanitizePngFilename,
} from "@/lib/download-image";
import { LOGO_PRESETS } from "@/lib/logo-presets";
import { coercePersistedProjectData } from "@/lib/persisted-project-data";
import type { ProjectRole } from "@/lib/projects/authz";
import {
  buildFlowGraphFromImages,
  ensureFlowRelations,
  flowGraphPersistenceKey,
  mergeFlowGraphs,
  orderFlowGalleryImages,
  resolvePersistedFlowGraph,
  supportsPrototypeFlow,
  type UiFlowGraph,
} from "@/lib/ui-flow-graph";
import {
  ensureEditorTreeForHydration,
  repairPrototypeTreeForLoad,
  shareClaimStorageKey,
  syncPrototypeSectionsToTree,
  usesPrototypeSectionCanvas,
} from "@/lib/prototype-tree-sync";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShareDialog } from "@/components/share/share-dialog";

const STORAGE_PREFIX = "designer.project.";

const SOCIAL_PRESETS = [
  { id: 1, name: "Instagram Post (Square)", platform: "Instagram", size: "1080 × 1080 px", w: 1080, h: 1080 },
  { id: 2, name: "Instagram Portrait Post", platform: "Instagram", size: "1080 × 1350 px", w: 1080, h: 1350 },
  { id: 3, name: "Instagram Story", platform: "Instagram", size: "1080 × 1920 px", w: 1080, h: 1920 },
  { id: 4, name: "Facebook Post", platform: "Facebook", size: "1200 × 630 px", w: 1200, h: 630 },
  { id: 5, name: "Facebook Cover Banner", platform: "Facebook", size: "1640 × 624 px", w: 1640, h: 624 },
  { id: 6, name: "LinkedIn Post", platform: "LinkedIn", size: "1200 × 1200 px", w: 1200, h: 1200 },
  { id: 7, name: "LinkedIn Banner", platform: "LinkedIn", size: "1584 × 396 px", w: 1584, h: 396 },
  { id: 8, name: "TikTok / Reel Canvas", platform: "TikTok / Reels", size: "1080 × 1920 px", w: 1080, h: 1920 },
  { id: 9, name: "X (Twitter) Header", platform: "X / Twitter", size: "1500 × 500 px", w: 1500, h: 500 },
  { id: 10, name: "YouTube Thumbnail", platform: "YouTube", size: "1280 × 720 px", w: 1280, h: 720 },
];

type MeResponse = {
  user: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  } | null;
};

type GeneratedUiImage = {
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

type PersistedEditorData = {
  tree: EditorTreeNode[];
  activeId: string;
  openFolders: Record<string, boolean>;
  generatedUiImages?: GeneratedUiImage[];
  uiFlowGraph?: UiFlowGraph | null;
  savedAt?: string;
};

function initials(first: string | undefined, last: string | undefined, email: string | undefined) {
  const a = (first?.trim()?.[0] ?? "").toUpperCase();
  const b = (last?.trim()?.[0] ?? "").toUpperCase();
  if (a || b) return `${a}${b}`.trim();
  return (email?.trim()?.[0] ?? "U").toUpperCase();
}

function normalizePersistedEditorData(raw: unknown): PersistedEditorData | null {
  if (!raw || typeof raw !== "object") return null;
  return coercePersistedProjectData(raw);
}

function classifyGeneratedImage(img: GeneratedUiImage): "logo" | "mobile" | "poster" | "web" | "generic" {
  const hay = `${img.page_name ?? ""} ${img.filename ?? ""}`.toLowerCase();
  if (hay.includes("logo")) return "logo";
  if (hay.includes("mobile") || hay.includes("phone") || hay.includes("ios") || hay.includes("android")) return "mobile";
  if (hay.includes("poster") || hay.includes("instagram") || hay.includes("flyer") || hay.includes("banner")) return "poster";
  if (hay.includes("web") || hay.includes("desktop") || hay.includes("dashboard") || hay.includes("landing")) return "web";
  return "generic";
}

function isImageOwnedByOtherScreen(
  img: GeneratedUiImage,
  currentScreenId: string,
  tree: EditorTreeNode[],
): boolean {
  const match = (img.page_name || "").match(/\[ScreenID:([^\]]+)\]/i);
  if (!match) return false;
  const ownerId = match[1];
  if (ownerId === currentScreenId) return false;
  const ownerScreen = findNodeById(tree, ownerId);
  return ownerScreen?.kind === "screen";
}

/** True when this generated image should render on the given screen artboard. */
function imageBelongsToScreen(
  img: GeneratedUiImage,
  screenId: string,
  tree: EditorTreeNode[],
): boolean {
  const name = img.page_name || "";
  const tagMatch = name.match(/\[ScreenID:([^\]]+)\]/i);
  if (tagMatch) return tagMatch[1] === screenId;

  if (isImageOwnedByOtherScreen(img, screenId, tree)) return false;

  const screen = findNodeById(tree, screenId);
  if (!screen || screen.kind !== "screen") return false;

  if (isLandingPagePrototypeImage(img)) {
    return landingPrototypeOwnerScreenId(img, tree) === screenId;
  }

  const screenName = (screen.name || "").toLowerCase();
  const isUntitled = screenName === "untitled" || screenName.startsWith("untitled ");
  if (isUntitled) return false;

  const hay = `${img.page_name ?? ""} ${img.filename ?? ""}`.toLowerCase();
  return Boolean(screenName && hay.includes(screenName));
}

function pickImageForSection(
  screen: any,
  sec: { id: string; name: string },
  idx: number,
  images: GeneratedUiImage[],
  tree: EditorTreeNode[],
): GeneratedUiImage | null {
  if (!images.length) return null;
  const sorted = images
    .slice()
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  // 1. Match by explicit Section ID tag in page_name
  const sectionIdTag = `[SectionID:${sec.id}]`;
  const directBySectionId = sorted.find((img) => {
    const name = img.page_name || "";
    return name.includes(sectionIdTag) || name === sec.id;
  });
  if (directBySectionId) return directBySectionId;

  const directByScreenNameOnSection = sorted.find((img) => {
    const label = (img.screenName || "").trim().toLowerCase();
    if (!label) return false;
    return label === (sec.name || "").trim().toLowerCase();
  });
  if (directByScreenNameOnSection) return directByScreenNameOnSection;

  // 2. Match by explicit Screen ID tag in page_name
  const screenIdTag = `[ScreenID:${screen.id}]`;
  const directByScreenId = sorted.find((img) => {
    const name = (img.page_name || "").toLowerCase();
    const hasTag = name.includes(screenIdTag.toLowerCase()) || name === screen.id.toLowerCase();
    if (!hasTag) return false;

    // Verify it belongs to this screen name if it has a clean name suffix
    const cleanName = name.replace(screenIdTag.toLowerCase(), "").trim();
    if (cleanName && cleanName !== "style guide" && cleanName !== "brand logo" && cleanName !== "illustration" && cleanName !== "social post") {
      const screenName = (screen.name || "").toLowerCase();
      const isUntitled = screenName === "untitled" || screenName.startsWith("untitled ");
      if (!isUntitled && !cleanName.includes(screenName) && !screenName.includes(cleanName)) {
        return false;
      }
    }
    return true;
  });

  // 3. Fall back to name or format label match (excluding default "untitled" names)
  const screenName = (screen.name || "").toLowerCase();
  const format = (screen.formatLabel || "").toLowerCase();
  const isUntitled = screenName === "untitled" || screenName.startsWith("untitled ");

  const directByNameOrFormat = sorted.find((img) => {
    // Skip if owned by another active screen in the tree
    if (isImageOwnedByOtherScreen(img, screen.id, tree)) {
      return false;
    }

    const hay = `${img.page_name ?? ""} ${img.filename ?? ""}`.toLowerCase();
    const nameMatch = !isUntitled && screenName && hay.includes(screenName);
    const formatMatch = format && hay.includes(format);
    return nameMatch || formatMatch;
  });

  // Resolve priority:
  // If we have an image matching the screen ID:
  // By default, the screen-level image belongs to the first section (idx === 0).
  // Subsequent sections (idx > 0) should not inherit the screen image.
  if (directByScreenId) {
    if (idx === 0) {
      return directByScreenId;
    }
  }

  // If there is an image matching by name/format:
  // Again, only apply it to the first section (idx === 0) as a fallback.
  if (directByNameOrFormat) {
    if (idx === 0) {
      return directByNameOrFormat;
    }
  }

  // Landing page: tagged screen, or legacy untagged image on the first artboard only.
  if (idx === 0) {
    const landingPrototype = sorted.find((img) => {
      if (!isLandingPagePrototypeImage(img)) return false;
      return landingPrototypeOwnerScreenId(img, tree) === screen.id;
    });
    if (landingPrototype) return landingPrototype;
  }

  return null;
}

function inferPrototypeAnchor(
  img: GeneratedUiImage,
  flow: UiFlowGraph | null | undefined,
): boolean {
  if (img.isAnchor) return true;
  if (!flow?.nodes?.length) return false;
  const firstNode = [...flow.nodes].sort(
    (a, b) => (a.order ?? 999) - (b.order ?? 999),
  )[0];
  if (!firstNode) return false;
  const label = (img.screenName || img.page_name || "")
    .replace(/\[SectionID:[^\]]+\]\s*/gi, "")
    .trim()
    .toLowerCase();
  return label === (firstNode.screen || "").trim().toLowerCase();
}

function enrichPrototypeImageMetadata(
  images: GeneratedUiImage[],
  flow: UiFlowGraph | null | undefined,
): GeneratedUiImage[] {
  if (!flow?.nodes?.length) return images;
  const total = flow.nodes.length;
  return images.map((img) => {
    const isAnchor = inferPrototypeAnchor(img, flow);
    const label = inferScreenLabelFromImage(img);
    const node =
      flow.nodes.find((n) => n.id === img.nodeId) ||
      flow.nodes.find(
        (n) =>
          (n.screen || "").trim().toLowerCase() ===
          (img.screenName || label || "").trim().toLowerCase(),
      );
    return {
      ...img,
      isAnchor,
      nodeId: img.nodeId || node?.id,
      screenName: img.screenName || node?.screen || label,
      index: node?.order ?? img.index,
      total: img.total ?? total,
    };
  });
}

function normalizePracticeTreeFlat(tree: EditorTreeNode[]) {
  const screens = tree.filter((n): n is Extract<EditorTreeNode, { kind: "screen" }> => n.kind === "screen");
  const fromCanvasFolder = tree
    .filter((n): n is Extract<EditorTreeNode, { kind: "folder" }> => n.kind === "folder")
    .flatMap((f) => f.children.filter((c): c is Extract<EditorTreeNode, { kind: "screen" }> => c.kind === "screen"));

  const merged = [...screens, ...fromCanvasFolder];
  return merged;
}

const SHARED_EXIT_BLOCKED = new Set(["/projects", "/dashboard", "/"]);

export default function ProjectEditorPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const projectId = params?.id ?? "";
  const sharedFromLink = searchParams.get("shared") === "1";

  const [projectMeta, setProjectMeta] = useState<DesignerProject | null>(null);
  const projectKind = resolveProjectKind(projectMeta?.kind);

  const [tree, setTree] = useState<EditorTreeNode[]>([]);
  const treeRef = useRef<EditorTreeNode[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const prevScreenCountRef = useRef(0);

  // Customizable Artboard Sizing Modal State
  const [sizeModalOpen, setSizeModalOpen] = useState(false);
  const [customWidth, setCustomWidth] = useState("");
  const [customHeight, setCustomHeight] = useState("");
  const [customUnit, setCustomUnit] = useState<"px" | "inch" | "cm" | "m">("px");
  const [pendingFolderId, setPendingFolderId] = useState<string | null>(null);

  // Viewport Scaling State
  const workspaceRef = useRef<HTMLDivElement>(null);
  const lastChatImagesSigRef = useRef("");
  const [zoomScale, setZoomScale] = useState(1);
  const clampZoom = (v: number) => Math.max(0.2, Math.min(3, v));

  // Meta: resolve kind from API first so bootstrap matches DB (local list may be missing the project).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const localMeta = readDesignerProjects().find((p) => p.id === projectId) ?? null;
      let resolvedMeta: DesignerProject | null = localMeta;
      let loadedRole: ProjectRole | null = null;

      try {
        const res = await getJson<{
          project: { id: string; name: string; kind: string };
          role: ProjectRole;
        }>(`/api/projects/${projectId}`);
        loadedRole = res.role ?? null;
        if (!cancelled) {
          setProjectRole(loadedRole);
          if (res.role === "viewer") {
            window.location.replace(`/view/${projectId}`);
            return;
          }
        }

        const found = res.project
          ? ({
              id: res.project.id,
              name: res.project.name,
              kind: res.project.kind as ProjectKind,
              sizeText: "0 GB",
              dateText: "",
            } satisfies DesignerProject)
          : null;
        if (!cancelled) {
          resolvedMeta = found ?? localMeta;
          setProjectMeta(resolvedMeta);
        }

        if (
          sharedFromLink &&
          res.role !== "owner" &&
          res.role !== "editor" &&
          res.role !== "viewer"
        ) {
          const claimSlug = sessionStorage.getItem(shareClaimStorageKey(projectId));
          if (claimSlug) {
            try {
              await postJson(`/api/share/${claimSlug}/claim`, {});
              const again = await getJson<{
                project: { id: string; name: string; kind: string };
                role: ProjectRole;
              }>(`/api/projects/${projectId}`);
              loadedRole = again.role ?? null;
              if (!cancelled) {
                setProjectRole(loadedRole);
                if (again.role === "viewer") {
                  window.location.replace(`/view/${projectId}`);
                  return;
                }
                if (again.project) {
                  resolvedMeta = {
                    id: again.project.id,
                    name: again.project.name,
                    kind: again.project.kind as ProjectKind,
                    sizeText: "0 GB",
                    dateText: "",
                  };
                  setProjectMeta(resolvedMeta);
                }
              }
            } catch {
              // fall through — hydration may still work for members
            }
          }
        }
      } catch (e) {
        if (!cancelled) {
          if (e instanceof ApiError && e.status === 401) {
            const returnPath = `/project/${projectId}${sharedFromLink ? "?shared=1" : ""}`;
            window.location.replace(loginUrlWithNext(returnPath));
            return;
          }
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
            const claimSlug = sharedFromLink
              ? sessionStorage.getItem(shareClaimStorageKey(projectId))
              : null;
            if (claimSlug) {
              try {
                await postJson(`/api/share/${claimSlug}/claim`, {});
                const again = await getJson<{
                  project: { id: string; name: string; kind: string };
                  role: ProjectRole;
                }>(`/api/projects/${projectId}`);
                loadedRole = again.role ?? null;
                setProjectRole(loadedRole);
                if (again.role === "viewer") {
                  window.location.replace(`/view/${projectId}`);
                  return;
                }
                if (again.project) {
                  resolvedMeta = {
                    id: again.project.id,
                    name: again.project.name,
                    kind: again.project.kind as ProjectKind,
                    sizeText: "0 GB",
                    dateText: "",
                  };
                  setProjectMeta(resolvedMeta);
                }
              } catch {
                toast.error("Sign in or use the share link you were given to access this project.");
                window.location.replace(loginUrlWithNext(`/project/${projectId}?shared=1`));
                return;
              }
            } else {
              toast.error("Sign in or use the share link you were given to access this project.");
              window.location.replace(loginUrlWithNext(`/project/${projectId}?shared=1`));
              return;
            }
          }
          resolvedMeta = localMeta;
          setProjectMeta(localMeta);
          setProjectRole(null);
        }
      }

      if (cancelled) return;

      const kind = resolveProjectKind(resolvedMeta?.kind);

      const draftKey = `draft.${STORAGE_PREFIX}${projectId}`;
      const savedKey = `${STORAGE_PREFIX}${projectId}`;
      const draft = localStorage.getItem(draftKey);
      const saved = localStorage.getItem(savedKey);

      const applyBootstrap = () => {
        const boot = getEditorBootstrap(kind);
        setTree(boot.tree);
        setActiveId(boot.activeId);
        setOpenFolders(boot.openFolders);
      };

      let localParsedData: PersistedEditorData | null = null;
      if (draft || saved) {
        try {
          localParsedData = normalizePersistedEditorData(JSON.parse(draft || saved || "{}"));
        } catch {
          localParsedData = null;
        }
      }

      let remoteParsedData: PersistedEditorData | null = null;
      try {
        const remote = await getJson<{ data: unknown }>(`/api/projects/${projectId}/data`);
        remoteParsedData = normalizePersistedEditorData(remote?.data);
      } catch {
        remoteParsedData = null;
      }

      let assetsFromDb: GeneratedUiImage[] = [];
      try {
        const assets = await getJson<{ images?: GeneratedUiImage[] }>(`/api/projects/${projectId}/assets`);
        assetsFromDb = Array.isArray(assets?.images) ? assets.images : [];
      } catch {
        assetsFromDb = [];
      }

      const hydratedDbAssets = hydrateLoadedGeneratedImages(assetsFromDb);

      // Build a merged image list: start with remote metadata, but prefer local data: URLs
      // over remote asset:// placeholders, and prefer DB URLs over both.
      // Priority order for URL: real DB URL > data: (local cache) > asset:// placeholder.
      const remoteImgs = remoteParsedData?.generatedUiImages ?? [];
      const localImgs = localParsedData?.generatedUiImages ?? [];

      // Build a map of local images by id to quickly look up data: URLs.
      const localById = new Map<string, GeneratedUiImage>();
      for (const img of localImgs) {
        if (img.id) localById.set(img.id, img);
      }

      // Merge: use remote as base (has richer metadata), but upgrade asset:// to local data: URL
      // if available, then further upgrade to real DB URL if available.
      const mergedImgs: GeneratedUiImage[] = [
        ...remoteImgs.map((img) => {
          let url = img.url;
          // Swap asset:// placeholder: prefer DB URL, then local data: URL
          if (url?.startsWith("asset://")) {
            const localVersion = localById.get(img.id);
            if (localVersion?.url && !localVersion.url.startsWith("asset://")) {
              url = localVersion.url; // use local data: URL as fallback
            }
          }
          return { ...img, url };
        }),
        // Include any local-only images not in remote (e.g. generated but not yet saved remotely)
        ...localImgs.filter((img) => img.id && !remoteImgs.some((r) => r.id === img.id)),
      ];

      const projectImageMeta = hydrateLoadedGeneratedImages(
        dedupeGeneratedImages(mergedImgs),
        hydratedDbAssets,
      );
      const mergedServerImages = dedupeGeneratedImages(
        hydratedDbAssets.length
          ? reconcileUploadedImages(projectImageMeta, hydratedDbAssets)
          : projectImageMeta,
      );

      const remoteSavedAt = (remoteParsedData as { savedAt?: string } | null)?.savedAt;
      const localSavedAt = (localParsedData as { savedAt?: string } | null)?.savedAt;
      const remoteIsNewer =
        remoteSavedAt &&
        (!localSavedAt || remoteSavedAt.localeCompare(localSavedAt) >= 0);

      const isCollaborator =
        sharedFromLink || loadedRole === "editor" || loadedRole === "viewer";
      const parsedData = isCollaborator
        ? remoteParsedData ?? localParsedData
        : remoteIsNewer && remoteParsedData
          ? { ...localParsedData, ...remoteParsedData }
          : localParsedData ?? remoteParsedData;

      let restoredFlowGraph = ensureFlowRelations(
        remoteParsedData?.uiFlowGraph ?? localParsedData?.uiFlowGraph ?? null,
      );
      const flowFromImages = buildFlowGraphFromImages(mergedServerImages);
      if (flowFromImages) {
        restoredFlowGraph = ensureFlowRelations(
          mergeFlowGraphs(restoredFlowGraph, flowFromImages),
        );
      }

      const imagesWithMeta = enrichPrototypeImageMetadata(
        hydrateLoadedGeneratedImages(mergedServerImages, hydratedDbAssets),
        restoredFlowGraph,
      );

      if (parsedData) {
        let { tree, activeId, openFolders } = parsedData;
        // Previously we bootstrapped as ui/ux before API kind arrived; fix stale default trees for website projects.
        if (
          (kind === "website design" || kind === "landing page" || kind === "multi-page website") &&
          isDefaultUiUxBootstrapTree(tree)
        ) {
          const boot = getEditorBootstrap(kind);
          tree = boot.tree;
          activeId = boot.activeId;
          openFolders = boot.openFolders;
        }
        if (kind !== "campaign design") {
          const flattened = normalizePracticeTreeFlat(tree);
          tree = flattened;
          openFolders = {};
          if (!flattened.some((n) => n.id === activeId)) {
            activeId = flattened[0]?.id ?? "";
          }
        }

        if (imagesWithMeta.length === 0 && isBlankStarterTree(tree)) {
          tree = [];
          activeId = "";
          openFolders = {};
        }

        let imagesForEditor = imagesWithMeta;

        if (imagesForEditor.length > 0) {
          const ensured = ensureEditorTreeForHydration(
            tree,
            activeId,
            imagesForEditor,
            kind,
          );
          tree = ensured.tree;
          activeId = ensured.activeId;
        }

        if (kind === "landing page") {
          imagesForEditor = repairLandingPrototypeImageTags(imagesForEditor, tree);
        }

        setTree(tree);
        treeRef.current = tree;
        setActiveId(activeId);
        setOpenFolders(openFolders);
        setGeneratedUiImages(imagesForEditor);
        setUiFlowGraph(restoredFlowGraph);
        lastChatImagesSigRef.current = prototypeImagesSignature(imagesForEditor);
        if (draft && draft !== saved) setIsDirty(true);
      } else {
        const boot = getEditorBootstrap(kind);
        let bootTree = boot.tree;
        let bootActiveId = boot.activeId;
        let bootImages = imagesWithMeta;
        if (bootImages.length > 0) {
          const ensured = ensureEditorTreeForHydration(
            bootTree,
            bootActiveId,
            bootImages,
            kind,
          );
          bootTree = ensured.tree;
          bootActiveId = ensured.activeId;
        }
        if (kind === "landing page") {
          bootImages = repairLandingPrototypeImageTags(bootImages, bootTree);
        }
        setTree(bootTree);
        setActiveId(bootActiveId);
        setOpenFolders(boot.openFolders);
        treeRef.current = bootTree;
        setGeneratedUiImages(bootImages);
        setUiFlowGraph(restoredFlowGraph);
        lastChatImagesSigRef.current = prototypeImagesSignature(bootImages);
      }
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Re-attach legacy landing prototypes (saved without [ScreenID:…]) to the first artboard.
  useEffect(() => {
    if (!hydrated || projectKind !== "landing page") return;
    setGeneratedUiImages((prev) => {
      const next = repairLandingPrototypeImageTags(prev, tree);
      return prototypeImagesSignature(prev) === prototypeImagesSignature(next) ? prev : next;
    });
  }, [hydrated, projectKind, tree]);

  const [isDirty, setIsDirty] = useState(false);
  const isFirstRender = useRef(true);
  const dirtyRef = useRef(false);
  const isCleaningUpRef = useRef(false);

  const [showExitModal, setShowExitModal] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [projectRole, setProjectRole] = useState<ProjectRole | null>(null);
  const isOwner = projectRole === "owner";
  const isSharedEditor =
    projectRole === "editor" || (sharedFromLink && projectRole !== "owner");
  const [me, setMe] = useState<MeResponse["user"]>(null);
  const [generatedUiImages, setGeneratedUiImages] = useState<GeneratedUiImage[]>([]);
  const [uiFlowGraph, setUiFlowGraph] = useState<UiFlowGraph | null>(null);
  const prototypeSectionMapRef = useRef<Map<string, string>>(new Map());
  const restoredPrototypeSectionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(() => {
    prototypeSectionMapRef.current = new Map();
    restoredPrototypeSectionsRef.current = new Set();
  }, [projectId]);

  const resolveEditorScreenId = useCallback(
    (treeNodes: EditorTreeNode[], preferredId: string): string | null => {
      const node = findNodeById(treeNodes, preferredId);
      if (!node) return null;
      if (node.kind === "screen") return node.id;
      if (node.kind === "folder" && node.children?.length) {
        const firstScreen = node.children.find((c) => c.kind === "screen");
        return firstScreen?.id ?? null;
      }
      return null;
    },
    [],
  );

  const ensurePrototypeSection = useCallback(
    (info: { screenName: string; nodeId?: string }): string | null => {
      if (!supportsPrototypeFlow(projectKind)) return null;
      const label = (info.screenName || "Screen").trim() || "Screen";
      const mapKey = (info.nodeId || label).toLowerCase();

      const cached = prototypeSectionMapRef.current.get(mapKey);
      if (cached) return cached;

      const currentTree = treeRef.current;
      let screenId = resolveEditorScreenId(currentTree, activeId);
      if (!screenId && usesPrototypeSectionCanvas(projectKind)) {
        const screens = collectScreens(currentTree);
        if (screens.length >= 1) screenId = screens[0].id;
      }
      if (!screenId) {
        const newScreenId = crypto.randomUUID();
        const newSectionId = crypto.randomUUID();
        const frame: "desktop" | "mobile" =
          projectKind === "product design - app" ? "mobile" : "desktop";
        prototypeSectionMapRef.current.set(mapKey, newSectionId);
        setTree((prev) => {
          const next: EditorTreeNode[] = [
            ...prev,
            {
              id: newScreenId,
              kind: "screen" as const,
              name: "Untitled",
              frame,
              sections: [{ id: newSectionId, name: label }],
              expansionDirection: "vertical" as const,
            },
          ];
          treeRef.current = next;
          return next;
        });
        setActiveId(newScreenId);
        return newSectionId;
      }

      const screenNode = findNodeById(treeRef.current, screenId);
      if (!screenNode || screenNode.kind !== "screen") return null;

      const sections = screenNode.sections ?? [];
      const existingByName = sections.find(
        (s) => (s.name || "").trim().toLowerCase() === label.toLowerCase(),
      );
      if (existingByName) {
        prototypeSectionMapRef.current.set(mapKey, existingByName.id);
        return existingByName.id;
      }

      const hasSectionImage = (sectionId: string) =>
        generatedUiImages.some((img) =>
          (img.page_name || "").includes(`[SectionID:${sectionId}]`),
        );

      const onlyDefaultSection =
        sections.length === 1 &&
        /^first section$/i.test(sections[0].name || "") &&
        !hasSectionImage(sections[0].id);

      if (onlyDefaultSection) {
        const sectionId = sections[0].id;
        prototypeSectionMapRef.current.set(mapKey, sectionId);
        setTree((prev) => {
          const next = mapTree(prev, (n) => {
            if (n.kind !== "screen" || n.id !== screenId) return n;
            return {
              ...n,
              sections: (n.sections ?? []).map((s) =>
                s.id === sectionId ? { ...s, name: label } : s,
              ),
            };
          });
          treeRef.current = next;
          return next;
        });
        return sectionId;
      }

      const newSectionId = crypto.randomUUID();
      prototypeSectionMapRef.current.set(mapKey, newSectionId);
      setTree((prev) => {
        const next = mapTree(prev, (n) => {
          if (n.kind !== "screen" || n.id !== screenId) return n;
          return {
            ...n,
            sections: [...(n.sections ?? []), { id: newSectionId, name: label }],
          };
        });
        treeRef.current = next;
        return next;
      });
      return newSectionId;
    },
    [activeId, projectKind, generatedUiImages, resolveEditorScreenId],
  );

  /** Chat is source of truth while generating — replace with latest full image list. */
  const syncImagesFromChat = useCallback(
    (incoming: GeneratedUiImage[]) => {
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      let list = incoming;
      if (projectKind === "landing page") {
        list = repairLandingPrototypeImageTags(list, tree);
      }
      if (supportsPrototypeFlow(projectKind)) {
        setTree((prev) => {
          const { tree: next, activeId: nextActive, sectionMap } =
            syncPrototypeSectionsToTree(prev, activeId, list, projectKind);
          for (const [k, v] of sectionMap) prototypeSectionMapRef.current.set(k, v);
          treeRef.current = next;
          if (nextActive && nextActive !== activeId) setActiveId(nextActive);
          return next;
        });
      }
      setGeneratedUiImages((prev) => {
        const next = dedupeGeneratedImages(
          enrichPrototypeImageMetadata(list, uiFlowGraph),
        );
        const nextSig = prototypeImagesSignature(next);
        if (prototypeImagesSignature(prev) === nextSig) return prev;
        lastChatImagesSigRef.current = nextSig;
        return next;
      });
      const rebuilt = buildFlowGraphFromImages(list);
      if (rebuilt?.nodes?.length) {
        setUiFlowGraph((prev) => mergeFlowGraphs(prev, rebuilt) ?? rebuilt);
        setIsDirty(true);
        dirtyRef.current = true;
      }
    },
    [uiFlowGraph, projectKind, activeId, tree],
  );

  const applyFlowGraph = useCallback((incoming: UiFlowGraph | null) => {
    setUiFlowGraph((prevGraph) => {
      const merged = mergeFlowGraphs(prevGraph, incoming);
      const resolved = ensureFlowRelations(merged);
      setGeneratedUiImages((prevImages) => {
        if (!resolved?.nodes?.length || prevImages.length === 0) return prevImages;
        const next = dedupeGeneratedImages(
          enrichPrototypeImageMetadata(prevImages, resolved),
        );
        const nextSig = prototypeImagesSignature(next);
        if (prototypeImagesSignature(prevImages) === nextSig) return prevImages;
        lastChatImagesSigRef.current = nextSig;
        return next;
      });
      if (resolved?.nodes?.length) {
        setIsDirty(true);
        dirtyRef.current = true;
      }
      return resolved;
    });
  }, []);

  const uploadImagesToServer = useCallback(
    async (images: GeneratedUiImage[], flow: UiFlowGraph | null) => {
      if (!projectId || images.length === 0) return images;

      const screens = images.filter(
        (img) => !String(img.page_name || "").toLowerCase().includes("style guide"),
      );

      // Upload each image individually — base64 data: URLs can be 2-10 MB each and
      // a combined payload can exceed the server body-size limit, causing a silent 413
      // that leaves images unresolvable after project reload.
      for (const img of screens) {
        try {
          await postJson(`/api/projects/${projectId}/assets`, {
            source: "ui-designer",
            images: [img],
            uiFlowGraph: resolvePersistedFlowGraph(flow, images),
          });
        } catch (e) {
          console.error("[project] asset upload failed for image", img.id, img.page_name, e);
        }
      }

      try {
        const res = await getJson<{ images?: GeneratedUiImage[] }>(
          `/api/projects/${projectId}/assets`,
        );
        if (res.images?.length) {
          return reconcileUploadedImages(images, res.images);
        }
      } catch (e) {
        console.warn("[project] could not reload assets after upload", e);
      }

      return images;
    },
    [projectId],
  );

  // Keep one artboard + sections in sync when prototype images load (shared editors, reload).
  useEffect(() => {
    if (!hydrated || !supportsPrototypeFlow(projectKind)) return;
    if (generatedUiImages.length === 0) return;

    const { tree: next, activeId: nextActive, sectionMap } = syncPrototypeSectionsToTree(
      treeRef.current,
      activeId,
      generatedUiImages,
      projectKind,
    );
    for (const [k, v] of sectionMap) {
      prototypeSectionMapRef.current.set(k, v);
      restoredPrototypeSectionsRef.current.add(k);
    }
    const treeChanged = JSON.stringify(next) !== JSON.stringify(treeRef.current);
    if (treeChanged) {
      treeRef.current = next;
      setTree(next);
    }
    if (nextActive && nextActive !== activeId) setActiveId(nextActive);
  }, [hydrated, generatedUiImages, projectKind, activeId]);

  const [isSaving, setIsSaving] = useState(false);
  const [brokenImageKeys, setBrokenImageKeys] = useState<Record<string, boolean>>({});
  const lastAutoSyncedImagesRef = useRef<string>("");
  const persistInFlightRef = useRef(false);
  const persistBackoffUntilRef = useRef(0);
  const autoSaveErrorToastAtRef = useRef(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Current user (for initials bubble)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getMeCached<MeResponse>();
        if (!cancelled) setMe(res.user ?? null);
      } catch {
        if (!cancelled) setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Track Unsaved Changes
  useEffect(() => {
    if (!hydrated) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setIsDirty(true);
    dirtyRef.current = true;
  }, [tree, generatedUiImages, uiFlowGraph, hydrated]);

  // History Interceptor (The "Strict Lock")
  useEffect(() => {
    if (!isDirty) return;

    const handlePopState = (e: PopStateEvent) => {
      if (isCleaningUpRef.current) return;
      window.history.pushState(null, "", window.location.href);
      if (isSharedEditor) {
        window.history.pushState(null, "", window.location.href);
        return;
      }
      setPendingHref("/projects");
      setShowExitModal(true);
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isDirty, isSharedEditor]);

  // Tab Close Guard (Bulletproof Ref-Based)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current && !isCleaningUpRef.current) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  function buildPersistedEditorData(
    images: GeneratedUiImage[] = generatedUiImages,
    forServer = false,
    flowOverride?: UiFlowGraph | null,
  ): PersistedEditorData {
    const storedImages = forServer ? stripDataUrlsForProjectJson(images) : images;
    const flowToSave = resolvePersistedFlowGraph(
      flowOverride ?? uiFlowGraph,
      storedImages,
    );
    return {
      tree,
      activeId,
      openFolders,
      generatedUiImages: storedImages,
      uiFlowGraph: flowToSave,
      savedAt: new Date().toISOString(),
    };
  }

  async function persistProjectData() {
    if (persistInFlightRef.current) return;
    if (Date.now() < persistBackoffUntilRef.current) return;

    persistInFlightRef.current = true;
    const storageKey = `${STORAGE_PREFIX}${projectId}`;
    try {
      let images = enrichPrototypeImageMetadata(generatedUiImages, uiFlowGraph);
      if (images.length > 0) {
        images = enrichPrototypeImageMetadata(
          await uploadImagesToServer(images, uiFlowGraph),
          uiFlowGraph,
        );
        setGeneratedUiImages(images);
        lastChatImagesSigRef.current = prototypeImagesSignature(images);
      }
      const flowToSave = resolvePersistedFlowGraph(uiFlowGraph, images);
      if (flowToSave && (uiFlowGraph?.nodes?.length ?? 0) < 2) {
        setUiFlowGraph(flowToSave);
      }
      const payload = buildPersistedEditorData(images, true, flowToSave);
      try {
        const localPayload = buildPersistedEditorData(images, false);
        localStorage.setItem(storageKey, JSON.stringify(localPayload));
        localStorage.setItem(
          `draft.${STORAGE_PREFIX}${projectId}`,
          JSON.stringify(localPayload),
        );
      } catch (e) {
        console.warn("localStorage quota exceeded for project save", e);
      }
      await putJson<{ ok: boolean }>(`/api/projects/${projectId}/data`, { data: payload });
      lastAutoSyncedImagesRef.current = [
        images
          .map((i) => i.id)
          .sort()
          .join("|"),
        flowGraphPersistenceKey(flowToSave),
        tree.length,
      ].join("::");
    } catch (e) {
      persistBackoffUntilRef.current = Date.now() + 30_000;
      throw e;
    } finally {
      persistInFlightRef.current = false;
    }
  }

  async function handleSaveProject() {
    if (!projectId || isSaving) return;
    setIsSaving(true);
    try {
      await persistProjectData();
      setIsDirty(false);
      dirtyRef.current = false;
      setShowExitModal(false);
      toast.success("Project saved.");
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Could not save project to server.");
    } finally {
      setIsSaving(false);
    }
  }

  // Persistence Effect (Drafting)
  useEffect(() => {
    if (!hydrated || !projectId) return;
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(
          `draft.${STORAGE_PREFIX}${projectId}`,
          JSON.stringify(buildPersistedEditorData()),
        );
      } catch (e) {
        console.warn("localStorage quota exceeded for draft save", e);
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [tree, activeId, openFolders, generatedUiImages, uiFlowGraph, hydrated, projectId]);

  // Auto-sync: upload images to project_assets, then save project JSON (incl. uiFlowGraph).
  useEffect(() => {
    if (!hydrated || !projectId || generatedUiImages.length === 0) return;
    const signature = [
      generatedUiImages
        .map((i) => i.id)
        .sort()
        .join("|"),
      flowGraphPersistenceKey(
        resolvePersistedFlowGraph(uiFlowGraph, generatedUiImages),
      ),
      tree.length,
    ].join("::");
    if (signature === lastAutoSyncedImagesRef.current) return;

    const timeout = window.setTimeout(() => {
      void persistProjectData().catch((e: unknown) => {
        console.warn("[project] auto-save failed", e);
        const now = Date.now();
        if (now - autoSaveErrorToastAtRef.current < 60_000) return;
        autoSaveErrorToastAtRef.current = now;
        const err = e as { detail?: string; message?: string };
        toast.error(
          err?.detail ??
            err?.message ??
            "Could not auto-save project. Use Save or check your connection.",
        );
      });
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [generatedUiImages, uiFlowGraph, hydrated, projectId, tree, activeId, openFolders]);

  function handleDiscardAndExit() {
    isCleaningUpRef.current = true;
    setIsDirty(false);
    dirtyRef.current = false;
    const target = pendingHref || "/projects";
    window.location.href = target;
  }

  async function handleSaveAndExit() {
    isCleaningUpRef.current = true;
    try {
      await persistProjectData();
      setIsDirty(false);
      dirtyRef.current = false;
      window.location.href = pendingHref || "/projects";
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Could not save before leaving.");
      isCleaningUpRef.current = false;
    }
  }

  // Internal Navigation Security
  function handleSafeNavigate(href: string) {
    if (isSharedEditor && SHARED_EXIT_BLOCKED.has(href)) {
      toast.message("This project was shared with you for editing only.");
      return;
    }
    if (isDirty) {
      setPendingHref(href);
      setShowExitModal(true);
      return;
    }
    window.location.href = href;
  }

  // Viewport Scaling Calculation
  useEffect(() => {
    if (projectKind === "practice") return;
    if (!workspaceRef.current || !activeId) return;

    const updateScale = () => {
      if (!workspaceRef.current) return;
      const container = workspaceRef.current;
      const rect = container.getBoundingClientRect();
      const padding = 64;

      const node = findNodeById(tree, activeId);
      if (!node || node.kind !== "screen") {
        setZoomScale(1);
        return;
      }

      let baseWidth = node.frame === "mobile" ? 375 : 1440;
      let baseHeight = node.frame === "mobile" ? 812 : 900;

      if (node.width) {
        baseWidth = convertToPx(node.width, node.unit);
      }
      if (node.height) {
        baseHeight = convertToPx(node.height, node.unit);
      }

      if (!node.width || !node.height) {
        if (projectKind === "logo design") { baseWidth = 800; baseHeight = 800; }
        if (projectKind === "ui/ux design" || projectKind === "product design" || projectKind === "product design - desktop") { baseWidth = 1920; baseHeight = 1080; }
        if (projectKind === "product design - packaging") { baseWidth = 1200; baseHeight = 1200; }
        if (projectKind === "social media design") { baseWidth = 1080; baseHeight = 1080; }
      }

      const isWeb = projectKind === "website design" || projectKind === "landing page" || projectKind === "multi-page website";
      const sectionsCount = node.sections?.length || 1;
      const totalWidth = node.frame === "mobile" && isWeb
        ? (baseWidth + 32) * sectionsCount
        : baseWidth;
      const totalHeight = node.frame === "mobile" && isWeb
        ? baseHeight
        : (baseHeight + 48) * sectionsCount;

      const scaleX = (rect.width - padding) / totalWidth;
      const scaleY = (rect.height - padding) / totalHeight;

      let finalScale;
      // For multi-section projects, we fix one dimension to prevent zooming out upon expansion
      if (isWeb || projectKind === "ui/ux design" || projectKind?.startsWith("product design")) {
        if (node.expansionDirection === "horizontal") {
          finalScale = Math.min(scaleY, 1.1); // Fit height, allow slight prominence
        } else {
          finalScale = Math.min(scaleX, 1.1); // Fit width
        }
      } else {
        finalScale = Math.min(scaleX, scaleY, 1.1);
      }

      setZoomScale(finalScale);
    };

    const observer = new ResizeObserver(updateScale);
    observer.observe(workspaceRef.current);
    updateScale();

    return () => observer.disconnect();
  }, [activeId, tree, projectKind]);

  function handleWorkspaceWheel(e: React.WheelEvent<HTMLDivElement>) {
    // Trackpad pinch and Ctrl/Cmd + wheel should zoom.
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setZoomScale((prev) => clampZoom(prev * factor));
  }

  // Scroll Reset Logic: Centers the viewport whenever switching screens
  useEffect(() => {
    if (workspaceRef.current) {
      workspaceRef.current.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [activeId]);

  const filesLabel = sidebarFilesLabel(projectKind);
  const activeNode = useMemo(() => findNodeById(tree, activeId), [tree, activeId]);
  const showDesignerChat = useMemo(() => {
    return treeHasScreens(tree);
  }, [tree]);

  useEffect(() => {
    const count = countScreensInTree(tree);
    if (prevScreenCountRef.current === 0 && count > 0) {
      setIsSidebarCollapsed(false);
    }
    prevScreenCountRef.current = count;
  }, [tree]);

  // New social media projects: show preset grid (not the custom size dialog).
  useEffect(() => {
    if (!hydrated || projectKind !== "social media design") return;
    if (countScreensInTree(tree) === 0) {
      setPresetPickerOpen(true);
    }
  }, [hydrated, projectKind, tree]);
  const latestGeneratedUiImage = useMemo(() => {
    if (!generatedUiImages.length) return null;
    return generatedUiImages
      .slice()
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
  }, [generatedUiImages]);

  const prototypeScreenCount = generatedUiImages.filter(
    (img) => !String(img.page_name || "").toLowerCase().includes("style guide"),
  ).length;

  /** Multi-page sites tag images with [SectionID:…]; use same matching as the canvas. */
  const activeScreenHasPrototypeImages = useMemo(() => {
    if (!activeId || activeNode?.kind !== "screen") return false;
    const screen = activeNode;
    const sections = screen.sections ?? [{ id: "base", name: "Base" }];
    return sections.some((sec, idx) =>
      Boolean(pickImageForSection(screen, sec, idx, generatedUiImages, tree)),
    );
  }, [generatedUiImages, activeId, activeNode, tree]);

  const displayFlowGraph = useMemo(() => {
    const fromState = ensureFlowRelations(uiFlowGraph);
    if ((fromState?.nodes?.length ?? 0) >= 2) return fromState;
    return ensureFlowRelations(buildFlowGraphFromImages(generatedUiImages));
  }, [uiFlowGraph, generatedUiImages]);

  const flowGalleryImages = useMemo((): FlowGalleryImage[] => {
    const flowNodeNames = new Set(
      (displayFlowGraph?.nodes ?? uiFlowGraph?.nodes ?? [])
        .map((n) => (n.screen || "").trim().toLowerCase())
        .filter(Boolean),
    );
    const candidates = generatedUiImages
      .filter((img) => {
        if (img.nodeId || img.screenName) return true;
        const label = inferScreenLabelFromImage(img)?.toLowerCase() ?? "";
        if (!label || label.includes("style guide")) return false;
        return [...flowNodeNames].some(
          (name) => label.includes(name) || name.includes(label),
        );
      })
      .map((img) => ({
        id: img.id,
        url: img.url,
        filename: img.filename,
        page_name: img.page_name,
        nodeId: img.nodeId,
        screenName: img.screenName || inferScreenLabelFromImage(img),
        isAnchor: img.isAnchor,
        index: img.index,
        total: img.total,
        created_at: img.created_at,
      }));

    return orderFlowGalleryImages(displayFlowGraph, candidates);
  }, [generatedUiImages, uiFlowGraph, displayFlowGraph]);

  const showPrototypeFlow =
    supportsPrototypeFlow(projectKind) &&
    !!displayFlowGraph &&
    (displayFlowGraph.nodes?.length ?? 0) >= 2 &&
    prototypeScreenCount >= 2 &&
    activeScreenHasPrototypeImages;

  // Keep uiFlowGraph in state when only images were persisted (reopen / partial save).
  useEffect(() => {
    if (!hydrated || !supportsPrototypeFlow(projectKind)) return;
    const fromImages = ensureFlowRelations(buildFlowGraphFromImages(generatedUiImages));
    if (!fromImages || (fromImages.nodes?.length ?? 0) < 2) return;
    setUiFlowGraph((prev) => {
      const merged = mergeFlowGraphs(prev, fromImages) ?? fromImages;
      if (flowGraphPersistenceKey(prev) === flowGraphPersistenceKey(merged)) return prev;
      setIsDirty(true);
      dirtyRef.current = true;
      return merged;
    });
  }, [hydrated, projectKind, generatedUiImages]);

  function handleFolderAdd(folderId: string, customName?: string, formatLabel?: string) {
    const folder = findNodeById(tree, folderId);
    if (!folder || folder.kind !== "folder") return;

    if (projectKind === "product design - packaging") {
      setCustomWidth("1200");
      setCustomHeight("1200");
      setCustomUnit("px");
      setPendingFolderId(folderId);
      setSizeModalOpen(true);
      return;
    }

    const frame = defaultFrameForFolder(folderId, folder.name);
    const screenCount = folder.children.filter((c) => c.kind === "screen").length + 1;

    let name = customName ?? `Screen ${screenCount}`;
    if (!customName) {
      if (projectKind === "website design" || projectKind === "landing page" || projectKind === "multi-page website") {
        name = frame === "mobile" ? `Mobile ${screenCount}` : `Desktop ${screenCount}`;
      } else if (projectKind === "practice") {
        name = `Practice ${screenCount}`;
      } else if ((projectKind as string) === "logo design") {
        name = `Artboard ${screenCount}`;
      }
    }

    const newId = crypto.randomUUID();
    const child: EditorTreeNode = {
      id: newId,
      kind: "screen",
      name,
      frame,
      formatLabel,
      sections: [{ id: crypto.randomUUID(), name: "First Section" }],
      expansionDirection: frame === "mobile" ? "horizontal" : "vertical",
    };

    setTree((prev) => addChildToFolder(prev, folderId, child));
    setActiveId(newId);
    setOpenFolders((p) => ({ ...p, [folderId]: true }));
    toast.success(`${name} added.`);
  }

  /** Focus campaign folder so main canvas shows the preset grid (same as header +). */
  function openCampaignPresetPicker(folderId: string) {
    setActiveId(folderId);
    setOpenFolders((p) => ({ ...p, [folderId]: true }));
    toast.info("Select a preset to add.");
  }

  function handleHeaderPlus(isFromChat: boolean | any = false): string {
    const isChat = isFromChat === true;

    if (!isChat && projectKind === "product design - packaging") {
      setCustomWidth("1200");
      setCustomHeight("1200");
      setCustomUnit("px");
      setPendingFolderId(null);
      setSizeModalOpen(true);
      return "";
    }

    if ((projectKind === "social media design" || projectKind === "logo design") && !isChat) {
      setPresetPickerOpen(true);
      setActiveId("");
      toast.info(
        projectKind === "logo design"
          ? "Select a logo preset to add an artboard."
          : "Select a preset to add a new screen.",
      );
      return "";
    }

    if (projectKind !== "campaign design") {
      const newId = crypto.randomUUID();
      const frame = projectKind === "product design - app" ? "mobile" : "desktop";
      const isSocial = projectKind === "social media design";
      const child: EditorTreeNode = {
        id: newId,
        kind: "screen",
        name: "Untitled",
        frame,
        width: isSocial ? 1080 : undefined,
        height: isSocial ? 1080 : undefined,
        sections: [{ id: crypto.randomUUID(), name: isSocial ? "Main Panel" : "First Section" }],
        expansionDirection: "vertical",
      };
      setTree((prev) => [...prev, child]);
      setActiveId(newId);
      setPresetPickerOpen(false);
      setRenamingId(newId);
      setRenameDraft("Untitled");
      toast.success(isSocial ? "Asset added." : "Screen added.");
      return newId;
    }

    if (projectKind === "campaign design") {
      const folder = tree.find((n) => n.kind === "folder");
      if (folder) openCampaignPresetPicker(folder.id);
      return "";
    }

    const folderId = activeNode?.kind === "folder" ? activeNode.id : null;
    if (folderId) { handleFolderAdd(folderId); return ""; }

    const firstFolder = tree.find((n) => n.kind === "folder");
    if (firstFolder) { handleFolderAdd(firstFolder.id); return ""; }
    toast.error("No folder to add to.");
    return "";
  }

  function handleCreateCustomArtboard() {
    const w = parseFloat(customWidth);
    const h = parseFloat(customHeight);
    if (isNaN(w) || w <= 0 || isNaN(h) || h <= 0) {
      toast.error("Please enter valid width and height values.");
      return;
    }

    const newId = crypto.randomUUID();
    const isSocial = projectKind === "social media design";
    const isLogo = projectKind === "logo design";
    const child: EditorTreeNode = {
      id: newId,
      kind: "screen",
      name: isLogo || isSocial ? "Untitled" : `Artboard ${tree.length + 1}`,
      frame: "desktop",
      width: w,
      height: h,
      unit: customUnit,
      formatLabel: isLogo ? `Custom — ${w}×${h} ${customUnit}` : undefined,
      sections: [
        {
          id: crypto.randomUUID(),
          name: isSocial ? "Main Panel" : isLogo ? "Logo" : "First Section",
        },
      ],
      expansionDirection: "vertical",
    };

    if (pendingFolderId) {
      setTree((prev) => addChildToFolder(prev, pendingFolderId, child));
      setOpenFolders((p) => ({ ...p, [pendingFolderId]: true }));
    } else {
      setTree((prev) => [...prev, child]);
    }

    setActiveId(newId);
    setPresetPickerOpen(false);
    setSizeModalOpen(false);
    if (isLogo || isSocial) {
      setRenamingId(newId);
      setRenameDraft("Untitled");
    }
    toast.success(`Custom artboard (${w}x${h} ${customUnit}) created.`);
  }

  function handleCreateSocialPreset(name: string, platform: string, width: number, height: number) {
    const newId = crypto.randomUUID();
    const child: EditorTreeNode = {
      id: newId,
      kind: "screen",
      name: "Untitled",
      frame: "desktop",
      formatLabel: `${platform} - ${name}`,
      width,
      height,
      sections: [{ id: crypto.randomUUID(), name: "Main Panel" }],
      expansionDirection: "vertical",
    };
    setTree((prev) => [...prev, child]);
    setActiveId(newId);
    setPresetPickerOpen(false);
    setRenamingId(newId);
    setRenameDraft("Untitled");
    toast.success(`Preset "${name}" loaded.`);
  }

  function handleCreateLogoPreset(name: string, platform: string, width: number, height: number) {
    const newId = crypto.randomUUID();
    const child: EditorTreeNode = {
      id: newId,
      kind: "screen",
      name: "Untitled",
      frame: "desktop",
      formatLabel: `${platform} — ${name}`,
      width,
      height,
      unit: "px",
      sections: [{ id: crypto.randomUUID(), name: "Logo" }],
      expansionDirection: "vertical",
    };
    setTree((prev) => [...prev, child]);
    setActiveId(newId);
    setPresetPickerOpen(false);
    setRenamingId(newId);
    setRenameDraft("Untitled");
    toast.success(`Preset "${name}" ready.`);
  }

  function openLogoCustomSizeModal() {
    setCustomWidth("800");
    setCustomHeight("800");
    setCustomUnit("px");
    setPendingFolderId(null);
    setSizeModalOpen(true);
  }

  async function collectDownloadImages(): Promise<GeneratedUiImage[]> {
    const imagesToDownload: GeneratedUiImage[] = [];
    const seen = new Set<string>();
    const push = (img: GeneratedUiImage | null) => {
      if (!img?.url) return;
      const key = img.id || img.url;
      if (seen.has(key)) return;
      seen.add(key);
      imagesToDownload.push(img);
    };
    if (activeNode?.kind === "screen") {
      const sections = activeNode.sections ?? [{ id: "base", name: "Base" }];
      sections.forEach((sec, idx) => {
        push(pickImageForSection(activeNode, sec, idx, generatedUiImages, tree));
      });
    }
    if (!imagesToDownload.length) {
      const candidates = generatedUiImages
        .filter((img) => !String(img.page_name || "").toLowerCase().includes("style guide"))
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      for (const img of candidates) push(img);
    }
    return imagesToDownload;
  }

  async function handleDownloadProject() {
    const imagesToDownload = await collectDownloadImages();
    if (!imagesToDownload.length) {
      toast.error("No design image to download yet.");
      return;
    }
    const projectLabel = sanitizePngFilename(projectMeta?.name || "design", "design").replace(
      /\.png$/i,
      "",
    );
    try {
      for (let i = 0; i < imagesToDownload.length; i++) {
        const img = imagesToDownload[i];
        const name =
          imagesToDownload.length > 1
            ? `${projectLabel}-${i + 1}.png`
            : sanitizePngFilename(img.filename || projectLabel, projectLabel);
        await downloadImageAsPng(img.url, name);
        if (imagesToDownload.length > 1 && i < imagesToDownload.length - 1) {
          await new Promise((r) => setTimeout(r, 350));
        }
      }
      toast.success(
        imagesToDownload.length > 1
          ? `Downloaded ${imagesToDownload.length} PNG files.`
          : "Downloaded PNG.",
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Download failed.");
    }
  }

  async function handleDownloadLogo(format: "png" | "ico" | "fav") {
    const imagesToDownload = await collectDownloadImages();
    if (!imagesToDownload.length) {
      toast.error("No logo to download yet.");
      return;
    }
    const img = imagesToDownload[0];
    const base = sanitizeDownloadBasename(
      activeNode?.kind === "screen" ? activeNode.name : projectMeta?.name || "logo",
      "logo",
    );
    try {
      if (format === "png") {
        await downloadImageAsPng(img.url, `${base}.png`);
        toast.success("Downloaded PNG.");
        return;
      }
      const favSize =
        activeNode?.kind === "screen" && activeNode.width && activeNode.width <= 64
          ? Math.min(activeNode.width, 48)
          : 32;
      await downloadImageAsFavicon(img.url, base, format, favSize);
      toast.success(format === "ico" ? "Downloaded ICO favicon." : "Downloaded .fav favicon.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Download failed.");
    }
  }

  function handleDeleteNode(id: string) {
    setTree((prev) => removeNodeById(prev, id));
    if (activeId === id) setActiveId("");
    toast.success("Item removed.");
  }

  function handleDuplicateNode(id: string) {
    setTree((prev) => duplicateNodeById(prev, id));
    toast.success("Item duplicated.");
  }

  function handleAddSection(screenId: string) {
    setTree((prev) => addSectionToScreen(prev, screenId, "New Section"));
    toast.success("Section expanded.");
  }

  const addSectionToScreenWithId = useCallback(
    (screenId: string): string => {
      const newSectionId = crypto.randomUUID();
      setTree((prev) =>
        mapTree(prev, (n) => {
          if (n.kind === "screen" && n.id === screenId) {
            const sections = n.sections ?? [];
            return {
              ...n,
              sections: [...sections, { id: newSectionId, name: `Canvas ${sections.length + 1}` }],
            };
          }
          return n;
        })
      );
      toast.success("New canvas added below.");
      return newSectionId;
    },
    []
  );


  const renderTree = (nodes: EditorTreeNode[], depth = 0) =>
    nodes.map((n) => {
      const pad = `pl-[${Math.min(2 + depth * 0.8, 4)}rem]`;
      if (n.kind === "folder") {
        const isOpen = openFolders[n.id] ?? true;
        return (
          <div key={n.id} className="group/item space-y-1">
            <div
              className={cn(
                "w-full flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors border",
                pad,
                activeId === n.id ? "bg-foreground/10 border-foreground/10" : "border-transparent hover:bg-foreground/5",
              )}
            >
              <button
                type="button"
                onClick={() => setOpenFolders((p) => ({ ...p, [n.id]: !isOpen }))}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/10"
              >
                {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => setActiveId(n.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left outline-none"
              >
                <Folder className="size-4 shrink-0 text-[#eca8d6]" />
                <span className="truncate font-medium">{n.name}</span>
              </button>
              <div className="flex items-center opacity-0 group-hover/item:opacity-100 transition-opacity">
                {projectKind !== "landing page" && projectKind !== "multi-page website" && projectKind !== "website design" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 rounded-lg"
                    onClick={() =>
                      projectKind === "campaign design"
                        ? openCampaignPresetPicker(n.id)
                        : handleFolderAdd(n.id)
                    }
                  >
                    <Plus className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
            {isOpen ? <div className="space-y-1">{renderTree(n.children, depth + 1)}</div> : null}
          </div>
        );
      }
      const active = n.id === activeId;
      const Icon =
        n.kind === "screen"
          ? (projectKind === "practice" ? FileText : (n.frame === "mobile" ? Smartphone : Monitor))
          : FileText;
      return (
        <div key={n.id} className="group/item flex items-center gap-1 px-2 pr-1">
          <button
            type="button"
            onClick={() => setActiveId(n.id)}
            onDoubleClick={() => {
              setRenamingId(n.id);
              setRenameDraft(n.name);
            }}
            className={cn(
              "flex-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
              active ? "bg-foreground/7 border border-foreground/10" : "hover:bg-foreground/5 border border-transparent",
              pad,
            )}
          >
            <span className="inline-block w-3.5 shrink-0" />
            <Icon className={cn("size-3.5 shrink-0", active ? "text-[#eca8d6]" : "text-muted-foreground")} />
            {renamingId === n.id ? (
              <input
                value={renameDraft}
                autoFocus
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => {
                  const name = renameDraft.trim() || "Untitled";
                  setTree((prev) => renameNodeById(prev, n.id, name));
                  setRenamingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const name = renameDraft.trim() || "Untitled";
                    setTree((prev) => renameNodeById(prev, n.id, name));
                    setRenamingId(null);
                  }
                  if (e.key === "Escape") {
                    setRenamingId(null);
                  }
                }}
                className="h-6 flex-1 rounded bg-background/60 border border-foreground/20 px-2 text-xs outline-none"
              />
            ) : (
              <span className="truncate">{n.name}</span>
            )}
          </button>
          <div className="opacity-0 group-hover/item:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-7 rounded-lg">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem
                  onClick={() => {
                    setRenamingId(n.id);
                    setRenameDraft(n.name);
                  }}
                >
                  <Type className="mr-2 size-3.5" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDuplicateNode(n.id)}>
                  <Plus className="mr-2 size-3.5" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteNode(n.id)}>
                  <Trash2 className="mr-2 size-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      );
    });

  const canvasRef = useRef<HTMLDivElement>(null);

  function handleCanvasClick(e: React.MouseEvent) {
    if (projectKind !== "practice") return;
    if (e.target !== e.currentTarget) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - 5000) / zoomScale;
    const y = (e.clientY - rect.top - 5000) / zoomScale;

    const newNode: EditorTreeNode = {
      id: crypto.randomUUID(),
      kind: "screen",
      name: "Note " + (tree.length + 1),
      frame: "desktop",
      position: { x, y },
      sections: [{ id: crypto.randomUUID(), name: "Drafting Note" }]
    };

    setTree(prev => [...prev, newNode]);
    setActiveId(newNode.id);
  }

  function renderPracticeCanvas() {
    const hasGenerated = generatedUiImages.length > 0;
    const sortedImages = generatedUiImages
      .slice()
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    return (
      <div
        className="relative w-[10000px] h-[10000px] bg-background"
        style={{
          backgroundImage: `
            radial-gradient(circle at 2px 2px, ${canvasTheme === 'dark' ? '#222' : '#f0f0f0'} 2px, transparent 0),
            radial-gradient(circle at 50% 50%, ${canvasTheme === 'dark' ? '#111' : '#fafafa'} 100%, transparent 0)
          `,
          backgroundSize: '48px 48px, 100% 100%'
        }}
      >
        {/* Origin Crosshair */}
        <div className="absolute left-[5000px] top-[5000px] pointer-events-none opacity-20">
          <div className="absolute h-px w-40 -translate-x-1/2 bg-foreground/30" />
          <div className="absolute w-px h-40 -translate-y-1/2 bg-foreground/30" />
          <div className="absolute top-4 left-4 text-[0.5rem] font-black uppercase tracking-widest text-foreground/40">Blueprint Origin (0:0)</div>
        </div>

        <div className="absolute left-[5000px] top-[5000px] -translate-x-1/2 -translate-y-1/2 text-center space-y-4 pointer-events-none">
          <div className="font-display text-4xl tracking-tighter text-foreground/10">
            {hasGenerated ? "Practice Canvas" : "Infinite Sandbox"}
          </div>
          <p className="text-zinc-500 text-[0.5rem] tracking-[0.4em] uppercase font-black opacity-20">
            {hasGenerated ? "AI Design Preview Active" : "Drafting Environment Active"}
          </p>
        </div>

        {hasGenerated ? (
          <div className="absolute left-16 top-16 w-[min(1200px,calc(100vw-8rem))] z-10">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
              {sortedImages.map((img) => (
                <div key={img.id} className="self-start rounded-2xl border border-foreground/15 bg-white/95 dark:bg-zinc-900/95 shadow-xl overflow-hidden">
                  <div className="w-full bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.filename || "Generated practice UI"}
                      className="w-full h-auto object-contain"
                      onError={() => setBrokenImageKeys((prev) => ({ ...prev, [img.id || img.url]: true }))}
                    />
                    {brokenImageKeys[img.id || img.url] ? (
                      <div className="px-3 py-2 text-[0.68rem] text-amber-600 font-mono">
                        Saved in DB, but this asset URL is currently unavailable.
                      </div>
                    ) : null}
                  </div>
                  <div className="px-3 py-2 text-[0.68rem] text-muted-foreground/80 font-mono">
                    {img.page_name ? `${img.page_name} · ` : ""}
                    {img.created_at ? new Date(img.created_at).toLocaleTimeString() : img.filename}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderCampaignGallery(folderId: string) {
    const presets = Object.entries(RESOLUTIONS.CAMPAIGN);
    return (
      <div className="space-y-8 p-10">
        <h2 className="font-display text-2xl tracking-tight">Select Format</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {presets.map(([label, res]) => (
            <button key={label} onClick={() => handleFolderAdd(folderId, label, label)} className="group flex flex-col text-left outline-none">
              <div className="relative aspect-[4/3] rounded-2xl border border-foreground/10 bg-white/95 shadow-sm transition-all group-hover:-translate-y-1 flex items-center justify-center p-6 overflow-hidden">
                <div className="rounded shadow-lg bg-zinc-200 border border-zinc-300" style={{ aspectRatio: res.w / res.h, width: res.h > res.w ? "40%" : "70%" }} />
              </div>
              <div className="mt-3">
                <div className="text-[0.8125rem] font-medium group-hover:text-[#eca8d6]">{label}</div>
                <div className="text-[0.65rem] font-mono text-muted-foreground mt-1 uppercase">{res.w} × {res.h} px</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderFolderGallery(nodes: EditorTreeNode[]) {
    const screens = nodes.filter((n): n is Extract<EditorTreeNode, { kind: "screen" }> => n.kind === "screen");
    return (
      <div className="p-10">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h2 className="font-display text-3xl tracking-tight mb-2">Library Overview</h2>
            <p className="text-[0.65rem] font-mono text-muted-foreground uppercase tracking-widest opacity-40">
              {screens.length} Artboard{screens.length === 1 ? "" : "s"} found in this group
            </p>
          </div>
          <Button size="sm" className="rounded-full bg-[#eca8d6] text-background hover:bg-[#eca8d6]/90 font-bold" onClick={handleHeaderPlus}>
            <Plus className="size-4 mr-2" /> New Artboard
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {screens.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className="group flex flex-col items-start gap-4 text-left transition-all hover:scale-[1.02]"
            >
              <div className="relative w-full aspect-[4/3] rounded-3xl border border-foreground/10 bg-white/5 backdrop-blur-md overflow-hidden flex items-center justify-center p-8 group-hover:border-[#eca8d6]/40 group-hover:bg-[#eca8d6]/5">
                {(() => {
                  let thumbAspectRatio = s.frame === "mobile" ? 375 / 812 : 16 / 9;
                  if (s.width && s.height) {
                    thumbAspectRatio = s.width / s.height;
                  } else {
                    if (projectKind === "logo design") { thumbAspectRatio = 1; }
                    if (projectKind === "ui/ux design" || projectKind === "product design" || projectKind === "product design - desktop") { thumbAspectRatio = 16 / 9; }
                    if (projectKind === "product design - app") { thumbAspectRatio = 375 / 812; }
                    if (projectKind === "product design - packaging") { thumbAspectRatio = 1; }
                    if ((projectKind === "campaign design" || projectKind === "social media design") && s.formatLabel) {
                      const res = (RESOLUTIONS.CAMPAIGN as any)[s.formatLabel];
                      if (res) { thumbAspectRatio = res.w / res.h; }
                    } else if (projectKind === "social media design") {
                      thumbAspectRatio = 1;
                    }
                  }
                  return (
                    <div
                      className="rounded-lg shadow-2xl bg-white dark:bg-zinc-200 border border-foreground/5 pointer-events-none overflow-hidden flex flex-col gap-[2px] p-[2px]"
                      style={{ width: thumbAspectRatio < 1 ? "35%" : "85%", aspectRatio: thumbAspectRatio }}
                    >
                      {(s.sections ?? [{ id: '1' }]).map((_, i) => (
                        <div key={i} className="flex-1 bg-zinc-100 dark:bg-zinc-300 rounded-[2px] relative">
                          <div className="absolute inset-0 flex items-center justify-center opacity-10">
                            <Layout className="size-4" />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                  <span className="text-[0.6rem] font-bold text-white uppercase tracking-wider">Open Editor</span>
                </div>
              </div>
              <div className="w-full">
                <div className="flex items-center justify-between">
                  <div className="text-[0.85rem] font-bold truncate group-hover:text-[#eca8d6] transition-colors">{s.name}</div>
                  <div className="text-[0.55rem] font-mono text-muted-foreground/30">#{idx + 1}</div>
                </div>
                <div className="text-[0.6rem] font-mono text-muted-foreground/40 uppercase mt-1 tracking-tighter">
                  {s.width && s.height ? `${s.width} × ${s.height} ${s.unit || 'px'}` : (s.frame === "mobile" ? "Mobile Viewport" : "Desktop Viewport")}
                </div>
              </div>
            </button>
          ))}
          <button
            onClick={handleHeaderPlus}
            className="flex flex-col items-center justify-center gap-4 aspect-[4/3] rounded-3xl border-2 border-dashed border-foreground/5 hover:border-[#eca8d6]/20 hover:bg-[#eca8d6]/5 transition-all text-muted-foreground/30 hover:text-[#eca8d6]/60"
          >
            <Plus className="size-8" />
            <span className="text-[0.7rem] font-bold uppercase tracking-widest">Create</span>
          </button>
        </div>
      </div>
    );
  }

  const [canvasTheme, setCanvasTheme] = useState<"light" | "dark">("light");

  function renderEmptyWorkspace() {
    if (presetPickerOpen && projectKind === "social media design") {
      return (
        <div className="flex flex-col items-center justify-center min-h-full p-8 md:p-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
          <div className="text-center space-y-2">
            <h3 className="font-display text-3xl font-bold tracking-tight text-white">
              Social Media Presets
            </h3>
            <p className="text-[0.8rem] text-zinc-400 max-w-xl mx-auto">
              Select any high-fidelity preset canvas to instantly bootstrap your custom asset in the project screens layout.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 w-full">
            {SOCIAL_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleCreateSocialPreset(preset.name, preset.platform, preset.w, preset.h)}
                className="group relative flex flex-col items-start justify-between p-5 rounded-2xl border border-white/5 bg-zinc-950/40 text-left hover:bg-zinc-900/60 hover:border-[#eca8d6]/30 hover:scale-[1.03] active:scale-[0.98] transition-all duration-300 shadow-lg shadow-black/25 overflow-hidden"
              >
                {/* Decorative Hover Gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#eca8d6]/0 via-[#eca8d6]/0 to-[#eca8d6]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                
                <div className="space-y-4 z-10 w-full">
                  <span className="inline-flex items-center rounded-full bg-white/5 group-hover:bg-[#eca8d6]/10 px-2 py-0.5 text-[0.65rem] font-medium text-zinc-400 group-hover:text-[#eca8d6] transition-colors">
                    {preset.platform}
                  </span>
                  
                  <div className="space-y-1">
                    <h4 className="font-semibold text-[0.85rem] leading-tight text-white group-hover:text-[#eca8d6] transition-colors line-clamp-2">
                      {preset.name}
                    </h4>
                    <p className="text-[0.7rem] text-zinc-500 font-mono">
                      {preset.size}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between w-full z-10 text-[0.7rem] font-semibold text-zinc-400 group-hover:text-white transition-colors">
                  <span>Create Canvas</span>
                  <Plus className="size-3.5 group-hover:rotate-90 transition-transform duration-300" />
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (presetPickerOpen && projectKind === "logo design") {
      return (
        <div className="flex flex-col items-center justify-center min-h-full p-8 md:p-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
          <div className="text-center space-y-2">
            <h3 className="font-display text-3xl font-bold tracking-tight">Logo & Brand Presets</h3>
            <p className="text-[0.8rem] text-muted-foreground max-w-xl mx-auto">
              Pick a canvas for Instagram, Facebook, favicon sizes (32–500px), app icons, and more — or set a custom size.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 w-full">
            {LOGO_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleCreateLogoPreset(preset.name, preset.platform, preset.w, preset.h)}
                className="group relative flex flex-col items-start justify-between p-5 rounded-2xl border border-foreground/10 bg-foreground/[0.02] text-left hover:bg-[#eca8d6]/5 hover:border-[#eca8d6]/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 shadow-sm overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-[#eca8d6]/0 to-[#eca8d6]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="space-y-4 z-10 w-full">
                  <span className="inline-flex items-center rounded-full bg-foreground/5 group-hover:bg-[#eca8d6]/10 px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground group-hover:text-[#eca8d6] transition-colors">
                    {preset.platform}
                  </span>
                  <div className="space-y-1">
                    <h4 className="font-semibold text-[0.85rem] leading-tight group-hover:text-[#eca8d6] transition-colors line-clamp-2">
                      {preset.name}
                    </h4>
                    <p className="text-[0.7rem] text-muted-foreground font-mono">{preset.size}</p>
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between w-full z-10 text-[0.7rem] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
                  <span>Create artboard</span>
                  <Plus className="size-3.5 group-hover:rotate-90 transition-transform duration-300" />
                </div>
              </button>
            ))}
            <button
              type="button"
              onClick={openLogoCustomSizeModal}
              className="flex flex-col items-start justify-between p-5 rounded-2xl border-2 border-dashed border-foreground/15 hover:border-[#eca8d6]/30 hover:bg-[#eca8d6]/5 transition-all text-muted-foreground hover:text-[#eca8d6] min-h-[140px]"
            >
              <span className="text-[0.65rem] font-bold uppercase tracking-widest">Custom</span>
              <div className="mt-auto space-y-1">
                <p className="font-semibold text-[0.85rem]">Custom size</p>
                <p className="text-[0.7rem] font-mono opacity-70">Any width × height</p>
              </div>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
        <div className="size-24 rounded-full border border-foreground/5 bg-foreground/[0.02] flex items-center justify-center">
          <Layout className="size-8 text-muted-foreground/20" />
        </div>
        <div className="space-y-2">
          <h3 className="font-display text-3xl tracking-tight">Empty Workspace</h3>
          <p className="text-sm text-muted-foreground max-w-sm">No screens are currently open on your canvas. Start fresh by dropping your first artboard.</p>
        </div>
        <Button className="rounded-full bg-foreground text-background px-8 h-11 hover:scale-105 transition-transform" onClick={handleHeaderPlus}>
          <Plus className="size-4 mr-2" /> Start Designing
        </Button>
      </div>
    );
  }

  function renderWorkspaceBody() {
    if (projectKind === "practice") {
      if (!activeNode || activeNode.kind !== "screen") return renderEmptyWorkspace();
      return renderPracticeCanvas();
    }
    if (!activeNode) return renderEmptyWorkspace();

    if (activeNode.kind === "folder") {
      if (projectKind === "campaign design") return renderCampaignGallery(activeNode.id);
      const hasScreens = activeNode.children.some((n) => n.kind === "screen");
      if (!hasScreens) return renderEmptyWorkspace();
      return renderFolderGallery(activeNode.children);
    }

    if (activeNode.kind === "screen") {
      const screen = activeNode;
      const sections = screen.sections ?? [{ id: "base", name: "Base" }];
      const isWeb = projectKind === "website design" || projectKind === "landing page" || projectKind === "multi-page website";
      const isMobileHorizontal = isWeb && screen.frame === "mobile";

      let aspectRatio = 16 / 9;
      let width = screen.frame === "mobile" ? 375 : 1440;
      if (screen.width && screen.height) {
        aspectRatio = screen.width / screen.height;
        width = convertToPx(screen.width, screen.unit);
      } else {
        if (projectKind === "logo design") { aspectRatio = 1; width = 800; }
        if (projectKind === "ui/ux design" || projectKind === "product design" || projectKind === "product design - desktop") { aspectRatio = 16 / 9; width = 1920; }
        if (projectKind === "product design - app") { aspectRatio = 375 / 812; width = 375; }
        if (projectKind === "product design - packaging") { aspectRatio = 1; width = 1200; }
        if ((projectKind === "campaign design" || projectKind === "social media design") && screen.formatLabel) {
          const res = (RESOLUTIONS.CAMPAIGN as any)[screen.formatLabel];
          if (res) { aspectRatio = res.w / res.h; width = res.w; }
        } else if (projectKind === "social media design") {
          aspectRatio = 1;
          width = 1080;
        }
      }
      if (projectKind === "landing page") {
        aspectRatio = RESOLUTIONS.LANDING_PAGE.w / RESOLUTIONS.LANDING_PAGE.h;
        width = RESOLUTIONS.LANDING_PAGE.w;
      } else if (isWeb) {
        aspectRatio = screen.frame === "mobile" ? RESOLUTIONS.WEBSITE.MOBILE.w / RESOLUTIONS.WEBSITE.MOBILE.h : RESOLUTIONS.WEBSITE.DESKTOP.w / RESOLUTIONS.WEBSITE.DESKTOP.h;
      }

      return (
        <div className={cn(
          "relative min-h-full flex flex-col",
          isMobileHorizontal ? "items-start" : "items-center"
        )}>
          {showPrototypeFlow && displayFlowGraph ? (
            <div className="w-full max-w-6xl shrink-0 mb-10 px-2">
              <UiPrototypeFlowPanel
                flowGraph={displayFlowGraph}
                images={flowGalleryImages}
              />
            </div>
          ) : null}
          {screen.formatLabel && (
            <div className="w-full flex justify-start mb-6 px-1 shrink-0">
              <span className="text-[0.6rem] bg-[#eca8d6]/10 text-[#eca8d6] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">{screen.formatLabel}</span>
            </div>
          )}

          {/* Blueprint Pixel Grid for UI/UX */}
          {(projectKind === "ui/ux design" || projectKind?.startsWith("product design")) && (
            <div className="absolute inset-0 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:24px_24px] opacity-[0.03] pointer-events-none" />
          )}

          <div
            className={cn(
              "flex transition-all duration-300 origin-top-left sm:origin-top",
              isMobileHorizontal ? "flex-row gap-12 pr-[400px]" : "flex-col gap-16"
            )}
            style={{
              transform: `scale(${zoomScale})`,
              paddingBottom: 400
            }}
          >
            {sections.map((sec, idx) => {
              const selectedImage = pickImageForSection(screen, sec, idx, generatedUiImages, tree);
              return (
                <div key={sec.id} className="relative group/sec shrink-0">
                  <div className="rounded-3xl border-4 border-foreground/10 bg-white dark:bg-zinc-100/95 shadow-2xl overflow-hidden relative" style={{ aspectRatio, width }}>
                    {selectedImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedImage.url}
                        alt={selectedImage.filename || "Generated UI"}
                        className="absolute inset-0 h-full w-full object-contain bg-white"
                        onError={() => setBrokenImageKeys((prev) => ({ ...prev, [selectedImage.id || selectedImage.url]: true }))}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center opacity-[0.03]"><Layout className="size-64" /></div>
                    )}
                    {selectedImage && brokenImageKeys[selectedImage.id || selectedImage.url] ? (
                      <div className="absolute inset-x-6 bottom-6 rounded-lg bg-amber-50/95 border border-amber-200 px-3 py-2 text-[0.68rem] text-amber-700 font-mono">
                        Design metadata is saved in DB, but image URL is unreachable right now.
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                  <div className="mt-4 flex justify-between px-2">
                    <div className="text-xs font-mono text-muted-foreground/60 uppercase tracking-tighter">{sec.name}</div>
                    {projectKind !== "campaign design" && projectKind !== "logo design" && <div className="text-xs font-mono text-muted-foreground/40">S.{idx + 1}</div>}
                  </div>
                  {idx === sections.length - 1 && projectKind !== "campaign design" && projectKind !== "logo design" && (
                    <button onClick={() => handleAddSection(screen.id)} className={cn("absolute flex items-center justify-center bg-foreground/5 rounded-2xl border-2 border-dashed border-foreground/15 hover:border-[#eca8d6]/40 hover:bg-[#eca8d6]/5 transition-all", isMobileHorizontal ? "top-0 -right-24 w-16 h-full" : "left-1/2 -bottom-24 w-full h-16 -translate-x-1/2")}><Plus className="size-8" /></button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  }

  if (!hydrated) return null;

  return (
    <div className="h-[100dvh] flex flex-col bg-background overflow-hidden selection:bg-[#eca8d6]/30">
      {/* Global CSS for scrollbars */}
      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        
        .thin-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .thin-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .thin-scrollbar::-webkit-scrollbar-thumb { 
          background: rgba(236, 168, 214, 0.2); 
          border-radius: 20px;
        }
        .thin-scrollbar::-webkit-scrollbar-thumb:hover { 
          background: rgba(236, 168, 214, 0.4); 
        }
      `}</style>

      {/* Header */}
      <div className="shrink-0 z-50 border-b border-foreground/5 bg-background/60 backdrop-blur-2xl h-12 flex items-center justify-between px-4">
        <div className="flex items-center gap-2 min-w-0">
          {isOwner ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-[#eca8d6]"
              onClick={() => handleSafeNavigate("/projects")}
              title="Back to projects"
              aria-label="Back to projects"
            >
              <ArrowLeft className="size-4" />
            </Button>
          ) : (
            <span
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#eca8d6]/10 text-[#eca8d6]"
              title="Shared editor access"
            >
              <Share className="size-3.5" />
            </span>
          )}
          {isSharedEditor ? (
            <span className="hidden sm:inline text-[0.58rem] font-bold uppercase tracking-[0.18em] text-[#eca8d6]/90">
              Shared edit
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              title={isSidebarCollapsed ? "Show screens" : "Hide screens"}
              aria-label={isSidebarCollapsed ? "Show screens" : "Hide screens"}
            >
              <LayoutGrid className="size-4 text-[#eca8d6]" />
          </Button>
          <div className="h-4 w-px bg-foreground/10 mx-1 hidden sm:block" />
          <Menubar className="h-8 border-transparent bg-transparent shadow-none p-0 cursor-default hidden sm:flex">
            <MenubarMenu><MenubarTrigger className="text-[0.7rem] uppercase font-bold tracking-tighter">File</MenubarTrigger></MenubarMenu>
          </Menubar>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center max-w-[min(50vw,280px)] px-4 py-1.5 rounded-2xl bg-foreground/[0.03] border border-foreground/5">
          <span className="text-[0.7rem] font-black uppercase truncate">{projectMeta?.name ?? "Untitled"}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-4 mr-2">
            {isDirty && (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 rounded-full px-4 text-[0.65rem] font-black uppercase tracking-[0.22em]",
                  "border-transparent bg-white text-black hover:bg-white/90",
                  "shadow-sm shadow-black/10"
                )}
                onClick={handleSaveProject}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save"}
              </Button>
            )}
            {projectKind === "logo design" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-8 rounded-full px-4 text-[0.65rem] font-black uppercase tracking-[0.22em]",
                      "border-foreground/15 bg-background text-foreground hover:bg-foreground/5"
                    )}
                  >
                    Download <ChevronDown className="ml-2 size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    className="text-[0.75rem] font-medium cursor-pointer"
                    onClick={() => void handleDownloadLogo("png")}
                  >
                    PNG (full artboard)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-[0.75rem] font-medium cursor-pointer"
                    onClick={() => void handleDownloadLogo("ico")}
                  >
                    Favicon (.ico)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-[0.75rem] font-medium cursor-pointer"
                    onClick={() => void handleDownloadLogo("fav")}
                  >
                    Favicon (.fav)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 rounded-full px-4 text-[0.65rem] font-black uppercase tracking-[0.22em]",
                  "border-foreground/15 bg-background text-foreground hover:bg-foreground/5"
                )}
                onClick={() => void handleDownloadProject()}
              >
                Download <Download className="ml-2 size-3.5" />
              </Button>
            )}
            {isOwner || projectRole === "editor" ? (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 rounded-full px-4 text-[0.65rem] font-black uppercase tracking-[0.22em]",
                  "border-[#eca8d6]/30 bg-[#eca8d6] text-background hover:bg-[#eca8d6]/90",
                  "shadow-sm shadow-[#eca8d6]/20"
                )}
                onClick={() => setShareOpen(true)}
              >
                Share <Share className="ml-2 size-3.5" />
              </Button>
            ) : null}
          </div>
          <Avatar className="size-9 shrink-0 border border-foreground/10 bg-foreground/[0.03] shadow-sm shadow-black/10">
            <AvatarFallback className="bg-[#eca8d6] text-background text-xs font-mono font-bold">
              {me ? initials(me.first_name, me.last_name, me.email) : "U"}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {!isSidebarCollapsed && (
            <>
              <ResizablePanel
                defaultSize={showDesignerChat ? 16 : 18}
                minSize={12}
                maxSize={30}
                className="border-r border-foreground/5"
              >
                <aside className="h-full flex flex-col no-scrollbar overflow-y-auto">
                  <div className="flex justify-between px-5 pt-6 pb-4 shrink-0">
                    <div className="text-[0.6rem] font-black uppercase tracking-[0.2em] text-muted-foreground/40">{filesLabel}</div>
                    <Button size="icon" variant="ghost" className="size-6" onClick={handleHeaderPlus}><Plus className="size-3.5" /></Button>
                  </div>
                  <div className="flex-1 px-3 pb-8 space-y-1">{renderTree(tree)}</div>
                </aside>
              </ResizablePanel>
              <ResizableHandle className="bg-foreground/5 w-[1px] hover:bg-[#eca8d6]/30 transition-all" />
            </>
          )}

          <ResizablePanel defaultSize={showDesignerChat ? 56 : 100} minSize={40}>
            <section className="h-full flex flex-col bg-foreground/[0.01] overflow-hidden">
              <div
                ref={workspaceRef}
                onWheel={handleWorkspaceWheel}
                className={cn(
                  "flex-1 relative thin-scrollbar",
                  !showDesignerChat
                    ? "overflow-hidden"
                    : cn(
                        "p-24 bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.02)_100%)]",
                        (activeNode?.kind === "screen" && activeNode.frame === "mobile") || projectKind === "practice"
                          ? "overflow-x-auto overflow-y-auto"
                          : "overflow-x-hidden overflow-y-auto",
                        projectKind === "practice" && "p-0",
                      )
                )}
              >
                {renderWorkspaceBody()}
              </div>
            </section>
          </ResizablePanel>

          {showDesignerChat ? (
            <>
              <ResizableHandle className="bg-foreground/5 w-[1px] hover:bg-[#eca8d6]/30 transition-all" />
              <ResizablePanel defaultSize={28} minSize={20} className="border-l border-foreground/5">
                <aside className="flex flex-col h-full bg-background no-scrollbar overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
                    <div className="text-sm font-medium">Designer</div>
                    <div className="flex items-center gap-3 text-muted-foreground/60">
                      {projectKind !== "multi-page website" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.08] transition-all text-[0.65rem] font-bold uppercase tracking-widest text-zinc-500 outline-none group/btn">
                              Designer <ChevronDown className="size-3 ml-0.5 opacity-40 group-hover/btn:opacity-100 transition-opacity" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40 bg-black border border-white/10 text-white p-1 rounded-lg">
                            <DropdownMenuItem className="rounded-md px-3 py-2 hover:bg-white/10 cursor-pointer outline-none transition-colors text-[0.7rem] font-medium">Designer</DropdownMenuItem>
                            <DropdownMenuItem className="rounded-md px-3 py-2 hover:bg-white/10 cursor-pointer outline-none transition-colors text-[0.7rem] font-medium">Gemini</DropdownMenuItem>
                            <DropdownMenuItem className="rounded-md px-3 py-2 hover:bg-white/10 cursor-pointer outline-none transition-colors text-[0.7rem] font-medium">GPT-4</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      <Clock className="size-4 cursor-pointer hover:text-white transition-colors ml-1" />
                    </div>
                  </div>
                  <UIDesignerEditorChatPanel
                    projectId={projectId}
                    projectKind={projectKind}
                    projectGeneratedImages={generatedUiImages}
                    onImagesChange={syncImagesFromChat}
                    onFlowGraphChange={applyFlowGraph}
                    onEnsurePrototypeSection={ensurePrototypeSection}
                    activeScreenId={activeId}
                    onCreateDefaultScreen={() => handleHeaderPlus(true)}
                    onAddSectionToScreen={addSectionToScreenWithId}
                    activeScreen={activeNode?.kind === "screen" ? activeNode : undefined}
                  />
                </aside>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </div>

      {/* Strict Exit Decision Modal */}
      {showExitModal && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-6 sm:p-0">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xl animate-in fade-in duration-500" onClick={() => setShowExitModal(false)} />
          <div className="relative w-full max-w-[480px] bg-white text-black rounded-[40px] shadow-[0_32px_128px_-32px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-10 duration-500">
            <div className="p-10 text-center space-y-6">
              <div className="mx-auto size-16 rounded-full bg-zinc-100 flex items-center justify-center mb-6">
                <Clock className="size-8 text-black opacity-40" />
              </div>
              <div className="space-y-2">
                <h3 className="font-display text-4xl tracking-tighter">Unsaved Mastery</h3>
                <p className="text-zinc-500 text-sm leading-relaxed max-w-[280px] mx-auto">You have unsaved changes in your project. How would you like to proceed?</p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <Button
                  onClick={handleSaveAndExit}
                  className="h-14 rounded-full bg-black text-white hover:bg-zinc-800 font-black uppercase tracking-[0.2em] text-[0.7rem] transition-all border-none"
                >
                  SAVE & EXIT PROJECT
                </Button>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    onClick={handleDiscardAndExit}
                    className="h-14 rounded-full border-2 border-black/10 bg-white text-black hover:bg-zinc-50 font-black uppercase tracking-[0.2em] text-[0.6rem] transition-all"
                  >
                    DISCARD
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowExitModal(false)}
                    className="h-14 rounded-full font-black uppercase tracking-[0.2em] text-[0.6rem] transition-all text-zinc-400 hover:text-black hover:bg-zinc-50"
                  >
                    CANCEL
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {projectMeta ? (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          projectId={projectMeta.id}
          projectName={projectMeta.name}
          canManage={isOwner}
        />
      ) : null}

      <Dialog open={sizeModalOpen} onOpenChange={setSizeModalOpen}>
        <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden border-white/10 bg-black/80 backdrop-blur-2xl rounded-3xl text-white">
          <div className="p-6">
            <DialogHeader className="space-y-2">
              <DialogTitle className="font-display text-xl tracking-tight text-white flex items-center gap-2">
                <span className="size-6 rounded-full bg-[#eca8d6]/10 flex items-center justify-center text-[#eca8d6]">
                  <Plus className="size-4" />
                </span>
                Artboard Dimensions
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                Specify the size for your new layout. Artboard auto-scales to fit your workspace.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-4">
              {/* Unit Selector */}
              <div className="space-y-2">
                <label className="text-[0.7rem] font-bold text-zinc-400 uppercase tracking-wider">Unit</label>
                <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-zinc-900/50 border border-white/5">
                  {(["px", "inch", "cm", "m"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setCustomUnit(u)}
                      className={cn(
                        "py-1.5 text-xs font-bold uppercase rounded-lg transition-all",
                        customUnit === u
                          ? "bg-[#eca8d6] text-black shadow-sm"
                          : "text-zinc-400 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {u === "inch" ? "in" : u}
                    </button>
                  ))}
                </div>
              </div>

              {/* Width & Height Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[0.7rem] font-bold text-zinc-400 uppercase tracking-wider">Width</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0.1"
                      placeholder="Width"
                      value={customWidth}
                      onChange={(e) => setCustomWidth(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-white/10 bg-zinc-950/50 text-white placeholder-zinc-600 focus:outline-none focus:border-[#eca8d6]/50 focus:ring-1 focus:ring-[#eca8d6]/50 text-sm font-mono"
                    />
                    <span className="absolute right-3 top-2.5 text-[0.65rem] font-bold text-zinc-500 uppercase">
                      {customUnit === "inch" ? "in" : customUnit}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[0.7rem] font-bold text-zinc-400 uppercase tracking-wider">Height</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0.1"
                      placeholder="Height"
                      value={customHeight}
                      onChange={(e) => setCustomHeight(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-white/10 bg-zinc-950/50 text-white placeholder-zinc-600 focus:outline-none focus:border-[#eca8d6]/50 focus:ring-1 focus:ring-[#eca8d6]/50 text-sm font-mono"
                    />
                    <span className="absolute right-3 top-2.5 text-[0.65rem] font-bold text-zinc-500 uppercase">
                      {customUnit === "inch" ? "in" : customUnit}
                    </span>
                  </div>
                </div>
              </div>

              {/* Dynamic calculation preview */}
              {customWidth && customHeight && !isNaN(parseFloat(customWidth)) && !isNaN(parseFloat(customHeight)) && (
                <div className="rounded-xl bg-white/[0.02] border border-white/5 px-3 py-2 flex items-center justify-between text-[0.65rem] text-zinc-500 font-mono">
                  <span>Pixel Equivalence:</span>
                  <span className="text-zinc-300">
                    {Math.round(convertToPx(parseFloat(customWidth), customUnit))} × {Math.round(convertToPx(parseFloat(customHeight), customUnit))} px
                  </span>
                </div>
              )}
            </div>

            <div className="mt-8 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setSizeModalOpen(false)}
                className="h-10 rounded-full border border-white/10 bg-transparent text-white hover:bg-white/5 hover:text-white flex-1 text-xs font-bold uppercase tracking-wider"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateCustomArtboard}
                disabled={!customWidth || !customHeight || isNaN(parseFloat(customWidth)) || isNaN(parseFloat(customHeight))}
                className="h-10 rounded-full bg-[#eca8d6] text-black hover:bg-[#eca8d6]/90 flex-1 text-xs font-bold uppercase tracking-wider shadow-sm shadow-[#eca8d6]/20"
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
