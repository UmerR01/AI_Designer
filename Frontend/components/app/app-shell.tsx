"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, useRef } from "react";
import {
  Bell,
  Folder,
  Home,
  Search,
  LogOut,
  LayoutGrid,
  Cloud,
  Star,
  Library,
  Plus,
  ChevronDown,
  User,
  Settings,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { getMeCached, postJson, getJson } from "@/lib/auth-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FloatingChatSupport } from "@/components/support/floating-chat-support";

const LIBRARIES_LIST_KEY = "designer.libraries_list";
const LIBRARIES_DATA_KEY = "designer.libraries";

function readLibrariesData(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(LIBRARIES_DATA_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLibrariesData(data: Record<string, string[]>) {
  localStorage.setItem(LIBRARIES_DATA_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event("storage"));
}

/** Public asset: `public/images/marketing/hero.mp4` */
const HERO_BG_VIDEO = "/images/marketing/hero.mp4";

function HeroAmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <video
        className="h-full min-h-[100dvh] w-full object-cover opacity-70 saturate-[0.9]"
        src={HERO_BG_VIDEO}
        preload="auto"
        muted
        playsInline
        autoPlay
        loop
      />
      {/* light wash — keep gradients soft so video stays visible through glass panels */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_85%_65%_at_25%_12%,rgba(236,168,214,0.08),transparent_60%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/5 via-background/30 to-background/92" />
    </div>
  );
}

type MeResponse = {
  user: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    email_verified: boolean;
  };
};

function initials(first: string, last: string, email: string) {
  const a = (first?.trim()?.[0] ?? "").toUpperCase();
  const b = (last?.trim()?.[0] ?? "").toUpperCase();
  if (a || b) return `${a}${b}`.trim();
  return (email?.trim()?.[0] ?? "U").toUpperCase();
}

function navItemActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/projects") return pathname === "/projects" || pathname.startsWith("/projects/");
  if (href === "/settings") return pathname === "/settings" || pathname.startsWith("/settings/");
  if (href === "/profile") return pathname === "/profile";
  return pathname === href;
}

function AppShellFallback({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] bg-background text-foreground">
      <main className="relative z-10">{children}</main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AppShellFallback>{children}</AppShellFallback>}>
      <AppShellInner>{children}</AppShellInner>
    </Suspense>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeLibraryFilter = searchParams.get("library");
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [railCollapsed, setRailCollapsed] = useState(true); // default closed on mobile
  const sidebarRef = useRef<HTMLElement>(null);

  // Storage / Project count state
  const [projCount, setProjCount] = useState(0);

  // Libraries state
  const [libraries, setLibraries] = useState<string[]>([]);
  const [showAddLib, setShowAddLib] = useState(false);
  const [newLibName, setNewLibName] = useState("");
  const [libsOpen, setLibsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [renameLibTarget, setRenameLibTarget] = useState<string | null>(null);
  const [renameLibValue, setRenameLibValue] = useState("");
  const [deleteLibTarget, setDeleteLibTarget] = useState<string | null>(null);

  const fetchProjCount = async () => {
    try {
      const res = await getJson<{ projects: any[] }>("/api/projects?status=active");
      setProjCount(res.projects.length);
    } catch (e) {}
  };

  useEffect(() => {
    fetchProjCount();
    // Listen to changes to recalculate count instantly
    window.addEventListener("storage", fetchProjCount);
    window.addEventListener("projects-updated", fetchProjCount);
    return () => {
      window.removeEventListener("storage", fetchProjCount);
      window.removeEventListener("projects-updated", fetchProjCount);
    };
  }, []);

  useEffect(() => {
    const loadLibs = () => {
      try {
        const list = localStorage.getItem(LIBRARIES_LIST_KEY);
        if (list) {
          const parsed = JSON.parse(list);
          // filter out Landing Pages and Mobile Apps as requested
          const filtered = parsed.filter((item: string) => item !== "Landing Pages" && item !== "Mobile Apps");
          setLibraries(filtered);
          localStorage.setItem(LIBRARIES_LIST_KEY, JSON.stringify(filtered));
        } else {
          // Empty list by default as requested
          setLibraries([]);
          localStorage.setItem(LIBRARIES_LIST_KEY, JSON.stringify([]));
        }
      } catch (e) {}
    };
    
    loadLibs();
    window.addEventListener("storage", loadLibs);
    return () => window.removeEventListener("storage", loadLibs);
  }, []);

  const handleCreateLibrary = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newLibName.trim();
    if (!name) return;
    if (libraries.includes(name)) {
      toast.error("Library already exists!");
      return;
    }
    const updated = [...libraries, name];
    setLibraries(updated);
    localStorage.setItem(LIBRARIES_LIST_KEY, JSON.stringify(updated));
    setNewLibName("");
    setShowAddLib(false);
    toast.success(`Library "${name}" created!`);
    window.dispatchEvent(new Event("storage"));
  };

  useEffect(() => {
    if (renameLibTarget) setRenameLibValue(renameLibTarget);
  }, [renameLibTarget]);

  function confirmRenameLibrary() {
    if (!renameLibTarget) return;
    const newName = renameLibValue.trim();
    if (!newName) {
      toast.error("Enter a library name.");
      return;
    }
    if (newName === renameLibTarget) {
      setRenameLibTarget(null);
      return;
    }
    if (libraries.includes(newName)) {
      toast.error("A library with that name already exists.");
      return;
    }

    const updatedList = libraries.map((l) => (l === renameLibTarget ? newName : l));
    setLibraries(updatedList);
    localStorage.setItem(LIBRARIES_LIST_KEY, JSON.stringify(updatedList));

    const data = readLibrariesData();
    if (data[renameLibTarget]) {
      data[newName] = data[renameLibTarget];
      delete data[renameLibTarget];
      saveLibrariesData(data);
    }

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("library") === renameLibTarget) {
        router.replace(`/projects?library=${encodeURIComponent(newName)}`);
      }
    }

    setRenameLibTarget(null);
    toast.success(`Library renamed to "${newName}".`);
    window.dispatchEvent(new Event("storage"));
  }

  function confirmDeleteLibrary() {
    if (!deleteLibTarget) return;
    const name = deleteLibTarget;

    const updatedList = libraries.filter((l) => l !== name);
    setLibraries(updatedList);
    localStorage.setItem(LIBRARIES_LIST_KEY, JSON.stringify(updatedList));

    const data = readLibrariesData();
    delete data[name];
    saveLibrariesData(data);

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("library") === name) {
        router.push("/projects");
      }
    }

    setDeleteLibTarget(null);
    toast.success(`Library "${name}" deleted.`);
    window.dispatchEvent(new Event("storage"));
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("designer.sidebar.collapsed");
      if (raw != null) setRailCollapsed(raw === "1");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("designer.sidebar.collapsed", railCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [railCollapsed]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (window.innerWidth < 1024) { // only apply click-outside on small screens where it acts like a drawer
        if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
          if (!railCollapsed) {
            setRailCollapsed(true);
          }
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [railCollapsed]);

  const sectionTitle = useMemo(() => {
    if (pathname?.startsWith("/project/")) return "Editor";
    if (pathname?.startsWith("/profile")) return "Profile";
    if (pathname?.startsWith("/settings")) return "Settings";
    if (pathname?.startsWith("/projects")) return "Projects";
    if (pathname?.startsWith("/dashboard")) return "Home";
    return "Home";
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getMeCached<MeResponse>();
        if (!cancelled) setMe(res.user);
      } catch {
        if (!cancelled) window.location.replace("/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    try {
      await postJson("/api/auth/logout", {});
    } finally {
      toast.success("Signed out.");
      window.location.href = "/";
    }
  }

  if (loading) {
    return (
      <div className="relative min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-[90rem] space-y-8 animate-pulse">
          <div className="h-10 w-40 rounded-2xl bg-foreground/5" />
          <div className="h-64 rounded-3xl border border-foreground/5 bg-foreground/[0.02]" />
          <div className="grid grid-cols-3 gap-6">
            <div className="h-32 rounded-3xl bg-foreground/5" />
            <div className="h-32 rounded-3xl bg-foreground/5" />
            <div className="h-32 rounded-3xl bg-foreground/5" />
          </div>
        </div>
      </div>
    );
  }

  const nav = [
    { href: "/dashboard", label: "Home", icon: Home },
    { href: "/projects", label: "Projects", icon: Folder },
  ];

  const isSupportPage = pathname === "/support";

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-background text-foreground">
      <HeroAmbientBackground />

      {/* Left rail — fixed to viewport so it never scrolls with page */}
      {!isSupportPage && (
        <>
          {/* Mobile Overlay */}
          {!railCollapsed && (
            <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity" />
          )}
          <aside
            ref={sidebarRef}
            className={cn(
              "fixed top-4 bottom-4 z-40 transition-all duration-300",
              railCollapsed ? "w-[4.25rem] -left-20 sm:-left-24 lg:left-[max(1.5rem,calc((100vw_-_100rem)/2_+_1.5rem))]" : "w-64 left-4 sm:left-6 lg:left-[max(1.5rem,calc((100vw_-_100rem)/2_+_1.5rem))]"
            )}
          >
            <div className="flex h-full flex-col overflow-y-auto rounded-2xl border border-foreground/10 bg-background/90 lg:bg-background/40 backdrop-blur-xl shadow-2xl lg:shadow-none">
              <div className="px-3 lg:px-4 pt-4 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      className="size-9 shrink-0 rounded-xl border border-foreground/10 bg-foreground/5 grid place-items-center hover:bg-foreground/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eca8d6]/50"
                      onClick={() => setRailCollapsed((v) => !v)}
                      aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    >
                      <LayoutGrid className="size-4 text-[#eca8d6]" />
                    </button>
                    <Link href="/dashboard" className={cn("hidden lg:block", railCollapsed && "lg:hidden")}>
                      <div className="font-display text-lg tracking-tight">Designer</div>
                      <div className="font-mono text-[0.625rem] text-muted-foreground -mt-0.5">workspace</div>
                    </Link>
                  </div>
                </div>
              </div>

              <nav className="space-y-1 px-2 pb-3 lg:px-3">
                {nav.map((item) => {
                  const active = navItemActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors",
                        "border-foreground/10 bg-foreground/[0.04] hover:bg-foreground/[0.06]",
                        active && "bg-foreground/7",
                      )}
                      onClick={() => {
                        if (window.innerWidth < 1024) setRailCollapsed(true);
                      }}
                    >
                      <Icon className="size-4 shrink-0 text-[#eca8d6]" />
                      <span className={cn("hidden lg:inline", railCollapsed && "lg:hidden")}>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
 
              {/* Library Navigation Item / Collapsible Dropdown */}
              <div className="px-2 pb-3 lg:px-3 space-y-1">
                <div
                  className={cn(
                    "flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors cursor-pointer",
                    "border-foreground/10 bg-foreground/[0.04] hover:bg-foreground/[0.06]",
                    (pathname === "/projects" && (window?.location?.search?.includes("library=") || window?.location?.search?.includes("filter=favorites"))) && "bg-foreground/7"
                  )}
                  onClick={() => setLibsOpen(!libsOpen)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Library className="size-4 shrink-0 text-[#eca8d6]" />
                    <span className={cn("hidden lg:inline text-sm font-medium", railCollapsed && "lg:hidden")}>Library</span>
                  </div>
                  <div className={cn("flex items-center gap-1.5 shrink-0", railCollapsed && "lg:hidden")}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAddLib(!showAddLib);
                      }}
                      className="p-0.5 rounded hover:bg-foreground/10 hover:text-foreground transition-all"
                      title="New Library"
                    >
                      <Plus className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                    <div className="p-0.5 rounded transition-all">
                      <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform duration-200", libsOpen && "rotate-180")} />
                    </div>
                  </div>
                </div>

                {/* Submenu for Library */}
                {libsOpen && !railCollapsed && (
                  <div className="mt-1 space-y-1 pl-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    {/* Add Library Inline Form */}
                    {showAddLib && (
                      <form 
                        onSubmit={handleCreateLibrary} 
                        className="px-2 py-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Input
                          type="text"
                          placeholder="Library name..."
                          value={newLibName}
                          onChange={(e) => setNewLibName(e.target.value)}
                          className="h-8 text-xs bg-background/50 border-foreground/10 focus-visible:ring-[#eca8d6]"
                          autoFocus
                          onBlur={() => {
                            if (!newLibName) setShowAddLib(false);
                          }}
                        />
                      </form>
                    )}

                    {/* Favorites link (In Library only) */}
                    <Link
                      href="/projects?filter=favorites"
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-3 py-1.5 text-xs transition-colors",
                        "border-transparent hover:bg-foreground/[0.02]",
                        pathname === "/projects" && pathname + window?.location?.search === "/projects?filter=favorites"
                          ? "bg-foreground/5 border-foreground/5 text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Star className="size-3.5 text-amber-400 fill-amber-400 shrink-0" />
                      <span>Favorites</span>
                    </Link>

                    {/* Dynamic User Libraries list */}
                    {libraries.map((lib) => {
                      const libHref = `/projects?library=${encodeURIComponent(lib)}`;
                      const libActive = pathname === "/projects" && activeLibraryFilter === lib;
                      return (
                        <div
                          key={lib}
                          className={cn(
                            "group/lib flex items-center gap-0.5 rounded-xl border pr-1 transition-colors",
                            libActive
                              ? "border-foreground/5 bg-foreground/5"
                              : "border-transparent hover:bg-foreground/[0.02]",
                          )}
                        >
                          <Link
                            href={libHref}
                            className={cn(
                              "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-1.5 text-xs transition-colors",
                              libActive
                                ? "text-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => {
                              if (window.innerWidth < 1024) setRailCollapsed(true);
                            }}
                          >
                            <Library className="size-3.5 text-[#eca8d6] shrink-0" />
                            <span className="truncate">{lib}</span>
                          </Link>
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  "flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground",
                                  "opacity-100 hover:bg-foreground/10 hover:text-foreground",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eca8d6]/40",
                                  "data-[state=open]:opacity-100 data-[state=open]:bg-foreground/10",
                                )}
                                aria-label={`Library actions for ${lib}`}
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="size-3.5 text-[#eca8d6]" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              side="right"
                              className="z-[200] w-40 rounded-xl border border-foreground/10 bg-background/95 backdrop-blur-xl p-1 shadow-lg"
                            >
                              <DropdownMenuItem
                                className="gap-2 cursor-pointer text-[0.8rem]"
                                onSelect={() => setRenameLibTarget(lib)}
                              >
                                <Pencil className="size-3.5 text-muted-foreground" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2 cursor-pointer text-[0.8rem] text-destructive focus:text-destructive"
                                onSelect={() => setDeleteLibTarget(lib)}
                              >
                                <Trash2 className="size-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    })}

                    {libraries.length === 0 && !showAddLib && (
                      <div className="px-3 py-2 text-[10px] text-muted-foreground italic text-center border border-dashed border-foreground/5 rounded-xl">
                        No custom libraries. Click "+" to create.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1" />

              <div className="relative px-3 lg:px-4 pb-4 mt-auto space-y-3">
                {profileMenuOpen ? (
                  <div
                    className="pointer-events-none absolute inset-0 -top-2 z-[8] rounded-b-2xl bg-background/50 backdrop-blur-md"
                    aria-hidden
                  />
                ) : null}
                {/* Expanded Storage View */}
                {(() => {
                  const storageUsed = Number((projCount * 0.48 + 0.35).toFixed(1));
                  const percentage = Math.min((storageUsed / 5.0) * 100, 100);
                  const isFull = storageUsed >= 4.0;
                  return (
                    <div
                      className={cn(
                        "relative z-[1] rounded-xl border border-foreground/10 bg-foreground/[0.02] p-3 transition-all",
                        railCollapsed && "lg:hidden",
                        profileMenuOpen && "opacity-60 blur-[2px]",
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Cloud className="size-4 text-[#eca8d6]" />
                          <span>Storage</span>
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">{storageUsed} / 5 GB</span>
                      </div>
                      <div className="h-1.5 w-full bg-foreground/10 rounded-full overflow-hidden">
                        <div className="h-full bg-[#eca8d6] rounded-full transition-all duration-300" style={{ width: `${percentage}%` }} />
                      </div>
                      {/* Condition: >= 4 GB (80%) */}
                      {isFull && (
                        <div className="mt-3">
                          <Button className="w-full h-8 text-[0.65rem] font-bold uppercase tracking-wider bg-[#eca8d6] hover:bg-[#eca8d6]/90 text-white rounded-lg shadow-sm">
                            Buy More Space
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Collapsed Storage View */}
                {(() => {
                  const storageUsed = Number((projCount * 0.48 + 0.35).toFixed(1));
                  const isFull = storageUsed >= 4.0;
                  return (
                    <div
                      className={cn(
                        "relative z-[1] hidden justify-center py-2",
                        railCollapsed && "lg:flex",
                        profileMenuOpen && "opacity-60 blur-[2px]",
                      )}
                    >
                      <div className="flex size-9 items-center justify-center rounded-xl border border-foreground/10 bg-foreground/[0.04] relative group hover:bg-foreground/10 transition-colors">
                        <Cloud className="size-4 text-[#eca8d6]" />
                        {isFull && (
                          <div className="absolute top-0 right-0 size-2 rounded-full bg-destructive border-2 border-background" />
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Profile menu */}
                <div
                  className={cn(
                    "relative z-10 border-t border-foreground/10 pt-3",
                    railCollapsed && "lg:flex lg:justify-center",
                  )}
                >
                  <DropdownMenu open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        title="Profile menu"
                        className={cn(
                          "flex items-center gap-3 rounded-xl border px-2.5 py-2 text-sm transition-colors w-full outline-none",
                          "border-foreground/10 bg-foreground/[0.04] hover:bg-foreground/[0.08]",
                          "focus-visible:ring-2 focus-visible:ring-[#eca8d6]/40",
                          (navItemActive(pathname, "/profile") || navItemActive(pathname, "/settings")) &&
                            "bg-foreground/7 border-[#eca8d6]/25",
                          railCollapsed && "lg:justify-center lg:px-0 lg:size-10 lg:border-transparent lg:bg-transparent",
                        )}
                      >
                        <Avatar className="size-9 shrink-0">
                          <AvatarFallback className="bg-[#eca8d6] text-background text-xs font-mono font-bold">
                            {me ? initials(me.first_name, me.last_name, me.email) : "U"}
                          </AvatarFallback>
                        </Avatar>
                        <span
                          className={cn(
                            "hidden lg:flex min-w-0 flex-col items-start text-left",
                            railCollapsed && "lg:hidden",
                          )}
                        >
                          <span className="font-medium leading-tight">Profile</span>
                          <span className="text-[0.65rem] text-muted-foreground truncate max-w-[9rem]">
                            {me?.first_name ? `${me.first_name} ${me.last_name}`.trim() : me?.email}
                          </span>
                        </span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side={railCollapsed ? "right" : "top"}
                      align={railCollapsed ? "end" : "start"}
                      className="z-[100] w-52 rounded-xl border border-foreground/10 bg-background/95 backdrop-blur-xl p-1 shadow-lg"
                    >
                      <DropdownMenuItem asChild className="rounded-lg cursor-pointer text-[0.8rem]">
                        <Link
                          href="/profile"
                          className="flex items-center gap-2"
                          onClick={() => {
                            if (window.innerWidth < 1024) setRailCollapsed(true);
                          }}
                        >
                          <User className="size-4 text-[#eca8d6]" />
                          View Profile
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-lg cursor-pointer text-[0.8rem]">
                        <Link
                          href="/settings"
                          className="flex items-center gap-2"
                          onClick={() => {
                            if (window.innerWidth < 1024) setRailCollapsed(true);
                          }}
                        >
                          <Settings className="size-4 text-[#eca8d6]" />
                          Open Settings
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="rounded-lg cursor-pointer text-[0.8rem] text-red-600 focus:text-red-600 focus:bg-red-500/10"
                        onClick={() => void handleSignOut()}
                      >
                        <span className="flex items-center gap-2">
                          <LogOut className="size-4" />
                          Sign out
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

            </div>
          </aside>
        </>
      )}

      <div
        className={cn(
          "relative z-10 mx-auto min-h-[100dvh] w-full py-4 pr-4 sm:pr-6",
          !isSupportPage ? [
            "max-w-[100rem]",
            /* reserve space for fixed sidebar + gap (1rem) — matches sidebar left + width */
            "pl-[calc(max(1rem,calc((100vw_-_100rem)/2_+_1rem))+4.25rem+1rem)]",
            "sm:pl-[calc(max(1.5rem,calc((100vw_-_100rem)/2_+_1.5rem))+4.25rem+1rem)]",
            railCollapsed
              ? "lg:pl-[calc(max(1.5rem,calc((100vw_-_100rem)/2_+_1.5rem))+4.25rem+1rem)]"
              : "lg:pl-[calc(max(1.5rem,calc((100vw_-_100rem)/2_+_1.5rem))+16rem+1rem)]"
          ] : "max-w-none p-0"
        )}
      >
        {/* Main */}
        <div className="min-h-0">
            {!isSupportPage && (
              <header className="sticky top-4 z-20">
                <div className="rounded-2xl border border-foreground/10 bg-background/40 backdrop-blur-xl">
                  <div className="flex items-center gap-3 px-3 sm:px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="font-display text-xl tracking-tight">{sectionTitle}</div>
                    </div>

                    <div className="flex-1" />

                    <div className="hidden md:flex items-center gap-2 w-[min(34vw,28rem)]">
                      <div className="relative w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                          placeholder="Search projects…"
                          className="h-10 pl-10 bg-foreground/[0.03] border-foreground/15"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") toast.message("Search is coming soon.");
                          }}
                        />
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-xl hover:bg-foreground/5"
                      onClick={() => toast.message("No notifications yet.")}
                      aria-label="Notifications"
                    >
                      <Bell className="size-4 text-[#eca8d6] opacity-100" />
                    </Button>
                  </div>
                </div>
              </header>
            )}

            <main className={cn("pb-8", !isSupportPage && "pt-4")}>{children}</main>
          </div>
        </div>

      {!isSupportPage && <FloatingChatSupport />}

      <Dialog open={renameLibTarget !== null} onOpenChange={(o) => !o && setRenameLibTarget(null)}>
        <DialogContent className="border-foreground/15 bg-background/90 backdrop-blur-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename library</DialogTitle>
            <DialogDescription>Projects in this library keep their assignments.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={renameLibValue}
              onChange={(e) => setRenameLibValue(e.target.value)}
              placeholder="Library name"
              className="h-11 border-foreground/15 bg-foreground/[0.03]"
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmRenameLibrary();
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-full" onClick={() => setRenameLibTarget(null)}>
                Cancel
              </Button>
              <Button className="rounded-full bg-foreground text-background" onClick={confirmRenameLibrary}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteLibTarget !== null} onOpenChange={(o) => !o && setDeleteLibTarget(null)}>
        <AlertDialogContent className="border-foreground/15 bg-background/95 backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete library?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteLibTarget}&quot; will be removed. Projects stay in your workspace; only the library folder is
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteLibrary}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

