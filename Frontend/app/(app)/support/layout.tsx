import type { ReactNode } from "react";

export default function SupportLayout({ children }: { children: ReactNode }) {
  // AppShell already provides the hero video background; Support pages just render content.
  return <>{children}</>;
}

