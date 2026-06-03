"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApiError, getJson, postJson } from "@/lib/auth-api";
import { loginUrlWithNext } from "@/lib/auth/login-redirect";
import { SharedProjectViewer } from "@/components/share/shared-project-viewer";
import type { ShareGalleryImage } from "@/lib/share-gallery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ShareResponse = {
  locked?: boolean;
  requiresLogin?: boolean;
  link?: { slug: string; role: "viewer" | "editor"; visibility: "public" | "password" };
  project?: { id: string; name: string; kind: string; data?: unknown };
  assets?: ShareGalleryImage[];
  detail?: string;
};

export default function ShareViewClient({ slug }: { slug: string }) {
  const router = useRouter();
  const sharePath = `/share/${slug}`;
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [shareLink, setShareLink] = useState<ShareResponse["link"]>(undefined);
  const [project, setProject] = useState<ShareResponse["project"]>(undefined);
  const [assets, setAssets] = useState<ShareGalleryImage[]>([]);
  const [password, setPassword] = useState("");
  const [openingEditor, setOpeningEditor] = useState(false);

  function redirectToLogin() {
    router.replace(loginUrlWithNext(sharePath));
  }

  async function openSharedEditor(projectId: string) {
    setOpeningEditor(true);
    try {
      const me = await getJson<{ user?: { id: string } }>("/api/auth/me").catch(() => null);
      if (!me?.user?.id) {
        redirectToLogin();
        return;
      }
      await postJson(`/api/share/${slug}/claim`, {});
      router.replace(`/project/${projectId}?shared=1`);
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 401) {
        redirectToLogin();
        return;
      }
      const err = e as { detail?: string; message?: string };
      toast.error(err?.detail ?? err?.message ?? "Could not open editor.");
    } finally {
      setOpeningEditor(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const res = await getJson<ShareResponse>(`/api/share/${slug}`);

      if (res.requiresLogin) {
        redirectToLogin();
        return null;
      }

      setLocked(Boolean(res.locked));
      setShareLink(res.link);
      setProject(res.project);
      setAssets(Array.isArray(res.assets) ? res.assets : []);

      if (!res.locked && res.link?.role === "editor" && res.project?.id) {
        await openSharedEditor(res.project.id);
      }

      return res;
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 401) {
        redirectToLogin();
        return null;
      }
      const err = e as { detail?: string; message?: string };
      toast.error(err?.detail ?? err?.message ?? "Could not load share.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (loading || openingEditor || shareLink?.role === "editor") {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-8 text-center">
        <div className="text-sm text-muted-foreground">
          {openingEditor || shareLink?.role === "editor"
            ? "Sign in required — redirecting…"
            : "Loading…"}
        </div>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-8">
        <div className="w-full max-w-md rounded-3xl border border-foreground/10 bg-background/70 backdrop-blur-xl p-6 space-y-4">
          <div className="space-y-1">
            <div className="font-display text-2xl tracking-tight">Private link</div>
            <div className="text-sm text-muted-foreground">
              Enter the password to continue.
              {shareLink?.role === "editor" ? (
                <span className="block mt-1">You will need to sign in to edit this project.</span>
              ) : null}
            </div>
          </div>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="h-11 rounded-2xl border-foreground/15 bg-foreground/[0.03]"
          />
          <Button
            className="w-full h-11 rounded-full bg-foreground text-background hover:bg-foreground/90"
            onClick={async () => {
              try {
                await postJson(`/api/share/${slug}/unlock`, { password });
                toast.success("Unlocked.");
                setPassword("");
                await load();
              } catch (e: unknown) {
                const err = e as { detail?: string; message?: string };
                toast.error(err?.detail ?? err?.message ?? "Wrong password.");
              }
            }}
          >
            Unlock
          </Button>
          <div className="text-center text-xs text-muted-foreground">
            <Link href="/" className="underline underline-offset-4 hover:text-foreground">
              Back home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-8 text-center">
        <div className="space-y-2">
          <div className="font-display text-2xl tracking-tight">Not found</div>
          <div className="text-sm text-muted-foreground">This link is invalid or has been revoked.</div>
        </div>
      </div>
    );
  }

  return (
    <SharedProjectViewer
      projectName={project.name}
      projectKind={project.kind}
      projectData={project.data}
      assets={assets}
      downloadProxyBase={`/api/share/${slug}/download`}
    />
  );
}
