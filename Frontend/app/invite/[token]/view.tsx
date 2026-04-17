"use client";

import { useEffect } from "react";
import { postJson } from "@/lib/auth-api";

export default function InviteAcceptClient({ token }: { token: string }) {
  useEffect(() => {
    (async () => {
      try {
        await postJson("/api/invites/accept", { token });
      } finally {
        window.location.href = "/projects";
      }
    })();
  }, [token]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center text-center p-8">
      <div className="space-y-2">
        <div className="font-display text-2xl tracking-tight">Joining project…</div>
        <div className="text-sm text-muted-foreground">If you’re not signed in, you’ll be redirected.</div>
      </div>
    </div>
  );
}

