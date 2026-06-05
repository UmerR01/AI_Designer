import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { getOptionalUser } from "@/lib/auth/server";
import { shareUnlockCookieName, verifyShareUnlock } from "@/lib/auth/share";

export const dynamic = "force-dynamic";

function safeFilename(name: string) {
  let n = (name || "design").replace(/[\\/:*?"<>|]/g, "_").replace(/\.[^.]+$/i, "");
  return `${n || "design"}.png`;
}

async function resolveShareLink(slug: string) {
  const links = await sql()<{
    id: string;
    project_id: string;
    role: "viewer" | "editor";
    visibility: "public" | "password";
    revoked_at: string | null;
  }>`
    select id, project_id, role, visibility, revoked_at
    from project_share_links
    where slug = ${slug}
    limit 1
  `;
  const link = links[0];
  if (!link || link.revoked_at) return null;

  if (link.visibility === "password") {
    const token = (await cookies()).get(shareUnlockCookieName(slug))?.value;
    if (!token) return null;
    const payload = await verifyShareUnlock(token);
    if (!payload || payload.slug !== slug) return null;
  }

  return link;
}

/** Public download proxy for view-only share links (no login). */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const link = await resolveShareLink(slug);
  if (!link) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  if (link.role === "editor") {
    const user = await getOptionalUser();
    if (!user) {
      return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });
    }
  }

  const { searchParams } = new URL(req.url);
  const assetId = searchParams.get("assetId");

  const assets = await sql()<{
    id: string;
    filename: string;
    url: string;
  }>`
    select id, filename, url
    from project_assets
    where project_id = ${link.project_id}
    order by created_at desc
  `;

  if (!assets.length) {
    return NextResponse.json({ detail: "No images to download." }, { status: 404 });
  }

  const asset = assetId ? assets.find((a: any) => a.id === assetId) : assets[0];
  if (!asset) return NextResponse.json({ detail: "Asset not found." }, { status: 404 });

  try {
    const res = await fetch(asset.url);
    if (!res.ok) {
      return NextResponse.json({ detail: "Could not fetch image." }, { status: 502 });
    }
    const bytes = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/png";
    const filename = safeFilename(asset.filename || `${asset.id}.png`);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType.startsWith("image/") ? contentType : "image/png",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ detail: "Download failed." }, { status: 500 });
  }
}
