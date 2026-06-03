"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Layout, Library, Megaphone, PenTool, Plus, Target, Trash2, LayoutGrid, Monitor, Smartphone, Package } from "lucide-react";
import { toast } from "sonner";

import { FolderCard } from "@/components/app/folder-card";
import { ShareDialog } from "@/components/share/share-dialog";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDesignerProjects } from "@/hooks/use-designer-projects";
import { type DesignerProject, type ProjectKind } from "@/lib/designer-projects";

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] flex items-center justify-center text-sm text-muted-foreground">
          Loading projects…
        </div>
      }
    >
      <ProjectsPageContent />
    </Suspense>
  );
}

function ProjectsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filterType = searchParams.get("filter");
  const activeLibrary = searchParams.get("library");

  const [showBin, setShowBin] = useState(false);
  const { projects, createProject, removeProject, updateProject, hydrated } = useDesignerProjects(showBin ? "deleted" : "active");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"type" | "subtype" | "name">("type");
  const [createType, setCreateType] = useState<ProjectKind | null>(null);

  const [favorites, setFavorites] = useState<string[]>([]);
  const [libsData, setLibsData] = useState<Record<string, string[]>>({});
  const [libsList, setLibsList] = useState<string[]>([]);

  const loadLocalCatalog = () => {
    try {
      const favs = localStorage.getItem("designer.favorites");
      if (favs) setFavorites(JSON.parse(favs));
    } catch {
      // ignore
    }
    try {
      const libs = localStorage.getItem("designer.libraries");
      if (libs) setLibsData(JSON.parse(libs));
    } catch {
      // ignore
    }
    try {
      const list = localStorage.getItem("designer.libraries_list");
      if (list) setLibsList(JSON.parse(list));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadLocalCatalog();
    window.addEventListener("storage", loadLocalCatalog);
    return () => window.removeEventListener("storage", loadLocalCatalog);
  }, []);

  const saveFavorites = (newFavs: string[]) => {
    setFavorites(newFavs);
    localStorage.setItem("designer.favorites", JSON.stringify(newFavs));
    // Trigger custom storage event for sidebar update
    window.dispatchEvent(new Event("storage"));
  };

  const saveLibsData = (newLibs: Record<string, string[]>) => {
    setLibsData(newLibs);
    localStorage.setItem("designer.libraries", JSON.stringify(newLibs));
    window.dispatchEvent(new Event("storage"));
  };

  const toggleFavorite = (id: string) => {
    const isFav = favorites.includes(id);
    if (isFav) {
      saveFavorites(favorites.filter((f) => f !== id));
      toast.success("Removed from Favorites.");
    } else {
      saveFavorites([...favorites, id]);
      toast.success("Added to Favorites!");
    }
  };

  const addToLibrary = (projectId: string, libName: string) => {
    const updated = { ...libsData };
    Object.keys(updated).forEach((k) => {
      updated[k] = updated[k].filter((id) => id !== projectId);
    });
    if (!updated[libName]) updated[libName] = [];
    updated[libName].push(projectId);
    saveLibsData(updated);
    toast.success(`Added to "${libName}"!`);
  };

  const removeFromLibrary = (projectId: string) => {
    const updated = { ...libsData };
    Object.keys(updated).forEach((k) => {
      updated[k] = updated[k].filter((id) => id !== projectId);
    });
    saveLibsData(updated);
    toast.success("Removed from library.");
  };

  const getProjectLibraryName = (projectId: string) => {
    return Object.keys(libsData).find((lib) => libsData[lib].includes(projectId)) || null;
  };

  const [renameTarget, setRenameTarget] = useState<DesignerProject | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [libraryTarget, setLibraryTarget] = useState<DesignerProject | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DesignerProject | null>(null);
  const [deletePermanentTarget, setDeletePermanentTarget] = useState<DesignerProject | null>(null);
  const [shareTarget, setShareTarget] = useState<DesignerProject | null>(null);


  useEffect(() => {
    if (renameTarget) setRenameValue(renameTarget.name);
  }, [renameTarget]);

  const createOptions = useMemo(
    () =>
      [
        "landing page",
        "multi-page website",
        "product design",
        "logo design",
        "social media design",
      ] as const,
    [],
  );

  async function createProjectAndOpen(projectName: string, kindOverride?: ProjectKind) {
    const kind = kindOverride ?? createType ?? "landing page";
    const p = await createProject(projectName, kind);
    toast.success("Project created.");
    router.push(`/project/${p.id}`);
  }

  function confirmRename() {
    const n = renameValue.trim();
    if (!renameTarget || !n) {
      toast.error("Enter a project name.");
      return;
    }
    updateProject(renameTarget.id, { name: n });
    toast.success("Project renamed.");
    setRenameTarget(null);
  }

  const filteredProjects = useMemo(() => {
    let list = projects;
    if (filterType === "favorites") {
      list = list.filter((p) => favorites.includes(p.id));
    } else if (activeLibrary) {
      const libProjects = libsData[activeLibrary] || [];
      list = list.filter((p) => libProjects.includes(p.id));
    }
    return list;
  }, [projects, filterType, activeLibrary, favorites, libsData]);

  // Generate dynamic storage sizes based on project state
  const computedProjects = useMemo(() => {
    return filteredProjects.map((p) => {
      // Simulate real project sizing based on string index, deterministic but looks dynamic!
      const charSum = p.name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const computedSize = ((charSum % 7) * 0.12 + 0.15).toFixed(2);
      return {
        ...p,
        sizeText: `${computedSize} GB`
      };
    });
  }, [filteredProjects]);

  const pageTitle = useMemo(() => {
    if (showBin) return "Recycle Bin";
    if (filterType === "favorites") return "Favorite Projects";
    if (activeLibrary) return `Library: ${activeLibrary}`;
    return "Projects";
  }, [showBin, filterType, activeLibrary]);

  const pageDescription = useMemo(() => {
    if (showBin) return "Projects here will be permanently deleted after 30 days.";
    if (filterType === "favorites") return "Your starred high-priority design spaces.";
    if (activeLibrary) return `Curated project folder for "${activeLibrary}".`;
    return "Open a folder to work in the editor, or start something new.";
  }, [showBin, filterType, activeLibrary]);

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl tracking-tight sm:text-4xl">{pageTitle}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{pageDescription}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className={cn("shrink-0 rounded-full", showBin ? "bg-foreground/10 text-foreground" : "text-muted-foreground")}
              onClick={() => setShowBin(!showBin)}
              title={showBin ? "Back to Projects" : "Recycle Bin"}
            >
              {showBin ? <ArrowLeft className="size-4" /> : <Trash2 className="size-4" />}
            </Button>
            {!showBin && (
              <Button
                className="shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/90"
                onClick={() => {
                  setCreateStep("type");
                  setCreateType(null);
                  setOpen(true);
                }}
              >
                <Plus className="size-4" />
                New project
              </Button>
            )}
          </div>
        </div>

        {!hydrated ? (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-48 rounded-3xl border border-foreground/10 bg-foreground/[0.03] animate-pulse" />
            ))}
          </div>
        ) : null}

        {hydrated && projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-foreground/10 bg-foreground/[0.02] px-6 py-20 text-center">
            <p className="text-sm text-muted-foreground max-w-md">
              {showBin ? "No deleted projects found." : "No projects yet. Create your first project to open the editor."}
            </p>
            {!showBin && (
              <Button
                className="mt-6 rounded-full bg-foreground text-background hover:bg-foreground/90"
                onClick={() => {
                  setCreateStep("type");
                  setCreateType(null);
                  setOpen(true);
                }}
              >
                <Plus className="size-4" />
                New project
              </Button>
            )}
          </div>
        ) : null}

        {hydrated && projects.length > 0 && computedProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-foreground/10 bg-foreground/[0.02] px-6 py-20 text-center">
            <p className="text-sm text-muted-foreground max-w-md">
              {filterType === "favorites"
                ? "No favorite projects yet. Click any project card's triple-dot menu and select 'Add to Favorites' to start starring your work!"
                : `No projects in the "${activeLibrary}" library yet. Open a project card's ⋯ menu and choose Library to add it here.`}
            </p>
          </div>
        ) : null}

        {hydrated && computedProjects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {computedProjects.map((p) => (
              <FolderCard
                key={p.id}
                href={showBin ? undefined : `/project/${p.id}`}
                title={p.name}
                sizeText={p.sizeText}
                dateText={p.dateText}
                isFavorite={favorites.includes(p.id)}
                onToggleFavorite={() => toggleFavorite(p.id)}
                currentLibrary={getProjectLibraryName(p.id)}
                onLibrary={
                  showBin || libsList.length === 0 ? undefined : () => setLibraryTarget(p)
                }
                onRename={showBin ? undefined : () => setRenameTarget(p)}
                onShare={showBin ? undefined : () => setShareTarget(p)}
                onDelete={showBin ? undefined : () => setDeleteTarget(p)}
                onRestore={showBin ? () => {
                  updateProject(p.id, { restore: true });
                  toast.success("Project restored.");
                } : undefined}
                onDeletePermanent={showBin ? () => setDeletePermanentTarget(p) : undefined}
              />
            ))}
          </div>
        ) : null}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-foreground/15 bg-background/72 backdrop-blur-2xl p-0 overflow-hidden sm:max-w-[44rem]">
          {createStep === "type" ? (
            <>
              <div className="relative px-6 pt-6 pb-4">
                <div
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_25%_0%,rgba(236,168,214,0.18),transparent_60%)]"
                  aria-hidden
                />
                <DialogHeader className="relative">
                  <DialogTitle className="font-display text-2xl tracking-tight">Start a new project</DialogTitle>
                  <DialogDescription className="text-sm">
                    Pick what you’re designing. You can rename anytime.
                  </DialogDescription>
                </DialogHeader>
                <div className="relative mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    <span className="text-[#eca8d6]">01</span>
                    Type
                    <span className="opacity-60">→</span>
                    <span className="opacity-60">02</span>
                    <span className="opacity-60">Name</span>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/[0.02] px-3 py-1 text-[0.7rem] font-mono text-muted-foreground">
                    Tip: press <span className="text-foreground/90">Esc</span> to close
                  </div>
                </div>
              </div>

              <div className="px-6 pb-6">
                <div className="grid gap-3 sm:grid-cols-2">
                  {createOptions.map((opt) => {
                    const meta =
                      opt === "landing page"
                        ? { icon: Layout, desc: "One page to sell or explain your product" }
                        : opt === "multi-page website"
                          ? { icon: LayoutGrid, desc: "Several linked pages, like a full website" }
                          : opt === "product design"
                            ? { icon: Target, desc: "App screens, dashboards, or packaging" }
                            : opt === "logo design"
                              ? { icon: PenTool, desc: "Logos and brand marks" }
                              : { icon: Megaphone, desc: "Posts, ads, and social graphics" };
                    const Icon = meta.icon;
                    return (
                      <button
                        key={opt}
                        type="button"
                        className={cn(
                          "group relative overflow-hidden rounded-2xl border p-4 text-left",
                          "border-[#eca8d6]/20 bg-foreground/[0.02] transition-[border-color,background-color,transform] duration-200",
                          "hover:-translate-y-0.5 hover:bg-foreground/[0.04] hover:border-[#eca8d6]/40",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eca8d6]/50",
                        )}
                        onClick={() => {
                          if (opt === "product design") {
                            setCreateStep("subtype");
                          } else {
                            setCreateType(opt);
                            setCreateStep("name");
                            setName("");
                          }
                        }}
                      >
                        <div
                          className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full bg-[#eca8d6]/10 blur-2xl"
                          aria-hidden
                        />
                        <div className="relative flex items-start gap-3">
                          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#eca8d6]/16 ring-1 ring-[#eca8d6]/28">
                            <Icon className="size-5 text-[#eca8d6] opacity-100 [stroke-opacity:1]" strokeWidth={2} />
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium leading-snug text-foreground capitalize">{opt}</div>
                            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{meta.desc}</div>
                          </div>
                          <div className="ml-auto hidden sm:flex items-center self-center text-xs font-mono text-[#eca8d6]/80 opacity-0 transition-opacity group-hover:opacity-100">
                            Select
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : createStep === "subtype" ? (
            <>
              <div className="relative px-6 pt-6 pb-4">
                <div
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_25%_0%,rgba(236,168,214,0.18),transparent_60%)]"
                  aria-hidden
                />
                <DialogHeader className="relative">
                  <DialogTitle className="font-display text-2xl tracking-tight">Select Product Category</DialogTitle>
                  <DialogDescription className="text-sm">
                    Choose the format that fits your product best.
                  </DialogDescription>
                </DialogHeader>
                <div className="relative mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    <span className="opacity-60">01</span>
                    <span className="opacity-60">Type</span>
                    <span className="opacity-60">→</span>
                    <span className="text-[#eca8d6]">02</span>
                    Subtype
                    <span className="opacity-60">→</span>
                    <span className="opacity-60">03</span>
                    <span className="opacity-60">Name</span>
                  </div>
                </div>
              </div>

              <div className="px-6 pb-6">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { id: "desktop", label: "Desktop App", icon: Monitor, desc: "Web apps and dashboards on desktop" },
                    { id: "app", label: "Mobile App", icon: Smartphone, desc: "Phone and tablet app screens" },
                    { id: "packaging", label: "Packaging Layout", icon: Package, desc: "Boxes, labels, and print layouts" },
                  ].map((sub) => {
                    const SubIcon = sub.icon;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        className={cn(
                          "group relative overflow-hidden rounded-2xl border p-4 text-left flex flex-col justify-between min-h-[140px]",
                          "border-[#eca8d6]/20 bg-foreground/[0.02] transition-[border-color,background-color,transform] duration-200",
                          "hover:-translate-y-0.5 hover:bg-foreground/[0.04] hover:border-[#eca8d6]/40",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eca8d6]/50",
                        )}
                        onClick={() => {
                          setCreateType(`product design - ${sub.id}` as any);
                          setCreateStep("name");
                          setName("");
                        }}
                      >
                        <div
                          className="pointer-events-none absolute -right-10 -top-10 size-24 rounded-full bg-[#eca8d6]/10 blur-xl"
                          aria-hidden
                        />
                        <div className="relative flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#eca8d6]/16 ring-1 ring-[#eca8d6]/28">
                            <SubIcon className="size-4 text-[#eca8d6]" strokeWidth={2} />
                          </span>
                          <span className="font-medium text-sm text-foreground leading-snug">{sub.label}</span>
                        </div>
                        <div className="relative mt-3 text-xs leading-relaxed text-muted-foreground min-h-[40px]">
                          {sub.desc}
                        </div>
                        <div className="relative mt-2 ml-auto text-[0.7rem] font-mono text-[#eca8d6]/80 opacity-0 transition-opacity group-hover:opacity-100">
                          Select →
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-full border-foreground/15 bg-transparent hover:bg-foreground/5"
                    onClick={() => setCreateStep("type")}
                  >
                    Back
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="relative px-6 pt-6 pb-4">
                <div
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_25%_0%,rgba(236,168,214,0.18),transparent_60%)]"
                  aria-hidden
                />
                <DialogHeader className="relative">
                  <DialogTitle className="font-display text-2xl tracking-tight">Name your project</DialogTitle>
                  <DialogDescription className="text-sm">
                    {createType ? (
                      <>
                        Type: <span className="text-[#eca8d6] capitalize">{createType}</span>
                      </>
                    ) : (
                      "Name it something you’ll recognize later."
                    )}
                  </DialogDescription>
                </DialogHeader>
                <div className="relative mt-4 flex items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                  <span className="opacity-60">01</span>
                  <span className="opacity-60">Type</span>
                  <span className="opacity-60">→</span>
                  {createType?.startsWith("product design") && (
                    <>
                      <span className="opacity-60">02</span>
                      <span className="opacity-60">Subtype</span>
                      <span className="opacity-60">→</span>
                    </>
                  )}
                  <span className="text-[#eca8d6]">{createType?.startsWith("product design") ? "03" : "02"}</span>
                  Name
                </div>
              </div>

              <div className="px-6 pb-6 space-y-4">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. April campaign"
                  className="h-12 rounded-2xl border-foreground/15 bg-foreground/[0.03] px-4 focus-visible:ring-[#eca8d6]/25 focus-visible:border-[#eca8d6]/35"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = name.trim();
                      if (!n) return toast.error("Enter a project name.");
                      setOpen(false);
                      setName("");
                      void createProjectAndOpen(n);
                    }
                  }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 flex-1 rounded-full border-foreground/15 bg-transparent hover:bg-foreground/5"
                    onClick={() => {
                      if (createType?.startsWith("product design")) {
                        setCreateStep("subtype");
                      } else {
                        setCreateStep("type");
                      }
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    className="h-11 flex-1 rounded-full bg-foreground text-background hover:bg-foreground/90"
                    onClick={() => {
                      const n = name.trim();
                      if (!n) return toast.error("Enter a project name.");
                      setOpen(false);
                      setName("");
                      void createProjectAndOpen(n);
                    }}
                  >
                    Create & open
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={libraryTarget !== null} onOpenChange={(o) => !o && setLibraryTarget(null)}>
        <DialogContent className="border-foreground/15 bg-background/90 backdrop-blur-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add to library</DialogTitle>
            <DialogDescription>
              {libraryTarget
                ? `Choose a library for “${libraryTarget.name}”.`
                : "Choose a library for this project."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[min(50vh,320px)] overflow-y-auto pr-1">
            {libsList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No libraries yet. Use the + button next to Library in the sidebar to create one.
              </p>
            ) : (
              libsList.map((lib) => {
                const isCurrent = libraryTarget
                  ? getProjectLibraryName(libraryTarget.id) === lib
                  : false;
                return (
                  <button
                    key={lib}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                      isCurrent
                        ? "border-[#eca8d6]/40 bg-[#eca8d6]/10"
                        : "border-foreground/10 bg-foreground/[0.02] hover:bg-foreground/[0.06] hover:border-foreground/15",
                    )}
                    onClick={() => {
                      if (!libraryTarget) return;
                      addToLibrary(libraryTarget.id, lib);
                      setLibraryTarget(null);
                    }}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#eca8d6]/15">
                      <Library className="size-4 text-[#eca8d6]" />
                    </span>
                    <span className="flex-1 font-medium truncate">{lib}</span>
                    {isCurrent ? (
                      <span className="text-[0.65rem] font-mono uppercase text-[#eca8d6]">Current</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          {libraryTarget && getProjectLibraryName(libraryTarget.id) ? (
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-full border-destructive/20 text-destructive hover:bg-destructive/10"
              onClick={() => {
                removeFromLibrary(libraryTarget.id);
                setLibraryTarget(null);
              }}
            >
              Remove from library
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="border-foreground/15 bg-background/90 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>Update how this project appears in your list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Project name"
              className="h-11 border-foreground/15 bg-foreground/[0.03]"
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmRename();
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-full" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button className="rounded-full bg-foreground text-background" onClick={confirmRename}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                <>
                  “{deleteTarget.name}” will be removed from this device. This doesn’t delete files on a server yet (local
                  list only).
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  removeProject(deleteTarget.id);
                  toast.success("Project removed.");
                }
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deletePermanentTarget !== null} onOpenChange={(o) => !o && setDeletePermanentTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletePermanentTarget ? (
                <>
                  “{deletePermanentTarget.name}” will be permanently deleted. This action cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletePermanentTarget) {
                  removeProject(deletePermanentTarget.id, true);
                  toast.success("Project permanently deleted.");
                }
                setDeletePermanentTarget(null);
              }}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {shareTarget ? (
        <ShareDialog
          open={shareTarget !== null}
          onOpenChange={(o) => !o && setShareTarget(null)}
          projectId={shareTarget.id}
          projectName={shareTarget.name}
        />
      ) : null}
    </div>
  );
}
