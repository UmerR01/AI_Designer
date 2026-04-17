"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { getJson, postJson } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ShareResponse = {
  locked?: boolean;
  link?: { slug: string; role: "viewer" | "editor"; visibility: "public" | "password" };
  project?: { id: string; name: string; kind: string; data: any };
  assets?: SharedImage[];
  detail?: string;
};

type SharedImage = {
  id: string;
  url: string;
  filename: string;
  page_name?: string;
  created_at?: string;
};

export default function ShareViewClient({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [shareLink, setShareLink] = useState<ShareResponse["link"]>(undefined);
  const [project, setProject] = useState<ShareResponse["project"]>(undefined);
  const [assets, setAssets] = useState<SharedImage[]>([]);
  const [password, setPassword] = useState("");
  const generatedFromData = useMemo(() => {
    const data = project?.data;
    if (!data || typeof data !== "object") return [] as SharedImage[];
    const raw = (data as any).generatedUiImages;
    if (!Array.isArray(raw)) return [] as SharedImage[];
    return raw.filter((x) => x && typeof x === "object" && x.url && x.filename) as SharedImage[];
  }, [project]);
  const generatedImages = useMemo(() => {
    const byKey = new Map<string, SharedImage>();
    for (const img of [...generatedFromData, ...assets]) {
      const key = img.id || img.url || img.filename;
      if (!key) continue;
      const prev = byKey.get(key);
      if (!prev || (img.created_at || "").localeCompare(prev.created_at || "") >= 0) {
        byKey.set(key, img);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [generatedFromData, assets]);

  async function load() {
    setLoading(true);
    try {
      const res = await getJson<ShareResponse>(`/api/share/${slug}`);
      setLocked(Boolean(res.locked));
      setShareLink(res.link);
      setProject(res.project);
      setAssets(Array.isArray(res.assets) ? res.assets : []);
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Could not load share.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (loading || locked) return;
    if (!project?.id) return;
    if (shareLink?.role !== "editor") return;
    // Editor links should open the actual workspace directly.
    window.location.replace(`/project/${project.id}`);
  }, [loading, locked, shareLink?.role, project?.id]);

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-8 text-center">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-8">
        <div className="w-full max-w-md rounded-3xl border border-foreground/10 bg-background/70 backdrop-blur-xl p-6 space-y-4">
          <div className="space-y-1">
            <div className="font-display text-2xl tracking-tight">Private link</div>
            <div className="text-sm text-muted-foreground">Enter the password to view this project.</div>
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
              } catch (e: any) {
                toast.error(e?.detail ?? e?.message ?? "Wrong password.");
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
    <div className="min-h-[70vh] p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">Shared project</div>
            <div className="font-display text-3xl tracking-tight truncate">{project.name}</div>
            <div className="text-sm text-muted-foreground mt-1 capitalize">{project.kind}</div>
          </div>
          <div className="flex items-center gap-2">
            {generatedImages.length > 0 ? (
              <Button
                variant="outline"
                className="rounded-full border-foreground/20"
                onClick={() => {
                  generatedImages.forEach((img, idx) => {
                    window.setTimeout(() => {
                      const a = document.createElement("a");
                      a.href = img.url;
                      a.download = img.filename || `design-${idx + 1}.png`;
                      a.target = "_blank";
                      a.rel = "noreferrer";
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                    }, idx * 120);
                  });
                }}
              >
                Download <Download className="ml-2 size-4" />
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="rounded-full border-foreground/20"
              onClick={() => {
                if (shareLink?.role === "editor" && project?.id) {
                  window.location.replace(`/project/${project.id}`);
                  return;
                }
                window.location.href = "/";
              }}
            >
              {shareLink?.role === "editor" ? "Open editor" : "Open app"}
            </Button>
          </div>
        </div>

        <div className="rounded-3xl border border-foreground/10 bg-foreground/[0.02] p-6">
          {generatedImages.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No generated design assets are available for this project yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              {generatedImages
                .slice()
                .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
                .map((img) => (
                  <div key={img.id} className="rounded-2xl border border-foreground/10 bg-background overflow-hidden self-start">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.filename} className="w-full h-auto object-contain bg-white" />
                    <div className="px-3 py-2 text-[0.72rem] text-muted-foreground font-mono">
                      {img.page_name ? `${img.page_name} · ` : ""}
                      {img.created_at ? new Date(img.created_at).toLocaleTimeString() : img.filename}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

