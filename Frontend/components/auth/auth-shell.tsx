import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AuthShellProps = {
  /** Small pink label above the title (e.g. “Sign in”). */
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Tighter / alternate header spacing (e.g. signup). */
  headerClassName?: string;
  /** Overrides default h1 sizing (e.g. single-line compact title). */
  titleClassName?: string;
  /** Overrides default subtitle styles. */
  subtitleClassName?: string;
  /** Spacing between form blocks (e.g. tighter signup). */
  childrenClassName?: string;
};

/**
 * Split auth layout: wide left rail (bridge + brand) + **fixed-width** right form (~32.5rem).
 * Split from `md` so tablets see the image; right column is not 50/50.
 */
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  headerClassName,
  titleClassName,
  subtitleClassName,
  childrenClassName,
}: AuthShellProps) {
  return (
    <div className="auth-shell-viewport flex min-h-0 flex-col bg-background text-foreground md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,min(32.5rem,46vw))] md:grid-rows-1 md:overflow-hidden">
      {/* Left — brand / mood */}
      <aside className="relative hidden min-h-0 min-w-0 flex-col justify-start overflow-hidden border-foreground/10 p-[clamp(1.25rem,4vw,4rem)] pb-[clamp(1.25rem,5vh,3.5rem)] pt-[clamp(1.25rem,5vh,3.5rem)] noise-overlay md:flex md:border-r">
        {/* Bridge — full-bleed mood; overlays keep type legible */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <Image
            src="/images/bridge.png"
            alt=""
            fill
            className="object-cover object-[center_55%]"
            sizes="(min-width: 768px) 55vw, 100vw"
            priority
          />
        </div>
        {/* Tint — lighter so the photo stays vivid; edge darkening keeps copy legible */}
        <div
          className="absolute inset-0 bg-gradient-to-br from-[oklch(0.16_0.04_305)]/48 via-[oklch(0.1_0.03_285)]/42 to-[oklch(0.06_0.02_265)]/52"
          aria-hidden
        />
        <div
          className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_20%,oklch(0.02_0.02_265_/_0.55))]"
          aria-hidden
        />
        {/* Accent glows — top-left pink anchor (brand) */}
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_100%_78%_at_0%_0%,oklch(0.58_0.15_330_/_0.38),transparent_56%)]"
          aria-hidden
        />
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_85%_75%,oklch(0.35_0.1_280_/_0.1),transparent_55%)]"
          aria-hidden
        />
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_50%_100%,oklch(0.2_0.06_300_/_0.18),transparent_65%)]"
          aria-hidden
        />
        <div
          className="absolute inset-0 bg-[linear-gradient(to_bottom,oklch(0.02_0.01_280_/_0.22),transparent_40%,oklch(0.02_0.015_260_/_0.38))]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.14) 0.0625rem, transparent 0.0625rem),
              linear-gradient(90deg, rgba(255,255,255,0.12) 0.0625rem, transparent 0.0625rem)`,
            backgroundSize: "3rem 3rem",
          }}
          aria-hidden
        />

        <div className="relative z-10 drop-shadow-[0_0.125rem_1rem_rgba(0,0,0,0.65)]">
          <Link href="/" className="inline-flex items-center gap-2 group">
            <span className="font-display text-[clamp(1.75rem,4vw,2.25rem)] tracking-tight">Designer</span>
            <span className="font-mono text-[0.625rem] text-muted-foreground mt-1">TM</span>
          </Link>
          <p className="mt-[clamp(1.5rem,6vh,3rem)] max-w-[min(100%,22rem)] text-[clamp(1rem,2.2vw,1.125rem)] leading-relaxed text-muted-foreground font-display">
            Pro creative workflows—brief to export—without losing your brand.
          </p>
        </div>

      </aside>

      {/* Right — form (narrow rail; rest is left column) */}
      <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background px-[clamp(1rem,5vw,2.5rem)] py-[clamp(0.75rem,3vh,2.5rem)] md:max-w-none">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[22vh] bg-gradient-to-b from-[#eca8d6]/[0.09] via-[#eca8d6]/[0.02] to-transparent"
          aria-hidden
        />
        <div className="mb-[clamp(0.75rem,2vh,1.5rem)] shrink-0 md:hidden">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="font-display text-[clamp(1.375rem,4vw,1.75rem)] tracking-tight">Designer</span>
            <span className="font-mono text-[0.625rem] text-muted-foreground">TM</span>
          </Link>
        </div>

        <div className="relative flex min-h-0 w-full flex-1 flex-col justify-start overflow-y-auto overscroll-contain pt-[clamp(0.25rem,1vh,0.75rem)] md:justify-center md:pt-0 [scrollbar-gutter:stable]">
          <div className="mx-auto w-full max-w-full min-w-0">
            <header className={cn("mb-6 sm:mb-8", headerClassName)}>
              {eyebrow ? (
                <p className="mb-1 text-[0.75rem] font-mono uppercase tracking-[0.2em] text-[#eca8d6]">
                  {eyebrow}
                </p>
              ) : null}
              <h1
                className={cn(
                  "mb-2 font-display text-[clamp(2rem,6vw,3.25rem)] leading-tight tracking-tight",
                  titleClassName
                )}
              >
                {title}
              </h1>
              <p
                className={cn(
                  "text-[clamp(0.9375rem,2.5vw,1rem)] leading-relaxed text-muted-foreground [&_strong]:font-medium [&_strong]:text-[#eca8d6]",
                  subtitleClassName
                )}
              >
                {subtitle}
              </p>
            </header>

            <div
              className={cn(
                "flex flex-col gap-[clamp(1rem,2.5vh,1.5rem)]",
                childrenClassName
              )}
            >
              {children}
            </div>

            {footer ? (
              <div className="mt-[clamp(1.25rem,3vh,2.5rem)] border-t border-foreground/10 pt-[clamp(1rem,2.5vh,2rem)]">
                {footer}
              </div>
            ) : null}
          </div>
        </div>

        <p className="shrink-0 pt-[clamp(0.5rem,2vh,1.5rem)] text-center text-[0.75rem] font-mono text-muted-foreground">
          © {new Date().getFullYear()} Designer
        </p>
      </div>
    </div>
  );
}
