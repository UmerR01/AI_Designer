import type { ReactNode } from "react";

import { FloatingChatSupport } from "@/components/support/floating-chat-support";

export default function EditorLayout({ children }: { children: ReactNode }) {
  // Cursor-like: editor owns the full viewport (no app shell).
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      {children}
      <FloatingChatSupport />
    </div>
  );
}

