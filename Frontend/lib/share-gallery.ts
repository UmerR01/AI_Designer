export type ShareGalleryImage = {
  id: string;
  url: string;
  filename: string;
  page_name?: string;
  screenName?: string;
  created_at?: string;
};

function isStyleGuide(img: Pick<ShareGalleryImage, "page_name" | "filename" | "screenName">) {
  const hay = `${img.page_name ?? ""} ${img.filename ?? ""} ${img.screenName ?? ""}`.toLowerCase();
  return hay.includes("style guide");
}

/** Merge project JSON images + DB assets; exclude style guides; newest wins per id/url. */
export function collectShareGalleryImages(args: {
  projectData?: unknown;
  assets?: ShareGalleryImage[];
}): ShareGalleryImage[] {
  const fromData: ShareGalleryImage[] = [];
  const data = args.projectData;
  if (data && typeof data === "object") {
    const raw = (data as { generatedUiImages?: unknown }).generatedUiImages;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const url = typeof row.url === "string" ? row.url : "";
        const filename = typeof row.filename === "string" ? row.filename : "design.png";
        const id = typeof row.id === "string" ? row.id : url || filename;
        if (!url) continue;
        fromData.push({
          id,
          url,
          filename,
          page_name: typeof row.page_name === "string" ? row.page_name : undefined,
          screenName: typeof row.screenName === "string" ? row.screenName : undefined,
          created_at: typeof row.created_at === "string" ? row.created_at : undefined,
        });
      }
    }
  }

  const byKey = new Map<string, ShareGalleryImage>();
  for (const img of [...fromData, ...(args.assets ?? [])]) {
    if (!img.url || isStyleGuide(img)) continue;
    const key = img.id || img.url || img.filename;
    const prev = byKey.get(key);
    if (!prev || (img.created_at || "").localeCompare(prev.created_at || "") >= 0) {
      byKey.set(key, img);
    }
  }

  return Array.from(byKey.values()).sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || ""),
  );
}

export function shareImageLabel(img: ShareGalleryImage): string {
  const fromPage = (img.page_name || "")
    .replace(/\[SectionID:[^\]]+\]\s*/gi, "")
    .replace(/\[ScreenID:[^\]]+\]\s*/gi, "")
    .trim();
  return img.screenName?.trim() || fromPage || img.filename || "Design";
}
