"use client";

import { cn } from "@/lib/utils";

export type AccessLevel = "viewer" | "editor";

export function AccessLevelSelect({
  value,
  onChange,
  className,
  compact,
}: {
  value: AccessLevel;
  onChange: (v: AccessLevel) => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-foreground/10 bg-foreground/[0.02] p-1",
        compact ? "text-[0.75rem]" : "text-sm",
        className
      )}
    >
      <button
        type="button"
        className={cn(
          "px-3 py-1 rounded-full transition-colors",
          value === "viewer" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => onChange("viewer")}
      >
        Can view
      </button>
      <button
        type="button"
        className={cn(
          "px-3 py-1 rounded-full transition-colors",
          value === "editor" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => onChange("editor")}
      >
        Can edit
      </button>
    </div>
  );
}

