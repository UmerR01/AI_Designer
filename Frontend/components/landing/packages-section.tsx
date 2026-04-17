"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, FolderKanban, Layers, Sparkles, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PackageTier = {
  id: string;
  name: string;
  tagline: string;
  credits: number | null;
  creditsLabel: string;
  projects: number;
  practiceFolders: number;
  highlight?: boolean;
  limitNote?: string;
  cta: string;
  ctaHref: string;
  ctaVariant: "primary" | "outline";
};

const tiers: PackageTier[] = [
  {
    id: "basic",
    name: "Basic",
    tagline: "Solo workflows and early concepts.",
    credits: 1000,
    creditsLabel: "model credits",
    projects: 2,
    practiceFolders: 1,
    limitNote:
      "Creating a new project is disabled once you exceed your plan limits. Upgrade anytime to unlock more capacity.",
    cta: "Get Basic",
    ctaHref: "/signup?plan=basic",
    ctaVariant: "outline",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Small teams shipping real campaigns.",
    credits: 1800,
    creditsLabel: "model credits",
    projects: 4,
    practiceFolders: 1,
    highlight: true,
    cta: "Get Pro",
    ctaHref: "/signup?plan=pro",
    ctaVariant: "primary",
  },
  {
    id: "plus",
    name: "Plus",
    tagline: "Studios juggling multiple brands.",
    credits: 2500,
    creditsLabel: "model credits",
    projects: 6,
    practiceFolders: 2,
    cta: "Get Plus",
    ctaHref: "/signup?plan=plus",
    ctaVariant: "outline",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Volume, security, and custom terms.",
    credits: null,
    creditsLabel: "Custom allocation",
    projects: 0,
    practiceFolders: 0,
    cta: "Contact us",
    ctaHref: "mailto:sales@designer.app?subject=Designer%20Enterprise",
    ctaVariant: "outline",
  },
];

export function PackagesSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.08 },
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="packages"
      ref={sectionRef}
      className="relative overflow-hidden border-t border-foreground/10 py-28 lg:py-36"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(236, 168, 214, 0.12), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 50%, rgba(236, 168, 214, 0.06), transparent 50%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-[1400px] px-6 lg:px-12">
        <div className="mb-16 grid gap-10 lg:mb-24 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-6">
            <span
              className={cn(
                "mb-6 inline-flex items-center gap-3 text-sm font-mono text-muted-foreground transition-all duration-1000",
                isVisible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
              )}
            >
              <span className="h-px w-12 bg-foreground/30" />
              Packages
            </span>
            <h2
              className={cn(
                "font-display text-[clamp(2.5rem,8vw,5.5rem)] leading-[0.92] tracking-tight transition-all duration-1000",
                isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0",
              )}
            >
              Model credits.
              <br />
              <span className="packages-stroke">Project caps that scale.</span>
            </h2>
          </div>
          <div
            className={cn(
              "flex flex-col justify-end lg:col-span-6 transition-all delay-150 duration-1000",
              isVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
            )}
          >
            <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
              Every tier includes the same canvas quality—what changes is how many{" "}
              <span className="text-foreground/90">projects</span>,{" "}
              <span className="text-foreground/90">practice workspaces</span>, and{" "}
              <span className="text-foreground/90">model credits</span> you can run in parallel.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
          {tiers.map((tier, index) => (
            <div
              key={tier.id}
              className={cn(
                "relative flex flex-col border border-foreground/10 bg-background/60 backdrop-blur-[2px] transition-all duration-700",
                tier.highlight
                  ? "z-10 border-foreground/25 shadow-[0_0_0_1px_rgba(236,168,214,0.15)] lg:-mx-px lg:scale-[1.04]"
                  : "lg:first:-mr-px lg:last:-ml-px",
                isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0",
              )}
              style={{ transitionDelay: `${index * 90}ms` }}
            >
              {tier.highlight ? (
                <div className="absolute -top-3 left-0 right-0 flex justify-center">
                  <span className="inline-flex items-center gap-2 bg-foreground px-4 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-background">
                    <Zap className="size-3 text-[#eca8d6]" aria-hidden />
                    Most popular
                  </span>
                </div>
              ) : null}

              <div className="flex flex-1 flex-col p-7 lg:p-8">
                <div className="mb-8 border-b border-foreground/10 pb-8">
                  <span className="font-mono text-xs text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 font-display text-2xl tracking-tight lg:text-[1.75rem]">{tier.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{tier.tagline}</p>
                </div>

                <div className="mb-8">
                  {tier.credits !== null ? (
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-5xl tabular-nums tracking-tight lg:text-6xl">
                        {tier.credits.toLocaleString()}
                      </span>
                    </div>
                  ) : (
                    <span className="font-display text-4xl tracking-tight lg:text-5xl">Custom</span>
                  )}
                  <p className="mt-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    {tier.creditsLabel}
                  </p>
                </div>

                <ul className="mb-8 flex-1 space-y-3">
                  {tier.id === "enterprise" ? (
                    <>
                      <li className="flex items-start gap-3 text-sm text-muted-foreground">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-[#eca8d6]" aria-hidden />
                        Tailored credit pools and rate limits
                      </li>
                      <li className="flex items-start gap-3 text-sm text-muted-foreground">
                        <Layers className="mt-0.5 size-4 shrink-0 text-[#eca8d6]" aria-hidden />
                        Projects &amp; practice workspaces on request
                      </li>
                      <li className="flex items-start gap-3 text-sm text-muted-foreground">
                        <Check className="mt-0.5 size-4 shrink-0 text-[#eca8d6]" aria-hidden />
                        SSO, security review, and dedicated support
                      </li>
                    </>
                  ) : (
                    <>
                      <li className="flex items-start gap-3 text-sm text-muted-foreground">
                        <FolderKanban className="mt-0.5 size-4 shrink-0 text-[#eca8d6]" aria-hidden />
                        <span>
                          <span className="font-medium text-foreground">{tier.projects}</span> projects
                        </span>
                      </li>
                      <li className="flex items-start gap-3 text-sm text-muted-foreground">
                        <Layers className="mt-0.5 size-4 shrink-0 text-[#eca8d6]" aria-hidden />
                        <span>
                          <span className="font-medium text-foreground">{tier.practiceFolders}</span> practice{" "}
                          {tier.practiceFolders === 1 ? "folder" : "folders"}
                        </span>
                      </li>
                      <li className="flex items-start gap-3 text-sm text-muted-foreground">
                        <Check className="mt-0.5 size-4 shrink-0 text-[#eca8d6]" aria-hidden />
                        Upgrade anytime for higher caps
                      </li>
                    </>
                  )}
                </ul>

                {tier.limitNote ? (
                  <div className="mb-6 rounded-xl border border-foreground/10 bg-foreground/[0.02] px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                    {tier.limitNote}
                  </div>
                ) : null}

                {tier.ctaHref.startsWith("mailto:") ? (
                  <Button
                    asChild
                    className={cn(
                      "h-12 w-full rounded-none text-sm font-medium transition-all group",
                      tier.ctaVariant === "primary"
                        ? "bg-foreground text-background hover:bg-foreground/90"
                        : "border border-foreground/20 bg-transparent hover:bg-foreground/5",
                    )}
                    variant={tier.ctaVariant === "primary" ? "default" : "outline"}
                  >
                    <a href={tier.ctaHref} className="inline-flex items-center justify-center gap-2">
                      {tier.cta}
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </a>
                  </Button>
                ) : (
                  <Button
                    asChild
                    className={cn(
                      "h-12 w-full rounded-none text-sm font-medium transition-all group",
                      tier.ctaVariant === "primary"
                        ? "bg-foreground text-background hover:bg-foreground/90"
                        : "border border-foreground/20 bg-transparent hover:bg-foreground/5",
                    )}
                    variant={tier.ctaVariant === "primary" ? "default" : "outline"}
                  >
                    <Link href={tier.ctaHref} className="inline-flex items-center justify-center gap-2">
                      {tier.cta}
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          className={cn(
            "mt-16 flex flex-col gap-6 border-t border-foreground/10 pt-10 text-sm text-muted-foreground transition-all delay-300 duration-1000 lg:flex-row lg:items-center lg:justify-between",
            isVisible ? "opacity-100" : "opacity-0",
          )}
        >
          <p className="max-w-2xl font-mono text-xs uppercase tracking-wider">
            Credits apply to model-backed actions. Fair use and rollover policies are shown at checkout.
          </p>
          <Link
            href="/signup"
            className="text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-[#eca8d6]"
          >
            Questions? We&apos;ll match you to the right tier.
          </Link>
        </div>
      </div>

      <style jsx>{`
        .packages-stroke {
          -webkit-text-stroke: 1.5px currentColor;
          -webkit-text-fill-color: transparent;
        }
      `}</style>
    </section>
  );
}
