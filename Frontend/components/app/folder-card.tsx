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
}: {
  href?: string;
  title: string;
  sizeText?: string;
  dateText?: string;
  tone?: "default" | "starter";
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const showMenu = Boolean(href && (onRename || onDelete));

  const cardInner = (
    <div
      className={cn(
        "group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-foreground/15 bg-foreground/[0.02] text-center backdrop-blur-[2px]",
        "transition-all hover:border-foreground/20 hover:bg-foreground/[0.03]",
      )}
    >
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
          <DropdownMenuContent align="end" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
            {onRename ? (
              <DropdownMenuItem
                className="gap-2"
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
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
