"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getJson, postJson } from "@/lib/auth-api";
import { loginUrlWithNext } from "@/lib/auth/login-redirect";

type InviteMeta = {
  invite: {
    token: string;
    projectId: string;
    projectName: string;
    role: "viewer" | "editor";
    email: string;
    accepted: boolean;
  };
};

function destinationForInvite(projectId: string, role: "viewer" | "editor") {
  if (role === "editor") return `/project/${projectId}?shared=1`;
  return `/view/${projectId}`;
}

export default function InviteAcceptClient({ token }: { token: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "needs-login" | "accepting" | "error">("loading");
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await getJson<InviteMeta>(`/api/invites/${token}`);
        if (cancelled) return;
        setProjectName(meta.invite.projectName);

        const me = await getJson<{ user?: { id: string } }>("/api/auth/me").catch(() => null);
        if (!me?.user?.id) {
          setStatus("needs-login");
          router.replace(loginUrlWithNext(`/invite/${token}`));
          return;
        }

        setStatus("accepting");
        const accepted = await postJson<{
          ok: boolean;
          projectId: string;
          role: "viewer" | "editor";
        }>("/api/invites/accept", { token });

        if (cancelled) return;
        router.replace(
          destinationForInvite(accepted.projectId, accepted.role ?? meta.invite.role),
        );
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router]);

  if (status === "error") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-center p-8">
        <div className="space-y-3 max-w-sm">
          <div className="font-display text-2xl tracking-tight">Invite unavailable</div>
          <p className="text-sm text-muted-foreground">
            This invite may have expired or already been used.
          </p>
          <Link href="/login" className="text-sm underline underline-offset-4">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center text-center p-8">
      <div className="space-y-2">
        <div className="font-display text-2xl tracking-tight">
          {status === "needs-login" ? "Sign in to continue" : "Joining project…"}
        </div>
        <div className="text-sm text-muted-foreground">
          {projectName ? (
            <>
              Opening <span className="text-foreground font-medium">{projectName}</span>
            </>
          ) : (
            "Please wait…"
          )}
        </div>
      </div>
    </div>
  );
}
