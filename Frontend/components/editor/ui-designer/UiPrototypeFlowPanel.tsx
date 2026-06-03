"use client";

import { ArrowRight } from "lucide-react";

import { orderFlowGalleryImages, type UiFlowGraph } from "@/lib/ui-flow-graph";
import { cn } from "@/lib/utils";

export type FlowGalleryImage = {
  id: string;
  url: string;
  filename?: string;
  page_name?: string;
  nodeId?: string;
  screenName?: string;
  isAnchor?: boolean;
  index?: number;
  total?: number;
  created_at?: string;
};

type Props = {
  flowGraph: UiFlowGraph;
  images: FlowGalleryImage[];
  className?: string;
};

const CARD_W = 220;
const CARD_IMG_H = 200;

export function UiPrototypeFlowPanel({ flowGraph, images, className }: Props) {
  const orderedImages = orderFlowGalleryImages(flowGraph, images);

  const linkCount = Math.max(0, orderedImages.length - 1);

  if (!orderedImages.length) return null;

  const followUpScreens = orderedImages.filter((img) => !img.isAnchor);
  const followUpTotal = followUpScreens.length;

  return (
    <div
      className={cn(
        "rounded-3xl border border-[#eca8d6]/20 bg-gradient-to-b from-[#eca8d6]/[0.06] to-transparent overflow-hidden shadow-[0_8px_40px_-12px_rgba(236,168,214,0.25)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#eca8d6]/15 px-5 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eca8d6]/15 border border-[#eca8d6]/25">
            <ArrowRight className="size-4 text-[#eca8d6]" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.25em] text-[#eca8d6]">
              Prototype flow
            </p>
            <p className="text-[0.72rem] text-muted-foreground mt-0.5 truncate">
              Screen order left to right
            </p>
          </div>
        </div>
        <span className="text-[0.65rem] font-mono text-muted-foreground/80 tabular-nums shrink-0">
          {orderedImages.length} screens · {linkCount} link{linkCount !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="px-4 py-6 overflow-x-auto">
        <div className="flex flex-row items-center gap-3 sm:gap-4 min-w-min">
          {orderedImages.map((img, index) => {
            const label = img.screenName || img.filename || "Screen";
            const followUpIndex = img.isAnchor
              ? null
              : followUpScreens.findIndex((f) => f.id === img.id) + 1;

            return (
              <div key={img.id} className="flex items-center gap-3 sm:gap-4 shrink-0">
                {index > 0 ? (
                  <div
                    className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#eca8d6]/25 bg-[#eca8d6]/10 text-[#eca8d6]"
                    aria-hidden
                  >
                    <ArrowRight className="size-5" strokeWidth={2} />
                  </div>
                ) : null}

                <div
                  className="shrink-0 rounded-2xl border bg-background shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-[#eca8d6]/35"
                  style={{ width: CARD_W }}
                >
                  <div
                    className={cn(
                      "relative overflow-hidden rounded-2xl",
                      img.isAnchor
                        ? "border border-[#eca8d6]/40 ring-1 ring-[#eca8d6]/15"
                        : "border border-foreground/12",
                    )}
                  >
                    {img.isAnchor ? (
                      <span className="absolute mt-2 ml-2 z-10 rounded-full bg-[#eca8d6] px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-wider text-background">
                        Anchor
                      </span>
                    ) : null}

                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={label}
                      className="w-full bg-white dark:bg-zinc-950 object-cover object-top"
                      style={{ height: CARD_IMG_H }}
                    />
                    <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-foreground/10 bg-foreground/[0.02] min-h-[40px]">
                      <span className="text-[0.72rem] font-medium truncate" title={label}>
                        {label}
                      </span>
                      {img.isAnchor ? (
                        <span className="text-[0.62rem] font-mono text-[#eca8d6]/80 shrink-0">
                          style ref
                        </span>
                      ) : followUpIndex && followUpIndex > 0 ? (
                        <span className="text-[0.62rem] font-mono text-[#eca8d6]/80 shrink-0 tabular-nums">
                          {followUpIndex}/{followUpTotal}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
