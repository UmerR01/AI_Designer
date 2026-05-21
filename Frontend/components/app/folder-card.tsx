"use client";

import Image from "next/image";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function FolderCard({
  href,
  title,
  sizeText,
  dateText,
  tone = "default",
  onRename,
  onDelete,
  onRestore,
  onDeletePermanent,
  isFavorite = false,
  onToggleFavorite,
  libraries = [],
  onAddToLibrary,
  onRemoveFromLibrary,
  currentLibrary,
}: {
  href?: string;
  title: string;
  sizeText?: string;
  dateText?: string;
  tone?: "default" | "starter";
  onRename?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onDeletePermanent?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  libraries?: string[];
  onAddToLibrary?: (libName: string) => void;
  onRemoveFromLibrary?: () => void;
  currentLibrary?: string | null;
}) {
  const showMenu = Boolean(href);

  const cardInner = (
    <div
      className={cn(
        "group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-foreground/15 bg-foreground/[0.02] text-center backdrop-blur-[2px] relative",
        "transition-all hover:border-foreground/20 hover:bg-foreground/[0.03]",
      )}
    >
      {/* Favorite Star Indicator */}
      {isFavorite && (
        <div className="absolute left-3 top-3 z-10 flex size-7 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-4 animate-bounce">
            <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clipRule="evenodd" />
          </svg>
        </div>
      )}

      <div className="relative flex min-h-[7.25rem] w-full flex-1 items-center justify-center px-4 pt-4 pb-2">
        <div
          className={cn(
            "pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100",
            tone === "starter"
              ? "bg-[radial-gradient(ellipse_70%_60%_at_50%_30%,rgba(236,168,214,0.14),transparent_60%)]"
              : "bg-[radial-gradient(ellipse_70%_60%_at_50%_30%,rgba(236,168,214,0.10),transparent_60%)]",
          )}
          aria-hidden
        />
        <Image
          src="/images/folder.png"
          alt=""
          width={88}
          height={68}
          className={cn(
            "relative z-[1] max-h-[4.25rem] w-auto drop-shadow-[0_0.65rem_1.75rem_rgba(0,0,0,0.55)] transition-transform duration-300 ease-out",
            "group-hover:translate-y-[-1px] group-hover:scale-[1.01]",
          )}
        />
      </div>

      <div className="flex flex-col gap-0.5 px-3 pb-3 pt-0.5">
        <div
          className={cn(
            "text-sm font-medium leading-snug text-foreground",
            "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]",
          )}
        >
          {title}
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          <span>{sizeText ?? "8 GB"}</span>
          <span className="mx-2 opacity-60">•</span>
          <span>{dateText ?? "12.07.2026"}</span>
        </div>
      </div>
    </div>
  );

  if (!href) {
    return cardInner;
  }

  return (
    <div className="group/card relative h-full min-h-0 w-full">
      <Link
        href={href}
        className="block h-full min-h-0 w-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eca8d6]/50"
      >
        {cardInner}
      </Link>
      {showMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "absolute right-2 top-2 z-20 flex size-8 items-center justify-center rounded-lg",
                "border border-foreground/10 bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm",
                "opacity-90 transition-opacity hover:bg-foreground/10 hover:opacity-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eca8d6]/50",
                "md:opacity-0 md:group-hover/card:opacity-100",
              )}
              aria-label="Project actions"
              onClick={(e) => e.preventDefault()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-4 text-[#eca8d6]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
            {onToggleFavorite ? (
              <DropdownMenuItem
                className="gap-2"
                onSelect={(e) => {
                  e.preventDefault();
                  onToggleFavorite();
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill={isFavorite ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={cn("size-4", isFavorite ? "text-amber-500" : "text-muted-foreground")}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499c.158-.326.448-.523.774-.523s.616.197.774.523l2.082 5.005 5.404.434c.356.028.64.283.714.63.074.347-.046.702-.303.953l-3.9 3.336.88 5.403a.896.896 0 0 1-1.282.932l-4.817-2.54-4.816 2.54a.896.896 0 0 1-1.282-.932l.88-5.403-3.9-3.336a.896.896 0 0 1 .303-.953l5.404-.434 2.082-5.005Z" />
                </svg>
                {isFavorite ? "Remove Favorite" : "Add to Favorites"}
              </DropdownMenuItem>
            ) : null}

            {/* Add to Library Options */}
            {onAddToLibrary && libraries.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t border-foreground/5 uppercase tracking-wider">
                  Add to Library
                </div>
                {libraries.map((lib) => (
                  <DropdownMenuItem
                    key={lib}
                    className="gap-2 pl-4"
                    onSelect={(e) => {
                      e.preventDefault();
                      onAddToLibrary(lib);
                    }}
                  >
                    <span className="size-1.5 rounded-full bg-[#eca8d6]" />
                    {lib}
                  </DropdownMenuItem>
                ))}
              </>
            )}

            {currentLibrary && onRemoveFromLibrary && (
              <DropdownMenuItem
                className="gap-2 border-t border-foreground/5 text-destructive focus:text-destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  onRemoveFromLibrary();
                }}
              >
                Remove from Library
              </DropdownMenuItem>
            )}

            {onRename ? (
              <DropdownMenuItem
                className="gap-2 border-t border-foreground/5"
                onSelect={(e) => {
                  e.preventDefault();
                  onRename();
                }}
              >
                <Pencil className="size-4 text-muted-foreground" />
                Rename
              </DropdownMenuItem>
            ) : null}
            {onDelete ? (
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  onDelete();
                }}
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            ) : null}
            {onRestore ? (
              <DropdownMenuItem
                className="gap-2"
                onSelect={(e) => {
                  e.preventDefault();
                  onRestore();
                }}
              >
                <Trash2 className="size-4 text-muted-foreground" />
                Restore
              </DropdownMenuItem>
            ) : null}
            {onDeletePermanent ? (
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  onDeletePermanent();
                }}
              >
                <Trash2 className="size-4" />
                Delete forever
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
