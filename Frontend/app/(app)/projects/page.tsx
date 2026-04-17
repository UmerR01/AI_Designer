"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Brush, Layout, Megaphone, PenTool, Plus, Target } from "lucide-react";
import { toast } from "sonner";

import { FolderCard } from "@/components/app/folder-card";
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
  const router = useRouter();
  const { projects, createProject, removeProject, updateProject, hydrated } = useDesignerProjects();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"type" | "name">("type");
  const [createType, setCreateType] = useState<
    "website design" | "ui/ux design" | "logo design" | "campaign design" | "practice" | null
  >(null);

  const [renameTarget, setRenameTarget] = useState<DesignerProject | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<DesignerProject | null>(null);

  useEffect(() => {
    if (renameTarget) setRenameValue(renameTarget.name);
  }, [renameTarget]);

  const createOptions = useMemo(
    () =>
      [
        "website design",
        "ui/ux design",
        "logo design",
        "campaign design",
        "practice",
      ] as const,
    [],
  );

  async function createProjectAndOpen(projectName: string, kindOverride?: ProjectKind) {
    const kind = kindOverride ?? createType ?? "ui/ux design";
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

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Open a folder to work in the editor, or start something new.
            </p>
          </div>
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
              No projects yet. Create your first project to open the editor.
            </p>
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
          </div>
        ) : null}

        {hydrated && projects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {projects.map((p) => (
              <FolderCard
                key={p.id}
                href={`/project/${p.id}`}
                title={p.name}
                sizeText={p.sizeText}
                dateText={p.dateText}
                onRename={() => setRenameTarget(p)}
                onDelete={() => setDeleteTarget(p)}
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
                      opt === "website design"
                        ? { icon: Layout, desc: "Landing pages, sites, sections" }
                        : opt === "ui/ux design"
                          ? { icon: Target, desc: "Product UI, flows, wireframes" }
                          : opt === "logo design"
                            ? { icon: PenTool, desc: "Marks, icons, wordmarks" }
                            : opt === "campaign design"
                              ? { icon: Megaphone, desc: "Ads, socials, banners" }
                              : { icon: Brush, desc: "Explore & build skill" };
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
                          setCreateType(opt);
                          setCreateStep("name");
                          setName("");
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
                  <span className="text-[#eca8d6]">02</span>
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
                    onClick={() => setCreateStep("type")}
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
    </div>
  );
}
