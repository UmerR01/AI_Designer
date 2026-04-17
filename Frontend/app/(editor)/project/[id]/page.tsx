"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
} from "lucide-react";
import { toast } from "sonner";

import { readDesignerProjects, type DesignerProject, type ProjectKind } from "@/lib/designer-projects";
import { getJson, getMeCached, putJson } from "@/lib/auth-api";
import {
  addChildToFolder,
  defaultFrameForFolder,
  EDITOR_FOLDER_PRACTICE_ROOT,
  EDITOR_FOLDER_UX_SCREENS,
  findNodeById,
  getEditorBootstrap,
  isDefaultUiUxBootstrapTree,
  type EditorTreeNode,
  resolveProjectKind,
  setScreenFormatLabel,
  sidebarFilesLabel,
  RESOLUTIONS,
  removeNodeById,
  addSectionToScreen,
  renameNodeById,
} from "@/lib/editor-project";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UIDesignerEditorChatPanel } from "@/components/editor/ui-designer/UIDesignerEditorChatPanel";
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
};

type PersistedEditorData = {
  tree: EditorTreeNode[];
  activeId: string;
  openFolders: Record<string, boolean>;
  generatedUiImages?: GeneratedUiImage[];
};

function initials(first: string | undefined, last: string | undefined, email: string | undefined) {
  const a = (first?.trim()?.[0] ?? "").toUpperCase();
  const b = (last?.trim()?.[0] ?? "").toUpperCase();
  if (a || b) return `${a}${b}`.trim();
  return (email?.trim()?.[0] ?? "U").toUpperCase();
}

function normalizePersistedEditorData(raw: unknown): PersistedEditorData | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.tree)) return null;
  if (typeof obj.activeId !== "string") return null;
  if (!obj.openFolders || typeof obj.openFolders !== "object") return null;

  const generated = Array.isArray(obj.generatedUiImages)
    ? (obj.generatedUiImages.filter((x) => x && typeof x === "object") as GeneratedUiImage[])
    : [];

  return {
    tree: obj.tree as EditorTreeNode[],
    activeId: obj.activeId,
    openFolders: obj.openFolders as Record<string, boolean>,
    generatedUiImages: generated,
  };
}

function classifyGeneratedImage(img: GeneratedUiImage): "logo" | "mobile" | "poster" | "web" | "generic" {
  const hay = `${img.page_name ?? ""} ${img.filename ?? ""}`.toLowerCase();
  if (hay.includes("logo")) return "logo";
  if (hay.includes("mobile") || hay.includes("phone") || hay.includes("ios") || hay.includes("android")) return "mobile";
  if (hay.includes("poster") || hay.includes("instagram") || hay.includes("flyer") || hay.includes("banner")) return "poster";
  if (hay.includes("web") || hay.includes("desktop") || hay.includes("dashboard") || hay.includes("landing")) return "web";
  return "generic";
}

function pickImageForScreen(
  screen: Extract<EditorTreeNode, { kind: "screen" }>,
  images: GeneratedUiImage[],
): GeneratedUiImage | null {
  if (!images.length) return null;
  const sorted = images
    .slice()
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  const screenName = (screen.name || "").toLowerCase();
  const format = (screen.formatLabel || "").toLowerCase();
  const direct = sorted.find((img) => {
    const hay = `${img.page_name ?? ""} ${img.filename ?? ""}`.toLowerCase();
    return (screenName && hay.includes(screenName)) || (format && hay.includes(format));
  });
  if (direct) return direct;

  const byFrame = sorted.find((img) => {
    const k = classifyGeneratedImage(img);
    if (screen.frame === "mobile") return k === "mobile";
    return k === "web" || k === "poster" || k === "generic";
  });
  return byFrame ?? sorted[0];
}

function dedupeGeneratedImages(images: GeneratedUiImage[]): GeneratedUiImage[] {
  const map = new Map<string, GeneratedUiImage>();
  for (const img of images) {
    const key = img.id || img.url || img.filename;
    if (!key) continue;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, img);
      continue;
    }
    const prevAt = prev.created_at || "";
    const nextAt = img.created_at || "";
    if (nextAt.localeCompare(prevAt) >= 0) {
      map.set(key, img);
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

function normalizePracticeTreeFlat(tree: EditorTreeNode[]) {
  const screens = tree.filter((n): n is Extract<EditorTreeNode, { kind: "screen" }> => n.kind === "screen");
  const fromCanvasFolder = tree
    .filter((n): n is Extract<EditorTreeNode, { kind: "folder" }> => n.kind === "folder")
    .flatMap((f) => f.children.filter((c): c is Extract<EditorTreeNode, { kind: "screen" }> => c.kind === "screen"));

  const merged = [...screens, ...fromCanvasFolder];
  return merged;
}

export default function ProjectEditorPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "";

  const [projectMeta, setProjectMeta] = useState<DesignerProject | null>(null);
  const projectKind = resolveProjectKind(projectMeta?.kind);

  const [tree, setTree] = useState<EditorTreeNode[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Viewport Scaling State
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const clampZoom = (v: number) => Math.max(0.2, Math.min(3, v));

  // Meta: resolve kind from API first so bootstrap matches DB (local list may be missing the project).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const localMeta = readDesignerProjects().find((p) => p.id === projectId) ?? null;
      let resolvedMeta: DesignerProject | null = localMeta;

      try {
        const res = await getJson<{ project: { id: string; name: string; kind: string } }>(
          `/api/projects/${projectId}`,
        );
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
          setProjectMeta(found ?? localMeta);
        }
      } catch {
        if (!cancelled) {
          resolvedMeta = localMeta;
          setProjectMeta(localMeta);
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

      const mergedServerImages = dedupeGeneratedImages([
        ...(remoteParsedData?.generatedUiImages ?? []),
        ...assetsFromDb,
      ]);

      // Keep local draft only for structure convenience, never as authoritative image source.
      const parsedData = localParsedData ?? remoteParsedData;
      if (parsedData) {
        let { tree, activeId, openFolders } = parsedData;
        // Previously we bootstrapped as ui/ux before API kind arrived; fix stale default trees for website projects.
        if (kind === "website design" && isDefaultUiUxBootstrapTree(tree)) {
          const boot = getEditorBootstrap("website design");
          tree = boot.tree;
          activeId = boot.activeId;
          openFolders = boot.openFolders;
        }
        if (kind === "practice") {
          const flattened = normalizePracticeTreeFlat(tree);
          tree = flattened;
          openFolders = {};
          if (!flattened.some((n) => n.id === activeId)) {
            activeId = flattened[0]?.id ?? "";
          }
        }

        setTree(tree);
        setActiveId(activeId);
        setOpenFolders(openFolders);
        setGeneratedUiImages(mergedServerImages);
        if (draft && draft !== saved) setIsDirty(true);
      } else {
        applyBootstrap();
        setGeneratedUiImages(mergedServerImages);
      }
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const [isDirty, setIsDirty] = useState(false);
  const isFirstRender = useRef(true);
  const dirtyRef = useRef(false);
  const isCleaningUpRef = useRef(false);

  const [showExitModal, setShowExitModal] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [me, setMe] = useState<MeResponse["user"]>(null);
  const [generatedUiImages, setGeneratedUiImages] = useState<GeneratedUiImage[]>([]);
  const mergeGeneratedUiImages = useCallback((incoming: GeneratedUiImage[]) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return;
    setGeneratedUiImages((prev) => {
      const merged = dedupeGeneratedImages([...prev, ...incoming]);
      if (merged.length === prev.length) {
        let same = true;
        for (let i = 0; i < merged.length; i++) {
          const a = merged[i];
          const b = prev[i];
          if (
            !b ||
            a.id !== b.id ||
            a.url !== b.url ||
            a.filename !== b.filename ||
            a.page_name !== b.page_name ||
            a.created_at !== b.created_at
          ) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return merged;
    });
  }, []);

  const [isSaving, setIsSaving] = useState(false);
  const [brokenImageKeys, setBrokenImageKeys] = useState<Record<string, boolean>>({});
  const lastAutoSyncedImagesRef = useRef<string>("");
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
  }, [tree, generatedUiImages, hydrated]);

  // History Interceptor (The "Strict Lock")
  useEffect(() => {
    if (!isDirty) return;

    const handlePopState = (e: PopStateEvent) => {
      if (isCleaningUpRef.current) return;
      window.history.pushState(null, "", window.location.href);
      setPendingHref("/projects");
      setShowExitModal(true);
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isDirty]);

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

  function buildPersistedEditorData(): PersistedEditorData {
    return { tree, activeId, openFolders, generatedUiImages };
  }

  async function persistProjectData() {
    const storageKey = `${STORAGE_PREFIX}${projectId}`;
    const payload = buildPersistedEditorData();
    localStorage.setItem(storageKey, JSON.stringify(payload));
    await putJson<{ ok: boolean }>(`/api/projects/${projectId}/data`, { data: payload });
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
      localStorage.setItem(
        `draft.${STORAGE_PREFIX}${projectId}`,
        JSON.stringify(buildPersistedEditorData()),
      );
    }, 1000);
    return () => clearTimeout(timeout);
  }, [tree, activeId, openFolders, generatedUiImages, hydrated, projectId]);

  // Auto-sync generated designs to server so reopen always restores them.
  // This runs in background and does not replace explicit "Save" UX.
  useEffect(() => {
    if (!hydrated || !projectId || generatedUiImages.length === 0) return;
    const signature = JSON.stringify(
      generatedUiImages
        .map((i) => ({ id: i.id, url: i.url, filename: i.filename, page_name: i.page_name, created_at: i.created_at }))
        .sort((a, b) => (a.id || "").localeCompare(b.id || "")),
    );
    if (signature === lastAutoSyncedImagesRef.current) return;

    const timeout = window.setTimeout(() => {
      const payload = buildPersistedEditorData();
      void putJson<{ ok: boolean }>(`/api/projects/${projectId}/data`, { data: payload })
        .then(() => {
          lastAutoSyncedImagesRef.current = signature;
        })
        .catch(() => {
          // Keep silent; manual save remains available and local draft still exists.
        });
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [generatedUiImages, hydrated, projectId, tree, activeId, openFolders]);

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

  function handleDownloadProject() {
    if (!projectId) return;
    window.location.href = `/api/projects/${projectId}/download`;
  }

  // Internal Navigation Security
  function handleSafeNavigate(href: string) {
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

      if (projectKind === "logo design") { baseWidth = 1200; baseHeight = 900; }
      if (projectKind === "ui/ux design") { baseWidth = 1920; baseHeight = 1080; }

      const sectionsCount = node.sections?.length || 1;
      const totalWidth = node.frame === "mobile" && projectKind === "website design"
        ? (baseWidth + 32) * sectionsCount
        : baseWidth;
      const totalHeight = node.frame === "mobile" && projectKind === "website design"
        ? baseHeight
        : (baseHeight + 48) * sectionsCount;

      const scaleX = (rect.width - padding) / totalWidth;
      const scaleY = (rect.height - padding) / totalHeight;

      let finalScale;
      // For multi-section projects, we fix one dimension to prevent zooming out upon expansion
      if (projectKind === "website design" || projectKind === "ui/ux design") {
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
  const latestGeneratedUiImage = useMemo(() => {
    if (!generatedUiImages.length) return null;
    return generatedUiImages
      .slice()
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
  }, [generatedUiImages]);

  function handleFolderAdd(folderId: string, customName?: string, formatLabel?: string) {
    const folder = findNodeById(tree, folderId);
    if (!folder || folder.kind !== "folder") return;

    const frame = defaultFrameForFolder(folderId, folder.name);
    const screenCount = folder.children.filter((c) => c.kind === "screen").length + 1;

    let name = customName ?? `Screen ${screenCount}`;
    if (!customName) {
      if (projectKind === "website design") {
        name = frame === "mobile" ? `Mobile ${screenCount}` : `Desktop ${screenCount}`;
      } else if (projectKind === "practice") {
        name = `Practice ${screenCount}`;
      } else if (projectKind === "logo design") {
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

  function handleHeaderPlus() {
    if (projectKind === "practice") {
      const newId = crypto.randomUUID();
      const child: EditorTreeNode = {
        id: newId,
        kind: "screen",
        name: "Untitled",
        frame: "desktop",
        sections: [{ id: crypto.randomUUID(), name: "First Section" }],
        expansionDirection: "vertical",
      };
      setTree((prev) => [...prev, child]);
      setActiveId(newId);
      setRenamingId(newId);
      setRenameDraft("Untitled");
      toast.success("Practice added.");
      return;
    }

    if (projectKind === "campaign design") {
      const folder = tree.find((n) => n.kind === "folder");
      if (folder) openCampaignPresetPicker(folder.id);
      return;
    }

    const folderId = activeNode?.kind === "folder" ? activeNode.id : null;
    if (folderId) { handleFolderAdd(folderId); return; }

    const firstFolder = tree.find((n) => n.kind === "folder");
    if (firstFolder) { handleFolderAdd(firstFolder.id); return; }
    toast.error("No folder to add to.");
  }

  function handleDeleteNode(id: string) {
    setTree((prev) => removeNodeById(prev, id));
    if (activeId === id) setActiveId("");
    toast.success("Item removed.");
  }

  function handleAddSection(screenId: string) {
    setTree((prev) => addSectionToScreen(prev, screenId, "New Section"));
    toast.success("Section expanded.");
  }

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
              if (projectKind !== "practice") return;
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
            {projectKind === "practice" && renamingId === n.id ? (
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
          <Button
            size="icon"
            variant="ghost"
            className="size-7 rounded-lg opacity-0 group-hover/item:opacity-100 hover:text-destructive transition-all"
            onClick={() => handleDeleteNode(n.id)}
          >
            <Trash2 className="size-3.5" />
          </Button>
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
                <div
                  className="rounded-lg shadow-2xl bg-white dark:bg-zinc-200 border border-foreground/5 pointer-events-none overflow-hidden flex flex-col gap-[2px] p-[2px]"
                  style={{ width: s.frame === "mobile" ? "32%" : "85%", aspectRatio: s.frame === "mobile" ? 375 / 812 : 16 / 9 }}
                >
                  {(s.sections ?? [{ id: '1' }]).map((_, i) => (
                    <div key={i} className="flex-1 bg-zinc-100 dark:bg-zinc-300 rounded-[2px] relative">
                      <div className="absolute inset-0 flex items-center justify-center opacity-10">
                        <Layout className="size-4" />
                      </div>
                    </div>
                  ))}
                </div>
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
                  {s.frame === "mobile" ? "Mobile Viewport" : "Desktop Viewport"}
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
      const selectedImage = pickImageForScreen(screen, generatedUiImages) ?? latestGeneratedUiImage;
      const sections = screen.sections ?? [{ id: "base", name: "Base" }];
      const isMobileHorizontal = projectKind === "website design" && screen.frame === "mobile";

      let aspectRatio = 16 / 9;
      let width = screen.frame === "mobile" ? 375 : 1440;
      if (projectKind === "logo design") { aspectRatio = 4 / 3; width = 1200; }
      if (projectKind === "ui/ux design") { aspectRatio = 16 / 9; width = 1920; }
      if (projectKind === "campaign design" && screen.formatLabel) {
        const res = (RESOLUTIONS.CAMPAIGN as any)[screen.formatLabel];
        if (res) { aspectRatio = res.w / res.h; width = res.w; }
      }
      if (projectKind === "website design") {
        aspectRatio = screen.frame === "mobile" ? RESOLUTIONS.WEBSITE.MOBILE.w / RESOLUTIONS.WEBSITE.MOBILE.h : RESOLUTIONS.WEBSITE.DESKTOP.w / RESOLUTIONS.WEBSITE.DESKTOP.h;
      }

      return (
        <div className={cn(
          "relative min-h-full flex flex-col",
          isMobileHorizontal ? "items-start" : "items-center"
        )}>
          {screen.formatLabel && (
            <div className="w-full flex justify-start mb-6 px-1 shrink-0">
              <span className="text-[0.6rem] bg-[#eca8d6]/10 text-[#eca8d6] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">{screen.formatLabel}</span>
            </div>
          )}

          {/* Blueprint Pixel Grid for UI/UX */}
          {projectKind === "ui/ux design" && (
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
            {sections.map((sec, idx) => (
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
            ))}
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
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}>
            <Sidebar className="size-4" />
          </Button>
          <button
            onClick={() => handleSafeNavigate("/")}
            className="font-mono text-[0.65rem] font-black text-muted-foreground uppercase tracking-[0.4em] outline-none hover:text-white transition-colors"
          >
            Designer
          </button>
          <div className="h-4 w-px bg-foreground/10 mx-2" />
          <Menubar className="h-8 border-transparent bg-transparent shadow-none p-0 cursor-default">
            <MenubarMenu><MenubarTrigger className="text-[0.7rem] uppercase font-bold tracking-tighter">File</MenubarTrigger></MenubarMenu>
          </Menubar>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-4 py-1.5 rounded-2xl bg-foreground/[0.03] border border-foreground/5">
          <button
            onClick={() => handleSafeNavigate("/projects")}
            className="text-[0.65rem] font-bold text-muted-foreground hover:text-[#eca8d6] uppercase outline-none"
          >
            Projects
          </button>
          <span className="text-muted-foreground/30 text-[0.6rem]">/</span>
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
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 rounded-full px-4 text-[0.65rem] font-black uppercase tracking-[0.22em]",
                "border-foreground/15 bg-background text-foreground hover:bg-foreground/5"
              )}
              onClick={handleDownloadProject}
            >
              Download <Download className="ml-2 size-3.5" />
            </Button>
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
              <ResizablePanel defaultSize={16} minSize={12} maxSize={30} className="border-r border-foreground/5">
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

          <ResizablePanel defaultSize={56}>
            <section className="h-full flex flex-col bg-foreground/[0.01] overflow-hidden">
              <div
                ref={workspaceRef}
                onWheel={handleWorkspaceWheel}
                className={cn(
                  "flex-1 relative p-24 bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.02)_100%)] thin-scrollbar",
                  (activeNode?.kind === "screen" && activeNode.frame === "mobile") || projectKind === "practice"
                    ? "overflow-x-auto overflow-y-auto"
                    : "overflow-x-hidden overflow-y-auto",
                  projectKind === "practice" && "p-0"
                )}
              >
                {renderWorkspaceBody()}
              </div>
            </section>
          </ResizablePanel>

          <ResizableHandle className="bg-foreground/5 w-[1px] hover:bg-[#eca8d6]/30 transition-all" />

          <ResizablePanel defaultSize={28} minSize={20} className="border-l border-foreground/5">
            <aside className="flex flex-col h-full bg-background no-scrollbar overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
                <div className="text-sm font-medium">Designer</div>
                <div className="flex items-center gap-3 text-muted-foreground/60">
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
                  <Clock className="size-4 cursor-pointer hover:text-white transition-colors ml-1" />
                </div>
              </div>
              <UIDesignerEditorChatPanel projectId={projectId} onImagesChange={mergeGeneratedUiImages} />
            </aside>
          </ResizablePanel>
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
        />
      ) : null}
    </div>
  );
}
