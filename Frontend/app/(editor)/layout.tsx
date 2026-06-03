import type { ReactNode } from "react";
import { Suspense } from "react";

export default function EditorLayout({ children }: { children: ReactNode }) {
  // Cursor-like: editor owns the full viewport (no app shell, no floating support chat).
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}

