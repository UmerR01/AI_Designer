"use client";

import { useMemo, useState } from "react";
import JSZip from "jszip";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  collectShareGalleryImages,
  shareGalleryIdentityKey,
  shareImageLabel,
  type ShareGalleryImage,
} from "@/lib/share-gallery";
import {
  downloadImageAsPng,
  sanitizeDownloadBasename,
  sanitizePngFilename,
} from "@/lib/download-image";

type Props = {
  projectName: string;
  projectKind?: string;
  projectData?: unknown;
  assets?: ShareGalleryImage[];
  /** Optional proxy base for downloads, e.g. `/api/share/{slug}/download` */
  downloadProxyBase?: string;
};

async function fetchImageBlob(url: string, proxyUrl?: string): Promise<Blob> {
  const target = proxyUrl || url;
  const res = await fetch(target, { credentials: proxyUrl ? "include" : "same-origin" });
  if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
  return res.blob();
}

export function SharedProjectViewer({
  projectName,
  projectKind,
  projectData,
  assets,
  downloadProxyBase,
}: Props) {
  const [downloadingAll, setDownloadingAll] = useState(false);
  const images = useMemo(
    () => collectShareGalleryImages({ projectData, assets }),
    [projectData, assets],
  );

  async function downloadOne(img: ShareGalleryImage, index: number) {
    const label = shareImageLabel(img);
    const proxy =
      downloadProxyBase && img.id
        ? `${downloadProxyBase}?assetId=${encodeURIComponent(img.id)}`
        : undefined;
    try {
      if (proxy) {
        const blob = await fetchImageBlob(img.url, proxy);
        const objectUrl = URL.createObjectURL(blob);
        try {
          const a = document.createElement("a");
          a.href = objectUrl;
          a.download = sanitizePngFilename(label || `design-${index + 1}`);
          document.body.appendChild(a);
          a.click();
          a.remove();
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      } else {
        await downloadImageAsPng(img.url, sanitizePngFilename(label || `design-${index + 1}`));
      }
      toast.success(`Downloaded ${label}`);
    } catch {
      toast.error(`Could not download ${label}`);
    }
  }

  async function downloadAll() {
    if (!images.length) return;
    setDownloadingAll(true);
    try {
      const zip = new JSZip();
      let added = 0;
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const label = shareImageLabel(img);
        const proxy =
          downloadProxyBase && img.id
            ? `${downloadProxyBase}?assetId=${encodeURIComponent(img.id)}`
            : undefined;
        try {
          const blob = await fetchImageBlob(img.url, proxy);
          zip.file(sanitizePngFilename(`${label}-${i + 1}`), blob);
          added += 1;
        } catch {
          // skip failed assets
        }
      }
      if (!added) throw new Error("No images could be downloaded.");
      const out = await zip.generateAsync({ type: "blob" });
      const objectUrl = URL.createObjectURL(out);
      try {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `${sanitizeDownloadBasename(projectName, "designs")}-all.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      toast.success(`Downloaded ${added} file${added === 1 ? "" : "s"} as ZIP`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not download all images.");
    } finally {
      setDownloadingAll(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-foreground/10 bg-background/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 py-5 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
              View only · shared project
            </p>
            <h1 className="font-display text-3xl tracking-tight truncate">{projectName}</h1>
            {projectKind ? (
              <p className="text-sm text-muted-foreground mt-1 capitalize">{projectKind}</p>
            ) : null}
          </div>
          {images.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="rounded-full border-foreground/20"
                disabled={downloadingAll}
                onClick={() => void downloadAll()}
              >
                {downloadingAll ? "Preparing…" : "Download all"}
                <Download className="ml-2 size-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {images.length === 0 ? (
          <div className="rounded-3xl border border-foreground/10 bg-foreground/[0.02] p-8 text-sm text-muted-foreground">
            No design images are available for this project yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            {images.map((img, index) => {
              const label = shareImageLabel(img);
              return (
                <article
                  key={`${shareGalleryIdentityKey(img)}-${index}`}
                  className="rounded-2xl border border-foreground/10 bg-background overflow-hidden shadow-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={label}
                    className="w-full h-auto object-contain bg-white dark:bg-zinc-950"
                  />
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-foreground/10">
                    <span className="text-[0.72rem] text-muted-foreground truncate" title={label}>
                      {label}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full shrink-0 text-[0.65rem] font-medium"
                      onClick={() => void downloadOne(img, index)}
                    >
                      Download
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
