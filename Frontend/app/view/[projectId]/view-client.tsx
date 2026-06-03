"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApiError, getJson } from "@/lib/auth-api";
import { loginUrlWithNext } from "@/lib/auth/login-redirect";
import { SharedProjectViewer } from "@/components/share/shared-project-viewer";
import type { ShareGalleryImage } from "@/lib/share-gallery";
import type { ProjectRole } from "@/lib/projects/authz";

export default function ProjectViewClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [projectKind, setProjectKind] = useState<string | undefined>();
  const [projectData, setProjectData] = useState<unknown>(null);
  const [assets, setAssets] = useState<ShareGalleryImage[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const meta = await getJson<{
          project: { id: string; name: string; kind: string };
          role: ProjectRole;
        }>(`/api/projects/${projectId}`);

        if (cancelled) return;

        if (meta.role === "editor" || meta.role === "owner") {
          router.replace(`/project/${projectId}${meta.role === "editor" ? "?shared=1" : ""}`);
          return;
        }

        if (meta.role !== "viewer") {
          toast.error("You do not have access to this project.");
          router.replace("/projects");
          return;
        }

        setProjectName(meta.project.name);
        setProjectKind(meta.project.kind);

        const [dataRes, assetsRes] = await Promise.all([
          getJson<{ data: unknown }>(`/api/projects/${projectId}/data`),
          getJson<{ images?: ShareGalleryImage[] }>(`/api/projects/${projectId}/assets`),
        ]);

        if (cancelled) return;
        setProjectData(dataRes.data);
        setAssets(Array.isArray(assetsRes.images) ? assetsRes.images : []);
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          router.replace(loginUrlWithNext(`/view/${projectId}`));
          return;
        }
        const err = e as { detail?: string; message?: string };
        toast.error(err?.detail ?? err?.message ?? "Could not load project.");
        router.replace(loginUrlWithNext(`/view/${projectId}`));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, router]);

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-8 text-center">
        <div className="text-sm text-muted-foreground">Loading shared designs…</div>
      </div>
    );
  }

  return (
    <SharedProjectViewer
      projectName={projectName}
      projectKind={projectKind}
      projectData={projectData}
      assets={assets}
      downloadProxyBase={`/api/projects/${projectId}/download`}
    />
  );
}
