"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, FolderOpen, FolderPlus, LayoutPanelLeft, Lightbulb, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDesignerProjects } from "@/hooks/use-designer-projects";

export default function DashboardPage() {
  const { projects } = useDesignerProjects();

  const onboardingSteps = useMemo(
    () =>
      [
        {
          n: 1,
          title: "Create a project",
          body: "Name it and we’ll spin up a workspace you can open anytime.",
          icon: FolderPlus,
        },
        {
          n: 2,
          title: "Open the editor",
          body: "Files on the left, canvas in the middle, chat on the right.",
          icon: LayoutPanelLeft,
        },
        {
          n: 3,
          title: "Brief & iterate",
          body: "Describe the outcome—then refine with prompts and exports.",
          icon: Sparkles,
        },
      ] as const,
    [],
  );

  const overviewCardClass = cn(
    "rounded-2xl border p-5 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md",
    "border-white/20 bg-black/50",
  );

  /** Pink glassmorphism — frosted tint + inset highlight, distinct from overview tiles */
  const stepCardClass = cn(
    "relative overflow-hidden rounded-2xl border border-white/20 p-5",
    "backdrop-blur-2xl",
    "bg-gradient-to-br from-[#eca8d6]/[0.18] via-[#eca8d6]/[0.06] to-black/50",
    "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_4px_24px_rgba(236,168,214,0.07),0_12px_40px_rgba(0,0,0,0.38)]",
    "ring-1 ring-inset ring-white/[0.08]",
  );

  return (
    <div className="space-y-8">
      {/* Home overview — distinct from Projects */}
      <section className="space-y-2">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-[#eca8d6]">Overview</div>
        <h1 className="font-display text-3xl tracking-tight text-white sm:text-4xl">Welcome back</h1>
        <p className="max-w-2xl text-white/95">
          This is your home base—see what’s going on at a glance, then head to{" "}
          <Link href="/projects" className="text-white underline-offset-4 hover:text-[#eca8d6] hover:underline">
            Projects
          </Link>{" "}
          to open folders or start something new.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className={overviewCardClass}>
          <div className="text-xs font-mono font-semibold uppercase tracking-wider text-white">Active projects</div>
          <div className="mt-2 font-display text-4xl tabular-nums tracking-tight text-white">{projects.length}</div>
          <p className="mt-1 text-sm font-medium text-white/95">In this workspace.</p>
          <Button
            asChild
            variant="ghost"
            className="mt-4 h-9 rounded-full px-0 text-[#eca8d6] hover:bg-transparent hover:text-[#eca8d6]/90"
          >
            <Link href="/projects" className="inline-flex items-center gap-1">
              Open Projects
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        <div className={overviewCardClass}>
          <div className="flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-wider text-white">
            <FolderOpen className="size-3.5 text-[#eca8d6]" />
            Library
          </div>
          <p className="mt-3 text-sm font-medium leading-relaxed text-white">
            Every project opens as a folder workspace—like a design IDE with AI chat beside your canvas.
          </p>
          <Button asChild className="mt-4 w-full rounded-full bg-foreground text-background hover:bg-foreground/90 sm:w-auto">
            <Link href="/projects">Browse folders</Link>
          </Button>
        </div>

        <div className={overviewCardClass}>
          <div className="flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-wider text-white">
            <Lightbulb className="size-3.5 text-[#eca8d6]" />
            Quick tip
          </div>
          <p className="mt-3 text-sm font-medium leading-relaxed text-white">
            Use the prompt panel on the right in the editor to describe layouts, copy, or assets—iterate without losing
            context.
          </p>
        </div>
      </section>

      {/* Getting started — light glass (same as before opaque tweak) */}
      <section className="overflow-hidden rounded-2xl border border-foreground/15 bg-foreground/[0.02] shadow-none backdrop-blur-[2px]">
        <div className="p-6 sm:p-8">
          <div className="min-w-0 max-w-3xl">
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-[#eca8d6]">Getting started</div>
            <h2 className="mt-2 font-display text-3xl tracking-tight text-white sm:text-4xl">
              Your workspace, ready to ship.
            </h2>
            <p className="mt-2 max-w-2xl text-white/95">
              Three steps from zero to a first draft—then use{" "}
              <Link href="/projects" className="text-white underline-offset-4 hover:text-[#eca8d6] hover:underline">
                Projects
              </Link>{" "}
              whenever you’re ready to create or open a folder.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {onboardingSteps.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.n}
                  className={cn(
                    stepCardClass,
                    "transition-[border-color,box-shadow,transform] duration-300",
                    "hover:border-[#eca8d6]/35 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_8px_32px_rgba(236,168,214,0.12),0_16px_52px_rgba(0,0,0,0.48)]",
                  )}
                >
                  <div
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_80%_at_0%_0%,rgba(236,168,214,0.22),transparent_55%)]"
                    aria-hidden
                  />
                  <div className="relative flex gap-4">
                    <div className="flex shrink-0 flex-col items-center gap-2.5">
                      <span className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/[0.07] text-[#eca8d6] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-sm">
                        <Icon className="size-[1.15rem] shrink-0 [stroke-opacity:1]" strokeWidth={2} />
                      </span>
                      <span className="font-mono text-[0.65rem] font-medium tabular-nums text-white/40">
                        {String(step.n).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <div className="text-[0.65rem] font-mono uppercase tracking-[0.2em] text-[#eca8d6]/90">
                        Step {step.n}
                      </div>
                      <div className="mt-1.5 font-display text-base font-medium leading-snug tracking-tight text-white">
                        {step.title}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-white/75">{step.body}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
