"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bell, Folder, Home, Settings, Search, LogOut, LayoutGrid } from "lucide-react";
import { toast } from "sonner";

import { getMeCached, postJson } from "@/lib/auth-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FloatingChatSupport } from "@/components/support/floating-chat-support";

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
  return pathname === href;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [railCollapsed, setRailCollapsed] = useState(false);

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

  const sectionTitle = useMemo(() => {
    if (pathname?.startsWith("/project/")) return "Editor";
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
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  const isSupportPage = pathname === "/support";

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-background text-foreground">
      <HeroAmbientBackground />

      {/* Left rail — fixed to viewport so it never scrolls with page */}
      {!isSupportPage && (
        <aside
          className={cn(
            "fixed top-4 bottom-4 z-40 w-[4.25rem]",
            railCollapsed ? "lg:w-[4.25rem]" : "lg:w-64",
            "left-[max(1rem,calc((100vw_-_100rem)/2_+_1rem))]",
            "sm:left-[max(1.5rem,calc((100vw_-_100rem)/2_+_1.5rem))]",
          )}
        >
          <div className="flex h-full flex-col overflow-y-auto rounded-2xl border border-foreground/10 bg-background/40 backdrop-blur-xl">
            <div className="px-3 lg:px-4 pt-4 pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    className="size-9 rounded-xl border border-foreground/10 bg-foreground/5 grid place-items-center hover:bg-foreground/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eca8d6]/50"
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
                  >
                    <Icon className="size-4 text-[#eca8d6]" />
                    <span className={cn("hidden lg:inline", railCollapsed && "lg:hidden")}>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>
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

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-2 rounded-xl border border-foreground/10 bg-foreground/[0.03] px-2 py-1.5 hover:bg-foreground/5 transition-colors">
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-[#eca8d6] text-background text-xs font-mono">
                              {me ? initials(me.first_name, me.last_name, me.email) : "U"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="hidden sm:inline text-sm font-medium max-w-[12rem] truncate">
                            {me?.first_name ? `${me.first_name}` : "Account"}
                          </span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="space-y-1">
                          <div className="text-sm font-medium leading-none">{me?.email}</div>
                          <div className="text-xs text-muted-foreground">Signed in</div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={async () => {
                            try {
                              await postJson("/api/auth/logout", {});
                            } finally {
                              toast.success("Signed out.");
                              window.location.href = "/";
                            }
                          }}
                        >
                          <LogOut className="size-4" />
                          Sign out
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </header>
            )}

            <main className={cn("pb-8", !isSupportPage && "pt-4")}>{children}</main>
          </div>
        </div>

      {!isSupportPage && <FloatingChatSupport />}
    </div>
  );
}

